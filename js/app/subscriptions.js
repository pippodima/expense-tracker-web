/* Subscription radar: detecting repeating charges, the card and the confirm sheet. */
'use strict';

/* ---- Subscription radar: suggest, never assume ----
   A candidate needs >= 3 charges from the same place, spaced ~monthly
   (median gap 25-35 days) with a stable amount. Nothing counts as a
   subscription until confirmed; dismissed merchants never come back. */

const subsMeta = () =>
  Object.assign({ confirmed: {}, dismissed: [] }, DB.state.meta.subscriptions || {});

function median(nums) {
  const a = [...nums].sort((x, y) => x - y);
  if (!a.length) return 0;
  const mid = a.length >> 1;
  return a.length % 2 ? a[mid] : (a[mid - 1] + a[mid]) / 2;
}

function detectSubscriptions() {
  const expenses = DB.state.transactions.filter((t) => t.type === 'expense');
  const out = [];
  for (const g of groupByMerchant(expenses)) {
    // 3+ charges is the confident case; exactly 2 counts only when the amount
    // is identical to the cent (a strong subscription signal on short history).
    const amountsAll = g.txs.map((t) => t.amount);
    const identical = amountsAll.every((a) => Math.abs(a - amountsAll[0]) < 0.005);
    if (g.count < 2 || (g.count === 2 && !identical)) continue;
    const dates = g.txs.map((t) => t.date).sort();
    const gaps = [];
    for (let i = 1; i < dates.length; i++) {
      gaps.push((new Date(dates[i]) - new Date(dates[i - 1])) / 86400000);
    }
    const gap = median(gaps);
    if (gap < 25 || gap > 35) continue;                    // monthly cadence only
    const amounts = g.txs.map((t) => t.amount);
    const amt = median(amounts);
    // Amounts must be stable (ignoring a possible price change at the end)
    const spread = Math.max(...amounts) - Math.min(...amounts);
    if (amt > 0 && spread / amt > 0.35) continue;
    const sorted = [...g.txs].sort((a, b) => a.date.localeCompare(b.date));
    const lastTx = sorted[sorted.length - 1];
    const prevAmts = sorted.slice(0, -1).map((t) => t.amount);
    const prevAmt = median(prevAmts);
    const nextDue = new Date(new Date(lastTx.date).getTime() + gap * 86400000);
    out.push({
      key: g.key, label: g.label, amount: lastTx.amount, typical: amt,
      count: g.count, gap: Math.round(gap), lastDate: lastTx.date,
      nextDue: isoOf(nextDue), dates,
      priceChanged: prevAmts.length >= 2 && Math.abs(lastTx.amount - prevAmt) > 0.01
        ? { from: prevAmt, to: lastTx.amount } : null,
      missing: (Date.now() - new Date(lastTx.date)) / 86400000 > gap + 10
    });
  }
  return out.sort((a, b) => b.amount - a.amount);
}

