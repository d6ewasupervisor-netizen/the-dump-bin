'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const send = fs.readFileSync(path.join(root, 'js/features/send.js'), 'utf8');

test('sent EOD opens the one-time PIN gate instead of sending again', () => {
  assert.match(send, /A one-time PIN is required to resend this EOD\./);
  assert.match(send, /\{ id: 'cancel', label: 'Cancel' \}/);
  assert.match(send, /\{ id: 'request', label: 'Request PIN', primary: true \}/);
  assert.match(send, /\{ id: 'enter', label: 'Enter PIN' \}/);
  assert.match(send, /if \(sendLock\?\.sent && !resendAuthorization\)/);
});

test('lead can request supervisor approval for the one-time PIN', () => {
  assert.match(send, /\/api\/eod\/resend-pin\/request/);
  assert.match(send, /if \(choice === 'request'\)/);
  assert.match(send, /PIN request was sent for supervisor approval/);
});

test('PIN verification is bound to the active store and work date', () => {
  assert.match(send, /\/api\/eod\/resend-pin\/verify/);
  assert.match(send, /storeNumber: S\.state\.storeNumber/);
  assert.match(send, /workDate: S\.state\.workDate/);
  assert.match(send, /resendAuthorization = data\.authorization/);
});

test('accepted authorization is sent once with the next EOD submission', () => {
  assert.match(send, /meta\.resendAuthorization = resendAuthorization/);
  assert.match(send, /resendAuthorization = null;\s*applySendLock/);
  assert.match(send, /This one-time PIN can only be used for this resend\./);
});

test('pilot version is bumped in lockstep', () => {
  const version = JSON.parse(fs.readFileSync(path.join(root, 'eod-version.json'), 'utf8')).version;
  assert.match(version, /^\d+\.\d+\.\d+$/);
  const versionPattern = new RegExp(version.replace(/\./g, '\\.'));
  for (const relative of [
    'index.html',
    'js/api.js',
    'js/boot.js',
    'js/lib/eod-buffering.js',
    'js/lib/barcode-scanner.js',
    'sw.js',
  ]) {
    assert.match(fs.readFileSync(path.join(root, relative), 'utf8'), versionPattern);
  }
});
