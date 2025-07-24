import { app, BrowserWindow, ipcMain } from 'electron';
import { initMain as initAudioLoopback } from 'electron-audio-loopback';
import path from 'node:path';
import fs from 'node:fs';
import { AssemblyAI } from 'assemblyai';
import { WebClient } from '@slack/web-api';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

initAudioLoopback();

// Settings management
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

// Load settings on startup
loadSettings();

let mainWindow;
let microphoneTranscriber = null;
let systemAudioTranscriber = null;
let aai = null;
let slackClient = null;

// Transcription state
let microphoneTranscript = '';
let systemAudioTranscript = '';

// Default summary prompt for LeMUR
const DEFAULT_SUMMARY_PROMPT =
  'Please provide a concise summary of this transcription, highlighting key points, decisions made, and action items discussed.';

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
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') app.quit();
});

// --- Helper Functions ---

async function postToSlack(summary, title) {
  const slackToken = settings.slackToken;
  const slackChannel = settings.slackChannel;

  if (!slackToken || !slackChannel) {
    return;
  }

  if (!slackClient || slackClient.token !== slackToken) {
    slackClient = new WebClient(slackToken);
  }

  try {
    await slackClient.chat.postMessage({
      channel: slackChannel,
      text: `*${title}*\n\n${summary}`,
    });
  } catch (error) {
    console.error(`Error posting to Slack: ${error.message}`);
  }
}

async function processRecordingComplete() {
  // Combine both transcript sources
  const fullTranscript = microphoneTranscript + systemAudioTranscript;
  if (!fullTranscript.trim()) {
    return false;
  }

  // Generate title from current timestamp
  const now = new Date();
  const title = `Meeting Summary - ${now.toLocaleString()}`;

  try {
    // Get custom summary prompt from settings, fallback to default
    const summaryPrompt = settings.summaryPrompt || DEFAULT_SUMMARY_PROMPT;

    const lemur = aai.lemur;
    const result = await lemur.task({
      prompt: summaryPrompt,
      input_text: fullTranscript,
      final_model: 'anthropic/claude-sonnet-4-20250514',
    });
    const summary = result.response;

    await postToSlack(summary, title);
    return true;
  } catch (err) {
    console.error(`Error during summarization: ${err.message}`);
    return false;
  }
}

// --- IPC Handlers ---

// Handle microphone audio data
ipcMain.on('microphone-audio-data', (event, audioData) => {
  if (microphoneTranscriber) {
    try {
      const buffer = Buffer.from(audioData);
      microphoneTranscriber.sendAudio(buffer);
    } catch (error) {
      console.error('Error sending microphone audio:', error);
    }
  }
});

// Handle system audio data
ipcMain.on('system-audio-data', (event, audioData) => {
  if (systemAudioTranscriber) {
    try {
      const buffer = Buffer.from(audioData);
      systemAudioTranscriber.sendAudio(buffer);
    } catch (error) {
      console.error('Error sending system audio:', error);
    }
  }
});

// Start recording
ipcMain.handle('start-recording', async () => {
  const assemblyAiApiKey = settings.assemblyaiKey;
  if (!assemblyAiApiKey) {
    mainWindow.webContents.send(
      'error',
      'AssemblyAI API Key is not set. Please add it in settings.'
    );
    return false;
  }

  try {
    aai = new AssemblyAI({ apiKey: assemblyAiApiKey });

    // Reset transcripts
    microphoneTranscript = '';
    systemAudioTranscript = '';

    // No file creation needed - using in-memory transcripts

    // Create microphone transcriber
    microphoneTranscriber = aai.realtime.transcriber({
      sampleRate: 16000,
    });

    microphoneTranscriber.on('open', () => {
      console.log('✅ Microphone transcriber connected');
      mainWindow.webContents.send('connection-status', {
        stream: 'microphone',
        connected: true,
      });
    });

    microphoneTranscriber.on('error', (error) => {
      console.error('❌ Microphone transcription error:', error);
      mainWindow.webContents.send(
        'error',
        `Microphone error: ${error.message}`
      );
    });

    microphoneTranscriber.on('close', () => {
      mainWindow.webContents.send('connection-status', {
        stream: 'microphone',
        connected: false,
      });
    });

    microphoneTranscriber.on('transcript', (transcript) => {
      if (!transcript.text) return;

      if (transcript.message_type === 'FinalTranscript') {
        const line = `${transcript.text}\n`;
        microphoneTranscript += line;
        mainWindow.webContents.send('transcript', {
          text: transcript.text,
          partial: false,
        });
      } else {
        mainWindow.webContents.send('transcript', {
          text: transcript.text,
          partial: true,
        });
      }
    });

    // Create system audio transcriber
    systemAudioTranscriber = aai.realtime.transcriber({
      sampleRate: 16000,
    });

    systemAudioTranscriber.on('open', () => {
      console.log('✅ System audio transcriber connected');
      mainWindow.webContents.send('connection-status', {
        stream: 'system',
        connected: true,
      });
    });

    systemAudioTranscriber.on('error', (error) => {
      console.error('❌ System audio transcription error:', error);
      mainWindow.webContents.send(
        'error',
        `System audio error: ${error.message}`
      );
    });

    systemAudioTranscriber.on('close', () => {
      mainWindow.webContents.send('connection-status', {
        stream: 'system',
        connected: false,
      });
    });

    systemAudioTranscriber.on('transcript', (transcript) => {
      if (!transcript.text) return;

      if (transcript.message_type === 'FinalTranscript') {
        const line = `${transcript.text}\n`;
        systemAudioTranscript += line;
        mainWindow.webContents.send('transcript', {
          text: transcript.text,
          partial: false,
        });
      } else {
        mainWindow.webContents.send('transcript', {
          text: transcript.text,
          partial: true,
        });
      }
    });

    // Connect both transcribers
    await Promise.all([
      microphoneTranscriber.connect(),
      systemAudioTranscriber.connect(),
    ]);

    console.log('✅ Both transcribers connected successfully');
    mainWindow.webContents.send('start-audio-capture');

    return true;
  } catch (error) {
    console.error('❌ Failed to start transcription:', error);
    mainWindow.webContents.send('error', `Failed to start: ${error.message}`);
    return false;
  }
});

// Stop recording
ipcMain.handle('stop-recording', async () => {
  mainWindow.webContents.send('stop-audio-capture');

  if (microphoneTranscriber) {
    await microphoneTranscriber.close();
    microphoneTranscriber = null;
  }

  if (systemAudioTranscriber) {
    await systemAudioTranscriber.close();
    systemAudioTranscriber = null;
  }

  console.log('✅ Recording stopped.');
  mainWindow.webContents.send('recording-stopped');

  // Trigger post-processing (summary generation and Slack posting)
  processRecordingComplete().catch((error) => {
    console.error('❌ Post-processing failed:', error);
  });

  return true;
});

// Settings IPC handlers
ipcMain.handle('get-settings', () => {
  return settings;
});

ipcMain.handle('save-settings', (event, newSettings) => {
  saveSettingsToFile(newSettings);
  // Reset clients when settings change
  slackClient = null;
  aai = null;
  return true;
});

// Note: enable-loopback-audio and disable-loopback-audio handlers are already registered by electron-audio-loopback
