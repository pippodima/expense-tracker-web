/* Merchant ("place") grouping: a stable brand key from noisy bank descriptions. */
'use strict';

/* ---- Merchant ("place") grouping ------------------------------------------
   Bank descriptions vary per store/branch — ESSELUNGA CANOVA vs ESSELUNGA
   NOVOLI, UNICOOP-FIRENZE vs UNICOOP SCANDICCI — so we derive a brand key:
   drop the payment-processor prefix, keep the leading distinctive word(s). */
const PROCESSOR_PREFIXES = ['PAYPAL', 'SUMUP', 'PPG', 'NYX', 'SQ', 'ZETTLE', 'IZ', 'SP',
  'STRIPE', 'WISE', 'SATISPAY'];
// Words too generic to identify a place on their own — keep the next word too.
const GENERIC_WORDS = new Set(['BAR', 'CAFFE', 'CAFE', 'MENSA', 'PIZZERIA', 'RISTORANTE',
  'OSTERIA', 'TRATTORIA', 'GELATERIA', 'PASTICCERIA', 'PANETTERIA', 'MACELLERIA',
  'FARMACIA', 'PHARMACIE', 'SUPERMERCATO', 'TABACCHERIA', 'LAVANDERIA', 'HOTEL', 'PUB',
  'MERCATO', 'NUOVA', 'GRUPPO', 'AZIENDA', 'COMUNE', 'CIR', 'LA', 'IL', 'LE', 'LES',
  'DI', 'DE', 'GRANDE', 'CASA', 'PIU']);

function merchantKey(note) {
  let s = String(note || '').toUpperCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  // "PAYPAL *MICROSOFT" / "SumUp *La Scatola A" -> drop the processor
  const star = s.match(/^([A-Z0-9]{2,10})\s*\*\s*(.+)$/);
  if (star && PROCESSOR_PREFIXES.includes(star[1])) s = star[2];
  const tokens = s.replace(/[^A-Z0-9]+/g, ' ').trim().split(' ')
    .filter((w) => w.length > 2 && !/^\d+$/.test(w));
  if (!tokens.length) return String(note || '').trim().toUpperCase() || '—';
  // A generic first word (BAR, MENSA, PIZZERIA…) needs the next word to identify
  // the place; anything else is a brand that stands on its own, so "ZARA MILANO
  // 4471" and "ZARA" group together.
  return GENERIC_WORDS.has(tokens[0]) ? tokens.slice(0, 2).join(' ') : tokens[0];
}

/** Group transactions by place: [{ key, label, total, count, txs }] desc by total. */
function groupByMerchant(txs) {
  const groups = new Map();
  for (const t of txs) {
    const key = merchantKey(t.note);
    if (!groups.has(key)) groups.set(key, { key, total: 0, count: 0, txs: [], labels: new Map() });
    const g = groups.get(key);
    g.total += t.type === 'income' ? -t.amount : t.amount;
    g.count++;
    g.txs.push(t);
    const nm = (t.note || '').trim() || key;
    g.labels.set(nm, (g.labels.get(nm) || 0) + 1);
  }
  return [...groups.values()].map((g) => {
    // Label the group with its most frequent original description.
    const label = [...g.labels.entries()].sort((a, b) => b[1] - a[1] || a[0].length - b[0].length)[0][0];
    g.txs.sort((a, b) => b.date.localeCompare(a.date));
    return { key: g.key, label, total: g.total, count: g.count, txs: g.txs };
  }).sort((a, b) => b.total - a.total);
}
