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

  function formHtml({ hasPattern, busy, lead, defaults } = {}) {
    const user = esc(defaults?.username || '');
    const siUser = esc(defaults?.siUsername || '');
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
        <label for="sasUserTotp">Authenticator secret</label>
        <input type="text" id="sasUserTotp" autocomplete="off" spellcheck="false">
      </div>
      <div class="field">
        <label>Pattern</label>
        ${patternMarkup('set')}
      </div>
      ${hasPattern ? '' : `<div class="field">
        <label>Draw again</label>
        ${patternMarkup('confirm')}
      </div>`}
      <div class="field">
        <label for="sasUserSiUsername">SI username</label>
        <input type="text" id="sasUserSiUsername" autocomplete="off" spellcheck="false" value="${siUser}">
      </div>
      <div class="field">
        <label for="sasUserSiPassword">SI password</label>
        <input type="password" id="sasUserSiPassword" autocomplete="off">
      </div>
      <div class="btn-row">
        <button type="button" class="btn btn-primary" data-sas="connect" ${busy ? 'disabled' : ''}>Save</button>
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

  function masterSetupHtml({ busy, lead } = {}) {
    return `${leadLine(lead)}
      <div class="field">
        <label>Master pattern</label>
        ${patternMarkup('masterSet')}
      </div>
      <div class="field">
        <label>Draw again</label>
        ${patternMarkup('masterConfirm')}
      </div>
      <div class="btn-row">
        <button type="button" class="btn btn-primary" data-sas="master-save" ${busy ? 'disabled' : ''}>Save master pattern</button>
        <button type="button" class="btn btn-secondary" data-sas="master">Back</button>
      </div>
      <div class="muted" data-sas-msg style="min-height:1.2em;margin-top:8px;"></div>`;
  }

  function cardHtml(mode, status, busy, extra) {
    const lead = extra?.lead || null;
    if (mode === 'form') return formHtml({ hasPattern: !!status?.hasPattern, busy, lead, defaults: extra?.defaults });
    if (mode === 'unlock') return unlockHtml({ busy, lead });
    if (mode === 'handoff') return handoffHtml({ busy, lead });
    if (mode === 'master') return masterHtml({ busy, lead });
    if (mode === 'masterSetup') return masterSetupHtml({ busy, lead });
    return idleHtml(lead);
  }

  function bannedCopy(html) {
    return /your sas \+ si|office sas|office si/i.test(String(html || ''));
  }

  return {
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
