"""
Settings router — CRUD for backend/settings.json
GET/PUT /api/settings
POST    /api/settings/test-connection
POST    /api/sync/cancel
POST    /api/sync/cleanup
GET     /api/sync/history
GET     /api/sync/table-stats
"""
import json
import asyncio
import re
from typing import Dict, List, Literal, Optional, Union

import oracledb
from db.model import record_audit
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, field_validator

from routers.auth import require_admin
from services.config import SETTINGS_FILE, load_settings, save_settings
from services.settings_schema import DOMAINS, migrate_data_model

router = APIRouter(tags=["settings"])

_PASSWORD_MASK = "••••••••"
_HHMM = re.compile(r"^([01]?\d|2[0-3]):[0-5]\d$")
_WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]


# ── Schema ─────────────────────────────────────────────────────────────────

class ConnectionSettings(BaseModel):
    host:     str
    port:     int = 1521
    sid:      str
    username: str
    password: str
    alias:    str = ""   # friendly display name for this database connection

class DataModelSettings(BaseModel):
    """Legacy flat shape — still accepted; migrated on read by the scheduler."""
    initial_load_days:          int = 365
    incremental_window_days:    int = 7
    background_refresh_minutes: int = 30


# ── v2 shape: per-domain schedules + retention (DB_SYNC_REDESIGN.md §7/§8) ──

class ScheduleCfg(BaseModel):
    mode: Literal["times", "interval", "manual"] = "manual"
    times: Optional[List[str]] = None          # ["06:00", "18:00"]
    days:  Optional[List[str]] = None          # ["Mon", ...]; None = every day
    timezone: Optional[str] = None             # None = inherit data_model.timezone
    every_minutes: Optional[int] = Field(None, ge=1, le=1440)

    @field_validator("times")
    @classmethod
    def _times_valid(cls, v):
        if v is None:
            return v
        for t in v:
            if not _HHMM.match(t):
                raise ValueError(f"Invalid time '{t}' — expected HH:MM")
        return v

    @field_validator("days")
    @classmethod
    def _days_valid(cls, v):
        if v is None:
            return v
        bad = [d for d in v if d not in _WEEKDAYS]
        if bad:
            raise ValueError(f"Invalid day(s): {bad} — expected {_WEEKDAYS}")
        return v

    @field_validator("timezone")
    @classmethod
    def _tz_valid(cls, v):
        if v:
            from zoneinfo import ZoneInfo
            try:
                ZoneInfo(v)
            except Exception:
                raise ValueError(f"Unknown timezone '{v}'")
        return v


class QuietHours(BaseModel):
    model_config = {"populate_by_name": True}
    from_: str = Field(alias="from")
    to:    str

    @field_validator("from_", "to")
    @classmethod
    def _hhmm(cls, v):
        if not _HHMM.match(v):
            raise ValueError(f"Invalid time '{v}' — expected HH:MM")
        return v


class DomainCfg(BaseModel):
    enabled: bool = True
    load_days: int = Field(365, ge=1, le=3650)
    detail: bool = True
    retain_detail_months: Optional[int] = Field(None, ge=1, le=120)  # None = unlimited
    schedule: ScheduleCfg = ScheduleCfg()


class DataModelV2(BaseModel):
    schema_version: Literal[2] = 2
    background_enabled: bool = True
    timezone: str = "UTC"
    quiet_hours: Optional[QuietHours] = None
    default_incremental_days: int = Field(7, ge=1, le=60)
    domains: Dict[str, DomainCfg]

    @field_validator("timezone")
    @classmethod
    def _tz_valid(cls, v):
        from zoneinfo import ZoneInfo
        try:
            ZoneInfo(v)
        except Exception:
            raise ValueError(f"Unknown timezone '{v}'")
        return v

    @field_validator("domains")
    @classmethod
    def _known_domains(cls, v):
        unknown = set(v) - set(DOMAINS)
        if unknown:
            raise ValueError(f"Unknown domain(s): {sorted(unknown)} — expected {DOMAINS}")
        return v


