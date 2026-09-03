/* Shrink text until it fits the card width. Wrap only after the minimum size. */
(function (global) {
  'use strict';

  const TITLE_MAX = 17;
  const TITLE_MIN = 11;
  const META_MAX = 13;
  const META_MIN = 9;
  const STEP = 0.5;

  function px(n) {
    return `${Math.round(n * 10) / 10}px`;
  }

  function overflowsX(el) {
    return el.scrollWidth > el.clientWidth + 1;
  }

  function tooManyLines(el, size, maxLines) {
    const cs = global.getComputedStyle ? getComputedStyle(el) : null;
    const lh = cs ? parseFloat(cs.lineHeight) : NaN;
    const line = Number.isFinite(lh) && lh > 0 ? lh : size * 1.25;
    return el.scrollHeight > line * maxLines + 2;
  }

  function fitOneLine(el, minPx, maxPx) {
    if (!el) return;
    el.style.whiteSpace = 'nowrap';
    let size = maxPx;
    el.style.fontSize = px(size);
    while (size > minPx && overflowsX(el)) {
      size -= STEP;
      el.style.fontSize = px(size);
    }
    if (overflowsX(el)) {
      el.style.whiteSpace = 'normal';
      el.style.overflowWrap = 'anywhere';
      el.style.wordBreak = 'break-word';
    }
  }

  function fitWrapped(el, minPx, maxPx, maxLines) {
    if (!el) return;
    el.style.whiteSpace = 'normal';
    el.style.overflowWrap = 'anywhere';
    el.style.wordBreak = 'break-word';
    let size = maxPx;
    el.style.fontSize = px(size);
    while (size > minPx && (overflowsX(el) || tooManyLines(el, size, maxLines))) {
      size -= STEP;
      el.style.fontSize = px(size);
    }
  }

  function fitSheetCard(card) {
    if (!card) return;
    fitWrapped(card.querySelector('.ds-row-title'), TITLE_MIN, TITLE_MAX, 2);
    card.querySelectorAll('.ds-row-meta').forEach((el) => fitOneLine(el, META_MIN, META_MAX));
    card.querySelectorAll('.manifest-error-msg').forEach((el) => fitWrapped(el, META_MIN, META_MAX, 3));
  }

  function fitSheetCards(root) {
    const host = root || (typeof document !== 'undefined' ? document : null);
    if (!host || !host.querySelectorAll) return;
    host.querySelectorAll('.ds-row').forEach(fitSheetCard);
  }

  const api = {
    TITLE_MAX,
    TITLE_MIN,
    META_MAX,
    META_MIN,
    fitOneLine,
    fitWrapped,
    fitSheetCard,
    fitSheetCards,
    overflowsX,
  };
  if (typeof module === 'object' && module.exports) module.exports = api;
  global.EodFitText = api;
})(typeof window !== 'undefined' ? window : globalThis);
