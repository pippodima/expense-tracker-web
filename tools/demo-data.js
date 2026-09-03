#!/usr/bin/env node
/* Generates the synthetic dataset used for the README screenshots.

   Entirely invented — no real financial data belongs in a public repo. The output
   is a normal app backup file, so it loads through the same path as any other
   import (`DB.replaceAll`), and the screenshots can always be regenerated instead
   of being frozen PNGs nobody can reproduce.

   Deterministic: a seeded PRNG, so the same commit always renders the same charts.

   Usage:  node tools/demo-data.js [out.json]     (default: tools/demo-backup.json)  */

const fs = require('fs');
const path = require('path');

/* ---------- deterministic randomness ---------- */
/* mulberry32 — small, fast, good enough for fake groceries. */
let _s = 0x9e3779b9;
const rnd = () => {
  _s |= 0; _s = (_s + 0x6d2b79f5) | 0;
  let t = Math.imul(_s ^ (_s >>> 15), 1 | _s);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const between = (lo, hi) => lo + rnd() * (hi - lo);
const money = (lo, hi) => Math.round(between(lo, hi) * 100) / 100;
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
const chance = (p) => rnd() < p;

let n = 0;
const uid = () => 'demo-' + (++n).toString(36).padStart(4, '0');

/* ---------- calendar ---------- */
const TODAY = '2026-09-03';                    // the day these screenshots were taken
const START = '2025-08-01';                    // 13 months back: enough for the 12-month Trends window
const iso = (d) => d.toISOString().slice(0, 10);
const day = (s) => new Date(s + 'T12:00:00Z');
const addDays = (s, k) => { const d = day(s); d.setUTCDate(d.getUTCDate() + k); return iso(d); };
const daysInMonth = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();

/* Every month from START to TODAY, as [year, month] pairs. */
const months = [];
for (let y = 2025, m = 8; y < 2026 || m <= 9; m === 12 ? (m = 1, y++) : m++) {
  months.push([y, m]);
}
const mm = (m) => String(m).padStart(2, '0');
const dd = (d) => String(d).padStart(2, '0');
const dateOf = (y, m, d) => `${y}-${mm(m)}-${dd(d)}`;

/* ---------- reference data (mirrors DB.seed()) ---------- */
const CATS = [
  { id: uid(), name: 'Groceries',     icon: '🛒', color: 'green' },
  { id: uid(), name: 'Dining',        icon: '🍕', color: 'orange' },
  { id: uid(), name: 'Transport',     icon: '🚌', color: 'blue' },
  { id: uid(), name: 'Shopping',      icon: '🛍️', color: 'magenta' },
  { id: uid(), name: 'Bills',         icon: '💡', color: 'yellow' },
  { id: uid(), name: 'Health',        icon: '💊', color: 'red' },
  { id: uid(), name: 'Entertainment', icon: '🎬', color: 'violet' },
  { id: uid(), name: 'Salary',        icon: '💰', color: 'aqua' },
  { id: uid(), name: 'Other',         icon: '📦', color: 'blue' }
];
const cat = (name) => CATS.find((c) => c.name === name).id;

const ACCOUNTS = [
  { id: uid(), name: 'Checking', type: 'checking', startingBalance: 1850 },
  { id: uid(), name: 'Cash',     type: 'cash',     startingBalance: 40 },
  { id: uid(), name: 'Savings',  type: 'savings',  startingBalance: 4200 }
];
const CHECKING = ACCOUNTS[0].id, CASH = ACCOUNTS[1].id, SAVINGS = ACCOUNTS[2].id;

const RULES = [
  ['ESSELUNGA', 'Groceries'], ['COOP', 'Groceries'], ['CONAD', 'Groceries'],
  ['LIDL', 'Groceries'], ['CARREFOUR', 'Groceries'], ['AMAZON', 'Shopping'],
  ['TRENITALIA', 'Transport'], ['ATM ', 'Transport'], ['FARMACIA', 'Health'],
  ['NETFLIX', 'Entertainment'], ['STIPENDIO', 'Salary']
].map(([keyword, c]) => ({ id: uid(), keyword, categoryId: cat(c) }));

/* Merchants worth repeating, so "Places" and the subscription detector have
   something real to group. */
const GROCERS = ['ESSELUNGA SUPERSTORE', 'COOP MILANO SOLARI', 'CONAD CITY', 'LIDL ITALIA',
  'CARREFOUR EXPRESS'];
const EATERIES = ['BAR CENTRALE', 'PIZZERIA DA MARIO', 'SUSHI ZEN', 'TRATTORIA AL PONTE',
  'MENSA UNIVERSITARIA', 'GELATERIA LA ROMANA'];
const SHOPS = ['AMAZON.IT', 'ZARA MILANO', 'DECATHLON', 'IKEA CORSICO', 'LIBRERIA FELTRINELLI'];

const txs = [];
const add = (t) => txs.push(Object.assign({ id: uid(), note: '' }, t));
const expense = (date, amount, note, category, accountId = CHECKING, extra = {}) =>
  add(Object.assign({ date, amount, type: 'expense', note, categoryId: cat(category), accountId }, extra));

/* ---------- the recurring skeleton of a month ---------- */
for (const [y, m] of months) {
  const last = daysInMonth(y, m);
  const capped = (d) => Math.min(d, last);
  const inFuture = (d) => dateOf(y, m, d) > TODAY;

  /* Income lands on the 27th; rent and the fixed bills at the start of the month. */
  if (!inFuture(capped(27))) {
    add({ date: dateOf(y, m, capped(27)), amount: 2340, type: 'income',
      note: 'STIPENDIO ACME SRL', categoryId: cat('Salary'), accountId: CHECKING });
  }
  if (!inFuture(1)) expense(dateOf(y, m, 1), 680, 'AFFITTO APPARTAMENTO', 'Bills');
  if (!inFuture(2)) expense(dateOf(y, m, 2), 12.99, 'NETFLIX.COM', 'Entertainment');
  if (!inFuture(3)) expense(dateOf(y, m, 3), 10.99, 'SPOTIFY P0A1B2', 'Entertainment');
  if (!inFuture(capped(8))) expense(dateOf(y, m, capped(8)), 9.99, 'ILIAD ITALIA', 'Bills');
  if (!inFuture(capped(14))) {
    expense(dateOf(y, m, capped(14)), money(48, 96), 'ENEL ENERGIA', 'Bills');
  }
  if (!inFuture(capped(5))) expense(dateOf(y, m, capped(5)), 39, 'ATM MILANO ABBONAMENTO', 'Transport');

  /* A standing order into savings, right after payday. */
  if (!inFuture(capped(28))) {
    add({ date: dateOf(y, m, capped(28)), amount: 250, type: 'transfer', note: 'Monthly saving',
      categoryId: null, accountId: CHECKING, toAccountId: SAVINGS });
  }
  /* One cash withdrawal a month — the reason a Cash account exists at all. */
  if (!inFuture(capped(10))) {
    add({ date: dateOf(y, m, capped(10)), amount: 100, type: 'transfer', note: 'PRELIEVO ATM BANCOMAT',
      categoryId: null, accountId: CHECKING, toAccountId: CASH });
  }

  /* ---------- the variable part ---------- */
  /* December and July run hot; a quiet February keeps "What changed" interesting. */
  const heat = m === 12 ? 1.45 : m === 7 ? 1.2 : m === 2 ? 0.8 : 1;

  for (let d = 1; d <= last; d++) {
    if (inFuture(d)) break;
    const date = dateOf(y, m, d);
    const weekend = [0, 6].includes(day(date).getUTCDay());
    /* The month in progress is what Home and "Pace this month" actually draw, and a
       run of empty days there reads as a broken app rather than a quiet week. Inside
       the last stretch before TODAY the everyday categories always fire. */
    const recent = date >= addDays(TODAY, -5) && date < TODAY;

    /* Today itself stays deliberately light. Home leads with "left to spend today",
       and a full day of random rolls lands it over budget about half the time —
       an accurate screenshot of an unlucky Tuesday, and a bad first impression. */
    if (date === TODAY) {
      expense(date, money(3.4, 7.2), 'BAR CENTRALE', 'Dining', CASH);
      continue;
    }

    if (recent || chance(0.34)) {
      expense(date, money(9, 62) * heat, pick(GROCERS), 'Groceries',
        chance(0.2) ? CASH : CHECKING);
    }
    if (recent || chance(weekend ? 0.42 : 0.22)) {
      expense(date, money(6, 38) * heat, pick(EATERIES), 'Dining', chance(0.35) ? CASH : CHECKING);
    }
    if (chance(0.07)) {
      expense(date, money(14, 130) * heat, pick(SHOPS), 'Shopping');
    }
    if (chance(0.05)) {
      expense(date, money(8, 44), chance(0.5) ? 'TRENITALIA' : 'ATM MILANO', 'Transport');
    }
    if (chance(0.035)) {
      expense(date, money(7, 42), 'FARMACIA SAN CARLO', 'Health');
    }
    if (chance(0.03)) {
      expense(date, money(9, 26), chance(0.5) ? 'CINEMA ANTEO' : 'STEAM GAMES', 'Entertainment');
    }
  }
}

/* ---------- the trip: Istanbul, priced in lira ---------- */
/* EUR stays canonical (`amount`); origAmount/origCurrency/rate ride alongside,
   exactly as the add sheet writes them inside a foreign-currency trip. */
const RATE = 0.0263;                                   // € per TRY (1 € ≈ 38 TRY)
const TRIP = { id: uid(), name: 'Istanbul', emoji: '🕌', from: '2026-06-12', to: '2026-06-21',
  budget: 1000, currency: 'TRY', rate: RATE, rateMode: 'per-eur' };

const TR_PLACES = [
  ['KARAKÖY LOKANTASI', 'Dining', 420, 1650],
  ['SIMIT SARAYI', 'Dining', 60, 190],
  ['MADO KADIKÖY', 'Dining', 180, 520],
  ['İSTANBULKART DOLUM', 'Transport', 100, 400],
  ['TAKSI', 'Transport', 220, 780],
  ['GRAND BAZAAR', 'Shopping', 350, 2400],
  ['MIGROS', 'Groceries', 120, 640],
  ['AYASOFYA MÜZE', 'Entertainment', 600, 1400],
  ['HAMAM ÇEMBERLITAS', 'Entertainment', 900, 1900]
];
for (let d = 0; d < 10; d++) {
  const date = addDays(TRIP.from, d);
  for (let k = 0, times = 2 + Math.floor(rnd() * 3); k < times; k++) {
    const [note, category, lo, hi] = pick(TR_PLACES);
    const orig = Math.round(between(lo, hi));
    expense(date, Math.round(orig * RATE * 100) / 100, note, category, CHECKING,
      { origAmount: orig, origCurrency: 'TRY', rate: RATE });
  }
}
/* The flights, booked in euro before leaving. */
expense('2026-05-28', 214.6, 'PEGASUS AIRLINES', 'Transport');

txs.sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));

