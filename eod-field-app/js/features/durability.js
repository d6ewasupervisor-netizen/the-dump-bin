/* Durable local persistence before reload / auth refresh — avoid photo/draft loss. */
(function (global) {
  'use strict';

  const DEFAULT_TIMEOUT_MS = 8000;

  function withTimeout(promise, ms, label) {
    let timer = null;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(label || 'timeout')), ms);
    });
    return Promise.race([promise, timeout]).finally(() => {
      if (timer) clearTimeout(timer);
    });
  }

  async function awaitDurablePhotoSave(reason, opts) {
    const S = global.EodSession;
    const timeoutMs = (opts && opts.timeoutMs) || DEFAULT_TIMEOUT_MS;
    try { S?.saveDraft(); } catch (_) {}
    if (!global.PhotoDB?.savePhotos || !S?.state?.photos) return true;
    try {
      await withTimeout(
        global.PhotoDB.savePhotos(S.state.photos),
        timeoutMs,
        'photo-save-timeout'
      );
      return true;
    } catch (err) {
      console.error('[durability] photo save failed', reason, err);
      // Timeout / IDB flake: still allow Update so the phone is not stuck forever.
      // Draft was already written above; photos may already be in IndexedDB from prior saves.
      if (String(err && err.message) === 'photo-save-timeout') {
        console.warn('[durability] proceeding after photo-save timeout', reason);
        return true;
      }
      return false;
    }
  }

  function startAutosave() {
    setInterval(() => {
      try { global.EodSession?.saveDraft(); } catch (_) {}
    }, 60 * 1000);
    window.addEventListener('online', () => {
      global.EodConnections?.toast?.('Back online — local draft kept; tap refresh if SAS/SI was red.', 'ok');
      global.EodConnections?.pollConnections?.();
      try { global.EodGarden?.flushMarks?.(); } catch (_) {}
    });
    window.addEventListener('offline', () => {
      try { global.EodGarden?.persistAll?.('offline'); } catch (_) {
        try { global.EodSession?.saveDraft(); } catch (_) {}
      }
      global.EodConnections?.toast?.('Offline — edits stay on this device until connection returns.', 'error');
    });
    try { global.EodGarden?.start?.(); } catch (_) {}
  }

  global.EodDurability = { awaitDurablePhotoSave, startAutosave };
})(typeof window !== 'undefined' ? window : globalThis);
