/* Native BarcodeDetector + html5-qrcode fallback. All common retail formats. */
(function (global) {
  'use strict';

  const FORMATS = [
    'upc_a', 'upc_e', 'ean_13', 'ean_8',
    'code_128', 'code_39', 'codabar', 'itf', 'qr_code',
  ];
  const HTML5_SRC = `js/vendor/html5-qrcode.min.js?v=${encodeURIComponent(global.EOD_APP_VERSION || '3.3.59')}`;

  const CAMERA_MIN = 6;
  const MANUAL_MIN = 4;

  let html5Scanner = null;
  let stream = null;
  let loopId = null;
  let onScan = null;
  let manualTimer = null;

  function digits(raw) {
    return String(raw || '').replace(/\D/g, '');
  }

  function overlay() {
    return document.getElementById('eodBarcodeOverlay');
  }

  function reader() {
    return document.getElementById('eodBarcodeReader');
  }

  function hint(text) {
    const el = document.getElementById('eodBarcodeHint');
    if (el) el.textContent = text || '';
  }

  async function stopHtml5() {
    if (!html5Scanner) return;
    try {
      if (html5Scanner.getState && html5Scanner.getState() === 2) await html5Scanner.stop();
    } catch (_) { /* stopped */ }
    try { await html5Scanner.clear(); } catch (_) { /* ignore */ }
    html5Scanner = null;
  }

  async function stopNative() {
    if (loopId) {
      cancelAnimationFrame(loopId);
      loopId = null;
    }
    if (stream) {
      stream.getTracks().forEach((t) => t.stop());
      stream = null;
    }
    const el = reader();
    if (el) el.innerHTML = '';
  }

  async function close() {
    if (manualTimer) {
      clearTimeout(manualTimer);
      manualTimer = null;
    }
    await stopHtml5();
    await stopNative();
    const host = overlay();
    if (host) {
      host.classList.remove('visible');
      host.setAttribute('aria-hidden', 'true');
    }
    document.body.classList.remove('barcode-scan-open');
    onScan = null;
  }

  function pickBest(codes) {
    const rows = (codes || [])
      .map((c) => ({ raw: c.rawValue || c, n: digits(c.rawValue || c).length }))
      .filter((r) => r.n >= CAMERA_MIN);
    if (!rows.length) return null;
    rows.sort((a, b) => b.n - a.n);
    return rows[0].raw;
  }

  function deliver(raw, minDigits) {
    const n = digits(raw);
    const min = minDigits == null ? CAMERA_MIN : minDigits;
    if (n.length < min || !onScan) return false;
    const cb = onScan;
    onScan = null;
    void close().then(() => cb(n));
    return true;
  }

  async function nativeFormats() {
    if (typeof BarcodeDetector === 'undefined') return FORMATS;
    try {
      if (typeof BarcodeDetector.getSupportedFormats === 'function') {
        const supported = await BarcodeDetector.getSupportedFormats();
        const want = FORMATS.filter((f) => supported.includes(f));
        return want.length ? want : FORMATS;
      }
    } catch (_) { /* use default */ }
    return FORMATS;
  }

  async function startNative() {
    const el = reader();
    if (!el || typeof BarcodeDetector === 'undefined') return false;
    if (!navigator.mediaDevices?.getUserMedia) return false;
    el.innerHTML = '<video id="eodBarcodeVideo" playsinline muted autoplay></video>';
    const video = document.getElementById('eodBarcodeVideo');
    stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: { ideal: 'environment' },
        width: { ideal: 1920 },
        height: { ideal: 1080 },
      },
      audio: false,
    });
    video.srcObject = stream;
    await video.play();
    hint('');
    const detector = new BarcodeDetector({ formats: await nativeFormats() });
    const tick = async () => {
      if (!overlay()?.classList.contains('visible')) return;
      try {
        const best = pickBest(await detector.detect(video));
        if (best && deliver(best)) return;
      } catch (_) { /* skip frame */ }
      loopId = requestAnimationFrame(tick);
    };
    loopId = requestAnimationFrame(tick);
    return true;
  }

  function html5Ctor() {
    if (typeof Html5Qrcode !== 'undefined') return Html5Qrcode;
    return global.__Html5QrcodeLibrary__ && global.__Html5QrcodeLibrary__.Html5Qrcode;
  }

  function html5Formats() {
    const F = typeof Html5QrcodeSupportedFormats !== 'undefined'
      ? Html5QrcodeSupportedFormats
      : (global.__Html5QrcodeLibrary__ && global.__Html5QrcodeLibrary__.Html5QrcodeSupportedFormats);
    return F;
  }

  async function ensureHtml5Library() {
    if (html5Ctor()) return html5Ctor();
    const loader = global.EodAssetLoader;
    if (!loader) return null;
    await loader.loadScript(HTML5_SRC, { test: () => !!html5Ctor(), value: html5Ctor });
    return html5Ctor();
  }

  async function startHtml5() {
    await ensureHtml5Library();
    const Ctor = html5Ctor();
    if (!Ctor) return false;
    const el = reader();
    if (!el) return false;
    el.innerHTML = '';
    html5Scanner = new Ctor('eodBarcodeReader');
    hint('');
    const F = html5Formats();
    const formats = F
      ? [F.UPC_A, F.UPC_E, F.EAN_13, F.EAN_8, F.CODE_128, F.CODE_39, F.ITF, F.CODABAR].filter((x) => x != null)
      : undefined;
    const config = {
      fps: 18,
      qrbox: (w, h) => ({
        width: Math.min(520, Math.floor(w * 0.96)),
        height: Math.max(70, Math.min(180, Math.floor(h * 0.28))),
      }),
      aspectRatio: 1.777778,
      disableFlip: false,
      rememberLastUsedCamera: true,
      videoConstraints: {
        facingMode: { ideal: 'environment' },
        width: { ideal: 1920 },
        height: { ideal: 1080 },
      },
    };
    if (formats) config.formatsToSupport = formats;
    await html5Scanner.start(
      { facingMode: { ideal: 'environment' } },
      config,
      (text) => { deliver(text); },
      () => {}
    );
    return true;
  }

  async function start(cb) {
    await close();
    onScan = cb;
    let host = overlay();
    if (!host) {
      host = document.createElement('div');
      host.id = 'eodBarcodeOverlay';
      host.setAttribute('aria-hidden', 'true');
      host.innerHTML = `<div class="eod-barcode-sheet">
        <div class="eod-barcode-bar">
          <button type="button" class="btn btn-secondary" id="eodBarcodeClose">Close</button>
          <span id="eodBarcodeHint"></span>
        </div>
        <div id="eodBarcodeReader" class="eod-barcode-reader"></div>
        <div class="eod-barcode-manual">
          <input type="text" id="eodBarcodeManual" inputmode="numeric" autocomplete="off" placeholder="Last 4 or full UPC">
          <button type="button" class="btn btn-primary" id="eodBarcodeLookup">Look up</button>
        </div>
      </div>`;
      document.body.appendChild(host);
      host.querySelector('#eodBarcodeClose').onclick = () => { void close(); };
      const manual = host.querySelector('#eodBarcodeManual');
      const lookupManual = () => {
        if (manualTimer) {
          clearTimeout(manualTimer);
          manualTimer = null;
        }
        deliver(manual?.value || '', MANUAL_MIN);
      };
      host.querySelector('#eodBarcodeLookup').onclick = lookupManual;
      manual.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter') lookupManual();
      });
      manual.addEventListener('input', () => {
        if (manualTimer) clearTimeout(manualTimer);
        const n = digits(manual.value);
        if (n.length < MANUAL_MIN) return;
        manualTimer = setTimeout(() => deliver(manual.value, MANUAL_MIN), 350);
      });
    }
    const manualField = host.querySelector('#eodBarcodeManual');
    if (manualField) manualField.value = '';
    host.classList.add('visible');
    host.setAttribute('aria-hidden', 'false');
    document.body.classList.add('barcode-scan-open');
    try {
      try {
        if (await startHtml5()) return true;
      } catch (err) {
        console.warn('[EodBarcodeScanner] html5', err);
      }
      await stopHtml5();
      if (await startNative()) return true;
    } catch (err) {
      console.warn('[EodBarcodeScanner]', err);
    }
    hint('');
    host.querySelector('#eodBarcodeManual')?.focus();
    return false;
  }

  global.EodBarcodeScanner = { start, close };
})(typeof window !== 'undefined' ? window : globalThis);
