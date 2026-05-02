/** API origin (no trailing slash). Routes through Cloudflare Access so the auth identity header reaches Railway. */
const API_BASE = 'https://api.the-dump-bin.com';

const form = document.getElementById('claim-form');
const formRoot = document.getElementById('form-root');
const submitBtn = document.getElementById('submit-btn');
const btnLabel = document.getElementById('submit-btn-label');
const btnSpinner = document.getElementById('submit-spinner');
const formError = document.getElementById('form-error');

const payloadBuilders = {
  self: collectSelfPayload,
  witness: collectWitnessPayload,
  investigation: collectInvestigationPayload,
};

if (!form || !payloadBuilders[form.dataset.formKind]) {
  console.warn('[claims/app.js] Claim form not found or unsupported data-form-kind; script skipped.');
} else {
  form.addEventListener('submit', handleSubmit);
}

function qsa(selector, root = document) {
  return Array.from(root.querySelectorAll(selector));
}

function fieldValue(nameOrId, root = form) {
  const byId = document.getElementById(nameOrId);
  const el = byId && root.contains(byId) ? byId : root.querySelector(`[name="${nameOrId}"]`);
  return el && 'value' in el ? el.value.trim() : '';
}

function selectValue(id, root = form) {
  const el = document.getElementById(id);
  return el && root.contains(el) ? el.value : '';
}

function getRadioValue(name, root = form) {
  const el = root.querySelector(`input[name="${name}"]:checked`);
  return el ? el.value : '';
}

function getCheckboxValues(name, root = form) {
  return qsa(`input[name="${name}"]:checked`, root).map((checkbox) => checkbox.value);
}

function readWitnessRow(row) {
  const name = (
    row.querySelector('.witness-name-input') || row.querySelector('[name="witnessName"]')
  )?.value.trim() || '';
  const phoneOrEmail = (
    row.querySelector('.witness-contact-input') || row.querySelector('[name="witnessPhoneOrEmail"]')
  )?.value.trim() || '';
  return { name, phoneOrEmail };
}

function getWitnessRows(root = form) {
  return qsa('#witness-rows .witness-row', root)
    .map(readWitnessRow)
    .filter((witness) => witness.name || witness.phoneOrEmail);
}

// Cross-field check the browser cannot express: a row with contact info but
// no name is invalid. Fully-blank rows are treated as abandoned and ignored.
// Returns an error message string, or null if witness rows are valid / N/A.
function validateWitnessRowsIfApplicable() {
  const formKind = form.dataset.formKind;
  if (formKind === 'witness') return null;
  if (formKind === 'investigation' && getRadioValue('witnessesPresent', form) !== 'Yes') {
    return null;
  }
  const rows = qsa('#witness-rows .witness-row', form);
  for (const row of rows) {
    const { name, phoneOrEmail } = readWitnessRow(row);
    if (!name && !phoneOrEmail) continue;
    if (phoneOrEmail && !name) {
      return 'Witness name is required when contact info is provided';
    }
  }
  return null;
}

function collectPayload() {
  const formKind = form.dataset.formKind;
  return payloadBuilders[formKind](form);
}

function collectSelfPayload(root) {
  const reported = getRadioValue('reportedToSupervisor', root);
  const preAny = getRadioValue('preExistingAny', root);

  return {
    reportType: fieldValue('reportType', root) || 'self',
    reporterName: fieldValue('reporterName', root),
    reporterEmail: fieldValue('reporterEmail', root),
    reporterPhone: fieldValue('reporterPhone', root),
    retailer: selectValue('retailer', root),
    storeNumber: fieldValue('storeNumber', root),
    storeAddress: fieldValue('storeAddress', root),
    project: selectValue('project', root),
    mechanism: selectValue('mechanism', root),
    dateOfInjury: fieldValue('dateOfInjury', root),
    timeOfInjury: fieldValue('timeOfInjury', root),
    bodyPartsAffected: getCheckboxValues('bodyPart', root),
    sideAffected: selectValue('sideAffected', root),
    description: fieldValue('description', root),
    witnesses: getWitnessRows(root),
    reportedToSupervisor: reported,
    supervisorName: reported === 'Yes' ? fieldValue('supervisorName', root) : '',
    supervisorDateReported: reported === 'Yes' ? fieldValue('supervisorDateReported', root) : '',
    supervisorTimeReported: reported === 'Yes' ? fieldValue('supervisorTimeReported', root) : '',
    preExistingAny: preAny,
    preExistingDetails: preAny === 'Yes' ? fieldValue('preExistingDetails', root) : '',
  };
}

