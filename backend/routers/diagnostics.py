"""
Diagnostics Router — read-only About/Diagnostics surface (admin)
================================================================
GET /api/admin/diagnostics — app/schema versions, last sync, warehouse size,
                             fact row counts, and license status.
GET /api/admin/license     — license status only.

Every value is best-effort: a missing warehouse file or unreadable table
yields null/None for that field, never a 500.
"""
import logging
import os
from pathlib import Path

from fastapi import APIRouter, Depends

from db.model import (DB_LOCK, get_db, APP_VERSION, SCHEMA_VERSION,
                      _db_path, _current_settings_host)
from routers.auth import require_admin
from services.config import load_settings
from services.license import get_license_status

log = logging.getLogger(__name__)
router = APIRouter(tags=["diagnostics"])

# Fact tables whose row counts are worth surfacing in the About panel.
_FACT_TABLES = [
    "FACT_SALES_DAILY", "FACT_SALES_INVOICES", "FACT_SALES_ITEMS",
    "FACT_TRANSFERS", "FACT_ADJUSTMENTS",
    "FACT_INVENTORY", "FACT_INVENTORY_HISTORY",
    "FACT_PURCHASES", "FACT_PURCHASE_ITEMS",
]


def _warehouse_size_bytes() -> int | None:
    try:
        p = Path(_db_path(_current_settings_host()))
        return os.path.getsize(p) if p.exists() else None
    except Exception:
        return None


def _fact_counts() -> dict:
    counts: dict = {}
    try:
        with DB_LOCK:
            cur = get_db().cursor()
        try:
            for t in _FACT_TABLES:
                try:
                    counts[t] = cur.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0]
                except Exception:
                    counts[t] = None
        finally:
            cur.close()
    except Exception as e:
        log.warning(f"diagnostics fact counts failed: {e}")
    return counts


@router.get("/api/admin/diagnostics")
def diagnostics(_admin: dict = Depends(require_admin)):
    """Read-only diagnostics. Never raises — missing data returns nulls."""
    last_sync = None
    model_status = None
    host = None
    try:
        s = load_settings()
        last_sync = s.get("last_sync")
        model_status = s.get("model_status")
        host = (s.get("connection") or {}).get("host")
    except Exception as e:
        log.warning(f"diagnostics settings read failed: {e}")

    size_bytes = _warehouse_size_bytes()
    counts = _fact_counts()

    license_status = {"present": False, "valid": False}
    try:
        license_status = get_license_status()
    except Exception:
        pass

    return {
        "app_version":          APP_VERSION,
        "schema_version":       SCHEMA_VERSION,
        "last_sync":            last_sync,
        "model_status":         model_status,
        "connection_host":      host,
        "warehouse_size_bytes": size_bytes,
        "warehouse_size_mb":    round(size_bytes / 1_048_576, 1) if size_bytes else None,
        "fact_row_counts":      counts,
        "license":              license_status,
    }


@router.get("/api/admin/license")
def license_info(_admin: dict = Depends(require_admin)):
    """License status only (non-blocking, read-only)."""
    try:
        return get_license_status()
    except Exception:
        return {"present": False, "valid": False}
