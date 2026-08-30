/* Render digital signoff + coversheet as JPEGs, embed in EOD email, upload to SAS after. */
(function (global) {
  'use strict';

  const HTML2CANVAS_SRC = 'https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js';
  const LOGO_URL = 'https://the-dump-bin.com/welcome/assets/retail-odyssey-banner.png';
  const SAS_UPLOAD_URL = 'https://eod-api.the-dump-bin.com/sas-upload';
  const SAS_JOB_POLL_MS = 1500;
  const SAS_JOB_TIMEOUT_MS = 3 * 60 * 1000;
  const SIGNOFF_PDF_API = 'https://eod-api.the-dump-bin.com/api/digital-signoffs';

  let html2canvasPromise = null;

  function logic() {
    return global.EodSendSheetsLogic || {};
  }

  function loadHtml2Canvas() {
    if (global.html2canvas) return Promise.resolve(global.html2canvas);
    if (html2canvasPromise) return html2canvasPromise;
    html2canvasPromise = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = HTML2CANVAS_SRC;
      s.onload = () => (global.html2canvas ? resolve(global.html2canvas) : reject(new Error('html2canvas missing')));
      s.onerror = () => reject(new Error('Failed to load html2canvas'));
      document.head.appendChild(s);
    });
    return html2canvasPromise;
  }

  function esc(s) {
    return String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function ynColor(value) {
    const v = String(value || '').trim().toLowerCase();
    if (v === 'yes' || v === 'y') return '#0F766E';
    if (v === 'no' || v === 'n') return '#B45309';
    return '#1C2733';
  }

  function rowHtml(label, value, alt) {
    const bg = alt ? '#F5F9FC' : '#FFFFFF';
    const color = ynColor(value);
    const display = String(value ?? '').trim() || '—';
    return `<tr>
      <td style="background:${bg};border:1px solid #BFD6EC;padding:10px 12px;font-family:Calibri,Arial,sans-serif;font-size:14px;color:#0E2A47;font-weight:600;width:38%;vertical-align:top;">${esc(label)}</td>
      <td style="background:${bg};border:1px solid #BFD6EC;padding:10px 12px;font-family:Calibri,Arial,sans-serif;font-size:14px;color:${color};white-space:pre-wrap;word-break:break-word;vertical-align:top;">${esc(display)}</td>
    </tr>`;
  }

  function buildCoversheetElement(report, { testMode } = {}) {
    const r = report || {};
    const host = document.createElement('div');
    host.style.cssText = 'position:fixed;left:-10000px;top:0;width:640px;background:#fff;z-index:-1;';
    const testBanner = testMode
      ? `<div style="padding:10px 24px;background:#FEF3C7;border-bottom:1px solid #F59E0B;font-family:Calibri,Arial,sans-serif;font-size:13px;color:#92400E;"><strong>TEST MODE</strong> — this EOD was redirected to the tester inbox only.</div>`
      : '';
    host.innerHTML = `
      <div style="width:640px;background:#fff;border:1px solid #BFD6EC;">
        <div style="padding:16px 20px;border-bottom:3px solid #2F6FB0;">
          <img src="${LOGO_URL}" alt="The Retail Odyssey Company" width="600" style="display:block;width:100%;max-width:600px;height:auto;border:0;">
        </div>
        ${testBanner}
        <div style="padding:22px 24px 6px 24px;font-family:Calibri,Arial,sans-serif;">
          <div style="font-size:22px;font-weight:700;color:#0E2A47;">KOMPASS End of Day</div>
          <div style="margin-top:4px;font-size:14px;color:#5A6B7D;">Store #${esc(r.storeNumber || '—')} · ${esc(r.date || '—')}</div>
        </div>
        <div style="padding:4px 24px 8px 24px;font-family:Calibri,Arial,sans-serif;font-size:16px;font-weight:700;color:#0E2A47;">Shift summary</div>
        <div style="padding:0 24px 18px 24px;">
          <table style="border-collapse:collapse;width:100%;">
            ${rowHtml('Lead name', r.leadName, false)}
            ${rowHtml('Date', r.date, true)}
            ${rowHtml('Store number', r.storeNumber, false)}
            ${rowHtml('Before picture of KOMPASS cart', r.beforeTaken, true)}
            ${rowHtml('Manager checked in with', r.checkInManager, false)}
            ${rowHtml('InstaWork support', r.instaworkSupport, true)}
            ${rowHtml('Called KOMPASS Help Desk', r.calledHelpDesk, false)}
            ${rowHtml('Commodities', r.commodities, true)}
            ${rowHtml('Issue', r.issue, false)}
            ${rowHtml('Issue resolved', r.issueResolved, true)}
            ${rowHtml('Temporary solution', r.tempSolution, false)}
            ${rowHtml('Manager checked out with', r.checkOutManager, true)}
            ${rowHtml('Signed out in PROD', r.signedOutProd, false)}
            ${rowHtml('Signed out in SI', r.signedOutSi, true)}
            ${rowHtml('Not in store', r.notInStore, false)}
            ${rowHtml('Not in SI', r.notInSi, true)}
            ${rowHtml('Digital signoff', r.digitalSignoff, false)}
            ${rowHtml('Department signatures', r.deptSignatures, true)}
            ${rowHtml('After picture of KOMPASS cart', r.afterTaken, false)}
          </table>
        </div>
      </div>`;
    return host;
  }

  async function renderCoversheetImage(report, opts) {
    const html2canvas = await loadHtml2Canvas();
    const host = buildCoversheetElement(report, opts);
    document.body.appendChild(host);
    try {
      const canvas = await html2canvas(host.firstElementChild, {
        scale: 2,
        backgroundColor: '#ffffff',
        useCORS: true,
        logging: false,
      });
      return canvas.toDataURL('image/jpeg', 0.85);
    } finally {
      host.remove();
    }
  }

  async function fetchDigitalSignoffJpegPages({ storeNumber, fiscalWeek }) {
    const Pdf = global.EodPdfToImage;
    if (!Pdf?.pdfToJpegPages) throw new Error('PDF rasterizer not loaded');
    if (!storeNumber || !fiscalWeek) return [];
    try { await global.EodDeptSignatures?.persistLeadSignature?.(); } catch (_) { /* PDF still builds */ }
    const qs = new URLSearchParams({
      store: storeNumber,
      week: fiscalWeek,
      bucket: 'all',
    });
    const resp = await global.authFetch(`${SIGNOFF_PDF_API}/pdf?${qs}`);
    if (resp.status === 404) return [];
    if (!resp.ok) {
      const data = await resp.json().catch(() => ({}));
      throw new Error(data.error || `Digital signoff PDF failed (${resp.status})`);
    }
    const buf = await resp.arrayBuffer();
    return Pdf.pdfToJpegPages(buf, { scale: 2, quality: 0.85 });
  }

  /**
   * Build JPEG embeds for the EOD email (coversheet + digital signoff pages).
   * Same print-preview PDF as Categories → Preview PDF, rasterized like live EOD.
   */
  async function prepareForEmail({ report, sheet, storeNumber, workDate, testMode, onStatus } = {}) {
    const L = logic();
    const out = [];
    const setStatus = (msg) => {
      if (typeof onStatus === 'function') onStatus(msg);
    };

    try {
      setStatus('Rendering EOD coversheet…');
      const coversheet = await renderCoversheetImage(report, { testMode });
      out.push({
        dataUrl: coversheet,
        filename: L.coversheetFilename(storeNumber, workDate),
        source: 'coversheet',
        role: 'coversheet',
      });
    } catch (err) {
      console.warn('[eod-send-sheets] coversheet render failed', err);
    }

    try {
      setStatus('Rendering digital signoff sheet…');
      const pages = await fetchDigitalSignoffJpegPages({
        storeNumber: sheet?.storeNumber || storeNumber,
        fiscalWeek: sheet?.fiscalWeek,
      });
      pages.forEach((p) => {
        out.push({
          dataUrl: p.dataUrl,
          filename: L.digitalSignoffFilename(storeNumber, workDate, p.page),
          source: 'digital-signoff',
          role: 'digital',
        });
      });
    } catch (err) {
      console.warn('[eod-send-sheets] digital signoff render failed', err);
    }

    return out;
  }

  async function pollSasUploadJob(jobId, { onStatus } = {}) {
    const id = String(jobId || '').trim();
    if (!id) throw new Error('Missing job id');
    const started = Date.now();
    let lastStatus = 'pending';
    while (Date.now() - started < SAS_JOB_TIMEOUT_MS) {
      const resp = await global.authFetch(`${SAS_UPLOAD_URL}/${encodeURIComponent(id)}`, {
        noBounceOn401: true,
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok || !data.success || !data.job) {
        throw new Error(data.error || `Job status failed (${resp.status})`);
      }
      const status = String(data.job.status || '').toLowerCase();
      lastStatus = status || lastStatus;
      if (typeof onStatus === 'function') onStatus(status, data.job);
      try { await global.PhotoDB?.setSasJobStatus?.(id, status || 'pending'); } catch (_) { /* ignore */ }
      if (status === 'completed') return { status: 'completed', job: data.job };
      if (status === 'failed') {
        const err = new Error(data.job.error || 'SAS upload failed');
        err.job = data.job;
        throw err;
      }
      await new Promise((r) => setTimeout(r, SAS_JOB_POLL_MS));
    }
    const timeoutErr = new Error(`SAS upload timed out (last status: ${lastStatus})`);
    timeoutErr.timedOut = true;
    throw timeoutErr;
  }

  async function uploadOneAfter({ storeNumber, date, leadName, visitId, photoBase64, filename }) {
    const headers = global.EodApi.dayConfirmHeaders({ 'Content-Type': 'application/json' });
    const resp = await global.authFetch(SAS_UPLOAD_URL, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        storeNumber,
        date,
        leadName,
        ...(visitId ? { visitId } : {}),
        photoBase64,
        slot: 'after',
        targetReset: 'MAINTENANCE',
        filename,
      }),
    });
    const result = await resp.json().catch(() => ({}));
    if (!result.success || !result.jobId) {
      throw new Error(result.error || 'Maintenance after upload failed');
    }
    const jobId = result.jobId;
    try { await global.PhotoDB?.trackSasJob?.(jobId, 'pending'); } catch (_) { /* ignore */ }
    await pollSasUploadJob(jobId);
    return { jobId };
  }

  /**
   * Live EOD uploadCoversheetAfterSend — plus digital signoff pages.
   * Uploads as after photos on KOMPASS MAINTENANCE of the main ISE visit.
   */
  async function uploadAfterSend(images, ctx) {
    const S = global.EodSession;
    const storeNumber = String(ctx?.storeNumber || S?.state?.storeNumber || '').trim();
    const date = String(ctx?.workDate || S?.state?.workDate || '').trim();
    const leadName = String(ctx?.leadName || S?.state?.leadName || S?.state?.profileName || '').trim();
    const list = Array.isArray(images) ? images.filter((i) => i?.dataUrl) : [];
    if (!storeNumber || !date || !list.length) return { uploaded: 0, skipped: true };
    const canon = String(storeNumber).replace(/\D/g, '').replace(/^0+/, '') || storeNumber;
    if (canon === '999') return { uploaded: 0, skipped: true, reason: 'test-store' };

    const L = logic();
    const main = L.pickMainKompassIseVisit(S?.state?.shifts, S?.state?.selectedShift);
    const visitId = main?.visitId || undefined;
    if (!leadName && !visitId) {
      console.warn('[eod-send-sheets] skip SAS upload — missing lead and ISE visit');
      return { uploaded: 0, skipped: true, reason: 'no-visit' };
    }

    const results = [];
    for (let i = 0; i < list.length; i++) {
      const item = list[i];
      if (typeof ctx?.onStatus === 'function') {
        ctx.onStatus(`Uploading sheet ${i + 1}/${list.length} to Kompass…`);
      }
      try {
        const r = await uploadOneAfter({
          storeNumber,
          date,
          leadName,
          visitId,
          photoBase64: item.dataUrl,
          filename: item.filename,
        });
        results.push({ filename: item.filename, ok: true, jobId: r.jobId });
      } catch (err) {
        console.warn('[eod-send-sheets] SAS after upload failed', item.filename, err);
        results.push({ filename: item.filename, ok: false, error: err.message || String(err) });
      }
    }
    return {
      uploaded: results.filter((r) => r.ok).length,
      failed: results.filter((r) => !r.ok).length,
      visitId: visitId || null,
      results,
    };
  }

  global.EodSendSheets = {
    prepareForEmail,
    uploadAfterSend,
    renderCoversheetImage,
    fetchDigitalSignoffJpegPages,
    pollSasUploadJob,
  };
})(typeof window !== 'undefined' ? window : globalThis);
