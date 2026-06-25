"""
Settings router — CRUD for backend/settings.json
GET/PUT /api/settings
POST    /api/settings/test-connection
POST    /api/sync/cancel
"""
import json
import asyncio
from pathlib import Path

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


# ── Endpoints ───────────────────────────────────────────────────────────────

@router.get("/api/settings")
def get_settings():
    s = json.loads(json.dumps(load_settings()))
    if s.get("connection", {}).get("password"):
        s["connection"]["password"] = _PASSWORD_MASK
    return s


@router.put("/api/settings")
def update_settings(payload: SettingsPayload):
    from db.sync  import request_cancel
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
        request_cancel()
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
    from db.sync import request_cancel
    from services.scheduler import get_sync_state
    request_cancel()
    return {"ok": True, "message": "Cancel requested"}
