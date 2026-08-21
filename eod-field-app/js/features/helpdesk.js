/* Help desk report — own nav tab below Send. */
(function (global) {
  'use strict';

  async function render(mount) {
    mount.innerHTML = `
      <div class="card">
        <h1>Help desk</h1>
        <p class="muted">File a help desk report for today’s store visit.</p>
        <div class="btn-row">
          <button type="button" class="btn btn-primary" id="helpdeskOpenBtn">Open help desk report</button>
        </div>
      </div>`;
    document.getElementById('helpdeskOpenBtn').onclick = () => {
      if (typeof global.openHelpdeskWizard === 'function') global.openHelpdeskWizard();
      else alert('Help desk wizard not loaded');
    };
  }

  global.EodRouter.register('helpdesk', render);
})(typeof window !== 'undefined' ? window : globalThis);
