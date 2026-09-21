'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

test('before photos are keyed by week, not by day, so they survive to the revisit', () => {
  const store = read('js/features/set-before-store.js');

  // Monday's befores must still be on the device Wednesday for a backlog
  // revisit, so the bucket key must not contain a date.
  assert.match(store, /return `\$\{prefix \|\| PREFIX\}\$\{s\}:\$\{w\}`;/);
  const key = store.slice(store.indexOf('function storageKey'), store.indexOf('function loadAll'));
  assert.doesNotMatch(key, /workDate|date/i, 'the bucket key must be store + fiscal week only');

  // Nothing may expire the bucket on a timer.
  assert.doesNotMatch(store, /MAX_AGE|setTimeout|setInterval|maxAgeMs/);
});

test('only an explicit wipe clears the week bucket', () => {
  const session = read('js/session.js');
  const line = session.split('\n').find((l) => l.includes('clearStoreWeek'));
  assert.ok(line, 'clearStoreWeek must still be reachable');
  // It has to sit behind the opt-in flag, never fire on a routine reset.
  const reset = session.slice(session.indexOf('async function resetVisit'));
  assert.match(reset, /if \(wipeSetBefores && global\.EodSetBeforeStore\) \{/);
  assert.ok(
    reset.indexOf('wipeSetBefores && global.EodSetBeforeStore') < reset.indexOf('clearStoreWeek'),
    'clearStoreWeek must be guarded by wipeSetBefores'
  );
});

test('the reconcile lane carries device-store befores forward without a date filter', () => {
  const rec = read('js/lib/set-photo-reconcile.js');
  const manifest = rec.slice(rec.indexOf('async function collectDeviceManifest'), rec.indexOf('async function collectDevicePhotos'));

  const localBranch = manifest.slice(manifest.indexOf('EodSetBeforeStore?.listSets'), manifest.indexOf('EodPhotoPipeline?.listJobs'));
  // Scoped to store + week so Monday's befores are still offered on Wednesday.
  assert.match(localBranch, /listSets\?\.\(store, week\)/);
  assert.doesNotMatch(localBranch, /workDate/, 'the device-store branch must not filter by day');

  // The pipeline-job branch is the one that must be day-scoped: a stale job
  // would otherwise be re-posted under today's date as a fresh capture.
  const jobBranch = manifest.slice(manifest.indexOf('EodPhotoPipeline?.listJobs'));
  assert.match(jobBranch, /String\(job\.workDate\) !== String\(S\.state\.workDate\)/);

  // Device store is collected first, and `seen` dedupes, so the carried-forward
  // copy wins over any same-bay pipeline job.
  assert.ok(
    manifest.indexOf('EodSetBeforeStore?.listSets') < manifest.indexOf('EodPhotoPipeline?.listJobs'),
    'device store must take precedence'
  );
  assert.match(manifest, /if \(!dbkey \|\| !bay \|\| seen\.has\(key\)\) return;/);
});

test('a full device prunes dead weeks and retries before losing the carry-forward', () => {
  const store = read('js/features/set-before-store.js');

  assert.match(store, /function pruneStaleWeeks/);
  // Only earlier weeks go: a lead can work two stores inside one week.
  assert.match(store, /if \(week && week !== keep\) doomed\.push\(k\);/);

  const saveAll = store.slice(store.indexOf('function saveAll'), store.indexOf('function dbkeyKey'));
  assert.match(saveAll, /pruneStaleWeeks\(fiscalWeek\)/);
  assert.match(saveAll, /EodDiag\?\.note\?\.\('set-store\.quota'/);
  // It must rethrow, or the caller cannot tell the crew.
  assert.match(saveAll, /throw err;/);
});

test('a failed carry-forward write is reported instead of swallowed', () => {
  const survey = read('js/features/set-survey.js');
  const chrome = read('js/chrome.js');

  const persist = survey.slice(survey.indexOf('function persistSlot'), survey.indexOf('function persistBefores'));
  assert.doesNotMatch(persist, /\} catch \(_\) \{\}/, 'persistSlot must not swallow');
  assert.match(persist, /EodDiag\?\.note\?\.\('set-store\.persist'/);
  assert.match(persist, /Device storage is full/);

  assert.match(chrome, /set-store\.quota/);
  assert.match(chrome, /storage full/);
});
