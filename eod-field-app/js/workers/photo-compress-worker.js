/* Dedicated compression + SHA-256 for field-app capture outbox. */
'use strict';

const POLICIES = {
  set: { maxEdge: 1600, maxBytes: 480 * 1024, startQuality: 0.78, minQuality: 0.6 },
  cart: { maxEdge: 1600, maxBytes: 900 * 1024, startQuality: 0.82, minQuality: 0.48 },
  before: { maxEdge: 1600, maxBytes: 480 * 1024, startQuality: 0.78, minQuality: 0.6 },
  after: { maxEdge: 1600, maxBytes: 480 * 1024, startQuality: 0.78, minQuality: 0.6 },
  default: { maxEdge: 2048, maxBytes: 900 * 1024, startQuality: 0.85, minQuality: 0.5 },
};

async function sha256Hex(blob) {
  const buf = await blob.arrayBuffer();
  const hash = await crypto.subtle.digest('SHA-256', buf);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function encode(bitmap, mime, quality) {
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(bitmap, 0, 0);
  return canvas.convertToBlob({ type: mime, quality });
}

function scaleSize(w, h, maxEdge) {
  const edge = Math.max(w, h);
  if (edge <= maxEdge) return { w, h };
  const scale = maxEdge / edge;
  return { w: Math.max(1, Math.round(w * scale)), h: Math.max(1, Math.round(h * scale)) };
}

async function compressBlob(blob, type) {
  const policy = POLICIES[type] || POLICIES.default;
  const bitmap = await createImageBitmap(blob, { imageOrientation: 'from-image' });
  try {
    const { w, h } = scaleSize(bitmap.width, bitmap.height, policy.maxEdge);
    const canvas = new OffscreenCanvas(w, h);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(bitmap, 0, 0, w, h);
    let quality = policy.startQuality;
    let out = await canvas.convertToBlob({ type: 'image/jpeg', quality });
    while (out.size > policy.maxBytes && quality > policy.minQuality) {
      quality = Math.max(policy.minQuality, quality - 0.08);
      out = await canvas.convertToBlob({ type: 'image/jpeg', quality });
    }
    return out;
  } finally {
    try { bitmap.close(); } catch (_) {}
  }
}

self.onmessage = async (event) => {
  const msg = event.data || {};
  if (msg.type !== 'compress') return;
  try {
    const blob = msg.blob;
    if (!(blob instanceof Blob)) throw new Error('Missing blob');
    const compressed = await compressBlob(blob, msg.compressType || 'set');
    const checksum = await sha256Hex(compressed);
    self.postMessage({
      id: msg.id,
      ok: true,
      blob: compressed,
      bytes: compressed.size,
      mime: compressed.type || 'image/jpeg',
      checksum,
    });
  } catch (err) {
    self.postMessage({
      id: msg.id,
      ok: false,
      error: err?.message || String(err),
    });
  }
};
