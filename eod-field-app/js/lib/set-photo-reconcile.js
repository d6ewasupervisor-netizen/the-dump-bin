/* Continuously reconcile on-device set bay photos into eod-api buffer + PROD/SI. */
(function (global) {
  'use strict';

  const FIELD_API = 'https://eod-api.the-dump-bin.com/api/field-set';
  const TICK_MS = 25_000;
  /* Was a flat 8 bays per 25s tick, so a 30-bay set needed four ticks before
     the last bay was even attempted and "safe to continue" was ~75s away on a
     good connection. A time budget drains the whole set in one tick when the
     link allows and still yields the thread when it does not. */
  const PUSH_BUDGET_MS = 20_000;
  const PUSH_HARD_CAP = 60;
  let timer = null;
  let busy = false;
  let started = false;
  let authBlocked = 0;

  function visitReady() {
    return !!(global.EodSession?.isVisitReady?.() && global.EodSession.state?.storeNumber);
  }

  function photoBytes(p) {
    return p?.photoBase64 || p?.dataUrl || p?.preview || null;
  }

  function looksLocal(raw) {
    const s = String(raw || '');
    if (!s) return false;
    if (s.startsWith('data:')) return true;
    if (s.startsWith('blob:')) return true;
    return s.length > 200 && !s.startsWith('http');
  }

  async function blobToDataUrl(blob) {
    if (!blob) return null;
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result || null);
      reader.onerror = () => reject(reader.error || new Error('read failed'));
      reader.readAsDataURL(blob);
    });
  }

  async function resolvePhotoBase64(p) {
    let raw = photoBytes(p);
    if (looksLocal(raw) && String(raw).startsWith('data:')) return raw;
    if (looksLocal(raw) && String(raw).startsWith('blob:')) {
      try {
        const resp = await fetch(raw);
        const blob = await resp.blob();
        return await blobToDataUrl(blob);
      } catch (_) { /* fall through */ }
    }
    if (p?.blobId && global.PhotoDB?.getBlob) {
      try {
        const blob = await global.PhotoDB.getBlob(p.blobId);
        const dataUrl = await blobToDataUrl(blob);
        if (dataUrl) return dataUrl;
      } catch (_) { /* ignore */ }
    }
    if (p?.file instanceof Blob) {
      try { return await blobToDataUrl(p.file); } catch (_) { /* ignore */ }
    }
    if (looksLocal(raw) && !String(raw).startsWith('http')) return raw;
    return null;
  }

  async function collectDevicePhotos() {
    const S = global.EodSession;
    if (!S?.state?.storeNumber) return [];
    const store = S.state.storeNumber;
    const week = S.state.fiscalWeek || S.state.sheet?.fiscalWeek || null;
    const out = [];
    const seen = new Set();

    const push = async (dbkey, slot, p) => {
      const bay = Number(p?.bay);
      const key = `${dbkey}:${slot}:${bay}`;
      if (!dbkey || !bay || seen.has(key)) return;
      // Include locals even when uploadStatus looks done — inventory decides gaps.
      if (p?.offloaded && !photoBytes(p) && !p.blobId && !(p.file instanceof Blob)) return;
      const photoBase64 = await resolvePhotoBase64(p);
      if (!photoBase64) return;
      seen.add(key);
      const warm = global.EodStoreProdWarm?.peekStatus?.(dbkey) || null;
      out.push({
        dbkey,
        slot,
        bay,
        checksum: p.checksum || null,
        photoBase64,
        fileName: p.fileName || `${slot}-${bay}.jpg`,
        visitId: p.visitId || warm?.prod?.visitId || S.state.selectedShift?.visitId || null,
        resetId: p.resetId || warm?.prod?.resetId || null,
        taskId: p.taskId || warm?.si?.taskId || null,
        rowId: p.rowId || null,
        expectedBayCount: Number(warm?.expectedBayCount)
          || Number(warm?.si?.sectionCount)
          || null,
      });
    };

    try {
      const sets = global.EodSetBeforeStore?.listSets?.(store, week) || [];
      for (const set of sets) {
        const dbkey = String(set.dbkey || '').replace(/\D/g, '').replace(/^0+/, '');
        for (const p of set.after || []) await push(dbkey, 'after', p);
        for (const p of set.before || []) await push(dbkey, 'before', p);
      }
    } catch (_) { /* ignore */ }

    try {
      const jobs = global.EodPhotoPipeline?.listJobs?.() || [];
      for (const job of jobs) {
        if (job.kind !== 'set') continue;
        if (job.status === 'superseded') continue;
        if (!job.dataUrl && !job.file && !job.blobId) continue;
        await push(String(job.dbkey || '').replace(/\D/g, '').replace(/^0+/, ''), job.slot || 'after', {
          bay: job.bay,
          photoBase64: job.dataUrl,
          dataUrl: job.dataUrl,
          file: job.file,
          blobId: job.blobId,
          checksum: job.checksum,
          visitId: job.visitId,
          resetId: job.resetId,
          taskId: job.taskId,
          rowId: job.rowId,
          fileName: job.fileName,
        });
      }
    } catch (_) { /* ignore */ }

    return out;
  }

  async function pushOne(item) {
    const S = global.EodSession;
    const headers = global.EodApi.dayConfirmHeaders({
      'Content-Type': 'application/json',
      Prefer: 'respond-async',
      'Idempotency-Key': `device-reconcile:${S.state.storeNumber}:${S.state.workDate}:${item.dbkey}:${item.slot}:${item.bay}:${String(item.checksum || item.photoBase64 || '').slice(0, 24)}`,
    });
    const body = {
      storeNumber: S.state.storeNumber,
      workDate: S.state.workDate,
      dbkey: item.dbkey,
      slot: item.slot,
      bay: item.bay,
      photoBase64: item.photoBase64,
      filename: item.fileName,
      visitId: item.visitId || S.state.selectedShift?.visitId || null,
      resetId: item.resetId || null,
      taskId: item.taskId || null,
      rowId: item.rowId || null,
      expectedBayCount: item.expectedBayCount || null,
      skipSi: item.slot === 'before',
    };
    const resp = await global.authFetch(`${FIELD_API}/reconcile/push`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      skipBusy: true,
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok && !data.accepted) {
      throw new Error(data.error || `reconcile push failed (${resp.status})`);
    }
    return data;
  }

  async function tick() {
    if (busy || !visitReady() || !global.authFetch || !global.EodApi?.dayConfirmHeaders) return;
    busy = true;
    try {
      try { await global.EodDevicePhotoFlush?.flushCurrentStore?.(); } catch (_) { /* ignore */ }

      const photos = await collectDevicePhotos();
      if (!photos.length) return;

      const S = global.EodSession;
      const invResp = await global.authFetch(`${FIELD_API}/reconcile/inventory`, {
        method: 'POST',
        headers: global.EodApi.dayConfirmHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          storeNumber: S.state.storeNumber,
          workDate: S.state.workDate,
          visitId: S.state.selectedShift?.visitId || null,
          photos: photos.map((p) => ({
            dbkey: p.dbkey,
            slot: p.slot,
            bay: p.bay,
            checksum: p.checksum || null,
          })),
        }),
        skipBusy: true,
      });
      const inv = invResp.ok ? await invResp.json().catch(() => ({})) : {};
      const pull = Array.isArray(inv.pull) ? inv.pull : photos.map((p) => ({
        dbkey: p.dbkey,
        slot: p.slot,
        bay: p.bay,
      }));
      const closedDbkeys = new Set(Array.isArray(inv.closedDbkeys) ? inv.closedDbkeys : []);
      const want = new Set(pull.map((p) => `${p.dbkey}:${p.slot}:${p.bay}`));

      // Track which bays we confirm buffered this tick.
      const bufferedThisTick = new Map(); // dbkey -> Set of 'slot:bay' strings
      const deadline = Date.now() + PUSH_BUDGET_MS;
      let n = 0;
      let skippedForAuth = 0;
      for (const item of photos) {
        if (n >= PUSH_HARD_CAP || Date.now() > deadline) break;
        if (!want.has(`${item.dbkey}:${item.slot}:${item.bay}`)) continue;
        /* Use the cached gate. The blocking one re-fetches auth status on a
           30s ceiling, and its .catch turned any slow or failed check into
           "not connected" - which skipped every after bay on the device, on
           every tick, for as long as the endpoint was unhappy. */
        const gateFn = global.EodSasUser?.requireConnectedFast
          || global.EodSasUser?.requireConnected;
        if (item.slot === 'after' && gateFn) {
          const gate = await gateFn.call(global.EodSasUser, { slot: 'after' })
            .catch(() => ({ ok: false }));
          if (!gate?.ok) {
            skippedForAuth += 1;
            continue;
          }
        }
        try {
          const ack = await pushOne(item);
          n += 1;
          // Buffer ack received — offload device bytes for this bay.
          if (ack && ack.bufferedId) {
            try {
              global.EodPhotoPipeline?.offloadBufferedBay?.(item.dbkey, item.slot, item.bay, ack);
            } catch (_) { /* best-effort */ }
            if (!bufferedThisTick.has(item.dbkey)) bufferedThisTick.set(item.dbkey, new Set());
            bufferedThisTick.get(item.dbkey).add(`${item.slot}:${item.bay}`);
          }
        } catch (_) { /* next tick retries */ }
      }

      /* Bays held back because the reporting login lapsed used to vanish with
         no trace, on every tick, for the rest of the shift. */
      authBlocked = skippedForAuth;
      if (skippedForAuth) {
        console.warn('[reconcile] %d after bay(s) waiting on reporting login', skippedForAuth);
      }

      /* Evaluate whenever the inventory answered, not only when this tick
         pushed something. A set whose bays were all buffered on an earlier
         tick produces n === 0, and gating on that meant reopening the card
         could never announce it safe - the message simply never arrived. */
      if (invResp.ok || n > 0 || closedDbkeys.size > 0) {
        const allKept = new Set([...(inv.kept || []).map((k) => `${k.dbkey}:${k.slot}:${k.bay}`)]);
        const safeDbkeys = new Set();
        for (const photo of photos) {
          if (photo.slot !== 'after') continue;
          const dk = photo.dbkey;
          if (closedDbkeys.has(dk)) { safeDbkeys.add(dk); continue; }
          // All after bays for this set either already kept or just buffered.
          const setAfters = photos.filter((p) => p.slot === 'after' && p.dbkey === dk);
          const allDone = setAfters.every((p) => {
            const k = `${p.dbkey}:${p.slot}:${p.bay}`;
            return allKept.has(k) || (bufferedThisTick.get(p.dbkey) || new Set()).has(`${p.slot}:${p.bay}`);
          });
          if (allDone && setAfters.length > 0) safeDbkeys.add(dk);
        }
        for (const dk of safeDbkeys) {
          try { global.EodSetPhotoReconcile?.notifySetSafe?.(dk); } catch (_) { /* ignore */ }
        }
        try { global.EodPhotoPipeline?.schedulePump?.(); } catch (_) { /* ignore */ }
      }
    } finally {
      busy = false;
    }
  }

  function start() {
    if (started) return;
    started = true;
    const run = () => { void tick(); };
    timer = setInterval(run, TICK_MS);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') run();
    });
    window.addEventListener('online', run);
    setTimeout(run, 4_000);
  }

  // Listeners for "all bays for this set are safely buffered on server".
  const setListeners = new Map(); // dbkey -> Set<fn>

  function onSetSafe(dbkey, fn) {
    const key = String(dbkey || '');
    if (!setListeners.has(key)) setListeners.set(key, new Set());
    setListeners.get(key).add(fn);
    return () => { const s = setListeners.get(key); if (s) s.delete(fn); };
  }

  function notifySetSafe(dbkey) {
    const key = String(dbkey || '');
    const fns = setListeners.get(key);
    if (fns) for (const fn of fns) { try { fn(key); } catch (_) { /* ignore */ } }
    // Also broadcast to any wildcard listeners (key '').
    const wildcards = setListeners.get('');
    if (wildcards) for (const fn of wildcards) { try { fn(key); } catch (_) { /* ignore */ } }
  }

  global.EodSetPhotoReconcile = {
    start,
    tick,
    collectDevicePhotos,
    onSetSafe,
    notifySetSafe,
    authBlockedCount: () => authBlocked,
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})(typeof window !== 'undefined' ? window : globalThis);
