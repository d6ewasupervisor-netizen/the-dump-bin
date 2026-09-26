'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadLocate() {
  const code = fs.readFileSync(path.join(__dirname, '../js/lib/cart-upc-locate.js'), 'utf8');
  const window = {
    EodApi: {
      escapeHtml(s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
          '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
        }[c]));
      },
    },
    document: { getElementById() { return null; }, body: { classList: { add() {}, remove() {} } } },
  };
  vm.runInNewContext(code, { window, document: window.document });
  return window.EodCartLocate;
}

test('scan card price shows the lower promo and the regular', () => {
  const locate = loadLocate();
  const html = locate.priceHtml({ price: { regular: 3.49, promo: 2.5, soldBy: 'UNIT' } });
  assert.match(html, /\$2\.50/);
  assert.match(html, /Reg \$3\.49/);
  assert.doesNotMatch(html, /\/lb/);
});

test('scan card price labels random-weight items per pound', () => {
  const locate = loadLocate();
  const html = locate.priceHtml({ price: { regular: 6.99, promo: null, soldBy: 'WEIGHT' } });
  assert.match(html, /\$6\.99\/lb/);
  assert.doesNotMatch(html, /Reg /);
});

test('scan card omits price when the store lookup has none', () => {
  const locate = loadLocate();
  assert.equal(locate.priceHtml({}), '');
  assert.equal(locate.priceHtml({ price: null }), '');
  assert.equal(locate.priceHtml({ price: { regular: 0, promo: 0 } }), '');
});
