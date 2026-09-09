# Expense Tracker — Project Diary & Storyboard

> A living log of what this project **is**, what we've **built**, what we're **building now**,
> and what we **plan to build next**. Read this first to understand the whole picture.
> Newest chapters are added at the bottom of the timeline; the sections above the timeline
> always describe the *current* state.

---

## What this is

A **personal expense tracker** that runs as an installable **Progressive Web App (PWA)**,
built for **iPhone Safari** and the iOS Home Screen. It is deliberately simple in its
philosophy and strict about it:

- **100% client-side.** No backend, no server, no accounts, no authentication, no external
  services, no API keys. Nothing ever leaves the device over the network.
- **Offline-first.** A service worker caches the whole app shell; once loaded it works with
  no connection, including in airplane mode.
- **Your data stays on your phone.** All records live in **IndexedDB** (with an in-memory
  fallback). The only way data leaves is when *you* export a JSON or CSV file.
- **Fast, one-handed, mobile-first.** Large touch targets, bottom-sheet forms, swipe
  gestures, light/dark themes, Italian EUR formatting (`1.234,56 €`).
- **No dependencies, no build step.** Plain HTML + CSS + vanilla JavaScript. Open the folder,
  serve it, done.

If you forget everything else: it's a private, offline, install-to-home-screen money tracker
where the user owns their data as files.

---

## Guiding constraints (the rules we don't break)

1. **The web app makes no network calls.** No third-party scripts, fonts, or CDNs. The one
   allowed bridge to the outside world is the *separate* bank-sync script (`sync/`), which
   the user runs explicitly — on the phone itself — and whose output enters the app only as
   a user-imported file. No secrets ever live in the web app or the repo.
2. No build tooling required — it must run as static files.
3. Everything must degrade gracefully on iOS Safari (the primary target).
4. **Nothing may depend on a Mac/computer.** The whole workflow — including bank sync —
   must be executable on the iPhone alone.
5. Data durability is the user's, via easy JSON backups — because browser storage *can* be
   evicted by iOS. We nudge backups actively.
6. Charts follow the bundled **dataviz** design method (validated colorblind-safe palette,
   surface gaps between marks, legends for multi-series, light/dark aware).

---

## Tech & architecture

Static files, loaded in order by `index.html`:

