/* Lazy route scripts. First paint stays in index.html. */
(function (global) {
  'use strict';

  function v() {
    return encodeURIComponent(global.EOD_APP_VERSION || '3.3.89');
  }

  function src(path) {
    return `${path}?v=${v()}`;
  }

  const BUNDLES = {
    survey: [
      'js/lib/eod-camera.js',
      'js/lib/set-review.js',
      'js/lib/set-media-prefetch.js',
      'js/lib/si-planogram-board.js',
      'js/lib/scan-batch-logic.js',
      'js/lib/barcode-scanner.js',
      'js/lib/cart-upc-locate.js',
      'js/lib/device-photo-flush.js',
      'js/lib/bay-count-logic.js',
      'js/features/set-survey.js',
      'js/features/scan-results.js',
    ],
    scans: [
      'js/lib/si-planogram-board.js',
      'js/lib/scan-batch-logic.js',
      'js/lib/barcode-scanner.js',
      'js/lib/cart-upc-locate.js',
      'js/features/scan-results.js',
    ],
    send: [
      'js/lib/eod-send-sheets-logic.js',
      'js/lib/pdf-to-image.js',
      'js/lib/eod-send-sheets.js',
      'js/features/cover.js',
      'js/lib/eod-photo-editor.js',
      'js/features/photos.js',
      'js/features/send.js',
    ],
    signatures: [
      'js/lib/signature-input.js',
      'js/lib/landscape-sig-pad.js',
      'js/lib/signoff-department.js',
      'js/lib/person-name.js',
      'js/features/dept-signatures.js',
      'js/features/pic-qr.js',
      'js/features/signatures.js',
    ],
    dumpbin: [
      'js/features/materials-browser.js',
      'js/features/dump-bin.js',
    ],
    helpdesk: [
      'js/features/helpdesk-wizard.js',
      'js/features/helpdesk.js',
    ],
    photos: [
      'js/lib/eod-photo-editor.js',
      'js/features/photos.js',
      'js/features/device-storage.js',
    ],
    crew: [
      'js/features/clock-picker.js',
      'js/features/sms-optin-qr.js',
      'js/features/guest-handoff.js',
      'js/features/timesheet-mgmt.js',
      'js/features/crew.js',
    ],
  };

  const ROUTE_BUNDLE = {
    survey: 'survey',
    send: 'send',
    cover: 'send',
    signatures: 'signatures',
    dumpbin: 'dumpbin',
    helpdesk: 'helpdesk',
    photos: 'photos',
    storage: 'photos',
    crew: 'crew',
    scans: 'scans',
  };

  const STYLES = {
    dumpbin: 'css/materials-browser.css',
  };

  const ready = new Map();

  async function loadBundle(name) {
    if (ready.get(name)) return ready.get(name);
    const scripts = BUNDLES[name];
    if (!scripts) {
      ready.set(name, Promise.resolve());
      return ready.get(name);
    }
    const run = (async () => {
      const loader = global.EodAssetLoader;
      if (!loader?.loadSequential) throw new Error('Asset loader missing');
      const style = STYLES[name];
      if (style) await loader.loadStyle(src(style));
      const urls = scripts.map((path) => src(path));
      if (loader.loadOrdered) await loader.loadOrdered(urls);
      else await loader.loadSequential(urls);
    })();
    ready.set(name, run);
    try {
      await run;
    } catch (err) {
      ready.delete(name);
      throw err;
    }
  }

  async function ensure(route) {
    const name = ROUTE_BUNDLE[String(route || '').toLowerCase()];
    if (!name) return;
    await loadBundle(name);
  }

  /* Warm the bundles a lead reaches for every shift while the device is idle,
     so the first tap on Categories or Send has nothing left to download. */
  function prefetchIdle(names) {
    const run = () => {
      for (const name of names || []) loadBundle(name).catch(() => {});
    };
    if (typeof global.requestIdleCallback === 'function') {
      global.requestIdleCallback(run, { timeout: 5000 });
    } else {
      setTimeout(run, 2000);
    }
  }

  global.EodRouteBundles = { ensure, loadBundle, prefetchIdle, BUNDLES, ROUTE_BUNDLE };
})(typeof window !== 'undefined' ? window : globalThis);
