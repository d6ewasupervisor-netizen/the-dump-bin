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

  function defaultCropQuad(w, h) {
    const m = Math.min(w, h) * 0.05;
    return {
      tl: { x: m, y: m },
      tr: { x: w - m, y: m },
      br: { x: w - m, y: h - m },
      bl: { x: m, y: h - m },
    };
  }

  function cloneCropQuad(quad) {
    return {
      tl: { x: quad.tl.x, y: quad.tl.y },
      tr: { x: quad.tr.x, y: quad.tr.y },
      br: { x: quad.br.x, y: quad.br.y },
      bl: { x: quad.bl.x, y: quad.bl.y },
    };
  }

  function clampPoint(p, w, h) {
    return {
      x: Math.max(0, Math.min(w, p.x)),
      y: Math.max(0, Math.min(h, p.y)),
    };
  }

  function quadPoint(quad, s, t) {
    const tl = quad.tl;
    const tr = quad.tr;
    const br = quad.br;
    const bl = quad.bl;
    return {
      x: (1 - s) * (1 - t) * tl.x + s * (1 - t) * tr.x + s * t * br.x + (1 - s) * t * bl.x,
      y: (1 - s) * (1 - t) * tl.y + s * (1 - t) * tr.y + s * t * br.y + (1 - s) * t * bl.y,
    };
  }

  function quadOutputSize(quad) {
    function dist(a, b) {
      return Math.hypot(a.x - b.x, a.y - b.y);
    }
    return {
      outW: Math.max(1, Math.round(Math.max(dist(quad.tl, quad.tr), dist(quad.bl, quad.br)))),
      outH: Math.max(1, Math.round(Math.max(dist(quad.tl, quad.bl), dist(quad.tr, quad.br)))),
    };
  }

  function sampleBilinear(imageData, x, y, w, h) {
    x = Math.max(0, Math.min(w - 1.001, x));
    y = Math.max(0, Math.min(h - 1.001, y));
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const x1 = Math.min(x0 + 1, w - 1);
    const y1 = Math.min(y0 + 1, h - 1);
    const fx = x - x0;
    const fy = y - y0;
    const d = imageData.data;
    const idx = (yy, xx) => (yy * w + xx) * 4;
    const out = [0, 0, 0, 255];
    for (let c = 0; c < 3; c++) {
      out[c] = Math.round(
        (1 - fx) * (1 - fy) * d[idx(y0, x0) + c] +
        fx * (1 - fy) * d[idx(y0, x1) + c] +
        fx * fy * d[idx(y1, x1) + c] +
        (1 - fx) * fy * d[idx(y1, x0) + c]
      );
    }
    return out;
  }

  function perspectiveCropCanvas(srcCanvas, quad) {
    const srcW = srcCanvas.width;
    const srcH = srcCanvas.height;
    const srcData = srcCanvas.getContext('2d').getImageData(0, 0, srcW, srcH);
    const { outW, outH } = quadOutputSize(quad);
    const out = document.createElement('canvas');
    out.width = outW;
    out.height = outH;
    const outCtx = out.getContext('2d');
    const outData = outCtx.createImageData(outW, outH);

    for (let dy = 0; dy < outH; dy++) {
      for (let dx = 0; dx < outW; dx++) {
        const s = outW <= 1 ? 0 : dx / (outW - 1);
        const t = outH <= 1 ? 0 : dy / (outH - 1);
        const sp = quadPoint(quad, s, t);
        const rgb = sampleBilinear(srcData, sp.x, sp.y, srcW, srcH);
        const oi = (dy * outW + dx) * 4;
        outData.data[oi] = rgb[0];
        outData.data[oi + 1] = rgb[1];
        outData.data[oi + 2] = rgb[2];
        outData.data[oi + 3] = 255;
      }
    }
    outCtx.putImageData(outData, 0, 0);
    return out;
  }

  function cropLayerHtml() {
    return (
      '<div class="bay-photo-crop-layer" id="bay-photo-crop-layer" hidden>' +
        '<svg class="bay-photo-crop-svg" id="bay-photo-crop-svg" aria-hidden="true">' +
          '<defs>' +
            '<mask id="bay-photo-crop-mask">' +
              '<rect id="bay-photo-crop-mask-bg" width="100%" height="100%" fill="white"></rect>' +
              '<polygon id="bay-photo-crop-mask-poly" fill="black"></polygon>' +
            '</mask>' +
          '</defs>' +
          '<rect width="100%" height="100%" fill="rgba(0,0,0,0.58)" mask="url(#bay-photo-crop-mask)"></rect>' +
          '<polygon id="bay-photo-crop-poly" fill="rgba(251,191,36,0.08)" stroke="#fbbf24" stroke-width="2"></polygon>' +
        '</svg>' +
        '<button type="button" class="bay-photo-crop-handle" data-corner="tl" aria-label="Top left corner"></button>' +
        '<button type="button" class="bay-photo-crop-handle" data-corner="tr" aria-label="Top right corner"></button>' +
        '<button type="button" class="bay-photo-crop-handle" data-corner="br" aria-label="Bottom right corner"></button>' +
        '<button type="button" class="bay-photo-crop-handle" data-corner="bl" aria-label="Bottom left corner"></button>' +
      '</div>'
    );
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
      '<div class="bay-photo-section">' +
        '<div class="bay-photo-ref-block">' + renderHubPreviewHtml(st.dbkey, 'bay-photo-ref-preview') +
          '<p class="bay-photo-ref-caption">Reference planogram</p></div>' +
        '<p class="bay-photo-guidance">' +
          'You will take <strong>one photo per bay</strong> in sequence. For each shot, step back until the ' +
          '<strong>entire bay</strong> (full width and height) fits in the frame and stays centered. ' +
          'After all bays are captured, you can crop, rotate, and auto-improve each photo before submitting.' +
        '</p>' +
        '<div class="flag-status" id="bay-photo-wizard-status"></div>' +
      '</div>';

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
      '<div class="bay-photo-section">' +
        '<div class="bay-photo-capture-progress"><div class="bay-photo-capture-progress-bar" style="width:' + progressPct + '%"></div></div>' +
        '<div class="bay-photo-stage">' + previewThumb + '</div>' +
        '<p class="bay-photo-editor-hint">' +
          (hasPhoto ? 'Photo captured — continue to the next bay or retake this one.' : 'Tap the button below to open your camera.') +
        '</p>' +
        '<input type="file" id="bay-photo-file-input" accept="image/*" capture="environment" hidden>' +
        '<div class="flag-status" id="bay-photo-wizard-status"></div>' +
      '</div>';

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
      '<div class="bay-photo-section">' +
        '<div class="bay-photo-review-grid">' + tiles + '</div>' +
        '<button type="button" class="btn bay-photo-recapture-link" id="bay-photo-recapture">← Re-capture photos</button>' +
        '<div class="flag-status" id="bay-photo-wizard-status"></div>' +
      '</div>';

    const ready = allCapturesReady(st);
    footer.innerHTML =
      '<button type="button" class="btn btn-submit bay-photo-submit-btn" id="bay-photo-submit-all"' +
        (ready ? '' : ' disabled') + '>Submit for approval</button>';

    body.querySelectorAll('[data-bay]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        st.editingBay = Number(btn.getAttribute('data-bay'));
        st.phase = 'edit';
        st.editCanvas = st.captures[st.editingBay] ? cloneCanvas(st.captures[st.editingBay]) : null;
        st.cropQuad = null;
        st.cropMode = false;
        st.draggingCorner = null;
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
      '<div class="bay-photo-section bay-photo-editor">' +
        '<div class="bay-photo-stage bay-photo-canvas-wrap" id="bay-photo-canvas-wrap">' +
          '<canvas id="bay-photo-canvas"></canvas>' +
          cropLayerHtml() +
        '</div>' +
        '<p class="bay-photo-editor-hint" id="bay-photo-crop-hint">Use Crop to drag each corner independently for perspective correction.</p>' +
        '<div class="bay-photo-tool-bar">' +
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
    bindCropHandles();

    document.getElementById('bay-photo-rotate-l')?.addEventListener('click', function () {
      if (!st.editCanvas) return;
      st.editCanvas = rotateCanvas(st.editCanvas, -90);
      st.cropQuad = null;
      exitCropMode(false);
      drawEditorCanvas();
    });
    document.getElementById('bay-photo-rotate-r')?.addEventListener('click', function () {
      if (!st.editCanvas) return;
      st.editCanvas = rotateCanvas(st.editCanvas, 90);
      st.cropQuad = null;
      exitCropMode(false);
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
        st.cropQuad = null;
        exitCropMode(false);
        drawEditorCanvas();
      });
    });

    document.getElementById('bay-photo-back-review')?.addEventListener('click', function () {
      st.phase = 'review';
      renderWizardPhase();
    });

    document.getElementById('bay-photo-save-edit')?.addEventListener('click', function () {
      if (st.cropMode) exitCropMode(true);
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
    syncCropOverlay();
  }

  function exitCropMode(apply) {
    const st = wizardState;
    const layer = document.getElementById('bay-photo-crop-layer');
    const btn = document.getElementById('bay-photo-crop-toggle');
    const hint = document.getElementById('bay-photo-crop-hint');
    if (apply && st && st.cropQuad && st.editCanvas) {
      st.editCanvas = perspectiveCropCanvas(st.editCanvas, st.cropQuad);
      st.cropQuad = null;
    }
    if (st) {
      st.cropMode = false;
      st.draggingCorner = null;
    }
    if (layer) {
      layer.hidden = true;
      layer.classList.remove('is-active');
    }
    if (btn) btn.classList.remove('active');
    if (hint) hint.textContent = 'Use Crop to drag each corner independently for perspective correction.';
  }

  function toggleCropMode() {
    const st = wizardState;
    if (!st || !st.editCanvas) return;
    if (st.cropMode) {
      exitCropMode(true);
      drawEditorCanvas();
      return;
    }
    st.cropMode = true;
    const w = st.editCanvas.width;
    const h = st.editCanvas.height;
    st.cropQuad = defaultCropQuad(w, h);
    const layer = document.getElementById('bay-photo-crop-layer');
    const btn = document.getElementById('bay-photo-crop-toggle');
    const hint = document.getElementById('bay-photo-crop-hint');
    if (layer) {
      layer.hidden = false;
      layer.classList.add('is-active');
    }
    if (btn) btn.classList.add('active');
    if (hint) hint.textContent = 'Drag any corner handle, then tap Crop again to apply.';
    syncCropOverlay();
  }

  function syncCropOverlay() {
    const st = wizardState;
    const canvas = document.getElementById('bay-photo-canvas');
    const layer = document.getElementById('bay-photo-crop-layer');
    if (!st || !st.cropMode || !st.cropQuad || !canvas || !layer) return;

    const scale = st.displayScale || 1;
    const dw = canvas.width;
    const dh = canvas.height;

    const svg = document.getElementById('bay-photo-crop-svg');
    const poly = document.getElementById('bay-photo-crop-poly');
    const maskPoly = document.getElementById('bay-photo-crop-mask-poly');
    const maskBg = document.getElementById('bay-photo-crop-mask-bg');
    if (svg) {
      svg.setAttribute('viewBox', '0 0 ' + dw + ' ' + dh);
    }
    if (maskBg) {
      maskBg.setAttribute('width', String(dw));
      maskBg.setAttribute('height', String(dh));
    }

    const pts = ['tl', 'tr', 'br', 'bl'].map(function (key) {
      const p = st.cropQuad[key];
      return (p.x * scale).toFixed(1) + ',' + (p.y * scale).toFixed(1);
    }).join(' ');

    if (poly) poly.setAttribute('points', pts);
    if (maskPoly) maskPoly.setAttribute('points', pts);

    layer.querySelectorAll('.bay-photo-crop-handle').forEach(function (handle) {
      const key = handle.getAttribute('data-corner');
      const p = st.cropQuad[key];
      if (!p) return;
      handle.style.left = (p.x * scale) + 'px';
      handle.style.top = (p.y * scale) + 'px';
    });
  }

  function bindCropHandles() {
    const layer = document.getElementById('bay-photo-crop-layer');
    if (!layer || layer.dataset.bound === '1') return;
    layer.dataset.bound = '1';

    let dragCorner = null;
    let dragStart = null;

    function onPointerDown(ev) {
      const st = wizardState;
      const handle = ev.target.closest('.bay-photo-crop-handle');
      if (!st || !st.cropMode || !handle) return;
      dragCorner = handle.getAttribute('data-corner');
      st.draggingCorner = dragCorner;
      const pt = ev.touches ? ev.touches[0] : ev;
      dragStart = { x: pt.clientX, y: pt.clientY, quad: cloneCropQuad(st.cropQuad) };
      ev.preventDefault();
    }

    function onPointerMove(ev) {
      if (!dragCorner || !dragStart) return;
      const st = wizardState;
      if (!st || !st.editCanvas) return;
      const pt = ev.touches ? ev.touches[0] : ev;
      const scale = st.displayScale || 1;
      const dx = (pt.clientX - dragStart.x) / scale;
      const dy = (pt.clientY - dragStart.y) / scale;
      const w = st.editCanvas.width;
      const h = st.editCanvas.height;
      st.cropQuad[dragCorner] = clampPoint({
        x: dragStart.quad[dragCorner].x + dx,
        y: dragStart.quad[dragCorner].y + dy,
      }, w, h);
      syncCropOverlay();
      ev.preventDefault();
    }

    function onPointerUp() {
      dragCorner = null;
      dragStart = null;
      if (wizardState) wizardState.draggingCorner = null;
    }

    layer.addEventListener('mousedown', onPointerDown);
    layer.addEventListener('mousemove', onPointerMove);
    layer.addEventListener('mouseup', onPointerUp);
    layer.addEventListener('mouseleave', onPointerUp);
    layer.addEventListener('touchstart', onPointerDown, { passive: false });
    layer.addEventListener('touchmove', onPointerMove, { passive: false });
    layer.addEventListener('touchend', onPointerUp);
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
