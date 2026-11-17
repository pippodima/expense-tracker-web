/* Bottom sheets vs the keyboard. On an iPhone you lower the keyboard by swiping down
   or by tapping above the sheet, and both used to close the sheet: a fully filled
   "New transaction" was gone the moment you pushed the keyboard away to press Add.
   Runs the real openSheet / enableDragClose / typingIn from js/app/core/sheets.js on
   a fake DOM, plus the rule suggestion in the review queue's assign sheet. */
const vm = require('vm');
const { src } = require('./app-source');

function slice(startIdx) {
  let depth = 0;
  for (let j = src.indexOf('{', startIdx); j < src.length; j++) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}') { depth--; if (depth === 0) return src.slice(startIdx, j + 1); }
  }
  throw new Error('unbalanced at ' + startIdx);
}
const fn = (name) => {
  const i = src.indexOf('function ' + name + '(');
  if (i < 0) throw new Error('no function ' + name);
  return slice(i);
};
const line = (prefix) => {
  const i = src.indexOf(prefix);
  if (i < 0) throw new Error('no ' + prefix);
  return src.slice(i, src.indexOf('\n', i));
};

/* ---------- fake DOM: just enough tree, focus and events ---------- */
function makeWorld() {
  const doc = { activeElement: null };
  function node(tag, attrs = {}, children = []) {
    const n = {
      tagName: tag.toUpperCase(), type: attrs.type || '', value: attrs.value, text: attrs.text,
      children: [], parent: null, listeners: {}, style: {}, scrollTop: 0, isContentEditable: false,
      _cls: new Set(String(attrs.class || '').split(' ').filter(Boolean)),
      get classList() {
        const s = n._cls;
        return { add: (c) => s.add(c), remove: (c) => s.delete(c), contains: (c) => s.has(c) };
      },
      append(...cs) {
        cs.flat().forEach((c) => { if (c && typeof c === 'object') { c.parent = n; n.children.push(c); } });
      },
      addEventListener(t, f) { (n.listeners[t] = n.listeners[t] || []).push(f); },
      fire(t, e = {}) {
        (n.listeners[t] || []).forEach((f) => f(Object.assign({ target: n, preventDefault() {} }, e)));
      },
      contains(x) { for (let c = x; c; c = c.parent) if (c === n) return true; return false; },
      all() { return [n, ...n.children.flatMap((c) => c.all())]; },
      querySelector(tagName) { return n.all().slice(1).find((c) => c.tagName === tagName.toUpperCase()) || null; },
      focus() { doc.activeElement = n; },
      blur() { if (doc.activeElement === n) doc.activeElement = doc.body; },
      remove() { n.removed = true; },
      set innerHTML(v) { n.children = []; }
    };
    if (attrs.onclick) n.addEventListener('click', attrs.onclick);
    n.append(children);
    return n;
  }
  doc.body = node('body');
  doc.activeElement = doc.body;
  const ctx = vm.createContext({
    document: doc, ui: { sheetZ: 50 }, Math, String, Object,
    el: node, requestAnimationFrame: (f) => f(), setTimeout: (f) => f()
  });
  vm.runInContext([line('const NO_KEYBOARD = '), fn('typingIn'), fn('lowerKeyboard'),
    fn('enableDragClose'), fn('openSheet')].join('\n') + '\nglobalThis.openSheet = openSheet;', ctx);

  /* A "New transaction"-like sheet: a text field, a number field, a checkbox. */
  let note, amount, check;
  const api = ctx.openSheet('New transaction', (body) => {
    note = node('input', { type: 'text' });
    amount = node('input', { type: 'text' });
    check = node('input', { type: 'checkbox' });
    body.append(amount, note, check);
  });
  const [backdrop, sheet] = doc.body.children;
  const open = () => sheet.classList.contains('show') && !sheet.removed;
  const swipe = (target, dy, dx = 0) => {
    sheet.fire('touchstart', { target, touches: [{ clientX: 100, clientY: 300 }] });
    for (let s = 1; s <= 5; s++) {
      sheet.fire('touchmove', { target, touches: [{ clientX: 100 + dx * s / 5, clientY: 300 + dy * s / 5 }] });
    }
    sheet.fire('touchend', { target });
  };
  const tapBackdrop = () => { backdrop.fire('pointerdown'); backdrop.fire('click'); };
  return { doc, api, note, amount, check, sheet, backdrop, open, swipe, tapBackdrop,
    closeBtn: sheet.all().find((c) => c.tagName === 'BUTTON' && c.text === 'Close') };
}

