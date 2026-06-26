"""
Inventory Router
================
Endpoints:
  GET /api/inventory/overview     — Stock KPIs (snapshot from FACT_INVENTORY)
  GET /api/inventory/by-dept      — Stock by department
  GET /api/inventory/by-dcs       — Stock DCS hierarchy (dept > class > subclass)
  GET /api/inventory/by-vendor    — Top vendors by stock value
  GET /api/inventory/by-store     — Per-store stock breakdown
  GET /api/inventory/items        — Item-level stock (group_by=dept|dcs|vendor|store|item)
  GET /api/inventory/movement     — Velocity KPIs from FACT_SALES_ITEMS (date-filtered)
  GET /api/inventory/trend        — Daily movement trend
  GET /api/inventory/movement-by  — Velocity grouped (group_by=dept|dcs|vendor|store|item)
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
