require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

const express = require('express');
const cors = require('cors');
const axios = require('axios');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { google } = require('googleapis');
const path = require('path');
const fs = require('fs');
const {
  findRecruitersAndSendEmails
} = require('./recruiter-automation-v2');

const app = express();
app.use(express.static('public'));
const PORT = 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// =====================================================
// POSTGRESQL CONNECTION (Using DATABASE_URL)
// =====================================================

// Test connection
pool.query('SELECT NOW()', (err, res) => {
  if (err) {
    console.error('❌ Database connection failed:', err);
  } else {
    console.log('✅ Database connected:', res.rows[0].now);
  }
});

// Initialize Google APIs
const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  'http://localhost:3000/oauth2callback'
);

oauth2Client.setCredentials({
  refresh_token: process.env.GOOGLE_REFRESH_TOKEN
});

const docs = google.docs({ version: 'v1', auth: oauth2Client });
const drive = google.drive({ version: 'v3', auth: oauth2Client });
const sheets = google.sheets({ version: 'v4', auth: oauth2Client });
// =====================================================
// SEPARATE GMAIL OAUTH CLIENT FOR RECRUITER EMAILS
// =====================================================
const gmailOAuth2Client = new google.auth.OAuth2(
  process.env.GMAIL_CLIENT_ID,
  process.env.GMAIL_CLIENT_SECRET,
  'http://localhost:3000/oauth2callback-gmail'
);

gmailOAuth2Client.setCredentials({
  refresh_token: process.env.GMAIL_REFRESH_TOKEN
});

// Gmail uses SEPARATE auth client
const gmail = google.gmail({ version: 'v1', auth: gmailOAuth2Client });

// const ORIGINAL_RESUME_DOC_ID = process.env.ORIGINAL_RESUME_DOC_ID;
const DRIVE_FOLDER_ID = process.env.DRIVE_FOLDER_ID;
const TRACKING_SHEET_ID = process.env.TRACKING_SHEET_ID;
const SAI_RESUME_TEMPLATE_ID = process.env.SAI_RESUME_TEMPLATE_ID;


// ADD THESE 4 NEW LINES:

const FRONTEND_RESUME_DOC_ID = process.env.FRONTEND_RESUME_DOC_ID;
const FULLSTACK_RESUME_DOC_ID = process.env.FULLSTACK_RESUME_DOC_ID;

// AI Provider wrapper
async function generateAIContent(prompt, provider, apiKey) {
  if (provider === 'gemini') {
    return await generateWithGemini(prompt, apiKey);
  } else if (provider === 'chatgpt') {
    return await generateWithChatGPT(prompt, apiKey);
  } else {
    throw new Error('Invalid AI provider. Use "gemini" or "chatgpt"');
  }
}

// Gemini AI implementation
async function generateWithGemini(prompt, apiKey) {
  try {
    console.log('🔑 Using Gemini API key:', apiKey.substring(0, 10) + '...');
    console.log('🎯 Model: gemini-2.0-flash');

    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });

    console.log('📤 Sending request to Gemini...');
    const result = await model.generateContent(prompt);
    const response = await result.response;
    const text = response.text();

    console.log('✅ Gemini response received:', text.substring(0, 100) + '...');
    return text;
  } catch (error) {
    console.error('❌ Gemini API Error Details:', {
      message: error.message,
      status: error.status,
      statusText: error.statusText
    });
    throw new Error(`Gemini API Error: ${error.message}`);
  }
}

// ChatGPT (OpenAI) implementation
async function generateWithChatGPT(prompt, apiKey) {
  try {
    const response = await axios.post('https://api.openai.com/v1/chat/completions', {
      model: 'gpt-4.1-mini',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.7,
      max_tokens: 4000
    }, {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      }
    });

    return response.data.choices[0].message.content;
  } catch (error) {
    if (error.response) {
      throw new Error(`ChatGPT API Error: ${error.response.data.error.message}`);
    }
    throw new Error(`ChatGPT API Error: ${error.message}`);
  }
}

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'Server is running',
    timestamp: new Date().toISOString()
  });
});

// Helper: Load README files from local folder
function loadProjectReadmes() {
  try {
    console.log('📖 Loading project README files...');
    
    // Define paths to README files
    const resumeOptimizerPath = path.join(__dirname, 'project-readmes', 'Resume-Optimizer-AI-README.md');
    const cifar10Path = path.join(__dirname, 'project-readmes', 'CIFAR10-README.md');
    
    let resumeOptimizerContent = '';
    let cifar10Content = '';
    
    // Load Resume Optimizer AI README
    if (fs.existsSync(resumeOptimizerPath)) {
      resumeOptimizerContent = fs.readFileSync(resumeOptimizerPath, 'utf8');
      console.log(`✅ Loaded Resume Optimizer AI README (${resumeOptimizerContent.length} chars)`);
    } else {
      console.log('⚠️ Resume Optimizer AI README not found at:', resumeOptimizerPath);
      resumeOptimizerContent = 'README file not found';
    }
    
    // Load CIFAR-10 README
    if (fs.existsSync(cifar10Path)) {
      cifar10Content = fs.readFileSync(cifar10Path, 'utf8');
      console.log(`✅ Loaded CIFAR-10 README (${cifar10Content.length} chars)`);
    } else {
      console.log('⚠️ CIFAR-10 README not found at:', cifar10Path);
      cifar10Content = 'README file not found';
    }
    
    return {
      resumeOptimizerReadme: resumeOptimizerContent,
      cifar10Readme: cifar10Content
    };
    
  } catch (error) {
    console.error('❌ Error loading README files:', error.message);
    return {
      resumeOptimizerReadme: 'Error loading README',
      cifar10Readme: 'Error loading README'
    };
  }
}

// Helper: Extract company and position from job description
async function extractJobDetails(jobDescription, aiProvider, apiKey) {
  try {
    console.log('🔍 Extracting company and position from job description...');
    console.log('🔍 JD Preview (first 500 chars):');
    console.log(jobDescription.substring(0, 500));
    console.log('...\n');

    const extractionPrompt = `You must extract ONLY the company name and job position from this job description.
  
  JOB DESCRIPTION:
  ${jobDescription.substring(0, 3000)}
  
  Your response must be EXACTLY in this format with nothing else:
  COMPANY: [company name here]
  POSITION: [job title here]
  
  Example:
  COMPANY: Microsoft
  POSITION: Senior Software Engineer
  
  Now extract the company and position from the job description above. Output ONLY those two lines.`;

    console.log('🔍 Calling AI for extraction...');
    const response = await generateAIContent(extractionPrompt, aiProvider, apiKey);

    console.log('\n🔍 FULL AI EXTRACTION RESPONSE:');
    console.log('═'.repeat(60));
    console.log(response);
    console.log('═'.repeat(60));
    console.log('\n');

    let company = 'N/A';
    let position = 'N/A';

    // Method 1: Try exact pattern match
    console.log('🔍 Trying regex extraction...');
    const companyMatch = response.match(/COMPANY:\s*(.+?)(?:\n|$)/i);
    if (companyMatch && companyMatch[1]) {
      company = companyMatch[1].trim();
      console.log(`   ✅ Regex found company: "${company}"`);
    } else {
      console.log('   ❌ Regex did NOT find company pattern');
    }

    const positionMatch = response.match(/POSITION:\s*(.+?)(?:\n|$)/i);
    if (positionMatch && positionMatch[1]) {
      position = positionMatch[1].trim();
      console.log(`   ✅ Regex found position: "${position}"`);
    } else {
      console.log('   ❌ Regex did NOT find position pattern');
    }

    // Method 2: If still N/A, try parsing line by line
    if (company === 'N/A' || position === 'N/A') {
      console.log('⚠️ Regex failed, trying line-by-line parsing...');
      const lines = response.split('\n');

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        console.log(`   Line ${i}: "${line}"`);

        if (company === 'N/A' && line.toLowerCase().includes('company')) {
          const parts = line.split(':');
          if (parts.length >= 2) {
            company = parts.slice(1).join(':').trim();
            console.log(`   ✅ Found company in line ${i}: "${company}"`);
          }
        }

        if (position === 'N/A' && line.toLowerCase().includes('position')) {
          const parts = line.split(':');
          if (parts.length >= 2) {
            position = parts.slice(1).join(':').trim();
            console.log(`   ✅ Found position in line ${i}: "${position}"`);
          }
        }
      }
    }

    // Method 3: Extract from original JD if AI completely failed
    if (company === 'N/A' || position === 'N/A') {
      console.log('⚠️ AI extraction completely failed, parsing JD directly...');
      const jdLines = jobDescription.split('\n').slice(0, 30);

      for (let i = 0; i < jdLines.length; i++) {
        const line = jdLines[i].trim();

        if (!line || line.length < 3) continue;

        console.log(`   JD Line ${i}: "${line.substring(0, 80)}..."`);

        // Find position (usually first meaningful line with job-related keywords)
        if (position === 'N/A' && line.length > 5 && line.length < 100) {
          const jobKeywords = /engineer|developer|architect|manager|analyst|specialist|lead|senior|director|consultant|designer/i;
          if (jobKeywords.test(line) && !line.toLowerCase().includes('company') && !line.toLowerCase().includes('location')) {
            position = line;
            console.log(`   ✅ Found position from JD line ${i}: "${position}"`);
          }
        }

        // Find company
        if (company === 'N/A') {
          // Try common patterns
          if (line.match(/^Company:\s*(.+)/i)) {
            company = line.match(/^Company:\s*(.+)/i)[1].trim();
            console.log(`   ✅ Found company from JD line ${i}: "${company}"`);
          } else if (line.match(/^Employer:\s*(.+)/i)) {
            company = line.match(/^Employer:\s*(.+)/i)[1].trim();
            console.log(`   ✅ Found company from JD line ${i}: "${company}"`);
          } else if (line.match(/\bat\s+([A-Z][A-Za-z\s&.]{2,30})(?:\s|$)/)) {
            const match = line.match(/\bat\s+([A-Z][A-Za-z\s&.]{2,30})(?:\s|$)/);
            company = match[1].trim();
            console.log(`   ✅ Found company from JD line ${i}: "${company}"`);
          }
        }

        if (company !== 'N/A' && position !== 'N/A') {
          break;
        }
      }
    }

    console.log('\n📊 FINAL EXTRACTION RESULT:');
    console.log(`   🏢 Company: "${company}"`);
    console.log(`   💼 Position: "${position}"\n`);

    return { company, position };

  } catch (error) {
    console.error('❌ Failed to extract job details:', error.message);
    console.error('Error stack:', error.stack);
    return { company: 'N/A', position: 'N/A' };
  }
}

