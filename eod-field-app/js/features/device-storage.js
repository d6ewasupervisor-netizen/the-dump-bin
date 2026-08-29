/* On-device package list — keep or remove local photos / leftovers. */
(function (global) {
  'use strict';

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

  function rowHtml(id, title, meta, actionId, actionLabel) {
    return `<div class="device-pkg-row" data-row="${esc(id)}">
      <div class="device-pkg-copy">
        <strong>${esc(title)}</strong>
        <div class="muted">${esc(meta)}</div>
      </div>
      ${actionId ? `<button type="button" class="btn btn-secondary" data-act="${esc(actionId)}" data-id="${esc(id)}">${esc(actionLabel)}</button>` : ''}
    </div>`;
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
          const meta = `${s.count} photo${s.count === 1 ? '' : 's'} · ${fmtBytes(s.bytes)} · ${sessionStatus(s, activeId)}`;
          return rowHtml(s.id, title, meta, 'session', 'Remove');
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

    mount.querySelectorAll('[data-act]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const act = btn.getAttribute('data-act');
        const id = btn.getAttribute('data-id');
        if (act === 'session') {
          if (!(await confirmRemove('Remove this package?'))) return;
          const r = await global.PhotoDB.deleteSessionById(id, { allowActive: true });
          if (r?.clearedActive && S) {
            S.patch({
              photos: { before: [], after: [], signoff: [], instawork: [] },
            }, 'device-storage');
          }
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
          global.EodPhotoPipeline.purgeSettledJobs();
          await afterChange();
        }
      });
    });

    document.getElementById('devPurgeSent')?.addEventListener('click', async () => {
      if (!(await confirmRemove('Remove all sent packages?'))) return;
      const r = await global.PhotoDB.purgeSubmitted({ keepActive: true, maxAgeMs: 0 });
      const done = global.EodPhotoPipeline?.purgeSettledJobs?.() || 0;
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

  global.EodDeviceStorage = { render, purgeInBackground };
  global.EodRouter.register('storage', render);
})(typeof window !== 'undefined' ? window : globalThis);
