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
  outputAnalyser: null, // MI-010: For real VU meter
  isRunning: false,
  volume: 0.3,
  noiseType: 'pink',
  enableIR: false,
  fftData: new Uint8Array(0),
  maskingParams: {
    bands: [],
    gain: 0.3,
    noiseType: 'pink'
  },
  useFallbackWorklet: false // MA-001: Safari fallback flag
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
  loadPreset: document.getElementById('loadPreset'),
  loadingSpinner: document.getElementById('loadingSpinner'),
  micSpinner: document.getElementById('micSpinner'),
  unsupportedBrowser: document.getElementById('unsupportedBrowser')
};

// =============================================
// UTILITY FUNCTIONS
// =============================================

// Debounce function (MA-008)
function debounce(func, wait) {
  let timeout;
  return function(...args) {
    clearTimeout(timeout);
    timeout = setTimeout(() => func.apply(this, args), wait);
  };
}

// Show/hide loading spinner (MI-002, MI-008)
function showLoading() {
  elements.loadingSpinner.hidden = false;
}

function hideLoading() {
  elements.loadingSpinner.hidden = true;
}

function showMicSpinner() {
  elements.micSpinner.hidden = false;
}

function hideMicSpinner() {
  elements.micSpinner.hidden = true;
}

// =============================================
// INITIALIZATION
// =============================================
async function init() {
  try {
    showLoading();

    // MI-006: Check for Web Audio API support
    if (!window.AudioContext && !window.webkitAudioContext) {
      elements.unsupportedBrowser.hidden = false;
      elements.loadingSpinner.hidden = true;
      ErrorHandler.showError('Web Audio API not supported in this browser.');
      return;
    }

    // Create AudioContext
    state.audioContext = new (window.AudioContext || window.webkitAudioContext)();

    // MA-001: Check for AudioWorklet support (Safari fallback)
    state.useFallbackWorklet = !('audioWorklet' in window.AudioContext.prototype);
    if (state.useFallbackWorklet) {
      ErrorHandler.showError('AudioWorklet not supported. Using fallback mode (less accurate).');
    }

    // Load Worklets or fallback
    await loadWorklets();

    // Setup UI
    setupEventListeners();
    Visualizer.init(elements.spectrum, elements.vuMeter, state);

    // Load presets
    PresetManager.loadPresets();

    // MI-011: Handle AudioContext state changes
    state.audioContext.addEventListener('statechange', () => {
      if (state.audioContext.state === 'suspended' && state.isRunning) {
        state.audioContext.resume().catch(err => {
          ErrorHandler.showError(`Failed to resume audio: ${err.message}`);
        });
      }
    });

    // CR-002: Clean up on page unload
    window.addEventListener('beforeunload', cleanup);

    updateStatus('Ready. Click "Start Microphone" to begin.');
  } catch (error) {
    ErrorHandler.showError(`Init failed: ${error.message}`);
  } finally {
    hideLoading();
  }
}

// =============================================
// LOAD WORKLETS (OR FALLBACK)
// =============================================
async function loadWorklets() {
  try {
    if (!state.useFallbackWorklet) {
      await state.audioContext.audioWorklet.addModule('audio/masking-generator-worklet.js');
    } else {
      // MA-001: Load fallback worklet for Safari
      await state.audioContext.audioWorklet.addModule('audio/fallback-worklet.js');
    }
  } catch (error) {
    ErrorHandler.showError(`AudioWorklet failed: ${error.message}. Using basic noise.`);
    state.useFallbackWorklet = true;
  }
}

// =============================================
// CLEANUP
// =============================================
function cleanup() {
  try {
    // CR-002: Close AudioContext
    if (state.audioContext?.state !== 'closed') {
      state.audioContext?.close().catch(() => {});
    }

    // CR-002, MA-006: Disconnect all nodes
    [state.mediaStreamSource, state.analyserNode, state.maskingNode, state.convolverNode, state.outputAnalyser]
      .forEach(node => {
        if (node) {
          node.disconnect();
        }
      });

    // Stop media stream tracks
    if (state.mediaStream) {
      state.mediaStream.getTracks().forEach(track => track.stop());
      state.mediaStream = null;
    }

    // MA-007: Clean up animation frames
    Visualizer.stopVUMeter();
    Visualizer.stopSpectrum();
  } catch (error) {
    console.error('Cleanup error:', error);
  }
}