/* ---------- meta ---------- */
/* Subscriptions are keyed by merchantKey(note) — the first non-generic token. */
const backup = {
  app: 'expense-tracker',
  version: 1,
  exportedAt: TODAY + 'T09:00:00.000Z',
  accounts: ACCOUNTS,
  categories: CATS,
  transactions: txs,
  rules: RULES,
  presets: [],
  meta: {
    budget: { amount: 1900, mode: 'daily' },
    trips: [TRIP],
    subscriptions: {
      confirmed: {
        NETFLIX: { label: 'NETFLIX.COM' },
        SPOTIFY: { label: 'SPOTIFY P0A1B2' },
        ILIAD:   { label: 'ILIAD ITALIA' },
        AFFITTO: { label: 'AFFITTO APPARTAMENTO' }
      },
      dismissed: []
    },
    categoryBudgets: { [cat('Groceries')]: 320, [cat('Dining')]: 180 },
    tripSettings: { excludeFromStats: true },
    /* A fresh backup with no changes since: silences both the passive nudge and the
       reminder popup, which would otherwise cover the screen we came to photograph. */
    lastBackup: Date.parse(TODAY + 'T09:00:00.000Z'),
    changesSinceBackup: 0,
    installedAt: Date.parse(START + 'T09:00:00.000Z')
  }
};

const out = process.argv[2] || path.join(__dirname, 'demo-backup.json');
fs.writeFileSync(out, JSON.stringify(backup, null, 2));

const spent = txs.filter((t) => t.type === 'expense').reduce((s, t) => s + t.amount, 0);
console.log(`${txs.length} transactions across ${months.length} months → ${out}`);
console.log(`  ${Math.round(spent).toLocaleString('it-IT')} € of expenses, ` +
  `${txs.filter((t) => t.type === 'transfer').length} transfers, ` +
  `${txs.filter((t) => t.origCurrency).length} in TRY`);
