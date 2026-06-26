"""
Inventory Router
================
Endpoints:
  GET /api/stores                       — Store name list (for filters)

  GET /api/inventory/overview           — Stock KPIs (snapshot from FACT_INVENTORY)
  GET /api/inventory/by-dept            — Stock by department
  GET /api/inventory/by-dcs             — Stock DCS hierarchy (dept > class > subclass)
  GET /api/inventory/by-vendor          — Top vendors by stock value
  GET /api/inventory/by-store           — Per-store stock breakdown
  GET /api/inventory/items              — Item-level stock (group_by=dept|dcs|vendor|store|item)
  GET /api/inventory/movement           — Velocity KPIs from FACT_SALES_ITEMS (date-filtered)
  GET /api/inventory/trend              — Daily movement trend
  GET /api/inventory/movement-by        — Velocity grouped (group_by=dept|dcs|vendor|store|item)

  GET /api/inventory/transfers/kpi      — Transfer KPIs
  GET /api/inventory/transfers/trend    — Daily transfer trend
  GET /api/inventory/transfers/by-store — Transfers by sending/receiving store
  GET /api/inventory/transfers/by-dept  — Transfers by department
  GET /api/inventory/transfers/details  — Line-level transfer details

  GET /api/inventory/adjustments/kpi      — Adjustment KPIs
  GET /api/inventory/adjustments/trend    — Daily adjustment trend
  GET /api/inventory/adjustments/by-type  — By creation type
  GET /api/inventory/adjustments/by-store — By store
  GET /api/inventory/adjustments/details  — Line-level adjustment details
"""
import threading
from typing import Optional
from fastapi import APIRouter, Query
from db.model import get_db

router = APIRouter(tags=["inventory"])
_db_lock = threading.Lock()


# ── Helpers ────────────────────────────────────────────────────────────────────

def _store_filter(stores: Optional[str], alias: str = "S") -> str:
    if not stores:
        return ""
    names = [f"'{s.strip().replace(chr(39), chr(39)*2)}'"
             for s in stores.split(",") if s.strip()]
    return f" AND {alias}.STORE_NAME IN ({','.join(names)})" if names else ""


def _qdf(sql: str) -> list[dict]:
    with _db_lock:
        con  = get_db()
        rel  = con.execute(sql)
        cols = [d[0] for d in rel.description]
        return [dict(zip(cols, row)) for row in rel.fetchall()]


def _q(sql: str):
    with _db_lock:
        return get_db().execute(sql).fetchall()


# ── Stores list ────────────────────────────────────────────────────────────────

@router.get("/api/stores")
def list_stores():
    """Return all store names for filter dropdowns."""
    return _qdf("SELECT STORE_NAME FROM DIM_STORE ORDER BY STORE_NAME")


# ── Stock snapshot base (FACT_INVENTORY) ──────────────────────────────────────

def _inv_base_join(sf: str) -> str:
    """FROM + JOINs for inventory snapshot queries, with optional store filter."""
    store_join = "LEFT JOIN DIM_STORE S ON S.SID = FI.STORE_SID" if sf else ""
    return f"""
        FROM FACT_INVENTORY FI
        LEFT JOIN DIM_ITEM    I  ON I.SID   = FI.ITEM_SID
        LEFT JOIN DIM_DCS     D  ON D.SID   = I.DCS_SID
        LEFT JOIN DIM_VENDOR  V  ON V.SID   = I.VEND_SID
        {store_join}
        WHERE FI.ON_HAND_QTY > 0 {sf}
    """


# ── Inventory Overview KPIs ────────────────────────────────────────────────────

@router.get("/api/inventory/overview")
def inventory_overview(stores: Optional[str] = Query(None)):
    sf  = _store_filter(stores)
    base = _inv_base_join(sf)
    rows = _q(f"""
        SELECT
            COUNT(DISTINCT FI.ITEM_SID)                                          AS sku_count,
            ROUND(COALESCE(SUM(FI.ON_HAND_QTY), 0), 0)                          AS total_qty,
            ROUND(COALESCE(SUM(FI.ON_HAND_QTY * FI.COST), 0), 2)               AS stock_cost,
            ROUND(COALESCE(SUM(FI.ON_HAND_QTY * FI.PRICE1), 0), 2)             AS stock_retail,
            ROUND(
                COALESCE(
                  (SUM(FI.ON_HAND_QTY * FI.PRICE1) - SUM(FI.ON_HAND_QTY * FI.COST))
                  / NULLIF(SUM(FI.ON_HAND_QTY * FI.PRICE1), 0) * 100,
                0), 1)                                                           AS gm_pct,
            COUNT(DISTINCT D.D_NAME)                                             AS dept_count,
            COUNT(DISTINCT FI.STORE_SID)                                         AS store_count,
            COUNT(CASE WHEN FI.ON_HAND_QTY < 0 THEN 1 END)                      AS neg_stock
        {base}
    """)
    r = rows[0]
    return {
        "sku_count":    r[0] or 0,
        "total_qty":    r[1] or 0,
        "stock_cost":   r[2] or 0,
        "stock_retail": r[3] or 0,
        "gm_pct":       r[4] or 0,
        "dept_count":   r[5] or 0,
        "store_count":  r[6] or 0,
        "neg_stock":    r[7] or 0,
    }


