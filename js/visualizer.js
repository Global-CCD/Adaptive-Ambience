// =============================================
// Visualizer
// Real-time spectrum analyzer and VU meter
// =============================================

const Visualizer = {
  spectrumCanvas: null,
  spectrumCtx: null,
  vuMeterCanvas: null,
  vuMeterCtx: null,
  state: null,
  animationId: null,
  vuMeterAnimationId: null,
  spectrumAnimationId: null,
  lastVUTime: 0,
  analyser: null, // For spectrum
  outputAnalyser: null, // For VU meter (MI-010)

  // =============================================
  // INITIALIZE
  // =============================================
  init(spectrumCanvas, vuMeterCanvas, state) {
    this.spectrumCanvas = spectrumCanvas;
    this.spectrumCtx = spectrumCanvas.getContext('2d');
    this.vuMeterCanvas = vuMeterCanvas;
    this.vuMeterCtx = vuMeterCanvas.getContext('2d');
    this.state = state;

    // Set initial canvas sizes
    this.resize();
    window.addEventListener('resize', () => this.resize());
  },

  // =============================================
  // RESIZE CANVASES
  // =============================================
  resize() {
    const containerWidth = this.spectrumCanvas.parentElement.clientWidth;
    this.spectrumCanvas.width = containerWidth;
    this.spectrumCanvas.height = 150;
    this.vuMeterCanvas.width = containerWidth;
    this.vuMeterCanvas.height = 50;
    this.drawSpectrum([]); // Redraw
    this.drawVUMeter(0);   // Redraw
  },

  // =============================================
  // START/STOP SPECTRUM ANALYZER
  // =============================================
  startSpectrum(analyser) {
    if (this.spectrumAnimationId) {
      cancelAnimationFrame(this.spectrumAnimationId);
    }
    this.analyser = analyser;
    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);

    const update = () => {
      if (!this.analyser || !this.spectrumCtx) {
        this.spectrumAnimationId = null;
        return;
      }
      this.analyser.getByteFrequencyData(dataArray);
      this.drawSpectrum(dataArray);
      this.spectrumAnimationId = requestAnimationFrame(update);
    };
    this.spectrumAnimationId = requestAnimationFrame(update);
  },

  stopSpectrum() {
    if (this.spectrumAnimationId) {
      cancelAnimationFrame(this.spectrumAnimationId);
      this.spectrumAnimationId = null;
      this.drawSpectrum([]);
    }
  },

  // =============================================
  // UPDATE SPECTRUM ANALYZER
  // =============================================
  updateSpectrum(fftData) {
    this.drawSpectrum(fftData);
  },

  drawSpectrum(fftData) {
    if (!this.spectrumCtx) return;

    const { width, height } = this.spectrumCanvas;
    const barCount = 128; // Fixed for consistency
    const barWidth = width / barCount;
    const maxBarHeight = height;

    this.spectrumCtx.clearRect(0, 0, width, height);

    // Draw gradient background
    const gradient = this.spectrumCtx.createLinearGradient(0, 0, 0, height);
    gradient.addColorStop(0, '#222');
    gradient.addColorStop(1, '#111');
    this.spectrumCtx.fillStyle = gradient;
    this.spectrumCtx.fillRect(0, 0, width, height);

    // Draw bars
    for (let i = 0; i < barCount; i++) {
      const barHeight = (fftData[i] || 0) / 255 * maxBarHeight;
      const x = i * barWidth;
      const hue = i / barCount * 240 + 120; // Blue to green

      this.spectrumCtx.fillStyle = `hsl(${hue}, 100%, 60%)`;
      this.spectrumCtx.fillRect(x, height - barHeight, barWidth - 1, barHeight);
    }
  },

  // =============================================
  // START/STOP VU METER (MI-010: Real Audio Levels)
  // =============================================
  startVUMeter(analyser) {
    if (this.vuMeterAnimationId) {
      cancelAnimationFrame(this.vuMeterAnimationId);
    }
    this.outputAnalyser = analyser;
    const dataArray = new Uint8Array(this.outputAnalyser.frequencyBinCount);

    const update = (timestamp) => {
      if (!this.outputAnalyser || !this.vuMeterCtx) {
        this.vuMeterAnimationId = null;
        return;
      }

      // Get real-time level from analyser
      this.outputAnalyser.getByteTimeDomainData(dataArray);
      const level = this.calculateVULevel(dataArray);
      this.drawVUMeter(level);

      this.vuMeterAnimationId = requestAnimationFrame(update);
    };
    this.vuMeterAnimationId = requestAnimationFrame(update);
  },

  stopVUMeter() {
    if (this.vuMeterAnimationId) {
      cancelAnimationFrame(this.vuMeterAnimationId);
      this.vuMeterAnimationId = null;
      this.drawVUMeter(0); // Reset to 0
    }
  },

  // =============================================
  // CALCULATE REAL VU LEVEL (MI-010)
  // =============================================
  calculateVULevel(dataArray) {
    // CR-001: Null-safe check
    if (!this.state?.isRunning || !dataArray) return 0;

    // Calculate RMS level from time-domain data
    let sum = 0;
    for (let i = 0; i < dataArray.length; i++) {
      const sample = (dataArray[i] - 128) / 128; // Convert to [-1, 1]
      sum += sample * sample;
    }
    const rms = Math.sqrt(sum / dataArray.length);
    const level = Math.min(1, rms * 2); // Scale to [0, 1]
    return level;
  },

  // =============================================
  // DRAW VU METER
  // =============================================
  drawVUMeter(level) {
    if (!this.vuMeterCtx) return;

    const { width, height } = this.vuMeterCanvas;
    const barWidth = width * 0.8;
    const barHeight = level * height;

    // Clear
    this.vuMeterCtx.clearRect(0, 0, width, height);

    // Draw background
    this.vuMeterCtx.fillStyle = '#222';
    this.vuMeterCtx.fillRect(0, 0, width, height);

    // Draw bar
    const hue = Math.min(120, level * 120); // Green to red
    this.vuMeterCtx.fillStyle = `hsl(${hue}, 100%, 50%)`;
    this.vuMeterCtx.fillRect(
      (width - barWidth) / 2,
      height - barHeight,
      barWidth,
      barHeight
    );

    // Draw outline
    this.vuMeterCtx.strokeStyle = '#444';
    this.vuMeterCtx.lineWidth = 2;
    this.vuMeterCtx.strokeRect(
      (width - barWidth) / 2,
      0,
      barWidth,
      height
    );
  }
};

// Make globally available
window.Visualizer = Visualizer;
