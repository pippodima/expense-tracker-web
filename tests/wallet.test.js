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

/* ---- Only payments: the body must be an amount with a currency, nothing else ---- */
[['5,00 €', true], ['+12,50 €', true], ['Rimborso: 8,00 €', true], ['Rimborso 5,00 €', true],
  ['1.234,56 €', true], ['1 234,56 €', true], ['€ 5,00', true], ['$8.99', true],
  ['8,99 USD', true], ['12,00 US$', true], ['-3,50 €', true],
  ['2/10 stamps earned', false], ['Carta aggiunta', false], ['12', false], ['12,00', false],
  ['Hai risparmiato 2,00 € sul tuo ordine', false], ['5,00 € · Contactless', false],
  ['12.5 €', false], ['5,00 € EUR', false], ['abc 5,00', false], ['', false]
].forEach(([body, want]) => ok((want ? 'payment: ' : 'not a payment: ') + JSON.stringify(body),
  Wallet.isPaymentBody(body) === want));

const STAMPS = 'Titolo: tappa-mi\nSottotitolo: \nCorpo: 2/10 stamps earned\nData: 4 ott 2026, 17:29';
const mixed = Wallet.parse(SAMPLE + '\n' + STAMPS);
ok('loyalty stamps skipped, counted, no account for them', mixed.rows.length === 2 &&
  mixed.ignored === 1 && !mixed.broken && !mixed.rows.some((x) => x.card === 'tappa-mi'), mixed);
ok('ids unchanged by a skipped block in between',
  Wallet.parse(STAMPS + '\n' + SAMPLE).rows[0].externalId === r.rows[0].externalId);
ok('zero amount is not a payment', Wallet.parse(SAMPLE.split('\n').slice(0, 2).join('\n') +
  '\nCorpo: 0,00 €\nData: 3 ott 2026, 01:30').ignored === 1);

/* ---- Subtitles ---- */
ok('merchant with its own period', Wallet.splitSubtitle('St. Mary Bar. Firenze, Toscana').merchant === 'St. Mary Bar');
ok('no place at all', Wallet.splitSubtitle('Amazon').merchant === 'Amazon');

/* ---- Robustness ---- */
ok('English labels + full month', Wallet.parse('Title: buddy\nSubtitle: X. Roma, Lazio\nBody: 2,00 €\nDate: 12 October 2026, 9:05').rows[0].date === '2026-10-12');
ok('CRLF and BOM', Wallet.parse('﻿' + SAMPLE.replace(/\n/g, '\r\n')).rows.length === 2);
const half = Wallet.parse('Titolo: buddy\nSottotitolo: X\nData: 3 ott 2026, 10:00\n' + SAMPLE);
ok('incomplete block ignored, rest imported', half.rows.length === 2 && half.broken === 1, half);

/* ---- The buddybank app's notifications, as they land in the real log ---- */
const block = (title, body, date) => ['Titolo: ' + title, 'Sottotitolo: ', 'Corpo: ' + body, 'Data: ' + date].join('\n');
const REQ = 'Autorizza pagamento e-commerce di 49,00EUR c/o PAYPAL *acme store, carta *0000, 11/10/2026 e 22:43';
const CONF = 'buddy UniCredit conferma op.Internet 49,00 EUR carta *0000 c/o PAYPAL *acme store Luxembo 11/10/26 22:43. Per info o blocco 800290915';
const PAYPAL = [block('Pagamento e-commerce', REQ, '11 ott 2026, 22:43'), block('', REQ, '11 ott 2026, 22:43'),
  block('Transazione autorizzata.', CONF, '11 ott 2026, 22:43')].join('\n');

r = Wallet.parse(SAMPLE + '\n' + PAYPAL);
const pp = r.rows[2];
ok('three notifications, one €49 payment', r.rows.length === 3 && pp && pp.amount === -49, r.rows);
ok('approval requests skipped, not broken', r.ignored === 2 && !r.broken, r);
ok('bank payment lands on the buddy card', pp.accountUuid === 'wallet:buddy' && pp.card === 'buddy', pp);
ok('bank payment dated from its own text', pp.date === '2026-10-11' && pp.time === '22:43', pp);
ok('merchant from "c/o"', pp.note === 'PAYPAL *acme store Luxembo', pp.note);
ok('wallet ids unchanged by bank rows', r.rows[0].externalId === Wallet.parse(SAMPLE).rows[0].externalId);
ok('the same confirmation logged twice is one payment',
  Wallet.parse(PAYPAL + '\n' + block('Transazione autorizzata.', CONF, '11 ott 2026, 22:44')).rows.length === 1);
ok('no brand in front → named after the card digits',
  Wallet.parseBankConfirm('UniCredit conferma op. 3,00 EUR carta *0000 c/o BAR 01/10/26 08:00').card === 'carta *0000');

/* ---- Wallet + bank for the same payment: one row, both ids ---- */
const conf = (amount, merchant, d, t) =>
  block('Transazione autorizzata.', `buddy UniCredit conferma op. ${amount} EUR carta *0000 c/o ${merchant} ${d} ${t}.`, '');
