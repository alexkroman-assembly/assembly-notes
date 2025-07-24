import { ipcMain } from 'electron';
import { getSettings, saveSettingsToFile } from './settings.js';
import { resetSlackClient } from './slack.js';
import {
  startTranscription,
  stopTranscription,
  sendMicrophoneAudio,
  sendSystemAudio,
  resetAai,
} from './transcription.js';
import log from './logger.js';

function setupIpcHandlers(mainWindow) {
  // Handle log messages from renderer
  ipcMain.on('log', (event, level, ...args) => {
    const message = args
      .map((arg) =>
        typeof arg === 'object' ? JSON.stringify(arg) : String(arg)
      )
      .join(' ');

    log[level](`[Renderer] ${message}`);
  });

  ipcMain.on('microphone-audio-data', (event, audioData) => {
    sendMicrophoneAudio(audioData);
  });

  ipcMain.on('system-audio-data', (event, audioData) => {
    sendSystemAudio(audioData);
  });

  ipcMain.handle('start-recording', async () => {
    return await startTranscription(mainWindow);
  });

  ipcMain.handle('stop-recording', async () => {
    return await stopTranscription(mainWindow);
  });

  ipcMain.handle('get-settings', () => {
    return getSettings();
  });

  ipcMain.handle('save-settings', (event, newSettings) => {
    saveSettingsToFile(newSettings);
    resetSlackClient();
    resetAai();
    return true;
  });
}

export { setupIpcHandlers };
