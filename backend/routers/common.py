"""
Shared router helpers — security-hardened query layer
=====================================================
Invariants (see EXPERT_REVIEW.md C2):
  * All free-text request values (store/vendor/dept names, search terms)
    are passed to DuckDB as bound parameters (?), never interpolated.
  * Values that ARE interpolated into SQL must be type-safe by construction:
    - datetime.date objects (FastAPI-validated) rendered via .isoformat()
    - ints (FastAPI-validated)
    - literals chosen from a server-side whitelist
  * `scoped_stores` enforces the JWT `stores` claim server-side so a
    store-scoped user can never read other stores (EXPERT_REVIEW.md C1).
"""
import threading
from typing import Optional

from fastapi import Depends, HTTPException, Query

from db.model import get_db
from routers.auth import get_current_user

# One process-wide lock: DuckDB single connection is not thread-safe.
# (Previously each router had its own lock guarding the same connection.)
DB_LOCK = threading.Lock()


def q(sql: str, params: Optional[list] = None):
    with DB_LOCK:
        return get_db().execute(sql, params or []).fetchall()


def qdf(sql: str, params: Optional[list] = None) -> list[dict]:
    with DB_LOCK:
        con  = get_db()
        rel  = con.execute(sql, params or [])
        cols = [d[0] for d in rel.description]
        return [dict(zip(cols, row)) for row in rel.fetchall()]


# ── Parameterized filter fragments ────────────────────────────────────────────

def csv_in(expr: str, csv: Optional[str]) -> tuple[str, list]:
    """' AND <expr> IN (?,?)' + params — from a comma-separated request value."""
    if not csv:
        return "", []
    vals = [s.strip() for s in csv.split(",") if s.strip()]
    if not vals:
        return "", []
    ph = ",".join(["?"] * len(vals))
    return f" AND {expr} IN ({ph})", vals


def store_filter(stores: Optional[str], alias: str = "S") -> tuple[str, list]:
    return csv_in(f"{alias}.STORE_NAME", stores)


def trans_store_filter(stores: Optional[str]) -> tuple[str, list]:
    """Matches either the OUT or IN store of a transfer."""
    if not stores:
        return "", []
    vals = [s.strip() for s in stores.split(",") if s.strip()]
    if not vals:
        return "", []
    ph = ",".join(["?"] * len(vals))
    return (f" AND (DS_OUT.STORE_NAME IN ({ph}) OR DS_IN.STORE_NAME IN ({ph}))",
            vals + vals)


# ── Server-side store-scope enforcement (C1) ──────────────────────────────────

def allowed_store_set(current: dict) -> Optional[set]:
    """The set of store names this user may read; None = unrestricted."""
    allowed = (current.get("stores") or "").strip()
    if not allowed:
        return None
    return {s.strip() for s in allowed.split(",") if s.strip()}


def scoped_stores(
    stores: Optional[str] = Query(None),
    current: dict = Depends(get_current_user),
) -> Optional[str]:
    """
    Drop-in replacement for `stores: str = Query(None)`.
    Intersects the requested store list with the user's `stores` claim.
    Unrestricted users (claim empty/null) pass through untouched.
    """
    allowed = allowed_store_set(current)
    if allowed is None:
        return stores
    if not stores:
        return ",".join(sorted(allowed))
    requested = {s.strip() for s in stores.split(",") if s.strip()}
    granted = requested & allowed
    if not granted:
        raise HTTPException(status_code=403,
                            detail="Not authorized for the requested store(s)")
    return ",".join(sorted(granted))
