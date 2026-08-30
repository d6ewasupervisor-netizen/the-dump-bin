/* Live SI planogram board — dedicated viewer + background prefetch (no CSV). */
(function (global) {
  'use strict';

  const API = 'https://eod-api.the-dump-bin.com/api/field-set';
  const IMAGE_CONCURRENCY = 6;
  const boardMem = new Map();

  function esc(s) {
    return global.EodApi.escapeHtml(s);
  }

  function boardKey({ store, date, dbkey }) {
    return `${store || ''}|${date || ''}|${dbkey || ''}`;
  }

  function Media() {
    return global.EodSetMediaCache;
  }

  async function cacheMatch(url) {
    try { return await Media()?.match?.(url) || null; } catch (_) { return null; }
  }

  async function cachePut(url, resp) {
    try { await Media()?.put?.(url, resp); } catch (_) { /* quota */ }
  }

  async function mapPool(items, limit, fn) {
    let i = 0;
    const n = Math.max(1, limit);
    await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
      while (i < items.length) {
        const idx = i;
        i += 1;
        await fn(items[idx], idx);
      }
    }));
  }

  function itemTitle(it) {
    return [
      it.name || '',
      it.upc ? `UPC ${it.upc}` : '',
      it.onShelfPosition || '',
      it.brand || '',
      it.size || '',
    ].filter(Boolean).join('\n');
  }

  function itemHtml(it) {
    const st = it.status ? ` st-${esc(it.status)}` : '';
    const col = Number.isFinite(Number(it.position)) ? ` style="grid-column:${Number(it.position)}"` : '';
    return `<article class="si-pog-item${st}"${col} title="${esc(itemTitle(it))}">
      <div class="si-pog-thumb">${it.imageUrl ? `<img alt="" data-pog-src="${esc(it.imageUrl)}">` : ''}</div>
      <div class="si-pog-cap">${esc(it.upc || it.name || '')}</div>
    </article>`;
  }

  function shelfHtml(shelf) {
    const cols = Math.max(1, Number(shelf.columns) || (shelf.items || []).length || 1);
    const cells = (shelf.items || []).map(itemHtml).join('');
    return `<div class="si-pog-shelf">
      <div class="si-pog-shelf-label">${esc(shelf.shelf)}</div>
      <div class="si-pog-slots" style="grid-template-columns:repeat(${cols}, minmax(56px,1fr))">${cells}</div>
    </div>`;
  }

  function bayHtml(bay) {
    const cols = Math.max(1, Number(bay.columns) || 1);
    const heads = Array.from({ length: cols }, (_, i) => `<div class="si-pog-colh">${i + 1}</div>`).join('');
    return `<section class="si-pog-bay">
      <div class="si-pog-bay-h">Bay ${esc(bay.bay)}</div>
      <div class="si-pog-shelf si-pog-head">
        <div class="si-pog-shelf-label"></div>
        <div class="si-pog-slots si-pog-cols" style="grid-template-columns:repeat(${cols}, minmax(56px,1fr))">${heads}</div>
      </div>
      ${(bay.shelves || []).map(shelfHtml).join('')}
    </section>`;
  }

  function boardHtml(pog) {
    const s = pog.stats || {};
    const bits = [
      s.facings != null ? `${s.facings} facings` : '',
      s.products != null ? `${s.products} products` : '',
    ].filter(Boolean);
    return `<section class="si-pog si-pog-overlay-board">
      <p class="muted">${esc(bits.join(' · '))}${pog.date ? ` · ${esc(pog.date)}` : ''}</p>
      <div class="si-pog-scroll">${(pog.bays || []).map(bayHtml).join('')}</div>
    </section>`;
  }

  function absUrl(path) {
    return Media()?.absApiUrl?.(path) || '';
  }

  async function hydrateImages(root) {
    const imgs = [...root.querySelectorAll('img[data-pog-src]')];
    await mapPool(imgs, IMAGE_CONCURRENCY, async (img) => {
      const path = img.getAttribute('data-pog-src') || '';
      if (!path) return;
      const abs = absUrl(path);
      if (!abs) return;
      try {
        const cached = await cacheMatch(abs);
        if (cached && cached.ok) {
          const blob = await cached.blob();
          img.src = URL.createObjectURL(blob);
          img.removeAttribute('data-pog-src');
          return;
        }
        const resp = await global.authFetch(abs, { skipBusy: true });
        if (!resp.ok) return;
        await cachePut(abs, resp);
        const blob = await resp.blob();
        img.src = URL.createObjectURL(blob);
        img.removeAttribute('data-pog-src');
      } catch (_) { /* leave empty cell */ }
    });
  }

  async function fetchBoard({ store, date, dbkey }) {
    const key = boardKey({ store, date, dbkey });
    if (boardMem.has(key)) return boardMem.get(key);
    const qs = new URLSearchParams({ store, date, dbkey });
    const url = `${API}/planogram?${qs}`;
    const resp = await global.authFetch(url, { skipBusy: true });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(data.error || `Planogram failed (${resp.status})`);
    const pog = data.planogram || null;
    boardMem.set(key, pog);
    return pog;
  }

  async function prefetch(opts) {
    const pog = await fetchBoard(opts);
    if (!pog?.bays?.length) return pog;
    if (opts && opts.images === false) return pog;
    const gate = await Media()?.allowPrefetch?.();
    if (gate && !gate.ok) return pog;
    const urls = [];
    for (const bay of pog.bays || []) {
      for (const shelf of bay.shelves || []) {
        for (const it of shelf.items || []) {
          const abs = absUrl(it.imageUrl);
          if (abs) urls.push(abs);
        }
      }
    }
    await mapPool(urls, IMAGE_CONCURRENCY, async (url) => {
      const again = await Media()?.allowPrefetch?.();
      if (again && !again.ok) return;
      if (await cacheMatch(url)) return;
      try {
        const resp = await global.authFetch(url, { skipBusy: true });
        if (resp.ok) await cachePut(url, resp);
      } catch (_) { /* best-effort */ }
    });
    return pog;
  }

  async function loadAndRender(mount, { store, date, dbkey }) {
    if (!mount) return;
    mount.innerHTML = `<section class="si-pog"><p class="muted">Loading…</p></section>`;
    try {
      const pog = await fetchBoard({ store, date, dbkey });
      if (!pog?.bays?.length) {
        mount.innerHTML = `<section class="si-pog"><p class="muted">None for this set.</p></section>`;
        return;
      }
      mount.innerHTML = boardHtml(pog);
      await hydrateImages(mount);
    } catch (err) {
      mount.innerHTML = `<section class="si-pog"><p class="muted">${esc(err.message || String(err))}</p></section>`;
    }
  }

  function closeOverlay() {
    document.getElementById('eodSetMediaOverlay')?.remove();
    document.body.classList.remove('set-media-open');
  }

  function openOverlay({ store, date, dbkey, title }) {
    closeOverlay();
    const host = document.createElement('div');
    host.id = 'eodSetMediaOverlay';
    host.className = 'set-media-overlay';
    host.innerHTML = `<div class="set-media-overlay-bar">
      <button type="button" class="btn btn-secondary" id="setMediaClose">Close</button>
      <strong>${esc(title || 'Planogram')}</strong>
    </div>
    <div id="setMediaOverlayBody"></div>`;
    document.body.appendChild(host);
    document.body.classList.add('set-media-open');
    host.querySelector('#setMediaClose').onclick = closeOverlay;
    loadAndRender(host.querySelector('#setMediaOverlayBody'), { store, date, dbkey });
    return host;
  }

  global.EodSiPlanogram = {
    loadAndRender,
    prefetch,
    fetchBoard,
    openOverlay,
    closeOverlay,
  };
})(typeof window !== 'undefined' ? window : globalThis);
