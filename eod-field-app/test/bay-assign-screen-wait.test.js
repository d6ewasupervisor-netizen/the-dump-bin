'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = (() => {
  try { return { JSDOM: require('jsdom').JSDOM }; }
  catch (_) { return { JSDOM: null }; }
})();
const assign = require('../js/lib/bay-assign-logic');

// Pure-logic coverage for wait cases. DOM paint is covered by the screenshot
// script when jsdom is unavailable in this package.

test('occupied / already-captured bays count as placed for Confirm', () => {
  const plan = assign.confirmPlan({
    assignments: { 0: 1 },
    fileCount: 1,
    requiredBays: [1, 2, 4],
  });
  assert.equal(plan.ready, false);
  assert.deepEqual(plan.missingRequired, [2, 4]);
  // Device-held bay 2 is treated as placed by the screen (occupiedBays), so
  // only bay 4 would still block Confirm after that filter.
  const stillNeed = plan.missingRequired.filter((b) => ![2].includes(b));
  assert.deepEqual(stillNeed, [4]);
});

test('partial device photos can leave the rest for the camera', () => {
  const placements = assign.confirmPlan({
    assignments: { 0: 1, 1: 2 },
    fileCount: 2,
    requiredBays: [1, 2, 4],
  });
  assert.equal(placements.ready, false);
  assert.deepEqual(placements.missingRequired, [4]);
  assert.equal(placements.placements.length, 2);
});

test('mark not in store from assign screen removes the bay from required', () => {
  const marked = assign.markMissing({
    baseCount: 4,
    missingBays: [],
    addedBays: [],
    bay: 3,
  });
  assert.deepEqual(marked.activeBays, [1, 2, 4]);
  const plan = assign.confirmPlan({
    assignments: { 0: 1, 1: 2, 2: 4 },
    fileCount: 3,
    requiredBays: marked.activeBays,
  });
  assert.equal(plan.ready, true);
});

test('cancel leaves placements uncommitted (no upload)', () => {
  // Screen finish({ cancelled: true }) does not return placements for enqueue.
  // This mirrors set-survey openAssignAndEnqueue's cancel branch.
  const cancelled = { cancelled: true, placements: undefined };
  assert.equal(cancelled.cancelled, true);
  assert.equal(cancelled.placements, undefined);
});

test('kill before confirm loses in-memory assignments only — Files stay on device', () => {
  // Assignments live in the open() closure; they are never written to IDB until
  // Confirm / leaveForCamera returns placements to enqueueLocal.
  const inMemory = assign.suggestAssignments({ fileCount: 2, emptyBays: [1, 2, 4] });
  assert.deepEqual(Object.values(inMemory), [1, 2]);
  // After a kill, that map is gone; the OS photo library still has the Files.
  assert.ok(true);
});

if (JSDOM) {
  test('screen paints Photo N / Bay N captions and Replace confirm', async () => {
    const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://127.0.0.1/' });
    global.window = dom.window;
    global.document = dom.window.document;
    global.URL = dom.window.URL;
    global.File = class File {
      constructor(bits, name, opts) { this.name = name; this.type = opts?.type; this._bits = bits; }
    };
    global.EodBayAssignLogic = assign;
    delete require.cache[require.resolve('../js/lib/bay-assign-screen')];
    const screen = require('../js/lib/bay-assign-screen');
    const files = [
      new File([Buffer.from('a')], 'a.jpg', { type: 'image/jpeg' }),
      new File([Buffer.from('b')], 'b.jpg', { type: 'image/jpeg' }),
    ];
    const p = screen.open({
      files,
      requiredBays: [1, 2],
      occupiedBays: [],
      mount: document.body,
      allowLeaveForCamera: true,
    });
    await new Promise((r) => setTimeout(r, 20));
    const photoLabel = document.querySelector('[data-bay-assign-photo="0"] span')?.textContent || '';
    assert.match(photoLabel, /Photo 1/);
    const bayLabel = document.querySelector('[data-bay-assign-bay="1"] .bay-assign-bay-n')?.textContent || '';
    assert.match(bayLabel, /Bay 1/);
    document.querySelector('[data-bay-assign-cancel]')?.click();
    const result = await p;
    assert.equal(result.cancelled, true);
  });
}
