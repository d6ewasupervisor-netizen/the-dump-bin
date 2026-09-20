'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const EodTap = require('../js/lib/tap-feedback');

function fakeEl(connected = true) {
  const el = {
    dataset: {},
    isConnected: connected,
    classes: new Set(),
    attrs: {},
    classList: {
      add: (c) => el.classes.add(c),
      remove: (c) => el.classes.delete(c),
    },
    setAttribute: (k, v) => { el.attrs[k] = v; },
    removeAttribute: (k) => { delete el.attrs[k]; },
  };
  return el;
}

const tapOn = (el) => EodTap.noteTap({ target: { closest: () => el } });

test('a tapped control is claimed once, so two requests cannot share it', () => {
  const el = fakeEl();
  tapOn(el);
  assert.equal(EodTap.claim(), el);
  assert.equal(EodTap.claim(), null, 'second claim must not reuse the same tap');
});

test('a control detached before the response is not claimed', () => {
  const el = fakeEl(false);
  tapOn(el);
  assert.equal(EodTap.claim(), null);
});

test('disabled controls are never recorded as taps', () => {
  const el = fakeEl();
  el.disabled = true;
  tapOn(el);
  assert.equal(EodTap.claim(), null);
});

test('pending marks the control busy and clears after release', async () => {
  const el = fakeEl();
  const release = EodTap.pending(el);
  assert.ok(el.classes.has('is-pending'));
  assert.equal(el.attrs['aria-busy'], 'true');

  release();
  await new Promise((r) => setTimeout(r, 200));
  assert.ok(!el.classes.has('is-pending'), 'is-pending must clear');
  assert.equal(el.attrs['aria-busy'], undefined);
});

test('overlapping requests on one control only clear on the last release', async () => {
  const el = fakeEl();
  const first = EodTap.pending(el);
  const second = EodTap.pending(el);

  first();
  await new Promise((r) => setTimeout(r, 200));
  assert.ok(el.classes.has('is-pending'), 'still busy while a request is open');

  second();
  await new Promise((r) => setTimeout(r, 200));
  assert.ok(!el.classes.has('is-pending'));
});

test('press feedback and skeleton styles ship, and nothing blocks the parser', () => {
  const root = path.join(__dirname, '..');
  const css = fs.readFileSync(path.join(root, 'css/app.css'), 'utf8');
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const router = fs.readFileSync(path.join(root, 'js/router.js'), 'utf8');
  const boot = fs.readFileSync(path.join(root, 'js/boot.js'), 'utf8');

  // The global tap-highlight reset means every control needs its own press state.
  assert.match(css, /-webkit-tap-highlight-color: transparent/);
  assert.match(css, /button:not\(:disabled\):active/);
  assert.match(css, /\.is-pending/);
  assert.match(css, /\.eod-skeleton-row/);

  assert.match(html, /js\/lib\/tap-feedback\.js/);
  // Only the two document.write auth bootstraps may block the parser.
  assert.equal((html.match(/<script src=/g) || []).length, 2);
  assert.ok((html.match(/<script defer src=/g) || []).length > 40);

  // Navigation has to answer before the route bundle is fetched.
  assert.ok(
    router.indexOf('paintNavActive(name)') < router.indexOf('EodRouteBundles?.ensure'),
    'nav highlight must be painted before the bundle await'
  );
  assert.match(router, /paintSkeleton\(mount, name\)/);

  // First paint must not sit behind the network hydrates.
  assert.ok(
    boot.indexOf('window.EodRouter.init()') < boot.indexOf('void hydrateAfterPaint()'),
    'router must start before deferred hydration'
  );
});
