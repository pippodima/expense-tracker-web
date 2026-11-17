/* Emoji icons: the built-in set and the picker that also takes any emoji from the keyboard. */
'use strict';

const EMOJI = ['🛒', '🍕', '🍽️', '☕', '🚌', '🚗', '⛽', '🛍️', '👕', '💡', '🏠', '📱', '💊', '❤️',
  '🎬', '🎮', '📚', '✈️', '🏖️', '🎁', '💰', '💼', '📈', '🐾', '👶', '🎓', '🔧', '📦'];

/* ---- Icon picking ----
   An emoji is rarely one character: 👨‍👩‍👧‍👦 is four joined by ZWJ, 👍🏽 carries a skin-tone
   modifier, 🇮🇹 is two regional indicators, ❤️ has a variation selector. Slicing by
   index would shred all of them, so split on grapheme clusters. */
function graphemes(s) {
  const str = String(s == null ? '' : s);
  if (typeof Intl !== 'undefined' && Intl.Segmenter) {
    return [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(str)]
      .map((g) => g.segment);
  }
  /* Keycaps first (# is not pictographic), then flag pairs, then a pictograph with
     its optional modifier and any ZWJ continuation. Escapes, not literals: VS16
     and ZWJ are invisible in source. */
  return str.match(new RegExp(
    '[0-9#*]\\uFE0F?\\u20E3' +                                   // keycap: 1\uFE0F\u20E3
    '|\\p{RI}\\p{RI}' +                                          // flag: two regional indicators
    '|\\p{Extended_Pictographic}(\\uFE0F|\\p{Emoji_Modifier})?' +   // base + tone/presentation
    '(\\u200D\\p{Extended_Pictographic}(\\uFE0F|\\p{Emoji_Modifier})?)*' + // ZWJ sequence
    '|.', 'gsu')) || [];
}
/** The newest character typed — so tapping a second emoji replaces the first. */
function lastGrapheme(s) {
  const g = graphemes(s);
  return g.length ? g[g.length - 1] : '';
}

/** Icon field: a text input that reaches the device's own emoji keyboard, plus the
    usual suspects as one-tap shortcuts.
    There is no web API to *open* an emoji keyboard, which is why this was a fixed
    grid for so long — but a plain text input already gets there, since every iOS
    keyboard carries the emoji key. So the grid stays for speed and the input lifts
    the ceiling. Returns the node; `onChange` receives the chosen emoji. */
function emojiPicker(current, quick, onChange) {
  let value = current;
  const input = el('input', {
    class: 'emoji-input', type: 'text', value: current, 'aria-label': 'Icon',
    autocomplete: 'off', autocapitalize: 'none', autocorrect: 'off', spellcheck: 'false'
  });
  const grid = el('div', { class: 'emoji-grid' });
  const syncGrid = () => [...grid.children].forEach(
    (b) => b.classList.toggle('active', b.textContent === value));
  const setValue = (v) => {
    if (!v) return;
    value = v; input.value = v; syncGrid(); onChange(v);
  };
  input.addEventListener('input', () => {
    // Empty means mid-edit: let them clear before typing rather than fighting them
    const g = lastGrapheme(input.value);
    if (g) setValue(g);
  });
  input.addEventListener('blur', () => { if (!input.value) input.value = value; });
  quick.forEach((e) => grid.append(el('button', {
    type: 'button', class: e === value ? 'active' : '', text: e,
    onclick: () => setValue(e)
  })));
  return el('div', {}, [
    el('div', { class: 'emoji-pick' }, [
      input,
      el('div', { class: 'emoji-hint muted', text:
        'Tap the box and use your emoji keyboard — any emoji works. Or pick a common one below.' })
    ]),
    grid
  ]);
}
