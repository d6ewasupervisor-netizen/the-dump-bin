(function () {
  'use strict';

  if (typeof pdfjsLib !== 'undefined') {
    pdfjsLib.GlobalWorkerOptions.workerSrc =
      'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
  }

  var viewerPdf = null;
  var viewerScale = 1;
  var viewerPdfPanX = 0;
  var viewerPdfPanY = 0;
  var ZOOM_LEVELS = [0.5, 0.75, 1, 1.25, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10, 12, 16, 20];
  var ZOOM_MIN = 0.5;
  var ZOOM_MAX = 20;
  var PDF_MAX_CANVAS_EDGE = 8192;
  var PDF_BASE_OVERSAMPLE = 2.25;
  var pdfRerenderDebounceTimer = 0;
  var viewerPinchTeardown = null;
  var pdfViewportRafId = 0;
  var pdfFlashPageIndicator = function () {};
  var pdfJumpQueuedPageNum = null;
  var hubPdfPanelOpen = false;

  function pdfBodyEl() {
    return document.getElementById('pog-pdf-body');
  }

  function pdfPanelEl() {
    return document.getElementById('pog-pdf-panel');
  }

  function clampPdfJumpPage(oneBasedRaw, totalPages) {
    var tp = Number(totalPages);
    var t = !(tp > 0) || !Number.isFinite(tp) ? 1 : Math.min(2147483647, Math.floor(tp));
    var n = Math.round(Number(oneBasedRaw));
    if (!(n > 0) || !Number.isFinite(n)) n = 1;
    if (n > t) n = t;
    if (n < 1) n = 1;
    return n;
  }

  function pdfPageSlotOffsetTopRelativeToBody(slot, bodyEl) {
    var y = 0;
    var node = slot;
    while (node && node !== bodyEl) {
      y += node.offsetTop;
      node = node.offsetParent;
    }
    return y;
  }

  function closestZoomIndex() {
    var best = 0;
    var d = Math.abs(ZOOM_LEVELS[0] - viewerScale);
    var i;
    for (i = 1; i < ZOOM_LEVELS.length; i++) {
      var c = Math.abs(ZOOM_LEVELS[i] - viewerScale);
      if (c < d) { d = c; best = i; }
    }
    return best;
  }

  function clampPdfViewportPan() {}

  function applyViewerTransformImmediate() {
    var wrap = document.querySelector('#pog-pdf-body .viewer-zoom-wrap');
    if (!wrap) return;
    wrap.style.transform =
      'translate(' + viewerPdfPanX + 'px,' + viewerPdfPanY + 'px) scale(' + viewerScale + ')';
  }

  function schedulePdfViewportApply() {
    if (pdfViewportRafId) return;
    pdfViewportRafId = requestAnimationFrame(function () {
      pdfViewportRafId = 0;
      clampPdfViewportPan();
      applyViewerTransformImmediate();
    });
  }

  function pdfViewportPoint(viewport, clientX, clientY) {
    var r = viewport.getBoundingClientRect();
    return { x: clientX - r.left, y: clientY - r.top };
  }

  function pdfViewportDist(a, b) {
    var dx = b.x - a.x;
    var dy = b.y - a.y;
    return Math.sqrt(dx * dx + dy * dy);
  }

  function pdfZoomAroundViewportPoint(mx, my, newScale) {
    var s0 = viewerScale;
    var s1 = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, newScale));
    var cx = (mx - viewerPdfPanX) / s0;
    var cy = (my - viewerPdfPanY) / s0;
    viewerScale = s1;
    viewerPdfPanX = mx - cx * viewerScale;
    viewerPdfPanY = my - cy * viewerScale;
  }

  function getCurrentVisiblePdfPage() {
    var body = pdfBodyEl();
    var wrap = body && body.querySelector('.viewer-zoom-wrap');
    if (!body || !wrap || !viewerPdf) return 1;
    var slots = wrap.querySelectorAll('.viewer-page-slot');
    var vh = body.clientHeight || 1;
    var midContentY = (vh / 2 - viewerPdfPanY) / viewerScale;
    var current = 1;
    var si;
    for (si = 0; si < slots.length; si++) {
      var s = slots[si];
      var top = s.offsetTop;
      var h = s.offsetHeight || 0;
      var bot = top + h;
      if (midContentY >= top && midContentY < bot) {
        return parseInt(s.dataset.page, 10);
      }
      if (midContentY >= top) current = parseInt(s.dataset.page, 10);
    }
    return current;
  }

  function schedulePdfRerenderForZoom() {
    if (pdfRerenderDebounceTimer) clearTimeout(pdfRerenderDebounceTimer);
    pdfRerenderDebounceTimer = setTimeout(function () {
      pdfRerenderDebounceTimer = 0;
      var body = pdfBodyEl();
      var wrap = body && body.querySelector('.viewer-zoom-wrap');
      if (!wrap || !body || !viewerPdf) return;
      var br = body.getBoundingClientRect();
      var pad = 120;
      wrap.querySelectorAll('.viewer-page-slot.rendered').forEach(function (slot) {
        var r = slot.getBoundingClientRect();
        if (r.bottom < br.top - pad || r.top > br.bottom + pad) return;
        var pageNum = parseInt(slot.dataset.page, 10);
        renderPage(pageNum, slot);
      });
    }, 240);
  }

  async function renderPage(pageNum, slot) {
    try {
      var page = await viewerPdf.getPage(pageNum);
      var pdfVp = page.getViewport({ scale: 1 });
      var bodyEl = pdfBodyEl();
      var containerWidth = Math.max(1, (bodyEl ? bodyEl.clientWidth : 400) - 16);
      var baseScale = containerWidth / pdfVp.width;
      var dpr = window.devicePixelRatio || 1;
      var zoomSharp = Math.max(1, viewerScale);
      var scale = baseScale * dpr * PDF_BASE_OVERSAMPLE * Math.min(zoomSharp, 12);
      var maxByW = PDF_MAX_CANVAS_EDGE / pdfVp.width;
      var maxByH = PDF_MAX_CANVAS_EDGE / pdfVp.height;
      scale = Math.min(scale, maxByW, maxByH);
      var scaledVp = page.getViewport({ scale: scale });

      var canvas = document.createElement('canvas');
      canvas.width = scaledVp.width;
      canvas.height = scaledVp.height;
      var ctx = canvas.getContext('2d', { alpha: false });
      await page.render({
        canvasContext: ctx,
        viewport: scaledVp,
        intent: 'print',
      }).promise;

      slot.innerHTML = '';
      slot.appendChild(canvas);
      slot.classList.add('rendered');
      schedulePdfViewportApply();
    } catch (e) {
      slot.innerHTML = '<div class="pog-pdf-fallback">Failed to render page ' + pageNum + '</div>';
    }
  }

  async function ensurePdfPageSlotRenderedForJump(pageNum, slot) {
    if (!viewerPdf || !slot) return;
    if (slot.querySelector('canvas')) return;
    slot.dataset.rendering = '1';
    await renderPage(pageNum, slot);
  }

  function setupLazyRender(wrap, scrollRoot) {
    var slots = wrap.querySelectorAll('.viewer-page-slot');
    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          var slot = entry.target;
          if (!slot.dataset.rendering) {
            slot.dataset.rendering = '1';
            renderPage(parseInt(slot.dataset.page, 10), slot);
          }
        }
      });
    }, { root: scrollRoot || null, rootMargin: '600px 0px' });
    slots.forEach(function (s) { observer.observe(s); });
  }

  function setupPageIndicator(totalPages) {
    var indicator = document.getElementById('pog-pdf-page-indicator');
    var body = pdfBodyEl();
    var hideTimeout;
    pdfFlashPageIndicator = function flashIndicator() {
      if (!indicator || !body || !viewerPdf || !hubPdfPanelOpen) return;
      var current = getCurrentVisiblePdfPage();
      indicator.textContent = 'Page ' + current + ' of ' + totalPages;
      indicator.style.display = 'block';
      indicator.style.opacity = '1';
      clearTimeout(hideTimeout);
      hideTimeout = setTimeout(function () { indicator.style.opacity = '0'; }, 1200);
    };
  }

  function attachPdfViewportZoom(viewport, wrap) {
    var pointers = new Map();
    var pinchPrevDist = 0;
    var panPtrId = null;
    var panStartX = 0;
    var panStartY = 0;
    var panTx0 = 0;
    var panTy0 = 0;
    var panActive = false;
    var pinchActive = false;
    var draggingPan = false;
    var TAP_MOVE_PX = 10;

    function midpoint(a, b) {
      return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    }

    function beginPinchIfNeeded() {
      if (pointers.size !== 2) return;
      var pts = Array.from(pointers.values());
      var a = pdfViewportPoint(viewport, pts[0].clientX, pts[0].clientY);
      var b = pdfViewportPoint(viewport, pts[1].clientX, pts[1].clientY);
      pinchPrevDist = Math.max(1e-6, pdfViewportDist(a, b));
      pinchActive = true;
      panActive = false;
      panPtrId = null;
      draggingPan = false;
    }

    function updatePinch() {
      if (!pinchActive || pointers.size !== 2) return;
      var pts = Array.from(pointers.values());
      var a = pdfViewportPoint(viewport, pts[0].clientX, pts[0].clientY);
      var b = pdfViewportPoint(viewport, pts[1].clientX, pts[1].clientY);
      var d = Math.max(1e-6, pdfViewportDist(a, b));
      var mid = midpoint(a, b);
      var ratio = d / pinchPrevDist;
      var newScale = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, viewerScale * ratio));
      var cx = (mid.x - viewerPdfPanX) / viewerScale;
      var cy = (mid.y - viewerPdfPanY) / viewerScale;
      viewerPdfPanX = mid.x - cx * newScale;
      viewerPdfPanY = mid.y - cy * newScale;
      viewerScale = newScale;
      pinchPrevDist = d;
      schedulePdfViewportApply();
    }

    function onPointerDown(e) {
      pointers.set(e.pointerId, { clientX: e.clientX, clientY: e.clientY });
      if (pointers.size === 2) {
        beginPinchIfNeeded();
        viewport.classList.add('is-pinching');
        e.preventDefault();
        return;
      }
      if (pointers.size === 1 && e.isPrimary) {
        panPtrId = e.pointerId;
        panStartX = e.clientX;
        panStartY = e.clientY;
        panTx0 = viewerPdfPanX;
        panTy0 = viewerPdfPanY;
        panActive = true;
      }
    }

    function onPointerMove(e) {
      if (!pointers.has(e.pointerId)) return;
      pointers.set(e.pointerId, { clientX: e.clientX, clientY: e.clientY });
      if (pointers.size >= 2) {
        if (!pinchActive) beginPinchIfNeeded();
        updatePinch();
        e.preventDefault();
        return;
      }
      if (panActive && panPtrId === e.pointerId) {
        var dx = e.clientX - panStartX;
        var dy = e.clientY - panStartY;
        if (!draggingPan && dx * dx + dy * dy > TAP_MOVE_PX * TAP_MOVE_PX) draggingPan = true;
        if (draggingPan) {
          viewerPdfPanX = panTx0 + dx;
          viewerPdfPanY = panTy0 + dy;
          schedulePdfViewportApply();
          e.preventDefault();
        }
      }
    }

    function onPointerUp(e) {
      var hadPinch = pinchActive;
      pointers.delete(e.pointerId);
      if (pinchActive && pointers.size < 2) {
        pinchActive = false;
        pinchPrevDist = 0;
        viewport.classList.remove('is-pinching');
        schedulePdfViewportApply();
        schedulePdfRerenderForZoom();
      }
      if (panPtrId === e.pointerId) {
        panPtrId = null;
        panActive = false;
        draggingPan = false;
      }
      if (pointers.size === 1 && hadPinch) {
        var remId = Array.from(pointers.keys())[0];
        var rem = pointers.get(remId);
        if (rem) {
          panPtrId = remId;
          panStartX = rem.clientX;
          panStartY = rem.clientY;
          panTx0 = viewerPdfPanX;
          panTy0 = viewerPdfPanY;
          panActive = true;
        }
      }
      if (pointers.size === 0) pdfFlashPageIndicator();
    }

    viewport.addEventListener('pointerdown', onPointerDown, { capture: true, passive: false });
    viewport.addEventListener('pointermove', onPointerMove, { capture: true, passive: false });
    viewport.addEventListener('pointerup', onPointerUp, { capture: true });
    viewport.addEventListener('pointercancel', onPointerUp, { capture: true });

    return function teardown() {
      viewport.removeEventListener('pointerdown', onPointerDown, { capture: true, passive: false });
      viewport.removeEventListener('pointermove', onPointerMove, { capture: true, passive: false });
      viewport.removeEventListener('pointerup', onPointerUp, { capture: true });
      viewport.removeEventListener('pointercancel', onPointerUp, { capture: true });
      if (pdfViewportRafId) {
        cancelAnimationFrame(pdfViewportRafId);
        pdfViewportRafId = 0;
      }
      viewport.classList.remove('is-pinching');
    };
  }

  async function loadPdfIntoBody(url) {
    if (viewerPinchTeardown) { viewerPinchTeardown(); viewerPinchTeardown = null; }
    if (pdfRerenderDebounceTimer) {
      clearTimeout(pdfRerenderDebounceTimer);
      pdfRerenderDebounceTimer = 0;
    }
    var body = pdfBodyEl();
    if (!body) return;
    body.innerHTML = '<div class="pog-pdf-loading"><div class="viewer-spinner"></div></div>';
    viewerScale = 1;
    viewerPdfPanX = 0;
    viewerPdfPanY = 0;
    try {
      viewerPdf = await pdfjsLib.getDocument(url).promise;
      body.innerHTML = '';
      var wrap = document.createElement('div');
      wrap.className = 'viewer-zoom-wrap';
      body.appendChild(wrap);

      var i;
      for (i = 1; i <= viewerPdf.numPages; i++) {
        var slot = document.createElement('div');
        slot.className = 'viewer-page-slot';
        slot.dataset.page = String(i);
        slot.innerHTML = '<div class="viewer-spinner"></div>';
        wrap.appendChild(slot);
      }

      setupPageIndicator(viewerPdf.numPages);
      setupLazyRender(wrap, body);
      viewerPinchTeardown = attachPdfViewportZoom(body, wrap);
      schedulePdfViewportApply();
      pdfFlashPageIndicator();
      var queued = pdfJumpQueuedPageNum;
      pdfJumpQueuedPageNum = null;
      if (queued != null) await jumpToPdfPage(queued);
    } catch (e) {
      if (viewerPinchTeardown) { viewerPinchTeardown(); viewerPinchTeardown = null; }
      body.innerHTML =
        '<div class="pog-pdf-fallback">' +
        '<div>Unable to render the PDF inline.</div>' +
        '<a href="' + url + '" target="_blank" rel="noopener">Open in new tab</a></div>';
    }
  }

  async function jumpToPdfPage(rawPageOneBased) {
    var body = pdfBodyEl();
    var wrap = body && body.querySelector('.viewer-zoom-wrap');
    if (!body || !wrap) return;

    if (!viewerPdf) {
      var r = Number(rawPageOneBased);
      pdfJumpQueuedPageNum = !(r > 0) || !Number.isFinite(r) ? 1 : r;
      return;
    }

    var totalPages = viewerPdf.numPages || 1;
    var pn = clampPdfJumpPage(rawPageOneBased, totalPages);
    viewerZoom(0);

    var sel = '.viewer-page-slot[data-page="' + String(pn) + '"]';
    var slot = wrap.querySelector(sel);
    if (!slot) return;

    await ensurePdfPageSlotRenderedForJump(pn, slot);
    await new Promise(function (resolve) {
      requestAnimationFrame(function () { requestAnimationFrame(resolve); });
    });

    var offsetTopInBody = pdfPageSlotOffsetTopRelativeToBody(slot, body);
    viewerPdfPanY = -(offsetTopInBody * viewerScale);
    schedulePdfViewportApply();
    pdfFlashPageIndicator();
  }

  function viewerPdfPageDelta(delta) {
    var d = Number(delta);
    if (!viewerPdf || !(d > 0 || d < 0)) return;
    var total = viewerPdf.numPages || 1;
    var cur = getCurrentVisiblePdfPage();
    var next = Math.min(total, Math.max(1, cur + d));
    if (next !== cur) jumpToPdfPage(next);
  }

  function viewerZoom(dir) {
    var body = pdfBodyEl();
    var wrap = body && body.querySelector('.viewer-zoom-wrap');
    if (!body || !wrap) return;
    if (dir === 0) {
      viewerScale = 1;
      viewerPdfPanX = 0;
      viewerPdfPanY = 0;
    } else {
      var idx = Math.max(0, Math.min(ZOOM_LEVELS.length - 1, closestZoomIndex() + dir));
      var newS = ZOOM_LEVELS[idx];
      var mx = body.clientWidth / 2;
      var my = body.clientHeight / 2;
      pdfZoomAroundViewportPoint(mx, my, newS);
    }
    schedulePdfViewportApply();
    pdfFlashPageIndicator();
    schedulePdfRerenderForZoom();
  }

  function closeHubPdfViewer() {
    hubPdfPanelOpen = false;
    if (viewerPinchTeardown) { viewerPinchTeardown(); viewerPinchTeardown = null; }
    pdfJumpQueuedPageNum = null;
    viewerPdf = null;
    var panel = pdfPanelEl();
    if (panel) {
      panel.classList.remove('open');
      panel.setAttribute('aria-hidden', 'true');
    }
    var body = pdfBodyEl();
    if (body) body.innerHTML = '';
    var titleEl = document.getElementById('pog-pdf-title');
    if (titleEl) titleEl.textContent = '';
  }

  async function openHubPdfViewer(opts) {
    var url = opts && opts.url;
    if (!url) return;
    var page = opts && opts.page != null ? opts.page : 1;
    var title = opts && opts.title ? opts.title : 'Planogram PDF';

    var panel = pdfPanelEl();
    if (!panel) return;

    hubPdfPanelOpen = true;
    panel.classList.add('open');
    panel.setAttribute('aria-hidden', 'false');
    var titleEl = document.getElementById('pog-pdf-title');
    if (titleEl) titleEl.textContent = title;

    pdfJumpQueuedPageNum = page;
    await loadPdfIntoBody(url);
  }

  window.openHubPdfViewer = openHubPdfViewer;
  window.closeHubPdfViewer = closeHubPdfViewer;
  window.jumpToPdfPage = jumpToPdfPage;
  window.viewerPdfPageDelta = viewerPdfPageDelta;
  window.viewerZoom = viewerZoom;
  window.pogOpenSubView = function (viewKey) {
    if (viewKey === 'pdf' && window.__hubPendingPdfOpen) {
      return openHubPdfViewer(window.__hubPendingPdfOpen);
    }
    return Promise.resolve();
  };
})();
