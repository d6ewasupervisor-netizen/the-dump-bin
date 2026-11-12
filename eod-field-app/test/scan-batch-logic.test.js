'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { groupScanResults } = require('../js/lib/scan-batch-logic');

test('a new item with no aisle groups under New items', () => {
  const groups = groupScanResults([
    {
      upc: '0001111016923',
      status: 'ready',
      data: {
        found: true,
        matches: [{
          upc: '0001111016923',
          name: 'KRO PORK MINI WONTONS',
          notesAction: 'new',
          setName: '195 FROZEN ASIAN',
        }],
      },
    },
  ]);
  assert.equal(groups[0].aisle, 'New items');
  assert.equal(groups[0].setName, '195 FROZEN ASIAN');
});

test('scan results keep the notes week with the set', () => {
  const groups = groupScanResults([
    {
      upc: '0001111016923',
      status: 'ready',
      data: {
        found: true,
        matches: [{
          upc: '0001111016923',
          notesAction: 'new',
          notesPeriodWeek: 'P09W4',
          setName: '195 FROZEN ASIAN',
          aisle: '12',
        }],
      },
    },
  ]);
  assert.equal(groups[0].aisle, 'Aisle 12');
  assert.equal(groups[0].setName, 'P09W4 · 195 FROZEN ASIAN');
});

test('scan results group by aisle then set', () => {
  const groups = groupScanResults([
    {
      upc: '111',
      status: 'ready',
      data: {
        found: true,
        matches: [
          { upc: '111', name: 'Towel', aisle: '12', setName: 'Paper' },
          { upc: '111', name: 'Towel', aisle: '4', setName: 'Household' },
        ],
      },
    },
    {
      upc: '222',
      status: 'ready',
      data: { found: true, matches: [{ upc: '222', name: 'Soup', aisle: '4', setName: 'Soup' }] },
    },
    { upc: '333', status: 'miss', data: { found: false, matches: [] } },
  ]);
  assert.deepEqual(groups.map((g) => `${g.aisle}|${g.setName}`), [
    'Aisle 4|Household',
    'Aisle 4|Soup',
    'Aisle 12|Paper',
    'Not located|',
  ]);
  assert.equal(groups[0].rows[0].upc, '111');
  assert.equal(groups.at(-1).rows[0].upc, '333');
});

function fakeStorage() {
  const data = new Map();
  return {
    get length() { return data.size; },
    key: (i) => [...data.keys()][i] ?? null,
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => { data.set(k, String(v)); },
    removeItem: (k) => { data.delete(k); },
  };
}

function freshBatch() {
  delete require.cache[require.resolve('../js/lib/scan-batch-logic')];
  return require('../js/lib/scan-batch-logic');
}

test('scan results stay on the device for the visit and clear on a new visit', (t) => {
  const prev = { ls: globalThis.localStorage, ss: globalThis.sessionStorage, S: globalThis.EodSession };
  t.after(() => {
    globalThis.localStorage = prev.ls;
    globalThis.sessionStorage = prev.ss;
    globalThis.EodSession = prev.S;
    freshBatch();
  });
  globalThis.localStorage = fakeStorage();
  globalThis.sessionStorage = fakeStorage();
  globalThis.EodSession = { state: { storeNumber: '391', workDate: '2026-11-11' } };

  let batch = freshBatch();
  batch.commit([{ upc: '111', status: 'ready', data: { found: true, matches: [{ upc: '111', aisle: '4' }] } }]);
  batch.commit([{ upc: '222', status: 'looking', data: null }]);

  batch = freshBatch();
  assert.deepEqual(batch.list().map((i) => i.upc), ['111']);

  globalThis.EodSession.state.storeNumber = '23';
  assert.deepEqual(batch.list(), []);
  batch.commit([{ upc: '333', status: 'miss', data: { found: false } }]);
  assert.equal(globalThis.localStorage.getItem('eodScanBatch:391|2026-11-11'), null);

  globalThis.EodSession.state.storeNumber = '391';
  assert.deepEqual(batch.list(), []);
});

test('a single scan is filed to Scan results, not only bulk', () => {
  const locate = fs.readFileSync(path.join(__dirname, '../js/lib/cart-upc-locate.js'), 'utf8');
  const enqueue = locate.slice(locate.indexOf('function enqueue('), locate.indexOf('async function finishSingle('));
  assert.equal((enqueue.match(/EodScanBatch\?\.commit\?\.\(\[item\]\)/g) || []).length, 2);
});

test('bulk scan keeps the camera open and files a Scan results page', () => {
  const root = path.join(__dirname, '..');
  const locate = fs.readFileSync(path.join(root, 'js/lib/cart-upc-locate.js'), 'utf8');
  const scanner = fs.readFileSync(path.join(root, 'js/lib/barcode-scanner.js'), 'utf8');
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const chrome = fs.readFileSync(path.join(root, 'js/chrome.js'), 'utf8');
  assert.match(locate, /Scan more items\?/);
  assert.match(locate, /Done Scanning/);
  assert.match(locate, /continuous: true/);
  assert.match(scanner, /if \(continuous\)/);
  assert.match(scanner, /setAccepting/);
  assert.match(html, /data-nav="scans"/);
  assert.match(chrome, /data-more="scans"/);
});
