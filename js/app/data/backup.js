/* JSON backup export / import (merge or replace), CSV export, file picking, and data repair. */
'use strict';

/* ======================= Export / import =======================
   Exports used to always carry the date, which on iPhone means "Save to Files"
   writes a brand-new file every single time and the folder fills up. With a
   fixed name iOS offers to replace the previous one, so there is exactly one
   always-current backup — the version history already lives in snapshots. */

const exportNaming = () => DB.state.meta.exportNaming || 'fixed';
const exportName = (base, ext) =>
  base + (exportNaming() === 'dated' ? '-' + U.todayISO() : '') + '.' + ext;

async function exportJSON() {
  const how = await U.saveFile(exportName('expense-tracker-backup', 'json'),
    JSON.stringify(buildBackupPayload(), null, 2), 'application/json');
  if (how === 'cancelled') return;
  await DB.setMeta('lastBackup', Date.now());
  await DB.setMeta('changesSinceBackup', 0);
  await DB.setMeta('backupSnoozeUntil', 0);
  toast('Backup exported ✓');
  render();
}

function importJSON() {
  pickFile('.json,application/json', async (text) => {
    let data;
    try { data = JSON.parse(text); } catch { return toast('Not a valid JSON file'); }
    // Encrypted backup: ask for the password, then continue as normal.
    if (data && data.app === ENC_MAGIC) {
      const pw = await askPassword('Encrypted backup',
        'This file is password-protected. Enter the password you used when exporting it.',
        'Decrypt', false);
      if (!pw) return;
      try {
        data = JSON.parse(await decryptPayload(data, pw));
      } catch {
        return toast('Wrong password, or the file is damaged');
      }
    }
    // A bank-sync file also has transactions[]+accounts[] but a different shape —
    // route it to the bank importer instead of storing its raw rows as a backup.
    if (data && data.kind === 'bank-sync') {
      toast('That’s a bank sync file — importing it the right way');
      return handleBankSyncData(data);
    }
    if (!data || !Array.isArray(data.transactions) || !Array.isArray(data.accounts)) {
      return toast('Not an Expense Tracker backup');
    }
    openSheet('Import backup', (body, api) => {
      body.append(
        el('p', { class: 'muted', style: 'line-height:1.5;margin-bottom:14px', text:
          `This file has ${data.transactions.length} transactions and ${data.accounts.length} accounts. ` +
          'Combine it with what’s already on this device, or replace everything?' }),
        el('button', {
          class: 'btn block primary', text: 'Merge with current data',
          onclick: async () => {
            api.close();
            const res = await mergeBackup(data);
            await repairData();
            focusLatestData();
            openSheet('Backup merged', (b2, a2) => {
              b2.append(el('div', { class: 'import-summary card', html:
                `<span class="ok">${res.added} new transactions added</span><br>` +
                `<span class="dup">${res.skipped} already present (skipped)</span><br>` +
                (res.newCats ? `${res.newCats} new categories<br>` : '') +
                (res.newAccts ? `${res.newAccts} new accounts<br>` : '') +
                (res.newRules ? `${res.newRules} new rules` : 'No new rules')
              }),
              el('button', { class: 'btn block', text: 'Done', onclick: () => { a2.close(); render(); } }));
            });
            render();
          }
        }),
        el('p', { class: 'muted', style: 'text-align:center;margin:10px 0;font-size:0.8rem', text:
          'Merge keeps both sets, matches categories & accounts by name, and skips duplicate transactions.' }),
        el('hr', { class: 'sep' }),
        el('button', {
          class: 'btn block danger', text: 'Replace everything',
          onclick: async () => {
            api.close();
            if (!(await confirmSheet(
              'Replace ALL data on this device with the backup? Your current data here is lost.',
              'Replace all data', true))) return;
            await DB.replaceAll(data);
            await DB.setMeta('changesSinceBackup', 0);
            await DB.setMeta('installedAt', Date.now());
            await repairData();
            focusLatestData();
            toast('Backup restored'); render();
          }
        })
      );
    });
  });
}

/** Combine a backup into the current data: categories/accounts matched by name,
    rules deduped, transactions deduped by externalId then date+amount+description. */