class SettingsPayload(BaseModel):
    connection:  ConnectionSettings
    # Validated explicitly in update_settings: a dict with `domains`/`schema_version`
    # MUST be valid v2 (no silent fallback to the lenient legacy model).
    data_model:  dict
    # Optional whitelabel branding — safe strings, don't break existing clients
    # that omit them (they simply keep the stored / default values).
    brand_name:  Optional[str] = None
    brand_logo:  Optional[str] = None
    # First-run + maintenance flags (optional; omitted → unchanged)
    auto_maintenance: Optional[bool] = None
    setup_complete:   Optional[bool] = None
    backup_retention: Optional[int]  = None   # monthly backups to keep


def _validate_data_model(raw: dict) -> Union["DataModelV2", "DataModelSettings"]:
    from pydantic import ValidationError
    try:
        if "domains" in raw or "schema_version" in raw:
            return DataModelV2(**raw)
        return DataModelSettings(**raw)
    except ValidationError as e:
        raise HTTPException(status_code=422, detail=json.loads(e.json()))


# ── Helpers ─────────────────────────────────────────────────────────────────
# load_settings/save_settings now live in services.config (single source of
# truth, DPAPI-encrypted password at rest — EXPERT_REVIEW.md C3).

def cleanup_stale_runs(duck) -> int:
    """Mark any 'running' SYNC_RUN rows as 'aborted' (called on startup + on demand)."""
    result = duck.execute("""
        UPDATE SYNC_RUN
        SET status = 'aborted', finished_at = NOW(), error_msg = 'Process was killed or restarted'
        WHERE status = 'running'
    """)
    duck.commit()
    # DuckDB UPDATE doesn't return rowcount easily — count before
    return 0


# ── Endpoints ───────────────────────────────────────────────────────────────

@router.get("/api/settings")
def get_settings():
    """Settings in the CURRENT (v2) shape — legacy files are migrated on read,
    so the UI always sees per-domain schedules/retention."""
    s = json.loads(json.dumps(migrate_data_model(load_settings())))
    if s.get("connection", {}).get("password"):
        s["connection"]["password"] = _PASSWORD_MASK
    return s


@router.put("/api/settings")
def update_settings(payload: SettingsPayload, _admin: dict = Depends(require_admin)):
    from db.sync  import cancel_sync
    from db.model import switch_db

    current = load_settings()
    old_host = current.get("connection", {}).get("host", "")

    conn = payload.connection.model_dump()

    # Keep real password if user didn't change it
    if conn.get("password") == _PASSWORD_MASK:
        conn["password"] = current.get("connection", {}).get("password", "")

    new_host = conn["host"].strip()
    conn["host"] = new_host

    # Guard: saving an EMPTY host over a configured one silently switched the app
    # to a fresh empty DB file (all dashboards went blank) and clobbered the
    # stored credentials. Refuse it.
    if old_host and not new_host:
        raise HTTPException(status_code=422,
                            detail="Host cannot be empty — clear it intentionally "
                                   "by typing the new host, not by saving a blank form")

    current["connection"] = conn
    dm_obj = _validate_data_model(payload.data_model)
    if isinstance(dm_obj, DataModelV2):
        # v2: persist as-is (by_alias so quiet_hours serializes as {"from","to"})
        current["data_model"] = dm_obj.model_dump(by_alias=True)
    else:
        # legacy flat shape: keep old behaviour (scheduler migrates on read)
        current["data_model"] = dm_obj.model_dump()

    # Whitelabel branding (optional). Only overwrite when explicitly provided so
    # older clients that omit these fields keep the existing values.
    if payload.brand_name is not None:
        current["brand_name"] = payload.brand_name.strip() or "RetailTec Analytics"
    if payload.brand_logo is not None:
        current["brand_logo"] = payload.brand_logo
    if payload.auto_maintenance is not None:
        current["auto_maintenance"] = bool(payload.auto_maintenance)
    if payload.setup_complete is not None:
        current["setup_complete"] = bool(payload.setup_complete)
    if payload.backup_retention is not None:
        current["backup_retention"] = max(1, min(int(payload.backup_retention), 60))

    save_settings(current)

    # If host changed: cancel running sync + switch DB file.
    # The per-server warehouse may already hold data from a previous session —
    # in that case keep the model usable instead of forcing a full reload.
    if new_host != old_host:
        cancel_sync()
        switch_db(new_host)
        from db.model import get_db
        has_data, last_sync = False, None
        try:
            con = get_db()
            has_data = con.execute(
                "SELECT COUNT(*) FROM FACT_SALES_INVOICES").fetchone()[0] > 0
            row = con.execute(
                "SELECT MAX(finished_at) FROM SYNC_RUN WHERE status='completed'"
            ).fetchone()
            if row and row[0]:
                last_sync = str(row[0])
        except Exception:
            pass
        current["model_status"] = "ready" if has_data else "empty"
        current["last_sync"]    = last_sync if has_data else None
        save_settings(current)

    return {"ok": True, "message": "Settings saved", "host_changed": new_host != old_host}


