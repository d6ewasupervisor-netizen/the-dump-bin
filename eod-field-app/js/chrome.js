/* Sticky chrome + side / bottom nav. Tap store pill for quick view. */
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
    paintUnsentBanner();
  }

  async function paintUnsentBanner() {
    let bar = document.getElementById('eodUnsentBanner');
    if (!bar) {
      bar = document.createElement('div');
      bar.id = 'eodUnsentBanner';
      bar.hidden = true;
      bar.className = 'eod-unsent-banner';
      const chrome = document.getElementById('appChrome');
      if (chrome && chrome.parentNode) chrome.parentNode.insertBefore(bar, chrome.nextSibling);
      else document.querySelector('.app-shell')?.prepend(bar);
    }
    try {
      const unsent = await global.PhotoDB?.unsentSessions?.();
      if (!unsent || !unsent.length) {
        bar.hidden = true;
        bar.innerHTML = '';
        return;
      }
      bar.hidden = false;
      bar.innerHTML = `${unsent.length} unsent photo session(s) · <button type="button" class="btn btn-secondary" id="unsentOpenPhotos">Photos</button>`;
      bar.querySelector('#unsentOpenPhotos')?.addEventListener('click', () => global.EodRouter.go('photos'));
    } catch (_) {
      bar.hidden = true;
    }
  }

  function openQuickView() {
    const S = global.EodSession;
    if (!S) return;
    const sheet = S.state.sheet;
    const photos = S.state.photos || {};
    const counts = ['before', 'after', 'signoff', 'instawork']
      .map((k) => `${k} ${(photos[k] || []).length}`).join(' · ');
    const msg = [
      `Store #${S.state.storeNumber || '—'} · ${S.state.workDate || '—'}`,
      `Lead ${S.state.leadName || S.state.profileName || '—'}`,
      `In ${S.state.checkInManager || '—'} · Out ${S.state.checkOutManager || '—'}`,
      sheet ? `Sheet ${sheet.fiscalWeek || ''} ${sheet.summary?.marked || 0}/${sheet.summary?.total || 0}` : 'No hosted sheet',
      `Photos: ${counts}`,
      S.state.signatureDataUrl ? 'Lead signature on file' : 'No lead signature',
    ].join('\n');
    if (global.showAlert) global.showAlert('Visit', msg);
    else alert(msg);
  }

  function init() {
    document.querySelectorAll('[data-nav]').forEach((btn) => {
      btn.addEventListener('click', () => {
        global.EodRouter.go(btn.getAttribute('data-nav'));
      });
    });
    document.body.classList.remove('nav-collapsed');
    try { localStorage.removeItem('eod-nav-collapsed'); } catch (_) {}

    document.getElementById('chromeStore')?.addEventListener('click', openQuickView);
    document.getElementById('chromeMeta')?.addEventListener('click', openQuickView);
    const storeEl = document.getElementById('chromeStore');
    if (storeEl) storeEl.title = 'Tap for visit snapshot';
    document.getElementById('pilotBannerLabel')?.addEventListener('click', (e) => {
      if (e.metaKey || e.ctrlKey) return;
    });

    global.EodPhotoPipeline?.onChange?.(() => {
      try { refresh(); } catch (_) {}
    });
    global.EodSession?.on(() => refresh());
    refresh();
  }

  global.EodChrome = { refresh, init, openQuickView };
})(typeof window !== 'undefined' ? window : globalThis);
