/**
 * MaterialsPdfViewer — fullscreen PDF.js viewer with page selection, search,
 * zoom/fit/rotate, and share/print/download actions for Dump Bin + EOD.
 *
 * window.MaterialsPdfViewer.open(options)
 */
(function (global) {
  'use strict';

  const WORKER =
    'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
  const ZOOM_STEPS = [0.5, 0.75, 1, 1.25, 1.5, 2, 2.5, 3, 4];

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
  let keyHandler = null;
  let resizeTimer = null;

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
      ? document.currentScript.src.replace(/[^/]+$/, 'materials-pdf-viewer.css')
      : '/shared/pdf-viewer/materials-pdf-viewer.css';
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
        <div class="mpv-group" aria-label="Zoom">
          <button type="button" class="mpv-btn" id="mpvZoomOut" aria-label="Zoom out">−</button>
          <span class="mpv-zoom-label" id="mpvZoomLabel">Fit</span>
          <button type="button" class="mpv-btn" id="mpvZoomIn" aria-label="Zoom in">+</button>
          <button type="button" class="mpv-btn" id="mpvFitWidth" title="Fit width">Fit</button>
          <button type="button" class="mpv-btn" id="mpvFitPage" title="Fit page">Page</button>
        </div>
        <div class="mpv-group" aria-label="Rotate">
          <button type="button" class="mpv-btn" id="mpvRotL" aria-label="Rotate left" title="Rotate left">↶</button>
          <button type="button" class="mpv-btn" id="mpvRotR" aria-label="Rotate right" title="Rotate right">↷</button>
        </div>
        <div class="mpv-search">
          <input type="search" id="mpvSearch" placeholder="Search in document…" enterkeyhint="search" autocomplete="off">
          <span class="mpv-search__count" id="mpvSearchCount"></span>
          <button type="button" class="mpv-btn" id="mpvFindPrev" aria-label="Previous match" title="Previous match">▴</button>
          <button type="button" class="mpv-btn" id="mpvFindNext" aria-label="Next match" title="Next match">▾</button>
        </div>
        <button type="button" class="mpv-btn mpv-btn--ghost" id="mpvThumbsToggle" title="Toggle thumbnails">Thumbs</button>
        <button type="button" class="mpv-btn mpv-btn--ghost" id="mpvImmersive" title="Reading mode">Focus</button>
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
          <span class="mpv-hint" id="mpvHint">Select pages, then print, download, share, or add to basket</span>
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
        ? `${pages} page(s) · ~${formatSize(bytes)} — ready to print, download, share, or add`
        : 'Select pages (click thumb checkmarks or press Space), or Select all';
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

  async function getSourceBytes() {
    if (srcBytesCache) return srcBytesCache;
    const url = openOpts?.url;
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
    if (!selected.size) throw new Error('Select at least one page first');
    if (!global.PDFLib?.PDFDocument) throw new Error('PDF tools not loaded yet');
    const pages = Array.from(selected).sort((a, b) => a - b);
    const srcBytes = await getSourceBytes();
    const srcDoc = await PDFLib.PDFDocument.load(srcBytes);
    const outDoc = await PDFLib.PDFDocument.create();
    const copied = await outDoc.copyPages(srcDoc, pages.map((p) => p - 1));
    copied.forEach((p) => outDoc.addPage(p));
    const outBytes = await outDoc.save();
    const pageLabel = pages.length === 1
      ? `p${pages[0]}`
      : pages.length === pageCount
        ? 'all'
        : `p${pages[0]}-${pages[pages.length - 1]}`;
    const base = String(openOpts?.fileName || 'document.pdf').replace(/\.pdf$/i, '');
    const name = pages.length === pageCount && pages[0] === 1 && pages[pages.length - 1] === pageCount
      ? `${base}.pdf`
      : `${base}_${pageLabel}.pdf`;
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
    document.getElementById('mpvClose')?.addEventListener('click', () => close());
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
      host.classList.toggle('is-immersive');
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
      touchX = e.changedTouches?.[0]?.clientX ?? null;
    }, { passive: true });
    stage?.addEventListener('touchend', (e) => {
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
        if (host.classList.contains('is-immersive')) host.classList.remove('is-immersive');
        else close();
        return;
      }
      if (typing) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
        e.preventDefault();
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

  async function open(options) {
    if (!options?.url) throw new Error('MaterialsPdfViewer.open requires url');
    ensureHost();
    openOpts = options;
    pdfDoc = null;
    srcBytesCache = null;
    pageCount = 0;
    currentPage = 1;
    zoom = 1;
    fitMode = 'width';
    rotation = 0;
    selected = new Set();
    searchHits = [];
    searchIdx = -1;
    searchQuery = '';
    host.classList.add('is-open');
    host.classList.remove('is-immersive', 'is-thumbs-collapsed');
    document.getElementById('mpvTitle').textContent = options.title || options.fileName || 'Document';
    document.getElementById('mpvSearch').value = '';
    document.getElementById('mpvSearchCount').textContent = '';
    document.getElementById('mpvStageInner').innerHTML = '<div class="mpv-state">Opening…</div>';
    document.getElementById('mpvThumbs').innerHTML = '';
    updateHud();
    attachKeys();

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
      pdfDoc = await lib.getDocument({ url: options.url, withCredentials: false }).promise;
      pageCount = pdfDoc.numPages;
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
  }

  function onResize() {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (fitMode !== 'manual' && host?.classList.contains('is-open')) renderPage();
    }, 150);
  }

  function close() {
    host?.classList.remove('is-open', 'is-immersive');
    detachKeys();
    window.removeEventListener('resize', onResize);
    pdfDoc = null;
    srcBytesCache = null;
    const cb = openOpts?.onClose;
    openOpts = null;
    if (typeof cb === 'function') cb();
  }

  function isOpen() {
    return !!(host && host.classList.contains('is-open'));
  }

  global.MaterialsPdfViewer = { open, close, isOpen, formatSize };
})(typeof window !== 'undefined' ? window : globalThis);