@router.post("/api/settings/test-connection")
async def test_connection(conn: ConnectionSettings, _admin: dict = Depends(require_admin)):
    password = conn.password
    if password == _PASSWORD_MASK:
        password = load_settings().get("connection", {}).get("password", "")

    dsn = f"{conn.host}:{conn.port}/{conn.sid}"
    loop = asyncio.get_event_loop()
    def _try():
        c = oracledb.connect(user=conn.username, password=password, dsn=dsn)
        c.close()
    try:
        await asyncio.wait_for(loop.run_in_executor(None, _try), timeout=10)
        return {"ok": True, "message": f"Connected to {conn.host}"}
    except asyncio.TimeoutError:
        raise HTTPException(408, "Connection timed out (10s)")
    except Exception as e:
        raise HTTPException(400, str(e))


@router.get("/api/settings/status")
def get_model_status():
    s = load_settings()
    c = s.get("connection", {})
    host = (c.get("host") or "").strip()
    # License binding: warehouse remembers the Oracle server that filled it.
    bound_host, mismatch = None, False
    try:
        from db.model import DB_LOCK, get_db
        with DB_LOCK:
            row = get_db().execute(
                "SELECT value FROM WAREHOUSE_META WHERE key='source_host'").fetchone()
        if row and row[0]:
            bound_host = row[0]
            mismatch = bool(host) and bound_host != host
    except Exception:
        pass
    # License enforcement verdict (subsidiary count read from the warehouse)
    lic = {}
    try:
        from services.license import evaluate
        from db.model import DB_LOCK as _L, get_db as _g
        with _L:
            con = _g()
            try:
                sub_count = con.execute(
                    "SELECT COUNT(*) FROM DIM_SUBSIDIARY").fetchone()[0]
            except Exception:
                sub_count = None
            lic = evaluate(host, sub_count, duck=con)
    except Exception:
        pass
    return {"model_status": s.get("model_status", "empty"),
            "last_sync": s.get("last_sync"),
            "db_alias": (c.get("alias") or "").strip() or c.get("host", ""),
            "bound_host": bound_host,
            "db_host_mismatch": mismatch,
            "license_violation": bool(lic.get("violation")),
            "license_reason": lic.get("reason"),
            "license_warnings": lic.get("warnings") or [],
            "device_code": lic.get("device_code")}


@router.post("/api/sync/cancel")
def cancel_sync(_admin: dict = Depends(require_admin)):
    from db.sync import cancel_sync
    cancel_sync()
    return {"ok": True, "message": "Cancel requested"}