// Helper: AI-powered ATS detection and strategy
async function detectATSAndStrategy(jobUrl, jobDescription, aiProvider, apiKey) {
  try {
    console.log('🤖 AI analyzing job portal and creating optimization strategy...');

    const detectionPrompt = `You are an expert ATS (Applicant Tracking System) analyst. Analyze this job posting and determine the best optimization strategy.

JOB URL: ${jobUrl || 'Manual Input - No URL provided'}

JOB DESCRIPTION:
${jobDescription.substring(0, 4000)}

YOUR TASK:
1. Detect which ATS/job portal system this is (Workday, Greenhouse, Lever, LinkedIn, Indeed, Taleo, company career page, etc.)
2. Understand that portal's scoring algorithm and preferences
3. Create a winning strategy to achieve 100% match and get shortlisted

ANALYZE:
- URL patterns and domain
- Job description formatting and structure
- Application portal indicators
- Company size and typical ATS choice
- Any mentions of application systems in footer/header
- Portal-specific features (Easy Apply, Quick Apply, etc.)

RESPOND IN THIS FORMAT:

PORTAL: [Name of the ATS/portal system]

PORTAL_TYPE: [Workday / Greenhouse / Lever / LinkedIn / Indeed / Taleo / Custom Career Page / Other]

CONFIDENCE: [High / Medium / Low]

ALGORITHM_INSIGHTS:
[Explain how this portal's AI/algorithm scores resumes - what does it prioritize? Keywords? Metrics? Experience? Format?]

WINNING_STRATEGY:
[Detailed strategy on how to optimize resume specifically for THIS portal to guarantee shortlisting - be specific about what works best for this system]

CRITICAL_SUCCESS_FACTORS:
[List 5-7 most important things that will make resume score 100% on this portal]

AVOID:
[What NOT to do for this specific portal]

Think deeply and give your absolute best analysis. A candidate's career depends on this!`;

    const analysis = await generateAIContent(detectionPrompt, aiProvider, apiKey);
    console.log('✅ AI ATS Analysis Complete');
    console.log('📊 Analysis:\n', analysis);

    // Extract portal name from response
    const portalMatch = analysis.match(/PORTAL:\s*(.+?)(?:\n|$)/i);
    const portalName = portalMatch ? portalMatch[1].trim() : 'Job Portal';

    return {
      portalName: portalName,
      fullAnalysis: analysis
    };

  } catch (error) {
    console.log('⚠️ ATS detection failed:', error.message);
    return {
      portalName: 'Job Portal',
      fullAnalysis: 'Unable to detect specific portal. Optimizing for universal ATS compatibility.'
    };
  }
}



// Helper: AI-powered resume selection based on JD analysis
async function selectBestResume(jobDescription, aiProvider, apiKey) {
  try {
    console.log('🎯 Asking AI which resume is best for this JD...');

    // Replace the selectBestResume function's selectionPrompt with this:

const selectionPrompt = `You are an expert resume strategist. Analyze this job description and determine which specialized resume would be BEST to use as the base for optimization.

JOB DESCRIPTION:
${jobDescription.substring(0, 4000)}

AVAILABLE RESUME TYPES (ONLY 2 OPTIONS):
1. FRONTEND Resume: Specialized for pure frontend/UI roles
   - Use when: 70%+ of JD focuses on React, Angular, Vue, UI/UX, CSS, frontend frameworks
   - Examples: "Frontend Developer", "UI Engineer", "React Developer"

2. FULLSTACK Resume: Balanced backend + frontend + cloud
   - Use when: Role requires backend AND frontend, or unclear focus, or mentions full stack
   - Examples: "Full Stack Developer", "Software Engineer", "Java Developer"

ANALYSIS INSTRUCTIONS:
1. Read job title carefully
2. Count frontend vs backend vs cloud mentions in requirements
3. Determine PRIMARY daily focus (what will candidate spend 60%+ time doing?)
4. When in doubt → choose FULLSTACK (it's safer)

SELECTION RULES:
- If JD says "Frontend Developer" or "React Developer" → FRONTEND
- If JD says "Full Stack" or lists both backend AND frontend → FULLSTACK  
- If JD is unclear or mixed → FULLSTACK
- If JD mentions Spring Boot, microservices, APIs heavily → FULLSTACK

RESPOND IN THIS EXACT FORMAT (no other text):

SELECTED_RESUME: [FRONTEND / FULLSTACK]

CONFIDENCE: [High / Medium / Low]

REASONING: [2-3 sentences explaining why this resume is the best choice]

KEY_SKILLS_MATCH: [List 3-5 key skills from JD that match this resume type]

Be decisive. Choose the resume that gives the candidate the BEST chance of getting an interview.`;
    const analysis = await generateAIContent(selectionPrompt, aiProvider, apiKey);
    console.log('📊 Resume Selection Analysis:\n', analysis);

    // Extract selected resume from response
    const resumeMatch = analysis.match(/SELECTED_RESUME:\s*(FRONTEND|FULLSTACK)/i);
    const selectedResume = resumeMatch ? resumeMatch[1].toUpperCase() : 'FULLSTACK';
    
    const confidenceMatch = analysis.match(/CONFIDENCE:\s*(High|Medium|Low)/i);
    const confidence = confidenceMatch ? confidenceMatch[1] : 'Medium';

    const reasoningMatch = analysis.match(/REASONING:\s*(.+?)(?=\n\n|KEY_SKILLS_MATCH:|$)/is);
    const reasoning = reasoningMatch ? reasoningMatch[1].trim() : 'Analysis completed';

    console.log(`\n✅ AI Selected Resume: ${selectedResume}`);
    console.log(`📊 Confidence: ${confidence}`);
    console.log(`💡 Reasoning: ${reasoning}\n`);

    return {
      selectedResume: selectedResume,
      confidence: confidence,
      reasoning: reasoning,
      fullAnalysis: analysis
    };

  } catch (error) {
    console.log('⚠️ Resume selection failed, defaulting to FULLSTACK:', error.message);
    return {
      selectedResume: 'FULLSTACK',
      confidence: 'Low',
      reasoning: 'Selection failed, using full stack as safe default',
      fullAnalysis: 'Selection analysis failed'
    };
  }
}

async function logApplicationToDB({
  companyName,
  position,
  resumeLink,
  jobPostUrl,
  jobDescription
}) {
  const now = new Date();
  const localDate = new Date(now.toLocaleString('en-US', { timeZone: 'America/Chicago' }));
  const today = localDate.toISOString().slice(0, 10);  // ← REPLACE LINE 439 WITH THESE 3 LINES

  // Option B: soft match (company + position + date)
  const existing = await pool.query(
    `
    SELECT id FROM applications
    WHERE company_name = $1
      AND position_applied = $2
      AND date_applied = $3
    LIMIT 1
    `,
    [companyName, position, today]
  );

  if (existing.rows.length > 0) {
    // UPDATE
    await pool.query(
      `
      UPDATE applications
      SET resume_link = $1,
          jd_link = $2,
          jd_text = $3
      WHERE id = $4
      `,
      [
        resumeLink,
        jobPostUrl,
        jobDescription,
        existing.rows[0].id
      ]
    );

    console.log('🟢 Application updated in DB');
    return;
  }

  // INSERT
  await pool.query(
    `
    INSERT INTO applications
    (
      company_name,
      position_applied,
      date_applied,
      resume_link,
      jd_link,
      jd_text
    )
    VALUES ($1, $2, $3, $4, $5, $6)
    `,
    [
      companyName,
      position,
      today,
      resumeLink,
      jobPostUrl,
      jobDescription
    ]
  );

  console.log('🟢 Application inserted into DB');
}


// Helper: Log optimization to Google Sheets
async function logToGoogleSheet(data) {
  try {
    console.log('📊 Step 8: Logging to Google Sheets...');
    console.log('📊 Sheet ID:', TRACKING_SHEET_ID);

    const {
      companyName,
      position,
      resumeLink,
      jobPostUrl,
      contacts,
      fileName
    } = data;

    // Simple date formatting
    const today = new Date();
    const month = String(today.getMonth() + 1).padStart(2, '0');
    const day = String(today.getDate()).padStart(2, '0');
    const year = today.getFullYear();
    const formattedDate = `${month}/${day}/${year}`;

    console.log('📊 Formatted date:', formattedDate);
    console.log('📊 Job Post URL:', jobPostUrl);

    // Get the sheet metadata
    const sheetMetadata = await sheets.spreadsheets.get({
      spreadsheetId: TRACKING_SHEET_ID
    });

    const firstSheetName = sheetMetadata.data.sheets[0].properties.title;
    console.log(`📊 Using sheet: ${firstSheetName}`);

    // Append with USER_ENTERED
    const result = await sheets.spreadsheets.values.append({
      spreadsheetId: TRACKING_SHEET_ID,
      range: `${firstSheetName}!A:F`,
      valueInputOption: 'USER_ENTERED',
      insertDataOption: 'INSERT_ROWS',
      requestBody: {
        values: [[
          companyName || 'N/A',
          position || 'N/A',
          formattedDate,
          resumeLink || '',
          jobPostUrl || 'Manual Input',
          contacts || ''
        ]]
      }
    });

    console.log('✅ Logged to Google Sheets:', result.data.updates.updatedRange);
    return true;

  } catch (error) {
    console.log('❌ Failed to log to Google Sheets:', error.message);
    return false;
  }
}

