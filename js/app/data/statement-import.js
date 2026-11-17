/* Statement file import: Wallet / bank notification logs and bank-sync files. */
'use strict';

/* ======================= Statement file import ======================= */

function importBankSync() {
  pickFile('.json,application/json', (text) => {
    let data;
    try { data = JSON.parse(text); } catch { return toast('Not a valid JSON file'); }
    handleBankSyncData(data);
  });
}

/** The Wallet notification log (see js/wallet.js). The file only grows, so the whole
    thing is re-read every time and the externalId upsert keeps it idempotent. */
function importWalletNotifications() {
  pickFile('.txt,text/plain', (text) => handleWalletText(text));
}

async function handleWalletText(text) {
  const { rows, foreign, broken, ignored, merged } = Wallet.parse(text);
  if (!rows.length) {
    return toast(foreign ? 'Only foreign-currency payments in this file'
      : 'No Wallet payments found in this file');
  }
  const { map, created } = await walletAccountMap(rows);
  const notes = [];
  if (created.length) {
    notes.push('New account' + (created.length === 1 ? ': ' : 's: ') + created.join(', ') +
      ' — created for a card seen for the first time.');
  }
  if (foreign) {
    notes.push(foreign + ' payment' + (foreign === 1 ? '' : 's') +
      ' in another currency skipped — add ' + (foreign === 1 ? 'it' : 'them') + ' by hand.');
  }
  if (broken) notes.push(broken + ' incomplete notification' + (broken === 1 ? '' : 's') + ' ignored.');
  if (ignored) {
    notes.push(ignored + ' notification' + (ignored === 1 ? '' : 's') +
      ' that ' + (ignored === 1 ? "wasn't a payment" : "weren't payments") +
      ' skipped (stamps, passes, payment approval requests…).');
  }
  if (merged) {
    notes.push(merged + ' repeat notification' + (merged === 1 ? '' : 's') +
      ' for a payment already counted (Wallet + bank app) merged into one.');
  }
  await DB.setMeta('walletImportedAt', Date.now());
  await applyBankSync({ kind: 'bank-sync', title: 'Wallet payments imported',
    transactions: rows, summaryNotes: notes }, map);
}

/** Each card title is its own account: the one it was matched to before, else an
    account with the same name (any case), else a new one named after the card.
    Remembered by card, so renaming the account later doesn't spawn a twin. */
async function walletAccountMap(rows) {
  const map = Object.assign({}, DB.state.meta.bankAccountMap || {});
  const created = [];
  let changed = false;
  const cards = new Map(rows.map((r) => [r.accountUuid, r.card]));
  for (const [key, card] of cards) {
    if (map[key] && DB.account(map[key])) continue;
    const want = card.trim().toLowerCase();
    let acct = DB.state.accounts.find((a) => (a.name || '').trim().toLowerCase() === want);
    if (!acct) {
      acct = await DB.put('accounts', { id: null, name: card.trim(), type: 'checking', startingBalance: 0 });
      created.push(acct.name);
    }
    map[key] = acct.id;
    changed = true;
  }
  if (changed) await DB.setMeta('bankAccountMap', map);
  return { map, created };
}

async function handleBankSyncData(data) {
  if (!data || data.kind !== 'bank-sync' || !Array.isArray(data.transactions)) {
    return toast('Not a statement file — create one with sync/paste_to_sync.py');
  }
  const uuids = [...new Set(data.transactions.map((t) => t.accountUuid).filter(Boolean))];
  const map = Object.assign({}, DB.state.meta.bankAccountMap || {});
  const unmapped = uuids.filter((u) => !map[u] || !DB.account(map[u]));
  if (unmapped.length) return openBankMapSheet(unmapped, data, map);
  await applyBankSync(data, map);
}

/** First import from a new bank account: ask which app account it belongs to. */
function openBankMapSheet(unmapped, data, map) {
  openSheet('Match bank accounts', (body, api) => {
    body.append(el('p', { class: 'muted', style: 'margin-bottom:12px;line-height:1.5', text:
      'Pick which account in this app each bank account belongs to. Saved once, reused on every sync.' }));
    const selects = unmapped.map((uuid) => {
      const info = (data.accounts || []).find((a) => a.uuid === uuid) || {};
      const label = info.iban ? '…' + info.iban.slice(-6) : uuid.slice(0, 8) + '…';
      const sel = el('select', {},
        DB.state.accounts.map((a) => el('option', { value: a.id, text: acctIcon(a.type) + ' ' + a.name }))
          .concat([el('option', { value: '__new', text: '➕ Create a new account' })]));
      body.append(el('div', { class: 'field' }, [
        el('label', { text: 'Bank account ' + label }), sel
      ]));
      return { uuid, sel, info };
    });
    body.append(el('button', {
      class: 'btn block primary', text: 'Continue',
      onclick: async () => {
        for (const { uuid, sel, info } of selects) {
          if (sel.value === '__new') {
            const acct = await DB.put('accounts', {
              id: null,
              name: 'buddybank' + (info.iban ? ' …' + info.iban.slice(-4) : ''),
              type: 'checking', startingBalance: 0
            });
            map[uuid] = acct.id;
          } else {
            map[uuid] = sel.value;
          }
        }
        await DB.setMeta('bankAccountMap', map);
        api.close();
        await applyBankSync(data, map);
      }
    }));
  });
}

/** Upsert by externalId (the app-side "unique index"): re-imports are idempotent.
    Rows with no externalId match are also reconciled against existing manual/CSV
    transactions (same date + amount) so a bank sync merges with — instead of
    duplicating — a purchase you already logged by hand. */
