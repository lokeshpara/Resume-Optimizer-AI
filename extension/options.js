// Provider information
const providerInfo = {
    gemini: {
      name: 'Google Gemini AI',
      description: 'Google\'s latest AI model - using 3 separate API keys for better rate limiting',
      pricing: 'Free tier: 60 requests/minute per key',
      getApiLink: 'https://makersuite.google.com/app/apikey',
      steps: [
        'Go to Google AI Studio (link above)',
        'Click "Get API Key" or "Create API Key"',
        'Create 3 different API keys (or use same key 3 times)',
        'Copy each key into the respective field below'
      ]
    },
    chatgpt: {
      name: 'OpenAI ChatGPT (GPT-4)',
      description: 'OpenAI\'s GPT-4 model - single API key for all steps',
      pricing: 'Pay-as-you-go: ~$0.03-0.05 per optimization',
      getApiLink: 'https://platform.openai.com/api-keys',
      steps: [
        'Go to OpenAI Platform (link above)',
        'Sign up or log in to your account',
        'Navigate to API Keys section',
        'Click "Create new secret key"',
        'Copy your API key'
      ]
    }
  };
  
  // DOM elements
  const form = document.getElementById('settingsForm');
  const aiProviderSelect = document.getElementById('aiProvider');
  const providerInfoDiv = document.getElementById('providerInfo');
  const geminiKeysSection = document.getElementById('geminiKeys');
  const chatgptKeySection = document.getElementById('chatgptKey');
  const statusMessage = document.getElementById('statusMessage');
  
  // Gemini key inputs
  const geminiKey1 = document.getElementById('geminiKey1');
  const geminiKey2 = document.getElementById('geminiKey2');
  const geminiKey3 = document.getElementById('geminiKey3');
  
  // ChatGPT key input
  const chatgptApiKey = document.getElementById('chatgptApiKey');
  
  // Load saved settings on page load
  loadSettings();
  
  // Event listeners
  aiProviderSelect.addEventListener('change', handleProviderChange);
  form.addEventListener('submit', saveSettings);
  
  // Load saved settings
  function loadSettings() {
    chrome.storage.local.get([
      'aiProvider', 
      'geminiKey1', 
      'geminiKey2', 
      'geminiKey3', 
      'chatgptApiKey'
    ], (result) => {
      if (result.aiProvider) {
        aiProviderSelect.value = result.aiProvider;
        handleProviderChange();
        
        if (result.aiProvider === 'gemini') {
          if (result.geminiKey1) geminiKey1.value = result.geminiKey1;
          if (result.geminiKey2) geminiKey2.value = result.geminiKey2;
          if (result.geminiKey3) geminiKey3.value = result.geminiKey3;
        } else if (result.aiProvider === 'chatgpt') {
          if (result.chatgptApiKey) chatgptApiKey.value = result.chatgptApiKey;
        }
      }
    });
  }
  
  // Handle provider selection change
  function handleProviderChange() {
    const provider = aiProviderSelect.value;
    
    // Hide all sections first
    geminiKeysSection.style.display = 'none';
    chatgptKeySection.style.display = 'none';
    providerInfoDiv.innerHTML = '';
    
    if (!provider) return;
    
    // Show provider info
    const info = providerInfo[provider];
    providerInfoDiv.innerHTML = `
      <div class="provider-info">
        <h4>${info.name}</h4>
        <p><strong>Description:</strong> ${info.description}</p>
        <p><strong>Pricing:</strong> ${info.pricing}</p>
        <p><strong>Get API Key:</strong> <a href="${info.getApiLink}" target="_blank">Click here →</a></p>
        <p><strong>Setup Steps:</strong></p>
        <ol style="margin-left: 20px; margin-top: 8px;">
          ${info.steps.map(step => `<li style="margin: 6px 0; color: #555;">${step}</li>`).join('')}
        </ol>
      </div>
    `;
    
    // Show appropriate key input section
    if (provider === 'gemini') {
      geminiKeysSection.style.display = 'block';
    } else if (provider === 'chatgpt') {
      chatgptKeySection.style.display = 'block';
    }
  }
  
  // Save settings
  function saveSettings(e) {
    e.preventDefault();
    
    const provider = aiProviderSelect.value;
    
    if (!provider) {
      showStatus('❌ Please select an AI provider', 'error');
      return;
    }
    
    let settingsToSave = { aiProvider: provider };
    
    // Validate and collect keys based on provider
    if (provider === 'gemini') {
      const key1 = geminiKey1.value.trim();
      const key2 = geminiKey2.value.trim();
      const key3 = geminiKey3.value.trim();
      
      if (!key1 || !key2 || !key3) {
        showStatus('❌ Please enter all 3 Gemini API keys', 'error');
        return;
      }
      
      settingsToSave.geminiKey1 = key1;
      settingsToSave.geminiKey2 = key2;
      settingsToSave.geminiKey3 = key3;
      settingsToSave.chatgptApiKey = ''; // Clear ChatGPT key
      
    } else if (provider === 'chatgpt') {
      const key = chatgptApiKey.value.trim();
      
      if (!key) {
        showStatus('❌ Please enter your ChatGPT API key', 'error');
        return;
      }
      
      settingsToSave.chatgptApiKey = key;
      settingsToSave.geminiKey1 = ''; // Clear Gemini keys
      settingsToSave.geminiKey2 = '';
      settingsToSave.geminiKey3 = '';
    }
    
    // Save to Chrome storage
    chrome.storage.local.set(settingsToSave, () => {
      showStatus('✅ Settings saved successfully! You can now close this page.', 'success');
      
      // Scroll to top to see message
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  }
  
  // Show status message
  function showStatus(message, type) {
    statusMessage.textContent = message;
    statusMessage.className = `status-message ${type}`;
    statusMessage.style.display = 'block';
    
    // Auto-hide after 5 seconds for error, 8 seconds for success
    const duration = type === 'success' ? 8000 : 5000;
    setTimeout(() => {
      statusMessage.style.display = 'none';
    }, duration);
  }