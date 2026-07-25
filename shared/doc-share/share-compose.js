/**
 * Shared document share compose (email + SMS) for Dump Bin and EOD materials.
 * Attach to window.DocShareCompose.
 */
(function (global) {
  'use strict';

  const API_ROOT = 'https://eod-api.the-dump-bin.com';
  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  function escapeHtml(s) {
    return String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function normalizeEmail(v) {
    const t = String(v || '').trim().toLowerCase();
    return EMAIL_RE.test(t) ? t : null;
  }

  function ensureHost() {
    let host = document.getElementById('docShareComposeHost');
    if (host) return host;
    host = document.createElement('div');
    host.id = 'docShareComposeHost';
    host.innerHTML = `
      <div class="dsc-backdrop" id="dscBackdrop" hidden>
        <div class="dsc-modal" role="dialog" aria-modal="true" aria-labelledby="dscTitle">
          <div class="dsc-modal__head">
            <h2 id="dscTitle">Share documents</h2>
            <button type="button" class="dsc-close" id="dscClose" aria-label="Close">✕</button>
          </div>
          <div class="dsc-modal__body">
            <div class="dsc-tabs">
              <button type="button" class="dsc-tab is-active" data-dsc-tab="email">Email</button>
              <button type="button" class="dsc-tab" data-dsc-tab="sms">Text</button>
            </div>
            <div class="dsc-panel" data-dsc-panel="email">
              <div id="dscTeamSlot"></div>
              <label class="dsc-label" for="dscEmailSearch">Recipient</label>
              <div class="dsc-typeahead">
                <input type="text" id="dscEmailSearch" placeholder="Begin typing to select, or enter an address" autocomplete="off" spellcheck="false">
                <div class="dsc-dropdown" id="dscEmailDropdown" hidden></div>
              </div>
              <div class="dsc-chips" id="dscEmailChips"></div>
            </div>
            <div class="dsc-panel" data-dsc-panel="sms" hidden>
              <label class="dsc-label" for="dscPhoneInput">Phone number(s)</label>
              <input type="tel" id="dscPhoneInput" placeholder="10-digit mobile, comma-separated" autocomplete="tel">
              <p class="dsc-hint"><strong>Important:</strong> If the recipient would like to use the text feature, they must first text <strong>JOIN</strong> to <strong>(509) 572-9212</strong> from that mobile number (one-time opt-in). Until they do, texts cannot be delivered. Link and files expire after 7 days. Reply STOP anytime to opt out.</p>
            </div>
            <label class="dsc-label" for="dscNote">Optional note</label>
            <textarea id="dscNote" rows="2" placeholder="Optional note"></textarea>
            <p class="dsc-file-summary" id="dscFileSummary"></p>
          </div>
          <div class="dsc-modal__actions">
            <button type="button" class="dsc-btn" id="dscCancel">Cancel</button>
            <button type="button" class="dsc-btn dsc-btn--primary" id="dscSend">Send</button>
          </div>
        </div>
      </div>`;
    document.body.appendChild(host);
    if (!document.getElementById('docShareComposeStyles')) {
      const link = document.createElement('link');
      link.id = 'docShareComposeStyles';
      link.rel = 'stylesheet';
      const base = document.currentScript?.src
        ? document.currentScript.src.replace(/[^/]+$/, 'share-compose.css')
        : '/shared/doc-share/share-compose.css';
      link.href = base;
      document.head.appendChild(link);
    }
    return host;
  }

  function injectStylesInline() {
    if (document.getElementById('docShareComposeStylesInline')) return;
    const style = document.createElement('style');
    style.id = 'docShareComposeStylesInline';
    style.textContent = `
.dsc-backdrop{position:fixed;inset:0;z-index:12000;background:rgba(2,6,23,.72);display:flex;align-items:flex-end;justify-content:center;padding:12px;padding-bottom:max(12px,env(safe-area-inset-bottom))}
.dsc-backdrop[hidden]{display:none!important}
@media(min-width:640px){.dsc-backdrop{align-items:center}}
.dsc-modal{width:min(520px,100%);max-height:min(92vh,720px);overflow:auto;background:#0f172a;color:#e2e8f0;border:1px solid #334155;border-radius:16px;box-shadow:0 20px 50px rgba(0,0,0,.45)}
.dsc-modal__head{display:flex;justify-content:space-between;align-items:center;gap:10px;padding:14px 16px;border-bottom:1px solid #1e293b}
.dsc-modal__head h2{margin:0;font-size:1.05rem}
.dsc-close,.dsc-btn{border:1px solid #334155;background:#111827;color:#e2e8f0;border-radius:10px;min-height:40px;padding:0 12px;font:inherit;cursor:pointer}
.dsc-btn--primary{background:#2563eb;border-color:#2563eb;color:#fff}
.dsc-modal__body{padding:14px 16px}
.dsc-modal__actions{display:flex;justify-content:flex-end;gap:8px;padding:12px 16px;border-top:1px solid #1e293b}
.dsc-tabs{display:flex;gap:6px;margin-bottom:12px}
.dsc-tab{flex:1;min-height:40px;border-radius:10px;border:1px solid #334155;background:#111827;color:#94a3b8;font:inherit;font-weight:600;cursor:pointer}
.dsc-tab.is-active{background:#1e3a8a;border-color:#3b82f6;color:#fff}
.dsc-label{display:block;font-size:12px;color:#94a3b8;margin:8px 0 6px}
.dsc-hint{margin:8px 0 0;font-size:12px;color:#64748b}
.dsc-typeahead{position:relative}
.dsc-typeahead input,.dsc-panel input[type=tel],#dscNote{width:100%;min-height:42px;border-radius:10px;border:1px solid #334155;background:#020617;color:#e2e8f0;padding:8px 12px;font:inherit}
#dscNote{min-height:64px;resize:vertical}
.dsc-dropdown{position:absolute;left:0;right:0;top:100%;z-index:5;max-height:220px;overflow:auto;background:#0b1220;border:1px solid #334155;border-radius:10px;margin-top:4px}
.dsc-option{padding:10px 12px;cursor:pointer;border-bottom:1px solid #1e293b}
.dsc-option:hover,.dsc-option.active{background:#1e293b}
.dsc-option__name{display:block;font-weight:600}
.dsc-option__meta{display:block;font-size:12px;color:#94a3b8}
.dsc-chips{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}
.dsc-chip{display:inline-flex;align-items:center;gap:6px;background:#1e293b;border-radius:999px;padding:4px 10px;font-size:12px}
.dsc-chip button{border:0;background:transparent;color:#94a3b8;cursor:pointer;font-size:14px}
.dsc-file-summary{margin:12px 0 0;font-size:12px;color:#94a3b8}
.dsc-team{margin-bottom:10px;max-height:180px;overflow:auto}
.dsc-team label{display:flex;gap:8px;align-items:center;padding:6px 0;border-bottom:1px solid #1e293b;font-size:13px}
`;
    document.head.appendChild(style);
  }

  /**
   * @param {{
   *   authFetch: Function,
   *   getPayload: () => { keys: string[], attachments: any[], storeNumber?: string, source?: string },
   *   teamMembers?: Array<{name:string,email:string}>,
   *   searchContacts?: (q:string) => Promise<Array<{email:string,name?:string}>>,
   *   toast?: (msg:string, kind?:string) => void,
   * }} opts
   */
  function open(opts) {
    injectStylesInline();
    ensureHost();
    const backdrop = document.getElementById('dscBackdrop');
    const emails = new Map();
    let tab = 'email';
    let searchTimer = null;
    let suggestions = [];
    let highlight = -1;

    const toast = opts.toast || ((m) => console.log(m));
    const payload = opts.getPayload() || { keys: [], attachments: [] };
    const fileCount = (payload.keys?.length || 0) + (payload.attachments?.length || 0);
    document.getElementById('dscFileSummary').textContent =
      `${fileCount} item(s) selected · Email attaches files · Text needs JOIN opt-in first`;

    const teamSlot = document.getElementById('dscTeamSlot');
    const members = (opts.teamMembers || []).filter((m) => m && (m.email || m.name));
    if (members.length) {
      teamSlot.innerHTML = `<div class="dsc-team">${members.map((m, i) => {
        const email = normalizeEmail(m.email) || '';
        const disabled = !email;
        return `<label><input type="checkbox" class="dsc-team-cb" value="${escapeHtml(email)}" ${disabled ? 'disabled' : ''} data-i="${i}">
          <span>${escapeHtml(m.name || email || 'Person')}</span></label>`;
      }).join('')}</div>`;
    } else {
      teamSlot.innerHTML = '';
    }

    function renderChips() {
      const wrap = document.getElementById('dscEmailChips');
      wrap.innerHTML = [...emails.values()].map((e) =>
        `<span class="dsc-chip">${escapeHtml(e)} <button type="button" data-rm="${escapeHtml(e)}" aria-label="Remove">&times;</button></span>`
      ).join('');
      wrap.querySelectorAll('[data-rm]').forEach((btn) => {
        btn.addEventListener('click', () => {
          emails.delete(btn.getAttribute('data-rm'));
          renderChips();
        });
      });
    }

    function addEmail(raw) {
      const e = normalizeEmail(raw);
      if (!e) {
        toast('Enter a valid email address', 'error');
        return;
      }
      emails.set(e, e);
      renderChips();
    }

    function setTab(next) {
      tab = next;
      document.querySelectorAll('.dsc-tab').forEach((b) => b.classList.toggle('is-active', b.dataset.dscTab === next));
      document.querySelectorAll('.dsc-panel').forEach((p) => {
        p.hidden = p.dataset.dscPanel !== next;
      });
      document.getElementById('dscSend').textContent = next === 'sms' ? 'Send text' : 'Send email';
    }

    async function runSearch(q) {
      const dd = document.getElementById('dscEmailDropdown');
      const manual = normalizeEmail(q);
      let people = [];
      if (typeof opts.searchContacts === 'function') {
        try { people = await opts.searchContacts(q); } catch (_) { people = []; }
      }
      suggestions = [];
      if (manual && !emails.has(manual)) {
        suggestions.push({ email: manual, name: manual, meta: 'Use this address' });
      }
      for (const p of people) {
        const email = normalizeEmail(p.email);
        if (!email || emails.has(email)) continue;
        suggestions.push({
          email,
          name: p.name || email,
          meta: email,
        });
      }
      if (!suggestions.length) {
        dd.innerHTML = q.trim()
          ? '<div class="dsc-option"><span class="dsc-option__meta">Keep typing a full email to add anyone</span></div>'
          : '';
        dd.hidden = !q.trim();
        return;
      }
      dd.innerHTML = suggestions.map((s, i) =>
        `<div class="dsc-option" data-i="${i}"><span class="dsc-option__name">${escapeHtml(s.name)}</span><span class="dsc-option__meta">${escapeHtml(s.meta)}</span></div>`
      ).join('');
      dd.hidden = false;
      highlight = -1;
      dd.querySelectorAll('.dsc-option[data-i]').forEach((el) => {
        el.addEventListener('mousedown', (e) => {
          e.preventDefault();
          const s = suggestions[Number(el.dataset.i)];
          if (s) addEmail(s.email);
          document.getElementById('dscEmailSearch').value = '';
          dd.hidden = true;
        });
      });
    }

    function close() {
      backdrop.hidden = true;
    }

    document.querySelectorAll('.dsc-tab').forEach((b) => {
      b.onclick = () => setTab(b.dataset.dscTab);
    });
    document.getElementById('dscClose').onclick = close;
    document.getElementById('dscCancel').onclick = close;
    const searchInput = document.getElementById('dscEmailSearch');
    searchInput.value = '';
    searchInput.oninput = () => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => runSearch(searchInput.value), 200);
    };
    searchInput.onkeydown = (e) => {
      const dd = document.getElementById('dscEmailDropdown');
      const optsEl = [...dd.querySelectorAll('.dsc-option[data-i]')];
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        highlight = Math.min(optsEl.length - 1, highlight + 1);
        optsEl.forEach((el, i) => el.classList.toggle('active', i === highlight));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        highlight = Math.max(0, highlight - 1);
        optsEl.forEach((el, i) => el.classList.toggle('active', i === highlight));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (highlight >= 0 && suggestions[highlight]) addEmail(suggestions[highlight].email);
        else if (searchInput.value.trim()) addEmail(searchInput.value.trim());
        searchInput.value = '';
        dd.hidden = true;
      }
    };
    document.getElementById('dscPhoneInput').value = '';
    document.getElementById('dscNote').value = '';
    emails.clear();
    renderChips();
    setTab('email');
    backdrop.hidden = false;

    document.getElementById('dscSend').onclick = async () => {
      const btn = document.getElementById('dscSend');
      const note = (document.getElementById('dscNote').value || '').trim();
      const bodyPayload = opts.getPayload();
      btn.disabled = true;
      const prev = btn.textContent;
      btn.textContent = 'Sending…';
      try {
        if (tab === 'email') {
          const checked = [...document.querySelectorAll('.dsc-team-cb:checked')].map((c) => c.value).filter(Boolean);
          const to = [...new Set([...checked, ...emails.keys()])];
          if (!to.length) throw new Error('Add at least one email recipient');
          const res = await opts.authFetch(`${API_ROOT}/api/eod/email-materials`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              to,
              keys: bodyPayload.keys || [],
              attachments: bodyPayload.attachments || [],
              note,
              storeNumber: bodyPayload.storeNumber || '',
            }),
          });
          const data = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(data.error || `Email failed (${res.status})`);
          toast(`Emailed ${data.fileCount || fileCount} file(s)`, 'success');
          close();
        } else {
          const phones = (document.getElementById('dscPhoneInput').value || '')
            .split(/[,;\s]+/).map((s) => s.trim()).filter(Boolean);
          if (!phones.length) throw new Error('Enter at least one phone number');
          const res = await opts.authFetch(`${API_ROOT}/api/secure-share`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              phones,
              sendSms: true,
              sendEmail: false,
              keys: bodyPayload.keys || [],
              attachments: bodyPayload.attachments || [],
              note,
              storeNumber: bodyPayload.storeNumber || '',
              source: bodyPayload.source || 'dump-bin',
              requireDelivery: false,
            }),
          });
          const data = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(data.error || `Text failed (${res.status})`);
          const smsOk = data.channelsOk?.sms !== false;
          if (!smsOk) {
            throw new Error(
              data.sms?.results?.find((r) => !r.ok)?.error ||
                'SMS delivery failed. If the recipient has not opted in, they must text JOIN to (509) 572-9212 first.'
            );
          }
          toast('Text sent with secure viewer link (expires in 7 days)', 'success');
          close();
        }
      } catch (err) {
        toast(err.message || 'Share failed', 'error');
      } finally {
        btn.disabled = false;
        btn.textContent = prev;
      }
    };
  }

  global.DocShareCompose = { open };
})(typeof window !== 'undefined' ? window : globalThis);
