/** API origin (no trailing slash). Set to your Railway URL for production. See README. */
const API_BASE = 'https://injury-claim-form-api-production.up.railway.app';

const form = document.getElementById('claim-form');
const formRoot = document.getElementById('form-root');
const submitBtn = document.getElementById('submit-btn');
const btnLabel = document.getElementById('submit-btn-label');
const btnSpinner = document.getElementById('submit-spinner');
const formError = document.getElementById('form-error');

if (!form || form.dataset.formKind !== 'self') {
  console.warn('[claims/app.js] Self-claim form not found or wrong data-form-kind; script skipped.');
} else {
  function getRadioValue(name) {
    const el = document.querySelector(`input[name="${name}"]:checked`);
    return el ? el.value : '';
  }

  function t(id) {
    const el = document.getElementById(id);
    return el ? el.value.trim() : '';
  }

  function collectBodyParts() {
    return [...document.querySelectorAll('input[name="bodyPart"]:checked')].map((c) => c.value);
  }

  function collectWitnesses() {
    const rows = document.querySelectorAll('#witness-rows .witness-row');
    const out = [];
    rows.forEach((row) => {
      const name = (row.querySelector('.witness-name-input') || row.querySelector('[name="witnessName"]'))
        .value.trim();
      const phoneOrEmail = (
        row.querySelector('.witness-contact-input') || row.querySelector('[name="witnessPhoneOrEmail"]')
      ).value.trim();
      if (!name && !phoneOrEmail) return;
      out.push({ name, phoneOrEmail });
    });
    return out;
  }

  function collectPayload() {
    const reported = getRadioValue('reportedToSupervisor');
    const preAny = getRadioValue('preExistingAny');

    return {
      reportType: t('reportType') || 'self',
      reporterName: t('reporterName'),
      reporterEmail: t('reporterEmail'),
      reporterPhone: t('reporterPhone'),
      retailer: document.getElementById('retailer')?.value || '',
      storeNumber: t('storeNumber'),
      storeAddress: t('storeAddress'),
      project: document.getElementById('project')?.value || '',
      mechanism: document.getElementById('mechanism')?.value || '',
      dateOfInjury: document.getElementById('dateOfInjury')?.value || '',
      timeOfInjury: document.getElementById('timeOfInjury')?.value || '',
      bodyPartsAffected: collectBodyParts(),
      sideAffected: document.getElementById('sideAffected')?.value || '',
      description: t('description'),
      witnesses: collectWitnesses(),
      reportedToSupervisor: reported,
      supervisorName: reported === 'Yes' ? t('supervisorName') : '',
      supervisorDateReported: reported === 'Yes' ? document.getElementById('supervisorDateReported')?.value || '' : '',
      supervisorTimeReported: reported === 'Yes' ? document.getElementById('supervisorTimeReported')?.value || '' : '',
      preExistingAny: preAny,
      preExistingDetails: preAny === 'Yes' ? t('preExistingDetails') : '',
    };
  }

  function validate(payload) {
    const missing = [];

    const req = [
      ['reporterName', payload.reporterName],
      ['reporterEmail', payload.reporterEmail],
      ['reporterPhone', payload.reporterPhone],
      ['retailer', payload.retailer],
      ['storeNumber', payload.storeNumber],
      ['storeAddress', payload.storeAddress],
      ['project', payload.project],
      ['mechanism', payload.mechanism],
      ['dateOfInjury', payload.dateOfInjury],
      ['timeOfInjury', payload.timeOfInjury],
      ['sideAffected', payload.sideAffected],
      ['description', payload.description],
    ];

    for (const [k, v] of req) {
      if (!v || (typeof v === 'string' && !String(v).trim())) missing.push(k);
    }

    if (!payload.bodyPartsAffected || payload.bodyPartsAffected.length === 0) {
      missing.push('bodyPartsAffected');
    }

    const yn = new Set(['Yes', 'No']);
    if (!payload.reportedToSupervisor || !yn.has(payload.reportedToSupervisor)) {
      missing.push('reportedToSupervisor');
    }
    if (payload.reportedToSupervisor === 'Yes') {
      if (!payload.supervisorName) missing.push('supervisorName');
      if (!payload.supervisorDateReported) missing.push('supervisorDateReported');
      if (!payload.supervisorTimeReported) missing.push('supervisorTimeReported');
    }

    if (!payload.preExistingAny || !yn.has(payload.preExistingAny)) {
      missing.push('preExistingAny');
    }
    if (payload.preExistingAny === 'Yes' && !payload.preExistingDetails) {
      missing.push('preExistingDetails');
    }

    if (payload.reporterEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payload.reporterEmail)) {
      missing.push('reporterEmail');
    }

    for (let i = 0; i < payload.witnesses.length; i++) {
      const w = payload.witnesses[i];
      if (!w.name && w.phoneOrEmail) {
        missing.push(`witness_${i}_name`);
      }
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
}
