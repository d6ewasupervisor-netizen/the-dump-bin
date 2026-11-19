/* Supervisor board: today's live EOD receipts. */
(function (global) {
  'use strict';

  function esc(s) { return global.EodApi.escapeHtml(s); }

  function statusLabel(row) {
    if (row.inFlight) return 'Sending';
    if (row.status === 'failed') return 'Failed';
    if (row.deliveryStatus === 'delivered' || row.deliveryStatus === 'opened') return 'Delivered';
    if (row.deliveryStatus === 'failed') return 'Accepted, not delivered';
    if (row.sent || row.accepted) return 'Accepted';
    return row.status || '';
  }

  async function render(mount) {
    if (!global.EodRoles?.canForceLive?.()) {
      mount.innerHTML = '<div class="card"><h2>Sent EODs</h2></div>';
      return;
    }
    mount.innerHTML = '<div class="card"><h2>Sent EODs</h2><p class="muted">Loading</p></div>';
    let data = { receipts: [], workDate: '' };
    try {
      const resp = await global.authFetch(`${global.EOD_API_BASE}/api/eod/send-board`, { method: 'GET' });
      data = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(data.error || 'Could not load send board');
    } catch (err) {
      mount.innerHTML = `<div class="card"><h2>Sent EODs</h2><p>${esc(err.message || String(err))}</p></div>`;
      return;
    }
    const rows = Array.isArray(data.receipts) ? data.receipts : [];
    const body = rows.length
      ? rows.map((row) => `<tr>
          <td>${esc(row.storeNumber)}</td>
          <td>${esc(row.leadName || row.sentByEmail || '')}</td>
          <td>${esc(statusLabel(row))}</td>
          <td>${esc(row.sentAtLabel || '')}</td>
          <td>${esc(String(row.recipientCount || 0))}</td>
        </tr>`).join('')
      : '<tr><td colspan="5">None yet</td></tr>';
    mount.innerHTML = `<div class="card">
      <h2>Sent EODs</h2>
      <p class="muted">${esc(data.workDate || '')}</p>
      <table class="sheet-table">
        <thead><tr><th>Store</th><th>Lead</th><th>Status</th><th>Time</th><th>To</th></tr></thead>
        <tbody>${body}</tbody>
      </table>
    </div>`;
  }

  global.EodRouter.register('sends', render);
})(typeof window !== 'undefined' ? window : globalThis);
