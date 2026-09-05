// =============================================
// Adaptive Ambience - Main Application
// =============================================

// State
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
  audioOutput: document.getElementById('audioOutput')
};

// Initialize
async function init() {
  try {
    // Check for Web Audio API support
    if (!window.AudioContext && !window.webkitAudioContext) {
      throw new Error('Web Audio API not supported in this browser.');
    }

    // Create AudioContext
    state.audioContext = new (window.AudioContext || window.webkitAudioContext)();

    // Load Worklets
    await loadWorklets();

    // Setup event listeners
    setupEventListeners();

    // Initialize visualizers
    Visualizer.init(elements.spectrum, elements.vuMeter, state);

    // Load presets
    PresetManager.loadPresets();

    updateStatus('Ready to start. Click "Start Microphone" to begin.');
  } catch (error) {
    ErrorHandler.showError(`Initialization failed: ${error.message}`);
  }
}

// Load AudioWorklet modules
async function loadWorklets() {
  try {
    await state.audioContext.audioWorklet.addModule('audio/masking-generator-worklet.js');
    // AnalyzerWorklet not needed - using main thread AnalyserNode
  } catch (error) {
    ErrorHandler.showError(`Failed to load AudioWorklet: ${error.message}`);
    throw error;
  }
}

// Setup event listeners
function setupEventListeners() {
  // Microphone controls
  elements.startMic.addEventListener('click', startMicrophone);
  elements.stopMic.addEventListener('click', stopMicrophone);

  // Volume control
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

  // IR Convolution toggle
  elements.enableIR.addEventListener('change', (e) => {
    state.enableIR = e.target.checked;
    elements.irFile.disabled = !state.enableIR;
    updateIRRouting();
  });

  // IR File upload
  elements.irFile.addEventListener('change', handleIRFileUpload);

  // Noise type selection
  elements.noiseType.addEventListener('change', (e) => {
    state.noiseType = e.target.value;
    if (state.maskingNode) {
      state.maskingNode.port.postMessage({
        ...state.maskingParams,
        noiseType: state.noiseType
      });
    }
  });

  // Preset controls
  document.getElementById('savePreset').addEventListener('click', () => {
    const name = document.getElementById('presetName').value.trim() || 'Unnamed Preset';
    PresetManager.savePreset(name, state);
    document.getElementById('presetName').value = '';
  });

  document.getElementById('loadPreset').addEventListener('change', (e) => {
    if (e.target.value) {
      PresetManager.loadPreset(e.target.value, state);
      updateUIFromState();
    }
  });

  document.getElementById('deletePreset').addEventListener('click', () => {
    const select = document.getElementById('loadPreset');
    if (select.value) {
      PresetManager.deletePreset(select.value);
      select.value = '';
    }
  });

  document.getElementById('exportPreset').addEventListener('click', () => {
    const select = document.getElementById('loadPreset');
    if (select.value) {
      PresetManager.exportPreset(select.value);
    } else {
      ErrorHandler.showError('Please select a preset to export.');
    }
  });

  document.getElementById('importPresetBtn').addEventListener('click', () => {
    document.getElementById('importPreset').click();
  });

  document.getElementById('importPreset').addEventListener('change', (e) => {
    if (e.target.files.length > 0) {
      PresetManager.importPreset(e.target.files[0], state);
      updateUIFromState();
    }
    e.target.value = '';
  });

  document.getElementById('closeToast').addEventListener('click', ErrorHandler.hideError);
}

// Start microphone
async function startMicrophone() {
  try {
    if (state.isRunning) return;

    // Request microphone access
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    state.mediaStream = stream;
    state.mediaStreamSource = state.audioContext.createMediaStreamSource(stream);

    // Create AnalyserNode for FFT
    state.analyserNode = state.audioContext.createAnalyser();
    state.analyserNode.fftSize = 2048;
    state.mediaStreamSource.connect(state.analyserNode);

    // Create MaskingGeneratorWorklet
    state.maskingNode = new AudioWorkletNode(
      state.audioContext,
      'masking-generator-worklet'
    );

    // Connect nodes
    state.mediaStreamSource.connect(state.maskingNode);
    state.maskingNode.connect(state.audioContext.destination);

    // Start FFT analysis loop
    startFFTAnalysis();

    // Update state
    state.isRunning = true;
    elements.startMic.disabled = true;
    elements.stopMic.disabled = false;
    elements.irFile.disabled = !state.enableIR;

    // Send initial params to masking generator
    state.maskingNode.port.postMessage({
      bands: Array(32).fill(0).map((_, i) => ({ freq: i * 200, amp: 0 })),
      gain: state.volume,
      noiseType: state.noiseType
    });

    updateStatus('Microphone active. Adaptive masking enabled.');
  } catch (error) {
    ErrorHandler.showError(`Microphone error: ${error.message}`);
    // Fallback to synthetic noise
    startSyntheticNoise();
  }
}

