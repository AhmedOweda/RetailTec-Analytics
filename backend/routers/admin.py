"""
Admin Router — maintenance & email
==================================
POST /api/admin/backup       — CHECKPOINT + copy the warehouse file (admin)
POST /api/admin/compact      — CHECKPOINT to flush WAL / reclaim space (admin)
GET  /api/admin/email        — email (SMTP) settings, password masked (admin)
PUT  /api/admin/email        — save email settings (password DPAPI-encrypted)
POST /api/admin/email/test   — send a test email to a given address (admin)
"""
import shutil
import smtplib
from datetime import datetime, date
from email.mime.text import MIMEText
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from db.model import DB_LOCK, get_db, _db_path, _current_settings_host, record_audit
from routers.auth import require_admin
from services.config import load_settings, save_settings

router = APIRouter(tags=["admin"])

_BACKUP_DIR = Path(__file__).parent.parent / "backups"


def _warehouse_file() -> Path:
    return Path(_db_path(_current_settings_host()))


# ── Backup ─────────────────────────────────────────────────────────────────────

class BackupReq(BaseModel):
    dest_folder: Optional[str] = None   # default: backend/backups


@router.post("/api/admin/backup")
def backup(req: BackupReq, _admin: dict = Depends(require_admin)):
    src = _warehouse_file()
    if not src.exists():
        raise HTTPException(status_code=404, detail="Warehouse file not found")
    dest_dir = Path(req.dest_folder) if req.dest_folder else _BACKUP_DIR
    try:
        dest_dir.mkdir(parents=True, exist_ok=True)
    except OSError as e:
        raise HTTPException(status_code=400, detail=f"Cannot create folder: {e}")
    stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    dest = dest_dir / f"{src.stem}_backup_{stamp}{src.suffix}"
    # DuckDB holds the file locked on Windows — a filesystem copy fails.
    # COPY FROM DATABASE writes a consistent (and compacted) copy natively.
    try:
        with DB_LOCK:
            cur = get_db().cursor()
            try:
                cat = cur.execute("SELECT current_database()").fetchone()[0]
                dest_sql = str(dest).replace("'", "''")
                cur.execute(f"ATTACH '{dest_sql}' AS __bak")
                cur.execute(f'COPY FROM DATABASE "{cat}" TO __bak')
                cur.execute("DETACH __bak")
            finally:
                cur.close()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Backup failed: {e}")
    record_audit(_admin["username"], "backup", str(dest))
    # Rotate: keep only the newest N backups (same retention as the auto-backup).
    try:
        from services.backup import prune_backups
        prune_backups(dest.parent, keep=int(load_settings().get("backup_retention", 6) or 6))
    except Exception:
        pass
    return {"ok": True, "path": str(dest),
            "size_mb": round(dest.stat().st_size / 1_048_576, 1)}


# ── Native path pickers ───────────────────────────────────────────────────────
# The app and the browser run on the SAME machine (127.0.0.1), so the backend
# can open a real Explorer dialog and hand the chosen path to the UI.

def _native_pick(kind: str) -> Optional[str]:
    import subprocess
    if kind == "folder":
        ps = ("Add-Type -AssemblyName System.Windows.Forms;"
              "$o = New-Object System.Windows.Forms.Form -Property @{TopMost=$true};"
              "$d = New-Object System.Windows.Forms.FolderBrowserDialog;"
              "if ($d.ShowDialog($o) -eq 'OK') { Write-Output $d.SelectedPath }")
    else:
        ps = ("Add-Type -AssemblyName System.Windows.Forms;"
              "$o = New-Object System.Windows.Forms.Form -Property @{TopMost=$true};"
              "$d = New-Object System.Windows.Forms.OpenFileDialog;"
              "$d.Filter = 'Database backup (*.db)|*.db|All files (*.*)|*.*';"
              "if ($d.ShowDialog($o) -eq 'OK') { Write-Output $d.FileName }")
    try:
        r = subprocess.run(
            ["powershell", "-NoProfile", "-STA", "-Command", ps],
            capture_output=True, text=True, timeout=300,
            creationflags=0x08000000,   # CREATE_NO_WINDOW - no console flash
        )
        p = (r.stdout or "").strip()
        return p or None
    except Exception:
        return None


@router.post("/api/admin/pick-folder")
def pick_folder(_admin: dict = Depends(require_admin)):
    """Open a native folder picker on the server machine; None if cancelled."""
    return {"path": _native_pick("folder")}


