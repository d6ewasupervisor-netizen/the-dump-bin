'use strict';

(function () {
  var API = '/api/si-closeout-chat';
  var phase = 'store';
  var storeNumber = null;
  var picked = new Set();
  var rangeStart = null;
  var rangeEnd = null;
  var calCursor = null;
  var kinds = new Set();
  var busy = false;

  var messagesEl = null;
  var emptyState = null;
  var dock = null;
  var msgInput = null;
  var appEl = null;
  var getName = function () { return ''; };

  var KIND_CHOICES = [
    { id: 'ise', label: 'Kompass ISE' },
    { id: 'blitz', label: 'Blitz' },
    { id: 'cutin', label: 'Cut-in' },
    { id: 'div', label: 'Div' },
    { id: 'central-pet', label: 'Central Pet resets' },
    { id: 'unknown', label: "I don't know" },
  ];

  function esc(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function isoToday() {
    var parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Los_Angeles',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(new Date());
    var y = '';
    var m = '';
    var d = '';
    parts.forEach(function (p) {
      if (p.type === 'year') y = p.value;
      if (p.type === 'month') m = p.value;
      if (p.type === 'day') d = p.value;
    });
    return y + '-' + m + '-' + d;
  }

  function pad(n) { return n < 10 ? '0' + n : String(n); }

  function monthLabel(year, month) {
    return new Date(Date.UTC(year, month, 1)).toLocaleDateString('en-US', {
      month: 'long',
      year: 'numeric',
      timeZone: 'UTC',
    });
  }

  function scrollDown() {
    if (messagesEl) messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function localLine(text, tag) {
    if (!messagesEl) return;
    if (emptyState && emptyState.parentNode === messagesEl) emptyState.remove();
    var el = document.createElement('div');
    el.className = 'msg system' + (tag === 'TRUTH' ? ' truth' : '');
    el.dataset.local = '1';
    var tagHtml = tag
      ? '<div class="request-tag">' + esc(tag) + '</div>'
      : '';
    el.innerHTML =
      '<div class="msg-body">' +
        '<div class="msg-header"><span class="msg-name">SI Closeout</span></div>' +
        '<div class="msg-bubble">' + tagHtml +
          '<div class="msg-text">' + esc(text) + '</div>' +
        '</div>' +
      '</div>';
    messagesEl.appendChild(el);
    scrollDown();
  }

  function setMode(mode) {
    phase = mode;
    if (appEl) appEl.dataset.mode = mode === 'close' ? 'close' : 'menu';
    if (!msgInput) return;
    if (mode === 'close') {
      msgInput.placeholder = storeNumber ? (storeNumber + ', dbkey') : '49, 9834765';
    } else if (mode === 'store') {
      msgInput.placeholder = 'Store number';
    } else {
      msgInput.placeholder = 'Message';
    }
  }

  function clearDock() {
    if (dock) dock.innerHTML = '';
  }

  async function postJson(path, body) {
    var r = await window.dumpBinAuthFetch(API + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {}),
    });
    var data = null;
    try { data = await r.json(); } catch (_) { data = null; }
    if (!data || data.ok !== true) {
      return {
        ok: true,
        say: 'That request did not come back. The tool is still open.',
      };
    }
    return data;
  }

  function choiceButtons() {
    clearDock();
    var row = document.createElement('div');
    row.className = 'choice-row';
    [
      ['carry', 'Kompass carry forward'],
      ['sync', 'Sync PROD with SI'],
      ['resistance', 'Join the resistance'],
    ].forEach(function (pair) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'choice-btn';
      btn.textContent = pair[1];
      btn.addEventListener('click', function () { onChoice(pair[0]); });
      row.appendChild(btn);
    });
    var again = document.createElement('button');
    again.type = 'button';
    again.className = 'choice-btn';
    again.textContent = 'Different store';
    again.addEventListener('click', askStore);
    dock.appendChild(row);
    dock.appendChild(again);
  }

  function askStore() {
    storeNumber = null;
    picked.clear();
    kinds.clear();
    rangeStart = null;
    rangeEnd = null;
    setMode('store');
    clearDock();
    localLine('What store?');
    if (msgInput) msgInput.focus();
  }

  function showChoices(message) {
    setMode('choose');
    localLine(message || ('Store ' + storeNumber + ' found. What would you like to do?'));
    choiceButtons();
  }

  async function onChoice(id) {
    if (busy || !storeNumber) return;
    if (id === 'resistance') return joinResistance();
    if (id === 'sync') return startSync();
    if (id === 'carry') return loadTasks();
  }

  async function joinResistance() {
    busy = true;
    clearDock();
    try {
      var data = await postJson('/resistance', { senderName: getName() });
      localLine(data.say || 'Your complimentary SI badge will be in your e-mail inbox momentarily.');
      if (data.detail) localLine(data.detail, 'TRUTH');
    } catch (e) {
      localLine('The badge was not sent. ' + (e.message || 'The request did not finish.') + ' The tool is still open.', 'TRUTH');
    } finally {
      busy = false;
      choiceButtons();
    }
  }

  async function startSync() {
    busy = true;
    clearDock();
    localLine('Syncing store ' + storeNumber + '.');
    try {
      var data = await postJson('/sync', { senderName: getName(), storeNumber: storeNumber });
      if (data.say) localLine(data.say, 'TRUTH');
    } catch (e) {
      localLine('Sync did not start. ' + (e.message || 'The request did not finish.') + ' The tool is still open.', 'TRUTH');
    } finally {
      busy = false;
      choiceButtons();
    }
  }

  async function loadTasks() {
    busy = true;
    clearDock();
    localLine('Loading open tasks for store ' + storeNumber + '.');
    try {
      var r = await window.dumpBinAuthFetch(API + '/open-tasks?store=' + encodeURIComponent(storeNumber));
      var data = await r.json();
      if (!data || data.ok !== true) {
        localLine('Today\'s tasks did not load. The tool is still open.', 'TRUTH');
        choiceButtons();
        return;
      }
      if (data.message) localLine(data.message, data.tasks && data.tasks.length ? '' : 'TRUTH');
      renderTasks(Array.isArray(data.tasks) ? data.tasks : []);
    } catch (e) {
      localLine('Today\'s tasks did not load. ' + (e.message || '') + ' The tool is still open.', 'TRUTH');
      choiceButtons();
    } finally {
      busy = false;
    }
  }

  function renderTasks(tasks) {
    picked.clear();
    setMode('tasks');
    clearDock();
    if (!tasks.length) {
      choiceButtons();
      return;
    }
    var list = document.createElement('div');
    list.className = 'task-list';
    tasks.forEach(function (task) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'task-row';
      var key = task.dbkey ? String(task.dbkey) : '';
      var title = task.title || 'Open task';
      var extra = task.reason ? (' · ' + task.reason) : '';
      btn.textContent = (key ? key + ' — ' : 'No dbkey — ') + title + extra;
      btn.disabled = !key;
      btn.addEventListener('click', function () {
        if (!key) return;
        if (picked.has(key)) picked.delete(key);
        else picked.add(key);
        btn.classList.toggle('on', picked.has(key));
        btn.setAttribute('aria-pressed', picked.has(key) ? 'true' : 'false');
      });
      list.appendChild(btn);
    });
    var go = document.createElement('button');
    go.type = 'button';
    go.className = 'choice-btn primary';
    go.textContent = 'Continue';
    go.addEventListener('click', function () {
      if (!picked.size) {
        localLine('Pick one or more tasks.', 'TRUTH');
        return;
      }
      openCalendar();
    });
    var back = document.createElement('button');
    back.type = 'button';
    back.className = 'choice-btn';
    back.textContent = 'Back';
    back.addEventListener('click', function () { showChoices('Store ' + storeNumber + ' found. What would you like to do?'); });
    dock.appendChild(list);
    var row = document.createElement('div');
    row.className = 'choice-row';
    row.appendChild(go);
    row.appendChild(back);
    dock.appendChild(row);
  }

  function openCalendar() {
    setMode('dates');
    var today = isoToday();
    var parts = today.split('-');
    calCursor = { year: Number(parts[0]), month: Number(parts[1]) - 1 };
    rangeStart = null;
    rangeEnd = null;
    kinds.clear();
    localLine('Pick the dates to search in PROD.');
    renderCalendar();
  }

  function inRange(iso) {
    if (!rangeStart) return false;
    if (!rangeEnd) return iso === rangeStart;
    var a = rangeStart < rangeEnd ? rangeStart : rangeEnd;
    var b = rangeStart < rangeEnd ? rangeEnd : rangeStart;
    return iso >= a && iso <= b;
  }

  function renderCalendar() {
    clearDock();
    var year = calCursor.year;
    var month = calCursor.month;
    var head = document.createElement('div');
    head.className = 'cal-head';
    var prev = document.createElement('button');
    prev.type = 'button';
    prev.className = 'choice-btn';
    prev.textContent = 'Prev';
    prev.addEventListener('click', function () {
      calCursor.month -= 1;
      if (calCursor.month < 0) { calCursor.month = 11; calCursor.year -= 1; }
      renderCalendar();
    });
    var title = document.createElement('div');
    title.className = 'cal-title';
    title.textContent = monthLabel(year, month);
    var next = document.createElement('button');
    next.type = 'button';
    next.className = 'choice-btn';
    next.textContent = 'Next';
    next.addEventListener('click', function () {
      calCursor.month += 1;
      if (calCursor.month > 11) { calCursor.month = 0; calCursor.year += 1; }
      renderCalendar();
    });
    head.appendChild(prev);
    head.appendChild(title);
    head.appendChild(next);

    var grid = document.createElement('div');
    grid.className = 'cal-grid';
    ['S', 'M', 'T', 'W', 'T', 'F', 'S'].forEach(function (d) {
      var lab = document.createElement('div');
      lab.className = 'cal-dow';
      lab.textContent = d;
      grid.appendChild(lab);
    });
    var first = new Date(Date.UTC(year, month, 1)).getUTCDay();
    var days = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
    var i;
    for (i = 0; i < first; i += 1) {
      var blank = document.createElement('div');
      blank.className = 'cal-day blank';
      grid.appendChild(blank);
    }
    for (i = 1; i <= days; i += 1) {
      var iso = year + '-' + pad(month + 1) + '-' + pad(i);
      var day = document.createElement('button');
      day.type = 'button';
      day.className = 'cal-day' + (inRange(iso) ? ' on' : '');
      day.textContent = String(i);
      day.addEventListener('click', function (isoValue) {
        return function () {
          if (!rangeStart || (rangeStart && rangeEnd)) {
            rangeStart = isoValue;
            rangeEnd = null;
          } else if (isoValue < rangeStart) {
            rangeEnd = rangeStart;
            rangeStart = isoValue;
          } else {
            rangeEnd = isoValue;
          }
          renderCalendar();
        };
      }(iso));
      grid.appendChild(day);
    }

    var kindRow = document.createElement('div');
    kindRow.className = 'choice-row';
    KIND_CHOICES.forEach(function (choice) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'choice-btn' + (kinds.has(choice.id) ? ' on' : '');
      btn.textContent = choice.label;
      btn.addEventListener('click', function () {
        if (choice.id === 'unknown') {
          kinds.clear();
          kinds.add('unknown');
        } else {
          kinds.delete('unknown');
          if (kinds.has(choice.id)) kinds.delete(choice.id);
          else kinds.add(choice.id);
        }
        renderCalendar();
      });
      kindRow.appendChild(btn);
    });

    var go = document.createElement('button');
    go.type = 'button';
    go.className = 'choice-btn primary';
    go.textContent = 'Search PROD';
    go.addEventListener('click', startCarry);
    var back = document.createElement('button');
    back.type = 'button';
    back.className = 'choice-btn';
    back.textContent = 'Back';
    back.addEventListener('click', function () { loadTasks(); });
    var actions = document.createElement('div');
    actions.className = 'choice-row';
    actions.appendChild(go);
    actions.appendChild(back);

    dock.appendChild(head);
    dock.appendChild(grid);
    dock.appendChild(kindRow);
    dock.appendChild(actions);
  }

  async function startCarry() {
    if (!rangeStart) {
      localLine('Pick a date. A second date sets the end of the range.', 'TRUTH');
      return;
    }
    var from = rangeStart;
    var to = rangeEnd || rangeStart;
    var kindList = kinds.size ? Array.from(kinds) : ['unknown'];
    busy = true;
    clearDock();
    localLine('Searching PROD for store ' + storeNumber + '.');
    try {
      var data = await postJson('/carry-forward', {
        senderName: getName(),
        storeNumber: storeNumber,
        dbkeys: Array.from(picked),
        dateFrom: from,
        dateTo: to,
        kinds: kindList,
      });
      if (data.say) localLine(data.say, 'TRUTH');
    } catch (e) {
      localLine('Carry forward did not start. ' + (e.message || '') + ' The tool is still open.', 'TRUTH');
    } finally {
      busy = false;
      choiceButtons();
    }
  }

  function onComposerSend(text) {
    if (phase === 'close') return false;
    var raw = String(text || '').trim();
    if (phase !== 'store') {
      if (/^\d{1,4}$/.test(raw) && raw !== '0') {
        lookup(parseInt(raw, 10));
        return true;
      }
      return false;
    }
    if (!/^\d{1,4}$/.test(raw) || raw === '0') {
      localLine('Send the store number.', 'TRUTH');
      return true;
    }
    lookup(parseInt(raw, 10));
    return true;
  }

  async function lookup(store) {
    if (busy) return;
    busy = true;
    try {
      var data = await postJson('/store', { senderName: getName(), storeNumber: store });
      if (data.found) {
        storeNumber = data.storeNumber || store;
        showChoices(data.message);
      } else {
        localLine(data.message || ('Store ' + store + ' was not found.'), 'TRUTH');
        setMode('store');
      }
    } catch (e) {
      localLine('The store check did not finish. ' + (e.message || '') + ' The tool is still open.', 'TRUTH');
    } finally {
      busy = false;
      if (msgInput) {
        msgInput.value = '';
        msgInput.focus();
      }
    }
  }

  function enterClose() {
    setMode('close');
    clearDock();
    localLine(storeNumber
      ? ('Close SI for store ' + storeNumber + '. Send the store and dbkey.')
      : 'Close SI. Send the store and dbkey.');
    if (msgInput) {
      if (storeNumber && !msgInput.value.trim()) msgInput.value = storeNumber + ', ';
      msgInput.focus();
    }
  }

  var attached = false;
  window.SiCloseoutFlow = {
    attach: function (opts) {
      if (attached) return;
      attached = true;
      messagesEl = opts.messagesEl;
      emptyState = opts.emptyState;
      dock = opts.dock;
      msgInput = opts.msgInput;
      appEl = opts.appEl;
      getName = opts.getName || getName;
      var closeBtn = document.getElementById('close-si-btn');
      if (closeBtn) closeBtn.addEventListener('click', enterClose);
      askStore();
    },
    consumeSend: onComposerSend,
  };
})();
