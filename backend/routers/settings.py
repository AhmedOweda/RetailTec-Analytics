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
from pathlib import Path
from typing import Optional, List

import oracledb
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

router = APIRouter(tags=["settings"])

SETTINGS_FILE = Path(__file__).parent.parent / "settings.json"
_PASSWORD_MASK = "••••••••"


# ── Schema ─────────────────────────────────────────────────────────────────

class ConnectionSettings(BaseModel):
    host:     str
    port:     int = 1521
    sid:      str
    username: str
    password: str

class DataModelSettings(BaseModel):
    initial_load_days:          int = 365
    incremental_window_days:    int = 7
    background_refresh_minutes: int = 30

class SettingsPayload(BaseModel):
    connection:  ConnectionSettings
    data_model:  DataModelSettings


# ── Helpers ─────────────────────────────────────────────────────────────────

def load_settings() -> dict:
    if SETTINGS_FILE.exists():
        return json.loads(SETTINGS_FILE.read_text())
    return {
        "connection":   {"host": "", "port": 1521, "sid": "", "username": "", "password": ""},
        "data_model":   {"initial_load_days": 365, "incremental_window_days": 7, "background_refresh_minutes": 30},
        "last_sync":    None,
        "model_status": "empty",
    }

def save_settings(data: dict):
    SETTINGS_FILE.write_text(json.dumps(data, indent=2, default=str))

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
    s = json.loads(json.dumps(load_settings()))
    if s.get("connection", {}).get("password"):
        s["connection"]["password"] = _PASSWORD_MASK
    return s


@router.put("/api/settings")
def update_settings(payload: SettingsPayload):
    from db.sync  import cancel_sync
    from db.model import switch_db

    current = load_settings()
    old_host = current.get("connection", {}).get("host", "")

    conn = payload.connection.model_dump()

    # Keep real password if user didn't change it
    if conn.get("password") == _PASSWORD_MASK:
        conn["password"] = current.get("connection", {}).get("password", "")

    new_host = conn["host"]

    current["connection"] = conn
    current["data_model"]  = payload.data_model.model_dump()
    save_settings(current)

    # If host changed: cancel running sync + switch DB file
    if new_host != old_host:
        cancel_sync()
        switch_db(new_host)
        current["model_status"] = "empty"
        current["last_sync"]    = None
        save_settings(current)

    return {"ok": True, "message": "Settings saved", "host_changed": new_host != old_host}


@router.post("/api/settings/test-connection")
async def test_connection(conn: ConnectionSettings):
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
    return {"model_status": s.get("model_status", "empty"), "last_sync": s.get("last_sync")}


@router.post("/api/sync/cancel")
def cancel_sync():
    from db.sync import cancel_sync
    cancel_sync()
    return {"ok": True, "message": "Cancel requested"}


@router.post("/api/sync/cleanup")
def sync_cleanup():
    """Mark stuck 'running' sync runs as aborted. Safe to call anytime."""
    from db.model import get_db
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
    from db.model import get_db
    duck = get_db()

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
    from db.model import get_db
    duck = get_db()

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
async def sync_range(req: RangeLoadReq):
    """Trigger a load of an explicit date range. Append (non-destructive) by default."""
    from services.scheduler import trigger_range_load
    tables = set(req.domains) if req.domains else None
    return await trigger_range_load(req.date_from, req.date_to, tables=tables,
                                    rebuild=req.rebuild)


@router.get("/api/sync/coverage")
def sync_coverage():
    """Actual loaded date span + row counts per domain, read from the fact tables."""
    from db.model import get_db
    duck = get_db()
    specs = [
        ("sales",             "FACT_SALES_INVOICES",    "INVC_POST_DATE"),
        ("transfers",         "FACT_TRANSFERS",         "SLIP_DATE"),
        ("adjustments",       "FACT_ADJUSTMENTS",       "ADJ_DATE"),
        ("purchases",         "FACT_PURCHASES",         "VOU_DATE"),
        ("inventory_history", "FACT_INVENTORY_HISTORY", "ACTION_DATE"),
    ]
    coverage = []
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
def run_retention(req: RetentionReq):
    """Prune line-item detail older than retain_months (keeps daily aggregate + invoice
    headers forever). dry_run=True previews the row counts without deleting."""
    from db.sync import apply_retention
    return apply_retention(req.retain_months, dry_run=req.dry_run)