@router.post("/api/admin/pick-file")
def pick_file(_admin: dict = Depends(require_admin)):
    """Open a native file picker (.db) on the server machine; None if cancelled."""
    return {"path": _native_pick("file")}


# ── Restore ────────────────────────────────────────────────────────────────────

@router.get("/api/admin/backups")
def list_backups(_admin: dict = Depends(require_admin)):
    """Backups available for the CURRENT database host, newest first."""
    stem = _warehouse_file().stem
    out = []
    if _BACKUP_DIR.exists():
        for f in sorted(_BACKUP_DIR.glob(f"{stem}_backup_*"),
                        key=lambda p: p.stat().st_mtime, reverse=True):
            if f.is_file():
                out.append({
                    "file":    f.name,
                    "size_mb": round(f.stat().st_size / 1_048_576, 1),
                    "created": datetime.fromtimestamp(f.stat().st_mtime)
                                       .strftime("%Y-%m-%d %H:%M"),
                })
    return {"backups": out}


class RestoreReq(BaseModel):
    file: str


@router.post("/api/admin/restore")
def restore(req: RestoreReq, _admin: dict = Depends(require_admin)):
    """Replace the CURRENT warehouse with a backup file. The current warehouse
    is kept next to it as *.pre_restore.db so the restore itself is reversible."""
    import re
    import db.model as _m
    from db.sync import cancel_sync
    from services.config import load_settings as _ls

    name = (req.file or "").strip().strip('"')
    if not name.lower().endswith(".db"):
        raise HTTPException(status_code=400, detail="Backup must be a .db file")

    if "\\" in name or "/" in name:
        # Full path — restore from any folder (external drive, network share...)
        src = Path(name).resolve()
    else:
        # Bare name — resolve inside the default backups folder only.
        if not re.fullmatch(r"[A-Za-z0-9_.\-]+\.db", name):
            raise HTTPException(status_code=400, detail="Invalid backup file name")
        src = (_BACKUP_DIR / name).resolve()
        if src.parent != _BACKUP_DIR.resolve():
            raise HTTPException(status_code=400, detail="Invalid backup file name")
    if not src.exists():
        raise HTTPException(status_code=404, detail="Backup file not found")

    target = _warehouse_file()
    # The file must belong to the currently connected database: backups are
    # named <warehouse>_backup_<stamp>.db and manual copies keep the stem.
    if not src.name.startswith(target.stem):
        raise HTTPException(status_code=400,
                            detail=f"Backup belongs to a different database host (expected a file starting with {target.stem})")

    host = _current_settings_host()
    cancel_sync()
    try:
        with DB_LOCK:
            # Close the shared connection so Windows releases the file lock.
            if _m._conn is not None:
                try:
                    _m._conn.close()
                except Exception:
                    pass
                _m._conn = None
            # Safety copy of the current warehouse, then swap in the backup.
            if target.exists():
                shutil.copy2(target, target.with_name(target.stem + ".pre_restore.db"))
            shutil.copy2(src, target)
            wal = target.with_name(target.name + ".wal")
            if wal.exists():
                wal.unlink()   # stale WAL from the old file must not replay
        _m.switch_db(host)     # reopen + ensure_schema on the restored file
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Restore failed: {e}")

    try:
        from routers.sales import invalidate_dim_cache
        invalidate_dim_cache()   # restored warehouse = new stores/subsidiaries
    except Exception:
        pass
    record_audit(_admin["username"], "restore", req.file)
    try:
        n = _m.get_db().execute("SELECT COUNT(*) FROM FACT_SALES_INVOICES").fetchone()[0]
    except Exception:
        n = None
    return {"ok": True, "restored": req.file, "invoices": n}


@router.post("/api/admin/compact")
def compact(_admin: dict = Depends(require_admin)):
    src = _warehouse_file()
    before = src.stat().st_size if src.exists() else 0
    with DB_LOCK:
        get_db().execute("CHECKPOINT")
    after = src.stat().st_size if src.exists() else 0
    record_audit(_admin["username"], "compact_db")
    return {"ok": True,
            "before_mb": round(before / 1_048_576, 1),
            "after_mb":  round(after  / 1_048_576, 1)}


# ── Email (SMTP) ───────────────────────────────────────────────────────────────

class EmailCfg(BaseModel):
    host:      str = ""
    port:      int = 587
    username:  str = ""
    password:  Optional[str] = None   # None = keep stored password
    from_addr: str = ""
    use_tls:   bool = True


