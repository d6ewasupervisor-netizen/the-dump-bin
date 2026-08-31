/* Searchable drop-down / drop-up / bottom-sheet picker. */
(function (global) {
  'use strict';

  const NARROW = 720;
  let pickerState = null;

  function escapeHtml(s) {
    return global.EodApi ? global.EodApi.escapeHtml(s) : String(s ?? '');
  }

  function ensureDom() {
    if (document.getElementById('eodPickerOverlay')) return;
    const overlay = document.createElement('div');
    overlay.id = 'eodPickerOverlay';
    overlay.className = 'picker-overlay';
    overlay.innerHTML = `
      <div class="picker-panel" id="eodPickerPanel" role="dialog" aria-modal="true">
        <div class="picker-head">
          <h3 id="eodPickerTitle">Choose</h3>
          <button type="button" class="btn btn-secondary" id="eodPickerClose">Close</button>
        </div>
        <input type="search" id="eodPickerSearch" class="picker-search" placeholder="Search…" autocomplete="off">
        <div class="picker-list" id="eodPickerList"></div>
        <div class="picker-foot" id="eodPickerFoot" hidden>
          <button type="button" class="btn btn-secondary" id="eodPickerClear">Clear</button>
          <button type="button" class="btn btn-primary" id="eodPickerDone">Done</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    document.getElementById('eodPickerClose').onclick = close;
    document.getElementById('eodPickerSearch').addEventListener('input', renderList);
    document.getElementById('eodPickerDone').onclick = () => {
      if (pickerState?.multiple && typeof pickerState.onChange === 'function') {
        pickerState.onChange(pickerState.selected.slice());
      }
      close();
    };
    document.getElementById('eodPickerClear').onclick = () => {
      if (!pickerState) return;
      pickerState.selected = [];
      renderList();
      if (typeof pickerState.onChange === 'function') pickerState.onChange([]);
    };
  }

  function positionPanel(anchor) {
    const panel = document.getElementById('eodPickerPanel');
    if (!panel) return;
    panel.classList.remove('sheet');
    panel.style.top = panel.style.bottom = panel.style.left = panel.style.right = panel.style.width = '';
    if (window.innerWidth < NARROW || !anchor) {
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
    if (preferUp) {
      panel.style.bottom = `${window.innerHeight - rect.top + 6}px`;
    } else {
      panel.style.top = `${rect.bottom + 6}px`;
    }
  }

  function renderList() {
    if (!pickerState) return;
    const list = document.getElementById('eodPickerList');
    const q = (document.getElementById('eodPickerSearch').value || '').trim().toLowerCase();
    const items = pickerState.items.filter((it) => {
      if (!q) return true;
      return `${it.label || ''} ${it.sublabel || ''} ${it.id || ''}`.toLowerCase().includes(q);
    });
    if (!items.length) {
      list.innerHTML = '<div class="picker-empty">No matches</div>';
      return;
    }
    const selected = new Set(pickerState.selected.map(String));
    list.innerHTML = items.map((it) => {
      const id = String(it.id);
      const on = selected.has(id);
      const remove = it.removable && !it.disabled
        ? `<button type="button" class="picker-item-x" data-remove="${escapeHtml(id)}" aria-label="Remove">×</button>`
        : '';
      return `<div class="picker-item-row">
        <button type="button" class="picker-item${on ? ' is-selected' : ''}${it.disabled ? ' is-disabled' : ''}" data-id="${escapeHtml(id)}">
          <div class="picker-item-text">
            <div class="picker-item-label">${escapeHtml(it.label || id)}</div>
            ${it.sublabel ? `<div class="picker-item-sub">${escapeHtml(it.sublabel)}</div>` : ''}
          </div>
          ${on ? '<span>✓</span>' : ''}
        </button>
        ${remove}
      </div>`;
    }).join('');
    list.querySelectorAll('.picker-item').forEach((btn) => {
      btn.onclick = () => {
        const id = btn.getAttribute('data-id');
        const item = pickerState.items.find((x) => String(x.id) === id);
        if (!item || item.disabled) return;
        if (pickerState.multiple) {
          const idx = pickerState.selected.findIndex((x) => String(x) === id);
          if (idx >= 0) pickerState.selected.splice(idx, 1);
          else pickerState.selected.push(id);
          renderList();
          if (typeof pickerState.onToggle === 'function') pickerState.onToggle(item, pickerState.selected.slice());
        } else {
          if (typeof pickerState.onChoose === 'function') pickerState.onChoose(item);
          close();
        }
      };
    });
    list.querySelectorAll('.picker-item-x').forEach((btn) => {
      btn.onclick = async (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        const id = btn.getAttribute('data-remove');
        const item = pickerState.items.find((x) => String(x.id) === id);
        if (!item || typeof pickerState.onRemove !== 'function') return;
        const ok = await (global.EodAlerts?.showDialog
          ? global.EodAlerts.showDialog({
            title: 'Remove?',
            message: item.label || 'Remove this saved entry?',
            buttons: [
              { id: 'cancel', label: 'Cancel' },
              { id: 'ok', label: 'Remove', primary: true },
            ],
          }).then((r) => r === 'ok')
          : Promise.resolve(window.confirm(`Remove ${item.label}?`)));
        if (!ok || !pickerState) return;
        try {
          await pickerState.onRemove(item);
        } catch (_) {
          return;
        }
        if (!pickerState) return;
        pickerState.items = pickerState.items.filter((x) => String(x.id) !== id);
        pickerState.selected = pickerState.selected.filter((x) => String(x) !== id);
        if (!pickerState.items.length) {
          close();
          return;
        }
        renderList();
      };
    });
  }

  function open(opts) {
    ensureDom();
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
    search.hidden = options.searchable === false;
    document.getElementById('eodPickerFoot').hidden = !pickerState.multiple;
    renderList();
    document.getElementById('eodPickerOverlay').classList.add('show');
    positionPanel(pickerState.anchor);
    if (options.searchable !== false) setTimeout(() => search.focus(), 30);
  }

  function close() {
    document.getElementById('eodPickerOverlay')?.classList.remove('show');
    pickerState = null;
  }

  global.EodPicker = { open, close };
})(typeof window !== 'undefined' ? window : globalThis);
