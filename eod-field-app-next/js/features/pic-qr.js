/* Daily store PIC / manager QR — one scan, pick title, review SI photos, sign. */
(function (global) {
  'use strict';

  const API = 'https://eod-api.the-dump-bin.com/api/guest-handoff/store-pic';
  const OPTIN_API = 'https://eod-api.the-dump-bin.com/api/dept-signatures';

  let state = { picUrl: null, token: null, expiresAt: null };
  let optedIn = [];

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
    if (S && global.EodVisitMemory?.setManagers) {
      global.EodVisitMemory.setManagers(S, { checkOutManager: name }, 'pic-checkout');
    } else if (S) {
      S.patch({ checkOutManager: name }, 'pic-checkout');
      S.saveDraft();
    }
    const out = document.getElementById('checkOutManager');
    if (out) {
      out.value = name;
      out.dispatchEvent(new Event('change', { bubbles: true }));
    }
    try { global.EodSend?.refreshGates?.(); } catch (_) {}
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

  async function loadOptedIn() {
    const store = storeNumber();
    if (!store) {
      optedIn = [];
      return optedIn;
    }
    const resp = await global.authFetch(`${OPTIN_API}/${encodeURIComponent(store)}/sms-opted-in`);
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok || data.ok === false) {
      throw new Error(data.error || `Could not load opted-in PICs (${resp.status})`);
    }
    optedIn = Array.isArray(data.contacts) ? data.contacts : [];
    return optedIn;
  }

  async function sendLink({ recipientName, recipientPhone, roleKey }) {
    await refresh(false);
    if (!state.picUrl) throw new Error('Confirm today\'s store first to mint a PIC QR.');
    const live = typeof global.isEodForceLiveDelivery === 'function'
      && global.isEodForceLiveDelivery();
    const resp = await global.authFetch(`${API}/send`, {
      method: 'POST',
      headers: global.EodApi.dayConfirmHeaders(),
      body: JSON.stringify({
        storeNumber: storeNumber(),
        workDate: workDate(),
        fiscalWeek: fiscalWeek() || undefined,
        leadName: leadName(),
        recipientName,
        recipientPhone,
        roleKey: roleKey || undefined,
        sendSms: true,
        sendEmail: false,
        forceLive: live || undefined,
      }),
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok || data.ok === false) {
      const smsErr = data.delivery?.sms?.find?.((r) => !r.ok);
      throw new Error(smsErr?.error || data.error || `Send failed (${resp.status})`);
    }
    return data;
  }

  function ensureFullscreen() {
    if (document.getElementById('eodPicQrFs')) return;
    const el = document.createElement('div');
    el.id = 'eodPicQrFs';
    el.className = 'eod-pic-qr-fs';
    el.innerHTML = `<div class="modal-dialog">
      <h2>PIC / manager sign-out</h2>
      <p class="muted">Store #<span id="eodPicQrFsStore"></span> · <span id="eodPicQrFsDate"></span></p>
      <img id="eodPicQrFsImg" alt="PIC QR" width="280" height="280" class="eod-qr" style="background:#fff;margin:16px auto;display:block;">
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

  function maskPhone(phone) {
    const d = String(phone || '').replace(/\D/g, '').slice(-10);
    if (d.length !== 10) return '';
    return `(***) ***-${d.slice(-4)}`;
  }

  function ensureTextPicker() {
    if (document.getElementById('eodPicTextFs')) return;
    const el = document.createElement('div');
    el.id = 'eodPicTextFs';
    el.className = 'eod-pic-qr-fs';
    el.innerHTML = `<div class="modal-dialog">
      <h2>Text PIC</h2>
      <p class="muted" id="eodPicTextStatus"></p>
      <div id="eodPicTextList"></div>
      <button type="button" class="btn btn-secondary btn-block" id="eodPicTextClose" style="margin-top:12px;">Close</button>
    </div>`;
    document.body.appendChild(el);
    document.getElementById('eodPicTextClose').onclick = () => { el.style.display = 'none'; };
    el.addEventListener('click', (e) => { if (e.target === el) el.style.display = 'none'; });
  }

  function roleLabel(key) {
    const roles = global.EodDeptSignatures?.roles?.() || [];
    const hit = roles.find((r) => String(r.key) === String(key));
    return hit?.label || key || '';
  }

  async function textOne(pic) {
    const status = document.getElementById('eodPicTextStatus');
    if (status) status.textContent = `Texting ${pic.name || 'PIC'}…`;
    try {
      const data = await sendLink({
        recipientName: pic.name,
        recipientPhone: pic.phone,
        roleKey: pic.roleKey,
      });
      const sms = data.delivery?.sms?.find?.((r) => r.ok);
      if (status) status.textContent = sms ? `Sent to ${pic.name || 'PIC'}.` : 'Sent.';
    } catch (err) {
      if (status) status.textContent = err.message || 'Send failed.';
      if (global.showAlert) global.showAlert('Text PIC', err.message || 'Send failed.');
    }
  }

  async function showTextPicker() {
    ensureTextPicker();
    const fs = document.getElementById('eodPicTextFs');
    const list = document.getElementById('eodPicTextList');
    const status = document.getElementById('eodPicTextStatus');
    fs.style.display = 'flex';
    fs.classList.add('modal-overlay', 'show');
    if (status) status.textContent = 'Loading…';
    if (list) list.innerHTML = '';
    try {
      await loadOptedIn();
    } catch (err) {
      if (status) status.textContent = err.message || 'Could not load opted-in PICs.';
      return;
    }
    if (!optedIn.length) {
      if (status) status.textContent = 'No opted-in numbers yet.';
      return;
    }
    if (status) status.textContent = '';
    list.innerHTML = optedIn.map((p, i) => {
      const meta = [roleLabel(p.roleKey), maskPhone(p.phone)].filter(Boolean).join(' · ');
      return `<button type="button" class="btn btn-secondary btn-block" data-pic-idx="${i}" style="margin-top:8px;text-align:left;">
        <strong>${escapeHtml(p.name || 'PIC')}</strong>
        ${meta ? `<div class="muted">${escapeHtml(meta)}</div>` : ''}
      </button>`;
    }).join('');
    list.querySelectorAll('[data-pic-idx]').forEach((btn) => {
      btn.onclick = () => {
        const pic = optedIn[Number(btn.getAttribute('data-pic-idx'))];
        if (pic) textOne(pic);
      };
    });
  }

  function escapeHtml(s) {
    return String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function cardHtml() {
    return `<div class="card" id="eodPicQrCard">
      <h2>Daily PIC QR</h2>
      <p class="muted" id="eodPicQrStatus"></p>
      <img id="eodPicQrImg" alt="PIC QR" hidden width="200" height="200" class="eod-qr" style="background:#fff;display:block;margin:8px auto;">
      <div id="eodPicQrUrl" class="muted" hidden style="word-break:break-all;font-size:12px;"></div>
      <div class="btn-row">
        <button type="button" class="btn btn-primary" id="eodPicQrShowBtn">Show QR</button>
        <button type="button" class="btn btn-primary" id="eodPicQrTextBtn">Text PIC</button>
        <button type="button" class="btn btn-secondary" id="eodPicQrRefreshBtn">Refresh</button>
      </div>
    </div>`;
  }

  async function mount(host) {
    if (!host) return;
    host.innerHTML = cardHtml();
    document.getElementById('eodPicQrShowBtn')?.addEventListener('click', showFullscreen);
    document.getElementById('eodPicQrTextBtn')?.addEventListener('click', () => {
      showTextPicker().catch((err) => {
        if (global.showAlert) global.showAlert('Text PIC', err.message);
      });
    });
    document.getElementById('eodPicQrRefreshBtn')?.addEventListener('click', () => {
      refresh(true).catch((err) => {
        if (global.showAlert) global.showAlert('PIC QR', err.message);
      });
    });
    try { await refresh(false); } catch (_) { paintCard(); }
  }

  global.EodPicQr = {
    refresh,
    showFullscreen,
    showTextPicker,
    sendLink,
    mount,
    getState: () => state,
    getOptedIn: () => optedIn.slice(),
    cardHtml,
  };
})(typeof window !== 'undefined' ? window : globalThis);
