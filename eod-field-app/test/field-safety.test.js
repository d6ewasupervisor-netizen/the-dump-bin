'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const testMode = require('../js/lib/eod-test-mode-logic');
const sasLogic = require('../js/lib/sas-user-login-logic');

function loadBrowserScript(rel, extraGlobals) {
  const sandbox = Object.assign({ console }, extraGlobals || {});
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', rel), 'utf8'), sandbox, { filename: rel });
  return sandbox;
}

test('an older or equal server version never triggers an update', () => {
  assert.equal(testMode.isNewerVersion('3.5.14', '3.5.13'), true);
  assert.equal(testMode.isNewerVersion('3.5.13', '3.5.13'), false);
  assert.equal(testMode.isNewerVersion('3.4.100', '3.5.13'), false);
  assert.equal(testMode.isNewerVersion('3.5.12', '3.5.13'), false);
  assert.equal(testMode.isNewerVersion('4.0.00', '3.9.99'), true);
});

test('legacy patch values past 99 weigh the same as their rolled form', () => {
  assert.equal(testMode.versionWeight('3.3.100'), testMode.versionWeight('3.4.00'));
  assert.equal(testMode.isNewerVersion('3.4.00', '3.3.100'), false);
  assert.equal(testMode.versionWeight('not-a-version'), null);
});

test('text that is not a version still updates when it differs', () => {
  assert.equal(testMode.isNewerVersion('force-123', '3.5.13'), true);
  assert.equal(testMode.isNewerVersion('', ''), false);
});

test('test mode saves the real lead and refuses to save the test lead as real', () => {
  const real = {
    profileName: 'Pat Lead',
    profileEmail: 'pat@example.com',
    leadName: 'Pat Lead',
    leadEmail: 'pat@example.com',
    storeNumber: '19',
  };
  assert.deepEqual(testMode.identitySnapshot(real, 'tester@example.com'), {
    profileName: 'Pat Lead',
    profileEmail: 'pat@example.com',
    leadName: 'Pat Lead',
    leadEmail: 'pat@example.com',
  });
  const alreadyTest = { profileName: 'tester', profileEmail: 'Tester@Example.com' };
  assert.equal(testMode.identitySnapshot(alreadyTest, 'tester@example.com'), null);
});

test('turning test mode off restores the saved lead, including after a closed tab', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'js/features/version-test.js'), 'utf8');
  const clear = src.slice(src.indexOf('function clearTestScenario'), src.indexOf('function setTestMode'));
  assert.match(clear, /restoreIdentity\(\)/);
  const init = src.slice(src.indexOf('function init()'));
  assert.match(init, /if \(!eodTestMode\) restoreIdentity\(\)/);
  assert.match(src, /stashIdentity\(\);\s*S\.patch\(\{\s*storeNumber: EOD_TEST_STORE/);
});

test('the send receipt check calls a test-mode method that exists', () => {
  const send = fs.readFileSync(path.join(__dirname, '..', 'js/features/send.js'), 'utf8');
  const versionTest = fs.readFileSync(path.join(__dirname, '..', 'js/features/version-test.js'), 'utf8');
  const api = versionTest.slice(versionTest.indexOf('global.EodTestMode = {'));
  const called = new Set([...send.matchAll(/EodTestMode\?\.(\w+)/g)].map((m) => m[1]));
  assert.ok(called.size > 0);
  for (const name of called) {
    assert.match(api, new RegExp(`\\b${name}\\b`), `EodTestMode.${name} is not exported`);
  }
});

test('a status check that got no answer is not read as signed out', () => {
  assert.equal(sasLogic.statusAnswered(0, null), false);
  assert.equal(sasLogic.statusAnswered(502, null), false);
  assert.equal(sasLogic.statusAnswered(503, {}), false);
  assert.equal(sasLogic.statusAnswered(200, null), false, 'a wifi sign-in page is not JSON');
  assert.equal(sasLogic.statusAnswered(200, { connected: false }), true);
  assert.equal(sasLogic.statusAnswered(401, null), true);
});

test('the shutter gate lets a shot through when the status is unknown', () => {
  assert.equal(sasLogic.captureVerdict({ unknown: true, connected: false }).ok, true);
  assert.equal(sasLogic.captureVerdict({ connected: false }).ok, false);
  assert.equal(sasLogic.captureVerdict({ connected: true }).ok, true);
  assert.equal(sasLogic.captureVerdict(null).ok, false);
});

test('a failed status fetch keeps the last good status and never throws', async () => {
  let mode = 'ok';
  const sandbox = loadBrowserScript('js/features/sas-user-login.js', {
    EodSasUserLoginLogic: sasLogic,
    EOD_API_BASE: 'https://api.invalid',
    EodSession: { state: { profileEmail: 'pat@example.com' } },
    document: { addEventListener() {}, getElementById() { return null; }, querySelector() { return null; } },
    setTimeout,
    clearTimeout,
    authFetch: async () => {
      if (mode === 'throw') throw new Error('offline');
      if (mode === '502') return { ok: false, status: 502, json: async () => ({}) };
      return { ok: true, status: 200, json: async () => ({ connected: true }) };
    },
  });
  const api = sandbox.EodSasUser;
  assert.ok(api && api.requireConnected, 'EodSasUser must load in the harness');
  assert.equal((await api.requireConnected()).ok, true);
  mode = '502';
  assert.equal((await api.fetchStatus(true)).connected, true, 'a 502 must not overwrite a good status');
  mode = 'throw';
  assert.equal((await api.fetchStatus(true)).connected, true, 'a dropped request must not overwrite it');
  assert.equal((await api.requireConnectedFast()).ok, true);
});

