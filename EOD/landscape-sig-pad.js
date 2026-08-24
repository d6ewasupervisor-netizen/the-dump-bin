/* Full-screen landscape signature pad for phones. */
(function (global) {
  'use strict';

  const STYLE_ID = 'eod-landscape-sig-pad-css';
  const HINT_MS = 1200;

  function ensureCss() {
    if (document.getElementById(STYLE_ID)) return;
    const css = document.createElement('style');
    css.id = STYLE_ID;
    css.textContent = `
      .eod-lsp-overlay {
        display: none; position: fixed; inset: 0; z-index: 30000;
        background: #0b1220; color: #f8fafc; flex-direction: column;
        padding: env(safe-area-inset-top, 0px) env(safe-area-inset-right, 0px)
          env(safe-area-inset-bottom, 0px) env(safe-area-inset-left, 0px);
      }
      .eod-lsp-overlay.show { display: flex; }
      .eod-lsp-bar {
        display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
        padding: 8px 10px; background: #0d4f8b; min-height: 48px;
      }
      .eod-lsp-bar strong { flex: 1; font-size: 15px; }
      .eod-lsp-bar .btn, .eod-lsp-bar button {
        min-height: 40px; padding: 8px 12px; border-radius: 8px; border: none;
        font-weight: 700; font-size: 14px; cursor: pointer;
      }
      .eod-lsp-clear { background: #e2e8f0; color: #0f172a; }
      .eod-lsp-cancel { background: #334155; color: #f8fafc; }
      .eod-lsp-accept { background: #22c55e; color: #052e16; }
      .eod-lsp-stage { position: relative; flex: 1; min-height: 0; background: #111827; }
      .eod-lsp-stage canvas {
        display: block; width: 100%; height: 100%; background: #fff; touch-action: none;
      }
      .eod-lsp-hint {
        position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
        background: rgba(15, 23, 42, 0.78); color: #fde68a; font-size: 22px; font-weight: 800;
        letter-spacing: 0.02em; text-align: center; padding: 24px; pointer-events: none;
        opacity: 0; transition: opacity 0.25s ease; z-index: 2;
      }
      .eod-lsp-hint.show { opacity: 1; }
    `;
    document.head.appendChild(css);
  }

  function ensureDom() {
    let overlay = document.getElementById('eodLandscapeSigOverlay');
    if (overlay) return overlay;
    overlay = document.createElement('div');
    overlay.id = 'eodLandscapeSigOverlay';
    overlay.className = 'eod-lsp-overlay';
    overlay.innerHTML = `
      <div class="eod-lsp-bar">
        <strong id="eodLspTitle">Sign</strong>
        <button type="button" class="eod-lsp-clear" id="eodLspClear">Clear</button>
        <button type="button" class="eod-lsp-cancel" id="eodLspCancel">Cancel</button>
        <button type="button" class="eod-lsp-accept" id="eodLspAccept">Use signature</button>
      </div>
      <div class="eod-lsp-stage">
        <canvas id="eodLspCanvas"></canvas>
        <div class="eod-lsp-hint" id="eodLspHint">Turn your device sideways</div>
      </div>`;
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
    const canvas = document.getElementById('eodLspCanvas');
    const ctx = canvas.getContext('2d');
    const hint = document.getElementById('eodLspHint');
    const title = document.getElementById('eodLspTitle');
    if (title) title.textContent = o.title || 'Sign';

    let drawing = false;
    let last = { x: 0, y: 0 };
    let snapshot = null;
    let closed = false;

    function sizeCanvas() {
      const stage = canvas.parentElement;
      const w = Math.max(320, Math.floor(stage.clientWidth || window.innerWidth));
      const h = Math.max(160, Math.floor(stage.clientHeight || window.innerHeight * 0.7));
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
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
      const t = e.touches ? e.touches[0] : e;
      return {
        x: (t.clientX - rect.left) * (canvas.width / rect.width) / (Math.min(window.devicePixelRatio || 1, 2)),
        y: (t.clientY - rect.top) * (canvas.height / rect.height) / (Math.min(window.devicePixelRatio || 1, 2)),
      };
    }

    function start(e) {
      drawing = true;
      last = pos(e);
      e.preventDefault();
    }
    function move(e) {
      if (!drawing) return;
      const p = pos(e);
      ctx.beginPath();
      ctx.moveTo(last.x, last.y);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
      last = p;
      e.preventDefault();
    }
    function stop() { drawing = false; }

    function onResize() {
      captureSnapshot();
      sizeCanvas();
    }

    function finish(accepted) {
      if (closed) return;
      closed = true;
      overlay.classList.remove('show');
      canvas.onmousedown = canvas.onmousemove = canvas.onmouseup = canvas.onmouseleave = null;
      canvas.ontouchstart = canvas.ontouchmove = canvas.ontouchend = null;
      window.removeEventListener('resize', onResize);
      window.removeEventListener('orientationchange', onResize);
      try { screen.orientation.unlock(); } catch (_) {}
      if (accepted) {
        const url = canvas.toDataURL('image/png');
        if (typeof o.onAccept === 'function') o.onAccept(url);
      } else if (typeof o.onCancel === 'function') {
        o.onCancel();
      }
    }

    canvas.onmousedown = start;
    canvas.onmousemove = move;
    canvas.onmouseup = stop;
    canvas.onmouseleave = stop;
    canvas.ontouchstart = start;
    canvas.ontouchmove = move;
    canvas.ontouchend = stop;
    document.getElementById('eodLspClear').onclick = () => {
      snapshot = null;
      o.existingDataUrl = null;
      sizeCanvas();
    };
    document.getElementById('eodLspCancel').onclick = () => finish(false);
    document.getElementById('eodLspAccept').onclick = () => {
      if (isBlank(canvas, ctx)) {
        alert('Please sign before continuing.');
        return;
      }
      finish(true);
    };

    overlay.classList.add('show');
    sizeCanvas();
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', onResize);
    try {
      const lock = screen.orientation && screen.orientation.lock;
      if (lock) lock.call(screen.orientation, 'landscape').catch(() => {});
    } catch (_) { /* iOS often denies */ }

    hint.classList.add('show');
    setTimeout(() => hint.classList.remove('show'), o.hintMs || HINT_MS);
  }

  const api = { open };
  if (typeof module === 'object' && module.exports) module.exports = api;
  global.EodLandscapeSigPad = api;
})(typeof window !== 'undefined' ? window : globalThis);
