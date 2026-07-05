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
from typing import Optional

from fastapi import Depends, HTTPException, Query

from db.model import DB_LOCK, get_db
from routers.auth import get_current_user


# ── Optional item-master fields (configurable grid columns) ───────────────────
# Whitelist: only these DIM_ITEM columns may be requested via ?item_fields=csv.
ITEM_EXTRA_FIELDS = {
    "DESCRIPTION2", "DESCRIPTION3", "DESCRIPTION4", "LONG_DESCRIPTION",
    "ATTRIBUTE", "ITEM_SIZE",
    *{f"TEXT{i}" for i in range(1, 11)},
    *{f"UDF{i}_STRING" for i in range(1, 6)},
    "PRICE_LVL1", "PRICE_LVL2", "PRICE_LVL3",
}


def item_fields_sql(item_fields: Optional[str], alias: str = "I",
                    agg: bool = False) -> str:
    """SELECT fragment for requested item fields (whitelisted — safe to
    interpolate). agg=True wraps in MAX() for GROUP BY queries."""
    if not item_fields:
        return ""
    cols = [c.strip().upper() for c in item_fields.split(",") if c.strip()]
    good = [c for c in cols if c in ITEM_EXTRA_FIELDS]
    if agg:
        return "".join(f", MAX({alias}.{c}) AS {c}" for c in good)
    return "".join(f", {alias}.{c} AS {c}" for c in good)


def _cursor():
    """A per-request DuckDB cursor. Cursors are independent connections to the
    same database (MVCC): reads run CONCURRENTLY with the sync writer instead of
    queueing behind it on the shared connection — previously every dashboard
    query (even login) froze for the entire duration of any sync."""
    with DB_LOCK:                 # guard only connection creation / host switch
        return get_db().cursor()


def q(sql: str, params: Optional[list] = None):
    cur = _cursor()
    try:
        return cur.execute(sql, params or []).fetchall()
    finally:
        cur.close()


def qdf(sql: str, params: Optional[list] = None) -> list[dict]:
    cur = _cursor()
    try:
        rel  = cur.execute(sql, params or [])
        cols = [d[0] for d in rel.description]
        return [dict(zip(cols, row)) for row in rel.fetchall()]
    finally:
        cur.close()


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


# ── Subsidiary scope + filter (multi-subsidiary support) ──────────────────────
# Subsidiary is resolved via the store's SUBSIDIARY_SID (DIM_STORE.SUBSIDIARY_SID,
# populated from the sales facts), so these compose with the existing store joins
# and work on every fact that already joins DIM_STORE.

def subsidiary_filter(subs: Optional[str], alias: str = "S") -> tuple[str, list]:
    """' AND <alias>.SUBSIDIARY_SID IN (?,...)' + params, from a CSV of subsidiary
    SIDs. <alias> is the DIM_STORE alias used by the query."""
    if not subs:
        return "", []
    vals = [s.strip() for s in subs.split(",") if s.strip()]
    if not vals:
        return "", []
    ph = ",".join(["?"] * len(vals))
    return f" AND {alias}.SUBSIDIARY_SID IN ({ph})", vals


def allowed_subsidiary_set(current: dict) -> Optional[set]:
    """Subsidiary SIDs this user may read; None = unrestricted."""
    allowed = (current.get("subsidiaries") or "").strip()
    if not allowed:
        return None
    return {s.strip() for s in allowed.split(",") if s.strip()}


def scoped_subsidiaries(
    subsidiaries: Optional[str] = Query(None),
    current: dict = Depends(get_current_user),
) -> Optional[str]:
    """Mirror of scoped_stores for subsidiaries. Intersects the requested
    subsidiary list with the user's `subsidiaries` claim; unrestricted users
    (claim empty/null) pass through untouched."""
    allowed = allowed_subsidiary_set(current)
    if allowed is None:
        return subsidiaries
    if not subsidiaries:
        return ",".join(sorted(allowed))
    requested = {s.strip() for s in subsidiaries.split(",") if s.strip()}
    granted = requested & allowed
    if not granted:
        raise HTTPException(status_code=403,
                            detail="Not authorized for the requested subsidiary(ies)")
    return ",".join(sorted(granted))
