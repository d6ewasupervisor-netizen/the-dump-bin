/* Dump Bin — embed /dump-bin/ in-app (PDF viewer, print-at-store, crew send). */
(function (global) {
  'use strict';

  const DUMP_BIN_URL = 'https://the-dump-bin.com/dump-bin/';

  async function render(mount) {
    mount.innerHTML = `
      <div class="card dump-bin-embed-card">
        <div class="btn-row" style="justify-content:space-between;align-items:center;margin-bottom:10px;gap:10px;flex-wrap:wrap;">
          <h1 style="margin:0;">Dump Bin</h1>
          <a class="btn btn-secondary" href="${DUMP_BIN_URL}" target="_blank" rel="noopener">Open in tab</a>
        </div>
        <iframe
          class="dump-bin-frame"
          src="${DUMP_BIN_URL}"
          title="Dump Bin materials"
          referrerpolicy="same-origin"
          allow="clipboard-read; clipboard-write"
        ></iframe>
      </div>`;
  }

  global.EodDumpBin = { render, DUMP_BIN_URL };
  global.EodRouter.register('dumpbin', render);
  global.EodRouter.register('photos', async () => {
    global.EodRouter.go('dumpbin', { replace: true });
  });
})(typeof window !== 'undefined' ? window : globalThis);
