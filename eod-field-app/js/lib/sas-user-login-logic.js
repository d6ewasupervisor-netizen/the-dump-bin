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
    if (status?.connected || status?.sharedActor) return 'idle';
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
    if (status?.connected || status?.sharedActor) {
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
        <div class="field">
          <label for="sasUserUsername">Username</label>
          <input type="text" id="sasUserUsername" autocomplete="username" autocapitalize="none" spellcheck="false" value="${user}">
        </div>
        <div class="field">
          <label for="sasUserPassword">Password</label>
          <input type="password" id="sasUserPassword" autocomplete="current-password">
        </div>
        <fieldset class="field" style="border:0;padding:0;margin:0 0 12px;">
          <label><input type="radio" name="sasFactor" value="push" checked data-sas-factor="push"> Approve a push on my phone</label>
          <label><input type="radio" name="sasFactor" value="code" data-sas-factor="code"> Enter a six-digit code</label>
        </fieldset>
        <div class="field" data-sas-code hidden>
          <label for="sasUserCode">Six-digit code</label>
          <input type="text" id="sasUserCode" inputmode="numeric" autocomplete="one-time-code" maxlength="6" pattern="[0-9]{6}">
        </div>
        <details data-sas-advanced>
          <summary>Advanced: store an authenticator secret (legacy)</summary>
          <div class="field">
            <label for="sasUserTotp">Authenticator secret</label>
            <input type="text" id="sasUserTotp" autocomplete="off" spellcheck="false" autocapitalize="none">
          </div>
        </details>
        <div class="muted" data-sas-progress style="min-height:1.2em;margin-top:8px;"></div>
        <div class="btn-row">
          <button type="button" class="btn btn-primary" data-sas="sign-in" data-sas-reauth="${reauth ? '1' : '0'}" ${busy ? 'disabled' : ''}>Sign in</button>
          <button type="button" class="btn btn-secondary" data-sas="cancel">Cancel</button>
        </div>
        <div class="btn-row">
          <button type="button" class="btn btn-secondary" data-sas="how-google">How to</button>
        </div>
        <div data-sas-how hidden style="margin-top:10px;">
          <p class="muted" style="margin:0 0 8px;">Set up Google Authenticator. Open <a href="https://advantagesolutions.okta.com/app/UserHome">advantagesolutions.okta.com/app/UserHome</a>, sign in as usual, click the down arrow next to your name at the top right, and select Account settings. Click Edit Profile.</p>
          <p class="muted" style="margin:0 0 8px;">You will be asked for your password again. Okta Verify is already one factor. You will be brought back to the profile page. Click Set up next to Google Authenticator.</p>
          <p class="muted" style="margin:0 0 8px;">On the next screen, click Setup. Choose iPhone or Android. If Google Authenticator is already on your phone, still select your device type. If it is not installed, download it from your phone's app store.</p>
          <p class="muted" style="margin:0 0 8px;">A QR code appears. On a phone with no second device, click Can't scan and copy the 16-digit code. In Google Authenticator, scan the QR code or enter that 16-digit code. If you have other accounts in the app, use the one named advantagesolutions.okta.com. The timer on the right resets quickly. A code you still remember can be used until it has already been used.</p>
          <p class="muted" style="margin:0 0 8px;">Enter the six-digit code from that account. You will see "You have successfully enrolled Google Authenticator." Okta Verify and Google Authenticator both work after that.</p>
          <p class="muted" style="margin:0;">In this app, the authenticator code is that six-digit Google Authenticator code. Your password is not saved. An authenticated session is saved.</p>
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

  return {
    jumpMidpoint,
    openMode,
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
