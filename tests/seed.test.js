/* First-launch defaults and what a launch may never do to existing data.
   Runs the real js/db.js against a small in-memory IndexedDB that survives between
   "launches", so it can play a fresh install, an install that has been in use for
   months, and a restore followed by a relaunch. */
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const { webcrypto } = require('crypto');
const ROOT = path.resolve(__dirname, '..');

let fails = 0;
const ok = (label, cond, got) => {
  if (cond) console.log('  ✓ ' + label);
  else { fails++; console.log('  ✗ ' + label + (got !== undefined ? ' — got ' + JSON.stringify(got) : '')); }
};

/* ---- A fake IndexedDB: just what db.js uses. getAll returns rows in key order,
   like the real one, which is why rule order after a reload follows the ids. ---- */
function fakeIDB() {
  const dbs = new Map();
  const later = (fn) => setTimeout(fn, 0);
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const storesOf = (name) => { if (!dbs.has(name)) dbs.set(name, new Map()); return dbs.get(name); };
  return {
    open(name) {
      const req = {};
      later(() => {
        const stores = storesOf(name);
        req.result = {
          objectStoreNames: { contains: (s) => stores.has(s) },
          createObjectStore: (s) => stores.set(s, new Map()),
          transaction(s) {
            const tx = {};
            tx.objectStore = () => ({
              getAll() {
                const r = {};
                later(() => {
                  r.result = [...stores.get(s).entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
                    .map(([, v]) => clone(v));
                  r.onsuccess();
                });
                return r;
              },
              put: (o) => stores.get(s).set(o.id, clone(o)),
              delete: (id) => stores.get(s).delete(id),
              clear: () => stores.get(s).clear()
            });
            later(() => tx.oncomplete && tx.oncomplete());
            return tx;
          }
        };
        if (req.onupgradeneeded) req.onupgradeneeded();
        req.onsuccess();
      });
      return req;
    },
    /** Write rows straight to disk, as a months-old install would have them. */
    load(name, data) {
      const stores = storesOf(name);
      for (const [s, rows] of Object.entries(data)) {
        stores.set(s, new Map(rows.map((r) => [r.id, clone(r)])));
      }
    },
    dump(name) {
      const out = {};
      for (const [s, rows] of storesOf(name)) out[s] = [...rows.values()].map(clone);
      return out;
    }
  };
}

/** One app launch: fresh JS realm, same disk. Resolves to the DB module after init(). */
async function launch(idb) {
  const ctx = vm.createContext({ console, setTimeout, crypto: webcrypto, navigator: {},
    indexedDB: idb });
  ctx.window = ctx;
  vm.runInContext(fs.readFileSync(ROOT + '/js/util.js', 'utf8') + '\nglobalThis.U = U;', ctx);
  vm.runInContext(fs.readFileSync(ROOT + '/js/db.js', 'utf8') + '\nglobalThis.DB = DB;', ctx);
  ok('launch uses IndexedDB, not the memory fallback', await ctx.DB.init() === true);
  return ctx.DB;
}

const byId = (rows) => [...rows].sort((a, b) => (a.id < b.id ? -1 : 1));
const same = (a, b) => JSON.stringify(byId(a || [])) === JSON.stringify(byId(b || []));

/* What the old one-time blocks seeded: personal places that must never ship again. */
const PERSONAL = ['MENSA', 'CIR UNIV', 'ITACA', 'FACOLTA', 'CAPONNETTO', 'CALAMANDREI',
  'S.APOLLONIA', 'CAMINITOS', 'SUMUP', 'RIFRULLO', 'HABANA', 'NINKASI', 'AUTOLINEE', 'ITABUS',
  'TCL', 'COMUNE DI FIRENZE', 'MICROSOFT', 'CLAUDE', 'PHARMACIE', 'PIODA IMAGING', 'SERENIS',
  'INTIMISSIMI', 'YURPLAN', 'ANTHROPIC'];

(async () => {
  /* ---- Day one: a fresh install ---- */
  console.log('fresh install');
  const fresh = fakeIDB();
  const DB = await launch(fresh);
  const cats = DB.state.categories.map((c) => c.name);
  ok('the nine standard categories, nothing else',
    JSON.stringify([...cats].sort()) === JSON.stringify(['Bills', 'Dining', 'Entertainment',
      'Groceries', 'Health', 'Other', 'Salary', 'Shopping', 'Transport']), cats);
  ok('Checking and Cash accounts', JSON.stringify(DB.state.accounts.map((a) => a.name).sort()) ===
    '["Cash","Checking"]');
  ok('no personal or city-specific rule', !DB.state.rules.some((r) =>
    PERSONAL.some((p) => r.keyword.toUpperCase().includes(p))),
    DB.state.rules.filter((r) => PERSONAL.some((p) => r.keyword.toUpperCase().includes(p))).map((r) => r.keyword));
  ok('no University food / Software category', !cats.includes('University food') && !cats.includes('Software'));
  ok('every rule points at a real category',
    DB.state.rules.every((r) => DB.category(r.categoryId)));
  ok('every regex rule compiles', DB.state.rules.filter((r) => r.regex).every((r) => {
    try { new RegExp(r.keyword, 'i'); return true; } catch { return false; }
  }));
  ok('no one-time seed flags written', !('regexRulesSeeded' in DB.state.meta) &&
    !('starterRulesSeeded' in DB.state.meta));

  /* Rules are read back in random-id order, so a text matched by two rules would land
     in either category. Every sample must match exactly one rule, the right one. */
  const matches = (text) => DB.state.rules.filter((r) => (r.regex
    ? new RegExp(r.keyword, 'i').test(text)
    : text.toUpperCase().includes(r.keyword.toUpperCase())))
    .map((r) => DB.category(r.categoryId).name);
  const EXPECT = {
    Groceries: ['ESSELUNGA MILANO', 'CONAD SUPERSTORE', 'LIDL 1234', 'CARREFOUR EXPRESS', 'EUROSPIN',
      'ALDI SUD', 'DESPAR', 'PENNY MARKET', 'UNICOOP FIRENZE NOVOLI', 'COOP ALLEANZA 3.0'],
    Dining: ['BAR ROMA', 'Caffe Nero', 'PIZZERIA DA MARIO', 'RISTORANTE IL FARO', 'TRATTORIA',
      'OSTERIA DEL PONTE', 'SUSHI KO', 'MCDONALDS 123', 'BURGER KING', 'DELIVEROO', 'JUST EAT',
      'GLOVO', 'UBER EATS', 'BAR GARIBALDI'],
    Transport: ['TRENITALIA', 'ITALO SPA', 'WWW.ITALOTRENO.IT', 'FLIXBUS', 'RYANAIR', 'EASYJET',
      'TELEPASS', 'UBER *TRIP'],
    Shopping: ['AMAZON.IT', 'ZALANDO', 'IKEA FIRENZE', 'DECATHLON'],
    Bills: ['ENEL ENERGIA', 'VODAFONE', 'WINDTRE', 'ILIAD ITALIA', 'FASTWEB', 'TIM SPA',
      'A2A ENERGIA', 'HERA COMM', 'IREN MERCATO'],
    Health: ['FARMACIA COMUNALE', 'PARAFARMACIA', 'BOOTS PHARMACY'],
    Entertainment: ['NETFLIX.COM', 'SPOTIFY', 'DISNEY PLUS', 'DAZN', 'CINEMA ODEON'],
    Salary: ['STIPENDIO SETTEMBRE']
  };
  const wrong = [];
  for (const [cat, texts] of Object.entries(EXPECT)) {
    for (const t of texts) {
      const m = matches(t);
      if (m.length !== 1 || m[0] !== cat) wrong.push(t + ' → ' + (m.join('+') || 'nothing'));
    }
  }
  ok('each sample matches exactly one rule, in the right category', !wrong.length, wrong);
  const NONE = ['PRELIEVO ATM', 'BARCLAYS', 'BARBIERE', 'SHERATON MILANO', 'OPTIMA ITALIA',
    'SIRENA BEACH', 'COOPERATIVA TAXI', 'PENELOPE SHOP', 'CAPITALONE'];
  const caught = NONE.filter((t) => matches(t).length);
  ok('lookalikes match no rule (ATM withdrawal, BARCLAYS, SHERATON…)', !caught.length,
    caught.map((t) => t + ' → ' + matches(t).join('+')));

  /* ---- An install in use: the old seeds already ran, the user changed things ---- */
  console.log('existing install');
  const mine = fakeIDB();
  const C = (id, name, icon) => ({ id, name, icon, color: 'blue' });
  mine.load('expense-tracker', {
    accounts: [{ id: 'a1', name: 'buddybank', type: 'checking', startingBalance: 812.4 }],
    categories: [C('c1', 'Groceries', '🛒'), C('c2', 'Dining', '🍕'), C('c3', 'Mensa', '🍝'),
      C('c4', 'Software', '💻')],          // "University food" renamed to "Mensa"
    rules: [{ id: 'r1', keyword: 'CAPONNETTO', categoryId: 'c3' },
      { id: 'r2', keyword: 'ANTHROPIC', regex: true, categoryId: 'c4' },
      { id: 'r3', keyword: 'MY OWN BAR', categoryId: 'c2' }],   // MENSA rule deleted
    transactions: [{ id: 't1', date: '2026-10-11', amount: 4.5, type: 'expense',
      categoryId: 'c3', accountId: 'a1', note: 'CAPONNETTO' }],
    presets: [], snapshots: [],
    meta: [{ id: 'installedAt', value: 1753000000000 }, { id: 'regexRulesSeeded', value: 1 },
      { id: 'starterRulesSeeded', value: 1 }, { id: 'budget', value: { amount: 600, mode: 'daily' } },
      { id: 'exportNaming', value: 'dated' }]
  });
  const before = mine.dump('expense-tracker');
  await launch(mine);
  const after = mine.dump('expense-tracker');
  const changed = Object.keys(before).filter((s) => !same(before[s], after[s]));
  ok('a launch on an existing install changes nothing on disk', !changed.length, changed);
  ok('…and seeds nothing', after.categories.length === 4 && after.rules.length === 3,
    { categories: after.categories.length, rules: after.rules.length });

  /* ---- The restore bug: restore wipes meta, then the next launch re-ran the seeds ---- */
  console.log('restore, then relaunch');
  const DB2 = await launch(mine);
  const backup = {
    accounts: DB2.state.accounts, categories: DB2.state.categories,
    transactions: DB2.state.transactions, rules: DB2.state.rules, presets: DB2.state.presets,
    meta: { budget: DB2.state.meta.budget }   // like buildBackupPayload: no seed flags
  };
  await DB2.replaceAll(JSON.parse(JSON.stringify(backup)));
  const restored = mine.dump('expense-tracker');
  await launch(mine);
  const relaunched = mine.dump('expense-tracker');
  ok('deleted defaults stay deleted after a restore + relaunch',
    same(restored.categories, relaunched.categories) && same(restored.rules, relaunched.rules),
    { categories: relaunched.categories.map((c) => c.name), rules: relaunched.rules.map((r) => r.keyword) });
  ok('no "University food" brought back', !relaunched.categories.some((c) => c.name === 'University food'));

  /* ---- The backup carries export naming ---- */
  console.log('backup payload');
  const src = require('./app-source').src;
  const start = src.indexOf('function buildBackupPayload(');
  let depth = 0, end = -1;
  for (let j = src.indexOf('{', start); j < src.length; j++) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}') { depth--; if (depth === 0) { end = j + 1; break; } }
  }
  const pctx = vm.createContext({ Date, DB: { state: { accounts: [], categories: [],
    transactions: [], rules: [], presets: [], meta: { exportNaming: 'dated', lastBackup: 1,
      installedAt: 1, changesSinceBackup: 3, starterRulesSeeded: 1 } } } });
  vm.runInContext(src.slice(start, end) + '\nglobalThis.p = buildBackupPayload();', pctx);
  ok('exportNaming is in the backup', pctx.p.meta.exportNaming === 'dated', pctx.p.meta);
  ok('device bookkeeping still left out', !['lastBackup', 'installedAt', 'changesSinceBackup',
    'starterRulesSeeded'].some((k) => k in pctx.p.meta));

  if (fails) { console.log(fails + ' failed'); process.exit(1); }
})().catch((e) => { console.error(e); process.exit(1); });
