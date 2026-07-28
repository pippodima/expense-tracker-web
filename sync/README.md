# Statement import — runs on the iPhone itself

Turns a copy-pasted bank statement (buddybank / UniCredit or any similar list) into a
`bank-sync-*.json` file that the app imports. Pure-stdlib Python, so it runs **on the
phone** in the free **a-Shell** app — no Mac, no server, no accounts, no API keys.

The web app itself never makes network calls; this script is just a text converter.

## Setup (on the iPhone)

1. Install **a-Shell** (free, App Store — Python preinstalled). iSH works too
   (`apk add python3` first).
2. Download the converter from your deployed app:

   ```bash
   curl -O https://YOUR-APP-URL/sync/paste_to_sync.py
   ```

## Each time you want to import

1. In the buddybank app, select and **copy** the transaction list.
2. Paste it into a text file (a-Shell: `edit statement.txt`, paste, save).
3. Convert it:

   ```bash
   python3 paste_to_sync.py statement.txt
   ```

   It prints a summary and writes `bank-sync-YYYY-MM-DD.json`.
4. In the expense app: **Settings → Import transactions → Import statement file**, and
   pick the file (a-Shell's folder shows up under *On My iPhone → a-Shell*).

Re-importing the same file is harmless: every row carries a stable `externalId`, so the
app merges instead of duplicating, and transactions you entered by hand with the same
date and amount are adopted rather than doubled.

## Expected paste format

Repeating blocks under Italian date headers — exactly what the buddybank list produces:

```
22 Luglio 2026
SAT PRATO OVEST -
Pagamento Apple Pay
-15, 00 € -15 €
ILIAD ITALIA
Pagamento POS
-9, 99 € -9.99 €
```

The converter handles `1.234,56`-style thousands, `+`/`-` signs, and gives repeated
same-day charges distinct stable ids.
