/* Stats → Trends: how spending moves across months. */
'use strict';

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

  renderBlocks(root, 'stats-trends', {
    mix: () => mixCard(months, ranked, monthTotal),
    movers: () => (months.length >= 2 ? moversCard(months, perCat) : null),
    pace: () => paceCard(months, exp),
    fixed: () => fixedCard(months, exp, idx),
    savings: () => savingsCard(months, txs, idx),
    weekday: () => weekdayCard(months, exp)
  });

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
