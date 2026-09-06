/* Keeping an expense out of the daily allowance: the per-transaction flag, the
   category flag, the note keywords, and the relative-anomaly detector that offers
   the flag. Runs the real budgetSkipReason / countsInBudget / budgetOutliers. */
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

/** A world with a pinned month and a given set of transactions. */
function world({ today = '2026-09-15', txs = [], meta = {}, trips = [] } = {}) {
  const U = Object.assign(Object.create(null), realU, { todayISO: () => today });
  const DB = {
    state: {
      transactions: txs.slice(),
      meta: Object.assign({ budget: { amount: 1800, mode: 'daily' }, trips,
        subscriptions: { confirmed: {} } }, meta)
    },
    category: (id) => ({ id, name: id, icon: '•', color: 'blue' })
  };
  const ui = { period: { type: 'month', y: Number(today.slice(0, 4)),
    m0: Number(today.slice(5, 7)) - 1 } };
  const ctx = vm.createContext({ console, Date, Math, Number, String, Array, Object, U, DB, ui });
  vm.runInContext([
    'const tripSettings = () => Object.assign({ excludeFromStats: true }, DB.state.meta.tripSettings || {});',
    'const merchantKey = (s) => String(s || "").toUpperCase().split(/\\s+/)[0];',
    extract('median'),
    extract('budgetSkipCfg'), extract('budgetSkipReason'),
    extract('tripForDate'), extract('isProtectedRecurring'), extract('tripExpenseOf'),
    extract('countsInBudget'), extract('budgetOutliers'),
    'globalThis.api = { budgetSkipReason, countsInBudget, budgetOutliers };'
  ].join('\n'), ctx);
  return ctx.api;
}

let fails = 0;
const ok = (label, cond, got) => {
  if (cond) console.log('  \x1b[32m✓\x1b[0m ' + label);
  else { fails++; console.log('  \x1b[31m✗ ' + label + '\x1b[0m' +
    (got === undefined ? '' : '  got: ' + JSON.stringify(got))); }
};

const tx = (o) => Object.assign(
  { id: 'x' + Math.random(), date: '2026-09-10', amount: 20, type: 'expense',
    categoryId: 'Food', accountId: 'a1', note: '' }, o);

console.log('\nthe per-transaction flag:');
{
  const api = world();
  ok('an ordinary expense counts', api.budgetSkipReason(tx({})) === null);
  ok('excludeFromBudget:true is "once"',
    api.budgetSkipReason(tx({ excludeFromBudget: true })) === 'once');
  ok('and it stops counting toward the budget',
    api.countsInBudget(tx({ excludeFromBudget: true })) === false);
  ok('excludeFromBudget:false still counts',
    api.countsInBudget(tx({ excludeFromBudget: false })) === true);
}

console.log('\nthe category flag:');
{
  const api = world({ meta: { budgetSkip: { categories: ['Car'], keywords: [] } } });
  ok('an expense in a skipped category is excluded',
    api.budgetSkipReason(tx({ categoryId: 'Car' })) === 'category');
  ok('other categories are untouched',
    api.budgetSkipReason(tx({ categoryId: 'Food' })) === null);
  ok('an explicit false overrides the category rule',
    api.budgetSkipReason(tx({ categoryId: 'Car', excludeFromBudget: false })) === null);
  ok('...without abandoning the rule for everything else',
    api.budgetSkipReason(tx({ categoryId: 'Car' })) === 'category');
}

console.log('\nnote keywords:');
{
  const api = world({ meta: { budgetSkip: { categories: [],
    keywords: [{ id: 'k1', text: 'ASSICURAZIONE' }, { id: 'k2', text: 'tasse' }] } } });
  ok('a note containing the keyword is excluded',
    api.budgetSkipReason(tx({ note: 'ASSICURAZIONE AUTO 2026' })) === 'keyword');
  ok('matching ignores case both ways',
    api.budgetSkipReason(tx({ note: 'Pagamento Tasse comunali' })) === 'keyword');
  ok('a note without any keyword counts normally',
    api.budgetSkipReason(tx({ note: 'ESSELUNGA' })) === null);
  ok('an empty note never matches', api.budgetSkipReason(tx({ note: '' })) === null);
  ok('a blank keyword cannot match everything',
    world({ meta: { budgetSkip: { categories: [], keywords: [{ id: 'k', text: '   ' }] } } })
      .budgetSkipReason(tx({ note: 'ESSELUNGA' })) === null);
}

