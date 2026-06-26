"""
Oracle → DuckDB Sync Engine  (Star Schema)
==========================================
Load order every sync:
  1. Dimensions  — full DELETE+INSERT for all 7 dim tables (fast, small)
  2. Fact chunks — weekly slices, INSERT OR IGNORE on SIDs (resumable)

Cancellable between chunks via request_cancel().
"""

import asyncio
import json
import logging
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, date
from pathlib import Path

import oracledb

from db.model import get_db

log = logging.getLogger(__name__)

SETTINGS_FILE = Path(__file__).parent.parent / "settings.json"
_executor = ThreadPoolExecutor(max_workers=1)

# ── Cancellation ───────────────────────────────────────────────────────────────
_cancel_requested = False

def request_cancel():
    global _cancel_requested
    _cancel_requested = True
    log.info("Sync cancel requested")

def _clear_cancel():
    global _cancel_requested
    _cancel_requested = False

class SyncCancelled(Exception):
    pass


# ── Oracle connection ──────────────────────────────────────────────────────────

def _get_oracle_conn():
    s = json.loads(SETTINGS_FILE.read_text())
    c = s["connection"]
    try:
        oracledb.init_oracle_client()
    except Exception:
        pass
    conn = oracledb.connect(
        user=c["username"],
        password=c["password"],
        dsn=f"{c['host']}:{c['port']}/{c['sid']}",
    )
    conn.callTimeout = 0
    return conn


# ── Week chunks ────────────────────────────────────────────────────────────────

def _week_chunks(date_from: date, date_to: date):
    cursor = date_from
    while cursor <= date_to:
        chunk_end = min(cursor + timedelta(days=6), date_to)
        yield str(cursor), str(chunk_end)
        cursor = chunk_end + timedelta(days=1)


# ── Dimension definitions ──────────────────────────────────────────────────────

_DIMS = [
    {
        "table": "DIM_STORE",
        "sql":   "SELECT SID, STORE_CODE, STORE_NAME FROM RPS.STORE",
        "cols":  ["SID", "STORE_CODE", "STORE_NAME"],
        "ph":    "(?,?,?)",
    },
    {
        "table": "DIM_SUBSIDIARY",
        "sql":   "SELECT SID, SBS_NO, SBS_NAME FROM RPS.SUBSIDIARY",
        "cols":  ["SID", "SBS_NO", "SBS_NAME"],
        "ph":    "(?,?,?)",
    },
    {
        "table": "DIM_EMPLOYEE",
        "sql":   "SELECT SID, COALESCE(FULL_NAME, EMPL_NAME) AS FULL_NAME FROM RPS.EMPLOYEE",
        "cols":  ["SID", "FULL_NAME"],
        "ph":    "(?,?)",
    },
    # DIM_CUSTOMER and DIM_ITEM loaded after facts — see _load_large_dims()
    {
        "table": "DIM_DCS",
        "sql":   "SELECT SID, SBS_SID, DCS_CODE, D_NAME, C_NAME, S_NAME FROM RPS.DCS",
        "cols":  ["SID", "SBS_SID", "DCS_CODE", "D_NAME", "C_NAME", "S_NAME"],
        "ph":    "(?"+",?"*5+")",
    },
    {
        "table": "DIM_VENDOR",
        "sql":   "SELECT SID, SBS_SID, VEND_CODE, VEND_NAME FROM RPS.VENDOR",
        "cols":  ["SID", "SBS_SID", "VEND_CODE", "VEND_NAME"],
        "ph":    "(?"+",?"*3+")",
    },
]