function subscriptionCard() {
  const meta = subsMeta();
  const found = detectSubscriptions();
  const confirmed = found.filter((s) => meta.confirmed[s.key]);
  const suggestions = found.filter((s) => !meta.confirmed[s.key] && !meta.dismissed.includes(s.key));
  const monthly = confirmed.reduce((s, x) => s + x.amount, 0);

  const card = el('div', { class: 'card' }, [
    el('div', { class: 'card-head' }, [
      el('h2', { text: 'Recurring' }),
      confirmed.length ? el('span', { class: 'muted', text: fmtEUR(monthly) + ' / month' }) : null
    ])
  ]);

  if (!confirmed.length && !suggestions.length) {
    card.append(el('div', { class: 'empty', html:
      '<span class="big">🔁</span>No monthly patterns spotted yet' }));
    return card;
  }

  confirmed.forEach((s) => {
    const alerts = [];
    if (s.priceChanged) {
      alerts.push((s.priceChanged.to > s.priceChanged.from ? '▲ up from ' : '▼ down from ') +
        fmtEUR(s.priceChanged.from));
    }
    if (s.missing) alerts.push('not charged since ' + U.fmtDate(s.lastDate));
    card.append(el('button', { class: 'sub-row', onclick: () => openSubscriptionSheet(s) }, [
      el('div', { class: 'sub-main' }, [
        el('div', { class: 'sub-name', text: s.label }),
        el('div', { class: 'sub-sub' + (alerts.length ? ' warn' : ''), text: alerts.length
          ? alerts.join(' · ')
          : 'next ~' + U.fmtDate(s.nextDue, { day: 'numeric', month: 'short' }) })
      ]),
      el('div', { class: 'sub-amt', text: fmtEUR(s.amount) }),
      el('span', { class: 's-chev', text: '›' })
    ]));
  });

  if (suggestions.length) {
    card.append(el('div', { class: 'sub-title', style: 'margin-top:14px',
      text: 'Looks recurring — confirm?' }));
    suggestions.forEach((s) => {
      card.append(el('div', { class: 'sub-suggest' }, [
        el('div', { class: 'sub-main' }, [
          el('div', { class: 'sub-name', text: s.label }),
          el('div', { class: 'sub-sub', text: fmtEUR(s.amount) + ' · every ~' + s.gap +
            ' days · ' + s.count + ' charges' })
        ]),
        el('button', { class: 'btn small', text: 'Not this', onclick: async () => {
          const m = subsMeta();
          m.dismissed = [...new Set([...m.dismissed, s.key])];
          await DB.setMeta('subscriptions', m);
          renderStats();
        } }),
        el('button', { class: 'btn small primary', text: 'Yes', onclick: async () => {
          const m = subsMeta();
          m.confirmed = Object.assign({}, m.confirmed, { [s.key]: { label: s.label } });
          await DB.setMeta('subscriptions', m);
          renderStats();
        } })
      ]));
    });
  }
  return card;
}

function openSubscriptionSheet(s) {
  openSheet(s.label, (body, api) => {
    body.append(el('div', { class: 'cat-detail-head' }, [
      el('div', { class: 'cat-detail-total', text: fmtEUR(s.amount) }),
      el('div', { class: 'muted', text: 'every ~' + s.gap + ' days · ' + s.count + ' charges' })
    ]));
    if (s.priceChanged) {
      body.append(el('div', { class: 'banner' }, [
        el('span', { text: '⚠️', style: 'font-size:1.3rem' }),
        el('div', { class: 'b-main', html: '<strong>Price changed</strong>' +
          'From ' + esc(fmtEUR(s.priceChanged.from)) + ' to ' + esc(fmtEUR(s.priceChanged.to)) + '.' })
      ]));
    }
    if (s.missing) {
      body.append(el('div', { class: 'banner' }, [
        el('span', { text: '🛑', style: 'font-size:1.3rem' }),
        el('div', { class: 'b-main', html: '<strong>Possibly cancelled</strong>' +
          'Expected around ' + esc(U.fmtDate(s.nextDue)) + ' but nothing charged yet.' })
      ]));
    }
    const txs = DB.state.transactions
      .filter((t) => t.type === 'expense' && merchantKey(t.note) === s.key)
      .sort((a, b) => b.date.localeCompare(a.date));
    txs.forEach((t) => {
      body.append(el('button', { class: 'cat-tx', onclick: () => openTxSheet(t) }, [
        el('div', { class: 'cat-tx-main' }, [
          el('div', { class: 'cat-tx-note', text: t.note }),
          el('div', { class: 'cat-tx-sub', text: U.fmtDate(t.date) })
        ]),
        el('div', { class: 'cat-tx-amt', text: '− ' + fmtEUR(t.amount) })
      ]));
    });
    body.append(el('div', { class: 'spacer' }),
      el('button', { class: 'btn block ghost', text: 'Not a subscription', onclick: async () => {
        const m = subsMeta();
        delete m.confirmed[s.key];
        m.dismissed = [...new Set([...m.dismissed, s.key])];
        await DB.setMeta('subscriptions', m);
        api.close(); renderStats();
      } }));
  }, { tall: true });
}
