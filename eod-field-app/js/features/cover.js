/* Cover removed — store-data pool load + save for Visit/Send manager emails. */
(function (global) {
  'use strict';

  let loadSeq = 0;

  function headers() {
    return global.EodApi.dayConfirmHeaders({ 'Content-Type': 'application/json' });
  }

  async function loadStoreData(store) {
    const S = global.EodSession;
    const requested = S.normStoreNumber(store);
    if (!requested) return;
    const seq = ++loadSeq;
    const resp = await global.authFetch(`${global.EOD_API_BASE}/store-data/${encodeURIComponent(requested)}`);
    if (seq !== loadSeq) return;
    if (S.normStoreNumber(S.state.storeNumber) !== requested) return;
    if (!resp.ok) return;
    const data = await resp.json();
    if (seq !== loadSeq) return;
    if (data.success) {
      S.patch({
        fredmeyerEmailPool: Array.isArray(data.fredmeyerEmails) ? data.fredmeyerEmails : [],
        managerNamePool: Array.isArray(data.managerNames) ? data.managerNames : [],
      }, 'store-data');
    }
  }

  async function savePool(partial) {
    const S = global.EodSession;
    const store = S.normStoreNumber(S.state.storeNumber);
    if (!store) throw new Error('Confirm store first');
    const managerNames = partial.managerNames || S.state.managerNamePool || [];
    const fredmeyerEmails = partial.fredmeyerEmails || S.state.fredmeyerEmailPool || [];
    const recipientEmails = partial.recipientEmails || S.state.emailRecipients || [];
    const resp = await global.authFetch(`${global.EOD_API_BASE}/store-data/${encodeURIComponent(store)}`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({
        storeNumber: store,
        managerNames,
        fredmeyerEmails,
        recipientEmails,
      }),
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok || data.success === false) throw new Error(data.error || `Save failed (${resp.status})`);
    S.patch({
      managerNamePool: Array.isArray(data.managerNames) ? data.managerNames : managerNames,
      fredmeyerEmailPool: Array.isArray(data.fredmeyerEmails) ? data.fredmeyerEmails : fredmeyerEmails,
    }, 'store-data-save');
    S.saveDraft();
    return data;
  }

  async function addManagerName(name) {
    const S = global.EodSession;
    const n = String(name || '').trim();
    if (!n) return;
    const pool = (S.state.managerNamePool || []).slice();
    if (!pool.some((x) => x.toLowerCase() === n.toLowerCase())) pool.push(n);
    return savePool({ managerNames: pool });
  }

  async function addFredmeyerEmail(email) {
    const S = global.EodSession;
    const e = String(email || '').trim().toLowerCase();
    if (!e || !e.includes('@')) return;
    const pool = (S.state.fredmeyerEmailPool || []).slice();
    if (!pool.includes(e)) pool.push(e);
    return savePool({ fredmeyerEmails: pool });
  }

  async function removeManagerName(name) {
    const S = global.EodSession;
    const store = S.normStoreNumber(S.state.storeNumber);
    if (!store) throw new Error('Confirm store first');
    const resp = await global.authFetch(
      `${global.EOD_API_BASE}/store-data/${encodeURIComponent(store)}/manager-name`,
      {
        method: 'DELETE',
        headers: headers(),
        body: JSON.stringify({ name, storeNumber: store }),
      }
    );
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(data.error || `Remove failed (${resp.status})`);
    await loadStoreData(store);
    return data;
  }

  async function render() {
    global.EodRouter.go('visit', { replace: true });
  }

  global.EodCover = {
    loadStoreData,
    savePool,
    addManagerName,
    addFredmeyerEmail,
    removeManagerName,
  };
  global.EodRouter.register('cover', render);
})(typeof window !== 'undefined' ? window : globalThis);
