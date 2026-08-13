/* Daily store PIC / manager QR — one scan, pick title, review SI photos, sign. */
(function () {
  'use strict';

  const API = 'https://eod-api.the-dump-bin.com/api/guest-handoff/store-pic';

  let state = { picUrl: null, token: null, expiresAt: null };

  function authFetch(url, init) {
    if (typeof window.authFetch === 'function') return window.authFetch(url, init);
    const opts = typeof window.applyEodVersionHeader === 'function'
      ? window.applyEodVersionHeader(init)
      : init;
    if (window.dumpBinAuthFetch) return window.dumpBinAuthFetch(url, opts);
    return fetch(url, opts);
  }

  function dayConfirmHeaders(extra) {
    const headers = Object.assign({ 'Content-Type': 'application/json' }, extra || {});
    try {
      const stored = JSON.parse(localStorage.getItem('kompassDayConfirm') || 'null');
      if (stored?.token) headers['X-Day-Confirm'] = stored.token;
    } catch (_) { /* ignore */ }
    return headers;
  }

  function storeNumber() {
    return (document.getElementById('storeNumber')?.value || '').trim();
  }

  function workDate() {
    return (document.getElementById('workDate')?.value
      || document.getElementById('dayConfirmDate')?.value
      || '').trim();
  }

  function leadName() {
    return (document.getElementById('leadName')?.value
      || document.getElementById('profileName')?.value
      || '').trim();
  }

  function fiscalWeek() {
    return window.EodDigitalSignoff?.getSheet?.()?.fiscalWeek || '';
  }

  function ensureFullscreen() {
    if (document.getElementById('eodPicQrFs')) return;
    const el = document.createElement('div');
    el.id = 'eodPicQrFs';
    el.style.cssText = 'display:none;position:fixed;inset:0;z-index:10050;background:rgba(2,6,23,.94);align-items:center;justify-content:center;padding:20px;';
    el.innerHTML = `<div style="background:#fff;color:#0f172a;border-radius:16px;padding:24px;max-width:420px;width:100%;text-align:center;">
      <h3 style="margin:0 0 8px;">PIC / manager sign-out</h3>
      <p style="margin:0;color:#64748b;font-size:14px;">Store #<span id="eodPicQrFsStore"></span> · <span id="eodPicQrFsDate"></span></p>
      <p style="margin:8px 0 0;color:#64748b;font-size:13px;">Scan, pick your title, review set photos, then sign.</p>
      <img id="eodPicQrFsImg" alt="PIC QR" width="280" height="280" style="width:280px;height:280px;background:#fff;margin:16px auto;display:block;">
      <div id="eodPicQrFsUrl" style="font-size:11px;word-break:break-all;color:#475569;margin-bottom:12px;"></div>
      <button type="button" class="btn btn-primary" id="eodPicQrFsClose" style="width:100%;">Done</button>
    </div>`;
    document.body.appendChild(el);
    document.getElementById('eodPicQrFsClose').onclick = () => {
      el.style.display = 'none';
    };
    el.addEventListener('click', (e) => {
      if (e.target === el) el.style.display = 'none';
    });
  }

  function paintCard() {
    const status = document.getElementById('eodPicQrStatus');
    const img = document.getElementById('eodPicQrImg');
    const urlEl = document.getElementById('eodPicQrUrl');
    if (!status) return;
    if (!state.picUrl) {
      status.textContent = 'Confirm today\'s store to generate a QR.';
      status.hidden = false;
      if (img) img.hidden = true;
      if (urlEl) urlEl.hidden = true;
      return;
    }
    status.hidden = true;
    if (img) {
      img.hidden = false;
      img.src = `https://api.qrserver.com/v1/create-qr-code/?size=280x280&data=${encodeURIComponent(state.picUrl)}`;
    }
    if (urlEl) {
      urlEl.hidden = false;
      urlEl.textContent = state.picUrl;
    }
  }

  async function refresh(force) {
    const store = storeNumber();
    const date = workDate();
    const status = document.getElementById('eodPicQrStatus');
    if (!store || !date) {
      state = { picUrl: null, token: null, expiresAt: null };
      paintCard();
      return null;
    }
    if (status) status.textContent = 'Generating QR…';
    const resp = await authFetch(API, {
      method: 'POST',
      headers: dayConfirmHeaders(),
      body: JSON.stringify({
        storeNumber: store,
        workDate: date,
        fiscalWeek: fiscalWeek() || undefined,
        leadName: leadName(),
        refresh: !!force,
      }),
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok || data.ok === false) {
      if (status) status.textContent = data.error || 'Could not mint PIC QR (confirm today\'s store first).';
      throw new Error(data.error || `PIC QR failed (${resp.status})`);
    }
    state = {
      picUrl: data.picUrl || data.handoffUrl,
      token: data.token,
      expiresAt: data.expiresAt,
      checkoutManagerName: data.session?.checkoutManagerName || null,
      checkoutManagerTitle: data.session?.checkoutManagerTitle || null,
    };
    paintCard();

    // Soft-fill check-out manager if empty
    if (state.checkoutManagerName) {
      const out = document.getElementById('checkOutManager');
      if (out && !out.value.trim()) {
        out.value = state.checkoutManagerName;
        out.dispatchEvent(new Event('change', { bubbles: true }));
        if (typeof window.autoSave === 'function') window.autoSave();
      }
    }
    return state;
  }

  function showFullscreen() {
    ensureFullscreen();
    if (!state.picUrl) {
      refresh(false).then(showFullscreen).catch((err) => {
        if (typeof showAlert === 'function') showAlert('PIC QR', err.message);
        else alert(err.message);
      });
      return;
    }
    document.getElementById('eodPicQrFsStore').textContent = storeNumber();
    document.getElementById('eodPicQrFsDate').textContent = workDate();
    document.getElementById('eodPicQrFsUrl').textContent = state.picUrl;
    document.getElementById('eodPicQrFsImg').src =
      `https://api.qrserver.com/v1/create-qr-code/?size=280x280&data=${encodeURIComponent(state.picUrl)}`;
    document.getElementById('eodPicQrFs').style.display = 'flex';
  }

  function wireUi() {
    document.getElementById('eodPicQrShowBtn')?.addEventListener('click', showFullscreen);
    document.getElementById('eodPicQrRefreshBtn')?.addEventListener('click', () => {
      refresh(true).catch((err) => {
        if (typeof showAlert === 'function') showAlert('PIC QR', err.message);
        else alert(err.message);
      });
    });
  }

  function init() {
    wireUi();
    // Defer first mint until page is visited
  }

  window.EodPicQr = {
    refresh,
    showFullscreen,
    getState: () => state,
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