function collectWitnessPayload(root) {
  const relationship = selectValue('relationshipToInjured', root);
  const mentionedReporting = getRadioValue('mentionedReporting', root);
  const preExistingAware = getRadioValue('preExistingAware', root);

  return {
    reportType: fieldValue('reportType', root) || 'witness',
    reporterName: fieldValue('reporterName', root),
    reporterEmail: fieldValue('reporterEmail', root),
    reporterPhone: fieldValue('reporterPhone', root),
    relationshipToInjured: relationship,
    injuredAssociateName: fieldValue('injuredAssociateName', root),
    retailer: selectValue('retailer', root),
    storeNumber: fieldValue('storeNumber', root),
    storeAddress: fieldValue('storeAddress', root),
    project: selectValue('project', root),
    mechanism: selectValue('mechanism', root),
    dateOfInjury: fieldValue('dateOfInjury', root),
    timeOfInjury: fieldValue('timeOfInjury', root),
    bodyPartsAffected: getCheckboxValues('bodyPart', root),
    sideAffected: selectValue('sideAffected', root),
    description: fieldValue('description', root),
    statementAdditionalInfo: fieldValue('statementAdditionalInfo', root),
    mentionedReporting,
    mentionedReportName: mentionedReporting === 'Yes' ? fieldValue('mentionedReportName', root) : '',
    mentionedReportDate: mentionedReporting === 'Yes' ? fieldValue('mentionedReportDate', root) : '',
    mentionedReportTime: mentionedReporting === 'Yes' ? fieldValue('mentionedReportTime', root) : '',
    preExistingAware,
    preExistingDetails: preExistingAware === 'Yes' ? fieldValue('preExistingDetails', root) : '',
  };
}

function collectInvestigationPayload(root) {
  const witnessesPresent = getRadioValue('witnessesPresent', root);

  return {
    reportType: fieldValue('reportType', root) || 'investigation',
    reporterName: fieldValue('reporterName', root),
    reporterEmail: fieldValue('reporterEmail', root),
    reporterPhone: fieldValue('reporterPhone', root),
    injuredAssociateName: fieldValue('injuredAssociateName', root),
    retailer: selectValue('retailer', root),
    storeNumber: fieldValue('storeNumber', root),
    storeAddress: fieldValue('storeAddress', root),
    project: selectValue('project', root),
    mechanism: selectValue('mechanism', root),
    dateOfInjury: fieldValue('dateOfInjury', root),
    firstLearnedDate: fieldValue('firstLearnedDate', root),
    firstLearnedTime: fieldValue('firstLearnedTime', root),
    witnessesPresent,
    witnesses: witnessesPresent === 'Yes' ? getWitnessRows(root) : [],
    projectAtInjury: selectValue('projectAtInjury', root),
    confirmRetailer: selectValue('confirmRetailer', root),
    confirmStoreNumber: fieldValue('confirmStoreNumber', root),
    confirmStoreAddress: fieldValue('confirmStoreAddress', root),
    inconsistenciesAny: getRadioValue('inconsistenciesAny', root),
    inconsistenciesDescribe: fieldValue('inconsistenciesDescribe', root),
    employmentDisciplinaryAny: getRadioValue('employmentDisciplinaryAny', root),
    employmentDisciplinaryDescribe: fieldValue('employmentDisciplinaryDescribe', root),
    preExistingRelevantAny: getRadioValue('preExistingRelevantAny', root),
    preExistingRelevantDescribe: fieldValue('preExistingRelevantDescribe', root),
    contributingFactorsAny: getRadioValue('contributingFactorsAny', root),
    contributingFactorsDescribe: fieldValue('contributingFactorsDescribe', root),
    sportsActivitiesAny: getRadioValue('sportsActivitiesAny', root),
    sportsActivitiesDescribe: fieldValue('sportsActivitiesDescribe', root),
    heavyLiftingAny: getRadioValue('heavyLiftingAny', root),
    heavyLiftingDescribe: fieldValue('heavyLiftingDescribe', root),
    oshaIndicators: getCheckboxValues('oshaIndicators', root),
    additionalFollowUps: fieldValue('additionalFollowUps', root),
  };
}

function setLoading(loading) {
  if (submitBtn) submitBtn.disabled = loading;
  if (btnSpinner) btnSpinner.classList.toggle('hidden', !loading);
  if (btnLabel) btnLabel.textContent = loading ? 'Submitting…' : 'Submit Report';
}

function showError(message) {
  if (!formError) return;
  formError.textContent = message;
  formError.classList.remove('hidden');
}

function clearError() {
  if (!formError) return;
  formError.classList.add('hidden');
  formError.textContent = '';
}

async function handleSubmit(event) {
  event.preventDefault();
  clearError();

  if (!form.checkValidity()) {
    form.reportValidity();
    return;
  }

  const witnessError = validateWitnessRowsIfApplicable();
  if (witnessError) {
    showError(witnessError);
    return;
  }

  const payload = collectPayload();
  setLoading(true);

  try {
    const res = await fetch(`${API_BASE}/api/claims`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(payload),
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      if (res.status === 400 && data.missing && Array.isArray(data.missing)) {
        showError(`Missing or invalid: ${data.missing.join(', ')}.`);
      } else {
        showError(data.error || 'Submission failed. Please try again or contact your administrator.');
      }
      return;
    }

    if (formRoot) {
      formRoot.innerHTML = `
        <div class="ro-card-section px-8 py-10 text-center">
          <h2 class="ro-section-title">Submission received</h2>
          <p class="mx-auto mt-3 max-w-lg text-[0.975rem] leading-relaxed" style="color: var(--brand-text-muted)">
            Your injury claim intake has been emailed to operations. You may close this page.
          </p>
        </div>
      `;
    }
  } catch (err) {
    showError('Could not reach the server. Check your connection and API configuration.');
  } finally {
    setLoading(false);
  }
}
