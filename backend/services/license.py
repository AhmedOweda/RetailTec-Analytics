"""
License status + HARD enforcement.
================================================
Since 29 Jul 2026 (owner decision) an unlicensed / invalid state COMPLETELY
BLOCKS the app: `license_lock_state()` returns the lock verdict, the HTTP
middleware in main.py refuses every data endpoint with 403 while locked, the
sync engine refuses to run, and the frontend replaces the app with a lock
screen. Reporting functions themselves still never raise — a broken license
file must produce a clean lock, not a crash.

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
import os
import shutil
from datetime import date, datetime
from pathlib import Path

log = logging.getLogger(__name__)

# ── Embedded Ed25519 PUBLIC key (32-byte raw, hex) ──────────────────────────
# Generated 2026-07 for RetailTec Analytics. The matching PRIVATE key is kept
# offline by the vendor (never committed). Rotating the license signing key
# means replacing this constant and re-issuing customer licenses.
_PUBLIC_KEY_HEX = "516181c82a769a6df7f03d0ba2829f2100ccdb2c9c2be7818f6d2ea8b05acf4a"

# Bundled location inside the install dir (wiped on uninstall).
_BUNDLED_LICENSE = Path(__file__).parent.parent / "license.json"


def _persistent_license() -> Path:
    """A machine-wide location that SURVIVES uninstall/reinstall:
    C:\\ProgramData\\RetailTec Analytics\\license.json."""
    base = os.environ.get("PROGRAMDATA") or r"C:\ProgramData"
    return Path(base) / "RetailTec Analytics" / "license.json"


def _resolve_license_file() -> Path:
    """Where to read license.json from. Prefer the persistent ProgramData copy
    (survives reinstall); migrate a bundled license there on first run so an
    existing install keeps working. Never raises."""
    persistent = _persistent_license()
    try:
        if persistent.exists():
            return persistent
        if _BUNDLED_LICENSE.exists():
            try:
                persistent.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(_BUNDLED_LICENSE, persistent)
                return persistent
            except Exception:
                return _BUNDLED_LICENSE   # ProgramData not writable → use bundled
    except Exception:
        pass
    return persistent   # nothing yet → this is where the customer should drop it


def license_file_path() -> str:
    """Absolute path where the app looks for license.json — shown in
    Diagnostics so the customer knows exactly where to drop the file. This is
    now the persistent ProgramData path, which survives uninstall/reinstall."""
    try:
        return str(_resolve_license_file().resolve())
    except Exception:
        return str(_persistent_license())


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

# ── Licensed product domains ────────────────────────────────────────────────
# A license payload may carry an optional "domains" list restricting which
# product areas exist for that install. A payload WITHOUT the field (every
# license issued before 2026-07) means ALL domains — backward compatible.
ALL_DOMAINS = ["home", "ai", "sales", "inventory", "purchases",
               "accounting", "dimensions", "reports"]

# Small TTL cache so licensed_domains() (called per request by the gating
# middleware) does not re-read/re-verify license.json on every request.
_dom_cache: dict = {"at": -1e18, "value": None}   # 'at' sentinel = never cached
_DOM_CACHE_TTL = 30.0   # seconds


def licensed_domains() -> list | None:
    """The product domains this install is licensed for.

    None  → ALL domains (no license, invalid license, or a legacy license
            without a "domains" field). The license module never blocks an
            unlicensed install beyond the existing watermark policy.
    list  → only these domains exist; everything else is gated off.
    Never raises."""
    import time
    now = time.monotonic()
    if now - _dom_cache["at"] < _DOM_CACHE_TTL:
        return _dom_cache["value"]
    value = None
    try:
        st = get_license_status()
        if st.get("valid"):
            doms = st.get("domains")
            if isinstance(doms, list) and doms:
                value = [d for d in doms if d in ALL_DOMAINS]
                if not value:          # nothing recognisable → treat as all
                    value = None
    except Exception as e:  # pragma: no cover — defensive
        log.warning(f"licensed_domains failed (ignored): {e}")
        value = None
    _dom_cache.update(at=now, value=value)
    return value


def domain_allowed(domain: str) -> bool:
    """True when `domain` is covered by the license (or the license has no
    domain restriction). Unknown domain names are allowed (fail open)."""
    doms = licensed_domains()
    return doms is None or domain in doms


# Endpoint → domain map for the HTTP gate. Order matters: exact/shared paths
# are checked first, then the any-of specials, then plain prefixes.
#
# Shared lookup endpoints (slicers, global header, command palette) serve
# dimension NAMES to every page, so they are deliberately UNGATED:
#   /api/stores, /api/sales/stores-list, /api/sales/subsidiaries-list,
#   /api/sales/employees-list, /api/sales/customers-list,
#   /api/sales/journal/search/*, /api/inventory/stores-list,
#   /api/inventory/vendors-list, /api/inventory/dcs-list,
#   /api/inventory/items-search, /api/inventory/search/*,
#   /api/purchases/vendors-list
_SHARED_PATHS = frozenset({
    "/api/stores",
    "/api/sales/stores-list", "/api/sales/subsidiaries-list",
    "/api/sales/employees-list", "/api/sales/customers-list",
    "/api/inventory/stores-list", "/api/inventory/vendors-list",
    "/api/inventory/dcs-list", "/api/inventory/items-search",
    "/api/purchases/vendors-list",
})
_SHARED_PREFIXES = ("/api/sales/journal/search/", "/api/inventory/search/")

# Endpoints served to MORE than one product domain: allowed when ANY of the
# listed domains is licensed (dimension pages reuse sales/inventory/purchases
# analytics endpoints).
_ANY_OF = {
    "/api/sales/perf/stores":     ("sales", "dimensions"),   # Performance + Dim Stores
    "/api/sales/perf/associates": ("sales", "dimensions"),   # Performance + Dim Employees
    "/api/sales/perf/customers":  ("sales", "dimensions"),   # Performance + Dim Customers
    "/api/sales/products":        ("sales", "dimensions"),   # Sales Products + Dim Items
    "/api/inventory/by-vendor":   ("inventory", "dimensions"),  # Inv Overview + Dim Vendors
    "/api/purchases/by-vendor":   ("purchases", "dimensions"),  # Purch Overview + Dim Vendors
}

# Prefix → single owning domain. /api/admin/reports*, /api/admin/alerts and
# /api/admin/email* belong to the report/email engine ("reports"); the rest of
# /api/admin (backup, restore, diagnostics, audit, license) stays ungated so
# Settings always loads and shows the license state.
_PREFIX_DOMAIN = (
    ("/api/home/",          "home"),
    ("/api/assistant/",     "ai"),
    ("/api/accounting/",    "accounting"),
    ("/api/sales/",         "sales"),
    ("/api/inventory/",     "inventory"),
    ("/api/purchases/",     "purchases"),
    ("/api/reports/",       "reports"),
    ("/api/admin/reports",  "reports"),
    ("/api/admin/alerts",   "reports"),
    ("/api/admin/email",    "reports"),
)


def domains_for_path(path: str) -> tuple | None:
    """Which licensed domain(s) cover an API path — the request is allowed when
    ANY of the returned domains is licensed. None → ungated (auth, settings,
    sync, admin maintenance, shared lookups). Never raises."""
    try:
        p = path.split("?", 1)[0].rstrip("/") or "/"
        if p in _SHARED_PATHS or any(p.startswith(s) for s in _SHARED_PREFIXES):
            return None
        if p in _ANY_OF:
            return _ANY_OF[p]
        probe = p + "/"
        for prefix, dom in _PREFIX_DOMAIN:
            if probe.startswith(prefix) or p.startswith(prefix):
                return (dom,)
    except Exception:  # pragma: no cover — defensive
        pass
    return None


def path_allowed(path: str) -> bool:
    """True when the license covers this API path (or the path is ungated)."""
    doms = licensed_domains()
    if doms is None:
        return True
    need = domains_for_path(path)
    return need is None or any(d in doms for d in need)


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
            # Pre-expiry reminder (last 14 days) so the customer renews
            # BEFORE the hard lock lands (policy: block + short grace).
            dr = st.get("days_remaining")
            if dr is not None and 0 <= dr <= 14 and not st.get("expired"):
                warnings.append(
                    f"License expires in {dr} day(s) — renew now to avoid "
                    f"being locked out")
        # NOTE: a MISSING license no longer warns here — it hard-locks the
        # app via license_lock_state() (owner policy 29 Jul 2026).
    except Exception as e:  # pragma: no cover
        log.warning(f"License evaluation failed (ignored): {e}")
    return {"violation": violation, "reason": reason, "warnings": warnings,
            "device_code": device, "status": st}


# ── HARD LOCK (owner policy 29 Jul 2026: complete blockage, short grace) ─────
# Locks: no license, invalid signature, expired, wrong device, wrong server.
# Subsidiary overage keeps its 30-day grace (banner) and locks when it runs
# out. Copied-warehouse (db_host_mismatch) is enforced by the frontend from
# /api/settings/status — it needs WAREHOUSE_META, which this cheap per-request
# check deliberately avoids.
#
# TTL-cached: the HTTP middleware calls this on EVERY request; one real
# evaluation per TTL window. Fail-OPEN on internal errors (a transient
# settings/DB hiccup must not brick a licensed customer) — the states that
# lock are all POSITIVE determinations from a readable license file.
_lock_cache: dict = {"at": -1e18, "value": None}
_LOCK_CACHE_TTL = 30.0   # seconds


def reset_license_caches() -> None:
    """Forget cached verdicts — call after a new license.json is installed."""
    _lock_cache.update(at=-1e18, value=None)
    _dom_cache.update(at=-1e18, value=None)


def license_lock_state() -> dict | None:
    """None = app may run. Else {"reason": <short>, "detail": <sentence>}."""
    import time
    now = time.monotonic()
    if now - _lock_cache["at"] < _LOCK_CACHE_TTL:
        return _lock_cache["value"]
    value = None
    try:
        st = get_license_status()
        if not st.get("present"):
            value = {"reason": "NO LICENSE",
                     "detail": "No license is installed on this machine."}
        elif not st.get("valid"):
            value = {"reason": "INVALID LICENSE",
                     "detail": "The license file is corrupted or its signature "
                               "does not match this product."}
        elif st.get("expired"):
            value = {"reason": "LICENSE EXPIRED",
                     "detail": f"The license expired on {st.get('expiry')}."}
        else:
            if st.get("bound_device") and st["bound_device"] != get_device_code():
                value = {"reason": "WRONG DEVICE",
                         "detail": "The license is bound to a different machine."}
            if value is None and st.get("bound_oracle_host"):
                try:
                    from services.config import load_settings
                    host = (load_settings().get("connection", {}) or {}).get("host", "")
                except Exception:
                    host = ""
                if host and st["bound_oracle_host"] != host:
                    value = {"reason": "WRONG SERVER",
                             "detail": "The license is bound to a different "
                                       "Oracle server."}
            if value is None and st.get("max_subsidiaries"):
                # Subsidiary overage past its grace → lock (grace runs via
                # sub_limit_state and is shown as a countdown banner).
                try:
                    from db.model import get_db, DB_LOCK, ACCOUNTING_SBS_NO
                    with DB_LOCK:
                        con = get_db().cursor()
                    try:
                        n = con.execute(
                            "SELECT COUNT(*) FROM DIM_SUBSIDIARY "
                            "WHERE SBS_NO IS DISTINCT FROM ?",
                            [ACCOUNTING_SBS_NO]).fetchone()[0]
                        g = sub_limit_state(con, st, n)
                    finally:
                        con.close()
                    if g and g.get("blocked"):
                        value = {"reason": "LICENSE LIMIT EXCEEDED",
                                 "detail": f"The license covers {g['max']} "
                                           f"subsidiaries but {g['found']} were "
                                           f"found, and the grace period is over."}
                except Exception as e:   # DB not ready → don't lock on it
                    log.warning(f"sub-limit lock check skipped: {e}")
    except Exception as e:  # pragma: no cover — fail OPEN
        log.warning(f"license_lock_state failed (fail-open): {e}")
        value = None
    _lock_cache.update(at=now, value=value)
    return value


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
        lf = _resolve_license_file()
        if not lf.exists():
            return {"present": False, "valid": False}
        doc = json.loads(lf.read_text())
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
            # Optional licensed product domains. Absent/None = ALL domains
            # (legacy licenses keep the full product). The field sits inside
            # the signed payload, so it is covered by the signature above.
            "domains":           payload.get("domains"),
        }
    except Exception as e:  # pragma: no cover — never let license break anything
        log.warning(f"License read failed (ignored): {e}")
        return {"present": False, "valid": False}
