'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadFlush(extra) {
  const ctx = {
    console,
    Blob,
    fetch: extra?.fetch,
    EodPhotoPipeline: extra?.pipeline,
    EodSetBeforeStore: extra?.store,
    EodSession: extra?.session,
    EodStoreProdWarm: extra?.warm,
  };
  ctx.window = ctx;
  ctx.globalThis = ctx;
  vm.runInNewContext(
    fs.readFileSync(path.join(__dirname, '../js/lib/device-photo-flush.js'), 'utf8'),
    ctx
  );
  return ctx.EodDevicePhotoFlush;
}

test('on-device afters enqueue themselves; already-on-PROD bays do not', async () => {
  const enqueued = [];
  const flush = loadFlush({
    pipeline: {
      enqueue(job) { enqueued.push(job); return job; },
      jobsForSet() { return []; },
    },
  });
  const n = await flush.flushSet({
    dbkey: '9459248',
    rowId: 'row-1',
    after: [
      { bay: 1, dataUrl: 'data:image/jpeg;base64,aaa', uploadStatus: 'on device' },
      { bay: 2, preview: 'data:image/jpeg;base64,bbb', uploadStatus: 'queued' },
    ],
    before: [
      { bay: 1, dataUrl: 'data:image/jpeg;base64,ccc', uploadStatus: 'on device' },
    ],
    status: {
      remotePhotos: { prodBefore: [{ bay: 1 }], prodAfter: [], si: [] },
      prod: { visitId: '27295837' },
    },
  });
  assert.equal(n, 2);
  assert.deepEqual(enqueued.map((j) => `${j.slot}:${j.bay}`), ['after:1', 'after:2']);
  assert.equal(enqueued[0].visitId, '27295837');
  assert.equal(enqueued[0].skipSi, false);
});

test('blob: previews become File payloads', async () => {
  const enqueued = [];
  const flush = loadFlush({
    fetch: async () => ({ blob: async () => new Blob(['photo'], { type: 'image/jpeg' }) }),
    pipeline: {
      enqueue(job) { enqueued.push(job); return job; },
      jobsForSet() { return []; },
    },
  });
  const n = await flush.flushSet({
    dbkey: '123',
    after: [{ bay: 3, preview: 'blob:https://the-dump-bin.com/abc' }],
  });
  assert.equal(n, 1);
  assert.ok(enqueued[0].file);
  assert.equal(enqueued[0].dataUrl, null);
});

test('flushStoreWeek walks every persisted dbkey', async () => {
  const enqueued = [];
  const flush = loadFlush({
    pipeline: {
      enqueue(job) { enqueued.push(job); return job; },
      jobsForSet() { return []; },
    },
    store: {
      listSets() {
        return [
          { dbkey: '111', before: [], after: [{ bay: 1, dataUrl: 'data:image/jpeg;base64,x' }] },
          { dbkey: '222', before: [], after: [{ bay: 1, dataUrl: 'data:image/jpeg;base64,y' }] },
        ];
      },
    },
  });
  const n = await flush.flushStoreWeek('53', 'P08W4');
  assert.equal(n, 2);
  assert.deepEqual(enqueued.map((j) => j.dbkey), ['111', '222']);
});
