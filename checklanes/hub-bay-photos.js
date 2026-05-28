/**
 * Bay completion photos — continuous capture flow, batch review/edit, upload.
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

  function hubPreviewSources(dbkey) {
    const dk = encodeURIComponent(dbkey);
    return [
      pogUrl('/previews-cropped-webp/' + dk + '.webp'),
      pogUrl('/previews-cropped/' + dk + '.png'),
      pogUrl('/previews/' + dk + '.png'),
    ];
  }

  function hubAssignPreviewUrl(dbkey) {
    return hubPreviewSources(dbkey)[0];
  }

  /** Fallback chain when cropped webp is missing on CDN. */
  function hubPreviewImgOnError(img) {
    const step = Number(img.dataset.fbkStep || '0');
    const raw = img.dataset.fbkSources;
    if (!raw) {
      img.classList.add('is-hidden');
      return;
    }
    let sources;
    try { sources = JSON.parse(decodeURIComponent(raw)); } catch (_) { sources = []; }
    if (step < sources.length) {
      img.dataset.fbkStep = String(step + 1);
      img.src = sources[step];
    } else {
      img.classList.add('is-hidden');
    }
  }

  function renderHubPreviewHtml(dbkey, className) {
    const sources = hubPreviewSources(dbkey);
    const cls = className || 'hub-set-preview';
    const fbkEnc = encodeURIComponent(JSON.stringify(sources.slice(1)));
    return (
      '<img class="' + cls + '" src="' + escapeHtml(sources[0]) + '" ' +
      'data-fbk-sources="' + fbkEnc + '" data-fbk-step="0" ' +
      'alt="Planogram preview ' + escapeHtml(String(dbkey)) + '" loading="lazy" decoding="async" ' +
      'onerror="HubBayPhotos.hubPreviewImgOnError(this)">'
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
    const w = canvas.width;
    const h = canvas.height;
    if (w > MAX_DIM || h > MAX_DIM) {
      const scale = MAX_DIM / Math.max(w, h);
      const tmp = document.createElement('canvas');
      tmp.width = Math.round(w * scale);
      tmp.height = Math.round(h * scale);
      tmp.getContext('2d').drawImage(canvas, 0, 0, tmp.width, tmp.height);
      return tmp.toDataURL('image/jpeg', JPEG_QUALITY);
    }
    return canvas.toDataURL('image/jpeg', JPEG_QUALITY);
  }

  function canvasToThumbDataUrl(canvas, maxPx) {
    const w = canvas.width;
    const h = canvas.height;
    const scale = Math.min(1, (maxPx || 240) / Math.max(w, h));
    const tmp = document.createElement('canvas');
    tmp.width = Math.max(1, Math.round(w * scale));
    tmp.height = Math.max(1, Math.round(h * scale));
    tmp.getContext('2d').drawImage(canvas, 0, 0, tmp.width, tmp.height);
    return tmp.toDataURL('image/jpeg', 0.72);
  }

  function imageToCanvas(img) {
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth || img.width;
    canvas.height = img.naturalHeight || img.height;
    canvas.getContext('2d').drawImage(img, 0, 0);
    return canvas;
  }

  function rotateCanvas(canvas, degrees) {
    const rad = (degrees * Math.PI) / 180;
    const w = canvas.width;
    const h = canvas.height;
    const out = document.createElement('canvas');
    out.width = degrees % 180 === 0 ? w : h;
    out.height = degrees % 180 === 0 ? h : w;
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
      sum += 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
      count += 1;
    }
    const gain = Math.min(1.8, Math.max(0.6, 128 / Math.max(sum / Math.max(count, 1), 1)));
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
    out.getContext('2d').drawImage(canvas, rect.x, rect.y, rect.w, rect.h, 0, 0, rect.w, rect.h);
    return out;
  }

  function allCapturesReady(st) {
    return st.bayNums.every(function (bn) { return !!st.captures[bn]; });
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

  function setWizardStatus(msg, kind) {
    const el = document.getElementById('bay-photo-wizard-status');
    if (!el) return;
    el.textContent = msg || '';
    el.className = 'flag-status' + (kind ? ' ' + kind : '');
  }

  function renderWizardPhase() {
    const st = wizardState;
    if (!st) return;
    if (st.phase === 'intro') renderIntroPhase();
    else if (st.phase === 'capture') renderCapturePhase();
    else if (st.phase === 'review') renderReviewPhase();
    else if (st.phase === 'edit') renderEditPhase();
  }

  function renderIntroPhase() {
    const st = wizardState;
    const body = document.getElementById('bay-photo-modal-body');
    const footer = document.getElementById('bay-photo-modal-footer');
    document.getElementById('bay-photo-modal-title').textContent = 'Bay photos required';
    document.getElementById('bay-photo-modal-sub').textContent =
      st.bayNums.length + ' bay' + (st.bayNums.length !== 1 ? 's' : '') +
      ' — capture each one, then review and adjust before submitting.';

    body.innerHTML =
      '<div class="bay-photo-ref-block">' + renderHubPreviewHtml(st.dbkey, 'bay-photo-ref-preview') +
        '<p class="bay-photo-ref-caption">Reference planogram</p></div>' +
      '<p class="bay-photo-guidance">' +
        'You will take <strong>one photo per bay</strong> in sequence. For each shot, step back until the ' +
        '<strong>entire bay</strong> (full width and height) fits in the frame and stays centered. ' +
        'After all bays are captured, you can crop, rotate, and auto-improve each photo before submitting.' +
      '</p>' +
      '<div class="flag-status" id="bay-photo-wizard-status"></div>';

    footer.innerHTML =
      '<button type="button" class="btn btn-submit bay-photo-submit-btn" id="bay-photo-start-capture">Start capturing</button>';
    document.getElementById('bay-photo-start-capture')?.addEventListener('click', function () {
      st.phase = 'capture';
      st.captureIndex = 0;
      renderWizardPhase();
    });
  }

  function renderCapturePhase() {
    const st = wizardState;
    const body = document.getElementById('bay-photo-modal-body');
    const footer = document.getElementById('bay-photo-modal-footer');
    const idx = st.captureIndex;
    const bayNum = st.bayNums[idx];
    const total = st.bayNums.length;
    const hasPhoto = !!st.captures[bayNum];

    document.getElementById('bay-photo-modal-title').textContent = 'Bay ' + bayNum + ' · ' + (idx + 1) + ' of ' + total;
    document.getElementById('bay-photo-modal-sub').textContent =
      'Center the full bay in frame — stand far enough back to include top shelf through floor.';

    const progressPct = Math.round(((idx + (hasPhoto ? 1 : 0)) / total) * 100);
    const previewThumb = hasPhoto
      ? '<img class="bay-photo-capture-preview" src="' + canvasToThumbDataUrl(st.captures[bayNum]) + '" alt="Bay ' + bayNum + ' captured">'
      : '<div class="bay-photo-capture-placeholder">No photo yet</div>';

    body.innerHTML =
      '<div class="bay-photo-capture-progress"><div class="bay-photo-capture-progress-bar" style="width:' + progressPct + '%"></div></div>' +
      '<div class="bay-photo-capture-stage">' + previewThumb + '</div>' +
      '<p class="bay-photo-editor-hint">' +
        (hasPhoto ? 'Photo captured — continue to the next bay or retake this one.' : 'Tap the button below to open your camera.') +
      '</p>' +
      '<input type="file" id="bay-photo-file-input" accept="image/*" capture="environment" hidden>' +
      '<div class="flag-status" id="bay-photo-wizard-status"></div>';

    footer.innerHTML =
      (idx > 0 ? '<button type="button" class="btn" id="bay-photo-capture-back">← Previous bay</button>' : '') +
      '<button type="button" class="btn btn-submit bay-photo-capture-btn" id="bay-photo-capture-btn">' +
        (hasPhoto ? 'Retake photo' : 'Take photo') +
      '</button>' +
      (hasPhoto
        ? '<button type="button" class="btn btn-submit" id="bay-photo-capture-next">' +
            (idx >= total - 1 ? 'Review all photos →' : 'Next bay →') +
          '</button>'
        : '');

    const fileInput = document.getElementById('bay-photo-file-input');
    function openCamera() { fileInput?.click(); }

    document.getElementById('bay-photo-capture-btn')?.addEventListener('click', openCamera);
    fileInput?.addEventListener('change', function () {
      const file = fileInput.files && fileInput.files[0];
      fileInput.value = '';
      if (!file) return;
      loadImageFromFile(file).then(function (img) {
        st.captures[bayNum] = imageToCanvas(img);
        if (idx < total - 1) {
          st.captureIndex += 1;
          renderCapturePhase();
        } else {
          st.phase = 'review';
          renderWizardPhase();
        }
      }).catch(function (err) {
        setWizardStatus(err.message || 'Could not load photo', 'error');
      });
    });

    document.getElementById('bay-photo-capture-back')?.addEventListener('click', function () {
      if (st.captureIndex > 0) {
        st.captureIndex -= 1;
        renderCapturePhase();
      }
    });

    document.getElementById('bay-photo-capture-next')?.addEventListener('click', function () {
      if (idx >= total - 1) {
        st.phase = 'review';
        renderWizardPhase();
      } else {
        st.captureIndex += 1;
        renderCapturePhase();
      }
    });

    if (!hasPhoto) {
      window.setTimeout(openCamera, 400);
    }
  }

  function renderReviewPhase() {
    const st = wizardState;
    const body = document.getElementById('bay-photo-modal-body');
    const footer = document.getElementById('bay-photo-modal-footer');

    document.getElementById('bay-photo-modal-title').textContent = 'Review & adjust';
    document.getElementById('bay-photo-modal-sub').textContent =
      'Tap any photo to crop, rotate, or auto-improve. Submit when everything looks good.';

    const tiles = st.bayNums.map(function (bn) {
      const cap = st.captures[bn];
      const thumb = cap
        ? canvasToThumbDataUrl(cap, 320)
        : '';
      return (
        '<button type="button" class="bay-photo-review-tile" data-bay="' + bn + '">' +
          (thumb
            ? '<img src="' + thumb + '" alt="Bay ' + bn + '">'
            : '<span class="bay-photo-review-missing">Missing</span>') +
          '<span class="bay-photo-review-label">Bay ' + bn + '</span>' +
          '<span class="bay-photo-review-edit">Edit</span>' +
        '</button>'
      );
    }).join('');

    body.innerHTML =
      '<div class="bay-photo-review-grid">' + tiles + '</div>' +
      '<button type="button" class="btn bay-photo-recapture-link" id="bay-photo-recapture">← Re-capture photos</button>' +
      '<div class="flag-status" id="bay-photo-wizard-status"></div>';

    const ready = allCapturesReady(st);
    footer.innerHTML =
      '<button type="button" class="btn btn-submit bay-photo-submit-btn" id="bay-photo-submit-all"' +
        (ready ? '' : ' disabled') + '>Submit for approval</button>';

    body.querySelectorAll('[data-bay]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        st.editingBay = Number(btn.getAttribute('data-bay'));
        st.phase = 'edit';
        st.editCanvas = st.captures[st.editingBay] ? cloneCanvas(st.captures[st.editingBay]) : null;
        st.cropRect = null;
        st.cropMode = false;
        renderWizardPhase();
      });
    });

    document.getElementById('bay-photo-recapture')?.addEventListener('click', function () {
      st.phase = 'capture';
      st.captureIndex = 0;
      renderWizardPhase();
    });

    document.getElementById('bay-photo-submit-all')?.addEventListener('click', submitBayPhotosForApproval);
  }

  function cloneCanvas(canvas) {
    const out = document.createElement('canvas');
    out.width = canvas.width;
    out.height = canvas.height;
    out.getContext('2d').drawImage(canvas, 0, 0);
    return out;
  }

  function renderEditPhase() {
    const st = wizardState;
    const bayNum = st.editingBay;
    const body = document.getElementById('bay-photo-modal-body');
    const footer = document.getElementById('bay-photo-modal-footer');

    document.getElementById('bay-photo-modal-title').textContent = 'Edit — Bay ' + bayNum;
    document.getElementById('bay-photo-modal-sub').textContent = 'Adjust this photo, then save to return to review.';

    body.innerHTML =
      '<div class="bay-photo-editor">' +
        '<div class="bay-photo-canvas-wrap" id="bay-photo-canvas-wrap">' +
          '<canvas id="bay-photo-canvas"></canvas>' +
          '<div class="bay-photo-crop-overlay" id="bay-photo-crop-overlay" hidden></div>' +
        '</div>' +
        '<div class="bay-photo-editor-tools">' +
          '<button type="button" class="btn" id="bay-photo-rotate-l">↺ Rotate</button>' +
          '<button type="button" class="btn" id="bay-photo-rotate-r">Rotate ↻</button>' +
          '<button type="button" class="btn" id="bay-photo-improve">Auto improve</button>' +
          '<button type="button" class="btn" id="bay-photo-crop-toggle">Crop</button>' +
          '<button type="button" class="btn" id="bay-photo-retake-edit">Retake</button>' +
        '</div>' +
        '<input type="file" id="bay-photo-file-input-edit" accept="image/*" capture="environment" hidden>' +
        '<div class="flag-status" id="bay-photo-editor-status"></div>' +
      '</div>';

    footer.innerHTML =
      '<button type="button" class="btn" id="bay-photo-back-review">← Review all</button>' +
      '<button type="button" class="btn btn-submit" id="bay-photo-save-edit">Save</button>';

    drawEditorCanvas();

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

    const fileInput = document.getElementById('bay-photo-file-input-edit');
    document.getElementById('bay-photo-retake-edit')?.addEventListener('click', function () { fileInput?.click(); });
    fileInput?.addEventListener('change', function () {
      const file = fileInput.files && fileInput.files[0];
      fileInput.value = '';
      if (!file) return;
      loadImageFromFile(file).then(function (img) {
        st.editCanvas = imageToCanvas(img);
        drawEditorCanvas();
      });
    });

    document.getElementById('bay-photo-back-review')?.addEventListener('click', function () {
      st.phase = 'review';
      renderWizardPhase();
    });

    document.getElementById('bay-photo-save-edit')?.addEventListener('click', function () {
      if (st.editCanvas) st.captures[bayNum] = cloneCanvas(st.editCanvas);
      st.phase = 'review';
      renderWizardPhase();
    });
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
    canvas.getContext('2d').drawImage(src, 0, 0, canvas.width, canvas.height);
    st.displayScale = scale;
    if (st.cropMode && st.cropRect) drawCropOverlay(st.cropRect);
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
    } else if (st.cropRect) {
      st.editCanvas = cropCanvas(st.editCanvas, st.cropRect);
      st.cropRect = null;
      drawEditorCanvas();
    }
  }

  function bindCropDrag() {
    const canvas = document.getElementById('bay-photo-canvas');
    if (!canvas) return;
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
      startRect = { x: st.cropRect.x, y: st.cropRect.y, w: st.cropRect.w, h: st.cropRect.h };
      ev.preventDefault();
    }

    function pointerMove(ev) {
      if (!dragging) return;
      const st = wizardState;
      if (!st || !startRect) return;
      const pt = ev.touches ? ev.touches[0] : ev;
      const scale = st.displayScale || 1;
      st.cropRect = {
        x: Math.max(0, startRect.x + (pt.clientX - startX) / scale),
        y: Math.max(0, startRect.y + (pt.clientY - startY) / scale),
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
    if (!overlay || !wizardState) return;
    const scale = wizardState.displayScale || 1;
    overlay.hidden = false;
    overlay.style.left = (rect.x * scale) + 'px';
    overlay.style.top = (rect.y * scale) + 'px';
    overlay.style.width = (rect.w * scale) + 'px';
    overlay.style.height = (rect.h * scale) + 'px';
  }

  async function loadExistingCaptures(st) {
    try {
      const data = await fetchBayPhotos(st.dbkey, st.lane);
      const authFetch = global.dumpBinAuthFetch || fetch;
      for (let i = 0; i < (data.photos || []).length; i++) {
        const p = data.photos[i];
        const resp = await authFetch(p.url, { noBounceOn401: true });
        if (!resp.ok) continue;
        const blob = await resp.blob();
        const url = URL.createObjectURL(blob);
        await new Promise(function (resolve) {
          const img = new Image();
          img.onload = function () {
            st.captures[p.bay_num] = imageToCanvas(img);
            URL.revokeObjectURL(url);
            resolve();
          };
          img.onerror = resolve;
          img.src = url;
        });
      }
    } catch (_) { /* fresh session */ }
  }

  async function submitBayPhotosForApproval() {
    const st = wizardState;
    if (!st || !allCapturesReady(st)) return;
    const btn = document.getElementById('bay-photo-submit-all');
    if (btn) btn.disabled = true;
    setWizardStatus('Uploading photos…');

    try {
      for (let i = 0; i < st.bayNums.length; i++) {
        const bn = st.bayNums[i];
        const canvas = st.captures[bn];
        if (!canvas) throw new Error('Missing photo for bay ' + bn);
        setWizardStatus('Uploading bay ' + bn + '…');
        await uploadBayPhoto(st.dbkey, st.lane, bn, canvasToDataUrl(canvas));
      }
      setWizardStatus('Submitting for approval…');
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
    const footer = document.getElementById('bay-photo-modal-footer');
    if (body) body.innerHTML = '<p class="hub-panel-empty">Loading bays…</p>';
    if (footer) footer.innerHTML = '';

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

    wizardState = {
      phase: 'intro',
      dbkey: dbkey,
      lane: lane,
      bayNums: bayNums,
      captures: {},
      captureIndex: 0,
      onComplete: opts && opts.onComplete,
    };

    await loadExistingCaptures(wizardState);
    if (allCapturesReady(wizardState)) {
      wizardState.phase = 'review';
    }

    renderWizardPhase();
  }

  async function hydrateBayPhotoGalleryImages(root) {
    if (!root) return;
    const authFetch = global.dumpBinAuthFetch || fetch;
    const imgs = root.querySelectorAll('img[data-bay-photo-src]');
    for (let i = 0; i < imgs.length; i++) {
      const img = imgs[i];
      const src = img.getAttribute('data-bay-photo-src');
      if (!src) continue;
      try {
        const resp = await authFetch(src, { noBounceOn401: true });
        if (!resp.ok) {
          img.alt = 'Photo unavailable';
          img.classList.add('bay-photo-gallery-item--error');
          continue;
        }
        const blob = await resp.blob();
        img.src = URL.createObjectURL(blob);
        img.removeAttribute('data-bay-photo-src');
      } catch (_) {
        img.classList.add('bay-photo-gallery-item--error');
      }
    }
  }

  async function mountBayPhotosGallery(containerEl, dbkey, lane) {
    if (!containerEl) return;
    containerEl.innerHTML = '<p class="hub-panel-empty">Loading bay photos…</p>';
    try {
      const data = await fetchBayPhotos(dbkey, lane);
      const photos = data.photos || [];
      if (!photos.length) {
        containerEl.innerHTML = '<p class="hub-panel-empty">No bay photos submitted yet.</p>';
        return;
      }
      const tiles = photos.map(function (p) {
        return (
          '<figure class="bay-photo-gallery-item">' +
            '<img data-bay-photo-src="' + escapeHtml(p.url) + '" alt="Bay ' + p.bay_num + ' photo" loading="lazy">' +
            '<figcaption>Bay ' + p.bay_num + '</figcaption>' +
          '</figure>'
        );
      }).join('');
      containerEl.innerHTML = '<div class="bay-photo-gallery">' + tiles + '</div>';
      await hydrateBayPhotoGalleryImages(containerEl);
    } catch (err) {
      containerEl.innerHTML = '<p class="flag-status error">' + escapeHtml(err.message || 'Could not load bay photos') + '</p>';
    }
  }

  /** @deprecated use mountBayPhotosGallery */
  async function renderBayPhotosGalleryHtml(dbkey, lane) {
    const data = await fetchBayPhotos(dbkey, lane);
    const photos = data.photos || [];
    if (!photos.length) return '<p class="hub-panel-empty">No bay photos submitted yet.</p>';
    const containerId = 'bay-photo-gallery-' + String(dbkey) + '-' + String(lane || '') + '-' + Date.now();
    const tiles = photos.map(function (p) {
      return (
        '<figure class="bay-photo-gallery-item">' +
          '<img data-bay-photo-src="' + escapeHtml(p.url) + '" alt="Bay ' + p.bay_num + ' photo" loading="lazy">' +
          '<figcaption>Bay ' + p.bay_num + '</figcaption>' +
        '</figure>'
      );
    }).join('');
    window.setTimeout(function () { hydrateBayPhotoGalleryImages(document.getElementById(containerId)); }, 50);
    return '<div class="bay-photo-gallery" id="' + escapeHtml(containerId) + '">' + tiles + '</div>';
  }

  global.HubBayPhotos = {
    openBayPhotoWizard: openBayPhotoWizard,
    renderHubPreviewHtml: renderHubPreviewHtml,
    hubPreviewImgOnError: hubPreviewImgOnError,
    mountBayPhotosGallery: mountBayPhotosGallery,
    renderBayPhotosGalleryHtml: renderBayPhotosGalleryHtml,
    hubAssignPreviewUrl: hubAssignPreviewUrl,
    requiredBayNumsFromLayout: requiredBayNumsFromLayout,
  };
})(window);
