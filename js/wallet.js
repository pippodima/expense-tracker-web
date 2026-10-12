/* Wallet notification log → transactions.

   An iOS automation appends every Apple Wallet payment notification to a text file,
   one block per payment:

     Titolo: buddy                                  ← the card, i.e. which account
     Sottotitolo: The Book Pub. Firenze, Toscana    ← merchant, then "City, Region"
     Corpo: 5,00 €                                  ← the amount
     Data: 3 ott 2026, 01:30                        ← when

   The file only ever grows, so parsing must be repeatable: every block gets a stable
   externalId (date, time, amount, card, merchant, plus an occurrence count for
   genuine same-minute repeats) and re-importing the whole file is a no-op for the
   rows already in the app. English labels are accepted too, in case the phone's
   language changes.

   The same automation also logs the buddybank app, because some payments (online,
   PayPal) never reach Wallet. One payment can show up several times there:

     Autorizza pagamento e-commerce di 49,00EUR c/o …           ← 3-D Secure request,
                                                                  often twice; may be declined
     buddy UniCredit conferma op.Internet 49,00 EUR carta *0000 c/o PAYPAL *x 11/10/26 22:43
                                                                ← the confirmation

   Only the confirmation is a payment; its own timestamp is when the card was charged,
   which beats a Wallet notification that arrived late (offline payment). When both a
   Wallet notification and a bank confirmation exist for one payment, they become one
   row that carries both ids, so it's found again whichever of the two came first. */
'use strict';

