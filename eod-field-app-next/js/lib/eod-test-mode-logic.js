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

  /* Versions are major.minor.patch with a two-digit patch, and legacy patches
     ran past 99 (3.3.100 is 3.4.00), so weigh the parts rather than compare
     them one by one. Returns null when the text is not a version. */
  function versionWeight(v) {
    const m = /^\s*v?(\d+)\.(\d+)\.(\d+)\s*$/.exec(String(v == null ? '' : v));
    if (!m) return null;
    return Number(m[1]) * 10000 + Number(m[2]) * 100 + Number(m[3]);
  }

  /* True when remote should replace local. Text that is not a version keeps
     the old rule (any difference updates) so a forced reload still works. */
  function isNewerVersion(remote, local) {
    const r = versionWeight(remote);
    const l = versionWeight(local);
    if (r == null || l == null) return String(remote || '') !== String(local || '');
    return r > l;
  }

  /* The lead fields test mode overwrites. Null when the phone already holds
     the test identity, so a second pass can never save it as the real one. */
  function identitySnapshot(state, testEmail) {
    const st = state || {};
    const email = String(st.profileEmail || '').trim().toLowerCase();
    if (email && email === String(testEmail || '').trim().toLowerCase()) return null;
    return {
      profileName: String(st.profileName || ''),
      profileEmail: String(st.profileEmail || ''),
      leadName: String(st.leadName || ''),
      leadEmail: String(st.leadEmail || ''),
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
    versionWeight,
    isNewerVersion,
    identitySnapshot,
  };
  if (typeof module === 'object' && module.exports) module.exports = api;
  global.EodTestModeLogic = api;
})(typeof window !== 'undefined' ? window : globalThis);
