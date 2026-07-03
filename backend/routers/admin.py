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

from db.model import DB_LOCK, get_db, _db_path, _current_settings_host
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
    return {"ok": True, "path": str(dest),
            "size_mb": round(dest.stat().st_size / 1_048_576, 1)}


@router.post("/api/admin/compact")
def compact(_admin: dict = Depends(require_admin)):
    src = _warehouse_file()
    before = src.stat().st_size if src.exists() else 0
    with DB_LOCK:
        get_db().execute("CHECKPOINT")
    after = src.stat().st_size if src.exists() else 0
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
    # Daily report schedule
    report_enabled:    bool = False
    report_time:       str  = "07:00"
    report_recipients: str  = ""


@router.get("/api/admin/email")
def get_email(_admin: dict = Depends(require_admin)):
    s = load_settings()
    email = s.get("email") or {}
    rpt = email.get("report") or {}
    return {
        "host":      email.get("host", ""),
        "port":      email.get("port", 587),
        "username":  email.get("username", ""),
        "from_addr": email.get("from_addr", ""),
        "use_tls":   email.get("use_tls", True),
        "has_password": bool(email.get("password")),
        "report_enabled":    rpt.get("enabled", False),
        "report_time":       rpt.get("time", "07:00"),
        "report_recipients": rpt.get("recipients", ""),
        "report_last_sent":  rpt.get("last_sent"),
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
    rpt = email.get("report") or {}
    rpt.update({"enabled": cfg.report_enabled,
                "time": cfg.report_time.strip() or "07:00",
                "recipients": cfg.report_recipients.strip()})
    email["report"] = rpt
    s["email"] = email
    save_settings(s)                       # encrypts password at rest (DPAPI)
    return {"ok": True}


class SendReportReq(BaseModel):
    to: Optional[str] = None   # CSV; default = saved report recipients


@router.post("/api/admin/email/send-report")
def send_report_now(req: SendReportReq, _admin: dict = Depends(require_admin)):
    from services.report_email import send_report
    s = load_settings()
    rpt = (s.get("email") or {}).get("report") or {}
    csv = (req.to or rpt.get("recipients") or "").strip()
    recipients = [r.strip() for r in csv.split(",") if r.strip()]
    if not recipients:
        raise HTTPException(status_code=400, detail="No recipients configured")
    try:
        subject = send_report(recipients)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Send failed: {e}")
    return {"ok": True, "message": f"Report sent to {', '.join(recipients)}",
            "subject": subject}


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