// Main optimization endpoint
app.post('/api/optimize-resume', async (req, res) => {
  try {
    const {
      jobUrl,
      currentPageUrl,
      aiProvider,
      geminiKey1,
      geminiKey2,
      geminiKey3,
      chatgptApiKey,
      chatgptKey2,
      chatgptKey3,
      manualJobDescription
    } = req.body;

    console.log('\n📥 Request received:', {
      hasJobUrl: !!jobUrl,
      hasCurrentPageUrl: !!currentPageUrl,
      hasManualJD: !!manualJobDescription,
      manualJDLength: manualJobDescription ? manualJobDescription.length : 0,
      aiProvider
    });

    // Determine job post URL for tracking
    const jobPostUrl = currentPageUrl || jobUrl || 'Manual Input';
    console.log('🔗 Job Post URL for tracking:', jobPostUrl);

    // Validation
    const hasManualJD = manualJobDescription && manualJobDescription.trim().length > 0;
    const hasJobUrl = jobUrl && jobUrl.trim().length > 0;

    if (!hasManualJD && !hasJobUrl) {
      return res.status(400).json({
        error: 'Job URL or manual job description is required',
        details: 'Please provide either a job URL or paste the job description manually'
      });
    }

    if (!aiProvider) {
      return res.status(400).json({ error: 'AI provider is required' });
    }

    // Validate API keys
    if (aiProvider === 'gemini') {
      if (!geminiKey1 || !geminiKey2 || !geminiKey3) {
        return res.status(400).json({ error: 'All 3 Gemini API keys are required' });
      }
    } else if (aiProvider === 'chatgpt') {
      if (!chatgptApiKey) {
        return res.status(400).json({ error: 'ChatGPT API key is required' });
      }
    }

    console.log(`\n🚀 Starting optimization with ${aiProvider.toUpperCase()}`);

    let jobDescription;
    let contentSource;

    // PRIORITY 1: Manual JD
    if (hasManualJD) {
      console.log('📝 MODE: MANUAL JD INPUT');
      console.log(`📊 Manual JD length: ${manualJobDescription.length.toLocaleString()} characters`);

      jobDescription = manualJobDescription.trim();
      contentSource = 'manual_input';

      console.log('✅ Using manual job description - SKIPPING URL FETCH');

    }
    // PRIORITY 2: URL Fetch
    else if (hasJobUrl) {
      console.log('🌐 MODE: URL FETCH');
      console.log(`📍 Job URL: ${jobUrl}`);
      contentSource = 'url_fetch';

      // Step 1: Fetch job page
      console.log('📄 Step 1: Fetching job page from URL...');

      let jobResponse;
      let retries = 3;

      for (let i = 0; i < retries; i++) {
        try {
          console.log(`   Attempt ${i + 1}/${retries}...`);

          jobResponse = await axios.get(jobUrl, {
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
              'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
              'Accept-Language': 'en-US,en;q=0.9',
              'Connection': 'keep-alive'
            },
            timeout: 40000,
            maxRedirects: 5,
            maxContentLength: Infinity,
            maxBodyLength: Infinity
          });

          console.log(`✅ Job page fetched (${jobResponse.data.length.toLocaleString()} characters)`);
          break;

        } catch (error) {
          console.log(`   ❌ Attempt ${i + 1} failed:`, error.message);

          if (i === retries - 1) {
            return res.status(500).json({
              error: 'Failed to fetch job page',
              details: `Could not access the job URL after ${retries} attempts. Please try using Manual JD Input mode instead.`
            });
          }

          console.log(`   ⏳ Waiting 2 seconds before retry...`);
          await new Promise(resolve => setTimeout(resolve, 2000));
        }
      }

      // Step 2: Extract job description
      console.log('🤖 Step 2: Extracting job description from HTML...');
      console.log(`   Processing ${jobResponse.data.length.toLocaleString()} characters`);

      const jdPrompt = `Clean this HTML and extract ONLY the job description text.

Remove: HTML tags, CSS, JavaScript, navigation, headers, footers

Output format:
Job Title: [title]
Company: [company]
Location: [location]

[Full job description content]

HTML:
${jobResponse.data}`;

      const extractionKey = aiProvider === 'gemini' ? geminiKey1 : chatgptApiKey;
      const analysisKey = aiProvider === 'gemini' ? geminiKey2 : (chatgptKey2 || chatgptApiKey);
      const rewriteKey = aiProvider === 'gemini' ? geminiKey3 : (chatgptKey3 || chatgptApiKey);

      try {
        jobDescription = await generateAIContent(jdPrompt, aiProvider, extractionKey);
        console.log(`✅ Job description extracted (${jobDescription.length.toLocaleString()} chars)`);
      } catch (error) {
        if (error.message.includes('too large') || error.message.includes('context_length_exceeded')) {
          return res.status(413).json({
            error: 'Job page too large',
            details: 'Please use Manual JD Input mode instead.'
          });
        }
        throw error;
      }
    }

    console.log(`\n📊 CONTENT SOURCE: ${contentSource}`);
    console.log(`📝 Final JD length: ${jobDescription.length.toLocaleString()} characters\n`);

    // Step 3.5: Extract company and position
    console.log('🔍 Step 3.5: Extracting job details...');
    const extractionKey = aiProvider === 'gemini' ? geminiKey1 : chatgptApiKey;
    const jobDetails = await extractJobDetails(jobDescription, aiProvider, extractionKey);
    let companyName = jobDetails.company;
    let position = jobDetails.position;

    console.log(`\n📊 Extracted Job Details:`);
    console.log(`   🏢 Company: ${companyName}`);
    console.log(`   💼 Position: ${position}\n`);

    // Step 3.6: AI-powered ATS detection and strategy
    console.log('🤖 Step 3.6: AI analyzing job portal and creating strategy...');
    const atsAnalysis = await detectATSAndStrategy(
      jobPostUrl,
      jobDescription,
      aiProvider,
      extractionKey
    );

    console.log(`\n🎯 Portal Analysis:`);
    console.log(`   📱 Portal: ${atsAnalysis.portalName}`);
    console.log(`   📊 Strategy Created\n`);

    // Step 3.7: AI-powered resume selection
    console.log('🎯 Step 3.7: AI selecting best resume for this JD...');
    const resumeSelection = await selectBestResume(
      jobDescription,
      aiProvider,
      extractionKey
    );

    // Map selected resume to document ID
    let selectedResumeId;
    let resumeType;
    
    switch (resumeSelection.selectedResume) {
      case 'FRONTEND':
        selectedResumeId = FRONTEND_RESUME_DOC_ID;
        resumeType = 'Frontend Resume';
        break;
      case 'FULLSTACK':
        selectedResumeId = FULLSTACK_RESUME_DOC_ID;
        resumeType = 'Full Stack Resume';
        break;
      default:
        selectedResumeId = FULLSTACK_RESUME_DOC_ID;
        resumeType = 'Full Stack Resume';
        break;
    }

    console.log(`\n📄 Resume Selection:`);
    console.log(`   🎯 Selected: ${resumeSelection.selectedResume}`);
    console.log(`   📊 Confidence: ${resumeSelection.confidence}`);
    console.log(`   📋 Using: ${resumeType}`);
    console.log(`   🆔 Document ID: ${selectedResumeId}`);
    console.log(`   💡 Reasoning: ${resumeSelection.reasoning}\n`);

    // Step 4: Get selected resume
    console.log(`📋 Step 4: Fetching ${resumeType}...`);
    const resumeDoc = await docs.documents.get({
      documentId: selectedResumeId
    });
    const originalResume = extractTextFromDoc(resumeDoc.data);
    console.log(`✅ Resume fetched (${originalResume.length} chars)`);

    // Step 5: Generate optimization points
    console.log('💡 Step 5: Generating optimization points...');

    // Replace the optimizationPrompt variable with this:

// Replace the optimizationPrompt variable with this:
const projectReadmes = loadProjectReadmes();

// ====================================================
// UPDATED OPTIMIZATION PROMPT (Replace lines 794-1054)
// ====================================================

const optimizationPrompt = `You are a senior resume strategist specializing in making resumes look HUMAN-WRITTEN while strategically matching job requirements.

====================================================
CRITICAL CONTEXT
====================================================

The candidate has 90%+ ATS scores but ZERO interview responses.
Problem: Resumes look AI-generated and keyword-stuffed.
Solution: Make strategic, HUMAN changes that build trust with recruiters.

====================================================
INPUTS
====================================================

RESUME TYPE: ${resumeType}

CURRENT RESUME:
${originalResume}

JOB DESCRIPTION:
${jobDescription}
Extract all relevant information from the job description like required skills, preferred skills, responsibilities, tools/technologies, soft skills, domain keywords, industry terms.
Compare with the current resume including BOTH Experience and Projects sections.

PORTAL: ${atsAnalysis.portalName}

Project Readmes:
${projectReadmes.resumeOptimizerReadme}
${projectReadmes.cifar10Readme}

====================================================
YOUR MISSION
====================================================

Generate 8-25 strategic optimization points that:
✅ Add missing JD skills NATURALLY to Experience, Projects, and Skills sections
✅ Reorder bullets to highlight most relevant experience first
✅ Keep every change 100% interview-defensible
✅ Make resume look human-written, not AI-generated
✅ Target 85-92% ATS match (NOT 100% - that looks fake)
✅ Make it need to be at least 85% ATS match
Note: don't add soft skills, domain keywords, industry terms in the skills section.

====================================================
SKILL ADDITION STRATEGY (CRITICAL)
====================================================

FOR EVERY MISSING SKILL IN JD:

1. **Add to Skills Section**
   - FIRST: Try to fit into EXISTING categories (minimize category count)
   - ONLY create new category if skill truly doesn't fit anywhere
   - Format: plain text, comma-separated, no bold
   
   **Category Placement Rules:**
   - If new category needed AND JD heavily emphasizes it → Place HIGH (2nd-3rd position)
   - If new category needed AND JD mentions as nice-to-have → Place LOW (near end)
   - Default position: After related categories logically
   
   **Category Naming:**
   - Use descriptive names for ATS + human readability
   - Format: "Category Name & Related:" (use "&" not "and")
   - Examples: "Machine Learning & AI:", "Cloud & DevOps:", "Testing & Quality Assurance:"
   - DON'T use abbreviations: "ML/AI" → use "Machine Learning & AI"
   
   **Fitting Skills into Existing Categories (Minimize New Categories):**
   - OAuth2, JWT, SAML → "Backend" (not new "Security" category)
   - Redis, Memcached → "Databases & Messaging" (not new "Caching" category)
   - Prometheus, Grafana → "Testing, Monitoring & Security" (not new "Observability" category)
   - GraphQL → "Backend" (not new "API" category)
   - Tailwind, Sass → "Frontend" (not new "CSS" category)

2. **Add to Experience OR Projects Section** 
   - **PRIORITIZE PROJECTS** if the skill is better suited for project work (e.g., ML models, AI automation, full-stack side projects)
   - Choose Experience if skill fits existing work responsibilities
   - Choose the company/project where it's MOST REALISTIC
   - Add naturally to an existing bullet OR create new bullet
   - Make it sound like you actually used it
   - Use specific context (project name, metric, outcome)
   - **BOLD the skill name** when adding to bullets (helps ATS + recruiter scanning)
   - Example: "Built event-driven microservices using **Spring Boot** and **Apache Kafka**"

SKILL ADDITION RULES:

**Required Skills (JD says "required" or "must have"):**
- MUST add to Skills section
- MUST add to Experience OR Projects (at most realistic location)
- High priority - make it prominent

**Nice-to-Have Skills (JD says "preferred" or "nice to have"):**
- MUST add to Skills section
- MUST add to Experience OR Projects (at most realistic location)
- Lower priority - can be subtle mention

**Realistic Placement by Section:**

**Experience Section:**
- LPL Financial (current): Cloud, modern frameworks, recent technologies
- Athenahealth: Healthcare tech, FHIR, compliance, data security
- YES Bank: Payments, banking, security, transaction processing
- Comcast: Media, streaming, content delivery, scalability

**Projects Section:**
- Resume Optimizer AI: Full-stack development, AI/ML integration, Chrome extensions, Google APIs, Node.js, PostgreSQL, automation
- CIFAR-10 ML Project: PyTorch, TensorFlow, deep learning, CNNs, data augmentation, model optimization

EXAMPLES OF NATURAL SKILL ADDITION:

❌ BAD (keyword stuffing):
"Implemented microservices using Spring Boot, Kafka, Redis, Docker, Kubernetes, Jenkins"

✅ GOOD (natural integration with JD skills bolded):
"Built event-driven microservices using **Spring Boot** and **Apache Kafka**, processing 2M+ daily transactions with **Redis** caching for sub-200ms response times"

❌ BAD (obvious addition):
"Worked with React, Angular, Vue, and Next.js for frontend development"

✅ GOOD (specific context with JD skills bolded):
"Migrated legacy Angular application to **React 18** with **TypeScript**, reducing bundle size by 40% and improving load time to under 2 seconds"

**Bold Formatting Rules:**
- ONLY bold skills that appear in the JD
- Bold the skill name, not the entire phrase
- Examples: "**Spring Boot**", "**Kafka**", "**React 18**", "**PostgreSQL**"
- Don't bold common words: "using", "with", "implementing"
- Don't bold in Skills section (plain text only there)

====================================================
PROJECTS SECTION OPTIMIZATION
====================================================

**Projects are a COMPETITIVE ADVANTAGE - use them strategically to maximize selection probability**

The candidate has TWO powerful projects that demonstrate real skills:
1. Resume Optimizer AI: Full-stack Chrome extension with AI integration, Node.js backend, PostgreSQL, Google APIs
2. CIFAR-10 ML Project: Deep learning with PyTorch, CNNs, model optimization, training pipelines

**Your Strategic Mission:**
Analyze the JD requirements and intelligently leverage these projects to fill skill gaps, demonstrate capabilities, and maximize interview selection chances.

**Strategic Thinking Framework:**

1. **Identify JD Skill Gaps**: Which required/preferred skills are missing or weak in the work experience?

2. **Evaluate Project Fit**: For each missing skill, ask:
   - Could this skill realistically be demonstrated in Resume Optimizer AI? (Full-stack, AI APIs, databases, automation, Chrome dev)
   - Could this skill realistically be demonstrated in CIFAR-10 project? (ML/AI, PyTorch, TensorFlow, data processing, model optimization)
   - Would adding it to work experience be unrealistic or questionable?

3. **Maximize Competitive Advantage**: 
   - If a JD skill can be showcased through projects AND it strengthens the candidate's story → USE PROJECTS
   - Projects prove you build real things outside of work (highly valued)
   - Projects can demonstrate bleeding-edge skills not yet used at work

4. **Maintain Authenticity**: 
   - Only add skills that genuinely fit the project's scope
   - Each project can have 3-5 bullets
   - Bold JD-mentioned technologies in project bullets
   - Include metrics and concrete outcomes

**Strategic Examples:**

If JD requires: "Experience with PyTorch, TensorFlow, deep learning"
→ This is PERFECT for CIFAR-10 project - emphasize these in project bullets
→ Adds massive credibility because you actually built this

If JD requires: "Chrome extension development, REST APIs, PostgreSQL"
→ This is PERFECT for Resume Optimizer AI - showcase these capabilities
→ Demonstrates full-stack skills beyond typical job requirements

If JD requires: "Microservices, Spring Boot, Kafka"
→ Already strong in work experience, may not need project reinforcement
→ But if JD heavily emphasizes these, can add to Resume Optimizer backend if realistic

**Optimization Approach:**
Think strategically about how to position this candidate as the BEST FIT for the role. Use projects to:
- Fill skill gaps that work experience doesn't cover
- Demonstrate initiative and continuous learning
- Show hands-on experience with modern/emerging technologies
- Prove ability to build complete solutions end-to-end

The goal: Make the resume impossible to ignore by strategically showcasing ALL relevant skills across Experience AND Projects sections.

====================================================
BULLET REORDERING STRATEGY
====================================================

**ALWAYS move most JD-relevant bullet to position #1 at each company/project**

Recruiters spend 6 seconds scanning - first 2 bullets matter most.

Example:
If JD emphasizes "Kafka event streaming":
- Current order: 1,2,3,4,5,6
- New order: 3,1,2,5,4,6 (if bullet #3 is about Kafka)

====================================================
HUMANIZATION RULES (NON-NEGOTIABLE)
====================================================

1. **Vary Action Verbs**
   - Use: Architected, Built, Developed, Engineered, Created, Designed, Implemented
   - Don't use "Implemented" more than 3 times in entire resume
   - Don't start consecutive bullets with same verb

2. **Natural Metrics**
   - Only 40-50% of bullets should have metrics
   - Use round numbers: 40%, 2M+, 99.9% (not 43.7% or 2.3M)
   - Mix quantitative and qualitative impact

3. **Conversational Tech Language**
   - Use real tech terms: Spring Boot, Kafka, React, PostgreSQL
   - Avoid buzzwords: "cutting-edge", "revolutionary", "synergized"
   - Sound like an engineer talking to another engineer

4. **Realistic Bullet Structure**
   - Mix short (1 line) and long (2 lines) bullets
   - Some bullets describe scope without metrics
   - Vary technical depth (some simple, some detailed)

====================================================
WHAT NOT TO CHANGE (ABSOLUTE RULES)
====================================================

❌ Company names, dates, job titles in Experience section
❌ Number of companies (keep all 4)
❌ Project names or core technologies
❌ Certifications
❌ Education
❌ Contact information
❌ Resume shouldn't exceed 2 pages

====================================================
OPTIMIZATION POINT FORMAT
====================================================

POINT 1:
Type: ADD_SKILL
Skill: Apache Flink
Where_Skills: Databases & Messaging (existing category)
Where_Experience_Or_Project: LPL Financial, Bullet 3
Integration: "Extend existing Kafka bullet to mention **Flink** for stream processing with 500K events/sec throughput"
Bold: YES (Flink is from JD)
Priority: High
Reasoning: JD lists Flink as required skill; fits existing "Databases & Messaging" category; realistic since candidate has Kafka experience at LPL

POINT 2:
Type: REORDER_BULLETS
Section: Experience
Company: Athenahealth
Current_Order: 1,2,3,4,5
New_Order: 4,1,2,3,5
Reasoning: JD emphasizes FHIR APIs - move FHIR bullet to position 1

POINT 3:
Type: ADD_SKILL
Skill: TensorFlow, PyTorch
Where_Skills: AI & Data (existing category)
Where_Experience_Or_Project: Projects - CIFAR-10, Bullet 1
Integration: "Update first bullet to emphasize both **PyTorch** (primary) and **TensorFlow** for model experimentation"
Bold: YES (both are from JD)
Priority: High
Reasoning: JD requires deep learning frameworks; CIFAR-10 project is the PERFECT place to showcase this; more credible than adding to work experience

POINT 4:
Type: ADD_SKILL
Skill: Chrome Extension Development
Where_Skills: Frontend (existing category - add "Chrome Extensions")
Where_Experience_Or_Project: Projects - Resume Optimizer AI, Bullet 1
Integration: "Emphasize **Chrome Extension** development with Manifest V3 in first bullet"
Bold: YES (Chrome extensions from JD)
Priority: High
Reasoning: JD mentions browser extension development; Resume Optimizer project demonstrates this perfectly

POINT 5:
Type: REORDER_BULLETS
Section: Projects
Project: Resume Optimizer AI
Current_Order: 1,2,3,4
New_Order: 2,1,3,4
Reasoning: JD heavily emphasizes PostgreSQL - move database bullet to position 1

====================================================
POINT TYPES YOU CAN USE
====================================================

1. **ADD_SKILL**: Add missing JD skill to Skills and (Experience OR Projects)
2. **REORDER_BULLETS**: Change bullet order at a company or project
3. **MODIFY_BULLET**: Update existing bullet to add skill/context
4. **MERGE_BULLETS**: Combine two bullets (reduces count by 1)
5. **ENHANCE_METRIC**: Make existing metric more specific/impressive

====================================================
QUALITY CHECKLIST
====================================================

Before returning, verify:
□ Added ALL important JD skills to Skills AND (Experience OR Projects)
□ Skills added to most realistic sections (Experience vs Projects)
□ Leveraged Projects section for AI/ML and full-stack skills
□ Reordered bullets to put most relevant first
□ Every change sounds natural and interview-safe
□ No keyword stuffing or robotic patterns
□ Would a recruiter trust this resume?

====================================================
OUTPUT RULES
====================================================

Return 8-25 optimization points ONLY.
NO preamble, explanations, or commentary.
Start directly with "POINT 1:"

Focus on HIGH-IMPACT changes:
- Adding missing JD skills naturally to best section (Experience OR Projects)
- Reordering bullets for relevance
- Subtle wording improvements
- Strategic use of Projects section for competitive advantage

Begin output:
`;


    const analysisKey = aiProvider === 'gemini' ? geminiKey2 : (chatgptKey2 || chatgptApiKey);
    const optimizationPoints = await generateAIContent(optimizationPrompt, aiProvider, analysisKey);
    const pointCount = (optimizationPoints.match(/POINT \d+:/g) || []).length;
    console.log(`✅ Generated ${pointCount} optimization points`);
    console.log(`✅ optimization points -----> ${optimizationPoints} `);
    // Extract filename
    let suggestedFileName = null;
    const filenameMatch = optimizationPoints.match(/FILENAME:\s*(.+?)(?:\n|$)/i);
    if (filenameMatch) {
      suggestedFileName = filenameMatch[1].trim();
      console.log(`📝 Suggested filename: ${suggestedFileName}`);
    }

    // If filename extraction failed, create from company/position
    if (!suggestedFileName && companyName !== 'N/A' && position !== 'N/A') {
      const posClean = position.replace(/[^a-zA-Z0-9\s]/g, '').replace(/\s+/g, '_');
      const compClean = companyName.replace(/[^a-zA-Z0-9\s]/g, '').replace(/\s+/g, '_');
      suggestedFileName = `Sai Kiran ${posClean} ${compClean}`;
      console.log(`📝 Generated filename from extracted data: ${suggestedFileName}`);
    }

    // Step 5: Rewrite resume
    console.log('✍️ Step 5: Rewriting resume...');

    // Replace the rewritePrompt variable with this:

// Replace the rewritePrompt variable with this:

// ====================================================
// UPDATED REWRITE PROMPT (Replace lines 1085-1426)
// ====================================================

const rewritePrompt = `You are a senior technical resume writer. Your mission: Apply optimization points while keeping the resume HUMAN-WRITTEN and INTERVIEW-SAFE.

====================================================
SECTION 1: CRITICAL CONTEXT
====================================================

**The Problem:**
- Candidate applied to 360+ jobs with 90%+ ATS scores
- Got ZERO interview responses
- Issue: Resumes look AI-generated to human recruiters

**Your Solution:**
- Apply optimization points precisely
- Keep resume looking human-written
- Target 85-92% ATS (NOT 100% - that looks fake)
- Prioritize HUMAN TRUST over ATS scores

====================================================
SECTION 2: INPUTS
====================================================

RESUME TYPE: ${resumeType}

ORIGINAL RESUME:
${originalResume}

OPTIMIZATION POINTS TO APPLY:
${optimizationPoints}

JOB DESCRIPTION:
${jobDescription}

PORTAL: ${atsAnalysis.portalName}

====================================================
SECTION 3: MANDATORY STRUCTURE (NON-NEGOTIABLE)
====================================================

Your output MUST follow this EXACT structure:

---RESUME START---

Lokesh Para
Full Stack Developer

paralokesh5@gmail.com | 682-503-1723 | linkedin.com/in/lokeshpara99 | github.com/lokeshpara | lokeshpara.github.io/Portfolio

PROFESSIONAL EXPERIENCE

Java Full Stack Developer | LPL Financial, San Diego, California
June 2025 - Present
• [6-7 bullets depending on resume type]

Java Full Stack Developer | Athenahealth, Boston, MA
August 2024 - May 2025
• [5-6 bullets depending on resume type]

Java Full Stack Developer | YES Bank, Mumbai, India
November 2021 - July 2023
• [5-6 bullets depending on resume type]

Java Developer | Comcast Corporation, Chennai, India
May 2020 - October 2021
• [4-5 bullets depending on resume type]

TECHNICAL SKILLS

[Categories with comma-separated skills]

CERTIFICATIONS

• Oracle Cloud Infrastructure 2025 Certified AI Foundations Associate
• AWS Certified Solutions Architect – Associate

EDUCATION

Master of Science in Computer and Information Sciences
Southern Arkansas University | Magnolia, Arkansas, USA

---RESUME END---

**STRICT RULES:**
❌ Never change: Company names, dates, job titles, contact info
❌ Never add: Summary section, Projects section
❌ Never change: Section order
❌ Never change: Certifications or Education text
✅ Title must be "Full Stack Developer" (never change)

====================================================
SECTION 4: APPLYING OPTIMIZATION POINTS
====================================================

**Apply EXACTLY as specified in optimization points:**

IF point type is "ADD_SKILL":
→ Add skill to Skills section under specified category
→ Add skill to Experience section at specified company/bullet
→ Make integration sound natural and realistic

IF point type is "REORDER_BULLETS":
→ Rearrange bullets in exact order specified
→ Keep all bullet content, just change position

IF point type is "MODIFY_BULLET":
→ Update the specified bullet with new content
→ Keep core message, add specified skills/context

IF point type is "MERGE_BULLETS":
→ Combine two bullets into one coherent bullet
→ Reduces total bullet count by 1

IF point type is "ENHANCE_METRIC":
→ Make existing metric more specific or impressive
→ Keep it realistic (round numbers only)

**DO NOT:**
❌ Make changes not mentioned in optimization points
❌ Add content optimization points didn't request
❌ Remove bullets unless points say to merge
❌ Change structure points didn't mention

====================================================
SECTION 5: HUMANIZATION RULES (CRITICAL)
====================================================

**1. NATURAL LANGUAGE VARIATION**

Action Verb Rotation:
- Use: Architected, Built, Developed, Engineered, Created, Designed, Led, Established, Deployed
- "Implemented" → MAX 2 times total
- "Architected" → MAX 2 times total  
- Never start consecutive bullets with same verb

❌ BAD (robotic):
• Implemented microservices using Spring Boot
• Implemented RESTful APIs with OAuth2
• Implemented event-driven architecture
• Implemented monitoring with Prometheus

✅ GOOD (human, with JD skills bolded):
• Architected microservices ecosystem using **Spring Boot** processing 2M+ daily transactions
• Built RESTful APIs with **OAuth2** authentication integrating Bloomberg market data
• Designed event-driven architecture using **Kafka** with sub-200ms latency
• Established monitoring platform with **Prometheus** reducing incident resolution by 55%

**2. REALISTIC METRICS (40-50% OF BULLETS)**

Metrics Guidelines:
- Only 40-50% of bullets should have metrics
- Use round numbers: 40%, 2M+, 99.9% (not 43.7%, 2.3M)
- Mix of bullets WITH and WITHOUT metrics

Examples:

✅ With metric: "Built microservices using **Spring Boot** processing 2M+ daily transactions with 99.9% uptime"
✅ Without metric: "Engineered RESTful APIs with **OAuth2** authentication integrating market data feeds"
✅ With metric: "Optimized database queries using **PostgreSQL** reducing load time from 4.2s to 1.5s"
✅ Without metric: "Designed event-driven architecture using **Kafka** and **Redis** distributed caching"

**3. CONVERSATIONAL TECH LANGUAGE**

✅ Use real tech terms: Spring Boot, Kafka, React, PostgreSQL, Kubernetes
❌ Avoid buzzwords: "cutting-edge", "revolutionary", "synergized", "leveraged"
❌ Avoid corporate speak: "spearheaded", "championed"

Write like an engineer explaining to another engineer.

**4. NATURAL SENTENCE STRUCTURE**

Vary bullet length and complexity:
- Some short (1 line): "Built GraphQL APIs for mobile banking application"
- Some long (2 lines): "Architected event-driven microservices ecosystem using Spring Boot and Apache Kafka with 10-node cluster processing 2M+ portfolio events daily implementing custom serializers and exactly-once delivery semantics"
- Mix technical depth: some high-level, some detailed

====================================================
SECTION 6: SKILLS SECTION FORMAT
====================================================

Format EXACTLY like this (plain text):

TECHNICAL SKILLS

Category Name: skill1, skill2, skill3, skill4, skill5
Category Name: skill1, skill2, skill3
Category Name: skill1, skill2, skill3, skill4

**Rules:**
- Section header: "TECHNICAL SKILLS" (all caps, no colon)
- Each category: "Category Name: " (with colon and space)
- Skills: comma-separated with spaces
- NO bold text in skills section
- NO bullet points in skills section
- NO tables or special formatting

**Category Management:**
- MINIMIZE categories: fit skills into existing categories whenever possible
- ONLY create new category if skill truly doesn't fit anywhere
- Category names: Descriptive for ATS + humans (e.g., "Machine Learning & AI:" not "ML/AI:")
- Use "&" instead of "and": "Cloud & DevOps:", "Testing & Quality Assurance:"

**Category Placement (when new category needed):**
- If JD heavily emphasizes the new skill → Place HIGH (position 2-3)
- If JD mentions as nice-to-have → Place LOW (near end)
- Default: Place after logically related categories

**Fitting Skills into Existing Categories (examples):**
- OAuth2, JWT, SAML → Add to "Backend Frameworks" (don't create "Security")
- Redis, Memcached → Add to "Databases" (don't create "Caching")
- Prometheus, Grafana → Add to "Monitoring" or "Cloud & DevOps" (don't create "Observability")
- GraphQL → Add to "Backend Frameworks" (don't create "API Technologies")
- Tailwind, Sass → Add to "Frontend Frameworks" (don't create "CSS Frameworks")

**When optimization points specify new category:**
- Place category at position specified (e.g., "after Testing category")
- Use exact category name from optimization points
- Add skills comma-separated like existing categories

====================================================
SECTION 7: EXPERIENCE BULLET BEST PRACTICES
====================================================

RESUME TYPE:
${resumeType}

ORIGINAL RESUME:
${originalResume}

OPTIMIZATION POINTS:
${optimizationPoints}

JOB DESCRIPTION:
${jobDescription}

PORTAL:
${atsAnalysis.portalName}

====================================================
SECTION 8: FORMATTING REQUIREMENTS
====================================================

**Bullets:**
✅ Use "• " (bullet symbol + space) for ALL bullets
❌ Don't use "-", "*", or numbers

**Text Formatting:**
✅ Bold: Section headers (PROFESSIONAL EXPERIENCE, TECHNICAL SKILLS)
✅ Bold: Company names and job titles
✅ Bold: JD-mentioned skills in Experience bullets ONLY
❌ Don't bold: Skills in Skills section (plain text only)
❌ Don't bold: Common words like "using", "with", "implementing"
❌ Don't use italics or underlines

**Bold Formatting Examples for Experience Bullets:**
✅ "Built event-driven microservices using **Spring Boot** and **Apache Kafka**"
✅ "Migrated application to **React 18** with **TypeScript**"
✅ "Implemented **Redis** distributed caching for sub-200ms response times"
❌ "Built event-driven microservices using **Spring Boot and Apache Kafka**" (don't bold entire phrase)
❌ "**Implemented** Redis distributed caching" (don't bold action verbs)

**Spacing:**
✅ One blank line between sections
✅ One blank line between companies
✅ No blank lines between bullets at same company

**Output Format:**
✅ Plain text output
❌ No markdown formatting
❌ No HTML tags
❌ No special characters for formatting

====================================================
SECTION 9: QUALITY CHECKLIST
====================================================

Before returning the resume, verify:

**Structure:**
□ Sections in order: Experience → Skills → Certifications → Education
□ NO Summary or Projects sections
□ Header has "Lokesh Para" and "Full Stack Developer"
□ All 4 companies present with exact names/dates

**Bullets:**
□ LPL Financial: 6-7 bullets (depending on ${resumeType})
□ Athenahealth: 5-6 bullets
□ YES Bank: 5-6 bullets
□ Comcast: 4-5 bullets

**Humanization:**
□ No consecutive bullets start with same verb
□ "Implemented" used MAX 2 times total
□ "Architected" used MAX 2 times total
□ 40-50% of bullets have metrics (not all)
□ Metrics use round numbers (no decimals)
□ Natural language variation
□ NO buzzwords ("cutting-edge", "revolutionary")

**Optimization:**
□ All optimization points applied
□ Skills added to both Skills AND Experience sections
□ Bullets reordered as specified
□ No changes beyond what points requested

**Formatting:**
□ All bullets use "• " symbol
□ JD-mentioned skills are bolded in Experience bullets
□ Skills section has NO bold (plain text only)
□ No bold on common words ("using", "with", "implementing")
□ Only section headers and company names bolded (besides JD skills)
□ Plain text output
□ Proper spacing

**Interview Safety:**
□ Every bullet is defendable in interview
□ No exaggerated claims
□ No unknown technologies mentioned
□ Resume looks human-written

====================================================
SECTION 10: OUTPUT INSTRUCTIONS
====================================================

Return ONLY the complete rewritten resume.

NO preamble like "Here is the resume"
NO explanations or commentary
NO markdown formatting
NO extra text before or after

Start directly with "Lokesh Para"
End with education section

Resume should be ready to copy-paste into Google Doc.

Begin output now:
`;



    const rewriteKey = aiProvider === 'gemini' ? geminiKey3 : (chatgptKey3 || chatgptApiKey);
    const optimizedResume = await generateAIContent(rewritePrompt, aiProvider, rewriteKey);
    console.log(`✅ Resume rewritten (${optimizedResume.length} chars)`);
    console.log(`Rewrite resume ======> ${optimizedResume}`);

    // Step 6: Pick filename
    console.log('📄 Step 6: Preparing template resume doc...')
    let fileName = suggestedFileName
    if (!fileName) {
      const timestamp = new Date().toISOString().replace(/[-:]/g, '').split('.')[0]
      fileName = `SaiKiranP_Optimized_${timestamp}`
    }
    console.log(`📄 Filename: ${fileName}`)

    // Step 7: Copy Google Docs template into your Drive folder
    console.log('📄 Step 7: Copying resume template...')
    const documentId = await copyTemplateDoc({
      drive,
      templateId: SAI_RESUME_TEMPLATE_ID,
      folderId: DRIVE_FOLDER_ID,
      fileName
    })
    
    const meta = await drive.files.get
    ({
      fileId: documentId,
      fields: 'id, name, mimeType'
    })

    console.log('📄 Copied file mimeType:', meta.data.mimeType)

    if (meta.data.mimeType !== 'application/vnd.google-apps.document') {
      throw new Error(`Template copy is not Google Docs. mimeType=${meta.data.mimeType}`)
    }


    const resumeLink = `https://docs.google.com/document/d/${documentId}/edit`
    console.log(`✅ Template copied. Doc ID: ${documentId}`)

    // Step 8: Build placeholder replacements
    console.log('🧩 Step 8: Replacing placeholders...')

    const removeMarker = '[REMOVE]'

    function pickBullet(arr, idx) {
      return idx < arr.length ? arr[idx] : removeMarker
    }

    const payBullets = cleanFixedBullets(resumeJson.PAY_B || [], 'PAY_B', 3)
    const clinBullets = cleanFixedBullets(resumeJson.CLIN_B || [], 'CLIN_B', 3)
    const ragBullets = cleanFixedBullets(resumeJson.RAG_B || [], 'RAG_B', 3)
    const searchBullets = cleanFixedBullets(resumeJson.SEARCH_B || [], 'SEARCH_B', 3)

    const replacements = {
      '{{SUMMARY}}': resumeJson.SUMMARY || '',

      '{{SKILL_1}}': resumeJson.SKILL_1 || '',
      '{{SKILL_2}}': resumeJson.SKILL_2 || '',
      '{{SKILL_3}}': resumeJson.SKILL_3 || '',
      '{{SKILL_4}}': resumeJson.SKILL_4 || '',
      '{{SKILL_5}}': resumeJson.SKILL_5 || '',
      '{{SKILL_6}}': resumeJson.SKILL_6 || '',
      '{{SKILL_7}}': resumeJson.SKILL_7 || '',
      '{{SKILL_8}}': resumeJson.SKILL_8 || '',
      '{{SKILL_9}}': resumeJson.SKILL_9 || '',
      '{{SKILL_10}}': resumeJson.SKILL_10 || '',
      '{{SKILL_11}}': resumeJson.SKILL_11 || '',
      '{{SKILL_12}}': resumeJson.SKILL_12 || '',

      '{{CERT_1}}': resumeJson.CERT_1 || '',
      '{{CERT_2}}': resumeJson.CERT_2 || '',
      '{{CERT_3}}': resumeJson.CERT_3 || '',
      '{{CERT_4}}': resumeJson.CERT_4 || '',

      '{{TRUIST_TECH_STACK}}': resumeJson.TRUIST_TECH_STACK || '',
      '{{ACC_TECH_STACK}}': resumeJson.ACC_TECH_STACK || '',
      '{{HCL_TECH_STACK}}': resumeJson.HCL_TECH_STACK || '',

      '{{EDU_1}}': resumeJson.EDU_1 || 'Southern Arkansas University',
      '{{EDU_2}}': resumeJson.EDU_2 || "Master’s Degree, Computer and Information Science",

      '{{PAY_B1}}': payBullets[0],
      '{{PAY_B2}}': payBullets[1],
      '{{PAY_B3}}': payBullets[2],

      '{{CLIN_B1}}': clinBullets[0],
      '{{CLIN_B2}}': clinBullets[1],
      '{{CLIN_B3}}': clinBullets[2],

      '{{RAG_B1}}': ragBullets[0],
      '{{RAG_B2}}': ragBullets[1],
      '{{RAG_B3}}': ragBullets[2],

      '{{SEARCH_B1}}': searchBullets[0],
      '{{SEARCH_B2}}': searchBullets[1],
      '{{SEARCH_B3}}': searchBullets[2]
    }

    for (let i = 0; i < 10; i++) {
      replacements[`{{TRUIST_B${i + 1}}}`] = pickBullet(truistBullets, i)
      replacements[`{{ACC_B${i + 1}}}`] = pickBullet(accBullets, i)
      replacements[`{{HCL_B${i + 1}}}`] = pickBullet(hclBullets, i)
    }

    await replacePlaceholders({ docs, documentId, replacements })

    // Step 9: Remove extra bullet lines that became [REMOVE]
    await removeMarkedParagraphs({ docs, documentId, marker: removeMarker })

    // Step 10: Apply page formatting
    await setDocumentFormatting(documentId)

    // Step 11: Log to PostgreSQL
    await logApplicationToDB({
      companyName,
      position,
      resumeLink,
      jobPostUrl,
      jobDescription
    })



    res.json({
      success: true,
      status: '✅ Resume Optimized Successfully!',
      aiProvider: aiProvider,
      portalName: atsAnalysis.portalName,
      portalAnalysis: atsAnalysis.fullAnalysis,
      selectedResume: resumeSelection.selectedResume,           // NEW
      resumeType: resumeType,                                   // NEW
      selectionConfidence: resumeSelection.confidence,          // NEW
      selectionReasoning: resumeSelection.reasoning,            // NEW
      keysUsed: aiProvider === 'gemini' ? '3 Gemini keys' : '1 ChatGPT key',
      contentSource: contentSource,
      fileName: fileName,
      companyName: companyName,
      position: position,
      links: {
        editInGoogleDocs: resumeLink,
        downloadPDF: `https://docs.google.com/document/d/${documentId}/export?format=pdf`,
        downloadWord: `https://docs.google.com/document/d/${documentId}/export?format=docx`,
        trackingSheet: `https://docs.google.com/spreadsheets/d/${TRACKING_SHEET_ID}/edit`
      },
      documentId: documentId,
      optimizationPoints: pointCount
    });

  } catch (error) {
    console.error('❌ Error:', error.message);
    res.status(500).json({
      error: 'Resume optimization failed',
      details: error.message
    });
  }
});
// new code
// =====================================================
// TEMPLATE COPY + PLACEHOLDER REPLACE HELPERS (NEW)
// =====================================================

