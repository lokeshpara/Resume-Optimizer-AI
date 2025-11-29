# Resume Optimizer - Chrome Extension with AI & Google Workspace Integration

[![GitHub](https://img.shields.io/github/license/lokeshpara/Resume-Optimizer-AI)](https://github.com/lokeshpara/Resume-Optimizer-AI/blob/main/LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D14.0.0-brightgreen)](https://nodejs.org/)
[![Chrome Extension](https://img.shields.io/badge/Chrome-Extension-blue)](https://chrome.google.com/webstore)
[![Google Gemini](https://img.shields.io/badge/Google-Gemini_2.0-4285F4)](https://ai.google.dev/)
[![Stars](https://img.shields.io/github/stars/lokeshpara/Resume-Optimizer-AI)](https://github.com/lokeshpara/Resume-Optimizer-AI/stargazers)

**One-click resume optimization powered by Google Gemini or ChatGPT with automatic Google Drive & Sheets tracking**
---

## 📋 Table of Contents

1. [Features](#features)
2. [Prerequisites](#prerequisites)
3. [Setup Guide](#setup-guide)
   - [Part 1: Google Cloud Console Setup](#part-1-google-cloud-console-setup)
   - [Part 2: Get API Keys](#part-2-get-api-keys)
   - [Part 3: Backend Setup](#part-3-backend-setup)
   - [Part 4: Chrome Extension Setup](#part-4-chrome-extension-setup)
4. [Testing](#testing)
5. [Usage](#usage)
6. [Troubleshooting](#troubleshooting)
7. [Project Structure](#project-structure)

---

## ✨ Features

- **Dual Mode Operation:**
  - 🌐 **URL Mode**: Automatically fetch job description from any job posting URL
  - 📝 **Manual Mode**: Paste job description directly (works for authenticated sites like LinkedIn)

- **Multi-AI Provider Support:**
  - Google Gemini 2.0 Flash (3 API keys for load distribution)
  - ChatGPT GPT-4 (single API key)

- **Intelligent Optimization:**
  - ATS score optimization (92-100 target)
  - Keyword matching from job description
  - Skills gap analysis
  - Achievement quantification suggestions
  - 10-20+ specific optimization points per resume

- **Automatic Tracking:**
  - Uploads optimized resume to Google Drive
  - Logs applications to Google Sheets (Company, Position, Date, Resume Link)
  - Auto-generates filenames: `Lokesh_Para_Position_Company`

- **Professional Output:**
  - Google Docs format with proper styling
  - Skills table with 2-column layout
  - Download as PDF, DOCX, or edit in Google Docs

---

## 🔧 Prerequisites

- **Node.js** (v14 or higher) - [Download](https://nodejs.org/)
- **Google Account** (for Google Cloud APIs)
- **Chrome Browser** (for extension)
- **AI API Keys:**
  - Either 3 Google Gemini API keys OR
  - 1 OpenAI ChatGPT API key

---

## 🚀 Setup Guide

### Part 1: Google Cloud Console Setup

#### Step 1.1: Create Google Cloud Project

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Click **"Select a project"** → **"NEW PROJECT"**
3. **Project name:** `Resume Optimizer`
4. Click **"CREATE"**
5. Wait for project creation, then select it

#### Step 1.2: Enable Required APIs

Enable these 4 APIs (click each link and press "ENABLE"):

1. [Google Docs API](https://console.cloud.google.com/apis/library/docs.googleapis.com)
2. [Google Drive API](https://console.cloud.google.com/apis/library/drive.googleapis.com)
3. [Google Sheets API](https://console.cloud.google.com/apis/library/sheets.googleapis.com)
4. [Generative Language API](https://console.cloud.google.com/apis/library/generativelanguage.googleapis.com) *(if using Gemini)*

**Wait 2-3 minutes** after enabling for APIs to activate.

#### Step 1.3: Create OAuth 2.0 Credentials

1. Go to [Credentials Page](https://console.cloud.google.com/apis/credentials)
2. Click **"+ CREATE CREDENTIALS"** → **"OAuth client ID"**
3. If prompted, configure OAuth consent screen:
   - User Type: **External**
   - App name: `Resume Optimizer`
   - User support email: Your email
   - Developer email: Your email
   - Click **"SAVE AND CONTINUE"**
   - Scopes: Skip (click **"SAVE AND CONTINUE"**)
   - Test users: **Add your email** (Click "+ ADD USERS")
   - Click **"SAVE AND CONTINUE"**

4. Create OAuth Client:
   - Application type: **Desktop app** (IMPORTANT!)
   - Name: `Resume Optimizer`
   - Click **"CREATE"**

5. **Download JSON:**
   - Click the download button (⬇️) next to your new OAuth client
   - Save as `credentials.json` (or note down Client ID & Client Secret)

---

### Part 2: Get API Keys

#### Option A: Google Gemini (Recommended - Free Tier Available)

1. Go to [Google AI Studio](https://makersuite.google.com/app/apikey)
2. Click **"Create API Key"**
3. Select your project: `Resume Optimizer`
4. Copy the API key (starts with `AIzaSy...`)
5. **Repeat 2 more times** to get 3 total API keys

**Save these 3 keys** - you'll need them later.

#### Option B: OpenAI ChatGPT

1. Go to [OpenAI Platform](https://platform.openai.com/api-keys)
2. Click **"Create new secret key"**
3. Name: `Resume Optimizer`
4. Copy the key (starts with `sk-...`)

**Save this key** - it won't be shown again.

---

### Part 3: Backend Setup

#### Step 3.1: Download Project
```bash
# Clone or download the project
cd Desktop  # or wherever you want to store it
mkdir RO
cd RO
```

Create this folder structure:
```
RO/
├── backend/
└── extension/
```

#### Step 3.2: Install Dependencies
```bash
cd backend
npm init -y
npm install express cors axios dotenv googleapis @google/generative-ai
```

#### Step 3.3: Generate Refresh Token

**Create `backend/get-token.js`:**
```javascript
const { google } = require('googleapis');
const http = require('http');
const url = require('url');
const open = require('open');
require('dotenv').config();

const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  'http://localhost:3000/oauth2callback'
);

const scopes = [
  'https://www.googleapis.com/auth/documents',
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/spreadsheets'
];

async function getToken() {
  const authorizeUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: scopes,
    prompt: 'consent'
  });

  console.log('\n🔐 Opening browser for authorization...\n');
  console.log('If browser doesn\'t open, visit this URL:');
  console.log(authorizeUrl);
  console.log('\n');

  const server = http.createServer(async (req, res) => {
    if (req.url.indexOf('/oauth2callback') > -1) {
      const qs = new url.URL(req.url, 'http://localhost:3000').searchParams;
      const code = qs.get('code');
      
      res.end('Authorization successful! You can close this window.');
      server.close();

      const { tokens } = await oauth2Client.getToken(code);
      
      console.log('\n✅ SUCCESS! Copy this refresh token to your .env file:\n');
      console.log('GOOGLE_REFRESH_TOKEN=' + tokens.refresh_token);
      console.log('\n');
    }
  }).listen(3000, () => {
    open(authorizeUrl, { wait: false });
  });
}

getToken();
```

**Create `backend/.env` (temporary for token generation):**
```bash
GOOGLE_CLIENT_ID=YOUR_CLIENT_ID_HERE
GOOGLE_CLIENT_SECRET=YOUR_CLIENT_SECRET_HERE
```

Replace with values from your OAuth credentials.

**Run token generation:**
```bash
node get-token.js
```

**What happens:**
1. Browser opens
2. Sign in with Google
3. Click **"Allow"**
4. Browser shows: `Authorization successful! You can close this window.`
5. Terminal shows: `GOOGLE_REFRESH_TOKEN=1//0abc123...`

**Copy the refresh token!**

---

#### Step 3.4: Prepare Google Drive & Sheets

**Create Google Drive Folder:**

1. Go to [Google Drive](https://drive.google.com/)
2. Click **"New"** → **"Folder"**
3. Name: `Optimized Resumes`
4. Open the folder
5. Copy **Folder ID** from URL:
```
   https://drive.google.com/drive/folders/1ABC123XYZ
                                            ↑________↑
                                            This is the ID
```

**Create Google Sheet for Tracking:**

1. Go to [Google Sheets](https://sheets.google.com/)
2. Click **"Blank"** to create new sheet
3. **Name:** `Resume Applications Tracker`
4. **Add headers in Row 1:**
   - A1: `Company Name`
   - B1: `Position Applied`
   - C1: `Date`
   - D1: `Resume Link`
   - E1: `Contacts`
5. Copy **Sheet ID** from URL:
```
   https://docs.google.com/spreadsheets/d/1BdLfas17vBjiDosTY4q0a8uLhYcFE92NuLnyadjb4cY/edit
                                          ↑____________________________________________↑
                                          This is the Sheet ID
```

**Upload Your Original Resume:**

1. Go to [Google Docs](https://docs.google.com/)
2. Upload your resume (File → Open → Upload)
3. **Open with Google Docs** (if it's a Word file)
4. Copy **Document ID** from URL:
```
   https://docs.google.com/document/d/13oOMXjl7zBWIujaxtdZ9e6w73IqjqP0m/edit
                                      ↑_____________________________↑
                                      This is the Document ID
```

---

#### Step 3.5: Configure Environment Variables

**Update `backend/.env` with all credentials:**
```bash
# Google OAuth Credentials
GOOGLE_CLIENT_ID=123456789-abc.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=GOCSPX-abc123xyz
GOOGLE_REFRESH_TOKEN=1//014zRHbtissieCgYIARAAGAESNwF-L9IrCdJ5K_5...

# Google Drive & Docs
ORIGINAL_RESUME_DOC_ID=13oOMXjl7zBWIujaxtdZ9e6w73IqjqP0m
DRIVE_FOLDER_ID=1zpd8t-2FtpK3ZRhdpnn0cuDp-a5lgv9q
TRACKING_SHEET_ID=1BdLfas17vBjiDosTY4q0a8uLhYcFE92NuLnyadjb4cY
```

**⚠️ Important:** Replace ALL placeholder values with your actual IDs and keys!

---

#### Step 3.6: Create Backend Server

**Create `backend/server.js`** - Use the complete server.js file from the project files.

---

### Part 4: Chrome Extension Setup

#### Step 4.1: Create Extension Files

**Create these files in the `extension/` folder:**

1. **`extension/manifest.json`:**
```json
{
  "manifest_version": 3,
  "name": "Resume Optimizer Pro",
  "version": "1.0.0",
  "description": "AI-powered resume optimization with Google Workspace integration",
  "permissions": [
    "activeTab",
    "storage"
  ],
  "action": {
    "default_popup": "popup.html"
  },
  "options_ui": {
    "page": "options.html",
    "open_in_tab": true
  },
  "icons": {
    "16": "icon.png",
    "48": "icon.png",
    "128": "icon.png"
  },
  "host_permissions": [
    "http://localhost:3000/*"
  ]
}
```

2. **Create a simple icon (`extension/icon.png`):**
   - Create a 128x128 PNG image (can use any icon generator)
   - Or download a resume/document icon from [Flaticon](https://www.flaticon.com/)

3. **`extension/popup.html`**, **`popup.js`**, **`styles.css`**, **`options.html`**, **`options.js`** - Use files from project.

---

#### Step 4.2: Load Extension in Chrome

1. Open Chrome
2. Go to `chrome://extensions/`
3. Enable **"Developer mode"** (top right toggle)
4. Click **"Load unpacked"**
5. Select your `extension/` folder
6. Extension should appear with your icon

---

## 🧪 Testing

### Test 1: Verify Backend Setup
```bash
cd backend
node server.js
```

**Expected output:**
```
🚀 Resume Optimizer Backend Running!
📍 http://localhost:3000
✅ Health: http://localhost:3000/health
🤖 Supports: Gemini AI & ChatGPT
```

**Test health endpoint:**

Open browser: `http://localhost:3000/health`

Should show:
```json
{
  "status": "Server is running",
  "timestamp": "2025-11-28T..."
}
```

---

### Test 2: Test Google APIs Access

**Create `backend/test-apis.js`:**
```javascript
const { google } = require('googleapis');
require('dotenv').config();

async function testAPIs() {
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
  
  console.log('🧪 Testing Google APIs...\n');
  
  // Test 1: Resume access
  console.log('📄 Test 1: Accessing resume...');
  const doc = await docs.documents.get({
    documentId: process.env.ORIGINAL_RESUME_DOC_ID
  });
  console.log(`✅ Resume: ${doc.data.title}\n`);
  
  // Test 2: Drive folder access
  console.log('📁 Test 2: Accessing Drive folder...');
  const folder = await drive.files.get({
    fileId: process.env.DRIVE_FOLDER_ID,
    fields: 'name'
  });
  console.log(`✅ Folder: ${folder.data.name}\n`);
  
  // Test 3: Sheets access
  console.log('📊 Test 3: Accessing tracking sheet...');
  const sheet = await sheets.spreadsheets.get({
    spreadsheetId: process.env.TRACKING_SHEET_ID
  });
  console.log(`✅ Sheet: ${sheet.data.properties.title}\n`);
  
  console.log('🎉 All tests passed!\n');
}

testAPIs().catch(console.error);
```

**Run:**
```bash
node test-apis.js
```

**Expected output:**
```
🧪 Testing Google APIs...

📄 Test 1: Accessing resume...
✅ Resume: Lokesh Para

📁 Test 2: Accessing Drive folder...
✅ Folder: Optimized Resumes

📊 Test 3: Accessing tracking sheet...
✅ Sheet: Resume Applications Tracker

🎉 All tests passed!
```

---

### Test 3: Configure Extension

1. Click extension icon in Chrome
2. Click **"Settings"** (⚙️)
3. **Select AI Provider:**
   - Choose "Google Gemini" or "ChatGPT"
4. **Enter API Keys:**
   - If Gemini: Paste all 3 API keys
   - If ChatGPT: Paste 1 API key
5. Click **"Save Settings"**
6. Should see: ✅ Settings saved!

---

### Test 4: Full Optimization Test

**Using Manual Mode (Recommended for first test):**

1. Click extension icon
2. Click **"📝 Paste Job Description"**
3. Paste this sample JD:
```
   Senior Java Developer
   Google
   Mountain View, CA

   We are looking for a Senior Java Developer with 5+ years experience.
   
   Requirements:
   - Java 11+
   - Spring Boot
   - Microservices
   - AWS experience
   - Strong problem-solving skills
```
4. Click **"Optimize Resume"**
5. Wait 30-60 seconds
6. Should see: ✅ Resume Optimized Successfully!

**Check outputs:**
- Google Drive folder: New document created
- Google Sheet: New row added with Google, Senior Java Developer
- Extension: Shows links to view/download

---

## 📖 Usage

### Workflow
```
1. Navigate to job posting OR prepare JD text
   ↓
2. Click extension icon
   ↓
3. Choose mode:
   - 🌐 Fetch from URL (for accessible sites)
   - 📝 Manual Input (for LinkedIn, authenticated sites)
   ↓
4. Click "Optimize Resume"
   ↓
5. Wait 30-60 seconds
   ↓
6. Get optimized resume:
   - Auto-uploaded to Google Drive
   - Auto-logged to Google Sheets
   - Download as PDF/DOCX
```

### Mode Selection

**Use URL Mode when:**
- Job posting is publicly accessible
- Sites like Indeed, Greenhouse, Lever
- No login required

**Use Manual Mode when:**
- LinkedIn (requires login)
- Company career portals with authentication
- Any 403/blocked URLs
- Want to customize the JD text

---

## 🐛 Troubleshooting

### Issue: "Server offline"

**Solution:**
```bash
cd backend
node server.js
```
Keep terminal open while using extension.

---

### Issue: "Failed to fetch job page" (403 error)

**Solution:**
- Switch to **Manual JD Input** mode
- Copy job description from the page
- Paste into extension

---

### Issue: "This operation is not supported for this document"

**Solution:**
1. Your resume must be a **Google Doc**, not Word/PDF
2. If it's Word: Right-click in Drive → Open with → Google Docs
3. Get the new Document ID after conversion
4. Update `ORIGINAL_RESUME_DOC_ID` in `.env`

---

### Issue: "Permission denied" or "404 Not Found"

**Solution:**
1. Share all Google resources with your OAuth account:
   - Resume document
   - Drive folder
   - Tracking sheet
2. Give **Editor** access
3. Use the same Google account that created OAuth credentials

---

### Issue: Company/Position showing as "N/A" in sheet

**Check console output:**
```bash
# Look for these lines:
🔍 Extracting company and position...
🏢 Company extracted: [should show company]
💼 Position extracted: [should show position]
```

**If still N/A:**
- AI couldn't extract from JD
- Make sure JD includes company name and job title clearly
- Check first few lines of JD have this info

---

### Issue: Gemini API "Invalid API Key"

**Solutions:**
1. Enable Generative Language API: https://console.cloud.google.com/apis/library/generativelanguage.googleapis.com
2. Wait 2-3 minutes after enabling
3. Verify API key format: starts with `AIzaSy`, ~39 characters
4. Try creating new API keys

---

## 📁 Project Structure
```
RO/
├── backend/
│   ├── node_modules/
│   ├── .env                  # Environment variables (KEEP SECRET!)
│   ├── server.js             # Main backend server
│   ├── get-token.js          # OAuth token generator
│   ├── test-apis.js          # API testing script
│   └── package.json          # Dependencies
│
└── extension/
    ├── manifest.json         # Extension configuration
    ├── popup.html            # Main popup UI
    ├── popup.js              # Popup logic
    ├── options.html          # Settings page UI
    ├── options.js            # Settings page logic
    ├── styles.css            # All styles
    └── icon.png              # Extension icon
```

---

## 🔒 Security Notes

- **Never commit `.env` file** to version control
- Keep API keys private
- OAuth refresh token grants full access to your Google account data
- Extension only works with `localhost:3000` (not exposed to internet)

---

## 🚀 Quick Start Commands
```bash
# Start backend server
cd backend
node server.js

# Keep terminal open, then use Chrome extension!
```

---

## 💡 Tips

1. **Test with simple job first** - Use manual mode with short JD for first test
2. **Check Google Sheet** - Verify entries are being logged correctly
3. **Keep backend running** - Don't close terminal while using extension
4. **Use Indeed/Greenhouse** - These sites work well with URL mode
5. **LinkedIn = Manual mode** - Always use manual input for LinkedIn

---

## 📊 Expected Performance

- **URL fetch:** 2-5 seconds
- **JD extraction:** 3-8 seconds
- **Resume optimization:** 15-25 seconds
- **Document creation:** 2-5 seconds
- **Total time:** 30-60 seconds per optimization

---

## ✅ Success Checklist

- [ ] Node.js installed
- [ ] Google Cloud project created
- [ ] 4 APIs enabled (Docs, Drive, Sheets, Generative Language)
- [ ] OAuth credentials created (Desktop app)
- [ ] Refresh token generated
- [ ] API keys obtained (Gemini x3 OR ChatGPT x1)
- [ ] Resume uploaded to Google Docs
- [ ] Drive folder created
- [ ] Tracking sheet created with headers
- [ ] `.env` file configured with all IDs
- [ ] Backend dependencies installed
- [ ] Extension loaded in Chrome
- [ ] Extension settings configured
- [ ] Test optimization completed successfully

---

## 🎉 You're Ready!

Start optimizing resumes and tracking your applications automatically!

**Questions?** Check troubleshooting section or review error messages in:
- Backend terminal (for API errors)
- Chrome DevTools Console (F12 → Console for extension errors)

---

**Created by:** Lokesh Para  
**Last Updated:** November 28, 2025  
**Version:** 1.0.0