console.log('\nthe anomaly detector (relative, not absolute):');
{
  /* Six months of history: Food ~10 €, Rent 680 € every month. */
  const hist = [];
  for (let m = 3; m <= 8; m++) {
    const mm = String(m).padStart(2, '0');
    hist.push(tx({ date: `2026-${mm}-01`, amount: 680, categoryId: 'Rent' }));
    for (let d = 5; d <= 12; d++) {
      hist.push(tx({ date: `2026-${mm}-${String(d).padStart(2, '0')}`, amount: 10, categoryId: 'Food' }));
    }
  }
  const thisMonth = [
    tx({ date: '2026-09-01', amount: 680, categoryId: 'Rent' }),      // huge but normal
    tx({ date: '2026-09-08', amount: 11, categoryId: 'Food' }),       // normal
    tx({ date: '2026-09-09', amount: 35, categoryId: 'Food' })        // small but 3.5x
  ];
  const api = world({ txs: [...hist, ...thisMonth] });
  const out = api.budgetOutliers();
  ok('rent is never flagged, though it is the biggest line every month',
    !out.some((o) => o.tx.categoryId === 'Rent'), out.map((o) => o.tx.categoryId));
  ok('a small-but-unusual charge is flagged',
    out.length === 1 && out[0].tx.amount === 35, out.map((o) => o.tx.amount));
  ok('and it reports what usual looks like', out[0].typical === 10, out[0].typical);
  ok('with the ratio', Math.round(out[0].ratio * 10) / 10 === 3.5, out[0].ratio);
}
{
  /* A category the user has barely used can't be judged yet. */
  const api = world({ txs: [
    tx({ date: '2026-08-02', amount: 5, categoryId: 'New' }),
    tx({ date: '2026-08-03', amount: 5, categoryId: 'New' }),
    tx({ date: '2026-09-04', amount: 90, categoryId: 'New' })
  ] });
  ok('too little history means no guess', api.budgetOutliers().length === 0);
}
{
  const api = world({ txs: [tx({ date: '2026-09-04', amount: 90, categoryId: 'New' })] });
  ok('no history at all is not an anomaly either', api.budgetOutliers().length === 0);
}
{
  /* Once the user has answered, stop asking — either way. */
  const hist = [];
  for (let d = 1; d <= 8; d++) {
    hist.push(tx({ date: `2026-08-${String(d).padStart(2, '0')}`, amount: 10, categoryId: 'Food' }));
  }
  const spike = { date: '2026-09-09', amount: 80, categoryId: 'Food' };
  ok('an unanswered spike is offered',
    world({ txs: [...hist, tx(spike)] }).budgetOutliers().length === 1);
  ok('one already excluded is not offered again',
    world({ txs: [...hist, tx(Object.assign({ excludeFromBudget: true }, spike))] })
      .budgetOutliers().length === 0);
  ok('one already kept is not offered again',
    world({ txs: [...hist, tx(Object.assign({ excludeFromBudget: false }, spike))] })
      .budgetOutliers().length === 0);
}
{
  /* The window is six months, so an old category's history doesn't linger forever. */
  const old = [];
  for (let d = 1; d <= 8; d++) {
    old.push(tx({ date: `2025-11-${String(d).padStart(2, '0')}`, amount: 10, categoryId: 'Food' }));
  }
  ok('history older than six months is not used',
    world({ txs: [...old, tx({ date: '2026-09-09', amount: 80, categoryId: 'Food' })] })
      .budgetOutliers().length === 0);
}

console.log('\n' + (fails ? fails + ' FAILED' : 'all checks passed'));
process.exit(fails ? 1 : 0);