def _load_large_dims(duck, ora, df: str, dt: str):
    """
    Load DIM_CUSTOMER and DIM_ITEM using Oracle-side date filtering.
    Only rows whose SID appears in DOCUMENT (customers) or DOCUMENT_ITEM (items)
    within the sync window are fetched.  Uses INSERT OR IGNORE so repeat runs
    are safe and already-loaded rows are not re-inserted.
    """
    # ── DIM_CUSTOMER ──────────────────────────────────────────────────────────
    cur = ora.cursor()
    cur.execute(f"""
        SELECT C.SID, C.FIRST_NAME || ' ' || C.LAST_NAME AS FULL_NAME
        FROM   RPS.CUSTOMER C
        WHERE  C.SID IN (
            SELECT DISTINCT D.BT_CUID
            FROM   RPS.DOCUMENT D
            WHERE  D.STATUS = 4
              AND  D.BT_CUID IS NOT NULL
              AND  TRUNC(D.INVC_POST_DATE)
                       BETWEEN TO_DATE('{df}','YYYY-MM-DD')
                           AND TO_DATE('{dt}','YYYY-MM-DD')
        )
    """)
    rows = cur.fetchall()
    cur.close()
    if rows:
        duck.executemany("INSERT OR IGNORE INTO DIM_CUSTOMER VALUES (?,?)", rows)
        duck.commit()
    log.info(f"DIM_CUSTOMER: {len(rows):,} rows loaded (date-filtered)")

    # ── DIM_ITEM ──────────────────────────────────────────────────────────────
    cur = ora.cursor()
    cur.execute(f"""
        SELECT I.SID, I.SBS_SID, I.ALU, TO_CHAR(I.UPC) AS UPC,
               I.DESCRIPTION1, I.DESCRIPTION2, I.ATTRIBUTE, I.ITEM_SIZE,
               I.DCS_SID, I.VEND_SID
        FROM   RPS.INVN_SBS_ITEM I
        WHERE  I.SID IN (
            SELECT DISTINCT DI.INVN_SBS_ITEM_SID
            FROM   RPS.DOCUMENT_ITEM DI
            JOIN   RPS.DOCUMENT      D  ON DI.DOC_SID = D.SID
            WHERE  D.STATUS      = 4
              AND  DI.ITEM_TYPE  IN (1, 2)
              AND  DI.KIT_FLAG  <> 5
              AND  TRUNC(D.INVC_POST_DATE)
                       BETWEEN TO_DATE('{df}','YYYY-MM-DD')
                           AND TO_DATE('{dt}','YYYY-MM-DD')
        )
    """)
    rows = cur.fetchall()
    cur.close()
    if rows:
        duck.executemany(
            "INSERT OR IGNORE INTO DIM_ITEM VALUES (?"+",?"*9+")",
            rows,
        )
        duck.commit()
    log.info(f"DIM_ITEM: {len(rows):,} rows loaded (date-filtered)")


def _load_dimensions(duck, ora):
    """Full refresh all dimension tables. Called at the start of every sync."""
    for dim in _DIMS:
        cur = ora.cursor()
        cur.execute(dim["sql"])
        rows     = cur.fetchall()
        ora_cols = [d[0] for d in cur.description]
        cur.close()

        duck.execute(f"DELETE FROM {dim['table']}")
        if rows:
            duck.executemany(
                f"INSERT INTO {dim['table']} VALUES {dim['ph']}",
                [[r[ora_cols.index(c)] if c in ora_cols else None
                  for c in dim["cols"]]
                 for r in rows],
            )
        duck.commit()
        log.info(f"{dim['table']}: {len(rows):,} rows")


# ── Fact SQL builders ──────────────────────────────────────────────────────────

