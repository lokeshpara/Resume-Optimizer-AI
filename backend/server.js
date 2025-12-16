const express = require('express');
const cors = require('cors');
const axios = require('axios');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { google } = require('googleapis');
require('dotenv').config();

const app = express();
const PORT = 3000;

// Middleware
app.use(cors());
app.use(express.json());

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

// Configuration
const ORIGINAL_RESUME_DOC_ID = process.env.ORIGINAL_RESUME_DOC_ID;
const DRIVE_FOLDER_ID = process.env.DRIVE_FOLDER_ID;
const TRACKING_SHEET_ID = process.env.TRACKING_SHEET_ID;

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

    // Step 4: Get original resume
    console.log('📋 Step 4: Fetching original resume...');
    const resumeDoc = await docs.documents.get({
      documentId: ORIGINAL_RESUME_DOC_ID
    });
    const originalResume = extractTextFromDoc(resumeDoc.data);
    console.log(`✅ Resume fetched (${originalResume.length} chars)`);

    // Step 5: Generate optimization points
    console.log('💡 Step 5: Generating optimization points...');

    const optimizationPrompt = `You are an expert ATS analyzer. Generate 20 to 35+ HIGH-QUALITY optimization points to achieve a 100% ATS match.

===========================
INPUT RESUME:
${originalResume}

INPUT JOB DESCRIPTION:
${jobDescription}

PORTAL ANALYSIS & WINNING STRATEGY:
${atsAnalysis.fullAnalysis}
===========================

YOUR MISSION:
Analyze EVERY section of the resume and generate specific, actionable optimization points.
Generate AS MANY points as needed to achieve 100% ATS match.
Each point MUST be concise, targeted, and aligned to the JD.
This candidate is applying through ${atsAnalysis.portalName}. Your job is to create the PERFECT resume that will:
1. Score 100% match with the job description
2. Get prioritized by ${atsAnalysis.portalName}'s algorithm
3. Guarantee the candidate gets shortlisted from hundreds of applicants

GENERATE AS MANY OPTIMIZATION POINTS AS NEEDED (no limit - could be 30, 50, or even 70+ points if that's what it takes to win).

====================================================
===== CRITICAL SUCCESS REQUIREMENTS =====
====================================================

1. 100% JD ALIGNMENT
   - Every single keyword from JD must appear in resume
   - Every required skill must be present AND proven with experience
   - Match the JD's language, terminology, and phrasing style

2. PORTAL-SPECIFIC OPTIMIZATION
   - Use the portal analysis above to optimize specifically for ${atsAnalysis.portalName}
   - Understand what ${atsAnalysis.portalName}'s algorithm prioritizes
   - Adapt your strategy based on the WINNING_STRATEGY section above
   - Focus on the CRITICAL_SUCCESS_FACTORS identified above

3. MISSING SKILLS INTEGRATION (CRITICAL)
   For EVERY skill in JD that's missing from resume:
   - Add to Skills section
   - Create realistic Experience bullet showing actual usage
   - Include believable metrics (30-50% improvements)
   - Place in most logical company/project context
   - Make it interview-ready

----------------------------------------------------
===== MISSING SKILLS RULE (CRITICAL) =====
----------------------------------------------------

For EVERY skill mentioned in the JD that is NOT in the resume (Make sure to add all missing skills):

STEP 1: Add that skill to the Skills section
STEP 2: Create a corresponding Experience enhancement point

REQUIREMENTS:
- Find the most realistic place in Experience section to add this skill
- Add a strong bullet showing actual usage with impact metrics
- Metrics MUST be realistic and achievable (e.g., "improved X by 30-50%")
- If the skill fits naturally with an existing bullet, enhance that bullet
- If not, add a new bullet in the most relevant company/project
- EVERY missing JD skill MUST have both Skills + Experience points

EXAMPLE - If JD requires "Docker" but resume doesn't have it:

POINT X:
Section: Skills
Type: ADD
What: Docker
Where: DevOps & Cloud Tools
Position: Beginning
Bold: YES
Why: JD requires containerization

POINT X+1:
Section: Experience
Company: [Most relevant company]
Bullet: [Number] OR Add new bullet
What: containerized microservices using Docker, reducing deployment time by 40% and improving scalability
Where: [Realistic location in that bullet]
MoveTo: 3 (if JD-critical)
Bold: Docker, containerized, microservices
Why: Demonstrates Docker expertise required in JD with measurable impact

----------------------------------------------------
===== GLOBAL BOLDING RULES =====
----------------------------------------------------
• Bold JD keywords ONLY inside the SKILLS section.
• Do NOT bold ANYTHING in Summary or Experience unless an optimization point explicitly instructs it.

----------------------------------------------------
===== SUMMARY SECTION ANALYSIS =====
----------------------------------------------------

STRICT SUMMARY BULLET FORMAT (MANDATORY):
• Every Summary bullet MUST begin with “• ”
• NEVER use hyphens (-) or plain text lines.
• Each bullet MUST be 1–2 full professional sentences.
• NO fragment bullets allowed.
• Add ONLY 1–3 new bullets.
• Every new bullet MUST include:
  – JD keywords in natural context
  – metrics or scale (when possible)
  – distributed systems / API / cloud / performance themes

POSITIONING RULE (CRITICAL):
• If you add a new JD-relevant bullet → you MUST specify:
  MoveTo: 2  OR  MoveTo: 3
• Most important bullets MUST appear early for ATS.

SUMMARY POINT FORMAT:

POINT X:
Section: Summary
What: Full 1–2 sentence bullet
Where: Add new bullet OR modify bullet #
MoveTo: 2 or 3 (MANDATORY for new bullets)
Why: ATS relevance
Scale: 1–10

----------------------------------------------------
===== SKILLS SECTION ANALYSIS =====
----------------------------------------------------

SKILLS TABLE MUST FOLLOW THIS EXACT FORMAT:

SKILLS

 Category Name               | Skill1, Skill2, Skill3, ...
 Category Name               | Skill1, Skill2, Skill3, ...

STRICT RULES:
1. One row per category.
2. NO bullets, NO markdown tables, NO line breaks inside a row.
3. JD keywords MUST be bolded only here.
4. Skills MUST remain comma-separated on one line.

SKILL POINT TYPES:
TYPE 1 - ADD SKILL  
TYPE 2 - DELETE SKILL  
TYPE 3 - MODIFY / BOLD SKILL  
TYPE 4 - REORDER SKILL  
TYPE 5 - MERGE CATEGORY  

SKILL POINT FORMAT:

POINT X:
Section: Skills
Type: ADD / DELETE / MODIFY / REORDER / MERGE
What: Skill or change
Where: Category Name
Position: Beginning / End (if relevant)
Bold: YES/NO
Why: ATS relevance

----------------------------------------------------
===== EXPERIENCE SECTION ANALYSIS =====
----------------------------------------------------

STRICT EXPERIENCE FORMAT RULE:
• Every Experience bullet MUST begin with “• ”
• NEVER use hyphens (-) or unformatted lines.
• Each bullet MUST be 1–2 full sentences.
• NO keyword fragments.
• Enhancements MUST integrate JD terms naturally.
• Bold ONLY if an optimization point explicitly instructs it.

BULLET PRIORITY RULE (CRITICAL):
• If an enhancement is strongly JD-aligned:
  MoveTo: 2  OR  MoveTo: 3
• This places JD-relevant bullets early → highest ATS impact.

EXPERIENCE POINT FORMAT:

POINT X:
Section: Experience
Company: [Company Name]
Bullet: X
What: Full 1–2 sentence enhancement phrase
Where: beginning / after phrase / end OR Add new bullet
MoveTo: 2 or 3 (ONLY if JD-critical)
Bold: list JD terms to bold (if needed)
Why: JD relevance

----------------------------------------------------
===== CONSOLIDATION / MERGING =====
----------------------------------------------------

POINT FORMAT:
Section: Skills
Type: MERGE
What: Merge Category A → Category B
How: List specific skills moved
Why: JD expectation or simplification

----------------------------------------------------
===== FILENAME SUGGESTION =====
----------------------------------------------------

OUTPUT:
FILENAME: Lokesh_Para_[Position]_[Company]

----------------------------------------------------
===== OUTPUT FORMAT =====
----------------------------------------------------

Return ONLY optimization points in this EXACT structure:

POINT 1:
Section: Summary
What: ...
Where: ...
MoveTo: ...
Why: ...
Scale: 1–10

POINT 2:
Section: Skills
Type: ADD
What: ...
Where: ...
Position: ...
Bold: YES/NO
Why: ...

POINT 3:
Section: Experience
Company: ...
Bullet: ...
What: ...
Where: ...
MoveTo: ...
Bold: YES/NO
Why: ...

Continue generating points until:
1. ALL missing JD skills are added to Skills + backed by Experience points
2. ALL existing sections are optimized for ATS match
3. Target: 100% ATS match achieved

Total points may exceed 35 if needed to cover all JD requirements.
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
      suggestedFileName = `Lokesh_Para_${posClean}_${compClean}`;
      console.log(`📝 Generated filename from extracted data: ${suggestedFileName}`);
    }

    // Step 5: Rewrite resume
    console.log('✍️ Step 5: Rewriting resume...');

    const rewritePrompt = `You are an ATS optimization expert. Rewrite the resume using ALL optimization points EXACTLY as specified.

