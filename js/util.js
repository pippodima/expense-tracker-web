/* Shared utilities: ids, EUR formatting (it-IT), dates, palette, tiny DOM helpers. */
'use strict';

const U = (() => {
  const eurFmt = new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' });
  const eurFmtNoCents = new Intl.NumberFormat('it-IT', {
    style: 'currency', currency: 'EUR', maximumFractionDigits: 0
  });
  const numFmt = new Intl.NumberFormat('it-IT', { maximumFractionDigits: 0 });

  function uid() {
    if (crypto && crypto.randomUUID) return crypto.randomUUID();
    return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
  }

  const fmtEUR = (n) => eurFmt.format(n || 0);
  const fmtEURShort = (n) => (Math.abs(n) >= 1000 ? eurFmtNoCents.format(n) : eurFmt.format(n || 0));
  const fmtNum = (n) => numFmt.format(n || 0);

  /** 'YYYY-MM-DD' for today (local time). */
  function todayISO() {
    const d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' +
      String(d.getDate()).padStart(2, '0');
  }

  /** ISO date string -> localized label like "sab 19 lug" or "19 luglio 2026". */
  function fmtDate(iso, opts) {
    const [y, m, d] = iso.split('-').map(Number);
    const date = new Date(y, m - 1, d);
    return date.toLocaleDateString('it-IT', opts || { weekday: 'short', day: 'numeric', month: 'short' });
  }

  function monthLabel(year, month0) {
    const s = new Date(year, month0, 1).toLocaleDateString('it-IT', { month: 'long', year: 'numeric' });
    return s.charAt(0).toUpperCase() + s.slice(1);
  }

  function monthRange(year, month0) {
    const from = year + '-' + String(month0 + 1).padStart(2, '0') + '-01';
    const lastDay = new Date(year, month0 + 1, 0).getDate();
    const to = year + '-' + String(month0 + 1).padStart(2, '0') + '-' + String(lastDay).padStart(2, '0');
    return { from, to };
  }

  /* Categorical palette (validated, fixed slot order — see dataviz reference). */
  const PALETTE_ORDER = ['blue', 'green', 'magenta', 'yellow', 'aqua', 'orange', 'violet', 'red'];
  const PALETTE = {
    blue:    { light: '#2a78d6', dark: '#3987e5' },
    green:   { light: '#008300', dark: '#008300' },
    magenta: { light: '#e87ba4', dark: '#d55181' },
    yellow:  { light: '#eda100', dark: '#c98500' },
    aqua:    { light: '#1baf7a', dark: '#199e70' },
    orange:  { light: '#eb6834', dark: '#d95926' },
    violet:  { light: '#4a3aa7', dark: '#9085e9' },
    red:     { light: '#e34948', dark: '#e66767' }
  };

  function isDark() {
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  }

  /** Resolve a stored color key (or legacy hex) to a hex for the current theme. */
  function colorOf(key) {
    const mode = isDark() ? 'dark' : 'light';
    if (PALETTE[key]) return PALETTE[key][mode];
    return key || PALETTE.blue[mode];
  }

  /** Tinted background for category icons. */
  function tintOf(key) {
    return colorOf(key) + (isDark() ? '3d' : '26'); // ~24/15% alpha
  }

  /* DOM helpers */
  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

  function el(tag, attrs, children) {
    const node = document.createElement(tag);
    if (attrs) {
      for (const [k, v] of Object.entries(attrs)) {
        if (k === 'class') node.className = v;
        else if (k === 'text') node.textContent = v;
        else if (k === 'html') node.innerHTML = v;
        else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
        else if (k === 'style') node.style.cssText = v;
        else node.setAttribute(k, v);
      }
    }
    (children || []).forEach((c) => c && node.appendChild(c));
    return node;
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  let toastTimer = null;
  function toast(msg) {
    let t = $('#toast');
    if (!t) {
      t = el('div', { id: 'toast', class: 'toast' });
      document.body.appendChild(t);
    }
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 2200);
  }

  /** Toast with an action button (used for Undo instead of confirm dialogs). */
  function toastAction(msg, actionLabel, onAction, ms) {
    const old = $('#toast-action');
    if (old) old.remove();
    const btn = el('button', { class: 'ta-btn', text: actionLabel });
    const t = el('div', { id: 'toast-action', class: 'toast toast-action' }, [
      el('span', { text: msg }), btn
    ]);
    document.body.appendChild(t);
    requestAnimationFrame(() => t.classList.add('show'));
    const dismiss = () => { t.classList.remove('show'); setTimeout(() => t.remove(), 250); };
    const timer = setTimeout(dismiss, ms || 6000);
    btn.addEventListener('click', () => { clearTimeout(timer); dismiss(); onAction(); });
    return dismiss;
  }

  /** Trigger a client-side file download (iOS Safari opens the share sheet). */
  function download(filename, text, mime) {
    const blob = new Blob([text], { type: mime || 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const a = el('a', { href: url, download: filename });
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { a.remove(); URL.revokeObjectURL(url); }, 4000);
  }

  return {
    uid, fmtEUR, fmtEURShort, fmtNum, todayISO, fmtDate, monthLabel, monthRange,
    PALETTE, PALETTE_ORDER, colorOf, tintOf, isDark,
    $, $$, el, esc, toast, toastAction, download
  };
})();