# ── Stock by Department ────────────────────────────────────────────────────────

@router.get("/api/inventory/by-dept")
def inv_by_dept(stores: Optional[str] = Query(None)):
    sf   = _store_filter(stores)
    base = _inv_base_join(sf)
    return _qdf(f"""
        SELECT
            COALESCE(D.D_NAME, '(Unknown)') AS department,
            COUNT(DISTINCT FI.ITEM_SID)     AS sku_count,
            ROUND(SUM(FI.ON_HAND_QTY), 0)  AS total_qty,
            ROUND(SUM(FI.ON_HAND_QTY * FI.COST), 2)   AS cost_value,
            ROUND(SUM(FI.ON_HAND_QTY * FI.PRICE1), 2) AS retail_value,
            ROUND(
              (SUM(FI.ON_HAND_QTY * FI.PRICE1) - SUM(FI.ON_HAND_QTY * FI.COST))
              / NULLIF(SUM(FI.ON_HAND_QTY * FI.PRICE1), 0) * 100,
            1) AS gm_pct
        {base}
        GROUP BY D.D_NAME
        ORDER BY cost_value DESC
    """)


# ── Stock DCS Hierarchy (for sunburst) ────────────────────────────────────────

@router.get("/api/inventory/by-dcs")
def inv_by_dcs(stores: Optional[str] = Query(None), limit: int = Query(500)):
    sf   = _store_filter(stores)
    base = _inv_base_join(sf)
    return _qdf(f"""
        SELECT
            COALESCE(D.D_NAME, '(Unknown)')  AS department,
            COALESCE(D.C_NAME, '(Unknown)')  AS class,
            COALESCE(D.S_NAME, '(Unknown)')  AS subclass,
            D.DCS_CODE,
            COUNT(DISTINCT FI.ITEM_SID)      AS sku_count,
            ROUND(SUM(FI.ON_HAND_QTY), 0)   AS total_qty,
            ROUND(SUM(FI.ON_HAND_QTY * FI.COST), 2)   AS cost_value,
            ROUND(SUM(FI.ON_HAND_QTY * FI.PRICE1), 2) AS retail_value
        {base}
        GROUP BY D.D_NAME, D.C_NAME, D.S_NAME, D.DCS_CODE
        ORDER BY cost_value DESC
        LIMIT {limit}
    """)


# ── Stock by Vendor ────────────────────────────────────────────────────────────

@router.get("/api/inventory/by-vendor")
def inv_by_vendor(stores: Optional[str] = Query(None), limit: int = Query(15)):
    sf   = _store_filter(stores)
    base = _inv_base_join(sf)
    return _qdf(f"""
        SELECT
            COALESCE(V.VEND_NAME, '(Unknown)') AS vendor,
            COUNT(DISTINCT FI.ITEM_SID)        AS sku_count,
            ROUND(SUM(FI.ON_HAND_QTY), 0)     AS total_qty,
            ROUND(SUM(FI.ON_HAND_QTY * FI.COST), 2)   AS cost_value,
            ROUND(SUM(FI.ON_HAND_QTY * FI.PRICE1), 2) AS retail_value,
            ROUND(
              (SUM(FI.ON_HAND_QTY * FI.PRICE1) - SUM(FI.ON_HAND_QTY * FI.COST))
              / NULLIF(SUM(FI.ON_HAND_QTY * FI.PRICE1), 0) * 100,
            1) AS gm_pct
        {base}
        GROUP BY V.VEND_NAME
        ORDER BY cost_value DESC
        LIMIT {limit}
    """)


# ── Stock by Store ─────────────────────────────────────────────────────────────

@router.get("/api/inventory/by-store")
def inv_by_store(stores: Optional[str] = Query(None)):
    sf = _store_filter(stores)
    store_join = "LEFT JOIN DIM_STORE S ON S.SID = FI.STORE_SID" if sf else \
                 "LEFT JOIN DIM_STORE S ON S.SID = FI.STORE_SID"
    return _qdf(f"""
        SELECT
            COALESCE(S.STORE_NAME, '(Unknown)') AS store_name,
            COUNT(DISTINCT FI.ITEM_SID)          AS sku_count,
            ROUND(SUM(FI.ON_HAND_QTY), 0)       AS total_qty,
            ROUND(SUM(FI.ON_HAND_QTY * FI.COST), 2)   AS cost_value,
            ROUND(SUM(FI.ON_HAND_QTY * FI.PRICE1), 2) AS retail_value
        FROM FACT_INVENTORY FI
        LEFT JOIN DIM_ITEM   I ON I.SID = FI.ITEM_SID
        {store_join}
        WHERE FI.ON_HAND_QTY > 0 {sf}
        GROUP BY S.STORE_NAME
        ORDER BY cost_value DESC
    """)


# ── Item-level stock ───────────────────────────────────────────────────────────