===========================
INPUT RESUME:
${originalResume}

INPUT OPTIMIZATION POINTS:
${optimizationPoints}

INPUT JOB DESCRIPTION:
${jobDescription}

PORTAL INFORMATION:
Applying through: ${atsAnalysis.portalName}
Portal URL: ${jobPostUrl}

PORTAL STRATEGY:
${atsAnalysis.fullAnalysis}
===========================

====================================================
===== YOUR MISSION =====
====================================================

Rewrite this resume to be PERFECT for ${atsAnalysis.portalName}.

This resume must:
✅ Score 100% match with the job description
✅ Be optimized specifically for ${atsAnalysis.portalName}'s algorithm
✅ Get this candidate shortlisted from hundreds of applicants
✅ Be completely interview-ready and honest

Use the portal analysis above to understand what ${atsAnalysis.portalName} prioritizes and adapt accordingly.


====================================================
===== GLOBAL RULES (CRITICAL – DO NOT VIOLATE) =====
====================================================

1. Return the FULL resume (Summary, Skills, ALL Experience, Education). 
2. NEVER remove a job, bullet, or company.
3. EVERY bullet across Summary and Experience MUST:
   • start with “• ”
   • be 1–2 full sentences (NO fragments)
   • contain bolded JD keywords automatically
4. JD keywords MUST be bolded in:
   • Summary
   • Experience
