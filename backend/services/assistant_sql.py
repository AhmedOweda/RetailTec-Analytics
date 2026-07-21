"""
AI Assistant — SQL safety guard (runs on the app's live DuckDB connection)
==========================================================================
The assistant lets users ask free-form questions; an LLM turns them into SQL.
That SQL is UNTRUSTED. This module is the hard security boundary.

IMPORTANT: an earlier design opened a SEPARATE read-only connection to the
warehouse file. That FAILS in the packaged app — DuckDB refuses to open the
same file twice in one machine ("File is already open in this process"), because
the running app already holds it. So the query MUST run on the app's existing
connection. Safety is therefore enforced at the QUERY level:

  1. STATEMENT GUARD: single statement, SELECT/WITH only, and a keyword
     blocklist (INSERT/UPDATE/DELETE/DDL/ATTACH/COPY/PRAGMA/INSTALL/file
     functions…). A SELECT cannot modify data, so this makes the query
     effectively read-only.
  2. TABLE WHITELIST: every table the query references must be a FACT_/DIM_
     table that is NOT sensitive. Referencing DIM_USERS, AUDIT_LOG,
     WAREHOUSE_META, SYNC_*, USER_PREFS, information_schema, system catalogs,
     etc. is rejected before execution.
  3. SCOPE: for store/subsidiary-restricted users, the whitelisted tables are
     exposed as per-request TEMP VIEWS pre-filtered to the user's stores, and
     the generated SQL is rewritten to hit those views. TEMP views live only on
     this request's cursor and vanish when it closes.
  4. ROW CAP: results are wrapped in an outer LIMIT.
"""
import re
import logging

log = logging.getLogger(__name__)

_SENSITIVE = {"DIM_USERS", "USER_PREFS", "AUDIT_LOG", "WAREHOUSE_META",
              "SYNC_RUN", "SYNC_RUN_STATS", "SYNC_WATERMARK", "SYNC_VALIDATION"}

_STORE_COL = {
    "FACT_SALES_ITEMS": "STORE_SID", "FACT_SALES_INVOICES": "STORE_SID",
    "FACT_SALES_DAILY": "STORE_SID", "FACT_INVENTORY": "STORE_SID",
    "FACT_INVENTORY_HISTORY": "STORE_SID", "FACT_ADJUSTMENTS": "STORE_SID",
    "FACT_PURCHASES": "STORE_SID", "FACT_PURCHASE_ITEMS": "STORE_SID",
    # GL facts. MUST be listed: whitelist_tables auto-includes anything named
    # FACT_*, so a missing entry here leaks unscoped rows to a store-scoped user.
    "FACT_GL": "STORE_SID", "FACT_GL_DOC": "STORE_SID",
}

_MAX_ROWS = 1000

_BLOCKED = re.compile(
    r"\b(attach|detach|copy|export|import|install|load|pragma|call|set|"
    r"insert|update|delete|drop|create|alter|replace|truncate|merge|grant|"
    r"read_csv|read_parquet|read_json|read_text|glob|sniff_csv)\b"
    r"|\bwh\.|\bmain\.|\btemp\.|information_schema|pg_catalog|duckdb_",
    re.IGNORECASE)

_VIEW_PREFIX = "asst_"


class SqlGuardError(Exception):
    """Raised when generated SQL is rejected before execution."""


def _clean(sql: str) -> str:
    sql = (sql or "").strip()
    if sql.endswith(";"):
        sql = sql[:-1].rstrip()
    return sql


def validate(sql: str) -> str:
    sql = _clean(sql)
    if not sql:
        raise SqlGuardError("Empty query.")
    if ";" in sql:
        raise SqlGuardError("Only a single statement is allowed.")
    low = sql.lstrip("(").lower()
    if not (low.startswith("select") or low.startswith("with")):
        raise SqlGuardError("Only SELECT queries are allowed.")
    m = _BLOCKED.search(sql)
    if m:
        raise SqlGuardError(f"Query contains a forbidden keyword: '{m.group(0).strip()}'.")
    return sql


def whitelist_tables(cur) -> list[str]:
    """FACT_/DIM_ tables that exist, minus the sensitive set — read from the
    app connection's own catalog."""
    rows = cur.execute(
        "SELECT table_name FROM information_schema.tables "
        "WHERE table_schema='main'").fetchall()
    return sorted(r[0] for r in rows
                  if r[0].startswith(("FACT_", "DIM_")) and r[0] not in _SENSITIVE)


_CTE_RE = re.compile(r'(?:\bwith\b|,)\s*"?([a-z_][\w$]*)"?\s+as\s*\(', re.I)
_TBL_RE = re.compile(r'\b(?:from|join)\s+("?[a-z_][\w$]*"?(?:\.[a-z_][\w$]*)?)', re.I)