| File | Responsibility |
|------|----------------|
| `index.html` | App shell, 5-tab nav + floating add button, iOS install meta tags |
| `css/style.css` | All styling: design tokens, light/dark, components, gestures, safe areas |
| `js/util.js` | Formatting (EUR it-IT, dates), ids, the validated color palette, DOM helpers, toast, file download |
| `js/db.js` | Storage layer — IndexedDB with transparent in-memory fallback; domain helpers (balances, category suggestion, duplicate keys) |
| `js/csv.js` | CSV parsing (quotes, auto delimiter), bank date/amount parsing, CSV serialization |
| `js/charts.js` | Hand-built SVG charts: donut, single bars, grouped bars, net line |
| `js/app.js` | Everything else: views, navigation, forms/sheets, budget, stats, CSV import wizard, backup + reminders |
| `sw.js` | Service worker — precache app shell, cache-first, offline fallback |
| `manifest.webmanifest` | PWA manifest (standalone, icons, `?action=add` shortcut) |
| `icons/` | Generated € app icons (180 / 192 / 512) |
| `sync/paste_to_sync.py` | **Statement converter** (not part of the served app's runtime): stdlib-only Python, runs on the iPhone in a-Shell/iSH; pasted statement text → `bank-sync-*.json` |
| `sync/README.md` | Setup + usage docs for the converter; pasted statements and their output are gitignored |
| `tests/` | Zero-dependency Node suite: `run.js` (syntax → scope-check → unit tests) plus `*.test.js` |
| `README.md`, `LICENSE` | Public-facing description of the project; MIT |

There is **no framework**. State lives in `DB.state` (the source of truth, mirrored to
IndexedDB) plus a small `ui` object in `app.js` for view/filter state. The service worker
cache is versioned (`expense-tracker-v5` at time of writing) and bumped on every release so
installed copies pick up changes.

### Data model (every record has a stable unique `id`)

- **Transaction** — `id, date, amount, type (income|expense), categoryId, accountId, note`
- **Account** — `id, name, type (checking|savings|cash|credit), startingBalance`; current
  balance is *computed* from its transactions.
- **Category** — `id, name, icon (emoji), color (palette key)`
- **Rule** — `id, keyword, categoryId` (keyword → auto-suggested category)
- **Preset** — `id, name, mapping` (reusable bank CSV column mapping)
- **Meta** — key/value store: `lastBackup`, `changesSinceBackup`, `installedAt`,
  `budget`, `backupReminder`, `backupSnoozeUntil`, …

---

## Current state — what works today

**Navigation:** 5 tabs — **Home · Stats · Activity · Accounts · Settings** — with a floating
round **+** button for adding a transaction from anywhere.

**Home:** combined balance, a passive backup nudge (when there's anything unsaved), month
navigation, this-month Net/Income/Expenses tiles, the budget card, and a compact
"Top spending" list. Deliberately minimal.

**Add / edit transaction:** a bottom sheet with an income/expense toggle, a big numeric
amount field (comma decimals), date, quick account & category chips, and a note field that
**auto-suggests a category** from keyword rules as you type.

**Transaction rows:** **swipe right → Edit, swipe left → Delete** (short swipe reveals the
action, long swipe fires it); tap to edit.

**Sheets:** every bottom sheet can be **dragged down to dismiss**, not just closed by button.

**Accounts:** multiple accounts, each with its own computed balance, plus a combined total.

**Budget:** an optional monthly limit in two modes —
- **Spread per day (redistributing):** whatever budget is left is shared evenly across the
  days *remaining* in the month. Underspend today and every remaining day (incl. tomorrow)
  grows by `leftover ÷ days-left`; overspend and they shrink. The card shows **"Left to
  spend today"**, a **Tomorrow** preview with a ▲/▼-vs-base hint, and the monthly meter.
- **Monthly cap:** one flat limit for the month.

**Stats:** a dedicated analytics page with a **Month / Year / All / Custom** timeframe
selector (auto day/month/year bucketing). Shows summary tiles (In / Out / Net / Avg per day),
**Income vs Expenses** grouped bars, a **Net over time** line (with zero baseline for negative
months), and a tappable **Spending by category** donut.

**CSV import:** file picker → column-mapping step (auto-detects Italian/English headers),
supports single signed-amount *and* separate debit/credit layouts, DD/MM/YYYY parsing,
sign inversion, **duplicate detection** on re-import (date + amount + description), and
**saveable per-bank mapping presets**. A preview confirms new vs skipped rows and how many
were auto-categorized.

**Merging on import (all sources combine, never blindly overwrite):**
- *Bank sync* upserts by `externalId`; rows with no match are also reconciled against existing
  **manual/CSV** transactions by date+amount and *adopted* (the bank id attaches to the entry
  you already logged, keeping your category/note) instead of creating a duplicate.
- *CSV* skips date+amount+description duplicates.
- *JSON backup* import offers **Merge** or **Replace**. Merge matches categories & accounts by
  name (remapping ids so nothing duplicates), dedupes rules, and adds only transactions not
  already present (by `externalId`, then date+amount+description) — the way to combine two
  devices without losing either side's data.

**Backups & reminders:** JSON export/import (full backup / device transfer) and filtered CSV
export. A **change counter** tracks edits since the last backup; a smart trigger
(`N days` **or** `N changes`, whichever first, with snooze) shows a **friendly reminder
popup** on app open when a backup is due. Configurable in Settings (on/off, interval, change
threshold, live status, preview). Plus a "delete all data" action with double confirmation.

**Home / Lock Screen quick-add:** a `?action=add` deep link opens the app straight into a new
transaction. Settings explains the two setup paths clearly: **Home Screen** (add the link to
the Home Screen directly — no Shortcut) and **Lock Screen** (a one-time Shortcut wrapping the
link, since the Lock Screen only accepts widgets).

**Statement import (buddybank / UniCredit, phone-only):** `sync/paste_to_sync.py` runs **on the
iPhone** in the free a-Shell (or iSH) terminal app — no Mac, no server, no API, no keys. You
copy the transaction list out of the bank app, paste it into a text file, and the script turns
it into `bank-sync-YYYY-MM-DD.json`; the app imports it under Settings → Import transactions →
**Import statement file**. Every row carries a stable `externalId`, so the import
**upserts** — re-importing the same file is idempotent, manual entries (no externalId) are
untouched, and a bank row matching a manual entry by date+amount is *adopted* rather than
duplicated. Unmatched descriptions land in **Uncategorized** and a **review queue** (Home
banner + Settings), where assigning a category can also create a rule (substring or **regex**)
that immediately sweeps the rest of the queue. (The earlier GoCardless PSD2 API path was
removed in Chapter 21 — this converter is the workflow actually in use.)

---

## Known limitations (and why)

- **No live iOS widget.** A Home/Lock Screen widget that displays the daily total requires a
  native WidgetKit app (Xcode/Swift). A PWA cannot publish one. Our answer is the deep-link
  quick-add button instead.
- **No background/push notifications.** Firing a notification while the app is *closed* needs
  a server + push subscription. Offline & serverless by design, so backup reminders appear
  **when you open the app**, not before.
- **Browser storage can be evicted.** iOS may clear website storage under storage pressure, on
  "clear Safari data", or if the app is deleted. Mitigations: request persistent storage,
  install to Home Screen (own container), and nag JSON backups. This is *the* reason backups
  are a first-class feature.
- **A website can't auto-create an iOS Shortcut.** The Lock Screen setup is therefore a manual
  (but ~20-second) step.

---

## How to run & deploy

**Local:**
```bash
cd expense-tracker-web
python3 -m http.server 8123
# open http://localhost:8123  (or http://<mac-ip>:8123 on the phone, same Wi-Fi)
```
Must be served over http(s) — opening `index.html` as a `file://` won't register the service
worker.

**Install on iPhone (needs HTTPS):** host the folder on any static HTTPS host (e.g. GitHub
Pages), open it in Safari, let it load once, then Share → **Add to Home Screen**. It launches
full-screen and works offline thereafter.

---

## Roadmap / ideas on the table (not yet built)

These have been discussed or are natural next steps — nothing here is committed yet:

- A small **native companion app** purely to provide the real Home/Lock Screen widget with the
  live daily total (the one thing a PWA genuinely can't do).
- Recurring / scheduled transactions (subscriptions, salary).
- Search & filters on the Stats page; export the current Stats view.
- Multi-currency (currently EUR-only).
- Per-category budgets (in addition to the overall monthly budget).
- Transfer-between-accounts as a first-class transaction type.
- Optional passcode / Face ID gate (client-side only).

---

## Timeline — the storyboard

Dated chapters, oldest first. Each entry says **what we set out to do** and **what shipped**.

### Chapter 1 — The first build (2026-07-22)
Goal: stand up the whole app from scratch, meeting the full brief in one pass.
Shipped:
- Vanilla PWA skeleton: `index.html`, `manifest.webmanifest`, `sw.js`, generated € icons,
  iOS meta tags, standalone full-screen.
- IndexedDB storage layer with in-memory fallback; the full data model + seed data
  (default categories, accounts, and Italian keyword rules like ESSELUNGA → Groceries).
- Add/edit/delete transactions; multiple accounts + combined balance; EUR it-IT formatting.
- Categories with emoji + color; keyword rules auto-suggesting categories.
- CSV import with column mapping, single & debit/credit layouts, DD/MM/YYYY, duplicate
  detection, saveable bank presets.
- Dashboard (donut + bars), searchable/filterable/sortable transaction list.
- JSON export/import, filtered CSV export, delete-all, and a backup nudge banner.
- Charts built to the dataviz method; palette validated for light & dark.

### Chapter 2 — Gestures, budget v1, and the widget reality (2026-07-22)
After confirming the base app ran on localhost. Goal: make it feel native and add a budget.
Shipped:
- **Swipe** on transaction rows: right → Edit, left → Delete.
- **Drag-down-to-close** on all bottom sheets.
- `?action=add` **deep link** into the new-transaction form.
- First **monthly budget** (a rolling daily allowance).
- Honest finding documented: a live iOS **widget is native-only**; delivered the deep-link +
  Shortcut path as the web-possible alternative.

### Chapter 3 — Budget redesign + a cleaner app + the Stats page (2026-07-22)
Goal: fix the budget model to the user's exact mental model, make the UI more minimal, and
add real analytics.
Shipped:
- **Budget redistribution model:** today's allowance = unspent budget ÷ days remaining; every
  remaining day (incl. **tomorrow's preview**) grows/shrinks as you under/overspend. Verified
  against the user's €10/day example (skip a day → tomorrow ≈ €10.34).
- **UI overhaul:** 5 even tabs + a floating corner **+**; Home trimmed to a glanceable
  overview; softer cards, more whitespace, uppercase section labels.
- **New Stats tab:** Month/Year/All/Custom timeframes with auto bucketing; summary tiles;
  Income-vs-Expenses grouped bars; Net-over-time line; category donut. Added `groupedBars`
  and `line` chart types.

### Chapter 4 — Backup reminders that actually nudge (2026-07-22)
Goal: proactively get the user to back up, easy and non-annoying.
Shipped:
- A **changes-since-backup** counter wired into every transaction write, reset on export.
- `backupDue()` trigger: **N days OR N changes**, whichever first, with snooze (verified with
  a 9-case logic test).
- A **friendly reminder popup** (Export now / Remind me later / Reminder settings) on app open,
  plus a passive Home banner whenever there's anything unsaved.
- Configurable in Settings (enable, interval, change threshold, live status, live preview).
- Documented that true background notifications need a server and aren't possible offline.

### Chapter 5 — Persistence answers + clearer quick-add instructions (2026-07-22 → 2026-07-23)
Goal: answer the user's real questions and fix the guidance they'd actually follow.
Shipped:
- Clarified data durability (auto-saved to IndexedDB, survives close/reboot; the eviction
  caveats and why backups matter).
- Clarified that a website **cannot** auto-create an iOS Shortcut, and that the **Home Screen**
  quick-add needs **no Shortcut at all** (add the link directly) — only the **Lock Screen**
  needs one.
- Rewrote the Settings **quick-add** card into two clear numbered walkthroughs (Home Screen
  vs Lock Screen).

### Chapter 6 — Version control + this diary (2026-07-23)
Goal: put the project under git and start keeping this living diary/storyboard.
Shipped:
- Initialized a git repository with a `.gitignore` (ignores `.DS_Store`, logs, and any
  exported personal backup/CSV files so real data never gets committed).
- Created **this document** as the project's description, storyboard, and running log — to be
  updated as we reach each new goal.

### Chapter 7 — Automatic bank import, phone-only (2026-07-23)
Goal: automatic import of buddybank (UniCredit) transactions via GoCardless Bank Account
Data (free PSD2 tier) — with the added requirement, arriving mid-build, that **nothing may
depend on a Mac**: the whole flow must run on the iPhone.
Key findings that shaped the design:
- GoCardless **blocks browser CORS** (verified empirically: no `Access-Control-Allow-Origin`
  on preflight or response) → the PWA cannot call the API directly, ever.
- Secrets can't ship in a public static site → they live in a gitignored `.env` next to the
  script, never in app code.
- A Node CLI was built first, then **replaced with stdlib-only Python** so the tool runs
  on-device in the free a-Shell/iSH terminal apps → the Mac dependency disappeared.
Shipped:
- `sync/bank_sync.py` — link / sync / status, `--dry-run`, `--force`; token cache + refresh;
  4-calls/day rate-limit guard; pending-transaction skip; expired-consent (EUA) detection;
  sandbox-first config (`SANDBOXFINANCE_SFIN0000`) switchable to the real bank via `.env`.
- App-side import with account-UUID → app-account mapping (saved), **upsert by
  `externalId`** (idempotent re-imports; manual entries untouched; category edits preserved).
- **Regex-capable rules** (backwards-compatible with keyword rules; validated in the editor;
  seeded `ANTHROPIC` → Software) and a **review queue** for unmatched imports where assigning
  a category can teach a new rule that sweeps the remaining queue.
- **Consent-expiry warnings** in-app (7 days out and after expiry) fed by the sync file's
  agreement metadata; JSON backups now also carry budget/bank/reminder settings.
- Tests: Python mapping vs real API shapes (5/5), consent-error detection (4/4), upsert
  simulation (6/6) — plus syntax checks on everything.

### Chapter 8 — Paste-to-import + safe testing (2026-07-23)
Goal: try the app with a real-looking history without any bank/API, and answer "can a
notification auto-update the app?" (no — serverless/offline; data only enters via import).
Shipped:
- `sync/paste_to_sync.py` — converts a copy-pasted buddybank statement (merchant / payment
  type / amount lines under Italian date headers) into a `bank-sync-*.json` the app imports
  through the normal Bank sync path (mapping, upsert-by-externalId, rules, review queue).
  A genuine no-GoCardless way to load history. Same-day duplicates get stable unique ids.
- Verified on a 119-transaction sample (handles `1.234,56`-style thousands, `+`/`-` signs,
  multi-line entries); `.gitignore` now also excludes `test.txt`/`*.paste.txt` so pasted
  statements and generated sync files never get committed.

### Chapter 9 — Make imported history visible + bulk categorize (2026-07-23)
Goal: after importing months-old history, Home/Stats looked empty (they default to the
current month; Activity has no date filter, so only it showed the data). Clarified this
isn't a category problem — the Net/Income/Expense tiles don't depend on categories.
Shipped:
- On bank-sync import, the app now **jumps Home to the latest imported month** and sets
  **Stats to "All"**, so the data is visible immediately instead of hidden behind the
  current-month filter. (Re-importing the same file re-triggers the jump.)
- **"Apply existing rules to all"** button in the review queue: re-runs the rules over every
  uncategorized transaction in one tap (for after you've added rules in Settings).

### Chapter 10 — Starter rules + retroactive rule apply (2026-07-23)
Goal: seed categorization rules for the user's common merchants, and answer "does changing a
rule affect past transactions?" (previously no — rules only hit imports and the review queue).
Shipped:
- One-time `starterRulesSeeded` migration: adds a **University food** category and ~30 keyword
  rules (MENSA/CIR/ITACA → University food, CAMINITOS/PIZZERIA/SUMUP → Dining, UNICOOP/PAM →
  Groceries, AUTOLINEE/FLIX/ITABUS → Transport, ILIAD/APPLE.COM → Bills, MICROSOFT/CLAUDE →
  Software, PHARMACIE/SERENIS → Health, …). Ordered so university-specific rules beat the
  generic "BAR". Simulated coverage on the 119-tx sample: **87 auto-categorized (73%)**.
- **Retroactive rule apply**: saving or editing a rule now offers to apply it to matching
  *past* transactions (confirm dialog, shows the count and target category). So a rule change
  can update history — answering the user's question with a real capability. `bumpChanges`
  keeps the backup reminder honest.

### Chapter 11 — Merge on import (combine, don't overwrite) (2026-07-26)
Goal: let imports *merge* with existing data instead of replacing or duplicating — prompted by
the two-device situation (rules/data on the Mac, not the iPhone) and by bank sync duplicating
hand-entered purchases.
Shipped:
- **JSON backup import now offers Merge or Replace.** Merge matches categories & accounts by
  name (remapping their ids so nothing duplicates), dedupes rules by keyword+regex, and adds
  only transactions not already present (by `externalId`, then date+amount+description).
  Settings (budget/bank map/consent) fill only where the device has none. This is how two
  devices combine without either losing data.
- **Bank sync adopts matching manual/CSV entries:** when a bank row has no `externalId` match
  it looks for an existing hand-entered transaction with the same date+amount and attaches the
  bank id to it (keeping the user's category/note) rather than duplicating. Summary now reports
  "merged with entries you already had".
- Tests: bank adopt-merge + backup name-remap/dedup (10/10).

### Chapter 12 — Open onto the month that has data (2026-07-26)
Goal: after importing, Home/Stats still showed 0 € because they default to the *current* month
(the device's real clock), while the data sits in other months — and the earlier import-time
jump was lost on reload and never ran for the backup-merge path.
Shipped:
- `focusLatestData()`: on app load (and after a backup merge/replace), if the current month has
  no transactions but data exists elsewhere, Home and Stats open on the **most recent month that
  has data** instead of an empty current month. No-op when the current month already has data.
- Verified the decision logic (3/3). This is a durable fix (runs every boot), unlike the
  transient per-import jump.

### Chapter 13 — Root-cause the empty Home/Stats/Accounts + self-heal (2026-07-26)
Goal: Home/Stats/Accounts all showed 0 € while Activity was full. Got the user's exported
backup (`test.json`) and inspected it instead of guessing further.
Root cause: the `bank-sync-*.json` file had been imported through **Settings → Import backup
(JSON)** instead of **Bank sync → Import bank sync file**. The backup importer accepts anything
with `transactions[]`+`accounts[]`, so it stored the *raw bank rows* directly — every
transaction ended up with a signed `amount`, **no `type`**, and **`accountUuid` instead of
`accountId`**. Result: income/expense summed to 0 (no type) and no transaction matched any
account (bad id). Dates were fine, so Activity (unfiltered) still listed everything.
Shipped:
- `repairData()` on every boot (and after backup merge/replace): normalizes accounts (missing
  type/startingBalance) and heals transactions — derive `type` from the amount sign, make
  `amount` positive, relink `accountUuid`→`accountId` via the account's kept `uuid` (or the
  saved bank map, or the first account), drop `accountUuid`, and send category-less rows to the
  review queue. Idempotent. Verified on the real file: 119 typed, 119 relinked (buddybank
  balance €0 → €2 821,41), all three months populate.
- Guard: **Import backup now detects a `kind:"bank-sync"` file and routes it to the bank
  importer** instead of storing raw rows; refactored the bank-sync handler so both entry points
  share it.

### Chapter 14 — Tappable Top-spending rows → filtered list / review (2026-07-26)
Goal: make Home's Top-spending categories actionable.
Shipped:
- Each Top-spending row is now a button. Tapping a normal category opens the **Activity list
  filtered to that category for the current period**, where the existing sort control reorders
  by date/amount/etc. Tapping **Uncategorized** opens the **review queue** (same as the Home
  Review button), so it's reachable from the Top-spending list too.
- `reviewQueue()` broadened to include any transaction in the Uncategorized category (not only
  `needsReview`), so the review section and its count cover everything uncategorized.

### Chapter 15 — Category detail as a dismissable summary sheet (2026-07-26)
Goal: the tab-jump had no back button and clearing its filters wasn't immediate; replace it
with a light, self-contained popup.
Shipped:
- Tapping a Top-spending category now opens a **bottom sheet** (drag-down/close to dismiss)
  summarizing that category for the current period: big total, transaction count, % of the
  month's spending, Average/Biggest tiles, a **By date / By amount** sort toggle, and the list
  (each row taps through to edit). An **"Open in Activity ›"** button hands off to the full
  filtered tab for anyone who wants deeper filtering. Uncategorized still opens the review queue.
- Cleaner formatting for the Top-spending rows (name truncates, value stays put) and the new
  detail sheet.

### Chapter 16 — Network-first SW + category-sheet polish (2026-07-26)
Goal: the phone kept showing stale CSS (new JS, old styles) — the recurring "reload to get vN"
problem — plus polish the category detail sheet.
Root cause of the stale styles: cache-first service worker + iOS standalone PWAs clinging to
cached files, so `style.css` didn't refresh while JS did.
Shipped:
- **Service worker switched to network-first** for same-origin requests (fetch fresh, update
  cache, fall back to cache offline). When online the device always gets the latest CSS/JS;
  offline still works. Ends the manual "bump-and-pray" cache dance going forward.
- **"Biggest" tile is now tappable** → opens that specific (largest) transaction.
- **Category detail sheet opens tall** (88dvh via a `tall` openSheet option) so it isn't a
  half-screen popup; `sheet-body` now flexes/scrolls to fill. Added `.tile-btn` for the
  clickable tile.
Note: the transaction-row layout in the sheet was correct in CSS all along — it only looked
"poor" because the phone was rendering it unstyled from the stale cache; network-first fixes
that. One forced update (fully close & reopen the app, or re-add to Home Screen) is needed to
land the new SW; after that updates are automatic.

### Chapter 17 — All categories in Stats + group by place (2026-07-27)
Goal: Home shows only the top 5 categories; Stats should list **all** of them for the period,
and opening a category should let you see spending grouped **per merchant** (e.g. total at Zara
this month).
Shipped:
- **Stats → "All categories"** card: every category with spending in the selected period
  (Month/Year/All/Custom), sorted, with bar + % share; tapping opens the same category detail
  sheet, now parameterized by range so it reports the Stats period rather than Home's month.
- **"By place" view** in the category sheet (segment is now Date / Amount / By place): groups
  transactions by merchant with total + count; tap a group to expand its transactions.
- `merchantKey()` brand normalization: strips payment-processor prefixes (`PAYPAL *`,
  `SumUp *`, `NYX*`…), drops noise tokens, then keys on the brand word — a *generic* first word
  (BAR, MENSA, PIZZERIA, LAVANDERIA…) keeps two words so "BAR SCARPACCIA" ≠ "BAR CAFFE", while
  everything else groups on the brand alone so `ZARA MILANO 4471` = `ZARA` and
  `ESSELUNGA CANOVA` = `ESSELUNGA NOVOLI`. Verified 18/18 cases against the real statement
  descriptions (64 distinct descriptions → 58 merchant groups).

<!-- When we finish new work, add the next "Chapter N — title (date)" entry here, and update
     the "Current state" / "Roadmap" sections above to match. -->

### Chapter 18 — Settings reorganized: collapsible, searchable, grouped (2026-07-28)
Goal: Settings had become one long scroll — 11 categories and 43 rules listed inline, with no
way to find anything.
Shipped:
- **Collapsible sections** (`settingsSection()`): Budget · Categories · Rules · Import ·
  Backup & reminders · Quick-add · Danger zone. Each header shows an icon, title and a live
  summary (budget amount, category/rule counts, last backup date, items awaiting review), so
  the whole page fits on one screen and you open only what you need. Toggling flips a CSS class
  rather than re-rendering, so scroll position and in-section state survive.
- **Rules are searchable and grouped by category**: a search box filters by keyword *or*
  category name, results group under collapsible category headers with counts (43 rules → 10
  groups), and searching auto-expands matches. Regex rules carry a `regex` badge.
- **Categories as a compact 2-column grid** with usage counts, sorted by most-used, instead of
  a long one-per-row list.
- Consolidation: bank sync + CSV merged into one **Import** section; backup + reminders merged
  into one section (`reminderSettingsCard()` → `reminderSettingsBody()`).

<!-- When we finish new work, add the next "Chapter N — title (date)" entry here, and update
     the "Current state" / "Roadmap" sections above to match. -->

### Chapter 19 — Automatic backups: snapshots + linked file (2026-07-28)
Goal: "save a backup automatically on every change / when I close the app, overwriting the same
file" — so nothing has to be saved by hand.
Platform reality: **no browser on iPhone can silently write to a file** (no File System Access
API in Safari; downloads need a user gesture and create a new file each time), and iOS has no
reliable "app closing" hook. So the request is only partly satisfiable — implemented as two
layers, with the limits stated plainly in the UI:
- **Snapshots (works everywhere, fully automatic).** A complete copy of the data is written to
  a new `snapshots` IndexedDB store (schema v2) after every change (15 s debounce) and on
  `visibilitychange`/`pagehide` — i.e. when the app is backgrounded or closed. Deduped by a
  32-bit hash so identical states aren't stored twice; newest 12 kept. `DB.onWrite` hook fires
  on every mutation. Restorable in-app (Settings → Backup & autosave → Restore a snapshot),
  each snapshot also exportable as a file; a pre-restore snapshot is taken before overwriting.
- **Linked file (desktop Chromium only).** With the File System Access API, pick a file once
  and every change silently overwrites *that same file* — exactly the requested behaviour where
  the platform allows it. Handle persisted in IDB, permission re-grant button after restarts.
  On iOS/Safari the section explains why it's unavailable instead of hiding the truth.
- `wipeAll(keepSnapshots)`: restoring a backup keeps the snapshot safety net; Danger-zone delete
  clears snapshots too (and says so).
Note: snapshots protect against mistakes (bad import, wrong delete), **not** against a lost
phone or iOS clearing storage — the UI keeps pushing exported files for that.

### Chapter 20 — Insight features: heatmap, places, subscriptions, trips, comparison, security (2026-07-28)
Goal: a batch of "smart" features the user picked from a brainstorm. Decisions taken with them:
views live behind a **switcher inside Stats** (not a 6th tab), trips are **auto-suggested but
confirmed**, the app lock is **opt-in**, and the build order was left to me
(infrastructure → visual views → money features → trips/comparison → security).
Shipped:
- **Stats switcher**: Overview / Calendar / Places / Trips. `renderStats()` split into
  `statsOverview` + the new views.
- **Calendar heatmap**: month grid shaded by daily spend (single-hue sequential ramp per the
  dataviz method), over-allowance days outlined, today outlined; tap a day for its
  transactions; no-spend-days and busiest-day tiles.
- **Places**: searchable merchant ranking built on `merchantKey()`, per-merchant sheet with
  period *and* lifetime totals, average and biggest charge.
- **Subscription radar** — the user's worry was false positives, so nothing is ever applied
  automatically: a candidate needs ≥3 charges at ~monthly spacing (25–35 day median gap) with
  stable amounts, or exactly 2 charges when the amount is identical to the cent (short-history
  case). Suggestions are confirm/dismiss; dismissals stick. Confirmed subs give a monthly
  total, next-due estimate, **price-change** and **"possibly cancelled"** alerts. On the real
  data it finds Iliad, Apple, Serenis, Microsoft (€70,98/month) and nothing spurious.
- **Trips**: detects bursts of unfamiliar merchants (≥3 charges over 2–14 days, ≥60% of places
  unseen in the prior 120 days) and offers to save them; manual create/edit too. Per-trip
  totals, per-day average, by-place breakdown.
- **Comparison card** in Overview: this period vs the previous equivalent, with the five
  biggest category movers.
- **Smart rule suggestions** in the review queue: clusters the uncategorized by place and
  bulk-assigns a whole merchant in one step, optionally teaching the rule.
- **Encrypted backups**: AES-GCM + PBKDF2-SHA256 (250k iterations) via WebCrypto; import
  detects the format and asks for the password. Verified: ciphertext hides content, round-trip
  exact, wrong password rejected.
- **App lock (opt-in)**: WebAuthn/Face ID gate with "every open / after 5 min / after 30 min".
  Documented honestly in-UI: it gates the interface, it does *not* encrypt the database.
  Requires HTTPS, so it activates once the app is hosted.

### Chapter 21 — Fix the calendar layout; drop app lock and the GoCardless API (2026-07-28)
Goal: the calendar rendered badly (screenshot: last column clipped, legend and tiles drawn on
top of the grid, uncentered on desktop), and the user asked to remove the two features that
can't work today.
Root cause of the layout bug: grid items default to `min-width: auto`, so `repeat(7, 1fr)`
let cell content push the columns past the card — and `aspect-ratio` on stretched grid items
made the browser mis-measure the grid's height, so siblings overlapped it. The horizontal
overflow was also what threw off centering on desktop.
Shipped:
- `repeat(7, minmax(0, 1fr))` + a fixed `grid-auto-rows: 46px` instead of `aspect-ratio`;
  cells get `min-width: 0` and `overflow: hidden`; legend separated by a hairline. Verified
  arithmetically: on a 390 px iPhone the grid is exactly 322 px wide (42.6 px cells, 46 px
  tall) — fits with no clipping and keeps a ≥40 px tap target. Slightly taller rows ≥480 px.
- **Removed the app lock** (WebAuthn engine, Privacy section, lock screen, CSS): it needs
  HTTPS, so it was dead weight on a locally-served app.
- **Removed the GoCardless API integration**: deleted `sync/bank_sync.py` and
  `sync/.env.example`, dropped PSD2 consent storage, the Home expiry banner and the Settings
  consent status; rewrote `sync/README.md` around the converter only. **Kept**
  `sync/paste_to_sync.py` and the file import (renamed "Import statement file"), since that is
  the workflow actually in use — it never touched the API.
- Encrypted backups stay (they work offline everywhere).

### Chapter 22 — Transfers, minimalism pass, undo, repeat, category limits, search (2026-07-30)
Goal: a batch chosen from a design critique — fix the transfer correctness gap, strip the UI
back, remove daily friction, and add per-category budgets + global search.
Shipped (three commits):
1. **Account transfers** (correctness, not a nicety): moving money between accounts previously
   had to be logged as an expense *and* an income, inflating both totals and distorting Net.
   New `transfer` type with `accountId` → `toAccountId`: `accountBalance()` debits one and
   credits the other, and transfers are excluded from income/expense/net, category views,
   budgets, all stats, subscriptions, trips, day totals and bank-sync adoption. Shown with ⇄
   and "From → To". Verified 7/7 balance/aggregation cases.
   **Undo replaces confirm dialogs** for deletes (`U.toastAction`), and the add sheet offers
   **one-tap repeat chips** of your most frequent recent charges (undoable).
2. **Minimalism pass.** Stats' two stacked segmented controls became one row — `‹ period pill ›`
   opening a range picker (4 permanent buttons removed). Home leads with **one hero number**
   (today's allowance when a daily budget exists, else month net) with income/expense as a
   quiet line; the 3 stat tiles are gone and the budget card no longer repeats today's figure.
   Stats' donut + category list merged into a single card — the separate legend and duplicate
   "All categories" card said the same thing twice. Tab bar and FAB now use **monochrome inline
   SVG** line icons instead of emoji, and 17 button labels were tightened.
3. **Per-category budgets** (`meta.categoryBudgets`): optional monthly limit per category, set
   in Settings → Budget → Category limits, with spend/limit meter in the category detail sheet.
   **Global search** from the Home header: one field across notes, places (merchant-normalized,
   so "unicoop" finds all branches), category and account names, *and* amounts ("2,80"), with
   category and place shortcuts. Verified against the real data.

### Chapter 23 — Private mode (2026-07-30)
Goal: hide the figures that expose you to someone glancing at the screen — explicitly *not*
the daily allowance, which reveals nothing about your balance.
What counts as sensitive (the design decision): **wealth**, not activity. Level 1 "Balances"
masks the combined total, per-account balances, the month's net/income/expense line, stats
tiles and period-comparison deltas. Level 2 "All amounts" additionally masks every individual
figure (transactions, category totals, places, trips, calendar day amounts). The
"left to spend today" figure is never masked at either level.
Shipped:
- `meta.privacy = { on, level, auto }`; masking is done purely with CSS on existing class
  names (`body.privacy` / `body.privacy-all` + a `sens` class on the hero only when it shows
  Net), so no render call sites had to change.
- Eye toggle in the Home header, plus a **Private mode** section in Settings (on/off, level,
  and "re-hide when I close the app" which flips it back on at `visibilitychange`).
- **Tap to peek**: tapping a blurred summary figure reveals it for 4 s; figures inside buttons
  are excluded so the tap can't also trigger that row's action.
- Stated in-UI: this hides numbers on screen, it is not encryption.
Also documented: **Trips** are a *report*, not a filter — trip spending still counts toward
monthly totals. An "exclude trips from monthly stats" option remains open.

### Chapter 24 — Trip budgets, category order, universal importer (2026-07-30)
Decisions taken with the user: only **confirmed subscriptions** are exempt from trip
exclusion; trips get an **optional budget** (their idea, better than a global toggle);
categories order **recent-first then frequency**; the importer is **generic auto-detect**.
Shipped:
- **Trip accounting.** `tripSettings.excludeFromStats` (default on) keeps trip spending out of
  monthly charts, tiles, top-spending and comparisons. Separately, a trip with its own
  `budget` spends from that pot instead of the monthly budget, with its own remaining and
  daily allowance (Home shows a card while you're on the trip); an *unbudgeted* trip still
  draws on the monthly budget. Confirmed subscriptions charged mid-trip always count as
  normal in both. Income and transfers are never reclassified. Verified 12/12 edge cases.
- **Category order**: last 4 picks first (`meta.recentCategories`), then by usage, applied to
  every category picker.
- **Universal importer** (`js/detect.js`). Combines header-name matching in several languages
  with *content sniffing* (how many values parse as dates/numbers, text length, cardinality),
  so it works when headers are unknown, unhelpful or absent. Handles: preamble junk above the
  header, missing header row, `,`/`;`/tab/`|`, EU vs US decimals, debit/credit pairs, ISO
  datetimes, textual months, 2-digit years, parenthesised negatives, currency symbols, and
  **JSON** exports (records found even when nested under a wrapper key). DD/MM vs MM/DD is
  inferred from values >12 and **flagged as ambiguous** when every date fits both, with a
  format selector in the confirmation step. Verified end-to-end on six formats: Italian bank
  with preamble + debit/credit, Revolut-style, US bank, headerless CSV, nested app JSON, TSV
  with Italian month names — 6/6.
  A bug found by those tests: single-decimal values like `-21.7` were read as EU thousands
  (→ -217); the decimal heuristic now treats "exactly three digits after the separator" as
  grouping and anything else as a decimal point.

### Chapter 25 — Import: unsigned amount + direction column (2026-07-30)
The user asked what happens when a file has a positive-only amount column plus a separate
expense/income column. Answer at the time: **it broke** — direction came only from the sign,
so every row would have imported as income.
Shipped a third import mode, "Amount + type":
- `Detect.detectDirectionColumn()` finds a low-cardinality column (≤6 labels) whose values
  read as directions in ≥80% of rows, scoring higher when both directions appear; it will not
  fire on a Category column.
- `Detect.classifyDirection()` understands Uscita/Entrata, Expense/Income, Debit/Credit,
  Addebito/Accredito, Withdrawal/Deposit, D/C, +/− and Spanish/German equivalents.
- The confirmation step lists **each distinct label with an Expense/Income toggle**, so any
  wording (even untranslated or bank-specific) can be mapped by hand; the mapping is saved
  with the bank preset for next time.
- Verified 3/3 end-to-end (Italian Uscita/Entrata, English Expense/Income, D/C letters) plus
  13 classification cases and a no-false-positive check against a Category column.

### Chapter 26 — Cash withdrawals + foreign-currency trips (2026-07-31)
Two features the user proposed; both were analysed for trade-offs first, then built to their
choices ("sometimes/roughly" cash tracking, confirm-in-preview detection, one editable rate
per trip, foreign currency only inside trips).
**Cash withdrawals.** Before: a withdrawal imported as a plain expense, so withdrawing €100
and later logging €30 of cash purchases counted €130 spent. Now the importer flags likely
withdrawals and offers to book them as **transfers to a cash account** (reusing the transfer
type), with a per-row opt-out and the choice remembered.
Detection is deliberately conservative: a withdrawal word must be present (prelievo, bancomat,
withdrawal, retrait, abhebung…), and **bare "ATM" never matches** — the user's own data has an
`ATM ` → Transport rule because ATM is Milan's transport operator. Verified 11 cases including
those false positives.
Because cash spending is only logged "roughly", accounts also gained **Reconcile balance**:
enter what you actually have and the gap is booked as a single adjustment, so a cash account
can't drift forever.
**Foreign-currency trips.** A trip can carry a `currency` + `rate` (€ per unit). While inside
that trip the add sheet takes the amount in the local currency with a live "≈ €" preview and a
one-tap switch back to euro. **EUR stays canonical** (`amount`), with `origAmount`/
`origCurrency`/`rate` kept alongside, so every existing budget/stat calculation is untouched.
Editing the trip's rate later offers to **recompute** that trip's converted amounts.
Honest limit stated in-app: rates are entered by hand — the app makes no network calls, so it
cannot fetch live rates.
The duplicate risk flagged during analysis proved real (manual €29,50 vs bank €29,68), so
bank-sync adoption now accepts a **close match (<5%) for converted entries** and takes the
bank's euro figure as authoritative, back-calculating the true rate. Verified 15 cases across
both features.

### Chapter 27 — Fix: exchange rates parsed as money (2026-07-31)
Bug reported from real use: setting a Turkish Lira rate of `0.018` made 100 TL show as
thousands of euro. Cause — the rate field used the *money* parser, which reads three digits
after a separator as thousands grouping (`1.234` = 1234, correct for money), so `0.018`
became **18**: a 1000× error.
Shipped:
- `U.parseRate()`: for rates both `.` and `,` are decimal points and there is no thousands
  grouping, so `0.018` stays 0,018 and `1.234` stays 1,234. Verified 8 cases.
- Rate entry now has a **direction toggle** — `1 € = ? TL` or `1 TL = ? €` — because for weak
  currencies the first reads straight off an exchange board (1 € = 38 TL) while the inverse
  needs four decimals. Switching direction converts the value in place; the canonical stored
  rate is always € per unit, so nothing downstream changed. The hint previews both ways
  ("100 TL ≈ 2,63 € · 10 € ≈ 380 TL").

### Chapter 28 — Fix: add-transaction sheet rendered only the repeat chips (2026-07-31)
Reported: tapping + showed only "Repeat a frequent one" and nothing else.
Cause — my own bad edit in Chapter 26. The foreign-currency block was inserted by matching
the first `amount-wrap` in the file, which belongs to **`openBudgetSheet`**, not
`openTxSheet`. So the budget sheet held code referencing `existing`/`fx` (undefined there),
while the transaction sheet appended an `fxLine` that didn't exist in its scope — a
ReferenceError mid-build, leaving only the fields appended before it.
Note: `node --check` passes on this happily, since it's a scope error, not a syntax error.
Shipped:
- Moved the whole fx block into `openTxSheet` and restored `openBudgetSheet`'s plain amount
  field.
- Added a **scope check** to the verification routine: extract each sheet function and confirm
  every fx/field identifier it uses is declared inside it. That is the check that would have
  caught this, and it now passes for both functions.

### Chapter 29 — Trip budgets speak the local currency (2026-07-31)
Request: the trip daily budget should show what's left in the local currency, not just euro —
while abroad you compare prices locally, not in converted euro.
Shipped: `fmtTripMoney()` / `fmtTripBoth()` helpers, applied everywhere a trip figure appears.
On the Home trip card the **local amount is now the headline** ("449,92 TRY left for today")
with the euro underneath ("≈ 11,84 € · 5 days left"); the meter line, trip detail header,
budget meter, remaining/today's allowance, and the trip list rows all show local with euro
alongside. Trips without a currency are unchanged (plain euro), since the helpers fall back.

### Chapter 30 — Trends: how spending moves across months (2026-08-01)
Request: more graphs — especially how categories vary month to month — plus a view on what
else is worth plotting. Overview answers *where did this month go*; nothing answered *is that
normal*, which is the question that actually changes behaviour. So Stats gained a fifth tab,
**Trends**, entirely month-over-month with a 6 / 12 / 24-month window.

Six cards, each earning its place:
- **Categories over time** — stacked bars, top 6 categories + Other. Tapping a legend chip
  isolates one category as plain bars with a caption comparing this month against its own
  average ("Shopping · 244,14 € this month vs 102,88 € average (+137%)").
- **What changed** — each category's latest month against the mean of the *3 preceding*
  months, not just the previous one, so a single odd month doesn't read as a trend. Sparkline
  per row; tap opens that category's month.
- **Pace this month** — cumulative day-by-day curves for this month vs last (plus the budget
  as a straight diagonal). The only chart that answers "am I running hotter *at this point*
  in the month"; the current curve stops at today rather than flat-lining into the future.
- **Fixed vs one-off** — confirmed subscriptions against everything else. Hides itself until
  at least one subscription is confirmed, rather than showing an all-blue chart.
- **Savings rate** — share of income kept per month; hidden unless ≥2 months have income.
- **Weekday rhythm** — average spend per weekday, counting every elapsed day so quiet days
  pull the average down honestly.

New chart primitives in `charts.js`: `stackedBars` (2px surface gaps, only the top segment
rounded), `multiLine` (shared axis, dashed comparison series, partial series allowed so a
half-finished month simply stops), and `sparkline` for list rows.

Verified by extracting the real `statsTrends`/`trendMonths` from `app.js` and running them
against a fake DOM with a 14-month synthetic dataset — all rAF callbacks forced so every
chart actually draws. 27 checks across three window lengths, category isolation, an empty
window, and single-month data (no previous month to compare against): all pass, no NaN and
no `undefined` in any rendered text.

### Chapter 31 — One backup file instead of twenty (2026-08-01)
Reported: every export writes a new file because the name carries the date, so the folder
fills up. Two causes, both fixed:
- **The name.** Backups are now `expense-tracker-backup.json`, fixed. Version history already
  lives in device snapshots, so dating the file bought nothing. A Settings toggle ("Add the
  date to the file name") restores the old behaviour for anyone who wants separate copies.
- **The mechanism.** A plain `<a download>` on iPhone lands in Safari's Downloads folder and
  silently numbers duplicates — a fixed name alone wouldn't have helped. New `U.saveFile()`
  routes through the **Web Share sheet** on touch devices without `showSaveFilePicker`, where
  "Save to Files" into the same folder offers **Replace**. Desktop keeps the plain download.
  Cancelling the sheet no longer counts as a completed backup (`lastBackup` stays put) and no
  longer double-saves; a lost user gesture (e.g. after the encryption password prompt) falls
  back to the download path.
Verified with a util.js harness across five environments — desktop Chrome, macOS Safari,
iPhone, cancelled sheet, lost gesture — plus name-rule checks. 17/17 pass.

### Chapter 32 — A new month shouldn't look like a broken app (2026-08-03)
Reported: August started and the Stats overview shows nothing but zeros. Zeros can mean four
completely different things and the app rendered them identically, so the honest fix was to
make the empty state say *which* it is:
- **Nothing recorded yet** — offers a one-tap jump to the most recent month that has data.
- **It's all trip spending** — names the trip and the hidden total ("65,00 € across 2
  transactions belong to Istanbul"), then offers *See the trip* or *Count trips in stats
  instead*. This one was genuinely invisible before: trip exclusion is deliberate, but a
  silent deliberate exclusion is indistinguishable from a bug.
- **Only transfers** — money moved between your own accounts, which is never income or
  expense; links to those movements in Activity.
- **Empty app** — invites the first transaction instead of showing an error-shaped screen.
The trigger changed from `txs.length === 0` to `income === 0 && expense === 0`, which is what
"looks empty" actually means — a month of nothing but transfers used to slip past it and show
a wall of zero tiles.

Also fixed a real month-boundary bug found while looking: `now` was captured once at load, but
a home-screen PWA sits **suspended for days rather than reloading**. Resume it after the 1st
and Home/Stats were still on last month while labelling it "this month". `refreshToday()` now
runs on resume and rolls both forward — but only if they were still following the current
month, never if you had deliberately navigated elsewhere, and never for a custom range or
all-time.

Verified by running the real `statsEmptyNote`, the trip-exclusion helpers and `refreshToday`
against a fake DOM: 23 checks over all four empty causes (including a confirmed subscription
during a trip, which must *not* be reported as hidden trip spending), the buttons' actual
side-effects, and four rollover cases. All pass.

### Chapter 33 — The daily budget that couldn't move (2026-08-03)
Reported: adding an expense for a past day doesn't update the daily budget — noticed while
travelling. I reproduced it before touching anything, running the real `budgetStatus` and
`tripBudgetStatus` against pinned dates. The redistribution maths turned out to be correct in
every scenario, which made the actual defect a UI one:

**While a budgeted trip is running, Home's hero shows the *monthly* allowance — the one number
trip spending can never touch.**
```
after adding 100 € dated yesterday, mid-trip:
  monthly (the hero): 20,69 €  →  20,69 €     unmoved, by design
  trip (a card below): 50,00 €  →  37,50 €     correct all along
```
So the headline was frozen no matter what you entered. The trip now takes the hero whenever
one is active and budgeted (in its local currency, euro beneath), and the trip card below
collapses to a "Today 12,50 € / 37,50 €" line instead of repeating it — the same treatment
`budgetCard` already gets when the hero shows today.

**A second, genuine hole found while testing:** expenses dated *after* today counted in the
month total but in neither `spentBefore` nor `spentToday`, so a rent booked ahead inflated
every remaining day's allowance until the day it arrived. Both budgets now reserve it
(`committedAhead`), and the trip card names it ("160,00 € already booked on later days").

**And the reason it read as "not updated" even when it did move:** 50 € added to a past day
changes today by 50/29 = 1,72 €, because that is what spreading an overspend over the days
left *means*. The budget card now spells it out:
`▼ 0,39 € vs the 19,35 € base — 50,00 € spent earlier, spread over the 29 days left.`

**Tests now live in the repo** (`node tests/run.js`) instead of a scratchpad that gets wiped:
syntax, a **scope check** over 23 render/money functions (the Chapter 28 class of bug, which
`node --check` accepts happily), and 12 budget scenarios covering back-dating, forward-dating,
trips with and without their own pot, month boundaries, monthly mode, and a parked past month.

### Chapter 34 — A trip gets its own stats page (2026-08-03)
Request: opening a trip only listed the places you spent at — it wanted the same plots the
month gets in Stats. A trip *is* a period, so it now gets the same treatment, drawn in the
trip's own currency because that's what you were reading off price tags.

Three cards inside the trip sheet:
- **Day by day** — one bar per trip day, with the even-spend line drawn across when the trip
  has a budget ("daily pace"). Tapping a bar opens that day's transactions, which meant giving
  `Charts.bars` an `onBar` callback and an optional `refLine`/`refLabel`.
- **Where it went** — donut plus the full tappable category list with percentages, each row
  scoped to the trip's dates rather than the month.
- **Pace** — cumulative spend against a straight even-spend line, ending with a verdict
  ("1,75 TRY behind an even spend by day 8"). An unfinished trip stops the line at today
  instead of flat-lining into the future. Hidden entirely when the trip has no budget.

The Places list is no longer inert — rows open the merchant detail, and totals moved to the
local currency like everything else.

The charts use the **same expense set as the budget meter directly above them** (excluding
confirmed subscriptions), so the numbers agree; when that set differs from the header total,
a line at the bottom says exactly how much was left out and why.

`tests/trip-charts.test.js` renders the real `tripCharts` against a fake DOM with every rAF
forced: 20 checks over a finished foreign-currency trip, an active one (pace must stop at
today), a trip with no budget, an empty trip, and a one-day trip whose axis is degenerate.

### Chapter 35 — Move the blocks where you want them (2026-08-03)
Request: let the cards be reordered — in Trends, and generally. Rather than bolt drag-and-drop
onto three render functions, every stacked card became a **block** with a stable key, and each
view declares its catalogue in one place:

```
BLOCKS = {
  dashboard:        trip · budget · top
  'stats-overview': tiles · compare · inout · net · categories
  'stats-trends':   mix · movers · pace · fixed · savings · weekday
}
```

`renderBlocks(root, viewKey, builders)` walks the user's order and calls each builder, which
returns a node **or null** when the block doesn't apply right now (no active trip, no budget,
no income to compute a savings rate from). A null keeps its place in the order instead of
losing it, and a hidden block is never built at all — so hiding a chart you never look at also
skips its work.

Order and visibility live in `meta.blocks`, so they survive a reinstall and ride along inside
backups. Two details that matter over time: a key that no longer exists is dropped, and a
block added by a later app update is slotted in at its **default position** rather than dumped
at the bottom, so a new card shows up where it belongs.

The ⇅ button in the Home and Stats headers opens an **Arrange** sheet. In Stats it acts on
whichever sub-view you're on. Each row has a drag handle, up/down arrows, and an eye to hide.
The arrows exist because they always work; the drag is the nice path.

The drag deliberately rebuilds nothing mid-gesture — the other rows slide out of the way with
transforms and the array is spliced only on release — so the pointer never loses its target,
which is what makes it survive a finger on a small screen. `touch-action: none` on the handle
alone means the page still scrolls normally everywhere else.

`tests/blocks.test.js`: 22 checks over the order maths (saved order, dropped keys, duplicates,
newly-added blocks), the render pass (hidden never built, null skipped), the sheet's arrows and
eye writing to meta, and the drag itself — dragging down two slots, to the top, a one-slot
nudge, a wobble that must change nothing, a yank past the end that clamps, and a single row
that must not crash.

### Chapter 36 — A front door for the repo (2026-09-03)
Request: make the repository understandable to someone who lands on it cold — a description, a
README, a licence, "everything to make it look good".

Until now the only description of this project was *this diary*: 875 lines, oldest-first,
written for us. It's the right artefact for remembering **why**, and the wrong one for a
stranger deciding in ten seconds whether the project is interesting. So the diary keeps its
job and a `README.md` takes the other one.

Shipped:
- **`README.md`** — the pitch first (private, offline, no server, data as files), then why it
  exists, the feature set grouped by daily use / money model / stats / import / privacy, a
  quick start (`python3 -m http.server`, plus the GitHub Pages → Safari → Add to Home Screen
  path), the file-by-file structure table, how to run the tests and what each of the three
  layers catches, the known limitations *with their reasons*, and contributing notes that lead
  with the constraints — because on this project the constraints are the product, and a PR that
  adds a dependency or a network call is the likeliest way to break it.
- **`LICENSE`** — MIT, 2026. Badges in the README for licence, CI, no-dependencies, no-build,
  PWA.
- **`.github/workflows/tests.yml`** — checkout, Node 20, `node tests/run.js`. Nothing to
  install, so CI is six lines of real work; the badge is honest because the suite is the same
  command we run locally.
- **GitHub metadata** — repo description and ten topics (`pwa`, `offline-first`,
  `vanilla-javascript`, `indexeddb`, `privacy`, `ios`, …), so the repo is findable and its
  About box says something.

Also corrected here: the sections above the timeline still described `sync/bank_sync.py` and the
GoCardless PSD2 flow in the architecture table and in "Current state" — both deleted back in
Chapter 21. Writing a README that had to be *accurate* is what surfaced it, which is an argument
for the README beyond politeness to strangers.

Left alone deliberately: `convert.py` at the repo root, an untracked near-copy of
`sync/paste_to_sync.py` minus its docstring. It's either a scratch edit or a newer version —
either way that's a call to make with the file open, not while writing docs.

### Chapter 37 — Screenshots, and the bug they found (2026-09-03)
A money app is judged on what it looks like, and the README described a UI nobody could see.
Two constraints shaped the answer: the repo is public, so no real spending history goes in it,
and the app has no dependencies, so the capture tooling can't either.

- **`tools/demo-data.js`** — a seeded generator (mulberry32, so a commit always renders the same
  charts) producing ~470 invented transactions over 14 months as a normal backup file. It has to
  be *rich*, not just non-empty: the blocks hide themselves when they have nothing to say, so it
  seeds a monthly budget, four confirmed subscriptions, per-category limits, monthly transfers
  to savings and cash, a hot December and a quiet February for "What changed", and the Istanbul
  trip priced in lira. `lastBackup` is set so the reminder popup doesn't cover the screen we
  came to photograph.
- **`tools/screenshots.js`** — serves the repo over http (a service worker needs a real origin),
  seeds IndexedDB through `DB.replaceAll` — the same path a restored backup takes — reloads, and
  walks the tabs at 390×844@2x. Puppeteer is installed *outside* the repo and reached via
  `NODE_PATH`, so the app's zero-dependency claim stays true.

Three things the capture taught us, each a small lesson about screenshots being a *test*:
1. Today's random rolls put Home over budget about half the time. Accurate, and a terrible
   first impression — so the generator keeps the current day light and the hero reads
   "Left to spend today" in green.
2. Stats opened on a three-day-old month: "Income 0,00 €" on the page whose whole job is
   comparison. The script now steps back one month to the last complete one.
3. Selectors like `.month-nav .mn-btn` matched the *hidden Home* copy first, and a sheet left
   open swallowed the next tab tap and silently produced a duplicate image. Both now scoped and
   awaited.

**And a real bug, found because a screenshot can't look away.** The Activity list rendered the
merchant name, the "category · account" subtitle and the amount all on one line, overlapping.
Cause: `renderTxRow` (and `openReviewSheet`) build the row from `<span>`s. `.tx-main` is a flex
*item*, so it blockifies — but its children aren't, so `.tx-title` and `.tx-sub` stayed
`display: inline`, sat side by side, and their `text-overflow: ellipsis` did nothing, because
ellipsis needs a block box. Measured in-page before and after: the subtitle used to end at
342 px with the amount starting at 288 px. Fixed with `display: block` on both classes — one
CSS change rather than editing two call sites — cache bumped to `expense-tracker-v38`.
Present since 2026-07-23 (Chapter 7), in the app's most-used list.

Six images land in `docs/screenshots/` and open the README. The generated
`tools/demo-backup.json` is gitignored: the generator is deterministic, so the output is
reproducible rather than worth committing.

### Chapter 38 — Import: categories that come from the file (2026-09-06)
Request, with a sample: an export shaped
`date,account,category,amount,currency,converted amount,currency,description` where the
**description column is empty** and the real information sits in a **category** column
(Intrattenimento, Ristorante, Bar). Until now the importer read only the description and ran it
through the keyword rules, so a file like that imported entirely into *Uncategorized/Other* —
the one column that actually knew the answer was ignored.

`Detect.detectColumns` had returned a `category` candidate since Chapter 24; nothing consumed
it. Now the wizard does.

- **Mapping step** gains an optional **Category column** picker, defaulting to whatever was
  detected and offering *"None — use my keyword rules"*. It rides along in bank presets
  (`catCol` / `catName`); a preset saved before today simply has none.
- **Confirm step** gains a **New categories** card. Names are matched against the app's own by
  `catKey()` — case, accents and inner spacing don't count, so `SANITÀ`, `Sanità` and `sanita`
  are one category. Matches are reused; the rest are listed with a guessed icon, a colour that
  *continues* the palette rather than restarting it, and a count of affected rows. Each can be
  switched off individually, and switching one off drops those rows back to the keyword rules,
  with the summary and preview table updating live.
- **Precedence**: the file's category beats a keyword rule. It's what the user actually filed
  the transaction under; our rules are an inference. An empty cell still falls through to the
  rules, then to *Other*.
- `catEmojiFor()` guesses an icon from the name in Italian or English (Ristorante → 🍽️,
  Bar → ☕, Intrattenimento → 🎬, Stipendio → 💰), falling back to 📦. Only a guess — everything
  is editable in Settings afterwards.

Two ordering details that would have been bugs. New categories can't be assigned while parsing
rows, because they don't exist until the user agrees to create them; so rows carry `_rawCat`
and `assignCategories()` runs afterwards, again after creation. And creation has to happen
*before* the cash-withdrawal pass, which nulls the category on rows it converts to transfers —
the other order would have resurrected a category on a transfer.

`tests/import-categories.test.js`: 30 checks over name matching (case, accents, spacing, blanks,
a duplicate name already in the app), the sample file itself (3 distinct names from 4 rows, in
first-seen order, repeat counted twice, distinct palette colours continuing past the existing
categories) and the icon guesses. One of them found a real gap on the first run: *Sanità*, a
common Italian category name, fell through to 📦.

`openMappingSheet` and `openImportPreview` joined the scope-check list — this is exactly the
Chapter 28 failure mode, and both are now guarded. `catEmojiFor` can't be: the checker strips
strings but not regex literals, so it reads an `a|b` alternation as undeclared identifiers. Its
unit test covers it instead, and the limitation is now written down in `tests/run.js`.

**Known interaction, not fixed here.** Duplicate detection keys on date + amount + description.
With this file shape the description is empty, so two genuinely different transactions of the
same amount on the same day look identical and the second is skipped. Widening the key to
include the category would help but not settle it, and it would have to change
`existingDupKeys()` in step — a deliberate decision for its own chapter.

### Chapter 39 — The update that never arrived (2026-09-06)
Reported right after Chapter 38 shipped: *"I still don't see a category column selector."*
The feature was on `main`, deployed, and verified end-to-end in a browser. So the bug wasn't
the feature — it was that a shipped release doesn't necessarily reach an installed copy.

Root cause, found by reading the deployed response headers rather than guessing:
GitHub Pages serves `js/app.js` with **`cache-control: max-age=600`**. The service worker
calls itself "network-first", but a plain `fetch(request)` inside a worker is still served by
the **browser's own HTTP cache**. So the worker faithfully went to "the network", got a
ten-minute-old file back, and cached *that* as the fresh copy. Belief and behaviour diverged,
silently, with no way to notice.

Shipped:
- `fetch(e.request, { cache: 'reload' })` in the worker: bypasses the HTTP cache for the
  request while still updating it. Network-first now actually means the network.
- **Update checks while running.** An installed PWA can stay resident for days, so
  `register()` alone never notices a new release. `reg.update()` now runs whenever the app
  returns to the foreground, and a `controllerchange` triggers exactly one reload — otherwise
  a running page would be half old code and half new.
- **The build is now visible.** Settings' footer reads `… · v40`, taken from the service
  worker's *own* cache name, so it reports what is genuinely installed rather than what the
  file it's printed from claims. Without this there is no way to tell a missing feature from a
  stale copy, which is the question that cost the most time here.
- `caches` joined the scope-check's known globals — it had never been used before, so the
  checker flagged `renderSettings` on the first run. Working as designed.

The lesson worth keeping: *verified in a browser* and *reaching the user's device* are two
different claims, and only the first was tested. A version string in the UI is the cheapest
possible instrument for telling them apart.

### Chapter 40 — Spending that shouldn't shape the daily allowance (2026-09-06)
The car breaks. 900 € against a 1.800 € budget, and the redistributing mode divides what's
left across the days remaining: the app announces roughly 0 €/day for three weeks. Accurate
arithmetic, useless advice, and it arrives exactly when the month already feels bad.

Before this there was exactly one budget exemption in the whole app — `countsInBudget` was
four lines, exempting only expenses inside a trip with its own pot.

**The design decision that shaped everything else:** the first sketch keyed the offer off
size — "more than 25% of the budget". The user pushed back, correctly: people want to exclude
small things too. So the rule became **relative, never absolute** — an expense is unusual when
it is ≥3× the median of *its own category's* last six months. That inverts the naive version
in both directions: rent, the largest line every single month, is never flagged; a 35 € charge
in a category that normally sees 8 € is. An absolute threshold gets both of those backwards.

Three ways in, one primitive underneath:
- **`excludeFromBudget` on the transaction**, deliberately **tri-state**. `true` and `false`
  are the user's explicit word; `undefined` defers to the rules. That is what lets someone
  re-include a single charge without abandoning the rule that caught it — and it doubles as
  the "don't ask again" record for a dismissed suggestion.
- **A category flag** (`meta.budgetSkip.categories`): Health, Taxes, Car. Handles small
  amounts with no per-transaction decision at all, which is the case a size threshold could
  never reach.
- **Note keywords** (`meta.budgetSkip.keywords`), the user's own words — the same shape as the
  category rules, so it needs no new concept explained.

Everything funnels through `budgetSkipReason(t)` → `countsInBudget`, one choke point, and the
same reason excludes an expense from a *trip's* pot too — "don't count this against my budget"
shouldn't depend on which pot it landed in.

**Excluded is not hidden.** The money still counts in Net, Stats, category totals and the
account balance; only the allowance skips it. The card says so out loud —
`1.469,00 € left · 60,00 €/day base · 80,00 € excluded` — because a meter that quietly ignores
money stops being a meter.

Two pre-existing bugs surfaced while wiring this up, both about durability:
- **Backups carried almost nothing.** `buildBackupPayload` whitelisted three meta keys, so
  **trips, confirmed subscriptions, category limits and the block layout were all lost on
  restore or device transfer** — despite Chapter 35 claiming the block layout "rides along
  inside backups". It didn't. The whitelist now carries every setting the user configured by
  hand, and still excludes the four device-local bookkeeping keys (`lastBackup`,
  `changesSinceBackup`, `backupSnoozeUntil`, `installedAt`), which would otherwise tell a
  restored device it had just backed up.
- **The merge path rebuilds each transaction field by field**, so anything not listed was
  dropped: `origAmount` / `origCurrency` / `rate` — a merged trip lost the amounts as they were
  actually paid — and `toAccountId`, which broke merged transfers. Both restored, along with
  the new flag. Settings that name categories (`categoryBudgets`, `budgetSkip.categories`) now
  travel through the same id remap the transactions do, or they'd point at categories that
  don't exist on the receiving device.

`tests/budget-exclusions.test.js`: 24 checks over the flag's three states, the category and
keyword rules, the override interaction, and the detector — including the two cases that
matter most, *rent is never flagged* and *a small unusual charge is*, plus insufficient
history, the six-month window, and not re-asking once answered. Verified end-to-end in a
browser as well: the Home prompt, the live recount after answering, the keyword rule, the
Settings sheet, and the add sheet's switch flipping itself as a keyword is typed.

### Chapter 41 — UI review on a branch: the picker, the filters, and three bugs (2026-09-07)
Brief: a UI/UX pass on a new branch (`ui-refresh`), keeping every feature and keeping `main`
— which is live — untouched. Method: generate a 30-category, 500-transaction dataset and
screenshot every screen headlessly, because a screenshot can't look away. Three design
decisions were put to the user with mockups; all three recommendations approved.

**The category picker.** With 30 categories the old picker was a single horizontal strip
showing two and a half chips — finding "Parrucchiere" meant scrolling blind. Now: the ~8 most
likely categories (recent picks first, then frequency) as *wrapped* chips, the current
selection always kept visible wherever it ranks, and an "All 30 ›" chip opening a searchable
grid sheet (`openCategoryPickSheet`, matching through `catKey` so accents and case don't
matter). Under ~9 categories nothing changes — the chips simply all fit. The colour dot left
the chips too: every category already carries an emoji, and two identity marks per chip is one
more than needed.

**Activity filters.** Search + three dropdowns + two date fields — three rows of controls
before the first transaction. Now one row: search plus a `Filter · n` button, everything else
in a sheet. The state is never hidden though: each active filter is a pill with its own ✕,
and Reset clears the lot. Nothing was removed; every control moved intact.

**Three bugs found by the tour:**
- **The outlier prompt flagged rent every month.** With rent inside "Bills" next to 10-60 €
  utilities the category median is small, so 680 € read as "9× your usual" — and each month's
  rent is a fresh transaction, so it would never stop asking. Chapter 40's tests missed it
  because they gave rent its own category. Fix: an amount the category has already seen twice
  (±5%) is a standing charge, not an anomaly — and confirmed subscriptions are skipped
  outright. The €450 one-off in the same category still fires.
- **Calendar drew two month navigators.** Its own ‹ › under the header's — both driving the
  same `ui.stats.y/m0`. The inner one now appears only when the period selector is on
  Year/All/Custom, where the calendar genuinely needs its own month.
- **Every row wore a faint red rim.** The swipe-action layers sit behind each row at all
  times, and their edge bled through the rounded corners. They're now painted only
  mid-gesture, removed after the close animation rather than before it so the colour doesn't
  vanish while the row is still sliding back.

Also: repeat chips fall back to the category name when the note is empty (they rendered
blank for description-less users), and `.switch-row` sub-labels got their muted style.

Two more scope-check limitations written down: destructured parameters read as undeclared
identifiers (makeSwipeable), joining the regex-literal case. 19 new checks between
`budget-exclusions` regressions and a 16-assertion browser run over the picker, the filter
sheet, the pills, the rim and the calendar.

### Chapter 42 — Any emoji, not just our 28 (2026-09-07)
Asked: why is the category icon limited to a fixed set? Fair question, and the honest answer is
that there was never a technical reason. There is no web API to *open* an emoji keyboard, so
the original picker sidestepped the keyboard entirely with a tap-only grid — and a convenience
quietly became a ceiling. But a plain text input already reaches the keyboard: on iOS every
keyboard carries the emoji key. So the grid keeps its job as shortcuts, and an input lifts the
lid.

`emojiPicker(current, quick, onChange)` — one helper, used by **both** the category sheet and
the trip sheet, which had the same problem with an even smaller set of eight.

The interesting part is splitting the input. An emoji is rarely one character: 👨‍👩‍👧‍👦 is four
codepoints joined by ZWJ, 👍🏽 carries a skin-tone modifier, 🇮🇹 is two regional indicators, ❤️
ends in a variation selector, #️⃣ is a keycap sequence. `value[0]` or `slice(0, 1)` shreds every
one of them. So `graphemes()` uses **`Intl.Segmenter`** with grapheme granularity, and
`lastGrapheme()` takes the newest cluster — which is what makes tapping a second emoji *replace*
the first while the keyboard stays open for browsing.

A hand-written regex covers engines without `Intl.Segmenter` (Safari before 14.1). Writing the
test for it was worth it immediately: the first version handled families, flags, skin tones and
variation selectors but **shredded keycaps**, because `#` isn't `Extended_Pictographic` and fell
through to the catch-all. The fallback now matches keycaps first. The same test also pushed the
invisible ZWJ and VS16 literals in that pattern out into `‍` / `️` escapes — they were
unreadable in source.

`tests/emoji-picker.test.js` runs every case twice, once with `Intl.Segmenter` and once with it
stubbed away, so the fallback is held to the same standard as the real thing: 30 checks. Plus a
browser pass confirming a family, a flag, a skin tone, a keycap and a plain 🦄 all survive being
typed, saved and read back, that the shortcuts still work, and that trips got the same field.

### Chapter 43 — Teaching the app, and a file that ate itself (2026-09-09)
Two things: an ideas file, and onboarding. Plus a scare worth recording.

**`IDEAS.md`.** The diary says what shipped; this is the other half — what might. Flagship
candidates (payday forecast, sinking funds, merchant price watch) each noting *what already
exists in the code* so the cost is honest rather than guessed, the smaller wins, every gap left
open across recent work, and the rejected paths with their reasons. Receipt photos are the
interesting rejection: trivial to build, but they'd turn the backup from a file you can read and
diff into megabytes of base64 nobody will ever inspect. The backup being legible *is* the
durability story.

**Onboarding, measured first.** A fresh install seeds 11 categories, 2 accounts and 11 rules —
and **zero transactions, no budget**. So Home reads `0,00 €` three times under a donut emoji,
and nothing hints that importing, swiping, trips or private mode exist. There was no onboarding
code anywhere in `app.js`. Three pieces, all approved with mockups first:

- **A "Getting started" checklist on Home.** Four steps: first expense, budget, import, backup.
  It **derives its ticks from the data**, never from a stored "step 2 complete" flag — so it
  cannot disagree with reality, and it can't get stuck if someone does things out of order or
  imports before it ever renders. It retires itself when the last step is done, and ✕ hides it
  for good. Only `everImported` needed a flag, since "did an import happen" isn't visible in the
  data; it's set at both import paths.
- **"How it works" in Settings, first section.** Eight topics — the daily allowance, spending
  that shouldn't count, gestures, trips, importing, private mode, your data, quick-add. The
  reference a first-run flow can't be: still there in six months when someone wonders what a
  trip budget actually does.
- **The swipe hint, once.** Swipe is the app's main shortcut and completely invisible. The first
  time anyone sees a transaction list, the top row slides open to reveal Edit and closes again,
  with a one-line caption. It has to add `.swiping` while it runs, because Chapter 41 hid those
  layers at rest.

**The scare.** Partway through, `js/app.js` in the working tree lost **525 lines** — including
`openBudgetSkipSheet`, `emojiPicker` and `budgetOutliers`, all committed chapters. The editor
had the file open and saved a stale buffer over it. It was caught because the scope check
suddenly reported *21* functions "not found", which is not a plausible code error — the shape of
the failure was the clue. `git show HEAD:js/app.js` was intact, so recovery was a checkout plus
re-applying the six edits. Nothing was lost.

Worth keeping: the committed state is the source of truth, "not found" en masse means the file
is wrong rather than the code, and a test suite that runs in a second is what makes that
distinction cheap enough to notice at all.
