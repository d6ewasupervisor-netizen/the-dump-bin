/**
 * KOMPASS EOD Help Desk report wizard.
 * Loaded by EOD/index.html — bump EOD_APP_VERSION when this file changes.
 */
(function () {
    'use strict';

    const EOD_HELPDESK_ISSUE_OPTIONS = [
        { id: 'not_in_store', label: 'Set not in store' },
        { id: 'missing_fixture', label: 'Missing fixture' },
        { id: 'reverse_flow', label: 'Set flow is incorrect (reverse flow)' },
        { id: 'incorrect_version', label: 'Incorrect version' },
        { id: 'incorrect_footage', label: 'Incorrect footage' },
        { id: 'incorrect_planogram', label: 'Incorrect planogram' },
        { id: 'obstruction', label: 'Report obstruction (pole or other permanent feature)' },
        { id: 'missing_hardware', label: 'Report missing hardware' },
        { id: 'custom', label: 'Report other (custom entry)' },
    ];

    const RETAIL_ODYSSEY_TEAM = [
        'mashabranner@retailodyssey.com',
        'seth.newman@retailodyssey.com',
        'tyson.gauthier@retailodyssey.com',
        'aiyana.natarisalazar@retailodyssey.com',
        'amanda.mathews@retailodyssey.com',
        'april.gauthier@retailodyssey.com',
    ];

    let wizardIssues = [];
    let wizardExtraRecipients = [];
    let wizardPhotoEdit = null;

    function issueOptionsHtml(selected) {
        const opts = '<option value=""' + (!selected ? ' selected' : '') + '>Select or enter the issue…</option>' +
            EOD_HELPDESK_ISSUE_OPTIONS.map((opt) =>
                `<option value="${opt.id}"${selected === opt.id ? ' selected' : ''}>${escapeHtml(opt.label)}</option>`
            ).join('');
        return opts;
    }

    function shiftOptionsHtml(selectedVisitId) {
        const map = window.allShiftsSetsMap || {};
        const keys = Object.keys(map);
        const normSelected = typeof window.normalizeVisitId === 'function'
            ? window.normalizeVisitId(selectedVisitId)
            : String(selectedVisitId || '');
        if (!keys.length) {
            return '<option value="">Find shifts first</option>';
        }
        return '<option value="">Select shift…</option>' +
            keys.map((vid) => {
                const info = map[vid];
                const lbl = info?.label || vid;
                const normVid = typeof window.normalizeVisitId === 'function'
                    ? window.normalizeVisitId(vid)
                    : String(vid);
                return `<option value="${escapeHtml(vid)}"${normSelected === normVid ? ' selected' : ''}>${escapeHtml(lbl)}</option>`;
            }).join('');
    }

    function setOptionsHtml(visitId, selectedLabel) {
        const map = window.allShiftsSetsMap || {};
        const normVisitId = typeof window.normalizeVisitId === 'function'
            ? window.normalizeVisitId(visitId)
            : String(visitId || '');
        const entry = normVisitId && map[normVisitId];
        const sets = entry ? entry.sets : [];
        if (!normVisitId) {
            return '<option value="">Select a shift first</option>';
        }
        if (!sets.length) {
            return '<option value="">No sets loaded for this shift</option>';
        }
        const displayFn = typeof window.setDisplayLabel === 'function'
            ? window.setDisplayLabel
            : (typeof window.setLabel === 'function' ? window.setLabel : (s) => s.name || '');
        const valueFn = typeof window.setLabel === 'function' ? window.setLabel : (s) => s.name || '';
        return '<option value="">Select set…</option>' +
            sets.map((s) => {
                const lbl = valueFn(s);
                const text = displayFn(s);
                return `<option value="${escapeHtml(lbl)}" data-number="${s.number || ''}" data-version="${escapeHtml(s.version || '')}" data-dbkey="${escapeHtml(s.dbkey || '')}" data-footage="${escapeHtml(s.footage || '')}" data-planogram-id="${escapeHtml(s.planogramId || '')}" data-set-name="${escapeHtml(s.name || '')}"${selectedLabel === lbl ? ' selected' : ''}>${escapeHtml(text)}</option>`;
            }).join('');
    }

    function newIssueBlock() {
        return {
            issueTypeId: '',
            setEntryManual: false,
            shiftVisitId: '',
            setLabel: '',
            categoryNumber: '',
            version: '',
            dbkey: '',
            planogramId: '',
            footageToken: '',
            manualShiftName: '',
            manualSetName: '',
            manualCategoryNumber: '',
            manualVersion: '',
            manualDbkey: '',
            customIssue: '',
            details: '',
            photos: [],
            reportAnother: false,
        };
    }

    function normalizeVisitId(visitId) {
        if (typeof window.normalizeVisitId === 'function') return window.normalizeVisitId(visitId);
        return visitId == null || visitId === '' ? '' : String(visitId);
    }

    function findSelectedSet(issue, map) {
        if (issue.setEntryManual || !issue.shiftVisitId || !issue.setLabel) return null;
        const entry = map[normalizeVisitId(issue.shiftVisitId)];
        if (!entry || !Array.isArray(entry.sets)) return null;
        const valueFn = typeof window.setLabel === 'function' ? window.setLabel : (s) => s.name || '';
        return entry.sets.find((s) => valueFn(s) === issue.setLabel) || null;
    }

    function todayReportDateIso() {
        const d = new Date();
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const dd = String(d.getDate()).padStart(2, '0');
        return `${y}-${m}-${dd}`;
    }

    function resolveIssueSetMeta(issue, map) {
        if (issue.setEntryManual) {
            return {
                shiftLabel: (issue.manualShiftName || '').trim(),
                setLabel: (issue.manualSetName || '').trim(),
                categoryName: (issue.manualSetName || '').trim(),
                categoryNumber: (issue.manualCategoryNumber || '').trim() || null,
                version: (issue.manualVersion || '').trim().replace(/^V/i, '') || null,
                dbkey: (issue.manualDbkey || '').trim() || null,
                planogramId: null,
                footageToken: null,
            };
        }
        const set = findSelectedSet(issue, map);
        return {
            shiftLabel: issue.shiftVisitId && map[normalizeVisitId(issue.shiftVisitId)]
                ? map[normalizeVisitId(issue.shiftVisitId)].label
                : '',
            setLabel: (issue.setLabel || '').trim(),
            categoryNumber: set?.number || issue.categoryNumber || null,
            categoryName: set?.name || null,
            version: set?.version || issue.version || null,
            dbkey: set?.dbkey || issue.dbkey || null,
            planogramId: set?.planogramId || issue.planogramId || null,
            footageToken: issue.footageToken || null,
        };
    }

    function issueSetDisplayName(issue) {
        const meta = resolveIssueSetMeta(issue, window.allShiftsSetsMap || {});
        return meta.setLabel || issue.customIssue || 'Unnamed set';
    }

    function renderWizardIssues() {
        const container = document.getElementById('helpdeskWizardIssues');
        if (!container) return;

        container.innerHTML = wizardIssues.map((issue, idx) => {
            const isCustom = issue.issueTypeId === 'custom';
            const hasIssueType = !!issue.issueTypeId;
            const isManual = !!issue.setEntryManual;
            const showShiftSetPickers = hasIssueType && !isManual;
            const showManualFields = hasIssueType && isManual;
            return `<div class="hd-issue-card" data-issue-idx="${idx}">
                <div class="hd-issue-header">Issue ${idx + 1}</div>
                <div class="field">
                    <label>Issue type</label>
                    <select class="hd-issue-type" data-idx="${idx}">${issueOptionsHtml(issue.issueTypeId)}</select>
                </div>
                ${hasIssueType ? `
                <div class="checkbox-option hd-manual-set-wrap" style="margin: 10px 0;">
                    <input type="checkbox" class="hd-set-manual" id="hdSetManual${idx}" data-idx="${idx}" ${isManual ? 'checked' : ''}>
                    <label for="hdSetManual${idx}">Set isn't on my shift — enter set details manually</label>
                </div>
                <p class="sets-help hd-manual-hint" style="${isManual ? '' : 'display:none'}; margin-bottom:10px;">
                    Use this when you have materials for a set that isn't loaded on any shift in the system.
                </p>` : ''}
                <div class="field hd-shift-field" style="${showShiftSetPickers ? '' : 'display:none'}">
                    <label>Shift</label>
                    <select class="hd-shift-select" data-idx="${idx}">${shiftOptionsHtml(issue.shiftVisitId)}</select>
                </div>
                <div class="field hd-set-field" style="${showShiftSetPickers ? '' : 'display:none'}">
                    <label>Set</label>
                    <select class="hd-set-select" data-idx="${idx}">${setOptionsHtml(issue.shiftVisitId, issue.setLabel)}</select>
                </div>
                <div class="hd-manual-set-fields" style="${showManualFields ? '' : 'display:none'}">
                    <div class="field">
                        <label>Shift name <span class="hd-photo-hint">(optional — e.g. ISE, Blitz)</span></label>
                        <input type="text" class="hd-manual-shift" data-idx="${idx}" value="${escapeHtml(issue.manualShiftName)}" placeholder="Which shift is this for?">
                    </div>
                    <div class="field" style="margin-top:10px;">
                        <label>Set name / description</label>
                        <input type="text" class="hd-manual-set-name" data-idx="${idx}" value="${escapeHtml(issue.manualSetName)}" placeholder="e.g. Frozen Pizza 4ft endcap">
                    </div>
                    <div class="field-group hd-field-row" style="margin-top:10px;">
                        <div class="field" style="flex:1; min-width:120px;">
                            <label>Category # (C)</label>
                            <input type="text" class="hd-manual-category" data-idx="${idx}" value="${escapeHtml(issue.manualCategoryNumber)}" placeholder="1234" inputmode="numeric">
                        </div>
                        <div class="field" style="flex:1; min-width:120px;">
                            <label>Version (V)</label>
                            <input type="text" class="hd-manual-version" data-idx="${idx}" value="${escapeHtml(issue.manualVersion)}" placeholder="D701">
                        </div>
                        <div class="field" style="flex:1; min-width:140px;">
                            <label>DB key <span class="hd-photo-hint">(optional)</span></label>
                            <input type="text" class="hd-manual-dbkey" data-idx="${idx}" value="${escapeHtml(issue.manualDbkey)}" placeholder="8509659" inputmode="numeric">
                        </div>
                    </div>
                </div>
                <div class="field hd-custom-field" style="${isCustom ? '' : 'display:none'}">
                    <label>Describe the issue</label>
                    <input type="text" class="hd-custom-input" data-idx="${idx}" value="${escapeHtml(issue.customIssue)}" placeholder="What is wrong or what do you need?">
                </div>
                <div class="field">
                    <label>Details</label>
                    <textarea class="hd-details" data-idx="${idx}" rows="3" placeholder="Add location, measurements, and any context the help desk needs">${escapeHtml(issue.details)}</textarea>
                </div>
                <div class="field">
                    <label>Photos <span class="hd-photo-hint">(strongly recommended — annotate to show the problem area)</span></label>
                    <div class="hd-photo-thumbs" id="hdPhotoThumbs${idx}"></div>
                    <div class="photo-button-group">
                        <button type="button" class="photo-button hd-photo-camera" data-idx="${idx}">Take photo</button>
                        <button type="button" class="photo-button hd-photo-pick" data-idx="${idx}">Choose photos</button>
                    </div>
                    <input type="file" class="hd-photo-input" data-idx="${idx}" accept="image/*,.heic,.heif" multiple hidden>
                </div>
                ${idx === wizardIssues.length - 1 ? `
                <div class="checkbox-option hd-another-wrap">
                    <input type="checkbox" class="hd-report-another" id="hdReportAnother${idx}" data-idx="${idx}" ${issue.reportAnother ? 'checked' : ''}>
                    <label for="hdReportAnother${idx}">Report additional issues</label>
                </div>` : ''}
            </div>`;
        }).join('');

        wizardIssues.forEach((issue, idx) => renderIssuePhotoThumbs(idx));

        container.querySelectorAll('.hd-issue-type').forEach((sel) => {
            sel.addEventListener('change', () => {
                const i = Number(sel.dataset.idx);
                wizardIssues[i].issueTypeId = sel.value;
                if (sel.value === 'custom') {
                    wizardIssues[i].shiftVisitId = '';
                    wizardIssues[i].setLabel = '';
                }
                renderWizardIssues();
            });
        });

        container.querySelectorAll('.hd-set-manual').forEach((cb) => {
            cb.addEventListener('change', () => {
                const i = Number(cb.dataset.idx);
                wizardIssues[i].setEntryManual = cb.checked;
                if (cb.checked) {
                    wizardIssues[i].shiftVisitId = '';
                    wizardIssues[i].setLabel = '';
                    wizardIssues[i].categoryNumber = '';
                    wizardIssues[i].version = '';
                } else {
                    wizardIssues[i].manualShiftName = '';
                    wizardIssues[i].manualSetName = '';
                    wizardIssues[i].manualCategoryNumber = '';
                    wizardIssues[i].manualVersion = '';
                    wizardIssues[i].manualDbkey = '';
                }
                renderWizardIssues();
            });
        });

        container.querySelectorAll('.hd-shift-select').forEach((sel) => {
            sel.addEventListener('change', () => {
                const i = Number(sel.dataset.idx);
                wizardIssues[i].shiftVisitId = sel.value;
                wizardIssues[i].setLabel = '';
                wizardIssues[i].categoryNumber = '';
                wizardIssues[i].version = '';
                renderWizardIssues();
            });
        });

        container.querySelectorAll('.hd-set-select').forEach((sel) => {
            sel.addEventListener('change', () => {
                const i = Number(sel.dataset.idx);
                const opt = sel.options[sel.selectedIndex];
                wizardIssues[i].setLabel = sel.value;
                wizardIssues[i].categoryNumber = opt?.dataset?.number || '';
                wizardIssues[i].version = opt?.dataset?.version || '';
                wizardIssues[i].dbkey = opt?.dataset?.dbkey || '';
                wizardIssues[i].planogramId = opt?.dataset?.planogramId || '';
                wizardIssues[i].footageToken = '';
            });
        });

        container.querySelectorAll('.hd-custom-input').forEach((inp) => {
            inp.addEventListener('input', () => {
                wizardIssues[Number(inp.dataset.idx)].customIssue = inp.value;
            });
        });

        container.querySelectorAll('.hd-manual-shift').forEach((inp) => {
            inp.addEventListener('input', () => {
                wizardIssues[Number(inp.dataset.idx)].manualShiftName = inp.value;
            });
        });

        container.querySelectorAll('.hd-manual-set-name').forEach((inp) => {
            inp.addEventListener('input', () => {
                wizardIssues[Number(inp.dataset.idx)].manualSetName = inp.value;
            });
        });

        container.querySelectorAll('.hd-manual-category').forEach((inp) => {
            inp.addEventListener('input', () => {
                wizardIssues[Number(inp.dataset.idx)].manualCategoryNumber = inp.value;
            });
        });

        container.querySelectorAll('.hd-manual-version').forEach((inp) => {
            inp.addEventListener('input', () => {
                wizardIssues[Number(inp.dataset.idx)].manualVersion = inp.value;
            });
        });

        container.querySelectorAll('.hd-manual-dbkey').forEach((inp) => {
            inp.addEventListener('input', () => {
                wizardIssues[Number(inp.dataset.idx)].manualDbkey = inp.value;
            });
        });

        container.querySelectorAll('.hd-details').forEach((ta) => {
            ta.addEventListener('input', () => {
                wizardIssues[Number(ta.dataset.idx)].details = ta.value;
            });
        });

        container.querySelectorAll('.hd-report-another').forEach((cb) => {
            cb.addEventListener('change', () => {
                const i = Number(cb.dataset.idx);
                wizardIssues[i].reportAnother = cb.checked;
                if (cb.checked && i === wizardIssues.length - 1) {
                    wizardIssues.push(newIssueBlock());
                    renderWizardIssues();
                }
            });
        });

        container.querySelectorAll('.hd-photo-pick').forEach((btn) => {
            btn.addEventListener('click', () => {
                const input = container.querySelector(`.hd-photo-input[data-idx="${btn.dataset.idx}"]`);
                if (input) input.click();
            });
        });

        container.querySelectorAll('.hd-photo-camera').forEach((btn) => {
            btn.addEventListener('click', () => openHelpdeskCamera(Number(btn.dataset.idx)));
        });

        container.querySelectorAll('.hd-photo-input').forEach((input) => {
            input.addEventListener('change', () => handleHelpdeskPhotoFiles(input));
        });
    }

    function renderIssuePhotoThumbs(issueIdx) {
        const el = document.getElementById(`hdPhotoThumbs${issueIdx}`);
        if (!el) return;
        const photos = wizardIssues[issueIdx]?.photos || [];
        el.innerHTML = photos.map((src, pi) =>
            `<div class="hd-photo-thumb">
                <img src="${src}" alt="Issue photo ${pi + 1}">
                <button type="button" class="hd-photo-annotate" data-issue="${issueIdx}" data-photo="${pi}" title="Annotate">✎</button>
                <button type="button" class="hd-photo-remove" data-issue="${issueIdx}" data-photo="${pi}" title="Remove">&times;</button>
            </div>`
        ).join('');

        el.querySelectorAll('.hd-photo-remove').forEach((btn) => {
            btn.addEventListener('click', () => {
                const i = Number(btn.dataset.issue);
                const p = Number(btn.dataset.photo);
                wizardIssues[i].photos.splice(p, 1);
                renderIssuePhotoThumbs(i);
            });
        });

        el.querySelectorAll('.hd-photo-annotate').forEach((btn) => {
            btn.addEventListener('click', () => openHelpdeskPhotoAnnotate(Number(btn.dataset.issue), Number(btn.dataset.photo)));
        });
    }

    async function handleHelpdeskPhotoFiles(input) {
        const idx = Number(input.dataset.idx);
        const files = Array.from(input.files || []);
        input.value = '';
        for (const file of files) {
            try {
                let dataUrl;
                if (typeof window.processImageWithOrientation === 'function') {
                    dataUrl = await window.processImageWithOrientation(file);
                } else {
                    dataUrl = await readFileAsDataUrl(file);
                }
                if (typeof window.optimizePhotoForStorage === 'function') {
                    dataUrl = await window.optimizePhotoForStorage(dataUrl, 'signoff');
                }
                wizardIssues[idx].photos.push(dataUrl);
            } catch (e) {
                console.warn('Helpdesk photo load failed:', e);
            }
        }
        renderIssuePhotoThumbs(idx);
    }

    function readFileAsDataUrl(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = reject;
            reader.readAsDataURL(file);
        });
    }

    function openHelpdeskCamera(issueIdx) {
        const input = document.querySelector(`.hd-photo-input[data-idx="${issueIdx}"]`);
        if (!input) return;
        input.setAttribute('capture', 'environment');
        input.click();
        input.removeAttribute('capture');
    }

    function openHelpdeskPhotoAnnotate(issueIdx, photoIdx) {
        const dataUrl = wizardIssues[issueIdx]?.photos?.[photoIdx];
        if (!dataUrl || typeof window.openImageEditor !== 'function') return;
        wizardPhotoEdit = { issueIdx, photoIdx };
        if (!window.photos.helpdesk) window.photos.helpdesk = [];
        window.photos.helpdesk = [dataUrl];
        window.openImageEditor(0, 'helpdesk');
    }

    window.saveHelpdeskAnnotatedPhoto = function saveHelpdeskAnnotatedPhoto(dataUrl) {
        if (!wizardPhotoEdit) return;
        const { issueIdx, photoIdx } = wizardPhotoEdit;
        if (wizardIssues[issueIdx]?.photos?.[photoIdx] != null) {
            wizardIssues[issueIdx].photos[photoIdx] = dataUrl;
            renderIssuePhotoThumbs(issueIdx);
        }
        wizardPhotoEdit = null;
        if (window.photos.helpdesk) window.photos.helpdesk = [];
    };

    function renderWizardRecipients() {
        const list = document.getElementById('helpdeskWizardRecipientList');
        const container = document.getElementById('helpdeskWizardRecipientContainer');
        if (!list) return;
        if (!wizardExtraRecipients.length) {
            if (container) container.style.display = 'none';
            return;
        }
        if (container) container.style.display = 'block';
        list.innerHTML = wizardExtraRecipients.map((email, i) =>
            `<span class="recipient-chip">${escapeHtml(email)} <button type="button" data-rm="${i}">&times;</button></span>`
        ).join('');
        list.querySelectorAll('button[data-rm]').forEach((btn) => {
            btn.addEventListener('click', () => {
                wizardExtraRecipients.splice(Number(btn.dataset.rm), 1);
                renderWizardRecipients();
            });
        });
    }

    function openHelpdeskWizard() {
        wizardIssues = [newIssueBlock()];
        wizardExtraRecipients = [];
        const mainRecipients = window.emailRecipients || [];
        wizardExtraRecipients = mainRecipients.slice();
        renderWizardIssues();
        renderWizardRecipients();
        const overlay = document.getElementById('helpdeskWizardOverlay');
        if (overlay) overlay.classList.add('show');
    }

    function closeHelpdeskWizard() {
        const overlay = document.getElementById('helpdeskWizardOverlay');
        if (overlay) overlay.classList.remove('show');
    }

    function validateWizardIssues() {
        const problems = [];
        const photoWarnings = [];
        wizardIssues.forEach((issue, i) => {
            if (!issue.issueTypeId) problems.push(`Issue ${i + 1}: select an issue type.`);
            if (issue.issueTypeId === 'custom' && !issue.customIssue.trim() && !issue.manualSetName.trim()) {
                problems.push(`Issue ${i + 1}: describe the issue or enter a set name.`);
            }
            if (issue.setEntryManual) {
                if (!issue.manualSetName.trim()) {
                    problems.push(`Issue ${i + 1}: enter the set name or description.`);
                }
            } else if (issue.issueTypeId && issue.issueTypeId !== 'custom') {
                if (!issue.shiftVisitId) problems.push(`Issue ${i + 1}: select a shift, or check "enter set details manually".`);
                if (!issue.setLabel) problems.push(`Issue ${i + 1}: select a set, or check "enter set details manually".`);
            }
            if (!issue.photos.length) {
                photoWarnings.push(`Issue ${i + 1} has no photos.`);
            }
        });
        return { problems, photoWarnings };
    }

    async function submitHelpdeskWizard() {
        const { problems, photoWarnings } = validateWizardIssues();
        if (problems.length) {
            if (typeof window.showAlert === 'function') {
                window.showAlert('Complete help desk reports', '<ul><li>' + problems.join('</li><li>') + '</li></ul>');
            }
            return;
        }
        if (photoWarnings.length) {
            const msg = 'Photos are strongly recommended so the help desk can see the problem.<br><br>' +
                photoWarnings.join('<br>') + '<br><br>Submit without photos?';
            if (typeof window.showConfirm === 'function') {
                window.showConfirm('No photos attached', msg, () => submitHelpdeskWizardInner());
                return;
            }
        }
        await submitHelpdeskWizardInner();
    }

    async function submitHelpdeskWizardInner() {

        const storeNumber = document.getElementById('storeNumber')?.value?.trim();
        const reportDate = todayReportDateIso();
        const userName = document.getElementById('profileName')?.value?.trim() || '';
        const userEmail = document.getElementById('profileEmail')?.value?.trim() || '';
        const addTeam = document.getElementById('helpdeskAddRetailOdysseyTeam')?.checked || false;
        const map = window.allShiftsSetsMap || {};

        const loading = document.getElementById('loadingOverlay');
        if (loading) loading.classList.add('show');

        const submitted = [];
        try {
            const issuesToSend = wizardIssues.filter((issue) => issue.issueTypeId);
            for (const issue of issuesToSend) {
                const opt = EOD_HELPDESK_ISSUE_OPTIONS.find((o) => o.id === issue.issueTypeId);
                const meta = resolveIssueSetMeta(issue, map);
                const issueDetails = (issue.details || '').trim();

                const resp = await window.authFetch(`${window.EOD_API_BASE}/send-eod-helpdesk-report`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        storeNumber,
                        reportDate,
                        shiftLabel: meta.shiftLabel,
                        shiftVisitId: issue.shiftVisitId || '',
                        setLabel: meta.setLabel || issue.customIssue,
                        categoryNumber: meta.categoryNumber,
                        categoryName: meta.categoryName,
                        planogramId: meta.planogramId,
                        version: meta.version,
                        dbkey: meta.dbkey,
                        footageToken: meta.footageToken,
                        issueTypeId: issue.issueTypeId,
                        issueTypeLabel: opt?.label || issue.issueTypeId,
                        issueDetails,
                        customIssue: issue.customIssue,
                        setEntryManual: issue.setEntryManual,
                        photos: issue.photos,
                        userName,
                        userEmail,
                        extraRecipients: wizardExtraRecipients,
                        addRetailOdysseyTeam: addTeam,
                    }),
                });

                const result = await resp.json().catch(() => ({}));
                if (!resp.ok || !result.success) {
                    throw new Error(result.error || `Server error (${resp.status})`);
                }
                submitted.push(issue);
            }

            applyHelpdeskToEodForm(submitted);
            if (typeof window.syncEodWizardGlobals === 'function') window.syncEodWizardGlobals();
            closeHelpdeskWizard();
            if (typeof window.showAlert === 'function') {
                window.showAlert(
                    'Help desk reports sent',
                    `Sent ${submitted.length} report${submitted.length === 1 ? '' : 's'} to the KOMPASS help desk. Your form has been updated.`
                );
            }
        } catch (err) {
            console.error('Helpdesk submit failed:', err);
            if (typeof window.showAlert === 'function') {
                window.showAlert('Send failed', escapeHtml(err.message || String(err)));
            }
        } finally {
            if (loading) loading.classList.remove('show');
        }
    }

    function applyHelpdeskToEodForm(submitted) {
        window.helpdeskSubmittedReports = (window.helpdeskSubmittedReports || []).concat(submitted);

        const yes = document.getElementById('hotlineYes');
        const no = document.getElementById('hotlineNo');
        const details = document.getElementById('hotlineDetails');
        if (yes) yes.checked = true;
        if (no) no.checked = false;
        if (details) details.style.display = 'block';

        const commodities = document.getElementById('commodities');
        const issueEl = document.getElementById('issue');
        const summary = submitted.map((s) => {
            const opt = EOD_HELPDESK_ISSUE_OPTIONS.find((o) => o.id === s.issueTypeId);
            return `${opt?.label || s.issueTypeId}: ${issueSetDisplayName(s)}`;
        }).join('; ');
        if (commodities) commodities.value = 'See help desk reports';
        if (issueEl) issueEl.value = summary;

        const resolvedNa = document.getElementById('resolvedNA');
        if (resolvedNa) {
            resolvedNa.checked = true;
            ['resolvedYes', 'resolvedNo'].forEach((id) => {
                const el = document.getElementById(id);
                if (el) el.checked = false;
            });
        }

        submitted.forEach((issue) => {
            const setName = issueSetDisplayName(issue);
            if (issue.issueTypeId === 'not_in_store' && setName) {
                if (!window.notInStoreSelected.includes(setName)) {
                    window.notInStoreSelected.push(setName);
                }
            }
        });
        if (typeof window.renderSetsPickers === 'function') window.renderSetsPickers();
        if (typeof window.autoSave === 'function') window.autoSave();
    }

    window.toggleHelpdeskNeed = function toggleHelpdeskNeed(checkbox) {
        const yes = document.getElementById('helpdeskNeedYes');
        const no = document.getElementById('helpdeskNeedNo');
        if (checkbox.id === 'helpdeskNeedYes' && checkbox.checked) {
            if (no) no.checked = false;
            openHelpdeskWizard();
        } else if (checkbox.id === 'helpdeskNeedNo' && checkbox.checked) {
            if (yes) yes.checked = false;
        }
        if (typeof window.autoSave === 'function') window.autoSave();
    };

    window.openHelpdeskWizard = openHelpdeskWizard;
    window.closeHelpdeskWizard = closeHelpdeskWizard;
    window.submitHelpdeskWizard = submitHelpdeskWizard;

    document.addEventListener('DOMContentLoaded', () => {
        const addBtn = document.getElementById('helpdeskWizardAddRecipient');
        const input = document.getElementById('helpdeskWizardEmailInput');
        if (addBtn && input) {
            addBtn.addEventListener('click', () => {
                const email = input.value.trim().toLowerCase();
                if (!email || !email.includes('@')) return;
                if (!wizardExtraRecipients.includes(email)) wizardExtraRecipients.push(email);
                input.value = '';
                renderWizardRecipients();
            });
        }
    });
})();
