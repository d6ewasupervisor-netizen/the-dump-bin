/* Shared dialog focus trap/restore and targeted status announcements. */
(function (global) {
  'use strict';

  const active = new WeakMap();
  const FOCUSABLE = [
    'a[href]',
    'button:not([disabled])',
    'input:not([disabled]):not([type="hidden"])',
    'select:not([disabled])',
    'textarea:not([disabled])',
    '[tabindex]:not([tabindex="-1"])',
  ].join(',');

  function focusables(host) {
    return [...(host?.querySelectorAll?.(FOCUSABLE) || [])]
      .filter((el) => !el.hidden && el.getAttribute('aria-hidden') !== 'true');
  }

  function activate(overlay, initial) {
    if (!overlay || active.has(overlay)) return;
    const previous = global.document?.activeElement;
    const dialog = overlay.matches?.('[role="dialog"]')
      ? overlay
      : overlay.querySelector?.('[role="dialog"]');
    if (!dialog) return;
    if (!dialog.hasAttribute('tabindex')) dialog.tabIndex = -1;
    const onKey = (event) => {
      if (event.key === 'Escape') {
        overlay.dispatchEvent(new CustomEvent('eod-dialog-escape', { bubbles: false }));
        return;
      }
      if (event.key !== 'Tab') return;
      const items = focusables(dialog);
      if (!items.length) {
        event.preventDefault();
        dialog.focus();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && global.document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && global.document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    overlay.addEventListener('keydown', onKey);
    active.set(overlay, { previous, onKey });
    setTimeout(() => {
      const target = typeof initial === 'string' ? dialog.querySelector(initial) : initial;
      (target || focusables(dialog)[0] || dialog).focus?.({ preventScroll: true });
    }, 0);
  }

  function deactivate(overlay) {
    const record = overlay && active.get(overlay);
    if (!record) return;
    overlay.removeEventListener('keydown', record.onKey);
    active.delete(overlay);
    if (record.previous?.isConnected) {
      setTimeout(() => record.previous.focus?.({ preventScroll: true }), 0);
    }
  }

  function announce(message) {
    const el = global.document?.getElementById?.('eodStatusLive');
    if (!el) return;
    el.textContent = '';
    setTimeout(() => { el.textContent = String(message || ''); }, 20);
  }

  global.EodA11y = { activate, deactivate, announce, focusables };
})(typeof window !== 'undefined' ? window : globalThis);
