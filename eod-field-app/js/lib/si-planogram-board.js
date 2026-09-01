/* Live SI planogram board — click details, scale-to-fill shelves, Kroger thumbs. */
(function (global) {
  'use strict';

  const API = 'https://eod-api.the-dump-bin.com/api/field-set';
  const IMAGE_CONCURRENCY = 6;
  const UNIT_W = 72;
  const UNIT_H = 136;
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

  function digits(raw) {
    return String(raw || '').replace(/\D/g, '');
  }

  function upcMatch(a, b) {
    const da = digits(a);
    const db = digits(b);
    if (!da || !db) return false;
    if (da === db) return true;
    const sa = da.replace(/^0+/, '') || '0';
    const sb = db.replace(/^0+/, '') || '0';
    return sa === sb || da.endsWith(sb) || db.endsWith(sa);
  }

  function facingW(it) {
    return Math.max(1, Number(it.h) || 1) * UNIT_W;
  }

  function shelfSpan(items) {
    return (items || []).reduce((sum, it) => sum + facingW(it), 0);
  }

  function locLine(it, bay) {
    return [
      it.aisle ? `Aisle ${it.aisle}` : '',
      bay != null ? `Bay ${bay}` : '',
      it.shelf != null && it.shelf !== '' ? `Shelf ${it.shelf}` : '',
      it.position != null && it.position !== '' ? `Position ${it.position}` : '',
    ].filter(Boolean).join(' · ');
  }

  function scaleShelf(items, maxW) {
    const used = shelfSpan(items) || UNIT_W;
    const scale = maxW / used;
    let left = maxW;
    return (items || []).map((it, i) => {
      const last = i === items.length - 1;
      const w = last ? Math.max(1, left) : Math.max(1, Math.round(facingW(it) * scale));
      left -= w;
      return { it, w, h: Math.max(1, Math.round(UNIT_H * scale)), scale };
    });
  }

  function itemHtml(it, bay, highlightUpc, box) {
    const st = it.status ? ` st-${esc(it.status)}` : '';
    const hit = highlightUpc && upcMatch(it.upc, highlightUpc) ? ' is-hit' : '';
    const loc = locLine(it, bay);
    return `<article class="si-pog-item${st}${hit}" style="width:${box.w}px;height:${box.h}px" role="button" tabindex="0"
      data-name="${esc(it.name || '')}"
      data-upc="${esc(it.upc || '')}"
      data-brand="${esc(it.brand || '')}"
      data-size="${esc(it.size || '')}"
      data-status="${esc(it.status || '')}"
      data-shelf="${esc(it.shelf)}"
      data-position="${esc(it.position)}"
      data-bay="${esc(bay)}"
      data-aisle="${esc(it.aisle || '')}"
      data-loc="${esc(loc)}"
      data-image="${esc(it.imageUrl || '')}">
      <div class="si-pog-thumb">${it.imageUrl ? `<img alt="" data-pog-src="${esc(it.imageUrl)}">` : ''}</div>
      <div class="si-pog-meta">
        <div class="si-pog-name">${esc(it.name || '')}</div>
        <div class="si-pog-loc">${esc(loc)}</div>
        <div class="si-pog-cap">${it.upc ? `UPC ${esc(it.upc)}` : ''}</div>
      </div>
    </article>`;
  }

  function shelfHtml(shelf, bay, maxW, highlightUpc) {
    const boxes = scaleShelf(shelf.items || [], maxW);
    const cells = boxes.map((box) => itemHtml(box.it, bay, highlightUpc, box)).join('');
    return `<div class="si-pog-shelf">
      <div class="si-pog-shelf-label">${esc(shelf.shelf)}</div>
      <div class="si-pog-slots" style="width:${maxW}px">${cells}</div>
    </div>`;
  }

  function bayHtml(bay, highlightUpc, aisle) {
    const shelves = (bay.shelves || []).map((sh) => ({
      ...sh,
      items: (sh.items || []).map((it) => ({ ...it, aisle: it.aisle || aisle || '' })),
    }));
    const maxW = Math.max(UNIT_W, ...shelves.map((sh) => shelfSpan(sh.items)));
    return `<section class="si-pog-bay">
      <div class="si-pog-bay-h">Bay ${esc(bay.bay)}</div>
      ${shelves.map((sh) => shelfHtml(sh, bay.bay, maxW, highlightUpc)).join('')}
    </section>`;
  }

  function boardHtml(pog, highlightUpc) {
    const s = pog.stats || {};
    const bits = [
      s.facings != null ? `${s.facings} facings` : '',
      s.products != null ? `${s.products} products` : '',
    ].filter(Boolean);
    return `<section class="si-pog si-pog-overlay-board">
      <p class="muted">${esc(bits.join(' · '))}${pog.date ? ` · ${esc(pog.date)}` : ''}</p>
      <div class="si-pog-scroll">${(pog.bays || []).map((bay) => `<div class="si-pog-bay-frame">${bayHtml(bay, highlightUpc, pog.aisle)}</div>`).join('')}</div>
    </section>`;
  }

  function absUrl(path) {
    const fromCache = Media()?.absApiUrl?.(path);
    if (fromCache) return fromCache;
    const s = String(path || '').trim();
    if (!s || /^data:|^blob:/i.test(s)) return '';
    if (s.startsWith('/api/')) {
      const base = String(global.EOD_API_BASE || 'https://eod-api.the-dump-bin.com').replace(/\/+$/, '');
      return base + s;
    }
    return '';
  }

  async function hydrateImages(root) {
    if (!root) return;
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
          if (blob && blob.size) {
            img.src = URL.createObjectURL(blob);
            img.removeAttribute('data-pog-src');
            return;
          }
        }
        const resp = await global.authFetch(abs, { skipBusy: true });
        if (!resp.ok) return;
        const copy = resp.clone();
        await cachePut(abs, copy);
        const blob = await resp.blob();
        if (!blob || !blob.size) return;
        img.src = URL.createObjectURL(blob);
        img.removeAttribute('data-pog-src');
      } catch (_) { /* leave empty cell */ }
    });
  }

  async function fetchBoard({ store, date, dbkey }) {
    const key = boardKey({ store, date, dbkey });
    if (boardMem.has(key)) return boardMem.get(key);
    const pending = (async () => {
      const qs = new URLSearchParams({ store, date, dbkey });
      const url = `${API}/planogram?${qs}`;
      const resp = await global.authFetch(url, { skipBusy: true });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(data.error || `Planogram failed (${resp.status})`);
      return data.planogram || null;
    })();
    boardMem.set(key, pending);
    try {
      const pog = await pending;
      boardMem.set(key, pog);
      return pog;
    } catch (err) {
      boardMem.delete(key);
      throw err;
    }
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

  function closeItemDetail() {
    document.getElementById('eodPogItemOverlay')?.remove();
  }

  function openItemDetail(el, setTitle) {
    closeItemDetail();
    const name = el.getAttribute('data-name') || '';
    const upc = el.getAttribute('data-upc') || '';
    const brand = el.getAttribute('data-brand') || '';
    const size = el.getAttribute('data-size') || '';
    const status = el.getAttribute('data-status') || '';
    const image = el.getAttribute('data-image') || '';
    const loc = el.getAttribute('data-loc') || locLine({
      aisle: el.getAttribute('data-aisle') || '',
      shelf: el.getAttribute('data-shelf'),
      position: el.getAttribute('data-position'),
    }, el.getAttribute('data-bay'));
    const imgEl = el.querySelector('img');
    const liveSrc = imgEl && imgEl.src && !imgEl.hasAttribute('data-pog-src') ? imgEl.src : '';
    const host = document.createElement('div');
    host.id = 'eodPogItemOverlay';
    host.className = 'eod-pog-item-overlay';
    host.innerHTML = `<div class="eod-pog-item-sheet">
      <div class="eod-pog-item-bar">
        <button type="button" class="btn btn-secondary" id="eodPogItemClose">Close</button>
      </div>
      <div class="eod-pog-item-hero">${image || liveSrc ? `<img alt="" ${liveSrc ? `src="${esc(liveSrc)}"` : `data-pog-src="${esc(image)}"`}>` : ''}</div>
      <div class="eod-pog-item-copy">
        <div class="eod-pog-item-set">${esc(setTitle || '')}</div>
        <strong>${esc(name)}</strong>
        ${upc ? `<div>UPC ${esc(upc)}</div>` : ''}
        <div>${esc(loc)}</div>
        ${brand ? `<div>${esc(brand)}</div>` : ''}
        ${size ? `<div>${esc(size)}</div>` : ''}
        ${status ? `<div>${esc(status)}</div>` : ''}
      </div>
    </div>`;
    const layer = el.closest('.set-media-overlay') || document.body;
    layer.appendChild(host);
    host.querySelector('#eodPogItemClose').onclick = (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      closeItemDetail();
    };
    host.addEventListener('click', (ev) => {
      if (ev.target === host) closeItemDetail();
    });
    if (!liveSrc) hydrateImages(host);
  }

  function fitBays(root) {
    const scroll = root.querySelector('.si-pog-scroll');
    if (!scroll) return;
    const overlay = root.closest('.set-media-overlay');
    const bar = overlay?.querySelector('.set-media-overlay-bar');
    const pad = 24;
    const availW = Math.max(160, (overlay || scroll).clientWidth - pad * 2);
    const availH = Math.max(160, overlay
      ? overlay.clientHeight - (bar?.offsetHeight || 52) - pad * 2
      : scroll.clientHeight || 360);
    scroll.querySelectorAll('.si-pog-bay-frame').forEach((frame) => {
      const bay = frame.querySelector('.si-pog-bay');
      if (!bay) return;
      bay.style.transform = 'none';
      bay.style.width = '';
      const nw = Math.max(1, bay.scrollWidth);
      const nh = Math.max(1, bay.scrollHeight);
      const scale = Math.max(0.32, Math.min(availW / nw, availH / nh, 2.6));
      frame.style.width = `${Math.round(nw * scale)}px`;
      frame.style.height = `${Math.round(nh * scale)}px`;
      bay.style.transformOrigin = 'top left';
      bay.style.transform = `scale(${scale})`;
      bay.style.width = `${nw}px`;
    });
  }

  function bindItems(root, pog) {
    const title = pog?.title || '';
    const openFrom = (el) => {
      if (!el) return;
      openItemDetail(el, title);
    };
    if (root._pogClick) root.removeEventListener('click', root._pogClick);
    root._pogClick = (ev) => {
      const el = ev.target.closest('.si-pog-item');
      if (!el || !root.contains(el)) return;
      ev.preventDefault();
      ev.stopPropagation();
      openFrom(el);
    };
    root.addEventListener('click', root._pogClick);
    root.querySelectorAll('.si-pog-item').forEach((el) => {
      el.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter' || ev.key === ' ') {
          ev.preventDefault();
          openFrom(el);
        }
      });
    });
    const hit = root.querySelector('.si-pog-item.is-hit');
    if (hit) hit.scrollIntoView({ block: 'center', inline: 'nearest' });
  }

  async function loadAndRender(mount, { store, date, dbkey, highlightUpc }) {
    if (!mount) return;
    mount.innerHTML = `<section class="si-pog"><p class="muted">Loading…</p></section>`;
    try {
      const pog = await fetchBoard({ store, date, dbkey });
      if (!pog?.bays?.length) {
        mount.innerHTML = `<section class="si-pog"><p class="muted">None for this set.</p></section>`;
        return;
      }
      mount.innerHTML = boardHtml(pog, highlightUpc);
      bindItems(mount, pog);
      fitBays(mount);
      const overlay = mount.closest('.set-media-overlay');
      if (overlay && typeof ResizeObserver === 'function' && !overlay._pogFitObs) {
        overlay._pogFitObs = new ResizeObserver(() => fitBays(mount));
        overlay._pogFitObs.observe(overlay);
      }
      await hydrateImages(mount);
      fitBays(mount);
    } catch (err) {
      mount.innerHTML = `<section class="si-pog"><p class="muted">${esc(err.message || String(err))}</p></section>`;
    }
  }

  function closeOverlay() {
    closeItemDetail();
    document.getElementById('eodSetMediaOverlay')?.remove();
    document.body.classList.remove('set-media-open');
  }

  function openOverlay({ store, date, dbkey, title, highlightUpc }) {
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
    loadAndRender(host.querySelector('#setMediaOverlayBody'), { store, date, dbkey, highlightUpc });
    return host;
  }

  global.EodSiPlanogram = {
    loadAndRender,
    prefetch,
    fetchBoard,
    openOverlay,
    closeOverlay,
    hydrateImages,
    openItemDetail,
  };
})(typeof window !== 'undefined' ? window : globalThis);
