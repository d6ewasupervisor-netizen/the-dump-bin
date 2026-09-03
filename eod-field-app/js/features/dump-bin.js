/* Dump Bin — embed /dump-bin/ in-app (PDF viewer, print-at-store, crew send). */
(function (global) {
  'use strict';

  const DUMP_BIN_URL = 'https://the-dump-bin.com/dump-bin/?embed=1';

  function onViewerMessage(ev) {
    const d = ev && ev.data;
    if (!d || d.source !== 'materials-pdf-viewer') return;
    const card = document.querySelector('.dump-bin-embed-card');
    if (!card) return;
    const open = !!d.open;
    card.classList.toggle('is-viewer-open', open);
    document.body.classList.toggle('dump-bin-viewer-open', open);
  }

  async function render(mount) {
    window.removeEventListener('message', onViewerMessage);
    window.addEventListener('message', onViewerMessage);
    const ver = encodeURIComponent(global.EOD_APP_VERSION || '3.3.62');
    mount.innerHTML = `
      <div class="card dump-bin-embed-card">
        <div class="dump-bin-embed-bar">
          <h1>Dump Bin</h1>
          <a class="dump-bin-open-tab" href="https://the-dump-bin.com/dump-bin/" target="_blank" rel="noopener" title="Open in new tab" aria-label="Open in new tab">
            <img src="assets/new_window.png?v=${ver}" alt="" width="22" height="22">
          </a>
        </div>
        <iframe
          class="dump-bin-frame"
          src="${DUMP_BIN_URL}"
          title="Dump Bin materials"
          referrerpolicy="same-origin"
          allow="clipboard-read; clipboard-write; fullscreen"
        ></iframe>
      </div>`;
  }

  global.EodDumpBin = { render, DUMP_BIN_URL };
  global.EodRouter.register('dumpbin', render);
})(typeof window !== 'undefined' ? window : globalThis);
