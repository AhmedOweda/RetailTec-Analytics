"""
Oracle → DuckDB incremental sync
"""
import asyncio
import json
import logging
import oracledb
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timedelta
from pathlib import Path

from db.model import get_db, SETTINGS_FILE

log = logging.getLogger(__name__)


# RPS.EMPLOYEE uses FULL_NAME (confirmed via schema inspection)
# RPS.CUSTOMER uses FIRST_NAME + LAST_NAME (confirmed via schema inspection)
# RPS.DCS uses D_NAME, C_NAME, S_NAME directly (confirmed via schema inspection)
# RPS.VENDOR uses ACTIVE (not INACTIVE) — confirmed via schema inspection

_executor     = ThreadPoolExecutor(max_workers=1)
_cancel_requested = False


class SyncCancelled(Exception):
    pass


def _clear_cancel():
    global _cancel_requested
    _cancel_requested = False


def cancel_sync():
    global _cancel_requested
    _cancel_requested = True


def _check_cancel():
    """Raise if a cancel was requested — called between tables so Stop responds
    quickly instead of only at chunk boundaries."""
    if _cancel_requested:
        raise SyncCancelled("Cancelled by user")


def _get_oracle_conn():
    s = json.loads(SETTINGS_FILE.read_text())
    c = s.get("connection", {})
    host     = c.get("host", "localhost")
    port     = c.get("port", 1521)
    sid      = c.get("sid", "")
    user     = c.get("username", "")
    password = c.get("password", "")
    # Use Easy Connect string — same format as test-connection endpoint
    dsn = f"{host}:{port}/{sid}"
    return oracledb.connect(user=user, password=password, dsn=dsn)


# ── Week-chunk iterator ────────────────────────────────────────────────────────

def _week_chunks(df: date, dt: date):
    """Yield (str_from, str_to) in ~7-day windows."""
    cur = df
    while cur <= dt:
        end = min(cur + timedelta(days=6), dt)
        yield str(cur), str(end)
        cur = end + timedelta(days=1)


# ── SQL helpers ───────────────────────────────────────────────────────────────

def _sql_daily(df, dt):
    return f"""
        SELECT
            TRUNC(H.POST_DATE)              AS POST_DATE,
            H.STORE_SID,
            H.SUBSIDIARY_SID,
            SUM(CASE WHEN H.RECEIPT_TYPE = 0 THEN 1 ELSE 0 END)  AS SALES_COUNT,
            SUM(CASE WHEN H.RECEIPT_TYPE = 1 THEN 1 ELSE 0 END)  AS RETURN_COUNT,
            SUM(CASE WHEN H.RECEIPT_TYPE = 2 THEN 1 ELSE 0 END)  AS ORDER_COUNT,
            SUM(NVL(H.SALE_SUBTOTAL, 0))     AS NET_SALES_WOTAX,
            SUM(NVL(H.DISC_AMT, 0))          AS INVOICE_DISC,
            SUM(NVL(H.SALE_TOTAL_TAX_AMT, 0)) AS TOTAL_TAX,
            SUM(NVL(H.DEPOSIT_AMT_TAKEN, 0))  AS TOTAL_DEPOSIT,
            SUM(NVL(H.TOTAL_FEE_AMT, 0))      AS TOTAL_FEES,
            SUM(NVL(H.SHIPPING_AMT, 0))       AS SHIPPING_AMT,
            SUM(NVL(H.SALE_TOTAL_AMT, 0))     AS TOTAL_WTAX
        FROM RPS.DOCUMENT H
        WHERE H.POST_DATE >= TO_DATE('{df}','YYYY-MM-DD')
                AND H.POST_DATE <  TO_DATE('{dt}','YYYY-MM-DD') + 1
          AND H.STATUS = 4
          AND H.RECEIPT_TYPE IN (0, 1, 2)
        GROUP BY TRUNC(H.POST_DATE), H.STORE_SID, H.SUBSIDIARY_SID
    """


def _sql_invoices(df, dt):
    return f"""
        SELECT
            H.SID                           AS DOC_SID,
            H.DOC_NO,
            H.INVC_POST_DATE,
            H.RECEIPT_TYPE,
            H.SUBSIDIARY_SID,
            H.STORE_SID,
            H.EMPLOYEE1_SID,
            H.CASHIER_SID,
            H.BT_CUID,
            NVL(H.SOLD_QTY, 0)             AS SOLD_QTY,
            NVL(H.RETURN_QTY, 0)           AS RETURN_QTY,
            0                               AS TOTAL_COGS,
            NVL(H.SALE_SUBTOTAL, 0)         AS NET_SALES_WOTAX,
            NVL(H.SALE_TOTAL_TAX_AMT, 0)   AS TOTAL_TAX,
            NVL(H.DISC_AMT, 0)             AS INVOICE_DISC,
            NVL(H.TOTAL_DISCOUNT_AMT, 0)   AS ITEM_DISC,
            NVL(H.LTY_REDEEM_AMT, 0)       AS LOYALTY_DISC,
            NVL(H.DEPOSIT_AMT_TAKEN, 0)    AS TOTAL_DEPOSIT,
            NVL(H.TOTAL_FEE_AMT, 0)        AS TOTAL_FEES,
            NVL(H.SHIPPING_AMT, 0)         AS SHIPPING_AMT,
            NVL(H.SALE_TOTAL_AMT, 0)       AS TOTAL_WTAX,
            0                               AS CASH_AMT,
            0                               AS CARD_AMT,
            NVL(H.DEPOSIT_AMT_TAKEN, 0)    AS DEPOSIT_AMT,
            0                               AS OTHER_AMT
        FROM RPS.DOCUMENT H
        WHERE H.POST_DATE >= TO_DATE('{df}','YYYY-MM-DD')
                AND H.POST_DATE <  TO_DATE('{dt}','YYYY-MM-DD') + 1
          AND H.STATUS = 4
          AND H.RECEIPT_TYPE IN (0, 1, 2)
    """


