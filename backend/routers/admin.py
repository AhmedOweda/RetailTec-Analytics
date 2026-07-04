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
from datetime import datetime
from email.mime.text import MIMEText
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
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
    return {"ok": True, "path": str(dest),
            "size_mb": round(dest.stat().st_size / 1_048_576, 1)}


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
def get_audit(limit: int = 500, _admin: dict = Depends(require_admin)):
    limit = max(1, min(int(limit), 5000))
    with DB_LOCK:
        cur = get_db().cursor()
    try:
        rel = cur.execute(
            f"SELECT ts, username, action, detail FROM AUDIT_LOG ORDER BY ts DESC LIMIT {limit}")
        cols = [d[0] for d in rel.description]
        return [dict(zip(cols, r)) for r in rel.fetchall()]
    finally:
        cur.close()
