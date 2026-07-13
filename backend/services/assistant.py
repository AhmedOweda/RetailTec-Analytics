"""
AI Assistant — provider-agnostic "talk to your data"
====================================================
Turns a natural-language question into a safe SQL query (services.assistant_sql),
runs it, and turns the resulting rows back into a plain-language answer.

Providers (configured per install in settings.json → "assistant"):
  • ollama   — fully local/offline model via the Ollama HTTP API. No data leaves
               the machine. Recommended for the offline product; slower on
               modest PCs.
  • anthropic / openai — cloud APIs. Stronger quality, needs internet; the SCHEMA
               and the QUESTION are sent to the provider, never the row data
               beyond what's needed to phrase the final answer (capped).

Only stdlib urllib is used (no new packaged dependency).
"""
import json
import logging
import urllib.request
import urllib.error

from db.model import _db_path
from services import assistant_sql as guard

log = logging.getLogger(__name__)

_HTTP_TIMEOUT = 60

# Default model per provider (the admin can override in settings).
_DEFAULT_MODEL = {
    "ollama":    "qwen2.5-coder:7b",
    "anthropic": "claude-sonnet-5",
    "groq":      "llama-3.3-70b-versatile",
    "gemini":    "gemini-2.5-flash",
    "openai":    "gpt-4o-mini",
}


# ── Schema description fed to the model ───────────────────────────────────────

# Non-obvious Prism/warehouse semantics the model must know to write correct SQL.
_HINTS = """
SEMANTIC NOTES (critical for correct SQL):
- Money/quantity live on FACT tables; names/attributes live on DIM tables. Join
  FACT.<X>_SID = DIM_<X>.SID (e.g. FACT_SALES_ITEMS.ITEM_SID = DIM_ITEM.SID,
  .STORE_SID = DIM_STORE.SID). Item department/class/subclass: DIM_ITEM.DCS_SID
  = DIM_DCS.SID (D_NAME=department, C_NAME=class, S_NAME=subclass). Vendor:
  DIM_ITEM.VEND_SID = DIM_VENDOR.SID.
- FACT_SALES_ITEMS is line-level sales. ITEM_TYPE is 'Sale' or 'Return'. For
  net sold quantity use SUM(CASE WHEN ITEM_TYPE='Return' THEN -QTY ELSE QTY END).
  Revenue = SUM(TOTAL_PRICE_WOTAX); cost = SUM(TOTAL_COST); gross margin % =
  (revenue-cost)/NULLIF(revenue,0)*100. Sales date = INVC_POST_DATE (a TIMESTAMP;
  cast ::DATE for day grouping).
- FACT_INVENTORY is the CURRENT on-hand snapshot: ON_HAND_QTY, COST, PRICE1 per
  ITEM_SID x STORE_SID. Stock cost value = SUM(ON_HAND_QTY*COST). Only rows with
  ON_HAND_QTY>0 are real stock.
- FACT_INVENTORY_HISTORY stores ABSOLUTE stock snapshots per change (QTY is the
  on-hand AFTER the change, NOT a delta). Never SUM(QTY). Stock on a past date =
  the last row per ITEM_SID,STORE_SID with ACTION_DATE<=that date.
- FACT_TRANSFERS: OUT_STORE_SID sends, IN_STORE_SID receives; SENT_QTY/RECV_QTY;
  VOU_STATUS 4=received. FACT_ADJUSTMENTS: QTY_DIFF/COST_DIFF, ADJ_DATE.
- DIM_STORE.STORE_NAME, DIM_ITEM.DESCRIPTION1/ALU/UPC are the human labels.
- Today's date is available as CURRENT_DATE. Use it for "last month", "this year"
  etc. Always add an ORDER BY and a small LIMIT for "top N" questions.
Return DuckDB SQL only. Read-only SELECT. Use only the tables listed above.
"""


def _schema_text(db_path: str) -> str:
    """Introspect the whitelisted tables + columns into a compact CREATE-like
    description the model can read."""
    con, tables = guard.open_sandbox(db_path)   # unrestricted view, admin-level
    try:
        lines = []
        for t in tables:
            cols = con.execute(
                "SELECT column_name, data_type FROM information_schema.columns "
                "WHERE table_catalog='memory' AND table_name=? ORDER BY ordinal_position",
                [t]).fetchall()
            if not cols:
                continue
            coltxt = ", ".join(f"{c} {d}" for c, d in cols)
            lines.append(f"{t}({coltxt})")
        return "\n".join(lines)
    finally:
        con.close()


def _system_prompt(schema: str) -> str:
    return (
        "You are a data analyst for a retail BI system backed by a DuckDB star "
        "schema. Convert the user's question into ONE read-only DuckDB SQL query.\n\n"
        "TABLES:\n" + schema + "\n" + _HINTS +
        "\nRespond with ONLY the SQL inside a ```sql code block. No prose."
    )


# ── SQL extraction ────────────────────────────────────────────────────────────

