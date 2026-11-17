/* Autosave: on-device snapshots, the linked backup file, and restoring a snapshot. */
'use strict';

/* ======================= Autosave (snapshots + linked file) =======================
   Two layers, because no browser lets a web app silently write files on iOS:
   1) Snapshots — a full copy kept inside this device's database after every change
      and whenever the app is hidden/closed. Instant, automatic, restorable in-app.
      Protects against mistakes (bad import, wrong delete); NOT against losing the
      device or iOS clearing storage — that still needs an exported file.
   2) Linked file — where the browser supports the File System Access API
      (desktop Chrome/Brave/Edge), the same file is silently overwritten on every
      change. Unavailable in Safari/iOS, so the UI hides it there. */

const SNAPSHOT_KEEP = 12;
const SNAPSHOT_DEBOUNCE_MS = 15000;
let snapshotTimer = null;
let lastSnapshotHash = null;
let fileHandle = null;          // FileSystemFileHandle when a file is linked

const autosaveCfg = () =>
  Object.assign({ snapshots: true }, DB.state.meta.autosave || {});

const fsSupported = () => typeof window.showSaveFilePicker === 'function';

function hash32(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = ((h << 5) - h + str.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

/** The payload used by manual export, snapshots and the linked file alike. */
function buildBackupPayload() {
  const m = DB.state.meta;
  return {
    app: 'expense-tracker', version: 1, exportedAt: new Date().toISOString(),
    accounts: DB.state.accounts,
    categories: DB.state.categories,
    transactions: DB.state.transactions,
    rules: DB.state.rules,
    presets: DB.state.presets,
    /* Everything the user configured, and nothing about *this device*.
       `lastBackup`, `changesSinceBackup`, `backupSnoozeUntil` and `installedAt`
       are local bookkeeping: carrying them over would tell a restored device it
       had just backed up. Everything else here is work the user did by hand and
       would otherwise be silently lost on a restore or a device transfer. */
    meta: {
      budget: m.budget || null,
      backupReminder: m.backupReminder || null,
      bankAccountMap: m.bankAccountMap || null,
      budgetSkip: m.budgetSkip || null,
      categoryBudgets: m.categoryBudgets || null,
      trips: m.trips || null,
      tripSettings: m.tripSettings || null,
      subscriptions: m.subscriptions || null,
      blocks: m.blocks || null,
      withdrawalSettings: m.withdrawalSettings || null,
      privacy: m.privacy || null,
      exportNaming: m.exportNaming || null
    }
  };
}

function scheduleAutosave() {
  clearTimeout(snapshotTimer);
  snapshotTimer = setTimeout(() => runAutosave('change'), SNAPSHOT_DEBOUNCE_MS);
}

/** Write a snapshot (and the linked file) if the data actually changed. */
async function runAutosave(reason) {
  clearTimeout(snapshotTimer);
  if (!DB.state.transactions.length && !DB.state.accounts.length) return;
  let json;
  try { json = JSON.stringify(buildBackupPayload()); } catch { return; }
  const h = hash32(json);
  if (h === lastSnapshotHash) return;      // nothing changed since the last save
  lastSnapshotHash = h;

  if (autosaveCfg().snapshots) {
    try {
      await DB.saveSnapshot({
        id: 'snap-' + Date.now().toString(36),
        at: Date.now(),
        reason,
        hash: h,
        size: json.length,
        counts: {
          transactions: DB.state.transactions.length,
          accounts: DB.state.accounts.length,
          categories: DB.state.categories.length,
          rules: DB.state.rules.length
        },
        data: json
      });
      await DB.pruneSnapshots(SNAPSHOT_KEEP);
      await DB.setMeta('lastSnapshotAt', Date.now());
    } catch (e) {
      console.warn('snapshot failed', e);
    }
  }
  await writeLinkedFile(json);
}

/* ---- Linked file (File System Access API — desktop Chromium only) ---- */

async function writeLinkedFile(json) {
  if (!fileHandle) return;
  try {
    const perm = await fileHandle.queryPermission({ mode: 'readwrite' });
    if (perm !== 'granted') return;        // needs a user gesture to re-grant
    const w = await fileHandle.createWritable();
    await w.write(json);
    await w.close();
    await DB.setMeta('lastBackup', Date.now());
    await DB.setMeta('changesSinceBackup', 0);
  } catch (e) {
    console.warn('linked-file write failed', e);
  }
}

async function linkBackupFile() {
  if (!fsSupported()) return toast('This browser can’t write files automatically');
  try {
    const handle = await window.showSaveFilePicker({
      suggestedName: 'expense-tracker-backup.json',
      types: [{ description: 'JSON backup', accept: { 'application/json': ['.json'] } }]
    });
    fileHandle = handle;
    await DB.setMeta('autosaveFile', { name: handle.name, linkedAt: Date.now() });
    await DB.setMeta('autosaveFileHandle', handle);   // structured-cloneable in IDB
    lastSnapshotHash = null;                          // force an immediate write
    await runAutosave('link');
    toast('Auto-saving to ' + handle.name);
    renderSettings();
  } catch (e) {
    if (e && e.name !== 'AbortError') toast('Could not link that file');
  }
}

async function unlinkBackupFile() {
  fileHandle = null;
  await DB.setMeta('autosaveFile', null);
  await DB.setMeta('autosaveFileHandle', null);
  toast('Auto-save file unlinked');
  renderSettings();
}

/** Re-attach the stored handle at startup (permission may need a gesture). */
async function restoreFileHandle() {
  const stored = DB.state.meta.autosaveFileHandle;
  if (!stored || !fsSupported()) return;
  fileHandle = stored;
  try {
    const perm = await fileHandle.queryPermission({ mode: 'readwrite' });
    if (perm === 'granted') return;
  } catch { fileHandle = null; }
}

async function reauthorizeFile() {
  const stored = DB.state.meta.autosaveFileHandle;
  if (!stored) return;
  try {
    const perm = await stored.requestPermission({ mode: 'readwrite' });
    if (perm === 'granted') {
      fileHandle = stored;
      lastSnapshotHash = null;
      await runAutosave('reauth');
      toast('Auto-save re-enabled');
      renderSettings();
    } else {
      toast('Permission denied');
    }
  } catch { toast('Could not re-enable auto-save'); }
}

/* ---- Restore ---- */

function openSnapshotsSheet() {
  openSheet('Automatic snapshots', async (body, api) => {
    body.append(el('p', { class: 'muted', style: 'line-height:1.5;margin-bottom:12px', text:
      'Saved automatically on this device after changes and when you close the app. ' +
      'They protect against mistakes — but not against losing the phone, so keep exporting files too.' }));
    const list = el('div');
    body.append(list);
    const draw = async () => {
      const snaps = await DB.listSnapshots();
      list.innerHTML = '';
      if (!snaps.length) {
        list.append(el('div', { class: 'empty', html: '<span class="big">🕘</span>No snapshots yet' }));
        return;
      }
      snaps.forEach((s) => {
        const when = new Date(s.at);
        list.append(el('div', { class: 'snap-row' }, [
          el('div', { class: 'snap-main' }, [
            el('div', { class: 'snap-when', text:
              when.toLocaleDateString('it-IT') + ' ' +
              when.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' }) }),
            el('div', { class: 'snap-sub', text:
              s.counts.transactions + ' transactions · ' + Math.round(s.size / 1024) + ' KB' })
          ]),
          el('button', { class: 'btn small ghost', text: 'Save', onclick: () => {
            U.download('expense-tracker-' +
              new Date(s.at).toISOString().slice(0, 10) + '.json', s.data, 'application/json');
          } }),
          el('button', { class: 'btn small', text: 'Restore', onclick: async () => {
            let data;
            try { data = JSON.parse(s.data); } catch { return toast('Snapshot unreadable'); }
            if (!(await confirmSheet(
              `Restore the snapshot from ${when.toLocaleString('it-IT')}? ` +
              `It replaces the current data (${DB.state.transactions.length} transactions) ` +
              `with ${s.counts.transactions}. A new snapshot of the current state is taken first.`,
              'Restore', true))) return;
            await runAutosave('pre-restore');     // safety net before overwriting
            await DB.replaceAll(data);
            await repairData();
            focusLatestData();
            lastSnapshotHash = null;
            api.close();
            toast('Snapshot restored');
            render();
          } })
        ]));
      });
    };
    await draw();
  }, { tall: true });
}
