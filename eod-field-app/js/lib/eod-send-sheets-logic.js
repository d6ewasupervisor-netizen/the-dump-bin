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
    if (name.includes('cart_before') || name.includes('cart-before')) return 'cart-before';
    if (name.includes('cart_after') || name.includes('cart-after')) return 'cart-after';
    return 'photo';
  }

  function formatDeptSignatureLines(collected) {
    const list = Array.isArray(collected) ? collected : [];
    const lines = [];
    const seen = new Set();
    for (const item of list) {
      if (!item) continue;
      const name = String(item.signerName || item.name || item.label || '').trim();
      if (!name || /^none/i.test(name)) continue;
      const role = String(item.roleLabel || item.role || item.roleKey || '').trim();
      const line = role ? `• ${name} (${role})` : `• ${name}`;
      const key = line.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      lines.push(line);
    }
    return lines;
  }

  function signedOutFromSheet(S) {
    if (!S?.hasHostedSheet?.() && !S?.state?.sheet) return { prod: '—', si: '—' };
    if (typeof S.sheetSendReady === 'function' && S.sheetSendReady()) {
      return { prod: 'Yes', si: 'Yes' };
    }
    const rows = S?.state?.sheet?.rows || [];
    if (!rows.length) return { prod: '—', si: '—' };
    const Status = (typeof globalThis !== 'undefined' && globalThis.EodCategoryCardStatus)
      || (typeof global !== 'undefined' && global.EodCategoryCardStatus)
      || null;
    const prodOk = rows.every((row) => {
      if (Status?.prodDone?.(row) || Status?.sheetRowDone?.(row)) return true;
      const live = row?.live || {};
      return !!(live.prodComplete || live.bothComplete);
    });
    const siOk = rows.every((row) => {
      if (Status?.siDone?.(row) || Status?.sheetRowDone?.(row)) return true;
      const live = row?.live || {};
      return !!(live.siComplete || live.bothComplete);
    });
    return { prod: prodOk ? 'Yes' : 'No', si: siOk ? 'Yes' : 'No' };
  }

  function hasDigitalSignoff(report, sheet) {
    if (sheet && Array.isArray(sheet.rows) && sheet.rows.length) return true;
    const digital = String(report?.digitalSignoff || '').trim();
    if (!digital) return false;
    return !/^none/i.test(digital);
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
    formatDeptSignatureLines,
    signedOutFromSheet,
    hasDigitalSignoff,
  };
  if (typeof module === 'object' && module.exports) module.exports = api;
  global.EodSendSheetsLogic = api;
})(typeof window !== 'undefined' ? window : globalThis);
