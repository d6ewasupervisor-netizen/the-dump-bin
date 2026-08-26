/* Roles from GET /api/me — roster, force-live, District 8 helpdesk. */
(function (global) {
  'use strict';

  const D8_STORES = new Set(['19', '23', '28', '31', '53', '215', '391', '459', '658', '682']);

  let me = null;
  let loadPromise = null;

  function roles() {
    const list = me && Array.isArray(me.roles) ? me.roles : [];
    return list.map((r) => String(r || '').toLowerCase());
  }

  function hasRole() {
    const want = Array.from(arguments).map((r) => String(r || '').toLowerCase());
    const have = roles();
    return want.some((r) => have.includes(r));
  }

  function canManageRoster() {
    return hasRole('lead', 'supervisor', 'admin');
  }

  function canForceLive() {
    return hasRole('admin', 'supervisor');
  }

  function isDistrict8Store(storeNumber) {
    const n = String(storeNumber || '').replace(/\D/g, '').replace(/^0+(?=\d)/, '');
    return n !== 'NaN' && D8_STORES.has(n);
  }

  function omitAiyanaForNonDistrict8(emails, store, keepEmail) {
    const list = Array.isArray(emails) ? emails.slice() : [];
    if (isDistrict8Store(store)) return list;
    const keep = String(keepEmail || '').trim().toLowerCase();
    return list.filter((e) => {
      const v = String(e || '').trim().toLowerCase();
      if (keep && v === keep) return true;
      return !v.includes('aiyana');
    });
  }

  function applyRoleClasses() {
    const body = document.body;
    if (!body) return;
    [...body.classList].forEach((c) => {
      if (c.startsWith('role-')) body.classList.remove(c);
    });
    roles().forEach((r) => body.classList.add(`role-${r}`));
  }

  async function load(force) {
    if (me && !force) return me;
    if (loadPromise && !force) return loadPromise;
    loadPromise = (async () => {
      try {
        const resp = await global.authFetch(`${global.EOD_API_BASE}/api/me`, { noBounceOn401: true });
        const data = await resp.json().catch(() => ({}));
        if (resp.ok && data) me = data;
        else me = { roles: [] };
      } catch (_) {
        me = { roles: [] };
      }
      applyRoleClasses();
      return me;
    })();
    return loadPromise;
  }

  function getMe() { return me; }

  global.EodRoles = {
    load,
    getMe,
    roles,
    hasRole,
    canManageRoster,
    canForceLive,
    isDistrict8Store,
    omitAiyanaForNonDistrict8,
    D8_STORES,
  };
  global.isDistrict8Store = isDistrict8Store;
  global.omitAiyanaForNonDistrict8 = omitAiyanaForNonDistrict8;
})(typeof window !== 'undefined' ? window : globalThis);
