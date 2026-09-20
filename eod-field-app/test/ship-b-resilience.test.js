'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const logic = require('../js/lib/photo-pipeline-logic');
const root = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

test('queue copy reports moving numbers instead of a flat apology', () => {
  const flat = logic.QUEUE_COPY;

  assert.equal(logic.queueProgressCopy({ compress: 0, upload: 0 }), flat);
  assert.match(logic.queueProgressCopy({ compress: 0, upload: 3 }), /3 uploading/);
  assert.match(logic.queueProgressCopy({ compress: 2, upload: 0 }), /2 preparing/);

  const both = logic.queueProgressCopy({ compress: 2, upload: 5 });
  assert.match(both, /5 uploading/);
  assert.match(both, /2 preparing/);

  // One open photo and forty must not read identically.
  assert.notEqual(
    logic.queueProgressCopy({ compress: 0, upload: 1 }),
    logic.queueProgressCopy({ compress: 0, upload: 40 })
  );
});

test('the banner carries live counts while work is open', () => {
  const state = logic.queueBannerShouldShow({ open: 4, compress: 1, upload: 3 });
  assert.equal(state.show, true);
  assert.match(state.copy, /3 uploading/);
});

test('authFetch bounds every request and keeps caller cancellation distinct', () => {
  const api = read('js/api.js');

  assert.match(api, /READ_TIMEOUT_MS/);
  assert.match(api, /WRITE_TIMEOUT_MS/);
  assert.match(api, /new AbortController\(\)/);
  // A caller that brings its own signal must not get our timer on top of it.
  assert.match(api, /!pass\.signal/);
  // Writes need a longer ceiling than reads or photo uploads get cut off.
  const readMs = Number(/READ_TIMEOUT_MS = (\d+)/.exec(api)[1]);
  const writeMs = Number(/WRITE_TIMEOUT_MS = (\d+)/.exec(api)[1]);
  assert.ok(writeMs > readMs, 'write timeout must exceed read timeout');
  assert.ok(readMs >= 20000, 'read timeout must tolerate a slow store connection');

  // The pipeline retries on /timeout/i, so the message has to use that word.
  const timeoutMsg = /new Error\(`Request (\w+) after/.exec(api)[1];
  assert.ok(logic.isTransientUploadError(new Error(`Request ${timeoutMsg} after 30s`)),
    'a timeout must classify as transient so the upload retries');
});

test('Categories paints the saved copy before it asks the network', () => {
  const signoff = read('js/features/signoff-home.js');

  // Offline pre-paint must run before the network paint.
  assert.match(signoff, /paint\(\{ offline: true \}\)/);
  assert.ok(
    signoff.indexOf('await paint({ offline: true })') < signoff.lastIndexOf('await paint();'),
    'the saved copy must be painted before the refreshing paint'
  );
  // A failed refresh keeps the rows and offers a retry.
  assert.match(signoff, /staleReason/);
  assert.match(signoff, /sheetLoadRetry/);
  assert.match(signoff, /saved copy/);
  // Queued offline marks have to be visible.
  assert.match(signoff, /not sent/);
});

test('the Categories poller cannot stack across visits', () => {
  const signoff = read('js/features/signoff-home.js');
  const moduleScope = signoff.slice(0, signoff.indexOf('async function render('));
  assert.match(moduleScope, /let pollTimer = null;/,
    'pollTimer must live outside render() so each visit clears the last one');
  assert.doesNotMatch(
    signoff.slice(signoff.indexOf('async function render(')),
    /let pollTimer/,
    'render() must not shadow pollTimer'
  );
});

test('search is debounced and the dead Complete path is gone', () => {
  const signoff = read('js/features/signoff-home.js');
  assert.match(signoff, /searchTimer/);
  // Complete was dropped in 3.4.15; the helper that pretended to apply it
  // reported every row as a success while doing nothing.
  assert.doesNotMatch(signoff, /completeAllOpen/);
  assert.match(signoff, /markType === 'complete'\) return;/);
});

test('the Not in Store prompt loads its bundle instead of silently skipping', () => {
  const signoff = read('js/features/signoff-home.js');
  const boot = read('js/boot.js');

  assert.match(signoff, /async function nisReportChoice/);
  assert.match(signoff, /EodRouteBundles\?\.ensure\?\.\('helpdesk'\)/);
  // No call site may gate on the bare typeof check any more.
  assert.doesNotMatch(signoff, /if \(markType === 'not_in_store' && typeof global\.askToReportNotInStore/);
  assert.doesNotMatch(signoff, /turningOnNis && nisChoice == null && typeof global\.askToReportNotInStore/);
  assert.match(boot, /prefetchIdle\?\.\(\['survey', 'send', 'helpdesk'\]\)/);
});
