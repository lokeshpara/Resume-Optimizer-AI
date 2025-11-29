// Backend server URL
const BACKEND_URL = 'http://localhost:3000';

// Global state to track current mode
let currentMode = null; // 'paste' or 'url'

// Wait for DOM to be fully loaded
document.addEventListener('DOMContentLoaded', function() {
  // DOM elements - States
  const modeSelectionState = document.getElementById('modeSelectionState');
  const pasteJdState = document.getElementById('pasteJdState');
  const urlModeState = document.getElementById('urlModeState');
  const loadingState = document.getElementById('loadingState');
  const successState = document.getElementById('successState');
  const errorState = document.getElementById('errorState');
  const settingsRequired = document.getElementById('settingsRequired');

  // Mode selection buttons
  const selectPasteMode = document.getElementById('selectPasteMode');
  const selectUrlMode = document.getElementById('selectUrlMode');

  // Paste mode elements
  const optimizePasteBtn = document.getElementById('optimizePasteBtn');
  const backFromPaste = document.getElementById('backFromPaste');
  const settingsBtnPaste = document.getElementById('settingsBtnPaste');
  const jobDescriptionInput = document.getElementById('jobDescriptionInput');
  const charCount = document.getElementById('charCount');
  const charWarning = document.getElementById('charWarning');

  // URL mode elements
  const optimizeUrlBtn = document.getElementById('optimizeUrlBtn');
  const backFromUrl = document.getElementById('backFromUrl');
  const settingsBtnUrl = document.getElementById('settingsBtnUrl');
  const currentUrl = document.getElementById('currentUrl');

  // Other buttons
  const settingsBtnMain = document.getElementById('settingsBtnMain');
  const settingsBtnSuccess = document.getElementById('settingsBtnSuccess');
  const openSettingsBtn = document.getElementById('openSettings');
  const retryBtn = document.getElementById('retryBtn');
  const optimizeAnother = document.getElementById('optimizeAnother');
  const backToModeSelection = document.getElementById('backToModeSelection');

  // Display elements
  const loadingStep = document.getElementById('loadingStep');
  const loadingModeIndicator = document.getElementById('loadingModeIndicator');
  const viewLink = document.getElementById('viewLink');
  const pdfLink = document.getElementById('pdfLink');
  const errorMessage = document.getElementById('errorMessage');
  const optimizationCount = document.getElementById('optimizationCount');
  const fileNameDisplay = document.getElementById('fileNameDisplay');
  const serverStatus = document.getElementById('serverStatus');
  const serverText = document.getElementById('serverText');
  const currentProvider = document.getElementById('currentProvider');

  // Check settings and server status on load
  checkSettings();
  checkServerStatus();

  // Mode selection event listeners
  if (selectPasteMode) {
    selectPasteMode.addEventListener('click', () => {
      currentMode = 'paste';
      showState('pasteJd');
    });
  }

  if (selectUrlMode) {
    selectUrlMode.addEventListener('click', async () => {
      currentMode = 'url';
      await updateCurrentUrl();
      showState('urlMode');
    });
  }

  // Back buttons
  if (backFromPaste) {
    backFromPaste.addEventListener('click', () => {
      currentMode = null;
      showState('modeSelection');
      // Clear input
      if (jobDescriptionInput) jobDescriptionInput.value = '';
      if (charCount) charCount.textContent = '0';
      if (charWarning) charWarning.style.display = 'none';
    });
  }

  if (backFromUrl) {
    backFromUrl.addEventListener('click', () => {
      currentMode = null;
      showState('modeSelection');
    });
  }

  if (backToModeSelection) {
    backToModeSelection.addEventListener('click', () => {
      currentMode = null;
      showState('modeSelection');
    });
  }

  // Optimize buttons
  if (optimizePasteBtn) optimizePasteBtn.addEventListener('click', () => optimizeResume('paste'));
  if (optimizeUrlBtn) optimizeUrlBtn.addEventListener('click', () => optimizeResume('url'));
  if (retryBtn) retryBtn.addEventListener('click', () => optimizeResume(currentMode));
  if (optimizeAnother) {
    optimizeAnother.addEventListener('click', () => {
      currentMode = null;
      showState('modeSelection');
      // Clear inputs
      if (jobDescriptionInput) jobDescriptionInput.value = '';
      if (charCount) charCount.textContent = '0';
      if (charWarning) charWarning.style.display = 'none';
    });
  }

  // Settings buttons
  const settingsButtons = [settingsBtnMain, settingsBtnPaste, settingsBtnUrl, settingsBtnSuccess, openSettingsBtn];
  settingsButtons.forEach(btn => {
    if (btn) btn.addEventListener('click', openSettings);
  });

  // Character counter for paste mode
  if (jobDescriptionInput) {
    jobDescriptionInput.addEventListener('input', function() {
      const length = this.value.length;
      
      if (charCount) {
        charCount.textContent = length.toLocaleString();
        
        // Color feedback
        if (length < 100) {
          charCount.style.color = '#e74c3c';
          if (charWarning) {
            charWarning.style.display = 'inline';
            charWarning.textContent = '⚠️ Too short (min 100 chars)';
          }
        } else if (length < 500) {
          charCount.style.color = '#f39c12';
          if (charWarning) {
            charWarning.style.display = 'inline';
            charWarning.textContent = '✓ Acceptable';
          }
        } else {
          charCount.style.color = '#27ae60';
          if (charWarning) {
            charWarning.style.display = 'inline';
            charWarning.textContent = '✓ Good length';
          }
        }
      }
    });
  }

  // Check if settings are configured
  function checkSettings() {
    chrome.storage.local.get(['aiProvider', 'geminiKey1', 'geminiKey2', 'geminiKey3', 'chatgptApiKey'], (result) => {
      const { aiProvider, geminiKey1, geminiKey2, geminiKey3, chatgptApiKey } = result;
      
      let settingsComplete = false;
      
      if (aiProvider === 'gemini') {
        settingsComplete = geminiKey1 && geminiKey2 && geminiKey3;
        if (settingsComplete && currentProvider) {
          currentProvider.textContent = `🤖 Gemini AI (3 keys)`;
        }
      } else if (aiProvider === 'chatgpt') {
        settingsComplete = chatgptApiKey;
        if (settingsComplete && currentProvider) {
          currentProvider.textContent = `🤖 ChatGPT GPT-4`;
        }
      }
      
      if (!settingsComplete) {
        showState('settingsRequired');
        if (currentProvider) currentProvider.textContent = '⚠️ Not configured';
      } else {
        showState('modeSelection');
      }
    });
  }

  // Check server status
  async function checkServerStatus() {
    try {
      const response = await fetch(`${BACKEND_URL}/health`, { timeout: 3000 });
      if (response.ok) {
        if (serverStatus) serverStatus.className = 'status-dot online';
        if (serverText) serverText.textContent = 'Server online';
      } else {
        if (serverStatus) serverStatus.className = 'status-dot offline';
        if (serverText) serverText.textContent = 'Server offline';
      }
    } catch (error) {
      if (serverStatus) serverStatus.className = 'status-dot offline';
      if (serverText) serverText.textContent = 'Server offline - Start backend';
    }
  }

  // Update current URL display
  async function updateCurrentUrl() {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (currentUrl && tab && tab.url) {
        const url = new URL(tab.url);
        currentUrl.textContent = `Current page: ${url.hostname}`;
        currentUrl.style.color = '#667eea';
      }
    } catch (error) {
      if (currentUrl) {
        currentUrl.textContent = 'Unable to detect current page';
        currentUrl.style.color = '#e74c3c';
      }
    }
  }

  // Open settings page
  function openSettings() {
    chrome.runtime.openOptionsPage();
  }

  // Main optimization function
  async function optimizeResume(mode) {
    try {
      currentMode = mode;
      
      // Get current tab
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      const jobUrl = tab.url;

      let manualJobDescription = null;

      // Validate based on mode
      if (mode === 'paste') {
        // Paste mode - get manual JD
        manualJobDescription = jobDescriptionInput.value.trim();
        
        if (!manualJobDescription) {
          showError('Please paste the job description in the text area');
          return;
        }

        if (manualJobDescription.length < 100) {
          showError('Job description is too short. Please paste the complete job description (at least 100 characters).');
          return;
        }

        console.log(`📝 Paste mode: ${manualJobDescription.length} characters`);
      } else if (mode === 'url') {
        // URL mode - validate URL
        if (!jobUrl || jobUrl.startsWith('chrome://') || jobUrl.startsWith('chrome-extension://')) {
          showError('Please navigate to a job posting page first');
          return;
        }

        console.log(`🌐 URL mode: ${jobUrl}`);
      }

      // Get saved settings
      const settings = await chrome.storage.local.get([
        'aiProvider', 
        'geminiKey1', 
        'geminiKey2', 
        'geminiKey3', 
        'chatgptApiKey'
      ]);

      const { aiProvider, geminiKey1, geminiKey2, geminiKey3, chatgptApiKey } = settings;

      // Validate settings
      if (!aiProvider) {
        showError('Please configure your AI provider in Settings first');
        return;
      }

      if (aiProvider === 'gemini' && (!geminiKey1 || !geminiKey2 || !geminiKey3)) {
        showError('Please configure all 3 Gemini API keys in Settings');
        return;
      }

      if (aiProvider === 'chatgpt' && !chatgptApiKey) {
        showError('Please configure your ChatGPT API key in Settings');
        return;
      }

      // Show loading state
      showState('loading');
      
      // Set mode indicator in loading screen
      if (loadingModeIndicator) {
        loadingModeIndicator.textContent = mode === 'paste' ? '📝 Using Manual JD' : '🌐 Fetching from URL';
      }
      
      // Update loading steps based on mode
      const steps = mode === 'paste' 
        ? [
            { text: 'Processing manual job description...', delay: 0 },
            { text: 'Analyzing resume vs job requirements...', delay: 8000 },
            { text: 'Generating optimization points...', delay: 15000 },
            { text: 'Rewriting resume with AI...', delay: 25000 },
            { text: 'Creating formatted document...', delay: 35000 }
          ]
        : [
            { text: 'Fetching job page from URL...', delay: 0 },
            { text: 'Extracting job description...', delay: 5000 },
            { text: 'Analyzing resume vs job requirements...', delay: 13000 },
            { text: 'Generating optimization points...', delay: 20000 },
            { text: 'Rewriting resume with AI...', delay: 30000 },
            { text: 'Creating formatted document...', delay: 40000 }
          ];

      let currentStep = 0;
      const stepInterval = setInterval(() => {
        if (currentStep < steps.length) {
          if (loadingStep) loadingStep.textContent = steps[currentStep].text;
          updateProgressStep(currentStep);
          currentStep++;
        }
      }, mode === 'paste' ? 8000 : 7000);

    // Prepare request body based on mode
    const requestBody = {
        aiProvider
    };
    
    // Add appropriate content based on mode
    if (mode === 'paste') {
        // Paste mode - send manual JD only
        requestBody.manualJobDescription = manualJobDescription;
        console.log('📝 Sending manual JD only (no URL)');
    } else {
        // URL mode - send jobUrl only
        requestBody.jobUrl = jobUrl;
        console.log('🌐 Sending URL only (no manual JD)');
    }

      // Add API keys based on provider
      if (aiProvider === 'gemini') {
        requestBody.geminiKey1 = geminiKey1;
        requestBody.geminiKey2 = geminiKey2;
        requestBody.geminiKey3 = geminiKey3;
      } else {
        requestBody.chatgptApiKey = chatgptApiKey;
      }

      console.log('📤 Sending request to backend...', {
        mode,
        hasManualJD: !!manualJobDescription,
        hasJobUrl: !!jobUrl,
        aiProvider
      });

      // Call backend API
      const response = await fetch(`${BACKEND_URL}/api/optimize-resume`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(requestBody)
      });

      clearInterval(stepInterval);

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.details || error.error || 'Server error occurred');
      }

      const data = await response.json();

      console.log('✅ Optimization complete:', data);

      // Show success state
      showSuccess(data);

      // Save to history
      saveToHistory(jobUrl, data, mode);

    } catch (error) {
      console.error('❌ Error:', error);
      showError(error.message || 'Failed to optimize resume. Please try again.');
    }
  }

  // Show different states
  function showState(state) {
    // Hide all states
    const states = [modeSelectionState, pasteJdState, urlModeState, loadingState, successState, errorState, settingsRequired];
    states.forEach(s => {
      if (s) s.style.display = 'none';
    });

    // Show requested state
    switch (state) {
      case 'modeSelection':
        if (modeSelectionState) modeSelectionState.style.display = 'block';
        break;
      case 'pasteJd':
        if (pasteJdState) pasteJdState.style.display = 'block';
        break;
      case 'urlMode':
        if (urlModeState) urlModeState.style.display = 'block';
        break;
      case 'loading':
        if (loadingState) loadingState.style.display = 'block';
        break;
      case 'success':
        if (successState) successState.style.display = 'block';
        break;
      case 'error':
        if (errorState) errorState.style.display = 'block';
        break;
      case 'settingsRequired':
        if (settingsRequired) settingsRequired.style.display = 'block';
        break;
    }
  }

    // Show success state
    function showSuccess(data) {
        if (viewLink) viewLink.href = data.links.editInGoogleDocs;
        if (pdfLink) pdfLink.href = data.links.downloadPDF;
        
        // Show tracking sheet link if available
        const trackingSheetLink = document.getElementById('trackingSheetLink');
        if (trackingSheetLink && data.links.trackingSheet) {
        trackingSheetLink.href = data.links.trackingSheet;
        trackingSheetLink.style.display = 'block';
        }
        
        const pointsText = data.optimizationPoints 
        ? `${data.optimizationPoints} optimizations applied with ${data.keysUsed || data.aiProvider}`
        : 'Resume optimized successfully';
        if (optimizationCount) optimizationCount.textContent = pointsText;
    
        // Display filename
        if (fileNameDisplay && data.fileName) {
        fileNameDisplay.textContent = `📄 ${data.fileName}`;
        fileNameDisplay.style.display = 'block';
        }
    
        // NEW: Display job details
        const jobDetails = document.getElementById('jobDetails');
        if (jobDetails && data.companyName && data.position) {
        jobDetails.textContent = `🏢 ${data.companyName} • 💼 ${data.position}`;
        jobDetails.style.display = 'block';
        }
    
        showState('success');
    }

  // Show error state
  function showError(message) {
    if (errorMessage) errorMessage.textContent = message;
    showState('error');
  }

  // Update progress step indicator
  function updateProgressStep(index) {
    const steps = document.querySelectorAll('.step');
    steps.forEach((step, i) => {
      if (i <= index) {
        step.classList.add('active');
      } else {
        step.classList.remove('active');
      }
    });
  }

  // Save to history
  function saveToHistory(jobUrl, data, mode) {
    chrome.storage.local.get(['history'], (result) => {
      const history = result.history || [];
      history.unshift({
        jobUrl: mode === 'paste' ? 'Manual JD Input' : jobUrl,
        timestamp: new Date().toISOString(),
        documentId: data.documentId,
        fileName: data.fileName,
        links: data.links,
        aiProvider: data.aiProvider,
        contentSource: data.contentSource,
        optimizationPoints: data.optimizationPoints,
        mode: mode
      });
      
      if (history.length > 50) {
        history.pop();
      }
      
      chrome.storage.local.set({ history });
    });
  }
});