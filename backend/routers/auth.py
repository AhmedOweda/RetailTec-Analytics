"""
Auth Router
===========
POST /api/auth/login        — username + password → JWT
GET  /api/auth/me           — current user from token
GET  /api/auth/users        — list users (admin only)
POST /api/auth/users        — create user (admin only)
PUT  /api/auth/users/{id}   — update user (admin only)
DELETE /api/auth/users/{id} — delete user (admin only)
GET  /api/auth/debug        — TEMP: shows DB state (remove in prod)
"""
import os
import secrets as _secrets
import threading
from datetime import datetime, timedelta
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from jose import JWTError, jwt
from pydantic import BaseModel

from db.model import DB_LOCK, get_db, hash_password, verify_password, record_audit
# Note: hash_password/verify_password now use stdlib hashlib — no passlib needed

router = APIRouter(tags=["auth"])
_db_lock = DB_LOCK   # shared process-wide DuckDB lock — never create a second one

# ── JWT config ────────────────────────────────────────────────────────────────
# Secret resolution order (EXPERT_REVIEW.md C3 — never hardcode):
#   1. RETAILTEC_JWT_SECRET env var
#   2. backend/.jwt_secret file (auto-generated on first run, gitignored)
_SECRET_FILE = Path(__file__).parent.parent / ".jwt_secret"

def _load_jwt_secret() -> str:
    env = os.environ.get("RETAILTEC_JWT_SECRET", "").strip()
    if env:
        return env
    try:
        if _SECRET_FILE.exists():
            existing = _SECRET_FILE.read_text().strip()
            if existing:
                return existing
        generated = _secrets.token_hex(32)
        _SECRET_FILE.write_text(generated)
        return generated
    except OSError:
        # Last resort: ephemeral secret (tokens won't survive a restart)
        return _secrets.token_hex(32)

SECRET_KEY = _load_jwt_secret()
ALGORITHM  = "HS256"
TOKEN_EXPIRE_HOURS = 12

_DEFAULT_ADMIN_PASSWORD = "Retailtec@123"   # only used to seed + detect unchanged installs

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/login", auto_error=False)


# ── Helpers ───────────────────────────────────────────────────────────────────

def _qdf(sql: str, params=None) -> list[dict]:
    # Per-request cursor: auth reads (every request's token check!) must not
    # queue behind a running sync on the shared connection.
    with _db_lock:
        cur = get_db().cursor()
    try:
        rel = cur.execute(sql, params or [])
        cols = [d[0] for d in rel.description]
        return [dict(zip(cols, row)) for row in rel.fetchall()]
    finally:
        cur.close()


def _create_token(data: dict) -> str:
    payload = data.copy()
    payload["exp"] = datetime.utcnow() + timedelta(hours=TOKEN_EXPIRE_HOURS)
    return jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)


def _decode_token(token: str) -> dict:
    return jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])


def _get_user_by_username(username: str) -> Optional[dict]:
    # Case-insensitive: 'Oweda' and 'oweda' are the same account
    rows = _qdf(
        "SELECT id, username, password_hash, role, stores, full_name, is_active, pages, subsidiaries "
        "FROM DIM_USERS WHERE LOWER(username) = LOWER(?) AND is_active = true",
        [username]
    )
    return rows[0] if rows else None


def _next_id() -> int:
    with _db_lock:
        r = get_db().execute("SELECT COALESCE(MAX(id), 0) + 1 FROM DIM_USERS").fetchone()
        return int(r[0])


