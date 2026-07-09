"""
License status — REPORTING ONLY (never blocks).
================================================
This module ONLY reports license status. It MUST NEVER block startup, block
login, or disable any endpoint. Every public function is wrapped so a missing,
malformed, or unsigned license simply reports {"present": False} instead of
raising.

License file format (backend/license.json):
    {
      "payload": {
        "customer":  "Acme Retail LLC",
        "expiry":    "2027-12-31",     # ISO date, inclusive
        "max_stores": 25,
        "max_users":  10,
        "issued":    "2026-07-04"
      },
      "signature": "<hex ed25519 signature over the canonical payload JSON>"
    }

Signature scheme: Ed25519. The signed message is the payload serialized with
json.dumps(payload, sort_keys=True, separators=(",", ":")).encode() — the SAME
canonical form the generator (tools/make_license.py) signs. The private key is
NOT in this repo; only the public key below is embedded. See make_license.py
for how to produce a signed license.json.
"""
from __future__ import annotations

import json
import logging
from datetime import date, datetime
from pathlib import Path

log = logging.getLogger(__name__)

# ── Embedded Ed25519 PUBLIC key (32-byte raw, hex) ──────────────────────────
# Generated 2026-07 for RetailTec Analytics. The matching PRIVATE key is kept
# offline by the vendor (never committed). Rotating the license signing key
# means replacing this constant and re-issuing customer licenses.
_PUBLIC_KEY_HEX = "a24eb5ed877be06432307961585d6b1848418682acdfd7db3ea57b8c21d5055b"

_LICENSE_FILE = Path(__file__).parent.parent / "license.json"


def _canonical(payload: dict) -> bytes:
    return json.dumps(payload, sort_keys=True, separators=(",", ":")).encode()


def _verify_signature(payload: dict, signature_hex: str) -> bool:
    """True iff signature_hex is a valid Ed25519 signature over the payload.
    Any error (bad key, bad hex, crypto missing) → False, never raises."""
    try:
        from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey
        from cryptography.exceptions import InvalidSignature
        pub = Ed25519PublicKey.from_public_bytes(bytes.fromhex(_PUBLIC_KEY_HEX))
        try:
            pub.verify(bytes.fromhex(signature_hex), _canonical(payload))
            return True
        except InvalidSignature:
            return False
    except Exception as e:  # pragma: no cover — defensive
        log.warning(f"License signature verification unavailable: {e}")
        return False


def _parse_expiry(payload: dict):
    raw = payload.get("expiry")
    if not raw:
        return None
    try:
        return datetime.strptime(str(raw)[:10], "%Y-%m-%d").date()
    except Exception:
        return None


def get_device_code() -> str:
    """Short, stable fingerprint of THIS Windows machine (from MachineGuid).
    Shown in About; the vendor can bind a license to it. Never raises."""
    import hashlib
    try:
        import winreg
        with winreg.OpenKey(winreg.HKEY_LOCAL_MACHINE,
                            r"SOFTWARE\Microsoft\Cryptography") as k:
            guid, _ = winreg.QueryValueEx(k, "MachineGuid")
    except Exception:
        import platform
        guid = platform.node()
    h = hashlib.sha256(f"retailtec:{guid}".encode()).hexdigest().upper()
    return f"{h[:4]}-{h[4:8]}-{h[8:12]}"


GRACE_DAYS = 30   # days a customer may exceed max_subsidiaries before sync stops


def sub_limit_state(duck, status: dict, subsidiary_count: int | None):
    """Subsidiary-limit state with a persisted grace period. Returns None when
    within limit (and clears the marker), else
    {exceeded, since, days_left, blocked, max, found}. Never raises."""
    try:
        maxs = status.get("max_subsidiaries")
        over = (status.get("valid") and maxs and subsidiary_count
                and int(subsidiary_count) > int(maxs))
        if not over:
            try:
                duck.execute("DELETE FROM WAREHOUSE_META WHERE key='sub_limit_since'")
                duck.commit()
            except Exception:
                pass
            return None
        row = duck.execute(
            "SELECT value FROM WAREHOUSE_META WHERE key='sub_limit_since'").fetchone()
        if row and row[0]:
            since = str(row[0])
        else:
            since = date.today().isoformat()
            duck.execute("INSERT INTO WAREHOUSE_META VALUES ('sub_limit_since', ?) "
                         "ON CONFLICT (key) DO NOTHING", [since])
            duck.commit()
        days_used = (date.today() - datetime.strptime(since[:10], "%Y-%m-%d").date()).days
        return {"exceeded": True, "since": since,
                "days_left": max(0, GRACE_DAYS - days_used),
                "blocked": days_used > GRACE_DAYS,
                "max": int(maxs), "found": int(subsidiary_count)}
    except Exception as e:  # pragma: no cover
        log.warning(f"sub_limit_state failed (ignored): {e}")
        return None


