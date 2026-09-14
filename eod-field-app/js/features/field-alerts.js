/* Forced supervisor notices — dual-ack popup (I understand + Dismiss). */
(function (global) {
  'use strict';

  const POLL_MS = 20000;
  const STYLE_ID = 'eod-field-alerts-css';
  const OVERLAY_ID = 'eodFieldAlertOverlay';

  let pollTimer = null;
  let showingId = null;
  let busy = false;
  let queue = [];

  function apiBase() {
    return global.EOD_API_BASE || 'https://eod-api.the-dump-bin.com';
  }

  function escapeHtml(s) {
    return global.EodApi?.escapeHtml?.(s) || String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function visitContext() {
    const S = global.EodSession?.state || {};
    return {
      storeNumber: S.storeNumber || '',
      workDate: S.workDate || '',
    };
  }

  function ensureCss() {
    if (document.getElementById(STYLE_ID)) return;
    const css = document.createElement('style');
    css.id = STYLE_ID;
    css.textContent = `
      .eod-field-alert-overlay {
        display: none; position: fixed; inset: 0; z-index: 62000;
        background: rgba(2, 6, 23, 0.88);
        align-items: center; justify-content: center;
        padding: max(16px, env(safe-area-inset-top, 0px)) max(16px, env(safe-area-inset-right, 0px))
                 max(16px, env(safe-area-inset-bottom, 0px)) max(16px, env(safe-area-inset-left, 0px));
      }
      .eod-field-alert-overlay.show { display: flex; }
      .eod-field-alert-dialog {
        width: min(520px, 100%); max-height: min(88vh, 720px);
        overflow: auto; -webkit-overflow-scrolling: touch;
        background: var(--surface, #0f172a); color: var(--text, #f8fafc);
        border: 1px solid var(--accent, #38bdf8); border-radius: 16px;
        padding: 18px 16px 14px; box-shadow: 0 18px 48px rgba(0,0,0,.45);
      }
      .eod-field-alert-dialog h2 {
        margin: 0 0 10px; font-size: 1.15rem; line-height: 1.25;
      }
      .eod-field-alert-body {
        margin: 0 0 14px; font-size: 0.98rem; line-height: 1.45;
        color: var(--muted, #cbd5e1);
      }
      .eod-field-alert-body p { margin: 0 0 0.75em; }
      .eod-field-alert-body p:last-child { margin-bottom: 0; }
      .eod-field-alert-body a { color: #7dd3fc; text-decoration: underline; }
      .eod-field-alert-body code {
        font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
        font-size: 0.9em; background: rgba(148,163,184,.15); padding: 0.1em 0.35em; border-radius: 4px;
      }
      .eod-field-alert-images { display: grid; gap: 10px; margin: 0 0 14px; }
      .eod-field-alert-images img {
        display: block; width: 100%; max-height: 280px; object-fit: contain;
        border-radius: 10px; background: #020617; border: 1px solid rgba(148,163,184,.25);
      }
      .eod-field-alert-ack {
        display: flex; align-items: flex-start; gap: 10px;
        margin: 0 0 12px; font-size: 0.95rem; line-height: 1.35;
      }
      .eod-field-alert-ack input {
        width: 22px; height: 22px; margin-top: 1px; flex: 0 0 auto;
        accent-color: #38bdf8;
      }
      .eod-field-alert-actions { display: flex; gap: 8px; }
      .eod-field-alert-actions .btn {
        min-height: 48px; flex: 1 1 auto; font-size: 1rem;
      }
      .eod-field-alert-actions .btn:disabled {
        opacity: 0.45; cursor: not-allowed;
      }
    `;
    document.head.appendChild(css);
  }

  function imageSrc(img) {
    const url = String(img?.url || '').trim();
    if (!url) return '';
    if (/^https?:\/\//i.test(url)) return url;
    if (url.startsWith('/')) return `${apiBase()}${url}`;
    return url;
  }

  function needsAuthFetch(url) {
    const u = String(url || '');
    return u.includes('/api/field-alerts/media/');
  }

  function renderImages(images) {
    const list = Array.isArray(images) ? images.filter((i) => i && i.url) : [];
    if (!list.length) return '';
    return `<div class="eod-field-alert-images">${list.map((img, idx) => {
      const src = escapeHtml(imageSrc(img));
      const alt = escapeHtml(img.alt || '');
      return `<img data-field-alert-img="${idx}" data-src="${src}" alt="${alt}" loading="eager" decoding="async">`;
    }).join('')}</div>`;
  }

  async function hydrateImages(host) {
    const imgs = [...(host?.querySelectorAll?.('img[data-field-alert-img]') || [])];
    await Promise.all(imgs.map(async (img) => {
      const src = img.getAttribute('data-src') || '';
      if (!src) return;
      if (!needsAuthFetch(src)) {
        img.src = src;
        return;
      }
      try {
        const resp = await global.authFetch(src, { noBounceOn401: true });
        if (!resp.ok) return;
        const blob = await resp.blob();
        img.src = URL.createObjectURL(blob);
      } catch (_) { /* leave empty */ }
    }));
  }

  function closeOverlay() {
    const el = document.getElementById(OVERLAY_ID);
    if (!el) return;
    global.EodA11y?.deactivate?.(el);
    el.classList.remove('show');
    el.remove();
    showingId = null;
  }

  async function postAction(alertId, action) {
    const ctx = visitContext();
    const resp = await global.authFetch(`${apiBase()}/api/field-alerts/${encodeURIComponent(alertId)}/${action}`, {
      method: 'POST',
      headers: global.EodApi?.dayConfirmHeaders?.() || { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        storeNumber: ctx.storeNumber || undefined,
        workDate: ctx.workDate || undefined,
      }),
      noBounceOn401: true,
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      const err = new Error(data.error || `Could not ${action}`);
      err.status = resp.status;
      throw err;
    }
    return data;
  }

  function showAlert(alert) {
    if (!alert?.id) return;
    ensureCss();
    closeOverlay();
    showingId = alert.id;

    const overlay = document.createElement('div');
    overlay.id = OVERLAY_ID;
    overlay.className = 'eod-field-alert-overlay show';
    overlay.setAttribute('data-alert-id', alert.id);
    const bodyHtml = String(alert.bodyHtml || '').trim()
      || `<p>${escapeHtml(alert.bodyMd || '')}</p>`;
    const alreadyUnderstood = !!alert.understoodAt;
    overlay.innerHTML = `
      <div class="eod-field-alert-dialog" role="dialog" aria-modal="true" aria-labelledby="eodFieldAlertTitle">
        <h2 id="eodFieldAlertTitle">${escapeHtml(alert.title || 'Message')}</h2>
        <div class="eod-field-alert-body">${bodyHtml}</div>
        ${renderImages(alert.images)}
        <label class="eod-field-alert-ack">
          <input type="checkbox" id="eodFieldAlertUnderstand" ${alreadyUnderstood ? 'checked' : ''}>
          <span>I understand</span>
        </label>
        <div class="eod-field-alert-actions">
          <button type="button" class="btn btn-primary" id="eodFieldAlertDismiss" ${alreadyUnderstood ? '' : 'disabled'}>Dismiss</button>
        </div>
      </div>`;

    // Block backdrop / escape dismiss — persistent until dual ack.
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) e.stopPropagation();
    });
    overlay.addEventListener('eod-dialog-escape', (e) => {
      e.stopPropagation();
    });

    const understand = overlay.querySelector('#eodFieldAlertUnderstand');
    const dismiss = overlay.querySelector('#eodFieldAlertDismiss');

    understand.addEventListener('change', async () => {
      if (!understand.checked) {
        dismiss.disabled = true;
        return;
      }
      dismiss.disabled = true;
      understand.disabled = true;
      try {
        await postAction(alert.id, 'understand');
        alert.understoodAt = new Date().toISOString();
        dismiss.disabled = false;
        understand.disabled = false;
        global.EodA11y?.announce?.('Marked understood. You can dismiss.');
      } catch (err) {
        understand.checked = false;
        understand.disabled = false;
        dismiss.disabled = true;
        global.EodA11y?.announce?.(err.message || 'Could not save acknowledgment');
        try { await global.EodAlerts?.alert?.('Could not save', err.message || 'Try again'); } catch (_) {}
      }
    });

    dismiss.addEventListener('click', async () => {
      if (!understand.checked) return;
      dismiss.disabled = true;
      understand.disabled = true;
      try {
        await postAction(alert.id, 'dismiss');
        closeOverlay();
        queue = queue.filter((a) => a.id !== alert.id);
        global.EodA11y?.announce?.('Message dismissed');
        showNext();
      } catch (err) {
        dismiss.disabled = false;
        understand.disabled = false;
        global.EodA11y?.announce?.(err.message || 'Could not dismiss');
        try { await global.EodAlerts?.alert?.('Could not dismiss', err.message || 'Try again'); } catch (_) {}
      }
    });

    document.body.appendChild(overlay);
    void hydrateImages(overlay);
    global.EodA11y?.activate?.(overlay, understand);
  }

  function showNext() {
    if (showingId) return;
    const next = queue[0];
    if (next) showAlert(next);
  }

  async function refresh() {
    if (busy) return;
    busy = true;
    try {
      const ctx = visitContext();
      const qs = ctx.storeNumber
        ? `?store=${encodeURIComponent(ctx.storeNumber)}`
        : '';
      const resp = await global.authFetch(`${apiBase()}/api/field-alerts/pending${qs}`, {
        noBounceOn401: true,
      });
      if (!resp.ok) return;
      const data = await resp.json().catch(() => ({}));
      const alerts = Array.isArray(data.alerts) ? data.alerts : [];
      queue = alerts;
      if (showingId) {
        const still = alerts.some((a) => a.id === showingId);
        if (!still) {
          closeOverlay();
          showNext();
        }
        return;
      }
      showNext();
    } catch (_) {
      /* offline / auth — retry on next poll */
    } finally {
      busy = false;
    }
  }

  function startPolling() {
    if (pollTimer) return;
    pollTimer = setInterval(() => { void refresh(); }, POLL_MS);
  }

  function init() {
    ensureCss();
    startPolling();
    void refresh();
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) void refresh();
    });
    try {
      global.EodSession?.onChange?.(() => { void refresh(); });
    } catch (_) { /* optional */ }
  }

  global.EodFieldAlerts = {
    init,
    refresh,
    /** Test hook */
    _show: showAlert,
  };
})(typeof window !== 'undefined' ? window : globalThis);
