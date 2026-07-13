"""
AI Assistant — SQL sandbox & safety guard
=========================================
The assistant lets users ask free-form questions; an LLM turns them into SQL.
That SQL is UNTRUSTED. This module is the hard security boundary — no generated
query ever touches the live warehouse connection.

Defense in depth:
  1. SANDBOX (the real guarantee): every query runs in a throwaway :memory:
     DuckDB that ATTACHes the warehouse READ_ONLY. Writes are impossible at the
     engine level, and only WHITELISTED tables are exposed as views — sensitive
     tables (DIM_USERS, AUDIT_LOG, WAREHOUSE_META, SYNC_*, USER_PREFS) simply do
     not exist in the sandbox (referencing them → CatalogException).
  2. SCOPE: for store/subsidiary-restricted users the fact-table views are
     pre-filtered to their allowed store SIDs, mirroring scoped_stores /
     scoped_subsidiaries. They cannot see other stores' rows even if the SQL
     asks for them.
  3. STATEMENT CHECK: single statement, must be SELECT/WITH, and a keyword
     blocklist rejects anything that could escape the sandbox (ATTACH, COPY,
     PRAGMA, INSTALL, LOAD, file-reading functions, the 'wh.' base schema).
  4. ROW CAP + TIMEOUT: results are wrapped in an outer LIMIT and the query is
     interrupted if it runs too long.
"""
import re
import threading
import logging

import duckdb

log = logging.getLogger(__name__)

# Tables the assistant may read. Everything else (users, audit, sync bookkeeping,
# license/meta) is invisible in the sandbox.
_SENSITIVE = {"DIM_USERS", "USER_PREFS", "AUDIT_LOG", "WAREHOUSE_META",
              "SYNC_RUN", "SYNC_RUN_STATS", "SYNC_WATERMARK", "SYNC_VALIDATION"}

# Fact tables and the column used to scope them to a user's allowed stores.
_STORE_COL = {
    "FACT_SALES_ITEMS":       "STORE_SID",
    "FACT_SALES_INVOICES":    "STORE_SID",
    "FACT_SALES_DAILY":       "STORE_SID",
    "FACT_INVENTORY":         "STORE_SID",
    "FACT_INVENTORY_HISTORY": "STORE_SID",
    "FACT_ADJUSTMENTS":       "STORE_SID",
    "FACT_PURCHASES":         "STORE_SID",
    "FACT_PURCHASE_ITEMS":    "STORE_SID",
}

_MAX_ROWS = 1000          # hard cap on rows returned to the UI / model
_TIMEOUT_S = 25           # wall-clock interrupt

# Keywords that must never appear — they could reach outside the sandbox or write.
_BLOCKED = re.compile(
    r"\b(attach|detach|copy|export|import|install|load|pragma|call|"
    r"insert|update|delete|drop|create|alter|replace|truncate|merge|"
    r"read_csv|read_parquet|read_json|read_text|glob)\b"
    r"|\bwh\.",                       # the attached base schema — must use the views
    re.IGNORECASE)


class SqlGuardError(Exception):
    """Raised when generated SQL is rejected before execution."""


def _clean(sql: str) -> str:
    sql = (sql or "").strip()
    # strip a single trailing semicolon (allowed); multiple statements are not
    if sql.endswith(";"):
        sql = sql[:-1].rstrip()
    return sql


def validate(sql: str) -> str:
    """Statement-level checks. Returns the cleaned SQL or raises SqlGuardError.
    The sandbox is the real boundary; this rejects obvious abuse early with a
    clear message."""
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


def _warehouse_tables(con) -> list[str]:
    return [r[0] for r in con.execute(
        "SELECT table_name FROM information_schema.tables "
        "WHERE table_catalog='wh' AND table_schema='main'"
    ).fetchall()]


def whitelist_tables(con) -> list[str]:
    """FACT_/DIM_ tables minus the sensitive set — the assistant's visible schema."""
    return sorted(t for t in _warehouse_tables(con)
                  if t.startswith(("FACT_", "DIM_")) and t not in _SENSITIVE)


