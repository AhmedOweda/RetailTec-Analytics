"""
Sync Scheduler
==============
- on_open_sync()      — call when dashboard loads (incremental, non-blocking)
- background_loop()   — runs forever, refreshes on schedule
- _sync_state         — shared state so UI can poll sync progress
"""
import asyncio
import logging
from datetime import datetime
from typing import Literal
import json
from pathlib import Path

from db import sync as db_sync
from services.schedule import due_domains
from services.settings_schema import migrate_data_model

log = logging.getLogger(__name__)
SETTINGS_FILE = Path(__file__).parent.parent / "settings.json"

# Last time each domain was synced by the scheduler (for schedule evaluation)
_domain_last_run: dict = {}

# Last time the weekly auto-maintenance CHECKPOINT ran (additive, opt-out via
# settings.auto_maintenance=False). Purely a housekeeping flush — never touches
# the sync pipeline or schedules.
_last_maintenance: datetime | None = None
_MAINTENANCE_INTERVAL_SEC = 7 * 24 * 3600    # weekly CHECKPOINT
_BACKUP_INTERVAL_DAYS      = 30              # monthly backup


def _maybe_auto_maintenance(cfg: dict) -> None:
    """Weekly CHECKPOINT (flush WAL / reclaim space) + monthly warehouse backup
    with keep-last-N retention. Best-effort and fully guarded — any failure is
    logged and ignored. Skipped entirely when auto_maintenance is disabled or a
    sync is running."""
    global _last_maintenance
    try:
        if not cfg.get("auto_maintenance", True):
            return
        if _sync_state.get("running"):
            return
        now = datetime.utcnow()

        # Weekly CHECKPOINT
        if _last_maintenance is None or \
           (now - _last_maintenance).total_seconds() >= _MAINTENANCE_INTERVAL_SEC:
            from db.model import DB_LOCK, get_db
            with DB_LOCK:
                get_db().execute("CHECKPOINT")
            _last_maintenance = now
            log.info("Auto-maintenance: weekly CHECKPOINT completed")

        # Monthly backup + retention. Cadence is derived from the newest backup
        # file's age, so it survives restarts and never double-backs-up.
        try:
            from services.backup import (create_backup, prune_backups,
                                         newest_backup_age_days)
            if newest_backup_age_days() >= _BACKUP_INTERVAL_DAYS:
                dest = create_backup()
                keep = int(cfg.get("backup_retention", 6) or 6)
                removed = prune_backups(keep=keep)
                log.info(f"Auto-maintenance: monthly backup -> {dest.name} "
                         f"(kept {keep}, pruned {removed})")
        except FileNotFoundError:
            pass   # warehouse not populated yet
    except Exception as e:
        log.error(f"Auto-maintenance skipped: {e}")

# ── Shared sync state (read by /api/sync/status endpoint) ─────────────────
_sync_state: dict = {
    "running": False,
    "step":    "",
    "done":    0,
    "total":   3,
    "error":   None,
    "last_sync": None,
    "kind":       None,   # 'full' | 'range' | 'scheduled' | 'incremental'
    "started_at": None,   # epoch seconds, for ETA
}


def _mark_start(kind: str, total: int = 100):
    _sync_state.update(running=True, error=None, step="Starting", done=0,
                       total=total, kind=kind, started_at=datetime.now().timestamp())
_sync_lock = asyncio.Lock()


def get_sync_state() -> dict:
    return dict(_sync_state)


def _progress(step: str, done: int, total: int):
    _sync_state.update(step=step, done=done, total=total)


def _load_settings() -> dict:
    from services.config import load_settings
    return load_settings()   # decrypts the DPAPI-protected password in memory


def _oracle_configured(cfg: dict) -> bool:
    """True when a host is set — avoids error-spam on fresh installs."""
    return bool((cfg.get("connection") or {}).get("host", "").strip())


# ── On-open incremental sync ───────────────────────────────────────────────

async def on_open_sync():
    """
    Called when the frontend opens. Runs an incremental refresh
    of the last N days in the background (fire and forget).
    """
    if _sync_state["running"]:
        log.info("Sync already running — skipping on-open trigger")
        return

    async def _run():
        async with _sync_lock:
            _mark_start("incremental")
            try:
                cfg = _load_settings()
                if not _oracle_configured(cfg):
                    log.info("Oracle connection not configured — skipping on-open sync")
                    _sync_state.update(running=False, step="Not configured")
                    return
                dm   = migrate_data_model(cfg)["data_model"]
                days = int(dm.get("default_incremental_days", 7))
                await db_sync.incremental(days, progress_cb=_progress)
                _sync_state.update(
                    running=False, step="Done", done=3,
                    last_sync=datetime.now().isoformat()
                )
            except Exception as e:
                log.error(f"on_open_sync failed: {e}")
                _sync_state.update(running=False, error=str(e), step="Error")

    asyncio.create_task(_run())


# ── Full load (triggered from admin panel) ─────────────────────────────────

