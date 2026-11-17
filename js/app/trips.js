/* Trips: accounting rules, trip budgets and foreign currency, detection, the Trips view, trip sheets and charts. */
'use strict';

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

/** Trip spending vs its own budget. */
function tripBudgetStatus(trip) {
  if (!trip || !trip.budget) return null;
  // An expense excluded from the budget is excluded from whichever pot it lands in
  const txs = DB.state.transactions.filter(
    (t) => t.type === 'expense' && t.date >= trip.from && t.date <= trip.to &&
      !isProtectedRecurring(t) && !budgetSkipReason(t));
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
  /* Money spent on the trip that deliberately doesn't draw on its pot. Reported so
     the meter can say why it disagrees with the trip's own total, instead of the
     two numbers silently differing. */
  const excluded = DB.state.transactions.filter(
    (t) => t.type === 'expense' && t.date >= trip.from && t.date <= trip.to &&
      !isProtectedRecurring(t) && budgetSkipReason(t))
    .reduce((s, t) => s + t.amount, 0);
  return {
    trip, spent, budget: trip.budget, remaining: trip.budget - spent, excluded,
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

/* ---------------- Trips ----------------
   A trip is a named date range. Detection looks for a burst of places you
   don't normally go: >= 3 charges over 2-14 consecutive days where most
   merchants were never seen in the 120 days before. Always a suggestion. */

const trips = () => (DB.state.meta.trips || []).slice()
  .sort((a, b) => b.from.localeCompare(a.from));

/* What the trip cost — one definition, used by every figure on the trip sheet.
   A trip is a *date range*, so it sweeps up whatever happened to be charged while you
   were away. Two kinds of spending are therefore not travel: a confirmed subscription
   billed mid-trip, and anything you deliberately held back from the budget — the only
   way to say "this isn't my normal spending". Both are left out here, in the charts
   and in the budget meter alike, so the sheet never shows two totals for one trip. */
function tripTotals(trip) {
  const txs = DB.state.transactions.filter(
    (t) => t.date >= trip.from && t.date <= trip.to &&
      !isProtectedRecurring(t) && !budgetSkipReason(t));
  const spent = txs.filter((t) => t.type === 'expense').reduce((s, t) => s + t.amount, 0);
  const days = Math.round((new Date(trip.to) - new Date(trip.from)) / 86400000) + 1;
  const aheadTxs = tripBookedAhead(trip);
  const ahead = aheadTxs.reduce((s, t) => s + t.amount, 0);
  return {
    txs, spent, days,
    // Per day means the days you were there, so a flight bought in May can't
    // inflate it — 120 € of tickets would otherwise add 12 €/day to a 10-day trip.
    perDay: days ? spent / days : 0,
    aheadTxs, ahead, total: spent + ahead
  };
}

/* Expenses attached to a trip by hand — a flight, a hotel deposit, insurance —
   bought before you left, so no date rule could ever find them. They count toward
   what the trip cost, and deliberately nothing else: the money left in May, so it
   stays in May's budget and May's stats exactly where it already was.
   Only out-of-range ones are "booked ahead"; inside the dates the date rule already
   counts them, and honouring the tag too would count them twice. */
/** Pick past expenses to attach to a trip. Candidates are expenses outside the trip
    dates and not already claimed by another trip; the ones near the trip come first,
    since a flight is usually bought within a few months of leaving. */
function openTripAttachSheet(trip, onDone) {
  openSheet('Travel & bookings', (body, api) => {
    const saved = new Set(tripTagged(trip).map((t) => t.id));
    const chosen = new Set(saved);
    const inTrip = (iso) => iso >= trip.from && iso <= trip.to;
    const dayGap = (iso) => {
      const d = new Date(iso + 'T12:00:00');
      if (iso < trip.from) return (new Date(trip.from + 'T12:00:00') - d) / 86400000;
      return (d - new Date(trip.to + 'T12:00:00')) / 86400000;
    };
    /* Expenses during the trip are offered too. A flight home bought on day 8 is
       travel just as much as the outbound one — it is simply already counted, so
       tagging it groups it here without changing any total.
       Order matters more than it looks: sorting purely by nearness puts every meal
       of the trip above the bookings, and you open this screen looking for a ticket.
       So: what's already attached, then bookings around the trip, then the days
       themselves — with search for anything specific. */
    const candidates = DB.state.transactions
      .filter((t) => t.type === 'expense' && (!t.tripId || t.tripId === trip.id));
    /* Three groups with their own limits, instead of one ranked list. Ranking alone
       starved the during-the-trip rows: with a long history the whole of it outranks
       them, so a ticket bought on the trip never reached the visible slice at all. */
    const groups = [
      { key: 'attached', title: 'Attached',
        rows: candidates.filter((t) => saved.has(t.id))
          .sort((a, b) => a.date.localeCompare(b.date)) },
      { key: 'around', title: 'Around the trip',
        rows: candidates.filter((t) => !saved.has(t.id) && !inTrip(t.date))
          .sort((a, b) => dayGap(a.date) - dayGap(b.date)) },
      { key: 'during', title: 'During the trip',
        rows: candidates.filter((t) => !saved.has(t.id) && inTrip(t.date))
          .sort((a, b) => b.date.localeCompare(a.date)) }
    ];

    body.append(el('p', { class: 'muted', style: 'line-height:1.5;margin-bottom:12px', text:
      'The cost of getting there and back. Anything paid before you left is added to ' +
      'what the trip cost and stays in the month you paid it; anything bought during ' +
      'the trip already counts, and is listed here for the record.' }));

    const search = el('input', { class: 'searchbox', type: 'search',
      placeholder: 'Search by note, category or amount…', autocomplete: 'off' });
    const list = el('div');
    const count = el('div', { class: 'muted', style: 'margin:6px 0' });

    const PER_GROUP = 30;
    const draw = () => {
      const q = String(search.value || '').trim().toLowerCase();
      const matches = (t) => {
        if (!q) return true;
        const c = DB.category(t.categoryId);
        return ((t.note || '') + ' ' + (c ? c.name : '') + ' ' +
          t.amount.toFixed(2).replace('.', ',')).toLowerCase().includes(q);
      };
      list.innerHTML = '';
      let any = false;
      groups.forEach((g) => {
        const hits = g.rows.filter(matches);
        if (!hits.length) return;
        any = true;
        list.append(el('div', { class: 'pick-group muted', text: g.title }));
        // Searching looks through everything; only the resting list is trimmed
        (q ? hits : hits.slice(0, PER_GROUP)).forEach((t) => row(t, list));
        if (!q && hits.length > PER_GROUP) {
          list.append(el('p', { class: 'muted', style: 'padding:4px 0', text:
            '…and ' + (hits.length - PER_GROUP) + ' more — search to find them' }));
        }
      });
      if (!any) list.append(el('p', { class: 'muted', text: 'Nothing matches.' }));
    };
    const row = (t, into) => {
        const c = DB.category(t.categoryId);
        const cb = el('input', { type: 'checkbox' });
        cb.checked = chosen.has(t.id);
        cb.addEventListener('change', () => {
          if (cb.checked) chosen.add(t.id); else chosen.delete(t.id);
          sync();
        });
        into.append(el('label', { class: 'switch-row' }, [
          el('span', { class: 'tx-icon', text: c ? c.icon : '🎫',
            style: 'background:' + U.tintOf(c ? c.color : 'blue') }),
          el('div', { class: 's-main' }, [
            el('div', { text: t.note || (c ? c.name : 'Expense') }),
            el('div', { class: 's-sub muted', text:
              U.fmtDate(t.date, { day: 'numeric', month: 'short', year: 'numeric' }) +
              ' · ' + fmtEUR(t.amount) +
              (!inTrip(t.date) ? ''
                : countsAsTripSpending(trip, t)
                  ? ' · during the trip, already counted'
                  : ' · during the trip, outside its budget') })
          ]),
          cb
        ]));
    };
    /* The list can run to dozens of rows, so a Save button after it is a long scroll
       away from the tick that needed saving. The bar sticks to the bottom of the
       sheet instead, and only appears once there is actually something to save —
       including un-ticking everything, which is a change worth keeping too. */
    const saveBtn = el('button', { class: 'btn primary', text: 'Save' });
    const barText = el('div', { class: 'savebar-text' });
    const bar = el('div', { class: 'savebar' }, [barText, saveBtn]);
    const sync = () => {
      const sum = candidates.filter((t) => chosen.has(t.id))
        .reduce((s, t) => s + t.amount, 0);
      count.textContent = chosen.size
        ? chosen.size + (chosen.size === 1 ? ' item · ' : ' items · ') + fmtEUR(sum)
        : 'Nothing selected yet';
      const dirty = chosen.size !== saved.size ||
        [...chosen].some((id) => !saved.has(id));
      api.setFooter(dirty ? bar : null);
      barText.textContent = 'Unsaved changes';
    };
    search.addEventListener('input', draw);
    draw();

    body.append(el('div', { class: 'field' }, [search]), count, list);
    sync();                      // after the body exists, so the footer can attach
    Object.assign(saveBtn, { onclick: async () => {
        /* Write only what changed: attach the newly ticked, detach the unticked.
           Everything else about the transaction is left exactly as it was. */
        const updates = [];
        candidates.forEach((t) => {
          const want = chosen.has(t.id);
          const has = t.tripId === trip.id;
          if (want === has) return;
          const next = Object.assign({}, t);
          if (want) next.tripId = trip.id; else delete next.tripId;
          updates.push(next);
        });
        if (updates.length) {
          await DB.bulkPut('transactions', updates);
          await bumpChanges(updates.length);
        }
        api.close();
        if (onDone) onDone();
        toast(chosen.size ? chosen.size + ' attached to ' + trip.name : 'Nothing attached');
    } });
  }, { tall: true });
}

function tripTagged(trip) {
  if (!trip || !trip.id) return [];
  return DB.state.transactions
    .filter((t) => t.type === 'expense' && t.tripId === trip.id)
    .sort((a, b) => a.date.localeCompare(b.date));
}

/** Does the date rule already count this expense in the trip's spending? */
function countsAsTripSpending(trip, t) {
  return t.date >= trip.from && t.date <= trip.to &&
    !isProtectedRecurring(t) && !budgetSkipReason(t);
}

/* Tagged costs that the trip total doesn't already include, and so must be added.
   Three things land here, and one rule covers all of them rather than a list of
   special cases: bought before leaving; bought during the trip but held back from
   the budget (a ticket you didn't want eating the daily allowance — still a real
   cost of the trip); or a confirmed subscription. A return bus bought on day 8 and
   left in the budget is *not* here, because the date rule already counted it and
   adding it again would double it. */
function tripBookedAhead(trip) {
  return tripTagged(trip).filter((t) => !countsAsTripSpending(trip, t));
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
          // What the trip cost, booked-ahead included — matches the sheet's headline.
          // Mixed currencies can only be added in euro, so fall back to it.
          el('div', { class: 'trip-amt',
            text: t.ahead > 0 ? fmtEUR(t.total) : fmtTripMoney(tr, t.spent) }),
          tr.budget ? el('div', { class: 'trip-bud ' +
            (t.spent > tr.budget ? 'neg' : 'muted'),
            text: 'of ' + fmtTripMoney(tr, tr.budget) }) : null
        ]),
        el('span', { class: 's-chev', text: '›' })
      ]));
    });
    const grand = saved.reduce((s, tr) => s + tripTotals(tr).total, 0);
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
    const emojiWrap = el('div');   // the picker brings its own grid
    // Same freedom as categories: the eight are shortcuts, not the whole menu
    const EMOJIS = ['✈️', '🚆', '🏖️', '⛰️', '🏙️', '🎪', '🎿', '🚗'];
    emojiWrap.append(emojiPicker(draft.emoji, EMOJIS, (e) => { draft.emoji = e; }));
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
    /* With booked-ahead costs the headline is the full cost of the trip. On a
       foreign-currency trip that has to be euro: the tickets were paid in euro and
       local currency can't add to them. Without any, nothing changes. */
    const hasAhead = t.ahead > 0;
    const headLines = [
      el('div', { class: 'cat-detail-total',
        text: hasAhead ? fmtEUR(t.total) : fmtTripMoney(trip, t.spent) })
    ];
    if (hasAhead) {
      headLines.push(el('div', { class: 'muted', text:
        fmtTripMoney(trip, t.spent) + (tripHasFx(trip) ? ' (≈ ' + fmtEUR(t.spent) + ')' : '') +
        ' on the trip · + ' + fmtEUR(t.ahead) + ' booked ahead' }));
    }
    headLines.push(el('div', { class: 'muted', text:
      (tripHasFx(trip) && !hasAhead ? '≈ ' + fmtEUR(t.spent) + ' · ' : '') +
      t.days + ' days · ' + fmtTripMoney(trip, t.perDay) + ' per day' }));
    body.append(el('div', { class: 'cat-detail-head' }, headLines));
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

    /* Booked-ahead costs sit apart from the charts on purpose: a flight bought in
       May has no day inside the trip to be drawn on, and folding it into the donut
       would make the charts stop adding up to the days you were actually there. */
    if (trip.id) {
      const ahead = el('div', { class: 'card' });
      const drawAhead = () => {
        ahead.innerHTML = '';
        const list = tripTagged(trip);
        const sum = list.reduce((s, x) => s + x.amount, 0);
        const aheadSum = tripBookedAhead(trip).reduce((s, x) => s + x.amount, 0);
        const duringSum = sum - aheadSum;
        ahead.append(el('div', { class: 'card-head' }, [
          el('h2', { text: 'Travel & bookings' }),
          el('button', { class: 'btn small', text: '+ Add',
            onclick: () => openTripAttachSheet(trip, () => {
              drawAhead();
              render();                 // totals above this card moved too
            }) })
        ]));
        if (!list.length) {
          ahead.append(el('p', { class: 'muted', style: 'line-height:1.5', text:
            'Flights, hotels, insurance, the bus home — the cost of getting there and ' +
            'back. Anything paid before you left is added to what the trip cost, and ' +
            'stays in the month you actually paid it.' }));
          return;
        }
        list.forEach((x) => {
          const c = DB.category(x.categoryId);
          ahead.append(el('div', { class: 'ahead-row' }, [
            el('span', { class: 'tx-icon', text: c ? c.icon : '🎫',
              style: 'background:' + U.tintOf(c ? c.color : 'blue') }),
            el('div', { class: 'ahead-main' }, [
              el('div', { class: 'ahead-name', text: x.note || (c ? c.name : 'Expense') }),
              el('div', { class: 'ahead-sub muted', text:
                U.fmtDate(x.date, { day: 'numeric', month: 'short', year: 'numeric' }) +
                ' · ' + (x.date < trip.from || x.date > trip.to ? 'booked ahead'
                  : countsAsTripSpending(trip, x) ? 'during the trip'
                  : 'during the trip · outside its budget') })
            ]),
            // Always euro: these were paid at home, not at the trip's rate
            el('div', { class: 'ahead-amt', text: fmtEUR(x.amount) }),
            el('button', { class: 'btn small ghost', text: '✕', 'aria-label': 'Remove',
              onclick: async () => {
                const next = Object.assign({}, x); delete next.tripId;
                await DB.put('transactions', next);
                drawAhead(); render();
              } })
          ]));
        });
        ahead.append(el('div', { class: 'budget-line', style: 'margin-top:8px' }, [
          el('span', { class: 'muted', text: list.length +
            (list.length === 1 ? ' item' : ' items') }),
          el('span', { text: fmtEUR(sum) })
        ]));
        /* Two kinds sit in this list and they reach the total differently, so say
           which is which rather than leaving the arithmetic unexplained. */
        ahead.append(el('p', { class: 'muted', style: 'margin-top:6px;line-height:1.5',
          text: duringSum > 0.005
            ? fmtEUR(aheadSum) + ' was paid before the trip and is added to its total, ' +
              'outside the trip budget. ' + fmtEUR(duringSum) + ' was spent during the ' +
              'trip and already counts in both.'
            : 'Counted in the trip total, not in the trip budget — this money already ' +
              'came out of the month you paid it.' }));
      };
      drawAhead();
      body.append(ahead);
    }

    tripCharts(body, trip);

    body.append(el('div', { class: 'sub-title', style: 'margin-top:16px', text: 'Places' }));
    const rg = { from: trip.from, to: trip.to, label: trip.name };
    groups.forEach((g) => {
      body.append(el('button', { class: 'place-row',
        onclick: () => openMerchantDetail(g, rg) }, [
        el('div', { class: 'place-main' }, [
          el('div', { class: 'place-name', text: g.label }),
          el('div', { class: 'place-count', text: g.count + (g.count === 1 ? ' charge' : ' charges') })
        ]),
        el('div', { class: 'place-total', text: fmtTripMoney(trip, g.total) }),
        el('span', { class: 'catbar-chev', text: '›' })
      ]));
    });
  }, { tall: true });
}

