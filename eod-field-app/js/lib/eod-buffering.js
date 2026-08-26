/* Compass GIF overlay for slow network work. Reference-counted; short calls do not flash. */
(function (global) {
  'use strict';

  const DEBOUNCE_MS = 280;
  const MIN_VISIBLE_MS = 480;
  const ASSET = `assets/buffering.gif?v=${encodeURIComponent(global.EOD_APP_VERSION || '3.3.2')}`;
  const SKIP_RE = /sas-auth-status|rebotics-auth-status|\/usage\b|eod-version\.json|\/api\/me(?:\?|$)/i;

  let depth = 0;
  let showTimer = null;
  let hideTimer = null;
  let overlayEl = null;
  let shownAt = 0;
  let wrapped = false;

  function ensureOverlay() {
    if (overlayEl) return overlayEl;
    overlayEl = document.getElementById('eodBuffering');
    if (overlayEl) return overlayEl;
    overlayEl = document.createElement('div');
    overlayEl.id = 'eodBuffering';
    overlayEl.className = 'eod-buffering';
    overlayEl.hidden = true;
    overlayEl.setAttribute('role', 'status');
    overlayEl.setAttribute('aria-live', 'polite');
    overlayEl.setAttribute('aria-busy', 'false');
    overlayEl.innerHTML = `<img class="eod-buffering-gif" src="${ASSET}" alt="" width="260" height="260" decoding="async">`;
    document.body.appendChild(overlayEl);
    return overlayEl;
  }

  function paintOpen() {
    if (hideTimer) {
      clearTimeout(hideTimer);
      hideTimer = null;
    }
    const el = ensureOverlay();
    const wasHidden = el.hidden;
    el.hidden = false;
    el.classList.add('show');
    el.setAttribute('aria-busy', 'true');
    if (wasHidden) shownAt = Date.now();
  }

  function paintCloseNow() {
    if (!overlayEl) return;
    overlayEl.hidden = true;
    overlayEl.classList.remove('show');
    overlayEl.setAttribute('aria-busy', 'false');
    shownAt = 0;
  }

  function paintClose() {
    if (!overlayEl || overlayEl.hidden) {
      paintCloseNow();
      return;
    }
    const elapsed = shownAt ? Date.now() - shownAt : MIN_VISIBLE_MS;
    const remain = Math.max(0, MIN_VISIBLE_MS - elapsed);
    if (remain <= 0) {
      paintCloseNow();
      return;
    }
    if (hideTimer) clearTimeout(hideTimer);
    hideTimer = setTimeout(() => {
      hideTimer = null;
      if (depth === 0) paintCloseNow();
    }, remain);
  }

  function beginBusy(opts) {
    depth += 1;
    ensureOverlay();
    if (opts && opts.force) {
      if (showTimer) {
        clearTimeout(showTimer);
        showTimer = null;
      }
      paintOpen();
      return;
    }
    if (depth === 1 && !showTimer && overlayEl.hidden !== false) {
      showTimer = setTimeout(() => {
        showTimer = null;
        if (depth > 0) paintOpen();
      }, DEBOUNCE_MS);
    }
  }

  function endBusy() {
    depth = Math.max(0, depth - 1);
    if (depth > 0) return;
    if (showTimer) {
      clearTimeout(showTimer);
      showTimer = null;
      return;
    }
    paintClose();
  }

  async function withBusy(fn, opts) {
    beginBusy(opts);
    try {
      return await fn();
    } finally {
      endBusy();
    }
  }

  function wrapAuthFetch() {
    if (wrapped) return;
    const orig = global.authFetch;
    if (typeof orig !== 'function') return;
    wrapped = true;
    global.authFetch = function bufferedAuthFetch(url, init) {
      const opts = Object.assign({}, init || {});
      const skip = !!opts.skipBusy;
      const force = !!opts.busyForce;
      delete opts.skipBusy;
      delete opts.busyForce;
      if (skip || SKIP_RE.test(String(url || ''))) return orig(url, opts);
      return withBusy(() => orig(url, opts), { force });
    };
    if (global.EodApi) global.EodApi.authFetch = global.authFetch;
  }

  function init() {
    ensureOverlay();
    wrapAuthFetch();
  }

  global.EodBusy = {
    init,
    beginBusy,
    endBusy,
    withBusy,
    isBusy: () => depth > 0,
  };
})(typeof window !== 'undefined' ? window : globalThis);
