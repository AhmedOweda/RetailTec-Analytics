"""
Purchases Router
================
Endpoints:
  GET /api/purchases/kpi        — Summary KPIs (POs, cost, qty, vendors)
  GET /api/purchases/trend      — Daily PO trend
  GET /api/purchases/by-vendor  — Grouped by vendor
  GET /api/purchases/by-dept    — Grouped by DCS department
  GET /api/purchases/by-store   — Grouped by store
  GET /api/purchases/by-status  — Breakdown by PO status
  GET /api/purchases/details    — Line-level detail rows (FACT_PURCHASE_ITEMS)
"""
import threading
from typing import Optional
from fastapi import APIRouter, Query
from db.model import get_db

router = APIRouter(tags=["purchases"])
_db_lock = threading.Lock()


# ── Helpers ────────────────────────────────────────────────────────────────────

def _store_filter(stores: Optional[str], alias: str = "S") -> str:
    if not stores:
        return ""
    names = [f"'{s.strip().replace(chr(39), chr(39)*2)}'"
             for s in stores.split(",") if s.strip()]
    return f" AND {alias}.STORE_NAME IN ({','.join(names)})" if names else ""


def _vendor_filter(vendors: Optional[str], alias: str = "V") -> str:
    if not vendors:
        return ""
    names = [f"'{s.strip().replace(chr(39), chr(39)*2)}'"
             for s in vendors.split(",") if s.strip()]
    return f" AND {alias}.VEND_NAME IN ({','.join(names)})" if names else ""


def _status_filter(status: Optional[str]) -> str:
    """status param: 'received'|'pending'|None"""
    if status == "received":
        return " AND FP.STATUS = 4"
    if status == "pending":
        return " AND FP.STATUS = 3"
    return ""


def _qdf(sql: str) -> list[dict]:
    with _db_lock:
        con  = get_db()
        rel  = con.execute(sql)
        cols = [d[0] for d in rel.description]
        return [dict(zip(cols, row)) for row in rel.fetchall()]


def _q(sql: str):
    with _db_lock:
        return get_db().execute(sql).fetchall()


def _pur_base(df: str, dt: str, stores: Optional[str],
              vendors: Optional[str] = None, status: Optional[str] = None) -> str:
    sf  = _store_filter(stores, alias="S")
    vf  = _vendor_filter(vendors, alias="V")
    stf = _status_filter(status)
    return f"""
        FROM FACT_PURCHASES FP
        LEFT JOIN DIM_STORE  S ON S.SID  = FP.STORE_SID
        LEFT JOIN DIM_VENDOR V ON V.SID  = FP.VEND_SID
        WHERE FP.VOU_DATE BETWEEN '{df}' AND '{dt}' {sf} {vf} {stf}
    """


def _pur_items_base(df: str, dt: str, stores: Optional[str],
                    vendors: Optional[str] = None) -> str:
    sf = _store_filter(stores, alias="S")
    vf = _vendor_filter(vendors, alias="V")
    return f"""
        FROM FACT_PURCHASE_ITEMS FPI
        LEFT JOIN DIM_STORE  S  ON S.SID  = FPI.STORE_SID
        LEFT JOIN DIM_VENDOR V  ON V.SID  = FPI.VEND_SID
        LEFT JOIN DIM_ITEM   I  ON I.SID  = FPI.ITEM_SID
        LEFT JOIN DIM_DCS    DC ON DC.SID = I.DCS_SID
        WHERE FPI.VOU_DATE BETWEEN '{df}' AND '{dt}' {sf} {vf}
    """


# ── Status label ───────────────────────────────────────────────────────────────

def _status_label(alias: str = "FP") -> str:
    return f"""CASE {alias}.STATUS
        WHEN 3 THEN 'Pending'
        WHEN 4 THEN 'Received'
        ELSE 'Unknown' END"""


# ── KPI ────────────────────────────────────────────────────────────────────────