function extractJsonObject(raw) {
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) {
    throw new Error('AI did not return a valid JSON object');
  }
  const jsonStr = raw.slice(start, end + 1);
  return JSON.parse(jsonStr);
}

function cleanAndValidateBullets(arr, label) {
  if (!Array.isArray(arr)) throw new Error(`${label} must be an array`);

  const cleaned = arr
    .map(x => (x || '').toString().trim())
    .filter(x => x.length > 0);

  if (cleaned.length < 8 || cleaned.length > 10) {
    throw new Error(`${label} must have 8 to 10 bullets after cleaning. Got ${cleaned.length}`);
  }
  return cleaned;
}

function cleanFixedBullets(arr, label, exactCount) 
{
  if (!Array.isArray(arr)) throw new Error(`${label} must be an array`);

  const cleaned = arr
    .map(x => (x || "").toString().trim())
    .filter(Boolean);

  // If AI returns more than needed, trim
  if (cleaned.length > exactCount) return cleaned.slice(0, exactCount);

  // If AI returns less, pad with [REMOVE] so placeholders always exist
  while (cleaned.length < exactCount) cleaned.push("[REMOVE]");

  return cleaned;
}


async function copyTemplateDoc({ drive, templateId, folderId, fileName }) {
  const copy = await drive.files.copy({
    fileId: templateId,
    requestBody: {
      name: fileName,
      parents: [folderId],
      mimeType: 'application/vnd.google-apps.document'
    },
    fields: 'id'
  })

  return copy.data.id
}


