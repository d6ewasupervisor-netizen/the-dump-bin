/** API origin (no trailing slash). Set to your Railway URL for production. See README. */
const API_BASE = 'https://injury-claim-form-api-production.up.railway.app';

const form = document.getElementById('claim-form');
const formRoot = document.getElementById('form-root');
const submitBtn = document.getElementById('submit-btn');
const btnLabel = document.getElementById('submit-btn-label');
const btnSpinner = document.getElementById('submit-spinner');
const formError = document.getElementById('form-error');

const witnessBlock = document.getElementById('witness-details-block');
const projectOtherBlock = document.getElementById('project-other-block');

const explainBlocks = {
  validityQuestioned: document.getElementById('explain-validityQuestioned'),
  employmentIssues: document.getElementById('explain-employmentIssues'),
  preExisting: document.getElementById('explain-preExisting'),
  otherFactors: document.getElementById('explain-otherFactors'),
  sportsHobbies: document.getElementById('explain-sportsHobbies'),
  heavyLiftingOutsideWork: document.getElementById('explain-heavyLiftingOutsideWork'),
};

function getRadioValue(name) {
  const el = document.querySelector(`input[name="${name}"]:checked`);
  return el ? el.value : '';
}

function setWitnessVisibility() {
  const v = getRadioValue('witnessesPresent');
  witnessBlock.classList.toggle('hidden', v !== 'Yes');
}

function setProjectOtherVisibility() {
  const sel = document.getElementById('projectType');
  projectOtherBlock.classList.toggle('hidden', sel.value !== 'Other');
}

function setExplainVisibility(key) {
  const block = explainBlocks[key];
  if (!block) return;
  block.classList.toggle('hidden', getRadioValue(key) !== 'Yes');
}

function wireRadios(name, onChange) {
  document.querySelectorAll(`input[name="${name}"]`).forEach((el) => {
    el.addEventListener('change', onChange);
  });
}

document.querySelectorAll('input[name="witnessesPresent"]').forEach((el) => {
  el.addEventListener('change', setWitnessVisibility);
});
document.getElementById('projectType').addEventListener('change', setProjectOtherVisibility);

[
  'validityQuestioned',
  'employmentIssues',
  'preExisting',
  'otherFactors',
  'sportsHobbies',
  'heavyLiftingOutsideWork',
].forEach((key) => {
  wireRadios(key, () => setExplainVisibility(key));
});

function collectPayload() {
  const witnessesPresent = getRadioValue('witnessesPresent');
  const projectType = document.getElementById('projectType').value.trim();
  const t = (id) => document.getElementById(id).value.trim();

  return {
    reporterName: t('reporterName'),
    reporterRole: document.getElementById('reporterRole').value,
    reporterEmail: t('reporterEmail'),
    reporterPhone: t('reporterPhone'),
    associateName: t('associateName'),
    incidentDate: document.getElementById('incidentDate').value,
    firstLearnedAt: document.getElementById('firstLearnedAt').value,
    howLearned: document.getElementById('howLearned').value,
    witnessesPresent,
    witnessDetails: witnessesPresent === 'Yes' ? t('witnessDetails') : '',
    projectType,
    projectOther: projectType === 'Other' ? t('projectOther') : '',
    retailer: document.getElementById('retailer').value,
    storeNumber: t('storeNumber'),
    storeAddress: t('storeAddress'),
    validityQuestioned: getRadioValue('validityQuestioned'),
    validityExplain:
      getRadioValue('validityQuestioned') === 'Yes' ? t('validityExplain') : '',
    employmentIssues: getRadioValue('employmentIssues'),
    employmentExplain:
      getRadioValue('employmentIssues') === 'Yes' ? t('employmentExplain') : '',
    preExisting: getRadioValue('preExisting'),
    preExistingExplain:
      getRadioValue('preExisting') === 'Yes' ? t('preExistingExplain') : '',
    otherFactors: getRadioValue('otherFactors'),
    otherFactorsExplain:
      getRadioValue('otherFactors') === 'Yes' ? t('otherFactorsExplain') : '',
    sportsHobbies: getRadioValue('sportsHobbies'),
    sportsExplain: getRadioValue('sportsHobbies') === 'Yes' ? t('sportsExplain') : '',
    heavyLiftingOutsideWork: getRadioValue('heavyLiftingOutsideWork'),
    heavyLiftingExplain:
      getRadioValue('heavyLiftingOutsideWork') === 'Yes' ? t('heavyLiftingExplain') : '',
  };
}

