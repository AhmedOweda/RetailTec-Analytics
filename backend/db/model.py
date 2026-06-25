"""
DuckDB Data Model — Star Schema
================================
Dimension tables (full refresh each sync):
    DIM_STORE, DIM_SUBSIDIARY, DIM_EMPLOYEE, DIM_CUSTOMER,
    DIM_ITEM, DIM_DCS, DIM_VENDOR

Fact tables (SIDs + measures only, joined to dims at query time):
    FACT_SALES_DAILY, FACT_SALES_INVOICES, FACT_SALES_ITEMS

One DB file per Oracle host: retailtec_<host>.db
"""
import duckdb
import json
from pathlib import Path

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


def get_db() -> duckdb.DuckDBPyConnection:
    global _conn, _current_host
    host = _current_settings_host()
    if _conn is None or host != _current_host:
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


def _ensure_schema(con: duckdb.DuckDBPyConnection):
    # ── Migrate: drop any fact table with old schema ──────────────────────────
    # Old denormalized schema had STORE_NAME; intermediate star schema had SBS_NO.
    # Current schema uses SUBSIDIARY_SID instead of SBS_NO.
    # Also drop DIM_STORE if it has old SBS_NO column
    if "SBS_NO" in _table_cols(con, "DIM_STORE"):
        con.execute("DROP TABLE IF EXISTS DIM_STORE")

    daily_cols = _table_cols(con, "FACT_SALES_DAILY")
    if "STORE_NAME" in daily_cols or "SBS_NO" in daily_cols:
        con.execute("DROP TABLE IF EXISTS FACT_SALES_DAILY")

    inv_cols = _table_cols(con, "FACT_SALES_INVOICES")
    if "STORE_NAME" in inv_cols or "SBS_NO" in inv_cols:
        con.execute("DROP TABLE IF EXISTS FACT_SALES_INVOICES")

    items_cols = _table_cols(con, "FACT_SALES_ITEMS")
    if "VENDOR_CODE" in items_cols or "DESCRIPTION1" in items_cols:
        con.execute("DROP TABLE IF EXISTS FACT_SALES_ITEMS")

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
            VEND_SID     BIGINT
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

    # ── Fact tables ───────────────────────────────────────────────────────────
    con.execute("""
        CREATE TABLE IF NOT EXISTS FACT_SALES_DAILY (
            POST_DATE        DATE    NOT NULL,
            STORE_SID        BIGINT  NOT NULL,
            SUBSIDIARY_SID   BIGINT,
            SALES_COUNT      INTEGER DEFAULT 0,
            RETURN_COUNT     INTEGER DEFAULT 0,
            ORDER_COUNT      INTEGER DEFAULT 0,
            NET_SALES_WOTAX  DOUBLE  DEFAULT 0,
            INVOICE_DISC     DOUBLE  DEFAULT 0,
            TOTAL_TAX        DOUBLE  DEFAULT 0,
            TOTAL_DEPOSIT    DOUBLE  DEFAULT 0,
            TOTAL_FEES       DOUBLE  DEFAULT 0,
            SHIPPING_AMT     DOUBLE  DEFAULT 0,
            TOTAL_WTAX       DOUBLE  DEFAULT 0,
            PRIMARY KEY (POST_DATE, STORE_SID)
        )
    """)
    con.execute("""
        CREATE TABLE IF NOT EXISTS FACT_SALES_INVOICES (
            DOC_SID          BIGINT  PRIMARY KEY,
            DOC_NO           VARCHAR,
            INVC_POST_DATE   TIMESTAMP,
            RECEIPT_TYPE     INTEGER,
            SUBSIDIARY_SID   BIGINT,
            STORE_SID        BIGINT,
            EMPLOYEE1_SID    BIGINT,
            CASHIER_SID      BIGINT,
            BT_CUID          BIGINT,
            SOLD_QTY         DOUBLE  DEFAULT 0,
            RETURN_QTY       DOUBLE  DEFAULT 0,
            TOTAL_COGS       DOUBLE  DEFAULT 0,
            NET_SALES_WOTAX  DOUBLE  DEFAULT 0,
            TOTAL_TAX        DOUBLE  DEFAULT 0,
            INVOICE_DISC     DOUBLE  DEFAULT 0,
            ITEM_DISC        DOUBLE  DEFAULT 0,
            LOYALTY_DISC     DOUBLE  DEFAULT 0,
            TOTAL_DEPOSIT    DOUBLE  DEFAULT 0,
            TOTAL_FEES       DOUBLE  DEFAULT 0,
            SHIPPING_AMT     DOUBLE  DEFAULT 0,
            TOTAL_WTAX       DOUBLE  DEFAULT 0,
            CASH_AMT         DOUBLE  DEFAULT 0,
            CARD_AMT         DOUBLE  DEFAULT 0,
            DEPOSIT_AMT      DOUBLE  DEFAULT 0,
            OTHER_AMT        DOUBLE  DEFAULT 0
        )
    """)
    con.execute("""
        CREATE TABLE IF NOT EXISTS FACT_SALES_ITEMS (
            DOC_ITEM_SID           BIGINT  PRIMARY KEY,
            DOC_SID                BIGINT,
            INVC_POST_DATE         TIMESTAMP,
            STORE_SID              BIGINT,
            ITEM_SID               BIGINT,
            ITEM_TYPE              VARCHAR,
            QTY                    DOUBLE  DEFAULT 0,
            UNIT_COST              DOUBLE  DEFAULT 0,
            UNIT_ORIG_PRICE_WOTAX  DOUBLE  DEFAULT 0,
            UNIT_ORIG_PRICE_WTAX   DOUBLE  DEFAULT 0,
            UNIT_PRICE_WOTAX       DOUBLE  DEFAULT 0,
            UNIT_TAX_AMT           DOUBLE  DEFAULT 0,
            UNIT_PRICE_WTAX        DOUBLE  DEFAULT 0,
            UNIT_ITEM_DISC         DOUBLE  DEFAULT 0,
            UNIT_RECEIPT_DISC      DOUBLE  DEFAULT 0,
            UNIT_LOYALTY_DISC      DOUBLE  DEFAULT 0,
            TOTAL_COST             DOUBLE  DEFAULT 0,
            TOTAL_ORIG_PRICE_WOTAX DOUBLE  DEFAULT 0,
            TOTAL_PRICE_WOTAX      DOUBLE  DEFAULT 0,
            TOTAL_TAX_AMT          DOUBLE  DEFAULT 0,
            TOTAL_PRICE_WTAX       DOUBLE  DEFAULT 0
        )
    """)

    # ── Indexes ───────────────────────────────────────────────────────────────
    con.execute("CREATE INDEX IF NOT EXISTS idx_daily_date   ON FACT_SALES_DAILY(POST_DATE)")
    con.execute("CREATE INDEX IF NOT EXISTS idx_daily_store  ON FACT_SALES_DAILY(STORE_SID)")
    con.execute("CREATE INDEX IF NOT EXISTS idx_daily_sbs    ON FACT_SALES_DAILY(SUBSIDIARY_SID)")
    con.execute("CREATE INDEX IF NOT EXISTS idx_inv_date     ON FACT_SALES_INVOICES(INVC_POST_DATE)")
    con.execute("CREATE INDEX IF NOT EXISTS idx_inv_store    ON FACT_SALES_INVOICES(STORE_SID)")
    con.execute("CREATE INDEX IF NOT EXISTS idx_inv_sbs      ON FACT_SALES_INVOICES(SUBSIDIARY_SID)")
    con.execute("CREATE INDEX IF NOT EXISTS idx_items_date   ON FACT_SALES_ITEMS(INVC_POST_DATE)")
    con.execute("CREATE INDEX IF NOT EXISTS idx_items_store  ON FACT_SALES_ITEMS(STORE_SID)")
    con.execute("CREATE INDEX IF NOT EXISTS idx_items_item   ON FACT_SALES_ITEMS(ITEM_SID)")
    con.execute("CREATE INDEX IF NOT EXISTS idx_item_dcs     ON DIM_ITEM(DCS_SID)")
    con.execute("CREATE INDEX IF NOT EXISTS idx_item_vend    ON DIM_ITEM(VEND_SID)")
    con.commit()