async function replacePlaceholders({ docs, documentId, replacements }) 
{
  const requests = Object.entries(replacements).map(([key, value]) => ({
    replaceAllText: {
      containsText: { text: key, matchCase: true },
      replaceText: value == null ? '' : String(value)
    }
  }));

  await docs.documents.batchUpdate({
    documentId,
    requestBody: { requests }
  });
}

async function removeMarkedParagraphs({ docs, documentId, marker }) {
  const doc = await docs.documents.get({ documentId })
  const content = (doc.data.body && doc.data.body.content) ? doc.data.body.content : []

  const ranges = []

  for (const el of content) {
    const para = el.paragraph
    if (!para || !para.elements) continue

    const text = para.elements
      .map(e => (e.textRun && e.textRun.content) ? e.textRun.content : '')
      .join('')

    if (text.includes(marker) && el.startIndex != null && el.endIndex != null) {
      ranges.push({ startIndex: el.startIndex, endIndex: el.endIndex })
    }
  }

  if (!ranges.length) return

  const requests = ranges
    .sort((a, b) => b.startIndex - a.startIndex)
    .map(r => ({
      deleteContentRange: {
        range: { startIndex: r.startIndex, endIndex: r.endIndex }
      }
    }))

  await docs.documents.batchUpdate({
    documentId,
    requestBody: { requests }
  })
}



