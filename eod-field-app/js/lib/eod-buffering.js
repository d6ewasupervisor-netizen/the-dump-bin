/* Compass buffering overlay — stages + spinner until Success. */
(function (global) {
  'use strict';

  const DEBOUNCE_MS = 280;
  const MIN_VISIBLE_MS = 480;
  const AMBIENT_MAX_MS = 45000;
  const SUCCESS_HOLD_MS = 1400;
  const ASSET = `assets/buffering.gif?v=${encodeURIComponent(global.EOD_APP_VERSION || '3.3.70')}`;
  const SKIP_RE = /sas-auth-status|rebotics-auth-status|\/usage\b|eod-version\.json|\/api\/me(?:\?|$)|digital-signoffs\/heartbeat|\/photos\/|\/image(?:\?|$)|field-set\/(?:status|planogram-image)|\/api\/shifts\/day/i;

  let depth = 0;
  let showTimer = null;
  let hideTimer = null;
  let maxTimer = null;
  let successTimer = null;
  let overlayEl = null;
  let shownAt = 0;
  let wrapped = false;
  let hiddenUntilIdle = false;
  let sessionDepth = 0;
  let stageTitle = '';
  let stageSubtitle = '';
  let overlayState = 'busy';

  function shouldSkipBusy(url, init) {
    if (init && init.skipBusy) return true;
    if (sessionDepth > 0) return true;
    return SKIP_RE.test(String(url || ''));
  }

  function cardHtml() {
    return `<div class="eod-buffering-card">
      <img class="eod-buffering-gif" src="${ASSET}" alt="" width="104" height="104" decoding="async">
      <div class="eod-buffering-spinner" aria-hidden="true"></div>
      <div class="eod-buffering-check" aria-hidden="true">&#10003;</div>
      <div class="eod-buffering-title" id="eodBusyTitle"></div>
      <div class="eod-buffering-subtitle" id="eodBusySubtitle"></div>
    </div>`;
  }

  function ensureOverlay() {
    if (overlayEl) return overlayEl;
    overlayEl = document.getElementById('eodBuffering');
    if (!overlayEl) {
      overlayEl = document.createElement('div');
      overlayEl.id = 'eodBuffering';
      overlayEl.className = 'eod-buffering';
      overlayEl.hidden = true;
      overlayEl.setAttribute('role', 'status');
      overlayEl.setAttribute('aria-live', 'polite');
      overlayEl.setAttribute('aria-busy', 'false');
      overlayEl.innerHTML = cardHtml();
      document.body.appendChild(overlayEl);
    } else if (!overlayEl.querySelector('.eod-buffering-card')) {
      overlayEl.innerHTML = cardHtml();
    }
    bindDismiss(overlayEl);
    paintStage();
    return overlayEl;
  }

  function bindDismiss(el) {
    if (!el || el.dataset.dismissBound === '1') return;
    el.dataset.dismissBound = '1';
    el.addEventListener('click', (ev) => {
      if (sessionDepth > 0 || overlayState === 'success') return;
      if (ev.target && ev.target.closest && ev.target.closest('.eod-buffering-card')) return;
      dismissBusy();
    });
  }

  function paintStage() {
    const el = ensureOverlay();
    el.dataset.state = overlayState;
    const titleEl = el.querySelector('#eodBusyTitle');
    const subEl = el.querySelector('#eodBusySubtitle');
    if (titleEl) titleEl.textContent = stageTitle || (overlayState === 'success' ? 'Success!' : 'Working…');
    if (subEl) {
      subEl.textContent = stageSubtitle || '';
      subEl.hidden = !stageSubtitle;
    }
  }

  function setStage(title, subtitle) {
    if (title != null) stageTitle = String(title);
    if (subtitle !== undefined) stageSubtitle = subtitle == null ? '' : String(subtitle);
    if (overlayState !== 'success') overlayState = 'busy';
    paintStage();
    if (sessionDepth > 0 || depth > 0) paintOpen({ force: true });
  }

  function dismissBusy() {
    if (sessionDepth > 0) return;
    hiddenUntilIdle = true;
    paintCloseNow();
  }

  function armAmbientMax() {
    if (maxTimer) clearTimeout(maxTimer);
    if (sessionDepth > 0) return;
    maxTimer = setTimeout(() => {
      maxTimer = null;
      if (sessionDepth > 0) return;
      if (depth > 0) dismissBusy();
    }, AMBIENT_MAX_MS);
  }

  function paintOpen(opts) {
    if (hiddenUntilIdle && !(opts && opts.force) && sessionDepth === 0) return;
    if (hideTimer) {
      clearTimeout(hideTimer);
      hideTimer = null;
    }
    if (successTimer) {
      clearTimeout(successTimer);
      successTimer = null;
    }
    const el = ensureOverlay();
    const wasHidden = el.hidden;
    if (overlayState !== 'success') overlayState = 'busy';
    paintStage();
    el.hidden = false;
    el.classList.add('show');
    el.setAttribute('aria-busy', overlayState === 'busy' ? 'true' : 'false');
    if (wasHidden) {
      shownAt = Date.now();
      if (sessionDepth === 0) armAmbientMax();
    }
  }

  function paintCloseNow() {
    if (maxTimer) {
      clearTimeout(maxTimer);
      maxTimer = null;
    }
    if (successTimer) {
      clearTimeout(successTimer);
      successTimer = null;
    }
    if (!overlayEl) return;
    overlayEl.hidden = true;
    overlayEl.classList.remove('show');
    overlayEl.setAttribute('aria-busy', 'false');
    overlayState = 'busy';
    shownAt = 0;
    if (sessionDepth === 0) {
      stageTitle = '';
      stageSubtitle = '';
    }
    paintStage();
  }

  function paintClose() {
    if (sessionDepth > 0) return;
    if (!overlayEl || overlayEl.hidden) {
      paintCloseNow();
      return;
    }
    if (overlayState === 'success') return;
    const elapsed = shownAt ? Date.now() - shownAt : MIN_VISIBLE_MS;
    const remain = Math.max(0, MIN_VISIBLE_MS - elapsed);
    if (remain <= 0) {
      paintCloseNow();
      return;
    }
    if (hideTimer) clearTimeout(hideTimer);
    hideTimer = setTimeout(() => {
      hideTimer = null;
      if (depth === 0 && sessionDepth === 0) paintCloseNow();
    }, remain);
  }

  function beginBusy(opts) {
    depth += 1;
    ensureOverlay();
    if (opts && opts.force) hiddenUntilIdle = false;
    if (opts && opts.title) setStage(opts.title, opts.subtitle || stageSubtitle);
    else if (opts && opts.subtitle != null) setStage(stageTitle || 'Working…', opts.subtitle);
    if (hiddenUntilIdle && !(opts && opts.force) && sessionDepth === 0) return;
    if (opts && opts.force) {
      if (showTimer) {
        clearTimeout(showTimer);
        showTimer = null;
      }
      paintOpen({ force: true });
      return;
    }
    if (depth === 1 && !showTimer && overlayEl.hidden !== false) {
      showTimer = setTimeout(() => {
        showTimer = null;
        if (depth > 0 || sessionDepth > 0) paintOpen();
      }, DEBOUNCE_MS);
    }
  }

  function endBusy() {
    depth = Math.max(0, depth - 1);
    if (depth > 0 || sessionDepth > 0) return;
    hiddenUntilIdle = false;
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

  function beginSession(opts) {
    sessionDepth += 1;
    hiddenUntilIdle = false;
    overlayState = 'busy';
    if (opts && opts.title) stageTitle = String(opts.title);
    else if (!stageTitle) stageTitle = 'Working…';
    if (opts && opts.subtitle !== undefined) stageSubtitle = opts.subtitle == null ? '' : String(opts.subtitle);
    if (showTimer) {
      clearTimeout(showTimer);
      showTimer = null;
    }
    if (maxTimer) {
      clearTimeout(maxTimer);
      maxTimer = null;
    }
    paintOpen({ force: true });
  }

  function endSession() {
    sessionDepth = Math.max(0, sessionDepth - 1);
    if (sessionDepth > 0) return;
    if (depth > 0) {
      armAmbientMax();
      return;
    }
    paintClose();
  }

  function showSuccess(title, subtitle) {
    hiddenUntilIdle = false;
    overlayState = 'success';
    stageTitle = title != null ? String(title) : 'Success!';
    stageSubtitle = subtitle != null ? String(subtitle) : '';
    paintOpen({ force: true });
    if (successTimer) clearTimeout(successTimer);
    successTimer = setTimeout(() => {
      successTimer = null;
      if (sessionDepth === 0 && depth === 0) paintCloseNow();
    }, SUCCESS_HOLD_MS);
  }

  async function runSession(fn, opts) {
    beginSession(opts || {});
    try {
      const result = await fn({
        setStage,
        success: showSuccess,
      });
      if (overlayState !== 'success') {
        showSuccess((opts && opts.successTitle) || 'Success!', (opts && opts.successSubtitle) || '');
        await new Promise((r) => setTimeout(r, SUCCESS_HOLD_MS));
      } else {
        await new Promise((r) => setTimeout(r, SUCCESS_HOLD_MS));
      }
      return result;
    } catch (err) {
      sessionDepth = Math.max(0, sessionDepth - 1);
      paintCloseNow();
      throw err;
    } finally {
      if (sessionDepth > 0) sessionDepth -= 1;
      if (sessionDepth === 0) {
        hiddenUntilIdle = false;
        if (depth === 0) paintCloseNow();
      }
    }
  }

  function wrapAuthFetch() {
    if (wrapped) return;
    const orig = global.authFetch;
    if (typeof orig !== 'function') return;
    wrapped = true;
    global.authFetch = function bufferedAuthFetch(url, init) {
      const opts = Object.assign({}, init || {});
      const skip = shouldSkipBusy(url, opts);
      const force = !!opts.busyForce;
      const title = opts.busyTitle;
      const subtitle = opts.busySubtitle;
      delete opts.skipBusy;
      delete opts.busyForce;
      delete opts.busyTitle;
      delete opts.busySubtitle;
      if (skip) return orig(url, opts);
      return withBusy(() => orig(url, opts), { force, title, subtitle });
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
    beginSession,
    endSession,
    runSession,
    setStage,
    showSuccess,
    dismissBusy,
    isBusy: () => depth > 0 || sessionDepth > 0,
    shouldSkipBusy,
  };
})(typeof window !== 'undefined' ? window : globalThis);
