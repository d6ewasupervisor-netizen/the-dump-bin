/* Cover sheet auto-fill from digital marks, helpdesk, and PIC QR checkout manager. */
(function () {
  'use strict';

  const NOTES_MARKER = '— Day summary —';

  function markActive(row, type) {
    const m = row?.marks || row?.mark;
    if (!m) return false;
    if (Array.isArray(m.active)) return m.active.includes(type);
    if (type === 'complete') return !!m.complete;
    if (type === 'not_in_store') return !!m.notInStore;
    if (type === 'not_in_si') return !!m.notInSi;
    return m.type === type;
  }

  function getSheet() {
    return window.EodDigitalSignoff?.getSheet?.()
      || window.EodDigitalSignoff?.sheet
      || null;
  }

  function setExclusiveCheckbox(yesId, noId, yes) {
    const y = document.getElementById(yesId);
    const n = document.getElementById(noId);
    if (!y || !n) return;
    y.checked = !!yes;
    n.checked = !yes;
  }

  function syncProdSi() {
    const sheet = getSheet();
    const rows = sheet?.rows || [];
    if (!rows.length) return;

    const allProd = rows.every((r) => markActive(r, 'complete') || markActive(r, 'not_in_store'));
    const allSi = rows.every((r) => markActive(r, 'complete') || markActive(r, 'not_in_si'));
    setExclusiveCheckbox('prodYes', 'prodNo', allProd);
    setExclusiveCheckbox('siYes', 'siNo', allSi);

    // Mirror NIS / NISI from marks into legacy arrays (cover pickers hidden)
    const nis = [];
    const nisi = [];
    for (const row of rows) {
      const label = row.catName || row.dbkey;
      if (!label) continue;
      if (markActive(row, 'not_in_store')) nis.push(label);
      if (markActive(row, 'not_in_si')) nisi.push(label);
    }
    if (Array.isArray(window.notInStoreSelected)) window.notInStoreSelected = nis;
    if (Array.isArray(window.notInSiSelected)) window.notInSiSelected = nisi;
  }

  function syncHelpdesk() {
    const reports = window.helpdeskSubmittedReports || [];
    const sheet = getSheet();
    const hasNis = (sheet?.rows || []).some((r) => markActive(r, 'not_in_store'));
    const yes = reports.length > 0 || hasNis;
    setExclusiveCheckbox('helpdeskNeedYes', 'helpdeskNeedNo', yes);
  }

  function syncCheckoutManager() {
    const out = document.getElementById('checkOutManager');
    if (!out) return;
    const st = window.EodPicQr?.getState?.() || {};
    const name = st.checkoutManagerName;
    const title = st.checkoutManagerTitle;
    const fromPic = name
      ? (title ? `${name} (${title})` : name)
      : '';
    if (fromPic && !out.value.trim()) {
      out.value = fromPic;
    }
  }

  function buildDaySummary() {
    const parts = [];
    const sheet = getSheet();
    const rows = sheet?.rows || [];
    const nis = rows.filter((r) => markActive(r, 'not_in_store')).map((r) => r.catName || r.dbkey).filter(Boolean);
    const nisi = rows.filter((r) => markActive(r, 'not_in_si')).map((r) => r.catName || r.dbkey).filter(Boolean);
    if (nis.length) parts.push(`Not in store: ${nis.join(', ')}`);
    if (nisi.length) parts.push(`Not in SI: ${nisi.join(', ')}`);
    const reports = window.helpdeskSubmittedReports || [];
    if (reports.length) {
      parts.push(`Help desk reports: ${reports.length}`);
      reports.slice(0, 5).forEach((r) => {
        const issue = r.issue || r.issueDetails || r.setName || '';
        if (issue) parts.push(`  · ${issue}`);
      });
    }
    const picName = window.EodPicQr?.getState?.()?.checkoutManagerName
      || document.getElementById('checkOutManager')?.value?.trim();
    if (picName) parts.push(`Checked out with: ${picName}`);
    const deptSigs = document.querySelectorAll('#deptSigRoleList .dept-sig-role-done, #deptSigSection [data-signed="1"]');
    if (deptSigs.length) parts.push(`Department signatures collected: ${deptSigs.length}`);
    return parts.join('\n');
  }

  function syncNotes() {
    const ta = document.getElementById('notes');
    if (!ta) return;
    const summary = buildDaySummary();
    if (!summary) return;
    const current = ta.value || '';
    const idx = current.indexOf(NOTES_MARKER);
    const manual = idx >= 0 ? current.slice(0, idx).replace(/\s+$/, '') : current.replace(/\s+$/, '');
    const next = manual
      ? `${manual}\n\n${NOTES_MARKER}\n${summary}`
      : `${NOTES_MARKER}\n${summary}`;
    if (ta.value !== next) ta.value = next;
  }

  function hideDuplicateCoverPickers() {
    ['setsNotInStoreField', 'setsNotInSiField', 'notInShiftPickerField'].forEach((id) => {
      const el = document.getElementById(id);
      if (el) {
        el.hidden = true;
        el.style.display = 'none';
      }
    });
    // Soft-label auto fields
    const prodLabel = document.querySelector('label[for="prodYes"]')?.closest('.field');
    if (prodLabel && !prodLabel.dataset.autoHint) {
      prodLabel.dataset.autoHint = '1';
      const hint = document.createElement('div');
      hint.className = 'sets-help';
      hint.style.marginTop = '6px';
      hint.textContent = 'Auto-filled from digital signoff marks (Complete or Not in store).';
      prodLabel.appendChild(hint);
    }
  }

  function hideYesNoGates() {
    // InstaWork / Kompass / materials Yes-No — infer / always show
    const iwYes = document.getElementById('instaworkYes');
    const iwNo = document.getElementById('instaworkNo');
    const iwField = iwYes?.closest('.field');
    if (iwField) {
      iwField.hidden = true;
      iwField.style.display = 'none';
    }

    const kpYes = document.getElementById('kompassTimesheetYes');
    const kpField = kpYes?.closest('.field');
    if (kpField) {
      kpField.hidden = true;
      kpField.style.display = 'none';
    }

    const matYes = document.getElementById('materialsReadYes');
    const matField = matYes?.closest('.field') || document.getElementById('materialsInfoSection')?.querySelector('.checkbox-group')?.closest('.field');
    if (matField) {
      matField.hidden = true;
      matField.style.display = 'none';
    }
    // Hide entire materials Yes/No question row if present
    const matSection = document.getElementById('materialsInfoSection');
    if (matSection) {
      matSection.querySelectorAll('.checkbox-group').forEach((g) => {
        const f = g.closest('.field') || g;
        f.hidden = true;
        f.style.display = 'none';
      });
    }

    // Ensure management buttons + InstaWork photo panel stay available
    const iwBtn = document.getElementById('openInstaworkMgmtBtn');
    const kpBtn = document.getElementById('openKompassMgmtBtn');
    if (iwBtn) iwBtn.style.display = '';
    if (kpBtn) kpBtn.style.display = '';
    const panel = document.getElementById('instaworkYesPanel');
    if (panel) {
      panel.style.display = '';
      panel.hidden = false;
    }

    // Infer InstaWork Yes when a sign-out photo exists or management roster was used
    const hasIwPhoto = (window.photos?.instawork?.length > 0)
      || (Array.isArray(window.eodSelections?.instawork) && window.eodSelections.instawork.length > 0);
    if (hasIwPhoto && iwYes && !iwYes.checked) {
      iwYes.checked = true;
      if (iwNo) iwNo.checked = false;
    }
  }

  function syncAll() {
    try {
      hideDuplicateCoverPickers();
      hideYesNoGates();
      syncProdSi();
      syncHelpdesk();
      syncCheckoutManager();
      syncNotes();
      if (typeof window.autoSave === 'function') window.autoSave();
    } catch (err) {
      console.warn('[cover-sync]', err);
    }
  }

  // Hook digital signoff reloads
  const orig = window.EodDigitalSignoff;
  if (orig) {
    const wrap = (fnName) => {
      const fn = orig[fnName];
      if (typeof fn !== 'function' || fn.__coverSyncWrapped) return;
      const wrapped = async function (...args) {
        const result = await fn.apply(this, args);
        setTimeout(syncAll, 50);
        return result;
      };
      wrapped.__coverSyncWrapped = true;
      orig[fnName] = wrapped;
    };
    ['loadSheet', 'refresh', 'reload'].forEach(wrap);
  }

  window.EodCoverSync = { syncAll, buildDaySummary, syncCheckoutManager };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      hideYesNoGates();
      hideDuplicateCoverPickers();
      setTimeout(syncAll, 800);
      setInterval(syncAll, 45000);
    });
  } else {
    hideYesNoGates();
    hideDuplicateCoverPickers();
    setTimeout(syncAll, 800);
    setInterval(syncAll, 45000);
  }
})();
