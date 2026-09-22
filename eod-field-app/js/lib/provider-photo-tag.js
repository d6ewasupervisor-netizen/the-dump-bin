/* Bronze dot on field-app photos before they load to PROD or Store Intelligence. */
(function (global) {
  'use strict';

  const FILL = '#93735B';
  const STRIPE = '#B29177';
  const SHADOW = '#1D1815';
  const MARKER = 'EOD-PHOTO-TAG';
  const REF = { w: 480, h: 640, cLeft: 11, cBottom: 613, cap: 11 };

  function placement(width, height) {
    const w = Math.max(1, Number(width) || 1);
    const h = Math.max(1, Number(height) || 1);
    const sx = w / REF.w;
    const sy = h / REF.h;
    const cap = Math.max(4, Math.round(REF.cap * sy));
    const diameter = Math.max(3, Math.round(cap / 2));
    const cLeft = Math.round(REF.cLeft * sx);
    const cBottom = Math.round(REF.cBottom * sy);
    const gap = Math.max(1, Math.round(2 * sx));
    const radius = diameter / 2;
    const below = Math.max(1, Math.round(sy));
    return {
      cx: Math.round(cLeft - gap - radius),
      cy: Math.round(cBottom + below + radius),
      diameter: diameter,
      cap: cap,
    };
  }

  function hasMarker(bytes) {
    if (!bytes || !bytes.length) return false;
    const needle = MARKER;
    const limit = bytes.length - needle.length;
    for (let i = 0; i <= limit; i += 1) {
      let ok = true;
      for (let j = 0; j < needle.length; j += 1) {
        if (bytes[i + j] !== needle.charCodeAt(j)) {
          ok = false;
          break;
        }
      }
      if (ok) return true;
    }
    return false;
  }

  function insertMarker(bytes) {
    if (!bytes || bytes.length < 2 || bytes[0] !== 0xFF || bytes[1] !== 0xD8) return bytes;
    if (hasMarker(bytes)) return bytes;
    const text = new Uint8Array(MARKER.length);
    for (let i = 0; i < MARKER.length; i += 1) text[i] = MARKER.charCodeAt(i);
    const com = new Uint8Array(4 + text.length);
    com[0] = 0xFF;
    com[1] = 0xFE;
    const len = text.length + 2;
    com[2] = (len >> 8) & 0xFF;
    com[3] = len & 0xFF;
    com.set(text, 4);
    const out = new Uint8Array(2 + com.length + (bytes.length - 2));
    out[0] = 0xFF;
    out[1] = 0xD8;
    out.set(com, 2);
    out.set(bytes.subarray(2), 2 + com.length);
    return out;
  }

  function paintDot(ctx, width, height) {
    const place = placement(width, height);
    const radius = place.diameter / 2;
    ctx.save();
    ctx.shadowColor = SHADOW;
    ctx.shadowBlur = Math.max(0.6, radius * 0.45);
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;
    ctx.fillStyle = SHADOW;
    ctx.globalAlpha = 0.85;
    ctx.beginPath();
    ctx.arc(place.cx, place.cy, radius * 1.85, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    ctx.fillStyle = FILL;
    ctx.beginPath();
    ctx.arc(place.cx, place.cy, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = STRIPE;
    ctx.beginPath();
    ctx.ellipse(place.cx, place.cy, Math.max(0.6, radius * 0.28), radius * 0.78, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('photo tag could not read the image'));
      img.src = src;
    });
  }

  function canvasToBlob(canvas) {
    return new Promise((resolve, reject) => {
      const done = (blob) => (blob ? resolve(blob) : reject(new Error('photo tag encode failed')));
      if (canvas.convertToBlob) {
        canvas.convertToBlob({ type: 'image/jpeg', quality: 0.88 }).then(done).catch(reject);
        return;
      }
      canvas.toBlob(done, 'image/jpeg', 0.88);
    });
  }

  function bytesToBase64(bytes) {
    let binary = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    }
    return btoa(binary);
  }

  async function tagDataUrl(dataUrl) {
    const src = String(dataUrl || '');
    if (!/^data:image\//i.test(src) || typeof document === 'undefined') return src;
    const img = await loadImage(src);
    const width = img.naturalWidth || img.width;
    const height = img.naturalHeight || img.height;
    if (!width || !height) return src;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, width, height);
    paintDot(ctx, width, height);
    const blob = await canvasToBlob(canvas);
    const marked = insertMarker(new Uint8Array(await blob.arrayBuffer()));
    return `data:image/jpeg;base64,${bytesToBase64(marked)}`;
  }

  const api = { placement, tagDataUrl, MARKER };
  global.EodProviderPhotoTag = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
