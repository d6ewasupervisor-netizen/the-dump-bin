'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  FALLBACK_STORES,
  uniqueStoreNumbers,
  mergeStoreCatalog,
  pickerItemsForStores,
} = require('../js/lib/store-catalog');

test('uniqueStoreNumbers collapses padded strings, objects, and dupes', () => {
  assert.deepEqual(
    uniqueStoreNumbers([28, '28', '028', { storeNum: 28 }, { store_num: '28' }, 30]),
    [28, 30, 999]
  );
});

test('mergeStoreCatalog does not shrink to a partial district or day list', () => {
  const d8 = [19, 23, 28, 31, 53, 215, 391, 459, 658, 682];
  const merged = mergeStoreCatalog(d8);
  assert.equal(merged.length, FALLBACK_STORES.length);
  for (const n of FALLBACK_STORES) assert.ok(merged.includes(n), `missing ${n}`);
  const counts = new Map();
  for (const n of merged) counts.set(n, (counts.get(n) || 0) + 1);
  for (const [n, c] of counts) assert.equal(c, 1, `store ${n} repeated`);
});

test('mergeStoreCatalog still adds stores that are only on the live catalog', () => {
  const merged = mergeStoreCatalog([777]);
  assert.ok(merged.includes(777));
  assert.ok(merged.includes(28));
  assert.ok(merged.includes(999));
});

test('picker items are one numeric list, not scheduled-first then catalog', () => {
  const scheduled = [28, 53, 215];
  const items = pickerItemsForStores(FALLBACK_STORES, scheduled);
  const ids = items.map((it) => it.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(ids[0], '5');
  assert.ok(ids.indexOf('28') > ids.indexOf('5'));
  assert.deepEqual(ids, [...ids].sort((a, b) => Number(a) - Number(b)));
  assert.equal(items.find((it) => it.id === '28').label, 'Store 28');
});

test('Visit confirm uses the unique catalog picker, not scheduled-first sort', () => {
  const visit = fs.readFileSync(path.join(__dirname, '../js/features/visit.js'), 'utf8');
  const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
  const picker = fs.readFileSync(path.join(__dirname, '../js/picker.js'), 'utf8');
  assert.match(html, /js\/lib\/store-catalog\.js/);
  assert.match(visit, /Catalog\.mergeStoreCatalog/);
  assert.match(visit, /Catalog\.pickerItemsForStores/);
  assert.doesNotMatch(visit, /scheduled\.has\(Number\(a\)\)/);
  assert.match(picker, /function uniqueItems/);
});