// Fallback to synthetic noise if mic fails
function startSyntheticNoise() {
  try {
    if (state.isRunning) return;

    // Create a silent source (we'll generate noise in the worklet)
    const oscillator = state.audioContext.createOscillator();
    oscillator.type = 'sine';
    oscillator.frequency.value = 0; // Silent
    oscillator.start();

    // Create MaskingGeneratorWorklet
    state.maskingNode = new AudioWorkletNode(
      state.audioContext,
      'masking-generator-worklet'
    );

    // Connect
    oscillator.connect(state.maskingNode);
    state.maskingNode.connect(state.audioContext.destination);

    // Send params (no FFT data, just generate noise)
    state.maskingNode.port.postMessage({
      bands: [],
      gain: state.volume,
      noiseType: state.noiseType
    });

    // Update state
    state.isRunning = true;
    elements.startMic.disabled = true;
    elements.stopMic.disabled = false;
    updateStatus('Using synthetic noise (microphone unavailable).');
  } catch (error) {
    ErrorHandler.showError(`Failed to start synthetic noise: ${error.message}`);
  }
}

// Stop microphone
function stopMicrophone() {
  if (!state.isRunning) return;

  // Stop all nodes
  if (state.mediaStream) {
    state.mediaStream.getTracks().forEach(track => track.stop());
    state.mediaStream = null;
  }

  if (state.mediaStreamSource) {
    state.mediaStreamSource.disconnect();
    state.mediaStreamSource = null;
  }

  if (state.analyserNode) {
    state.analyserNode.disconnect();
    state.analyserNode = null;
  }

  if (state.maskingNode) {
    state.maskingNode.disconnect();
    state.maskingNode = null;
  }

  if (state.convolverNode) {
    state.convolverNode.disconnect();
    state.convolverNode = null;
  }

  // Reset state
  state.isRunning = false;
  state.fftData = new Uint8Array(0);
  elements.startMic.disabled = false;
  elements.stopMic.disabled = true;
  updateStatus('Stopped. Ready to start again.');
}

// Start FFT analysis loop
function startFFTAnalysis() {
  const bufferLength = state.analyserNode.frequencyBinCount;
  const dataArray = new Uint8Array(bufferLength);

  function update() {
    if (!state.isRunning || !state.analyserNode) {
      cancelAnimationFrame(update);
      return;
    }

    state.analyserNode.getByteFrequencyData(dataArray);
    state.fftData = dataArray;

    // Downsample FFT data for masking params
    const bands = [];
    const bandCount = 32;
    const binSize = Math.floor(bufferLength / bandCount);

    for (let i = 0; i < bandCount; i++) {
      const start = i * binSize;
      const end = start + binSize;
      const avg = dataArray.slice(start, end).reduce((a, b) => a + b, 0) / binSize;
      bands.push({
        freq: (i * state.audioContext.sampleRate) / state.analyserNode.fftSize,
        amp: avg / 255
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

// Handle IR file upload
async function handleIRFileUpload(e) {
  const file = e.target.files[0];
  if (!file) return;

  try {
    const arrayBuffer = await file.arrayBuffer();
    state.irBuffer = await state.audioContext.decodeAudioData(arrayBuffer);
    elements.irStatus.textContent = `IR loaded: ${file.name}`;
    updateIRRouting();
  } catch (error) {
    ErrorHandler.showError(`Failed to load IR file: ${error.message}`);
    elements.irStatus.textContent = 'IR load failed';
  }
}

// Update IR routing
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
    updateStatus(state.enableIR ? 'IR convolution disabled (no IR loaded).' : 'IR convolution disabled.');
  }
}

// Update UI from state
function updateUIFromState() {
  elements.volume.value = state.volume;
  elements.volumeValue.textContent = `${Math.round(state.volume * 100)}%`;
  elements.enableIR.checked = state.enableIR;
  elements.noiseType.value = state.noiseType;
  elements.irFile.disabled = !state.enableIR;

  if (state.enableIR && !state.irBuffer) {
    elements.irStatus.textContent = 'No IR loaded';
  }
}

// Update status message
function updateStatus(message) {
  elements.statusMessage.textContent = message;
}

// Initialize the app
init();
