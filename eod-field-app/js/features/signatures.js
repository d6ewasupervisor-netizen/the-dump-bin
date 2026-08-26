/* Department PIC signatures + daily PIC QR. */
(function (global) {
  'use strict';

  async function render(mount) {
    const S = global.EodSession;
    mount.innerHTML = `
      <div id="eodPicQrMount"></div>
      <div class="card heart dept-sig-card" id="deptSigMount"></div>`;
    if (global.EodPicQr?.mount) {
      try { await global.EodPicQr.mount(document.getElementById('eodPicQrMount')); } catch (_) {}
    }
    const deptHost = document.getElementById('deptSigMount');
    if (deptHost && global.EodDeptSignatures?.mountInline) {
      await global.EodDeptSignatures.mountInline(deptHost);
      try { global.EodDeptSignatures.syncFromSheet?.(S.state.sheet); } catch (_) {}
    } else if (deptHost) {
      deptHost.innerHTML = '<h1>Signatures</h1>';
    }
  }

  global.EodSignatures = { render };
  global.EodRouter.register('signatures', render);
})(typeof window !== 'undefined' ? window : globalThis);