def _store_sids_for(con, allowed_store_names: set | None) -> list | None:
    """Translate the user's allowed STORE NAMES (JWT claim) → STORE_SIDs.
    None = unrestricted."""
    if allowed_store_names is None:
        return None
    if not allowed_store_names:
        return []          # restricted to nothing
    ph = ",".join(["?"] * len(allowed_store_names))
    rows = con.execute(
        f"SELECT SID FROM wh.DIM_STORE WHERE STORE_NAME IN ({ph})",
        list(allowed_store_names)).fetchall()
    return [r[0] for r in rows]


def open_sandbox(db_path: str,
                 allowed_store_names: set | None = None,
                 allowed_subsidiary_sids: set | None = None):
    """Build the per-request sandbox: :memory: DB + read-only warehouse + views.

    Returns (connection, visible_table_names). Caller must close the connection.
    """
    con = duckdb.connect(":memory:")
    con.execute(f"ATTACH '{db_path}' AS wh (READ_ONLY)")
    tables = whitelist_tables(con)

    store_sids = _store_sids_for(con, allowed_store_names)
    # subsidiary scope narrows the store list further (stores belong to subs)
    if allowed_subsidiary_sids:
        ph = ",".join(["?"] * len(allowed_subsidiary_sids))
        sub_sids = [r[0] for r in con.execute(
            f"SELECT SID FROM wh.DIM_STORE WHERE SUBSIDIARY_SID IN ({ph})",
            list(allowed_subsidiary_sids)).fetchall()]
        store_sids = (sub_sids if store_sids is None
                      else [s for s in store_sids if s in set(sub_sids)])

    scoped = store_sids is not None
    sid_list = "(" + ",".join(str(int(s)) for s in store_sids) + ")" if scoped and store_sids else "(NULL)"

    for t in tables:
        col = _STORE_COL.get(t)
        if scoped and col:
            con.execute(f'CREATE VIEW "{t}" AS SELECT * FROM wh."{t}" WHERE {col} IN {sid_list}')
        elif scoped and t == "FACT_TRANSFERS":
            con.execute(f'CREATE VIEW "{t}" AS SELECT * FROM wh."{t}" '
                        f"WHERE OUT_STORE_SID IN {sid_list} OR IN_STORE_SID IN {sid_list}")
        elif scoped and t == "DIM_STORE":
            con.execute(f'CREATE VIEW "{t}" AS SELECT * FROM wh."{t}" WHERE SID IN {sid_list}')
        else:
            con.execute(f'CREATE VIEW "{t}" AS SELECT * FROM wh."{t}"')
    return con, tables


def run(sql: str, db_path: str,
        allowed_store_names: set | None = None,
        allowed_subsidiary_sids: set | None = None) -> dict:
    """Validate + execute generated SQL in the sandbox.
    Returns {columns, rows, truncated} or raises SqlGuardError."""
    sql = validate(sql)
    con, _tables = open_sandbox(db_path, allowed_store_names, allowed_subsidiary_sids)
    timer = threading.Timer(_TIMEOUT_S, con.interrupt)
    timer.start()
    try:
        wrapped = f"SELECT * FROM (\n{sql}\n) AS _sub LIMIT {_MAX_ROWS + 1}"
        rel = con.execute(wrapped)
        cols = [d[0] for d in rel.description]
        data = rel.fetchall()
    except SqlGuardError:
        raise
    except Exception as e:
        raise SqlGuardError(f"Query failed: {e}")
    finally:
        timer.cancel()
        con.close()

    truncated = len(data) > _MAX_ROWS
    data = data[:_MAX_ROWS]
    # DuckDB returns Decimal/date objects — stringify non-JSON-native cells
    rows = [[_jsonable(c) for c in row] for row in data]
    return {"columns": cols, "rows": rows, "truncated": truncated}


def _jsonable(v):
    if v is None or isinstance(v, (bool, int, float, str)):
        return v
    from decimal import Decimal
    if isinstance(v, Decimal):
        return float(v)
    return str(v)
