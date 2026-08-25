/* Pure helpers for EOD send-sheet images. Node-testable. */
(function (global) {
  'use strict';

  function padStore(n) {
    return String(n || '').replace(/\D/g, '').padStart(3, '0');
  }

  function dateCompact(iso) {
    return String(iso || '').replace(/-/g, '').slice(0, 8);
  }

  function isMainKompassIse(shift) {
    if (!shift) return false;
    if (Number(shift.projectId) === 1) return true;
    const type = String(shift.kompassType || '').trim().toLowerCase();
    if (type === 'kompass ise') return true;
    const name = String(shift.projectName || '').toLowerCase();
    if (/cut\s*in/.test(name) || /blitz/.test(name) || /\bdiv\b/.test(name)) return false;
    return /kompass\s*ise/.test(name);
  }

  /**
   * Prefer the selected shift when it is Kompass ISE (project 1).
   * Otherwise pick the store-day sibling that is the main ISE visit.
   */
  function pickMainKompassIseVisit(shifts, selectedShift) {
    if (isMainKompassIse(selectedShift)) return selectedShift;
    const list = Array.isArray(shifts) ? shifts : [];
    return list.find(isMainKompassIse) || null;
  }

  function classifySheetFilename(filename) {
    const name = String(filename || '').toLowerCase();
    if (name.includes('coversheet')) return 'coversheet';
    if (name.includes('digital_signoff') || name.includes('digital-signoff')) return 'digital';
    return 'photo';
  }

  function coversheetFilename(storeNumber, workDate) {
    return `fm${padStore(storeNumber)}_eod_coversheet_${dateCompact(workDate)}.jpg`;
  }

  function digitalSignoffFilename(storeNumber, workDate, pageIndex) {
    return `fm${padStore(storeNumber)}_digital_signoff_p${pageIndex}_${dateCompact(workDate)}.jpg`;
  }

  const api = {
    padStore,
    dateCompact,
    isMainKompassIse,
    pickMainKompassIseVisit,
    classifySheetFilename,
    coversheetFilename,
    digitalSignoffFilename,
  };
  if (typeof module === 'object' && module.exports) module.exports = api;
  global.EodSendSheetsLogic = api;
})(typeof window !== 'undefined' ? window : globalThis);
