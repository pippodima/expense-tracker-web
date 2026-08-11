/* Renders the real budgetCard so the new "why isn't today the base amount" line
   is actually exercised, not just type-checked. */
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const src = fs.readFileSync(ROOT + '/js/app.js', 'utf8');

const baseCtx = vm.createContext({ console, Intl, Date, Math, Number, String, Array,
  Object, JSON, setTimeout, clearTimeout, isFinite, crypto: { randomUUID: () => 'x' },
  window: { matchMedia: () => ({ matches: false }) },
  document: { createElement: () => ({ style: {}, setAttribute() {}, appendChild() {},
    addEventListener() {}, classList: { add() {}, remove() {} } }),
    body: { appendChild() {} }, querySelector: () => null },
  navigator: {}, URL: {}, Blob: class {} });
vm.runInContext(fs.readFileSync(ROOT + '/js/util.js', 'utf8') + '\nglobalThis.U = U;', baseCtx);
const U = baseCtx.U;

function extract(name) {
  const start = src.indexOf('function ' + name + '(');
  let depth = 0;
  for (let j = src.indexOf('{', start); j < src.length; j++) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}') { depth--; if (depth === 0) return src.slice(start, j + 1); }
  }
}
function node(tag) {
  const n = { tag, children: [], className: '', _text: '', style: {},
    setAttribute() {}, appendChild(c) { this.children.push(c); return c; },
    append(...cs) { cs.forEach((c) => c && this.children.push(c)); },
    addEventListener() {}, querySelector: () => null };
  Object.defineProperty(n, 'textContent',
    { get() { return this._text; }, set(v) { this._text = String(v); } });
  return n;
}
const el = (tag, attrs, children) => {
  const n = node(tag);
  if (attrs) for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') n.className = v;
    else if (k === 'text') n.textContent = v;
  }
  (children || []).forEach((c) => c && n.appendChild(c));
  return n;
};
const texts = (n, out = []) => {
  if (n._text) out.push(n._text);
  (n.children || []).forEach((c) => texts(c, out));
  return out;
};
const ctx = vm.createContext({ console, Math, Number, String, Object, U, el,
  fmtEUR: U.fmtEUR, meter: () => el('div', { class: 'meter' }),
  openBudgetSheet: () => {} });
vm.runInContext(extract('budgetCard') + '\nglobalThis.__c = budgetCard;', ctx);

let fails = 0;
const ok = (n, c, extra) => {
  if (c) console.log('  ✓ ' + n);
  else { fails++; console.log('  ✗ ' + n + (extra ? ' — ' + extra : '')); }
};

// August, day 3 of 31, 600 € budget, 50 € spent on the 2nd (the reported action)
const bs = { amount: 600, mode: 'daily', D: 31, d: 3, dailyBase: 600 / 31,
  spentMonth: 50, monthRemaining: 550, isCurrent: true,
  spentBefore: 50, spentToday: 0, committedAhead: 0,
  todayBudget: 550 / 29, todayRemaining: 550 / 29,
  tomorrowBudget: 550 / 28, daysLeftAfter: 28 };
const t = texts(ctx.__c(bs, false)).join(' | ');
console.log('\nback-dated 50 € yesterday:');
console.log('   ' + t.split(' | ').filter((s) => /vs the|base/.test(s)).join('\n   '));
ok('explains the shift away from base', /vs the .* base/.test(t), t);
ok('names the cause', /spent earlier/.test(t));
ok('names the days it was spread over', /29 days left/.test(t));

const bs2 = Object.assign({}, bs, { spentBefore: 0, committedAhead: 300,
  todayBudget: 300 / 29, todayRemaining: 300 / 29, tomorrowBudget: 300 / 28 });
const t2 = texts(ctx.__c(bs2, false)).join(' | ');
console.log('\n300 € booked ahead:');
console.log('   ' + t2.split(' | ').filter((s) => /vs the/.test(s)).join('\n   '));
ok('explains reserved money', /booked ahead/.test(t2), t2);

// exactly on base → no explanation needed
const bs3 = Object.assign({}, bs, { spentBefore: 600 / 31 * 2, committedAhead: 0,
  todayBudget: 600 / 31, todayRemaining: 600 / 31 });
const t3 = texts(ctx.__c(bs3, false)).join(' | ');
ok('stays quiet when today is exactly the base', !/vs the/.test(t3), t3);

// monthly mode → no daily block at all
const t4 = texts(ctx.__c({ amount: 600, mode: 'monthly', spentMonth: 50,
  monthRemaining: 550, isCurrent: true, D: 31 }, false)).join(' | ');
ok('monthly mode shows no daily lines', !/vs the/.test(t4) && /Monthly budget/.test(t4), t4);

console.log('\n' + (fails ? fails + ' FAILED' : 'all checks passed'));
process.exit(fails ? 1 : 0);