// Helper: Extract text from Google Doc (NO CHANGES NEEDED)
function extractTextFromDoc(doc) {
  let text = '';
  const content = doc.body.content;

  for (const element of content) {
    if (element.paragraph?.elements) {
      for (const elem of element.paragraph.elements) {
        if (elem.textRun) text += elem.textRun.content;
      }
    }
    if (element.table) {
      for (const row of element.table.tableRows) {
        for (const cell of row.tableCells) {
          for (const cellContent of cell.content) {
            if (cellContent.paragraph?.elements) {
              for (const elem of cellContent.paragraph.elements) {
                if (elem.textRun) text += elem.textRun.content;
              }
            }
          }
          text += '\t';
        }
        text += '\n';
      }
    }
  }
  return text;
}

// ============================================================================
// HTML CONVERSION - CERTIFICATIONS AS PLAIN TEXT (NO BULLETS)
// ============================================================================

// ============================================================================
// UPDATED HTML CONVERSION WITH BOLD SUPPORT FOR JD SKILLS
// ============================================================================

// REPLACE the convertToStyledHTML function in your server.js with this version:

function convertToStyledHTML(text) {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);

  // Converts **skill** markers from AI output into bold in HTML
  function processBoldText(s) {
    return s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  }

  function isSectionHeader(line) {
    const u = line.toUpperCase();
    return [
      'PROFESSIONAL SUMMARY',
      'TECHNICAL SKILLS',
      'CERTIFICATIONS & AWARDS',
      'PROFESSIONAL EXPERIENCE',
      'KEY PROJECTS',
      'EDUCATION'
    ].includes(u);
  }

  // Header parsing
  // Expected first non-empty lines:
  // 0 Name
  // 1 Title
  // 2 Contact line
  const headerName = lines[0] || '';
  const headerTitle = lines[1] || '';
  const headerContact = lines[2] || '';

  let html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>
  * { margin: 0; padding: 0; }

  body {
    font-family: "Times New Roman", Times, serif;
    font-size: 10pt;
    line-height: 1.0;
    margin: 0.25in 0.5in 0.5in 0.5in;
    color: #000;
  }

  .name {
    font-size: 14pt;
    font-weight: bold;
    text-align: center;
    margin-bottom: 2pt;
  }

  .title {
    font-size: 12pt;
    font-weight: bold;
    text-align: center;
    margin-bottom: 2pt;
  }

  .contact {
    font-size: 10pt;
    font-weight: bold;
    text-align: center;
    margin-bottom: 6pt;
  }

  .section-header {
    font-size: 10pt;
    font-weight: bold;
    text-transform: uppercase;
    margin-top: 10pt;
    margin-bottom: 4pt;
  }

  
  
  /* Company Header - Bold */
  .company-header {
    font-size: 11pt;
    font-weight: bold;
    margin-top: 8pt;
    margin-bottom: 2pt;
  }
  
  /* Job Date - Italic */
  .job-date {
    font-size: 11pt;
    margin-bottom: 4pt;
  }
  
  /* Bullet List - For experience only */
  ul {
    margin: 0 0 2pt 0.25in;
    padding: 0;
    list-style-type: disc;
    list-style-position: outside;
  }

  li {
    margin: 2pt 0;
    padding-left: 0.05in;
    text-align: left;
    line-height: 1.0;
  }

  .skills-line {
    margin: 2pt 0;
    text-align: left;
  }

  .cert-line {
    margin: 2pt 0;
    text-align: left;
  }

  .project-title {
    font-weight: bold;
    margin-top: 6pt;
    margin-bottom: 2pt;
  }
  </style></head><body>`;

  // Render header
  html += `<div class="name">${processBoldText(headerName)}</div>`;
  html += `<div class="title">${processBoldText(headerTitle)}</div>`;
  html += `<div class="contact">${processBoldText(headerContact)}</div>`;

  // Start reading body after header
  let i = 3;

  let inSkills = false;
  let inCerts = false;
  let inExperience = false;
  let inProjects = false;
  let inEducation = false;
  let currentBulletList = [];

  function flushBullets() {
    if (currentBulletList.length > 0) {
      html += '<ul>\n';
      for (const bullet of currentBulletList) {
        // Process bold text in bullets
        const processedBullet = processBoldText(bullet);
        html += `<li>${processedBullet}</li>\n`;
      }
      html += '</ul>\n';
      currentBulletList = [];
    }
  }

  // Helper: Convert contact links
  function convertContactLinks(text) {
    text = text.replace(
      /linkedin\.com\/in\/lokeshpara99/gi,
      '<a href="https://linkedin.com/in/lokeshpara99">LinkedIn</a>'
    );
    
    text = text.replace(
      /github\.com\/lokeshpara/gi,
      '<a href="https://github.com/lokeshpara">GitHub</a>'
    );
    
    text = text.replace(
      /lokeshpara\.github\.io\/Portfolio/gi,
      '<a href="https://lokeshpara.github.io/Portfolio">Portfolio</a>'
    );
    
    return text;
  }

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i].trim();
    if (!line) continue;

    // NAME
    if (i === 0 || (i < 3 && line.toUpperCase().includes('LOKESH'))) {
      flushBullets();
      html += `<div class="name">${line}</div>\n`;
      continue;
    }

    // TITLE
    if (i <= 3 && (line.includes('Full Stack') || line.includes('Developer')) && !line.includes('|')) {
      flushBullets();
      html += `<div class="title">${line}</div>\n`;
      continue;
    }

    // Experience company line
    // Example: Software Engineer | Truist Bank - USA | Aug 2024 - Present
    if (inExperience && line.includes('|') && !line.startsWith('•')) {
      flushBullets();
      html += `<div class="company-line">${processBoldText(line)}</div>`;
      i += 1;
      continue;
    }

    // SECTION HEADERS
    if (line === line.toUpperCase() && line.length > 3 && !line.startsWith('•')) {
      if (line.includes('PROFESSIONAL EXPERIENCE') ||
          line.includes('TECHNICAL SKILLS') ||
          line.includes('EDUCATION') ||
          line.includes('CERTIFICATIONS')) {
        
        flushBullets();
        html += `<div class="section-header">${line}</div>\n`;
        
        inSkills = line.includes('SKILL');
        inCertifications = line.includes('CERTIFICATION');
        inEducation = line.includes('EDUCATION');
        continue;
      }
    }

    // PROJECT HEADER (detect project names)
    if (inProjects && 
        !inSkills && 
        !inEducation && 
        !inCertifications &&
        !line.startsWith('•') &&
        !line.startsWith('GitHub:') &&
        !line.startsWith('Technologies:') &&
        (line.includes('Resume Optimizer') || 
         line.includes('CIFAR-10') || 
         line.includes('CIFAR10') ||
         line.includes('Chrome Extension') ||
         line.includes('Image Classification'))) {
      flushBullets();
      const projectWithLink = convertProjectNameToLink(line);
      html += `<div class="project-header">${projectWithLink}</div>\n`;
      continue;
    }

    // PROJECT SUBHEADER (GitHub: or Technologies: line)
    if (inProjects && 
        !inSkills && 
        !inEducation && 
        !inCertifications &&
        !line.startsWith('•') &&
        (line.startsWith('GitHub:') || line.startsWith('Technologies:'))) {
      flushBullets();
      const projectLinksConverted = convertProjectLinks(line);
      html += `<div class="project-subheader">${projectLinksConverted}</div>\n`;
      continue;
    }

    // COMPANY HEADER
    if (line.includes('|') && 
        !line.startsWith('•') && 
        !line.includes('@') && 
        !inSkills &&
        !inEducation &&
        !inCertifications &&
        (line.includes('Developer') || line.includes('Engineer') || 
         line.includes('LPL') || line.includes('Athenahealth') || 
         line.includes('YES Bank') || line.includes('Comcast'))) {
      flushBullets();
      html += `<div class="company-header">${line}</div>\n`;
      continue;
    }

    // JOB DATE
    if ((line.includes('Present') || 
         line.match(/^(January|February|March|April|May|June|July|August|September|October|November|December)/i) ||
         line.match(/^\w+\s+\d{4}\s*[-–]\s*/)) && 
        !line.startsWith('•') &&
        !inSkills &&
        !inEducation &&
        !inCertifications) {
      flushBullets();
      html += `<p class="skills-line">${processBoldText(line)}</p>`;
      i += 1;
      continue;
    }

    // SKILLS SECTION - NO BOLD (plain text only)
    if (inSkills && !inCertifications && !inEducation) {
      flushBullets();
      html += `<p class="cert-line">${processBoldText(line.replace(/^[•*-]\s*/, ''))}</p>`;
      i += 1;
      continue;
    }

    // CERTIFICATIONS SECTION - NO BULLETS, PLAIN TEXT
    if (inCertifications && !inEducation) {
      flushBullets();
      html += `<p>${processBoldText(line)}</p>`;
      i += 1;
      continue;
    }

    // EDUCATION SECTION
    if (inEducation && !inCertifications) {
      flushBullets();
      if (line.includes('Master of Science') || line.includes('GPA:')) {
        html += `<p class="edu-degree">${line}</p>\n`;
        continue;
      }
      if (line.includes('University') || line.includes('Southern Arkansas')) {
        html += `<p class="edu-school">${line}</p>\n`;
        continue;
      }
    }

    // BULLETS (Experience section only - NOT certifications)
    if (line.startsWith('•') || line.startsWith('-') || line.startsWith('*')) {
      // Only add to bullet list if NOT in certifications
      if (!inCertifications) {
        const bulletContent = line.replace(/^[•*-]\s*/, '');
        currentBulletList.push(bulletContent);
        continue;
      }
    }

    // Any other line
    flushBullets();
    const processedLine = processBoldText(line);
    html += `<p>${processedLine}</p>\n`;
  }


// ============================================================================
// PAGE FORMATTING
// ============================================================================
async function setDocumentFormatting(documentId) 
{
  try 
  {
    console.log('📐 Setting page formatting...');

    const requests = [
      {
        updateDocumentStyle: 
        {
          documentStyle: 
          {
            marginTop: { magnitude: 18, unit: 'PT' },     // 0.25in
            marginBottom: { magnitude: 36, unit: 'PT' },  // 0.5in
            marginLeft: { magnitude: 36, unit: 'PT' },    // 0.5in
            marginRight: { magnitude: 36, unit: 'PT' },   // 0.5in
            pageSize: 
            {
              width: { magnitude: 612, unit: 'PT' },      // 8.5in
              height: { magnitude: 792, unit: 'PT' }      // 11in
            }
          },
          fields: 'marginTop,marginBottom,marginLeft,marginRight,pageSize'
        }
      }
    ];

    await docs.documents.batchUpdate(
    {
      documentId,
      requestBody: { requests }
    });

    console.log('✅ Page formatting applied');
  } catch (error) 
  {
    console.error('⚠️ Failed to set formatting:', error.message);
  }
}







// =====================================================
// RECRUITER AUTOMATION ENDPOINTS
// =====================================================

// POST /api/applications/:id/find-recruiters
app.post('/api/applications/:id/find-recruiters', async (req, res) => {
  try {
    const { id } = req.params;
     
    // Get API keys from .env (not from request body)
    const hunterApiKey = process.env.HUNTER_API_KEY;
    const aiProvider = process.env.AI_PROVIDER || 'chatgpt';
    const apiKey = aiProvider === 'gemini' 
      ? process.env.GEMINI_API_KEY 
      : process.env.CHATGPT_API_KEY;

    if (!hunterApiKey) {
      return res.status(400).json({ error: 'Hunter.io API key is required' });
    }
    if (!aiProvider || !apiKey) {
      return res.status(400).json({ error: 'AI provider and API key are required' });
    }

    console.log(`\n🔍 Finding recruiters for application #${id}...`);

    const appResult = await pool.query(
      `SELECT id, company_name, position_applied, jd_text, resume_link
       FROM applications WHERE id = $1`,
      [id]
    );

    if (appResult.rows.length === 0) {
      return res.status(404).json({ error: 'Application not found' });
    }

    const application = appResult.rows[0];

    if (!application.jd_text) {
      return res.status(400).json({ 
        error: 'Job description is required. Please add JD text to the application first.' 
      });
    }

    if (!application.resume_link) {
      return res.status(400).json({ 
        error: 'Resume link is required. Please optimize resume first.' 
      });
    }

    console.log('📄 Fetching resume content from Google Docs...');
    const resumeDocId = application.resume_link.split('/d/')[1].split('/')[0];
    const resumeDoc = await docs.documents.get({ documentId: resumeDocId });
    const resumeContent = resumeDoc.data.body.content
      .map(element => {
        if (element.paragraph && element.paragraph.elements) {
          return element.paragraph.elements
            .map(e => e.textRun ? e.textRun.content : '')
            .join('');
        }
        return '';
      })
      .join('');

    console.log('✅ Resume content fetched');

    const results = await findRecruitersAndSendEmails({
      jobDescription: application.jd_text,
      resumeContent: resumeContent,
      resumeDocUrl: application.resume_link,
      aiProvider: aiProvider,
      apiKey: apiKey,
      hunterApiKey: hunterApiKey,
      gmail: gmail,
      pool: pool,
      applicationId: id,
      generateAIContent: generateAIContent
    });

    res.json({
      success: true,
      message: `Found ${results.recruiters.length} recruiters`,
      stats: results.stats,
      recruiters: results.recruiters,
      errors: results.errors
    });

  } catch (error) {
    console.error('❌ Recruiter automation error:', error);
    res.status(500).json({ 
      error: 'Failed to find recruiters',
      details: error.message 
    });
  }
});

