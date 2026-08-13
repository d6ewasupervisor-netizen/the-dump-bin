/* Store/date/day-confirm + draft accessors — preserves live EOD localStorage contracts. */
(function (global) {
  'use strict';

  const DAY_CONFIRM_KEY = 'kompassDayConfirm';
  const DRAFT_KEY = 'kompassEOD';
  const PROFILE_KEY = 'kompassProfile';
  const SIGNATURE_KEY = 'kompassSignature';

  const listeners = new Set();

  const state = {
    storeNumber: '',
    workDate: '',
    profileName: '',
    profileEmail: '',
    leadName: '',
    leadEmail: '',
    selectedShift: null,
    shifts: [],
    members: [],
    sheet: null,
    sheetLoaded: false,
    emailRecipients: [],
    notes: '',
    checkInManager: '',
    checkOutManager: '',
    signatureDataUrl: '',
    photos: { before: [], after: [], signoff: [], instawork: [] },
    notInStoreSelected: [],
    notInSiSelected: [],
    helpdeskSubmittedReports: [],
    fredmeyerEmailPool: [],
    managerNamePool: [],
    instaworkYes: null,
    kompassTimesheetYes: null,
    materialsReadYes: null,
    visitReady: false,
  };

  function normStoreNumber(s) {
    return String(s || '').replace(/\D/g, '').replace(/^0+(?=\d)/, '');
  }

  function normIsoDate(s) {
    return String(s || '').slice(0, 10);
  }

  function todayLocalIsoDate() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  function getActiveDayConfirm() {
    let stored;
    try { stored = JSON.parse(localStorage.getItem(DAY_CONFIRM_KEY) || 'null'); } catch (_) {}
    if (!stored || !stored.token || !stored.expiresAt) return null;
    if (Date.now() >= stored.expiresAt) return null;
    return stored;
  }

  function getActiveDayConfirmFor(store, date) {
    const stored = getActiveDayConfirm();
    if (!stored) return null;
    if (stored.store !== normStoreNumber(store)) return null;
    if (stored.date !== normIsoDate(date)) return null;
    return stored;
  }

  function persistDayConfirm({ token, store, date, expiresInMs }) {
    const expiresAt = Date.now() + (Number(expiresInMs) || 36 * 60 * 60 * 1000);
    const canonStore = normStoreNumber(store);
    const canonDate = normIsoDate(date);
    localStorage.setItem(DAY_CONFIRM_KEY, JSON.stringify({
      token,
      store: canonStore,
      date: canonDate,
      expiresAt,
    }));
    state.storeNumber = canonStore;
    state.workDate = canonDate;
    emit('dayConfirm');
  }

  function clearDayConfirm() {
    try { localStorage.removeItem(DAY_CONFIRM_KEY); } catch (_) {}
    emit('dayConfirm');
  }

  function isVisitReady() {
    const store = normStoreNumber(state.storeNumber);
    const date = normIsoDate(state.workDate);
    return !!(store && date && getActiveDayConfirmFor(store, date));
  }

  function hasHostedSheet() {
    return !!(state.sheet && Array.isArray(state.sheet.rows));
  }

  function rowHasMark(row) {
    const m = row?.marks || row?.mark;
    if (!m) return false;
    if (Array.isArray(m.active) && m.active.length) return true;
    if (m.type) return true;
    if (m.complete || m.notInStore || m.notInSi) return true;
    return false;
  }

  function sheetSendReady() {
    if (!hasHostedSheet()) return true;
    // Hard heart: every row must have at least one mark, OR user used acknowledge-all.
    if (state.sheet.allAcknowledged) return true;
    const rows = state.sheet.rows || [];
    if (!rows.length) return true;
    return rows.every(rowHasMark);
  }

  function on(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  }

  function emit(reason) {
    state.visitReady = isVisitReady();
    listeners.forEach((fn) => {
      try { fn(state, reason); } catch (e) { console.warn(e); }
    });
  }

  function patch(partial, reason) {
    Object.assign(state, partial || {});
    emit(reason || 'patch');
  }

  function loadProfile() {
    try {
      const p = JSON.parse(localStorage.getItem(PROFILE_KEY) || 'null');
      if (p) {
        state.profileName = p.name || p.profileName || '';
        state.profileEmail = p.email || p.profileEmail || '';
      }
    } catch (_) {}
    try {
      state.signatureDataUrl = localStorage.getItem(SIGNATURE_KEY) || '';
    } catch (_) {}
  }

  function saveProfile() {
    localStorage.setItem(PROFILE_KEY, JSON.stringify({
      name: state.profileName,
      email: state.profileEmail,
    }));
  }

  function saveSignature(dataUrl) {
    state.signatureDataUrl = dataUrl || '';
    if (dataUrl) localStorage.setItem(SIGNATURE_KEY, dataUrl);
    else localStorage.removeItem(SIGNATURE_KEY);
    emit('signature');
  }

  function loadDraft() {
    loadProfile();
    let data;
    try { data = JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null'); } catch (_) {}
    if (!data) {
      const dc = getActiveDayConfirm();
      if (dc) {
        state.storeNumber = dc.store;
        state.workDate = dc.date;
      } else {
        state.workDate = todayLocalIsoDate();
      }
      emit('load');
      return;
    }
    state.storeNumber = normStoreNumber(data.storeNumber || data.store || '');
    state.workDate = normIsoDate(data.workDate || data.date || todayLocalIsoDate());
    state.profileName = data.profileName || state.profileName || '';
    state.profileEmail = data.profileEmail || state.profileEmail || '';
    state.leadName = data.leadName || '';
    state.leadEmail = data.leadEmail || '';
    state.notes = data.notes || '';
    state.checkInManager = data.checkInManager || '';
    state.checkOutManager = data.checkOutManager || '';
    state.emailRecipients = Array.isArray(data.emailRecipients) ? data.emailRecipients.slice() : [];
    state.notInStoreSelected = Array.isArray(data.notInStoreSelected) ? data.notInStoreSelected.slice() : [];
    state.notInSiSelected = Array.isArray(data.notInSiSelected) ? data.notInSiSelected.slice() : [];
    state.instaworkYes = data.instawork ?? data.instaworkYes ?? null;
    state.kompassTimesheetYes = data.kompassTimesheet ?? data.kompassTimesheetYes ?? null;
    state.materialsReadYes = data.materialsRead ?? data.materialsReadYes ?? null;
    if (data.selectedShift) state.selectedShift = data.selectedShift;
    // Prefer day-confirm store/date when present and matching draft keys.
    const dc = getActiveDayConfirm();
    if (dc) {
      state.storeNumber = dc.store;
      state.workDate = dc.date;
    }
    emit('load');
  }

  function saveDraft() {
    const payload = {
      storeNumber: state.storeNumber,
      workDate: state.workDate,
      profileName: state.profileName,
      profileEmail: state.profileEmail,
      leadName: state.leadName,
      leadEmail: state.leadEmail,
      notes: state.notes,
      checkInManager: state.checkInManager,
      checkOutManager: state.checkOutManager,
      emailRecipients: state.emailRecipients.slice(),
      notInStoreSelected: state.notInStoreSelected.slice(),
      notInSiSelected: state.notInSiSelected.slice(),
      instawork: state.instaworkYes,
      kompassTimesheet: state.kompassTimesheetYes,
      materialsRead: state.materialsReadYes,
      selectedShift: state.selectedShift
        ? {
            visitId: state.selectedShift.visitId,
            storeNumber: state.selectedShift.storeNumber,
            projectName: state.selectedShift.projectName,
            visitLead: state.selectedShift.visitLead,
          }
        : null,
      savedAt: Date.now(),
      app: 'eod-field-app',
    };
    localStorage.setItem(DRAFT_KEY, JSON.stringify(payload));
    saveProfile();
  }

  // Bridge for ported modules that still read DOM / window arrays.
  function syncDomBridges() {
    const storeEl = document.getElementById('storeNumber');
    const dateEl = document.getElementById('workDate');
    const nameEl = document.getElementById('profileName');
    const emailEl = document.getElementById('profileEmail');
    const leadEl = document.getElementById('leadName');
    if (storeEl && storeEl.value !== state.storeNumber) storeEl.value = state.storeNumber;
    if (dateEl && dateEl.value !== state.workDate) dateEl.value = state.workDate;
    if (nameEl && nameEl.value !== state.profileName) nameEl.value = state.profileName;
    if (emailEl && emailEl.value !== state.profileEmail) emailEl.value = state.profileEmail;
    if (leadEl) leadEl.value = state.leadName || state.profileName || '';
    global.emailRecipients = state.emailRecipients;
    global.notInStoreSelected = state.notInStoreSelected;
    global.notInSiSelected = state.notInSiSelected;
    global.helpdeskSubmittedReports = state.helpdeskSubmittedReports;
    global.selectedShift = state.selectedShift;
    global.smSelectedShift = state.selectedShift;
    global.smMembers = state.members;
    global.photos = state.photos;
  }

  global.EodSession = {
    state,
    DAY_CONFIRM_KEY,
    DRAFT_KEY,
    normStoreNumber,
    normIsoDate,
    todayLocalIsoDate,
    getActiveDayConfirm,
    getActiveDayConfirmFor,
    persistDayConfirm,
    clearDayConfirm,
    isVisitReady,
    hasHostedSheet,
    sheetSendReady,
    on,
    emit,
    patch,
    loadDraft,
    saveDraft,
    loadProfile,
    saveProfile,
    saveSignature,
    syncDomBridges,
  };

  // Accessors for ported modules (T0.8 pattern).
  global.getEmailRecipients = () => state.emailRecipients;
  global.setEmailRecipients = (arr) => {
    state.emailRecipients = Array.isArray(arr) ? arr.slice() : [];
    emit('recipients');
  };
  global.getNotInStoreSelected = () => state.notInStoreSelected;
  global.getNotInSiSelected = () => state.notInSiSelected;
  global.getHelpdeskSubmittedReports = () => state.helpdeskSubmittedReports;
  global.setHelpdeskSubmittedReports = (arr) => {
    state.helpdeskSubmittedReports = Array.isArray(arr) ? arr.slice() : [];
    emit('helpdesk');
  };
})(typeof window !== 'undefined' ? window : globalThis);
