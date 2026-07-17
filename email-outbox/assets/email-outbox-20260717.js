(function () {
  const API_PREFIX = '/api/email-outbox';

  const state = {
    page: 1,
    pageSize: 50,
    total: 0,
    selectedId: null,
    filters: {},
    sources: [],
    sortBy: 'createdAt',
    sortDir: 'desc',
    previewObjectUrl: null,
  };

  function tokenHeader() {
    let token = '';
    try {
      if (window.dumpBinAuth && typeof window.dumpBinAuth.getSession === 'function') {
        token = window.dumpBinAuth.getSession() || '';
      }
      if (!token) {
        token = localStorage.getItem('dumpBinSession') || localStorage.getItem('eodSession') || '';
      }
    } catch (_err) {}
    return token ? { Authorization: `Bearer ${token}` } : {};
  }

  /** Prefer auth-gate fetch so /api/* is rewritten to eod-api.the-dump-bin.com. */
  function authFetch(url, options = {}) {
    const fetchFn = window.dumpBinAuthFetch || fetch;
    const headers = { ...(options.headers || {}) };
    if (!window.dumpBinAuthFetch) {
      Object.assign(headers, tokenHeader());
    }
    return fetchFn(url, {
      credentials: 'include',
      ...options,
      headers,
    });
  }

  async function api(path, options = {}) {
    const headers = {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    };
    const res = await authFetch(path, {
      ...options,
      headers,
    });
    const text = await res.text();
    let body = {};
    try { body = text ? JSON.parse(text) : {}; } catch { body = { raw: text }; }
    if (!res.ok) {
      if (res.status === 403) {
        throw new Error(body.error || 'Supervisor or admin access required for the email outbox.');
      }
      throw new Error(body.error || body.message || `HTTP ${res.status}`);
    }
    return body;
  }

  /**
   * Authenticated binary download. Uses authFetch + blob so Bearer auth works
   * (plain <a href> would not send the session header or hit the API host).
   */
  async function downloadBinary(path, fallbackFilename) {
    const res = await authFetch(path);
    if (!res.ok) {
      let message = `HTTP ${res.status}`;
      try {
        const body = await res.json();
        message = body.error || body.message || message;
      } catch (_err) {
        try {
          const text = await res.text();
          if (text) message = text.slice(0, 200);
        } catch (_e2) {}
      }
      throw new Error(message);
    }
    const blob = await res.blob();
    const filename = filenameFromContentDisposition(res.headers.get('Content-Disposition'))
      || fallbackFilename
      || 'download';
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
    return { blob, filename, contentType: res.headers.get('Content-Type') || blob.type };
  }

  async function fetchBinary(path) {
    const res = await authFetch(path);
    if (!res.ok) {
      let message = `HTTP ${res.status}`;
      try {
        const body = await res.json();
        message = body.error || body.message || message;
      } catch (_err) {}
      throw new Error(message);
    }
    const blob = await res.blob();
    const filename = filenameFromContentDisposition(res.headers.get('Content-Disposition')) || 'attachment';
    return {
      blob,
      filename,
      contentType: (res.headers.get('Content-Type') || blob.type || 'application/octet-stream').split(';')[0].trim(),
    };
  }

  function filenameFromContentDisposition(header) {
    if (!header) return null;
    const utf8 = /filename\*=UTF-8''([^;]+)/i.exec(header);
    if (utf8) {
      try { return decodeURIComponent(utf8[1].trim()); } catch (_err) { /* fall through */ }
    }
    const plain = /filename="([^"]+)"/i.exec(header) || /filename=([^;]+)/i.exec(header);
    if (plain) return plain[1].trim().replace(/^["']|["']$/g, '');
    return null;
  }

  function fmtDate(iso) {
    if (!iso) return '—';
    try {
      return new Date(iso).toLocaleString();
    } catch (_err) {
      return iso;
    }
  }

  function fmtBytes(n) {
    const bytes = Number(n) || 0;
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  function badge(label, kind) {
    return `<span class="badge badge-${kind}">${label}</span>`;
  }

  function statusBadge(status) {
    const s = String(status || 'unknown').toLowerCase();
    if (s === 'sent') return badge('Sent', 'sent');
    if (s === 'failed') return badge('Failed', 'failed');
    if (s === 'pending') return badge('Pending', 'pending');
    return badge(status || '—', 'pending');
  }

  function deliveryBadge(delivery) {
    const d = String(delivery || 'unknown').toLowerCase();
    if (d === 'delivered') return badge('Delivered', 'delivered');
    if (d === 'failed') return badge('Failed', 'failed');
    if (d === 'complained') return badge('Complained', 'complained');
    if (d === 'sent') return badge('In flight', 'sent');
    return badge(delivery || '—', 'pending');
  }

  function openedBadge(item) {
    if (item.openCount > 0) {
      return badge(`Opened${item.openCount > 1 ? ` ×${item.openCount}` : ''}`, 'delivered');
    }
    return badge('—', 'pending');
  }

  function renderRows(items) {
    const tbody = document.getElementById('emailRows');
    if (!items.length) {
      tbody.innerHTML = '<tr><td colspan="8" class="muted">No emails match these filters.</td></tr>';
      return;
    }
    tbody.innerHTML = items.map((item) => {
      const selected = item.id === state.selectedId ? ' is-selected' : '';
      const to = (item.to || []).join(', ');
      return `<tr data-id="${item.id}" class="${selected}">
        <td>${fmtDate(item.createdAt)}</td>
        <td>${statusBadge(item.status)}</td>
        <td>${deliveryBadge(item.deliveryStatus || item.lastEvent)}</td>
        <td>${openedBadge(item)}</td>
        <td><div>${item.sourceSystem}</div><div class="muted">${item.sourceType}</div></td>
        <td class="from-cell">${escapeHtml(item.from || '—')}</td>
        <td class="subject-cell">${escapeHtml(item.subject || '—')}</td>
        <td class="to-cell">${escapeHtml(to || '—')}</td>
      </tr>`;
    }).join('');

    tbody.querySelectorAll('tr[data-id]').forEach((row) => {
      row.addEventListener('click', () => selectEmail(Number(row.dataset.id)));
    });
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function clearAttachmentPreview() {
    if (state.previewObjectUrl) {
      URL.revokeObjectURL(state.previewObjectUrl);
      state.previewObjectUrl = null;
    }
    const viewer = document.getElementById('attachmentViewer');
    const body = document.getElementById('attachmentViewerBody');
    if (viewer) viewer.hidden = true;
    if (body) body.innerHTML = '';
  }

  function showAttachmentPreview({ blob, filename, contentType }) {
    clearAttachmentPreview();
    const viewer = document.getElementById('attachmentViewer');
    const title = document.getElementById('attachmentViewerTitle');
    const body = document.getElementById('attachmentViewerBody');
    if (!viewer || !body || !title) return;
    const url = URL.createObjectURL(blob);
    state.previewObjectUrl = url;
    title.textContent = filename || 'Attachment preview';
    viewer.hidden = false;

    const ct = String(contentType || '').toLowerCase();
    if (ct.startsWith('image/')) {
      body.innerHTML = `<img src="${url}" alt="${escapeHtml(filename || 'attachment')}" />`;
      return;
    }
    if (ct === 'application/pdf') {
      body.innerHTML = `<iframe title="${escapeHtml(filename || 'PDF')}" src="${url}"></iframe>`;
      return;
    }
    if (ct.startsWith('text/') || ct === 'application/json' || ct === 'application/xml') {
      blob.text().then((text) => {
        body.innerHTML = `<pre>${escapeHtml(text)}</pre>`;
      }).catch(() => {
        body.innerHTML = `<p class="muted">Could not render text preview.</p>
          <p><a href="${url}" download="${escapeHtml(filename || 'download')}">Download instead</a></p>`;
      });
      return;
    }

    body.innerHTML = `<p class="muted">No in-app preview for <code>${escapeHtml(ct || 'unknown type')}</code>.</p>
      <p><a href="${url}" download="${escapeHtml(filename || 'download')}">Download ${escapeHtml(filename || 'file')}</a></p>`;
  }

  function sortIndicator(column) {
    if (state.sortBy !== column) return '';
    return state.sortDir === 'asc' ? ' ▲' : ' ▼';
  }

  function updateSortHeaders() {
    document.querySelectorAll('th[data-sort]').forEach((th) => {
      const col = th.dataset.sort;
      const label = th.dataset.label || th.textContent.replace(/[▲▼]/g, '').trim();
      th.textContent = `${label}${sortIndicator(col)}`;
      th.classList.toggle('is-sorted', state.sortBy === col);
    });
  }

  function onSortColumn(column) {
    if (state.sortBy === column) {
      state.sortDir = state.sortDir === 'asc' ? 'desc' : 'asc';
    } else {
      state.sortBy = column;
      state.sortDir = (column === 'subject' || column === 'sourceSystem' || column === 'to') ? 'asc' : 'desc';
    }
    state.page = 1;
    updateSortHeaders();
    loadList();
  }

  async function loadList() {
    const params = new URLSearchParams({
      page: String(state.page),
      pageSize: String(state.pageSize),
      sortBy: state.sortBy,
      sortDir: state.sortDir,
    });
    Object.entries(state.filters).forEach(([k, v]) => {
      if (v) params.set(k, v);
    });
    const data = await api(`${API_PREFIX}?${params.toString()}`);
    if (data.sortBy) state.sortBy = data.sortBy;
    if (data.sortDir) state.sortDir = data.sortDir;
    updateSortHeaders();
    state.total = data.total || 0;
    document.getElementById('listSummary').textContent = `${state.total} email(s)`;
    const totalPages = Math.max(1, Math.ceil(state.total / state.pageSize));
    document.getElementById('pageLabel').textContent = `Page ${state.page} / ${totalPages}`;
    document.getElementById('prevPage').disabled = state.page <= 1;
    document.getElementById('nextPage').disabled = state.page >= totalPages;
    renderRows(data.items || []);
  }

  async function loadSources() {
    const data = await api(`${API_PREFIX}/sources`);
    state.sources = data.sources || [];
    const systems = [...new Set(state.sources.map((s) => s.source_system))].sort();
    const types = [...new Set(state.sources.map((s) => s.source_type))].sort();
    fillSelect('sourceSystem', systems);
    fillSelect('sourceType', types);
  }

  function fillSelect(id, values) {
    const el = document.getElementById(id);
    const current = el.value;
    el.innerHTML = '<option value="">Any</option>' + values.map((v) => `<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`).join('');
    if (values.includes(current)) el.value = current;
  }

  async function selectEmail(id) {
    state.selectedId = id;
    clearAttachmentPreview();
    document.querySelectorAll('#emailRows tr[data-id]').forEach((row) => {
      row.classList.toggle('is-selected', Number(row.dataset.id) === id);
    });
    const data = await api(`${API_PREFIX}/${id}`);
    renderDetail(data.item);
  }

  function showDetailError(message) {
    const err = document.getElementById('detailError');
    err.hidden = false;
    err.textContent = message;
  }

  function renderDetail(item) {
    document.getElementById('detailEmpty').hidden = true;
    document.getElementById('detailBody').hidden = false;
    const meta = document.getElementById('detailMeta');
    const openedLine = item.openCount > 0
      ? `${item.openCount}× (first ${fmtDate(item.openedAt)})`
      : 'Not opened yet';
    const clickedLine = item.clickCount > 0
      ? `${item.clickCount}× (first ${fmtDate(item.clickedAt)})`
      : 'No link clicks yet';

    const rows = [
      ['When', fmtDate(item.createdAt)],
      ['Status', item.status],
      ['Delivery', item.deliveryStatus || item.lastEvent || '—'],
      ['Opened', openedLine],
      ['Clicked', clickedLine],
      ['From', item.from || '—'],
      ['To', (item.to || []).join(', ') || '—'],
      ['CC', (item.cc || []).join(', ') || '—'],
      ['Subject', item.subject || '—'],
      ['Source', `${item.sourceSystem} / ${item.sourceType}`],
      ['Resend ID', item.resendId || '—'],
      ['Attachments', String(item.attachmentCount || 0)],
      ['Can resend', item.canResend ? 'Yes' : 'No'],
      ['Can download', item.canDownload ? 'Yes' : 'No'],
    ];
    if (item.errorMessage) rows.push(['Error', item.errorMessage]);
    if (item.compacted) rows.push(['Storage', 'Compacted (body/attachments cleared)']);
    meta.innerHTML = rows.map(([k, v]) => `<dt>${escapeHtml(k)}</dt><dd>${escapeHtml(v)}</dd>`).join('');

    document.getElementById('editSubject').value = item.subject || '';
    document.getElementById('editTo').value = (item.to || []).join(', ');
    document.getElementById('editCc').value = (item.cc || []).join(', ');
    document.getElementById('editDelivery').value = '';

    const iframe = document.getElementById('htmlPreview');
    iframe.srcdoc = item.htmlBody || '<p style="font-family:sans-serif;color:#666;">No HTML body stored.</p>';

    const attachments = document.getElementById('attachmentList');
    const list = Array.isArray(item.attachments) ? item.attachments : [];
    if (!list.length) {
      attachments.innerHTML = '<li class="muted">No attachments</li>';
    } else {
      attachments.innerHTML = list.map((a) => {
        const idx = a.index != null ? a.index : 0;
        const name = a.filename || 'attachment';
        const type = a.contentType || a.content_type || '';
        const size = a.sizeBytes != null ? fmtBytes(a.sizeBytes) : '';
        // API returns hasContent; never expect content_base64 in detail JSON anymore.
        const downloadable = a.hasContent === true || Boolean(a.content_base64);
        const viewable = Boolean(a.viewable) && downloadable;
        const metaBits = [type, size].filter(Boolean).join(' · ');
        return `<li class="attachment-item" data-index="${idx}">
          <div class="attachment-meta">
            <span class="attachment-name">${escapeHtml(name)}</span>
            <span class="muted">${escapeHtml(metaBits || (downloadable ? 'stored' : 'content missing'))}</span>
          </div>
          <div class="attachment-actions">
            ${viewable ? `<button type="button" class="secondary att-view" data-index="${idx}">View</button>` : ''}
            ${downloadable ? `<button type="button" class="secondary att-download" data-index="${idx}" data-filename="${escapeHtml(name)}">Download</button>` : '<span class="muted">Unavailable</span>'}
          </div>
        </li>`;
      }).join('');

      attachments.querySelectorAll('.att-download').forEach((btn) => {
        btn.addEventListener('click', async (e) => {
          e.stopPropagation();
          const index = Number(btn.dataset.index);
          const filename = btn.dataset.filename || `attachment-${index}`;
          btn.disabled = true;
          try {
            await downloadBinary(
              `${API_PREFIX}/${item.id}/attachments/${index}`,
              filename,
            );
          } catch (err) {
            showDetailError(err.message);
          } finally {
            btn.disabled = false;
          }
        });
      });

      attachments.querySelectorAll('.att-view').forEach((btn) => {
        btn.addEventListener('click', async (e) => {
          e.stopPropagation();
          const index = Number(btn.dataset.index);
          btn.disabled = true;
          try {
            const file = await fetchBinary(
              `${API_PREFIX}/${item.id}/attachments/${index}?disposition=inline`,
            );
            showAttachmentPreview(file);
          } catch (err) {
            showDetailError(err.message);
          } finally {
            btn.disabled = false;
          }
        });
      });
    }

    const err = document.getElementById('detailError');
    err.hidden = true;
    err.textContent = '';

    const downloadEmailBtn = document.getElementById('downloadEmailBtn');
    if (downloadEmailBtn) {
      downloadEmailBtn.disabled = item.canDownload === false || item.compacted;
      downloadEmailBtn.onclick = async () => {
        downloadEmailBtn.disabled = true;
        try {
          const safeSubject = String(item.subject || `email-${item.id}`)
            .replace(/[/\\?%*:|"<>]/g, '_')
            .slice(0, 80);
          await downloadBinary(
            `${API_PREFIX}/${item.id}/download`,
            `${safeSubject || `email-${item.id}`}.eml`,
          );
        } catch (e) {
          showDetailError(e.message);
        } finally {
          downloadEmailBtn.disabled = item.canDownload === false || item.compacted;
        }
      };
    }

    const resendBtn = document.getElementById('resendBtn');
    resendBtn.disabled = !item.canResend;
    resendBtn.onclick = async () => {
      if (!item.canResend) return;
      if (!window.confirm('Resend this email exactly as stored (recipients, body, attachments)?')) return;
      resendBtn.disabled = true;
      try {
        const result = await api(`${API_PREFIX}/${item.id}/resend`, { method: 'POST', body: '{}' });
        alert(`Resent. New Resend ID: ${result.resendId || 'unknown'}`);
        await loadList();
        if (result.recordId) await selectEmail(result.recordId);
      } catch (e) {
        showDetailError(e.message);
      } finally {
        resendBtn.disabled = !item.canResend;
      }
    };

    const compactBtn = document.getElementById('compactBtn');
    compactBtn.disabled = item.compacted;
    compactBtn.onclick = async () => {
      if (!window.confirm('Clear stored HTML, attachments, and resend payload? Metadata (subject, recipients, delivery) is kept.')) return;
      compactBtn.disabled = true;
      try {
        await api(`${API_PREFIX}/${item.id}`, { method: 'PATCH', body: JSON.stringify({ compact: true }) });
        await loadList();
        await selectEmail(item.id);
      } catch (e) {
        showDetailError(e.message);
      } finally {
        compactBtn.disabled = false;
      }
    };

    document.getElementById('deleteBtn').onclick = async () => {
      if (!window.confirm('Permanently delete this email record?')) return;
      try {
        await api(`${API_PREFIX}/${item.id}`, { method: 'DELETE' });
        state.selectedId = null;
        clearAttachmentPreview();
        document.getElementById('detailEmpty').hidden = false;
        document.getElementById('detailBody').hidden = true;
        await loadList();
      } catch (e) {
        showDetailError(e.message);
      }
    };

    document.getElementById('editForm').onsubmit = async (e) => {
      e.preventDefault();
      const payload = {
        subject: document.getElementById('editSubject').value.trim(),
        to: document.getElementById('editTo').value.split(',').map((s) => s.trim()).filter(Boolean),
        cc: document.getElementById('editCc').value.split(',').map((s) => s.trim()).filter(Boolean),
      };
      const delivery = document.getElementById('editDelivery').value;
      if (delivery) payload.deliveryStatus = delivery;
      try {
        await api(`${API_PREFIX}/${item.id}`, { method: 'PATCH', body: JSON.stringify(payload) });
        await loadList();
        await selectEmail(item.id);
      } catch (ex) {
        showDetailError(ex.message);
      }
    };
  }

  function readFiltersFromForm() {
    state.filters = {
      search: document.getElementById('search').value.trim(),
      status: document.getElementById('status').value,
      deliveryStatus: document.getElementById('deliveryStatus').value,
      sourceSystem: document.getElementById('sourceSystem').value,
      sourceType: document.getElementById('sourceType').value,
    };
    state.page = 1;
  }

  async function boot() {
    if (window.dumpBinAuthReady) await window.dumpBinAuthReady;
    document.getElementById('filterForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      readFiltersFromForm();
      await loadList();
    });
    document.getElementById('clearFilters').addEventListener('click', async () => {
      document.getElementById('search').value = '';
      document.getElementById('status').value = '';
      document.getElementById('deliveryStatus').value = '';
      document.getElementById('sourceSystem').value = '';
      document.getElementById('sourceType').value = '';
      readFiltersFromForm();
      await loadList();
    });
    document.getElementById('refreshBtn').addEventListener('click', loadList);
    document.getElementById('prevPage').addEventListener('click', async () => {
      if (state.page > 1) { state.page -= 1; await loadList(); }
    });
    document.getElementById('nextPage').addEventListener('click', async () => {
      state.page += 1;
      await loadList();
    });
    document.getElementById('syncBtn').addEventListener('click', async () => {
      const btn = document.getElementById('syncBtn');
      btn.disabled = true;
      try {
        const result = await api(`${API_PREFIX}/sync/resend`, { method: 'POST', body: '{}' });
        alert(`Sync complete. Imported ${result.imported}, updated ${result.updated}.`);
        await loadSources();
        await loadList();
      } catch (e) {
        alert(e.message);
      } finally {
        btn.disabled = false;
      }
    });

    document.querySelectorAll('th[data-sort]').forEach((th) => {
      th.addEventListener('click', () => onSortColumn(th.dataset.sort));
    });
    updateSortHeaders();

    const closePreview = document.getElementById('attachmentViewerClose');
    if (closePreview) {
      closePreview.addEventListener('click', clearAttachmentPreview);
    }

    await loadSources();
    await loadList();
  }

  boot().catch((err) => {
    document.getElementById('listSummary').textContent = err.message;
  });
})();
