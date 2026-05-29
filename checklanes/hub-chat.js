/**
 * Checklane Hub — floating team chat (rep ↔ lead/supervisor).
 *
 * Leads/supervisors open to an inbox of conversations grouped by sender,
 * with unread ones surfaced first. Reps land directly in their own thread.
 * Live updates arrive over the hub SSE stream (chat + snapshot events).
 */
(function (global) {
  'use strict';

  const POS_KEY = 'checklane-hub-chat-pos';

  let unreadTotal = 0;
  let recipients = [];
  let threads = [];
  let selectedRecipientId = null;
  let activeThreadId = null;
  let messages = [];
  let panelOpen = false;
  let loadingMessages = false;
  let statusMessage = '';
  // 'inbox' | 'conversation' — reps always use 'conversation'.
  let chatView = 'conversation';
  // When true the recipient is locked (manager opened an existing rep thread).
  let fixedRecipient = false;

  // Polling fallback. SSE can be buffered/closed by the CDN (Cloudflare), so we
  // poll as a reliable backstop: fast while the panel is open, slow for the
  // unread badge while it's closed. Paused when the tab is hidden.
  let pollTimer = null;
  let pollInFlight = false;
  const POLL_OPEN_MS = 4000;
  const POLL_BADGE_MS = 20000;
  let chatReady = false;
  let lastUnreadTotal = 0;

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

  function relativeTime(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    const today = new Date();
    if (d.toDateString() === today.toDateString()) return formatTime(iso);
    return formatDay(iso);
  }

  function messageLabel(msg) {
    if (!msg) return '';
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

  function clampPosition(x, y, el) {
    const w = el ? el.offsetWidth : 38;
    const h = el ? el.offsetHeight : 38;
    return {
      x: Math.max(8, Math.min(window.innerWidth - w - 8, x)),
      y: Math.max(8, Math.min(window.innerHeight - h - 8, y)),
    };
  }

  function setStatus(msg) {
    statusMessage = msg || '';
    const el = document.getElementById('hub-chat-status');
    if (!el) return;
    if (statusMessage) {
      el.textContent = statusMessage;
      el.hidden = false;
    } else {
      el.textContent = '';
      el.hidden = true;
    }
  }

  function ensureDom() {
    if (document.getElementById('hub-chat-root')) return;

    const root = document.createElement('div');
    root.id = 'hub-chat-root';
    root.className = 'hub-chat-root';
    root.innerHTML =
      '<div class="hub-chat-launcher" id="hub-chat-launcher">' +
        '<button type="button" class="hub-chat-drag-handle" id="hub-chat-drag-handle" aria-label="Move chat" title="Drag to move">' +
          '<span aria-hidden="true">⋮⋮</span>' +
        '</button>' +
        '<button type="button" class="hub-chat-bubble" id="hub-chat-bubble" aria-label="Team chat" aria-expanded="false" title="Open chat">' +
          '<svg class="hub-chat-bubble-icon" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H5.2L4 17.2V4h16v12z"/></svg>' +
          '<span class="hub-chat-badge" id="hub-chat-badge" hidden></span>' +
        '</button>' +
      '</div>' +
      '<div class="hub-chat-panel" id="hub-chat-panel" role="dialog" aria-label="Team chat" aria-modal="false">' +
        '<div class="hub-chat-panel-header">' +
          '<button type="button" class="hub-chat-back" id="hub-chat-back" aria-label="Back to inbox" title="Back" hidden>←</button>' +
          '<div class="hub-chat-panel-title" id="hub-chat-panel-title">Team chat</div>' +
          '<button type="button" class="hub-chat-minimize" id="hub-chat-minimize" aria-label="Minimize chat" title="Minimize">&minus;</button>' +
        '</div>' +
        '<div class="hub-chat-inbox" id="hub-chat-inbox" hidden>' +
          '<button type="button" class="hub-chat-new-btn" id="hub-chat-new-btn">+ New message</button>' +
          '<div class="hub-chat-inbox-list" id="hub-chat-inbox-list"></div>' +
        '</div>' +
        '<div class="hub-chat-conversation" id="hub-chat-conversation">' +
          '<div class="hub-chat-recipient-row" id="hub-chat-recipient-row">' +
            '<label class="hub-chat-recipient-label" for="hub-chat-recipient">To</label>' +
            '<select class="hub-chat-recipient-select" id="hub-chat-recipient" aria-label="Message recipient">' +
              '<option value="">Choose recipient…</option>' +
            '</select>' +
          '</div>' +
          '<div class="hub-chat-status" id="hub-chat-status" hidden role="status"></div>' +
          '<div class="hub-chat-messages-wrap" id="hub-chat-messages-wrap">' +
            '<div class="hub-chat-messages" id="hub-chat-messages"></div>' +
          '</div>' +
          '<div class="hub-chat-quick-actions" id="hub-chat-quick-actions"></div>' +
          '<form class="hub-chat-compose" id="hub-chat-compose">' +
            '<textarea class="hub-chat-input" id="hub-chat-input" rows="2" maxlength="2000" placeholder="Type a message…" aria-label="Message"></textarea>' +
            '<button type="submit" class="hub-chat-send" id="hub-chat-send">Send</button>' +
          '</form>' +
        '</div>' +
      '</div>';
    document.body.appendChild(root);

    const saved = loadPosition();
    if (saved) {
      const clamped = clampPosition(saved.x, saved.y, root);
      root.style.left = clamped.x + 'px';
      root.style.top = clamped.y + 'px';
      root.style.right = 'auto';
      root.style.bottom = 'auto';
    }

    document.getElementById('hub-chat-bubble').addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      togglePanel(!panelOpen);
    });

    document.getElementById('hub-chat-minimize').addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      togglePanel(false);
    });

    document.getElementById('hub-chat-back').addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      openInbox();
    });

    document.getElementById('hub-chat-new-btn').addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      openNewMessage();
    });

    document.getElementById('hub-chat-recipient').addEventListener('change', function () {
      selectedRecipientId = this.value ? Number(this.value) : null;
      loadConversation();
    });

    document.getElementById('hub-chat-compose').addEventListener('submit', function (e) {
      e.preventDefault();
      sendCurrentMessage();
    });

    document.getElementById('hub-chat-inbox-list').addEventListener('click', function (e) {
      const item = e.target.closest('[data-rep-id]');
      if (!item) return;
      openConversationWithRep(Number(item.getAttribute('data-rep-id')));
    });

    setupDrag(document.getElementById('hub-chat-drag-handle'), root);
  }

  function setupDrag(handle, container) {
    let startX = 0;
    let startY = 0;
    let originX = 0;
    let originY = 0;
    let dragging = false;

    handle.addEventListener('pointerdown', function (e) {
      dragging = false;
      const rect = container.getBoundingClientRect();
      originX = rect.left;
      originY = rect.top;
      startX = e.clientX;
      startY = e.clientY;
      handle.setPointerCapture(e.pointerId);
      e.preventDefault();
      e.stopPropagation();
    });

    handle.addEventListener('pointermove', function (e) {
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      if (!dragging && (Math.abs(dx) > 3 || Math.abs(dy) > 3)) dragging = true;
      if (!dragging) return;
      container.style.right = 'auto';
      container.style.bottom = 'auto';
      const clamped = clampPosition(originX + dx, originY + dy, container);
      container.style.left = clamped.x + 'px';
      container.style.top = clamped.y + 'px';
      e.preventDefault();
    });

    function endDrag(e) {
      if (!handle.hasPointerCapture(e.pointerId)) return;
      try { handle.releasePointerCapture(e.pointerId); } catch (_) { /* ignore */ }
      if (dragging) {
        const rect = container.getBoundingClientRect();
        savePosition(rect.left, rect.top);
      }
      dragging = false;
    }

    handle.addEventListener('pointerup', endDrag);
    handle.addEventListener('pointercancel', endDrag);
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
    updateHeaderChatBtn();
  }

  function updateHeaderChatBtn() {
    const btn = document.getElementById('hub-header-chat-btn');
    const dot = document.getElementById('hub-header-chat-dot');
    if (!btn) return;
    const unreadLabel = unreadTotal > 0
      ? 'Team chat, ' + (unreadTotal > 99 ? '99+' : unreadTotal) + ' unread'
      : 'Team chat';
    btn.setAttribute('aria-label', unreadLabel);
    btn.title = unreadTotal > 0 ? unreadLabel : 'Open team chat';
    btn.classList.toggle('is-open', panelOpen);
    if (dot) dot.hidden = unreadTotal <= 0;
  }

  function showHeaderChatBtn(visible) {
    const btn = document.getElementById('hub-header-chat-btn');
    if (!btn) return;
    if (visible) {
      btn.removeAttribute('hidden');
      btn.classList.add('visible');
    } else {
      btn.setAttribute('hidden', '');
      btn.classList.remove('visible');
    }
  }

  function wireHeaderChatBtn() {
    const btn = document.getElementById('hub-header-chat-btn');
    if (!btn || btn.dataset.hubChatWired) return;
    btn.dataset.hubChatWired = '1';
    btn.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      togglePanel(!panelOpen);
    });
  }

  function shouldAutoOpenPanel(evt, prevUnread) {
    if (panelOpen) return false;
    if (
      evt &&
      evt.type === 'message' &&
      evt.message &&
      hubContext.myUserId &&
      evt.message.senderId !== hubContext.myUserId
    ) {
      return true;
    }
    return chatReady && unreadTotal > prevUnread;
  }

  async function openPanelForIncoming(evt) {
    if (panelOpen) return;
    const panel = document.getElementById('hub-chat-panel');
    const bubble = document.getElementById('hub-chat-bubble');
    if (!panel || !bubble) return;

    panelOpen = true;
    panel.classList.add('is-open');
    bubble.setAttribute('aria-expanded', 'true');
    updateHeaderChatBtn();
    scheduleNextPoll();

    setStatus('Loading…');
    try {
      await Promise.all([loadRecipients(), loadThreads()]);
      renderRecipientSelect();
      setStatus('');

      if (evt && evt.threadId) {
        const thread = threads.find(function (t) { return t.id === evt.threadId; });
        if (thread && canManage()) {
          openConversationWithRep(thread.repId);
          return;
        }
      }

      if (canManage()) {
        openInbox();
      } else {
        if (!selectedRecipientId && recipients.length) {
          selectedRecipientId = recipients[0].id;
        }
        openConversation();
      }
    } catch (err) {
      setStatus(err.message || 'Could not load chat');
      chatView = 'conversation';
      applyViewVisibility();
      render();
    }
  }

  function maybeAutoOpenPanel(evt, prevUnread) {
    if (!shouldAutoOpenPanel(evt, prevUnread)) return Promise.resolve();
    return openPanelForIncoming(evt);
  }

  function togglePanel(open) {
    panelOpen = open;
    const panel = document.getElementById('hub-chat-panel');
    const bubble = document.getElementById('hub-chat-bubble');
    if (!panel || !bubble) return;

    panel.classList.toggle('is-open', open);
    bubble.setAttribute('aria-expanded', open ? 'true' : 'false');
    updateHeaderChatBtn();

    if (open) {
      bootstrapPanel();
    } else {
      setStatus('');
    }
    scheduleNextPoll();
  }

  async function bootstrapPanel() {
    setStatus('Loading…');
    try {
      await Promise.all([loadRecipients(), loadThreads()]);
      renderRecipientSelect();
      setStatus('');

      if (canManage()) {
        openInbox();
      } else {
        // Reps: default to their single thread; pick a default lead to address.
        if (!selectedRecipientId && recipients.length) {
          selectedRecipientId = recipients[0].id;
        }
        openConversation();
      }
    } catch (err) {
      setStatus(err.message || 'Could not load chat');
      chatView = 'conversation';
      applyViewVisibility();
      render();
    }
  }

  async function loadRecipients() {
    if (!liveVisitId) throw new Error('No active visit');
    const data = await hubGet('/chat/recipients');
    recipients = data.recipients || [];
    if (!recipients.length) {
      throw new Error('No message recipients available for this store');
    }
  }

  async function loadThreads() {
    if (!liveVisitId) return;
    const prevUnread = unreadTotal;
    const data = await hubGet('/chat/threads');
    threads = data.threads || [];
    unreadTotal = data.unreadTotal || 0;
    updateBadge();
    await maybeAutoOpenPanel(null, prevUnread);
    lastUnreadTotal = unreadTotal;
  }

  // ── Polling backstop ──

  function scheduleNextPoll() {
    if (pollTimer) clearTimeout(pollTimer);
    const delay = panelOpen ? POLL_OPEN_MS : POLL_BADGE_MS;
    pollTimer = setTimeout(pollTick, delay);
  }

  function startPolling() {
    if (pollTimer) clearTimeout(pollTimer);
    scheduleNextPoll();
  }

  async function pollTick() {
    pollTimer = null;
    if (!liveVisitId || (typeof document !== 'undefined' && document.hidden) || pollInFlight) {
      scheduleNextPoll();
      return;
    }
    pollInFlight = true;
    try {
      await loadThreads();
      if (panelOpen) {
        if (canManage() && chatView === 'inbox') {
          renderInbox();
        } else if (activeThreadId) {
          await refreshActiveConversation();
        }
      }
    } catch (_) {
      /* transient; try again next tick */
    } finally {
      pollInFlight = false;
      scheduleNextPoll();
    }
  }

  async function refreshActiveConversation() {
    if (!activeThreadId) return;
    const data = await hubGet('/chat/threads/' + encodeURIComponent(activeThreadId) + '/messages');
    const incoming = data.messages || [];
    const lastKnown = messages.length ? messages[messages.length - 1].id : 0;
    const hasNew = incoming.some(function (m) { return m.id > lastKnown; });
    if (!hasNew && incoming.length === messages.length) return;

    const nearBottom = isScrolledNearBottom();
    messages = incoming;
    render();
    if (nearBottom) scrollMessagesToBottom();

    if (messages.length) {
      const last = messages[messages.length - 1];
      if (last.id > lastKnown && last.senderId !== hubContext.myUserId) {
        try {
          await hubPost('/chat/threads/' + encodeURIComponent(activeThreadId) + '/read', {
            lastMessageId: last.id,
          });
          const t = threads.find(function (x) { return x.id === activeThreadId; });
          if (t) t.unreadCount = 0;
          unreadTotal = threads.reduce(function (sum, x) { return sum + (x.unreadCount || 0); }, 0);
          updateBadge();
        } catch (_) { /* ignore */ }
      }
    }
  }

  function renderRecipientSelect() {
    const sel = document.getElementById('hub-chat-recipient');
    if (!sel) return;
    const options = recipients.map(function (r) {
      const selected = selectedRecipientId != null && Number(r.id) === Number(selectedRecipientId)
        ? ' selected' : '';
      return (
        '<option value="' + escapeHtml(String(r.id)) + '"' + selected + '>' +
          escapeHtml(r.name) + ' (' + escapeHtml(r.roleLabel) + ')' +
        '</option>'
      );
    }).join('');
    sel.innerHTML = '<option value="">Choose recipient…</option>' + options;
  }

  // The thread whose messages are currently displayed.
  function targetThread() {
    if (canManage()) {
      if (!selectedRecipientId) return null;
      return threads.find(function (t) { return Number(t.repId) === Number(selectedRecipientId); }) || null;
    }
    return threads.find(function (t) { return Number(t.repId) === Number(hubContext.myUserId); }) || threads[0] || null;
  }

  // ── View navigation ──

  function applyViewVisibility() {
    const inbox = document.getElementById('hub-chat-inbox');
    const convo = document.getElementById('hub-chat-conversation');
    const back = document.getElementById('hub-chat-back');
    const recipientRow = document.getElementById('hub-chat-recipient-row');
    if (!inbox || !convo) return;

    const inboxMode = canManage() && chatView === 'inbox';
    inbox.hidden = !inboxMode;
    convo.hidden = inboxMode;
    if (back) back.hidden = !(canManage() && chatView === 'conversation');

    // Managers picking an existing rep don't need the dropdown; new-message + reps do.
    if (recipientRow) {
      const showRecipient = !canManage() || (chatView === 'conversation' && !fixedRecipient);
      recipientRow.hidden = !showRecipient;
    }
  }

  function setHeaderTitle(text) {
    const title = document.getElementById('hub-chat-panel-title');
    if (title) title.textContent = text;
  }

  function openInbox() {
    chatView = 'inbox';
    fixedRecipient = false;
    selectedRecipientId = null;
    activeThreadId = null;
    messages = [];
    setHeaderTitle('Team chat');
    setStatus('');
    applyViewVisibility();
    renderInbox();
  }

  function openNewMessage() {
    chatView = 'conversation';
    fixedRecipient = false;
    selectedRecipientId = null;
    activeThreadId = null;
    messages = [];
    setHeaderTitle('New message');
    setStatus('');
    renderRecipientSelect();
    applyViewVisibility();
    render();
    const sel = document.getElementById('hub-chat-recipient');
    if (sel) { sel.value = ''; sel.focus(); }
  }

  function openConversationWithRep(repId) {
    selectedRecipientId = repId;
    fixedRecipient = true;
    chatView = 'conversation';
    const rep = threads.find(function (t) { return Number(t.repId) === Number(repId); });
    setHeaderTitle(rep ? rep.repName : 'Conversation');
    applyViewVisibility();
    loadConversation();
  }

  function openConversation() {
    chatView = 'conversation';
    if (!canManage()) {
      fixedRecipient = false;
      setHeaderTitle('Message your lead');
      renderRecipientSelect();
    }
    applyViewVisibility();
    loadConversation();
  }

  async function loadConversation() {
    const thread = targetThread();

    if (!thread || !thread.id) {
      // No conversation yet (manager picking a fresh recipient, or rep with no thread).
      activeThreadId = null;
      messages = [];
      setStatus('');
      render();
      return;
    }

    activeThreadId = thread.id;
    loadingMessages = true;
    setStatus('');
    render();

    try {
      const data = await hubGet('/chat/threads/' + encodeURIComponent(thread.id) + '/messages');
      messages = data.messages || [];
      loadingMessages = false;
      setStatus('');
      render();
      scrollMessagesToBottom();
      await markThreadRead(thread);
    } catch (err) {
      loadingMessages = false;
      setStatus(err.message || 'Could not load messages');
      render();
    }
  }

  async function markThreadRead(thread) {
    if (!thread || !thread.id || !messages.length) return;
    const last = messages[messages.length - 1];
    try {
      await hubPost('/chat/threads/' + encodeURIComponent(thread.id) + '/read', {
        lastMessageId: last.id,
      });
      thread.unreadCount = 0;
      unreadTotal = threads.reduce(function (sum, x) { return sum + (x.unreadCount || 0); }, 0);
      updateBadge();
      if (chatView === 'inbox') renderInbox();
    } catch (_) { /* ignore */ }
  }

  function scrollMessagesToBottom() {
    const wrap = document.getElementById('hub-chat-messages-wrap');
    if (wrap) wrap.scrollTop = wrap.scrollHeight;
  }

  function isScrolledNearBottom() {
    const wrap = document.getElementById('hub-chat-messages-wrap');
    if (!wrap) return true;
    return wrap.scrollHeight - wrap.scrollTop - wrap.clientHeight < 80;
  }

  async function sendCurrentMessage(messageType, bodyOverride) {
    if (!selectedRecipientId) {
      setStatus('Choose who to send this message to.');
      return;
    }

    const input = document.getElementById('hub-chat-input');
    const body = bodyOverride != null ? bodyOverride : (input && input.value.trim());
    if (!body) return;

    const payload = {
      body: body,
      messageType: messageType || 'chat',
      recipientId: selectedRecipientId,
    };
    if (activeThreadId) payload.threadId = activeThreadId;

    const sendBtn = document.getElementById('hub-chat-send');
    if (sendBtn) sendBtn.disabled = true;
    setStatus('Sending…');

    try {
      const result = await hubPost('/chat/messages', payload);
      if (input && bodyOverride == null) input.value = '';

      if (result.thread) {
        activeThreadId = result.thread.id;
        if (canManage() && result.thread.repId != null) {
          selectedRecipientId = result.thread.repId;
          fixedRecipient = true;
          setHeaderTitle(result.thread.repName || 'Conversation');
        }
      }
      if (result.message) {
        messages.push(result.message);
        render();
        scrollMessagesToBottom();
        if (result.thread) {
          await hubPost('/chat/threads/' + encodeURIComponent(result.thread.id) + '/read', {
            lastMessageId: result.message.id,
          });
        }
      }
      await loadThreads();
      applyViewVisibility();
      setStatus('');
    } catch (err) {
      setStatus(err.message || 'Could not send message');
    } finally {
      if (sendBtn) sendBtn.disabled = false;
    }
  }

  // ── Rendering ──

  function inboxThreadsSorted() {
    return threads.slice().sort(function (a, b) {
      const ua = a.unreadCount || 0;
      const ub = b.unreadCount || 0;
      if (ua !== ub) return ub - ua;
      const ta = a.lastMessage ? new Date(a.lastMessage.createdAt).getTime() : 0;
      const tb = b.lastMessage ? new Date(b.lastMessage.createdAt).getTime() : 0;
      if (ta !== tb) return tb - ta;
      return (a.repName || '').localeCompare(b.repName || '');
    });
  }

  function renderInbox() {
    const list = document.getElementById('hub-chat-inbox-list');
    if (!list) return;

    const sorted = inboxThreadsSorted();
    const withActivity = sorted.filter(function (t) { return t.lastMessage || t.unreadCount; });
    const display = withActivity.length ? withActivity : sorted;

    if (!display.length) {
      list.innerHTML = '<p class="hub-chat-empty">No conversations yet. Use “New message” to reach a rep.</p>';
      return;
    }

    list.innerHTML = display.map(function (t) {
      const unread = t.unreadCount || 0;
      const preview = t.lastMessage ? messageLabel(t.lastMessage) : 'No messages yet';
      const sender = t.lastMessage && t.lastMessage.senderName ? t.lastMessage.senderName + ': ' : '';
      const time = t.lastMessage ? relativeTime(t.lastMessage.createdAt) : '';
      const badge = unread
        ? '<span class="hub-chat-inbox-unread">' + (unread > 99 ? '99+' : unread) + '</span>'
        : '';
      return (
        '<button type="button" class="hub-chat-inbox-item' + (unread ? ' is-unread' : '') + '" data-rep-id="' + escapeHtml(String(t.repId)) + '">' +
          '<div class="hub-chat-inbox-row">' +
            '<span class="hub-chat-inbox-name">' + escapeHtml(t.repName || 'Rep') + '</span>' +
            (time ? '<span class="hub-chat-inbox-time">' + escapeHtml(time) + '</span>' : '') +
          '</div>' +
          '<div class="hub-chat-inbox-row">' +
            '<span class="hub-chat-inbox-preview">' + escapeHtml(sender + preview) + '</span>' +
            badge +
          '</div>' +
        '</button>'
      );
    }).join('');
  }

  function renderMessages() {
    const el = document.getElementById('hub-chat-messages');
    if (!el) return;

    if (canManage() && chatView === 'conversation' && !selectedRecipientId) {
      el.innerHTML = '<p class="hub-chat-empty">Choose a recipient above to start a conversation.</p>';
      return;
    }

    if (loadingMessages) {
      el.innerHTML = '<p class="hub-chat-empty">Loading messages…</p>';
      return;
    }

    if (!activeThreadId) {
      el.innerHTML = '<p class="hub-chat-empty">No messages yet. Send the first message below.</p>';
      return;
    }

    if (!messages.length) {
      el.innerHTML = '<p class="hub-chat-empty">No messages yet. Say hello or use a quick action below.</p>';
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
      const toLine = msg.recipientName
        ? '<div class="hub-chat-msg-to">To ' + escapeHtml(msg.recipientName) + '</div>'
        : '';
      return dayHtml +
        '<div class="hub-chat-msg' + (mine ? ' hub-chat-msg--mine' : '') + typeClass + '">' +
          '<div class="hub-chat-msg-meta">' +
            '<span class="hub-chat-msg-sender">' + escapeHtml(msg.senderName) + '</span>' +
            '<span class="hub-chat-msg-time">' + escapeHtml(formatTime(msg.createdAt)) + '</span>' +
          '</div>' +
          toLine +
          '<div class="hub-chat-msg-body">' + escapeHtml(messageLabel(msg)) + '</div>' +
        '</div>';
    }).join('');
  }

  function renderQuickActions() {
    const el = document.getElementById('hub-chat-quick-actions');
    if (!el) return;
    if (!panelOpen || chatView !== 'conversation' || !selectedRecipientId) {
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
      '<button type="button" class="hub-chat-quick-btn hub-chat-quick-btn--primary" id="hub-chat-assign-sets">Assign sets to this rep</button>';
    document.getElementById('hub-chat-assign-sets').addEventListener('click', function () {
      if (typeof openBulkAssignPanel === 'function') openBulkAssignPanel();
    });
  }

  function render() {
    if (canManage() && chatView === 'inbox') {
      renderInbox();
    } else {
      renderMessages();
      renderQuickActions();
    }
    updateBadge();
  }

  function onSnapshot(snapshot) {
    if (snapshot && snapshot.chatSummary) {
      const prevUnread = unreadTotal;
      unreadTotal = snapshot.chatSummary.unreadTotal || 0;
      updateBadge();
      maybeAutoOpenPanel(null, prevUnread);
      lastUnreadTotal = unreadTotal;
    }
    // Snapshots arrive on every (re)connect — when the panel is open, use them
    // as an extra cue to pull fresh threads/messages even if chat events were
    // missed while the SSE socket was briefly down.
    if (panelOpen && liveVisitId) {
      loadThreads().then(function () {
        if (canManage() && chatView === 'inbox') renderInbox();
        else if (activeThreadId) return refreshActiveConversation();
      }).catch(function () { /* ignore */ });
    }
  }

  function onChatEvent(evt) {
    if (!evt) return;
    const prevUnread = unreadTotal;
    if (evt.chatSummary) {
      unreadTotal = evt.chatSummary.unreadTotal || 0;
      updateBadge();
    }
    maybeAutoOpenPanel(evt, prevUnread).then(function () {
      if (!panelOpen) {
        lastUnreadTotal = unreadTotal;
        return;
      }
      return loadThreads();
    }).then(function () {
      if (!panelOpen) return;
      if (chatView === 'inbox') {
        renderInbox();
        return;
      }
      // In a conversation: append live message if it belongs to the open thread.
      if (activeThreadId && evt.type === 'message' && evt.threadId === activeThreadId && evt.message) {
        const exists = messages.some(function (m) { return m.id === evt.message.id; });
        if (!exists) {
          messages.push(evt.message);
          render();
          scrollMessagesToBottom();
          if (evt.message.senderId !== hubContext.myUserId) {
            hubPost('/chat/threads/' + encodeURIComponent(activeThreadId) + '/read', {
              lastMessageId: evt.message.id,
            }).then(function () {
              const t = threads.find(function (x) { return x.id === activeThreadId; });
              if (t) t.unreadCount = 0;
              unreadTotal = threads.reduce(function (sum, x) { return sum + (x.unreadCount || 0); }, 0);
              updateBadge();
            }).catch(function () { /* ignore */ });
          }
        }
      }
    }).catch(function () { /* ignore */ });
  }

  function init() {
    ensureDom();
    wireHeaderChatBtn();
    showHeaderChatBtn(!!liveVisitId);
    updateBadge();
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', function () {
        if (!document.hidden) {
          // Resume promptly when the tab/app returns to the foreground.
          if (pollTimer) clearTimeout(pollTimer);
          pollTick();
        }
      });
    }
    if (liveVisitId) {
      loadThreads()
        .then(function () {
          chatReady = true;
          lastUnreadTotal = unreadTotal;
        })
        .catch(function (err) {
          chatReady = true;
          console.warn('[Hub chat] initial thread load failed:', err);
        });
    }
    startPolling();
  }

  global.HubChat = {
    init: init,
    onSnapshot: onSnapshot,
    onChatEvent: onChatEvent,
    loadThreads: loadThreads,
  };
})(window);
