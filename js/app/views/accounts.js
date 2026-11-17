/* Accounts tab: account types, balances, the account and reconcile sheets. */
'use strict';

const ACCOUNT_TYPES = [
  ['checking', 'Checking', '🏦'],
  ['savings', 'Savings', '🐖'],
  ['cash', 'Cash', '💶'],
  ['credit', 'Credit card', '💳']
];
const acctIcon = (type) => (ACCOUNT_TYPES.find(([t]) => t === type) || ACCOUNT_TYPES[0])[2];
const acctLabel = (type) => (ACCOUNT_TYPES.find(([t]) => t === type) || ACCOUNT_TYPES[0])[1];

/* ======================= Accounts ======================= */

function renderAccounts() {
  const root = $('#view-accounts');
  root.innerHTML = '';
  root.append(el('div', { class: 'view-title' }, [
    el('h1', { text: 'Accounts' }),
    el('button', { class: 'btn small', text: '+ Add', onclick: () => openAccountSheet(null) })
  ]));

  const total = DB.totalBalance();
  root.append(el('div', { class: 'tiles' }, [
    el('div', { class: 'tile wide' }, [
      el('div', { class: 't-label', text: 'Combined balance' }),
      el('div', { class: 't-value ' + (total < 0 ? 'neg' : ''), text: fmtEUR(total) })
    ])
  ]));

  if (DB.state.accounts.length === 0) {
    root.append(el('div', { class: 'empty', html: '<span class="big">🏦</span>No accounts yet' }));
    return;
  }
  DB.state.accounts.forEach((a) => {
    const bal = DB.accountBalance(a.id);
    const n = DB.state.transactions.filter((t) => t.accountId === a.id).length;
    root.append(el('button', { class: 'acct-row', onclick: () => openAccountSheet(a) }, [
      el('span', { class: 'a-icon', text: acctIcon(a.type) }),
      el('span', { class: 'a-main' }, [
        el('div', { class: 'a-name', text: a.name }),
        el('div', { class: 'a-type', text: acctLabel(a.type) + ' · ' + n + ' transactions' })
      ]),
      el('span', { class: 'a-bal' + (bal < 0 ? ' neg' : ''), text: fmtEUR(bal) })
    ]));
  });
}

function openAccountSheet(existing) {
  const draft = existing ? { ...existing } :
    { id: null, name: '', type: 'checking', startingBalance: 0 };
  openSheet(existing ? 'Edit account' : 'New account', (body, api) => {
    const name = el('input', { type: 'text', placeholder: 'e.g. Revolut', value: draft.name });
    const type = el('select', {}, ACCOUNT_TYPES.map(([v, l, ic]) =>
      el('option', { value: v, text: ic + ' ' + l })));
    type.value = draft.type;
    const start = el('input', {
      type: 'text', inputmode: 'decimal', placeholder: '0,00',
      value: existing ? String(draft.startingBalance).replace('.', ',') : ''
    });
    body.append(
      el('div', { class: 'field' }, [el('label', { text: 'Name' }), name]),
      el('div', { class: 'field' }, [el('label', { text: 'Type' }), type]),
      el('div', { class: 'field' }, [el('label', { text: 'Starting balance (€)' }), start]),
      el('button', {
        class: 'btn block primary', text: existing ? 'Save changes' : 'Add account',
        onclick: async () => {
          if (!name.value.trim()) return toast('Enter a name');
          draft.name = name.value.trim();
          draft.type = type.value;
          draft.startingBalance = CSV.parseAmount(start.value) || 0;
          await DB.put('accounts', draft);
          api.close(); render();
        }
      })
    );
    if (existing) {
      body.append(
        el('div', { class: 'spacer' }),
        el('button', { class: 'btn block', text: 'Reconcile balance',
          onclick: () => { api.close(); openReconcileSheet(existing); } })
      );
      const n = DB.state.transactions.filter((t) => t.accountId === existing.id).length;
      body.append(
        el('div', { class: 'spacer' }),
        el('button', {
          class: 'btn block danger', text: 'Delete account',
          onclick: async () => {
            const msg = n > 0
              ? `Delete "${existing.name}" and its ${n} transactions? This cannot be undone.`
              : `Delete "${existing.name}"?`;
            if (!(await confirmSheet(msg, 'Delete', true))) return;
            await DB.bulkDel('transactions',
              DB.state.transactions.filter((t) => t.accountId === existing.id).map((t) => t.id));
            await DB.del('accounts', existing.id);
            await bumpChanges(Math.max(1, n));
            api.close(); toast('Account deleted'); render();
          }
        })
      );
    }
  });
}

/** Cash drifts when you don't log every small purchase. Enter what you really
    have and the difference is booked as one adjustment, so the account stops
    lying without you having to remember each coffee. */
function openReconcileSheet(acct) {
  const current = DB.accountBalance(acct.id);
  openSheet('Reconcile ' + acct.name, (body, api) => {
    const actual = el('input', { type: 'text', inputmode: 'decimal',
      placeholder: current.toFixed(2).replace('.', ',') });
    const diffLine = el('p', { class: 'muted', style: 'line-height:1.5;margin:10px 0' });
    const catSel = el('select', {}, orderedCategories().map((c) =>
      el('option', { value: c.id, text: c.icon + ' ' + c.name })));
    const catField = el('div', { class: 'field' },
      [el('label', { text: 'Book the difference as' }), catSel]);

    const update = () => {
      const v = CSV.parseAmount(actual.value);
      if (v == null) { diffLine.textContent = ''; catField.style.display = 'none'; return; }
      const diff = Math.round((current - v) * 100) / 100;
      catField.style.display = diff > 0 ? '' : 'none';
      diffLine.textContent = diff > 0
        ? 'You have ' + fmtEUR(diff) + ' less than recorded — that becomes one expense.'
        : diff < 0
          ? 'You have ' + fmtEUR(-diff) + ' more than recorded — that becomes income.'
          : 'Everything already matches.';
    };
    actual.addEventListener('input', update);

    body.append(
      el('p', { class: 'muted', style: 'line-height:1.5;margin-bottom:12px', text:
        'Recorded balance is ' + fmtEUR(current) + '. Enter what you actually have and ' +
        'the gap (untracked spending) is recorded in one go.' }),
      el('div', { class: 'field' }, [el('label', { text: 'Actual balance (€)' }), actual]),
      diffLine, catField,
      el('button', { class: 'btn block primary', text: 'Adjust', onclick: async () => {
        const v = CSV.parseAmount(actual.value);
        if (v == null) return toast('Enter the actual balance');
        const diff = Math.round((current - v) * 100) / 100;
        if (diff === 0) { api.close(); return toast('Already up to date'); }
        await DB.put('transactions', {
          id: null, date: U.todayISO(), amount: Math.abs(diff),
          type: diff > 0 ? 'expense' : 'income',
          categoryId: diff > 0 ? catSel.value
            : (DB.state.categories.find((c) => c.name === 'Other') || DB.state.categories[0]).id,
          accountId: acct.id,
          note: diff > 0 ? 'Cash spending (reconciled)' : 'Cash adjustment (reconciled)'
        });
        await bumpChanges(1);
        api.close(); toast('Balance reconciled'); render();
      } })
    );
    update();
    setTimeout(() => actual.focus(), 320);
  });
}
