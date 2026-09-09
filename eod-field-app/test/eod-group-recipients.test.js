'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const send = fs.readFileSync(
  path.join(__dirname, '..', 'js', 'features', 'send.js'),
  'utf8',
);

test('pilot sends saved Fred Meyer addresses plus lead-added recipients', () => {
  assert.match(send, /S\.state\.fredmeyerEmailPool \|\| \[\]/);
  assert.match(send, /S\.state\.emailRecipients \|\| \[\]/);
  assert.match(send, /hasFredMeyerTeam/);
  assert.match(send, /if \(!hasFredMeyerTeam && userEmail\)/);
});

test('Retail Odyssey group delivery is server-managed and cannot be unchecked', () => {
  assert.doesNotMatch(send, /id="addRetailOdysseyTeam"/);
  assert.doesNotMatch(send, /retailOdysseyTeamEmailsForStore/);
});
