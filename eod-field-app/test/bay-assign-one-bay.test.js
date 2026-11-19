'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const count = require('../js/lib/bay-count-logic');
const assign = require('../js/lib/bay-assign-logic');

test('knownBayCount no longer trusts a lone warm 1', () => {
  assert.equal(count.knownBayCount({ expectedBayCount: 1 }), null);
  assert.equal(count.knownBayCount({ expectedBayCount: 1, si: { sectionCount: 0 } }), null);
});

test('a true one-bay set is known when SI / pog / bays say 1', () => {
  assert.equal(count.knownBayCount({ si: { sectionCount: 1 } }), 1);
  assert.equal(count.knownBayCount({ planogramBayCount: 1 }), 1);
  assert.equal(count.knownBayCount({ bays: [{ bay: 1 }] }), 1);
  assert.equal(count.knownBayCount({ expectedBayCount: 1, si: { sectionCount: 1 } }), 1);
});

test('true one-bay set: completes after one photo; second photo asks before replace', () => {
  const known = count.knownBayCount({ si: { sectionCount: 1 } });
  assert.equal(known, 1);
  const next = assign.cameraNextBay({ taken: [], activeBays: [1] });
  assert.equal(next, 1);
  assert.equal(assign.cameraNextBay({ taken: [1], activeBays: [1] }), null);

  const plan = assign.confirmPlan({
    assignments: { 0: 1 },
    fileCount: 1,
    requiredBays: [1],
  });
  assert.equal(plan.ready, true);
  assert.deepEqual(plan.missingRequired, []);

  // Assign screen does not invent bay 2 when requiredBays is [1].
  const over = assign.confirmPlan({
    assignments: { 0: 1 },
    fileCount: 1,
    requiredBays: [1],
  });
  assert.equal(over.ready, true);

  const replace = assign.placePhoto({
    assignments: { 0: 1 },
    occupied: { 1: 0 },
    photoIdx: 1,
    bay: 1,
    confirmReplace: false,
  });
  assert.equal(replace.needReplaceConfirm, true);
  assert.equal(replace.replaceBay, 1);
});
