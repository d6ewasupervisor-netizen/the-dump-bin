'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { visitIdFrom, visitIdForRow, categoryAdminUrl } = require('../js/lib/sas-category-admin');

test('category admin URL matches the SAS PROD schedule admin page', () => {
  assert.equal(
    categoryAdminUrl('27312457'),
    'https://prod.sasretail.com/en/field/schedules/27312457/schedule/admin'
  );
  assert.equal(categoryAdminUrl(''), '');
  assert.equal(categoryAdminUrl('12'), '');
  assert.equal(visitIdFrom('visit-27312457'), '27312457');
});

test('a set uses its own PROD visit before the selected shift', () => {
  const row = { visitId: '11111111', live: { prodVisitId: '27312457' } };
  assert.equal(visitIdForRow(row, '22222222'), '27312457');
  assert.equal(visitIdForRow({ visitId: '11111111' }, '22222222'), '11111111');
  assert.equal(visitIdForRow({}, '22222222'), '22222222');
  assert.equal(visitIdForRow({}, ''), '');
});
