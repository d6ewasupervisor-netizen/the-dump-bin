/**
 * MaterialsPdfViewer — fullscreen PDF.js viewer with page selection, search,
 * zoom/fit/rotate, pinch, annotation links, and share/print/download for
 * Dump Bin + EOD. Works as a page overlay or as /pdf/ standalone, including
 * inside an iframe (field app embed).
 *
 * window.MaterialsPdfViewer.open(options)
 */
(function (global) {
  'use strict';

  const WORKER =
    'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
  const ASSET_VER = '1.1.3';
  const ZOOM_STEPS = [0.5, 0.75, 1, 1.25, 1.5, 2, 2.5, 3, 4];
  const MSG_SOURCE = 'materials-pdf-viewer';

  let host = null;
  let cssReady = false;
  let openOpts = null;
  let pdfDoc = null;
  let pageCount = 0;
  let currentPage = 1;
  let zoom = 1;
  let fitMode = 'width'; // width | page | manual
  let rotation = 0;
  let selected = new Set();
  let renderGen = 0;
  let searchHits = []; // { page, itemIndex, str }
  let searchIdx = -1;
  let searchQuery = '';
  let searchBusy = false;
  let srcBytesCache = null;
  let touchX = null;
  let pinchDist0 = 0;
  let pinchZoom0 = 1;
  let keyHandler = null;
  let resizeTimer = null;
  let vvHandler = null;

  function inFrame() {
    try {
      return global.self !== global.top;
    } catch (_) {
      return true;
    }
  }

  function notifyHost(open) {
    const payload = {
      source: MSG_SOURCE,
      type: open ? 'open' : 'close',
      open: !!open,
      standalone: !!(openOpts && openOpts.standalone),
    };
    try {
      global.postMessage(payload, global.location.origin);
    } catch (_) { /* ignore */ }
    try {
      if (global.parent && global.parent !== global) {
        global.parent.postMessage(payload, '*');
      }
    } catch (_) { /* ignore */ }
  }

  function lockPageScroll(on) {
    const root = document.documentElement;
    const body = document.body;
    if (!root || !body) return;
    root.classList.toggle('mpv-lock', on);
    body.classList.toggle('mpv-lock', on);
  }

  function preferPdfBytesUrl(rawUrl) {
    if (!rawUrl) return rawUrl;
    try {
      const url = new URL(rawUrl, global.location.href);
      const hostName = (url.hostname || '').toLowerCase();
      if (hostName === 'github.com') {
        const m = url.pathname.match(/^\/([^/]+)\/([^/]+)\/blob\/([^/]+)\/(.*)/);
        if (m) return `https://raw.githubusercontent.com/${m[1]}/${m[2]}/${m[3]}/${m[4]}`;
      }
      if (hostName.includes('sharepoint.')) {
        if (url.searchParams.get('web') === '1') url.searchParams.delete('web');
        url.searchParams.set('download', '1');
        return url.toString();
      }
      return url.toString();
    } catch (_) {
      return rawUrl;
    }
  }

  function filenameFromUrl(url) {
    try {
      const u = new URL(url, global.location.href);
      const name = decodeURIComponent(u.pathname.split('/').pop() || '');
      if (name && /\.pdf$/i.test(name)) return name;
      const key = u.searchParams.get('key') || '';
      const fromKey = decodeURIComponent(key.split('/').pop() || '');
      if (fromKey) return fromKey;
      return name || 'document.pdf';
    } catch (_) {
      return 'document.pdf';
    }
  }

  function escapeHtml(s) {
    return String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function formatSize(n) {
    const b = Number(n) || 0;
    if (b < 1024) return `${b} B`;
    if (b < 1048576) return `${(b / 1024).toFixed(1)} KB`;
    return `${(b / 1048576).toFixed(2)} MB`;
  }

  function ensureCss() {
    if (cssReady || document.getElementById('materialsPdfViewerCss')) {
      cssReady = true;
      return;
    }
    const link = document.createElement('link');
    link.id = 'materialsPdfViewerCss';
    link.rel = 'stylesheet';
    const base = document.currentScript?.src
      ? document.currentScript.src.replace(/[^/]+$/, `materials-pdf-viewer.css?v=${ASSET_VER}`)
      : `/shared/pdf-viewer/materials-pdf-viewer.css?v=${ASSET_VER}`;
    link.href = base;
    document.head.appendChild(link);
    cssReady = true;
  }

  function ensureHost() {
    ensureCss();
    if (host) return host;
    host = document.createElement('div');
    host.id = 'materialsPdfViewerHost';
    host.className = 'mpv-root';
    host.setAttribute('role', 'dialog');
    host.setAttribute('aria-modal', 'true');
    host.innerHTML = `
      <div class="mpv-toolbar">
        <div class="mpv-toolbar__title" id="mpvTitle">Document</div>
        <div class="mpv-group" aria-label="Page navigation">
          <button type="button" class="mpv-btn" id="mpvPrev" aria-label="Previous page">‹</button>
          <input class="mpv-page-input" id="mpvPageInput" type="number" min="1" inputmode="numeric" aria-label="Page number">
          <span class="mpv-page-total" id="mpvPageTotal">/ 1</span>
          <button type="button" class="mpv-btn" id="mpvNext" aria-label="Next page">›</button>
        </div>
        <div class="mpv-toolbar__scroll">
          <div class="mpv-group mpv-toolbar__extras" aria-label="Zoom">
            <button type="button" class="mpv-btn" id="mpvZoomOut" aria-label="Zoom out">−</button>
            <span class="mpv-zoom-label" id="mpvZoomLabel">Fit</span>
            <button type="button" class="mpv-btn" id="mpvZoomIn" aria-label="Zoom in">+</button>
            <button type="button" class="mpv-btn" id="mpvFitWidth" title="Fit width">Fit</button>
            <button type="button" class="mpv-btn" id="mpvFitPage" title="Fit page">Page</button>
          </div>
          <div class="mpv-group mpv-toolbar__extras" aria-label="Rotate">
            <button type="button" class="mpv-btn" id="mpvRotL" aria-label="Rotate left" title="Rotate left">↶</button>
            <button type="button" class="mpv-btn" id="mpvRotR" aria-label="Rotate right" title="Rotate right">↷</button>
          </div>
          <div class="mpv-search mpv-toolbar__extras">
            <input type="search" id="mpvSearch" placeholder="Search" enterkeyhint="search" autocomplete="off">
            <span class="mpv-search__count" id="mpvSearchCount"></span>
            <button type="button" class="mpv-btn" id="mpvFindPrev" aria-label="Previous match" title="Previous match">▴</button>
            <button type="button" class="mpv-btn" id="mpvFindNext" aria-label="Next match" title="Next match">▾</button>
          </div>
          <button type="button" class="mpv-btn mpv-btn--ghost mpv-toolbar__extras" id="mpvThumbsToggle" title="Toggle thumbnails">Thumbs</button>
        </div>
        <button type="button" class="mpv-btn mpv-btn--ghost" id="mpvImmersive" title="More tools">Tools</button>
        <div class="mpv-toolbar__spacer"></div>
        <button type="button" class="mpv-btn mpv-btn--ghost" id="mpvClose" aria-label="Close">Close</button>
      </div>
      <div class="mpv-body">
        <aside class="mpv-thumbs" id="mpvThumbs" aria-label="Page thumbnails"></aside>
        <div class="mpv-stage" id="mpvStage">
          <div class="mpv-hud" id="mpvHud"></div>
          <div class="mpv-stage__inner" id="mpvStageInner">
            <div class="mpv-state">Opening…</div>
          </div>
          <div class="mpv-mobile-nav">
            <button type="button" class="mpv-btn" id="mpvMPrev">‹ Prev</button>
            <span id="mpvMPageLabel">1 / 1</span>
            <button type="button" class="mpv-btn" id="mpvMNext">Next ›</button>
          </div>
        </div>
      </div>
      <div class="mpv-actionbar">
        <div class="mpv-actionbar__left">
          <button type="button" class="mpv-btn mpv-btn--ghost" id="mpvSelectAll">Select all</button>
          <button type="button" class="mpv-btn mpv-btn--ghost" id="mpvSelectNone">Clear pages</button>
          <button type="button" class="mpv-btn mpv-btn--ghost" id="mpvTogglePage" title="Space">Toggle page</button>
          <span class="mpv-hint" id="mpvHint"></span>
        </div>
        <div class="mpv-actionbar__right">
          <button type="button" class="mpv-btn mpv-btn--ghost" id="mpvAddBtn">Add to selection</button>
          <button type="button" class="mpv-btn mpv-btn--ghost" id="mpvDownloadBtn">Download</button>
          <button type="button" class="mpv-btn mpv-btn--primary" id="mpvShareBtn">Share / Text</button>
          <button type="button" class="mpv-btn mpv-btn--accent" id="mpvPrintBtn">🖨 Print at Store</button>
        </div>
      </div>
    `;
    document.body.appendChild(host);
    wireHost();
    return host;
  }

  function pdfjs() {
    if (!global.pdfjsLib) throw new Error('PDF.js is not loaded');
    global.pdfjsLib.GlobalWorkerOptions.workerSrc = WORKER;
    return global.pdfjsLib;
  }

  function estimateSelectedBytes() {
    const fileSize = Number(openOpts?.fileSize) || 0;
    if (!pageCount || !selected.size) return 0;
    if (selected.size >= pageCount) return fileSize;
    return Math.max(1, Math.round((selected.size / pageCount) * fileSize));
  }

  function updateHud() {
    const hud = document.getElementById('mpvHud');
    if (!hud) return;
    const pages = selected.size;
    const bytes = estimateSelectedBytes();
    let basket = null;
    try {
      basket = typeof openOpts?.getGlobalSelection === 'function'
        ? openOpts.getGlobalSelection()
        : null;
    } catch (_) { /* ignore */ }
    const basketCount = Number(basket?.count) || 0;
    const basketBytes = Number(basket?.bytes) || 0;

    hud.innerHTML = `
      <div class="mpv-hud__card">
        <div class="mpv-hud__label">This document</div>
        <div class="mpv-hud__value">${pages} page${pages === 1 ? '' : 's'}</div>
        <div class="mpv-hud__sub">${formatSize(bytes)} selected</div>
      </div>
      ${basketCount
        ? `<div class="mpv-hud__card mpv-hud__card--basket">
            <div class="mpv-hud__label">Basket</div>
            <div class="mpv-hud__value">${basketCount} item${basketCount === 1 ? '' : 's'}</div>
            <div class="mpv-hud__sub">${formatSize(basketBytes)} total</div>
          </div>`
        : ''}
    `;
    const hint = document.getElementById('mpvHint');
    if (hint) {
      hint.textContent = pages
        ? `${pages} page${pages === 1 ? '' : 's'} · ${formatSize(bytes)}`
        : '';
    }
  }

  function updateNav() {
    const total = pageCount || 1;
    const input = document.getElementById('mpvPageInput');
    const totalEl = document.getElementById('mpvPageTotal');
    const mLabel = document.getElementById('mpvMPageLabel');
    if (input && document.activeElement !== input) input.value = String(currentPage);
    if (totalEl) totalEl.textContent = `/ ${total}`;
    if (mLabel) mLabel.textContent = `${currentPage} / ${total}`;
    const atStart = currentPage <= 1;
    const atEnd = currentPage >= total;
    ['mpvPrev', 'mpvMPrev'].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.disabled = atStart;
    });
    ['mpvNext', 'mpvMNext'].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.disabled = atEnd;
    });
    document.getElementById('mpvThumbs')?.querySelectorAll('.mpv-thumb').forEach((btn) => {
      const p = Number(btn.dataset.page);
      btn.classList.toggle('is-active', p === currentPage);
      btn.classList.toggle('is-selected', selected.has(p));
      const check = btn.querySelector('.mpv-thumb__check');
      if (check) check.textContent = selected.has(p) ? '✓' : '';
    });
    const zoomLabel = document.getElementById('mpvZoomLabel');
    if (zoomLabel) {
      zoomLabel.textContent = fitMode === 'manual'
        ? `${Math.round(zoom * 100)}%`
        : fitMode === 'page' ? 'Page' : 'Fit';
    }
    updateHud();
  }

  function closestZoom(delta) {
    fitMode = 'manual';
    let idx = 0;
    let best = Math.abs(ZOOM_STEPS[0] - zoom);
    for (let i = 1; i < ZOOM_STEPS.length; i += 1) {
      const d = Math.abs(ZOOM_STEPS[i] - zoom);
      if (d < best) { best = d; idx = i; }
    }
    idx = Math.min(ZOOM_STEPS.length - 1, Math.max(0, idx + delta));
    zoom = ZOOM_STEPS[idx];
    renderPage();
  }

  async function paintThumb(pageNum) {
    const canvas = document.getElementById(`mpvThumbCanvas${pageNum}`);
    if (!canvas || !pdfDoc) return;
    try {
      const page = await pdfDoc.getPage(pageNum);
      const viewport = page.getViewport({ scale: 0.2, rotation });
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
    } catch (_) { /* ignore */ }
  }

  function buildThumbs() {
    const wrap = document.getElementById('mpvThumbs');
    if (!wrap) return;
    wrap.innerHTML = '';
    for (let i = 1; i <= pageCount; i += 1) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'mpv-thumb' + (i === currentPage ? ' is-active' : '');
      btn.dataset.page = String(i);
      btn.setAttribute('role', 'option');
      btn.innerHTML = `
        <span class="mpv-thumb__check" aria-hidden="true"></span>
        <canvas id="mpvThumbCanvas${i}"></canvas>
        <span class="mpv-thumb__label">Page ${i}</span>
      `;
      btn.addEventListener('click', (e) => {
        // Click checkbox area (left) toggles; otherwise navigate + toggle on double intent via modifier
        const rect = btn.getBoundingClientRect();
        const onCheck = (e.clientX - rect.left) < 36;
        if (onCheck || e.shiftKey || e.metaKey || e.ctrlKey) {
          togglePage(i);
        } else {
          goTo(i);
        }
      });
      btn.addEventListener('dblclick', (e) => {
        e.preventDefault();
        togglePage(i);
      });
      wrap.appendChild(btn);
      paintThumb(i);
    }
    updateNav();
  }

  function togglePage(n) {
    if (selected.has(n)) selected.delete(n);
    else selected.add(n);
    updateNav();
  }

  function selectAll(on) {
    selected = new Set();
    if (on) {
      for (let i = 1; i <= pageCount; i += 1) selected.add(i);
    }
    updateNav();
  }

  async function renderPage() {
    const inner = document.getElementById('mpvStageInner');
    const stage = document.getElementById('mpvStage');
    if (!inner || !pdfDoc) return;
    const gen = ++renderGen;
    inner.innerHTML = '<div class="mpv-state">Rendering…</div>';
    try {
      const page = await pdfDoc.getPage(currentPage);
      if (gen !== renderGen) return;
      const base = page.getViewport({ scale: 1, rotation });
      const availW = Math.max(240, (stage?.clientWidth || window.innerWidth) - 40);
      const availH = Math.max(240, (stage?.clientHeight || window.innerHeight) - 40);
      let scale;
      if (fitMode === 'width') scale = availW / base.width;
      else if (fitMode === 'page') scale = Math.min(availW / base.width, availH / base.height);
      else scale = zoom;
      zoom = scale;
      const viewport = page.getViewport({
        scale: Math.min(4, Math.max(0.35, scale)),
        rotation,
      });
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      const dpr = Math.min(2.5, window.devicePixelRatio || 1);
      canvas.width = Math.floor(viewport.width * dpr);
      canvas.height = Math.floor(viewport.height * dpr);
      canvas.style.width = `${Math.floor(viewport.width)}px`;
      canvas.style.height = `${Math.floor(viewport.height)}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      await page.render({ canvasContext: ctx, viewport }).promise;
      if (gen !== renderGen) return;

      const wrap = document.createElement('div');
      wrap.className = 'mpv-page-wrap';
      wrap.style.width = `${Math.floor(viewport.width)}px`;
      wrap.style.height = `${Math.floor(viewport.height)}px`;
      wrap.appendChild(canvas);

      const annLayer = document.createElement('div');
      annLayer.className = 'mpv-ann-layer';
      wrap.appendChild(annLayer);
      await renderAnnotationLinks(page, viewport, annLayer);

      const textLayerDiv = document.createElement('div');
      textLayerDiv.className = 'mpv-text-layer';
      wrap.appendChild(textLayerDiv);

      try {
        const textContent = await page.getTextContent();
        if (gen !== renderGen) return;
        const textViewport = viewport;
        textContent.items.forEach((item, idx) => {
          if (!item.str) return;
          const tx = global.pdfjsLib.Util.transform(
            textViewport.transform,
            item.transform
          );
          const span = document.createElement('span');
          span.textContent = item.str;
          span.dataset.idx = String(idx);
          const fontHeight = Math.sqrt(tx[2] * tx[2] + tx[3] * tx[3]);
          span.style.left = `${tx[4]}px`;
          span.style.top = `${tx[5] - fontHeight}px`;
          span.style.fontSize = `${fontHeight}px`;
          span.style.fontFamily = 'sans-serif';
          if (searchQuery && item.str.toLowerCase().includes(searchQuery)) {
            span.classList.add('mpv-hl');
          }
          textLayerDiv.appendChild(span);
        });
      } catch (_) { /* text layer optional */ }

      inner.innerHTML = '';
      inner.appendChild(wrap);
      updateNav();

      const activeThumb = document.querySelector(`.mpv-thumb[data-page="${currentPage}"]`);
      activeThumb?.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
    } catch (err) {
      if (gen !== renderGen) return;
      inner.innerHTML = `<div class="mpv-state mpv-state--error">${escapeHtml(err.message || 'Could not render page')}</div>`;
    }
  }

  function goTo(page) {
    const n = Math.min(pageCount, Math.max(1, Math.floor(Number(page) || 1)));
    if (n === currentPage && document.querySelector('.mpv-page-wrap')) {
      updateNav();
      return;
    }
    currentPage = n;
    renderPage();
  }

  async function runSearch(q) {
    searchQuery = String(q || '').trim().toLowerCase();
    searchHits = [];
    searchIdx = -1;
    const countEl = document.getElementById('mpvSearchCount');
    if (!searchQuery) {
      if (countEl) countEl.textContent = '';
      renderPage();
      return;
    }
    if (!pdfDoc || searchBusy) return;
    searchBusy = true;
    if (countEl) countEl.textContent = '…';
    try {
      for (let p = 1; p <= pageCount; p += 1) {
        const page = await pdfDoc.getPage(p);
        const tc = await page.getTextContent();
        tc.items.forEach((item, itemIndex) => {
          if (item.str && item.str.toLowerCase().includes(searchQuery)) {
            searchHits.push({ page: p, itemIndex, str: item.str });
          }
        });
      }
      if (countEl) {
        countEl.textContent = searchHits.length
          ? `${searchHits.length} hit${searchHits.length === 1 ? '' : 's'}`
          : '0 hits';
      }
      if (searchHits.length) {
        searchIdx = 0;
        jumpToHit(0);
      } else {
        renderPage();
      }
    } finally {
      searchBusy = false;
    }
  }

  function jumpToHit(deltaOrIndex, absolute) {
    if (!searchHits.length) return;
    if (absolute) searchIdx = deltaOrIndex;
    else searchIdx = (searchIdx + deltaOrIndex + searchHits.length) % searchHits.length;
    const hit = searchHits[searchIdx];
    const countEl = document.getElementById('mpvSearchCount');
    if (countEl) countEl.textContent = `${searchIdx + 1}/${searchHits.length}`;
    if (hit.page !== currentPage) {
      currentPage = hit.page;
      renderPage();
    } else {
      renderPage();
    }
  }

  async function renderAnnotationLinks(page, viewport, container) {
    try {
      const annotations = await page.getAnnotations({ intent: 'display' });
      if (!annotations || !annotations.length) return;
      for (const ann of annotations) {
        if (ann.subtype !== 'Link' || !ann.rect || ann.rect.length !== 4) continue;
        const href = ann.url || ann.unsafeUrl;
        if (!href) continue;
        const [x1, y1, x2, y2] = viewport.convertToViewportRectangle(ann.rect);
        const left = Math.min(x1, x2);
        const top = Math.min(y1, y2);
        const width = Math.abs(x2 - x1);
        const height = Math.abs(y2 - y1);
        if (!Number.isFinite(left) || !Number.isFinite(top) || width <= 0 || height <= 0) continue;
        const link = document.createElement('a');
        link.className = 'mpv-ann-link';
        link.href = href;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.title = ann.title || href;
        link.style.left = `${left}px`;
        link.style.top = `${top}px`;
        link.style.width = `${width}px`;
        link.style.height = `${height}px`;
        container.appendChild(link);
      }
    } catch (_) { /* annotations optional */ }
  }

  function touchDistance(touches) {
    const dx = touches[0].clientX - touches[1].clientX;
    const dy = touches[0].clientY - touches[1].clientY;
    return Math.sqrt(dx * dx + dy * dy);
  }

  async function getSourceBytes() {
    if (srcBytesCache) return srcBytesCache;
    const url = preferPdfBytesUrl(openOpts?.url);
    if (!url) throw new Error('No document URL');
    if (url.startsWith('data:')) {
      const b64 = url.split(',')[1] || '';
      const bin = atob(b64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
      srcBytesCache = bytes.buffer;
      return srcBytesCache;
    }
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Could not load PDF (${res.status})`);
    srcBytesCache = await res.arrayBuffer();
    return srcBytesCache;
  }

  function bytesToBase64(outBytes) {
    const bytes = outBytes instanceof Uint8Array ? outBytes : new Uint8Array(outBytes);
    let binary = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
    }
    return btoa(binary);
  }

  async function extractSelection() {
    const srcBytes = await getSourceBytes();
    const allSelected = !selected.size || selected.size >= pageCount;
    if (allSelected) {
      const pages = [];
      for (let i = 1; i <= pageCount; i += 1) pages.push(i);
      const outBytes = srcBytes instanceof ArrayBuffer ? new Uint8Array(srcBytes) : srcBytes;
      const name = String(openOpts?.fileName || 'document.pdf');
      return {
        pages,
        name,
        size: outBytes.byteLength,
        contentBase64: bytesToBase64(outBytes),
        sourceKey: openOpts?.sourceKey || null,
        fileName: openOpts?.fileName || name,
      };
    }
    if (!global.PDFLib?.PDFDocument) throw new Error('PDF tools not loaded yet');
    const pages = Array.from(selected).sort((a, b) => a - b);
    const srcDoc = await global.PDFLib.PDFDocument.load(srcBytes);
    const outDoc = await global.PDFLib.PDFDocument.create();
    const copied = await outDoc.copyPages(srcDoc, pages.map((p) => p - 1));
    copied.forEach((p) => outDoc.addPage(p));
    const outBytes = await outDoc.save();
    const pageLabel = pages.length === 1
      ? `p${pages[0]}`
      : `p${pages[0]}-${pages[pages.length - 1]}`;
    const base = String(openOpts?.fileName || 'document.pdf').replace(/\.pdf$/i, '');
    const name = `${base}_${pageLabel}.pdf`;
    const contentBase64 = bytesToBase64(outBytes);
    return {
      pages,
      name,
      size: outBytes.byteLength,
      contentBase64,
      sourceKey: openOpts?.sourceKey || null,
      fileName: openOpts?.fileName || name,
    };
  }

  async function withBusy(btnIds, label, fn) {
    const buttons = btnIds.map((id) => document.getElementById(id)).filter(Boolean);
    const prev = buttons.map((b) => b.textContent);
    buttons.forEach((b) => { b.disabled = true; b.textContent = label; });
    try {
      return await fn();
    } finally {
      buttons.forEach((b, i) => { b.disabled = false; b.textContent = prev[i]; });
    }
  }

  function toast(msg, kind) {
    if (typeof openOpts?.onToast === 'function') openOpts.onToast(msg, kind);
  }

  function wireHost() {
    document.getElementById('mpvClose')?.addEventListener('click', () => requestClose());
    document.getElementById('mpvPrev')?.addEventListener('click', () => goTo(currentPage - 1));
    document.getElementById('mpvNext')?.addEventListener('click', () => goTo(currentPage + 1));
    document.getElementById('mpvMPrev')?.addEventListener('click', () => goTo(currentPage - 1));
    document.getElementById('mpvMNext')?.addEventListener('click', () => goTo(currentPage + 1));
    document.getElementById('mpvZoomIn')?.addEventListener('click', () => closestZoom(1));
    document.getElementById('mpvZoomOut')?.addEventListener('click', () => closestZoom(-1));
    document.getElementById('mpvFitWidth')?.addEventListener('click', () => {
      fitMode = 'width';
      renderPage();
    });
    document.getElementById('mpvFitPage')?.addEventListener('click', () => {
      fitMode = 'page';
      renderPage();
    });
    document.getElementById('mpvRotL')?.addEventListener('click', () => {
      rotation = (rotation + 270) % 360;
      buildThumbs();
      renderPage();
    });
    document.getElementById('mpvRotR')?.addEventListener('click', () => {
      rotation = (rotation + 90) % 360;
      buildThumbs();
      renderPage();
    });
    document.getElementById('mpvThumbsToggle')?.addEventListener('click', () => {
      host.classList.toggle('is-thumbs-collapsed');
    });
    document.getElementById('mpvImmersive')?.addEventListener('click', () => {
      setReadingMode(!host.classList.contains('is-immersive'));
    });
    document.getElementById('mpvSelectAll')?.addEventListener('click', () => selectAll(true));
    document.getElementById('mpvSelectNone')?.addEventListener('click', () => selectAll(false));
    document.getElementById('mpvTogglePage')?.addEventListener('click', () => togglePage(currentPage));

    document.getElementById('mpvPageInput')?.addEventListener('change', (e) => {
      goTo(e.target.value);
    });
    document.getElementById('mpvPageInput')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        goTo(e.target.value);
      }
    });

    let searchTimer = null;
    document.getElementById('mpvSearch')?.addEventListener('input', (e) => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => runSearch(e.target.value), 280);
    });
    document.getElementById('mpvSearch')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        if (e.shiftKey) jumpToHit(-1);
        else if (searchHits.length) jumpToHit(1);
        else runSearch(e.target.value);
      }
    });
    document.getElementById('mpvFindPrev')?.addEventListener('click', () => jumpToHit(-1));
    document.getElementById('mpvFindNext')?.addEventListener('click', () => jumpToHit(1));

    document.getElementById('mpvAddBtn')?.addEventListener('click', async () => {
      try {
        await withBusy(['mpvAddBtn'], 'Adding…', async () => {
          const payload = await extractSelection();
          if (typeof openOpts?.onAddToSelection === 'function') {
            await openOpts.onAddToSelection(payload);
          }
          updateHud();
        });
      } catch (err) {
        toast(err.message || 'Could not add pages', 'error');
      }
    });

    document.getElementById('mpvDownloadBtn')?.addEventListener('click', async () => {
      try {
        await withBusy(['mpvDownloadBtn'], 'Preparing…', async () => {
          const payload = await extractSelection();
          if (typeof openOpts?.onDownload === 'function') {
            await openOpts.onDownload(payload);
            return;
          }
          const bin = atob(payload.contentBase64);
          const bytes = new Uint8Array(bin.length);
          for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
          const blob = new Blob([bytes], { type: 'application/pdf' });
          const a = document.createElement('a');
          a.href = URL.createObjectURL(blob);
          a.download = payload.name;
          a.click();
          setTimeout(() => URL.revokeObjectURL(a.href), 2000);
          toast(`Downloaded ${payload.name}`, 'success');
        });
      } catch (err) {
        toast(err.message || 'Download failed', 'error');
      }
    });

    document.getElementById('mpvShareBtn')?.addEventListener('click', async () => {
      try {
        await withBusy(['mpvShareBtn'], 'Preparing…', async () => {
          const payload = await extractSelection();
          if (typeof openOpts?.onShare === 'function') {
            await openOpts.onShare(payload);
          } else {
            toast('Share is not available here', 'error');
          }
        });
      } catch (err) {
        toast(err.message || 'Share failed', 'error');
      }
    });

    document.getElementById('mpvPrintBtn')?.addEventListener('click', async () => {
      try {
        await withBusy(['mpvPrintBtn'], 'Preparing…', async () => {
          const payload = await extractSelection();
          if (typeof openOpts?.onPrintAtStore === 'function') {
            await openOpts.onPrintAtStore(payload);
          } else {
            toast('Print at Store is not available here', 'error');
          }
        });
      } catch (err) {
        toast(err.message || 'Print prep failed', 'error');
      }
    });

    const stage = document.getElementById('mpvStage');
    stage?.addEventListener('touchstart', (e) => {
      if (e.touches.length >= 2) {
        pinchDist0 = touchDistance(e.touches);
        pinchZoom0 = zoom;
        fitMode = 'manual';
        touchX = null;
        return;
      }
      pinchDist0 = 0;
      touchX = e.changedTouches?.[0]?.clientX ?? null;
    }, { passive: true });
    stage?.addEventListener('touchmove', (e) => {
      if (e.touches.length < 2 || pinchDist0 <= 0) return;
      e.preventDefault();
      const ratio = touchDistance(e.touches) / pinchDist0;
      const next = Math.min(4, Math.max(0.35, pinchZoom0 * ratio));
      const wrap = document.querySelector('.mpv-page-wrap');
      if (wrap) wrap.style.transform = `scale(${next / zoom})`;
    }, { passive: false });
    stage?.addEventListener('touchend', (e) => {
      if (pinchDist0 > 0 && e.touches.length < 2) {
        const wrap = document.querySelector('.mpv-page-wrap');
        const m = wrap?.style.transform?.match(/scale\((.+?)\)/);
        wrap && (wrap.style.transform = '');
        if (m) {
          zoom = Math.min(4, Math.max(0.35, zoom * parseFloat(m[1])));
          fitMode = 'manual';
          renderPage();
        }
        pinchDist0 = 0;
        touchX = null;
        return;
      }
      if (touchX == null) return;
      const dx = (e.changedTouches?.[0]?.clientX ?? touchX) - touchX;
      touchX = null;
      if (Math.abs(dx) < 60) return;
      if (dx < 0) goTo(currentPage + 1);
      else goTo(currentPage - 1);
    }, { passive: true });

    stage?.addEventListener('wheel', (e) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      closestZoom(e.deltaY < 0 ? 1 : -1);
    }, { passive: false });
  }

  function attachKeys() {
    detachKeys();
    keyHandler = (e) => {
      if (!host?.classList.contains('is-open')) return;
      const tag = (e.target && e.target.tagName) || '';
      const typing = tag === 'INPUT' || tag === 'TEXTAREA';
      if (e.key === 'Escape') {
        e.preventDefault();
        if (!host.classList.contains('is-immersive')) {
          setReadingMode(true);
          return;
        }
        requestClose();
        return;
      }
      if (typing) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        setReadingMode(false);
        document.getElementById('mpvSearch')?.focus();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
        e.preventDefault();
        selectAll(true);
        return;
      }
      if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
        e.preventDefault();
        goTo(currentPage - 1);
      } else if (e.key === 'ArrowRight' || e.key === 'PageDown') {
        e.preventDefault();
        goTo(currentPage + 1);
      } else if (e.key === 'Home') {
        e.preventDefault();
        goTo(1);
      } else if (e.key === 'End') {
        e.preventDefault();
        goTo(pageCount);
      } else if (e.key === '+' || e.key === '=') {
        e.preventDefault();
        closestZoom(1);
      } else if (e.key === '-') {
        e.preventDefault();
        closestZoom(-1);
      } else if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault();
        togglePage(currentPage);
      } else if (e.key.toLowerCase() === 'a') {
        selectAll(true);
      } else if (e.key.toLowerCase() === 'f') {
        fitMode = 'width';
        renderPage();
      }
    };
    document.addEventListener('keydown', keyHandler);
  }

  function detachKeys() {
    if (keyHandler) document.removeEventListener('keydown', keyHandler);
    keyHandler = null;
  }

  function isNarrowScreen() {
    try {
      return !!(global.matchMedia && global.matchMedia('(max-width: 720px)').matches);
    } catch (_) {
      return false;
    }
  }

  function syncUiScale() {
    if (!host) return;
    const w = host.clientWidth || global.innerWidth || 360;
    const t = Math.max(0, Math.min(1, (w - 320) / 400));
    const fs = 10.5 + t * 2.5;
    host.style.setProperty('--mpv-fs', `${fs.toFixed(2)}px`);
    host.style.setProperty('--mpv-fs-sm', `${(fs - 1).toFixed(2)}px`);
  }

  function setReadingMode(on) {
    if (!host) return;
    const reading = !!on;
    host.classList.toggle('is-immersive', reading);
    host.classList.toggle('is-thumbs-collapsed', reading || isNarrowScreen());
    const btn = document.getElementById('mpvImmersive');
    if (btn) {
      btn.textContent = reading ? 'Tools' : 'View';
      btn.title = reading ? 'Page select, print, share, search' : 'Full document view';
      btn.classList.toggle('is-active', !reading);
    }
  }

  function requestClose() {
    if (openOpts?.standalone) {
      if (inFrame()) {
        notifyHost(false);
        return;
      }
      if (global.history.length > 1) {
        global.history.back();
        return;
      }
    }
    close();
  }

  async function open(options) {
    if (!options?.url) throw new Error('MaterialsPdfViewer.open requires url');
    ensureHost();
    openOpts = { ...options, url: preferPdfBytesUrl(options.url) };
    pdfDoc = null;
    srcBytesCache = null;
    pageCount = 0;
    currentPage = Math.max(1, Math.floor(Number(options.page) || 1));
    zoom = 1;
    fitMode = 'width';
    rotation = 0;
    selected = new Set();
    searchHits = [];
    searchIdx = -1;
    searchQuery = '';
    const framed = options.embedded || inFrame();
    host.classList.toggle('is-standalone', !!options.standalone);
    host.classList.toggle('is-framed', !!framed);
    host.classList.add('is-open');
    syncUiScale();
    const startInTools = (options.tools === true || options.immersive === false)
      && !isNarrowScreen();
    host.classList.toggle('is-thumbs-collapsed', !startInTools);
    setReadingMode(!startInTools);
    lockPageScroll(true);
    const closeBtn = document.getElementById('mpvClose');
    if (closeBtn) {
      closeBtn.textContent = options.standalone && !framed ? 'Back' : 'Close';
      closeBtn.style.display = options.standalone && framed ? 'none' : '';
    }
    document.getElementById('mpvTitle').textContent =
      options.title || options.fileName || filenameFromUrl(openOpts.url) || 'Document';
    document.getElementById('mpvSearch').value = '';
    document.getElementById('mpvSearchCount').textContent = '';
    document.getElementById('mpvStageInner').innerHTML = '<div class="mpv-state">Opening…</div>';
    document.getElementById('mpvThumbs').innerHTML = '';
    updateHud();
    attachKeys();
    notifyHost(true);

    // Hide action buttons the host doesn't support
    const map = [
      ['mpvAddBtn', 'onAddToSelection'],
      ['mpvShareBtn', 'onShare'],
      ['mpvPrintBtn', 'onPrintAtStore'],
      ['mpvDownloadBtn', 'onDownload'],
    ];
    map.forEach(([id, key]) => {
      const el = document.getElementById(id);
      if (!el) return;
      // Download always has a built-in fallback
      if (key === 'onDownload') {
        el.style.display = '';
        return;
      }
      el.style.display = typeof options[key] === 'function' ? '' : 'none';
    });

    try {
      const lib = pdfjs();
      pdfDoc = await lib.getDocument({ url: openOpts.url, withCredentials: false }).promise;
      pageCount = pdfDoc.numPages;
      if (currentPage > pageCount) currentPage = 1;
      if (options.preselectAll) selectAll(true);
      buildThumbs();
      await renderPage();
    } catch (err) {
      document.getElementById('mpvStageInner').innerHTML =
        `<div class="mpv-state mpv-state--error">${escapeHtml(err.message || 'Could not open PDF')}</div>`;
      throw err;
    }

    clearTimeout(resizeTimer);
    window.addEventListener('resize', onResize);
    if (global.visualViewport) {
      vvHandler = () => onResize();
      global.visualViewport.addEventListener('resize', vvHandler);
    }
  }

  function onResize() {
    syncUiScale();
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (fitMode !== 'manual' && host?.classList.contains('is-open')) renderPage();
    }, 150);
  }

  function close() {
    host?.classList.remove('is-open', 'is-immersive', 'is-standalone', 'is-framed');
    lockPageScroll(false);
    detachKeys();
    window.removeEventListener('resize', onResize);
    if (vvHandler && global.visualViewport) {
      global.visualViewport.removeEventListener('resize', vvHandler);
      vvHandler = null;
    }
    pdfDoc = null;
    srcBytesCache = null;
    notifyHost(false);
    const cb = openOpts?.onClose;
    openOpts = null;
    if (typeof cb === 'function') cb();
  }

  function isOpen() {
    return !!(host && host.classList.contains('is-open'));
  }

  global.MaterialsPdfViewer = {
    open,
    close,
    isOpen,
    formatSize,
    filenameFromUrl,
    preferPdfBytesUrl,
    viewerUrl(fileUrl, name) {
      const u = new URL('/pdf/', global.location.origin);
      u.searchParams.set('file', fileUrl);
      if (name) u.searchParams.set('name', name);
      return u.toString();
    },
  };
})(typeof window !== 'undefined' ? window : globalThis);