5. JD keywords MUST be bolded ONLY inside SKILLS for technical terms.
6. NO hyphens (“-”) for bullets — ONLY “• ”
7. NO missing sections, no truncation.

====================================================
===== BULLET REORDERING RULE (CRITICAL) =====
====================================================

If an optimization point contains:

MoveTo: <number>

→ You MUST move that bullet to EXACTLY that bullet number  
→ Applies to BOTH Summary and Experience sections.  
→ Preserve formatting.

====================================================
===== SUMMARY REWRITE RULES =====
====================================================

• Rewrite the Summary in bullet “• ” format only.
• Each bullet = 1–2 sentences.
• Insert new bullets exactly where optimization points say.
• Apply MoveTo positioning precisely.
• Automatically bold ALL JD keywords inside the Summary.

====================================================
===== SKILLS REWRITE RULES (STRICT FORMAT) =====
====================================================

The SKILLS section MUST be rewritten EXACTLY like this:

SKILLS

 Category Name | item1, item2, item3, item4
 Category Name | item1, item2, item3
 Category Name | item1, item2, item3, item4, item5

STRICT RULES:
1. ONE row per category.
2. ONE line per row — NO wrapping.
3. NO markdown tables.
4. NO separators like “----”.
5. NO extra headers except the word SKILLS.
6. JD terms MUST be bolded ONLY in skills list (not category names).

If Skills are not in correct format, RECONSTRUCT THEM PROPERLY.

====================================================
===== EXPERIENCE REWRITE RULES =====
====================================================

- Keep ALL companies and ALL bullets.
- Each bullet MUST:
   – start with "• "
   – be 1–2 full sentences
   – integrate JD terms naturally
   – automatically bold JD keywords
