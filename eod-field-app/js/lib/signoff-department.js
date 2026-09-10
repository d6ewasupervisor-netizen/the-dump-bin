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
    home_manager: [/home|general merch|\bgm\b/i],
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

  function rolesForSignoffRow(row) {
    const code = extractPogDeptCode(row?.pog);
    let roles;
    if (code) {
      roles = [...(DEPT_CODE_TO_ROLES[code] || ['grocery'])];
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
    rolesForSignoffRow,
    rowMatchesSignoffRole,
  };
  if (typeof module === 'object' && module.exports) module.exports = api;
  global.EodSignoffDepartment = api;
})(typeof window !== 'undefined' ? window : globalThis);
