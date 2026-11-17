(function () {
  'use strict';

  var params = new URLSearchParams(location.search);
  var SLUG = params.get('project') || params.get('slug') || 'meat-pushers-2026';
  var API = '/api/projects';
  var district = params.get('district') || '';
  var storeFilter = '';
  var sortKey = 'storeNumber';
  var sortDir = 1;
  var overview = null;
  var events = [];
  var photoAudit = null;
  var selectedStore = null;
  var lightbox = { items: [], index: 0 };
  var timer = null;

  var statusEl = document.getElementById('status');
  var titleEl = document.getElementById('title');
  var subtitleEl = document.getElementById('subtitle');
  var lastUpdatedEl = document.getElementById('lastUpdated');
  var tilesEl = document.getElementById('tiles');
  var chipsEl = document.getElementById('districtChips');
  var tbody = document.querySelector('#storeGrid tbody');
  var feedEl = document.getElementById('feed');
  var drawer = document.getElementById('drawer');
  var drawerBody = document.getElementById('drawerBody');
  var drawerTitle = document.getElementById('drawerTitle');

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function authFetch(url, opts) {
    var f = window.dumpBinAuthFetch || fetch;
    // Never let a secondary 401 (thumbnails, export) wipe the hub session and
    // bounce this page into a sign-in loop. ensureAccess handles real auth loss.
    var next = Object.assign({}, opts || {});
    if (next.noBounceOn401 == null) next.noBounceOn401 = true;
    return f(url, next);
  }

  async function api(path, opts) {
    var res = await authFetch(API + path, opts || {});
    var data = await res.json().catch(function () { return {}; });
    if (!res.ok || data.ok === false) {
      var err = new Error(data.error || ('HTTP ' + res.status));
      err.status = res.status;
      err.code = data.code;
      throw err;
    }
    return data;
  }

  function fmtTime(v) {
    if (!v) return '—';
    try {
      return new Date(v).toLocaleString('en-US', {
        timeZone: 'America/Los_Angeles',
        month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
      });
    } catch (_) {
      return String(v);
    }
  }

  function actorLabel(a) {
    if (!a) return '—';
    if (String(a).indexOf('link:') === 0) return String(a).slice(5);
    return a;
  }

  async function ensureAccess() {
    var res = await authFetch('/api/me', { noBounceOn401: true });
    if (res.status === 401) {
      if (window.dumpBinAuth && typeof window.dumpBinAuth.bounceToSignIn === 'function') {
        window.dumpBinAuth.bounceToSignIn('admin projects /api/me 401');
      }
      throw new Error('Sign in required');
    }
    if (!res.ok) throw new Error('Sign in required');
    var me = await res.json();
    var roles = (me && me.roles) || [];
    var cards = (me && me.cards) || [];
    var ok = roles.indexOf('supervisor') >= 0 || roles.indexOf('admin') >= 0 || cards.indexOf('projects-admin') >= 0;
    if (!ok) {
      var err = new Error('Supervisor access required');
      err.status = 403;
      throw err;
    }
    return me;
  }

  function paintChips() {
    var districts = (overview && overview.districts) || [];
    chipsEl.innerHTML =
      '<button type="button" class="chip' + (district ? '' : ' on') + '" data-d="">All</button>' +
      districts.map(function (d) {
        return '<button type="button" class="chip' + (district === d ? ' on' : '') + '" data-d="' + esc(d) + '">' +
          esc(d) + '</button>';
      }).join('');
  }

  function paintTiles() {
    var t = (overview && overview.tiles) || {};
    tilesEl.innerHTML =
      '<div class="tile headline"><div class="label">Area 100%</div><div class="value ' +
      (t.area100 ? 'ok' : 'bad') + '">' + (t.area100 ? 'Yes' : 'No') + '</div></div>' +
      '<div class="tile"><div class="label">Ready complete</div><div class="value">' +
      esc(t.readyComplete) + '/' + esc(t.readyTotal) + '</div></div>' +
      '<div class="tile"><div class="label">Not Ready sets</div><div class="value">' + esc(t.notReadySets) + '</div></div>' +
      '<div class="tile"><div class="label">Issues open</div><div class="value' +
      (t.issuesOpen ? ' bad' : '') + '">' + esc(t.issuesOpen) + '</div></div>' +
      '<div class="tile"><div class="label">Backlog checked</div><div class="value">' +
      esc(t.backlogStores) + '/' + esc(t.storeCount) + '</div></div>' +
      '<div class="tile"><div class="label">Photos today</div><div class="value">' + esc(t.photosToday) + '</div></div>';
  }

  function visibleStores() {
    var list = ((overview && overview.stores) || []).slice();
    if (storeFilter === 'issues') list = list.filter(function (s) { return s.issues > 0; });
    if (storeFilter === 'progress') list = list.filter(function (s) { return s.inProgress > 0; });
    if (storeFilter === 'idle') list = list.filter(function (s) { return !s.lastActivityAt; });
    list.sort(function (a, b) {
      var av = a[sortKey];
      var bv = b[sortKey];
      if (sortKey === 'storeNumber') {
        av = Number(a.storeNumber) || 0;
        bv = Number(b.storeNumber) || 0;
      }
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (av < bv) return -1 * sortDir;
      if (av > bv) return 1 * sortDir;
      return 0;
    });
    return list;
  }

  function paintGrid() {
    var list = visibleStores();
    tbody.innerHTML = list.map(function (s) {
      return '<tr data-store="' + esc(s.storeNumber) + '">' +
        '<td><strong>FM ' + esc(s.storeNumber) + '</strong></td>' +
        '<td><span class="bar"><span style="width:' + esc(s.readyPct) + '%"></span></span>' + esc(s.readyPct) + '%</td>' +
        '<td>' + esc(s.readyComplete) + '/' + esc(s.readyTotal) + '</td>' +
        '<td>' + esc(s.inProgress) + '</td>' +
        '<td>' + esc(s.notReady) + '</td>' +
        '<td>' + (s.issues ? ('<span class="badge">' + esc(s.issues) + '</span>') : '0') + '</td>' +
        '<td>' + esc(fmtTime(s.lastActivityAt)) +
        '<div class="muted">' + esc(actorLabel(s.lastActivityActor)) + '</div></td>' +
        '<td><input type="checkbox" data-backlog="' + esc(s.storeNumber) + '"' +
        (s.backlogComplete ? ' checked' : '') + '></td>' +
        '<td>' + (s.store100 ? 'Yes' : 'No') + '</td>' +
        '<td>' + (s.maintenanceOk ? 'Yes' : 'No') + '</td>' +
        '</tr>';
    }).join('');

    tbody.querySelectorAll('tr[data-store]').forEach(function (tr) {
      tr.addEventListener('click', function (ev) {
        if (ev.target && ev.target.matches('input[data-backlog]')) return;
        openStore(tr.getAttribute('data-store'));
      });
    });
    tbody.querySelectorAll('input[data-backlog]').forEach(function (cb) {
      cb.addEventListener('click', function (ev) { ev.stopPropagation(); });
      cb.addEventListener('change', async function (ev) {
        var store = cb.getAttribute('data-backlog');
        try {
          await api('/' + encodeURIComponent(SLUG) + '/stores/' + encodeURIComponent(store) + '/backlog', {
            method: 'PATCH',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ backlog_complete: !!cb.checked }),
          });
          await refresh();
        } catch (err) {
          statusEl.textContent = err.message;
          cb.checked = !cb.checked;
        }
      });
    });
  }

  function paintFeed() {
    if (!events.length) {
      feedEl.innerHTML = '<p class="muted">No activity yet.</p>';
      return;
    }
    feedEl.innerHTML = events.map(function (e) {
      var thumb = e.photo && e.photo.url && String(e.action || '').indexOf('photo_') === 0
        ? '<img alt="" data-auth-src="' + esc(e.photo.url) + '">'
        : '';
      return '<div class="feed-item">' +
        '<div><strong>FM ' + esc(e.storeNumber) + '</strong> · ' + esc(e.setName) + '</div>' +
        '<div>' + esc(e.action) + (e.toValue ? (' → ' + esc(e.toValue)) : '') + '</div>' +
        '<div class="meta">' + esc(fmtTime(e.createdAt)) + ' · ' + esc(actorLabel(e.actor)) + '</div>' +
        thumb +
        '</div>';
    }).join('');
    hydrateAuthImages(feedEl);
  }

  function paintIssues() {
    var panel = document.getElementById('panelIssues');
    var issues = (overview && overview.issues) || [];
    if (!issues.length) {
      panel.innerHTML = '<p class="muted">No open issues.</p>';
      return;
    }
    panel.innerHTML = issues.map(function (i) {
      return '<div class="issue-row" data-issue-set="' + esc(i.setId) + '" data-issue-store="' + esc(i.storeNumber) + '">' +
        '<div><strong>FM ' + esc(i.storeNumber) + '</strong> · ' + esc(i.name) + '</div>' +
        '<div>' + esc(i.issueNote || 'No note') + '</div>' +
        '<div class="muted">' + esc(fmtTime(i.updatedAt)) + ' · ' + esc(actorLabel(i.actor)) + '</div>' +
        '<div class="row-actions"><button type="button" class="btn secondary" data-resolve="' + esc(i.setId) +
        '" data-store="' + esc(i.storeNumber) + '">Resolve</button></div></div>';
    }).join('');
    panel.querySelectorAll('[data-resolve]').forEach(function (btn) {
      btn.addEventListener('click', async function () {
        var note = prompt('Resolution note');
        if (!note) return;
        try {
          await api('/sets/' + btn.getAttribute('data-resolve'), {
            method: 'PATCH',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ install_status: 'In Progress', issue_note: note }),
          });
          await refresh();
        } catch (err) {
          statusEl.textContent = err.message;
        }
      });
    });
  }

  function paintPhotoAudit() {
    var panel = document.getElementById('panelPhotos');
    if (!photoAudit) {
      panel.innerHTML = '<p class="muted">Loading…</p>';
      return;
    }
    var missing = photoAudit.completeMissingPhotos || [];
    var html = '';
    if (missing.length) {
      html += '<p class="flag">Complete sets missing required photos: ' + missing.length + '</p>';
      html += missing.map(function (m) {
        return '<div class="muted">FM ' + esc(m.storeNumber) + ' · ' + esc(m.name) +
          ' · B' + m.beforePhotoCount + '/A' + m.afterPhotoCount + '/W' + (m.worksheetPhoto ? 1 : 0) + '</div>';
      }).join('');
    } else {
      html += '<p class="muted">No Complete sets missing Before/After/Worksheet.</p>';
    }
    html += '<div class="photo-grid" style="margin-top:12px">';
    (photoAudit.photos || []).forEach(function (p) {
      html += '<figure><img alt="" data-auth-src="' + esc(p.url) + '" data-photo-id="' + esc(p.id) + '">' +
        '<figcaption>FM ' + esc(p.storeNumber) + '<br>' + esc(p.setName) + ' · ' + esc(p.kind) +
        (p.rejectedAt ? ' · rejected' : '') + '</figcaption></figure>';
    });
    html += '</div>';
    panel.innerHTML = html;
    hydrateAuthImages(panel);
    var items = (photoAudit.photos || []).map(function (p) {
      return { url: p.url, meta: 'FM ' + p.storeNumber + ' · ' + p.setName + ' · ' + p.kind + ' · ' + fmtTime(p.createdAt) + ' · ' + (p.actorEmail || '') };
    });
    panel.querySelectorAll('img[data-photo-id]').forEach(function (img, idx) {
      img.addEventListener('click', function () { openLightbox(items, idx); });
    });
  }

  async function hydrateAuthImages(root) {
    var imgs = (root || document).querySelectorAll('img[data-auth-src]');
    for (var i = 0; i < imgs.length; i++) {
      var img = imgs[i];
      var url = img.getAttribute('data-auth-src');
      if (!url || img.getAttribute('data-hydrated') === '1') continue;
      try {
        var res = await authFetch(url);
        if (!res.ok) continue;
        var blob = await res.blob();
        img.src = URL.createObjectURL(blob);
        img.setAttribute('data-hydrated', '1');
      } catch (_) { /* ignore */ }
    }
  }

  function openLightbox(items, index) {
    lightbox.items = items || [];
    lightbox.index = index || 0;
    renderLightbox();
  }

  function renderLightbox() {
    var box = document.getElementById('lightbox');
    if (!lightbox.items.length) {
      box.hidden = true;
      return;
    }
    box.hidden = false;
    var item = lightbox.items[lightbox.index];
    document.getElementById('lbMeta').textContent = item.meta || '';
    var img = document.getElementById('lbImg');
    img.removeAttribute('src');
    authFetch(item.url).then(function (res) { return res.blob(); }).then(function (blob) {
      img.src = URL.createObjectURL(blob);
    }).catch(function () {
      img.removeAttribute('src');
    });
  }

  function closeLightbox() {
    var box = document.getElementById('lightbox');
    box.hidden = true;
    lightbox.items = [];
    lightbox.index = 0;
  }

  function closeDrawer() {
    drawer.hidden = true;
    selectedStore = null;
    drawerTitle.textContent = 'Store';
    drawerBody.innerHTML = '';
  }

  document.getElementById('lbClose').onclick = function () { closeLightbox(); };
  document.getElementById('lbPrev').onclick = function () {
    if (!lightbox.items.length) return;
    lightbox.index = (lightbox.index - 1 + lightbox.items.length) % lightbox.items.length;
    renderLightbox();
  };
  document.getElementById('lbNext').onclick = function () {
    if (!lightbox.items.length) return;
    lightbox.index = (lightbox.index + 1) % lightbox.items.length;
    renderLightbox();
  };

  document.getElementById('lightbox').addEventListener('click', function (ev) {
    if (ev.target === document.getElementById('lightbox')) closeLightbox();
  });
  drawer.addEventListener('click', function (ev) {
    if (ev.target === drawer) closeDrawer();
  });
  document.addEventListener('keydown', function (ev) {
    if (ev.key !== 'Escape') return;
    if (!document.getElementById('lightbox').hidden) {
      closeLightbox();
      return;
    }
    if (!drawer.hidden) closeDrawer();
  });

  function qrUrl(text) {
    return 'https://quickchart.io/qr?size=160&text=' + encodeURIComponent(text);
  }

  async function openStore(storeNumber) {
    selectedStore = String(storeNumber);
    drawer.hidden = false;
    drawerTitle.textContent = 'FM ' + selectedStore;
    drawerBody.innerHTML = '<p class="muted">Loading…</p>';
    try {
      var data = await api('/' + encodeURIComponent(SLUG) + '/admin/store/' + encodeURIComponent(selectedStore));
      var linkUrl = (data.link && data.link.url) || '';
      var html = '<div class="row-actions">' +
        '<button type="button" class="btn secondary" id="copyLink">Copy packet link</button>' +
        '<button type="button" class="btn secondary" id="rotateLink">Rotate link</button>' +
        '</div>' +
        '<p class="muted" id="linkUrl" style="margin-top:8px;word-break:break-all">' + esc(linkUrl) + '</p>' +
        (linkUrl ? ('<img class="qr" alt="QR" src="' + esc(qrUrl(linkUrl)) + '">') : '') +
        '<label style="display:block;margin:12px 0"><input type="checkbox" id="storeBacklog"' +
        ((data.store && data.store.backlogComplete) ? ' checked' : '') + '> Backlog 100%</label>';

      (data.sets || []).forEach(function (set) {
        html += '<div class="set-card" data-set="' + set.id + '">' +
          '<div style="display:flex;justify-content:space-between;gap:8px;align-items:center">' +
          '<strong>' + esc(set.name) + '</strong>' +
          '<span class="pill ' + (set.readiness === 'Ready' ? 'ready' : set.readiness === 'Not Ready' ? 'notready' : 'oos') + '">' +
          esc(set.readiness) + '</span></div>' +
          '<div><code>' + esc(set.pogId || '—') + '</code> · ' + esc(set.location || '—') + '</div>' +
          '<div class="muted">Status: ' + esc(set.installStatus) +
          (set.leadName ? (' · ' + esc(set.leadName)) : '') +
          (set.completedDate ? (' · completed ' + esc(set.completedDate)) : '') + '</div>' +
          (set.issueNote ? ('<div class="flag">' + esc(set.issueNote) + '</div>') : '') +
          '<div class="row-actions">' +
          '<select data-act="readiness">' +
          ['Ready', 'Not Ready', 'Not in scope'].map(function (r) {
            return '<option value="' + r + '"' + (set.readiness === r ? ' selected' : '') + '>' + r + '</option>';
          }).join('') + '</select>' +
          '<select data-act="status">' +
          ['Not Started', 'In Progress', 'Complete', 'Issue', 'N/A'].map(function (r) {
            return '<option value="' + r + '"' + (set.installStatus === r ? ' selected' : '') + '>' + r + '</option>';
          }).join('') + '</select>' +
          '</div>';
        var groups = { before: [], after: [], worksheet: [] };
        (set.photos || []).forEach(function (p) {
          if (groups[p.kind]) groups[p.kind].push(p);
        });
        ['before', 'after', 'worksheet'].forEach(function (kind) {
          html += '<div class="muted" style="margin-top:8px">' + kind + '</div><div class="thumbs">';
          if (!groups[kind].length) html += '<span class="muted">None</span>';
          groups[kind].forEach(function (p) {
            html += '<div><img class="' + (p.rejectedAt ? 'rejected' : '') + '" data-auth-src="' + esc(p.url) +
              '" data-set="' + set.id + '" data-photo="' + p.id + '" alt="' + esc(kind) + '">' +
              (!p.rejectedAt ? ('<button type="button" class="btn danger" style="margin-top:4px;min-height:28px;font-size:12px" data-reject="' +
                p.id + '" data-set="' + set.id + '">Reject</button>') : '<div class="muted">Rejected</div>') +
              '</div>';
          });
          html += '</div>';
        });
        html += '</div>';
      });

      drawerBody.innerHTML = html;
      hydrateAuthImages(drawerBody);

      document.getElementById('copyLink').onclick = async function () {
        var url = document.getElementById('linkUrl').textContent || '';
        if (!url) return;
        try {
          await navigator.clipboard.writeText(url);
          statusEl.textContent = 'Packet link copied.';
        } catch (_) {
          statusEl.textContent = url;
        }
      };
      document.getElementById('rotateLink').onclick = async function () {
        if (!confirm('Revoke the current packet link and mint a new one?')) return;
        try {
          var rotated = await api('/' + encodeURIComponent(SLUG) + '/stores/' + encodeURIComponent(selectedStore) + '/link/rotate', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: '{}',
          });
          openStore(selectedStore);
          statusEl.textContent = 'Link rotated.';
          void rotated;
        } catch (err) {
          statusEl.textContent = err.message;
        }
      };
      document.getElementById('storeBacklog').onchange = async function (ev) {
        try {
          await api('/' + encodeURIComponent(SLUG) + '/stores/' + encodeURIComponent(selectedStore) + '/backlog', {
            method: 'PATCH',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ backlog_complete: !!ev.target.checked }),
          });
          await refresh();
        } catch (err) {
          statusEl.textContent = err.message;
          ev.target.checked = !ev.target.checked;
        }
      };

      var lbItems = [];
      (data.sets || []).forEach(function (set) {
        (set.photos || []).forEach(function (p) {
          lbItems.push({
            url: p.url,
            meta: set.name + ' · ' + p.kind + ' · ' + fmtTime(p.createdAt) + ' · ' + (p.actorEmail || ''),
          });
        });
      });
      drawerBody.querySelectorAll('img[data-photo]').forEach(function (img, idx) {
        img.addEventListener('click', function () { openLightbox(lbItems, idx); });
      });

      drawerBody.querySelectorAll('[data-act="readiness"]').forEach(function (sel) {
        sel.onchange = async function () {
          var id = sel.closest('[data-set]').getAttribute('data-set');
          try {
            await api('/sets/' + id + '/readiness', {
              method: 'PATCH',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ readiness: sel.value }),
            });
            openStore(selectedStore);
            await refresh();
          } catch (err) {
            statusEl.textContent = err.message;
            openStore(selectedStore);
          }
        };
      });
      drawerBody.querySelectorAll('[data-act="status"]').forEach(function (sel) {
        sel.onchange = async function () {
          var id = sel.closest('[data-set]').getAttribute('data-set');
          var body = { install_status: sel.value };
          if (sel.value === 'Issue') {
            var note = prompt('Issue note required');
            if (!note) { openStore(selectedStore); return; }
            body.issue_note = note;
          }
          try {
            await api('/sets/' + id, {
              method: 'PATCH',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify(body),
            });
            openStore(selectedStore);
            await refresh();
          } catch (err) {
            statusEl.textContent = err.message;
            openStore(selectedStore);
          }
        };
      });
      drawerBody.querySelectorAll('[data-reject]').forEach(function (btn) {
        btn.onclick = async function () {
          var note = prompt('Reject note required');
          if (!note) return;
          try {
            await api('/sets/' + btn.getAttribute('data-set') + '/photos/' + btn.getAttribute('data-reject') + '/reject', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ note: note }),
            });
            openStore(selectedStore);
            await refresh();
          } catch (err) {
            statusEl.textContent = err.message;
          }
        };
      });
    } catch (err) {
      drawerBody.innerHTML = '<p class="muted">' + esc(err.message) + '</p>';
    }
  }

  document.getElementById('drawerClose').onclick = function () { closeDrawer(); };

  // Start closed even if a stylesheet briefly overrides [hidden].
  closeDrawer();
  closeLightbox();

  document.querySelectorAll('.tab').forEach(function (tab) {
    tab.addEventListener('click', function () {
      document.querySelectorAll('.tab').forEach(function (t) { t.setAttribute('aria-selected', t === tab ? 'true' : 'false'); });
      var name = tab.getAttribute('data-tab');
      document.getElementById('panelStores').hidden = name !== 'stores';
      document.getElementById('panelIssues').hidden = name !== 'issues';
      document.getElementById('panelPhotos').hidden = name !== 'photos';
      if (name === 'photos') loadPhotoAudit();
    });
  });

  document.querySelectorAll('.chip.filter').forEach(function (btn) {
    btn.addEventListener('click', function () {
      storeFilter = btn.getAttribute('data-filter') || '';
      document.querySelectorAll('.chip.filter').forEach(function (b) {
        b.classList.toggle('on', b === btn);
      });
      paintGrid();
    });
  });

  document.querySelectorAll('#storeGrid th[data-sort]').forEach(function (th) {
    th.addEventListener('click', function () {
      var key = th.getAttribute('data-sort');
      if (sortKey === key) sortDir *= -1;
      else { sortKey = key; sortDir = 1; }
      paintGrid();
    });
  });

  chipsEl.addEventListener('click', function (ev) {
    var b = ev.target.closest('.chip');
    if (!b || !b.hasAttribute('data-d')) return;
    district = b.getAttribute('data-d') || '';
    var u = new URL(location.href);
    if (district) u.searchParams.set('district', district);
    else u.searchParams.delete('district');
    history.replaceState(null, '', u);
    refresh();
  });

  function pacificTodayYmd() {
    try {
      return new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/Los_Angeles',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(new Date());
    } catch (_) {
      return new Date().toISOString().slice(0, 10);
    }
  }

  function initSyncDates() {
    var today = pacificTodayYmd();
    var fromEl = document.getElementById('syncFrom');
    var toEl = document.getElementById('syncTo');
    if (fromEl && !fromEl.value) fromEl.value = today;
    if (toEl && !toEl.value) toEl.value = today;
  }

  var activeSyncJobId = null;

  function setSyncControls(running) {
    var syncBtn = document.getElementById('syncProdBtn');
    var stopBtn = document.getElementById('stopSyncBtn');
    if (syncBtn) syncBtn.disabled = !!running;
    if (stopBtn) stopBtn.disabled = !running;
  }

  function formatSyncSummary(status, summary) {
    var s = summary || {};
    var prefix = status === 'stopped' ? 'Sync stopped' : 'Sync done';
    var storeBit = s.storeNumber ? ('FM ' + s.storeNumber + ' — ') : '';
    return prefix + ' — ' + storeBit + 'matched ' + (s.setsMatched || 0)
      + ', photos +' + (s.photosAdded || 0)
      + ', completed ' + (s.completed || 0)
      + (s.errors && s.errors.length ? (', errors ' + s.errors.length) : '');
  }

  function syncStoreNumber() {
    var el = document.getElementById('syncStore');
    var raw = el && el.value != null ? String(el.value) : '';
    var digits = raw.replace(/\D/g, '').replace(/^0+(?=\d)/, '');
    return digits || '';
  }

  async function pollSyncJob(jobId) {
    var syncStatusEl = document.getElementById('syncStatus');
    for (;;) {
      var data = await api('/' + encodeURIComponent(SLUG) + '/admin/sync-prod/' + encodeURIComponent(jobId));
      var progress = data.progress || data.status || '';
      if (syncStatusEl) {
        if (data.status === 'running') {
          syncStatusEl.textContent = (data.cancelRequested ? 'Stopping… ' : 'Syncing… ') + progress;
        } else if (data.status === 'done') {
          syncStatusEl.textContent = 'Sync done.';
        } else if (data.status === 'stopped') {
          syncStatusEl.textContent = 'Sync stopped.';
        } else {
          syncStatusEl.textContent = 'Sync ' + (data.status || '') + (data.error ? (': ' + data.error) : '');
        }
      }
      if (data.status === 'done' || data.status === 'error' || data.status === 'stopped') {
        return data;
      }
      await new Promise(function (r) { setTimeout(r, 2000); });
    }
  }

  document.getElementById('refreshBtn').onclick = function () { refresh(); };
  document.getElementById('stopSyncBtn').onclick = async function () {
    if (!activeSyncJobId) return;
    var syncStatusEl = document.getElementById('syncStatus');
    var stopBtn = document.getElementById('stopSyncBtn');
    if (stopBtn) stopBtn.disabled = true;
    try {
      await api('/' + encodeURIComponent(SLUG) + '/admin/sync-prod/' + encodeURIComponent(activeSyncJobId) + '/stop', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      });
      if (syncStatusEl) syncStatusEl.textContent = 'Stopping…';
    } catch (err) {
      if (syncStatusEl) syncStatusEl.textContent = err.message || 'Could not stop sync';
      if (stopBtn) stopBtn.disabled = false;
    }
  };
  document.getElementById('syncProdBtn').onclick = async function () {
    var syncStatusEl = document.getElementById('syncStatus');
    var from = document.getElementById('syncFrom').value;
    var to = document.getElementById('syncTo').value;
    var store = syncStoreNumber();
    if (!from || !to) {
      if (syncStatusEl) syncStatusEl.textContent = 'Pick From and To dates.';
      return;
    }
    var scope = store ? ('FM ' + store + ' for ' + from + ' → ' + to) : (from + ' → ' + to);
    if (!window.confirm('Sync Cut-In PROD photos for ' + scope + ' into empty board slots?')) return;
    setSyncControls(true);
    if (syncStatusEl) syncStatusEl.textContent = store ? ('Starting sync for FM ' + store + '…') : 'Starting sync…';
    try {
      var body = { from: from, to: to };
      if (district) body.district = district;
      if (store) body.storeNumber = store;
      var started = await api('/' + encodeURIComponent(SLUG) + '/admin/sync-prod', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      activeSyncJobId = started.jobId;
      var result = await pollSyncJob(started.jobId);
      if (result.status === 'error') {
        throw new Error(result.error || 'Sync failed');
      }
      if (syncStatusEl) syncStatusEl.textContent = formatSyncSummary(result.status, result.summary);
      await refresh();
    } catch (err) {
      if (syncStatusEl) syncStatusEl.textContent = err.message || 'Sync failed';
    } finally {
      activeSyncJobId = null;
      setSyncControls(false);
    }
  };
  document.getElementById('exportBtn').onclick = async function () {
    statusEl.textContent = 'Building export…';
    try {
      var q = district ? ('?district=' + encodeURIComponent(district)) : '';
      var res = await authFetch(API + '/' + encodeURIComponent(SLUG) + '/admin/export.xlsx' + q);
      if (!res.ok) throw new Error('Export failed');
      var blob = await res.blob();
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = SLUG + '-admin.xlsx';
      document.body.appendChild(a);
      a.click();
      a.remove();
      statusEl.textContent = 'Exported.';
    } catch (err) {
      statusEl.textContent = err.message || 'Export failed';
    }
  };

  document.getElementById('feedStore').oninput = function () { loadEvents(); };
  document.getElementById('feedAction').onchange = function () { loadEvents(); };

  async function loadEvents() {
    var q = new URLSearchParams();
    if (district) q.set('district', district);
    var store = document.getElementById('feedStore').value.replace(/\D/g, '');
    if (store) q.set('store', store);
    var action = document.getElementById('feedAction').value;
    if (action) q.set('action', action);
    q.set('limit', '60');
    var data = await api('/' + encodeURIComponent(SLUG) + '/admin/events?' + q.toString());
    events = data.events || [];
    paintFeed();
  }

  async function loadPhotoAudit() {
    var q = district ? ('?district=' + encodeURIComponent(district)) : '';
    photoAudit = await api('/' + encodeURIComponent(SLUG) + '/admin/photos' + q);
    paintPhotoAudit();
  }

  async function refresh() {
    var q = district ? ('?district=' + encodeURIComponent(district)) : '';
    overview = await api('/' + encodeURIComponent(SLUG) + '/admin/overview' + q);
    if (!district && overview.defaultDistricts && overview.defaultDistricts.length === 1) {
      district = overview.defaultDistricts[0];
      var u = new URL(location.href);
      u.searchParams.set('district', district);
      history.replaceState(null, '', u);
      overview = await api('/' + encodeURIComponent(SLUG) + '/admin/overview?district=' + encodeURIComponent(district));
    }
    if (titleEl) titleEl.textContent = (overview.project && overview.project.name) || SLUG;
    if (subtitleEl) subtitleEl.textContent = 'Supervisor overview · ' + SLUG;
    lastUpdatedEl.textContent = 'Updated ' + fmtTime(new Date().toISOString());
    paintChips();
    paintTiles();
    paintGrid();
    paintIssues();
    await loadEvents();
    if (!document.getElementById('panelPhotos').hidden) await loadPhotoAudit();
    statusEl.textContent = '';
  }

  (async function boot() {
    statusEl.textContent = 'Loading…';
    initSyncDates();
    try {
      if (window.dumpBinAuthReady) await window.dumpBinAuthReady;
      await ensureAccess();
      await refresh();
      timer = setInterval(function () {
        refresh().catch(function (err) { statusEl.textContent = err.message; });
      }, 30000);
    } catch (err) {
      statusEl.textContent = err.message || 'Could not load admin overview';
    }
  })();
})();