def evaluate(oracle_host: str, subsidiary_count: int | None, duck=None) -> dict:
    """License enforcement verdict. NEVER raises.

    Returns {
      "violation": bool,       # hard problem → UI watermark
      "warnings":  [str],      # soft problems → UI banner
      "reason":    str|None,   # short watermark text
      "device_code": str,
      "status": <get_license_status() dict>,
    }
    Policy: watermark on invalid signature, expiry, or device/host mismatch.
    A MISSING license is only a warning (evaluation mode), and the subsidiary
    limit being exceeded is a warning — reporting never breaks.
    """
    st = get_license_status()
    device = get_device_code()
    violation, reason, warnings = False, None, []
    try:
        if st.get("present") and not st.get("valid"):
            violation, reason = True, "INVALID LICENSE"
        elif st.get("valid"):
            if st.get("expired"):
                violation, reason = True, "LICENSE EXPIRED"
            if st.get("bound_device") and st["bound_device"] != device:
                violation, reason = True, "WRONG DEVICE"
            if st.get("bound_oracle_host") and oracle_host \
                    and st["bound_oracle_host"] != oracle_host:
                violation, reason = True, "WRONG SERVER"
            if duck is not None:
                g = sub_limit_state(duck, st, subsidiary_count)
                if g and g["blocked"]:
                    warnings.append(
                        f"Data refresh disabled — license covers {g['max']} "
                        f"subsidiaries, {g['found']} found. Contact RetailTec to upgrade.")
                elif g:
                    warnings.append(
                        f"License covers {g['max']} subsidiaries — {g['found']} found. "
                        f"Data refresh stops in {g['days_left']} days.")
            elif st.get("max_subsidiaries") and subsidiary_count \
                    and subsidiary_count > int(st["max_subsidiaries"]):
                warnings.append(
                    f"License covers {st['max_subsidiaries']} subsidiaries — "
                    f"{subsidiary_count} found")
        else:
            warnings.append("No license installed — evaluation mode")
    except Exception as e:  # pragma: no cover
        log.warning(f"License evaluation failed (ignored): {e}")
    return {"violation": violation, "reason": reason, "warnings": warnings,
            "device_code": device, "status": st}


def get_license_status() -> dict:
    """Return license status. NEVER raises.

    Shapes:
      no file / invalid  → {"present": False, "valid": False}
      valid              → {"present": True, "valid": True, "customer": ...,
                            "expiry": "YYYY-MM-DD", "days_remaining": int,
                            "expired": bool, "max_stores": int|None,
                            "max_users": int|None}
    """
    try:
        if not _LICENSE_FILE.exists():
            return {"present": False, "valid": False}
        doc = json.loads(_LICENSE_FILE.read_text())
        payload = doc.get("payload") or {}
        sig = doc.get("signature") or ""
        valid = _verify_signature(payload, sig)
        if not valid:
            return {"present": True, "valid": False}
        expiry = _parse_expiry(payload)
        days_remaining = None
        expired = False
        if expiry is not None:
            days_remaining = (expiry - date.today()).days
            expired = days_remaining < 0
        return {
            "present":        True,
            "valid":          True,
            "customer":       payload.get("customer"),
            "expiry":         expiry.isoformat() if expiry else None,
            "days_remaining": days_remaining,
            "expired":        expired,
            "max_stores":     payload.get("max_stores"),
            "max_users":      payload.get("max_users"),
            "max_subsidiaries":  payload.get("max_subsidiaries"),
            "bound_device":      payload.get("device_code"),
            "bound_oracle_host": payload.get("oracle_host"),
        }
    except Exception as e:  # pragma: no cover — never let license break anything
        log.warning(f"License read failed (ignored): {e}")
        return {"present": False, "valid": False}
