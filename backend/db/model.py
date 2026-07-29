"""
DuckDB Data Model — Star Schema v2
====================================
DWH improvements over v1:
  - DIM_DATE          : calendar dimension (2018–2030)
  - DECIMAL(18,4)     : all monetary columns (was DOUBLE — floating-point unsafe)
  - FACT_TRANSFERS    : added TRANSFER_ITEM_SID primary key (was no PK → destructive DELETE)
  - FACT_ADJUSTMENTS  : added ADJ_ITEM_SID primary key (same issue)
  - FACT_SALES_DAILY  : PK now (POST_DATE, STORE_SID, SUBSIDIARY_SID) — was missing SUBSIDIARY_SID
  - DATE types        : INVC_POST_DATE stored as DATE not TIMESTAMP
  - DIM_ITEM          : added ACTIVE flag
  - SYNC_RUN          : ETL run log (one row per sync execution)
  - SYNC_RUN_STATS    : per-table row counts per run
  - SYNC_WATERMARK    : high-watermark per domain (enables true incremental loads)

Dimension tables (full refresh each sync):
    DIM_DATE, DIM_STORE, DIM_SUBSIDIARY, DIM_EMPLOYEE,
    DIM_CUSTOMER, DIM_ITEM, DIM_DCS, DIM_VENDOR

Fact tables (SIDs + measures, joined to dims at query time):
    FACT_SALES_DAILY, FACT_SALES_INVOICES, FACT_SALES_ITEMS,
    FACT_INVENTORY, FACT_INVENTORY_HISTORY,
    FACT_TRANSFERS, FACT_ADJUSTMENTS,
    FACT_PURCHASES, FACT_PURCHASE_ITEMS

Control tables:
    SYNC_RUN, SYNC_RUN_STATS, SYNC_WATERMARK, DIM_USERS
"""
import duckdb
import json
import hashlib
import logging
import secrets
import threading
import time
from datetime import date, timedelta
from pathlib import Path

# ONE process-wide lock for ALL DuckDB access. The single shared connection is
# not thread-safe; every module (auth, data routers, settings endpoints) MUST
# guard queries with THIS lock. Two different locks on the same connection let
# concurrent requests interleave and corrupt each other's cursors (random
# IndexError 500s / bogus 401s under parallel page loads).
# RLock so get_db()/switch_db() can also take it internally — callers that
# already hold it (routers/common._cursor) re-enter without deadlocking, and
# callers that forgot it (the sync thread) are now covered anyway.
DB_LOCK = threading.RLock()


def assert_binds(sql: str, params) -> None:
    """Fail FAST and CLEARLY when the number of '?' placeholders doesn't match
    the params list (P0, 28 Jul 2026). DuckDB's own error ('Values were not
    provided for prepared statement parameters: N') surfaces as a cryptic 500
    with no hint of which query — the Stagnant-drill bug of 27 Jul cost a
    debugging session to trace. Counts '?' outside single-quoted literals and
    -- comments, so literal question marks in strings don't false-positive."""
    n = 0
    in_str = False
    i, ln = 0, len(sql)
    while i < ln:
        c = sql[i]
        if in_str:
            if c == "'":
                if i + 1 < ln and sql[i + 1] == "'":   # escaped '' inside literal
                    i += 1
                else:
                    in_str = False
        elif c == "'":
            in_str = True
        elif c == "-" and i + 1 < ln and sql[i + 1] == "-":
            j = sql.find("\n", i)
            i = ln if j < 0 else j
        elif c == "?":
            n += 1
        i += 1
    got = len(params)
    if n != got:
        raise ValueError(
            f"SQL bind mismatch: query has {n} '?' placeholder(s) but {got} "
            f"parameter(s) were supplied. First 200 chars: {sql.strip()[:200]!r}")

# Product + warehouse schema versions (surfaced by /api/admin/diagnostics).
# APP_VERSION mirrors the FastAPI app version in main.py; SCHEMA_VERSION is the
# DuckDB star-schema revision (bump when _ensure_schema changes shape).
APP_VERSION = "3.1.0"
SCHEMA_VERSION = 8   # v8 (2026-07-26): DIM_ACCOUNT.CLASS_SOURCE ('tree' | 'default'
                     #     | 'manual') — WHERE a classification came from, so the
                     #     Settings Accounting card can split tree-classified vs
                     #     built-in-integration-default vs carried counts honestly.
                     #     Additive column only — the DIM_ACCOUNT loader inserts by
                     #     explicit column list, so existing warehouses just gain a
                     #     NULL column until the next sync.
                     # v7 (2026-07-26): DIM_ACCOUNT.ACCOUNT_GROUP (level-2 branch of
                     #     the Prism accounting touch-menu tree, for statement
                     #     subtotals) + DIM_ACCOUNT.CLASS_SEQ (the level-1 branch
                     #     order, so P&L / Balance Sheet sections follow the
                     #     customer's own tree order). Additive columns only —
                     #     the DIM_ACCOUNT loader inserts by explicit column list.
                     # v6 (2026-07-20): SUBSIDIARY_SID carried on FACT_SALES_ITEMS,
                     #     FACT_PURCHASES, FACT_PURCHASE_ITEMS and FACT_INVENTORY.
                     #     These four facts previously had NO subsidiary column and
                     #     were scoped through the DERIVED DIM_STORE.SUBSIDIARY_SID,
                     #     which the store loader silently reset to NULL on every
                     #     sync (same root cause as the blank Accounting screens).
                     #     Each fact now owns its subsidiary, straight from Oracle.
                     # v5 (2026-07-20): FACT_GL.GL_POST_DATE + FACT_GL_DOC.GL_POST_DATE
                     #     (the migration/posting date, distinct from the
                     #      transaction date already held in POST_DATE)
                     # v4 (2026-07-20): DIM_CUSTOMER.CUST_ID (human customer no.)

# ── The synthetic accounting subsidiary ───────────────────────────────────────
# Retail Pro subsidiary 100 ("Accounting") is NOT a trading entity. This
# customisation uses it as a VIRTUAL GENERAL LEDGER: its "documents" are journal
# entries and its "items" are the chart of accounts (non-inventory items under a
# DCS coded 'ACCOUNT'). Its DOCUMENT rows carry PRICE amounts, so if they are
# loaded as sales they inflate every revenue figure (measured on production:
# 274 of 9,298 closed documents, plus 147 of 3,173 items polluting item lists).
#
# RULE: every Oracle extract and every dimension loader MUST exclude this
# subsidiary. The ONLY exceptions are the two accounting extracts in
# db/sync.py — _sql_gl() and _sql_accounts() — which read SBS_NO = 100 on
# purpose, feeding FACT_GL / FACT_GL_DOC / DIM_ACCOUNT. Those three tables are
# separate from the star schema, so the Accounting pages are unaffected by the
# exclusion. Everything else (slicers, dimensions, KPIs, the subsidiary
# selector, the licensed-subsidiary count) must never see it.
#
# Defined here, in the lowest-level module, so sync.py, the routers and the
# licensing code all reference ONE constant instead of a repeated literal.
ACCOUNTING_SBS_NO = 100


def record_audit(username: str, action: str, detail: str = "") -> None:
    """Append an audit row. Best-effort — never raises into the caller."""
    from datetime import datetime
    try:
        with DB_LOCK:
            con = get_db()
            con.execute("INSERT INTO AUDIT_LOG VALUES (?, ?, ?, ?)",
                        [datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
                         (username or "?")[:80], action[:80], (detail or "")[:500]])
            con.commit()
    except Exception:
        pass


# ── Password hashing ──────────────────────────────────────────────────────────
def hash_password(plain: str) -> str:
    salt = secrets.token_hex(16)
    h = hashlib.pbkdf2_hmac("sha256", plain.encode(), salt.encode(), 260000)
    return f"pbkdf2:{salt}:{h.hex()}"

def verify_password(plain: str, hashed: str) -> bool:
    try:
        parts = hashed.split(":")
        if len(parts) != 3 or parts[0] != "pbkdf2":
            return False
        _, salt, stored_h = parts
        h = hashlib.pbkdf2_hmac("sha256", plain.encode(), salt.encode(), 260000)
        return h.hex() == stored_h
    except Exception:
        return False

SETTINGS_FILE = Path(__file__).parent.parent / "settings.json"

_conn: duckdb.DuckDBPyConnection | None = None
_current_host: str = ""


def _db_path(host: str) -> Path:
    safe = host.replace(".", "_").replace(":", "_")
    return Path(__file__).parent.parent / f"retailtec_{safe}.db"


