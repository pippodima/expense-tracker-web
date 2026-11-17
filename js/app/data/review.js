/* The review queue: rules applied to past rows, and assigning categories in bulk. */
'use strict';

const reviewQueue = () => {
  const uc = uncategorizedCat();
  return DB.state.transactions.filter((t) => t.needsReview || (uc && t.categoryId === uc.id));
};

function ruleMatches(text, rule) {
  if (!text || !rule.keyword) return false;
  if (rule.regex) {
    try { return new RegExp(rule.keyword, 'i').test(text); } catch { return false; }
  }
  return text.toUpperCase().includes(rule.keyword.toUpperCase());
}

/** After saving a rule, offer to retroactively apply it to matching past transactions. */
async function offerApplyRuleToPast(rule) {
  const matches = DB.state.transactions.filter(
    (t) => t.categoryId !== rule.categoryId && ruleMatches(t.note || '', rule));
  if (!matches.length) return;
  const cat = DB.category(rule.categoryId);
  const ok = await confirmSheet(
    `Apply this rule to ${matches.length} past transaction${matches.length === 1 ? '' : 's'}? ` +
    `They’ll be set to ${cat ? cat.icon + ' ' + cat.name : 'this category'}.`,
    'Apply to past', false);
  if (!ok) return;
  const upd = matches.map((t) => { const o = { ...t, categoryId: rule.categoryId }; delete o.needsReview; return o; });
  await DB.bulkPut('transactions', upd);
  await bumpChanges(upd.length);
  toast(upd.length + ' transaction' + (upd.length === 1 ? '' : 's') + ' updated');
}

/** Re-run the rules over everything still in the review queue. Returns count matched. */
async function applyRulesToUncategorized() {
  const upd = [];
  for (const t of reviewQueue()) {
    const cat = DB.suggestCategory(t.note || '');
    if (cat) { const o = { ...t, categoryId: cat.id }; delete o.needsReview; upd.push(o); }
  }
  if (upd.length) { await DB.bulkPut('transactions', upd); await bumpChanges(upd.length); }
  return upd.length;
}

function openReviewSheet() {
  openSheet('Review imported', (body, api) => {
    const draw = () => {
      body.innerHTML = '';
      const q = reviewQueue().sort((a, b) => b.date.localeCompare(a.date));
      if (!q.length) {
        body.append(el('div', { class: 'empty', html: '<span class="big">✅</span>All caught up' }));
        return;
      }
      body.append(el('p', { class: 'muted', style: 'margin-bottom:10px;line-height:1.5', text:
        q.length + ' imported transaction' + (q.length === 1 ? '' : 's') +
        ' didn’t match any rule. Tap one to give it a category — and optionally teach a rule for next time.' }));
      body.append(el('button', {
        class: 'btn block small', style: 'margin-bottom:12px',
        text: 'Apply existing rules to all',
        onclick: async () => {
          const n = await applyRulesToUncategorized();
          toast(n ? n + ' categorized by rules' : 'No rules matched these yet');
          draw(); render();
        }
      }));

      // Smart suggestions: same place appearing repeatedly -> categorize the whole group
      const clusters = groupByMerchant(q).filter((g) => g.count >= 2);
      if (clusters.length) {
        body.append(el('div', { class: 'sub-title', text:
          'Categorize a whole place at once' }));
        clusters.slice(0, 6).forEach((g) => {
          body.append(el('button', { class: 'sub-suggest suggest-btn',
            onclick: () => openBulkAssignSheet(g, draw) }, [
            el('div', { class: 'sub-main' }, [
              el('div', { class: 'sub-name', text: g.label }),
              el('div', { class: 'sub-sub', text: g.count + ' transactions · ' + fmtEUR(g.total) })
            ]),
            el('span', { class: 's-chev', text: '›' })
          ]));
        });
        body.append(el('hr', { class: 'sep' }));
      }
      q.forEach((t) => {
        body.append(el('button', { class: 'tx-row', onclick: () => openAssignSheet(t, draw) }, [
          el('span', { class: 'tx-icon', text: '❓', style: 'background:' + U.tintOf('blue') }),
          el('span', { class: 'tx-main' }, [
            el('span', { class: 'tx-title', text: t.note || 'Transaction' }),
            el('span', { class: 'tx-sub', text: U.fmtDate(t.date) })
          ]),
          el('span', { class: 'tx-amt' + (t.type === 'income' ? ' pos' : ''),
            text: (t.type === 'income' ? '+ ' : '− ') + fmtEUR(t.amount) })
        ]));
      });
    };
    draw();
  });
}

