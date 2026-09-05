// Initialize
const audioContext = new AudioContext();
let mediaStreamSource, analyzerNode, maskingNode, convolverNode;
let irBuffer = null;

// Start Microphone
document.getElementById('startMic').addEventListener('click', async () => {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  mediaStreamSource = audioContext.createMediaStreamSource(stream);

  // Load Worklets
  await audioContext.audioWorklet.addModule('audio/analyzer-worklet.js');
  await audioContext.audioWorklet.addModule('audio/masking-generator-worklet.js');

  // Create Nodes
  analyzerNode = new AudioWorkletNode(audioContext, 'analyzer-worklet');
  maskingNode = new AudioWorkletNode(audioContext, 'masking-generator-worklet');

  // Connect
  mediaStreamSource.connect(analyzerNode);
  analyzerNode.connect(maskingNode);
  maskingNode.connect(audioContext.destination);

  // Handle FFT data from Worklet
  analyzerNode.port.onmessage = (e) => {
    const { fftData } = e.data;
    maskingNode.port.postMessage({ bands: fftData, gain: 0.5 });
  };
});

// Toggle IR Convolution
document.getElementById('enableIR').addEventListener('change', async (e) => {
  if (e.target.checked && irBuffer) {
    convolverNode = audioContext.createConvolver();
    convolverNode.buffer = irBuffer;
    maskingNode.disconnect();
    maskingNode.connect(convolverNode);
    convolverNode.connect(audioContext.destination);
  } else {
    maskingNode.disconnect();
    maskingNode.connect(audioContext.destination);
  }
});

// Load IR File
document.getElementById('irFile').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  const arrayBuffer = await file.arrayBuffer();
  irBuffer = await audioContext.decodeAudioData(arrayBuffer);
});
