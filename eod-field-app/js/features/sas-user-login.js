/* Per-lead SAS + SI login. Pattern lock proves the TOTP owner. */
(function (global) {
  'use strict';

  const REFRESH_COOLDOWN_MS = 10 * 60 * 1000;
  const REFRESH_COOLDOWN_KEY = 'eodSasUserRefreshAt';
  let status = null;
  let statusAt = 0;
  const STATUS_TTL_MS = 15 * 1000;
  const patternLocks = new Map();

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
      hasPattern: !!data.hasPattern,
      usernameHint: data.usernameHint || '',
      siConnected: !!data.siConnected,
      siUsernameHint: data.siUsernameHint || '',
      lastRefreshError: data.lastRefreshError || '',
      sharedActor: !!data.sharedActor,
    };
    statusAt = Date.now();
    return status;
  }

  function isConnected() {
    return !!status?.connected;
  }

  async function requireConnected(opts) {
    const cur = await fetchStatus();
    if (!cur.connected) return { ok: false, message: 'Connect Your SAS + SI on the visit page' };
    if (opts?.slot === 'after' && !cur.sharedActor && !cur.siConnected) {
      return { ok: false, message: 'Connect Store Intelligence on the visit page' };
    }
    return { ok: true };
  }

  function bindPatternLock(host) {
    if (!host) return { value: () => [] };
    const dots = [...host.querySelectorAll('[data-dot]')];
    const svg = host.querySelector('svg');
    const active = [];
    let drawing = false;

    function centerOf(el) {
      const wrap = host.getBoundingClientRect();
      const box = el.getBoundingClientRect();
      return {
        x: ((box.left + box.width / 2) - wrap.left) / wrap.width * 100,
        y: ((box.top + box.height / 2) - wrap.top) / wrap.height * 100,
      };
    }

    function paint() {
      dots.forEach((el) => {
        el.classList.toggle('on', active.includes(Number(el.dataset.dot)));
      });
      if (!svg) return;
      const pts = active.map((n) => centerOf(dots[n])).filter(Boolean);
      svg.innerHTML = pts.length < 2 ? '' : `<polyline fill="none" stroke="currentColor" stroke-width="2" points="${pts.map((p) => `${p.x},${p.y}`).join(' ')}"></polyline>`;
    }

    function addDot(n) {
      if (!Number.isInteger(n) || n < 0 || n > 8) return;
      if (active.includes(n)) return;
      active.push(n);
      paint();
    }

    function hit(ev) {
      const el = document.elementFromPoint(ev.clientX, ev.clientY);
      const n = Number(el?.closest?.('[data-dot]')?.dataset?.dot);
      if (Number.isInteger(n)) addDot(n);
    }

    host.addEventListener('pointerdown', (ev) => {
      ev.preventDefault();
      drawing = true;
      active.length = 0;
      host.setPointerCapture?.(ev.pointerId);
      hit(ev);
    });
    host.addEventListener('pointermove', (ev) => {
      if (!drawing) return;
      hit(ev);
    });
    host.addEventListener('pointerup', () => { drawing = false; });
    host.addEventListener('pointercancel', () => { drawing = false; });

    return {
      value: () => active.slice(),
    };
  }

  function patternMarkup(id) {
    return `<div class="sas-pattern" data-pattern="${id}" aria-label="Pattern">
      <svg viewBox="0 0 100 100" preserveAspectRatio="none"></svg>
      ${[0, 1, 2, 3, 4, 5, 6, 7, 8].map((i) => `<button type="button" class="sas-pattern-dot" data-dot="${i}" tabindex="-1"></button>`).join('')}
    </div>`;
  }

  function paint(root, cur, busy) {
    if (!root) return;
    patternLocks.clear();
    if (cur.connected) {
      const who = cur.sharedActor ? 'office SAS' : (cur.usernameHint || 'SAS');
      const si = cur.sharedActor ? 'office SI' : (cur.siConnected ? (cur.siUsernameHint || 'SI') : 'SI not connected');
      root.innerHTML = `
        <h2>Your SAS + SI</h2>
        <p class="visit-confirmed">Connected as ${esc(who)}</p>
        <p class="muted">${esc(si)}</p>
        <div class="btn-row" style="margin-top:10px;">
          <button type="button" class="btn btn-secondary" data-sas="refresh" ${busy || cooldownLeft() ? 'disabled' : ''}>Refresh</button>
          ${cur.sharedActor ? '' : '<button type="button" class="btn btn-secondary" data-sas="disconnect">Disconnect</button>'}
        </div>
        <div class="muted" data-sas-msg style="min-height:1.2em;margin-top:8px;"></div>`;
      return;
    }
    root.innerHTML = `
      <h2>Your SAS + SI</h2>
      <div class="field">
        <label for="sasUserUsername">SAS username</label>
        <input type="email" id="sasUserUsername" autocomplete="username">
      </div>
      <div class="field">
        <label for="sasUserPassword">SAS password</label>
        <input type="password" id="sasUserPassword" autocomplete="current-password">
      </div>
      <div class="field">
        <label for="sasUserTotp">Authenticator secret</label>
        <input type="text" id="sasUserTotp" autocomplete="off" spellcheck="false">
      </div>
      <div data-pattern-wrap hidden>
        <label>Pattern</label>
        ${patternMarkup('set')}
        <label>Draw again</label>
        ${patternMarkup('confirm')}
      </div>
      <div class="field">
        <label for="sasUserSiUsername">SI username</label>
        <input type="text" id="sasUserSiUsername" autocomplete="off" spellcheck="false">
      </div>
      <div class="field">
        <label for="sasUserSiPassword">SI password</label>
        <input type="password" id="sasUserSiPassword" autocomplete="off">
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

  function syncPatternVisibility(root) {
    const totp = root.querySelector('#sasUserTotp')?.value.trim();
    const wrap = root.querySelector('[data-pattern-wrap]');
    if (wrap) wrap.hidden = !totp;
  }

  function readFields() {
    return {
      username: document.getElementById('sasUserUsername')?.value.trim() || '',
      password: document.getElementById('sasUserPassword')?.value || '',
      totpSecret: document.getElementById('sasUserTotp')?.value.trim() || '',
      siUsername: document.getElementById('sasUserSiUsername')?.value.trim() || '',
      siPassword: document.getElementById('sasUserSiPassword')?.value || '',
      pattern: patternLocks.get('set')?.value() || [],
      patternConfirm: patternLocks.get('confirm')?.value() || [],
    };
  }

  function writeFields(fields) {
    const map = {
      sasUserUsername: fields.username,
      sasUserPassword: fields.password,
      sasUserTotp: fields.totpSecret,
      sasUserSiUsername: fields.siUsername,
      sasUserSiPassword: fields.siPassword,
    };
    Object.entries(map).forEach(([id, value]) => {
      const el = document.getElementById(id);
      if (el) el.value = value || '';
    });
  }

  async function mount(root) {
    if (!root) return;
    let busy = false;
    const redraw = async (force, keep) => {
      const cur = await fetchStatus(force).catch(() => ({ connected: false }));
      paint(root, cur, busy);
      if (keep) writeFields(keep);
      root.querySelectorAll('[data-pattern]').forEach((el) => {
        patternLocks.set(el.getAttribute('data-pattern'), bindPatternLock(el));
      });
      syncPatternVisibility(root);
      bind();
    };
    const bind = () => {
      root.querySelector('#sasUserTotp')?.addEventListener('input', () => syncPatternVisibility(root));
      root.querySelector('[data-sas="connect"]')?.addEventListener('click', async () => {
        if (busy) return;
        const fields = readFields();
        busy = true;
        paint(root, status || { connected: false }, true);
        writeFields(fields);
        root.querySelectorAll('[data-pattern]').forEach((el) => {
          patternLocks.set(el.getAttribute('data-pattern'), bindPatternLock(el));
        });
        syncPatternVisibility(root);
        setMsg(root, 'Connecting…');
        try {
          const resp = await global.authFetch(`${apiBase()}/api/sas-user/connect`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            skipBusy: true,
            body: JSON.stringify({
              username: fields.username,
              password: fields.password,
              totpSecret: fields.totpSecret,
              pattern: fields.pattern,
              patternConfirm: fields.patternConfirm,
              siUsername: fields.siUsername,
              siPassword: fields.siPassword,
            }),
          });
          const data = await resp.json().catch(() => ({}));
          if (!resp.ok || !data.ok) {
            toast(data.error || 'SAS connect failed', 'error');
            status = { connected: false, lastRefreshError: data.error };
            statusAt = 0;
            await redraw(true, fields);
            setMsg(root, data.error || 'Could not connect');
            return;
          }
          toast('SAS + SI connected', 'ok');
          statusAt = 0;
          await redraw(true);
        } catch (err) {
          await redraw(true, fields);
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
