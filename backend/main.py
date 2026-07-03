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

# ── Oracle client: try thick mode (needed for old 10G password verifiers —
#    DPY-3015 in thin mode), fall back to thin if no client is found ─────────
import oracledb
from pathlib import Path as _Path

_IC_CANDIDATES = [
    os.environ.get("RETAILTEC_ORACLE_CLIENT"),          # explicit override
    r"C:\db_mcp\instantclient_23_0",                    # original laptop
    r"C:\Oracle\instantclient",                         # common local installs
    r"C:\oracle64\product\18.0.0\client_1\bin",
    r"C:\oracle64\product\18.0.0\client_1",
]
for _p in _IC_CANDIDATES:
    if _p and _Path(_p).exists():
        try:
            oracledb.init_oracle_client(lib_dir=_p)
            print(f"Oracle thick mode enabled (client: {_p})")
            break
        except Exception as _e:
            print(f"Oracle client at {_p} not usable: {_e}")
# no break → stays in thin mode automatically

from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware

from db.model import init_db
from routers.sales      import router as sales_router
from routers.settings   import router as settings_router
from routers.inventory  import router as inventory_router
from routers.purchases  import router as purchases_router
from routers.auth       import router as auth_router, get_current_user
from routers.admin      import router as admin_router
from services.scheduler import background_loop

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(name)s — %(message)s",
    stream=sys.stdout,
)
log = logging.getLogger(__name__)

# ── App ────────────────────────────────────────────────────────────────────

app = FastAPI(title="RetailTec Analytics API", version="3.0.0")

# CORS: the app is always served same-origin through a proxy (Vite dev server on
# :3000, Electron's bundled HTTP server on :3001) — only those origins are allowed
# for direct browser access to :8000. Never use "*" (EXPERT_REVIEW.md C1).
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000", "http://127.0.0.1:3000",   # Vite dev
        "http://localhost:3001", "http://127.0.0.1:3001",   # Electron prod proxy
    ],
    allow_methods=["*"],
    allow_headers=["Authorization", "Content-Type"],
)

# Every data router requires a valid JWT (EXPERT_REVIEW.md C1).
# Only /api/auth/login, /health and /api/cache/status are reachable without one.
_authed = [Depends(get_current_user)]
app.include_router(sales_router,     dependencies=_authed)
app.include_router(settings_router,  dependencies=_authed)
app.include_router(inventory_router, dependencies=_authed)
app.include_router(purchases_router, dependencies=_authed)
app.include_router(admin_router,     dependencies=_authed)
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
