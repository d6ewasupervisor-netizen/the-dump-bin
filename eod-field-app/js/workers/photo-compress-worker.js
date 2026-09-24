/* Dedicated compression + SHA-256 for field-app capture outbox. */
'use strict';

const POLICIES = {
  // set/before/after: one high-tier encode that PROD, SI, and the signoff board
  // all keep. passThrough: a capture already encoded at this tier is not
  // re-encoded (canvasToDurableBlob produces exactly that).
  set: { maxEdge: 2560, maxBytes: 1536 * 1024, startQuality: 0.9, minQuality: 0.8, webp: true, passThrough: true },
  cart: { maxEdge: 1600, maxBytes: 900 * 1024, startQuality: 0.82, minQuality: 0.48 },
  before: { maxEdge: 2560, maxBytes: 1536 * 1024, startQuality: 0.9, minQuality: 0.8, webp: true, passThrough: true },
  after: { maxEdge: 2560, maxBytes: 1536 * 1024, startQuality: 0.9, minQuality: 0.8, webp: true, passThrough: true },
  // Signature sheets get printed and faxed, so they keep the taller edge and
  // the higher floor. These mirror js/lib/photo-compress.js exactly - if they
  // drift, routing a photo through the worker silently downgrades it.
  signoff: { maxEdge: 2560, maxBytes: 950 * 1024, startQuality: 0.9, minQuality: 0.55 },
  instawork: { maxEdge: 2400, maxBytes: 950 * 1024, startQuality: 0.88, minQuality: 0.55 },
  context: { maxEdge: 2048, maxBytes: 900 * 1024, startQuality: 0.85, minQuality: 0.5 },
  default: { maxEdge: 2048, maxBytes: 900 * 1024, startQuality: 0.85, minQuality: 0.5 },
};

const PASS_THROUGH_MIMES = new Set(['image/webp', 'image/jpeg']);
let webpEncodes = null;

async function sha256Hex(blob) {
  const buf = await blob.arrayBuffer();
  const hash = await crypto.subtle.digest('SHA-256', buf);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/* OffscreenCanvas silently returns PNG where WebP encode is unsupported (Safari). */
async function canEncodeWebp() {
  if (webpEncodes != null) return webpEncodes;
  try {
    const probe = new OffscreenCanvas(2, 2);
    probe.getContext('2d');
    const b = await probe.convertToBlob({ type: 'image/webp', quality: 0.8 });
    webpEncodes = !!(b && b.type === 'image/webp' && b.size > 0);
  } catch (_) {
    webpEncodes = false;
  }
  return webpEncodes;
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
    if (policy.passThrough
      && PASS_THROUGH_MIMES.has(blob.type)
      && blob.size <= policy.maxBytes
      && Math.max(bitmap.width, bitmap.height) <= policy.maxEdge) {
      return blob;
    }
    const { w, h } = scaleSize(bitmap.width, bitmap.height, policy.maxEdge);
    const canvas = new OffscreenCanvas(w, h);
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bitmap, 0, 0, w, h);
    const mime = policy.webp && await canEncodeWebp() ? 'image/webp' : 'image/jpeg';
    let quality = policy.startQuality;
    let out = await canvas.convertToBlob({ type: mime, quality });
    while (out.size > policy.maxBytes && quality > policy.minQuality) {
      quality = Math.max(policy.minQuality, quality - 0.05);
      out = await canvas.convertToBlob({ type: mime, quality });
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
