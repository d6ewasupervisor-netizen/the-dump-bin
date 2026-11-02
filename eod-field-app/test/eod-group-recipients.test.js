'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const send = fs.readFileSync(
  path.join(__dirname, '..', 'js', 'features', 'send.js'),
  'utf8',
);

test('pilot sends only checked verified Fred Meyer addresses', () => {
  assert.match(send, /verifiedRecipients/);
  assert.match(send, /hasFredMeyerTeam/);
  assert.match(send, /if \(!hasFredMeyerTeam && userEmail\)/);
  assert.doesNotMatch(send, /\.\.\.\(S\.state\.fredmeyerEmailPool/);
  assert.match(send, /Sending to /);
  assert.match(send, /Remove from store/);
  assert.match(send, /pendingRecipients/);
});

test('contacts waiting for assignment are not offered as Keep or Remove and do not block send', () => {
  assert.match(send, /contacts on this store are waiting for supervisor assignment/);
  assert.match(send, /needsAssignmentEmails/);
  assert.doesNotMatch(send, /needsAssignmentEmails[\s\S]{0,400}Add at least one email recipient/);
});

test('Retail Odyssey group delivery is server-managed and cannot be unchecked', () => {
  assert.doesNotMatch(send, /id="addRetailOdysseyTeam"/);
  assert.doesNotMatch(send, /retailOdysseyTeamEmailsForStore/);
});
