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

test('applyToSession never auto-selects recipient chips or manager names', () => {
  // Nov 1 / 3.5.42: remembered names stay chip/datalist options only.
  mem.remember('19', { recipients: ['old@stores.fredmeyer.com'], checkIn: 'Ana', checkOut: 'Bob' });
  const S = {
    state: { storeNumber: '19', checkInManager: '', checkOutManager: '', emailRecipients: [] },
    patch(partial) { Object.assign(this.state, partial); },
  };
  mem.applyToSession(S, '19');
  assert.deepEqual(S.state.emailRecipients, []);
  assert.equal(S.state.checkInManager, '');
  assert.equal(S.state.checkOutManager, '');
});

test('applyToSession does not pull the next store into an open draft', () => {
  mem.remember('19', { recipients: ['a@stores.fredmeyer.com'], checkIn: 'Ana' });
  mem.remember('28', { recipients: ['b@stores.fredmeyer.com'], checkIn: 'Linda', checkOut: 'Isaac' });
  const S = {
    state: {
      storeNumber: '19',
      checkInManager: 'Ana',
      checkOutManager: '',
      emailRecipients: ['a@stores.fredmeyer.com'],
    },
    patch(partial) { Object.assign(this.state, partial); },
  };
  mem.applyToSession(S, '28');
  // applyToSession alone must not rewrite the open draft; session.patch clears
  // emailRecipients when the store/visit actually moves (js/session.js).
  assert.deepEqual(S.state.emailRecipients, ['a@stores.fredmeyer.com']);
  assert.equal(S.state.checkInManager, 'Ana');
  assert.notEqual(S.state.checkInManager, 'Linda');
});
