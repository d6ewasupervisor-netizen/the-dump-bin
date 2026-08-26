/* Stay-open camera with torch for cart / paper / InstaWork / helpdesk. */
(function (global) {
  'use strict';

  const STYLE_ID = 'eod-camera-css';

  function ensureCss() {
    if (document.getElementById(STYLE_ID)) return;
    const css = document.createElement('style');
    css.id = STYLE_ID;
    css.textContent = `
      .eod-cam-overlay {
        display: flex; position: fixed; inset: 0; z-index: 45000; background: #000;
        flex-direction: column; color: #fff;
      }
      .eod-cam-overlay video { flex: 1; width: 100%; object-fit: cover; background: #000; }
      .eod-cam-bar {
        display: flex; gap: 8px; flex-wrap: wrap; align-items: center; justify-content: center;
        padding: 12px 12px calc(12px + env(safe-area-inset-bottom, 0px));
        background: #0b1220;
      }
      .eod-cam-bar .eod-cam-label { flex: 1 1 100%; text-align: center; font-size: 14px; color: #cbd5e1; }
    `;
    document.head.appendChild(css);
  }

  async function setTorch(track, on) {
    if (!track || typeof track.applyConstraints !== 'function') return false;
    try {
      await track.applyConstraints({ advanced: [{ torch: !!on }] });
      return true;
    } catch (_) {
      return false;
    }
  }

  function open(opts) {
    const o = opts || {};
    ensureCss();
    return new Promise((resolve) => {
      const overlay = document.createElement('div');
      overlay.className = 'eod-cam-overlay';
      overlay.innerHTML = `
        <video playsinline autoplay muted></video>
        <canvas hidden></canvas>
        <div class="eod-cam-bar">
          <div class="eod-cam-label">${global.EodApi?.escapeHtml?.(o.label || 'Camera')}</div>
          <button type="button" class="btn btn-secondary" data-act="torch">Light</button>
          <button type="button" class="btn btn-primary" data-act="shutter">Capture</button>
          <button type="button" class="btn btn-secondary" data-act="close">Done</button>
        </div>`;
      document.body.appendChild(overlay);
      const video = overlay.querySelector('video');
      const canvas = overlay.querySelector('canvas');
      const torchBtn = overlay.querySelector('[data-act="torch"]');
      const shutter = overlay.querySelector('[data-act="shutter"]');
      let stream = null;
      let track = null;
      let torchOn = false;
      let busy = false;
      const captured = [];

      function stop() {
        try { stream?.getTracks?.().forEach((t) => t.stop()); } catch (_) {}
        overlay.remove();
        resolve(captured);
      }

      overlay.querySelector('[data-act="close"]').onclick = stop;

      torchBtn.onclick = async () => {
        torchOn = !torchOn;
        const ok = await setTorch(track, torchOn);
        torchBtn.classList.toggle('btn-primary', torchOn && ok);
        torchBtn.classList.toggle('btn-secondary', !(torchOn && ok));
        if (!ok) torchOn = false;
      };

      shutter.onclick = async () => {
        if (busy) return;
        busy = true;
        shutter.disabled = true;
        try {
          const w = video.videoWidth || 1280;
          const h = video.videoHeight || 720;
          canvas.width = w;
          canvas.height = h;
          canvas.getContext('2d').drawImage(video, 0, 0, w, h);
          const blob = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', 0.88));
          if (!blob) return;
          const file = new File([blob], `capture_${Date.now()}.jpg`, { type: 'image/jpeg' });
          captured.push(file);
          if (typeof o.onCapture === 'function') await o.onCapture(file);
          if (typeof o.shouldContinue === 'function' && !o.shouldContinue()) stop();
        } catch (err) {
          if (global.showAlert) global.showAlert('Camera', err.message || String(err));
          else alert(err.message || String(err));
        } finally {
          busy = false;
          if (document.body.contains(overlay)) shutter.disabled = false;
        }
      };

      navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' } },
        audio: false,
      }).then(async (s) => {
        stream = s;
        track = s.getVideoTracks()[0] || null;
        video.srcObject = s;
        await video.play();
        const caps = track && typeof track.getCapabilities === 'function' ? track.getCapabilities() : {};
        if (!caps.torch) torchBtn.hidden = true;
      }).catch((err) => {
        if (global.showAlert) global.showAlert('Camera', err.message || 'Camera unavailable');
        else alert(err.message || 'Camera unavailable');
        stop();
      });
    });
  }

  global.EodCamera = { open };
})(typeof window !== 'undefined' ? window : globalThis);