def _current_settings_host() -> str:
    """Read the configured host from settings.json — used ONCE at startup.

    After startup the active host lives in _current_host and changes only via
    switch_db(). (get_db used to re-read this file on EVERY call; any reader
    that hit the file mid-write got truncated JSON, silently fell back to the
    empty 'local' warehouse, and the app showed no items/products until a
    restart — the 'empty on open' bug, 13 Jul 2026.)

    If the file exists but is momentarily unreadable (concurrent write),
    retry briefly before falling back."""
    for attempt in range(5):
        try:
            s = json.loads(SETTINGS_FILE.read_text())
            return s.get("connection", {}).get("host", "local") or "local"
        except FileNotFoundError:
            return "local"          # genuine fresh install
        except Exception:
            time.sleep(0.2)         # mid-write / transient — retry
    logging.getLogger(__name__).error(
        "settings.json unreadable after retries — falling back to 'local' warehouse")
    return "local"


def _table_cols(con: duckdb.DuckDBPyConnection, table: str) -> set:
    return {r[0] for r in con.execute(
        "SELECT column_name FROM information_schema.columns "
        f"WHERE table_name = '{table}'"
    ).fetchall()}


def _col_type(con: duckdb.DuckDBPyConnection, table: str, col: str) -> str:
    row = con.execute(
        "SELECT data_type FROM information_schema.columns "
        f"WHERE table_name='{table}' AND column_name='{col}'"
    ).fetchone()
    return row[0] if row else ""


def _quarantine_wal(path: str, err: Exception) -> bool:
    """Self-heal a corrupt WAL left behind by a force-kill (P0, 28 Jul 2026).

    A corrupt .wal makes duckdb.connect() raise during replay and previously
    CRASH-LOOPED the packaged app until someone deleted the file by hand
    (seen 27 Jul: a stale corrupt WAL restored from _appstate_backup took
    down a fresh build). Losing the WAL only loses the last un-checkpointed
    sync batch — the next incremental (>=30-day window) re-pulls it — so the
    right move is: move it aside, log LOUDLY, let connect retry.
    Returns True if a WAL file was quarantined (caller should retry once)."""
    wal = Path(str(path) + ".wal")
    if not wal.exists():
        return False
    qdir = wal.parent / "wal_quarantine"
    try:
        qdir.mkdir(exist_ok=True)
        dest = qdir / (wal.name + "." + time.strftime("%Y%m%d-%H%M%S") + ".corrupt")
        wal.replace(dest)
    except OSError as move_err:
        logging.getLogger(__name__).error(
            f"WAL replay failed ({err}) and quarantine also failed ({move_err}) - giving up")
        return False
    logging.getLogger(__name__).error(
        f"WAL replay failed ({err}); quarantined {wal.name} -> {dest} and retrying connect. "
        f"Last un-checkpointed sync batch is lost; the next incremental re-pulls it.")
    return True


def _connect_retry(path: str, timeout_s: int = 120) -> duckdb.DuckDBPyConnection:
    """Open the warehouse, WAITING for another instance to release it.
    A tray Restart spawns the new process while the old one may still be
    finishing a sync batch — failing immediately left the app unreachable
    (seen 8 Jul 2026: new instance died with 'file is being used by another
    process' while the old sync thread drained).
    Also self-heals a corrupt WAL: one quarantine-and-retry per call, and
    never while the file is merely held by another live instance (that WAL
    belongs to a running process — removing it would corrupt, not heal)."""
    log = logging.getLogger(__name__)
    deadline = time.time() + timeout_s
    wal_healed = False
    while True:
        try:
            return duckdb.connect(path)
        except duckdb.Error as e:
            held = isinstance(e, duckdb.IOException) and "used by another process" in str(e)
            if held:
                if time.time() >= deadline:
                    raise
                log.warning("Warehouse held by another instance - waiting to retry...")
                time.sleep(2)
                continue
            if not wal_healed and _quarantine_wal(path, e):
                wal_healed = True
                continue
            raise


def get_db() -> duckdb.DuckDBPyConnection:
    """Return the shared connection for the ACTIVE host.

    The active host is read from settings.json exactly once (first call);
    afterwards it changes ONLY through switch_db(). The whole body runs under
    DB_LOCK (re-entrant) so the health check / reconnect can never interleave
    with another thread's access to the shared connection."""
    global _conn, _current_host
    with DB_LOCK:
        if not _current_host:
            _current_host = _current_settings_host()
        if _conn is not None:
            try:
                _conn.execute("SELECT 1")
                return _conn
            except Exception:
                try:
                    _conn.close()
                except Exception:
                    pass
                _conn = None
        _conn = _connect_retry(str(_db_path(_current_host)))
        # Analyze ALL rows when inferring column types from object-dtype DataFrames
        # (duck.register in sync staging). The default 1000-row sample inferred
        # INT32 for DIM_ITEM.UPC on a server whose first 1000 UPCs were small, then
        # a 13-digit barcode failed with Python Conversion Failure out of range.
        _conn.execute("SET pandas_analyze_sample=10000000")
        _ensure_schema(_conn)
        return _conn


def switch_db(host: str):
    global _conn, _current_host
    with DB_LOCK:
        if _conn is not None:
            try:
                _conn.close()
            except Exception:
                pass
            _conn = None
        _current_host = host
        _conn = _connect_retry(str(_db_path(host)))
        _conn.execute("SET pandas_analyze_sample=10000000")  # see get_db note
        _ensure_schema(_conn)


def init_db():
    get_db()


# ── Migration helpers ─────────────────────────────────────────────────────────

def _drop_if_missing_col(con, table: str, required_col: str):
    """Drop table if it exists but is missing a column (schema changed)."""
    cols = _table_cols(con, table)
    if cols and required_col not in cols:
        con.execute(f"DROP TABLE IF EXISTS {table}")

def _drop_if_wrong_type(con, table: str, col: str, expected_type: str):
    """Drop table if a column has the wrong data type (e.g. DOUBLE instead of DECIMAL)."""
    cols = _table_cols(con, table)
    if cols and col in cols:
        actual = _col_type(con, table, col)
        if expected_type.upper() not in actual.upper():
            con.execute(f"DROP TABLE IF EXISTS {table}")


def derive_store_subsidiaries(con: duckdb.DuckDBPyConnection) -> int:
    """Back-fill DIM_STORE.SUBSIDIARY_SID from the facts. Returns rows populated.

    NO LONGER LOAD-BEARING (schema v6, 2026-07-20). Every fact that queries scope
    by subsidiary now owns a SUBSIDIARY_SID column of its own, straight from
    Oracle: FACT_SALES_DAILY, FACT_SALES_INVOICES, FACT_SALES_ITEMS,
    FACT_PURCHASES, FACT_PURCHASE_ITEMS, FACT_INVENTORY and FACT_GL. This
    derivation is kept as a FALLBACK — it still populates the DIM_STORE column
    for anything that reads it directly (ad-hoc queries, the AI assistant, future
    dimension-side joins) and it costs nothing when already populated. Do NOT
    reintroduce a router predicate that depends on it: the column is reset to
    NULL by every DIM_STORE reload, which is what blanked the Accounting screens
    and the Journals detail grid.

    WHY THIS EXISTS: RPS.STORE carries no subsidiary column, so _load_dimensions
    inserts only (SID, STORE_CODE, STORE_NAME). A store belongs to exactly one
    subsidiary in practice, and the facts DO carry SUBSIDIARY_SID, so we derive
    it — the modal value per store, ignoring the 0/NULL placeholders.

    WHY IT WAS ALWAYS NULL (fixed 2026-07-20): the derivation only ever ran
    inside _ensure_schema, i.e. once at startup, but _replace_small_dim does
    DELETE + re-INSERT of DIM_STORE on EVERY dimensions load — which resets the
    derived column to NULL. So from the first sync until the next process
    restart the column was empty, and any query scoping through
    DIM_STORE.SUBSIDIARY_SID silently matched zero rows (all four Accounting
    screens went blank). The old bare `except: pass` made that invisible. Fix:
    a named function, called from _ensure_schema AND from sync after the
    dimensions are reloaded, that LOGS on failure.

    Sources are unioned so a warehouse that has GL but not sales still resolves:
      FACT_SALES_DAILY     — the normal trading path
      FACT_SALES_INVOICES  — fallback if the daily aggregate has not been rebuilt
      FACT_GL              — the accounting subsidiary's own stores

    IDEMPOTENT: re-running is a no-op once populated (the guard only touches
    rows that are still NULL/0). NEVER FATAL: any failure is logged and
    swallowed so a half-loaded warehouse cannot stop the app from starting.
    Stores with no facts at all legitimately stay NULL."""
    log = logging.getLogger(__name__)
    try:
        con.execute("""
            UPDATE DIM_STORE SET SUBSIDIARY_SID = m.sbs
            FROM (
                SELECT STORE_SID, mode(SUBSIDIARY_SID) AS sbs
                FROM (
                    SELECT STORE_SID, SUBSIDIARY_SID FROM FACT_SALES_DAILY
                    UNION ALL
                    SELECT STORE_SID, SUBSIDIARY_SID FROM FACT_SALES_INVOICES
                    UNION ALL
                    SELECT STORE_SID, SUBSIDIARY_SID FROM FACT_GL
                )
                WHERE STORE_SID IS NOT NULL
                  AND SUBSIDIARY_SID IS NOT NULL AND SUBSIDIARY_SID <> 0
                GROUP BY STORE_SID
            ) m
            WHERE DIM_STORE.SID = m.STORE_SID
              AND (DIM_STORE.SUBSIDIARY_SID IS NULL OR DIM_STORE.SUBSIDIARY_SID = 0)
        """)
        row = con.execute(
            "SELECT COUNT(*) FILTER (WHERE SUBSIDIARY_SID IS NOT NULL"
            "                          AND SUBSIDIARY_SID <> 0), COUNT(*) "
            "FROM DIM_STORE").fetchone()
        done, total = (int(row[0]), int(row[1])) if row else (0, 0)
        if total and done < total:
            # Not an error: a store with no sales and no GL activity has nothing
            # to derive from. Logged at info so the count is always visible.
            log.info("DIM_STORE.SUBSIDIARY_SID: %d/%d stores resolved "
                     "(%d have no facts to derive from)", done, total, total - done)
        else:
            log.info("DIM_STORE.SUBSIDIARY_SID: %d/%d stores resolved", done, total)
        return done
    except Exception as e:
        # LOUD, but never fatal. Before the 2026-07-20 fix this was `pass`, which
        # is why an all-NULL column produced blank Accounting screens with not a
        # single line anywhere in the log.
        log.warning("DIM_STORE.SUBSIDIARY_SID derivation FAILED (%s: %s) — "
                    "subsidiary scoping that routes through DIM_STORE will match "
                    "nothing until this succeeds", type(e).__name__, e)
        return 0


