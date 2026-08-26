/**
 * Always-available EOD feedback hub for the field pilot.
 * Captures the current screen and POSTs to /api/app-feedback.
 */
(function () {
  'use strict';

  const HTML2CANVAS_SRC = 'https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js';
  const MAX_EXTRAS = 6;
  const MAX_EDGE = 1280;
  const JPEG_Q = 0.72;

  let extras = [];
  let screenshot = '';
  let html2canvasPromise = null;

  function collectContext() {
    const S = window.EodSession?.state || {};
    const session = typeof window.dumpBinGetSession === 'function' ? window.dumpBinGetSession() : null;
    const hash = String(location.hash || '#/visit').replace(/^#\/?/, '').split('?')[0] || 'visit';
    return {
      screen: hash,
      screenLabel: hash,
      appVersion: window.EOD_APP_VERSION || '',
      url: String(location.href || ''),
      storeNumber: S.storeNumber || '',
      workDate: S.workDate || '',
      userName: S.profileName || '',
      userEmail: S.profileEmail || session?.email || '',
      leadName: S.leadName || '',
      viewport: `${window.innerWidth}x${window.innerHeight}`,
      dpr: String(window.devicePixelRatio || 1),
      online: String(navigator.onLine),
      userAgent: navigator.userAgent || '',
      testMode: String(!!window.EodTestMode?.isEnabled?.() || document.body.classList.contains('eod-test-mode')),
      sas: document.getElementById('sasConnDot')?.dataset?.state || '',
      si: document.getElementById('reboticsConnDot')?.dataset?.state || '',
    };
  }

  function loadHtml2Canvas() {
    if (window.html2canvas) return Promise.resolve(window.html2canvas);
    if (html2canvasPromise) return html2canvasPromise;
    html2canvasPromise = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = HTML2CANVAS_SRC;
      s.async = true;
      s.onload = () => (window.html2canvas ? resolve(window.html2canvas) : reject(new Error('html2canvas missing')));
      s.onerror = () => reject(new Error('Could not load screenshot helper'));
      document.head.appendChild(s);
    });
    return html2canvasPromise;
  }

  function canvasToJpeg(canvas) {
    let w = canvas.width;
    let h = canvas.height;
    if (w > MAX_EDGE || h > MAX_EDGE) {
      const scale = MAX_EDGE / Math.max(w, h);
      const out = document.createElement('canvas');
      out.width = Math.max(1, Math.round(w * scale));
      out.height = Math.max(1, Math.round(h * scale));
      out.getContext('2d').drawImage(canvas, 0, 0, out.width, out.height);
      return out.toDataURL('image/jpeg', JPEG_Q);
    }
    return canvas.toDataURL('image/jpeg', JPEG_Q);
  }

  function fileToJpeg(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        try {
          const canvas = document.createElement('canvas');
          let w = img.naturalWidth || img.width;
          let h = img.naturalHeight || img.height;
          const scale = Math.min(1, MAX_EDGE / Math.max(w, h, 1));
          canvas.width = Math.max(1, Math.round(w * scale));
          canvas.height = Math.max(1, Math.round(h * scale));
          canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
          URL.revokeObjectURL(url);
          resolve(canvas.toDataURL('image/jpeg', JPEG_Q));
        } catch (err) {
          URL.revokeObjectURL(url);
          reject(err);
        }
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error('Could not read image'));
      };
      img.src = url;
    });
  }

  async function captureViewport() {
    const html2canvas = await loadHtml2Canvas();
    document.body.classList.add('eod-feedback-capturing');
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    try {
      const target = document.querySelector('.app-shell') || document.body;
      const canvas = await html2canvas(target, {
        logging: false,
        useCORS: true,
        allowTaint: false,
        backgroundColor: '#111827',
        scale: 0.6,
        ignoreElements: (el) =>
          el.id === 'eodFeedbackFab' ||
          el.id === 'eodFeedbackOverlay',
      });
      const dataUrl = canvasToJpeg(canvas);
      if (!dataUrl || !dataUrl.startsWith('data:image')) throw new Error('empty screenshot');
      return dataUrl;
    } finally {
      document.body.classList.remove('eod-feedback-capturing');
    }
  }

  function ensureCss() {
    if (document.getElementById('eodFeedbackCss')) return;
    const css = document.createElement('style');
    css.id = 'eodFeedbackCss';
    css.textContent = `
      .eod-feedback-overlay { display:none; position:fixed; inset:0; z-index:1800; background:rgba(0,0,0,.72); overflow-y:auto; padding:12px; }
      .eod-feedback-overlay.show { display:block; }
      .eod-feedback-dialog { max-width:560px; margin:0 auto; background:#111827; border:1px solid #334155; border-radius:14px; padding:16px; color:#f9fafb; }
      .eod-feedback-dialog h2 { margin:0 0 8px; }
      .eod-fb-lead, .eod-fb-context, .eod-fb-status { color:#94a3b8; font-size:13px; margin:0 0 10px; }
      .eod-fb-kinds { display:flex; flex-wrap:wrap; gap:10px; margin:8px 0 12px; }
      .eod-feedback-dialog textarea { width:100%; min-height:90px; margin:6px 0 12px; }
      .eod-fb-shot img, .eod-fb-extras img { max-width:100%; border-radius:8px; margin-top:8px; }
      .eod-feedback-dialog .button-group { display:flex; }
      body.eod-feedback-capturing #eodFeedbackOverlay { display:none !important; }
    `;
    document.head.appendChild(css);
  }

  function ensureUi() {
    ensureCss();
    if (document.getElementById('eodFeedbackOverlay')) return;
    const overlay = document.createElement('div');
    overlay.id = 'eodFeedbackOverlay';
    overlay.className = 'eod-feedback-overlay';
    overlay.innerHTML = `
      <div class="eod-feedback-dialog" role="dialog" aria-labelledby="eodFbTitle">
        <h2 id="eodFbTitle">App feedback</h2>
        <p class="eod-fb-lead">Tell Tyson what to fix or build next. We attach this screen automatically.</p>
        <div class="eod-fb-context" id="eodFbContext"></div>
        <div class="eod-fb-kinds">
          <label><input type="radio" name="eodFbKind" value="bug"> Broken</label>
          <label><input type="radio" name="eodFbKind" value="confusing"> Confusing</label>
          <label><input type="radio" name="eodFbKind" value="idea" checked> Idea</label>
          <label><input type="radio" name="eodFbKind" value="other"> Other</label>
        </div>
        <label for="eodFbComment">What happened / what would help</label>
        <textarea id="eodFbComment" maxlength="8000"></textarea>
        <div class="eod-fb-shot">
          <button type="button" class="btn btn-secondary" id="eodFbRetake">Retake screenshot</button>
          <img id="eodFbShotImg" alt="Current screen screenshot" hidden>
        </div>
        <div>
          <label class="btn btn-secondary" style="display:inline-block;">
            Add photos
            <input type="file" id="eodFbFiles" accept="image/*" multiple hidden>
          </label>
          <div class="eod-fb-extras" id="eodFbExtras"></div>
        </div>
        <p class="eod-fb-status" id="eodFbStatus"></p>
        <div class="button-group" style="margin-top:8px;gap:8px;flex-wrap:wrap;">
          <button type="button" class="btn btn-primary" id="eodFbSend">Send to Tyson</button>
          <button type="button" class="btn btn-secondary" id="eodFbClose">Close</button>
        </div>
      </div>`;
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    document.body.appendChild(overlay);
    overlay.querySelector('#eodFbClose').onclick = () => close();
    overlay.querySelector('#eodFbRetake').onclick = () => retake();
    overlay.querySelector('#eodFbSend').onclick = () => send();
    overlay.querySelector('#eodFbFiles').addEventListener('change', onFiles);
  }

  function setStatus(msg, cls) {
    const el = document.getElementById('eodFbStatus');
    if (!el) return;
    el.textContent = msg || '';
    el.className = 'eod-fb-status' + (cls ? ' ' + cls : '');
  }

  function renderContext(ctx) {
    const el = document.getElementById('eodFbContext');
    if (!el) return;
    const bits = [
      ctx.screenLabel && `Screen: ${ctx.screenLabel}`,
      ctx.storeNumber && `Store #${ctx.storeNumber}`,
      ctx.workDate,
      ctx.appVersion && `v${String(ctx.appVersion).replace(/^v/i, '')}`,
      ctx.userName,
    ].filter(Boolean);
    el.textContent = bits.join(' · ') || 'No visit details yet.';
  }

  function renderShot() {
    const img = document.getElementById('eodFbShotImg');
    if (!img) return;
    if (screenshot) { img.src = screenshot; img.hidden = false; }
    else img.hidden = true;
  }

  function renderExtras() {
    const host = document.getElementById('eodFbExtras');
    if (!host) return;
    host.innerHTML = extras.map((src, i) => `<img src="${src}" alt="Extra ${i + 1}">`).join('');
  }

  async function retake() {
    setStatus('Capturing this screen…');
    try {
      screenshot = await captureViewport();
      renderShot();
      setStatus('Screenshot attached.');
    } catch (err) {
      screenshot = '';
      renderShot();
      setStatus('Could not capture the screen. You can still add photos and send.', 'error');
    }
  }

  async function onFiles(ev) {
    const files = [...(ev.target.files || [])];
    ev.target.value = '';
    for (const file of files) {
      if (extras.length >= MAX_EXTRAS) break;
      try { extras.push(await fileToJpeg(file)); } catch (err) {
        setStatus(err.message || 'Could not add that image', 'error');
      }
    }
    renderExtras();
  }

  async function open() {
    ensureUi();
    extras = [];
    screenshot = '';
    const overlay = document.getElementById('eodFeedbackOverlay');
    const comment = document.getElementById('eodFbComment');
    if (comment) comment.value = '';
    renderExtras();
    renderShot();
    renderContext(collectContext());
    overlay.classList.add('show');
    await retake();
    comment?.focus();
  }

  function close() {
    document.getElementById('eodFeedbackOverlay')?.classList.remove('show');
  }

  async function send() {
    const comment = (document.getElementById('eodFbComment')?.value || '').trim();
    if (!comment) {
      setStatus('Add a short comment so we know what to improve.', 'error');
      return;
    }
    const kind = document.querySelector('input[name="eodFbKind"]:checked')?.value || 'other';
    const ctx = collectContext();
    const btn = document.getElementById('eodFbSend');
    if (btn) btn.disabled = true;
    setStatus('Sending…');
    try {
      const api = window.EOD_API_BASE || 'https://eod-api.the-dump-bin.com';
      const resp = await (window.authFetch || fetch)(`${api}/api/app-feedback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kind, comment, screenshot, images: extras,
          storeNumber: ctx.storeNumber, workDate: ctx.workDate,
          screenLabel: ctx.screenLabel, appVersion: ctx.appVersion,
          userName: ctx.userName, context: ctx,
        }),
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok || !data.success) throw new Error(data.error || `Send failed (${resp.status})`);
      setStatus('Sent.', 'ok');
      setTimeout(() => close(), 1200);
    } catch (err) {
      setStatus(err.message || 'Send failed', 'error');
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  function init() {
    ensureUi();
    const banner = document.querySelector('.pilot-banner');
    if (banner && !document.getElementById('eodFeedbackFab')) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.id = 'eodFeedbackFab';
      btn.className = 'theme-cycle-btn';
      btn.textContent = 'Feedback';
      btn.onclick = () => open();
      banner.appendChild(btn);
    }
  }

  window.EodFeedbackHub = { open, close, init };
})();
