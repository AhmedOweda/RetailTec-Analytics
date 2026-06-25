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

log = logging.getLogger(__name__)
SETTINGS_FILE = Path(__file__).parent.parent / "settings.json"

# ── Shared sync state (read by /api/sync/status endpoint) ─────────────────
_sync_state: dict = {
    "running": False,
    "step":    "",
    "done":    0,
    "total":   3,
    "error":   None,
    "last_sync": None,
}
_sync_lock = asyncio.Lock()


def get_sync_state() -> dict:
    return dict(_sync_state)


def _progress(step: str, done: int, total: int):
    _sync_state.update(step=step, done=done, total=total)


def _load_settings() -> dict:
    return json.loads(SETTINGS_FILE.read_text())


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
            _sync_state.update(running=True, error=None, step="Starting", done=0)
            try:
                cfg  = _load_settings()
                days = cfg["data_model"]["incremental_window_days"]
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

async def trigger_full_load():
    """Full reload — called from admin panel 'Load All Data' button."""
    if _sync_state["running"]:
        return {"ok": False, "message": "Sync already running"}

    async def _run():
        async with _sync_lock:
            _sync_state.update(running=True, error=None, step="Starting", done=0)
            try:
                cfg  = _load_settings()
                days = cfg["data_model"]["initial_load_days"]
                await db_sync.full_load(days, progress_cb=_progress)
                _sync_state.update(
                    running=False, step="Done", done=3,
                    last_sync=datetime.now().isoformat()
                )
            except Exception as e:
                log.error(f"trigger_full_load failed: {e}")
                _sync_state.update(running=False, error=str(e), step="Error")

    asyncio.create_task(_run())
    return {"ok": True, "message": "Full load started"}


# ── Background refresh loop ────────────────────────────────────────────────

async def background_loop():
    """
    Infinite loop — wakes up every N minutes and runs an incremental sync.
    Started on FastAPI startup via asyncio.create_task().
    """
    await asyncio.sleep(60)   # wait 1 min after startup before first background run
    while True:
        try:
            cfg      = _load_settings()
            interval = cfg["data_model"]["background_refresh_minutes"]
            days     = cfg["data_model"]["incremental_window_days"]

            if not _sync_state["running"]:
                log.info(f"Background sync — last {days} days")
                _sync_state.update(running=True, error=None, step="Background sync", done=0)
                async with _sync_lock:
                    await db_sync.incremental(days, progress_cb=_progress)
                    _sync_state.update(
                        running=False, step="Done", done=3,
                        last_sync=datetime.now().isoformat()
                    )
        except Exception as e:
            log.error(f"Background sync error: {e}")
            _sync_state.update(running=False, error=str(e))

        await asyncio.sleep(interval * 60)
