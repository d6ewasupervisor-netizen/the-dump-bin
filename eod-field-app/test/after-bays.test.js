'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

function fakeStorage(limit) {
  const map = new Map();
  const size = () => [...map.values()].reduce((n, v) => n + v.length, 0);
  return {
    get length() { return map.size; },
    key: (i) => [...map.keys()][i] ?? null,
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem(k, v) {
      const next = size() - (map.get(k) || '').length + String(v).length;
      if (next > limit) { const e = new Error('quota'); e.name = 'QuotaExceededError'; throw e; }
      map.set(k, String(v));
    },
    removeItem: (k) => { map.delete(k); },
    keys: () => [...map.keys()],
  };
}

function loadStore(limit) {
  const ls = fakeStorage(limit);
  const noted = [];
  const sandbox = { localStorage: ls, window: null, EodDiag: { note: (c) => noted.push(c) } };
  sandbox.window = sandbox;
  vm.runInNewContext(read('js/features/set-before-store.js'), sandbox);
  return { store: sandbox.EodSetBeforeStore, ls, noted };
}

test('a carry write that does not fit drops other stores\' buckets, writes, and clears the full flag', () => {
  const { store, ls } = loadStore(1000);
  store.setAfters('49', 'P11W1', '1', ['x'.repeat(400)]);
  store.setAfters('53', 'P11W1', '1', ['y'.repeat(400)]);
  assert.equal(store.quotaBlocked(), false);
  store.setAfters('23', 'P11W1', '9', ['z'.repeat(600)]);
  assert.equal(store.quotaBlocked(), false);
  assert.ok(ls.keys().some((k) => k.includes(':23:')));
  assert.equal(store.getAfters('23', 'P11W1', '9').length, 1);
});

test('the full flag is raised only while the write really cannot fit, then clears', () => {
  const { store, noted } = loadStore(300);
  assert.throws(() => store.setAfters('23', 'P11W1', '9', ['z'.repeat(900)]), /quota/i);
  assert.equal(store.quotaBlocked(), true);
  assert.ok(noted.includes('set-store.quota'));
  store.setAfters('23', 'P11W1', '9', ['ok']);
  assert.equal(store.quotaBlocked(), false);
});

test('the header says carry store full only from the live flag, never from a counter of past errors', () => {
  const chrome = read('js/chrome.js');
  assert.match(chrome, /EodSetBeforeStore\?\.quotaBlocked\?\.\(\)\) parts\.push\('carry store full'\)/);
  assert.doesNotMatch(chrome, /count\?\.\('set-store\.quota'\)/);
});

test('a held after photo comes back accepted without polling the 23-hour job', () => {
  const client = read('js/lib/field-set-job-client.js');
  assert.match(client, /data\.hold && data\.hold\.complete === false/);
  assert.match(client, /held: true, hold: data\.hold/);
  assert.match(client, /EodAfterHolds\?\.note\?\.\(meta\.storeNumber, meta\.workDate, meta\.dbkey, data\.hold\)/);
});

test('the prompt asks for the missing bays and reads only the holds endpoint', async () => {
  const chrome = read('js/chrome.js');
  assert.match(chrome, /\/api\/field-set\/after-holds\?store=/);
  assert.match(chrome, /Please finish loading them/);
  assert.match(chrome, /moved to backlog/);
  const fetched = [];
  const timers = [];
  const doc = {
    getElementById: () => null,
    createElement: () => ({ style: {}, classList: { add() {} }, querySelector: () => null, set innerHTML(v) { this._h = v; }, get innerHTML() { return this._h; } }),
    body: { appendChild() {} },
  };
  const sandbox = {
    document: doc, window: null, setInterval: (fn) => { timers.push(fn); return 1; }, clearInterval() {},
    EOD_API_BASE: 'https://eod', location: { hash: '' }, EodSession: { state: { sheet: { rows: [{ dbkey: '9680806', catName: 'ASIAN FOODS' }] } } },
    EodApi: { escapeHtml: (s) => String(s) },
    authFetch: async (url) => { fetched.push(url); return { ok: true, json: async () => ({ holds: [{ dbkey: '9680806', expected: 5, loaded: 2, state: 'prompted', promptedAt: 't1' }] }) }; },
  };
  sandbox.window = sandbox;
  const start = chrome.indexOf('const afterHolds = (() => {');
  const end = chrome.indexOf('global.EodAfterHolds = afterHolds;');
  assert.ok(start > 0 && end > start);
  const closeModal = () => {};
  vm.runInNewContext(`(function (global, closeModal) { ${chrome.slice(start, end)} global.EodAfterHolds = afterHolds; })(this, ${closeModal.toString()})`, sandbox);
  const holds = sandbox.EodAfterHolds;
  assert.ok(holds);
  holds.note('23', '2026-11-17', '9680806', { complete: false, loaded: 2, expected: 5 });
  assert.equal(timers.length, 1);
  await holds.pollOnce();
  assert.equal(fetched.length, 1);
  assert.match(fetched[0], /after-holds\?store=23&date=2026-11-17$/);
  holds.note('23', '2026-11-17', '9680806', { complete: true, loaded: 5, expected: 5 });
  assert.equal(holds._watched.size, 0);
});
