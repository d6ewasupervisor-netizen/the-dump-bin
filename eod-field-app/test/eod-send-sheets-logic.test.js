'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  isMainKompassIse,
  pickMainKompassIseVisit,
  classifySheetFilename,
  coversheetFilename,
  digitalSignoffFilename,
} = require('../js/lib/eod-send-sheets-logic');

test('main Kompass ISE is project 1, not Cut In / Blitz / DIV', () => {
  assert.equal(isMainKompassIse({ projectId: 1, projectName: 'Kompass ISE' }), true);
  assert.equal(isMainKompassIse({ kompassType: 'Kompass ISE' }), true);
  assert.equal(isMainKompassIse({ projectId: 1668, projectName: 'Cut In Kompass ISE' }), false);
  assert.equal(isMainKompassIse({ projectId: 1715, projectName: 'Blitz' }), false);
});

test('pickMainKompassIseVisit prefers ISE even when Cut In is selected', () => {
  const ise = { visitId: '111', projectId: 1, projectName: 'Kompass ISE', kompassType: 'Kompass ISE' };
  const cutIn = { visitId: '222', projectId: 1668, projectName: 'Cut In', kompassType: 'Cut In Kompass ISE' };
  assert.equal(pickMainKompassIseVisit([cutIn, ise], cutIn), ise);
  assert.equal(pickMainKompassIseVisit([cutIn, ise], ise), ise);
  assert.equal(pickMainKompassIseVisit([cutIn], cutIn), null);
});

test('sheet filenames classify coversheet vs digital vs paper', () => {
  assert.equal(classifySheetFilename('fm019_eod_coversheet_20260824.jpg'), 'coversheet');
  assert.equal(classifySheetFilename('fm019_digital_signoff_p1_20260824.jpg'), 'digital');
  assert.equal(classifySheetFilename('signoff_0.jpg'), 'photo');
});

test('coversheet and digital filenames match live EOD naming', () => {
  assert.equal(coversheetFilename(19, '2026-08-24'), 'fm019_eod_coversheet_20260824.jpg');
  assert.equal(digitalSignoffFilename('19', '2026-08-24', 2), 'fm019_digital_signoff_p2_20260824.jpg');
});
