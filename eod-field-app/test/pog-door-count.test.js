'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { expectedPhotoNeed } = require('../js/lib/category-card-status');

const MILK_DOORS = 'P10W1_9498830_D701_L00000_D01_C060_VN18_D004_MX';
const MILK_FEET = 'P10W1_9498823_D701_L00000_D01_C060_VM92_F008_MX';

test('four milk doors are four photos, not one 4 ft bay', () => {
  assert.equal(expectedPhotoNeed({
    pog: MILK_DOORS,
    footage: '4 doors',
    footageDisplay: '4',
  }), 4);
});

test('eight feet of milk is two bays when SI has no section count', () => {
  assert.equal(expectedPhotoNeed({
    pog: MILK_FEET,
    footage: '8 ft',
    footageDisplay: '8',
  }), 2);
});

test('an SI section count still wins over the door token', () => {
  assert.equal(expectedPhotoNeed({
    pog: MILK_DOORS,
    footage: '4 doors',
    live: { sectionCount: 3 },
  }), 3);
});
