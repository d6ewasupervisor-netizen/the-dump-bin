/* Sticky chrome + side / bottom nav. SAS/SI dots + version live in connections / version-test. */
(function (global) {
  'use strict';

  const NAV_COLLAPSE_KEY = 'eod-nav-collapsed';

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
      try {
        const p = global.EodPhotoPipeline?.pendingCounts?.();
        const open = (p?.compress || 0) + (p?.upload || 0);
        if (open > 0) parts.push(`${open} syncing`);
      } catch (_) {}
      metaEl.textContent = parts.filter(Boolean).join(' · ');
      metaEl.title = parts.filter(Boolean).join(' · ');
    }
    if (gateEl) {
      gateEl.textContent = S.isVisitReady() ? 'OK' : 'Confirm';
      gateEl.title = S.isVisitReady() ? 'Day confirmed' : 'Needs day confirm';
      gateEl.className = 'pill ' + (S.isVisitReady() ? 'ok' : 'warn');
    }
  }

  function applyNavCollapsed(collapsed) {
    document.body.classList.toggle('nav-collapsed', !!collapsed);
    const btn = document.getElementById('navCollapseBtn');
    if (btn) {
      btn.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
      btn.title = collapsed ? 'Expand navigation' : 'Collapse navigation';
      btn.textContent = collapsed ? '»' : '«';
    }
    try {
      localStorage.setItem(NAV_COLLAPSE_KEY, collapsed ? '1' : '0');
    } catch (_) {}
  }

  function init() {
    document.querySelectorAll('[data-nav]').forEach((btn) => {
      btn.addEventListener('click', () => {
        global.EodRouter.go(btn.getAttribute('data-nav'));
      });
    });
    document.getElementById('chromeVisitLink')?.addEventListener('click', (e) => {
      e.preventDefault();
      global.EodRouter.go('visit');
    });
    const collapseBtn = document.getElementById('navCollapseBtn');
    if (collapseBtn) {
      let collapsed = false;
      try { collapsed = localStorage.getItem(NAV_COLLAPSE_KEY) === '1'; } catch (_) {}
      applyNavCollapsed(collapsed);
      collapseBtn.addEventListener('click', () => {
        applyNavCollapsed(!document.body.classList.contains('nav-collapsed'));
      });
    }
    global.EodPhotoPipeline?.onChange?.(() => {
      try { refresh(); } catch (_) {}
    });
    global.EodSession?.on(() => refresh());
    refresh();
  }

  global.EodChrome = { refresh, init, applyNavCollapsed };
})(typeof window !== 'undefined' ? window : globalThis);
