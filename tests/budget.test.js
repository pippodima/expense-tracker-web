/* Reproduction: does a back-dated expense move the daily budget?
   Runs the REAL budgetStatus / tripBudgetStatus / countsInBudget from app.js. */
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');

const baseCtx = vm.createContext({ console, Intl, Date, Math, Number, String, Array,
  Object, JSON, setTimeout, clearTimeout, isFinite, crypto: { randomUUID: () => 'x' },
  window: { matchMedia: () => ({ matches: false }) },
  document: { createElement: () => ({ style: {}, setAttribute() {}, appendChild() {},
    addEventListener() {} }), body: { appendChild() {} }, querySelector: () => null },
  navigator: {}, URL: { createObjectURL: () => '', revokeObjectURL() {} }, Blob: class {} });
vm.runInContext(fs.readFileSync(ROOT + '/js/util.js', 'utf8') + '\nglobalThis.U = U;', baseCtx);
const realU = baseCtx.U;

const src = fs.readFileSync(ROOT + '/js/app.js', 'utf8');
function extract(name) {
  const start = src.indexOf('function ' + name + '(');
  if (start < 0) throw new Error('not found: ' + name);
  let depth = 0;
  for (let j = src.indexOf('{', start); j < src.length; j++) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}') { depth--; if (depth === 0) return src.slice(start, j + 1); }
  }
  throw new Error('unbalanced: ' + name);
}

/** A world with a pinned "today". */
function world({ today, budget, mode = 'daily', trips = [], txs = [], period }) {
  const U = Object.assign(Object.create(null), realU, { todayISO: () => today });
  const DB = {
    state: { transactions: txs.slice(), meta: { budget: { amount: budget, mode }, trips,
      subscriptions: { confirmed: {} } } },
    category: () => null
  };
  const ui = { period: period || { type: 'month', y: Number(today.slice(0, 4)),
    m0: Number(today.slice(5, 7)) - 1 } };
  const ctx = vm.createContext({ console, Date, Math, Number, String, Array, Object,
    U, DB, ui, merchantKey: (s) => String(s || '').toUpperCase().split(/\s+/)[0] });
  vm.runInContext([
    'const tripSettings = () => Object.assign({ excludeFromStats: true }, DB.state.meta.tripSettings || {});',
    extract('tripForDate'), extract('isProtectedRecurring'), extract('tripExpenseOf'),
    extract('budgetSkipCfg'), extract('budgetSkipReason'),
    extract('countsInStats'), extract('countsInBudget'),
    extract('budgetStatus'), extract('tripBudgetStatus'),
    'globalThis.bs = () => budgetStatus();',
    'globalThis.tbs = () => tripBudgetStatus(DB.state.meta.trips.find(t =>' +
      ' t.from <= U.todayISO() && t.to >= U.todayISO()) || null);'
  ].join('\n'), ctx);
  ctx.__add = (date, amount) => DB.state.transactions.push(
    { id: 'x' + Math.random(), date, amount, type: 'expense', categoryId: 'c1',
      accountId: 'a1', note: 'test' });
  ctx.__DB = DB;
  return ctx;
}

let fails = 0;
const ok = (n, c, extra) => {
  if (c) console.log('  ✓ ' + n);
  else { fails++; console.log('  ✗ ' + n + (extra ? ' — ' + extra : '')); }
};
const eur = (n) => (n == null ? 'n/a' : n.toFixed(2) + ' €');

console.log('SCENARIO A — plain monthly budget, no trip. 600 €, August, today = the 3rd');
{
  const w = world({ today: '2026-08-03', budget: 600 });
  const before = w.bs();
  console.log('   before:            today ' + eur(before.todayBudget) +
    ' · left today ' + eur(before.todayRemaining));
  w.__add('2026-08-02', 50);                       // yesterday
  const after = w.bs();
  console.log('   after 50 € on the 2nd: today ' + eur(after.todayBudget) +
    ' · left today ' + eur(after.todayRemaining) + ' · month spent ' + eur(after.spentMonth));
  ok('today\'s allowance drops', after.todayBudget < before.todayBudget);
  ok('the drop is the expense spread over the days left',
    Math.abs((before.todayBudget - after.todayBudget) - 50 / 29) < 0.01,
    (before.todayBudget - after.todayBudget).toFixed(4));
  ok('month spend includes it', Math.abs(after.spentMonth - 50) < 0.01);
}

