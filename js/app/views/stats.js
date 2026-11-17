/* Stats tab: timeframe and bucketing, the Overview sub-view, and period comparison. */
'use strict';

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

  // The arrange button acts on whichever sub-view you're looking at
  const arrangeable = ui.stats.view === 'overview' ? 'stats-overview'
    : ui.stats.view === 'trends' ? 'stats-trends' : null;
  root.append(el('div', { class: 'view-title' }, [
    el('h1', { text: 'Stats' }),
    arrangeable ? el('div', { class: 'title-right' }, [arrangeButton(arrangeable)]) : null
  ]));

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
  const net = income - expense;
  const tilesBlock = () => el('div', { class: 'tiles' }, [
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
  ]);

  // Nothing to arrange when there's nothing to show — the tiles still lead,
  // because "all zeros" is itself the answer, and then the explanation.
  if (income === 0 && expense === 0) {
    root.append(tilesBlock(), statsEmptyNote(rg));
    return;
  }

  const buckets = bucketize(txs, rg.from, rg.to, rg.gran);

  // Income vs Expenses (grouped bars)
  const inoutBlock = () => {
    const gbCard = el('div', { class: 'card' }, [
      el('h2', { text: 'Income vs expenses' }),
      el('div', { class: 'legend-inline' }, [
        legendKey(U.colorOf('aqua'), 'Income'),
        legendKey(U.colorOf('red'), 'Expenses')
      ])
    ]);
    const gbWrap = el('div', { class: 'chart-wrap' });
    gbCard.append(gbWrap);
    requestAnimationFrame(() => Charts.groupedBars(gbWrap, buckets, [
      { key: 'income', color: U.colorOf('aqua'), label: 'In' },
      { key: 'expense', color: U.colorOf('red'), label: 'Out' }
    ], { formatValue: fmtEUR }));
    return gbCard;
  };

  // Net over time (line)
  const netBlock = () => {
    const netCard = el('div', { class: 'card' }, [el('h2', { text: 'Net over time' })]);
    const netWrap = el('div', { class: 'chart-wrap' });
    netCard.append(netWrap);
    requestAnimationFrame(() => Charts.line(netWrap,
      buckets.map((b) => ({ tick: b.tick, label: b.label, value: Math.round(b.net * 100) / 100 })),
      { color: U.colorOf('blue'), formatValue: fmtEUR }));
    return netCard;
  };

  // Spending by category (donut)
  const categoriesBlock = () => {
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
      return donutCard;
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
    return donutCard;
  };

  renderBlocks(root, 'stats-overview', {
    tiles: tilesBlock,
    compare: () => comparisonCard(rg),
    inout: inoutBlock,
    net: netBlock,
    categories: categoriesBlock
  });
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
