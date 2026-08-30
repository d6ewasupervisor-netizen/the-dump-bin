/* Double-swipe left/right to change primary screens. A single swipe does nothing. */
(function (global) {
  'use strict';

  const PRIMARY = ['visit', 'signoff', 'signatures', 'send'];
  const MIN_DX = 72;
  const MAX_DY_RATIO = 0.75;
  const WINDOW_MS = 700;

  let pending = null;

  function currentId() {
    return String(global.EodRouter?.current || '').toLowerCase().split('?')[0];
  }

  function indexOf(id) {
    return PRIMARY.indexOf(id);
  }

  function ignoreTarget(el) {
    if (!el || !el.closest) return false;
    if (el.closest('input, textarea, select, [contenteditable="true"]')) return true;
    if (el.closest('.vf-live-camera, .eod-alert-overlay, .modal-overlay, .picker-overlay, .helpdesk-wizard-overlay, .eod-pic-qr-fs, .eod-lsp-overlay.show, .dept-sig-wizard-overlay.show, .set-media-overlay')) return true;
    if (el.closest('.si-pog-scroll, .dept-sig-pad-wrap, .eod-lsp-stage')) return true;
    return false;
  }

  function go(dir) {
    const i = indexOf(currentId());
    if (i < 0) return;
    const next = PRIMARY[i + dir];
    if (!next) return;
    global.EodRouter?.go?.(next);
  }

  function onStart(e) {
    if (e.touches && e.touches.length !== 1) {
      pending = null;
      return;
    }
    const t = e.touches ? e.touches[0] : e;
    if (ignoreTarget(e.target)) {
      pending = null;
      return;
    }
    pending = {
      x: t.clientX,
      y: t.clientY,
      at: Date.now(),
      dir: null,
    };
  }

  function onEnd(e) {
    if (!pending) return;
    const t = (e.changedTouches && e.changedTouches[0]) || e;
    const dx = t.clientX - pending.x;
    const dy = t.clientY - pending.y;
    const absX = Math.abs(dx);
    const absY = Math.abs(dy);
    const start = pending;
    pending = null;
    if (absX < MIN_DX || absY > absX * MAX_DY_RATIO) return;
    const dir = dx < 0 ? 1 : -1;
    const now = Date.now();
    const last = onEnd._last;
    if (last && last.dir === dir && (now - last.at) <= WINDOW_MS) {
      onEnd._last = null;
      go(dir);
      return;
    }
    onEnd._last = { dir, at: now };
    void start;
  }

  function init() {
    if (init._bound) return;
    init._bound = true;
    document.addEventListener('touchstart', onStart, { passive: true });
    document.addEventListener('touchend', onEnd, { passive: true });
  }

  const api = { PRIMARY, init, indexOf };
  if (typeof module === 'object' && module.exports) module.exports = api;
  global.EodSwipeNav = api;
})(typeof window !== 'undefined' ? window : globalThis);
