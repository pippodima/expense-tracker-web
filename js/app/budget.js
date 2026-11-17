/* Budgets: the daily allowance, expenses kept out of it, per-category limits, the budget card and sheets. */
'use strict';

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
  // Kept out of the allowance but still spent: shown so the meter stays believable
  const excludedMonth = DB.state.transactions.filter(
    (t) => t.type === 'expense' && t.date >= r.from && t.date <= r.to &&
      budgetSkipReason(t)).reduce((s, t) => s + t.amount, 0);
  const today = U.todayISO();
  const isCurrent = today >= r.from && today <= r.to;
  const out = {
    amount: b.amount, mode: b.mode || 'monthly', D, spentMonth, excludedMonth,
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

/* ---- Expenses that shouldn't shape the daily allowance ----
   A car repair or an annual insurance bill is real money, but averaging it across
   the days left says "you have nothing to spend for three weeks", which is wrong
   and unhelpful at once. Such an expense is kept out of the *allowance* only: it
   still counts in Net, Stats, category totals and the account balance. */

function budgetSkipCfg() {
  return Object.assign({ categories: [], keywords: [] }, DB.state.meta.budgetSkip || {});
}

/** 'once' | 'category' | 'keyword' when this expense sits outside the budget,
    else null. `excludeFromBudget` is deliberately tri-state: true and false are
    the user's explicit word either way, and undefined defers to the rules — so
    re-including one charge doesn't mean abandoning the rule that caught it. */
function budgetSkipReason(t) {
  if (t.excludeFromBudget === true) return 'once';
  if (t.excludeFromBudget === false) return null;
  const cfg = budgetSkipCfg();
  if (t.categoryId && cfg.categories.includes(t.categoryId)) return 'category';
  const note = String(t.note || '').toLowerCase();
  if (note) {
    for (const k of cfg.keywords) {
      const text = String(k && k.text || '').trim().toLowerCase();
      if (text && note.includes(text)) return 'keyword';
    }
  }
  return null;
}

/** Should this transaction draw down the ordinary monthly budget? */
function countsInBudget(t) {
  if (budgetSkipReason(t)) return false;
  const trip = tripExpenseOf(t);
  return !(trip && trip.budget > 0);   // only a budgeted trip has its own pot
}

/* Expenses in the shown month that are far out of line with what this user
   normally spends in that same category. Deliberately relative, not a size
   threshold: rent is the largest line every month and must never be flagged,
   while a 35 € charge in a category that usually sees 8 € should be. */
function budgetOutliers() {
  const FACTOR = 3;         // at least 3x the category's own median
  const MIN_HISTORY = 4;    // fewer past charges than this and we can't judge
  if (ui.period.type !== 'month') return [];
  const r = U.monthRange(ui.period.y, ui.period.m0);
  // Six months back. Built through Date so the year rolls; U.monthRange composes
  // the string arithmetically and would render a negative month as "2026--5".
  const p = new Date(ui.period.y, ui.period.m0 - 6, 1);
  const priorFrom = p.getFullYear() + '-' +
    String(p.getMonth() + 1).padStart(2, '0') + '-01';
  const candidates = DB.state.transactions.filter(
    (t) => t.type === 'expense' && t.date >= r.from && t.date <= r.to &&
      t.excludeFromBudget === undefined && !budgetSkipReason(t) && t.categoryId);
  if (!candidates.length) return [];

  const history = new Map();       // categoryId -> past amounts, this month excluded
  for (const t of DB.state.transactions) {
    if (t.type !== 'expense' || !t.categoryId) continue;
    if (t.date >= r.from || t.date < priorFrom) continue;
    if (!history.has(t.categoryId)) history.set(t.categoryId, []);
    history.get(t.categoryId).push(t.amount);
  }

  const out = [];
  for (const t of candidates) {
    if (isProtectedRecurring(t)) continue;              // a confirmed subscription
    const past = history.get(t.categoryId);
    if (!past || past.length < MIN_HISTORY) continue;   // no basis to judge
    const typical = median(past);
    if (!(typical > 0)) continue;
    const ratio = t.amount / typical;
    if (ratio < FACTOR) continue;
    /* An amount this category has already seen twice is a standing charge, not an
       anomaly. Without this, rent filed under "Bills" reads as "9× your usual"
       every single month — the utilities drag the median down, and each month's
       rent is a fresh transaction, so the prompt would never stop. */
    const near = past.filter((a) =>
      Math.abs(a - t.amount) <= Math.max(1, t.amount * 0.05)).length;
    if (near >= 2) continue;
    out.push({ tx: t, typical, ratio });
  }
  return out.sort((a, b) => b.tx.amount - a.tx.amount).slice(0, 3);
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

/* Two standing ways to keep spending out of the daily allowance: a whole category
   that simply isn't daily spending, and a keyword in the note — the same idea as
   the category rules, so it needs no new concept explaining. */
function openBudgetSkipSheet() {
  openSheet('Not daily spending', (body, api) => {
    const cfg = budgetSkipCfg();
    const cats = new Set(cfg.categories);
    let keywords = cfg.keywords.map((k) => ({ id: k.id || U.uid(), text: k.text }));

    body.append(el('p', { class: 'muted', style: 'line-height:1.5;margin-bottom:14px', text:
      'Spending kept out of the daily allowance, so one heavy month doesn\'t leave ' +
      'you with nothing to spend for three weeks. It still counts in your balance, ' +
      'Net and every stat — it just doesn\'t shape the per-day figure.' }));

    body.append(el('div', { class: 'field' },
      [el('label', { text: 'Categories that aren\'t daily spending' })]));
    DB.state.categories.forEach((c) => {
      const cb = el('input', { type: 'checkbox' });
      cb.checked = cats.has(c.id);
      cb.addEventListener('change', () => {
        if (cb.checked) cats.add(c.id); else cats.delete(c.id);
      });
      body.append(el('label', { class: 'switch-row' }, [
        el('span', { class: 'cat-cell-icon', text: c.icon,
          style: 'background:' + U.tintOf(c.color) }),
        el('span', { class: 's-main', text: c.name }),
        cb
      ]));
    });

    body.append(el('hr', { class: 'sep' }),
      el('div', { class: 'field' }, [el('label', { text: 'Keywords in the note' })]),
      el('p', { class: 'muted', style: 'line-height:1.5;margin-bottom:10px', text:
        'Any expense whose note contains one of these stays out of the daily budget. ' +
        'Case doesn\'t matter. Useful for things like TASSE, ASSICURAZIONE or DENTISTA.' }));

    const list = el('div');
    const drawList = () => {
      list.innerHTML = '';
      if (!keywords.length) {
        list.append(el('p', { class: 'muted', text: 'No keywords yet.' }));
      }
      keywords.forEach((k) => {
        list.append(el('div', { class: 'rule-row' }, [
          el('span', { class: 'rule-kw', text: k.text }),
          el('button', { class: 'btn small ghost', text: 'Remove', onclick: () => {
            keywords = keywords.filter((x) => x.id !== k.id); drawList();
          } })
        ]));
      });
    };
    drawList();

    const input = el('input', { type: 'text', placeholder: 'e.g. ASSICURAZIONE',
      autocomplete: 'off', autocapitalize: 'characters' });
    const add = () => {
      const text = input.value.trim();
      if (!text) return;
      if (keywords.some((k) => k.text.toLowerCase() === text.toLowerCase())) {
        return toast('Already there');
      }
      keywords.push({ id: U.uid(), text });
      input.value = ''; drawList();
    };
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') add(); });

    body.append(list, el('div', { class: 'field-row' }, [
      el('div', { class: 'field', style: 'flex:1' }, [input]),
      el('button', { class: 'btn', text: 'Add', onclick: add })
    ]));

    body.append(el('div', { class: 'spacer' }), el('button', {
      class: 'btn block primary', text: 'Save', onclick: async () => {
        await DB.setMeta('budgetSkip', { categories: [...cats], keywords });
        api.close(); toast('Saved'); render();
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
      ' · ' + (bs.mode === 'daily' ? fmtEUR(bs.dailyBase) + '/day base' : 'monthly cap') +
      // Say it out loud: money that left without moving the meter must be visible,
      // or the meter quietly stops meaning anything.
      (bs.excludedMonth > 0 ? ' · ' + fmtEUR(bs.excludedMonth) + ' excluded' : '') })
  );

  // One-off spikes: offered, never decided for the user
  budgetOutliers().forEach((o) => {
    const c = DB.category(o.tx.categoryId);
    const row = el('div', { class: 'budget-outlier' });
    const apply = async (exclude) => {
      await DB.put('transactions', Object.assign({}, o.tx, { excludeFromBudget: exclude }));
      await bumpChanges(1);
      render();
      if (exclude) toast('Left out of the daily budget');
    };
    row.append(
      el('div', { class: 'bo-main' }, [
        el('div', { class: 'bo-title', text: fmtEUR(o.tx.amount) + ' · ' +
          (c ? c.name : 'Uncategorized') }),
        el('div', { class: 'bo-sub muted', text: Math.round(o.ratio) + '× your usual ' +
          fmtEUR(o.typical) + ' — leave it out of the daily budget?' })
      ]),
      el('div', { class: 'bo-actions' }, [
        el('button', { class: 'btn small', text: 'Keep', onclick: () => apply(false) }),
        el('button', { class: 'btn small primary', text: 'Leave out',
          onclick: () => apply(true) })
      ])
    );
    card.append(row);
  });
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
