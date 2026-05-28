/**
 * Checklane Hub — floating team chat (rep ↔ lead/supervisor).
 * Depends on hub globals: liveVisitId, hubGet, hubPost, hubContext, escapeHtml,
 * canManageHubAssignments, openBulkAssignPanel.
 */
(function (global) {
  'use strict';

  const POS_KEY = 'checklane-hub-chat-pos';
  const OPEN_KEY = 'checklane-hub-chat-open';

  let unreadTotal = 0;
  let threads = [];
  let activeThreadId = null;
  let activeRepId = null;
  let messages = [];
  let panelOpen = false;
  let loadingMessages = false;

  function canManage() {
    return typeof canManageHubAssignments === 'function' && canManageHubAssignments();
  }

  function formatTime(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  }

  function formatDay(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    const today = new Date();
    if (d.toDateString() === today.toDateString()) return 'Today';
    return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  }

  function messageLabel(msg) {
    if (msg.messageType === 'request_next_set') return 'Ready for next set';
    return msg.body;
  }

  function savePosition(x, y) {
    try { localStorage.setItem(POS_KEY, JSON.stringify({ x, y })); } catch (_) { /* ignore */ }
  }

  function loadPosition() {
    try {
      const raw = localStorage.getItem(POS_KEY);
      if (!raw) return null;
      const p = JSON.parse(raw);
      if (Number.isFinite(p.x) && Number.isFinite(p.y)) return p;
    } catch (_) { /* ignore */ }
    return null;
  }

  function ensureDom() {
    if (document.getElementById('hub-chat-root')) return;

    const root = document.createElement('div');
    root.id = 'hub-chat-root';
    root.className = 'hub-chat-root';
    root.innerHTML =
      '<button type="button" class="hub-chat-bubble" id="hub-chat-bubble" aria-label="Team chat" aria-expanded="false">' +
        '<svg class="hub-chat-bubble-icon" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H5.2L4 17.2V4h16v12z"/></svg>' +
        '<span class="hub-chat-badge" id="hub-chat-badge" hidden></span>' +
      '</button>' +
      '<div class="hub-chat-panel" id="hub-chat-panel" hidden role="dialog" aria-label="Team chat">' +
        '<div class="hub-chat-panel-header" id="hub-chat-panel-header">' +
          '<button type="button" class="hub-chat-back" id="hub-chat-back" hidden aria-label="Back to threads">←</button>' +
          '<div class="hub-chat-panel-title" id="hub-chat-panel-title">Team chat</div>' +
          '<button type="button" class="hub-chat-close" id="hub-chat-close" aria-label="Close chat">&times;</button>' +
        '</div>' +
        '<div class="hub-chat-thread-list" id="hub-chat-thread-list" hidden></div>' +
        '<div class="hub-chat-messages-wrap" id="hub-chat-messages-wrap">' +
          '<div class="hub-chat-messages" id="hub-chat-messages"></div>' +
        '</div>' +
        '<div class="hub-chat-quick-actions" id="hub-chat-quick-actions"></div>' +
        '<form class="hub-chat-compose" id="hub-chat-compose">' +
          '<textarea class="hub-chat-input" id="hub-chat-input" rows="2" maxlength="2000" placeholder="Message…" aria-label="Message"></textarea>' +
          '<button type="submit" class="hub-chat-send" id="hub-chat-send">Send</button>' +
        '</form>' +
      '</div>';
    document.body.appendChild(root);

    const bubble = document.getElementById('hub-chat-bubble');
    const panel = document.getElementById('hub-chat-panel');
    const saved = loadPosition();
    if (saved) {
      root.style.left = saved.x + 'px';
      root.style.top = saved.y + 'px';
      root.style.right = 'auto';
      root.style.bottom = 'auto';
    }

    bubble.addEventListener('click', function (e) {
      if (bubble.dataset.dragged === '1') {
        bubble.dataset.dragged = '0';
        return;
      }
      togglePanel(!panelOpen);
    });

    document.getElementById('hub-chat-close').addEventListener('click', function () {
      togglePanel(false);
    });
    document.getElementById('hub-chat-back').addEventListener('click', function () {
      activeThreadId = null;
      activeRepId = null;
      messages = [];
      render();
    });
    document.getElementById('hub-chat-compose').addEventListener('submit', function (e) {
      e.preventDefault();
      sendCurrentMessage();
    });

    setupDrag(bubble, root);
    setupDrag(document.getElementById('hub-chat-panel-header'), root, true);

    if (localStorage.getItem(OPEN_KEY) === '1') {
      togglePanel(true, true);
    }
  }

  function setupDrag(handle, container, panelMode) {
    let startX = 0;
    let startY = 0;
    let originX = 0;
    let originY = 0;
    let dragging = false;

    function onPointerDown(e) {
      if (panelMode && e.target.closest('button')) return;
      dragging = true;
      const rect = container.getBoundingClientRect();
      originX = rect.left;
      originY = rect.top;
      startX = e.clientX;
      startY = e.clientY;
      container.style.right = 'auto';
      container.style.bottom = 'auto';
      container.setPointerCapture(e.pointerId);
      e.preventDefault();
    }

    function onPointerMove(e) {
      if (!dragging) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      const x = Math.max(8, Math.min(window.innerWidth - 56, originX + dx));
      const y = Math.max(8, Math.min(window.innerHeight - 56, originY + dy));
      container.style.left = x + 'px';
      container.style.top = y + 'px';
      if (Math.abs(dx) > 4 || Math.abs(dy) > 4) {
        handle.dataset.dragged = '1';
      }
    }

    function onPointerUp(e) {
      if (!dragging) return;
      dragging = false;
      try { container.releasePointerCapture(e.pointerId); } catch (_) { /* ignore */ }
      const rect = container.getBoundingClientRect();
      savePosition(rect.left, rect.top);
    }

    handle.addEventListener('pointerdown', onPointerDown);
    handle.addEventListener('pointermove', onPointerMove);
    handle.addEventListener('pointerup', onPointerUp);
    handle.addEventListener('pointercancel', onPointerUp);
  }

  function updateBadge() {
    const badge = document.getElementById('hub-chat-badge');
    if (!badge) return;
    if (unreadTotal > 0) {
      badge.hidden = false;
      badge.textContent = unreadTotal > 99 ? '99+' : String(unreadTotal);
    } else {
      badge.hidden = true;
    }
  }

  function togglePanel(open, skipLoad) {
    panelOpen = open;
    const panel = document.getElementById('hub-chat-panel');
    const bubble = document.getElementById('hub-chat-bubble');
    if (!panel || !bubble) return;
    panel.hidden = !open;
    bubble.setAttribute('aria-expanded', open ? 'true' : 'false');
    try { localStorage.setItem(OPEN_KEY, open ? '1' : '0'); } catch (_) { /* ignore */ }
    if (open && !skipLoad) {
      loadThreads().then(function () {
        if (!canManage() && threads.length === 1) {
          openThread(threads[0].id);
        } else {
          render();
        }
      });
    } else {
      render();
    }
  }

  async function loadThreads() {
    if (!liveVisitId) return;
    try {
      const data = await hubGet('/chat/threads');
      threads = data.threads || [];
      unreadTotal = data.unreadTotal || 0;
      updateBadge();
    } catch (err) {
      console.warn('[Hub chat] load threads failed:', err);
    }
  }

  async function openThread(threadId, repId) {
    activeThreadId = threadId || null;
    activeRepId = repId || null;
    if (!activeThreadId) {
      messages = [];
      loadingMessages = false;
      render();
      return;
    }
    loadingMessages = true;
    render();
    try {
      const data = await hubGet('/chat/threads/' + encodeURIComponent(threadId) + '/messages');
      messages = data.messages || [];
      loadingMessages = false;
      render();
      scrollMessagesToBottom();
      if (messages.length) {
        const last = messages[messages.length - 1];
        await hubPost('/chat/threads/' + encodeURIComponent(threadId) + '/read', {
          lastMessageId: last.id,
        });
        const t = threads.find(function (x) { return x.id === threadId; });
        if (t) t.unreadCount = 0;
        unreadTotal = threads.reduce(function (sum, x) { return sum + (x.unreadCount || 0); }, 0);
        updateBadge();
      }
    } catch (err) {
      loadingMessages = false;
      render();
      console.warn('[Hub chat] load messages failed:', err);
    }
  }

  function scrollMessagesToBottom() {
    const wrap = document.getElementById('hub-chat-messages-wrap');
    if (wrap) wrap.scrollTop = wrap.scrollHeight;
  }

  async function sendCurrentMessage(messageType, bodyOverride) {
    const input = document.getElementById('hub-chat-input');
    const body = bodyOverride != null ? bodyOverride : (input && input.value.trim());
    if (!body) return;

    const payload = { body: body, messageType: messageType || 'chat' };
    if (activeThreadId) payload.threadId = activeThreadId;
    else if (activeRepId) payload.repId = activeRepId;
    else if (canManage() && threads.length === 1 && threads[0].id) payload.threadId = threads[0].id;

    try {
      const result = await hubPost('/chat/messages', payload);
      if (input && bodyOverride == null) input.value = '';
      if (!activeThreadId && result.thread) {
        activeThreadId = result.thread.id;
        activeRepId = result.thread.repId;
      }
      if (result.message) {
        messages.push(result.message);
        render();
        scrollMessagesToBottom();
        await hubPost('/chat/threads/' + encodeURIComponent(result.thread.id) + '/read', {
          lastMessageId: result.message.id,
        });
      }
      await loadThreads();
    } catch (err) {
      console.warn('[Hub chat] send failed:', err);
      alert(err.message || 'Could not send message');
    }
  }

  function renderThreadList() {
    const list = document.getElementById('hub-chat-thread-list');
    if (!list) return;
    if (!canManage()) {
      list.hidden = true;
      return;
    }
    list.hidden = !!(activeThreadId || activeRepId);
    if (activeThreadId || activeRepId) return;

    if (!threads.length) {
      list.innerHTML = '<p class="hub-chat-empty">No conversations yet. Reps will appear here when they message the team.</p>';
      return;
    }

    list.innerHTML = threads.map(function (t) {
      const preview = t.lastMessage ? messageLabel(t.lastMessage) : 'No messages yet';
      const badge = t.unreadCount
        ? '<span class="hub-chat-thread-unread">' + (t.unreadCount > 99 ? '99+' : t.unreadCount) + '</span>'
        : '';
      const dataAttrs = t.id
        ? ' data-thread-id="' + t.id + '"'
        : ' data-rep-id="' + t.repId + '"';
      return (
        '<button type="button" class="hub-chat-thread-item"' + dataAttrs + '>' +
          '<span class="hub-chat-thread-name">' + escapeHtml(t.repName) + badge + '</span>' +
          '<span class="hub-chat-thread-preview">' + escapeHtml(preview) + '</span>' +
        '</button>'
      );
    }).join('');

    list.querySelectorAll('[data-thread-id]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        openThread(Number(btn.getAttribute('data-thread-id')), null);
      });
    });
    list.querySelectorAll('[data-rep-id]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        openThread(null, Number(btn.getAttribute('data-rep-id')));
      });
    });
  }

  function renderMessages() {
    const el = document.getElementById('hub-chat-messages');
    const wrap = document.getElementById('hub-chat-messages-wrap');
    const backBtn = document.getElementById('hub-chat-back');
    const title = document.getElementById('hub-chat-panel-title');
    if (!el || !wrap) return;

    const showMessages = !canManage() || activeThreadId || activeRepId;
    wrap.hidden = !showMessages;
    if (backBtn) backBtn.hidden = !canManage() || (!activeThreadId && !activeRepId);

    if (canManage() && (activeThreadId || activeRepId)) {
      const t = threads.find(function (x) {
        return activeThreadId ? x.id === activeThreadId : x.repId === activeRepId;
      });
      if (title) title.textContent = t ? t.repName : 'Conversation';
    } else if (title) {
      title.textContent = canManage() ? 'Team chat' : 'Message your lead';
    }

    if (!showMessages) {
      el.innerHTML = '';
      return;
    }

    if (loadingMessages) {
      el.innerHTML = '<p class="hub-chat-empty">Loading…</p>';
      return;
    }

    if (!messages.length) {
      el.innerHTML = '<p class="hub-chat-empty">No messages yet. Say hello or request your next set.</p>';
      return;
    }

    let lastDay = '';
    el.innerHTML = messages.map(function (msg) {
      const day = formatDay(msg.createdAt);
      let dayHtml = '';
      if (day && day !== lastDay) {
        lastDay = day;
        dayHtml = '<div class="hub-chat-day">' + escapeHtml(day) + '</div>';
      }
      const mine = hubContext.myUserId && msg.senderId === hubContext.myUserId;
      const typeClass = msg.messageType === 'request_next_set' ? ' hub-chat-msg--request' : '';
      return dayHtml +
        '<div class="hub-chat-msg' + (mine ? ' hub-chat-msg--mine' : '') + typeClass + '">' +
          '<div class="hub-chat-msg-meta">' +
            '<span class="hub-chat-msg-sender">' + escapeHtml(msg.senderName) + '</span>' +
            '<span class="hub-chat-msg-time">' + escapeHtml(formatTime(msg.createdAt)) + '</span>' +
          '</div>' +
          '<div class="hub-chat-msg-body">' + escapeHtml(messageLabel(msg)) + '</div>' +
        '</div>';
    }).join('');
  }

  function renderQuickActions() {
    const el = document.getElementById('hub-chat-quick-actions');
    if (!el) return;
    const show = panelOpen && (!canManage() || activeThreadId || activeRepId);
    if (!show) {
      el.innerHTML = '';
      el.hidden = true;
      return;
    }
    el.hidden = false;

    if (!canManage()) {
      el.innerHTML =
        '<button type="button" class="hub-chat-quick-btn" id="hub-chat-request-set">Ready for next set</button>';
      document.getElementById('hub-chat-request-set').addEventListener('click', function () {
        sendCurrentMessage('request_next_set', 'I finished my current set — ready for the next assignment.');
      });
      return;
    }

    el.innerHTML =
      '<button type="button" class="hub-chat-quick-btn hub-chat-quick-btn--primary" id="hub-chat-assign-sets">Assign sets</button>';
    document.getElementById('hub-chat-assign-sets').addEventListener('click', function () {
      if (typeof openBulkAssignPanel === 'function') openBulkAssignPanel();
    });
  }

  function render() {
    renderThreadList();
    renderMessages();
    renderQuickActions();
    updateBadge();
  }

  function onSnapshot(snapshot) {
    if (snapshot && snapshot.chatSummary) {
      unreadTotal = snapshot.chatSummary.unreadTotal || 0;
      updateBadge();
    }
  }

  function onChatEvent(evt) {
    if (!evt) return;
    if (evt.chatSummary) {
      unreadTotal = evt.chatSummary.unreadTotal || 0;
      updateBadge();
    }
    if (panelOpen) {
      loadThreads().then(function () {
        if (activeThreadId && evt.type === 'message' && evt.threadId === activeThreadId && evt.message) {
          const exists = messages.some(function (m) { return m.id === evt.message.id; });
          if (!exists) {
            messages.push(evt.message);
            render();
            scrollMessagesToBottom();
            if (evt.message.senderId !== hubContext.myUserId) {
              hubPost('/chat/threads/' + encodeURIComponent(activeThreadId) + '/read', {
                lastMessageId: evt.message.id,
              }).catch(function () { /* ignore */ });
            }
          }
        } else {
          render();
        }
      });
    }
  }

  function init() {
    ensureDom();
    updateBadge();
  }

  global.HubChat = {
    init: init,
    onSnapshot: onSnapshot,
    onChatEvent: onChatEvent,
    loadThreads: loadThreads,
  };
})(window);
