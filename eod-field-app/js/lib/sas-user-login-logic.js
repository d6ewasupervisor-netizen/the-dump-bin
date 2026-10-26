/* Reporting-systems login card markup. Lead-scoped, no SAS/SI status copy. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.EodSasUserLoginLogic = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function patternMarkup(id) {
    const dots = [0, 1, 2, 3, 4, 5, 6, 7, 8]
      .map((i) => `<button type="button" class="sas-pattern-dot" data-dot="${i}" tabindex="-1"></button>`)
      .join('');
    return `<div class="sas-pattern" data-pattern="${id}" aria-label="Pattern">
      <svg viewBox="0 0 100 100" preserveAspectRatio="none"></svg>
      ${dots}
    </div>`;
  }

  // Android-style: a straight swipe over an unvisited dot selects it too,
  // so fast lines can't silently skip dots (0->2 includes 1, 0->8 includes 4).
  function jumpMidpoint(a, b) {
    const ai = Number(a);
    const bi = Number(b);
    if (!Number.isInteger(ai) || !Number.isInteger(bi)) return -1;
    if (ai < 0 || ai > 8 || bi < 0 || bi > 8 || ai === bi) return -1;
    const r1 = Math.floor(ai / 3);
    const c1 = ai % 3;
    const r2 = Math.floor(bi / 3);
    const c2 = bi % 3;
    if ((r1 + r2) % 2 !== 0 || (c1 + c2) % 2 !== 0) return -1;
    const mid = ((r1 + r2) / 2) * 3 + ((c1 + c2) / 2);
    return mid === ai || mid === bi ? -1 : mid;
  }

  function openMode(status) {
    if (reportingReady(status)) return 'idle';
    return 'form';
  }

  function leadLine(lead) {
    const name = String(lead?.name || '').trim();
    const email = String(lead?.email || '').trim();
    if (!name && !email) return '';
    const who = esc([name, email].filter(Boolean).join(' — '));
    const state = lead?.connected
      ? 'Logged in'
      : lead?.hasCreds ? 'Saved login found' : 'No saved login yet';
    return `<div class="muted" data-sas-lead style="margin-bottom:8px;">${who} · ${state}</div>`;
  }

  function idleHtml(lead, status) {
    if (status?.needs_reauth) {
      return `${leadLine(lead)}
        <div class="muted">SAS needs you to sign in again.</div>
        <button type="button" class="btn btn-primary btn-block" data-sas="reauth">Sign in again</button>
        <div class="muted" data-sas-msg style="min-height:1.2em;margin-top:8px;"></div>`;
    }
    if (reportingReady(status)) {
      const gone = status?.okta_gone
        ? `<div class="muted" data-sas-okta-gone>Your Okta session ended; sign in again when convenient so the app can keep working without you.</div>`
        : '';
      return `${leadLine(lead)}
        <div class="muted">Signed in.</div>
        ${gone}
        <div class="muted" data-sas-msg style="min-height:1.2em;margin-top:8px;"></div>`;
    }
    return `${leadLine(lead)}<button type="button" class="btn btn-primary btn-block" data-sas="open-setup">Sign in</button>
      <div class="muted" data-sas-msg style="min-height:1.2em;margin-top:8px;"></div>`;
  }

  function formHtml({ hasPattern, busy, lead, defaults, patternStep, formStep, reauth } = {}) {
    const fs = formStep || 'sas';

    if (fs === 'sas') {
      const user = esc(defaults?.username || '');
      return `${leadLine(lead)}
        <p class="muted" data-sas-two-prompts style="margin:0 0 12px;">Okta will send two prompts. Approve both on your phone.</p>
        <div class="field">
          <label for="sasUserUsername">Okta username</label>
          <input type="text" id="sasUserUsername" autocomplete="username" autocapitalize="none" spellcheck="false" value="${user}">
        </div>
        <div class="field">
          <label for="sasUserPassword">Password</label>
          <input type="password" id="sasUserPassword" autocomplete="current-password">
        </div>
        <div class="field">
          <label for="sasUserCode">Google Authenticator codes <span class="muted">(optional — leave both blank for the two Okta prompts)</span></label>
          <div class="btn-row">
            <input type="text" id="sasUserCode" class="sas-otp" inputmode="numeric" autocomplete="one-time-code" maxlength="6" pattern="[0-9]{6}" placeholder="First code" aria-label="First code">
            <input type="text" id="sasUserCode2" class="sas-otp" inputmode="numeric" autocomplete="off" maxlength="6" pattern="[0-9]{6}" placeholder="Second code" aria-label="Second code">
          </div>
        </div>
        <div class="muted" data-sas-progress style="min-height:1.2em;margin-top:8px;"></div>
        <div class="btn-row">
          <button type="button" class="btn btn-primary" data-sas="sign-in" data-sas-reauth="${reauth ? '1' : '0'}" ${busy ? 'disabled' : ''}>Sign in</button>
          <button type="button" class="btn btn-secondary" data-sas="cancel">Cancel</button>
        </div>
        <div class="muted" data-sas-msg style="min-height:1.2em;margin-top:8px;"></div>`;
    }

    // ── Step 3: Pattern ───────────────────────────────────────────────────────
    const step = patternStep || 'set';
    const saveOk = step === 'done';
    let patSection;
    if (step === 'done') {
      patSection = `<div class="sas-pattern-ready" style="padding:10px 0;color:var(--color-ok,#2a7);">✓ Pattern ready</div>`;
    } else if (step === 'confirm') {
      patSection = `<div class="field">
          <label>Draw it again to confirm</label>
          ${patternMarkup('confirm')}
        </div>`;
    } else {
      const hint = hasPattern
        ? `<div class="muted" style="margin-bottom:6px;font-size:0.85em;">Draw your existing pattern to authorize this update</div>`
        : `<div class="muted" style="margin-bottom:6px;font-size:0.85em;">At least 4 dots — you\'ll draw it again to confirm</div>`;
      patSection = `<div class="field">
          <label>Pattern</label>
          ${hint}
          ${patternMarkup('set')}
        </div>`;
    }
    return `${leadLine(lead)}
      <div class="muted" style="margin-bottom:8px;font-size:0.85em;">Step 3 of 3 — Set your pattern</div>
      ${patSection}
      <div class="btn-row">
        <button type="button" class="btn btn-primary" data-sas="connect" ${busy || !saveOk ? 'disabled' : ''}>Save</button>
        <button type="button" class="btn btn-secondary" data-sas="back-pattern">← Back</button>
      </div>
      <div class="btn-row">
        <button type="button" class="btn btn-secondary" data-sas="make-handoff" ${busy ? 'disabled' : ''}>Set OTP</button>
      </div>
      <div class="muted" data-sas-msg style="min-height:1.2em;margin-top:8px;"></div>`;
  }

  /* Unlock: one pattern box, auto-submits on pattern complete.
     The "Unlock" button is kept as a fallback (accessibility / hesitant drawers). */
  function unlockHtml({ busy, lead } = {}) {
    return `${leadLine(lead)}
      <div class="field">
        <label>Pattern</label>
        ${patternMarkup('unlock')}
      </div>
      <div class="btn-row">
        <button type="button" class="btn btn-primary" data-sas="unlock" ${busy ? 'disabled' : ''}>Unlock</button>
        <button type="button" class="btn btn-secondary" data-sas="form">Different credentials</button>
        <button type="button" class="btn btn-secondary" data-sas="cancel">Cancel</button>
      </div>
      <div class="btn-row">
        <button type="button" class="btn btn-secondary" data-sas="handoff">Use handoff code</button>
        <button type="button" class="btn btn-secondary" data-sas="master">Supervisor takeover</button>
      </div>
      <div class="muted" data-sas-msg style="min-height:1.2em;margin-top:8px;"></div>`;
  }

  function handoffHtml({ busy, lead } = {}) {
    return `${leadLine(lead)}
      <div class="field">
        <label for="sasHandoffCode">6-digit handoff code</label>
        <input type="text" id="sasHandoffCode" inputmode="numeric" autocomplete="off" spellcheck="false" maxlength="6">
      </div>
      <div class="btn-row">
        <button type="button" class="btn btn-primary" data-sas="handoff-redeem" ${busy ? 'disabled' : ''}>Use code once</button>
        <button type="button" class="btn btn-secondary" data-sas="cancel">Cancel</button>
      </div>
      <div class="muted" data-sas-msg style="min-height:1.2em;margin-top:8px;"></div>`;
  }

  /* Master unlock: one pattern box, auto-submits on pattern complete. */
  function masterHtml({ busy, lead } = {}) {
    return `${leadLine(lead)}
      <div class="field">
        <label>Master pattern</label>
        ${patternMarkup('master')}
      </div>
      <div class="btn-row">
        <button type="button" class="btn btn-primary" data-sas="master-unlock" ${busy ? 'disabled' : ''}>Take over login</button>
        <button type="button" class="btn btn-secondary" data-sas="cancel">Cancel</button>
      </div>
      <div class="btn-row">
        <button type="button" class="btn btn-secondary" data-sas="master-setup">Set master pattern</button>
      </div>
      <div class="muted" data-sas-msg style="min-height:1.2em;margin-top:8px;"></div>`;
  }

  /* masterStep: 'set' | 'confirm' | 'done' — sequential, same logic as formHtml pattern. */
  function masterSetupHtml({ busy, lead, masterStep } = {}) {
    const step = masterStep || 'set';
    let patSection;
    if (step === 'done') {
      patSection = `<div class="sas-pattern-ready" style="padding:10px 0;color:var(--color-ok,#2a7);">✓ Pattern ready — tap Save</div>`;
    } else if (step === 'confirm') {
      patSection = `<div class="field">
        <label>Draw it again to confirm</label>
        ${patternMarkup('masterConfirm')}
      </div>`;
    } else {
      patSection = `<div class="field">
        <label>Master pattern</label>
        <div class="muted" style="margin-bottom:6px;font-size:0.85em;">At least 4 dots — you\'ll draw it again to confirm</div>
        ${patternMarkup('masterSet')}
      </div>`;
    }
    return `${leadLine(lead)}
      ${patSection}
      <div class="btn-row">
        <button type="button" class="btn btn-primary" data-sas="master-save" ${busy || step !== 'done' ? 'disabled' : ''}>Save master pattern</button>
        <button type="button" class="btn btn-secondary" data-sas="master">Back</button>
      </div>
      <div class="muted" data-sas-msg style="min-height:1.2em;margin-top:8px;"></div>`;
  }

  function cardHtml(mode, status, busy, extra) {
    const lead = extra?.lead || null;
    if (mode === 'form') return formHtml({
      hasPattern: !!status?.hasPattern,
      busy,
      lead,
      defaults: extra?.defaults,
      patternStep: extra?.patternStep,
      formStep: extra?.formStep,
      reauth: !!extra?.reauth,
    });
    if (mode === 'unlock') return unlockHtml({ busy, lead });
    if (mode === 'handoff') return handoffHtml({ busy, lead });
    if (mode === 'master') return masterHtml({ busy, lead });
    if (mode === 'masterSetup') return masterSetupHtml({ busy, lead, masterStep: extra?.masterStep });
    return idleHtml(lead, status);
  }

  function bannedCopy(html) {
    return /your sas \+ si|office sas|office si/i.test(String(html || ''));
  }

  // Title-bar "Signed in" is this lead's live PROD/SAS Okta session.
  // A Dump Bin name, a shared office session, or SAS cookies after Okta died
  // do not count. SI is a separate light.
  function prodSasSignedIn(status) {
    if (!status || !status.connected || status.okta_gone || status.needs_reauth) return false;
    return true;
  }

  // The office shared actor is not a lead Okta session.
  function leadProdSignedIn(status) {
    if (!status || status.sharedActor) return false;
    return prodSasSignedIn(status);
  }

  // Third chrome light.
  // green: that lead's PROD/Okta session is live.
  // orange: in the app, and that lead is not in PROD.
  // red: signed into the app, and not a lead, supervisor, or admin.
  // Admin, and a supervisor who is not a lead, use the scheduled lead's session.
  function leadOktaLight({
    roles,
    appLoggedIn,
    rolesLoaded,
    statusKnown,
    prodSignedIn,
    scheduledLeadKnown,
  } = {}) {
    if (!appLoggedIn || !rolesLoaded) return 'unknown';
    const list = Array.isArray(roles) ? roles.map((r) => String(r || '').toLowerCase()) : [];
    const isAdmin = list.includes('admin');
    const isSupervisor = list.includes('supervisor');
    const isLead = list.includes('lead');
    if (!isLead && !isSupervisor && !isAdmin) return 'red';
    if (isAdmin || (isSupervisor && !isLead)) {
      if (!scheduledLeadKnown || !statusKnown) return 'unknown';
      return prodSignedIn ? 'green' : 'orange';
    }
    if (!statusKnown) return 'unknown';
    return prodSignedIn ? 'green' : 'orange';
  }

  function oktaBoardHtml(board) {
    const live = Array.isArray(board?.live) ? board.live : [];
    const offline = Array.isArray(board?.offline) ? board.offline : [];
    const line = (person) => {
      const bits = [person.email, person.until, person.reason].filter(Boolean);
      return `<div class="okta-board-row"><strong>${esc(person.name || person.email || '')}</strong> <span class="muted">${esc(bits.join(' · '))}</span></div>`;
    };
    const block = (rows) => (rows.length ? rows.map(line).join('') : '<div class="muted">Nobody</div>');
    return `<h3>Live</h3>${block(live)}<h3>Not signed in</h3>${block(offline)}`;
  }

  // The app identity and reporting identity are separate. Knowing the lead's
  // name means the Dump Bin session is alive; it does not mean PROD or SI is.
  function reportingReady(status) {
    return !!(status && (status.sharedActor || (status.connected && status.siConnected)));
  }

  // Shutter gate. A shot goes through when PROD will take it: the lead's own
  // session, the shared actor, or the shared session carrying it (uploadReady
  // from /api/sas-user/status). Whether the lead still owes a sign-in is the
  // card's business, not the camera's.
  function captureVerdict(status) {
    if (!status || !(status.connected || status.sharedActor || status.uploadReady)) {
      return { ok: false, message: 'Sign in' };
    }
    return { ok: true };
  }

  return {
    jumpMidpoint,
    openMode,
    captureVerdict,
    prodSasSignedIn,
    leadProdSignedIn,
    leadOktaLight,
    oktaBoardHtml,
    reportingReady,
    idleHtml,
    formHtml,
    unlockHtml,
    handoffHtml,
    masterHtml,
    masterSetupHtml,
    cardHtml,
    patternMarkup,
    leadLine,
    bannedCopy,
  };
});
