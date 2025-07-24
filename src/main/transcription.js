import { AssemblyAI } from 'assemblyai';
import _ from 'lodash';
import { getSettings } from './settings.js';
import { postToSlack } from './slack.js';

let transcribers = {};
let aai = null;

const transcripts = {
  microphone: '',
  system: '',
};

const DEFAULT_SUMMARY_PROMPT =
  'Please provide a concise summary of this transcription, highlighting key points, decisions made, and action items discussed.';

function createTranscriber(streamType, aai, mainWindow) {
  const transcriber = aai.realtime.transcriber({
    sampleRate: 16000,
  });

  transcriber.on('open', () => {
    console.log(`✅ ${_.capitalize(streamType)} transcriber connected`);
    mainWindow.webContents.send('connection-status', {
      stream: streamType,
      connected: true,
    });
  });

  transcriber.on('error', (error) => {
    console.error(`❌ ${_.capitalize(streamType)} transcription error:`, error);
    mainWindow.webContents.send(
      'error',
      `${_.capitalize(streamType)} error: ${error.message}`
    );
  });

  transcriber.on('close', () => {
    mainWindow.webContents.send('connection-status', {
      stream: streamType,
      connected: false,
    });
  });

  transcriber.on('transcript', (transcript) => {
    if (!transcript.text) return;

    if (transcript.message_type === 'FinalTranscript') {
      const line = `${transcript.text}\n`;
      transcripts[streamType] += line;
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

  return transcriber;
}

async function processRecordingComplete() {
  const fullTranscript = _.values(transcripts).join('');
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

    _.forEach(transcripts, (value, key) => {
      transcripts[key] = '';
    });

    const streamTypes = ['microphone', 'system'];
    transcribers = _.fromPairs(
      streamTypes.map((type) => [
        type,
        createTranscriber(type, aai, mainWindow),
      ])
    );

    await Promise.all(
      _.map(transcribers, (transcriber) => transcriber.connect())
    );

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

  await Promise.all(
    _.map(transcribers, async (transcriber) => {
      if (transcriber) {
        await transcriber.close();
      }
    })
  );

  transcribers = {};

  console.log('✅ Recording stopped.');
  mainWindow.webContents.send('recording-stopped');

  processRecordingComplete().catch((error) => {
    console.error('❌ Post-processing failed:', error);
  });

  return true;
}

function sendMicrophoneAudio(audioData) {
  const transcriber = transcribers.microphone;
  if (transcriber) {
    try {
      const buffer = Buffer.from(audioData);
      transcriber.sendAudio(buffer);
    } catch (error) {
      console.error('Error sending microphone audio:', error);
    }
  }
}

function sendSystemAudio(audioData) {
  const transcriber = transcribers.system;
  if (transcriber) {
    try {
      const buffer = Buffer.from(audioData);
      transcriber.sendAudio(buffer);
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
