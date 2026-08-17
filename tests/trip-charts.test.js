/* Renders the real tripCharts (extracted from js/app.js) against a fake DOM,
   with every requestAnimationFrame callback forced so the charts actually draw. */
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const src = fs.readFileSync(ROOT + '/js/app.js', 'utf8');

/* ---------- fake DOM ---------- */
function node(tag) {
  const n = { tag, children: [], attrs: {}, style: {}, className: '', innerHTML: '',
    _text: '', clientWidth: 340,
    setAttribute(k, v) { this.attrs[k] = String(v); },
    appendChild(c) { this.children.push(c); return c; },
    append(...cs) { cs.forEach((c) => c && this.children.push(c)); },
    addEventListener(t, f) { (this._ev = this._ev || {})[t] = f; },
    querySelector: () => null, remove() {},
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 340, height: 200 }) };
  Object.defineProperty(n, 'textContent',
    { get() { return this._text; }, set(v) { this._text = String(v); } });
  return n;
}
const document = { createElement: node, createElementNS: (ns, t) => node(t),
  documentElement: node('html'), querySelector: () => null, addEventListener() {},
  body: node('body') };
const window = { matchMedia: () => ({ matches: false }) };
const rafQueue = [];
const base = vm.createContext({ document, window, console, Intl, Date, Math, Number,
  String, Array, Map, Set, Object, JSON, setTimeout, clearTimeout, isFinite,
  crypto: { randomUUID: () => 'x' },
  getComputedStyle: () => ({ getPropertyValue: () => '#888888' }),
  requestAnimationFrame: (f) => rafQueue.push(f) });
vm.runInContext(fs.readFileSync(ROOT + '/js/util.js', 'utf8') + '\nglobalThis.U = U;', base);
vm.runInContext(fs.readFileSync(ROOT + '/js/charts.js', 'utf8') + '\nglobalThis.Charts = Charts;', base);
const U = base.U, Charts = base.Charts;

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

const el = (tag, attrs, children) => {
  const n = node(tag);
  if (attrs) for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') n.className = v;
    else if (k === 'text') n.textContent = v;
    else if (k === 'html') n.innerHTML = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v);
  }
  (children || []).forEach((c) => c && n.appendChild(c));
  return n;
};
const walk = (n, fn) => { fn(n); (n.children || []).forEach((c) => walk(c, fn)); };
const texts = (n) => { const o = []; walk(n, (x) => { if (x._text) o.push(x._text); }); return o; };
const nodesOf = (n, cls) => { const o = []; walk(n, (x) => { if (x.className === cls) o.push(x); }); return o; };
const headings = (n) => { const o = []; walk(n, (x) => { if (x.tag === 'h2') o.push(x._text); }); return o; };