- Insert enhancements exactly where optimization points specify.
- Apply MoveTo ordering exactly.
- Bold ONLY specific JD terms (not entire sentences).

CRITICAL - NEW SKILL INTEGRATION:
- When optimization points add a NEW skill that wasn't in original resume:
  – The corresponding Experience bullet MUST sound realistic and natural
  – Metrics MUST be believable (30-50% improvements, not 200%)
  – The skill MUST fit the company/project context logically
  – If adding to existing bullet, blend it seamlessly
  – If creating new bullet, place it where it makes most sense
- Example: Adding "Docker" to LPL Financial makes sense (FinTech uses containers)
- Example: Adding "Docker" to YES Bank also makes sense (Banking systems)
- Choose the MOST realistic placement based on company type and project

====================================================
===== FINAL OUTPUT =====
====================================================

Return ONLY the full rewritten resume in perfect formatting.
No commentary. No explanations. No surrounding text.
`;


    const rewriteKey = aiProvider === 'gemini' ? geminiKey3 : (chatgptKey3 || chatgptApiKey);
    const optimizedResume = await generateAIContent(rewritePrompt, aiProvider, rewriteKey);
    console.log(`✅ Resume rewritten (${optimizedResume.length} chars)`);
    console.log(`Rewrite resume ======> ${optimizedResume}`);

    // Step 6: Convert to HTML
    console.log('🎨 Step 6: Converting to HTML...');
    const styledHtml = convertToStyledHTML(optimizedResume);

    // Step 7: Upload to Google Drive
    console.log('☁️ Step 7: Uploading to Google Drive...');

    let fileName = suggestedFileName;
    if (!fileName) {
      const timestamp = new Date().toISOString().replace(/[-:]/g, '').split('.')[0];
      fileName = `Lokesh_Para_Optimized_${timestamp}`;
    }
    console.log(`📄 Filename: ${fileName}`);

    const file = await drive.files.create({
      requestBody: {
        name: fileName,
        parents: [DRIVE_FOLDER_ID],
        mimeType: 'application/vnd.google-apps.document'
      },
      media: {
        mimeType: 'text/html',
        body: styledHtml
      },
      fields: 'id'
    });

    const fileId = file.data.id;
    const resumeLink = `https://docs.google.com/document/d/${fileId}/edit`;
    console.log('✅ Document created! ID:', fileId);

    // Apply page formatting
    await setDocumentFormatting(fileId);

    // Step 8: Log to Google Sheets
    await logToGoogleSheet({
      companyName: companyName,
      position: position,
      resumeLink: resumeLink,
      jobPostUrl: jobPostUrl,
      contacts: '',
      fileName: fileName
    });

    res.json({
      success: true,
      status: '✅ Resume Optimized Successfully!',
      aiProvider: aiProvider,
      portalName: atsAnalysis.portalName,
      portalAnalysis: atsAnalysis.fullAnalysis,
      keysUsed: aiProvider === 'gemini' ? '3 Gemini keys' : '1 ChatGPT key',
      contentSource: contentSource,
      fileName: fileName,
      companyName: companyName,
      position: position,
      links: {
        editInGoogleDocs: resumeLink,
        downloadPDF: `https://docs.google.com/document/d/${fileId}/export?format=pdf`,
        downloadWord: `https://docs.google.com/document/d/${fileId}/export?format=docx`,
        trackingSheet: `https://docs.google.com/spreadsheets/d/${TRACKING_SHEET_ID}/edit`
      },
      documentId: fileId,
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

// Helper: Extract text from Google Doc
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

// 🔥 UPDATED convertToStyledHTML - Handles ALL 4 skill formats
// Replace your entire convertToStyledHTML function with this:

function convertToStyledHTML(text) {
  const lines = text.split('\n');
  let html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>
  body{font-family:Cambria,serif;font-size:11pt;line-height:1;margin:1cm 1.25cm}
  .name{font-size:18pt;font-weight:bold;text-align:center;margin-bottom:2pt}
  .title{font-size:12pt;font-weight:bold;text-align:center;margin-bottom:2pt}
  .contact{font-size:10pt;text-align:center;margin-bottom:12pt}
  .contact a{color:#000000;text-decoration:none}
  .contact a:hover{text-decoration:underline}
  .section-header{font-size:14pt;font-weight:bold;margin-top:12pt;margin-bottom:6pt}
  .skills-table{
  width:100%;
  border-collapse:collapse;
  margin-top:6pt;
  margin-bottom:12pt;
  border:1pt solid #000;
}

.skills-table td{
  padding:6pt 10pt;
  vertical-align:top;
  border:1pt solid #000;
}

.skills-category{
  font-weight:bold;
  width:28%;
  font-size:10.5pt;
  background:#f7f7f7;
}

.skills-list{
  width:72%;
  font-size:10.5pt;
}

   .company-header{
  font-size:11.5pt;
  font-weight:bold;
  margin-top:8pt;
  margin-bottom:4pt;
  display:flex;
  justify-content:space-between;
  align-items:center;
}

  .job-title-location{flex:1}
  .job-date{text-align:right;white-space:nowrap;margin-left:20pt}
  p{margin:4pt 0;text-align:justify}
  ul{margin:2pt 0;padding-left:0.25in}
  li{margin:4pt 0;text-align:justify}
  </style></head><body>`;

  let inSkills = false;
  let skillsTableOpen = false;
  let currentCategory = '';
  let currentSkills = '';

  // Helper: Convert **text** to <strong>text</strong>
  function convertBold(text) {
    return text.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  }

  // Helper: Convert contact line with clickable links
  function convertContactLinks(text) {
    // Replace LinkedIn URL
    text = text.replace(
      /linkedin\.com\/in\/[\w-]+/gi,
      '<a href="https://www.linkedin.com/in/lokeshpara99">LinkedIn</a>'
    );

    // Replace GitHub URL
    text = text.replace(
      /github\.com\/[\w-]+/gi,
      '<a href="https://github.com/lokeshpara">GitHub</a>'
    );

    // Replace Portfolio URL
    text = text.replace(
      /[\w-]+\.github\.io\/[\w-]+\/?|portfolio\.[\w-]+\.com/gi,
      '<a href="https://lokeshpara.github.io/Portfolio/">Portfolio</a>'
    );

    return text;
  }

  // Helper: Add skill row to table
  function addSkillRow(category, skills) {
    if (category && skills) {
      const cleanCategory = category.trim().replace(/\*\*/g, '').replace(/\*/g, '').replace(/\|/g, '');
      const boldSkills = convertBold(skills.trim());
      html += `  <tr>\n`;
      html += `    <td class="skills-category">${cleanCategory}</td>\n`;
      html += `    <td class="skills-list">${boldSkills}</td>\n`;
      html += `  </tr>\n`;
    }
  }

  // Helper: Check if line is a category name
  function isLikelyCategory(line) {
    // Clean the line
    const cleaned = line.replace(/\|/g, '').trim();

    // Too long to be category
    if (cleaned.length > 100) return false;

    // Has many commas (likely skills)
    if ((cleaned.match(/,/g) || []).length > 2) return false;

    // Starts with lowercase (likely skills)
    if (cleaned[0] && cleaned[0] !== cleaned[0].toUpperCase()) return false;

    // Common category patterns
    const categoryPatterns = [
      /^Programming Languages?/i,
      /^Java.*Ecosystem/i,
      /^Backend/i,
      /^Front.*End/i,
      /^Microservices/i,
      /^Database/i,
      /^AI\/ML/i,
      /^ORM/i,
      /^Messaging/i,
      /^Cloud/i,
      /^DevOps/i,
      /^Testing/i,
      /^Security/i,
      /^Monitoring/i,
      /^Methodologies/i,
      /^Data.*Lake/i,
      /^Query.*Engine/i
    ];

    for (const pattern of categoryPatterns) {
      if (pattern.test(cleaned)) return true;
    }

    // Capitalized and short (likely category)
    if (cleaned.length < 50 && cleaned[0] === cleaned[0].toUpperCase()) {
      return true;
    }

    return false;
  }

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i].trim();
    if (!line) continue;

    // Skip table header lines (markdown style)
    if (line.startsWith('|---') || line.startsWith('| ---')) continue;
    if (line.match(/^\|\s*Category\s+Name\s*\|/i)) continue;

    // Header: Name
    if (i < 3 && line.includes('Lokesh')) {
      html += `<div class="name">${line}</div>\n`;
      continue;
    }

    // Header: Title
    if (i <= 3 && (line.includes('Developer') || line.includes('Engineer')) && line.length < 60) {
      html += `<div class="title">${line}</div>\n`;
      continue;
    }

    // Header: Contact
    if ((line.includes('@') || line.includes('|')) && i < 6) {
      const contactWithLinks = convertContactLinks(line);
      html += `<div class="contact">${contactWithLinks}</div>\n`;
      continue;
    }

    // Section Headers
    if (line === line.toUpperCase() && line.length > 3 && !line.startsWith('*') && !line.startsWith('|')) {
      // Save pending skill row
      if (inSkills && currentCategory && currentSkills) {
        addSkillRow(currentCategory, currentSkills);
        currentCategory = '';
        currentSkills = '';
      }

      // Close skills table
      if (skillsTableOpen) {
        html += `</table>\n`;
        skillsTableOpen = false;
        inSkills = false;
      }

      // Check if SKILLS section
      if (line.includes('SKILL')) {
        inSkills = true;
        html += `<div class="section-header">${line}</div>\n`;
        html += `<table class="skills-table">\n`;
        skillsTableOpen = true;
      } else {
        inSkills = false;
        html += `<div class="section-header">${line}</div>\n`;
      }
      continue;
    }

    // SKILLS SECTION PROCESSING
    if (inSkills && skillsTableOpen) {

      // FORMAT 1: Markdown table format with | on both sides
      // | Programming Languages | Java, Python, SQL |
      if (line.startsWith('|') && line.endsWith('|')) {
        // Save previous row
        if (currentCategory && currentSkills) {
          addSkillRow(currentCategory, currentSkills);
          currentCategory = '';
          currentSkills = '';
        }

        // Parse markdown table row
        const parts = line.split('|').filter(p => p.trim());
        if (parts.length >= 2) {
          currentCategory = parts[0].trim();
          currentSkills = parts.slice(1).join('|').trim();

          // Only add if it looks like actual content (not header)
          if (!currentCategory.match(/Category.*Name/i) && currentSkills.length > 0) {
            addSkillRow(currentCategory, currentSkills);
            currentCategory = '';
            currentSkills = '';
          }
        }
        continue;
      }

      // FORMAT 2: Aligned format with single pipe
      // Programming Languages        | Java, Python, SQL
      if (line.includes('|') && !line.startsWith('|')) {
        // Save previous row
        if (currentCategory && currentSkills) {
          addSkillRow(currentCategory, currentSkills);
          currentCategory = '';
          currentSkills = '';
        }

        // Parse pipe-separated
        const pipeIndex = line.indexOf('|');
        currentCategory = line.substring(0, pipeIndex).trim();
        currentSkills = line.substring(pipeIndex + 1).trim();

        addSkillRow(currentCategory, currentSkills);
        currentCategory = '';
        currentSkills = '';
        continue;
      }

      // FORMAT 3: Colon separator
      // Programming Languages: Java, Python, SQL
      if (line.includes(':') && line.indexOf(':') < 60) {
        // Save previous row
        if (currentCategory && currentSkills) {
          addSkillRow(currentCategory, currentSkills);
          currentCategory = '';
          currentSkills = '';
        }

        const colonIdx = line.indexOf(':');
        currentCategory = line.substring(0, colonIdx).trim();
        currentSkills = line.substring(colonIdx + 1).trim();

        addSkillRow(currentCategory, currentSkills);
        currentCategory = '';
        currentSkills = '';
        continue;
      }

      // FORMAT 4: Multi-line (category on one line, skills on next)
      // Programming Languages
      // Java, Python, SQL

      // Check if this line is a category name
      if (isLikelyCategory(line)) {
        // Save previous category if any
        if (currentCategory && currentSkills) {
          addSkillRow(currentCategory, currentSkills);
        }

        // Store this as current category
        currentCategory = line.replace(/\|/g, '').trim();
        currentSkills = '';
        continue;
      }

      // If we have a current category and this line has skills (commas or long text)
      if (currentCategory && (line.includes(',') || line.length > 50)) {
        // This line contains skills for current category
        if (currentSkills) {
          currentSkills += ', ' + line;
        } else {
          currentSkills = line;
        }
        continue;
      }

      // Unknown format - skip
      continue;
    }

    // Company headers (contains |)
    if (line.includes('|') && !line.startsWith('•') && !line.includes('@') && !inSkills) {
      // Split company header into title/location and date
      const parts = line.split(/\s{2,}|\t/); // Split by multiple spaces or tab

      if (parts.length >= 2) {
        // Has separate date part
        const titleLocation = parts[0].replace(/\*\*/g, '');
        const date = parts.slice(1).join(' ').replace(/\*\*/g, '');
        html += `<div class="company-header">\n`;
        html += `  <span class="job-title-location">${titleLocation}</span>\n`;
        html += `  <span class="job-date">${date}</span>\n`;
        html += `</div>\n`;
      } else {
        // No clear date separation - check for date patterns at end
        const datePattern = /(.+?)\s+((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{4}\s*[-–]\s*(?:Present|(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{4}))$/i;
        const match = line.match(datePattern);

        if (match) {
          const titleLocation = match[1].replace(/\*\*/g, '');
          const date = match[2].replace(/\*\*/g, '');
          html += `<div class="company-header">\n`;
          html += `  <span class="job-title-location">${titleLocation}</span>\n`;
          html += `  <span class="job-date">${date}</span>\n`;
          html += `</div>\n`;
        } else {
          // Fallback: no date detected
          html += `<div class="company-header">${line.replace(/\*\*/g, '')}</div>\n`;
        }
      }
      continue;
    }

    // Bullet points
    if (line.startsWith('•') || line.startsWith('*')) {
      let bulletContent = line.replace(/^[•*]\s*/, '');
      bulletContent = convertBold(bulletContent);
      html += `<ul><li>${bulletContent}</li></ul>\n`;
      continue;
    }

    // Regular paragraphs
    let paraContent = convertBold(line);
    html += `<p>${paraContent}</p>\n`;
  }

  // Save any pending skill row
  if (inSkills && currentCategory && currentSkills) {
    addSkillRow(currentCategory, currentSkills);
  }

  // Close skills table
  if (skillsTableOpen) {
    html += `</table>\n`;
  }

  return html + `</body></html>`;
}

// Helper: Set page margins and line spacing
async function setDocumentFormatting(documentId) {
  try {
    console.log('📐 Setting page margins and line spacing...');

    const requests = [
      {
        updateDocumentStyle: {
          documentStyle: {
            marginTop: { magnitude: 28.35, unit: 'PT' },
            marginBottom: { magnitude: 28.35, unit: 'PT' },
            marginLeft: { magnitude: 35.43, unit: 'PT' },
            marginRight: { magnitude: 35.43, unit: 'PT' },
            pageSize: {
              width: { magnitude: 612, unit: 'PT' },
              height: { magnitude: 792, unit: 'PT' }
            }
          },
          fields: 'marginTop,marginBottom,marginLeft,marginRight,pageSize'
        }
      },
      {
        updateParagraphStyle: {
          range: {
            startIndex: 1,
            endIndex: 2
          },
          paragraphStyle: {
            lineSpacing: 100,
            spaceAbove: { magnitude: 0, unit: 'PT' },
            spaceBelow: { magnitude: 0, unit: 'PT' }
          },
          fields: 'lineSpacing,spaceAbove,spaceBelow'
        }
      }
    ];

    await docs.documents.batchUpdate({
      documentId: documentId,
      requestBody: { requests }
    });

    console.log('✅ Page formatting applied: 1cm top/bottom, 1.25cm left/right, single spacing');
  } catch (error) {
    console.error('⚠️ Failed to set formatting:', error.message);
  }
}

// Start server
app.listen(PORT, () => {
  console.log(`\n🚀 Resume Optimizer Backend Running!`);
  console.log(`📍 http://localhost:${PORT}`);
  console.log(`✅ Health: http://localhost:${PORT}/health`);
  console.log(`🤖 Supports: Gemini AI & ChatGPT`);
  console.log(`🎯 ATS Target: 100% Match Rate\n`);
});