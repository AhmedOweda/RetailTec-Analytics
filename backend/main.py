"""
RetailTec Analytics — FastAPI Backend v3.0
==========================================
Slim entry point: initialises DuckDB, mounts routers, starts background sync.

Run (dev):  uvicorn main:app --reload --port 8000
Package:    via backend/launcher.py (PyInstaller)
"""
import asyncio
import logging
import sys
import os

# ── Oracle thin client (no instant client needed) ──────────────────────────
import oracledb
try:
    oracledb.init_oracle_client(lib_dir=r"C:\db_mcp\instantclient_23_0")
except Exception:
    pass   # falls back to thin mode automatically

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from db.model import init_db
from routers.sales      import router as sales_router
from routers.settings   import router as settings_router
from routers.inventory  import router as inventory_router
from routers.purchases  import router as purchases_router
from routers.auth       import router as auth_router
from services.scheduler import background_loop

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(name)s — %(message)s",
    stream=sys.stdout,
)
log = logging.getLogger(__name__)

# ── App ────────────────────────────────────────────────────────────────────

app = FastAPI(title="RetailTec Analytics API", version="3.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(sales_router)
app.include_router(settings_router)
app.include_router(inventory_router)
app.include_router(purchases_router)
app.include_router(auth_router)


# ── Startup ────────────────────────────────────────────────────────────────

@app.on_event("startup")
async def startup():
    log.info("Initialising DuckDB model...")
    init_db()
    # Clean up any sync runs left in 'running' state from a previous crash/kill
    from db.model import get_db as _get_db
    _duck = _get_db()
    stale = _duck.execute("SELECT COUNT(*) FROM SYNC_RUN WHERE status='running'").fetchone()[0]
    if stale:
        _duck.execute("""
            UPDATE SYNC_RUN SET status='aborted', finished_at=NOW(),
                error_msg='Process killed or restarted'
            WHERE status='running'
        """)
        _duck.commit()
        log.info(f"Cleaned up {stale} stale sync run(s)")
    log.info("Starting background sync loop...")
    asyncio.create_task(background_loop())
    log.info("RetailTec Analytics backend ready")


# ── Health check ───────────────────────────────────────────────────────────

@app.get("/health")
def health():
    return {"status": "ok", "version": "3.0.0"}


@app.get("/api/cache/status")
def cache_status():
    """Kept for backward-compat (Electron health check uses this endpoint)."""
    return {"status": "ok"}