/* A trip is its own little period, so it deserves the same treatment the month
   gets in Stats: where the money went, which days were heavy, and — when there
   is a budget — whether the pace is going to hold. Everything is drawn in the
   trip's own currency, since that's what you were reading off price tags. */
function tripCharts(body, trip) {
  // Exactly the set tripTotals counts, so the charts add up to the headline
  const exp = DB.state.transactions.filter(
    (t) => t.type === 'expense' && t.date >= trip.from && t.date <= trip.to &&
      !isProtectedRecurring(t) && !budgetSkipReason(t));
  if (!exp.length) {
    body.append(el('div', { class: 'empty', html:
      '<span class="big">🧳</span>No spending recorded on this trip yet' }));
    return;
  }
  /* Spending inside the dates that isn't travel. Reported below rather than simply
     vanishing — the trip total is narrower than "everything charged that week", and
     the difference should be visible somewhere. */
  const inDates = DB.state.transactions.filter(
    (t) => t.type === 'expense' && t.date >= trip.from && t.date <= trip.to);
  const skippedSubs = inDates.filter(isProtectedRecurring)
    .reduce((s, t) => s + t.amount, 0);
  const skippedBudget = inDates.filter(
    (t) => !isProtectedRecurring(t) && budgetSkipReason(t))
    .reduce((s, t) => s + t.amount, 0);
  const skipped = skippedSubs + skippedBudget;

  const fx = tripHasFx(trip);
  const loc = (eur) => (fx ? eur / trip.rate : eur);
  const fmtL = (v) => (fx ? U.fmtCur(v, trip.currency) : fmtEUR(v));
  const total = exp.reduce((s, t) => s + t.amount, 0);

  // ---- Day by day ----
  const days = [];
  for (let d = new Date(trip.from + 'T12:00:00'); isoOf(d) <= trip.to; d.setDate(d.getDate() + 1)) {
    days.push(isoOf(d));
  }
  const byDay = new Map();
  exp.forEach((t) => byDay.set(t.date, (byDay.get(t.date) || 0) + t.amount));
  const dayData = days.map((iso, i) => ({
    iso, label: U.fmtDate(iso, { weekday: 'short', day: 'numeric', month: 'short' }),
    tickLabel: String(i + 1), value: Math.round(loc(byDay.get(iso) || 0) * 100) / 100
  }));
  const perDay = loc(total) / days.length;
  const dayCard = el('div', { class: 'card' }, [
    el('div', { class: 'card-head' }, [
      el('h2', { text: 'Day by day' }),
      el('span', { class: 'muted', text: fmtL(perDay) + ' avg' })
    ])
  ]);
  const dayWrap = el('div', { class: 'chart-wrap' });
  dayCard.append(dayWrap, el('div', { class: 'trend-cap muted',
    text: 'Day 1 to ' + days.length + ' · tap a day to see what you bought.' }));
  body.append(dayCard);
  requestAnimationFrame(() => Charts.bars(dayWrap, dayData, {
    color: U.colorOf('blue'), formatValue: fmtL,
    refLine: trip.budget > 0 ? loc(trip.budget / days.length) : null,
    refLabel: trip.budget > 0 ? 'daily pace' : '',
    onBar: (d) => openDayDetail(d.iso)
  }));

  // ---- Where it went ----
  const byCat = new Map();
  exp.forEach((t) => byCat.set(t.categoryId, (byCat.get(t.categoryId) || 0) + t.amount));
  const ranked = [...byCat.entries()].sort((a, b) => b[1] - a[1]);
  let items = ranked.map(([id, value]) => {
    const c = DB.category(id);
    return { id, value, label: c ? c.name : 'Uncategorized',
      color: U.colorOf(c ? c.color : 'blue') };
  });
  if (items.length > 7) {
    const rest = items.slice(6);
    items = items.slice(0, 6);
    items.push({ id: '__other', value: rest.reduce((s, d) => s + d.value, 0),
      label: 'Other', color: '#898781' });
  }
  const catCard = el('div', { class: 'card' }, [
    el('div', { class: 'card-head' }, [
      el('h2', { text: 'Where it went' }),
      el('span', { class: 'muted', text: byCat.size + (byCat.size === 1 ? ' category' : ' categories') })
    ])
  ]);
  const donutWrap = el('div', { class: 'chart-wrap' });
  catCard.append(donutWrap);
  const maxV = ranked.length ? ranked[0][1] : 0;
  ranked.forEach(([id, value]) => {
    const c = DB.category(id);
    const share = total > 0 ? Math.round((value / total) * 100) : 0;
    catCard.append(el('button', { class: 'catbar',
      onclick: () => openCategoryDetail(c, { from: trip.from, to: trip.to }, trip.name) }, [
      el('span', { class: 'catbar-icon', text: c ? c.icon : '?',
        style: 'background:' + U.tintOf(c ? c.color : 'blue') }),
      el('div', { class: 'catbar-main' }, [
        el('div', { class: 'catbar-top' }, [
          el('span', { class: 'catbar-name', text: c ? c.name : 'Uncategorized' }),
          el('span', { class: 'catbar-val', text: fmtL(loc(value)) })
        ]),
        el('div', { class: 'catbar-track' }, [
          el('div', { class: 'catbar-fill', style: 'width:' +
            (maxV > 0 ? (value / maxV) * 100 : 0) + '%;background:' +
            U.colorOf(c ? c.color : 'blue') })
        ])
      ]),
      el('span', { class: 'catbar-pct', text: share + '%' }),
      el('span', { class: 'catbar-chev', text: '›' })
    ]));
  });
  body.append(catCard);
  requestAnimationFrame(() => Charts.donut(donutWrap,
    items.map((d) => ({ id: d.id, label: d.label, value: d.value, color: d.color })),
    { centerLabel: 'Spent', centerValue: fmtL(loc(total)) }));

  // ---- Pace against the budget ----
  if (trip.budget > 0) {
    const today = U.todayISO();
    const pts = []; let acc = 0;
    for (let i = 0; i < days.length; i++) {
      if (days[i] > today) break;              // an unfinished trip stops at today
      acc += byDay.get(days[i]) || 0;
      pts.push({ tick: String(i + 1), label: 'Day ' + (i + 1),
        value: Math.round(loc(acc) * 100) / 100 });
    }
    if (pts.length) {
      const straight = days.map((iso, i) => ({ tick: String(i + 1), label: 'Day ' + (i + 1),
        value: Math.round(loc(trip.budget / days.length) * (i + 1) * 100) / 100 }));
      const paceCard = el('div', { class: 'card' }, [
        el('div', { class: 'card-head' }, [
          el('h2', { text: 'Pace' }),
          el('span', { class: 'muted', text: 'day ' + pts.length + ' of ' + days.length })
        ]),
        el('div', { class: 'legend-inline' }, [
          legendKey(U.colorOf('blue'), 'Spent'),
          legendKey(U.colorOf('red'), 'On budget')
        ])
      ]);
      const paceWrap = el('div', { class: 'chart-wrap' });
      const gap = pts[pts.length - 1].value - straight[pts.length - 1].value;
      paceCard.append(paceWrap, el('div', { class: 'trend-cap' }, [
        el('span', { class: gap > 0 ? 'neg' : 'pos',
          text: fmtL(Math.abs(gap)) + (gap > 0 ? ' ahead of ' : ' behind ') }),
        el('span', { class: 'muted', text: 'an even spend by day ' + pts.length + '.' })
      ]));
      body.append(paceCard);
      requestAnimationFrame(() => Charts.multiLine(paceWrap, [
        { label: 'Spent', color: U.colorOf('blue'), points: pts },
        { label: 'On budget', color: U.colorOf('red'), dash: true, points: straight }
      ], { formatValue: fmtL }));
    }
  }

  if (skipped > 0) {
    body.append(el('p', { class: 'muted', style: 'margin-top:10px;line-height:1.5', text:
      'Not counted as travel: ' +
      [skippedSubs > 0 ? fmtEUR(skippedSubs) + ' of confirmed subscriptions' : null,
       skippedBudget > 0 ? fmtEUR(skippedBudget) + ' you kept out of the budget' : null]
        .filter(Boolean).join(' and ') +
      ', charged during these dates but part of normal life rather than the trip.' }));
  }
}
