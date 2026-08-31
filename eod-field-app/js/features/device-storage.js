/* On-device package list — keep or remove local photos / leftovers. */
(function (global) {
  'use strict';

  const REVIEW_ID = 'eodUnsentReview';
  const LIGHTBOX_ID = 'eodUnsentLightbox';
  const TYPE_ORDER = ['before', 'after', 'signoff', 'instawork'];
  const TYPE_LABEL = {
    before: 'Cart before',
    after: 'Cart after',
    signoff: 'Paper sign-off',
    instawork: 'InstaWork',
  };

  function esc(s) { return (global.EodApi?.escapeHtml || ((x) => String(x ?? '')))(s); }

  function fmtBytes(n) {
    const v = Number(n) || 0;
    if (v < 1024) return `${v} B`;
    if (v < 1024 * 1024) return `${(v / 1024).toFixed(1)} KB`;
    if (v < 1024 * 1024 * 1024) return `${(v / (1024 * 1024)).toFixed(1)} MB`;
    return `${(v / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  }

  function sessionStatus(s, activeId) {
    if (activeId && s.id === activeId) return s.sentAt ? 'this visit · sent' : 'this visit';
    if (s.sentAt) return 'sent';
    if (s.emailOk && !s.hasOpenJobs) return 'submitted';
    if (s.hasOpenJobs) return 'uploading';
    if (s.hasFailedJobs) return 'failed upload';
    return 'not sent';
  }

  function typeMeta(s) {
    const parts = [];
    for (const t of TYPE_ORDER) {
      const n = s.types?.[t] || 0;
      if (n) parts.push(`${TYPE_LABEL[t] || t} ${n}`);
    }
    return parts.join(' · ');
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

  function rowHtml(id, title, meta, actionId, actionLabel, viewable) {
    const copyOpen = viewable
      ? `<button type="button" class="device-pkg-copy" data-view="${esc(id)}">`
      : '<div class="device-pkg-copy">';
    const copyClose = viewable ? '</button>' : '</div>';
    return `<div class="device-pkg-row" data-row="${esc(id)}">
      ${copyOpen}
        <strong>${esc(title)}</strong>
        <div class="muted">${esc(meta)}</div>
      ${copyClose}
      ${actionId ? `<button type="button" class="btn btn-secondary" data-act="${esc(actionId)}" data-id="${esc(id)}">${esc(actionLabel)}</button>` : ''}
    </div>`;
  }

  async function removeSession(id) {
    const S = global.EodSession;
    const r = await global.PhotoDB.deleteSessionById(id, { allowActive: true });
    if (r?.clearedActive && S) {
      S.patch({
        photos: { before: [], after: [], signoff: [], instawork: [] },
      }, 'device-storage');
      try { S.saveDraft(); } catch (_) {}
    }
    global.EodChrome?.refresh?.();
    return r;
  }

  function closeLightbox() {
    document.getElementById(LIGHTBOX_ID)?.remove();
  }

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
            const meta = [`${s.count} photo${s.count === 1 ? '' : 's'}`, typeMeta(s), fmtBytes(s.bytes)].filter(Boolean).join(' · ');
            return `<div class="device-pkg-row">
              <button type="button" class="device-pkg-copy" data-open="${esc(s.id)}">
                <strong>#${esc(s.store)} · ${esc(s.date)}</strong>
                <div class="muted">${esc(meta)}</div>
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
        await global.PhotoDB.purgeUnsentLeftovers();
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
        else {
          closeReview();
          await refreshStorageIfOpen();
        }
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

  function openUnsentReview() {
    return openPackageOverlay({ id: null });
  }

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
        <h2>Packages</h2>
        ${sessions.length ? sessions.map((s) => {
          const title = `#${s.store} · ${s.date}`;
          const bits = [typeMeta(s), `${s.count} photo${s.count === 1 ? '' : 's'}`, fmtBytes(s.bytes), sessionStatus(s, activeId)].filter(Boolean);
          return rowHtml(s.id, title, bits.join(' · '), 'session', 'Remove', true);
        }).join('') : '<p class="muted">None on this phone.</p>'}
      </div>
      ${inv.legacy ? `<div class="card">
        <h2>Old copy</h2>
        ${rowHtml('legacy', inv.legacy.label || 'Old photo copy', `${inv.legacy.count} photo${inv.legacy.count === 1 ? '' : 's'} · ${fmtBytes(inv.legacy.bytes)}`, 'legacy', 'Remove')}
      </div>` : ''}
      ${inv.quarantine ? `<div class="card">
        <h2>Unstamped</h2>
        ${rowHtml('quarantine', inv.quarantine.label || 'Unstamped', `${inv.quarantine.count} photo${inv.quarantine.count === 1 ? '' : 's'} · ${fmtBytes(inv.quarantine.bytes)}`, 'quarantine', 'Remove')}
      </div>` : ''}
      ${sheets.length ? `<div class="card">
        <h2>Sheets</h2>
        ${sheets.map((sh) => rowHtml(sh.id, `#${sh.store} · ${sh.week}`, fmtBytes(sh.bytes), 'sheet', 'Remove')).join('')}
      </div>` : ''}
      ${(pipe.done || 0) > 0 ? `<div class="card">
        <h2>Finished uploads</h2>
        ${rowHtml('pipeline', `${pipe.done} finished`, `${pipe.total || 0} jobs`, 'pipeline', 'Clear')}
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

    mount.querySelectorAll('[data-view]').forEach((btn) => {
      btn.addEventListener('click', () => openSessionReview(btn.getAttribute('data-view')));
    });

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
        if (act === 'pipeline') {
          global.EodPhotoPipeline.purgeSettledJobs({ maxAgeMs: 0 });
          await afterChange();
        }
      });
    });

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
