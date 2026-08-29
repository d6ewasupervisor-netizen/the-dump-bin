/* Full-screen landscape signature pad for phones. */
(function (global) {
  'use strict';

  const STYLE_ID = 'eod-landscape-sig-pad-css';

  function ensureCss() {
    let css = document.getElementById(STYLE_ID);
    if (!css) {
      css = document.createElement('style');
      css.id = STYLE_ID;
      document.head.appendChild(css);
    }
    css.textContent = `
      html.eod-lsp-open, html.eod-lsp-open body {
        overflow: hidden !important;
        overscroll-behavior: none !important;
        height: 100% !important;
      }
      html.eod-lsp-open body {
        position: fixed !important;
        left: 0; right: 0; width: 100%;
      }
      .eod-lsp-overlay {
        display: none; position: fixed; inset: 0; z-index: 50000;
        background: #0b1220; color: #f8fafc; flex-direction: column;
        padding: env(safe-area-inset-top, 0px) env(safe-area-inset-right, 0px)
          env(safe-area-inset-bottom, 0px) env(safe-area-inset-left, 0px);
        touch-action: none; overscroll-behavior: none; overflow: hidden;
        pointer-events: auto;
      }
      .eod-lsp-overlay.show { display: flex; }
      .eod-lsp-bar {
        display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
        padding: 8px 10px; background: #0d4f8b; min-height: 48px;
        flex: 0 0 auto; z-index: 2;
      }
      .eod-lsp-bar strong { flex: 1; font-size: 15px; }
      .eod-lsp-bar button {
        appearance: none; -webkit-appearance: none; box-shadow: none;
        min-height: 40px; padding: 8px 12px; border-radius: 8px; border: none;
        font-weight: 700; font-size: 14px; cursor: pointer; color: #fff;
      }
      .eod-lsp-clear { background: #4b5563; }
      .eod-lsp-cancel { background: #334155; }
      .eod-lsp-accept { background: #166534; }
      .eod-lsp-stage {
        position: relative; flex: 1 1 auto; min-height: 0; background: #111827;
        touch-action: none; overscroll-behavior: none;
      }
      .eod-lsp-stage canvas {
        display: block; width: 100%; height: 100%; background: #fff;
        touch-action: none; pointer-events: auto;
      }
      .eod-lsp-hint { display: none !important; }
    `;
  }

  function lockPageScroll() {
    const html = document.documentElement;
    const body = document.body;
    const y = window.scrollY || window.pageYOffset || 0;
    html.dataset.eodLspScroll = String(y);
    html.classList.add('eod-lsp-open');
    body.classList.add('eod-lsp-open');
    body.style.top = `-${y}px`;
  }

  function unlockPageScroll() {
    const html = document.documentElement;
    const body = document.body;
    const y = Number(html.dataset.eodLspScroll || 0);
    html.classList.remove('eod-lsp-open');
    body.classList.remove('eod-lsp-open');
    body.style.top = '';
    delete html.dataset.eodLspScroll;
    window.scrollTo(0, y);
  }

  function ensureDom() {
    let overlay = document.getElementById('eodLandscapeSigOverlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'eodLandscapeSigOverlay';
      overlay.className = 'eod-lsp-overlay';
      overlay.innerHTML = `
        <div class="eod-lsp-bar">
          <strong id="eodLspTitle">Sign</strong>
          <button type="button" class="eod-lsp-clear" id="eodLspClear">Clear</button>
          <button type="button" class="eod-lsp-clear" id="eodLspLoad">Load photo</button>
          <button type="button" class="eod-lsp-cancel" id="eodLspCancel">Cancel</button>
          <button type="button" class="eod-lsp-accept" id="eodLspAccept">Use signature</button>
        </div>
        <div class="eod-lsp-stage" id="eodLspStage">
          <canvas id="eodLspCanvas"></canvas>
        </div>`;
    }
    document.body.appendChild(overlay);
    return overlay;
  }

  function isBlank(canvas, ctx) {
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i] < 250 || data[i + 1] < 250 || data[i + 2] < 250) return false;
    }
    return true;
  }

  function open(opts) {
    const o = opts || {};
    ensureCss();
    const overlay = ensureDom();
    if (typeof overlay._eodLspCleanup === 'function') overlay._eodLspCleanup(false);

    const canvas = document.getElementById('eodLspCanvas');
    const ctx = canvas.getContext('2d');
    const title = document.getElementById('eodLspTitle');
    const stage = document.getElementById('eodLspStage') || canvas.parentElement;
    if (title) title.textContent = o.title || 'Sign';

    let drawing = false;
    let last = { x: 0, y: 0 };
    let snapshot = null;
    let closed = false;
    let pointerId = null;

    function sizeCanvas() {
      const w = Math.max(280, Math.floor(stage.clientWidth || window.innerWidth || 320));
      const h = Math.max(160, Math.floor(stage.clientHeight || window.innerHeight * 0.7 || 200));
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      if (snapshot) ctx.drawImage(snapshot, 0, 0, canvas.width, canvas.height);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.strokeStyle = '#111';
      ctx.lineWidth = 3;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      if (!snapshot && o.existingDataUrl) {
        const img = new Image();
        img.onload = () => {
          ctx.setTransform(1, 0, 0, 1, 0, 0);
          const scale = Math.min(canvas.width / img.width, canvas.height / img.height, 1);
          const dw = img.width * scale;
          const dh = img.height * scale;
          ctx.drawImage(img, (canvas.width - dw) / 2, (canvas.height - dh) / 2, dw, dh);
          ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
          ctx.strokeStyle = '#111';
          ctx.lineWidth = 3;
          ctx.lineCap = 'round';
          ctx.lineJoin = 'round';
        };
        img.src = o.existingDataUrl;
      }
    }

    function captureSnapshot() {
      snapshot = document.createElement('canvas');
      snapshot.width = canvas.width;
      snapshot.height = canvas.height;
      snapshot.getContext('2d').drawImage(canvas, 0, 0);
    }

    function pos(e) {
      const rect = canvas.getBoundingClientRect();
      const src = e.touches && e.touches[0]
        ? e.touches[0]
        : (e.changedTouches && e.changedTouches[0]) || e;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      return {
        x: (src.clientX - rect.left) * (canvas.width / Math.max(rect.width, 1)) / dpr,
        y: (src.clientY - rect.top) * (canvas.height / Math.max(rect.height, 1)) / dpr,
      };
    }

    function start(e) {
      drawing = true;
      if (e.pointerId != null && canvas.setPointerCapture) {
        pointerId = e.pointerId;
        try { canvas.setPointerCapture(e.pointerId); } catch (_) { /* ignore */ }
      }
      last = pos(e);
      e.preventDefault();
      e.stopPropagation();
    }
    function move(e) {
      e.preventDefault();
      e.stopPropagation();
      if (!drawing) return;
      const p = pos(e);
      ctx.beginPath();
      ctx.moveTo(last.x, last.y);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
      last = p;
    }
    function stop(e) {
      if (e) {
        e.preventDefault();
        e.stopPropagation();
        if (pointerId != null && canvas.releasePointerCapture) {
          try { canvas.releasePointerCapture(pointerId); } catch (_) { /* ignore */ }
        }
      }
      drawing = false;
      pointerId = null;
    }

    function swallowPage(e) {
      const t = e.target;
      if (t === canvas || canvas.contains(t)) return;
      if (t && t.closest && t.closest('.eod-lsp-bar')) return;
      e.preventDefault();
      e.stopPropagation();
    }

    function onResize() {
      captureSnapshot();
      sizeCanvas();
    }

    function finish(accepted) {
      if (closed) return;
      closed = true;
      overlay._eodLspCleanup = null;
      overlay.classList.remove('show');
      canvas.removeEventListener('pointerdown', start);
      canvas.removeEventListener('pointermove', move);
      canvas.removeEventListener('pointerup', stop);
      canvas.removeEventListener('pointercancel', stop);
      canvas.removeEventListener('mousedown', start);
      canvas.removeEventListener('mousemove', move);
      canvas.removeEventListener('mouseup', stop);
      canvas.removeEventListener('mouseleave', stop);
      canvas.removeEventListener('touchstart', start);
      canvas.removeEventListener('touchmove', move);
      canvas.removeEventListener('touchend', stop);
      overlay.removeEventListener('touchmove', swallowPage);
      overlay.removeEventListener('wheel', swallowPage);
      overlay.removeEventListener('gesturestart', swallowPage);
      window.removeEventListener('resize', onResize);
      window.removeEventListener('orientationchange', onResize);
      try { screen.orientation.unlock(); } catch (_) {}
      unlockPageScroll();
      if (accepted) {
        const url = canvas.toDataURL('image/png');
        if (typeof o.onAccept === 'function') o.onAccept(url);
      } else if (typeof o.onCancel === 'function') {
        o.onCancel();
      }
    }

    overlay._eodLspCleanup = finish;

    const ptrOpts = { passive: false, capture: true };
    canvas.addEventListener('pointerdown', start, ptrOpts);
    canvas.addEventListener('pointermove', move, ptrOpts);
    canvas.addEventListener('pointerup', stop, ptrOpts);
    canvas.addEventListener('pointercancel', stop, ptrOpts);
    canvas.addEventListener('touchstart', start, ptrOpts);
    canvas.addEventListener('touchmove', move, ptrOpts);
    canvas.addEventListener('touchend', stop, ptrOpts);
    overlay.addEventListener('touchmove', swallowPage, { passive: false });
    overlay.addEventListener('wheel', swallowPage, { passive: false });
    overlay.addEventListener('gesturestart', swallowPage, { passive: false });
    document.getElementById('eodLspClear').onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      snapshot = null;
      o.existingDataUrl = null;
      sizeCanvas();
    };
    document.getElementById('eodLspLoad')?.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*,.heic,.heif';
      input.onchange = async () => {
        const file = input.files?.[0];
        if (!file) return;
        try {
          const converted = global.EodHeic?.prepareFile ? await global.EodHeic.prepareFile(file) : file;
          const url = URL.createObjectURL(converted);
          const img = new Image();
          img.onload = () => {
            snapshot = null;
            o.existingDataUrl = url;
            sizeCanvas();
          };
          img.src = url;
        } catch (err) {
          if (global.showAlert) global.showAlert('Photo', err.message || String(err));
        }
      };
      input.click();
    });
    document.getElementById('eodLspCancel').onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      finish(false);
    };
    document.getElementById('eodLspAccept').onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (isBlank(canvas, ctx)) {
        alert('Please sign before continuing.');
        return;
      }
      finish(true);
    };

    lockPageScroll();
    overlay.classList.add('show');
    requestAnimationFrame(() => {
      sizeCanvas();
      requestAnimationFrame(sizeCanvas);
    });
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', onResize);
  }

  const api = { open };
  if (typeof module === 'object' && module.exports) module.exports = api;
  global.EodLandscapeSigPad = api;
})(typeof window !== 'undefined' ? window : globalThis);
