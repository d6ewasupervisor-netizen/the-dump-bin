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
  assert.equal(classifySheetFilename('cart_before_0.jpg'), 'cart-before');
  assert.equal(classifySheetFilename('cart_after_0.jpg'), 'cart-after');
  assert.equal(classifySheetFilename('signoff_0.jpg'), 'photo');
});

test('department signatures become one bullet per name', () => {
  const { formatDeptSignatureLines, signedOutFromSheet, hasDigitalSignoff } = require('../js/lib/eod-send-sheets-logic');
  assert.deepEqual(
    formatDeptSignatureLines([
      { signerName: 'Gauthier, Tyson A', roleLabel: 'Bakery Dept. PIC' },
      { signerName: 'Gauthier, Tyson A', roleLabel: 'Deli Dept. PIC' },
    ]),
    ['• Gauthier, Tyson A (Bakery Dept. PIC)', '• Gauthier, Tyson A (Deli Dept. PIC)']
  );
  assert.deepEqual(
    signedOutFromSheet({ hasHostedSheet: () => true, sheetSendReady: () => true, state: { sheet: { rows: [{}] } } }),
    { prod: 'Yes', si: 'Yes' }
  );
  assert.equal(hasDigitalSignoff({ digitalSignoff: 'P08W2 30/30 marked' }, { rows: [1] }), true);
});

test('sendable photo src rejects CloudFront URLs and accepts data URLs', () => {
  const {
    isRemotePhotoSrc,
    isSendableImageSrc,
    skippedPhotoMessage,
    cartSlotLabel,
  } = require('../js/lib/eod-send-sheets-logic');
  const url = 'https://d3jttbrw0ufia8.cloudfront.net/media/11193/MDjixww.jpg';
  assert.equal(isRemotePhotoSrc(url), true);
  assert.equal(isSendableImageSrc(url), false);
  assert.equal(isSendableImageSrc('data:image/jpeg;base64,/9j/4AAQ'), true);
  assert.equal(isSendableImageSrc('blob:https://the-dump-bin.com/abc'), false);
  assert.equal(cartSlotLabel('cart_before_0.jpg', 'cart-before'), 'Kompass cart — before');
  assert.match(
    skippedPhotoMessage([{ filename: 'cart_before_0.jpg', source: 'cart-before' }]),
    /Kompass cart — before didn't save/
  );
  assert.match(
    skippedPhotoMessage([{ filename: 'cart_before_0.jpg', source: 'cart-before' }]),
    /The rest of this EOD still went out/
  );
});

test('coversheet and digital filenames match live EOD naming', () => {
  assert.equal(coversheetFilename(19, '2026-08-24'), 'fm019_eod_coversheet_20260824.jpg');
  assert.equal(digitalSignoffFilename('19', '2026-08-24', 2), 'fm019_digital_signoff_p2_20260824.jpg');
});
