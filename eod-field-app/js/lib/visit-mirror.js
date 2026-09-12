/* Persist / hydrate a store+date visit snapshot so a second login matches the lead. */
(function (global) {
  'use strict';

  const API = 'https://eod-api.the-dump-bin.com/api/digital-signoffs/visit-mirror';
  let persistTimer = null;
  let applying = false;
  let lastKey = '';
  let lastPutAt = 0;

  function session() {
    return global.EodSession;
  }

  function headers() {
    return global.EodApi?.dayConfirmHeaders?.({ 'Content-Type': 'application/json' })
      || { 'Content-Type': 'application/json' };
  }

  function snapshotFromSession(S) {
    const state = S?.state || {};
    return {
      storeNumber: state.storeNumber,
      workDate: state.workDate,
      visitId: state.selectedShift?.visitId || null,
      leadName: S.resolvedLeadName?.() || state.leadName || '',
      leadEmail: state.leadEmail || '',
      payload: {
        leadName: state.leadName || '',
        leadEmail: state.leadEmail || '',
        notes: state.notes || '',
        checkInManager: state.checkInManager || '',
        checkOutManager: state.checkOutManager || '',
        visitStep: state.visitStep || 'setup',
        cartPhotoDone: !!state.cartPhotoDone,
        checkInDone: !!state.checkInDone,
        beforesStepDone: !!state.beforesStepDone,
        sheetAcknowledged: !!state.sheetAcknowledged,
        instaworkYes: state.instaworkYes,
        instaworkSavedInfo: state.instaworkSavedInfo || null,
        kompassTimesheetYes: state.kompassTimesheetYes,
        materialsReadYes: state.materialsReadYes,
        notInStoreSelected: Array.isArray(state.notInStoreSelected) ? state.notInStoreSelected.slice() : [],
        notInSiSelected: Array.isArray(state.notInSiSelected) ? state.notInSiSelected.slice() : [],
        extraVisitIds: Array.isArray(state.extraVisitIds) ? state.extraVisitIds.map(String) : [],
        managerNamePool: Array.isArray(state.managerNamePool) ? state.managerNamePool.slice() : [],
        fredmeyerEmailPool: Array.isArray(state.fredmeyerEmailPool) ? state.fredmeyerEmailPool.slice() : [],
        helpdeskSubmittedReports: Array.isArray(state.helpdeskSubmittedReports)
          ? state.helpdeskSubmittedReports.slice()
          : [],
        addRetailOdysseyTeam: !!state.addRetailOdysseyTeam,
        selectedShift: state.selectedShift
          ? {
              visitId: state.selectedShift.visitId,
              storeNumber: state.selectedShift.storeNumber,
              projectName: state.selectedShift.projectName,
              visitLead: state.selectedShift.visitLead,
              visitLeadEmail: state.selectedShift.visitLeadEmail,
            }
          : null,
        signatureDataUrl: state.signatureDataUrl || '',
      },
    };
  }

  function hasWork(payload) {
    if (!payload) return false;
    return !!(
      payload.checkInManager
      || payload.checkOutManager
      || payload.signatureDataUrl
      || payload.cartPhotoDone
      || payload.checkInDone
      || payload.beforesStepDone
      || payload.notes
      || payload.sheetAcknowledged
      || payload.instaworkYes != null
      || payload.kompassTimesheetYes != null
      || payload.materialsReadYes != null
      || (payload.notInStoreSelected && payload.notInStoreSelected.length)
      || (payload.notInSiSelected && payload.notInSiSelected.length)
      || (payload.visitStep && payload.visitStep !== 'setup')
      || payload.selectedShift?.visitId
      || (payload.managerNamePool && payload.managerNamePool.length)
      || payload.addRetailOdysseyTeam
    );
  }

  function applyPayload(S, mirror) {
    if (!S || !mirror?.payload) return false;
    const p = mirror.payload;
    applying = true;
    try {
      const patch = {
        leadName: p.leadName || S.state.leadName || '',
        leadEmail: p.leadEmail || S.state.leadEmail || '',
        notes: p.notes || S.state.notes || '',
        checkInManager: p.checkInManager || S.state.checkInManager || '',
        checkOutManager: p.checkOutManager || S.state.checkOutManager || '',
        visitStep: p.visitStep || S.state.visitStep || 'setup',
        cartPhotoDone: !!(S.state.cartPhotoDone || p.cartPhotoDone),
        checkInDone: !!(S.state.checkInDone || p.checkInDone),
        beforesStepDone: !!(S.state.beforesStepDone || p.beforesStepDone),
        sheetAcknowledged: !!(S.state.sheetAcknowledged || p.sheetAcknowledged),
      };
      if (p.instaworkYes != null) patch.instaworkYes = p.instaworkYes;
      if (p.instaworkSavedInfo) patch.instaworkSavedInfo = p.instaworkSavedInfo;
      if (p.kompassTimesheetYes != null) patch.kompassTimesheetYes = p.kompassTimesheetYes;
      if (p.materialsReadYes != null) patch.materialsReadYes = p.materialsReadYes;
      if (Array.isArray(p.notInStoreSelected) && p.notInStoreSelected.length) {
        patch.notInStoreSelected = p.notInStoreSelected.slice();
      }
      if (Array.isArray(p.notInSiSelected) && p.notInSiSelected.length) {
        patch.notInSiSelected = p.notInSiSelected.slice();
      }
      if (Array.isArray(p.extraVisitIds) && p.extraVisitIds.length && !(S.state.extraVisitIds || []).length) {
        patch.extraVisitIds = p.extraVisitIds.map(String);
      }
      if (Array.isArray(p.managerNamePool) && p.managerNamePool.length) {
        patch.managerNamePool = p.managerNamePool.slice();
      }
      if (Array.isArray(p.fredmeyerEmailPool) && p.fredmeyerEmailPool.length) {
        patch.fredmeyerEmailPool = p.fredmeyerEmailPool.slice();
      }
      if (Array.isArray(p.helpdeskSubmittedReports) && p.helpdeskSubmittedReports.length) {
        patch.helpdeskSubmittedReports = p.helpdeskSubmittedReports.slice();
      }
      if (p.addRetailOdysseyTeam) patch.addRetailOdysseyTeam = true;
      S.patch(patch, 'visit-mirror');
      if (p.signatureDataUrl && !S.state.signatureDataUrl) {
        S.state.signatureDataUrl = p.signatureDataUrl;
        S.emit?.('signature');
      } else if (p.signatureDataUrl && S.state.signatureDataUrl !== p.signatureDataUrl) {
        S.state.signatureDataUrl = p.signatureDataUrl;
        S.emit?.('signature');
      }
    } finally {
      applying = false;
    }
    return true;
  }

  function selectMirroredShift(S, mirror) {
    const visitId = String(mirror?.visitId || mirror?.payload?.selectedShift?.visitId || '');
    if (!visitId || !S) return;
    const shifts = S.state.shifts || [];
    const found = shifts.find((s) => String(s.visitId) === visitId);
    if (!found) return;
    if (String(S.state.selectedShift?.visitId || '') === visitId) return;
    applying = true;
    try {
      S.patch({ selectedShift: found }, 'visit-mirror-shift');
    } finally {
      applying = false;
    }
  }

  async function fetchMirror(store, date) {
    if (!store || !date || !global.authFetch) return null;
    const qs = new URLSearchParams({ store, date });
    const resp = await global.authFetch(`${API}?${qs}`, {
      skipBusy: true,
      noBounceOn401: true,
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok || !data.mirror) return null;
    return data.mirror;
  }

  async function hydrate(S) {
    const store = S?.state?.storeNumber;
    const date = S?.state?.workDate;
    if (!store || !date) return null;
    const key = `${store}|${date}`;
    try {
      const mirror = await fetchMirror(store, date);
      if (!mirror?.payload) return null;
      applyPayload(S, mirror);
      selectMirroredShift(S, mirror);
      lastKey = key;
      return mirror;
    } catch (err) {
      console.warn('[visit-mirror] hydrate', err.message || err);
      return null;
    }
  }

  async function persistNow(S) {
    if (applying || !S?.state?.storeNumber || !S.state.workDate || !global.authFetch) return;
    const body = snapshotFromSession(S);
    if (!hasWork(body.payload)) return;
    const key = `${body.storeNumber}|${body.workDate}`;
    lastKey = key;
    lastPutAt = Date.now();
    try {
      await global.authFetch(API, {
        method: 'PUT',
        headers: headers(),
        body: JSON.stringify(body),
        skipBusy: true,
        noBounceOn401: true,
      });
    } catch (err) {
      console.warn('[visit-mirror] persist', err.message || err);
    }
  }

  function schedulePersist(S) {
    if (applying) return;
    if (persistTimer) clearTimeout(persistTimer);
    persistTimer = setTimeout(() => {
      persistTimer = null;
      persistNow(S || session()).catch(() => {});
    }, 800);
  }

  function init() {
    if (init._bound) return;
    init._bound = true;
    const S = session();
    if (!S?.on) return;
    S.on((_state, reason) => {
      if (applying) return;
      if (reason === 'load' || reason === 'visit-mirror' || reason === 'visit-mirror-shift') return;
      if (!S.state?.storeNumber || !S.state.workDate) return;
      schedulePersist(S);
    });
  }

  global.EodVisitMirror = {
    init,
    hydrate,
    persist: schedulePersist,
    persistNow,
    applyPayload,
    selectMirroredShift,
    snapshotFromSession,
    hasWork,
  };
})(typeof window !== 'undefined' ? window : globalThis);
