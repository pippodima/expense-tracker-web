#!/usr/bin/env node
/* Test runner — no dependencies, no framework, matching the app itself.
   Run with:  node tests/run.js

   Three layers, because each catches what the previous one can't:
     1. node --check       — syntax
     2. scope-check        — identifiers that resolve to nothing at runtime.
                             A `const` referenced from the wrong function is a
                             ReferenceError that `node --check` accepts happily;
                             that exact mistake once shipped a half-rendered
                             add-transaction sheet (see PROJECT_DIARY Chapter 28).
     3. *.test.js          — the real functions, extracted from js/app.js and run
                             against a fake DOM with pinned dates. */
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const run = (args, label) => {
  process.stdout.write('\n\x1b[1m' + label + '\x1b[0m\n');
  try {
    const out = execFileSync(process.execPath, args, { cwd: ROOT, encoding: 'utf8' });
    if (out.trim()) console.log(out.trimEnd());
    return true;
  } catch (e) {
    if (e.stdout && e.stdout.trim()) console.log(e.stdout.trimEnd());
    if (e.stderr && e.stderr.trim()) console.error(e.stderr.trimEnd());
    return false;
  }
};

let failed = 0;

for (const f of ['js/util.js', 'js/db.js', 'js/csv.js', 'js/detect.js', 'js/charts.js', 'js/app.js']) {
  try { execFileSync(process.execPath, ['--check', f], { cwd: ROOT }); }
  catch (e) { console.error('syntax error in ' + f); failed++; }
}
console.log('\x1b[1msyntax\x1b[0m — ' + (failed ? failed + ' file(s) broken' : 'all files parse'));

/* Functions worth guarding: anything that renders or does money maths. Add to
   this list whenever you add a top-level function with real logic. */
const GUARDED = ['renderDashboard', 'budgetCard', 'budgetStatus', 'tripBudgetStatus',
  'renderStats', 'statsOverview', 'statsTrends', 'trendMonths', 'statsEmptyNote',
  'statsCalendar', 'statsMerchants', 'statsTrips', 'openTxSheet', 'openTripDetail',
  'openCategoryDetail', 'renderTransactions', 'renderAccounts', 'renderSettings',
  'tripCharts', 'renderBlocks', 'openArrangeSheet', 'makeSortable', 'blockSequence', 'refreshToday', 'exportJSON', 'exportEncrypted', 'importJSON', 'repairData'];
if (!run([path.join(__dirname, 'scope-check.js'), ...GUARDED], 'scope')) failed++;

for (const f of fs.readdirSync(__dirname).filter((n) => n.endsWith('.test.js')).sort()) {
  if (!run([path.join(__dirname, f)], f)) failed++;
}

console.log(failed ? '\n\x1b[31m' + failed + ' suite(s) failed\x1b[0m'
                   : '\n\x1b[32meverything passed\x1b[0m');
process.exit(failed ? 1 : 0);
