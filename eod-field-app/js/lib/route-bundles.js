/* Lazy route scripts. First paint stays in index.html. */
(function (global) {
  'use strict';

  function v() {
    return encodeURIComponent(global.EOD_APP_VERSION || '3.3.72');
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
      'js/lib/barcode-scanner.js',
      'js/lib/cart-upc-locate.js',
      'js/features/set-survey.js',
    ],
    send: [
      'js/lib/eod-send-sheets-logic.js',
      'js/lib/pdf-to-image.js',
      'js/lib/eod-send-sheets.js',
      'js/features/cover.js',
      'js/features/send.js',
    ],
    signatures: [
      'js/lib/landscape-sig-pad.js',
      'js/features/dept-signatures.js',
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
      'js/features/pic-qr.js',
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
      await loader.loadSequential(scripts.map((path) => src(path)));
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

  global.EodRouteBundles = { ensure, loadBundle, BUNDLES, ROUTE_BUNDLE };
})(typeof window !== 'undefined' ? window : globalThis);