def _ensure_admin():
    """Ensure admin user exists with correct password — called at first request."""
    with _db_lock:
        con = get_db()
        row = con.execute(
            "SELECT id, password_hash FROM DIM_USERS WHERE username = 'admin'"
        ).fetchone()
        if row is None:
            # No admin at all — create it
            con.execute(
                "INSERT INTO DIM_USERS (id, username, password_hash, role, full_name, is_active, created_at) "
                "VALUES (1, 'admin', ?, 'admin', 'System Administrator', true, ?)",
                [hash_password(_DEFAULT_ADMIN_PASSWORD),
                 datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S")]
            )
            con.commit()
            return "created"
        else:
            # Reset to new password if still on old default
            if verify_password("admin123", row[1]):
                con.execute(
                    "UPDATE DIM_USERS SET password_hash = ? WHERE username = 'admin'",
                    [hash_password(_DEFAULT_ADMIN_PASSWORD)]
                )
                con.commit()
                return "migrated"
            return "ok"


_admin_migrated = False   # run lazily on first login request, not at import time


# ── Dependency: get current user ──────────────────────────────────────────────

def get_current_user(token: str = Depends(oauth2_scheme)) -> dict:
    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated")
    try:
        payload = _decode_token(token)
        username: str = payload.get("sub")
        if not username:
            raise HTTPException(status_code=401, detail="Invalid token")
    except JWTError:
        raise HTTPException(status_code=401, detail="Token expired or invalid")

    user = _get_user_by_username(username)
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
    return user


def require_admin(current: dict = Depends(get_current_user)) -> dict:
    if current["role"] != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")
    return current


# ── Schemas ───────────────────────────────────────────────────────────────────

class LoginRequest(BaseModel):
    username: str
    password: str


class UserCreate(BaseModel):
    username:  str
    password:  str
    role:      str = "viewer"
    full_name: str = ""
    stores:    Optional[str] = None
    pages:     Optional[str] = None   # CSV of page keys; None = all pages
    subsidiaries: Optional[str] = None   # CSV of subsidiary SIDs; None = all


class UserUpdate(BaseModel):
    password:  Optional[str] = None
    role:      Optional[str] = None
    full_name: Optional[str] = None
    stores:    Optional[str] = None
    is_active: Optional[bool] = None
    pages:     Optional[str] = None   # CSV of page keys; '' clears to all pages
    subsidiaries: Optional[str] = None   # CSV of subsidiary SIDs; '' clears to all


# ── Login ─────────────────────────────────────────────────────────────────────

@router.post("/api/auth/login")
def login(req: LoginRequest):
    global _admin_migrated
    if not _admin_migrated:
        try:
            _ensure_admin()
            _admin_migrated = True
        except Exception as e:
            print(f"[auth] ensure_admin failed: {e}")

    user = _get_user_by_username(req.username)
    if not user or not verify_password(req.password, user["password_hash"]):
        record_audit(req.username, "login_failed")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect username or password",
        )
    token = _create_token({
        "sub":    user["username"],
        "role":   user["role"],
        "stores": user["stores"],
        "subsidiaries": user["subsidiaries"],
        "id":     user["id"],
    })
    record_audit(user["username"], "login")
    # Flag accounts still on the seeded default password so the UI can force a change
    must_change = verify_password(_DEFAULT_ADMIN_PASSWORD, user["password_hash"])
    return {
        "access_token": token,
        "token_type":   "bearer",
        "must_change_password": must_change,
        "user": {
            "id":        user["id"],
            "username":  user["username"],
            "role":      user["role"],
            "full_name": user["full_name"],
            "stores":    user["stores"],
            # CSV of allowed page keys; NULL/admin = all pages
            "pages":     None if user["role"] == "admin" else user.get("pages"),
            "subsidiaries": None if user["role"] == "admin" else user.get("subsidiaries"),
        },
    }


# ── Change own password ───────────────────────────────────────────────────────

class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password:     str


@router.post("/api/auth/change-password")
def change_password(req: ChangePasswordRequest,
                    current: dict = Depends(get_current_user)):
    if not verify_password(req.current_password, current["password_hash"]):
        raise HTTPException(status_code=401, detail="Current password is incorrect")
    if len(req.new_password) < 8:
        raise HTTPException(status_code=400, detail="New password must be at least 8 characters")
    if req.new_password == _DEFAULT_ADMIN_PASSWORD:
        raise HTTPException(status_code=400, detail="New password cannot be the default password")
    with _db_lock:
        get_db().execute(
            "UPDATE DIM_USERS SET password_hash = ? WHERE id = ?",
            [hash_password(req.new_password), current["id"]]
        )
        get_db().commit()
    record_audit(current["username"], "change_password")
    return {"ok": True}


