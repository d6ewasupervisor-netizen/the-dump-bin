'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const memstore = {};
global.localStorage = {
  getItem: (k) => (Object.prototype.hasOwnProperty.call(memstore, k) ? memstore[k] : null),
  setItem: (k, v) => { memstore[k] = String(v); },
  removeItem: (k) => { delete memstore[k]; },
};

const mem = require('../js/lib/visit-memory');

test('manager chips hide once a name is selected', () => {
  const html = mem.chipsHtml(['April', 'Linda'], '', (s) => s);
  assert.match(html, /April/);
  assert.match(html, /Linda/);
  assert.equal(mem.chipsHtml(['April', 'Linda'], 'April', (s) => s), '');
  assert.equal(mem.chipsHtml(['April', 'Linda'], '  April  ', (s) => s), '');
  assert.match(mem.chipsHtml(['April', 'Linda'], 'Apr', (s) => s), /April/);
});

test('visit memory does not overwrite saved names with empty session values', () => {
  mem.remember('215', { checkIn: 'April', checkOut: 'April', recipients: [] });
  mem.captureFromSession({
    state: {
      storeNumber: '215',
      checkInManager: '',
      checkOutManager: '',
      emailRecipients: [],
    },
  });
  const row = mem.forStore('215');
  assert.equal(row.checkIn, 'April');
  assert.equal(row.checkOut, 'April');
});

test('setManagers writes checkout and fills empty check-in', () => {
  const S = {
    state: { storeNumber: '215', checkInManager: '', checkOutManager: '', emailRecipients: [] },
    patch(partial) { Object.assign(this.state, partial); },
    saveDraft() {},
  };
  mem.setManagers(S, { checkOutManager: 'April' }, 'checkout');
  assert.equal(S.state.checkOutManager, 'April');
  assert.equal(S.state.checkInManager, 'April');
  assert.equal(S.state.checkInDone, true);
  const row = mem.forStore('215');
  assert.equal(row.checkOut, 'April');
});

test('applyToSession restores store names when the draft is empty', () => {
  mem.remember('28', { checkIn: 'Linda', checkOut: 'Isaac' });
  const S = {
    state: { storeNumber: '28', checkInManager: '', checkOutManager: '', emailRecipients: [] },
    patch(partial) { Object.assign(this.state, partial); },
  };
  mem.applyToSession(S, '28');
  assert.equal(S.state.checkInManager, 'Linda');
  assert.equal(S.state.checkOutManager, 'Isaac');
});
