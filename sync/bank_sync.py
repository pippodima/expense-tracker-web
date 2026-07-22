#!/usr/bin/env python3
"""Bank sync for the expense tracker — GoCardless Bank Account Data (free PSD2 tier).

Runs ANYWHERE Python 3.9+ runs, including ON THE IPHONE inside the free
a-Shell or iSH terminal apps — no Mac or server needed. Pure stdlib, no pip.

The web app itself makes zero network calls (GoCardless blocks browser CORS
anyway — verified). This script is the only bridge: it fetches transactions
and writes a bank-sync-YYYY-MM-DD.json file that you import in the app
(Settings -> Bank sync). Import is idempotent via per-transaction externalId.

Commands:
  python3 bank_sync.py link               connect / re-link the bank (90-day consent)
  python3 bank_sync.py sync [--dry-run]   fetch booked transactions -> sync file
  python3 bank_sync.py status             link info, consent expiry, last sync
Options:
  --dry-run   print what would be exported, write no file
  --force     bypass the rate-limit guard (free tier: 4 calls/account/day)

Config: .env next to this script (copy .env.example). Never hardcode secrets.
"""
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone

BASE = "https://bankaccountdata.gocardless.com/api/v2"
DIR = os.path.dirname(os.path.abspath(__file__))
ENV_FILE = os.path.join(DIR, ".env")
STATE_FILE = os.path.join(DIR, "state.json")
TOKEN_FILE = os.path.join(DIR, ".tokens.json")
CONSENT_DAYS = 90                 # PSD2 max without reconfirmation
MIN_SYNC_INTERVAL = 6 * 3600      # 4 calls/account/day => at most every 6 h
WARN_DAYS = 7
TOKEN_MARGIN = 60                 # treat tokens as expired 1 min early


class ApiError(Exception):
    def __init__(self, status, body, msg):
        super().__init__(msg)
        self.status = status
        self.body = body