def _cte_names(sql: str) -> set:
    return {m.group(1).strip('"').upper() for m in _CTE_RE.finditer(sql)}


def _referenced_tables(sql: str) -> list[str]:
    out = []
    for m in _TBL_RE.finditer(sql):
        out.append(m.group(1).strip('"'))
    return out


def _check_tables(sql: str, allowed: set) -> None:
    """Reject the query if it references any table that isn't whitelisted
    (CTE names and subquery aliases are fine)."""
    ctes = _cte_names(sql)
    for ref in _referenced_tables(sql):
        if "." in ref:
            raise SqlGuardError(f"Schema-qualified table refs are not allowed: '{ref}'.")
        u = ref.upper()
        if u in allowed or u in ctes:
            continue
        raise SqlGuardError(f"The query refers to a table that isn't available: '{ref}'.")


def _store_sids(cur, allowed_store_names, allowed_subsidiary_sids):
    """Resolve the user's allowed STORE names + subsidiary SIDs to STORE_SIDs.
    Returns None when the user is unrestricted."""
    if allowed_store_names is None and not allowed_subsidiary_sids:
        return None
    sids = None
    if allowed_store_names is not None:
        if not allowed_store_names:
            return []
        ph = ",".join(["?"] * len(allowed_store_names))
        sids = {r[0] for r in cur.execute(
            f"SELECT SID FROM DIM_STORE WHERE STORE_NAME IN ({ph})",
            list(allowed_store_names)).fetchall()}
    if allowed_subsidiary_sids:
        ph = ",".join(["?"] * len(allowed_subsidiary_sids))
        sub = {r[0] for r in cur.execute(
            f"SELECT SID FROM DIM_STORE WHERE SUBSIDIARY_SID IN ({ph})",
            list(allowed_subsidiary_sids)).fetchall()}
        sids = sub if sids is None else (sids & sub)
    return list(sids or [])


def run(sql: str, cur, allowed_store_names=None, allowed_subsidiary_sids=None) -> dict:
    """Validate + execute generated SQL on the app cursor `cur`.
    Returns {columns, rows, truncated} or raises SqlGuardError."""
    sql = validate(sql)
    allowed = set(whitelist_tables(cur))
    _check_tables(sql, allowed)

    store_sids = _store_sids(cur, allowed_store_names, allowed_subsidiary_sids)
    scoped = store_sids is not None
    run_sql = sql
    made_views = []
    try:
        if scoped:
            sid_list = "(" + ",".join(str(int(s)) for s in store_sids) + ")" if store_sids else "(NULL)"
            for t in allowed:
                view = f"{_VIEW_PREFIX}{t}"
                col = _STORE_COL.get(t)
                if col:
                    cur.execute(f'CREATE OR REPLACE TEMP VIEW "{view}" AS '
                                f'SELECT * FROM "{t}" WHERE {col} IN {sid_list}')
                elif t == "FACT_TRANSFERS":
                    cur.execute(f'CREATE OR REPLACE TEMP VIEW "{view}" AS SELECT * FROM "{t}" '
                                f"WHERE OUT_STORE_SID IN {sid_list} OR IN_STORE_SID IN {sid_list}")
                elif t == "DIM_STORE":
                    cur.execute(f'CREATE OR REPLACE TEMP VIEW "{view}" AS '
                                f'SELECT * FROM "{t}" WHERE SID IN {sid_list}')
                else:
                    cur.execute(f'CREATE OR REPLACE TEMP VIEW "{view}" AS SELECT * FROM "{t}"')
                made_views.append(view)
            # rewrite whole-word table names → their scoped view names
            for t in sorted(allowed, key=len, reverse=True):
                run_sql = re.sub(rf'\b{t}\b', f'{_VIEW_PREFIX}{t}', run_sql, flags=re.IGNORECASE)

        wrapped = f"SELECT * FROM (\n{run_sql}\n) AS _sub LIMIT {_MAX_ROWS + 1}"
        rel = cur.execute(wrapped)
        cols = [d[0] for d in rel.description]
        data = rel.fetchall()
    except SqlGuardError:
        raise
    except Exception as e:
        raise SqlGuardError(f"Query failed: {e}")
    finally:
        for v in made_views:
            try:
                cur.execute(f'DROP VIEW IF EXISTS "{v}"')
            except Exception:
                pass

    truncated = len(data) > _MAX_ROWS
    data = data[:_MAX_ROWS]
    rows = [[_jsonable(c) for c in row] for row in data]
    return {"columns": cols, "rows": rows, "truncated": truncated}


def _jsonable(v):
    if v is None or isinstance(v, (bool, int, float, str)):
        return v
    from decimal import Decimal
    if isinstance(v, Decimal):
        return float(v)
    return str(v)
