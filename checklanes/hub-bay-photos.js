/**
 * Bay completion photos — capture, edit, upload, and review for Checklane Hub.
 * Depends on hub globals: liveVisitId, hubGet, hubPost, hubSectionMutate, fetchPogLayout, pogUrl, escapeHtml.
 */
(function (global) {
  'use strict';

  const MAX_DIM = 2400;
  const JPEG_QUALITY = 0.84;

  let wizardState = null;

  function requiredBayNumsFromLayout(layout) {
    const bays = (layout && layout.bays) ? layout.bays.slice() : [];
    bays.sort(function (a, b) { return (a.bay_num || 0) - (b.bay_num || 0); });
    return bays.map(function (b) { return b.bay_num; }).filter(function (n) { return n != null; });
  }

  function hubAssignPreviewUrl(dbkey) {
    return pogUrl('/previews-cropped-webp/' + encodeURIComponent(dbkey) + '.webp');
  }

  function renderHubPreviewHtml(dbkey, className) {
    const url = hubAssignPreviewUrl(dbkey);
    const cls = className || 'hub-set-preview';
    return (
      '<img class="' + cls + '" src="' + escapeHtml(url) + '" alt="Planogram preview ' + escapeHtml(String(dbkey)) + '" loading="lazy" decoding="async" onerror="this.classList.add(\'is-hidden\')">'
    );
  }

  async function fetchBayPhotos(dbkey, lane) {
    const q = lane ? '?lane=' + encodeURIComponent(lane) : '';
    return hubGet('/sections/' + encodeURIComponent(dbkey) + '/bay-photos' + q);
  }

  async function uploadBayPhoto(dbkey, lane, bayNum, dataUrl) {
    return hubPost('/sections/' + encodeURIComponent(dbkey) + '/bay-photos/' + bayNum, {
      lane: lane || '',
      dataUrl: dataUrl,
    });
  }

  function loadImageFromFile(file) {
    return new Promise(function (resolve, reject) {
      const reader = new FileReader();
      reader.onload = function () {
        const img = new Image();
        img.onload = function () { resolve(img); };
        img.onerror = function () { reject(new Error('Could not load image')); };
        img.src = reader.result;
      };
      reader.onerror = function () { reject(new Error('Could not read file')); };
      reader.readAsDataURL(file);
    });
  }

  function canvasToDataUrl(canvas) {
    let w = canvas.width;
    let h = canvas.height;
    if (w > MAX_DIM || h > MAX_DIM) {
      const scale = MAX_DIM / Math.max(w, h);
      const tmp = document.createElement('canvas');
      tmp.width = Math.round(w * scale);
      tmp.height = Math.round(h * scale);
      const ctx = tmp.getContext('2d');
      ctx.drawImage(canvas, 0, 0, tmp.width, tmp.height);
      return tmp.toDataURL('image/jpeg', JPEG_QUALITY);
    }
    return canvas.toDataURL('image/jpeg', JPEG_QUALITY);
  }

  function imageToCanvas(img) {
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth || img.width;
    canvas.height = img.naturalHeight || img.height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0);
    return canvas;
  }

  function rotateCanvas(canvas, degrees) {
    const rad = (degrees * Math.PI) / 180;
    const w = canvas.width;
    const h = canvas.height;
    const out = document.createElement('canvas');
    if (degrees % 180 === 0) {
      out.width = w;
      out.height = h;
    } else {
      out.width = h;
      out.height = w;
    }
    const ctx = out.getContext('2d');
    ctx.translate(out.width / 2, out.height / 2);
    ctx.rotate(rad);
    ctx.drawImage(canvas, -w / 2, -h / 2);
    return out;
  }

  function autoImproveCanvas(canvas) {
    const ctx = canvas.getContext('2d');
    const { width, height } = canvas;
    const imageData = ctx.getImageData(0, 0, width, height);
    const data = imageData.data;
    let sum = 0;
    let count = 0;
    for (let i = 0; i < data.length; i += 16) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      sum += 0.299 * r + 0.587 * g + 0.114 * b;
      count += 1;
    }
    const avg = sum / Math.max(count, 1);
    const target = 128;
    const gain = Math.min(1.8, Math.max(0.6, target / Math.max(avg, 1)));
    for (let i = 0; i < data.length; i += 4) {
      data[i] = Math.min(255, data[i] * gain);
      data[i + 1] = Math.min(255, data[i + 1] * gain);
      data[i + 2] = Math.min(255, data[i + 2] * gain);
    }
    ctx.putImageData(imageData, 0, 0);
    return canvas;
  }

  function cropCanvas(canvas, rect) {
    const out = document.createElement('canvas');
    out.width = Math.max(1, Math.round(rect.w));
    out.height = Math.max(1, Math.round(rect.h));
    const ctx = out.getContext('2d');
    ctx.drawImage(canvas, rect.x, rect.y, rect.w, rect.h, 0, 0, rect.w, rect.h);
    return out;
  }

  function ensureModalDom() {
    if (document.getElementById('bay-photo-modal')) return;
    const el = document.createElement('div');
    el.id = 'bay-photo-modal';
    el.className = 'bay-photo-modal';
    el.setAttribute('aria-hidden', 'true');
    el.innerHTML =
      '<div class="bay-photo-modal-card">' +
        '<div class="bay-photo-modal-header">' +
          '<button type="button" class="bay-photo-modal-close" id="bay-photo-modal-close" aria-label="Close">&times;</button>' +
          '<h2 id="bay-photo-modal-title">Bay photos</h2>' +
          '<p class="bay-photo-modal-sub" id="bay-photo-modal-sub"></p>' +
        '</div>' +
        '<div class="bay-photo-modal-body" id="bay-photo-modal-body"></div>' +
        '<div class="bay-photo-modal-footer" id="bay-photo-modal-footer"></div>' +
      '</div>';
    document.body.appendChild(el);
    document.getElementById('bay-photo-modal-close').addEventListener('click', closeBayPhotoWizard);
    el.addEventListener('click', function (ev) {
      if (ev.target === el) closeBayPhotoWizard();
    });
  }

  function setModalVisible(open) {
    const modal = document.getElementById('bay-photo-modal');
    if (!modal) return;
    modal.classList.toggle('open', open);
    modal.setAttribute('aria-hidden', open ? 'false' : 'true');
    if (open && global.lockBodyScroll) global.lockBodyScroll();
    else if (!open && global.unlockBodyScroll) global.unlockBodyScroll();
  }

  function closeBayPhotoWizard() {
    wizardState = null;
    setModalVisible(false);
    const body = document.getElementById('bay-photo-modal-body');
    const footer = document.getElementById('bay-photo-modal-footer');
    if (body) body.innerHTML = '';
    if (footer) footer.innerHTML = '';
  }

  function renderBayListView() {
    const st = wizardState;
    if (!st) return;
    const body = document.getElementById('bay-photo-modal-body');
    const footer = document.getElementById('bay-photo-modal-footer');
    const title = document.getElementById('bay-photo-modal-title');
    const sub = document.getElementById('bay-photo-modal-sub');
    if (!body || !footer) return;

    title.textContent = 'Bay photos — before sign-off';
    sub.textContent = 'Take one photo per bay. Stand back far enough to capture the entire bay in frame, centered in your camera.';

    const previewHtml = renderHubPreviewHtml(st.dbkey, 'bay-photo-ref-preview');
    const rows = st.bayNums.map(function (bn) {
      const done = !!st.savedBays[bn];
      return (
        '<button type="button" class="bay-photo-list-item' + (done ? ' is-done' : '') + '" data-bay="' + bn + '">' +
          '<span class="bay-photo-list-label">Bay ' + bn + '</span>' +
          '<span class="bay-photo-list-status">' + (done ? '✓ Saved' : 'Add photo') + '</span>' +
        '</button>'
      );
    }).join('');

    body.innerHTML =
      '<div class="bay-photo-ref-block">' + previewHtml +
        '<p class="bay-photo-ref-caption">Reference planogram (cropped)</p>' +
      '</div>' +
      '<p class="bay-photo-guidance">' +
        'For each bay: step back until the <strong>full bay width and height</strong> fit in the frame. ' +
        'Keep the bay centered — avoid cutting off the top shelf or floor.' +
      '</p>' +
      '<div class="bay-photo-list">' + rows + '</div>' +
      '<div class="flag-status" id="bay-photo-wizard-status"></div>';

    const allDone = st.bayNums.every(function (bn) { return st.savedBays[bn]; });
    footer.innerHTML =
      '<button type="button" class="btn btn-submit bay-photo-submit-btn" id="bay-photo-submit-all"' +
        (allDone ? '' : ' disabled') + '>Submit for approval</button>';

    body.querySelectorAll('[data-bay]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        openBayEditor(Number(btn.getAttribute('data-bay')));
      });
    });

    document.getElementById('bay-photo-submit-all')?.addEventListener('click', submitBayPhotosForApproval);
  }

  function setWizardStatus(msg, kind) {
    const el = document.getElementById('bay-photo-wizard-status');
    if (!el) return;
    el.textContent = msg || '';
    el.className = 'flag-status' + (kind ? ' ' + kind : '');
  }

  function openBayEditor(bayNum) {
    const st = wizardState;
    if (!st) return;
    st.editingBay = bayNum;
    st.editCanvas = null;
    st.cropRect = null;
    st.cropMode = false;

    const body = document.getElementById('bay-photo-modal-body');
    const footer = document.getElementById('bay-photo-modal-footer');
    const title = document.getElementById('bay-photo-modal-title');
    const sub = document.getElementById('bay-photo-modal-sub');
    if (!body || !footer) return;

    title.textContent = 'Bay ' + bayNum + ' photo';
    sub.textContent = 'Capture the full bay centered in frame. Use edit tools if needed, then save.';

    body.innerHTML =
      '<div class="bay-photo-editor">' +
        '<div class="bay-photo-canvas-wrap" id="bay-photo-canvas-wrap">' +
          '<canvas id="bay-photo-canvas"></canvas>' +
          '<div class="bay-photo-crop-overlay" id="bay-photo-crop-overlay" hidden></div>' +
        '</div>' +
        '<p class="bay-photo-editor-hint" id="bay-photo-editor-hint">No photo yet — tap Take photo or choose from gallery.</p>' +
        '<input type="file" id="bay-photo-file-input" accept="image/*" capture="environment" hidden>' +
        '<div class="bay-photo-editor-tools">' +
          '<button type="button" class="btn" id="bay-photo-take">Take photo</button>' +
          '<button type="button" class="btn" id="bay-photo-rotate-l" disabled>↺ Rotate</button>' +
          '<button type="button" class="btn" id="bay-photo-rotate-r" disabled>Rotate ↻</button>' +
          '<button type="button" class="btn" id="bay-photo-improve" disabled>Auto improve</button>' +
          '<button type="button" class="btn" id="bay-photo-crop-toggle" disabled>Crop</button>' +
        '</div>' +
        '<div class="flag-status" id="bay-photo-editor-status"></div>' +
      '</div>';

    footer.innerHTML =
      '<button type="button" class="btn" id="bay-photo-back-list">← All bays</button>' +
      '<button type="button" class="btn btn-submit" id="bay-photo-save" disabled>Save bay photo</button>';

    const fileInput = document.getElementById('bay-photo-file-input');
    document.getElementById('bay-photo-take')?.addEventListener('click', function () { fileInput?.click(); });
    fileInput?.addEventListener('change', function () {
      const file = fileInput.files && fileInput.files[0];
      if (!file) return;
      loadImageFromFile(file).then(function (img) {
        st.editCanvas = imageToCanvas(img);
        drawEditorCanvas();
        enableEditorTools(true);
        setEditorHint('');
      }).catch(function (err) {
        setEditorStatus(err.message || 'Could not load photo', 'error');
      });
      fileInput.value = '';
    });

    document.getElementById('bay-photo-rotate-l')?.addEventListener('click', function () {
      if (!st.editCanvas) return;
      st.editCanvas = rotateCanvas(st.editCanvas, -90);
      st.cropRect = null;
      drawEditorCanvas();
    });
    document.getElementById('bay-photo-rotate-r')?.addEventListener('click', function () {
      if (!st.editCanvas) return;
      st.editCanvas = rotateCanvas(st.editCanvas, 90);
      st.cropRect = null;
      drawEditorCanvas();
    });
    document.getElementById('bay-photo-improve')?.addEventListener('click', function () {
      if (!st.editCanvas) return;
      autoImproveCanvas(st.editCanvas);
      drawEditorCanvas();
    });
    document.getElementById('bay-photo-crop-toggle')?.addEventListener('click', toggleCropMode);
    document.getElementById('bay-photo-back-list')?.addEventListener('click', renderBayListView);
    document.getElementById('bay-photo-save')?.addEventListener('click', function () { saveCurrentBayPhoto(bayNum); });

    if (st.savedBays[bayNum]) {
      loadExistingBayIntoEditor(bayNum);
    }
  }

  function setEditorStatus(msg, kind) {
    const el = document.getElementById('bay-photo-editor-status');
    if (!el) return;
    el.textContent = msg || '';
    el.className = 'flag-status' + (kind ? ' ' + kind : '');
  }

  function setEditorHint(msg) {
    const el = document.getElementById('bay-photo-editor-hint');
    if (el) el.textContent = msg || '';
  }

  function enableEditorTools(on) {
    ['bay-photo-rotate-l', 'bay-photo-rotate-r', 'bay-photo-improve', 'bay-photo-crop-toggle', 'bay-photo-save'].forEach(function (id) {
      const btn = document.getElementById(id);
      if (btn) btn.disabled = !on;
    });
  }

  async function loadExistingBayIntoEditor(bayNum) {
    const st = wizardState;
    if (!st) return;
    try {
      const q = st.lane ? '?lane=' + encodeURIComponent(st.lane) : '';
      const authFetch = global.dumpBinAuthFetch || fetch;
      const resp = await authFetch(
        '/api/hub/' + encodeURIComponent(liveVisitId) + '/sections/' + encodeURIComponent(st.dbkey) + '/bay-photos/' + bayNum + '/image' + q,
        { noBounceOn401: true },
      );
      if (!resp.ok) return;
      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);
      const img = new Image();
      img.onload = function () {
        st.editCanvas = imageToCanvas(img);
        drawEditorCanvas();
        enableEditorTools(true);
        URL.revokeObjectURL(url);
      };
      img.src = url;
    } catch (_) { /* ignore */ }
  }

  function drawEditorCanvas() {
    const st = wizardState;
    const canvas = document.getElementById('bay-photo-canvas');
    const wrap = document.getElementById('bay-photo-canvas-wrap');
    if (!canvas || !wrap || !st || !st.editCanvas) return;

    const src = st.editCanvas;
    const maxW = wrap.clientWidth || 320;
    const scale = Math.min(1, maxW / src.width);
    canvas.width = Math.round(src.width * scale);
    canvas.height = Math.round(src.height * scale);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(src, 0, 0, canvas.width, canvas.height);
    st.displayScale = scale;

    if (st.cropMode && st.cropRect) {
      drawCropOverlay(st.cropRect);
    }
  }

  function toggleCropMode() {
    const st = wizardState;
    if (!st || !st.editCanvas) return;
    st.cropMode = !st.cropMode;
    const overlay = document.getElementById('bay-photo-crop-overlay');
    const btn = document.getElementById('bay-photo-crop-toggle');
    if (overlay) overlay.hidden = !st.cropMode;
    if (btn) btn.classList.toggle('active', st.cropMode);
    if (st.cropMode) {
      const w = st.editCanvas.width;
      const h = st.editCanvas.height;
      st.cropRect = { x: w * 0.05, y: h * 0.05, w: w * 0.9, h: h * 0.9 };
      bindCropDrag();
      drawEditorCanvas();
      setEditorHint('Drag the crop box corners, then tap Crop again to apply.');
    } else if (st.cropRect) {
      st.editCanvas = cropCanvas(st.editCanvas, st.cropRect);
      st.cropRect = null;
      drawEditorCanvas();
      setEditorHint('');
    }
  }

  function bindCropDrag() {
    const wrap = document.getElementById('bay-photo-canvas-wrap');
    const canvas = document.getElementById('bay-photo-canvas');
    if (!wrap || !canvas) return;
    let dragging = false;
    let startX = 0;
    let startY = 0;
    let startRect = null;

    function pointerDown(ev) {
      const st = wizardState;
      if (!st || !st.cropMode || !st.cropRect) return;
      dragging = true;
      const pt = ev.touches ? ev.touches[0] : ev;
      startX = pt.clientX;
      startY = pt.clientY;
      startRect = { ...st.cropRect };
      ev.preventDefault();
    }

    function pointerMove(ev) {
      if (!dragging) return;
      const st = wizardState;
      if (!st || !startRect) return;
      const pt = ev.touches ? ev.touches[0] : ev;
      const scale = st.displayScale || 1;
      const dx = (pt.clientX - startX) / scale;
      const dy = (pt.clientY - startY) / scale;
      st.cropRect = {
        x: Math.max(0, startRect.x + dx),
        y: Math.max(0, startRect.y + dy),
        w: startRect.w,
        h: startRect.h,
      };
      drawEditorCanvas();
      ev.preventDefault();
    }

    function pointerUp() { dragging = false; }

    canvas.onmousedown = pointerDown;
    canvas.onmousemove = pointerMove;
    canvas.onmouseup = pointerUp;
    canvas.onmouseleave = pointerUp;
    canvas.ontouchstart = pointerDown;
    canvas.ontouchmove = pointerMove;
    canvas.ontouchend = pointerUp;
  }

  function drawCropOverlay(rect) {
    const overlay = document.getElementById('bay-photo-crop-overlay');
    const canvas = document.getElementById('bay-photo-canvas');
    if (!overlay || !canvas || !wizardState) return;
    const scale = wizardState.displayScale || 1;
    overlay.hidden = false;
    overlay.style.left = (rect.x * scale) + 'px';
    overlay.style.top = (rect.y * scale) + 'px';
    overlay.style.width = (rect.w * scale) + 'px';
    overlay.style.height = (rect.h * scale) + 'px';
  }

  async function saveCurrentBayPhoto(bayNum) {
    const st = wizardState;
    if (!st || !st.editCanvas) return;
    setEditorStatus('Saving…');
    const saveBtn = document.getElementById('bay-photo-save');
    if (saveBtn) saveBtn.disabled = true;
    try {
      const dataUrl = canvasToDataUrl(st.editCanvas);
      await uploadBayPhoto(st.dbkey, st.lane, bayNum, dataUrl);
      st.savedBays[bayNum] = true;
      setEditorStatus('Saved', 'ok');
      window.setTimeout(renderBayListView, 400);
    } catch (err) {
      setEditorStatus(err.message || 'Save failed', 'error');
      if (saveBtn) saveBtn.disabled = false;
    }
  }

  async function submitBayPhotosForApproval() {
    const st = wizardState;
    if (!st) return;
    const btn = document.getElementById('bay-photo-submit-all');
    if (btn) btn.disabled = true;
    setWizardStatus('Submitting for approval…');
    try {
      await hubSectionMutate(st.dbkey, st.lane, 'mark-done', { bayNums: st.bayNums });
      setWizardStatus('Submitted — awaiting lead sign-off', 'ok');
      if (typeof st.onComplete === 'function') st.onComplete();
      window.setTimeout(closeBayPhotoWizard, 600);
    } catch (err) {
      setWizardStatus(err.message || 'Submit failed', 'error');
      if (btn) btn.disabled = false;
    }
  }

  async function openBayPhotoWizard(opts) {
    const dbkey = opts && opts.dbkey;
    const lane = (opts && opts.lane) || '';
    if (!dbkey || !liveVisitId) return;

    ensureModalDom();
    setModalVisible(true);

    const body = document.getElementById('bay-photo-modal-body');
    if (body) body.innerHTML = '<p class="hub-panel-empty">Loading bays…</p>';

    let layout;
    try {
      layout = await fetchPogLayout(dbkey);
    } catch (err) {
      if (body) body.innerHTML = '<p class="flag-status error">' + escapeHtml(err.message || 'Could not load layout') + '</p>';
      return;
    }

    const bayNums = requiredBayNumsFromLayout(layout);
    if (!bayNums.length) {
      try {
        await hubSectionMutate(dbkey, lane, 'mark-done', { bayNums: [] });
        if (opts && typeof opts.onComplete === 'function') opts.onComplete();
        closeBayPhotoWizard();
      } catch (err) {
        if (body) body.innerHTML = '<p class="flag-status error">' + escapeHtml(err.message || 'Mark done failed') + '</p>';
      }
      return;
    }

    let savedBays = {};
    try {
      const existing = await fetchBayPhotos(dbkey, lane);
      (existing.photos || []).forEach(function (p) { savedBays[p.bay_num] = true; });
    } catch (_) { /* fresh start */ }

    wizardState = {
      dbkey: dbkey,
      lane: lane,
      bayNums: bayNums,
      savedBays: savedBays,
      onComplete: opts && opts.onComplete,
    };
    renderBayListView();
  }

  async function renderBayPhotosGalleryHtml(dbkey, lane) {
    try {
      const data = await fetchBayPhotos(dbkey, lane);
      const photos = data.photos || [];
      if (!photos.length) {
        return '<p class="hub-panel-empty">No bay photos submitted yet.</p>';
      }
      const containerId = 'bay-photo-gallery-' + String(dbkey) + '-' + String(lane || '');
      const tiles = photos.map(function (p) {
        return (
          '<figure class="bay-photo-gallery-item">' +
            '<img data-bay-photo-src="' + escapeHtml(p.url) + '" alt="Bay ' + p.bay_num + ' photo" loading="lazy">' +
            '<figcaption>Bay ' + p.bay_num + '</figcaption>' +
          '</figure>'
        );
      }).join('');
      window.setTimeout(function () {
        hydrateBayPhotoGalleryImages(containerId);
      }, 0);
      return '<div class="bay-photo-gallery" id="' + escapeHtml(containerId) + '">' + tiles + '</div>';
    } catch (err) {
      return '<p class="flag-status error">' + escapeHtml(err.message || 'Could not load bay photos') + '</p>';
    }
  }

  async function hydrateBayPhotoGalleryImages(containerId) {
    const root = document.getElementById(containerId);
    if (!root) return;
    const authFetch = global.dumpBinAuthFetch || fetch;
    const imgs = root.querySelectorAll('img[data-bay-photo-src]');
    for (let i = 0; i < imgs.length; i++) {
      const img = imgs[i];
      const src = img.getAttribute('data-bay-photo-src');
      if (!src) continue;
      try {
        const resp = await authFetch(src, { noBounceOn401: true });
        if (!resp.ok) continue;
        const blob = await resp.blob();
        img.src = URL.createObjectURL(blob);
        img.removeAttribute('data-bay-photo-src');
      } catch (_) { /* skip failed thumb */ }
    }
  }

  global.HubBayPhotos = {
    openBayPhotoWizard: openBayPhotoWizard,
    renderHubPreviewHtml: renderHubPreviewHtml,
    renderBayPhotosGalleryHtml: renderBayPhotosGalleryHtml,
    hubAssignPreviewUrl: hubAssignPreviewUrl,
    requiredBayNumsFromLayout: requiredBayNumsFromLayout,
  };
})(window);
