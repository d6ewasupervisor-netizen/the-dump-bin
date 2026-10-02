'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  rolesForSignoffRow,
  signatureRolesForRows,
  signedOutBeforeThisVisit,
} = require('../js/lib/signoff-department');
const { isTysonLogin, eodSubmittedStamp, activeStamp } = require('../js/lib/proxy-eod-stamp');

test('lightbulbs are home and money services are grocery', () => {
  assert.deepEqual(rolesForSignoffRow({
    catName: 'LT BULBS STANDARD DECOR DS',
    dept: 'GM',
    shiftType: 'Blitz',
    pog: 'P09W3_9472145_D701_L00000_D03_C892_V214_F024_MX',
  }), ['home_manager']);
  assert.deepEqual(rolesForSignoffRow({
    catName: 'MONEY SERVICES',
    shiftType: 'Cut In',
    pog: 'D701_L00000_D03_C100_V100_F008_MX',
  }), ['grocery']);
  assert.deepEqual(rolesForSignoffRow({
    catName: 'COFFEE FILTERS AND CREAMERS',
    dept: 'GM',
    pog: 'D701_L00000_D01_C228_V832_F008_MX',
  }), ['grocery']);
});

test('a previous visit does not open a signature slot', () => {
  const shift = { workDate: '2026-10-02', visitId: 'follow-up' };
  const priorProduce = {
    catName: 'APPLES',
    pog: 'D701_L00000_D19_C140_V100_F016_MX',
    marks: {
      complete: true,
      active: ['complete'],
      details: { complete: { visitId: 'yesterday', markedAt: '2026-10-01T20:00:00.000Z' } },
    },
  };
  const bulbs = {
    catName: 'LT BULBS',
    dept: 'GM',
    shiftType: 'Blitz',
    pog: 'D701_L00000_D03_C892_V214_F024_MX',
    marks: {
      complete: true,
      active: ['complete'],
      details: { complete: { visitId: 'follow-up', markedAt: '2026-10-02T18:00:00.000Z' } },
    },
  };
  const money = { catName: 'MONEY SERVICES', shiftType: 'Cut In' };
  assert.equal(signedOutBeforeThisVisit(priorProduce, shift), true);
  assert.equal(signedOutBeforeThisVisit(bulbs, shift), false);
  assert.deepEqual(signatureRolesForRows([priorProduce, bulbs, money], shift), ['grocery', 'home_manager']);
});

test('proxy stamp stays on Tyson login and uses Pacific MM/DD/YY', () => {
  assert.equal(isTysonLogin('Tyson.Gauthier@retail-odyssey.com'), true);
  assert.equal(isTysonLogin('lead@example.com'), false);
  assert.equal(eodSubmittedStamp(new Date('2026-10-02T15:00:00.000Z')), 'EOD submitted 10/02/26');
  global.EodRoles = { getMe: () => ({ email: 'lead@example.com' }) };
  global.EodSession = { state: { proxyEodStamp: 'EOD submitted 10/02/26' } };
  assert.equal(activeStamp(), '');
  global.EodRoles = { getMe: () => ({ email: 'tyson.gauthier@retailodyssey.com' }) };
  assert.equal(activeStamp(), 'EOD submitted 10/02/26');
});
