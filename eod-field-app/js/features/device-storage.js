/* On-device package list — richer detail, reload sessions, multi-select bulk action. */
(function (global) {
  'use strict';

  const REVIEW_ID = 'eodUnsentReview';
  const LIGHTBOX_ID = 'eodUnsentLightbox';
  const TYPE_ORDER = ['before', 'after', 'signoff', 'instawork', 'context'];
  const TYPE_LABEL = {
    before: 'Cart before',
    after: 'Cart after',
    signoff: 'Paper sign-off',
    instawork: 'InstaWork',
    context: 'Additional photos',
  };

  // Select-mode state survives re-renders (module-level closure)
  let _pkgSelectMode = false;
  let _shSelectMode = false;

  function esc(s) { return (global.EodApi?.escapeHtml || ((x) => String(x ?? '')))(s); }

  function fmtBytes(n) {
    const v = Number(n) || 0;
    if (v < 1024) return `${v} B`;
    if (v < 1024 * 1024) return `${(v / 1024).toFixed(1)} KB`;
    if (v < 1024 * 1024 * 1024) return `${(v / (1024 * 1024)).toFixed(1)} MB`;
    return `${(v / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  }

  function fmtTimestamp(ts) {
    if (!ts) return '';
    const d = new Date(ts);
    const now = new Date();
    if (d.toDateString() === now.toDateString()) {
      return 'Today ' + d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    }
    const yest = new Date(now); yest.setDate(now.getDate() - 1);
    if (d.toDateString() === yest.toDateString()) {
      return 'Yesterday ' + d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    }
    return d.toLocaleDateString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  }

  function sessionStatus(s, activeId) {
    if (activeId && s.id === activeId) return s.sentAt ? 'this visit · sent' : 'this visit';
    if (s.sentAt) return 'sent';
    if (s.emailOk && !s.hasOpenJobs) return 'submitted';
    if (s.hasOpenJobs) return 'uploading';
    if (s.hasFailedJobs) return 'failed upload';
    return 'not sent';
  }

  const STATUS_CLS = {
    'this visit': 'dev-badge--active',
    'this visit · sent': 'dev-badge--sent',
    'sent': 'dev-badge--sent',
    'submitted': 'dev-badge--sent',
    'uploading': 'dev-badge--upload',
    'failed upload': 'dev-badge--fail',
    'not sent': 'dev-badge--unsent',
  };

  function statusBadge(s, activeId) {
    const st = sessionStatus(s, activeId);
    const cls = STATUS_CLS[st] || 'dev-badge--unsent';
    return `<span class="dev-badge ${esc(cls)}">${esc(st)}</span>`;
  }

  function typeLine(s) {
    const parts = [];
    for (const t of TYPE_ORDER) {
      const n = s.types?.[t] || 0;
      if (n) parts.push(`${TYPE_LABEL[t] || t} ${n}`);
    }
    return parts.length ? parts.join(' · ') : 'No photos';
  }

  function photoSrc(entry) {
    if (global.PhotoDB?.photoSrc) return global.PhotoDB.photoSrc(entry) || '';
    if (!entry) return '';
    if (typeof entry === 'string') return entry;
    return entry.previewUrl || entry.objectUrl || entry.dataUrl || '';
  }

  async function confirmRemove(title) {
    if (global.EodAlerts?.showDialog) {
      const id = await global.EodAlerts.showDialog({
        title,
        message: 'Removes the copy on this phone only.',
        buttons: [
          { id: 'keep', label: 'Keep' },
          { id: 'remove', label: 'Remove', primary: true },
        ],
      });
      return id === 'remove';
    }
    return window.confirm(title);
  }

  async function confirmLoad(store, date) {
    if (global.EodAlerts?.showDialog) {
      const id = await global.EodAlerts.showDialog({
        title: `Load #${store} · ${date}?`,
        message: 'Replaces current visit photos with this saved session.',
        buttons: [
          { id: 'cancel', label: 'Cancel' },
          { id: 'load', label: 'Load', primary: true },
        ],
      });
      return id === 'load';
    }
    return window.confirm(`Load session #${store} · ${date}? This replaces current visit photos.`);
  }

  async function gather() {
    const inv = await global.PhotoDB?.deviceInventory?.() || {
      pressure: {},
      activeId: null,
      sessions: [],
      legacy: null,
      quarantine: null,
    };
    let sheets = [];
    try { sheets = await global.EodGarden?.listSheetSnapshots?.() || []; } catch (_) {}
    const pipe = global.EodPhotoPipeline?.pendingCounts?.() || {};
    return { inv, sheets, pipe };
  }

  // ── Session package row ──────────────────────────────────────────────────
  function sessionRowHtml(s, activeId, selectMode) {
    const isActive = activeId && s.id === activeId;
    const hasPhotos = (s.count || 0) > 0;
    const title = `#${esc(s.store)} · ${esc(s.date)}`;
    const detail = typeLine(s);
    const size = `${s.count || 0} photo${s.count === 1 ? '' : 's'} · ${fmtBytes(s.bytes)}`;
    const saved = s.timestamp ? fmtTimestamp(s.timestamp) : '';
    const badge = statusBadge(s, activeId);

    const checkHtml = selectMode
      ? `<label class="dev-row-check" aria-label="Select"><input type="checkbox" class="dev-sel" data-sel="${esc(s.id)}" data-kind="session"></label>`
      : '';

    const loadBtn = (!isActive && hasPhotos)
      ? `<button type="button" class="btn btn-sm btn-secondary" data-act="session-load" data-id="${esc(s.id)}" data-store="${esc(s.store)}" data-date="${esc(s.date)}">Load into visit</button>`
      : '';

    return `<div class="device-pkg-row" data-row="${esc(s.id)}">
      ${checkHtml}
      <button type="button" class="device-pkg-copy" data-view="${esc(s.id)}">
        <strong>${title}</strong>
        <div class="dev-detail-line">${esc(detail)} · ${esc(size)} ${badge}</div>
        ${saved ? `<div class="dev-detail-line muted">Saved ${esc(saved)}</div>` : ''}
      </button>
      <div class="dev-row-actions">
        ${loadBtn}
        <button type="button" class="btn btn-sm btn-secondary" data-act="session" data-id="${esc(s.id)}">Remove</button>
      </div>
    </div>`;
  }

  // ── Sheet row ────────────────────────────────────────────────────────────
  function sheetRowHtml(sh, selectMode) {
    const saved = sh.savedAt ? fmtTimestamp(sh.savedAt) : '';
    const detail = [fmtBytes(sh.bytes), saved ? `Saved ${saved}` : ''].filter(Boolean).join(' · ');

    const checkHtml = selectMode
      ? `<label class="dev-row-check" aria-label="Select"><input type="checkbox" class="dev-sel" data-sel="${esc(sh.id)}" data-kind="sheet"></label>`
      : '';

    return `<div class="device-pkg-row" data-row="${esc(sh.id)}">
      ${checkHtml}
      <div class="device-pkg-copy">
        <strong>#${esc(sh.store)} · ${esc(sh.week)}</strong>
        <div class="dev-detail-line muted">${esc(detail)}</div>
      </div>
      <button type="button" class="btn btn-sm btn-secondary" data-act="sheet" data-id="${esc(sh.id)}">Remove</button>
    </div>`;
  }

  // ── Generic single-item rows (legacy, quarantine, pipeline) ─────────────
  function simpleRowHtml(id, title, meta, actionId, actionLabel) {
    return `<div class="device-pkg-row" data-row="${esc(id)}">
      <div class="device-pkg-copy">
        <strong>${esc(title)}</strong>
        <div class="dev-detail-line muted">${esc(meta)}</div>
      </div>
      ${actionId ? `<button type="button" class="btn btn-sm btn-secondary" data-act="${esc(actionId)}" data-id="${esc(id)}">${esc(actionLabel)}</button>` : ''}
    </div>`;
  }

  // ── Bulk select bar ──────────────────────────────────────────────────────
  function selectBarHtml(kind) {
    return `<div class="dev-select-bar" data-selectbar="${esc(kind)}">
      <button type="button" class="btn btn-sm btn-secondary" data-selectall="${esc(kind)}">All</button>
      <button type="button" class="btn btn-sm btn-secondary" data-selectnone="${esc(kind)}">None</button>
      <button type="button" class="btn btn-sm btn-danger" data-bulkremove="${esc(kind)}">Remove selected</button>
    </div>`;
  }

  async function removeSession(id) {
    const S = global.EodSession;
    const r = await global.PhotoDB.deleteSessionById(id, { allowActive: true });
    if (r?.clearedActive && S) {
      S.patch({
        photos: { before: [], after: [], signoff: [], instawork: [], context: [] },
      }, 'device-storage');
      try { S.saveDraft(); } catch (_) {}
    }
    global.EodChrome?.refresh?.();
    return r;
  }

  async function loadSessionIntoActive(id, store, date) {
    if (!(await confirmLoad(store, date))) return false;
    const S = global.EodSession;
    if (!S) return false;
    const rec = await global.PhotoDB?.loadSessionForView?.(id);
    if (!rec || !rec.photos) return false;
    S.patch({
      photos: {
        before: rec.photos.before || [],
        after: rec.photos.after || [],
        signoff: rec.photos.signoff || [],
        instawork: rec.photos.instawork || [],
        context: rec.photos.context || [],
      },
    }, 'device-storage');
    try { S.saveDraft(); } catch (_) {}
    global.EodChrome?.refresh?.();
    return true;
  }

  function closeLightbox() { document.getElementById(LIGHTBOX_ID)?.remove(); }

  function openLightbox(src) {
    closeLightbox();
    if (!src) return;
    const el = document.createElement('div');
    el.id = LIGHTBOX_ID;
    el.className = 'modal-overlay show unsent-lightbox';
    el.innerHTML = `<img src="${esc(src)}" alt="">`;
    el.addEventListener('click', () => closeLightbox());
    document.body.appendChild(el);
  }

  function closeReview() {
    closeLightbox();
    document.getElementById(REVIEW_ID)?.remove();
  }

  function bindReviewHost(host) {
    host.addEventListener('click', (e) => { if (e.target === host) closeReview(); });
  }

  function gridHtml(photos) {
    const items = [];
    for (const t of TYPE_ORDER) {
      const arr = photos?.[t] || [];
      if (!arr.length) continue;
      const imgs = arr.map((p) => {
        const url = photoSrc(p);
        if (!url) return '';
        return `<button type="button" class="unsent-thumb"><img src="${esc(url)}" alt="${esc(TYPE_LABEL[t] || t)}"></button>`;
      }).filter(Boolean).join('');
      if (!imgs) continue;
      items.push(`<h3 class="unsent-type">${esc(TYPE_LABEL[t] || t)} · ${arr.length}</h3><div class="photo-grid">${imgs}</div>`);
    }
    return items.join('') || '<p class="muted">No photos in this package.</p>';
  }

  async function openPackageOverlay(opts) {
    opts = opts || {};
    closeReview();
    const host = document.createElement('div');
    host.id = REVIEW_ID;
    host.className = 'modal-overlay show';
    document.body.appendChild(host);
    bindReviewHost(host);

    const startId = opts.id || null;
    const listMode = !startId;

    async function paintList() {
      const unsent = await global.PhotoDB?.unsentSessions?.() || [];
      if (!unsent.length) {
        closeReview();
        global.EodChrome?.refresh?.();
        await refreshStorageIfOpen();
        return;
      }
      host.innerHTML = `
        <div class="modal-dialog" role="dialog" aria-modal="true" aria-labelledby="unsentReviewTitle">
          <h2 id="unsentReviewTitle">Unsent photos</h2>
          ${unsent.map((s) => {
            const meta = [`${s.count} photo${s.count === 1 ? '' : 's'}`, typeLine(s), fmtBytes(s.bytes)].filter(Boolean).join(' · ');
            return `<div class="device-pkg-row">
              <button type="button" class="device-pkg-copy" data-open="${esc(s.id)}">
                <strong>#${esc(s.store)} · ${esc(s.date)}</strong>
                <div class="dev-detail-line muted">${esc(meta)}</div>
              </button>
              <button type="button" class="btn btn-danger" data-discard="${esc(s.id)}">Discard</button>
            </div>`;
          }).join('')}
          <div class="btn-row" style="margin-top:14px;">
            ${unsent.length > 1 ? '<button type="button" class="btn btn-danger" id="unsentDiscardAll">Discard all</button>' : ''}
            <button type="button" class="btn btn-secondary" id="unsentReviewClose">Close</button>
          </div>
        </div>`;
      host.querySelectorAll('[data-open]').forEach((btn) => {
        btn.addEventListener('click', () => { paintDetail(btn.getAttribute('data-open'), true); });
      });
      host.querySelectorAll('[data-discard]').forEach((btn) => {
        btn.addEventListener('click', async () => {
          if (!(await confirmRemove('Discard this package?'))) return;
          await removeSession(btn.getAttribute('data-discard'));
          await paintList();
        });
      });
      host.querySelector('#unsentDiscardAll')?.addEventListener('click', async () => {
        if (!(await confirmRemove('Discard all unsent leftovers?'))) return;
        await global.PhotoDB.purgeUnsentLeftovers({ force: true });
        global.EodChrome?.refresh?.();
        closeReview();
        await refreshStorageIfOpen();
      });
      host.querySelector('#unsentReviewClose')?.addEventListener('click', () => closeReview());
    }

    async function paintDetail(id, fromList) {
      const rec = await global.PhotoDB?.loadSessionForView?.(id);
      if (!rec) {
        if (fromList) return paintList();
        closeReview();
        return;
      }
      const meta = [
        `${rec.count} photo${rec.count === 1 ? '' : 's'}`,
        fmtBytes(rec.bytes),
        sessionStatus(rec, global.PhotoDB?.resolveActiveKey?.()?.id),
      ].filter(Boolean).join(' · ');
      host.innerHTML = `
        <div class="modal-dialog" role="dialog" aria-modal="true" aria-labelledby="unsentDetailTitle">
          <h2 id="unsentDetailTitle">#${esc(rec.store)} · ${esc(rec.date)}</h2>
          <p class="muted">${esc(meta)}</p>
          ${gridHtml(rec.photos)}
          <div class="btn-row" style="margin-top:14px;">
            <button type="button" class="btn btn-danger" id="unsentDetailDiscard">Discard</button>
            <button type="button" class="btn btn-secondary" id="unsentDetailClose">${fromList ? 'Back' : 'Close'}</button>
          </div>
        </div>`;
      host.querySelectorAll('.unsent-thumb').forEach((btn) => {
        btn.addEventListener('click', () => openLightbox(btn.querySelector('img')?.getAttribute('src')));
      });
      host.querySelector('#unsentDetailDiscard')?.addEventListener('click', async () => {
        if (!(await confirmRemove('Discard this package?'))) return;
        await removeSession(id);
        if (fromList) await paintList();
        else { closeReview(); await refreshStorageIfOpen(); }
      });
      host.querySelector('#unsentDetailClose')?.addEventListener('click', () => {
        if (fromList) paintList();
        else closeReview();
      });
    }

    if (listMode) await paintList();
    else await paintDetail(startId, false);
  }

  async function refreshStorageIfOpen() {
    const mount = document.getElementById('appMount');
    if (mount && global.EodRouter?.current === 'storage') await render(mount);
  }

  function openUnsentReview() { return openPackageOverlay({ id: null }); }
  function openSessionReview(id) {
    if (!id) return openUnsentReview();
    return openPackageOverlay({ id });
  }

  async function render(mount) {
    const S = global.EodSession;
    const { inv, sheets, pipe } = await gather();
    const p = inv.pressure || {};
    const used = p.usageBytes != null ? fmtBytes(p.usageBytes) : fmtBytes(p.totalBytes);
    const quota = p.quotaBytes != null ? fmtBytes(p.quotaBytes) : '—';
    const photoMb = fmtBytes(p.totalBytes);
    const activeId = inv.activeId;
    const sessions = inv.sessions || [];

    const pkgRows = sessions.map((s) => sessionRowHtml(s, activeId, _pkgSelectMode)).join('');
    const shRows = sheets.map((sh) => sheetRowHtml(sh, _shSelectMode)).join('');

    mount.innerHTML = `
      <div class="card">
        <h1>Device</h1>
        <p class="muted">${esc(used)} used · ${esc(quota)} quota · photos ${esc(photoMb)}</p>
        <div class="btn-row">
          <button type="button" class="btn btn-secondary" id="devPurgeSent">Remove sent</button>
          <button type="button" class="btn btn-secondary" id="devCompress">Compress</button>
        </div>
        <div id="devStorageMsg" class="muted" style="margin-top:8px;"></div>
      </div>

      <div class="card">
        <div class="dev-section-header">
          <h2>Packages</h2>
          ${sessions.length > 1
            ? `<button type="button" class="btn btn-sm btn-secondary" id="devPkgSelectToggle">${_pkgSelectMode ? 'Cancel' : 'Select'}</button>`
            : ''}
        </div>
        ${_pkgSelectMode ? selectBarHtml('session') : ''}
        ${sessions.length ? pkgRows : '<p class="muted">None on this phone.</p>'}
      </div>

      ${inv.legacy ? `<div class="card">
        <h2>Old copy</h2>
        ${simpleRowHtml('legacy', inv.legacy.label || 'Old photo copy', `${inv.legacy.count} photo${inv.legacy.count === 1 ? '' : 's'} · ${fmtBytes(inv.legacy.bytes)}`, 'legacy', 'Remove')}
      </div>` : ''}

      ${inv.quarantine ? `<div class="card">
        <h2>Unstamped</h2>
        ${simpleRowHtml('quarantine', inv.quarantine.label || 'Unstamped', `${inv.quarantine.count} photo${inv.quarantine.count === 1 ? '' : 's'} · ${fmtBytes(inv.quarantine.bytes)}`, 'quarantine', 'Remove')}
      </div>` : ''}

      ${sheets.length ? `<div class="card">
        <div class="dev-section-header">
          <h2>Sheets</h2>
          ${sheets.length > 1
            ? `<button type="button" class="btn btn-sm btn-secondary" id="devShSelectToggle">${_shSelectMode ? 'Cancel' : 'Select'}</button>`
            : ''}
        </div>
        ${_shSelectMode ? selectBarHtml('sheet') : ''}
        ${shRows}
      </div>` : ''}

      ${(pipe.failed || 0) > 0 ? `<div class="card">
        <h2>Failed uploads</h2>
        ${simpleRowHtml('pipeline-failed', `${pipe.failed} failed`, 'Tap Retry to requeue', 'pipeline-retry', 'Retry')}
      </div>` : ''}

      ${(pipe.done || 0) > 0 ? `<div class="card">
        <h2>Finished uploads</h2>
        ${simpleRowHtml('pipeline', `${pipe.done} finished`, `${(pipe.total || 0) - (pipe.superseded || 0)} jobs`, 'pipeline', 'Clear')}
      </div>` : ''}
    `;

    const msg = document.getElementById('devStorageMsg');
    const setMsg = (t) => { if (msg) msg.textContent = t || ''; };

    async function afterChange() {
      if (S?.state?.photos && global.PhotoDB?.loadActiveInto) {
        try { await global.PhotoDB.loadActiveInto(S.state.photos); } catch (_) {}
        try { S.saveDraft(); } catch (_) {}
      }
      global.EodChrome?.refresh?.();
      await render(mount);
    }

    // ── Photo review ──────────────────────────────────────────────────────
    mount.querySelectorAll('[data-view]').forEach((btn) => {
      btn.addEventListener('click', () => openSessionReview(btn.getAttribute('data-view')));
    });

    // ── Single-item actions ───────────────────────────────────────────────
    mount.querySelectorAll('[data-act]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const act = btn.getAttribute('data-act');
        const id = btn.getAttribute('data-id');

        if (act === 'session') {
          if (!(await confirmRemove('Remove this package?'))) return;
          await removeSession(id);
          await afterChange();
          return;
        }
        if (act === 'session-load') {
          const store = btn.getAttribute('data-store');
          const date = btn.getAttribute('data-date');
          if (await loadSessionIntoActive(id, store, date)) await afterChange();
          return;
        }
        if (act === 'legacy') {
          if (!(await confirmRemove('Remove old photo copy?'))) return;
          await global.PhotoDB.clearLegacyAllPhotos();
          await afterChange();
          return;
        }
        if (act === 'quarantine') {
          if (!(await confirmRemove('Remove unstamped photos?'))) return;
          await global.PhotoDB.deleteSessionById(global.PhotoDB.QUARANTINE_ID || 'quarantine:legacy', { allowActive: true });
          await afterChange();
          return;
        }
        if (act === 'sheet') {
          if (!(await confirmRemove('Remove this sheet copy?'))) return;
          await global.EodGarden.deleteSheetSnapshot(id);
          await afterChange();
          return;
        }
        if (act === 'pipeline-retry') {
          global.EodPhotoPipeline?.retryFailed?.();
          await afterChange();
          return;
        }
        if (act === 'pipeline') {
          global.EodPhotoPipeline.purgeSettledJobs({ maxAgeMs: 0 });
          await afterChange();
        }
      });
    });

    // ── Select-mode toggles ───────────────────────────────────────────────
    document.getElementById('devPkgSelectToggle')?.addEventListener('click', async () => {
      _pkgSelectMode = !_pkgSelectMode;
      await render(mount);
    });
    document.getElementById('devShSelectToggle')?.addEventListener('click', async () => {
      _shSelectMode = !_shSelectMode;
      await render(mount);
    });

    // ── Bulk select helpers ───────────────────────────────────────────────
    function selInputs(kind) {
      return [...mount.querySelectorAll(`.dev-sel[data-kind="${kind}"]`)];
    }

    mount.querySelectorAll('[data-selectall]').forEach((btn) => {
      const kind = btn.getAttribute('data-selectall');
      btn.addEventListener('click', () => selInputs(kind).forEach((cb) => { cb.checked = true; }));
    });
    mount.querySelectorAll('[data-selectnone]').forEach((btn) => {
      const kind = btn.getAttribute('data-selectnone');
      btn.addEventListener('click', () => selInputs(kind).forEach((cb) => { cb.checked = false; }));
    });

    // ── Bulk remove ───────────────────────────────────────────────────────
    mount.querySelectorAll('[data-bulkremove]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const kind = btn.getAttribute('data-bulkremove');
        const checked = selInputs(kind).filter((cb) => cb.checked);
        if (!checked.length) { setMsg('Nothing selected.'); return; }
        if (!(await confirmRemove(`Remove ${checked.length} item${checked.length === 1 ? '' : 's'}?`))) return;
        for (const cb of checked) {
          const id = cb.getAttribute('data-sel');
          if (kind === 'session') await removeSession(id);
          if (kind === 'sheet') await global.EodGarden?.deleteSheetSnapshot?.(id);
        }
        if (kind === 'session') _pkgSelectMode = false;
        if (kind === 'sheet') _shSelectMode = false;
        await afterChange();
      });
    });

    // ── Device-level actions ──────────────────────────────────────────────
    document.getElementById('devPurgeSent')?.addEventListener('click', async () => {
      if (!(await confirmRemove('Remove all sent packages?'))) return;
      const r = await global.PhotoDB.purgeSubmitted({ keepActive: true, maxAgeMs: 0 });
      const done = global.EodPhotoPipeline?.purgeSettledJobs?.({ maxAgeMs: 0 }) || 0;
      setMsg(`Removed ${r?.removed || 0} package(s), ${done} finished upload(s).`);
      await afterChange();
    });

    document.getElementById('devCompress')?.addEventListener('click', async () => {
      try {
        const r = await global.PhotoDB.compressOldPhotos({ skipActive: false });
        setMsg(`Compressed ${r?.compressed || 0} in ${r?.sessions || 0} package(s).`);
        await afterChange();
      } catch (err) {
        setMsg(err.message || String(err));
      }
    });
  }

  async function purgeInBackground() {
    try { await global.PhotoDB?.purgeOnBoot?.(); } catch (_) {}
    try { global.EodPhotoPipeline?.purgeSettledJobs?.(); } catch (_) {}
    const S = global.EodSession;
    try {
      await global.EodGarden?.purgeOldSheets?.({
        keepStore: S?.state?.storeNumber,
        keepWeek: S?.state?.fiscalWeek || S?.state?.sheet?.fiscalWeek,
      });
    } catch (_) {}
  }

  global.EodDeviceStorage = { render, purgeInBackground, openUnsentReview, openSessionReview };
  global.EodRouter.register('storage', render);
})(typeof window !== 'undefined' ? window : globalThis);
