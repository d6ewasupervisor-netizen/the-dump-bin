/**
 * Always-available EOD feedback hub.
 * Captures the current screen, optional extras, and emails Tyson via eod-api.
 * Loaded by EOD/index.html — bump EOD_APP_VERSION when this file changes.
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

  function val(id) {
    return (document.getElementById(id)?.value || '').trim();
  }

  function collectContext() {
    const page = window.EodWorkspace?.currentPage || '';
    const pageMeta = (window.EodWorkspace?.PAGES || []).find((p) => p.id === page);
    const session = typeof window.dumpBinGetSession === 'function' ? window.dumpBinGetSession() : null;
    const overlays = [...document.querySelectorAll('.show, [open]')]
      .filter((el) => /overlay|modal|drawer|dialog/i.test(el.id + el.className))
      .map((el) => el.id || el.className.split(' ')[0])
      .slice(0, 12);
    return {
      screen: page,
      screenLabel: pageMeta?.label || page || 'unknown',
      appVersion: window.EOD_APP_VERSION || '',
      url: String(location.href || ''),
      storeNumber: val('storeNumber'),
      workDate: val('workDate'),
      userName: val('profileName'),
      userEmail: val('profileEmail') || session?.email || '',
      leadName: val('leadName'),
      viewport: `${window.innerWidth}x${window.innerHeight}`,
      dpr: String(window.devicePixelRatio || 1),
      online: String(navigator.onLine),
      userAgent: navigator.userAgent || '',
      testMode: String(!!window.eodTestMode || document.body.classList.contains('eod-test-mode')),
      sas: document.getElementById('sasConnDot')?.dataset?.state || '',
      si: document.getElementById('reboticsConnDot')?.dataset?.state || '',
      overlays: overlays.join(', '),
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
      const canvas = await html2canvas(document.body, {
        logging: false,
        useCORS: true,
        allowTaint: true,
        scale: Math.min(1, 2 / (window.devicePixelRatio || 1)),
        x: window.scrollX,
        y: window.scrollY,
        width: window.innerWidth,
        height: window.innerHeight,
        windowWidth: window.innerWidth,
        windowHeight: document.documentElement.scrollHeight,
        ignoreElements: (el) => el.id === 'eodFeedbackFab' || el.id === 'eodFeedbackOverlay',
      });
      return canvasToJpeg(canvas);
    } finally {
      document.body.classList.remove('eod-feedback-capturing');
    }
  }

  function ensureUi() {
    if (document.getElementById('eodFeedbackOverlay')) return;
    const fab = document.createElement('button');
    fab.type = 'button';
    fab.id = 'eodFeedbackFab';
    fab.className = 'eod-feedback-fab';
    fab.title = 'Send app feedback';
    fab.setAttribute('aria-label', 'Send app feedback');
    fab.innerHTML = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H8l-5 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>';
    fab.addEventListener('click', () => open());

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
        <textarea id="eodFbComment" maxlength="8000" placeholder="Be specific — what you tapped, what you expected, what you saw."></textarea>
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
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) close();
    });
    document.body.appendChild(fab);
    document.body.appendChild(overlay);
    overlay.querySelector('#eodFbClose').onclick = () => close();
    overlay.querySelector('#eodFbRetake').onclick = () => retake();
    overlay.querySelector('#eodFbSend').onclick = () => send();
    overlay.querySelector('#eodFbFiles').addEventListener('change', onFiles);
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && overlay.classList.contains('show')) close();
    });
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
    el.textContent = bits.join(' · ') || 'No visit details yet — still send if something is wrong.';
  }

  function renderShot() {
    const img = document.getElementById('eodFbShotImg');
    if (!img) return;
    if (screenshot) {
      img.src = screenshot;
      img.hidden = false;
    } else {
      img.hidden = true;
    }
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
      setStatus('Screenshot attached. Add a comment and send.');
    } catch (err) {
      screenshot = '';
      renderShot();
      setStatus('Could not capture the screen. You can still add photos and send.', 'error');
      console.warn('[eod-feedback]', err);
    }
  }

  async function onFiles(ev) {
    const files = [...(ev.target.files || [])];
    ev.target.value = '';
    for (const file of files) {
      if (extras.length >= MAX_EXTRAS) break;
      try {
        extras.push(await fileToJpeg(file));
      } catch (err) {
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
    document.body.classList.add('eod-feedback-open');
    await retake();
    comment?.focus();
  }

  function close() {
    document.getElementById('eodFeedbackOverlay')?.classList.remove('show');
    document.body.classList.remove('eod-feedback-open');
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
      const fetchFn = window.authFetch || fetch;
      const resp = await fetchFn(`${api}/api/app-feedback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kind,
          comment,
          screenshot,
          images: extras,
          storeNumber: ctx.storeNumber,
          workDate: ctx.workDate,
          screenLabel: ctx.screenLabel,
          appVersion: ctx.appVersion,
          userName: ctx.userName,
          context: ctx,
        }),
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok || !data.success) {
        throw new Error(data.error || `Send failed (${resp.status})`);
      }
      setStatus('Sent. Thank you — this helps the next version.', 'ok');
      setTimeout(() => close(), 1200);
    } catch (err) {
      setStatus(err.message || 'Send failed', 'error');
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  function init() {
    ensureUi();
  }

  window.EodFeedbackHub = { open, close, init };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
