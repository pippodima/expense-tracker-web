/* App: views, navigation, forms, CSV import wizard, backup. */
'use strict';

(() => {
  const { $, $$, el, esc, fmtEUR, toast } = U;

  /* ================= App state (UI only — data lives in DB.state) ========= */
  let now = new Date();
  const ui = {
    view: 'dashboard',
    period: { type: 'month', y: now.getFullYear(), m0: now.getMonth() }, // or {type:'range', from, to}
    donutSel: null,
    stats: {
      view: 'overview',          // overview | trends | calendar | merchants | trips
      range: 'month',            // month | year | all | custom
      y: now.getFullYear(), m0: now.getMonth(),
      from: '', to: '', donutSel: null, merchantQuery: '',
      trendCat: null, trendWindow: 12
    },
    tx: { q: '', accountId: '', categoryId: '', from: '', to: '', sort: 'date-desc', limit: 100 },
    settings: { open: {}, ruleQuery: '', ruleGroups: {} },
    sheetZ: 50
  };

  /** Destructive actions are immediate + undoable instead of confirm-gated. */
  const toastUndo = (msg, undo) => U.toastAction(msg, 'Undo', undo);

  /* ======================= Private mode =======================
     Threat model: someone glancing at your screen. What actually exposes you is
     *wealth* — account balances, the combined total, income and net — not what
     you may spend today. So "Balances" masks those; "All amounts" additionally
     masks every individual figure. Masked values un-blur on tap for a few
     seconds, and can re-hide automatically whenever the app is backgrounded. */

  const privacyCfg = () =>
    Object.assign({ on: false, level: 'balances', auto: false }, DB.state.meta.privacy || {});

  function applyPrivacy() {
    const p = privacyCfg();
    document.body.classList.toggle('privacy', !!p.on);
    document.body.classList.toggle('privacy-all', !!p.on && p.level === 'all');
  }

  async function setPrivacy(patch) {
    await DB.setMeta('privacy', Object.assign({}, privacyCfg(), patch));
    applyPrivacy();
  }

  async function togglePrivacy() {
    const p = privacyCfg();
    await setPrivacy({ on: !p.on });
    toast(privacyCfg().on ? 'Amounts hidden' : 'Amounts visible');
    render();
  }

  /** Tap a masked figure to peek at it briefly. */
  function initPrivacyPeek() {
    document.addEventListener('click', (e) => {
      if (!document.body.classList.contains('privacy')) return;
      // Only figures that aren't inside a button — otherwise the tap would also
      // trigger that row's action.
      const hit = e.target.closest('.hero-value.sens, .hero-sub, .total-chip, ' +
        '.t-value, .cmp-delta, .cmp-vals, .cmp-diff, .cat-detail-total');
      if (!hit || hit.closest('button')) return;
      hit.classList.add('peek');
      clearTimeout(hit._peek);
      hit._peek = setTimeout(() => hit.classList.remove('peek'), 4000);
    });
  }

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

  function openSheet(title, build, opts) {
    const z = ++ui.sheetZ;
    const backdrop = el('div', { class: 'sheet-backdrop', style: `z-index:${z}` });
    const head = el('div', { class: 'sheet-head' }, [
      el('h2', { text: title }),
      el('button', { class: 'btn small ghost', text: 'Close' })
    ]);
    const body = el('div', { class: 'sheet-body' });
    const grip = el('div', { class: 'sheet-grip' });
    const sheet = el('div', { class: 'sheet' + (opts && opts.tall ? ' tall' : ''), style: `z-index:${z + 1}` },
      [grip, head, body]);
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
      (t) => t.type === 'expense' && t.date >= r.from && t.date <= r.to &&
        countsInBudget(t));
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
      // Anything dated after today is already spoken for — it used to count in the
      // month total but not in any daily figure, so a rent booked ahead silently
      // inflated every remaining day's allowance.
      const committedAhead = exp.filter((t) => t.date > today).reduce((s, t) => s + t.amount, 0);
      // Today's allowance = budget still unspent and uncommitted, spread over the
      // days left (incl. today).
      const daysLeftIncl = D - d + 1;
      const todayBudget = (b.amount - spentBefore - committedAhead) / daysLeftIncl;
      // Tomorrow's preview: leftover after today, spread over the days after today.
      const daysLeftAfter = D - d;
      const tomorrowBudget = daysLeftAfter > 0
        ? (b.amount - spentBefore - spentToday - committedAhead) / daysLeftAfter
        : null;                                             // today is the last day
      Object.assign(out, {
        dailyBase, d, spentBefore, spentToday, committedAhead, todayBudget,
        todayRemaining: todayBudget - spentToday, tomorrowBudget, daysLeftAfter
      });
    }
    return out;
  }

  /* ======================= Trip accounting =======================
     A trip is a date range. Two independent behaviours:
     · Stats: trip spending can be kept out of monthly charts/averages, so a
       holiday doesn't distort your normal baseline (setting, on by default).
     · Budget: only when a trip has its own budget does its spending leave the
       monthly budget — the trip is then tracked against that separate pot.
     In both cases confirmed subscriptions charged during the trip still count
     as normal spending: they would have happened whether you travelled or not.
     Income and transfers are never reclassified. */

  const tripSettings = () =>
    Object.assign({ excludeFromStats: true }, DB.state.meta.tripSettings || {});

  /** The saved trip covering a date, if any. */
  function tripForDate(date) {
    for (const t of (DB.state.meta.trips || [])) {
      if (date >= t.from && date <= t.to) return t;
    }
    return null;
  }

  /** Confirmed subscriptions keep counting as normal spending during a trip. */
  function isProtectedRecurring(t) {
    if (!t.note) return false;
    const confirmed = (DB.state.meta.subscriptions || {}).confirmed || {};
    return !!confirmed[merchantKey(t.note)];
  }

  /** Expense that belongs to a trip and isn't a protected recurring charge. */
  function tripExpenseOf(t) {
    if (t.type !== 'expense') return null;
    if (isProtectedRecurring(t)) return null;
    return tripForDate(t.date);
  }

  /** Should this transaction appear in normal monthly stats? */
  function countsInStats(t) {
    if (!tripSettings().excludeFromStats) return true;
    return !tripExpenseOf(t);
  }

  /** Should this transaction draw down the ordinary monthly budget? */
  function countsInBudget(t) {
    const trip = tripExpenseOf(t);
    return !(trip && trip.budget > 0);   // only a budgeted trip has its own pot
  }

  /** Trip spending vs its own budget. */
  function tripBudgetStatus(trip) {
    if (!trip || !trip.budget) return null;
    const txs = DB.state.transactions.filter(
      (t) => t.type === 'expense' && t.date >= trip.from && t.date <= trip.to &&
        !isProtectedRecurring(t));
    const spent = txs.reduce((s, t) => s + t.amount, 0);
    const days = Math.round((new Date(trip.to) - new Date(trip.from)) / 86400000) + 1;
    const today = U.todayISO();
    const active = today >= trip.from && today <= trip.to;
    const dayNo = active
      ? Math.round((new Date(today) - new Date(trip.from)) / 86400000) + 1 : days;
    const daysLeft = Math.max(0, days - dayNo + 1);
    const spentBefore = active ? txs.filter((t) => t.date < today)
      .reduce((s, t) => s + t.amount, 0) : spent;
    const spentToday = active ? txs.filter((t) => t.date === today)
      .reduce((s, t) => s + t.amount, 0) : 0;
    // Dated ahead (a hotel paid on arrival day, say) — committed, not available
    const committedAhead = active ? txs.filter((t) => t.date > today)
      .reduce((s, t) => s + t.amount, 0) : 0;
    const todayAllowance = daysLeft > 0
      ? (trip.budget - spentBefore - committedAhead) / daysLeft : 0;
    return {
      trip, spent, budget: trip.budget, remaining: trip.budget - spent,
      over: spent > trip.budget, days, daysLeft, active, committedAhead,
      spentToday, todayAllowance, todayRemaining: todayAllowance - spentToday
    };
  }

  const activeTrip = () => tripForDate(U.todayISO());

  /* A trip in a foreign currency should talk in that currency: while you're
     there you compare prices locally, so show the local figure with the euro
     value beside it rather than making you divide in your head. */
  const tripHasFx = (trip) => !!(trip && trip.currency && trip.rate);
  const toLocal = (trip, eur) => (tripHasFx(trip) ? eur / trip.rate : null);
  /** Local amount when the trip has a currency, otherwise plain euro. */
  function fmtTripMoney(trip, eur) {
    const loc = toLocal(trip, eur);
    return loc == null ? fmtEUR(eur) : U.fmtCur(loc, trip.currency);
  }
  /** "₺450,00 (≈ 11,84 €)" — both, for lines where the euro matters too. */
  function fmtTripBoth(trip, eur) {
    return tripHasFx(trip)
      ? U.fmtCur(toLocal(trip, eur), trip.currency) + ' (≈ ' + fmtEUR(eur) + ')'
      : fmtEUR(eur);
  }

  /* ---- Per-category budgets: { categoryId: monthlyAmount } ---- */
  const catBudgets = () => DB.state.meta.categoryBudgets || {};

  /** Spend vs limit for one category in the given month range. */
  function catBudgetStatus(catId, range) {
    const limit = catBudgets()[catId];
    if (!limit) return null;
    const r = range || periodRange();
    const spent = DB.state.transactions
      .filter((t) => t.type === 'expense' && t.categoryId === catId && inRange(t, r) &&
        countsInBudget(t))
      .reduce((s, t) => s + t.amount, 0);
    return { limit, spent, remaining: limit - spent,
      pct: limit > 0 ? Math.min(100, (spent / limit) * 100) : 0, over: spent > limit };
  }

  function openCategoryBudgetsSheet() {
    openSheet('Category limits', (body, api) => {
      body.append(el('p', { class: 'muted', style: 'line-height:1.5;margin-bottom:14px', text:
        'Optional monthly limit per category, on top of the overall budget. Leave a field ' +
        'empty for no limit.' }));
      const inputs = DB.state.categories.map((c) => {
        const cur = catBudgets()[c.id];
        const input = el('input', { type: 'text', inputmode: 'decimal', placeholder: '—',
          value: cur ? String(cur).replace('.', ',') : '' });
        body.append(el('div', { class: 'catlimit-row' }, [
          el('span', { class: 'cat-cell-icon', text: c.icon,
            style: 'background:' + U.tintOf(c.color) }),
          el('span', { class: 'catlimit-name', text: c.name }),
          el('span', { class: 'catlimit-input' }, [input, el('span', { class: 'muted', text: '€' })])
        ]));
        return { c, input };
      });
      body.append(el('div', { class: 'spacer' }), el('button', {
        class: 'btn block primary', text: 'Save limits', onclick: async () => {
          const next = {};
          for (const { c, input } of inputs) {
            const v = CSV.parseAmount(input.value);
            if (v != null && v > 0) next[c.id] = Math.round(v * 100) / 100;
          }
          await DB.setMeta('categoryBudgets', next);
          api.close(); toast('Category limits saved'); render();
        }
      }));
    }, { tall: true });
  }

  function meter(value, max) {
    const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
    const over = value > max && max > 0;
    return el('div', { class: 'meter' + (over ? ' over' : '') },
      [el('div', { class: 'meter-fill', style: 'width:' + pct + '%' })]);
  }

  function budgetCard(bs, heroShowsToday) {
    const card = el('div', { class: 'card budget-card' }, [
      el('div', { class: 'card-head' }, [
        el('h2', { text: 'Budget' }),
        el('button', { class: 'btn small ghost', text: 'Edit', onclick: openBudgetSheet })
      ])
    ]);

    if (bs.mode === 'daily' && bs.isCurrent) {
      // The hero already shows today's figure — don't repeat it here.
      if (!heroShowsToday) {
        const rem = bs.todayRemaining;
        card.append(el('div', { class: 'budget-today' }, [
          el('div', { class: 'bt-label', text: rem >= 0 ? 'Left to spend today' : 'Over budget today' }),
          el('div', { class: 'bt-value ' + (rem >= 0 ? 'pos' : 'neg'), text: fmtEUR(rem) }),
          el('div', { class: 'muted', text: 'of ' + fmtEUR(bs.todayBudget) + ' allowance today' })
        ]));
      } else {
        card.append(el('div', { class: 'budget-line' }, [
          el('span', { text: 'Today' }),
          el('span', { text: fmtEUR(bs.spentToday) + ' / ' + fmtEUR(bs.todayBudget) })
        ]));
      }
      card.append(meter(bs.spentToday, Math.max(bs.todayBudget, bs.spentToday, 0.01)));

      // Why isn't today simply the base amount? Because earlier days over- or
      // underspent, and because money dated ahead is already reserved. Adding an
      // expense for a past day changes today by its share of the days left, which
      // looks like "nothing happened" unless the redistribution is spelled out.
      const shift = bs.todayBudget - bs.dailyBase;
      if (Math.abs(shift) >= 0.005) {
        const daysLeftIncl = bs.D - bs.d + 1;
        const why = [];
        if (bs.spentBefore > 0) why.push(fmtEUR(bs.spentBefore) + ' spent earlier');
        if (bs.committedAhead > 0) why.push(fmtEUR(bs.committedAhead) + ' booked ahead');
        card.append(el('div', { class: 'budget-why muted', text:
          (shift > 0 ? '▲ ' + fmtEUR(shift) : '▼ ' + fmtEUR(-shift)) + ' vs the ' +
          fmtEUR(bs.dailyBase) + ' base — ' +
          (why.length ? why.join(' and ') : 'nothing spent yet') +
          ', spread over the ' + daysLeftIncl + ' days left.' }));
      }

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
    const txs = DB.state.transactions.filter((t) => inRange(t, r) && countsInStats(t));
    const income = txs.filter((t) => t.type === 'income').reduce((s, t) => s + t.amount, 0);
    const expense = txs.filter((t) => t.type === 'expense').reduce((s, t) => s + t.amount, 0);

    root.append(el('div', { class: 'view-title' }, [
      el('h1', { text: 'Home' }),
      el('div', { class: 'title-right' }, [
        el('span', { class: 'muted total-chip', text: fmtEUR(DB.totalBalance()) + ' total' }),
        el('button', { class: 'icon-btn', 'aria-label': 'Search', onclick: openGlobalSearch,
          html: '<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="6.5"/>' +
            '<path d="M16 16l4.5 4.5"/></svg>' }),
        el('button', { class: 'icon-btn', 'aria-label': 'Hide amounts', onclick: togglePrivacy,
          html: privacyCfg().on
            // eye with a slash = currently hidden
            ? '<svg viewBox="0 0 24 24"><path d="M3 3l18 18"/>' +
              '<path d="M10.6 5.2A9 9 0 0 1 12 5c5 0 9 5 9 7a11 11 0 0 1-2.3 3.2"/>' +
              '<path d="M6.5 7.3C4.3 8.8 3 11.2 3 12c0 2 4 7 9 7a8.7 8.7 0 0 0 3.6-.8"/>' +
              '<path d="M9.9 10a3 3 0 0 0 4.2 4.2"/></svg>'
            : '<svg viewBox="0 0 24 24"><path d="M3 12s3.5-7 9-7 9 7 9 7-3.5 7-9 7-9-7-9-7Z"/>' +
              '<circle cx="12" cy="12" r="2.8"/></svg>' })
      ])
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
        el('span', { text: '💾', style: 'font-size:1.2rem' }),
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

    // One hero number: today's allowance when a daily budget exists (the actual
    // daily decision), otherwise the month's net. Income/expenses sit quietly below.
    const net = income - expense;
    const bs = budgetStatus();
    const trip = activeTrip();
    const tbs = tripBudgetStatus(trip);
    // While a budgeted trip is running, your spending comes out of *its* pot and
    // never touches the monthly allowance. Featuring the monthly number then means
    // the headline can't move no matter what you add — so the trip takes the hero.
    const heroTrip = !!(tbs && tbs.active);
    const heroDaily = !heroTrip && bs && bs.mode === 'daily' && bs.isCurrent;

    if (heroTrip) {
      const rem = tbs.todayRemaining;
      root.append(el('div', { class: 'hero' }, [
        el('div', { class: 'hero-label', text: (trip.emoji || '✈️') + ' ' +
          (rem >= 0 ? 'Left for today on ' + trip.name : 'Over ' + trip.name + '’s daily pace') }),
        el('div', { class: 'hero-value ' + (rem > 0 ? 'pos' : rem < 0 ? 'neg' : ''),
          text: fmtTripMoney(trip, rem) }),
        el('div', { class: 'hero-sub muted' }, [
          tripHasFx(trip) ? el('span', { text: '≈ ' + fmtEUR(rem) }) : null,
          el('span', { text: tbs.daysLeft + (tbs.daysLeft === 1 ? ' day left' : ' days left') })
        ])
      ]));
    } else {
      const heroVal = heroDaily ? bs.todayRemaining : net;
      root.append(el('div', { class: 'hero' }, [
        el('div', { class: 'hero-label', text: heroDaily
          ? (heroVal >= 0 ? 'Left to spend today' : 'Over budget today') : 'Net this month' }),
        // Today's allowance isn't wealth-revealing, so it stays visible in private
        // mode; the month's net does not.
        el('div', { class: 'hero-value ' + (heroDaily ? '' : 'sens ') +
          (heroVal > 0 ? 'pos' : heroVal < 0 ? 'neg' : ''), text: fmtEUR(heroVal) }),
        el('div', { class: 'hero-sub muted' }, [
          el('span', { text: '↑ ' + fmtEUR(income) }),
          el('span', { text: '↓ ' + fmtEUR(expense) }),
          heroDaily ? el('span', { text: 'net ' + fmtEUR(net) }) : null
        ])
      ]));
    }

    // On a trip right now? Its pot comes before the monthly budget.
    if (tbs) {
      const rem = tbs.todayRemaining;
      const card = el('div', { class: 'card' }, [
        el('div', { class: 'card-head' }, [
          el('h2', { text: (trip.emoji || '✈️') + ' ' + trip.name }),
          el('button', { class: 'btn small ghost', text: 'Details',
            onclick: () => openTripDetail(trip) })
        ])
      ]);
      if (!heroTrip) {
        card.append(el('div', { class: 'budget-today' }, [
          el('div', { class: 'bt-label', text: rem >= 0 ? 'Left for today on this trip'
            : 'Over the trip’s daily pace' }),
          el('div', { class: 'bt-value ' + (rem >= 0 ? 'pos' : 'neg'),
            text: fmtTripMoney(trip, rem) }),
          el('div', { class: 'muted', text:
            (tripHasFx(trip) ? '≈ ' + fmtEUR(rem) + ' · ' : '') + tbs.daysLeft +
            (tbs.daysLeft === 1 ? ' day left' : ' days left') })
        ]));
      } else {
        card.append(el('div', { class: 'budget-line' }, [
          el('span', { text: 'Today' }),
          el('span', { text: fmtTripMoney(trip, tbs.spentToday) + ' / ' +
            fmtTripMoney(trip, tbs.todayAllowance) })
        ]));
      }
      card.append(meter(tbs.spent, tbs.budget),
        el('div', { class: 'muted', style: 'margin-top:6px', text:
          fmtTripMoney(trip, tbs.spent) + ' of ' + fmtTripMoney(trip, tbs.budget) +
          (tripHasFx(trip) ? ' (≈ ' + fmtEUR(tbs.spent) + ' of ' + fmtEUR(tbs.budget) + ')' : '') +
          ' · not counted in your monthly budget' }));
      if (tbs.committedAhead > 0) {
        card.append(el('div', { class: 'muted', style: 'margin-top:4px', text:
          fmtTripMoney(trip, tbs.committedAhead) + ' already booked on later days' }));
      }
      root.append(card);
    }

    if (bs) root.append(budgetCard(bs, heroDaily));

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
        catCard.append(el('button', { class: 'catbar', onclick: () => openCategoryDetail(cat) }, [
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
          ]),
          el('span', { class: 'catbar-chev', text: '›' })
        ]));
      });
    }
    root.append(catCard);
  }

  /* ---- Global search: everything, from anywhere ---- */
  function openGlobalSearch() {
    openSheet('Search', (body) => {
      const input = el('input', { class: 'searchbox', type: 'search', autocomplete: 'off',
        placeholder: 'Note, place, category, account or amount…' });
      const results = el('div');
      body.append(input, results);

      const draw = () => {
        const q = input.value.trim().toLowerCase();
        results.innerHTML = '';
        if (q.length < 2) {
          results.append(el('div', { class: 'empty', muted: '', html:
            '<span class="big">⌕</span>Type at least two characters' }));
          return;
        }
        // An amount query like "2,80" or "45" matches the value too
        const qNum = CSV.parseAmount(q);
        const matches = DB.state.transactions.filter((t) => {
          const cat = DB.category(t.categoryId);
          const acct = DB.account(t.accountId);
          const hay = ((t.note || '') + ' ' + (cat ? cat.name : '') + ' ' +
            (acct ? acct.name : '') + ' ' + merchantKey(t.note)).toLowerCase();
          if (hay.includes(q)) return true;
          return qNum != null && Math.abs(t.amount - Math.abs(qNum)) < 0.005;
        }).sort((a, b) => b.date.localeCompare(a.date));

        // Matching categories and places jump straight to their own views
        const cats = DB.state.categories.filter((c) => c.name.toLowerCase().includes(q));
        const places = groupByMerchant(matches.filter((t) => t.type === 'expense'))
          .filter((g) => g.label.toLowerCase().includes(q) || g.key.toLowerCase().includes(q))
          .slice(0, 3);

        if (!matches.length && !cats.length) {
          results.append(el('div', { class: 'empty', html:
            '<span class="big">⌕</span>Nothing found for “' + esc(q) + '”' }));
          return;
        }

        if (cats.length) {
          results.append(el('div', { class: 'sub-title', text: 'Categories' }));
          cats.forEach((c) => results.append(el('button', { class: 'pick-row',
            onclick: () => openCategoryDetail(c) }, [
            el('span', { class: 'cat-cell-icon', text: c.icon,
              style: 'background:' + U.tintOf(c.color) }),
            el('span', { class: 's-main', text: c.name }),
            el('span', { class: 's-chev', text: '›' })
          ])));
        }
        if (places.length) {
          results.append(el('div', { class: 'sub-title', style: 'margin-top:12px', text: 'Places' }));
          places.forEach((g) => results.append(el('button', { class: 'pick-row',
            onclick: () => openMerchantDetail(g, { label: 'Matches' }) }, [
            el('span', { class: 's-main' }, [
              el('div', { text: g.label }),
              el('div', { class: 's-sub', text: g.count + '× · ' + fmtEUR(g.total) })
            ]),
            el('span', { class: 's-chev', text: '›' })
          ])));
        }

        results.append(el('div', { class: 'sub-title', style: 'margin-top:12px',
          text: matches.length + ' transaction' + (matches.length === 1 ? '' : 's') }));
        const total = matches.filter((t) => t.type === 'expense').reduce((s, t) => s + t.amount, 0);
        if (total > 0) {
          results.append(el('p', { class: 'muted', style: 'margin-bottom:8px',
            text: fmtEUR(total) + ' spent in total' }));
        }
        matches.slice(0, 60).forEach((t) => {
          const c = DB.category(t.categoryId);
          results.append(el('button', { class: 'cat-tx', onclick: () => openTxSheet(t) }, [
            el('div', { class: 'cat-tx-main' }, [
              el('div', { class: 'cat-tx-note', text: t.note || 'Transaction' }),
              el('div', { class: 'cat-tx-sub', text: U.fmtDate(t.date) +
                (c ? ' · ' + c.name : '') })
            ]),
            el('div', { class: 'cat-tx-amt' + (t.type === 'income' ? ' pos' : ''),
              text: (t.type === 'income' ? '+ ' : t.type === 'transfer' ? '⇄ ' : '− ') +
                fmtEUR(t.amount) })
          ]));
        });
        if (matches.length > 60) {
          results.append(el('p', { class: 'muted', style: 'padding:10px 0',
            text: 'and ' + (matches.length - 60) + ' more…' }));
        }
      };

      let deb;
      input.addEventListener('input', () => {
        clearTimeout(deb); deb = setTimeout(draw, 130);
      });
      draw();
      setTimeout(() => input.focus(), 320);
    }, { tall: true });
  }

  const uncategorizedCat = () =>
    DB.state.categories.find((c) => c.name.toLowerCase() === 'uncategorized') || null;

  /* ---- Merchant ("place") grouping ------------------------------------------
     Bank descriptions vary per store/branch — ESSELUNGA CANOVA vs ESSELUNGA
     NOVOLI, UNICOOP-FIRENZE vs UNICOOP SCANDICCI — so we derive a brand key:
     drop the payment-processor prefix, keep the leading distinctive word(s). */
  const PROCESSOR_PREFIXES = ['PAYPAL', 'SUMUP', 'PPG', 'NYX', 'SQ', 'ZETTLE', 'IZ', 'SP',
    'STRIPE', 'WISE', 'SATISPAY'];
  // Words too generic to identify a place on their own — keep the next word too.
  const GENERIC_WORDS = new Set(['BAR', 'CAFFE', 'CAFE', 'MENSA', 'PIZZERIA', 'RISTORANTE',
    'OSTERIA', 'TRATTORIA', 'GELATERIA', 'PASTICCERIA', 'PANETTERIA', 'MACELLERIA',
    'FARMACIA', 'PHARMACIE', 'SUPERMERCATO', 'TABACCHERIA', 'LAVANDERIA', 'HOTEL', 'PUB',
    'MERCATO', 'NUOVA', 'GRUPPO', 'AZIENDA', 'COMUNE', 'CIR', 'LA', 'IL', 'LE', 'LES',
    'DI', 'DE', 'GRANDE', 'CASA', 'PIU']);

  function merchantKey(note) {
    let s = String(note || '').toUpperCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    // "PAYPAL *MICROSOFT" / "SumUp *La Scatola A" -> drop the processor
    const star = s.match(/^([A-Z0-9]{2,10})\s*\*\s*(.+)$/);
    if (star && PROCESSOR_PREFIXES.includes(star[1])) s = star[2];
    const tokens = s.replace(/[^A-Z0-9]+/g, ' ').trim().split(' ')
      .filter((w) => w.length > 2 && !/^\d+$/.test(w));
    if (!tokens.length) return String(note || '').trim().toUpperCase() || '—';
    // A generic first word (BAR, MENSA, PIZZERIA…) needs the next word to identify
    // the place; anything else is a brand that stands on its own, so "ZARA MILANO
    // 4471" and "ZARA" group together.
    return GENERIC_WORDS.has(tokens[0]) ? tokens.slice(0, 2).join(' ') : tokens[0];
  }

  /** Group transactions by place: [{ key, label, total, count, txs }] desc by total. */
  function groupByMerchant(txs) {
    const groups = new Map();
    for (const t of txs) {
      const key = merchantKey(t.note);
      if (!groups.has(key)) groups.set(key, { key, total: 0, count: 0, txs: [], labels: new Map() });
      const g = groups.get(key);
      g.total += t.type === 'income' ? -t.amount : t.amount;
      g.count++;
      g.txs.push(t);
      const nm = (t.note || '').trim() || key;
      g.labels.set(nm, (g.labels.get(nm) || 0) + 1);
    }
    return [...groups.values()].map((g) => {
      // Label the group with its most frequent original description.
      const label = [...g.labels.entries()].sort((a, b) => b[1] - a[1] || a[0].length - b[0].length)[0][0];
      g.txs.sort((a, b) => b.date.localeCompare(a.date));
      return { key: g.key, label, total: g.total, count: g.count, txs: g.txs };
    }).sort((a, b) => b.total - a.total);
  }

  /** Tap a Top-spending / All-categories row: Uncategorized opens the review queue;
      any other category opens a light summary sheet for the given period, with
      date/amount/place views and an "Open in Activity" escape hatch. */
  function openCategoryDetail(cat, range, rangeLabel) {
    const uc = uncategorizedCat();
    if (cat && uc && cat.id === uc.id) { openReviewSheet(); return; }
    const r = range || periodRange();
    const label = rangeLabel || periodLabel();
    const catId = cat ? cat.id : null;
    const all = DB.state.transactions.filter((t) => t.categoryId === catId && inRange(t, r));
    const expenses = all.filter((t) => t.type === 'expense');
    const spent = expenses.reduce((s, t) => s + t.amount, 0);
    const income = all.filter((t) => t.type === 'income').reduce((s, t) => s + t.amount, 0);
    const monthExp = DB.state.transactions
      .filter((t) => t.type === 'expense' && inRange(t, r))
      .reduce((s, t) => s + t.amount, 0);
    const pct = monthExp > 0 ? Math.round((spent / monthExp) * 100) : 0;
    const avg = expenses.length ? spent / expenses.length : 0;
    const biggest = expenses.reduce((mx, t) => (!mx || t.amount > mx.amount ? t : mx), null);
    let sort = 'date';

    openSheet((cat ? cat.icon + ' ' + cat.name : 'Uncategorized'), (body, api) => {
      body.append(el('div', { class: 'cat-detail-head' }, [
        el('div', { class: 'cat-detail-total' + (spent === 0 && income > 0 ? ' pos' : ''),
          text: fmtEUR(spent > 0 || income === 0 ? spent : income) }),
        el('div', { class: 'muted', text:
          label + ' · ' + all.length + ' transaction' + (all.length === 1 ? '' : 's') +
          (pct ? ' · ' + pct + '% of spending' : '') })
      ]));

      // Per-category limit, if one is set for this category
      const cb = catId ? catBudgetStatus(catId, r) : null;
      if (cb) {
        body.append(el('div', { class: 'catbudget' }, [
          el('div', { class: 'budget-line' }, [
            el('span', { text: 'Monthly limit' }),
            el('span', { class: cb.over ? 'neg' : 'pos',
              text: fmtEUR(cb.spent) + ' / ' + fmtEUR(cb.limit) })
          ]),
          meter(cb.spent, cb.limit),
          el('div', { class: 'muted', style: 'margin-top:6px', text: cb.over
            ? fmtEUR(-cb.remaining) + ' over the limit'
            : fmtEUR(cb.remaining) + ' left this month' })
        ]));
      }

      if (all.length > 1 && biggest) {
        body.append(el('div', { class: 'cat-detail-stats' }, [
          el('div', { class: 'tile' }, [
            el('div', { class: 't-label', text: 'Average' }),
            el('div', { class: 't-value', style: 'font-size:1.1rem', text: fmtEUR(avg) })
          ]),
          // Biggest is tappable — jumps to that specific transaction.
          el('button', { class: 'tile tile-btn', onclick: () => openTxSheet(biggest) }, [
            el('div', { class: 't-label', text: 'Biggest ›' }),
            el('div', { class: 't-value', style: 'font-size:1.1rem', text: fmtEUR(biggest.amount) })
          ])
        ]));
      }

      const seg = el('div', { class: 'seg seg-4', style: 'margin:14px 0 10px' });
      const bDate = el('button', { text: 'Date' });
      const bAmt = el('button', { text: 'Amount' });
      const bPlace = el('button', { text: 'By place' });
      const listWrap = el('div');
      const syncSeg = () => {
        bDate.className = sort === 'date' ? 'active' : '';
        bAmt.className = sort === 'amount' ? 'active' : '';
        bPlace.className = sort === 'place' ? 'active' : '';
      };

      const txRowEl = (t) => {
        const acct = DB.account(t.accountId);
        return el('button', { class: 'cat-tx', onclick: () => openTxSheet(t) }, [
          el('div', { class: 'cat-tx-main' }, [
            el('div', { class: 'cat-tx-note', text: t.note || (cat ? cat.name : 'Transaction') }),
            el('div', { class: 'cat-tx-sub', text: U.fmtDate(t.date) + (acct ? ' · ' + acct.name : '') })
          ]),
          el('div', { class: 'cat-tx-amt' + (t.type === 'income' ? ' pos' : ''),
            text: (t.type === 'income' ? '+ ' : '− ') + fmtEUR(t.amount) })
        ]);
      };

      const drawList = () => {
        listWrap.innerHTML = '';
        if (sort === 'place') {
          const groups = groupByMerchant(all);
          groups.forEach((g) => {
            const sub = el('div', { class: 'place-sub' });
            let open = false;
            const row = el('button', { class: 'place-row', onclick: () => {
              open = !open;
              sub.classList.toggle('show', open);
              row.querySelector('.place-chev').textContent = open ? '⌄' : '›';
            } }, [
              el('div', { class: 'place-main' }, [
                el('div', { class: 'place-name', text: g.label }),
                el('div', { class: 'place-count', text:
                  g.count + (g.count === 1 ? ' transaction' : ' transactions') })
              ]),
              el('div', { class: 'place-total', text: fmtEUR(Math.abs(g.total)) }),
              el('span', { class: 'place-chev', text: '›' })
            ]);
            g.txs.forEach((t) => sub.append(txRowEl(t)));
            listWrap.append(el('div', { class: 'place-group' }, [row, sub]));
          });
          return;
        }
        const sorted = [...all].sort(sort === 'amount'
          ? (a, b) => b.amount - a.amount
          : (a, b) => b.date.localeCompare(a.date));
        sorted.forEach((t) => listWrap.append(txRowEl(t)));
      };

      bDate.addEventListener('click', () => { sort = 'date'; syncSeg(); drawList(); });
      bAmt.addEventListener('click', () => { sort = 'amount'; syncSeg(); drawList(); });
      bPlace.addEventListener('click', () => { sort = 'place'; syncSeg(); drawList(); });
      syncSeg(); seg.append(bDate, bAmt, bPlace);
      body.append(seg, listWrap);
      drawList();

      body.append(el('button', {
        class: 'btn block ghost', style: 'margin-top:14px', text: 'Open in Activity ›',
        onclick: () => {
          api.close();
          ui.tx.q = ''; ui.tx.accountId = ''; ui.tx.categoryId = catId || '';
          ui.tx.from = r.from; ui.tx.to = r.to; ui.tx.limit = 100;
          show('transactions');
        }
      }));
    }, { tall: true });
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
      if (o.type === 'transfer') {
        // Transfers legitimately have no category; just ensure both ends exist.
        if (!validAcct.has(o.accountId)) { o.accountId = fallbackAcct; changed = true; }
        if (!validAcct.has(o.toAccountId)) {
          const other = DB.state.accounts.find((a) => a.id !== o.accountId);
          o.toAccountId = other ? other.id : fallbackAcct; changed = true;
        }
        if (changed) fixes.push(o);
        continue;
      }
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

  /** A home-screen PWA sits suspended for days rather than reloading, so the
      "today" captured at load goes stale. Across a month boundary that leaves
      Home and Stats sitting on last month while calling it "this month". Roll
      them forward on resume — but only if they were still following the current
      month, never if you deliberately navigated somewhere else. */
  function refreshToday() {
    const fresh = new Date();
    const wasY = now.getFullYear(), wasM = now.getMonth();
    if (fresh.getFullYear() === wasY && fresh.getMonth() === wasM) return false;
    now = fresh;
    if (ui.period.type === 'month' && ui.period.y === wasY && ui.period.m0 === wasM) {
      ui.period = { type: 'month', y: now.getFullYear(), m0: now.getMonth() };
      ui.donutSel = null;
    }
    if (ui.stats.range === 'month' && ui.stats.y === wasY && ui.stats.m0 === wasM) {
      ui.stats.y = now.getFullYear(); ui.stats.m0 = now.getMonth();
      ui.stats.donutSel = null;
    }
    return true;
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
    const txs = DB.state.transactions.filter(
      (t) => t.date >= rg.from && t.date <= rg.to && countsInStats(t));
    const income = txs.filter((t) => t.type === 'income').reduce((s, t) => s + t.amount, 0);
    const expense = txs.filter((t) => t.type === 'expense').reduce((s, t) => s + t.amount, 0);
    const days = (new Date(rg.to) - new Date(rg.from)) / 86400000 + 1;

    root.append(el('div', { class: 'view-title' }, [el('h1', { text: 'Stats' })]));

    // One control row: ‹ period pill › — the pill opens the range picker
    const nav = el('div', { class: 'month-nav' });
    if (rg.nav) {
      const prev = el('button', { class: 'mn-btn', text: '‹' });
      prev.addEventListener('click', () => statsShift(-1));
      nav.append(prev);
    }
    nav.append(el('button', { class: 'mn-label pill', onclick: openStatsRangeSheet }, [
      el('span', { text: rg.label }),
      el('span', { class: 'pill-caret', text: '⌄' })
    ]));
    if (rg.nav) {
      const next = el('button', { class: 'mn-btn', text: '›' });
      next.addEventListener('click', () => statsShift(1));
      nav.append(next);
    }
    root.append(nav);

    // View switcher — keeps Stats focused instead of one endless page
    const vseg = el('div', { class: 'seg seg-4 seg-scroll', style: 'margin-bottom:12px' });
    [['overview', 'Overview'], ['trends', 'Trends'], ['calendar', 'Calendar'],
     ['merchants', 'Places'], ['trips', 'Trips']].forEach(([val, lbl]) => {
      vseg.append(el('button', {
        class: ui.stats.view === val ? 'active' : '', text: lbl,
        onclick: () => { ui.stats.view = val; renderStats(); }
      }));
    });
    root.append(vseg);

    if (ui.stats.view === 'trends') return statsTrends(root);
    if (ui.stats.view === 'calendar') return statsCalendar(root);
    if (ui.stats.view === 'merchants') return statsMerchants(root, rg, txs);
    if (ui.stats.view === 'trips') return statsTrips(root, rg);
    statsOverview(root, rg, txs, income, expense, days);
  }

  function statsOverview(root, rg, txs, income, expense, days) {
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

    if (income === 0 && expense === 0) {
      root.append(statsEmptyNote(rg));
      return;
    }

    const cmp = comparisonCard(rg);
    if (cmp) root.append(cmp);

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

    // One card: donut + the full category list, which doubles as the legend
    // (the old separate legend + "All categories" card said the same thing twice)
    const donutCard = el('div', { class: 'card' }, [
      el('div', { class: 'card-head' }, [
        el('h2', { text: 'Spending by category' }),
        el('span', { class: 'muted', text: byCat.size + ' categories' })
      ])
    ]);
    if (!items.length) {
      donutCard.append(el('div', { class: 'empty', html:
        '<span class="big">○</span>No expenses in this period' }));
      root.append(donutCard);
      return;
    }
    if (ui.stats.donutSel && !items.some((d) => d.id === ui.stats.donutSel)) ui.stats.donutSel = null;
    const wrap = el('div', { class: 'chart-wrap' });
    const list = el('div');
    const allCats = [...byCat.entries()]
      .map(([id, value]) => ({ cat: DB.category(id), id, value }))
      .sort((a, b) => b.value - a.value);
    const maxV = allCats[0].value;

    const draw = () => {
      const sel = items.find((d) => d.id === ui.stats.donutSel);
      Charts.donut(wrap, items, {
        selectedId: ui.stats.donutSel,
        onSelect: (id) => { ui.stats.donutSel = id; draw(); },
        centerLabel: sel ? sel.label : 'Expenses',
        centerValue: fmtEUR(sel ? sel.value : expense)
      });
      list.innerHTML = '';
      allCats.forEach(({ cat, id, value }) => {
        const color = U.colorOf(cat ? cat.color : 'blue');
        const share = expense > 0 ? Math.round((value / expense) * 100) : 0;
        const dim = ui.stats.donutSel && ui.stats.donutSel !== id &&
          items.some((d) => d.id === id);
        list.append(el('button', {
          class: 'catbar' + (dim ? ' dim' : ''),
          onclick: () => openCategoryDetail(cat, { from: rg.from, to: rg.to }, rg.label)
        }, [
          el('span', { class: 'catbar-icon', text: cat ? cat.icon : '?',
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
          ]),
          el('span', { class: 'catbar-pct', text: share + '%' }),
          el('span', { class: 'catbar-chev', text: '›' })
        ]));
      });
    };
    draw();
    donutCard.append(wrap, list);
    root.append(donutCard);
  }

  /** An all-zero Overview has four very different causes and used to look
      identical in each: a month you simply haven't recorded yet, a month whose
      spending all belongs to a trip that stats deliberately hide, a month holding
      only transfers, and an empty app. Say which one it is, and offer the way out. */
  function statsEmptyNote(rg) {
    const inRange = DB.state.transactions.filter((t) => t.date >= rg.from && t.date <= rg.to);
    const hidden = inRange.filter((t) => !countsInStats(t));
    const box = el('div', { class: 'card empty-note' });
    const head = (icon, title, msg) => box.append(
      el('div', { class: 'empty-note-icon', text: icon }),
      el('h2', { text: title }),
      el('p', { class: 'muted', text: msg })
    );

    if (hidden.length) {
      const names = [...new Set(hidden.map((t) => (tripForDate(t.date) || {}).name).filter(Boolean))];
      const spent = hidden.reduce((s, t) => s + t.amount, 0);
      head('✈️', 'It’s all trip spending',
        fmtEUR(spent) + ' across ' + hidden.length + ' transaction' +
        (hidden.length === 1 ? '' : 's') + ' here belong to ' +
        (names.length ? names.join(', ') : 'a trip') + '. Trips are kept out of monthly ' +
        'stats on purpose, so a holiday doesn’t skew your normal baseline.');
      box.append(
        el('button', { class: 'btn block primary', text: 'See the trip',
          onclick: () => { ui.stats.view = 'trips'; renderStats(); } }),
        el('div', { class: 'spacer' }),
        el('button', { class: 'btn block', text: 'Count trips in stats instead',
          onclick: async () => {
            await DB.setMeta('tripSettings',
              Object.assign({}, tripSettings(), { excludeFromStats: false }));
            render();
          } })
      );
      return box;
    }

    if (inRange.length) {
      head('⇄', 'Only transfers here',
        inRange.length + ' movement' + (inRange.length === 1 ? '' : 's') + ' in this period, ' +
        'all between your own accounts. Transfers never count as income or expense — the ' +
        'money didn’t leave your pocket.');
      box.append(el('button', { class: 'btn block', text: 'See them in Activity',
        onclick: () => {
          ui.tx = Object.assign({}, ui.tx, { from: rg.from, to: rg.to, q: '', limit: 100 });
          show('transactions');
        } }));
      return box;
    }

    // Nothing at all in range — point at the month that does have something
    const counted = DB.state.transactions.filter((t) => t.type !== 'transfer' && countsInStats(t));
    const latest = counted.reduce((mx, t) => (t.date > mx ? t.date : mx), '');
    if (latest && latest < rg.from) {
      const ly = Number(latest.slice(0, 4)), lm = Number(latest.slice(5, 7)) - 1;
      head('🗓', 'Nothing in ' + rg.label + ' yet',
        'A new period starts empty. Add something, or look back at the last month that ' +
        'has data.');
      box.append(el('button', { class: 'btn block primary', text: 'Go to ' + U.monthLabel(ly, lm),
        onclick: () => {
          ui.stats.range = 'month'; ui.stats.y = ly; ui.stats.m0 = lm;
          ui.stats.donutSel = null; renderStats();
        } }));
      return box;
    }

    head('📊', 'No transactions in this period',
      counted.length ? 'Try a different period from the pill above.'
        : 'Add your first transaction with the + button and this fills in.');
    return box;
  }

  /* ---------------- Trends: how spending moves across months ----------------
     Overview answers "where did this month go"; Trends answers "is that normal".
     Everything here is month-over-month, so it ignores the range pill except to
     decide which month the window ends on. */

  /** The n months ending at the month Stats is pointing at. */
  function trendMonths(n) {
    const s = ui.stats;
    let endY = s.y, endM = s.m0;
    if (s.range === 'year') {
      endM = 11;
    } else if (s.range === 'all' || s.range === 'custom') {
      const dates = DB.state.transactions.map((t) => t.date).sort();
      const last = dates[dates.length - 1];
      if (last) { endY = Number(last.slice(0, 4)); endM = Number(last.slice(5, 7)) - 1; }
    }
    const out = [];
    for (let i = n - 1; i >= 0; i--) {
      const d = new Date(endY, endM - i, 1);
      const y = d.getFullYear(), m0 = d.getMonth();
      const r = U.monthRange(y, m0);
      out.push({
        y, m0, key: y + '-' + pad2(m0 + 1), from: r.from, to: r.to,
        label: U.monthLabel(y, m0),
        tick: d.toLocaleDateString('it-IT', { month: 'short' }) +
          (m0 === 0 ? " '" + String(y).slice(2) : '')
      });
    }
    return out;
  }

  function statsTrends(root) {
    const months = trendMonths(ui.stats.trendWindow);
    const idx = new Map(months.map((m, i) => [m.key, i]));
    const from = months[0].from, to = months[months.length - 1].to;
    const txs = DB.state.transactions.filter(
      (t) => t.date >= from && t.date <= to && countsInStats(t));
    const exp = txs.filter((t) => t.type === 'expense');

    // Window length switcher — 6 months reads the recent shape, 24 the long arc
    const wseg = el('div', { class: 'seg seg-4', style: 'margin-bottom:12px' });
    [6, 12, 24].forEach((n) => {
      wseg.append(el('button', {
        class: ui.stats.trendWindow === n ? 'active' : '', text: n + ' months',
        onclick: () => { ui.stats.trendWindow = n; renderStats(); }
      }));
    });
    root.append(wseg);

    if (!exp.length) {
      root.append(el('div', { class: 'empty', html:
        '<span class="big">📈</span>No spending in the last ' + months.length + ' months' }));
      return;
    }

    /* --- Monthly totals per category (drives the mix chart and the movers) --- */
    const perCat = new Map();                    // categoryId -> €/month array
    const monthTotal = new Array(months.length).fill(0);
    exp.forEach((t) => {
      const i = idx.get(t.date.slice(0, 7));
      if (i == null) return;
      const id = t.categoryId || '';
      if (!perCat.has(id)) perCat.set(id, new Array(months.length).fill(0));
      perCat.get(id)[i] += t.amount;
      monthTotal[i] += t.amount;
    });
    const sum = (a) => a.reduce((s, v) => s + v, 0);
    const ranked = [...perCat.entries()].sort((a, b) => sum(b[1]) - sum(a[1]));
    const catName = (id) => { const c = DB.category(id); return c ? c.name : 'Uncategorized'; };
    const catColor = (id) => { const c = DB.category(id); return U.colorOf(c ? c.color : 'blue'); };

    root.append(mixCard(months, ranked, monthTotal));
    if (months.length >= 2) {
      const mv = moversCard(months, perCat);
      if (mv) root.append(mv);
    }
    const pc = paceCard(months, exp);
    if (pc) root.append(pc);
    const fx = fixedCard(months, exp, idx);
    if (fx) root.append(fx);
    const sv = savingsCard(months, txs, idx);
    if (sv) root.append(sv);
    root.append(weekdayCard(months, exp));

    /* ---------- Card: category mix over time ---------- */
    function mixCard(months, ranked, monthTotal) {
      const TOP = 6;
      const top = ranked.slice(0, TOP);
      const rest = ranked.slice(TOP);
      const series = top.map(([id]) => ({ key: id, color: catColor(id), label: catName(id) }));
      if (rest.length) series.push({ key: '__other', color: '#898781', label: 'Other' });

      const buckets = months.map((m, i) => {
        const b = { tick: m.tick, label: m.label };
        top.forEach(([id, arr]) => { b[id] = arr[i]; });
        if (rest.length) b.__other = rest.reduce((s, [, arr]) => s + arr[i], 0);
        return b;
      });

      const card = el('div', { class: 'card' }, [
        el('div', { class: 'card-head' }, [
          el('h2', { text: 'Categories over time' }),
          el('span', { class: 'muted', text: 'avg ' + fmtEUR(sum(monthTotal) / months.length) + '/mo' })
        ])
      ]);
      const wrap = el('div', { class: 'chart-wrap' });
      const chips = el('div', { class: 'lg-chips' });
      const cap = el('div', { class: 'trend-cap muted' });
      card.append(wrap, chips, cap);

      if (ui.stats.trendCat && !series.some((s) => s.key === ui.stats.trendCat)) {
        ui.stats.trendCat = null;
      }

      const draw = () => {
        const sel = ui.stats.trendCat;
        if (sel) {
          const arr = sel === '__other'
            ? months.map((m, i) => rest.reduce((s, [, a]) => s + a[i], 0))
            : (perCat.get(sel) || new Array(months.length).fill(0));
          const s = series.find((x) => x.key === sel);
          Charts.bars(wrap, months.map((m, i) => (
            { label: m.label, tickLabel: m.tick, value: Math.round(arr[i] * 100) / 100 })),
            { color: s.color, formatValue: fmtEUR });
          const avg = sum(arr) / months.length;
          const cur = arr[arr.length - 1];
          const pct = avg > 0 ? Math.round(((cur - avg) / avg) * 100) : null;
          cap.textContent = s.label + ' · ' + fmtEUR(cur) + ' this month vs ' +
            fmtEUR(avg) + ' average' +
            (pct === null ? '' : ' (' + (pct > 0 ? '+' : '') + pct + '%)');
        } else {
          Charts.stackedBars(wrap, buckets, series, { formatValue: fmtEUR });
          cap.textContent = 'Tap a category to see it on its own.';
        }
        chips.innerHTML = '';
        series.forEach((s) => {
          chips.append(el('button', {
            class: 'lg-chip' + (ui.stats.trendCat === s.key ? ' on' : ''),
            onclick: () => {
              ui.stats.trendCat = ui.stats.trendCat === s.key ? null : s.key;
              draw();
            }
          }, [
            el('span', { class: 'dot', style: 'background:' + s.color }),
            el('span', { text: s.label })
          ]));
        });
      };
      requestAnimationFrame(draw);
      return card;
    }

    /* ---------- Card: what changed vs your own baseline ----------
       Compared against the mean of the 3 preceding months rather than just the
       previous one, so a single odd month doesn't read as a trend. */
    function moversCard(months, perCat) {
      const last = months.length - 1;
      const baseFrom = Math.max(0, last - 3);
      if (last === 0) return null;
      const rows = [...perCat.entries()].map(([id, arr]) => {
        const base = sum(arr.slice(baseFrom, last)) / Math.max(1, last - baseFrom);
        return { id, arr, cur: arr[last], base, diff: arr[last] - base };
      }).filter((r) => Math.abs(r.diff) >= 1)
        .sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff))
        .slice(0, 6);
      if (!rows.length) return null;

      const m = months[last];
      const card = el('div', { class: 'card' }, [
        el('div', { class: 'card-head' }, [
          el('h2', { text: 'What changed' }),
          el('span', { class: 'muted', text: m.label + ' vs its own average' })
        ])
      ]);
      rows.forEach((r) => {
        const c = DB.category(r.id);
        const pct = r.base > 0 ? Math.round((r.diff / r.base) * 100) : null;
        card.append(el('button', {
          class: 'mover-row',
          onclick: () => openCategoryDetail(c, { from: m.from, to: m.to }, m.label)
        }, [
          el('span', { class: 'cmp-icon', text: c ? c.icon : '❓',
            style: 'background:' + U.tintOf(c ? c.color : 'blue') }),
          el('div', { class: 'mover-main' }, [
            el('div', { class: 'mover-name', text: catName(r.id) }),
            el('div', { class: 'mover-sub muted',
              text: fmtEUR(r.base) + ' avg → ' + fmtEUR(r.cur) })
          ]),
          Charts.sparkline(r.arr, { color: catColor(r.id) }),
          el('span', { class: 'mover-diff ' + (r.diff > 0 ? 'neg' : 'pos'),
            text: (r.diff > 0 ? '+' : '−') + fmtEUR(Math.abs(r.diff)) +
              (pct === null ? '' : '\n' + (pct > 0 ? '+' : '') + pct + '%') })
        ]));
      });
      return card;
    }

    /* ---------- Card: spending pace within the month ----------
       Cumulative curves answer the one question a monthly total can't: am I
       running hotter than last month *at this point* in the month. */
    function paceCard(months, exp) {
      const cur = months[months.length - 1];
      const prev = months[months.length - 2];
      if (!prev) return null;
      const today = U.todayISO();

      const cumulative = (m) => {
        const D = new Date(m.y, m.m0 + 1, 0).getDate();
        const byDay = new Array(D + 2).fill(0);
        exp.forEach((t) => {
          if (t.date >= m.from && t.date <= m.to) byDay[Number(t.date.slice(8, 10))] += t.amount;
        });
        const pts = []; let acc = 0;
        for (let d = 1; d <= D; d++) {
          const iso = m.from.slice(0, 8) + pad2(d);
          if (iso > today) break;                 // don't draw a flat future
          acc += byDay[d];
          pts.push({ tick: String(d), label: 'Day ' + d, value: Math.round(acc * 100) / 100 });
        }
        return pts;
      };

      const curPts = cumulative(cur), prevPts = cumulative(prev);
      if (!curPts.length || !prevPts.length) return null;

      const series = [
        { label: cur.label, color: U.colorOf('blue'), points: curPts },
        { label: prev.label, color: U.colorOf('violet'), dash: true, points: prevPts }
      ];
      const bud = DB.state.meta.budget;
      if (bud && bud.amount > 0) {
        const D = new Date(cur.y, cur.m0 + 1, 0).getDate();
        series.push({
          label: 'Budget', color: U.colorOf('red'), dash: true,
          points: Array.from({ length: D }, (_, i) => (
            { tick: String(i + 1), label: 'Day ' + (i + 1),
              value: Math.round((bud.amount / D) * (i + 1) * 100) / 100 }))
        });
      }

      const day = curPts.length;
      const same = prevPts[Math.min(day, prevPts.length) - 1].value;
      const diff = curPts[day - 1].value - same;
      const card = el('div', { class: 'card' }, [
        el('div', { class: 'card-head' }, [
          el('h2', { text: 'Pace this month' }),
          el('span', { class: 'muted', text: 'day ' + day })
        ]),
        el('div', { class: 'legend-inline' }, series.map((s) => legendKey(s.color, s.label)))
      ]);
      const wrap = el('div', { class: 'chart-wrap' });
      card.append(wrap);
      card.append(el('div', { class: 'trend-cap' }, [
        el('span', { class: diff > 0 ? 'neg' : 'pos',
          text: fmtEUR(Math.abs(diff)) + (diff > 0 ? ' ahead of ' : ' behind ') }),
        el('span', { class: 'muted', text: prev.label + ' at the same day' })
      ]));
      requestAnimationFrame(() => Charts.multiLine(wrap, series, { formatValue: fmtEUR }));
      return card;
    }

    /* ---------- Card: fixed vs one-off ----------
       Only meaningful once subscriptions have been confirmed, so it hides itself
       until then rather than showing an all-blue chart. */
    function fixedCard(months, exp, idx) {
      const buckets = months.map((m) => ({ tick: m.tick, label: m.label, fixed: 0, oneoff: 0 }));
      let anyFixed = 0;
      exp.forEach((t) => {
        const i = idx.get(t.date.slice(0, 7));
        if (i == null) return;
        if (isProtectedRecurring(t)) { buckets[i].fixed += t.amount; anyFixed += t.amount; }
        else buckets[i].oneoff += t.amount;
      });
      if (anyFixed <= 0) return null;

      const last = buckets[buckets.length - 1];
      const tot = last.fixed + last.oneoff;
      const share = tot > 0 ? Math.round((last.fixed / tot) * 100) : 0;
      const card = el('div', { class: 'card' }, [
        el('div', { class: 'card-head' }, [
          el('h2', { text: 'Fixed vs one-off' }),
          el('span', { class: 'muted', text: share + '% fixed this month' })
        ]),
        el('div', { class: 'legend-inline' }, [
          legendKey(U.colorOf('violet'), 'Subscriptions'),
          legendKey(U.colorOf('blue'), 'Everything else')
        ])
      ]);
      const wrap = el('div', { class: 'chart-wrap' });
      card.append(wrap);
      requestAnimationFrame(() => Charts.stackedBars(wrap, buckets, [
        { key: 'fixed', color: U.colorOf('violet'), label: 'Fixed' },
        { key: 'oneoff', color: U.colorOf('blue'), label: 'One-off' }
      ], { formatValue: fmtEUR }));
      return card;
    }

    /* ---------- Card: savings rate ---------- */
    function savingsCard(months, txs, idx) {
      const inc = new Array(months.length).fill(0);
      const out = new Array(months.length).fill(0);
      txs.forEach((t) => {
        const i = idx.get(t.date.slice(0, 7));
        if (i == null) return;
        if (t.type === 'income') inc[i] += t.amount;
        else if (t.type === 'expense') out[i] += t.amount;
      });
      const withIncome = months.map((m, i) => i).filter((i) => inc[i] > 0);
      if (withIncome.length < 2) return null;     // a rate needs income to divide by

      const pts = months.map((m, i) => ({
        tick: m.tick, label: m.label,
        value: inc[i] > 0 ? Math.round(((inc[i] - out[i]) / inc[i]) * 100) : 0
      }));
      const avg = Math.round(
        withIncome.reduce((s, i) => s + pts[i].value, 0) / withIncome.length);
      const card = el('div', { class: 'card' }, [
        el('div', { class: 'card-head' }, [
          el('h2', { text: 'Savings rate' }),
          el('span', { class: 'muted', text: avg + '% average' })
        ])
      ]);
      const wrap = el('div', { class: 'chart-wrap' });
      card.append(wrap);
      card.append(el('div', { class: 'trend-cap muted',
        text: 'Share of income you kept each month.' }));
      requestAnimationFrame(() => Charts.multiLine(wrap, [
        { label: 'Kept', color: U.colorOf('aqua'), points: pts }
      ], { formatValue: (v) => v + '%', suffix: '%' }));
      return card;
    }

    /* ---------- Card: weekday rhythm ---------- */
    function weekdayCard(months, exp) {
      const NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
      const total = new Array(7).fill(0);
      const count = new Array(7).fill(0);
      const today = U.todayISO();
      // Count every elapsed day in the window so quiet days pull the average down
      const stop = months[months.length - 1].to < today ? months[months.length - 1].to : today;
      for (let d = new Date(months[0].from + 'T12:00:00'); isoOf(d) <= stop;
           d.setDate(d.getDate() + 1)) {
        count[(d.getDay() + 6) % 7]++;
      }
      // Window entirely in the future (dated-ahead entries): count its days instead
      if (!count.some(Boolean)) {
        for (let d = new Date(months[0].from + 'T12:00:00');
             isoOf(d) <= months[months.length - 1].to; d.setDate(d.getDate() + 1)) {
          count[(d.getDay() + 6) % 7]++;
        }
      }
      exp.forEach((t) => {
        const d = new Date(t.date + 'T12:00:00');
        total[(d.getDay() + 6) % 7] += t.amount;
      });
      const data = NAMES.map((n, i) => ({
        label: n, tickLabel: n[0],
        value: count[i] ? Math.round((total[i] / count[i]) * 100) / 100 : 0
      }));
      const peak = data.reduce((a, b) => (b.value > a.value ? b : a), data[0]);
      const card = el('div', { class: 'card' }, [
        el('div', { class: 'card-head' }, [
          el('h2', { text: 'Weekday rhythm' }),
          el('span', { class: 'muted', text: peak.label + ' is heaviest' })
        ])
      ]);
      const wrap = el('div', { class: 'chart-wrap' });
      card.append(wrap);
      card.append(el('div', { class: 'trend-cap muted',
        text: 'Average spend per day of the week.' }));
      requestAnimationFrame(() => Charts.bars(wrap, data,
        { color: U.colorOf('blue'), formatValue: fmtEUR }));
      return card;
    }
  }

  /* ---------------- Calendar heatmap ---------------- */

  function statsCalendar(root) {
    const y = ui.stats.y, m0 = ui.stats.m0;
    const r = U.monthRange(y, m0);
    const exp = DB.state.transactions.filter(
      (t) => t.type === 'expense' && t.date >= r.from && t.date <= r.to);
    const byDay = new Map();
    exp.forEach((t) => byDay.set(t.date, (byDay.get(t.date) || 0) + t.amount));
    const total = exp.reduce((s, t) => s + t.amount, 0);
    const D = new Date(y, m0 + 1, 0).getDate();
    const max = Math.max(0, ...byDay.values());
    const bud = DB.state.meta.budget;
    const dailyBase = bud && bud.amount ? bud.amount / D : 0;

    // Month navigation (calendar is inherently monthly)
    const nav = el('div', { class: 'month-nav' });
    const prev = el('button', { class: 'mn-btn', text: '‹' });
    const next = el('button', { class: 'mn-btn', text: '›' });
    prev.addEventListener('click', () => { statsShiftMonth(-1); });
    next.addEventListener('click', () => { statsShiftMonth(1); });
    nav.append(prev, el('div', { class: 'mn-label', text: U.monthLabel(y, m0) }), next);
    root.append(nav);

    const card = el('div', { class: 'card' }, [
      el('div', { class: 'card-head' }, [
        el('h2', { text: 'Spending calendar' }),
        el('span', { class: 'muted', text: fmtEUR(total) })
      ])
    ]);

    // Weekday headers (Monday-first, Italian)
    const dow = el('div', { class: 'cal-grid cal-dow' });
    ['L', 'M', 'M', 'G', 'V', 'S', 'D'].forEach((d) => dow.append(el('div', { text: d })));
    card.append(dow);

    const grid = el('div', { class: 'cal-grid' });
    const firstDow = (new Date(y, m0, 1).getDay() + 6) % 7;   // 0 = Monday
    for (let i = 0; i < firstDow; i++) grid.append(el('div', { class: 'cal-cell empty' }));
    const today = U.todayISO();
    for (let d = 1; d <= D; d++) {
      const iso = y + '-' + String(m0 + 1).padStart(2, '0') + '-' + String(d).padStart(2, '0');
      const v = byDay.get(iso) || 0;
      // Sequential single-hue ramp: light (near zero) -> dark (heaviest day)
      const ratio = max > 0 ? v / max : 0;
      const cell = el('button', {
        class: 'cal-cell' + (v > 0 ? ' has' : '') +
          (dailyBase && v > dailyBase ? ' over' : '') + (iso === today ? ' today' : ''),
        onclick: () => openDayDetail(iso)
      }, [
        el('span', { class: 'cal-day', text: String(d) }),
        v > 0 ? el('span', { class: 'cal-amt', text: v >= 100 ? Math.round(v) : v.toFixed(0) }) : null
      ]);
      if (v > 0) {
        const alpha = 0.15 + ratio * 0.75;
        cell.style.background = U.colorOf('blue') +
          Math.round(alpha * 255).toString(16).padStart(2, '0');
      }
      grid.append(cell);
    }
    card.append(grid);
    card.append(el('div', { class: 'cal-legend muted' }, [
      el('span', { text: 'Less' }),
      el('span', { class: 'cal-scale' }),
      el('span', { text: 'More' }),
      dailyBase ? el('span', { class: 'cal-over-key', text: '□ over ' + fmtEUR(dailyBase) }) : null
    ]));
    root.append(card);

    // Quick stats for the month
    const daysWith = byDay.size;
    const busiest = [...byDay.entries()].sort((a, b) => b[1] - a[1])[0];
    root.append(el('div', { class: 'tiles' }, [
      el('div', { class: 'tile' }, [
        el('div', { class: 't-label', text: 'Days with spending' }),
        el('div', { class: 't-value', style: 'font-size:1.2rem', text: daysWith + ' / ' + D })
      ]),
      el('div', { class: 'tile' }, [
        el('div', { class: 't-label', text: 'No-spend days' }),
        el('div', { class: 't-value pos', style: 'font-size:1.2rem', text: String(D - daysWith) })
      ]),
      busiest ? el('button', { class: 'tile tile-btn wide', onclick: () => openDayDetail(busiest[0]) }, [
        el('div', { class: 't-label', text: 'Busiest day ›' }),
        el('div', { class: 't-value', style: 'font-size:1.2rem',
          text: U.fmtDate(busiest[0]) + ' · ' + fmtEUR(busiest[1]) })
      ]) : null
    ]));
  }

  function statsShiftMonth(delta) {
    const d = new Date(ui.stats.y, ui.stats.m0 + delta, 1);
    ui.stats.y = d.getFullYear(); ui.stats.m0 = d.getMonth();
    renderStats();
  }

  function openDayDetail(iso) {
    const txs = DB.state.transactions.filter((t) => t.date === iso)
      .sort((a, b) => b.amount - a.amount);
    const spent = txs.filter((t) => t.type === 'expense').reduce((s, t) => s + t.amount, 0);
    openSheet(U.fmtDate(iso, { weekday: 'long', day: 'numeric', month: 'long' }), (body) => {
      body.append(el('div', { class: 'cat-detail-head' }, [
        el('div', { class: 'cat-detail-total', text: fmtEUR(spent) }),
        el('div', { class: 'muted', text: txs.length + ' transaction' + (txs.length === 1 ? '' : 's') })
      ]));
      if (!txs.length) {
        body.append(el('div', { class: 'empty', html: '<span class="big">🌤</span>No spending — nice' }));
        return;
      }
      txs.forEach((t) => {
        const c = DB.category(t.categoryId);
        body.append(el('button', { class: 'cat-tx', onclick: () => openTxSheet(t) }, [
          el('div', { class: 'cat-tx-main' }, [
            el('div', { class: 'cat-tx-note', text: t.note || 'Transaction' }),
            el('div', { class: 'cat-tx-sub', text: c ? c.icon + ' ' + c.name : '—' })
          ]),
          el('div', { class: 'cat-tx-amt' + (t.type === 'income' ? ' pos' : ''),
            text: (t.type === 'income' ? '+ ' : '− ') + fmtEUR(t.amount) })
        ]));
      });
    });
  }

  /* ---------------- Merchants + subscription radar ---------------- */

  function statsMerchants(root, rg, txs) {
    root.append(subscriptionCard());

    const expenses = txs.filter((t) => t.type === 'expense');
    const groups = groupByMerchant(expenses);
    const card = el('div', { class: 'card' }, [
      el('div', { class: 'card-head' }, [
        el('h2', { text: 'Top places' }),
        el('span', { class: 'muted', text: groups.length + ' total' })
      ])
    ]);
    const search = el('input', { class: 'searchbox', type: 'search',
      placeholder: 'Search a place…', value: ui.stats.merchantQuery });
    const listWrap = el('div');
    const draw = () => {
      const q = ui.stats.merchantQuery.trim().toLowerCase();
      const shown = groups.filter((g) => !q || g.label.toLowerCase().includes(q) ||
        g.key.toLowerCase().includes(q));
      listWrap.innerHTML = '';
      if (!shown.length) {
        listWrap.append(el('div', { class: 'empty', html: '<span class="big">🔍</span>No places match' }));
        return;
      }
      const maxV = shown[0].total;
      shown.slice(0, 40).forEach((g) => {
        listWrap.append(el('button', { class: 'catbar', onclick: () => openMerchantDetail(g, rg) }, [
          el('div', { class: 'catbar-main' }, [
            el('div', { class: 'catbar-top' }, [
              el('span', { class: 'catbar-name', text: g.label }),
              el('span', { class: 'catbar-val', text: fmtEUR(g.total) })
            ]),
            el('div', { class: 'catbar-track' }, [
              el('div', { class: 'catbar-fill', style: 'width:' +
                (maxV > 0 ? (g.total / maxV) * 100 : 0) + '%;background:' + U.colorOf('blue') })
            ])
          ]),
          el('span', { class: 'catbar-pct', text: g.count + '×' }),
          el('span', { class: 'catbar-chev', text: '›' })
        ]));
      });
    };
    let deb;
    search.addEventListener('input', () => {
      clearTimeout(deb);
      deb = setTimeout(() => { ui.stats.merchantQuery = search.value; draw(); }, 120);
    });
    draw();
    card.append(search, listWrap);
    root.append(card);
  }

  function openMerchantDetail(g, rg) {
    const avg = g.count ? g.total / g.count : 0;
    const biggest = g.txs.reduce((mx, t) => (!mx || t.amount > mx.amount ? t : mx), null);
    // Lifetime figures, not just the selected period
    const lifetime = groupByMerchant(
      DB.state.transactions.filter((t) => t.type === 'expense' && merchantKey(t.note) === g.key));
    const life = lifetime[0] || { total: 0, count: 0 };
    openSheet(g.label, (body) => {
      body.append(el('div', { class: 'cat-detail-head' }, [
        el('div', { class: 'cat-detail-total', text: fmtEUR(g.total) }),
        el('div', { class: 'muted', text: (rg.label || 'Period') + ' · ' + g.count +
          (g.count === 1 ? ' visit' : ' visits') })
      ]));
      body.append(el('div', { class: 'cat-detail-stats' }, [
        el('div', { class: 'tile' }, [
          el('div', { class: 't-label', text: 'Average' }),
          el('div', { class: 't-value', style: 'font-size:1.1rem', text: fmtEUR(avg) })
        ]),
        biggest ? el('button', { class: 'tile tile-btn', onclick: () => openTxSheet(biggest) }, [
          el('div', { class: 't-label', text: 'Biggest ›' }),
          el('div', { class: 't-value', style: 'font-size:1.1rem', text: fmtEUR(biggest.amount) })
        ]) : null
      ]));
      body.append(el('p', { class: 'muted', style: 'margin:10px 0', text:
        'All time: ' + fmtEUR(life.total) + ' across ' + life.count +
        (life.count === 1 ? ' visit' : ' visits') }));
      g.txs.forEach((t) => {
        body.append(el('button', { class: 'cat-tx', onclick: () => openTxSheet(t) }, [
          el('div', { class: 'cat-tx-main' }, [
            el('div', { class: 'cat-tx-note', text: t.note || g.label }),
            el('div', { class: 'cat-tx-sub', text: U.fmtDate(t.date) })
          ]),
          el('div', { class: 'cat-tx-amt', text: '− ' + fmtEUR(t.amount) })
        ]));
      });
    }, { tall: true });
  }

  /* ---- Subscription radar: suggest, never assume ----
     A candidate needs >= 3 charges from the same place, spaced ~monthly
     (median gap 25-35 days) with a stable amount. Nothing counts as a
     subscription until confirmed; dismissed merchants never come back. */

  const subsMeta = () =>
    Object.assign({ confirmed: {}, dismissed: [] }, DB.state.meta.subscriptions || {});

  function median(nums) {
    const a = [...nums].sort((x, y) => x - y);
    if (!a.length) return 0;
    const mid = a.length >> 1;
    return a.length % 2 ? a[mid] : (a[mid - 1] + a[mid]) / 2;
  }

  function detectSubscriptions() {
    const expenses = DB.state.transactions.filter((t) => t.type === 'expense');
    const out = [];
    for (const g of groupByMerchant(expenses)) {
      // 3+ charges is the confident case; exactly 2 counts only when the amount
      // is identical to the cent (a strong subscription signal on short history).
      const amountsAll = g.txs.map((t) => t.amount);
      const identical = amountsAll.every((a) => Math.abs(a - amountsAll[0]) < 0.005);
      if (g.count < 2 || (g.count === 2 && !identical)) continue;
      const dates = g.txs.map((t) => t.date).sort();
      const gaps = [];
      for (let i = 1; i < dates.length; i++) {
        gaps.push((new Date(dates[i]) - new Date(dates[i - 1])) / 86400000);
      }
      const gap = median(gaps);
      if (gap < 25 || gap > 35) continue;                    // monthly cadence only
      const amounts = g.txs.map((t) => t.amount);
      const amt = median(amounts);
      // Amounts must be stable (ignoring a possible price change at the end)
      const spread = Math.max(...amounts) - Math.min(...amounts);
      if (amt > 0 && spread / amt > 0.35) continue;
      const sorted = [...g.txs].sort((a, b) => a.date.localeCompare(b.date));
      const lastTx = sorted[sorted.length - 1];
      const prevAmts = sorted.slice(0, -1).map((t) => t.amount);
      const prevAmt = median(prevAmts);
      const nextDue = new Date(new Date(lastTx.date).getTime() + gap * 86400000);
      out.push({
        key: g.key, label: g.label, amount: lastTx.amount, typical: amt,
        count: g.count, gap: Math.round(gap), lastDate: lastTx.date,
        nextDue: isoOf(nextDue), dates,
        priceChanged: prevAmts.length >= 2 && Math.abs(lastTx.amount - prevAmt) > 0.01
          ? { from: prevAmt, to: lastTx.amount } : null,
        missing: (Date.now() - new Date(lastTx.date)) / 86400000 > gap + 10
      });
    }
    return out.sort((a, b) => b.amount - a.amount);
  }

  function subscriptionCard() {
    const meta = subsMeta();
    const found = detectSubscriptions();
    const confirmed = found.filter((s) => meta.confirmed[s.key]);
    const suggestions = found.filter((s) => !meta.confirmed[s.key] && !meta.dismissed.includes(s.key));
    const monthly = confirmed.reduce((s, x) => s + x.amount, 0);

    const card = el('div', { class: 'card' }, [
      el('div', { class: 'card-head' }, [
        el('h2', { text: 'Recurring' }),
        confirmed.length ? el('span', { class: 'muted', text: fmtEUR(monthly) + ' / month' }) : null
      ])
    ]);

    if (!confirmed.length && !suggestions.length) {
      card.append(el('div', { class: 'empty', html:
        '<span class="big">🔁</span>No monthly patterns spotted yet' }));
      return card;
    }

    confirmed.forEach((s) => {
      const alerts = [];
      if (s.priceChanged) {
        alerts.push((s.priceChanged.to > s.priceChanged.from ? '▲ up from ' : '▼ down from ') +
          fmtEUR(s.priceChanged.from));
      }
      if (s.missing) alerts.push('not charged since ' + U.fmtDate(s.lastDate));
      card.append(el('button', { class: 'sub-row', onclick: () => openSubscriptionSheet(s) }, [
        el('div', { class: 'sub-main' }, [
          el('div', { class: 'sub-name', text: s.label }),
          el('div', { class: 'sub-sub' + (alerts.length ? ' warn' : ''), text: alerts.length
            ? alerts.join(' · ')
            : 'next ~' + U.fmtDate(s.nextDue, { day: 'numeric', month: 'short' }) })
        ]),
        el('div', { class: 'sub-amt', text: fmtEUR(s.amount) }),
        el('span', { class: 's-chev', text: '›' })
      ]));
    });

    if (suggestions.length) {
      card.append(el('div', { class: 'sub-title', style: 'margin-top:14px',
        text: 'Looks recurring — confirm?' }));
      suggestions.forEach((s) => {
        card.append(el('div', { class: 'sub-suggest' }, [
          el('div', { class: 'sub-main' }, [
            el('div', { class: 'sub-name', text: s.label }),
            el('div', { class: 'sub-sub', text: fmtEUR(s.amount) + ' · every ~' + s.gap +
              ' days · ' + s.count + ' charges' })
          ]),
          el('button', { class: 'btn small', text: 'Not this', onclick: async () => {
            const m = subsMeta();
            m.dismissed = [...new Set([...m.dismissed, s.key])];
            await DB.setMeta('subscriptions', m);
            renderStats();
          } }),
          el('button', { class: 'btn small primary', text: 'Yes', onclick: async () => {
            const m = subsMeta();
            m.confirmed = Object.assign({}, m.confirmed, { [s.key]: { label: s.label } });
            await DB.setMeta('subscriptions', m);
            renderStats();
          } })
        ]));
      });
    }
    return card;
  }

  function openSubscriptionSheet(s) {
    openSheet(s.label, (body, api) => {
      body.append(el('div', { class: 'cat-detail-head' }, [
        el('div', { class: 'cat-detail-total', text: fmtEUR(s.amount) }),
        el('div', { class: 'muted', text: 'every ~' + s.gap + ' days · ' + s.count + ' charges' })
      ]));
      if (s.priceChanged) {
        body.append(el('div', { class: 'banner' }, [
          el('span', { text: '⚠️', style: 'font-size:1.3rem' }),
          el('div', { class: 'b-main', html: '<strong>Price changed</strong>' +
            'From ' + esc(fmtEUR(s.priceChanged.from)) + ' to ' + esc(fmtEUR(s.priceChanged.to)) + '.' })
        ]));
      }
      if (s.missing) {
        body.append(el('div', { class: 'banner' }, [
          el('span', { text: '🛑', style: 'font-size:1.3rem' }),
          el('div', { class: 'b-main', html: '<strong>Possibly cancelled</strong>' +
            'Expected around ' + esc(U.fmtDate(s.nextDue)) + ' but nothing charged yet.' })
        ]));
      }
      const txs = DB.state.transactions
        .filter((t) => t.type === 'expense' && merchantKey(t.note) === s.key)
        .sort((a, b) => b.date.localeCompare(a.date));
      txs.forEach((t) => {
        body.append(el('button', { class: 'cat-tx', onclick: () => openTxSheet(t) }, [
          el('div', { class: 'cat-tx-main' }, [
            el('div', { class: 'cat-tx-note', text: t.note }),
            el('div', { class: 'cat-tx-sub', text: U.fmtDate(t.date) })
          ]),
          el('div', { class: 'cat-tx-amt', text: '− ' + fmtEUR(t.amount) })
        ]));
      });
      body.append(el('div', { class: 'spacer' }),
        el('button', { class: 'btn block ghost', text: 'Not a subscription', onclick: async () => {
          const m = subsMeta();
          delete m.confirmed[s.key];
          m.dismissed = [...new Set([...m.dismissed, s.key])];
          await DB.setMeta('subscriptions', m);
          api.close(); renderStats();
        } }));
    }, { tall: true });
  }

  /* ---------------- Trips ----------------
     A trip is a named date range. Detection looks for a burst of places you
     don't normally go: >= 3 charges over 2-14 consecutive days where most
     merchants were never seen in the 120 days before. Always a suggestion. */

  const trips = () => (DB.state.meta.trips || []).slice()
    .sort((a, b) => b.from.localeCompare(a.from));

  function tripTotals(trip) {
    const txs = DB.state.transactions.filter(
      (t) => t.date >= trip.from && t.date <= trip.to);
    const spent = txs.filter((t) => t.type === 'expense').reduce((s, t) => s + t.amount, 0);
    const days = Math.round((new Date(trip.to) - new Date(trip.from)) / 86400000) + 1;
    return { txs, spent, days, perDay: days ? spent / days : 0 };
  }

  function detectTrips() {
    const expenses = DB.state.transactions
      .filter((t) => t.type === 'expense').sort((a, b) => a.date.localeCompare(b.date));
    if (expenses.length < 5) return [];
    const existing = DB.state.meta.trips || [];
    const dismissed = DB.state.meta.tripsDismissed || [];
    const seenBefore = (key, date) => expenses.some((t) => {
      if (t.date >= date) return false;
      const age = (new Date(date) - new Date(t.date)) / 86400000;
      return age <= 120 && merchantKey(t.note) === key;
    });

    // Mark days dominated by unfamiliar places
    const byDay = new Map();
    expenses.forEach((t) => {
      if (!byDay.has(t.date)) byDay.set(t.date, []);
      byDay.get(t.date).push(t);
    });
    const oddDays = [...byDay.entries()].filter(([date, txs]) => {
      const keys = [...new Set(txs.map((t) => merchantKey(t.note)))];
      const unfamiliar = keys.filter((k) => !seenBefore(k, date));
      return keys.length > 0 && unfamiliar.length / keys.length >= 0.6;
    }).map(([date]) => date).sort();

    // Group consecutive-ish odd days (allowing a 1-day gap) into runs
    const runs = [];
    let cur = null;
    oddDays.forEach((d) => {
      if (cur && (new Date(d) - new Date(cur.to)) / 86400000 <= 2) cur.to = d;
      else { cur = { from: d, to: d }; runs.push(cur); }
    });

    return runs.filter((run) => {
      const span = (new Date(run.to) - new Date(run.from)) / 86400000 + 1;
      if (span < 2 || span > 14) return false;
      const txs = expenses.filter((t) => t.date >= run.from && t.date <= run.to);
      if (txs.length < 3) return false;
      const id = run.from + '_' + run.to;
      if (dismissed.includes(id)) return false;
      // Skip anything already covered by a saved trip
      if (existing.some((tr) => run.from <= tr.to && run.to >= tr.from)) return false;
      return true;
    }).map((run) => {
      const txs = expenses.filter((t) => t.date >= run.from && t.date <= run.to);
      return {
        id: run.from + '_' + run.to, from: run.from, to: run.to,
        spent: txs.reduce((s, t) => s + t.amount, 0), count: txs.length,
        places: [...new Set(txs.map((t) => merchantKey(t.note)))].slice(0, 3)
      };
    }).sort((a, b) => b.from.localeCompare(a.from));
  }

  function statsTrips(root) {
    const saved = trips();
    const suggestions = detectTrips();

    if (suggestions.length) {
      const sCard = el('div', { class: 'card' }, [
        el('div', { class: 'card-head' }, [el('h2', { text: 'Looks like a trip' })])
      ]);
      suggestions.forEach((s) => {
        sCard.append(el('div', { class: 'sub-suggest' }, [
          el('div', { class: 'sub-main' }, [
            el('div', { class: 'sub-name', text:
              U.fmtDate(s.from, { day: 'numeric', month: 'short' }) + ' – ' +
              U.fmtDate(s.to, { day: 'numeric', month: 'short' }) }),
            el('div', { class: 'sub-sub', text:
              fmtEUR(s.spent) + ' · ' + s.count + ' transactions · ' + s.places.join(', ') })
          ]),
          el('button', { class: 'btn small', text: 'No', onclick: async () => {
            const d = DB.state.meta.tripsDismissed || [];
            await DB.setMeta('tripsDismissed', [...new Set([...d, s.id])]);
            renderStats();
          } }),
          el('button', { class: 'btn small primary', text: 'Save', onclick: () =>
            openTripSheet({ from: s.from, to: s.to, name: '' }) })
        ]));
      });
      root.append(sCard);
    }

    const card = el('div', { class: 'card' }, [
      el('div', { class: 'card-head' }, [
        el('h2', { text: 'Trips' }),
        el('button', { class: 'btn small', text: '+ New', onclick: () => openTripSheet(null) })
      ])
    ]);
    if (!saved.length) {
      card.append(el('div', { class: 'empty', html:
        '<span class="big">✈️</span>No trips yet — save one to track a holiday separately' }));
    } else {
      saved.forEach((tr) => {
        const t = tripTotals(tr);
        card.append(el('button', { class: 'trip-row', onclick: () => openTripDetail(tr) }, [
          el('span', { class: 'trip-emoji', text: tr.emoji || '✈️' }),
          el('div', { class: 'trip-main' }, [
            el('div', { class: 'trip-name', text: tr.name }),
            el('div', { class: 'trip-sub', text:
              U.fmtDate(tr.from, { day: 'numeric', month: 'short' }) + ' – ' +
              U.fmtDate(tr.to, { day: 'numeric', month: 'short', year: 'numeric' }) +
              ' · ' + t.days + ' days' })
          ]),
          el('div', { class: 'trip-right' }, [
            el('div', { class: 'trip-amt', text: fmtTripMoney(tr, t.spent) }),
            tr.budget ? el('div', { class: 'trip-bud ' +
              (t.spent > tr.budget ? 'neg' : 'muted'),
              text: 'of ' + fmtTripMoney(tr, tr.budget) }) : null
          ]),
          el('span', { class: 's-chev', text: '›' })
        ]));
      });
      const grand = saved.reduce((s, tr) => s + tripTotals(tr).spent, 0);
      card.append(el('p', { class: 'muted', style: 'margin-top:10px;text-align:right', text:
        'Total across trips: ' + fmtEUR(grand) }));
    }
    root.append(card);
  }

  function openTripSheet(preset) {
    const existing = preset && preset.id ? preset : null;
    const draft = Object.assign({ id: null, name: '', emoji: '✈️', from: U.todayISO(),
      to: U.todayISO() }, preset || {});
    openSheet(existing ? 'Edit trip' : 'New trip', (body, api) => {
      const name = el('input', { type: 'text', placeholder: 'e.g. Lyon', value: draft.name });
      const from = el('input', { type: 'date', value: draft.from });
      const to = el('input', { type: 'date', value: draft.to });
      const emojiWrap = el('div', { class: 'emoji-grid' });
      const EMOJIS = ['✈️', '🚆', '🏖️', '⛰️', '🏙️', '🎪', '🎿', '🚗'];
      const drawEmoji = () => {
        emojiWrap.innerHTML = '';
        EMOJIS.forEach((e) => emojiWrap.append(el('button', {
          class: draft.emoji === e ? 'active' : '', text: e,
          onclick: () => { draft.emoji = e; drawEmoji(); }
        })));
      };
      drawEmoji();
      const budget = el('input', { type: 'text', inputmode: 'decimal', placeholder: 'No budget',
        value: draft.budget ? String(draft.budget).replace('.', ',') : '' });
      const cur = el('input', { type: 'text', placeholder: 'EUR', maxlength: '3',
        autocapitalize: 'characters', value: draft.currency || '' });
      // Rates can be entered either way round — "1 € = 38 TL" is much easier to
      // read off a board than "1 TL = 0,0263 €", and both store the same number.
      let rateMode = draft.rateMode || 'perEur';
      const rate = el('input', { type: 'text', inputmode: 'decimal', placeholder: '0',
        value: draft.rate
          ? String(rateMode === 'perEur'
              ? Math.round((1 / draft.rate) * 1e6) / 1e6 : draft.rate).replace('.', ',')
          : '' });
      const dirSeg = el('div', { class: 'seg', style: 'margin-bottom:8px' });
      const bPerEur = el('button', {});
      const bPerUnit = el('button', {});
      const rateHint = el('div', { class: 'note-suggest' });
      const rateLabel = el('label', { text: 'Exchange rate' });

      const canonicalRate = () => {
        const v = U.parseRate(rate.value);
        if (!v) return null;
        return rateMode === 'perEur' ? 1 / v : v;   // stored as € per unit
      };
      const syncRate = () => {
        const code = (cur.value || '').toUpperCase().trim() || 'XXX';
        bPerEur.textContent = '1 € = ? ' + code;
        bPerUnit.textContent = '1 ' + code + ' = ? €';
        bPerEur.className = rateMode === 'perEur' ? 'active' : '';
        bPerUnit.className = rateMode === 'perUnit' ? 'active' : '';
        const r = canonicalRate();
        rateHint.textContent = r
          ? '100 ' + code + ' ≈ ' + fmtEUR(100 * r) + '  ·  10 € ≈ ' +
            U.fmtCur(10 / r, code === 'XXX' ? null : code)
          : 'Enter the rate you see on the board.';
      };
      bPerEur.addEventListener('click', () => {
        const r = canonicalRate();
        rateMode = 'perEur';
        if (r) rate.value = String(Math.round((1 / r) * 1e6) / 1e6).replace('.', ',');
        syncRate();
      });
      bPerUnit.addEventListener('click', () => {
        const r = canonicalRate();
        rateMode = 'perUnit';
        if (r) rate.value = String(Math.round(r * 1e6) / 1e6).replace('.', ',');
        syncRate();
      });
      dirSeg.append(bPerEur, bPerUnit);
      cur.addEventListener('input', syncRate);
      rate.addEventListener('input', syncRate);
      syncRate();
      const preview = el('p', { class: 'muted', style: 'margin-bottom:12px' });
      const updatePreview = () => {
        const t = tripTotals({ from: from.value, to: to.value });
        preview.textContent = t.txs.length + ' transactions in range · ' + fmtEUR(t.spent);
      };
      from.addEventListener('change', updatePreview);
      to.addEventListener('change', updatePreview);
      updatePreview();

      body.append(
        el('div', { class: 'field' }, [el('label', { text: 'Name' }), name]),
        el('div', { class: 'field' }, [el('label', { text: 'Icon' }), emojiWrap]),
        el('div', { class: 'field-row' }, [
          el('div', { class: 'field' }, [el('label', { text: 'From' }), from]),
          el('div', { class: 'field' }, [el('label', { text: 'To' }), to])
        ]),
        el('div', { class: 'field' }, [el('label', { text: 'Currency' }), cur]),
        el('div', { class: 'field' }, [rateLabel, dirSeg, rate, rateHint]),
        el('div', { class: 'field' }, [
          el('label', { text: 'Trip budget (€, optional)' }), budget,
          el('div', { class: 'note-suggest', text:
            'With a budget set, this trip spends from its own pot instead of your monthly ' +
            'budget. Subscriptions charged during the trip still count as normal.' })
        ]),
        preview,
        el('button', { class: 'btn block primary', text: existing ? 'Save changes' : 'Save trip',
          onclick: async () => {
            if (!name.value.trim()) return toast('Name the trip');
            if (!from.value || !to.value || from.value > to.value) return toast('Invalid dates');
            const list = (DB.state.meta.trips || []).filter((x) => x.id !== draft.id);
            const bud = CSV.parseAmount(budget.value);
            const code = (cur.value || '').toUpperCase().trim();
            const rt = canonicalRate();
            if (code && code !== 'EUR' && (!rt || rt <= 0)) {
              return toast('Enter the rate for ' + code);
            }
            const saved = {
              id: draft.id || U.uid(), name: name.value.trim(), emoji: draft.emoji,
              from: from.value, to: to.value,
              budget: bud != null && bud > 0 ? Math.round(bud * 100) / 100 : null,
              currency: code && code !== 'EUR' ? code : null,
              rate: code && code !== 'EUR' ? rt : null,
              rateMode
            };
            list.push(saved);
            await DB.setMeta('trips', list);
            const rateChanged = existing && existing.rate && saved.rate &&
              Math.abs(existing.rate - saved.rate) > 1e-9;
            api.close();
            if (rateChanged) await offerRecompute(saved);
            toast('Trip saved'); renderStats();
          } })
      );
      if (existing) {
        body.append(el('div', { class: 'spacer' }),
          el('button', { class: 'btn block danger', text: 'Delete trip', onclick: async () => {
            const list = (DB.state.meta.trips || []).filter((x) => x.id !== draft.id);
            await DB.setMeta('trips', list);
            api.close(); toast('Trip deleted'); renderStats();
          } }));
      }
    });
  }

  /** After changing a trip's rate, re-convert the amounts entered in that currency. */
  async function offerRecompute(trip) {
    const affected = DB.state.transactions.filter(
      (t) => t.origCurrency === trip.currency && t.date >= trip.from && t.date <= trip.to);
    if (!affected.length) return;
    const ok = await confirmSheet(
      `Recalculate ${affected.length} transaction${affected.length === 1 ? '' : 's'} entered in ` +
      `${trip.currency} at the new rate (1 ${trip.currency} = ${fmtEUR(trip.rate)})?`,
      'Recalculate', false);
    if (!ok) return;
    const upd = affected.map((t) => ({
      ...t, rate: trip.rate, amount: Math.round(t.origAmount * trip.rate * 100) / 100
    }));
    await DB.bulkPut('transactions', upd);
    await bumpChanges(upd.length);
    toast(upd.length + ' amounts updated');
    render();
  }

  function openTripDetail(trip) {
    const t = tripTotals(trip);
    const groups = groupByMerchant(t.txs.filter((x) => x.type === 'expense'));
    openSheet((trip.emoji || '✈️') + ' ' + trip.name, (body) => {
      body.append(el('div', { class: 'cat-detail-head' }, [
        el('div', { class: 'cat-detail-total', text: fmtTripMoney(trip, t.spent) }),
        el('div', { class: 'muted', text:
          (tripHasFx(trip) ? '≈ ' + fmtEUR(t.spent) + ' · ' : '') +
          t.days + ' days · ' + fmtTripMoney(trip, t.perDay) + ' per day' })
      ]));
      const tb = tripBudgetStatus(trip);
      if (tb) {
        body.append(el('div', { class: 'catbudget' }, [
          el('div', { class: 'budget-line' }, [
            el('span', { text: 'Trip budget' }),
            el('span', { class: tb.over ? 'neg' : 'pos',
              text: fmtTripMoney(trip, tb.spent) + ' / ' + fmtTripMoney(trip, tb.budget) })
          ]),
          meter(tb.spent, tb.budget),
          el('div', { class: 'muted', style: 'margin-top:6px', text: tb.over
            ? fmtTripBoth(trip, -tb.remaining) + ' over'
            : fmtTripBoth(trip, tb.remaining) + ' left' + (tb.active && tb.daysLeft
                ? ' · ' + fmtTripMoney(trip, tb.todayAllowance) + ' for today' : '') })
        ]));
      }
      body.append(el('button', { class: 'btn block ghost', style: 'margin-bottom:12px',
        text: 'Edit trip', onclick: () => openTripSheet(trip) }));
      if (trip.currency && trip.rate) {
        body.append(el('p', { class: 'muted', style: 'margin-bottom:10px', text:
          'Amounts converted at 1 ' + trip.currency + ' = ' + fmtEUR(trip.rate) +
          ' · ' + U.fmtCur(t.spent / trip.rate, trip.currency) + ' spent locally' }));
      }
      groups.forEach((g) => {
        body.append(el('div', { class: 'place-row', style: 'pointer-events:none' }, [
          el('div', { class: 'place-main' }, [
            el('div', { class: 'place-name', text: g.label }),
            el('div', { class: 'place-count', text: g.count + (g.count === 1 ? ' charge' : ' charges') })
          ]),
          el('div', { class: 'place-total', text: fmtEUR(g.total) })
        ]));
      });
    }, { tall: true });
  }

  /* ---------------- Period comparison ---------------- */

  function previousRange(rg) {
    if (ui.stats.range === 'month') {
      const d = new Date(ui.stats.y, ui.stats.m0 - 1, 1);
      const r = U.monthRange(d.getFullYear(), d.getMonth());
      return { from: r.from, to: r.to, label: U.monthLabel(d.getFullYear(), d.getMonth()) };
    }
    if (ui.stats.range === 'year') {
      const y = ui.stats.y - 1;
      return { from: y + '-01-01', to: y + '-12-31', label: String(y) };
    }
    // Custom / all: shift back by the same span
    const span = (new Date(rg.to) - new Date(rg.from)) / 86400000 + 1;
    const to = new Date(new Date(rg.from).getTime() - 86400000);
    const from = new Date(to.getTime() - (span - 1) * 86400000);
    return { from: isoOf(from), to: isoOf(to), label: 'previous ' + Math.round(span) + ' days' };
  }

  function comparisonCard(rg) {
    const prev = previousRange(rg);
    const curTx = DB.state.transactions.filter(
      (t) => t.type === 'expense' && t.date >= rg.from && t.date <= rg.to && countsInStats(t));
    const prevTx = DB.state.transactions.filter(
      (t) => t.type === 'expense' && t.date >= prev.from && t.date <= prev.to && countsInStats(t));
    if (!prevTx.length && !curTx.length) return null;
    const cur = curTx.reduce((s, t) => s + t.amount, 0);
    const old = prevTx.reduce((s, t) => s + t.amount, 0);
    const diff = cur - old;
    const pct = old > 0 ? Math.round((diff / old) * 100) : null;

    const byCat = (list) => {
      const m = new Map();
      list.forEach((t) => m.set(t.categoryId, (m.get(t.categoryId) || 0) + t.amount));
      return m;
    };
    const a = byCat(curTx), b = byCat(prevTx);
    const movers = [...new Set([...a.keys(), ...b.keys()])].map((id) => ({
      cat: DB.category(id), now: a.get(id) || 0, before: b.get(id) || 0,
      diff: (a.get(id) || 0) - (b.get(id) || 0)
    })).filter((m) => Math.abs(m.diff) >= 0.01)
      .sort((x, y) => Math.abs(y.diff) - Math.abs(x.diff)).slice(0, 5);

    const card = el('div', { class: 'card' }, [
      el('div', { class: 'card-head' }, [
        el('h2', { text: 'vs ' + prev.label }),
        el('span', { class: 'muted', text: fmtEUR(old) + ' → ' + fmtEUR(cur) })
      ]),
      el('div', { class: 'cmp-head' }, [
        el('span', { class: 'cmp-delta ' + (diff > 0 ? 'neg' : diff < 0 ? 'pos' : ''), text:
          (diff > 0 ? '+' : diff < 0 ? '−' : '') + fmtEUR(Math.abs(diff)) }),
        el('span', { class: 'muted', text: pct === null ? 'no comparison data'
          : (diff > 0 ? '+' : '') + pct + '% ' + (diff > 0 ? 'more spent' : 'less spent') })
      ])
    ]);
    if (movers.length) {
      card.append(el('div', { class: 'sub-title', style: 'margin-top:12px', text: 'Biggest changes' }));
      movers.forEach((m) => {
        card.append(el('div', { class: 'cmp-row' }, [
          el('span', { class: 'cmp-icon', text: m.cat ? m.cat.icon : '❓',
            style: 'background:' + U.tintOf(m.cat ? m.cat.color : 'blue') }),
          el('span', { class: 'cmp-name', text: m.cat ? m.cat.name : 'Uncategorized' }),
          el('span', { class: 'cmp-vals muted', text: fmtEUR(m.before) + ' → ' + fmtEUR(m.now) }),
          el('span', { class: 'cmp-diff ' + (m.diff > 0 ? 'neg' : 'pos'), text:
            (m.diff > 0 ? '+' : '−') + fmtEUR(Math.abs(m.diff)) })
        ]));
      });
    }
    return card;
  }

  function legendKey(color, label) {
    return el('span', { class: 'lg-key' }, [
      el('span', { class: 'dot', style: 'background:' + color }),
      el('span', { text: label })
    ]);
  }

  function openStatsRangeSheet() {
    openSheet('Period', (body, api) => {
      const pick = (val) => async () => {
        ui.stats.range = val;
        if (val === 'custom' && !ui.stats.from) {
          const r = U.monthRange(ui.stats.y, ui.stats.m0);
          ui.stats.from = r.from; ui.stats.to = r.to;
        }
        ui.stats.donutSel = null;
        api.close(); renderStats();
      };
      [['month', 'This month', 'One month at a time'],
       ['year', 'Year', 'A whole year, month by month'],
       ['all', 'All time', 'Everything you have recorded'],
       ['custom', 'Custom range', 'Pick your own dates']].forEach(([val, title, sub]) => {
        body.append(el('button', { class: 'pick-row', onclick: pick(val) }, [
          el('div', { class: 's-main' }, [
            el('div', { text: title }),
            el('div', { class: 's-sub', text: sub })
          ]),
          el('span', { class: 'pick-check', text: ui.stats.range === val ? '✓' : '' })
        ]));
      });
      if (ui.stats.range === 'custom') {
        const from = el('input', { type: 'date', value: ui.stats.from });
        const to = el('input', { type: 'date', value: ui.stats.to });
        const apply = () => {
          if (!from.value || !to.value || from.value > to.value) return;
          ui.stats.from = from.value; ui.stats.to = to.value;
          ui.stats.donutSel = null; renderStats();
        };
        from.addEventListener('change', apply);
        to.addEventListener('change', apply);
        body.append(el('hr', { class: 'sep' }), el('div', { class: 'field-row' }, [
          el('div', { class: 'field' }, [el('label', { text: 'From' }), from]),
          el('div', { class: 'field' }, [el('label', { text: 'To' }), to])
        ]));
      }
    });
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
      el('button', { class: 'btn small', text: 'Export CSV', onclick: () => exportCSV(list) })
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
        dayTotal = dayTxs.reduce((s, x) => s +
          (x.type === 'transfer' ? 0 : x.type === 'income' ? x.amount : -x.amount), 0);
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

  /** Category order for pickers: the last few you chose, then the most used.
      Keeps today's context at your fingertips without reshuffling constantly. */
  function orderedCategories() {
    const recent = DB.state.meta.recentCategories || [];
    const counts = new Map();
    DB.state.transactions.forEach((t) => {
      if (t.categoryId) counts.set(t.categoryId, (counts.get(t.categoryId) || 0) + 1);
    });
    const rest = DB.state.categories
      .filter((c) => !recent.includes(c.id))
      .sort((a, b) => (counts.get(b.id) || 0) - (counts.get(a.id) || 0));
    const head = recent.map((id) => DB.state.categories.find((c) => c.id === id)).filter(Boolean);
    return [...head, ...rest];
  }

  async function rememberCategoryPick(catId) {
    const prev = (DB.state.meta.recentCategories || []).filter((id) => id !== catId);
    await DB.setMeta('recentCategories', [catId, ...prev].slice(0, 4));
  }

  /** Most-repeated recent expenses, for the one-tap chips. */
  function frequentTransactions(limit) {
    const cutoff = new Date(Date.now() - 120 * 86400000).toISOString().slice(0, 10);
    const seen = new Map();
    for (const t of DB.state.transactions) {
      if (t.type !== 'expense' || t.date < cutoff || !t.note) continue;
      const key = merchantKey(t.note) + '|' + t.amount.toFixed(2);
      const hit = seen.get(key);
      if (hit) { hit.count++; if (t.date > hit.last) hit.last = t.date; }
      else seen.set(key, { count: 1, last: t.date, tx: t });
    }
    return [...seen.values()]
      .filter((x) => x.count >= 2)
      .sort((a, b) => b.count - a.count || b.last.localeCompare(a.last))
      .slice(0, limit || 5);
  }

  function openTxSheet(existing) {
    if (DB.state.accounts.length === 0) return toast('Create an account first');
    const draft = existing ? { ...existing } : {
      id: null, type: 'expense', amount: 0, date: U.todayISO(),
      categoryId: '', accountId: DB.state.accounts[0].id, note: ''
    };
    let manualCat = !!existing; // don't auto-override an existing/manual choice

    openSheet(existing ? 'Edit transaction' : 'New transaction', (body, api) => {
      // Type toggle — transfers move money between accounts, so they are neither
      // income nor expense and never appear in spending stats.
      const seg = el('div', { class: 'seg' });
      const bExp = el('button', { text: 'Expense' });
      const bInc = el('button', { text: 'Income' });
      const bTrf = el('button', { text: 'Transfer' });
      const syncSeg = () => {
        bExp.className = draft.type === 'expense' ? 'active exp' : '';
        bInc.className = draft.type === 'income' ? 'active inc' : '';
        bTrf.className = draft.type === 'transfer' ? 'active' : '';
        const isTrf = draft.type === 'transfer';
        catField.style.display = isTrf ? 'none' : '';
        noteField.querySelector('label').textContent = isTrf ? 'Note (optional)' : 'Note';
        acctLabel.textContent = isTrf ? 'From account' : 'Account';
        toField.style.display = isTrf ? '' : 'none';
        if (isTrf) drawToAccts();
      };
      bExp.addEventListener('click', () => { draft.type = 'expense'; syncSeg(); });
      bInc.addEventListener('click', () => { draft.type = 'income'; syncSeg(); });
      bTrf.addEventListener('click', () => {
        draft.type = 'transfer';
        if (!draft.toAccountId || draft.toAccountId === draft.accountId) {
          const other = DB.state.accounts.find((a) => a.id !== draft.accountId);
          draft.toAccountId = other ? other.id : null;
        }
        syncSeg();
      });
      if (DB.state.accounts.length > 1) seg.append(bExp, bInc, bTrf);
      else seg.append(bExp, bInc);

      // Amount
      const amount = el('input', {
        type: 'text', inputmode: 'decimal', placeholder: '0,00', autocomplete: 'off',
        value: existing ? existing.amount.toFixed(2).replace('.', ',') : ''
      });
      // While inside a foreign-currency trip, type the price as it appears locally
      const fxTrip = existing
        ? (tripForDate(existing.date) || null)
        : activeTrip();
      const fx = fxTrip && fxTrip.currency && fxTrip.rate ? fxTrip : null;
      let useLocal = !!fx && (!existing || existing.origCurrency === fx.currency);
      if (existing && existing.origAmount && useLocal) {
        amount.value = String(existing.origAmount).replace('.', ',');
      }
      const curLabel = el('span', { class: 'cur', text: useLocal ? fx.currency : '€' });
      const amountWrap = el('div', { class: 'amount-wrap' }, [curLabel, amount]);
      const fxLine = el('div', { class: 'fx-line muted' });
      const syncFx = () => {
        if (!fx) { fxLine.textContent = ''; return; }
        const v = CSV.parseAmount(amount.value) || 0;
        curLabel.textContent = useLocal ? fx.currency : '€';
        fxLine.innerHTML = '';
        fxLine.append(
          el('span', { text: useLocal
            ? '≈ ' + fmtEUR(v * fx.rate) + '  (1 ' + fx.currency + ' = ' + fmtEUR(fx.rate) + ')'
            : 'Entering euro directly' }),
          el('button', { class: 'btn small ghost', text: useLocal ? 'Use €' : 'Use ' + fx.currency,
            onclick: () => { useLocal = !useLocal; syncFx(); } })
        );
      };
      amount.addEventListener('input', syncFx);
      syncFx();

      // Date
      const date = el('input', { type: 'date', value: draft.date });
      date.addEventListener('change', () => { draft.date = date.value; });

      // Account chips (source account; also the "from" side of a transfer)
      const acctChips = el('div', { class: 'chips scroll' });
      const drawAccts = () => {
        acctChips.innerHTML = '';
        DB.state.accounts.forEach((a) => {
          acctChips.append(el('button', {
            class: 'chip' + (draft.accountId === a.id ? ' active' : ''),
            onclick: () => {
              draft.accountId = a.id;
              if (draft.type === 'transfer' && draft.toAccountId === a.id) {
                const other = DB.state.accounts.find((x) => x.id !== a.id);
                draft.toAccountId = other ? other.id : null;
                drawToAccts();
              }
              drawAccts();
            }
          }, [el('span', { text: acctIcon(a.type) }), el('span', { text: a.name })]));
        });
      };
      drawAccts();

      // Destination account (transfers only)
      const toChips = el('div', { class: 'chips scroll' });
      const drawToAccts = () => {
        toChips.innerHTML = '';
        DB.state.accounts.filter((a) => a.id !== draft.accountId).forEach((a) => {
          toChips.append(el('button', {
            class: 'chip' + (draft.toAccountId === a.id ? ' active' : ''),
            onclick: () => { draft.toAccountId = a.id; drawToAccts(); }
          }, [el('span', { text: acctIcon(a.type) }), el('span', { text: a.name })]));
        });
      };

      // Category chips — recently picked first, then most used
      const catChips = el('div', { class: 'chips scroll' });
      const drawCats = () => {
        catChips.innerHTML = '';
        orderedCategories().forEach((c) => {
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
          if (!draft.date) return toast('Pick a date');
          if (draft.type === 'transfer') {
            if (!draft.toAccountId) return toast('Pick the destination account');
            if (draft.toAccountId === draft.accountId) return toast('Pick two different accounts');
            draft.categoryId = null;      // transfers are not spending
            delete draft.needsReview;
          } else {
            if (!draft.categoryId) return toast('Pick a category');
            delete draft.toAccountId;
            delete draft.needsReview;     // manually edited = reviewed
          }
          if (fx && useLocal) {
            // Store EUR as the canonical amount, keep what was actually typed
            draft.origAmount = Math.round(val * 100) / 100;
            draft.origCurrency = fx.currency;
            draft.rate = fx.rate;
            draft.amount = Math.round(val * fx.rate * 100) / 100;
          } else {
            draft.amount = Math.round(val * 100) / 100;
            delete draft.origAmount; delete draft.origCurrency; delete draft.rate;
          }
          await DB.put('transactions', draft);
          if (draft.categoryId) await rememberCategoryPick(draft.categoryId);
          await bumpChanges(1);
          api.close();
          toast(existing ? 'Saved' : 'Added ' + fmtEUR(draft.amount));
          render();
        }
      });

      const acctLabel = el('label', { text: 'Account' });
      const catField = el('div', { class: 'field' },
        [el('label', { text: 'Category' }), catChips]);
      const noteField = el('div', { class: 'field' },
        [el('label', { text: 'Note' }), note, suggest]);
      const toField = el('div', { class: 'field', style: 'display:none' },
        [el('label', { text: 'To account' }), toChips]);

      // One-tap repeat: your most frequent recent charges, added instantly (undoable)
      if (!existing) {
        const freq = frequentTransactions(5);
        if (freq.length) {
          const chips = el('div', { class: 'chips scroll' });
          freq.forEach(({ tx, count }) => {
            const c = DB.category(tx.categoryId);
            chips.append(el('button', { class: 'chip repeat-chip', onclick: async () => {
              const copy = {
                id: null, type: 'expense', amount: tx.amount, date: U.todayISO(),
                categoryId: tx.categoryId, accountId: tx.accountId, note: tx.note
              };
              await DB.put('transactions', copy);
              await bumpChanges(1);
              api.close();
              toastUndo('Added ' + fmtEUR(copy.amount), async () => {
                await DB.del('transactions', copy.id);
                await bumpChanges(1);
                render();
              });
              render();
            } }, [
              el('span', { text: c ? c.icon : '•' }),
              el('span', { text: (tx.note || '').slice(0, 14) }),
              el('span', { class: 'repeat-amt', text: fmtEUR(tx.amount) }),
              el('span', { class: 'repeat-count', text: '×' + count })
            ]));
          });
          body.append(el('div', { class: 'field' }, [
            el('label', { text: 'Repeat a frequent one' }), chips
          ]));
        }
      }

      body.append(
        seg, amountWrap, fxLine,
        el('div', { class: 'field' }, [el('label', { text: 'Date' }), date]),
        el('div', { class: 'field' }, [acctLabel, acctChips]),
        toField,
        catField,
        noteField,
        save
      );
      syncSeg();   // apply per-type field visibility now that fields exist

      if (existing) {
        body.append(
          el('div', { class: 'spacer' }),
          el('button', {
            class: 'btn block danger', text: 'Delete transaction',
            onclick: async () => {
              const snapshot = { ...existing };
              await DB.del('transactions', existing.id);
              await bumpChanges(1);
              api.close();
              toastUndo('Deleted', async () => {
                await DB.put('transactions', snapshot);
                await bumpChanges(1);
                render();
              });
              render();
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
        body.append(
          el('div', { class: 'spacer' }),
          el('button', { class: 'btn block', text: 'Reconcile balance',
            onclick: () => { api.close(); openReconcileSheet(existing); } })
        );
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

  /** Cash drifts when you don't log every small purchase. Enter what you really
      have and the difference is booked as one adjustment, so the account stops
      lying without you having to remember each coffee. */
  function openReconcileSheet(acct) {
    const current = DB.accountBalance(acct.id);
    openSheet('Reconcile ' + acct.name, (body, api) => {
      const actual = el('input', { type: 'text', inputmode: 'decimal',
        placeholder: current.toFixed(2).replace('.', ',') });
      const diffLine = el('p', { class: 'muted', style: 'line-height:1.5;margin:10px 0' });
      const catSel = el('select', {}, orderedCategories().map((c) =>
        el('option', { value: c.id, text: c.icon + ' ' + c.name })));
      const catField = el('div', { class: 'field' },
        [el('label', { text: 'Book the difference as' }), catSel]);

      const update = () => {
        const v = CSV.parseAmount(actual.value);
        if (v == null) { diffLine.textContent = ''; catField.style.display = 'none'; return; }
        const diff = Math.round((current - v) * 100) / 100;
        catField.style.display = diff > 0 ? '' : 'none';
        diffLine.textContent = diff > 0
          ? 'You have ' + fmtEUR(diff) + ' less than recorded — that becomes one expense.'
          : diff < 0
            ? 'You have ' + fmtEUR(-diff) + ' more than recorded — that becomes income.'
            : 'Everything already matches.';
      };
      actual.addEventListener('input', update);

      body.append(
        el('p', { class: 'muted', style: 'line-height:1.5;margin-bottom:12px', text:
          'Recorded balance is ' + fmtEUR(current) + '. Enter what you actually have and ' +
          'the gap (untracked spending) is recorded in one go.' }),
        el('div', { class: 'field' }, [el('label', { text: 'Actual balance (€)' }), actual]),
        diffLine, catField,
        el('button', { class: 'btn block primary', text: 'Adjust', onclick: async () => {
          const v = CSV.parseAmount(actual.value);
          if (v == null) return toast('Enter the actual balance');
          const diff = Math.round((current - v) * 100) / 100;
          if (diff === 0) { api.close(); return toast('Already up to date'); }
          await DB.put('transactions', {
            id: null, date: U.todayISO(), amount: Math.abs(diff),
            type: diff > 0 ? 'expense' : 'income',
            categoryId: diff > 0 ? catSel.value
              : (DB.state.categories.find((c) => c.name === 'Other') || DB.state.categories[0]).id,
            accountId: acct.id,
            note: diff > 0 ? 'Cash spending (reconciled)' : 'Cash adjustment (reconciled)'
          });
          await bumpChanges(1);
          api.close(); toast('Balance reconciled'); render();
        } })
      );
      update();
      setTimeout(() => actual.focus(), 320);
    });
  }

  /* ======================= Settings ======================= */

  /** Collapsible Settings section. Toggling only flips a class (no re-render),
      so the scroll position and any in-section search state survive. */
  function settingsSection(key, icon, title, subtitle, build) {
    const open = !!ui.settings.open[key];
    const body = el('div', { class: 'sect-body' + (open ? ' show' : '') });
    const chev = el('span', { class: 'sect-chev', text: open ? '⌄' : '›' });
    const head = el('button', { class: 'sect-head' }, [
      el('span', { class: 'sect-icon', text: icon }),
      el('span', { class: 'sect-main' }, [
        el('span', { class: 'sect-title', text: title }),
        subtitle ? el('span', { class: 'sect-sub', text: subtitle }) : null
      ]),
      chev
    ]);
    head.addEventListener('click', () => {
      const nowOpen = !body.classList.contains('show');
      body.classList.toggle('show', nowOpen);
      chev.textContent = nowOpen ? '⌄' : '›';
      ui.settings.open[key] = nowOpen;
    });
    build(body);
    return el('div', { class: 'card sect' }, [head, body]);
  }

  function renderSettings() {
    const root = $('#view-settings');
    root.innerHTML = '';
    root.append(el('div', { class: 'view-title' }, [el('h1', { text: 'Settings' })]));

    const bud = DB.state.meta.budget;
    const last = DB.state.meta.lastBackup;
    const reviewN = reviewQueue().length;

    /* ---------- Budget ---------- */
    root.append(settingsSection('budget', '💰', 'Monthly budget',
      bud ? fmtEUR(bud.amount) + ' · ' + (bud.mode === 'daily' ? 'spread per day' : 'monthly cap')
          : 'Not set',
      (b) => {
        b.append(
          el('p', { class: 'muted', style: 'line-height:1.5;margin-bottom:12px', text: bud
            ? 'Your limit is ' + fmtEUR(bud.amount) + ' per month, ' +
              (bud.mode === 'daily'
                ? 'spread across the days left and rebalanced as you spend.'
                : 'as a single cap for the whole month.')
            : 'Set a monthly spending limit, optionally spread across each day and rebalanced automatically.' }),
          el('button', { class: 'btn block primary', text: bud ? 'Edit budget' : 'Set a budget',
            onclick: openBudgetSheet }),
          el('div', { class: 'spacer' }),
          el('button', { class: 'btn block', text: 'Category limits' +
            (Object.keys(catBudgets()).length ? ' (' + Object.keys(catBudgets()).length + ')' : ''),
            onclick: openCategoryBudgetsSheet })
        );
      }));

    /* ---------- Categories (compact grid) ---------- */
    root.append(settingsSection('categories', '🏷', 'Categories',
      DB.state.categories.length + ' total', (b) => {
        const grid = el('div', { class: 'cat-grid' });
        const counts = new Map();
        DB.state.transactions.forEach((t) =>
          counts.set(t.categoryId, (counts.get(t.categoryId) || 0) + 1));
        [...DB.state.categories]
          .sort((a, b2) => (counts.get(b2.id) || 0) - (counts.get(a.id) || 0))
          .forEach((c) => {
            grid.append(el('button', { class: 'cat-cell', onclick: () => openCategorySheet(c) }, [
              el('span', { class: 'cat-cell-icon', text: c.icon,
                style: 'background:' + U.tintOf(c.color) }),
              el('span', { class: 'cat-cell-main' }, [
                el('span', { class: 'cat-cell-name', text: c.name }),
                el('span', { class: 'cat-cell-count', text: (counts.get(c.id) || 0) + ' tx' })
              ])
            ]));
          });
        b.append(grid, el('div', { class: 'spacer' }),
          el('button', { class: 'btn block', text: '+ Add category',
            onclick: () => openCategorySheet(null) }));
      }));

    /* ---------- Rules (searchable, grouped by category) ---------- */
    root.append(settingsSection('rules', '⚡', 'Category rules',
      DB.state.rules.length + ' total', (b) => {
        b.append(el('p', { class: 'muted', style: 'line-height:1.5;margin-bottom:10px', text:
          'When a note or imported description matches, the category is applied automatically.' }));

        const search = el('input', { class: 'searchbox', type: 'search',
          placeholder: 'Search rules or categories…', value: ui.settings.ruleQuery });
        const listWrap = el('div');

        const drawRules = () => {
          const q = ui.settings.ruleQuery.trim().toLowerCase();
          listWrap.innerHTML = '';
          const matches = DB.state.rules.filter((r) => {
            if (!q) return true;
            const cat = DB.category(r.categoryId);
            return (r.keyword || '').toLowerCase().includes(q) ||
              (cat ? cat.name.toLowerCase().includes(q) : false);
          });
          if (!matches.length) {
            listWrap.append(el('div', { class: 'empty', html: DB.state.rules.length
              ? '<span class="big">🔍</span>No rules match'
              : '<span class="big">⚡</span>No rules yet' }));
            return;
          }
          // Group by category, biggest group first
          const groups = new Map();
          matches.forEach((r) => {
            if (!groups.has(r.categoryId)) groups.set(r.categoryId, []);
            groups.get(r.categoryId).push(r);
          });
          [...groups.entries()]
            .sort((a, b2) => b2[1].length - a[1].length)
            .forEach(([catId, rules]) => {
              const cat = DB.category(catId);
              // Searching auto-expands so matches are visible without extra taps.
              const open = !!q || !!ui.settings.ruleGroups[catId];
              const sub = el('div', { class: 'rule-sub' + (open ? ' show' : '') });
              const chev = el('span', { class: 'place-chev', text: open ? '⌄' : '›' });
              const head = el('button', { class: 'rule-group-head' }, [
                el('span', { class: 'cat-cell-icon', text: cat ? cat.icon : '❓',
                  style: 'background:' + U.tintOf(cat ? cat.color : 'blue') }),
                el('span', { class: 'rule-group-name', text: cat ? cat.name : 'Unknown category' }),
                el('span', { class: 'rule-group-count', text: String(rules.length) }),
                chev
              ]);
              head.addEventListener('click', () => {
                const nowOpen = !sub.classList.contains('show');
                sub.classList.toggle('show', nowOpen);
                chev.textContent = nowOpen ? '⌄' : '›';
                ui.settings.ruleGroups[catId] = nowOpen;
              });
              rules.forEach((r) => {
                sub.append(el('button', { class: 'rule-row', onclick: () => openRuleSheet(r) }, [
                  el('span', { class: 'rule-kw', text: r.keyword }),
                  r.regex ? el('span', { class: 'rule-badge', text: 'regex' }) : null,
                  el('span', { class: 's-chev', text: '›' })
                ]));
              });
              listWrap.append(el('div', { class: 'rule-group' }, [head, sub]));
            });
        };

        let deb;
        search.addEventListener('input', () => {
          clearTimeout(deb);
          deb = setTimeout(() => { ui.settings.ruleQuery = search.value; drawRules(); }, 120);
        });
        drawRules();
        b.append(search, listWrap, el('div', { class: 'spacer' }),
          el('button', { class: 'btn block', text: '+ Add rule', onclick: () => openRuleSheet(null) }));
      }));

    /* ---------- Import (bank sync + CSV) ---------- */
    root.append(settingsSection('import', '📥', 'Import transactions',
      reviewN > 0 ? reviewN + ' waiting for a category' : 'Bank sync · CSV', (b) => {
        b.append(el('div', { class: 'sub-title', text: 'Statement file' }),
          el('p', { class: 'muted', style: 'line-height:1.5;margin-bottom:10px', text:
            'Paste your bank statement into a text file, convert it with sync/paste_to_sync.py ' +
            '(runs on this phone in a-Shell — see sync/README.md), then import the result here. ' +
            'Re-imports merge — never duplicate.' }),
          el('button', { class: 'btn block primary', text: 'Import statement file',
            onclick: importBankSync }));
        if (reviewN > 0) {
          b.append(el('div', { class: 'spacer' }),
            el('button', { class: 'btn block', text: 'Review queue (' + reviewN + ')',
              onclick: openReviewSheet }));
        }
        b.append(el('hr', { class: 'sep' }),
          el('div', { class: 'sub-title', text: 'Any bank or app export' }),
          el('button', { class: 'btn block', text: 'Import CSV or JSON', onclick: openCsvWizard }));
        if (DB.state.presets.length) {
          b.append(el('div', { class: 'muted', style: 'margin-top:10px', text: 'Saved presets:' }));
          DB.state.presets.forEach((p) => {
            b.append(el('div', { class: 'set-row' }, [
              el('span', { class: 's-main', text: p.name }),
              el('button', { class: 'btn small ghost', text: 'Delete',
                onclick: async () => { await DB.del('presets', p.id); renderSettings(); } })
            ]));
          });
        }
      }));

    /* ---------- Backup & reminders ---------- */
    const snapAt = DB.state.meta.lastSnapshotAt;
    root.append(settingsSection('backup', '💾', 'Backup & autosave',
      snapAt ? 'Auto-saved ' + new Date(snapAt).toLocaleString('it-IT', {
        day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
        : (last ? 'Last export: ' + new Date(last).toLocaleDateString('it-IT') : 'No backup yet'),
      (b) => {
        /* --- automatic --- */
        b.append(el('div', { class: 'sub-title', text: 'Automatic' }));
        const auto = autosaveCfg();
        const snapToggle = el('input', { type: 'checkbox' });
        snapToggle.checked = auto.snapshots;
        snapToggle.addEventListener('change', async () => {
          await DB.setMeta('autosave', Object.assign({}, auto, { snapshots: snapToggle.checked }));
          ui.settings.open.backup = true;
          if (snapToggle.checked) { lastSnapshotHash = null; await runAutosave('enable'); }
          renderSettings();
        });
        b.append(el('label', { class: 'switch-row' }, [
          el('div', { class: 's-main' }, [
            el('div', { text: 'Auto-save snapshots on this device' }),
            el('div', { class: 's-sub', text:
              'A full copy saved after every change and when you close the app.' })
          ]),
          snapToggle
        ]));
        b.append(el('p', { class: 'muted', style: 'line-height:1.5;margin:6px 0 10px', text:
          snapAt ? 'Last snapshot: ' + new Date(snapAt).toLocaleString('it-IT') +
            ' · keeping the newest ' + SNAPSHOT_KEEP + '.'
            : 'No snapshot yet — one is taken shortly after your next change.' }));
        b.append(el('button', { class: 'btn block', text: 'Restore a snapshot',
          onclick: openSnapshotsSheet }));

        /* --- linked file (desktop browsers only) --- */
        const linked = DB.state.meta.autosaveFile;
        b.append(el('hr', { class: 'sep' }),
          el('div', { class: 'sub-title', text: 'Auto-save to a file' }));
        if (!fsSupported()) {
          b.append(el('p', { class: 'muted', style: 'line-height:1.5', text:
            'Safari (and every browser on iPhone) doesn’t let a web app write to a file on its ' +
            'own, so this only works in Chrome/Brave/Edge on a computer. On iPhone the snapshots ' +
            'above are the automatic layer — plus an occasional exported file for safekeeping.' }));
        } else if (linked) {
          b.append(
            el('p', { class: 'muted', style: 'line-height:1.5;margin-bottom:10px', text:
              'Every change is written to “' + linked.name + '” automatically.' }),
            el('button', { class: 'btn block', text: 'Re-enable after restart',
              onclick: reauthorizeFile }),
            el('div', { class: 'spacer' }),
            el('button', { class: 'btn block ghost', text: 'Unlink file', onclick: unlinkBackupFile })
          );
        } else {
          b.append(
            el('p', { class: 'muted', style: 'line-height:1.5;margin-bottom:10px', text:
              'Pick a file once — the app then overwrites it silently on every change.' }),
            el('button', { class: 'btn block primary', text: 'Link a backup file',
              onclick: linkBackupFile })
          );
        }

        /* --- manual --- */
        b.append(el('hr', { class: 'sep' }),
          el('div', { class: 'sub-title', text: 'Manual' }),
          el('p', { class: 'muted', style: 'margin-bottom:12px;line-height:1.5', text:
            'Snapshots live on this device, so they can’t survive a lost phone or iOS clearing ' +
            'storage. Export a file now and then and keep it somewhere safe.' +
            (last ? ' Last export: ' + new Date(last).toLocaleDateString('it-IT') + '.' : '') }),
          el('button', { class: 'btn block primary', text: 'Export backup', onclick: exportJSON }),
          el('div', { class: 'spacer' }),
          el('button', { class: 'btn block', text: 'Export encrypted', onclick: exportEncrypted }),
          el('div', { class: 'spacer' }),
          el('button', { class: 'btn block', text: 'Import backup', onclick: importJSON }),
          el('p', { class: 'muted', style: 'margin-top:8px;line-height:1.5', text:
            'Encrypted files are safe to keep in iCloud or email — but the password is never ' +
            'stored, so if you forget it the backup is gone for good.' })
        );

        /* --- file naming --- */
        const dated = el('input', { type: 'checkbox' });
        dated.checked = exportNaming() === 'dated';
        dated.addEventListener('change', async () => {
          await DB.setMeta('exportNaming', dated.checked ? 'dated' : 'fixed');
          ui.settings.open.backup = true; render();
        });
        b.append(el('hr', { class: 'sep' }),
          el('div', { class: 'sub-title', text: 'File name' }),
          el('p', { class: 'muted', style: 'line-height:1.5;margin-bottom:10px', text:
            'Exports are called “' + exportName('expense-tracker-backup', 'json') + '”. ' +
            (U.wantsShare()
              ? 'Choose Save to Files and pick the same folder every time — because the name ' +
                'never changes, iOS offers Replace instead of leaving you another copy.'
              : 'Keeping the name fixed means each export overwrites the last one instead of ' +
                'piling up a new file.') }),
          el('label', { class: 'switch-row' }, [
            el('div', { class: 's-main' }, [
              el('div', { text: 'Add the date to the file name' }),
              el('div', { class: 's-sub', text:
                'On: every export is a separate, dated file. Off: one file you keep replacing.' })
            ]),
            dated
          ]),
          el('hr', { class: 'sep' })
        );
        reminderSettingsBody(b);
      }));

    /* ---------- Trips ---------- */
    const ts = tripSettings();
    const tripCount = (DB.state.meta.trips || []).length;
    root.append(settingsSection('trips', '✈️', 'Trips',
      tripCount + (tripCount === 1 ? ' saved' : ' saved'), (b) => {
        const tg = el('input', { type: 'checkbox' });
        tg.checked = ts.excludeFromStats;
        tg.addEventListener('change', async () => {
          await DB.setMeta('tripSettings', Object.assign({}, ts, { excludeFromStats: tg.checked }));
          ui.settings.open.trips = true; render();
        });
        b.append(
          el('label', { class: 'switch-row' }, [
            el('div', { class: 's-main' }, [
              el('div', { text: 'Keep trips out of monthly stats' }),
              el('div', { class: 's-sub', text:
                'Charts and averages ignore trip spending, so a holiday doesn’t skew your baseline.' })
            ]),
            tg
          ]),
          el('p', { class: 'muted', style: 'line-height:1.5;margin-top:10px', text:
            'Confirmed subscriptions charged during a trip always count as normal spending. ' +
            'Give a trip its own budget (in the Trips tab) and its spending also leaves your ' +
            'monthly budget — otherwise the money still comes out of it.' }),
          el('div', { class: 'spacer' }),
          el('button', { class: 'btn block', text: 'Open trips',
            onclick: () => { ui.stats.view = 'trips'; show('stats'); } })
        );
      }));

    /* ---------- Private mode ---------- */
    const pv = privacyCfg();
    root.append(settingsSection('privacy', '👁', 'Private mode',
      pv.on ? (pv.level === 'all' ? 'All amounts hidden' : 'Balances hidden') : 'Off', (b) => {
        b.append(el('p', { class: 'muted', style: 'line-height:1.5;margin-bottom:12px', text:
          'Blurs the figures that reveal how much money you have, so a glance over your ' +
          'shoulder shows nothing. Tap any blurred number to peek at it for a few seconds.' }));

        const onToggle = el('input', { type: 'checkbox' });
        onToggle.checked = pv.on;
        onToggle.addEventListener('change', async () => {
          await setPrivacy({ on: onToggle.checked });
          ui.settings.open.privacy = true; render();
        });
        b.append(el('label', { class: 'switch-row' }, [
          el('div', { class: 's-main' }, [
            el('div', { text: 'Hide amounts' }),
            el('div', { class: 's-sub', text: 'Also toggleable from the eye button on Home.' })
          ]),
          onToggle
        ]));

        const lvl = el('select', {}, [
          el('option', { value: 'balances', text: 'Balances, income and net' }),
          el('option', { value: 'all', text: 'Every amount, including transactions' })
        ]);
        lvl.value = pv.level;
        lvl.addEventListener('change', async () => {
          await setPrivacy({ level: lvl.value });
          ui.settings.open.privacy = true; render();
        });

        const autoToggle = el('input', { type: 'checkbox' });
        autoToggle.checked = pv.auto;
        autoToggle.addEventListener('change', async () => {
          await setPrivacy({ auto: autoToggle.checked });
          ui.settings.open.privacy = true; render();
        });

        b.append(
          el('hr', { class: 'sep' }),
          el('div', { class: 'field' }, [el('label', { text: 'What to hide' }), lvl]),
          el('label', { class: 'switch-row' }, [
            el('div', { class: 's-main' }, [
              el('div', { text: 'Re-hide when I close the app' }),
              el('div', { class: 's-sub', text: 'Turns hiding back on every time you leave.' })
            ]),
            autoToggle
          ]),
          el('p', { class: 'muted', style: 'line-height:1.5;margin-top:10px', text:
            'Your daily allowance stays visible either way — it says nothing about your ' +
            'balance. This hides figures on screen; it is not encryption.' })
        );
      }));

    /* ---------- Quick-add ---------- */
    const stepList = (items) =>
      el('ol', { class: 'howto-steps' }, items.map((t) => el('li', { html: t })));
    root.append(settingsSection('quickadd', '📲', 'Home / Lock Screen quick-add',
      'One-tap “Add expense” button', (b) => {
        b.append(
          el('p', { class: 'muted', style: 'line-height:1.5', text:
            'Opens straight into a new transaction. iOS can’t set this up automatically, so pick the spot you want:' }),
          el('button', { class: 'btn block', style: 'margin-top:12px', text: 'Copy quick-add link',
            onclick: copyAddLink }),
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
        );
      }));

    /* ---------- Danger zone ---------- */
    root.append(settingsSection('danger', '⚠️', 'Danger zone', 'Delete all data', (b) => {
      b.append(el('button', {
        class: 'btn block danger', text: 'Delete all data',
        onclick: async () => {
          const n = DB.state.transactions.length;
          if (!(await confirmSheet(
            `Permanently delete everything on this device (${n} transactions, all accounts, categories and rules)? ` +
            'Automatic snapshots are deleted too, so export a backup first if you might need it.',
            'Delete everything', true))) return;
          if (!(await confirmSheet('Really delete all data? There is no undo.', 'Yes, delete it all', true))) return;
          DB.onWrite = null;          // don't re-snapshot the wiped state
          await DB.wipeAll();
          location.reload();
        }
      }));
    }));

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
          class: 'btn block primary', text: 'Export backup now',
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

  /** Fills a container with the backup-reminder controls (used inside the
      collapsible Backup section). Keeps the section open across re-renders. */
  function reminderSettingsBody(card) {
    const cfg = reminderCfg();
    const save = async (patch) => {
      await DB.setMeta('backupReminder', Object.assign({}, cfg, patch));
      ui.settings.open.backup = true;
      renderSettings();
    };

    card.append(el('div', { class: 'sub-title', text: 'Backup reminders' }));

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
  }

  /* ======================= Statement file import ======================= */

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
      return toast('Not a statement file — create one with sync/paste_to_sync.py');
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
      if (t.type === 'transfer') return;      // never adopt a transfer as a bank row
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
      let bucket = adoptable.get(r.date + '|' + signedR.toFixed(2));
      // Foreign-currency entries were converted with your own rate, so the bank's
      // euro amount won't match to the cent — accept a close match for those.
      if (!bucket || !bucket.length) {
        for (const [k, list] of adoptable) {
          if (!list.length || k.slice(0, 10) !== r.date) continue;
          const cand = list.find((t) => t.origCurrency &&
            t.type === type && Math.abs(t.amount - amount) / Math.max(amount, 0.01) < 0.05);
          if (cand) { bucket = [cand]; break; }
        }
      }
      if (bucket && bucket.length) {
        const adopt = bucket.shift();
        // Keep the user's category/note/account; attach the bank id so future syncs
        // update it. For a converted entry the bank's euro amount is the real one.
        const merged = { ...adopt, externalId: r.externalId };
        if (adopt.origCurrency && Math.abs(adopt.amount - amount) > 0.005) {
          merged.amount = amount;
          if (adopt.origAmount) {
            merged.rate = Math.round((amount / adopt.origAmount) * 1e6) / 1e6;
          }
        }
        toPut.push(merged);
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
          class: 'btn block primary', text: 'Review them now',
          onclick: () => { api.close(); openReviewSheet(); }
        }), el('div', { class: 'spacer' }));
      }
      body.append(el('button', { class: 'btn block', text: 'Done', onclick: () => { api.close(); render(); } }));
    });
    render();
  }

  const reviewQueue = () => {
    const uc = uncategorizedCat();
    return DB.state.transactions.filter((t) => t.needsReview || (uc && t.categoryId === uc.id));
  };

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
          text: 'Apply existing rules to all',
          onclick: async () => {
            const n = await applyRulesToUncategorized();
            toast(n ? n + ' categorized by rules' : 'No rules matched these yet');
            draw(); render();
          }
        }));

        // Smart suggestions: same place appearing repeatedly -> categorize the whole group
        const clusters = groupByMerchant(q).filter((g) => g.count >= 2);
        if (clusters.length) {
          body.append(el('div', { class: 'sub-title', text:
            'Categorize a whole place at once' }));
          clusters.slice(0, 6).forEach((g) => {
            body.append(el('button', { class: 'sub-suggest suggest-btn',
              onclick: () => openBulkAssignSheet(g, draw) }, [
              el('div', { class: 'sub-main' }, [
                el('div', { class: 'sub-name', text: g.label }),
                el('div', { class: 'sub-sub', text: g.count + ' transactions · ' + fmtEUR(g.total) })
              ]),
              el('span', { class: 's-chev', text: '›' })
            ]));
          });
          body.append(el('hr', { class: 'sep' }));
        }
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

  /** Assign every transaction from one place at once, optionally teaching a rule. */
  function openBulkAssignSheet(group, onDone) {
    openSheet(group.label, (body, api) => {
      let chosen = null;
      const chips = el('div', { class: 'chips' });
      const drawChips = () => {
        chips.innerHTML = '';
        orderedCategories().forEach((c) => {
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
      const ruleToggle = el('input', { type: 'checkbox' });
      ruleToggle.checked = true;
      body.append(
        el('p', { class: 'muted', style: 'margin-bottom:12px;line-height:1.5', text:
          group.count + ' transactions from this place, ' + fmtEUR(group.total) + ' in total. ' +
          'Pick one category for all of them.' }),
        el('div', { class: 'field' }, [el('label', { text: 'Category' }), chips]),
        el('label', { style: 'display:flex;gap:8px;align-items:center;font-size:0.85rem;margin-bottom:14px' },
          [ruleToggle, el('span', { text: 'Also create a rule for “' + group.key + '”' })]),
        el('button', { class: 'btn block primary', text: 'Assign all ' + group.count,
          onclick: async () => {
            if (!chosen) return toast('Pick a category');
            const upd = group.txs.map((t) => {
              const o = { ...t, categoryId: chosen };
              delete o.needsReview;
              return o;
            });
            await DB.bulkPut('transactions', upd);
            if (ruleToggle.checked) {
              await DB.put('rules', { id: null, keyword: group.key, categoryId: chosen });
            }
            await bumpChanges(upd.length);
            api.close();
            toast(upd.length + ' categorized');
            onDone(); render();
          } })
      );
    }, { tall: true });
  }

  function openAssignSheet(t, onDone) {
    openSheet('Pick a category', (body, api) => {
      let chosen = null;
      const chips = el('div', { class: 'chips' });
      const drawChips = () => {
        chips.innerHTML = '';
        orderedCategories().forEach((c) => {
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

  /* ======================= Autosave (snapshots + linked file) =======================
     Two layers, because no browser lets a web app silently write files on iOS:
     1) Snapshots — a full copy kept inside this device's database after every change
        and whenever the app is hidden/closed. Instant, automatic, restorable in-app.
        Protects against mistakes (bad import, wrong delete); NOT against losing the
        device or iOS clearing storage — that still needs an exported file.
     2) Linked file — where the browser supports the File System Access API
        (desktop Chrome/Brave/Edge), the same file is silently overwritten on every
        change. Unavailable in Safari/iOS, so the UI hides it there. */

  const SNAPSHOT_KEEP = 12;
  const SNAPSHOT_DEBOUNCE_MS = 15000;
  let snapshotTimer = null;
  let lastSnapshotHash = null;
  let fileHandle = null;          // FileSystemFileHandle when a file is linked

  const autosaveCfg = () =>
    Object.assign({ snapshots: true }, DB.state.meta.autosave || {});

  const fsSupported = () => typeof window.showSaveFilePicker === 'function';

  function hash32(str) {
    let h = 0;
    for (let i = 0; i < str.length; i++) h = ((h << 5) - h + str.charCodeAt(i)) | 0;
    return (h >>> 0).toString(36);
  }

  /** The payload used by manual export, snapshots and the linked file alike. */
  function buildBackupPayload() {
    const m = DB.state.meta;
    return {
      app: 'expense-tracker', version: 1, exportedAt: new Date().toISOString(),
      accounts: DB.state.accounts,
      categories: DB.state.categories,
      transactions: DB.state.transactions,
      rules: DB.state.rules,
      presets: DB.state.presets,
      meta: {
        budget: m.budget || null,
        backupReminder: m.backupReminder || null,
        bankAccountMap: m.bankAccountMap || null
      }
    };
  }

  function scheduleAutosave() {
    clearTimeout(snapshotTimer);
    snapshotTimer = setTimeout(() => runAutosave('change'), SNAPSHOT_DEBOUNCE_MS);
  }

  /** Write a snapshot (and the linked file) if the data actually changed. */
  async function runAutosave(reason) {
    clearTimeout(snapshotTimer);
    if (!DB.state.transactions.length && !DB.state.accounts.length) return;
    let json;
    try { json = JSON.stringify(buildBackupPayload()); } catch { return; }
    const h = hash32(json);
    if (h === lastSnapshotHash) return;      // nothing changed since the last save
    lastSnapshotHash = h;

    if (autosaveCfg().snapshots) {
      try {
        await DB.saveSnapshot({
          id: 'snap-' + Date.now().toString(36),
          at: Date.now(),
          reason,
          hash: h,
          size: json.length,
          counts: {
            transactions: DB.state.transactions.length,
            accounts: DB.state.accounts.length,
            categories: DB.state.categories.length,
            rules: DB.state.rules.length
          },
          data: json
        });
        await DB.pruneSnapshots(SNAPSHOT_KEEP);
        await DB.setMeta('lastSnapshotAt', Date.now());
      } catch (e) {
        console.warn('snapshot failed', e);
      }
    }
    await writeLinkedFile(json);
  }

  /* ---- Linked file (File System Access API — desktop Chromium only) ---- */

  async function writeLinkedFile(json) {
    if (!fileHandle) return;
    try {
      const perm = await fileHandle.queryPermission({ mode: 'readwrite' });
      if (perm !== 'granted') return;        // needs a user gesture to re-grant
      const w = await fileHandle.createWritable();
      await w.write(json);
      await w.close();
      await DB.setMeta('lastBackup', Date.now());
      await DB.setMeta('changesSinceBackup', 0);
    } catch (e) {
      console.warn('linked-file write failed', e);
    }
  }

  async function linkBackupFile() {
    if (!fsSupported()) return toast('This browser can’t write files automatically');
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName: 'expense-tracker-backup.json',
        types: [{ description: 'JSON backup', accept: { 'application/json': ['.json'] } }]
      });
      fileHandle = handle;
      await DB.setMeta('autosaveFile', { name: handle.name, linkedAt: Date.now() });
      await DB.setMeta('autosaveFileHandle', handle);   // structured-cloneable in IDB
      lastSnapshotHash = null;                          // force an immediate write
      await runAutosave('link');
      toast('Auto-saving to ' + handle.name);
      renderSettings();
    } catch (e) {
      if (e && e.name !== 'AbortError') toast('Could not link that file');
    }
  }

  async function unlinkBackupFile() {
    fileHandle = null;
    await DB.setMeta('autosaveFile', null);
    await DB.setMeta('autosaveFileHandle', null);
    toast('Auto-save file unlinked');
    renderSettings();
  }

  /** Re-attach the stored handle at startup (permission may need a gesture). */
  async function restoreFileHandle() {
    const stored = DB.state.meta.autosaveFileHandle;
    if (!stored || !fsSupported()) return;
    fileHandle = stored;
    try {
      const perm = await fileHandle.queryPermission({ mode: 'readwrite' });
      if (perm === 'granted') return;
    } catch { fileHandle = null; }
  }

  async function reauthorizeFile() {
    const stored = DB.state.meta.autosaveFileHandle;
    if (!stored) return;
    try {
      const perm = await stored.requestPermission({ mode: 'readwrite' });
      if (perm === 'granted') {
        fileHandle = stored;
        lastSnapshotHash = null;
        await runAutosave('reauth');
        toast('Auto-save re-enabled');
        renderSettings();
      } else {
        toast('Permission denied');
      }
    } catch { toast('Could not re-enable auto-save'); }
  }

  /* ---- Restore ---- */

  function openSnapshotsSheet() {
    openSheet('Automatic snapshots', async (body, api) => {
      body.append(el('p', { class: 'muted', style: 'line-height:1.5;margin-bottom:12px', text:
        'Saved automatically on this device after changes and when you close the app. ' +
        'They protect against mistakes — but not against losing the phone, so keep exporting files too.' }));
      const list = el('div');
      body.append(list);
      const draw = async () => {
        const snaps = await DB.listSnapshots();
        list.innerHTML = '';
        if (!snaps.length) {
          list.append(el('div', { class: 'empty', html: '<span class="big">🕘</span>No snapshots yet' }));
          return;
        }
        snaps.forEach((s) => {
          const when = new Date(s.at);
          list.append(el('div', { class: 'snap-row' }, [
            el('div', { class: 'snap-main' }, [
              el('div', { class: 'snap-when', text:
                when.toLocaleDateString('it-IT') + ' ' +
                when.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' }) }),
              el('div', { class: 'snap-sub', text:
                s.counts.transactions + ' transactions · ' + Math.round(s.size / 1024) + ' KB' })
            ]),
            el('button', { class: 'btn small ghost', text: 'Save', onclick: () => {
              U.download('expense-tracker-' +
                new Date(s.at).toISOString().slice(0, 10) + '.json', s.data, 'application/json');
            } }),
            el('button', { class: 'btn small', text: 'Restore', onclick: async () => {
              let data;
              try { data = JSON.parse(s.data); } catch { return toast('Snapshot unreadable'); }
              if (!(await confirmSheet(
                `Restore the snapshot from ${when.toLocaleString('it-IT')}? ` +
                `It replaces the current data (${DB.state.transactions.length} transactions) ` +
                `with ${s.counts.transactions}. A new snapshot of the current state is taken first.`,
                'Restore', true))) return;
              await runAutosave('pre-restore');     // safety net before overwriting
              await DB.replaceAll(data);
              await repairData();
              focusLatestData();
              lastSnapshotHash = null;
              api.close();
              toast('Snapshot restored');
              render();
            } })
          ]));
        });
      };
      await draw();
    }, { tall: true });
  }

  /* ======================= Encrypted backups =======================
     AES-GCM with a PBKDF2-derived key (WebCrypto, no dependencies). The
     password never leaves the device and is never stored — lose it and the
     file is unrecoverable, which the UI says plainly before exporting. */

  const ENC_MAGIC = 'expense-tracker-encrypted';
  const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
  const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

  async function deriveKey(password, salt) {
    const base = await crypto.subtle.importKey(
      'raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt, iterations: 250000, hash: 'SHA-256' },
      base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  }

  async function encryptPayload(text, password) {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const key = await deriveKey(password, salt);
    const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key,
      new TextEncoder().encode(text));
    return JSON.stringify({
      app: ENC_MAGIC, v: 1, kdf: 'PBKDF2-SHA256', iterations: 250000,
      salt: b64(salt), iv: b64(iv), data: b64(ct)
    }, null, 2);
  }

  async function decryptPayload(obj, password) {
    const key = await deriveKey(password, unb64(obj.salt));
    const plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: unb64(obj.iv) }, key, unb64(obj.data));
    return new TextDecoder().decode(plain);
  }

  function askPassword(title, message, confirmLabel, needsTwice) {
    return new Promise((resolve) => {
      openSheet(title, (body, api) => {
        const p1 = el('input', { type: 'password', placeholder: 'Password',
          autocomplete: 'new-password' });
        const p2 = el('input', { type: 'password', placeholder: 'Repeat password',
          autocomplete: 'new-password' });
        let done = false;
        body.append(
          el('p', { class: 'muted', style: 'line-height:1.5;margin-bottom:14px', text: message }),
          el('div', { class: 'field' }, [el('label', { text: 'Password' }), p1]),
          needsTwice ? el('div', { class: 'field' }, [el('label', { text: 'Repeat' }), p2]) : null,
          el('button', { class: 'btn block primary', text: confirmLabel, onclick: () => {
            if (!p1.value) return toast('Enter a password');
            if (needsTwice && p1.value !== p2.value) return toast('Passwords don’t match');
            if (needsTwice && p1.value.length < 6) return toast('Use at least 6 characters');
            done = true; const v = p1.value; api.close(); resolve(v);
          } })
        );
        const origClose = api.close;
        api.close = () => { origClose(); if (!done) resolve(null); };
        setTimeout(() => p1.focus(), 320);
      });
    });
  }

  async function exportEncrypted() {
    const pw = await askPassword('Encrypted backup',
      'The file is scrambled with this password. It is never stored anywhere — if you forget ' +
      'it, the backup cannot be opened by anyone, including you.', 'Encrypt & export', true);
    if (!pw) return;
    try {
      const enc = await encryptPayload(JSON.stringify(buildBackupPayload()), pw);
      const how = await U.saveFile(exportName('expense-tracker-encrypted', 'json'),
        enc, 'application/json');
      if (how === 'cancelled') return;
      await DB.setMeta('lastBackup', Date.now());
      await DB.setMeta('changesSinceBackup', 0);
      await DB.setMeta('backupSnoozeUntil', 0);
      toast('Encrypted backup exported ✓');
      render();
    } catch (e) {
      console.warn(e); toast('Encryption failed');
    }
  }

  /* ======================= Export / import =======================
     Exports used to always carry the date, which on iPhone means "Save to Files"
     writes a brand-new file every single time and the folder fills up. With a
     fixed name iOS offers to replace the previous one, so there is exactly one
     always-current backup — the version history already lives in snapshots. */

  const exportNaming = () => DB.state.meta.exportNaming || 'fixed';
  const exportName = (base, ext) =>
    base + (exportNaming() === 'dated' ? '-' + U.todayISO() : '') + '.' + ext;

  async function exportJSON() {
    const how = await U.saveFile(exportName('expense-tracker-backup', 'json'),
      JSON.stringify(buildBackupPayload(), null, 2), 'application/json');
    if (how === 'cancelled') return;
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
      // Encrypted backup: ask for the password, then continue as normal.
      if (data && data.app === ENC_MAGIC) {
        const pw = await askPassword('Encrypted backup',
          'This file is password-protected. Enter the password you used when exporting it.',
          'Decrypt', false);
        if (!pw) return;
        try {
          data = JSON.parse(await decryptPayload(data, pw));
        } catch {
          return toast('Wrong password, or the file is damaged');
        }
      }
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
            class: 'btn block primary', text: 'Merge with current data',
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
            class: 'btn block danger', text: 'Replace everything',
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
    U.saveFile(exportName('transactions', 'csv'), CSV.serialize(rows, ';'), 'text/csv');
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

  /** Import any bank CSV or another app's JSON export: the shape is worked out
      from the header names *and* the values, then shown for confirmation. */
  function openCsvWizard() {
    if (DB.state.accounts.length === 0) return toast('Create an account first');
    pickFile('.csv,.json,.txt,text/csv,application/json,text/plain', (text, filename) => {
      const trimmed = text.trim();
      let rows = null;

      if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
        let json;
        try { json = JSON.parse(trimmed); } catch { return toast('That JSON could not be read'); }
        // Our own formats have dedicated importers
        if (json && json.kind === 'bank-sync') return handleBankSyncData(json);
        if (json && json.app === 'expense-tracker') {
          return toast('That is an app backup — use Backup → Import backup');
        }
        const records = Detect.findRecordArray(json);
        if (!records || !records.length) return toast('No transactions found in that JSON');
        // Flatten objects to rows so the same mapping UI works for JSON and CSV
        const keys = [...records.reduce((set, r) => {
          Object.keys(r || {}).forEach((k) => {
            if (r[k] === null || typeof r[k] !== 'object') set.add(k);
          });
          return set;
        }, new Set())];
        rows = [keys, ...records.map((r) => keys.map((k) => (r && r[k] != null ? String(r[k]) : '')))];
      } else {
        const parsed = CSV.parse(text);
        if (!parsed.rows.length) return toast('Could not read that file');
        rows = parsed.rows;
        // Drop preamble junk above the real header (many banks add account info)
        const hdr = Detect.findHeaderRow(rows);
        if (hdr.headerIndex > 0) rows = rows.slice(hdr.headerIndex);
        else if (!hdr.hasHeader) rows = [rows[0].map((_, i) => 'Column ' + (i + 1)), ...rows];
      }

      if (!rows || rows.length < 2 || rows[0].length < 2) {
        return toast('Could not find columns in that file');
      }
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
    // Detection: header names + what the values actually look like
    const dataRows = rows.slice(1);
    const guess = Detect.detectColumns(rows[0], dataRows);
    if (guess.date) st.dateCol = guess.date.i;
    if (guess.description) st.descCol = guess.description.i;
    if (guess.amount) st.amountCol = guess.amount.i;
    if (guess.pair) {
      st.mode = 'double';
      st.debitCol = guess.debit.i;
      st.creditCol = guess.credit.i;
    }
    // Unsigned amount + a separate Uscita/Entrata (or Debit/Credit) column?
    if (!guess.pair) {
      const skip = new Set([st.dateCol, st.amountCol, st.descCol]);
      const dir = Detect.detectDirectionColumn(rows[0], dataRows, skip);
      if (dir) {
        st.mode = 'typed';
        st.typeCol = dir.i;
        st.typeMap = {};
        dir.values.forEach((v) => { st.typeMap[v] = Detect.classifyDirection(v) || 'expense'; });
      }
    }
    // Date convention (DD/MM vs MM/DD vs ISO) and decimal convention
    const dateVals = dataRows.map((r) => r[st.dateCol]);
    st.dateFmt = Detect.detectDateFormat(dateVals);
    const amtVals = dataRows.map((r) => r[st.mode === 'double' ? st.debitCol : st.amountCol]);
    st.amtFmt = Detect.detectAmountFormat(amtVals);
    st.detected = guess;

    openSheet('Check the columns', (body, api) => {
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
            if (m.typeCol != null) st.typeCol = m.typeCol;
            if (m.typeMap) st.typeMap = Object.assign({}, m.typeMap);
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

        const modeSeg = el('div', { class: 'seg seg-4' });
        const bSingle = el('button', { text: 'Signed amount', class: st.mode === 'single' ? 'active' : '' });
        const bDouble = el('button', { text: 'Debit + credit', class: st.mode === 'double' ? 'active' : '' });
        const bTyped = el('button', { text: 'Amount + type', class: st.mode === 'typed' ? 'active' : '' });
        bSingle.addEventListener('click', () => { st.mode = 'single'; draw(); });
        bDouble.addEventListener('click', () => { st.mode = 'double'; draw(); });
        bTyped.addEventListener('click', () => {
          st.mode = 'typed';
          if (st.typeCol == null) {
            const skip = new Set([st.dateCol, st.amountCol, st.descCol]);
            const dir = Detect.detectDirectionColumn(rows[0], rows.slice(1), skip);
            st.typeCol = dir ? dir.i : rows[0].findIndex((_, i) => !skip.has(i));
          }
          if (!st.typeMap) st.typeMap = {};
          draw();
        });
        modeSeg.append(bSingle, bDouble, bTyped);

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
        } else if (st.mode === 'typed') {
          const amtSel = colOptions(st.amountCol);
          amtSel.addEventListener('change', () => { st.amountCol = +amtSel.value; draw(); });
          const typeSel = colOptions(st.typeCol);
          typeSel.addEventListener('change', () => {
            st.typeCol = +typeSel.value; st.typeMap = {}; draw();
          });
          amountFields.append(
            el('div', { class: 'field' }, [
              el('label', { text: 'Amount column (always positive)' }), amtSel]),
            el('div', { class: 'field' }, [
              el('label', { text: 'Expense / income column' }), typeSel])
          );
          // Map each distinct label to a direction — works for any wording
          const labels = [...new Set(rows.slice(1)
            .map((r) => Detect.norm(r[st.typeCol]))
            .filter((v) => v))].slice(0, 8);
          if (!st.typeMap) st.typeMap = {};
          labels.forEach((v) => {
            if (!st.typeMap[v]) st.typeMap[v] = Detect.classifyDirection(v) || 'expense';
          });
          const mapWrap = el('div', { class: 'field' }, [
            el('label', { text: 'What each label means' })]);
          labels.forEach((v) => {
            const seg2 = el('div', { class: 'seg', style: 'flex:0 0 auto' });
            const be = el('button', { text: 'Expense' });
            const bi = el('button', { text: 'Income' });
            const sync = () => {
              be.className = st.typeMap[v] === 'expense' ? 'active exp' : '';
              bi.className = st.typeMap[v] === 'income' ? 'active inc' : '';
            };
            be.addEventListener('click', () => { st.typeMap[v] = 'expense'; sync(); });
            bi.addEventListener('click', () => { st.typeMap[v] = 'income'; sync(); });
            sync(); seg2.append(be, bi);
            mapWrap.append(el('div', { class: 'typemap-row' }, [
              el('span', { class: 'typemap-label', text: v || '(empty)' }), seg2
            ]));
          });
          amountFields.append(mapWrap);
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

        const fmtRow = el('div', { class: 'field' }, [el('label', { text: 'Date format' })]);
        const dfSel = el('select', {}, [
          el('option', { value: 'dmy', text: 'Day/Month/Year (31/12/2026)' }),
          el('option', { value: 'mdy', text: 'Month/Day/Year (12/31/2026)' }),
          el('option', { value: 'iso', text: 'Year-Month-Day (2026-12-31)' }),
          el('option', { value: 'text', text: 'With month name (3 luglio 2026)' })
        ]);
        dfSel.value = (st.dateFmt && st.dateFmt.format) || 'dmy';
        dfSel.addEventListener('change', () => {
          st.dateFmt = { format: dfSel.value, ambiguous: false, confidence: 1 };
          draw();
        });
        fmtRow.append(dfSel);
        if (st.dateFmt && st.dateFmt.ambiguous) {
          fmtRow.append(el('div', { class: 'note-suggest', text:
            'Every date fits both readings (no day above 12), so check this is right.' }));
        }

        const detectedNote = el('p', { class: 'muted', style: 'margin-bottom:10px', text:
          filename + ' · ' + (rows.length - 1) + ' rows · detected ' +
          (st.mode === 'double' ? 'debit/credit columns'
            : st.mode === 'typed' ? 'an amount column plus an expense/income column'
            : 'a single signed amount column') +
          (st.amtFmt ? ', ' + (st.amtFmt.format === 'eu' ? '1.234,56' : '1,234.56') + ' numbers' : '') });

        body.append(
          detectedNote,
          prev,
          el('label', { style: 'display:flex;gap:8px;align-items:center;font-size:0.85rem;margin-bottom:14px' },
            [headerToggle, el('span', { text: 'First row is a header' })]),
          el('div', { class: 'field' }, [el('label', { text: 'Date column' }), dateSel]),
          fmtRow,
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
                    typeCol: st.typeCol, typeMap: st.typeMap,
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
      const dateISO = st.dateFmt
        ? Detect.parseDateSmart(r[st.dateCol], st.dateFmt.format)
        : CSV.parseDate(r[st.dateCol]);
      const desc = String(r[st.descCol] || '').trim();
      let signed = null;
      const money = (v) => (st.amtFmt
        ? Detect.parseAmountSmart(v, st.amtFmt.format) : CSV.parseAmount(v));
      if (st.mode === 'typed') {
        const val = money(r[st.amountCol]);
        if (val != null) {
          const dir = st.typeMap[Detect.norm(r[st.typeCol])] ||
            Detect.classifyDirection(r[st.typeCol]) || 'expense';
          signed = dir === 'income' ? Math.abs(val) : -Math.abs(val);
        }
      } else if (st.mode === 'single') {
        signed = money(r[st.amountCol]);
        if (signed != null && st.invert) signed = -signed;
      } else {
        const deb = money(r[st.debitCol]);
        const cre = money(r[st.creditCol]);
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
        _suggested: !!cat,
        // Money leaving the bank with a withdrawal wording: probably cash, not spending
        _withdrawal: signed < 0 && Detect.looksWithdrawal(desc)
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

      // --- Cash withdrawals: offer to book them as transfers to a cash account ---
      const cashAccts = DB.state.accounts.filter((a) => a.type === 'cash');
      const wset = Object.assign({ mode: 'transfer', toAccountId: (cashAccts[0] || {}).id },
        DB.state.meta.withdrawalSettings || {});
      const withdrawals = good.filter((g) => g._withdrawal);
      if (withdrawals.length) {
        const card = el('div', { class: 'card' }, [
          el('div', { class: 'card-head' }, [
            el('h2', { text: 'Cash withdrawals' }),
            el('span', { class: 'muted', text: withdrawals.length + ' found' })
          ]),
          el('p', { class: 'muted', style: 'line-height:1.5;margin-bottom:10px', text:
            'These look like cash coming out of the bank rather than money spent. Booking ' +
            'them as transfers keeps your balances right and avoids counting the same money ' +
            'twice when you log what the cash was spent on.' })
        ]);
        const seg = el('div', { class: 'seg', style: 'margin-bottom:10px' });
        const bT = el('button', { text: 'Transfer to cash' });
        const bE = el('button', { text: 'Treat as expense' });
        const acctSel = el('select', {}, DB.state.accounts.map((a) =>
          el('option', { value: a.id, text: acctIcon(a.type) + ' ' + a.name })));
        if (wset.toAccountId) acctSel.value = wset.toAccountId;
        acctSel.addEventListener('change', () => { wset.toAccountId = acctSel.value; });
        const acctField = el('div', { class: 'field' },
          [el('label', { text: 'Cash goes to' }), acctSel]);
        const syncW = () => {
          bT.className = wset.mode === 'transfer' ? 'active' : '';
          bE.className = wset.mode === 'expense' ? 'active' : '';
          acctField.style.display = wset.mode === 'transfer' ? '' : 'none';
        };
        bT.addEventListener('click', () => { wset.mode = 'transfer'; syncW(); });
        bE.addEventListener('click', () => { wset.mode = 'expense'; syncW(); });
        syncW(); seg.append(bT, bE);
        card.append(seg, acctField);
        // Each row can be opted out — protects against a false positive
        withdrawals.forEach((g) => {
          const cb = el('input', { type: 'checkbox' });
          cb.checked = true;
          cb.addEventListener('change', () => { g._withdrawal = cb.checked; });
          card.append(el('label', { class: 'switch-row' }, [
            el('div', { class: 's-main' }, [
              el('div', { text: g.note.slice(0, 34) || 'Withdrawal' }),
              el('div', { class: 's-sub', text: U.fmtDate(g.date) + ' · ' + fmtEUR(g.amount) })
            ]),
            cb
          ]));
        });
        body.append(card);
        st._wset = wset;
      }

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
            const wcfg = st._wset;
            if (wcfg && wcfg.mode === 'transfer' && wcfg.toAccountId) {
              good.forEach((g) => {
                if (!g._withdrawal || g.type !== 'expense') return;
                if (wcfg.toAccountId === g.accountId) return;   // can't transfer to itself
                g.type = 'transfer';
                g.toAccountId = wcfg.toAccountId;
                g.categoryId = null;
                delete g.needsReview;
              });
              await DB.setMeta('withdrawalSettings',
                { mode: wcfg.mode, toAccountId: wcfg.toAccountId });
            } else if (wcfg) {
              await DB.setMeta('withdrawalSettings', { mode: 'expense' });
            }
            good.forEach((g) => { delete g._suggested; delete g._withdrawal; });
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

    // Autosave: snapshot after changes and whenever the app is backgrounded/closed.
    await restoreFileHandle();
    DB.onWrite = scheduleAutosave;
    applyPrivacy();
    initPrivacyPeek();
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') {
        runAutosave('hidden');
        // Re-hide amounts when the app goes to the background, if asked to
        if (privacyCfg().auto && !privacyCfg().on) setPrivacy({ on: true }).then(render);
      }
    });
    window.addEventListener('pagehide', () => { runAutosave('close'); });
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
        if (refreshToday()) render();      // a new month started while suspended
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
