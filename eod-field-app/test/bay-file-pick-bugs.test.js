'use strict';

/**
 * Step 1 regressions — these failed on origin/main; they must pass after the
 * assign-screen + knownBayCount fix.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const bay = require('../js/lib/bay-count-logic');
const assign = require('../js/lib/bay-assign-logic');
const survey = fs.readFileSync(path.join(__dirname, '..', 'js', 'features', 'set-survey.js'), 'utf8');

test('1a: second single file is assignable to bay 2 (not forced replace of bay 1)', () => {
  // Warm count alone no longer collapses planning. Assign screen lets a
  // single file land on any required bay.
  assert.equal(bay.knownBayCount({ expectedBayCount: 1 }), null);
  const required = [1, 2, 3, 4, 5, 6, 7, 8];
  let state = { assignments: {}, occupied: {} };
  state = assign.placePhoto({
    ...state,
    photoIdx: 0,
    bay: 2,
    confirmReplace: false,
  });
  assert.equal(state.ok, true);
  assert.equal(state.assignments[0], 2);
  const plan = assign.confirmPlan({
    assignments: state.assignments,
    fileCount: 1,
    requiredBays: required,
  });
  assert.equal(plan.ready, false, 'confirm waits until every bay is placed');
  assert.deepEqual(plan.placements.map((p) => p.bay), [2]);
});

test('1a wiring: gallery opens assign screen instead of stamped data-replace enqueue', () => {
  assert.doesNotMatch(survey, /data-replace=/);
  assert.match(survey, /openAssignAndEnqueue/);
  assert.match(survey, /EodBayAssignScreen/);
});

test('1b: bulk of N files plans N bays when warm expectedBayCount is 1', () => {
  assert.equal(bay.knownBayCount({ expectedBayCount: 1 }), null);
  const bays = bay.planFileBays({ known: bay.knownBayCount({ expectedBayCount: 1 }), taken: new Set(), fileCount: 8 });
  assert.deepEqual(bays, [1, 2, 3, 4, 5, 6, 7, 8]);
});

test('1b: assign confirm waits for every required bay before upload', () => {
  const required = [1, 2, 3, 4];
  const suggested = assign.suggestAssignments({ fileCount: 4, emptyBays: required });
  const plan = assign.confirmPlan({ assignments: suggested, fileCount: 4, requiredBays: required });
  assert.equal(plan.ready, true);
  assert.equal(plan.placements.length, 4);
  const short = assign.confirmPlan({
    assignments: { 0: 1, 1: 2 },
    fileCount: 4,
    requiredBays: required,
  });
  assert.equal(short.ready, false);
  assert.equal(short.unassignedCount, 2);
});
