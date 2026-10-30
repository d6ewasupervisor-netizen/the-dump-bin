/* Overlay alert / confirm — replaces native dialogs on the field. */
(function (global) {
  'use strict';

  const STYLE_ID = 'eod-alerts-css';

  function ensureCss() {
    if (document.getElementById(STYLE_ID)) return;
    const css = document.createElement('style');
    css.id = STYLE_ID;
    /* Positioning, scroll, safe area and z-tier come from the shared overlay
       base in css/app.css (.eod-overlay / .eod-overlay-panel). Only the
       dialog's own look lives here. */
    css.textContent = `
      .eod-alert-overlay { z-index: var(--z-alert, 50000); }
      .eod-alert-dialog {
        background: var(--surface, #111827); color: var(--text, #f8fafc);
        border: 1px solid var(--accent, #334155); border-radius: 14px; padding: 14px 16px;
      }
      .eod-alert-head {
        display: flex; align-items: flex-start; gap: 8px; margin: 0 0 8px;
      }
      .eod-alert-head h2 { flex: 1 1 auto; margin: 0; font-size: 18px; }
      .eod-alert-dialog .eod-alert-body { margin: 0 0 14px; white-space: pre-wrap; color: var(--muted, #cbd5e1); font-size: 16px; line-height: 1.4; }
      .eod-alert-dialog .eod-alert-rich { margin: 0 0 14px; color: var(--muted, #cbd5e1); font-size: 16px; line-height: 1.4; }
      .eod-alert-actions { display: flex; gap: 8px; justify-content: flex-end; flex-wrap: wrap; }
      .eod-alert-actions .btn { min-height: 44px; flex: 1 1 auto; font-size: 16px; }
    `;
    document.head.appendChild(css);
  }

  function closeOverlay(el) {
    global.EodA11y?.deactivate?.(el);
    el?.classList.remove('show');
    el?.remove();
  }

  function showDialog({ title, message, buttons, content }) {
    ensureCss();
    const rich = typeof Node !== 'undefined' && content instanceof Node;
    return new Promise((resolve) => {
      const overlay = document.createElement('div');
      overlay.className = 'eod-overlay eod-alert-overlay show';
      overlay.innerHTML = `
        <div class="eod-alert-dialog eod-overlay-panel" role="dialog" aria-modal="true" aria-labelledby="eodAlertTitle">
          <div class="eod-alert-head">
            <h2 id="eodAlertTitle">${global.EodApi?.escapeHtml?.(title) || String(title || 'Notice')}</h2>
            <button type="button" class="eod-overlay-close" aria-label="Close">&#10005;</button>
          </div>
          ${rich
    ? '<div class="eod-alert-rich"></div>'
    : `<p class="eod-alert-body">${global.EodApi?.escapeHtml?.(message) || String(message || '')}</p>`}
          <div class="eod-alert-actions"></div>
        </div>`;
      if (rich) overlay.querySelector('.eod-alert-rich').appendChild(content);
      const actions = overlay.querySelector('.eod-alert-actions');
      const dismiss = () => {
        closeOverlay(overlay);
        resolve('cancel');
      };
      overlay.querySelector('.eod-overlay-close')?.addEventListener('click', dismiss);
      (buttons || [{ id: 'ok', label: 'OK', primary: true }]).forEach((b) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = b.primary ? 'btn btn-primary' : 'btn btn-secondary';
        btn.textContent = b.label;
        btn.onclick = () => {
          closeOverlay(overlay);
          resolve(b.id);
        };
        actions.appendChild(btn);
      });
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) {
          closeOverlay(overlay);
          resolve('cancel');
        }
      });
      overlay.addEventListener('eod-dialog-escape', () => {
        closeOverlay(overlay);
        resolve('cancel');
      });
      document.body.appendChild(overlay);
      global.EodA11y?.activate?.(overlay, actions.querySelector('button'));
    });
  }

  function alert(title, message) {
    const msg = message == null ? String(title || '') : String(message);
    const ttl = message == null ? 'Notice' : String(title || 'Notice');
    return showDialog({
      title: ttl,
      message: msg,
      buttons: [{ id: 'ok', label: 'OK', primary: true }],
    }).then(() => undefined);
  }

  function confirm(title, message, onOk) {
    const msg = message == null ? String(title || '') : String(message);
    const ttl = message == null ? 'Confirm' : String(title || 'Confirm');
    const p = showDialog({
      title: ttl,
      message: msg,
      buttons: [
        { id: 'cancel', label: 'Cancel' },
        { id: 'ok', label: 'OK', primary: true },
      ],
    }).then((id) => id === 'ok');
    if (typeof onOk === 'function') {
      p.then((ok) => { if (ok) onOk(); });
      return p;
    }
    return p;
  }

  function notify(title, message) {
    if (global.EodAlerts?.alert) return global.EodAlerts.alert(title, message);
    try { global.alert(message == null ? title : `${title}\n\n${message}`); } catch (_) {}
    return Promise.resolve();
  }

  global.EodAlerts = { alert, confirm, showDialog, notify };
  global.showAlert = (title, message) => alert(title, message);
  global.showConfirm = (title, message, onOk) => confirm(title, message, onOk);
})(typeof window !== 'undefined' ? window : globalThis);