@router.post("/api/sync/cleanup")
def sync_cleanup(_admin: dict = Depends(require_admin)):
    """Mark stuck 'running' sync runs as aborted. Safe to call anytime."""
    from db.model import DB_LOCK, get_db
    with DB_LOCK:
        duck = get_db()
        stale = duck.execute("SELECT run_id FROM SYNC_RUN WHERE status='running'").fetchall()
        stale_ids = [r[0] for r in stale]
        if stale_ids:
            duck.execute("""
                UPDATE SYNC_RUN
                SET status = 'aborted', finished_at = NOW(),
                    error_msg = 'Marked aborted via /api/sync/cleanup'
                WHERE status = 'running'
            """)
            duck.commit()
    return {"ok": True, "aborted_run_ids": stale_ids}


@router.get("/api/sync/history")
def sync_history(limit: int = 30):
    """Last N sync runs with per-table stats."""
    from db.model import DB_LOCK, get_db
    with DB_LOCK:
        duck = get_db().cursor()   # per-request cursor — don't block behind syncs
    if True:
        runs = duck.execute("""
            SELECT run_id, run_type, triggered_by, domains,
                   date_from, date_to, started_at, finished_at,
                   status, chunks_done, chunks_total, error_msg
            FROM SYNC_RUN
            ORDER BY run_id DESC
            LIMIT ?
        """, [limit]).fetchall()

        if not runs:
            return {"runs": []}

        run_ids = [r[0] for r in runs]
        placeholders = ",".join(["?"] * len(run_ids))
        stats = duck.execute(f"""
            SELECT run_id, table_name, rows_before, rows_after, rows_loaded, duration_sec
            FROM SYNC_RUN_STATS
            WHERE run_id IN ({placeholders})
            ORDER BY run_id DESC, table_name
        """, run_ids).fetchall()

    stats_map: dict = {}
    for s in stats:
        stats_map.setdefault(s[0], []).append({
            "table": s[1], "rows_before": s[2],
            "rows_after": s[3], "rows_loaded": s[4],
            "duration_sec": float(s[5]) if s[5] else 0,
        })

    result = []
    for r in runs:
        run_id   = r[0]
        started  = r[6].isoformat() if r[6] else None
        finished = r[7].isoformat() if r[7] else None
        duration = None
        if r[6] and r[7]:
            duration = round((r[7] - r[6]).total_seconds(), 1)
        result.append({
            "run_id":       run_id,
            "run_type":     r[1],
            "triggered_by": r[2],
            "domains":      r[3],
            "date_from":    str(r[4]) if r[4] else None,
            "date_to":      str(r[5]) if r[5] else None,
            "started_at":   started,
            "finished_at":  finished,
            "duration_sec": duration,
            "status":       r[8],
            "chunks_done":  r[9],
            "chunks_total": r[10],
            "error_msg":    r[11],
            "table_stats":  stats_map.get(run_id, []),
        })
    return {"runs": result}


@router.get("/api/sync/table-stats")
def sync_table_stats():
    """Row counts for every FACT/DIM table + watermark state."""
    from db.model import DB_LOCK, get_db

    tables = [
        # Facts
        "FACT_SALES_DAILY", "FACT_SALES_INVOICES", "FACT_SALES_ITEMS",
        "FACT_TRANSFERS", "FACT_ADJUSTMENTS",
        "FACT_INVENTORY", "FACT_INVENTORY_HISTORY",
        "FACT_PURCHASES", "FACT_PURCHASE_ITEMS",
        # Dims
        "DIM_DATE", "DIM_STORE", "DIM_SUBSIDIARY", "DIM_EMPLOYEE",
        "DIM_CUSTOMER", "DIM_ITEM", "DIM_VENDOR",
    ]

    counts = {}
    with DB_LOCK:
        duck = get_db().cursor()   # per-request cursor — don't block behind syncs
    if True:
        for t in tables:
            try:
                n = duck.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0]
                counts[t] = n
            except Exception:
                counts[t] = None

        watermarks = []
        try:
            wm = duck.execute("""
                SELECT domain, loaded_from, loaded_to, last_run_id, updated_at
                FROM SYNC_WATERMARK ORDER BY domain
            """).fetchall()
            for w in wm:
                watermarks.append({
                    "domain":      w[0],
                    "loaded_from": str(w[1]) if w[1] else None,
                    "loaded_to":   str(w[2]) if w[2] else None,
                    "last_run_id": w[3],
                    "updated_at":  w[4].isoformat() if w[4] else None,
                })
        except Exception:
            pass

    return {"table_counts": counts, "watermarks": watermarks}