let fails = 0;
const ok = (n, c, extra) => {
  if (c) console.log('  ✓ ' + n);
  else { fails++; console.log('  ✗ ' + n + (extra !== undefined ? ' — ' + JSON.stringify(extra) : '')); }
};

console.log('swipe down');
{
  const w = makeWorld();
  w.note.focus();
  w.swipe(w.note, 200);
  ok('while typing: the sheet stays open', w.open());
  ok('while typing: the keyboard goes down', w.doc.activeElement !== w.note);
  ok('while typing: the sheet is not dragged', !w.sheet.style.transform);
  w.swipe(w.note, 200);
  ok('keyboard already down: the same swipe closes it, as before', !w.open());
}
{
  const w = makeWorld();
  w.swipe(w.note, 200);
  ok('never typed: a swipe down closes, as before', !w.open());
}
{
  const w = makeWorld();
  w.note.focus();
  w.swipe(w.note, -200);
  ok('swipe up while typing: keyboard stays, sheet stays', w.open() && w.doc.activeElement === w.note);
}
{
  const w = makeWorld();
  w.note.focus();
  w.swipe(w.note, 20, 200);
  ok('sideways swipe while typing: keyboard stays', w.open() && w.doc.activeElement === w.note);
}
{
  const w = makeWorld();
  w.check.focus();
  w.swipe(w.note, 200);
  ok('a focused checkbox has no keyboard: swipe closes, as before', !w.open());
}

console.log('tap above the sheet');
{
  const w = makeWorld();
  w.amount.focus();
  w.tapBackdrop();
  ok('while typing: the sheet stays open', w.open());
  ok('while typing: the keyboard goes down', w.doc.activeElement !== w.amount);
  w.tapBackdrop();
  ok('keyboard already down: the next tap closes, as before', !w.open());
}
{
  const w = makeWorld();
  w.note.focus();
  w.backdrop.fire('pointerdown');
  w.note.blur();                            // the browser moved focus between down and click
  w.backdrop.fire('click');
  ok('focus lost before the click still counts as typing', w.open());
}
{
  const w = makeWorld();
  w.tapBackdrop();
  ok('never typed: a tap closes, as before', !w.open());
}
{
  const w = makeWorld();
  w.note.focus();
  w.closeBtn.fire('click');
  ok('the Close button always closes, even while typing', !w.open());
}

console.log('rule suggestion in the review queue');
{
  const fields = [];
  const node = (tag, attrs = {}, children = []) => {
    const n = { tag, attrs, children: [], value: attrs.value, checked: false,
      append(...cs) { cs.flat().forEach((c) => c && typeof c === 'object' && n.children.push(c)); },
      addEventListener() {}, set innerHTML(v) { n.children = []; } };
    if (tag === 'input') fields.push(n);
    n.append(children);
    return n;
  };
  const ctx = vm.createContext({
    el: node, toast() {}, fmtEUR: (n) => n + ' €', orderedCategories: () => [],
    U: { colorOf: () => '', fmtDate: (d) => d },
    openSheet: (title, build) => build(node('div'), { close() {} })
  });
  vm.runInContext(fn('openAssignSheet') + '\nglobalThis.openAssignSheet = openAssignSheet;', ctx);
  const suggest = (note) => {
    fields.length = 0;
    ctx.openAssignSheet({ note, date: '2026-11-17', amount: 5, type: 'expense' }, () => {});
    const [ruleToggle, pattern] = fields;
    return { value: pattern.value, on: ruleToggle.checked };
  };
  const a = suggest('Esselunga Canova Firenze');
  ok('the suggested rule is the whole description, as written', a.value === 'Esselunga Canova Firenze', a);
  ok('…and the rule toggle starts on', a.on === true);
  ok('surrounding spaces are trimmed', suggest('  Bar Mario  ').value === 'Bar Mario');
  const b = suggest('');
  ok('no description: empty suggestion, toggle off', b.value === '' && b.on === false, b);
}

if (fails) { console.log(fails + ' failed'); process.exit(1); }
