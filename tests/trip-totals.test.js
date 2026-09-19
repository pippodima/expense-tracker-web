/* One trip, one total. The headline (tripTotals), the charts and the budget meter must
   all count the same money — a trip is a date range, so anything charged in those dates
   that isn't travel (a subscription, or spending held back from the budget) is out of
   all three alike.
   Runs the real tripTotals / tripBudgetStatus, plus tripCharts' own filter. */
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const src = fs.readFileSync(ROOT + '/js/app.js', 'utf8');

const baseCtx = vm.createContext({ console, Intl, Date, Math, Number, String, Array, Object,
  JSON, isFinite, crypto: { randomUUID: () => 'x' },
  window: { matchMedia: () => ({ matches: false }) },
  document: { createElement: () => ({ style: {}, setAttribute() {}, appendChild() {},
    addEventListener() {} }), body: { appendChild() {} }, querySelector: () => null },
  navigator: {}, URL: { createObjectURL: () => '', revokeObjectURL() {} }, Blob: class {} });
vm.runInContext(fs.readFileSync(ROOT + '/js/util.js', 'utf8') + '\nglobalThis.U = U;', baseCtx);
const realU = baseCtx.U;

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

/* tripCharts builds a chart out of a DOM, which this suite has no use for — but its
   *filter* is the thing that has to agree with the headline, so read that line out of
   the source rather than trusting a copy of it that could drift. */
function chartFilterSource() {
  const fn = extract('tripCharts');
  const i = fn.indexOf('const exp = DB.state.transactions.filter(');
  if (i < 0) throw new Error('tripCharts no longer filters the way this test assumes');
  return fn.slice(i, fn.indexOf(';', i) + 1);
}

const TRIP = { id: 'tr', name: 'Istanbul', from: '2026-09-01', to: '2026-09-10', budget: 1000 };

function world(txs, confirmed) {
  const U = Object.assign(Object.create(null), realU, { todayISO: () => '2026-09-20' });
  const DB = {
    state: { transactions: txs, meta: { trips: [TRIP], budget: { amount: 1800, mode: 'daily' },
      subscriptions: { confirmed: confirmed || {} } } },
    category: () => null
  };
  const ctx = vm.createContext({ console, Date, Math, Number, String, Array, Object, Map, U, DB,
    ui: { period: { type: 'month', y: 2026, m0: 8 } } });
  vm.runInContext([
    'const tripSettings = () => ({ excludeFromStats: true });',
    extract('merchantKey').replace('GENERIC_WORDS.has(tokens[0])', 'false'),
    'const PROCESSOR_PREFIXES = [];',
    extract('budgetSkipCfg'), extract('budgetSkipReason'),
    extract('tripForDate'), extract('isProtectedRecurring'), extract('tripExpenseOf'),
    extract('tripBookedAhead'), extract('tripTotals'), extract('tripBudgetStatus'),
    'function chartTotal(trip) {',
    '  ' + chartFilterSource(),
    '  return exp.reduce((s, t) => s + t.amount, 0);',
    '}',
    'globalThis.api = { tripTotals, tripBudgetStatus, chartTotal };'
  ].join('\n'), ctx);
  return ctx.api;
}

let fails = 0;
const ok = (label, cond, got) => {
  if (cond) console.log('  \x1b[32m✓\x1b[0m ' + label);
  else { fails++; console.log('  \x1b[31m✗ ' + label + '\x1b[0m' +
    (got === undefined ? '' : '  got: ' + JSON.stringify(got))); }
};
const round = (n) => Math.round(n * 100) / 100;

let n = 0;
const tx = (o) => Object.assign({ id: 'x' + (++n), type: 'expense', accountId: 'a1',
  categoryId: 'Food', note: 'RISTORANTE', date: '2026-09-05', amount: 60 }, o);
/* Ten ordinary days of the trip. */
const base = [];
for (let d = 1; d <= 10; d++) {
  base.push(tx({ date: '2026-09-' + String(d).padStart(2, '0'), amount: 60 }));
}

console.log('\nplain trip:');
{
  const api = world(base.slice());
  ok('the headline and the charts agree',
    round(api.tripTotals(TRIP).spent) === round(api.chartTotal(TRIP)),
    [api.tripTotals(TRIP).spent, api.chartTotal(TRIP)]);
  ok('and so does the budget meter',
    round(api.tripBudgetStatus(TRIP).spent) === 600, api.tripBudgetStatus(TRIP).spent);
  ok('all three are the same number',
    round(api.tripTotals(TRIP).spent) === round(api.tripBudgetStatus(TRIP).spent),
    [api.tripTotals(TRIP).spent, api.tripBudgetStatus(TRIP).spent]);
}

console.log('\na subscription charged mid-trip:');
{
  const txs = [...base, tx({ date: '2026-09-03', amount: 12.99, note: 'NETFLIX.COM' })];
  const api = world(txs, { NETFLIX: { label: 'NETFLIX.COM' } });
  ok('it is left out of the headline — that is not travel spending',
    round(api.tripTotals(TRIP).spent) === 600, api.tripTotals(TRIP).spent);
  ok('the charts leave it out too',
    round(api.chartTotal(TRIP)) === 600, api.chartTotal(TRIP));
  ok('and the budget meter agrees with both',
    round(api.tripBudgetStatus(TRIP).spent) === 600, api.tripBudgetStatus(TRIP).spent);
}

