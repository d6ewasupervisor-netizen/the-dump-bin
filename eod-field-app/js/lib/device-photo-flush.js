/* Push already-on-device set photos into the upload pipeline. Greens are captured. */
(function (global) {
  'use strict';

  let openPersister = null;
  let flushBusy = false;

  function setOpenPersister(fn) {
    openPersister = typeof fn === 'function' ? fn : null;
  }

  function persistOpen() {
    try { openPersister?.(); } catch (_) {}
  }

  function photoBytes(p) {
    return p?.photoBase64 || p?.dataUrl || p?.preview || null;
  }

  function alreadyOnServer(status) {
    return /^(done|uploaded|ok|accepted)\b/i.test(String(status || ''));
  }

  function remoteBays(status, slot) {
    const live = new Set();
    const add = (list) => {
      for (const p of Array.isArray(list) ? list : []) {
        const n = Number(p.bay);
        if (Number.isFinite(n) && n > 0) live.add(n);
      }
    };
    const remote = status?.remotePhotos || {};
    if (String(slot) === 'before') add(remote.prodBefore);
    else {
      add(remote.prodAfter);
      add(remote.si);
    }
    if (live.size) return live;
    return new Set(
      (status?.bays || [])
        .filter((b) => {
          if (String(slot) === 'before') return !!b.hasProdBefore;
          return !!(b.hasSiPhoto || b.hasProdAfter || b.hasPhoto);
        })
        .map((b) => Number(b.bay))
        .filter((n) => Number.isFinite(n) && n > 0)
    );
  }

  function isLiveJob(job) {
    if (!job) return false;
    if (job.status === 'superseded' || job.error === 'replaced') return false;
    if (job.status === 'failed' && !job.dataUrl && !job.file && !job.blob && !job.canvas && !job.bitmap) {
      return false;
    }
    return true;
  }

  async function toEnqueuePayload(p) {
    const raw = photoBytes(p);
    if (!raw) return null;
    const s = String(raw);
    if (s.startsWith('data:')) return { dataUrl: s };
    if (s.startsWith('blob:')) {
      try {
        const resp = await fetch(s);
        const blob = await resp.blob();
        if (!blob || !blob.size) return null;
        return { file: blob };
      } catch (_) {
        return null;
      }
    }
    return null;
  }

  async function flushSet(opts) {
    const pipe = global.EodPhotoPipeline;
    if (!pipe?.enqueue) return 0;
    const dbkey = String(opts?.dbkey || '').replace(/\D/g, '').replace(/^0+/, '');
    if (!dbkey) return 0;
    const status = opts.status || global.EodStoreProdWarm?.peekStatus?.(dbkey) || null;
    const existing = new Set(
      (pipe.jobsForSet?.(dbkey) || [])
        .filter(isLiveJob)
        .map((j) => `${j.slot}:${Number(j.bay)}`)
    );
    let n = 0;
    for (const slot of ['before', 'after']) {
      const live = remoteBays(status, slot);
      for (const p of opts[slot] || []) {
        const bay = Number(p.bay);
        if (!bay || live.has(bay) || existing.has(`${slot}:${bay}`)) continue;
        if (alreadyOnServer(p.uploadStatus)) continue;
        const payload = await toEnqueuePayload(p);
        if (!payload) continue;
        if (payload.dataUrl) {
          p.photoBase64 = payload.dataUrl;
          if (!p.preview || String(p.preview).startsWith('blob:')) p.preview = payload.dataUrl;
        }
        pipe.enqueue({
          kind: 'set',
          compressType: 'set',
          slot,
          bay,
          dbkey,
          rowId: opts.rowId || null,
          expectedBayCount: Number(status?.expectedBayCount)
            || Number(status?.si?.sectionCount)
            || null,
          dataUrl: payload.dataUrl || null,
          file: payload.file || null,
          fileName: p.fileName || `${slot}.jpg`,
          visitId: opts.visitId || status?.prod?.visitId || null,
          resetId: opts.resetId || status?.prod?.resetId || null,
          taskId: opts.taskId || status?.si?.taskId || null,
          skipSi: slot === 'before',
        });
        existing.add(`${slot}:${bay}`);
        n += 1;
      }
    }
    return n;
  }

  async function flushStoreWeek(store, week, extra) {
    const Store = global.EodSetBeforeStore;
    if (!Store?.listSets && !Store?.loadAll) return 0;
    const sets = Store.listSets
      ? Store.listSets(store, week)
      : (() => {
        const beforeMap = Store.loadAll(store, week) || {};
        const afterMap = Store.loadAll(store, week, 'eodSetAfters:') || {};
        const keys = new Set([...Object.keys(beforeMap), ...Object.keys(afterMap)]);
        return [...keys].map((dbkey) => ({
          dbkey,
          before: Array.isArray(beforeMap[dbkey]) ? beforeMap[dbkey] : [],
          after: Array.isArray(afterMap[dbkey]) ? afterMap[dbkey] : [],
        }));
      })();
    let n = 0;
    for (const set of sets) {
      n += await flushSet({
        ...set,
        rowId: extra?.rowId || null,
        visitId: extra?.visitId || null,
      });
    }
    return n;
  }

  async function flushCurrentStore() {
    if (flushBusy) return 0;
    persistOpen();
    const S = global.EodSession;
    const store = S?.state?.storeNumber;
    const week = S?.state?.fiscalWeek || S?.state?.sheet?.fiscalWeek || '';
    if (!store || !week) return 0;
    flushBusy = true;
    try {
      return await flushStoreWeek(store, week, {
        visitId: S.state.selectedShift?.visitId || null,
      });
    } catch (_) {
      return 0;
    } finally {
      flushBusy = false;
    }
  }

  if (typeof document !== 'undefined' && document.addEventListener) {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') persistOpen();
      else void flushCurrentStore();
    });
  }
  if (typeof window !== 'undefined' && window.addEventListener) {
    window.addEventListener('pagehide', persistOpen);
  }

  global.EodDevicePhotoFlush = {
    setOpenPersister,
    persistOpen,
    flushSet,
    flushStoreWeek,
    flushCurrentStore,
    toEnqueuePayload,
    remoteBays,
  };
})(typeof window !== 'undefined' ? window : globalThis);
