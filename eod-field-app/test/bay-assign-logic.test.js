'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const assign = require('../js/lib/bay-assign-logic');

test('camera next empty bay follows taken order on active bays', () => {
  assert.equal(assign.cameraNextBay({ taken: [], activeBays: [1, 2, 3] }), 1);
  assert.equal(assign.cameraNextBay({ taken: [1], activeBays: [1, 2, 3] }), 2);
  assert.equal(assign.cameraNextBay({ taken: [1, 2, 3], activeBays: [1, 2, 3] }), null);
  // Sparse: bay 3 missing — next after 1 is 2, then 4.
  assert.equal(assign.cameraNextBay({ taken: [1], activeBays: [1, 2, 4] }), 2);
  assert.equal(assign.cameraNextBay({ taken: [1, 2], activeBays: [1, 2, 4] }), 4);
});

test('file-pick never overwrites a loaded bay without confirmation', () => {
  let state = assign.placePhoto({
    assignments: { 0: 1 },
    occupied: { 1: 0 },
    photoIdx: 1,
    bay: 1,
    confirmReplace: false,
  });
  assert.equal(state.ok, false);
  assert.equal(state.needReplaceConfirm, true);
  state = assign.placePhoto({
    assignments: { 0: 1 },
    occupied: { 1: 0 },
    photoIdx: 1,
    bay: 1,
    confirmReplace: true,
  });
  assert.equal(state.ok, true);
  assert.equal(state.assignments[1], 1);
  assert.equal(state.assignments[0], undefined);
});

test('single file is assignable to any bay', () => {
  const state = assign.placePhoto({
    assignments: {},
    occupied: {},
    photoIdx: 0,
    bay: 5,
    confirmReplace: false,
  });
  assert.equal(state.ok, true);
  assert.equal(state.assignments[0], 5);
});

test('bulk of N files suggests N bays; fewer and more are handled', () => {
  assert.deepEqual(
    Object.values(assign.suggestAssignments({ fileCount: 4, emptyBays: [1, 2, 3, 4] })),
    [1, 2, 3, 4]
  );
  const fewer = assign.confirmPlan({
    assignments: assign.suggestAssignments({ fileCount: 2, emptyBays: [1, 2, 3, 4] }),
    fileCount: 2,
    requiredBays: [1, 2, 3, 4],
  });
  assert.equal(fewer.ready, false);
  assert.equal(fewer.placements.length, 2);
  const more = assign.confirmPlan({
    assignments: { 0: 1, 1: 2, 2: 3, 3: 4, 4: null },
    fileCount: 5,
    requiredBays: [1, 2, 3, 4],
  });
  assert.equal(more.ready, true);
  assert.equal(more.unassignedCount, 1);
});

test('missing bays keep sparse numbers; added bays are PROD-only', () => {
  const missing = assign.markMissing({ baseCount: 4, missingBays: [], addedBays: [], bay: 3 });
  assert.deepEqual(missing.activeBays, [1, 2, 4]);
  assert.deepEqual(missing.missingBays, [3]);
  assert.equal(missing.newCount, 3);
  const added = assign.addBay({ baseCount: 4, missingBays: [3], addedBays: [] });
  assert.equal(added.bay, 5);
  assert.deepEqual(added.activeBays, [1, 2, 4, 5]);
  assert.deepEqual(
    assign.uploadTargetsForBay({ bay: 3, siSectionCount: 4, missingBays: [3], addedBays: [] }),
    { skipProd: true, skipSi: false, blurrySi: true }
  );
  assert.deepEqual(
    assign.uploadTargetsForBay({ bay: 5, siSectionCount: 4, missingBays: [3], addedBays: [5] }),
    { skipProd: false, skipSi: true, blurrySi: false }
  );
});
