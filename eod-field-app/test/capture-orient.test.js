'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { quarterTurns } = require('../js/lib/capture-orient');

test('a portrait hold is saved as shot', () => {
  assert.equal(quarterTurns({ beta: 70, gamma: 2 }, 0), 0);
});

test('landscape while the page stays portrait turns the frame upright', () => {
  assert.equal(quarterTurns({ beta: 4, gamma: -72 }, 0), 3);
  assert.equal(quarterTurns({ beta: 4, gamma: 72 }, 0), 1);
});

test('a landscape hold on a tall camera buffer becomes a wide file', () => {
  const tall = { width: 1080, height: 1920 };
  assert.equal(quarterTurns({ beta: 4, gamma: -72 }, 90, tall), 3);
  assert.equal(quarterTurns({ beta: 4, gamma: 72 }, 90, tall), 1);
});

test('a camera buffer that is already wide is left landscape', () => {
  const wide = { width: 1920, height: 1080 };
  assert.equal(quarterTurns({ beta: 4, gamma: -72 }, 90, wide), 0);
  assert.equal(quarterTurns({ beta: 4, gamma: 72 }, 270, wide), 0);
});

test('a flat or in-between reading is left alone', () => {
  assert.equal(quarterTurns({ beta: 12, gamma: 8 }, 0), 0);
  assert.equal(quarterTurns(null, 0), 0);
});

test('an upside-down portrait hold is flipped', () => {
  assert.equal(quarterTurns({ beta: -75, gamma: 3 }, 0), 2);
});
