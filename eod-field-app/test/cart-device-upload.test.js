'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const send = fs.readFileSync(
  path.join(__dirname, '..', 'js', 'features', 'send.js'),
  'utf8',
);

test('Send page can choose before and after cart photos from the device', () => {
  assert.match(send, /id="cartBeforeInput"/);
  assert.match(send, /id="cartAfterInput"/);
  assert.equal((send.match(/From device/g) || []).length, 2);
  assert.doesNotMatch(send, /capture="environment"\s+id="cart(?:Before|After)Input"/);
});

test('device files use the durable cart photo pipeline for either slot', () => {
  assert.match(send, /async function addCartFile\(slot, file\)/);
  assert.match(send, /compressType: slot,\s*slot,/);
  assert.match(send, /kind: `cart-\$\{slot\}`/);
  assert.match(send, /\[slot\]: \[\.\.\.existing, entry\]/);
  assert.match(send, /PhotoDB\?\.savePhotos/);
  assert.match(send, /refreshGates\(\)/);
});
