import { app, BrowserWindow } from 'electron';
import { initMain as initAudioLoopback } from 'electron-audio-loopback';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { loadSettings } from './settings.js';
import { setupIpcHandlers } from './ipc-handlers.js';
import log from './logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

initAudioLoopback();

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 500,
    height: 500,
    minWidth: 400,
    minHeight: 600,
    title: 'Assembly Notes',
    webPreferences: {
      preload: path.join(__dirname, '../preload/preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
    },
  });

  mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));

  setupIpcHandlers(mainWindow);
}

app.whenReady().then(() => {
  log.info('App is ready, initializing...');
  loadSettings();
  createWindow();

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) {
      log.info('Reactivating app, creating new window');
      createWindow();
    }
  });
});

app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') {
    log.info('All windows closed, quitting app');
    app.quit();
  }
});
