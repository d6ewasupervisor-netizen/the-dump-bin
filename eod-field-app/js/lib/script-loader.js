/* Small dependency loader for route-only scripts and styles. Node-testable. */
(function (global) {
  'use strict';

  function createLoader(doc) {
    const pending = new Map();

    function loadedElement(kind, url) {
      if (!doc?.querySelector) return null;
      const attr = kind === 'style' ? 'href' : 'src';
      return doc.querySelector(`[data-eod-asset="${kind}"][${attr}="${url}"]`);
    }

    function load(kind, url, opts) {
      const options = opts || {};
      const key = `${kind}:${url}`;
      if (options.test?.()) return Promise.resolve(options.value?.());
      if (pending.has(key)) return pending.get(key);
      const existing = loadedElement(kind, url);
      if (existing?.dataset?.loaded === 'true') return Promise.resolve(existing);

      const promise = new Promise((resolve, reject) => {
        if (!doc?.createElement || !doc?.head) {
          reject(new Error(`Cannot load ${url} without a document`));
          return;
        }
        const el = existing || doc.createElement(kind === 'style' ? 'link' : 'script');
        if (kind === 'style') {
          el.rel = 'stylesheet';
          el.href = url;
        } else {
          el.src = url;
          el.async = false;
        }
        el.dataset.eodAsset = kind;
        el.onload = () => {
          el.dataset.loaded = 'true';
          resolve(options.value?.() || el);
        };
        el.onerror = () => {
          pending.delete(key);
          reject(new Error(`Failed to load ${url}`));
        };
        if (!existing) doc.head.appendChild(el);
      });
      pending.set(key, promise);
      return promise;
    }

    function loadScript(url, opts) {
      return load('script', url, opts);
    }

    function loadStyle(url, opts) {
      return load('style', url, opts);
    }

    async function loadSequential(entries) {
      const out = [];
      for (const entry of entries || []) {
        const item = typeof entry === 'string' ? { url: entry } : entry;
        out.push(await loadScript(item.url, item));
      }
      return out;
    }

    return { loadScript, loadStyle, loadSequential, pending };
  }

  const api = { createLoader };
  if (typeof module === 'object' && module.exports) module.exports = api;
  global.EodAssetLoader = createLoader(global.document);
})(typeof window !== 'undefined' ? window : globalThis);