def _sql_items(df, dt):
    # RPS.DOCUMENT_ITEM replaces RPS.LINE in RP9 Cloud; join via DOC_SID
    # Unit prices derived from PRICE/TAX_AMT; totals = unit * QTY
    return f"""
        SELECT
            DI.SID                                              AS DOC_ITEM_SID,
            DI.DOC_SID,
            H.POST_DATE                                         AS INVC_POST_DATE,
            H.STORE_SID,
            DI.INVN_SBS_ITEM_SID                               AS ITEM_SID,
            DI.ITEM_TYPE,
            NVL(DI.QTY, 0)                                     AS QTY,
            NVL(DI.COST, 0)                                    AS UNIT_COST,
            NVL(DI.ORIG_PRICE, 0)                              AS UNIT_ORIG_PRICE_WOTAX,
            NVL(DI.ORIG_PRICE,0) + NVL(DI.ORIG_TAX_AMT,0)    AS UNIT_ORIG_PRICE_WTAX,
            NVL(DI.PRICE,0) - NVL(DI.TAX_AMT,0) - NVL(DI.TAX2_AMT,0) AS UNIT_PRICE_WOTAX,
            NVL(DI.TAX_AMT,0) + NVL(DI.TAX2_AMT,0)           AS UNIT_TAX_AMT,
            NVL(DI.PRICE, 0)                                   AS UNIT_PRICE_WTAX,
            NVL(DI.DISC_AMT, 0)                                AS UNIT_ITEM_DISC,
            0                                                   AS UNIT_RECEIPT_DISC,
            0                                                   AS UNIT_LOYALTY_DISC,
            NVL(DI.QTY,0) * NVL(DI.COST,0)                    AS TOTAL_COST,
            NVL(DI.QTY,0) * NVL(DI.ORIG_PRICE,0)              AS TOTAL_ORIG_PRICE_WOTAX,
            NVL(DI.QTY,0)*(NVL(DI.PRICE,0)-NVL(DI.TAX_AMT,0)-NVL(DI.TAX2_AMT,0)) AS TOTAL_PRICE_WOTAX,
            NVL(DI.QTY,0)*(NVL(DI.TAX_AMT,0)+NVL(DI.TAX2_AMT,0)) AS TOTAL_TAX_AMT,
            NVL(DI.QTY,0) * NVL(DI.PRICE,0)                   AS TOTAL_PRICE_WTAX
        FROM RPS.DOCUMENT_ITEM DI
        INNER JOIN RPS.DOCUMENT H ON H.SID = DI.DOC_SID
        WHERE H.POST_DATE >= TO_DATE('{df}','YYYY-MM-DD')
                AND H.POST_DATE <  TO_DATE('{dt}','YYYY-MM-DD') + 1
          AND H.STATUS = 4
          AND H.RECEIPT_TYPE IN (0, 1, 2)
          AND DI.ITEM_TYPE IN (1, 2)
    """


def _sql_transfers(df, dt):
    # RP9 Cloud: SLIP.SID is PK (not SLIP_SID); POST_DATE replaces SLIP_DATE
    # VOU_NO/VOU_CLASS don't exist on SLIP — hardcoded NULL/0
    # SLIP_ITEM: QTY replaces SENT_QTY/RECV_QTY; COST/PRICE replace UNIT_COST/TOTAL_COST/TOTAL_PRICE
    return f"""
        SELECT
            SI.SID                            AS TRANSFER_ITEM_SID,
            S.SID                             AS SLIP_SID,
            S.SLIP_NO,
            S.POST_DATE                       AS SLIP_DATE,
            NULL                              AS VOU_NO,
            0                                 AS VOU_CLASS,
            NVL(S.STATUS, 3)                  AS VOU_STATUS,
            S.OUT_STORE_SID,
            S.IN_STORE_SID,
            SI.ITEM_SID,
            NVL(SI.QTY, 0)                   AS SENT_QTY,
            NVL(SI.QTY, 0)                   AS RECV_QTY,
            NVL(SI.COST, 0)                  AS UNIT_COST,
            NVL(SI.QTY,0) * NVL(SI.COST,0)  AS TOTAL_COST,
            NVL(SI.QTY,0) * NVL(SI.PRICE,0) AS TOTAL_PRICE
        FROM RPS.SLIP S
        INNER JOIN RPS.SLIP_ITEM SI ON SI.SLIP_SID = S.SID
        WHERE S.POST_DATE
              BETWEEN TO_DATE('{df}','YYYY-MM-DD') AND TO_DATE('{dt}','YYYY-MM-DD')
    """


