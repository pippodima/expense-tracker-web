/* The add / edit transaction sheet and its one-tap repeat chips. */
'use strict';

/* ======================= Transaction sheet ======================= */

/** Most-repeated recent expenses, for the one-tap chips. */
function frequentTransactions(limit) {
  const cutoff = new Date(Date.now() - 120 * 86400000).toISOString().slice(0, 10);
  const seen = new Map();
  for (const t of DB.state.transactions) {
    if (t.type !== 'expense' || t.date < cutoff || !t.note) continue;
    const key = merchantKey(t.note) + '|' + t.amount.toFixed(2);
    const hit = seen.get(key);
    if (hit) { hit.count++; if (t.date > hit.last) hit.last = t.date; }
    else seen.set(key, { count: 1, last: t.date, tx: t });
  }
  return [...seen.values()]
    .filter((x) => x.count >= 2)
    .sort((a, b) => b.count - a.count || b.last.localeCompare(a.last))
    .slice(0, limit || 5);
}

function openTxSheet(existing) {
  if (DB.state.accounts.length === 0) return toast('Create an account first');
  const draft = existing ? { ...existing } : {
    id: null, type: 'expense', amount: 0, date: U.todayISO(),
    categoryId: '', accountId: DB.state.accounts[0].id, note: ''
  };
  let manualCat = !!existing; // don't auto-override an existing/manual choice

  openSheet(existing ? 'Edit transaction' : 'New transaction', (body, api) => {
    // Type toggle — transfers move money between accounts, so they are neither
    // income nor expense and never appear in spending stats.
    const seg = el('div', { class: 'seg' });
    const bExp = el('button', { text: 'Expense' });
    const bInc = el('button', { text: 'Income' });
    const bTrf = el('button', { text: 'Transfer' });
    const syncSeg = () => {
      bExp.className = draft.type === 'expense' ? 'active exp' : '';
      bInc.className = draft.type === 'income' ? 'active inc' : '';
      bTrf.className = draft.type === 'transfer' ? 'active' : '';
      const isTrf = draft.type === 'transfer';
      catField.style.display = isTrf ? 'none' : '';
      // Only expenses draw on the budget, so only they can be held back from it
      budgetField.style.display = draft.type === 'expense' ? '' : 'none';
      noteField.querySelector('label').textContent = isTrf ? 'Note (optional)' : 'Note';
      acctLabel.textContent = isTrf ? 'From account' : 'Account';
      toField.style.display = isTrf ? '' : 'none';
      if (isTrf) drawToAccts();
    };
    bExp.addEventListener('click', () => { draft.type = 'expense'; syncSeg(); });
    bInc.addEventListener('click', () => { draft.type = 'income'; syncSeg(); });
    bTrf.addEventListener('click', () => {
      draft.type = 'transfer';
      if (!draft.toAccountId || draft.toAccountId === draft.accountId) {
        const other = DB.state.accounts.find((a) => a.id !== draft.accountId);
        draft.toAccountId = other ? other.id : null;
      }
      syncSeg();
    });
    if (DB.state.accounts.length > 1) seg.append(bExp, bInc, bTrf);
    else seg.append(bExp, bInc);

    // Amount
    const amount = el('input', {
      type: 'text', inputmode: 'decimal', placeholder: '0,00', autocomplete: 'off',
      value: existing ? existing.amount.toFixed(2).replace('.', ',') : ''
    });
    // While inside a foreign-currency trip, type the price as it appears locally
    const fxTrip = existing
      ? (tripForDate(existing.date) || null)
      : activeTrip();
    const fx = fxTrip && fxTrip.currency && fxTrip.rate ? fxTrip : null;
    let useLocal = !!fx && (!existing || existing.origCurrency === fx.currency);
    if (existing && existing.origAmount && useLocal) {
      amount.value = String(existing.origAmount).replace('.', ',');
    }
    const curLabel = el('span', { class: 'cur', text: useLocal ? fx.currency : '€' });
    const amountWrap = el('div', { class: 'amount-wrap' }, [curLabel, amount]);
    const fxLine = el('div', { class: 'fx-line muted' });
    const syncFx = () => {
      if (!fx) { fxLine.textContent = ''; return; }
      const v = CSV.parseAmount(amount.value) || 0;
      curLabel.textContent = useLocal ? fx.currency : '€';
      fxLine.innerHTML = '';
      fxLine.append(
        el('span', { text: useLocal
          ? '≈ ' + fmtEUR(v * fx.rate) + '  (1 ' + fx.currency + ' = ' + fmtEUR(fx.rate) + ')'
          : 'Entering euro directly' }),
        el('button', { class: 'btn small ghost', text: useLocal ? 'Use €' : 'Use ' + fx.currency,
          onclick: () => { useLocal = !useLocal; syncFx(); } })
      );
    };
    amount.addEventListener('input', syncFx);
    syncFx();

    // Date
    const date = el('input', { type: 'date', value: draft.date });
    date.addEventListener('change', () => { draft.date = date.value; });

    // Account chips (source account; also the "from" side of a transfer)
    const acctChips = el('div', { class: 'chips scroll' });
    const drawAccts = () => {
      acctChips.innerHTML = '';
      DB.state.accounts.forEach((a) => {
        acctChips.append(el('button', {
          class: 'chip' + (draft.accountId === a.id ? ' active' : ''),
          onclick: () => {
            draft.accountId = a.id;
            if (draft.type === 'transfer' && draft.toAccountId === a.id) {
              const other = DB.state.accounts.find((x) => x.id !== a.id);
              draft.toAccountId = other ? other.id : null;
              drawToAccts();
            }
            drawAccts();
          }
        }, [el('span', { text: acctIcon(a.type) }), el('span', { text: a.name })]));
      });
    };
    drawAccts();

    // Destination account (transfers only)
    const toChips = el('div', { class: 'chips scroll' });
    const drawToAccts = () => {
      toChips.innerHTML = '';
      DB.state.accounts.filter((a) => a.id !== draft.accountId).forEach((a) => {
        toChips.append(el('button', {
          class: 'chip' + (draft.toAccountId === a.id ? ' active' : ''),
          onclick: () => { draft.toAccountId = a.id; drawToAccts(); }
        }, [el('span', { text: acctIcon(a.type) }), el('span', { text: a.name })]));
      });
    };

    // Category chips — recently picked first, then most used
    /* With a handful of categories every chip fits; with thirty, a scrolling strip
       means hunting blind. So: the ~8 most likely (recent picks first, then
       frequency) as wrapped chips, and "All N" opens a searchable grid. The chip
       for the current selection is always present, wherever it ranks. */
    const catChips = el('div', { class: 'chips wrap' });
    const pickCat = (id) => {
      draft.categoryId = id; manualCat = true; suggest.textContent = ''; drawCats();
    };
    const drawCats = () => {
      catChips.innerHTML = '';
      const all = orderedCategories();
      const MAX = 8;
      let show = all.slice(0, MAX);
      if (draft.categoryId && !show.some((c) => c.id === draft.categoryId)) {
        const cur = all.find((c) => c.id === draft.categoryId);
        if (cur) show = [cur, ...show.slice(0, MAX - 1)];
      }
      show.forEach((c) => {
        catChips.append(el('button', {
          class: 'chip' + (draft.categoryId === c.id ? ' active' : ''),
          text: c.icon + ' ' + c.name,
          onclick: () => pickCat(c.id)
        }));
      });
      if (all.length > MAX) {
        catChips.append(el('button', {
          class: 'chip chip-more', text: 'All ' + all.length + ' ›',
          onclick: () => openCategoryPickSheet(draft.categoryId, (c) => pickCat(c.id))
        }));
      }
    };
    drawCats();

    // Note + rule-based suggestion
    const note = el('input', {
      type: 'text', placeholder: 'Note (e.g. ESSELUNGA)', value: draft.note || '',
      autocomplete: 'off', autocapitalize: 'characters'
    });
    const suggest = el('div', { class: 'note-suggest' });
    note.addEventListener('input', () => {
      draft.note = note.value;
      if (manualCat) return;
      const hit = DB.suggestCategory(note.value);
      if (hit) {
        draft.categoryId = hit.id;
        suggest.textContent = '💡 Suggested: ' + hit.icon + ' ' + hit.name;
        drawCats();
      } else {
        suggest.textContent = '';
      }
    });

    const save = el('button', {
      class: 'btn block primary', text: existing ? 'Save changes' : 'Add transaction',
      onclick: async () => {
        const val = CSV.parseAmount(amount.value);
        if (val == null || val <= 0) return toast('Enter an amount');
        if (!draft.accountId) return toast('Pick an account');
        if (!draft.date) return toast('Pick a date');
        if (draft.type === 'transfer') {
          if (!draft.toAccountId) return toast('Pick the destination account');
          if (draft.toAccountId === draft.accountId) return toast('Pick two different accounts');
          draft.categoryId = null;      // transfers are not spending
          delete draft.needsReview;
        } else {
          if (!draft.categoryId) return toast('Pick a category');
          delete draft.toAccountId;
          delete draft.needsReview;     // manually edited = reviewed
        }
        // Income and transfers never touch the budget, so the flag is meaningless
        if (draft.type !== 'expense') delete draft.excludeFromBudget;
        if (fx && useLocal) {
          // Store EUR as the canonical amount, keep what was actually typed
          draft.origAmount = Math.round(val * 100) / 100;
          draft.origCurrency = fx.currency;
          draft.rate = fx.rate;
          draft.amount = Math.round(val * fx.rate * 100) / 100;
        } else {
          draft.amount = Math.round(val * 100) / 100;
          delete draft.origAmount; delete draft.origCurrency; delete draft.rate;
        }
        // An imported row whose date/amount/type you changed keeps your values on
        // every later import (see applyBankSync).
        if (existing && existing.externalId && (draft.date !== existing.date ||
            draft.amount !== existing.amount || draft.type !== existing.type)) {
          draft.userEdited = true;
        }
        await DB.put('transactions', draft);
        if (draft.categoryId) await rememberCategoryPick(draft.categoryId);
        await bumpChanges(1);
        api.close();
        toast(existing ? 'Saved' : 'Added ' + fmtEUR(draft.amount));
        render();
      }
    });

    const acctLabel = el('label', { text: 'Account' });
    const catField = el('div', { class: 'field' },
      [el('label', { text: 'Category' }), catChips]);
    const noteField = el('div', { class: 'field' },
      [el('label', { text: 'Note' }), note, suggest]);
    const toField = el('div', { class: 'field', style: 'display:none' },
      [el('label', { text: 'To account' }), toChips]);

    /* Counts toward the daily budget. Reflects the rules when the user hasn't
       spoken, so a charge caught by a category or keyword shows as already out;
       switching it back on records an explicit `false` rather than deleting the
       flag, which would just let the same rule catch it again. */
    const budgetToggle = el('input', { type: 'checkbox' });
    const budgetHint = el('div', { class: 'note-suggest' });
    const syncBudgetToggle = () => {
      const reason = budgetSkipReason(draft);
      budgetToggle.checked = !reason;
      budgetHint.textContent = !reason ? ''
        : reason === 'category' ? 'This category is set to stay out of the daily budget.'
        : reason === 'keyword' ? 'A keyword in the note keeps this out of the daily budget.'
        : 'Kept out of the daily budget — it still counts everywhere else.';
    };
    budgetToggle.addEventListener('change', () => {
      if (budgetToggle.checked) {
        const copy = Object.assign({}, draft); delete copy.excludeFromBudget;
        // Only pin an explicit "count it" when a rule would otherwise exclude it
        if (budgetSkipReason(copy)) draft.excludeFromBudget = false;
        else delete draft.excludeFromBudget;
      } else {
        draft.excludeFromBudget = true;
      }
      syncBudgetToggle();
    });
    note.addEventListener('input', syncBudgetToggle);
    const budgetField = el('div', { class: 'field' }, [
      el('label', { class: 'switch-row', style: 'display:flex' }, [
        el('span', { class: 's-main', text: 'Counts toward the daily budget' }),
        budgetToggle
      ]),
      budgetHint
    ]);
    syncBudgetToggle();

    // One-tap repeat: your most frequent recent charges, added instantly (undoable)
    if (!existing) {
      const freq = frequentTransactions(5);
      if (freq.length) {
        const chips = el('div', { class: 'chips scroll' });
        freq.forEach(({ tx, count }) => {
          const c = DB.category(tx.categoryId);
          chips.append(el('button', { class: 'chip repeat-chip', onclick: async () => {
            const copy = {
              id: null, type: 'expense', amount: tx.amount, date: U.todayISO(),
              categoryId: tx.categoryId, accountId: tx.accountId, note: tx.note
            };
            await DB.put('transactions', copy);
            await bumpChanges(1);
            api.close();
            toastUndo('Added ' + fmtEUR(copy.amount), async () => {
              await DB.del('transactions', copy.id);
              await bumpChanges(1);
              render();
            });
            render();
          } }, [
            el('span', { text: c ? c.icon : '•' }),
            // A note-less charge still deserves a name: fall back to its category
            el('span', { text: (tx.note || (c ? c.name : '')).slice(0, 14) }),
            el('span', { class: 'repeat-amt', text: fmtEUR(tx.amount) }),
            el('span', { class: 'repeat-count', text: '×' + count })
          ]));
        });
        body.append(el('div', { class: 'field' }, [
          el('label', { text: 'Repeat a frequent one' }), chips
        ]));
      }
    }

    body.append(
      seg, amountWrap, fxLine,
      el('div', { class: 'field' }, [el('label', { text: 'Date' }), date]),
      el('div', { class: 'field' }, [acctLabel, acctChips]),
      toField,
      catField,
      noteField,
      budgetField,
      save
    );
    syncSeg();   // apply per-type field visibility now that fields exist

    if (existing) {
      body.append(
        el('div', { class: 'spacer' }),
        el('button', {
          class: 'btn block danger', text: 'Delete transaction',
          onclick: async () => {
            const snapshot = { ...existing };
            await DB.del('transactions', existing.id);
            await bumpChanges(1);
            api.close();
            toastUndo('Deleted', async () => {
              await DB.put('transactions', snapshot);
              await bumpChanges(1);
              render();
            });
            render();
          }
        })
      );
    } else {
      setTimeout(() => amount.focus(), 320);
    }
  });
}
