/* Reporting-systems login card markup. No SAS/SI status copy. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.EodSasUserLoginLogic = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
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

  function idleHtml() {
    return `<button type="button" class="btn btn-primary btn-block" data-sas="open">Login to the reporting systems</button>
      <div class="muted" data-sas-msg style="min-height:1.2em;margin-top:8px;"></div>`;
  }

  function formHtml({ hasPattern, busy } = {}) {
    return `
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
        <input type="text" id="sasUserSiUsername" autocomplete="off" spellcheck="false">
      </div>
      <div class="field">
        <label for="sasUserSiPassword">SI password</label>
        <input type="password" id="sasUserSiPassword" autocomplete="off">
      </div>
      <div class="btn-row">
        <button type="button" class="btn btn-primary" data-sas="connect" ${busy ? 'disabled' : ''}>Save</button>
        <button type="button" class="btn btn-secondary" data-sas="cancel">Cancel</button>
      </div>
      <div class="muted" data-sas-msg style="min-height:1.2em;margin-top:8px;"></div>`;
  }

  function unlockHtml({ busy } = {}) {
    return `
      <div class="field">
        <label>Pattern</label>
        ${patternMarkup('unlock')}
      </div>
      <div class="btn-row">
        <button type="button" class="btn btn-primary" data-sas="unlock" ${busy ? 'disabled' : ''}>Unlock</button>
        <button type="button" class="btn btn-secondary" data-sas="form">Different credentials</button>
        <button type="button" class="btn btn-secondary" data-sas="cancel">Cancel</button>
      </div>
      <div class="muted" data-sas-msg style="min-height:1.2em;margin-top:8px;"></div>`;
  }

  function cardHtml(mode, status, busy) {
    if (mode === 'form') return formHtml({ hasPattern: !!status?.hasPattern, busy });
    if (mode === 'unlock') return unlockHtml({ busy });
    return idleHtml();
  }

  function bannedCopy(html) {
    return /your sas \+ si|office sas|office si/i.test(String(html || ''));
  }

  return {
    openMode,
    idleHtml,
    formHtml,
    unlockHtml,
    cardHtml,
    patternMarkup,
    bannedCopy,
  };
});