def _sql_adjustments(df, dt):
    # RPS.ADJ_ITEM replaces RPS.ADJUSTMENT_ITEM in RP9 Cloud
    # ADJ_DATE->POST_DATE, EMPLOYEE_SID->CLERK_SID, DOC_TYPE->ADJ_TYPE
    # ORIG_QTY->ORIG_VALUE, ADJ_QTY->ADJ_VALUE, UNIT_COST->COST
    return f"""
        SELECT
            AI.SID                     AS ADJ_ITEM_SID,
            A.SID                      AS ADJ_SID,
            A.ADJ_NO,
            CAST(A.POST_DATE AS DATE)  AS ADJ_DATE,
            A.STORE_SID,
            A.CLERK_SID                AS EMPLOYEE_SID,
            NVL(A.ADJ_TYPE, 0)        AS DOC_TYPE,
            AI.ITEM_SID,
            NVL(AI.ORIG_VALUE, 0)     AS ORIG_QTY,
            NVL(AI.ADJ_VALUE, 0)      AS ADJ_QTY,
            NVL(AI.ADJ_VALUE, 0) - NVL(AI.ORIG_VALUE, 0)  AS QTY_DIFF,
            NVL(AI.COST, 0)           AS UNIT_COST,
            (NVL(AI.ADJ_VALUE, 0) - NVL(AI.ORIG_VALUE, 0)) * NVL(AI.COST, 0) AS COST_DIFF
        FROM RPS.ADJUSTMENT A
        INNER JOIN RPS.ADJ_ITEM AI ON AI.ADJ_SID = A.SID
        WHERE A.POST_DATE >= TO_DATE('{df}','YYYY-MM-DD')
          AND A.POST_DATE <  TO_DATE('{dt}','YYYY-MM-DD') + 1
    """


def _sql_purchases(df, dt):
    # RP9 Cloud: VOUCHER has no EMPLOYEE_SID (use CLERK_SID), no LINE_COUNT/ORD_QTY/RECV_QTY
    return f"""
        SELECT
            V.SID                              AS VOU_SID,
            V.VOU_NO,
            CAST(V.CREATED_DATETIME AS DATE)   AS VOU_DATE,
            NVL(V.STATUS, 3)                   AS STATUS,
            V.STORE_SID,
            V.VEND_SID,
            V.CLERK_SID                        AS EMPLOYEE_SID,
            NVL(V.VOU_SUBTOTAL, 0)             AS VOU_SUBTOTAL,
            NVL(V.VOU_TOTAL, 0)               AS VOU_TOTAL,
            NVL(V.DISC_AMT, 0)                AS DISC_AMT,
            0                                  AS LINE_COUNT,
            0                                  AS ORD_QTY,
            0                                  AS RECV_QTY
        FROM RPS.VOUCHER V
        WHERE NVL(V.SLIP_FLAG, 0) = 0
          AND NVL(V.HELD, 0) = 0
          AND V.CREATED_DATETIME >= TO_DATE('{df}','YYYY-MM-DD')
                AND V.CREATED_DATETIME <  TO_DATE('{dt}','YYYY-MM-DD') + 1
    """


def _sql_purchase_items(df, dt):
    return f"""
        SELECT
            VI.SID                             AS VOU_ITEM_SID,
            VI.VOU_SID,
            CAST(V.CREATED_DATETIME AS DATE)   AS VOU_DATE,
            V.STORE_SID,
            V.VEND_SID,
            VI.ITEM_SID,
            NVL(VI.ORIG_QTY, 0)               AS ORD_QTY,
            NVL(VI.QTY, 0)                    AS RECV_QTY,
            NVL(VI.COST, 0)                   AS UNIT_COST,
            NVL(VI.PRICE, 0)                  AS UNIT_PRICE,
            NVL(VI.DISC_AMT, 0)              AS DISC_AMT,
            NVL(VI.QTY, 0) * NVL(VI.COST, 0)  AS TOTAL_COST,
            NVL(VI.QTY, 0) * NVL(VI.PRICE, 0) AS TOTAL_RETAIL
        FROM RPS.VOU_ITEM VI
        INNER JOIN RPS.VOUCHER V ON V.SID = VI.VOU_SID
        WHERE NVL(V.SLIP_FLAG, 0) = 0
          AND NVL(V.HELD, 0) = 0
          AND V.CREATED_DATETIME >= TO_DATE('{df}','YYYY-MM-DD')
                AND V.CREATED_DATETIME <  TO_DATE('{dt}','YYYY-MM-DD') + 1
    """


def _sql_inventory_history(df, dt):
    """Qty change rows from INVENTORY_HISTORY trigger log, filtered by ACTION_DATE."""
    return f"""
        SELECT
            H.HISTORY_SID,
            H.ACTION_TYPE,
            CAST(H.ACTION_DATE AS DATE)  AS ACTION_DATE,
            H.STORE_SID,
            H.INVN_SBS_ITEM_SID          AS ITEM_SID,
            NVL(H.QTY, 0)               AS QTY,
            NVL(H.COST, 0)              AS COST,
            H.SBS_SID
        FROM RPS.INVENTORY_HISTORY H
        WHERE H.ACTION_DATE >= TO_DATE('{df}','YYYY-MM-DD')
                AND H.ACTION_DATE <  TO_DATE('{dt}','YYYY-MM-DD') + 1
    """


