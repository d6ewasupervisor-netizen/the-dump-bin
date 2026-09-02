'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { createLoader } = require('../js/lib/script-loader');
const workflow = require('../js/lib/workflow-progress');
const { createClient } = require('../js/lib/field-set-job-client');
const {
  bayScale,
  isPegBay,
  packPegItems,
  pegColumns,
} = require('../js/lib/si-planogram-board');

function fakeDocument() {
  const appended = [];
  const elements = [];
  return {
    appended,
    head: {
      appendChild(el) {
        elements.push(el);
        appended.push(el.src || el.href);
        queueMicrotask(() => el.onload());
      },
    },
    createElement(tag) {
      return { tagName: tag.toUpperCase(), dataset: {}, set async(value) { this._async = value; } };
    },
    querySelector(selector) {
      const match = selector.match(/data-eod-asset="([^"]+)"\]\[(?:src|href)="([^"]+)"/);
      if (!match) return null;
      return elements.find((el) => el.dataset.eodAsset === match[1] && (el.src === match[2] || el.href === match[2])) || null;
    },
  };
}

test('route dependency loader preserves order and deduplicates requests', async () => {
  const doc = fakeDocument();
  const loader = createLoader(doc);
  await loader.loadSequential(['/pdf.js', '/pdf-lib.js', '/viewer.js']);
  assert.deepEqual(doc.appended, ['/pdf.js', '/pdf-lib.js', '/viewer.js']);
  const one = loader.loadScript('/scanner.js');
  const two = loader.loadScript('/scanner.js');
  assert.equal(one, two);
  await Promise.all([one, two]);
  assert.equal(doc.appended.filter((url) => url === '/scanner.js').length, 1);
});

test('durable field-set client submits once and polls to completion', async () => {
  const calls = [];
  const replies = [
    { status: 202, body: { accepted: true, statusUrl: '/api/field-set/jobs/job-1' } },
    { status: 200, body: { job: { status: 'pending' } } },
    { status: 200, body: { job: { status: 'completed', result: { prod: { status: 'ok' } } } } },
  ];
  const client = createClient({
    async authFetch(url, init) {
      calls.push({ url, init });
      const next = replies.shift();
      return {
        ok: next.status >= 200 && next.status < 300,
        status: next.status,
        async json() { return next.body; },
      };
    },
  }, { sleep: async () => {} });
  const result = await client.submit('photo', {
    body: '{}',
    headers: { 'Content-Type': 'application/json' },
    idempotencyKey: 'eod-photo:one',
  });
  assert.equal(result.prod.status, 'ok');
  assert.equal(calls.length, 3);
  assert.equal(calls[0].init.headers.Prefer, 'respond-async');
  assert.equal(calls[0].init.headers['Idempotency-Key'], 'eod-photo:one');
  assert.match(calls[1].url, /\/api\/field-set\/jobs\/job-1$/);
});

test('workflow progress exposes four stages and one next gate', () => {
  const gates = [
    { id: 'visit', ok: true, label: 'Confirm', page: 'visit' },
    { id: 'name', ok: true, label: 'Name', page: 'visit' },
    { id: 'checkin', ok: false, label: 'Check in', page: 'visit' },
    { id: 'sheet', ok: false, label: 'Mark sets', page: 'signoff' },
    { id: 'signature', ok: false, label: 'Sign', page: 'send' },
  ];
  const result = workflow.derive({}, { items: () => gates });
  assert.deepEqual(result.stages.map((stage) => stage.label), ['Visit', 'Categories', 'Signatures', 'Send']);
  assert.equal(result.stages[0].status, 'current');
  assert.equal(result.next.label, 'Check in');
  assert.equal(result.next.page, 'visit');
});

