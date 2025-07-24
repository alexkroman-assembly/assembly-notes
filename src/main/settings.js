import Store from 'electron-store';

const store = new Store({
  defaults: {
    assemblyaiKey: '',
    slackToken: '',
    slackChannel: '',
    customPrompt: '',
  },
  schema: {
    assemblyaiKey: {
      type: 'string',
      default: '',
    },
    slackToken: {
      type: 'string',
      default: '',
    },
    slackChannel: {
      type: 'string',
      default: '',
    },
    customPrompt: {
      type: 'string',
      default: '',
    },
  },
});

function loadSettings() {
  // No-op - electron-store handles loading automatically
}

function saveSettingsToFile(newSettings) {
  try {
    Object.keys(newSettings).forEach((key) => {
      store.set(key, newSettings[key]);
    });
  } catch (error) {
    console.error('Error saving settings:', error);
    throw error;
  }
}

function getSettings() {
  return store.store;
}

export { loadSettings, saveSettingsToFile, getSettings };