def _sql_inventory_qty_window(df, dt):
    """Items created or modified in this window for upsert into FACT_INVENTORY."""
    return f"""
        SELECT
            IQ.INVN_SBS_ITEM_SID   AS ITEM_SID,
            IQ.STORE_SID,
            NVL(IQ.QTY, 0)        AS ON_HAND_QTY,
            NVL(I.COST, 0)        AS COST,
            NVL(P1.PRICE, 0)      AS PRICE1
        FROM RPS.INVN_SBS_ITEM_QTY IQ
        LEFT JOIN RPS.INVN_SBS_ITEM I
            ON I.SID = IQ.INVN_SBS_ITEM_SID AND I.SBS_SID = IQ.SBS_SID
        LEFT JOIN (
            SELECT DISTINCT PR.INVN_SBS_ITEM_SID, PR.PRICE
            FROM   RPS.INVN_SBS_PRICE PR
            INNER JOIN RPS.PRICE_LEVEL PL ON PL.SID = PR.PRICE_LVL_SID
            WHERE  PL.PRICE_LVL = 1
        ) P1 ON P1.INVN_SBS_ITEM_SID = IQ.INVN_SBS_ITEM_SID
        WHERE (IQ.CREATED_DATETIME  >= TO_DATE('{df}','YYYY-MM-DD') AND IQ.CREATED_DATETIME  < TO_DATE('{dt}','YYYY-MM-DD') + 1)
           OR (IQ.MODIFIED_DATETIME >= TO_DATE('{df}','YYYY-MM-DD') AND IQ.MODIFIED_DATETIME < TO_DATE('{dt}','YYYY-MM-DD') + 1)
    """


# ── Dimension loaders ─────────────────────────────────────────────────────────

def _load_dimensions(duck, ora, progress_cb=None):
    def _r(name):
        if progress_cb:
            progress_cb(f"Loading dimension: {name}", 3, 100)
    cur = ora.cursor()

    _r("Stores")
    cur.execute("SELECT SID, STORE_CODE, STORE_NAME FROM RPS.STORE")
    rows = cur.fetchall()
    duck.execute("DELETE FROM DIM_STORE")
    if rows:
        duck.executemany("INSERT OR REPLACE INTO DIM_STORE VALUES (?,?,?)", rows)
    duck.commit()
    log.info(f"DIM_STORE: {len(rows)} rows")

    _r("Subsidiaries")
    cur.execute("SELECT SID, SBS_NO, SBS_NAME FROM RPS.SUBSIDIARY")
    rows = cur.fetchall()
    duck.execute("DELETE FROM DIM_SUBSIDIARY")
    if rows:
        duck.executemany("INSERT OR REPLACE INTO DIM_SUBSIDIARY VALUES (?,?,?)", rows)
    duck.commit()
    log.info(f"DIM_SUBSIDIARY: {len(rows)} rows")

    _r("Employees")
    cur.execute("SELECT SID, NVL(TRIM(FULL_NAME), TRIM(EMPL_NAME)) FROM RPS.EMPLOYEE")
    rows = cur.fetchall()
    duck.execute("DELETE FROM DIM_EMPLOYEE")
    if rows:
        duck.executemany("INSERT OR REPLACE INTO DIM_EMPLOYEE VALUES (?,?)", rows)
    duck.commit()
    log.info(f"DIM_EMPLOYEE: {len(rows)} rows")

    # RPS.DCS columns are D_NAME, C_NAME, S_NAME (confirmed via schema inspection)
    _r("Departments (DCS)")
    cur.execute("""
        SELECT SID, SBS_SID, DCS_CODE,
               D_NAME, C_NAME, S_NAME
        FROM RPS.DCS
    """)
    rows = cur.fetchall()
    duck.execute("DELETE FROM DIM_DCS")
    if rows:
        duck.executemany("INSERT OR REPLACE INTO DIM_DCS VALUES (?,?,?,?,?,?)", rows)
    duck.commit()
    log.info(f"DIM_DCS: {len(rows)} rows")

    # RPS.VENDOR uses ACTIVE column (not INACTIVE) — confirmed via schema inspection
    _r("Vendors")
    cur.execute("""
        SELECT SID, SBS_SID, VEND_CODE, VEND_NAME
        FROM RPS.VENDOR
        WHERE NVL(ACTIVE, 1) = 1
    """)
    rows = cur.fetchall()
    duck.execute("DELETE FROM DIM_VENDOR")
    if rows:
        duck.executemany("INSERT OR REPLACE INTO DIM_VENDOR VALUES (?,?,?,?)", rows)
    duck.commit()
    log.info(f"DIM_VENDOR: {len(rows)} rows")

    cur.close()


