'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const bay = require('../js/lib/bay-count-logic');
const root = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

test('an unresolved count is null, never a guess of 1', () => {
  // seedFromSheetRow's shape before /status answers: no count, empty bays.
  assert.equal(bay.knownBayCount({ expectedBayCount: null, bays: [], si: { sectionCount: 0 } }), null);
  assert.equal(bay.knownBayCount({}), null);
  assert.equal(bay.knownBayCount(null), null);
  assert.equal(bay.knownBayCount(undefined), null);
});

test('SI sections are the source of truth for how many photos a set takes', () => {
  assert.equal(bay.knownBayCount({ si: { sectionCount: 8 } }), 8);
  assert.equal(bay.knownBayCount({ expectedBayCount: 8 }), 8);
  assert.equal(bay.knownBayCount({ bays: [1, 2, 3, 4] }), 4);
  // An explicit count wins over a partial bays array.
  assert.equal(bay.knownBayCount({ expectedBayCount: 8, bays: [1, 2] }), 8);
  assert.equal(bay.knownBayCount({ planogramBayCount: 6 }), 6);
  assert.equal(bay.knownBayCount({ planogram: { bays: [{}, {}, {}] } }), 3);
  // A stale warm "1" must not beat the planogram / SI count.
  assert.equal(bay.knownBayCount({ expectedBayCount: 1, planogramBayCount: 6 }), 6);
  assert.equal(bay.knownBayCount({ expectedBayCount: 1, si: { sectionCount: 8 } }), 8);
  assert.equal(bay.knownBayCount({ expectedBayCount: 1 }), 1);
});

test('footage is never mistaken for a bay count', () => {
  // 32 linear feet at 4ft bays is 8 photos, and resolving that is the
  // server's job. Nothing footage-shaped may leak through as a count.
  assert.equal(bay.knownBayCount({ footage: 32, footageDisplay: '32 ft' }), null);
  assert.equal(bay.knownBayCount({ expectedBayCount: 0, footage: 32 }), null);
  const logic = read('js/lib/bay-count-logic.js');
  const fn = logic.slice(logic.indexOf('function knownBayCount'), logic.indexOf('function displayBayCount'));
  assert.doesNotMatch(fn, /footage|feet|linear/i,
    'knownBayCount must not read any footage field; feet resolve server-side');
});

test('loading eight photos into an unresolved set enqueues eight, not one', () => {
  // The exact field failure: eight files picked, count not yet resolved.
  const bays = bay.planFileBays({ known: null, taken: new Set(), fileCount: 8 });
  assert.equal(bays.length, 8, 'every file must get a bay');
  assert.deepEqual(bays, [1, 2, 3, 4, 5, 6, 7, 8]);
});

test('loaded files fill the empty bays in order', () => {
  assert.deepEqual(bay.planFileBays({ known: 8, taken: new Set(), fileCount: 8 }), [1, 2, 3, 4, 5, 6, 7, 8]);
  // Bays 1-3 already shot: the next three files continue at 4.
  assert.deepEqual(bay.planFileBays({ known: 8, taken: new Set([1, 2, 3]), fileCount: 3 }), [4, 5, 6]);
  // More files than empty bays: clamp to the set's real size.
  assert.deepEqual(bay.planFileBays({ known: 4, taken: new Set(), fileCount: 9 }), [1, 2, 3, 4]);
});

test('replace rewrites bays in order and does not drop the tail when unresolved', () => {
  assert.deepEqual(bay.planReplaceBays({ known: 8, fileCount: 8 }), [1, 2, 3, 4, 5, 6, 7, 8]);
  assert.deepEqual(bay.planReplaceBays({ known: 4, fileCount: 9 }), [1, 2, 3, 4]);
  assert.deepEqual(bay.planReplaceBays({ known: null, fileCount: 6 }), [1, 2, 3, 4, 5, 6]);
  assert.deepEqual(bay.planReplaceBays({ known: 8, fileCount: 0 }), []);
});

test('a set never takes more bays than it has', () => {
  assert.equal(bay.refuseBayReason({ known: 8, bay: 8 }), null);
  assert.equal(bay.refuseBayReason({ known: 8, bay: 9 }), 'over');
  // Replace is allowed to address a bay explicitly.
  assert.equal(bay.refuseBayReason({ known: 8, bay: 9, replacing: true }), null);
  // Unknown count cannot be used to refuse a legitimate capture.
  assert.equal(bay.refuseBayReason({ known: null, bay: 9 }), null);
});

test('a full set refuses rather than overwriting bay 1', () => {
  // nextEmptyBay returns null on a full set; the old code fell through to 1.
  assert.equal(bay.refuseBayReason({ known: 8, bay: 0 }), 'full');
  assert.equal(bay.refuseBayReason({ known: null, bay: 0 }), 'full');
});

test('the display count never reports fewer bays than are already shot', () => {
  assert.equal(bay.displayBayCount({ si: { sectionCount: 8 } }, []), 8);
  // Unresolved but five photos on device: show five, not one.
  assert.equal(bay.displayBayCount({}, [{ bay: 1 }, { bay: 5 }]), 5);
  assert.equal(bay.displayBayCount({}, []), 1);
  assert.equal(bay.displayBayCount({ bays: [1, 2, 3] }, []), 3);
});

test('set-survey routes every count decision through the shared rules', () => {
  const survey = read('js/features/set-survey.js');
  const bundles = read('js/lib/route-bundles.js');

  // The lying helper is gone entirely so it cannot be reintroduced.
  assert.doesNotMatch(survey, /function expectedBayCount\(\)/);
  assert.doesNotMatch(survey, /expectedBayCount\(\)/);

  // Payloads must send null when unresolved: the server auto-closes a set
  // once bay >= expectedBayCount.
  const payloads = survey.match(/expectedBayCount: knownBayCount\(\)/g) || [];
  assert.equal(payloads.length, 2, 'both upload payloads send the honest count');

  // Auto-close must refuse on an unknown count.
  const autoClose = survey.slice(survey.indexOf('async function maybeAutoCloseSi'));
  assert.match(autoClose.slice(0, 400), /const n = knownBayCount\(\);\s*\n\s*if \(!n\) return null;/);

  // Capture must not stop early on an unknown count.
  assert.match(survey, /if \(fromOne\) return !total \|\| sessionBay < total;/);

  // After extras must not wrap onto bay 1 of the open set.
  assert.match(survey, /String\(slot\) === 'after' && !replacing/);
  assert.match(survey, /if \(!bay\) return null;/);
  assert.match(survey, /incoming\.length === 0 && prev\.length > 0 && keepBays\.size === 0/);
  assert.match(survey, /destroyLeftoverCameras/);

  assert.match(bundles, /'js\/lib\/bay-count-logic\.js',\s*\n\s*'js\/features\/set-survey\.js'/);
});
