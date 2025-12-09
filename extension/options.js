// Provider information
const providerInfo = {
  gemini: {
    name: 'Google Gemini AI',
    description: 'Google\'s latest AI model - using 3 separate API keys for better rate limiting',
    pricing: 'Free tier: 60 requests/minute per key',
    getApiLink: 'https://makersuite.google.com/app/apikey',
    steps: [
      'Go to Google AI Studio',
      'Click "Get API Key" or "Create API Key"',
      'Create 3 different API keys (or use same key 3 times)',
      'Copy each key into the respective field below'
    ]
  },
  chatgpt: {
    name: 'OpenAI ChatGPT (GPT-4o)',
    description: 'OpenAI\'s GPT-4o model - use 1-3 API keys for load distribution',
    pricing: 'Pay-as-you-go: ~$0.07 per analysis',
    getApiLink: 'https://platform.openai.com/api-keys',
    steps: [
      'Go to OpenAI Platform',
      'Sign up or log in to your account',
      'Navigate to API Keys section',
      'Click "Create new secret key" (create 1-3 keys)',
      'Copy your API keys into the fields below'
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

// Toggle visibility function
function setupToggleIcons() {
  document.querySelectorAll('.toggle-icon').forEach(icon => {
    icon.addEventListener('click', function () {
      const targetId = this.getAttribute('data-target');
      const input = document.getElementById(targetId);
      if (input) {
        input.type = input.type === 'password' ? 'text' : 'password';
      }
    });
  });
}

// Load saved settings on page load
loadSettings();

// Event listeners
aiProviderSelect.addEventListener('change', handleProviderChange);
form.addEventListener('submit', saveSettings);

// Setup toggle icons after DOM loads
setupToggleIcons();

// Load saved settings
function loadSettings() {
  chrome.storage.local.get([
    'aiProvider',
    'geminiKey1',
    'geminiKey2',
    'geminiKey3',
    'chatgptApiKey',
    'chatgptKey2',
    'chatgptKey3'
  ], (result) => {
    if (result.aiProvider) {
      aiProviderSelect.value = result.aiProvider;
      handleProviderChange();

      if (result.aiProvider === 'gemini') {
        if (result.geminiKey1) document.getElementById('geminiKey1').value = result.geminiKey1;
        if (result.geminiKey2) document.getElementById('geminiKey2').value = result.geminiKey2;
        if (result.geminiKey3) document.getElementById('geminiKey3').value = result.geminiKey3;
      } else if (result.aiProvider === 'chatgpt') {
        if (result.chatgptApiKey) document.getElementById('chatgptApiKey').value = result.chatgptApiKey;
        if (result.chatgptKey2) document.getElementById('chatgptKey2').value = result.chatgptKey2;
        if (result.chatgptKey3) document.getElementById('chatgptKey3').value = result.chatgptKey3;
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
      <p><strong>Get API Key:</strong> <a href="${info.getApiLink}" target="_blank">Click here</a></p>
      <p><strong>Setup Steps:</strong></p>
      <ol>
        ${info.steps.map(step => `<li>${step}</li>`).join('')}
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
    showStatus('Please select an AI provider', 'error');
    return;
  }

  let settingsToSave = { aiProvider: provider };

  // Validate and collect keys based on provider
  if (provider === 'gemini') {
    const key1 = document.getElementById('geminiKey1').value.trim();
    const key2 = document.getElementById('geminiKey2').value.trim();
    const key3 = document.getElementById('geminiKey3').value.trim();

    if (!key1 || !key2 || !key3) {
      showStatus('Please enter all 3 Gemini API keys', 'error');
      return;
    }

    settingsToSave.geminiKey1 = key1;
    settingsToSave.geminiKey2 = key2;
    settingsToSave.geminiKey3 = key3;
    settingsToSave.chatgptApiKey = '';
    settingsToSave.chatgptKey2 = '';
    settingsToSave.chatgptKey3 = '';

  } else if (provider === 'chatgpt') {
    const key1 = document.getElementById('chatgptApiKey').value.trim();
    const key2 = document.getElementById('chatgptKey2').value.trim();
    const key3 = document.getElementById('chatgptKey3').value.trim();

    if (!key1) {
      showStatus('Please enter at least the primary ChatGPT API key', 'error');
      return;
    }

    settingsToSave.chatgptApiKey = key1;
    settingsToSave.chatgptKey2 = key2 || '';
    settingsToSave.chatgptKey3 = key3 || '';
    settingsToSave.geminiKey1 = '';
    settingsToSave.geminiKey2 = '';
    settingsToSave.geminiKey3 = '';
  }

  // Save to Chrome storage
  chrome.storage.local.set(settingsToSave, () => {
    const keyCount = provider === 'chatgpt'
      ? [settingsToSave.chatgptApiKey, settingsToSave.chatgptKey2, settingsToSave.chatgptKey3].filter(Boolean).length
      : 3;

    showStatus(`Settings saved successfully! Using ${keyCount} API key(s). You can now close this page.`, 'success');

    // Scroll to top to see message
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });
}

// Show status message
function showStatus(message, type) {
  statusMessage.textContent = message;
  statusMessage.className = `status-message ${type}`;
  statusMessage.style.display = 'block';

  // Auto-hide after duration
  const duration = type === 'success' ? 8000 : 5000;
  setTimeout(() => {
    statusMessage.style.display = 'none';
  }, duration);
}