// =====================================================
// GMAIL OAUTH ENDPOINTS (SEPARATE ACCOUNT)
// =====================================================

// GET /auth/gmail - Initiate Gmail OAuth (separate account)
app.get('/auth/gmail', (req, res) => {
  const authUrl = gmailOAuth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: [
      'https://www.googleapis.com/auth/gmail.compose',
      'https://www.googleapis.com/auth/gmail.modify'
    ],
    prompt: 'consent'
  });
  res.redirect(authUrl);
});

// GET /oauth2callback-gmail - Handle Gmail OAuth callback
app.get('/oauth2callback-gmail', async (req, res) => {
  const { code } = req.query;
  
  try {
    const { tokens } = await gmailOAuth2Client.getToken(code);
    gmailOAuth2Client.setCredentials(tokens);
    
    console.log('✅ Gmail OAuth successful!');
    console.log('Add this to your .env file:');
    console.log(`GMAIL_REFRESH_TOKEN=${tokens.refresh_token}`);
    
    res.send(`
      <html>
        <body style="font-family: Arial; padding: 40px; text-align: center;">
          <h1 style="color: #4caf50;">✅ Recruiter Gmail Authorization Successful!</h1>
          <p><strong>This is for your RECRUITER EMAIL ACCOUNT</strong></p>
          <p>Add this to your .env file:</p>
          <pre style="background: #f5f5f5; padding: 20px; border-radius: 8px; text-align: left; display: inline-block; max-width: 600px; word-wrap: break-word;">GMAIL_REFRESH_TOKEN=${tokens.refresh_token}</pre>
          <p style="margin-top: 20px; color: #666;">
            Account authorized: This will be used ONLY for sending recruiter email drafts
          </p>
          <p style="margin-top: 20px;">You can close this window now.</p>
        </body>
      </html>
    `);
  } catch (error) {
    console.error('❌ Gmail OAuth error:', error);
    res.status(500).send(`
      <html>
        <body style="font-family: Arial; padding: 40px; text-align: center;">
          <h1 style="color: #f44336;">❌ Authorization Failed</h1>
          <p>Error: ${error.message}</p>
          <p>Please try again or check the console logs.</p>
        </body>
      </html>
    `);
  }
});

// GET /api/gmail-drafts - Get all Gmail drafts
app.get('/api/gmail-drafts', async (req, res) => {
  try {
    const response = await gmail.users.drafts.list({
      userId: 'me',
      maxResults: 10
    });
    
    res.json({
      success: true,
      drafts: response.data.drafts || []
    });
  } catch (error) {
    console.error('❌ Failed to fetch drafts:', error);
    res.status(500).json({ 
      error: 'Failed to fetch drafts',
      details: error.message 
    });
  }
});

// POST /api/test/hunter - Test Hunter.io API
app.post('/api/test/hunter', async (req, res) => {
  try {
    const { hunterApiKey } = req.body;
    
    if (!hunterApiKey) {
      return res.status(400).json({ error: 'Hunter.io API key is required' });
    }

    console.log('🧪 Testing Hunter.io API...');
    const testUrl = `https://api.hunter.io/v2/domain-search?domain=stripe.com&limit=1&api_key=${hunterApiKey}`;
    const response = await axios.get(testUrl);
    
    console.log('✅ Hunter.io response received');
    console.log('Response structure:', JSON.stringify(response.data.meta, null, 2));
    
    // Handle different response structures
    let requestsInfo = {
      used: 0,
      available: 0
    };

    if (response.data && response.data.meta) {
      const meta = response.data.meta;
      
      // Check for requests object
      if (meta.requests) {
        requestsInfo.used = meta.requests.used || 0;
        requestsInfo.available = meta.requests.available || meta.requests.limit || 0;
      }
      // Fallback: check for direct properties
      else if (meta.calls) {
        requestsInfo.used = meta.calls.used || 0;
        requestsInfo.available = meta.calls.available || meta.calls.limit || 0;
      }
    }
    
    res.json({
      success: true,
      message: 'Hunter.io API is working!',
      accountInfo: {
        requests: requestsInfo
      }
    });
  } catch (error) {
    console.error('❌ Hunter.io test failed:', error.response?.data || error.message);
    
    res.status(500).json({
      success: false,
      error: 'Hunter.io API test failed',
      details: error.response?.data?.errors?.[0]?.details || error.response?.data || error.message
    });
  }
});

// POST /api/test/gmail - Test Gmail API (separate account)
app.post('/api/test/gmail', async (req, res) => {
  try {
    const profile = await gmail.users.getProfile({ userId: 'me' });
    
    res.json({
      success: true,
      message: 'Gmail API is working!',
      email: profile.data.emailAddress,
      note: 'This is your RECRUITER email account'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Gmail API test failed',
      details: error.message,
      hint: 'Make sure GMAIL_REFRESH_TOKEN is set in .env'
    });
  }
});


// =====================================================
// DASHBOARD ENDPOINTS
// =====================================================

