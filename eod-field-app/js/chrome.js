/* Sticky chrome + bottom nav + version check. */
(function (global) {
  'use strict';

  function setDot(id, state) {
    const el = document.getElementById(id);
    if (el) el.setAttribute('data-state', state || '');
  }

  function refreshAuthDot() {
    const has = !!(global.dumpBinGetSession?.() || (() => {
      try { return localStorage.getItem('dumpBinSession') || localStorage.getItem('eodSession'); }
      catch (_) { return ''; }
    })());
    setDot('dotAuth', has ? 'ok' : 'bad');
  }

  async function pingApi() {
    try {
      const resp = await fetch(`${global.EOD_API_BASE}/health`, { cache: 'no-store', mode: 'cors' });
      setDot('dotApi', resp.ok ? 'ok' : 'bad');
    } catch (_) {
      // health may 404 — try a lightweight OPTIONS/HEAD fallback via authFetch to /api/me with noBounce
      try {
        const resp = await global.authFetch(`${global.EOD_API_BASE}/api/me`, { method: 'GET', noBounceOn401: true });
        setDot('dotApi', resp.status < 500 ? 'ok' : 'bad');
      } catch (_) {
        setDot('dotApi', 'bad');
      }
    }
  }

  function refresh() {
    const S = global.EodSession;
    const storeEl = document.getElementById('chromeStore');
    const metaEl = document.getElementById('chromeMeta');
    const gateEl = document.getElementById('chromeGate');
    if (!S) return;
    if (storeEl) storeEl.textContent = S.state.storeNumber ? `FM ${S.state.storeNumber}` : 'No store';
    if (metaEl) {
      const parts = [S.state.workDate || ''];
      if (S.hasHostedSheet()) {
        const s = S.state.sheet.summary || {};
        parts.push(`${s.marked || 0}/${s.total || 0} marked`);
        parts.push(S.sheetSendReady() ? 'send OK' : 'open sets');
      } else if (S.state.sheetLoaded) {
        parts.push('no sheet');
      }
      metaEl.textContent = parts.filter(Boolean).join(' · ');
    }
    if (gateEl) {
      gateEl.textContent = S.isVisitReady() ? 'Confirmed' : 'Needs confirm';
      gateEl.className = 'pill ' + (S.isVisitReady() ? 'ok' : 'warn');
    }
    refreshAuthDot();
  }

  async function checkVersion() {
    try {
      const resp = await fetch(`eod-version.json?cb=${Date.now()}`, { cache: 'no-store' });
      if (!resp.ok) return;
      const data = await resp.json();
      const remote = data.version;
      const banner = document.getElementById('updateBanner');
      if (!banner) return;
      if (remote && remote !== global.EOD_APP_VERSION) {
        banner.hidden = false;
        banner.innerHTML = `Update available (v${remote}). <button type="button" class="btn btn-secondary" id="reloadAppBtn" style="margin-left:8px;min-height:32px;padding:4px 10px;">Reload</button>`;
        document.getElementById('reloadAppBtn').onclick = () => {
          try { global.EodSession?.saveDraft(); } catch (_) {}
          location.reload();
        };
      } else {
        banner.hidden = true;
      }
    } catch (_) {}
  }

  function init() {
    document.querySelectorAll('[data-nav]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const route = btn.getAttribute('data-nav');
        if (route === 'cover') global.EodRouter.go('cover');
        else global.EodRouter.go(route);
      });
    });
    // Cover is available via chrome link
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
    pingApi();
    checkVersion();
    setInterval(checkVersion, 5 * 60 * 1000);
    setInterval(pingApi, 2 * 60 * 1000);
  }

  global.EodChrome = { refresh, init, checkVersion };
})(typeof window !== 'undefined' ? window : globalThis);
