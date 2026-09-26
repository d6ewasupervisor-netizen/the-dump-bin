'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { dayTone, monthCells, windowForMonth } = require('../js/lib/work-date-calendar');

test('today and a Kompass ISE day overlap as both', () => {
  assert.equal(dayTone('2026-09-26', '2026-09-26', ['2026-09-26']), 'both');
  assert.equal(dayTone('2026-09-24', '2026-09-26', ['2026-09-24']), 'ise');
  assert.equal(dayTone('2026-09-26', '2026-09-26', []), 'today');
  assert.equal(dayTone('2026-09-01', '2026-09-26', ['2026-09-24']), '');
});

test('September 2026 starts on Tuesday', () => {
  const cells = monthCells(2026, 8);
  assert.equal(cells[0], null);
  assert.equal(cells[1], null);
  assert.equal(cells[2].iso, '2026-09-01');
  assert.equal(cells[2].day, 1);
  assert.equal(cells.at(-1).iso, '2026-09-30');
});

test('date window covers the previous month through the next', () => {
  assert.deepEqual(windowForMonth(2026, 8), { from: '2026-08-01', to: '2026-10-31' });
});
