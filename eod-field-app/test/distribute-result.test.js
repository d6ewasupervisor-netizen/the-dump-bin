'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadMgmt() {
  const code = fs.readFileSync(path.join(__dirname, '../js/features/timesheet-mgmt.js'), 'utf8');
  const window = {
    document: { getElementById() { return null; }, body: { classList: { add() {}, remove() {} } } },
  };
  vm.runInNewContext(code, { window, document: window.document, console });
  const api = window.EodTimesheetMgmt;
  return {
    formatHm: api.formatHm,
    distributeModel: (data) => JSON.parse(JSON.stringify(api.distributeModel(data))),
  };
}

test('hours read the way PROD prints them', () => {
  const { formatHm } = loadMgmt();
  assert.equal(formatHm(495), '8h 15m');
  assert.equal(formatHm(240), '4h');
  assert.equal(formatHm(45), '45m');
  assert.equal(formatHm(0), '0m');
});

test('a verified run shows one row per shift type and a total', () => {
  const { distributeModel } = loadMgmt();
  const model = distributeModel({
    ok: true,
    verified: true,
    summary: 'Time distributed. Kompass ISE 9h 30m, Cut In 1h.',
    totals: {
      minutes: 630,
      people: 3,
      byType: [
        { projectName: 'Kompass ISE', minutes: 570, people: 3, sets: 2 },
        { projectName: 'Cut In', minutes: 60, people: 1, sets: 1 },
      ],
    },
    unplaced: [],
  });
  assert.equal(model.kind, 'done');
  assert.equal(model.title, 'Time distributed');
  assert.deepEqual(model.rows, [
    { label: 'Kompass ISE', value: '9h 30m' },
    { label: 'Cut In', value: '1h' },
  ]);
  assert.deepEqual(model.total, { label: 'Total · 3 people', value: '10h 30m' });
  assert.deepEqual(model.notOnSets, []);
});

test('time that landed on no set is called out by shift type', () => {
  const { distributeModel } = loadMgmt();
  const model = distributeModel({
    verified: true,
    totals: { minutes: 300, people: 1, byType: [{ projectName: 'Kompass ISE', minutes: 300, people: 1, sets: 2 }] },
    unplaced: [
      { projectName: 'Cut In', name: 'Ann', minutes: 60 },
      { projectName: 'Cut In', name: 'Ben', minutes: 30 },
    ],
  });
  assert.deepEqual(model.notOnSets, [{ label: 'Cut In — not on a set', value: '1h 30m' }]);
});

test('store 999 has no rows and keeps the server note', () => {
  const { distributeModel } = loadMgmt();
  const model = distributeModel({
    verified: true,
    testMode: true,
    summary: 'Store 999 does not write PROD time.',
    totals: { minutes: 0, people: 0, byType: [] },
    unplaced: [],
  });
  assert.equal(model.kind, 'done');
  assert.equal(model.total, null);
  assert.equal(model.note, 'Store 999 does not write PROD time.');
});

test('a blocked run lists each shift with its sets, punches and PROD links', () => {
  const { distributeModel } = loadMgmt();
  const model = distributeModel({
    ok: false,
    blocked: true,
    blockers: [{
      visitId: '27430544',
      projectName: 'Kompass ISE',
      categoryUrl: 'https://prod.sasretail.com/en/field/schedules/27430544/schedule/admin',
      shiftUrl: 'https://prod.sasretail.com/en/field/schedules/27430544/shift-completion/admin',
      sets: [{ resetId: 15, name: 'BLEACH' }],
      punches: [{ name: 'Ann Lead', reason: 'Still clocked in' }],
    }],
  });
  assert.equal(model.kind, 'blocked');
  assert.equal(model.title, 'Not ready to distribute');
  assert.deepEqual(model.groups, [{
    projectName: 'Kompass ISE',
    sets: ['BLEACH'],
    categoryUrl: 'https://prod.sasretail.com/en/field/schedules/27430544/schedule/admin',
    punches: ['Ann Lead — Still clocked in'],
    shiftUrl: 'https://prod.sasretail.com/en/field/schedules/27430544/shift-completion/admin',
  }]);
});

test('a mismatch names the person, the punch and what is on the sets', () => {
  const { distributeModel } = loadMgmt();
  const model = distributeModel({
    ok: false,
    verified: false,
    problems: [{ projectName: 'Kompass ISE', name: 'Ben Rep', punchMinutes: 150, onSets: 120, reason: 'x' }],
    errors: [],
  });
  assert.equal(model.kind, 'problem');
  assert.deepEqual(model.lines, ['Ben Rep (Kompass ISE): punch 2h 30m, on sets 2h']);
});
