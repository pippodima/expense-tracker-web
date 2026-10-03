/* Wallet notification log: the real Wallet.parse from js/wallet.js on the shapes the
   phone writes, and the real walletAccountMap from js/app.js deciding which account
   each card lands in. */
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');

const wctx = vm.createContext({});
vm.runInContext(fs.readFileSync(ROOT + '/js/wallet.js', 'utf8') + '\nglobalThis.Wallet = Wallet;', wctx);
const Wallet = wctx.Wallet;

let fails = 0;
const ok = (label, cond, got) => {
  if (cond) console.log('  ✓ ' + label);
  else { fails++; console.log('  ✗ ' + label + (got !== undefined ? ' — got ' + JSON.stringify(got) : '')); }
};

/* ---- The two real notifications ---- */
const SAMPLE = [
  'Titolo: buddy',
  'Sottotitolo: The Book Pub. Firenze, Toscana',
  'Corpo: 5,00 €',
  'Data: 3 ott 2026, 01:30',
  'Titolo: buddy',
  'Sottotitolo: Forno Giotto Alimentari. San Casciano in Val di Pesa, Toscana',
  'Corpo: 13,00 €',
  'Data: 3 ott 2026, 14:39'
].join('\n');

let r = Wallet.parse(SAMPLE);
ok('two payments parsed', r.rows.length === 2 && !r.broken && !r.foreign, r);
ok('date from "3 ott 2026"', r.rows[0].date === '2026-10-03', r.rows[0].date);
ok('amount is a signed expense', r.rows[0].amount === -5 && r.rows[1].amount === -13,
  r.rows.map((x) => x.amount));
ok('merchant without the place', r.rows[0].note === 'The Book Pub' &&
  r.rows[1].note === 'Forno Giotto Alimentari', r.rows.map((x) => x.note));
ok('place kept apart', r.rows[1].place === 'San Casciano in Val di Pesa, Toscana', r.rows[1].place);
ok('card → account key', r.rows[0].accountUuid === 'wallet:buddy', r.rows[0].accountUuid);

/* ---- Re-reading the same file gives the same ids (the whole point) ---- */
const again = Wallet.parse(SAMPLE + '\n');
ok('ids are stable across re-reads',
  JSON.stringify(again.rows.map((x) => x.externalId)) === JSON.stringify(r.rows.map((x) => x.externalId)));
const grown = Wallet.parse(SAMPLE + '\nTitolo: N26\nSottotitolo: Bar Roma. Prato, Toscana\nCorpo: 1,20 €\nData: 4 ott 2026, 08:05');
ok('appending a payment keeps the old ids and adds one',
  grown.rows.length === 3 && grown.rows[0].externalId === r.rows[0].externalId &&
  grown.rows[2].accountUuid === 'wallet:n26', grown.rows.map((x) => x.externalId));

/* ---- Genuine repeats in the same minute stay two rows ---- */
const twice = Wallet.parse(SAMPLE.split('\n').slice(0, 4).concat(SAMPLE.split('\n').slice(0, 4)).join('\n'));
ok('same-minute repeat gets its own id', twice.rows.length === 2 &&
  twice.rows[0].externalId !== twice.rows[1].externalId, twice.rows.map((x) => x.externalId));

/* ---- Amounts ---- */
const amt = (s) => { const a = Wallet.parseAmount(s); return a && a.sign * a.cents; };
ok('thousands with a dot', amt('1.234,56 €') === -123456, amt('1.234,56 €'));
ok('English decimal', amt('12.50 €') === -1250, amt('12.50 €'));
ok('refund is income', amt('+5,00 €') === 500 && amt('Rimborso 5,00 €') === 500);
ok('foreign currency flagged', Wallet.parseAmount('12,00 US$').euro === false &&
  Wallet.parseAmount('12,00 USD').euro === false && Wallet.parseAmount('12,00 €').euro === true);