const wal = (merchant, amount, date) => block('buddy', amount, date).replace('Sottotitolo: ', 'Sottotitolo: ' + merchant);
// Paid offline at 23:50, Wallet only told us the next morning.
const lateWallet = wal('Bar Roma. Prato, Toscana', '4,50 €', '13 ott 2026, 09:12');
const bankLine = conf('4,50', 'BAR ROMA PRATO', '12/10/26', '23:50');
const both = Wallet.parse(bankLine + '\n' + lateWallet);
const one = both.rows[0];
ok('paired into one row', both.rows.length === 1 && both.merged === 1, both);
ok('paired row: Wallet name, bank date', one.note === 'Bar Roma' && one.place === 'Prato, Toscana' &&
  one.date === '2026-10-12' && one.time === '23:50', one);
const bankOnly = Wallet.parse(bankLine).rows[0], walletOnly = Wallet.parse(lateWallet).rows[0];
ok('paired row known by both ids, first-logged one as main',
  one.externalId === bankOnly.externalId && one.altIds[0] === walletOnly.externalId, one);
ok('either order pairs the same way',
  Wallet.parse(lateWallet + '\n' + bankLine).rows[0].externalId === walletOnly.externalId);
// Same coffee, same price, two mornings: each pairs with its own day.
const coffees = Wallet.parse([
  wal('Bar. Firenze, Toscana', '1,20 €', '1 ott 2026, 08:01'), conf('1,20', 'BAR', '01/10/26', '08:00'),
  wal('Bar. Firenze, Toscana', '1,20 €', '2 ott 2026, 08:01'), conf('1,20', 'BAR', '02/10/26', '08:00')].join('\n'));
ok('equal amounts on two days pair with their own day', coffees.rows.length === 2 &&
  coffees.rows[0].date === '2026-10-01' && coffees.rows[1].date === '2026-10-02', coffees.rows);
ok('different amount never pairs', Wallet.parse(conf('4,60', 'BAR ROMA', '12/10/26', '23:50') + '\n' + lateWallet).rows.length === 2);
ok('three days apart never pairs', Wallet.parse(conf('4,50', 'BAR ROMA', '09/10/26', '23:50') + '\n' + lateWallet).rows.length === 2);

/* ---- Pull a top-level function out of js/app.js ---- */
const src = fs.readFileSync(ROOT + '/js/app.js', 'utf8');
const extract = (sig) => {
  const s = src.indexOf(sig);
  let depth = 0;
  for (let j = src.indexOf('{', s); j < src.length; j++) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}') { depth--; if (depth === 0) return src.slice(s, j + 1); }
  }
};

/* ---- Which account a card lands in ---- */
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
  vm.runInContext(extract('async function walletAccountMap(') + '\nglobalThis.f = walletAccountMap;', ctx);
  return ctx.f(rows);
};

/* ---- The real applyBankSync against an in-memory DB ---- */
const syncDB = () => {
  let n = 0;
  const DB = {
    state: { transactions: [], meta: {} },
    bulkPut: async (store, recs) => recs.forEach((rec) => {
      const t = rec.id ? rec : { ...rec, id: 't' + (++n) };
      const i = DB.state.transactions.findIndex((x) => x.id === t.id);
      if (i >= 0) DB.state.transactions[i] = t; else DB.state.transactions.push(t);
    }),
    setMeta: async (k, v) => { DB.state.meta[k] = v; },
    suggestCategory: () => ({ id: 'c1' })
  };
  const ctx = vm.createContext({ DB, ui: { stats: {} }, ensureCategory: async () => ({ id: 'uc' }),
    bumpChanges: async () => {}, openSheet: () => {}, render: () => {}, el: () => ({}) });
  vm.runInContext(extract('async function applyBankSync(') + '\nglobalThis.f = applyBankSync;', ctx);
  const sync = (text) => ctx.f({ transactions: Wallet.parse(text).rows }, { 'wallet:buddy': 'a1' });
  return { DB, sync };
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

  // Your date edit survives the next import of the same file.
  let s = syncDB();
  await s.sync(lateWallet);
  ok('late Wallet notification imported on its own day', s.DB.state.transactions[0].date === '2026-10-13');
  Object.assign(s.DB.state.transactions[0], { date: '2026-10-12', userEdited: true });
  await s.sync(lateWallet);
  ok('re-import keeps your edited date', s.DB.state.transactions.length === 1 &&
    s.DB.state.transactions[0].date === '2026-10-12', s.DB.state.transactions);
  // …and an unedited one is still corrected when the bank confirmation shows up.
  s = syncDB();
  await s.sync(lateWallet);
  await s.sync(lateWallet + '\n' + bankLine);
  ok('bank confirmation fixes the date of the Wallet row, no twin', s.DB.state.transactions.length === 1 &&
    s.DB.state.transactions[0].date === '2026-10-12', s.DB.state.transactions);
  // Bank first, Wallet a day later: still one transaction.
  s = syncDB();
  await s.sync(bankLine);
  await s.sync(bankLine + '\n' + lateWallet);
  ok('Wallet arriving after the bank row: no twin', s.DB.state.transactions.length === 1, s.DB.state.transactions);
  // The whole real log twice over: the €49 once, nothing doubled.
  s = syncDB();
  await s.sync(SAMPLE + '\n' + PAYPAL);
  await s.sync(SAMPLE + '\n' + PAYPAL);
  ok('real log imported twice: 3 transactions, €49 once', s.DB.state.transactions.length === 3 &&
    s.DB.state.transactions.filter((t) => t.amount === 49).length === 1, s.DB.state.transactions);

  if (fails) { console.log('\n' + fails + ' failing'); process.exit(1); }
})();
