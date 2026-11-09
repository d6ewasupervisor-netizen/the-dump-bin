(function () {
  'use strict';

  var data = null;
  var busy = false;
  var opened = false;
  var openUser = '';
  var drafts = {};

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

  function busyOn(on) {
    var mark = window.EmployeeBoardBusy;
    if (!mark) return;
    if (on) mark.start();
    else mark.stop();
  }

  function api(path, opts) {
    busyOn(true);
    var f = window.dumpBinAuthFetch || fetch;
    var headers = Object.assign({ 'Content-Type': 'application/json' }, (opts && opts.headers) || {});
    if (window.EMPLOYEE_BOARD) headers['x-employee-board'] = window.EMPLOYEE_BOARD;
    return f(path, Object.assign({}, opts, { headers: headers })).then(function (resp) {
      return resp.json().catch(function () { return {}; }).then(function (body) {
        if (!resp.ok || body.ok === false) {
          var err = new Error(body.error || body.message || ('Request failed (' + resp.status + ')'));
          err.status = resp.status;
          throw err;
        }
        return body;
      });
    }).then(function (body) {
      busyOn(false);
      return body;
    }, function (err) {
      busyOn(false);
      throw err;
    });
  }

  function firstName(name) {
    var part = String(name || '').trim().split(/\s+/)[0];
    return part || 'there';
  }

  function courseUrl(course) {
    var url = String(course && course.url || '').trim();
    if (/^https?:\/\//i.test(url)) return url;
    var id = String(course && course.id || '').trim();
    if (!/^\d+$/.test(id)) return '';
    var slug = String(course.name || '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    return slug ? ('https://app.schoox.com/' + id + '/' + slug) : ('https://app.schoox.com/' + id);
  }

  function letterFor(person, courses) {
    var who = firstName(person.name);
    var lines = courses.map(function (course) {
      var due = course.due ? ' Due ' + course.due + '.' : '';
      var link = courseUrl(course);
      return course.name + '.' + due + (link ? '\n' + link : '');
    });
    return {
      subject: 'Pathways courses',
      text: [
        who + ',',
        '',
        'Please make sure you complete these Pathways courses:',
        '',
        lines.join('\n') || 'None selected.',
        '',
        'Tyson Gauthier',
        'Field Operations Supervisor',
      ].join('\n'),
    };
  }

  function selectedCourse() {
    var select = document.getElementById('pathwaysCourse');
    return select ? select.value : '';
  }

  function visibleCourses(person) {
    var filter = selectedCourse();
    return owed(person).filter(function (course) {
      return !filter || course.name === filter;
    });
  }

  function checkedCourses(user) {
    var boxes = document.querySelectorAll('#pathwaysPeople input[data-user="' + user + '"][data-course]:checked');
    var keys = {};
    Array.prototype.forEach.call(boxes, function (box) { keys[box.getAttribute('data-course')] = true; });
    var person = (data.people || []).filter(function (row) { return String(row.user_id) === String(user); })[0];
    if (!person) return [];
    return owed(person).filter(function (course) { return keys[courseKey(course)]; });
  }

  function fillLetter(user, force) {
    var person = (data.people || []).filter(function (row) { return String(row.user_id) === String(user); })[0];
    if (!person) return;
    var letter = drafts[user] && !force ? drafts[user] : letterFor(person, checkedCourses(user));
    var subject = document.querySelector('[data-letter-subject="' + user + '"]');
    var body = document.querySelector('[data-letter-body="' + user + '"]');
    if (subject) subject.value = letter.subject;
    if (body) body.value = letter.text;
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
    var filter = document.getElementById('pathwaysCourse');
    var current = filter ? filter.value : '';
    if (filter) {
      filter.innerHTML = '<option value="">All open courses</option>' + names.map(function (name) {
        return '<option value="' + esc(name) + '">' + esc(name) + '</option>';
      }).join('');
      filter.value = names.indexOf(current) >= 0 ? current : '';
    }
    var courseFilter = selectedCourse();
    var shown = people.filter(function (person) {
      var courses = visibleCourses(person);
      return courseFilter ? courses.length > 0 : true;
    });
    var list = document.getElementById('pathwaysPeople');
    if (!list) return;
    list.innerHTML = shown.length ? shown.map(function (person) {
      var courses = visibleCourses(person);
      var behind = owed(person).length > 0;
      var user = String(person.user_id);
      var isOpen = openUser === user;
      var boxes = courses.map(function (course) {
        var due = course.due ? ' · due ' + course.due : '';
        return '<label class="pw-course"><input type="checkbox" data-user="' + esc(user) + '" data-course="' + esc(courseKey(course)) + '" checked />'
          + esc(course.name) + esc(due) + '</label>';
      }).join('');
      var menu = isOpen
        ? '<div class="wb-submenu">'
          + (boxes || '<p class="wb-muted">No open required course for this filter.</p>')
          + '<div class="wb-letter"><label>Subject<input data-letter-subject="' + esc(user) + '" type="text"></label>'
          + '<label>Letter<textarea data-letter-body="' + esc(user) + '"></textarea></label>'
          + '<button type="button" class="wb-btn wb-btn-primary" data-send="' + esc(user) + '">Send this reminder</button></div></div>'
        : '';
      return '<div class="pw-person"><button type="button" class="wb-menu-name' + (behind ? ' is-behind' : '') + '" data-open="' + esc(user) + '">'
        + esc(person.name || 'Unnamed') + (behind ? ' · Still due' : '') + '</button>' + menu + '</div>';
    }).join('') : '<p class="wb-muted">No one is on the latest course check.</p>';

    list.querySelectorAll('[data-open]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var user = btn.getAttribute('data-open');
        openUser = openUser === user ? '' : user;
        render();
      });
    });
    list.querySelectorAll('input[data-course]').forEach(function (box) {
      box.addEventListener('change', function () {
        var user = box.getAttribute('data-user');
        delete drafts[user];
        fillLetter(user, true);
      });
    });
    list.querySelectorAll('[data-letter-body], [data-letter-subject]').forEach(function (field) {
      field.addEventListener('input', function () {
        var user = field.getAttribute('data-letter-body') || field.getAttribute('data-letter-subject');
        var subject = document.querySelector('[data-letter-subject="' + user + '"]');
        var body = document.querySelector('[data-letter-body="' + user + '"]');
        drafts[user] = {
          subject: subject ? subject.value : '',
          text: body ? body.value : '',
        };
      });
    });
    list.querySelectorAll('[data-send]').forEach(function (btn) {
      btn.addEventListener('click', function () { send(btn.getAttribute('data-send')); });
    });
    if (openUser) fillLetter(openUser);
    var pulled = data && data.captured_at
      ? new Date(data.captured_at).toLocaleString('en-US', { timeZone: 'America/Los_Angeles', dateStyle: 'medium', timeStyle: 'short' })
      : '';
    status(pulled ? 'Last checked ' + pulled + '.' : 'No course check yet.');
  }

  function send(user) {
    if (busy) return;
    var courses = checkedCourses(user);
    if (!courses.length) {
      status('Choose at least one open course.');
      return;
    }
    var subject = document.querySelector('[data-letter-subject="' + user + '"]');
    var body = document.querySelector('[data-letter-body="' + user + '"]');
    var text = body ? body.value.trim() : '';
    if (!text) {
      status('Write the reminder before sending it.');
      return;
    }
    busy = true;
    api('/api/pathways/remind', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        selections: [{
          user_id: user,
          course_ids: courses.map(courseKey),
          subject: subject ? subject.value.trim() : '',
          text: text,
        }],
      }),
    }).then(function (result) {
      var skip = (result.skipped || []).map(function (row) {
        return (row.name || row.user_id || 'Someone') + ': ' + row.reason;
      });
      status([result.message].concat(skip).filter(Boolean).join(' '));
    }).catch(function (err) {
      status(err.message || 'The reminder did not send.');
    }).then(function () {
      busy = false;
    });
  }

  function pull() {
    if (busy) return;
    busy = true;
    var btn = document.getElementById('pathwaysPull');
    var log = document.getElementById('pathwaysLog');
    if (btn) btn.disabled = true;
    if (log) log.textContent = '';
    busyOn(true);
    var f = window.dumpBinAuthFetch || fetch;
    f('/api/pathways/pull', { method: 'POST' }).then(function (resp) {
      var reader = resp.body && resp.body.getReader ? resp.body.getReader() : null;
      if (!reader) throw new Error('The course check did not start.');
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
      busyOn(false);
      return load();
    }).catch(function (err) {
      busyOn(false);
      status(err.message || 'The course check did not finish.');
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
        ? 'Course checks are not turned on for this login.'
        : (err.message || 'The course list did not load.'));
    });
  }

  window.PathwaysPanel = {
    open: function () {
      if (!opened) {
        opened = true;
        var pullBtn = document.getElementById('pathwaysPull');
        var filter = document.getElementById('pathwaysCourse');
        if (pullBtn) pullBtn.addEventListener('click', pull);
        if (filter) filter.addEventListener('change', function () { openUser = ''; render(); });
      }
      load();
    },
  };
})();
