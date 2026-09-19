/* One trip must not report three different totals.
   The headline (tripTotals) and the charts must add up to the same money; the budget
   meter may be lower, but only by spending deliberately held back from the budget —
   and it has to report that gap rather than just disagreeing.
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
    extract('tripTotals'), extract('tripBudgetStatus'),
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
  ok('with nothing reported as held back', api.tripBudgetStatus(TRIP).excluded === 0);
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
  const txs = [...base, tx({ date: '2026-09-06', amount: 300, note: 'RIPARAZIONE',
    excludeFromBudget: true })];
  const api = world(txs);
  const head = round(api.tripTotals(TRIP).spent);
  const chart = round(api.chartTotal(TRIP));
  const tb = api.tripBudgetStatus(TRIP);
  ok('it still counts as money the trip cost', head === 900, head);
  ok('the charts still add up to the headline', head === chart, [head, chart]);
  ok('but it does not draw on the trip pot', round(tb.spent) === 600, tb.spent);
  ok('and the gap is reported, not hidden', round(tb.excluded) === 300, tb.excluded);
  ok('the gap exactly explains the difference',
    round(tb.spent + tb.excluded) === head, [tb.spent, tb.excluded, head]);
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
  ok('there are two numbers on screen, not three', head === chart, [head, chart]);
  ok('the headline excludes the subscription', head === 900, head);
  ok('the meter is lower by exactly what it says',
    round(tb.spent + tb.excluded) === head, [tb.spent, tb.excluded, head]);
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
