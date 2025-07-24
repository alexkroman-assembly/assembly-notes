// Global variables
let microphoneStream = null;
let systemAudioStream = null;
let microphoneProcessor = null;
let systemAudioProcessor = null;
let microphoneAudioContext = null;
let systemAudioContext = null;
let isRecording = false;
let micConnected = false;
let systemConnected = false;

// DOM elements
const transcriptionResults = document.getElementById('transcriptionResults');
const audioStatus = document.getElementById('audioStatus');
const toggleBtn = document.getElementById('toggleBtn');

// Update status display
function updateAudioStatus() {
  if (micConnected && systemConnected) {
    audioStatus.textContent = 'Audio: Connected';
    audioStatus.className = 'status connected';
  } else {
    audioStatus.textContent = 'Audio: Disconnected';
    audioStatus.className = 'status disconnected';
  }
}

// Handle transcript updates
window.electronAPI.onTranscript((data) => {
  const { stream, text, partial } = data;

  if (!text) return;

  const timestamp = new Date().toLocaleTimeString();
  const source = stream === 'microphone' ? '[Mic]' : '[System]';
  const prefix = partial ? '>> ' : `[${timestamp}] ${source} `;

  if (partial) {
    // Update or create partial transcript element for this stream
    let partialElement = transcriptionResults.querySelector(
      `.partial-${stream}`
    );
    if (!partialElement) {
      partialElement = document.createElement('div');
      partialElement.className = `partial partial-${stream}`;
      transcriptionResults.appendChild(partialElement);
    }
    partialElement.textContent = prefix + text;
  } else {
    // Remove partial element for this stream if exists
    const partialElement = transcriptionResults.querySelector(
      `.partial-${stream}`
    );
    if (partialElement) {
      partialElement.remove();
    }

    // Add final transcript
    const transcriptElement = document.createElement('div');
    transcriptElement.textContent = prefix + text;
    transcriptionResults.appendChild(transcriptElement);
  }

  transcriptionResults.scrollTop = transcriptionResults.scrollHeight;
});

// Handle connection status updates
window.electronAPI.onConnectionStatus((data) => {
  const { stream, connected } = data;
  if (stream === 'microphone') {
    micConnected = connected;
  } else if (stream === 'system') {
    systemConnected = connected;
  }
  updateAudioStatus();
});

// Handle errors
window.electronAPI.onError((message) => {
  console.error('Error:', message);
  alert('Error: ' + message);
  stop();
});

// Handle audio capture events
window.electronAPI.onStartAudioCapture(() => {
  startAudioProcessing();
});

window.electronAPI.onStopAudioCapture(() => {
  stopAudioProcessing();
});

// Audio processing functions
async function startAudioProcessing() {
  // Process microphone audio
  microphoneAudioContext = new AudioContext({ sampleRate: 16000 });
  const micSource =
    microphoneAudioContext.createMediaStreamSource(microphoneStream);
  microphoneProcessor = microphoneAudioContext.createScriptProcessor(
    4096,
    1,
    1
  );

  microphoneProcessor.onaudioprocess = (event) => {
    if (!isRecording) return;

    const inputData = event.inputBuffer.getChannelData(0);
    const int16Buffer = new Int16Array(inputData.length);

    for (let i = 0; i < inputData.length; i++) {
      const sample = Math.max(-1, Math.min(1, inputData[i]));
      int16Buffer[i] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
    }

    window.electronAPI.sendMicrophoneAudio(
      Array.from(new Uint8Array(int16Buffer.buffer))
    );
  };

  micSource.connect(microphoneProcessor);
  microphoneProcessor.connect(microphoneAudioContext.destination);

  // Process system audio
  systemAudioContext = new AudioContext({ sampleRate: 16000 });
  const systemSource =
    systemAudioContext.createMediaStreamSource(systemAudioStream);
  systemAudioProcessor = systemAudioContext.createScriptProcessor(4096, 1, 1);

  systemAudioProcessor.onaudioprocess = (event) => {
    if (!isRecording) return;

    const inputData = event.inputBuffer.getChannelData(0);
    const int16Buffer = new Int16Array(inputData.length);

    for (let i = 0; i < inputData.length; i++) {
      const sample = Math.max(-1, Math.min(1, inputData[i]));
      int16Buffer[i] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
    }

    window.electronAPI.sendSystemAudio(
      Array.from(new Uint8Array(int16Buffer.buffer))
    );
  };

  systemSource.connect(systemAudioProcessor);
  systemAudioProcessor.connect(systemAudioContext.destination);
}

function stopAudioProcessing() {
  if (microphoneProcessor) {
    microphoneProcessor.disconnect();
    microphoneProcessor = null;
  }

  if (systemAudioProcessor) {
    systemAudioProcessor.disconnect();
    systemAudioProcessor = null;
  }

  if (microphoneAudioContext) {
    microphoneAudioContext.close();
    microphoneAudioContext = null;
  }

  if (systemAudioContext) {
    systemAudioContext.close();
    systemAudioContext = null;
  }
}

// Start transcription
async function start() {
  try {
    toggleBtn.disabled = true;
    toggleBtn.textContent = 'Starting...';

    // Clear previous transcripts
    transcriptionResults.innerHTML = '';

    const constraints = {
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
      video: false,
    };

    microphoneStream = await navigator.mediaDevices.getUserMedia(constraints);

    await window.electronAPI.enableLoopbackAudio();

    // Get display media (system audio)
    const displayStream = await navigator.mediaDevices.getDisplayMedia({
      audio: true,
      video: true,
    });

    await window.electronAPI.disableLoopbackAudio();

    // Remove video tracks, keep only audio
    const videoTracks = displayStream
      .getTracks()
      .filter((t) => t.kind === 'video');
    videoTracks.forEach((t) => {
      t.stop();
      displayStream.removeTrack(t);
    });

    systemAudioStream = displayStream;

    // Start recording with AssemblyAI
    isRecording = true;
    const success = await window.electronAPI.startRecording();

    if (success) {
      toggleBtn.disabled = false;
      toggleBtn.textContent = 'Stop Recording';
      toggleBtn.classList.remove('start');
      toggleBtn.classList.add('recording');
      isRecording = true;
      console.log('Transcription started for both streams');
    } else {
      throw new Error('Failed to start recording');
    }
  } catch (error) {
    console.error('Error starting transcription:', error);
    alert('Error starting transcription: ' + error.message);
    toggleBtn.disabled = false;
    toggleBtn.textContent = 'Start Recording';
    toggleBtn.classList.remove('recording');
    toggleBtn.classList.add('start');
    isRecording = false;
    stop();
  }
}

// Stop transcription
async function stop() {
  toggleBtn.disabled = true;
  toggleBtn.textContent = 'Stopping...';
  isRecording = false;

  // Stop recording
  await window.electronAPI.stopRecording();

  // Stop media streams
  if (microphoneStream) {
    microphoneStream.getTracks().forEach((track) => track.stop());
    microphoneStream = null;
  }

  if (systemAudioStream) {
    systemAudioStream.getTracks().forEach((track) => track.stop());
    systemAudioStream = null;
  }

  micConnected = false;
  systemConnected = false;
  updateAudioStatus();

  toggleBtn.disabled = false;
  toggleBtn.textContent = 'Start Recording';
  toggleBtn.classList.remove('recording');
  toggleBtn.classList.add('start');
}

// Toggle function
async function toggle() {
  if (isRecording) {
    await stop();
  } else {
    await start();
  }
}

// Event listeners
toggleBtn.addEventListener('click', toggle);


// Initialize
toggleBtn.textContent = 'Start Recording';
toggleBtn.classList.add('start');
