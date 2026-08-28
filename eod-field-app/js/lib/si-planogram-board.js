/* Live SI planogram board on the set page (no CSV). */
(function (global) {
  'use strict';

  const API = 'https://eod-api.the-dump-bin.com/api/field-set';
  const API_ORIGIN = 'https://eod-api.the-dump-bin.com';
  const IMAGE_CONCURRENCY = 6;

  function esc(s) {
    return global.EodApi.escapeHtml(s);
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
    return `<section class="si-pog">
      <h2>Planogram</h2>
      <p class="muted">${esc(bits.join(' · '))}${pog.date ? ` · ${esc(pog.date)}` : ''}</p>
      <div class="si-pog-scroll">${(pog.bays || []).map(bayHtml).join('')}</div>
    </section>`;
  }

  async function hydrateImages(root) {
    const imgs = [...root.querySelectorAll('img[data-pog-src]')];
    await mapPool(imgs, IMAGE_CONCURRENCY, async (img) => {
      const path = img.getAttribute('data-pog-src') || '';
      if (!path) return;
      const abs = /^https?:/i.test(path) ? path : API_ORIGIN + path;
      try {
        const resp = await global.authFetch(abs, { skipBusy: true });
        if (!resp.ok) return;
        const blob = await resp.blob();
        img.src = URL.createObjectURL(blob);
        img.removeAttribute('data-pog-src');
      } catch (_) { /* leave empty cell */ }
    });
  }

  async function loadAndRender(mount, { store, date, dbkey }) {
    if (!mount) return;
    mount.innerHTML = `<section class="si-pog"><h2>Planogram</h2><p class="muted">Loading…</p></section>`;
    try {
      const qs = new URLSearchParams({ store, date, dbkey });
      const resp = await global.authFetch(`${API}/planogram?${qs}`, { skipBusy: true });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(data.error || `Planogram failed (${resp.status})`);
      const pog = data.planogram;
      if (!pog?.bays?.length) {
        mount.innerHTML = `<section class="si-pog"><h2>Planogram</h2><p class="muted">None for this set.</p></section>`;
        return;
      }
      mount.innerHTML = boardHtml(pog);
      await hydrateImages(mount);
    } catch (err) {
      mount.innerHTML = `<section class="si-pog"><h2>Planogram</h2><p class="muted">${esc(err.message || String(err))}</p></section>`;
    }
  }

  global.EodSiPlanogram = { loadAndRender };
})(typeof window !== 'undefined' ? window : globalThis);
