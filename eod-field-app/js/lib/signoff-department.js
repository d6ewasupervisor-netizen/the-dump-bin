(function (global) {
  'use strict';

  const ROLE_ORDER = ['grocery', 'fuel_center', 'deli', 'bakery', 'meat', 'produce', 'home_manager'];

  const DEPT_CODE_TO_ROLES = Object.freeze({
    '01': ['grocery'],
    '03': ['grocery'],
    '06': ['grocery'],
    '07': ['produce'],
    '09': ['meat'],
    '10': ['deli'],
    '15': ['deli'],
    '17': ['grocery'],
    '19': ['produce'],
    '40': ['bakery'],
    '58': ['fuel_center'],
    '69': ['meat'],
    '71': ['meat'],
    '73': ['deli'],
    '87': ['home_manager'],
  });

  const FALLBACK_ROLE_PATTERNS = {
    fuel_center: [/fuel/i],
    deli: [/deli/i],
    bakery: [/bakery/i],
    meat: [/meat/i],
    produce: [/produce/i],
    home_manager: [/home.?side|home|general merch|\bgm\b/i],
    grocery: [/grocery|checklane/i],
  };

  function extractPogDeptCode(pog) {
    const normalized = String(pog || '').trim().replace(/[\\/]/g, '_');
    if (!normalized) return null;
    for (const part of normalized.split(/[^A-Za-z0-9]+/)) {
      const match = /^D(\d{2})$/i.exec(part);
      if (match) return match[1];
    }
    return null;
  }

  function rowCatId(row) {
    const parsed = Number(row?.catId ?? row?.cat_id);
    return Number.isFinite(parsed) ? parsed : null;
  }

  function rowCategoryName(row) {
    return String(row?.catName || row?.cat_name || '');
  }

  function isHomeSideLightbulbs(row) {
    return /light\s*bulbs?|\blt\s*bulbs\b/i.test(rowCategoryName(row));
  }

  function isMoneyServicesRow(row) {
    return /money\s*services?|money\s*center|money\s*orders?/i.test(rowCategoryName(row));
  }

  /** Tracker Dept GM is the home side. D03 alone is HBC and stays grocery. */
  function displayDeptIsHomeSide(row) {
    const dept = String(row?.dept || '').trim();
    return /^(gm|home(\s*side)?|general\s*merch(andise)?)$/i.test(dept);
  }

  function pacificDay(value) {
    if (value == null || value === '') return '';
    const s = String(value).trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    const d = new Date(s);
    if (Number.isNaN(d.getTime())) return '';
    try {
      return new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/Los_Angeles',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(d);
    } catch (_) {
      return '';
    }
  }

  function idStr(value) {
    if (value == null || value === '') return '';
    return String(value);
  }

  function completeDetail(row) {
    const m = row && row.marks;
    const detail = m && m.details && m.details.complete;
    return detail || {};
  }

  function completeActive(row) {
    const m = row && row.marks;
    if (!m) return false;
    if (m.complete) return true;
    return Array.isArray(m.active) && m.active.includes('complete');
  }

  function clearanceIsThisVisit(row, shift) {
    const workDate = shift && shift.workDate ? String(shift.workDate).slice(0, 10) : '';
    const visitId = idStr(shift && shift.visitId);
    const detail = completeDetail(row);
    const markVisit = idStr(detail.visitId);
    const markDay = pacificDay(detail.markedAt);
    const prodVisit = idStr(row && row.live && row.live.prodVisitId);
    if (visitId && markVisit && markVisit === visitId) return true;
    if (visitId && !markVisit && prodVisit && prodVisit === visitId) {
      if (!markDay || !workDate || markDay === workDate) return true;
    }
    if (!markVisit && workDate && markDay === workDate) {
      if (!visitId || !prodVisit || prodVisit === visitId) return true;
    }
    return false;
  }

  /** Earlier day. A complete from today still needs a signature, including Blitz and Cut In. */
  function signedOutBeforeThisVisit(row, shift) {
    const workDate = shift && shift.workDate ? String(shift.workDate).slice(0, 10) : '';
    const visitId = idStr(shift && shift.visitId);
    if (!workDate && !visitId) return false;
    if (!completeActive(row)) return false;
    if (clearanceIsThisVisit(row, shift)) return false;
    const detail = completeDetail(row);
    const markVisit = idStr(detail.visitId);
    const markDay = pacificDay(detail.markedAt);
    const prodVisit = idStr(row && row.live && row.live.prodVisitId);
    if (workDate && markDay && markDay === workDate) return false;
    if (visitId && markVisit && markVisit !== visitId) return true;
    if (workDate && markDay && markDay < workDate) return true;
    if (visitId && prodVisit && prodVisit !== visitId) return true;
    return false;
  }

  function rowInSignatureScope(row) {
    if (!row) return false;
    if (row.outOfScope || row.out_of_scope || row.marks?.outOfScope) return false;
    const active = row.marks && row.marks.active;
    if (Array.isArray(active) && active.includes('out_of_scope')) return false;
    return true;
  }

  function signatureRolesForRows(rows, shift) {
    const found = new Set();
    for (const row of rows || []) {
      if (!rowInSignatureScope(row)) continue;
      if (signedOutBeforeThisVisit(row, shift)) continue;
      for (const key of rolesForSignoffRow(row)) found.add(key);
    }
    return ROLE_ORDER.filter((key) => found.has(key));
  }

  function rolesForSignoffRow(row) {
    if (isHomeSideLightbulbs(row)) return ['home_manager'];
    if (isMoneyServicesRow(row)) return ['grocery'];
    const code = extractPogDeptCode(row?.pog);
    let roles;
    if (code) {
      roles = [...(DEPT_CODE_TO_ROLES[code] || ['grocery'])];
      if (code === '03' && displayDeptIsHomeSide(row)) roles = ['home_manager'];
    } else {
      const text = [
        row?.dept,
        row?.catName,
        row?.cat_name,
        row?.shiftType,
        row?.shift_type,
      ].filter(Boolean).join(' ');
      roles = ROLE_ORDER.filter((key) =>
        FALLBACK_ROLE_PATTERNS[key]?.some((pattern) => pattern.test(text))
      );
      if (!roles.length) roles = ['grocery'];
    }

    if (rowCatId(row) === 400 && !roles.includes('bakery')) roles.push('bakery');
    return ROLE_ORDER.filter((key) => roles.includes(key));
  }

  function rowMatchesSignoffRole(row, roleKey) {
    return rolesForSignoffRow(row).includes(String(roleKey || '').trim().toLowerCase());
  }

  const api = {
    ROLE_ORDER,
    DEPT_CODE_TO_ROLES,
    extractPogDeptCode,
    isHomeSideLightbulbs,
    isMoneyServicesRow,
    displayDeptIsHomeSide,
    signedOutBeforeThisVisit,
    signatureRolesForRows,
    rolesForSignoffRow,
    rowMatchesSignoffRole,
  };
  if (typeof module === 'object' && module.exports) module.exports = api;
  global.EodSignoffDepartment = api;
})(typeof window !== 'undefined' ? window : globalThis);
