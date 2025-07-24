window.SettingsModal = (function () {
  const settingsModal = document.getElementById('settingsModal');
  const assemblyaiKeyInput = document.getElementById('assemblyaiKey');
  const slackTokenInput = document.getElementById('slackToken');
  const slackChannelInput = document.getElementById('slackChannel');
  const summaryPromptInput = document.getElementById('summaryPrompt');
  const closeBtn = document.getElementById('closeBtn');
  const saveBtn = document.getElementById('saveBtn');

  function showSettingsModal() {
    settingsModal.classList.add('active');
    loadSettings();
  }

  function hideSettingsModal() {
    settingsModal.classList.remove('active');
  }

  async function loadSettings() {
    try {
      const settings = await window.electronAPI.getSettings();
      assemblyaiKeyInput.value = settings.assemblyaiKey || '';
      slackTokenInput.value = settings.slackToken || '';
      slackChannelInput.value = settings.slackChannel || '';
      summaryPromptInput.value =
        settings.summaryPrompt ||
        'Please provide a concise summary of this transcription, highlighting key points, decisions made, and action items discussed.';
    } catch (error) {
      console.error('Error loading settings:', error);
    }
  }

  async function saveSettings() {
    try {
      const settings = {
        assemblyaiKey: assemblyaiKeyInput.value,
        slackToken: slackTokenInput.value,
        slackChannel: slackChannelInput.value,
        summaryPrompt: summaryPromptInput.value,
      };

      await window.electronAPI.saveSettings(settings);
      alert('Settings saved successfully!');
      hideSettingsModal();
    } catch (error) {
      console.error('Error saving settings:', error);
      alert('Error saving settings: ' + error.message);
    }
  }

  function setupSettingsModalEvents() {
    closeBtn.addEventListener('click', hideSettingsModal);
    saveBtn.addEventListener('click', saveSettings);

    settingsModal.addEventListener('click', (e) => {
      if (e.target === settingsModal) {
        hideSettingsModal();
      }
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && settingsModal.classList.contains('active')) {
        hideSettingsModal();
      }
    });
  }

  return {
    showSettingsModal,
    hideSettingsModal,
    setupSettingsModalEvents,
  };
})();
