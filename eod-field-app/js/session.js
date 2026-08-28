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
    extraVisitIds: [],
    profileLocked: false,
    shifts: [],
    members: [],
    sheet: null,
    sheetLoaded: false,
    emailRecipients: [],
    notes: '',
    checkInManager: '',
    checkOutManager: '',
    fiscalWeek: '',
    visitStep: 'setup', // setup | cart | checkin | befores | done
    cartPhotoDone: false,
    checkInDone: false,
    beforesStepDone: false,
    signatureDataUrl: '',
    photos: { before: [], after: [], signoff: [], instawork: [] },
    notInStoreSelected: [],
    notInSiSelected: [],
    helpdeskSubmittedReports: [],
    fredmeyerEmailPool: [],
    managerNamePool: [],
    sheetAcknowledged: false,
    instaworkYes: null,
    instaworkSavedInfo: null,
    kompassTimesheetYes: null,
    materialsReadYes: null,
    visitReady: false,
    addRetailOdysseyTeam: false,
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

  /**
   * Reset like live EOD — clears draft + day confirm + in-memory visit data.
   * Optional wipePersonal also clears profile/signature.
   * Week-scoped set before photos are kept unless wipeSetBefores is true.
   */
  async function resetVisit({ wipePersonal = false, wipeSetBefores = false } = {}) {
    const store = state.storeNumber;
    const week = state.fiscalWeek;
    try { localStorage.removeItem(DRAFT_KEY); } catch (_) {}
    clearDayConfirm();
    if (wipePersonal) {
      try { localStorage.removeItem(PROFILE_KEY); } catch (_) {}
      try { localStorage.removeItem(SIGNATURE_KEY); } catch (_) {}
      state.profileName = '';
      state.profileEmail = '';
      state.signatureDataUrl = '';
    }
    if (wipeSetBefores && global.EodSetBeforeStore) {
      if (week) global.EodSetBeforeStore.clearStoreWeek(store, week);
      else global.EodSetBeforeStore.clearAllForStore(store);
    }
    if (global.PhotoDB?.clearPhotos) {
      try { await global.PhotoDB.clearPhotos(); } catch (_) {}
    }
    state.storeNumber = '';
    state.workDate = todayLocalIsoDate();
    state.leadName = '';
    state.leadEmail = '';
    state.selectedShift = null;
    state.extraVisitIds = [];
    state.profileLocked = false;
    state.shifts = [];
    state.members = [];
    state.sheet = null;
    state.sheetLoaded = false;
    state.notes = '';
    state.checkInManager = '';
    state.checkOutManager = '';
    state.fiscalWeek = '';
    state.visitStep = 'setup';
    state.cartPhotoDone = false;
    state.checkInDone = false;
    state.beforesStepDone = false;
    state.emailRecipients = [];
    state.notInStoreSelected = [];
    state.notInSiSelected = [];
    state.photos = { before: [], after: [], signoff: [], instawork: [] };
    state.sheetAcknowledged = false;
    state.instaworkYes = null;
    state.instaworkSavedInfo = null;
    state.kompassTimesheetYes = null;
    state.materialsReadYes = null;
    state.addRetailOdysseyTeam = false;
    emit('reset');
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
    if (m.complete || m.notInStore || m.notInSi || m.backlog) return true;
    return false;
  }

  function sheetSendReady() {
    if (!hasHostedSheet()) return true;
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

  function resolvedLeadName() {
    return String(
      state.leadName
      || state.profileName
      || state.selectedShift?.visitLead
      || ''
    ).trim();
  }

  let saveDraftTimer = null;
  function scheduleSaveDraft() {
    if (saveDraftTimer) clearTimeout(saveDraftTimer);
    saveDraftTimer = setTimeout(() => {
      saveDraftTimer = null;
      try { saveDraft(); } catch (_) {}
    }, 250);
  }

  function patch(partial, reason) {
    Object.assign(state, partial || {});
    emit(reason || 'patch');
    scheduleSaveDraft();
  }

  function appendNote(line) {
    const text = String(line || '').trim();
    if (!text) return;
    const cur = state.notes || '';
    if (cur.split(/\n/).some((l) => l.trim() === text)) return;
    state.notes = cur.trim() ? `${cur.trim()}\n${text}` : text;
    emit('notes');
    saveDraft();
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
    state.fiscalWeek = data.fiscalWeek || '';
    state.visitStep = data.visitStep || 'setup';
    state.cartPhotoDone = !!data.cartPhotoDone;
    state.checkInDone = !!data.checkInDone;
    state.beforesStepDone = !!data.beforesStepDone;
    state.emailRecipients = Array.isArray(data.emailRecipients) ? data.emailRecipients.slice() : [];
    state.notInStoreSelected = Array.isArray(data.notInStoreSelected) ? data.notInStoreSelected.slice() : [];
    state.notInSiSelected = Array.isArray(data.notInSiSelected) ? data.notInSiSelected.slice() : [];
    state.helpdeskSubmittedReports = Array.isArray(data.helpdeskSubmittedReports)
      ? data.helpdeskSubmittedReports.slice()
      : [];
    state.sheetAcknowledged = !!data.sheetAcknowledged;
    state.instaworkYes = data.instawork ?? data.instaworkYes ?? null;
    state.instaworkSavedInfo = data.instaworkSavedInfo || null;
    state.kompassTimesheetYes = data.kompassTimesheet ?? data.kompassTimesheetYes ?? null;
    state.materialsReadYes = data.materialsRead ?? data.materialsReadYes ?? null;
    if (data.selectedShift) state.selectedShift = data.selectedShift;
    state.extraVisitIds = Array.isArray(data.extraVisitIds) ? data.extraVisitIds.map(String) : [];
    state.profileLocked = !!data.profileLocked;
    state.addRetailOdysseyTeam = !!data.addRetailOdysseyTeam;
    // Prefer day-confirm store/date when present and matching draft keys.
    const dc = getActiveDayConfirm();
    if (dc) {
      state.storeNumber = dc.store;
      state.workDate = dc.date;
    }
    const today = todayLocalIsoDate();
    if (state.workDate && state.workDate !== today) {
      state.storeNumber = '';
      state.workDate = today;
      state.selectedShift = null;
      state.extraVisitIds = [];
      state.shifts = [];
      state.members = [];
      state.sheet = null;
      state.sheetLoaded = false;
      state.fiscalWeek = '';
      state.visitStep = 'setup';
      state.cartPhotoDone = false;
      state.checkInDone = false;
      state.beforesStepDone = false;
      state.checkInManager = '';
      state.checkOutManager = '';
      state.photos = { before: [], after: [], signoff: [], instawork: [] };
      state.instaworkSavedInfo = null;
      clearDayConfirm();
      try { saveDraft(); } catch (_) {}
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
      fiscalWeek: state.fiscalWeek || '',
      visitStep: state.visitStep || 'setup',
      cartPhotoDone: !!state.cartPhotoDone,
      checkInDone: !!state.checkInDone,
      beforesStepDone: !!state.beforesStepDone,
      emailRecipients: state.emailRecipients.slice(),
      notInStoreSelected: state.notInStoreSelected.slice(),
      notInSiSelected: state.notInSiSelected.slice(),
      helpdeskSubmittedReports: (state.helpdeskSubmittedReports || []).slice(),
      sheetAcknowledged: !!state.sheetAcknowledged,
      instawork: state.instaworkYes,
      instaworkSavedInfo: state.instaworkSavedInfo || null,
      kompassTimesheet: state.kompassTimesheetYes,
      materialsRead: state.materialsReadYes,
      extraVisitIds: (state.extraVisitIds || []).slice(),
      profileLocked: !!state.profileLocked,
      addRetailOdysseyTeam: !!state.addRetailOdysseyTeam,
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
    try { global.EodVisitMemory?.captureFromSession?.({ state, resolvedLeadName }); } catch (_) {}
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
    resetVisit,
    isVisitReady,
    hasHostedSheet,
    sheetSendReady,
    on,
    emit,
    patch,
    resolvedLeadName,
    appendNote,
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
