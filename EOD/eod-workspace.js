/* Collapsible EOD groups + searchable pickers (drop-down / drop-up / sheet). */
(function () {
  'use strict';

  const STORAGE_KEY = 'eodWorkspaceGroups';
  const NARROW = 720;
  const GROUPS = [
    { id: 'visit', label: 'Visit' },
    { id: 'crew', label: 'Crew' },
    { id: 'photos', label: 'Photos' },
    { id: 'signoff', label: 'Signoffs' },
    { id: 'cover', label: 'Cover' },
    { id: 'send', label: 'Send' },
  ];

  function isNarrow() {
    return window.innerWidth < NARROW;
  }

  function loadOpenState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return { visit: true, crew: true };
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? parsed : { visit: true, crew: true };
    } catch (_) {
      return { visit: true, crew: true };
    }
  }

  function saveOpenState() {
    const state = {};
    document.querySelectorAll('details.eod-group[data-eod-group]').forEach((el) => {
      state[el.getAttribute('data-eod-group')] = !!el.open;
    });
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (_) { /* ignore */ }
    syncNav();
  }

  function openGroup(id, { exclusive, scroll } = {}) {
    const target = document.querySelector(`details.eod-group[data-eod-group="${id}"]`);
    if (!target) return;
    if (exclusive || isNarrow()) {
      document.querySelectorAll('details.eod-group[data-eod-group]').forEach((el) => {
        if (el !== target) el.open = false;
      });
    }
    target.open = true;
    saveOpenState();
    if (scroll !== false) {
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  function syncNav() {
    document.querySelectorAll('.eod-group-nav-btn[data-eod-nav]').forEach((btn) => {
      const id = btn.getAttribute('data-eod-nav');
      const group = document.querySelector(`details.eod-group[data-eod-group="${id}"]`);
      btn.classList.toggle('is-open', !!(group && group.open));
    });
  }

  function ensureNav() {
    const workspace = document.getElementById('eodWorkspace');
    if (!workspace || document.getElementById('eodGroupNav')) return;
    const nav = document.createElement('div');
    nav.className = 'eod-group-nav';
    nav.id = 'eodGroupNav';
    nav.setAttribute('role', 'tablist');
    nav.innerHTML = GROUPS.map((g) => (
      `<button type="button" class="eod-group-nav-btn" data-eod-nav="${g.id}">${g.label}</button>`
    )).join('');
    workspace.parentNode.insertBefore(nav, workspace);
    nav.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-eod-nav]');
      if (!btn) return;
      openGroup(btn.getAttribute('data-eod-nav'), { exclusive: isNarrow(), scroll: true });
    });
  }

  function bindGroups() {
    const saved = loadOpenState();
    document.querySelectorAll('details.eod-group[data-eod-group]').forEach((el) => {
      const id = el.getAttribute('data-eod-group');
      if (Object.prototype.hasOwnProperty.call(saved, id)) el.open = !!saved[id];
      el.addEventListener('toggle', () => {
        if (el.open && isNarrow()) {
          document.querySelectorAll('details.eod-group[data-eod-group]').forEach((other) => {
            if (other !== el) other.open = false;
          });
        }
        saveOpenState();
      });
    });
    syncNav();
  }

  /* ─── Picker overlay ─────────────────────────────────────────────── */

  let pickerState = null;

  function ensurePickerDom() {
    if (document.getElementById('eodPickerOverlay')) return;
    const overlay = document.createElement('div');
    overlay.id = 'eodPickerOverlay';
    overlay.className = 'eod-picker-overlay';
    overlay.innerHTML = `
      <div class="eod-picker-panel" id="eodPickerPanel" role="dialog" aria-modal="true" aria-labelledby="eodPickerTitle">
        <div class="eod-picker-head">
          <h3 id="eodPickerTitle">Choose</h3>
          <button type="button" class="btn btn-secondary" id="eodPickerClose">Close</button>
        </div>
        <input type="search" id="eodPickerSearch" class="eod-picker-search" placeholder="Search…" autocomplete="off">
        <div class="eod-picker-list" id="eodPickerList"></div>
        <div class="eod-picker-foot" id="eodPickerFoot" style="display:none;">
          <button type="button" class="btn btn-secondary" id="eodPickerClear">Clear</button>
          <button type="button" class="btn btn-primary" id="eodPickerDone">Done</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) closePicker();
    });
    document.getElementById('eodPickerClose').onclick = closePicker;
    document.getElementById('eodPickerSearch').addEventListener('input', renderPickerList);
    document.getElementById('eodPickerDone').onclick = () => {
      if (pickerState?.multiple && typeof pickerState.onChange === 'function') {
        pickerState.onChange(pickerState.selected.slice());
      }
      closePicker();
    };
    document.getElementById('eodPickerClear').onclick = () => {
      if (!pickerState) return;
      pickerState.selected = [];
      renderPickerList();
      if (typeof pickerState.onChange === 'function') pickerState.onChange([]);
    };
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && overlay.classList.contains('show')) closePicker();
    });
  }

  function positionPanel(anchor) {
    const panel = document.getElementById('eodPickerPanel');
    const overlay = document.getElementById('eodPickerOverlay');
    if (!panel || !overlay) return;
    panel.classList.remove('sheet');
    panel.style.top = '';
    panel.style.bottom = '';
    panel.style.left = '';
    panel.style.right = '';
    panel.style.width = '';

    if (isNarrow() || !anchor) {
      panel.classList.add('sheet');
      return;
    }

    const rect = anchor.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom;
    const spaceAbove = rect.top;
    const preferUp = spaceBelow < 280 && spaceAbove > spaceBelow;
    const width = Math.min(420, Math.max(rect.width, 280), window.innerWidth - 24);
    let left = rect.left;
    if (left + width > window.innerWidth - 12) left = window.innerWidth - width - 12;
    if (left < 12) left = 12;
    panel.style.width = `${width}px`;
    panel.style.left = `${left}px`;
    panel.style.right = 'auto';
    if (preferUp) {
      panel.style.bottom = `${window.innerHeight - rect.top + 6}px`;
      panel.style.top = 'auto';
    } else {
      panel.style.top = `${rect.bottom + 6}px`;
      panel.style.bottom = 'auto';
    }
  }

  function renderPickerList() {
    if (!pickerState) return;
    const list = document.getElementById('eodPickerList');
    const q = (document.getElementById('eodPickerSearch').value || '').trim().toLowerCase();
    const items = pickerState.items.filter((it) => {
      if (!q) return true;
      const hay = `${it.label || ''} ${it.sublabel || ''} ${it.id || ''}`.toLowerCase();
      return hay.includes(q);
    });
    if (!items.length) {
      list.innerHTML = '<div class="eod-picker-empty">No matches</div>';
      return;
    }
    const selected = new Set(pickerState.selected.map(String));
    list.innerHTML = items.map((it) => {
      const id = String(it.id);
      const on = selected.has(id);
      const sub = it.sublabel ? `<div class="eod-picker-item-sub">${escapeHtml(it.sublabel)}</div>` : '';
      const remove = it.removable
        ? `<button type="button" class="btn btn-secondary eod-picker-remove" data-remove-id="${escapeHtml(id)}" style="width:auto;min-width:44px;padding:6px 8px;">×</button>`
        : '';
      return `<button type="button" class="eod-picker-item${on ? ' is-selected' : ''}${it.disabled ? ' is-disabled' : ''}" data-id="${escapeHtml(id)}">
        <div class="eod-picker-item-text">
          <div class="eod-picker-item-label">${escapeHtml(it.label || id)}</div>
          ${sub}
        </div>
        ${on ? '<span aria-hidden="true">✓</span>' : ''}
        ${remove}
      </button>`;
    }).join('');

    list.querySelectorAll('.eod-picker-item').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        if (e.target.closest('[data-remove-id]')) return;
        const id = btn.getAttribute('data-id');
        const item = pickerState.items.find((x) => String(x.id) === id);
        if (!item || item.disabled) return;
        if (pickerState.multiple) {
          const idx = pickerState.selected.findIndex((x) => String(x) === id);
          if (idx >= 0) pickerState.selected.splice(idx, 1);
          else pickerState.selected.push(id);
          renderPickerList();
          if (typeof pickerState.onToggle === 'function') pickerState.onToggle(item, pickerState.selected.slice());
        } else {
          if (typeof pickerState.onChoose === 'function') pickerState.onChoose(item);
          closePicker();
        }
      });
    });
    list.querySelectorAll('[data-remove-id]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const id = btn.getAttribute('data-remove-id');
        const item = pickerState.items.find((x) => String(x.id) === id);
        if (item && typeof pickerState.onRemove === 'function') pickerState.onRemove(item);
      });
    });
  }

  function escapeHtml(s) {
    return String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function openPicker(opts) {
    ensurePickerDom();
    const options = opts || {};
    pickerState = {
      items: Array.isArray(options.items) ? options.items : [],
      multiple: !!options.multiple,
      selected: Array.isArray(options.selected) ? options.selected.map(String) : [],
      onChoose: options.onChoose,
      onChange: options.onChange,
      onToggle: options.onToggle,
      onRemove: options.onRemove,
      anchor: options.anchor || null,
    };
    document.getElementById('eodPickerTitle').textContent = options.title || 'Choose';
    const search = document.getElementById('eodPickerSearch');
    search.value = '';
    search.style.display = options.searchable === false ? 'none' : 'block';
    document.getElementById('eodPickerFoot').style.display = pickerState.multiple ? 'flex' : 'none';
    renderPickerList();
    const overlay = document.getElementById('eodPickerOverlay');
    overlay.classList.add('show');
    positionPanel(pickerState.anchor);
    if (options.searchable !== false) {
      setTimeout(() => search.focus(), 30);
    }
  }

  function closePicker() {
    const overlay = document.getElementById('eodPickerOverlay');
    if (overlay) overlay.classList.remove('show');
    pickerState = null;
  }

  function itemsFromSelect(select) {
    return Array.from(select.options || [])
      .filter((opt) => opt.value)
      .map((opt) => ({
        id: opt.value,
        label: (opt.textContent || opt.value).trim(),
        disabled: opt.disabled,
        selected: opt.selected,
      }));
  }

  function bindSelect(select, title) {
    if (!select || select.dataset.eodPickerBound === '1') return;
    select.dataset.eodPickerBound = '1';
    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'eod-picker-trigger';
    trigger.setAttribute('data-eod-select-trigger', select.id || '');
    const syncLabel = () => {
      const opt = select.options[select.selectedIndex];
      const text = (opt && opt.value) ? (opt.textContent || opt.value).trim() : (select.options[0]?.textContent || 'Select…');
      trigger.innerHTML = `<span class="eod-picker-label">${escapeHtml(text)}</span><span class="eod-picker-meta">${select.options.length > 1 ? select.options.length - 1 : 0}</span>`;
    };
    syncLabel();
    select.style.position = 'absolute';
    select.style.opacity = '0';
    select.style.pointerEvents = 'none';
    select.style.width = '1px';
    select.style.height = '1px';
    select.setAttribute('tabindex', '-1');
    select.parentNode.insertBefore(trigger, select);
    trigger.addEventListener('click', () => {
      openPicker({
        anchor: trigger,
        title: title || select.getAttribute('aria-label') || 'Select',
        items: itemsFromSelect(select),
        searchable: itemsFromSelect(select).length > 8,
        onChoose(item) {
          select.value = item.id;
          select.dispatchEvent(new Event('change', { bubbles: true }));
          syncLabel();
        },
      });
    });
    select.addEventListener('change', syncLabel);
    const mo = new MutationObserver(syncLabel);
    mo.observe(select, { childList: true, subtree: true, attributes: true });
  }

  function enhanceKnownSelects() {
    const map = [
      ['smAddSelect', 'Add a teammate'],
      ['smRemoveSelect', 'Remove a teammate'],
      ['notInStoreSelect', 'Not in store'],
      ['notInSiSelect', 'Not in SI'],
      ['notInShiftSelect', 'Sets from shift'],
      ['leadPickerSelect', 'Select lead'],
    ];
    map.forEach(([id, title]) => {
      const el = document.getElementById(id);
      if (el && el.tagName === 'SELECT') bindSelect(el, title);
    });
  }

  function compactRoster() {
    const list = document.getElementById('smMembersList');
    if (!list || list.dataset.eodCompact === '1') return;
    list.dataset.eodCompact = '1';
    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'eod-picker-trigger';
    trigger.id = 'smRosterPickerBtn';
    trigger.innerHTML = '<span class="eod-picker-label">View current roster</span><span class="eod-picker-meta" id="smRosterCount">0</span>';
    list.parentNode.insertBefore(trigger, list);
    list.classList.add('eod-hidden-list');
    const sync = () => {
      const names = Array.from(list.querySelectorAll('.sm-member-name')).map((n) => n.textContent.trim()).filter(Boolean);
      const count = document.getElementById('smRosterCount');
      if (count) count.textContent = String(names.length || list.querySelectorAll('.sm-member-row').length);
      trigger.querySelector('.eod-picker-label').textContent = names.length
        ? `Roster · tap to view`
        : (list.textContent.trim() || 'Roster');
    };
    trigger.addEventListener('click', () => {
      const rows = Array.from(list.querySelectorAll('.sm-member-row'));
      const items = rows.map((row, i) => {
        const name = row.querySelector('.sm-member-name')?.textContent.trim() || `Person ${i + 1}`;
        const time = row.querySelector('.sm-member-time')?.textContent.trim() || '';
        return { id: String(i), label: name, sublabel: time };
      });
      openPicker({
        anchor: trigger,
        title: 'Current roster',
        items: items.length ? items : [{ id: 'empty', label: list.textContent.trim() || 'No members', disabled: true }],
        searchable: items.length > 6,
      });
    });
    const mo = new MutationObserver(sync);
    mo.observe(list, { childList: true, subtree: true, characterData: true });
    sync();
  }

  function compactFredmeyer() {
    const list = document.getElementById('fmEmailList');
    const section = document.getElementById('fmEmailPickerSection');
    if (!list || !section || list.dataset.eodCompact === '1') return;
    list.dataset.eodCompact = '1';
    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'eod-picker-trigger';
    trigger.id = 'fmEmailPickerBtn';
    trigger.innerHTML = '<span class="eod-picker-label">Saved Fred Meyer addresses</span><span class="eod-picker-meta" id="fmEmailPickerCount">0</span>';
    list.parentNode.insertBefore(trigger, list);
    list.classList.add('eod-hidden-list');
    const sync = () => {
      const n = list.querySelectorAll('.fm-checkbox').length;
      const checked = list.querySelectorAll('.fm-checkbox:checked').length;
      const count = document.getElementById('fmEmailPickerCount');
      if (count) count.textContent = n ? `${checked}/${n}` : '0';
    };
    trigger.addEventListener('click', () => {
      const rows = Array.from(list.querySelectorAll('.fm-email-row'));
      const items = rows.map((row, i) => {
        const cb = row.querySelector('.fm-checkbox');
        const email = row.querySelector('.fm-email-label')?.textContent.trim() || '';
        return { id: String(cb?.dataset.idx ?? i), label: email, selected: !!cb?.checked, removable: true };
      });
      openPicker({
        anchor: trigger,
        title: 'Fred Meyer addresses',
        multiple: true,
        selected: items.filter((x) => x.selected).map((x) => x.id),
        items,
        searchable: items.length > 8,
        onToggle(item, selectedIds) {
          const cb = list.querySelector(`.fm-checkbox[data-idx="${item.id}"]`);
          if (cb) {
            cb.checked = selectedIds.map(String).includes(String(item.id));
            cb.dispatchEvent(new Event('change', { bubbles: true }));
          }
          sync();
        },
        onChange() { sync(); },
        onRemove(item) {
          const row = list.querySelectorAll('.fm-email-row')[Number(item.id)];
          const btn = row?.querySelector('.fm-remove-btn');
          if (btn) btn.click();
        },
      });
    });
    const mo = new MutationObserver(sync);
    mo.observe(list, { childList: true, subtree: true, attributes: true });
    sync();
  }

  function compactManagers() {
    ['checkIn', 'checkOut'].forEach((which) => {
      const host = document.getElementById(`${which}ManagerSuggestions`);
      const input = document.getElementById(`${which}Manager`);
      if (!host || !input || host.dataset.eodCompact === '1') return;
      host.dataset.eodCompact = '1';
      host.classList.add('eod-hidden-chips');
      const trigger = document.createElement('button');
      trigger.type = 'button';
      trigger.className = 'eod-picker-trigger';
      trigger.style.marginTop = '6px';
      trigger.innerHTML = `<span class="eod-picker-label">Choose saved ${which === 'checkIn' ? 'check-in' : 'check-out'} name</span><span class="eod-picker-meta" data-count>0</span>`;
      host.parentNode.insertBefore(trigger, host);
      const sync = () => {
        const n = host.querySelectorAll('.manager-chip').length;
        const meta = trigger.querySelector('[data-count]');
        if (meta) meta.textContent = String(n);
      };
      trigger.addEventListener('click', () => {
        const chips = Array.from(host.querySelectorAll('.manager-chip'));
        const items = chips.map((chip, i) => {
          const name = decodeURIComponent(chip.dataset.managerName || chip.querySelector('.chip-select')?.textContent || '');
          return { id: String(i), label: name, removable: true, raw: chip };
        });
        openPicker({
          anchor: trigger,
          title: which === 'checkIn' ? 'Check-in managers' : 'Check-out managers',
          items: items.length ? items : [{ id: 'empty', label: 'No saved names yet', disabled: true }],
          searchable: items.length > 6,
          onChoose(item) {
            if (item.raw) item.raw.click();
            else if (typeof window.selectManagerName === 'function') window.selectManagerName(which, item.label);
          },
          onRemove(item) {
            const btn = item.raw?.querySelector('.chip-remove');
            if (btn) btn.click();
          },
        });
      });
      const mo = new MutationObserver(sync);
      mo.observe(host, { childList: true, subtree: true });
      sync();
    });
  }

  function compactStorePicker() {
    const input = document.getElementById('storeNumber');
    const list = document.getElementById('storeList');
    if (!input || !list || input.dataset.eodStorePicker === '1') return;
    input.dataset.eodStorePicker = '1';
    const wrap = input.parentNode;
    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'eod-picker-trigger';
    trigger.style.marginTop = '6px';
    trigger.innerHTML = '<span class="eod-picker-label">Pick store number</span><span class="eod-picker-meta">list</span>';
    wrap.appendChild(trigger);
    trigger.addEventListener('click', () => {
      const items = Array.from(list.options || []).map((opt) => ({
        id: opt.value,
        label: `Store ${opt.value}`,
        selected: input.value === opt.value,
      }));
      openPicker({
        anchor: trigger,
        title: 'Store number',
        items,
        searchable: true,
        onChoose(item) {
          input.value = item.id;
          input.dispatchEvent(new Event('input', { bubbles: true }));
          input.dispatchEvent(new Event('change', { bubbles: true }));
          input.dispatchEvent(new Event('blur', { bubbles: true }));
        },
      });
    });
  }

  function relocateInjectedSections() {
    const host = document.getElementById('eodSignoffGroupBody');
    if (!host) return;
    ['digitalSignoffSection', 'deptSigSection'].forEach((id) => {
      const el = document.getElementById(id);
      if (el && el.parentNode !== host) host.appendChild(el);
    });
  }

  function watchInjected() {
    const mo = new MutationObserver(() => relocateInjectedSections());
    mo.observe(document.body, { childList: true, subtree: true });
    relocateInjectedSections();
  }

  function init() {
    ensureNav();
    bindGroups();
    enhanceKnownSelects();
    compactRoster();
    compactFredmeyer();
    compactManagers();
    compactStorePicker();
    watchInjected();
  }

  window.EodWorkspace = {
    openGroup,
    openPicker,
    closePicker,
    enhanceSelect: bindSelect,
  };
  window.EodPicker = { open: openPicker, close: closePicker };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
