/**
 * Checklane Hub — floating team chat (rep ↔ lead/supervisor).
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
  let domReady = false;

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

  function clampPosition(x, y, el) {
    const w = el ? el.offsetWidth : 64;
    const h = el ? el.offsetHeight : 64;
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
    if (document.getElementById('hub-chat-root')) {
      domReady = true;
      return;
    }

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
          '<div class="hub-chat-panel-title" id="hub-chat-panel-title">Team chat</div>' +
          '<button type="button" class="hub-chat-minimize" id="hub-chat-minimize" aria-label="Minimize chat" title="Minimize">&minus;</button>' +
        '</div>' +
        '<div class="hub-chat-notice" id="hub-chat-notice">' +
          'All messages are monitored. Leads and supervisors can view every conversation.' +
        '</div>' +
        '<div class="hub-chat-recipient-row">' +
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

    document.getElementById('hub-chat-recipient').addEventListener('change', function () {
      selectedRecipientId = this.value ? Number(this.value) : null;
      loadConversationForRecipient();
    });

    document.getElementById('hub-chat-compose').addEventListener('submit', function (e) {
      e.preventDefault();
      sendCurrentMessage();
    });

    setupDrag(document.getElementById('hub-chat-drag-handle'), root);
    domReady = true;
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
  }

  function togglePanel(open) {
    panelOpen = open;
    const panel = document.getElementById('hub-chat-panel');
    const bubble = document.getElementById('hub-chat-bubble');
    if (!panel || !bubble) return;

    if (open) {
      panel.classList.add('is-open');
    } else {
      panel.classList.remove('is-open');
    }
    bubble.setAttribute('aria-expanded', open ? 'true' : 'false');

    if (open) {
      bootstrapPanel();
    } else {
      setStatus('');
    }
  }

  async function bootstrapPanel() {
    setStatus('Loading…');
    try {
      await Promise.all([loadRecipients(), loadThreads()]);
      renderRecipientSelect();
      if (!selectedRecipientId && recipients.length === 1) {
        selectedRecipientId = recipients[0].id;
        const sel = document.getElementById('hub-chat-recipient');
        if (sel) sel.value = String(selectedRecipientId);
      }
      if (selectedRecipientId) {
        await loadConversationForRecipient();
      } else {
        messages = [];
        activeThreadId = null;
        setStatus('');
        render();
      }
    } catch (err) {
      setStatus(err.message || 'Could not load chat');
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
    const data = await hubGet('/chat/threads');
    threads = data.threads || [];
    unreadTotal = data.unreadTotal || 0;
    updateBadge();
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

  function threadForRecipient(recipientId) {
    if (!recipientId) return null;
    if (canManage()) {
      return threads.find(function (t) { return Number(t.repId) === Number(recipientId); }) || null;
    }
    return threads.find(function (t) { return Number(t.repId) === Number(hubContext.myUserId); }) || threads[0] || null;
  }

  async function loadConversationForRecipient() {
    if (!selectedRecipientId) {
      messages = [];
      activeThreadId = null;
      setStatus('');
      render();
      return;
    }

    const thread = threadForRecipient(selectedRecipientId);
    if (!thread || !thread.id) {
      messages = [];
      activeThreadId = null;
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

      if (messages.length) {
        const last = messages[messages.length - 1];
        await hubPost('/chat/threads/' + encodeURIComponent(thread.id) + '/read', {
          lastMessageId: last.id,
        });
        thread.unreadCount = 0;
        unreadTotal = threads.reduce(function (sum, x) { return sum + (x.unreadCount || 0); }, 0);
        updateBadge();
      }
    } catch (err) {
      loadingMessages = false;
      setStatus(err.message || 'Could not load messages');
      render();
    }
  }

  function scrollMessagesToBottom() {
    const wrap = document.getElementById('hub-chat-messages-wrap');
    if (wrap) wrap.scrollTop = wrap.scrollHeight;
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
        const existing = threads.find(function (t) { return t.id === result.thread.id; });
        if (!existing) {
          threads.push({
            id: result.thread.id,
            repId: result.thread.repId,
            repName: result.thread.repName,
            unreadCount: 0,
            lastMessage: result.message,
          });
        }
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
      setStatus('');
    } catch (err) {
      setStatus(err.message || 'Could not send message');
    } finally {
      if (sendBtn) sendBtn.disabled = false;
    }
  }

  function renderMessages() {
    const el = document.getElementById('hub-chat-messages');
    if (!el) return;

    if (!selectedRecipientId) {
      el.innerHTML = '<p class="hub-chat-empty">Choose a recipient to view or start a conversation.</p>';
      return;
    }

    if (loadingMessages) {
      el.innerHTML = '<p class="hub-chat-empty">Loading messages…</p>';
      return;
    }

    if (!activeThreadId) {
      el.innerHTML = '<p class="hub-chat-empty">No messages yet with this person. Send the first message below.</p>';
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
    if (!panelOpen || !selectedRecipientId) {
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
        }
      });
    }
  }

  function init() {
    ensureDom();
    updateBadge();
    if (liveVisitId) {
      loadThreads().catch(function (err) {
        console.warn('[Hub chat] initial thread load failed:', err);
      });
    }
  }

  global.HubChat = {
    init: init,
    onSnapshot: onSnapshot,
    onChatEvent: onChatEvent,
    loadThreads: loadThreads,
  };
})(window);