test('heavy scanner and materials dependencies are lazy and ordered', () => {
  const index = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
  const scanner = fs.readFileSync(path.join(__dirname, '../js/lib/barcode-scanner.js'), 'utf8');
  const materials = fs.readFileSync(path.join(__dirname, '../js/features/materials-browser.js'), 'utf8');
  assert.doesNotMatch(index, /<script[^>]+html5-qrcode/);
  assert.doesNotMatch(index, /<script[^>]+(?:pdf-lib|pdf\.min|materials-pdf-viewer)/);
  assert.match(scanner, /loadScript\(HTML5_SRC/);
  assert.match(materials, /await ensurePdfJs\(\);[\s\S]*loadSequential\(\[[\s\S]*PDFLIB_SRC[\s\S]*VIEWER_SRC/);
});

test('photo metadata prefetch uses the batch route with legacy fallback', () => {
  const prefetch = fs.readFileSync(path.join(__dirname, '../js/lib/set-media-prefetch.js'), 'utf8');
  assert.match(prefetch, /\/photos\/batch/);
  assert.match(prefetch, /offset \+= 50/);
  assert.match(prefetch, /older API: per-row fallback/);
});

test('feedback hub exposes persisted report history and review status', () => {
  const feedback = fs.readFileSync(path.join(__dirname, '../js/features/feedback-hub.js'), 'utf8');
  assert.match(feedback, /\/api\/app-feedback\/mine\?limit=10/);
  assert.match(feedback, /item\.reviewStatus/);
  assert.match(feedback, /id="eodFbHistoryBtn"/);
});

test('planogram normalizes every shelf to the widest shelf without gaps', () => {
  const layout = bayScale([
    { shelf: 1, items: [{ h: 1 }, { h: 2 }, { h: 1 }] },
    { shelf: 2, items: [{ h: 1 }, { h: 1 }] },
  ]);
  assert.equal(layout.widestUnits, 4);
  assert.equal(layout.rows[0].scale, 1);
  assert.equal(layout.rows[1].scale, 2);
  assert.equal(layout.rows[1].units * layout.rows[1].scale, layout.widestUnits);
});

test('dense one-fixture planograms pack as a portrait peg grid without collisions', () => {
  const items = Array.from({ length: 60 }, (_, i) => ({
    id: i + 1,
    itemPosition: i + 1,
    position: i + 1,
    h: i < 5 ? 2 : 1,
  }));
  assert.equal(isPegBay({ shelves: [{ shelf: 1, items }] }), true);
  assert.equal(isPegBay({ layoutMode: 'peg', shelves: [] }), true);
  assert.equal(pegColumns(items), 7);
  const packed = packPegItems(items);
  assert.equal(packed.columns, 7);
  assert.equal(packed.rows, 10);
  assert.deepEqual(
    { item: packed.placements[0].item.itemPosition, row: packed.placements[0].row, col: packed.placements[0].col },
    { item: 1, row: 1, col: 1 }
  );
  const occupied = new Set();
  packed.placements.forEach((placement) => {
    for (let col = placement.col; col < placement.col + placement.span; col += 1) {
      const key = `${placement.row}:${col}`;
      assert.equal(occupied.has(key), false);
      occupied.add(key);
    }
  });
  assert.equal(occupied.size, 65);
});

test('manual peg row endings preserve item order and force the next item left', () => {
  const items = Array.from({ length: 8 }, (_, i) => ({
    itemPosition: i + 1,
    position: i + 1,
    h: 1,
  }));
  const packed = packPegItems(items, 6, new Set(['3', '7']));
  assert.deepEqual(
    packed.placements.map(({ item, row, col, isRowEnd }) => ({
      item: item.itemPosition,
      row,
      col,
      isRowEnd,
    })),
    [
      { item: 1, row: 1, col: 1, isRowEnd: false },
      { item: 2, row: 1, col: 2, isRowEnd: false },
      { item: 3, row: 1, col: 3, isRowEnd: true },
      { item: 4, row: 2, col: 1, isRowEnd: false },
      { item: 5, row: 2, col: 2, isRowEnd: false },
      { item: 6, row: 2, col: 3, isRowEnd: false },
      { item: 7, row: 2, col: 4, isRowEnd: true },
      { item: 8, row: 3, col: 1, isRowEnd: false },
    ]
  );
});

test('compact planogram stays image-first and grab-swipes between bays', () => {
  const board = fs.readFileSync(path.join(__dirname, '../js/lib/si-planogram-board.js'), 'utf8');
  const css = fs.readFileSync(path.join(__dirname, '../css/app.css'), 'utf8');
  assert.match(board, /COMPACT_QUERY = '\(max-width: 560px\)'/);
  assert.match(board, /addEventListener\('pointerdown'/);
  assert.match(board, /addEventListener\('pointermove'/);
  assert.match(board, /_pogSuppressClickUntil/);
  assert.match(board, /scroll\.scrollLeft = drag\.left - dx/);
  assert.match(board, /goToBay\(scroll, bay\)/);
  assert.match(board, /class="si-pog-bay is-peg"/);
  assert.match(board, /id="pogRowsBtn"[\s\S]*>Set rows</);
  assert.match(board, /togglePegBreak\(ctx, bay, itemNumber\)/);
  assert.match(css, /@media \(max-width: 560px\)[\s\S]*\.si-pog-live \.si-pog-meta[\s\S]*display: none/);
  assert.match(css, /\.si-pog-bay \{[\s\S]*width: min\(100%, 72dvh\)/);
  assert.match(css, /\.si-pog-slots \{[\s\S]*gap: 0;[\s\S]*padding: 0/);
  assert.match(css, /\.si-pog-peg-board \{[\s\S]*radial-gradient/);
  assert.match(css, /\.si-pog-item\.si-pog-peg-item\.is-row-end::after/);
  assert.match(css, /scroll-snap-type: x mandatory/);
});

test('router and shell accessibility contracts are present', () => {
  const index = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
  const router = fs.readFileSync(path.join(__dirname, '../js/router.js'), 'utf8');
  const css = fs.readFileSync(path.join(__dirname, '../css/app.css'), 'utf8');
  assert.doesNotMatch(index, /id="appMount"[^>]+aria-live/);
  assert.match(index, /id="eodStatusLive"[^>]+aria-live="polite"/);
  assert.match(router, /aria-current/);
  assert.match(router, /routeState/);
  assert.match(css, /:focus-visible/);
  assert.match(css, /prefers-reduced-motion/);
  assert.doesNotMatch(css, /@media \(max-width: 420px\)[\s\S]{0,180}\.nav-label \{ display: none/);
});

test('Gray Matter theme and mobile wrap primitives are defined', () => {
  const css = fs.readFileSync(path.join(__dirname, '../css/app.css'), 'utf8');
  const index = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
  assert.match(css, /\[data-theme="gray-matter"\][\s\S]*--bg:\s*#1A1C1F/);
  assert.match(css, /--touch:\s*44px/);
  assert.match(css, /\.button-group \{[\s\S]*flex-wrap:\s*wrap/);
  assert.match(css, /\.dept-sig-role-actions \{[\s\S]*flex-wrap:\s*wrap/);
  assert.match(index, /t !== 'gray-matter'/);
});

test('service worker discovers the full local shell and keeps APIs network-only', () => {
  const sw = fs.readFileSync(path.join(__dirname, '../sw.js'), 'utf8');
  assert.match(sw, /shellAssetsFromHtml/);
  assert.match(sw, /Promise\.all\(shellAssetsFromHtml\(html\)/);
  assert.match(sw, /function isNetworkOnly/);
  assert.match(sw, /\\\/api\\\//);
  assert.match(sw, /optionalRemote/);
  assert.match(sw, /keys\.filter\(\(k\) => k\.startsWith\('eod-field-'\) && k !== CACHE\)/);
});

test('prior-day draft requires an explicit resume or start-today choice', () => {
  const session = fs.readFileSync(path.join(__dirname, '../js/session.js'), 'utf8');
  const visit = fs.readFileSync(path.join(__dirname, '../js/features/visit.js'), 'utf8');
  assert.match(session, /priorDayDraft = \{/);
  assert.doesNotMatch(session, /if \(state\.workDate && state\.workDate !== today\) \{[\s\S]{0,500}clearDayConfirm\(\)/);
  assert.match(visit, /id="priorDayResume"/);
  assert.match(visit, /id="priorDayStart"/);
  assert.match(visit, /initialStore: prior\.storeNumber, initialDate: prior\.workDate/);
});
