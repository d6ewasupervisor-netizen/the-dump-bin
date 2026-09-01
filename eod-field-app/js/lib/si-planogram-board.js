/* Live SI planogram board — click details, scale-to-fill shelves, Kroger thumbs. */
(function (global) {
  'use strict';

  const API = 'https://eod-api.the-dump-bin.com/api/field-set';
  const IMAGE_CONCURRENCY = 6;
  const TEXT_KEY = 'eod-pog-text-only';
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

  function facingUnits(it) {
    return Math.max(1, Number(it.h) || 1);
  }

  function locLine(it, bay) {
    return [
      it.aisle ? `Aisle ${it.aisle}` : '',
      bay != null ? `Bay ${bay}` : '',
      it.shelf != null && it.shelf !== '' ? `Shelf ${it.shelf}` : '',
      it.position != null && it.position !== '' ? `Position ${it.position}` : '',
    ].filter(Boolean).join(' · ');
  }

  function readTextPref() {
    try { return localStorage.getItem(TEXT_KEY) === '1'; } catch (_) { return false; }
  }

  function writeTextPref(on) {
    try { localStorage.setItem(TEXT_KEY, on ? '1' : '0'); } catch (_) { /* ignore */ }
  }

  function paintTextBtn(host) {
    const btn = host?.querySelector('#pogTextBtn');
    if (btn) btn.textContent = host.classList.contains('is-text') ? 'Photos' : 'Text';
  }

  function applyTextMode(host, on, persist) {
    if (!host) return;
    host.classList.toggle('is-text', Boolean(on));
    if (persist) writeTextPref(Boolean(on));
    paintTextBtn(host);
  }

  function itemHtml(it, bay, highlightUpc) {
    const st = it.status ? ` st-${esc(it.status)}` : '';
    const hit = highlightUpc && upcMatch(it.upc, highlightUpc) ? ' is-hit' : '';
    const loc = locLine(it, bay);
    const grow = facingUnits(it);
    const noImg = it.imageUrl ? '' : ' no-img';
    const label = it.name || it.brand || it.upc || '';
    return `<article class="si-pog-item${st}${hit}${noImg}" style="flex:${grow} 1 0" role="button" tabindex="0"
      data-name="${esc(it.name || '')}"
      data-upc="${esc(it.upc || '')}"
      data-brand="${esc(it.brand || '')}"
      data-size="${esc(it.size || '')}"
      data-shelf="${esc(it.shelf)}"
      data-position="${esc(it.position)}"
      data-bay="${esc(bay)}"
      data-aisle="${esc(it.aisle || '')}"
      data-loc="${esc(loc)}"
      data-image="${esc(it.imageUrl || '')}">
      <div class="si-pog-thumb">
        ${it.imageUrl ? `<img alt="" data-pog-src="${esc(it.imageUrl)}">` : ''}
        <div class="si-pog-fallback">${esc(label)}</div>
      </div>
      <div class="si-pog-meta">
        <div class="si-pog-name">${esc(it.name || '')}</div>
        ${it.size ? `<div class="si-pog-size">${esc(it.size)}</div>` : ''}
        <div class="si-pog-loc">${esc(loc)}</div>
        <div class="si-pog-cap">${it.upc ? `UPC ${esc(it.upc)}` : ''}</div>
      </div>
    </article>`;
  }

  function shelfHtml(shelf, bay, highlightUpc) {
    const cells = (shelf.items || []).map((it) => itemHtml(it, bay, highlightUpc)).join('');
    return `<div class="si-pog-shelf">
      <div class="si-pog-shelf-label">${esc(shelf.shelf)}</div>
      <div class="si-pog-slots">${cells}</div>
    </div>`;
  }

  function bayHtml(bay, highlightUpc, aisle) {
    const shelves = (bay.shelves || []).map((sh) => ({
      ...sh,
      items: (sh.items || []).map((it) => ({ ...it, aisle: it.aisle || aisle || '' })),
    }));
    return `<section class="si-pog-bay">
      <div class="si-pog-bay-h">Bay ${esc(bay.bay)}</div>
      <div class="si-pog-bay-shelves">${shelves.map((sh) => shelfHtml(sh, bay.bay, highlightUpc)).join('')}</div>
    </section>`;
  }

  function boardHtml(pog, highlightUpc) {
    const s = pog.stats || {};
    const bits = [
      s.facings != null ? `${s.facings} facings` : '',
      s.products != null ? `${s.products} products` : '',
    ].filter(Boolean);
    const frames = (pog.bays || []).map((bay) => (
      `<div class="si-pog-bay-frame" data-bay="${esc(bay.bay)}">${bayHtml(bay, highlightUpc, pog.aisle)}</div>`
    )).join('');
    return `<section class="si-pog si-pog-overlay-board">
      <p class="muted">${esc(bits.join(' · '))}${pog.date ? ` · ${esc(pog.date)}` : ''}</p>
      <div class="si-pog-scroll">${frames}</div>
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

  function failImage(img) {
    const item = img.closest('.si-pog-item');
    item?.classList.add('no-img');
    img.removeAttribute('data-pog-src');
    img.removeAttribute('src');
  }

  async function hydrateImages(root) {
    if (!root) return { wanted: 0, loaded: 0 };
    const imgs = [...root.querySelectorAll('img[data-pog-src]')];
    let loaded = 0;
    await mapPool(imgs, IMAGE_CONCURRENCY, async (img) => {
      const path = img.getAttribute('data-pog-src') || '';
      const abs = absUrl(path);
      if (!path || !abs) {
        failImage(img);
        return;
      }
      try {
        const cached = await cacheMatch(abs);
        if (cached && cached.ok) {
          const blob = await cached.blob();
          if (blob && blob.size) {
            img.src = URL.createObjectURL(blob);
            img.removeAttribute('data-pog-src');
            loaded += 1;
            return;
          }
        }
        const resp = await global.authFetch(abs, { skipBusy: true });
        if (!resp.ok) {
          failImage(img);
          return;
        }
        const copy = resp.clone();
        await cachePut(abs, copy);
        const blob = await resp.blob();
        if (!blob || !blob.size) {
          failImage(img);
          return;
        }
        img.src = URL.createObjectURL(blob);
        img.removeAttribute('data-pog-src');
        loaded += 1;
      } catch (_) {
        failImage(img);
      }
    });
    return { wanted: imgs.length, loaded };
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
    if (readTextPref()) return pog;
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
    const image = el.getAttribute('data-image') || '';
    const loc = el.getAttribute('data-loc') || locLine({
      aisle: el.getAttribute('data-aisle') || '',
      shelf: el.getAttribute('data-shelf'),
      position: el.getAttribute('data-position'),
    }, el.getAttribute('data-bay'));
    const imgEl = el.querySelector('.si-pog-thumb img');
    const liveSrc = imgEl && imgEl.src && !imgEl.hasAttribute('data-pog-src') ? imgEl.src : '';
    const showHero = Boolean(liveSrc) || (Boolean(image) && !el.classList.contains('no-img'));
    const host = document.createElement('div');
    host.id = 'eodPogItemOverlay';
    host.className = 'eod-pog-item-overlay';
    host.innerHTML = `<div class="eod-pog-item-sheet">
      <div class="eod-pog-item-bar">
        <button type="button" class="btn btn-secondary" id="eodPogItemClose">Close</button>
      </div>
      ${showHero ? `<div class="eod-pog-item-hero"><img alt="" ${liveSrc ? `src="${esc(liveSrc)}"` : `data-pog-src="${esc(image)}"`}></div>` : ''}
      <div class="eod-pog-item-copy">
        <div class="eod-pog-item-set">${esc(setTitle || '')}</div>
        <strong>${esc(name)}</strong>
        ${upc ? `<div>UPC ${esc(upc)}</div>` : ''}
        <div>${esc(loc)}</div>
        ${brand ? `<div>${esc(brand)}</div>` : ''}
        ${size ? `<div>${esc(size)}</div>` : ''}
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
    if (showHero && !liveSrc) hydrateImages(host);
  }

  function sizeBaySlides(scroll) {
    if (!scroll) return;
    const w = Math.max(1, scroll.clientWidth);
    const h = Math.max(1, scroll.clientHeight);
    scroll.querySelectorAll('.si-pog-bay-frame').forEach((frame) => {
      frame.style.flexBasis = `${w}px`;
      frame.style.width = `${w}px`;
      frame.style.minWidth = `${w}px`;
      frame.style.maxWidth = `${w}px`;
      frame.style.height = `${h}px`;
    });
  }

  function goToBay(scroll, bay, instant) {
    if (!scroll) return;
    const frame = [...scroll.querySelectorAll('.si-pog-bay-frame')]
      .find((el) => String(el.getAttribute('data-bay')) === String(bay));
    if (!frame) return;
    scroll._pogBay = String(bay);
    scroll.scrollTo({ left: frame.offsetLeft, behavior: instant ? 'auto' : 'smooth' });
  }

  function activeBay(scroll) {
    const frames = [...(scroll?.querySelectorAll('.si-pog-bay-frame') || [])];
    if (!frames.length) return '';
    const mid = (scroll.scrollLeft || 0) + scroll.clientWidth / 2;
    let best = frames[0];
    let bestDist = Infinity;
    frames.forEach((frame) => {
      const center = frame.offsetLeft + frame.offsetWidth / 2;
      const dist = Math.abs(center - mid);
      if (dist < bestDist) {
        best = frame;
        bestDist = dist;
      }
    });
    return best.getAttribute('data-bay') || '';
  }

  function paintBayNav(nav, scroll) {
    if (!nav || !scroll) return;
    const on = activeBay(scroll);
    nav.querySelectorAll('[data-go-bay]').forEach((btn) => {
      btn.classList.toggle('on', String(btn.getAttribute('data-go-bay')) === String(on));
    });
  }

  function bindBaySwipe(scroll, nav) {
    if (!scroll) return;
    sizeBaySlides(scroll);
    paintBayNav(nav, scroll);
    if (scroll._pogSlideObs) scroll._pogSlideObs.disconnect();
    if (typeof ResizeObserver === 'function') {
      scroll._pogSlideObs = new ResizeObserver(() => {
        const bay = scroll._pogBay || activeBay(scroll);
        sizeBaySlides(scroll);
        if (bay) goToBay(scroll, bay, true);
        paintBayNav(nav, scroll);
      });
      scroll._pogSlideObs.observe(scroll);
    }
    scroll.addEventListener('scroll', () => {
      scroll._pogBay = activeBay(scroll);
      paintBayNav(nav, scroll);
    }, { passive: true });
    nav?.addEventListener('click', (ev) => {
      const btn = ev.target.closest('[data-go-bay]');
      if (!btn) return;
      goToBay(scroll, btn.getAttribute('data-go-bay'));
    });
  }

  function applyHighlight(root, upc) {
    let first = null;
    root.querySelectorAll('.si-pog-item').forEach((el) => {
      const on = upcMatch(el.getAttribute('data-upc'), upc);
      el.classList.toggle('is-hit', on);
      if (on && !first) first = el;
    });
    return first;
  }

  function showPogNotice(host, html) {
    host.querySelector('#eodPogNotice')?.remove();
    const el = document.createElement('div');
    el.id = 'eodPogNotice';
    el.className = 'eod-pog-notice';
    el.innerHTML = `<div class="eod-pog-notice-sheet">${html}<div class="eod-pog-notice-bar"><button type="button" class="btn btn-secondary" id="eodPogNoticeClose">Close</button></div></div>`;
    host.appendChild(el);
    el.querySelector('#eodPogNoticeClose').onclick = () => el.remove();
    el.addEventListener('click', (ev) => { if (ev.target === el) el.remove(); });
    return el;
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
      const overlay = mount.closest('.si-pog-live');
      const scroll = mount.querySelector('.si-pog-scroll');
      const nav = overlay?.querySelector('#pogBayNav');
      if (nav) {
        const bays = pog.bays || [];
        nav.hidden = bays.length < 2;
        nav.innerHTML = bays.map((b) => (
          `<button type="button" class="si-pog-bay-dot" data-go-bay="${esc(b.bay)}">${esc(b.bay)}</button>`
        )).join('');
      }
      bindBaySwipe(scroll, nav);
      if (highlightUpc) {
        const hit = applyHighlight(mount, highlightUpc);
        if (hit) goToBay(scroll, hit.getAttribute('data-bay'));
      }
      if (!overlay?.classList.contains('is-text')) {
        const pics = await hydrateImages(mount);
        if (pics.wanted && !pics.loaded) applyTextMode(overlay, true, false);
      }
    } catch (err) {
      mount.innerHTML = `<section class="si-pog"><p class="muted">${esc(err.message || String(err))}</p></section>`;
    }
  }

  function closeOverlay() {
    closeItemDetail();
    document.getElementById('eodPogNotice')?.remove();
    void global.EodBarcodeScanner?.close?.();
    document.getElementById('eodSetMediaOverlay')?.remove();
    document.body.classList.remove('set-media-open');
  }

  async function scanInOverlay(host, ctx) {
    if (!global.EodBarcodeScanner?.start) return;
    host.querySelector('#eodPogNotice')?.remove();
    global.EodBarcodeScanner.start(async (upc) => {
      const mount = host.querySelector('#setMediaOverlayBody');
      const scroll = mount?.querySelector('.si-pog-scroll');
      let data = { found: false, matches: [] };
      try {
        if (global.EodCartLocate?.locate) data = await global.EodCartLocate.locate(upc);
      } catch (_) { /* treat as miss */ }
      const matches = data.matches || [];
      const here = matches.filter((m) => String(m.dbkey || '') === String(ctx.dbkey || ''));
      if (here.length) {
        const hit = applyHighlight(mount, upc);
        goToBay(scroll, here[0].bay);
        if (hit) openItemDetail(hit, ctx.title || '');
        return;
      }
      if (!matches.length) {
        showPogNotice(host, `<p class="eod-locate-miss">${esc(global.EodCartLocate?.NOT_FOUND || 'This item cannot be located at this time.')}</p>`);
        return;
      }
      const notice = showPogNotice(host, matches.map((m) => (
        `<article class="eod-locate-hit" data-dbkey="${esc(m.dbkey || '')}" data-name="${esc(m.setName || m.categoryName || '')}">
          <div class="eod-locate-copy">
            <strong>${esc(m.setName || m.categoryName || '')}</strong>
            <div>${esc(m.name || '')}</div>
            <div class="muted">UPC ${esc(m.upc || '')}</div>
            <div>${esc([
              m.aisle ? `Aisle ${m.aisle}` : '',
              m.bay != null ? `Bay ${m.bay}` : '',
              m.shelf != null ? `Shelf ${m.shelf}` : '',
              m.position != null ? `Position ${m.position}` : '',
            ].filter(Boolean).join(' · '))}</div>
          </div>
        </article>`
      )).join(''));
      notice.querySelectorAll('.eod-locate-hit').forEach((el) => {
        el.addEventListener('click', () => {
          const next = el.getAttribute('data-dbkey') || '';
          const name = el.getAttribute('data-name') || '';
          if (!next) return;
          openOverlay({
            store: ctx.store,
            date: ctx.date,
            dbkey: next,
            title: name,
            highlightUpc: upc,
          });
        });
      });
    });
  }

  function openOverlay({ store, date, dbkey, title, highlightUpc }) {
    closeOverlay();
    const host = document.createElement('div');
    host.id = 'eodSetMediaOverlay';
    host.className = 'set-media-overlay si-pog-live';
    host.innerHTML = `<div class="set-media-overlay-bar">
      <button type="button" class="btn btn-secondary" id="setMediaClose">Close</button>
      <button type="button" class="btn btn-primary" id="pogScanBtn">Scan</button>
      <button type="button" class="btn btn-secondary" id="pogTextBtn">Text</button>
      <strong>${esc(title || 'Planogram')}</strong>
    </div>
    <div id="setMediaOverlayBody" class="si-pog-live-body"></div>
    <nav class="si-pog-bay-nav" id="pogBayNav" hidden></nav>`;
    document.body.appendChild(host);
    document.body.classList.add('set-media-open');
    const ctx = { store, date, dbkey, title };
    host.querySelector('#setMediaClose').onclick = closeOverlay;
    host.querySelector('#pogScanBtn').onclick = () => { void scanInOverlay(host, ctx); };
    applyTextMode(host, readTextPref(), false);
    host.querySelector('#pogTextBtn').onclick = () => {
      const next = !host.classList.contains('is-text');
      applyTextMode(host, next, true);
      if (!next) void hydrateImages(host.querySelector('#setMediaOverlayBody'));
    };
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
    goToBay,
  };
})(typeof window !== 'undefined' ? window : globalThis);
