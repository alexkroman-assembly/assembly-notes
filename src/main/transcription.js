import { AssemblyAI } from 'assemblyai';
import { getSettings } from './settings.js';
import { postToSlack } from './slack.js';
import log from './logger.js';

let microphoneTranscriber = null;
let systemAudioTranscriber = null;
let aai = null;

let microphoneTranscript = '';
let systemAudioTranscript = '';

const DEFAULT_SUMMARY_PROMPT =
  'Please provide a concise summary of this transcription, highlighting key points, decisions made, and action items discussed.';

async function processRecordingComplete() {
  const fullTranscript = microphoneTranscript + systemAudioTranscript;
  if (!fullTranscript.trim()) {
    return false;
  }

  const now = new Date();
  const title = `Meeting Summary - ${now.toLocaleString()}`;

  try {
    const settings = getSettings();
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
    log.error(`Error during summarization: ${err.message}`);
    return false;
  }
}

async function startTranscription(mainWindow) {
  const settings = getSettings();
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

    microphoneTranscript = '';
    systemAudioTranscript = '';

    microphoneTranscriber = aai.realtime.transcriber({
      sampleRate: 16000,
    });

    microphoneTranscriber.on('open', () => {
      mainWindow.webContents.send('connection-status', {
        stream: 'microphone',
        connected: true,
      });
    });

    microphoneTranscriber.on('error', async (error) => {
      log.error('Microphone transcription error:', error);
      mainWindow.webContents.send(
        'error',
        `Microphone error: ${error.message}`
      );

      // Check if this is a session idle timeout error
      if (
        error.message &&
        error.message.includes('Session idle for too long')
      ) {
        log.info('Session idle timeout detected, stopping recording...');
        await stopTranscription(mainWindow);
      }
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

    systemAudioTranscriber = aai.realtime.transcriber({
      sampleRate: 16000,
    });

    systemAudioTranscriber.on('open', () => {
      mainWindow.webContents.send('connection-status', {
        stream: 'system',
        connected: true,
      });
    });

    systemAudioTranscriber.on('error', async (error) => {
      log.error('System audio transcription error:', error);
      mainWindow.webContents.send(
        'error',
        `System audio error: ${error.message}`
      );

      // Check if this is a session idle timeout error
      if (
        error.message &&
        error.message.includes('Session idle for too long')
      ) {
        log.info('Session idle timeout detected, stopping recording...');
        await stopTranscription(mainWindow);
      }
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

    await Promise.all([
      microphoneTranscriber.connect(),
      systemAudioTranscriber.connect(),
    ]);

    mainWindow.webContents.send('start-audio-capture');

    return true;
  } catch (error) {
    log.error('Failed to start transcription:', error);
    mainWindow.webContents.send('error', `Failed to start: ${error.message}`);
    return false;
  }
}

async function stopTranscription(mainWindow) {
  mainWindow.webContents.send('stop-audio-capture');

  if (microphoneTranscriber) {
    await microphoneTranscriber.close();
    microphoneTranscriber = null;
  }

  if (systemAudioTranscriber) {
    await systemAudioTranscriber.close();
    systemAudioTranscriber = null;
  }

  log.info('Recording stopped.');
  mainWindow.webContents.send('recording-stopped');

  processRecordingComplete().catch((error) => {
    log.error('Post-processing failed:', error);
  });

  return true;
}

function sendMicrophoneAudio(audioData) {
  if (microphoneTranscriber) {
    try {
      const buffer = Buffer.from(audioData);
      microphoneTranscriber.sendAudio(buffer);
    } catch (error) {
      log.error('Error sending microphone audio:', error);
    }
  }
}

function sendSystemAudio(audioData) {
  if (systemAudioTranscriber) {
    try {
      const buffer = Buffer.from(audioData);
      systemAudioTranscriber.sendAudio(buffer);
    } catch (error) {
      log.error('Error sending system audio:', error);
    }
  }
}

function resetAai() {
  aai = null;
}

export {
  startTranscription,
  stopTranscription,
  sendMicrophoneAudio,
  sendSystemAudio,
  resetAai,
};
