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
import threading
from datetime import datetime, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from jose import JWTError, jwt
from pydantic import BaseModel

from db.model import get_db, hash_password, verify_password
# Note: hash_password/verify_password now use stdlib hashlib — no passlib needed

router = APIRouter(tags=["auth"])
_db_lock = threading.Lock()

# ── JWT config ────────────────────────────────────────────────────────────────
SECRET_KEY = "retailtec-jwt-secret-change-in-prod-2024"
ALGORITHM  = "HS256"
TOKEN_EXPIRE_HOURS = 12

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/login", auto_error=False)


# ── Helpers ───────────────────────────────────────────────────────────────────

def _qdf(sql: str, params=None) -> list[dict]:
    with _db_lock:
        con = get_db()
        rel = con.execute(sql, params or [])
        cols = [d[0] for d in rel.description]
        return [dict(zip(cols, row)) for row in rel.fetchall()]


def _create_token(data: dict) -> str:
    payload = data.copy()
    payload["exp"] = datetime.utcnow() + timedelta(hours=TOKEN_EXPIRE_HOURS)
    return jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)


def _decode_token(token: str) -> dict:
    return jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])


def _get_user_by_username(username: str) -> Optional[dict]:
    rows = _qdf(
        "SELECT id, username, password_hash, role, stores, full_name, is_active "
        "FROM DIM_USERS WHERE username = ? AND is_active = true",
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
                [hash_password("Retailtec@123"),
                 datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S")]
            )
            con.commit()
            return "created"
        else:
            # Reset to new password if still on old default
            if verify_password("admin123", row[1]):
                con.execute(
                    "UPDATE DIM_USERS SET password_hash = ? WHERE username = 'admin'",
                    [hash_password("Retailtec@123")]
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


class UserUpdate(BaseModel):
    password:  Optional[str] = None
    role:      Optional[str] = None
    full_name: Optional[str] = None
    stores:    Optional[str] = None
    is_active: Optional[bool] = None


# ── Debug (remove in prod) ────────────────────────────────────────────────────

@router.get("/api/auth/debug")
def debug():
    rows = _qdf("SELECT id, username, role, is_active FROM DIM_USERS ORDER BY id")
    result = _ensure_admin()
    return {"users": rows, "ensure_admin": result}


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
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect username or password",
        )
    token = _create_token({
        "sub":    user["username"],
        "role":   user["role"],
        "stores": user["stores"],
        "id":     user["id"],
    })
    return {
        "access_token": token,
        "token_type":   "bearer",
        "user": {
            "id":        user["id"],
            "username":  user["username"],
            "role":      user["role"],
            "full_name": user["full_name"],
            "stores":    user["stores"],
        },
    }


# ── Me ────────────────────────────────────────────────────────────────────────

@router.get("/api/auth/me")
def me(current: dict = Depends(get_current_user)):
    return {
        "id":        current["id"],
        "username":  current["username"],
        "role":      current["role"],
        "full_name": current["full_name"],
        "stores":    current["stores"],
    }


# ── List users ────────────────────────────────────────────────────────────────

@router.get("/api/auth/users")
def list_users(current: dict = Depends(require_admin)):
    return _qdf(
        "SELECT id, username, role, full_name, stores, is_active, created_at "
        "FROM DIM_USERS ORDER BY id"
    )


# ── Create user ───────────────────────────────────────────────────────────────

@router.post("/api/auth/users", status_code=201)
def create_user(req: UserCreate, current: dict = Depends(require_admin)):
    existing = _qdf("SELECT id FROM DIM_USERS WHERE username = ?", [req.username])
    if existing:
        raise HTTPException(status_code=409, detail="Username already exists")

    if req.role not in ("admin", "manager", "viewer"):
        raise HTTPException(status_code=400, detail="Role must be admin, manager, or viewer")

    new_id = _next_id()
    with _db_lock:
        get_db().execute(
            "INSERT INTO DIM_USERS (id, username, password_hash, role, full_name, stores, is_active, created_at) "
            "VALUES (?, ?, ?, ?, ?, ?, true, ?)",
            [new_id, req.username, hash_password(req.password),
             req.role, req.full_name, req.stores,
             datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S")]
        )
        get_db().commit()

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

    if sets:
        vals.append(user_id)
        with _db_lock:
            get_db().execute(f"UPDATE DIM_USERS SET {', '.join(sets)} WHERE id = ?", vals)
            get_db().commit()

    return {"ok": True}


# ── Delete user ───────────────────────────────────────────────────────────────

@router.delete("/api/auth/users/{user_id}")
def delete_user(user_id: int, current: dict = Depends(require_admin)):
    if user_id == current["id"]:
        raise HTTPException(status_code=400, detail="Cannot delete your own account")
    with _db_lock:
        get_db().execute("DELETE FROM DIM_USERS WHERE id = ?", [user_id])
        get_db().commit()
    return {"ok": True}
