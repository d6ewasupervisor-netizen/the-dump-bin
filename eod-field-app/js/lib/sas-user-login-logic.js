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
    if (status?.hasPattern && status?.hasCreds && !status?.sharedActor) return 'unlock';
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

  function idleHtml(lead) {
    return `${leadLine(lead)}<button type="button" class="btn btn-primary btn-block" data-sas="open">Login to the reporting systems</button>
      <div class="muted" data-sas-msg style="min-height:1.2em;margin-top:8px;"></div>`;
  }

  /* patternStep: 'set' | 'confirm' | 'done'
     When hasPattern is true (updating existing creds), a single draw suffices —
     the backend validates it against the stored pattern.
     When hasPattern is false (first save), two sequential draws are required. */
  function formHtml({ hasPattern, busy, lead, defaults, patternStep } = {}) {
    const step = patternStep || 'set';
    const saveOk = step === 'done';
    const user = esc(defaults?.username || '');
    const siUser = esc(defaults?.siUsername || '');

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
      <div class="field">
        <label for="sasUserUsername">Username</label>
        <input type="email" id="sasUserUsername" autocomplete="username" value="${user}">
      </div>
      <div class="field">
        <label for="sasUserPassword">Password</label>
        <input type="password" id="sasUserPassword" autocomplete="current-password">
      </div>
      <div class="field">
        <label for="sasUserTotp">Authenticator setup key</label>
        <div class="muted" style="margin-bottom:4px;font-size:0.85em;">The long setup key from your authenticator app, not the 6-digit code</div>
        <input type="text" id="sasUserTotp" autocomplete="off" spellcheck="false" inputmode="text">
      </div>
      ${patSection}
      <div class="field">
        <label for="sasUserSiUsername">SI username</label>
        <input type="text" id="sasUserSiUsername" autocomplete="off" spellcheck="false" value="${siUser}">
      </div>
      <div class="field">
        <label for="sasUserSiPassword">SI password</label>
        <input type="password" id="sasUserSiPassword" autocomplete="off">
      </div>
      <div class="btn-row">
        <button type="button" class="btn btn-primary" data-sas="connect" ${busy || !saveOk ? 'disabled' : ''}>Save</button>
        <button type="button" class="btn btn-secondary" data-sas="cancel">Cancel</button>
      </div>
      <div class="btn-row">
        <button type="button" class="btn btn-secondary" data-sas="handoff">Use handoff code</button>
        <button type="button" class="btn btn-secondary" data-sas="master">Supervisor takeover</button>
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
    if (mode === 'form') return formHtml({ hasPattern: !!status?.hasPattern, busy, lead, defaults: extra?.defaults, patternStep: extra?.patternStep });
    if (mode === 'unlock') return unlockHtml({ busy, lead });
    if (mode === 'handoff') return handoffHtml({ busy, lead });
    if (mode === 'master') return masterHtml({ busy, lead });
    if (mode === 'masterSetup') return masterSetupHtml({ busy, lead, masterStep: extra?.masterStep });
    return idleHtml(lead);
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
