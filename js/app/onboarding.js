/* Getting started: the setup checklist and the one-time swipe hint. */
'use strict';

/* ======================= Getting started =======================
   A fresh install seeds categories and accounts but no transactions and no
   budget, so Home reads 0,00 € three times and nothing hints that importing,
   trips or the daily allowance exist. The checklist teaches by doing rather than
   by explaining: it derives its ticks from the data itself, so it can't disagree
   with reality, and it removes itself once there's nothing left to say. */

const tutorialCfg = () =>
  Object.assign({ hidden: false, swipeShown: false }, DB.state.meta.tutorial || {});

/* Two of these are things everyone must do; two are optional features. Treating
   all four as mandatory meant someone who doesn't want a budget and has no bank
   export was nagged forever, with the ✕ the only way out — and that also threw
   away the steps that still mattered. So only `essential` steps hold the card
   open, and the optional ones can be answered with Skip. */
function setupSteps() {
  const m = DB.state.meta;
  const skipped = tutorialCfg().skipped || [];
  const step = (o) => Object.assign({ skipped: skipped.includes(o.key) }, o);
  return [
    step({ key: 'tx', essential: true, done: DB.state.transactions.length > 0,
      title: 'Add your first expense',
      hint: 'Tap + anywhere. The note field suggests a category as you type.',
      go: () => openTxSheet(null) }),
    step({ key: 'budget', essential: false, done: !!(m.budget && m.budget.amount),
      title: 'Set a monthly budget',
      hint: 'Spread per day and it rebalances itself as you spend. Optional.',
      go: openBudgetSheet }),
    step({ key: 'import', essential: false, done: !!m.everImported,
      title: 'Import your bank history',
      hint: 'A CSV or JSON export \u2014 columns are detected for you. Optional.',
      go: openCsvWizard }),
    step({ key: 'backup', essential: true, done: !!m.lastBackup,
      title: 'Save a backup',
      hint: 'Your data lives only on this phone. A backup is the safety net.',
      go: exportJSON })
  ];
}

/** The checklist card, or null once it has nothing left worth saying. */
function setupCard() {
  if (tutorialCfg().hidden) return null;
  const steps = setupSteps();
  // Only the essentials keep it alive: once you can use the app and your data is
  // safe, its job is done and the optional features live on in "How it works".
  if (steps.every((s) => !s.essential || s.done)) return null;
  const open = steps.filter((s) => !s.done && !s.skipped);
  if (!open.length) return null;              // everything answered, one way or another

  const skipStep = async (key) => {
    const cfg = tutorialCfg();
    await DB.setMeta('tutorial',
      Object.assign(cfg, { skipped: [...new Set([...(cfg.skipped || []), key])] }));
    render();
  };

  const card = el('div', { class: 'card setup-card' }, [
    el('div', { class: 'card-head' }, [
      el('h2', { text: 'Getting started' }),
      el('button', { class: 'btn small ghost', text: '\u2715', 'aria-label': 'Dismiss',
        onclick: async () => {
          await DB.setMeta('tutorial', Object.assign(tutorialCfg(), { hidden: true }));
          render();
        } })
    ])
  ]);
  steps.forEach((s) => {
    if (s.skipped && !s.done) return;                 // answered: stop showing it
    const row = el('div', { class: 'setup-step' + (s.done ? ' done' : '') }, [
      el('button', { class: 'setup-go-btn', onclick: s.done ? null : s.go }, [
        el('span', { class: 'setup-tick', text: s.done ? '\u2713' : '' }),
        el('span', { class: 'setup-main' }, [
          el('span', { class: 'setup-title', text: s.title }),
          s.done ? null : el('span', { class: 'setup-hint', text: s.hint })
        ]),
        s.done ? null : el('span', { class: 'setup-go', text: '\u203a' })
      ])
    ]);
    // "Not for me" is a real answer, and only optional things can be answered that way
    if (!s.done && !s.essential) {
      row.append(el('button', { class: 'btn small ghost setup-skip', text: 'Skip',
        onclick: () => skipStep(s.key) }));
    }
    card.append(row);
  });
  const essentialsLeft = steps.filter((s) => s.essential && !s.done).length;
  card.append(el('div', { class: 'setup-foot muted', text: essentialsLeft === 1
    ? 'One more essential step \u00b7 everything here stays on your phone'
    : essentialsLeft + ' essential steps \u00b7 everything here stays on your phone' }));
  return card;
}

/* Swipe is the app's main shortcut and completely invisible until discovered.
   Nudge the first row once \u2014 with the action layer temporarily painted, since it
   is hidden at rest \u2014 then never again. */
function maybeShowSwipeHint(wrap) {
  if (!wrap || tutorialCfg().swipeShown) return;
  DB.setMeta('tutorial', Object.assign(tutorialCfg(), { swipeShown: true }));
  const row = wrap.querySelector('.tx-row');
  if (!row) return;
  const caption = el('div', { class: 'swipe-hint muted',
    text: 'Tip: swipe a row right to edit, left to delete.' });
  wrap.parentNode.insertBefore(caption, wrap.nextSibling);
  setTimeout(() => {
    wrap.classList.add('dir-right', 'swiping');
    row.style.transition = 'transform .45s ease';
    row.style.transform = 'translateX(76px)';
    setTimeout(() => {
      row.style.transform = 'translateX(0)';
      setTimeout(() => {
        wrap.classList.remove('dir-right', 'swiping');
        row.style.transition = '';
      }, 500);
    }, 850);
  }, 600);
  setTimeout(() => caption.remove(), 9000);
}
