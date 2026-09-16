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
      .eod-lsp-overlay {
        display: none; position: fixed; inset: 0; z-index: 50000;
        background: var(--bg, #0b1220); color: var(--text, #f8fafc); flex-direction: column;
        padding: env(safe-area-inset-top, 0px) env(safe-area-inset-right, 0px)
          env(safe-area-inset-bottom, 0px) env(safe-area-inset-left, 0px);
        touch-action: none; overflow: hidden;
        pointer-events: none;
      }
      .eod-lsp-overlay.show { display: flex; pointer-events: auto; }
      .eod-lsp-bar {
        display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
        padding: 8px 10px; background: var(--accent-dim, #0d4f8b); min-height: var(--touch, 44px);
        flex: 0 0 auto; z-index: 2;
      }
      .eod-lsp-bar strong { flex: 1; font-size: 15px; }
      .eod-lsp-bar button {
        appearance: none; -webkit-appearance: none; box-shadow: none;
        min-height: var(--touch, 44px); padding: 8px 12px; border-radius: 8px; border: none;
        font-weight: 700; font-size: 14px; cursor: pointer; color: #fff;
      }
      .eod-lsp-clear { background: #4b5563; }
      .eod-lsp-cancel { background: #334155; }
      .eod-lsp-accept { background: #166534; }
      .eod-lsp-stage {
        position: relative; flex: 1 1 auto; min-height: 0; background: var(--surface, #111827);
        touch-action: none; overscroll-behavior: none;
      }
      .eod-lsp-stage canvas {
        display: block; width: 100%; height: 100%; background: #fff;
        touch-action: none; pointer-events: auto;
      }
      .eod-lsp-hint { display: none !important; }
    `;
  }

  function unlockPageScroll() {
    const html = document.documentElement;
    const body = document.body;
    html.classList.remove('eod-lsp-open');
    body.classList.remove('eod-lsp-open');
    body.style.top = '';
    body.style.position = '';
    body.style.left = '';
    body.style.right = '';
    body.style.width = '';
    delete html.dataset.eodLspScroll;
  }

  function forceClose() {
    const overlay = document.getElementById('eodLandscapeSigOverlay');
    if (overlay && typeof overlay._eodLspCleanup === 'function') {
      overlay._eodLspCleanup(false);
      return;
    }
    overlay?.classList.remove('show');
    unlockPageScroll();
  }

  let _lspFontsInjected = false;
  function ensureLspGFonts() {
    if (_lspFontsInjected) return;
    _lspFontsInjected = true;
    if (!document.getElementById('eod-sig-gfonts')) {
      const link = document.createElement('link');
      link.id = 'eod-sig-gfonts';
      link.rel = 'stylesheet';
      link.href = 'https://fonts.googleapis.com/css2?family=Dancing+Script:wght@700&family=Pacifico&family=Great+Vibes&family=Caveat:wght@700&display=swap';
      document.head.appendChild(link);
    }
  }

  const LSP_FONTS = [
    { key: 'dancing',    label: 'Dancing Script', family: '"Dancing Script", cursive',  style: 'italic' },
    { key: 'pacifico',   label: 'Pacifico',        family: '"Pacifico", cursive',         style: 'normal' },
    { key: 'greatvibes', label: 'Great Vibes',     family: '"Great Vibes", cursive',      style: 'italic' },
    { key: 'caveat',     label: 'Caveat',           family: '"Caveat", cursive',           style: 'normal' },
  ];

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
          <button type="button" class="eod-lsp-type-btn" id="eodLspTypeBtn">Type</button>
          <button type="button" class="eod-lsp-cancel" id="eodLspCancel">Cancel</button>
          <button type="button" class="eod-lsp-accept" id="eodLspAccept">Use signature</button>
        </div>
        <div class="eod-lsp-stage" id="eodLspStage">
          <canvas id="eodLspCanvas"></canvas>
          <div id="eodLspTypePanel" class="eod-lsp-type-panel" style="display:none">
            <input type="text" id="eodLspTypeInput" class="eod-lsp-type-input" placeholder="Type your full name" autocomplete="name">
            <div id="eodLspFontGrid" class="eod-lsp-font-grid"></div>
            <div class="eod-lsp-type-preview-wrap"><canvas id="eodLspTypeCanvas"></canvas></div>
          </div>
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

    // Type-mode state
    let lspMode = 'draw'; // 'draw' | 'type'
    let lspTypedName = '';
    let lspSelectedFontIdx = 0;

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

    // ── Type mode ──────────────────────────────────────────────────────────
    function lspSwitchMode(m) {
      lspMode = m;
      const typePanel = document.getElementById('eodLspTypePanel');
      const typeBtn   = document.getElementById('eodLspTypeBtn');
      if (m === 'type') {
        canvas.style.display = 'none';
        if (typePanel) typePanel.style.display = '';
        if (typeBtn) { typeBtn.textContent = 'Draw'; typeBtn.classList.add('active'); }
        ensureLspGFonts();
        lspSizeTypeCanvas();
        lspRenderFontGrid();
        if (lspTypedName) lspRenderTypePreview();
        setTimeout(() => document.getElementById('eodLspTypeInput')?.focus(), 50);
      } else {
        canvas.style.display = '';
        if (typePanel) typePanel.style.display = 'none';
        if (typeBtn) { typeBtn.textContent = 'Type'; typeBtn.classList.remove('active'); }
      }
    }

    function lspSizeTypeCanvas() {
      const tc = document.getElementById('eodLspTypeCanvas');
      if (!tc) return;
      const wrap = tc.parentElement || stage;
      const w = Math.max(240, Math.floor(wrap.clientWidth || stage.clientWidth || 320));
      const h = Math.max(90, Math.floor(w * 0.22));
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      tc.width  = Math.floor(w * dpr);
      tc.height = Math.floor(h * dpr);
      tc.style.width  = `${w}px`;
      tc.style.height = `${h}px`;
      const c = tc.getContext('2d');
      c.setTransform(1, 0, 0, 1, 0, 0);
      c.fillStyle = '#fff';
      c.fillRect(0, 0, tc.width, tc.height);
      c.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    function lspRenderFontGrid() {
      const grid = document.getElementById('eodLspFontGrid');
      if (!grid) return;
      const preview = lspTypedName || 'Signature';
      grid.innerHTML = LSP_FONTS.map((f, i) =>
        `<button type="button" class="eod-lsp-font-btn${i === lspSelectedFontIdx ? ' active' : ''}" data-lfi="${i}" style="font-family:${f.family};font-style:${f.style};">${preview.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}</button>`
      ).join('');
      grid.querySelectorAll('.eod-lsp-font-btn').forEach((btn) => {
        btn.addEventListener('click', (e) => {
          e.preventDefault(); e.stopPropagation();
          lspSelectedFontIdx = +btn.getAttribute('data-lfi');
          lspRenderFontGrid();
          if (lspTypedName) lspRenderTypePreview();
        });
      });
    }

    function lspRenderTypePreview() {
      const tc = document.getElementById('eodLspTypeCanvas');
      if (!tc || !lspTypedName) return;
      const c = tc.getContext('2d');
      const d = Math.min(window.devicePixelRatio || 1, 2);
      const lw = tc.width / d, lh = tc.height / d;
      c.setTransform(1, 0, 0, 1, 0, 0);
      c.fillStyle = '#fff';
      c.fillRect(0, 0, tc.width, tc.height);
      c.setTransform(d, 0, 0, d, 0, 0);
      const f = LSP_FONTS[lspSelectedFontIdx];
      let fontSize = Math.max(18, Math.floor(lh * 0.52));
      let measured;
      for (let i = 0; i < 12; i++) {
        c.font = `${f.style} ${fontSize}px ${f.family}`;
        measured = c.measureText(lspTypedName);
        if (measured.width <= lw * 0.92) break;
        fontSize = Math.max(14, fontSize - 4);
      }
      c.fillStyle = '#111';
      c.fillText(lspTypedName, (lw - measured.width) / 2, lh * 0.66);
    }

    function lspRenderTypedToMainCanvas() {
      return new Promise((resolve) => {
        if (!lspTypedName) { resolve(false); return; }
        const f = LSP_FONTS[lspSelectedFontIdx];
        const w = canvas.width, h = canvas.height;
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const lw = w / dpr, lh = h / dpr;
        const fontStr = (sz) => `${f.style} ${sz}px ${f.family}`;
        let fontSize = Math.max(24, Math.floor(lh * 0.35));

        function doRender() {
          ctx.setTransform(1, 0, 0, 1, 0, 0);
          ctx.fillStyle = '#fff';
          ctx.fillRect(0, 0, w, h);
          ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
          let measured;
          for (let i = 0; i < 14; i++) {
            ctx.font = fontStr(fontSize);
            measured = ctx.measureText(lspTypedName);
            if (measured.width <= lw * 0.9) break;
            fontSize = Math.max(18, fontSize - 6);
          }
          ctx.fillStyle = '#111';
          ctx.fillText(lspTypedName, (lw - measured.width) / 2, lh * 0.60);
          resolve(true);
        }

        if (document.fonts && document.fonts.load) {
          document.fonts.load(fontStr(fontSize)).then(doRender, doRender);
        } else {
          setTimeout(doRender, 200);
        }
      });
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
      lspTypedName = '';
      const inp = document.getElementById('eodLspTypeInput');
      if (inp) inp.value = '';
      lspRenderFontGrid();
      sizeCanvas();
    };
    document.getElementById('eodLspLoad')?.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      // Switch back to draw mode so the loaded image shows on the main canvas
      lspSwitchMode('draw');
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
    document.getElementById('eodLspTypeBtn')?.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      lspSwitchMode(lspMode === 'type' ? 'draw' : 'type');
    });
    // Type input live updates
    document.getElementById('eodLspTypeInput')?.addEventListener('input', () => {
      lspTypedName = document.getElementById('eodLspTypeInput')?.value || '';
      lspRenderFontGrid();
      lspRenderTypePreview();
    });
    document.getElementById('eodLspCancel').onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      finish(false);
    };
    document.getElementById('eodLspAccept').onclick = async (e) => {
      e.preventDefault();
      e.stopPropagation();
      // If type mode: render to main canvas first
      if (lspMode === 'type') {
        if (!lspTypedName.trim()) {
          alert('Please type your name before continuing.');
          return;
        }
        await lspRenderTypedToMainCanvas();
        finish(true);
        return;
      }
      if (isBlank(canvas, ctx)) {
        alert('Please sign before continuing.');
        return;
      }
      finish(true);
    };

    overlay.classList.add('show');
    requestAnimationFrame(() => {
      sizeCanvas();
      requestAnimationFrame(sizeCanvas);
    });
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', onResize);
  }

  const api = { open, forceClose };
  if (typeof module === 'object' && module.exports) module.exports = api;
  global.EodLandscapeSigPad = api;
})(typeof window !== 'undefined' ? window : globalThis);
