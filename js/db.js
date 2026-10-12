/* Storage layer: IndexedDB with a transparent in-memory fallback.
   All data is loaded into DB.state at startup; writes go through put/del. */
'use strict';

const DB = (() => {
  const NAME = 'expense-tracker';
  const VERSION = 2;
  const STORES = ['transactions', 'accounts', 'categories', 'rules', 'presets', 'meta',
    'snapshots'];
  // Loaded into DB.state at startup; 'snapshots' stays on disk (read on demand).
  const STATE_STORES = ['transactions', 'accounts', 'categories', 'rules', 'presets', 'meta'];

  let idb = null;            // IDBDatabase, or null when using the memory fallback
  let memory = null;         // Map<store, Map<id, obj>> fallback
  let onWrite = null;        // optional callback fired after any mutation

  const state = {
    transactions: [],
    accounts: [],
    categories: [],
    rules: [],
    presets: [],
    meta: {}                 // key -> value (lastBackup, ...)
  };

  function openIDB() {
    return new Promise((resolve, reject) => {
      if (!('indexedDB' in window)) return reject(new Error('no indexedDB'));
      const req = indexedDB.open(NAME, VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        for (const s of STORES) {
          if (!db.objectStoreNames.contains(s)) db.createObjectStore(s, { keyPath: 'id' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error('idb open failed'));
      req.onblocked = () => reject(new Error('idb blocked'));
    });
  }

  function idbGetAll(store) {
    return new Promise((resolve, reject) => {
      const tx = idb.transaction(store, 'readonly');
      const req = tx.objectStore(store).getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  }

  function idbWrite(store, fn) {
    return new Promise((resolve, reject) => {
      const tx = idb.transaction(store, 'readwrite');
      fn(tx.objectStore(store));
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async function persistPut(store, objs) {
    if (idb) await idbWrite(store, (os) => objs.forEach((o) => os.put(o)));
    else objs.forEach((o) => memory.get(store).set(o.id, o));
  }

  async function persistDel(store, ids) {
    if (idb) await idbWrite(store, (os) => ids.forEach((id) => os.delete(id)));
    else ids.forEach((id) => memory.get(store).delete(id));
  }

  async function persistClear(store) {
    if (idb) await idbWrite(store, (os) => os.clear());
    else memory.get(store).clear();
  }

  /* ---- Public API ---- */

  async function init() {
    try {
      idb = await openIDB();
    } catch (e) {
      console.warn('IndexedDB unavailable, falling back to in-memory storage:', e);
      idb = null;
      memory = new Map(STORES.map((s) => [s, new Map()]));
    }
    for (const s of STATE_STORES) {
      const rows = idb ? await idbGetAll(s) : [];
      if (s === 'meta') {
        state.meta = {};
        rows.forEach((r) => { state.meta[r.id] = r.value; });
      } else {
        state[s] = rows;
      }
    }
    if (state.categories.length === 0 && state.accounts.length === 0 &&
        state.transactions.length === 0) {
      await seed();
    }
    // Baseline for the "it's been N days" backup reminder.
    if (!state.meta.installedAt) await setMeta('installedAt', Date.now());
    /* Defaults belong in seed() alone, never in a "one-time" block keyed on a meta flag:
       restoring a backup wipes meta, so such a block runs again on the next launch and
       brings back categories and rules the user had deleted. The old `regexRulesSeeded` /
       `starterRulesSeeded` flags may still sit in meta on older installs; nothing reads them. */
    // Best effort: ask the browser not to evict our data.
    if (navigator.storage && navigator.storage.persist) {
      navigator.storage.persist().catch(() => {});
    }
    return !!idb;
  }

  /** Fired after any data mutation, so the app can schedule an auto-snapshot. */
  function notifyWrite() { if (onWrite) { try { onWrite(); } catch (e) { /* non-fatal */ } } }

  async function put(store, obj) {
    if (!obj.id) obj.id = U.uid();
    const list = state[store];
    const i = list.findIndex((o) => o.id === obj.id);
    if (i >= 0) list[i] = obj; else list.push(obj);
    await persistPut(store, [obj]);
    notifyWrite();
    return obj;
  }

  async function bulkPut(store, objs) {
    for (const o of objs) {
      if (!o.id) o.id = U.uid();
      const i = state[store].findIndex((x) => x.id === o.id);
      if (i >= 0) state[store][i] = o; else state[store].push(o);
    }
    await persistPut(store, objs);
    notifyWrite();
  }

  async function del(store, id) {
    state[store] = state[store].filter((o) => o.id !== id);
    await persistDel(store, [id]);
    notifyWrite();
  }

  async function bulkDel(store, ids) {
    const set = new Set(ids);
    state[store] = state[store].filter((o) => !set.has(o.id));
    await persistDel(store, ids);
    notifyWrite();
  }

  async function setMeta(key, value) {
    state.meta[key] = value;
    if (idb) await idbWrite('meta', (os) => os.put({ id: key, value }));
    else memory.get('meta').set(key, { id: key, value });
  }

  /* ---- Snapshots (local auto-backups, kept out of DB.state) ---- */

  async function saveSnapshot(snap) {
    if (idb) await idbWrite('snapshots', (os) => os.put(snap));
    else memory.get('snapshots').set(snap.id, snap);
  }

  async function listSnapshots() {
    const rows = idb ? await idbGetAll('snapshots') : [...memory.get('snapshots').values()];
    return rows.sort((a, b) => b.at - a.at);
  }

  async function deleteSnapshot(id) {
    if (idb) await idbWrite('snapshots', (os) => os.delete(id));
    else memory.get('snapshots').delete(id);
  }

  /** Keep only the newest `keep` snapshots. */
  async function pruneSnapshots(keep) {
    const all = await listSnapshots();
    for (const s of all.slice(keep)) await deleteSnapshot(s.id);
  }

  async function wipeAll(keepSnapshots) {
    for (const s of STORES) {
      if (keepSnapshots && s === 'snapshots') continue;
      await persistClear(s);
    }
    state.transactions = [];
    state.accounts = [];
    state.categories = [];
    state.rules = [];
    state.presets = [];
    state.meta = {};
  }

  /** Replace the entire database with imported backup data.
      Snapshots are kept — restoring a backup shouldn't destroy the safety net. */
  async function replaceAll(data) {
    await wipeAll(true);
    if (Array.isArray(data.accounts)) await bulkPut('accounts', data.accounts);
    if (Array.isArray(data.categories)) await bulkPut('categories', data.categories);
    if (Array.isArray(data.transactions)) await bulkPut('transactions', data.transactions);
    if (Array.isArray(data.rules)) await bulkPut('rules', data.rules);
    if (Array.isArray(data.presets)) await bulkPut('presets', data.presets);
    if (data.meta && typeof data.meta === 'object') {
      for (const [k, v] of Object.entries(data.meta)) await setMeta(k, v);
    }
  }

  async function seed() {
    const cats = [
      { id: U.uid(), name: 'Groceries', icon: '🛒', color: 'green' },
      { id: U.uid(), name: 'Dining', icon: '🍕', color: 'orange' },
      { id: U.uid(), name: 'Transport', icon: '🚌', color: 'blue' },
      { id: U.uid(), name: 'Shopping', icon: '🛍️', color: 'magenta' },
      { id: U.uid(), name: 'Bills', icon: '💡', color: 'yellow' },
      { id: U.uid(), name: 'Health', icon: '💊', color: 'red' },
      { id: U.uid(), name: 'Entertainment', icon: '🎬', color: 'violet' },
      { id: U.uid(), name: 'Salary', icon: '💰', color: 'aqua' },
      { id: U.uid(), name: 'Other', icon: '📦', color: 'blue' }
    ];
    const accounts = [
      { id: U.uid(), name: 'Checking', type: 'checking', startingBalance: 0 },
      { id: U.uid(), name: 'Cash', type: 'cash', startingBalance: 0 }
    ];
    const byName = (n) => cats.find((c) => c.name === n).id;
    /* Common chains and services, nothing tied to one person or city. Rules are read
       back in id order (random), not in this order, so no two of these may match the
       same text. Short or ambiguous words are regexes with word boundaries: plain
       "BAR" would catch BARCLAYS, "ALDI" GARIBALDI, and "ATM" cash withdrawals. */
    const defaults = [
      ['Groceries', 'ESSELUNGA', 'CONAD', 'LIDL', 'CARREFOUR', 'EUROSPIN', 'DESPAR',
        'PENNY MARKET', /\b(ALDI|(UNI)?COOP)\b/],
      ['Dining', /\b(BAR|CAFFE|PIZZERIA|RISTORANTE|TRATTORIA|OSTERIA|SUSHI)\b/, 'MCDONALD',
        'BURGER KING', 'DELIVEROO', 'JUST EAT', 'GLOVO', 'UBER EATS'],
      ['Transport', 'TRENITALIA', 'FLIXBUS', 'RYANAIR', 'EASYJET', 'TELEPASS', /\bITALO/,
        /\bUBER\b(?!.*EATS)/],
      ['Shopping', 'AMAZON', 'ZALANDO', 'IKEA', 'DECATHLON'],
      ['Bills', 'VODAFONE', 'WINDTRE', 'ILIAD', 'FASTWEB', /\b(ENEL|TIM|A2A|HERA|IREN)\b/],
      ['Health', 'FARMACIA', 'PHARMACY'],
      ['Entertainment', 'NETFLIX', 'SPOTIFY', 'DISNEY', 'DAZN', 'CINEMA'],
      ['Salary', 'STIPENDIO']
    ];
    const rules = defaults.flatMap(([cat, ...keys]) => keys.map((k) => (k instanceof RegExp
      ? { id: U.uid(), keyword: k.source, regex: true, categoryId: byName(cat) }
      : { id: U.uid(), keyword: k, categoryId: byName(cat) })));
    await bulkPut('categories', cats);
    await bulkPut('accounts', accounts);
    await bulkPut('rules', rules);
  }

  /* ---- Domain helpers ---- */

  /** Current balance = starting balance ± its transactions. Transfers move money
      between accounts: they leave `accountId` and land in `toAccountId`, and are
      never counted as income or expense anywhere. */
  function accountBalance(accountId) {
    let bal = 0;
    const acct = state.accounts.find((a) => a.id === accountId);
    if (acct) bal = Number(acct.startingBalance) || 0;
    for (const t of state.transactions) {
      if (t.type === 'transfer') {
        if (t.accountId === accountId) bal -= t.amount;
        else if (t.toAccountId === accountId) bal += t.amount;
        continue;
      }
      if (t.accountId !== accountId) continue;
      bal += t.type === 'income' ? t.amount : -t.amount;
    }
    return bal;
  }

  function totalBalance() {
    return state.accounts.reduce((sum, a) => sum + accountBalance(a.id), 0);
  }

  const category = (id) => state.categories.find((c) => c.id === id) || null;
  const account = (id) => state.accounts.find((a) => a.id === id) || null;

  /** First rule matching the text. Rules are case-insensitive substrings by
      default; rules with `regex: true` are tested as regular expressions. */
  function suggestCategory(text) {
    if (!text) return null;
    const up = text.toUpperCase();
    for (const r of state.rules) {
      if (!r.keyword) continue;
      let hit = false;
      if (r.regex) {
        try { hit = new RegExp(r.keyword, 'i').test(text); } catch { hit = false; }
      } else {
        hit = up.includes(r.keyword.toUpperCase());
      }
      if (hit) {
        const cat = category(r.categoryId);
        if (cat) return cat;
      }
    }
    return null;
  }

  /** Normalized duplicate key for import matching: date + amount + description. */
  function dupKey(dateISO, signedAmount, description) {
    return dateISO + '|' + signedAmount.toFixed(2) + '|' +
      String(description || '').trim().toLowerCase().replace(/\s+/g, ' ');
  }

  function existingDupKeys() {
    const set = new Set();
    for (const t of state.transactions) {
      const signed = t.type === 'income' ? t.amount : -t.amount;
      set.add(dupKey(t.date, signed, t.note));
    }
    return set;
  }

  return {
    state, init, put, bulkPut, del, bulkDel, setMeta, wipeAll, replaceAll,
    accountBalance, totalBalance, category, account, suggestCategory,
    dupKey, existingDupKeys,
    saveSnapshot, listSnapshots, deleteSnapshot, pruneSnapshots,
    set onWrite(fn) { onWrite = fn; },
    get usingFallback() { return !idb; }
  };
})();
