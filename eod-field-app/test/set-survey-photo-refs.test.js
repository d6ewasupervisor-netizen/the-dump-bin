'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadPhotoRefs() {
  const ctx = {
    console,
    URL,
    EodApi: { escapeHtml: (value) => String(value ?? '') },
    EodRouter: { register() {} },
  };
  ctx.window = ctx;
  ctx.globalThis = ctx;
  vm.runInNewContext(
    fs.readFileSync(path.join(__dirname, '../js/features/set-survey.js'), 'utf8'),
    ctx
  );
  return ctx.EodSetSurveyPhotoRefs;
}

test('raw PROD photo metadata is viewed through the authenticated EOD image route', () => {
  const refs = loadPhotoRefs();
  const photo = refs.ownedRemotePhoto({
    bay: 2,
    id: 82179116,
    source: 'prod',
    url: 'https://djttbrw0ufia8.cloudfront.net/media/after_store53_bay1.jpg',
  }, { rowId: 9175, slot: 'after' });

  assert.equal(photo.bayIndex, 2);
  assert.equal(
    photo.url,
    'https://eod-api.the-dump-bin.com/api/digital-signoffs/rows/9175/photos/prod/82179116/image'
  );
  assert.equal(photo.thumbUrl, `${photo.url}?thumb=1`);
});

test('stale server metadata in the device store keeps its bay and gets viewable URLs', () => {
  const refs = loadPhotoRefs();
  const photo = refs.storedPhoto({
    bayIndex: 3,
    id: 'after-bay-3',
    source: 'si',
    url: 'https://provider.example/photo.jpg',
    thumbUrl: 'https://provider.example/thumb.jpg',
  }, { rowId: 42, slot: 'after', fallbackName: 'after.jpg' });

  assert.equal(photo.bay, 3);
  assert.equal(
    photo.url,
    'https://eod-api.the-dump-bin.com/api/digital-signoffs/rows/42/photos/si/after-bay-3/image'
  );
  assert.equal(photo.thumbUrl, `${photo.url}?thumb=1`);
  assert.equal(photo.preview, photo.thumbUrl);
  assert.equal(photo.photoBase64, null);
});

test('on-device data photos stay directly viewable', () => {
  const refs = loadPhotoRefs();
  const dataUrl = 'data:image/jpeg;base64,YWJj';
  const photo = refs.storedPhoto(
    { bay: 1, dataUrl, uploadStatus: 'queued' },
    { rowId: 42, slot: 'after' }
  );

  assert.equal(photo.preview, dataUrl);
  assert.equal(photo.photoBase64, dataUrl);
  assert.equal(photo.url, dataUrl);
});

test('board placeholders persist without keeping the local JPEG', () => {
  const refs = loadPhotoRefs();
  const rec = refs.deviceStoreRecord({
    bay: 2,
    url: 'https://eod-api.the-dump-bin.com/api/digital-signoffs/rows/9175/photos/prod/before-bay-2/image',
    thumbUrl: 'https://eod-api.the-dump-bin.com/api/digital-signoffs/rows/9175/photos/prod/before-bay-2/image?thumb=1',
    photoBase64: 'data:image/jpeg;base64,YWJj',
    offloaded: true,
    source: 'prod',
    id: 'before-bay-2',
    uploadStatus: 'done',
  }, { workDate: '2026-09-11' });
  assert.equal(rec.dataUrl, undefined);
  assert.match(rec.url, /\/photos\/prod\/before-bay-2\/image$/);
  assert.equal(rec.offloaded, true);

  const photo = refs.storedPhoto(rec, { rowId: 9175, slot: 'before' });
  assert.equal(photo.photoBase64, null);
  assert.equal(photo.offloaded, true);
  assert.equal(photo.preview, rec.thumbUrl);
});

test('selected set photos keep the device file order for bay assignment', () => {
  const refs = loadPhotoRefs();
  const files = [
    { name: 'bay-1.jpg' },
    { name: 'bay-2.jpg' },
    { name: 'bay-3.jpg' },
    { name: 'bay-4.jpg' },
    { name: 'bay-5.jpg' },
  ];
  assert.equal(
    refs.selectedFilesInOrder(files).map((file) => file.name).join(','),
    files.map((file) => file.name).join(',')
  );
});