// GET /api/dashboard/summary - Enhanced KPIs
app.get('/api/dashboard/summary', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        COUNT(*) as total_applications,
        COUNT(DISTINCT company_name) as unique_companies,
        COUNT(*) FILTER (WHERE status IN ('Interview', 'Offer')) as interview_count,
        COUNT(*) FILTER (WHERE status = 'Offer') as offers_received,
        COUNT(*) FILTER (WHERE date_applied >= CURRENT_DATE - INTERVAL '7 days') as this_week_count,
        AVG(CASE 
          WHEN status != 'Applied' 
          THEN EXTRACT(DAY FROM (updated_at - date_applied))
          ELSE NULL 
        END) as avg_response_time
      FROM applications
    `);

    const data = result.rows[0];
    const totalApps = parseInt(data.total_applications);
    const interviewCount = parseInt(data.interview_count);
    const interviewRate = totalApps > 0
      ? Math.round((interviewCount / totalApps) * 100)
      : 0;

    res.json({
      totalApplications: totalApps,
      uniqueCompanies: parseInt(data.unique_companies),
      interviewRate: interviewRate,
      avgResponseTime: data.avg_response_time
        ? Math.round(parseFloat(data.avg_response_time))
        : null,
      offersReceived: parseInt(data.offers_received),
      thisWeekCount: parseInt(data.this_week_count)
    });
  } catch (error) {
    console.error('Dashboard summary error:', error);
    res.status(500).json({ error: 'Failed to load summary' });
  }
});

// GET /api/dashboard/daily - Daily application count
app.get('/api/dashboard/daily', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        date_applied,
        COUNT(*) as count
      FROM applications
      WHERE date_applied >= CURRENT_DATE - INTERVAL '30 days'
      GROUP BY date_applied
      ORDER BY date_applied ASC
    `);

    res.json(result.rows);
  } catch (error) {
    console.error('Daily chart error:', error);
    res.status(500).json({ error: 'Failed to load daily data' });
  }
});

// GET /api/dashboard/status-dist - Status distribution
app.get('/api/dashboard/status-dist', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        status,
        COUNT(*) as count,
        ROUND(100.0 * COUNT(*) / SUM(COUNT(*)) OVER(), 2) as percentage
      FROM applications
      GROUP BY status
      ORDER BY count DESC
    `);

    res.json(result.rows);
  } catch (error) {
    console.error('Status distribution error:', error);
    res.status(500).json({ error: 'Failed to load status distribution' });
  }
});

// GET /api/dashboard/recent - Recent activity
app.get('/api/dashboard/recent', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        id,
        company_name,
        position_applied,
        status,
        updated_at,
        date_applied
      FROM applications
      ORDER BY updated_at DESC
      LIMIT 10
    `);

    res.json(result.rows);
  } catch (error) {
    console.error('Recent activity error:', error);
    res.status(500).json({ error: 'Failed to load recent activity' });
  }
});

// =====================================================
// APPLICATIONS ENDPOINTS
// =====================================================

// GET /api/applications - With optional filters
app.get('/api/applications', async (req, res) => {
  try {
    const { status, days, search } = req.query;

    let query = 'SELECT * FROM applications WHERE 1=1';
    const params = [];
    let paramIndex = 1;

    if (status) {
      query += ` AND status = $${paramIndex}`;
      params.push(status);
      paramIndex++;
    }

    if (days) {
      query += ` AND date_applied >= CURRENT_DATE - INTERVAL '${parseInt(days)} days'`;
    }

    if (search) {
      query += ` AND search_vector @@ plainto_tsquery('english', $${paramIndex})`;
      params.push(search);
      paramIndex++;
    }

    query += ' ORDER BY date_applied DESC';

    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (error) {
    console.error('Applications list error:', error);
    res.status(500).json({ error: 'Failed to load applications' });
  }
});

// GET /api/applications/:id - Get single application
app.get('/api/applications/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      'SELECT * FROM applications WHERE id = $1',
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Application not found' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Get application error:', error);
    res.status(500).json({ error: 'Failed to load application' });
  }
});

// PUT /api/applications/:id - Update application
app.put('/api/applications/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const fields = req.body;

    const allowedFields = [
      'company_name',
      'position_applied',
      'status',
      'resume_link',
      'jd_link',
      'jd_text'
    ];

    const updates = [];
    const values = [];
    let paramIndex = 1;

    for (const [key, value] of Object.entries(fields)) {
      if (allowedFields.includes(key)) {
        updates.push(`${key} = $${paramIndex}`);
        values.push(value);
        paramIndex++;
      }
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'No valid fields to update' });
    }

    values.push(id);
    const query = `
      UPDATE applications 
      SET ${updates.join(', ')}
      WHERE id = $${paramIndex}
      RETURNING *
    `;

    const result = await pool.query(query, values);
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Update application error:', error);
    res.status(500).json({ error: 'Failed to update application' });
  }
});

// DELETE /api/applications/:id - Delete application
app.delete('/api/applications/:id', async (req, res) => {
  try {
    const { id } = req.params;
    await pool.query('DELETE FROM applications WHERE id = $1', [id]);
    res.json({ success: true });
  } catch (error) {
    console.error('Delete application error:', error);
    res.status(500).json({ error: 'Failed to delete application' });
  }
});

// =====================================================
// NOTES ENDPOINTS
// =====================================================

// GET /api/applications/:id/notes - Get all notes for application
app.get('/api/applications/:id/notes', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      'SELECT * FROM notes WHERE application_id = $1 ORDER BY created_at DESC',
      [id]
    );
    res.json(result.rows);
  } catch (error) {
    console.error('Get notes error:', error);
    res.status(500).json({ error: 'Failed to load notes' });
  }
});

// POST /api/applications/:id/notes - Add note to application
app.post('/api/applications/:id/notes', async (req, res) => {
  try {
    const { id } = req.params;
    const { note_text } = req.body;

    if (!note_text || !note_text.trim()) {
      return res.status(400).json({ error: 'Note text is required' });
    }

    const result = await pool.query(
      'INSERT INTO notes (application_id, note_text) VALUES ($1, $2) RETURNING *',
      [id, note_text.trim()]
    );

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Add note error:', error);
    res.status(500).json({ error: 'Failed to add note' });
  }
});

// DELETE /api/notes/:noteId - Delete note
app.delete('/api/notes/:noteId', async (req, res) => {
  try {
    const { noteId } = req.params;
    await pool.query('DELETE FROM notes WHERE id = $1', [noteId]);
    res.json({ success: true });
  } catch (error) {
    console.error('Delete note error:', error);
    res.status(500).json({ error: 'Failed to delete note' });
  }
});

// =====================================================
// CONTACTS ENDPOINTS (NEW!)
// =====================================================

// GET /api/applications/:id/contacts - Get all contacts for application
app.get('/api/applications/:id/contacts', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(`
      SELECT c.* 
      FROM contacts c
      JOIN application_contacts ac ON c.id = ac.contact_id
      WHERE ac.application_id = $1
      ORDER BY c.id DESC
    `, [id]);

    res.json(result.rows);
  } catch (error) {
    console.error('Get contacts error:', error);
    res.status(500).json({ error: 'Failed to load contacts' });
  }
});

// POST /api/applications/:id/contacts - Create new contact and link to application
app.post('/api/applications/:id/contacts', async (req, res) => {
  const client = await pool.connect();

  try {
    const { id } = req.params;
    const { full_name, email, linkedin_url, role, notes } = req.body;

    if (!full_name || !full_name.trim()) {
      return res.status(400).json({ error: 'Full name is required' });
    }

    await client.query('BEGIN');

    // Create contact
    const contactResult = await client.query(
      `INSERT INTO contacts (full_name, email, linkedin_url, role, notes) 
       VALUES ($1, $2, $3, $4, $5) 
       RETURNING *`,
      [
        full_name.trim(),
        email ? email.trim() : null,
        linkedin_url ? linkedin_url.trim() : null,
        role ? role.trim() : null,
        notes ? notes.trim() : null
      ]
    );

    const contactId = contactResult.rows[0].id;

    // Link contact to application
    await client.query(
      'INSERT INTO application_contacts (application_id, contact_id) VALUES ($1, $2)',
      [id, contactId]
    );

    await client.query('COMMIT');

    res.json(contactResult.rows[0]);
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Create contact error:', error);
    res.status(500).json({ error: 'Failed to create contact' });
  } finally {
    client.release();
  }
});

// GET /api/contacts/:id - Get single contact
app.get('/api/contacts/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      'SELECT * FROM contacts WHERE id = $1',
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Contact not found' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Get contact error:', error);
    res.status(500).json({ error: 'Failed to load contact' });
  }
});

// PUT /api/contacts/:id - Update contact
app.put('/api/contacts/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { full_name, email, linkedin_url, role, notes } = req.body;

    if (!full_name || !full_name.trim()) {
      return res.status(400).json({ error: 'Full name is required' });
    }

    const result = await pool.query(
      `UPDATE contacts 
       SET full_name = $1, email = $2, linkedin_url = $3, role = $4, notes = $5
       WHERE id = $6
       RETURNING *`,
      [
        full_name.trim(),
        email ? email.trim() : null,
        linkedin_url ? linkedin_url.trim() : null,
        role ? role.trim() : null,
        notes ? notes.trim() : null,
        id
      ]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Contact not found' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Update contact error:', error);
    res.status(500).json({ error: 'Failed to update contact' });
  }
});

// DELETE /api/applications/:appId/contacts/:contactId - Unlink and delete contact
app.delete('/api/applications/:appId/contacts/:contactId', async (req, res) => {
  const client = await pool.connect();

  try {
    const { appId, contactId } = req.params;

    await client.query('BEGIN');

    // Remove link
    await client.query(
      'DELETE FROM application_contacts WHERE application_id = $1 AND contact_id = $2',
      [appId, contactId]
    );

    // Check if contact is linked to other applications
    const linkCheck = await client.query(
      'SELECT COUNT(*) as count FROM application_contacts WHERE contact_id = $1',
      [contactId]
    );

    // If not linked to any other applications, delete the contact
    if (parseInt(linkCheck.rows[0].count) === 0) {
      await client.query('DELETE FROM contacts WHERE id = $1', [contactId]);
    }

    await client.query('COMMIT');

    res.json({ success: true });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Delete contact error:', error);
    res.status(500).json({ error: 'Failed to delete contact' });
  } finally {
    client.release();
  }
});

// =====================================================
// EXPORT ENDPOINT
// =====================================================

// GET /api/export/csv - Export applications as CSV
app.get('/api/export/csv', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        company_name,
        position_applied,
        date_applied,
        status,
        resume_link,
        jd_link
      FROM applications
      ORDER BY date_applied DESC
    `);

    const headers = ['Company', 'Position', 'Date Applied', 'Status', 'Resume Link', 'JD Link'];
    const rows = result.rows.map(row => [
      row.company_name,
      row.position_applied,
      row.date_applied,
      row.status,
      row.resume_link || '',
      row.jd_link || ''
    ]);

    const csv = [
      headers.join(','),
      ...rows.map(row => row.map(cell => `"${cell}"`).join(','))
    ].join('\n');

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename=applications_${new Date().toISOString().split('T')[0]}.csv`);
    res.send(csv);
  } catch (error) {
    console.error('Export CSV error:', error);
    res.status(500).json({ error: 'Failed to export data' });
  }
});

// =====================================================
// SERVE STATIC FILES
// =====================================================

app.use(express.static('public'));

// Dashboard route
app.get('/dashboard', (req, res) => {
  res.sendFile(__dirname + '/public/dashboard.html');
});

// Application details route
app.get('/application/:id', (req, res) => {
  res.sendFile(__dirname + '/public/application.html');
});

// =====================================================
// START SERVER
// =====================================================
// Start server
app.listen(PORT, () => {
  console.log(`\n🚀 Resume Optimizer Backend Running!`);
  console.log(`📍 http://localhost:${PORT}`);
  console.log(`✅ Health: http://localhost:${PORT}/health`);
  console.log(`🤖 Supports: Gemini AI & ChatGPT`);
  console.log(`🎯 ATS Target: 100% Match Rate\n`);
});

app.listen(PORT, () => 
{
  console.log(`\n🚀 Job Tracker Server Running!`);
  console.log(`📍 http://localhost:${PORT}`);
  console.log(`📊 Dashboard: http://localhost:${PORT}/dashboard\n`);
});

// =====================================================
// ERROR HANDLING
// =====================================================

process.on('unhandledRejection', (err) => {
  console.error('❌ Unhandled rejection:', err);
});

process.on('SIGTERM', async () => {
  console.log('SIGTERM received, closing database pool...');
  await pool.end();
  process.exit(0);
});

