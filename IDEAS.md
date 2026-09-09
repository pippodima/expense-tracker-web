# Ideas & open work

A working list: features worth building, gaps worth closing, and things deliberately
rejected with the reason why. **Nothing here is committed.** `PROJECT_DIARY.md` records what
*has* shipped; this file is the other half — what might.

Each entry says what already exists in the code, so the cost is honest rather than guessed.

---

## The filter

Every idea has to survive the constraints, because the constraints *are* the product:

- **No network calls, ever.** Rules out bank APIs, live exchange rates, cloud AI
  categorization, price comparison, shared budgets over a server, push notifications.
- **No dependencies, no build step.** Anything needing a charting or ML library is out.
- **All data local; it leaves only as a file the user exports.** Anything that bloats the JSON
  backup is suspect — that file is the durability story.
- **Must work on iPhone Safari, one-handed.**

The upside of those limits: the app computes on data that never leaves the phone, so it can
afford to be *nosy* in ways a cloud app can't ethically be, and it can recompute constantly for
free. The best ideas below lean into exactly that.

---

## Flagship candidates

### 1. Payday forecast / true safe-to-spend
**The biggest gap today.** The budget answers *"what may I spend today?"* Nothing answers
*"will I make it to the 27th?"*

> **€412 left after everything known.** Netflix (€12,99) and rent (€680) still due before
> payday. That's €38/day of genuinely free money.

*Already exists:* `detectSubscriptions()` computes each recurring charge's cadence, typical
amount and `nextDue` — the hard part is done. `budgetStatus()` already handles `committedAhead`
for *booked* future transactions; this extends the same idea to *predicted* ones.

*Missing:* recurring **income** detection. `detectSubscriptions()` filters to `type === 'expense'`,
so salary isn't detected. Same algorithm, different filter.

