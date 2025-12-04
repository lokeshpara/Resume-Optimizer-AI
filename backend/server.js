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
      model: 'gpt-4o',
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
            timeout: 30000,
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

    // Step 3: Get original resume
    console.log('📋 Step 3: Fetching original resume...');
    const resumeDoc = await docs.documents.get({
      documentId: ORIGINAL_RESUME_DOC_ID
    });
    const originalResume = extractTextFromDoc(resumeDoc.data);
    console.log(`✅ Resume fetched (${originalResume.length} chars)`);

    // Step 3.5: Extract company and position
    console.log('🔍 Step 3.5: Extracting job details...');
    const extractionKey = aiProvider === 'gemini' ? geminiKey1 : chatgptApiKey;
    const jobDetails = await extractJobDetails(jobDescription, aiProvider, extractionKey);
    let companyName = jobDetails.company;
    let position = jobDetails.position;

    console.log(`\n📊 Extracted Job Details:`);
    console.log(`   🏢 Company: ${companyName}`);
    console.log(`   💼 Position: ${position}\n`);

    // Step 4: Generate optimization points
    console.log('💡 Step 4: Generating optimization points...');
    
    const optimizationPrompt = `You are an expert ATS analyzer. Generate UNLIMITED, DETAILED optimization points to achieve 92-100 percent ATS match.

ORIGINAL RESUME:
${originalResume}

JOB DESCRIPTION:
${jobDescription}

YOUR MISSION: Analyze every section and generate specific, actionable points. No limits on number of points.

===== SUMMARY SECTION ANALYSIS =====

REQUIREMENTS:
- Summary must be in bullet point format (use • symbol)
- Generate as many points as needed for 92-100 percent ATS match
- Specify exact bullet number and exact changes

For each summary optimization point, provide:

SUMMARY POINT FORMAT:
What: Add specific keyword or phrase
Where: Summary Bullet X (specify which bullet number, or "Add new bullet")
Why: Mentioned in JD OR Required skill OR Increases ATS match

EXAMPLE SUMMARY POINTS:

POINT 1:
Section: Summary
What: Add keywords "Spring Cloud" and "API Gateway"
Where: Summary Bullet 2 (the one about backend development)
Why: Mentioned 3 times in JD as required skills

POINT 2:
Section: Summary
What: Add keyword "container orchestration"
Where: Summary Bullet 4 (the one about cloud development)
Why: Exact phrase used in JD requirements section

POINT 3:
Section: Summary
What: Add new bullet about CI/CD automation
Where: Add new Summary Bullet 10
Why: CI/CD mentioned 5 times in JD but not emphasized in current summary

Generate ALL summary points needed to match JD keywords.

===== SKILLS SECTION ANALYSIS =====

For each skill change needed, provide THREE types of points:

TYPE 1 - ADD SKILLS:
What: Add skill name
Where: Skills Section - Category Name
Position: Beginning OR End of category
Bold: YES if mentioned in JD, NO if not
Why: Required in JD OR Commonly expected for role

TYPE 2 - DELETE SKILLS:
What: Remove skill name
Where: Skills Section - Category Name
Why: Not relevant to this JD OR Outdated OR Not in JD

TYPE 3 - MODIFY/BOLD SKILLS:
What: Bold existing skill name
Where: Skills Section - Category Name
Why: Mentioned in JD

TYPE 4 - REORDER SKILLS:
What: Move skill to beginning of category
Where: Skills Section - Category Name
Why: Mentioned in JD, should be prioritized

EXAMPLE SKILLS POINTS:

POINT 5:
Section: Skills
Type: ADD
What: Add PostgreSQL
Where: Databases category
Position: Beginning (first position)
Bold: YES
Why: Mentioned 4 times in JD as required database

POINT 6:
Section: Skills
Type: ADD
What: Add MongoDB
Where: Databases category
Position: Beginning (after PostgreSQL)
Bold: YES
Why: Mentioned in JD as required NoSQL database

POINT 7:
Section: Skills
Type: BOLD
What: Bold Spring Boot
Where: Backend Development category
Why: Mentioned 6 times in JD requirements

POINT 8:
Section: Skills
Type: REORDER
What: Move Kubernetes to beginning
Where: DevOps and CI/CD category
Bold: YES
Why: Critical requirement in JD, mentioned 8 times

POINT 9:
Section: Skills
Type: DELETE
What: Remove EJB
Where: Backend Development category
Why: Not mentioned in JD, outdated technology

POINT 10:
Section: Skills
Type: ADD
What: Add GraphQL
Where: Backend Development category
Position: After RESTful APIs
Bold: YES
Why: Required API technology mentioned in JD

Generate points for EVERY skill that needs to be:
- Added (with exact category and position)
- Deleted (with reason)
- Bolded (because in JD)
- Reordered (to prioritize JD skills)

===== EXPERIENCE SECTION ANALYSIS =====

For EACH company in experience section, generate specific points:

EXPERIENCE POINT FORMAT:
Company: [Company Name]
Bullet: [Bullet number, e.g., Bullet 3]
What: Add keyword/phrase OR Enhance with technology
Where: Exact position in bullet (beginning, middle, after specific phrase)
Bold: List all tools/technologies to bold that are in JD
Why: Matches JD requirement OR Improves ATS score

EXAMPLE EXPERIENCE POINTS:

POINT 15:
Section: Experience
Company: LPL Financial
Bullet: Bullet 1
What: Add "Spring Cloud" and "API Gateway" after "Spring Boot microservices"
Enhance to: "Architected 15+ Spring Boot microservices with Spring Cloud and API Gateway"
Bold: Spring Boot, microservices, Spring Cloud, API Gateway
Why: All four technologies mentioned in JD requirements

POINT 16:
Section: Experience
Company: LPL Financial
Bullet: Bullet 3
What: Add "Kafka Streams" and "Schema Registry" to Kafka description
Enhance to: "Apache Kafka with Kafka Streams and Schema Registry"
Bold: Apache Kafka, Kafka Streams, Schema Registry, event-driven architecture
Why: JD requires Kafka expertise with these specific components

POINT 17:
Section: Experience
Company: Athenahealth
Bullet: Bullet 1
What: Add "FHIR" and "HL7" if healthcare platform
Enhance to: "HIPAA-compliant healthcare platform using Spring Boot, FHIR, and HL7"
Bold: Spring Boot, FHIR, HL7, HIPAA
Why: Healthcare interoperability standards mentioned in JD

POINT 18:
Section: Experience
Company: YES Bank
Bullet: Bullet 4
What: Add "Redis caching" and "connection pooling"
Enhance to: "Redis caching layer achieving 85% hit rate with HikariCP connection pooling"
Bold: Redis, HikariCP, connection pooling
Why: Caching and performance optimization mentioned in JD

POINT 19:
Section: Experience
Company: Comcast
Bullet: Bullet 2
What: Add "OAuth2" and "JWT" to security description
Enhance to: "Spring Security with OAuth2 authentication and JWT tokens"
Bold: Spring Security, OAuth2, JWT
Why: Security technologies explicitly required in JD

Generate points for EVERY company and EVERY bullet that can be enhanced with JD keywords.

===== CONSOLIDATION POINTS =====

POINT FORMAT:
What: Merge category A into category B
How: Specify which skills go where
Why: Category A has only X skills

EXAMPLE:
POINT 25:
Section: Skills
Type: MERGE
What: Merge "JavaScript Ecosystem" category
How: Move Node.js to Backend Development, Move React and Redux to Frontend Development
Why: JavaScript Ecosystem has only 3 skills, too small for separate category

===== FILENAME SUGGESTION =====

FILENAME: Lokesh_Para_[Position]_[Company]

===== SUMMARY OF POINT GENERATION =====

Generate points for:
✓ Summary: What to add, which bullet, why (unlimited points)
✓ Skills - Add: What, where, position, bold yes/no, why
✓ Skills - Delete: What, where, why
✓ Skills - Bold: What, where, why
✓ Skills - Reorder: What, where, why
✓ Experience: Company, bullet number, what to add, what to bold, why (all companies)
✓ Consolidation: What to merge, how, why

GOAL: Generate 40, 50, 60+ points if needed for 92-100 percent ATS match. Do not limit yourself.

Output format:
POINT 1:
Section: Summary
What: ...
Where: ...
Why: ...

POINT 2:
Section: Skills
Type: ADD
What: ...
Where: ...
Position: ...
Bold: ...
Why: ...

Continue for ALL needed optimizations.`;

    const analysisKey = aiProvider === 'gemini' ? geminiKey2 : chatgptApiKey;
    const optimizationPoints = await generateAIContent(optimizationPrompt, aiProvider, analysisKey);
    const pointCount = (optimizationPoints.match(/POINT \d+:/g) || []).length;
    console.log(`✅ Generated ${pointCount} optimization points`);

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
    
    const rewritePrompt = `You are an ATS optimization expert. Rewrite the resume applying EVERY optimization point while maintaining original format.

ORIGINAL RESUME (maintain this exact formatting):
${originalResume}

OPTIMIZATION POINTS (apply every single one):
${optimizationPoints}

JOB DESCRIPTION (for keyword reference and bolding):
${jobDescription}

===== MANDATORY RULES =====

1. Maintain EXACT structure from original resume
2. Apply EVERY optimization point without exception
3. Bold ALL JD-mentioned keywords using **keyword**
4. Use original resume's formatting style

===== SUMMARY SECTION REWRITE =====

FORMAT: Bullet points with • symbol (as in original)

PROCESS:
1. Start with original summary bullets
2. For each optimization point labeled "Section: Summary":
   - Find the specified bullet number
   - Add the specified keywords/phrases
   - Bold any keyword that appears in JD using **keyword**
3. If optimization says "Add new bullet", create new bullet at end
4. No limit on number of bullets - add as many as optimization points require

BOLDING RULE:
Read JD and bold ANY technology, tool, skill, or methodology mentioned:
- **Spring Boot**, **microservices**, **Kubernetes**, **Docker**
- **Agile**, **CI/CD**, **TDD**
- **PostgreSQL**, **MongoDB**, **Redis**
- **AWS**, **Azure**, **cloud-native**

EXAMPLE:
Original: • Expert in backend development with Spring ecosystem
Point says: Add "Spring Cloud" and "API Gateway"
Output: • Expert in **backend development** with **Spring ecosystem** (**Spring Boot**, **Spring Cloud**, **API Gateway**)

===== SKILLS SECTION REWRITE =====

FORMAT: Table format (as in original)
Category Name | skill1, skill2, skill3

PROCESS FOR EACH CATEGORY:

STEP 1 - COLLECT ALL SKILLS:
- Start with skills from original resume category
- Add skills from optimization points (Type: ADD)
- Remove skills from optimization points (Type: DELETE)

STEP 2 - IDENTIFY JD SKILLS:
- Check JD for each skill
- Check optimization points for "Bold: YES"
- Mark all JD-mentioned skills for bolding

STEP 3 - ORDER SKILLS:
- JD-mentioned skills FIRST (all bolded)
- Non-JD skills AFTER (not bolded)
- Within JD skills, order by importance/frequency in JD

STEP 4 - FORMAT:
Category Name | **jd-skill1**, **jd-skill2**, **jd-skill3**, other-skill1, other-skill2

EXAMPLE:

Original:
Databases | MySQL, PostgreSQL, MongoDB, Redis, Oracle

Optimization points say:
- Bold PostgreSQL (in JD)
- Bold MongoDB (in JD)
- Add DynamoDB (Bold: YES)
- Move JD skills to beginning

Output:
Databases | **PostgreSQL**, **MongoDB**, **DynamoDB**, **Redis**, MySQL, Oracle

(Redis bolded if mentioned in JD, otherwise not)

===== EXPERIENCE SECTION REWRITE =====

FORMAT: Maintain exact format from original resume
- Company Name | Location     Dates
- • Bullet points

PROCESS FOR EACH COMPANY:

STEP 1 - READ OPTIMIZATION POINTS:
Look for all points labeled:
- Section: Experience
- Company: [Company Name]
- Bullet: [Bullet Number]

STEP 2 - ENHANCE SPECIFIED BULLETS:
For each optimization point:
- Find the exact bullet number specified
- Add the keywords/phrases as specified
- Bold ALL tools/technologies mentioned in the optimization point's "Bold:" section
- Bold ANY additional JD-mentioned terms

STEP 3 - BOLDING IN EXPERIENCE:
Bold EVERY occurrence of:
- Technologies in JD (Spring Boot, React, Kafka, Docker, Kubernetes)
- Methodologies in JD (Agile, Scrum, CI/CD, TDD, microservices)
- Cloud platforms in JD (AWS, Azure, GCP)
- Databases in JD (PostgreSQL, MongoDB, Redis)
- Tools in JD (Jenkins, Git, Terraform)

EXAMPLE:

Original bullet:
- Architected 15+ Spring Boot microservices processing $500M+ daily transactions

Optimization point says:
Company: LPL Financial
Bullet: Bullet 1
What: Add "Spring Cloud (API Gateway, Eureka)" after "Spring Boot microservices"
Bold: Spring Boot, microservices, Spring Cloud, API Gateway, Eureka

Output:
- Architected 15+ **Spring Boot** **microservices** with **Spring Cloud** (**API Gateway**, **Eureka**) processing $500M+ daily transactions

===== APPLYING OPTIMIZATION POINTS =====

POINT TYPES AND APPLICATION:

TYPE: Summary
ACTION: 
- Find bullet number specified in "Where:"
- Add content from "What:"
- Bold JD keywords

TYPE: Skills - ADD
ACTION:
- Add skill to specified category
- Place at position specified (Beginning/End)
- Bold if "Bold: YES"

TYPE: Skills - DELETE
ACTION:
- Remove skill from specified category

TYPE: Skills - BOLD
ACTION:
- Find skill in category
- Change to **skill**

TYPE: Skills - REORDER
ACTION:
- Move skill to beginning with other JD skills
- Bold it

TYPE: Experience
ACTION:
- Find company and bullet number
- Add enhancement from "What:"
- Bold all items listed in "Bold:"

TYPE: MERGE
ACTION:
- Move skills as specified
- Delete original category
- Apply bolding rules

===== VERIFICATION BEFORE OUTPUT =====

Check:
✓ Every optimization point applied
✓ All summary bullets have JD keywords bolded
✓ Skills section: JD skills first and bolded in each category
✓ Experience: All specified bullets enhanced
✓ Experience: All JD technologies bolded throughout
✓ Original formatting maintained
✓ All metrics and numbers preserved

===== OUTPUT STRUCTURE =====

Lokesh Para
Software Engineer
Contact info

PROFESSIONAL SUMMARY
- Bullet with **JD keywords** bolded
- Bullet with **JD keywords** bolded
- As many bullets as optimization points created

SKILLS
Programming Languages | **JD-lang**, **JD-lang**, other-lang
Backend Development | **JD-tech**, **JD-tech**, other-tech
(All categories with JD skills first and bolded)

PROFESSIONAL EXPERIENCE
Company | Location     Dates
- Enhanced bullet with **JD tools** bolded
- Enhanced bullet with **JD tools** bolded
(All bullets enhanced per optimization points)

EDUCATION
(Same as original)

TARGET: 92-100 percent ATS match with all JD keywords properly emphasized.

Return ONLY the complete resume. No explanations.`;
    

    const rewriteKey = aiProvider === 'gemini' ? geminiKey3 : chatgptApiKey;
    const optimizedResume = await generateAIContent(rewritePrompt, aiProvider, rewriteKey);
    console.log(`✅ Resume rewritten (${optimizedResume.length} chars)`);

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

