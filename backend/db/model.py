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
import secrets
from datetime import date, timedelta
from pathlib import Path

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
    try:
        s = json.loads(SETTINGS_FILE.read_text())
        return s.get("connection", {}).get("host", "local")
    except Exception:
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


def get_db() -> duckdb.DuckDBPyConnection:
    global _conn, _current_host
    host = _current_settings_host()
    if _conn is not None and host == _current_host:
        try:
            _conn.execute("SELECT 1")
            return _conn
        except Exception:
            try:
                _conn.close()
            except Exception:
                pass
            _conn = None
    if _conn is not None:
        try:
            _conn.close()
        except Exception:
            pass
    _conn = duckdb.connect(str(_db_path(host)))
    _current_host = host
    _ensure_schema(_conn)
    return _conn


def switch_db(host: str):
    global _conn, _current_host
    if _conn is not None:
        try:
            _conn.close()
        except Exception:
            pass
        _conn = None
    _current_host = host
    _conn = duckdb.connect(str(_db_path(host)))
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

    # FACT_SALES_DAILY: DOUBLE → DECIMAL + PK fix
    _drop_if_wrong_type(con, "FACT_SALES_DAILY", "NET_SALES_WOTAX", "DECIMAL")

    # FACT_SALES_INVOICES: DOUBLE → DECIMAL + DATE fix
    _drop_if_wrong_type(con, "FACT_SALES_INVOICES", "NET_SALES_WOTAX", "DECIMAL")
    # If INVC_POST_DATE is TIMESTAMP, also drop
    if "TIMESTAMP" in _col_type(con, "FACT_SALES_INVOICES", "INVC_POST_DATE").upper():
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
            FULL_NAME VARCHAR
        )
    """)
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
            PRIMARY KEY (POST_DATE, STORE_SID, SUBSIDIARY_SID)
        )
    """)
    con.execute("""
        CREATE TABLE IF NOT EXISTS FACT_SALES_INVOICES (
            DOC_SID         BIGINT          PRIMARY KEY,
            DOC_NO          VARCHAR,
            INVC_POST_DATE  DATE,
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
            OTHER_AMT       DECIMAL(18,4)   DEFAULT 0
        )
    """)
    con.execute("""
        CREATE TABLE IF NOT EXISTS FACT_SALES_ITEMS (
            DOC_ITEM_SID            BIGINT          PRIMARY KEY,
            DOC_SID                 BIGINT,
            INVC_POST_DATE          DATE,
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
    con.execute("CREATE INDEX IF NOT EXISTS idx_item_dcs      ON DIM_ITEM(DCS_SID)")
    con.execute("CREATE INDEX IF NOT EXISTS idx_item_vend     ON DIM_ITEM(VEND_SID)")
    con.execute("CREATE INDEX IF NOT EXISTS idx_finv_item     ON FACT_INVENTORY(ITEM_SID)")
    con.execute("CREATE INDEX IF NOT EXISTS idx_finv_store    ON FACT_INVENTORY(STORE_SID)")
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
    con.execute("CREATE INDEX IF NOT EXISTS idx_fpurchi_date  ON FACT_PURCHASE_ITEMS(VOU_DATE)")
    con.execute("CREATE INDEX IF NOT EXISTS idx_fpurchi_item  ON FACT_PURCHASE_ITEMS(ITEM_SID)")
    con.execute("CREATE INDEX IF NOT EXISTS idx_fpurchi_store ON FACT_PURCHASE_ITEMS(STORE_SID)")
    con.execute("CREATE INDEX IF NOT EXISTS idx_fpurchi_vend  ON FACT_PURCHASE_ITEMS(VEND_SID)")
    con.execute("CREATE INDEX IF NOT EXISTS idx_date_year     ON DIM_DATE(YEAR)")
    con.execute("CREATE INDEX IF NOT EXISTS idx_date_month    ON DIM_DATE(YEAR, MONTH_NUM)")

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
            created_at    VARCHAR
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
