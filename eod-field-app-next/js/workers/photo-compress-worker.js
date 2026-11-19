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
const STAMP_TYPES = new Set(['set', 'before', 'after', 'cart']);
const FILL = '#93735B';
const STRIPE = '#B29177';
const SHADOW = '#1D1815';
const MARKER = 'EOD-PHOTO-TAG';
const REF = { w: 480, h: 640, cLeft: 11, cBottom: 613, cap: 11 };
let webpEncodes = null;

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
    diameter,
  };
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

function hasMarkerBytes(bytes) {
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

function writeUint32LE(bytes, offset, value) {
  bytes[offset] = value & 255;
  bytes[offset + 1] = (value >> 8) & 255;
  bytes[offset + 2] = (value >> 16) & 255;
  bytes[offset + 3] = (value >> 24) & 255;
}

function withMarker(bytes, mime) {
  if (hasMarkerBytes(bytes)) return bytes;
  const text = new Uint8Array(MARKER.length);
  for (let i = 0; i < MARKER.length; i += 1) text[i] = MARKER.charCodeAt(i);
  if (mime === 'image/jpeg' && bytes[0] === 0xFF && bytes[1] === 0xD8) {
    const com = new Uint8Array(4 + text.length);
    com[0] = 0xFF;
    com[1] = 0xFE;
    const len = text.length + 2;
    com[2] = (len >> 8) & 255;
    com[3] = len & 255;
    com.set(text, 4);
    const out = new Uint8Array(bytes.length + com.length);
    out[0] = 0xFF;
    out[1] = 0xD8;
    out.set(com, 2);
    out.set(bytes.subarray(2), 2 + com.length);
    return out;
  }
  if (bytes.length < 12 || String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]) !== 'RIFF') {
    return bytes;
  }
  const pad = text.length % 2;
  const chunk = new Uint8Array(8 + text.length + pad);
  chunk[0] = 69;
  chunk[1] = 79;
  chunk[2] = 68;
  chunk[3] = 84;
  writeUint32LE(chunk, 4, text.length);
  chunk.set(text, 8);
  const out = new Uint8Array(bytes.length + chunk.length);
  out.set(bytes, 0);
  out.set(chunk, bytes.length);
  writeUint32LE(out, 4, out.length - 8);
  return out;
}

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
  const stamp = STAMP_TYPES.has(type);
  const bitmap = await createImageBitmap(blob, { imageOrientation: 'from-image' });
  try {
    const already = new Uint8Array(await blob.arrayBuffer());
    if (!stamp
      && policy.passThrough
      && PASS_THROUGH_MIMES.has(blob.type)
      && blob.size <= policy.maxBytes
      && Math.max(bitmap.width, bitmap.height) <= policy.maxEdge) {
      return blob;
    }
    if (stamp
      && hasMarkerBytes(already)
      && policy.passThrough
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
    if (stamp) paintDot(ctx, w, h);
    const mime = policy.webp && await canEncodeWebp() ? 'image/webp' : 'image/jpeg';
    let quality = stamp ? Math.max(policy.startQuality, 0.92) : policy.startQuality;
    let out = await canvas.convertToBlob({ type: mime, quality });
    while (out.size > policy.maxBytes && quality > policy.minQuality) {
      quality = Math.max(policy.minQuality, quality - 0.05);
      out = await canvas.convertToBlob({ type: mime, quality });
    }
    if (!stamp) return out;
    const marked = withMarker(new Uint8Array(await out.arrayBuffer()), mime);
    return new Blob([marked], { type: mime });
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