@router.get("/api/purchases/kpi")
def purchases_kpi(
    date_from: str = Query(...),
    date_to:   str = Query(...),
    stores:    Optional[str] = Query(None),
    vendors:   Optional[str] = Query(None),
    status:    Optional[str] = Query(None),
):
    base = _pur_base(date_from, date_to, stores, vendors, status)
    rows = _q(f"""
        SELECT
            COUNT(DISTINCT FP.VOU_SID)                          AS vou_count,
            COUNT(DISTINCT FP.VEND_SID)                         AS vendor_count,
            COUNT(DISTINCT FP.STORE_SID)                        AS store_count,
            ROUND(COALESCE(SUM(FP.VOU_TOTAL),    0), 2)         AS total_cost,
            ROUND(COALESCE(SUM(FP.VOU_SUBTOTAL), 0), 2)         AS subtotal,
            ROUND(COALESCE(SUM(FP.DISC_AMT),     0), 2)         AS total_disc,
            ROUND(COALESCE(SUM(FP.ORD_QTY),      0), 0)         AS ord_qty,
            ROUND(COALESCE(SUM(FP.RECV_QTY),     0), 0)         AS recv_qty,
            ROUND(COALESCE(SUM(FP.LINE_COUNT),   0), 0)         AS line_count,
            COUNT(CASE WHEN FP.STATUS = 4 THEN 1 END)           AS received_count,
            COUNT(CASE WHEN FP.STATUS = 3 THEN 1 END)           AS pending_count
        {base}
    """)
    r = rows[0]
    total = float(r[0] or 0)
    recv  = float(r[9] or 0)
    return {
        "vou_count":      int(r[0] or 0),
        "vendor_count":   int(r[1] or 0),
        "store_count":    int(r[2] or 0),
        "total_cost":     float(r[3] or 0),
        "subtotal":       float(r[4] or 0),
        "total_disc":     float(r[5] or 0),
        "ord_qty":        float(r[6] or 0),
        "recv_qty":       float(r[7] or 0),
        "line_count":     int(r[8] or 0),
        "received_count": int(r[9] or 0),
        "pending_count":  int(r[10] or 0),
        "recv_pct":       round(recv / total * 100, 1) if total > 0 else 0,
    }


# ── Daily trend ────────────────────────────────────────────────────────────────

@router.get("/api/purchases/trend")
def purchases_trend(
    date_from: str = Query(...),
    date_to:   str = Query(...),
    stores:    Optional[str] = Query(None),
    vendors:   Optional[str] = Query(None),
    status:    Optional[str] = Query(None),
):
    base = _pur_base(date_from, date_to, stores, vendors, status)
    return _qdf(f"""
        SELECT
            FP.VOU_DATE                          AS vou_date,
            COUNT(DISTINCT FP.VOU_SID)           AS vou_count,
            ROUND(SUM(FP.VOU_TOTAL), 2)          AS total_cost,
            ROUND(SUM(FP.RECV_QTY), 0)           AS recv_qty,
            ROUND(SUM(FP.ORD_QTY),  0)           AS ord_qty
        {base}
        GROUP BY FP.VOU_DATE
        ORDER BY FP.VOU_DATE
    """)


# ── By Vendor ──────────────────────────────────────────────────────────────────

@router.get("/api/purchases/by-vendor")
def purchases_by_vendor(
    date_from: str = Query(...),
    date_to:   str = Query(...),
    stores:    Optional[str] = Query(None),
    vendors:   Optional[str] = Query(None),
    status:    Optional[str] = Query(None),
    limit:     int = Query(15),
):
    base = _pur_base(date_from, date_to, stores, vendors, status)
    return _qdf(f"""
        SELECT
            COALESCE(V.VEND_NAME, '(Unknown)')   AS vendor_name,
            COUNT(DISTINCT FP.VOU_SID)            AS vou_count,
            ROUND(SUM(FP.VOU_TOTAL), 2)           AS total_cost,
            ROUND(SUM(FP.RECV_QTY), 0)            AS recv_qty,
            ROUND(SUM(FP.ORD_QTY),  0)            AS ord_qty,
            ROUND(SUM(FP.LINE_COUNT), 0)          AS line_count
        {base}
        GROUP BY V.VEND_NAME
        ORDER BY total_cost DESC
        LIMIT {limit}
    """)


# ── By Department ──────────────────────────────────────────────────────────────

@router.get("/api/purchases/by-dept")
def purchases_by_dept(
    date_from: str = Query(...),
    date_to:   str = Query(...),
    stores:    Optional[str] = Query(None),
    vendors:   Optional[str] = Query(None),
    limit:     int = Query(15),
):
    base = _pur_items_base(date_from, date_to, stores, vendors)
    return _qdf(f"""
        SELECT
            COALESCE(DC.D_NAME, '(Unknown)')     AS department,
            COUNT(DISTINCT FPI.VOU_SID)           AS vou_count,
            COUNT(DISTINCT FPI.ITEM_SID)          AS sku_count,
            ROUND(SUM(FPI.RECV_QTY), 0)           AS recv_qty,
            ROUND(SUM(FPI.TOTAL_COST), 2)         AS total_cost,
            ROUND(SUM(FPI.TOTAL_RETAIL), 2)       AS total_retail
        {base}
        GROUP BY DC.D_NAME
        ORDER BY total_cost DESC
        LIMIT {limit}
    """)


# ── By Store ───────────────────────────────────────────────────────────────────

