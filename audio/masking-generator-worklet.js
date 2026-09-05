// =============================================
// Masking Generator Worklet
// Implements ANC Inverse: Generates adaptive masking noise
// =============================================

class MaskingGeneratorWorklet extends AudioWorkletProcessor {
  constructor() {
    super();
    // State for noise generators
    this.phase = Math.random() * 2 * Math.PI;
    this.sampleCount = 0;

    // Pink noise filter state (Gardner method)
    this.pinkB0 = 0;
    this.pinkB1 = 0;
    this.pinkB2 = 0;

    // Brown noise filter state
    this.brownValue = 0;

    // Default params
    this.lastParams = {
      bands: [],
      gain: 0.3,
      noiseType: 'pink'
    };

    // Listen for messages from main thread
    this.port.onmessage = (e) => {
      this.lastParams = e.data;
    };
  }

  // =============================================
  // NOISE GENERATORS
  // =============================================

  // White noise: Uniform random
  generateWhiteNoise() {
    return Math.random() * 2 - 1;
  }

  // Pink noise: Equal energy per octave (Gardner algorithm)
  generatePinkNoise() {
    const white = Math.random() * 2 - 1;
    this.pinkB0 = 0.049922035 * white + 0.950077965 * this.pinkB0;
    this.pinkB1 = -0.09984407 * white + 0.950077965 * this.pinkB1;
    this.pinkB2 = 0.049922035 * white + 0.950077965 * this.pinkB2;
    return this.pinkB0 + this.pinkB1 + this.pinkB2;
  }

  // Brown noise: Integrated white noise (1/f²)
  generateBrownNoise() {
    const white = Math.random() * 2 - 1;
    this.brownValue = (this.brownValue + white) * 0.997; // Leaky integrator
    return this.brownValue * 0.1;
  }

  // =============================================
  // ANC INVERSE: Spectral Shaping
  // =============================================
  applySpectralShaping(sample, index, channelData) {
    const { bands, gain } = this.lastParams;

    // If no bands, just apply gain
    if (bands.length === 0) {
      return sample * gain;
    }

    // Map sample index to frequency bin
    const sampleRate = this.sampleRate || 44100;
    const fftSize = 2048; // Match main thread
    const totalBins = channelData.length;
    const bin = Math.floor((index / totalBins) * fftSize);

    // Find the closest frequency band
    let closestBand = bands[0];
    let minDist = Math.abs(bin - 0);

    for (let i = 1; i < bands.length; i++) {
      const bandBin = Math.floor((bands[i].freq / sampleRate) * fftSize);
      const dist = Math.abs(bin - bandBin);
      if (dist < minDist) {
        minDist = dist;
        closestBand = bands[i];
      }
    }

    // ANC Inverse: Invert the amplitude (boost quiet bands, cut loud bands)
    const invertedAmp = 1 - closestBand.amp;

    // Apply shaping with smoothing
    const shapedSample = sample * gain * (0.3 + invertedAmp * 0.7);

    return shapedSample;
  }

  // =============================================
  // PHASE RANDOMIZATION (Prevents Feedback)
  // =============================================
  applyPhaseRandomization(sample) {
    // Randomize phase every 100 samples
    if (this.sampleCount % 100 === 0) {
      this.phase = Math.random() * 2 * Math.PI;
    }
    this.sampleCount = (this.sampleCount + 1) % 100;
    return sample * Math.cos(this.phase);
  }

  // =============================================
  // MAIN PROCESSING LOOP
  // =============================================
  process(inputs, outputs) {
    const output = outputs[0];
    const channelData = output[0];

    if (!channelData) return true;

    const { noiseType } = this.lastParams;

    for (let i = 0; i < channelData.length; i++) {
      // Step 1: Generate base noise
      let sample;
      switch (noiseType) {
        case 'pink':
          sample = this.generatePinkNoise();
          break;
        case 'brown':
          sample = this.generateBrownNoise();
          break;
        case 'white':
        default:
          sample = this.generateWhiteNoise();
          break;
      }

      // Step 2: Apply ANC Inverse spectral shaping
      sample = this.applySpectralShaping(sample, i, channelData);

      // Step 3: Apply phase randomization (prevents feedback)
      sample = this.applyPhaseRandomization(sample);

      // Step 4: Clamp to [-1, 1] to prevent distortion
      sample = Math.max(-0.99, Math.min(0.99, sample));

      channelData[i] = sample;
    }

    return true;
  }
}

// Register the processor
registerProcessor('masking-generator-worklet', MaskingGeneratorWorklet);
