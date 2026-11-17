/* Rearrangeable blocks: the catalogue, saved order/visibility, rendering and the arrange sheet. */
'use strict';

/* ======================= Rearrangeable blocks =======================
   Every stacked card in a view is a "block" with a stable key. The order and
   which ones are hidden live in meta, so they survive a reinstall and ride
   along inside backups. A block that doesn't apply right now (no trip, no
   budget) simply builds to null and is skipped without losing its place. */

/* The catalogue lives here rather than inside each render function, so the
   arrange sheet can be opened from a header button before the blocks that it
   lists have been built. */
const BLOCKS = {
  dashboard: [
    { key: 'trip', title: 'Active trip' },
    { key: 'budget', title: 'Budget' },
    { key: 'top', title: 'Top spending' }
  ],
  'stats-overview': [
    { key: 'tiles', title: 'Income / expenses / net' },
    { key: 'compare', title: 'Comparison with last period' },
    { key: 'inout', title: 'Income vs expenses' },
    { key: 'net', title: 'Net over time' },
    { key: 'categories', title: 'Spending by category' }
  ],
  'stats-trends': [
    { key: 'mix', title: 'Categories over time' },
    { key: 'movers', title: 'What changed' },
    { key: 'pace', title: 'Pace this month' },
    { key: 'fixed', title: 'Fixed vs one-off' },
    { key: 'savings', title: 'Savings rate' },
    { key: 'weekday', title: 'Weekday rhythm' }
  ]
};

const blockPrefs = (viewKey) =>
  Object.assign({ order: [], hidden: {} }, (DB.state.meta.blocks || {})[viewKey] || {});

async function setBlockPrefs(viewKey, patch) {
  const all = Object.assign({}, DB.state.meta.blocks || {});
  all[viewKey] = Object.assign(blockPrefs(viewKey), patch);
  await DB.setMeta('blocks', all);
}

/** Saved order, with keys that no longer exist dropped and brand-new blocks
    slotted in at their default position rather than dumped at the bottom. */
function blockSequence(viewKey) {
  const defs = BLOCKS[viewKey] || [];
  const { order, hidden } = blockPrefs(viewKey);
  const known = new Set(defs.map((d) => d.key));
  const seq = order.filter((k, i) => known.has(k) && order.indexOf(k) === i);
  defs.forEach((d, i) => {
    if (!seq.includes(d.key)) seq.splice(Math.min(i, seq.length), 0, d.key);
  });
  return { seq, hidden };
}

/** builders: { blockKey: () => node|null }. A builder returning null means the
    block doesn't apply right now; its place in the order is remembered anyway. */
function renderBlocks(root, viewKey, builders) {
  const { seq, hidden } = blockSequence(viewKey);
  seq.forEach((k) => {
    if (hidden[k]) return;
    const fn = builders[k];
    const node = fn && fn();
    if (node) root.append(node);
  });
}

function arrangeButton(viewKey) {
  return el('button', {
    class: 'icon-btn', 'aria-label': 'Arrange blocks',
    onclick: () => openArrangeSheet(viewKey),
    html: '<svg viewBox="0 0 24 24"><path d="M10 7h10M10 12h10M10 17h10"/>' +
      '<path d="M4 9l2-2.5L8 9M4 15l2 2.5L8 15"/></svg>'
  });
}

function openArrangeSheet(viewKey) {
  const defs = BLOCKS[viewKey] || [];
  openSheet('Arrange', (body) => {
    const { seq, hidden } = blockSequence(viewKey);
    const order = seq.slice();
    const hid = Object.assign({}, hidden);
    const byKey = new Map(defs.map((d) => [d.key, d]));
    const list = el('div', { class: 'arrange-list' });
    body.append(
      el('p', { class: 'muted', style: 'line-height:1.5;margin-bottom:14px', text:
        'Drag by the handle, or use the arrows. Hiding a block only removes it from ' +
        'this screen — nothing is deleted, and you can bring it back here any time.' }),
      list
    );

    const save = async () => {
      await setBlockPrefs(viewKey, { order: order.slice(), hidden: Object.assign({}, hid) });
      render();
    };

    const draw = () => {
      list.innerHTML = '';
      order.forEach((k, i) => {
        const def = byKey.get(k);
        if (!def) return;
        const off = !!hid[k];
        const move = async (delta) => {
          const j = i + delta;
          if (j < 0 || j >= order.length) return;
          order.splice(j, 0, order.splice(i, 1)[0]);
          draw(); await save();
        };
        list.append(el('div', { class: 'ar-row' + (off ? ' off' : ''), 'data-key': k }, [
          el('span', { class: 'ar-handle', 'aria-hidden': 'true', text: '⋮⋮' }),
          el('span', { class: 'ar-name', text: def.title }),
          el('button', { class: 'ar-btn', 'aria-label': 'Move up', text: '↑',
            onclick: () => move(-1) }),
          el('button', { class: 'ar-btn', 'aria-label': 'Move down', text: '↓',
            onclick: () => move(1) }),
          el('button', {
            class: 'ar-eye' + (off ? '' : ' on'), 'aria-label': off ? 'Show' : 'Hide',
            text: off ? '◌' : '◉',
            onclick: async () => { if (off) delete hid[k]; else hid[k] = true; draw(); await save(); }
          })
        ]));
      });
      makeSortable(list, order, async () => { draw(); await save(); });
    };
    draw();

    body.append(
      el('div', { class: 'spacer' }),
      el('button', { class: 'btn block ghost', text: 'Reset to default order',
        onclick: async () => {
          order.length = 0;
          defs.forEach((d) => order.push(d.key));
          Object.keys(hid).forEach((k) => delete hid[k]);
          draw(); await save();
        } })
    );
  });
}

/** Drag-to-reorder for equal-height rows. Nothing is rebuilt mid-drag — the
    other rows just slide out of the way — so the pointer never loses its
    target, which is what makes this survive a finger on a small screen. */
function makeSortable(list, order, onDone) {
  const rows = Array.from(list.children);
  if (rows.length < 2) return;
  rows.forEach((row, from) => {
    const handle = row.querySelector('.ar-handle');
    if (!handle) return;
    handle.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      const first = rows[0].getBoundingClientRect();
      const second = rows[1].getBoundingClientRect();
      const step = Math.max(1, second.top - first.top);
      const startY = e.clientY;
      let to = from;
      row.classList.add('ar-dragging');
      try { handle.setPointerCapture(e.pointerId); } catch { /* not fatal */ }

      const move = (ev) => {
        const dy = ev.clientY - startY;
        row.style.transform = 'translateY(' + dy + 'px)';
        const idx = Math.max(0, Math.min(rows.length - 1, from + Math.round(dy / step)));
        if (idx === to) return;
        to = idx;
        rows.forEach((r, i) => {
          if (i === from) return;
          const shift = (from < to && i > from && i <= to) ? -step
            : (from > to && i >= to && i < from) ? step : 0;
          r.style.transform = shift ? 'translateY(' + shift + 'px)' : '';
        });
      };
      const up = () => {
        handle.removeEventListener('pointermove', move);
        handle.removeEventListener('pointerup', up);
        handle.removeEventListener('pointercancel', up);
        rows.forEach((r) => { r.style.transform = ''; });
        row.classList.remove('ar-dragging');
        if (to !== from) {
          order.splice(to, 0, order.splice(from, 1)[0]);
          onDone();
        }
      };
      handle.addEventListener('pointermove', move);
      handle.addEventListener('pointerup', up);
      handle.addEventListener('pointercancel', up);
    });
  });
}
