/* Smart import detection: works out which column/key holds the date, amount and
   description in an arbitrary bank CSV or an export from another expenses app.

   Two independent signals, combined:
     1. Header names, in several languages (data/date/fecha/datum, importo/amount/
        monto/betrag, descrizione/description/concepto/verwendungszweck, …).
     2. The values themselves — how many rows parse as a date, as a number, how
        long the text is. Content wins when headers are missing or unhelpful,
        which is what makes this survive unknown formats.

   Also handles: preamble junk above the header, missing header row, ,/;/tab/|
   delimiters, EU vs US decimal conventions, debit/credit column pairs, and
   JSON arrays (possibly nested under a wrapper key). */
'use strict';

const Detect = (() => {
  const HEADER_HINTS = {
    date: ['data contabile', 'data valuta', 'data operazione', 'data', 'date', 'fecha',
      'datum', 'booking date', 'transaction date', 'value date', 'completed date',
      'giorno', 'day', 'time', 'timestamp', 'started date'],
    amount: ['importo', 'amount', 'monto', 'betrag', 'valore', 'value', 'total', 'totale',
      'sum', 'somma', 'montant', 'saldo movimento', 'transaction amount'],
    debit: ['addebiti', 'addebito', 'dare', 'debit', 'uscite', 'uscita', 'spese', 'withdrawal',
      'paid out', 'debito', 'expense', 'money out'],
    credit: ['accrediti', 'accredito', 'avere', 'credit', 'entrate', 'entrata', 'deposit',
      'paid in', 'income', 'money in'],
    description: ['descrizione', 'description', 'causale', 'beneficiario', 'dettagli',
      'operazione', 'concepto', 'verwendungszweck', 'note', 'notes', 'memo', 'payee',
      'merchant', 'name', 'reference', 'title', 'category description', 'details'],
    category: ['categoria', 'category', 'kategorie', 'categoría'],
    account: ['conto', 'account', 'cuenta', 'konto', 'wallet'],
    currency: ['valuta', 'currency', 'divisa', 'währung', 'moneda'],
    type: ['tipo', 'type', 'tipologia', 'income/expense', 'transaction type']
  };

  const norm = (s) => String(s == null ? '' : s).toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9\/ ]+/g, ' ')
    .replace(/\s+/g, ' ').trim();

  function headerScore(header, kind) {
    const h = norm(header);
    if (!h) return 0;
    let best = 0;
    for (const hint of HEADER_HINTS[kind]) {
      if (h === hint) best = Math.max(best, 1);
      else if (h.startsWith(hint) || h.endsWith(hint)) best = Math.max(best, 0.85);
      else if (h.includes(hint)) best = Math.max(best, 0.7);
    }
    return best;
  }

  /* ---- value sniffing ---- */

  const DATE_PATTERNS = [
    /^\d{4}-\d{1,2}-\d{1,2}(?:[T ]|$)/,          // ISO
    /^\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4}$/,     // D/M/Y or M/D/Y
    /^\d{1,2}\s+[a-zà-ú]{3,}\.?\s+\d{2,4}$/i,    // 3 luglio 2026
    /^[a-zà-ú]{3,}\.?\s+\d{1,2},?\s+\d{2,4}$/i   // July 3, 2026
  ];

  const looksDate = (v) => {
    const s = String(v == null ? '' : v).trim();
    if (!s) return false;
    return DATE_PATTERNS.some((re) => re.test(s));
  };

  /** Does this look like a money value? (tolerates €, %, thousands, minus, parens) */
  function looksAmount(v) {
    const s = String(v == null ? '' : v).trim();
    if (!s) return false;
    if (!/\d/.test(s)) return false;
    if (/[a-z]{3,}/i.test(s.replace(/eur|usd|gbp|chf/gi, ''))) return false;
    return /^[-+(]?\s*[€$£]?\s*[\d.,\s]+\s*[€$£]?\s*(eur|usd|gbp|chf)?\s*\)?$/i.test(s);
  }

  const ratio = (rows, col, fn) => {
    let ok = 0, seen = 0;
    for (const r of rows) {
      const v = r[col];
      if (v == null || String(v).trim() === '') continue;
      seen++;
      if (fn(v)) ok++;
    }
    return seen ? ok / seen : 0;
  };

  const avgTextLen = (rows, col) => {
    let total = 0, n = 0;
    for (const r of rows) {
      const v = String(r[col] == null ? '' : r[col]).trim();
      if (!v) continue;
      total += v.length; n++;
    }
    return n ? total / n : 0;
  };

  /** How many distinct non-empty values (helps spot category/type columns). */
  const distinct = (rows, col) => {
    const set = new Set();
    rows.forEach((r) => {
      const v = String(r[col] == null ? '' : r[col]).trim();
      if (v) set.add(v.toLowerCase());
    });
    return set.size;
  };

  /**
   * Pick the best column for each role.
   * columns: array of header names (may be empty strings when headerless)
   * rows: array of arrays (or array of objects keyed by the same names)
   */
  function detectColumns(columns, rows) {
    const sample = rows.slice(0, 40);
    const cand = columns.map((name, i) => {
      const key = Array.isArray(sample[0]) ? i : name;
      return {
        i, name, key,
        dateRatio: ratio(sample, key, looksDate),
        amountRatio: ratio(sample, key, looksAmount),
        textLen: avgTextLen(sample, key),
        distinct: distinct(sample, key)
      };
    });

    const pick = (kind, scorer) => {
      let best = null, bestScore = 0;
      for (const c of cand) {
        const s = scorer(c) + headerScore(c.name, kind) * 1.2;
        if (s > bestScore) { bestScore = s; best = c; }
      }
      return bestScore > 0.5 ? { ...best, score: bestScore } : null;
    };

    const date = pick('date', (c) => c.dateRatio * 2);
    // Amount: numeric-looking, and not the date column
    const amountCands = cand
      .filter((c) => c.amountRatio > 0.6 && (!date || c.i !== date.i))
      .sort((a, b) => (b.amountRatio + headerScore(b.name, 'amount')) -
        (a.amountRatio + headerScore(a.name, 'amount')));

    const debit = pick('debit', (c) => (c.amountRatio > 0.4 ? 0.3 : 0));
    const credit = pick('credit', (c) => (c.amountRatio > 0.4 ? 0.3 : 0));
    const hasPair = debit && credit && debit.i !== credit.i &&
      headerScore(debit.name, 'debit') > 0.6 && headerScore(credit.name, 'credit') > 0.6;

    // Description: the wordiest column that isn't date/amount
    const usedIdx = new Set([date && date.i, ...amountCands.slice(0, 2).map((c) => c.i)]
      .filter((x) => x != null));
    const descCands = cand
      .filter((c) => !usedIdx.has(c.i))
      .map((c) => ({ c, s: Math.min(c.textLen / 18, 1.2) + headerScore(c.name, 'description') * 1.5 }))
      .sort((a, b) => b.s - a.s);

    const category = pick('category', (c) =>
      (c.distinct > 1 && c.distinct <= Math.max(3, sample.length / 2) && c.textLen < 24 ? 0.25 : 0));

    return {
      date, amount: amountCands[0] || null, debit, credit, pair: !!hasPair,
      description: descCands.length ? descCands[0].c : null,
      category: category && (!descCands.length || category.i !== descCands[0].c.i) ? category : null,
      candidates: cand
    };
  }

  /**
   * Decide the date convention for a column of values.
   * Returns 'iso' | 'dmy' | 'mdy' | 'text', plus `ambiguous` when both D/M and
   * M/D parse everywhere (no value above 12 in either position).
   */
  function detectDateFormat(values) {
    let iso = 0, dmyOnly = 0, mdyOnly = 0, both = 0, text = 0, n = 0;
    for (const raw of values) {
      const s = String(raw == null ? '' : raw).trim();
      if (!s) continue;
      n++;
      if (/^\d{4}-\d{1,2}-\d{1,2}/.test(s)) { iso++; continue; }
      const m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/);
      if (m) {
        const a = +m[1], b = +m[2];
        if (a > 12 && b <= 12) dmyOnly++;
        else if (b > 12 && a <= 12) mdyOnly++;
        else both++;
        continue;
      }
      if (/[a-zà-ú]{3,}/i.test(s)) text++;
    }
    if (!n) return { format: 'dmy', ambiguous: false, confidence: 0 };
    if (iso / n > 0.7) return { format: 'iso', ambiguous: false, confidence: iso / n };
    if (text / n > 0.7) return { format: 'text', ambiguous: false, confidence: text / n };
    if (dmyOnly && !mdyOnly) return { format: 'dmy', ambiguous: false, confidence: 1 };
    if (mdyOnly && !dmyOnly) return { format: 'mdy', ambiguous: false, confidence: 1 };
    if (dmyOnly && mdyOnly) {
      // Conflicting evidence — go with the majority but flag it
      const f = dmyOnly >= mdyOnly ? 'dmy' : 'mdy';
      return { format: f, ambiguous: true, confidence: 0.5 };
    }
    // Every value fits both readings (all day/month <= 12): default to DD/MM (EU)
    return { format: 'dmy', ambiguous: both > 0, confidence: 0.5 };
  }

  /** Parse a date string using a detected convention -> 'YYYY-MM-DD' or null. */
  const MONTHS = {
    gen: 1, ene: 1, jan: 1, feb: 2, mar: 3, apr: 4, abr: 4, mag: 5, may: 5, mai: 5,
    giu: 6, jun: 6, lug: 7, jul: 7, ago: 8, aug: 8, set: 9, sep: 9, ott: 10, oct: 10, okt: 10,
    nov: 11, dic: 12, dec: 12, dez: 12
  };

  function parseDateSmart(value, format) {
    const s = String(value == null ? '' : value).trim();
    if (!s) return null;
    let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (m) return iso(+m[1], +m[2], +m[3]);
    m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/);
    if (m) {
      let [, a, b, y] = m;
      let year = +y; if (y.length === 2) year += year >= 70 ? 1900 : 2000;
      const day = format === 'mdy' ? +b : +a;
      const mon = format === 'mdy' ? +a : +b;
      return iso(year, mon, day);
    }
    m = s.match(/^(\d{1,2})\s+([a-zà-ú]{3,})\.?\s+(\d{2,4})$/i);
    if (m) {
      const mon = MONTHS[m[2].slice(0, 3).toLowerCase()];
      if (mon) return iso(+m[3] < 100 ? +m[3] + 2000 : +m[3], mon, +m[1]);
    }
    m = s.match(/^([a-zà-ú]{3,})\.?\s+(\d{1,2}),?\s+(\d{2,4})$/i);
    if (m) {
      const mon = MONTHS[m[1].slice(0, 3).toLowerCase()];
      if (mon) return iso(+m[3] < 100 ? +m[3] + 2000 : +m[3], mon, +m[2]);
    }
    const t = Date.parse(s);
    if (!isNaN(t)) {
      const d = new Date(t);
      return iso(d.getFullYear(), d.getMonth() + 1, d.getDate());
    }
    return null;

    function iso(y, mo, d) {
      if (!(mo >= 1 && mo <= 12 && d >= 1 && d <= 31 && y >= 1900 && y <= 2100)) return null;
      return y + '-' + String(mo).padStart(2, '0') + '-' + String(d).padStart(2, '0');
    }
  }

  /**
   * Work out the decimal convention for a column of money strings.
   * '1.234,56' -> 'eu' · '1,234.56' -> 'us'. Falls back to per-value heuristics.
   */
  function detectAmountFormat(values) {
    let eu = 0, us = 0;
    for (const raw of values) {
      const s = String(raw == null ? '' : raw).replace(/[^\d.,]/g, '');
      if (!s) continue;
      const lastC = s.lastIndexOf(','), lastD = s.lastIndexOf('.');
      // Both separators present: the rightmost one is the decimal point
      if (lastC >= 0 && lastD >= 0) { (lastC > lastD ? eu++ : us++); continue; }
      // Only one separator: exactly three digits after it means it groups
      // thousands (1.234 EU / 1,234 US); anything else is a decimal point,
      // so "21.7" and "21.70" both read as US, "21,7" and "21,70" as EU.
      if (lastC >= 0) { (s.length - lastC - 1 === 3 ? us++ : eu++); continue; }
      if (lastD >= 0) { (s.length - lastD - 1 === 3 ? eu++ : us++); }
    }
    return { format: eu >= us ? 'eu' : 'us', confidence: Math.max(eu, us) / Math.max(1, eu + us) };
  }

  /** Parse money with a known convention. Returns a signed Number or null. */
  function parseAmountSmart(value, format) {
    let s = String(value == null ? '' : value).trim();
    if (!s) return null;
    let neg = false;
    if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
    s = s.replace(/[€$£]|eur|usd|gbp|chf/gi, '').replace(/\s/g, '');
    if (s.startsWith('+')) s = s.slice(1);
    if (s.startsWith('-')) { neg = !neg; s = s.slice(1); }
    if (!s) return null;
    s = format === 'us' ? s.replace(/,/g, '') : s.replace(/\./g, '').replace(',', '.');
    const n = Number(s);
    if (!isFinite(n)) return null;
    return neg ? -n : n;
  }

  /**
   * Find the header row in a CSV that may start with preamble junk.
   * Returns { headerIndex, hasHeader } — headerIndex is the row to use as names.
   */
  function findHeaderRow(rows) {
    const width = Math.max(...rows.slice(0, 30).map((r) => r.length));
    for (let i = 0; i < Math.min(rows.length, 25); i++) {
      const r = rows[i];
      if (r.length < Math.max(2, width - 1)) continue;         // short preamble line
      const filled = r.filter((c) => String(c).trim() !== '').length;
      if (filled < Math.max(2, r.length - 1)) continue;
      const named = r.filter((c) =>
        Object.keys(HEADER_HINTS).some((k) => headerScore(c, k) > 0.6)).length;
      const numeric = r.filter((c) => looksAmount(c) || looksDate(c)).length;
      if (named >= 2 && numeric === 0) return { headerIndex: i, hasHeader: true };
      // A row of values right at the top means there is no header at all
      if (i === 0 && numeric >= 2) return { headerIndex: -1, hasHeader: false };
    }
    // Fall back: treat row 0 as a header when it isn't obviously data
    const first = rows[0] || [];
    const dataLike = first.filter((c) => looksAmount(c) || looksDate(c)).length;
    return dataLike >= 2 ? { headerIndex: -1, hasHeader: false } : { headerIndex: 0, hasHeader: true };
  }

  /** Locate the transactions array inside an arbitrary JSON export. */
  function findRecordArray(json) {
    if (Array.isArray(json)) return json;
    if (!json || typeof json !== 'object') return null;
    const preferred = ['transactions', 'data', 'items', 'records', 'entries', 'rows',
      'expenses', 'operations', 'movements'];
    for (const k of preferred) {
      if (Array.isArray(json[k]) && json[k].length && typeof json[k][0] === 'object') return json[k];
    }
    let best = null;
    for (const v of Object.values(json)) {
      if (Array.isArray(v) && v.length && typeof v[0] === 'object' &&
          (!best || v.length > best.length)) best = v;
      else if (v && typeof v === 'object') {
        const nested = findRecordArray(v);
        if (nested && (!best || nested.length > best.length)) best = nested;
      }
    }
    return best;
  }

  return {
    detectColumns, detectDateFormat, parseDateSmart, detectAmountFormat, parseAmountSmart,
    findHeaderRow, findRecordArray, looksDate, looksAmount, headerScore, norm
  };
})();
