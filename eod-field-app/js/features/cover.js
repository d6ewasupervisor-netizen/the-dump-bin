/* Cover removed — loadStoreData kept for Visit/Send manager pools. Cover route redirects. */
(function (global) {
  'use strict';

  let loadSeq = 0;

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

  async function render() {
    global.EodRouter.go('visit', { replace: true });
  }

  global.EodCover = { loadStoreData };
  global.EodRouter.register('cover', render);
})(typeof window !== 'undefined' ? window : globalThis);
