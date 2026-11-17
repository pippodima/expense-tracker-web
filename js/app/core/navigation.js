/* Tab navigation, the global re-render, and the Home period helpers. */
'use strict';

/* ======================= Navigation ======================= */

function show(view) {
  ui.view = view;
  $$('.view').forEach((v) => v.classList.toggle('active', v.id === 'view-' + view));
  $$('.tabbar [data-tab]').forEach((b) =>
    b.classList.toggle('active', b.dataset.tab === view));
  render();
  window.scrollTo(0, 0);
}

function render() {
  if (ui.view === 'dashboard') renderDashboard();
  else if (ui.view === 'stats') renderStats();
  else if (ui.view === 'transactions') renderTransactions();
  else if (ui.view === 'accounts') renderAccounts();
  else if (ui.view === 'settings') renderSettings();
}

/* ======================= Period helpers ======================= */

function periodRange() {
  if (ui.period.type === 'month') return U.monthRange(ui.period.y, ui.period.m0);
  return { from: ui.period.from, to: ui.period.to };
}

function periodLabel() {
  if (ui.period.type === 'month') return U.monthLabel(ui.period.y, ui.period.m0);
  return U.fmtDate(ui.period.from, { day: 'numeric', month: 'short' }) + ' – ' +
    U.fmtDate(ui.period.to, { day: 'numeric', month: 'short', year: 'numeric' });
}

function inRange(t, r) { return t.date >= r.from && t.date <= r.to; }