console.log('\nSCENARIO B — same, but the expense is dated TODAY (control)');
{
  const w = world({ today: '2026-08-03', budget: 600 });
  const before = w.bs();
  w.__add('2026-08-03', 50);
  const after = w.bs();
  console.log('   left today: ' + eur(before.todayRemaining) + ' → ' + eur(after.todayRemaining));
  ok('today\'s expense hits today in full',
    Math.abs((before.todayRemaining - after.todayRemaining) - 50) < 0.01,
    (before.todayRemaining - after.todayRemaining).toFixed(2));
}

console.log('\nSCENARIO C — travelling, trip HAS its own budget (400 €, Aug 1–10)');
{
  const trip = { id: 't1', name: 'Istanbul', from: '2026-08-01', to: '2026-08-10', budget: 400 };
  const w = world({ today: '2026-08-03', budget: 600, trips: [trip] });
  const mb = w.bs(), tb = w.tbs();
  console.log('   monthly: left today ' + eur(mb.todayRemaining) +
    ' | trip: left today ' + eur(tb.todayRemaining));
  w.__add('2026-08-02', 100);                      // yesterday, inside the trip
  const mb2 = w.bs(), tb2 = w.tbs();
  console.log('   after 100 € on the 2nd:');
  console.log('     monthly: left today ' + eur(mb2.todayRemaining) +
    ' · month spent ' + eur(mb2.spentMonth));
  console.log('     trip:    left today ' + eur(tb2.todayRemaining) +
    ' · trip spent ' + eur(tb2.spent));
  ok('trip pot registers the spend', Math.abs(tb2.spent - 100) < 0.01);
  ok('trip allowance drops', tb2.todayAllowance < tb.todayAllowance);
  console.log('     → monthly budget deliberately unchanged: ' +
    (Math.abs(mb2.todayRemaining - mb.todayRemaining) < 0.001));
}

console.log('\nSCENARIO D — travelling, trip has NO budget of its own');
{
  const trip = { id: 't2', name: 'Weekend', from: '2026-08-01', to: '2026-08-10' };
  const w = world({ today: '2026-08-03', budget: 600, trips: [trip] });
  const before = w.bs();
  w.__add('2026-08-02', 100);
  const after = w.bs();
  console.log('   left today: ' + eur(before.todayRemaining) + ' → ' + eur(after.todayRemaining));
  ok('an unbudgeted trip still draws the monthly budget',
    after.todayBudget < before.todayBudget);
}

console.log('\nSCENARIO E — "yesterday" is in the PREVIOUS month (travelling over the 1st)');
{
  const w = world({ today: '2026-08-01', budget: 600 });
  const before = w.bs();
  w.__add('2026-07-31', 80);
  const after = w.bs();
  console.log('   left today: ' + eur(before.todayRemaining) + ' → ' + eur(after.todayRemaining));
  console.log('   (the 80 € belongs to July\'s budget, not August\'s)');
  ok('August is untouched by a July expense',
    Math.abs(after.todayRemaining - before.todayRemaining) < 0.001);
}

console.log('\nSCENARIO F — the day BEFORE the trip started, added while travelling');
{
  const trip = { id: 't3', name: 'Istanbul', from: '2026-08-02', to: '2026-08-10', budget: 400 };
  const w = world({ today: '2026-08-05', budget: 600, trips: [trip] });
  const mb = w.bs(), tb = w.tbs();
  w.__add('2026-08-01', 70);                       // before the trip → monthly money
  const mb2 = w.bs(), tb2 = w.tbs();
  console.log('   monthly left today: ' + eur(mb.todayRemaining) + ' → ' + eur(mb2.todayRemaining));
  console.log('   trip left today:    ' + eur(tb.todayRemaining) + ' → ' + eur(tb2.todayRemaining));
  ok('a pre-trip day draws the monthly budget', mb2.todayBudget < mb.todayBudget);
  ok('and leaves the trip pot alone', Math.abs(tb2.spent - tb.spent) < 0.001);
}

console.log('\nSCENARIO G — budget in "monthly" mode (no daily figures at all)');
{
  const w = world({ today: '2026-08-03', budget: 600, mode: 'monthly' });
  const before = w.bs();
  w.__add('2026-08-02', 50);
  const after = w.bs();
  console.log('   todayBudget: ' + eur(before.todayBudget) + ' → ' + eur(after.todayBudget));
  ok('no daily allowance exists in monthly mode', before.todayBudget === undefined);
  ok('but the month total still moves', Math.abs(after.spentMonth - 50) < 0.01);
}

