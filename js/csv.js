/* CSV parsing (quoted fields, auto delimiter), bank date/amount parsing, CSV export. */
'use strict';

const CSV = (() => {
  /** Detect ; , or tab by counting occurrences outside quotes on the first lines. */
  function detectDelimiter(text) {
    const sample = text.slice(0, 4000).split(/\r?\n/).slice(0, 5).join('\n');
    const counts = { ';': 0, ',': 0, '\t': 0 };
    let inQ = false;
    for (const ch of sample) {
      if (ch === '"') inQ = !inQ;
      else if (!inQ && counts[ch] !== undefined) counts[ch]++;
    }
    return Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0] || ';';
  }

  /** Parse CSV text -> array of string rows. Handles quotes and "" escapes. */
  function parse(text, delimiter) {
    const delim = delimiter || detectDelimiter(text);
    const rows = [];
    let row = [], field = '', inQ = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (inQ) {
        if (ch === '"') {
          if (text[i + 1] === '"') { field += '"'; i++; }
          else inQ = false;
        } else field += ch;
      } else if (ch === '"') {
        inQ = true;
      } else if (ch === delim) {
        row.push(field); field = '';
      } else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && text[i + 1] === '\n') i++;
        row.push(field); field = '';
        if (row.length > 1 || row[0] !== '') rows.push(row);
        row = [];
      } else {
        field += ch;
      }
    }
    if (field !== '' || row.length) { row.push(field); rows.push(row); }
    return { rows, delimiter: delim };
  }

  /**
   * Parse a bank date to 'YYYY-MM-DD'. Supports DD/MM/YYYY (also - and . as
   * separators, 2-digit years) and ISO YYYY-MM-DD. Returns null when invalid.
   */
  function parseDate(s) {
    if (!s) return null;
    const str = String(s).trim();
    let m = str.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) {
      const [, y, mo, d] = m;
      return valid(+y, +mo, +d);
    }
    m = str.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/);
    if (m) {
      let [, d, mo, y] = m;
      let year = +y;
      if (y.length === 2) year += year >= 70 ? 1900 : 2000;
      return valid(year, +mo, +d);
    }
    return null;

    function valid(y, mo, d) {
      if (mo < 1 || mo > 12 || d < 1 || d > 31 || y < 1900 || y > 2100) return null;
      const dt = new Date(y, mo - 1, d);
      if (dt.getMonth() !== mo - 1 || dt.getDate() !== d) return null;
      return y + '-' + String(mo).padStart(2, '0') + '-' + String(d).padStart(2, '0');
    }
  }

  /**
   * Parse a bank amount string: "1.234,56", "-1,234.56", "12,34", "€ 12.34",
   * "(12,34)". Returns a signed Number, or null when not a number.
   */
  function parseAmount(s) {
    if (s == null) return null;
    let str = String(s).trim();
    if (!str) return null;
    let negative = false;
    if (/^\(.*\)$/.test(str)) { negative = true; str = str.slice(1, -1); }
    str = str.replace(/[€$£\s]/g, '');
    if (str.startsWith('+')) str = str.slice(1);
    if (str.startsWith('-')) { negative = !negative; str = str.slice(1); }
    if (!str) return null;

    const lastComma = str.lastIndexOf(',');
    const lastDot = str.lastIndexOf('.');
    if (lastComma >= 0 && lastDot >= 0) {
      // Both present: the later one is the decimal separator.
      if (lastComma > lastDot) str = str.replace(/\./g, '').replace(',', '.');
      else str = str.replace(/,/g, '');
    } else if (lastComma >= 0) {
      const parts = str.split(',');
      // Single comma followed by 1–2 digits = decimal; otherwise thousands.
      if (parts.length === 2 && parts[1].length <= 2) str = parts.join('.');
      else str = parts.join('');
    } else if (lastDot >= 0) {
      const parts = str.split('.');
      // "1.234" (3-digit group) reads as Italian thousands; "12.34" as decimal.
      if (parts.length === 2 && parts[1].length === 3 && parts[0].length <= 3) str = parts.join('');
      else if (parts.length > 2) str = parts.slice(0, -1).join('') + '.' + parts.at(-1);
    }
    const n = Number(str);
    if (!isFinite(n)) return null;
    return negative ? -n : n;
  }

  /** Serialize rows (array of arrays) to CSV text with the given delimiter. */
  function serialize(rows, delimiter) {
    const d = delimiter || ';';
    return rows.map((r) => r.map((cell) => {
      const s = String(cell == null ? '' : cell);
      return (s.includes(d) || s.includes('"') || s.includes('\n'))
        ? '"' + s.replace(/"/g, '""') + '"' : s;
    }).join(d)).join('\r\n');
  }

  return { parse, detectDelimiter, parseDate, parseAmount, serialize };
})();
