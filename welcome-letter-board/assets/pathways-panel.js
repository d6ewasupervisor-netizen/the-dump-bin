(function () {
  'use strict';

  var data = null;
  var busy = false;
  var opened = false;

  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function courseKey(course) {
    return String((course && (course.id || course.name)) || '').trim();
  }

  function owed(person) {
    return (person.courses || []).filter(function (course) {
      return course && course.required && !course.completed && courseKey(course);
    });
  }

  function status(text) {
    var el = document.getElementById('pathwaysStatus');
    if (el) el.textContent = text || '';
  }

  function api(path, opts) {
    var f = window.dumpBinAuthFetch || fetch;
    return f(path, opts).then(function (resp) {
      return resp.json().catch(function () { return {}; }).then(function (body) {
        if (!resp.ok || body.ok === false) {
          var err = new Error(body.error || body.message || ('Request failed (' + resp.status + ')'));
          err.status = resp.status;
          throw err;
        }
        return body;
      });
    });
  }

  function render() {
    var people = ((data && data.people) || []).slice().sort(function (a, b) {
      return owed(b).length - owed(a).length || String(a.name || '').localeCompare(String(b.name || ''));
    });
    var names = [];
    people.forEach(function (person) {
      owed(person).forEach(function (course) {
        if (names.indexOf(course.name) < 0) names.push(course.name);
      });
    });
    var chips = document.getElementById('pathwaysCourses');
    var list = document.getElementById('pathwaysPeople');
    if (!chips || !list) return;
    chips.innerHTML = names.map(function (name) {
      return '<button type="button" class="pw-chip" data-course-name="' + esc(name) + '">' + esc(name) + '</button>';
    }).join('');
    list.innerHTML = people.length ? people.map(function (person) {
      var courses = owed(person);
      var boxes = courses.map(function (course) {
        var due = course.due ? ' · due ' + course.due : '';
        return '<label class="pw-course"><input type="checkbox" data-user="' + esc(person.user_id) + '" data-course="' + esc(courseKey(course)) + '" data-name="' + esc(course.name) + '" checked />'
          + esc(course.name) + esc(due) + '</label>';
      }).join('');
      return '<div class="pw-person"><label><input type="checkbox" class="pw-person-check" data-user="' + esc(person.user_id) + '"'
        + (courses.length ? ' checked' : ' disabled') + ' /> <strong>' + esc(person.name || 'Unnamed') + '</strong></label>'
        + (courses.length ? '<div class="pw-courses">' + boxes + '</div>' : '<div class="wb-muted">No open required course.</div>')
        + '</div>';
    }).join('') : '<p class="wb-muted">No Pathways pull yet.</p>';

    chips.querySelectorAll('.pw-chip').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var name = btn.getAttribute('data-course-name');
        var turnOn = !btn.classList.contains('on');
        btn.classList.toggle('on', turnOn);
        list.querySelectorAll('input[data-name]').forEach(function (box) {
          if (box.getAttribute('data-name') === name) box.checked = turnOn;
        });
      });
    });
    list.querySelectorAll('.pw-person-check').forEach(function (box) {
      box.addEventListener('change', function () {
        var user = box.getAttribute('data-user');
        list.querySelectorAll('input[data-user="' + user + '"][data-course]').forEach(function (course) {
          course.checked = box.checked;
        });
      });
    });
    var pulled = data && data.captured_at
      ? new Date(data.captured_at).toLocaleString('en-US', { timeZone: 'America/Los_Angeles', dateStyle: 'medium', timeStyle: 'short' })
      : '';
    status(pulled ? 'Pulled ' + pulled + '.' : 'No pull yet.');
  }

  function selections() {
    var byUser = {};
    document.querySelectorAll('#pathwaysPeople input[data-course]:checked').forEach(function (box) {
      var user = box.getAttribute('data-user');
      if (!byUser[user]) byUser[user] = [];
      byUser[user].push(box.getAttribute('data-course'));
    });
    return Object.keys(byUser).map(function (user) {
      return { user_id: user, course_ids: byUser[user] };
    });
  }

  function send() {
    if (busy) return;
    var picked = selections();
    if (!picked.length) {
      status('Select at least one open required course.');
      return;
    }
    busy = true;
    var btn = document.getElementById('pathwaysSend');
    if (btn) btn.disabled = true;
    api('/api/pathways/remind', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ selections: picked }),
    }).then(function (result) {
      var skip = (result.skipped || []).map(function (row) {
        return (row.name || row.user_id || 'Someone') + ': ' + row.reason;
      });
      status([result.message].concat(skip).filter(Boolean).join(' '));
    }).catch(function (err) {
      status(err.message || 'Reminders did not send.');
    }).then(function () {
      busy = false;
      if (btn) btn.disabled = false;
    });
  }

  function pull() {
    if (busy) return;
    busy = true;
    var btn = document.getElementById('pathwaysPull');
    var log = document.getElementById('pathwaysLog');
    if (btn) btn.disabled = true;
    if (log) {
      log.hidden = false;
      log.textContent = '';
    }
    var f = window.dumpBinAuthFetch || fetch;
    f('/api/pathways/pull', { method: 'POST' }).then(function (resp) {
      var reader = resp.body && resp.body.getReader ? resp.body.getReader() : null;
      if (!reader) throw new Error('Pull did not start.');
      var decoder = new TextDecoder();
      var buf = '';
      function read() {
        return reader.read().then(function (chunk) {
          if (chunk.done) return null;
          buf += decoder.decode(chunk.value, { stream: true });
          var lines = buf.split('\n');
          buf = lines.pop();
          lines.forEach(function (line) {
            if (!line.trim()) return;
            var msg = JSON.parse(line);
            if (msg.line && log) log.textContent += (log.textContent ? '\n' : '') + msg.line;
            if (msg.error) throw new Error(msg.error);
          });
          return read();
        });
      }
      return read();
    }).then(function () {
      return load();
    }).catch(function (err) {
      status(err.message || 'Pull did not finish.');
    }).then(function () {
      busy = false;
      if (btn) btn.disabled = false;
    });
  }

  function load() {
    return api('/api/pathways').then(function (body) {
      data = body;
      render();
    }).catch(function (err) {
      data = null;
      status(err.status === 403
        ? 'Pathways is not enabled for this login.'
        : (err.message || 'Pathways did not load.'));
    });
  }

  window.PathwaysPanel = {
    open: function () {
      if (!opened) {
        opened = true;
        var sendBtn = document.getElementById('pathwaysSend');
        var pullBtn = document.getElementById('pathwaysPull');
        if (sendBtn) sendBtn.addEventListener('click', send);
        if (pullBtn) pullBtn.addEventListener('click', pull);
      }
      load();
    },
  };
})();