def _sql_daily(df, dt):
    return f"""
        SELECT D.SUBSIDIARY_SID, D.STORE_SID,
               TRUNC(D.INVC_POST_DATE) AS POST_DATE,
               SUM(CASE WHEN D.RECEIPT_TYPE=0 THEN 1 ELSE 0 END) AS SALES_COUNT,
               SUM(CASE WHEN D.RECEIPT_TYPE=1 THEN 1 ELSE 0 END) AS RETURN_COUNT,
               SUM(CASE WHEN D.RECEIPT_TYPE=2 THEN 1 ELSE 0 END) AS ORDER_COUNT,
               SUM((NVL(D.SALE_SUBTOTAL_WITH_TAX,0)-NVL(D.SALE_TOTAL_TAX_AMT,0))
                  -(NVL(D.RETURN_SUBTOTAL_WITH_TAX,0)-NVL(D.RETURN_TOTAL_TAX_AMT,0))) AS NET_SALES_WOTAX,
               SUM(NVL(D.DISC_AMT,0))                                                  AS INVOICE_DISC,
               SUM(NVL(D.SALE_TOTAL_TAX_AMT,0)-NVL(D.RETURN_TOTAL_TAX_AMT,0))         AS TOTAL_TAX,
               SUM(NVL(D.TOTAL_DEPOSIT_TAKEN,0))                                        AS TOTAL_DEPOSIT,
               SUM(NVL(D.TOTAL_FEE_AMT,0))                                              AS TOTAL_FEES,
               SUM(NVL(D.shipping_amt,0))                                               AS SHIPPING_AMT,
               SUM((NVL(D.SALE_SUBTOTAL_WITH_TAX,0)-NVL(D.RETURN_SUBTOTAL_WITH_TAX,0))
                  +NVL(D.TOTAL_DEPOSIT_TAKEN,0)+NVL(D.TOTAL_FEE_AMT,0)
                  +NVL(D.shipping_amt,0))                                               AS TOTAL_WTAX
        FROM RPS.DOCUMENT D
        WHERE D.STATUS=4
          AND TRUNC(D.INVC_POST_DATE) BETWEEN TO_DATE('{df}','YYYY-MM-DD')
                                          AND TO_DATE('{dt}','YYYY-MM-DD')
        GROUP BY D.SUBSIDIARY_SID, D.STORE_SID, TRUNC(D.INVC_POST_DATE)
    """


def _sql_invoices(df, dt):
    return f"""
        SELECT D.SID AS DOC_SID, D.DOC_NO, D.INVC_POST_DATE, D.RECEIPT_TYPE,
               D.SUBSIDIARY_SID, D.STORE_SID,
               D.EMPLOYEE1_SID, D.CASHIER_SID, D.BT_CUID,
               NVL(D.sold_qty,0)   AS SOLD_QTY,
               NVL(D.return_qty,0) AS RETURN_QTY,
               NVL(i.cost,0)       AS TOTAL_COGS,
               (NVL(D.SALE_SUBTOTAL_WITH_TAX,0)-NVL(D.SALE_TOTAL_TAX_AMT,0))
              -(NVL(D.RETURN_SUBTOTAL_WITH_TAX,0)-NVL(D.RETURN_TOTAL_TAX_AMT,0)) AS NET_SALES_WOTAX,
               NVL(D.SALE_TOTAL_TAX_AMT,0)-NVL(D.RETURN_TOTAL_TAX_AMT,0)         AS TOTAL_TAX,
               NVL(D.DISC_AMT,0)                    AS INVOICE_DISC,
               NVL(i.DISC_AMT,0)                    AS ITEM_DISC,
               NVL(D.LTY_SALE_TOTAL_BASED_DISC,0)   AS LOYALTY_DISC,
               NVL(D.TOTAL_DEPOSIT_TAKEN,0)          AS TOTAL_DEPOSIT,
               NVL(D.TOTAL_FEE_AMT,0)               AS TOTAL_FEES,
               NVL(D.shipping_amt,0)                 AS SHIPPING_AMT,
               (NVL(D.SALE_SUBTOTAL_WITH_TAX,0)-NVL(D.RETURN_SUBTOTAL_WITH_TAX,0))
              +NVL(D.TOTAL_DEPOSIT_TAKEN,0)+NVL(D.TOTAL_FEE_AMT,0)
              +NVL(D.shipping_amt,0)                 AS TOTAL_WTAX,
               NVL(t1.cash,0)    AS CASH_AMT,
               NVL(t2.credit,0)  AS CARD_AMT,
               NVL(t4.deposit,0) AS DEPOSIT_AMT,
               NVL(t3.other,0)   AS OTHER_AMT
        FROM RPS.DOCUMENT D
        LEFT JOIN (SELECT doc_sid,
                          SUM(CASE WHEN item_type=2 THEN qty*-1 ELSE qty END * cost) AS cost,
                          SUM(CASE WHEN item_type=2 THEN disc_amt*-1 ELSE disc_amt END) AS disc_amt
                   FROM RPS.document_item
                   WHERE item_type IN (1,2) AND kit_flag<>5
                   GROUP BY doc_sid) i  ON i.doc_sid = D.SID
        LEFT JOIN (SELECT doc_sid, SUM(amount) AS cash    FROM rps.tender WHERE tender_type=0                GROUP BY doc_sid) t1 ON t1.doc_sid=D.SID
        LEFT JOIN (SELECT doc_sid, SUM(amount) AS credit  FROM rps.tender WHERE tender_type IN(2,11)         GROUP BY doc_sid) t2 ON t2.doc_sid=D.SID
        LEFT JOIN (SELECT doc_sid, SUM(amount) AS other   FROM rps.tender WHERE tender_type NOT IN(0,2,11,7) GROUP BY doc_sid) t3 ON t3.doc_sid=D.SID
        LEFT JOIN (SELECT doc_sid, SUM(amount) AS deposit FROM rps.tender WHERE tender_type=7                GROUP BY doc_sid) t4 ON t4.doc_sid=D.SID
        WHERE D.STATUS=4
          AND TRUNC(D.INVC_POST_DATE) BETWEEN TO_DATE('{df}','YYYY-MM-DD')
                                          AND TO_DATE('{dt}','YYYY-MM-DD')
    """


