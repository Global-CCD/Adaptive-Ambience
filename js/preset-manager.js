// =============================================
// Preset Manager
// Handles saving, loading, and managing presets
// =============================================

const PresetManager = {
  MAX_PRESETS: 50, // MI-009: Limit to 50 presets

  // =============================================
  // SAVE PRESET (MA-002: Validation)
  // =============================================
  savePreset(name, state) {
    try {
      // MA-002: Validate preset data
      if (typeof state.volume !== 'number' || state.volume < 0 || state.volume > 1) {
        ErrorHandler.showError('Invalid volume value (must be 0-1).');
        return false;
      }

      if (!['white', 'pink', 'brown'].includes(state.noiseType)) {
        ErrorHandler.showError('Invalid noise type.');
        return false;
      }

      if (typeof state.enableIR !== 'boolean') {
        ErrorHandler.showError('Invalid IR setting.');
        return false;
      }

      // MI-009: Check preset limit
      const presets = this.getPresets();
      if (presets.length >= this.MAX_PRESETS) {
        ErrorHandler.showError(`Maximum ${this.MAX_PRESETS} presets allowed.`);
        return false;
      }

      const preset = {
        name,
        volume: state.volume,
        noiseType: state.noiseType,
        enableIR: state.enableIR,
        irFile: state.irBuffer ? 'custom-ir.wav' : null,
        createdAt: new Date().toISOString()
      };

      presets.push(preset);
      localStorage.setItem('adaptiveAmbiencePresets', JSON.stringify(presets));
      this.loadPresets();
      ErrorHandler.showSuccess(`Preset "${name}" saved!`);
      return true;
    } catch (error) {
      ErrorHandler.showError(`Failed to save preset: ${error.message}`);
      return false;
    }
  },

  // =============================================
  // LOAD PRESETS INTO DROPDOWN
  // =============================================
  loadPresets() {
    const presets = this.getPresets();
    const select = document.getElementById('loadPreset');

    // Clear existing options (keep the first one)
    while (select.options.length > 1) {
      select.remove(1);
    }

    // Add presets to dropdown (sorted by date, newest first)
    presets.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
           .forEach(preset => {
      const option = document.createElement('option');
      option.value = preset.name;
      option.textContent = `${preset.name} (${new Date(preset.createdAt).toLocaleDateString()})`;
      select.appendChild(option);
    });
  },

  // =============================================
  // LOAD A SPECIFIC PRESET
  // =============================================
  loadPreset(name, state) {
    const presets = this.getPresets();
    const preset = presets.find(p => p.name === name);

    if (!preset) {
      ErrorHandler.showError(`Preset "${name}" not found.`);
      return false;
    }

    // Validate preset data (MA-002)
    if (typeof preset.volume !== 'number' || preset.volume < 0 || preset.volume > 1) {
      ErrorHandler.showError(`Preset "${name}" has invalid volume.`);
      return false;
    }

    // Apply preset to state
    state.volume = preset.volume;
    state.noiseType = preset.noiseType;
    state.enableIR = preset.enableIR;

    // Update UI
    document.getElementById('volume').value = state.volume;
    document.getElementById('volumeValue').textContent = `${Math.round(state.volume * 100)}%`;
    document.getElementById('enableIR').checked = state.enableIR;
    document.getElementById('noiseType').value = state.noiseType;
    document.getElementById('irFile').disabled = !state.enableIR;

    // Update IR status
    if (preset.enableIR && preset.irFile) {
      document.getElementById('irStatus').textContent = `IR: ${preset.irFile}`;
    } else {
      document.getElementById('irStatus').textContent = 'No IR loaded';
    }

    // If masking is running, update params
    if (state.maskingNode) {
      state.maskingNode.port.postMessage({
        bands: state.maskingParams.bands,
        gain: state.volume,
        noiseType: state.noiseType
      });
    }

    ErrorHandler.showSuccess(`Preset "${name}" loaded!`);
    return true;
  },

  // =============================================
  // DELETE PRESET
  // =============================================
  deletePreset(name) {
    const presets = this.getPresets();
    const index = presets.findIndex(p => p.name === name);

    if (index === -1) {
      ErrorHandler.showError(`Preset "${name}" not found.`);
      return false;
    }

    presets.splice(index, 1);
    localStorage.setItem('adaptiveAmbiencePresets', JSON.stringify(presets));
    this.loadPresets();
    ErrorHandler.showSuccess(`Preset "${name}" deleted.`);
    return true;
  },

  // =============================================
  // EXPORT PRESET AS JSON
  // =============================================
  exportPreset(name) {
    const presets = this.getPresets();
    const preset = presets.find(p => p.name === name);

    if (!preset) {
      ErrorHandler.showError(`Preset "${name}" not found.`);
      return;
    }

    const data = JSON.stringify(preset, null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = `${name.replace(/\s+/g, '_')}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    ErrorHandler.showSuccess(`Preset "${name}" exported!`);
  },

  // =============================================
  // IMPORT PRESET FROM JSON
  // =============================================
  async importPreset(file, state) {
    try {
      const text = await file.text();
      const preset = JSON.parse(text);

      // Validate preset (MA-002)
      if (!preset.name || typeof preset.volume === 'undefined') {
        throw new Error('Invalid preset file.');
      }

      if (typeof preset.volume !== 'number' || preset.volume < 0 || preset.volume > 1) {
        throw new Error('Invalid volume value in preset.');
      }

      if (!['white', 'pink', 'brown'].includes(preset.noiseType)) {
        throw new Error('Invalid noise type in preset.');
      }

      // Check preset limit (MI-009)
      const presets = this.getPresets();
      if (presets.length >= this.MAX_PRESETS) {
        throw new Error(`Maximum ${this.MAX_PRESETS} presets allowed.`);
      }

      // Save the preset
      presets.push(preset);
      localStorage.setItem('adaptiveAmbiencePresets', JSON.stringify(presets));

      // Load the preset
      this.loadPresets();
      this.loadPreset(preset.name, state);
      ErrorHandler.showSuccess(`Preset "${preset.name}" imported!`);
    } catch (error) {
      ErrorHandler.showError(`Import failed: ${error.message}`);
    }
  },

  // =============================================
  // GET ALL PRESETS FROM LOCALSTORAGE
  // =============================================
  getPresets() {
    const data = localStorage.getItem('adaptiveAmbiencePresets');
    return data ? JSON.parse(data) : [];
  }
};

// Make globally available
window.PresetManager = PresetManager;