// =============================================
// EVENT LISTENERS
// =============================================
function setupEventListeners() {
  // Microphone Controls
  elements.startMic.addEventListener('click', startMicrophone);
  elements.stopMic.addEventListener('click', stopMicrophone);

  // MA-008: Debounced volume control
  elements.volume.addEventListener('input', debounce((e) => {
    state.volume = parseFloat(e.target.value);
    elements.volumeValue.textContent = `${Math.round(state.volume * 100)}%`;
    if (state.maskingNode) {
      state.maskingNode.port.postMessage({
        ...state.maskingParams,
        gain: state.volume
      });
    }
  }, 50)); // 50ms debounce

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
    showMicSpinner(); // MI-008

    // CR-003: Resume AudioContext if suspended
    if (state.audioContext.state === 'suspended') {
      await state.audioContext.resume();
    }

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

    // Setup AnalyserNode for FFT (input)
    state.analyserNode = state.audioContext.createAnalyser();
    state.analyserNode.fftSize = 2048;
    state.mediaStreamSource.connect(state.analyserNode);

    // MI-010: Setup AnalyserNode for output (real VU meter)
    state.outputAnalyser = state.audioContext.createAnalyser();
    state.outputAnalyser.fftSize = 256;

    // Create MaskingGeneratorWorklet
    state.maskingNode = new AudioWorkletNode(
      state.audioContext,
      state.useFallbackWorklet ? 'fallback-worklet' : 'masking-generator-worklet'
    );

    // Connect nodes
    state.mediaStreamSource.connect(state.maskingNode);
    state.maskingNode.connect(state.audioContext.destination);
    state.maskingNode.connect(state.outputAnalyser); // MI-010: For VU meter

    // Start FFT analysis
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
    Visualizer.startVUMeter(state.outputAnalyser); // MI-010: Use real output analyser
    Visualizer.startSpectrum(state.analyserNode);
  } catch (error) {
    ErrorHandler.showError(`Mic error: ${error.message}`);
    startSyntheticNoise(); // Fallback
  } finally {
    hideMicSpinner();
  }
}

function startSyntheticNoise() {
  if (state.isRunning) return;

  try {
    showMicSpinner();

    // Create silent oscillator (we generate noise in Worklet)
    const oscillator = state.audioContext.createOscillator();
    oscillator.type = 'sine';
    oscillator.frequency.value = 0;
    oscillator.start();

    // Setup MaskingGeneratorWorklet
    state.maskingNode = new AudioWorkletNode(
      state.audioContext,
      state.useFallbackWorklet ? 'fallback-worklet' : 'masking-generator-worklet'
    );

    // MI-010: Setup output analyser for VU meter
    state.outputAnalyser = state.audioContext.createAnalyser();
    state.outputAnalyser.fftSize = 256;

    // Connect
    oscillator.connect(state.maskingNode);
    state.maskingNode.connect(state.audioContext.destination);
    state.maskingNode.connect(state.outputAnalyser);

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
    Visualizer.startVUMeter(state.outputAnalyser);
  } catch (error) {
    ErrorHandler.showError(`Synthetic noise failed: ${error.message}`);
  } finally {
    hideMicSpinner();
  }
}

function stopMicrophone() {
  if (!state.isRunning) return;

  cleanup();
  state.isRunning = false;
  state.fftData = new Uint8Array(0);
  elements.startMic.disabled = false;
  elements.stopMic.disabled = true;
  updateStatus('Stopped. Ready to restart.');
}

// =============================================
// FFT ANALYSIS (MA-004: Throttled)
// =============================================
function startFFTAnalysis() {
  let lastUpdate = 0;
  const bufferLength = state.analyserNode.frequencyBinCount;
  const dataArray = new Uint8Array(bufferLength);

  function update(timestamp) {
    if (!state.isRunning || !state.analyserNode) {
      return;
    }

    // MA-004: Throttle to ~20 FPS
    if (timestamp - lastUpdate < 50) { // ~20 FPS
      requestAnimationFrame(update);
      return;
    }
    lastUpdate = timestamp;

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

  requestAnimationFrame(update);
}

// =============================================
// IR CONVOLUTION (MA-003: Size Limit)
// =============================================
async function handleIRFileUpload(e) {
  const file = e.target.files[0];
  if (!file) return;

  try {
    // MA-003: Limit IR file size to 50MB
    if (file.size > 50 * 1024 * 1024) {
      ErrorHandler.showError('IR file too large (max 50MB).');
      return;
    }

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
  // CR-005: Guard against null maskingNode
  if (!state.maskingNode) return;

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
    state.convolverNode.connect(state.outputAnalyser); // MI-010: For VU meter
    updateStatus('IR convolution enabled.');
  } else {
    state.maskingNode.connect(state.audioContext.destination);
    state.maskingNode.connect(state.outputAnalyser); // MI-010
    updateStatus(state.enableIR ? 'IR convolution disabled (no file).' : 'IR convolution disabled.');
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
