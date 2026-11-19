/* Dump Bin — full-screen overlay of /dump-bin/ (PDF viewer, print-at-store, crew send). */
(function (global) {
  'use strict';

  const DUMP_BIN_URL = 'https://the-dump-bin.com/dump-bin/?embed=1';

  function routeName() {
    return String(location.hash || '').replace(/^#\/?/, '').split('?')[0].toLowerCase();
  }

  function syncBodyClass() {
    document.body.classList.toggle('dump-bin-overlay-open', routeName() === 'dumpbin');
  }

  function onViewerMessage(ev) {
    const d = ev && ev.data;
    if (!d || d.source !== 'materials-pdf-viewer') return;
    const card = document.querySelector('.dump-bin-embed-card');
    if (!card) return;
    const open = !!d.open;
    card.classList.toggle('is-viewer-open', open);
    document.body.classList.toggle('dump-bin-viewer-open', open);
  }

  function closeOverlay() {
    document.body.classList.remove('dump-bin-overlay-open');
    document.body.classList.remove('dump-bin-viewer-open');
    if (history.length > 1) {
      history.back();
      return;
    }
    global.EodRouter.go('signoff');
  }

  function onKey(ev) {
    if (ev.key !== 'Escape') return;
    if (routeName() !== 'dumpbin') return;
    if (document.querySelector('.dump-bin-embed-card.is-viewer-open')) return;
    closeOverlay();
  }

  async function render(mount) {
    window.removeEventListener('message', onViewerMessage);
    window.addEventListener('message', onViewerMessage);
    window.removeEventListener('keydown', onKey);
    window.addEventListener('keydown', onKey);
    syncBodyClass();
    mount.innerHTML = `
      <div class="dump-bin-overlay dump-bin-embed-card" role="dialog" aria-modal="true" aria-label="Dump Bin">
        <div class="dump-bin-embed-bar">
          <button type="button" class="dump-bin-close" aria-label="Close">
            <svg class="dump-bin-close-ico" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
              <path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M6 6l12 12M18 6 6 18"/>
            </svg>
          </button>
          <h1>Dump Bin</h1>
          <a class="dump-bin-open-tab" href="https://the-dump-bin.com/dump-bin/" target="_blank" rel="noopener" title="Open in new tab" aria-label="Open in new tab">
            <svg class="dump-bin-open-tab-ico" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
              <path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M14 4h6v6M20 4 10 14M11 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-5"/>
            </svg>
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
    mount.querySelector('.dump-bin-close')?.addEventListener('click', closeOverlay);
  }

  window.addEventListener('hashchange', syncBodyClass);

  global.EodDumpBin = { render, closeOverlay, DUMP_BIN_URL };
  global.EodRouter.register('dumpbin', render);
})(typeof window !== 'undefined' ? window : globalThis);