@router.get("/api/inventory/items")
def inv_items(
    stores: Optional[str] = Query(None),
    group_by: str = Query("dept"),
    limit: int = Query(50),
):
    sf   = _store_filter(stores)
    base = _inv_base_join(sf)

    if group_by == "item":
        return _qdf(f"""
            SELECT
                I.ALU,
                I.UPC,
                I.DESCRIPTION1,
                V.VEND_NAME,
                D.DCS_CODE,
                ROUND(SUM(FI.ON_HAND_QTY), 0)             AS total_qty,
                ROUND(SUM(FI.ON_HAND_QTY * FI.COST), 2)   AS cost_value,
                ROUND(SUM(FI.ON_HAND_QTY * FI.PRICE1), 2) AS retail_value,
                ROUND(FI.COST, 4)     AS unit_cost,
                ROUND(FI.PRICE1, 4)   AS unit_price
            {base}
            GROUP BY I.ALU, I.UPC, I.DESCRIPTION1, V.VEND_NAME, D.DCS_CODE,
                     FI.COST, FI.PRICE1
            ORDER BY cost_value DESC
            LIMIT {limit}
        """)

    if group_by == "dcs":
        return _qdf(f"""
            SELECT
                D.DCS_CODE,
                COALESCE(D.D_NAME, '(Unknown)')  AS department,
                COALESCE(D.C_NAME, '(Unknown)')  AS class,
                COALESCE(D.S_NAME, '(Unknown)')  AS subclass,
                COUNT(DISTINCT FI.ITEM_SID)      AS sku_count,
                ROUND(SUM(FI.ON_HAND_QTY), 0)   AS total_qty,
                ROUND(SUM(FI.ON_HAND_QTY * FI.COST), 2)   AS cost_value,
                ROUND(SUM(FI.ON_HAND_QTY * FI.PRICE1), 2) AS retail_value,
                ROUND(
                  (SUM(FI.ON_HAND_QTY * FI.PRICE1) - SUM(FI.ON_HAND_QTY * FI.COST))
                  / NULLIF(SUM(FI.ON_HAND_QTY * FI.PRICE1), 0) * 100,
                1) AS gm_pct
            {base}
            GROUP BY D.DCS_CODE, D.D_NAME, D.C_NAME, D.S_NAME
            ORDER BY cost_value DESC
            LIMIT {limit}
        """)

    if group_by == "vendor":
        return _qdf(f"""
            SELECT
                COALESCE(V.VEND_NAME, '(Unknown)') AS vendor,
                COUNT(DISTINCT FI.ITEM_SID)         AS sku_count,
                ROUND(SUM(FI.ON_HAND_QTY), 0)      AS total_qty,
                ROUND(SUM(FI.ON_HAND_QTY * FI.COST), 2)   AS cost_value,
                ROUND(SUM(FI.ON_HAND_QTY * FI.PRICE1), 2) AS retail_value,
                ROUND(
                  (SUM(FI.ON_HAND_QTY * FI.PRICE1) - SUM(FI.ON_HAND_QTY * FI.COST))
                  / NULLIF(SUM(FI.ON_HAND_QTY * FI.PRICE1), 0) * 100,
                1) AS gm_pct
            {base}
            GROUP BY V.VEND_NAME
            ORDER BY cost_value DESC
            LIMIT {limit}
        """)

    if group_by == "store":
        return _qdf(f"""
            SELECT
                COALESCE(S.STORE_NAME, '(Unknown)') AS store_name,
                COUNT(DISTINCT FI.ITEM_SID)          AS sku_count,
                ROUND(SUM(FI.ON_HAND_QTY), 0)       AS total_qty,
                ROUND(SUM(FI.ON_HAND_QTY * FI.COST), 2)   AS cost_value,
                ROUND(SUM(FI.ON_HAND_QTY * FI.PRICE1), 2) AS retail_value
            {base}
            GROUP BY S.STORE_NAME
            ORDER BY cost_value DESC
            LIMIT {limit}
        """)

    # default: by department
    return _qdf(f"""
        SELECT
            COALESCE(D.D_NAME, '(Unknown)') AS department,
            COUNT(DISTINCT FI.ITEM_SID)     AS sku_count,
            ROUND(SUM(FI.ON_HAND_QTY), 0)  AS total_qty,
            ROUND(SUM(FI.ON_HAND_QTY * FI.COST), 2)   AS cost_value,
            ROUND(SUM(FI.ON_HAND_QTY * FI.PRICE1), 2) AS retail_value,
            ROUND(
              (SUM(FI.ON_HAND_QTY * FI.PRICE1) - SUM(FI.ON_HAND_QTY * FI.COST))
              / NULLIF(SUM(FI.ON_HAND_QTY * FI.PRICE1), 0) * 100,
            1) AS gm_pct
        {base}
        GROUP BY D.D_NAME
        ORDER BY cost_value DESC
        LIMIT {limit}
    """)


# ── Movement KPIs (from FACT_SALES_ITEMS) ─────────────────────────────────────