def _ensure_schema(con: duckdb.DuckDBPyConnection):

    # ── v1 → v2 migrations ───────────────────────────────────────────────────
    # Drop any table whose structure changed so it gets recreated below.
    # Data will be reloaded by the next sync.

    # Old schema had SBS_NO on DIM_STORE
    if "SBS_NO" in _table_cols(con, "DIM_STORE"):
        con.execute("DROP TABLE IF EXISTS DIM_STORE")

    # DIM_ITEM: add ACTIVE column
    _drop_if_missing_col(con, "DIM_ITEM", "ACTIVE")

    # FACT_TRANSFERS: add TRANSFER_ITEM_SID primary key
    _drop_if_missing_col(con, "FACT_TRANSFERS", "TRANSFER_ITEM_SID")

    # FACT_ADJUSTMENTS: add ADJ_ITEM_SID primary key
    _drop_if_missing_col(con, "FACT_ADJUSTMENTS", "ADJ_ITEM_SID")

    # DIM_CUSTOMER: add CUST_ID (2026-07-20). SID is the internal 18-digit key;
    # CUST_ID is the human-facing customer number the owner actually knows.
    # It is NOT unique (11,155 non-null / 10,910 distinct) and is NULL on ~60
    # customers, so it stays a plain nullable attribute — never a key.
    _drop_if_missing_col(con, "DIM_CUSTOMER", "CUST_ID")

    # FACT_GL / FACT_GL_DOC: add GL_POST_DATE (2026-07-20). POST_DATE is the
    # TRANSACTION date (the source document's own accounting date, from NOTE8);
    # GL_POST_DATE is when the entry was actually migrated into the GL (the
    # sbs-100 document's INVC_POST_DATE). On production they differ by months
    # — January activity posted in July — so accountants need BOTH bases, and
    # neither may be repurposed into the other. Dropped rather than ALTERed:
    # the Oracle extract maps positionally, so the column must sit in the right
    # ordinal position, which ADD COLUMN cannot guarantee. The next sync
    # reloads the table.
    _drop_if_missing_col(con, "FACT_GL",     "GL_POST_DATE")
    _drop_if_missing_col(con, "FACT_GL_DOC", "GL_POST_DATE")

    # SUBSIDIARY_SID on the four facts that never had one (2026-07-20, v6).
    # They were scoped through DIM_STORE.SUBSIDIARY_SID — a column DERIVED from
    # the facts and wiped to NULL by every DIM_STORE reload, which is exactly
    # what blanked the Accounting screens and the Journals detail grid. The
    # subsidiary now comes straight from Oracle onto each fact:
    #   FACT_SALES_ITEMS    <- RPS.DOCUMENT.SUBSIDIARY_SID (via the parent doc;
    #                          DOCUMENT_ITEM carries only SBS_NO, no SID)
    #   FACT_PURCHASES      <- RPS.VOUCHER.SBS_SID
    #   FACT_PURCHASE_ITEMS <- RPS.VOUCHER.SBS_SID (via the parent voucher)
    #   FACT_INVENTORY      <- RPS.INVN_SBS_ITEM_QTY.SBS_SID
    # DROPped rather than ALTERed: the Oracle extracts map POSITIONALLY, so the
    # column must sit at a fixed ordinal that ADD COLUMN cannot guarantee. The
    # next FULL sync reloads these tables — until then they are empty.
    _drop_if_missing_col(con, "FACT_SALES_ITEMS",    "SUBSIDIARY_SID")
    _drop_if_missing_col(con, "FACT_PURCHASES",      "SUBSIDIARY_SID")
    _drop_if_missing_col(con, "FACT_PURCHASE_ITEMS", "SUBSIDIARY_SID")
    _drop_if_missing_col(con, "FACT_INVENTORY",      "SUBSIDIARY_SID")

    # FACT_SALES_DAILY: DOUBLE → DECIMAL + PK fix
    _drop_if_wrong_type(con, "FACT_SALES_DAILY", "NET_SALES_WOTAX", "DECIMAL")

    # FACT_SALES_INVOICES: DOUBLE → DECIMAL + timestamp fix
    _drop_if_wrong_type(con, "FACT_SALES_INVOICES", "NET_SALES_WOTAX", "DECIMAL")
    # INVC_POST_DATE must be TIMESTAMP: storing it as DATE truncated the
    # time-of-day and flattened the hourly heatmap onto 00:00. Recreate + reload
    # if an old DATE-typed table is found.
    _t = _col_type(con, "FACT_SALES_INVOICES", "INVC_POST_DATE")
    if _t and "TIMESTAMP" not in _t.upper():
        con.execute("DROP TABLE IF EXISTS FACT_SALES_INVOICES")

    # FACT_SALES_ITEMS: DOUBLE → DECIMAL + DATE fix
    _drop_if_wrong_type(con, "FACT_SALES_ITEMS", "UNIT_COST", "DECIMAL")
    if "TIMESTAMP" in _col_type(con, "FACT_SALES_ITEMS", "INVC_POST_DATE").upper():
        con.execute("DROP TABLE IF EXISTS FACT_SALES_ITEMS")

    # FACT_INVENTORY, FACT_INVENTORY_HISTORY: DOUBLE → DECIMAL
    _drop_if_wrong_type(con, "FACT_INVENTORY", "COST", "DECIMAL")
    _drop_if_wrong_type(con, "FACT_INVENTORY_HISTORY", "COST", "DECIMAL")

    # FACT_PURCHASES, FACT_PURCHASE_ITEMS: DOUBLE → DECIMAL
    _drop_if_wrong_type(con, "FACT_PURCHASES", "VOU_SUBTOTAL", "DECIMAL")
    _drop_if_wrong_type(con, "FACT_PURCHASE_ITEMS", "UNIT_COST", "DECIMAL")

    # ── Calendar dimension ────────────────────────────────────────────────────
    con.execute("""
        CREATE TABLE IF NOT EXISTS DIM_DATE (
            DATE_KEY     DATE    PRIMARY KEY,
            YEAR         INTEGER NOT NULL,
            QUARTER      INTEGER NOT NULL,
            MONTH_NUM    INTEGER NOT NULL,
            MONTH_NAME   VARCHAR NOT NULL,
            WEEK_NUM     INTEGER NOT NULL,
            DAY_OF_MONTH INTEGER NOT NULL,
            DAY_OF_WEEK  INTEGER NOT NULL,  -- 0=Monday … 6=Sunday
            DAY_NAME     VARCHAR NOT NULL,
            IS_WEEKEND   BOOLEAN NOT NULL
        )
    """)
    _populate_dim_date(con)

    # ── Dimension tables ──────────────────────────────────────────────────────
    con.execute("""
        CREATE TABLE IF NOT EXISTS DIM_STORE (
            SID        BIGINT  PRIMARY KEY,
            STORE_CODE VARCHAR,
            STORE_NAME VARCHAR
        )
    """)
    con.execute("""
        CREATE TABLE IF NOT EXISTS DIM_SUBSIDIARY (
            SID      BIGINT  PRIMARY KEY,
            SBS_NO   INTEGER,
            SBS_NAME VARCHAR
        )
    """)
    con.execute("""
        CREATE TABLE IF NOT EXISTS DIM_EMPLOYEE (
            SID       BIGINT  PRIMARY KEY,
            FULL_NAME VARCHAR
        )
    """)
    con.execute("""
        CREATE TABLE IF NOT EXISTS DIM_CUSTOMER (
            SID       BIGINT  PRIMARY KEY,
            CUST_ID   BIGINT,
            FULL_NAME VARCHAR,
            PHONE     VARCHAR
        )
    """)
    # Migration: PHONE added 2026-07 (customer phone in CRM grid)
    con.execute("ALTER TABLE DIM_CUSTOMER ADD COLUMN IF NOT EXISTS PHONE VARCHAR")
    # Migration: CUST_ID added 2026-07-20 (human-facing customer number).
    # Nullable, non-unique — display/search only. SID stays the key.
    con.execute("ALTER TABLE DIM_CUSTOMER ADD COLUMN IF NOT EXISTS CUST_ID BIGINT")
    con.execute("""
        CREATE TABLE IF NOT EXISTS DIM_ITEM (
            SID          BIGINT  PRIMARY KEY,
            SBS_SID      BIGINT,
            ALU          VARCHAR,
            UPC          VARCHAR,
            DESCRIPTION1 VARCHAR,
            DESCRIPTION2 VARCHAR,
            ATTRIBUTE    VARCHAR,
            ITEM_SIZE    VARCHAR,
            DCS_SID      BIGINT,
            VEND_SID     BIGINT,
            ACTIVE       BOOLEAN DEFAULT TRUE
        )
    """)
    # Migration 2026-07: optional item-master fields for configurable grid columns
    for col, typ in [
        ("DESCRIPTION3", "VARCHAR"), ("DESCRIPTION4", "VARCHAR"),
        ("LONG_DESCRIPTION", "VARCHAR"),
        *[(f"TEXT{i}", "VARCHAR") for i in range(1, 11)],
        *[(f"UDF{i}_STRING", "VARCHAR") for i in range(1, 6)],
        ("PRICE_LVL1", "DECIMAL(18,4)"), ("PRICE_LVL2", "DECIMAL(18,4)"),
        ("PRICE_LVL3", "DECIMAL(18,4)"),
    ]:
        con.execute(f"ALTER TABLE DIM_ITEM ADD COLUMN IF NOT EXISTS {col} {typ}")
    con.execute("""
        CREATE TABLE IF NOT EXISTS DIM_DCS (
            SID      BIGINT  PRIMARY KEY,
            SBS_SID  BIGINT,
            DCS_CODE VARCHAR,
            D_NAME   VARCHAR,
            C_NAME   VARCHAR,
            S_NAME   VARCHAR
        )
    """)
    con.execute("""
        CREATE TABLE IF NOT EXISTS DIM_VENDOR (
            SID       BIGINT  PRIMARY KEY,
            SBS_SID   BIGINT,
            VEND_CODE VARCHAR,
            VEND_NAME VARCHAR
        )
    """)
    # Chart of accounts. Lives in Retail Pro as NON-INVENTORY items under the
    # DCS 'ACCOUNT' of subsidiary 100 (the virtual GL). ALU is the account code.
    # ACCOUNT_CLASS is deliberately nullable: the COA mixes two numbering
    # schemes (the accountant's 1xx/2xx/3xx and the Retail Pro integration
    # accounts 1010.xx/1220.01/3250.01), so class CANNOT be inferred from the
    # code range - e.g. 3250.01 is a liability while 3xxx is equity elsewhere.
    # It is populated from the accountant's classification, not derived.
    con.execute("""
        CREATE TABLE IF NOT EXISTS DIM_ACCOUNT (
            SID           BIGINT  PRIMARY KEY,
            ACCOUNT_CODE  VARCHAR,
            ACCOUNT_KEY   VARCHAR,
            NAME_EN       VARCHAR,
            NAME_AR       VARCHAR,
            ACCOUNT_CLASS VARCHAR,
            ACCOUNT_GROUP VARCHAR,
            CLASS_SEQ     INTEGER,
            CLASS_SOURCE  VARCHAR
        )
    """)
    # Migration v7 (2026-07-26): statement subtotal group + section order.
    # ACCOUNT_GROUP is the LEVEL-2 branch of the accounting touch-menu tree
    # (NULL for accounts hanging directly under a class); CLASS_SEQ is the
    # level-1 branch order so the statements list sections in the customer's
    # own tree order. Additive — the loader inserts by explicit column list,
    # so existing warehouses just gain two NULL columns until the next sync.
    con.execute("ALTER TABLE DIM_ACCOUNT ADD COLUMN IF NOT EXISTS ACCOUNT_GROUP VARCHAR")
    con.execute("ALTER TABLE DIM_ACCOUNT ADD COLUMN IF NOT EXISTS CLASS_SEQ INTEGER")
    # Migration v8 (2026-07-26): classification provenance — 'tree' (Prism
    # accounting touch menu), 'default' (built-in integration defaults in
    # db/sync.py), 'manual' (carried from a prior warehouse / prior sync).
    # NULL when ACCOUNT_CLASS is NULL. Additive, same rationale as v7.
    con.execute("ALTER TABLE DIM_ACCOUNT ADD COLUMN IF NOT EXISTS CLASS_SOURCE VARCHAR")

    # ── Sales fact tables ─────────────────────────────────────────────────────
    con.execute("""
        CREATE TABLE IF NOT EXISTS FACT_SALES_DAILY (
            POST_DATE       DATE            NOT NULL,
            STORE_SID       BIGINT          NOT NULL,
            SUBSIDIARY_SID  BIGINT          NOT NULL DEFAULT 0,
            SALES_COUNT     INTEGER         DEFAULT 0,
            RETURN_COUNT    INTEGER         DEFAULT 0,
            ORDER_COUNT     INTEGER         DEFAULT 0,
            NET_SALES_WOTAX DECIMAL(18,4)   DEFAULT 0,
            INVOICE_DISC    DECIMAL(18,4)   DEFAULT 0,
            TOTAL_TAX       DECIMAL(18,4)   DEFAULT 0,
            TOTAL_DEPOSIT   DECIMAL(18,4)   DEFAULT 0,
            TOTAL_FEES      DECIMAL(18,4)   DEFAULT 0,
            SHIPPING_AMT    DECIMAL(18,4)   DEFAULT 0,
            TOTAL_WTAX      DECIMAL(18,4)   DEFAULT 0,
            GROSS_WOTAX     DECIMAL(18,4)   DEFAULT 0,
            RETURN_WOTAX    DECIMAL(18,4)   DEFAULT 0,
            RETURN_UNITS    DECIMAL(12,3)   DEFAULT 0,
            PRIMARY KEY (POST_DATE, STORE_SID, SUBSIDIARY_SID)
        )
    """)
    # Migration 2026-07: item-level sale/return base (a RECEIPT_TYPE=0 sale
    # receipt can contain ITEM_TYPE=2 returned items, so returns must come
    # from FACT_SALES_ITEMS, and gross sales from the same base).
    for _c, _t in [("GROSS_WOTAX", "DECIMAL(18,4)"), ("RETURN_WOTAX", "DECIMAL(18,4)"),
                   ("RETURN_UNITS", "DECIMAL(12,3)")]:
        con.execute(f"ALTER TABLE FACT_SALES_DAILY ADD COLUMN IF NOT EXISTS {_c} {_t} DEFAULT 0")
    con.execute("""
        CREATE TABLE IF NOT EXISTS FACT_SALES_INVOICES (
            DOC_SID         BIGINT          PRIMARY KEY,
            DOC_NO          VARCHAR,
            INVC_POST_DATE  TIMESTAMP,
            RECEIPT_TYPE    INTEGER,
            SUBSIDIARY_SID  BIGINT,
            STORE_SID       BIGINT,
            EMPLOYEE1_SID   BIGINT,
            CASHIER_SID     BIGINT,
            BT_CUID         BIGINT,
            SOLD_QTY        DECIMAL(12,3)   DEFAULT 0,
            RETURN_QTY      DECIMAL(12,3)   DEFAULT 0,
            TOTAL_COGS      DECIMAL(18,4)   DEFAULT 0,
            NET_SALES_WOTAX DECIMAL(18,4)   DEFAULT 0,
            TOTAL_TAX       DECIMAL(18,4)   DEFAULT 0,
            INVOICE_DISC    DECIMAL(18,4)   DEFAULT 0,
            ITEM_DISC       DECIMAL(18,4)   DEFAULT 0,
            LOYALTY_DISC    DECIMAL(18,4)   DEFAULT 0,
            TOTAL_DEPOSIT   DECIMAL(18,4)   DEFAULT 0,
            TOTAL_FEES      DECIMAL(18,4)   DEFAULT 0,
            SHIPPING_AMT    DECIMAL(18,4)   DEFAULT 0,
            TOTAL_WTAX      DECIMAL(18,4)   DEFAULT 0,
            CASH_AMT        DECIMAL(18,4)   DEFAULT 0,
            CARD_AMT        DECIMAL(18,4)   DEFAULT 0,
            DEPOSIT_AMT     DECIMAL(18,4)   DEFAULT 0,
            OTHER_AMT       DECIMAL(18,4)   DEFAULT 0,
            GROSS_WOTAX     DECIMAL(18,4),
            RETURN_WOTAX    DECIMAL(18,4),
            RETURN_UNITS    DECIMAL(12,3)
        )
    """)
    # Migration 2026-07: item-level sale/return aggregates per invoice.
    # When the columns are first added, backfill them from FACT_SALES_ITEMS
    # (already loaded) and rebuild the daily aggregate so KPIs are correct
    # before the next sync runs.
    if "GROSS_WOTAX" not in _table_cols(con, "FACT_SALES_INVOICES"):
        con.execute("ALTER TABLE FACT_SALES_INVOICES ADD COLUMN GROSS_WOTAX  DECIMAL(18,4)")
        con.execute("ALTER TABLE FACT_SALES_INVOICES ADD COLUMN RETURN_WOTAX DECIMAL(18,4)")
        con.execute("ALTER TABLE FACT_SALES_INVOICES ADD COLUMN RETURN_UNITS DECIMAL(12,3)")
        con.execute("""
            UPDATE FACT_SALES_INVOICES
            SET GROSS_WOTAX  = A.G,
                RETURN_WOTAX = A.R,
                RETURN_UNITS = A.U
            FROM (
                SELECT DOC_SID,
                       SUM(CASE WHEN ITEM_TYPE = 'Sale'   THEN TOTAL_PRICE_WOTAX ELSE 0 END) AS G,
                       SUM(CASE WHEN ITEM_TYPE = 'Return' THEN TOTAL_PRICE_WOTAX ELSE 0 END) AS R,
                       SUM(CASE WHEN ITEM_TYPE = 'Return' THEN QTY               ELSE 0 END) AS U
                FROM FACT_SALES_ITEMS
                GROUP BY DOC_SID
            ) A
            WHERE FACT_SALES_INVOICES.DOC_SID = A.DOC_SID
        """)
        con.execute("""
            CREATE OR REPLACE TABLE FACT_SALES_DAILY AS
            SELECT CAST(INVC_POST_DATE AS DATE) AS POST_DATE, STORE_SID,
                   COALESCE(SUBSIDIARY_SID, 0) AS SUBSIDIARY_SID,
                   SUM(CASE WHEN RECEIPT_TYPE=0 THEN 1 ELSE 0 END) AS SALES_COUNT,
                   SUM(CASE WHEN RECEIPT_TYPE=1 THEN 1 ELSE 0 END) AS RETURN_COUNT,
                   SUM(CASE WHEN RECEIPT_TYPE=2 THEN 1 ELSE 0 END) AS ORDER_COUNT,
                   SUM(NET_SALES_WOTAX) AS NET_SALES_WOTAX,
                   SUM(INVOICE_DISC)    AS INVOICE_DISC,
                   SUM(TOTAL_TAX)       AS TOTAL_TAX,
                   SUM(TOTAL_DEPOSIT)   AS TOTAL_DEPOSIT,
                   SUM(TOTAL_FEES)      AS TOTAL_FEES,
                   SUM(SHIPPING_AMT)    AS SHIPPING_AMT,
                   SUM(TOTAL_WTAX)      AS TOTAL_WTAX,
                   SUM(COALESCE(GROSS_WOTAX,  0)) AS GROSS_WOTAX,
                   SUM(COALESCE(RETURN_WOTAX, 0)) AS RETURN_WOTAX,
                   SUM(COALESCE(RETURN_UNITS, 0)) AS RETURN_UNITS
            FROM FACT_SALES_INVOICES
            GROUP BY CAST(INVC_POST_DATE AS DATE), STORE_SID, COALESCE(SUBSIDIARY_SID, 0)
        """)
    con.execute("""
        CREATE TABLE IF NOT EXISTS FACT_SALES_ITEMS (
            DOC_ITEM_SID            BIGINT          PRIMARY KEY,
            DOC_SID                 BIGINT,
            INVC_POST_DATE          DATE,
            SUBSIDIARY_SID          BIGINT,
            STORE_SID               BIGINT,
            ITEM_SID                BIGINT,
            ITEM_TYPE               VARCHAR,
            QTY                     DECIMAL(12,3)   DEFAULT 0,
            UNIT_COST               DECIMAL(18,4)   DEFAULT 0,
            UNIT_ORIG_PRICE_WOTAX   DECIMAL(18,4)   DEFAULT 0,
            UNIT_ORIG_PRICE_WTAX    DECIMAL(18,4)   DEFAULT 0,
            UNIT_PRICE_WOTAX        DECIMAL(18,4)   DEFAULT 0,
            UNIT_TAX_AMT            DECIMAL(18,4)   DEFAULT 0,
            UNIT_PRICE_WTAX         DECIMAL(18,4)   DEFAULT 0,
            UNIT_ITEM_DISC          DECIMAL(18,4)   DEFAULT 0,
            UNIT_RECEIPT_DISC       DECIMAL(18,4)   DEFAULT 0,
            UNIT_LOYALTY_DISC       DECIMAL(18,4)   DEFAULT 0,
            TOTAL_COST              DECIMAL(18,4)   DEFAULT 0,
            TOTAL_ORIG_PRICE_WOTAX  DECIMAL(18,4)   DEFAULT 0,
            TOTAL_PRICE_WOTAX       DECIMAL(18,4)   DEFAULT 0,
            TOTAL_TAX_AMT           DECIMAL(18,4)   DEFAULT 0,
            TOTAL_PRICE_WTAX        DECIMAL(18,4)   DEFAULT 0
        )
    """)

    # ── Inventory fact tables ─────────────────────────────────────────────────
    con.execute("""
        CREATE TABLE IF NOT EXISTS FACT_INVENTORY (
            ITEM_SID    BIGINT          NOT NULL,
            STORE_SID   BIGINT          NOT NULL,
            SUBSIDIARY_SID BIGINT,
            ON_HAND_QTY DECIMAL(12,3)   DEFAULT 0,
            COST        DECIMAL(18,4)   DEFAULT 0,
            PRICE1      DECIMAL(18,4)   DEFAULT 0,
            SYNCED_AT   TIMESTAMP,
            PRIMARY KEY (ITEM_SID, STORE_SID)
        )
    """)
    con.execute("""
        CREATE TABLE IF NOT EXISTS FACT_INVENTORY_HISTORY (
            HISTORY_SID BIGINT          PRIMARY KEY,
            ACTION_TYPE VARCHAR         NOT NULL,
            ACTION_DATE DATE            NOT NULL,
            STORE_SID   BIGINT          NOT NULL,
            ITEM_SID    BIGINT          NOT NULL,
            QTY         DECIMAL(12,3)   DEFAULT 0,
            COST        DECIMAL(18,4)   DEFAULT 0,
            SBS_SID     BIGINT
        )
    """)

    # ── Transfer & Adjustment fact tables ─────────────────────────────────────
    con.execute("""
        CREATE TABLE IF NOT EXISTS FACT_TRANSFERS (
            TRANSFER_ITEM_SID BIGINT          PRIMARY KEY,
            SLIP_SID          BIGINT,
            SLIP_NO           INTEGER,
            SLIP_DATE         DATE,
            VOU_NO            VARCHAR,
            VOU_CLASS         INTEGER         DEFAULT 0,
            VOU_STATUS        INTEGER         DEFAULT 3,
            OUT_STORE_SID     BIGINT,
            IN_STORE_SID      BIGINT,
            ITEM_SID          BIGINT,
            SENT_QTY          DECIMAL(12,3)   DEFAULT 0,
            RECV_QTY          DECIMAL(12,3)   DEFAULT 0,
            UNIT_COST         DECIMAL(18,4)   DEFAULT 0,
            TOTAL_COST        DECIMAL(18,4)   DEFAULT 0,
            TOTAL_PRICE       DECIMAL(18,4)   DEFAULT 0
        )
    """)
    con.execute("""
        CREATE TABLE IF NOT EXISTS FACT_ADJUSTMENTS (
            ADJ_ITEM_SID BIGINT          PRIMARY KEY,
            ADJ_SID      BIGINT,
            ADJ_NO       VARCHAR,
            ADJ_DATE     DATE,
            STORE_SID    BIGINT,
            EMPLOYEE_SID BIGINT,
            DOC_TYPE     INTEGER         DEFAULT 0,
            ITEM_SID     BIGINT,
            ORIG_QTY     DECIMAL(12,3)   DEFAULT 0,
            ADJ_QTY      DECIMAL(12,3)   DEFAULT 0,
            QTY_DIFF     DECIMAL(12,3)   DEFAULT 0,
            UNIT_COST    DECIMAL(18,4)   DEFAULT 0,
            COST_DIFF    DECIMAL(18,4)   DEFAULT 0
        )
    """)

    # ── Purchase fact tables ──────────────────────────────────────────────────
    con.execute("""
        CREATE TABLE IF NOT EXISTS FACT_PURCHASES (
            VOU_SID      BIGINT          PRIMARY KEY,
            VOU_NO       INTEGER,
            VOU_DATE     DATE            NOT NULL,
            STATUS       INTEGER         DEFAULT 3,
            SUBSIDIARY_SID BIGINT,
            STORE_SID    BIGINT,
            VEND_SID     BIGINT,
            EMPLOYEE_SID BIGINT,
            VOU_SUBTOTAL DECIMAL(18,4)   DEFAULT 0,
            VOU_TOTAL    DECIMAL(18,4)   DEFAULT 0,
            DISC_AMT     DECIMAL(18,4)   DEFAULT 0,
            LINE_COUNT   INTEGER         DEFAULT 0,
            ORD_QTY      DECIMAL(12,3)   DEFAULT 0,
            RECV_QTY     DECIMAL(12,3)   DEFAULT 0
        )
    """)
    con.execute("""
        CREATE TABLE IF NOT EXISTS FACT_PURCHASE_ITEMS (
            VOU_ITEM_SID BIGINT          PRIMARY KEY,
            VOU_SID      BIGINT,
            VOU_DATE     DATE            NOT NULL,
            SUBSIDIARY_SID BIGINT,
            STORE_SID    BIGINT,
            VEND_SID     BIGINT,
            ITEM_SID     BIGINT,
            ORD_QTY      DECIMAL(12,3)   DEFAULT 0,
            RECV_QTY     DECIMAL(12,3)   DEFAULT 0,
            UNIT_COST    DECIMAL(18,4)   DEFAULT 0,
            UNIT_PRICE   DECIMAL(18,4)   DEFAULT 0,
            DISC_AMT     DECIMAL(18,4)   DEFAULT 0,
            TOTAL_COST   DECIMAL(18,4)   DEFAULT 0,
            TOTAL_RETAIL DECIMAL(18,4)   DEFAULT 0
        )
    """)

    # ── General ledger fact tables (subsidiary 100 = the virtual GL) ──────────
    # One row per GL line. Reading rules, verified against production:
    #   * the amount is DOCUMENT_ITEM.PRICE and is ALWAYS POSITIVE (QTY is 1);
    #   * the sign is carried by ITEM_TYPE: 1 = DEBIT, 2 = CREDIT.
    # AMOUNT below is the signed form (debit positive) so measures just SUM it.
    #
    # THREE KINDS OF JOURNAL live here, derived (never stored) by the routers'
    # _CATEGORY expression from two columns of this table (2026-07-22):
    #   Payment     — SRC_DOC_TYPE LIKE 'P_%': the poster's tender journals;
    #                 net to zero by design.
    #   Transaction — SRC_DOC_SID IS NOT NULL and not a Payment: the poster's
    #                 Sale / Return / Purchase / Transfer Slips journals.
    #   Entry       — SRC_DOC_SID IS NULL: a MANUAL journal the accountant
    #                 keyed directly into Prism (payroll, rent, accruals). The
    #                 poster's NOTE fields are absent on those, so the extract
    #                 loads SRC_DOC_SID/SRC_SBS_NO/SRC_STORE_CODE/SRC_DOC_NO/
    #                 BP_ID as NULL (never faked), SRC_DOC_TYPE as
    #                 NVL(NOTE5,'Entry') and POST_DATE from the sbs-100
    #                 document's own INVC_POST_DATE, which IS trustworthy for
    #                 user-entered documents. SRC_DOC_SID is therefore
    #                 deliberately NULLABLE — its NULL-ness is the category.
    #
    # POST_DATE is the ACCOUNTING date: for poster journals the source
    # document's date via NOTE8 — NOT the sbs-100 document's own
    # INVC_POST_DATE, which is the date the poster ran. Those differ by months
    # (Jan-2026 entries posted 19-Jul); using the wrong one collapses every
    # poster journal onto the posting-run date. For manual entries the two
    # coincide by definition.
    #
    # GL_POST_DATE is that other date, kept DELIBERATELY alongside it: the
    # sbs-100 document's own INVC_POST_DATE = when the entry was migrated into
    # the books. Accountants need both — POST_DATE for the period the business
    # activity belongs to, GL_POST_DATE for when the books actually received it
    # — so the reports offer a date basis and neither column substitutes for
    # the other. Nullable: rows loaded before v5 have no posting date until the
    # next sync repopulates them.
    con.execute("""
        CREATE TABLE IF NOT EXISTS FACT_GL (
            GL_LINE_SID    BIGINT          PRIMARY KEY,
            GL_DOC_SID     BIGINT          NOT NULL,
            GL_DOC_NO      VARCHAR,
            POST_DATE      DATE            NOT NULL,
            GL_POST_DATE   DATE,
            ACCOUNT_SID    BIGINT,
            ACCOUNT_CODE   VARCHAR,
            STORE_SID      BIGINT,
            SUBSIDIARY_SID BIGINT,
            SRC_SBS_NO     INTEGER,
            SRC_STORE_CODE VARCHAR,
            SRC_DOC_SID    BIGINT,
            SRC_DOC_NO     VARCHAR,
            SRC_DOC_TYPE   VARCHAR,
            BP_ID          VARCHAR,
            DEBIT          DECIMAL(18,4)   DEFAULT 0,
            CREDIT         DECIMAL(18,4)   DEFAULT 0,
            AMOUNT         DECIMAL(18,4)   DEFAULT 0
        )
    """)
    # One row per BALANCE UNIT, derived locally after each GL load. The
    # SRC_DOC_SID column HOLDS COALESCE(FACT_GL.SRC_DOC_SID, GL_DOC_SID)
    # (2026-07-22): the source document for poster journals — a source document
    # must net to zero across ALL of its journals, because the poster
    # deliberately splits one into several by DOC_TYPE and they clear through
    # AR — and the GL document itself for MANUAL entries, which have no source
    # document and must balance within themselves. Both SIDs come from the same
    # RPS.DOCUMENT.SID sequence, so the key spaces cannot collide and the key
    # is never NULL (the PRIMARY KEY below stays valid; note _derive_gl_docs
    # rebuilds this table with CREATE OR REPLACE ... AS, so no migration was
    # needed for the key change). Every consumer must join it through the
    # routers' _doc_key() COALESCE. IS_BALANCED drives the reporting gate;
    # unbalanced units are excluded from the statements but surfaced by the GL
    # Exceptions report, so money is never silently dropped.
    con.execute("""
        CREATE TABLE IF NOT EXISTS FACT_GL_DOC (
            SRC_DOC_SID    BIGINT          PRIMARY KEY,
            POST_DATE      DATE,
            GL_POST_DATE   DATE,
            SRC_DOC_NO     VARCHAR,
            SRC_STORE_CODE VARCHAR,
            STORE_SID      BIGINT,
            JOURNALS       INTEGER         DEFAULT 0,
            LINES          INTEGER         DEFAULT 0,
            NET            DECIMAL(18,4)   DEFAULT 0,
            IS_BALANCED    BOOLEAN         DEFAULT TRUE
        )
    """)

    # ── ETL control tables ────────────────────────────────────────────────────
    con.execute("""
        CREATE TABLE IF NOT EXISTS SYNC_RUN (
            run_id       INTEGER         PRIMARY KEY,
            run_type     VARCHAR         NOT NULL,   -- 'full' | 'incremental'
            triggered_by VARCHAR         NOT NULL,   -- 'startup' | 'scheduler' | 'user'
            domains      VARCHAR         NOT NULL,   -- 'all' or JSON list
            date_from    DATE,
            date_to      DATE,
            started_at   TIMESTAMP       NOT NULL,
            finished_at  TIMESTAMP,
            status       VARCHAR         NOT NULL,   -- 'running' | 'completed' | 'error' | 'cancelled'
            chunks_done  INTEGER         DEFAULT 0,
            chunks_total INTEGER         DEFAULT 0,
            error_msg    VARCHAR
        )
    """)
    con.execute("""
        CREATE TABLE IF NOT EXISTS SYNC_RUN_STATS (
            run_id       INTEGER         NOT NULL,
            table_name   VARCHAR         NOT NULL,
            rows_before  BIGINT          DEFAULT 0,
            rows_after   BIGINT          DEFAULT 0,
            rows_loaded  BIGINT          DEFAULT 0,
            duration_sec DECIMAL(10,2)   DEFAULT 0,
            PRIMARY KEY (run_id, table_name)
        )
    """)
    con.execute("""
        CREATE TABLE IF NOT EXISTS SYNC_WATERMARK (
            domain      VARCHAR         PRIMARY KEY,  -- 'sales'|'transfers'|'adjustments'|'purchases'|'inventory'
            loaded_from DATE,
            loaded_to   DATE,
            last_run_id INTEGER,
            updated_at  TIMESTAMP
        )
    """)

    # ── Optional Retail Pro customisations present on THIS server ────────────
    # Not every Prism installation carries every customisation RetailTec builds
    # on. The sync probes each one and records the answer here so the API and
    # the UI can degrade calmly (informative empty state) instead of erroring.
    # A MISSING ROW means "not checked yet" and is read as AVAILABLE, so an old
    # warehouse that has never synced under this code behaves exactly as before.
    #   'inventory_history' — RPS.INVENTORY_HISTORY (the INVN_BACKUP_TRG log)
    #   'accounting'        — subsidiary 100, the virtual general ledger
    con.execute("""
        CREATE TABLE IF NOT EXISTS FEATURE_AVAILABILITY (
            feature    VARCHAR         PRIMARY KEY,
            available  BOOLEAN,
            checked_at TIMESTAMP,
            note       VARCHAR
        )
    """)

    # ── Indexes ───────────────────────────────────────────────────────────────
    con.execute("CREATE INDEX IF NOT EXISTS idx_daily_date    ON FACT_SALES_DAILY(POST_DATE)")
    con.execute("CREATE INDEX IF NOT EXISTS idx_daily_store   ON FACT_SALES_DAILY(STORE_SID)")
    con.execute("CREATE INDEX IF NOT EXISTS idx_daily_sbs     ON FACT_SALES_DAILY(SUBSIDIARY_SID)")
    con.execute("CREATE INDEX IF NOT EXISTS idx_inv_date      ON FACT_SALES_INVOICES(INVC_POST_DATE)")
    con.execute("CREATE INDEX IF NOT EXISTS idx_inv_store     ON FACT_SALES_INVOICES(STORE_SID)")
    con.execute("CREATE INDEX IF NOT EXISTS idx_inv_sbs       ON FACT_SALES_INVOICES(SUBSIDIARY_SID)")
    con.execute("CREATE INDEX IF NOT EXISTS idx_items_date    ON FACT_SALES_ITEMS(INVC_POST_DATE)")
    con.execute("CREATE INDEX IF NOT EXISTS idx_items_store   ON FACT_SALES_ITEMS(STORE_SID)")
    con.execute("CREATE INDEX IF NOT EXISTS idx_items_item    ON FACT_SALES_ITEMS(ITEM_SID)")
    con.execute("CREATE INDEX IF NOT EXISTS idx_items_sbs     ON FACT_SALES_ITEMS(SUBSIDIARY_SID)")
    con.execute("CREATE INDEX IF NOT EXISTS idx_item_dcs      ON DIM_ITEM(DCS_SID)")
    con.execute("CREATE INDEX IF NOT EXISTS idx_item_vend     ON DIM_ITEM(VEND_SID)")
    con.execute("CREATE INDEX IF NOT EXISTS idx_finv_item     ON FACT_INVENTORY(ITEM_SID)")
    con.execute("CREATE INDEX IF NOT EXISTS idx_finv_store    ON FACT_INVENTORY(STORE_SID)")
    con.execute("CREATE INDEX IF NOT EXISTS idx_finv_sbs      ON FACT_INVENTORY(SUBSIDIARY_SID)")
    con.execute("CREATE INDEX IF NOT EXISTS idx_ftrans_date   ON FACT_TRANSFERS(SLIP_DATE)")
    con.execute("CREATE INDEX IF NOT EXISTS idx_ftrans_out    ON FACT_TRANSFERS(OUT_STORE_SID)")
    con.execute("CREATE INDEX IF NOT EXISTS idx_ftrans_in     ON FACT_TRANSFERS(IN_STORE_SID)")
    con.execute("CREATE INDEX IF NOT EXISTS idx_ftrans_item   ON FACT_TRANSFERS(ITEM_SID)")
    con.execute("CREATE INDEX IF NOT EXISTS idx_fadj_date     ON FACT_ADJUSTMENTS(ADJ_DATE)")
    con.execute("CREATE INDEX IF NOT EXISTS idx_fadj_store    ON FACT_ADJUSTMENTS(STORE_SID)")
    con.execute("CREATE INDEX IF NOT EXISTS idx_fadj_item     ON FACT_ADJUSTMENTS(ITEM_SID)")
    con.execute("CREATE INDEX IF NOT EXISTS idx_finvh_date    ON FACT_INVENTORY_HISTORY(ACTION_DATE)")
    con.execute("CREATE INDEX IF NOT EXISTS idx_finvh_item    ON FACT_INVENTORY_HISTORY(ITEM_SID)")
    con.execute("CREATE INDEX IF NOT EXISTS idx_finvh_store   ON FACT_INVENTORY_HISTORY(STORE_SID)")
    con.execute("CREATE INDEX IF NOT EXISTS idx_fpurch_date   ON FACT_PURCHASES(VOU_DATE)")
    con.execute("CREATE INDEX IF NOT EXISTS idx_fpurch_store  ON FACT_PURCHASES(STORE_SID)")
    con.execute("CREATE INDEX IF NOT EXISTS idx_fpurch_vend   ON FACT_PURCHASES(VEND_SID)")
    con.execute("CREATE INDEX IF NOT EXISTS idx_fpurch_sbs    ON FACT_PURCHASES(SUBSIDIARY_SID)")
    con.execute("CREATE INDEX IF NOT EXISTS idx_fpurchi_date  ON FACT_PURCHASE_ITEMS(VOU_DATE)")
    con.execute("CREATE INDEX IF NOT EXISTS idx_fpurchi_item  ON FACT_PURCHASE_ITEMS(ITEM_SID)")
    con.execute("CREATE INDEX IF NOT EXISTS idx_fpurchi_store ON FACT_PURCHASE_ITEMS(STORE_SID)")
    con.execute("CREATE INDEX IF NOT EXISTS idx_fpurchi_vend  ON FACT_PURCHASE_ITEMS(VEND_SID)")
    con.execute("CREATE INDEX IF NOT EXISTS idx_fpurchi_sbs   ON FACT_PURCHASE_ITEMS(SUBSIDIARY_SID)")
    con.execute("CREATE INDEX IF NOT EXISTS idx_fgl_date      ON FACT_GL(POST_DATE)")
    con.execute("CREATE INDEX IF NOT EXISTS idx_fgl_gldate    ON FACT_GL(GL_POST_DATE)")
    con.execute("CREATE INDEX IF NOT EXISTS idx_fgl_acct      ON FACT_GL(ACCOUNT_CODE)")
    con.execute("CREATE INDEX IF NOT EXISTS idx_fgl_store     ON FACT_GL(STORE_SID)")
    con.execute("CREATE INDEX IF NOT EXISTS idx_fgl_srcdoc    ON FACT_GL(SRC_DOC_SID)")
    con.execute("CREATE INDEX IF NOT EXISTS idx_fgl_gldoc     ON FACT_GL(GL_DOC_SID)")
    con.execute("CREATE INDEX IF NOT EXISTS idx_fgld_date     ON FACT_GL_DOC(POST_DATE)")
    con.execute("CREATE INDEX IF NOT EXISTS idx_fgld_gldate   ON FACT_GL_DOC(GL_POST_DATE)")
    con.execute("CREATE INDEX IF NOT EXISTS idx_fgld_bal      ON FACT_GL_DOC(IS_BALANCED)")
    con.execute("CREATE INDEX IF NOT EXISTS idx_cust_custid   ON DIM_CUSTOMER(CUST_ID)")
    con.execute("CREATE INDEX IF NOT EXISTS idx_date_year     ON DIM_DATE(YEAR)")
    con.execute("CREATE INDEX IF NOT EXISTS idx_date_month    ON DIM_DATE(YEAR, MONTH_NUM)")

    # ── Multi-subsidiary: give DIM_STORE a subsidiary link ────────────────────
    # The source store load carries no subsidiary column, so the link is DERIVED
    # from the facts. The column itself must exist before anything reads it.
    con.execute("ALTER TABLE DIM_STORE ADD COLUMN IF NOT EXISTS SUBSIDIARY_SID BIGINT")
    derive_store_subsidiaries(con)

    # ── Users table (application auth — kept in same DB for now) ──────────────
    con.execute("""
        CREATE TABLE IF NOT EXISTS DIM_USERS (
            id            INTEGER PRIMARY KEY,
            username      VARCHAR UNIQUE NOT NULL,
            password_hash VARCHAR NOT NULL,
            role          VARCHAR NOT NULL DEFAULT 'viewer',
            stores        VARCHAR,
            full_name     VARCHAR,
            is_active     BOOLEAN DEFAULT true,
            created_at    VARCHAR,
            pages         VARCHAR
        )
    """)
    # Migration: per-user page permissions (CSV of page keys; NULL = all pages)
    con.execute("ALTER TABLE DIM_USERS ADD COLUMN IF NOT EXISTS pages VARCHAR")
    # Migration: per-user subsidiary scope (CSV of subsidiary SIDs; NULL = all)
    con.execute("ALTER TABLE DIM_USERS ADD COLUMN IF NOT EXISTS subsidiaries VARCHAR")

    # Warehouse metadata: key/value facts about THIS warehouse file, e.g.
    # 'source_host' (the Oracle server that filled it — license binding for the
    # UI watermark) and 'dims_loaded_at' (dimension reload throttle).
    con.execute("""
        CREATE TABLE IF NOT EXISTS WAREHOUSE_META (
            key   VARCHAR PRIMARY KEY,
            value VARCHAR
        )
    """)

    # Audit trail: who did what, when (logins, user changes, settings, loads)
    con.execute("""
        CREATE TABLE IF NOT EXISTS AUDIT_LOG (
            ts       VARCHAR,
            username VARCHAR,
            action   VARCHAR,
            detail   VARCHAR
        )
    """)

    # Post-sync data validation results (join coverage per check, latest run)
    con.execute("""
        CREATE TABLE IF NOT EXISTS SYNC_VALIDATION (
            checked_at VARCHAR,
            check_name VARCHAR,
            total      BIGINT,
            matched    BIGINT,
            pct        DOUBLE,
            status     VARCHAR      -- 'ok' | 'warn' | 'fail'
        )
    """)

    # Per-user UI preferences (grid layouts etc.) — follow the user across machines
    con.execute("""
        CREATE TABLE IF NOT EXISTS USER_PREFS (
            user_id    INTEGER,
            pref_key   VARCHAR,
            pref_value VARCHAR,
            updated_at VARCHAR,
            PRIMARY KEY (user_id, pref_key)
        )
    """)

    from datetime import datetime
    count = con.execute("SELECT COUNT(*) FROM DIM_USERS").fetchone()[0]
    if count == 0:
        con.execute(
            "INSERT INTO DIM_USERS (id, username, password_hash, role, full_name, is_active, created_at) "
            "VALUES (1, 'admin', ?, 'admin', 'System Administrator', true, ?)",
            [hash_password("Retailtec@123"), datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S")]
        )
    else:
        row = con.execute(
            "SELECT password_hash FROM DIM_USERS WHERE username = 'admin'"
        ).fetchone()
        if row and verify_password("admin123", row[0]):
            con.execute(
                "UPDATE DIM_USERS SET password_hash = ? WHERE username = 'admin'",
                [hash_password("Retailtec@123")]
            )

    con.commit()


# ── Optional-customisation availability ──────────────────────────────────────
# Some Retail Pro Prism installations do not have the customisations RetailTec
# reads from. That is NOT a fault — the affected features are simply absent, and
# the app must skip them quietly. The sync probes each one and writes the answer
# to FEATURE_AVAILABILITY; readers ask through feature_available() below.

FEATURE_INVENTORY_HISTORY = "inventory_history"
FEATURE_ACCOUNTING        = "accounting"

# Human-readable reason strings, shared by every endpoint that degrades so the
# UI shows ONE wording per feature (also the i18n keys on the frontend).
FEATURE_REASON = {
    FEATURE_INVENTORY_HISTORY:
        "Inventory History is a Retail Pro customisation that is not installed "
        "on this server.",
    FEATURE_ACCOUNTING:
        "The accounting subsidiary (100) is not present on this server.",
}

# Tiny TTL memo: these flags change only on a sync, but they are read on every
# request of the affected endpoints. 15s keeps the DuckDB hit off the hot path
# while still picking a fresh sync result up almost immediately.
_FEATURE_CACHE: dict[str, tuple[float, bool]] = {}
_FEATURE_TTL = 15.0

_flog = logging.getLogger(__name__)


def set_feature_available(con, feature: str, available: bool, note: str = "") -> None:
    """Record a probe result. Best-effort: never raises into the sync."""
    try:
        con.execute("""
            INSERT INTO FEATURE_AVAILABILITY (feature, available, checked_at, note)
            VALUES (?, ?, NOW(), ?)
            ON CONFLICT (feature) DO UPDATE SET
                available  = excluded.available,
                checked_at = excluded.checked_at,
                note       = excluded.note
        """, [feature, bool(available), (note or "")[:400]])
        con.commit()
    except Exception as e:                                   # pragma: no cover
        _flog.warning(f"FEATURE_AVAILABILITY[{feature}] write failed: {e}")
    _FEATURE_CACHE.pop(feature, None)


def feature_available(feature: str) -> bool:
    """Is this optional customisation present on the connected server?

    NO ROW = not probed yet = AVAILABLE. A warehouse that has never synced
    under this code therefore behaves exactly as it did before, and a probe
    failure can never make a working feature disappear."""
    import time
    hit = _FEATURE_CACHE.get(feature)
    now = time.monotonic()
    if hit and now - hit[0] < _FEATURE_TTL:
        return hit[1]
    ok = True
    try:
        with DB_LOCK:
            cur = get_db().cursor()
        try:
            row = cur.execute(
                "SELECT available FROM FEATURE_AVAILABILITY WHERE feature = ?",
                [feature]).fetchone()
        finally:
            cur.close()
        if row is not None and row[0] is not None:
            ok = bool(row[0])
    except Exception as e:
        _flog.warning(f"FEATURE_AVAILABILITY[{feature}] read failed: {e}")
    _FEATURE_CACHE[feature] = (now, ok)
    return ok


def feature_reason(feature: str) -> str:
    """The note recorded by the sync, falling back to the canonical wording."""
    try:
        with DB_LOCK:
            cur = get_db().cursor()
        try:
            row = cur.execute(
                "SELECT note FROM FEATURE_AVAILABILITY WHERE feature = ?",
                [feature]).fetchone()
        finally:
            cur.close()
        if row and row[0]:
            return str(row[0])
    except Exception:
        pass
    return FEATURE_REASON.get(feature, "")


def feature_map() -> dict:
    """Every probed feature as {name: {available, checked_at, note, reason}}.
    Unprobed features are reported available with a null checked_at."""
    out = {f: {"available": True, "checked_at": None, "note": "",
               "reason": FEATURE_REASON.get(f, "")}
           for f in (FEATURE_INVENTORY_HISTORY, FEATURE_ACCOUNTING)}
    try:
        with DB_LOCK:
            cur = get_db().cursor()
        try:
            rows = cur.execute(
                "SELECT feature, available, checked_at, note "
                "FROM FEATURE_AVAILABILITY").fetchall()
        finally:
            cur.close()
        for feature, available, checked_at, note in rows:
            out[feature] = {
                "available":  True if available is None else bool(available),
                "checked_at": str(checked_at) if checked_at else None,
                "note":       note or "",
                "reason":     FEATURE_REASON.get(feature, note or ""),
            }
    except Exception as e:
        _flog.warning(f"FEATURE_AVAILABILITY read failed: {e}")
    return out


# ── Calendar dimension population ────────────────────────────────────────────

def _populate_dim_date(con: duckdb.DuckDBPyConnection):
    count = con.execute("SELECT COUNT(*) FROM DIM_DATE").fetchone()[0]
    if count > 0:
        return

    MONTH_NAMES = ["", "January", "February", "March", "April", "May", "June",
                   "July", "August", "September", "October", "November", "December"]
    DAY_NAMES   = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]

    rows = []
    d    = date(2018, 1, 1)
    end  = date(2030, 12, 31)
    while d <= end:
        dow = d.weekday()          # 0=Mon … 6=Sun
        rows.append((
            d,                             # DATE_KEY
            d.year,                        # YEAR
            (d.month - 1) // 3 + 1,       # QUARTER
            d.month,                       # MONTH_NUM
            MONTH_NAMES[d.month],          # MONTH_NAME
            d.isocalendar()[1],            # WEEK_NUM  (ISO week)
            d.day,                         # DAY_OF_MONTH
            dow,                           # DAY_OF_WEEK
            DAY_NAMES[dow],                # DAY_NAME
            dow >= 5,                      # IS_WEEKEND
        ))
        d += timedelta(days=1)

    con.executemany(
        "INSERT INTO DIM_DATE VALUES (?,?,?,?,?,?,?,?,?,?)",
        rows
    )
    con.commit()
