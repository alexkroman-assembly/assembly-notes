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

function setupIpcHandlers(mainWindow) {
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
