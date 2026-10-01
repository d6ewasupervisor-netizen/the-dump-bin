'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('../js/lib/team-photo-store');

test('team store kinds stay off the PIC board', () => {
  assert.equal(L.normalizeKind('cart-before'), 'before');
  assert.equal(L.normalizeKind('cart', 'after'), 'after');
  assert.equal(L.normalizeKind('context'), 'context');
  assert.equal(L.normalizeKind('set'), '');
  assert.equal(L.isTeamUrl('/api/field-session/photos/before/cart-1/image?store=682&date=2026-09-11'), true);
  assert.equal(L.isTeamUrl('/api/digital-signoffs/rows/1/photos/prod/9/image'), false);
});

test('queued cart preview blob is not treated as email bytes until stamped', () => {
  const entry = {
    dataUrl: 'blob:https://the-dump-bin.com/cart-before',
    previewUrl: 'blob:https://the-dump-bin.com/cart-before',
    jobId: 'job-1',
  };
  assert.deepEqual(L.blobPhotoSrcs(entry), ['blob:https://the-dump-bin.com/cart-before']);
  assert.equal(L.localDataUrl(entry), '');
  const fromJob = L.dataUrlForJob('job-1', [{
    id: 'job-1',
    dataUrl: 'data:image/jpeg;base64,abc',
  }]);
  assert.equal(L.rememberDataUrl(entry, fromJob), 'data:image/jpeg;base64,abc');
  assert.equal(entry.dataUrl, 'data:image/jpeg;base64,abc');
  assert.equal(L.rememberDataUrl(entry, 'blob:https://the-dump-bin.com/nope'), '');
});

test('applyPointer drops local bytes and keeps the Railway pointer', () => {
  const next = L.applyPointer(
    { dataUrl: 'data:image/jpeg;base64,abc', kind: 'cart-before' },
    {
      url: '/api/field-session/photos/before/before-1/image?store=682&date=2026-09-11',
      thumbUrl: '/api/field-session/photos/before/before-1/image?store=682&date=2026-09-11&thumb=1',
      photoId: 'before-1',
      kind: 'before',
    }
  );
  assert.equal(next.offloaded, true);
  assert.equal(next.teamUrl.includes('/api/field-session/'), true);
  assert.equal(next.dataUrl, undefined);
  assert.equal(next.previewUrl, undefined);
});

test('mergeRemote hydrates a second device from Railway pointers', () => {
  const merged = L.mergeRemote([], [{
    kind: 'instawork',
    photoId: 'instawork-1',
    url: '/api/field-session/photos/instawork/instawork-1/image?store=682&date=2026-09-11',
    thumbUrl: '/api/field-session/photos/instawork/instawork-1/image?store=682&date=2026-09-11&thumb=1',
  }], 'instawork');
  assert.equal(merged.length, 1);
  assert.equal(merged[0].offloaded, true);
  assert.equal(merged[0].teamPhotoId, 'instawork-1');
});

test('needsUpload skips already-offloaded team photos', () => {
  assert.equal(L.needsUpload({ offloaded: true, teamUrl: '/api/field-session/photos/before/x/image' }), false);
  assert.equal(L.needsUpload({ dataUrl: 'data:image/jpeg;base64,abc' }), true);
});