def _sql_items(df, dt):
    return f"""
        SELECT DI.SID            AS DOC_ITEM_SID,
               DI.DOC_SID,
               DO.INVC_POST_DATE,
               DO.STORE_SID,
               DI.INVN_SBS_ITEM_SID AS ITEM_SID,
               CASE WHEN DI.ITEM_TYPE=1 THEN 'Sale'
                    WHEN DI.ITEM_TYPE=2 THEN 'Return'
                    ELSE 'Order' END                                            AS ITEM_TYPE,
               CASE WHEN DI.ITEM_TYPE=2 THEN DI.QTY*(-1) ELSE DI.QTY END      AS QTY,
               DI.COST                                                          AS UNIT_COST,
               CASE WHEN DO.USE_VAT=1 THEN DI.ORIG_PRICE-NVL(DI.ORIG_TAX_AMT,0)
                    ELSE DI.ORIG_PRICE END                                      AS UNIT_ORIG_PRICE_WOTAX,
               CASE WHEN DO.USE_VAT=1 THEN DI.ORIG_PRICE
                    ELSE DI.ORIG_PRICE+NVL(DI.ORIG_TAX_AMT,0) END             AS UNIT_ORIG_PRICE_WTAX,
               (CASE WHEN DO.USE_VAT=1 THEN DI.DIP_PRICE-NVL(DI.DIP_TAX_AMT,0)
                     ELSE DI.DIP_PRICE END)
              -NVL(DI.LTY_PIECE_OF_TBR_DISC_AMT,0)                            AS UNIT_PRICE_WOTAX,
               DI.DIP_TAX_AMT                                                   AS UNIT_TAX_AMT,
               (CASE WHEN DO.USE_VAT=1 THEN DI.DIP_PRICE
                     ELSE DI.DIP_PRICE+DI.DIP_TAX_AMT END)
              -NVL(DI.LTY_PIECE_OF_TBR_DISC_AMT,0)                            AS UNIT_PRICE_WTAX,
               ROUND((CASE WHEN DO.USE_VAT=1 THEN DI.ORIG_PRICE-NVL(DI.ORIG_TAX_AMT,0)
                           ELSE DI.ORIG_PRICE END)
                    -(CASE WHEN DO.USE_VAT=1 THEN DI.PRICE-NVL(DI.TAX_AMT,0)
                           ELSE DI.PRICE END), 2)                              AS UNIT_ITEM_DISC,
               (CASE WHEN DO.USE_VAT=1 THEN DI.PRICE-NVL(DI.TAX_AMT,0)
                     ELSE DI.PRICE END)
              -(CASE WHEN DO.USE_VAT=1 THEN DI.DIP_PRICE-NVL(DI.DIP_TAX_AMT,0)
                     ELSE DI.DIP_PRICE END)                                    AS UNIT_RECEIPT_DISC,
               NVL(DI.LTY_PIECE_OF_TBR_DISC_AMT,0)                            AS UNIT_LOYALTY_DISC,
               (CASE WHEN DI.ITEM_TYPE=2 THEN DI.QTY*(-1) ELSE DI.QTY END)
              * DI.COST                                                         AS TOTAL_COST,
               (CASE WHEN DI.ITEM_TYPE=2 THEN DI.QTY*(-1) ELSE DI.QTY END)
              *(CASE WHEN DO.USE_VAT=1 THEN DI.ORIG_PRICE-NVL(DI.ORIG_TAX_AMT,0)
                     ELSE DI.ORIG_PRICE END)                                   AS TOTAL_ORIG_PRICE_WOTAX,
               (CASE WHEN DI.ITEM_TYPE=2 THEN DI.QTY*(-1) ELSE DI.QTY END)
              *((CASE WHEN DO.USE_VAT=1 THEN DI.DIP_PRICE-DI.DIP_TAX_AMT
                      ELSE DI.DIP_PRICE END)
               -NVL(DI.LTY_PIECE_OF_TBR_DISC_AMT,0))                         AS TOTAL_PRICE_WOTAX,
               (CASE WHEN DI.ITEM_TYPE=2 THEN DI.QTY*(-1) ELSE DI.QTY END)
              * DI.DIP_TAX_AMT                                                  AS TOTAL_TAX_AMT,
               (CASE WHEN DI.ITEM_TYPE=2 THEN DI.QTY*(-1) ELSE DI.QTY END)
              *((CASE WHEN DO.USE_VAT=1 THEN DI.DIP_PRICE
                      ELSE DI.DIP_PRICE+DI.DIP_TAX_AMT END)
               -NVL(DI.LTY_PIECE_OF_TBR_DISC_AMT,0))                         AS TOTAL_PRICE_WTAX
        FROM RPS.DOCUMENT_ITEM DI
        LEFT JOIN RPS.DOCUMENT DO ON DI.DOC_SID = DO.SID
        WHERE DI.CREATED_DATETIME IS NOT NULL
          AND DO.DOC_NO > 0
          AND DI.KIT_FLAG <> 5
          AND DO.STATUS = 4
          AND DI.ITEM_TYPE IN (1, 2)
          AND TRUNC(DO.INVC_POST_DATE) BETWEEN TO_DATE('{df}','YYYY-MM-DD')
                                           AND TO_DATE('{dt}','YYYY-MM-DD')
    """