console.log('\nSCENARIO H — Home is parked on a past month while today is August');
{
  const w = world({ today: '2026-08-03', budget: 600,
    period: { type: 'month', y: 2026, m0: 6 } });     // viewing July
  const before = w.bs();
  console.log('   isCurrent=' + before.isCurrent + ' todayBudget=' + eur(before.todayBudget));
  w.__add('2026-08-02', 50);
  const after = w.bs();
  ok('a past month shows no daily allowance', after.todayBudget === undefined);
  ok('and does not pick up August spending', Math.abs(after.spentMonth) < 0.001);
}

console.log('\nSCENARIO I — money dated AHEAD of today (the second hole)');
{
  const w = world({ today: '2026-08-03', budget: 600 });
  const before = w.bs();
  w.__add('2026-08-20', 300);                      // rent booked ahead
  const after = w.bs();
  console.log('   left today: ' + eur(before.todayRemaining) + ' → ' + eur(after.todayRemaining));
  console.log('   tomorrow:   ' + eur(before.tomorrowBudget) + ' → ' + eur(after.tomorrowBudget));
  ok('a future expense reserves money today', after.todayBudget < before.todayBudget);
  ok('reserved exactly, spread over the days left',
    Math.abs((before.todayBudget - after.todayBudget) - 300 / 29) < 0.01,
    (before.todayBudget - after.todayBudget).toFixed(4));
  ok('tomorrow is reduced too', after.tomorrowBudget < before.tomorrowBudget);
  ok('committedAhead is reported', Math.abs(after.committedAhead - 300) < 0.01);
  ok('month total unchanged in meaning', Math.abs(after.spentMonth - 300) < 0.01);
}

console.log('\nSCENARIO J — trip: a hotel dated later in the trip');
{
  const trip = { id: 't4', name: 'Istanbul', from: '2026-08-01', to: '2026-08-10', budget: 400 };
  const w = world({ today: '2026-08-03', budget: 600, trips: [trip] });
  const before = w.tbs();
  w.__add('2026-08-08', 160);
  const after = w.tbs();
  console.log('   trip left today: ' + eur(before.todayRemaining) + ' → ' + eur(after.todayRemaining));
  ok('the trip reserves it too', after.todayAllowance < before.todayAllowance);
  ok('trip committedAhead reported', Math.abs(after.committedAhead - 160) < 0.01);
}

console.log('\nSCENARIO K — the reported bug: back-dated spend while on a budgeted trip');
{
  const trip = { id: 't5', name: 'Istanbul', from: '2026-08-01', to: '2026-08-10',
    budget: 400, currency: 'TRY', rate: 38 };
  const w = world({ today: '2026-08-03', budget: 600, trips: [trip] });
  const t1 = w.tbs();
  w.__add('2026-08-02', 100);
  const t2 = w.tbs();
  // What Home's hero now shows (the trip, because it is active and budgeted)
  console.log('   hero (trip) left today: ' + eur(t1.todayRemaining) +
    ' → ' + eur(t2.todayRemaining));
  ok('the hero number moves when you add a past-dated trip expense',
    Math.abs(t2.todayRemaining - t1.todayRemaining) > 0.01);
  ok('it moves by the expense spread over the days left',
    Math.abs((t1.todayRemaining - t2.todayRemaining) - 100 / 8) < 0.01,
    (t1.todayRemaining - t2.todayRemaining).toFixed(4));
  ok('trip is active so the hero is the trip', t2.active === true);
}

console.log('\nSCENARIO L — no regression: past days still redistribute correctly');
{
  const w = world({ today: '2026-08-10', budget: 620 });   // 31 days, base 20
  // spend exactly the base on each of the first 9 days
  let running = 0;
  for (let d = 1; d <= 9; d++) {
    const dd = String(d).padStart(2, '0');
    const allowance = (620 - running) / (31 - d + 1);
    w.__add('2026-08-' + dd, allowance);
    running += allowance;
  }
  const s = w.bs();
  console.log('   after 9 on-budget days: today ' + eur(s.todayBudget) +
    ' (base ' + eur(s.dailyBase) + ')');
  ok('spending exactly the allowance keeps today at base',
    Math.abs(s.todayBudget - s.dailyBase) < 0.01, s.todayBudget.toFixed(4));
}

console.log('\n' + (fails ? fails + ' FAILED' : 'no assertion failures'));
process.exit(fails ? 1 : 0);
