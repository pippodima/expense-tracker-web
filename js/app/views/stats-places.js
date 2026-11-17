/* Stats → Places: spending by merchant and the merchant detail sheet. */
'use strict';

/* ---------------- Merchants + subscription radar ---------------- */

function statsMerchants(root, rg, txs) {
  root.append(subscriptionCard());

  const expenses = txs.filter((t) => t.type === 'expense');
  const groups = groupByMerchant(expenses);
  const card = el('div', { class: 'card' }, [
    el('div', { class: 'card-head' }, [
      el('h2', { text: 'Top places' }),
      el('span', { class: 'muted', text: groups.length + ' total' })
    ])
  ]);
  const search = el('input', { class: 'searchbox', type: 'search',
    placeholder: 'Search a place…', value: ui.stats.merchantQuery });
  const listWrap = el('div');
  const draw = () => {
    const q = ui.stats.merchantQuery.trim().toLowerCase();
    const shown = groups.filter((g) => !q || g.label.toLowerCase().includes(q) ||
      g.key.toLowerCase().includes(q));
    listWrap.innerHTML = '';
    if (!shown.length) {
      listWrap.append(el('div', { class: 'empty', html: '<span class="big">🔍</span>No places match' }));
      return;
    }
    const maxV = shown[0].total;
    shown.slice(0, 40).forEach((g) => {
      listWrap.append(el('button', { class: 'catbar', onclick: () => openMerchantDetail(g, rg) }, [
        el('div', { class: 'catbar-main' }, [
          el('div', { class: 'catbar-top' }, [
            el('span', { class: 'catbar-name', text: g.label }),
            el('span', { class: 'catbar-val', text: fmtEUR(g.total) })
          ]),
          el('div', { class: 'catbar-track' }, [
            el('div', { class: 'catbar-fill', style: 'width:' +
              (maxV > 0 ? (g.total / maxV) * 100 : 0) + '%;background:' + U.colorOf('blue') })
          ])
        ]),
        el('span', { class: 'catbar-pct', text: g.count + '×' }),
        el('span', { class: 'catbar-chev', text: '›' })
      ]));
    });
  };
  let deb;
  search.addEventListener('input', () => {
    clearTimeout(deb);
    deb = setTimeout(() => { ui.stats.merchantQuery = search.value; draw(); }, 120);
  });
  draw();
  card.append(search, listWrap);
  root.append(card);
}

function openMerchantDetail(g, rg) {
  const avg = g.count ? g.total / g.count : 0;
  const biggest = g.txs.reduce((mx, t) => (!mx || t.amount > mx.amount ? t : mx), null);
  // Lifetime figures, not just the selected period
  const lifetime = groupByMerchant(
    DB.state.transactions.filter((t) => t.type === 'expense' && merchantKey(t.note) === g.key));
  const life = lifetime[0] || { total: 0, count: 0 };
  openSheet(g.label, (body) => {
    body.append(el('div', { class: 'cat-detail-head' }, [
      el('div', { class: 'cat-detail-total', text: fmtEUR(g.total) }),
      el('div', { class: 'muted', text: (rg.label || 'Period') + ' · ' + g.count +
        (g.count === 1 ? ' visit' : ' visits') })
    ]));
    body.append(el('div', { class: 'cat-detail-stats' }, [
      el('div', { class: 'tile' }, [
        el('div', { class: 't-label', text: 'Average' }),
        el('div', { class: 't-value', style: 'font-size:1.1rem', text: fmtEUR(avg) })
      ]),
      biggest ? el('button', { class: 'tile tile-btn', onclick: () => openTxSheet(biggest) }, [
        el('div', { class: 't-label', text: 'Biggest ›' }),
        el('div', { class: 't-value', style: 'font-size:1.1rem', text: fmtEUR(biggest.amount) })
      ]) : null
    ]));
    body.append(el('p', { class: 'muted', style: 'margin:10px 0', text:
      'All time: ' + fmtEUR(life.total) + ' across ' + life.count +
      (life.count === 1 ? ' visit' : ' visits') }));
    g.txs.forEach((t) => {
      body.append(el('button', { class: 'cat-tx', onclick: () => openTxSheet(t) }, [
        el('div', { class: 'cat-tx-main' }, [
          el('div', { class: 'cat-tx-note', text: t.note || g.label }),
          el('div', { class: 'cat-tx-sub', text: U.fmtDate(t.date) })
        ]),
        el('div', { class: 'cat-tx-amt', text: '− ' + fmtEUR(t.amount) })
      ]));
    });
  }, { tall: true });
}
