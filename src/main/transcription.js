import { AssemblyAI } from 'assemblyai';
import { getSettings } from './settings.js';
import { postToSlack } from './slack.js';

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
    console.error(`Error during summarization: ${err.message}`);
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

  console.log('✅ Recording stopped.');
  mainWindow.webContents.send('recording-stopped');

  processRecordingComplete().catch((error) => {
    console.error('❌ Post-processing failed:', error);
  });

  return true;
}

function sendMicrophoneAudio(audioData) {
  if (microphoneTranscriber) {
    try {
      const buffer = Buffer.from(audioData);
      microphoneTranscriber.sendAudio(buffer);
    } catch (error) {
      console.error('Error sending microphone audio:', error);
    }
  }
}

function sendSystemAudio(audioData) {
  if (systemAudioTranscriber) {
    try {
      const buffer = Buffer.from(audioData);
      systemAudioTranscriber.sendAudio(buffer);
    } catch (error) {
      console.error('Error sending system audio:', error);
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