def _sql_transfers(df, dt):
    """
    Transfer items from Oracle (SLIP + VOUCHER + VOU_ITEM).
    Columns map exactly to FACT_TRANSFERS column order (14 cols).
    """
    return f"""
        SELECT
            S.SID                     AS SLIP_SID,
            TO_CHAR(S.SLIP_NO)        AS SLIP_NO,
            TRUNC(S.CREATED_DATETIME) AS SLIP_DATE,
            VO.VOU_NO,
            NVL(VO.VOU_CLASS, 0)      AS VOU_CLASS,
            NVL(VO.STATUS, 3)         AS VOU_STATUS,
            S.OUT_STORE_SID,
            S.IN_STORE_SID,
            VI.ITEM_SID,
            SUM(NVL(CASE WHEN NVL(VO.VOU_TYPE,0)=0
                         THEN VI.ORIG_QTY ELSE VI.ORIG_QTY*-1 END, 0)) AS SENT_QTY,
            SUM(CASE WHEN NVL(VO.STATUS,3)=4
                     THEN NVL(CASE WHEN NVL(VO.VOU_TYPE,0)=0
                                   THEN VI.QTY ELSE VI.QTY*-1 END, 0)
                     ELSE 0 END)      AS RECV_QTY,
            MAX(NVL(VI.COST, 0))      AS UNIT_COST,
            SUM(NVL(CASE WHEN NVL(VO.VOU_TYPE,0)=0
                         THEN VI.ORIG_QTY ELSE VI.ORIG_QTY*-1 END, 0)
                * NVL(VI.COST, 0))    AS TOTAL_COST,
            SUM(NVL(CASE WHEN NVL(VO.VOU_TYPE,0)=0
                         THEN VI.ORIG_QTY ELSE VI.ORIG_QTY*-1 END, 0)
                * NVL(VI.PRICE, 0))   AS TOTAL_PRICE
        FROM RPS.SLIP S
        LEFT JOIN RPS.VOUCHER   VO ON VO.SID     = S.VOU_SID
        INNER JOIN RPS.VOU_ITEM VI ON VI.VOU_SID  = S.VOU_SID
        WHERE S.HELD = 0
          AND NVL(S.SLIP_NO, 0) <> 0
          AND NVL(S.REVERSED_FLAG, 0) = 0
          AND NVL(VO.SLIP_FLAG, 0) = 1
          AND TRUNC(S.CREATED_DATETIME) BETWEEN TO_DATE('{df}','YYYY-MM-DD')
                                             AND TO_DATE('{dt}','YYYY-MM-DD')
        GROUP BY
            S.SID, TO_CHAR(S.SLIP_NO), TRUNC(S.CREATED_DATETIME),
            VO.VOU_NO, NVL(VO.VOU_CLASS,0), NVL(VO.STATUS,3),
            S.OUT_STORE_SID, S.IN_STORE_SID, VI.ITEM_SID
    """


