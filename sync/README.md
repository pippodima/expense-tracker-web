# Bank sync — runs on the iPhone itself (GoCardless Bank Account Data)

Pulls transactions from your bank (buddybank / UniCredit, or the sandbox) through the
free GoCardless PSD2 API and writes a `bank-sync-*.json` file that the app imports.

**No Mac, no server.** The script is pure-stdlib Python and runs *on the phone* inside
a free terminal app. The web app itself makes zero network calls — GoCardless blocks
browser CORS (verified), so this script is the only bridge, and its output enters the
app as a file you import yourself.

## One-time setup (on the iPhone)

1. Install **a-Shell** (free, App Store — Python preinstalled). iSH also works
   (`apk add python3 curl` first).
2. In a-Shell, download the script from your deployed app:

   ```bash
   curl -O https://YOUR-APP-URL/sync/bank_sync.py
   curl -O https://YOUR-APP-URL/sync/.env.example
   cp .env.example .env
   ```

3. Create a free account at <https://bankaccountdata.gocardless.com>, generate a
   **secret_id / secret_key** (User secrets), and put them in `.env`
   (edit with `vim .env` or a-Shell's `edit .env`). Never commit or share them.
4. Link the bank:

   ```bash
   python3 bank_sync.py link
   ```

   It prints an authorization URL — long-press → open in Safari, complete the bank's
   consent flow (on the phone this can hand off to the bank's own app), come back to
   a-Shell and press Enter.

## Daily use (on the phone)

```bash
python3 bank_sync.py sync --dry-run   # preview, writes nothing
python3 bank_sync.py sync             # writes bank-sync-YYYY-MM-DD.json
python3 bank_sync.py status           # link info, consent expiry, last sync
```

Then open the expense app → **Settings → Bank sync → Import bank sync file** and pick
the file from the Files app (a-Shell's folder appears under *On My iPhone → a-Shell*).
Re-importing the same file is harmless — every transaction carries an `externalId` and
the app upserts on it.

The same script runs identically on any computer if you ever prefer that — but nothing
depends on one.

## What the tool enforces for you

- **Token reuse**: access token cached 24 h, renewed via the 30-day refresh token.
- **Rate limit**: free tier = 4 API calls per account per day → `sync` refuses to run
  again within 6 h (`--force` overrides).
- **Pending transactions are skipped** — their IDs are unstable; only booked ones export.
- **90-day consent**: warns from 7 days before expiry; when the bank rejects an expired
  consent it says "re-link" instead of failing cryptically.
- **Sandbox first**: `.env.example` defaults to `SANDBOXFINANCE_SFIN0000` (fake data,
  no rate limits). Switch to the real bank by clearing `GC_INSTITUTION_ID` (interactive
  search for UniCredit/buddybank) and running `link` again.