@router.get("/api/purchases/by-store")
def purchases_by_store(
    date_from: str = Query(...),
    date_to:   str = Query(...),
    stores:    Optional[str] = Query(None),
    vendors:   Optional[str] = Query(None),
    status:    Optional[str] = Query(None),
):
    base = _pur_base(date_from, date_to, stores, vendors, status)
    return _qdf(f"""
        SELECT
            COALESCE(S.STORE_NAME, '(Unknown)')  AS store_name,
            COUNT(DISTINCT FP.VOU_SID)            AS vou_count,
            ROUND(SUM(FP.VOU_TOTAL), 2)           AS total_cost,
            ROUND(SUM(FP.RECV_QTY), 0)            AS recv_qty,
            ROUND(SUM(FP.ORD_QTY),  0)            AS ord_qty
        {base}
        GROUP BY S.STORE_NAME
        ORDER BY total_cost DESC
    """)


# ── By Status ──────────────────────────────────────────────────────────────────

@router.get("/api/purchases/by-status")
def purchases_by_status(
    date_from: str = Query(...),
    date_to:   str = Query(...),
    stores:    Optional[str] = Query(None),
    vendors:   Optional[str] = Query(None),
):
    sf = _store_filter(stores, alias="S")
    vf = _vendor_filter(vendors, alias="V")
    status_lbl = _status_label()
    return _qdf(f"""
        SELECT
            {status_lbl}                         AS status_label,
            FP.STATUS,
            COUNT(DISTINCT FP.VOU_SID)            AS vou_count,
            ROUND(SUM(FP.VOU_TOTAL), 2)           AS total_cost,
            ROUND(SUM(FP.RECV_QTY), 0)            AS recv_qty
        FROM FACT_PURCHASES FP
        LEFT JOIN DIM_STORE  S ON S.SID = FP.STORE_SID
        LEFT JOIN DIM_VENDOR V ON V.SID = FP.VEND_SID
        WHERE FP.VOU_DATE BETWEEN '{date_from}' AND '{date_to}' {sf} {vf}
        GROUP BY FP.STATUS
        ORDER BY FP.STATUS
    """)


# ── Detail lines ───────────────────────────────────────────────────────────────

@router.get("/api/purchases/details")
def purchases_details(
    date_from: str = Query(...),
    date_to:   str = Query(...),
    stores:    Optional[str] = Query(None),
    vendors:   Optional[str] = Query(None),
    status:    Optional[str] = Query(None),
    limit:     int = Query(2000),
):
    sf  = _store_filter(stores, alias="S")
    vf  = _vendor_filter(vendors, alias="V")
    stf = ""
    if status == "received":
        stf = " AND FP.STATUS = 4"
    elif status == "pending":
        stf = " AND FP.STATUS = 3"

    status_lbl = _status_label(alias="FP")
    return _qdf(f"""
        SELECT
            FP.VOU_DATE                                 AS vou_date,
            FP.VOU_NO                                   AS vou_no,
            {status_lbl}                                AS status_label,
            COALESCE(S.STORE_NAME,  '(Unknown)')        AS store_name,
            COALESCE(V.VEND_NAME,   '(Unknown)')        AS vendor_name,
            COALESCE(DC.D_NAME,     '(Unknown)')        AS department,
            I.ALU                                       AS alu,
            I.DESCRIPTION1                              AS description1,
            ROUND(FPI.ORD_QTY,   0)                    AS ord_qty,
            ROUND(FPI.RECV_QTY,  0)                    AS recv_qty,
            ROUND(FPI.UNIT_COST, 4)                    AS unit_cost,
            ROUND(FPI.UNIT_PRICE,4)                    AS unit_price,
            ROUND(FPI.DISC_AMT,  2)                    AS disc_amt,
            ROUND(FPI.TOTAL_COST,   2)                 AS total_cost,
            ROUND(FPI.TOTAL_RETAIL, 2)                 AS total_retail
        FROM FACT_PURCHASE_ITEMS FPI
        LEFT JOIN FACT_PURCHASES FP ON FP.VOU_SID  = FPI.VOU_SID
        LEFT JOIN DIM_STORE      S  ON S.SID        = FPI.STORE_SID
        LEFT JOIN DIM_VENDOR     V  ON V.SID        = FPI.VEND_SID
        LEFT JOIN DIM_ITEM       I  ON I.SID        = FPI.ITEM_SID
        LEFT JOIN DIM_DCS        DC ON DC.SID       = I.DCS_SID
        WHERE FPI.VOU_DATE BETWEEN '{date_from}' AND '{date_to}' {sf} {vf} {stf}
        ORDER BY FPI.VOU_DATE DESC, FP.VOU_NO
        LIMIT {limit}
    """)


# ── Vendor list (for filter dropdown) ─────────────────────────────────────────

@router.get("/api/purchases/vendors-list")
def purchases_vendors_list():
    return _qdf("""
        SELECT DISTINCT V.VEND_NAME
        FROM FACT_PURCHASES FP
        LEFT JOIN DIM_VENDOR V ON V.SID = FP.VEND_SID
        WHERE V.VEND_NAME IS NOT NULL
        ORDER BY V.VEND_NAME
    """)