const Wallet = (() => {
  const KEYS = {
    titolo: 'card', title: 'card',
    sottotitolo: 'sub', subtitle: 'sub',
    corpo: 'body', body: 'body',
    data: 'date', date: 'date'
  };
  // First three letters of Italian and English month names.
  const MONTHS = {
    gen: 1, jan: 1, feb: 2, mar: 3, apr: 4, mag: 5, may: 5, giu: 6, jun: 6,
    lug: 7, jul: 7, ago: 8, aug: 8, set: 9, sep: 9, ott: 10, oct: 10, nov: 11, dic: 12, dec: 12
  };
  const LINE_RE = /^\s*([A-Za-z]+)\s*:\s?(.*)$/;
  const DATE_RE = /(\d{1,2})\s+([A-Za-zàé]+)\.?\s+(\d{4})(?:\s*,?\s*(\d{1,2})[:.](\d{2}))?/;

  /* A payment's body is an amount and nothing else: "5,00 €", "+12,50 €", "$8.99",
     "Rimborso: 8,00 €". Wallet also notifies about loyalty stamps, passes, cards added —
     "2/10 stamps earned" has a number in it, so finding *a* number isn't enough.
     The number shapes are the ones parseAmount reads right: Italian thousands
     ("1.234,56"), a comma decimal, or a dot followed by exactly two digits. No `i` flag:
     [A-Z]{3} is a currency code, not any three-letter word. */
  const REFUND_WORD = /^(?:rimborso|refund|accredito)\s*:?\s*/i;
  const CUR = '(?:[A-Z]{1,3}\\s?)?[€$£¥₹]|[A-Z]{3}';
  const AMOUNT_ONLY = new RegExp(
    '^[+\\-−]?\\s*(' + CUR + ')?\\s*' +
    '(?:\\d{1,3}(?:[.\\s]\\d{3})+(?:,\\d{1,2})?|\\d+(?:,\\d{1,2}|\\.\\d{2})?)' +
    '\\s*(' + CUR + ')?$');

  /** True when the body is an amount with exactly one currency mark, nothing more. */
  function isPaymentBody(s) {
    const m = AMOUNT_ONLY.exec(String(s || '').trim().replace(REFUND_WORD, ''));
    return !!m && !m[1] !== !m[2];
  }

  /** "3 ott 2026, 01:30" → { date: '2026-10-03', time: '01:30' } */
  function parseDate(s) {
    const m = DATE_RE.exec(s || '');
    if (!m) return null;
    const month = MONTHS[m[2].slice(0, 3).toLowerCase()];
    const day = Number(m[1]);
    if (!month || day < 1 || day > 31) return null;
    const pad = (n) => String(n).padStart(2, '0');
    return {
      date: m[3] + '-' + pad(month) + '-' + pad(day),
      time: m[4] ? pad(Number(m[4])) + ':' + m[5] : ''
    };
  }

  /** "5,00 €" / "1.234,56 €" / "+5,00 €" → { cents, sign, euro }. Italian format:
      '.' groups thousands, ',' is the decimal mark. */
  function parseAmount(s) {
    const text = String(s || '');
    const m = /([+\-−])?\s*(\d[\d.\s]*)(?:,(\d{1,2}))?/.exec(text);
    if (!m) return null;
    let int = m[2].trim(), dec = m[3] || '0';
    // "12.50" with no comma is an English-style decimal, not twelve hundred fifty.
    const dot = /^(\d+)\.(\d{2})$/.exec(int);
    if (!m[3] && dot) { int = dot[1]; dec = dot[2]; }
    const cents = Number(int.replace(/[.\s]/g, '')) * 100 + Number(dec.padEnd(2, '0'));
    if (!isFinite(cents) || cents === 0) return null;
    const refund = m[1] === '+' || /rimbors|refund|accredit/i.test(text);
    // No currency mark at all is read as euro; any other mark is a foreign charge.
    const euro = /€|EUR/i.test(text) || !/[$£¥₹]|[A-Z]{3}/.test(text.replace(/EUR/gi, ''));
    return { cents, sign: refund ? 1 : -1, euro };
  }

  /** "The Book Pub. Firenze, Toscana" → { merchant: 'The Book Pub', place: 'Firenze, Toscana' }.
      Split at the last ". " whose tail looks like "City, Region" — so a merchant with a
      period of its own ("St. Mary Bar. Firenze, Toscana") keeps it. */
  function splitSubtitle(s) {
    const text = String(s || '').trim();
    const m = /^(.+)\.\s+([^.]+,[^.]+)$/.exec(text);
    return m ? { merchant: m[1].trim(), place: m[2].trim() } : { merchant: text, place: '' };
  }

  const slug = (s, n) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, n);

  /** The account key for a card title: same card, same account, whatever its case. */
  const cardKey = (card) => 'wallet:' + String(card || '').trim().toLowerCase();

  // "[buddy UniCredit] conferma op.Internet 49,00 EUR carta *0000 c/o MERCHANT 11/10/26 22:43"
  const BANK_CONFIRM_RE = new RegExp(
    '^(.*?)\\bconferma\\s+op\\b\\.?\\s*[A-Za-z]*\\s+(\\d[\\d.]*(?:,\\d{1,2})?)\\s*([A-Z]{3}|€)\\s+' +
    'carta\\s+\\*?(\\d{3,4})\\s+c\\/o\\s+(.+?)\\s+(\\d{1,2})\\/(\\d{1,2})\\/(\\d{2}|\\d{4})\\s+(\\d{1,2})[:.](\\d{2})', 'i');
  const BANK_REQUEST_RE = /^autorizza\s+pagamento/i;

  /** A buddybank "conferma op." body → { card, cents, euro, merchant, date, time } or null.
      The card is the product name in front of "UniCredit" ("buddy"), so it lands in the
      same account as that card's Wallet notifications. */
  function parseBankConfirm(s) {
    const m = BANK_CONFIRM_RE.exec(String(s || '').trim());
    if (!m) return null;
    const amt = parseAmount(m[2] + ' ' + m[3]);
    if (!amt) return null;
    const pad = (n) => String(n).padStart(2, '0');
    const year = m[8].length === 2 ? '20' + m[8] : m[8];
    const brand = m[1].replace(/\bunicredit\b/i, '').trim();
    return {
      card: brand || 'carta *' + m[4],
      cents: amt.cents,
      euro: amt.euro,
      merchant: m[5].trim(),
      date: year + '-' + pad(Number(m[7])) + '-' + pad(Number(m[6])),
      time: pad(Number(m[9])) + ':' + m[10]
    };
  }

  const minutes = (r) => {
    const [y, mo, d] = r.date.split('-').map(Number);
    const [h, mi] = (r.time || '00:00').split(':').map(Number);
    return Date.UTC(y, mo - 1, d, h, mi) / 60000;
  };

  /* A Wallet notification and a bank confirmation are the same payment when the card and
     amount match and Wallet's time is no earlier than 15 minutes before the bank's and no
     later than two days after it (offline payments notify late). Closest pairs first,
     each row used once, so two equal coffees on two days pair with their own days. */
  const PAIR_BEFORE = 15, PAIR_AFTER = 48 * 60;
  function pairUp(wallet, bank) {
    const cands = [];
    for (const w of wallet) {
      for (const b of bank) {
        if (w.accountUuid !== b.accountUuid || w.amount !== b.amount) continue;
        const diff = minutes(w) - minutes(b);
        if (diff >= -PAIR_BEFORE && diff <= PAIR_AFTER) cands.push({ w, b, d: Math.abs(diff) });
      }
    }
    cands.sort((x, y) => x.d - y.d || x.w.seq - y.w.seq || x.b.seq - y.b.seq);
    const pairs = [], used = new Set();
    for (const c of cands) {
      if (used.has(c.w) || used.has(c.b)) continue;
      used.add(c.w); used.add(c.b);
      pairs.push(c);
    }
    return pairs;
  }

  /** Parse the whole log. Returns { rows, foreign, broken, ignored, merged }:
        rows    — importable transactions (signed amount, negative = expense)
        foreign — blocks charged in another currency (skipped: no euro amount yet)
        broken  — blocks missing a card, body or date
        ignored — complete blocks that aren't payments (stamps, passes, card
                  messages, 3-D Secure requests, …)
        merged  — repeat notifications folded into a payment already counted */
  function parse(text) {
    const blocks = [];
    let cur = null, lastKey = null;
    String(text || '').replace(/^﻿/, '').split(/\r\n|\r|\n/).forEach((raw) => {
      if (!raw.trim()) return;
      const m = LINE_RE.exec(raw);
      const key = m && KEYS[m[1].toLowerCase()];
      if (!key) {
        // A wrapped line belongs to the field above it.
        if (cur && lastKey) cur[lastKey] += ' ' + raw.trim();
        return;
      }
      // A new card title — or a field we already have — starts the next block.
      if (!cur || key === 'card' || cur[key] != null) { cur = {}; blocks.push(cur); }
      cur[key] = m[2].trim();
      lastKey = key;
    });

    const wallet = [], bank = [];
    const seen = new Map(), bankSeen = new Set();
    let foreign = 0, broken = 0, ignored = 0, merged = 0, seq = 0;
    for (const b of blocks) {
      const when = parseDate(b.date);
      // The bank app's notifications are recognised by their text; the title doesn't matter
      // (it's "Transazione autorizzata.", "Pagamento e-commerce", or empty).
      if (b.body && BANK_REQUEST_RE.test(b.body)) { ignored++; continue; }
      const conf = b.body && parseBankConfirm(b.body);
      if (conf) {
        if (!conf.euro) { foreign++; continue; }
        const signed = -conf.cents;
        const id = ['bank', conf.date, conf.time.replace(':', ''), signed,
          slug(conf.card, 12), slug(conf.merchant, 16)].join('-');
        // The same confirmation logged twice is one payment.
        if (bankSeen.has(id)) { merged++; continue; }
        bankSeen.add(id);
        bank.push({
          seq: seq++, externalId: id, date: conf.date, time: conf.time,
          amount: signed / 100, currency: 'EUR', note: conf.merchant, place: '',
          card: conf.card, accountUuid: cardKey(conf.card)
        });
        continue;
      }
      if (!b.card || !when || !b.body) { broken++; continue; }
      // Checked before anything else, so a loyalty pass never becomes an account.
      const amt = isPaymentBody(b.body) && parseAmount(b.body);
      if (!amt) { ignored++; continue; }
      if (!amt.euro) { foreign++; continue; }
      const { merchant, place } = splitSubtitle(b.sub);
      const signed = amt.sign * amt.cents;
      const base = ['wallet', when.date, when.time.replace(':', ''), signed,
        slug(b.card, 12), slug(merchant, 16)].join('-');
      const occ = seen.get(base) || 0;
      seen.set(base, occ + 1);
      wallet.push({
        seq: seq++,
        externalId: base + '-' + occ,
        date: when.date,
        time: when.time,
        amount: signed / 100,
        currency: 'EUR',
        note: merchant || 'Wallet payment',
        place,
        card: b.card.trim(),
        accountUuid: cardKey(b.card)
      });
    }

    // One row per paired payment: Wallet's clean merchant and place, the bank's real
    // time, and both ids. The id that appeared first in the file stays the main one,
    // so it never changes as the file grows.
    const drop = new Set();
    for (const { w, b } of pairUp(wallet, bank)) {
      const [first, second] = w.seq < b.seq ? [w, b] : [b, w];
      Object.assign(w, { seq: first.seq, externalId: first.externalId,
        altIds: [second.externalId], date: b.date, time: b.time });
      drop.add(b);
      merged++;
    }
    const rows = wallet.concat(bank.filter((b) => !drop.has(b)))
      .sort((x, y) => x.seq - y.seq)
      .map(({ seq: _, ...r }) => r);
    return { rows, foreign, broken, ignored, merged };
  }

  return { parse, parseDate, parseAmount, parseBankConfirm, isPaymentBody, splitSubtitle, cardKey };
})();
