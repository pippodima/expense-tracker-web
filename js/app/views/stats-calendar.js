/* Stats → Calendar: the spending heatmap and the day detail sheet. */
'use strict';

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

  /* The calendar is inherently monthly, but when the period selector is already
     showing a month, its ‹ › drive the very same y/m0 — a second identical nav
     right underneath was pure duplication. Only Year/All/Custom need one here. */
  if (ui.stats.range !== 'month') {
    const nav = el('div', { class: 'month-nav' });
    const prev = el('button', { class: 'mn-btn', text: '‹' });
    const next = el('button', { class: 'mn-btn', text: '›' });
    prev.addEventListener('click', () => { statsShiftMonth(-1); });
    next.addEventListener('click', () => { statsShiftMonth(1); });
    nav.append(prev, el('div', { class: 'mn-label', text: U.monthLabel(y, m0) }), next);
    root.append(nav);
  }

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
