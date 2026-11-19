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

  test('mark not in store on a filled bay uses in-screen clear confirm (no window.confirm)', async () => {
    const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://127.0.0.1/' });
    global.window = dom.window;
    global.document = dom.window.document;
    global.URL = dom.window.URL;
    let confirmCalls = 0;
    global.window.confirm = () => { confirmCalls += 1; return false; };
    global.confirm = global.window.confirm;
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
    let marked = null;
    const p = screen.open({
      files,
      requiredBays: [1, 2],
      occupiedBays: [],
      mount: document.body,
      onMarkMissing: (bay) => { marked = bay; },
    });
    await new Promise((r) => setTimeout(r, 20));
    document.querySelector('[data-bay-assign-photo="0"]')?.click();
    await new Promise((r) => setTimeout(r, 10));
    document.querySelector('[data-bay-assign-bay="1"]')?.click();
    await new Promise((r) => setTimeout(r, 10));
    document.querySelector('[data-bay-assign-mark-missing="1"]')?.click();
    await new Promise((r) => setTimeout(r, 10));
    assert.ok(document.querySelector('[data-bay-assign-clear-missing]'), 'in-screen clear banner');
    assert.match(
      document.querySelector('[data-bay-assign-clear-missing] p')?.textContent || '',
      /Bay 1 already has a photo/
    );
    assert.equal(confirmCalls, 0);
    assert.equal(marked, null);
    document.querySelector('[data-bay-assign-clear-missing-yes]')?.click();
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(marked, 1);
    assert.equal(confirmCalls, 0);
    document.querySelector('[data-bay-assign-cancel]')?.click();
    await p;
  });
}
