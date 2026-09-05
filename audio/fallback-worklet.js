// =============================================
// Fallback Worklet for Safari (no AudioWorklet support)
// Uses ScriptProcessorNode as a fallback
// =============================================

class FallbackWorklet extends AudioWorkletProcessor {
  constructor() {
    super();
    this.phase = Math.random() * 2 * Math.PI;
    this.sampleCount = 0;
    this.pinkB0 = 0;
    this.pinkB1 = 0;
    this.pinkB2 = 0;
    this.brownValue = 0;
    this.lastParams = {
      bands: [],
      gain: 0.3,
      noiseType: 'pink'
    };

    this.port.onmessage = (e) => {
      if (e.data) this.lastParams = e.data;
    };
  }

  generateWhiteNoise() {
    return Math.random() * 2 - 1;
  }

  generatePinkNoise() {
    const white = Math.random() * 2 - 1;
    this.pinkB0 = 0.049922035 * white + 0.950077965 * this.pinkB0;
    this.pinkB1 = -0.09984407 * white + 0.950077965 * this.pinkB1;
    this.pinkB2 = 0.049922035 * white + 0.950077965 * this.pinkB2;
    return this.pinkB0 + this.pinkB1 + this.pinkB2;
  }

  generateBrownNoise() {
    const white = Math.random() * 2 - 1;
    this.brownValue = (this.brownValue + white) * 0.997;
    return this.brownValue * 0.1;
  }

  process(inputs, outputs) {
    const output = outputs[0];
    const channelData = output[0];

    if (!channelData) return true;

    const { noiseType, gain } = this.lastParams;

    for (let i = 0; i < channelData.length; i++) {
      let sample;
      switch (noiseType) {
        case 'pink': sample = this.generatePinkNoise(); break;
        case 'brown': sample = this.generateBrownNoise(); break;
        default: sample = this.generateWhiteNoise(); break;
      }

      // Apply gain (no spectral shaping in fallback)
      sample = sample * gain;
      sample = Math.max(-0.99, Math.min(0.99, sample));
      channelData[i] = sample;
    }

    return true;
  }
}

registerProcessor('fallback-worklet', FallbackWorklet);
