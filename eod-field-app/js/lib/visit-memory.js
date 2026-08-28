/* Per-store remembered names, emails, last store — same store_data plus device extras. */
(function (global) {
  'use strict';

  const KEY = 'eodVisitMemory';
  const LAST_STORE_KEY = 'eodLastStore';

  function normStore(s) {
    if (global.EodSession?.normStoreNumber) return global.EodSession.normStoreNumber(s);
    return String(s || '').replace(/\D/g, '').replace(/^0+(?=\d)/, '');
  }

  function loadAll() {
    try {
      const raw = JSON.parse(localStorage.getItem(KEY) || '{}');
      return raw && typeof raw === 'object' ? raw : {};
    } catch (_) {
      return {};
    }
  }

  function saveAll(obj) {
    try { localStorage.setItem(KEY, JSON.stringify(obj)); } catch (_) {}
  }

  function forStore(store) {
    const n = normStore(store);
    if (!n) return {};
    const row = loadAll()[n];
    return row && typeof row === 'object' ? row : {};
  }

  function lastStore() {
    try { return normStore(localStorage.getItem(LAST_STORE_KEY) || ''); } catch (_) { return ''; }
  }

  function rememberLastStore(store) {
    const n = normStore(store);
    if (!n) return;
    try { localStorage.setItem(LAST_STORE_KEY, n); } catch (_) {}
  }

  function remember(store, partial) {
    const n = normStore(store);
    if (!n) return;
    const all = loadAll();
    all[n] = Object.assign({}, all[n] || {}, partial || {}, { savedAt: Date.now() });
    saveAll(all);
    rememberLastStore(n);
  }

  function applyToSession(S, store) {
    if (!S?.state) return;
    const mem = forStore(store);
    const patch = {};
    if (!(S.state.checkInManager || '').trim() && mem.checkIn) patch.checkInManager = mem.checkIn;
    if (!(S.state.checkOutManager || '').trim() && mem.checkOut) patch.checkOutManager = mem.checkOut;
    if (!(S.state.emailRecipients || []).length && Array.isArray(mem.recipients) && mem.recipients.length) {
      patch.emailRecipients = mem.recipients.slice();
    }
    if (S.state.addRetailOdysseyTeam == null && typeof mem.addRetailOdysseyTeam === 'boolean') {
      patch.addRetailOdysseyTeam = mem.addRetailOdysseyTeam;
    }
    const pool = S.state.managerNamePool || [];
    if (!patch.checkInManager && !(S.state.checkInManager || '').trim() && pool.length === 1) {
      patch.checkInManager = pool[0];
    }
    if (Object.keys(patch).length) S.patch(patch, 'visit-memory');
  }

  function captureFromSession(S) {
    if (!S?.state) return;
    const store = S.state.storeNumber;
    if (!store) return;
    remember(store, {
      checkIn: S.state.checkInManager || '',
      checkOut: S.state.checkOutManager || '',
      recipients: Array.isArray(S.state.emailRecipients) ? S.state.emailRecipients.slice() : [],
      addRetailOdysseyTeam: !!S.state.addRetailOdysseyTeam,
      leadName: (typeof S.resolvedLeadName === 'function' ? S.resolvedLeadName() : '')
        || S.state.leadName
        || S.state.profileName
        || '',
    });
  }

  function chipsHtml(pool, selected, escFn) {
    const esc = typeof escFn === 'function' ? escFn : (s) => String(s == null ? '' : s);
    const names = Array.isArray(pool) ? pool : [];
    if (!names.length) return '';
    const sel = String(selected || '').trim().toLowerCase();
    return `<div class="manager-chips">${names.map((n) => {
      const on = String(n).trim().toLowerCase() === sel ? ' on' : '';
      return `<button type="button" class="manager-chip${on}" data-mgr="${esc(n)}">${esc(n)}</button>`;
    }).join('')}</div>`;
  }

  const api = {
    forStore,
    lastStore,
    rememberLastStore,
    remember,
    applyToSession,
    captureFromSession,
    chipsHtml,
  };
  if (typeof module === 'object' && module.exports) module.exports = api;
  global.EodVisitMemory = api;
})(typeof window !== 'undefined' ? window : globalThis);
