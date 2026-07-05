"""
Warehouse backup + retention
=============================
Native DuckDB `COPY FROM DATABASE` backup (a plain filesystem copy fails on
Windows while DuckDB holds the file open) plus keep-last-N rotation. Shared by
the manual admin endpoint and the scheduled monthly auto-backup.
"""
import logging
from datetime import datetime
from pathlib import Path
from typing import Optional

from db.model import DB_LOCK, get_db, _db_path, _current_settings_host

log = logging.getLogger(__name__)

BACKUP_DIR = Path(__file__).parent.parent / "backups"
_GLOB = "*_backup_*"


def warehouse_file() -> Path:
    return Path(_db_path(_current_settings_host()))


def create_backup(dest_dir: Optional[Path] = None) -> Path:
    """Write a consistent, compacted copy of the warehouse; return its path.
    Raises FileNotFoundError if the warehouse doesn't exist, or on copy failure."""
    src = warehouse_file()
    if not src.exists():
        raise FileNotFoundError("Warehouse file not found")
    d = Path(dest_dir) if dest_dir else BACKUP_DIR
    d.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    dest = d / f"{src.stem}_backup_{stamp}{src.suffix}"
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
    return dest


def prune_backups(dest_dir: Optional[Path] = None, keep: int = 6) -> int:
    """Delete the oldest backup files beyond the newest `keep`. Best-effort;
    never raises. Returns the number of files deleted."""
    try:
        d = Path(dest_dir) if dest_dir else BACKUP_DIR
        if not d.exists() or keep < 0:
            return 0
        files = sorted(
            [f for f in d.glob(_GLOB) if f.is_file()],
            key=lambda f: f.stat().st_mtime, reverse=True,
        )
        deleted = 0
        for f in files[keep:]:
            try:
                f.unlink(); deleted += 1
            except OSError:
                pass
        return deleted
    except Exception as e:
        log.warning(f"prune_backups failed: {e}")
        return 0


def newest_backup_age_days(dest_dir: Optional[Path] = None) -> float:
    """Age in days of the most recent backup; a huge number when none exist.
    Filesystem-derived so the monthly cadence survives process restarts."""
    try:
        d = Path(dest_dir) if dest_dir else BACKUP_DIR
        files = [f for f in d.glob(_GLOB) if f.is_file()] if d.exists() else []
        if not files:
            return 1e9
        newest = max(f.stat().st_mtime for f in files)
        return (datetime.now().timestamp() - newest) / 86400.0
    except Exception:
        return 1e9