async function applyBankSync(data, map) {
  const byExternal = new Map();
  // Manual/CSV transactions (no externalId) indexed by date+signed-amount for adoption.
  const adoptable = new Map();
  DB.state.transactions.forEach((t) => {
    if (t.externalId) { byExternal.set(t.externalId, t); return; }
    if (t.type === 'transfer') return;      // never adopt a transfer as a bank row
    const signed = t.type === 'income' ? t.amount : -t.amount;
    const k = t.date + '|' + signed.toFixed(2);
    if (!adoptable.has(k)) adoptable.set(k, []);
    adoptable.get(k).push(t);
  });
  const uncat = await ensureCategory('Uncategorized', '❓');

  let added = 0, updated = 0, unchanged = 0, skipped = 0, review = 0, merged = 0;
  const toPut = [];
  for (const r of data.transactions) {
    const amount = Math.round(Math.abs(Number(r.amount)) * 100) / 100;
    if (!r.externalId || !r.date || !isFinite(Number(r.amount)) || amount === 0 ||
        !map[r.accountUuid]) { skipped++; continue; }
    const type = Number(r.amount) < 0 ? 'expense' : 'income';
    // A row merged from two notifications is known by either id (see js/wallet.js).
    const ids = [r.externalId].concat(r.altIds || []);
    const existing = ids.map((id) => byExternal.get(id)).find(Boolean);
    if (existing) {
      ids.forEach((id) => byExternal.set(id, existing));
      // Bank data wins for date/amount/type, unless you changed one of those yourself
      // (a late notification's date, say); category/note edits always survive.
      if (!existing.userEdited &&
          (existing.date !== r.date || existing.amount !== amount || existing.type !== type)) {
        toPut.push({ ...existing, date: r.date, amount, type });
        updated++;
      } else unchanged++;
      continue;
    }
    // No externalId match — adopt a matching hand-entered transaction if there is one.
    const signedR = type === 'expense' ? -amount : amount;
    let bucket = adoptable.get(r.date + '|' + signedR.toFixed(2));
    // Foreign-currency entries were converted with your own rate, so the bank's
    // euro amount won't match to the cent — accept a close match for those.
    if (!bucket || !bucket.length) {
      for (const [k, list] of adoptable) {
        if (!list.length || k.slice(0, 10) !== r.date) continue;
        const cand = list.find((t) => t.origCurrency &&
          t.type === type && Math.abs(t.amount - amount) / Math.max(amount, 0.01) < 0.05);
        if (cand) { bucket = [cand]; break; }
      }
    }
    if (bucket && bucket.length) {
      const adopt = bucket.shift();
      // Keep the user's category/note/account; attach the bank id so future syncs
      // update it. For a converted entry the bank's euro amount is the real one.
      const kept = { ...adopt, externalId: r.externalId };
      if (adopt.origCurrency && Math.abs(adopt.amount - amount) > 0.005) {
        kept.amount = amount;
        if (adopt.origAmount) {
          kept.rate = Math.round((amount / adopt.origAmount) * 1e6) / 1e6;
        }
      }
      toPut.push(kept);
      ids.forEach((id) => byExternal.set(id, adopt));
      merged++;
      continue;
    }
    const cat = DB.suggestCategory(r.note || '');
    if (!cat) review++;
    const tx = {
      id: null, externalId: r.externalId, date: r.date, amount, type,
      categoryId: (cat || uncat).id, accountId: map[r.accountUuid], note: r.note || ''
    };
    if (!cat) tx.needsReview = true;
    toPut.push(tx);
    ids.forEach((id) => byExternal.set(id, tx));
    added++;
  }
  if (toPut.length) await DB.bulkPut('transactions', toPut);
  await bumpChanges(added + updated + merged);
  await DB.setMeta('everImported', true);       // ticks the setup checklist

  // Focus the views on the imported data — otherwise Home/Stats sit on the
  // current month and look empty when the history is in other months.
  const dates = data.transactions.map((t) => t.date).filter(Boolean).sort();
  if (dates.length) {
    const [ly, lm] = dates[dates.length - 1].split('-').map(Number);
    ui.period = { type: 'month', y: ly, m0: lm - 1 };
    ui.donutSel = null;
    ui.stats.range = 'all';
    ui.stats.donutSel = null;
  }

  openSheet(data.title || 'Bank sync imported', (body, api) => {
    body.append(el('div', { class: 'import-summary card', html:
      `<span class="ok">${added} new transactions</span><br>` +
      (merged ? `<span class="ok">${merged} merged with entries you already had</span><br>` : '') +
      (updated ? `${updated} updated from the bank<br>` : '') +
      `<span class="dup">${unchanged} already up to date</span><br>` +
      (skipped ? `<span class="dup">${skipped} rows skipped (invalid)</span><br>` : '') +
      (review ? `<strong>${review} need a category</strong> — they’re in the review queue` : 'All categorized by your rules ✓')
    }));
    (data.summaryNotes || []).forEach((n) => body.append(el('p', { class: 'muted',
      style: 'margin:0 0 12px;line-height:1.5', text: n })));
    if (review) {
      body.append(el('button', {
        class: 'btn block primary', text: 'Review them now',
        onclick: () => { api.close(); openReviewSheet(); }
      }), el('div', { class: 'spacer' }));
    }
    body.append(el('button', { class: 'btn block', text: 'Done', onclick: () => { api.close(); render(); } }));
  });
  render();
}
