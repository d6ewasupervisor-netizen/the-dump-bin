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

  function forgetLastStore() {
    try { localStorage.removeItem(LAST_STORE_KEY); } catch (_) {}
  }

  function remember(store, partial) {
    const n = normStore(store);
    if (!n) return;
    const all = loadAll();
    all[n] = Object.assign({}, all[n] || {}, partial || {}, { savedAt: Date.now() });
    saveAll(all);
    rememberLastStore(n);
  }

  function keepText(next, prev) {
    const n = String(next || '').trim();
    if (n) return n;
    return String(prev || '').trim();
  }

  function applyToSession(S, store) {
    if (!S?.state) return;
    const mem = forStore(store);
    const patch = {};
    // Keep remembered names as chip/datalist options only — never auto-select.
    if (S.state.addRetailOdysseyTeam == null && typeof mem.addRetailOdysseyTeam === 'boolean') {
      patch.addRetailOdysseyTeam = mem.addRetailOdysseyTeam;
    }
    if (Object.keys(patch).length) {
      if (typeof S.patch === 'function') S.patch(patch, 'visit-memory');
      else Object.assign(S.state, patch);
    }
  }

  function leadNamePool(store, shiftLead) {
    const mem = forStore(store);
    const names = [];
    const seen = new Set();
    function push(raw) {
      const n = String(raw || '').trim();
      if (!n) return;
      const key = n.toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      names.push(n);
    }
    push(shiftLead);
    push(mem.leadName);
    try { push(global.EodSession?.rememberedProfileName?.()); } catch (_) {}
    for (const n of Array.isArray(mem.leadNames) ? mem.leadNames : []) push(n);
    return names;
  }

  function captureFromSession(S) {
    if (!S?.state) return;
    const store = S.state.storeNumber;
    if (!store) return;
    const mem = forStore(store);
    const inn = keepText(S.state.checkInManager, mem.checkIn);
    const out = keepText(S.state.checkOutManager, mem.checkOut);
    const recs = Array.isArray(S.state.emailRecipients) && S.state.emailRecipients.length
      ? S.state.emailRecipients.slice()
      : (Array.isArray(mem.recipients) ? mem.recipients.slice() : []);
    const lead = (typeof S.resolvedLeadName === 'function' ? S.resolvedLeadName() : '')
      || S.state.leadName
      || S.state.profileName
      || '';
    const leadNames = Array.isArray(mem.leadNames) ? mem.leadNames.slice() : [];
    if (lead && !leadNames.some((n) => String(n).trim().toLowerCase() === lead.toLowerCase())) {
      leadNames.unshift(lead);
    }
    remember(store, {
      checkIn: inn,
      checkOut: out,
      recipients: recs,
      addRetailOdysseyTeam: S.state.addRetailOdysseyTeam == null
        ? !!mem.addRetailOdysseyTeam
        : !!S.state.addRetailOdysseyTeam,
      leadName: lead || mem.leadName || '',
      leadNames: leadNames.slice(0, 12),
    });
  }

  function chipsHtml(pool, selected, escFn) {
    const esc = typeof escFn === 'function' ? escFn : (s) => String(s == null ? '' : s);
    const names = Array.isArray(pool) ? pool : [];
    if (!names.length) return '';
    const sel = String(selected || '').trim().toLowerCase();
    if (sel && names.some((n) => String(n).trim().toLowerCase() === sel)) return '';
    return `<div class="manager-chips">${names.map((n) => {
      return `<button type="button" class="manager-chip" data-mgr="${esc(n)}">${esc(n)}</button>`;
    }).join('')}</div>`;
  }

  function chipWrapFor(input) {
    if (!input) return null;
    const parent = input.parentElement;
    if (parent) {
      for (let i = 0; i < parent.children.length; i += 1) {
        const el = parent.children[i];
        if (el.classList && el.classList.contains('manager-chips')) return el;
      }
    }
    const sib = input.nextElementSibling;
    if (sib && sib.classList && sib.classList.contains('manager-chips')) return sib;
    return null;
  }

  function syncChips(inputId, pool, selected, escFn) {
    const input = typeof document === 'undefined' ? null : document.getElementById(inputId);
    if (!input) return;
    const wrap = chipWrapFor(input);
    const html = chipsHtml(pool, selected, escFn);
    if (!html) {
      if (wrap) wrap.remove();
      return;
    }
    if (wrap) wrap.outerHTML = html;
    else input.insertAdjacentHTML('afterend', html);
    return true;
  }

  function paintFields(S) {
    if (!S?.state || typeof document === 'undefined') return;
    const inn = String(S.state.checkInManager || '').trim();
    const out = String(S.state.checkOutManager || '').trim();
    const inEl = document.getElementById('checkInManager');
    if (inEl && document.activeElement !== inEl) inEl.value = inn;
    const outEl = document.getElementById('checkOutManager');
    if (outEl && document.activeElement !== outEl) outEl.value = out;
    const esc = global.EodApi?.escapeHtml;
    syncChips('checkInManager', S.state.managerNamePool, inn, esc);
    syncChips('checkOutManager', S.state.managerNamePool, out, esc);
  }

  function setManagers(S, partial, reason) {
    if (!S?.state || !partial) return;
    const next = {};
    const hasIn = Object.prototype.hasOwnProperty.call(partial, 'checkInManager');
    const hasOut = Object.prototype.hasOwnProperty.call(partial, 'checkOutManager');
    if (hasIn) {
      next.checkInManager = String(partial.checkInManager || '').trim();
      next.checkInDone = !!next.checkInManager;
    }
    if (hasOut) {
      next.checkOutManager = String(partial.checkOutManager || '').trim();
    }
    const curIn = String(S.state.checkInManager || '').trim();
    const curOut = String(S.state.checkOutManager || '').trim();
    if (hasIn && next.checkInManager && !curOut && !hasOut) {
      next.checkOutManager = next.checkInManager;
    }
    if (hasOut && next.checkOutManager && !curIn && !hasIn) {
      next.checkInManager = next.checkOutManager;
      next.checkInDone = true;
    }
    if (!Object.keys(next).length) return;
    if (typeof S.patch === 'function') S.patch(next, reason || 'managers');
    else Object.assign(S.state, next);
    try { S.saveDraft?.(); } catch (_) {}
    try { captureFromSession(S); } catch (_) {}
    try { global.EodCoverNotes?.apply?.(S, reason || 'managers'); } catch (_) {}
    try { paintFields(S); } catch (_) {}
    try { global.EodSend?.refreshGates?.(); } catch (_) {}
  }

  function bindChipField(fieldId, which) {
    if (typeof document === 'undefined') return;
    const host = document.getElementById(fieldId);
    if (!host) return;
    host.addEventListener('click', (ev) => {
      const chip = ev.target.closest && ev.target.closest('.manager-chip');
      if (!chip || !host.contains(chip)) return;
      ev.preventDefault();
      const name = chip.getAttribute('data-mgr') || '';
      const S = global.EodSession;
      if (which === 'out') setManagers(S, { checkOutManager: name }, 'checkout');
      else setManagers(S, { checkInManager: name }, 'checkin');
    });
  }

  const api = {
    forStore,
    lastStore,
    rememberLastStore,
    forgetLastStore,
    remember,
    applyToSession,
    captureFromSession,
    leadNamePool,
    chipsHtml,
    syncChips,
    setManagers,
    paintFields,
    bindChipField,
    keepText,
  };
  if (typeof module === 'object' && module.exports) module.exports = api;
  global.EodVisitMemory = api;
})(typeof window !== 'undefined' ? window : globalThis);