// Helper: Convert to styled HTML
// Helper: Convert to styled HTML
function convertToStyledHTML(text) {
  const lines = text.split('\n');
  let html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>
  body{font-family:Cambria,serif;font-size:11pt;line-height:1;margin:1cm 1.25cm}
  .name{font-size:18pt;font-weight:bold;text-align:center;margin-bottom:2pt}
  .title{font-size:12pt;font-weight:bold;text-align:center;margin-bottom:2pt}
  .contact{font-size:10pt;text-align:center;margin-bottom:12pt}
  .section-header{font-size:14pt;font-weight:bold;margin-top:12pt;margin-bottom:6pt}
  .skills-table{width:100%;border-collapse:collapse;margin-top:6pt;margin-bottom:12pt}
  .skills-table td{padding:4pt 8pt;vertical-align:top;border:none}
  .skills-category{font-weight:bold;width:25%;font-size:10.5pt}
  .skills-list{width:75%;font-size:10.5pt}
  .company-header{font-size:11.5pt;font-weight:bold;margin-top:8pt;margin-bottom:4pt}
  p{margin:4pt 0;text-align:justify}
  ul{margin:2pt 0;padding-left:0.25in}
  li{margin:4pt 0;text-align:justify}
  </style></head><body>`;

  let inSkills = false;
  let skillsTableOpen = false;
  let currentCategory = '';
  let currentSkills = '';
  
  // Helper function to convert **text** to <strong>text</strong>
  function convertBold(text) {
    return text.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  }
  
  // Helper function to add a skill row to table
  function addSkillRow(category, skills) {
    if (category && skills) {
      const cleanCategory = category.trim().replace(/\*\*/g, '').replace(/\*/g, '');
      const boldSkills = convertBold(skills.trim());
      html += `  <tr>\n`;
      html += `    <td class="skills-category">${cleanCategory}</td>\n`;
      html += `    <td class="skills-list">${boldSkills}</td>\n`;
      html += `  </tr>\n`;
    }
  }
  
  for (let i = 0; i < lines.length; i++) {
    let line = lines[i].trim();
    if (!line) continue;
    
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
      html += `<div class="contact">${line}</div>\n`;
      continue;
    }
    
    // Section Headers (PROFESSIONAL SUMMARY, SKILLS, EXPERIENCE, EDUCATION)
    if (line === line.toUpperCase() && line.length > 3 && !line.startsWith('*')) {
      // Save pending skill row if any
      if (inSkills && currentCategory && currentSkills) {
        addSkillRow(currentCategory, currentSkills);
        currentCategory = '';
        currentSkills = '';
      }
      
      // Close skills table if open
      if (skillsTableOpen) {
        html += `</table>\n`;
        skillsTableOpen = false;
        inSkills = false;
      }
      
      // Check if this is SKILLS section
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
    
    // Skills section content
    if (inSkills && skillsTableOpen) {
      // Check if this line is a category name (no comma, no parentheses at start, capitalized)
      const isCategory = !line.includes(',') && 
                        !line.startsWith('*') && 
                        line.length < 80 &&
                        !line.includes('(') &&
                        line[0] === line[0].toUpperCase() &&
                        !line.match(/^(AWS|GCP|Azure|ETL|CI\/CD|API|JUnit|REST)/);
      
      // Check if line has pipe separator (Category | Skills format)
      if (line.includes('|') && !line.includes('@')) {
        // Save previous row if any
        if (currentCategory && currentSkills) {
          addSkillRow(currentCategory, currentSkills);
        }
        
        // Parse pipe-separated format
        const parts = line.split('|');
        currentCategory = parts[0].trim();
        currentSkills = parts.slice(1).join('|').trim();
        addSkillRow(currentCategory, currentSkills);
        currentCategory = '';
        currentSkills = '';
      }
      // Check if line has colon separator (Category: Skills format)
      else if (line.includes(':') && line.indexOf(':') < 60) {
        // Save previous row if any
        if (currentCategory && currentSkills) {
          addSkillRow(currentCategory, currentSkills);
        }
        
        // Parse colon-separated format
        const colonIdx = line.indexOf(':');
        currentCategory = line.substring(0, colonIdx).trim();
        currentSkills = line.substring(colonIdx + 1).trim();
        addSkillRow(currentCategory, currentSkills);
        currentCategory = '';
        currentSkills = '';
      }
      // Line is a category name (starts with capital, no comma)
      else if (isCategory) {
        // Save previous row if any
        if (currentCategory && currentSkills) {
          addSkillRow(currentCategory, currentSkills);
        }
        
        // This is a new category, next line(s) will be skills
        currentCategory = line;
        currentSkills = '';
      }
      // Line is skills (continuation of previous category)
      else if (currentCategory) {
        // Append skills to current category
        if (currentSkills) {
          currentSkills += ', ' + line;
        } else {
          currentSkills = line;
        }
      }
      
      continue;
    }
    
    // Company headers (contains |)
    if (line.includes('|') && !line.startsWith('•') && !line.includes('@')) {
      html += `<div class="company-header">${line.replace(/\*\*/g, '')}</div>\n`;
      continue;
    }
    
    // Bullet points (Summary and Experience)
    if (line.startsWith('•') || line.startsWith('*')) {
      let bulletContent = line.replace(/^[•*]\s*/, '');
      // Convert **keyword** to <strong>keyword</strong>
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
  
  // Close skills table if still open
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
  console.log(`🎯 ATS Target: 92-100% Match Rate\n`);
});