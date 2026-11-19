'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const count = require('../js/lib/bay-count-logic');
const assign = require('../js/lib/bay-assign-logic');

const read = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');

/* The camera, five shots at a time, the way set-survey drives it: the next bay
   is the first empty one; a refusal stores nothing. */
function shoot({ known, activeBays, shots }) {
  const taken = new Set();
  const stored = [];
  const refused = [];
  for (let i = 0; i < shots; i += 1) {
    const bay = assign.cameraNextBay({ taken: [...taken], activeBays });
    if (!bay) { refused.push('full'); continue; }
    const reason = count.refuseBayReason({
      known,
      bay,
      replacing: false,
      maxBay: Math.max(0, ...activeBays),
      occupied: taken,
    });
    if (reason) { refused.push(reason); continue; }
    taken.add(bay);
    stored.push(bay);
  }
  return { stored, refused };
}

test('five camera shots with no bay count store bays 1-5, none refused or replaced', () => {
  const { stored, refused } = shoot({ known: null, activeBays: [], shots: 5 });
  assert.deepEqual(stored, [1, 2, 3, 4, 5]);
  assert.deepEqual(refused, []);
});

test('the old unknown-count cap (one drawn bay) is gone', () => {
  // 3.5.45: activeBays fell back to [1], maxBay 1, so bay 2 was refused.
  assert.equal(count.refuseBayReason({ known: null, bay: 2, replacing: false, maxBay: 1 }), null);
  assert.equal(count.refuseBayReason({ known: 0, bay: 9, replacing: false, maxBay: 1 }), null);
});

test('five camera shots on a known five-bay set stop at five, a sixth is not taken', () => {
  const active = [1, 2, 3, 4, 5];
  const { stored, refused } = shoot({ known: 5, activeBays: active, shots: 6 });
  assert.deepEqual(stored, [1, 2, 3, 4, 5]);
  assert.deepEqual(refused, ['full']);
  assert.equal(assign.cameraNextBay({ taken: stored, activeBays: active }), null);
});

test('a sixth bay exists only after Add a bay widens the active list', () => {
  const widened = assign.addBay({ baseCount: 5, missingBays: [], addedBays: [] });
  assert.equal(widened.bay, 6);
  assert.deepEqual(widened.activeBays, [1, 2, 3, 4, 5, 6]);
  assert.equal(assign.cameraNextBay({ taken: [1, 2, 3, 4, 5], activeBays: widened.activeBays }), 6);
  // Over the known count without Add a bay is refused.
  assert.equal(count.refuseBayReason({ known: 5, bay: 6, replacing: false, maxBay: 5 }), 'over');
});

test('a bay that holds a photo is never taken over by a new photo', () => {
  assert.equal(count.refuseBayReason({ known: null, bay: 1, replacing: false, occupied: new Set([1]) }), 'exists');
  assert.equal(count.refuseBayReason({ known: 5, bay: 3, replacing: false, occupied: [3] }), 'exists');
  // Only an explicit Replace may land on it.
  assert.equal(count.refuseBayReason({ known: 5, bay: 3, replacing: true, occupied: [3] }), null);
  assert.equal(count.refuseBayReason({ known: 5, bay: 0, replacing: true }), 'full');
});

test('a device pick on an unknown count lands on free bays, one per photo', () => {
  assert.deepEqual(count.freeBays({ taken: [], count: 3 }), [1, 2, 3]);
  assert.deepEqual(count.freeBays({ taken: [1, 2, 3], count: 2 }), [4, 5]);
  assert.deepEqual(count.freeBays({ taken: [2], count: 3 }), [1, 3, 4]);
  assert.equal(count.highestBay([1, 3, 2]), 3);
});

test('the full-set message names the count', () => {
  assert.equal(count.allTakenMessage(5), 'All 5 bays taken');
  assert.equal(count.allTakenMessage(1), 'All 1 bay taken');
});

test('set-survey: no code path replaces a bay as a side effect', () => {
  const survey = read('js/features/set-survey.js');
  // The implicit "full set means retake from bay 1" mode is gone.
  assert.doesNotMatch(survey, /Retake afters|Retake befores/);
  assert.doesNotMatch(survey, /replacing = !fromOne && nextEmptyBay/);
  assert.doesNotMatch(survey, /function enqueueFiles/);
  // Camera replace is one chosen bay.
  assert.match(survey, /replaceBay/);
  assert.match(survey, /data-replace-open/);
  // enqueueLocal asks the shared rule, with the bays already taken.
  assert.match(survey, /occupied: takenBays\(slot\)/);
  // No count: nothing leaves the phone until the count is given.
  assert.match(survey, /holdUpload: !total/);
  assert.match(survey, /How many bays does this set have\?/);
});

test('set-survey: the bay-override save sends the day-confirm header and shows the old count on failure', () => {
  const survey = read('js/features/set-survey.js');
  const save = survey.slice(survey.indexOf('async function saveBayOverride'), survey.indexOf('function paintStatus'));
  assert.match(save, /global\.EodApi\.dayConfirmHeaders\(/);
  assert.doesNotMatch(save, /headers: \{ 'Content-Type': 'application\/json' \}/);
  // No optimistic write before the request.
  assert.doesNotMatch(save.slice(0, save.indexOf('authFetch')), /local\.bayOverride =/);
  assert.match(save, /Bay count not saved/);
});

test('the pipeline can hold a job until the count is known', () => {
  const pipe = read('js/lib/photo-pipeline.js');
  assert.match(pipe, /&& !j\.holdUpload/);
  assert.match(pipe, /function releaseHeld/);
  assert.match(pipe, /holdUpload: !!opts\.holdUpload/);
});
