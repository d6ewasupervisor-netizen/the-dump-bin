/* Reporting-systems login, scoped to the shift lead. Pattern unlocks stored
   creds next time. Handoff codes are single-use; the master pattern is the
   supervisor takeover path. Nothing here ever displays a stored secret. */
(function (global) {
  'use strict';

  const Logic = global.EodSasUserLoginLogic || {};

  // ── Status cache ────────────────────────────────────────────────────────────
  let status = null;
  let statusAt = 0;
  let statusFor = '';
  const STATUS_TTL_MS = 15 * 1000;

  // ── UI state ─────────────────────────────────────────────────────────────────
  let view = 'idle';
  let busy = false;
  let rootEl = null;

  // ── Pattern state ─────────────────────────────────────────────────────────────
  // 'set' → user draws first pass; 'confirm' → second pass to confirm; 'done' → matched
  let patternStep = 'set';
  let patternFirstValue = [];      // stored after successful first draw
  let masterPatternStep = 'set';
  let masterPatternFirstValue = [];

  // ── Form wizard state ─────────────────────────────────────────────────────────
  // 'sas' → step 1; 'si' → step 2; 'pattern' → step 3
  let formStep = 'sas';
  let formDraft = {};   // field values carried across steps

  // ── Pattern lock registry ─────────────────────────────────────────────────────
  const patternLocks = new Map();

  // ── Cross-component references (set inside mount) ─────────────────────────────
  let repaintCurrent = null;  // fetches fresh status + repaints
  let paintAndBind = null;    // repaints + rebinds without fetching

  // ─────────────────────────────────────────────────────────────────────────────

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

  // Both SAS (Okta) and Store Intelligence take First.Last. The RO email is
  // rejected outright by Okta for leads provisioned on another domain.
  function signInNameFor(lead) {
    const parts = String(lead?.name || '').replace(/,/g, '').trim().split(/\s+/).filter(Boolean);
    if (parts.length >= 2) return `${parts[0]}.${parts[1]}`;
    return String(lead?.email || '').split('@')[0].trim();
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

  // ── Pattern lock ──────────────────────────────────────────────────────────────

  /* opts.onComplete(value) is called on pointerup when at least opts.minDots
     (default 4) dots are drawn. Fires once per gesture. */
  function bindPatternLock(host, opts) {
    if (!host) return { value: () => [] };
    const minDots = (opts && opts.minDots) || 4;
    const onComplete = opts && opts.onComplete;
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
      const prev = active.length ? active[active.length - 1] : -1;
      const mid = Logic.jumpMidpoint ? Logic.jumpMidpoint(prev, n) : -1;
      if (mid >= 0 && !active.includes(mid)) active.push(mid);
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
    host.addEventListener('pointerup', () => {
      drawing = false;
      if (onComplete && active.length >= minDots) onComplete(active.slice());
    });
    host.addEventListener('pointercancel', () => { drawing = false; });

    return {
      value: () => active.slice(),
    };
  }

  // ── Repaint helpers ───────────────────────────────────────────────────────────

  function setMsg(root, text) {
    const el = (root || rootEl)?.querySelector('[data-sas-msg]');
    if (el) el.textContent = text || '';
  }

  function readFields() {
    // Pattern: when the sequential flow is done, use the stored first value
    // (which was confirmed to match).  Otherwise fall back to what's drawn.
    const pat = (patternStep === 'done')
      ? patternFirstValue
      : (patternLocks.get('set')?.value() || patternLocks.get('unlock')?.value() || []);
    const masterPat = (masterPatternStep === 'done')
      ? masterPatternFirstValue
      : (patternLocks.get('masterSet')?.value() || []);

    // Fall back to formDraft for fields that aren't in the DOM on steps 2 & 3.
    return {
      username: document.getElementById('sasUserUsername')?.value.trim() || formDraft.username || '',
      password: document.getElementById('sasUserPassword')?.value || formDraft.password || '',
      totpSecret: document.getElementById('sasUserTotp')?.value.trim() || formDraft.totpSecret || '',
      siUsername: document.getElementById('sasUserSiUsername')?.value.trim() || formDraft.siUsername || '',
      siPassword: document.getElementById('sasUserSiPassword')?.value || formDraft.siPassword || '',
      handoffCode: document.getElementById('sasHandoffCode')?.value.trim() || '',
      pattern: pat,
      patternConfirm: pat,   // always equal — backend validates against stored or uses both
      masterPattern: patternLocks.get('master')?.value() || [],
      masterSet: masterPat,
      masterConfirm: masterPat,
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

  function resetPatternState() {
    patternStep = 'set';
    patternFirstValue = [];
    masterPatternStep = 'set';
    masterPatternFirstValue = [];
  }

  function resetFormState() {
    formStep = 'sas';
    formDraft = {};
    resetPatternState();
  }

  // ── paint ─────────────────────────────────────────────────────────────────────

  function paint(root, cur, isBusy, keep) {
    if (!root) return;
    patternLocks.clear();
    const lead = leadContext();
    const defaults = keep ? {
      username: keep.username,
      siUsername: keep.siUsername,
    } : {
      username: formDraft.username || signInNameFor(lead),
      siUsername: formDraft.siUsername || signInNameFor(lead),
    };
    const html = Logic.cardHtml ? Logic.cardHtml(view, cur, isBusy, {
      lead: {
        name: lead.name,
        email: lead.email,
        connected: !!cur?.connected,
        hasCreds: !!cur?.hasCreds,
      },
      defaults,
      patternStep,
      masterStep: masterPatternStep,
      formStep,
    }) : '';
    root.innerHTML = html;
    if (!keep) applyLeadDefaults(root, lead);
  }

  function applyLeadDefaults(root, lead) {
    if (!lead?.email) return;
    const user = root.querySelector('#sasUserUsername');
    if (user && !user.value.trim()) user.value = signInNameFor(lead);
    const siUser = root.querySelector('#sasUserSiUsername');
    if (siUser && !siUser.value.trim()) siUser.value = signInNameFor(lead);
  }

  // ── Pattern lock binding ──────────────────────────────────────────────────────

  function bindLocks(root) {
    root.querySelectorAll('[data-pattern]').forEach((el) => {
      const id = el.getAttribute('data-pattern');
      let opts = {};

      if (id === 'set') {
        // First draw in the credential form
        opts.onComplete = (val) => {
          patternFirstValue = val;
          if (status?.hasPattern) {
            // Updating existing creds — single draw is enough; backend validates
            patternStep = 'done';
          } else {
            // New pattern — require confirmation
            patternStep = 'confirm';
          }
          if (paintAndBind) paintAndBind();
        };
      } else if (id === 'confirm') {
        // Confirmation draw for new pattern
        opts.onComplete = (val) => {
          if (JSON.stringify(val) === JSON.stringify(patternFirstValue)) {
            patternStep = 'done';
            if (paintAndBind) paintAndBind();
          } else {
            setMsg(rootEl, 'Patterns didn\'t match — try again');
            patternStep = 'set';
            patternFirstValue = [];
            if (paintAndBind) paintAndBind();
          }
        };
      } else if (id === 'unlock') {
        // Auto-submit on pattern complete
        opts.onComplete = (val) => doUnlock(val);
      } else if (id === 'master') {
        // Auto-submit master unlock on pattern complete
        opts.onComplete = (val) => doMasterUnlock(val);
      } else if (id === 'masterSet') {
        opts.onComplete = (val) => {
          masterPatternFirstValue = val;
          masterPatternStep = 'confirm';
          if (paintAndBind) paintAndBind();
        };
      } else if (id === 'masterConfirm') {
        opts.onComplete = (val) => {
          if (JSON.stringify(val) === JSON.stringify(masterPatternFirstValue)) {
            masterPatternStep = 'done';
            if (paintAndBind) paintAndBind();
          } else {
            setMsg(rootEl, 'Patterns didn\'t match — try again');
            masterPatternStep = 'set';
            masterPatternFirstValue = [];
            if (paintAndBind) paintAndBind();
          }
        };
      }

      patternLocks.set(id, bindPatternLock(el, opts));
    });
  }

  // ── API helpers ───────────────────────────────────────────────────────────────

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

  // ── Extracted action functions (called from bind() or onComplete) ─────────────

  async function doUnlock(pattern) {
    if (busy) return;
    busy = true;
    setMsg(null, 'Unlocking…');
    try {
      const { resp, data } = await postJson('/api/sas-user/unlock', { pattern });
      if (!resp.ok || !data.ok) {
        toast(data.error || 'Pattern did not match', 'error');
        statusAt = 0;
        if (paintAndBind) paintAndBind();
        setMsg(null, data.error || 'Pattern did not match — try again');
        return;
      }
      toast('Logged in', 'ok');
      statusAt = 0;
      view = 'idle';
      if (repaintCurrent) await repaintCurrent('idle');
    } catch (err) {
      if (paintAndBind) paintAndBind();
      setMsg(null, err.message || 'Unlock failed');
    } finally {
      busy = false;
    }
  }

  async function doMasterUnlock(pattern) {
    if (busy) return;
    busy = true;
    setMsg(null, 'Taking over…');
    try {
      const { resp, data } = await postJson('/api/sas-user/master/unlock-for-lead', {
        masterPattern: pattern,
      });
      if (!resp.ok || !data.ok) {
        toast(data.error || 'Takeover failed', 'error');
        statusAt = 0;
        if (paintAndBind) paintAndBind();
        setMsg(null, data.error || 'Master pattern did not match');
        return;
      }
      toast('Logged in', 'ok');
      statusAt = 0;
      view = 'idle';
      if (repaintCurrent) await repaintCurrent('idle');
    } catch (err) {
      if (paintAndBind) paintAndBind();
      setMsg(null, err.message || 'Takeover failed');
    } finally {
      busy = false;
    }
  }

  // ── mount ─────────────────────────────────────────────────────────────────────

  async function mount(root) {
    if (!root) return;
    rootEl = root;

    const redraw = async (force, keep, nextView) => {
      const cur = await fetchStatus(force).catch(() => ({ connected: false }));
      if (nextView) { view = nextView; resetPatternState(); }
      paint(root, cur, busy, keep);
      bindLocks(root);
      bind();
    };

    repaintCurrent = async (nextView, force = true) => {
      if (nextView) { view = nextView; resetPatternState(); }
      if (force) statusAt = 0;
      const cur = await fetchStatus(force).catch(() => ({ connected: false }));
      paint(root, cur, false);
      bindLocks(root);
      bind();
    };

    // Quick repaint without a status fetch — used by pattern onComplete callbacks
    paintAndBind = () => {
      paint(root, status || { connected: false }, false);
      bindLocks(root);
      bind();
    };

    const bind = () => {
      root.querySelector('[data-sas="open"]')?.addEventListener('click', async () => {
        const cur = status && statusFor === leadParam() ? status : await fetchStatus();
        const nextView = Logic.openMode ? Logic.openMode(cur) : 'form';
        resetFormState();
        view = nextView;
        await redraw(false);
      });
      root.querySelector('[data-sas="cancel"]')?.addEventListener('click', async () => {
        view = 'idle';
        resetFormState();
        await redraw(false);
      });
      root.querySelector('[data-sas="form"]')?.addEventListener('click', async () => {
        resetFormState();
        view = 'form';
        await redraw(false);
      });
      // ── Form wizard step navigation ──────────────────────────────────────────
      root.querySelector('[data-sas="next-sas"]')?.addEventListener('click', async () => {
        const username = document.getElementById('sasUserUsername')?.value.trim() || '';
        const password = document.getElementById('sasUserPassword')?.value || '';
        const totpSecret = document.getElementById('sasUserTotp')?.value.trim() || '';
        if (!username) { setMsg(root, 'Enter your username'); return; }
        if (!password) { setMsg(root, 'Enter your password'); return; }
        if (!totpSecret) { setMsg(root, 'Enter your authenticator setup key'); return; }
        const btn = root.querySelector('[data-sas="next-sas"]');
        if (btn) btn.disabled = true;
        setMsg(root, 'Checking SAS login…');
        try {
          const { resp, data } = await postJson('/api/sas-user/verify-sas', { username, password, totpSecret });
          if (!resp.ok || !data.ok) {
            setMsg(root, data.error || 'SAS login failed — check credentials');
            return;
          }
          formDraft.username = username;
          formDraft.password = password;
          formDraft.totpSecret = totpSecret;
          formStep = 'si';
          if (paintAndBind) paintAndBind();
        } catch (err) {
          const msg = (err && String(err.message || '').toLowerCase().includes('fetch'))
            ? 'Connection error — check your connection and try again'
            : (err.message || 'Failed to verify SAS — check connection');
          setMsg(root, msg);
        } finally {
          if (btn && !btn.closest('[data-sas]')) { /* already re-rendered */ } else if (btn) btn.disabled = false;
        }
      });
      root.querySelector('[data-sas="next-si"]')?.addEventListener('click', async () => {
        const siUsername = document.getElementById('sasUserSiUsername')?.value.trim() || '';
        const siPassword = document.getElementById('sasUserSiPassword')?.value || '';
        if (!siUsername) { setMsg(root, 'Enter your SI username'); return; }
        if (!siPassword) { setMsg(root, 'Enter your SI password'); return; }
        const btn = root.querySelector('[data-sas="next-si"]');
        if (btn) btn.disabled = true;
        setMsg(root, 'Checking SI login…');
        try {
          const { resp, data } = await postJson('/api/sas-user/verify-si', { siUsername, siPassword });
          if (!resp.ok || !data.ok) {
            setMsg(root, data.error || 'SI login failed — check credentials');
            return;
          }
          formDraft.siUsername = siUsername;
          formDraft.siPassword = siPassword;
          formStep = 'pattern';
          resetPatternState();
          if (paintAndBind) paintAndBind();
        } catch (err) {
          setMsg(root, err.message || 'Failed to verify SI — check connection');
        } finally {
          if (btn) btn.disabled = false;
        }
      });
      root.querySelector('[data-sas="back-si"]')?.addEventListener('click', () => {
        formStep = 'sas';
        if (paintAndBind) paintAndBind();
      });
      root.querySelector('[data-sas="back-pattern"]')?.addEventListener('click', () => {
        formStep = 'si';
        resetPatternState();
        if (paintAndBind) paintAndBind();
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
        masterPatternStep = 'set';
        masterPatternFirstValue = [];
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
      // Unlock button — fallback for auto-submit on pattern complete
      root.querySelector('[data-sas="unlock"]')?.addEventListener('click', async () => {
        const fields = readFields();
        await doUnlock(fields.pattern);
      });
      root.querySelector('[data-sas="master-unlock"]')?.addEventListener('click', async () => {
        const fields = readFields();
        await doMasterUnlock(fields.masterPattern);
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
          masterPatternStep = 'set';
          masterPatternFirstValue = [];
          view = 'master';
          await redraw(false);
          setMsg(root, 'Master pattern saved');
        } catch (err) {
          setMsg(root, err.message || 'Could not save');
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
            const isAuthErr = data.code === 'okta_auth_failed' || data.code === 'sas_auth_failed'
              || data.code === 'okta_locked' || data.code === 'okta_password_expired'
              || data.code === 'missing_credentials';
            const msg = data.error
              || (isAuthErr ? 'Wrong username or password — re-enter your SAS credentials' : 'Could not save — start from step 1');
            toast(msg, 'error');
            status = { connected: false, lastRefreshError: data.error };
            statusAt = 0;
            // Go back to SAS step for auth errors so user can fix creds
            if (isAuthErr) {
              formStep = 'sas';
              if (paintAndBind) paintAndBind();
            } else {
              resetFormState();
              await redraw(true, null, 'form');
            }
            setMsg(root, msg);
            return;
          }
          toast('Logged in', 'ok');
          statusAt = 0;
          view = 'idle';
          resetFormState();
          await redraw(true);
          setMsg(root, 'Logged in');
        } catch (err) {
          resetFormState();
          await redraw(true, fields, 'form');
          const msg = (err && String(err.message || '').toLowerCase().includes('fetch'))
            ? 'Connection error — wait 60 seconds and try again from step 1'
            : (err.message || 'Could not save');
          setMsg(root, msg);
        } finally {
          busy = false;
        }
      });
    };

    view = 'idle';
    resetFormState();
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
    resetPatternState();
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
