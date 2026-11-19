'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const count = require('../js/lib/bay-count-logic');
const assign = require('../js/lib/bay-assign-logic');

const read = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');

/* The camera, as set-survey drives it: the next bay is the first empty one;
   a shot is refused only for having no bay or for landing on a taken bay. */
function shoot({ activeBays, shots }) {
  const taken = new Set();
  const stored = [];
  const refused = [];
  for (let i = 0; i < shots; i += 1) {
    const bay = assign.cameraNextBay({ taken: [...taken], activeBays });
    if (!bay) { refused.push('full'); continue; }
    const reason = count.refuseBayReason({ bay, replacing: false, occupied: taken });
    if (reason) { refused.push(reason); continue; }
    taken.add(bay);
    stored.push(bay);
  }
  return { stored, refused };
}

test('five camera shots with no bay count store bays 1-5, none refused or replaced', () => {
  const { stored, refused } = shoot({ activeBays: [], shots: 5 });
  assert.deepEqual(stored, [1, 2, 3, 4, 5]);
  assert.deepEqual(refused, []);
});

test('five camera shots on a known five-bay set stop at five, no sixth bay is offered', () => {
  const active = [1, 2, 3, 4, 5];
  const { stored, refused } = shoot({ activeBays: active, shots: 6 });
  assert.deepEqual(stored, [1, 2, 3, 4, 5]);
  assert.deepEqual(refused, ['full']);
  assert.equal(assign.cameraNextBay({ taken: stored, activeBays: active }), null);
});

test('a sixth bay exists only after Add a bay widens the active list', () => {
  const widened = assign.addBay({ baseCount: 5, missingBays: [], addedBays: [] });
  assert.equal(widened.bay, 6);
  assert.deepEqual(widened.activeBays, [1, 2, 3, 4, 5, 6]);
  assert.equal(assign.cameraNextBay({ taken: [1, 2, 3, 4, 5], activeBays: widened.activeBays }), 6);
});

test('the bay count is never a reason to refuse a shot', () => {
  assert.equal(count.refuseBayReason({ bay: 2, replacing: false }), null);
  assert.equal(count.refuseBayReason({ bay: 9, replacing: false }), null);
  assert.equal(count.refuseBayReason({ known: 5, bay: 6, replacing: false }), null);
});

test('a bay that holds a photo is never taken over by a new photo', () => {
  assert.equal(count.refuseBayReason({ bay: 1, replacing: false, occupied: new Set([1]) }), 'exists');
  assert.equal(count.refuseBayReason({ bay: 3, replacing: false, occupied: [3] }), 'exists');
  // Only an explicit Replace may land on it.
  assert.equal(count.refuseBayReason({ bay: 3, replacing: true, occupied: [3] }), null);
  assert.equal(count.refuseBayReason({ bay: 0, replacing: true }), 'full');
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

test('set-survey: no path refuses a shot for the count, or replaces a bay as a side effect', () => {
  const survey = read('js/features/set-survey.js');
  assert.doesNotMatch(survey, /Retake afters|Retake befores/);
  assert.doesNotMatch(survey, /function enqueueFiles/);
  assert.doesNotMatch(survey, /was not added/);
  assert.doesNotMatch(survey, /reason === 'over'/);
  assert.match(survey, /replaceBay/);
  assert.match(survey, /data-replace-open/);
  assert.match(survey, /occupied: takenBays\(slot\)/);
});

test('set-survey: a thin /status cannot erase a count the phone has, and the count is fetched before the camera opens', () => {
  const survey = read('js/features/set-survey.js');
  assert.match(survey, /countHint/);
  assert.match(survey, /async function ensureBayCount/);
  // Both entry points wait for it.
  const camera = survey.slice(survey.indexOf('async function startSequentialCapture'), survey.indexOf('async function startSequentialCapture') + 700);
  assert.match(camera, /await ensureBayCount\(\)/);
  const picker = survey.slice(survey.indexOf('async function openAssignAndEnqueue'), survey.indexOf('async function openAssignAndEnqueue') + 700);
  assert.match(picker, /await ensureBayCount\(\)/);
});

test('set-survey: no phone-only hold; the count question is optional', () => {
  const survey = read('js/features/set-survey.js');
  const pipe = read('js/lib/photo-pipeline.js');
  assert.doesNotMatch(survey, /holdUpload|releaseHeld/);
  assert.doesNotMatch(pipe, /holdUpload|releaseHeld/);
  assert.match(survey, /How many bays does this set have\?/);
  assert.match(survey, /data-count-ask-skip/);
});

test('set-survey: the bay-override save sends the day-confirm header and shows the old count on failure', () => {
  const survey = read('js/features/set-survey.js');
  const save = survey.slice(survey.indexOf('async function saveBayOverride'), survey.indexOf('function paintStatus'));
  assert.match(save, /global\.EodApi\.dayConfirmHeaders\(/);
  assert.doesNotMatch(save, /headers: \{ 'Content-Type': 'application\/json' \}/);
  assert.doesNotMatch(save.slice(0, save.indexOf('authFetch')), /local\.bayOverride =/);
  assert.match(save, /Bay count not saved/);
});
