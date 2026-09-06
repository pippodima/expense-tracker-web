/* Importing a file that carries its own category column: which names match what's
   already here, which are new, and what the new ones look like. Runs the real
   catKey / catEmojiFor / planImportCategories from js/app.js. */
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
  const i = src.indexOf('function ' + name + '(');
  if (i < 0) throw new Error('no function ' + name);
  return slice(i);
};

/* The real palette, so the colour rotation is tested against the real list. */
const baseCtx = vm.createContext({ console, Intl, Date, Math, Number, String, Array, Object,
  JSON, isFinite, crypto: { randomUUID: () => 'x' },
  window: { matchMedia: () => ({ matches: false }) },
  document: { createElement: () => ({ style: {}, setAttribute() {}, appendChild() {},
    addEventListener() {} }), body: { appendChild() {} }, querySelector: () => null },
  navigator: {}, URL: { createObjectURL: () => '', revokeObjectURL() {} }, Blob: class {} });
vm.runInContext(fs.readFileSync(ROOT + '/js/util.js', 'utf8') + '\nglobalThis.U = U;', baseCtx);
const U = baseCtx.U;

const ctx = vm.createContext({ console, String, Array, Object, Map, Set, U });
vm.runInContext([fn('catKey'), fn('catEmojiFor'), fn('planImportCategories'),
  'globalThis.api = { catKey, catEmojiFor, planImportCategories };'].join('\n'), ctx);
const { catKey, catEmojiFor, planImportCategories } = ctx.api;

let fails = 0;
const ok = (label, cond, got) => {
  if (cond) console.log('  \x1b[32m✓\x1b[0m ' + label);
  else { fails++; console.log('  \x1b[31m✗ ' + label + '\x1b[0m' + (got === undefined ? '' : '  got: ' + got)); }
};

/* The app's own starting categories. */
const CATS = [
  { id: 'c1', name: 'Groceries' }, { id: 'c2', name: 'Dining' },
  { id: 'c3', name: 'Transport' }, { id: 'c4', name: 'Other' }
];

console.log('\nname matching:');
{
  ok('exact name matches', catKey('Groceries') === catKey('Groceries'));
  ok('case is ignored', catKey('RISTORANTE') === catKey('ristorante'));
  ok('surrounding space is ignored', catKey('  Bar  ') === catKey('Bar'));
  ok('inner spacing collapses', catKey('Cura  della\tpersona') === catKey('Cura della persona'));
  ok('accents are ignored', catKey('Sanità') === catKey('sanita'));
  ok('an empty cell has no key', catKey('') === '' && catKey(null) === '' && catKey(undefined) === '');
  ok('different names stay different', catKey('Bar') !== catKey('Barca'));
}

console.log('\nthe example file (date,account,category,amount,…):');
{
  const column = ['Intrattenimento', 'Ristorante', 'Intrattenimento', 'Bar'];
  const plan = planImportCategories(column, CATS);
  ok('nothing matched the four starting categories', plan.existing.size === 4);
  ok('three distinct new names, not four rows',
    plan.fresh.length === 3, plan.fresh.length);
  ok('in first-seen order',
    plan.fresh.map((f) => f.name).join(',') === 'Intrattenimento,Ristorante,Bar',
    plan.fresh.map((f) => f.name).join(','));
  ok('the repeated one counts twice',
    plan.fresh.find((f) => f.name === 'Intrattenimento').count === 2);
  ok('each new category gets a different colour',
    new Set(plan.fresh.map((f) => f.color)).size === 3);
  ok('colours come from the real palette',
    plan.fresh.every((f) => U.PALETTE_ORDER.includes(f.color)));
  ok('the rotation continues past the existing categories rather than restarting',
    plan.fresh[0].color === U.PALETTE_ORDER[CATS.length % U.PALETTE_ORDER.length],
    plan.fresh[0].color);
}

console.log('\nmatching against what we already have:');
{
  const plan = planImportCategories(['Groceries', 'groceries', 'GROCERIES'], CATS);
  ok('a name we already have is never re-created', plan.fresh.length === 0);
  ok('and resolves to the existing id', plan.existing.get(catKey('Groceries')) === 'c1');
}
{
  const plan = planImportCategories(['Dining', 'Palestra', 'Dining', 'Palestra'], CATS);
  ok('a mixed column splits into matched and new', plan.fresh.length === 1);
  ok('the new one counts only its own rows', plan.fresh[0].count === 2);
}
{
  const plan = planImportCategories(['', '   ', null, undefined], CATS);
  ok('blank cells create nothing', plan.fresh.length === 0);
}
{
  /* A duplicate name in the app itself shouldn't make the import ambiguous. */
  const dupCats = [{ id: 'a', name: 'Bar' }, { id: 'b', name: 'bar' }];
  const plan = planImportCategories(['Bar'], dupCats);
  ok('a duplicate existing name resolves to the first', plan.existing.get('bar') === 'a');
  ok('and still creates nothing', plan.fresh.length === 0);
}

console.log('\nicons guessed for new names:');
{
  const icon = (n) => catEmojiFor(n);
  ok('Ristorante → plate', icon('Ristorante') === '🍽️', icon('Ristorante'));
  ok('Bar → coffee', icon('Bar') === '☕', icon('Bar'));
  ok('Intrattenimento → clapperboard', icon('Intrattenimento') === '🎬', icon('Intrattenimento'));
  ok('Spesa → trolley', icon('Spesa') === '🛒', icon('Spesa'));
  ok('Trasporti → bus', icon('Trasporti') === '🚌', icon('Trasporti'));
  ok('Salute → pill', icon('Salute') === '💊', icon('Salute'));
  ok('Stipendio → money', icon('Stipendio') === '💰', icon('Stipendio'));
  ok('English works too', icon('Groceries') === '🛒' && icon('Restaurants') === '🍽️');
  ok('an unknown name still gets an icon', icon('Zxq') === '📦', icon('Zxq'));
  ok('case and accents do not defeat the guess', icon('SANITÀ') === '💊', icon('SANITÀ'));
  /* "Bar" is a whole word, not a fragment: Barbiere must not read as a café. */
  ok('a name merely containing "bar" is not a café', icon('Barbiere') !== '☕', icon('Barbiere'));
}

console.log('\n' + (fails ? fails + ' FAILED' : 'all checks passed'));
process.exit(fails ? 1 : 0);