def _mv_base(df: str, dt: str, stores: Optional[str]) -> str:
    sf = _store_filter(stores, alias="S")
    store_join = "LEFT JOIN DIM_STORE S ON S.SID = F.STORE_SID" if sf else ""
    return f"""
        FROM FACT_SALES_ITEMS F
        LEFT JOIN DIM_ITEM   I ON I.SID  = F.ITEM_SID
        LEFT JOIN DIM_DCS    D ON D.SID  = I.DCS_SID
        LEFT JOIN DIM_VENDOR V ON V.SID  = I.VEND_SID
        {store_join}
        WHERE F.INVC_POST_DATE::DATE BETWEEN '{df}' AND '{dt}' {sf}
    """


@router.get("/api/inventory/movement")
def inv_movement(
    date_from: str = Query(...),
    date_to:   str = Query(...),
    stores: Optional[str] = Query(None),
):
    base = _mv_base(date_from, date_to, stores)
    rows = _q(f"""
        SELECT
            COUNT(DISTINCT F.ITEM_SID)                                               AS sku_count,
            ROUND(COALESCE(SUM(CASE WHEN F.ITEM_TYPE='Sale'   THEN  F.QTY ELSE 0 END), 0), 0) AS sold_qty,
            ROUND(COALESCE(SUM(CASE WHEN F.ITEM_TYPE='Return' THEN -F.QTY ELSE 0 END), 0), 0) AS return_qty,
            ROUND(COALESCE(SUM(F.QTY), 0), 0)                                        AS net_qty,
            ROUND(COALESCE(SUM(F.TOTAL_PRICE_WOTAX), 0), 2)                          AS revenue,
            ROUND(COALESCE(SUM(F.TOTAL_COST), 0), 2)                                 AS cogs,
            ROUND(COALESCE(
              (SUM(F.TOTAL_PRICE_WOTAX) - SUM(F.TOTAL_COST))
              / NULLIF(SUM(F.TOTAL_PRICE_WOTAX), 0) * 100, 0), 1)                   AS gm_pct
        {base}
    """)
    r = rows[0]
    days = max(1, (
        __import__('datetime').date.fromisoformat(date_to) -
        __import__('datetime').date.fromisoformat(date_from)
    ).days + 1)
    sold_qty = float(r[1] or 0)
    return {
        "sku_count":     r[0] or 0,
        "sold_qty":      sold_qty,
        "return_qty":    float(r[2] or 0),
        "net_qty":       float(r[3] or 0),
        "revenue":       float(r[4] or 0),
        "cogs":          float(r[5] or 0),
        "gm_pct":        float(r[6] or 0),
        "daily_velocity": round(sold_qty / days, 1),
    }


# ── Movement trend ─────────────────────────────────────────────────────────────

@router.get("/api/inventory/trend")
def inv_trend(
    date_from: str = Query(...),
    date_to:   str = Query(...),
    stores: Optional[str] = Query(None),
):
    sf = _store_filter(stores, alias="S")
    store_join = "LEFT JOIN DIM_STORE S ON S.SID = F.STORE_SID" if sf else ""
    return _qdf(f"""
        SELECT
            F.INVC_POST_DATE::DATE                                               AS post_date,
            ROUND(SUM(CASE WHEN F.ITEM_TYPE='Sale'   THEN  F.QTY ELSE 0 END), 0) AS sold_qty,
            ROUND(SUM(CASE WHEN F.ITEM_TYPE='Return' THEN -F.QTY ELSE 0 END), 0) AS return_qty,
            ROUND(SUM(F.TOTAL_PRICE_WOTAX), 2)                                   AS revenue
        FROM FACT_SALES_ITEMS F
        {store_join}
        WHERE F.INVC_POST_DATE::DATE BETWEEN '{date_from}' AND '{date_to}' {sf}
        GROUP BY F.INVC_POST_DATE::DATE
        ORDER BY post_date
    """)


# ── Movement grouped by dimension ─────────────────────────────────────────────