async def trigger_full_load(tables: set | None = None):
    """Full reload — called from admin panel.
    tables=None loads all domains.
    Pass a set like {'sales','transfers','adjustments','inventory'} to restrict.
    """
    if _sync_state["running"]:
        return {"ok": False, "message": "Sync already running"}

    async def _run():
        async with _sync_lock:
            label = ", ".join(sorted(tables)) if tables else "all"
            _mark_start("full")
            try:
                cfg  = _load_settings()
                dm   = migrate_data_model(cfg)["data_model"]
                days = int(dm.get("domains", {}).get("sales", {}).get("load_days", 365))
                await db_sync.full_load(days, progress_cb=_progress, tables=tables)
                _sync_state.update(
                    running=False, step=f"Done ({label})", done=3,
                    last_sync=datetime.now().isoformat()
                )
            except Exception as e:
                log.error(f"trigger_full_load failed: {e}")
                _sync_state.update(running=False, error=str(e), step="Error")

    asyncio.create_task(_run())
    return {"ok": True, "message": "Full load started"}


# ── Dimensions-only fresh reload (triggered from admin panel) ──────────────

async def trigger_dimensions_load():
    """Fresh reload of dimension tables only (no facts) — called from admin panel."""
    if _sync_state["running"]:
        return {"ok": False, "message": "Sync already running"}

    async def _run():
        async with _sync_lock:
            _mark_start("full")
            try:
                await db_sync.dimensions_load(progress_cb=_progress)
                _sync_state.update(
                    running=False, step="Done (dimensions)", done=3,
                    last_sync=datetime.now().isoformat()
                )
            except Exception as e:
                log.error(f"trigger_dimensions_load failed: {e}")
                _sync_state.update(running=False, error=str(e), step="Error")

    asyncio.create_task(_run())
    return {"ok": True, "message": "Dimensions load started"}


# ── Custom range load (From → To, triggered from admin panel) ──────────────

async def trigger_range_load(date_from: str, date_to: str,
                             tables: set | None = None, rebuild: bool = False):
    """Load an explicit [date_from, date_to] range. Append by default; rebuild=True
    clears the range first."""
    if _sync_state["running"]:
        return {"ok": False, "message": "Sync already running"}

    async def _run():
        async with _sync_lock:
            label = ", ".join(sorted(tables)) if tables else "all"
            _mark_start("range")
            try:
                await db_sync.range_load(date_from, date_to, progress_cb=_progress,
                                         tables=tables, triggered_by="user", rebuild=rebuild)
                _sync_state.update(
                    running=False, step=f"Done ({label})", done=100, total=100,
                    last_sync=datetime.now().isoformat()
                )
            except Exception as e:
                log.error(f"trigger_range_load failed: {e}")
                _sync_state.update(running=False, error=str(e), step="Error")

    asyncio.create_task(_run())
    return {"ok": True, "message": f"Range load {date_from} -> {date_to} started"}


# -- Background refresh loop (per-domain schedules) -----------------------------

async def background_loop():
    """Ticks every minute. Each domain runs on its own Power BI-style schedule
    (specific times + days + timezone, or an interval), evaluated by
    services.schedule.due_domains. Only the domains that are due are synced.
    A legacy flat data_model is migrated on the fly (interval from the old
    background_refresh_minutes), so existing installs keep working."""
    await asyncio.sleep(60)
    warned_unconfigured = False
    while True:
        try:
            cfg = _load_settings()
            if not _oracle_configured(cfg):
                if not warned_unconfigured:
                    log.info("Oracle connection not configured — background sync idle "
                             "until Settings are saved")
                    warned_unconfigured = True
                await asyncio.sleep(60)
                continue
            warned_unconfigured = False
            dm  = migrate_data_model(cfg)["data_model"]
            due = due_domains(dm, datetime.utcnow(), _domain_last_run)
            if due and not _sync_state["running"]:
                all_doms = set(dm.get("domains", {}).keys())
                tables   = None if set(due) >= all_doms else set(due)
                days     = int(dm.get("default_incremental_days", 7))
                label    = ", ".join(due)
                log.info(f"Scheduled sync due: {label}")
                _sync_state.update(running=True, error=None,
                                   step=f"Scheduled: {label}", done=0, total=100,
                                   kind="scheduled", started_at=datetime.now().timestamp())
                async with _sync_lock:
                    await db_sync.incremental(days, progress_cb=_progress, tables=tables)
                    now = datetime.utcnow()
                    for d in due:
                        _domain_last_run[d] = now
                    _sync_state.update(running=False, step="Done", done=100, total=100,
                                       last_sync=datetime.now().isoformat())
        except Exception as e:
            log.error(f"Background sync error: {e}")
            _sync_state.update(running=False, error=str(e))
        # Scheduled report emails (no-op unless enabled in Settings → Email)
        try:
            from services.report_email import maybe_send_scheduled
            maybe_send_scheduled()
        except Exception as e:
            log.error(f"Report schedule check failed: {e}")
        # Weekly housekeeping (opt-out via settings.auto_maintenance)
        try:
            _maybe_auto_maintenance(_load_settings())
        except Exception as e:
            log.error(f"Auto-maintenance check failed: {e}")
        await asyncio.sleep(60)