# ── Me ────────────────────────────────────────────────────────────────────────

@router.get("/api/auth/me")
def me(current: dict = Depends(get_current_user)):
    return {
        "id":        current["id"],
        "username":  current["username"],
        "role":      current["role"],
        "full_name": current["full_name"],
        "stores":    current["stores"],
        "pages":     None if current["role"] == "admin" else current.get("pages"),
        "subsidiaries": None if current["role"] == "admin" else current.get("subsidiaries"),
    }


# ── List users ────────────────────────────────────────────────────────────────

@router.get("/api/auth/users")
def list_users(current: dict = Depends(require_admin)):
    return _qdf(
        "SELECT id, username, role, full_name, stores, is_active, created_at, pages, subsidiaries "
        "FROM DIM_USERS ORDER BY id"
    )


# ── Create user ───────────────────────────────────────────────────────────────

@router.post("/api/auth/users", status_code=201)
def create_user(req: UserCreate, current: dict = Depends(require_admin)):
    existing = _qdf("SELECT id FROM DIM_USERS WHERE LOWER(username) = LOWER(?)", [req.username])
    if existing:
        raise HTTPException(status_code=409, detail="Username already exists")

    if req.role not in ("admin", "manager", "viewer"):
        raise HTTPException(status_code=400, detail="Role must be admin, manager, or viewer")

    new_id = _next_id()
    with _db_lock:
        get_db().execute(
            "INSERT INTO DIM_USERS (id, username, password_hash, role, full_name, stores, is_active, created_at, pages, subsidiaries) "
            "VALUES (?, ?, ?, ?, ?, ?, true, ?, ?, ?)",
            [new_id, req.username, hash_password(req.password),
             req.role, req.full_name, req.stores,
             datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S"),
             req.pages or None, req.subsidiaries or None]
        )
        get_db().commit()

    record_audit(current["username"], "user_created", f"{req.username} ({req.role})")
    return {"id": new_id, "username": req.username, "role": req.role}


# ── Update user ───────────────────────────────────────────────────────────────

@router.put("/api/auth/users/{user_id}")
def update_user(user_id: int, req: UserUpdate, current: dict = Depends(require_admin)):
    rows = _qdf("SELECT id FROM DIM_USERS WHERE id = ?", [user_id])
    if not rows:
        raise HTTPException(status_code=404, detail="User not found")

    if user_id == current["id"] and req.role and req.role != "admin":
        raise HTTPException(status_code=400, detail="Cannot demote your own admin account")

    sets, vals = [], []
    if req.password is not None:
        sets.append("password_hash = ?"); vals.append(hash_password(req.password))
    if req.role is not None:
        if req.role not in ("admin", "manager", "viewer"):
            raise HTTPException(status_code=400, detail="Invalid role")
        sets.append("role = ?"); vals.append(req.role)
    if req.full_name is not None:
        sets.append("full_name = ?"); vals.append(req.full_name)
    if req.stores is not None:
        sets.append("stores = ?"); vals.append(req.stores or None)
    if req.is_active is not None:
        sets.append("is_active = ?"); vals.append(req.is_active)
    if req.pages is not None:
        sets.append("pages = ?"); vals.append(req.pages or None)
    if req.subsidiaries is not None:
        sets.append("subsidiaries = ?"); vals.append(req.subsidiaries or None)

    if sets:
        vals.append(user_id)
        with _db_lock:
            get_db().execute(f"UPDATE DIM_USERS SET {', '.join(sets)} WHERE id = ?", vals)
            get_db().commit()

    record_audit(current["username"], "user_updated", f"id={user_id}")
    return {"ok": True}


# ── Delete user ───────────────────────────────────────────────────────────────

@router.delete("/api/auth/users/{user_id}")
def delete_user(user_id: int, current: dict = Depends(require_admin)):
    if user_id == current["id"]:
        raise HTTPException(status_code=400, detail="Cannot delete your own account")
    with _db_lock:
        get_db().execute("DELETE FROM DIM_USERS WHERE id = ?", [user_id])
        get_db().commit()
    record_audit(current["username"], "user_deleted", f"id={user_id}")
    return {"ok": True}
