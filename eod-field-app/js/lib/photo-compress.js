/* High-quality, size-aware photo compression for capture + gallery loads. */
(function (global) {
  'use strict';

  const TARGET_BYTES = 900 * 1024; // stay under 1 MB with headroom
  const HARD_MAX_BYTES = 1024 * 1024;

  const POLICIES = {
    set: { maxEdge: 1600, maxBytes: 480 * 1024, startQuality: 0.78, minQuality: 0.6, preferJpeg: true, fast: true, label: 'set' },
    cart: { maxEdge: 1600, maxBytes: TARGET_BYTES, startQuality: 0.82, minQuality: 0.48, label: 'cart' },
    before: { maxEdge: 1600, maxBytes: 480 * 1024, startQuality: 0.78, minQuality: 0.6, preferJpeg: true, fast: true, label: 'cart-before' },
    after: { maxEdge: 1600, maxBytes: 480 * 1024, startQuality: 0.78, minQuality: 0.6, preferJpeg: true, fast: true, label: 'cart-after' },
    signoff: { maxEdge: 2560, maxBytes: 950 * 1024, startQuality: 0.9, minQuality: 0.55, label: 'signoff' },
    instawork: { maxEdge: 2400, maxBytes: 950 * 1024, startQuality: 0.88, minQuality: 0.55, label: 'instawork' },
    default: { maxEdge: 2048, maxBytes: TARGET_BYTES, startQuality: 0.85, minQuality: 0.5, label: 'photo' },
  };

  let webpSupported = null;

  async function supportsWebp() {
    if (webpSupported != null) return webpSupported;
    try {
      const canvas = document.createElement('canvas');
      canvas.width = 2;
      canvas.height = 2;
      const blob = await canvasToBlob(canvas, 'image/webp', 0.8);
      webpSupported = !!(blob && blob.type === 'image/webp' && blob.size > 0);
    } catch (_) {
      webpSupported = false;
    }
    return webpSupported;
  }

  function canvasToBlob(canvas, mime, quality) {
    return new Promise((resolve) => {
      if (canvas.convertToBlob) {
        canvas.convertToBlob({ type: mime, quality }).then(resolve).catch(() => resolve(null));
        return;
      }
      canvas.toBlob((b) => resolve(b), mime, quality);
    });
  }

  function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error('Could not read compressed photo'));
      reader.readAsDataURL(blob);
    });
  }

  function dataUrlByteLength(dataUrl) {
    const s = String(dataUrl || '');
    const i = s.indexOf(',');
    const b64 = i >= 0 ? s.slice(i + 1) : s;
    // Approximate decoded bytes from base64 length
    return Math.floor((b64.length * 3) / 4);
  }

  async function decodeToBitmap(input) {
    if (typeof ImageBitmap !== 'undefined' && typeof createImageBitmap === 'function') {
      try {
        if (input instanceof ImageBitmap) return input;
        if (input instanceof Blob || input instanceof File) {
          return await createImageBitmap(input, { imageOrientation: 'from-image' });
        }
        if (typeof input === 'string' && input.startsWith('data:')) {
          const res = await fetch(input);
          const blob = await res.blob();
          return await createImageBitmap(blob, { imageOrientation: 'from-image' });
        }
      } catch (_) {
        /* fall through to HTMLImageElement */
      }
    }

    const src = await (async () => {
      if (typeof input === 'string') return input;
      if (input instanceof Blob || input instanceof File) {
        return blobToDataUrl(input);
      }
      throw new Error('Unsupported image input');
    })();

    const img = await new Promise((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('Could not decode image'));
      el.src = src;
    });

    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth || img.width;
    canvas.height = img.naturalHeight || img.height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0);
    if (typeof createImageBitmap === 'function') {
      try {
        return await createImageBitmap(canvas);
      } catch (_) { /* use canvas as draw source via temporary bitmap-like */ }
    }
    return {
      width: canvas.width,
      height: canvas.height,
      close() {},
      _canvas: canvas,
      drawTo(ctx2, dw, dh) {
        ctx2.drawImage(canvas, 0, 0, dw, dh);
      },
    };
  }

  function drawBitmap(ctx, bitmap, w, h) {
    if (bitmap && typeof bitmap.drawTo === 'function') {
      bitmap.drawTo(ctx, w, h);
      return;
    }
    ctx.drawImage(bitmap, 0, 0, w, h);
  }

  function fitWithin(srcW, srcH, maxEdge) {
    const edge = Math.max(srcW, srcH);
    if (edge <= maxEdge) return { w: srcW, h: srcH };
    const scale = maxEdge / edge;
    return {
      w: Math.max(1, Math.round(srcW * scale)),
      h: Math.max(1, Math.round(srcH * scale)),
    };
  }

  async function encodeBest(canvas, { maxBytes, startQuality, minQuality, preferJpeg, fast }) {
    const preferWebp = !preferJpeg && await supportsWebp();
    const mimes = preferJpeg ? ['image/jpeg'] : (preferWebp ? ['image/webp', 'image/jpeg'] : ['image/jpeg']);
    let best = null;

    for (const mime of mimes) {
      let bestUnder = null;
      let smallest = null;

      const tryQ = async (q) => {
        const blob = await canvasToBlob(canvas, mime, q);
        if (!blob || !blob.size) return null;
        const candidate = { blob, mime, quality: q, bytes: blob.size };
        if (!smallest || candidate.bytes < smallest.bytes) smallest = candidate;
        if (candidate.bytes <= maxBytes) {
          if (!bestUnder || candidate.quality > bestUnder.quality) bestUnder = candidate;
        }
        return candidate;
      };

      if (fast) {
        let c = await tryQ(startQuality);
        if (c && c.bytes > maxBytes) {
          c = await tryQ(Math.max(minQuality, startQuality - 0.12)) || c;
        }
        const pick = (c && c.bytes <= maxBytes ? c : null) || c || smallest;
        if (pick && (
          !best
          || (pick.bytes <= maxBytes && best.bytes > maxBytes)
          || (pick.bytes <= maxBytes && pick.bytes <= best.bytes)
          || (pick.bytes > maxBytes && best.bytes > maxBytes && pick.bytes < best.bytes)
        )) {
          best = pick;
        }
        if (best && best.bytes <= maxBytes) break;
        continue;
      }

      await tryQ(startQuality);
      if (!bestUnder) {
        let lo = minQuality;
        let hi = startQuality;
        for (let i = 0; i < 8; i += 1) {
          const mid = (lo + hi) / 2;
          const c = await tryQ(mid);
          if (!c) break;
          if (c.bytes <= maxBytes) lo = mid;
          else hi = mid;
          if (Math.abs(hi - lo) < 0.025) break;
        }
      } else {
        // Already under budget at startQuality — nudge upward if headroom remains
        let q = startQuality;
        for (let i = 0; i < 3 && q < 0.94; i += 1) {
          q = Math.min(0.94, q + 0.04);
          const c = await tryQ(q);
          if (!c || c.bytes > maxBytes) break;
        }
      }

      const pick = bestUnder || smallest;
      if (!pick) continue;
      if (
        !best
        || (pick.bytes <= maxBytes && best.bytes > maxBytes)
        || (pick.bytes <= maxBytes && best.bytes <= maxBytes && pick.quality >= best.quality && pick.bytes <= best.bytes)
        || (pick.bytes > maxBytes && best.bytes > maxBytes && pick.bytes < best.bytes)
      ) {
        best = pick;
      }
      if (best && best.bytes <= maxBytes && best.mime === 'image/webp') break;
    }

    return best;
  }

  async function compressOnce(bitmap, width, height, policy) {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d', { alpha: false });
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);
    drawBitmap(ctx, bitmap, width, height);

    return encodeBest(canvas, policy);
  }

  /**
   * @param {File|Blob|string} input
   * @param {string|object} [policyOrType]
   * @returns {Promise<{ dataUrl: string, blob: Blob, mime: string, bytes: number, width: number, height: number, quality: number }>}
   */
  async function compress(input, policyOrType) {
    const policy = typeof policyOrType === 'string'
      ? { ...(POLICIES[policyOrType] || POLICIES.default) }
      : { ...POLICIES.default, ...(policyOrType || {}) };

    // Skip remote http(s) URLs — already hosted; don't re-encode.
    if (typeof input === 'string' && /^https?:\/\//i.test(input)) {
      return {
        dataUrl: input,
        blob: null,
        mime: '',
        bytes: 0,
        width: 0,
        height: 0,
        quality: null,
        skipped: true,
      };
    }

    const bitmap = await decodeToBitmap(input);
    const srcW = bitmap.width;
    const srcH = bitmap.height;
    let { w, h } = fitWithin(srcW, srcH, policy.maxEdge);

    let encoded = await compressOnce(bitmap, w, h, policy);
    let guard = 0;
    while (encoded && encoded.bytes > policy.maxBytes && Math.max(w, h) > 720 && guard < 4) {
      w = Math.max(1, Math.round(w * 0.85));
      h = Math.max(1, Math.round(h * 0.85));
      encoded = await compressOnce(bitmap, w, h, policy);
      guard += 1;
    }

    try {
      bitmap.close?.();
    } catch (_) {}

    if (!encoded) {
      // Absolute fallback: original data URL if we can read it
      if (typeof input === 'string') {
        return {
          dataUrl: input,
          blob: null,
          mime: 'image/jpeg',
          bytes: dataUrlByteLength(input),
          width: srcW,
          height: srcH,
          quality: null,
          fallback: true,
        };
      }
      const raw = await blobToDataUrl(input);
      return {
        dataUrl: raw,
        blob: input,
        mime: input.type || 'image/jpeg',
        bytes: input.size || dataUrlByteLength(raw),
        width: srcW,
        height: srcH,
        quality: null,
        fallback: true,
      };
    }

    const dataUrl = await blobToDataUrl(encoded.blob);
    return {
      dataUrl,
      blob: encoded.blob,
      mime: encoded.mime,
      bytes: encoded.bytes,
      width: w,
      height: h,
      quality: encoded.quality,
      under1mb: encoded.bytes <= HARD_MAX_BYTES,
      label: policy.label,
    };
  }

  async function compressFile(file, type) {
    return compress(file, type || 'default');
  }

  async function compressDataUrl(dataUrl, type) {
    return compress(dataUrl, type || 'default');
  }

  global.EodPhotoCompress = {
    TARGET_BYTES,
    HARD_MAX_BYTES,
    POLICIES,
    compress,
    compressFile,
    compressDataUrl,
    dataUrlByteLength,
    supportsWebp,
  };
})(typeof window !== 'undefined' ? window : globalThis);
