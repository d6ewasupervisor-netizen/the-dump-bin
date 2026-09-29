/* Turn a live camera frame upright when the page stays portrait and the phone does not. */
(function (global) {
  'use strict';

  let listening = false;
  let primed = false;
  let lastGravity = null;

  function onOrient(ev) {
    if (!ev) return;
    const beta = Number(ev.beta);
    const gamma = Number(ev.gamma);
    if (!Number.isFinite(beta) || !Number.isFinite(gamma)) return;
    lastGravity = { beta, gamma };
  }

  function listen() {
    if (listening || typeof window === 'undefined') return;
    window.addEventListener('deviceorientation', onOrient, { passive: true });
    listening = true;
  }

  function begin() {
    listen();
  }

  function end() {
    lastGravity = null;
    if (!listening || typeof window === 'undefined') return;
    window.removeEventListener('deviceorientation', onOrient);
    listening = false;
  }

  async function prime() {
    listen();
    if (primed) return;
    primed = true;
    try {
      const Req = global.DeviceOrientationEvent;
      if (Req && typeof Req.requestPermission === 'function') {
        const state = await Req.requestPermission();
        if (state !== 'granted') lastGravity = null;
      }
    } catch (_) {
      lastGravity = null;
    }
  }

  function screenAngle() {
    try {
      if (typeof screen !== 'undefined' && screen.orientation && Number.isFinite(Number(screen.orientation.angle))) {
        const angle = Math.round(Number(screen.orientation.angle) / 90) * 90;
        return ((angle % 360) + 360) % 360;
      }
    } catch (_) { /* orientation API missing */ }
    const legacy = typeof window !== 'undefined' ? Number(window.orientation) : 0;
    if (!Number.isFinite(legacy)) return 0;
    return ((legacy % 360) + 360) % 360;
  }

  /**
   * Clockwise quarter-turns to apply to a screen-aligned video frame.
   * Portrait holds and a viewport that already rotated with the phone stay at 0.
   * gamma < 0 (phone top to the left, page still portrait) is 3 — 90° counter-clockwise.
   */
  function quarterTurns(gravity, angle) {
    const screenTurn = ((Number(angle) || 0) % 360 + 360) % 360;
    if (screenTurn !== 0) return 0;
    if (!gravity) return 0;
    const beta = Number(gravity.beta);
    const gamma = Number(gravity.gamma);
    if (!Number.isFinite(beta) || !Number.isFinite(gamma)) return 0;
    const absB = Math.abs(beta);
    const absG = Math.abs(gamma);
    if (absG >= 40 && absG > absB) return gamma < 0 ? 3 : 1;
    if (beta < -40 && absB > absG) return 2;
    return 0;
  }

  function captureCanvas(video, zoom) {
    const z = Math.max(1, Number(zoom) || 1);
    const w = video.videoWidth || 1280;
    const h = video.videoHeight || 720;
    const zw = Math.max(1, Math.floor(w / z));
    const zh = Math.max(1, Math.floor(h / z));
    const sx = Math.floor((w - zw) / 2);
    const sy = Math.floor((h - zh) / 2);
    const turns = quarterTurns(lastGravity, screenAngle()) % 4;
    const destW = turns % 2 ? zh : zw;
    const destH = turns % 2 ? zw : zh;
    const canvas = document.createElement('canvas');
    canvas.width = destW;
    canvas.height = destH;
    const ctx = canvas.getContext('2d');
    ctx.save();
    if (turns === 1) {
      ctx.translate(destW, 0);
      ctx.rotate(Math.PI / 2);
    } else if (turns === 2) {
      ctx.translate(destW, destH);
      ctx.rotate(Math.PI);
    } else if (turns === 3) {
      ctx.translate(0, destH);
      ctx.rotate(-Math.PI / 2);
    }
    ctx.drawImage(video, sx, sy, zw, zh, 0, 0, zw, zh);
    ctx.restore();
    return canvas;
  }

  global.EodCaptureOrient = {
    begin,
    end,
    prime,
    quarterTurns,
    captureCanvas,
  };
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { quarterTurns };
  }
})(typeof globalThis !== 'undefined' ? globalThis : {});