def api(path, method="GET", token=None, body=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(BASE + path, data=data, method=method)
    req.add_header("accept", "application/json")
    if body is not None:
        req.add_header("content-type", "application/json")
    if token:
        req.add_header("authorization", "Bearer " + token)
    try:
        with urllib.request.urlopen(req, timeout=30) as res:
            text = res.read().decode()
    except urllib.error.HTTPError as e:
        text = e.read().decode(errors="replace")
        try:
            j = json.loads(text) if text else {}
        except ValueError:
            j = {"raw": text}
        summary = j.get("summary") or j.get("detail") or text[:300]
        raise ApiError(e.code, j, f"{method} {path} -> HTTP {e.code}: {summary}") from None
    except urllib.error.URLError as e:
        die(f"Network error calling GoCardless: {e.reason}")
    return json.loads(text) if text else {}


def is_consent_expired(e):
    if not isinstance(e, ApiError) or e.status not in (401, 403):
        return False
    s = json.dumps(e.body) + " " + str(e)
    return bool(re.search(
        r"(EUA|agreement|consent|access)[^\"]*expired|expired[^\"]*(EUA|agreement|consent)|reconfirm",
        s, re.I))


def die(msg):
    print("\n✗ " + msg, file=sys.stderr)
    sys.exit(1)


def handle_api_error(e):
    if is_consent_expired(e):
        die("The 90-day PSD2 consent has expired (the bank rejected our access).\n"
            "  Re-link your bank:  python3 bank_sync.py link\n"
            "  (PSD2 requires renewing consent every 90 days — this is expected.)")
    if isinstance(e, ApiError) and e.status == 429:
        die("Rate limited by GoCardless (free tier: 4 calls per account per day).\n"
            "  Try again later — the quota resets at midnight UTC.")
    die(str(e))


def read_json(path, default):
    try:
        with open(path) as f:
            return json.load(f)
    except (OSError, ValueError):
        return default


def write_json(path, obj, private=False):
    with open(path, "w") as f:
        json.dump(obj, f, indent=2)
    if private:
        try:
            os.chmod(path, 0o600)
        except OSError:
            pass


def load_env():
    if not os.path.exists(ENV_FILE):
        die(f"Missing {ENV_FILE}\nCopy .env.example to .env and fill in your GoCardless "
            "secret_id / secret_key (free account at bankaccountdata.gocardless.com).")
    env = {}
    with open(ENV_FILE) as f:
        for line in f:
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                env[k.strip()] = v.strip().strip("'\"")
    if not env.get("GC_SECRET_ID") or not env.get("GC_SECRET_KEY"):
        die(".env must define GC_SECRET_ID and GC_SECRET_KEY. Never hardcode them.")
    return env


def get_token(env):
    """Access token lasts 24h; refresh token 30d. Refresh instead of re-authenticating."""
    now = time.time()
    cached = read_json(TOKEN_FILE, None)
    if cached and cached.get("accessExpiresAt", 0) - TOKEN_MARGIN > now:
        return cached["access"]
    if cached and cached.get("refresh") and cached.get("refreshExpiresAt", 0) - TOKEN_MARGIN > now:
        try:
            r = api("/token/refresh/", "POST", body={"refresh": cached["refresh"]})
            cached.update(access=r["access"],
                          accessExpiresAt=now + r.get("access_expires", 86400))
            write_json(TOKEN_FILE, cached, private=True)
            return cached["access"]
        except ApiError:
            pass  # refresh rejected -> new token pair below
    r = api("/token/new/", "POST",
            body={"secret_id": env["GC_SECRET_ID"], "secret_key": env["GC_SECRET_KEY"]})
    write_json(TOKEN_FILE, {
        "access": r["access"],
        "accessExpiresAt": now + r.get("access_expires", 86400),
        "refresh": r.get("refresh"),
        "refreshExpiresAt": now + r.get("refresh_expires", 2592000),
    }, private=True)
    return r["access"]


def consent_days_left(state):
    ag = state.get("agreement")
    if not ag:
        return None
    return int((ag["expiresAt"] - time.time() * 1000) // 86400000)


def warn_consent(state):
    left = consent_days_left(state)
    if left is None:
        return
    if left < 0:
        print(f"\n⚠️  Bank consent EXPIRED {-left} day(s) ago. Run: python3 bank_sync.py link")
    elif left <= WARN_DAYS:
        print(f"\n⚠️  Bank consent expires in {left} day(s). Re-link soon: python3 bank_sync.py link")


# ================= link =================

def cmd_link(env):
    token = get_token(env)
    country = env.get("GC_COUNTRY", "it")
    institution = env.get("GC_INSTITUTION_ID", "")

    if institution:
        print(f"Using institution from .env: {institution}")
    else:
        print(f"Looking up institutions (country={country})…")
        allinst = api(f"/institutions/?country={country}", token=token)
        matches = [i for i in allinst if re.search(r"unicredit|buddy", i["name"] + " " + i["id"], re.I)]
        listing = matches or allinst
        if not matches:
            print("No UniCredit/buddybank match — showing all institutions.")
        for n, i in enumerate(listing, 1):
            print(f"  [{n}] {i['name']}  ({i['id']})")
        try:
            pick = int(input(f"Pick institution [1-{len(listing)}]: "))
        except ValueError:
            pick = 0
        if not 1 <= pick <= len(listing):
            die("Invalid choice.")
        institution = listing[pick - 1]["id"]

    print(f"\nCreating {CONSENT_DAYS}-day end-user agreement for {institution}…")
    agreement = api("/agreements/enduser/", "POST", token=token, body={
        "institution_id": institution,
        "max_historical_days": CONSENT_DAYS,
        "access_valid_for_days": CONSENT_DAYS,
        "access_scope": ["balances", "details", "transactions"],
    })

    redirect = env.get("GC_REDIRECT_URL", "http://localhost:8123/?bank-linked=1")
    requisition = api("/requisitions/", "POST", token=token, body={
        "redirect": redirect,
        "institution_id": institution,
        "agreement": agreement["id"],
        "reference": "exptrack-" + format(int(time.time()), "x"),
        "user_language": "IT",
    })

    print("\n" + "─" * 54)
    print("Open this link (on this phone is fine) and authorize the bank:")
    print("\n  " + requisition["link"] + "\n")
    print("─" * 54)
    input("Press Enter here AFTER you finish the bank authorization… ")

    req = api(f"/requisitions/{requisition['id']}/", token=token)
    if req.get("status") != "LN" or not req.get("accounts"):
        die(f"Requisition status is \"{req.get('status')}\" with "
            f"{len(req.get('accounts', []))} account(s).\n"
            "  If you completed the flow, wait a few seconds and run \"link\" again;\n"
            "  status \"EX\" = consent expired, \"RJ\" = the bank rejected it.")

    accounts = []
    for uuid in req["accounts"]:
        iban = name = None
        try:
            meta = api(f"/accounts/{uuid}/", token=token)
            iban, name = meta.get("iban"), meta.get("owner_name")
        except ApiError:
            pass  # metadata is best-effort
        accounts.append({"uuid": uuid, "iban": iban, "name": name, "lastSyncAt": 0})
        print(f"  ✓ account {uuid}" + (f"  IBAN {iban}" if iban else ""))

    created_ms = int(time.time() * 1000)
    try:
        created_ms = int(datetime.fromisoformat(
            agreement["created"].replace("Z", "+00:00")).timestamp() * 1000)
    except (KeyError, ValueError):
        pass
    write_json(STATE_FILE, {
        "institutionId": institution,
        "requisitionId": requisition["id"],
        "agreement": {
            "id": agreement["id"],
            "createdAt": created_ms,
            "validForDays": CONSENT_DAYS,
            "expiresAt": created_ms + CONSENT_DAYS * 86400000,
        },
        "accounts": accounts,
    })
    print(f"\n✓ Linked. {len(accounts)} account(s) saved to state.json.")
    print("  Next: python3 bank_sync.py sync --dry-run")


# ================= sync =================

def map_tx(t, account_uuid):
    ext = t.get("transactionId") or t.get("internalTransactionId")
    if not ext:
        return None
    try:
        amount = float(t["transactionAmount"]["amount"])   # a STRING in the API
    except (KeyError, TypeError, ValueError):
        return None
    if amount == 0:
        return None
    date = t.get("bookingDate") or t.get("valueDate")
    if not date:
        return None
    note = (t.get("remittanceInformationUnstructured")
            or " ".join(t.get("remittanceInformationUnstructuredArray") or [])
            or t.get("creditorName") or t.get("debtorName") or "")
    return {
        "externalId": ext,
        "date": date,
        "amount": amount,          # signed: negative = debit/expense
        "currency": (t.get("transactionAmount") or {}).get("currency", "EUR"),
        "note": re.sub(r"\s+", " ", note).strip(),
        "accountUuid": account_uuid,
    }


def cmd_sync(env, dry_run, force):
    state = read_json(STATE_FILE, {})
    if not state.get("requisitionId") or not state.get("accounts"):
        die("No bank linked yet. Run:  python3 bank_sync.py link")
    warn_consent(state)

    newest = max((a.get("lastSyncAt", 0) for a in state["accounts"]), default=0)
    wait = newest / 1000 + MIN_SYNC_INTERVAL - time.time()
    if wait > 0 and not force:
        die(f"Last sync was {int((time.time() - newest / 1000) // 60)} min ago. To stay inside the "
            f"free tier (4 calls/account/day)\n  wait {int(wait // 60) + 1} more minutes, or pass "
            "--force if you know you have quota left.")

    token = get_token(env)
    rows, pending_skipped, bad, non_eur = [], 0, 0, 0
    for acct in state["accounts"]:
        print(f"Fetching transactions for account {acct['uuid'][:8]}…")
        try:
            data = api(f"/accounts/{acct['uuid']}/transactions/", token=token)
        except ApiError as e:
            handle_api_error(e)
        acct["lastSyncAt"] = int(time.time() * 1000)
        booked = (data.get("transactions") or {}).get("booked") or []
        pending = (data.get("transactions") or {}).get("pending") or []
        pending_skipped += len(pending)   # pending ids are unstable -> never import
        for raw in booked:
            t = map_tx(raw, acct["uuid"])
            if not t:
                bad += 1
            elif t["currency"] != "EUR":
                non_eur += 1
            else:
                rows.append(t)
        print(f"  {len(booked)} booked, {len(pending)} pending (skipped)")
    write_json(STATE_FILE, state)   # count API usage even on dry-run

    rows.sort(key=lambda t: t["date"])
    n_exp = sum(1 for t in rows if t["amount"] < 0)
    extra = (f", {bad} unusable" if bad else "") + (f", {non_eur} non-EUR" if non_eur else "")
    print(f"\n{len(rows)} transactions ready ({n_exp} expenses, {len(rows) - n_exp} income{extra})")

    if dry_run:
        print("\n— DRY RUN: nothing written. Transactions that would be exported —\n")
        for t in rows:
            print(f"  {t['date']}  {t['amount']:>10.2f} €  {t['note'][:58]}")
        print("\nRun again without --dry-run to write the bank-sync file.")
        return

    out = {
        "app": "expense-tracker",
        "kind": "bank-sync",
        "version": 1,
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "institutionId": state["institutionId"],
        "agreement": state["agreement"],   # the app shows its own expiry warning
        "accounts": [{k: a.get(k) for k in ("uuid", "iban", "name")} for a in state["accounts"]],
        "transactions": rows,
    }
    fname = f"bank-sync-{datetime.now().strftime('%Y-%m-%d')}.json"
    path = os.path.join(os.getcwd(), fname)
    write_json(path, out)
    print(f"\n✓ Wrote {path}")
    print("  Import it in the app: Settings → Bank sync → Import bank sync file.")
    print("  (Running in a-Shell/iSH? The file is already in the Files app — "
          "pick it from there.)")


# ================= status =================

def cmd_status():
    state = read_json(STATE_FILE, {})
    if not state.get("requisitionId"):
        print("Not linked. Run:  python3 bank_sync.py link")
        return
    print("Institution : " + state["institutionId"])
    print("Requisition : " + state["requisitionId"])
    ag = state.get("agreement")
    if ag:
        exp = datetime.fromtimestamp(ag["expiresAt"] / 1000).strftime("%Y-%m-%d")
        print(f"Consent     : expires {exp} ({consent_days_left(state)} days left)")
    for a in state.get("accounts", []):
        last = (datetime.fromtimestamp(a["lastSyncAt"] / 1000).strftime("%Y-%m-%d %H:%M")
                if a.get("lastSyncAt") else "never")
        print(f"Account     : {a['uuid']}" + (f"  {a['iban']}" if a.get("iban") else "")
              + f"  last sync {last}")
    warn_consent(state)


def main():
    args = sys.argv[1:]
    cmd = next((a for a in args if not a.startswith("--")), None)
    dry = "--dry-run" in args
    force = "--force" in args
    try:
        if cmd == "link":
            cmd_link(load_env())
        elif cmd == "sync":
            cmd_sync(load_env(), dry, force)
        elif cmd == "status":
            cmd_status()
        else:
            print(__doc__.strip())
            sys.exit(1 if cmd else 0)
    except ApiError as e:
        handle_api_error(e)
    except KeyboardInterrupt:
        print()
        sys.exit(130)


if __name__ == "__main__":
    main()
