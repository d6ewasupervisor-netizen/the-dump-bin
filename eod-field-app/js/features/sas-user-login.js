/* Reporting-systems login, scoped to the shift lead. Pattern unlocks stored
   creds next time. Handoff codes are single-use; the master pattern is the
   supervisor takeover path. Nothing here ever displays a stored secret. */
(function (global) {
  'use strict';

  const Logic = global.EodSasUserLoginLogic || {};
  let status = null;
  let statusAt = 0;
  let statusFor = '';
  let view = 'idle';
  let rootEl = null;
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

  function leadContext() {
    const S = global.EodSession || {};
    const st = S.state || {};
    const shift = st.selectedShift || {};
    const name = String(
      (typeof S.resolvedLeadName === 'function' ? S.resolvedLeadName() : '')
      || st.leadName || st.profileName || shift.visitLead || shift.leadName || ''
    ).trim();
    const email = String(
      st.profileEmail
      || shift.visitLeadEmail || shift.leadEmail || shift.email
      || global.EodRoles?.getMe?.()?.email
      || ''
    ).trim();
    return { name, email };
  }

  function leadParam() {
    const lead = leadContext();
    return lead.email || '';
  }

  async function fetchStatus(force) {
    const leadEmail = leadParam();
    if (!force && status && statusFor === leadEmail && Date.now() - statusAt < STATUS_TTL_MS) return status;
    const qs = leadEmail ? `?leadEmail=${encodeURIComponent(leadEmail)}` : '';
    const resp = await global.authFetch(`${apiBase()}/api/sas-user/status${qs}`, {
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
    statusFor = leadEmail;
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

  let repaintCurrent = null;

  function paint(root, cur, busy, keep) {
    if (!root) return;
    patternLocks.clear();
    const lead = leadContext();
    const defaults = keep ? {
      username: keep.username,
      siUsername: keep.siUsername,
    } : {
      username: lead.email,
      siUsername: lead.email,
    };
    const html = Logic.cardHtml ? Logic.cardHtml(view, cur, busy, {
      lead: {
        name: lead.name,
        email: lead.email,
        connected: !!cur?.connected,
        hasCreds: !!cur?.hasCreds,
      },
      defaults,
    }) : '';
    root.innerHTML = html;
    if (!keep) applyLeadDefaults(root, lead);
  }

  function applyLeadDefaults(root, lead) {
    if (!lead?.email) return;
    const user = root.querySelector('#sasUserUsername');
    if (user && !user.value.trim()) user.value = lead.email;
    const siUser = root.querySelector('#sasUserSiUsername');
    if (siUser && !siUser.value.trim()) siUser.value = lead.email;
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
      handoffCode: document.getElementById('sasHandoffCode')?.value.trim() || '',
      pattern: patternLocks.get('set')?.value() || patternLocks.get('unlock')?.value() || [],
      patternConfirm: patternLocks.get('confirm')?.value() || [],
      masterPattern: patternLocks.get('master')?.value() || [],
      masterSet: patternLocks.get('masterSet')?.value() || [],
      masterConfirm: patternLocks.get('masterConfirm')?.value() || [],
    };
  }

  function writeFields(fields) {
    const map = {
      sasUserUsername: fields.username,
      sasUserPassword: fields.password,
      sasUserTotp: fields.totpSecret,
      sasUserSiUsername: fields.siUsername,
      sasUserSiPassword: fields.siPassword,
      sasHandoffCode: fields.handoffCode,
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

  async function postJson(path, body) {
    const leadEmail = leadParam();
    const resp = await global.authFetch(`${apiBase()}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      skipBusy: true,
      body: JSON.stringify({ ...(body || {}), ...(leadEmail ? { leadEmail } : {}) }),
    });
    const data = await resp.json().catch(() => ({}));
    return { resp, data };
  }

  async function mount(root) {
    if (!root) return;
    rootEl = root;
    let busy = false;
    const redraw = async (force, keep, nextView) => {
      const cur = await fetchStatus(force).catch(() => ({ connected: false }));
      if (nextView) view = nextView;
      paint(root, cur, busy, keep);
      bindLocks(root);
      bind();
    };
    repaintCurrent = async (nextView, force = true) => {
      if (nextView) view = nextView;
      if (force) statusAt = 0;
      const cur = await fetchStatus(force).catch(() => ({ connected: false }));
      paint(root, cur, false);
      bindLocks(root);
      bind();
    };
    const bind = () => {
      root.querySelector('[data-sas="open"]')?.addEventListener('click', async () => {
        const cur = status && statusFor === leadParam() ? status : await fetchStatus();
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
      root.querySelector('[data-sas="handoff"]')?.addEventListener('click', async () => {
        view = 'handoff';
        await redraw(false);
      });
      root.querySelector('[data-sas="master"]')?.addEventListener('click', async () => {
        view = 'master';
        await redraw(false);
      });
      root.querySelector('[data-sas="master-setup"]')?.addEventListener('click', async () => {
        view = 'masterSetup';
        await redraw(false);
      });
      root.querySelector('[data-sas="make-handoff"]')?.addEventListener('click', async () => {
        if (busy) return;
        busy = true;
        setMsg(root, 'Making a one-time code…');
        try {
          const { resp, data } = await postJson('/api/sas-user/handoff/create', {});
          if (!resp.ok || !data.ok) {
            toast(data.error || 'Could not make a code', 'error');
            setMsg(root, data.error || 'Could not make a code');
            return;
          }
          toast(`Handoff code ${data.code} — one use, 15 minutes`, 'ok');
          setMsg(root, `Handoff code ${data.code} — one use, 15 minutes. Read it out, it shows once.`);
        } catch (err) {
          setMsg(root, err.message || 'Could not make a code');
        } finally {
          busy = false;
        }
      });
      root.querySelector('[data-sas="handoff-redeem"]')?.addEventListener('click', async () => {
        if (busy) return;
        const fields = readFields();
        busy = true;
        setMsg(root, 'Using code…');
        try {
          const { resp, data } = await postJson('/api/sas-user/handoff/redeem', { code: fields.handoffCode });
          if (!resp.ok || !data.ok) {
            toast(data.error || 'Code did not work', 'error');
            statusAt = 0;
            await redraw(true, null, 'handoff');
            setMsg(root, data.error || 'Code did not work');
            return;
          }
          toast('Logged in', 'ok');
          statusAt = 0;
          view = 'idle';
          await redraw(true);
          setMsg(root, 'Logged in');
        } catch (err) {
          await redraw(true, null, 'handoff');
          setMsg(root, err.message || 'Code did not work');
        } finally {
          busy = false;
        }
      });
      root.querySelector('[data-sas="master-unlock"]')?.addEventListener('click', async () => {
        if (busy) return;
        const fields = readFields();
        busy = true;
        setMsg(root, 'Taking over…');
        try {
          const { resp, data } = await postJson('/api/sas-user/master/unlock-for-lead', {
            masterPattern: fields.masterPattern,
          });
          if (!resp.ok || !data.ok) {
            toast(data.error || 'Takeover failed', 'error');
            statusAt = 0;
            await redraw(true, null, 'master');
            setMsg(root, data.error || 'Master pattern did not match');
            return;
          }
          toast('Logged in', 'ok');
          statusAt = 0;
          view = 'idle';
          await redraw(true);
          setMsg(root, 'Logged in');
        } catch (err) {
          await redraw(true, null, 'master');
          setMsg(root, err.message || 'Takeover failed');
        } finally {
          busy = false;
        }
      });
      root.querySelector('[data-sas="master-save"]')?.addEventListener('click', async () => {
        if (busy) return;
        const fields = readFields();
        busy = true;
        setMsg(root, 'Saving…');
        try {
          const { resp, data } = await postJson('/api/sas-user/master/setup', {
            pattern: fields.masterSet,
            patternConfirm: fields.masterConfirm,
          });
          if (!resp.ok || !data.ok) {
            toast(data.error || 'Could not save', 'error');
            setMsg(root, data.error || 'Could not save');
            return;
          }
          toast('Master pattern saved', 'ok');
          view = 'master';
          await redraw(false);
          setMsg(root, 'Master pattern saved');
        } catch (err) {
          setMsg(root, err.message || 'Could not save');
        } finally {
          busy = false;
        }
      });
      root.querySelector('[data-sas="unlock"]')?.addEventListener('click', async () => {
        if (busy) return;
        const fields = readFields();
        busy = true;
        setMsg(root, 'Unlocking…');
        try {
          const { resp, data } = await postJson('/api/sas-user/unlock', { pattern: fields.pattern });
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
        paint(root, status || { connected: false }, true, fields);
        bindLocks(root);
        setMsg(root, 'Saving…');
        try {
          const { resp, data } = await postJson('/api/sas-user/connect', {
            username: fields.username,
            password: fields.password,
            totpSecret: fields.totpSecret,
            pattern: fields.pattern,
            patternConfirm: fields.patternConfirm,
            siUsername: fields.siUsername,
            siPassword: fields.siPassword,
          });
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
    try {
      const S = global.EodSession;
      if (S?.on) {
        let t = null;
        S.on(() => {
          if (t) clearTimeout(t);
          t = setTimeout(() => { t = null; void refreshLead(); }, 400);
        });
      }
    } catch (_) { /* optional live follow */ }
  }

  async function refreshLead() {
    if (!rootEl || !rootEl.isConnected || !repaintCurrent) return;
    if (view !== 'idle') return;
    if (leadParam() === statusFor) {
      await repaintCurrent(null, false);
      return;
    }
    await repaintCurrent('idle');
  }

  global.EodSasUser = {
    mount,
    fetchStatus,
    requireConnected,
    isConnected,
    refreshLead,
    leadContext,
  };
})(typeof window !== 'undefined' ? window : globalThis);
