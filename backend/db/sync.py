"""
Oracle → DuckDB incremental sync
"""
import asyncio
import json
import logging
import oracledb
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from datetime import date, datetime, timedelta
from pathlib import Path

from db.model import (get_db, DB_LOCK, SETTINGS_FILE, ACCOUNTING_SBS_NO,
                      set_feature_available,
                      FEATURE_INVENTORY_HISTORY, FEATURE_ACCOUNTING)

log = logging.getLogger(__name__)


# ── Optional Retail Pro customisations ────────────────────────────────────────
# Two things RetailTec reads are NOT part of stock Retail Pro Prism and are
# absent on some installations:
#   (a) RPS.INVENTORY_HISTORY — the INVN_BACKUP_TRG qty-change log.
#   (b) subsidiary 100        — the virtual GL of the accounting customisation.
# Their absence is a configuration fact, not a failure: skip the load, record it
# in FEATURE_AVAILABILITY, carry on. Everything else must still fail loudly.

# Oracle codes that mean "that object is not here (for us)". ORA-00942 is the
# straight missing table/view; ORA-01031 is the same thing seen through a
# missing GRANT, which is indistinguishable from absence at this layer.
# Deliberately NOT included: ORA-00904 (invalid identifier) — a wrong column
# name is our bug and must surface, not be silently swallowed.
_ORA_MISSING_OBJECT = ("ORA-00942", "ORA-01031")


def _is_missing_object(exc: BaseException) -> bool:
    s = str(exc)
    return any(code in s for code in _ORA_MISSING_OBJECT)


@contextmanager
def _try_optional(duck, feature: str, label: str):
    """Run a block that depends on an OPTIONAL customisation.

    Swallows ONLY the missing-object case, logs one warning and records the
    feature as unavailable. Every other exception propagates untouched — a real
    error (bad SQL, dropped connection, DuckDB failure) must still fail the sync.
    Note the caller records SUCCESS itself: "the query ran" is not always the
    same as "the feature is there" (sbs 100 absent yields zero rows, no error),
    so each caller decides what available=True means for it."""
    try:
        yield
    except SyncCancelled:
        raise
    except Exception as e:
        if not _is_missing_object(e):
            raise
        log.warning(f"{label} not available on this server — skipping")
        set_feature_available(duck, feature, False, str(e).strip()[:400])


def _probe_accounting_subsidiary(ora) -> bool:
    """True when subsidiary 100 (the virtual GL) exists on this server.

    _sql_gl() and _sql_accounts() do not RAISE without it — sbs 100 simply
    matches nothing and the nested scalar subqueries in _sql_accounts() return
    NULL, making `I.SBS_SID = NULL` unknown for every row (zero rows, no error).
    That silent emptiness is exactly what we must not present as "no data in
    this period", hence this explicit probe."""
    cur = ora.cursor()
    try:
        cur.execute(
            f"SELECT COUNT(*) FROM RPS.SUBSIDIARY WHERE SBS_NO = {ACCOUNTING_SBS_NO}")
        row = cur.fetchone()
        return bool(row and row[0])
    finally:
        cur.close()


# ── Excluding the synthetic accounting subsidiary from every normal extract ────
# ACCOUNTING_SBS_NO (db/model.py) is Retail Pro subsidiary 100, the virtual
# general ledger. It is not a trading entity, so it must be filtered out of
# EVERY query below. The two deliberate exceptions are _sql_gl() and
# _sql_accounts(), which read SBS_NO = 100 because that IS the accounting data.
#
# Which predicate to use depends on what the source table actually carries
# (verified against ALL_TAB_COLUMNS on the RP9 schema):
#   * SBS_NO   — RPS.DOCUMENT, RPS.DOCUMENT_ITEM            -> _no_acct_sbs_no()
#   * SBS_SID  — RPS.STORE, DCS, VENDOR, EMPLOYEE, CUSTOMER,
#                INVN_SBS_ITEM, INVN_SBS_ITEM_QTY, VOUCHER,
#                ADJUSTMENT, INVENTORY_HISTORY               -> _no_acct_sbs_sid()
#   * OUT_SBS_SID / IN_SBS_SID — RPS.SLIP (both sides)       -> _no_acct_sbs_sid()
#   * nothing  — SLIP_ITEM, ADJ_ITEM, VOU_ITEM, TENDER: these are line tables
#                with no subsidiary column, so they are excluded through their
#                parent header join instead.

_ACCT_SBS_SID_SQL = f"SELECT SID FROM RPS.SUBSIDIARY WHERE SBS_NO = {ACCOUNTING_SBS_NO}"


def _no_acct_sbs_sid(col: str) -> str:
    """Predicate excluding the accounting subsidiary via an *_SBS_SID column.

    NOT IN over a subquery is deliberate: on an install with no accounting
    customisation the subquery returns no rows and the predicate is TRUE for
    everything (a plain `<> (SELECT ...)` would evaluate to NULL and silently
    drop EVERY row). RPS.SUBSIDIARY.SID is a primary key so the subquery can
    never contain a NULL; the IS NULL arm covers a null-valued source column."""
    return f"({col} IS NULL OR {col} NOT IN ({_ACCT_SBS_SID_SQL}))"


def _no_acct_sbs_no(col: str) -> str:
    """Predicate excluding the accounting subsidiary via an SBS_NO column."""
    return f"NVL({col}, 0) <> {ACCOUNTING_SBS_NO}"


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


def _tstz_as_naive(cursor, metadata):
    """Fetch TIMESTAMP WITH TIME ZONE as plain TIMESTAMP — the warehouse stores
    naive local datetimes, and TSTZ conversion in the client is far slower."""
    if metadata.type_code is oracledb.DB_TYPE_TIMESTAMP_TZ:
        return cursor.var(oracledb.DB_TYPE_TIMESTAMP, arraysize=cursor.arraysize)


