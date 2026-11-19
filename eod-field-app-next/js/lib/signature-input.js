/* Shared 3-tab signature input: Draw | Type | Upload.
 * Used by dept-signatures.js inline sign step and any future inline sig surface.
 * landscape-sig-pad.js has its own Type mode added natively (different layout).
 *
 * Usage:
 *   const sigInput = EodSigInput.create(container, opts);
 *   const dataUrl = await sigInput.getDataUrl(); // '' if blank
 *   sigInput.clear();
 *
 * opts:
 *   existingDataUrl  — pre-load a data-URL into the draw canvas
 *   onChange(url)    — called (non-awaited) when the draw canvas changes
 *   heic             — EodHeic ref (falls back to window.EodHeic)
 */
(function (global) {
  'use strict';

  var FONTS = [
    { key: 'dancing',    label: 'Dancing Script', family: '"Dancing Script", cursive',  style: 'italic' },
    { key: 'pacifico',   label: 'Pacifico',        family: '"Pacifico", cursive',         style: 'normal' },
    { key: 'greatvibes', label: 'Great Vibes',     family: '"Great Vibes", cursive',      style: 'italic' },
    { key: 'caveat',     label: 'Caveat',           family: '"Caveat", cursive',           style: 'normal' },
  ];

  var _fontsInjected = false;

  function ensureGFonts() {
    if (_fontsInjected) return;
    _fontsInjected = true;
    if (!document.getElementById('eod-sig-gfonts')) {
      var link = document.createElement('link');
      link.id = 'eod-sig-gfonts';
      link.rel = 'stylesheet';
      link.href = 'https://fonts.googleapis.com/css2?family=Dancing+Script:wght@700&family=Pacifico&family=Great+Vibes&family=Caveat:wght@700&display=swap';
      document.head.appendChild(link);
    }
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function create(container, opts) {
    var o = opts || {};
    var mode = 'draw';
    var drawDataUrl = o.existingDataUrl || '';
    var selectedFontIdx = 0;
    var typedName = '';
    var uploadObjectUrl = null; // revoked on clear

    // ── HTML ────────────────────────────────────────────────────────────────
    container.innerHTML = [
      '<div class="esi-tabs" role="tablist">',
      '  <button type="button" class="esi-tab" role="tab" data-tab="draw">Draw</button>',
      '  <button type="button" class="esi-tab" role="tab" data-tab="type">Type</button>',
      '  <button type="button" class="esi-tab" role="tab" data-tab="upload">Upload</button>',
      '</div>',
      '<div class="esi-draw-panel">',
      '  <canvas class="esi-draw-canvas"></canvas>',
      '</div>',
      '<div class="esi-type-panel" style="display:none">',
      '  <input type="text" class="esi-name-input" placeholder="Type your full name" autocomplete="name">',
      '  <div class="esi-font-grid"></div>',
      '  <div class="esi-type-preview-wrap"><canvas class="esi-type-canvas"></canvas></div>',
      '</div>',
      '<div class="esi-upload-panel" style="display:none">',
      '  <button type="button" class="esi-choose-btn">Choose photo from device</button>',
      '  <canvas class="esi-upload-canvas" style="display:none"></canvas>',
      '  <input type="file" accept="image/*,.heic,.heif" class="esi-file-input" style="display:none">',
      '</div>',
    ].join('');

    // ── Refs ─────────────────────────────────────────────────────────────────
    var tabs      = container.querySelectorAll('.esi-tab');
    var drawPanel = container.querySelector('.esi-draw-panel');
    var typePanel = container.querySelector('.esi-type-panel');
    var upPanel   = container.querySelector('.esi-upload-panel');

    var drawCanvas   = container.querySelector('.esi-draw-canvas');
    var typeCanvas   = container.querySelector('.esi-type-canvas');
    var uploadCanvas = container.querySelector('.esi-upload-canvas');
    var nameInput    = container.querySelector('.esi-name-input');
    var fontGrid     = container.querySelector('.esi-font-grid');
    var chooseBtn    = container.querySelector('.esi-choose-btn');
    var fileInput    = container.querySelector('.esi-file-input');

    // ── Tab switching ────────────────────────────────────────────────────────
    tabs.forEach(function (tab) {
      tab.addEventListener('click', function () { switchMode(tab.getAttribute('data-tab')); });
    });

    function switchMode(m) {
      mode = m;
      tabs.forEach(function (t) {
        var active = t.getAttribute('data-tab') === m;
        t.classList.toggle('active', active);
        t.setAttribute('aria-selected', active ? 'true' : 'false');
      });
      drawPanel.style.display = m === 'draw'   ? '' : 'none';
      typePanel.style.display = m === 'type'   ? '' : 'none';
      upPanel.style.display   = m === 'upload' ? '' : 'none';

      if (m === 'type') {
        ensureGFonts();
        sizeCanvas(typeCanvas, true);
        renderFontGrid();
        if (typedName) renderTypePreview();
        setTimeout(function () { nameInput.focus(); }, 50);
      } else if (m === 'upload') {
        sizeCanvas(uploadCanvas, false);
        if (uploadObjectUrl) {
          uploadCanvas.style.display = '';
          loadImg(uploadCanvas, uploadObjectUrl);
        }
      }
    }

    // Activate draw tab initially
    (function () {
      tabs.forEach(function (t) {
        var active = t.getAttribute('data-tab') === 'draw';
        t.classList.toggle('active', active);
        t.setAttribute('aria-selected', active ? 'true' : 'false');
      });
    }());

    // ── DRAW ─────────────────────────────────────────────────────────────────
    sizeCanvas(drawCanvas, false);
    if (drawDataUrl) loadImg(drawCanvas, drawDataUrl);

    (function initDrawPad() {
      var ctx = drawCanvas.getContext('2d');
      ctx.strokeStyle = '#111';
      ctx.lineWidth = 3;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      var drawing = false;
      var last = { x: 0, y: 0 };
      var ptId = null;

      function dpr() { return Math.min(window.devicePixelRatio || 1, 2); }

      function canvasPos(e) {
        var rect = drawCanvas.getBoundingClientRect();
        var src = (e.touches && e.touches[0]) || (e.changedTouches && e.changedTouches[0]) || e;
        var d = dpr();
        return {
          x: (src.clientX - rect.left) * (drawCanvas.width / Math.max(rect.width, 1)) / d,
          y: (src.clientY - rect.top)  * (drawCanvas.height / Math.max(rect.height, 1)) / d,
        };
      }

      function ds(e) {
        drawing = true;
        if (e.pointerId != null && drawCanvas.setPointerCapture) {
          ptId = e.pointerId;
          try { drawCanvas.setPointerCapture(e.pointerId); } catch (_) {}
        }
        last = canvasPos(e);
        e.preventDefault(); e.stopPropagation();
      }
      function dm(e) {
        e.preventDefault(); e.stopPropagation();
        if (!drawing) return;
        var p = canvasPos(e);
        ctx.beginPath(); ctx.moveTo(last.x, last.y); ctx.lineTo(p.x, p.y); ctx.stroke();
        last = p;
      }
      function de(e) {
        if (e) {
          e.preventDefault(); e.stopPropagation();
          if (ptId != null && drawCanvas.releasePointerCapture) {
            try { drawCanvas.releasePointerCapture(ptId); } catch (_) {}
          }
        }
        if (drawing) {
          drawDataUrl = drawCanvas.toDataURL('image/png');
          if (typeof o.onChange === 'function') o.onChange(drawDataUrl);
        }
        drawing = false; ptId = null;
      }

      var po = { passive: false, capture: true };
      drawCanvas.addEventListener('pointerdown', ds, po);
      drawCanvas.addEventListener('pointermove', dm, po);
      drawCanvas.addEventListener('pointerup', de, po);
      drawCanvas.addEventListener('pointercancel', de, po);
      drawCanvas.addEventListener('touchstart', ds, po);
      drawCanvas.addEventListener('touchmove', dm, po);
      drawCanvas.addEventListener('touchend', de, po);
    }());

    // ── TYPE ─────────────────────────────────────────────────────────────────
    nameInput.addEventListener('input', function () {
      typedName = nameInput.value;
      renderFontGrid();
      renderTypePreview();
      if (typeof o.onChange === 'function') o.onChange('');
    });

    function renderFontGrid() {
      var preview = typedName || 'Signature';
      fontGrid.innerHTML = FONTS.map(function (f, i) {
        return '<button type="button" class="esi-font-btn' + (i === selectedFontIdx ? ' active' : '') + '"' +
          ' data-fi="' + i + '"' +
          ' style="font-family:' + f.family + ';font-style:' + f.style + ';">' +
          esc(preview) + '</button>';
      }).join('');
      fontGrid.querySelectorAll('.esi-font-btn').forEach(function (btn) {
        btn.addEventListener('click', function () {
          selectedFontIdx = +btn.getAttribute('data-fi');
          renderFontGrid();
          renderTypePreview();
          if (typeof o.onChange === 'function') o.onChange('');
        });
      });
    }

    function renderTypePreview() {
      var canvas = typeCanvas;
      var ctx = canvas.getContext('2d');
      var d = Math.min(window.devicePixelRatio || 1, 2);
      var lw = canvas.width / d;
      var lh = canvas.height / d;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.setTransform(d, 0, 0, d, 0, 0);
      var text = typedName;
      if (!text) return;
      var f = FONTS[selectedFontIdx];
      var fontSize = Math.max(18, Math.floor(lh * 0.52));
      var measured;
      for (var i = 0; i < 12; i++) {
        ctx.font = f.style + ' ' + fontSize + 'px ' + f.family;
        measured = ctx.measureText(text);
        if (measured.width <= lw * 0.92) break;
        fontSize = Math.max(14, fontSize - 4);
      }
      ctx.fillStyle = '#111827';
      ctx.fillText(text, (lw - measured.width) / 2, lh * 0.66);
    }

    // High-res typed render for final submission
    function buildTypedDataUrl() {
      return new Promise(function (resolve) {
        if (!typedName) { resolve(''); return; }
        var f = FONTS[selectedFontIdx];
        var W = 640, H = 200, d = 2;
        var tmp = document.createElement('canvas');
        tmp.width  = W * d;
        tmp.height = H * d;
        var ctx = tmp.getContext('2d');
        var fontSize = 84;
        var fontStr = function (sz) { return f.style + ' ' + sz + 'px ' + f.family; };

        function doRender() {
          ctx.setTransform(1, 0, 0, 1, 0, 0);
          ctx.fillStyle = '#fff';
          ctx.fillRect(0, 0, tmp.width, tmp.height);
          ctx.setTransform(d, 0, 0, d, 0, 0);
          var measured;
          for (var i = 0; i < 14; i++) {
            ctx.font = fontStr(fontSize);
            measured = ctx.measureText(typedName);
            if (measured.width <= W * 0.9) break;
            fontSize = Math.max(18, fontSize - 6);
          }
          ctx.fillStyle = '#111827';
          ctx.fillText(typedName, (W - measured.width) / 2, H * 0.66);
          resolve(tmp.toDataURL('image/png'));
        }

        // Wait for font if document.fonts is available
        if (document.fonts && document.fonts.load) {
          document.fonts.load(fontStr(fontSize)).then(doRender, doRender);
        } else {
          setTimeout(doRender, 200);
        }
      });
    }

    // ── UPLOAD ────────────────────────────────────────────────────────────────
    chooseBtn.addEventListener('click', function () { fileInput.click(); });
    fileInput.addEventListener('change', function () {
      var file = fileInput.files && fileInput.files[0];
      if (!file) return;
      var heic = o.heic || (typeof global.EodHeic !== 'undefined' ? global.EodHeic : null);
      var prep = heic && heic.prepareFile ? heic.prepareFile(file) : Promise.resolve(file);
      prep.then(function (converted) {
        if (uploadObjectUrl) { try { URL.revokeObjectURL(uploadObjectUrl); } catch (_) {} }
        var url = URL.createObjectURL(converted);
        uploadObjectUrl = url;
        sizeCanvas(uploadCanvas, false);
        uploadCanvas.style.display = '';
        loadImg(uploadCanvas, url);
        if (typeof o.onChange === 'function') o.onChange('');
      }).catch(function (err) {
        if (typeof global.showAlert === 'function') global.showAlert('Photo', err.message || String(err));
      });
    });

    // ── HELPERS ───────────────────────────────────────────────────────────────
    function sizeCanvas(canvas, small) {
      var wrap = canvas.parentElement || container;
      var w = Math.max(240, Math.floor(wrap.clientWidth || container.clientWidth || 280));
      var h = small
        ? Math.max(90, Math.floor(w * 0.25))
        : Math.max(160, Math.floor(w * 0.44));
      var d = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width  = Math.floor(w * d);
      canvas.height = Math.floor(h * d);
      canvas.style.width  = w + 'px';
      canvas.style.height = h + 'px';
      var ctx = canvas.getContext('2d');
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.setTransform(d, 0, 0, d, 0, 0);
    }

    function loadImg(canvas, src) {
      var ctx = canvas.getContext('2d');
      var d = Math.min(window.devicePixelRatio || 1, 2);
      var img = new Image();
      img.onload = function () {
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        var scale = Math.min(canvas.width / img.width, canvas.height / img.height, 1);
        var dw = img.width * scale, dh = img.height * scale;
        ctx.drawImage(img, (canvas.width - dw) / 2, (canvas.height - dh) / 2, dw, dh);
        ctx.setTransform(d, 0, 0, d, 0, 0);
      };
      img.src = src;
    }

    // ── PUBLIC API ────────────────────────────────────────────────────────────
    function getDataUrl() {
      if (mode === 'draw')   return Promise.resolve(drawDataUrl);
      if (mode === 'type')   return buildTypedDataUrl();
      if (mode === 'upload') {
        if (!uploadObjectUrl) return Promise.resolve('');
        return Promise.resolve(uploadCanvas.toDataURL('image/png'));
      }
      return Promise.resolve('');
    }

    function clear() {
      drawDataUrl = '';
      typedName   = '';
      if (uploadObjectUrl) { try { URL.revokeObjectURL(uploadObjectUrl); } catch (_) {} }
      uploadObjectUrl = null;
      nameInput.value = '';
      fileInput.value = '';
      uploadCanvas.style.display = 'none';
      sizeCanvas(drawCanvas, false);
      sizeCanvas(typeCanvas, true);
      sizeCanvas(uploadCanvas, false);
      renderFontGrid();
      switchMode('draw');
    }

    renderFontGrid();

    return { getDataUrl: getDataUrl, clear: clear };
  }

  global.EodSigInput = { create: create, FONTS: FONTS };
}(typeof window !== 'undefined' ? window : globalThis));
