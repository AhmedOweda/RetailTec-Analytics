"""
Central settings loader/saver for backend/settings.json
========================================================
Single source of truth for reading/writing settings — used by
routers/settings.py, db/sync.py and services/scheduler.py.

The Oracle password is encrypted at rest with Windows DPAPI
(current-user scope), stored as "dpapi:<base64>" (EXPERT_REVIEW.md C3).
On non-Windows dev machines it falls back to plaintext with a log warning.
Existing plaintext settings files are migrated transparently on first load.
"""
import base64
import json
import logging
import os
import sys
import tempfile
import threading
from pathlib import Path

log = logging.getLogger(__name__)

SETTINGS_FILE = Path(__file__).parent.parent / "settings.json"
_DPAPI_PREFIX = "dpapi:"

# One lock for every read-modify-write of settings.json. Three writers used to
# race (settings router, sync completion, report scheduler) — a sync finishing
# while the admin saved a new connection could write the OLD connection back.
_SETTINGS_LOCK = threading.RLock()

_DEFAULTS = {
    "connection":   {"host": "", "port": 1521, "sid": "", "username": "", "password": ""},
    "data_model":   {"initial_load_days": 365, "incremental_window_days": 7,
                     "background_refresh_minutes": 30},
    "last_sync":    None,
    "model_status": "empty",
    # Whitelabel branding (optional; safe defaults). brand_logo is an optional
    # base64 data-URL or file path shown in the app header/sidebar.
    "brand_name":   "RetailTec Analytics",
    "brand_logo":   "",
    # First-run + maintenance. auto_maintenance defaults ON for NEW installs
    # (i.e. when the key is absent); setup_complete gates the first-run wizard.
    "auto_maintenance": True,
    "setup_complete":   False,
    # Monthly auto-backup retention: how many backup files to keep (oldest pruned).
    "backup_retention": 6,
}


# ── Windows DPAPI via ctypes (no extra dependency) ────────────────────────────

def _dpapi_available() -> bool:
    return sys.platform == "win32"


if _dpapi_available():
    import ctypes
    import ctypes.wintypes

    class _DATA_BLOB(ctypes.Structure):
        _fields_ = [("cbData", ctypes.wintypes.DWORD),
                    ("pbData", ctypes.POINTER(ctypes.c_char))]

    def _blob_out(blob: "_DATA_BLOB") -> bytes:
        data = ctypes.string_at(blob.pbData, blob.cbData)
        ctypes.windll.kernel32.LocalFree(blob.pbData)
        return data

    def _dpapi_protect(plain: str) -> str:
        blob_in  = _DATA_BLOB(len(plain.encode()), ctypes.cast(
            ctypes.create_string_buffer(plain.encode()), ctypes.POINTER(ctypes.c_char)))
        blob_out = _DATA_BLOB()
        if not ctypes.windll.crypt32.CryptProtectData(
                ctypes.byref(blob_in), None, None, None, None, 0, ctypes.byref(blob_out)):
            raise OSError("CryptProtectData failed")
        return _DPAPI_PREFIX + base64.b64encode(_blob_out(blob_out)).decode()

    def _dpapi_unprotect(token: str) -> str:
        raw = base64.b64decode(token[len(_DPAPI_PREFIX):])
        blob_in  = _DATA_BLOB(len(raw), ctypes.cast(
            ctypes.create_string_buffer(raw), ctypes.POINTER(ctypes.c_char)))
        blob_out = _DATA_BLOB()
        if not ctypes.windll.crypt32.CryptUnprotectData(
                ctypes.byref(blob_in), None, None, None, None, 0, ctypes.byref(blob_out)):
            raise OSError("CryptUnprotectData failed")
        return _blob_out(blob_out).decode()
else:
    def _dpapi_protect(plain: str) -> str:      # pragma: no cover — dev fallback
        return plain

    def _dpapi_unprotect(token: str) -> str:    # pragma: no cover
        return token


def _encrypt_password(pw: str) -> str:
    if not pw or pw.startswith(_DPAPI_PREFIX):
        return pw
    if not _dpapi_available():
        log.warning("DPAPI unavailable on this platform — Oracle password stored in plaintext")
        return pw
    return _dpapi_protect(pw)


def _decrypt_password(pw: str) -> str:
    if pw and pw.startswith(_DPAPI_PREFIX):
        try:
            return _dpapi_unprotect(pw)
        except Exception as e:
            log.error(f"Failed to decrypt stored Oracle password: {e}")
            return ""
    return pw


# ── Public API ────────────────────────────────────────────────────────────────

def load_settings() -> dict:
    """Read settings.json; the returned dict always has PLAINTEXT passwords
    (decrypted in memory only)."""
    with _SETTINGS_LOCK:
        if not SETTINGS_FILE.exists():
            return json.loads(json.dumps(_DEFAULTS))
        data = json.loads(SETTINGS_FILE.read_text())
        conn = data.get("connection", {})
        stored = conn.get("password", "")
        conn["password"] = _decrypt_password(stored)
        email = data.get("email")
        if email and email.get("password"):
            email["password"] = _decrypt_password(email["password"])
        # Transparent migration: re-save plaintext files encrypted
        if stored and not stored.startswith(_DPAPI_PREFIX) and _dpapi_available():
            try:
                save_settings(data)
            except OSError:
                pass
        return data


def save_settings(data: dict) -> None:
    """Write settings.json, encrypting passwords at rest.

    ATOMIC: writes to a temp file in the same directory then os.replace()s it
    over settings.json. The old truncate-then-write left a window where any
    reader (get_db used to re-read the file per call) saw truncated JSON and
    silently fell back to the empty 'local' warehouse — blank dashboards."""
    with _SETTINGS_LOCK:
        out = json.loads(json.dumps(data, default=str))
        conn = out.get("connection", {})
        if conn.get("password"):
            conn["password"] = _encrypt_password(conn["password"])
        email = out.get("email")
        if email and email.get("password"):
            email["password"] = _encrypt_password(email["password"])
        payload = json.dumps(out, indent=2, default=str)
        fd, tmp = tempfile.mkstemp(dir=str(SETTINGS_FILE.parent),
                                   prefix=".settings_", suffix=".tmp")
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as f:
                f.write(payload)
            os.replace(tmp, SETTINGS_FILE)
        except BaseException:
            try:
                os.unlink(tmp)
            except OSError:
                pass
            raise


def update_settings_fields(**patch) -> dict:
    """Locked read-modify-write for callers that only touch a few top-level
    keys (e.g. sync completion writing last_sync/model_status). Prevents the
    lost-update race between concurrent writers. Returns the saved dict."""
    with _SETTINGS_LOCK:
        data = load_settings()
        data.update(patch)
        save_settings(data)
        return data
