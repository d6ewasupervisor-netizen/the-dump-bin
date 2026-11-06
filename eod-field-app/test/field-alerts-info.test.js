'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '../js/features/field-alerts.js'), 'utf8');

test('info notices sit above the nav and can close', () => {
  assert.match(src, /params\.set\('info', '1'\)/);
  assert.match(src, /className = 'eod-field-alert-info'/);
  assert.match(src, /z-index:\s*40/);
  assert.match(src, /bottom:\s*var\(--nav-clear/);
  assert.match(src, /data-info-dismiss/);
  assert.match(src, /postAction\(alertId, 'understand'\)/);
  assert.match(src, /postAction\(alertId, 'dismiss'\)/);
  assert.doesNotMatch(src, /z-index:\s*5000/);
  assert.doesNotMatch(src, /bottom:\s*12px;\s*z-index:\s*5000/);
});
