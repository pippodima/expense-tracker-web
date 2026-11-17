/* Global search across notes, places, categories, accounts and amounts. */
'use strict';

/* ---- Global search: everything, from anywhere ---- */
function openGlobalSearch() {
  openSheet('Search', (body) => {
    const input = el('input', { class: 'searchbox', type: 'search', autocomplete: 'off',
      placeholder: 'Note, place, category, account or amount…' });
    const results = el('div');
    body.append(input, results);

    const draw = () => {
      const q = input.value.trim().toLowerCase();
      results.innerHTML = '';
      if (q.length < 2) {
        results.append(el('div', { class: 'empty', muted: '', html:
          '<span class="big">⌕</span>Type at least two characters' }));
        return;
      }
      // An amount query like "2,80" or "45" matches the value too
      const qNum = CSV.parseAmount(q);
      const matches = DB.state.transactions.filter((t) => {
        const cat = DB.category(t.categoryId);
        const acct = DB.account(t.accountId);
        const hay = ((t.note || '') + ' ' + (cat ? cat.name : '') + ' ' +
          (acct ? acct.name : '') + ' ' + merchantKey(t.note)).toLowerCase();
        if (hay.includes(q)) return true;
        return qNum != null && Math.abs(t.amount - Math.abs(qNum)) < 0.005;
      }).sort((a, b) => b.date.localeCompare(a.date));

      // Matching categories and places jump straight to their own views
      const cats = DB.state.categories.filter((c) => c.name.toLowerCase().includes(q));
      const places = groupByMerchant(matches.filter((t) => t.type === 'expense'))
        .filter((g) => g.label.toLowerCase().includes(q) || g.key.toLowerCase().includes(q))
        .slice(0, 3);

      if (!matches.length && !cats.length) {
        results.append(el('div', { class: 'empty', html:
          '<span class="big">⌕</span>Nothing found for “' + esc(q) + '”' }));
        return;
      }

      if (cats.length) {
        results.append(el('div', { class: 'sub-title', text: 'Categories' }));
        cats.forEach((c) => results.append(el('button', { class: 'pick-row',
          onclick: () => openCategoryDetail(c) }, [
          el('span', { class: 'cat-cell-icon', text: c.icon,
            style: 'background:' + U.tintOf(c.color) }),
          el('span', { class: 's-main', text: c.name }),
          el('span', { class: 's-chev', text: '›' })
        ])));
      }
      if (places.length) {
        results.append(el('div', { class: 'sub-title', style: 'margin-top:12px', text: 'Places' }));
        places.forEach((g) => results.append(el('button', { class: 'pick-row',
          onclick: () => openMerchantDetail(g, { label: 'Matches' }) }, [
          el('span', { class: 's-main' }, [
            el('div', { text: g.label }),
            el('div', { class: 's-sub', text: g.count + '× · ' + fmtEUR(g.total) })
          ]),
          el('span', { class: 's-chev', text: '›' })
        ])));
      }

      results.append(el('div', { class: 'sub-title', style: 'margin-top:12px',
        text: matches.length + ' transaction' + (matches.length === 1 ? '' : 's') }));
      const total = matches.filter((t) => t.type === 'expense').reduce((s, t) => s + t.amount, 0);
      if (total > 0) {
        results.append(el('p', { class: 'muted', style: 'margin-bottom:8px',
          text: fmtEUR(total) + ' spent in total' }));
      }
      matches.slice(0, 60).forEach((t) => {
        const c = DB.category(t.categoryId);
        results.append(el('button', { class: 'cat-tx', onclick: () => openTxSheet(t) }, [
          el('div', { class: 'cat-tx-main' }, [
            el('div', { class: 'cat-tx-note', text: t.note || 'Transaction' }),
            el('div', { class: 'cat-tx-sub', text: U.fmtDate(t.date) +
              (c ? ' · ' + c.name : '') })
          ]),
          el('div', { class: 'cat-tx-amt' + (t.type === 'income' ? ' pos' : ''),
            text: (t.type === 'income' ? '+ ' : t.type === 'transfer' ? '⇄ ' : '− ') +
              fmtEUR(t.amount) })
        ]));
      });
      if (matches.length > 60) {
        results.append(el('p', { class: 'muted', style: 'padding:10px 0',
          text: 'and ' + (matches.length - 60) + ' more…' }));
      }
    };

    let deb;
    input.addEventListener('input', () => {
      clearTimeout(deb); deb = setTimeout(draw, 130);
    });
    draw();
    setTimeout(() => input.focus(), 320);
  }, { tall: true });
}