def _load_large_dims(duck, ora, df, dt, progress_cb=None):
    def _r(name):
        if progress_cb:
            progress_cb(f"Loading dimension: {name}", 91, 100)
    cur = ora.cursor()

    _r("Customers")
    cur.execute(f"""
        SELECT DISTINCT H.BT_CUID AS SID,
               TRIM(NVL(C.FIRST_NAME,'')||' '||NVL(C.LAST_NAME,'')) AS FULL_NAME
        FROM RPS.DOCUMENT H
        INNER JOIN RPS.CUSTOMER C ON C.SID = H.BT_CUID
        WHERE H.POST_DATE >= TO_DATE('{df}','YYYY-MM-DD')
                AND H.POST_DATE <  TO_DATE('{dt}','YYYY-MM-DD') + 1
          AND H.BT_CUID IS NOT NULL
          AND H.STATUS = 4
    """)
    rows = cur.fetchall()
    if rows:
        duck.executemany("INSERT OR REPLACE INTO DIM_CUSTOMER VALUES (?,?)", rows)
        duck.commit()
    log.info(f"DIM_CUSTOMER: {len(rows)} rows")

    _r("Items")
    cur.execute(f"""
        SELECT I.SID, I.SBS_SID, I.ALU, I.UPC,
               I.DESCRIPTION1, I.DESCRIPTION2,
               I.ATTRIBUTE, I.ITEM_SIZE,
               I.DCS_SID, I.VEND_SID,
               NVL(I.ACTIVE, 1)
        FROM RPS.INVN_SBS_ITEM I
        WHERE (I.CREATED_DATETIME  >= TO_DATE('{df}','YYYY-MM-DD') AND I.CREATED_DATETIME  < TO_DATE('{dt}','YYYY-MM-DD') + 1)
           OR (I.MODIFIED_DATETIME >= TO_DATE('{df}','YYYY-MM-DD') AND I.MODIFIED_DATETIME < TO_DATE('{dt}','YYYY-MM-DD') + 1)
    """)
    rows = cur.fetchall()
    if rows:
        duck.executemany("INSERT OR REPLACE INTO DIM_ITEM VALUES (?,?,?,?,?,?,?,?,?,?,?)", rows)
        duck.commit()
    log.info(f"DIM_ITEM: {len(rows)} rows")

    cur.close()


# ── Inventory snapshot ────────────────────────────────────────────────────────

def _sync_inventory_snapshot(duck, ora):
    """Full DELETE+INSERT snapshot of current on-hand quantities from Oracle."""
    cur = ora.cursor()
    cur.execute("""
        SELECT
            IQ.INVN_SBS_ITEM_SID   AS ITEM_SID,
            IQ.STORE_SID,
            NVL(IQ.QTY, 0)        AS ON_HAND_QTY,
            NVL(I.COST, 0)        AS COST,
            NVL(P1.PRICE, 0)      AS PRICE1
        FROM RPS.INVN_SBS_ITEM_QTY IQ
        LEFT JOIN RPS.INVN_SBS_ITEM I
            ON I.SID = IQ.INVN_SBS_ITEM_SID AND I.SBS_SID = IQ.SBS_SID
        LEFT JOIN (
            SELECT DISTINCT PR.INVN_SBS_ITEM_SID, PR.PRICE
            FROM RPS.INVN_SBS_PRICE PR
            INNER JOIN RPS.PRICE_LEVEL PL ON PL.SID = PR.PRICE_LVL_SID
            WHERE PL.PRICE_LVL = 1
        ) P1 ON P1.INVN_SBS_ITEM_SID = IQ.INVN_SBS_ITEM_SID
        WHERE IQ.QTY IS NOT NULL AND IQ.QTY != 0
    """)
    rows = cur.fetchall()
    cur.close()
    now_str = datetime.utcnow().strftime('%Y-%m-%d %H:%M:%S')
    duck.execute("DROP TABLE IF EXISTS FACT_INVENTORY")
    duck.execute("""CREATE TABLE FACT_INVENTORY (
        ITEM_SID BIGINT, STORE_SID BIGINT, ON_HAND_QTY DECIMAL(12,3),
        COST DECIMAL(18,4), PRICE1 DECIMAL(18,4), SYNCED_AT TIMESTAMP)""")
    if rows:
        duck.executemany(
            "INSERT INTO FACT_INVENTORY VALUES (?,?,?,?,?,?)",
            [(r[0], r[1], r[2], r[3], r[4], now_str) for r in rows],
        )
    duck.commit()
    log.info(f"FACT_INVENTORY: {len(rows):,} rows loaded")


# ── Streaming bulk fact load ────────────────────────────────────────────────────
# Oracle date columns are NOT indexed (confirmed on RPS.DOCUMENT), so every
# date-filtered query full-scans the table. The old code chunked by week, turning
# ONE scan into hundreds (≈312 for a multi-year load) — the root of the 24-hour
# load. We now scan each table ONCE over the whole range and STREAM rows in batches
# (bounded memory) instead of fetchall(). Inserts are INSERT-ONLY (OR IGNORE):
# closed STATUS=4 documents are immutable, so existing rows are never rewritten.
# force_replace (repair only) overwrites existing keys.

_BATCH = 50_000


