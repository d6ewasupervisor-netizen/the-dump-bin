/* Per-lead SAS Retail login — same Okta+TOTP mint as office auth, this account only. */
(function (global) {
  'use strict';

  const REFRESH_COOLDOWN_MS = 10 * 60 * 1000;
  const REFRESH_COOLDOWN_KEY = 'eodSasUserRefreshAt';
  let status = null;
  let statusAt = 0;
  const STATUS_TTL_MS = 15 * 1000;

  function apiBase() {
    return global.EOD_API_BASE;
  }

  function toast(msg, kind) {
    if (typeof global.showToast === 'function') {
      global.showToast(msg, kind || 'info');
      return;
    }
    console.info('[sas-user]', msg);
  }

  function cooldownLeft() {
    const last = parseInt(localStorage.getItem(REFRESH_COOLDOWN_KEY) || '0', 10);
    if (!last) return 0;
    return Math.max(0, REFRESH_COOLDOWN_MS - (Date.now() - last));
  }

  async function fetchStatus(force) {
    if (!force && status && Date.now() - statusAt < STATUS_TTL_MS) return status;
    const resp = await global.authFetch(`${apiBase()}/api/sas-user/status`, {
      skipBusy: true,
      noBounceOn401: true,
    });
    const data = resp.ok ? await resp.json().catch(() => ({})) : {};
    status = {
      connected: !!data.connected,
      hasCreds: !!data.hasCreds,
      usernameHint: data.usernameHint || '',
      lastRefreshError: data.lastRefreshError || '',
      sharedActor: !!data.sharedActor,
    };
    statusAt = Date.now();
    return status;
  }

  function isConnected() {
    return !!status?.connected;
  }

  async function requireConnected() {
    const cur = await fetchStatus();
    if (cur.connected) return { ok: true };
    return { ok: false, message: 'Connect Your SAS on the visit page' };
  }

  function paint(root, cur, busy) {
    if (!root) return;
    if (cur.connected) {
      const who = cur.sharedActor ? 'office SAS' : (cur.usernameHint || 'SAS');
      root.innerHTML = `
        <h2>Your SAS</h2>
        <p class="visit-confirmed">Connected as ${esc(who)}</p>
        <div class="btn-row" style="margin-top:10px;">
          <button type="button" class="btn btn-secondary" data-sas="refresh" ${busy || cooldownLeft() ? 'disabled' : ''}>Refresh</button>
          ${cur.sharedActor ? '' : '<button type="button" class="btn btn-secondary" data-sas="disconnect">Disconnect</button>'}
        </div>
        <div class="muted" data-sas-msg style="min-height:1.2em;margin-top:8px;"></div>`;
      return;
    }
    root.innerHTML = `
      <h2>Your SAS</h2>
      <div class="field">
        <label for="sasUserUsername">Username</label>
        <input type="email" id="sasUserUsername" autocomplete="username">
      </div>
      <div class="field">
        <label for="sasUserPassword">Password</label>
        <input type="password" id="sasUserPassword" autocomplete="current-password">
      </div>
      <div class="field">
        <label for="sasUserTotp">Authenticator secret</label>
        <input type="text" id="sasUserTotp" autocomplete="off" spellcheck="false">
      </div>
      <button type="button" class="btn btn-primary btn-block" data-sas="connect" ${busy ? 'disabled' : ''}>Connect</button>
      <div class="muted" data-sas-msg style="min-height:1.2em;margin-top:8px;"></div>`;
  }

  function esc(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function setMsg(root, text) {
    const el = root?.querySelector('[data-sas-msg]');
    if (el) el.textContent = text || '';
  }

  async function mount(root) {
    if (!root) return;
    let busy = false;
    const redraw = async (force) => {
      const cur = await fetchStatus(force).catch(() => ({ connected: false }));
      paint(root, cur, busy);
      bind();
    };
    const bind = () => {
      root.querySelector('[data-sas="connect"]')?.addEventListener('click', async () => {
        if (busy) return;
        const username = document.getElementById('sasUserUsername')?.value.trim();
        const password = document.getElementById('sasUserPassword')?.value || '';
        const totpSecret = document.getElementById('sasUserTotp')?.value.trim();
        busy = true;
        paint(root, status || { connected: false }, true);
        const userEl = document.getElementById('sasUserUsername');
        const passEl = document.getElementById('sasUserPassword');
        const totpEl = document.getElementById('sasUserTotp');
        if (userEl) userEl.value = username || '';
        if (passEl) passEl.value = password || '';
        if (totpEl) totpEl.value = totpSecret || '';
        setMsg(root, 'Connecting…');
        try {
          const resp = await global.authFetch(`${apiBase()}/api/sas-user/connect`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            skipBusy: true,
            body: JSON.stringify({ username, password, totpSecret }),
          });
          const data = await resp.json().catch(() => ({}));
          if (!resp.ok || !data.ok) {
            toast(data.error || 'SAS connect failed', 'error');
            status = { connected: false, lastRefreshError: data.error };
            statusAt = 0;
            await redraw(true);
            setMsg(root, data.error || 'Could not connect');
            return;
          }
          toast('SAS connected', 'ok');
          statusAt = 0;
          await redraw(true);
        } catch (err) {
          await redraw(true);
          setMsg(root, err.message || 'Could not connect');
        } finally {
          busy = false;
        }
      });
      root.querySelector('[data-sas="disconnect"]')?.addEventListener('click', async () => {
        await global.authFetch(`${apiBase()}/api/sas-user/disconnect`, {
          method: 'POST',
          skipBusy: true,
        });
        statusAt = 0;
        await redraw(true);
      });
      root.querySelector('[data-sas="refresh"]')?.addEventListener('click', async () => {
        if (cooldownLeft() > 0) return;
        localStorage.setItem(REFRESH_COOLDOWN_KEY, String(Date.now()));
        const resp = await global.authFetch(`${apiBase()}/api/sas-user/refresh`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          skipBusy: true,
          body: JSON.stringify({ force: true }),
        });
        const data = await resp.json().catch(() => ({}));
        statusAt = 0;
        await redraw(true);
        setMsg(root, data.ok ? (data.skipped ? 'Still fresh' : 'Refreshed') : (data.error || 'Refresh failed'));
      });
    };
    await redraw(true);
  }

  global.EodSasUser = {
    mount,
    fetchStatus,
    requireConnected,
    isConnected,
  };
})(typeof window !== 'undefined' ? window : globalThis);
