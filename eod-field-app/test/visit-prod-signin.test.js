'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const visit = fs.readFileSync(path.join(__dirname, '..', 'js', 'features', 'visit.js'), 'utf8');
const chrome = fs.readFileSync(path.join(__dirname, '..', 'js', 'chrome.js'), 'utf8');
const login = fs.readFileSync(path.join(__dirname, '..', 'js', 'features', 'sas-user-login.js'), 'utf8');

test('the PROD sign-in sheet opens before store and date', () => {
  const open = visit.indexOf('async function openDayConfirmModal');
  const show = visit.indexOf('async function showDayConfirmModal');
  assert.ok(open > 0 && show > open);
  const body = visit.slice(open, show);
  assert.match(body, /await shouldPromptProdSignIn\(\)/);
  assert.match(body, /await promptProdSignIn\(\)/);
  assert.ok(body.indexOf('promptProdSignIn()') < body.indexOf('showDayConfirmModal(options)'));
});

test('sign-in never blocks the visit', () => {
  assert.match(visit, /Number\(d\.failures\) > 2/);
  assert.match(visit, /status\.sharedActor\) return false/);
  assert.match(visit, /withTimeoutValue\(global\.EodSasUser\.fetchStatus\(true\), 4000, null\)/);
  assert.match(visit, /if \(!status\) return false/);
  assert.match(chrome, /options\.onClose\?\.\(\)/);
  assert.match(chrome, /return \{ close, host \}/);
});

test('each sign-in attempt reports its result', () => {
  assert.match(login, /new CustomEvent\('eod-sas-signin'/);
  assert.match(login, /noteSignInResult\(false\)/);
  assert.match(login, /noteSignInResult\(true\)/);
});