function build({ today, trip, txs, confirmed }) {
  const opened = [];
  const DB = { state: { transactions: txs, meta: { trips: [trip],
    subscriptions: { confirmed: confirmed || {} } } },
    category: (id) => CATS.find((c) => c.id === id) || null };
  const ctx = vm.createContext({
    document, window, console, Intl, Date, Math, Number, String, Array, Map, Set,
    Object, JSON, setTimeout, clearTimeout,
    requestAnimationFrame: (f) => rafQueue.push(f),
    U: Object.assign(Object.create(null), U, { todayISO: () => today }),
    Charts, DB, el, fmtEUR: U.fmtEUR,
    isoOf: (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' +
      String(d.getDate()).padStart(2, '0'),
    merchantKey: (s) => String(s || '').toUpperCase().split(/\s+/)[0],
    tripHasFx: (t) => !!(t && t.currency && t.rate),
    legendKey: (color, label) => el('span', { class: 'lg-key', text: label }),
    openDayDetail: (iso) => opened.push('day:' + iso),
    openCategoryDetail: (c, r) => opened.push('cat:' + (c ? c.name : '?') + ':' + r.from),
    isProtectedRecurring: (t) => !!(t.note &&
      (DB.state.meta.subscriptions.confirmed || {})[String(t.note).toUpperCase().split(/\s+/)[0]])
  });
  vm.runInContext(extract('tripCharts') + '\nglobalThis.__draw = tripCharts;', ctx);
  const body = node('div');
  rafQueue.length = 0;
  ctx.__draw(body, trip);
  rafQueue.splice(0).forEach((f) => f());
  return { body, opened };
}

const CATS = [
  { id: 'c1', name: 'Eating out', icon: '🍽', color: 'orange' },
  { id: 'c2', name: 'Hotels', icon: '🏨', color: 'blue' },
  { id: 'c3', name: 'Transport', icon: '🚕', color: 'aqua' },
  { id: 'c4', name: 'Shopping', icon: '🛍', color: 'magenta' },
  { id: 'c5', name: 'Museums', icon: '🏛', color: 'violet' },
  { id: 'c6', name: 'Coffee', icon: '☕', color: 'yellow' },
  { id: 'c7', name: 'Gifts', icon: '🎁', color: 'green' },
  { id: 'c8', name: 'Misc', icon: '•', color: 'red' }
];
const tx = (date, amount, categoryId, note) =>
  ({ id: 'T' + date + amount, date, amount, type: 'expense', categoryId,
     accountId: 'a1', note: note || 'PLACE' });

let fails = 0;
const ok = (n, c, extra) => {
  if (c) console.log('  ✓ ' + n);
  else { fails++; console.log('  ✗ ' + n + (extra ? ' — ' + extra : '')); }
};

/* ---------- 1. finished trip abroad, with a budget ---------- */
console.log('finished trip in Turkey (1 € = 38 TL), 400 € budget, 8 days:');
{
  const trip = { id: 't1', name: 'Istanbul', emoji: '🕌', from: '2026-07-04', to: '2026-07-11',
    budget: 400, currency: 'TRY', rate: 38 };
  const txs = [
    tx('2026-07-04', 95, 'c2', 'HOTEL SULTAN'), tx('2026-07-04', 14, 'c3', 'TAXI'),
    tx('2026-07-05', 22, 'c1', 'CIYA SOFRASI'), tx('2026-07-05', 4.5, 'c6', 'KAHVE'),
    tx('2026-07-06', 31, 'c1', 'BALIK EKMEK'), tx('2026-07-06', 12, 'c5', 'AYASOFYA'),
    tx('2026-07-07', 60, 'c4', 'GRAND BAZAAR'), tx('2026-07-08', 18, 'c1', 'CIYA SOFRASI'),
    tx('2026-07-09', 9, 'c3', 'FERRY'), tx('2026-07-10', 41, 'c4', 'GRAND BAZAAR'),
    tx('2026-07-11', 27, 'c1', 'MEYHANE'),
    tx('2026-07-06', 9.99, 'c8', 'ILIAD MOBILE')          // subscription: excluded
  ];
  const { body, opened } = build({ today: '2026-08-03', trip, txs,
    confirmed: { ILIAD: true } });
  const h = headings(body);
  console.log('   cards: ' + h.join(' | '));
  ok('three chart cards', h.length === 3 && h[0] === 'Day by day' &&
    h[1] === 'Where it went' && h[2] === 'Pace', h.join(','));

  const t = texts(body).join(' | ');
  ok('amounts are in the local currency', /TRY/.test(t) && !/^\D*€/.test(t.split('|')[1] || ''), t.slice(0, 120));
  ok('no NaN', !/NaN/.test(t), t.split('|').filter((s) => /NaN/.test(s)).join(','));
  ok('no undefined', !/undefined/.test(t));

  let paths = 0, texts_ = 0;
  walk(body, (n) => { if (n.tag === 'path') paths++; if (n.tag === 'text') texts_++; });
  ok('charts actually drew', paths > 15 && texts_ > 10, 'paths=' + paths);

  // 8 days in the trip → 8 bars worth of hit targets in the first chart
  const dayCard = body.children.find((c) => headings(c)[0] === 'Day by day');
  let rects = 0;
  walk(dayCard, (n) => { if (n.tag === 'rect') rects++; });
  ok('one tappable day per trip day', rects === 8, String(rects));

  // tap day 1
  let hit = null;
  walk(dayCard, (n) => { if (!hit && n.tag === 'rect' && n._ev && n._ev.click) hit = n; });
  hit._ev.click({ stopPropagation() {} });
  ok('tapping a day opens that day', opened[0] === 'day:2026-07-04', opened.join(','));

  // category row taps scope to the trip
  const bars = nodesOf(body, 'catbar');
  // six categories are actually used; the seventh (Misc) is the excluded subscription
  ok('every used category is listed', bars.length === 6, String(bars.length));
  bars[0]._ev.click();
  ok('a category opens scoped to the trip dates',
    opened.some((o) => /^cat:.*:2026-07-04$/.test(o)), opened.join(','));

  ok('subscription is excluded and explained',
    /leave out 9,99/.test(t.replace(/\s+/g, ' ')), t.slice(-220));

  const pace = t.split(' | ').find((s) => /ahead of|behind/.test(s));
  console.log('   pace verdict: ' + pace);
  ok('pace compares against an even spend', !!pace);
}

/* ---------- 2. trip still running: pace stops at today ---------- */
console.log('\nactive trip, day 3 of 10:');
{
  const trip = { id: 't2', name: 'Lisbon', from: '2026-08-01', to: '2026-08-10', budget: 500 };
  const txs = [tx('2026-08-01', 40, 'c2'), tx('2026-08-02', 65, 'c1'), tx('2026-08-03', 20, 'c3')];
  const { body } = build({ today: '2026-08-03', trip, txs });
  const t = texts(body).join(' | ');
  ok('says which day it is', /day 3 of 10/.test(t), t);
  ok('euro-only trip shows euro', /€/.test(t) && !/TRY/.test(t));
  const paceCard = body.children.find((c) => headings(c)[0] === 'Pace');
  let dots = 0;
  walk(paceCard, (n) => { if (n.tag === 'circle') dots++; });
  ok('the spent line ends with a marker (not drawn into the future)', dots === 1, String(dots));
}

/* ---------- 3. no budget → no pace card ---------- */
console.log('\ntrip without a budget:');
{
  const trip = { id: 't3', name: 'Weekend', from: '2026-06-05', to: '2026-06-07' };
  const txs = [tx('2026-06-05', 30, 'c1'), tx('2026-06-06', 45, 'c2')];
  const { body } = build({ today: '2026-08-03', trip, txs });
  const h = headings(body);
  ok('only the two breakdown cards', h.length === 2 && !h.includes('Pace'), h.join(','));
  const t = texts(body).join(' | ');
  ok('no daily-pace reference without a budget', !/daily pace/.test(t));
}

/* ---------- 4. empty trip ---------- */
console.log('\ntrip with nothing recorded:');
{
  const trip = { id: 't4', name: 'Planned', from: '2026-09-01', to: '2026-09-05', budget: 300 };
  const { body } = build({ today: '2026-08-03', trip, txs: [] });
  const html = [];
  walk(body, (n) => { if (n.innerHTML) html.push(n.innerHTML); });
  ok('shows an empty state, not broken charts',
    html.some((h) => /No spending recorded/.test(h)), html.join(','));
  ok('and draws no cards', headings(body).length === 0);
}

/* ---------- 5. single-day trip (degenerate axis) ---------- */
console.log('\none-day trip:');
{
  const trip = { id: 't5', name: 'Day out', from: '2026-05-09', to: '2026-05-09', budget: 60 };
  const txs = [tx('2026-05-09', 42, 'c1')];
  let threw = null;
  let body;
  try { body = build({ today: '2026-08-03', trip, txs }).body; } catch (e) { threw = e; }
  ok('does not throw on a one-day span', !threw, threw && threw.message);
  if (!threw) {
    const t = texts(body).join(' | ');
    ok('no NaN on a one-day span', !/NaN/.test(t), t);
  }
}

console.log('\n' + (fails ? fails + ' FAILED' : 'all checks passed'));
process.exit(fails ? 1 : 0);
