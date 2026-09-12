/* Reporting-systems login. Pattern unlocks stored creds next time. */
(function (global) {
  'use strict';

  const Logic = global.EodSasUserLoginLogic || {};
  let status = null;
  let statusAt = 0;
  let view = 'idle';
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
    if (!cur.connected) return { ok: false, message: 'Login to the reporting systems on Visit' };
    if (opts?.slot === 'after' && !cur.sharedActor && !cur.siConnected) {
      return { ok: false, message: 'Login to the reporting systems on Visit' };
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

  function paint(root, cur, busy) {
    if (!root) return;
    patternLocks.clear();
    const html = Logic.cardHtml ? Logic.cardHtml(view, cur, busy) : '';
    root.innerHTML = html;
  }

  function setMsg(root, text) {
    const el = root?.querySelector('[data-sas-msg]');
    if (el) el.textContent = text || '';
  }

  function readFields() {
    return {
      username: document.getElementById('sasUserUsername')?.value.trim() || '',
      password: document.getElementById('sasUserPassword')?.value || '',
      totpSecret: document.getElementById('sasUserTotp')?.value.trim() || '',
      siUsername: document.getElementById('sasUserSiUsername')?.value.trim() || '',
      siPassword: document.getElementById('sasUserSiPassword')?.value || '',
      pattern: patternLocks.get('set')?.value() || patternLocks.get('unlock')?.value() || [],
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

  function bindLocks(root) {
    root.querySelectorAll('[data-pattern]').forEach((el) => {
      patternLocks.set(el.getAttribute('data-pattern'), bindPatternLock(el));
    });
  }

  async function mount(root) {
    if (!root) return;
    let busy = false;
    const redraw = async (force, keep, nextView) => {
      const cur = await fetchStatus(force).catch(() => ({ connected: false }));
      if (nextView) view = nextView;
      paint(root, cur, busy);
      if (keep && view === 'form') writeFields(keep);
      bindLocks(root);
      bind();
    };
    const bind = () => {
      root.querySelector('[data-sas="open"]')?.addEventListener('click', async () => {
        const cur = status || await fetchStatus();
        view = Logic.openMode ? Logic.openMode(cur) : 'form';
        await redraw(false);
      });
      root.querySelector('[data-sas="cancel"]')?.addEventListener('click', async () => {
        view = 'idle';
        await redraw(false);
      });
      root.querySelector('[data-sas="form"]')?.addEventListener('click', async () => {
        view = 'form';
        await redraw(false);
      });
      root.querySelector('[data-sas="unlock"]')?.addEventListener('click', async () => {
        if (busy) return;
        const fields = readFields();
        busy = true;
        setMsg(root, 'Unlocking…');
        try {
          const resp = await global.authFetch(`${apiBase()}/api/sas-user/unlock`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            skipBusy: true,
            body: JSON.stringify({ pattern: fields.pattern }),
          });
          const data = await resp.json().catch(() => ({}));
          if (!resp.ok || !data.ok) {
            toast(data.error || 'Unlock failed', 'error');
            statusAt = 0;
            await redraw(true, null, 'unlock');
            setMsg(root, data.error || 'Pattern did not match');
            return;
          }
          toast('Logged in', 'ok');
          statusAt = 0;
          view = 'idle';
          await redraw(true);
          setMsg(root, 'Logged in');
        } catch (err) {
          await redraw(true, null, 'unlock');
          setMsg(root, err.message || 'Unlock failed');
        } finally {
          busy = false;
        }
      });
      root.querySelector('[data-sas="connect"]')?.addEventListener('click', async () => {
        if (busy) return;
        const fields = readFields();
        busy = true;
        paint(root, status || { connected: false }, true);
        writeFields(fields);
        bindLocks(root);
        setMsg(root, 'Saving…');
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
            toast(data.error || 'Login failed', 'error');
            status = { connected: false, lastRefreshError: data.error };
            statusAt = 0;
            await redraw(true, fields, 'form');
            setMsg(root, data.error || 'Could not save');
            return;
          }
          toast('Logged in', 'ok');
          statusAt = 0;
          view = 'idle';
          await redraw(true);
          setMsg(root, 'Logged in');
        } catch (err) {
          await redraw(true, fields, 'form');
          setMsg(root, err.message || 'Could not save');
        } finally {
          busy = false;
        }
      });
    };
    view = 'idle';
    await redraw(true);
  }

  global.EodSasUser = {
    mount,
    fetchStatus,
    requireConnected,
    isConnected,
  };
})(typeof window !== 'undefined' ? window : globalThis);
