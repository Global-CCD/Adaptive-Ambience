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
  lastVUTime: 0,

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
  // UPDATE SPECTRUM ANALYZER
  // =============================================
  updateSpectrum(fftData) {
    this.drawSpectrum(fftData);
  },

  drawSpectrum(fftData) {
    if (!this.spectrumCtx) return;

    const { width, height } = this.spectrumCanvas;
    const barWidth = width / 128; // Fixed 128 bars for smoothness
    const maxBarHeight = height;

    this.spectrumCtx.clearRect(0, 0, width, height);

    // Draw gradient background
    const gradient = this.spectrumCtx.createLinearGradient(0, 0, 0, height);
    gradient.addColorStop(0, '#222');
    gradient.addColorStop(1, '#111');
    this.spectrumCtx.fillStyle = gradient;
    this.spectrumCtx.fillRect(0, 0, width, height);

    // Draw bars
    for (let i = 0; i < 128; i++) {
      const barHeight = (fftData[i] || 0) / 255 * maxBarHeight;
      const x = i * barWidth;
      const hue = i / 128 * 240 + 120; // Blue to green

      this.spectrumCtx.fillStyle = `hsl(${hue}, 100%, 60%)`;
      this.spectrumCtx.fillRect(x, height - barHeight, barWidth - 1, barHeight);
    }
  },

  // =============================================
  // START VU METER ANIMATION
  // =============================================
  startVUMeter() {
    if (this.vuMeterAnimationId) {
      cancelAnimationFrame(this.vuMeterAnimationId);
    }

    const update = (timestamp) => {
      // Calculate time delta for smoothing
      const deltaTime = timestamp - this.lastVUTime;
      this.lastVUTime = timestamp;

      // In a real app, you'd analyze the output signal
      // For this demo, we simulate based on masking params
      const level = this.calculateVULevel();
      this.drawVUMeter(level);

      this.vuMeterAnimationId = requestAnimationFrame(update);
    };

    this.vuMeterAnimationId = requestAnimationFrame(update);
  },

  // =============================================
  // STOP VU METER
  // =============================================
  stopVUMeter() {
    if (this.vuMeterAnimationId) {
      cancelAnimationFrame(this.vuMeterAnimationId);
      this.vuMeterAnimationId = null;
      this.drawVUMeter(0); // Reset to 0
    }
  },

  // =============================================
  // CALCULATE SIMULATED VU LEVEL
  // =============================================
  calculateVULevel() {
    if (!this.state.isRunning) return 0;

    // Simulate based on volume and masking activity
    const baseLevel = this.state.volume * 0.7;
    const randomVariation = Math.random() * 0.1;
    const fftBoost = this.state.fftData.reduce((a, b) => a + b, 0) / this.state.fftData.length / 255 * 0.2;

    return Math.min(1, baseLevel + randomVariation + fftBoost);
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
