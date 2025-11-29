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
            contacts,
            fileName 
        } = data;
        
        // Simple date formatting
        const today = new Date();
        const formattedDate = `'${today.getMonth()+1}/${today.getDate()}/${today.getFullYear()}'`;

        
        console.log('📊 Formatted date:', formattedDate);
        
        // Get the sheet metadata
        const sheetMetadata = await sheets.spreadsheets.get({
            spreadsheetId: TRACKING_SHEET_ID
        });
        
        const firstSheetName = sheetMetadata.data.sheets[0].properties.title;
        console.log(`📊 Using sheet: ${firstSheetName}`);
        
        // Append with RAW to preserve exact format
        const result = await sheets.spreadsheets.values.append({
            spreadsheetId: TRACKING_SHEET_ID,
            range: `${firstSheetName}!A:E`,
            valueInputOption: 'USER_ENTERED',
            insertDataOption: 'INSERT_ROWS',
            requestBody: {
            values: [[
                companyName || 'N/A',
                position || 'N/A',
                formattedDate || '',
                resumeLink || '',
                contacts || ''
            ]]
            }
        });
        
        console.log('✅ Logged to Google Sheets:', result.data.updates.updatedRange);
        return true;
        
        } catch (error) {
        console.error('❌ Failed to log to Google Sheets:', error.message);
        return false;
        }
    }

// Main optimization endpoint
app.post('/api/optimize-resume', async (req, res) => {
  try {
    const { jobUrl, aiProvider, geminiKey1, geminiKey2, geminiKey3, chatgptApiKey, manualJobDescription } = req.body;
    
    console.log('\n📥 Request received:', {
      hasJobUrl: !!jobUrl,
      hasManualJD: !!manualJobDescription,
      manualJDLength: manualJobDescription ? manualJobDescription.length : 0,
      aiProvider
    });
    
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
    
    const optimizationPrompt = `Analyze the resume and job description to generate optimization points.

CURRENT RESUME:
${originalResume}

JOB DESCRIPTION:
${jobDescription}

Generate 10-20+ specific optimization points in this format:

POINT 1:
What: [specific addition]
Where: [exact location]
Why: [ATS benefit]

POINT 2:
What: [specific addition]
Where: [exact location]
Why: [benefit]

[Continue for all points]

Also suggest a filename:
FILENAME: Lokesh_Para_[Position]_[Company]

Use underscores for spaces (e.g., Senior_Java_Developer_Google)`;

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
    
    const rewritePrompt = `Apply ALL optimization points to this resume.

ORIGINAL RESUME:
${originalResume}

OPTIMIZATION POINTS:
${optimizationPoints}

Rules:
1. Apply EVERY optimization point
2. Keep existing content
3. Maintain writing style
4. Use bullet points (•)
5. Skills format: **Category:** item1, item2, item3
6. NO ** in skill items

Return ONLY the complete updated resume. No explanations.`;

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

    // Step 8: Log to Google Sheets
    await logToGoogleSheet({
      companyName: companyName,
      position: position,
      resumeLink: resumeLink,
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
function convertToStyledHTML(text) {
  const lines = text.split('\n');
  let html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>
  body{font-family:Cambria,serif;font-size:11pt;line-height:1.15;margin:0.5in}
  .name{font-size:18pt;font-weight:bold;text-align:center;margin-bottom:2pt}
  .title{font-size:12pt;font-weight:bold;text-align:center;margin-bottom:2pt}
  .contact{font-size:10pt;text-align:center;margin-bottom:12pt}
  .section-header{font-size:14pt;font-weight:bold;margin-top:12pt;margin-bottom:6pt}
  .skills-table{width:100%;border-collapse:collapse;margin-top:6pt}
  .skills-table td{padding:4pt 8pt;vertical-align:top}
  .skills-category{font-weight:bold;width:30%}
  .skills-list{width:70%}
  .company-header{font-size:11.5pt;font-weight:bold;margin-top:8pt;margin-bottom:4pt}
  p{margin:4pt 0;text-align:justify}
  ul{margin:2pt 0;padding-left:0.25in}
  li{margin:4pt 0;text-align:justify}
  </style></head><body>`;

  let inSkills = false, skillsTableOpen = false;
  
  for (let i = 0; i < lines.length; i++) {
    let line = lines[i].trim();
    if (!line) continue;
    
    if (i < 3 && line.includes('Lokesh')) {
      html += `<div class="name">${line}</div>\n`;
      continue;
    }
    
    if (i <= 3 && line.includes('Developer') && line.length < 60) {
      html += `<div class="title">${line}</div>\n`;
      continue;
    }
    
    if ((line.includes('@') || line.includes('|')) && i < 6) {
      html += `<div class="contact">${line}</div>\n`;
      continue;
    }
    
    if (line === line.toUpperCase() && line.length > 3 && !line.startsWith('*')) {
      if (skillsTableOpen) {
        html += `</table>\n`;
        skillsTableOpen = false;
      }
      
      if (line.includes('SKILL')) {
        inSkills = true;
        html += `<div class="section-header">${line}</div>\n<table class="skills-table">\n`;
        skillsTableOpen = true;
      } else {
        inSkills = false;
        html += `<div class="section-header">${line}</div>\n`;
      }
      continue;
    }
    
    if (inSkills && line.includes(':')) {
      let cleanLine = line.trim();
      cleanLine = cleanLine.replace(/^\*+\s*/g, '');
      cleanLine = cleanLine.replace(/\*\*/g, '');
      
      const colonIdx = cleanLine.indexOf(':');
      
      if (colonIdx > 0 && colonIdx < 60 && !cleanLine.includes('|') && !cleanLine.includes('@')) {
        const category = cleanLine.substring(0, colonIdx).trim();
        let items = cleanLine.substring(colonIdx + 1).trim();
        items = items.replace(/\*/g, '');
        
        html += `  <tr>\n`;
        html += `    <td class="skills-category">${category}</td>\n`;
        html += `    <td class="skills-list">${items}</td>\n`;
        html += `  </tr>\n`;
      }
      continue;
    }
    
    if (line.includes('|') && !line.startsWith('•') && !line.includes('@')) {
      if (skillsTableOpen) {
        html += `</table>\n`;
        skillsTableOpen = false;
        inSkills = false;
      }
      html += `<div class="company-header">${line.replace(/\*\*/g, '')}</div>\n`;
      continue;
    }
    
    if (line.startsWith('•') || line.startsWith('*')) {
      html += `<ul><li>${line.replace(/^[•*]\s*/, '').replace(/\*\*/g, '')}</li></ul>\n`;
      continue;
    }
    
    html += `<p>${line.replace(/\*\*/g, '')}</p>\n`;
  }
  
  if (skillsTableOpen) html += `</table>\n`;
  return html + `</body></html>`;
}

// Start server
app.listen(PORT, () => {
  console.log(`\n🚀 Resume Optimizer Backend Running!`);
  console.log(`📍 http://localhost:${PORT}`);
  console.log(`✅ Health: http://localhost:${PORT}/health`);
  console.log(`🤖 Supports: Gemini AI & ChatGPT\n`);
});