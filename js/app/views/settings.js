/* Settings tab. */
'use strict';

/* ======================= Settings ======================= */

/** Collapsible Settings section. Toggling only flips a class (no re-render),
    so the scroll position and any in-section search state survive. */
function settingsSection(key, icon, title, subtitle, build) {
  const open = !!ui.settings.open[key];
  const body = el('div', { class: 'sect-body' + (open ? ' show' : '') });
  const chev = el('span', { class: 'sect-chev', text: open ? '⌄' : '›' });
  const head = el('button', { class: 'sect-head' }, [
    el('span', { class: 'sect-icon', text: icon }),
    el('span', { class: 'sect-main' }, [
      el('span', { class: 'sect-title', text: title }),
      subtitle ? el('span', { class: 'sect-sub', text: subtitle }) : null
    ]),
    chev
  ]);
  head.addEventListener('click', () => {
    const nowOpen = !body.classList.contains('show');
    body.classList.toggle('show', nowOpen);
    chev.textContent = nowOpen ? '⌄' : '›';
    ui.settings.open[key] = nowOpen;
  });
  build(body);
  return el('div', { class: 'card sect' }, [head, body]);
}

function renderSettings() {
  const root = $('#view-settings');
  root.innerHTML = '';
  root.append(el('div', { class: 'view-title' }, [el('h1', { text: 'Settings' })]));

  const bud = DB.state.meta.budget;
  const last = DB.state.meta.lastBackup;
  const reviewN = reviewQueue().length;

  /* ---------- How it works ----------
     The reference a first-run flow can't be: still here in six months when
     someone wonders what a trip budget actually does. First, so it's findable. */
  root.append(settingsSection('help', '\u2753', 'How it works',
    'Budgets, trips, gestures, privacy', (b) => {
      const topic = (title, lines) => {
        b.append(el('h3', { class: 'help-h', text: title }));
        lines.forEach((t) => b.append(el('p', { class: 'help-p muted', text: t })));
      };
      topic('The daily allowance', [
        'A monthly budget can be spread per day. Whatever is left is shared across the ' +
        'days still to come, so underspending today raises tomorrow and overspending ' +
        'lowers it. The big number on Home is what is left for today.',
        'Set one under Monthly budget. "Monthly cap" is the simpler alternative: one flat ' +
        'limit, no daily maths.'
      ]);
      topic('Spending that should not count', [
        'A car repair would flatten the daily figure for weeks, so it can be left out of ' +
        'the allowance while still counting in your balance, Net and every stat. Toggle it ' +
        'on the transaction itself, or set whole categories and note keywords under ' +
        'Monthly budget \u2192 Not daily spending.',
        'When one charge is far bigger than that category usually sees, Home offers to ' +
        'leave it out for you.'
      ]);
      topic('Gestures', [
        'Swipe a transaction right to edit, left to delete \u2014 a short swipe reveals the ' +
        'action, a long one fires it. Deletes can be undone from the toast.',
        'Any bottom sheet can be dragged downwards to dismiss, not just closed by button.'
      ]);
      topic('Trips', [
        'A trip is a named date range. Give it a budget and its spending comes out of that ' +
        'pot instead of your monthly one, with its own daily allowance while you are away.',
        'A trip can carry a foreign currency and a rate you enter yourself: prices are typed ' +
        'in the local currency and shown back in it, while euro stays the stored amount. ' +
        'The app makes no network calls, so it cannot fetch rates for you.'
      ]);
      topic('Importing', [
        'Settings \u2192 Import transactions takes a CSV or JSON export from almost any bank ' +
        'or money app. Columns are detected from their names and their contents, so unnamed ' +
        'or unusual files usually still work \u2014 you confirm before anything is added.',
        'If the file has its own category column, matching names are reused and the rest can ' +
        'be created in one step. Re-importing the same file is safe: duplicates are skipped.'
      ]);
      topic('Private mode', [
        'The eye in the Home header blurs your balances, or every amount if you set level 2 ' +
        'in Settings. Tap a blurred figure to peek at it for a few seconds.',
        'This hides numbers from someone glancing at your screen. It is not encryption.'
      ]);
      topic('Your data', [
        'Everything is stored on this phone and the app never makes a network request. Data ' +
        'leaves only as a file you export yourself.',
        'That also means nobody else has a copy. iOS can clear website storage, so export a ' +
        'JSON backup now and then \u2014 the app will remind you.'
      ]);
      topic('Adding from the Home Screen', [
        'Settings \u2192 Home / Lock Screen quick-add explains how to place a button that ' +
        'opens the app straight into a new transaction.'
      ]);
    }));

  /* ---------- Budget ---------- */
  root.append(settingsSection('budget', '💰', 'Monthly budget',
    bud ? fmtEUR(bud.amount) + ' · ' + (bud.mode === 'daily' ? 'spread per day' : 'monthly cap')
        : 'Not set',
    (b) => {
      b.append(
        el('p', { class: 'muted', style: 'line-height:1.5;margin-bottom:12px', text: bud
          ? 'Your limit is ' + fmtEUR(bud.amount) + ' per month, ' +
            (bud.mode === 'daily'
              ? 'spread across the days left and rebalanced as you spend.'
              : 'as a single cap for the whole month.')
          : 'Set a monthly spending limit, optionally spread across each day and rebalanced automatically.' }),
        el('button', { class: 'btn block primary', text: bud ? 'Edit budget' : 'Set a budget',
          onclick: openBudgetSheet }),
        el('div', { class: 'spacer' }),
        el('button', { class: 'btn block', text: 'Category limits' +
          (Object.keys(catBudgets()).length ? ' (' + Object.keys(catBudgets()).length + ')' : ''),
          onclick: openCategoryBudgetsSheet }),
        el('div', { class: 'spacer' }),
        el('button', { class: 'btn block', text: 'Not daily spending' +
          (budgetSkipCfg().categories.length + budgetSkipCfg().keywords.length
            ? ' (' + (budgetSkipCfg().categories.length + budgetSkipCfg().keywords.length) + ')'
            : ''),
          onclick: openBudgetSkipSheet })
      );
    }));

  /* ---------- Categories (compact grid) ---------- */
  root.append(settingsSection('categories', '🏷', 'Categories',
    DB.state.categories.length + ' total', (b) => {
      const grid = el('div', { class: 'cat-grid' });
      const counts = new Map();
      DB.state.transactions.forEach((t) =>
        counts.set(t.categoryId, (counts.get(t.categoryId) || 0) + 1));
      [...DB.state.categories]
        .sort((a, b2) => (counts.get(b2.id) || 0) - (counts.get(a.id) || 0))
        .forEach((c) => {
          grid.append(el('button', { class: 'cat-cell', onclick: () => openCategorySheet(c) }, [
            el('span', { class: 'cat-cell-icon', text: c.icon,
              style: 'background:' + U.tintOf(c.color) }),
            el('span', { class: 'cat-cell-main' }, [
              el('span', { class: 'cat-cell-name', text: c.name }),
              el('span', { class: 'cat-cell-count', text: (counts.get(c.id) || 0) + ' tx' })
            ])
          ]));
        });
      b.append(grid, el('div', { class: 'spacer' }),
        el('button', { class: 'btn block', text: '+ Add category',
          onclick: () => openCategorySheet(null) }));
    }));

  /* ---------- Rules (searchable, grouped by category) ---------- */
  root.append(settingsSection('rules', '⚡', 'Category rules',
    DB.state.rules.length + ' total', (b) => {
      b.append(el('p', { class: 'muted', style: 'line-height:1.5;margin-bottom:10px', text:
        'When a note or imported description matches, the category is applied automatically.' }));

      const search = el('input', { class: 'searchbox', type: 'search',
        placeholder: 'Search rules or categories…', value: ui.settings.ruleQuery });
      const listWrap = el('div');

      const drawRules = () => {
        const q = ui.settings.ruleQuery.trim().toLowerCase();
        listWrap.innerHTML = '';
        const matches = DB.state.rules.filter((r) => {
          if (!q) return true;
          const cat = DB.category(r.categoryId);
          return (r.keyword || '').toLowerCase().includes(q) ||
            (cat ? cat.name.toLowerCase().includes(q) : false);
        });
        if (!matches.length) {
          listWrap.append(el('div', { class: 'empty', html: DB.state.rules.length
            ? '<span class="big">🔍</span>No rules match'
            : '<span class="big">⚡</span>No rules yet' }));
          return;
        }
        // Group by category, biggest group first
        const groups = new Map();
        matches.forEach((r) => {
          if (!groups.has(r.categoryId)) groups.set(r.categoryId, []);
          groups.get(r.categoryId).push(r);
        });
        [...groups.entries()]
          .sort((a, b2) => b2[1].length - a[1].length)
          .forEach(([catId, rules]) => {
            const cat = DB.category(catId);
            // Searching auto-expands so matches are visible without extra taps.
            const open = !!q || !!ui.settings.ruleGroups[catId];
            const sub = el('div', { class: 'rule-sub' + (open ? ' show' : '') });
            const chev = el('span', { class: 'place-chev', text: open ? '⌄' : '›' });
            const head = el('button', { class: 'rule-group-head' }, [
              el('span', { class: 'cat-cell-icon', text: cat ? cat.icon : '❓',
                style: 'background:' + U.tintOf(cat ? cat.color : 'blue') }),
              el('span', { class: 'rule-group-name', text: cat ? cat.name : 'Unknown category' }),
              el('span', { class: 'rule-group-count', text: String(rules.length) }),
              chev
            ]);
            head.addEventListener('click', () => {
              const nowOpen = !sub.classList.contains('show');
              sub.classList.toggle('show', nowOpen);
              chev.textContent = nowOpen ? '⌄' : '›';
              ui.settings.ruleGroups[catId] = nowOpen;
            });
            rules.forEach((r) => {
              sub.append(el('button', { class: 'rule-row', onclick: () => openRuleSheet(r) }, [
                el('span', { class: 'rule-kw', text: r.keyword }),
                r.regex ? el('span', { class: 'rule-badge', text: 'regex' }) : null,
                el('span', { class: 's-chev', text: '›' })
              ]));
            });
            listWrap.append(el('div', { class: 'rule-group' }, [head, sub]));
          });
      };

      let deb;
      search.addEventListener('input', () => {
        clearTimeout(deb);
        deb = setTimeout(() => { ui.settings.ruleQuery = search.value; drawRules(); }, 120);
      });
      drawRules();
      b.append(search, listWrap, el('div', { class: 'spacer' }),
        el('button', { class: 'btn block', text: '+ Add rule', onclick: () => openRuleSheet(null) }));
    }));

  /* ---------- Import (bank sync + CSV) ---------- */
  root.append(settingsSection('import', '📥', 'Import transactions',
    reviewN > 0 ? reviewN + ' waiting for a category' : 'Wallet · Bank sync · CSV', (b) => {
      const walletAt = DB.state.meta.walletImportedAt;
      b.append(el('div', { class: 'sub-title', text: 'Wallet notifications' }),
        el('p', { class: 'muted', style: 'line-height:1.5;margin-bottom:10px', text:
          'Pick the text file your Wallet notifications are saved to. Only new payments are ' +
          'added — import the same file as often as you like. Each card goes to the account ' +
          'with its name, created the first time a card shows up.' +
          (walletAt ? ' Last import: ' + new Date(walletAt).toLocaleDateString('it-IT',
            { day: 'numeric', month: 'short' }) + '.' : '') }),
        el('button', { class: 'btn block primary', text: 'Import Wallet notifications',
          onclick: importWalletNotifications }),
        el('hr', { class: 'sep' }),
        el('div', { class: 'sub-title', text: 'Statement file' }),
        el('p', { class: 'muted', style: 'line-height:1.5;margin-bottom:10px', text:
          'Paste your bank statement into a text file, convert it with sync/paste_to_sync.py ' +
          '(runs on this phone in a-Shell — see sync/README.md), then import the result here. ' +
          'Re-imports merge — never duplicate.' }),
        el('button', { class: 'btn block', text: 'Import statement file',
          onclick: importBankSync }));
      if (reviewN > 0) {
        b.append(el('div', { class: 'spacer' }),
          el('button', { class: 'btn block', text: 'Review queue (' + reviewN + ')',
            onclick: openReviewSheet }));
      }
      b.append(el('hr', { class: 'sep' }),
        el('div', { class: 'sub-title', text: 'Any bank or app export' }),
        el('button', { class: 'btn block', text: 'Import CSV or JSON', onclick: openCsvWizard }));
      if (DB.state.presets.length) {
        b.append(el('div', { class: 'muted', style: 'margin-top:10px', text: 'Saved presets:' }));
        DB.state.presets.forEach((p) => {
          b.append(el('div', { class: 'set-row' }, [
            el('span', { class: 's-main', text: p.name }),
            el('button', { class: 'btn small ghost', text: 'Delete',
              onclick: async () => { await DB.del('presets', p.id); renderSettings(); } })
          ]));
        });
      }
    }));

  /* ---------- Backup & reminders ---------- */
  const snapAt = DB.state.meta.lastSnapshotAt;
  root.append(settingsSection('backup', '💾', 'Backup & autosave',
    snapAt ? 'Auto-saved ' + new Date(snapAt).toLocaleString('it-IT', {
      day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
      : (last ? 'Last export: ' + new Date(last).toLocaleDateString('it-IT') : 'No backup yet'),
    (b) => {
      /* --- automatic --- */
      b.append(el('div', { class: 'sub-title', text: 'Automatic' }));
      const auto = autosaveCfg();
      const snapToggle = el('input', { type: 'checkbox' });
      snapToggle.checked = auto.snapshots;
      snapToggle.addEventListener('change', async () => {
        await DB.setMeta('autosave', Object.assign({}, auto, { snapshots: snapToggle.checked }));
        ui.settings.open.backup = true;
        if (snapToggle.checked) { lastSnapshotHash = null; await runAutosave('enable'); }
        renderSettings();
      });
      b.append(el('label', { class: 'switch-row' }, [
        el('div', { class: 's-main' }, [
          el('div', { text: 'Auto-save snapshots on this device' }),
          el('div', { class: 's-sub', text:
            'A full copy saved after every change and when you close the app.' })
        ]),
        snapToggle
      ]));
      b.append(el('p', { class: 'muted', style: 'line-height:1.5;margin:6px 0 10px', text:
        snapAt ? 'Last snapshot: ' + new Date(snapAt).toLocaleString('it-IT') +
          ' · keeping the newest ' + SNAPSHOT_KEEP + '.'
          : 'No snapshot yet — one is taken shortly after your next change.' }));
      b.append(el('button', { class: 'btn block', text: 'Restore a snapshot',
        onclick: openSnapshotsSheet }));

      /* --- linked file (desktop browsers only) --- */
      const linked = DB.state.meta.autosaveFile;
      b.append(el('hr', { class: 'sep' }),
        el('div', { class: 'sub-title', text: 'Auto-save to a file' }));
      if (!fsSupported()) {
        b.append(el('p', { class: 'muted', style: 'line-height:1.5', text:
          'Safari (and every browser on iPhone) doesn’t let a web app write to a file on its ' +
          'own, so this only works in Chrome/Brave/Edge on a computer. On iPhone the snapshots ' +
          'above are the automatic layer — plus an occasional exported file for safekeeping.' }));
      } else if (linked) {
        b.append(
          el('p', { class: 'muted', style: 'line-height:1.5;margin-bottom:10px', text:
            'Every change is written to “' + linked.name + '” automatically.' }),
          el('button', { class: 'btn block', text: 'Re-enable after restart',
            onclick: reauthorizeFile }),
          el('div', { class: 'spacer' }),
          el('button', { class: 'btn block ghost', text: 'Unlink file', onclick: unlinkBackupFile })
        );
      } else {
        b.append(
          el('p', { class: 'muted', style: 'line-height:1.5;margin-bottom:10px', text:
            'Pick a file once — the app then overwrites it silently on every change.' }),
          el('button', { class: 'btn block primary', text: 'Link a backup file',
            onclick: linkBackupFile })
        );
      }

      /* --- manual --- */
      b.append(el('hr', { class: 'sep' }),
        el('div', { class: 'sub-title', text: 'Manual' }),
        el('p', { class: 'muted', style: 'margin-bottom:12px;line-height:1.5', text:
          'Snapshots live on this device, so they can’t survive a lost phone or iOS clearing ' +
          'storage. Export a file now and then and keep it somewhere safe.' +
          (last ? ' Last export: ' + new Date(last).toLocaleDateString('it-IT') + '.' : '') }),
        el('button', { class: 'btn block primary', text: 'Export backup', onclick: exportJSON }),
        el('div', { class: 'spacer' }),
        el('button', { class: 'btn block', text: 'Export encrypted', onclick: exportEncrypted }),
        el('div', { class: 'spacer' }),
        el('button', { class: 'btn block', text: 'Import backup', onclick: importJSON }),
        el('p', { class: 'muted', style: 'margin-top:8px;line-height:1.5', text:
          'Encrypted files are safe to keep in iCloud or email — but the password is never ' +
          'stored, so if you forget it the backup is gone for good.' })
      );

      /* --- file naming --- */
      const dated = el('input', { type: 'checkbox' });
      dated.checked = exportNaming() === 'dated';
      dated.addEventListener('change', async () => {
        await DB.setMeta('exportNaming', dated.checked ? 'dated' : 'fixed');
        ui.settings.open.backup = true; render();
      });
      b.append(el('hr', { class: 'sep' }),
        el('div', { class: 'sub-title', text: 'File name' }),
        el('p', { class: 'muted', style: 'line-height:1.5;margin-bottom:10px', text:
          'Exports are called “' + exportName('expense-tracker-backup', 'json') + '”. ' +
          (U.wantsShare()
            ? 'Choose Save to Files and pick the same folder every time — because the name ' +
              'never changes, iOS offers Replace instead of leaving you another copy.'
            : 'Keeping the name fixed means each export overwrites the last one instead of ' +
              'piling up a new file.') }),
        el('label', { class: 'switch-row' }, [
          el('div', { class: 's-main' }, [
            el('div', { text: 'Add the date to the file name' }),
            el('div', { class: 's-sub', text:
              'On: every export is a separate, dated file. Off: one file you keep replacing.' })
          ]),
          dated
        ]),
        el('hr', { class: 'sep' })
      );
      reminderSettingsBody(b);
    }));

  /* ---------- Trips ---------- */
  const ts = tripSettings();
  const tripCount = (DB.state.meta.trips || []).length;
  root.append(settingsSection('trips', '✈️', 'Trips',
    tripCount + (tripCount === 1 ? ' saved' : ' saved'), (b) => {
      const tg = el('input', { type: 'checkbox' });
      tg.checked = ts.excludeFromStats;
      tg.addEventListener('change', async () => {
        await DB.setMeta('tripSettings', Object.assign({}, ts, { excludeFromStats: tg.checked }));
        ui.settings.open.trips = true; render();
      });
      b.append(
        el('label', { class: 'switch-row' }, [
          el('div', { class: 's-main' }, [
            el('div', { text: 'Keep trips out of monthly stats' }),
            el('div', { class: 's-sub', text:
              'Charts and averages ignore trip spending, so a holiday doesn’t skew your baseline.' })
          ]),
          tg
        ]),
        el('p', { class: 'muted', style: 'line-height:1.5;margin-top:10px', text:
          'Confirmed subscriptions charged during a trip always count as normal spending. ' +
          'Give a trip its own budget (in the Trips tab) and its spending also leaves your ' +
          'monthly budget — otherwise the money still comes out of it.' }),
        el('div', { class: 'spacer' }),
        el('button', { class: 'btn block', text: 'Open trips',
          onclick: () => { ui.stats.view = 'trips'; show('stats'); } })
      );
    }));

  /* ---------- Private mode ---------- */
  const pv = privacyCfg();
  root.append(settingsSection('privacy', '👁', 'Private mode',
    pv.on ? (pv.level === 'all' ? 'All amounts hidden' : 'Balances hidden') : 'Off', (b) => {
      b.append(el('p', { class: 'muted', style: 'line-height:1.5;margin-bottom:12px', text:
        'Blurs the figures that reveal how much money you have, so a glance over your ' +
        'shoulder shows nothing. Tap any blurred number to peek at it for a few seconds.' }));

      const onToggle = el('input', { type: 'checkbox' });
      onToggle.checked = pv.on;
      onToggle.addEventListener('change', async () => {
        await setPrivacy({ on: onToggle.checked });
        ui.settings.open.privacy = true; render();
      });
      b.append(el('label', { class: 'switch-row' }, [
        el('div', { class: 's-main' }, [
          el('div', { text: 'Hide amounts' }),
          el('div', { class: 's-sub', text: 'Also toggleable from the eye button on Home.' })
        ]),
        onToggle
      ]));

      const lvl = el('select', {}, [
        el('option', { value: 'balances', text: 'Balances, income and net' }),
        el('option', { value: 'all', text: 'Every amount, including transactions' })
      ]);
      lvl.value = pv.level;
      lvl.addEventListener('change', async () => {
        await setPrivacy({ level: lvl.value });
        ui.settings.open.privacy = true; render();
      });

      const autoToggle = el('input', { type: 'checkbox' });
      autoToggle.checked = pv.auto;
      autoToggle.addEventListener('change', async () => {
        await setPrivacy({ auto: autoToggle.checked });
        ui.settings.open.privacy = true; render();
      });

      b.append(
        el('hr', { class: 'sep' }),
        el('div', { class: 'field' }, [el('label', { text: 'What to hide' }), lvl]),
        el('label', { class: 'switch-row' }, [
          el('div', { class: 's-main' }, [
            el('div', { text: 'Re-hide when I close the app' }),
            el('div', { class: 's-sub', text: 'Turns hiding back on every time you leave.' })
          ]),
          autoToggle
        ]),
        el('p', { class: 'muted', style: 'line-height:1.5;margin-top:10px', text:
          'Your daily allowance stays visible either way — it says nothing about your ' +
          'balance. This hides figures on screen; it is not encryption.' })
      );
    }));

  /* ---------- Quick-add ---------- */
  const stepList = (items) =>
    el('ol', { class: 'howto-steps' }, items.map((t) => el('li', { html: t })));
  root.append(settingsSection('quickadd', '📲', 'Home / Lock Screen quick-add',
    'One-tap “Add expense” button', (b) => {
      b.append(
        el('p', { class: 'muted', style: 'line-height:1.5', text:
          'Opens straight into a new transaction. iOS can’t set this up automatically, so pick the spot you want:' }),
        el('button', { class: 'btn block', style: 'margin-top:12px', text: 'Copy quick-add link',
          onclick: copyAddLink }),
        el('hr', { class: 'sep' }),
        el('div', { class: 'howto' }, [
          el('div', { class: 'howto-title', text: '🏠 Home Screen — no Shortcut needed' }),
          stepList([
            'Copy the link above, then open <strong>Safari</strong> and paste it into the address bar and go.',
            'Tap the <strong>Share</strong> button, then <strong>Add to Home Screen</strong>.',
            'Name it “Add expense” and tap <strong>Add</strong>.'
          ]),
          el('div', { class: 'muted', style: 'line-height:1.5', text:
            'That icon opens the app right on the new-transaction form — and shares the same data as your main icon. (Do this in Safari, not inside the installed app.)' })
        ]),
        el('hr', { class: 'sep' }),
        el('div', { class: 'howto' }, [
          el('div', { class: 'howto-title', text: '🔒 Lock Screen — needs a Shortcut' }),
          stepList([
            'Open the <strong>Shortcuts</strong> app → tap <strong>+</strong> → <strong>Add Action</strong> → search <strong>“Open URLs”</strong>.',
            'Paste the quick-add link into it, then name the shortcut “Add expense”.',
            'Touch and hold your Lock Screen → <strong>Customise</strong> → add a <strong>Shortcuts</strong> widget → pick “Add expense”.'
          ]),
          el('div', { class: 'muted', style: 'line-height:1.5', text:
            'The Lock Screen only accepts widgets, so this one spot needs a Shortcut wrapping the link. A website can’t create the Shortcut for you — this is the one-time manual setup.' })
        ])
      );
    }));

  /* ---------- Danger zone ---------- */
  root.append(settingsSection('danger', '⚠️', 'Danger zone', 'Delete all data', (b) => {
    b.append(el('button', {
      class: 'btn block danger', text: 'Delete all data',
      onclick: async () => {
        const n = DB.state.transactions.length;
        if (!(await confirmSheet(
          `Permanently delete everything on this device (${n} transactions, all accounts, categories and rules)? ` +
          'Automatic snapshots are deleted too, so export a backup first if you might need it.',
          'Delete everything', true))) return;
        if (!(await confirmSheet('Really delete all data? There is no undo.', 'Yes, delete it all', true))) return;
        DB.onWrite = null;          // don't re-snapshot the wiped state
        await DB.wipeAll();
        location.reload();
      }
    }));
  }));

  /* Which build is actually running. Without this there is no way to tell a missing
     feature from a stale cached copy — the question that costs the most time. The
     name comes from the service worker's own cache, so it reflects what is really
     installed rather than what this file claims. */
  const foot = el('p', {
    class: 'muted', style: 'text-align:center;padding:8px 0 20px',
    text: 'Expense Tracker · offline PWA · data stays on your device'
  });
  root.append(foot);
  if (window.caches && caches.keys) {
    caches.keys().then((keys) => {
      const mine = keys.filter((k) => k.startsWith('expense-tracker-v')).sort();
      if (mine.length) foot.textContent += ' · ' + mine[mine.length - 1].replace('expense-tracker-', '');
    }).catch(() => {});
  }
}