/** Assign every transaction from one place at once, optionally teaching a rule. */
function openBulkAssignSheet(group, onDone) {
  openSheet(group.label, (body, api) => {
    let chosen = null;
    const chips = el('div', { class: 'chips' });
    const drawChips = () => {
      chips.innerHTML = '';
      orderedCategories().forEach((c) => {
        chips.append(el('button', {
          class: 'chip' + (chosen === c.id ? ' active' : ''),
          onclick: () => { chosen = c.id; drawChips(); }
        }, [
          el('span', { class: 'dot', style: 'background:' + U.colorOf(c.color) }),
          el('span', { text: c.icon + ' ' + c.name })
        ]));
      });
    };
    drawChips();
    const ruleToggle = el('input', { type: 'checkbox' });
    ruleToggle.checked = true;
    body.append(
      el('p', { class: 'muted', style: 'margin-bottom:12px;line-height:1.5', text:
        group.count + ' transactions from this place, ' + fmtEUR(group.total) + ' in total. ' +
        'Pick one category for all of them.' }),
      el('div', { class: 'field' }, [el('label', { text: 'Category' }), chips]),
      el('label', { style: 'display:flex;gap:8px;align-items:center;font-size:0.85rem;margin-bottom:14px' },
        [ruleToggle, el('span', { text: 'Also create a rule for “' + group.key + '”' })]),
      el('button', { class: 'btn block primary', text: 'Assign all ' + group.count,
        onclick: async () => {
          if (!chosen) return toast('Pick a category');
          const upd = group.txs.map((t) => {
            const o = { ...t, categoryId: chosen };
            delete o.needsReview;
            return o;
          });
          await DB.bulkPut('transactions', upd);
          if (ruleToggle.checked) {
            await DB.put('rules', { id: null, keyword: group.key, categoryId: chosen });
          }
          await bumpChanges(upd.length);
          api.close();
          toast(upd.length + ' categorized');
          onDone(); render();
        } })
    );
  }, { tall: true });
}

function openAssignSheet(t, onDone) {
  openSheet('Pick a category', (body, api) => {
    let chosen = null;
    const chips = el('div', { class: 'chips' });
    const drawChips = () => {
      chips.innerHTML = '';
      orderedCategories().forEach((c) => {
        chips.append(el('button', {
          class: 'chip' + (chosen === c.id ? ' active' : ''),
          onclick: () => { chosen = c.id; drawChips(); }
        }, [
          el('span', { class: 'dot', style: 'background:' + U.colorOf(c.color) }),
          el('span', { text: c.icon + ' ' + c.name })
        ]));
      });
    };
    drawChips();

    // Suggest a rule pattern from the description's most distinctive word.
    const guess = (t.note || '').split(/\s+/)
      .filter((w) => w.length >= 4 && !/^\d+$/.test(w))[0] || (t.note || '').slice(0, 12);
    const ruleToggle = el('input', { type: 'checkbox' });
    ruleToggle.checked = !!guess;
    const pattern = el('input', { type: 'text', value: guess.toUpperCase(), autocapitalize: 'characters' });
    const regexToggle = el('input', { type: 'checkbox' });

    body.append(
      el('p', { style: 'font-weight:600;margin-bottom:2px', text: t.note || 'Transaction' }),
      el('p', { class: 'muted', style: 'margin-bottom:12px', text:
        U.fmtDate(t.date) + ' · ' + (t.type === 'income' ? '+' : '−') + fmtEUR(t.amount) }),
      el('div', { class: 'field' }, [el('label', { text: 'Category' }), chips]),
      el('hr', { class: 'sep' }),
      el('label', { style: 'display:flex;gap:8px;align-items:center;font-size:0.85rem;margin-bottom:10px' },
        [ruleToggle, el('span', { text: 'Also create a rule so this is automatic next time' })]),
      el('div', { class: 'field' }, [el('label', { text: 'When the description contains…' }), pattern]),
      el('label', { style: 'display:flex;gap:8px;align-items:center;font-size:0.85rem;margin-bottom:14px' },
        [regexToggle, el('span', { text: 'Treat as regular expression' })]),
      el('button', {
        class: 'btn block primary', text: 'Assign',
        onclick: async () => {
          if (!chosen) return toast('Pick a category');
          const upd = { ...t, categoryId: chosen };
          delete upd.needsReview;
          await DB.put('transactions', upd);
          if (ruleToggle.checked && pattern.value.trim()) {
            await DB.put('rules', {
              id: null, keyword: pattern.value.trim(),
              regex: regexToggle.checked || undefined, categoryId: chosen
            });
            // Let the new rule sweep the rest of the queue too.
            let swept = 0;
            for (const other of reviewQueue()) {
              const cat = DB.suggestCategory(other.note || '');
              if (cat) {
                const o = { ...other, categoryId: cat.id };
                delete o.needsReview;
                await DB.put('transactions', o);
                swept++;
              }
            }
            if (swept) toast('Rule applied to ' + (swept + 1) + ' transactions');
          }
          await bumpChanges(1);
          api.close();
          onDone();
        }
      })
    );
  });
}
