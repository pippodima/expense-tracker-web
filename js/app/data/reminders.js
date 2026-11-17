/* Backup reminders: when one is due, and the reminder popup. */
'use strict';

/* ======================= Backup reminders ======================= */

const REMINDER_DEFAULTS = { enabled: true, days: 7, count: 25 };
let remindedThisSession = false;

function reminderCfg() {
  return Object.assign({}, REMINDER_DEFAULTS, DB.state.meta.backupReminder || {});
}

async function bumpChanges(n) {
  if (!n) return;
  await DB.setMeta('changesSinceBackup', (DB.state.meta.changesSinceBackup || 0) + n);
}

/** Is a backup overdue by the user's time or change-count thresholds? */
function backupDue() {
  const cfg = reminderCfg();
  if (!cfg.enabled || DB.state.transactions.length === 0) return false;
  const now = Date.now();
  if (now < (DB.state.meta.backupSnoozeUntil || 0)) return false;
  const baseline = DB.state.meta.lastBackup || DB.state.meta.installedAt || now;
  const daysSince = (now - baseline) / 86400000;
  const changes = DB.state.meta.changesSinceBackup || 0;
  return daysSince >= cfg.days || (cfg.count > 0 && changes >= cfg.count);
}

/** True whenever there's anything worth backing up (drives the passive banner). */
function hasUnsaved() {
  return DB.state.transactions.length > 0 &&
    ((DB.state.meta.changesSinceBackup || 0) > 0 || !DB.state.meta.lastBackup);
}

function maybeRemindBackup() {
  if (remindedThisSession || !backupDue()) return;
  if (document.querySelector('.sheet')) return;
  remindedThisSession = true;
  // Soft-snooze one day so dismissing doesn't re-pop on the next open today.
  DB.setMeta('backupSnoozeUntil', Date.now() + 86400000);
  setTimeout(openBackupReminder, 500);
}

function openBackupReminder() {
  if (document.querySelector('.sheet')) return;
  const last = DB.state.meta.lastBackup;
  const changes = DB.state.meta.changesSinceBackup || 0;
  const daysSince = last ? Math.floor((Date.now() - last) / 86400000) : null;

  let msg;
  if (!last) {
    msg = 'You haven’t saved a backup yet. Your data lives only on this phone — save a copy so an app or storage reset can never wipe it.';
  } else {
    const bits = [];
    if (daysSince >= 1) bits.push('it’s been ' + daysSince + ' day' + (daysSince === 1 ? '' : 's'));
    if (changes > 0) bits.push(changes + ' change' + (changes === 1 ? '' : 's'));
    const since = bits.length ? bits.join(' and ') + ' since your last backup' : 'time for a fresh backup';
    msg = 'Quick reminder — ' + since + '. Save a new copy so nothing gets lost.';
  }

  openSheet('Back up your data', (body, api) => {
    body.append(
      el('div', { class: 'reminder-hero', text: '💾' }),
      el('p', { class: 'reminder-msg', text: msg }),
      el('button', {
        class: 'btn block primary', text: 'Export backup now',
        onclick: async () => { await exportJSON(); api.close(); }
      }),
      el('div', { class: 'spacer' }),
      el('button', {
        class: 'btn block', text: 'Remind me later',
        onclick: async () => {
          await DB.setMeta('backupSnoozeUntil', Date.now() + 3 * 86400000);
          api.close(); toast('Okay — I’ll remind you in 3 days');
        }
      }),
      el('button', {
        class: 'btn block ghost', text: 'Reminder settings',
        onclick: () => { api.close(); show('settings'); }
      })
    );
  });
}

/** Fills a container with the backup-reminder controls (used inside the
    collapsible Backup section). Keeps the section open across re-renders. */
function reminderSettingsBody(card) {
  const cfg = reminderCfg();
  const save = async (patch) => {
    await DB.setMeta('backupReminder', Object.assign({}, cfg, patch));
    ui.settings.open.backup = true;
    renderSettings();
  };

  card.append(el('div', { class: 'sub-title', text: 'Backup reminders' }));

  // Enable toggle
  const toggle = el('input', { type: 'checkbox' });
  toggle.checked = cfg.enabled;
  toggle.addEventListener('change', () => save({ enabled: toggle.checked }));
  card.append(el('label', { class: 'switch-row' }, [
    el('div', { class: 's-main' }, [
      el('div', { text: 'Remind me to back up' }),
      el('div', { class: 's-sub', text: 'A friendly popup when you open the app and a backup is due.' })
    ]),
    toggle
  ]));

  if (cfg.enabled) {
    // Every N days
    const daysSel = el('select', {}, [[3, 'Every 3 days'], [7, 'Every week'],
      [14, 'Every 2 weeks'], [30, 'Every month']].map(([v, l]) =>
      el('option', { value: String(v), text: l })));
    daysSel.value = String(cfg.days);
    daysSel.addEventListener('change', () => save({ days: Number(daysSel.value) }));

    // After N changes
    const countSel = el('select', {}, [[10, 'After 10 changes'], [25, 'After 25 changes'],
      [50, 'After 50 changes'], [0, 'Ignore change count']].map(([v, l]) =>
      el('option', { value: String(v), text: l })));
    countSel.value = String(cfg.count);
    countSel.addEventListener('change', () => save({ count: Number(countSel.value) }));

    card.append(
      el('hr', { class: 'sep' }),
      el('p', { class: 'muted', style: 'margin-bottom:10px;line-height:1.5',
        text: 'Whichever comes first triggers the reminder.' }),
      el('div', { class: 'field' }, [el('label', { text: 'By time' }), daysSel]),
      el('div', { class: 'field' }, [el('label', { text: 'By activity' }), countSel])
    );

    const changes = DB.state.meta.changesSinceBackup || 0;
    const last = DB.state.meta.lastBackup;
    card.append(el('div', { class: 'muted', style: 'line-height:1.5', text:
      changes + ' change' + (changes === 1 ? '' : 's') + ' since ' +
      (last ? 'your last backup (' + new Date(last).toLocaleDateString('it-IT') + ')' : 'you started') + '.' }));

    card.append(
      el('div', { class: 'spacer' }),
      el('button', { class: 'btn small ghost', text: 'Preview reminder', onclick: openBackupReminder })
    );
  }
}
