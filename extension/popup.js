// Backend server URLs
const BACKEND_URL = 'http://localhost:3000';
const ANALYSIS_URL = 'http://localhost:3001';

// Global state to track current mode
let currentMode = null; // 'paste' or 'url'
let currentAction = 'optimize'; // 'analyze' or 'optimize'

// Wait for DOM to be fully loaded
document.addEventListener('DOMContentLoaded', function () {
  // DOM elements - States
  const modeSelectionState = document.getElementById('modeSelectionState');
  const actionSelectionState = document.getElementById('actionSelectionState');
  const pasteJdState = document.getElementById('pasteJdState');
  const urlModeState = document.getElementById('urlModeState');
  const loadingState = document.getElementById('loadingState');
  const successState = document.getElementById('successState');
  const errorState = document.getElementById('errorState');
  const settingsRequired = document.getElementById('settingsRequired');

  // Action selection buttons
  const selectAnalyzeMode = document.getElementById('selectAnalyzeMode');
  const selectOptimizeMode = document.getElementById('selectOptimizeMode');

  // Mode selection buttons
  const selectPasteMode = document.getElementById('selectPasteMode');
  const selectUrlMode = document.getElementById('selectUrlMode');

  // Paste mode elements
  const optimizePasteBtn = document.getElementById('optimizePasteBtn');
  const backFromPaste = document.getElementById('backFromPaste');
  const jobDescriptionInput = document.getElementById('jobDescriptionInput');
  const charCount = document.getElementById('charCount');
  const charWarning = document.getElementById('charWarning');

  // URL mode elements
  const optimizeUrlBtn = document.getElementById('optimizeUrlBtn');
  const backFromUrl = document.getElementById('backFromUrl');
  const currentUrl = document.getElementById('currentUrl');

  // Other buttons
  const settingsBtn = document.getElementById('settingsBtn');
  const retryBtn = document.getElementById('retryBtn');
  const optimizeAnother = document.getElementById('optimizeAnother');
  const backToModeSelection = document.getElementById('backToModeSelection');

  // Display elements
  const loadingStep = document.getElementById('loadingStep');
  const viewLink = document.getElementById('viewLink');
  const pdfLink = document.getElementById('pdfLink');
  const errorMessage = document.getElementById('errorMessage');
  const optimizationCount = document.getElementById('optimizationCount');
  const serverStatus = document.getElementById('serverStatus');
  const serverText = document.getElementById('serverText');
  const currentProvider = document.getElementById('currentProvider');

  // Check settings and server status on load
  checkSettings();
  checkServerStatus();

  // Action selection listeners
  if (selectAnalyzeMode) {
    selectAnalyzeMode.addEventListener('click', () => {
      currentAction = 'analyze';
      showState('modeSelection');
      updateButtonTexts();
    });
  }

  if (selectOptimizeMode) {
    selectOptimizeMode.addEventListener('click', () => {
      currentAction = 'optimize';
      showState('modeSelection');
      updateButtonTexts();
    });
  }

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
      showState('actionSelection');
      // Clear input
      if (jobDescriptionInput) jobDescriptionInput.value = '';
      if (charCount) charCount.textContent = '0';
      if (charWarning) charWarning.style.display = 'none';
    });
  }

  if (backFromUrl) {
    backFromUrl.addEventListener('click', () => {
      currentMode = null;
      showState('actionSelection');
    });
  }

  if (backToModeSelection) {
    backToModeSelection.addEventListener('click', () => {
      currentMode = null;
      currentAction = 'optimize';
      showState('actionSelection');
    });
  }

  // Optimize buttons
  if (optimizePasteBtn) optimizePasteBtn.addEventListener('click', () => optimizeResume('paste'));
  if (optimizeUrlBtn) optimizeUrlBtn.addEventListener('click', () => optimizeResume('url'));
  if (retryBtn) retryBtn.addEventListener('click', () => optimizeResume(currentMode));
  if (optimizeAnother) {
    optimizeAnother.addEventListener('click', () => {
      currentMode = null;
      currentAction = 'optimize';
      showState('actionSelection');
    });
  }

  // Settings button
  if (settingsBtn) {
    settingsBtn.addEventListener('click', () => {
      chrome.runtime.openOptionsPage();
    });
  }

  // Character counter for job description
  if (jobDescriptionInput) {
    jobDescriptionInput.addEventListener('input', () => {
      const text = jobDescriptionInput.value;
      const length = text.length;

      if (charCount) charCount.textContent = length.toLocaleString();

      if (charWarning) {
        if (length < 100) {
          charWarning.textContent = 'Needs at least 100 characters';
          charWarning.style.display = 'inline';
          charWarning.style.color = '#ef4444';
        } else if (length < 300) {
          charWarning.textContent = 'Consider adding more details';
          charWarning.style.display = 'inline';
          charWarning.style.color = '#f59e0b';
        } else {
          charWarning.style.display = 'none';
        }
      }
    });
  }

  // Update button texts based on current action
  function updateButtonTexts() {
    const pasteBtnText = document.getElementById('pasteBtnText');
    const urlBtnText = document.getElementById('urlBtnText');
    const loadingTitle = document.getElementById('loadingTitle');

    if (currentAction === 'analyze') {
      if (pasteBtnText) pasteBtnText.textContent = '📊 Analyze Resume';
      if (urlBtnText) urlBtnText.textContent = '📊 Analyze Resume';
      if (loadingTitle) loadingTitle.textContent = 'Analyzing Your Resume';
    } else {
      if (pasteBtnText) pasteBtnText.textContent = '⚡ Optimize Resume';
      if (urlBtnText) urlBtnText.textContent = '⚡ Optimize Resume';
      if (loadingTitle) loadingTitle.textContent = 'Optimizing Your Resume';
    }
  }

  // Show specific state
  function showState(stateName) {
    // Map of state names to elements
    const states = {
      'actionSelection': actionSelectionState,
      'modeSelection': modeSelectionState,
      'pasteJd': pasteJdState,
      'urlMode': urlModeState,
      'loading': loadingState,
      'success': successState,
      'error': errorState,
      'settingsRequired': settingsRequired
    };

    // Hide all states
    Object.values(states).forEach(state => {
      if (state) state.style.display = 'none';
    });

    // Show requested state
    const targetState = states[stateName];
    if (targetState) {
      targetState.style.display = 'block';
    }
  }

  // Check if settings are configured
  function checkSettings() {
    chrome.storage.local.get([
      'aiProvider', 'geminiKey1', 'geminiKey2', 'geminiKey3',
      'chatgptApiKey', 'chatgptKey2', 'chatgptKey3'
    ], (result) => {
      const provider = result.aiProvider;

      // Update provider badge
      if (currentProvider) {
        if (provider === 'gemini') {
          currentProvider.textContent = 'Gemini AI';
        } else if (provider === 'chatgpt') {
          currentProvider.textContent = 'ChatGPT';
        } else {
          currentProvider.textContent = 'Not configured';
        }
      }

      // Check if keys are set
      const hasKeys = provider === 'gemini'
        ? (result.geminiKey1 && result.geminiKey2 && result.geminiKey3)
        : (result.chatgptApiKey && result.chatgptKey2 && result.chatgptKey3);

      if (provider && hasKeys) {
        showState('actionSelection');
      } else {
        showState('settingsRequired');
      }
    });
  }

  // Check server status
  async function checkServerStatus() {
    try {
      const [optResponse, anaResponse] = await Promise.all([
        fetch(`${BACKEND_URL}/health`, { method: 'GET', signal: AbortSignal.timeout(5000) }).catch(() => null),
        fetch(`${ANALYSIS_URL}/health`, { method: 'GET', signal: AbortSignal.timeout(5000) }).catch(() => null)
      ]);

      const optOk = optResponse?.ok;
      const anaOk = anaResponse?.ok;

      if (serverStatus && serverText) {
        if (optOk && anaOk) {
          serverStatus.style.background = '#10b981';
          serverText.textContent = 'Both servers online';
        } else if (optOk) {
          serverStatus.style.background = '#f59e0b';
          serverText.textContent = 'Optimize ready';
        } else if (anaOk) {
          serverStatus.style.background = '#f59e0b';
          serverText.textContent = 'Analysis ready';
        } else {
          serverStatus.style.background = '#ef4444';
          serverText.textContent = 'Servers offline';
        }
      }
    } catch (error) {
      if (serverStatus && serverText) {
        serverStatus.style.background = '#ef4444';
        serverText.textContent = 'Servers offline';
      }
    }
  }

  // Get current tab URL
  async function getCurrentTabUrl() {
    return new Promise((resolve) => {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs && tabs[0]) {
          resolve(tabs[0].url);
        } else {
          resolve(null);
        }
      });
    });
  }

  // Update current URL display
  async function updateCurrentUrl() {
    const url = await getCurrentTabUrl();
    if (currentUrl) {
      currentUrl.textContent = url || 'Could not get URL';
    }
  }

  // Update loading step
  function updateLoadingStep(message, progress) {
    if (loadingStep) {
      loadingStep.textContent = message;
    }

    // Update progress bar
    const progressFill = document.getElementById('progressFill');
    if (progressFill) {
      progressFill.style.width = progress + '%';
    }

    // Update step indicators
    const steps = [
      document.getElementById('step1'),
      document.getElementById('step2'),
      document.getElementById('step3'),
      document.getElementById('step4')
    ];

    const activeStep = Math.ceil(progress / 25);
    steps.forEach((step, index) => {
      if (step) {
        if (index < activeStep) {
          step.classList.add('active');
        } else {
          step.classList.remove('active');
        }
      }
    });
  }

  // CONTINUED IN PART 2...
  // PART 2 - Main Functions

  // Handle Analysis (NEW FUNCTION)
  async function handleAnalyze(jobDescription, jobUrl) {
    try {
      updateLoadingStep('Analyzing resume...', 20);

      const settings = await chrome.storage.local.get([
        'aiProvider', 'geminiKey1', 'geminiKey2', 'geminiKey3',
        'chatgptApiKey', 'chatgptKey2', 'chatgptKey3'
      ]);

      const response = await fetch(`${ANALYSIS_URL}/api/analyze-resume`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jobUrl: jobUrl || null,
          currentPageUrl: jobUrl || null,
          aiProvider: settings.aiProvider,
          geminiKey1: settings.geminiKey1,  // For Score 1
          geminiKey2: settings.geminiKey2,  // For Score 2
          geminiKey3: settings.geminiKey3,  // For Score 3 & 4
          chatgptApiKey: settings.chatgptApiKey,
          chatgptKey2: settings.chatgptKey2,
          chatgptKey3: settings.chatgptKey3,
          manualJobDescription: jobDescription || null
        })
      });

      updateLoadingStep('Processing analysis...', 50);

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Analysis failed');
      }

      updateLoadingStep('Complete!', 100);

      console.log('Analysis data:', data);

      // Store data in chrome.storage for results page
      await chrome.storage.local.set({ analysisResults: data });

      // Open results in new tab
      chrome.tabs.create({
        url: chrome.runtime.getURL('results.html')
      });

      // Close popup after a moment
      setTimeout(() => window.close(), 500);

    } catch (error) {
      console.error('Analysis error:', error);
      showError(`Analysis failed: ${error.message}`);
    }
  }

  // Main optimization function
  async function optimizeResume(mode) {
    // Validate mode
    if (!mode) {
      showError('Invalid mode');
      return;
    }

    // Get job description based on mode
    let jobDescription = null;
    let jobUrl = null;

    if (mode === 'paste') {
      if (!jobDescriptionInput) {
        showError('Job description input not found');
        return;
      }

      jobDescription = jobDescriptionInput.value.trim();

      if (!jobDescription) {
        showError('Please paste a job description');
        return;
      }

      if (jobDescription.length < 100) {
        showError('Job description is too short. Please paste the complete description (at least 100 characters).');
        return;
      }
    } else if (mode === 'url') {
      jobUrl = await getCurrentTabUrl();

      if (!jobUrl) {
        showError('Could not get current page URL');
        return;
      }
    }

    // Show loading state
    showState('loading');
    updateLoadingStep('Preparing...', 0);

    // Check if this is analysis or optimization
    if (currentAction === 'analyze') {
      return await handleAnalyze(jobDescription, jobUrl);
    }

    // Continue with optimization...
    try {
      // Step 1: Get settings
      updateLoadingStep('Loading settings...', 10);

      const settings = await chrome.storage.local.get([
        'aiProvider', 'geminiKey1', 'geminiKey2', 'geminiKey3',
        'chatgptApiKey', 'chatgptKey2', 'chatgptKey3'
      ]);

      if (!settings.aiProvider) {
        throw new Error('AI provider not configured');
      }

      // Build request body
      const requestBody = {
        aiProvider: settings.aiProvider,
        geminiKey1: settings.geminiKey1 || null,
        geminiKey2: settings.geminiKey2 || null,
        geminiKey3: settings.geminiKey3 || null,
        chatgptApiKey: settings.chatgptApiKey || null,
        chatgptKey2: settings.chatgptKey2 || null,
        chatgptKey3: settings.chatgptKey3 || null,
      };

      if (mode === 'paste') {
        requestBody.manualJobDescription = jobDescription;
        requestBody.jobUrl = null;
        requestBody.currentPageUrl = null;
      } else {
        requestBody.manualJobDescription = null;
        requestBody.jobUrl = jobUrl;
        requestBody.currentPageUrl = jobUrl;
      }

      // Step 2: Send request
      updateLoadingStep('Extracting job description...', 25);

      const response = await fetch(`${BACKEND_URL}/api/optimize-resume`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(requestBody)
      });

      updateLoadingStep('Analyzing requirements...', 50);

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Optimization failed');
      }

      // Step 3: Show success
      updateLoadingStep('Creating optimized resume...', 75);

      // Wait a moment
      await new Promise(resolve => setTimeout(resolve, 1000));

      updateLoadingStep('Complete!', 100);

      // Show success state
      showSuccess(data);

    } catch (error) {
      console.error('Optimization error:', error);
      showError(error.message || 'An error occurred');
    }
  }

  // Show success state
  function showSuccess(data) {
    showState('success');

    // Update optimization count
    if (optimizationCount && data.optimizationPoints) {
      optimizationCount.textContent = `${data.optimizationPoints} optimization points applied`;
    }

    // Update company and position
    if (data.company) {
      const companyEl = document.getElementById('companyName');
      if (companyEl) companyEl.textContent = data.company;
    }

    if (data.position) {
      const positionEl = document.getElementById('positionName');
      if (positionEl) positionEl.textContent = data.position;
    }

    // Update file name
    if (data.fileName) {
      const fileNameEl = document.getElementById('fileName');
      if (fileNameEl) fileNameEl.textContent = `📄 ${data.fileName}`;
    }

    // Update links
    if (data.links) {
      if (viewLink && data.links.editInGoogleDocs) {
        viewLink.href = data.links.editInGoogleDocs;
      }

      if (pdfLink && data.links.downloadPDF) {
        pdfLink.href = data.links.downloadPDF;
      }

      // Optional: tracking sheet
      const trackingLink = document.getElementById('trackingSheetLink');
      if (trackingLink && data.links.trackingSheet) {
        trackingLink.href = data.links.trackingSheet;
        trackingLink.style.display = 'block';
      }
    }
  }

  // Show error state
  function showError(message) {
    showState('error');

    if (errorMessage) {
      errorMessage.textContent = message || 'An unknown error occurred';
    }
  }

});

// END OF FILE