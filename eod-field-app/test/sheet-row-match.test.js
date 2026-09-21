'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  findSheetRowForMeta,
  matchProdSetForRow,
} = require('../js/lib/sheet-row-match');

const rows = [
  { id: 11, dbkey: '9631439', catId: '52', catName: 'SWEET GOODS INLINE 8 SHELF WITH LITTLE DEBBIE' },
  { id: 22, dbkey: '9631462', catId: '52', catName: 'ENTENMANNS SHADOW BOX 7 SHELF' },
];

test('helpdesk meta prefers rowId over a shared category number', () => {
  const hit = findSheetRowForMeta(rows, {
    rowId: 22,
    dbkey: '9631462',
    categoryNumber: '52',
    setLabel: 'ENTENMANNS SHADOW BOX 7 SHELF',
  });
  assert.equal(hit.dbkey, '9631462');
  assert.equal(hit.id, 22);
});

test('helpdesk meta does not stamp the first C52 row when rowId is for the other set', () => {
  const hit = findSheetRowForMeta(rows, {
    rowId: 22,
    dbkey: '9631439',
    categoryNumber: '52',
  });
  assert.equal(hit.id, 22);
  assert.equal(hit.dbkey, '9631462');
});

test('helpdesk meta matches dbkey when rowId is missing', () => {
  const hit = findSheetRowForMeta(rows, {
    dbkey: '9631462',
    categoryNumber: '52',
  });
  assert.equal(hit.dbkey, '9631462');
});

test('helpdesk meta does not first-match on category 52 alone', () => {
  const hit = findSheetRowForMeta(rows, { categoryNumber: '52' });
  assert.equal(hit, null);
});

test('helpdesk meta can use unique category+name', () => {
  const hit = findSheetRowForMeta(rows, {
    categoryNumber: '52',
    categoryName: 'ENTENMANNS SHADOW BOX 7 SHELF',
  });
  assert.equal(hit.dbkey, '9631462');
});

test('PROD set bind uses dbkey, not the first C52 reset', () => {
  const map = {
    111: {
      sets: [
        { number: 52, name: 'SWEET GOODS INLINE 8 SHELF WITH LITTLE DEBBIE', dbkey: '9631439' },
        { number: 52, name: 'ENTENMANNS SHADOW BOX 7 SHELF', dbkey: '9631462' },
      ],
    },
  };
  const hit = matchProdSetForRow(rows[1], map);
  assert.equal(hit.set.dbkey, '9631462');
});

test('PROD set bind does not return the first category-number hit', () => {
  const map = {
    111: {
      sets: [
        { number: 52, name: 'SWEET GOODS INLINE 8 SHELF WITH LITTLE DEBBIE', dbkey: '' },
        { number: 52, name: 'OTHER', dbkey: '' },
      ],
    },
  };
  const hit = matchProdSetForRow({ catId: '52', catName: 'ENTENMANNS SHADOW BOX 7 SHELF', dbkey: '' }, map);
  assert.equal(hit, null);
});
