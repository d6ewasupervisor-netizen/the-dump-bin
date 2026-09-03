/* Pure helpers for EOD send-sheet images. Node-testable. */
(function (global) {
  'use strict';

  function padStore(n) {
    return String(n || '').replace(/\D/g, '').padStart(3, '0');
  }

  function dateCompact(iso) {
    return String(iso || '').replace(/-/g, '').slice(0, 8);
  }

  function isMainKompassIse(shift) {
    if (!shift) return false;
    if (Number(shift.projectId) === 1) return true;
    const type = String(shift.kompassType || '').trim().toLowerCase();
    if (type === 'kompass ise') return true;
    const name = String(shift.projectName || '').toLowerCase();
    if (/cut\s*in/.test(name) || /blitz/.test(name) || /\bdiv\b/.test(name)) return false;
    return /kompass\s*ise/.test(name);
  }

  /**
   * Prefer the selected shift when it is Kompass ISE (project 1).
   * Otherwise pick the store-day sibling that is the main ISE visit.
   */
  function pickMainKompassIseVisit(shifts, selectedShift) {
    if (isMainKompassIse(selectedShift)) return selectedShift;
    const list = Array.isArray(shifts) ? shifts : [];
    return list.find(isMainKompassIse) || null;
  }

  function isCentralPetReset(shift) {
    if (!shift) return false;
    const blob = [
      shift.projectName,
      shift.teamName,
      shift.kompassType,
      shift.projectType,
      shift.shiftType,
    ].map((s) => String(s || '').toLowerCase()).join(' ');
    return /central\s*pet/.test(blob)
      || /pet\s*service\s*surge/.test(blob)
      || /pet\s*reset/.test(blob);
  }

  // SAS projects the Visit page lists and can auto-select.
  const SELECTABLE_PROJECT_IDS = new Set([
    1, 1668, 1715, 3568, 11909, 11099, 9295, 9293,
  ]);

  function shiftProjectId(shift) {
    const n = Number(shift?.projectId ?? shift?.project_id);
    return Number.isFinite(n) && n > 0 ? n : 0;
  }

  function shiftTypeBlob(shift) {
    return [
      shift?.projectName,
      shift?.teamName,
      shift?.kompassType,
      shift?.projectType,
      shift?.shiftType,
    ].map((s) => String(s || '').toLowerCase()).join(' ');
  }

  function isCutInBlitzDiv(shift) {
    const id = shiftProjectId(shift);
    if (id === 1668 || id === 1715 || id === 3568 || id === 11909) return true;
    const blob = shiftTypeBlob(shift);
    return /cut\s*in/.test(blob) || /blitz/.test(blob) || /\bdiv\b/.test(blob);
  }

  function isCentralPetResetProject(shift) {
    if (shiftProjectId(shift) === 9295) return true;
    return /central\s*pet\s*reset/.test(shiftTypeBlob(shift));
  }

  function isDeletedVisitShift(shift) {
    const status = String(shift?.currentStatus || shift?.current_status || shift?.status || '').toLowerCase();
    return status === 'deleted';
  }

  function isSelectableVisitShift(shift) {
    if (!shift) return false;
    if (isDeletedVisitShift(shift)) return false;
    if (SELECTABLE_PROJECT_IDS.has(shiftProjectId(shift))) return true;
    const blob = shiftTypeBlob(shift);
    return isCutInBlitzDiv(shift)
      || isCentralPetReset(shift)
      || /remodel/.test(blob)
      || /kompass\s*ise/.test(blob);
  }

  function leadNamesMatch(a, b) {
    const na = String(a || '').trim().toLowerCase().replace(/\s+/g, ' ');
    const nb = String(b || '').trim().toLowerCase().replace(/\s+/g, ' ');
    if (!na || !nb) return false;
    if (na === nb) return true;
    const aParts = na.split(' ');
    const bParts = nb.split(' ');
    if (aParts[0] === bParts[0] && aParts[aParts.length - 1] === bParts[bParts.length - 1]) return true;
    return na.includes(nb) || nb.includes(na);
  }

  function shiftLeadName(shift) {
    return String(shift?.visitLead || shift?.leadName || '').trim();
  }

  function uniqueShifts(list) {
    const seen = new Set();
    const out = [];
    for (const s of list || []) {
      const id = String(s?.visitId ?? s?.id ?? '');
      if (!id || seen.has(id)) continue;
      seen.add(id);
      out.push(s);
    }
    return out;
  }

  function visibleLeadShifts(shifts, leadName) {
    const list = (Array.isArray(shifts) ? shifts : []).filter(isSelectableVisitShift);
    const lead = String(leadName || '').trim();
    if (!lead) return list;
    const mine = list.filter((s) => leadNamesMatch(shiftLeadName(s), lead));
    if (!mine.length) return list;
    const iseFamily = list.filter((s) => !isCentralPetReset(s));
    const myCp = mine.filter(isCentralPetReset);
    return uniqueShifts([...iseFamily, ...myCp]);
  }

  function autoSelectLeadShift(visible, leadName) {
    const lead = String(leadName || '').trim();
    const mine = lead
      ? visible.filter((s) => leadNamesMatch(shiftLeadName(s), lead))
      : [];
    const sameLead = mine.length > 0;
    const pool = sameLead ? mine : visible;
    if (sameLead) {
      return pool.find(isCutInBlitzDiv)
        || pool.find(isCentralPetResetProject)
        || pool.find(isCentralPetReset)
        || pool[0]
        || null;
    }
    return pool.find(isCutInBlitzDiv)
      || pool.find(isMainKompassIse)
      || pool.find((s) => !isCentralPetReset(s))
      || pool[0]
      || null;
  }

  function pickVisibleLeadShift(shifts, leadName, current) {
    const list = Array.isArray(shifts) ? shifts : [];
    const visible = visibleLeadShifts(list, leadName);
    const ise = pickMainKompassIseVisit(list, null);
    const curId = current?.visitId != null ? String(current.visitId) : '';
    let selected = null;
    if (curId && visible.some((s) => String(s.visitId) === curId)) {
      selected = visible.find((s) => String(s.visitId) === curId) || current;
    } else if (visible.length === 1) {
      selected = visible[0];
    } else {
      selected = autoSelectLeadShift(visible, leadName) || ise || null;
    }
    return { visible, selected, ise };
  }

  function eodPdfFilename(storeNumber, workDate) {
    const pad = padStore(storeNumber);
    const s = String(workDate || '').trim();
    const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    const md = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})/);
    let mm = '00';
    let dd = '00';
    let yy = '00';
    if (iso) {
      mm = iso[2];
      dd = iso[3];
      yy = iso[1].slice(-2);
    } else if (md) {
      mm = String(md[1]).padStart(2, '0');
      dd = String(md[2]).padStart(2, '0');
      yy = String(md[3]).slice(-2);
    }
    return `EOD_FM${pad}_${mm}-${dd}-${yy}.pdf`;
  }

  function isRemotePhotoSrc(src) {
    const s = String(src || '').trim();
    return /^https?:\/\//i.test(s) || /^blob:/i.test(s);
  }

  function isSendableImageSrc(src) {
    const s = String(src || '').trim();
    if (!s || isRemotePhotoSrc(s)) return false;
    return /^data:image\//i.test(s);
  }

  function photoEntrySrc(entry) {
    if (!entry) return '';
    if (typeof entry === 'string') return entry;
    return entry.dataUrl || entry.previewUrl || entry.objectUrl || entry.preview || '';
  }

  function isDisplayablePhotoSrc(src, liveBlobUrls) {
    const s = String(src || '').trim();
    if (/^data:image\//i.test(s)) return true;
    if (/^blob:/i.test(s) && liveBlobUrls && typeof liveBlobUrls.has === 'function') {
      return liveBlobUrls.has(s);
    }
    return false;
  }

  function cartSlotHasLoadedPhotos(entries, liveBlobUrls) {
    return (Array.isArray(entries) ? entries : []).some((p) => (
      isDisplayablePhotoSrc(photoEntrySrc(p), liveBlobUrls)
    ));
  }

  function cartSlotNeedsProdPull(entries, liveBlobUrls) {
    return !cartSlotHasLoadedPhotos(entries, liveBlobUrls);
  }

  function cartSlotLabel(filename, source) {
    const kind = classifySheetFilename(filename);
    if (kind === 'cart-before' || source === 'cart-before') return 'Kompass cart — before';
    if (kind === 'cart-after' || source === 'cart-after') return 'Kompass cart — after';
    return 'Photo';
  }

  function skippedPhotoMessage(skipped) {
    const list = Array.isArray(skipped) ? skipped.filter(Boolean) : [];
    if (!list.length) return '';
    const labels = [...new Set(list.map((s) => s.label || cartSlotLabel(s.filename, s.source)))];
    const which = labels.join(' and ');
    return `${which} didn't save. Retake it or tap Pull from PROD, then Send again. The rest of this EOD still went out.`;
  }

  function classifySheetFilename(filename) {
    const name = String(filename || '').toLowerCase();
    if (name.includes('coversheet')) return 'coversheet';
    if (name.includes('digital_signoff') || name.includes('digital-signoff')) return 'digital';
    if (name.includes('cart_before') || name.includes('cart-before')) return 'cart-before';
    if (name.includes('cart_after') || name.includes('cart-after')) return 'cart-after';
    return 'photo';
  }

  function formatDeptSignatureLines(collected) {
    const list = Array.isArray(collected) ? collected : [];
    const lines = [];
    const seen = new Set();
    for (const item of list) {
      if (!item) continue;
      const roleKey = String(item.roleKey || '').trim().toLowerCase();
      if (roleKey === 'lead') continue;
      const name = String(item.signerName || item.name || item.label || '').trim();
      if (!name || /^none/i.test(name)) continue;
      const role = String(item.roleLabel || item.role || item.roleKey || '').trim();
      const line = role ? `• ${name} (${role})` : `• ${name}`;
      const key = line.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      lines.push(line);
    }
    return lines;
  }

  function digitalSignoffCoverValue(sheet) {
    if (sheet && Array.isArray(sheet.rows) && sheet.rows.length) return 'attached';
    return 'none (no hosted sheet)';
  }

  function signedOutFromSheet(S) {
    if (!S?.hasHostedSheet?.() && !S?.state?.sheet) return { prod: '—', si: '—' };
    if (typeof S.sheetSendReady === 'function' && S.sheetSendReady()) {
      return { prod: 'Yes', si: 'Yes' };
    }
    const rows = S?.state?.sheet?.rows || [];
    if (!rows.length) return { prod: '—', si: '—' };
    const Status = (typeof globalThis !== 'undefined' && globalThis.EodCategoryCardStatus)
      || (typeof global !== 'undefined' && global.EodCategoryCardStatus)
      || null;
    const prodOk = rows.every((row) => {
      if (Status?.prodDone?.(row) || Status?.sheetRowDone?.(row)) return true;
      const live = row?.live || {};
      return !!(live.prodComplete || live.bothComplete);
    });
    const siOk = rows.every((row) => {
      if (Status?.siDone?.(row) || Status?.sheetRowDone?.(row)) return true;
      const live = row?.live || {};
      return !!(live.siComplete || live.bothComplete);
    });
    return { prod: prodOk ? 'Yes' : 'No', si: siOk ? 'Yes' : 'No' };
  }

  function hasDigitalSignoff(report, sheet) {
    if (sheet && Array.isArray(sheet.rows) && sheet.rows.length) return true;
    const digital = String(report?.digitalSignoff || '').trim();
    if (!digital) return false;
    return !/^none/i.test(digital);
  }

  function coversheetFilename(storeNumber, workDate) {
    return `fm${padStore(storeNumber)}_eod_coversheet_${dateCompact(workDate)}.jpg`;
  }

  function digitalSignoffFilename(storeNumber, workDate, pageIndex) {
    return `fm${padStore(storeNumber)}_digital_signoff_p${pageIndex}_${dateCompact(workDate)}.jpg`;
  }

  const api = {
    padStore,
    dateCompact,
    isMainKompassIse,
    pickMainKompassIseVisit,
    isCentralPetReset,
    isCutInBlitzDiv,
    isSelectableVisitShift,
    leadNamesMatch,
    visibleLeadShifts,
    pickVisibleLeadShift,
    eodPdfFilename,
    isRemotePhotoSrc,
    isSendableImageSrc,
    photoEntrySrc,
    isDisplayablePhotoSrc,
    cartSlotHasLoadedPhotos,
    cartSlotNeedsProdPull,
    cartSlotLabel,
    skippedPhotoMessage,
    classifySheetFilename,
    coversheetFilename,
    digitalSignoffFilename,
    formatDeptSignatureLines,
    digitalSignoffCoverValue,
    signedOutFromSheet,
    hasDigitalSignoff,
  };
  if (typeof module === 'object' && module.exports) module.exports = api;
  global.EodSendSheetsLogic = api;
})(typeof window !== 'undefined' ? window : globalThis);
