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

// Validate database connection on startup
async function validateDatabaseConnection() {
  try {
    console.log('🔍 Testing PostgreSQL connection...');
    const result = await pool.query('SELECT NOW()');
    console.log('✅ Database connected successfully:', result.rows[0].now);
    return true;
  } catch (error) {
    console.error('❌ FATAL: Database connection failed:', error.message);
    console.error('📋 Please check:');
    console.error('   1. PostgreSQL is running');
    console.error('   2. DATABASE_URL in .env is correct');
    console.error('   3. Database credentials are valid');
    process.exit(1);
  }
}

// Call validation after pool creation
validateDatabaseConnection();

// Call template validation after database check
setTimeout(() => validateResumeTemplates(), 1000);

// Validate resume template IDs on startup
async function validateResumeTemplates() {
  try {
    console.log('🔍 Validating resume template IDs...');
    
    const templateIds = {
      FRONTEND: FRONTEND_RESUME_DOC_ID,
      FULLSTACK: FULLSTACK_RESUME_DOC_ID
    };
    
    for (const [type, docId] of Object.entries(templateIds)) {
      if (!docId) {
        throw new Error(`Missing ${type}_RESUME_DOC_ID in .env`);
      }
      
      try {
        const oauth2ClientTemp = new google.auth.OAuth2(
          process.env.GOOGLE_CLIENT_ID,
          process.env.GOOGLE_CLIENT_SECRET,
          'http://localhost:3000/oauth2callback'
        );
        oauth2ClientTemp.setCredentials({
          refresh_token: process.env.GOOGLE_REFRESH_TOKEN
        });
        
        const docsTemp = google.docs({ version: 'v1', auth: oauth2ClientTemp });
        await docsTemp.documents.get({ documentId: docId });
        console.log(`   ✅ ${type} template accessible (${docId})`);
      } catch (error) {
        throw new Error(`Cannot access ${type} template ${docId}: ${error.message}`);
      }
    }
    console.log('✅ All resume templates validated\n');
  } catch (error) {
    console.error('❌ FATAL: Resume template validation failed:', error.message);
    console.error('\n📋 Fix your .env file:');
    console.error('   1. FRONTEND_RESUME_DOC_ID - must be accessible');
    console.error('   2. FULLSTACK_RESUME_DOC_ID - must be accessible');
    console.error('   3. GOOGLE_REFRESH_TOKEN - must be valid');
    process.exit(1);
  }
}

// Initialize Google APIs
const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  'http://localhost:3000/oauth2callback'
);

oauth2Client.setCredentials({
  refresh_token: process.env.GOOGLE_REFRESH_TOKEN
});

