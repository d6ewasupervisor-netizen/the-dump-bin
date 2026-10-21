'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const pipeline = fs.readFileSync(path.join(__dirname, '..', 'js', 'lib', 'photo-pipeline.js'), 'utf8');
const survey = fs.readFileSync(path.join(__dirname, '..', 'js', 'features', 'set-survey.js'), 'utf8');

test('captures mirror through the live set-photos upload before the phone drops bytes', () => {
  assert.match(pipeline, /\/api\/set-photos\/upload/);
  assert.match(pipeline, /function sendLocalMirror/);
  assert.match(pipeline, /SetPhotos/);
  assert.match(pipeline, /if \(!job\.localMirrorOk && \(job\.dataUrl \|\| job\.blob\)\) return false/);
  assert.match(pipeline, /localMirrorOk: !!job\.localMirrorOk/);
  assert.match(survey, /categoryNumber: catNum \|\| null/);
});
