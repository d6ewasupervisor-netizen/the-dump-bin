/* Inline collapsible QR for TACTAG SMS opt-in (tactag.app/sms). Static asset — no tracking. */
(function () {
  'use strict';

  const STORAGE_KEY = 'eodSmsOptinQrExpanded';
  const LABEL = 'Share QR code with team or Store PICs to opt into text alerts.';
  const QR_SRC = 'assets/tactag-sms-optin-qr.svg';

  function isExpanded() {
    try {
      return localStorage.getItem(STORAGE_KEY) === '1';
    } catch (_) {
      return false;
    }
  }

  function setExpanded(expanded) {
    try {
      localStorage.setItem(STORAGE_KEY, expanded ? '1' : '0');
    } catch (_) { /* ignore */ }
  }

  function ensureUi() {
    if (document.getElementById('eodSmsOptinQrBlock')) return;

    const container = document.querySelector('.container');
    if (!container) return;

    const block = document.createElement('div');
    block.id = 'eodSmsOptinQrBlock';
    block.className = 'eod-sms-optin-qr';
    block.innerHTML = `
      <button type="button" class="eod-sms-optin-qr__toggle" id="eodSmsOptinQrToggle" aria-expanded="false" aria-controls="eodSmsOptinQrPanel">
        <span class="eod-sms-optin-qr__label">${LABEL}</span>
        <span class="eod-sms-optin-qr__chev" aria-hidden="true">▾</span>
      </button>
      <div class="eod-sms-optin-qr__panel" id="eodSmsOptinQrPanel" hidden>
        <div class="eod-sms-optin-qr__tile">
          <img src="${QR_SRC}" width="296" height="296" alt="QR code — scan to open tactag.app/sms" class="eod-sms-optin-qr__img">
        </div>
        <p class="eod-sms-optin-qr__cta">Text JOIN to (509) 572-9212</p>
        <p class="eod-sms-optin-qr__url">tactag.app/sms</p>
        <button type="button" class="btn btn-secondary eod-sms-optin-qr__collapse" id="eodSmsOptinQrCollapse">Hide QR code</button>
      </div>`;

    container.insertBefore(block, container.firstChild);

    if (!document.getElementById('eodSmsOptinQrStyles')) {
      const style = document.createElement('style');
      style.id = 'eodSmsOptinQrStyles';
      style.textContent = `
        .eod-sms-optin-qr {
          margin-bottom: 12px;
          border: 1px solid #334155;
          border-radius: 8px;
          background: #0f172a;
          overflow: hidden;
        }
        .eod-sms-optin-qr__toggle {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          width: 100%;
          padding: 14px 16px;
          border: none;
          background: transparent;
          color: #e2e8f0;
          font: inherit;
          font-size: 14px;
          line-height: 1.45;
          text-align: left;
          cursor: pointer;
          touch-action: manipulation;
          min-height: 48px;
        }
        .eod-sms-optin-qr__toggle:focus-visible {
          outline: 2px solid #60a5fa;
          outline-offset: -2px;
        }
        .eod-sms-optin-qr__label { flex: 1; }
        .eod-sms-optin-qr__chev {
          flex-shrink: 0;
          color: #94a3b8;
          font-size: 18px;
          transition: transform 0.15s ease;
        }
        .eod-sms-optin-qr.is-expanded .eod-sms-optin-qr__chev { transform: rotate(180deg); }
        .eod-sms-optin-qr__panel {
          padding: 0 16px 16px;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 10px;
        }
        .eod-sms-optin-qr__panel[hidden] { display: none !important; }
        .eod-sms-optin-qr__tile {
          background: #ffffff;
          padding: clamp(8px, 2.5vw, 14px);
          border-radius: 8px;
          line-height: 0;
          width: min(72vw, min(296px, 70vh));
          max-width: 100%;
          box-sizing: border-box;
        }
        .eod-sms-optin-qr__img {
          display: block;
          width: 100%;
          height: auto;
          aspect-ratio: 1 / 1;
          max-width: 100%;
          min-width: 0;
          min-height: 0;
        }
        @media (max-width: 380px) {
          .eod-sms-optin-qr__tile { width: min(86vw, 70vh); }
          .eod-sms-optin-qr__cta { font-size: 14px; }
          .eod-sms-optin-qr__url { font-size: 12px; }
        }
        .eod-sms-optin-qr__cta {
          margin: 4px 0 0;
          font-size: 15px;
          font-weight: 600;
          color: #f8fafc;
          text-align: center;
        }
        .eod-sms-optin-qr__url {
          margin: 0;
          font-family: ui-monospace, "IBM Plex Mono", monospace;
          font-size: 13px;
          color: #94a3b8;
          text-align: center;
        }
        .eod-sms-optin-qr__collapse { margin-top: 4px; }
      `;
      document.head.appendChild(style);
    }

    const toggle = document.getElementById('eodSmsOptinQrToggle');
    const panel = document.getElementById('eodSmsOptinQrPanel');
    const collapse = document.getElementById('eodSmsOptinQrCollapse');

    function applyState(expanded) {
      block.classList.toggle('is-expanded', expanded);
      toggle.setAttribute('aria-expanded', expanded ? 'true' : 'false');
      if (expanded) panel.removeAttribute('hidden');
      else panel.setAttribute('hidden', '');
    }

    toggle.addEventListener('click', () => {
      const next = !block.classList.contains('is-expanded');
      applyState(next);
      setExpanded(next);
    });
    collapse.addEventListener('click', () => {
      applyState(false);
      setExpanded(false);
    });

    applyState(isExpanded());
  }

  window.EodSmsOptinQr = { ensureUi };

  document.addEventListener('DOMContentLoaded', () => ensureUi());
})();
