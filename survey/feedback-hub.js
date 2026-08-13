/* Shared Store Survey / Survey Admin feedback hub.
   Opens a themed overlay, prompts by type, emails Tyson via eod-api. */
(function () {
  'use strict';

  const MAX_SHOTS = 3;
  const KINDS = {
    problem: {
      title: 'Report a problem',
      blurb: 'Something broke, looks wrong, or blocked you. A screenshot of the screen helps a lot.',
      detailsLabel: 'What happened?',
      detailsHint: 'What you tapped, what you expected, and what you saw instead.',
    },
    suggestion: {
      title: 'Suggest an improvement',
      blurb: 'Tell us what would make this easier in the store or on admin.',
      detailsLabel: 'What should we change?',
      detailsHint: 'Be specific — which screen, and what you wish it did.',
    },
    question: {
      title: 'Ask a question',
      blurb: 'Need a how-to, a roster change, or to reach Tyson directly.',
      detailsLabel: 'Your question or message',
      detailsHint: 'Write it the way you would in a text. He will reply to your work email.',
    },
  };

  const ACTIVITIES = {
    survey: [
      'Signing in',
      'Picking a store',
      'Answering a question',
      'Adding a photo',
      'Reviewing or submitting',
      'Something else',
    ],
    admin: [
      'Signing in',
      'Assigning from PROD',
      'Assigning someone else',
      'Viewing results',
      'Exporting',
      'Sync with PROD',
      'Something else',
    ],
  };

  const TOPICS = [
    'How do I…',
    'Roster / sign-in email',
    'Assignment or coverage',
    'Wrong store or person',
    'Something else',
  ];

  let cfg = {
    app: 'survey',
    endpoint: '/api/survey/feedback',
    api: null,
    getContext: function () { return {}; },
  };
  let shots = [];
  let kind = '';
  let sending = false;
  let bound = false;

  function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
    });
  }

  function injectCss() {
    if (document.getElementById('sfh-css')) return;
    const el = document.createElement('style');
    el.id = 'sfh-css';
    el.textContent = `
#sfh-root{position:fixed;inset:0;z-index:90;display:none;align-items:flex-end;justify-content:center;background:rgba(10,20,30,.55);padding:12px;padding-bottom:max(12px,env(safe-area-inset-bottom,0px))}
#sfh-root.open{display:flex}
#sfh-sheet{width:min(560px,100%);max-height:min(92vh,900px);overflow:auto;-webkit-overflow-scrolling:touch;background:var(--card,#fff);color:var(--ink,#1a2430);border:1px solid var(--line,#d5dde6);border-radius:18px 18px 14px 14px;box-shadow:0 20px 50px rgba(0,0,0,.28);padding:16px 16px 18px}
#sfh-sheet h2{margin:0 0 4px;font-size:1.15rem;color:var(--accent-deep,#0a4063)}
#sfh-sheet .sfh-lead{margin:0 0 14px;color:var(--ink-soft,#5c6b7a);font-size:.875rem;line-height:1.45}
#sfh-head{display:flex;align-items:flex-start;justify-content:space-between;gap:10px;margin-bottom:4px}
#sfh-close{min-width:40px;min-height:40px;border-radius:10px;border:1.5px solid var(--line,#d5dde6);background:var(--card,#fff);color:var(--ink,#1a2430);font-size:1.15rem;font-weight:700;cursor:pointer}
.sfh-cards{display:grid;gap:10px;margin:8px 0 4px}
.sfh-card{text-align:left;border:1.5px solid var(--line,#d5dde6);background:var(--opt-bg,var(--card,#fff));border-radius:14px;padding:14px;cursor:pointer;color:inherit;font:inherit}
.sfh-card:active{transform:scale(.99)}
.sfh-card strong{display:block;font-size:.975rem;margin-bottom:4px;color:var(--accent-deep,#0a4063)}
.sfh-card span{display:block;font-size:.8125rem;color:var(--ink-soft,#5c6b7a);line-height:1.4}
.sfh-field{margin:0 0 12px}
.sfh-field label{display:block;font-weight:700;font-size:.8125rem;margin:0 0 6px;color:var(--ink,#1a2430)}
.sfh-field .hint{font-weight:500;color:var(--ink-soft,#5c6b7a);font-size:.75rem;margin-top:4px}
.sfh-field textarea,.sfh-field input,.sfh-field select{width:100%;box-sizing:border-box;min-height:44px;border:1.5px solid var(--line,#d5dde6);border-radius:12px;background:var(--input-bg,var(--card,#fff));color:var(--ink,#1a2430);padding:10px 12px;font:inherit}
.sfh-field textarea{min-height:110px;resize:vertical}
.sfh-pills{display:flex;flex-wrap:wrap;gap:8px}
.sfh-pills label{display:inline-flex;align-items:center;gap:6px;border:1.5px solid var(--line,#d5dde6);border-radius:999px;padding:8px 12px;font-size:.8125rem;font-weight:600;cursor:pointer;background:var(--chip-bg,var(--card,#fff))}
.sfh-pills input{accent-color:var(--accent,#0f5c8c)}
.sfh-shots{display:flex;flex-wrap:wrap;gap:10px;align-items:center}
.sfh-shot{position:relative;width:72px;height:72px}
.sfh-shot img{width:72px;height:72px;object-fit:cover;border-radius:10px;border:1px solid var(--line,#d5dde6)}
.sfh-shot button{position:absolute;top:-6px;right:-6px;width:24px;height:24px;border-radius:999px;border:0;background:var(--danger,#b3402a);color:#fff;font-weight:700;cursor:pointer}
.sfh-addshot{width:72px;height:72px;border-radius:10px;border:1.5px dashed var(--line,#d5dde6);background:var(--note-bg,#f0f6fa);color:var(--accent,#0f5c8c);font-size:1.4rem;cursor:pointer}
.sfh-meta{font-size:.75rem;color:var(--ink-soft,#5c6b7a);background:var(--note-bg,#f0f6fa);border:1px solid var(--note-line,#d0e0ec);border-radius:12px;padding:10px 12px;margin:4px 0 14px;line-height:1.45}
.sfh-actions{display:flex;gap:8px;margin-top:4px}
.sfh-actions button{flex:1;min-height:48px;border-radius:12px;border:0;font-weight:700;font-size:.9375rem;cursor:pointer}
.sfh-actions .primary{background:var(--accent,#0f5c8c);color:#fff}
.sfh-actions .ghost{background:transparent;border:1.5px solid var(--line,#d5dde6);color:var(--ink,#1a2430)}
.sfh-actions button:disabled{opacity:.55;cursor:wait}
.sfh-err{color:var(--danger,#b3402a);font-weight:600;font-size:.8125rem;margin:0 0 10px;display:none}
.sfh-err.show{display:block}
.sfh-ok{text-align:center;padding:18px 8px 8px}
.sfh-ok p{color:var(--ink-soft,#5c6b7a);margin:8px 0 0;line-height:1.45}
@media (min-width:640px){#sfh-root{align-items:center}#sfh-sheet{border-radius:18px}}
`;
    document.head.appendChild(el);
  }

  function root() {
    let el = document.getElementById('sfh-root');
    if (el) return el;
    el = document.createElement('div');
    el.id = 'sfh-root';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'true');
    el.setAttribute('aria-labelledby', 'sfh-title');
    el.innerHTML = '<div id="sfh-sheet"></div>';
    document.body.appendChild(el);
    el.addEventListener('click', function (e) {
      if (e.target === el && !sending) close();
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && el.classList.contains('open') && !sending) close();
    });
    return el;
  }

  function context() {
    const extra = (typeof cfg.getContext === 'function' && cfg.getContext()) || {};
    return {
      app: cfg.app === 'admin' ? 'admin' : 'survey',
      storeNum: extra.storeNum || extra.store || null,
      storeName: extra.storeName || '',
      page: extra.page || '',
      url: location.href,
      userAgent: navigator.userAgent || '',
      user: extra.user || null,
    };
  }

  function metaLine(ctx) {
    const u = ctx.user || {};
    const bits = [];
    if (u.name || u.email) bits.push(u.name || u.email);
    if (ctx.storeNum) bits.push('Store ' + ctx.storeNum);
    bits.push(cfg.app === 'admin' ? 'Survey Admin' : 'Store Survey');
    return bits.join(' · ');
  }

  function renderHome() {
    const sheet = document.getElementById('sfh-sheet');
    sheet.innerHTML = `
      <div id="sfh-head">
        <div>
          <h2 id="sfh-title">Contact Tyson</h2>
          <p class="sfh-lead">Report a problem, suggest a change, or ask a question. It emails him from this app with your details.</p>
        </div>
        <button type="button" id="sfh-close" aria-label="Close">×</button>
      </div>
      <div class="sfh-cards">
        <button type="button" class="sfh-card" data-kind="problem"><strong>Report a problem</strong><span>Something is broken, confusing, or blocked you.</span></button>
        <button type="button" class="sfh-card" data-kind="suggestion"><strong>Suggest an improvement</strong><span>An idea that would make the survey or admin easier.</span></button>
        <button type="button" class="sfh-card" data-kind="question"><strong>Ask a question</strong><span>How-to, roster, coverage, or anything else.</span></button>
      </div>
      <p class="sfh-lead" style="margin-top:12px">He replies to your work email. Optional screenshots stay with the message.</p>
    `;
    sheet.querySelector('#sfh-close').onclick = close;
    sheet.querySelectorAll('[data-kind]').forEach(function (btn) {
      btn.onclick = function () { kind = btn.getAttribute('data-kind'); renderForm(); };
    });
  }

  function renderForm() {
    const spec = KINDS[kind];
    const ctx = context();
    const acts = ACTIVITIES[cfg.app === 'admin' ? 'admin' : 'survey'];
    const phone = (ctx.user && ctx.user.phone) || '';
    let extra = '';
    if (kind === 'problem') {
      extra = `
        <div class="sfh-field"><label for="sfh-activity">What were you doing?</label>
          <select id="sfh-activity">${acts.map(function (a) { return '<option>' + esc(a) + '</option>'; }).join('')}</select>
        </div>
        <div class="sfh-field"><label>Can you still use the app?</label>
          <div class="sfh-pills">
            <label><input type="radio" name="sfh-usable" value="Yes"> Yes</label>
            <label><input type="radio" name="sfh-usable" value="Mostly" checked> Mostly</label>
            <label><input type="radio" name="sfh-usable" value="No"> No</label>
          </div>
        </div>
        <div class="sfh-field"><label>Does it happen every time?</label>
          <div class="sfh-pills">
            <label><input type="radio" name="sfh-happens" value="Every time"> Every time</label>
            <label><input type="radio" name="sfh-happens" value="Once" checked> Once / not sure</label>
            <label><input type="radio" name="sfh-happens" value="Sometimes"> Sometimes</label>
          </div>
        </div>`;
    } else if (kind === 'suggestion') {
      extra = `
        <div class="sfh-field"><label for="sfh-working">What is already working well? <span style="font-weight:500;color:var(--ink-soft)">(optional)</span></label>
          <textarea id="sfh-working" maxlength="1500" placeholder="Keep this if you like it…"></textarea>
        </div>
        <div class="sfh-field"><label>How important is this?</label>
          <div class="sfh-pills">
            <label><input type="radio" name="sfh-imp" value="Nice to have" checked> Nice to have</label>
            <label><input type="radio" name="sfh-imp" value="Would help a lot"> Would help a lot</label>
            <label><input type="radio" name="sfh-imp" value="Blocking work"> Blocking work</label>
          </div>
        </div>`;
    } else {
      extra = `
        <div class="sfh-field"><label for="sfh-topic">Topic</label>
          <select id="sfh-topic">${TOPICS.map(function (t) { return '<option>' + esc(t) + '</option>'; }).join('')}</select>
        </div>`;
    }

    const sheet = document.getElementById('sfh-sheet');
    sheet.innerHTML = `
      <div id="sfh-head">
        <div>
          <h2 id="sfh-title">${esc(spec.title)}</h2>
          <p class="sfh-lead">${esc(spec.blurb)}</p>
        </div>
        <button type="button" id="sfh-close" aria-label="Close">×</button>
      </div>
      <div class="sfh-err" id="sfh-err"></div>
      ${extra}
      <div class="sfh-field">
        <label for="sfh-details">${esc(spec.detailsLabel)}</label>
        <textarea id="sfh-details" maxlength="4000" required placeholder="${esc(spec.detailsHint)}"></textarea>
      </div>
      <div class="sfh-field">
        <label>Screenshot ${kind === 'problem' ? '(strongly recommended)' : '(optional)'}</label>
        <div class="sfh-shots" id="sfh-shots"></div>
        <div class="hint">Take a photo of the screen, or pick one from your camera roll. Up to ${MAX_SHOTS}.</div>
      </div>
      <div class="sfh-field">
        <label>How should Tyson reply?</label>
        <div class="sfh-pills">
          <label><input type="radio" name="sfh-reply" value="email" checked> Email</label>
          <label><input type="radio" name="sfh-reply" value="phone"> Phone</label>
          <label><input type="radio" name="sfh-reply" value="either"> Either</label>
        </div>
      </div>
      <div class="sfh-field">
        <label for="sfh-phone">Phone <span style="font-weight:500;color:var(--ink-soft)">(optional)</span></label>
        <input id="sfh-phone" type="tel" inputmode="tel" autocomplete="tel" value="${esc(phone)}" placeholder="If a call or text is easier">
      </div>
      <div class="sfh-meta">We’ll include: ${esc(metaLine(ctx))}. Reply-To is your work email.</div>
      <div class="sfh-actions">
        <button type="button" class="ghost" id="sfh-back">Back</button>
        <button type="button" class="primary" id="sfh-send">Send to Tyson</button>
      </div>
    `;
    sheet.querySelector('#sfh-close').onclick = close;
    sheet.querySelector('#sfh-back').onclick = function () { shots = []; renderHome(); };
    sheet.querySelector('#sfh-send').onclick = submit;
    renderShots();
    const details = sheet.querySelector('#sfh-details');
    if (details) details.focus();
  }

  function renderShots() {
    const wrap = document.getElementById('sfh-shots');
    if (!wrap) return;
    wrap.innerHTML = shots.map(function (s, i) {
      return '<span class="sfh-shot"><img src="' + s.preview + '" alt=""><button type="button" data-del="' + i + '" aria-label="Remove">×</button></span>';
    }).join('') + (shots.length < MAX_SHOTS
      ? '<button type="button" class="sfh-addshot" id="sfh-add" aria-label="Add screenshot">📷</button>'
      : '');
    wrap.querySelectorAll('[data-del]').forEach(function (b) {
      b.onclick = function () {
        shots.splice(Number(b.getAttribute('data-del')), 1);
        renderShots();
      };
    });
    const add = wrap.querySelector('#sfh-add');
    if (add) add.onclick = pickShot;
  }

  function pickShot() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = async function () {
      const file = input.files && input.files[0];
      if (!file) return;
      try {
        const img = await new Promise(function (res, rej) {
          const i = new Image();
          i.onload = function () { res(i); };
          i.onerror = rej;
          i.src = URL.createObjectURL(file);
        });
        const scale = Math.min(1, 1280 / Math.max(img.width, img.height));
        const cv = document.createElement('canvas');
        cv.width = Math.max(1, Math.round(img.width * scale));
        cv.height = Math.max(1, Math.round(img.height * scale));
        cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
        const dataUrl = cv.toDataURL('image/jpeg', 0.72);
        const b64 = dataUrl.split(',')[1];
        if (!b64) throw new Error('empty');
        shots.push({ mime: 'image/jpeg', data: b64, preview: dataUrl });
        renderShots();
      } catch (_) {
        showErr('Could not read that image. Try another photo.');
      }
    };
    input.click();
  }

  function showErr(msg) {
    const el = document.getElementById('sfh-err');
    if (!el) return;
    el.textContent = msg || '';
    el.classList.toggle('show', !!msg);
  }

  function val(sel) {
    const el = document.querySelector(sel);
    return el ? String(el.value || '').trim() : '';
  }
  function radio(name) {
    const el = document.querySelector('input[name="' + name + '"]:checked');
    return el ? el.value : '';
  }

  async function submit() {
    if (sending) return;
    const details = val('#sfh-details');
    if (details.length < 12) {
      showErr('Please add a bit more detail so he knows how to help.');
      const box = document.getElementById('sfh-details');
      if (box) box.focus();
      return;
    }
    showErr('');
    sending = true;
    const sendBtn = document.getElementById('sfh-send');
    if (sendBtn) {
      sendBtn.disabled = true;
      sendBtn.textContent = 'Sending…';
    }
    const ctx = context();
    const fields = {
      details: details,
      phone: val('#sfh-phone'),
      replyVia: radio('sfh-reply') || 'email',
      activity: val('#sfh-activity'),
      stillUsable: radio('sfh-usable'),
      happens: radio('sfh-happens'),
      workingWell: val('#sfh-working'),
      importance: radio('sfh-imp'),
      topic: val('#sfh-topic'),
    };
    const payload = {
      kind: kind,
      fields: fields,
      screenshots: shots.map(function (s) { return { mime: s.mime, data: s.data }; }),
      context: {
        app: ctx.app,
        storeNum: ctx.storeNum,
        storeName: ctx.storeName,
        page: ctx.page,
        url: ctx.url,
        userAgent: ctx.userAgent,
      },
    };
    try {
      if (typeof cfg.api !== 'function') throw new Error('Not signed in yet.');
      const r = await cfg.api(cfg.endpoint, { method: 'POST', body: JSON.stringify(payload) });
      if (r && r.ok === false) throw new Error(r.error || 'Send failed');
      renderThanks();
    } catch (e) {
      const msg = (e && e.message) ? e.message : 'Could not send. Check your connection and try again.';
      if (msg !== 'auth' && msg !== 'forbidden') showErr(msg);
      if (sendBtn) {
        sendBtn.disabled = false;
        sendBtn.textContent = 'Send to Tyson';
      }
    } finally {
      sending = false;
    }
  }

  function renderThanks() {
    shots = [];
    const sheet = document.getElementById('sfh-sheet');
    sheet.innerHTML = `
      <div id="sfh-head">
        <div></div>
        <button type="button" id="sfh-close" aria-label="Close">×</button>
      </div>
      <div class="sfh-ok">
        <h2 id="sfh-title">Sent</h2>
        <p>Tyson has your note at his work email. He’ll reply to the address you signed in with.</p>
      </div>
      <div class="sfh-actions">
        <button type="button" class="primary" id="sfh-done">Done</button>
      </div>
    `;
    sheet.querySelector('#sfh-close').onclick = close;
    sheet.querySelector('#sfh-done').onclick = close;
  }

  function openHub() {
    injectCss();
    const el = root();
    kind = '';
    shots = [];
    sending = false;
    renderHome();
    el.classList.add('open');
    document.body.style.overflow = 'hidden';
  }

  function close() {
    const el = document.getElementById('sfh-root');
    if (el) el.classList.remove('open');
    document.body.style.overflow = '';
    kind = '';
    shots = [];
    sending = false;
  }

  function bind(opts) {
    cfg = Object.assign({}, cfg, opts || {});
    if (bound) return;
    bound = true;
    const btn = document.getElementById('btn-feedback');
    if (btn) btn.addEventListener('click', openHub);
  }

  window.SurveyFeedbackHub = { bind: bind, open: openHub, close: close };
})();