def _sql_adjustments(df, dt):
    """
    Quantity adjustments from Oracle (ADJUSTMENT + ADJ_ITEM).
    Columns map exactly to FACT_ADJUSTMENTS column order (12 cols).
    """
    return f"""
        SELECT
            A.SID                       AS ADJ_SID,
            TO_CHAR(A.ADJ_NO)           AS ADJ_NO,
            TRUNC(A.CREATED_DATETIME)   AS ADJ_DATE,
            A.STORE_SID,
            A.CREATEDBY_SID             AS EMPLOYEE_SID,
            NVL(A.CREATING_DOC_TYPE, 0) AS DOC_TYPE,
            AI.ITEM_SID,
            NVL(AI.ORIG_VALUE, 0)       AS ORIG_QTY,
            NVL(AI.ADJ_VALUE, 0)        AS ADJ_QTY,
            NVL(AI.ADJ_VALUE, 0) - NVL(AI.ORIG_VALUE, 0) AS QTY_DIFF,
            NVL(AI.COST, 0)             AS UNIT_COST,
            (NVL(AI.ADJ_VALUE, 0) - NVL(AI.ORIG_VALUE, 0)) * NVL(AI.COST, 0) AS COST_DIFF
        FROM RPS.ADJUSTMENT A
        INNER JOIN RPS.ADJ_ITEM AI ON AI.ADJ_SID = A.SID
        WHERE A.ADJ_TYPE = 0
          AND A.HELD = 0
          AND A.STATUS = 4
          AND NVL(A.ADJ_NO, 0) > 0
          AND TRUNC(A.CREATED_DATETIME) BETWEEN TO_DATE('{df}','YYYY-MM-DD')
                                             AND TO_DATE('{dt}','YYYY-MM-DD')
    """


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
    duck.execute("DELETE FROM FACT_INVENTORY")
    if rows:
        duck.executemany(
            "INSERT INTO FACT_INVENTORY VALUES (?,?,?,?,?,?)",
            [(r[0], r[1], r[2], r[3], r[4], now_str) for r in rows],
        )
    duck.commit()
    log.info(f"FACT_INVENTORY: {len(rows):,} rows loaded")


# ── Per-chunk fact sync ────────────────────────────────────────────────────────