async function mergeBackup(data) {
  const catRemap = new Map();
  const acctRemap = new Map();
  let newCats = 0, newAccts = 0, newRules = 0;

  for (const c of (data.categories || [])) {
    const hit = DB.state.categories.find((x) => x.name.toLowerCase() === (c.name || '').toLowerCase());
    if (hit) { catRemap.set(c.id, hit.id); continue; }
    const added = await DB.put('categories', { name: c.name, icon: c.icon, color: c.color });
    catRemap.set(c.id, added.id); newCats++;
  }
  for (const a of (data.accounts || [])) {
    const hit = DB.state.accounts.find((x) => x.name.toLowerCase() === (a.name || '').toLowerCase());
    if (hit) { acctRemap.set(a.id, hit.id); continue; }
    const added = await DB.put('accounts',
      { name: a.name, type: a.type, startingBalance: a.startingBalance || 0 });
    acctRemap.set(a.id, added.id); newAccts++;
  }
  for (const r of (data.rules || [])) {
    const dup = DB.state.rules.some((x) =>
      (x.keyword || '').toUpperCase() === (r.keyword || '').toUpperCase() && !!x.regex === !!r.regex);
    if (dup) continue;
    await DB.put('rules', { keyword: r.keyword, regex: r.regex, categoryId: catRemap.get(r.categoryId) || r.categoryId });
    newRules++;
  }
  for (const p of (data.presets || [])) {
    if (DB.state.presets.some((x) => x.name === p.name)) continue;
    await DB.put('presets', { name: p.name, mapping: p.mapping });
  }

  const byExt = new Set(DB.state.transactions.filter((t) => t.externalId).map((t) => t.externalId));
  const dupKeys = DB.existingDupKeys();
  const toAdd = [];
  let added = 0, skipped = 0;
  for (const t of (data.transactions || [])) {
    if (t.externalId && byExt.has(t.externalId)) { skipped++; continue; }
    const signed = t.type === 'income' ? t.amount : -t.amount;
    const key = DB.dupKey(t.date, signed, t.note);
    if (dupKeys.has(key)) { skipped++; continue; }
    toAdd.push({
      externalId: t.externalId, date: t.date, amount: t.amount, type: t.type,
      categoryId: catRemap.get(t.categoryId) || t.categoryId,
      accountId: acctRemap.get(t.accountId) || t.accountId,
      toAccountId: acctRemap.get(t.toAccountId) || t.toAccountId,
      note: t.note || '', needsReview: t.needsReview,
      excludeFromBudget: t.excludeFromBudget, tripId: t.tripId,
      // Rebuilt field by field, so anything omitted here is dropped on merge:
      // without these a merged trip loses the amounts as they were actually paid.
      origAmount: t.origAmount, origCurrency: t.origCurrency, rate: t.rate
    });
    if (t.externalId) byExt.add(t.externalId);
    dupKeys.add(key); added++;
  }
  if (toAdd.length) await DB.bulkPut('transactions', toAdd);

  // Bring settings only where this device has none, remapping account references.
  const m = data.meta || {};
  if (m.budget && !DB.state.meta.budget) await DB.setMeta('budget', m.budget);
  // Settings that name categories have to travel through the same id remap the
  // transactions did, or they end up pointing at categories that don't exist here.
  if (m.categoryBudgets && !DB.state.meta.categoryBudgets) {
    const next = {};
    for (const [catId, limit] of Object.entries(m.categoryBudgets)) {
      next[catRemap.get(catId) || catId] = limit;
    }
    await DB.setMeta('categoryBudgets', next);
  }
  if (m.budgetSkip && !DB.state.meta.budgetSkip) {
    await DB.setMeta('budgetSkip', {
      categories: (m.budgetSkip.categories || []).map((id) => catRemap.get(id) || id),
      keywords: m.budgetSkip.keywords || []
    });
  }
  for (const k of ['trips', 'tripSettings', 'subscriptions', 'blocks', 'withdrawalSettings',
    'exportNaming']) {
    if (m[k] && !DB.state.meta[k]) await DB.setMeta(k, m[k]);
  }
  if (m.bankAccountMap) {
    const map = Object.assign({}, DB.state.meta.bankAccountMap || {});
    for (const [uuid, acctId] of Object.entries(m.bankAccountMap)) {
      if (!map[uuid]) map[uuid] = acctRemap.get(acctId) || acctId;
    }
    await DB.setMeta('bankAccountMap', map);
  }
  await bumpChanges(added);
  return { added, skipped, newCats, newAccts, newRules };
}

