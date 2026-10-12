(function () {
  'use strict';

  const API = window.MEAT_PUSHER_API || 'https://eod-api.the-dump-bin.com/api/meat-pusher-survey/open';
  const TOKEN_KEY = 'meatPusherField';
  const ASSETS = '/meat-pusher-survey/assets/';

  const SETS = [
    { id: '556', label: '556 Ham Bar' },
    { id: '559', label: '559 Heat & Serve' },
    { id: '570', label: '570 Dinner Sausage' },
    { id: '575', label: '575 Hot Dogs' },
    { id: '578', label: '578 Bacon / Breakfast' }
  ];
  const LABEL = {};
  SETS.forEach(function (s) { LABEL[s.id] = s.label; });

  const LINES = [
    ['rear_bracket', 'Flat shelves, rear bracket', 'Rear bracket on the shelf. The tray clips over it.'],
    ['no_bracket', 'Flat shelves, no rear bracket', 'This shelf uses the clamp and J-channel.'],
    ['grid', 'Grid pushers', ''],
    ['slanted', 'Slanted meat shelves', ''],
    ['bunker', 'In a bunker', ''],
    ['absent', 'Not in this store', '']
  ];
  const LINE_TEXT = {};
  LINES.forEach(function (l) { LINE_TEXT[l[0]] = l[1]; });

  const EXAMPLES = {
    '556': { text: 'Flat shelves, rear bracket' },
    '559': { text: 'Flat shelves, no rear bracket', measures: '6 shelves, 4 ft wide, 22 in deep' },
    '570': { text: 'Slanted meat shelves' },
    '575': { text: 'Flat shelves, rear bracket' },
    '578': { text: 'Flat shelves, rear bracket' }
  };
  const PACKET = {
    '559': ['heat.jpg', '559 Heat & Serve after installation'],
    '570': ['hotdogs.jpg', '575 Hot Dogs and 570 Smoked Dinner Sausage after installation'],
    '575': ['hotdogs.jpg', '575 Hot Dogs and 570 Smoked Dinner Sausage after installation'],
    '578': ['breakfast.jpg', '578 Bacon / Breakfast after installation']
  };

  const CAMERA = '<svg viewBox="0 0 24 24" fill="none" stroke="#0B2545" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 8h3l2-3h6l2 3h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z"/><circle cx="12" cy="13" r="3.5"/></svg>';

  const app = document.getElementById('app');
  const nav = document.getElementById('nav');
  const navBack = document.getElementById('navBack');
  const navNext = document.getElementById('navNext');
  const prog = document.getElementById('prog');
  const progBar = document.getElementById('progBar');
  const where = document.getElementById('where');
  const lightbox = document.getElementById('lightbox');
  const lightboxImg = document.getElementById('lightboxImg');

  const state = {
    token: '',
    screen: 'gate',
    stores: [],
    filter: '',
    number: '',
    info: null,
    step: 0,
    answers: {},
    comment: '',
    heldComment: '',
    pallet: null,
    sending: false,
    result: null
  };
  const gate = { mode: 'phone', stage: 'ident', identity: '', message: '', bad: false, busy: false };

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function todayPacific() {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(new Date());
  }

  function blankAnswer() {
    return {
      fixture: '', count: '', width: '', depth: '', notes: '',
      setFile: null, backFile: null,
      locked: false, lockedAnswer: '', lockedFixture: '', lockedNotes: '',
      saved: false
    };
  }

  function wireStore(info) {
    state.answers = {};
    SETS.forEach(function (s) { state.answers[s.id] = blankAnswer(); });
    ((info && info.sets) || []).forEach(function (set) {
      const a = state.answers[set.commodity];
      if (!a) return;
      a.locked = true;
      a.lockedAnswer = set.answer || LINE_TEXT[set.fixture] || '';
      a.lockedFixture = set.fixture || 'rear_bracket';
      a.lockedNotes = set.notes || '';
    });
    state.comment = '';
    state.heldComment = (info && info.comment) || '';
    state.pallet = null;
    state.result = null;
  }

  function firstOpenStep() {
    for (let i = 0; i < SETS.length; i++) {
      if (!state.answers[SETS[i].id].locked) return i;
    }
    return 0;
  }

  /* ---------- network ---------- */

  async function call(path, opts) {
    opts = opts || {};
    const headers = {};
    if (opts.body) headers['content-type'] = 'application/json';
    if (state.token && !opts.noAuth) headers.authorization = 'Bearer ' + state.token;
    let res;
    try {
      res = await fetch(API + path, {
        method: opts.method || 'GET',
        headers: headers,
        body: opts.body ? JSON.stringify(opts.body) : undefined
      });
    } catch (_) {
      throw new Error('No signal. Try again.');
    }
    if (res.status === 401 && state.token && !opts.noAuth) {
      signOut('Sign in again.');
      throw new Error('Sign in again.');
    }
    const data = await res.json().catch(function () { return {}; });
    if (!res.ok || data.ok === false) {
      throw new Error(data.error || 'Something went wrong. Try again.');
    }
    return data;
  }

  function fileToJpeg(file) {
    return new Promise(function (resolve, reject) {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = function () {
        const max = 1400;
        const scale = Math.min(1, max / Math.max(img.width, img.height));
        const w = Math.max(1, Math.round(img.width * scale));
        const h = Math.max(1, Math.round(img.height * scale));
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        URL.revokeObjectURL(url);
        canvas.toBlob(function (blob) {
          if (!blob) return reject(new Error('That photo could not be used. Take it again.'));
          const reader = new FileReader();
          reader.onload = function () { resolve(String(reader.result).split(',')[1]); };
          reader.onerror = function () { reject(new Error('That photo could not be used. Take it again.')); };
          reader.readAsDataURL(blob);
        }, 'image/jpeg', 0.8);
      };
      img.onerror = function () {
        URL.revokeObjectURL(url);
        reject(new Error('That photo could not be used. Take it again.'));
      };
      img.src = url;
    });
  }

  async function photo(file, slot) {
    if (!file) return null;
    return { slot: slot, mime: 'image/jpeg', data: await fileToJpeg(file) };
  }

  /* ---------- session ---------- */

  function tokenAlive(token) {
    try {
      const body = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
      return !body.exp || body.exp * 1000 > Date.now() + 60000;
    } catch (_) {
      return false;
    }
  }

  function saveToken(token) {
    state.token = token;
    try { localStorage.setItem(TOKEN_KEY, token); } catch (_) { /* private mode */ }
  }

  function signOut(message) {
    state.token = '';
    try { localStorage.removeItem(TOKEN_KEY); } catch (_) { /* private mode */ }
    gate.stage = 'ident';
    gate.message = message || '';
    gate.bad = !!message;
    go('gate');
  }

  /* ---------- chrome ---------- */

  function setChrome(opts) {
    prog.hidden = opts.progress == null;
    if (opts.progress != null) progBar.style.width = Math.round(opts.progress * 100) + '%';
    where.textContent = opts.where || '';
    nav.hidden = !opts.nav;
    app.classList.toggle('no-nav', !opts.nav);
    if (opts.nav) {
      navBack.textContent = opts.back || 'Back';
      navNext.textContent = opts.next || 'Next';
      navNext.disabled = !!opts.nextDisabled;
      navBack.disabled = false;
      navBack.hidden = opts.noBack === true;
    }
  }

  let onNext = null;
  let onBack = null;
  navNext.addEventListener('click', function () { if (onNext) onNext(); });
  navBack.addEventListener('click', function () { if (onBack) onBack(); });

  function go(screen) {
    state.screen = screen;
    render();
    window.scrollTo(0, 0);
  }

  function openLightbox(src, alt) {
    lightboxImg.src = src;
    lightboxImg.alt = alt || '';
    lightbox.hidden = false;
  }
  lightbox.addEventListener('click', function () { lightbox.hidden = true; lightboxImg.removeAttribute('src'); });

  function bindZoom(root) {
    root.querySelectorAll('[data-zoom]').forEach(function (el) {
      el.addEventListener('click', function () { openLightbox(el.getAttribute('data-zoom'), el.getAttribute('data-alt')); });
    });
  }

  /* ---------- screens ---------- */

  function render() {
    onNext = null;
    onBack = null;
    if (state.screen === 'gate') return renderGate();
    if (state.screen === 'stores') return renderStores();
    if (state.screen === 'intro') return renderIntro();
    if (state.screen === 'set') return renderSet();
    if (state.screen === 'extra') return renderExtra();
    if (state.screen === 'review') return renderReview();
    if (state.screen === 'done') return renderDone();
    return undefined;
  }

  /* gate */

  function renderGate() {
    setChrome({ nav: false });
    const phone = gate.mode === 'phone';
    if (gate.stage === 'ident') {
      app.innerHTML =
        '<div class="screen">' +
          '<h1 class="title">Sign in</h1>' +
          '<div class="seg" id="seg">' +
            '<button type="button" data-mode="phone" class="' + (phone ? 'on' : '') + '">Phone</button>' +
            '<button type="button" data-mode="email" class="' + (phone ? '' : 'on') + '">Email</button>' +
          '</div>' +
          '<label class="field">' + (phone ? 'Mobile number' : 'Email address') +
            '<input id="identity" ' + (phone
              ? 'type="tel" inputmode="tel" autocomplete="tel" placeholder="(555) 555-5555"'
              : 'type="email" inputmode="email" autocomplete="email" autocapitalize="none" spellcheck="false" placeholder="you@example.com"') +
            ' value="' + esc(gate.identity) + '"></label>' +
          '<label class="hp" aria-hidden="true">Website <input id="website" tabindex="-1" autocomplete="off"></label>' +
          '<button type="button" class="btn" id="sendCode">' + (phone ? 'Text me a code' : 'Email me a code') + '</button>' +
          '<p class="status' + (gate.bad ? ' bad' : '') + '" role="status" id="gateMsg">' + esc(gate.message) + '</p>' +
        '</div>';
      app.querySelectorAll('#seg button').forEach(function (b) {
        b.addEventListener('click', function () {
          gate.mode = b.getAttribute('data-mode');
          gate.identity = '';
          gate.message = '';
          gate.bad = false;
          renderGate();
        });
      });
      document.getElementById('sendCode').addEventListener('click', sendCode);
      document.getElementById('identity').addEventListener('keydown', function (ev) {
        if (ev.key === 'Enter') sendCode();
      });
      return;
    }
    app.innerHTML =
      '<div class="screen">' +
        '<h1 class="title">Enter your code</h1>' +
        '<p class="lede">Sent to ' + esc(gate.identity) + '.</p>' +
        '<label class="field">6-digit code' +
          '<input id="code" class="code-input" type="text" inputmode="numeric" autocomplete="one-time-code" maxlength="8" pattern="[0-9]*"></label>' +
        '<button type="button" class="btn" id="checkCode">Continue</button>' +
        '<p class="status' + (gate.bad ? ' bad' : '') + '" role="status" id="gateMsg">' + esc(gate.message) + '</p>' +
        '<button type="button" class="link" id="again">Use a different ' + (phone ? 'number' : 'email') + '</button>' +
      '</div>';
    document.getElementById('checkCode').addEventListener('click', checkCode);
    document.getElementById('code').addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter') checkCode();
    });
    document.getElementById('again').addEventListener('click', function () {
      gate.stage = 'ident';
      gate.message = '';
      gate.bad = false;
      renderGate();
    });
    document.getElementById('code').focus();
  }

  async function sendCode() {
    if (gate.busy) return;
    const input = document.getElementById('identity');
    const msg = document.getElementById('gateMsg');
    const btn = document.getElementById('sendCode');
    gate.identity = input.value.trim();
    if (!gate.identity) {
      msg.textContent = gate.mode === 'phone' ? 'Enter your mobile number.' : 'Enter your email address.';
      msg.className = 'status bad';
      return;
    }
    gate.busy = true;
    btn.disabled = true;
    msg.className = 'status';
    msg.textContent = 'Sending the code.';
    try {
      await call('/start', {
        method: 'POST',
        noAuth: true,
        body: { identity: gate.identity, website: document.getElementById('website').value }
      });
      gate.stage = 'code';
      gate.message = '';
      gate.bad = false;
      renderGate();
    } catch (err) {
      msg.textContent = err.message;
      msg.className = 'status bad';
      btn.disabled = false;
    } finally {
      gate.busy = false;
    }
  }

  async function checkCode() {
    if (gate.busy) return;
    const code = document.getElementById('code').value.replace(/\D/g, '');
    const msg = document.getElementById('gateMsg');
    const btn = document.getElementById('checkCode');
    if (code.length < 4) {
      msg.textContent = 'Enter the code.';
      msg.className = 'status bad';
      return;
    }
    gate.busy = true;
    btn.disabled = true;
    msg.className = 'status';
    msg.textContent = 'Checking.';
    try {
      const data = await call('/verify', {
        method: 'POST',
        noAuth: true,
        body: { identity: gate.identity, code: code }
      });
      saveToken(data.token);
      await loadStores();
      gate.message = '';
      go('stores');
    } catch (err) {
      msg.textContent = err.message;
      msg.className = 'status bad';
      btn.disabled = false;
    } finally {
      gate.busy = false;
    }
  }

  /* stores */

  async function loadStores() {
    const data = await call('/stores');
    state.stores = data.stores || [];
  }

  function renderStores() {
    setChrome({ nav: false });
    app.innerHTML =
      '<div class="screen">' +
        '<p class="hold">Do not install pushers on this visit. The install is on hold.</p>' +
        '<h1 class="title">Pick your store</h1>' +
        '<input class="filter" id="filter" type="text" inputmode="numeric" pattern="[0-9]*" autocomplete="off" placeholder="Type your store number" value="' + esc(state.filter) + '">' +
        '<div class="legend">' +
          '<span><i class="chip"></i>Not started</span>' +
          '<span><i class="chip revisit"></i>Partly done</span>' +
          '<span><i class="chip done"></i>Done</span>' +
        '</div>' +
        '<div class="grid" id="grid"></div>' +
        '<p class="status bad" role="status" id="storeMsg"></p>' +
        '<button type="button" class="link" id="signOut">Sign out</button>' +
      '</div>';
    paintGrid();
    document.getElementById('filter').addEventListener('input', function (ev) {
      state.filter = ev.target.value.replace(/\D/g, '');
      paintGrid();
    });
    document.getElementById('signOut').addEventListener('click', function () { signOut(''); });
  }

  function paintGrid() {
    const grid = document.getElementById('grid');
    if (!grid) return;
    const rows = state.stores.filter(function (s) {
      return !state.filter || String(s.number).indexOf(state.filter) === 0;
    });
    if (!rows.length) {
      grid.innerHTML = '<p class="none" style="grid-column:1/-1">No store with that number.</p>';
      return;
    }
    grid.innerHTML = rows.map(function (s) {
      const word = s.status === 'done' ? 'done' : s.status === 'revisit' ? 'partly done' : 'not started';
      return '<button type="button" class="store ' + esc(s.status) + '" data-n="' + esc(s.number) + '" aria-label="Store ' + esc(s.number) + ', ' + word + '">' +
        esc(s.number) + (s.status === 'revisit' ? '<i class="dot"></i>' : '') + '</button>';
    }).join('');
    grid.querySelectorAll('.store').forEach(function (b) {
      b.addEventListener('click', function () { pickStore(b.getAttribute('data-n')); });
    });
  }

  async function pickStore(number) {
    const msg = document.getElementById('storeMsg') || document.createElement('p');
    msg.textContent = 'Opening store ' + number + '.';
    msg.className = 'status';
    try {
      const data = await call('/stores/' + encodeURIComponent(number));
      state.number = String(number);
      state.info = data.store;
      wireStore(data.store);
      state.step = firstOpenStep();
      if (data.store.status === 'open') {
        go('set');
      } else {
        go('intro');
      }
    } catch (err) {
      msg.textContent = err.message;
      msg.className = 'status bad';
    }
  }

  /* intro for done / partly done stores */

  function renderIntro() {
    setChrome({ nav: false, where: 'Store ' + state.number });
    const info = state.info || {};
    let note;
    if (info.status === 'done') {
      note = '<p class="note">Store ' + esc(state.number) + ' is already done. You can add more. The answers already there stay.</p>';
    } else {
      const names = (info.missing || []).map(function (id) { return LABEL[id] || id; });
      note = '<p class="note revisit">Store ' + esc(state.number) + ' is partly done. It needs to be revisited.' +
        (names.length ? ' Still open: ' + esc(names.join(', ')) + '.' : '') + '</p>';
    }
    app.innerHTML =
      '<div class="screen">' +
        '<h1 class="title">Store ' + esc(state.number) + '</h1>' +
        note +
        '<button type="button" class="btn" id="goOn">' + (info.status === 'done' ? 'Add details' : 'Continue') + '</button>' +
        '<button type="button" class="btn alt" id="other">Pick a different store</button>' +
      '</div>';
    document.getElementById('goOn').addEventListener('click', function () {
      state.step = info.status === 'done' ? 0 : firstOpenStep();
      go('set');
    });
    document.getElementById('other').addEventListener('click', function () { go('stores'); });
  }

  /* one question per screen */

  function exampleBlock(set) {
    const ex = EXAMPLES[set.id];
    const packet = PACKET[set.id];
    return '<div class="ex">' +
      '<div class="ex-head"><span class="badge">EXAMPLE</span><span class="ex-answer">' + esc(ex.text) +
        (ex.measures ? ' &middot; ' + esc(ex.measures) : '') + '</span></div>' +
      '<div class="ex-photos">' +
        '<figure><button type="button" data-zoom="' + ASSETS + 'ex/' + set.id + '-set.jpg?v=1" data-alt="Example, whole set">' +
          '<img src="' + ASSETS + 'ex/' + set.id + '-set.jpg?v=1" alt="Example, whole set" loading="lazy"></button>' +
          '<figcaption>Photo 1: whole set</figcaption></figure>' +
        '<figure><button type="button" data-zoom="' + ASSETS + 'ex/' + set.id + '-shelf.jpg?v=1" data-alt="Example, shelf back">' +
          '<img src="' + ASSETS + 'ex/' + set.id + '-shelf.jpg?v=1" alt="Example, shelf back" loading="lazy"></button>' +
          '<figcaption>Photo 2: shelf back</figcaption></figure>' +
      '</div>' +
      '<details class="more"><summary>The two shelf types</summary>' +
        '<img src="' + ASSETS + 'ref/bracket.jpg?v=1" alt="Tray clipped over a rear shelf bracket">' +
        '<p>Rear bracket on the shelf. The tray clips over it.</p>' +
        '<img src="' + ASSETS + 'ref/no-bracket.jpg?v=1" alt="Shelf clamp and J-channel for a shelf with no rear bracket">' +
        '<p>No rear bracket. This shelf uses the clamp and J-channel.</p>' +
      '</details>' +
      (packet
        ? '<details class="more"><summary>What it looks like when installed</summary>' +
          '<img src="' + ASSETS + 'ref/' + packet[0] + '?v=1" alt="' + esc(packet[1]) + '"><p>' + esc(packet[1]) + '</p></details>'
        : '') +
    '</div>';
  }

  function shotLabel(slot, file, existing) {
    const title = slot === 'set' ? 'Photo 1: whole set' : 'Photo 2: shelf back';
    return '<label class="shot' + (file ? ' has' : '') + '" data-slot="' + slot + '">' +
      '<input type="file" accept="image/*" capture="environment">' +
      CAMERA +
      '<span class="t">' + (file ? 'Retake ' + (slot === 'set' ? 'whole set' : 'shelf back') : title) +
        '<small>' + (file ? 'Photo ready' : existing ? 'Add another' : 'Tap to take') + '</small></span>' +
      (file ? '<img alt="">' : '') +
    '</label>';
  }

  function bindShots(root, getFile, setFile) {
    root.querySelectorAll('.shot').forEach(function (label) {
      const slot = label.getAttribute('data-slot');
      const file = getFile(slot);
      if (file) {
        const img = label.querySelector('img');
        if (img) img.src = URL.createObjectURL(file);
      }
      label.querySelector('input').addEventListener('change', function (ev) {
        const f = ev.target.files && ev.target.files[0];
        if (!f) return;
        setFile(slot, f);
        const holder = label.parentNode;
        const id = holder.getAttribute('data-for');
        if (id === 'pallet') {
          renderExtra(true);
        } else {
          renderSet(true);
        }
      });
    });
  }

  function renderSet(keepScroll) {
    const y = window.scrollY;
    const set = SETS[state.step];
    const a = state.answers[set.id];
    const last = state.step === SETS.length - 1;
    const hasWork = a.locked ? (a.notes || a.setFile || a.backFile) : a.fixture;
    setChrome({
      nav: true,
      progress: state.step / (SETS.length + 1),
      where: 'Store ' + state.number,
      back: state.step === 0 ? 'Stores' : 'Back',
      next: hasWork ? 'Next' : (a.locked ? 'Next' : 'Skip for now')
    });

    let body = '<p class="kicker">Question ' + (state.step + 1) + ' of ' + SETS.length + '</p>' +
      '<h1 class="title">' + esc(set.label) + '</h1>' +
      exampleBlock(set);

    if (a.locked) {
      body += '<div class="locked"><span class="t">Already answered</span><span class="a">' + esc(a.lockedAnswer) + '</span>' +
        (a.lockedNotes ? '<span>' + esc(a.lockedNotes) + '</span>' : '') + '</div>' +
        '<div class="card"><h2 class="step-label">Add photos</h2>' +
          '<div class="shots" data-for="set">' + shotLabel('set', a.setFile, true) + shotLabel('back', a.backFile, true) + '</div></div>' +
        '<label class="field">Add a detail (optional)<input id="notes" type="text" value="' + esc(a.notes) + '"></label>';
    } else {
      body += '<div class="card"><h2 class="step-label">1. Pick the one that matches</h2><div class="opts" id="opts">' +
        LINES.map(function (l) {
          return '<label class="opt' + (a.fixture === l[0] ? ' on' : '') + '"><input type="radio" name="fx" value="' + l[0] + '"' +
            (a.fixture === l[0] ? ' checked' : '') + '><span class="tick"></span><span>' + esc(l[1]) +
            (l[2] ? '<small>' + esc(l[2]) + '</small>' : '') + '</span></label>';
        }).join('') + '</div>' +
        '<div class="measures" id="measures"' + (a.fixture === 'no_bracket' ? '' : ' hidden') + '>' +
          '<label class="field">How many shelves?<input id="count" type="text" inputmode="numeric" pattern="[0-9]*" placeholder="6" value="' + esc(a.count) + '"></label>' +
          '<label class="field">How wide?<input id="width" type="text" placeholder="4 ft" value="' + esc(a.width) + '"></label>' +
          '<label class="field">How deep?<input id="depth" type="text" placeholder="22 in" value="' + esc(a.depth) + '"></label>' +
        '</div></div>' +
        '<div class="card" id="photos"' + (a.fixture === '' || a.fixture === 'absent' ? ' hidden' : '') + '><h2 class="step-label">2. Take 2 photos</h2>' +
          '<div class="shots" data-for="set">' + shotLabel('set', a.setFile) + shotLabel('back', a.backFile) + '</div></div>' +
        '<label class="field">3. Anything else? (optional)<input id="notes" type="text" value="' + esc(a.notes) + '"></label>';
    }
    app.innerHTML = '<div class="screen" id="stepBody">' + body + '</div><p class="status bad" role="status" id="stepMsg"></p>';
    bindZoom(app);

    const notes = document.getElementById('notes');
    notes.addEventListener('input', function () { a.notes = notes.value; });

    if (!a.locked) {
      app.querySelectorAll('input[name="fx"]').forEach(function (r) {
        r.addEventListener('change', function () {
          a.fixture = r.value;
          app.querySelectorAll('.opt').forEach(function (o) { o.classList.toggle('on', o.querySelector('input').checked); });
          document.getElementById('measures').hidden = a.fixture !== 'no_bracket';
          document.getElementById('photos').hidden = a.fixture === 'absent';
          navNext.textContent = 'Next';
        });
      });
      ['count', 'width', 'depth'].forEach(function (k) {
        const el = document.getElementById(k);
        el.addEventListener('input', function () { a[k] = el.value; });
      });
    }

    bindShots(app, function (slot) { return slot === 'set' ? a.setFile : a.backFile; }, function (slot, f) {
      if (slot === 'set') a.setFile = f; else a.backFile = f;
    });

    onBack = function () {
      if (state.step === 0) { go('stores'); return; }
      state.step -= 1;
      renderSet();
      window.scrollTo(0, 0);
    };
    onNext = function () {
      if (!a.locked && a.fixture === 'no_bracket') {
        const msg = document.getElementById('stepMsg');
        if (!String(a.count).trim() || !String(a.width).trim() || !String(a.depth).trim()) {
          msg.textContent = 'Fill in how many shelves, how wide, and how deep.';
          document.getElementById('measures').scrollIntoView({ block: 'center' });
          return;
        }
      }
      if (last) { go('extra'); return; }
      state.step += 1;
      renderSet();
      window.scrollTo(0, 0);
    };
    if (keepScroll) window.scrollTo(0, y);
  }

  /* pallets and comment */

  function renderExtra(keepScroll) {
    const y = window.scrollY;
    setChrome({
      nav: true,
      progress: SETS.length / (SETS.length + 1),
      where: 'Store ' + state.number,
      next: 'Review'
    });
    app.innerHTML =
      '<div class="screen">' +
        '<p class="kicker">Last step</p>' +
        '<h1 class="title">Pallets and comment</h1>' +
        '<div class="ex"><div class="ex-head"><span class="badge">EXAMPLE</span><span class="ex-answer">Pallets look like this</span></div>' +
          '<div class="ex-photos">' +
            '<figure><button type="button" data-zoom="' + ASSETS + 'ref/pallet-a.jpg?v=1" data-alt="Wrapped pusher pallet"><img src="' + ASSETS + 'ref/pallet-a.jpg?v=1" alt="Wrapped pusher pallet" loading="lazy"></button></figure>' +
            '<figure><button type="button" data-zoom="' + ASSETS + 'ref/pallet-b.jpg?v=1" data-alt="Second wrapped pusher pallet"><img src="' + ASSETS + 'ref/pallet-b.jpg?v=1" alt="Second wrapped pusher pallet" loading="lazy"></button></figure>' +
          '</div></div>' +
        '<div class="card"><h2 class="step-label">1. Pallet or cases, if they are in the store</h2>' +
          '<div class="shots" data-for="pallet">' +
            '<label class="shot' + (state.pallet ? ' has' : '') + '" data-slot="pallet"><input type="file" accept="image/*" capture="environment">' + CAMERA +
            '<span class="t">' + (state.pallet ? 'Retake pallet photo' : 'Pallet photo') + '<small>' + (state.pallet ? 'Photo ready' : 'Tap to take') + '</small></span>' +
            (state.pallet ? '<img alt="">' : '') + '</label>' +
          '</div></div>' +
        (state.heldComment ? '<div class="locked"><span class="t">Comment on file</span><span class="a">' + esc(state.heldComment) + '</span></div>' : '') +
        '<label class="field">2. ' + (state.heldComment ? 'Add a detail' : 'Comment') + ' (optional)<textarea id="comment" rows="3">' + esc(state.comment) + '</textarea></label>' +
      '</div>';
    bindZoom(app);
    const comment = document.getElementById('comment');
    comment.addEventListener('input', function () { state.comment = comment.value; });
    bindShots(app, function () { return state.pallet; }, function (_slot, f) { state.pallet = f; });
    onBack = function () { state.step = SETS.length - 1; go('set'); };
    onNext = function () { go('review'); };
    if (keepScroll) window.scrollTo(0, y);
  }

  /* review and send */

  function pending() {
    const jobs = [];
    SETS.forEach(function (s) {
      const a = state.answers[s.id];
      if (a.saved) return;
      if (a.locked) {
        if (a.notes.trim() || a.setFile || a.backFile) jobs.push({ id: s.id, kind: 'locked' });
      } else if (a.fixture) {
        jobs.push({ id: s.id, kind: 'new' });
      }
    });
    return jobs;
  }

  function openNames() {
    return SETS.filter(function (s) {
      const a = state.answers[s.id];
      return !a.locked && !a.fixture;
    }).map(function (s) { return s.label; });
  }

  function renderReview() {
    setChrome({
      nav: true,
      progress: 1,
      where: 'Store ' + state.number,
      next: 'Send',
      nextDisabled: false
    });
    const open = openNames();
    const rows = SETS.map(function (s) {
      const a = state.answers[s.id];
      const pics = (a.setFile ? 1 : 0) + (a.backFile ? 1 : 0);
      let line;
      if (a.locked) {
        line = '<span>' + esc(a.lockedAnswer) + ' (already on file)</span>' +
          (a.notes.trim() ? '<span>Detail: ' + esc(a.notes) + '</span>' : '') +
          (pics ? '<span>' + pics + ' new photo' + (pics > 1 ? 's' : '') + '</span>' : '');
      } else if (a.fixture) {
        let text = LINE_TEXT[a.fixture];
        if (a.fixture === 'no_bracket') text += ', ' + a.count + ' shelves, ' + a.width + ' wide, ' + a.depth + ' deep';
        line = '<span>' + esc(text) + '</span>' + (a.fixture === 'absent' ? '' : '<span>' + pics + ' of 2 photos</span>');
      } else {
        line = '<span class="skip">Skipped. This store will need a revisit.</span>';
      }
      return '<div class="sum-row"><b>' + esc(s.label) + '</b>' + line + '</div>';
    }).join('');
    app.innerHTML =
      '<div class="screen">' +
        '<h1 class="title">Check and send</h1>' +
        '<div class="card sum">' + rows +
          '<div class="sum-row"><b>Pallet photo</b><span>' + (state.pallet ? '1 photo' : 'None') + '</span></div>' +
          '<div class="sum-row"><b>Comment</b><span>' + (state.comment.trim() ? esc(state.comment) : 'None') + '</span></div>' +
        '</div>' +
        (open.length ? '<p class="note revisit">Not answered: ' + esc(open.join(', ')) + '. Store ' + esc(state.number) + ' will show as needing a revisit.</p>' : '') +
        '<p class="status" role="status" id="sendMsg"></p>' +
      '</div>';
    onBack = function () { go('extra'); };
    onNext = send;
  }

  async function send() {
    if (state.sending) return;
    const msg = document.getElementById('sendMsg');
    const jobs = pending();
    const wantsExtra = !!(state.pallet || state.comment.trim());
    if (!jobs.length && !wantsExtra) {
      msg.textContent = 'Add an answer, a photo, or a comment first.';
      msg.className = 'status bad';
      return;
    }
    state.sending = true;
    navNext.disabled = true;
    navBack.disabled = true;
    const total = jobs.length + (wantsExtra ? 1 : 0);
    let n = 0;
    try {
      for (let i = 0; i < jobs.length; i++) {
        n += 1;
        msg.className = 'status';
        msg.textContent = 'Sending ' + n + ' of ' + total + '.';
        const a = state.answers[jobs[i].id];
        const photos = [];
        if (a.fixture !== 'absent') {
          const p1 = await photo(a.setFile, 'set');
          const p2 = await photo(a.backFile, 'shelf_back');
          if (p1) photos.push(p1);
          if (p2) photos.push(p2);
        }
        const locked = jobs[i].kind === 'locked';
        await call('/report', {
          method: 'POST',
          body: {
            store: state.number,
            reportedOn: todayPacific(),
            sets: [{
              commodity: jobs[i].id,
              fixture: locked ? a.lockedFixture : a.fixture,
              shelfCount: locked ? '' : a.count,
              width: locked ? '' : a.width,
              depth: locked ? '' : a.depth,
              notes: a.notes,
              photos: photos
            }]
          }
        });
        a.saved = true;
      }
      if (wantsExtra) {
        n += 1;
        msg.className = 'status';
        msg.textContent = 'Sending ' + n + ' of ' + total + '.';
        const extra = [];
        const pal = await photo(state.pallet, 'pallet');
        if (pal) extra.push(pal);
        await call('/report', {
          method: 'POST',
          body: {
            store: state.number,
            reportedOn: todayPacific(),
            comment: state.comment,
            sets: [],
            palletPhotos: extra
          }
        });
        state.pallet = null;
        state.heldComment = state.heldComment || state.comment;
        state.comment = '';
      }
      state.result = { open: openNames() };
      try { await loadStores(); } catch (_) { /* list refresh is not critical */ }
      go('done');
    } catch (err) {
      msg.className = 'status bad';
      msg.textContent = err.message + ' Tap Send to try again. Nothing is sent twice.';
      navNext.disabled = false;
      navBack.disabled = false;
    } finally {
      state.sending = false;
    }
  }

  function renderDone() {
    setChrome({ nav: false });
    const open = (state.result && state.result.open) || [];
    app.innerHTML =
      '<div class="screen center">' +
        '<div class="big-check"></div>' +
        '<h1 class="title">Store ' + esc(state.number) + ' saved</h1>' +
        (open.length
          ? '<p class="note revisit" style="text-align:left">Needs a revisit. Still open: ' + esc(open.join(', ')) + '.</p>'
          : '<p class="note good" style="text-align:left">Every set is answered.</p>') +
        '<button type="button" class="btn yellow" id="nextStore">Pick the next store</button>' +
        '<button type="button" class="btn alt" id="sameStore">Add more to store ' + esc(state.number) + '</button>' +
      '</div>';
    document.getElementById('nextStore').addEventListener('click', function () { state.filter = ''; go('stores'); });
    document.getElementById('sameStore').addEventListener('click', function () { pickStore(state.number).then(function () {}); });
  }

  /* start */

  (function boot() {
    let token = '';
    try { token = localStorage.getItem(TOKEN_KEY) || ''; } catch (_) { token = ''; }
    if (token && tokenAlive(token)) {
      state.token = token;
      loadStores().then(function () { go('stores'); }).catch(function () { go('gate'); });
      setChrome({ nav: false });
      app.innerHTML = '<p class="status">Loading.</p>';
      return;
    }
    go('gate');
  })();
})();
