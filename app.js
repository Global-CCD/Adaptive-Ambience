// =============================================
// Adaptive Ambience - Main Application
// Implements ANC Inverse + IR Convolution
// =============================================

// State Management
const state = {
  audioContext: null,
  mediaStream: null,
  mediaStreamSource: null,
  analyserNode: null,
  maskingNode: null,
  convolverNode: null,
  irBuffer: null,
  isRunning: false,
  volume: 0.3,
  noiseType: 'pink',
  enableIR: false,
  fftData: new Uint8Array(0),
  maskingParams: {
    bands: [],
    gain: 0.3,
    noiseType: 'pink'
  }
};

// DOM Elements
const elements = {
  startMic: document.getElementById('startMic'),
  stopMic: document.getElementById('stopMic'),
  volume: document.getElementById('volume'),
  volumeValue: document.getElementById('volumeValue'),
  enableIR: document.getElementById('enableIR'),
  irFile: document.getElementById('irFile'),
  irStatus: document.getElementById('irStatus'),
  noiseType: document.getElementById('noiseType'),
  spectrum: document.getElementById('spectrum'),
  vuMeter: document.getElementById('vuMeter'),
  statusMessage: document.getElementById('statusMessage'),
  audioOutput: document.getElementById('audioOutput'),
  loadPreset: document.getElementById('loadPreset')
};

// =============================================
// INITIALIZATION
// =============================================
async function init() {
  try {
    // Check Web Audio API support
    if (!window.AudioContext && !window.webkitAudioContext) {
      throw new Error('Web Audio API not supported.');
    }

    // Create AudioContext
    state.audioContext = new (window.AudioContext || window.webkitAudioContext)();

    // Load AudioWorklet
    await state.audioContext.audioWorklet.addModule('audio/masking-generator-worklet.js');

    // Setup UI
    setupEventListeners();
    Visualizer.init(elements.spectrum, elements.vuMeter, state);

    // Load presets
    PresetManager.loadPresets();

    updateStatus('Ready. Click "Start Microphone" to begin.');
  } catch (error) {
    ErrorHandler.showError(`Init failed: ${error.message}`);
  }
}

// =============================================
// EVENT LISTENERS
// =============================================
function setupEventListeners() {
  // Microphone Controls
  elements.startMic.addEventListener('click', startMicrophone);
  elements.stopMic.addEventListener('click', stopMicrophone);

  // Volume
  elements.volume.addEventListener('input', (e) => {
    state.volume = parseFloat(e.target.value);
    elements.volumeValue.textContent = `${Math.round(state.volume * 100)}%`;
    if (state.maskingNode) {
      state.maskingNode.port.postMessage({
        ...state.maskingParams,
        gain: state.volume
      });
    }
  });

  // IR Convolution Toggle
  elements.enableIR.addEventListener('change', (e) => {
    state.enableIR = e.target.checked;
    elements.irFile.disabled = !state.enableIR;
    updateIRRouting();
  });

  // IR File Upload
  elements.irFile.addEventListener('change', handleIRFileUpload);
  document.querySelector('label[for="irFile"]').addEventListener('click', () => elements.irFile.click());

  // Noise Type
  elements.noiseType.addEventListener('change', (e) => {
    state.noiseType = e.target.value;
    if (state.maskingNode) {
      state.maskingNode.port.postMessage({
        ...state.maskingParams,
        noiseType: state.noiseType
      });
    }
  });

  // Presets
  document.getElementById('savePreset').addEventListener('click', () => {
    const name = document.getElementById('presetName').value.trim() || `Preset_${Date.now()}`;
    PresetManager.savePreset(name, state);
    document.getElementById('presetName').value = '';
  });

  elements.loadPreset.addEventListener('change', (e) => {
    if (e.target.value) PresetManager.loadPreset(e.target.value, state);
  });

  document.getElementById('deletePreset').addEventListener('click', () => {
    if (elements.loadPreset.value) {
      PresetManager.deletePreset(elements.loadPreset.value);
      elements.loadPreset.value = '';
    }
  });

  document.getElementById('exportPreset').addEventListener('click', () => {
    if (elements.loadPreset.value) PresetManager.exportPreset(elements.loadPreset.value);
  });

  document.getElementById('importPresetBtn').addEventListener('click', () => {
    document.getElementById('importPreset').click();
  });

  document.getElementById('importPreset').addEventListener('change', (e) => {
    if (e.target.files[0]) PresetManager.importPreset(e.target.files[0], state);
    e.target.value = '';
  });

  document.getElementById('closeToast').addEventListener('click', ErrorHandler.hideError);
}

// =============================================
// MICROPHONE HANDLING
// =============================================
async function startMicrophone() {
  if (state.isRunning) return;

  try {
    // Request mic access
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false
      }
    });

    state.mediaStream = stream;
    state.mediaStreamSource = state.audioContext.createMediaStreamSource(stream);

    // Setup AnalyserNode for FFT
    state.analyserNode = state.audioContext.createAnalyser();
    state.analyserNode.fftSize = 2048;
    state.mediaStreamSource.connect(state.analyserNode);

    // Setup MaskingGeneratorWorklet
    state.maskingNode = new AudioWorkletNode(
      state.audioContext,
      'masking-generator-worklet'
    );

    // Connect nodes
    state.mediaStreamSource.connect(state.maskingNode);
    state.maskingNode.connect(state.audioContext.destination);

    // Start FFT analysis
    startFFTAnalysis();

    // Update state
    state.isRunning = true;
    elements.startMic.disabled = true;
    elements.stopMic.disabled = false;
    elements.irFile.disabled = !state.enableIR;

    // Send initial params
    state.maskingNode.port.postMessage({
      bands: Array(32).fill(0).map((_, i) => ({ freq: i * 200, amp: 0 })),
      gain: state.volume,
      noiseType: state.noiseType
    });

    updateStatus('Microphone active. Adaptive masking enabled.');
    Visualizer.startVUMeter();
  } catch (error) {
    ErrorHandler.showError(`Mic error: ${error.message}`);
    startSyntheticNoise(); // Fallback
  }
}

