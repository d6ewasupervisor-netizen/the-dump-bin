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
    let css = document.getElementById(STYLE_ID);
    if (!css) {
      css = document.createElement('style');
      css.id = STYLE_ID;
      document.head.appendChild(css);
    }
    css.textContent = `
      .gh-review { display: flex; flex-direction: column; gap: 10px; padding-bottom: 8px; color: inherit; }
      .gh-review-bar { display: flex; align-items: flex-start; gap: 10px; }
      .gh-review-title { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
      .gh-review .gh-btn {
        appearance: none; -webkit-appearance: none;
        display: inline-flex; align-items: center; justify-content: center;
        min-height: var(--touch, 44px); padding: 10px 14px; border-radius: 8px;
        border: 0; font: inherit; font-weight: 700; font-size: 15px;
        cursor: pointer; touch-action: manipulation; box-shadow: none;
      }
      .gh-review .gh-tool {
        flex-direction: column; gap: 2px; min-height: 52px; padding: 6px 8px;
      }
      .gh-review .gh-tool-ico { font-size: 18px; line-height: 1; }
      .gh-review .gh-tool-lbl { font-size: 10px; font-weight: 700; line-height: 1.1; }
      .gh-review .gh-film { display: flex; gap: 8px; overflow-x: auto; -webkit-overflow-scrolling: touch; padding: 4px 0 8px; }
      .gh-review .gh-film-thumb {
        appearance: none; -webkit-appearance: none; box-shadow: none;
        flex: 0 0 auto; padding: 0; cursor: pointer; overflow: hidden;
      }
      .gh-review .gh-stage-wrap { width: 100%; border-radius: 12px; overflow: hidden; min-height: min(50vh, 420px); }
      .gh-review .gh-stage-track {
        display: flex; gap: 0; width: 100%;
        height: min(70vh, 640px); min-height: min(50vh, 420px);
        overflow-x: auto; overflow-y: hidden;
        scroll-snap-type: x mandatory; scroll-snap-stop: always;
        touch-action: pan-x; -webkit-overflow-scrolling: touch;
        overscroll-behavior-x: contain; scrollbar-width: none;
      }
      .gh-review .gh-stage-track::-webkit-scrollbar { display: none; }
      .gh-review .gh-stage-track.is-locked { overflow-x: hidden; touch-action: none; }
      .gh-review .gh-stage-frame {
        flex: 0 0 100%; width: 100%; min-width: 100%; max-width: 100%;
        height: 100%; scroll-snap-align: start; scroll-snap-stop: always;
        overflow: hidden; box-sizing: border-box;
      }
      .gh-review .gh-stage-vp {
        display: flex; justify-content: center;
        width: 100%; height: 100%;
        overflow: auto; max-height: min(70vh, 640px);
        touch-action: pan-x pan-y; -webkit-overflow-scrolling: touch;
      }
      .gh-review .gh-stage-vp[data-mode="draw"] { touch-action: none; }
      .gh-review .gh-stage { position: relative; display: block; }
      .gh-review .gh-stage img, .gh-review .gh-stage canvas { display: block; max-width: none; }
      .gh-review .gh-stage canvas { position: absolute; inset: 0; width: 100%; height: 100%; }
      .gh-review .gh-stage-vp[data-mode="pan"] canvas { pointer-events: none; }
      .gh-review .gh-stage-vp[data-mode="draw"] canvas { pointer-events: auto; }
      .gh-review-tools { display: flex; flex-direction: column; gap: 8px; }
      .gh-tool-row { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
      .gh-tool-row .gh-btn { flex: 1 1 auto; min-width: 44px; }
      .gh-review-footer { position: sticky; bottom: 0; display: flex; align-items: center; gap: 10px; padding: 12px 0; }
      .gh-review-footer .gh-btn { flex: 1; }
      .gh-dept-extra summary::-webkit-details-marker { display: none; }

      .gh-review--app { color: var(--text, #f8fafc); }
      .gh-review--app .gh-review-title strong { color: var(--accent, #38bdf8); font-size: 1.05rem; }
      .gh-review--app .gh-muted { color: var(--muted, #94a3b8); font-size: 13px; }
      .gh-review--app .gh-error { color: var(--danger, #ef4444); }
      .gh-review--app .gh-btn { color: #fff; background: #4b5563; }
      .gh-review--app .gh-btn-primary { background: var(--accent-dim, #0d4f8b); color: #fff; }
      .gh-review--app .gh-btn-secondary { background: #4b5563; color: #fff; }
      .gh-review--app .gh-btn.is-active {
        outline: 2px solid var(--accent, #38bdf8);
        background: var(--accent-dim, #0d4f8b);
      }
      .gh-review--app .gh-film-thumb {
        flex: 0 0 auto; width: 76px; border: 2px solid var(--border, #1e3a5f);
        border-radius: 8px; background: #0f172a; padding: 0; cursor: pointer; overflow: hidden; color: inherit;
      }
      .gh-review--app .gh-film-thumb img { display: block; width: 76px; height: 56px; object-fit: cover; }
      .gh-review--app .gh-film-thumb span {
        display: block; font-size: 10px; font-weight: 700; padding: 4px 4px 5px;
        color: var(--muted, #94a3b8); background: #111827; text-align: center;
      }
      .gh-review--app .gh-film-thumb.is-active { border-color: var(--accent, #38bdf8); }
      .gh-review--app .gh-film-thumb.is-active span { color: var(--accent, #38bdf8); }
      .gh-review--app .gh-stage-wrap { border: 1px solid var(--border, #1e3a5f); background: #020617; }
      .gh-review--app .gh-review-footer {
        background: var(--card, #020617); border-top: 1px solid var(--border, #1e3a5f);
      }
      .gh-review--app .gh-set-done { color: var(--ok, #22c55e); font-size: 12px; font-weight: 700; }
      .gh-review--app .gh-photo-pos { flex: 1 1 auto; text-align: center; font-weight: 700; color: var(--muted, #94a3b8); }
      .gh-review--app .gh-dept-extra { margin-top: 10px; border: 1px solid var(--border, #1e3a5f); border-radius: 8px; background: #0b1220; }
      .gh-review--app .gh-dept-extra summary {
        cursor: pointer; padding: 10px 12px; font-weight: 700; list-style: none; color: #93c5fd;
      }
      .gh-review--app .gh-dept-extra[open] summary { border-bottom: 1px solid var(--border, #1e3a5f); }
      .gh-review--app .dept-sig-set-list { display: flex; flex-direction: column; gap: 6px; }
      .gh-review--app .dept-sig-set-row {
        display: flex; flex-direction: column; align-items: flex-start; gap: 2px;
        width: 100%; text-align: left; padding: 12px; border-radius: 8px;
        border: 1px solid var(--border, #1e3a5f); background: #0f172a; color: var(--text, #f8fafc); cursor: pointer;
      }
      .gh-review--app .dept-sig-set-row strong { color: #93c5fd; }
    `;
  }

  function isFieldAppTheme() {
    const t = document.documentElement.getAttribute('data-theme');
    return t !== 'light' && t !== 'gray';
  }

  function toolBtn(id, extraClass, icon, label, attrs = '') {
    return `<button type="button" class="btn btn-secondary gh-btn gh-btn-secondary gh-tool${extraClass ? ` ${extraClass}` : ''}" id="${id}" ${attrs}>
      <span class="gh-tool-ico" aria-hidden="true">${icon}</span>
      <span class="gh-tool-lbl">${label}</span>
    </button>`;
  }

  function resolvePhotoUrl(api, path) {
    if (!path) return '';
    if (/^data:|^blob:/i.test(path)) return path;
    const viaCache = global.EodSetMediaCache?.absApiUrl?.(path);
    if (viaCache) return viaCache;
    const origin = String(api || '').replace(/\/api\/guest-handoff.*$/i, '');
    if (origin && path.startsWith('/api/')) {
      try {
        const u = new URL(path, origin);
        if (global.EodSetMediaCache?.isEodApiUrl?.(u.href)) return u.href;
      } catch (_) { /* drop */ }
    }
    return '';
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

  function warmupPhotos(photos, api, authFetch) {
    (photos || []).forEach((p) => {
      const url = resolvePhotoUrl(api, p?.thumbUrl || '');
      if (!url) return;
      if (authFetch) {
        authFetch(url, { skipBusy: true }).then((resp) => resp.ok ? resp.blob() : null).then((blob) => {
          if (!blob) return;
          const img = new Image();
          img.decoding = 'async';
          img.src = URL.createObjectURL(blob);
        }).catch(() => {});
        return;
      }
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

  function photoSlotOf(p) {
    if (p?.slot === 'before' || p?.slot === 'after') return p.slot;
    if (/^before/i.test(String(p?.label || ''))) return 'before';
    return 'after';
  }

  function firstAfterIndex(photos) {
    const i = (photos || []).findIndex((p) => photoSlotOf(p) !== 'before');
    return i >= 0 ? i : 0;
  }

  function firstSlotIndex(photos, slot) {
    const want = String(slot || '').toLowerCase();
    if (want !== 'before' && want !== 'after') return firstAfterIndex(photos);
    const i = (photos || []).findIndex((p) => photoSlotOf(p) === want);
    return i >= 0 ? i : 0;
  }

  function bayNumberOf(p) {
    const n = Number(p?.bayIndex);
    if (Number.isFinite(n) && n > 0) return n;
    const m = String(p?.label || '').match(/(?:bay|after|before)\s*(\d+)/i)
      || String(p?.label || '').match(/\b(\d+)\b/);
    return m ? Number(m[1]) : null;
  }

  function indexForBay(photos, slot, bay) {
    const n = Number(bay);
    if (!Number.isFinite(n) || n < 1) return firstSlotIndex(photos, slot);
    const exact = (photos || []).findIndex((p) => bayNumberOf(p) === n);
    if (exact >= 0) return exact;
    if (n <= (photos || []).length) return n - 1;
    return firstSlotIndex(photos, slot);
  }

  function filterBySlot(photos, slot) {
    const want = String(slot || '').toLowerCase();
    if (want !== 'before' && want !== 'after') return photos || [];
    return (photos || []).filter((p) => photoSlotOf(p) === want);
  }

  function closeOverlay() {
    document.getElementById('eodSetMediaOverlay')?.remove();
    document.body.classList.remove('set-media-open');
  }

  function openOverlay(opts) {
    closeOverlay();
    const host = document.createElement('div');
    host.id = 'eodSetMediaOverlay';
    host.className = 'set-media-overlay';
    document.body.appendChild(host);
    document.body.classList.add('set-media-open');
    return createReview({
      ...opts,
      root: host,
      hideBack: false,
      hideComplete: opts.hideComplete !== false,
      backLabel: opts.backLabel || 'Close',
      onBack: () => {
        closeOverlay();
        opts.onBack?.();
      },
    });
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
      authFetch,
      photosUrl,
      hideComplete,
      hideBack,
      backLabel,
      slotFilter,
      heading,
      startBay,
    } = opts;
    const objectUrlCache = new Map();
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
      const raw = download ? (p?.url || '') : (p?.thumbUrl && arguments[2] === 'thumb' ? p.thumbUrl : p?.url || '');
      const base = resolvePhotoUrl(api, raw);
      if (!base) return '';
      return download ? `${base}${base.includes('?') ? '&' : '?'}download=1` : base;
    }

    function displayUrl(p, kind) {
      const raw = kind === 'thumb' ? (p?.thumbUrl || p?.url || '') : (p?.url || '');
      return resolvePhotoUrl(api, raw);
    }

    async function objectUrlFor(p, kind) {
      const url = displayUrl(p, kind);
      if (!url) return '';
      if (/^data:|^blob:/i.test(url)) return url;
      const cacheKey = `${kind || 'full'}:${url}`;
      if (objectUrlCache.has(cacheKey)) return objectUrlCache.get(cacheKey);
      try {
        const cached = await global.EodSetMediaCache?.match?.(url);
        if (cached && cached.ok) {
          const blob = await cached.blob();
          const obj = URL.createObjectURL(blob);
          objectUrlCache.set(cacheKey, obj);
          return obj;
        }
      } catch (_) { /* fetch */ }
      if (!authFetch) return url;
      const resp = await authFetch(url, { skipBusy: true });
      if (!resp.ok) throw new Error(`Photo failed (${resp.status})`);
      try { await global.EodSetMediaCache?.put?.(url, resp); } catch (_) {}
      const blob = await resp.blob();
      const obj = URL.createObjectURL(blob);
      objectUrlCache.set(cacheKey, obj);
      return obj;
    }

    function renderShell() {
      const name = heading || row.catName || row.cat_name || 'Set';
      const done = rowComplete(row);
      const themeClass = isFieldAppTheme() ? ' gh-review--app' : '';
      root.innerHTML = `
        <div class="gh-review${themeClass}">
          ${hideBack ? '' : `<div class="gh-review-bar">
            <button type="button" class="btn btn-secondary gh-btn gh-btn-secondary" id="ghReviewBack">${escapeHtml(backLabel || '← Sets')}</button>
            <div class="gh-review-title">
              <strong>${escapeHtml(name)}</strong>
              ${row.pog || row.dbkey ? `<span class="gh-muted">POG ${escapeHtml(row.pog || row.dbkey)}</span>` : ''}
              ${done ? '<span class="gh-set-done">Complete</span>' : ''}
            </div>
          </div>`}
          <p class="gh-muted" id="ghReviewStatus">Loading set photos…</p>
          <div class="gh-film" id="ghFilm" hidden></div>
          <div class="gh-stage-wrap" id="ghStageWrap" hidden>
            <div class="gh-stage-track" id="ghStageTrack"></div>
          </div>
          <div class="gh-review-tools" id="ghReviewTools" hidden>
            <div class="gh-tool-row">
              ${toolBtn('ghPrev', '', '‹', 'Prev')}
              <span class="gh-muted gh-photo-pos" id="ghPhotoPos"></span>
              ${toolBtn('ghNext', '', '›', 'Next')}
            </div>
            <div class="gh-tool-row">
              ${toolBtn('ghModePan', '', '✥', 'Pan', 'data-mode="pan"')}
              ${toolBtn('ghModeDraw', '', '✎', 'Mark', 'data-mode="draw"')}
              ${toolBtn('ghZoomOut', '', '−', 'Out')}
              ${toolBtn('ghZoomIn', '', '+', 'In')}
              ${toolBtn('ghClearMarks', '', '✕', 'Clear')}
            </div>
            <div class="gh-tool-row">
              ${toolBtn('ghSavePhoto', '', '⬇', 'Save')}
              ${toolBtn('ghSharePhoto', '', '↗', 'Share')}
            </div>
            <p class="gh-muted" id="ghReviewErr" hidden></p>
          </div>
          ${hideComplete ? '' : `<div class="gh-review-footer">
            ${done ? '<span class="gh-set-done" id="ghCompleteLabel">Complete</span>' : '<span class="gh-muted" id="ghCompleteLabel">Not complete</span>'}
            <button type="button" class="btn btn-primary gh-btn gh-btn-primary" id="ghConfirmComplete">Confirm complete</button>
          </div>`}
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

    function activeEls() {
      const track = document.getElementById('ghStageTrack');
      const frame = track?.querySelector(`.gh-stage-frame[data-idx="${idx}"]`) || null;
      return {
        track,
        frame,
        vp: frame?.querySelector('.gh-stage-vp') || null,
        stage: frame?.querySelector('.gh-stage') || null,
        img: frame?.querySelector('img') || null,
        canvas: frame?.querySelector('canvas') || null,
      };
    }

    function setTrackLocked(locked) {
      const track = document.getElementById('ghStageTrack');
      if (track) track.classList.toggle('is-locked', !!locked);
    }

    function syncModeButtons() {
      document.getElementById('ghModePan')?.classList.toggle('is-active', mode === 'pan');
      document.getElementById('ghModeDraw')?.classList.toggle('is-active', mode === 'draw');
      const { vp } = activeEls();
      if (vp) vp.dataset.mode = mode;
      setTrackLocked(mode === 'draw' || scale > 1.05);
    }

    function applyScale() {
      const { stage } = activeEls();
      if (!stage) return;
      stage.style.transform = `scale(${scale})`;
      stage.style.transformOrigin = '0 0';
      setTrackLocked(mode === 'draw' || scale > 1.05);
    }

    function fitStage() {
      const { img, canvas, vp, stage } = activeEls();
      if (!img || !canvas || !vp || !img.naturalWidth) return;
      imgNatural = { w: img.naturalWidth, h: img.naturalHeight };
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const maxW = Math.max(280, vp.clientWidth - 4);
      const displayW = maxW;
      const displayH = displayW * (img.naturalHeight / img.naturalWidth);
      img.style.width = `${displayW}px`;
      img.style.height = `${displayH}px`;
      canvas.style.width = `${displayW}px`;
      canvas.style.height = `${displayH}px`;
      if (stage) {
        stage.style.width = `${displayW}px`;
        stage.style.height = `${displayH}px`;
      }
      scale = 1;
      applyScale();
      redrawCanvas();
    }

    function redrawCanvas() {
      const { canvas } = activeEls();
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

    function paintChrome() {
      const p = photos[idx];
      if (!p) return;
      const pos = document.getElementById('ghPhotoPos');
      if (pos) pos.textContent = `${p.label || `Photo ${idx + 1}`} · ${idx + 1} of ${photos.length}`;
      document.querySelectorAll('.gh-film button').forEach((btn, n) => {
        btn.classList.toggle('is-active', n === idx);
      });
    }

    function loadFull(i) {
      const p = photos[i];
      const frame = document.querySelector(`#ghStageTrack .gh-stage-frame[data-idx="${i}"]`);
      const img = frame?.querySelector('img');
      if (!p || !img) return;
      img.onload = () => {
        if (idx === i) fitStage();
      };
      img.alt = p.label || `Photo ${i + 1}`;
      objectUrlFor(p, 'full').then((src) => {
        img.dataset.full = '1';
        img.src = src;
      }).catch((err) => {
        if (idx === i) setStatus(err.message || 'Could not load photo', true);
      });
      [i - 1, i + 1].forEach((n) => {
        const neighbor = photos[n];
        if (neighbor) objectUrlFor(neighbor, 'full').catch(() => {});
      });
    }

    function commitIndex(i) {
      idx = Math.max(0, Math.min(photos.length - 1, i));
      scale = 1;
      paintChrome();
      loadFull(idx);
      applyScale();
      syncModeButtons();
      const { img } = activeEls();
      if (img?.naturalWidth) fitStage();
    }

    let syncingScroll = false;

    function showPhoto(i, instant) {
      if (!photos.length) return;
      commitIndex(i);
      const { track, frame } = activeEls();
      if (!track || !frame) return;
      syncingScroll = true;
      track.scrollTo({ left: frame.offsetLeft, behavior: instant ? 'auto' : 'smooth' });
      requestAnimationFrame(() => {
        requestAnimationFrame(() => { syncingScroll = false; });
      });
    }

    function sizeFrames() {
      const track = document.getElementById('ghStageTrack');
      if (!track) return;
      const w = Math.max(1, track.clientWidth);
      const h = Math.max(1, track.clientHeight || Math.min(window.innerHeight * 0.7, 640));
      track.querySelectorAll('.gh-stage-frame').forEach((frame) => {
        frame.style.flexBasis = `${w}px`;
        frame.style.width = `${w}px`;
        frame.style.minWidth = `${w}px`;
        frame.style.maxWidth = `${w}px`;
        frame.style.height = `${h}px`;
      });
    }

    function activeIndexFromScroll(track) {
      const frames = [...(track?.querySelectorAll('.gh-stage-frame') || [])];
      if (!frames.length) return 0;
      const mid = (track.scrollLeft || 0) + track.clientWidth / 2;
      let best = 0;
      let bestDist = Infinity;
      frames.forEach((frame) => {
        const i = Number(frame.dataset.idx);
        const center = frame.offsetLeft + frame.offsetWidth / 2;
        const dist = Math.abs(center - mid);
        if (dist < bestDist) {
          best = i;
          bestDist = dist;
        }
      });
      return best;
    }

    function renderTrack() {
      const track = document.getElementById('ghStageTrack');
      if (!track) return;
      track.innerHTML = photos.map((p, i) => `
        <div class="gh-stage-frame" data-idx="${i}">
          <div class="gh-stage-vp" data-mode="pan">
            <div class="gh-stage">
              <img alt="${escapeHtml(p.label || `Photo ${i + 1}`)}" draggable="false">
              <canvas></canvas>
            </div>
          </div>
        </div>`).join('');
      sizeFrames();
      photos.forEach((p, i) => {
        const img = track.querySelector(`.gh-stage-frame[data-idx="${i}"] img`);
        if (!img) return;
        objectUrlFor(p, 'thumb').then((src) => {
          if (img.dataset.full === '1') return;
          img.src = src;
        }).catch(() => {});
      });
    }

    function bindBaySwipe() {
      const track = document.getElementById('ghStageTrack');
      if (!track || track._baySwipeBound) return;
      track._baySwipeBound = true;
      sizeFrames();
      if (typeof ResizeObserver === 'function') {
        const obs = new ResizeObserver(() => {
          sizeFrames();
          const frame = track.querySelector(`.gh-stage-frame[data-idx="${idx}"]`);
          if (frame) {
            syncingScroll = true;
            track.scrollTo({ left: frame.offsetLeft, behavior: 'auto' });
            requestAnimationFrame(() => { syncingScroll = false; });
          }
          if (activeEls().img?.naturalWidth) fitStage();
        });
        obs.observe(track);
      }
      track.addEventListener('scroll', () => {
        if (syncingScroll) return;
        const i = activeIndexFromScroll(track);
        if (i !== idx) commitIndex(i);
      }, { passive: true });
    }

    function renderFilm() {
      const film = document.getElementById('ghFilm');
      if (!film) return;
      film.hidden = !photos.length;
      film.innerHTML = photos.map((p, i) => `
        <button type="button" class="gh-film-thumb${i === idx ? ' is-active' : ''}" data-idx="${i}" title="${escapeHtml(p.label || '')}">
          <img alt="${escapeHtml(p.label || `Photo ${i + 1}`)}">
          <span>${escapeHtml(p.label || String(i + 1))}</span>
        </button>`).join('');
      film.querySelectorAll('button').forEach((btn) => {
        const i = Number(btn.dataset.idx);
        btn.addEventListener('click', () => showPhoto(i));
        const img = btn.querySelector('img');
        const p = photos[i];
        if (!img || !p) return;
        objectUrlFor(p, 'thumb').then((src) => { img.src = src; }).catch(() => {});
      });
    }

    async function compositeBlob() {
      const { img, canvas: overlay } = activeEls();
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
        await global.EodAlerts?.alert?.('Save failed', err.message || 'Save failed');
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
        try {
          await savePhoto();
        } catch (saveErr) {
          await global.EodAlerts?.alert?.('Share failed', saveErr.message || err.message || 'Share failed');
        }
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
      if (!hideComplete) {
        document.getElementById('ghConfirmComplete')?.addEventListener('click', () => confirmComplete());
      }

      const track = document.getElementById('ghStageTrack');
      if (!track) {
        syncModeButtons();
        return;
      }

      function startDraw(e) {
        if (mode !== 'draw') return;
        const { canvas } = activeEls();
        if (!canvas) return;
        drawing = true;
        lastPt = canvasPoint(e, canvas);
        currentStrokes().push([lastPt]);
        e.preventDefault();
      }
      function moveDraw(e) {
        if (!drawing || mode !== 'draw') return;
        const { canvas } = activeEls();
        if (!canvas) return;
        const pt = canvasPoint(e, canvas);
        const stroke = currentStrokes()[currentStrokes().length - 1];
        if (stroke) stroke.push(pt);
        lastPt = pt;
        redrawCanvas();
        e.preventDefault();
      }
      function endDraw() { drawing = false; }

      track.addEventListener('mousedown', startDraw);
      track.addEventListener('mousemove', moveDraw);
      track.addEventListener('mouseup', endDraw);
      track.addEventListener('mouseleave', endDraw);

      let pinchStart = 0;
      let pinchScale = 1;
      track.addEventListener('touchstart', (e) => {
        if (mode === 'draw') {
          startDraw(e);
          return;
        }
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
      track.addEventListener('touchmove', (e) => {
        if (mode === 'draw') {
          moveDraw(e);
          return;
        }
        if (mode !== 'pan' || e.touches.length < 2) return;
        e.preventDefault();
        const dist = Math.hypot(
          e.touches[0].clientX - e.touches[1].clientX,
          e.touches[0].clientY - e.touches[1].clientY
        ) || 1;
        scale = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, pinchScale * (dist / pinchStart)));
        applyScale();
      }, { passive: false });
      track.addEventListener('touchend', endDraw);
      track.addEventListener('dblclick', (e) => {
        if (mode !== 'pan') return;
        scale = scale > 1.4 ? 1 : 2.5;
        applyScale();
        e.preventDefault();
      });
      track.addEventListener('wheel', (e) => {
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
        if (!data && photosUrl) {
          const resp = await (authFetch || fetch)(photosUrl);
          data = await resp.json().catch(() => ({}));
          if (!resp.ok) throw new Error(data.error || `Load failed (${resp.status})`);
        }
        if (!data) {
          const resp = await fetch(`${api}/${encodeURIComponent(token)}/sets/${encodeURIComponent(row.id)}/photos`);
          data = await resp.json().catch(() => ({}));
          if (!resp.ok) throw new Error(data.error || `Load failed (${resp.status})`);
          rememberPack(token, row.id, data);
        }
        photos = filterBySlot(Array.isArray(data.photos) ? data.photos : [], slotFilter);
        warmupPhotos(photos, api, authFetch);
        const tools = document.getElementById('ghReviewTools');
        const stage = document.getElementById('ghStageWrap');
        if (tools) tools.hidden = false;
        if (!photos.length) {
          setStatus(data.warning || 'No photos found for this set yet.');
          bindTools();
          return;
        }
        const src = slotFilter === 'before'
          ? (photos.length ? 'Before photos' : '')
          : data.photoSource === 'prod' ? 'PROD after photos'
            : data.photoSource === 'si' ? 'Store Intelligence after photos'
              : '';
        setStatus(data.warning || src);
        if (stage) stage.hidden = false;
        idx = indexForBay(photos, slotFilter, startBay);
        renderTrack();
        renderFilm();
        bindBaySwipe();
        bindTools();
        showPhoto(idx, true);
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

  global.EodSetReview = { createReview, rowComplete, preloadRole, openOverlay, closeOverlay, filterBySlot };
})(typeof window !== 'undefined' ? window : globalThis);
