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
        if (p?.failed > 0) parts.push(`${p.failed} failed`);
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
    paintFailedPhotoBanner();
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
      bar.innerHTML = `${unsent.length} unsent photo session(s) · <button type="button" class="btn btn-secondary" id="unsentOpenPhotos">Send</button>`;
      bar.querySelector('#unsentOpenPhotos')?.addEventListener('click', () => global.EodRouter.go('send'));
    } catch (_) {
      bar.hidden = true;
    }
  }

  async function paintFailedPhotoBanner() {
    let bar = document.getElementById('eodPhotoFailBanner');
    if (!bar) {
      bar = document.createElement('div');
      bar.id = 'eodPhotoFailBanner';
      bar.hidden = true;
      bar.className = 'eod-photo-fail-banner';
      const unsent = document.getElementById('eodUnsentBanner');
      if (unsent && unsent.parentNode) unsent.parentNode.insertBefore(bar, unsent.nextSibling);
      else {
        const chrome = document.getElementById('appChrome');
        if (chrome && chrome.parentNode) chrome.parentNode.insertBefore(bar, chrome.nextSibling);
        else document.querySelector('.app-shell')?.prepend(bar);
      }
    }
    try {
      const p = global.EodPhotoPipeline?.pendingCounts?.();
      const n = p?.failed || 0;
      if (!n) {
        bar.hidden = true;
        bar.innerHTML = '';
        return;
      }
      bar.hidden = false;
      bar.innerHTML = `${n} photo upload${n === 1 ? '' : 's'} failed · <button type="button" class="btn btn-secondary" id="photoFailRetry">Retry</button>`;
      bar.querySelector('#photoFailRetry')?.addEventListener('click', () => {
        const retried = global.EodPhotoPipeline?.retryFailed?.() || 0;
        if (!retried && global.EodPhotoPipeline?.retry) {
          const jobs = global.EodPhotoPipeline.listJobs?.() || [];
          jobs.filter((j) => j.status === 'failed').forEach((j) => global.EodPhotoPipeline.retry(j.id));
        }
        refresh();
      });
    } catch (_) {
      bar.hidden = true;
    }
  }

  function snapshotText() {
    const S = global.EodSession;
    const sheet = S.state.sheet;
    const photos = S.state.photos || {};
    const counts = ['before', 'after', 'signoff', 'instawork']
      .map((k) => `${k} ${(photos[k] || []).length}`).join(' · ');
    return [
      `Store #${S.state.storeNumber || '—'} · ${S.state.workDate || '—'}`,
      `Lead ${S.resolvedLeadName?.() || S.state.leadName || S.state.profileName || '—'}`,
      `In ${S.state.checkInManager || '—'} · Out ${S.state.checkOutManager || '—'}`,
      sheet ? `Sheet ${sheet.fiscalWeek || ''} ${sheet.summary?.marked || 0}/${sheet.summary?.total || 0}` : 'No hosted sheet',
      `Photos: ${counts}`,
      S.state.signatureDataUrl ? 'Lead signature on file' : 'No lead signature',
    ].join('\n');
  }

  function openQuickView() {
    const S = global.EodSession;
    if (!S) return;
    const miss = global.EodSendGates?.missing?.(S) || [];
    const esc = global.EodApi?.escapeHtml || ((s) => String(s ?? ''));
    let host = document.getElementById('eodChromeGates');
    if (!host) {
      host = document.createElement('div');
      host.id = 'eodChromeGates';
      host.className = 'modal-overlay show';
      document.body.appendChild(host);
      host.addEventListener('click', (e) => { if (e.target === host) host.remove(); });
    } else {
      host.classList.add('show');
      host.style.display = '';
    }
    host.innerHTML = `<div class="modal-dialog">
      <h2>${miss.length ? 'Still needed' : 'Visit'}</h2>
      ${miss.length && global.EodSendGates?.listHtml ? global.EodSendGates.listHtml(S, esc) : ''}
      <pre class="muted" style="white-space:pre-wrap;font-size:13px;">${esc(snapshotText())}</pre>
      <button type="button" class="btn btn-primary btn-block" id="eodChromeGatesClose">Close</button>
    </div>`;
    try { global.EodSendGates?.bindList?.(host, S); } catch (_) {}
    host.querySelectorAll('[data-gate]').forEach((btn) => {
      btn.addEventListener('click', () => host.remove());
    });
    host.querySelector('#eodChromeGatesClose')?.addEventListener('click', () => host.remove());
  }

  function openMoreMenu() {
    let host = document.getElementById('eodMoreMenu');
    if (!host) {
      host = document.createElement('div');
      host.id = 'eodMoreMenu';
      host.className = 'modal-overlay show';
      document.body.appendChild(host);
      host.addEventListener('click', (e) => { if (e.target === host) host.remove(); });
    } else {
      host.classList.add('show');
      host.style.display = '';
    }
    host.innerHTML = `<div class="modal-dialog">
      <h2>More</h2>
      <button type="button" class="btn btn-secondary btn-block" data-more="crew">Crew</button>
      <button type="button" class="btn btn-secondary btn-block" data-more="dumpbin">Dump Bin</button>
      <button type="button" class="btn btn-secondary btn-block" data-more="helpdesk">Helpdesk</button>
      <button type="button" class="btn btn-secondary btn-block" data-more="photos">Photos</button>
      <button type="button" class="btn btn-secondary btn-block" data-more="storage">Device</button>
      <button type="button" class="btn btn-primary btn-block" id="eodMoreClose">Close</button>
    </div>`;
    host.querySelectorAll('[data-more]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const dest = btn.getAttribute('data-more');
        host.remove();
        global.EodRouter.go(dest);
      });
    });
    host.querySelector('#eodMoreClose')?.addEventListener('click', () => host.remove());
  }

  function init() {
    document.querySelectorAll('[data-nav]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const nav = btn.getAttribute('data-nav');
        if (nav === 'more') {
          openMoreMenu();
          return;
        }
        global.EodRouter.go(nav);
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
