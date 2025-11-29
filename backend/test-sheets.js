const { google } = require('googleapis');
require('dotenv').config();

async function testSheetsAccess() {
  try {
    console.log('🧪 Testing Google Sheets API Access...\n');
    
    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      'http://localhost:3000/oauth2callback'
    );
    
    oauth2Client.setCredentials({
      refresh_token: process.env.GOOGLE_REFRESH_TOKEN
    });
    
    const sheets = google.sheets({ version: 'v4', auth: oauth2Client });
    
    console.log('📋 Sheet ID:', process.env.TRACKING_SHEET_ID);
    
    console.log('\n📡 Test 1: Getting spreadsheet metadata...');
    const metadata = await sheets.spreadsheets.get({
      spreadsheetId: process.env.TRACKING_SHEET_ID
    });
    
    console.log('✅ SUCCESS! Spreadsheet:', metadata.data.properties.title);
    console.log('   Sheets:');
    metadata.data.sheets.forEach(sheet => {
      console.log(`      - ${sheet.properties.title}`);
    });
    
    const firstSheetName = metadata.data.sheets[0].properties.title;
    
    console.log('\n📡 Test 2: Appending test row...');
    const testValues = [[
      'Test Company',
      'Test Position',
      new Date().toLocaleDateString(),
      'https://docs.google.com/document/d/test123/edit',
      'test@email.com'
    ]];
    
    const result = await sheets.spreadsheets.values.append({
      spreadsheetId: process.env.TRACKING_SHEET_ID,
      range: `${firstSheetName}!A:E`,
      valueInputOption: 'USER_ENTERED',
      insertDataOption: 'INSERT_ROWS',
      requestBody: {
        values: testValues
      }
    });
    
    console.log('✅ SUCCESS! Updated:', result.data.updates.updatedRange);
    console.log('\n🎉 Check your Google Sheet - test row added!\n');
    
  } catch (error) {
    console.error('\n❌ ERROR:', error.message);
    if (error.code === 403) {
      console.log('\n💡 Share the sheet with your OAuth account email');
    }
  }
}

testSheetsAccess();