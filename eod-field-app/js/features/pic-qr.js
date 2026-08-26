/* Daily store PIC / manager QR — one scan, pick title, review SI photos, sign. */
(function (global) {
  'use strict';

  const API = 'https://eod-api.the-dump-bin.com/api/guest-handoff/store-pic';

  let state = { picUrl: null, token: null, expiresAt: null };

  function storeNumber() {
    return (global.EodSession?.state?.storeNumber || document.getElementById('storeNumber')?.value || '').trim();
  }
  function workDate() {
    return (global.EodSession?.state?.workDate || document.getElementById('workDate')?.value || '').trim();
  }
  function leadName() {
    return (global.EodSession?.state?.leadName || global.EodSession?.state?.profileName || '').trim();
  }
  function fiscalWeek() {
    return global.EodSession?.state?.sheet?.fiscalWeek || '';
  }

  function applyCheckout(name) {
    if (!name) return;
    const S = global.EodSession;
    if (S && !(S.state.checkOutManager || '').trim()) {
      S.patch({ checkOutManager: name }, 'pic-checkout');
      S.saveDraft();
    }
    const out = document.getElementById('checkOutManager');
    if (out && !out.value.trim()) {
      out.value = name;
      out.dispatchEvent(new Event('change', { bubbles: true }));
    }
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
    const resp = await global.authFetch(API, {
      method: 'POST',
      headers: global.EodApi.dayConfirmHeaders(),
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
      if (status) status.textContent = data.error || 'Could not mint PIC QR.';
      throw new Error(data.error || `PIC QR failed (${resp.status})`);
    }
    state = {
      picUrl: data.picUrl || data.handoffUrl,
      token: data.token,
      expiresAt: data.expiresAt,
      checkoutManagerName: data.session?.checkoutManagerName || null,
    };
    paintCard();
    applyCheckout(state.checkoutManagerName);
    return state;
  }

  function ensureFullscreen() {
    if (document.getElementById('eodPicQrFs')) return;
    const el = document.createElement('div');
    el.id = 'eodPicQrFs';
    el.className = 'eod-pic-qr-fs';
    el.innerHTML = `<div class="modal-dialog">
      <h2>PIC / manager sign-out</h2>
      <p class="muted">Store #<span id="eodPicQrFsStore"></span> · <span id="eodPicQrFsDate"></span></p>
      <img id="eodPicQrFsImg" alt="PIC QR" width="280" height="280" style="width:280px;height:280px;background:#fff;margin:16px auto;display:block;">
      <div id="eodPicQrFsUrl" class="muted" style="word-break:break-all;"></div>
      <button type="button" class="btn btn-primary btn-block" id="eodPicQrFsClose">Done</button>
    </div>`;
    document.body.appendChild(el);
    document.getElementById('eodPicQrFsClose').onclick = () => { el.style.display = 'none'; };
    el.addEventListener('click', (e) => { if (e.target === el) el.style.display = 'none'; });
  }

  function showFullscreen() {
    ensureFullscreen();
    if (!state.picUrl) {
      refresh(false).then(showFullscreen).catch((err) => {
        if (global.showAlert) global.showAlert('PIC QR', err.message);
        else alert(err.message);
      });
      return;
    }
    document.getElementById('eodPicQrFsStore').textContent = storeNumber();
    document.getElementById('eodPicQrFsDate').textContent = workDate();
    document.getElementById('eodPicQrFsUrl').textContent = state.picUrl;
    document.getElementById('eodPicQrFsImg').src =
      `https://api.qrserver.com/v1/create-qr-code/?size=280x280&data=${encodeURIComponent(state.picUrl)}`;
    const fs = document.getElementById('eodPicQrFs');
    fs.style.display = 'flex';
    fs.classList.add('modal-overlay', 'show');
  }

  function cardHtml() {
    return `<div class="card" id="eodPicQrCard">
      <h2>Daily PIC QR</h2>
      <p class="muted" id="eodPicQrStatus"></p>
      <img id="eodPicQrImg" alt="PIC QR" hidden width="200" height="200" style="width:200px;height:200px;background:#fff;display:block;margin:8px auto;">
      <div id="eodPicQrUrl" class="muted" hidden style="word-break:break-all;font-size:12px;"></div>
      <div class="btn-row">
        <button type="button" class="btn btn-primary" id="eodPicQrShowBtn">Show QR</button>
        <button type="button" class="btn btn-secondary" id="eodPicQrRefreshBtn">Refresh</button>
      </div>
    </div>`;
  }

  async function mount(host) {
    if (!host) return;
    host.innerHTML = cardHtml();
    document.getElementById('eodPicQrShowBtn')?.addEventListener('click', showFullscreen);
    document.getElementById('eodPicQrRefreshBtn')?.addEventListener('click', () => {
      refresh(true).catch((err) => {
        if (global.showAlert) global.showAlert('PIC QR', err.message);
      });
    });
    try { await refresh(false); } catch (_) { paintCard(); }
  }

  global.EodPicQr = { refresh, showFullscreen, mount, getState: () => state, cardHtml };
})(typeof window !== 'undefined' ? window : globalThis);
