/* Shared UI state, plus keeping "today" current.

   The app is split into plain scripts (no modules, no build step) that index.html loads
   in order. Their top-level const / let / function declarations all live in one shared
   global scope, so any file can call any other file's functions. Two rules keep that
   safe:
     · nothing may run at load time except declarations: work starts in boot()
       (js/app/boot.js) on DOMContentLoaded, after every script has loaded;
     · a new file must be added to index.html (before boot.js) and to sw.js's ASSETS,
       or the app breaks offline. `node tests/run.js` checks both.
   Data lives in DB.state (js/db.js); `ui` here only holds view and filter state. */
'use strict';

const { $, $$, el, esc, fmtEUR, toast } = U;

/* ================= App state (UI only — data lives in DB.state) ========= */
let now = new Date();
const ui = {
  view: 'dashboard',
  period: { type: 'month', y: now.getFullYear(), m0: now.getMonth() }, // or {type:'range', from, to}
  donutSel: null,
  stats: {
    view: 'overview',          // overview | trends | calendar | merchants | trips
    range: 'month',            // month | year | all | custom
    y: now.getFullYear(), m0: now.getMonth(),
    from: '', to: '', donutSel: null, merchantQuery: '',
    trendCat: null, trendWindow: 12
  },
  tx: { q: '', accountId: '', categoryId: '', from: '', to: '', sort: 'date-desc', limit: 100 },
  settings: { open: {}, ruleQuery: '', ruleGroups: {} },
  sheetZ: 50
};

/** Destructive actions are immediate + undoable instead of confirm-gated. */
const toastUndo = (msg, undo) => U.toastAction(msg, 'Undo', undo);

/** Land Home/Stats on the most recent month that actually has data, so the views
    aren't empty when all the history is in a month other than the real "today"
    (e.g. imported data). No-op if the current month already has transactions. */
function focusLatestData() {
  const txs = DB.state.transactions;
  if (!txs.length) return;
  const cur = U.monthRange(now.getFullYear(), now.getMonth());
  if (txs.some((t) => t.date >= cur.from && t.date <= cur.to)) return;
  const latest = txs.reduce((mx, t) => (t.date > mx ? t.date : mx), txs[0].date);
  const [ly, lm] = latest.split('-').map(Number);
  ui.period = { type: 'month', y: ly, m0: lm - 1 };
  ui.donutSel = null;
  ui.stats.y = ly; ui.stats.m0 = lm - 1; ui.stats.donutSel = null;
}

/** A home-screen PWA sits suspended for days rather than reloading, so the
    "today" captured at load goes stale. Across a month boundary that leaves
    Home and Stats sitting on last month while calling it "this month". Roll
    them forward on resume — but only if they were still following the current
    month, never if you deliberately navigated somewhere else. */
function refreshToday() {
  const fresh = new Date();
  const wasY = now.getFullYear(), wasM = now.getMonth();
  if (fresh.getFullYear() === wasY && fresh.getMonth() === wasM) return false;
  now = fresh;
  if (ui.period.type === 'month' && ui.period.y === wasY && ui.period.m0 === wasM) {
    ui.period = { type: 'month', y: now.getFullYear(), m0: now.getMonth() };
    ui.donutSel = null;
  }
  if (ui.stats.range === 'month' && ui.stats.y === wasY && ui.stats.m0 === wasM) {
    ui.stats.y = now.getFullYear(); ui.stats.m0 = now.getMonth();
    ui.stats.donutSel = null;
  }
  return true;
}