@router.get("/api/inventory/movement-by")
def inv_movement_by(
    date_from: str = Query(...),
    date_to:   str = Query(...),
    stores: Optional[str] = Query(None),
    group_by: str = Query("dept"),
    limit: int = Query(50),
):
    base = _mv_base(date_from, date_to, stores)

    if group_by == "item":
        return _qdf(f"""
            SELECT
                I.ALU,
                I.UPC,
                I.DESCRIPTION1,
                V.VEND_NAME,
                D.DCS_CODE,
                ROUND(SUM(CASE WHEN F.ITEM_TYPE='Sale'   THEN  F.QTY ELSE 0 END), 0) AS sold_qty,
                ROUND(SUM(CASE WHEN F.ITEM_TYPE='Return' THEN -F.QTY ELSE 0 END), 0) AS return_qty,
                ROUND(SUM(F.QTY), 0)                            AS net_qty,
                ROUND(SUM(F.TOTAL_PRICE_WOTAX), 2)             AS revenue,
                ROUND(SUM(F.TOTAL_COST), 2)                    AS cogs,
                ROUND(
                  (SUM(F.TOTAL_PRICE_WOTAX) - SUM(F.TOTAL_COST))
                  / NULLIF(SUM(F.TOTAL_PRICE_WOTAX), 0) * 100,
                1) AS gm_pct
            {base}
            GROUP BY I.ALU, I.UPC, I.DESCRIPTION1, V.VEND_NAME, D.DCS_CODE
            ORDER BY revenue DESC
            LIMIT {limit}
        """)

    if group_by == "dcs":
        return _qdf(f"""
            SELECT
                D.DCS_CODE,
                COALESCE(D.D_NAME, '(Unknown)') AS department,
                COALESCE(D.C_NAME, '(Unknown)') AS class,
                COALESCE(D.S_NAME, '(Unknown)') AS subclass,
                COUNT(DISTINCT F.ITEM_SID)       AS sku_count,
                ROUND(SUM(CASE WHEN F.ITEM_TYPE='Sale'   THEN  F.QTY ELSE 0 END), 0) AS sold_qty,
                ROUND(SUM(CASE WHEN F.ITEM_TYPE='Return' THEN -F.QTY ELSE 0 END), 0) AS return_qty,
                ROUND(SUM(F.TOTAL_PRICE_WOTAX), 2) AS revenue,
                ROUND(SUM(F.TOTAL_COST), 2)        AS cogs,
                ROUND(
                  (SUM(F.TOTAL_PRICE_WOTAX) - SUM(F.TOTAL_COST))
                  / NULLIF(SUM(F.TOTAL_PRICE_WOTAX), 0) * 100,
                1) AS gm_pct
            {base}
            GROUP BY D.DCS_CODE, D.D_NAME, D.C_NAME, D.S_NAME
            ORDER BY revenue DESC
            LIMIT {limit}
        """)

    if group_by == "vendor":
        return _qdf(f"""
            SELECT
                COALESCE(V.VEND_NAME, '(Unknown)') AS vendor,
                COUNT(DISTINCT F.ITEM_SID)          AS sku_count,
                ROUND(SUM(CASE WHEN F.ITEM_TYPE='Sale'   THEN  F.QTY ELSE 0 END), 0) AS sold_qty,
                ROUND(SUM(CASE WHEN F.ITEM_TYPE='Return' THEN -F.QTY ELSE 0 END), 0) AS return_qty,
                ROUND(SUM(F.TOTAL_PRICE_WOTAX), 2) AS revenue,
                ROUND(SUM(F.TOTAL_COST), 2)        AS cogs,
                ROUND(
                  (SUM(F.TOTAL_PRICE_WOTAX) - SUM(F.TOTAL_COST))
                  / NULLIF(SUM(F.TOTAL_PRICE_WOTAX), 0) * 100,
                1) AS gm_pct
            {base}
            GROUP BY V.VEND_NAME
            ORDER BY revenue DESC
            LIMIT {limit}
        """)

    if group_by == "store":
        sf2 = _store_filter(stores, alias="S")
        return _qdf(f"""
            SELECT
                COALESCE(S.STORE_NAME, '(Unknown)') AS store_name,
                COUNT(DISTINCT F.ITEM_SID)           AS sku_count,
                ROUND(SUM(CASE WHEN F.ITEM_TYPE='Sale'   THEN  F.QTY ELSE 0 END), 0) AS sold_qty,
                ROUND(SUM(CASE WHEN F.ITEM_TYPE='Return' THEN -F.QTY ELSE 0 END), 0) AS return_qty,
                ROUND(SUM(F.TOTAL_PRICE_WOTAX), 2) AS revenue
            FROM FACT_SALES_ITEMS F
            LEFT JOIN DIM_STORE S ON S.SID = F.STORE_SID
            WHERE F.INVC_POST_DATE::DATE BETWEEN '{date_from}' AND '{date_to}' {sf2}
            GROUP BY S.STORE_NAME
            ORDER BY revenue DESC
            LIMIT {limit}
        """)

    # default: by department
    return _qdf(f"""
        SELECT
            COALESCE(D.D_NAME, '(Unknown)') AS department,
            COUNT(DISTINCT F.ITEM_SID)       AS sku_count,
            ROUND(SUM(CASE WHEN F.ITEM_TYPE='Sale'   THEN  F.QTY ELSE 0 END), 0) AS sold_qty,
            ROUND(SUM(CASE WHEN F.ITEM_TYPE='Return' THEN -F.QTY ELSE 0 END), 0) AS return_qty,
            ROUND(SUM(F.TOTAL_PRICE_WOTAX), 2) AS revenue,
            ROUND(SUM(F.TOTAL_COST), 2)        AS cogs,
            ROUND(
              (SUM(F.TOTAL_PRICE_WOTAX) - SUM(F.TOTAL_COST))
              / NULLIF(SUM(F.TOTAL_PRICE_WOTAX), 0) * 100,
            1) AS gm_pct
        {base}
        GROUP BY D.D_NAME
        ORDER BY revenue DESC
        LIMIT {limit}
    """)


# ═══════════════════════════════════════════════════════════════════════════════
# TRANSFERS
# ═══════════════════════════════════════════════════════════════════════════════

def _trans_store_filter(stores: Optional[str]) -> str:
    """Store filter that matches either the OUT or IN store of a transfer."""
    if not stores:
        return ""
    names = [f"'{s.strip().replace(chr(39), chr(39)*2)}'"
             for s in stores.split(",") if s.strip()]
    if not names:
        return ""
    n = ','.join(names)
    return f" AND (DS_OUT.STORE_NAME IN ({n}) OR DS_IN.STORE_NAME IN ({n}))"


