'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { notExecutableLines, notExecutableLine, NOT_EXECUTABLE_REASONS } = require('../js/lib/cover-notes');

test('Not Executable offers the four reasons', () => {
  assert.deepEqual(NOT_EXECUTABLE_REASONS.map((r) => r.label), ['Not In Store', 'Planogram Issue', 'Fixture Issue', 'Other']);
});

test('notes line carries the reason, the comment, and the help desk flag', () => {
  const S = {
    state: {
      sheet: {
        rows: [
          {
            catName: 'SWEET GOODS',
            marks: {
              active: ['not_executable'],
              details: { not_executable: { reason: 'fixture_issue', note: 'Bent\nuprights', helpdeskSent: true } },
            },
          },
          { catName: 'PASTA', marks: { active: ['not_executable'] } },
        ],
      },
    },
  };
  assert.deepEqual(notExecutableLines(S), [
    'Not executable: SWEET GOODS — Fixture Issue: Bent uprights (reported to help desk)',
    'Not executable: PASTA',
  ]);
  assert.equal(notExecutableLine('MILK', { reason: 'other', note: 'Remodel' }), 'Not executable: MILK — Other: Remodel');
});

test('optimistic mark keeps the reason until the server copy lands', () => {
  require('../js/lib/eod-garden');
  const sheet = { rows: [{ id: 5, marks: { active: [] } }] };
  globalThis.EodGarden.applyOptimisticMark(sheet, 5, 'not_executable', true, { reason: 'planogram_issue', note: 'V2 hung' });
  assert.equal(sheet.rows[0].marks.details.not_executable.reason, 'planogram_issue');
  globalThis.EodGarden.applyOptimisticMark(sheet, 5, 'not_executable', false);
  assert.equal(sheet.rows[0].marks.details.not_executable, undefined);
});

test('Not Executable asks for a reason, requires a comment on Other, and offers the help desk', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'js', 'features', 'signoff-home.js'), 'utf8');
  assert.match(src, /function askNotExecutable\(/);
  assert.match(src, /Comments are required for Other\./);
  assert.match(src, /data-ne-act="report">Please Report/);
  assert.match(src, /data-ne-act="skip">Don't Report/);
  assert.match(src, /reason: neReason, note: neNote/);
});