def _stream_insert(duck, ora, sql: str, table: str, ncols: int,
                   force_replace: bool = False, progress=None) -> int:
    """Run one Oracle query and stream its rows into `table` in bulk batches.
    The SELECT column order matches the DuckDB table column order (verified per
    query builder), so rows are inserted positionally. Returns rows loaded."""
    verb = "INSERT OR REPLACE INTO" if force_replace else "INSERT OR IGNORE INTO"
    ph   = "(" + ",".join(["?"] * ncols) + ")"
    cur = ora.cursor()
    cur.arraysize    = _BATCH
    cur.prefetchrows = _BATCH
    log.info(f"Oracle: scanning {table}")
    cur.execute(sql)
    total = 0
    while True:
        _check_cancel()
        rows = cur.fetchmany(_BATCH)
        if not rows:
            break
        duck.executemany(f"{verb} {table} VALUES {ph}", rows)
        duck.commit()
        total += len(rows)
        if progress:
            progress(total)
        log.info(f"{table}: {total:,} rows")
    cur.close()
    return total


def _derive_daily(duck, df: str, dt: str):
    """Build FACT_SALES_DAILY from the invoices already in DuckDB — no extra Oracle
    scan. Equivalent to the old Oracle DAILY aggregate (same STATUS=4 source rows)."""
    duck.execute("""
        CREATE OR REPLACE TABLE FACT_SALES_DAILY AS
        SELECT INVC_POST_DATE AS POST_DATE, STORE_SID,
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
               SUM(TOTAL_WTAX)      AS TOTAL_WTAX
        FROM FACT_SALES_INVOICES
        GROUP BY INVC_POST_DATE, STORE_SID, COALESCE(SUBSIDIARY_SID, 0)
    """)
    duck.commit()
    log.info("FACT_SALES_DAILY rebuilt from invoices (no PK index)")


def _stream_inventory_qty(duck, ora, df: str, dt: str):
    """Stream the on-hand qty window into FACT_INVENTORY (snapshot upsert + SYNCED_AT)."""
    now = datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S")
    cur = ora.cursor()
    cur.arraysize    = _BATCH
    cur.prefetchrows = _BATCH
    cur.execute(_sql_inventory_qty_window(df, dt))
    total = 0
    while True:
        _check_cancel()
        rows = cur.fetchmany(_BATCH)
        if not rows:
            break
        duck.executemany(
            "INSERT OR REPLACE INTO FACT_INVENTORY VALUES (?,?,?,?,?,?)",
            [(r[0], r[1], r[2], r[3], r[4], now) for r in rows],
        )
        duck.commit()
        total += len(rows)
    cur.close()
    log.info(f"FACT_INVENTORY upsert {df}->{dt}: {total:,} rows")


def _trim_range(duck, tables, date_from: str, date_to: str):
    """REBUILD mode only (destructive): delete facts inside [from,to] before reload."""
    ALL = tables is None
    if ALL or "sales" in tables:
        duck.execute("DELETE FROM FACT_SALES_INVOICES WHERE INVC_POST_DATE BETWEEN ? AND ?", [date_from, date_to])
        duck.execute("DELETE FROM FACT_SALES_ITEMS    WHERE INVC_POST_DATE BETWEEN ? AND ?", [date_from, date_to])
        duck.execute("DELETE FROM FACT_SALES_DAILY    WHERE POST_DATE      BETWEEN ? AND ?", [date_from, date_to])
    if ALL or "transfers" in tables:
        duck.execute("DELETE FROM FACT_TRANSFERS      WHERE SLIP_DATE BETWEEN ? AND ?", [date_from, date_to])
    if ALL or "adjustments" in tables:
        duck.execute("DELETE FROM FACT_ADJUSTMENTS    WHERE ADJ_DATE  BETWEEN ? AND ?", [date_from, date_to])
    if ALL or "purchases" in tables:
        duck.execute("DELETE FROM FACT_PURCHASES      WHERE VOU_DATE  BETWEEN ? AND ?", [date_from, date_to])
        duck.execute("DELETE FROM FACT_PURCHASE_ITEMS WHERE VOU_DATE  BETWEEN ? AND ?", [date_from, date_to])
    duck.commit()


# ── Fact load (one streaming Oracle scan per table over the whole range) ─────────

