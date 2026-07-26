/* App: views, navigation, forms, CSV import wizard, backup. */
'use strict';

(() => {
  const { $, $$, el, esc, fmtEUR, toast } = U;

  /* ================= App state (UI only — data lives in DB.state) ========= */
  const now = new Date();
  const ui = {
    view: 'dashboard',
    period: { type: 'month', y: now.getFullYear(), m0: now.getMonth() }, // or {type:'range', from, to}
    donutSel: null,
    stats: {
      range: 'month',            // month | year | all | custom
      y: now.getFullYear(), m0: now.getMonth(),
      from: '', to: '', donutSel: null
    },
    tx: { q: '', accountId: '', categoryId: '', from: '', to: '', sort: 'date-desc', limit: 100 },
    sheetZ: 50
  };

  const ACCOUNT_TYPES = [
    ['checking', 'Checking', '🏦'],
    ['savings', 'Savings', '🐖'],
    ['cash', 'Cash', '💶'],
    ['credit', 'Credit card', '💳']
  ];
  const acctIcon = (type) => (ACCOUNT_TYPES.find(([t]) => t === type) || ACCOUNT_TYPES[0])[2];
  const acctLabel = (type) => (ACCOUNT_TYPES.find(([t]) => t === type) || ACCOUNT_TYPES[0])[1];

  const EMOJI = ['🛒', '🍕', '🍽️', '☕', '🚌', '🚗', '⛽', '🛍️', '👕', '💡', '🏠', '📱', '💊', '❤️',
    '🎬', '🎮', '📚', '✈️', '🏖️', '🎁', '💰', '💼', '📈', '🐾', '👶', '🎓', '🔧', '📦'];

  /* ======================= Sheets & dialogs ======================= */

  function openSheet(title, build) {
    const z = ++ui.sheetZ;
    const backdrop = el('div', { class: 'sheet-backdrop', style: `z-index:${z}` });
    const head = el('div', { class: 'sheet-head' }, [
      el('h2', { text: title }),
      el('button', { class: 'btn small ghost', text: 'Close' })
    ]);
    const body = el('div', { class: 'sheet-body' });
    const grip = el('div', { class: 'sheet-grip' });
    const sheet = el('div', { class: 'sheet', style: `z-index:${z + 1}` }, [grip, head, body]);
    document.body.append(backdrop, sheet);
    requestAnimationFrame(() => { backdrop.classList.add('show'); sheet.classList.add('show'); });

    const api = {
      body,
      close() {
        backdrop.classList.remove('show');
        sheet.classList.remove('show');
        setTimeout(() => { backdrop.remove(); sheet.remove(); }, 260);
      },
      setTitle(t) { head.querySelector('h2').textContent = t; }
    };
    head.querySelector('button').addEventListener('click', api.close);
    backdrop.addEventListener('click', api.close);
    enableDragClose(sheet, backdrop, body, [grip, head], api.close);
    build(body, api);
    return api;
  }

  /* Drag a sheet downward to dismiss it. A drag starts only from the grip/header,
     or from the body when it's scrolled to the top — so inner scrolling still works. */
  function enableDragClose(sheet, backdrop, body, handles, close) {
    let startY = 0, startX = 0, curDy = 0, dragging = false, decided = false, fromHandle = false;

    sheet.addEventListener('touchstart', (e) => {
      const t = e.touches[0];
      startY = t.clientY; startX = t.clientX; curDy = 0;
      dragging = false; decided = false;
      fromHandle = handles.some((h) => h.contains(e.target));
    }, { passive: true });

    sheet.addEventListener('touchmove', (e) => {
      const t = e.touches[0];
      const dy = t.clientY - startY, dx = t.clientX - startX;
      if (!decided) {
        if (Math.abs(dy) < 6 && Math.abs(dx) < 6) return;
        decided = true;
        dragging = dy > 0 && Math.abs(dy) > Math.abs(dx) &&
          (fromHandle || body.scrollTop <= 0);
      }
      if (!dragging) return;
      curDy = Math.max(0, dy);
      e.preventDefault();
      sheet.style.transition = 'none';
      sheet.style.transform = `translateY(${curDy}px)`;
      backdrop.style.opacity = String(Math.max(0, 1 - curDy / 420));
    }, { passive: false });

    const end = () => {
      if (!dragging) return;
      sheet.style.transition = '';
      backdrop.style.opacity = '';
      if (curDy > 110) close();
      else sheet.style.transform = '';
      dragging = false;
    };
    sheet.addEventListener('touchend', end);
    sheet.addEventListener('touchcancel', end);
  }

  function confirmSheet(message, confirmLabel, danger) {
    return new Promise((resolve) => {
      const api = openSheet('Are you sure?', (body) => {
        body.append(
          el('p', { text: message, style: 'padding:4px 2px 18px;line-height:1.5' }),
          el('button', {
            class: 'btn block ' + (danger ? 'danger' : 'primary'),
            text: confirmLabel || 'Confirm',
            onclick: () => { done(true); }
          }),
          el('div', { class: 'spacer' }),
          el('button', { class: 'btn block', text: 'Cancel', onclick: () => done(false) })
        );
        function done(v) { api.close(); resolve(v); }
      });
    });
  }

  /* ======================= Navigation ======================= */

  function show(view) {
    ui.view = view;
    $$('.view').forEach((v) => v.classList.toggle('active', v.id === 'view-' + view));
    $$('.tabbar [data-tab]').forEach((b) =>
      b.classList.toggle('active', b.dataset.tab === view));
    render();
    window.scrollTo(0, 0);
  }

  function render() {
    if (ui.view === 'dashboard') renderDashboard();
    else if (ui.view === 'stats') renderStats();
    else if (ui.view === 'transactions') renderTransactions();
    else if (ui.view === 'accounts') renderAccounts();
    else if (ui.view === 'settings') renderSettings();
  }

  /* ======================= Period helpers ======================= */

  function periodRange() {
    if (ui.period.type === 'month') return U.monthRange(ui.period.y, ui.period.m0);
    return { from: ui.period.from, to: ui.period.to };
  }

  function periodLabel() {
    if (ui.period.type === 'month') return U.monthLabel(ui.period.y, ui.period.m0);
    return U.fmtDate(ui.period.from, { day: 'numeric', month: 'short' }) + ' – ' +
      U.fmtDate(ui.period.to, { day: 'numeric', month: 'short', year: 'numeric' });
  }

  function inRange(t, r) { return t.date >= r.from && t.date <= r.to; }

  /* ======================= Budget ======================= */

  /* Daily budget that redistributes: whatever budget is left is spread evenly over
     the days still remaining in the month. Underspend today and every remaining day
     (including tomorrow) grows by leftover / days-left; overspend and they shrink. */
  function budgetStatus() {
    const b = DB.state.meta.budget;
    if (!b || !b.amount || ui.period.type !== 'month') return null;
    const { y, m0 } = ui.period;
    const D = new Date(y, m0 + 1, 0).getDate();
    const r = U.monthRange(y, m0);
    const exp = DB.state.transactions.filter(
      (t) => t.type === 'expense' && t.date >= r.from && t.date <= r.to);
    const spentMonth = exp.reduce((s, t) => s + t.amount, 0);
    const today = U.todayISO();
    const isCurrent = today >= r.from && today <= r.to;
    const out = {
      amount: b.amount, mode: b.mode || 'monthly', D, spentMonth,
      monthRemaining: b.amount - spentMonth, isCurrent
    };
    if (out.mode === 'daily' && isCurrent) {
      const d = Number(today.slice(8));                     // day of month, 1-indexed
      const dailyBase = b.amount / D;
      const spentBefore = exp.filter((t) => t.date < today).reduce((s, t) => s + t.amount, 0);
      const spentToday = exp.filter((t) => t.date === today).reduce((s, t) => s + t.amount, 0);
      // Today's allowance = budget still unspent, spread over the days left (incl. today).
      const daysLeftIncl = D - d + 1;
      const todayBudget = (b.amount - spentBefore) / daysLeftIncl;
      // Tomorrow's preview: leftover after today, spread over the days after today.
      const daysLeftAfter = D - d;
      const tomorrowBudget = daysLeftAfter > 0
        ? (b.amount - spentBefore - spentToday) / daysLeftAfter
        : null;                                             // today is the last day
      Object.assign(out, {
        dailyBase, d, spentBefore, spentToday, todayBudget,
        todayRemaining: todayBudget - spentToday, tomorrowBudget, daysLeftAfter
      });
    }
    return out;
  }

  function meter(value, max) {
    const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
    const over = value > max && max > 0;
    return el('div', { class: 'meter' + (over ? ' over' : '') },
      [el('div', { class: 'meter-fill', style: 'width:' + pct + '%' })]);
  }

  function budgetCard(bs) {
    const card = el('div', { class: 'card budget-card' }, [
      el('div', { class: 'card-head' }, [
        el('h2', { text: 'Budget' }),
        el('button', { class: 'btn small ghost', text: 'Edit', onclick: openBudgetSheet })
      ])
    ]);

    if (bs.mode === 'daily' && bs.isCurrent) {
      const rem = bs.todayRemaining;
      card.append(el('div', { class: 'budget-today' }, [
        el('div', { class: 'bt-label', text: rem >= 0 ? 'Left to spend today' : 'Over budget today' }),
        el('div', { class: 'bt-value ' + (rem >= 0 ? 'pos' : 'neg'), text: fmtEUR(rem) }),
        el('div', { class: 'muted', text: 'of ' + fmtEUR(bs.todayBudget) + ' allowance today' })
      ]));
      card.append(meter(bs.spentToday, Math.max(bs.todayBudget, bs.spentToday, 0.01)));

      if (bs.tomorrowBudget != null) {
        const delta = bs.tomorrowBudget - bs.dailyBase;
        const hint = Math.abs(delta) < 0.005 ? 'same as base'
          : delta > 0 ? '▲ ' + fmtEUR(delta) + ' vs base'
          : '▼ ' + fmtEUR(-delta) + ' vs base';
        card.append(el('div', { class: 'budget-tomorrow' }, [
          el('span', { class: 'tom-label', text: 'Tomorrow' }),
          el('span', { class: 'tom-value', text: fmtEUR(bs.tomorrowBudget) }),
          el('span', { class: 'tom-hint ' + (delta >= 0 ? 'pos' : 'neg'), text: hint })
        ]));
      } else {
        card.append(el('div', { class: 'muted', style: 'text-align:center;margin-top:10px',
          text: 'Last day of the month' }));
      }
      card.append(el('hr', { class: 'sep' }));
    }

    const mrem = bs.monthRemaining;
    card.append(
      el('div', { class: 'budget-line' }, [
        el('span', { text: (bs.mode === 'daily' ? 'This month' : 'Monthly budget') }),
        el('span', { class: mrem >= 0 ? 'pos' : 'neg', text:
          fmtEUR(bs.spentMonth) + ' / ' + fmtEUR(bs.amount) })
      ]),
      meter(bs.spentMonth, bs.amount),
      el('div', { class: 'muted', style: 'margin-top:6px', text:
        (mrem >= 0 ? fmtEUR(mrem) + ' left' : fmtEUR(-mrem) + ' over') +
        ' · ' + (bs.mode === 'daily' ? fmtEUR(bs.dailyBase) + '/day base' : 'monthly cap') })
    );
    return card;
  }

  function openBudgetSheet() {
    const b = DB.state.meta.budget || { amount: 0, mode: 'daily' };
    openSheet('Monthly budget', (body, api) => {
      const amount = el('input', {
        type: 'text', inputmode: 'decimal', placeholder: '0,00',
        value: b.amount ? String(b.amount).replace('.', ',') : ''
      });
      const amountWrap = el('div', { class: 'amount-wrap' }, [
        el('span', { class: 'cur', text: '€' }), amount
      ]);

      let mode = b.mode || 'daily';
      const seg = el('div', { class: 'seg' });
      const bDaily = el('button', { text: 'Spread per day' });
      const bMonthly = el('button', { text: 'Monthly cap' });
      const syncSeg = () => {
        bDaily.className = mode === 'daily' ? 'active' : '';
        bMonthly.className = mode === 'monthly' ? 'active' : '';
      };
      bDaily.addEventListener('click', () => { mode = 'daily'; syncSeg(); });
      bMonthly.addEventListener('click', () => { mode = 'monthly'; syncSeg(); });
      syncSeg();
      seg.append(bDaily, bMonthly);

      body.append(
        el('p', { class: 'muted', style: 'margin-bottom:6px;line-height:1.5', text:
          'Set how much you want to spend per month.' }),
        el('label', { class: 'field-lbl', text: 'Monthly limit' }),
        amountWrap,
        el('div', { class: 'field', style: 'margin-top:10px' }, [
          el('label', { text: 'Mode' }), seg
        ]),
        el('p', { class: 'muted', style: 'margin:-4px 0 16px;line-height:1.5', text:
          mode === 'daily'
            ? 'Spread per day: whatever budget is left is shared evenly across the days remaining in the month. Spend less today and every day left (including tomorrow) grows; overspend and they shrink.'
            : 'Monthly cap: one total limit for the whole month.' }),
        el('button', {
          class: 'btn block primary', text: 'Save budget',
          onclick: async () => {
            const val = CSV.parseAmount(amount.value);
            if (val == null || val <= 0) return toast('Enter an amount');
            await DB.setMeta('budget', { amount: Math.round(val * 100) / 100, mode });
            api.close(); toast('Budget saved'); render();
          }
        })
      );
      // Keep the explanatory text in sync with the toggle
      const hint = body.querySelector('p.muted:last-of-type');
      const updateHint = () => {
        hint.textContent = mode === 'daily'
          ? 'Spread per day: whatever budget is left is shared evenly across the days remaining in the month. Spend less today and every day left (including tomorrow) grows; overspend and they shrink.'
          : 'Monthly cap: one total limit for the whole month.';
      };
      bDaily.addEventListener('click', updateHint);
      bMonthly.addEventListener('click', updateHint);

      if (DB.state.meta.budget) {
        body.append(
          el('div', { class: 'spacer' }),
          el('button', {
            class: 'btn block danger', text: 'Remove budget',
            onclick: async () => {
              await DB.setMeta('budget', null);
              api.close(); toast('Budget removed'); render();
            }
          })
        );
      }
    });
  }

  /* ======================= Dashboard ======================= */

  function renderDashboard() {
    const root = $('#view-dashboard');
    root.innerHTML = '';
    const r = periodRange();
    const txs = DB.state.transactions.filter((t) => inRange(t, r));
    const income = txs.filter((t) => t.type === 'income').reduce((s, t) => s + t.amount, 0);
    const expense = txs.filter((t) => t.type === 'expense').reduce((s, t) => s + t.amount, 0);

    root.append(el('div', { class: 'view-title' }, [
      el('h1', { text: 'Home' }),
      el('div', { class: 'muted', text: fmtEUR(DB.totalBalance()) + ' total' })
    ]));

    // Passive backup nudge — shows whenever there's something unsaved.
    const last = DB.state.meta.lastBackup;
    const changes = DB.state.meta.changesSinceBackup || 0;
    if (hasUnsaved()) {
      const sub = last
        ? (changes > 0 ? changes + ' change' + (changes === 1 ? '' : 's') + ' since your last backup.'
                       : 'Last backup: ' + new Date(last).toLocaleDateString('it-IT') + '.')
        : 'Not backed up yet — save a copy so you can’t lose it.';
      root.append(el('div', { class: 'banner' }, [
        el('span', { text: '💾', style: 'font-size:1.3rem' }),
        el('div', { class: 'b-main', html: '<strong>Back up your data</strong>' + esc(sub) }),
        el('button', { class: 'btn small primary', text: 'Export', onclick: exportJSON })
      ]));
    }
    if (DB.usingFallback) {
      root.append(el('div', { class: 'banner' }, [
        el('span', { text: '⚠️', style: 'font-size:1.3rem' }),
        el('div', { class: 'b-main', html: '<strong>Temporary storage</strong>' +
          'IndexedDB is unavailable — data lives in memory and is lost when the app closes. Export a backup before leaving.' })
      ]));
    }

    // Bank consent expiry (PSD2: dies after 90 days)
    const consent = DB.state.meta.bankConsent;
    if (consent && consent.expiresAt) {
      const daysLeft = Math.floor((consent.expiresAt - Date.now()) / 86400000);
      if (daysLeft < 0) {
        root.append(el('div', { class: 'banner' }, [
          el('span', { text: '🏦', style: 'font-size:1.3rem' }),
          el('div', { class: 'b-main', html: '<strong>Bank link expired</strong>' +
            'The 90-day consent has ended — run <code>bank_sync.py link</code> to reconnect.' })
        ]));
      } else if (daysLeft <= 7) {
        root.append(el('div', { class: 'banner' }, [
          el('span', { text: '🏦', style: 'font-size:1.3rem' }),
          el('div', { class: 'b-main', html: '<strong>Bank link expiring</strong>' +
            `Consent ends in ${daysLeft} day${daysLeft === 1 ? '' : 's'} — re-link with <code>bank_sync.py link</code> soon.` })
        ]));
      }
    }

    // Imported transactions waiting for a category
    const pending = reviewQueue().length;
    if (pending > 0) {
      root.append(el('div', { class: 'banner' }, [
        el('span', { text: '🏷', style: 'font-size:1.3rem' }),
        el('div', { class: 'b-main', html: '<strong>' + pending + ' to categorize</strong>' +
          'Imported transactions that didn’t match any rule.' }),
        el('button', { class: 'btn small primary', text: 'Review', onclick: openReviewSheet })
      ]));
    }

    // Month / range navigation
    const nav = el('div', { class: 'month-nav' });
    const prev = el('button', { class: 'mn-btn', text: '‹', 'aria-label': 'Previous month' });
    const next = el('button', { class: 'mn-btn', text: '›', 'aria-label': 'Next month' });
    const label = el('button', { class: 'mn-label', text: periodLabel() });
    prev.addEventListener('click', () => shiftMonth(-1));
    next.addEventListener('click', () => shiftMonth(1));
    label.addEventListener('click', openRangeSheet);
    nav.append(prev, label, next);
    root.append(nav);

    // Stat tiles: net is the headline
    const net = income - expense;
    const tiles = el('div', { class: 'tiles' });
    tiles.append(
      el('div', { class: 'tile wide' }, [
        el('div', { class: 't-label', text: 'Net' }),
        el('div', { class: 't-value ' + (net > 0 ? 'pos' : net < 0 ? 'neg' : ''), text: fmtEUR(net) })
      ]),
      el('div', { class: 'tile' }, [
        el('div', { class: 't-label', text: 'Income' }),
        el('div', { class: 't-value pos', text: fmtEUR(income) })
      ]),
      el('div', { class: 'tile' }, [
        el('div', { class: 't-label', text: 'Expenses' }),
        el('div', { class: 't-value neg', text: fmtEUR(expense) })
      ])
    );
    root.append(tiles);

    // Budget
    const bs = budgetStatus();
    if (bs) root.append(budgetCard(bs));

    // Top spending categories (compact) — full charts live in the Stats tab
    const byCat = new Map();
    txs.filter((t) => t.type === 'expense').forEach((t) => {
      byCat.set(t.categoryId, (byCat.get(t.categoryId) || 0) + t.amount);
    });
    const items = [...byCat.entries()]
      .map(([id, value]) => ({ cat: DB.category(id), value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 5);

    const catCard = el('div', { class: 'card' }, [
      el('div', { class: 'card-head' }, [
        el('h2', { text: 'Top spending' }),
        el('button', { class: 'btn small ghost', text: 'All stats ›', onclick: () => show('stats') })
      ])
    ]);
    if (items.length === 0) {
      catCard.append(el('div', { class: 'empty', html: '<span class="big">🍩</span>No expenses this period' }));
    } else {
      const maxV = items[0].value;
      items.forEach(({ cat, value }) => {
        const color = U.colorOf(cat ? cat.color : 'blue');
        catCard.append(el('div', { class: 'catbar' }, [
          el('span', { class: 'catbar-icon', text: cat ? cat.icon : '❓',
            style: 'background:' + U.tintOf(cat ? cat.color : 'blue') }),
          el('div', { class: 'catbar-main' }, [
            el('div', { class: 'catbar-top' }, [
              el('span', { class: 'catbar-name', text: cat ? cat.name : 'Uncategorized' }),
              el('span', { class: 'catbar-val', text: fmtEUR(value) })
            ]),
            el('div', { class: 'catbar-track' }, [
              el('div', { class: 'catbar-fill',
                style: 'width:' + (maxV > 0 ? (value / maxV) * 100 : 0) + '%;background:' + color })
            ])
          ])
        ]));
      });
    }
    root.append(catCard);
  }

  function shiftMonth(delta) {
    if (ui.period.type !== 'month') {
      ui.period = { type: 'month', y: now.getFullYear(), m0: now.getMonth() };
    } else {
      const d = new Date(ui.period.y, ui.period.m0 + delta, 1);
      ui.period = { type: 'month', y: d.getFullYear(), m0: d.getMonth() };
    }
    ui.donutSel = null;
    renderDashboard();
  }

  /** Repair transactions/accounts that got stored in a raw shape — e.g. a bank-sync
      file imported through the backup importer, which leaves rows with a signed
      `amount`, no `type`, and `accountUuid` instead of a real `accountId`. Idempotent:
      once fixed, nothing matches the broken conditions on later loads. */
  async function repairData() {
    if (!DB.state.accounts.length || !DB.state.transactions.length) return 0;

    // Normalize accounts first (bank-sync accounts arrive without type/startingBalance).
    const acctFixes = [];
    for (const a of DB.state.accounts) {
      if (a.type && typeof a.startingBalance === 'number') continue;
      acctFixes.push({ ...a, type: a.type || 'checking',
        startingBalance: typeof a.startingBalance === 'number' ? a.startingBalance : 0 });
    }
    if (acctFixes.length) await DB.bulkPut('accounts', acctFixes);

    const validAcct = new Set(DB.state.accounts.map((a) => a.id));
    // uuid → accountId, from account.uuid (kept on bank-sync accounts) and the saved map.
    const uuidToId = new Map();
    DB.state.accounts.forEach((a) => { if (a.uuid) uuidToId.set(a.uuid, a.id); });
    Object.entries(DB.state.meta.bankAccountMap || {}).forEach(([u, id]) => {
      if (validAcct.has(id)) uuidToId.set(u, id);
    });
    const fallbackAcct = DB.state.accounts[0].id;

    let uncat = null;
    const needUncat = DB.state.transactions.some(
      (t) => !t.categoryId || !DB.category(t.categoryId));
    if (needUncat) uncat = await ensureCategory('Uncategorized', '❓');

    const fixes = [];
    for (const t of DB.state.transactions) {
      const o = { ...t };
      let changed = false;
      if (o.type !== 'income' && o.type !== 'expense') {
        o.type = Number(o.amount) < 0 ? 'expense' : 'income'; changed = true;
      }
      if (typeof o.amount === 'number' && o.amount < 0) {
        o.amount = Math.round(Math.abs(o.amount) * 100) / 100; changed = true;
      }
      if (!validAcct.has(o.accountId)) {
        o.accountId = (o.accountUuid && uuidToId.get(o.accountUuid)) || fallbackAcct;
        changed = true;
      }
      if ('accountUuid' in o) { delete o.accountUuid; changed = true; }
      if (!o.categoryId || !DB.category(o.categoryId)) {
        o.categoryId = uncat.id; o.needsReview = true; changed = true;
      }
      if (changed) fixes.push(o);
    }
    if (fixes.length) await DB.bulkPut('transactions', fixes);
    return fixes.length;
  }

  /** Land Home/Stats on the most recent month that actually has data, so the views
      aren't empty when all the history is in a month other than the real "today"
      (e.g. imported data). No-op if the current month already has transactions. */
  function focusLatestData() {
    const txs = DB.state.transactions;
    if (!txs.length) return;
    const cur = U.monthRange(now.getFullYear(), now.getMonth());
    if (txs.some((t) => t.date >= cur.from && t.date <= cur.to)) return;
    const latest = txs.reduce((mx, t) => (t.date > mx ? t.date : mx), txs[0].date);
    const [ly, lm] = latest.split('-').map(Number);
    ui.period = { type: 'month', y: ly, m0: lm - 1 };
    ui.donutSel = null;
    ui.stats.y = ly; ui.stats.m0 = lm - 1; ui.stats.donutSel = null;
  }

  function openRangeSheet() {
    openSheet('Period', (body, api) => {
      const r = periodRange();
      const from = el('input', { type: 'date', value: r.from });
      const to = el('input', { type: 'date', value: r.to });
      body.append(
        el('button', {
          class: 'btn block', text: 'This month',
          onclick: () => {
            ui.period = { type: 'month', y: now.getFullYear(), m0: now.getMonth() };
            ui.donutSel = null; api.close(); renderDashboard();
          }
        }),
        el('hr', { class: 'sep' }),
        el('div', { class: 'field-row' }, [
          el('div', { class: 'field' }, [el('label', { text: 'From' }), from]),
          el('div', { class: 'field' }, [el('label', { text: 'To' }), to])
        ]),
        el('button', {
          class: 'btn block primary', text: 'Apply range',
          onclick: () => {
            if (!from.value || !to.value || from.value > to.value) return toast('Invalid range');
            ui.period = { type: 'range', from: from.value, to: to.value };
            ui.donutSel = null; api.close(); renderDashboard();
          }
        })
      );
    });
  }

  /* ======================= Stats ======================= */

  const pad2 = (n) => String(n).padStart(2, '0');
  const isoOf = (d) => d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());

  function pickGranularity(from, to) {
    const days = (new Date(to) - new Date(from)) / 86400000 + 1;
    if (days <= 62) return 'day';
    if (days <= 731) return 'month';
    return 'year';
  }

  function statsRange() {
    const s = ui.stats;
    if (s.range === 'year') {
      return { from: s.y + '-01-01', to: s.y + '-12-31', gran: 'month', label: String(s.y), nav: true };
    }
    if (s.range === 'all') {
      const dates = DB.state.transactions.map((t) => t.date).sort();
      const from = dates[0] || U.todayISO();
      const to = dates[dates.length - 1] || U.todayISO();
      return { from, to, gran: pickGranularity(from, to), label: 'All time', nav: false };
    }
    if (s.range === 'custom' && s.from && s.to) {
      return { from: s.from, to: s.to, gran: pickGranularity(s.from, s.to), label: 'Custom', nav: false };
    }
    const r = U.monthRange(s.y, s.m0);
    return { from: r.from, to: r.to, gran: 'day', label: U.monthLabel(s.y, s.m0), nav: true };
  }

  /* Aggregate income/expense into ordered day/month/year buckets across [from,to]. */
  function bucketize(txs, from, to, gran) {
    const buckets = new Map();
    const add = (key) => { if (!buckets.has(key)) buckets.set(key, { income: 0, expense: 0 }); };
    const start = new Date(from + 'T12:00:00'), end = new Date(to + 'T12:00:00');
    if (gran === 'day') {
      for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) add(isoOf(d));
    } else if (gran === 'month') {
      for (let d = new Date(start.getFullYear(), start.getMonth(), 1); d <= end; d.setMonth(d.getMonth() + 1)) {
        add(d.getFullYear() + '-' + pad2(d.getMonth() + 1));
      }
    } else {
      for (let yy = start.getFullYear(); yy <= end.getFullYear(); yy++) add(String(yy));
    }
    txs.forEach((t) => {
      const key = gran === 'day' ? t.date : gran === 'month' ? t.date.slice(0, 7) : t.date.slice(0, 4);
      const b = buckets.get(key);
      if (!b) return;
      if (t.type === 'income') b.income += t.amount; else b.expense += t.amount;
    });
    return [...buckets.entries()].map(([key, v]) => {
      let label, tick;
      if (gran === 'day') {
        label = U.fmtDate(key, { weekday: 'short', day: 'numeric', month: 'short' });
        tick = String(Number(key.slice(8)));
      } else if (gran === 'month') {
        const [y, m] = key.split('-').map(Number);
        label = U.monthLabel(y, m - 1);
        tick = new Date(y, m - 1, 1).toLocaleDateString('it-IT', { month: 'short' });
      } else {
        label = key; tick = key;
      }
      return { key, income: v.income, expense: v.expense, net: v.income - v.expense, label, tick };
    });
  }

  function renderStats() {
    const root = $('#view-stats');
    root.innerHTML = '';
    const rg = statsRange();
    const txs = DB.state.transactions.filter((t) => t.date >= rg.from && t.date <= rg.to);
    const income = txs.filter((t) => t.type === 'income').reduce((s, t) => s + t.amount, 0);
    const expense = txs.filter((t) => t.type === 'expense').reduce((s, t) => s + t.amount, 0);
    const days = (new Date(rg.to) - new Date(rg.from)) / 86400000 + 1;

    root.append(el('div', { class: 'view-title' }, [el('h1', { text: 'Stats' })]));

    // Range presets
    const seg = el('div', { class: 'seg seg-4' });
    [['month', 'Month'], ['year', 'Year'], ['all', 'All'], ['custom', 'Custom']].forEach(([val, lbl]) => {
      seg.append(el('button', {
        class: ui.stats.range === val ? 'active' : '', text: lbl,
        onclick: () => {
          ui.stats.range = val;
          if (val === 'custom' && !ui.stats.from) {
            const r = U.monthRange(ui.stats.y, ui.stats.m0);
            ui.stats.from = r.from; ui.stats.to = r.to;
          }
          ui.stats.donutSel = null; renderStats();
        }
      }));
    });
    root.append(seg);

    // Navigation / custom pickers
    if (rg.nav) {
      const nav = el('div', { class: 'month-nav' });
      const prev = el('button', { class: 'mn-btn', text: '‹' });
      const next = el('button', { class: 'mn-btn', text: '›' });
      prev.addEventListener('click', () => statsShift(-1));
      next.addEventListener('click', () => statsShift(1));
      nav.append(prev, el('div', { class: 'mn-label', text: rg.label }), next);
      root.append(nav);
    } else if (ui.stats.range === 'custom') {
      const from = el('input', { type: 'date', value: ui.stats.from });
      const to = el('input', { type: 'date', value: ui.stats.to });
      from.addEventListener('change', () => { ui.stats.from = from.value; ui.stats.donutSel = null; renderStats(); });
      to.addEventListener('change', () => { ui.stats.to = to.value; ui.stats.donutSel = null; renderStats(); });
      root.append(el('div', { class: 'filterbar' }, [from, to]));
    } else {
      root.append(el('div', { class: 'stats-range-label muted', text: rg.label }));
    }

    // Summary tiles
    const net = income - expense;
    root.append(el('div', { class: 'tiles' }, [
      el('div', { class: 'tile' }, [
        el('div', { class: 't-label', text: 'Income' }),
        el('div', { class: 't-value pos', text: fmtEUR(income) })
      ]),
      el('div', { class: 'tile' }, [
        el('div', { class: 't-label', text: 'Expenses' }),
        el('div', { class: 't-value neg', text: fmtEUR(expense) })
      ]),
      el('div', { class: 'tile' }, [
        el('div', { class: 't-label', text: 'Net' }),
        el('div', { class: 't-value ' + (net > 0 ? 'pos' : net < 0 ? 'neg' : ''), text: fmtEUR(net) })
      ]),
      el('div', { class: 'tile' }, [
        el('div', { class: 't-label', text: 'Avg spend / day' }),
        el('div', { class: 't-value', text: fmtEUR(days > 0 ? expense / days : 0) })
      ])
    ]));

    if (txs.length === 0) {
      root.append(el('div', { class: 'empty', html: '<span class="big">📊</span>No transactions in this period' }));
      return;
    }

    const buckets = bucketize(txs, rg.from, rg.to, rg.gran);

    // Income vs Expenses (grouped bars)
    const gbCard = el('div', { class: 'card' }, [
      el('h2', { text: 'Income vs expenses' }),
      el('div', { class: 'legend-inline' }, [
        legendKey(U.colorOf('aqua'), 'Income'),
        legendKey(U.colorOf('red'), 'Expenses')
      ])
    ]);
    const gbWrap = el('div', { class: 'chart-wrap' });
    gbCard.append(gbWrap);
    root.append(gbCard);
    requestAnimationFrame(() => Charts.groupedBars(gbWrap, buckets, [
      { key: 'income', color: U.colorOf('aqua'), label: 'In' },
      { key: 'expense', color: U.colorOf('red'), label: 'Out' }
    ], { formatValue: fmtEUR }));

    // Net over time (line)
    const netCard = el('div', { class: 'card' }, [el('h2', { text: 'Net over time' })]);
    const netWrap = el('div', { class: 'chart-wrap' });
    netCard.append(netWrap);
    root.append(netCard);
    requestAnimationFrame(() => Charts.line(netWrap,
      buckets.map((b) => ({ tick: b.tick, label: b.label, value: Math.round(b.net * 100) / 100 })),
      { color: U.colorOf('blue'), formatValue: fmtEUR }));

    // Spending by category (donut)
    const byCat = new Map();
    txs.filter((t) => t.type === 'expense').forEach((t) => {
      byCat.set(t.categoryId, (byCat.get(t.categoryId) || 0) + t.amount);
    });
    let items = [...byCat.entries()]
      .map(([id, value]) => {
        const c = DB.category(id);
        return { id, value, label: c ? c.name : 'Uncategorized', icon: c ? c.icon : '❓',
                 color: U.colorOf(c ? c.color : 'blue') };
      })
      .sort((a, b) => b.value - a.value);
    if (items.length > 8) {
      const rest = items.slice(7);
      items = items.slice(0, 7);
      items.push({ id: '__other', value: rest.reduce((s, d) => s + d.value, 0),
        label: 'Other', icon: '•', color: '#898781' });
    }

    const donutCard = el('div', { class: 'card' }, [el('h2', { text: 'Spending by category' })]);
    if (items.length === 0) {
      donutCard.append(el('div', { class: 'empty', html: '<span class="big">🍩</span>No expenses in this period' }));
    } else {
      if (ui.stats.donutSel && !items.some((d) => d.id === ui.stats.donutSel)) ui.stats.donutSel = null;
      const wrap = el('div', { class: 'chart-wrap' });
      const legend = el('div', { class: 'legend' });
      const drawDonut = () => {
        const sel = items.find((d) => d.id === ui.stats.donutSel);
        Charts.donut(wrap, items, {
          selectedId: ui.stats.donutSel,
          onSelect: (id) => { ui.stats.donutSel = id; drawDonut(); },
          centerLabel: sel ? sel.label : 'Expenses',
          centerValue: fmtEUR(sel ? sel.value : expense)
        });
        legend.innerHTML = '';
        for (const d of items) {
          const pct = expense > 0 ? Math.round((d.value / expense) * 100) : 0;
          legend.append(el('button', {
            class: 'legend-row' + (ui.stats.donutSel && ui.stats.donutSel !== d.id ? ' dim' : ''),
            onclick: () => { ui.stats.donutSel = ui.stats.donutSel === d.id ? null : d.id; drawDonut(); }
          }, [
            el('span', { class: 'dot', style: 'background:' + d.color }),
            el('span', { class: 'l-name' }, [el('span', { text: d.icon }), el('span', { class: 'nm', text: d.label })]),
            el('span', { class: 'l-val', text: fmtEUR(d.value) }),
            el('span', { class: 'l-pct', text: pct + '%' })
          ]));
        }
      };
      drawDonut();
      donutCard.append(wrap, legend);
    }
    root.append(donutCard);
  }

  function legendKey(color, label) {
    return el('span', { class: 'lg-key' }, [
      el('span', { class: 'dot', style: 'background:' + color }),
      el('span', { text: label })
    ]);
  }

  function statsShift(delta) {
    if (ui.stats.range === 'year') {
      ui.stats.y += delta;
    } else {
      const d = new Date(ui.stats.y, ui.stats.m0 + delta, 1);
      ui.stats.y = d.getFullYear(); ui.stats.m0 = d.getMonth();
    }
    ui.stats.donutSel = null;
    renderStats();
  }

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
      el('button', { class: 'btn small', text: '⬇︎ CSV', onclick: () => exportCSV(list) })
    ]));

    const search = el('input', {
      class: 'searchbox', type: 'search', placeholder: 'Search note, category, account…',
      value: ui.tx.q
    });
    let debounce;
    search.addEventListener('input', () => {
      clearTimeout(debounce);
      debounce = setTimeout(() => { ui.tx.q = search.value; ui.tx.limit = 100; refreshList(); }, 150);
    });
    root.append(search);

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
      ctl.addEventListener('change', () => { ui.tx[key] = ctl.value; ui.tx.limit = 100; refreshList(); });
    });
    root.append(
      el('div', { class: 'filterbar' }, [selAcct, selCat, selSort]),
      el('div', { class: 'filterbar' }, [from, to])
    );

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
        dayTotal = dayTxs.reduce((s, x) => s + (x.type === 'income' ? x.amount : -x.amount), 0);
        wrap.append(el('div', { class: 'tx-day' }, [
          el('span', { text: U.fmtDate(t.date, { weekday: 'long', day: 'numeric', month: 'long' }) }),
          el('span', { text: fmtEUR(dayTotal) })
        ]));
      }
      wrap.append(txRow(t));
    });
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
    const sign = t.type === 'income' ? '+' : '−';
    const row = el('div', { class: 'tx-row' }, [
      el('span', {
        class: 'tx-icon', text: cat ? cat.icon : '❓',
        style: 'background:' + U.tintOf(cat ? cat.color : 'blue')
      }),
      el('span', { class: 'tx-main' }, [
        el('span', { class: 'tx-title', text: t.note || (cat ? cat.name : 'Transaction') }),
        el('span', { class: 'tx-sub', text: (cat ? cat.name : '—') + ' · ' + (acct ? acct.name : '—') })
      ]),
      el('span', {
        class: 'tx-amt' + (t.type === 'income' ? ' pos' : ''),
        text: sign + ' ' + fmtEUR(t.amount)
      })
    ]);
    return makeSwipeable(row, {
      onTap: () => openTxSheet(t),
      onEdit: () => openTxSheet(t),
      onDelete: async () => {
        if (!(await confirmSheet('Delete this transaction?', 'Delete', true))) return;
        await DB.del('transactions', t.id);
        await bumpChanges(1);
        toast('Deleted'); render();
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

  /* ======================= Transaction sheet ======================= */

  function openTxSheet(existing) {
    if (DB.state.accounts.length === 0) return toast('Create an account first');
    const draft = existing ? { ...existing } : {
      id: null, type: 'expense', amount: 0, date: U.todayISO(),
      categoryId: '', accountId: DB.state.accounts[0].id, note: ''
    };
    let manualCat = !!existing; // don't auto-override an existing/manual choice

    openSheet(existing ? 'Edit transaction' : 'New transaction', (body, api) => {
      // Type toggle
      const seg = el('div', { class: 'seg' });
      const bExp = el('button', { text: 'Expense' });
      const bInc = el('button', { text: 'Income' });
      const syncSeg = () => {
        bExp.className = draft.type === 'expense' ? 'active exp' : '';
        bInc.className = draft.type === 'income' ? 'active inc' : '';
      };
      bExp.addEventListener('click', () => { draft.type = 'expense'; syncSeg(); });
      bInc.addEventListener('click', () => { draft.type = 'income'; syncSeg(); });
      syncSeg();
      seg.append(bExp, bInc);

      // Amount
      const amount = el('input', {
        type: 'text', inputmode: 'decimal', placeholder: '0,00', autocomplete: 'off',
        value: existing ? existing.amount.toFixed(2).replace('.', ',') : ''
      });
      const amountWrap = el('div', { class: 'amount-wrap' }, [
        el('span', { class: 'cur', text: '€' }), amount
      ]);

      // Date
      const date = el('input', { type: 'date', value: draft.date });
      date.addEventListener('change', () => { draft.date = date.value; });

      // Account chips
      const acctChips = el('div', { class: 'chips scroll' });
      const drawAccts = () => {
        acctChips.innerHTML = '';
        DB.state.accounts.forEach((a) => {
          acctChips.append(el('button', {
            class: 'chip' + (draft.accountId === a.id ? ' active' : ''),
            onclick: () => { draft.accountId = a.id; drawAccts(); }
          }, [el('span', { text: acctIcon(a.type) }), el('span', { text: a.name })]));
        });
      };
      drawAccts();

      // Category chips
      const catChips = el('div', { class: 'chips scroll' });
      const drawCats = () => {
        catChips.innerHTML = '';
        DB.state.categories.forEach((c) => {
          catChips.append(el('button', {
            class: 'chip' + (draft.categoryId === c.id ? ' active' : ''),
            onclick: () => { draft.categoryId = c.id; manualCat = true; suggest.textContent = ''; drawCats(); }
          }, [
            el('span', { class: 'dot', style: 'background:' + U.colorOf(c.color) }),
            el('span', { text: c.icon + ' ' + c.name })
          ]));
        });
      };
      drawCats();

      // Note + rule-based suggestion
      const note = el('input', {
        type: 'text', placeholder: 'Note (e.g. ESSELUNGA)', value: draft.note || '',
        autocomplete: 'off', autocapitalize: 'characters'
      });
      const suggest = el('div', { class: 'note-suggest' });
      note.addEventListener('input', () => {
        draft.note = note.value;
        if (manualCat) return;
        const hit = DB.suggestCategory(note.value);
        if (hit) {
          draft.categoryId = hit.id;
          suggest.textContent = '💡 Suggested: ' + hit.icon + ' ' + hit.name;
          drawCats();
        } else {
          suggest.textContent = '';
        }
      });

      const save = el('button', {
        class: 'btn block primary', text: existing ? 'Save changes' : 'Add transaction',
        onclick: async () => {
          const val = CSV.parseAmount(amount.value);
          if (val == null || val <= 0) return toast('Enter an amount');
          if (!draft.accountId) return toast('Pick an account');
          if (!draft.categoryId) return toast('Pick a category');
          if (!draft.date) return toast('Pick a date');
          draft.amount = Math.round(val * 100) / 100;
          delete draft.needsReview;   // manually edited = reviewed
          await DB.put('transactions', draft);
          await bumpChanges(1);
          api.close();
          toast(existing ? 'Saved' : 'Added ' + fmtEUR(draft.amount));
          render();
        }
      });

      body.append(
        seg, amountWrap,
        el('div', { class: 'field' }, [el('label', { text: 'Date' }), date]),
        el('div', { class: 'field' }, [el('label', { text: 'Account' }), acctChips]),
        el('div', { class: 'field' }, [el('label', { text: 'Category' }), catChips]),
        el('div', { class: 'field' }, [el('label', { text: 'Note' }), note, suggest]),
        save
      );

      if (existing) {
        body.append(
          el('div', { class: 'spacer' }),
          el('button', {
            class: 'btn block danger', text: 'Delete transaction',
            onclick: async () => {
              if (!(await confirmSheet('Delete this transaction?', 'Delete', true))) return;
              await DB.del('transactions', existing.id);
              await bumpChanges(1);
              api.close(); toast('Deleted'); render();
            }
          })
        );
      } else {
        setTimeout(() => amount.focus(), 320);
      }
    });
  }

  /* ======================= Accounts ======================= */

  function renderAccounts() {
    const root = $('#view-accounts');
    root.innerHTML = '';
    root.append(el('div', { class: 'view-title' }, [
      el('h1', { text: 'Accounts' }),
      el('button', { class: 'btn small', text: '+ Add', onclick: () => openAccountSheet(null) })
    ]));

    const total = DB.totalBalance();
    root.append(el('div', { class: 'tiles' }, [
      el('div', { class: 'tile wide' }, [
        el('div', { class: 't-label', text: 'Combined balance' }),
        el('div', { class: 't-value ' + (total < 0 ? 'neg' : ''), text: fmtEUR(total) })
      ])
    ]));

    if (DB.state.accounts.length === 0) {
      root.append(el('div', { class: 'empty', html: '<span class="big">🏦</span>No accounts yet' }));
      return;
    }
    DB.state.accounts.forEach((a) => {
      const bal = DB.accountBalance(a.id);
      const n = DB.state.transactions.filter((t) => t.accountId === a.id).length;
      root.append(el('button', { class: 'acct-row', onclick: () => openAccountSheet(a) }, [
        el('span', { class: 'a-icon', text: acctIcon(a.type) }),
        el('span', { class: 'a-main' }, [
          el('div', { class: 'a-name', text: a.name }),
          el('div', { class: 'a-type', text: acctLabel(a.type) + ' · ' + n + ' transactions' })
        ]),
        el('span', { class: 'a-bal' + (bal < 0 ? ' neg' : ''), text: fmtEUR(bal) })
      ]));
    });
  }

  function openAccountSheet(existing) {
    const draft = existing ? { ...existing } :
      { id: null, name: '', type: 'checking', startingBalance: 0 };
    openSheet(existing ? 'Edit account' : 'New account', (body, api) => {
      const name = el('input', { type: 'text', placeholder: 'e.g. Revolut', value: draft.name });
      const type = el('select', {}, ACCOUNT_TYPES.map(([v, l, ic]) =>
        el('option', { value: v, text: ic + ' ' + l })));
      type.value = draft.type;
      const start = el('input', {
        type: 'text', inputmode: 'decimal', placeholder: '0,00',
        value: existing ? String(draft.startingBalance).replace('.', ',') : ''
      });
      body.append(
        el('div', { class: 'field' }, [el('label', { text: 'Name' }), name]),
        el('div', { class: 'field' }, [el('label', { text: 'Type' }), type]),
        el('div', { class: 'field' }, [el('label', { text: 'Starting balance (€)' }), start]),
        el('button', {
          class: 'btn block primary', text: existing ? 'Save changes' : 'Add account',
          onclick: async () => {
            if (!name.value.trim()) return toast('Enter a name');
            draft.name = name.value.trim();
            draft.type = type.value;
            draft.startingBalance = CSV.parseAmount(start.value) || 0;
            await DB.put('accounts', draft);
            api.close(); render();
          }
        })
      );
      if (existing) {
        const n = DB.state.transactions.filter((t) => t.accountId === existing.id).length;
        body.append(
          el('div', { class: 'spacer' }),
          el('button', {
            class: 'btn block danger', text: 'Delete account',
            onclick: async () => {
              const msg = n > 0
                ? `Delete "${existing.name}" and its ${n} transactions? This cannot be undone.`
                : `Delete "${existing.name}"?`;
              if (!(await confirmSheet(msg, 'Delete', true))) return;
              await DB.bulkDel('transactions',
                DB.state.transactions.filter((t) => t.accountId === existing.id).map((t) => t.id));
              await DB.del('accounts', existing.id);
              await bumpChanges(Math.max(1, n));
              api.close(); toast('Account deleted'); render();
            }
          })
        );
      }
    });
  }

  /* ======================= Settings ======================= */

  function renderSettings() {
    const root = $('#view-settings');
    root.innerHTML = '';
    root.append(el('div', { class: 'view-title' }, [el('h1', { text: 'Settings' })]));

    // Budget
    const bud = DB.state.meta.budget;
    root.append(el('div', { class: 'card' }, [
      el('div', { style: 'display:flex;justify-content:space-between;align-items:center;margin-bottom:6px' }, [
        el('h2', { text: 'Monthly budget' }),
        el('button', { class: 'btn small', text: bud ? 'Edit' : '+ Set', onclick: openBudgetSheet })
      ]),
      el('p', { class: 'muted', style: 'line-height:1.5', text: bud
        ? fmtEUR(bud.amount) + ' / month · ' +
          (bud.mode === 'daily' ? 'spread per day with rolling balance' : 'monthly cap')
        : 'Set a monthly spending limit, optionally spread across each day and rebalanced automatically.' })
    ]));

    // Quick-add button (Home / Lock Screen)
    const stepList = (items) =>
      el('ol', { class: 'howto-steps' }, items.map((t) => el('li', { html: t })));
    root.append(el('div', { class: 'card' }, [
      el('h2', { text: 'Home / Lock Screen quick-add' }),
      el('p', { class: 'muted', style: 'line-height:1.5', text:
        'A one-tap “Add expense” button that opens straight into a new transaction. iOS can’t set this up automatically, so pick whichever spot you want:' }),
      el('button', { class: 'btn block', style: 'margin-top:12px', text: '📋 Copy quick-add link', onclick: copyAddLink }),

      el('hr', { class: 'sep' }),
      el('div', { class: 'howto' }, [
        el('div', { class: 'howto-title', text: '🏠 Home Screen — no Shortcut needed' }),
        stepList([
          'Copy the link above, then open <strong>Safari</strong> and paste it into the address bar and go.',
          'Tap the <strong>Share</strong> button, then <strong>Add to Home Screen</strong>.',
          'Name it “Add expense” and tap <strong>Add</strong>.'
        ]),
        el('div', { class: 'muted', style: 'line-height:1.5', text:
          'That icon opens the app right on the new-transaction form — and shares the same data as your main icon. (Do this in Safari, not inside the installed app.)' })
      ]),

      el('hr', { class: 'sep' }),
      el('div', { class: 'howto' }, [
        el('div', { class: 'howto-title', text: '🔒 Lock Screen — needs a Shortcut' }),
        stepList([
          'Open the <strong>Shortcuts</strong> app → tap <strong>+</strong> → <strong>Add Action</strong> → search <strong>“Open URLs”</strong>.',
          'Paste the quick-add link into it, then name the shortcut “Add expense”.',
          'Touch and hold your Lock Screen → <strong>Customise</strong> → add a <strong>Shortcuts</strong> widget → pick “Add expense”.'
        ]),
        el('div', { class: 'muted', style: 'line-height:1.5', text:
          'The Lock Screen only accepts widgets, so this one spot needs a Shortcut wrapping the link. A website can’t create the Shortcut for you — this is the one-time manual setup.' })
      ])
    ]));

    // Backup
    const last = DB.state.meta.lastBackup;
    root.append(el('div', { class: 'card' }, [
      el('h2', { text: 'Backup' }),
      el('p', {
        class: 'muted', style: 'margin-bottom:12px;line-height:1.5',
        text: 'All data lives only on this device. iOS can clear browser storage — export a JSON backup regularly and keep it somewhere safe.'
          + (last ? ' Last backup: ' + new Date(last).toLocaleDateString('it-IT') + '.' : ' No backup yet.')
      }),
      el('button', { class: 'btn block primary', text: '⬇︎ Export backup (JSON)', onclick: exportJSON }),
      el('div', { class: 'spacer' }),
      el('button', { class: 'btn block', text: '⬆︎ Import backup (JSON)', onclick: importJSON })
    ]));

    // Backup reminders
    root.append(reminderSettingsCard());

    // CSV import
    const presets = DB.state.presets;
    const csvCard = el('div', { class: 'card' }, [
      el('h2', { text: 'Bank CSV import' }),
      el('button', { class: 'btn block', text: '📄 Import bank CSV…', onclick: openCsvWizard })
    ]);
    if (presets.length) {
      csvCard.append(el('div', { class: 'spacer' }),
        el('div', { class: 'muted', text: 'Saved bank presets:' }));
      presets.forEach((p) => {
        csvCard.append(el('div', { class: 'set-row' }, [
          el('span', { class: 's-main', text: p.name }),
          el('button', {
            class: 'btn small ghost', text: 'Delete',
            onclick: async () => { await DB.del('presets', p.id); renderSettings(); }
          })
        ]));
      });
    }
    root.append(csvCard);

    // Bank sync (GoCardless via the on-phone Python tool)
    const consent2 = DB.state.meta.bankConsent;
    const reviewN = reviewQueue().length;
    const bankCard = el('div', { class: 'card' }, [
      el('h2', { text: 'Bank sync (buddybank)' }),
      el('p', { class: 'muted', style: 'line-height:1.5;margin-bottom:12px', text:
        'Automatic import via GoCardless (free PSD2). The fetch runs on this phone in the free ' +
        'a-Shell app — see sync/README.md — and produces a file you import here. ' +
        'Duplicates are impossible: every bank transaction has a stable ID and re-imports are merged.' }),
      el('button', { class: 'btn block primary', text: '🏦 Import bank sync file', onclick: importBankSync })
    ]);
    if (consent2 && consent2.expiresAt) {
      const daysLeft = Math.floor((consent2.expiresAt - Date.now()) / 86400000);
      bankCard.append(el('p', { class: 'muted', style: 'margin-top:10px', text:
        daysLeft < 0 ? '⚠️ Bank consent expired — re-link with bank_sync.py link.'
          : 'Bank consent valid for ' + daysLeft + ' more day' + (daysLeft === 1 ? '' : 's') +
            (daysLeft <= 7 ? ' — re-link soon.' : '.') }));
    }
    if (reviewN > 0) {
      bankCard.append(
        el('div', { class: 'spacer' }),
        el('button', { class: 'btn block', text: '🏷 Review queue (' + reviewN + ')', onclick: openReviewSheet })
      );
    }
    root.append(bankCard);

    // Categories
    const catCard = el('div', { class: 'card' }, [
      el('div', { style: 'display:flex;justify-content:space-between;align-items:center;margin-bottom:6px' }, [
        el('h2', { text: 'Categories' }),
        el('button', { class: 'btn small', text: '+ Add', onclick: () => openCategorySheet(null) })
      ])
    ]);
    DB.state.categories.forEach((c) => {
      catCard.append(el('button', { class: 'set-row', onclick: () => openCategorySheet(c) }, [
        el('span', { class: 'tx-icon', text: c.icon, style: 'background:' + U.tintOf(c.color) }),
        el('span', { class: 's-main', text: c.name }),
        el('span', { class: 's-chev', text: '›' })
      ]));
    });
    root.append(catCard);

    // Keyword rules
    const ruleCard = el('div', { class: 'card' }, [
      el('div', { style: 'display:flex;justify-content:space-between;align-items:center;margin-bottom:6px' }, [
        el('h2', { text: 'Category rules' }),
        el('button', { class: 'btn small', text: '+ Add', onclick: () => openRuleSheet(null) })
      ]),
      el('p', {
        class: 'muted', style: 'margin-bottom:8px;line-height:1.5',
        text: 'When a note or imported description contains a keyword, the category is suggested automatically.'
      })
    ]);
    if (DB.state.rules.length === 0) {
      ruleCard.append(el('div', { class: 'muted', text: 'No rules yet.' }));
    }
    DB.state.rules.forEach((r) => {
      const cat = DB.category(r.categoryId);
      ruleCard.append(el('button', { class: 'set-row', onclick: () => openRuleSheet(r) }, [
        el('span', { class: 's-main' }, [
          el('div', { text: '“' + r.keyword + '”' + (r.regex ? '  ·  regex' : '') }),
          el('div', { class: 's-sub', text: '→ ' + (cat ? cat.icon + ' ' + cat.name : '?') })
        ]),
        el('span', { class: 's-chev', text: '›' })
      ]));
    });
    root.append(ruleCard);

    // Danger zone
    root.append(el('div', { class: 'card' }, [
      el('h2', { text: 'Danger zone' }),
      el('button', {
        class: 'btn block danger', text: 'Delete all data',
        onclick: async () => {
          const n = DB.state.transactions.length;
          if (!(await confirmSheet(
            `Permanently delete everything on this device (${n} transactions, all accounts, categories and rules)? ` +
            'Export a backup first if you might need it.', 'Delete everything', true))) return;
          if (!(await confirmSheet('Really delete all data? There is no undo.', 'Yes, delete it all', true))) return;
          await DB.wipeAll();
          location.reload();
        }
      })
    ]));

    root.append(el('p', {
      class: 'muted', style: 'text-align:center;padding:8px 0 20px',
      text: 'Expense Tracker · offline PWA · data stays on your device'
    }));
  }

  function openCategorySheet(existing) {
    const draft = existing ? { ...existing } :
      { id: null, name: '', icon: '🛒', color: 'blue' };
    openSheet(existing ? 'Edit category' : 'New category', (body, api) => {
      const name = el('input', { type: 'text', placeholder: 'e.g. Groceries', value: draft.name });

      const emojiGrid = el('div', { class: 'emoji-grid' });
      const drawEmoji = () => {
        emojiGrid.innerHTML = '';
        EMOJI.forEach((e) => emojiGrid.append(el('button', {
          class: draft.icon === e ? 'active' : '', text: e,
          onclick: () => { draft.icon = e; drawEmoji(); }
        })));
      };
      drawEmoji();

      const swatches = el('div', { class: 'swatches' });
      const drawSwatches = () => {
        swatches.innerHTML = '';
        U.PALETTE_ORDER.forEach((key) => swatches.append(el('button', {
          class: 'swatch' + (draft.color === key ? ' active' : ''),
          style: 'background:' + U.colorOf(key), 'aria-label': key,
          onclick: () => { draft.color = key; drawSwatches(); }
        })));
      };
      drawSwatches();

      body.append(
        el('div', { class: 'field' }, [el('label', { text: 'Name' }), name]),
        el('div', { class: 'field' }, [el('label', { text: 'Icon' }), emojiGrid]),
        el('div', { class: 'field' }, [el('label', { text: 'Color' }), swatches]),
        el('button', {
          class: 'btn block primary', text: existing ? 'Save changes' : 'Add category',
          onclick: async () => {
            if (!name.value.trim()) return toast('Enter a name');
            draft.name = name.value.trim();
            await DB.put('categories', draft);
            api.close(); render();
          }
        })
      );
      if (existing) {
        const used = DB.state.transactions.filter((t) => t.categoryId === existing.id);
        body.append(
          el('div', { class: 'spacer' }),
          el('button', {
            class: 'btn block danger', text: 'Delete category',
            onclick: async () => {
              if (DB.state.categories.length <= 1) return toast('Keep at least one category');
              const fallback = DB.state.categories.find((c) =>
                c.id !== existing.id && c.name === 'Other') ||
                DB.state.categories.find((c) => c.id !== existing.id);
              const msg = used.length > 0
                ? `Delete "${existing.name}"? Its ${used.length} transactions will move to "${fallback.name}".`
                : `Delete "${existing.name}"?`;
              if (!(await confirmSheet(msg, 'Delete', true))) return;
              if (used.length) {
                await DB.bulkPut('transactions',
                  used.map((t) => ({ ...t, categoryId: fallback.id })));
              }
              await DB.bulkDel('rules',
                DB.state.rules.filter((rl) => rl.categoryId === existing.id).map((rl) => rl.id));
              await DB.del('categories', existing.id);
              api.close(); render();
            }
          })
        );
      }
    });
  }

  function openRuleSheet(existing) {
    const draft = existing ? { ...existing } :
      { id: null, keyword: '', categoryId: DB.state.categories[0] ? DB.state.categories[0].id : '' };
    openSheet(existing ? 'Edit rule' : 'New rule', (body, api) => {
      const kw = el('input', {
        type: 'text', placeholder: 'e.g. ESSELUNGA', value: draft.keyword,
        autocapitalize: 'characters'
      });
      const rx = el('input', { type: 'checkbox' });
      rx.checked = !!draft.regex;
      const cat = el('select', {}, DB.state.categories.map((c) =>
        el('option', { value: c.id, text: c.icon + ' ' + c.name })));
      if (draft.categoryId) cat.value = draft.categoryId;
      body.append(
        el('div', { class: 'field' }, [el('label', { text: 'If the note contains…' }), kw]),
        el('label', { style: 'display:flex;gap:8px;align-items:center;font-size:0.85rem;margin-bottom:14px' },
          [rx, el('span', { text: 'Treat as regular expression (e.g. ^POS.*MILANO)' })]),
        el('div', { class: 'field' }, [el('label', { text: 'Suggest category' }), cat]),
        el('button', {
          class: 'btn block primary', text: existing ? 'Save changes' : 'Add rule',
          onclick: async () => {
            if (!kw.value.trim()) return toast('Enter a keyword');
            if (rx.checked) {
              try { new RegExp(kw.value.trim()); } catch { return toast('Invalid regular expression'); }
            }
            draft.keyword = kw.value.trim();
            draft.regex = rx.checked || undefined;
            draft.categoryId = cat.value;
            await DB.put('rules', draft);
            api.close();
            await offerApplyRuleToPast(draft);
            render();
          }
        })
      );
      if (existing) {
        body.append(
          el('div', { class: 'spacer' }),
          el('button', {
            class: 'btn block danger', text: 'Delete rule',
            onclick: async () => {
              await DB.del('rules', existing.id);
              api.close(); render();
            }
          })
        );
      }
    });
  }

  /* ======================= Backup reminders ======================= */

  const REMINDER_DEFAULTS = { enabled: true, days: 7, count: 25 };
  let remindedThisSession = false;

  function reminderCfg() {
    return Object.assign({}, REMINDER_DEFAULTS, DB.state.meta.backupReminder || {});
  }

  async function bumpChanges(n) {
    if (!n) return;
    await DB.setMeta('changesSinceBackup', (DB.state.meta.changesSinceBackup || 0) + n);
  }

  /** Is a backup overdue by the user's time or change-count thresholds? */
  function backupDue() {
    const cfg = reminderCfg();
    if (!cfg.enabled || DB.state.transactions.length === 0) return false;
    const now = Date.now();
    if (now < (DB.state.meta.backupSnoozeUntil || 0)) return false;
    const baseline = DB.state.meta.lastBackup || DB.state.meta.installedAt || now;
    const daysSince = (now - baseline) / 86400000;
    const changes = DB.state.meta.changesSinceBackup || 0;
    return daysSince >= cfg.days || (cfg.count > 0 && changes >= cfg.count);
  }

  /** True whenever there's anything worth backing up (drives the passive banner). */
  function hasUnsaved() {
    return DB.state.transactions.length > 0 &&
      ((DB.state.meta.changesSinceBackup || 0) > 0 || !DB.state.meta.lastBackup);
  }

  function maybeRemindBackup() {
    if (remindedThisSession || !backupDue()) return;
    if (document.querySelector('.sheet')) return;
    remindedThisSession = true;
    // Soft-snooze one day so dismissing doesn't re-pop on the next open today.
    DB.setMeta('backupSnoozeUntil', Date.now() + 86400000);
    setTimeout(openBackupReminder, 500);
  }

  function openBackupReminder() {
    if (document.querySelector('.sheet')) return;
    const last = DB.state.meta.lastBackup;
    const changes = DB.state.meta.changesSinceBackup || 0;
    const daysSince = last ? Math.floor((Date.now() - last) / 86400000) : null;

    let msg;
    if (!last) {
      msg = 'You haven’t saved a backup yet. Your data lives only on this phone — save a copy so an app or storage reset can never wipe it.';
    } else {
      const bits = [];
      if (daysSince >= 1) bits.push('it’s been ' + daysSince + ' day' + (daysSince === 1 ? '' : 's'));
      if (changes > 0) bits.push(changes + ' change' + (changes === 1 ? '' : 's'));
      const since = bits.length ? bits.join(' and ') + ' since your last backup' : 'time for a fresh backup';
      msg = 'Quick reminder — ' + since + '. Save a new copy so nothing gets lost.';
    }

    openSheet('Back up your data', (body, api) => {
      body.append(
        el('div', { class: 'reminder-hero', text: '💾' }),
        el('p', { class: 'reminder-msg', text: msg }),
        el('button', {
          class: 'btn block primary', text: '⬇︎ Export backup now',
          onclick: async () => { await exportJSON(); api.close(); }
        }),
        el('div', { class: 'spacer' }),
        el('button', {
          class: 'btn block', text: 'Remind me later',
          onclick: async () => {
            await DB.setMeta('backupSnoozeUntil', Date.now() + 3 * 86400000);
            api.close(); toast('Okay — I’ll remind you in 3 days');
          }
        }),
        el('button', {
          class: 'btn block ghost', text: 'Reminder settings',
          onclick: () => { api.close(); show('settings'); }
        })
      );
    });
  }

  function reminderSettingsCard() {
    const cfg = reminderCfg();
    const save = async (patch) => {
      await DB.setMeta('backupReminder', Object.assign({}, cfg, patch));
      renderSettings();
    };

    const card = el('div', { class: 'card' }, [el('h2', { text: 'Backup reminders' })]);

    // Enable toggle
    const toggle = el('input', { type: 'checkbox' });
    toggle.checked = cfg.enabled;
    toggle.addEventListener('change', () => save({ enabled: toggle.checked }));
    card.append(el('label', { class: 'switch-row' }, [
      el('div', { class: 's-main' }, [
        el('div', { text: 'Remind me to back up' }),
        el('div', { class: 's-sub', text: 'A friendly popup when you open the app and a backup is due.' })
      ]),
      toggle
    ]));

    if (cfg.enabled) {
      // Every N days
      const daysSel = el('select', {}, [[3, 'Every 3 days'], [7, 'Every week'],
        [14, 'Every 2 weeks'], [30, 'Every month']].map(([v, l]) =>
        el('option', { value: String(v), text: l })));
      daysSel.value = String(cfg.days);
      daysSel.addEventListener('change', () => save({ days: Number(daysSel.value) }));

      // After N changes
      const countSel = el('select', {}, [[10, 'After 10 changes'], [25, 'After 25 changes'],
        [50, 'After 50 changes'], [0, 'Ignore change count']].map(([v, l]) =>
        el('option', { value: String(v), text: l })));
      countSel.value = String(cfg.count);
      countSel.addEventListener('change', () => save({ count: Number(countSel.value) }));

      card.append(
        el('hr', { class: 'sep' }),
        el('p', { class: 'muted', style: 'margin-bottom:10px;line-height:1.5',
          text: 'Whichever comes first triggers the reminder.' }),
        el('div', { class: 'field' }, [el('label', { text: 'By time' }), daysSel]),
        el('div', { class: 'field' }, [el('label', { text: 'By activity' }), countSel])
      );

      const changes = DB.state.meta.changesSinceBackup || 0;
      const last = DB.state.meta.lastBackup;
      card.append(el('div', { class: 'muted', style: 'line-height:1.5', text:
        changes + ' change' + (changes === 1 ? '' : 's') + ' since ' +
        (last ? 'your last backup (' + new Date(last).toLocaleDateString('it-IT') + ')' : 'you started') + '.' }));

      card.append(
        el('div', { class: 'spacer' }),
        el('button', { class: 'btn small ghost', text: 'Preview reminder', onclick: openBackupReminder })
      );
    }
    return card;
  }

  /* ======================= Bank sync (GoCardless file import) ======================= */

  async function ensureCategory(name, icon, color) {
    let cat = DB.state.categories.find((c) => c.name.toLowerCase() === name.toLowerCase());
    if (!cat) {
      cat = { id: null, name, icon, color: color || 'blue' };
      await DB.put('categories', cat);
    }
    return cat;
  }

  function importBankSync() {
    pickFile('.json,application/json', (text) => {
      let data;
      try { data = JSON.parse(text); } catch { return toast('Not a valid JSON file'); }
      handleBankSyncData(data);
    });
  }

  async function handleBankSyncData(data) {
    if (!data || data.kind !== 'bank-sync' || !Array.isArray(data.transactions)) {
      return toast('Not a bank sync file — create one with sync/bank_sync.py');
    }
    // Remember consent expiry so the app can warn before the 90 days run out.
    if (data.agreement && data.agreement.expiresAt) {
      await DB.setMeta('bankConsent', {
        institutionId: data.institutionId || '',
        createdAt: data.agreement.createdAt || Date.now(),
        expiresAt: data.agreement.expiresAt
      });
    }
    const uuids = [...new Set(data.transactions.map((t) => t.accountUuid).filter(Boolean))];
    const map = Object.assign({}, DB.state.meta.bankAccountMap || {});
    const unmapped = uuids.filter((u) => !map[u] || !DB.account(map[u]));
    if (unmapped.length) return openBankMapSheet(unmapped, data, map);
    await applyBankSync(data, map);
  }

  /** First import from a new bank account: ask which app account it belongs to. */
  function openBankMapSheet(unmapped, data, map) {
    openSheet('Match bank accounts', (body, api) => {
      body.append(el('p', { class: 'muted', style: 'margin-bottom:12px;line-height:1.5', text:
        'Pick which account in this app each bank account belongs to. Saved once, reused on every sync.' }));
      const selects = unmapped.map((uuid) => {
        const info = (data.accounts || []).find((a) => a.uuid === uuid) || {};
        const label = info.iban ? '…' + info.iban.slice(-6) : uuid.slice(0, 8) + '…';
        const sel = el('select', {},
          DB.state.accounts.map((a) => el('option', { value: a.id, text: acctIcon(a.type) + ' ' + a.name }))
            .concat([el('option', { value: '__new', text: '➕ Create a new account' })]));
        body.append(el('div', { class: 'field' }, [
          el('label', { text: 'Bank account ' + label }), sel
        ]));
        return { uuid, sel, info };
      });
      body.append(el('button', {
        class: 'btn block primary', text: 'Continue',
        onclick: async () => {
          for (const { uuid, sel, info } of selects) {
            if (sel.value === '__new') {
              const acct = await DB.put('accounts', {
                id: null,
                name: 'buddybank' + (info.iban ? ' …' + info.iban.slice(-4) : ''),
                type: 'checking', startingBalance: 0
              });
              map[uuid] = acct.id;
            } else {
              map[uuid] = sel.value;
            }
          }
          await DB.setMeta('bankAccountMap', map);
          api.close();
          await applyBankSync(data, map);
        }
      }));
    });
  }

  /** Upsert by externalId (the app-side "unique index"): re-imports are idempotent.
      Rows with no externalId match are also reconciled against existing manual/CSV
      transactions (same date + amount) so a bank sync merges with — instead of
      duplicating — a purchase you already logged by hand. */
  async function applyBankSync(data, map) {
    const byExternal = new Map();
    // Manual/CSV transactions (no externalId) indexed by date+signed-amount for adoption.
    const adoptable = new Map();
    DB.state.transactions.forEach((t) => {
      if (t.externalId) { byExternal.set(t.externalId, t); return; }
      const signed = t.type === 'income' ? t.amount : -t.amount;
      const k = t.date + '|' + signed.toFixed(2);
      if (!adoptable.has(k)) adoptable.set(k, []);
      adoptable.get(k).push(t);
    });
    const uncat = await ensureCategory('Uncategorized', '❓');

    let added = 0, updated = 0, unchanged = 0, skipped = 0, review = 0, merged = 0;
    const toPut = [];
    for (const r of data.transactions) {
      const amount = Math.round(Math.abs(Number(r.amount)) * 100) / 100;
      if (!r.externalId || !r.date || !isFinite(Number(r.amount)) || amount === 0 ||
          !map[r.accountUuid]) { skipped++; continue; }
      const type = Number(r.amount) < 0 ? 'expense' : 'income';
      const existing = byExternal.get(r.externalId);
      if (existing) {
        // Bank data wins for date/amount/type; the user's category/note edits survive.
        if (existing.date !== r.date || existing.amount !== amount || existing.type !== type) {
          toPut.push({ ...existing, date: r.date, amount, type });
          updated++;
        } else unchanged++;
        continue;
      }
      // No externalId match — adopt a matching hand-entered transaction if there is one.
      const signedR = type === 'expense' ? -amount : amount;
      const bucket = adoptable.get(r.date + '|' + signedR.toFixed(2));
      if (bucket && bucket.length) {
        const adopt = bucket.shift();
        // Keep the user's category/note/account; attach the bank id so future syncs update it.
        toPut.push({ ...adopt, externalId: r.externalId });
        byExternal.set(r.externalId, adopt);
        merged++;
        continue;
      }
      const cat = DB.suggestCategory(r.note || '');
      if (!cat) review++;
      const tx = {
        id: null, externalId: r.externalId, date: r.date, amount, type,
        categoryId: (cat || uncat).id, accountId: map[r.accountUuid], note: r.note || ''
      };
      if (!cat) tx.needsReview = true;
      toPut.push(tx);
      byExternal.set(r.externalId, tx);
      added++;
    }
    if (toPut.length) await DB.bulkPut('transactions', toPut);
    await bumpChanges(added + updated + merged);

    // Focus the views on the imported data — otherwise Home/Stats sit on the
    // current month and look empty when the history is in other months.
    const dates = data.transactions.map((t) => t.date).filter(Boolean).sort();
    if (dates.length) {
      const [ly, lm] = dates[dates.length - 1].split('-').map(Number);
      ui.period = { type: 'month', y: ly, m0: lm - 1 };
      ui.donutSel = null;
      ui.stats.range = 'all';
      ui.stats.donutSel = null;
    }

    openSheet('Bank sync imported', (body, api) => {
      body.append(el('div', { class: 'import-summary card', html:
        `<span class="ok">${added} new transactions</span><br>` +
        (merged ? `<span class="ok">${merged} merged with entries you already had</span><br>` : '') +
        (updated ? `${updated} updated from the bank<br>` : '') +
        `<span class="dup">${unchanged} already up to date</span><br>` +
        (skipped ? `<span class="dup">${skipped} rows skipped (invalid)</span><br>` : '') +
        (review ? `<strong>${review} need a category</strong> — they’re in the review queue` : 'All categorized by your rules ✓')
      }));
      if (review) {
        body.append(el('button', {
          class: 'btn block primary', text: '🏷 Review them now',
          onclick: () => { api.close(); openReviewSheet(); }
        }), el('div', { class: 'spacer' }));
      }
      body.append(el('button', { class: 'btn block', text: 'Done', onclick: () => { api.close(); render(); } }));
    });
    render();
  }

  const reviewQueue = () => DB.state.transactions.filter((t) => t.needsReview);

  function ruleMatches(text, rule) {
    if (!text || !rule.keyword) return false;
    if (rule.regex) {
      try { return new RegExp(rule.keyword, 'i').test(text); } catch { return false; }
    }
    return text.toUpperCase().includes(rule.keyword.toUpperCase());
  }

  /** After saving a rule, offer to retroactively apply it to matching past transactions. */
  async function offerApplyRuleToPast(rule) {
    const matches = DB.state.transactions.filter(
      (t) => t.categoryId !== rule.categoryId && ruleMatches(t.note || '', rule));
    if (!matches.length) return;
    const cat = DB.category(rule.categoryId);
    const ok = await confirmSheet(
      `Apply this rule to ${matches.length} past transaction${matches.length === 1 ? '' : 's'}? ` +
      `They’ll be set to ${cat ? cat.icon + ' ' + cat.name : 'this category'}.`,
      'Apply to past', false);
    if (!ok) return;
    const upd = matches.map((t) => { const o = { ...t, categoryId: rule.categoryId }; delete o.needsReview; return o; });
    await DB.bulkPut('transactions', upd);
    await bumpChanges(upd.length);
    toast(upd.length + ' transaction' + (upd.length === 1 ? '' : 's') + ' updated');
  }

  /** Re-run the rules over everything still in the review queue. Returns count matched. */
  async function applyRulesToUncategorized() {
    const upd = [];
    for (const t of reviewQueue()) {
      const cat = DB.suggestCategory(t.note || '');
      if (cat) { const o = { ...t, categoryId: cat.id }; delete o.needsReview; upd.push(o); }
    }
    if (upd.length) { await DB.bulkPut('transactions', upd); await bumpChanges(upd.length); }
    return upd.length;
  }

  function openReviewSheet() {
    openSheet('Review imported', (body, api) => {
      const draw = () => {
        body.innerHTML = '';
        const q = reviewQueue().sort((a, b) => b.date.localeCompare(a.date));
        if (!q.length) {
          body.append(el('div', { class: 'empty', html: '<span class="big">✅</span>All caught up' }));
          return;
        }
        body.append(el('p', { class: 'muted', style: 'margin-bottom:10px;line-height:1.5', text:
          q.length + ' imported transaction' + (q.length === 1 ? '' : 's') +
          ' didn’t match any rule. Tap one to give it a category — and optionally teach a rule for next time.' }));
        body.append(el('button', {
          class: 'btn block small', style: 'margin-bottom:12px',
          text: '⚡ Apply existing rules to all',
          onclick: async () => {
            const n = await applyRulesToUncategorized();
            toast(n ? n + ' categorized by rules' : 'No rules matched these yet');
            draw(); render();
          }
        }));
        q.forEach((t) => {
          body.append(el('button', { class: 'tx-row', onclick: () => openAssignSheet(t, draw) }, [
            el('span', { class: 'tx-icon', text: '❓', style: 'background:' + U.tintOf('blue') }),
            el('span', { class: 'tx-main' }, [
              el('span', { class: 'tx-title', text: t.note || 'Transaction' }),
              el('span', { class: 'tx-sub', text: U.fmtDate(t.date) })
            ]),
            el('span', { class: 'tx-amt' + (t.type === 'income' ? ' pos' : ''),
              text: (t.type === 'income' ? '+ ' : '− ') + fmtEUR(t.amount) })
          ]));
        });
      };
      draw();
    });
  }

  function openAssignSheet(t, onDone) {
    openSheet('Pick a category', (body, api) => {
      let chosen = null;
      const chips = el('div', { class: 'chips' });
      const drawChips = () => {
        chips.innerHTML = '';
        DB.state.categories.forEach((c) => {
          chips.append(el('button', {
            class: 'chip' + (chosen === c.id ? ' active' : ''),
            onclick: () => { chosen = c.id; drawChips(); }
          }, [
            el('span', { class: 'dot', style: 'background:' + U.colorOf(c.color) }),
            el('span', { text: c.icon + ' ' + c.name })
          ]));
        });
      };
      drawChips();

      // Suggest a rule pattern from the description's most distinctive word.
      const guess = (t.note || '').split(/\s+/)
        .filter((w) => w.length >= 4 && !/^\d+$/.test(w))[0] || (t.note || '').slice(0, 12);
      const ruleToggle = el('input', { type: 'checkbox' });
      ruleToggle.checked = !!guess;
      const pattern = el('input', { type: 'text', value: guess.toUpperCase(), autocapitalize: 'characters' });
      const regexToggle = el('input', { type: 'checkbox' });

      body.append(
        el('p', { style: 'font-weight:600;margin-bottom:2px', text: t.note || 'Transaction' }),
        el('p', { class: 'muted', style: 'margin-bottom:12px', text:
          U.fmtDate(t.date) + ' · ' + (t.type === 'income' ? '+' : '−') + fmtEUR(t.amount) }),
        el('div', { class: 'field' }, [el('label', { text: 'Category' }), chips]),
        el('hr', { class: 'sep' }),
        el('label', { style: 'display:flex;gap:8px;align-items:center;font-size:0.85rem;margin-bottom:10px' },
          [ruleToggle, el('span', { text: 'Also create a rule so this is automatic next time' })]),
        el('div', { class: 'field' }, [el('label', { text: 'When the description contains…' }), pattern]),
        el('label', { style: 'display:flex;gap:8px;align-items:center;font-size:0.85rem;margin-bottom:14px' },
          [regexToggle, el('span', { text: 'Treat as regular expression' })]),
        el('button', {
          class: 'btn block primary', text: 'Assign',
          onclick: async () => {
            if (!chosen) return toast('Pick a category');
            const upd = { ...t, categoryId: chosen };
            delete upd.needsReview;
            await DB.put('transactions', upd);
            if (ruleToggle.checked && pattern.value.trim()) {
              await DB.put('rules', {
                id: null, keyword: pattern.value.trim(),
                regex: regexToggle.checked || undefined, categoryId: chosen
              });
              // Let the new rule sweep the rest of the queue too.
              let swept = 0;
              for (const other of reviewQueue()) {
                const cat = DB.suggestCategory(other.note || '');
                if (cat) {
                  const o = { ...other, categoryId: cat.id };
                  delete o.needsReview;
                  await DB.put('transactions', o);
                  swept++;
                }
              }
              if (swept) toast('Rule applied to ' + (swept + 1) + ' transactions');
            }
            await bumpChanges(1);
            api.close();
            onDone();
          }
        })
      );
    });
  }

  /* ======================= Export / import ======================= */

  async function exportJSON() {
    const m = DB.state.meta;
    const data = {
      app: 'expense-tracker', version: 1, exportedAt: new Date().toISOString(),
      accounts: DB.state.accounts,
      categories: DB.state.categories,
      transactions: DB.state.transactions,
      rules: DB.state.rules,
      presets: DB.state.presets,
      meta: {
        budget: m.budget || null,
        backupReminder: m.backupReminder || null,
        bankAccountMap: m.bankAccountMap || null,
        bankConsent: m.bankConsent || null
      }
    };
    U.download('expense-tracker-backup-' + U.todayISO() + '.json',
      JSON.stringify(data, null, 2), 'application/json');
    await DB.setMeta('lastBackup', Date.now());
    await DB.setMeta('changesSinceBackup', 0);
    await DB.setMeta('backupSnoozeUntil', 0);
    toast('Backup exported ✓');
    render();
  }

  function importJSON() {
    pickFile('.json,application/json', async (text) => {
      let data;
      try { data = JSON.parse(text); } catch { return toast('Not a valid JSON file'); }
      // A bank-sync file also has transactions[]+accounts[] but a different shape —
      // route it to the bank importer instead of storing its raw rows as a backup.
      if (data && data.kind === 'bank-sync') {
        toast('That’s a bank sync file — importing it the right way');
        return handleBankSyncData(data);
      }
      if (!data || !Array.isArray(data.transactions) || !Array.isArray(data.accounts)) {
        return toast('Not an Expense Tracker backup');
      }
      openSheet('Import backup', (body, api) => {
        body.append(
          el('p', { class: 'muted', style: 'line-height:1.5;margin-bottom:14px', text:
            `This file has ${data.transactions.length} transactions and ${data.accounts.length} accounts. ` +
            'Combine it with what’s already on this device, or replace everything?' }),
          el('button', {
            class: 'btn block primary', text: '➕ Merge with current data',
            onclick: async () => {
              api.close();
              const res = await mergeBackup(data);
              await repairData();
              focusLatestData();
              openSheet('Backup merged', (b2, a2) => {
                b2.append(el('div', { class: 'import-summary card', html:
                  `<span class="ok">${res.added} new transactions added</span><br>` +
                  `<span class="dup">${res.skipped} already present (skipped)</span><br>` +
                  (res.newCats ? `${res.newCats} new categories<br>` : '') +
                  (res.newAccts ? `${res.newAccts} new accounts<br>` : '') +
                  (res.newRules ? `${res.newRules} new rules` : 'No new rules')
                }),
                el('button', { class: 'btn block', text: 'Done', onclick: () => { a2.close(); render(); } }));
              });
              render();
            }
          }),
          el('p', { class: 'muted', style: 'text-align:center;margin:10px 0;font-size:0.8rem', text:
            'Merge keeps both sets, matches categories & accounts by name, and skips duplicate transactions.' }),
          el('hr', { class: 'sep' }),
          el('button', {
            class: 'btn block danger', text: '♻︎ Replace everything',
            onclick: async () => {
              api.close();
              if (!(await confirmSheet(
                'Replace ALL data on this device with the backup? Your current data here is lost.',
                'Replace all data', true))) return;
              await DB.replaceAll(data);
              await DB.setMeta('changesSinceBackup', 0);
              await DB.setMeta('installedAt', Date.now());
              await repairData();
              focusLatestData();
              toast('Backup restored'); render();
            }
          })
        );
      });
    });
  }

  /** Combine a backup into the current data: categories/accounts matched by name,
      rules deduped, transactions deduped by externalId then date+amount+description. */
  async function mergeBackup(data) {
    const catRemap = new Map();
    const acctRemap = new Map();
    let newCats = 0, newAccts = 0, newRules = 0;

    for (const c of (data.categories || [])) {
      const hit = DB.state.categories.find((x) => x.name.toLowerCase() === (c.name || '').toLowerCase());
      if (hit) { catRemap.set(c.id, hit.id); continue; }
      const added = await DB.put('categories', { name: c.name, icon: c.icon, color: c.color });
      catRemap.set(c.id, added.id); newCats++;
    }
    for (const a of (data.accounts || [])) {
      const hit = DB.state.accounts.find((x) => x.name.toLowerCase() === (a.name || '').toLowerCase());
      if (hit) { acctRemap.set(a.id, hit.id); continue; }
      const added = await DB.put('accounts',
        { name: a.name, type: a.type, startingBalance: a.startingBalance || 0 });
      acctRemap.set(a.id, added.id); newAccts++;
    }
    for (const r of (data.rules || [])) {
      const dup = DB.state.rules.some((x) =>
        (x.keyword || '').toUpperCase() === (r.keyword || '').toUpperCase() && !!x.regex === !!r.regex);
      if (dup) continue;
      await DB.put('rules', { keyword: r.keyword, regex: r.regex, categoryId: catRemap.get(r.categoryId) || r.categoryId });
      newRules++;
    }
    for (const p of (data.presets || [])) {
      if (DB.state.presets.some((x) => x.name === p.name)) continue;
      await DB.put('presets', { name: p.name, mapping: p.mapping });
    }

    const byExt = new Set(DB.state.transactions.filter((t) => t.externalId).map((t) => t.externalId));
    const dupKeys = DB.existingDupKeys();
    const toAdd = [];
    let added = 0, skipped = 0;
    for (const t of (data.transactions || [])) {
      if (t.externalId && byExt.has(t.externalId)) { skipped++; continue; }
      const signed = t.type === 'income' ? t.amount : -t.amount;
      const key = DB.dupKey(t.date, signed, t.note);
      if (dupKeys.has(key)) { skipped++; continue; }
      toAdd.push({
        externalId: t.externalId, date: t.date, amount: t.amount, type: t.type,
        categoryId: catRemap.get(t.categoryId) || t.categoryId,
        accountId: acctRemap.get(t.accountId) || t.accountId,
        note: t.note || '', needsReview: t.needsReview
      });
      if (t.externalId) byExt.add(t.externalId);
      dupKeys.add(key); added++;
    }
    if (toAdd.length) await DB.bulkPut('transactions', toAdd);

    // Bring settings only where this device has none, remapping account references.
    const m = data.meta || {};
    if (m.budget && !DB.state.meta.budget) await DB.setMeta('budget', m.budget);
    if (m.bankConsent && !DB.state.meta.bankConsent) await DB.setMeta('bankConsent', m.bankConsent);
    if (m.bankAccountMap) {
      const map = Object.assign({}, DB.state.meta.bankAccountMap || {});
      for (const [uuid, acctId] of Object.entries(m.bankAccountMap)) {
        if (!map[uuid]) map[uuid] = acctRemap.get(acctId) || acctId;
      }
      await DB.setMeta('bankAccountMap', map);
    }
    await bumpChanges(added);
    return { added, skipped, newCats, newAccts, newRules };
  }

  function exportCSV(list) {
    if (!list.length) return toast('Nothing to export');
    const rows = [['Date', 'Type', 'Amount', 'Category', 'Account', 'Note']];
    for (const t of list) {
      const [y, m, d] = t.date.split('-');
      const signed = (t.type === 'income' ? t.amount : -t.amount);
      rows.push([
        `${d}/${m}/${y}`, t.type, signed.toFixed(2).replace('.', ','),
        (DB.category(t.categoryId) || {}).name || '',
        (DB.account(t.accountId) || {}).name || '',
        t.note || ''
      ]);
    }
    U.download('transactions-' + U.todayISO() + '.csv',
      CSV.serialize(rows, ';'), 'text/csv');
    toast(list.length + ' transactions exported');
  }

  function copyAddLink() {
    const link = location.origin + location.pathname + '?action=add';
    const done = () => toast('Quick-add link copied');
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(link).then(done, () => prompt('Copy this link:', link));
    } else {
      prompt('Copy this link:', link);
    }
  }

  function pickFile(accept, onText) {
    const input = el('input', { type: 'file', accept, style: 'display:none' });
    document.body.appendChild(input);
    input.addEventListener('change', () => {
      const f = input.files && input.files[0];
      input.remove();
      if (!f) return;
      const reader = new FileReader();
      reader.onload = () => onText(String(reader.result), f.name);
      reader.readAsText(f);
    });
    input.click();
  }

  /* ======================= CSV import wizard ======================= */

  function openCsvWizard() {
    if (DB.state.accounts.length === 0) return toast('Create an account first');
    pickFile('.csv,text/csv,text/plain', (text, filename) => {
      const { rows } = CSV.parse(text);
      if (!rows.length || rows[0].length < 2) return toast('Could not read that CSV');
      openMappingSheet(rows, filename);
    });
  }

  function openMappingSheet(rows, filename) {
    const st = {
      hasHeader: true,
      dateCol: 0, descCol: 1, mode: 'single',
      amountCol: Math.max(rows[0].length - 1, 2), debitCol: 2, creditCol: 3,
      invert: false,
      accountId: DB.state.accounts[0].id
    };
    // Best-effort auto-detection from header names
    const header = rows[0].map((h) => h.toLowerCase());
    header.forEach((h, i) => {
      if (/data|date/.test(h) && st.dateCol === 0) st.dateCol = i;
      if (/descr|causale|beneficiar|dettagli|operazione/.test(h)) st.descCol = i;
      if (/importo|amount|valore/.test(h)) st.amountCol = i;
      if (/addebit|dare|debit|uscite/.test(h)) { st.debitCol = i; st.mode = st.mode; }
      if (/accredit|avere|credit|entrate/.test(h)) st.creditCol = i;
    });
    if (header.some((h) => /addebit|dare|uscite/.test(h)) &&
        header.some((h) => /accredit|avere|entrate/.test(h))) {
      st.mode = 'double';
    }

    openSheet('Map CSV columns', (body, api) => {
      const colOptions = (selected) => {
        const sel = el('select');
        rows[0].forEach((h, i) => sel.append(el('option', {
          value: String(i),
          text: (st.hasHeader ? h || '(column ' + (i + 1) + ')' : 'Column ' + (i + 1))
        })));
        sel.value = String(selected);
        return sel;
      };

      function draw() {
        body.innerHTML = '';

        // Preset picker
        if (DB.state.presets.length) {
          const pre = el('select', {}, [el('option', { value: '', text: 'Bank preset…' })]);
          DB.state.presets.forEach((p) => pre.append(el('option', { value: p.id, text: p.name })));
          pre.addEventListener('change', () => {
            const p = DB.state.presets.find((x) => x.id === pre.value);
            if (!p) return;
            const m = p.mapping;
            // Prefer header-name matching; fall back to stored indices
            const byName = (nm, idx) => {
              if (nm != null) {
                const i = rows[0].findIndex((h) => h.trim().toLowerCase() === String(nm).trim().toLowerCase());
                if (i >= 0) return i;
              }
              return Math.min(idx || 0, rows[0].length - 1);
            };
            st.hasHeader = m.hasHeader !== false;
            st.mode = m.mode || 'single';
            st.invert = !!m.invert;
            st.dateCol = byName(m.dateName, m.dateCol);
            st.descCol = byName(m.descName, m.descCol);
            st.amountCol = byName(m.amountName, m.amountCol);
            st.debitCol = byName(m.debitName, m.debitCol);
            st.creditCol = byName(m.creditName, m.creditCol);
            draw();
          });
          body.append(el('div', { class: 'field' }, [pre]));
        }

        const headerToggle = el('input', { type: 'checkbox' });
        headerToggle.checked = st.hasHeader;
        headerToggle.addEventListener('change', () => { st.hasHeader = headerToggle.checked; draw(); });

        const dateSel = colOptions(st.dateCol);
        const descSel = colOptions(st.descCol);
        dateSel.addEventListener('change', () => { st.dateCol = +dateSel.value; });
        descSel.addEventListener('change', () => { st.descCol = +descSel.value; });

        const modeSeg = el('div', { class: 'seg' });
        const bSingle = el('button', { text: 'One amount column', class: st.mode === 'single' ? 'active' : '' });
        const bDouble = el('button', { text: 'Debit + credit', class: st.mode === 'double' ? 'active' : '' });
        bSingle.addEventListener('click', () => { st.mode = 'single'; draw(); });
        bDouble.addEventListener('click', () => { st.mode = 'double'; draw(); });
        modeSeg.append(bSingle, bDouble);

        const acctSel = el('select', {}, DB.state.accounts.map((a) =>
          el('option', { value: a.id, text: acctIcon(a.type) + ' ' + a.name })));
        acctSel.value = st.accountId;
        acctSel.addEventListener('change', () => { st.accountId = acctSel.value; });

        const amountFields = el('div');
        if (st.mode === 'single') {
          const amtSel = colOptions(st.amountCol);
          amtSel.addEventListener('change', () => { st.amountCol = +amtSel.value; });
          const inv = el('input', { type: 'checkbox' });
          inv.checked = st.invert;
          inv.addEventListener('change', () => { st.invert = inv.checked; });
          amountFields.append(
            el('div', { class: 'field' }, [el('label', { text: 'Amount column (negative = expense)' }), amtSel]),
            el('label', { style: 'display:flex;gap:8px;align-items:center;font-size:0.85rem;margin-bottom:14px' },
              [inv, el('span', { text: 'Invert sign (positive numbers are expenses)' })])
          );
        } else {
          const debSel = colOptions(st.debitCol);
          const creSel = colOptions(st.creditCol);
          debSel.addEventListener('change', () => { st.debitCol = +debSel.value; });
          creSel.addEventListener('change', () => { st.creditCol = +creSel.value; });
          amountFields.append(
            el('div', { class: 'field-row' }, [
              el('div', { class: 'field' }, [el('label', { text: 'Debit (expenses)' }), debSel]),
              el('div', { class: 'field' }, [el('label', { text: 'Credit (income)' }), creSel])
            ])
          );
        }

        // First-rows preview
        const prev = el('div', { class: 'csv-preview' });
        const table = el('table');
        const preview = rows.slice(0, 4);
        preview.forEach((r0, ri) => {
          const tr = el('tr');
          r0.forEach((cell) => tr.append(el(ri === 0 && st.hasHeader ? 'th' : 'td',
            { text: String(cell).slice(0, 26) })));
          table.append(tr);
        });
        prev.append(table);

        const presetName = el('input', { type: 'text', placeholder: 'e.g. Intesa, Fineco (optional)' });

        body.append(
          el('p', { class: 'muted', style: 'margin-bottom:10px', text: filename + ' · ' + rows.length + ' rows' }),
          prev,
          el('label', { style: 'display:flex;gap:8px;align-items:center;font-size:0.85rem;margin-bottom:14px' },
            [headerToggle, el('span', { text: 'First row is a header' })]),
          el('div', { class: 'field' }, [el('label', { text: 'Date column (DD/MM/YYYY)' }), dateSel]),
          el('div', { class: 'field' }, [el('label', { text: 'Description column' }), descSel]),
          el('div', { class: 'field' }, [el('label', { text: 'Amount layout' }), modeSeg]),
          amountFields,
          el('div', { class: 'field' }, [el('label', { text: 'Import into account' }), acctSel]),
          el('div', { class: 'field' }, [el('label', { text: 'Save mapping as preset' }), presetName]),
          el('button', {
            class: 'btn block primary', text: 'Preview import',
            onclick: async () => {
              if (presetName.value.trim()) {
                await DB.put('presets', {
                  id: null, name: presetName.value.trim(),
                  mapping: {
                    hasHeader: st.hasHeader, mode: st.mode, invert: st.invert,
                    dateCol: st.dateCol, descCol: st.descCol, amountCol: st.amountCol,
                    debitCol: st.debitCol, creditCol: st.creditCol,
                    dateName: st.hasHeader ? rows[0][st.dateCol] : null,
                    descName: st.hasHeader ? rows[0][st.descCol] : null,
                    amountName: st.hasHeader ? rows[0][st.amountCol] : null,
                    debitName: st.hasHeader ? rows[0][st.debitCol] : null,
                    creditName: st.hasHeader ? rows[0][st.creditCol] : null
                  }
                });
              }
              api.close();
              openImportPreview(rows, st);
            }
          })
        );
      }
      draw();
    });
  }

  function openImportPreview(rows, st) {
    const dataRows = st.hasHeader ? rows.slice(1) : rows;
    const existing = DB.existingDupKeys();
    const seen = new Set();
    const good = [], dups = [];
    let invalid = 0;

    for (const r of dataRows) {
      const dateISO = CSV.parseDate(r[st.dateCol]);
      const desc = String(r[st.descCol] || '').trim();
      let signed = null;
      if (st.mode === 'single') {
        signed = CSV.parseAmount(r[st.amountCol]);
        if (signed != null && st.invert) signed = -signed;
      } else {
        const deb = CSV.parseAmount(r[st.debitCol]);
        const cre = CSV.parseAmount(r[st.creditCol]);
        if (deb != null && deb !== 0) signed = -Math.abs(deb);
        else if (cre != null && cre !== 0) signed = Math.abs(cre);
      }
      if (!dateISO || signed == null || signed === 0) { invalid++; continue; }
      signed = Math.round(signed * 100) / 100;

      const key = DB.dupKey(dateISO, signed, desc);
      if (existing.has(key) || seen.has(key)) { dups.push(r); continue; }
      seen.add(key);

      const cat = DB.suggestCategory(desc);
      const fallback = DB.state.categories.find((c) => c.name === 'Other') || DB.state.categories[0];
      good.push({
        id: null,
        date: dateISO,
        amount: Math.abs(signed),
        type: signed >= 0 ? 'income' : 'expense',
        categoryId: (cat || fallback).id,
        accountId: st.accountId,
        note: desc,
        _suggested: !!cat
      });
    }

    openSheet('Confirm import', (body, api) => {
      const summary = el('div', { class: 'import-summary card' });
      summary.innerHTML =
        `<span class="ok">${good.length} new transactions</span> ready to import<br>` +
        `<span class="dup">${dups.length} duplicates skipped (same date + amount + description)</span><br>` +
        (invalid ? `<span class="dup">${invalid} rows skipped (no valid date/amount)</span><br>` : '') +
        `<span class="dup">${good.filter((g) => g._suggested).length} auto-categorized by your rules</span>`;
      body.append(summary);

      if (good.length) {
        const prev = el('div', { class: 'csv-preview' });
        const table = el('table');
        const tr = el('tr');
        ['Date', 'Description', 'Amount', 'Category'].forEach((h) => tr.append(el('th', { text: h })));
        table.append(tr);
        good.slice(0, 8).forEach((g) => {
          const cat = DB.category(g.categoryId);
          const row = el('tr');
          row.append(
            el('td', { text: U.fmtDate(g.date, { day: '2-digit', month: '2-digit', year: 'numeric' }) }),
            el('td', { text: g.note.slice(0, 30) }),
            el('td', { text: (g.type === 'income' ? '+' : '−') + fmtEUR(g.amount) }),
            el('td', { text: cat ? cat.icon + ' ' + cat.name : '' })
          );
          table.append(row);
        });
        prev.append(table);
        body.append(prev);
        if (good.length > 8) body.append(el('p', { class: 'muted', text: '…and ' + (good.length - 8) + ' more' }));
      }

      body.append(
        el('div', { class: 'spacer' }),
        el('button', {
          class: 'btn block primary',
          text: good.length ? 'Import ' + good.length + ' transactions' : 'Nothing to import',
          onclick: async () => {
            if (!good.length) return;
            good.forEach((g) => delete g._suggested);
            await DB.bulkPut('transactions', good);
            await bumpChanges(good.length);
            api.close();
            toast(good.length + ' transactions imported');
            show('transactions');
          }
        })
      );
    });
  }

  /* ======================= Boot ======================= */

  async function boot() {
    await DB.init();
    await repairData();  // heal any raw/mis-imported records before first render
    focusLatestData();   // don't open onto an empty current month when data is elsewhere
    $$('.tabbar [data-tab]').forEach((b) =>
      b.addEventListener('click', () => show(b.dataset.tab)));
    $('#fab').addEventListener('click', () => openTxSheet(null));
    // Re-render charts when the system theme flips
    if (window.matchMedia) {
      window.matchMedia('(prefers-color-scheme: dark)')
        .addEventListener('change', () => render());
    }
    show('dashboard');

    // Deep link: ?action=add opens straight into a new transaction (used by the
    // Home/Lock Screen Shortcut). Clear the param so a refresh doesn't re-open it.
    const launched = handleLaunchAction();
    if (!launched) maybeRemindBackup();
    window.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        if (!handleLaunchAction()) maybeRemindBackup();
      }
    });

    if ('serviceWorker' in navigator &&
        (location.protocol === 'https:' || location.hostname === 'localhost' ||
         location.hostname === '127.0.0.1')) {
      navigator.serviceWorker.register('./sw.js').catch((e) =>
        console.warn('SW registration failed:', e));
    }
  }

  function handleLaunchAction() {
    const params = new URLSearchParams(location.search);
    if (params.get('action') === 'add') {
      history.replaceState(null, '', location.pathname);
      if (!document.querySelector('.sheet')) setTimeout(() => openTxSheet(null), 250);
      return true;
    }
    return false;
  }

  document.addEventListener('DOMContentLoaded', boot);
})();
