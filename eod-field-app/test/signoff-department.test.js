'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  extractPogDeptCode,
  rolesForSignoffRow,
} = require('../js/lib/signoff-department');

test('D01 in the POG routes an incorrectly labeled GM row to Grocery', () => {
  const row = {
    catId: 228,
    catName: 'COFFEE FILTERS AND CREAMERS',
    dept: 'GM',
    pog: 'D701_L00000_D01_C228_V832_F008_MX',
  };
  assert.equal(extractPogDeptCode(row.pog), '01');
  assert.deepEqual(rolesForSignoffRow(row), ['grocery']);
});

test('POG department mappings drive department signatures', () => {
  assert.deepEqual(rolesForSignoffRow({ pog: 'D701_L00000_D19_C140_V100_F016_MX' }), ['produce']);
  assert.deepEqual(rolesForSignoffRow({ pog: 'D701_L00000_D87_C100_V100_F016_MX' }), ['home_manager']);
});

test('department text is fallback-only when the POG has no department segment', () => {
  assert.deepEqual(rolesForSignoffRow({ dept: 'GM', pog: 'D701_C228_MX' }), ['home_manager']);
  assert.deepEqual(rolesForSignoffRow({ dept: 'Unknown', pog: 'D701_C228_MX' }), ['grocery']);
});
