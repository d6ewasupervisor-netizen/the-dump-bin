/**
 * KOMPASS help desk wizard for the field app.
 * Bump EOD_APP_VERSION when this file changes.
 */
(function (global) {
  'use strict';

  const ISSUE_TYPES = [
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
  const AIYANA_EMAIL = 'aiyana.natarisalazar@retailodyssey.com';

  let issues = [];
  let ccList = [];
  let photoEdit = null;
  let setsLoad = null;

  function htmlEsc(s) {
    if (global.EodApi?.escapeHtml) return global.EodApi.escapeHtml(s);
    return String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function toast(title, html) {
    if (typeof global.showAlert === 'function') {
      global.showAlert(title, html);
      return;
    }
    const text = String(html || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    alert(title ? `${title}\n\n${text}` : text);
  }

  function ask(title, message) {
    return new Promise((resolve) => {
      if (typeof global.showConfirm === 'function') {
        global.showConfirm(title, message, () => resolve(true), () => resolve(false));
        return;
      }
      const text = String(message || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      resolve(window.confirm(title ? `${title}\n\n${text}` : text));
    });
  }

  function st() { return global.EodSession?.state || {}; }
  function storeNo() { return String(st().storeNumber || '').trim(); }
  function userName() { return String(st().profileName || st().leadName || '').trim(); }
  function userEmail() { return String(st().profileEmail || '').trim(); }
  function apiRoot() { return global.EOD_API_BASE || 'https://eod-api.the-dump-bin.com'; }
  function doFetch(url, init) {
    return typeof global.authFetch === 'function' ? global.authFetch(url, init) : fetch(url, init);
  }

  function stripAiyana(emails, store, keepEmail) {
    if (typeof global.omitAiyanaForNonDistrict8 === 'function') {
      return global.omitAiyanaForNonDistrict8(emails, store, keepEmail);
    }
    const keep = String(keepEmail || '').trim().toLowerCase();
    const isD8 = typeof global.isDistrict8Store === 'function' && global.isDistrict8Store(store);
    if (isD8) return emails || [];
    return (emails || []).filter((e) => {
      const n = String(e || '').trim().toLowerCase();
      return n !== AIYANA_EMAIL || n === keep;
    });
  }

  function pogDbkey(planogramId) {
    const m = String(planogramId || '').match(/_(\d{6,})_/);
    return m ? m[1] : '';
  }

  function setKey(s) {
    if (typeof global.setLabel === 'function') return global.setLabel(s);
    const k = s?.dbkey || pogDbkey(s?.planogramId);
    return k ? `${k}_${s.name || ''}` : (s?.name || '');
  }

  function setCaption(s) {
    if (typeof global.setDisplayLabel === 'function') return global.setDisplayLabel(s);
    const name = String(s?.name || 'Unnamed').trim();
    const version = s?.version
      ? (String(s.version).startsWith('V') ? String(s.version) : `V${s.version}`)
      : '';
    const footage = s?.footage || s?.footageDisplay || '';
    const dbkey = s?.dbkey || pogDbkey(s?.planogramId);
    return [name, footage, version, dbkey ? `#${dbkey}` : ''].filter(Boolean).join(' · ');
  }

  function visitKey(visitId) {
    if (typeof global.normalizeVisitId === 'function') return global.normalizeVisitId(visitId);
    return visitId == null || visitId === '' ? '' : String(visitId);
  }

  function ftToken(raw) {
    const s = String(raw || '').trim();
    if (!s) return '';
    if (/^[FD]\d+/i.test(s)) return s.toUpperCase();
    const n = s.replace(/[^\d.]/g, '');
    if (!n) return '';
    const whole = String(Math.round(Number(n)) || n).replace(/\D/g, '');
    return whole ? `F${whole.padStart(3, '0')}` : '';
  }

  function todayIso() {
    if (st().workDate) return String(st().workDate).slice(0, 10);
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  function setsMap() { return global.allShiftsSetsMap || {}; }

  function shiftCaption(shift) {
    return shift?.projectName || shift?.teamName || shift?.project || shift?.visitLead || shift?.visitId || 'Shift';
  }

  async function loadSets() {
    const existing = setsMap();
    if (Object.keys(existing).length) return existing;
    if (setsLoad) return setsLoad;
    setsLoad = (async () => {
      const shifts = Array.isArray(st().shifts) ? st().shifts : [];
      const map = {};
      await Promise.all(shifts.map(async (shift) => {
        const id = visitKey(shift.visitId);
        if (!id) return;
        try {
          const resp = await doFetch(`${apiRoot()}/api/shifts/${encodeURIComponent(id)}/sets`);
          const data = await resp.json().catch(() => ({}));
          if (!resp.ok) return;
          map[id] = {
            label: shiftCaption(shift),
            shift,
            sets: Array.isArray(data) ? data : (data.sets || []),
          };
        } catch (_) { /* optional */ }
      }));
      global.allShiftsSetsMap = map;
      return map;
    })();
    try {
      return await setsLoad;
    } finally {
      setsLoad = null;
    }
  }

  function matchRowSet(row) {
    const dbkey = String(row?.dbkey || row?.dbKey || '').trim();
    const catNum = String(row?.catId || '').replace(/\D/g, '');
    const name = String(row?.catName || '').trim().toLowerCase();
    for (const [visitId, entry] of Object.entries(setsMap())) {
      for (const s of entry.sets || []) {
        const sKey = String(s.dbkey || pogDbkey(s.planogramId) || '').trim();
        if (dbkey && sKey && dbkey === sKey) return { visitId, set: s, entry };
        const sNum = String(s.number || '').replace(/\D/g, '');
        const sName = String(s.name || '').trim().toLowerCase();
        if (catNum && sNum && catNum === sNum && (!name || !sName || sName === name)) {
          return { visitId, set: s, entry };
        }
      }
    }
    return null;
  }

  function cleanNisNote(issueTypeId, details) {
    let text = String(details || '').trim();
    if (String(issueTypeId || '') !== 'not_in_store') return text;
    if (!text) return 'Not in store.';
    if (/marked not in store/i.test(text)
      && /signoff|sign-off|coversheet|cover sheet|picker|selected|digital sheet|digital signoff/i.test(text)) {
      const stripped = text.replace(/marked not in store[^.!?\n]*[.!?]?/gi, ' ').replace(/\s+/g, ' ').trim();
      return stripped || 'Not in store.';
    }
    return text;
  }

  function blankIssue() {
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
      manualFootage: '',
      customIssue: '',
      details: '',
      photos: [],
      reportAnother: false,
      sourceRowId: '',
    };
  }

  function pickSet(issue, map) {
    if (issue.setEntryManual || !issue.shiftVisitId || !issue.setLabel) return null;
    const entry = map[visitKey(issue.shiftVisitId)];
    if (!entry || !Array.isArray(entry.sets)) return null;
    return entry.sets.find((s) => setKey(s) === issue.setLabel) || null;
  }

  function issueMeta(issue, map) {
    if (issue.setEntryManual) {
      return {
        shiftLabel: (issue.manualShiftName || '').trim(),
        setLabel: (issue.manualSetName || '').trim(),
        categoryName: (issue.manualSetName || '').trim(),
        categoryNumber: (issue.manualCategoryNumber || '').trim() || null,
        version: (issue.manualVersion || '').trim().replace(/^V/i, '') || null,
        dbkey: (issue.manualDbkey || '').trim() || null,
        planogramId: issue.planogramId || null,
        footageToken: ftToken(issue.footageToken || issue.manualFootage) || null,
      };
    }
    const set = pickSet(issue, map);
    const entry = issue.shiftVisitId ? map[visitKey(issue.shiftVisitId)] : null;
    return {
      shiftLabel: entry?.label || '',
      setLabel: (issue.setLabel || '').trim(),
      categoryNumber: set?.number || issue.categoryNumber || null,
      categoryName: set?.name || null,
      version: set?.version || issue.version || null,
      dbkey: set?.dbkey || issue.dbkey || null,
      planogramId: set?.planogramId || issue.planogramId || null,
      footageToken: ftToken(issue.footageToken || set?.footage || set?.footageDisplay || set?.size) || null,
    };
  }

  function issueName(issue) {
    return issueMeta(issue, setsMap()).setLabel || issue.customIssue || 'Unnamed set';
  }

  function typeOpts(selected) {
    return '<option value=""' + (!selected ? ' selected' : '') + '>Select or enter the issue…</option>'
      + ISSUE_TYPES.map((opt) =>
        `<option value="${opt.id}"${selected === opt.id ? ' selected' : ''}>${htmlEsc(opt.label)}</option>`
      ).join('');
  }

  function shiftOpts(selectedVisitId) {
    const map = setsMap();
    const keys = Object.keys(map);
    const norm = visitKey(selectedVisitId);
    if (!keys.length) return '<option value="">Find shifts on Visit first</option>';
    return '<option value="">Select shift…</option>' + keys.map((vid) =>
      `<option value="${htmlEsc(vid)}"${norm === visitKey(vid) ? ' selected' : ''}>${htmlEsc(map[vid]?.label || vid)}</option>`
    ).join('');
  }

  function setOpts(visitId, selectedLabel) {
    const id = visitKey(visitId);
    const sets = (id && setsMap()[id]?.sets) || [];
    if (!id) return '<option value="">Select a shift first</option>';
    if (!sets.length) return '<option value="">No sets loaded for this shift</option>';
    return '<option value="">Select set…</option>' + sets.map((s) => {
      const key = setKey(s);
      return `<option value="${htmlEsc(key)}" data-number="${s.number || ''}" data-version="${htmlEsc(s.version || '')}" data-dbkey="${htmlEsc(s.dbkey || '')}" data-footage="${htmlEsc(s.footage || '')}" data-planogram-id="${htmlEsc(s.planogramId || '')}"${selectedLabel === key ? ' selected' : ''}>${htmlEsc(setCaption(s))}</option>`;
    }).join('');
  }

  function paintIssues() {
    const host = document.getElementById('helpdeskWizardIssues');
    if (!host) return;
    host.innerHTML = issues.map((issue, idx) => {
      const custom = issue.issueTypeId === 'custom';
      const typed = !!issue.issueTypeId;
      const manual = !!issue.setEntryManual;
      const pickers = typed && !manual;
      const manualUi = typed && manual;
      return `<div class="hd-issue-card">
        <div class="hd-issue-header">Issue ${idx + 1}</div>
        <div class="field">
          <label>Issue type</label>
          <select class="hd-issue-type" data-idx="${idx}">${typeOpts(issue.issueTypeId)}</select>
        </div>
        ${typed ? `
        <div class="checkbox-option" style="margin:10px 0;">
          <input type="checkbox" class="hd-set-manual" id="hdSetManual${idx}" data-idx="${idx}" ${manual ? 'checked' : ''}>
          <label for="hdSetManual${idx}">Set isn't on my shift — enter set details manually</label>
        </div>` : ''}
        <div class="field" style="${pickers ? '' : 'display:none'}">
          <label>Shift</label>
          <select class="hd-shift-select" data-idx="${idx}">${shiftOpts(issue.shiftVisitId)}</select>
        </div>
        <div class="field" style="${pickers ? '' : 'display:none'}">
          <label>Set</label>
          <select class="hd-set-select" data-idx="${idx}">${setOpts(issue.shiftVisitId, issue.setLabel)}</select>
        </div>
        <div style="${manualUi ? '' : 'display:none'}">
          <div class="field">
            <label>Shift name</label>
            <input type="text" class="hd-manual-shift" data-idx="${idx}" value="${htmlEsc(issue.manualShiftName)}" placeholder="Which shift is this for?">
          </div>
          <div class="field" style="margin-top:10px;">
            <label>Set name / description</label>
            <input type="text" class="hd-manual-set-name" data-idx="${idx}" value="${htmlEsc(issue.manualSetName)}" placeholder="e.g. Frozen Pizza 4ft endcap">
          </div>
          <div style="margin-top:10px; display:flex; flex-wrap:wrap; gap:10px;">
            <div class="field" style="flex:1; min-width:120px;">
              <label>Category # (C)</label>
              <input type="text" class="hd-manual-category" data-idx="${idx}" value="${htmlEsc(issue.manualCategoryNumber)}" placeholder="1234" inputmode="numeric">
            </div>
            <div class="field" style="flex:1; min-width:120px;">
              <label>Version (V)</label>
              <input type="text" class="hd-manual-version" data-idx="${idx}" value="${htmlEsc(issue.manualVersion)}" placeholder="D701">
            </div>
            <div class="field" style="flex:1; min-width:140px;">
              <label>DB key</label>
              <input type="text" class="hd-manual-dbkey" data-idx="${idx}" value="${htmlEsc(issue.manualDbkey)}" placeholder="8509659" inputmode="numeric">
            </div>
            <div class="field" style="flex:1; min-width:120px;">
              <label>Footage</label>
              <input type="text" class="hd-manual-footage" data-idx="${idx}" value="${htmlEsc(issue.manualFootage || '')}" placeholder="4" inputmode="decimal">
            </div>
          </div>
        </div>
        <div class="field" style="${custom ? '' : 'display:none'}">
          <label>Describe the issue</label>
          <input type="text" class="hd-custom-input" data-idx="${idx}" value="${htmlEsc(issue.customIssue)}" placeholder="What is wrong or what do you need?">
        </div>
        <div class="field">
          <label>Details</label>
          <textarea class="hd-details" data-idx="${idx}" rows="3" placeholder="Add location, measurements, and any context the help desk needs">${htmlEsc(issue.details)}</textarea>
        </div>
        <div class="field">
          <label>Photos <span class="muted">(strongly recommended)</span></label>
          <div class="hd-photo-thumbs" id="hdPhotoThumbs${idx}"></div>
          <div class="btn-row" style="margin-top:8px;">
            <button type="button" class="btn btn-secondary hd-photo-camera" data-idx="${idx}">Take photo</button>
            <button type="button" class="btn btn-secondary hd-photo-pick" data-idx="${idx}">Choose photos</button>
          </div>
          <input type="file" class="hd-photo-input" data-idx="${idx}" accept="image/*,.heic,.heif" multiple hidden>
        </div>
        ${idx === issues.length - 1 ? `
        <div class="checkbox-option">
          <input type="checkbox" class="hd-report-another" id="hdReportAnother${idx}" data-idx="${idx}" ${issue.reportAnother ? 'checked' : ''}>
          <label for="hdReportAnother${idx}">Report additional issues</label>
        </div>` : ''}
      </div>`;
    }).join('');
    issues.forEach((_, idx) => paintThumbs(idx));
    bindIssueUi(host);
  }

  function bindIssueUi(host) {
    host.querySelectorAll('.hd-issue-type').forEach((sel) => {
      sel.addEventListener('change', () => {
        const i = Number(sel.dataset.idx);
        issues[i].issueTypeId = sel.value;
        if (sel.value === 'custom') {
          issues[i].shiftVisitId = '';
          issues[i].setLabel = '';
        }
        if (sel.value === 'not_in_store' && !String(issues[i].details || '').trim()) {
          issues[i].details = 'Not in store.';
        }
        paintIssues();
      });
    });
    host.querySelectorAll('.hd-set-manual').forEach((cb) => {
      cb.addEventListener('change', () => {
        const i = Number(cb.dataset.idx);
        issues[i].setEntryManual = cb.checked;
        if (cb.checked) {
          issues[i].shiftVisitId = '';
          issues[i].setLabel = '';
        } else {
          issues[i].manualShiftName = '';
          issues[i].manualSetName = '';
          issues[i].manualCategoryNumber = '';
          issues[i].manualVersion = '';
          issues[i].manualDbkey = '';
          issues[i].manualFootage = '';
          issues[i].footageToken = '';
        }
        paintIssues();
      });
    });
    host.querySelectorAll('.hd-shift-select').forEach((sel) => {
      sel.addEventListener('change', () => {
        const i = Number(sel.dataset.idx);
        issues[i].shiftVisitId = sel.value;
        issues[i].setLabel = '';
        issues[i].categoryNumber = '';
        issues[i].version = '';
        paintIssues();
      });
    });
    host.querySelectorAll('.hd-set-select').forEach((sel) => {
      sel.addEventListener('change', () => {
        const i = Number(sel.dataset.idx);
        const opt = sel.options[sel.selectedIndex];
        issues[i].setLabel = sel.value;
        issues[i].categoryNumber = opt?.dataset?.number || '';
        issues[i].version = opt?.dataset?.version || '';
        issues[i].dbkey = opt?.dataset?.dbkey || '';
        issues[i].planogramId = opt?.dataset?.planogramId || '';
        issues[i].footageToken = ftToken(opt?.dataset?.footage || '');
      });
    });
    const bind = (cls, fn) => {
      host.querySelectorAll(cls).forEach((el) => {
        el.addEventListener('input', () => fn(Number(el.dataset.idx), el.value));
      });
    };
    bind('.hd-custom-input', (i, v) => { issues[i].customIssue = v; });
    bind('.hd-manual-shift', (i, v) => { issues[i].manualShiftName = v; });
    bind('.hd-manual-set-name', (i, v) => { issues[i].manualSetName = v; });
    bind('.hd-manual-category', (i, v) => { issues[i].manualCategoryNumber = v; });
    bind('.hd-manual-version', (i, v) => { issues[i].manualVersion = v; });
    bind('.hd-manual-dbkey', (i, v) => { issues[i].manualDbkey = v; });
    bind('.hd-details', (i, v) => { issues[i].details = v; });
    host.querySelectorAll('.hd-manual-footage').forEach((inp) => {
      inp.addEventListener('input', () => {
        const i = Number(inp.dataset.idx);
        issues[i].manualFootage = inp.value;
        issues[i].footageToken = ftToken(inp.value);
      });
    });
    host.querySelectorAll('.hd-report-another').forEach((cb) => {
      cb.addEventListener('change', () => {
        const i = Number(cb.dataset.idx);
        issues[i].reportAnother = cb.checked;
        if (cb.checked && i === issues.length - 1) {
          issues.push(blankIssue());
          paintIssues();
        }
      });
    });
    host.querySelectorAll('.hd-photo-pick').forEach((btn) => {
      btn.addEventListener('click', () => {
        const input = host.querySelector(`.hd-photo-input[data-idx="${btn.dataset.idx}"]`);
        if (input) input.click();
      });
    });
    host.querySelectorAll('.hd-photo-camera').forEach((btn) => {
      btn.addEventListener('click', () => takePhoto(Number(btn.dataset.idx)));
    });
    host.querySelectorAll('.hd-photo-input').forEach((input) => {
      input.addEventListener('change', () => onPhotos(input));
    });
  }

  function paintThumbs(issueIdx) {
    const el = document.getElementById(`hdPhotoThumbs${issueIdx}`);
    if (!el) return;
    const photos = issues[issueIdx]?.photos || [];
    el.innerHTML = photos.map((src, pi) =>
      `<div class="hd-photo-thumb">
        <img src="${src}" alt="Issue photo ${pi + 1}">
        <button type="button" class="hd-photo-annotate" data-issue="${issueIdx}" data-photo="${pi}" title="Annotate">✎</button>
        <button type="button" class="hd-photo-remove" data-issue="${issueIdx}" data-photo="${pi}" title="Remove">&times;</button>
      </div>`
    ).join('');
    el.querySelectorAll('.hd-photo-remove').forEach((btn) => {
      btn.addEventListener('click', () => {
        issues[Number(btn.dataset.issue)].photos.splice(Number(btn.dataset.photo), 1);
        paintThumbs(Number(btn.dataset.issue));
      });
    });
    el.querySelectorAll('.hd-photo-annotate').forEach((btn) => {
      btn.addEventListener('click', () => annotatePhoto(Number(btn.dataset.issue), Number(btn.dataset.photo)));
    });
  }

  async function onPhotos(input) {
    const idx = Number(input.dataset.idx);
    const files = Array.from(input.files || []);
    input.value = '';
    for (const file of files) {
      try {
        const converted = global.EodHeic?.prepareFile ? await global.EodHeic.prepareFile(file) : file;
        let dataUrl;
        if (global.EodPhotoCompress?.compressFile) {
          const out = await global.EodPhotoCompress.compressFile(converted, 'signoff');
          dataUrl = out.dataUrl;
        } else {
          dataUrl = await fileToDataUrl(converted);
        }
        issues[idx].photos.push(dataUrl);
      } catch (e) {
        console.warn('Helpdesk photo load failed:', e);
      }
    }
    paintThumbs(idx);
  }

  function fileToDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  function takePhoto(issueIdx) {
    if (global.EodCamera?.open) {
      global.EodCamera.open({
        label: 'Helpdesk photo',
        onCapture: async (file) => {
          try {
            const converted = global.EodHeic?.prepareFile ? await global.EodHeic.prepareFile(file) : file;
            let dataUrl;
            if (global.EodPhotoCompress?.compressFile) {
              const out = await global.EodPhotoCompress.compressFile(converted, 'signoff');
              dataUrl = out.dataUrl;
            } else {
              dataUrl = await fileToDataUrl(converted);
            }
            issues[issueIdx].photos.push(dataUrl);
            paintThumbs(issueIdx);
          } catch (e) {
            console.warn('Helpdesk camera failed:', e);
          }
        },
        shouldContinue: () => true,
      });
      return;
    }
    const input = document.querySelector(`.hd-photo-input[data-idx="${issueIdx}"]`);
    if (!input) return;
    input.setAttribute('capture', 'environment');
    input.click();
    input.removeAttribute('capture');
  }

  function annotatePhoto(issueIdx, photoIdx) {
    const dataUrl = issues[issueIdx]?.photos?.[photoIdx];
    if (!dataUrl) return;
    photoEdit = { issueIdx, photoIdx };
    if (global.EodPhotoEditor?.open) {
      global.EodPhotoEditor.open({
        dataUrl,
        onSave: (url) => global.saveHelpdeskAnnotatedPhoto(url),
      });
      return;
    }
    const editor = global.openImageEditor;
    if (typeof editor !== 'function') return;
    if (!global.photos) global.photos = {};
    global.photos.helpdesk = [dataUrl];
    editor(0, 'helpdesk');
  }

  global.saveHelpdeskAnnotatedPhoto = function saveHelpdeskAnnotatedPhoto(dataUrl) {
    if (!photoEdit) return;
    const { issueIdx, photoIdx } = photoEdit;
    if (issues[issueIdx]?.photos?.[photoIdx] != null) {
      issues[issueIdx].photos[photoIdx] = dataUrl;
      paintThumbs(issueIdx);
    }
    photoEdit = null;
    if (global.photos?.helpdesk) global.photos.helpdesk = [];
  };

  function paintCc() {
    const list = document.getElementById('helpdeskWizardRecipientList');
    const wrap = document.getElementById('helpdeskWizardRecipientContainer');
    if (!list) return;
    if (!ccList.length) {
      if (wrap) wrap.style.display = 'none';
      return;
    }
    if (wrap) wrap.style.display = 'block';
    list.innerHTML = ccList.map((email, i) =>
      `<span class="recipient-chip">${htmlEsc(email)} <button type="button" data-rm="${i}">&times;</button></span>`
    ).join('');
    list.querySelectorAll('button[data-rm]').forEach((btn) => {
      btn.addEventListener('click', () => {
        ccList.splice(Number(btn.dataset.rm), 1);
        paintCc();
      });
    });
  }

  function rowPrefill(row) {
    if (!row) {
      return { issueTypeId: 'not_in_store', setEntryManual: true, details: 'Not in store.' };
    }
    const match = matchRowSet(row);
    const version = String(row.versionToken || row.version || '').replace(/^V/i, '');
    const footageRaw = row.footageDisplay || row.size || row.footage || '';
    const catNum = row.catId != null ? String(row.catId).replace(/\D/g, '') : '';
    const shiftLabel = row.shiftType || st().selectedShift?.projectName || '';
    const name = row.catName || row.catId || row.dbkey || 'Unnamed set';
    if (match?.set) {
      return {
        issueTypeId: 'not_in_store',
        setEntryManual: false,
        shiftVisitId: match.visitId,
        setLabel: setKey(match.set),
        categoryNumber: match.set.number || catNum,
        version: match.set.version || version,
        dbkey: match.set.dbkey || String(row.dbkey || ''),
        planogramId: match.set.planogramId || '',
        footageToken: ftToken(match.set.footage || footageRaw),
        details: 'Not in store.',
        sourceRowId: row.id || '',
      };
    }
    return {
      issueTypeId: 'not_in_store',
      setEntryManual: true,
      manualShiftName: String(shiftLabel || ''),
      manualSetName: String(name),
      manualCategoryNumber: catNum,
      manualVersion: version,
      manualDbkey: String(row.dbkey || ''),
      manualFootage: String(footageRaw || ''),
      footageToken: ftToken(footageRaw || row.footage),
      details: 'Not in store.',
      sourceRowId: row.id || '',
    };
  }

  async function openWizard(prefill) {
    try { await loadSets(); } catch (_) { /* still open */ }
    issues = [Object.assign(blankIssue(), prefill && typeof prefill === 'object' ? prefill : {})];
    const recipients = st().emailRecipients || global.emailRecipients || [];
    ccList = stripAiyana(recipients.slice(), storeNo(), userEmail());
    paintIssues();
    paintCc();
    const overlay = document.getElementById('helpdeskWizardOverlay');
    if (overlay) overlay.classList.add('show');
  }

  async function openFromRow(row) {
    try { await loadSets(); } catch (_) { /* still open */ }
    await openWizard(rowPrefill(row));
  }

  async function askNisReport(row) {
    const name = row?.catName || row?.dbkey || 'this set';
    const ok = await ask(
      'Report this to the help desk?',
      `This set is not in store:\n\n${name}\n\nSend a KOMPASS help desk report with the full set details?`
    );
    if (!ok) return false;
    await openFromRow(row);
    return true;
  }

  function closeWizard() {
    const overlay = document.getElementById('helpdeskWizardOverlay');
    if (overlay) overlay.classList.remove('show');
  }

  function checkIssues() {
    const problems = [];
    const photoWarnings = [];
    issues.forEach((issue, i) => {
      if (!issue.issueTypeId) problems.push(`Issue ${i + 1}: select an issue type.`);
      if (issue.issueTypeId === 'custom' && !String(issue.customIssue || '').trim() && !String(issue.manualSetName || '').trim()) {
        problems.push(`Issue ${i + 1}: describe the issue or enter a set name.`);
      }
      if (issue.setEntryManual) {
        if (!String(issue.manualSetName || '').trim()) {
          problems.push(`Issue ${i + 1}: enter the set name or description.`);
        }
      } else if (issue.issueTypeId && issue.issueTypeId !== 'custom') {
        if (!issue.shiftVisitId) problems.push(`Issue ${i + 1}: select a shift, or check "enter set details manually".`);
        if (!issue.setLabel) problems.push(`Issue ${i + 1}: select a set, or check "enter set details manually".`);
      }
      if (!issue.photos.length) photoWarnings.push(`Issue ${i + 1} has no photos.`);
    });
    return { problems, photoWarnings };
  }

  async function submitWizard() {
    const { problems, photoWarnings } = checkIssues();
    if (problems.length) {
      toast('Complete help desk reports', '<ul><li>' + problems.join('</li><li>') + '</li></ul>');
      return;
    }
    if (photoWarnings.length) {
      const go = await ask(
        'No photos attached',
        'Photos are strongly recommended so the help desk can see the problem.\n\n'
          + photoWarnings.join('\n')
          + '\n\nSubmit without photos?'
      );
      if (!go) return;
    }
    await sendAll();
  }

  function keepNis(setName) {
    const S = global.EodSession;
    const list = (S?.state?.notInStoreSelected || global.notInStoreSelected || []).slice();
    if (!list.includes(setName)) list.push(setName);
    if (S) S.patch({ notInStoreSelected: list }, 'helpdesk-nis');
    else global.notInStoreSelected = list;
  }

  function applyToVisit(submitted) {
    const S = global.EodSession;
    const reports = (S?.state?.helpdeskSubmittedReports || global.helpdeskSubmittedReports || []).concat(submitted);
    if (typeof global.setHelpdeskSubmittedReports === 'function') {
      global.setHelpdeskSubmittedReports(reports);
    } else if (S) {
      S.patch({ helpdeskSubmittedReports: reports }, 'helpdesk');
    } else {
      global.helpdeskSubmittedReports = reports;
    }
    submitted.forEach((issue) => {
      const meta = issue.setMeta || issueMeta(issue, setsMap());
      const setName = meta.setLabel || issueName(issue);
      if (issue.issueTypeId === 'not_in_store' && setName) {
        keepNis(setName);
        S?.appendNote?.(`Not in store: ${setName}`);
        if (global.EodSignoffHome?.markNotInStoreFromHelpdesk) {
          global.EodSignoffHome.markNotInStoreFromHelpdesk({
            rowId: issue.sourceRowId,
            dbkey: meta.dbkey,
            categoryNumber: meta.categoryNumber,
            setLabel: setName,
            categoryName: meta.categoryName,
            helpdeskSent: true,
          }).catch((err) => console.warn('signoff NIS from helpdesk', err));
        }
      } else if (setName && S?.appendNote) {
        const opt = ISSUE_TYPES.find((o) => o.id === issue.issueTypeId);
        S.appendNote(`Help desk: ${opt?.label || issue.issueTypeId} — ${setName}`);
      }
    });
    try { S?.saveDraft?.(); } catch (_) { /* ignore */ }
  }

  async function sendAll() {
    const store = storeNo();
    if (!store) {
      toast('Store required', 'Confirm store and date on Visit before sending a help desk report.');
      return;
    }
    const map = setsMap();
    const extraRecipients = stripAiyana(ccList, store, userEmail());
    const addTeam = document.getElementById('helpdeskAddRetailOdysseyTeam')?.checked || false;
    const submitted = [];
    try {
      for (const issue of issues.filter((item) => item.issueTypeId)) {
        const opt = ISSUE_TYPES.find((o) => o.id === issue.issueTypeId);
        const meta = issueMeta(issue, map);
        const issueDetails = cleanNisNote(issue.issueTypeId, issue.details);
        const resp = await doFetch(`${apiRoot()}/send-eod-helpdesk-report`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            storeNumber: store,
            reportDate: todayIso(),
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
            userName: userName(),
            userEmail: userEmail(),
            extraRecipients,
            addRetailOdysseyTeam: addTeam,
          }),
        });
        const result = await resp.json().catch(() => ({}));
        if (!resp.ok || !result.success) {
          throw new Error(result.error || `Server error (${resp.status})`);
        }
        submitted.push(Object.assign({}, issue, { setMeta: meta, details: issueDetails }));
      }
      applyToVisit(submitted);
      closeWizard();
      toast(
        'Help desk reports sent',
        `Sent ${submitted.length} report${submitted.length === 1 ? '' : 's'} to the KOMPASS help desk.`
      );
    } catch (err) {
      console.error('Helpdesk submit failed:', err);
      toast('Send failed', htmlEsc(err.message || String(err)));
    }
  }

  function addCc() {
    const input = document.getElementById('helpdeskWizardEmailInput');
    if (!input) return;
    const email = input.value.trim().toLowerCase();
    if (!email || !email.includes('@')) return;
    if (email === AIYANA_EMAIL
      && typeof global.isDistrict8Store === 'function'
      && !global.isDistrict8Store(storeNo())
      && email !== userEmail().toLowerCase()) {
      input.value = '';
      toast('District 8 only', 'Aiyana is only CC’d on District 8 stores.');
      return;
    }
    if (!ccList.includes(email)) ccList.push(email);
    input.value = '';
    paintCc();
  }

  document.addEventListener('DOMContentLoaded', () => {
    const addBtn = document.getElementById('helpdeskWizardAddRecipient');
    const input = document.getElementById('helpdeskWizardEmailInput');
    if (addBtn) addBtn.addEventListener('click', addCc);
    if (input) {
      input.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter') {
          ev.preventDefault();
          addCc();
        }
      });
    }
  });

  global.openHelpdeskWizard = openWizard;
  global.openHelpdeskForSheetRow = openFromRow;
  global.askToReportNotInStore = askNisReport;
  global.closeHelpdeskWizard = closeWizard;
  global.submitHelpdeskWizard = submitWizard;
  global.ensureHelpdeskShiftsSetsMap = loadSets;
  global.sanitizeNotInStoreDetails = cleanNisNote;
})(typeof window !== 'undefined' ? window : globalThis);
