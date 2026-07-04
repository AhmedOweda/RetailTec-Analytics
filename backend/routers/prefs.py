"""
User preferences router
=======================
Per-user UI preferences (grid column layouts, etc.), stored server-side so
they follow the user to any machine.

GET    /api/prefs            — all prefs for the current user  {key: value}
GET    /api/prefs/{key}      — one pref (204-style null if missing)
PUT    /api/prefs/{key}      — upsert  (body: {"value": "<json string>"})
DELETE /api/prefs/{key}      — remove (reset to default)
"""
from datetime import datetime

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from db.model import DB_LOCK, get_db
from routers.auth import get_current_user

router = APIRouter(tags=["prefs"])

_MAX_VALUE_LEN = 200_000   # sanity cap per pref


def _q(sql: str, params=None):
    with DB_LOCK:
        cur = get_db().cursor()
    try:
        return cur.execute(sql, params or []).fetchall()
    finally:
        cur.close()


@router.get("/api/prefs")
def get_all_prefs(current: dict = Depends(get_current_user)):
    rows = _q("SELECT pref_key, pref_value FROM USER_PREFS WHERE user_id = ?",
              [current["id"]])
    return {k: v for k, v in rows}


@router.get("/api/prefs/{key}")
def get_pref(key: str, current: dict = Depends(get_current_user)):
    rows = _q("SELECT pref_value FROM USER_PREFS WHERE user_id = ? AND pref_key = ?",
              [current["id"], key])
    return {"key": key, "value": rows[0][0] if rows else None}


class PrefPut(BaseModel):
    value: str


@router.put("/api/prefs/{key}")
def put_pref(key: str, req: PrefPut, current: dict = Depends(get_current_user)):
    value = req.value[:_MAX_VALUE_LEN]
    now = datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S")
    with DB_LOCK:
        con = get_db()
        con.execute("DELETE FROM USER_PREFS WHERE user_id = ? AND pref_key = ?",
                    [current["id"], key])
        con.execute("INSERT INTO USER_PREFS VALUES (?, ?, ?, ?)",
                    [current["id"], key, value, now])
        con.commit()
    return {"ok": True}


@router.delete("/api/prefs/{key}")
def delete_pref(key: str, current: dict = Depends(get_current_user)):
    with DB_LOCK:
        con = get_db()
        con.execute("DELETE FROM USER_PREFS WHERE user_id = ? AND pref_key = ?",
                    [current["id"], key])
        con.commit()
    return {"ok": True}