function validate(payload) {
  const missing = [];

  const req = [
    ['reporterName', payload.reporterName],
    ['reporterRole', payload.reporterRole],
    ['reporterEmail', payload.reporterEmail],
    ['associateName', payload.associateName],
    ['incidentDate', payload.incidentDate],
    ['firstLearnedAt', payload.firstLearnedAt],
    ['howLearned', payload.howLearned],
    ['witnessesPresent', payload.witnessesPresent],
    ['projectType', payload.projectType],
    ['retailer', payload.retailer],
    ['storeNumber', payload.storeNumber],
    ['storeAddress', payload.storeAddress],
    ['validityQuestioned', payload.validityQuestioned],
    ['employmentIssues', payload.employmentIssues],
    ['preExisting', payload.preExisting],
    ['otherFactors', payload.otherFactors],
    ['sportsHobbies', payload.sportsHobbies],
    ['heavyLiftingOutsideWork', payload.heavyLiftingOutsideWork],
  ];

  const yn = new Set(['Yes', 'No', 'Unknown']);
  const wit = new Set(['Yes', 'No', 'Unknown']);

  for (const [k, v] of req) {
    if (!v || (typeof v === 'string' && !v.trim())) missing.push(k);
  }
  if (payload.witnessesPresent && !wit.has(payload.witnessesPresent)) {
    missing.push('witnessesPresent');
  }
  for (const k of [
    'validityQuestioned',
    'employmentIssues',
    'preExisting',
    'otherFactors',
    'sportsHobbies',
    'heavyLiftingOutsideWork',
  ]) {
    if (payload[k] && !yn.has(payload[k])) missing.push(k);
  }

  if (payload.witnessesPresent === 'Yes' && !payload.witnessDetails) {
    missing.push('witnessDetails');
  }
  if (payload.projectType === 'Other' && !payload.projectOther) {
    missing.push('projectOther');
  }

  const pairs = [
    ['validityQuestioned', 'validityExplain'],
    ['employmentIssues', 'employmentExplain'],
    ['preExisting', 'preExistingExplain'],
    ['otherFactors', 'otherFactorsExplain'],
    ['sportsHobbies', 'sportsExplain'],
    ['heavyLiftingOutsideWork', 'heavyLiftingExplain'],
  ];
  for (const [r, e] of pairs) {
    if (payload[r] === 'Yes' && !payload[e]) missing.push(e);
  }

  if (payload.reporterEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payload.reporterEmail)) {
    missing.push('reporterEmail');
  }

  return [...new Set(missing)];
}

function setLoading(loading) {
  submitBtn.disabled = loading;
  btnSpinner.classList.toggle('hidden', !loading);
  btnLabel.textContent = loading ? 'Submitting…' : 'Submit intake';
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  formError.classList.add('hidden');
  formError.textContent = '';

  const payload = collectPayload();
  const missing = validate(payload);
  if (missing.length > 0) {
    formError.textContent = `Please complete all required fields (${missing.join(', ')}).`;
    formError.classList.remove('hidden');
    return;
  }

  setLoading(true);
  try {
    const res = await fetch(`${API_BASE}/api/claims`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      if (res.status === 400 && data.missing && Array.isArray(data.missing)) {
        formError.textContent = `Missing or invalid: ${data.missing.join(', ')}.`;
      } else {
        formError.textContent =
          data.error || 'Submission failed. Please try again or contact your administrator.';
      }
      formError.classList.remove('hidden');
      return;
    }

    formRoot.innerHTML = `
      <div class="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <h2 class="text-lg font-semibold text-slate-900">Submission received</h2>
        <p class="mt-3 text-slate-700">
          Your injury claim intake has been emailed to operations. You may close this page.
        </p>
      </div>
    `;
  } catch (err) {
    formError.textContent =
      'Could not reach the server. Check your connection and API configuration.';
    formError.classList.remove('hidden');
  } finally {
    setLoading(false);
  }
});

setWitnessVisibility();
setProjectOtherVisibility();
Object.keys(explainBlocks).forEach((k) => setExplainVisibility(k));