function startSyntheticNoise() {
  if (state.isRunning) return;

  try {
    // Create silent oscillator (we generate noise in Worklet)
    const oscillator = state.audioContext.createOscillator();
    oscillator.type = 'sine';
    oscillator.frequency.value = 0;
    oscillator.start();

    // Setup MaskingGeneratorWorklet
    state.maskingNode = new AudioWorkletNode(
      state.audioContext,
      'masking-generator-worklet'
    );

    // Connect
    oscillator.connect(state.maskingNode);
    state.maskingNode.connect(state.audioContext.destination);

    // Send params (no FFT data)
    state.maskingNode.port.postMessage({
      bands: [],
      gain: state.volume,
      noiseType: state.noiseType
    });

    state.isRunning = true;
    elements.startMic.disabled = true;
    elements.stopMic.disabled = false;
    updateStatus('Using synthetic noise (mic unavailable).');
    Visualizer.startVUMeter();
  } catch (error) {
    ErrorHandler.showError(`Synthetic noise failed: ${error.message}`);
  }
}

function stopMicrophone() {
  if (!state.isRunning) return;

  // Stop all audio nodes
  if (state.mediaStream) {
    state.mediaStream.getTracks().forEach(track => track.stop());
    state.mediaStream = null;
  }

  [state.mediaStreamSource, state.analyserNode, state.maskingNode, state.convolverNode]
    .forEach(node => node && node.disconnect());

  state.mediaStreamSource = null;
  state.analyserNode = null;
  state.maskingNode = null;
  state.convolverNode = null;

  state.isRunning = false;
  state.fftData = new Uint8Array(0);
  elements.startMic.disabled = false;
  elements.stopMic.disabled = true;
  updateStatus('Stopped. Ready to restart.');
  Visualizer.stopVUMeter();
}

// =============================================
// FFT ANALYSIS
// =============================================
function startFFTAnalysis() {
  const bufferLength = state.analyserNode.frequencyBinCount;
  const dataArray = new Uint8Array(bufferLength);

  function update() {
    if (!state.isRunning || !state.analyserNode) {
      return;
    }

    state.analyserNode.getByteFrequencyData(dataArray);
    state.fftData = dataArray;

    // Downsample FFT data into 32 bands
    const bands = [];
    const bandCount = 32;
    const binSize = Math.floor(bufferLength / bandCount);

    for (let i = 0; i < bandCount; i++) {
      const start = i * binSize;
      const end = Math.min(start + binSize, bufferLength);
      const slice = dataArray.slice(start, end);
      const avg = slice.reduce((a, b) => a + b, 0) / slice.length;
      bands.push({
        freq: (i * state.audioContext.sampleRate) / state.analyserNode.fftSize,
        amp: avg / 255 // Normalize to [0, 1]
      });
    }

    // Update masking params
    state.maskingParams = { bands, gain: state.volume, noiseType: state.noiseType };
    if (state.maskingNode) {
      state.maskingNode.port.postMessage(state.maskingParams);
    }

    // Update visualizer
    Visualizer.updateSpectrum(dataArray);
    requestAnimationFrame(update);
  }

  update();
}

// =============================================
// IR CONVOLUTION
// =============================================
async function handleIRFileUpload(e) {
  const file = e.target.files[0];
  if (!file) return;

  try {
    const arrayBuffer = await file.arrayBuffer();
    state.irBuffer = await state.audioContext.decodeAudioData(arrayBuffer);
    elements.irStatus.textContent = `IR: ${file.name}`;
    updateIRRouting();
  } catch (error) {
    ErrorHandler.showError(`IR load failed: ${error.message}`);
    elements.irStatus.textContent = 'IR load failed';
  }
}

function updateIRRouting() {
  if (!state.isRunning || !state.maskingNode) return;

  // Disconnect existing
  state.maskingNode.disconnect();
  if (state.convolverNode) {
    state.convolverNode.disconnect();
    state.convolverNode = null;
  }

  if (state.enableIR && state.irBuffer) {
    state.convolverNode = state.audioContext.createConvolver();
    state.convolverNode.buffer = state.irBuffer;
    state.maskingNode.connect(state.convolverNode);
    state.convolverNode.connect(state.audioContext.destination);
    updateStatus('IR convolution enabled.');
  } else {
    state.maskingNode.connect(state.audioContext.destination);
    updateStatus(state.enableIR ? 'IR disabled (no file).' : 'IR convolution disabled.');
  }
}

// =============================================
// UTILITIES
// =============================================
function updateStatus(message) {
  elements.statusMessage.textContent = message;
}

function updateUIFromState() {
  elements.volume.value = state.volume;
  elements.volumeValue.textContent = `${Math.round(state.volume * 100)}%`;
  elements.enableIR.checked = state.enableIR;
  elements.noiseType.value = state.noiseType;
  elements.irFile.disabled = !state.enableIR;
}

// =============================================
// INITIALIZE APP
// =============================================
init();
