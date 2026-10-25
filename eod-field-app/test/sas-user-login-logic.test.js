'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('../js/lib/sas-user-login-logic');

test('crossed dots join the pattern so fast swipes match', () => {
  assert.equal(L.jumpMidpoint(0, 2), 1);
  assert.equal(L.jumpMidpoint(0, 8), 4);
  assert.equal(L.jumpMidpoint(2, 6), 4);
  assert.equal(L.jumpMidpoint(1, 7), 4);
  assert.equal(L.jumpMidpoint(0, 1), -1);
  assert.equal(L.jumpMidpoint(0, 4), -1);
  assert.equal(L.jumpMidpoint(3, 3), -1);
});

test('a signed-in account stays signed in on the card', () => {
  const html = L.cardHtml('idle', { connected: true, sharedActor: true });
  assert.match(html, /Signed in/);
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

// Credentials are step 1; the pattern boxes only exist on step 3. Tests that
// assert on pattern markup must say formStep: 'pattern' or they render step 1.
test('first login matches the reauth form: two Okta prompts and an optional Google Authenticator code', () => {
  assert.equal(L.openMode({ hasCreds: false, hasPattern: false }), 'form');
  assert.equal(L.openMode({ connected: true }), 'idle');
  const html = L.cardHtml('form', { hasPattern: false }, false, { formStep: 'sas' });
  assert.match(html, /Okta will send two prompts/);
  assert.match(html, /Approve both/);
  assert.match(html, /Okta username/);
  assert.match(html, /Password/);
  assert.match(html, /Google Authenticator/);
  assert.match(html, /leave blank for the two Okta prompts/);
  assert.match(html, /id="sasUserCode"/);
  assert.match(html, /class="sas-otp"/);
  assert.match(html, /inputmode="numeric"/);
  assert.match(html, /autocomplete="one-time-code"/);
  assert.doesNotMatch(html, /data-sas-code hidden/);
  assert.doesNotMatch(html, /data-sas-advanced/);
  assert.doesNotMatch(html, /data-sas="how-google"/);
  assert.doesNotMatch(html, /How to/);
  assert.doesNotMatch(html, /Approve a push on my phone/);
  assert.doesNotMatch(html, /advantagesolutions\.okta\.com/);
  assert.doesNotMatch(html, /First code/);
  assert.doesNotMatch(html, /Second code/);
  assert.doesNotMatch(html, /SI username/);
  assert.doesNotMatch(html, /class="err"/);
  assert.doesNotMatch(html, /data-pattern=/);
  assert.equal(L.bannedCopy(html), false);
});

test('first login: pattern step=set shows only the first pattern box', () => {
  const html = L.cardHtml('form', { hasPattern: false }, false, { formStep: 'pattern', patternStep: 'set' });
  assert.match(html, /data-pattern="set"/);
  // Confirm box must NOT appear yet — it only shows when step transitions to confirm
  assert.doesNotMatch(html, /data-pattern="confirm"/);
  assert.equal(L.bannedCopy(html), false);
});

test('first login: pattern step=confirm shows only the confirmation box', () => {
  const html = L.cardHtml('form', { hasPattern: false }, false, { formStep: 'pattern', patternStep: 'confirm' });
  assert.match(html, /data-pattern="confirm"/);
  assert.doesNotMatch(html, /data-pattern="set"/);
  assert.doesNotMatch(html, /data-pattern="confirm".*data-pattern="confirm"/); // no duplicate
  assert.equal(L.bannedCopy(html), false);
});

test('first login: pattern step=done shows checkmark and enables Save', () => {
  const html = L.cardHtml('form', { hasPattern: false }, false, { formStep: 'pattern', patternStep: 'done' });
  assert.match(html, /Pattern ready/);
  assert.doesNotMatch(html, /data-pattern="set"/);
  assert.doesNotMatch(html, /data-pattern="confirm"/);
  // Save button should be enabled (no disabled attr)
  assert.doesNotMatch(html, /data-sas="connect"[^>]*disabled/);
  assert.equal(L.bannedCopy(html), false);
});

test('pattern step default (no patternStep) shows the set box and Save disabled', () => {
  const html = L.cardHtml('form', { hasPattern: false }, false, { formStep: 'pattern' });
  assert.match(html, /data-pattern="set"/);
  assert.doesNotMatch(html, /data-pattern="confirm"/);
  // Save disabled until pattern confirmed
  assert.match(html, /data-sas="connect"[^>]*disabled/);
});

test('step 1 prefills the First.Last sign-in name and names the lead', () => {
  const html = L.cardHtml('form', { hasPattern: true }, false, {
    lead: { name: 'James Duchene', email: 'james.duchene@retailodyssey.com', hasCreds: true },
    defaults: { username: 'James.Duchene', siUsername: 'James.Duchene' },
    patternStep: 'set',
    formStep: 'sas',
  });
  assert.match(html, /James Duchene/);
  assert.match(html, /value="James\.Duchene"/);
  // Okta rejects the RO email for leads provisioned on another domain, and a
  // type="email" box would fight a bare first.last value.
  assert.doesNotMatch(html, /id="sasUserUsername"[^>]*type="email"/);
  assert.match(html, /two Okta prompts/);
  assert.doesNotMatch(html, /How to/);
  assert.equal(L.bannedCopy(html), false);
});

test('Set OTP lives on the pattern step, not the credential step', () => {
  const opts = {
    lead: { name: 'James Duchene', email: 'james.duchene@retailodyssey.com', hasCreds: true },
    defaults: { username: 'James.Duchene', siUsername: 'James.Duchene' },
    patternStep: 'set',
  };
  assert.doesNotMatch(L.cardHtml('form', { hasPattern: true }, false, { ...opts, formStep: 'sas' }), /Set OTP/);
  assert.match(L.cardHtml('form', { hasPattern: true }, false, { ...opts, formStep: 'pattern' }), /Set OTP/);
});

test('the shared office session does not ask for codes again', () => {
  assert.equal(L.openMode({ hasCreds: true, hasPattern: true, sharedActor: true }), 'idle');
});

test('a saved login that is not connected opens the code form', () => {
  assert.equal(L.openMode({ hasCreds: true, hasPattern: true }), 'form');
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

test('master unlock has one pattern box and auto-submit button', () => {
  const takeOver = L.cardHtml('master', {}, false, {
    lead: { name: 'James Duchene', email: 'james.duchene@retailodyssey.com' },
  });
  assert.match(takeOver, /Master pattern/);
  assert.match(takeOver, /Take over login/);
  assert.doesNotMatch(takeOver, /sasUserPassword/);
  assert.doesNotMatch(takeOver, /sasUserTotp/);
  assert.equal(L.bannedCopy(takeOver), false);
});

test('master setup: step=set shows only masterSet box', () => {
  const setup = L.cardHtml('masterSetup', {}, false, { masterStep: 'set' });
  assert.match(setup, /data-pattern="masterSet"/);
  assert.doesNotMatch(setup, /data-pattern="masterConfirm"/);
  assert.equal(L.bannedCopy(setup), false);
});

test('master setup: step=confirm shows only masterConfirm box', () => {
  const setup = L.cardHtml('masterSetup', {}, false, { masterStep: 'confirm' });
  assert.match(setup, /data-pattern="masterConfirm"/);
  assert.doesNotMatch(setup, /data-pattern="masterSet"/);
  assert.equal(L.bannedCopy(setup), false);
});

test('master setup: step=done shows checkmark and enables Save', () => {
  const setup = L.cardHtml('masterSetup', {}, false, { masterStep: 'done' });
  assert.match(setup, /Pattern ready/);
  assert.doesNotMatch(setup, /data-pattern="masterSet"/);
  assert.doesNotMatch(setup, /data-pattern="masterConfirm"/);
  assert.doesNotMatch(setup, /data-sas="master-save"[^>]*disabled/);
  assert.equal(L.bannedCopy(setup), false);
});

test('Visit does not mount a sign-in card', () => {
  const fs = require('fs');
  const path = require('path');
  const visit = fs.readFileSync(path.join(__dirname, '../js/features/visit.js'), 'utf8');
  assert.doesNotMatch(visit, /sasUserCard/);
  assert.doesNotMatch(visit, /EodSasUser\?\.mount/);
});

test('More has a persistent sign-in, and the header names who is signed in', () => {
  const fs = require('fs');
  const path = require('path');
  const chrome = fs.readFileSync(path.join(__dirname, '../js/chrome.js'), 'utf8');
  const index = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
  assert.match(chrome, /id="eodMoreSignIn"/);
  assert.match(chrome, /data-icon="sign-in"/);
  assert.match(chrome, /function paintNavIcons/);
  assert.match(chrome, /function openSignIn/);
  assert.match(chrome, /\[data-nav\], \[data-open-sign-in\]/);
  assert.match(index, /id="eodSignedIn"/);
  assert.match(index, /data-open-sign-in/);
});