def _sync_chunk(duck, df: str, dt: str, skip_existing: bool = False,
                tables: set | None = None, force_replace: bool = False,
                progress_cb=None, base: int = 5, span: int = 100):
    ALL = tables is None
    ora = _get_oracle_conn()

    def _p(step_label, i, n):
        if progress_cb:
            progress_cb(step_label, base + int((i / max(n, 1)) * (span - base - 5)), span)
    try:
        # ── Sales: invoices → items → derive daily locally (no 3rd Oracle scan) ─
        if ALL or "sales" in tables:
            _p("Sales invoices", 0, 6)
            _stream_insert(duck, ora, _sql_invoices(df, dt), "FACT_SALES_INVOICES", 25, force_replace)
            _p("Sales items", 1, 6)
            _stream_insert(duck, ora, _sql_items(df, dt), "FACT_SALES_ITEMS", 21, force_replace)
            _derive_daily(duck, df, dt)

        # ── Transfers ────────────────────────────────────────────────────────
        if ALL or "transfers" in tables:
            _p("Transfers", 2, 6)
            _stream_insert(duck, ora, _sql_transfers(df, dt), "FACT_TRANSFERS", 15, force_replace)

        # ── Adjustments ──────────────────────────────────────────────────────
        if ALL or "adjustments" in tables:
            _p("Adjustments", 3, 6)
            _stream_insert(duck, ora, _sql_adjustments(df, dt), "FACT_ADJUSTMENTS", 13, force_replace)

        # ── Purchases → purchase items ───────────────────────────────────────
        if ALL or "purchases" in tables:
            _p("Purchases", 4, 6)
            _stream_insert(duck, ora, _sql_purchases(df, dt), "FACT_PURCHASES", 13, force_replace)
            _stream_insert(duck, ora, _sql_purchase_items(df, dt), "FACT_PURCHASE_ITEMS", 13, force_replace)

        # ── Inventory: history (append) + on-hand qty window (upsert) ─────────
        if ALL or "inventory" in tables:
            _p("Inventory history", 5, 6)
            _stream_insert(duck, ora, _sql_inventory_history(df, dt), "FACT_INVENTORY_HISTORY", 8, force_replace)
            _stream_inventory_qty(duck, ora, df, dt)

        log.info(f"Facts loaded: {df}->{dt}")

    finally:
        ora.close()


# ── ETL run logging ───────────────────────────────────────────────────────────

def _log_start(duck, run_type: str, triggered_by: str, domains: str,
               date_from: str, date_to: str, chunks_total: int) -> int:
    """Insert a SYNC_RUN row and return its run_id."""
    run_id = duck.execute(
        "SELECT COALESCE(MAX(run_id), 0) + 1 FROM SYNC_RUN"
    ).fetchone()[0]
    duck.execute("""
        INSERT INTO SYNC_RUN
            (run_id, run_type, triggered_by, domains, date_from, date_to,
             started_at, status, chunks_done, chunks_total)
        VALUES (?, ?, ?, ?, ?, ?, NOW(), 'running', 0, ?)
    """, [run_id, run_type, triggered_by, domains,
          date_from, date_to, chunks_total])
    duck.commit()
    return run_id


def _log_progress(duck, run_id: int, chunks_done: int):
    duck.execute(
        "UPDATE SYNC_RUN SET chunks_done = ? WHERE run_id = ?",
        [chunks_done, run_id]
    )
    duck.commit()


def _log_finish(duck, run_id: int, status: str, error_msg: str = None):
    duck.execute(
        "UPDATE SYNC_RUN SET status = ?, finished_at = NOW(), error_msg = ? WHERE run_id = ?",
        [status, error_msg, run_id]
    )
    duck.commit()


def _update_watermarks(duck, domains, date_from: str, date_to: str, run_id: int):
    """Upsert SYNC_WATERMARK for each loaded domain."""
    all_domains = ["sales", "transfers", "adjustments", "purchases", "inventory"]
    targets = all_domains if domains is None else list(domains)
    for domain in targets:
        duck.execute("""
            INSERT INTO SYNC_WATERMARK (domain, loaded_from, loaded_to, last_run_id, updated_at)
            VALUES (?, ?, ?, ?, NOW())
            ON CONFLICT (domain) DO UPDATE SET
                loaded_from = excluded.loaded_from,
                loaded_to   = excluded.loaded_to,
                last_run_id = excluded.last_run_id,
                updated_at  = excluded.updated_at
        """, [domain, date_from, date_to, run_id])
    duck.commit()



# ── Core sync ──────────────────────────────────────────────────────────────────

def _run_sync(mode: str, date_from: str, date_to: str,
              progress_cb=None, rebuild: bool = False,
              tables: set | None = None,
              triggered_by: str = "user",
              force_replace: bool = False):
    """Run a sync over [date_from, date_to].
      • Facts are loaded in ONE streaming Oracle scan per table (no weekly chunking)
        — because Oracle's date columns are unindexed, chunking multiplied full scans.
      • APPEND by default (insert-only): existing rows are kept, only new closed docs
        are added — NON-destructive.
      • rebuild=True: clear the range first, then reload (opt-in, destructive).
      • force_replace=True: overwrite existing rows in place (repair only).
    """
    ALL = tables is None
    _clear_cancel()
    duck = get_db()
    _domains_str = "all" if tables is None else str(sorted(tables))
    _run_id = _log_start(duck, mode, triggered_by, _domains_str, date_from, date_to, 100)

    try:
        ora = _get_oracle_conn()
        try:
            # Step 1 — dimensions (full refresh; small tables)
            if progress_cb:
                progress_cb("Loading dimensions", 2, 100)
            _load_dimensions(duck, ora, progress_cb)

            # Step 2 — REBUILD only (opt-in, destructive): clear the range first
            if rebuild:
                if progress_cb:
                    progress_cb("Rebuild: clearing range", 4, 100)
                _trim_range(duck, tables, date_from, date_to)

            # Step 3 — facts: one streaming scan per table over the whole range
            _sync_chunk(duck, date_from, date_to, tables=tables,
                        force_replace=force_replace,
                        progress_cb=progress_cb, base=5, span=90)
            _log_progress(duck, _run_id, 1)

            # Step 4 — large dims (customers, items) for the range
            if progress_cb:
                progress_cb("Loading customers & items", 90, 100)
            _load_large_dims(duck, ora, date_from, date_to, progress_cb)

            # Step 5 — inventory on-hand snapshot (current state, full refresh)
            if ALL or "inventory" in tables:
                if progress_cb:
                    progress_cb("Inventory snapshot", 95, 100)
                try:
                    _sync_inventory_snapshot(duck, ora)
                except Exception as e:
                    log.warning(f"Inventory snapshot skipped: {e}")
        finally:
            ora.close()

        if progress_cb:
            progress_cb("Done", 100, 100)
        _update_watermarks(duck, tables, date_from, date_to, _run_id)
        _log_finish(duck, _run_id, "completed")
        s = json.loads(SETTINGS_FILE.read_text())
        s["last_sync"]    = datetime.now().isoformat()
        s["model_status"] = "ready"
        SETTINGS_FILE.write_text(json.dumps(s, indent=2, default=str))
        log.info(f"Sync [{mode}] complete: {date_from}->{date_to}")

    except SyncCancelled:
        _log_finish(duck, _run_id, "cancelled", "Cancelled by user")
        log.info("Sync cancelled by user")
        raise
    except Exception as e:
        _log_finish(duck, _run_id, "error", str(e)[:500])
        log.error(f"Sync failed: {e}")
        raise