def _get_oracle_conn():
    from services.config import load_settings
    s = load_settings()   # decrypts the DPAPI-protected password in memory
    c = s.get("connection", {})
    host     = c.get("host", "localhost")
    port     = c.get("port", 1521)
    sid      = c.get("sid", "")
    user     = c.get("username", "")
    password = c.get("password", "")
    # Use Easy Connect string — same format as test-connection endpoint
    dsn = f"{host}:{port}/{sid}"
    conn = oracledb.connect(user=user, password=password, dsn=dsn)
    conn.outputtypehandler = _tstz_as_naive
    return conn


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
          AND {_no_acct_sbs_no('H.SBS_NO')}
        GROUP BY TRUNC(H.POST_DATE), H.STORE_SID, H.SUBSIDIARY_SID
    """


# ── Index vs full-scan strategy ───────────────────────────────────────────────
# The RPS function-based date indexes are a huge win for NARROW windows
# (incrementals, small ranges: 0.1s index range scans). But for WIDE windows
# (historical backfills) an index plan means hundreds of thousands of scattered
# ROWID lookups over the WAN — much slower than ONE sequential full scan.
# Oracle's optimizer can't always tell (FBI stats), so we decide explicitly:
_INDEX_WINDOW_DAYS = 21

def _use_index(df, dt) -> bool:
    try:
        a = date.fromisoformat(str(df)[:10])
        b = date.fromisoformat(str(dt)[:10])
        return (b - a).days <= _INDEX_WINDOW_DAYS
    except Exception:
        return True


def _doc_hint(df, dt) -> str:
    return "/*+ INDEX(H IDX_DOCUMENT7) */" if _use_index(df, dt) else "/*+ FULL(H) */"


def _sql_invoices(df, dt):
    # Column semantics verified against the production Krunch reports
    # ('Krunch Queries feb 2024/Sales Invoices Details.sql'):
    #   * return money lives in RETURN_SUBTOTAL_WITH_TAX / RETURN_TOTAL_TAX_AMT
    #     (SALE_* is zero on RECEIPT_TYPE=1 docs — returns showed 0.00 before)
    #   * NET_SALES_WOTAX / TOTAL_TAX are SIGNED (negative for return docs)
    #   * item-level discount = SUM(DOCUMENT_ITEM.DISC_AMT) signed, kit_flag<>5
    #   * loyalty discount = LTY_SALE_TOTAL_BASED_DISC; deposit = TOTAL_DEPOSIT_TAKEN
    #   * payments come from RPS.TENDER by tender_type (0 cash / 2,11 card /
    #     7 deposit / rest other) — they were hardcoded to 0 before
    return f"""
        SELECT {_doc_hint(df, dt)}
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
            (NVL(H.SALE_SUBTOTAL_WITH_TAX,0) - NVL(H.SALE_TOTAL_TAX_AMT,0))
              - (NVL(H.RETURN_SUBTOTAL_WITH_TAX,0) - NVL(H.RETURN_TOTAL_TAX_AMT,0))
                                            AS NET_SALES_WOTAX,
            NVL(H.SALE_TOTAL_TAX_AMT,0) - NVL(H.RETURN_TOTAL_TAX_AMT,0)
                                            AS TOTAL_TAX,
            NVL(H.DISC_AMT, 0)             AS INVOICE_DISC,
            NVL(IDISC.DISC_AMT, 0)         AS ITEM_DISC,
            NVL(H.LTY_SALE_TOTAL_BASED_DISC, 0) AS LOYALTY_DISC,
            NVL(H.TOTAL_DEPOSIT_TAKEN, 0)  AS TOTAL_DEPOSIT,
            NVL(H.TOTAL_FEE_AMT, 0)        AS TOTAL_FEES,
            NVL(H.SHIPPING_AMT, 0)         AS SHIPPING_AMT,
            (NVL(H.SALE_SUBTOTAL_WITH_TAX,0) - NVL(H.RETURN_SUBTOTAL_WITH_TAX,0))
              + NVL(H.TOTAL_DEPOSIT_TAKEN,0) + NVL(H.TOTAL_FEE_AMT,0)
              + NVL(H.SHIPPING_AMT,0)      AS TOTAL_WTAX,
            NVL(TCASH.AMT, 0)              AS CASH_AMT,
            NVL(TCARD.AMT, 0)              AS CARD_AMT,
            NVL(TDEP.AMT, 0)               AS DEPOSIT_AMT,
            NVL(TOTH.AMT, 0)               AS OTHER_AMT
        FROM RPS.DOCUMENT H
        LEFT JOIN (
            SELECT DOC_SID,
                   SUM(CASE WHEN ITEM_TYPE = 2 THEN DISC_AMT * -1 ELSE DISC_AMT END) AS DISC_AMT
            FROM RPS.DOCUMENT_ITEM
            WHERE ITEM_TYPE IN (1, 2) AND KIT_FLAG <> 5
              AND {_no_acct_sbs_no('SBS_NO')}
            GROUP BY DOC_SID
        ) IDISC ON IDISC.DOC_SID = H.SID
        LEFT JOIN (SELECT DOC_SID, SUM(AMOUNT) AS AMT FROM RPS.TENDER
                   WHERE TENDER_TYPE = 0 GROUP BY DOC_SID) TCASH ON TCASH.DOC_SID = H.SID
        LEFT JOIN (SELECT DOC_SID, SUM(AMOUNT) AS AMT FROM RPS.TENDER
                   WHERE TENDER_TYPE IN (2, 11) GROUP BY DOC_SID) TCARD ON TCARD.DOC_SID = H.SID
        LEFT JOIN (SELECT DOC_SID, SUM(AMOUNT) AS AMT FROM RPS.TENDER
                   WHERE TENDER_TYPE = 7 GROUP BY DOC_SID) TDEP ON TDEP.DOC_SID = H.SID
        LEFT JOIN (SELECT DOC_SID, SUM(AMOUNT) AS AMT FROM RPS.TENDER
                   WHERE TENDER_TYPE NOT IN (0, 2, 11, 7) GROUP BY DOC_SID) TOTH ON TOTH.DOC_SID = H.SID
        WHERE CAST(H.INVC_POST_DATE AS DATE) >= TO_DATE('{df}','YYYY-MM-DD')
          AND CAST(H.INVC_POST_DATE AS DATE) <  TO_DATE('{dt}','YYYY-MM-DD') + 1
          AND H.STATUS = 4
          AND H.RECEIPT_TYPE IN (0, 1, 2)
          AND {_no_acct_sbs_no('H.SBS_NO')}
    """
    # CAST(INVC_POST_DATE AS DATE) matches function-based index IDX_DOCUMENT7 →
    # INDEX RANGE SCAN instead of a 2.4M-row full scan (121s → 0.1s, verified).
    # INVC_POST_DATE is also the designed watermark column (DB_SYNC_REDESIGN §3).


def _sql_items(df, dt):
    # RPS.DOCUMENT_ITEM replaces RPS.LINE in RP9 Cloud; join via DOC_SID
    # Unit prices derived from PRICE/TAX_AMT; totals = unit * QTY
    return f"""
        SELECT {_doc_hint(df, dt)}
            DI.SID                                              AS DOC_ITEM_SID,
            DI.DOC_SID,
            H.INVC_POST_DATE                                    AS INVC_POST_DATE,
            H.SUBSIDIARY_SID                                    AS SUBSIDIARY_SID,
            H.STORE_SID,
            DI.INVN_SBS_ITEM_SID                               AS ITEM_SID,
            CASE DI.ITEM_TYPE WHEN 1 THEN 'Sale' WHEN 2 THEN 'Return'
                 ELSE TO_CHAR(DI.ITEM_TYPE) END                AS ITEM_TYPE,
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
        WHERE CAST(H.INVC_POST_DATE AS DATE) >= TO_DATE('{df}','YYYY-MM-DD')
          AND CAST(H.INVC_POST_DATE AS DATE) <  TO_DATE('{dt}','YYYY-MM-DD') + 1
          AND H.STATUS = 4
          AND H.RECEIPT_TYPE IN (0, 1, 2)
          AND DI.ITEM_TYPE IN (1, 2)
          AND {_no_acct_sbs_no('H.SBS_NO')}
          AND {_no_acct_sbs_no('DI.SBS_NO')}
    """
    # Index-backed predicate (IDX_DOCUMENT7) + true INVC_POST_DATE stored —
    # keeps items consistent with the invoices table and the coverage view.
    #
    # 22 columns, matching FACT_SALES_ITEMS exactly — _stream_insert maps
    # POSITIONALLY, so the ncols argument at the call site must say 22.
    # SUBSIDIARY_SID (ordinal 4) comes from the PARENT DOCUMENT: DOCUMENT_ITEM
    # carries only SBS_NO, never the SID.


def _sql_transfers(df, dt):
    # RP9 Cloud: SLIP.SID is PK (not SLIP_SID); POST_DATE replaces SLIP_DATE
    # SLIP has no VOU_NO, but SLIP.VOU_SID links the receiving voucher -> VOUCHER.VOU_NO
    # SLIP_ITEM: QTY replaces SENT_QTY/RECV_QTY; COST/PRICE replace UNIT_COST/TOTAL_COST/TOTAL_PRICE
    hint = "/*+ INDEX(S IDX_CREATEDDATE_SLIP) */" if _use_index(df, dt) else "/*+ FULL(S) */"
    return f"""
        SELECT {hint}
            SI.SID                            AS TRANSFER_ITEM_SID,
            S.SID                             AS SLIP_SID,
            S.SLIP_NO,
            S.POST_DATE                       AS SLIP_DATE,
            RV.VOU_NO                         AS VOU_NO,
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
        LEFT JOIN RPS.VOUCHER RV ON RV.SID = S.VOU_SID
        WHERE SYS_EXTRACT_UTC(S.CREATED_DATETIME) >= CAST(TO_DATE('{df}','YYYY-MM-DD') - 1 AS TIMESTAMP)
          AND SYS_EXTRACT_UTC(S.CREATED_DATETIME) <  CAST(TO_DATE('{dt}','YYYY-MM-DD') + 2 AS TIMESTAMP)
          AND S.CREATED_DATETIME >= TO_DATE('{df}','YYYY-MM-DD')
          AND S.CREATED_DATETIME <  TO_DATE('{dt}','YYYY-MM-DD') + 1
          AND {_no_acct_sbs_sid('S.OUT_SBS_SID')}
          AND {_no_acct_sbs_sid('S.IN_SBS_SID')}
    """
    # SYS_EXTRACT_UTC(CREATED_DATETIME) matches IDX_CREATEDDATE_SLIP → index range
    # scan (±1 day widened for timezone skew); the plain CREATED_DATETIME predicate
    # then filters exactly. CREATED_DATETIME is the designed transfer watermark.


def _sql_adjustments(df, dt):
    # RPS.ADJ_ITEM replaces RPS.ADJUSTMENT_ITEM in RP9 Cloud
    # ADJ_DATE->POST_DATE, EMPLOYEE_SID->CLERK_SID, DOC_TYPE->ADJ_TYPE
    # ORIG_QTY->ORIG_VALUE, ADJ_QTY->ADJ_VALUE, UNIT_COST->COST
    hint = "/*+ INDEX(A IDXADJUSTMENT) */" if _use_index(df, dt) else "/*+ FULL(A) */"
    # STORE_SID is NULL on ~85% of ADJUSTMENT headers (system-generated docs).
    # Fall back to the creating controller's store (RPS.CONTROLLER.STORE_SID) —
    # verified to resolve 5,464/5,464 null-store adjustments — then ORIG_STORE_SID.
    return f"""
        SELECT {hint}
            AI.SID                     AS ADJ_ITEM_SID,
            A.SID                      AS ADJ_SID,
            A.ADJ_NO,
            CAST(A.POST_DATE AS DATE)  AS ADJ_DATE,
            COALESCE(A.STORE_SID, C.STORE_SID, A.ORIG_STORE_SID) AS STORE_SID,
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
        LEFT JOIN RPS.CONTROLLER C ON C.SID = A.CONTROLLER_SID
        WHERE SYS_EXTRACT_UTC(A.CREATED_DATETIME) >= CAST(TO_DATE('{df}','YYYY-MM-DD') - 1 AS TIMESTAMP)
          AND SYS_EXTRACT_UTC(A.CREATED_DATETIME) <  CAST(TO_DATE('{dt}','YYYY-MM-DD') + 2 AS TIMESTAMP)
          AND A.CREATED_DATETIME >= TO_DATE('{df}','YYYY-MM-DD')
          AND A.CREATED_DATETIME <  TO_DATE('{dt}','YYYY-MM-DD') + 1
          AND {_no_acct_sbs_sid('A.SBS_SID')}
    """
    # SYS_EXTRACT_UTC(CREATED_DATETIME) matches IDXADJUSTMENT → index range scan.
    # CREATED_DATETIME is the designed adjustments watermark (DB_SYNC_REDESIGN §3).


def _sql_purchases(df, dt):
    # RP9 Cloud: VOUCHER has no EMPLOYEE_SID (use CLERK_SID), no LINE_COUNT/ORD_QTY/RECV_QTY
    hint = "/*+ INDEX(V IDX_CREATEDDATE_VOU) */" if _use_index(df, dt) else "/*+ FULL(V) */"
    return f"""
        SELECT {hint}
            V.SID                              AS VOU_SID,
            V.VOU_NO,
            CAST(V.CREATED_DATETIME AS DATE)   AS VOU_DATE,
            NVL(V.STATUS, 3)                   AS STATUS,
            V.SBS_SID                          AS SUBSIDIARY_SID,
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
          AND SYS_EXTRACT_UTC(V.CREATED_DATETIME) >= CAST(TO_DATE('{df}','YYYY-MM-DD') - 1 AS TIMESTAMP)
          AND SYS_EXTRACT_UTC(V.CREATED_DATETIME) <  CAST(TO_DATE('{dt}','YYYY-MM-DD') + 2 AS TIMESTAMP)
          AND V.CREATED_DATETIME >= TO_DATE('{df}','YYYY-MM-DD')
          AND V.CREATED_DATETIME <  TO_DATE('{dt}','YYYY-MM-DD') + 1
          AND {_no_acct_sbs_sid('V.SBS_SID')}
    """
    # Redundant SYS_EXTRACT_UTC predicate matches IDX_CREATEDDATE_VOU → index range
    # scan; the plain predicate keeps the exact same rows (verified 63 == 63).
    #
    # 14 columns, matching FACT_PURCHASES exactly (ncols=14 at the call site).
    # SUBSIDIARY_SID (ordinal 5) is RPS.VOUCHER.SBS_SID — the voucher's own
    # subsidiary, not a store-derived guess.


def _sql_purchase_items(df, dt):
    hint = "/*+ INDEX(V IDX_CREATEDDATE_VOU) */" if _use_index(df, dt) else "/*+ FULL(V) */"
    return f"""
        SELECT {hint}
            VI.SID                             AS VOU_ITEM_SID,
            VI.VOU_SID,
            CAST(V.CREATED_DATETIME AS DATE)   AS VOU_DATE,
            V.SBS_SID                          AS SUBSIDIARY_SID,
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
          AND SYS_EXTRACT_UTC(V.CREATED_DATETIME) >= CAST(TO_DATE('{df}','YYYY-MM-DD') - 1 AS TIMESTAMP)
          AND SYS_EXTRACT_UTC(V.CREATED_DATETIME) <  CAST(TO_DATE('{dt}','YYYY-MM-DD') + 2 AS TIMESTAMP)
          AND V.CREATED_DATETIME >= TO_DATE('{df}','YYYY-MM-DD')
          AND V.CREATED_DATETIME <  TO_DATE('{dt}','YYYY-MM-DD') + 1
          AND {_no_acct_sbs_sid('V.SBS_SID')}
    """
    # 14 columns, matching FACT_PURCHASE_ITEMS exactly (ncols=14 at the call
    # site). VOU_ITEM has no subsidiary of its own, so SUBSIDIARY_SID (ordinal 4)
    # is taken from the parent VOUCHER — the same row the date and store come from.


def _sql_inventory_history(df, dt):
    """Qty change rows from INVENTORY_HISTORY trigger log, filtered by ACTION_DATE."""
    hint = "/*+ INDEX(H IDX_INV_HIST_DATE) */" if _use_index(df, dt) else "/*+ FULL(H) */"
    return f"""
        SELECT {hint}
            H.HISTORY_SID,
            H.ACTION_TYPE,
            CAST(H.ACTION_DATE AS DATE)  AS ACTION_DATE,
            H.STORE_SID,
            H.INVN_SBS_ITEM_SID          AS ITEM_SID,
            NVL(H.QTY, 0)               AS QTY,
            NVL(H.COST, 0)              AS COST,
            H.SBS_SID
        FROM RPS.INVENTORY_HISTORY H
        WHERE SYS_EXTRACT_UTC(H.ACTION_DATE) >= CAST(TO_DATE('{df}','YYYY-MM-DD') - 1 AS TIMESTAMP)
          AND SYS_EXTRACT_UTC(H.ACTION_DATE) <  CAST(TO_DATE('{dt}','YYYY-MM-DD') + 2 AS TIMESTAMP)
          AND H.ACTION_DATE >= TO_DATE('{df}','YYYY-MM-DD')
          AND H.ACTION_DATE <  TO_DATE('{dt}','YYYY-MM-DD') + 1
          AND {_no_acct_sbs_sid('H.SBS_SID')}
    """
    # Redundant SYS_EXTRACT_UTC predicate matches IDX_INV_HIST_DATE → index range
    # scan; plain predicate keeps exact rows (verified 30,901 == 30,901).


def _sql_inventory_qty_window(df, dt):
    """Items created or modified in this window for upsert into FACT_INVENTORY."""
    return f"""
        SELECT
            IQ.INVN_SBS_ITEM_SID   AS ITEM_SID,
            IQ.STORE_SID,
            IQ.SBS_SID            AS SUBSIDIARY_SID,
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
        WHERE {_no_acct_sbs_sid('IQ.SBS_SID')}
          AND ((IQ.CREATED_DATETIME  >= TO_DATE('{df}','YYYY-MM-DD') AND IQ.CREATED_DATETIME  < TO_DATE('{dt}','YYYY-MM-DD') + 1)
            OR (IQ.MODIFIED_DATETIME >= TO_DATE('{df}','YYYY-MM-DD') AND IQ.MODIFIED_DATETIME < TO_DATE('{dt}','YYYY-MM-DD') + 1))
    """


# ── Dimension loaders ─────────────────────────────────────────────────────────

def _replace_small_dim(duck, table: str, insert_sql: str, rows) -> None:
    """DELETE + re-INSERT a small dimension ATOMICALLY.

    The old unguarded DELETE-then-executemany autocommitted the DELETE first:
    if the insert failed (Oracle row surprise, type error) or the process died,
    the dim stayed EMPTY until the next successful dims load — the app opened
    with no stores/items/products (seen 13 Jul 2026; the earlier 'DIM_STORE
    emptied by sync' bug was the same class). A transaction closes the window;
    readers also never see the half-loaded state anymore.

    ZERO-ROW GUARD: if Oracle returns no rows (transient connection blip, query
    error surfacing as an empty result), do NOT wipe the table — keep whatever
    is already loaded. Without this the transaction still committed an empty
    DELETE and the dimension vanished (stores/vendors/employees empty on open)."""
    if not rows:
        log.warning(f"{table}: source returned 0 rows — keeping existing data (no wipe)")
        return
    duck.execute("BEGIN TRANSACTION")
    try:
        duck.execute(f"DELETE FROM {table}")
        duck.executemany(insert_sql, rows)
        duck.execute("COMMIT")
    except BaseException:
        try:
            duck.execute("ROLLBACK")
        except Exception:
            pass
        raise
    log.info(f"{table}: {len(rows)} rows")


def _load_dimensions(duck, ora, progress_cb=None):
    def _r(name):
        if progress_cb:
            progress_cb(f"Loading dimension: {name}", 3, 100)
    cur = ora.cursor()

    _r("Stores")
    cur.execute(f"SELECT SID, STORE_CODE, STORE_NAME FROM RPS.STORE "
                f"WHERE {_no_acct_sbs_sid('SBS_SID')}")
    # Explicit columns: DIM_STORE also has SUBSIDIARY_SID (added for the
    # multi-subsidiary feature and populated by the schema migration from the
    # sales facts), so a positional 3-value insert would fail on the 4-col table.
    _replace_small_dim(duck, "DIM_STORE",
        "INSERT OR REPLACE INTO DIM_STORE (SID, STORE_CODE, STORE_NAME) VALUES (?,?,?)",
        cur.fetchall())

    _r("Subsidiaries")
    # sbs 100 is the virtual GL, not a trading entity: keeping it out of
    # DIM_SUBSIDIARY is what removes "Accounting" from the subsidiary selector
    # AND stops it consuming a licensed subsidiary slot (the licence check
    # counts rows in this table).
    cur.execute(f"SELECT SID, SBS_NO, SBS_NAME FROM RPS.SUBSIDIARY "
                f"WHERE {_no_acct_sbs_no('SBS_NO')}")
    _replace_small_dim(duck, "DIM_SUBSIDIARY",
        "INSERT OR REPLACE INTO DIM_SUBSIDIARY VALUES (?,?,?)", cur.fetchall())

    _r("Employees")
    cur.execute(f"SELECT SID, NVL(TRIM(FULL_NAME), TRIM(EMPL_NAME)) FROM RPS.EMPLOYEE "
                f"WHERE {_no_acct_sbs_sid('SBS_SID')}")
    _replace_small_dim(duck, "DIM_EMPLOYEE",
        "INSERT OR REPLACE INTO DIM_EMPLOYEE VALUES (?,?)", cur.fetchall())

    # RPS.DCS columns are D_NAME, C_NAME, S_NAME (confirmed via schema inspection)
    _r("Departments (DCS)")
    # Excluding sbs 100 here is what keeps its DCS_CODE='ACCOUNT' department
    # (the chart-of-accounts container) out of every department/DCS slicer.
    cur.execute(f"""
        SELECT SID, SBS_SID, DCS_CODE,
               D_NAME, C_NAME, S_NAME
        FROM RPS.DCS
        WHERE {_no_acct_sbs_sid('SBS_SID')}
    """)
    _replace_small_dim(duck, "DIM_DCS",
        "INSERT OR REPLACE INTO DIM_DCS VALUES (?,?,?,?,?,?)", cur.fetchall())

    # ALL vendors, including inactive: filtering ACTIVE=1 dropped historical
    # vendors and dumped their sales into '(Unknown)' (Krunch loads all vendors)
    _r("Vendors")
    cur.execute(f"""
        SELECT SID, SBS_SID, VEND_CODE, VEND_NAME
        FROM RPS.VENDOR
        WHERE {_no_acct_sbs_sid('SBS_SID')}
    """)
    _replace_small_dim(duck, "DIM_VENDOR",
        "INSERT OR REPLACE INTO DIM_VENDOR VALUES (?,?,?,?)", cur.fetchall())

    cur.close()


def _bulk_upsert_dim(duck, table: str, pk: str, rows, full_refresh: bool = False) -> int:
    """Rebuild-style dim load: clone schema -> bulk INSERT -> swap tables.

    NEVER row-DELETEs through the ART PK index — that's the recurring
    'Failed to delete all rows from index' FATAL that invalidates the whole DB
    (struck again on DELETE FROM DIM_ITEM during the 2020-2026 backfill).
    DROP TABLE removes the index wholesale, which is safe (HANDOFF §5 pattern).
    The rebuilt table is PK-less by design (DB_SYNC_REDESIGN §5 — dedup is
    set-based, analytics never needs the ART index)."""
    import pandas as pd
    if not rows:
        return 0
    cols = [r[1] for r in duck.execute(f"PRAGMA table_info('{table}')").fetchall()]
    # dtype=object: prevent float64 inference on nullable BIGINT SID columns
    # (precision loss above 2^53 corrupted DIM_ITEM.VEND_SID — see _stream_insert)
    stage_df = pd.DataFrame(rows, columns=cols, dtype=object)
    tmp = f"{table}__rebuild"
    duck.register("_dim_stage", stage_df)
    # ATOMIC rebuild: the whole build + DROP + RENAME runs in ONE transaction.
    # The old two-statement "DROP {table}; ALTER {tmp} RENAME" auto-committed the
    # DROP first — if anything interrupted before the RENAME (an error, or the
    # shared connection being reset mid-sync), DIM_ITEM stayed DROPPED and all
    # products/items vanished until a full dimension reload rebuilt it (reported
    # 13 Jul 2026). Inside a transaction, readers keep seeing the old table until
    # COMMIT, and any failure ROLLs back to the original table — never empty.
    duck.execute("BEGIN TRANSACTION")
    try:
        duck.execute(f"DROP TABLE IF EXISTS {tmp}")
        # clone schema (types) without rows — new table has no PK/ART index
        duck.execute(f"CREATE TABLE {tmp} AS SELECT * FROM {table} WHERE 1=0")
        duck.execute(f"INSERT INTO {tmp} SELECT * FROM _dim_stage")
        if not full_refresh:
            duck.execute(f"""
                INSERT INTO {tmp}
                SELECT t.* FROM {table} t
                WHERE t.{pk} NOT IN (SELECT s.{pk} FROM _dim_stage s)
            """)
        duck.execute(f"DROP TABLE {table}")
        duck.execute(f"ALTER TABLE {tmp} RENAME TO {table}")
        duck.execute("COMMIT")
    except BaseException:
        try:
            duck.execute("ROLLBACK")
        except Exception:
            pass
        raise
    finally:
        duck.unregister("_dim_stage")
    return len(rows)


def _load_large_dims(duck, ora, df, dt, progress_cb=None):
    def _r(name):
        if progress_cb:
            progress_cb(f"Loading dimension: {name}", 91, 100)
    cur = ora.cursor()

    _r("Customers")
    # Phone from RPS.CUSTOMER_PHONE: primary number first, else lowest SEQ_NO.
    # CUST_ID (2026-07-20) is the human-facing customer number the owner knows;
    # RPS.CUSTOMER.SID is only the internal 18-digit key. CUST_ID is NOT unique
    # and is NULL on ~60 customers, so it is carried as a plain attribute.
    # LEFT JOIN (not INNER): the document-derived customer list is authoritative
    # here — a BT_CUID with no RPS.CUSTOMER row must still survive with NULLs
    # rather than silently vanish from the dimension.
    # Column order MUST match DIM_CUSTOMER's DDL — _bulk_upsert_dim is positional.
    cur.execute(f"""
        SELECT DISTINCT {_doc_hint(df, dt)} H.BT_CUID AS SID,
               C.CUST_ID AS CUST_ID,
               TRIM(NVL(C.FIRST_NAME,'')||' '||NVL(C.LAST_NAME,'')) AS FULL_NAME,
               CP.PHONE_NO AS PHONE
        FROM RPS.DOCUMENT H
        LEFT JOIN RPS.CUSTOMER C ON C.SID = H.BT_CUID
        LEFT JOIN (
            SELECT CUST_SID, PHONE_NO,
                   ROW_NUMBER() OVER (
                       PARTITION BY CUST_SID
                       ORDER BY NVL(PRIMARY_FLAG,0) DESC, NVL(SEQ_NO,999), SID
                   ) AS RN
            FROM RPS.CUSTOMER_PHONE
        ) CP ON CP.CUST_SID = C.SID AND CP.RN = 1
        WHERE CAST(H.INVC_POST_DATE AS DATE) >= TO_DATE('{df}','YYYY-MM-DD')
          AND CAST(H.INVC_POST_DATE AS DATE) <  TO_DATE('{dt}','YYYY-MM-DD') + 1
          AND H.BT_CUID IS NOT NULL
          AND H.STATUS = 4
          AND {_no_acct_sbs_no('H.SBS_NO')}
    """)
    n = _bulk_upsert_dim(duck, "DIM_CUSTOMER", "SID", cur.fetchall())
    log.info(f"DIM_CUSTOMER: {n} rows")

    # FULL refresh of DIM_ITEM (DB_SYNC_REDESIGN §6): windowed loading left items
    # referenced by facts but not touched in the window missing -> '(unknown item)'
    # in product analytics. The whole table is small enough to pull every sync.
    _r("Items")
    # Item vendor resolution (semantics confirmed with schema owner 2026-07-03):
    #   * PRIMARY: INVN_SBS_ITEM.VEND_SID -> RPS.VENDOR (21,075/21,075 resolve).
    #     (It looked orphaned earlier only because float64 staging corrupted the
    #     SIDs in OUR warehouse — fixed with dtype=object.)
    #   * INVN_SBS_VENDOR stores vendor-specific ALU/UPC ALIASES for an item;
    #     when an item has alias rows, the vendor comes from there (latest wins).
    # => COALESCE(alias vendor, item vendor). Purchases use VOUCHER.VEND_SID.
    # NOTE: column list must match DIM_ITEM's DDL order (incl. the optional
    # item-master fields appended by the model.py migration) — _bulk_upsert_dim
    # maps rows to table columns positionally.
    cur.execute(f"""
        SELECT I.SID, I.SBS_SID, I.ALU, I.UPC,
               I.DESCRIPTION1, I.DESCRIPTION2,
               I.ATTRIBUTE, I.ITEM_SIZE,
               I.DCS_SID, NVL(ISV.VEND_SID, I.VEND_SID) AS VEND_SID,
               NVL(I.ACTIVE, 1),
               I.DESCRIPTION3, I.DESCRIPTION4, I.LONG_DESCRIPTION,
               {', '.join(f'I.TEXT{i}' for i in range(1, 11))},
               {', '.join(f'I.UDF{i}_STRING' for i in range(1, 6))},
               P1.PRICE, P2.PRICE, P3.PRICE
        FROM RPS.INVN_SBS_ITEM I
        LEFT JOIN (
            SELECT INVN_SBS_ITEM_SID, VEND_SID,
                   ROW_NUMBER() OVER (
                       PARTITION BY INVN_SBS_ITEM_SID
                       ORDER BY MODIFIED_DATETIME DESC NULLS LAST, SID DESC
                   ) AS RN
            FROM RPS.INVN_SBS_VENDOR
        ) ISV ON ISV.INVN_SBS_ITEM_SID = I.SID AND ISV.RN = 1
        LEFT JOIN (SELECT DISTINCT PR.INVN_SBS_ITEM_SID, PR.PRICE
                   FROM RPS.INVN_SBS_PRICE PR
                   INNER JOIN RPS.PRICE_LEVEL PL ON PL.SID = PR.PRICE_LVL_SID
                   WHERE PL.PRICE_LVL = 1) P1 ON P1.INVN_SBS_ITEM_SID = I.SID
        LEFT JOIN (SELECT DISTINCT PR.INVN_SBS_ITEM_SID, PR.PRICE
                   FROM RPS.INVN_SBS_PRICE PR
                   INNER JOIN RPS.PRICE_LEVEL PL ON PL.SID = PR.PRICE_LVL_SID
                   WHERE PL.PRICE_LVL = 2) P2 ON P2.INVN_SBS_ITEM_SID = I.SID
        LEFT JOIN (SELECT DISTINCT PR.INVN_SBS_ITEM_SID, PR.PRICE
                   FROM RPS.INVN_SBS_PRICE PR
                   INNER JOIN RPS.PRICE_LEVEL PL ON PL.SID = PR.PRICE_LVL_SID
                   WHERE PL.PRICE_LVL = 3) P3 ON P3.INVN_SBS_ITEM_SID = I.SID
        WHERE {_no_acct_sbs_sid('I.SBS_SID')}
    """)
    n = _bulk_upsert_dim(duck, "DIM_ITEM", "SID", cur.fetchall(), full_refresh=True)
    log.info(f"DIM_ITEM: {n} rows (full refresh, vendor via INVN_SBS_VENDOR)")

    # Fallback for items with no item-vendor link: infer from the item's most
    # recent purchase voucher (the second vendor link space).
    try:
        duck.execute("""
            UPDATE DIM_ITEM SET VEND_SID = pv.VEND_SID
            FROM (
                SELECT ITEM_SID, ARG_MAX(VEND_SID, VOU_DATE) AS VEND_SID
                FROM FACT_PURCHASE_ITEMS
                WHERE VEND_SID IS NOT NULL
                GROUP BY ITEM_SID
            ) pv
            WHERE DIM_ITEM.SID = pv.ITEM_SID AND DIM_ITEM.VEND_SID IS NULL
        """)
        duck.commit()
        log.info("DIM_ITEM: vendor inferred from latest purchase where missing")
    except Exception as e:
        log.warning(f"Vendor inference skipped: {e}")

    cur.close()


# ── Inventory snapshot ────────────────────────────────────────────────────────

def _sync_inventory_snapshot(duck, ora):
    """Full DELETE+INSERT snapshot of current on-hand quantities from Oracle."""
    cur = ora.cursor()
    cur.execute(f"""
        SELECT
            IQ.INVN_SBS_ITEM_SID   AS ITEM_SID,
            IQ.STORE_SID,
            IQ.SBS_SID            AS SUBSIDIARY_SID,
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
          AND {_no_acct_sbs_sid('IQ.SBS_SID')}
    """)
    rows = cur.fetchall()
    cur.close()
    # ZERO-ROW GUARD: never wipe the live snapshot on an empty/failed source read
    # (a transient Oracle blip returning 0 rows used to blank inventory on open).
    if not rows:
        log.warning("FACT_INVENTORY: source returned 0 rows — keeping existing snapshot (no rebuild)")
        return
    now_str = datetime.utcnow().strftime('%Y-%m-%d %H:%M:%S')
    import pandas as pd
    # 7 columns, in FACT_INVENTORY's DDL order (SUBSIDIARY_SID at ordinal 3):
    # the INSERT below is a positional SELECT *, so this list and the CREATE
    # TABLE must stay in lockstep with db/model.py.
    stage_df = pd.DataFrame(
        [(r[0], r[1], r[2], r[3], r[4], r[5], now_str) for r in rows],
        columns=["ITEM_SID", "STORE_SID", "SUBSIDIARY_SID", "ON_HAND_QTY",
                 "COST", "PRICE1", "SYNCED_AT"],
        dtype=object)  # exact BIGINT SIDs — see _stream_insert note
    duck.register("_snap_stage", stage_df)
    # ATOMIC rebuild in ONE transaction: the old code DROPped first (auto-commit),
    # so FACT_INVENTORY sat EMPTY between DROP and INSERT — any interruption left
    # inventory blank until the next sync. Inside a transaction readers keep the
    # previous snapshot until COMMIT and any failure rolls back to it.
    duck.execute("BEGIN TRANSACTION")
    try:
        duck.execute("DROP TABLE IF EXISTS FACT_INVENTORY")
        duck.execute("""CREATE TABLE FACT_INVENTORY (
            ITEM_SID BIGINT, STORE_SID BIGINT, SUBSIDIARY_SID BIGINT,
            ON_HAND_QTY DECIMAL(12,3),
            COST DECIMAL(18,4), PRICE1 DECIMAL(18,4), SYNCED_AT TIMESTAMP)""")
        duck.execute("INSERT INTO FACT_INVENTORY SELECT * FROM _snap_stage")
        duck.execute("COMMIT")
    except BaseException:
        try:
            duck.execute("ROLLBACK")
        except Exception:
            pass
        raise
    finally:
        duck.unregister("_snap_stage")
    log.info(f"FACT_INVENTORY: {len(rows):,} rows loaded")


# ── General ledger (subsidiary 100 = the virtual GL) ───────────────────────────
# The customisation uses Retail Pro subsidiary 100 as a general ledger: the chart
# of accounts is stored as NON-INVENTORY items and each journal line is a
# DOCUMENT_ITEM row. Everything we need is on DOCUMENT_ITEM itself — the ALU and
# the NOTE fields are denormalised onto the line — so this reads only
# DOCUMENT_ITEM + DOCUMENT at SBS_NO = 100. Verified on production 2026-07-19:
# 875 lines / 274 GL documents / 147 source documents, no NULLs and no malformed
# values in NOTE1..NOTE8.
#
# Reading rules (do not "simplify" these):
#   * PRICE is ALWAYS POSITIVE and QTY is always 1 — verified, 0 exceptions.
#   * The sign lives in ITEM_TYPE: 1 = DEBIT, 2 = CREDIT.
#
# NOTE field mapping written by the poster:
#   NOTE1 = source SBS_NO      NOTE2 = source STORE_CODE   NOTE3 = BP_ID
#   NOTE4 = source DOC_NO      NOTE5 = journal DOC_TYPE    NOTE7 = source DOC_SID
#   NOTE8 = source DOC_POST_DATE, as text 'DD-MM-YYYY HH24:MI:SS'
#
# MANUAL ENTRIES (2026-07-22). The NOTE fields are written by the INTEGRATION
# POSTER only. Journals the accountant keys directly into Prism on sbs 100
# (payroll, rent, accruals) have NOTE5/NOTE7/NOTE8 EMPTY — they have no source
# document at all. They are deliberately INCLUDED here:
#   * SRC_DOC_SID stays NULL (TO_NUMBER(NOTE7) of NULL) — never faked. NULL
#     SRC_DOC_SID is exactly how the reporting layer recognises a manual
#     'Entry' journal (three-way category: Payment / Transaction / Entry).
#   * SRC_DOC_TYPE falls back to the literal 'Entry' via NVL(NOTE5, 'Entry').
#   * POST_DATE falls back to TRUNC(D.INVC_POST_DATE): a USER-entered sbs-100
#     document's own posting date IS its accounting date (the day/month
#     transposition bug affects only the poster's AL_POST_DATE writes, not
#     user-entered documents). The final guard keeps out any line where BOTH
#     dates are missing, because FACT_GL.POST_DATE is NOT NULL.
#
# ⚠ THE DATE. For poster-written lines NOTE8 is the ACCOUNTING date and is the
# only correct one to report on. The sbs-100 document's own INVC_POST_DATE /
# CREATED_DATETIME is the date the poster RAN — on this server the Jan-2026
# entries all carry 19-07-2026. Filtering or grouping on those would collapse
# every poster journal onto the posting run date. NOTE8 is text so there is no
# index to hint; sbs 100 is small (one row per journal line) and the owner has
# confirmed read performance here is a non-issue, so a full scan is accepted
# deliberately.
def _sql_gl(df, dt):
    return f"""
        SELECT
            DI.SID                                              AS GL_LINE_SID,
            DI.DOC_SID                                          AS GL_DOC_SID,
            TO_CHAR(D.DOC_NO)                                   AS GL_DOC_NO,
            COALESCE(TO_DATE(SUBSTR(DI.NOTE8, 1, 10), 'DD-MM-YYYY'),
                     TRUNC(D.INVC_POST_DATE))                   AS POST_DATE,
            TRUNC(NVL(D.INVC_POST_DATE, D.CREATED_DATETIME))    AS GL_POST_DATE,
            DI.INVN_SBS_ITEM_SID                                AS ACCOUNT_SID,
            DI.ALU                                              AS ACCOUNT_CODE,
            ST.SID                                              AS STORE_SID,
            SB.SID                                              AS SUBSIDIARY_SID,
            TO_NUMBER(DI.NOTE1)                                 AS SRC_SBS_NO,
            DI.NOTE2                                            AS SRC_STORE_CODE,
            TO_NUMBER(DI.NOTE7)                                 AS SRC_DOC_SID,
            DI.NOTE4                                            AS SRC_DOC_NO,
            NVL(DI.NOTE5, 'Entry')                              AS SRC_DOC_TYPE,
            DI.NOTE3                                            AS BP_ID,
            NVL(CASE WHEN DI.ITEM_TYPE = 1 THEN DI.PRICE END, 0)      AS DEBIT,
            NVL(CASE WHEN DI.ITEM_TYPE = 2 THEN DI.PRICE END, 0)      AS CREDIT,
            NVL(CASE WHEN DI.ITEM_TYPE = 1 THEN DI.PRICE
                     ELSE -DI.PRICE END, 0)                           AS AMOUNT
        FROM RPS.DOCUMENT_ITEM DI
        JOIN RPS.DOCUMENT D  ON D.SID = DI.DOC_SID
        LEFT JOIN RPS.SUBSIDIARY SB ON SB.SBS_NO = TO_NUMBER(DI.NOTE1)
        LEFT JOIN RPS.STORE ST      ON ST.STORE_CODE = DI.NOTE2
                                   AND ST.SBS_SID    = SB.SID
        WHERE DI.SBS_NO = 100
          AND COALESCE(TO_DATE(SUBSTR(DI.NOTE8, 1, 10), 'DD-MM-YYYY'),
                       TRUNC(D.INVC_POST_DATE)) IS NOT NULL
          AND COALESCE(TO_DATE(SUBSTR(DI.NOTE8, 1, 10), 'DD-MM-YYYY'),
                       TRUNC(D.INVC_POST_DATE))
                  >= TO_DATE('{df}', 'YYYY-MM-DD')
          AND COALESCE(TO_DATE(SUBSTR(DI.NOTE8, 1, 10), 'DD-MM-YYYY'),
                       TRUNC(D.INVC_POST_DATE))
                  <  TO_DATE('{dt}', 'YYYY-MM-DD') + 1
    """
# Column order matches FACT_GL exactly (18 cols) — _stream_insert maps positionally.
# The 18th is GL_POST_DATE, in ordinal position 5 (right after POST_DATE), which
# is where the DDL puts it. If you add a column here you MUST add it in the same
# position in the FACT_GL DDL and bump the ncols argument at the _stream_insert
# call site: a positional mismatch corrupts every GL row silently.
#
# The date WINDOW deliberately still filters on the TRANSACTION date (NOTE8,
# falling back to the document's own INVC_POST_DATE for manual entries — the
# same COALESCE the POST_DATE column carries, so a row is windowed on exactly
# the date it is loaded with). GL_POST_DATE is carried for reporting only —
# filtering the extract on it would change which rows a given sync window
# loads, and an incremental run anchored to the posting date would silently
# skip back-dated journals.


def _sql_accounts():
    """Chart of accounts: NON-INVENTORY items under DCS 'ACCOUNT' of sbs 100.
    ACCOUNT_CLASS is intentionally not selected — it is the accountant's
    classification and is maintained in DuckDB, not in Retail Pro."""
    return """
        SELECT I.SID, I.ALU, I.UDF5_STRING, I.DESCRIPTION1, I.DESCRIPTION2
        FROM RPS.INVN_SBS_ITEM I
        WHERE I.SBS_SID = (SELECT SID FROM RPS.SUBSIDIARY WHERE SBS_NO = 100)
          AND I.DCS_SID = (SELECT SID FROM RPS.DCS
                           WHERE DCS_CODE = 'ACCOUNT'
                             AND SBS_SID = (SELECT SID FROM RPS.SUBSIDIARY
                                            WHERE SBS_NO = 100))
    """


def _sql_account_classes(seq_expr: str = "B.SID"):
    """Chart-of-accounts CLASSIFICATION from the Prism touch-menu tree (sbs 100).

    The owner maintains the account taxonomy as a touch menu named 'accounting'
    whose SIX first-level buttons are the classes (Assets, Liabilities, Equity,
    Purchases, Sales, Expenses — the BUTTON_TEXT verbatim is the taxonomy; we
    only TRIM it, never translate or normalise). A button either navigates
    (TARGET_MENU_SID), references an account item (INVN_ITEM_SID -> RPS.
    INVN_SBS_ITEM.SID), or BOTH — so the walk carries every button row, not
    just the menu chain, and an item anywhere under a first-level button
    inherits that button's text as its class.

    ANCHOR ON THE NAME, not a SID: the owner may recreate the menu, but it
    will always be named 'accounting'. sbs 100 also contains junk root menus
    ('dada', 'dfr', ...) — walking only from this root avoids them, and when
    several menus match the name we prefer the one that actually HAS buttons
    (COUNT desc, then SID for determinism). CYCLE protection is required:
    Oracle's CYCLE clause stops the recursion instead of erroring on a loop.

    2026-07-26 (P&L / Balance Sheet):
      * ROOT_SEQ  — the first-level button's ORDER, so the statements can list
        sections in the customer's own tree order. `seq_expr` is tried as
        B.BUTTON_SEQ first (the Prism display order) and falls back to B.SID
        (creation order — deterministic and stable) when that column does not
        exist on this server. See _fetch_account_classes.
      * DEPTH/GRP — the LEVEL-2 branch text. A depth-2 button carries its own
        text as GRP; deeper rows inherit it. The final SELECT only emits GRP
        for items found at depth >= 3, so an account button sitting directly
        in a class menu (depth 2 — its text is the ACCOUNT's label, not a
        group) gets NULL, exactly as agreed with the owner."""
    return f"""
        WITH WALK (BTN_SID, MENU_SID, ITEM_SID, ROOT_CLASS, ROOT_SEQ, DEPTH, GRP) AS (
            SELECT B.SID, B.TARGET_MENU_SID, B.INVN_ITEM_SID, TRIM(B.BUTTON_TEXT),
                   {seq_expr}, 1, CAST(NULL AS VARCHAR2(4000))
            FROM RPS.TOUCH_BUTTON B
            WHERE B.MENU_SID = (
                SELECT SID FROM (
                    SELECT M.SID
                    FROM RPS.TOUCH_MENU M
                    WHERE M.SBS_SID = (SELECT SID FROM RPS.SUBSIDIARY
                                       WHERE SBS_NO = 100)
                      AND LOWER(TRIM(M.MENU_TEXT)) = 'accounting'
                    ORDER BY (SELECT COUNT(*) FROM RPS.TOUCH_BUTTON X
                              WHERE X.MENU_SID = M.SID) DESC, M.SID
                ) WHERE ROWNUM = 1
            )
            UNION ALL
            SELECT B.SID, B.TARGET_MENU_SID, B.INVN_ITEM_SID, W.ROOT_CLASS,
                   W.ROOT_SEQ, W.DEPTH + 1,
                   CASE WHEN W.DEPTH = 1 THEN TRIM(B.BUTTON_TEXT) ELSE W.GRP END
            FROM RPS.TOUCH_BUTTON B
            JOIN WALK W ON B.MENU_SID = W.MENU_SID
        ) CYCLE BTN_SID SET IS_CYCLE TO 'Y' DEFAULT 'N'
        SELECT DISTINCT ITEM_SID, ROOT_CLASS,
               CASE WHEN DEPTH >= 3 THEN GRP ELSE NULL END,
               ROOT_SEQ
        FROM WALK
        WHERE ITEM_SID IS NOT NULL
          AND ROOT_CLASS IS NOT NULL
    """


def _fetch_account_classes(ora):
    """(mapping, conflicts) from the accounting touch-menu tree.

    mapping   — INVN_ITEM_SID -> (class, group, seq):
                  class — first-level branch text. When an item is reachable
                          under MORE than one class (a data error the owner
                          must see) the choice is deterministic: MIN(class).
                  group — LEVEL-2 branch text (NULL when the account hangs
                          directly under the class). Deterministic under
                          conflicts: the MIN non-NULL group of the chosen
                          class, else NULL.
                  seq   — the class branch's first-level order (see below).
    conflicts — multi-class SIDs -> sorted list of the classes found,
                so the caller can log exactly what is wrong.

    SECTION ORDER: tried with B.BUTTON_SEQ (Prism's display order) first; a
    server whose TOUCH_BUTTON has no such column raises ORA-00904, and we fall
    back to B.SID (creation order — stable and deterministic, and in practice
    the order the owner created the branches in). Any other error propagates
    to _load_accounts' own tolerance handling."""
    def _run(seq_expr):
        cur = ora.cursor()
        try:
            cur.execute(_sql_account_classes(seq_expr))
            return cur.fetchall()
        finally:
            cur.close()

    try:
        rows = _run("B.BUTTON_SEQ")
    except Exception as e:
        if "ORA-00904" not in str(e):     # invalid identifier = column absent
            raise
        rows = _run("B.SID")

    # sid -> class -> {'groups': set, 'seq': min}
    by_sid: dict = {}
    for sid, cls, grp, seq in rows:
        if sid is None or cls is None:
            continue
        per = by_sid.setdefault(sid, {}).setdefault(cls, {"groups": set(), "seq": None})
        per["groups"].add(grp)
        if seq is not None:
            s = int(seq)
            per["seq"] = s if per["seq"] is None else min(per["seq"], s)

    mapping, conflicts = {}, {}
    for sid, per_cls in by_sid.items():
        cls = min(per_cls)                       # deterministic under conflicts
        groups = sorted(g for g in per_cls[cls]["groups"] if g is not None)
        mapping[sid] = (cls, groups[0] if groups else None, per_cls[cls]["seq"])
        if len(per_cls) > 1:
            conflicts[sid] = sorted(per_cls)
    return mapping, conflicts


# ── Built-in classification defaults for the integration's accounts ─────────
# The POS→Accounting integration's master script preinstalls a KNOWN chart of
# accounts (the 0000.xx / 1010.xx / 1200.xx / 3xxx.xx / 5xxx.xx / 6xxx.xx ALUs
# below). Out of the box those accounts sat in the statements' 'Unclassified'
# bucket until the customer placed them in the Prism accounting touch menu.
# This map classifies them BY DEFAULT so a fresh install produces correct
# statements with zero Prism work.
#
# PRECEDENCE (lowest of the three, applied LAST and only into NULLs):
#   tree > carried manual/prior value > built-in default.
# A customer placing one of these accounts under ANY branch of their tree
# overrides the default on the next sync. Removed-from-tree nuance: once a
# tree class has been applied it is CARRIED across later syncs like any other
# prior value (source 'manual'), so deleting the account from the tree does
# NOT snap it back to the built-in default — that is the documented
# 'manual/carried' precedence, not a bug.
#
# The class names are deliberately the CANONICAL ones: they auto-resolve to
# statement roles via routers/accounting.resolve_class_role's _AUTO_ROLE map
# (Assets→asset, Liabilities→liability, Sales→revenue, Purchases/Expenses→
# cost) AND they match the owner's own first-level branch names, so on his
# tree the defaulted accounts merge straight into his existing sections.
# COGS accounts live under 'Purchases' (trading-account model) by the OWNER'S
# DECISION — do not move them to 'Expenses'.
# ACCOUNT_GROUP / CLASS_SEQ stay NULL for defaulted accounts: they sort after
# the tree-ordered sections, which is correct.
_INTEGRATION_CLASS_DEFAULTS: dict = {
    # Assets — cash/tender clearing (1010.xx), inventory (1200.xx), VAT input
    "1010.01": "Assets", "1010.03": "Assets", "1010.05": "Assets",
    "1010.07": "Assets", "1010.13": "Assets", "1010.14": "Assets",
    "1010.15": "Assets", "1010.16": "Assets", "1010.21": "Assets",
    "1010.26": "Assets", "1010.30": "Assets", "1010.40": "Assets",
    "1010.46": "Assets", "1200.00": "Assets", "1200.01": "Assets",
    "1200.02": "Assets", "1200.03": "Assets", "1200.04": "Assets",
    "1200.05": "Assets", "1220.01": "Assets",
    # Liabilities — payables, VAT output, deposits/credits
    "3100.01": "Liabilities", "3240.01": "Liabilities",
    "3250.01": "Liabilities", "3250.02": "Liabilities",
    "3500.01": "Liabilities", "3500.02": "Liabilities",
    # Sales — revenue, returns, discounts, fees/charges
    "5100.01": "Sales", "5110.01": "Sales", "5200.01": "Sales",
    "5300.02": "Sales", "5300.03": "Sales", "5300.04": "Sales",
    "5300.05": "Sales", "5300.06": "Sales", "5400.01": "Sales",
    # Purchases — COGS under the trading-account model (owner's decision)
    "6010.01": "Purchases", "6020.01": "Purchases",
    "6050.01": "Purchases", "6060.01": "Purchases",
    # Expenses — adjustment/shrinkage write-offs
    "0000.01": "Expenses", "0000.02": "Expenses", "0000.03": "Expenses",
}


def _load_accounts(duck, ora):
    """Refresh DIM_ACCOUNT, preserving the accountant's ACCOUNT_CLASS.

    Same zero-row guard as the other small dimensions: if the source returns
    nothing (wrong subsidiary, DCS renamed, permissions) we keep what we have
    rather than wiping the chart of accounts."""
    cur = ora.cursor()
    cur.execute(_sql_accounts())
    rows = cur.fetchall()
    cur.close()
    if not rows:
        log.warning("DIM_ACCOUNT: source returned 0 rows — keeping existing data (no wipe)")
        return

    # ── ACCOUNT_CLASS from the Prism touch-menu tree (OPTIONAL enhancement) ──
    # Tolerance mirrors _try_optional, but LOCALLY: a missing TOUCH_MENU /
    # TOUCH_BUTTON must not fail the sync AND must not mark the whole
    # accounting feature unavailable — classification is an enhancement, the
    # GL itself is fine without it. Any other error still propagates.
    class_map, class_conflicts, tree_available = {}, {}, True
    try:
        class_map, class_conflicts = _fetch_account_classes(ora)
    except SyncCancelled:
        raise
    except Exception as e:
        if not _is_missing_object(e):
            raise
        tree_available = False
        log.warning("ACCOUNT_CLASS: touch-menu tables not available on this "
                    f"server — classification skipped ({str(e).strip()[:120]})")
    # CLASS_SEQ: compress the raw first-level order values (BUTTON_SEQ or, on
    # the fallback path, 18-digit button SIDs) into a small dense rank per
    # class — stable, fits INTEGER, and identical whichever source ordered it.
    seq_rank: dict = {}
    if class_map:
        by_class: dict = {}
        for cls, _grp, seq in class_map.values():
            cur_v = by_class.get(cls)
            if seq is not None and (cur_v is None or seq < cur_v):
                by_class[cls] = seq
            else:
                by_class.setdefault(cls, cur_v)
        ordered = sorted(by_class.items(),
                         key=lambda kv: (kv[1] is None, kv[1] if kv[1] is not None else 0, kv[0]))
        seq_rank = {cls: i + 1 for i, (cls, _v) in enumerate(ordered)}

    duck.execute("BEGIN TRANSACTION")
    try:
        # ACCOUNT_CLASS/GROUP/SEQ are owned by the accountant's tree, not by
        # Retail Pro's item extract, so carry them across the refresh instead
        # of blanking them on every sync. DROP+CREATE (not IF NOT EXISTS): the
        # temp table's shape changed in v7 and a stale same-session copy must
        # never survive with the old column list.
        duck.execute("DROP TABLE IF EXISTS _acct_class")
        # 'default'-sourced rows are deliberately NOT carried: the built-in
        # defaults are re-applied fresh from _INTEGRATION_CLASS_DEFAULTS below,
        # so a code update that changes the map takes effect on the next sync
        # instead of being pinned by its own previous output. Everything else
        # (tree or manual or pre-v8 NULL source) is carried and restored as
        # 'manual' — accounts still in the tree are immediately re-stamped
        # 'tree' by the tree UPDATE that follows; accounts REMOVED from the
        # tree keep the carried class as 'manual' (the documented
        # manual/carried precedence — see _INTEGRATION_CLASS_DEFAULTS).
        duck.execute("""
            CREATE TEMP TABLE _acct_class AS
            SELECT SID, ACCOUNT_CLASS, ACCOUNT_GROUP, CLASS_SEQ
            FROM DIM_ACCOUNT
            WHERE ACCOUNT_CLASS IS NOT NULL
              AND COALESCE(CLASS_SOURCE, 'manual') <> 'default'
        """)
        duck.execute("DELETE FROM DIM_ACCOUNT")
        duck.executemany(
            "INSERT INTO DIM_ACCOUNT (SID, ACCOUNT_CODE, ACCOUNT_KEY, NAME_EN, NAME_AR) "
            "VALUES (?, ?, ?, ?, ?)", rows)
        duck.execute("""
            UPDATE DIM_ACCOUNT d SET ACCOUNT_CLASS = c.ACCOUNT_CLASS,
                                     ACCOUNT_GROUP = c.ACCOUNT_GROUP,
                                     CLASS_SEQ     = c.CLASS_SEQ,
                                     CLASS_SOURCE  = 'manual'
            FROM _acct_class c WHERE c.SID = d.SID
        """)
        duck.execute("DROP TABLE IF EXISTS _acct_class")
        # PRECEDENCE: a class from the TREE always wins (applied after the
        # carry-over so it overwrites); accounts absent from the tree keep the
        # carried manual class; accounts in neither fall through to the
        # built-in integration defaults below, and only then stay NULL. This
        # is exactly what lets the owner place the missing integration
        # accounts in Prism and have the next sync pick them up with zero
        # code changes. The same precedence applies to the level-2 group and
        # the section order.
        if class_map:
            duck.executemany(
                "UPDATE DIM_ACCOUNT SET ACCOUNT_CLASS = ?, ACCOUNT_GROUP = ?, "
                "CLASS_SEQ = ?, CLASS_SOURCE = 'tree' WHERE SID = ?",
                [(cls, grp, seq_rank.get(cls), sid)
                 for sid, (cls, grp, _seq) in class_map.items()])
        # BUILT-IN DEFAULTS, last and only into NULLs: neither the tree nor a
        # carried prior value classified these, so the integration's known
        # chart gets its canonical class. ACCOUNT_GROUP / CLASS_SEQ stay NULL
        # on purpose (defaulted sections sort after the tree-ordered ones).
        duck.executemany(
            "UPDATE DIM_ACCOUNT SET ACCOUNT_CLASS = ?, CLASS_SOURCE = 'default' "
            "WHERE ACCOUNT_CLASS IS NULL AND ACCOUNT_CODE = ?",
            [(cls, code) for code, cls in _INTEGRATION_CLASS_DEFAULTS.items()])
        duck.execute("COMMIT")
    except BaseException:
        try:
            duck.execute("ROLLBACK")
        except Exception:
            pass
        raise

    if class_conflicts:
        # An account reachable under two first-level classes is a data error
        # the owner must see; resolved deterministically to MIN(class) above.
        alu_by_sid = {r[0]: r[1] for r in rows}
        listing = "; ".join(
            f"{alu_by_sid.get(sid, sid)} -> {', '.join(classes)} (kept {min(classes)})"
            for sid, classes in sorted(class_conflicts.items()))
        log.warning("ACCOUNT_CLASS: %d account(s) reachable under MORE than one "
                    "class in the accounting touch menu — fix in Prism: %s",
                    len(class_conflicts), listing)
    if tree_available and not class_map:
        log.warning("ACCOUNT_CLASS: no 'accounting' touch menu found in "
                    "subsidiary 100 (or it references no account items) — "
                    "existing classifications kept, nothing reclassified")

    classified = duck.execute(
        "SELECT COUNT(*) FROM DIM_ACCOUNT WHERE ACCOUNT_CLASS IS NOT NULL"
    ).fetchone()[0]
    try:
        gl_unclassified = duck.execute("""
            SELECT COUNT(DISTINCT G.ACCOUNT_CODE) FROM FACT_GL G
            LEFT JOIN DIM_ACCOUNT d ON d.SID = G.ACCOUNT_SID
            WHERE d.ACCOUNT_CLASS IS NULL
        """).fetchone()[0]
        gl_note = f"; {gl_unclassified} GL-used account(s) still unclassified"
    except Exception:
        gl_note = ""  # FACT_GL not created yet (first-ever sync)
    src_counts = dict(duck.execute(
        "SELECT CLASS_SOURCE, COUNT(*) FROM DIM_ACCOUNT "
        "WHERE ACCOUNT_CLASS IS NOT NULL GROUP BY CLASS_SOURCE").fetchall())
    log.info(f"DIM_ACCOUNT: {len(rows):,} accounts loaded; "
             f"{classified}/{len(rows)} classified "
             f"({src_counts.get('tree', 0)} from tree, "
             f"{src_counts.get('default', 0)} from built-in integration defaults, "
             f"{len(rows) - classified} unclassified){gl_note}")


def _derive_gl_docs(duck):
    """Rebuild FACT_GL_DOC from FACT_GL — no extra Oracle scan.

    One row per BALANCE UNIT, keyed COALESCE(SRC_DOC_SID, GL_DOC_SID):

      * Poster journals — the poster deliberately splits a single source
        document into several sbs-100 journals by DOC_TYPE (a sale journal, a
        payment journal per tender, …) which clear against each other through
        AR, so balance is only meaningful across ALL journals of a source
        document — i.e. grouped by SRC_DOC_SID ALONE. Do NOT group by
        SRC_DOC_TYPE, and do NOT split by store: transfer slips are
        intentionally +X in the receiving store and -X in the sending store.
      * Manual entries (2026-07-22) — the accountant's own journals have NO
        source document (SRC_DOC_SID IS NULL), so each one falls back to its
        own GL_DOC_SID: a manual journal must balance WITHIN ITSELF. The two
        key spaces cannot collide — both SIDs come from the same
        RPS.DOCUMENT.SID sequence, and a GL document is never anyone's source
        document.

    The stored SRC_DOC_SID column therefore HOLDS the coalesced key, and every
    consumer joins it with the same COALESCE (see accounting.py _balanced /
    _scope_doc). SRC_DOC_NO falls back to GL_DOC_NO the same way, so a manual
    journal in the exceptions report shows the number the accountant can
    actually find in Prism.

    The 0.01 tolerance absorbs decimal noise only. The poster already plugs any
    document out by <= 0.20 into the Tender Rounding account, so anything that
    reaches here unbalanced is a real defect, not rounding."""
    duck.execute("""
        CREATE OR REPLACE TABLE FACT_GL_DOC AS
        SELECT
            COALESCE(SRC_DOC_SID, GL_DOC_SID)   AS SRC_DOC_SID,
            MIN(POST_DATE)                      AS POST_DATE,
            -- Both bases, so the exceptions report and the balanced gate work
            -- under either one. MIN(): a source document's journals share a
            -- posting run, and where they do not, the earliest is the date the
            -- books first received the document.
            MIN(GL_POST_DATE)                   AS GL_POST_DATE,
            MIN(COALESCE(SRC_DOC_NO, GL_DOC_NO)) AS SRC_DOC_NO,
            MIN(SRC_STORE_CODE)                 AS SRC_STORE_CODE,
            MIN(STORE_SID)                      AS STORE_SID,
            COUNT(DISTINCT SRC_DOC_TYPE)        AS JOURNALS,
            COUNT(*)                            AS LINES,
            ROUND(SUM(AMOUNT), 2)               AS NET,
            ABS(ROUND(SUM(AMOUNT), 2)) < 0.01   AS IS_BALANCED
        FROM FACT_GL
        GROUP BY COALESCE(SRC_DOC_SID, GL_DOC_SID)
    """)
    bad = duck.execute(
        "SELECT COUNT(*), ROUND(SUM(NET), 2) FROM FACT_GL_DOC WHERE NOT IS_BALANCED"
    ).fetchone()
    if bad and bad[0]:
        log.warning(
            f"FACT_GL: {bad[0]} source document(s) do not net to zero "
            f"(total {bad[1]}) — excluded from the statements, listed by the "
            f"GL Exceptions report")
    else:
        log.info("FACT_GL: all source documents balance")


# ── Streaming bulk fact load ────────────────────────────────────────────────────
# Oracle date columns are NOT indexed (confirmed on RPS.DOCUMENT), so every
# date-filtered query full-scans the table. The old code chunked by week, turning
# ONE scan into hundreds (≈312 for a multi-year load) — the root of the 24-hour
# load. We now scan each table ONCE over the whole range and STREAM rows in batches
# (bounded memory) instead of fetchall(). Inserts are INSERT-ONLY (OR IGNORE):
# closed STATUS=4 documents are immutable, so existing rows are never rewritten.
# force_replace (repair only) overwrites existing keys.

_BATCH = 50_000

# Primary key per fact table — used for the set-based anti-join dedup.
_FACT_PK = {
    "FACT_SALES_INVOICES":    "DOC_SID",
    "FACT_SALES_ITEMS":       "DOC_ITEM_SID",
    "FACT_TRANSFERS":         "TRANSFER_ITEM_SID",
    "FACT_ADJUSTMENTS":       "ADJ_ITEM_SID",
    "FACT_PURCHASES":         "VOU_SID",
    "FACT_PURCHASE_ITEMS":    "VOU_ITEM_SID",
    "FACT_INVENTORY_HISTORY": "HISTORY_SID",
    "FACT_GL":                "GL_LINE_SID",
}


def _stream_insert(duck, ora, sql: str, table: str, ncols: int,
                   force_replace: bool = False, progress=None) -> int:
    """Run one Oracle query and stream its rows into `table` in bulk batches.

    Staged BULK insert (DB_SYNC_REDESIGN §4): each batch is registered as a
    DataFrame view and loaded with one set-based INSERT ... SELECT anti-join.
    The old per-row `executemany INSERT OR IGNORE` ground through the ART PK
    index one row at a time (~55 rows/s observed = 15+ min for one 50k batch);
    the set-based form is vectorized and hash-joins the dedup.

    The SELECT column order matches the DuckDB table column order (verified per
    query builder), so rows map positionally. Returns rows loaded."""
    import pandas as pd

    pk   = _FACT_PK[table]
    cols = [r[1] for r in duck.execute(f"PRAGMA table_info('{table}')").fetchall()]
    # The Oracle SELECT maps positionally onto the FIRST ncols table columns;
    # columns beyond ncols are derived locally (e.g. the item-level
    # GROSS_WOTAX/RETURN_WOTAX/RETURN_UNITS on FACT_SALES_INVOICES) and are
    # populated after the load, so they are excluded from the staged insert.
    assert len(cols) >= ncols, f"{table}: expected at least {ncols} cols, table has {len(cols)}"
    cols = cols[:ncols]
    collist = ", ".join(cols)

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
        # dtype=object is CRITICAL: with default inference, one NULL in a BIGINT
        # column flips the whole batch to float64, silently corrupting 19-digit
        # RP9 SIDs (> 2^53) — e.g. VEND_SID ...650 became ...648, breaking all
        # vendor joins. object dtype passes exact Python ints through to DuckDB.
        stage_df = pd.DataFrame(rows, columns=cols, dtype=object)
        duck.register("_stage", stage_df)
        try:
            if force_replace:
                duck.execute(f"DELETE FROM {table} WHERE {pk} IN (SELECT {pk} FROM _stage)")
                duck.execute(f"INSERT INTO {table} ({collist}) SELECT * FROM _stage")
            else:
                duck.execute(f"""
                    INSERT INTO {table} ({collist})
                    SELECT s.* FROM _stage s
                    WHERE NOT EXISTS (SELECT 1 FROM {table} f WHERE f.{pk} = s.{pk})
                """)
        finally:
            duck.unregister("_stage")
        duck.commit()
        total += len(rows)
        if progress:
            progress(total)
        log.info(f"{table}: {total:,} rows")
    cur.close()
    return total


def _apply_item_returns(duck, df: str, dt: str):
    """Materialise ITEM-level sale/return aggregates onto FACT_SALES_INVOICES.
    Returns are ITEM_TYPE=2 lines and gross sales are ITEM_TYPE=1 lines — the
    document RECEIPT_TYPE is NOT enough because a sale receipt (type 0) can
    contain returned items. Both sides use the same base (TOTAL_PRICE_WOTAX)
    so return rates compare like-for-like. Verified against RPS: item-level
    return units reconcile exactly with SUM(DOCUMENT.RETURN_QTY)."""
    duck.execute("""
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
            WHERE INVC_POST_DATE::DATE BETWEEN ? AND ?
            GROUP BY DOC_SID
        ) A
        WHERE FACT_SALES_INVOICES.DOC_SID = A.DOC_SID
    """, [df, dt])
    duck.commit()
    log.info("Item-level sale/return aggregates applied to invoices")


def _derive_daily(duck, df: str, dt: str):
    """Build FACT_SALES_DAILY from the invoices already in DuckDB — no extra Oracle
    scan. Equivalent to the old Oracle DAILY aggregate (same STATUS=4 source rows)."""
    duck.execute("""
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
            "INSERT OR REPLACE INTO FACT_INVENTORY VALUES (?,?,?,?,?,?,?)",
            [(r[0], r[1], r[2], r[3], r[4], r[5], now) for r in rows],
        )
        duck.commit()
        total += len(rows)
    cur.close()
    log.info(f"FACT_INVENTORY upsert {df}->{dt}: {total:,} rows")


def _trim_table(duck, table: str, predicate: str, params: list):
    """Remove rows matching `predicate` WITHOUT row-DELETE.

    DuckDB's ART PK index intermittently hits FATAL 'Failed to delete all rows
    from index' on large DELETEs, which invalidates the whole database
    ('Connection Error: Connection already closed!' on every later call).
    Clone-keep-swap avoids the ART delete path entirely, then _ensure_schema
    recreates the canonical DDL (incl. PKs) before re-inserting kept rows.
    """
    from db.model import _ensure_schema
    keep = f"{table}__keep"
    duck.execute(f"DROP TABLE IF EXISTS {keep}")
    duck.execute(f"CREATE TABLE {keep} AS SELECT * FROM {table} WHERE NOT ({predicate})", params)
    duck.execute(f"DROP TABLE {table}")
    _ensure_schema(duck)                      # recreate with canonical DDL + PK
    duck.execute(f"INSERT INTO {table} SELECT * FROM {keep}")
    duck.execute(f"DROP TABLE {keep}")


def _trim_range(duck, tables, date_from: str, date_to: str):
    """REBUILD mode only (destructive): clear facts inside [from,to] before reload."""
    ALL = tables is None
    p = [date_from, date_to]
    if ALL or "sales" in tables:
        _trim_table(duck, "FACT_SALES_INVOICES", "CAST(INVC_POST_DATE AS DATE) BETWEEN ? AND ?", p)
        _trim_table(duck, "FACT_SALES_ITEMS",    "INVC_POST_DATE BETWEEN ? AND ?", p)
        _trim_table(duck, "FACT_SALES_DAILY",    "POST_DATE      BETWEEN ? AND ?", p)
    if ALL or "transfers" in tables:
        _trim_table(duck, "FACT_TRANSFERS",      "SLIP_DATE BETWEEN ? AND ?", p)
    if ALL or "adjustments" in tables:
        _trim_table(duck, "FACT_ADJUSTMENTS",    "ADJ_DATE  BETWEEN ? AND ?", p)
    if ALL or "purchases" in tables:
        _trim_table(duck, "FACT_PURCHASES",      "VOU_DATE  BETWEEN ? AND ?", p)
        _trim_table(duck, "FACT_PURCHASE_ITEMS", "VOU_DATE  BETWEEN ? AND ?", p)
    duck.commit()


# ── Self-healing purge of the accounting subsidiary ────────────────────────────
# The extracts above stop sbs 100 arriving, but installs that already synced
# before this fix have it sitting in the warehouse. This runs at the start of
# every sync so those installs clean themselves without a full reload.
#
# It is IDEMPOTENT and CHEAP: each table is COUNTed first and only rewritten
# when it actually has contaminated rows, so the normal case (already clean) is
# a handful of counts. Removal uses the clone-keep-swap _trim_table, never a
# row-DELETE through the ART primary-key index — large ART deletes raise the
# fatal 'Failed to delete all rows from index' that invalidates the whole DB.
#
# FACT_GL, FACT_GL_DOC and DIM_ACCOUNT are NEVER touched: they are the
# accounting star and sbs 100 is exactly what they are supposed to contain.

def _int_list(sids) -> str:
    """'(1,2,3)' from ints — type-safe by construction (see routers/common.py).
    '(NULL)' when empty so the generated IN (...) stays valid SQL and matches
    nothing."""
    vals = [str(int(s)) for s in sids if s is not None]
    return "(" + ",".join(vals) + ")" if vals else "(NULL)"


def _acct_scope(duck) -> dict:
    """Resolve everything in the warehouse that belongs to the accounting
    subsidiary, BEFORE anything is deleted (the dimensions that identify it are
    themselves purged, so the ids must be captured up front)."""
    def sids(sql):
        try:
            return [r[0] for r in duck.execute(sql).fetchall() if r[0] is not None]
        except Exception:
            return []          # table missing on an older warehouse — ignore

    sbs = sids(f"SELECT SID FROM DIM_SUBSIDIARY WHERE SBS_NO = {ACCOUNTING_SBS_NO}")
    sbs_in = _int_list(sbs)

    stores = sids(f"SELECT SID FROM DIM_STORE WHERE SUBSIDIARY_SID IN {sbs_in}")

    # The chart-of-accounts department: by subsidiary, plus the DCS the known
    # account items actually hang off (covers a warehouse whose DIM_SUBSIDIARY
    # was already cleaned by an earlier partial run).
    dcs = set(sids(f"SELECT SID FROM DIM_DCS WHERE SBS_SID IN {sbs_in}"))
    dcs |= set(sids("SELECT DISTINCT DCS_SID FROM DIM_ITEM "
                    "WHERE SID IN (SELECT SID FROM DIM_ACCOUNT)"))
    dcs_in = _int_list(dcs)

    # Chart-of-accounts items. DIM_ACCOUNT is authoritative — it is loaded by
    # the accounting extract and holds precisely the sbs-100 item SIDs — and is
    # unioned with the subsidiary/department routes so the purge still works on
    # an install where the accounting sync has never run.
    items = set(sids("SELECT SID FROM DIM_ACCOUNT"))
    items |= set(sids(f"SELECT SID FROM DIM_ITEM WHERE SBS_SID IN {sbs_in}"))
    items |= set(sids(f"SELECT SID FROM DIM_ITEM WHERE DCS_SID IN {dcs_in}"))

    return {"sbs": sbs_in, "stores": _int_list(stores),
            "dcs": dcs_in, "items": _int_list(items),
            "any": bool(sbs or stores or dcs or items)}


def _acct_purge_plan(s: dict) -> list[tuple[str, str]]:
    """(table, predicate) for every table that CAN identify sbs-100 rows.

    Deliberately NOT in this list:
      * FACT_GL / FACT_GL_DOC / DIM_ACCOUNT — the accounting star itself.
      * DIM_CUSTOMER / DIM_EMPLOYEE — neither carries a subsidiary column in
        the warehouse, so sbs-100 rows cannot be identified in place. They are
        harmless once the facts are clean (an unreferenced dimension row shows
        up in no figure), and the extracts now stop new ones arriving. Say so
        rather than pretend they are cleaned."""
    sbs, stores, items, dcs = s["sbs"], s["stores"], s["items"], s["dcs"]
    return [
        # Facts — subsidiary carried directly, or resolved via item / store.
        # FACT_SALES_ITEMS has no subsidiary column of its own, so it is also
        # matched through its parent document. That MUST run before the invoice
        # purge below, while the sbs-100 invoice rows are still there to join to.
        ("FACT_SALES_ITEMS",
         f"ITEM_SID IN {items} OR DOC_SID IN "
         f"(SELECT DOC_SID FROM FACT_SALES_INVOICES WHERE SUBSIDIARY_SID IN {sbs})"),
        ("FACT_SALES_INVOICES",    f"SUBSIDIARY_SID IN {sbs}"),
        ("FACT_SALES_DAILY",       f"SUBSIDIARY_SID IN {sbs}"),
        ("FACT_INVENTORY",         f"ITEM_SID IN {items} OR STORE_SID IN {stores}"),
        ("FACT_INVENTORY_HISTORY",
         f"SBS_SID IN {sbs} OR ITEM_SID IN {items} OR STORE_SID IN {stores}"),
        ("FACT_TRANSFERS",
         f"ITEM_SID IN {items} OR OUT_STORE_SID IN {stores} OR IN_STORE_SID IN {stores}"),
        ("FACT_ADJUSTMENTS",       f"ITEM_SID IN {items} OR STORE_SID IN {stores}"),
        ("FACT_PURCHASES",         f"STORE_SID IN {stores}"),
        ("FACT_PURCHASE_ITEMS",    f"ITEM_SID IN {items} OR STORE_SID IN {stores}"),
        # Dimensions — these are what the slicers and lists read.
        ("DIM_ITEM",   f"SID IN {items} OR SBS_SID IN {sbs} OR DCS_SID IN {dcs}"),
        ("DIM_DCS",    f"SID IN {dcs} OR SBS_SID IN {sbs}"),
        ("DIM_VENDOR", f"SBS_SID IN {sbs}"),
        ("DIM_STORE",  f"SUBSIDIARY_SID IN {sbs}"),
        # LAST: the subsidiary row itself — everything above is identified from
        # it, so removing it first would strand the rest.
        ("DIM_SUBSIDIARY", f"SBS_NO = {ACCOUNTING_SBS_NO}"),
    ]


def _purge_accounting_subsidiary(duck) -> dict:
    """Remove any already-loaded sbs-100 rows. Idempotent; never raises."""
    removed = {}
    try:
        scope = _acct_scope(duck)
        if not scope["any"]:
            return removed
        for table, predicate in _acct_purge_plan(scope):
            try:
                n = duck.execute(
                    f"SELECT COUNT(*) FROM {table} WHERE {predicate}").fetchone()[0]
            except Exception:
                continue       # table absent on this warehouse
            if not n:
                continue       # already clean — do NOT rewrite the table
            _trim_table(duck, table, predicate, [])
            duck.commit()
            removed[table] = int(n)
            log.info(f"Accounting-subsidiary purge: removed {n:,} rows from {table}")
        if removed:
            log.warning(
                f"Purged subsidiary {ACCOUNTING_SBS_NO} (the virtual GL) from the "
                f"warehouse: {removed}. FACT_GL / DIM_ACCOUNT were not touched.")
    except Exception as e:
        log.warning(f"Accounting-subsidiary purge skipped: {e}")
    return removed


# ── Fact load (one streaming Oracle scan per table over the whole range) ─────────

def _sync_chunk(duck, df: str, dt: str, skip_existing: bool = False,
                tables: set | None = None, force_replace: bool = False,
                progress_cb=None, base: int = 5, span: int = 100,
                rebuild: bool = False):
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
            _stream_insert(duck, ora, _sql_items(df, dt), "FACT_SALES_ITEMS", 22, force_replace)
            _apply_item_returns(duck, df, dt)
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
            _stream_insert(duck, ora, _sql_purchases(df, dt), "FACT_PURCHASES", 14, force_replace)
            _stream_insert(duck, ora, _sql_purchase_items(df, dt), "FACT_PURCHASE_ITEMS", 14, force_replace)

        # ── General ledger (subsidiary 100 = the virtual GL) ─────────────────
        # OPTIONAL: only installs carrying the accounting customisation have
        # subsidiary 100. Without it neither _sql_gl() nor _sql_accounts()
        # errors — they just match nothing — so we PROBE for the subsidiary and
        # record the answer, rather than letting the accounting screens read as
        # "no journals in this period". _try_optional additionally covers the
        # case where the whole RPS schema differs (ORA-00942 / ORA-01031).
        if ALL or "accounting" in tables:
            _p("General ledger", 6, 7)
            with _try_optional(duck, FEATURE_ACCOUNTING,
                               "Accounting (subsidiary 100)"):
                if not _probe_accounting_subsidiary(ora):
                    log.warning("Accounting (subsidiary 100) not available on "
                                "this server — skipping")
                    set_feature_available(
                        duck, FEATURE_ACCOUNTING, False,
                        "Subsidiary 100 (the virtual general ledger) does not "
                        "exist on this server.")
                else:
                    _load_accounts(duck, ora)
                    _stream_insert(duck, ora, _sql_gl(df, dt), "FACT_GL", 18, force_replace)
                    _derive_gl_docs(duck)
                    set_feature_available(duck, FEATURE_ACCOUNTING, True, "")

        # ── Inventory: history (append). The on-hand snapshot is NOT touched here:
        # every load path runs _sync_inventory_snapshot (full refresh) as its final
        # step, which made the old windowed upsert redundant — and broken, since
        # the rebuilt FACT_INVENTORY is intentionally PK-less and INSERT OR REPLACE
        # requires a PK (worked only once on a fresh DB, then Binder Error).
        if ALL or "inventory" in tables:
            _p("Inventory history", 5, 6)
            # RPS.INVENTORY_HISTORY is not present on every Prism installation
            # (verified missing on the multi-subsidiary test server). Skip with a
            # warning instead of failing the whole sync; the History / Stock by
            # Date pages then show an explanatory panel rather than a red error.
            with _try_optional(duck, FEATURE_INVENTORY_HISTORY,
                               "Inventory History (RPS.INVENTORY_HISTORY)"):
                # CARRY-FORWARD SEMANTICS (RetailTec's own INVN_BACKUP_TRG):
                # each row's QTY is the ABSOLUTE on-hand after a change, and the
                # trigger-install baseline snapshot rows all share one old
                # ACTION_DATE. Stock-as-of-D = last row per item×store <= D, so
                # our copy must be COMPLETE back to that baseline.
                #
                # We pull the ENTIRE table (from 1900) whenever the local copy is
                # empty OR this is a full/repair load (force_replace). Windowed
                # incremental syncs only append new actions. WHY force_replace
                # also triggers a full pull: the trigger logs only CHANGED qty,
                # so a copy that was ever seeded by a windowed pull (or an
                # interrupted first load) can permanently miss an item's baseline
                # / last pre-window snapshot and corrupt carry-forward. A full
                # load must therefore re-fetch the whole history so any missing
                # baseline is recaptured; force_replace re-inserts by HISTORY_SID
                # (rows are immutable, so this is idempotent).
                _hist_empty = duck.execute(
                    "SELECT COUNT(*) = 0 FROM FACT_INVENTORY_HISTORY").fetchone()[0]
                _full_hist = _hist_empty or force_replace or rebuild
                _hdf = "1900-01-01" if _full_hist else df
                if _full_hist:
                    _why = 'empty copy' if _hist_empty else ('rebuild' if rebuild else 'repair')
                    log.info(f"FACT_INVENTORY_HISTORY: pulling FULL history incl. baseline ({_why})")
                _stream_insert(duck, ora, _sql_inventory_history(_hdf, dt), "FACT_INVENTORY_HISTORY", 8, force_replace)
                set_feature_available(duck, FEATURE_INVENTORY_HISTORY, True, "")

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
    all_domains = ["sales", "transfers", "adjustments", "purchases", "inventory",
                   "accounting"]
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
    # The sync WRITER runs on its own cursor (isolated connection). Using the
    # root connection while API reader cursors run concurrently deadlocked
    # inside DuckDB (writer stuck in unregister, all readers timing out).
    # DB_LOCK guards cursor CREATION on the shared connection (model.py rule).
    with DB_LOCK:
        duck = get_db().cursor()
    # A DuckDB cursor is a SEPARATE session — settings on the root connection
    # do not propagate. Re-apply the full-analyze setting here or DataFrame
    # staging re-infers INT32 from 1000-row samples (see model.py get_db note).
    duck.execute("SET pandas_analyze_sample=10000000")
    _domains_str = "all" if tables is None else str(sorted(tables))
    _run_id = _log_start(duck, mode, triggered_by, _domains_str, date_from, date_to, 100)

    try:
        # Self-heal FIRST: drop anything subsidiary 100 (the virtual GL) left in
        # the warehouse from before it was excluded. Runs before the licence
        # check below so the synthetic subsidiary can never consume a licensed
        # subsidiary slot, and before the loaders so the dims come back clean.
        _purge_accounting_subsidiary(duck)

        # Subsidiary-limit grace period: after GRACE_DAYS over the licensed
        # count, data refresh stops (existing data stays viewable).
        try:
            from services.license import get_license_status, sub_limit_state
            # sbs 100 (the virtual GL) never consumes a licensed subsidiary slot.
            _n = duck.execute(
                "SELECT COUNT(*) FROM DIM_SUBSIDIARY WHERE SBS_NO IS DISTINCT FROM ?",
                [ACCOUNTING_SBS_NO]).fetchone()[0]
            _g = sub_limit_state(duck, get_license_status(), _n)
        except Exception:
            _g = None
        if _g and _g.get("blocked"):
            raise SyncCancelled(
                f"License covers {_g['max']} subsidiaries but {_g['found']} were found — "
                "the grace period has ended and data refresh is disabled. "
                "Contact RetailTec to upgrade the license.")

        # License binding: remember which Oracle server first filled this
        # warehouse (read by the UI watermark when the host later differs).
        try:
            _host = json.loads(SETTINGS_FILE.read_text()).get("connection", {}).get("host", "")
            if _host:
                duck.execute(
                    "INSERT INTO WAREHOUSE_META VALUES ('source_host', ?) "
                    "ON CONFLICT (key) DO NOTHING", [_host])
                duck.commit()
        except Exception as e:
            log.warning(f"source_host stamp failed: {e}")

        # Dimension reload throttle: incremental syncs run on every app open —
        # skip the (heavy) dimension mirror if it already ran in the last 12h.
        # Full/range loads and the explicit dimensions-load always refresh.
        _skip_dims = False
        if mode == "incremental":
            try:
                row = duck.execute(
                    "SELECT value FROM WAREHOUSE_META WHERE key='dims_loaded_at'").fetchone()
                if row and row[0]:
                    age_h = (datetime.now() - datetime.fromisoformat(row[0])).total_seconds() / 3600
                    _skip_dims = age_h < 12
            except Exception:
                pass

        ora = _get_oracle_conn()
        try:
            # Step 1 — dimensions (full refresh; small tables)
            if _skip_dims:
                log.info("Dimensions fresh (<12h) — skipping reload for incremental sync")
            else:
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
                        force_replace=force_replace, rebuild=rebuild,
                        progress_cb=progress_cb, base=5, span=90)
            _log_progress(duck, _run_id, 1)

            # Step 4 — large dims (customers, items) for the range
            if not _skip_dims:
                if progress_cb:
                    progress_cb("Loading customers & items", 90, 100)
                _load_large_dims(duck, ora, date_from, date_to, progress_cb)
                duck.execute(
                    "INSERT INTO WAREHOUSE_META VALUES ('dims_loaded_at', ?) "
                    "ON CONFLICT (key) DO UPDATE SET value = excluded.value",
                    [datetime.now().isoformat()])
                duck.commit()

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

        # Step 5b — re-derive DIM_STORE.SUBSIDIARY_SID. MUST run after the
        # dimensions reload: _replace_small_dim DELETEs + re-INSERTs DIM_STORE
        # with only (SID, STORE_CODE, STORE_NAME), which resets this derived
        # column to NULL. Before 2026-07-20 it was only ever derived at startup,
        # so it stayed NULL from the first sync until the next restart and every
        # subsidiary filter routed through DIM_STORE matched nothing.
        from db.model import derive_store_subsidiaries
        derive_store_subsidiaries(duck)
        duck.commit()

        # Step 6 — data validation: join coverage. The float64 SID corruption
        # (2026-07) was invisible for weeks; this makes any repeat loud.
        try:
            _validate_sync(duck)
        except Exception as e:
            log.warning(f"Post-sync validation failed to run: {e}")

        if progress_cb:
            progress_cb("Done", 100, 100)
        _update_watermarks(duck, tables, date_from, date_to, _run_id)
        _log_finish(duck, _run_id, "completed")
        # Locked + atomic — a raw read/write here used to race the settings
        # router and could resurrect an old connection block (lost update).
        from services.config import update_settings_fields
        update_settings_fields(last_sync=datetime.now().isoformat(),
                               model_status="ready")
        _invalidate_dim_cache()
        log.info(f"Sync [{mode}] complete: {date_from}->{date_to}")

    except SyncCancelled:
        _log_finish(duck, _run_id, "cancelled", "Cancelled by user")
        log.info("Sync cancelled by user")
        raise
    except Exception as e:
        _log_finish(duck, _run_id, "error", str(e)[:500])
        log.error(f"Sync failed: {e}")
        raise


# ── Post-sync data validation ──────────────────────────────────────────────────
# Join-coverage checks: what fraction of fact-side SIDs resolve in their dim.
# Thresholds: >=99% ok · >=90% warn · below fail. Results are kept in
# SYNC_VALIDATION (latest run only) and surfaced as a red banner in the app.

_VALIDATION_CHECKS = [
    ("sales items → items",        "FACT_SALES_ITEMS",    "ITEM_SID",  "DIM_ITEM",     "SID"),
    ("sales invoices → customers", "FACT_SALES_INVOICES", "BT_CUID",   "DIM_CUSTOMER", "SID"),
    ("sales invoices → stores",    "FACT_SALES_INVOICES", "STORE_SID", "DIM_STORE",    "SID"),
    ("items → vendors",            "DIM_ITEM",            "VEND_SID",  "DIM_VENDOR",   "SID"),
    ("purchases → suppliers",      "FACT_PURCHASES",      "VEND_SID",  "DIM_VENDOR",   "SID"),
    ("adjustments → stores",       "FACT_ADJUSTMENTS",    "STORE_SID", "DIM_STORE",    "SID"),
]


def _validate_sync(duck) -> None:
    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    rows = []
    for name, fact, fk, dim, pk in _VALIDATION_CHECKS:
        try:
            total, matched = duck.execute(f"""
                SELECT COUNT(*), COUNT(d.{pk})
                FROM {fact} f LEFT JOIN {dim} d ON d.{pk} = f.{fk}
                WHERE f.{fk} IS NOT NULL
            """).fetchone()
        except Exception as e:
            log.warning(f"Validation '{name}' skipped: {e}")
            continue
        pct = round(matched / total * 100, 2) if total else 100.0
        status = "ok" if pct >= 99 else "warn" if pct >= 90 else "fail"
        if status != "ok":
            log.warning(f"VALIDATION {status.upper()}: {name} — {matched:,}/{total:,} ({pct}%)")
        rows.append((now, name, total, matched, pct, status))
    duck.execute("DELETE FROM SYNC_VALIDATION")
    if rows:
        duck.executemany("INSERT INTO SYNC_VALIDATION VALUES (?,?,?,?,?,?)", rows)
    duck.commit()
    log.info("Post-sync validation: " +
             ", ".join(f"{r[1]}={r[4]}%" for r in rows))


def _invalidate_dim_cache() -> None:
    """Tell the sales router its in-memory dim cache is stale (lazy import —
    routers.sales imports this module's callers, so no import at module load)."""
    try:
        from routers.sales import invalidate_dim_cache
        invalidate_dim_cache()
    except Exception:
        pass


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


def _run_dimensions_load(progress_cb, triggered_by):
    """Fresh reload of ALL dimension tables only — no fact data touched.
    Small dims (stores, subsidiaries, employees, DCS, vendors) are delete+reload;
    items are a full-refresh rebuild; customers upsert over the warehouse's whole
    fact date range (covers every referenced customer, updates names/phones)."""
    _clear_cancel()
    with DB_LOCK:
        duck = get_db().cursor()
    duck.execute("SET pandas_analyze_sample=10000000")
    _run_id = _log_start(duck, "dimensions", triggered_by, "dimensions", None, None, 100)
    try:
        # Same self-heal as _run_sync — the dimensions-only reload is the other
        # path that can leave sbs-100 rows behind on an older warehouse.
        _purge_accounting_subsidiary(duck)
        ora = _get_oracle_conn()
        try:
            if progress_cb:
                progress_cb("Loading dimensions", 5, 100)
            _load_dimensions(duck, ora, progress_cb)
            row = duck.execute(
                "SELECT CAST(MIN(INVC_POST_DATE) AS DATE), CAST(MAX(INVC_POST_DATE) AS DATE) "
                "FROM FACT_SALES_INVOICES").fetchone()
            df = str(row[0]) if row and row[0] else _date_range(730)[0]
            dt = str(row[1]) if row and row[1] else str(datetime.now().date())
            if progress_cb:
                progress_cb("Loading customers & items", 50, 100)
            _load_large_dims(duck, ora, df, dt, progress_cb)
            duck.execute(
                "INSERT INTO WAREHOUSE_META VALUES ('dims_loaded_at', ?) "
                "ON CONFLICT (key) DO UPDATE SET value = excluded.value",
                [datetime.now().isoformat()])
            duck.commit()
        finally:
            ora.close()
        # DIM_STORE was just DELETEd + re-INSERTed without its derived
        # SUBSIDIARY_SID — put it back, or subsidiary scoping goes blank.
        from db.model import derive_store_subsidiaries
        derive_store_subsidiaries(duck)
        duck.commit()
        if progress_cb:
            progress_cb("Done", 100, 100)
        _log_finish(duck, _run_id, "completed")
        _invalidate_dim_cache()
        log.info("Dimensions fresh load complete")
    except SyncCancelled:
        _log_finish(duck, _run_id, "cancelled", "Cancelled by user")
        log.info("Dimensions load cancelled by user")
        raise
    except Exception as e:
        _log_finish(duck, _run_id, "failed", str(e))
        raise


async def dimensions_load(progress_cb=None, triggered_by: str = "user"):
    """Dimensions-only fresh reload (stores, subsidiaries, employees, DCS,
    vendors, customers, items). Facts are untouched."""
    log.info("Dimensions load starting")
    await asyncio.get_event_loop().run_in_executor(
        _executor, _run_dimensions_load, progress_cb, triggered_by)


# -- Retention (cap the largest tables) ----------------------------------------

_RETENTION_COLS = {
    "FACT_SALES_ITEMS": "INVC_POST_DATE",
    # FACT_INVENTORY_HISTORY is EXEMPT from retention (2026-07-09): its rows are
    # absolute stock levels (carry-forward semantics from INVN_BACKUP_TRG), so
    # deleting old rows destroys the baseline that stock-as-of-date and the
    # Ledger opening balance depend on. Never prune it.
}

def apply_retention(retain_months=24, dry_run: bool = False, duck=None) -> dict:
    """Prune line-item DETAIL older than retain_months (keeps FACT_SALES_DAILY and
    invoice headers forever). retain_months None/0 = keep everything. dry_run counts
    without deleting. Returns {table: rows_pruned}."""
    if duck is None:
        with DB_LOCK:                  # cursor creation on the shared connection
            duck = get_db().cursor()   # isolated writer cursor (see _run_sync)
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
