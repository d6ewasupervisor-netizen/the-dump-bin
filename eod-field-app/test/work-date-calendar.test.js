'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { dayTone, monthCells, windowForMonth, dayAriaLabel } = require('../js/lib/work-date-calendar');

test('the confirm calendar loads scheduled dates from the shift-day cache', () => {
  const cache = fs.readFileSync(path.join(__dirname, '..', 'js', 'lib', 'shift-day-cache.js'), 'utf8');
  const visit = fs.readFileSync(path.join(__dirname, '..', 'js', 'features', 'visit.js'), 'utf8');
  assert.match(cache, /async function loadStoreShiftDates/);
  assert.match(cache, /\/store-dates\?store=/);
  assert.match(cache, /loadStoreShiftDates,/);
  assert.match(visit, /EodShiftDay\?\.loadStoreShiftDates\?\./);
});

test('scheduled days read as scheduled, not only ISE', () => {
  assert.equal(dayAriaLabel('2026-11-10', 'ise'), 'November 10, 2026. Scheduled.');
  assert.equal(dayAriaLabel('2026-11-10', 'both'), 'November 10, 2026. Scheduled. Today.');
});

test('today and a scheduled day overlap as both', () => {
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