# ── Public API ─────────────────────────────────────────────────────────────────

def _date_range(days: int):
    dt = datetime.now().date()
    return str(dt - timedelta(days=days - 1)), str(dt)


async def full_load(days: int = 365, progress_cb=None, tables: set | None = None,
                    triggered_by: str = "user", force_replace: bool = False,
                    rebuild: bool = False):
    """Full load over the last `days` — APPEND by default (insert-only, non-destructive:
    keeps existing data, adds new closed docs). rebuild=True clears the range first;
    force_replace=True overwrites existing rows in place (repair only)."""
    df, dt = _date_range(days)
    log.info(f"Full load: {df}->{dt} (rebuild={rebuild}, force_replace={force_replace})")
    await asyncio.get_event_loop().run_in_executor(
        _executor, _run_sync, "full", df, dt, progress_cb, rebuild, tables, triggered_by,
        force_replace)


async def range_load(date_from: str, date_to: str, progress_cb=None,
                     tables: set | None = None, triggered_by: str = "user",
                     force_replace: bool = False, rebuild: bool = False):
    """Load an explicit date range [date_from, date_to] (YYYY-MM-DD strings).
    APPEND by default (insert-only, non-destructive). rebuild=True clears the range
    first; force_replace=True overwrites existing rows in place (repair)."""
    log.info(f"Range load: {date_from}->{date_to} (rebuild={rebuild})")
    await asyncio.get_event_loop().run_in_executor(
        _executor, _run_sync, "range", date_from, date_to, progress_cb, rebuild, tables,
        triggered_by, force_replace)


# -- Retention (cap the largest tables) ----------------------------------------

_RETENTION_COLS = {
    "FACT_SALES_ITEMS":       "INVC_POST_DATE",
    "FACT_INVENTORY_HISTORY": "ACTION_DATE",
}

def apply_retention(retain_months=24, dry_run: bool = False, duck=None) -> dict:
    """Prune line-item DETAIL older than retain_months (keeps FACT_SALES_DAILY and
    invoice headers forever). retain_months None/0 = keep everything. dry_run counts
    without deleting. Returns {table: rows_pruned}."""
    duck = duck or get_db()
    if not retain_months:
        return {"retain_months": None, "pruned": {}}
    m = int(retain_months)
    pruned = {}
    for table, col in _RETENTION_COLS.items():
        try:
            where = f"{col} < (CURRENT_DATE - INTERVAL '{m}' MONTH)"
            n = duck.execute(f"SELECT COUNT(*) FROM {table} WHERE {where}").fetchone()[0]
            if n and not dry_run:
                duck.execute(f"DELETE FROM {table} WHERE {where}")
                duck.commit()
                log.info(f"Retention: pruned {n:,} rows from {table} (> {m} months old)")
            pruned[table] = int(n)
        except Exception as e:
            log.warning(f"Retention on {table} failed: {e}")
            pruned[table] = None
    return {"retain_months": m, "dry_run": dry_run, "pruned": pruned}


async def incremental(days: int = 7, progress_cb=None,
                      triggered_by: str = "scheduler", force_replace: bool = False,
                      tables: set | None = None):
    """Incremental - immutable facts INSERT-ONLY (append newly-closed docs),
    FACT_SALES_DAILY aggregate replaced for the window. tables=None = all domains;
    pass a set to sync only specific ones (per-domain scheduling)."""
    df, dt = _date_range(days)
    log.info(f"Incremental: {df}->{dt} (tables={tables or 'all'})")
    await asyncio.get_event_loop().run_in_executor(
        _executor, _run_sync, "incremental", df, dt, progress_cb, False, tables, triggered_by,
        force_replace)
