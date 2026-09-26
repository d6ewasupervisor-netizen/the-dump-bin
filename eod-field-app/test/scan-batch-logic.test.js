'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { groupScanResults } = require('../js/lib/scan-batch-logic');

test('a new item with no aisle groups under New items', () => {
  const groups = groupScanResults([
    {
      upc: '0001111016923',
      status: 'ready',
      data: {
        found: true,
        matches: [{
          upc: '0001111016923',
          name: 'KRO PORK MINI WONTONS',
          notesAction: 'new',
          setName: '195 FROZEN ASIAN',
        }],
      },
    },
  ]);
  assert.equal(groups[0].aisle, 'New items');
  assert.equal(groups[0].setName, '195 FROZEN ASIAN');
});

test('scan results group by aisle then set', () => {
  const groups = groupScanResults([
    {
      upc: '111',
      status: 'ready',
      data: {
        found: true,
        matches: [
          { upc: '111', name: 'Towel', aisle: '12', setName: 'Paper' },
          { upc: '111', name: 'Towel', aisle: '4', setName: 'Household' },
        ],
      },
    },
    {
      upc: '222',
      status: 'ready',
      data: { found: true, matches: [{ upc: '222', name: 'Soup', aisle: '4', setName: 'Soup' }] },
    },
    { upc: '333', status: 'miss', data: { found: false, matches: [] } },
  ]);
  assert.deepEqual(groups.map((g) => `${g.aisle}|${g.setName}`), [
    'Aisle 4|Household',
    'Aisle 4|Soup',
    'Aisle 12|Paper',
    'Not located|',
  ]);
  assert.equal(groups[0].rows[0].upc, '111');
  assert.equal(groups.at(-1).rows[0].upc, '333');
});

test('bulk scan keeps the camera open and files a Scan results page', () => {
  const root = path.join(__dirname, '..');
  const locate = fs.readFileSync(path.join(root, 'js/lib/cart-upc-locate.js'), 'utf8');
  const scanner = fs.readFileSync(path.join(root, 'js/lib/barcode-scanner.js'), 'utf8');
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const chrome = fs.readFileSync(path.join(root, 'js/chrome.js'), 'utf8');
  assert.match(locate, /Scan more items\?/);
  assert.match(locate, /Done Scanning/);
  assert.match(locate, /continuous: true/);
  assert.match(scanner, /if \(continuous\)/);
  assert.match(scanner, /setAccepting/);
  assert.match(html, /data-nav="scans"/);
  assert.match(chrome, /data-more="scans"/);
});
