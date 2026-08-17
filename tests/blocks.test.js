/* The rearrangeable-blocks system: order/visibility maths, the render pass, the
   arrange sheet's buttons, and the drag gesture — all running the real code. */
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const src = fs.readFileSync(ROOT + '/js/app.js', 'utf8');

function slice(startIdx) {
  let depth = 0;
  for (let j = src.indexOf('{', startIdx); j < src.length; j++) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}') { depth--; if (depth === 0) return src.slice(startIdx, j + 1); }
  }
  throw new Error('unbalanced at ' + startIdx);
}
const fn = (name) => {
  let i = src.indexOf('function ' + name + '(');
  if (i < 0) throw new Error('no function ' + name);
  if (src.slice(i - 6, i) === 'async ') i -= 6;    // keep the async keyword
  return slice(i);
};
const cnst = (name) => {
  const i = src.indexOf('const ' + name + ' = ');
  if (i < 0) throw new Error('no const ' + name);
  return slice(i) + ';';
};
const arrow = (name) => {
  const i = src.indexOf('const ' + name + ' = ');
  const end = src.indexOf('\n\n', i);
  return src.slice(i, end);
};

/* ---------- fake DOM ---------- */
let nextTop = 0;
function node(tag) {
  const n = {
    tag, children: [], attrs: {}, className: '', innerHTML: '', _text: '',
    style: {}, _classes: new Set(), _rectTop: 0,
    classList: {
      add: (c) => n._classes.add(c), remove: (c) => n._classes.delete(c),
      contains: (c) => n._classes.has(c)
    },
    setAttribute(k, v) { this.attrs[k] = String(v); },
    appendChild(c) { this.children.push(c); return c; },
    append(...cs) { cs.forEach((c) => c && this.children.push(c)); },
    addEventListener(t, f) { (this._ev = this._ev || {})[t] = f; },
    removeEventListener(t) { if (this._ev) delete this._ev[t]; },
    setPointerCapture() {},
    getBoundingClientRect() { return { top: this._rectTop, height: 52, left: 0, width: 300 }; },
    querySelector(sel) {
      const want = sel.replace('.', '');
      const hit = (x) => (x.className || '').split(' ').includes(want) ? x
        : (x.children || []).reduce((a, c) => a || hit(c), null);
      return (this.children || []).reduce((a, c) => a || hit(c), null);
    },
    remove() {}
  };
  Object.defineProperty(n, 'textContent',
    { get() { return this._text; }, set(v) { this._text = String(v); } });
  return n;
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

function world(meta) {
  const saved = [];
  const DB = {
    state: { meta: Object.assign({}, meta) },
    setMeta: async (k, v) => { DB.state.meta[k] = v; saved.push(k); }
  };
  const sheets = [];
  const ctx = vm.createContext({
    console, Object, Array, Map, Set, Math, Number, String, JSON, DB, el,
    render: () => sheets.push('render'),
    openSheet: (title, build) => { const body = node('div'); sheets.push({ title, body }); build(body, { close() {} }); }
  });
  vm.runInContext([
    cnst('BLOCKS'), arrow('blockPrefs'),
    fn('setBlockPrefs'), fn('blockSequence'), fn('renderBlocks'),
    fn('openArrangeSheet'), fn('makeSortable'), fn('arrangeButton'),
    'globalThis.api = { blockSequence, renderBlocks, openArrangeSheet, makeSortable, BLOCKS };'
  ].join('\n'), ctx);
  return { ctx, DB, sheets, api: ctx.api };
}

let fails = 0;
const ok = (n, c, extra) => {
  if (c) console.log('  ✓ ' + n);
  else { fails++; console.log('  ✗ ' + n + (extra ? ' — ' + extra : '')); }
};

/* ---------- order maths ---------- */
console.log('order:');
{
  const { api } = world({});
  ok('defaults to the catalogue order',
    api.blockSequence('dashboard').seq.join(',') === 'trip,budget,top',
    api.blockSequence('dashboard').seq.join(','));
}
{
  const { api } = world({ blocks: { dashboard: { order: ['top', 'trip', 'budget'], hidden: {} } } });
  ok('respects a saved order', api.blockSequence('dashboard').seq.join(',') === 'top,trip,budget');
}
{
  const { api } = world({ blocks: { dashboard: { order: ['top', 'ghost', 'trip'], hidden: {} } } });
  const seq = api.blockSequence('dashboard').seq;
  ok('drops keys that no longer exist', !seq.includes('ghost'), seq.join(','));
  ok('and keeps the saved ones in their saved order',
    seq.indexOf('top') < seq.indexOf('trip'), seq.join(','));
  ok('every block is present exactly once',
    seq.length === 3 && new Set(seq).size === 3, seq.join(','));
}
{
  // A partial order only arises when an app update adds a block the user has
  // never arranged; it should appear where it belongs, not always at the bottom.
  const { api } = world({ blocks: { dashboard: { order: ['top', 'trip'], hidden: {} } } });
  ok('a newly-added block lands at its default position, not the bottom',
    api.blockSequence('dashboard').seq.join(',') === 'top,budget,trip',
    api.blockSequence('dashboard').seq.join(','));
}
{
  const { api } = world({ blocks: { dashboard: { order: ['top', 'top', 'trip'], hidden: {} } } });
  const seq = api.blockSequence('dashboard').seq;
  ok('a duplicated key appears once',
    seq.length === 3 && new Set(seq).size === 3 && seq.indexOf('top') < seq.indexOf('trip'),
    seq.join(','));
}

/* ---------- the render pass ---------- */
console.log('\nrender:');
{
  const { api } = world({ blocks: { 'stats-trends': {
    order: ['weekday', 'mix', 'pace'], hidden: { savings: true } } } });
  const root = node('div');
  const built = [];
  const mk = (k) => () => { built.push(k); return el('div', { class: 'card', text: k }); };
  api.renderBlocks(root, 'stats-trends', {
    mix: mk('mix'), movers: mk('movers'), pace: () => null,
    fixed: mk('fixed'), savings: mk('savings'), weekday: mk('weekday')
  });
  const shown = root.children.map((c) => c._text);
  const order = shown.join(',');
  ok('saved blocks keep their saved relative order',
    shown.indexOf('weekday') < shown.indexOf('mix'), order);
  ok('a builder returning null is skipped', !order.includes('pace'), order);
  ok('a hidden block is never even built', !built.includes('savings'), built.join(','));
  ok('unlisted blocks still render at their defaults',
    order.includes('movers') && order.includes('fixed'), order);
}

/* ---------- the arrange sheet ---------- */
console.log('\narrange sheet:');
{
  const w = world({});
  w.api.openArrangeSheet('dashboard');
  const sheet = w.sheets.find((s) => s && s.title === 'Arrange');
  ok('opens a sheet', !!sheet);
  const rows = [];
  const walk = (n) => { if ((n.className || '').startsWith('ar-row')) rows.push(n);
    (n.children || []).forEach(walk); };
  walk(sheet.body);
  ok('one row per block', rows.length === 3, String(rows.length));
  ok('rows are named', rows.map((r) => r.children[1]._text).join(',') === 'Active trip,Budget,Top spending',
    rows.map((r) => r.children[1]._text).join(','));

  // ↓ on the first row
  rows[0].children[3]._ev.click();
  const after = w.DB.state.meta.blocks.dashboard.order.join(',');
  ok('the down arrow moves a block', after === 'budget,trip,top', after);

  // hide the last block
  const rows2 = [];
  const walk2 = (n) => { if ((n.className || '').startsWith('ar-row')) rows2.push(n);
    (n.children || []).forEach(walk2); };
  walk2(sheet.body);
  rows2[2].children[4]._ev.click();
  ok('the eye hides a block',
    w.DB.state.meta.blocks.dashboard.hidden[rows2[2].attrs['data-key']] === true,
    JSON.stringify(w.DB.state.meta.blocks.dashboard.hidden));
}

/* ---------- the drag gesture ---------- */
console.log('\ndrag:');
function dragCase(from, dy, expect, label) {
  const { api } = world({});
  const order = ['a', 'b', 'c', 'd'];
  const list = node('div');
  order.forEach((k, i) => {
    const handle = el('span', { class: 'ar-handle' });
    const row = el('div', { class: 'ar-row' }, [handle]);
    row._rectTop = i * 60;            // 52px row + 8px gap
    list.appendChild(row);
  });
  let done = 0;
  api.makeSortable(list, order, () => { done++; });
  const row = list.children[from];
  const handle = row.children[0];
  handle._ev.pointerdown({ preventDefault() {}, clientY: 0, pointerId: 1 });
  handle._ev.pointermove({ clientY: dy });
  handle._ev.pointerup({});
  ok(label, order.join('') === expect, order.join('') + ' (wanted ' + expect + ')');
  return done;
}
dragCase(0, 120, 'bcad', 'dragging the first row down two slots');
dragCase(3, -180, 'dabc', 'dragging the last row to the top');
dragCase(1, 60, 'acbd', 'a one-slot nudge');
const noMove = dragCase(2, 10, 'abcd', 'a tiny wobble changes nothing');
ok('and does not trigger a save', noMove === 0, String(noMove));
{
  const { api } = world({});
  const order = ['a', 'b', 'c'];
  const list = node('div');
  order.forEach((k, i) => {
    const row = el('div', { class: 'ar-row' }, [el('span', { class: 'ar-handle' })]);
    row._rectTop = i * 60;
    list.appendChild(row);
  });
  api.makeSortable(list, order, () => {});
  const handle = list.children[0].children[0];
  handle._ev.pointerdown({ preventDefault() {}, clientY: 0, pointerId: 1 });
  handle._ev.pointermove({ clientY: 9999 });     // yanked way past the end
  handle._ev.pointerup({});
  ok('dragging past the end clamps to the last slot', order.join('') === 'bca', order.join(''));
}
{
  const { api } = world({});
  const list = node('div');
  list.appendChild(el('div', { class: 'ar-row' }, [el('span', { class: 'ar-handle' })]));
  let threw = null;
  try { api.makeSortable(list, ['only'], () => {}); } catch (e) { threw = e; }
  ok('a single row is left alone instead of crashing', !threw, threw && threw.message);
}

console.log('\n' + (fails ? fails + ' FAILED' : 'all checks passed'));
process.exit(fails ? 1 : 0);