def _trans_base(df: str, dt: str, stores: Optional[str]) -> str:
    sf = _trans_store_filter(stores)
    return f"""
        FROM FACT_TRANSFERS FT
        LEFT JOIN DIM_STORE  DS_OUT ON DS_OUT.SID = FT.OUT_STORE_SID
        LEFT JOIN DIM_STORE  DS_IN  ON DS_IN.SID  = FT.IN_STORE_SID
        LEFT JOIN DIM_ITEM   I      ON I.SID       = FT.ITEM_SID
        LEFT JOIN DIM_DCS    DC     ON DC.SID      = I.DCS_SID
        LEFT JOIN DIM_VENDOR V      ON V.SID       = I.VEND_SID
        WHERE FT.SLIP_DATE BETWEEN '{df}' AND '{dt}' {sf}
    """


def _vou_status_label() -> str:
    return """CASE FT.VOU_STATUS
        WHEN 1 THEN 'Changed'
        WHEN 2 THEN 'Cancelled'
        WHEN 3 THEN 'Pending'
        WHEN 4 THEN 'Received'
        ELSE 'Unknown' END"""


@router.get("/api/inventory/transfers/kpi")
def transfers_kpi(
    date_from: str = Query(...),
    date_to:   str = Query(...),
    stores:    Optional[str] = Query(None),
):
    base = _trans_base(date_from, date_to, stores)
    rows = _q(f"""
        SELECT
            COUNT(DISTINCT FT.SLIP_SID)                           AS total_slips,
            COUNT(*)                                               AS total_lines,
            ROUND(COALESCE(SUM(FT.SENT_QTY), 0), 0)              AS total_sent_qty,
            ROUND(COALESCE(SUM(FT.RECV_QTY), 0), 0)              AS total_recv_qty,
            ROUND(COALESCE(SUM(FT.TOTAL_COST), 0), 2)            AS total_cost,
            COUNT(DISTINCT CASE WHEN FT.VOU_STATUS = 3 THEN FT.SLIP_SID END) AS pending_slips,
            COUNT(DISTINCT CASE WHEN FT.VOU_STATUS = 4 THEN FT.SLIP_SID END) AS received_slips
        {base}
    """)
    r = rows[0]
    total = float(r[0] or 0)
    recv  = float(r[6] or 0)
    return {
        "total_slips":    int(r[0] or 0),
        "total_lines":    int(r[1] or 0),
        "total_sent_qty": float(r[2] or 0),
        "total_recv_qty": float(r[3] or 0),
        "total_cost":     float(r[4] or 0),
        "pending_slips":  int(r[5] or 0),
        "received_slips": int(r[6] or 0),
        "recv_pct":       round(recv / total * 100, 1) if total > 0 else 0,
    }


@router.get("/api/inventory/transfers/trend")
def transfers_trend(
    date_from: str = Query(...),
    date_to:   str = Query(...),
    stores:    Optional[str] = Query(None),
):
    base = _trans_base(date_from, date_to, stores)
    return _qdf(f"""
        SELECT
            FT.SLIP_DATE                                AS slip_date,
            COUNT(DISTINCT FT.SLIP_SID)                 AS slip_count,
            ROUND(SUM(FT.SENT_QTY), 0)                 AS sent_qty,
            ROUND(SUM(FT.RECV_QTY), 0)                 AS recv_qty,
            ROUND(SUM(FT.TOTAL_COST), 2)               AS total_cost
        {base}
        GROUP BY FT.SLIP_DATE
        ORDER BY FT.SLIP_DATE
    """)


@router.get("/api/inventory/transfers/by-store")
def transfers_by_store(
    date_from:  str = Query(...),
    date_to:    str = Query(...),
    stores:     Optional[str] = Query(None),
    direction:  str = Query("out"),
    limit:      int = Query(15),
):
    base = _trans_base(date_from, date_to, stores)
    store_col = "DS_OUT.STORE_NAME" if direction == "out" else "DS_IN.STORE_NAME"
    return _qdf(f"""
        SELECT
            COALESCE({store_col}, '(Unknown)') AS store_name,
            COUNT(DISTINCT FT.SLIP_SID)         AS slip_count,
            ROUND(SUM(FT.SENT_QTY), 0)          AS sent_qty,
            ROUND(SUM(FT.RECV_QTY), 0)          AS recv_qty,
            ROUND(SUM(FT.TOTAL_COST), 2)        AS total_cost
        {base}
        GROUP BY {store_col}
        ORDER BY total_cost DESC
        LIMIT {limit}
    """)


@router.get("/api/inventory/transfers/by-dept")
def transfers_by_dept(
    date_from: str = Query(...),
    date_to:   str = Query(...),
    stores:    Optional[str] = Query(None),
    limit:     int = Query(20),
):
    base = _trans_base(date_from, date_to, stores)
    return _qdf(f"""
        SELECT
            COALESCE(DC.D_NAME, '(Unknown)') AS department,
            COUNT(DISTINCT FT.SLIP_SID)       AS slip_count,
            ROUND(SUM(FT.SENT_QTY), 0)        AS sent_qty,
            ROUND(SUM(FT.RECV_QTY), 0)        AS recv_qty,
            ROUND(SUM(FT.TOTAL_COST), 2)      AS total_cost
        {base}
        GROUP BY DC.D_NAME
        ORDER BY total_cost DESC
        LIMIT {limit}
    """)


