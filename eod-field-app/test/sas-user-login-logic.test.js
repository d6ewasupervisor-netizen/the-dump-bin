'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('../js/lib/sas-user-login-logic');

test('idle card is a reporting-systems login button, not a SAS + SI status', () => {
  const html = L.cardHtml('idle', { connected: true, sharedActor: true });
  assert.match(html, /Login to the reporting systems/);
  assert.equal(L.bannedCopy(html), false);
  assert.doesNotMatch(html, /Your SAS \+ SI/);
  assert.doesNotMatch(html, /office SAS/);
});

test('first login opens the credential form with pattern confirm', () => {
  assert.equal(L.openMode({ hasCreds: false, hasPattern: false }), 'form');
  const html = L.cardHtml('form', { hasPattern: false });
  assert.match(html, /Username/);
  assert.match(html, /Password/);
  assert.match(html, /Authenticator secret/);
  assert.match(html, /data-pattern="set"/);
  assert.match(html, /data-pattern="confirm"/);
  assert.equal(L.bannedCopy(html), false);
});

test('office login still opens the credential form, not a status card', () => {
  assert.equal(L.openMode({ hasCreds: true, hasPattern: true, sharedActor: true }), 'form');
});

test('later visits unlock with the stored pattern', () => {
  assert.equal(L.openMode({ hasCreds: true, hasPattern: true }), 'unlock');
  const html = L.cardHtml('unlock', { hasPattern: true, hasCreds: true });
  assert.match(html, /data-pattern="unlock"/);
  assert.match(html, /Unlock/);
  assert.doesNotMatch(html, /Your SAS \+ SI/);
});
