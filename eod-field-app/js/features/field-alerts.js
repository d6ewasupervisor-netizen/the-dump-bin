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

  /** #/alerts/<id>?t=<openToken> — the SMS deep link target. */
  function deepLinkTarget() {
    const hash = String(global.location?.hash || '');
    const m = hash.match(/#\/alerts\/([^?]+)/);
    if (!m) return null;
    const params = new URLSearchParams(hash.split('?')[1] || '');
    return { id: decodeURIComponent(m[1]), token: params.get('t') || '' };
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
      .eod-field-alert-info {
        position: fixed;
        left: 12px;
        right: 12px;
        bottom: calc(var(--nav-h, 56px) + var(--safe-b, 0px) + 8px);
        z-index: 40;
        display: grid;
        gap: 8px;
        max-height: 28vh;
        overflow: auto;
        -webkit-overflow-scrolling: touch;
        pointer-events: none;
      }
      .eod-field-alert-info-card {
        pointer-events: auto;
        background: #0f172a;
        color: #f8fafc;
        border: 1px solid #38bdf8;
        border-radius: 12px;
        padding: 10px 12px;
      }
      .eod-field-alert-info-head {
        display: flex;
        align-items: center;
        gap: 8px;
      }
      .eod-field-alert-info-head strong {
        flex: 1 1 auto;
        font-size: 0.95rem;
        line-height: 1.25;
      }
      .eod-field-alert-info-close {
        appearance: none;
        border: 0;
        background: transparent;
        color: #7dd3fc;
        font: inherit;
        font-weight: 700;
        min-height: 44px;
        min-width: 44px;
        padding: 0 8px;
      }
      .eod-field-alert-info-body {
        margin-top: 4px;
        font-size: 0.9rem;
        line-height: 1.35;
        color: #cbd5e1;
        display: -webkit-box;
        -webkit-line-clamp: 3;
        -webkit-box-orient: vertical;
        overflow: hidden;
      }
      .eod-field-alert-info-doc {
        display: inline-block;
        margin-top: 6px;
        color: #7dd3fc;
        font-weight: 700;
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
    const mustOpen = alert.requireOpen === true && !alert.openedAt;
    overlay.innerHTML = `
      <div class="eod-field-alert-dialog" role="dialog" aria-modal="true" aria-labelledby="eodFieldAlertTitle">
        <h2 id="eodFieldAlertTitle">${escapeHtml(alert.title || 'Message')}</h2>
        <div class="eod-field-alert-body">${bodyHtml}</div>
        ${renderImages(alert.images)}
        ${alert.docUrl ? '<button type="button" class="btn" id="eodFieldAlertOpen">Open notice</button>' : ''}
        <div id="eodFieldAlertViewer" hidden style="margin:12px 0;height:60vh;background:#020617;border-radius:10px;overflow:hidden;"></div>
        <label class="eod-field-alert-ack">
          <input type="checkbox" id="eodFieldAlertUnderstand" ${alreadyUnderstood ? 'checked' : ''} ${mustOpen ? 'disabled' : ''}>
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
    const openBtn = overlay.querySelector('#eodFieldAlertOpen');
    if (openBtn) {
      openBtn.addEventListener('click', async () => {
        openBtn.disabled = true;
        try {
          const resp = await global.authFetch(`${apiBase()}/api/field-alerts/${encodeURIComponent(alert.id)}/open`, {
            noBounceOn401: true,
          });
          const data = await resp.json().catch(() => ({}));
          if (!resp.ok) throw new Error(data.error || 'Could not open the notice');
          alert.openedAt = data.opened && data.opened.opened_at;
          understand.disabled = false;
          const viewer = overlay.querySelector('#eodFieldAlertViewer');
          const src = data.docUrl || alert.docUrl;
          if (viewer && src) {
            viewer.hidden = false;
            viewer.innerHTML = `<iframe title="Notice" src="${escapeHtml(src)}" style="width:100%;height:100%;border:0;background:#fff;"></iframe>`;
          }
        } catch (err) {
          openBtn.disabled = false;
          global.EodA11y?.announce?.(err.message || 'Could not open the notice');
        }
      });
    }

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

  function cssEscape(value) {
    if (global.CSS?.escape) return global.CSS.escape(value);
    return String(value).replace(/"/g, '\\"');
  }

  async function dismissInfo(alertId) {
    if (!alertId) return;
    const host = document.getElementById('eodFieldAlertInfo');
    const card = host?.querySelector(`[data-alert-id="${cssEscape(alertId)}"]`);
    const btn = card?.querySelector('[data-info-dismiss]');
    if (btn) btn.disabled = true;
    try {
      await postAction(alertId, 'understand');
      await postAction(alertId, 'dismiss');
      card?.remove();
      if (host && !host.children.length) host.remove();
    } catch (_) {
      if (btn) btn.disabled = false;
    }
  }

  function renderInfoBanner(alerts) {
    let host = document.getElementById('eodFieldAlertInfo');
    if (!alerts.length) {
      if (host) host.remove();
      return;
    }
    ensureCss();
    if (!host) {
      host = document.createElement('div');
      host.id = 'eodFieldAlertInfo';
      host.className = 'eod-field-alert-info';
      document.body.appendChild(host);
    }
    host.innerHTML = alerts.map((a) => {
      const doc = a.docUrl
        ? `<a class="eod-field-alert-info-doc" href="${escapeHtml(a.docUrl)}" target="_blank" rel="noopener">Open the update</a>`
        : '';
      return `<div class="eod-field-alert-info-card" data-alert-id="${escapeHtml(a.id)}">
        <div class="eod-field-alert-info-head">
          <strong>${escapeHtml(a.title || 'Notice')}</strong>
          <button type="button" class="eod-field-alert-info-close" data-info-dismiss="${escapeHtml(a.id)}">Close</button>
        </div>
        <div class="eod-field-alert-info-body">${escapeHtml(a.bodyMd || '')}</div>
        ${doc}
      </div>`;
    }).join('');
    host.querySelectorAll('[data-info-dismiss]').forEach((btn) => {
      btn.addEventListener('click', () => { void dismissInfo(btn.getAttribute('data-info-dismiss')); });
    });
  }

  function showNext() {
    if (showingId) return;
    const next = queue[0];
    if (next) showAlert(next);
  }

  async function refresh() {
    if (busy) return false;
    busy = true;
    try {
      const ctx = visitContext();
      const params = new URLSearchParams();
      if (ctx.storeNumber) params.set('store', ctx.storeNumber);
      params.set('info', '1');
      const qs = `?${params.toString()}`;
      const resp = await global.authFetch(`${apiBase()}/api/field-alerts/pending${qs}`, {
        noBounceOn401: true,
      });
      if (!resp.ok) return false;
      const data = await resp.json().catch(() => ({}));
      const alerts = Array.isArray(data.alerts) ? data.alerts : [];
      const target = deepLinkTarget();
      if (target) {
        // The SMS-linked alert shows first.
        alerts.sort((a, b) => (a.id === target.id ? -1 : 0) - (b.id === target.id ? -1 : 0));
      }
      const info = alerts.filter((a) => a.severity === 'info');
      queue = alerts.filter((a) => a.severity !== 'info');
      renderInfoBanner(info);
      if (showingId) {
        const still = alerts.some((a) => a.id === showingId);
        if (!still) {
          closeOverlay();
          showNext();
        }
        return true;
      }
      showNext();
      return true;
    } catch (_) {
      /* offline / auth — retry on next poll */
      return false;
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
    void (async () => {
      const ok = await refresh();
      const target = deepLinkTarget();
      if (target && !ok && target.token) {
        // SMS link without a session: straight to the PDF (the open is already
        // tracked with open_channel sms by the /open redirect).
        global.location?.replace(
          `${apiBase()}/api/field-alerts/${encodeURIComponent(target.id)}/open?token=${encodeURIComponent(target.token)}&format=pdf`,
        );
      }
    })();
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) void refresh();
    });
    try {
      global.EodSession?.onChange?.(() => { void refresh(); });
    } catch (_) { /* optional */ }
    try {
      global.EodRouter?.register?.('alerts', (mount) => {
        mount.innerHTML = '<div class="card"><h1>Notice</h1><p>Loading the notice…</p></div>';
        void refresh();
      });
    } catch (_) { /* router optional */ }
  }

  global.EodFieldAlerts = {
    init,
    refresh,
    /** Test hook */
    _show: showAlert,
  };
})(typeof window !== 'undefined' ? window : globalThis);
