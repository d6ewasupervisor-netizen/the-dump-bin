/* Rotate / brightness / annotate for paper + helpdesk photos. */
(function (global) {
  'use strict';

  const STYLE_ID = 'eod-editor-css';

  function ensureCss() {
    if (document.getElementById(STYLE_ID)) return;
    const css = document.createElement('style');
    css.id = STYLE_ID;
    css.textContent = `
      .eod-ed-overlay {
        display: flex; position: fixed; inset: 0; z-index: 46000; background: #0b1220;
        flex-direction: column; color: #f8fafc;
      }
      .eod-ed-bar { display: flex; gap: 6px; flex-wrap: wrap; padding: 8px; background: #111827; }
      .eod-ed-stage { flex: 1; min-height: 0; display: flex; align-items: center; justify-content: center; background: #020617; }
      .eod-ed-stage canvas { max-width: 100%; max-height: 100%; touch-action: none; background: #111; }
    `;
    document.head.appendChild(css);
  }

  function open(opts) {
    const o = opts || {};
    const src = o.dataUrl;
    if (!src) return Promise.resolve(null);
    ensureCss();
    return new Promise((resolve) => {
      const overlay = document.createElement('div');
      overlay.className = 'eod-ed-overlay';
      overlay.innerHTML = `
        <div class="eod-ed-bar">
          <button type="button" class="btn btn-secondary" data-act="rot">Rotate</button>
          <button type="button" class="btn btn-secondary" data-act="bright">Bright +</button>
          <button type="button" class="btn btn-secondary" data-act="undo">Undo</button>
          <button type="button" class="btn btn-secondary" data-act="cancel">Cancel</button>
          <button type="button" class="btn btn-primary" data-act="ok">Use</button>
        </div>
        <div class="eod-ed-stage"><canvas></canvas></div>`;
      document.body.appendChild(overlay);
      const canvas = overlay.querySelector('canvas');
      const ctx = canvas.getContext('2d');
      const history = [];
      let drawing = false;
      let last = { x: 0, y: 0 };

      function snapshot() {
        try { history.push(ctx.getImageData(0, 0, canvas.width, canvas.height)); } catch (_) {}
        if (history.length > 20) history.shift();
      }

      function pos(e) {
        const rect = canvas.getBoundingClientRect();
        const srcEvt = e.touches?.[0] || e.changedTouches?.[0] || e;
        return {
          x: (srcEvt.clientX - rect.left) * (canvas.width / Math.max(rect.width, 1)),
          y: (srcEvt.clientY - rect.top) * (canvas.height / Math.max(rect.height, 1)),
        };
      }

      const img = new Image();
      img.onload = () => {
        canvas.width = img.naturalWidth || img.width;
        canvas.height = img.naturalHeight || img.height;
        ctx.drawImage(img, 0, 0);
        snapshot();
      };
      img.src = src;

      canvas.addEventListener('pointerdown', (e) => {
        drawing = true;
        last = pos(e);
        snapshot();
        e.preventDefault();
      });
      canvas.addEventListener('pointermove', (e) => {
        if (!drawing) return;
        const p = pos(e);
        ctx.strokeStyle = '#ef4444';
        ctx.lineWidth = Math.max(4, canvas.width / 400);
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(last.x, last.y);
        ctx.lineTo(p.x, p.y);
        ctx.stroke();
        last = p;
        e.preventDefault();
      });
      const stopDraw = () => { drawing = false; };
      canvas.addEventListener('pointerup', stopDraw);
      canvas.addEventListener('pointercancel', stopDraw);

      overlay.querySelector('[data-act="rot"]').onclick = () => {
        snapshot();
        const tmp = document.createElement('canvas');
        tmp.width = canvas.height;
        tmp.height = canvas.width;
        const tctx = tmp.getContext('2d');
        tctx.translate(tmp.width, 0);
        tctx.rotate(Math.PI / 2);
        tctx.drawImage(canvas, 0, 0);
        canvas.width = tmp.width;
        canvas.height = tmp.height;
        ctx.drawImage(tmp, 0, 0);
      };
      overlay.querySelector('[data-act="bright"]').onclick = () => {
        snapshot();
        const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const d = data.data;
        for (let i = 0; i < d.length; i += 4) {
          d[i] = Math.min(255, d[i] + 18);
          d[i + 1] = Math.min(255, d[i + 1] + 18);
          d[i + 2] = Math.min(255, d[i + 2] + 18);
        }
        ctx.putImageData(data, 0, 0);
      };
      overlay.querySelector('[data-act="undo"]').onclick = () => {
        const prev = history.pop();
        if (prev) ctx.putImageData(prev, 0, 0);
      };
      overlay.querySelector('[data-act="cancel"]').onclick = () => {
        overlay.remove();
        resolve(null);
      };
      overlay.querySelector('[data-act="ok"]').onclick = () => {
        const out = canvas.toDataURL('image/jpeg', 0.88);
        overlay.remove();
        if (typeof o.onSave === 'function') o.onSave(out);
        resolve(out);
      };
    });
  }

  global.EodPhotoEditor = { open };
  global.openImageEditor = function (idx, kind) {
    const arr = global.photos && global.photos[kind];
    const dataUrl = Array.isArray(arr) ? arr[idx] : null;
    if (!dataUrl) return;
    open({
      dataUrl,
      onSave: (url) => {
        if (kind === 'helpdesk' && typeof global.saveHelpdeskAnnotatedPhoto === 'function') {
          global.saveHelpdeskAnnotatedPhoto(url);
        }
      },
    });
  };
})(typeof window !== 'undefined' ? window : globalThis);
