/* On shift connect: sync counts first, then load cart + set photos in the background. */
(function (global) {
  'use strict';

  let lastKey = '';
  let running = false;

  function cartHas(slot) {
    const Cart = global.EodVisitCart;
    if (Cart?.cartPhotos) return Cart.cartPhotos(slot).length > 0;
    const arr = (global.EodSession?.state?.photos && global.EodSession.state.photos[slot]) || [];
    return arr.length > 0;
  }

  async function pullCartSlot(slot) {
    const Cart = global.EodVisitCart;
    if (!Cart?.pullCartFromProd) return;
    if (cartHas(slot)) return;
    try {
      await Cart.pullCartFromProd(slot);
    } catch (err) {
      console.warn(`[photo-sync] cart ${slot}`, err.message || err);
    }
  }

  async function prefetchSetPhotos(sheet) {
    const rows = (sheet && sheet.rows) || [];
    const S = global.EodSession;
    const store = S?.state?.storeNumber;
    const week = S?.state?.fiscalWeek || sheet?.fiscalWeek;
    for (const row of rows) {
      if (!row?.id || !row.dbkey) continue;
      const live = row.live || {};
      const wantBefore = Number(live.prodBeforeCount) > 0;
      const wantAfter = Number(live.photoCount || live.siPhotoCount || live.prodAfterCount) > 0
        || live.siComplete || live.prodComplete;
      if (!wantBefore && !wantAfter) continue;
      try {
        const resp = await global.authFetch(
          `https://eod-api.the-dump-bin.com/api/digital-signoffs/rows/${encodeURIComponent(row.id)}/photos`,
          { skipBusy: true, noBounceOn401: true }
        );
        if (!resp.ok) continue;
        const data = await resp.json().catch(() => ({}));
        const photos = Array.isArray(data.photos) ? data.photos : [];
        const befores = photos.filter((p) => String(p.slot || '').toLowerCase() === 'before');
        if (befores.length && global.EodSetBeforeStore?.setBefores && store && week) {
          global.EodSetBeforeStore.setBefores(store, week, row.dbkey, befores);
        }
      } catch (err) {
        console.warn('[photo-sync] set', row.dbkey, err.message || err);
      }
    }
  }

  async function run(reason) {
    const S = global.EodSession;
    if (!S?.isVisitReady?.() || !S.state.selectedShift) return;
    const key = `${S.state.storeNumber}|${S.state.workDate}|${S.state.selectedShift.visitId}`;
    if (running && key === lastKey) return;
    lastKey = key;
    running = true;
    try {
      if (global.EodSignoffHome?.syncProdSi) {
        try { await global.EodSignoffHome.syncProdSi(); } catch (err) {
          console.warn('[photo-sync] counts', err.message || err);
        }
      } else if (global.EodSignoffHome?.loadSheet) {
        try { await global.EodSignoffHome.loadSheet(); } catch (_) {}
      }
      await pullCartSlot('before');
      await pullCartSlot('after');
      const sheet = S.state.sheet;
      if (sheet?.rows?.length) {
        prefetchSetPhotos(sheet).catch(() => {});
      }
      try { global.EodCoverNotes?.apply?.(S, reason || 'shift-photos'); } catch (_) {}
    } finally {
      running = false;
    }
  }

  function init() {
    if (init._bound) return;
    init._bound = true;
    const S = global.EodSession;
    if (!S?.on) return;
    S.on((_state, reason) => {
      if (reason !== 'shift' && reason !== 'shifts' && reason !== 'extra-visits') return;
      if (!S.state.selectedShift) return;
      run(reason).catch(() => {});
    });
  }

  global.EodShiftPhotoSync = { run, init };
})(typeof window !== 'undefined' ? window : globalThis);