@router.get("/api/admin/email")
def get_email(_admin: dict = Depends(require_admin)):
    s = load_settings()
    email = s.get("email") or {}
    return {
        "host":      email.get("host", ""),
        "port":      email.get("port", 587),
        "username":  email.get("username", ""),
        "from_addr": email.get("from_addr", ""),
        "use_tls":   email.get("use_tls", True),
        "has_password": bool(email.get("password")),
    }


@router.put("/api/admin/email")
def put_email(cfg: EmailCfg, _admin: dict = Depends(require_admin)):
    s = load_settings()
    email = s.get("email") or {}
    email.update({
        "host": cfg.host.strip(), "port": cfg.port,
        "username": cfg.username.strip(),
        "from_addr": cfg.from_addr.strip(), "use_tls": cfg.use_tls,
    })
    if cfg.password:                       # empty/None = keep existing
        email["password"] = cfg.password
    s["email"] = email
    save_settings(s)                       # encrypts password at rest (DPAPI)
    record_audit(_admin["username"], "email_settings_saved", cfg.host)
    return {"ok": True}


# ── Scheduled reports (configurable list) ─────────────────────────────────────

class ReportDef(BaseModel):
    id:         Optional[str] = None
    type:       str  = "daily_sales"
    name:       str  = ""
    time:       str  = "07:00"
    stores:     str  = ""      # CSV of store names; "" = all stores
    recipients: str  = ""
    enabled:    bool = False
    last_sent:  Optional[str] = None


@router.get("/api/admin/reports")
def list_reports(_admin: dict = Depends(require_admin)):
    from services.report_email import get_reports, REPORT_TYPES
    return {"types": REPORT_TYPES, "reports": get_reports()}


class ReportsPut(BaseModel):
    reports: list[ReportDef]


@router.put("/api/admin/reports")
def put_reports(req: ReportsPut, _admin: dict = Depends(require_admin)):
    from services.report_email import save_reports, REPORT_TYPES
    for r in req.reports:
        if r.type not in REPORT_TYPES:
            raise HTTPException(status_code=400, detail=f"Unknown report type: {r.type}")
    save_reports([r.dict() for r in req.reports])
    record_audit(_admin["username"], "report_schedules_saved", f"{len(req.reports)} report(s)")
    return {"ok": True}


class SendReportReq(BaseModel):
    report: ReportDef   # send this definition as-is (doesn't have to be saved)


@router.post("/api/admin/reports/send")
def send_report_now(req: SendReportReq, _admin: dict = Depends(require_admin)):
    from services.report_email import send_one
    try:
        subject = send_one(req.report.dict())
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Send failed: {e}")
    return {"ok": True, "message": f"Sent: {subject}"}


class TestEmailReq(BaseModel):
    to: str


@router.post("/api/admin/email/test")
def test_email(req: TestEmailReq, _admin: dict = Depends(require_admin)):
    s = load_settings()
    email = s.get("email") or {}
    host = email.get("host")
    if not host:
        raise HTTPException(status_code=400, detail="Configure and save SMTP settings first")
    msg = MIMEText("This is a test email from RetailTec Analytics. "
                   "Your SMTP settings are working.")
    msg["Subject"] = "RetailTec Analytics — test email"
    msg["From"]    = email.get("from_addr") or email.get("username", "")
    msg["To"]      = req.to
    try:
        with smtplib.SMTP(host, int(email.get("port", 587)), timeout=20) as smtp:
            if email.get("use_tls", True):
                smtp.starttls()
            if email.get("username"):
                smtp.login(email["username"], email.get("password", ""))
            smtp.send_message(msg)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Send failed: {e}")
    return {"ok": True, "message": f"Test email sent to {req.to}"}


# ── Audit log viewer ───────────────────────────────────────────────────────────

@router.get("/api/admin/audit")
def get_audit(limit: int = 500,
              date_from: Optional[date] = Query(None),
              date_to:   Optional[date] = Query(None),
              _admin: dict = Depends(require_admin)):
    limit = max(1, min(int(limit), 5000))
    where, params = "", []
    if date_from is not None:
        where += " AND CAST(ts AS DATE) >= ?"
        params.append(date_from)
    if date_to is not None:
        where += " AND CAST(ts AS DATE) <= ?"
        params.append(date_to)
    with DB_LOCK:
        cur = get_db().cursor()
    try:
        rel = cur.execute(
            f"SELECT ts, username, action, detail FROM AUDIT_LOG WHERE 1=1 {where} "
            f"ORDER BY ts DESC LIMIT {limit}", params)
        cols = [d[0] for d in rel.description]
        return [dict(zip(cols, r)) for r in rel.fetchall()]
    finally:
        cur.close()