# -- Custom range load (From -> To) --------------------------------------------

class RangeLoadReq(BaseModel):
    date_from: str
    date_to:   str
    domains:   Optional[List[str]] = None
    rebuild:   bool = False


@router.post("/api/sync/range")
async def sync_range(req: RangeLoadReq, _admin: dict = Depends(require_admin)):
    """Trigger a load of an explicit date range. Append (non-destructive) by default."""
    record_audit(_admin["username"], "range_load", f"{req.date_from}->{req.date_to} rebuild={req.rebuild}")
    from services.scheduler import trigger_range_load
    tables = set(req.domains) if req.domains else None
    return await trigger_range_load(req.date_from, req.date_to, tables=tables,
                                    rebuild=req.rebuild)


@router.get("/api/sync/validation")
def sync_validation():
    """Latest post-sync join-coverage checks (ok/warn/fail per relationship)."""
    from routers.common import qdf as _vqdf
    try:
        return _vqdf("SELECT * FROM SYNC_VALIDATION ORDER BY pct ASC")
    except Exception:
        return []


@router.get("/api/sync/coverage")
def sync_coverage():
    """Actual loaded date span + row counts per domain, read from the fact tables."""
    from db.model import DB_LOCK, get_db
    specs = [
        ("sales",             "FACT_SALES_INVOICES",    "INVC_POST_DATE"),
        ("transfers",         "FACT_TRANSFERS",         "SLIP_DATE"),
        ("adjustments",       "FACT_ADJUSTMENTS",       "ADJ_DATE"),
        ("purchases",         "FACT_PURCHASES",         "VOU_DATE"),
        ("inventory_history", "FACT_INVENTORY_HISTORY", "ACTION_DATE"),
    ]
    coverage = []
    with DB_LOCK:
        duck = get_db().cursor()   # per-request cursor — don't block behind syncs
    if True:
        for domain, table, col in specs:
            try:
                r = duck.execute(
                    f"SELECT MIN({col}), MAX({col}), COUNT(*), COUNT(DISTINCT {col}) FROM {table}"
                ).fetchone()
                coverage.append({"domain": domain, "table": table,
                                 "from": str(r[0]) if r[0] else None,
                                 "to":   str(r[1]) if r[1] else None,
                                 "rows": int(r[2] or 0), "days": int(r[3] or 0)})
            except Exception:
                coverage.append({"domain": domain, "table": table,
                                 "from": None, "to": None, "rows": 0, "days": 0})
        try:
            r = duck.execute("SELECT COUNT(*), MAX(SYNCED_AT) FROM FACT_INVENTORY").fetchone()
            coverage.append({"domain": "inventory_snapshot", "table": "FACT_INVENTORY",
                             "from": None, "to": None, "rows": int(r[0] or 0), "days": 0,
                             "synced_at": r[1].isoformat() if r[1] else None})
        except Exception:
            pass
    return {"coverage": coverage}


# -- Retention (prune old line-item detail) ------------------------------------

class RetentionReq(BaseModel):
    retain_months: Optional[int] = 24
    dry_run:       bool = False


@router.post("/api/maintenance/retention")
def run_retention(req: RetentionReq, _admin: dict = Depends(require_admin)):
    """Prune line-item detail older than retain_months (keeps daily aggregate + invoice
    headers forever). dry_run=True previews the row counts without deleting."""
    from db.sync import apply_retention
    return apply_retention(req.retain_months, dry_run=req.dry_run)