def _sync_chunk(duck, df: str, dt: str, skip_existing: bool = False):
    ora = _get_oracle_conn()
    ins = "INSERT OR IGNORE INTO" if skip_existing else "INSERT INTO"
    try:
        # ── Daily ─────────────────────────────────────────────────────────────
        cur = ora.cursor()
        cur.execute(_sql_daily(df, dt))
        rows = cur.fetchall()
        cols = [d[0] for d in cur.description]
        cur.close()
        if not skip_existing:
            duck.execute(f"DELETE FROM FACT_SALES_DAILY WHERE POST_DATE::DATE BETWEEN '{df}' AND '{dt}'")
        if rows:
            duck.executemany(
                f"{ins} FACT_SALES_DAILY VALUES " + "(?"+",?"*12+")",
                [[r[cols.index(c)] if c in cols else None for c in
                  ["POST_DATE", "STORE_SID", "SUBSIDIARY_SID",
                   "SALES_COUNT", "RETURN_COUNT", "ORDER_COUNT",
                   "NET_SALES_WOTAX", "INVOICE_DISC", "TOTAL_TAX",
                   "TOTAL_DEPOSIT", "TOTAL_FEES", "SHIPPING_AMT", "TOTAL_WTAX"]]
                 for r in rows],
            )
        duck.commit()

        # ── Invoices ──────────────────────────────────────────────────────────
        cur = ora.cursor()
        cur.execute(_sql_invoices(df, dt))
        rows = cur.fetchall()
        cols = [d[0] for d in cur.description]
        cur.close()
        if not skip_existing:
            duck.execute(f"DELETE FROM FACT_SALES_INVOICES WHERE INVC_POST_DATE::DATE BETWEEN '{df}' AND '{dt}'")
        if rows:
            duck.executemany(
                f"{ins} FACT_SALES_INVOICES VALUES " + "(?"+",?"*24+")",
                [[r[cols.index(c)] if c in cols else None for c in
                  ["DOC_SID", "DOC_NO", "INVC_POST_DATE", "RECEIPT_TYPE",
                   "SUBSIDIARY_SID", "STORE_SID",
                   "EMPLOYEE1_SID", "CASHIER_SID", "BT_CUID",
                   "SOLD_QTY", "RETURN_QTY", "TOTAL_COGS",
                   "NET_SALES_WOTAX", "TOTAL_TAX", "INVOICE_DISC", "ITEM_DISC", "LOYALTY_DISC",
                   "TOTAL_DEPOSIT", "TOTAL_FEES", "SHIPPING_AMT", "TOTAL_WTAX",
                   "CASH_AMT", "CARD_AMT", "DEPOSIT_AMT", "OTHER_AMT"]]
                 for r in rows],
            )
        duck.commit()

        # ── Items ─────────────────────────────────────────────────────────────
        cur = ora.cursor()
        cur.execute(_sql_items(df, dt))
        rows = cur.fetchall()
        cols = [d[0] for d in cur.description]
        cur.close()
        if not skip_existing:
            duck.execute(f"DELETE FROM FACT_SALES_ITEMS WHERE INVC_POST_DATE::DATE BETWEEN '{df}' AND '{dt}'")
        if rows:
            duck.executemany(
                f"{ins} FACT_SALES_ITEMS VALUES " + "(?"+",?"*20+")",
                [[r[cols.index(c)] if c in cols else None for c in
                  ["DOC_ITEM_SID", "DOC_SID", "INVC_POST_DATE", "STORE_SID", "ITEM_SID", "ITEM_TYPE",
                   "QTY", "UNIT_COST", "UNIT_ORIG_PRICE_WOTAX", "UNIT_ORIG_PRICE_WTAX",
                   "UNIT_PRICE_WOTAX", "UNIT_TAX_AMT", "UNIT_PRICE_WTAX",
                   "UNIT_ITEM_DISC", "UNIT_RECEIPT_DISC", "UNIT_LOYALTY_DISC",
                   "TOTAL_COST", "TOTAL_ORIG_PRICE_WOTAX", "TOTAL_PRICE_WOTAX",
                   "TOTAL_TAX_AMT", "TOTAL_PRICE_WTAX"]]
                 for r in rows],
            )
        duck.commit()

        # ── Transfers ─────────────────────────────────────────────────────────
        cur = ora.cursor()
        cur.execute(_sql_transfers(df, dt))
        rows = cur.fetchall()
        cur.close()
        duck.execute(f"DELETE FROM FACT_TRANSFERS WHERE SLIP_DATE BETWEEN '{df}' AND '{dt}'")
        if rows:
            duck.executemany(
                "INSERT INTO FACT_TRANSFERS VALUES (" + ",".join(["?"] * 14) + ")",
                rows,
            )
        duck.commit()
        log.info(f"FACT_TRANSFERS chunk {df}→{dt}: {len(rows):,} rows")

        # ── Adjustments ───────────────────────────────────────────────────────
        cur = ora.cursor()
        cur.execute(_sql_adjustments(df, dt))
        rows = cur.fetchall()
        cur.close()
        duck.execute(f"DELETE FROM FACT_ADJUSTMENTS WHERE ADJ_DATE BETWEEN '{df}' AND '{dt}'")
        if rows:
            duck.executemany(
                "INSERT INTO FACT_ADJUSTMENTS VALUES (" + ",".join(["?"] * 12) + ")",
                rows,
            )
        duck.commit()
        log.info(f"FACT_ADJUSTMENTS chunk {df}→{dt}: {len(rows):,} rows")

        log.info(f"Chunk done: {df}→{dt}")
    finally:
        ora.close()


