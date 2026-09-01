/* Test-mode helpers — keep-current vs clone, payload routing. Node-testable. */
(function (global) {
  'use strict';

  const DEFAULT_TEST_STORE = '999';
  const DEFAULT_TEST_RECIPIENT = 'tyson.gauthier@retailodyssey.com';

  function canonStore(store) {
    const digits = String(store == null ? '' : store).replace(/\D/g, '').replace(/^0+/, '');
    return digits || '';
  }

  function hasLoadedShift(state, testStore) {
    const sandbox = String(testStore || DEFAULT_TEST_STORE);
    const store = canonStore(state && state.storeNumber);
    if (!store || store === sandbox) return false;
    if (state.selectedShift && (state.selectedShift.visitId || state.selectedShift.id)) return true;
    if (Array.isArray(state.sheet && state.sheet.rows) && state.sheet.rows.length) return true;
    return false;
  }

  function isStoreMailbox(email) {
    return String(email || '').trim().toLowerCase().endsWith('@stores.fredmeyer.com');
  }

  function uniqueEmails(list) {
    const seen = new Set();
    const out = [];
    const raw = Array.isArray(list) ? list : list == null ? [] : [list];
    for (const item of raw) {
      const email = String(item || '').trim().toLowerCase();
      if (!email || seen.has(email)) continue;
      seen.add(email);
      out.push(email);
    }
    return out;
  }

  function applyToPayload(payload, opts) {
    const o = opts || {};
    const testMode = !!o.testMode;
    const forceLive = !!o.forceLive;
    const testStore = String(o.testStore || DEFAULT_TEST_STORE);
    const testRecipient = o.testRecipient || DEFAULT_TEST_RECIPIENT;
    const store = canonStore(payload && payload.storeNumber);
    const isTest = testMode || store === testStore;
    if (!isTest) return payload;
    if (forceLive) {
      return {
        ...payload,
        forceLive: true,
        testMode: true,
        storeNumber: (payload && payload.storeNumber) || testStore,
      };
    }
    const subject = payload && payload.subject;
    const extras = uniqueEmails(payload && payload.recipients).filter((email) => !isStoreMailbox(email));
    return {
      ...payload,
      testMode: true,
      forceLive: false,
      storeNumber: (payload && payload.storeNumber) || testStore,
      recipients: uniqueEmails([testRecipient, ...extras]),
      subject: subject && !/^\[TEST\]/i.test(subject) ? `[TEST] ${subject}` : subject,
    };
  }

  const api = {
    DEFAULT_TEST_STORE,
    DEFAULT_TEST_RECIPIENT,
    canonStore,
    hasLoadedShift,
    applyToPayload,
    isStoreMailbox,
    uniqueEmails,
  };
  if (typeof module === 'object' && module.exports) module.exports = api;
  global.EodTestModeLogic = api;
})(typeof window !== 'undefined' ? window : globalThis);
