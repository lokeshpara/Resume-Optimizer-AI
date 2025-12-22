require('dotenv').config();

const fs = require('fs');
const csv = require('csv-parser');
const { Pool } = require('pg');

/**
 * Convert MM/DD/YYYY → YYYY-MM-DD
 */
function parseDate(mmddyyyy) {
    if (!mmddyyyy) return null;

    const parts = mmddyyyy.split('/');
    if (parts.length !== 3) return null;

    const [month, day, year] = parts;

    if (!month || !day || !year) return null;

    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
}

const pool = new Pool({
    connectionString: process.env.DATABASE_URL
});

async function importCSV() {
    const rows = [];

    fs.createReadStream('Applied Sheet - Sheet1.csv')
        .pipe(csv())
        .on('data', (data) => {
            rows.push(data);
        })
        .on('end', async () => {
            console.log(`📄 Read ${rows.length} rows from CSV`);

            for (const r of rows) {
                const company = r['Company Name']?.trim();
                const position = r['Position Applied']?.trim();
                const date = parseDate(r['Date']);
                const resume = r['Resume Link'] || null;
                const jdLink = r['JobPost URL'] || null;
                const jdText = r['JD'] || null;

                // Required field validation
                if (!company || !position || !date) {
                    console.log(`⚠️ Skipping row (missing data):`, r);
                    continue;
                }

                try {
                    await pool.query(
                        `
            INSERT INTO applications
            (company_name, position_applied, date_applied, resume_link, jd_link, jd_text)
            VALUES ($1, $2, $3, $4, $5, $6)
            `,
                        [company, position, date, resume, jdLink, jdText]
                    );
                } catch (err) {
                    console.error(`❌ Failed to insert row for ${company}`, err.message);
                }
            }

            console.log('✅ Import completed');
            process.exit(0);
        });
}

importCSV().catch(console.error);
