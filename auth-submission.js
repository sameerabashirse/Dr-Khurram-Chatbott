(function exposeAuthSubmission(root, factory) {
  const authSubmission = factory();
  if (typeof module === "object" && module.exports) module.exports = authSubmission;
  else root.authSubmission = authSubmission;
})(typeof globalThis !== "undefined" ? globalThis : this, () => ({
  async runOnce(form, task) {
    if (form.dataset.submitting === "true") return false;
    form.dataset.submitting = "true";
    try {
      await task();
      return true;
    } finally {
      delete form.dataset.submitting;
    }
  }
}));