@router.get("/api/inventory/transfers/details")
def transfers_details(
    date_from: str = Query(...),
    date_to:   str = Query(...),
    stores:    Optional[str] = Query(None),
    limit:     int = Query(500),
):
    base = _trans_base(date_from, date_to, stores)
    status_label = _vou_status_label()
    return _qdf(f"""
        SELECT
            FT.SLIP_NO,
            FT.SLIP_DATE,
            COALESCE(DS_OUT.STORE_NAME, '(Unknown)') AS from_store,
            COALESCE(DS_IN.STORE_NAME,  '(Unknown)') AS to_store,
            FT.VOU_NO,
            {status_label}                            AS status,
            I.ALU,
            I.DESCRIPTION1,
            COALESCE(DC.D_NAME, '')                  AS department,
            COALESCE(V.VEND_NAME, '')                AS vendor,
            ROUND(FT.SENT_QTY, 0)                   AS sent_qty,
            ROUND(FT.RECV_QTY, 0)                   AS recv_qty,
            ROUND(FT.UNIT_COST, 4)                  AS unit_cost,
            ROUND(FT.TOTAL_COST, 2)                 AS total_cost,
            ROUND(FT.TOTAL_PRICE, 2)                AS total_price
        {base}
        ORDER BY FT.SLIP_DATE DESC, FT.SLIP_NO
        LIMIT {limit}
    """)


# ═══════════════════════════════════════════════════════════════════════════════
# ADJUSTMENTS
# ═══════════════════════════════════════════════════════════════════════════════

def _adj_store_filter(stores: Optional[str]) -> str:
    return _store_filter(stores, alias="S")


def _adj_base(df: str, dt: str, stores: Optional[str]) -> str:
    sf = _adj_store_filter(stores)
    store_join = "LEFT JOIN DIM_STORE S ON S.SID = FA.STORE_SID" if sf else \
                 "LEFT JOIN DIM_STORE S ON S.SID = FA.STORE_SID"
    return f"""
        FROM FACT_ADJUSTMENTS FA
        {store_join}
        LEFT JOIN DIM_EMPLOYEE E  ON E.SID  = FA.EMPLOYEE_SID
        LEFT JOIN DIM_ITEM     I  ON I.SID  = FA.ITEM_SID
        LEFT JOIN DIM_DCS      DC ON DC.SID = I.DCS_SID
        LEFT JOIN DIM_VENDOR   V  ON V.SID  = I.VEND_SID
        WHERE FA.ADJ_DATE BETWEEN '{df}' AND '{dt}' {sf}
    """


def _doc_type_label() -> str:
    return """CASE FA.DOC_TYPE
        WHEN 0  THEN 'None'
        WHEN 1  THEN 'Physical Inv.'
        WHEN 2  THEN 'Cost Overwrite'
        WHEN 3  THEN 'Markdown'
        WHEN 4  THEN 'Cleanup'
        WHEN 5  THEN 'Planned Pricing'
        WHEN 6  THEN 'Planned Markdown'
        WHEN 7  THEN 'Inventory'
        WHEN 8  THEN 'Manual'
        WHEN 9  THEN 'Reversing'
        WHEN 10 THEN 'Cost Leave'
        WHEN 11 THEN 'Audit'
        WHEN 12 THEN 'Corporate'
        WHEN 13 THEN 'Kit'
        WHEN 14 THEN 'Unverified Slip'
        ELSE 'Other' END"""


@router.get("/api/inventory/adjustments/kpi")
def adjustments_kpi(
    date_from: str = Query(...),
    date_to:   str = Query(...),
    stores:    Optional[str] = Query(None),
):
    base = _adj_base(date_from, date_to, stores)
    rows = _q(f"""
        SELECT
            COUNT(DISTINCT FA.ADJ_SID)                                     AS total_adjs,
            COUNT(*)                                                        AS total_lines,
            ROUND(COALESCE(SUM(FA.QTY_DIFF), 0), 0)                       AS net_qty,
            ROUND(COALESCE(SUM(CASE WHEN FA.QTY_DIFF > 0 THEN FA.QTY_DIFF ELSE 0 END), 0), 0) AS pos_qty,
            ROUND(COALESCE(SUM(CASE WHEN FA.QTY_DIFF < 0 THEN FA.QTY_DIFF ELSE 0 END), 0), 0) AS neg_qty,
            ROUND(COALESCE(SUM(FA.COST_DIFF), 0), 2)                      AS net_cost,
            ROUND(COALESCE(SUM(CASE WHEN FA.COST_DIFF > 0 THEN FA.COST_DIFF ELSE 0 END), 0), 2) AS pos_cost,
            ROUND(COALESCE(SUM(CASE WHEN FA.COST_DIFF < 0 THEN FA.COST_DIFF ELSE 0 END), 0), 2) AS neg_cost
        {base}
    """)
    r = rows[0]
    return {
        "total_adjs":  int(r[0] or 0),
        "total_lines": int(r[1] or 0),
        "net_qty":     float(r[2] or 0),
        "pos_qty":     float(r[3] or 0),
        "neg_qty":     float(r[4] or 0),
        "net_cost":    float(r[5] or 0),
        "pos_cost":    float(r[6] or 0),
        "neg_cost":    float(r[7] or 0),
    }


