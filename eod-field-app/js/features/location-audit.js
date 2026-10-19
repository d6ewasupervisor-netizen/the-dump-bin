/* Location audit: does Kroger's store map put each item where the set is? */
(function (global) {
  'use strict';

  const NAV_KEY = 'eodLocationAuditNav';
  const SIDE = { L: 'left', R: 'right' };
  const ITEM_ANSWERS = [
    ['match', 'Kroger is right'],
    ['kroger_wrong', 'Kroger is wrong'],
    ['not_to_pog', 'Not set to POG'],
    ['missing', 'Not on shelf'],
  ];
  const REMOVED_ANSWERS = [
    ['missing', 'Not on shelf'],
    ['not_to_pog', 'Still on shelf'],
  ];

  const S = {
    mount: null,
    view: 'list',
    auditId: null,
    setId: null,
    bay: null,
    list: [],
    audit: null,
    detail: null,
    canManage: false,
    status: '',
  };
  const thumbUrls = new Map();

  function esc(s) {
    return global.EodApi?.escapeHtml?.(s) ?? String(s ?? '');
  }

  function base() {
    return `${global.EOD_API_BASE || 'https://eod-api.the-dump-bin.com'}/api/location-audits`;
  }

  async function api(path, { method = 'GET', body, timeoutMs } = {}) {
    const init = { method };
    if (body !== undefined) {
      init.headers = { 'Content-Type': 'application/json' };
      init.body = JSON.stringify(body);
    }
    if (timeoutMs) init.timeoutMs = timeoutMs;
    const resp = await global.authFetch(`${base()}${path}`, init);
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok || data.ok === false) {
      const err = new Error(data.error || `Request failed (${resp.status})`);
      err.status = resp.status;
      err.data = data;
      throw err;
    }
    return data;
  }

  function saveNav() {
    try {
      sessionStorage.setItem(NAV_KEY, JSON.stringify({ view: S.view, auditId: S.auditId, setId: S.setId, bay: S.bay }));
    } catch (_) { /* private mode */ }
  }

  function loadNav() {
    try {
      const nav = JSON.parse(sessionStorage.getItem(NAV_KEY) || 'null');
      if (nav && typeof nav === 'object') Object.assign(S, nav);
    } catch (_) { /* ignore */ }
  }

  function setStatus(msg) {
    S.status = msg || '';
    const el = document.getElementById('laStatus');
    if (el) el.textContent = S.status;
  }

  /* ---------- labels ---------- */

  function sideWord(side) {
    const s = String(side || '').toUpperCase();
    return SIDE[s] || s.toLowerCase();
  }

  function plural(n, word) {
    return `${n} ${word}${Number(n) === 1 ? '' : 's'}`;
  }

  function locLine(p) {
    if (!p) return 'No location';
    if (!p.aisle || p.aisle === '0') return p.description || 'No aisle';
    return [
      `Aisle ${p.aisle} ${sideWord(p.side)}`.trim(),
      p.bay && `Bay ${p.bay}`,
      p.shelf && `Shelf ${p.shelf}`,
      p.position && `Position ${p.position}`,
      p.facings && plural(p.facings, 'facing'),
    ].filter(Boolean).join(' · ');
  }

  function krogerLine(k) {
    if (!k) return 'Kroger did not answer';
    if (!k.found) return 'Not listed at this store';
    return locLine(k.primary);
  }

  function pogLine(it) {
    if (it.removed) return 'Removed on this POG';
    return [
      `Bay ${it.bay}`,
      `Shelf ${it.fix}`,
      `Position ${it.pos}`,
      it.facings && plural(it.facings, 'facing'),
      it.widthIn != null && `${it.widthIn} in wide`,
    ].filter(Boolean).join(' · ');
  }

  function answerLabel(it) {
    const list = it.removed ? REMOVED_ANSWERS : ITEM_ANSWERS;
    return (list.find(([v]) => v === it.answer) || [])[1] || '';
  }

  function krogerImg(url, size) {
    return url ? String(url).replace(/\/(xlarge|large|medium|small|thumbnail)\//, `/${size}/`) : '';
  }

  function sourceLabel(set) {
    if (set.source === 'pdf') {
      return [set.pogName || 'POG PDF', set.sourceDate && `effective ${set.sourceDate}`].filter(Boolean).join(' · ');
    }
    return `Store Intelligence${set.sourceDate ? ` · ${set.sourceDate}` : ''}`;
  }

  function aisleText(sa) {
    return sa ? `Aisle ${sa.number} ${sideWord(sa.side)}`.trim() : 'No Kroger aisle';
  }

  /* ---------- progress (mirrors eod-api computeProgress) ---------- */

  function stripHasIssue(s) {
    return s.skin === 'missing' || s.skin === 'damaged' || s.indicators === 'mismatch' || s.tags === 'mismatch';
  }

  function progress(d) {
    const { set, items, strips, photos, shelves } = d;
    const checks = items.filter((it) => it.checkKind);
    const checksDone = checks.filter((it) => it.answer);
    const bays = [...new Set(shelves.map((s) => s.bay))].sort((a, b) => a - b);
    const bayPhotos = new Set(photos.filter((p) => p.kind === 'bay').map((p) => p.bay));
    const stripByKey = new Map(strips.map((s) => [`${s.bay}|${s.fix}`, s]));
    const stripDone = shelves.filter((sh) => {
      const s = stripByKey.get(`${sh.bay}|${sh.fix}`);
      return s && s.skin && s.indicators && s.tags;
    });
    const itemPhotoIds = new Set(photos.filter((p) => p.kind === 'item').map((p) => p.itemId));
    const stripPhotoKeys = new Set(photos.filter((p) => p.kind === 'strip').map((p) => `${p.bay}|${p.fix}`));
    const missingPhotos = [];
    for (const b of bays) if (!bayPhotos.has(b)) missingPhotos.push({ kind: 'bay', bay: b });
    for (const it of items) {
      if (it.answer && it.answer !== 'match' && !itemPhotoIds.has(it.id)) {
        missingPhotos.push({ kind: 'item', itemId: it.id, bay: it.bay, fix: it.fix, pos: it.pos });
      }
    }
    for (const s of strips) {
      if (stripHasIssue(s) && !stripPhotoKeys.has(`${s.bay}|${s.fix}`)) missingPhotos.push({ kind: 'strip', bay: s.bay, fix: s.fix });
    }
    const sc = set.setChecks || {};
    const notThisPog = sc.setMatches === 'no';
    const setCheckDone = notThisPog || !!(sc.setMatches && sc.aisleMatches && sc.bayOrder);
    const krogerWrong = items.filter((it) => it.answer === 'kroger_wrong').length;
    const stalePulled = items.filter((it) => it.removed && it.answer === 'missing').length;
    const notToPog = items.filter((it) => it.answer === 'not_to_pog').length;
    const missing = items.filter((it) => !it.removed && it.answer === 'missing').length;
    const stripIssues = strips.filter(stripHasIssue).length + items.filter((it) => it.stripWrong).length;
    const mapWrong = krogerWrong + stalePulled + (sc.aisleMatches === 'no' ? 1 : 0) + (sc.bayOrder === 'no' ? 1 : 0);
    return {
      checks: { done: checksDone.length, total: checks.length },
      strips: { done: stripDone.length, total: shelves.length },
      bayPhotos: { done: bays.filter((b) => bayPhotos.has(b)).length, total: bays.length },
      missingPhotos,
      setCheck: setCheckDone,
      counts: { krogerWrong, stalePulled, notToPog, missing, stripIssues },
      notThisPog,
      suggestedVerdict: mapWrong > 0 || notThisPog ? 'incorrect' : 'correct',
      ready: notThisPog
        ? !!sc.setNote && !missingPhotos.length
        : setCheckDone && checksDone.length === checks.length && stripDone.length === shelves.length && !missingPhotos.length,
    };
  }

  /* ---------- photos ---------- */

  async function filePhoto(file) {
    const C = global.EodPhotoCompress;
    if (C?.compressFile) {
      const out = await C.compressFile(file, 'context');
      return { mime: out.mime, data: String(out.dataUrl).replace(/^data:[^,]*,/, '') };
    }
    const dataUrl = await new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = reject;
      r.readAsDataURL(file);
    });
    return { mime: file.type || 'image/jpeg', data: String(dataUrl).replace(/^data:[^,]*,/, '') };
  }

  async function uploadPhoto(meta, file) {
    const photo = await filePhoto(file);
    const data = await api(`/sets/${S.setId}/photos`, { method: 'POST', body: { ...meta, photo }, timeoutMs: 90000 });
    S.detail.photos.push(data.photo);
    return data.photo;
  }

  function photosFor(pred) {
    return (S.detail?.photos || []).filter(pred);
  }

  function thumbsHtml(list) {
    return list.map((p) => `<button type="button" class="la-thumb" data-la-view="${esc(p.id)}" aria-label="Photo"><img alt="" data-la-photo="${esc(p.id)}"></button>`).join('');
  }

  function photoBtn(meta, label) {
    const attrs = Object.entries(meta)
      .filter(([, v]) => v != null && v !== '')
      .map(([k, v]) => `data-${k}="${esc(v)}"`)
      .join(' ');
    return `<label class="btn btn-secondary la-photo-btn">${esc(label || 'Photo')}<input type="file" accept="image/*" capture="environment" hidden data-la-photo-input ${attrs}></label>`;
  }

  function metaFromInput(input) {
    return {
      kind: input.getAttribute('data-kind'),
      bay: input.getAttribute('data-bay') || null,
      fix: input.getAttribute('data-fix') || null,
      itemId: input.getAttribute('data-item') || null,
      concernId: input.getAttribute('data-concern') || null,
    };
  }

  async function hydrateThumbs(root) {
    const imgs = [...(root?.querySelectorAll?.('img[data-la-photo]') || [])];
    await Promise.all(imgs.map(async (img) => {
      const id = img.getAttribute('data-la-photo');
      if (thumbUrls.has(id)) {
        img.src = thumbUrls.get(id);
        return;
      }
      try {
        const resp = await global.authFetch(`${base()}/photos/${id}`);
        if (!resp.ok) return;
        const url = URL.createObjectURL(await resp.blob());
        thumbUrls.set(id, url);
        img.src = url;
      } catch (_) { /* leave blank */ }
    }));
  }

  /* ---------- modal shell ---------- */

  function openModal(html, { wide } = {}) {
    closeModal();
    const host = document.createElement('div');
    host.id = 'laModal';
    host.className = 'modal-overlay show la-modal';
    host.innerHTML = `<div class="modal-dialog la-sheet${wide ? ' wide' : ''}" role="dialog" aria-modal="true">${html}</div>`;
    document.body.appendChild(host);
    host.addEventListener('click', (e) => { if (e.target === host) closeModal(); });
    host.addEventListener('eod-dialog-escape', () => closeModal(), { once: true });
    global.EodA11y?.activate?.(host);
    return host;
  }

  function closeModal() {
    const host = document.getElementById('laModal');
    if (!host) return;
    global.EodA11y?.deactivate?.(host);
    host.remove();
  }

  function viewPhoto(photoId) {
    const p = (S.detail?.photos || []).find((x) => x.id === photoId);
    const host = openModal(`<img class="la-full" alt="" data-la-photo="${esc(photoId)}">
      <div class="la-err" id="laPhotoErr"></div>
      <div class="btn-row">
        <button type="button" class="btn btn-secondary" data-close>Close</button>
        ${p && S.detail?.set?.status !== 'submitted' ? '<button type="button" class="btn btn-secondary" data-del>Delete</button>' : ''}
      </div>`, { wide: true });
    hydrateThumbs(host);
    host.querySelector('[data-close]').onclick = closeModal;
    const del = host.querySelector('[data-del]');
    if (del) {
      del.onclick = async () => {
        del.disabled = true;
        try {
          await api(`/photos/${photoId}`, { method: 'DELETE' });
          S.detail.photos = S.detail.photos.filter((x) => x.id !== photoId);
          closeModal();
          paintSet();
        } catch (err) {
          host.querySelector('#laPhotoErr').textContent = err.message;
          del.disabled = false;
        }
      };
    }
  }

  /* ---------- list ---------- */

  function setLine(s) {
    const verdict = s.status === 'submitted'
      ? `<span class="pill ${s.verdict === 'correct' ? 'ok' : 'bad'}">${s.verdict === 'correct' ? 'Mapped correctly' : 'Not mapped correctly'}</span>`
      : `<span class="pill">${s.checksDone}/${s.checks}</span>`;
    return `<span class="la-card-set"><span>${esc(s.title)}</span>${verdict}</span>`;
  }

  function newAuditForm(store) {
    return `<form id="laNewForm" class="la-form" hidden>
      <label>Store<input name="store" inputmode="numeric" value="${esc(store || '')}" required></label>
      <label>Name<input name="title" maxlength="120"></label>
      <label>POG PDFs<input name="pdfs" type="file" accept="application/pdf,.pdf" multiple></label>
      <label>DBKeys<input name="dbkeys" inputmode="numeric"></label>
      <div class="btn-row"><button type="submit" class="btn btn-primary">Create</button></div>
    </form>`;
  }

  async function renderList() {
    const store = global.EodSession?.state?.storeNumber || '';
    const qs = new URLSearchParams({ all: '1' });
    if (store) qs.set('store', store);
    const data = await api(`/?${qs}`);
    S.list = data.audits || [];
    S.canManage = !!data.canManage;
    const cards = S.list.map((a) => `<button type="button" class="la-card" data-la-audit="${esc(a.id)}">
        <strong>${esc(a.title)}</strong>
        <span class="muted">Store ${esc(a.store)} · ${plural(a.sets.length, 'set')}</span>
        ${a.sets.map(setLine).join('')}
      </button>`).join('');
    S.mount.innerHTML = `<div class="card la-page la-root">
      <div class="la-head"><h1>Audit</h1>${S.canManage ? '<button type="button" class="btn btn-primary" data-la-new>New audit</button>' : ''}</div>
      ${S.canManage ? newAuditForm(store) : ''}
      <div id="laStatus" class="la-status" role="status">${esc(S.status)}</div>
      <div class="la-cards">${cards || `<p class="muted">No open audits${store ? ` for store ${esc(store)}` : ''}.</p>`}</div>
    </div>`;
    bindRoot();
  }

  async function readPdfs(input) {
    const files = [...(input?.files || [])];
    return Promise.all(files.map((file) => new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve({ name: file.name, data: String(r.result).replace(/^data:[^,]*,/, '') });
      r.onerror = reject;
      r.readAsDataURL(file);
    })));
  }

  function resultsText(results) {
    const bad = (results || []).filter((r) => !r.ok);
    if (!bad.length) return '';
    return bad.map((r) => `${r.source}: ${r.error}`).join(' · ');
  }

  async function submitNewAudit(form) {
    const btn = form.querySelector('[type="submit"]');
    btn.disabled = true;
    setStatus('Loading POGs and Kroger locations…');
    try {
      const body = {
        store: form.store.value,
        title: form.title.value,
        pdfs: await readPdfs(form.pdfs),
        dbkeys: form.dbkeys.value,
      };
      const data = await api('/', { method: 'POST', body, timeoutMs: 240000 });
      setStatus(resultsText(data.results));
      S.view = 'audit';
      S.auditId = data.audit.id;
      saveNav();
      await paint();
    } catch (err) {
      setStatus(err.message);
      btn.disabled = false;
    }
  }

  /* ---------- audit ---------- */

  function setCard(s) {
    const verdict = s.status === 'submitted'
      ? `<span class="pill ${s.verdict === 'correct' ? 'ok' : 'bad'}">${s.verdict === 'correct' ? 'Mapped correctly' : 'Not mapped correctly'}</span>`
      : '';
    const stats = s.stats || {};
    return `<div class="la-setcard">
      <button type="button" class="la-card" data-la-set="${esc(s.id)}">
        <strong>${esc(s.title)}</strong>
        <span class="muted">DBKey ${esc(s.dbkey || '')} · ${esc(sourceLabel(s))}</span>
        <span class="muted">${esc(aisleText(s.setAisle))} · ${plural(stats.flagged || 0, 'flag')} · ${plural(stats.spot || 0, 'spot check')}</span>
        <span class="la-card-set"><span>Checks ${s.checksDone}/${s.checks}${s.krogerWrong ? ` · Kroger wrong ${s.krogerWrong}` : ''}${s.concerns ? ` · ${plural(s.concerns, 'concern')}` : ''}</span>${verdict}</span>
      </button>
      ${S.canManage ? `<button type="button" class="btn btn-secondary la-mini" data-la-remove-set="${esc(s.id)}">Remove</button>` : ''}
    </div>`;
  }

  async function renderAudit() {
    const data = await api(`/${S.auditId}`);
    S.audit = data.audit;
    S.canManage = !!data.canManage;
    const a = S.audit;
    S.mount.innerHTML = `<div class="card la-page la-root">
      <div class="la-head">
        <button type="button" class="btn btn-secondary" data-la-back="list">Back</button>
        <div class="la-head-copy"><h1>${esc(a.title)}</h1><div class="muted">Store ${esc(a.store)}</div></div>
      </div>
      <div id="laStatus" class="la-status" role="status">${esc(S.status)}</div>
      <div class="la-cards">${a.sets.map(setCard).join('') || '<p class="muted">No sets.</p>'}</div>
      <div class="btn-row">
        <button type="button" class="btn btn-secondary" data-la-csv>Findings CSV</button>
        ${S.canManage ? '<button type="button" class="btn btn-secondary" data-la-add>Add POG</button>' : ''}
        ${S.canManage ? '<button type="button" class="btn btn-secondary" data-la-close-audit>Close audit</button>' : ''}
      </div>
      ${S.canManage ? `<form id="laAddForm" class="la-form" hidden>
        <label>POG PDFs<input name="pdfs" type="file" accept="application/pdf,.pdf" multiple></label>
        <label>DBKeys<input name="dbkeys" inputmode="numeric"></label>
        <div class="btn-row"><button type="submit" class="btn btn-primary">Add</button></div>
      </form>` : ''}
    </div>`;
    bindRoot();
  }

  async function submitAddSets(form) {
    const btn = form.querySelector('[type="submit"]');
    btn.disabled = true;
    setStatus('Loading POGs and Kroger locations…');
    try {
      const data = await api(`/${S.auditId}/sets`, {
        method: 'POST',
        body: { pdfs: await readPdfs(form.pdfs), dbkeys: form.dbkeys.value },
        timeoutMs: 240000,
      });
      setStatus(resultsText(data.results));
      await paint();
    } catch (err) {
      setStatus(err.message);
      btn.disabled = false;
    }
  }

  async function downloadCsv() {
    const resp = await global.authFetch(`${base()}/${S.auditId}/findings.csv`);
    if (!resp.ok) throw new Error(`Findings failed (${resp.status})`);
    const blob = await resp.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `location-audit-${S.audit?.store || 'store'}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }

  /* ---------- set ---------- */

  function bays() {
    return [...new Set((S.detail?.shelves || []).map((s) => s.bay))].sort((a, b) => a - b);
  }

  function choice(name, value, options, attr) {
    return `<div class="la-opts">${options.map(([v, label]) => (
      `<button type="button" class="la-opt${value === v ? ' on' : ''}" ${attr}="${esc(name)}" data-value="${esc(v)}">${esc(label)}</button>`
    )).join('')}</div>`;
  }

  function setCheckHtml(d) {
    const sc = d.set.setChecks || {};
    const k = d.set.kroger || {};
    const sa = k.setAisle;
    const bayList = bays();
    const shelvesPerBay = Math.max(0, ...bayList.map((b) => d.shelves.filter((s) => s.bay === b).length));
    const facts = [
      d.set.meta?.widthFt ? `${d.set.meta.widthFt} ft` : '',
      plural(bayList.length, 'bay'),
      `${shelvesPerBay} ${shelvesPerBay === 1 ? 'shelf' : 'shelves'}`,
      `${d.items.filter((it) => !it.removed).length} items`,
    ].filter(Boolean).join(' · ');
    const bayRows = bayList.map((b) => {
      const m = k.bayMap?.[b];
      if (!m) return `POG bay ${b}: no Kroger bay`;
      const split = Object.entries(m.counts || {}).sort((a, b) => b[1] - a[1]);
      return `POG bay ${b} → Kroger bay ${m.krogerBay}${split.length > 1 ? ` (${split.map(([kb, n]) => `${kb}: ${n}`).join(', ')})` : ''}`;
    });
    const open = d.set.status !== 'submitted';
    return `<section class="la-sec" id="laSetCheck">
      <h2>Set check</h2>
      <div class="la-q">
        <div class="la-q-label">Set matches the POG<span class="muted">${esc(facts)}</span></div>
        ${choice('setMatches', sc.setMatches, [['yes', 'Yes'], ['no', 'No']], 'data-la-check')}
        ${sc.setMatches === 'no' ? `<textarea class="la-note" data-la-checknote="setNote" placeholder="Note">${esc(sc.setNote || '')}</textarea>` : ''}
      </div>
      <div class="la-q">
        <div class="la-q-label">Kroger: ${esc(aisleText(sa))}</div>
        ${choice('aisleMatches', sc.aisleMatches, [['yes', 'Yes'], ['no', 'No']], 'data-la-check')}
        ${sc.aisleMatches === 'no' ? `<div class="la-inline">
          <label>Aisle<input data-la-checkfield="actualAisle" inputmode="numeric" value="${esc(sc.actualAisle || '')}"></label>
          <label>Side<select data-la-checkfield="actualSide"><option value=""></option><option value="L"${sc.actualSide === 'L' ? ' selected' : ''}>Left</option><option value="R"${sc.actualSide === 'R' ? ' selected' : ''}>Right</option></select></label>
        </div>
        <textarea class="la-note" data-la-checknote="aisleNote" placeholder="Note">${esc(sc.aisleNote || '')}</textarea>` : ''}
      </div>
      <div class="la-q">
        <div class="la-q-label">Kroger bays<span class="muted">${bayRows.map(esc).join('<br>')}</span></div>
        ${choice('bayOrder', sc.bayOrder, [['yes', 'Yes'], ['no', 'No'], ['unsure', "Can't tell"]], 'data-la-check')}
        ${sc.bayOrder === 'no' ? `<textarea class="la-note" data-la-checknote="bayNote" placeholder="Note">${esc(sc.bayNote || '')}</textarea>` : ''}
      </div>
      <div class="la-q">
        <div class="la-q-label">Bay photos</div>
        <div class="la-bayphotos">${bayList.map((b) => `<div class="la-bayphoto">
          <span>Bay ${b}</span>
          ${thumbsHtml(photosFor((p) => p.kind === 'bay' && p.bay === b))}
          ${open ? photoBtn({ kind: 'bay', bay: b }) : ''}
        </div>`).join('')}</div>
      </div>
    </section>`;
  }

  function tileHtml(it) {
    const cls = ['la-tile'];
    if (it.removed) cls.push('removed');
    if (it.answer) cls.push(`ans-${it.answer}`);
    else if (it.checkKind) cls.push(`need-${it.checkKind}`);
    if (it.stripWrong) cls.push('strip-wrong');
    const img = it.kroger?.imageUrl
      ? `<img loading="lazy" alt="" referrerpolicy="no-referrer" src="${esc(krogerImg(it.kroger.imageUrl, 'medium'))}">`
      : `<span class="la-tile-name">${esc(it.name)}</span>`;
    const mark = it.checkKind && !it.answer ? `<span class="la-tile-mark">${it.checkKind === 'flagged' ? '!' : '?'}</span>` : '';
    return `<button type="button" class="${cls.join(' ')}" data-la-item="${esc(it.id)}" aria-label="${esc(`${it.name}, position ${it.pos ?? ''}`)}">
      ${img}
      <span class="la-tile-pos">${esc(it.pos ?? '')}</span>
      ${it.facings > 1 ? `<span class="la-tile-fac">x${esc(it.facings)}</span>` : ''}
      ${mark}
    </button>`;
  }

  function bayHtml(d, bay) {
    const shelves = d.shelves.filter((s) => s.bay === bay);
    const shelfKeys = new Set(shelves.map((s) => s.fix));
    const blocks = shelves.map((sh) => {
      const items = d.items
        .filter((it) => it.bay === bay && it.fix === sh.fix)
        .sort((a, b) => (Number(a.pos) || 999) - (Number(b.pos) || 999));
      const strip = d.strips.find((s) => s.bay === bay && s.fix === sh.fix);
      const done = strip && strip.skin && strip.indicators && strip.tags;
      const state = !done ? 'open' : (stripHasIssue(strip) ? 'bad' : 'ok');
      return `<div class="la-shelf">
        <div class="la-shelf-head">
          <strong>Shelf ${esc(sh.fix)}</strong>
          ${sh.headIn != null ? `<span class="muted">${esc(sh.headIn)} in</span>` : ''}
          <button type="button" class="la-strip-btn ${state}" data-la-strip="${esc(sh.fix)}">Strip${state === 'ok' ? ' ✓' : state === 'bad' ? ' ✕' : ''}</button>
        </div>
        <div class="la-tiles">${items.map(tileHtml).join('')}</div>
      </div>`;
    });
    const firstBay = bays()[0];
    const stray = d.items.filter((it) => it.removed && (it.bay == null ? bay === firstBay : (it.bay === bay && !shelfKeys.has(it.fix))));
    if (stray.length) {
      blocks.push(`<div class="la-shelf"><div class="la-shelf-head"><strong>Removed on this POG</strong></div><div class="la-tiles">${stray.map(tileHtml).join('')}</div></div>`);
    }
    return blocks.join('');
  }

  function concernsHtml(d) {
    const open = d.set.status !== 'submitted';
    const rows = d.concerns.map((c) => {
      const it = c.itemId ? d.items.find((x) => x.id === c.itemId) : null;
      const where = it ? `${it.name} · Bay ${it.bay} · Shelf ${it.fix} · Position ${it.pos}` : (c.bay != null ? `Bay ${c.bay}${c.fix != null ? ` · Shelf ${c.fix}` : ''}` : '');
      return `<li class="la-concern">
        <div>${esc(c.body)}</div>
        ${where ? `<div class="muted">${esc(where)}</div>` : ''}
        <div class="muted">${esc(c.createdBy || '')}</div>
        <div class="la-thumbs">${thumbsHtml(photosFor((p) => p.kind === 'concern' && p.concernId === c.id))}
          ${open ? photoBtn({ kind: 'concern', concern: c.id }) : ''}</div>
      </li>`;
    }).join('');
    return `<section class="la-sec" id="laConcerns">
      <h2>Concerns</h2>
      <ul class="la-concerns">${rows}</ul>
      ${open ? '<button type="button" class="btn btn-secondary" data-la-concern>Raise a concern</button>' : ''}
    </section>`;
  }

  function verdictHtml(d, p) {
    const c = p.counts;
    const counts = [
      ['Kroger wrong', c.krogerWrong],
      ['Pulled items Kroger still maps', c.stalePulled],
      ['Not set to POG', c.notToPog],
      ['Not on shelf', c.missing],
      ['Strip issues', c.stripIssues],
      ['Concerns', d.concerns.length],
    ].map(([label, n]) => `<div class="la-count${n ? ' hit' : ''}"><span>${esc(label)}</span><strong>${n}</strong></div>`).join('');
    if (d.set.status === 'submitted') {
      return `<section class="la-sec" id="laVerdict">
        <h2>Verdict</h2>
        <div class="la-counts">${counts}</div>
        <p><span class="pill ${d.set.verdict === 'correct' ? 'ok' : 'bad'}">${d.set.verdict === 'correct' ? 'Mapped correctly' : 'Not mapped correctly'}</span></p>
        ${d.set.verdictNote ? `<p>${esc(d.set.verdictNote)}</p>` : ''}
        <p class="muted">${esc(d.set.submittedBy || '')}${d.set.submittedAt ? ` · ${esc(new Date(d.set.submittedAt).toLocaleString())}` : ''}</p>
        ${S.canManage ? '<button type="button" class="btn btn-secondary" data-la-reopen>Reopen</button>' : ''}
      </section>`;
    }
    const owed = [];
    const noteOwed = p.notThisPog && !(d.set.setChecks || {}).setNote;
    if (!p.setCheck || noteOwed) owed.push('<button type="button" class="la-owed" data-la-goto="setcheck">Set check</button>');
    const left = p.notThisPog ? 0 : p.checks.total - p.checks.done;
    if (left) owed.push(`<button type="button" class="la-owed" data-la-next>${plural(left, 'item check')}</button>`);
    const stripsLeft = p.notThisPog ? 0 : p.strips.total - p.strips.done;
    if (stripsLeft) owed.push(`<button type="button" class="la-owed" data-la-next-strip>${plural(stripsLeft, 'strip')}</button>`);
    if (p.missingPhotos.length) owed.push(`<button type="button" class="la-owed" data-la-next-photo>${plural(p.missingPhotos.length, 'photo')}</button>`);
    const pick = S.verdictPick || p.suggestedVerdict;
    return `<section class="la-sec" id="laVerdict">
      <h2>Verdict</h2>
      <div class="la-counts">${counts}</div>
      ${owed.length ? `<div class="la-owed-list">${owed.join('')}</div>` : ''}
      <div class="la-opts">
        <button type="button" class="la-opt${pick === 'correct' ? ' on' : ''}" data-la-verdict="correct">Mapped correctly</button>
        <button type="button" class="la-opt${pick === 'incorrect' ? ' on' : ''}" data-la-verdict="incorrect">Not mapped correctly</button>
      </div>
      <textarea class="la-note" id="laVerdictNote" placeholder="Note">${esc(S.verdictNote || '')}</textarea>
      <div class="btn-row"><button type="button" class="btn btn-primary" data-la-submit${p.ready ? '' : ' disabled'}>Submit</button></div>
    </section>`;
  }

  function chip(label, done) {
    return `<span class="la-chip${done ? ' done' : ''}">${esc(label)}</span>`;
  }

  function setHtml(d) {
    const p = progress(d);
    const bayList = bays();
    if (!bayList.includes(S.bay)) S.bay = bayList[0] ?? null;
    const bayChips = bayList.length > 1 ? `<nav class="la-baynav">${bayList.map((b) => {
      const checks = d.items.filter((it) => it.bay === b && it.checkKind);
      const done = checks.filter((it) => it.answer).length;
      return `<button type="button" class="la-baychip${b === S.bay ? ' on' : ''}" data-la-bay="${b}">Bay ${b}<span>${done}/${checks.length}</span></button>`;
    }).join('')}</nav>` : '';
    const left = p.checks.total - p.checks.done;
    return `<div class="card la-page la-root la-set">
      <div class="la-head">
        <button type="button" class="btn btn-secondary" data-la-back="audit">Back</button>
        <div class="la-head-copy"><h1>${esc(d.set.title)}</h1>
          <div class="muted">DBKey ${esc(d.set.dbkey || '')} · Store ${esc(d.set.store)} · ${esc(sourceLabel(d.set))}</div></div>
      </div>
      <div class="la-chips">
        ${chip(`Set check${p.setCheck ? ' ✓' : ''}`, p.setCheck)}
        ${chip(`Checks ${p.checks.done}/${p.checks.total}`, p.checks.done === p.checks.total)}
        ${chip(`Strips ${p.strips.done}/${p.strips.total}`, p.strips.done === p.strips.total)}
        ${chip(`Bay photos ${p.bayPhotos.done}/${p.bayPhotos.total}`, p.bayPhotos.done === p.bayPhotos.total)}
        ${left && !p.notThisPog && d.set.status !== 'submitted' ? '<button type="button" class="btn btn-primary la-next" data-la-next>Next check</button>' : ''}
      </div>
      <div id="laStatus" class="la-status" role="status">${esc(S.status)}</div>
      ${setCheckHtml(d)}
      <section class="la-sec">
        <h2>Shelves</h2>
        <div class="la-legend">
          <span><i class="need-flagged"></i>Flagged</span><span><i class="need-spot"></i>Spot check</span>
          <span><i class="ans-match"></i>Kroger right</span><span><i class="ans-kroger_wrong"></i>Kroger wrong</span>
          <span><i class="ans-not_to_pog"></i>Not set to POG</span><span><i class="ans-missing"></i>Not on shelf</span>
        </div>
        ${bayChips}
        <div id="laBay">${S.bay != null ? bayHtml(d, S.bay) : ''}</div>
      </section>
      ${concernsHtml(d)}
      ${verdictHtml(d, p)}
    </div>`;
  }

  function paintSet() {
    if (!S.detail || S.view !== 'set') return;
    const pane = document.getElementById('appMount');
    const keepY = global.scrollY || 0;
    const keepPane = pane ? pane.scrollTop : 0;
    S.mount.innerHTML = setHtml(S.detail);
    bindRoot();
    hydrateThumbs(S.mount);
    requestAnimationFrame(() => {
      global.scrollTo?.(0, keepY);
      if (pane) pane.scrollTop = keepPane;
    });
  }

  async function renderSet() {
    const data = await api(`/sets/${S.setId}`);
    S.canManage = !!data.canManage;
    S.detail = { set: data.set, shelves: data.shelves, items: data.items, strips: data.strips, concerns: data.concerns, photos: data.photos };
    S.verdictPick = null;
    S.verdictNote = '';
    paintSet();
  }

  function nextCheck(afterId) {
    const d = S.detail;
    const order = [...d.items]
      .filter((it) => it.checkKind && !it.answer)
      .sort((a, b) => ((a.bay ?? 999) - (b.bay ?? 999)) || ((b.fix ?? 0) - (a.fix ?? 0)) || ((a.pos ?? 999) - (b.pos ?? 999)));
    if (!order.length) return null;
    if (!afterId) return order[0];
    const cur = d.items.find((x) => x.id === afterId);
    const key = (it) => [(it.bay ?? 999), -(it.fix ?? 0), (it.pos ?? 999)];
    const after = order.find((it) => {
      const a = key(it);
      const c = key(cur);
      return a[0] > c[0] || (a[0] === c[0] && (a[1] > c[1] || (a[1] === c[1] && a[2] > c[2])));
    });
    return after || order[0];
  }

  /* ---------- item sheet ---------- */

  function actualDefaults(it) {
    const k = S.detail.set.kroger || {};
    return {
      aisle: k.setAisle?.number || '',
      side: k.setAisle?.side || '',
      bay: (it.bay != null && k.bayMap?.[it.bay]?.krogerBay) || '',
      shelf: it.fix != null ? String(it.fix) : '',
      position: it.pos != null ? String(it.pos) : '',
      facings: it.facings != null ? String(it.facings) : '',
    };
  }

  function actualFields(actual) {
    const a = actual || {};
    const field = (key, label, mode) => `<label>${label}<input data-actual="${key}" inputmode="${mode || 'numeric'}" value="${esc(a[key] || '')}"></label>`;
    return `<div class="la-inline la-actual">
      ${field('aisle', 'Aisle')}
      <label>Side<select data-actual="side"><option value=""></option><option value="L"${a.side === 'L' ? ' selected' : ''}>Left</option><option value="R"${a.side === 'R' ? ' selected' : ''}>Right</option></select></label>
      ${field('bay', 'Bay')}${field('shelf', 'Shelf')}${field('position', 'Position')}${field('facings', 'Facings')}
    </div>`;
  }

  function openItem(itemId) {
    const d = S.detail;
    const it = d.items.find((x) => x.id === itemId);
    if (!it) return;
    const open = d.set.status !== 'submitted';
    const draft = { answer: it.answer, actual: it.actual, stripWrong: it.stripWrong, note: it.note || '' };
    const extra = (it.kroger?.locations || []).length > 1
      ? it.kroger.locations.map((l) => `<dd class="muted">${esc(locLine(l))}</dd>`).join('')
      : '';
    const flags = (it.flags || []).map((f) => `<li class="${f.kind === 'check' ? 'check' : 'info'}">${esc(f.text)}</li>`).join('');
    const choices = (it.removed ? REMOVED_ANSWERS : ITEM_ANSWERS);
    const img = it.kroger?.imageUrl ? `<img alt="" referrerpolicy="no-referrer" src="${esc(krogerImg(it.kroger.imageUrl, 'large'))}">` : '';
    const html = () => `
      <div class="la-item-head">${img}<div><strong>${esc(it.name)}</strong>
        <div class="muted">UPC ${esc(it.upc)}${it.size ? ` · ${esc(it.size)}` : ''}</div>
        ${it.checkKind ? `<span class="pill ${it.checkKind === 'flagged' ? 'warn' : ''}">${it.checkKind === 'flagged' ? 'Flagged' : 'Spot check'}</span>` : ''}</div></div>
      <dl class="la-locs"><dt>POG</dt><dd>${esc(pogLine(it))}</dd><dt>Kroger</dt><dd>${esc(krogerLine(it.kroger))}</dd>${extra}</dl>
      ${flags ? `<ul class="la-flags">${flags}</ul>` : ''}
      ${open ? `<div class="la-opts la-answers">${choices.map(([v, label]) => `<button type="button" class="la-opt${draft.answer === v ? ' on' : ''}" data-answer="${v}">${esc(label)}</button>`).join('')}</div>
      ${draft.answer === 'kroger_wrong' || draft.answer === 'not_to_pog' ? actualFields(draft.actual || actualDefaults(it)) : ''}
      <label class="la-check"><input type="checkbox" data-strip-wrong${draft.stripWrong ? ' checked' : ''}> Strip wrong for this item</label>
      <textarea class="la-note" data-note placeholder="Note">${esc(draft.note)}</textarea>` : `<p>${esc(answerLabel(it) || 'No answer')}</p>${it.note ? `<p>${esc(it.note)}</p>` : ''}`}
      <div class="la-thumbs">${thumbsHtml(photosFor((p) => p.kind === 'item' && p.itemId === it.id))}${open ? photoBtn({ kind: 'item', item: it.id }) : ''}</div>
      <div class="la-err" id="laItemErr"></div>
      <div class="btn-row">
        <button type="button" class="btn btn-secondary" data-close>Close</button>
        ${open ? '<button type="button" class="btn btn-secondary" data-concern>Concern</button>' : ''}
        ${open ? '<button type="button" class="btn btn-secondary" data-save>Save</button>' : ''}
        ${open ? '<button type="button" class="btn btn-primary" data-save-next>Save · next</button>' : ''}
      </div>`;
    const host = openModal(html());
    const sheet = host.querySelector('.la-sheet');

    const readDraft = () => {
      const fields = sheet.querySelectorAll('[data-actual]');
      if (fields.length) {
        draft.actual = {};
        fields.forEach((f) => { draft.actual[f.getAttribute('data-actual')] = f.value.trim(); });
      }
      const sw = sheet.querySelector('[data-strip-wrong]');
      if (sw) draft.stripWrong = sw.checked;
      const note = sheet.querySelector('[data-note]');
      if (note) draft.note = note.value;
    };
    const repaint = () => {
      sheet.innerHTML = html();
      bindSheet();
      hydrateThumbs(sheet);
    };
    const save = async (goNext) => {
      readDraft();
      const err = sheet.querySelector('#laItemErr');
      sheet.querySelectorAll('[data-save],[data-save-next]').forEach((b) => { b.disabled = true; });
      try {
        const keepActual = draft.answer === 'kroger_wrong' || draft.answer === 'not_to_pog';
        const data = await api(`/sets/${S.setId}/items/${it.id}`, {
          method: 'POST',
          body: { answer: draft.answer || null, actual: keepActual ? draft.actual : null, stripWrong: draft.stripWrong, note: draft.note },
        });
        Object.assign(it, data.item);
        const next = goNext ? nextCheck(it.id) : null;
        closeModal();
        if (next && next.bay != null && next.bay !== S.bay) S.bay = next.bay;
        saveNav();
        paintSet();
        if (next) openItem(next.id);
      } catch (e) {
        if (err) err.textContent = e.message;
        sheet.querySelectorAll('[data-save],[data-save-next]').forEach((b) => { b.disabled = false; });
      }
    };
    function bindSheet() {
      sheet.querySelectorAll('[data-answer]').forEach((btn) => {
        btn.onclick = () => {
          readDraft();
          const v = btn.getAttribute('data-answer');
          draft.answer = draft.answer === v ? null : v;
          if ((draft.answer === 'kroger_wrong' || draft.answer === 'not_to_pog') && !draft.actual) draft.actual = actualDefaults(it);
          repaint();
        };
      });
      sheet.querySelector('[data-close]').onclick = closeModal;
      const c = sheet.querySelector('[data-concern]');
      if (c) c.onclick = () => openConcern({ itemId: it.id, bay: it.bay, fix: it.fix });
      const s1 = sheet.querySelector('[data-save]');
      if (s1) s1.onclick = () => save(false);
      const s2 = sheet.querySelector('[data-save-next]');
      if (s2) s2.onclick = () => save(true);
      bindPhotoInputs(sheet, () => {
        readDraft();
        repaint();
        paintSetQuiet();
      });
      sheet.querySelectorAll('[data-la-view]').forEach((b) => {
        b.onclick = () => viewPhoto(b.getAttribute('data-la-view'));
      });
    }
    bindSheet();
    hydrateThumbs(sheet);
  }

  /** Repaint the page behind an open sheet without touching the sheet. */
  function paintSetQuiet() {
    const modal = document.getElementById('laModal');
    if (modal) modal.remove();
    paintSet();
    if (modal) document.body.appendChild(modal);
  }

  /* ---------- strip sheet ---------- */

  function openStrip(bay, fix) {
    const d = S.detail;
    const open = d.set.status !== 'submitted';
    const prev = d.strips.find((s) => s.bay === bay && s.fix === fix) || {};
    const draft = { skin: prev.skin || null, indicators: prev.indicators || null, tags: prev.tags || null, note: prev.note || '' };
    const items = d.items
      .filter((it) => !it.removed && it.bay === bay && it.fix === fix)
      .sort((a, b) => (Number(a.pos) || 0) - (Number(b.pos) || 0));
    const total = items.reduce((sum, it) => sum + ((Number(it.widthIn) || 0) * (Number(it.facings) || 1)), 0);
    const rows = items.map((it) => `<tr>
        <td>${esc(it.pos)}</td><td>${esc(it.name)}</td><td>${esc(it.facings ?? '')}</td>
        <td>${it.widthIn != null ? esc(it.widthIn) : ''}</td>
        <td>${it.widthIn != null ? esc(Math.round(it.widthIn * (it.facings || 1) * 100) / 100) : ''}</td>
      </tr>`).join('');
    const html = () => `
      <h2>Strip · Bay ${esc(bay)} · Shelf ${esc(fix)}</h2>
      <div class="la-table-wrap"><table class="la-table">
        <thead><tr><th>Pos</th><th>Item</th><th>Fac</th><th>Width in</th><th>Total in</th></tr></thead>
        <tbody>${rows}</tbody>
        ${total ? `<tfoot><tr><td></td><td>Shelf</td><td></td><td></td><td>${esc(Math.round(total * 100) / 100)}</td></tr></tfoot>` : ''}
      </table></div>
      <div class="la-q"><div class="la-q-label">Data skin</div>
        ${choice('skin', draft.skin, [['ok', 'OK'], ['missing', 'Missing'], ['damaged', 'Damaged']], 'data-strip')}</div>
      <div class="la-q"><div class="la-q-label">Width and facing marks</div>
        ${choice('indicators', draft.indicators, [['match', 'Match'], ['mismatch', 'Mismatch']], 'data-strip')}</div>
      <div class="la-q"><div class="la-q-label">Tags over the right items</div>
        ${choice('tags', draft.tags, [['match', 'Match'], ['mismatch', 'Mismatch']], 'data-strip')}</div>
      <textarea class="la-note" data-note placeholder="Note"${open ? '' : ' disabled'}>${esc(draft.note)}</textarea>
      <div class="la-thumbs">${thumbsHtml(photosFor((p) => p.kind === 'strip' && p.bay === bay && p.fix === fix))}${open ? photoBtn({ kind: 'strip', bay, fix }) : ''}</div>
      <div class="la-err" id="laStripErr"></div>
      <div class="btn-row">
        <button type="button" class="btn btn-secondary" data-close>Close</button>
        ${open ? '<button type="button" class="btn btn-primary" data-save>Save</button>' : ''}
      </div>`;
    const host = openModal(html(), { wide: true });
    const sheet = host.querySelector('.la-sheet');
    const readNote = () => {
      const note = sheet.querySelector('[data-note]');
      if (note) draft.note = note.value;
    };
    function bindSheet() {
      if (open) {
        sheet.querySelectorAll('[data-strip]').forEach((btn) => {
          btn.onclick = () => {
            readNote();
            draft[btn.getAttribute('data-strip')] = btn.getAttribute('data-value');
            sheet.innerHTML = html();
            bindSheet();
            hydrateThumbs(sheet);
          };
        });
      }
      sheet.querySelector('[data-close]').onclick = closeModal;
      const save = sheet.querySelector('[data-save]');
      if (save) {
        save.onclick = async () => {
          readNote();
          save.disabled = true;
          try {
            const data = await api(`/sets/${S.setId}/strips`, { method: 'POST', body: { bay, fix, ...draft } });
            d.strips = d.strips.filter((s) => !(s.bay === bay && s.fix === fix)).concat([data.strip]);
            closeModal();
            paintSet();
          } catch (e) {
            sheet.querySelector('#laStripErr').textContent = e.message;
            save.disabled = false;
          }
        };
      }
      bindPhotoInputs(sheet, () => {
        readNote();
        sheet.innerHTML = html();
        bindSheet();
        hydrateThumbs(sheet);
        paintSetQuiet();
      });
      sheet.querySelectorAll('[data-la-view]').forEach((b) => {
        b.onclick = () => viewPhoto(b.getAttribute('data-la-view'));
      });
    }
    bindSheet();
    hydrateThumbs(sheet);
  }

  /* ---------- concern sheet ---------- */

  function openConcern({ itemId, bay, fix } = {}) {
    const d = S.detail;
    const it = itemId ? d.items.find((x) => x.id === itemId) : null;
    const shelfOpts = d.shelves.map((sh) => {
      const v = `${sh.bay}|${sh.fix}`;
      const sel = bay === sh.bay && fix === sh.fix ? ' selected' : '';
      return `<option value="${v}"${sel}>Bay ${sh.bay} · Shelf ${sh.fix}</option>`;
    }).join('');
    const host = openModal(`
      <h2>Concern</h2>
      ${it ? `<p class="muted">${esc(it.name)} · ${esc(pogLine(it))}</p>` : `<label>Where<select data-where><option value="">Whole set</option>${shelfOpts}</select></label>`}
      <textarea class="la-note" data-body placeholder="What you see" rows="4"></textarea>
      <label class="btn btn-secondary la-photo-btn">Photo<input type="file" accept="image/*" capture="environment" hidden data-files multiple></label>
      <div class="muted" data-file-count></div>
      <div class="la-err" id="laConcernErr"></div>
      <div class="btn-row">
        <button type="button" class="btn btn-secondary" data-close>Close</button>
        <button type="button" class="btn btn-primary" data-save>Save</button>
      </div>`);
    const files = host.querySelector('[data-files]');
    files.onchange = () => {
      host.querySelector('[data-file-count]').textContent = files.files.length ? plural(files.files.length, 'photo') : '';
    };
    host.querySelector('[data-close]').onclick = closeModal;
    const save = host.querySelector('[data-save]');
    save.onclick = async () => {
      const body = host.querySelector('[data-body]').value.trim();
      const err = host.querySelector('#laConcernErr');
      if (!body) {
        err.textContent = 'Write what you see';
        return;
      }
      save.disabled = true;
      try {
        let where = {};
        const sel = host.querySelector('[data-where]');
        if (sel && sel.value) {
          const [b, f] = sel.value.split('|').map(Number);
          where = { bay: b, fix: f };
        } else if (it) {
          where = { bay: it.bay, fix: it.fix };
        }
        const data = await api(`/sets/${S.setId}/concerns`, { method: 'POST', body: { body, itemId: itemId || null, ...where } });
        d.concerns.push(data.concern);
        for (const file of [...(files.files || [])]) {
          await uploadPhoto({ kind: 'concern', concernId: data.concern.id }, file);
        }
        closeModal();
        paintSet();
      } catch (e) {
        err.textContent = e.message;
        save.disabled = false;
      }
    };
  }

  /* ---------- binding ---------- */

  function bindPhotoInputs(root, after) {
    root.querySelectorAll('[data-la-photo-input]').forEach((input) => {
      input.onchange = async () => {
        const file = input.files && input.files[0];
        if (!file) return;
        const label = input.closest('label');
        label?.classList.add('busy');
        try {
          await uploadPhoto(metaFromInput(input), file);
          after?.();
        } catch (err) {
          setStatus(err.message);
          const sheetErr = root.querySelector('.la-err');
          if (sheetErr) sheetErr.textContent = err.message;
        } finally {
          label?.classList.remove('busy');
          input.value = '';
        }
      };
    });
  }

  async function saveCheck(patch) {
    const data = await api(`/sets/${S.setId}/checks`, { method: 'POST', body: patch });
    S.detail.set.setChecks = data.setChecks;
  }

  function bindRoot() {
    const root = S.mount.querySelector('.la-root');
    if (!root) return;
    root.addEventListener('click', onClick);
    root.addEventListener('change', onChange);
    root.addEventListener('submit', onSubmit);
    bindPhotoInputs(root, () => paintSet());
  }

  function onSubmit(e) {
    const form = e.target;
    if (form.id === 'laNewForm') {
      e.preventDefault();
      void submitNewAudit(form);
    } else if (form.id === 'laAddForm') {
      e.preventDefault();
      void submitAddSets(form);
    }
  }

  async function onChange(e) {
    const t = e.target;
    const noteKey = t.getAttribute?.('data-la-checknote');
    const fieldKey = t.getAttribute?.('data-la-checkfield');
    if (!noteKey && !fieldKey) return;
    try {
      await saveCheck({ [noteKey || fieldKey]: t.value });
      setStatus('');
    } catch (err) {
      setStatus(err.message);
    }
  }

  async function onClick(e) {
    const el = e.target.closest('button, [data-la-audit], [data-la-set]');
    if (!el || !S.mount.contains(el)) return;
    const attr = (name) => el.getAttribute(name);
    try {
      if (el.hasAttribute('data-la-new')) {
        const form = document.getElementById('laNewForm');
        if (form) form.hidden = !form.hidden;
      } else if (el.hasAttribute('data-la-add')) {
        const form = document.getElementById('laAddForm');
        if (form) form.hidden = !form.hidden;
      } else if (attr('data-la-audit')) {
        S.view = 'audit';
        S.auditId = attr('data-la-audit');
        setStatus('');
        saveNav();
        await paint();
      } else if (attr('data-la-set')) {
        S.view = 'set';
        S.setId = attr('data-la-set');
        S.bay = null;
        setStatus('');
        saveNav();
        await paint();
      } else if (attr('data-la-back')) {
        S.view = attr('data-la-back');
        setStatus('');
        saveNav();
        await paint();
      } else if (attr('data-la-remove-set')) {
        if (!global.confirm?.('Remove this set and its answers?')) return;
        await api(`/sets/${attr('data-la-remove-set')}`, { method: 'DELETE' });
        await paint();
      } else if (el.hasAttribute('data-la-csv')) {
        await downloadCsv();
      } else if (el.hasAttribute('data-la-close-audit')) {
        if (!global.confirm?.('Close this audit?')) return;
        await api(`/${S.auditId}/status`, { method: 'POST', body: { status: 'closed' } });
        S.view = 'list';
        saveNav();
        await paint();
      } else if (attr('data-la-check')) {
        const key = attr('data-la-check');
        const value = attr('data-value');
        const cur = S.detail.set.setChecks?.[key];
        await saveCheck({ [key]: cur === value ? null : value });
        paintSet();
      } else if (attr('data-la-bay')) {
        S.bay = Number(attr('data-la-bay'));
        saveNav();
        paintSet();
      } else if (attr('data-la-item')) {
        openItem(attr('data-la-item'));
      } else if (attr('data-la-strip')) {
        openStrip(S.bay, Number(attr('data-la-strip')));
      } else if (el.hasAttribute('data-la-next-strip')) {
        const d = S.detail;
        const sh = d.shelves.find((x) => {
          const s = d.strips.find((y) => y.bay === x.bay && y.fix === x.fix);
          return !(s && s.skin && s.indicators && s.tags);
        });
        if (sh) {
          S.bay = sh.bay;
          paintSet();
          openStrip(sh.bay, sh.fix);
        }
      } else if (el.hasAttribute('data-la-next-photo')) {
        const m = progress(S.detail).missingPhotos[0];
        if (m?.kind === 'item') openItem(m.itemId);
        else if (m?.kind === 'strip') {
          S.bay = m.bay;
          paintSet();
          openStrip(m.bay, m.fix);
        } else if (m?.kind === 'bay') {
          document.getElementById('laSetCheck')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      } else if (attr('data-la-goto') === 'setcheck') {
        document.getElementById('laSetCheck')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      } else if (el.hasAttribute('data-la-next')) {
        const next = nextCheck(null);
        if (next) {
          if (next.bay != null && next.bay !== S.bay) {
            S.bay = next.bay;
            paintSet();
          }
          openItem(next.id);
        }
      } else if (el.hasAttribute('data-la-concern')) {
        openConcern({});
      } else if (attr('data-la-view')) {
        viewPhoto(attr('data-la-view'));
      } else if (attr('data-la-verdict')) {
        S.verdictNote = document.getElementById('laVerdictNote')?.value || '';
        S.verdictPick = attr('data-la-verdict');
        paintSet();
      } else if (el.hasAttribute('data-la-submit')) {
        const note = document.getElementById('laVerdictNote')?.value || '';
        const verdict = S.verdictPick || progress(S.detail).suggestedVerdict;
        el.disabled = true;
        const data = await api(`/sets/${S.setId}/submit`, { method: 'POST', body: { verdict, note } });
        S.detail = { set: data.set, shelves: data.shelves, items: data.items, strips: data.strips, concerns: data.concerns, photos: data.photos };
        paintSet();
      } else if (el.hasAttribute('data-la-reopen')) {
        const data = await api(`/sets/${S.setId}/reopen`, { method: 'POST' });
        S.detail = { set: data.set, shelves: data.shelves, items: data.items, strips: data.strips, concerns: data.concerns, photos: data.photos };
        paintSet();
      }
    } catch (err) {
      setStatus(err.message);
      if (el.hasAttribute('data-la-submit')) el.disabled = false;
    }
  }

  /* ---------- route ---------- */

  async function paint() {
    if (S.view === 'set' && S.setId) return renderSet();
    if (S.view === 'audit' && S.auditId) return renderAudit();
    S.view = 'list';
    return renderList();
  }

  async function render(mount) {
    S.mount = mount;
    loadNav();
    try {
      await paint();
    } catch (err) {
      if (err.status === 404 && S.view !== 'list') {
        S.view = 'list';
        saveNav();
        await paint();
        return;
      }
      mount.innerHTML = `<div class="card la-page la-root"><h1>Audit</h1><p class="la-status">${esc(err.message)}</p>
        <button type="button" class="btn btn-secondary" data-la-back="list">Back</button></div>`;
      bindRoot();
    }
  }

  global.EodRouter?.register?.('audit', render);
  global.EodLocationAudit = { render, progress, krogerLine, pogLine, locLine };
})(typeof window !== 'undefined' ? window : globalThis);
