/* Home tab: the dashboard, its period controls, and the category detail sheet (also opened from Stats). */
'use strict';

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
      el('button', { class: 'icon-btn', 'aria-label': 'Import Wallet notifications',
        onclick: importWalletNotifications,
        html: '<svg viewBox="0 0 24 24"><path d="M19.5 9.5A8 8 0 0 0 5.2 7.4"/>' +
          '<path d="M5 3.5v4h4"/><path d="M4.5 14.5a8 8 0 0 0 14.3 2.1"/>' +
          '<path d="M19 20.5v-4h-4"/></svg>' }),
      arrangeButton('dashboard'),
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

  // Getting started — above the month nav, since it's about the app, not a month
  const setup = setupCard();
  if (setup) root.append(setup);

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
  const tripBlock = () => {
    if (!tbs) return null;
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
    return card;
  };

  const budgetBlock = () => (bs ? budgetCard(bs, heroDaily) : null);

  // Top spending categories (compact) — full charts live in the Stats tab
  const topBlock = () => {
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
    return catCard;
  };

  renderBlocks(root, 'dashboard', {
    trip: tripBlock, budget: budgetBlock, top: topBlock
  });
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
