/* Overlay alert / confirm — replaces native dialogs on the field. */
(function (global) {
  'use strict';

  const STYLE_ID = 'eod-alerts-css';

  function ensureCss() {
    if (document.getElementById(STYLE_ID)) return;
    const css = document.createElement('style');
    css.id = STYLE_ID;
    css.textContent = `
      .eod-alert-overlay {
        display: none; position: fixed; inset: 0; z-index: 50000;
        background: rgba(2,6,23,.78); align-items: center; justify-content: center;
        padding: 16px;
      }
      .eod-alert-overlay.show { display: flex; }
      .eod-alert-dialog {
        width: min(420px, 100%); background: var(--surface, #111827); color: var(--text, #f8fafc);
        border: 1px solid var(--accent, #334155); border-radius: 14px; padding: 18px 16px 14px;
      }
      .eod-alert-dialog h2 { margin: 0 0 8px; font-size: 18px; }
      .eod-alert-dialog .eod-alert-body { margin: 0 0 14px; white-space: pre-wrap; color: var(--muted, #cbd5e1); font-size: 15px; line-height: 1.4; }
      .eod-alert-actions { display: flex; gap: 8px; justify-content: flex-end; flex-wrap: wrap; }
    `;
    document.head.appendChild(css);
  }

  function closeOverlay(el) {
    el?.classList.remove('show');
    el?.remove();
  }

  function showDialog({ title, message, buttons }) {
    ensureCss();
    return new Promise((resolve) => {
      const overlay = document.createElement('div');
      overlay.className = 'eod-alert-overlay show';
      overlay.innerHTML = `
        <div class="eod-alert-dialog" role="dialog" aria-modal="true">
          <h2>${global.EodApi?.escapeHtml?.(title) || String(title || 'Notice')}</h2>
          <p class="eod-alert-body">${global.EodApi?.escapeHtml?.(message) || String(message || '')}</p>
          <div class="eod-alert-actions"></div>
        </div>`;
      const actions = overlay.querySelector('.eod-alert-actions');
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
      document.body.appendChild(overlay);
      actions.querySelector('button')?.focus();
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