*Open question:* when the projection is bleak, does Home say so plainly ("you're €120 short
before payday") or stay neutral and show the number? A tone decision that changes how the whole
feature reads.

### 2. Sinking funds — generalize trips into "pots"
A trip is *already* a named pot with dates, its own budget, and exemption from the monthly one.
Insurance, car tax, Christmas are the same object minus the travel.

The smart part is that the app can **derive** them: it sees €540 of insurance every March, so it
proposes "set aside €45/month". The annual bill then stops detonating a month, because it was
planned rather than exempted after the fact.

*Already exists:* `meta.trips` with `budget`/`from`/`to`, `countsInBudget` exemption,
`tripBudgetStatus()`, and the Chapter 40 exclusion machinery.

*Cost:* migrating an established data structure (`meta.trips` → `meta.pots` with a `kind`), so
it needs a deliberate migration path and a backup-compatibility story.

### 3. Merchant price watch
The app knows you normally pay €1,20 at Bar Centrale.

> **Bar Centrale €4,80** — you've paid €1,10–€1,40 here 34 times.

A duplicate charge, a wrong bill, or card fraud — caught by your own phone, with nobody else
reading your statement. Distinctive precisely because it's local.

*Already exists:* `groupByMerchant()` gives per-merchant history; `budgetOutliers()` is the same
shape of "unusual versus its own history" logic, just keyed differently.

*Caveat:* needs descriptions. Useless for category-only users (see *txIdentity* below).

---

## Smaller wins

| Idea | Why it's good | Leans on |
|---|---|---|
| **Suggest the budget from history** | Today you type a number and hope. "You averaged €1.820 over six months; €1.750 is a stretch, €1.900 is comfortable." Removes the worst guess in onboarding. | Existing month aggregation |
| **Round-up jar** | "If you'd rounded every purchase to the next euro you'd have €47 this month." Pure arithmetic, zero risk, can graduate into a real savings goal. | Nothing new |
| **Print / PDF the month** | `window.print()` plus a print stylesheet. No dependency, no network. Offline expense reports for reimbursement. | New CSS only |
| **Time-cost** | Show a big purchase as "≈ 9 days of your usual spending". Money-as-time changes behaviour more than percentages. | Savings rate in Trends |
| **Split-with-someone tally** | Mark a transaction as split, keep a running "Marco owes you €63". Every app doing this needs an account and a server; this needs neither. | New field + a view |
| **Upcoming bills on Home** | "Coming up in 7 days: €38." | `detectSubscriptions().nextDue` |
| **Subscription audit** | Annual cost of every confirmed subscription, sorted, plus "you've paid €X since you started" and price-change history. | `priceChanged` already computed |
| **Year in review** | One page, seasonal, exportable. | Trends aggregation |

---

## Onboarding & first run

**The problem, measured:** a brand-new install seeds 11 categories, 2 accounts and 11 rules —
but **zero transactions and no budget**. Home therefore reads `0,00 €` three times, a donut
emoji and "No expenses this period". Nothing hints that the app can import a bank file, that
rows swipe to edit, or that trips, private mode and Lock Screen quick-add exist. There is no
onboarding code anywhere in `app.js`.

Candidate shapes, roughly in order of how much they'd help:

1. **A "Getting started" checklist on Home** that removes itself when done — set a budget, add
   or import your first transactions, save a backup. Discoverable, dismissible, and it decays
   naturally instead of being a wall in front of the app.
2. **A first-run welcome sheet**: three or four screens on what the app is (offline, private,
   your data as files), then drops you at "add your first expense".
3. **A permanent "How it works" section in Settings** — the reference the first two can't be,
   and the only one that helps six months later when someone wonders what a trip budget does.
4. **Try-it-with-demo-data** — one tap fills the app with a sample month so the charts have
   something to show, one tap wipes it. Risky: must never be confusable with real data.

These aren't exclusive; 1 + 3 is probably the strongest pair, with 2 optional.

---

## Known gaps worth closing

**Duplicate detection** ([`db.js`](js/db.js) `dupKey`) keys on `date + amount + normalized
description`, with three consequences:
- The **account isn't in the key**, so importing the same file into a second account skips every
  row as a duplicate.
- **Empty descriptions collide.** For category-column files, two genuinely different €7
  purchases on the same day are indistinguishable and the second is silently dropped.
- **Different wording duplicates.** `ESSELUNGA` and `ESSELUNGA SUPERSTORE MILANO 4471` are two
  rows, so re-importing overlapping history duplicates it.

Any fix must change `existingDupKeys()` in step, or previously-stored transactions stop matching.
The only approach that handles the third case is a review step showing suspected duplicates.

**`txIdentity()` for description-less users.** Three detectors funnel through
`merchantKey(t.note)`, which returns `'—'` for every empty note — so for someone who only records
category + amount, subscription detection and `isProtectedRecurring` are not degraded but
*entirely dead* (`isProtectedRecurring` even opens with `if (!t.note) return false`). Fix:
identity = merchant when there's a note, else category + a stable recurrence fingerprint. Only
4 of 14 call sites should change; the rest genuinely mean *merchant*.

**Currency column in the importer.** `HEADER_HINTS.currency` exists in `detect.js` but
`detectColumns` never returns it, so the column is discarded. Mapping it would let a foreign
currency run mark a trip automatically, and exchange rates could be **derived** from
`amount ÷ converted amount` instead of typed by hand — retiring a stated limitation.

**Smaller:**
- A Cash account can show a negative balance with no nudge toward *Reconcile balance*.
- Chevron alignment on the search sheet's place rows.
- Backups taken **before v41** are missing trips, confirmed subscriptions, category limits and
  block layout — the payload whitelisted only three meta keys. Worth re-exporting once.

---

## Deliberately rejected

**Receipt photos.** Technically easy — IndexedDB holds blobs. But it would wreck what makes the
app durable: the backup is a single JSON file you can read, diff and trust. Megabytes of base64
images turn that into something nobody will inspect or want to re-export. If it ever happens it
has to be a separate store *excluded* from the JSON backup, which is a far bigger conversation
than the feature looks.

**Anything needing a server**, however useful: live rates, push notifications for bills, shared
household budgets, bank APIs (already removed once, Chapter 21). The offline promise is worth
more than any of them.

**A native widget.** A real Home/Lock Screen widget needs WidgetKit. The `?action=add` deep link
is the honest substitute; a companion native app remains the only real answer and is a different
project.