const fx = Wallet.parse('Titolo: N26\nSottotitolo: Shop. London, UK\nCorpo: 9,99 £\nData: 1 ott 2026, 10:00');
ok('foreign payment skipped, counted', fx.rows.length === 0 && fx.foreign === 1, fx);

/* ---- Subtitles ---- */
ok('merchant with its own period', Wallet.splitSubtitle('St. Mary Bar. Firenze, Toscana').merchant === 'St. Mary Bar');
ok('no place at all', Wallet.splitSubtitle('Amazon').merchant === 'Amazon');

/* ---- Robustness ---- */
ok('English labels + full month', Wallet.parse('Title: buddy\nSubtitle: X. Roma, Lazio\nBody: 2,00 €\nDate: 12 October 2026, 9:05').rows[0].date === '2026-10-12');
ok('CRLF and BOM', Wallet.parse('﻿' + SAMPLE.replace(/\n/g, '\r\n')).rows.length === 2);
const half = Wallet.parse('Titolo: buddy\nSottotitolo: X\nData: 3 ott 2026, 10:00\n' + SAMPLE);
ok('incomplete block ignored, rest imported', half.rows.length === 2 && half.broken === 1, half);

/* ---- Which account a card lands in ---- */
const src = fs.readFileSync(ROOT + '/js/app.js', 'utf8');
const start = src.indexOf('async function walletAccountMap(');
let depth = 0, end = -1;
for (let j = src.indexOf('{', start); j < src.length; j++) {
  if (src[j] === '{') depth++;
  else if (src[j] === '}') { depth--; if (depth === 0) { end = j + 1; break; } }
}
const makeDB = (accounts, bankAccountMap) => {
  let n = 0;
  const DB = {
    state: { accounts, meta: { bankAccountMap } },
    account: (id) => DB.state.accounts.find((a) => a.id === id),
    put: async (store, rec) => { const a = { ...rec, id: 'new' + (++n) }; DB.state.accounts.push(a); return a; },
    setMeta: async (k, v) => { DB.state.meta[k] = v; }
  };
  return DB;
};
const mapFor = async (DB, rows) => {
  const ctx = vm.createContext({ DB, Object, Map });
  vm.runInContext(src.slice(start, end) + '\nglobalThis.f = walletAccountMap;', ctx);
  return ctx.f(rows);
};

(async () => {
  const rows = Wallet.parse(SAMPLE + '\nTitolo: N26\nSottotitolo: Bar. Prato, Toscana\nCorpo: 1,20 €\nData: 4 ott 2026, 08:05').rows;

  let DB = makeDB([{ id: 'a1', name: 'Buddy' }, { id: 'a2', name: 'Cash' }], undefined);
  let res = await mapFor(DB, rows);
  ok('existing account matched by name, any case', res.map['wallet:buddy'] === 'a1', res.map);
  ok('new card creates an account named after it', res.created.length === 1 && res.created[0] === 'N26' &&
    DB.state.accounts.some((a) => a.name === 'N26' && a.id === res.map['wallet:n26']), res);
  ok('mapping saved', DB.state.meta.bankAccountMap && DB.state.meta.bankAccountMap['wallet:n26'] === res.map['wallet:n26']);

  // Second import: nothing new is created, even after renaming the account.
  DB.state.accounts.find((a) => a.name === 'N26').name = 'N26 Metal';
  const before = DB.state.accounts.length;
  res = await mapFor(DB, rows);
  ok('renamed account still used, no twin created', res.created.length === 0 &&
    DB.state.accounts.length === before, res);

  // A mapping to a deleted account falls back to name / creation.
  DB = makeDB([{ id: 'a2', name: 'Cash' }], { 'wallet:buddy': 'gone' });
  res = await mapFor(DB, rows.slice(0, 1));
  ok('stale mapping recreated', res.created[0] === 'buddy' && DB.account(res.map['wallet:buddy']), res);

  if (fails) { console.log('\n' + fails + ' failing'); process.exit(1); }
})();
