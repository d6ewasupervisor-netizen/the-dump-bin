'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, '../js/features/timesheet-mgmt.js'), 'utf8');

test('timesheet management shows the registered phone and hides it from print', () => {
  assert.match(src, /function registeredLines/);
  assert.match(src, /InstaWork: \$\{who\}/);
  assert.match(src, /Variant · /);
  assert.match(src, /@media print \{ \.eod-ts-phone \{ display: none !important; \} \}/);
  assert.equal(src.includes('registered.phone'), false);
});
