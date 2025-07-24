import { app } from 'electron';
import path from 'node:path';
import fs from 'node:fs';

const settingsPath = path.join(app.getPath('userData'), 'settings.json');
let settings = {};

function loadSettings() {
  try {
    if (fs.existsSync(settingsPath)) {
      const data = fs.readFileSync(settingsPath, 'utf8');
      settings = JSON.parse(data);
    }
  } catch (error) {
    console.error('Error loading settings:', error);
    settings = {};
  }
}

function saveSettingsToFile(newSettings) {
  try {
    settings = { ...settings, ...newSettings };
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
  } catch (error) {
    console.error('Error saving settings:', error);
    throw error;
  }
}

function getSettings() {
  return settings;
}

export { loadSettings, saveSettingsToFile, getSettings };
