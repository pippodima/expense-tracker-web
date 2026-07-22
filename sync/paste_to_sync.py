#!/usr/bin/env python3
"""Convert a copy-pasted buddybank statement into a bank-sync-*.json the app imports.

A no-API way to load history: copy the transaction list out of the buddybank app
into a text file and run this. Output is the same format sync/bank_sync.py produces,
so it goes through the app's normal Bank sync import (account mapping, upsert by
externalId, rule categorization, review queue).

Usage:
  python3 sync/paste_to_sync.py [input.txt] [-o output.json]
Defaults: input test.txt (in the current dir), output bank-sync-YYYY-MM-DD.json.

Expected paste shape (repeating), under Italian date headers like "22 Luglio 2026":
  MERCHANT NAME
  Pagamento Apple Pay          (payment-type line; may be absent)
  -15, 00 € -15 €Dati oscurati (amount; '-' = expense, '+' = income)
"""
import json
import re
import sys
from datetime import datetime, timezone

MONTHS = {
    "gennaio": 1, "febbraio": 2, "marzo": 3, "aprile": 4, "maggio": 5, "giugno": 6,
    "luglio": 7, "agosto": 8, "settembre": 9, "ottobre": 10, "novembre": 11, "dicembre": 12,
}
DATE_RE = re.compile(r"^(\d{1,2})\s+([A-Za-zàèéìòù]+)\s+(\d{4})$", re.I)
AMOUNT_RE = re.compile(r"^([+-])\s*([\d.]+),\s*(\d{2})\s*€")
# Payment-type / noise lines that are never a merchant description on their own.
TYPE_ONLY = {"pagamento apple pay", "pagamento pos", "competenze", "addebiti vari"}


def parse(text):
    date = None
    buffer = []
    out = []
    seen = {}  # (date, cents, slug) -> running occurrence count, for stable unique ids
    for raw in text.splitlines():
        line = raw.strip()
        if not line or line.lower() == "dati oscurati":
            continue

        m = DATE_RE.match(line)
        if m and m.group(2).lower() in MONTHS:
            date = f"{m.group(3)}-{MONTHS[m.group(2).lower()]:02d}-{int(m.group(1)):02d}"
            buffer = []
            continue

        a = AMOUNT_RE.match(line)
        if a and date:
            sign = -1 if a.group(1) == "-" else 1
            cents = int(a.group(2).replace(".", "")) * 100 + int(a.group(3))
            amount = sign * cents / 100.0
            desc = next((b for b in buffer if b.lower() not in TYPE_ONLY), None) \
                or (buffer[0] if buffer else "Transazione")
            buffer = []
            if amount == 0:
                continue
            slug = re.sub(r"[^A-Z0-9]", "", desc.upper())[:16]
            key = (date, sign * cents, slug)
            occ = seen.get(key, 0)
            seen[key] = occ + 1
            out.append({
                "externalId": f"buddytest-{date}-{sign * cents}-{slug}-{occ}",
                "date": date,
                "amount": round(amount, 2),   # signed: negative = expense
                "currency": "EUR",
                "note": desc,
                "accountUuid": "test-account-0001",
            })
            continue

        buffer.append(line)
    return out


def main():
    args = [a for a in sys.argv[1:] if a != "-o"]
    inp = next((a for a in sys.argv[1:] if not a.startswith("-")), "test.txt")
    out_path = None
    if "-o" in sys.argv:
        out_path = sys.argv[sys.argv.index("-o") + 1]

    try:
        with open(inp, encoding="utf-8") as f:
            text = f.read()
    except OSError as e:
        print(f"Cannot read {inp}: {e}", file=sys.stderr)
        sys.exit(1)

    txs = parse(text)
    if not txs:
        print("No transactions parsed — check the file format.", file=sys.stderr)
        sys.exit(1)
    txs.sort(key=lambda t: t["date"])

    now = int(datetime.now(timezone.utc).timestamp() * 1000)
    doc = {
        "app": "expense-tracker", "kind": "bank-sync", "version": 1,
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "institutionId": "PASTE_IMPORT",
        "agreement": {"id": "paste", "createdAt": now,
                      "validForDays": 90, "expiresAt": now + 90 * 86400000},
        "accounts": [{"uuid": "test-account-0001", "iban": None, "name": "buddybank (test)"}],
        "transactions": txs,
    }
    out_path = out_path or f"bank-sync-{datetime.now().strftime('%Y-%m-%d')}.json"
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(doc, f, ensure_ascii=False, indent=2)

    exp = sum(t["amount"] for t in txs if t["amount"] < 0)
    inc = sum(t["amount"] for t in txs if t["amount"] > 0)
    print(f"✓ {len(txs)} transactions ({txs[0]['date']} → {txs[-1]['date']})")
    print(f"  expenses {exp:.2f} €, income +{inc:.2f} €")
    print(f"  wrote {out_path}")
    print("  Import it: app → Settings → Bank sync → Import bank sync file.")


if __name__ == "__main__":
    main()