function exportCSV(list) {
  if (!list.length) return toast('Nothing to export');
  const rows = [['Date', 'Type', 'Amount', 'Category', 'Account', 'Note']];
  for (const t of list) {
    const [y, m, d] = t.date.split('-');
    const signed = (t.type === 'income' ? t.amount : -t.amount);
    rows.push([
      `${d}/${m}/${y}`, t.type, signed.toFixed(2).replace('.', ','),
      (DB.category(t.categoryId) || {}).name || '',
      (DB.account(t.accountId) || {}).name || '',
      t.note || ''
    ]);
  }
  U.saveFile(exportName('transactions', 'csv'), CSV.serialize(rows, ';'), 'text/csv');
  toast(list.length + ' transactions exported');
}

function copyAddLink() {
  const link = location.origin + location.pathname + '?action=add';
  const done = () => toast('Quick-add link copied');
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(link).then(done, () => prompt('Copy this link:', link));
  } else {
    prompt('Copy this link:', link);
  }
}

function pickFile(accept, onText) {
  const input = el('input', { type: 'file', accept, style: 'display:none' });
  document.body.appendChild(input);
  input.addEventListener('change', () => {
    const f = input.files && input.files[0];
    input.remove();
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => onText(String(reader.result), f.name);
    reader.readAsText(f);
  });
  input.click();
}

/** Repair transactions/accounts that got stored in a raw shape — e.g. a bank-sync
    file imported through the backup importer, which leaves rows with a signed
    `amount`, no `type`, and `accountUuid` instead of a real `accountId`. Idempotent:
    once fixed, nothing matches the broken conditions on later loads. */
async function repairData() {
  if (!DB.state.accounts.length || !DB.state.transactions.length) return 0;

  // Normalize accounts first (bank-sync accounts arrive without type/startingBalance).
  const acctFixes = [];
  for (const a of DB.state.accounts) {
    if (a.type && typeof a.startingBalance === 'number') continue;
    acctFixes.push({ ...a, type: a.type || 'checking',
      startingBalance: typeof a.startingBalance === 'number' ? a.startingBalance : 0 });
  }
  if (acctFixes.length) await DB.bulkPut('accounts', acctFixes);

  const validAcct = new Set(DB.state.accounts.map((a) => a.id));
  // uuid → accountId, from account.uuid (kept on bank-sync accounts) and the saved map.
  const uuidToId = new Map();
  DB.state.accounts.forEach((a) => { if (a.uuid) uuidToId.set(a.uuid, a.id); });
  Object.entries(DB.state.meta.bankAccountMap || {}).forEach(([u, id]) => {
    if (validAcct.has(id)) uuidToId.set(u, id);
  });
  const fallbackAcct = DB.state.accounts[0].id;

  let uncat = null;
  const needUncat = DB.state.transactions.some(
    (t) => !t.categoryId || !DB.category(t.categoryId));
  if (needUncat) uncat = await ensureCategory('Uncategorized', '❓');

  const fixes = [];
  for (const t of DB.state.transactions) {
    const o = { ...t };
    let changed = false;
    if (o.type === 'transfer') {
      // Transfers legitimately have no category; just ensure both ends exist.
      if (!validAcct.has(o.accountId)) { o.accountId = fallbackAcct; changed = true; }
      if (!validAcct.has(o.toAccountId)) {
        const other = DB.state.accounts.find((a) => a.id !== o.accountId);
        o.toAccountId = other ? other.id : fallbackAcct; changed = true;
      }
      if (changed) fixes.push(o);
      continue;
    }
    if (o.type !== 'income' && o.type !== 'expense') {
      o.type = Number(o.amount) < 0 ? 'expense' : 'income'; changed = true;
    }
    if (typeof o.amount === 'number' && o.amount < 0) {
      o.amount = Math.round(Math.abs(o.amount) * 100) / 100; changed = true;
    }
    if (!validAcct.has(o.accountId)) {
      o.accountId = (o.accountUuid && uuidToId.get(o.accountUuid)) || fallbackAcct;
      changed = true;
    }
    if ('accountUuid' in o) { delete o.accountUuid; changed = true; }
    if (!o.categoryId || !DB.category(o.categoryId)) {
      o.categoryId = uncat.id; o.needsReview = true; changed = true;
    }
    if (changed) fixes.push(o);
  }
  if (fixes.length) await DB.bulkPut('transactions', fixes);
  return fixes.length;
}
