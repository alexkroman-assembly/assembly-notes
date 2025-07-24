import { app, BrowserWindow, ipcMain } from 'electron';
import { initMain as initAudioLoopback } from 'electron-audio-loopback';
import path from 'node:path';
import dotenv from 'dotenv';
import { AssemblyAI } from 'assemblyai';
import { WebClient } from '@slack/web-api';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config();
initAudioLoopback();

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
    width: 400,
    height: 250,
    minWidth: 400,
    maxWidth: 800,
    maxHeight: 800,
    minHeight: 300,
    title: 'Assembly Notes',
    webPreferences: {
      preload: path.join(__dirname, '../preload/preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: false,
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
  const slackToken = process.env.SLACK_BOT_TOKEN;
  const slackChannel = process.env.SLACK_CHANNEL;

  if (!slackToken || !slackChannel) {
    return;
  }

  if (!slackClient) {
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
    const lemur = aai.lemur;
    const result = await lemur.task({
      prompt: DEFAULT_SUMMARY_PROMPT,
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
  const assemblyAiApiKey = process.env.ASSEMBLYAI_API_KEY;
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
        const line = `[Microphone] ${transcript.text}\n`;
        microphoneTranscript += line;
        mainWindow.webContents.send('transcript', {
          stream: 'microphone',
          text: transcript.text,
          partial: false,
        });
      } else {
        mainWindow.webContents.send('transcript', {
          stream: 'microphone',
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
        const line = `[System Audio] ${transcript.text}\n`;
        systemAudioTranscript += line;
        mainWindow.webContents.send('transcript', {
          stream: 'system',
          text: transcript.text,
          partial: false,
        });
      } else {
        mainWindow.webContents.send('transcript', {
          stream: 'system',
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

// Note: enable-loopback-audio and disable-loopback-audio handlers are already registered by electron-audio-loopback