// Error handler for invalid_grant
oauth2Client.on('tokens', (tokens) => {
  if (tokens.refresh_token) {
    console.log('🔄 New refresh token received:', tokens.refresh_token);
    console.log('⚠️  Update your .env file with this token');
  }
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

// =====================================================
// ISSUE #10: API KEY ROTATION & RETRY LOGIC (NEW)
// =====================================================

// API key pools for fallback/rotation
const apiKeyPools = {
  gemini: [
    process.env.GEMINI_KEY_1,
    process.env.GEMINI_KEY_2,
    process.env.GEMINI_KEY_3
  ].filter(Boolean),
  chatgpt: [
    process.env.CHATGPT_KEY_1,
    process.env.CHATGPT_KEY_2,
    process.env.CHATGPT_KEY_3
  ].filter(Boolean)
};

// Track failed keys for this session
const failedKeys = {
  gemini: new Set(),
  chatgpt: new Set()
};

// Helper: Get next available API key with fallback
function getNextAvailableKey(provider, preferredKey) {
  const keys = apiKeyPools[provider] || [];
  
  // Try preferred key first if provided and not failed
  if (preferredKey && !failedKeys[provider].has(preferredKey)) {
    return preferredKey;
  }
  
  // Find first non-failed key
  for (const key of keys) {
    if (!failedKeys[provider].has(key)) {
      return key;
    }
  }
  
  // Reset failed keys if all failed (allow one retry)
  if (keys.length > 0) {
    failedKeys[provider].clear();
    return keys[0];
  }
  
  return null;
}

// Helper: Mark key as failed
function markKeyAsFailed(provider, key) {
  if (key) {
    failedKeys[provider].add(key);
    console.log(`⚠️ Marked ${provider} key as failed, will retry with next key`);
  }
}

// Issue #12: Retry logic for database operations
async function queryWithRetry(query, params, maxRetries = 3) {
  let lastError;
  
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const result = await pool.query(query, params);
      return result;
    } catch (error) {
      lastError = error;
      
      // Check if error is transient
      const isTransient = error.code === 'ECONNREFUSED' || 
                         error.code === 'ETIMEDOUT' ||
                         error.message.includes('connection refused') ||
                         error.message.includes('ENOTFOUND');
      
      if (isTransient && attempt < maxRetries - 1) {
        const delay = Math.pow(2, attempt) * 1000; // Exponential backoff
        console.log(`⚠️ Database query failed (attempt ${attempt + 1}), retrying in ${delay}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }
      
      throw error;
    }
  }
  
  throw lastError;
}

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
async function generateWithGemini(prompt, apiKey, timeoutMs = 120000) {
  try {
    if (process.env.NODE_ENV === 'development') {
      console.log('🔑 Using Gemini API');
    }
    console.log('🎯 Model: gemini-2.0-flash');

    // Create timeout promise
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`Gemini API timeout after ${timeoutMs}ms`)), timeoutMs)
    );

    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });

    console.log('📤 Sending request to Gemini (timeout: 120s)...');
    const requestPromise = model.generateContent(prompt);
    
    // Race timeout against request
    const result = await Promise.race([requestPromise, timeoutPromise]);
    const response = await result.response;
    const text = response.text();

    console.log('✅ Gemini response received:', text.substring(0, 100) + '...');
    return text;
  } catch (error) {
    if (error.message.includes('timeout')) {
      throw new Error(`Gemini API timeout: Request took longer than 120 seconds. Try with a shorter job description.`);
    }
    console.error('❌ Gemini API Error Details:', {
      message: error.message,
      status: error.status,
      statusText: error.statusText
    });
    throw new Error(`Gemini API Error: ${error.message}`);
  }
}

// ChatGPT (OpenAI) implementation
async function generateWithChatGPT(prompt, apiKey, timeoutMs = 120000) {
  try {
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`ChatGPT API timeout after ${timeoutMs}ms`)), timeoutMs)
    );

    const requestPromise = axios.post('https://api.openai.com/v1/chat/completions', {
      model: 'gpt-4.1-mini',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.7,
      max_tokens: 4000
    }, {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      timeout: timeoutMs
    });

    const response = await Promise.race([requestPromise, timeoutPromise]);
    return response.data.choices[0].message.content;
  } catch (error) {
    if (error.message.includes('timeout')) {
      throw new Error(`ChatGPT API timeout: Request took longer than 120 seconds.`);
    }
    if (error.response) {
      throw new Error(`ChatGPT API Error: ${error.response.data?.error?.message || error.response.statusText}`);
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

// Helper: Extract company and position from job description
async function extractJobDetails(jobDescription, aiProvider, apiKey) 
{
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

function normalizeRoleTitle(title) 
{
  let t = (title || '')
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const replacements = [
    { re: /\bfront end\b/ig, to: 'Frontend' },
    { re: /\bfull stack\b/ig, to: 'Full Stack' },
    { re: /\bswe\b/ig, to: 'Software Engineer' }
  ];

  for (const r of replacements) t = t.replace(r.re, r.to);

  return t;
}

function detectRoleFromJD({ position, jobDescription }) {
  const pos = (position || '').trim();
  const jd = (jobDescription || '').toLowerCase();

  // 1) If position extracted by AI, use it
  if (pos && pos.toLowerCase() !== 'n/a') {
    return normalizeRoleTitle(pos);
  }

  // 2) Infer role from JD text if position is missing
  const patterns = [
    { role: 'Java Full Stack Engineer', test: /(java).*(full\s*stack)|full\s*stack.*(java)/i },
    { role: 'Java Software Engineer', test: /(java).*(software engineer)|software engineer.*(java)/i },
    { role: 'Java Developer', test: /(java developer|java\b.*developer)/i },
    { role: 'Frontend Developer', test: /(frontend developer|ui engineer|react developer|angular developer|vue developer|front end developer)/i },
    { role: 'Full Stack Developer', test: /(full\s*stack developer|full\s*stack engineer)/i },
    { role: 'Software Engineer', test: /(software engineer|software developer|application developer)/i }
  ];

  for (const p of patterns) {
    if (p.test.test(jobDescription || '')) return p.role;
  }

  // 3) Final fallback if JD has no clear role
  return 'Software Engineer';
}

function buildResumeFileName({ roleTitle, companyName }) {
  const roleClean = (roleTitle || 'Software Engineer')
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const compClean = (companyName || '')
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!compClean || compClean.toLowerCase() === 'n/a') {
    return `Sai Kiran ${roleClean}`;
  }

  return `Sai Kiran ${roleClean} ${compClean}`;
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
[List 5-10 most important things that will make resume score 100% on this portal]

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

2. FULLSTACK Resume: Balanced backend + frontend + Software Engineer + cloud + Software Engineering + Software Developer
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
- If JD says "Software Developer" or Software Engineer or Software Engineering or lists both backend AND frontend → FULLSTACK 
- If JD is unclear or mixed → FULLSTACK
- If JD mentions Spring Boot, microservices, APIs heavily → FULLSTACK
- DO NOT mix domains incorrectly (e.g., banking data in healthcare, healthcare data in finance, ecommerce in healthcare)
- Skills must align correctly with each role's domain

RESPOND IN THIS EXACT FORMAT (no other text):

SELECTED_RESUME: [FRONTEND / FULLSTACK]

CONFIDENCE: [High / Medium / Low]

REASONING: [2-3 sentences explaining why this resume is the best choice]

KEY_SKILLS_MATCH: [List 4-6 key skills from JD that match this resume type]

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
  const client = await pool.connect();
  const maxRetries = 3;
  
  try {
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        // Use SERIALIZABLE isolation to prevent concurrent inserts
        await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
        
        const now = new Date();
        const localDate = new Date(now.toLocaleString('en-US', { timeZone: 'America/Chicago' }));
        const today = localDate.toISOString().slice(0, 10);

        // Soft match (company + position + date)
        const existing = await client.query(
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
          // UPDATE existing record
          await client.query(
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
          await client.query('COMMIT');
          return;
        }

        // INSERT new record
        await client.query(
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
        await client.query('COMMIT');
        return; // Success - exit retry loop
        
      } catch (error) {
        await client.query('ROLLBACK').catch(() => {}); // Ignore rollback errors
        
        // Check if error is transient and retryable
        const isTransient = error.code === 'ECONNREFUSED' || 
                           error.code === 'ETIMEDOUT' ||
                           error.code === '40001' || // Serialization failure
                           error.message.includes('connection refused') ||
                           error.message.includes('ENOTFOUND');
        
        if (isTransient && attempt < maxRetries - 1) {
          const delay = Math.pow(2, attempt) * 500; // Exponential backoff
          console.log(`⚠️ Database operation failed (attempt ${attempt + 1}/${maxRetries}), retrying in ${delay}ms...`);
          await new Promise(resolve => setTimeout(resolve, delay));
          continue; // Retry
        }
        
        // Non-transient error or final attempt
        console.error('❌ Database error:', error.message);
        throw error;
      }
    }
  } finally {
    client.release();
  }
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

// =====================================================
// BRUTAL RESUME VALIDATION (HM CHECKS - NO SUGAR COAT)
// =====================================================

function performBrutalResumeValidation({ jobDescription, resumeJson, resumeType, truistBullets, accBullets, hclBullets }) {
  console.log('\n📋 1. EXTRACTED JD SKILLS (REQUIRED & PREFERRED)');
  console.log('-'.repeat(80));

  // Extract all skills from JD (case-insensitive matching)
  const jdSkillsRaw = extractJDSkills(jobDescription);
  const requiredSkills = jdSkillsRaw.required;
  const preferredSkills = jdSkillsRaw.preferred;

  console.log(`\n🔴 REQUIRED SKILLS (${requiredSkills.length}):`);
  requiredSkills.forEach((skill, idx) => {
    console.log(`   ${idx + 1}. ${skill}`);
  });

  console.log(`\n🟡 PREFERRED SKILLS (${preferredSkills.length}):`);
  preferredSkills.forEach((skill, idx) => {
    console.log(`   ${idx + 1}. ${skill}`);
  });

  // Combine all resume content
  const allBullets = [...truistBullets, ...accBullets, ...hclBullets];
  const allSkills = [];
  for (let i = 1; i <= 13; i++) {
    if (resumeJson[`CAT_${i}`]) allSkills.push(...(resumeJson[`SKILL_${i}`] || '').split(',').map(s => s.trim()).filter(Boolean));
  }

  const resumeText = [
    resumeJson.SUMMARY,
    allSkills.join(' '),
    allBullets.join(' ')
  ].join(' ').toLowerCase();

  console.log('\n' + '='.repeat(80));
  console.log('2️⃣ ATS MATCH SCORE & SKILL COVERAGE');
  console.log('-'.repeat(80));

  // Calculate skill coverage
  const requiredCovered = requiredSkills.filter(skill => {
    const skillLower = skill.toLowerCase();
    return resumeText.includes(skillLower);
  });

  const preferredCovered = preferredSkills.filter(skill => {
    const skillLower = skill.toLowerCase();
    return resumeText.includes(skillLower);
  });

  // Safe division (handle edge cases)
  const requiredCoverage = requiredSkills.length > 0 ? (requiredCovered.length / requiredSkills.length) * 100 : 0;
  const preferredCoverage = preferredSkills.length > 0 ? (preferredCovered.length / preferredSkills.length) * 100 : 0;
  const totalSkills = requiredSkills.length + preferredSkills.length;
  const overallCoverage = totalSkills > 0 ? ((requiredCovered.length + preferredCovered.length) / totalSkills) * 100 : 0;

  // Calculate base ATS score (0-100) - Handle NaN
  let atsScore = 50; // Base

  // Required skills: 30 points (only if required skills exist)
  if (requiredSkills.length > 0) {
    atsScore += (requiredCoverage / 100) * 30;
  } else {
    atsScore += 20; // Bonus if no specific required skills defined
  }

  // Preferred skills: 15 points
  if (preferredSkills.length > 0) {
    atsScore += (preferredCoverage / 100) * 15;
  }

  // Skill evidence bonus: 15 points (skills in bullets = more valuable)
  const skillsInBullets = allSkills.length > 0 
    ? allSkills.filter(skill => allBullets.some(bullet => bullet.toLowerCase().includes(skill.toLowerCase())))
    : [];
  if (allSkills.length > 0) {
    atsScore += (skillsInBullets.length / allSkills.length) * 15;
  }

  // ATS format penalty (if too keyword-stuffed)
  const wordCount = resumeText.split(/\s+/).length;
  const keywordDensity = wordCount > 0 ? (allSkills.length / wordCount) * 100 : 0;
  if (keywordDensity > 15) atsScore -= (keywordDensity - 15) * 0.5;
  if (keywordDensity < 5 && keywordDensity > 0) atsScore -= (5 - keywordDensity) * 1;

  atsScore = Math.max(0, Math.min(100, Math.round(atsScore)));

  console.log(`\n📊 ATS MATCH SCORE: ${atsScore}/100`);
  if (atsScore >= 85) console.log('   ✅ EXCELLENT - Likely to pass ATS screening');
  else if (atsScore >= 70) console.log('   🟡 GOOD - Should pass ATS, but could improve');
  else console.log('   🔴 POOR - May not pass ATS screening');

  console.log(`\n📈 COVERAGE BREAKDOWN:`);
  console.log(`   🔴 Required Skills: ${requiredCoverage.toFixed(1)}% (${requiredCovered.length}/${requiredSkills.length})`);
  console.log(`   🟡 Preferred Skills: ${preferredCoverage.toFixed(1)}% (${preferredCovered.length}/${preferredSkills.length})`);
  console.log(`   📊 Overall Coverage: ${overallCoverage.toFixed(1)}%`);

  console.log('\n' + '='.repeat(80));
  console.log('3️⃣ ALL REQUIRED SKILLS - DETAILED COVERAGE VERIFICATION');
  console.log('-'.repeat(80));

  console.log('\n🔴 REQUIRED SKILLS - WHERE ARE THEY DEMONSTRATED?');
  requiredSkills.forEach((skill, idx) => {
    const skillLower = skill.toLowerCase();
    const isCovered = resumeText.includes(skillLower);
    const foundInBullets = allBullets.filter(b => b.toLowerCase().includes(skillLower));
    const foundInSkills = allSkills.filter(s => s.toLowerCase().includes(skillLower));
    const foundInSummary = resumeJson.SUMMARY?.toLowerCase().includes(skillLower) || false;

    if (isCovered) {
      console.log(`\n   ✅ ${skill}`);
      if (foundInSkills.length > 0) console.log(`      📋 In Skills Section: YES`);
      if (foundInBullets.length > 0) console.log(`      💼 In Experience Bullets: YES (${foundInBullets.length} mentions)`);
      if (foundInSummary) console.log(`      📝 In Summary: YES`);
    } else {
      console.log(`\n   ❌ ${skill} - NOT FOUND IN RESUME!`);
      console.log(`      ⚠️  This is a CRITICAL GAP - Likely ATS rejection`);
    }
  });

  console.log('\n\n🟡 PREFERRED SKILLS - DEMONSTRATED?');
  preferredSkills.slice(0, 10).forEach((skill, idx) => {
    const skillLower = skill.toLowerCase();
    const isCovered = resumeText.includes(skillLower);
    const foundInBullets = allBullets.filter(b => b.toLowerCase().includes(skillLower));

    if (isCovered) {
      console.log(`   ✅ ${skill}${foundInBullets.length > 0 ? ' (in bullets)' : ' (in skills only)'}`);
    } else {
      console.log(`   ⭕ ${skill} - NOT included`);
    }
  });

  console.log('\n' + '='.repeat(80));
  console.log('4️⃣ KEYWORD COUNT CHECK - EXACT SKILL MENTIONS');
  console.log('-'.repeat(80));

  const keywordMetrics = countKeywordOccurrences(jobDescription, resumeText, allBullets);

  console.log('\n📊 TOP 20 MOST IMPORTANT JD KEYWORDS:');
  keywordMetrics.topKeywords.slice(0, 20).forEach((kw, idx) => {
    const bar = '█'.repeat(Math.ceil(kw.count / 2)) + (kw.count > 10 ? ' ✅ EXCELLENT' : kw.count > 5 ? ' 🟡 GOOD' : ' 🔴 LOW');
    console.log(`   ${String(idx + 1).padStart(2, ' ')}. ${kw.keyword.padEnd(25, ' ')} - ${kw.count} mentions ${bar}`);
  });

  console.log(`\n📈 KEYWORD DENSITY METRICS:`);
  console.log(`   • Total unique keywords: ${keywordMetrics.totalUniqueKeywords}`);
  console.log(`   • Total keyword mentions: ${keywordMetrics.totalMentions}`);
  console.log(`   • Average mentions per keyword: ${(keywordMetrics.totalMentions / keywordMetrics.totalUniqueKeywords).toFixed(1)}`);

  console.log('\n' + '='.repeat(80));
  console.log('5️⃣ BRUTAL HIRING MANAGER CHECKS');
  console.log('-'.repeat(80));

  const hmChecks = performHMBrutalChecks({
    resumeJson,
    allBullets,
    jobDescription,
    requiredCovered,
    requiredSkills,
    atsScore
  });

  console.log(`\n✔️ CHECK 1: Does resume look human-written?`);
  console.log(`   ${hmChecks.humanWritten ? '✅ LIKELY YES' : '❌ LIKELY NO - Too AI-generated'}`);
  console.log(`   ${hmChecks.humanWrittenReason}`);

  console.log(`\n✔️ CHECK 2: Are bullets specific or generic keyword-stuffed?`);
  console.log(`   ${hmChecks.bulletsSpecific ? '✅ GOOD - Specific metrics & context' : '⚠️ WEAK - Generic/vague bullets'}`);
  console.log(`   ${hmChecks.bulletsReason}`);

  console.log(`\n✔️ CHECK 3: Is there evidence of actual hands-on work?`);
  console.log(`   ${hmChecks.handsOnEvidence ? '✅ YES - Concrete examples' : '❌ NO - Sounds generic'}`);
  console.log(`   ${hmChecks.handsOnReason}`);

  console.log(`\n✔️ CHECK 4: Would recruiter trust this resume?`);
  console.log(`   ${hmChecks.trustworthy ? '✅ LIKELY YES' : '❌ LIKELY NO - Red flags detected'}`);
  console.log(`   ${hmChecks.trustReason}`);

  console.log(`\n✔️ CHECK 5: Interview-safe? Can candidate explain everything?`);
  console.log(`   ${hmChecks.interviewSafe ? '✅ PROBABLY YES' : '⚠️ RISKY - Might get caught in interview'}`);
  console.log(`   ${hmChecks.interviewReason}`);

  console.log('\n' + '='.repeat(80));
  console.log('📊 FINAL VALIDATION SUMMARY');
  console.log('='.repeat(80));

  console.log(`\n🎯 ATS SCORE: ${atsScore}/100 ${atsScore >= 85 ? '✅' : atsScore >= 70 ? '🟡' : '❌'}`);
  console.log(`🔴 REQUIRED SKILLS COVERED: ${requiredCovered.length}/${requiredSkills.length} (${requiredCoverage.toFixed(0)}%)`);
  console.log(`🟡 PREFERRED SKILLS COVERED: ${preferredCovered.length}/${preferredSkills.length} (${preferredCoverage.toFixed(0)}%)`);
  console.log(`💼 RESUME QUALITY: ${hmChecks.overallQuality}/10`);

  if (requiredCoverage < 70) {
    console.log(`\n🔴 CRITICAL: Missing ${requiredSkills.length - requiredCovered.length} required skills. Likely ATS rejection.`);
  } else if (requiredCoverage < 85) {
    console.log(`\n🟡 WARNING: ${requiredSkills.length - requiredCovered.length} required skills missing. Consider adding them.`);
  } else {
    console.log(`\n✅ GOOD: All critical required skills are covered.`);
  }

  console.log('\n' + '='.repeat(80) + '\n');

  return {
    atsScore,
    requiredCoverage,
    preferredCoverage,
    requiredCovered,
    preferredCovered,
    hmChecks,
    keywordMetrics
  };
}

// Helper: Extract skills from JD
function extractJDSkills(jd) {
  const jdLower = jd.toLowerCase();
  
  // Common technical skills to look for
  const commonSkills = [
    'javascript', 'typescript', 'python', 'java', 'react', 'node.js', 'express', 'spring boot',
    'angular', 'vue', 'aws', 'gcp', 'azure', 'kubernetes', 'docker', 'postgresql', 'mongodb',
    'mysql', 'redis', 'kafka', 'rest api', 'graphql', 'html', 'css', 'git', 'ci/cd',
    'jenkins', 'github', 'gitlab', 'gitlab ci', 'terraform', 'ansible', 'linux', 'windows',
    'microservices', 'cloud', 'devops', 'agile', 'scrum', 'sql', 'nosql', 'rest', 'soap',
    'xml', 'json', 'oauth', 'jwt', 'saml', 'authentication', 'authorization', 'ssl', 'https'
  ];

  // Extract required vs preferred
  const required = [];
  const preferred = [];

  commonSkills.forEach(skill => {
    if (jdLower.includes(skill)) {
      if (jdLower.includes(`required`) && jdLower.indexOf(skill) < jdLower.indexOf(`preferred`)) {
        required.push(skill);
      } else if (jdLower.includes(`must have`) || jdLower.includes(`required`)) {
        const mustIdx = Math.min(
          jdLower.lastIndexOf('must have'),
          jdLower.lastIndexOf('required')
        );
        if (jdLower.indexOf(skill) < mustIdx + 500) required.push(skill);
        else preferred.push(skill);
      } else {
        preferred.push(skill);
      }
    }
  });

  return {
    required: [...new Set(required)],
    preferred: [...new Set(preferred)]
  };
}

// Helper: Count keyword occurrences
function countKeywordOccurrences(jd, resumeText, bullets) {
  const keywords = jd.toLowerCase().match(/\b[a-z0-9+#./-]+\b/g) || [];
  const keywordMap = {};

  keywords.forEach(kw => {
    if (kw.length > 3 && !['that', 'this', 'with', 'from', 'have'].includes(kw)) {
      const count = (resumeText.match(new RegExp(kw, 'g')) || []).length;
      if (count > 0) {
        keywordMap[kw] = (keywordMap[kw] || 0) + count;
      }
    }
  });

  const topKeywords = Object.entries(keywordMap)
    .map(([keyword, count]) => ({ keyword, count }))
    .sort((a, b) => b.count - a.count);

  return {
    topKeywords,
    totalUniqueKeywords: Object.keys(keywordMap).length,
    totalMentions: Object.values(keywordMap).reduce((a, b) => a + b, 0)
  };
}

// Helper: Hiring Manager Brutal Checks
function performHMBrutalChecks({ resumeJson, allBullets, jobDescription, requiredCovered, requiredSkills, atsScore }) {
  let overallQuality = 5;
  const checks = {};

  // Check 1: Human-written
  const aiKeywords = ['leveraging', 'utilize', 'synergize', 'drive', 'paradigm', 'ecosystem'];
  const aiCount = resumeJson.SUMMARY?.toLowerCase().match(/leveraging|utilize|synergize|drive|paradigm/g)?.length || 0;
  checks.humanWritten = aiCount < 3;
  checks.humanWrittenReason = aiCount < 3 
    ? `✅ Only ${aiCount} AI buzzwords detected` 
    : `❌ ${aiCount} AI buzzwords detected - sounds robotic`;
  if (checks.humanWritten) overallQuality += 2;

  // Check 2: Bullets specificity
  const metricsCount = allBullets.filter(b => /\d+%|[\$\d]|\d+x|[\d]+\./.test(b)).length;
  const metricsRatio = (metricsCount / allBullets.length) * 100;
  checks.bulletsSpecific = metricsRatio > 30 && metricsRatio < 80;
  checks.bulletsReason = `${metricsCount} bullets with metrics (${metricsRatio.toFixed(0)}% of total)`;
  if (checks.bulletsSpecific) overallQuality += 1.5;

  // Check 3: Hands-on evidence
  const actionVerbs = ['built', 'developed', 'implemented', 'designed', 'created', 'engineered', 'optimized'];
  const actionCount = allBullets.filter(b => actionVerbs.some(v => b.toLowerCase().startsWith(v))).length;
  checks.handsOnEvidence = actionCount > allBullets.length * 0.6;
  checks.handsOnReason = `${actionCount} bullets start with action verbs (${(actionCount/allBullets.length*100).toFixed(0)}%)`;
  if (checks.handsOnEvidence) overallQuality += 2;

  // Check 4: Trustworthiness
  const skillsMatch = requiredCovered.length / requiredSkills.length;
  checks.trustworthy = atsScore > 75 && skillsMatch > 0.7;
  checks.trustReason = skillsMatch > 0.7 
    ? `✅ Good skill alignment (${(skillsMatch*100).toFixed(0)}%)` 
    : `❌ Skill gaps detected`;
  if (checks.trustworthy) overallQuality += 2;

  // Check 5: Interview-safe
  const genericPhrases = ['responsible for', 'worked on', 'participated in'];
  const genericCount = allBullets.filter(b => genericPhrases.some(p => b.toLowerCase().includes(p))).length;
  checks.interviewSafe = genericCount < allBullets.length * 0.2;
  checks.interviewReason = genericCount > 0 
    ? `⚠️ ${genericCount} generic phrases - rehearse stories` 
    : `✅ Specific, defensible bullets`;
  if (checks.interviewSafe) overallQuality += 1.5;

  checks.overallQuality = Math.min(10, overallQuality);

  return checks;
}

// Input validation helper
function validateOptimizeResumeRequest(req) {
  const { jobUrl, manualJobDescription, aiProvider } = req.body;

  // Validate AI provider
  if (!['gemini', 'chatgpt'].includes(aiProvider)) {
    throw new Error('Invalid AI provider. Must be "gemini" or "chatgpt"');
  }

  // Validate at least one input is provided
  const hasUrl = jobUrl && jobUrl.trim().length > 0;
  const hasManualJD = manualJobDescription && manualJobDescription.trim().length > 0;
  
  if (!hasUrl && !hasManualJD) {
    throw new Error('Either job URL or manual job description is required');
  }

  // Validate job URL format if provided
  if (hasUrl) {
    try {
      new URL(jobUrl);
    } catch {
      throw new Error('Invalid job URL format. Must be a valid HTTP(S) URL');
    }
    
    if (jobUrl.length > 2048) {
      throw new Error('Job URL exceeds maximum length (2048 characters)');
    }
  }

  // Validate job description length
  if (hasManualJD) {
    if (manualJobDescription.length > 500000) {
      throw new Error('Job description exceeds maximum length (500KB)');
    }
    if (manualJobDescription.length < 50) {
      throw new Error('Job description is too short (minimum 50 characters)');
    }
  }
}

// Main optimization endpoint
app.post('/api/optimize-resume', async (req, res) => {
  try {
    // Validate input
    validateOptimizeResumeRequest(req);
    
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

    // Validate API keys and prepare key pools for fallback
    let extractionKey, analysisKey, rewriteKey;
    
    if (aiProvider === 'gemini') {
      const geminiKeys = [geminiKey1, geminiKey2, geminiKey3].filter(Boolean);
      if (geminiKeys.length === 0) {
        return res.status(400).json({ error: 'At least one Gemini API key is required' });
      }
      extractionKey = getNextAvailableKey('gemini', geminiKey1) || geminiKeys[0];
      analysisKey = getNextAvailableKey('gemini', geminiKey2) || geminiKeys[Math.min(1, geminiKeys.length - 1)];
      rewriteKey = getNextAvailableKey('gemini', geminiKey3) || geminiKeys[Math.min(2, geminiKeys.length - 1)];
      console.log('🔑 Using Gemini API with key rotation enabled');
    } else if (aiProvider === 'chatgpt') {
      const chatgptKeys = [chatgptApiKey, chatgptKey2, chatgptKey3].filter(Boolean);
      if (chatgptKeys.length === 0) {
        return res.status(400).json({ error: 'At least one ChatGPT API key is required' });
      }
      extractionKey = getNextAvailableKey('chatgpt', chatgptApiKey) || chatgptKeys[0];
      analysisKey = getNextAvailableKey('chatgpt', chatgptKey2) || chatgptKeys[Math.min(1, chatgptKeys.length - 1)];
      rewriteKey = getNextAvailableKey('chatgpt', chatgptKey3) || chatgptKeys[Math.min(2, chatgptKeys.length - 1)];
      console.log('🔑 Using ChatGPT API with key rotation enabled');
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
    // extractionKey already declared earlier
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
    let resumeDoc;
    try {
      resumeDoc = await docs.documents.get({
        documentId: selectedResumeId
      });
    } catch (error) {
      if (error.message.includes('invalid_grant') || error.message.includes('refresh token')) {
        console.error('\n❌ ERROR: Google authentication token expired or invalid');
        console.error('🔐 Your GOOGLE_REFRESH_TOKEN in .env needs to be regenerated.\n');
        console.error('📝 To fix this:');
        console.error('1. Run: node get-token.js');
        console.error('2. Follow the OAuth flow in your browser');
        console.error('3. Copy the new refresh token to your .env file');
        console.error('4. Restart the server\n');
        throw error;
      }
      throw error;
    }
    const originalResume = extractTextFromDoc(resumeDoc.data);
    console.log(`✅ Resume fetched (${originalResume.length} chars)`);

    // Step 5: Generate optimization points
    console.log('💡 Step 5: Generating optimization points...');

    // Replace the optimizationPrompt variable with this:

// Replace the optimizationPrompt variable with this:

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
Extract all relevant information from the job description like required skills, preferred skills, responsibilities, tools / technologies, soft skills, domain keywords, industry terms.
compare with the current resume

PORTAL: ${atsAnalysis.portalName}

====================================================
YOUR MISSION
====================================================

Generate 8-20 strategic optimization points that:
✅ Add missing JD skills NATURALLY to both Experience Bullets and Skills sections
✅ Reorder bullets to highlight most relevant experience first
✅ Keep every change 100% interview-defensible
✅ Make resume look human-written, not AI-generated
✅ Target 85-92% ATS match (NOT 100% - that looks fake)
✅ Make it need to be atleast 85% ATS match
Note: don't add soft skills, domain keywords, industry terms in the skill section.
====================================================
SKILL ADDITION STRATEGY (CRITICAL)
====================================================

FOR EVERY MISSING SKILL IN JD:

CATEGORY NAMING AND SKILL GROUPING RULES (STRICT)

- Use standard IT industry technical category names.
- Rename a category ONLY if the JD explicitly uses a different standard wording.
- Minimum 5 categories, maximum 13 categories.
- Each skill must appear in only ONE category.
- Do NOT invent tools or unrelated categories.
- If fewer than 13 categories are needed, set remaining CAT_x and SKILL_x to empty string "".


1. **Add to Skills Section**
   - FIRST: Try to fit into EXISTING categories (minimize category count)
   - ONLY create new category if skill truly doesn't fit anywhere
   - Format: plain text, comma-separated, no bold
   
   **Category Placement Rules:**
   - If new category needed AND JD heavily emphasizes it → Place HIGH (2nd-3rd position)
   - If new category needed AND JD mentions as nice-to-have → Place LOW (near end)
   - Default position: After related categories logically
   
   **Category Naming:**
   - Use standard IT industry category names only
   - No special characters or creative suffixes
   - Examples:
     Programming Languages
     Backend Development
     Cloud and Infrastructure
     CI/CD and DevOps
   

2. **Add to Experience Bullets Section** 
   - Choose the company where it's MOST REALISTIC
   - Add naturally to an existing bullet OR create new bullet
   - Make it sound like you actually used it
   - Use specific context (project name, metric, outcome)
   - **BOLD the skill name** when adding to bullets (helps ATS + recruiter scanning)
   - Example: "Built event-driven microservices using **Spring Boot** and **Apache Kafka**"
   - Evidence Priority: Required skills MUST have evidence, nice-to-have can be subtle

SKILL ADDITION RULES:
**Required Skills (JD says "required" or "must have"):**
- MUST add to Skills section
- MUST add to Experience Bullets OR Projects Bullets (at most realistic location)
- High priority - make it prominent


**Preferred/Nice-to-Have Skills (JD says "preferred" or "nice to have"):**
- MUST add to Skills section
- MUST add to Experience Bullets OR Projects Bullets (at most realistic location)
- Lower priority - can be subtle mention

**Realistic Placement by Company:**
- LPL Financial (current): Cloud, modern frameworks, recent technologies
- Athenahealth: Healthcare tech, FHIR, compliance, data security
- YES Bank: Payments, banking, security, transaction processing
- Comcast: Media, streaming, content delivery, scalability

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
BULLET REORDERING STRATEGY
====================================================

**ALWAYS move most JD-relevant bullet to position #1 at each company**

Recruiters spend 6 seconds scanning - first 2 bullets matter most.

Example:
If JD emphasizes "Kafka event streaming":
- Current order: 1,2,3,4,5,6
- New order: 3,1,2,5,4,6 (if bullet #3 is about Kafka)

====================================================
HUMANIZATION RULES (NON-NEGOTIABLE)
====================================================

1. **Vary Action Verbs**
   - Primary verbs: Built, Developed, Engineered, Created, Designed, Led, Optimized, Automated, Integrated
   - **CONDITIONAL**: Use "Architected" ONLY if JD explicitly requires/emphasizes:
     - "Architecture", "Architectural design", "System architecture", "Designing systems", "Design patterns"
     - "Building scalable systems from scratch", "Platform design", "Technical strategy"
   - If JD does NOT mention architecture prominently → DO NOT use "Architected" at all
   - Don't use "Implemented" more than 2 times in entire resume
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

❌ Company names, dates, job titles
❌ Number of companies (keep all 4)
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
Where_Skills: Messaging & Streaming (existing category)
Where_Experience: LPL Financial, Bullet 3
Integration: "Extend existing Kafka bullet to mention **Flink** for stream processing with 500K events/sec throughput"
Bold: YES (Flink is from JD)
Priority: High
Reasoning: JD lists Flink as required skill; fits existing "Messaging & Streaming" category; realistic since candidate has Kafka experience

POINT 2:
Type: REORDER_BULLETS
Company: Athenahealth
Current_Order: 1,2,3,4,5
New_Order: 4,1,2,3,5
Reasoning: JD emphasizes FHIR APIs - move FHIR bullet to position 1

POINT 3:
Type: ADD_SKILL
Skill: TensorFlow
Where_Skills: NEW CATEGORY "Machine Learning & AI" (insert after Testing category)
Justification: JD mentions ML for fraud detection; doesn't fit existing categories; JD moderately emphasizes it
Where_Experience: YES Bank, New Bullet
Integration: "Add new bullet: 'Implemented ML-based fraud detection using **TensorFlow** identifying suspicious transactions with 92% accuracy, preventing $5M+ in potential losses'"
Bold: YES (TensorFlow is from JD)
Priority: High
Reasoning: JD requires ML experience; creating focused category shows specialization; realistic for banking fraud prevention

POINT 4:
Type: ADD_SKILL
Skill: GraphQL
Where_Skills: Backend Frameworks (existing category - DON'T create new "API" category)
Where_Experience: LPL Financial, Modify Bullet 2
Integration: "Update API bullet to mention both RESTful and **GraphQL** APIs"
Bold: YES (GraphQL is from JD)
Priority: Medium
Reasoning: JD mentions GraphQL; fits naturally in Backend Frameworks; avoids unnecessary category expansion

POINT 5:
Type: DELETE_SKILL
Skill: [Skill name if any skills should be deleted]
Current_Location: [Where it appears]
Reason_For_Deletion: Completely unused in bullets, zero JD relevance, confuses core profile
Priority: Low
Note: Only delete if criteria met - verify no evidence exists in any bullet

POINT 6:
Type: ENHANCE_SKILL_EVIDENCE
Skill: [Skill with weak evidence]
Current_Bullet: [Current text]
Enhanced_Bullet: [Improved with more specific hands-on context]
Change: Adding concrete project/metric evidence
Reasoning: Skill exists but evidence is vague; updating to show hands-on usage

====================================================
POINT TYPES YOU CAN USE
====================================================

1. **ADD_SKILL**: Add missing JD skill to both Skills and Experience Bullets (Required/Preferred/Heavily Emphasized)
2. **REORDER_BULLETS**: Change bullet order at a company (put JD-heavy skills first)
3. **MODIFY_BULLET**: Update existing bullet to add skill/context
4. **MERGE_BULLETS**: Combine two bullets (reduces count by 1)
5. **ENHANCE_METRIC**: Make existing metric more specific/impressive
6. **DELETE_SKILL**: Remove skill that has zero evidence and zero JD relevance
7. **ENHANCE_SKILL_EVIDENCE**: Strengthen weak/vague skill evidence with specific context
8. **ADD_BONUS_SKILL**: Add supporting skill that complements required skills naturally

====================================================
QUALITY CHECKLIST (CRITICAL BEFORE RETURNING)
====================================================

Before returning optimization points, verify:
□ Added ALL required JD skills to both Skills AND Experience Bullets  
□ Preferred/nice-to-have skills added credibly with evidence
□ Secondary skills integrated contextually, not dominating
□ Every kept skill has evidence or is JD-relevant
□ Reordered bullets to put most relevant first (JD-heavy skills in top positions)
□ Every change sounds natural and interview-safe
□ No keyword stuffing or robotic patterns
□ Would a recruiter trust this resume?
□ Every optimization point includes evidence level & reasoning
□ Identified any skills for potential deletion with clear rationale

====================================================
OUTPUT RULES
====================================================

Return 8-20 optimization points ONLY.
NO preamble, explanations, or commentary.
Start directly with "POINT 1:"
Include Skill_Category, Evidence_Level, and Reasoning for each skill addition

Focus on HIGH-IMPACT changes:
- Adding missing JD skills naturally with hands-on evidence
- Reordering bullets for relevance
- Enhancing weak skill evidence with specific context

Begin output:
`;


    // analysisKey already declared earlier
    const optimizationPoints = await generateAIContent(optimizationPrompt, aiProvider, analysisKey);
    const pointCount = (optimizationPoints.match(/POINT \d+:/g) || []).length;
    console.log(`✅ Generated ${pointCount} optimization points`);
    console.log(`✅ optimization points -----> ${optimizationPoints} `);
    // Extract filename
let suggestedFileName = null;

// 1) If AI explicitly returns FILENAME, use it
const filenameMatch = optimizationPoints.match(/FILENAME:\s*(.+?)(?:\n|$)/i);
if (filenameMatch && filenameMatch[1]) {
  suggestedFileName = filenameMatch[1].trim();
  console.log(`📝 Suggested filename from AI: ${suggestedFileName}`);
}

// 2) Otherwise generate from JD detected role + company
if (!suggestedFileName) {
  const roleTitle = detectRoleFromJD({ position, jobDescription });
  suggestedFileName = buildResumeFileName({ roleTitle, companyName });
  console.log(`📝 Generated filename from JD role: ${suggestedFileName}`);
}


    // Step 5: Rewrite resume
    console.log('✍️ Step 5: Rewriting resume...');

    // Replace the rewritePrompt variable with this:

// Replace the rewritePrompt variable with this:

const rewritePrompt = `You are a senior technical resume writer and hiring manager.

GOAL
- Rewrite resume content strictly based on the Job Description
- Keep resume HUMAN written and INTERVIEW SAFE
- Preserve formatting via Google Docs template
- Output STRICT JSON ONLY
- Do NOT add explanations or commentary

==============================
NON NEGOTIABLE RULES
==============================

BULLET FORMAT (MANDATORY)
- Every bullet MUST follow:
  {Action Verb} + {Task or Project} + {Quantified Result or Improvement}

BULLET COUNT PER ROLE (STRICT)
- Each ROLE MUST have between 8 and 10 bullets only
- Minimum: 8 bullets
- Maximum: 10 bullets
- DO NOT exceed 10 bullets
- DO NOT add filler or weak bullets just to reach 10
- If only 8 or 9 strong bullets exist, stop at that count
- If returning 8 or 9 bullets, return an array with only 8 or 9 items (do NOT include empty strings).


METRICS RULES (STRICT)
- Per ROLE:
  - Minimum: 1 metric bullet
  - Maximum: 2 metric bullets
  - Absolute max: 3 metrics only if role scope genuinely requires it
- Use round numbers only (30%, 99.9%, etc..)
- No metric stuffing
- No fake precision

SKILL EVIDENCE RULE (CRITICAL)
- EVERY skill listed in TECHNICAL SKILLS MUST:
  - Appear explicitly in EXPERIENCE bullets
  - Be demonstrated as hands-on work
  - Never be implied or vague
- No skill is allowed to exist only in Skills section

JD MANDATORY SKILLS (CRITICAL)
- ALL mandatory / required JD skills MUST:
  - Be added to Technical Skills
  - Be clearly demonstrated in experience bullets with specific context
  - Be used naturally, not keyword stuffed

SKILLS GOVERNANCE & PRUNING RULES (CRITICAL)

CATEGORY GOVERNANCE RULES (STRICT)
- Use standard IT industry technical category names only.
- Rename a category ONLY if the JD explicitly uses a different standard wording.
- Minimum 5 categories, maximum 13 categories.
- Do NOT invent creative or resume-specific category names.
- Each skill must appear in exactly ONE category.
- Prefer reusing existing categories before creating a new one.
- If a category has no valid skills, return empty string for both CAT_x and SKILL_x.


DELETION RULES (BE BOLD):
- DELETE if skill is "very majorly NOT required" for JD:
  - Zero relevance to JD requirements
  - Contradicts primary job focus (e.g., data science skills for frontend role)
  - Confuses or distracts from core profile
  - Completely unused in any bullet point
  - Appears only in Skills section with no supporting evidence
  
RETENTION RULES (BE SELECTIVE):
- KEEP if skill is:
  - Strongly required by JD → demonstrate clearly in bullets
  - Moderately relevant to JD → demonstrate with specific context
  - Lightly required or supportive → KEEP but do NOT dominate
  - Supporting skill that enables required skills to work
  
- DO NOT LET LIGHTLY REQUIRED SKILLS DOMINATE:
  - Do not give them prominent placement in Skills section
  - Do not create bullets solely to showcase them
  - Let them appear naturally as supporting evidence
  - Place at end of relevant skill categories, not beginning

SKILL RELEVANCE SCORING:
- **Critical (MUST KEEP)**: Skill explicitly in JD required section
- **High (KEEP & SHOWCASE)**: Skill appears 3+ times in JD or described as "must-have"
- **Medium (KEEP & SUPPORT)**: Skill mentioned as preferred or appears in bullets with good context
- **Low (KEEP SUBTLE)**: Skill slightly relevant, supportive to core profile, no forced evidence
- **Irrelevant (DELETE)**: Skill contradicts or confuses role, zero JD mention, zero bullets evidence

PRIORITY ORDER:
1. Mandatory JD skills (never remove, always demonstrate)
2. Strongly preferred skills (keep, showcase clearly)
3. Supporting/adjacent skills (keep subtly, low prominence)
4. Very majorly irrelevant skills (DELETE boldly)

IMPORTANT:
- Resume should reflect realistic 5+ years engineer profile
- Avoid keyword stuffing - only lightly required skills appear once naturally
- Every kept skill must be justified by JD relevance or supporting bullets
- Every deleted skill must be clearly non-essential or contradictory


TECH STACK PER ROLE (MANDATORY)
- Each ROLE MUST include a TECH STACK line
- Format example:
  Java, Spring Boot, Kafka, PostgreSQL, AWS ECS, Docker

CATEGORY ORDERING RULE (STABILIZES OUTPUT)
- Core categories MUST appear first if present:
  Programming Languages
  Backend Development
  Frontend Development
- Infrastructure and tooling categories MUST appear later:
  Cloud and Infrastructure
  CI/CD and DevOps
  Databases and Caching
- This improves readability and recruiter scanning

VERB RULES (REALISM & HUMAN SIGNALS)
- No two bullets in the same role should start with the same verb
- "Implemented" should be used sparingly and not exceed 2 to 5 times across the entire resume
- "Developed" should be used sparingly and not exceed 2 to 5 times across the entire resume
- Prefer strong, natural verbs such as:
  Built, Designed, Optimized, Automated, Integrated, Deployed
- Use "Engineered" ONLY when the work involved:
  - system-level design, OR
  - scalability concerns, OR
  - complex technical problem solving
  Avoid using "Engineered" for simple or routine tasks
- "Engineered" must not exceed 1 usage across the entire resume.
- Use "Led" ONLY when real technical ownership or leadership existed
  Do NOT imply people management


CAREER GROWTH & SENIORITY CONTROL (CRITICAL)
- Resume MUST show realistic career progression from early-career to mid-level engineer
- Early roles MUST focus on:
  execution, implementation, bug fixes, feature development, learning systems
- Mid roles MUST show:
  module ownership, integrations, performance improvements, reliability work
- Current role MAY show broader impact but MUST NOT appear:
  principal-level, staff-level, or architect-level

SENIORITY CAPS (NON-NEGOTIABLE)
- DO NOT use phrases such as:
  "enterprise-wide", "organization-wide", "company-wide strategy"
- DO NOT portray ownership of entire platform architecture
- DO NOT imply authority over multiple teams
- Leadership MUST be technical ownership only, not people management

VERB SENIORITY CONTROL
- "Architected" is ONLY allowed if JD explicitly mentions:
  - Architecture, system design, architectural decisions, design patterns, scalable systems, platform design
- If JD does NOT require architecture → DO NOT use "Architected" anywhere
- If JD requires architecture → Max 1 time total (only in most recent relevant role)
- Prefer simpler verbs in early roles:
  Built, Implemented, Supported, Fixed, Enhanced
- More advanced verbs allowed ONLY in the most recent role

REALISM CHECK (MANDATORY)
- Resume must feel appropriate for a strong 5+ years engineer
- Resume must NOT read like 7–8+ years, Staff, or Principal level
- Every bullet must be something the candidate could reasonably explain in interview

AI / GENAI ENRICHMENT (CONDITIONAL AND SAFE)
- AI / GenAI skills MAY be added ONLY IF:
  - JD mentions AI, ML, LLMs, automation, analytics, or GenAI
  - OR AI experience naturally strengthens the role
- Allowed AI skills (use selectively):
  OpenAI API, Azure OpenAI, AWS Bedrock, LangChain, LlamaIndex,
  Embeddings, Vector Databases, RAG pipelines
- AI skills MUST:
  - Be demonstrated with hands-on bullets
  - Support real systems (search, automation, data processing)
  - Follow Action + Task + Impact
- NEVER add AI skills without proof in bullets

LANGUAGE QUALITY
- No buzzwords
- No marketing language
- No fluff
- Write like a real engineer explaining real work

==============================
INPUTS
==============================

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

==============================
OUTPUT FORMAT
==============================

Return ONLY valid JSON.
NO markdown.
NO backticks.
NO text before or after JSON.

==============================
JSON SCHEMA
==============================

{
  "SUMMARY": "Min 6 to 7 lines max. Technical, concise, JD aligned.",

  "CAT_1": "standard IT category name or empty string",
  "SKILL_1": "comma separated skills or empty string",

  "CAT_2": "standard IT category name or empty string",
  "SKILL_2": "comma separated skills or empty string",

  "CAT_3": "standard IT category name or empty string",
  "SKILL_3": "comma separated skills or empty string",

  "CAT_4": "standard IT category name or empty string",
  "SKILL_4": "comma separated skills or empty string",

  "CAT_5": "standard IT category name or empty string",
  "SKILL_5": "comma separated skills or empty string",

  "CAT_6": "standard IT category name or empty string",
  "SKILL_6": "comma separated skills or empty string",

  "CAT_7": "standard IT category name or empty string",
  "SKILL_7": "comma separated skills or empty string",

  "CAT_8": "standard IT category name or empty string",
  "SKILL_8": "comma separated skills or empty string",

  "CAT_9": "standard IT category name or empty string",
  "SKILL_9": "comma separated skills or empty string",

  "CAT_10": "standard IT category name or empty string",
  "SKILL_10": "comma separated skills or empty string",

  "CAT_11": "standard IT category name or empty string",
  "SKILL_11": "comma separated skills or empty string",

  "CAT_12": "standard IT category name or empty string",
  "SKILL_12": "comma separated skills or empty string",

  "CAT_13": "standard IT category name or empty string",
  "SKILL_13": "comma separated skills or empty string",




  "CERT_1": "string",
  "CERT_2": "string",
  "CERT_3": "string",
  "CERT_4": "string",
  "CERT_5": "string or empty",

  "TRUIST_TECH_STACK": "comma separated tech stack",
  "TRUIST_B": ["8 to 10 bullet strings, no empty strings"],

  "ACC_TECH_STACK": "comma separated tech stack",
  "ACC_B": ["8 to 10 bullet strings, no empty strings"],

  "HCL_TECH_STACK": "comma separated tech stack",
  "HCL_B": ["8 to 10 bullet strings, no empty strings"],  

  "PAY_B": ["b1","b2","b3"],
  "CLIN_B": ["b1","b2","b3"],
  "RAG_B": ["b1","b2","b3"],
  "SEARCH_B": ["b1","b2","b3"],

  "EDU_1": "Southern Arkansas University",
  "EDU_2": "Master’s Degree, Computer and Information Science"
}

==============================
FINAL VALIDATION
==============================

- Each role has 8 to 10 bullets
- Each role has 1 to 2 metric bullets (max 3 only if required)
- Every skill in Skills is proven in bullets
- Every JD mandatory skill is proven in bullets
- AI skills appear only if justified and proven
- Career growth feels appropriate for a 5+ years engineer
- Resume does NOT read like 7–8+ years or Staff level

ANTI-TAILORING VALIDATION
- JD keywords are naturally distributed, NOT clustered in consecutive bullets
- NO consecutive high-keyword bullets (detect clustering)
- Metrics are realistic (no 9999%, 500x, or inflated claims)
- Skills spread across multiple roles (not concentrated in one job)
- Language is multi-company reusable (no company-specific wording)
- NULL spot check: If 85%+ of bullets contain JD keywords → flag as over-tailored → reduce to 65-80%
- NULL spot check: If any single keyword appears 8+ times → flag as keyword stuffing → reduce to 2-6x
- Output is strict JSON only
`;
    // rewriteKey already declared earlier
    const optimizedResume = await generateAIContent(rewritePrompt, aiProvider, rewriteKey);
    let resumeJson;
try {
  const raw = (optimizedResume || '').trim();

  // hard guard: must be JSON only
  if (!raw.startsWith('{') || !raw.endsWith('}')) {
    throw new Error('AI did not return strict JSON only');
  }

  resumeJson = JSON.parse(raw);
  
  // Debug log - preview CAT/SKILL mapping
  console.log('🧪 CAT/SKILL preview:', {
    CAT_1: resumeJson.CAT_1, SKILL_1: resumeJson.SKILL_1,
    CAT_2: resumeJson.CAT_2, SKILL_2: resumeJson.SKILL_2,
    CAT_3: resumeJson.CAT_3, SKILL_3: resumeJson.SKILL_3
  });
  
  // ADD THIS LINE - Validate skill categories immediately after JSON parse
  validateSkillCategories(resumeJson);
  
} catch (e) {
  console.log('❌ Rewrite JSON parse failed. Preview:', (optimizedResume || '').slice(0, 400));
  throw new Error(`Rewrite JSON parse failed: ${e.message}`);
}


function validateSkillCategories(resumeJson) {
  const seen = new Set();
  
  for (let i = 1; i <= 13; i++) {
    const catKey = `CAT_${i}`;
    const skillKey = `SKILL_${i}`;

    const cat = (resumeJson[catKey] || '').toString().trim();
    const skills = (resumeJson[skillKey] || '').toString().trim();

    // Either both exist or both empty
    const catEmpty = cat.length === 0;
    const skillsEmpty = skills.length === 0;

    if (catEmpty !== skillsEmpty) {
      throw new Error(`Invalid skills mapping at ${catKey}/${skillKey}. Both must be filled or both empty.`);
    }

    // Prevent nonsense categories
    if (!catEmpty && cat.length < 3) {
      throw new Error(`Invalid category name at ${catKey}: "${cat}"`);
    }

    // Check for duplicate category names
    if (!catEmpty) {
      const key = cat.toLowerCase();
      if (seen.has(key)) {
        throw new Error(`Duplicate skill category detected: "${cat}"`);
      }
      seen.add(key);
    }
  }

  return true;
}

function validateBullets(arr, label) 
{
  if (!Array.isArray(arr)) {
    throw new Error(`${label} must be an array`)
  }

  const clean = arr
    .map(x => (typeof x === 'string' ? x.trim() : ''))
    .filter(x => x.length > 0)

  if (clean.length < 8) {
    throw new Error(`${label} must have 8 to 10 bullets, got ${clean.length}`)
  }

  if (clean.length > 10) {
    console.log(`⚠️ ${label} returned ${clean.length} bullets, trimming to 10`)
    return clean.slice(0, 10)
  }

  return clean
}




const truistBullets = validateBullets(resumeJson.TRUIST_B, 'TRUIST_B');
const accBullets = validateBullets(resumeJson.ACC_B, 'ACC_B');
const hclBullets = validateBullets(resumeJson.HCL_B, 'HCL_B');

    console.log(`✅ Resume rewritten (${optimizedResume.length} chars)`)
    console.log(`Rewrite resume ======> ${optimizedResume}`)

    // ========== BRUTAL VALIDATION CHECK ==========
    console.log('\n' + '='.repeat(80));
    console.log('🔍 UPDATED RESUME - HM BRUTAL VALIDATION CHECKS (NO SUGAR COAT)');
    console.log('='.repeat(80));
    
    const validationReport = performBrutalResumeValidation({
      jobDescription,
      resumeJson,
      resumeType,
      truistBullets,
      accBullets,
      hclBullets
    });

    // Step 6: Pick filename
    console.log('📄 Step 6: Preparing template resume doc...')
    let fileName = suggestedFileName
    if (!fileName) {
      const timestamp = new Date().toISOString().replace(/[-:]/g, '').split('.')[0]
      fileName = `SaiKiran_Optimized_${timestamp}`
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
    // ===== SKILL CATEGORY CLEANUP (NEW) =====
for (let i = 1; i <= 13; i++) {
  const cat = (resumeJson[`CAT_${i}`] || '').trim()
  const skill = (resumeJson[`SKILL_${i}`] || '').trim()

  if (!cat || !skill) {
    resumeJson[`CAT_${i}`] = removeMarker
    resumeJson[`SKILL_${i}`] = removeMarker
  }
}

    const payBullets = cleanFixedBullets(resumeJson.PAY_B || [], 'PAY_B', 3)
    const clinBullets = cleanFixedBullets(resumeJson.CLIN_B || [], 'CLIN_B', 3)
    const ragBullets = cleanFixedBullets(resumeJson.RAG_B || [], 'RAG_B', 3)
    const searchBullets = cleanFixedBullets(resumeJson.SEARCH_B || [], 'SEARCH_B', 3)

    const replacements = {
  '{{SUMMARY}}': resumeJson.SUMMARY || '',

  '{{CAT_1}}': resumeJson.CAT_1 || '',
  '{{SKILL_1}}': resumeJson.SKILL_1 || '',

  '{{CAT_2}}': resumeJson.CAT_2 || '',
  '{{SKILL_2}}': resumeJson.SKILL_2 || '',

  '{{CAT_3}}': resumeJson.CAT_3 || '',
  '{{SKILL_3}}': resumeJson.SKILL_3 || '',

  '{{CAT_4}}': resumeJson.CAT_4 || '',
  '{{SKILL_4}}': resumeJson.SKILL_4 || '',

  '{{CAT_5}}': resumeJson.CAT_5 || '',
  '{{SKILL_5}}': resumeJson.SKILL_5 || '',

  '{{CAT_6}}': resumeJson.CAT_6 || '',
  '{{SKILL_6}}': resumeJson.SKILL_6 || '',

  '{{CAT_7}}': resumeJson.CAT_7 || '',
  '{{SKILL_7}}': resumeJson.SKILL_7 || '',

  '{{CAT_8}}': resumeJson.CAT_8 || '',
  '{{SKILL_8}}': resumeJson.SKILL_8 || '',

  '{{CAT_9}}': resumeJson.CAT_9 || '',
  '{{SKILL_9}}': resumeJson.SKILL_9 || '',

  '{{CAT_10}}': resumeJson.CAT_10 || '',
  '{{SKILL_10}}': resumeJson.SKILL_10 || '',

  '{{CAT_11}}': resumeJson.CAT_11 || '',
  '{{SKILL_11}}': resumeJson.SKILL_11 || '',

  '{{CAT_12}}': resumeJson.CAT_12 || '',
  '{{SKILL_12}}': resumeJson.SKILL_12 || '',

  '{{CAT_13}}': resumeJson.CAT_13 || '',
  '{{SKILL_13}}': resumeJson.SKILL_13 || '',



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

    // Step 9.5: Smoke test - verify technical skills
    console.log('✅ Final Technical Skills Preview:');
    const skillsPreview = Array.from({ length: 13 }, (_, i) => ({
      category: resumeJson[`CAT_${i+1}`] || '[empty]',
      skills: resumeJson[`SKILL_${i+1}`] || '[empty]'
    }));
    console.log(JSON.stringify(skillsPreview, null, 2));

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
    console.error('❌ Optimization Error:', {
      message: error.message,
      stack: error.stack,
      type: error.constructor.name
    });
    
    // Determine error type and send appropriate response
    let statusCode = 500;
    let errorMessage = 'Resume optimization failed';
    let errorDetails = error.message;

    if (error.message.includes('invalid_grant') || error.message.includes('refresh token')) {
      statusCode = 401;
      errorMessage = 'Google authentication token expired';
      errorDetails = 'Please regenerate your Google OAuth tokens by running: node get-token.js';
    } else if (error.message.includes('not found') || error.message.includes('403')) {
      statusCode = 403;
      errorMessage = 'Access denied to Google resources';
      errorDetails = 'Check that document IDs and folder IDs in .env are correct and accessible';
    } else if (error.message.includes('too large') || error.message.includes('context_length_exceeded')) {
      statusCode = 413;
      errorMessage = 'Content too large for processing';
      errorDetails = 'Please use Manual JD Input with a shorter job description';
    } else if (error.message.includes('ECONNREFUSED')) {
      statusCode = 503;
      errorMessage = 'Database connection failed';
      errorDetails = 'PostgreSQL database is not running or inaccessible';
    } else if (error.message.includes('timeout')) {
      statusCode = 504;
      errorMessage = 'API request timeout';
      errorDetails = 'The AI service took too long to respond. Please try again with a shorter job description';
    } else if (error.message.includes('Invalid')) {
      statusCode = 400;
      errorMessage = 'Invalid request';
      errorDetails = error.message;
    }

    res.status(statusCode).json({
      success: false,
      error: errorMessage,
      details: errorDetails,
      timestamp: new Date().toISOString()
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
    throw new Error(`Invalid JSON format. Expected JSON object. Got: "${raw.substring(0, 300)}..."`);
  }
  
  const jsonStr = raw.slice(start, end + 1);
  
  try {
    const parsed = JSON.parse(jsonStr);
    
    // Validate it's an object, not an array
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('Expected JSON object, got: ' + typeof parsed);
    }
    
    return parsed;
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error(`JSON parsing error: ${error.message}\nContent: ${jsonStr.substring(0, 200)}`);
    }
    throw error;
  }
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

  p {
    margin: 2pt 0;
    text-align: left;
  }

  .company-line {
    font-size: 10pt;
    font-weight: bold;
    margin-top: 8pt;
    margin-bottom: 2pt;
  }

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

  let bullets = [];

  function flushBullets() {
    if (!bullets.length) return;
    html += `<ul>`;
    for (const b of bullets) html += `<li>${processBoldText(b)}</li>`;
    html += `</ul>`;
    bullets = [];
  }

  while (i < lines.length) {
    const line = lines[i];

    // Section headers
    if (isSectionHeader(line) && !line.startsWith('•')) {
      flushBullets();
      html += `<div class="section-header">${line.toUpperCase()}</div>`;

      const u = line.toUpperCase();
      inSkills = u === 'TECHNICAL SKILLS';
      inCerts = u === 'CERTIFICATIONS & AWARDS';
      inExperience = u === 'PROFESSIONAL EXPERIENCE';
      inProjects = u === 'KEY PROJECTS';
      inEducation = u === 'EDUCATION';
      i += 1;
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

    // Project title lines inside KEY PROJECTS (not bullets)
    if (inProjects && !line.startsWith('•') && !isSectionHeader(line) && !line.includes(':')) {
      // Treat short lines as project titles
      if (line.length <= 80) {
        flushBullets();
        html += `<div class="project-title">${processBoldText(line)}</div>`;
        i += 1;
        continue;
      }
    }

    // Bullets in Experience and Projects
    if ((inExperience || inProjects) && (line.startsWith('•') || line.startsWith('-') || line.startsWith('*'))) {
      const bulletText = line.replace(/^[•*-]\s*/, '').trim();
      if (bulletText) bullets.push(bulletText);
      i += 1;
      continue;
    }

    // Skills lines
    if (inSkills) {
      flushBullets();
      html += `<p class="skills-line">${processBoldText(line)}</p>`;
      i += 1;
      continue;
    }

    // Certifications lines
    if (inCerts) {
      flushBullets();
      html += `<p class="cert-line">${processBoldText(line.replace(/^[•*-]\s*/, ''))}</p>`;
      i += 1;
      continue;
    }

    // Education lines
    if (inEducation) {
      flushBullets();
      html += `<p>${processBoldText(line)}</p>`;
      i += 1;
      continue;
    }

    // Default paragraph
    flushBullets();
    html += `<p>${processBoldText(line)}</p>`;
    i += 1;
  }

  flushBullets();
  html += `</body></html>`;
  return html;
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
const server = app.listen(PORT, () => {
  console.log(`\n🚀 Resume Optimizer Backend Running!`);
  console.log(`📍 http://localhost:${PORT}`);
  console.log(`✅ Health: http://localhost:${PORT}/health`);
  console.log(`🤖 Supports: Gemini AI & ChatGPT`);
  console.log(`🎯 ATS Target: 100% Match Rate`);
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

