'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function source(relativePath) {
  return fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8');
}

test('cart captures target the main Kompass ISE maintenance slots', () => {
  const visit = source('js/features/visit.js');
  const send = source('js/features/send.js');
  const pipeline = source('js/lib/photo-pipeline.js');

  assert.match(visit, /function mainKompassIseVisit\(\)/);
  assert.match(visit, /const visitId = mainKompassIseVisit\(\)\.visitId;/);
  assert.match(visit, /visitId: mainKompassIseVisit\(\)\.visitId,/);
  assert.match(send, /pickMainKompassIseVisit/);
  assert.match(send, /visitId: mainIse\.visitId,/);
  assert.match(pipeline, /targetReset: 'MAINTENANCE'/);
  assert.match(pipeline, /slot,/);
  assert.match(pipeline, /status === 'completed'/);
});

test('EOD cover and digital signoff pages upload to maintenance after photos', () => {
  const sheets = source('js/lib/eod-send-sheets.js');

  assert.match(sheets, /source: 'coversheet'/);
  assert.match(sheets, /source: 'digital-signoff'/);
  assert.match(sheets, /slot: 'after'/);
  assert.match(sheets, /targetReset: 'MAINTENANCE'/);
  assert.match(sheets, /pickMainKompassIseVisit/);
  assert.match(sheets, /no-ise-visit/);
});
