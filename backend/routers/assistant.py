"""
AI Assistant Router — "talk to your data"
=========================================
  POST /api/assistant/ask     — ask a natural-language question (any user)
  GET  /api/assistant/config  — provider config, key never returned (admin)
  PUT  /api/assistant/config  — save provider config (admin)
  GET  /api/assistant/status  — enabled + provider, for the UI (any user)

Store/subsidiary scope from the JWT is enforced inside the SQL sandbox, so a
restricted user's questions can only ever see their own stores' rows.
"""
import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from routers.auth import get_current_user, require_admin
from routers.common import allowed_store_set, allowed_subsidiary_set
from services.config import load_settings, save_settings
from services import assistant

log = logging.getLogger(__name__)
router = APIRouter(tags=["assistant"])

_KEY_MASK = "••••••••"
_DEFAULTS = {"enabled": False, "provider": "ollama",
             "ollama_url": "http://localhost:11434", "base_url": "",
             "model": "", "api_key": ""}


def _cfg() -> dict:
    c = dict(_DEFAULTS)
    c.update(load_settings().get("assistant") or {})
    return c


def _current_host() -> str:
    return (load_settings().get("connection") or {}).get("host", "") or "local"


class AskReq(BaseModel):
    question: str


@router.get("/api/assistant/status")
def status(current: dict = Depends(get_current_user)):
    c = _cfg()
    return {"enabled": bool(c.get("enabled")), "provider": c.get("provider")}


@router.post("/api/assistant/ask")
def ask(req: AskReq, current: dict = Depends(get_current_user)):
    c = _cfg()
    if not c.get("enabled"):
        raise HTTPException(status_code=400,
                            detail="The AI assistant is turned off. An admin can enable it in Settings.")
    q = (req.question or "").strip()
    if not q:
        raise HTTPException(status_code=422, detail="Ask a question first.")
    if len(q) > 500:
        raise HTTPException(status_code=422, detail="Question is too long.")
    try:
        return assistant.ask(
            q, c, _current_host(),
            allowed_store_names=allowed_store_set(current),
            allowed_subsidiary_sids=allowed_subsidiary_set(current),
        )
    except RuntimeError as e:      # provider unreachable / bad response
        raise HTTPException(status_code=502, detail=str(e))


class ConfigReq(BaseModel):
    enabled:    bool = False
    provider:   str = "ollama"           # ollama | anthropic | openai
    ollama_url: Optional[str] = None
    base_url:   Optional[str] = None     # openai-compatible endpoint
    model:      Optional[str] = None
    api_key:    Optional[str] = None     # None / mask = keep stored


@router.get("/api/assistant/config")
def get_config(_admin: dict = Depends(require_admin)):
    c = _cfg()
    return {
        "enabled":    bool(c.get("enabled")),
        "provider":   c.get("provider", "ollama"),
        "ollama_url": c.get("ollama_url", "http://localhost:11434"),
        "base_url":   c.get("base_url", ""),
        "model":      c.get("model", ""),
        "has_key":    bool(c.get("api_key")),
    }


@router.put("/api/assistant/config")
def put_config(req: ConfigReq, _admin: dict = Depends(require_admin)):
    if req.provider not in ("ollama", "anthropic", "openai", "groq", "gemini"):
        raise HTTPException(status_code=422, detail="Unknown provider.")
    s = load_settings()
    cur = s.get("assistant") or dict(_DEFAULTS)
    cur.update({
        "enabled":    req.enabled,
        "provider":   req.provider,
        "ollama_url": (req.ollama_url or "").strip() or _DEFAULTS["ollama_url"],
        "base_url":   (req.base_url or "").strip(),
        "model":      (req.model or "").strip(),
    })
    # api_key: empty/None/mask → keep stored; otherwise replace
    if req.api_key and req.api_key != _KEY_MASK:
        cur["api_key"] = req.api_key
    s["assistant"] = cur
    save_settings(s)               # encrypts api_key at rest (DPAPI)
    return {"ok": True}
