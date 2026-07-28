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
| `sync/bank_sync.py` | **Bank sync tool** (not part of the served app's runtime): stdlib-only Python, runs on the iPhone in a-Shell/iSH; GoCardless PSD2 → `bank-sync-*.json` |
| `sync/README.md`, `sync/.env.example` | Setup docs + config template; real `.env`, `state.json`, `.tokens.json` are gitignored |

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

**Bank sync (buddybank / UniCredit via GoCardless, phone-only):** `sync/bank_sync.py` runs
**on the iPhone** in the free a-Shell (or iSH) terminal app — no Mac, no server. Commands:
`link` (90-day PSD2 consent flow: agreement → requisition → bank auth URL → account UUIDs
stored locally), `sync [--dry-run] [--force]` (fetch booked transactions → signed-amount
mapping → `bank-sync-YYYY-MM-DD.json`), `status`. It caches the 24h access token, renews via
the 30-day refresh token, enforces the free tier's 4-calls/account/day limit (6h minimum
between syncs), skips pending transactions (unstable IDs), and detects the expired-consent
API error with a clear "re-link" message. The app imports the file (Settings → Bank sync):
first import asks to map bank-account UUIDs to app accounts (saved for reuse), then it
**upserts by `externalId`** — re-imports are idempotent, manual entries (no externalId)
untouched, bank corrections update date/amount/type while preserving the user's category.
Unmatched descriptions land in **Uncategorized** and a **review queue** (Home banner +
Settings), where assigning a category can also create a rule (substring or **regex**) that
immediately sweeps the rest of the queue. Consent expiry is mirrored in-app with warnings
from 7 days out. Rules now support regex patterns (seeded example: `ANTHROPIC` → Software).

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
