/* Durable local persistence before reload / auth refresh — avoid photo/draft loss. */
(function (global) {
  'use strict';

  async function awaitDurablePhotoSave(reason) {
    const S = global.EodSession;
    try { S?.saveDraft(); } catch (_) {}
    if (!global.PhotoDB?.savePhotos || !S?.state?.photos) return true;
    try {
      await global.PhotoDB.savePhotos(S.state.photos);
      return true;
    } catch (err) {
      console.error('[durability] photo save failed', reason, err);
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
    });
    window.addEventListener('offline', () => {
      try { global.EodSession?.saveDraft(); } catch (_) {}
      global.EodConnections?.toast?.('Offline — edits stay on this device until connection returns.', 'error');
    });
  }

  global.EodDurability = { awaitDurablePhotoSave, startAutosave };
})(typeof window !== 'undefined' ? window : globalThis);
