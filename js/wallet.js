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
   language changes. */
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

  /** Parse the whole log. Returns { rows, foreign, broken }:
        rows    — importable transactions (signed amount, negative = expense)
        foreign — blocks charged in another currency (skipped: no euro amount yet)
        broken  — blocks missing a card, amount or date */
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

    const rows = [];
    const seen = new Map();
    let foreign = 0, broken = 0;
    for (const b of blocks) {
      const when = parseDate(b.date);
      const amt = parseAmount(b.body);
      if (!b.card || !when || !amt) { broken++; continue; }
      if (!amt.euro) { foreign++; continue; }
      const { merchant, place } = splitSubtitle(b.sub);
      const signed = amt.sign * amt.cents;
      const base = ['wallet', when.date, when.time.replace(':', ''), signed,
        slug(b.card, 12), slug(merchant, 16)].join('-');
      const occ = seen.get(base) || 0;
      seen.set(base, occ + 1);
      rows.push({
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
    return { rows, foreign, broken };
  }

  return { parse, parseDate, parseAmount, splitSubtitle, cardKey };
})();