_SQL_BLOCK = None
def _extract_sql(text: str) -> str:
    import re
    m = re.search(r"```(?:sql)?\s*(.+?)```", text, re.S | re.I)
    if m:
        return m.group(1).strip()
    # fall back: first SELECT/WITH ... to end
    m = re.search(r"\b(with|select)\b.+", text, re.S | re.I)
    return m.group(0).strip() if m else text.strip()


# ── Provider calls (stdlib only) ─────────────────────────────────────────────

def _post_json(url: str, payload: dict, headers: dict) -> dict:
    data = json.dumps(payload).encode()
    req = urllib.request.Request(url, data=data, headers={"Content-Type": "application/json", **headers})
    with urllib.request.urlopen(req, timeout=_HTTP_TIMEOUT) as r:
        return json.loads(r.read().decode())


def _chat(cfg: dict, system: str, user: str) -> str:
    """Single chat turn → assistant text. Raises RuntimeError with a friendly msg."""
    provider = (cfg.get("provider") or "ollama").lower()
    try:
        if provider == "ollama":
            base = (cfg.get("ollama_url") or "http://localhost:11434").rstrip("/")
            out = _post_json(f"{base}/api/chat", {
                "model": cfg.get("model") or "qwen2.5-coder:7b",
                "messages": [{"role": "system", "content": system},
                             {"role": "user", "content": user}],
                "stream": False,
                "options": {"temperature": 0},
            }, {})
            return out["message"]["content"]

        if provider == "anthropic":
            out = _post_json("https://api.anthropic.com/v1/messages", {
                "model": cfg.get("model") or "claude-sonnet-5",
                "max_tokens": 1024,
                "system": system,
                "messages": [{"role": "user", "content": user}],
            }, {"x-api-key": cfg.get("api_key", ""),
                "anthropic-version": "2023-06-01"})
            return "".join(b.get("text", "") for b in out.get("content", []))

        # openai-compatible family: OpenAI, Groq, Gemini, or a custom base_url
        # (Azure, LM Studio, vLLM, OpenRouter…). Groq & Gemini have FREE tiers.
        base = {
            "groq":   "https://api.groq.com/openai/v1",
            "gemini": "https://generativelanguage.googleapis.com/v1beta/openai",
            "openai": cfg.get("base_url") or "https://api.openai.com/v1",
        }.get(provider, cfg.get("base_url") or "https://api.openai.com/v1")
        base = base.rstrip("/")
        model = cfg.get("model") or _DEFAULT_MODEL.get(provider, "gpt-4o-mini")
        out = _post_json(f"{base}/chat/completions", {
            "model": model,
            "temperature": 0,
            "messages": [{"role": "system", "content": system},
                         {"role": "user", "content": user}],
        }, {"Authorization": f"Bearer {cfg.get('api_key','')}"})
        return out["choices"][0]["message"]["content"]

    except urllib.error.URLError as e:
        raise RuntimeError(f"Could not reach the AI provider ({provider}): {e.reason}. "
                           "Check the AI Assistant settings / that Ollama is running.")
    except (KeyError, IndexError, ValueError) as e:
        raise RuntimeError(f"Unexpected response from the AI provider: {e}")


# ── Orchestration ─────────────────────────────────────────────────────────────

def ask(question: str, cfg: dict, host: str,
        allowed_store_names=None, allowed_subsidiary_sids=None) -> dict:
    """Full pipeline. Returns a dict for the API:
    {answer, sql, columns, rows, truncated, error}."""
    db_path = str(_db_path(host))
    schema = _schema_text(db_path)
    system = _system_prompt(schema)

    # 1) NL -> SQL (one retry feeding back an execution error)
    sql, result, last_err = "", None, None
    user_msg = question
    for attempt in range(2):
        raw = _chat(cfg, system, user_msg)
        sql = _extract_sql(raw)
        try:
            result = guard.run(sql, db_path, allowed_store_names, allowed_subsidiary_sids)
            break
        except guard.SqlGuardError as e:
            last_err = str(e)
            user_msg = (f"{question}\n\nYour previous SQL failed with: {last_err}\n"
                        f"SQL was:\n{sql}\nFix it and return corrected SQL only.")
    if result is None:
        return {"answer": None, "sql": sql, "columns": [], "rows": [],
                "truncated": False, "error": last_err or "Could not generate a valid query."}

    # 2) rows -> plain-language answer (send only a capped preview of rows)
    preview = {"columns": result["columns"], "rows": result["rows"][:50],
               "row_count": len(result["rows"]), "truncated": result["truncated"]}
    answer_sys = ("You explain query results to a retail manager in 1-3 short "
                  "sentences, plainly, citing the concrete numbers. No SQL, no fluff.")
    answer_user = (f"Question: {question}\n\nResult (JSON):\n"
                   f"{json.dumps(preview, default=str)}\n\nWrite the answer.")
    try:
        answer = _chat(cfg, answer_sys, answer_user).strip()
    except RuntimeError:
        answer = None      # provider worked for step 1 but failed here — show table only

    return {"answer": answer, "sql": sql, "columns": result["columns"],
            "rows": result["rows"], "truncated": result["truncated"], "error": None}