console.log('\nan expense held back from the budget:');
{
  /* Excluding an expense from the budget is the only way to say "this isn't my
     normal spending", so it means "not travel" here too — one number, everywhere. */
  const txs = [...base, tx({ date: '2026-09-06', amount: 300, note: 'RIPARAZIONE',
    excludeFromBudget: true })];
  const api = world(txs);
  const head = round(api.tripTotals(TRIP).spent);
  const chart = round(api.chartTotal(TRIP));
  const tb = api.tripBudgetStatus(TRIP);
  ok('the headline leaves it out', head === 600, head);
  ok('so do the charts', chart === 600, chart);
  ok('and the budget meter', round(tb.spent) === 600, tb.spent);
  ok('all three agree exactly', head === chart && chart === round(tb.spent),
    [head, chart, tb.spent]);
}

console.log('\nboth at once (the reported case):');
{
  const txs = [...base,
    tx({ date: '2026-09-03', amount: 12.99, note: 'NETFLIX.COM' }),
    tx({ date: '2026-09-06', amount: 300, note: 'RIPARAZIONE', excludeFromBudget: true })];
  const api = world(txs, { NETFLIX: { label: 'NETFLIX.COM' } });
  const head = round(api.tripTotals(TRIP).spent);
  const chart = round(api.chartTotal(TRIP));
  const tb = api.tripBudgetStatus(TRIP);
  ok('one number, not three', head === chart && chart === round(tb.spent),
    [head, chart, tb.spent]);
  ok('and it is the ordinary travel spending only', head === 600, head);
}

console.log('\nbooked-ahead costs (a flight bought before leaving):');
{
  /* Paid in May, five weeks before the trip. It must count toward what the trip cost
     and nothing else — the money already left in May. */
  const flight = tx({ date: '2026-05-28', amount: 214.6, note: 'PEGASUS AIRLINES',
    tripId: 'tr' });
  const api = world([...base, flight]);
  const t = api.tripTotals(TRIP);
  ok('it is found even though its date is outside the trip',
    t.aheadTxs.length === 1, t.aheadTxs.length);
  ok('and added to the trip total', round(t.total) === round(600 + 214.6), t.total);
  ok('while on-trip spending is unchanged', round(t.spent) === 600, t.spent);
  ok('it never touches the trip budget',
    round(api.tripBudgetStatus(TRIP).spent) === 600, api.tripBudgetStatus(TRIP).spent);
  ok('nor the charts, which only cover the days you were there',
    round(api.chartTotal(TRIP)) === 600, api.chartTotal(TRIP));
  ok('and per-day stays the daily rate you actually spent',
    round(t.perDay) === 60, t.perDay);
}
{
  /* Tagging something already inside the dates must not count it twice. */
  const inside = tx({ date: '2026-09-04', amount: 80, note: 'MUSEO', tripId: 'tr' });
  const api = world([...base, inside]);
  const t = api.tripTotals(TRIP);
  ok('a tagged expense inside the dates is not double counted',
    round(t.total) === 680 && t.aheadTxs.length === 0, [t.total, t.aheadTxs.length]);
}
{
  /* Another trip's flight must not leak in. */
  const other = tx({ date: '2026-05-28', amount: 500, note: 'ALTRO VOLO',
    tripId: 'different-trip' });
  const api = world([...base, other]);
  ok('a flight tagged to another trip is ignored',
    round(api.tripTotals(TRIP).total) === 600, api.tripTotals(TRIP).total);
}
{
  /* An untagged expense before the trip stays out — dates alone never pull it in. */
  const api = world([...base, tx({ date: '2026-05-28', amount: 214.6, note: 'PEGASUS' })]);
  ok('nothing is attached without being tagged',
    round(api.tripTotals(TRIP).total) === 600, api.tripTotals(TRIP).total);
}
{
  /* A draft trip in the editor has no id yet. */
  const api = world([...base, tx({ date: '2026-05-28', amount: 90, tripId: 'tr' })]);
  ok('a trip with no id has no booked-ahead costs',
    api.tripTotals({ from: TRIP.from, to: TRIP.to }).ahead === 0);
}

console.log('\nincome and transfers never inflate a trip:');
{
  const txs = [...base,
    tx({ date: '2026-09-04', amount: 2000, type: 'income', note: 'STIPENDIO' }),
    tx({ date: '2026-09-07', amount: 100, type: 'transfer', note: 'PRELIEVO',
      toAccountId: 'a2' })];
  const api = world(txs);
  ok('the headline counts expenses only',
    round(api.tripTotals(TRIP).spent) === 600, api.tripTotals(TRIP).spent);
  ok('and still matches the charts',
    round(api.tripTotals(TRIP).spent) === round(api.chartTotal(TRIP)),
    [api.tripTotals(TRIP).spent, api.chartTotal(TRIP)]);
}

console.log('\n' + (fails ? fails + ' FAILED' : 'all checks passed'));
process.exit(fails ? 1 : 0);
