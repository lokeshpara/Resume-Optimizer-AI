# Resume Optimizer AI - Chrome Extension with AI & Google Workspace Integration

[![GitHub](https://img.shields.io/github/license/lokeshpara/Resume-Optimizer-AI)](https://github.com/lokeshpara/Resume-Optimizer-AI/blob/main/LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D14.0.0-brightgreen)](https://nodejs.org/)
[![Chrome Extension](https://img.shields.io/badge/Chrome-Extension-blue)](https://chrome.google.com/webstore)
[![Google Gemini](https://img.shields.io/badge/Google-Gemini_2.0-4285F4)](https://ai.google.dev/)
[![Stars](https://img.shields.io/github/stars/lokeshpara/Resume-Optimizer-AI)](https://github.com/lokeshpara/Resume-Optimizer-AI/stargazers)

**AI-powered resume optimization with automatic Google Drive tracking, PostgreSQL database, recruiter automation, and comprehensive 4-score analysis system**

---

## 📋 Table of Contents

1. [Overview](#overview)
2. [Features](#features)
3. [Architecture](#architecture)
4. [Prerequisites](#prerequisites)
5. [Setup Guide](#setup-guide)
6. [Usage](#usage)
7. [API Endpoints](#api-endpoints)
8. [Database Schema](#database-schema)
9. [Project Structure](#project-structure)
10. [Troubleshooting](#troubleshooting)
11. [Contributing](#contributing)

---

## 🎯 Overview

Resume Optimizer AI is a comprehensive Chrome extension that uses AI (Google Gemini 2.0 or ChatGPT GPT-4) to optimize resumes for specific job descriptions. It automatically:

- **Optimizes resumes** with 8-20 strategic improvements per job
- **Tracks applications** in PostgreSQL database
- **Uploads optimized resumes** to Google Drive
- **Finds recruiters** using AI-powered LinkedIn search
- **Generates personalized emails** and creates Gmail drafts
- **Provides 4-score analysis** (Resume-JD Match, Experience-Role Fit, Post-Optimization Potential, Selection Probability)

---

## ✨ Features

### Core Features

- **Dual Mode Operation:**
  - 🌐 **URL Mode**: Automatically fetch job description from any job posting URL
  - 📝 **Manual Mode**: Paste job description directly (works for authenticated sites like LinkedIn)

- **Multi-AI Provider Support:**
  - Google Gemini 2.0 Flash (3 API keys for load distribution)
  - ChatGPT GPT-4 (1-3 API keys for load distribution)

- **Intelligent Resume Optimization:**
  - ATS score optimization (85-92% target)
  - Keyword matching from job description
  - Skills gap analysis
  - Achievement quantification suggestions
  - 8-20 specific optimization points per resume
  - Human-written style (not keyword-stuffed)
  - Automatic resume type selection (Frontend vs Full Stack)

- **Automatic Tracking:**
  - PostgreSQL database for application tracking
  - Uploads optimized resume to Google Drive
  - Auto-generates filenames: `Lokesh_Para_Position_Company`
  - Tracks company, position, date, resume link, JD text

- **Professional Output:**
  - Google Docs format with proper styling
  - Skills table with proper formatting
  - Download as PDF, DOCX, or edit in Google Docs

### Advanced Features

- **4-Score Analysis System:**
  - Resume-JD Match Score
  - Experience-Role Fit Score
  - Post-Optimization Potential Score
  - Selection Probability Score

- **Recruiter Automation:**
  - AI-powered LinkedIn recruiter search (via SerpAPI)
  - Top 3 recruiter selection using AI
  - Email finding via Hunter.io
  - Personalized email generation
  - Gmail draft creation

- **Dashboard:**
  - Application tracking dashboard
  - KPIs and statistics
  - Status distribution charts
  - Recent activity feed
  - Notes and contacts management

---

## 🏗️ Architecture

### System Components

```
┌─────────────────┐
│ Chrome Extension│
│  (popup.js)     │
└────────┬────────┘
         │ HTTP Requests
         ▼
┌─────────────────────────────────────┐
│   Backend Server (Port 3000)       │
│   - Resume Optimization            │
│   - Google Drive Integration        │
│   - PostgreSQL Database             │
│   - Recruiter Automation            │
└────────┬────────────────────────────┘
         │
         ├──► Google APIs (Docs, Drive, Sheets, Gmail)
         ├──► AI APIs (Gemini/ChatGPT)
         ├──► PostgreSQL Database
         ├──► Hunter.io API
         └──► SerpAPI
         │
┌────────▼────────────────────────────┐
│   Analysis Server (Port 3001)       │
│   - 4-Score Analysis                │
│   - Resume Analysis                 │
└─────────────────────────────────────┘
```

### Technology Stack

- **Frontend:** Chrome Extension (Manifest V3), HTML5, CSS3, JavaScript
- **Backend:** Node.js, Express.js
- **Database:** PostgreSQL
- **APIs:** Google Docs API, Google Drive API, Google Sheets API, Gmail API
- **AI:** Google Gemini 2.0 Flash / OpenAI GPT-4
- **External Services:** Hunter.io, SerpAPI

---

## 🔧 Prerequisites

- **Node.js** (v14 or higher) - [Download](https://nodejs.org/)
- **PostgreSQL** (v12 or higher) - [Download](https://www.postgresql.org/download/)
- **Google Account** (for Google Cloud APIs)
- **Chrome Browser** (for extension)
- **AI API Keys:**
  - Either 3 Google Gemini API keys OR
  - 1-3 OpenAI ChatGPT API keys
- **Optional APIs:**
  - Hunter.io API key (for recruiter email finding)
  - SerpAPI key (for LinkedIn recruiter search)

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

Enable these APIs (click each link and press "ENABLE"):

1. [Google Docs API](https://console.cloud.google.com/apis/library/docs.googleapis.com)
2. [Google Drive API](https://console.cloud.google.com/apis/library/drive.googleapis.com)
3. [Google Sheets API](https://console.cloud.google.com/apis/library/sheets.googleapis.com)
4. [Gmail API](https://console.cloud.google.com/apis/library/gmail.googleapis.com)
5. [Generative Language API](https://console.cloud.google.com/apis/library/generativelanguage.googleapis.com) *(if using Gemini)*

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

5. **Download JSON** or note down Client ID & Client Secret

#### Step 1.4: Create Separate Gmail OAuth (for Recruiter Emails)

Repeat Step 1.3 to create a **second OAuth client** specifically for Gmail (use different name like "Resume Optimizer Gmail"). This allows using a separate Google account for sending recruiter emails.

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
5. **Optional:** Create 2 more keys for load distribution

**Save these keys** - they won't be shown again.

#### Optional: Hunter.io API Key

1. Go to [Hunter.io](https://hunter.io/)
2. Sign up for free account
3. Get API key from dashboard
4. Free tier: 25 searches/month

#### Optional: SerpAPI Key

1. Go to [SerpAPI](https://serpapi.com/)
2. Sign up for free account
3. Get API key from dashboard
4. Free tier: 100 searches/month

---

### Part 3: Database Setup

#### Step 3.1: Install PostgreSQL

Install PostgreSQL on your system if not already installed.

#### Step 3.2: Create Database

```bash
# Connect to PostgreSQL
psql -U postgres

# Create database
CREATE DATABASE resume_optimizer;

# Connect to database
\c resume_optimizer
---

### Part 4: Backend Setup

#### Step 4.1: Install Dependencies

```bash
cd backend
npm install
```

#### Step 4.2: Generate Refresh Tokens

**For Google Docs/Drive/Sheets:**

1. Create `backend/.env` file:
```bash
GOOGLE_CLIENT_ID=your_client_id_here
GOOGLE_CLIENT_SECRET=your_client_secret_here
```

2. Run token generator:
```bash
node get-token.js
```

3. Follow the prompts to get refresh token

**For Gmail (Separate Account):**

1. Update `.env` with Gmail OAuth credentials:
```bash
GMAIL_CLIENT_ID=your_gmail_client_id_here
GMAIL_CLIENT_SECRET=your_gmail_client_secret_here
```

2. Visit: `http://localhost:3000/auth/gmail`
3. Authorize and copy the refresh token

#### Step 4.3: Prepare Google Drive & Docs

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

**Upload Your Original Resumes:**

1. Go to [Google Docs](https://docs.google.com/)
2. Upload your **Frontend Resume** (if applicable)
3. Upload your **Full Stack Resume**
4. **Open with Google Docs** (if they're Word files)
5. Copy **Document IDs** from URLs:
```
https://docs.google.com/document/d/13oOMXjl7zBWIujaxtdZ9e6w73IqjqP0m/edit
                                    ↑_____________________________↑
                                    This is the Document ID
```

#### Step 4.4: Configure Environment Variables

**Update `backend/.env` with all credentials:**

```bash
# Google OAuth Credentials (for Docs/Drive/Sheets)
GOOGLE_CLIENT_ID=123456789-abc.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=GOCSPX-abc123xyz
GOOGLE_REFRESH_TOKEN=1//014zRHbtissieCgYIARAAGAESNwF-L9IrCdJ5K_5...

# Gmail OAuth Credentials (separate account for recruiter emails)
GMAIL_CLIENT_ID=123456789-xyz.apps.googleusercontent.com
GMAIL_CLIENT_SECRET=GOCSPX-xyz789abc
GMAIL_REFRESH_TOKEN=1//014zRHbtissieCgYIARAAGAESNwF-L9IrCdJ5K_5...

# Google Drive & Docs
FRONTEND_RESUME_DOC_ID=13oOMXjl7zBWIujaxtdZ9e6w73IqjqP0m
FULLSTACK_RESUME_DOC_ID=14pPNYkm8zCXJkvjaxtdZ9e6w73IqjqP0n
DRIVE_FOLDER_ID=1zpd8t-2FtpK3ZRhdpnn0cuDp-a5lgv9q

# PostgreSQL Database
DATABASE_URL=postgresql://username:password@localhost:5432/resume_optimizer

# Optional: Hunter.io API (for recruiter email finding)
HUNTER_API_KEY=your_hunter_api_key_here

# Optional: SerpAPI (for LinkedIn recruiter search)
SERP_API_KEY=your_serpapi_key_here

# Optional: AI Provider (defaults to gemini)
AI_PROVIDER=gemini
```

**⚠️ Important:** Replace ALL placeholder values with your actual IDs and keys!

#### Step 4.5: Start Backend Servers

**Terminal 1 - Main Server (Port 3000):**
```bash
cd backend
node server.js
```

**Terminal 2 - Analysis Server (Port 3001):**
```bash
cd backend
node server-analysis.js
```

You should see:
```
🚀 Resume Optimizer Backend Running!
📍 http://localhost:3000
✅ Health: http://localhost:3000/health
🤖 Supports: Gemini AI & ChatGPT

📊 Resume Analysis Server Running!
📍 http://localhost:3001
✅ Health: http://localhost:3001/health
```

---

### Part 5: Chrome Extension Setup

#### Step 5.1: Load Extension in Chrome

1. Open Chrome
2. Go to `chrome://extensions/`
3. Enable **"Developer mode"** (top right toggle)
4. Click **"Load unpacked"**
5. Select your `extension/` folder
6. Extension should appear with your icon

#### Step 5.2: Configure Extension Settings

1. Click extension icon in Chrome
2. Click **"Settings"** (⚙️)
3. **Select AI Provider:**
   - Choose "Google Gemini" or "ChatGPT"
4. **Enter API Keys:**
   - If Gemini: Paste all 3 API keys
   - If ChatGPT: Paste 1-3 API keys
5. Click **"Save Settings"**
6. Should see: ✅ Settings saved!

---

## 📖 Usage

### Basic Workflow

```
1. Navigate to job posting OR prepare JD text
   ↓
2. Click extension icon
   ↓
3. Choose action:
   - 📊 Analyze Resume (4-score analysis)
   - 🚀 Optimize Resume (create optimized version)
   ↓
4. Choose mode:
   - 🌐 Fetch from URL (for accessible sites)
   - 📝 Manual Input (for LinkedIn, authenticated sites)
   ↓
5. Click "Optimize Resume" or "Analyze Resume"
   ↓
6. Wait 30-60 seconds
   ↓
7. Get results:
   - Optimized resume auto-uploaded to Google Drive
   - Application logged to PostgreSQL database
   - Download as PDF/DOCX
   - (Optional) Recruiter emails created in Gmail
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

### Recruiter Automation

1. Open dashboard: `http://localhost:3000/dashboard`
2. Find an application
3. Click "Find Recruiters"
4. System will:
   - Search LinkedIn for company recruiters
   - AI selects top 3 best matches
   - Find emails via Hunter.io
   - Generate personalized emails
   - Create Gmail drafts

---

## 🔌 API Endpoints

### Main Server (Port 3000)

#### Resume Optimization
- `POST /api/optimize-resume` - Optimize resume for job description
  - Body: `{ jobUrl, manualJobDescription, aiProvider, geminiKey1-3, chatgptApiKey }`
  - Returns: Optimized resume link, company, position, optimization points

#### Applications
- `GET /api/applications` - Get all applications (with filters)
  - Query params: `status`, `days`, `search`
- `GET /api/applications/:id` - Get single application
- `PUT /api/applications/:id` - Update application
- `DELETE /api/applications/:id` - Delete application

#### Dashboard
- `GET /api/dashboard/summary` - Get KPIs
- `GET /api/dashboard/daily` - Daily application count (30 days)
- `GET /api/dashboard/status-dist` - Status distribution
- `GET /api/dashboard/recent` - Recent activity

#### Notes
- `GET /api/applications/:id/notes` - Get notes for application
- `POST /api/applications/:id/notes` - Add note
- `DELETE /api/notes/:noteId` - Delete note

#### Contacts
- `GET /api/applications/:id/contacts` - Get contacts for application
- `POST /api/applications/:id/contacts` - Create contact and link
- `GET /api/contacts/:id` - Get single contact
- `PUT /api/contacts/:id` - Update contact
- `DELETE /api/applications/:appId/contacts/:contactId` - Unlink and delete

#### Recruiter Automation
- `POST /api/applications/:id/find-recruiters` - Find recruiters and create email drafts
- `GET /api/gmail-drafts` - Get Gmail drafts
- `POST /api/test/hunter` - Test Hunter.io API
- `POST /api/test/gmail` - Test Gmail API

#### Export
- `GET /api/export/csv` - Export applications as CSV

#### Health
- `GET /health` - Server health check

### Analysis Server (Port 3001)

#### Resume Analysis
- `POST /api/analyze-resume` - 4-score analysis
  - Body: `{ jobUrl, manualJobDescription, aiProvider, geminiKey1-3, chatgptApiKey }`
  - Returns: 4 scores, detailed reports, summary

#### Health
- `GET /health` - Server health check

---

## 🗄️ Database Schema

### Tables

**applications**
- `id` (SERIAL PRIMARY KEY)
- `company_name` (VARCHAR)
- `position_applied` (VARCHAR)
- `date_applied` (DATE)
- `status` (VARCHAR) - Applied, Interview, Offer, Rejected
- `resume_link` (TEXT)
- `jd_link` (TEXT)
- `jd_text` (TEXT)
- `created_at` (TIMESTAMP)
- `updated_at` (TIMESTAMP)
- `search_vector` (TSVECTOR) - For full-text search

**notes**
- `id` (SERIAL PRIMARY KEY)
- `application_id` (INTEGER) - FK to applications
- `note_text` (TEXT)
- `created_at` (TIMESTAMP)

**contacts**
- `id` (SERIAL PRIMARY KEY)
- `full_name` (VARCHAR)
- `email` (VARCHAR UNIQUE)
- `linkedin_url` (TEXT)
- `role` (VARCHAR)
- `notes` (TEXT)
- `created_at` (TIMESTAMP)

**application_contacts**
- `application_id` (INTEGER) - FK to applications
- `contact_id` (INTEGER) - FK to contacts
- PRIMARY KEY (application_id, contact_id)

---

## 📁 Project Structure

```
Resume-Optimizer-AI/
├── backend/
│   ├── node_modules/
│   ├── public/
│   │   ├── dashboard.html          # Dashboard UI
│   │   ├── dashboard.js            # Dashboard logic
│   │   ├── dashboard.css           # Dashboard styles
│   │   ├── application.html        # Application details UI
│   │   ├── application.js          # Application details logic
│   │   └── application.css         # Application styles
│   ├── .env                        # Environment variables (KEEP SECRET!)
│   ├── server.js                   # Main backend server (Port 3000)
│   ├── server-analysis.js          # Analysis server (Port 3001)
│   ├── get-token.js               # OAuth token generator
│   ├── recruiter-automation-v2.js # Recruiter finder & email automation
│   ├── package.json               # Dependencies
│   └── package-lock.json
│
└── extension/
    ├── icons/
    │   ├── icon16.png
    │   ├── icon48.png
    │   └── icon128.png
    ├── manifest.json               # Extension configuration
    ├── popup.html                  # Main popup UI
    ├── popup.js                    # Popup logic
    ├── options.html                # Settings page UI
    ├── options.js                  # Settings page logic
    ├── results.html                # Analysis results page
    ├── results.js                  # Results page logic
    └── styles.css                  # Extension styles
```

---

## 🚀 Quick Start Commands

```bash
# Start backend servers
cd backend
node server.js              # Terminal 1 (Port 3000)
node server-analysis.js      # Terminal 2 (Port 3001)

# Keep terminals open, then use Chrome extension!
```

---

## 💡 Tips

1. **Test with simple job first** - Use manual mode with short JD for first test
2. **Check database** - Verify entries are being logged correctly
3. **Keep servers running** - Don't close terminals while using extension
4. **Use Indeed/Greenhouse** - These sites work well with URL mode
5. **LinkedIn = Manual mode** - Always use manual input for LinkedIn
6. **Monitor API usage** - Track your AI API key usage to avoid rate limits
7. **Review Gmail drafts** - Always review AI-generated emails before sending

---

## 📊 Expected Performance

- **URL fetch:** 2-5 seconds
- **JD extraction:** 3-8 seconds
- **Resume optimization:** 15-25 seconds
- **Document creation:** 2-5 seconds
- **Total optimization time:** 30-60 seconds per optimization
- **4-score analysis:** 20-40 seconds
- **Recruiter automation:** 30-60 seconds per recruiter

---

## ✅ Success Checklist

- [ ] Node.js installed
- [ ] PostgreSQL installed and database created
- [ ] Google Cloud project created
- [ ] 5 APIs enabled (Docs, Drive, Sheets, Gmail, Generative Language)
- [ ] OAuth credentials created (Desktop app) - 2 sets (main + Gmail)
- [ ] Refresh tokens generated (main + Gmail)
- [ ] API keys obtained (Gemini x3 OR ChatGPT x1-3)
- [ ] Resumes uploaded to Google Docs (Frontend + Full Stack)
- [ ] Drive folder created
- [ ] `.env` file configured with all IDs and keys
- [ ] Backend dependencies installed
- [ ] Both servers running (ports 3000 and 3001)
- [ ] Extension loaded in Chrome
- [ ] Extension settings configured
- [ ] Test optimization completed successfully
- [ ] Optional: Hunter.io and SerpAPI keys configured

---

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

---

## 📝 License

This project is licensed under the MIT License - see the LICENSE file for details.

---

## 🎉 You're Ready!

Start optimizing resumes and tracking your applications automatically!

**Questions?** Check troubleshooting section or review error messages in:
- Backend terminal (for API errors)
- Chrome DevTools Console (F12 → Console for extension errors)

---

**Created by:** Lokesh Para  
**Last Updated:** January 2025  
**Version:** 2.0.0
 