# ── Core sync ──────────────────────────────────────────────────────────────────

def _run_sync(mode: str, date_from: str, date_to: str,
              progress_cb=None, skip_existing: bool = False):
    _clear_cancel()
    duck   = get_db()
    chunks = list(_week_chunks(date.fromisoformat(date_from), date.fromisoformat(date_to)))
    total  = len(chunks)

    # Step 1 — dimensions (always full refresh)
    if progress_cb:
        progress_cb("Loading dimensions", 0, total + 1)
    ora_dim = _get_oracle_conn()
    try:
        _load_dimensions(duck, ora_dim)
    finally:
        ora_dim.close()

    # Step 2 — trim facts outside the requested date range (resume mode)
    if skip_existing:
        duck.execute(f"DELETE FROM FACT_SALES_DAILY    WHERE POST_DATE::DATE      < '{date_from}' OR POST_DATE::DATE      > '{date_to}'")
        duck.execute(f"DELETE FROM FACT_SALES_INVOICES WHERE INVC_POST_DATE::DATE < '{date_from}' OR INVC_POST_DATE::DATE > '{date_to}'")
        duck.execute(f"DELETE FROM FACT_SALES_ITEMS    WHERE INVC_POST_DATE::DATE < '{date_from}' OR INVC_POST_DATE::DATE > '{date_to}'")
        duck.execute(f"DELETE FROM FACT_TRANSFERS      WHERE SLIP_DATE < '{date_from}' OR SLIP_DATE > '{date_to}'")
        duck.execute(f"DELETE FROM FACT_ADJUSTMENTS    WHERE ADJ_DATE  < '{date_from}' OR ADJ_DATE  > '{date_to}'")
        duck.commit()

    # Step 3 — fact chunks
    for i, (cf, ct) in enumerate(chunks):
        if _cancel_requested:
            log.info("Sync cancelled")
            raise SyncCancelled("Cancelled by user")
        if progress_cb:
            progress_cb(f"Week {cf}", i + 1, total + 1)
        log.info(f"Chunk {i+1}/{total}: {cf}→{ct}")
        _sync_chunk(duck, cf, ct, skip_existing=skip_existing)

    # Step 3 — large dims filtered to the sync date range
    if progress_cb:
        progress_cb("Loading customers & items", total + 1, total + 3)
    ora_large = _get_oracle_conn()
    try:
        _load_large_dims(duck, ora_large, date_from, date_to)
    finally:
        ora_large.close()

    # Step 4 — inventory on-hand snapshot (current state, not date-filtered)
    if progress_cb:
        progress_cb("Loading inventory snapshot", total + 2, total + 3)
    ora_inv = _get_oracle_conn()
    try:
        _sync_inventory_snapshot(duck, ora_inv)
    except Exception as e:
        log.warning(f"Inventory snapshot skipped: {e}")
    finally:
        ora_inv.close()

    if progress_cb:
        progress_cb("Done", total + 3, total + 3)

    s = json.loads(SETTINGS_FILE.read_text())
    s["last_sync"]    = datetime.now().isoformat()
    s["model_status"] = "ready"
    SETTINGS_FILE.write_text(json.dumps(s, indent=2, default=str))
    log.info(f"Sync [{mode}] complete — {date_from}→{date_to}")


# ── Public API ─────────────────────────────────────────────────────────────────

def _date_range(days: int):
    dt = datetime.now().date()
    return str(dt - timedelta(days=days - 1)), str(dt)


async def full_load(days: int = 365, progress_cb=None):
    """Resumable full load — dims refreshed, facts INSERT OR IGNORE on SID."""
    df, dt = _date_range(days)
    log.info(f"Full load: {df}→{dt}")
    await asyncio.get_event_loop().run_in_executor(
        _executor, _run_sync, "full", df, dt, progress_cb, True)


async def incremental(days: int = 7, progress_cb=None):
    """Incremental — dims refreshed, facts DELETE+INSERT for the window."""
    df, dt = _date_range(days)
    log.info(f"Incremental: {df}→{dt}")
    await asyncio.get_event_loop().run_in_executor(
        _executor, _run_sync, "incremental", df, dt, progress_cb, False)
