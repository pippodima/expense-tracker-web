/* Any emoji can be a category icon, which means splitting text into grapheme
   clusters rather than characters: a family emoji is four codepoints joined by
   ZWJ, a flag is two regional indicators, a thumbs-up may carry a skin tone.
   Runs the real graphemes / lastGrapheme from js/app.js. */
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const src = fs.readFileSync(ROOT + '/js/app.js', 'utf8');

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

const mk = (withSegmenter) => {
  const ctx = vm.createContext({ console, String, Array, Object,
    Intl: withSegmenter ? Intl : {} });
  vm.runInContext([extract('graphemes'), extract('lastGrapheme'),
    'globalThis.api = { graphemes, lastGrapheme };'].join('\n'), ctx);
  return ctx.api;
};

let fails = 0;
const ok = (label, cond, got) => {
  if (cond) console.log('  \x1b[32m✓\x1b[0m ' + label);
  else { fails++; console.log('  \x1b[31m✗ ' + label + '\x1b[0m' +
    (got === undefined ? '' : '  got: ' + JSON.stringify(got))); }
};

/* Every one of these would be shredded by str[0] or slice(0, 1). */
const HARD = [
  ['a ZWJ family', '👨‍👩‍👧‍👦'],
  ['a skin-tone modifier', '👍🏽'],
  ['a country flag', '🇮🇹'],
  ['a variation selector', '❤️'],
  ['a keycap', '#️⃣'],
  ['a plain pictograph', '🛒'],
  ['a rainbow flag', '🏳️‍🌈']
];

for (const withSeg of [true, false]) {
  console.log('\n' + (withSeg ? 'with Intl.Segmenter:' : 'fallback, no Intl.Segmenter:'));
  const { graphemes, lastGrapheme } = mk(withSeg);

  for (const [label, emoji] of HARD) {
    ok(label + ' stays whole', graphemes(emoji).length === 1, graphemes(emoji));
  }
  ok('a run of hard emoji splits one per emoji',
    graphemes(HARD.map((h) => h[1]).join('')).length === HARD.length,
    graphemes(HARD.map((h) => h[1]).join('')));

  /* Typing a second emoji must replace the first, so the newest wins. */
  ok('the newest emoji wins', lastGrapheme('🛒🎯') === '🎯', lastGrapheme('🛒🎯'));
  ok('...even when the previous one was a family',
    lastGrapheme('👨‍👩‍👧‍👦🎯') === '🎯', lastGrapheme('👨‍👩‍👧‍👦🎯'));
  ok('...and when the new one is a family',
    lastGrapheme('🛒👨‍👩‍👧‍👦') === '👨‍👩‍👧‍👦', lastGrapheme('🛒👨‍👩‍👧‍👦'));
  ok('...and when the new one is a flag',
    lastGrapheme('🛒🇮🇹') === '🇮🇹', lastGrapheme('🛒🇮🇹'));
  ok('empty input yields nothing to set', lastGrapheme('') === '');
  ok('null is handled', lastGrapheme(null) === '' && lastGrapheme(undefined) === '');
  ok('a plain letter is allowed through', lastGrapheme('A') === 'A');
}

console.log('\n' + (fails ? fails + ' FAILED' : 'all checks passed'));
process.exit(fails ? 1 : 0);
