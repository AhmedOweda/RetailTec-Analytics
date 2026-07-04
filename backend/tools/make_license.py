"""
make_license.py — offline license generator (NOT imported at runtime)
=====================================================================
Signs a license payload with the vendor's Ed25519 PRIVATE key and writes a
signed license.json that backend/services/license.py can verify against the
embedded PUBLIC key.

The private key is NEVER stored in this repo. Keep it offline (e.g. a vendor
key vault). For this install it was generated once and saved to:
    C:\\RetailTec Analytics\\retailtec_license_private_key.pem
(outside the git working tree). Guard it — anyone with it can mint licenses.

Usage:
    python make_license.py \
        --private-key /path/to/retailtec_license_private_key.pem \
        --customer "Acme Retail LLC" \
        --expiry 2027-12-31 \
        --max-stores 25 --max-users 10 \
        --out ../license.json

Then drop the resulting license.json next to backend/main.py (i.e. in backend/).
The signed message is the canonical JSON of the payload:
    json.dumps(payload, sort_keys=True, separators=(",", ":")).encode()
which MUST match services/license.py._canonical().
"""
from __future__ import annotations

import argparse
import json
from datetime import date
from pathlib import Path


def _canonical(payload: dict) -> bytes:
    return json.dumps(payload, sort_keys=True, separators=(",", ":")).encode()


def main() -> None:
    ap = argparse.ArgumentParser(description="Generate a signed RetailTec license.json")
    ap.add_argument("--private-key", required=True, help="Path to Ed25519 PKCS8 PEM private key")
    ap.add_argument("--customer", required=True)
    ap.add_argument("--expiry", required=True, help="ISO date YYYY-MM-DD (inclusive)")
    ap.add_argument("--max-stores", type=int, default=None)
    ap.add_argument("--max-users", type=int, default=None)
    ap.add_argument("--out", default="license.json")
    args = ap.parse_args()

    from cryptography.hazmat.primitives import serialization

    priv = serialization.load_pem_private_key(
        Path(args.private_key).read_bytes(), password=None)

    payload = {
        "customer": args.customer,
        "expiry":   args.expiry,
        "issued":   date.today().isoformat(),
    }
    if args.max_stores is not None:
        payload["max_stores"] = args.max_stores
    if args.max_users is not None:
        payload["max_users"] = args.max_users

    signature = priv.sign(_canonical(payload)).hex()
    doc = {"payload": payload, "signature": signature}
    Path(args.out).write_text(json.dumps(doc, indent=2))
    print(f"Wrote {args.out} for '{args.customer}' (expiry {args.expiry})")


if __name__ == "__main__":
    main()
