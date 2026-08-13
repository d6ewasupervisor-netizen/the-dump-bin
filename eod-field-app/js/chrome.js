/* Sticky chrome + bottom nav. SAS/SI dots + version live in connections / version-test. */
(function (global) {
  'use strict';

  function refresh() {
    const S = global.EodSession;
    const storeEl = document.getElementById('chromeStore');
    const metaEl = document.getElementById('chromeMeta');
    const gateEl = document.getElementById('chromeGate');
    if (!S) return;
    if (storeEl) storeEl.textContent = S.state.storeNumber ? `#${S.state.storeNumber}` : 'No store';
    if (metaEl) {
      const parts = [];
      if (S.state.workDate) parts.push(S.state.workDate);
      if (S.hasHostedSheet()) {
        const s = S.state.sheet.summary || {};
        parts.push(`${s.marked || 0}/${s.total || 0}`);
        parts.push(S.sheetSendReady() ? 'send OK' : 'open');
      } else if (S.state.sheetLoaded) {
        parts.push('no sheet');
      }
      if (global.EodTestMode?.isEnabled?.()) parts.push('TEST');
      metaEl.textContent = parts.filter(Boolean).join(' · ');
      metaEl.title = parts.filter(Boolean).join(' · ');
    }
    if (gateEl) {
      gateEl.textContent = S.isVisitReady() ? 'OK' : 'Confirm';
      gateEl.title = S.isVisitReady() ? 'Day confirmed' : 'Needs day confirm';
      gateEl.className = 'pill ' + (S.isVisitReady() ? 'ok' : 'warn');
    }
  }

  function init() {
    document.querySelectorAll('[data-nav]').forEach((btn) => {
      btn.addEventListener('click', () => {
        global.EodRouter.go(btn.getAttribute('data-nav'));
      });
    });
    document.getElementById('chromeCoverLink')?.addEventListener('click', (e) => {
      e.preventDefault();
      global.EodRouter.go('cover');
    });
    document.getElementById('chromeVisitLink')?.addEventListener('click', (e) => {
      e.preventDefault();
      global.EodRouter.go('visit');
    });
    global.EodSession?.on(() => refresh());
    refresh();
  }

  global.EodChrome = { refresh, init };
})(typeof window !== 'undefined' ? window : globalThis);