@router.get("/api/inventory/adjustments/trend")
def adjustments_trend(
    date_from: str = Query(...),
    date_to:   str = Query(...),
    stores:    Optional[str] = Query(None),
):
    base = _adj_base(date_from, date_to, stores)
    return _qdf(f"""
        SELECT
            FA.ADJ_DATE,
            COUNT(DISTINCT FA.ADJ_SID)                                           AS adj_count,
            ROUND(SUM(CASE WHEN FA.QTY_DIFF > 0 THEN FA.QTY_DIFF ELSE 0 END), 0) AS pos_qty,
            ROUND(SUM(CASE WHEN FA.QTY_DIFF < 0 THEN FA.QTY_DIFF ELSE 0 END), 0) AS neg_qty,
            ROUND(SUM(FA.QTY_DIFF), 0)                                           AS net_qty,
            ROUND(SUM(FA.COST_DIFF), 2)                                          AS net_cost
        {base}
        GROUP BY FA.ADJ_DATE
        ORDER BY FA.ADJ_DATE
    """)


@router.get("/api/inventory/adjustments/by-type")
def adjustments_by_type(
    date_from: str = Query(...),
    date_to:   str = Query(...),
    stores:    Optional[str] = Query(None),
):
    base = _adj_base(date_from, date_to, stores)
    doc_lbl = _doc_type_label()
    return _qdf(f"""
        SELECT
            {doc_lbl}                                   AS doc_type,
            COUNT(DISTINCT FA.ADJ_SID)                  AS adj_count,
            COUNT(*)                                     AS line_count,
            ROUND(SUM(FA.QTY_DIFF), 0)                  AS net_qty,
            ROUND(SUM(FA.COST_DIFF), 2)                 AS net_cost,
            ROUND(SUM(CASE WHEN FA.QTY_DIFF > 0 THEN FA.QTY_DIFF ELSE 0 END), 0)   AS pos_qty,
            ROUND(SUM(CASE WHEN FA.QTY_DIFF < 0 THEN FA.QTY_DIFF ELSE 0 END), 0)   AS neg_qty
        {base}
        GROUP BY FA.DOC_TYPE
        ORDER BY ABS(SUM(FA.COST_DIFF)) DESC
    """)


@router.get("/api/inventory/adjustments/by-store")
def adjustments_by_store(
    date_from: str = Query(...),
    date_to:   str = Query(...),
    stores:    Optional[str] = Query(None),
    limit:     int = Query(15),
):
    base = _adj_base(date_from, date_to, stores)
    return _qdf(f"""
        SELECT
            COALESCE(S.STORE_NAME, '(Unknown)') AS store_name,
            COUNT(DISTINCT FA.ADJ_SID)           AS adj_count,
            COUNT(*)                              AS line_count,
            ROUND(SUM(FA.QTY_DIFF), 0)           AS net_qty,
            ROUND(SUM(FA.COST_DIFF), 2)          AS net_cost,
            ROUND(SUM(CASE WHEN FA.QTY_DIFF > 0 THEN FA.QTY_DIFF ELSE 0 END), 0) AS pos_qty,
            ROUND(SUM(CASE WHEN FA.QTY_DIFF < 0 THEN FA.QTY_DIFF ELSE 0 END), 0) AS neg_qty
        {base}
        GROUP BY S.STORE_NAME
        ORDER BY ABS(SUM(FA.COST_DIFF)) DESC
        LIMIT {limit}
    """)


@router.get("/api/inventory/adjustments/details")
def adjustments_details(
    date_from: str = Query(...),
    date_to:   str = Query(...),
    stores:    Optional[str] = Query(None),
    limit:     int = Query(500),
):
    base = _adj_base(date_from, date_to, stores)
    doc_lbl = _doc_type_label()
    return _qdf(f"""
        SELECT
            FA.ADJ_NO,
            FA.ADJ_DATE,
            COALESCE(S.STORE_NAME, '(Unknown)')  AS store_name,
            COALESCE(E.FULL_NAME, '(Unknown)')   AS employee,
            {doc_lbl}                             AS doc_type,
            I.ALU,
            I.DESCRIPTION1,
            COALESCE(DC.D_NAME, '')              AS department,
            COALESCE(V.VEND_NAME, '')            AS vendor,
            ROUND(FA.ORIG_QTY, 0)               AS orig_qty,
            ROUND(FA.ADJ_QTY, 0)                AS adj_qty,
            ROUND(FA.QTY_DIFF, 0)               AS qty_diff,
            ROUND(FA.UNIT_COST, 4)              AS unit_cost,
            ROUND(FA.COST_DIFF, 2)              AS cost_diff
        {base}
        ORDER BY FA.ADJ_DATE DESC, FA.ADJ_NO
        LIMIT {limit}
    """)
