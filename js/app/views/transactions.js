/* Activity tab: filtering, the grouped list, rows and swipe gestures. */
'use strict';

/* ======================= Transactions ======================= */

function filteredTransactions() {
  const f = ui.tx;
  const q = f.q.trim().toLowerCase();
  let list = DB.state.transactions.filter((t) => {
    if (f.accountId && t.accountId !== f.accountId) return false;
    if (f.categoryId && t.categoryId !== f.categoryId) return false;
    if (f.from && t.date < f.from) return false;
    if (f.to && t.date > f.to) return false;
    if (q) {
      const cat = DB.category(t.categoryId);
      const acct = DB.account(t.accountId);
      const hay = ((t.note || '') + ' ' + (cat ? cat.name : '') + ' ' +
        (acct ? acct.name : '')).toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
  const cmp = {
    'date-desc': (a, b) => b.date.localeCompare(a.date) || b.amount - a.amount,
    'date-asc': (a, b) => a.date.localeCompare(b.date) || a.amount - b.amount,
    'amount-desc': (a, b) => b.amount - a.amount,
    'amount-asc': (a, b) => a.amount - b.amount
  }[f.sort];
  return list.sort(cmp);
}

function renderTransactions() {
  const root = $('#view-transactions');
  root.innerHTML = '';
  const list = filteredTransactions();

  root.append(el('div', { class: 'view-title' }, [
    el('h1', { text: 'Transactions' }),
    el('button', { class: 'btn small', text: 'Export CSV', onclick: () => exportCSV(list) })
  ]));

  /* One row — search plus a Filter button — instead of three rows of controls
     before the first transaction. What's filtered is never hidden though: every
     active filter shows as a pill with its own ×. */
  const search = el('input', {
    class: 'searchbox', type: 'search', placeholder: 'Search note, category, account…',
    value: ui.tx.q, style: 'flex:1;margin-bottom:0'
  });
  let debounce;
  search.addEventListener('input', () => {
    clearTimeout(debounce);
    debounce = setTimeout(() => { ui.tx.q = search.value; ui.tx.limit = 100; refreshList(); }, 150);
  });

  const activeFilters = () => {
    const out = [];
    if (ui.tx.accountId) {
      const a = DB.account(ui.tx.accountId);
      out.push({ key: 'accountId', label: a ? a.name : 'Account' });
    }
    if (ui.tx.categoryId) {
      const c = DB.category(ui.tx.categoryId);
      out.push({ key: 'categoryId', label: c ? c.icon + ' ' + c.name : 'Category' });
    }
    if (ui.tx.from || ui.tx.to) {
      const f = ui.tx.from ? U.fmtDate(ui.tx.from, { day: 'numeric', month: 'short' }) : '…';
      const t = ui.tx.to ? U.fmtDate(ui.tx.to, { day: 'numeric', month: 'short' }) : '…';
      out.push({ key: 'dates', label: f + ' – ' + t });
    }
    if (ui.tx.sort !== 'date-desc') {
      out.push({ key: 'sort', label: { 'date-asc': 'Oldest first',
        'amount-desc': 'Amount ↓', 'amount-asc': 'Amount ↑' }[ui.tx.sort] || ui.tx.sort });
    }
    return out;
  };

  const filterBtn = el('button', { class: 'btn small', onclick: openTxFilterSheet });
  const pillRow = el('div', { class: 'chips wrap filter-pills' });
  const drawFilterState = () => {
    const act = activeFilters();
    filterBtn.textContent = act.length ? 'Filter · ' + act.length : 'Filter';
    filterBtn.classList.toggle('primary', act.length > 0);
    pillRow.innerHTML = '';
    pillRow.hidden = act.length === 0;
    act.forEach((f) => pillRow.append(el('button', {
      class: 'chip active', text: f.label + '  ✕',
      onclick: () => {
        if (f.key === 'dates') { ui.tx.from = ''; ui.tx.to = ''; }
        else if (f.key === 'sort') ui.tx.sort = 'date-desc';
        else ui.tx[f.key] = '';
        ui.tx.limit = 100;
        drawFilterState(); refreshList();
      }
    })));
  };
  root.append(el('div', { class: 'filterbar' }, [search, filterBtn]), pillRow);
  drawFilterState();

  function openTxFilterSheet() {
    openSheet('Filter', (body, api) => {
      const selAcct = el('select', {}, [el('option', { value: '', text: 'All accounts' })]);
      DB.state.accounts.forEach((a) =>
        selAcct.append(el('option', { value: a.id, text: a.name })));
      selAcct.value = ui.tx.accountId;
      const selCat = el('select', {}, [el('option', { value: '', text: 'All categories' })]);
      DB.state.categories.forEach((c) =>
        selCat.append(el('option', { value: c.id, text: c.icon + ' ' + c.name })));
      selCat.value = ui.tx.categoryId;
      const selSort = el('select', {}, [
        el('option', { value: 'date-desc', text: 'Newest first' }),
        el('option', { value: 'date-asc', text: 'Oldest first' }),
        el('option', { value: 'amount-desc', text: 'Amount ↓' }),
        el('option', { value: 'amount-asc', text: 'Amount ↑' })
      ]);
      selSort.value = ui.tx.sort;
      const from = el('input', { type: 'date', value: ui.tx.from });
      const to = el('input', { type: 'date', value: ui.tx.to });
      [['accountId', selAcct], ['categoryId', selCat], ['sort', selSort],
       ['from', from], ['to', to]].forEach(([key, ctl]) => {
        ctl.addEventListener('change', () => {
          ui.tx[key] = ctl.value; ui.tx.limit = 100;
          drawFilterState(); refreshList();
        });
      });
      body.append(
        el('div', { class: 'field' }, [el('label', { text: 'Account' }), selAcct]),
        el('div', { class: 'field' }, [el('label', { text: 'Category' }), selCat]),
        el('div', { class: 'field' }, [el('label', { text: 'Order' }), selSort]),
        el('div', { class: 'field-row' }, [
          el('div', { class: 'field' }, [el('label', { text: 'From' }), from]),
          el('div', { class: 'field' }, [el('label', { text: 'To' }), to])
        ]),
        el('button', { class: 'btn block', text: 'Reset all', onclick: () => {
          Object.assign(ui.tx, { accountId: '', categoryId: '', from: '', to: '',
            sort: 'date-desc', limit: 100 });
          api.close(); drawFilterState(); refreshList();
        } }),
        el('button', { class: 'btn block primary', text: 'Done', onclick: api.close })
      );
    });
  }

  const listWrap = el('div', { id: 'txlist' });
  root.append(listWrap);
  buildList(listWrap, list);

  function refreshList() {
    buildList(listWrap, filteredTransactions());
  }
}

function buildList(wrap, list) {
  wrap.innerHTML = '';
  if (list.length === 0) {
    wrap.append(el('div', { class: 'empty', html: '<span class="big">🧾</span>No transactions match' }));
    return;
  }
  const shown = list.slice(0, ui.tx.limit);
  let curDay = null;
  let dayTotal = 0;
  const groupByDay = ui.tx.sort.startsWith('date');
  shown.forEach((t, i) => {
    if (groupByDay && t.date !== curDay) {
      curDay = t.date;
      const dayTxs = list.filter((x) => x.date === curDay);
      dayTotal = dayTxs.reduce((s, x) => s +
        (x.type === 'transfer' ? 0 : x.type === 'income' ? x.amount : -x.amount), 0);
      wrap.append(el('div', { class: 'tx-day' }, [
        el('span', { text: U.fmtDate(t.date, { weekday: 'long', day: 'numeric', month: 'long' }) }),
        el('span', { text: fmtEUR(dayTotal) })
      ]));
    }
    wrap.append(txRow(t));
  });
  // First time anyone sees a list, show what a row can do
  maybeShowSwipeHint(wrap.querySelector('.swipe-wrap'));
  if (list.length > shown.length) {
    wrap.append(el('button', {
      class: 'btn block', text: `Show more (${list.length - shown.length} left)`,
      onclick: () => { ui.tx.limit += 100; buildList(wrap, list); }
    }));
  }
}

function txRow(t) {
  const cat = DB.category(t.categoryId);
  const acct = DB.account(t.accountId);
  const isTrf = t.type === 'transfer';
  const toAcct = isTrf ? DB.account(t.toAccountId) : null;
  const row = el('div', { class: 'tx-row' }, [
    el('span', {
      class: 'tx-icon', text: isTrf ? '⇄' : (cat ? cat.icon : '❓'),
      style: 'background:' + U.tintOf(isTrf ? 'blue' : (cat ? cat.color : 'blue'))
    }),
    el('span', { class: 'tx-main' }, [
      el('span', { class: 'tx-title', text: t.note ||
        (isTrf ? 'Transfer' : (cat ? cat.name : 'Transaction')) }),
      el('span', { class: 'tx-sub', text: isTrf
        ? (acct ? acct.name : '—') + ' → ' + (toAcct ? toAcct.name : '—')
        : (cat ? cat.name : '—') + ' · ' + (acct ? acct.name : '—') })
    ]),
    el('span', {
      class: 'tx-amt' + (t.type === 'income' ? ' pos' : isTrf ? ' neutral' : ''),
      text: (isTrf ? '⇄ ' : t.type === 'income' ? '+ ' : '− ') + fmtEUR(t.amount)
    })
  ]);
  return makeSwipeable(row, {
    onTap: () => openTxSheet(t),
    onEdit: () => openTxSheet(t),
    onDelete: async () => {
      // Immediate + undoable, rather than a modal to confirm a gesture
      const snapshot = { ...t };
      await DB.del('transactions', t.id);
      await bumpChanges(1);
      render();
      toastUndo('Deleted', async () => {
        await DB.put('transactions', snapshot);
        await bumpChanges(1);
        render();
      });
    }
  });
}

/* Swipe a row: right reveals Edit, left reveals Delete. A short swipe snaps the
   action open (tap it to act); a long swipe (>50% of the row) fires it directly. */
let closeOpenSwipe = null;
function makeSwipeable(row, { onTap, onEdit, onDelete }) {
  const wrap = el('div', { class: 'swipe-wrap' });
  const edit = el('div', { class: 'swipe-action edit', onclick: () => { reset(); onEdit(); } },
    [el('span', { text: '✏️ Edit' })]);
  const del = el('div', { class: 'swipe-action delete', onclick: () => { reset(); onDelete(); } },
    [el('span', { text: '🗑 Delete' })]);
  wrap.append(edit, del, row);

  const SNAP = 90;
  let startX = 0, startY = 0, curX = 0, openX = 0, dir = -1, moved = false;

  const setX = (x, anim) => {
    row.style.transition = anim ? 'transform .2s ease' : 'none';
    row.style.transform = `translateX(${x}px)`;
    wrap.classList.toggle('dir-right', x > 0);
    wrap.classList.toggle('dir-left', x < 0);
    /* The colored action layers live behind the row at all times, and their edge
       bled through the rounded corners as a faint rim on every row at rest. Only
       paint them mid-gesture — removed after the close animation, not before it,
       or the color vanishes while the row is still sliding back. */
    if (x !== 0) wrap.classList.add('swiping');
    else if (anim) setTimeout(() => { if (!openX) wrap.classList.remove('swiping'); }, 220);
    else wrap.classList.remove('swiping');
  };
  function reset() { openX = 0; setX(0, true); if (closeOpenSwipe === reset) closeOpenSwipe = null; }

  row.addEventListener('touchstart', (e) => {
    if (closeOpenSwipe && closeOpenSwipe !== reset) closeOpenSwipe();
    const t = e.touches[0];
    startX = t.clientX; startY = t.clientY; curX = openX; dir = -1; moved = false;
  }, { passive: true });

  row.addEventListener('touchmove', (e) => {
    const t = e.touches[0];
    const dx = t.clientX - startX, dy = t.clientY - startY;
    if (dir === -1) {
      if (Math.abs(dx) < 6 && Math.abs(dy) < 6) return;
      dir = Math.abs(dx) > Math.abs(dy) ? 1 : 0;   // 1 = horizontal, 0 = vertical scroll
    }
    if (dir !== 1) return;
    e.preventDefault();
    const w = row.offsetWidth || 320;
    curX = Math.max(-w, Math.min(w, openX + dx));
    moved = true;
    setX(curX, false);
  }, { passive: false });

  row.addEventListener('touchend', () => {
    if (dir !== 1 || !moved) return;
    const w = row.offsetWidth || 320;
    if (curX <= -w * 0.5) { reset(); onDelete(); }
    else if (curX >= w * 0.5) { reset(); onEdit(); }
    else if (curX <= -SNAP * 0.5 && curX < 0) { openX = -SNAP; setX(-SNAP, true); closeOpenSwipe = reset; }
    else if (curX >= SNAP * 0.5 && curX > 0) { openX = SNAP; setX(SNAP, true); closeOpenSwipe = reset; }
    else reset();
  });

  row.addEventListener('click', () => {
    if (openX !== 0) { reset(); return; }
    if (!moved) onTap();
  });
  return wrap;
}
