/**
 * Department PIC set verification — SI photos in order, zoom/pan, annotate,
 * save, share, and mark the set complete. Layout follows the CP visit-flow
 * review lightbox (full-stage photo + footer actions).
 */
(function (global) {
  'use strict';

  const MIN_ZOOM = 1;
  const MAX_ZOOM = 6;
  const ZOOM_STEP = 1.25;
  const STYLE_ID = 'eod-set-review-css';

  function ensureCss() {
    if (document.getElementById(STYLE_ID)) return;
    const css = document.createElement('style');
    css.id = STYLE_ID;
    css.textContent = `
      .gh-review { display: flex; flex-direction: column; gap: 10px; padding-bottom: 24px; }
      .gh-review-bar { display: flex; align-items: flex-start; gap: 10px; }
      .gh-review-title { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
      .gh-film { display: flex; gap: 8px; overflow-x: auto; -webkit-overflow-scrolling: touch; padding: 4px 0 8px; }
      .gh-film-thumb {
        flex: 0 0 auto; width: 72px; border: 2px solid #e2e8f0;
        border-radius: 8px; background: #fff; padding: 0; cursor: pointer; overflow: hidden; color: inherit;
      }
      .gh-film-thumb img { display: block; width: 72px; height: 54px; object-fit: cover; }
      .gh-film-thumb span { display: block; font-size: 10px; padding: 2px 4px; color: #64748b; }
      .gh-film-thumb.is-active { border-color: #2563eb; }
      .gh-stage-wrap { border: 1px solid #e2e8f0; border-radius: 12px; background: #0f172a; overflow: hidden; }
      .gh-stage-vp { overflow: auto; max-height: min(70vh, 640px); touch-action: pan-x pan-y; -webkit-overflow-scrolling: touch; }
      .gh-stage-vp[data-mode="draw"] { touch-action: none; }
      .gh-stage { position: relative; display: inline-block; }
      .gh-stage img, .gh-stage canvas { display: block; max-width: none; }
      .gh-stage canvas { position: absolute; inset: 0; width: 100%; height: 100%; }
      .gh-stage-vp[data-mode="pan"] canvas { pointer-events: none; }
      .gh-stage-vp[data-mode="draw"] canvas { pointer-events: auto; }
      .gh-review-tools { display: flex; flex-direction: column; gap: 8px; }
      .gh-tool-row { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
      .gh-review-footer {
        position: sticky; bottom: 0; display: flex; align-items: center; gap: 10px;
        padding: 12px 0; background: inherit; border-top: 1px solid #334155;
      }
      .gh-set-done { color: #4ade80; font-size: 12px; font-weight: 700; }
      .gh-dept-extra { margin-top: 10px; border: 1px solid #334155; border-radius: 8px; }
      .gh-dept-extra summary {
        cursor: pointer; padding: 10px 12px; font-weight: 700; list-style: none;
      }
      .gh-dept-extra summary::-webkit-details-marker { display: none; }
      .gh-dept-extra[open] summary { border-bottom: 1px solid #334155; }
      .dept-sig-set-list { display: flex; flex-direction: column; gap: 6px; }
      .dept-sig-set-row {
        display: flex; flex-direction: column; align-items: flex-start; gap: 2px;
        width: 100%; text-align: left; padding: 12px; border-radius: 8px;
        border: 1px solid #334155; background: #0f172a; color: #f8fafc; cursor: pointer;
      }
      .dept-sig-set-row strong { color: #93c5fd; }
    `;
    document.head.appendChild(css);
  }

  function resolvePhotoUrl(api, path) {
    if (!path) return '';
    if (/^https?:\/\//i.test(path)) return path;
    const origin = String(api || '').replace(/\/api\/guest-handoff.*$/i, '');
    if (origin && path.startsWith('/')) return origin + path;
    try {
      return new URL(path, api || window.location.href).href;
    } catch (_) {
      return path;
    }
  }

  function escapeHtml(s) {
    return String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function rowComplete(row) {
    const marks = row?.marks || row?.mark;
    if (!marks) return false;
    if (marks.complete) return true;
    return Array.isArray(marks.active) && marks.active.includes('complete');
  }

  const packCache = new Map();

  function packKey(token, rowId) {
    return `${token}:${rowId}`;
  }

  function getPack(token, rowId) {
    return packCache.get(packKey(token, rowId)) || null;
  }

  function rememberPack(token, rowId, data) {
    if (!token || rowId == null || !data) return;
    packCache.set(packKey(token, rowId), data);
  }

  function warmupPhotos(photos, api) {
    (photos || []).forEach((p) => {
      const url = resolvePhotoUrl(api, p?.url || '');
      if (!url) return;
      const img = new Image();
      img.decoding = 'async';
      img.src = url;
    });
  }

  async function preloadRole({ api, token, roleKey }) {
    if (!api || !token || !roleKey) return;
    try {
      const resp = await fetch(`${api}/${encodeURIComponent(token)}/roles/${encodeURIComponent(roleKey)}/photos`);
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok || data.ok === false) return;
      Object.entries(data.sets || {}).forEach(([rowId, pack]) => {
        rememberPack(token, rowId, pack);
        warmupPhotos(pack?.photos, api);
      });
    } catch (_) {
      /* preload is best-effort */
    }
  }

  function createReview(opts) {
    ensureCss();
    const {
      root,
      api,
      token,
      row,
      onBack,
      onMarked,
    } = opts;
    let photos = [];
    let idx = 0;
    let scale = 1;
    let mode = 'pan';
    let drawing = false;
    let lastPt = null;
    let strokes = new Map();
    let imgNatural = { w: 0, h: 0 };

    function currentStrokes() {
      const id = photos[idx]?.actionId || photos[idx]?.id;
      if (!id) return [];
      if (!strokes.has(id)) strokes.set(id, []);
      return strokes.get(id);
    }

    function photoUrl(p, download) {
      const base = resolvePhotoUrl(api, p?.url || '');
      if (!base) return '';
      return download ? `${base}${base.includes('?') ? '&' : '?'}download=1` : base;
    }

    function renderShell() {
      const name = row.catName || row.cat_name || 'Set';
      const done = rowComplete(row);
      root.innerHTML = `
        <div class="gh-review">
          <div class="gh-review-bar">
            <button type="button" class="gh-btn gh-btn-secondary" id="ghReviewBack">← Sets</button>
            <div class="gh-review-title">
              <strong>${escapeHtml(name)}</strong>
              ${row.pog || row.dbkey ? `<span class="gh-muted">POG ${escapeHtml(row.pog || row.dbkey)}</span>` : ''}
              ${done ? '<span class="gh-set-done">Complete</span>' : ''}
            </div>
          </div>
          <p class="gh-muted" id="ghReviewStatus">Loading set photos…</p>
          <div class="gh-film" id="ghFilm" hidden></div>
          <div class="gh-stage-wrap" id="ghStageWrap" hidden>
            <div class="gh-stage-vp" id="ghStageVp">
              <div class="gh-stage" id="ghStage">
                <img id="ghReviewImg" alt="Set photo" draggable="false">
                <canvas id="ghAnnotate"></canvas>
              </div>
            </div>
          </div>
          <div class="gh-review-tools" id="ghReviewTools" hidden>
            <div class="gh-tool-row">
              <button type="button" class="gh-btn gh-btn-secondary" id="ghPrev">Prev</button>
              <span class="gh-muted" id="ghPhotoPos"></span>
              <button type="button" class="gh-btn gh-btn-secondary" id="ghNext">Next</button>
            </div>
            <div class="gh-tool-row">
              <button type="button" class="gh-btn gh-btn-secondary" data-mode="pan" id="ghModePan">Pan / zoom</button>
              <button type="button" class="gh-btn gh-btn-secondary" data-mode="draw" id="ghModeDraw">Annotate</button>
              <button type="button" class="gh-btn gh-btn-secondary" id="ghZoomOut">−</button>
              <button type="button" class="gh-btn gh-btn-secondary" id="ghZoomIn">+</button>
              <button type="button" class="gh-btn gh-btn-secondary" id="ghClearMarks">Clear marks</button>
            </div>
            <div class="gh-tool-row">
              <button type="button" class="gh-btn gh-btn-secondary" id="ghSavePhoto">Save to device</button>
              <button type="button" class="gh-btn gh-btn-secondary" id="ghSharePhoto">Share</button>
            </div>
            <p class="gh-muted" id="ghReviewErr" hidden></p>
          </div>
          <div class="gh-review-footer">
            ${done ? '<span class="gh-set-done" id="ghCompleteLabel">Complete</span>' : '<span class="gh-muted" id="ghCompleteLabel">Not complete</span>'}
            <button type="button" class="gh-btn gh-btn-primary" id="ghConfirmComplete">Confirm complete</button>
          </div>
        </div>`;
      document.getElementById('ghReviewBack')?.addEventListener('click', () => onBack?.());
    }

    function setStatus(text, isError) {
      const el = document.getElementById('ghReviewStatus');
      if (!el) return;
      el.textContent = text || '';
      el.classList.toggle('gh-error', !!isError);
      el.hidden = !text;
    }

    function syncModeButtons() {
      document.getElementById('ghModePan')?.classList.toggle('is-active', mode === 'pan');
      document.getElementById('ghModeDraw')?.classList.toggle('is-active', mode === 'draw');
      const vp = document.getElementById('ghStageVp');
      if (vp) vp.dataset.mode = mode;
    }

    function applyScale() {
      const stage = document.getElementById('ghStage');
      if (!stage) return;
      stage.style.transform = `scale(${scale})`;
      stage.style.transformOrigin = '0 0';
    }

    function fitStage() {
      const img = document.getElementById('ghReviewImg');
      const canvas = document.getElementById('ghAnnotate');
      const vp = document.getElementById('ghStageVp');
      if (!img || !canvas || !vp || !img.naturalWidth) return;
      imgNatural = { w: img.naturalWidth, h: img.naturalHeight };
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const maxW = Math.max(280, vp.clientWidth - 4);
      const displayW = Math.min(maxW, img.naturalWidth);
      const displayH = displayW * (img.naturalHeight / img.naturalWidth);
      img.style.width = `${displayW}px`;
      img.style.height = `${displayH}px`;
      canvas.style.width = `${displayW}px`;
      canvas.style.height = `${displayH}px`;
      const stage = document.getElementById('ghStage');
      if (stage) {
        stage.style.width = `${displayW}px`;
        stage.style.height = `${displayH}px`;
      }
      scale = 1;
      applyScale();
      redrawCanvas();
    }

    function redrawCanvas() {
      const canvas = document.getElementById('ghAnnotate');
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.strokeStyle = '#ef4444';
      ctx.lineWidth = Math.max(6, canvas.width / 180);
      for (const stroke of currentStrokes()) {
        if (!stroke.length) continue;
        ctx.beginPath();
        ctx.moveTo(stroke[0].x, stroke[0].y);
        for (let i = 1; i < stroke.length; i += 1) ctx.lineTo(stroke[i].x, stroke[i].y);
        ctx.stroke();
      }
    }

    function canvasPoint(e, canvas) {
      const rect = canvas.getBoundingClientRect();
      const t = e.touches ? e.touches[0] : e;
      const x = ((t.clientX - rect.left) / rect.width) * canvas.width;
      const y = ((t.clientY - rect.top) / rect.height) * canvas.height;
      return { x, y };
    }

    function showPhoto(i) {
      if (!photos.length) return;
      idx = Math.max(0, Math.min(photos.length - 1, i));
      const p = photos[idx];
      const img = document.getElementById('ghReviewImg');
      const pos = document.getElementById('ghPhotoPos');
      if (pos) pos.textContent = `${p.label || `Photo ${idx + 1}`} · ${idx + 1} of ${photos.length}`;
      document.querySelectorAll('.gh-film button').forEach((btn, n) => {
        btn.classList.toggle('is-active', n === idx);
      });
      if (img) {
        img.onload = () => fitStage();
        img.src = photoUrl(p);
        img.alt = p.label || `Photo ${idx + 1}`;
      }
    }

    function renderFilm() {
      const film = document.getElementById('ghFilm');
      if (!film) return;
      film.hidden = !photos.length;
      film.innerHTML = photos.map((p, i) => `
        <button type="button" class="gh-film-thumb${i === idx ? ' is-active' : ''}" data-idx="${i}" title="${escapeHtml(p.label || '')}">
          <img src="${escapeHtml(photoUrl(p))}" alt="${escapeHtml(p.label || `Photo ${i + 1}`)}">
          <span>${escapeHtml(p.label || String(i + 1))}</span>
        </button>`).join('');
      film.querySelectorAll('button').forEach((btn) => {
        btn.addEventListener('click', () => showPhoto(Number(btn.dataset.idx)));
      });
    }

    async function compositeBlob() {
      const img = document.getElementById('ghReviewImg');
      const overlay = document.getElementById('ghAnnotate');
      if (!img?.naturalWidth) throw new Error('Photo is still loading');
      const out = document.createElement('canvas');
      out.width = img.naturalWidth;
      out.height = img.naturalHeight;
      const ctx = out.getContext('2d');
      ctx.drawImage(img, 0, 0);
      if (overlay) ctx.drawImage(overlay, 0, 0);
      return new Promise((resolve, reject) => {
        out.toBlob((blob) => {
          if (!blob) reject(new Error('Could not export photo'));
          else resolve(blob);
        }, 'image/jpeg', 0.95);
      });
    }

    function fileName() {
      const p = photos[idx] || {};
      const set = String(row.catName || row.cat_name || 'set').replace(/[^\w.-]+/g, '_').slice(0, 40);
      return `${set}_${p.label || `photo-${idx + 1}`}.jpg`.replace(/\s+/g, '_');
    }

    async function savePhoto() {
      try {
        const blob = await compositeBlob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = fileName();
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 2000);
      } catch (err) {
        alert(err.message || 'Save failed');
      }
    }

    async function sharePhoto() {
      try {
        const blob = await compositeBlob();
        const file = new File([blob], fileName(), { type: 'image/jpeg' });
        const payload = {
          files: [file],
          title: row.catName || 'Set photo',
          text: `${row.catName || 'Set'} · ${photos[idx]?.label || ''}`.trim(),
        };
        if (navigator.share) {
          if (!navigator.canShare || navigator.canShare(payload) || navigator.canShare({ text: payload.text })) {
            await navigator.share(payload);
            return;
          }
        }
        await savePhoto();
      } catch (err) {
        if (err?.name === 'AbortError') return;
        try { await savePhoto(); } catch { alert(err.message || 'Share failed'); }
      }
    }

    async function markComplete() {
      const btn = document.getElementById('ghConfirmComplete');
      const errEl = document.getElementById('ghReviewErr');
      const label = document.getElementById('ghCompleteLabel');
      if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }
      if (errEl) errEl.hidden = true;
      try {
        if (opts.skipRemoteMark) {
          if (label) {
            label.className = 'gh-set-done';
            label.textContent = 'Complete';
          }
          onMarked?.(row);
          return true;
        }
        const resp = await fetch(`${api}/${encodeURIComponent(token)}/sets/${encodeURIComponent(row.id)}/complete`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        });
        const data = await resp.json().catch(() => ({}));
        if (!resp.ok || data.ok === false) throw new Error(data.error || `Save failed (${resp.status})`);
        if (data.row) Object.assign(row, data.row);
        if (label) {
          label.className = 'gh-set-done';
          label.textContent = 'Complete';
        }
        onMarked?.(data.row || row);
        return true;
      } catch (err) {
        if (errEl) {
          errEl.textContent = err.message || 'Could not mark complete';
          errEl.hidden = false;
        }
        return false;
      } finally {
        if (btn) { btn.disabled = false; btn.textContent = 'Confirm complete'; }
      }
    }

    async function confirmComplete() {
      if (!rowComplete(row)) {
        const ok = await markComplete();
        if (!ok) return;
      }
      if (typeof opts.onConfirmComplete === 'function') {
        opts.onConfirmComplete({ row, alreadySigned: !!opts.alreadySigned });
      }
    }

    function bindTools() {
      document.getElementById('ghPrev')?.addEventListener('click', () => showPhoto(idx - 1));
      document.getElementById('ghNext')?.addEventListener('click', () => showPhoto(idx + 1));
      document.getElementById('ghZoomIn')?.addEventListener('click', () => {
        scale = Math.min(MAX_ZOOM, scale * ZOOM_STEP);
        applyScale();
      });
      document.getElementById('ghZoomOut')?.addEventListener('click', () => {
        scale = Math.max(MIN_ZOOM, scale / ZOOM_STEP);
        applyScale();
      });
      document.getElementById('ghModePan')?.addEventListener('click', () => { mode = 'pan'; syncModeButtons(); });
      document.getElementById('ghModeDraw')?.addEventListener('click', () => { mode = 'draw'; syncModeButtons(); });
      document.getElementById('ghClearMarks')?.addEventListener('click', () => {
        const id = photos[idx]?.actionId;
        if (id) strokes.set(id, []);
        redrawCanvas();
      });
      document.getElementById('ghSavePhoto')?.addEventListener('click', () => savePhoto().catch(console.error));
      document.getElementById('ghSharePhoto')?.addEventListener('click', () => sharePhoto().catch(console.error));
      document.getElementById('ghConfirmComplete')?.addEventListener('click', () => confirmComplete());

      const canvas = document.getElementById('ghAnnotate');
      const vp = document.getElementById('ghStageVp');
      if (!canvas || !vp) return;

      function startDraw(e) {
        if (mode !== 'draw') return;
        drawing = true;
        lastPt = canvasPoint(e, canvas);
        currentStrokes().push([lastPt]);
        e.preventDefault();
      }
      function moveDraw(e) {
        if (!drawing || mode !== 'draw') return;
        const pt = canvasPoint(e, canvas);
        const stroke = currentStrokes()[currentStrokes().length - 1];
        if (stroke) stroke.push(pt);
        lastPt = pt;
        redrawCanvas();
        e.preventDefault();
      }
      function endDraw() { drawing = false; }

      canvas.addEventListener('mousedown', startDraw);
      canvas.addEventListener('mousemove', moveDraw);
      canvas.addEventListener('mouseup', endDraw);
      canvas.addEventListener('mouseleave', endDraw);
      canvas.addEventListener('touchstart', startDraw, { passive: false });
      canvas.addEventListener('touchmove', moveDraw, { passive: false });
      canvas.addEventListener('touchend', endDraw);

      let pinchStart = 0;
      let pinchScale = 1;
      vp.addEventListener('touchstart', (e) => {
        if (mode !== 'pan') return;
        if (e.touches.length === 2) {
          pinchStart = Math.hypot(
            e.touches[0].clientX - e.touches[1].clientX,
            e.touches[0].clientY - e.touches[1].clientY
          ) || 1;
          pinchScale = scale;
          e.preventDefault();
        }
      }, { passive: false });
      vp.addEventListener('touchmove', (e) => {
        if (mode !== 'pan' || e.touches.length < 2) return;
        e.preventDefault();
        const dist = Math.hypot(
          e.touches[0].clientX - e.touches[1].clientX,
          e.touches[0].clientY - e.touches[1].clientY
        ) || 1;
        scale = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, pinchScale * (dist / pinchStart)));
        applyScale();
      }, { passive: false });
      vp.addEventListener('dblclick', (e) => {
        if (mode !== 'pan') return;
        scale = scale > 1.4 ? 1 : 2.5;
        applyScale();
        e.preventDefault();
      });
      vp.addEventListener('wheel', (e) => {
        if (mode !== 'pan') return;
        e.preventDefault();
        const factor = e.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP;
        scale = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, scale * factor));
        applyScale();
      }, { passive: false });

      syncModeButtons();
    }

    async function load() {
      renderShell();
      try {
        let data = Array.isArray(opts.photos)
          ? { photos: opts.photos, warning: opts.warning, photoSource: opts.photoSource }
          : getPack(token, row.id);
        if (!data) {
          const resp = await fetch(`${api}/${encodeURIComponent(token)}/sets/${encodeURIComponent(row.id)}/photos`);
          data = await resp.json().catch(() => ({}));
          if (!resp.ok) throw new Error(data.error || `Load failed (${resp.status})`);
          rememberPack(token, row.id, data);
        }
        photos = Array.isArray(data.photos) ? data.photos : [];
        warmupPhotos(photos, api);
        const tools = document.getElementById('ghReviewTools');
        const stage = document.getElementById('ghStageWrap');
        if (tools) tools.hidden = false;
        if (!photos.length) {
          setStatus(data.warning || 'No photos found for this set yet.');
          bindTools();
          return;
        }
        const src = data.photoSource === 'prod' ? 'PROD after photos (SI preferred when available)'
          : data.photoSource === 'si' ? 'Store Intelligence photos'
          : '';
        setStatus(data.warning || src);
        if (stage) stage.hidden = false;
        renderFilm();
        bindTools();
        showPhoto(0);
      } catch (err) {
        setStatus(err.message || 'Could not load photos', true);
        const tools = document.getElementById('ghReviewTools');
        if (tools) tools.hidden = false;
        bindTools();
      }
    }

    load();
    return { reload: load };
  }

  global.EodSetReview = { createReview, rowComplete, preloadRole };
})(typeof window !== 'undefined' ? window : globalThis);
