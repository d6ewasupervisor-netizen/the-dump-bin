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

test('idle card shows the shift lead name and email', () => {
  const html = L.cardHtml('idle', { connected: false }, false, {
    lead: { name: 'James Duchene', email: 'james.duchene@retailodyssey.com' },
  });
  assert.match(html, /James Duchene/);
  assert.match(html, /james\.duchene@retailodyssey\.com/);
  assert.match(html, /No saved login yet/);
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

test('form prefills the lead email and names the lead', () => {
  const html = L.cardHtml('form', { hasPattern: true }, false, {
    lead: { name: 'James Duchene', email: 'james.duchene@retailodyssey.com', hasCreds: true },
    defaults: { username: 'james.duchene@retailodyssey.com', siUsername: 'james.duchene@retailodyssey.com' },
  });
  assert.match(html, /James Duchene/);
  assert.match(html, /value="james\.duchene@retailodyssey\.com"/);
  assert.match(html, /Set OTP/);
  assert.match(html, /Supervisor takeover/);
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

test('handoff view takes a one-time 6-digit code', () => {
  const html = L.cardHtml('handoff', {}, false, {
    lead: { name: 'James Duchene', email: 'james.duchene@retailodyssey.com' },
  });
  assert.match(html, /handoff code/);
  assert.match(html, /Use code once/);
  assert.equal(L.bannedCopy(html), false);
});

test('master views never carry credential fields', () => {
  const takeOver = L.cardHtml('master', {}, false, {
    lead: { name: 'James Duchene', email: 'james.duchene@retailodyssey.com' },
  });
  assert.match(takeOver, /Master pattern/);
  assert.match(takeOver, /Take over login/);
  assert.doesNotMatch(takeOver, /sasUserPassword/);
  assert.doesNotMatch(takeOver, /sasUserTotp/);
  const setup = L.cardHtml('masterSetup', {}, false, {});
  assert.match(setup, /data-pattern="masterSet"/);
  assert.match(setup, /data-pattern="masterConfirm"/);
  assert.equal(L.bannedCopy(takeOver + setup), false);
});