test('with nothing cached, an offline first shot is allowed rather than lost', async () => {
  const sandbox = loadBrowserScript('js/features/sas-user-login.js', {
    EodSasUserLoginLogic: sasLogic,
    EOD_API_BASE: 'https://api.invalid',
    EodSession: { state: { profileEmail: 'pat@example.com' } },
    document: { addEventListener() {}, getElementById() { return null; }, querySelector() { return null; } },
    setTimeout,
    clearTimeout,
    authFetch: async () => { throw new Error('offline'); },
  });
  const verdict = await sandbox.EodSasUser.requireConnectedFast();
  assert.equal(verdict.ok, true);
  assert.equal(verdict.unknown, true);
});

test('Clear storage keeps a visit that was never sent and still has photos', () => {
  const sandbox = loadBrowserScript('js/features/device-storage.js', {
    EodRouter: { register() {} },
    document: { addEventListener() {}, getElementById() { return null; } },
  });
  const verdict = sandbox.EodDeviceStorage.clearVerdict;
  assert.equal(verdict({ id: 'a', count: 12, bytes: 9000 }), 'keep-unsent');
  assert.equal(verdict({ id: 'b', count: 0, bytes: 0, hasOpenJobs: true }), 'keep-unsent');
  assert.equal(verdict({ id: 'c', count: 0, bytes: 0 }), 'drop');
  assert.equal(verdict({ id: 'd', count: 12, sentAt: '2026-11-10T00:00:00Z' }), 'sent');
  assert.equal(verdict({ id: 'e', count: 12, emailOk: true, hasOpenJobs: false }), 'sent');
  assert.equal(verdict({ id: 'f', count: 12, emailOk: true, hasOpenJobs: true }), 'keep-unsent');
});

test('image rows are only swept when no record points at them and they are old', () => {
  const sandbox = loadBrowserScript('js/features/photo-sessions.js');
  const P = sandbox.EodPhotoSessions;
  const used = P.referencedBlobIds([
    { id: 'session:19:2026-11-10', before: [{ blobId: 'b1' }], after: [{ blobId: 'b2' }, 'data:legacy'] },
    { id: 'allPhotos', signoff: [{ blobId: 'b3' }], context: null },
    null,
  ]);
  assert.deepEqual([...used].sort(), ['b1', 'b2', 'b3']);
  const now = 1_000_000_000_000;
  assert.equal(P.orphanBlobDue({ at: now - P.ORPHAN_BLOB_MIN_AGE_MS - 1 }, now), true);
  assert.equal(P.orphanBlobDue({ at: now - 60_000 }, now), false, 'a fresh capture is never swept');
  assert.equal(P.orphanBlobDue({}, now), true, 'rows with no timestamp predate the field');
});

test('Fresh start keeps the visit being left when its photos never went out', () => {
  const sandbox = loadBrowserScript('js/features/photo-sessions.js');
  const P = sandbox.EodPhotoSessions;
  assert.equal(P.holdsUnsentPhotos({ before: [{ blobId: 'b1' }] }), true);
  assert.equal(P.holdsUnsentPhotos({ before: [{ blobId: 'b1' }], sentAt: '2026-11-10T00:00:00Z' }), false);
  assert.equal(P.holdsUnsentPhotos({ before: [{ blobId: 'b1' }], emailOk: true }), false);
  assert.equal(P.holdsUnsentPhotos({ before: [], after: [] }), false);
  assert.equal(P.holdsUnsentPhotos(null), false);
  const visit = fs.readFileSync(path.join(__dirname, '..', 'js/features/visit.js'), 'utf8');
  const fresh = visit.slice(visit.indexOf("'#priorDayStart'"));
  assert.match(fresh.slice(0, 600), /resetVisit\(\{ keepUnsentPhotos: true \}\)/);
});

test('#api= only redirects sign-in on a developer machine', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'js/auth-shim.js'), 'utf8');
  const pick = (hostname, hash) => {
    const body = src.slice(src.indexOf('var API_BASE = (function () {'), src.indexOf('function getSession'));
    const sandbox = { location: { hostname, hash }, decodeURIComponent };
    vm.createContext(sandbox);
    vm.runInContext(`${body}; this.out = API_BASE;`, sandbox);
    return sandbox.out;
  };
  const evil = '#api=https%3A%2F%2Fevil.example';
  assert.equal(pick('someone.github.io', evil), 'https://eod-api.the-dump-bin.com');
  assert.equal(pick('the-dump-bin.com', evil), 'https://eod-api.the-dump-bin.com');
  assert.equal(pick('localhost', '#api=http%3A%2F%2Flocalhost%3A8787%2F'), 'http://localhost:8787');
  assert.equal(pick('localhost', ''), 'https://eod-api.the-dump-bin.com');
});

test('third-party scripts are pinned to a version', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'js/features/materials-browser.js'), 'utf8');
  assert.match(src, /cdn\.jsdelivr\.net\/npm\/pdf-lib@\d+\.\d+\.\d+\//);
});

test('the stale one-off bump script is gone', () => {
  assert.equal(fs.existsSync(path.join(__dirname, '..', 'scripts', 'bump-version.js')), false);
});
