/* Per-control press + pending feedback.

   The control the user actually touched is the thing that reacts, instead of
   a full-screen blur over the whole app. authFetch claims the most recent tap
   and holds it in a pending state until the request settles, so ordinary
   requests need no call-site changes. */
(function (global) {
  'use strict';

  const CLAIM_WINDOW_MS = 1500;
  const MIN_PENDING_MS = 120;
  const TAPPABLE = 'button, [role="button"], .shift-card, .member-row, .ds-row';

  let lastTap = null;
  let bound = false;

  function record(ev) {
    const el = ev.target?.closest?.(TAPPABLE);
    if (!el || el.disabled) return;
    lastTap = { el, at: Date.now() };
  }

  /* Hand back the control tapped just before this request, once. Two
     concurrent fetches must not both decorate the same button. */
  function claim() {
    const tap = lastTap;
    if (!tap) return null;
    lastTap = null;
    if (Date.now() - tap.at > CLAIM_WINDOW_MS) return null;
    if (!tap.el.isConnected) return null;
    return tap.el;
  }

  function depthOf(el) {
    return Number(el.dataset.eodPendingDepth || 0);
  }

  function pending(el) {
    if (!el || !el.isConnected) return () => {};
    el.dataset.eodPendingDepth = String(depthOf(el) + 1);
    el.classList.add('is-pending');
    el.setAttribute('aria-busy', 'true');
    const startedAt = Date.now();
    let released = false;

    return function release() {
      if (released) return;
      released = true;
      el.dataset.eodPendingDepth = String(Math.max(0, depthOf(el) - 1));
      const clear = () => {
        if (depthOf(el) > 0) return;
        el.classList.remove('is-pending');
        el.removeAttribute('aria-busy');
        delete el.dataset.eodPendingDepth;
      };
      const held = Date.now() - startedAt;
      if (held >= MIN_PENDING_MS) clear();
      else setTimeout(clear, MIN_PENDING_MS - held);
    };
  }

  async function wrap(el, fn) {
    const release = pending(el);
    try {
      return await fn();
    } finally {
      release();
    }
  }

  function init() {
    if (bound || !global.document) return;
    bound = true;
    global.document.addEventListener('pointerdown', record, true);
  }

  global.EodTap = { init, claim, pending, wrap, noteTap: record };
  if (typeof module === 'object' && module.exports) module.exports = global.EodTap;
})(typeof window !== 'undefined' ? window : globalThis);
