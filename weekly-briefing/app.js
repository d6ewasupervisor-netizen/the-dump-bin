/*
 * Weekly Briefing — Store Walk player
 * ----------------------------------
 * One player, one content pack per week (packs/<WEEK>/pack.json).
 * Identity comes from the hub session (auth-gate.js → /api/me).
 * Results go to eod-api (/api/weekly-briefing/*). Progress is kept in
 * localStorage and mirrored to the API so a walk can resume on any device.
 */
(function () {
  'use strict';

  var PACKS_BASE = './packs/';
  var API = '/api/weekly-briefing';
  // ?pack=_staging/P10W3 → preview a staging build: same walk, nothing is
  // sent to the API (no attempts, no crew pulse) and local state is kept apart.
  var PREVIEW_PACK = (function () {
    try {
      var v = new URLSearchParams(location.search).get('pack') || '';
      return /^[A-Za-z0-9_\/-]{1,40}$/.test(v) ? v.replace(/^\/+|\/+$/g, '') : '';
    } catch (_) { return ''; }
  })();
  var SPEEDS = [1, 1.25, 1.5];
  var READ_WPS = 4;            // words per second the "Read instead" timer assumes
  var READ_MIN_S = 8;
  var MAX_TRIES = 2;

  var $ = function (id) { return document.getElementById(id); };
  var screens = {};
  Array.prototype.forEach.call(document.querySelectorAll('.screen'), function (el) {
    screens[el.getAttribute('data-screen')] = el;
  });

  var me = null;          // { email, name, roles }
  var pack = null;        // pack.json
  // Pack asset URL with a cache-buster tied to the pack's build stamp, so a
  // re-cut pack (new narration, same paths) can't serve stale clips/frames.
  var packPath = '';      // packs/<packPath>/ — the week, or _staging/<week> in preview
  function assetUrl(rel) {
    return PACKS_BASE + (packPath || pack.week) + '/' + rel + (pack.build ? '?b=' + encodeURIComponent(pack.build) : '');
  }
  var userKey = '';       // storage key fragment
  var st = null;          // attempt state (see newState)
  var flat = [];          // walk order: [{kind:'stop', n} | {kind:'q', n, qi, q}]
  var audio = $('audio');
  var speedIx = 0;
  var readTimer = null;
  var readStart = 0;
  var readNeed = 0;
  var syncTimer = null;

  // ---------- helpers ----------
  function show(name) {
    Object.keys(screens).forEach(function (k) { screens[k].classList.toggle('is-active', k === name); });
    window.scrollTo(0, 0);
  }
  function fmtTime(s) {
    s = Math.max(0, Math.round(s || 0));
    return Math.floor(s / 60) + ':' + ('0' + (s % 60)).slice(-2);
  }
  function fmtDue(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    var day = d.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
    var time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    return day + ' · ' + time;
  }
  function vibrate(p) { try { if (navigator.vibrate) navigator.vibrate(p); } catch (_) {} }
  function toast(msg, ms) {
    var el = document.createElement('div');
    el.className = 'toast'; el.textContent = msg;
    document.body.appendChild(el);
    setTimeout(function () { el.remove(); }, ms || 1800);
  }
  function api(path, opts) {
    opts = opts || {};
    if (PREVIEW_PACK) {
      return Promise.reject(Object.assign(new Error('preview: API disabled'), { status: 0 }));
    }
    if (opts.body && typeof opts.body !== 'string') {
      opts.body = JSON.stringify(opts.body);
      opts.headers = Object.assign({ 'Content-Type': 'application/json' }, opts.headers || {});
    }
    return window.dumpBinAuthFetch(API + path, opts).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (data) {
        if (!res.ok) { var e = new Error(data.error || ('HTTP ' + res.status)); e.status = res.status; throw e; }
        return data;
      });
    });
  }
  function storeKey() { return 'wb:' + (PREVIEW_PACK ? 'preview:' + PREVIEW_PACK : pack.week) + ':' + userKey; }
  function loadLocal() {
    try { var v = localStorage.getItem(storeKey()); return v ? JSON.parse(v) : null; } catch (_) { return null; }
  }
  function saveLocal() {
    try { localStorage.setItem(storeKey(), JSON.stringify(st)); } catch (_) {}
  }

  // ---------- state ----------
  function newState(attempt) {
    return {
      attemptId: attempt && attempt.id || null,
      callsign: attempt && attempt.callsign || null,
      startedAt: Date.now(),
      pos: 0,                    // index into flat[]
      unlocked: {},              // stopId -> true
      answers: {},               // qid -> { first: bool, tries: n, done: bool, picked: idx }
      elapsed: 0,                // active seconds
      finishedAt: null,
      score: null,
      passed: null,
      version: 1,
    };
  }
  function buildFlat() {
    flat = [];
    pack.stops.forEach(function (s) {
      flat.push({ kind: 'stop', n: s.n, stop: s });
      (s.checkpoint || []).forEach(function (q, qi) {
        flat.push({ kind: 'q', n: s.n, stop: s, qi: qi, q: q });
      });
    });
  }
  function questionCount() { return flat.filter(function (f) { return f.kind === 'q'; }).length; }
  function questionIndex(item) {
    var i = 0;
    for (var k = 0; k < flat.length; k++) {
      if (flat[k].kind !== 'q') continue;
      i++;
      if (flat[k] === item) return i;
    }
    return i;
  }
  function sectionOf(n) {
    var secs = pack.sections || [];
    for (var i = 0; i < secs.length; i++) if (secs[i].stops.indexOf(n) !== -1) return secs[i];
    return null;
  }
  function computeScore() {
    var total = 0, first = 0, retries = 0;
    flat.forEach(function (f) {
      if (f.kind !== 'q') return;
      total++;
      var a = st.answers[f.q.id];
      if (a && a.first) first++;
      if (a && a.tries > 1) retries++;
    });
    return { total: total, first: first, retries: retries, pct: total ? Math.round(first / total * 100) : 0 };
  }
  function elapsedNow() {
    return st.elapsed + (st._tick ? Math.round((Date.now() - st._tick) / 1000) : 0);
  }
  function tickStart() { st._tick = Date.now(); }
  function tickStop() {
    if (st._tick) { st.elapsed += Math.round((Date.now() - st._tick) / 1000); st._tick = null; }
  }

  // ---------- sync ----------
  function queueSync() {
    saveLocal();
    clearTimeout(syncTimer);
    syncTimer = setTimeout(pushProgress, 1200);
  }
  function pushProgress() {
    if (!st.attemptId) return Promise.resolve();
    var snap = Object.assign({}, st); delete snap._tick;
    return api('/attempts/' + st.attemptId + '/progress', {
      method: 'POST',
      body: { pos: st.pos, stopsDone: Object.keys(st.unlocked).length, elapsed: elapsedNow(), state: snap },
    }).catch(function () { /* offline is fine; local copy stands */ });
  }
  function packSnapshot() {
    var qs = [];
    pack.stops.forEach(function (s) {
      (s.checkpoint || []).forEach(function (q) { qs.push({ id: q.id, stop: s.n, stopTitle: s.title, q: q.q }); });
    });
    return { week: pack.week, title: pack.title, district: pack.district, dueAt: pack.dueAt, passPct: pack.passPct, board: pack.board, questions: qs };
  }

  // ---------- boot ----------
  function boot() {
    var ready = window.dumpBinAuthReady || Promise.resolve();
    ready.then(function () {
      return window.dumpBinAuthFetch('/api/me');
    }).then(function (res) {
      if (!res.ok) throw new Error('Could not confirm who you are.');
      return res.json();
    }).then(function (m) {
      me = m;
      userKey = String(m.email || 'anon').toLowerCase();
      if (PREVIEW_PACK) return { week: PREVIEW_PACK };
      return fetch(PACKS_BASE + 'current.json', { cache: 'no-store' }).then(function (r) { return r.json(); });
    }).then(function (cur) {
      packPath = cur.week;
      return fetch(PACKS_BASE + cur.week + '/pack.json', { cache: 'no-store' }).then(function (r) {
        if (!r.ok) throw new Error('This week\'s pack is missing.');
        return r.json();
      });
    }).then(function (p) {
      pack = p;
      if (PREVIEW_PACK) pack.title = String(pack.title || pack.week) + ' · preview';
      buildFlat();
      return api('/me?week=' + encodeURIComponent(pack.week)).catch(function () { return {}; });
    }).then(function (mine) {
      var local = loadLocal();
      var remote = mine && mine.inProgress && mine.inProgress.state;
      if (remote && (!local || (remote.pos || 0) > (local.pos || 0) || local.finishedAt)) {
        st = remote; st.attemptId = mine.inProgress.id; st.callsign = mine.inProgress.callsign;
      } else {
        st = local;
      }
      if (st) st._tick = null;
      renderEntrance(mine || {});
      show('entrance');
    }).catch(function (err) {
      $('loading-msg').textContent = err.message || 'Something went wrong loading the walk.';
      document.querySelector('[data-screen="loading"] .spinner').hidden = true;
    });
  }

  // ---------- Entrance ----------
  function renderEntrance(mine) {
    $('ent-title').textContent = pack.title;
    $('exit-title').textContent = pack.title;
    $('ent-stops').textContent = pack.stops.length;
    $('ent-questions').textContent = questionCount();
    $('ent-minutes').textContent = '~' + Math.max(1, Math.round((pack.totalSeconds + questionCount() * 12) / 60));
    $('ent-pass').textContent = pack.passPct;
    var due = $('ent-due');
    if (pack.dueAt) {
      var past = new Date(pack.dueAt).getTime() < Date.now();
      $('ent-due-text').textContent = (past ? 'Was due ' : 'Due ') + fmtDue(pack.dueAt);
      due.classList.toggle('is-past', past);
      due.hidden = false;
    } else {
      due.hidden = true;
    }

    var start = $('ent-start'), review = $('ent-review'), status = $('ent-status'), cs = $('ent-callsign');
    var best = mine && mine.best;
    review.hidden = true;
    cs.hidden = true;
    var inProgress = st && !st.finishedAt && (st.pos > 0 || Object.keys(st.unlocked || {}).length > 0);
    if (inProgress) {
      start.textContent = 'Resume · stop ' + flat[st.pos].n + ' of ' + pack.stops.length;
      if (st.callsign) { cs.innerHTML = 'Walking as <strong>' + esc(st.callsign) + '</strong>'; cs.hidden = false; }
    } else if (best && best.finishedAt) {
      start.textContent = 'Walk it again';
      review.hidden = false;
      status.textContent = 'Best so far: ' + best.scorePct + '% · ' + (best.passed ? 'complete' : 'not yet at ' + pack.passPct + '%');
    } else {
      start.textContent = 'Start the walk';
    }
    start.onclick = function () {
      if (inProgress) { resumeWalk(); return; }
      startWalk();
    };
    review.onclick = function () {
      if (st && st.finishedAt) { renderExit(); show('exit'); }
      else if (best) { loadBestAndShow(best); }
    };
  }
  function loadBestAndShow(best) {
    st = best.state || newState(null);
    st.finishedAt = best.finishedAt; st.score = best.scorePct; st.passed = best.passed;
    renderExit(); show('exit');
  }
  function startWalk() {
    $('ent-start').disabled = true;
    api('/attempts/start', { method: 'POST', body: { pack: packSnapshot() } }).then(function (a) {
      st = newState(a.attempt);
      saveLocal();
      if (st.callsign) toast('This week you\'re walking as ' + st.callsign, 2600);
      goTo(0, true);
    }).catch(function () {
      // Offline or API down: walk anyway, results sync when the API answers.
      st = newState(null);
      saveLocal();
      goTo(0, true);
    }).then(function () { $('ent-start').disabled = false; });
  }
  function resumeWalk() {
    if (!st.attemptId) {
      api('/attempts/start', { method: 'POST', body: { pack: packSnapshot() } }).then(function (a) {
        st.attemptId = a.attempt.id; st.callsign = st.callsign || a.attempt.callsign; queueSync();
      }).catch(function () {});
    }
    goTo(st.pos, true);
  }

  // ---------- navigation ----------
  function goTo(pos, fromGesture) {
    tickStop();
    st.pos = Math.max(0, Math.min(flat.length - 1, pos));
    var item = flat[st.pos];
    tickStart();
    if (item.kind === 'stop') renderStop(item, fromGesture);
    else renderQuestion(item);
    queueSync();
  }
  function advance() {
    if (st.pos + 1 >= flat.length) { finishWalk(); return; }
    goTo(st.pos + 1, true);
  }
  function previousStopPos(fromPos) {
    for (var i = fromPos - 1; i >= 0; i--) if (flat[i].kind === 'stop') return i;
    return 0;
  }

  // ---------- Stop ----------
  function renderRoute(currentN) {
    var el = $('route');
    var html = '<div class="route__track">';
    pack.stops.forEach(function (s) {
      var cls = 'route__seg';
      if (st.unlocked[s.id]) cls += ' is-done';
      if (s.n === currentN) cls += ' is-current';
      if (s.checkpoint && s.checkpoint.length) cls += ' has-cp';
      html += '<div class="' + cls + '" title="' + esc(s.title) + '"></div>';
    });
    html += '</div>';
    var sec = sectionOf(currentN);
    var done = Object.keys(st.unlocked).length;
    html += '<div class="route__labels"><span class="route__label"><strong>' + esc(sec ? sec.name : '') + '</strong></span>'
      + '<span class="route__label">' + done + ' of ' + pack.stops.length + ' stops heard</span></div>';
    el.innerHTML = html;
  }
  function renderStop(item, fromGesture) {
    var s = item.stop;
    show('stop');
    renderRoute(s.n);
    var sec = sectionOf(s.n);
    $('stop-section').textContent = sec ? sec.name : 'Stop';
    $('stop-title').textContent = s.title;
    $('stop-count').textContent = s.n + ' / ' + pack.stops.length;
    $('frame-img').src = assetUrl(s.frame);
    $('frame-img').alt = s.title;
    closeSheet();
    $('play-fill').classList.remove('is-read');

    // audio
    audio.pause();
    audio.src = assetUrl(s.audio);
    audio.playbackRate = SPEEDS[speedIx];
    audio.load();
    setPlayIcon(false);
    updateBar(0, s.seconds);
    var unlocked = !!st.unlocked[s.id];
    setNext(unlocked, item);
    if (fromGesture) {
      var p = audio.play();
      if (p && p.catch) p.catch(function () { /* autoplay blocked: user taps play */ });
    }
    // prefetch next frame + clip
    var nx = pack.stops[s.n]; // next stop (n is 1-based)
    if (nx) {
      var img = new Image(); img.src = assetUrl(nx.frame);
      try { fetch(assetUrl(nx.audio), { mode: 'same-origin' }).catch(function () {}); } catch (_) {}
    }
  }
  function currentStopItem() { var it = flat[st.pos]; return it && it.kind === 'stop' ? it : null; }
  function setNext(unlocked, item) {
    var btn = $('next-btn');
    var hasCp = item.stop.checkpoint && item.stop.checkpoint.length;
    var last = st.pos + 1 >= flat.length;
    btn.classList.toggle('btn--locked', !unlocked);
    btn.classList.toggle('btn--primary', unlocked);
    btn.disabled = !unlocked;
    if (!unlocked) {
      btn.innerHTML = lockSvg() + ' Listening…';
    } else if (hasCp) {
      btn.innerHTML = 'Checkpoint · ' + item.stop.checkpoint.length + ' question' + (item.stop.checkpoint.length > 1 ? 's' : '') + ' ' + arrowSvg();
    } else if (last) {
      btn.innerHTML = 'Finish the walk ' + arrowSvg();
    } else {
      btn.innerHTML = 'Next stop ' + arrowSvg();
    }
  }
  function unlockCurrent(how) {
    var it = currentStopItem();
    if (!it) return;
    if (!st.unlocked[it.stop.id]) {
      st.unlocked[it.stop.id] = true;
      vibrate(12);
      renderRoute(it.stop.n);
      queueSync();
    }
    setNext(true, it);
  }
  function setPlayIcon(playing) {
    $('play-icon').hidden = playing;
    $('pause-icon').hidden = !playing;
    $('play-btn').setAttribute('aria-label', playing ? 'Pause' : 'Play');
  }
  function updateBar(cur, dur) {
    var pct = dur ? Math.min(100, cur / dur * 100) : 0;
    $('play-fill').style.width = pct + '%';
    $('play-time').textContent = fmtTime(cur) + ' / ' + fmtTime(dur);
  }
  audio.addEventListener('play', function () { setPlayIcon(true); });
  audio.addEventListener('pause', function () { setPlayIcon(false); });
  audio.addEventListener('timeupdate', function () {
    var it = currentStopItem(); if (!it) return;
    updateBar(audio.currentTime, audio.duration || it.stop.seconds);
    if (audio.duration && audio.currentTime >= audio.duration - 0.6) unlockCurrent('audio');
  });
  audio.addEventListener('ended', function () { unlockCurrent('audio'); updateBar(audio.duration, audio.duration); });
  $('play-btn').addEventListener('click', function () {
    if (audio.paused) { var p = audio.play(); if (p && p.catch) p.catch(function () {}); }
    else audio.pause();
  });
  $('speed-btn').addEventListener('click', function () {
    speedIx = (speedIx + 1) % SPEEDS.length;
    audio.playbackRate = SPEEDS[speedIx];
    this.textContent = SPEEDS[speedIx] + '×';
  });
  // Scrub: backwards any time; forwards only once the stop is unlocked.
  (function () {
    var bar = $('play-bar');
    function seekFromEvent(ev) {
      var it = currentStopItem(); if (!it || !audio.duration) return;
      var r = bar.getBoundingClientRect();
      var x = (ev.touches ? ev.touches[0].clientX : ev.clientX) - r.left;
      var t = Math.max(0, Math.min(1, x / r.width)) * audio.duration;
      if (!st.unlocked[it.stop.id] && t > audio.currentTime + 1) { toast('Hear it through first.'); return; }
      audio.currentTime = t;
    }
    bar.addEventListener('click', seekFromEvent);
    bar.addEventListener('touchmove', function (ev) { seekFromEvent(ev); }, { passive: true });
  })();

  $('next-btn').addEventListener('click', function () {
    var it = currentStopItem(); if (!it) return;
    if (!st.unlocked[it.stop.id]) return;
    audio.pause();
    advance();
  });
  $('stop-back').addEventListener('click', function () {
    audio.pause();
    if (st.pos === 0) { tickStop(); saveLocal(); renderEntrance({}); show('entrance'); return; }
    goTo(previousStopPos(st.pos), false);
  });

  // Read instead
  $('read-btn').addEventListener('click', openSheet);
  function openSheet() {
    var it = currentStopItem(); if (!it) return;
    var s = it.stop;
    audio.pause();
    var unlocked = !!st.unlocked[s.id];
    var sheet = document.createElement('div');
    sheet.className = 'sheet'; sheet.id = 'sheet';
    sheet.innerHTML =
      '<div class="sheet__panel">' +
        '<div class="sheet__head"><h3>' + esc(s.title) + '</h3><button class="sheet__close" aria-label="Close">✕</button></div>' +
        '<div class="sheet__body">' + esc(s.narration).replace(/\n/g, '<br>') + '</div>' +
        '<div class="sheet__foot">' +
          '<svg class="readring" viewBox="0 0 26 26"><circle class="bg" cx="13" cy="13" r="10"/><circle class="fg" id="readring-fg" cx="13" cy="13" r="10" stroke-dasharray="62.8" stroke-dashoffset="62.8"/></svg>' +
          '<span id="read-msg">' + (unlocked ? 'This stop is already unlocked.' : 'Reading unlocks this stop in a moment.') + '</span>' +
        '</div>' +
      '</div>';
    document.body.appendChild(sheet);
    sheet.querySelector('.sheet__close').addEventListener('click', closeSheet);
    sheet.addEventListener('click', function (ev) { if (ev.target === sheet) closeSheet(); });
    $('play-fill').classList.add('is-read');
    if (!unlocked) {
      readNeed = Math.max(READ_MIN_S, Math.round(s.words / READ_WPS));
      readStart = Date.now();
      clearInterval(readTimer);
      readTimer = setInterval(function () {
        var t = (Date.now() - readStart) / 1000;
        var frac = Math.min(1, t / readNeed);
        var fg = $('readring-fg'); if (fg) fg.style.strokeDashoffset = String(62.8 * (1 - frac));
        if (frac >= 1) {
          clearInterval(readTimer);
          unlockCurrent('read');
          var m = $('read-msg'); if (m) m.textContent = 'Unlocked. Close this to move on.';
        }
      }, 250);
    } else {
      var fg = $('readring-fg'); if (fg) fg.style.strokeDashoffset = '0';
    }
  }
  function closeSheet() {
    clearInterval(readTimer);
    var sh = $('sheet'); if (sh) sh.remove();
  }

  // Lightbox
  $('frame-btn').addEventListener('click', function () {
    var it = currentStopItem(); if (!it) return;
    var lb = document.createElement('div');
    lb.className = 'lightbox';
    lb.innerHTML = '<button class="lightbox__close">Close</button><img src="' + assetUrl(it.stop.frame) + '" alt="' + esc(it.stop.title) + '">';
    document.body.appendChild(lb);
    lb.querySelector('.lightbox__close').addEventListener('click', function () { lb.remove(); });
  });

  // ---------- Checkpoint ----------
  var picked = null;
  function renderQuestion(item) {
    show('checkpoint');
    var q = item.q;
    var a = st.answers[q.id] || { tries: 0, first: null, done: false, picked: null };
    picked = null;
    $('cp-title').textContent = item.stop.title;
    $('cp-count').textContent = questionIndex(item) + ' / ' + questionCount();
    $('cp-kind').textContent = q.type === 'multi' ? 'Pick all that apply' : (q.type === 'tf' ? 'True or false' : 'Pick one');
    $('cp-q').textContent = q.q;
    $('cp-feedback').innerHTML = '';
    var opts = $('cp-opts');
    opts.innerHTML = '';
    q.options.forEach(function (o, i) {
      var b = document.createElement('button');
      b.className = 'opt'; b.type = 'button'; b.setAttribute('data-i', i);
      b.innerHTML = '<span class="opt__key">' + String.fromCharCode(65 + i) + '</span><span>' + esc(o) + '</span>';
      b.addEventListener('click', function () {
        if (a.done) return;
        if (q.type === 'multi') {
          b.classList.toggle('is-selected');
          picked = Array.prototype.map.call(opts.querySelectorAll('.opt.is-selected'), function (el) { return +el.getAttribute('data-i'); });
          $('cp-action').disabled = picked.length === 0;
        } else {
          Array.prototype.forEach.call(opts.children, function (el) { el.classList.remove('is-selected'); });
          b.classList.add('is-selected');
          picked = i;
          $('cp-action').disabled = false;
        }
      });
      opts.appendChild(b);
    });
    var action = $('cp-action');
    action.disabled = true;
    if (a.done) {
      // Already answered (resume / back): show the outcome and let them continue.
      revealAnswer(q, a, true);
      action.disabled = false;
      action.textContent = 'Continue';
      action.onclick = advance;
    } else {
      action.textContent = 'Check';
      action.onclick = function () { checkAnswer(item, a); };
    }
  }
  function isCorrect(q, choice) {
    if (q.type === 'multi') {
      var want = (q.correct || []).slice().sort().join(','), got = (choice || []).slice().sort().join(',');
      return want === got;
    }
    return choice === q.correct;
  }
  function checkAnswer(item, a) {
    var q = item.q;
    if (picked === null || (Array.isArray(picked) && !picked.length)) return;
    a.tries += 1;
    var ok = isCorrect(q, picked);
    if (a.first === null) a.first = ok;
    a.picked = picked;
    st.answers[q.id] = a;
    api('/attempts/' + (st.attemptId || 'local') + '/answer', {
      method: 'POST',
      body: { questionId: q.id, stop: item.stop.n, tryNo: a.tries, choice: picked, correct: ok, at: new Date().toISOString() },
    }).catch(function () {});

    var opts = $('cp-opts');
    var action = $('cp-action');
    if (ok) {
      a.done = true;
      vibrate([10, 40, 10]);
      markOptions(opts, q, picked, true);
      $('cp-feedback').innerHTML = '<div class="feedback is-good"><p class="feedback__h">' + (a.tries === 1 ? 'That\'s it.' : 'There it is.') + '</p><p>' + esc(q.explain || '') + '</p></div>';
      action.textContent = 'Continue';
      action.onclick = advance;
    } else if (a.tries < MAX_TRIES) {
      vibrate(60);
      markOptions(opts, q, picked, false);
      $('cp-feedback').innerHTML = '<div class="feedback is-bad"><p class="feedback__h">Not that one.</p><p>One more try.</p></div>';
      action.textContent = 'Check';
      action.disabled = true;
      picked = null;
      // clear the wrong selection so a fresh pick is required
      setTimeout(function () {
        Array.prototype.forEach.call(opts.children, function (el) {
          el.classList.remove('is-selected');
          if (el.classList.contains('is-wrong')) { el.classList.remove('is-wrong'); el.classList.add('is-dim'); el.disabled = true; }
        });
      }, 450);
    } else {
      a.done = true;
      vibrate(60);
      revealAnswer(q, a, false);
      action.textContent = 'Continue';
      action.onclick = advance;
    }
    queueSync();
  }
  function markOptions(opts, q, choice, ok) {
    var set = Array.isArray(choice) ? choice : [choice];
    Array.prototype.forEach.call(opts.children, function (el) {
      var i = +el.getAttribute('data-i');
      el.classList.remove('is-selected');
      if (set.indexOf(i) !== -1) el.classList.add(ok ? 'is-correct' : 'is-wrong');
      if (ok) el.disabled = true;
    });
  }
  function revealAnswer(q, a, resumed) {
    var opts = $('cp-opts');
    var correctSet = Array.isArray(q.correct) ? q.correct : [q.correct];
    Array.prototype.forEach.call(opts.children, function (el) {
      var i = +el.getAttribute('data-i');
      el.disabled = true;
      el.classList.remove('is-selected', 'is-dim', 'is-wrong');
      if (correctSet.indexOf(i) !== -1) el.classList.add('is-correct');
      else el.classList.add('is-dim');
    });
    var head = a.first ? 'That\'s it.' : (resumed ? 'Answered.' : 'Here\'s the answer.');
    var cls = a.first ? 'is-good' : 'is-reveal';
    $('cp-feedback').innerHTML = '<div class="feedback ' + cls + '"><p class="feedback__h">' + head + '</p><p>' + esc(q.explain || '') + '</p></div>';
  }
  $('cp-back').addEventListener('click', function () {
    goTo(previousStopPos(st.pos), false);
  });

  // ---------- Exit ----------
  function finishWalk() {
    tickStop();
    var sc = computeScore();
    st.finishedAt = new Date().toISOString();
    st.score = sc.pct;
    st.passed = sc.pct >= pack.passPct;
    saveLocal();
    renderExit();
    show('exit');
    var snap = Object.assign({}, st); delete snap._tick;
    if (st.attemptId) {
      api('/attempts/' + st.attemptId + '/finish', {
        method: 'POST',
        body: { scorePct: sc.pct, passed: st.passed, firstTryCorrect: sc.first, totalQuestions: sc.total, elapsed: st.elapsed, state: snap },
      }).then(renderCrew).catch(function () {});
    }
  }
  function renderExit() {
    var sc = computeScore();
    var ring = $('ring');
    ring.classList.toggle('is-fail', !st.passed);
    $('ring-pct').textContent = sc.pct + '%';
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        $('ring-fg').style.strokeDashoffset = String(515.2 * (1 - sc.pct / 100));
      });
    });
    var v = $('exit-verdict');
    v.className = 'verdict ' + (st.passed ? 'is-pass' : 'is-fail');
    v.textContent = st.passed ? 'Week complete.' : 'Not there yet.';
    $('exit-note').textContent = st.passed
      ? 'Logged. Checkpoints you missed are listed below.'
      : pack.passPct + '% completes the week. Walk it again when you\'re ready.';
    $('x-correct').textContent = sc.first + '/' + sc.total;
    $('x-retries').textContent = sc.retries;
    $('x-time').textContent = Math.max(1, Math.round((st.elapsed || 0) / 60));

    var missed = [];
    flat.forEach(function (f) {
      if (f.kind !== 'q') return;
      var a = st.answers[f.q.id];
      if (!a || a.first) return;
      var correct = Array.isArray(f.q.correct) ? f.q.correct.map(function (i) { return f.q.options[i]; }).join(' · ') : f.q.options[f.q.correct];
      missed.push('<li><span class="stopref">Stop ' + f.n + ' · ' + esc(f.stop.title) + '</span>' + esc(f.q.q) + '<div class="ans">' + esc(correct) + '</div></li>');
    });
    $('missed-card').hidden = !missed.length;
    $('missed-list').innerHTML = missed.join('');
    $('exit-closer').textContent = pack.closer || '';
    $('pulse-card').hidden = true;
    $('board-card').hidden = true;
    $('exit-again').onclick = function () { st = null; startWalk(); };
    $('exit-home').onclick = function () { location.href = '/'; };
    if (st.attemptId && st.finishedAt) {
      api('/crew?week=' + encodeURIComponent(pack.week)).then(renderCrew).catch(function () {});
    }
  }
  function renderCrew(data) {
    if (!data || !data.crew) return;
    $('pulse-card').hidden = false;
    $('p-finished').textContent = data.crew.finished + (data.crew.roster ? '/' + data.crew.roster : '');
    $('p-avg').textContent = data.crew.avgPct != null ? data.crew.avgPct + '%' : '—';
    if (data.board && data.board.length && pack.board === 'callsign') {
      $('board-card').hidden = false;
      $('board-list').innerHTML = data.board.map(function (row, i) {
        return '<li class="' + (row.me ? 'is-me' : '') + '"><span><span class="rank">' + (i + 1) + '</span>' + esc(row.callsign) + '</span><span>' + row.scorePct + '%</span></li>';
      }).join('');
    }
  }

  // ---------- misc ----------
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function lockSvg() {
    return '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>';
  }
  function arrowSvg() {
    return '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M5 12h14M13 6l6 6-6 6"/></svg>';
  }
  document.addEventListener('visibilitychange', function () {
    if (!st) return;
    if (document.hidden) { tickStop(); audio.pause(); saveLocal(); pushProgress(); }
    else if (!st.finishedAt && (screens.stop.classList.contains('is-active') || screens.checkpoint.classList.contains('is-active'))) tickStart();
  });

  boot();
})();
