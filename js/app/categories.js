/* Categories and rules: lookup helpers, the category picker, and the category / rule edit sheets. */
'use strict';

const uncategorizedCat = () =>
  DB.state.categories.find((c) => c.name.toLowerCase() === 'uncategorized') || null;

/** Category order for pickers: the last few you chose, then the most used.
    Keeps today's context at your fingertips without reshuffling constantly. */
function orderedCategories() {
  const recent = DB.state.meta.recentCategories || [];
  const counts = new Map();
  DB.state.transactions.forEach((t) => {
    if (t.categoryId) counts.set(t.categoryId, (counts.get(t.categoryId) || 0) + 1);
  });
  const rest = DB.state.categories
    .filter((c) => !recent.includes(c.id))
    .sort((a, b) => (counts.get(b.id) || 0) - (counts.get(a.id) || 0));
  const head = recent.map((id) => DB.state.categories.find((c) => c.id === id)).filter(Boolean);
  return [...head, ...rest];
}

/** The full catalogue, searchable — for whoever outgrew the chips.
    Matching runs through catKey, so accents and case don't matter. */
function openCategoryPickSheet(currentId, onPick) {
  openSheet('Pick a category', (body, api) => {
    const input = el('input', { class: 'searchbox', type: 'search',
      placeholder: 'Search categories…', autocomplete: 'off' });
    const grid = el('div', { class: 'cat-grid' });
    const none = el('p', { class: 'muted', text: 'No category matches' });
    const draw = () => {
      grid.innerHTML = '';
      const q = catKey(input.value);
      orderedCategories()
        .filter((c) => !q || catKey(c.name).includes(q))
        .forEach((c) => grid.append(el('button', {
          class: 'cat-cell' + (c.id === currentId ? ' selected' : ''),
          onclick: () => { api.close(); onPick(c); }
        }, [
          el('span', { class: 'cat-cell-icon', text: c.icon,
            style: 'background:' + U.tintOf(c.color) }),
          el('span', { class: 'cat-cell-main' }, [
            el('span', { class: 'cat-cell-name', text: c.name })
          ])
        ])));
      none.hidden = grid.children.length > 0;
    };
    input.addEventListener('input', draw);
    body.append(el('div', { class: 'field' }, [input]), grid, none);
    draw();
  }, { tall: true });
}

async function rememberCategoryPick(catId) {
  const prev = (DB.state.meta.recentCategories || []).filter((id) => id !== catId);
  await DB.setMeta('recentCategories', [catId, ...prev].slice(0, 4));
}

async function ensureCategory(name, icon, color) {
  let cat = DB.state.categories.find((c) => c.name.toLowerCase() === name.toLowerCase());
  if (!cat) {
    cat = { id: null, name, icon, color: color || 'blue' };
    await DB.put('categories', cat);
  }
  return cat;
}

function openCategorySheet(existing) {
  const draft = existing ? { ...existing } :
    { id: null, name: '', icon: '🛒', color: 'blue' };
  openSheet(existing ? 'Edit category' : 'New category', (body, api) => {
    const name = el('input', { type: 'text', placeholder: 'e.g. Groceries', value: draft.name });

    const emojiGrid = emojiPicker(draft.icon, EMOJI, (e) => { draft.icon = e; });

    const swatches = el('div', { class: 'swatches' });
    const drawSwatches = () => {
      swatches.innerHTML = '';
      U.PALETTE_ORDER.forEach((key) => swatches.append(el('button', {
        class: 'swatch' + (draft.color === key ? ' active' : ''),
        style: 'background:' + U.colorOf(key), 'aria-label': key,
        onclick: () => { draft.color = key; drawSwatches(); }
      })));
    };
    drawSwatches();

    body.append(
      el('div', { class: 'field' }, [el('label', { text: 'Name' }), name]),
      el('div', { class: 'field' }, [el('label', { text: 'Icon' }), emojiGrid]),
      el('div', { class: 'field' }, [el('label', { text: 'Color' }), swatches]),
      el('button', {
        class: 'btn block primary', text: existing ? 'Save changes' : 'Add category',
        onclick: async () => {
          if (!name.value.trim()) return toast('Enter a name');
          draft.name = name.value.trim();
          await DB.put('categories', draft);
          api.close(); render();
        }
      })
    );
    if (existing) {
      const used = DB.state.transactions.filter((t) => t.categoryId === existing.id);
      body.append(
        el('div', { class: 'spacer' }),
        el('button', {
          class: 'btn block danger', text: 'Delete category',
          onclick: async () => {
            if (DB.state.categories.length <= 1) return toast('Keep at least one category');
            const fallback = DB.state.categories.find((c) =>
              c.id !== existing.id && c.name === 'Other') ||
              DB.state.categories.find((c) => c.id !== existing.id);
            const msg = used.length > 0
              ? `Delete "${existing.name}"? Its ${used.length} transactions will move to "${fallback.name}".`
              : `Delete "${existing.name}"?`;
            if (!(await confirmSheet(msg, 'Delete', true))) return;
            if (used.length) {
              await DB.bulkPut('transactions',
                used.map((t) => ({ ...t, categoryId: fallback.id })));
            }
            await DB.bulkDel('rules',
              DB.state.rules.filter((rl) => rl.categoryId === existing.id).map((rl) => rl.id));
            await DB.del('categories', existing.id);
            api.close(); render();
          }
        })
      );
    }
  });
}

function openRuleSheet(existing) {
  const draft = existing ? { ...existing } :
    { id: null, keyword: '', categoryId: DB.state.categories[0] ? DB.state.categories[0].id : '' };
  openSheet(existing ? 'Edit rule' : 'New rule', (body, api) => {
    const kw = el('input', {
      type: 'text', placeholder: 'e.g. ESSELUNGA', value: draft.keyword,
      autocapitalize: 'characters'
    });
    const rx = el('input', { type: 'checkbox' });
    rx.checked = !!draft.regex;
    const cat = el('select', {}, DB.state.categories.map((c) =>
      el('option', { value: c.id, text: c.icon + ' ' + c.name })));
    if (draft.categoryId) cat.value = draft.categoryId;
    body.append(
      el('div', { class: 'field' }, [el('label', { text: 'If the note contains…' }), kw]),
      el('label', { style: 'display:flex;gap:8px;align-items:center;font-size:0.85rem;margin-bottom:14px' },
        [rx, el('span', { text: 'Treat as regular expression (e.g. ^POS.*MILANO)' })]),
      el('div', { class: 'field' }, [el('label', { text: 'Suggest category' }), cat]),
      el('button', {
        class: 'btn block primary', text: existing ? 'Save changes' : 'Add rule',
        onclick: async () => {
          if (!kw.value.trim()) return toast('Enter a keyword');
          if (rx.checked) {
            try { new RegExp(kw.value.trim()); } catch { return toast('Invalid regular expression'); }
          }
          draft.keyword = kw.value.trim();
          draft.regex = rx.checked || undefined;
          draft.categoryId = cat.value;
          await DB.put('rules', draft);
          api.close();
          await offerApplyRuleToPast(draft);
          render();
        }
      })
    );
    if (existing) {
      body.append(
        el('div', { class: 'spacer' }),
        el('button', {
          class: 'btn block danger', text: 'Delete rule',
          onclick: async () => {
            await DB.del('rules', existing.id);
            api.close(); render();
          }
        })
      );
    }
  });
}
