/* Convert HEIC/HEIF to JPEG via heic2any (CDN, lazy). */
(function (global) {
  'use strict';

  const SRC = 'https://cdn.jsdelivr.net/npm/heic2any@0.0.4/dist/heic2any.min.js';
  let loading = null;

  function isHeic(file) {
    if (!file) return false;
    const name = String(file.name || '').toLowerCase();
    const type = String(file.type || '').toLowerCase();
    return type.includes('heic') || type.includes('heif')
      || name.endsWith('.heic') || name.endsWith('.heif');
  }

  function loadLib() {
    if (global.heic2any) return Promise.resolve(global.heic2any);
    if (loading) return loading;
    loading = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = SRC;
      s.async = true;
      s.onload = () => (global.heic2any ? resolve(global.heic2any) : reject(new Error('heic2any missing')));
      s.onerror = () => reject(new Error('Could not load HEIC converter'));
      document.head.appendChild(s);
    });
    return loading;
  }

  async function toJpegFile(file) {
    if (!file || !isHeic(file)) return file;
    const heic2any = await loadLib();
    const blob = await heic2any({ blob: file, toType: 'image/jpeg', quality: 0.88 });
    const out = Array.isArray(blob) ? blob[0] : blob;
    const name = String(file.name || 'photo.heic').replace(/\.(heic|heif)$/i, '.jpg');
    return new File([out], name, { type: 'image/jpeg' });
  }

  async function prepareFile(file) {
    try {
      return await toJpegFile(file);
    } catch (err) {
      console.warn('[heic]', err);
      return file;
    }
  }

  global.EodHeic = { isHeic, toJpegFile, prepareFile };
})(typeof window !== 'undefined' ? window : globalThis);
