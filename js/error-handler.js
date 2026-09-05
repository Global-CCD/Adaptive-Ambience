// =============================================
// Error Handler
// Manages error display and user feedback
// =============================================

const ErrorHandler = {
  toast: document.getElementById('errorToast'),
  errorMessage: document.getElementById('errorMessage'),
  timeoutId: null,

  // =============================================
  // SHOW ERROR
  // =============================================
  showError(message) {
    this.clearTimeout();
    this.errorMessage.textContent = message;
    this.toast.classList.remove('success');
    this.toast.hidden = false;
    this.timeoutId = setTimeout(() => this.hideError(), 5000);
  },

  // =============================================
  // SHOW SUCCESS
  // =============================================
  showSuccess(message) {
    this.clearTimeout();
    this.errorMessage.textContent = message;
    this.toast.classList.add('success');
    this.toast.hidden = false;
    this.timeoutId = setTimeout(() => this.hideError(), 3000);
  },

  // =============================================
  // HIDE ERROR
  // =============================================
  hideError() {
    this.clearTimeout();
    this.toast.hidden = true;
  },

  // =============================================
  // CLEAR TIMEOUT
  // =============================================
  clearTimeout() {
    if (this.timeoutId) {
      clearTimeout(this.timeoutId);
      this.timeoutId = null;
    }
  }
};

// Make globally available
window.ErrorHandler = ErrorHandler;
