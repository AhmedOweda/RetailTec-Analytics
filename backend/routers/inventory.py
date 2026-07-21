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

Security: all SQL uses bound parameters or type-safe values (EXPERT_REVIEW.md C2);
store access is scoped to the JWT `stores` claim via `scoped_stores` (C1).
"""
from datetime import date, datetime, timedelta
from typing import Optional
from fastapi import APIRouter, Depends, Query

from db.model import (feature_available, feature_reason,
                      FEATURE_INVENTORY_HISTORY)
from routers.common import (csv_in, q as _q, qdf as _qdf, scoped_stores,
                            store_filter, trans_store_filter, item_fields_sql,
                            scoped_subsidiaries, subsidiary_filter,
                            trans_subsidiary_filter)

router = APIRouter(tags=["inventory"])


# ── Optional customisation: RPS.INVENTORY_HISTORY ─────────────────────────────
# Some Prism installations do not have the qty-change trigger log, so
# FACT_INVENTORY_HISTORY is permanently empty there. Every endpoint reading it
# checks _invh_off() first and degrades: the answer is a 200 with an EMPTY
# result, never a 500 — and never a bare empty result that reads like "no
# movement in this period". Object-shaped responses carry `unavailable: true`
# plus a reason; row-list responses (which must stay plain arrays — the grids
# and report_grid.run_grid consume them positionally) return []. GET
# /api/features is the authoritative signal the UI uses to show the panel.

def _invh_off() -> bool:
    return not feature_available(FEATURE_INVENTORY_HISTORY)


def _invh_reason() -> str:
    return feature_reason(FEATURE_INVENTORY_HISTORY)


# ── Stores list ────────────────────────────────────────────────────────────────

@router.get("/api/stores")
def list_stores(stores: Optional[str] = Depends(scoped_stores)):
    """Return store names for filter dropdowns (scoped to the user's stores)."""
    sf, sp = csv_in("STORE_NAME", stores)
    return _qdf(f"SELECT STORE_NAME FROM DIM_STORE WHERE 1=1 {sf} ORDER BY STORE_NAME", sp)


# ── Stock snapshot base (FACT_INVENTORY) ──────────────────────────────────────

def _inv_base_join(sf: str, subf: str = "", onhand: str = "pos") -> str:
    """FROM + JOINs for inventory snapshot queries, with optional store filter.
    DIM_STORE is ALWAYS joined: group_by=store/item_store SELECT S.STORE_NAME
    regardless of filter (conditional join caused 500s without ?stores=).
    Subsidiary filter (subf) is applied on FACT_INVENTORY's OWN SUBSIDIARY_SID
    (alias FI, loaded from RPS.INVN_SBS_ITEM_QTY.SBS_SID). It used to route
    through DIM_STORE.SUBSIDIARY_SID, a derived column the store loader reset to
    NULL on every sync — which matched zero rows and blanked the page.

    `onhand` selects the on-hand predicate (whitelisted by the caller):
      * 'pos' (default) → ON_HAND_QTY > 0  (normal stock view / replenishment)
      * 'neg'           → ON_HAND_QTY < 0  (the Home "negative-stock rows" drill —
                          these rows were previously UNREACHABLE because this base
                          hard-filtered > 0, so no page could show them)
      * 'all'           → no on-hand filter."""
    onhand_pred = {
        "pos": "FI.ON_HAND_QTY > 0",
        "neg": "FI.ON_HAND_QTY < 0",
        "all": "1=1",
    }.get(onhand, "FI.ON_HAND_QTY > 0")
    return f"""
        FROM FACT_INVENTORY FI
        LEFT JOIN DIM_ITEM    I  ON I.SID   = FI.ITEM_SID
        LEFT JOIN DIM_DCS     D  ON D.SID   = I.DCS_SID
        LEFT JOIN DIM_VENDOR  V  ON V.SID   = I.VEND_SID
        LEFT JOIN DIM_STORE   S  ON S.SID   = FI.STORE_SID
        WHERE {onhand_pred} {sf} {subf}
    """


# ── Inventory Overview KPIs ────────────────────────────────────────────────────

@router.get("/api/inventory/overview")
def inventory_overview(stores: Optional[str] = Depends(scoped_stores),
                       subsidiaries: Optional[str] = Depends(scoped_subsidiaries)):
    sf, sp = store_filter(stores)
    subf, subp = subsidiary_filter(subsidiaries, alias="FI")
    base = _inv_base_join(sf, subf)
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
    """, sp + subp)
    if not rows:
        return {"sku_count": 0, "total_qty": 0, "stock_cost": 0, "stock_retail": 0,
                "gm_pct": 0, "dept_count": 0, "store_count": 0, "neg_stock": 0}
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


# ── Inventory Turnover KPIs ───────────────────────────────────────────────────

@router.get("/api/inventory/turnover-kpi")
def inventory_turnover_kpi(stores: Optional[str] = Depends(scoped_stores),
                           subsidiaries: Optional[str] = Depends(scoped_subsidiaries)):
    """
    Inventory Turnover = COGS (12m) / Current Stock Cost
    Days on Hand       = 365 / Turnover
    Stock-to-Sales     = Stock Cost / (COGS / 12)  (months of supply)
    """
    sf, sp   = store_filter(stores)
    subf, subp = subsidiary_filter(subsidiaries, alias="FI")
    inv_base = _inv_base_join(sf, subf)

    # Current stock cost
    stock_rows = _q(f"""
        SELECT ROUND(COALESCE(SUM(FI.ON_HAND_QTY * FI.COST), 0), 2) AS stock_cost
        {inv_base}
    """, sp + subp)
    stock_cost = float(stock_rows[0][0] or 0)

    # COGS last 365 days
    today  = datetime.utcnow().date()
    yr_ago = today - timedelta(days=365)

    sf_sales, sp_sales = csv_in("SS.STORE_NAME", stores)
    subf_sales, subp_sales = subsidiary_filter(subsidiaries, alias="FSI")

    cogs_rows = _q(f"""
        SELECT ROUND(COALESCE(SUM(FSI.TOTAL_COST), 0), 2) AS cogs_12m
        FROM FACT_SALES_ITEMS FSI
        LEFT JOIN DIM_STORE SS ON SS.SID = FSI.STORE_SID
        WHERE FSI.INVC_POST_DATE::DATE BETWEEN ? AND ?
          AND FSI.ITEM_TYPE = 'Sale'
        {sf_sales} {subf_sales}
    """, [yr_ago, today] + sp_sales + subp_sales)
    cogs_12m = float(cogs_rows[0][0] or 0)

    turnover = round(cogs_12m / stock_cost, 2) if stock_cost > 0 else 0
    days_on_hand = round(365 / turnover, 0) if turnover > 0 else 0
    months_supply = round(stock_cost / (cogs_12m / 12), 1) if cogs_12m > 0 else 0

    return {
        "stock_cost":    stock_cost,
        "cogs_12m":      cogs_12m,
        "turnover_rate": turnover,
        "days_on_hand":  days_on_hand,
        "months_supply": months_supply,
    }


# ── Stock by Department ────────────────────────────────────────────────────────

@router.get("/api/inventory/by-dept")
def inv_by_dept(stores: Optional[str] = Depends(scoped_stores),
                subsidiaries: Optional[str] = Depends(scoped_subsidiaries)):
    sf, sp = store_filter(stores)
    subf, subp = subsidiary_filter(subsidiaries, alias="FI")
    base = _inv_base_join(sf, subf)
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
    """, sp + subp)


# ── Stock DCS Hierarchy (for sunburst) ────────────────────────────────────────

@router.get("/api/inventory/by-dcs")
def inv_by_dcs(stores: Optional[str] = Depends(scoped_stores),
               subsidiaries: Optional[str] = Depends(scoped_subsidiaries),
               limit: Optional[int] = Query(None, ge=1)):   # no cap unless the caller asks
    lim = f"LIMIT {int(limit)}" if limit else ""
    sf, sp = store_filter(stores)
    subf, subp = subsidiary_filter(subsidiaries, alias="FI")
    base = _inv_base_join(sf, subf)
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
        {lim}
    """, sp + subp)


# ── Stock by Vendor ────────────────────────────────────────────────────────────

@router.get("/api/inventory/by-vendor")
def inv_by_vendor(stores: Optional[str] = Depends(scoped_stores),
                  subsidiaries: Optional[str] = Depends(scoped_subsidiaries),
                  limit: int = Query(15, ge=1, le=1000)):
    sf, sp = store_filter(stores)
    subf, subp = subsidiary_filter(subsidiaries, alias="FI")
    base = _inv_base_join(sf, subf)
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
    """, sp + subp)


# ── Stock by Store ─────────────────────────────────────────────────────────────

@router.get("/api/inventory/by-store")
def inv_by_store(stores: Optional[str] = Depends(scoped_stores),
                 subsidiaries: Optional[str] = Depends(scoped_subsidiaries)):
    sf, sp = store_filter(stores)
    subf, subp = subsidiary_filter(subsidiaries, alias="FI")
    return _qdf(f"""
        SELECT
            COALESCE(S.STORE_NAME, '(Unknown)') AS store_name,
            COUNT(DISTINCT FI.ITEM_SID)          AS sku_count,
            ROUND(SUM(FI.ON_HAND_QTY), 0)       AS total_qty,
            ROUND(SUM(FI.ON_HAND_QTY * FI.COST), 2)   AS cost_value,
            ROUND(SUM(FI.ON_HAND_QTY * FI.PRICE1), 2) AS retail_value
        FROM FACT_INVENTORY FI
        LEFT JOIN DIM_ITEM   I ON I.SID = FI.ITEM_SID
        LEFT JOIN DIM_STORE S ON S.SID = FI.STORE_SID
        WHERE FI.ON_HAND_QTY > 0 {sf} {subf}
        GROUP BY S.STORE_NAME
        ORDER BY cost_value DESC
    """, sp + subp)


# ── Item-level stock ───────────────────────────────────────────────────────────

@router.get("/api/inventory/items")
def inv_items(
    stores: Optional[str] = Depends(scoped_stores),
    subsidiaries: Optional[str] = Depends(scoped_subsidiaries),
    group_by: str = Query("dept", pattern="^(dept|dcs|vendor|store|item|item_store)$"),
    limit: Optional[int] = Query(None, ge=1),
    item_fields: Optional[str] = Query(None),   # csv of whitelisted DIM_ITEM cols
    onhand: str = Query("pos", pattern="^(pos|neg|all)$"),   # 'neg' → the Home negative-stock drill
):
    sf, sp = store_filter(stores)
    subf, subp = subsidiary_filter(subsidiaries, alias="FI")
    base = _inv_base_join(sf, subf, onhand)
    # No hardcoded cap: LIMIT applies only when the caller asks for one.
    # `limit` is validated as int by FastAPI, safe to interpolate.
    lim = f"LIMIT {int(limit)}" if limit else ""
    xf_agg  = item_fields_sql(item_fields, agg=True)
    xf_plain = item_fields_sql(item_fields)

    if group_by == "item":
        return _qdf(f"""
            SELECT
                I.ALU,
                I.UPC,
                I.DESCRIPTION1,
                COALESCE(V.VEND_NAME, '(Unknown)') AS vendor,
                COALESCE(D.DCS_CODE, '')            AS DCS_CODE,
                COALESCE(D.D_NAME,   '(Unknown)')   AS department,
                COUNT(DISTINCT FI.STORE_SID)        AS store_count,
                ROUND(SUM(FI.ON_HAND_QTY), 0)      AS total_qty,
                ROUND(SUM(FI.ON_HAND_QTY * FI.COST),   2) AS cost_value,
                ROUND(SUM(FI.ON_HAND_QTY * FI.PRICE1), 2) AS retail_value,
                ROUND(
                  (SUM(FI.ON_HAND_QTY * FI.PRICE1) - SUM(FI.ON_HAND_QTY * FI.COST))
                  / NULLIF(SUM(FI.ON_HAND_QTY * FI.PRICE1), 0) * 100,
                1) AS gm_pct,
                ROUND(AVG(FI.COST),   4) AS avg_cost,
                ROUND(AVG(FI.PRICE1), 4) AS avg_price
                {xf_agg}
            {base}
            GROUP BY I.ALU, I.UPC, I.DESCRIPTION1, V.VEND_NAME, D.DCS_CODE, D.D_NAME
            ORDER BY cost_value DESC
            {lim}
        """, sp + subp)

    if group_by == "item_store":
        return _qdf(f"""
            SELECT
                COALESCE(S.STORE_NAME, '(Unknown)') AS store_name,
                I.ALU,
                I.UPC,
                I.DESCRIPTION1,
                COALESCE(D.D_NAME, '(Unknown)')     AS department,
                ROUND(FI.ON_HAND_QTY, 0)            AS qty,
                ROUND(FI.COST,   4)  AS unit_cost,
                ROUND(FI.PRICE1, 4)  AS unit_price,
                ROUND(FI.ON_HAND_QTY * FI.COST,   2) AS cost_value,
                ROUND(FI.ON_HAND_QTY * FI.PRICE1, 2) AS retail_value,
                ROUND(
                  (FI.PRICE1 - FI.COST) / NULLIF(FI.PRICE1, 0) * 100,
                1) AS gm_pct
                {xf_plain}
            {base}
            ORDER BY cost_value DESC
            {lim}
        """, sp + subp)

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
            {lim}
        """, sp + subp)

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
            {lim}
        """, sp + subp)

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
            {lim}
        """, sp + subp)

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
        {lim}
    """, sp + subp)


# ── Movement KPIs (from FACT_SALES_ITEMS) ─────────────────────────────────────

def _mv_base(stores: Optional[str],
             subsidiaries: Optional[str] = None) -> tuple[str, list]:
    """FROM/JOIN/WHERE fragment with date placeholders; caller prepends dates.
    FACT_SALES_ITEMS now carries its OWN SUBSIDIARY_SID (from the parent
    DOCUMENT), so the subsidiary predicate rides on the fact alias F and needs
    no dimension lookup. DIM_STORE is joined ONLY for the store-name filter."""
    sf, sp = store_filter(stores, alias="S")
    subf, subp = subsidiary_filter(subsidiaries, alias="F")
    store_join = ("LEFT JOIN DIM_STORE S ON S.SID = F.STORE_SID"
                  if sf else "")
    frag = f"""
        FROM FACT_SALES_ITEMS F
        LEFT JOIN DIM_ITEM   I ON I.SID  = F.ITEM_SID
        LEFT JOIN DIM_DCS    D ON D.SID  = I.DCS_SID
        LEFT JOIN DIM_VENDOR V ON V.SID  = I.VEND_SID
        {store_join}
        WHERE F.INVC_POST_DATE::DATE BETWEEN ? AND ? {sf} {subf}
    """
    return frag, sp + subp


@router.get("/api/inventory/movement")
def inv_movement(
    date_from: date = Query(...),
    date_to:   date = Query(...),
    stores: Optional[str] = Depends(scoped_stores),
    subsidiaries: Optional[str] = Depends(scoped_subsidiaries),
):
    base, sp = _mv_base(stores, subsidiaries)
    rows = _q(f"""
        SELECT
            COUNT(DISTINCT F.ITEM_SID)                                               AS sku_count,
            ROUND(COALESCE(SUM(CASE WHEN F.ITEM_TYPE='Sale'   THEN  F.QTY ELSE 0 END), 0), 0) AS sold_qty,
            ROUND(COALESCE(SUM(CASE WHEN F.ITEM_TYPE='Return' THEN -F.QTY ELSE 0 END), 0), 0) AS return_qty,
            ROUND(COALESCE(SUM(CASE WHEN F.ITEM_TYPE='Return' THEN -F.QTY ELSE F.QTY END), 0), 0) AS net_qty,
            ROUND(COALESCE(SUM(F.TOTAL_PRICE_WOTAX), 0), 2)                          AS revenue,
            ROUND(COALESCE(SUM(F.TOTAL_COST), 0), 2)                                 AS cogs,
            ROUND(COALESCE(
              (SUM(F.TOTAL_PRICE_WOTAX) - SUM(F.TOTAL_COST))
              / NULLIF(SUM(F.TOTAL_PRICE_WOTAX), 0) * 100, 0), 1)                   AS gm_pct
        {base}
    """, [date_from, date_to] + sp)
    r = rows[0]
    days = max(1, (date_to - date_from).days + 1)
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
    date_from: date = Query(...),
    date_to:   date = Query(...),
    stores: Optional[str] = Depends(scoped_stores),
    subsidiaries: Optional[str] = Depends(scoped_subsidiaries),
):
    sf, sp = store_filter(stores, alias="S")
    subf, subp = subsidiary_filter(subsidiaries, alias="F")
    # Subsidiary is the fact's own column now; DIM_STORE is joined only when a
    # store-name filter needs it.
    store_join = ("LEFT JOIN DIM_STORE S ON S.SID = F.STORE_SID"
                  if sf else "")
    return _qdf(f"""
        SELECT
            F.INVC_POST_DATE::DATE                                               AS post_date,
            ROUND(SUM(CASE WHEN F.ITEM_TYPE='Sale'   THEN  F.QTY ELSE 0 END), 0) AS sold_qty,
            ROUND(SUM(CASE WHEN F.ITEM_TYPE='Return' THEN -F.QTY ELSE 0 END), 0) AS return_qty,
            ROUND(SUM(F.TOTAL_PRICE_WOTAX), 2)                                   AS revenue
        FROM FACT_SALES_ITEMS F
        {store_join}
        WHERE F.INVC_POST_DATE::DATE BETWEEN ? AND ? {sf} {subf}
        GROUP BY F.INVC_POST_DATE::DATE
        ORDER BY post_date
    """, [date_from, date_to] + sp + subp)


# ── Movement grouped by dimension ─────────────────────────────────────────────

@router.get("/api/inventory/movement-by")
def inv_movement_by(
    date_from: date = Query(...),
    date_to:   date = Query(...),
    stores: Optional[str] = Depends(scoped_stores),
    subsidiaries: Optional[str] = Depends(scoped_subsidiaries),
    group_by: str = Query("dept", pattern="^(dept|dcs|vendor|store|item)$"),
    limit: Optional[int] = Query(None, ge=1),   # no cap unless the caller asks
):
    lim = f"LIMIT {int(limit)}" if limit else ""
    base, sp = _mv_base(stores, subsidiaries)
    params = [date_from, date_to] + sp

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
                ROUND(SUM(CASE WHEN F.ITEM_TYPE='Return' THEN -F.QTY ELSE F.QTY END), 0) AS net_qty,
                ROUND(SUM(F.TOTAL_PRICE_WOTAX), 2)             AS revenue,
                ROUND(SUM(F.TOTAL_COST), 2)                    AS cogs,
                ROUND(
                  (SUM(F.TOTAL_PRICE_WOTAX) - SUM(F.TOTAL_COST))
                  / NULLIF(SUM(F.TOTAL_PRICE_WOTAX), 0) * 100,
                1) AS gm_pct
            {base}
            GROUP BY I.ALU, I.UPC, I.DESCRIPTION1, V.VEND_NAME, D.DCS_CODE
            ORDER BY revenue DESC
            {lim}
        """, params)

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
            {lim}
        """, params)

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
            {lim}
        """, params)

    if group_by == "store":
        sf2, sp2 = store_filter(stores, alias="S")
        subf2, subp2 = subsidiary_filter(subsidiaries, alias="F")
        return _qdf(f"""
            SELECT
                COALESCE(S.STORE_NAME, '(Unknown)') AS store_name,
                COUNT(DISTINCT F.ITEM_SID)           AS sku_count,
                ROUND(SUM(CASE WHEN F.ITEM_TYPE='Sale'   THEN  F.QTY ELSE 0 END), 0) AS sold_qty,
                ROUND(SUM(CASE WHEN F.ITEM_TYPE='Return' THEN -F.QTY ELSE 0 END), 0) AS return_qty,
                ROUND(SUM(F.TOTAL_PRICE_WOTAX), 2) AS revenue
            FROM FACT_SALES_ITEMS F
            LEFT JOIN DIM_STORE S ON S.SID = F.STORE_SID
            WHERE F.INVC_POST_DATE::DATE BETWEEN ? AND ? {sf2} {subf2}
            GROUP BY S.STORE_NAME
            ORDER BY revenue DESC
            {lim}
        """, [date_from, date_to] + sp2 + subp2)

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
        {lim}
    """, params)


# ═══════════════════════════════════════════════════════════════════════════════
# TRANSFERS
# ═══════════════════════════════════════════════════════════════════════════════

def _trans_base(stores: Optional[str],
                subsidiaries: Optional[str] = None) -> tuple[str, list]:
    """Caller prepends [date_from, date_to] to the returned params.
    Subsidiary filter matches EITHER the OUT or IN store's subsidiary (both
    DIM_STORE aliases are already joined), mirroring trans_store_filter."""
    sf, sp = trans_store_filter(stores)
    subf, subp = trans_subsidiary_filter(subsidiaries)
    frag = f"""
        FROM FACT_TRANSFERS FT
        LEFT JOIN DIM_STORE  DS_OUT ON DS_OUT.SID = FT.OUT_STORE_SID
        LEFT JOIN DIM_STORE  DS_IN  ON DS_IN.SID  = FT.IN_STORE_SID
        LEFT JOIN DIM_ITEM   I      ON I.SID       = FT.ITEM_SID
        LEFT JOIN DIM_DCS    DC     ON DC.SID      = I.DCS_SID
        LEFT JOIN DIM_VENDOR V      ON V.SID       = I.VEND_SID
        WHERE FT.SLIP_DATE BETWEEN ? AND ? {sf} {subf}
    """
    return frag, sp + subp


def _vou_status_label() -> str:
    return """CASE FT.VOU_STATUS
        WHEN 1 THEN 'Changed'
        WHEN 2 THEN 'Cancelled'
        WHEN 3 THEN 'Pending'
        WHEN 4 THEN 'Received'
        ELSE 'Unknown' END"""


@router.get("/api/inventory/transfers/kpi")
def transfers_kpi(
    date_from: date = Query(...),
    date_to:   date = Query(...),
    stores:    Optional[str] = Depends(scoped_stores),
    subsidiaries: Optional[str] = Depends(scoped_subsidiaries),
):
    base, sp = _trans_base(stores, subsidiaries)
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
    """, [date_from, date_to] + sp)
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
    date_from: date = Query(...),
    date_to:   date = Query(...),
    stores:    Optional[str] = Depends(scoped_stores),
    subsidiaries: Optional[str] = Depends(scoped_subsidiaries),
):
    base, sp = _trans_base(stores, subsidiaries)
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
    """, [date_from, date_to] + sp)


@router.get("/api/inventory/transfers/by-store")
def transfers_by_store(
    date_from:  date = Query(...),
    date_to:    date = Query(...),
    stores:     Optional[str] = Depends(scoped_stores),
    subsidiaries: Optional[str] = Depends(scoped_subsidiaries),
    direction:  str = Query("out", pattern="^(out|in)$"),
    limit:      int = Query(15, ge=1, le=1000),
):
    base, sp = _trans_base(stores, subsidiaries)
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
    """, [date_from, date_to] + sp)


@router.get("/api/inventory/transfers/by-dept")
def transfers_by_dept(
    date_from: date = Query(...),
    date_to:   date = Query(...),
    stores:    Optional[str] = Depends(scoped_stores),
    subsidiaries: Optional[str] = Depends(scoped_subsidiaries),
    limit:     int = Query(20, ge=1, le=1000),
):
    base, sp = _trans_base(stores, subsidiaries)
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
    """, [date_from, date_to] + sp)


@router.get("/api/inventory/transfers/details")
def transfers_details(
    date_from: date = Query(...),
    date_to:   date = Query(...),
    stores:    Optional[str] = Depends(scoped_stores),
    subsidiaries: Optional[str] = Depends(scoped_subsidiaries),
    limit:     Optional[int] = Query(None, ge=1),   # no cap unless the caller asks
):
    lim = f"LIMIT {int(limit)}" if limit else ""
    base, sp = _trans_base(stores, subsidiaries)
    status_label = _vou_status_label()
    return _qdf(f"""
        SELECT
            FT.SLIP_NO                               AS slip_no,
            FT.SLIP_DATE::DATE::VARCHAR             AS slip_date,
            COALESCE(DS_OUT.STORE_NAME, '(Unknown)') AS from_store,
            COALESCE(DS_IN.STORE_NAME,  '(Unknown)') AS to_store,
            FT.VOU_NO                                AS vou_no,
            {status_label}                            AS status,
            I.ALU,
            I.UPC,
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
        {lim}
    """, [date_from, date_to] + sp)


# ═══════════════════════════════════════════════════════════════════════════════
# ADJUSTMENTS
# ═══════════════════════════════════════════════════════════════════════════════

def _adj_base(stores: Optional[str],
              subsidiaries: Optional[str] = None) -> tuple[str, list]:
    """Caller prepends [date_from, date_to] to the returned params.
    FACT_ADJUSTMENTS has no SUBSIDIARY_SID → filter via the DIM_STORE alias S
    (always joined)."""
    sf, sp = store_filter(stores, alias="S")
    subf, subp = subsidiary_filter(subsidiaries, alias="S")
    frag = f"""
        FROM FACT_ADJUSTMENTS FA
        LEFT JOIN DIM_STORE S ON S.SID = FA.STORE_SID
        LEFT JOIN DIM_EMPLOYEE E  ON E.SID  = FA.EMPLOYEE_SID
        LEFT JOIN DIM_ITEM     I  ON I.SID  = FA.ITEM_SID
        LEFT JOIN DIM_DCS      DC ON DC.SID = I.DCS_SID
        LEFT JOIN DIM_VENDOR   V  ON V.SID  = I.VEND_SID
        WHERE FA.ADJ_DATE BETWEEN ? AND ? {sf} {subf}
    """
    return frag, sp + subp


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
    date_from: date = Query(...),
    date_to:   date = Query(...),
    stores:    Optional[str] = Depends(scoped_stores),
    subsidiaries: Optional[str] = Depends(scoped_subsidiaries),
):
    base, sp = _adj_base(stores, subsidiaries)
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
    """, [date_from, date_to] + sp)
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
    date_from: date = Query(...),
    date_to:   date = Query(...),
    stores:    Optional[str] = Depends(scoped_stores),
    subsidiaries: Optional[str] = Depends(scoped_subsidiaries),
):
    base, sp = _adj_base(stores, subsidiaries)
    return _qdf(f"""
        SELECT
            FA.ADJ_DATE,
            COUNT(DISTINCT FA.ADJ_SID)                                           AS adj_count,
            ROUND(SUM(CASE WHEN FA.QTY_DIFF > 0 THEN FA.QTY_DIFF ELSE 0 END), 0)    AS pos_qty,
            ROUND(SUM(CASE WHEN FA.QTY_DIFF < 0 THEN FA.QTY_DIFF ELSE 0 END), 0)    AS neg_qty,
            ROUND(SUM(FA.QTY_DIFF), 0)                                               AS net_qty,
            ROUND(SUM(FA.COST_DIFF), 2)                                              AS net_cost,
            ROUND(SUM(CASE WHEN FA.COST_DIFF > 0 THEN FA.COST_DIFF ELSE 0 END), 2)  AS pos_cost,
            ROUND(SUM(CASE WHEN FA.COST_DIFF < 0 THEN FA.COST_DIFF ELSE 0 END), 2)  AS neg_cost
        {base}
        GROUP BY FA.ADJ_DATE
        ORDER BY FA.ADJ_DATE
    """, [date_from, date_to] + sp)


@router.get("/api/inventory/adjustments/by-type")
def adjustments_by_type(
    date_from: date = Query(...),
    date_to:   date = Query(...),
    stores:    Optional[str] = Depends(scoped_stores),
    subsidiaries: Optional[str] = Depends(scoped_subsidiaries),
):
    base, sp = _adj_base(stores, subsidiaries)
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
    """, [date_from, date_to] + sp)


@router.get("/api/inventory/adjustments/by-store")
def adjustments_by_store(
    date_from: date = Query(...),
    date_to:   date = Query(...),
    stores:    Optional[str] = Depends(scoped_stores),
    subsidiaries: Optional[str] = Depends(scoped_subsidiaries),
    limit:     int = Query(15, ge=1, le=1000),
):
    base, sp = _adj_base(stores, subsidiaries)
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
    """, [date_from, date_to] + sp)


@router.get("/api/inventory/adjustments/details")
def adjustments_details(
    date_from: date = Query(...),
    date_to:   date = Query(...),
    stores:    Optional[str] = Depends(scoped_stores),
    subsidiaries: Optional[str] = Depends(scoped_subsidiaries),
    limit:     Optional[int] = Query(None, ge=1),   # no cap unless the caller asks
):
    lim = f"LIMIT {int(limit)}" if limit else ""
    base, sp = _adj_base(stores, subsidiaries)
    doc_lbl = _doc_type_label()
    return _qdf(f"""
        SELECT
            FA.ADJ_NO,
            FA.ADJ_DATE,
            COALESCE(S.STORE_NAME, '(Unknown)')  AS store_name,
            COALESCE(E.FULL_NAME, '(Unknown)')   AS employee,
            {doc_lbl}                             AS doc_type,
            I.ALU,
            I.UPC,
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
        {lim}
    """, [date_from, date_to] + sp)


# ═══════════════════════════════════════════════════════════════════════════════
# INVENTORY HISTORY  (from FACT_INVENTORY_HISTORY)
# ═══════════════════════════════════════════════════════════════════════════════

def _invh_base(stores: Optional[str],
               subsidiaries: Optional[str] = None) -> tuple[str, list]:
    """Caller prepends [date_from, date_to] to the returned params.
    FACT_INVENTORY_HISTORY has no SUBSIDIARY_SID → filter via DIM_STORE alias S;
    the store join is forced on when a store OR subsidiary filter is present."""
    sf, sp = store_filter(stores, alias="S")
    subf, subp = subsidiary_filter(subsidiaries, alias="S")
    store_join = ("LEFT JOIN DIM_STORE S ON S.SID = FH.STORE_SID"
                  if (sf or subf) else "")
    frag = f"""
        FROM FACT_INVENTORY_HISTORY FH
        LEFT JOIN DIM_ITEM    I  ON I.SID  = FH.ITEM_SID
        LEFT JOIN DIM_DCS     D  ON D.SID  = I.DCS_SID
        LEFT JOIN DIM_VENDOR  V  ON V.SID  = I.VEND_SID
        {store_join}
        WHERE FH.ACTION_DATE BETWEEN ? AND ? {sf} {subf}
    """
    return frag, sp + subp


@router.get("/api/inventory/history/kpi")
def invh_kpi(
    date_from: date = Query(...),
    date_to:   date = Query(...),
    stores:    Optional[str] = Depends(scoped_stores),
    subsidiaries: Optional[str] = Depends(scoped_subsidiaries),
):
    # HONEST metrics: history QTY is an ABSOLUTE snapshot per event, so summing
    # QTY (or QTY*COST) across events is meaningless — those fields were removed.
    if _invh_off():
        return {
            "total_events": 0, "sku_count": 0, "store_count": 0,
            "insert_count": 0, "update_count": 0, "pairs_touched": 0,
            "events_per_day": 0.0,
            "unavailable": True, "reason": _invh_reason(),
        }
    base, sp = _invh_base(stores, subsidiaries)
    rows = _q(f"""
        SELECT
            COUNT(*)                                                                  AS total_events,
            COUNT(DISTINCT FH.ITEM_SID)                                              AS sku_count,
            COUNT(DISTINCT FH.STORE_SID)                                             AS store_count,
            COUNT(CASE WHEN FH.ACTION_TYPE = 'INSERT' THEN 1 END)                 AS insert_count,
            COUNT(CASE WHEN FH.ACTION_TYPE = 'UPDATE' THEN 1 END)                 AS update_count,
            COUNT(DISTINCT FH.ITEM_SID || '·' || FH.STORE_SID)                     AS pairs_touched
        {base}
    """, [date_from, date_to] + sp)
    r = rows[0]
    days = max(1, (date_to - date_from).days + 1)
    total = int(r[0] or 0)
    return {
        "total_events":   total,
        "sku_count":      int(r[1] or 0),
        "store_count":    int(r[2] or 0),
        "insert_count":   int(r[3] or 0),
        "update_count":   int(r[4] or 0),
        "pairs_touched":  int(r[5] or 0),
        "events_per_day": round(total / days, 1),
    }


@router.get("/api/inventory/history/trend")
def invh_trend(
    date_from: date = Query(...),
    date_to:   date = Query(...),
    stores:    Optional[str] = Depends(scoped_stores),
    subsidiaries: Optional[str] = Depends(scoped_subsidiaries),
):
    """Daily inventory change trend — HONEST counts only (event/insert/update
    counts and SKUs touched); absolute snapshot QTYs are never summed."""
    if _invh_off():
        return []
    base, sp = _invh_base(stores, subsidiaries)
    return _qdf(f"""
        SELECT
            FH.ACTION_DATE::DATE                                                      AS action_date,
            COUNT(*)                                                                  AS event_count,
            COUNT(CASE WHEN FH.ACTION_TYPE = 'INSERT' THEN 1 END)                  AS insert_count,
            COUNT(CASE WHEN FH.ACTION_TYPE = 'UPDATE' THEN 1 END)                  AS update_count,
            COUNT(DISTINCT FH.ITEM_SID)                                              AS skus_touched
        {base}
        GROUP BY FH.ACTION_DATE::DATE
        ORDER BY action_date
    """, [date_from, date_to] + sp)


@router.get("/api/inventory/history/by-item")
def invh_by_item(
    date_from: date = Query(...),
    date_to:   date = Query(...),
    stores:    Optional[str] = Depends(scoped_stores),
    subsidiaries: Optional[str] = Depends(scoped_subsidiaries),
    limit:     int = Query(50, ge=1, le=10000),
):
    """Top items by number of inventory change events in the period.

    HONEST metrics only: history QTY values are ABSOLUTE snapshots per
    item×store, so MIN/MAX/SUM across events (and across stores) are
    meaningless. Instead we report event counts, the stores touched, the
    first/last event dates, and the item's true stock at the END of the
    period (carry-forward: last row per item×store on or before date_to,
    summed over stores)."""
    if _invh_off():
        return []
    base, sp = _invh_base(stores, subsidiaries)

    # End-of-period stock CTE gets its own filter fragments (own aliases)
    sf2, sp2 = store_filter(stores, alias="S2")
    subf2, subp2 = subsidiary_filter(subsidiaries, alias="S2")
    store_join2 = ("LEFT JOIN DIM_STORE S2 ON S2.SID = FH2.STORE_SID"
                   if (sf2 or subf2) else "")

    # Params: AGG (dates + base filters), then ENDQ (date_to + its filters)
    params = [date_from, date_to] + sp + [date_to] + sp2 + subp2

    return _qdf(f"""
        WITH
        AGG AS (
            SELECT
                FH.ITEM_SID,
                I.ALU,
                I.UPC,
                I.DESCRIPTION1,
                COALESCE(D.D_NAME, '(Unknown)')    AS department,
                COALESCE(V.VEND_NAME, '(Unknown)') AS vendor,
                COUNT(*)                            AS event_count,
                COUNT(DISTINCT FH.STORE_SID)        AS store_count,
                MIN(FH.ACTION_DATE)::DATE::VARCHAR AS first_event,
                MAX(FH.ACTION_DATE)::DATE::VARCHAR AS last_event
            {base}
            GROUP BY FH.ITEM_SID, I.ALU, I.UPC, I.DESCRIPTION1, D.D_NAME, V.VEND_NAME
        ),
        ENDQ AS (
            SELECT FH2.ITEM_SID, FH2.STORE_SID, FH2.QTY, FH2.COST
            FROM FACT_INVENTORY_HISTORY FH2
            {store_join2}
            WHERE FH2.ACTION_DATE <= ? {sf2} {subf2}
            QUALIFY ROW_NUMBER() OVER (
                PARTITION BY FH2.ITEM_SID, FH2.STORE_SID
                ORDER BY FH2.ACTION_DATE DESC, FH2.HISTORY_SID DESC) = 1
        ),
        ENDAGG AS (
            SELECT ITEM_SID,
                   ROUND(SUM(QTY), 0)        AS stock_at_end,
                   ROUND(SUM(QTY * COST), 2) AS stock_value_end
            FROM ENDQ
            GROUP BY ITEM_SID
        )
        SELECT
            A.ALU AS alu, A.UPC AS upc, A.DESCRIPTION1 AS description1,
            A.department, A.vendor,
            A.event_count, A.store_count, A.first_event, A.last_event,
            COALESCE(E.stock_at_end,    0) AS stock_at_end,
            COALESCE(E.stock_value_end, 0) AS stock_value_end
        FROM AGG A
        LEFT JOIN ENDAGG E ON E.ITEM_SID = A.ITEM_SID
        ORDER BY A.event_count DESC
        LIMIT {limit}
    """, params)


@router.get("/api/inventory/history/details")
def invh_details(
    date_from: date = Query(...),
    date_to:   date = Query(...),
    stores:    Optional[str] = Depends(scoped_stores),
    subsidiaries: Optional[str] = Depends(scoped_subsidiaries),
    # No cap unless the caller asks — matches the other *_details grids
    # (transfers/adjustments/purchases). The old default of 1000 silently
    # truncated a SCHEDULED History export to 1,000 rows.
    limit:     Optional[int] = Query(None, ge=1, le=1000000),
):
    """Raw inventory history rows for AG Grid."""
    if _invh_off():
        return []
    sf, sp = store_filter(stores, alias="S")
    subf, subp = subsidiary_filter(subsidiaries, alias="S")
    return _qdf(f"""
        SELECT
            FH.ACTION_DATE AS action_date,
            FH.ACTION_TYPE AS action_type,
            COALESCE(S.STORE_NAME, '(Unknown)')  AS store_name,
            I.ALU AS alu,
            I.UPC AS upc,
            I.DESCRIPTION1 AS description1,
            COALESCE(D.D_NAME, '')               AS department,
            COALESCE(V.VEND_NAME, '')             AS vendor,
            ROUND(FH.QTY, 3)                       AS qty,
            ROUND(FH.COST, 4)                      AS unit_cost,
            ROUND(FH.QTY * FH.COST, 2)            AS cost_value
        FROM FACT_INVENTORY_HISTORY FH
        LEFT JOIN DIM_STORE S ON S.SID = FH.STORE_SID
        LEFT JOIN DIM_ITEM    I  ON I.SID  = FH.ITEM_SID
        LEFT JOIN DIM_DCS     D  ON D.SID  = I.DCS_SID
        LEFT JOIN DIM_VENDOR  V  ON V.SID  = I.VEND_SID
        WHERE FH.ACTION_DATE BETWEEN ? AND ? {sf} {subf}
        ORDER BY FH.ACTION_DATE DESC, FH.HISTORY_SID DESC
        {f'LIMIT {int(limit)}' if limit else ''}
    """, [date_from, date_to] + sp + subp)



# ═══════════════════════════════════════════════════════════════════════════════
# INVENTORY MOVEMENT LEDGER  (Opening → Sales → Recv → Sent → Adj → Ending)
# ═══════════════════════════════════════════════════════════════════════════════

# Whitelist mapping the frontend's configured item identifier
# (AppSettings.itemId.field) onto a DIM_ITEM column. Only these three literals
# are ever interpolated; the search text itself is always bound (?).
_ITEM_ID_COLUMN = {"alu": "ALU", "upc": "UPC", "description": "DESCRIPTION1"}


@router.get("/api/inventory/items-search")
def inventory_items_search(q: str = Query(..., min_length=1, max_length=100),
                           field: Optional[str] = Query(None)):
    """
    Search DIM_ITEM for the item slicers (DataSlicer `searchEndpoint`).
    Returns up to 40 matches: item_sid, ALU, UPC, DESCRIPTION1.

    `field` = the user's CONFIGURED item identifier ('alu' | 'upc' |
    'description'). When given, only that column is matched — so the slicer
    finds items by exactly the identifier the user chose in Settings. When
    omitted (the Journals default) all three columns are matched, unchanged.
    """
    pat = f"%{q.strip()}%"
    col = _ITEM_ID_COLUMN.get((field or "").strip().lower())
    if col:
        return _qdf(f"""
            SELECT SID AS item_sid, ALU, UPC, DESCRIPTION1
            FROM DIM_ITEM
            WHERE {col} ILIKE ?
            ORDER BY {col}
            LIMIT 40
        """, [pat])
    return _qdf("""
        SELECT SID AS item_sid, ALU, UPC, DESCRIPTION1
        FROM DIM_ITEM
        WHERE ALU ILIKE ?
           OR UPC ILIKE ?
           OR DESCRIPTION1 ILIKE ?
        ORDER BY ALU
        LIMIT 40
    """, [pat, pat, pat])


@router.get("/api/inventory/search/dcs")
def inventory_search_dcs(q: str = Query(..., min_length=1, max_length=100)):
    """Distinct department / class / subclass rows matching the query (any
    level) — the inventory-side twin of /api/sales/journal/search/dcs, so the
    Coverage / Ledger / Stock-as-of DCS slicers are real type-aheads."""
    pat = f"%{q.strip()}%"
    return _qdf("""
        SELECT DISTINCT D_NAME AS department, C_NAME AS class, S_NAME AS subclass
        FROM DIM_DCS
        WHERE D_NAME ILIKE ? OR C_NAME ILIKE ? OR S_NAME ILIKE ?
        ORDER BY department, class, subclass
        LIMIT 60
    """, [pat, pat, pat])


@router.get("/api/inventory/stores-list")
def inventory_stores_list(stores: Optional[str] = Depends(scoped_stores)):
    """Store name list for purchase/ledger filter dropdowns (scoped)."""
    sf, sp = csv_in("STORE_NAME", stores)
    return _qdf(f"SELECT STORE_NAME FROM DIM_STORE WHERE 1=1 {sf} ORDER BY STORE_NAME", sp)


@router.get("/api/inventory/ledger")
def inventory_ledger(
    date_from: date = Query(...),
    date_to:   date = Query(...),
    stores:    Optional[str] = Depends(scoped_stores),
    item_sid:  Optional[int] = Query(None),
    limit:     Optional[int] = Query(None, ge=1),   # no cap unless the caller asks
):
    """
    Per-item × per-store inventory movement ledger for a date range.
    Columns: ALU, Description, Dept, Store,
             Opening QTY/Cost, Sales QTY/Cost, Recv QTY/Cost,
             Sent QTY/Cost, Adj QTY/Cost, Ending QTY/Cost
    """
    lim = f"LIMIT {int(limit)}" if limit else ""
    # ── Store name filter fragments (each with its own bound params) ──────────
    sf_sale,  sp_sale  = csv_in("SS.STORE_NAME", stores)
    sf_trans, sp_trans = csv_in("DS.STORE_NAME", stores)
    sf_adj,   sp_adj   = csv_in("SA.STORE_NAME", stores)

    # ── Item filter fragments (item_sid is int-typed → safe to inline) ────────
    sf_item_open = f"AND ITEM_SID = {item_sid}"       if item_sid else ""
    sf_item_sale = f"AND F.ITEM_SID = {item_sid}"     if item_sid else ""
    sf_item_recv = f"AND FT.ITEM_SID = {item_sid}"    if item_sid else ""
    sf_item_adj  = f"AND FA.ITEM_SID = {item_sid}"    if item_sid else ""

    # ── ACTIVE CTE strategy ──────────────────────────────────────────────────
    # Single-item mode: expand to ALL stores so opening balance always shows
    # even if the item had zero movement in the period.
    # Multi-item mode: union of fact tables (only items with activity appear).
    if item_sid:
        active_cte = f"SELECT {item_sid} AS ITEM_SID, SID AS STORE_SID FROM DIM_STORE"
    else:
        active_cte = """SELECT ITEM_SID, STORE_SID FROM SALES
            UNION SELECT ITEM_SID, STORE_SID FROM RECV
            UNION SELECT ITEM_SID, STORE_SID FROM SENT
            UNION SELECT ITEM_SID, STORE_SID FROM ADJ"""

    # Ending balance: for a period ending today the live snapshot is the truth;
    # for a HISTORICAL period, stock-as-of-date_to = last history row per
    # item×store on or before date_to (carry-forward semantics).
    #
    # Without the Inventory History customisation the as-of path has nothing to
    # read, so a back-dated period would silently report ending = 0. Fall back
    # to the live snapshot instead: it is the only truth available, the
    # movement columns (sales / transfers / adjustments) stay fully correct,
    # and the page shows a banner saying opening balances are unavailable here.
    _invh = not _invh_off()
    use_asof_end = _invh and date_to < date.today()
    if use_asof_end:
        ending_cte = f"""
        ENDING AS (
            SELECT ITEM_SID, STORE_SID, QTY AS end_qty, COST AS end_unit_cost
            FROM FACT_INVENTORY_HISTORY
            WHERE ACTION_DATE <= ? {sf_item_open}
            QUALIFY ROW_NUMBER() OVER (PARTITION BY ITEM_SID, STORE_SID ORDER BY ACTION_DATE DESC, HISTORY_SID DESC) = 1
        ),"""
        ending_select = """
            COALESCE(E.end_qty,                       0) AS end_qty,
            ROUND(COALESCE(E.end_qty * E.end_unit_cost, 0), 2) AS end_cost"""
        ending_join = "LEFT JOIN ENDING E ON E.ITEM_SID = AC.ITEM_SID AND E.STORE_SID = AC.STORE_SID"
        ending_params = [date_to]
    else:
        ending_cte = ""
        ending_select = """
            COALESCE(FI.ON_HAND_QTY,          0) AS end_qty,
            ROUND(COALESCE(FI.ON_HAND_QTY * FI.COST, 0), 2) AS end_cost"""
        ending_join = "LEFT JOIN FACT_INVENTORY FI ON FI.ITEM_SID = AC.ITEM_SID AND FI.STORE_SID = AC.STORE_SID"
        ending_params = []

    # Params follow placeholder order: OPENING, ENDING (as-of only), SALES, RECV, SENT, ADJ
    params = ([date_from] + ending_params
              + [date_from, date_to] + sp_sale
              + [date_from, date_to] + sp_trans
              + [date_from, date_to] + sp_trans
              + [date_from, date_to] + sp_adj)

    return _qdf(f"""
        WITH
        -- Opening balance: last FACT_INVENTORY_HISTORY record per item/store BEFORE period
        OPENING AS (
            SELECT ITEM_SID, STORE_SID, QTY AS open_qty, COST AS open_unit_cost
            FROM FACT_INVENTORY_HISTORY
            WHERE ACTION_DATE < ? {sf_item_open}
            QUALIFY ROW_NUMBER() OVER (PARTITION BY ITEM_SID, STORE_SID ORDER BY ACTION_DATE DESC, HISTORY_SID DESC) = 1
        ),{ending_cte}
        -- Net sales in period (sales reduce inventory, returns add back)
        SALES AS (
            SELECT
                F.ITEM_SID,
                F.STORE_SID,
                ROUND(SUM(CASE WHEN F.ITEM_TYPE='Sale'   THEN  F.QTY ELSE 0 END), 0) AS sold_qty,
                ROUND(SUM(CASE WHEN F.ITEM_TYPE='Return' THEN  F.QTY ELSE 0 END), 0) AS return_qty,
                ROUND(SUM(F.TOTAL_COST), 2)           AS sold_cost,
                ROUND(SUM(F.TOTAL_PRICE_WOTAX), 2)    AS sold_revenue
            FROM FACT_SALES_ITEMS F
            LEFT JOIN DIM_STORE SS ON SS.SID = F.STORE_SID
            WHERE F.INVC_POST_DATE::DATE BETWEEN ? AND ?
              {sf_item_sale} {sf_sale}
            GROUP BY F.ITEM_SID, F.STORE_SID
        ),
        -- Transfers received (inventory in)
        RECV AS (
            SELECT
                FT.ITEM_SID,
                FT.IN_STORE_SID                   AS STORE_SID,
                ROUND(SUM(FT.RECV_QTY), 0)        AS recv_qty,
                ROUND(SUM(FT.TOTAL_COST), 2)      AS recv_cost
            FROM FACT_TRANSFERS FT
            LEFT JOIN DIM_STORE DS ON DS.SID = FT.IN_STORE_SID
            WHERE FT.SLIP_DATE BETWEEN ? AND ?
              AND FT.VOU_STATUS = 4 {sf_item_recv} {sf_trans}
            GROUP BY FT.ITEM_SID, FT.IN_STORE_SID
        ),
        -- Transfers sent (inventory out)
        SENT AS (
            SELECT
                FT.ITEM_SID,
                FT.OUT_STORE_SID                  AS STORE_SID,
                ROUND(SUM(FT.SENT_QTY), 0)        AS sent_qty,
                ROUND(SUM(FT.TOTAL_COST), 2)      AS sent_cost
            FROM FACT_TRANSFERS FT
            LEFT JOIN DIM_STORE DS ON DS.SID = FT.OUT_STORE_SID
            WHERE FT.SLIP_DATE BETWEEN ? AND ?
              {sf_item_recv} {sf_trans}
            GROUP BY FT.ITEM_SID, FT.OUT_STORE_SID
        ),
        -- Adjustments in period
        ADJ AS (
            SELECT
                FA.ITEM_SID,
                FA.STORE_SID,
                ROUND(SUM(FA.QTY_DIFF),  0) AS adj_qty,
                ROUND(SUM(FA.COST_DIFF), 2) AS adj_cost
            FROM FACT_ADJUSTMENTS FA
            LEFT JOIN DIM_STORE SA ON SA.SID = FA.STORE_SID
            WHERE FA.ADJ_DATE BETWEEN ? AND ?
              {sf_item_adj} {sf_adj}
            GROUP BY FA.ITEM_SID, FA.STORE_SID
        ),
        -- All item/store pairs to show in the result
        ACTIVE AS (
            {active_cte}
        )
        SELECT
            -- All three identifier columns: the grid renders whichever one the
            -- user configured (Settings → Product Code Field), so UPC must be
            -- present too — it used to be missing and that column came up blank.
            COALESCE(I.ALU,          '')  AS alu,
            COALESCE(I.UPC,          '')  AS upc,
            COALESCE(I.DESCRIPTION1, '')  AS description,
            COALESCE(DC.D_NAME,      '')  AS department,
            COALESCE(DS.STORE_NAME,  '')  AS store_name,
            -- Opening balance
            COALESCE(O.open_qty,                     0) AS open_qty,
            ROUND(COALESCE(O.open_qty * O.open_unit_cost, 0), 2) AS open_cost,
            -- Sales
            COALESCE(SL.sold_qty,    0) AS sold_qty,
            COALESCE(SL.return_qty,  0) AS return_qty,
            COALESCE(SL.sold_cost,   0) AS sold_cost,
            COALESCE(SL.sold_revenue,0) AS sold_revenue,
            -- Received (transfers in)
            COALESCE(R.recv_qty,     0) AS recv_qty,
            COALESCE(R.recv_cost,    0) AS recv_cost,
            -- Sent (transfers out)
            COALESCE(S.sent_qty,     0) AS sent_qty,
            COALESCE(S.sent_cost,    0) AS sent_cost,
            -- Adjustments
            COALESCE(A.adj_qty,      0) AS adj_qty,
            COALESCE(A.adj_cost,     0) AS adj_cost,
            -- Ending balance (live snapshot for today, as-of history for the past)
            {ending_select}
        FROM ACTIVE AC
        LEFT JOIN DIM_ITEM     I   ON I.SID   = AC.ITEM_SID
        LEFT JOIN DIM_DCS      DC  ON DC.SID  = I.DCS_SID
        LEFT JOIN DIM_STORE    DS  ON DS.SID  = AC.STORE_SID
        LEFT JOIN OPENING      O   ON O.ITEM_SID  = AC.ITEM_SID  AND O.STORE_SID  = AC.STORE_SID
        LEFT JOIN SALES        SL  ON SL.ITEM_SID = AC.ITEM_SID  AND SL.STORE_SID = AC.STORE_SID
        LEFT JOIN RECV         R   ON R.ITEM_SID  = AC.ITEM_SID  AND R.STORE_SID  = AC.STORE_SID
        LEFT JOIN SENT         S   ON S.ITEM_SID  = AC.ITEM_SID  AND S.STORE_SID  = AC.STORE_SID
        LEFT JOIN ADJ          A   ON A.ITEM_SID  = AC.ITEM_SID  AND A.STORE_SID  = AC.STORE_SID
        {ending_join}
        ORDER BY DS.STORE_NAME, I.ALU
        {lim}
    """, params)


@router.get("/api/inventory/ledger/kpi")
def inventory_ledger_kpi(
    date_from: date = Query(...),
    date_to:   date = Query(...),
    stores:    Optional[str] = Depends(scoped_stores),
    item_sid:  Optional[int] = Query(None),
):
    """Summary KPIs for the ledger filter."""
    sf_sale, sp_sale = csv_in("SS.STORE_NAME", stores)
    sf_adj,  sp_adj  = csv_in("SA.STORE_NAME", stores)
    sf_recv, sp_recv = csv_in("DS.STORE_NAME", stores)

    sf_item_sale = f" AND F.ITEM_SID = {item_sid}"  if item_sid else ""
    sf_item_adj  = f" AND FA.ITEM_SID = {item_sid}" if item_sid else ""
    sf_item_recv = f" AND FT.ITEM_SID = {item_sid}" if item_sid else ""

    # Params follow CTE order: SALES, ADJ, RECV
    params = ([date_from, date_to] + sp_sale
              + [date_from, date_to] + sp_adj
              + [date_from, date_to] + sp_recv)

    rows = _q(f"""
        WITH
        SALES AS (
            SELECT COUNT(DISTINCT F.ITEM_SID) AS sku_count,
                   ROUND(SUM(F.QTY), 0) AS sold_qty,
                   ROUND(SUM(F.TOTAL_COST), 2) AS sold_cost
            FROM FACT_SALES_ITEMS F
            LEFT JOIN DIM_STORE SS ON SS.SID = F.STORE_SID
            WHERE F.INVC_POST_DATE::DATE BETWEEN ? AND ?
              AND F.ITEM_TYPE = 'Sale' {sf_sale}{sf_item_sale}
        ),
        ADJ AS (
            SELECT ROUND(SUM(FA.COST_DIFF), 2) AS adj_cost,
                   ROUND(SUM(FA.QTY_DIFF),  0) AS adj_qty
            FROM FACT_ADJUSTMENTS FA
            LEFT JOIN DIM_STORE SA ON SA.SID = FA.STORE_SID
            WHERE FA.ADJ_DATE BETWEEN ? AND ? {sf_adj}{sf_item_adj}
        ),
        RECV AS (
            SELECT ROUND(SUM(FT.RECV_QTY), 0) AS recv_qty,
                   ROUND(SUM(FT.TOTAL_COST), 2) AS recv_cost
            FROM FACT_TRANSFERS FT
            LEFT JOIN DIM_STORE DS ON DS.SID = FT.IN_STORE_SID
            WHERE FT.SLIP_DATE BETWEEN ? AND ?
              AND FT.VOU_STATUS = 4 {sf_recv}{sf_item_recv}
        )
        SELECT
            (SELECT sku_count  FROM SALES) AS sku_count,
            (SELECT sold_qty   FROM SALES) AS sold_qty,
            (SELECT sold_cost  FROM SALES) AS sold_cost,
            (SELECT adj_cost   FROM ADJ)   AS adj_cost,
            (SELECT adj_qty    FROM ADJ)   AS adj_qty,
            (SELECT recv_qty   FROM RECV)  AS recv_qty,
            (SELECT recv_cost  FROM RECV)  AS recv_cost
    """, params)
    r = rows[0]
    return {
        "sku_count": int(r[0] or 0),
        "sold_qty":  float(r[1] or 0),
        "sold_cost": float(r[2] or 0),
        "adj_cost":  float(r[3] or 0),
        "adj_qty":   float(r[4] or 0),
        "recv_qty":  float(r[5] or 0),
        "recv_cost": float(r[6] or 0),
    }


# ── Coverage / Replenishment Planning ─────────────────────────────────────────

@router.get("/api/inventory/coverage")
def inv_coverage(
    stores:  Optional[str] = Depends(scoped_stores),
    subsidiaries: Optional[str] = Depends(scoped_subsidiaries),
    vendors: Optional[str] = Query(None),
    dcs:     Optional[str] = Query(None),
    limit:   int = Query(100000, ge=1, le=1000000),
    stagnant: bool = Query(False),   # Home "stagnant stock lines" drill
):
    """
    Returns per-item × per-store inventory coverage for replenishment planning.
    Includes onhand qty, last-sold date, and sales qty for 30 / 60 / 90 days
    back from today.  Daily AVG and Days-of-Coverage are computed client-side
    from the user's chosen period (30 / 60 / 90 d selector).
    """
    today = datetime.utcnow().date()
    d30 = today - timedelta(days=30)
    d60 = today - timedelta(days=60)
    d90 = today - timedelta(days=90)

    sf, sp = store_filter(stores)
    # FACT_INVENTORY carries its own SUBSIDIARY_SID → filter the snapshot on the
    # fact itself (alias FI), not on the derived DIM_STORE.SUBSIDIARY_SID.
    subf, subp = subsidiary_filter(subsidiaries, alias="FI")
    vf, vp = csv_in("V.VEND_NAME", vendors)
    df, dp = csv_in("DC.D_NAME", dcs)

    # ── Stagnant drill (Home "stagnant stock lines" alert) ────────────────────
    # Keep only item × store rows we still hold stock of (ON_HAND_QTY > 0 — the
    # main WHERE below already enforces this) that sold in the prior 60-day
    # window (as_of−89 … as_of−30) but nothing in the last 30 days
    # (as_of−29 … as_of). The window is anchored to the warehouse's latest
    # IN-SCOPE invoice date — IDENTICAL to home_summary's `stagnant` count — so
    # this grid's row count equals the number on the alert card, even when an
    # offline warehouse lags today (the 30/60/90 columns still read from today).
    stag_cte = stag_join = stag_pred = ""
    stag_params: list = []
    if stagnant:
        isubf, isubp = subsidiary_filter(subsidiaries, alias="INV")
        as_of = _q(f"""
            SELECT MAX(INV.INVC_POST_DATE::DATE)
            FROM FACT_SALES_INVOICES INV
            LEFT JOIN DIM_STORE S ON S.SID = INV.STORE_SID
            WHERE 1=1 {sf} {isubf}
        """, sp + isubp)[0][0]
        if as_of is not None:
            stag_cte = """,
        stag AS (
            SELECT F.ITEM_SID, F.STORE_SID,
                   SUM(CASE WHEN F.INVC_POST_DATE::DATE >= ?::DATE-29 THEN F.QTY ELSE 0 END)   AS q30,
                   SUM(CASE WHEN F.INVC_POST_DATE::DATE BETWEEN ?::DATE-89 AND ?::DATE-30
                            THEN F.QTY ELSE 0 END)                                             AS qprev
            FROM FACT_SALES_ITEMS F
            WHERE F.INVC_POST_DATE::DATE >= ?::DATE-89
            GROUP BY F.ITEM_SID, F.STORE_SID
        )"""
            stag_join = "JOIN stag ON stag.ITEM_SID = FI.ITEM_SID AND stag.STORE_SID = FI.STORE_SID"
            stag_pred = "AND stag.q30 = 0 AND stag.qprev > 0"
            stag_params = [as_of, as_of, as_of]

    # Params follow placeholder order: s30, s60, s90 CTEs, the optional stag CTE,
    # then the WHERE filters (store, subsidiary, vendor, dcs — matching the ?
    # order in the WHERE clause).
    params = [d30, today, d60, today, d90, today] + stag_params + sp + subp + vp + dp

    return _qdf(f"""
        WITH
        s30 AS (
            SELECT F.ITEM_SID, F.STORE_SID,
                   ROUND(SUM(CASE WHEN F.ITEM_TYPE = 'Sale' THEN F.QTY ELSE 0 END), 0) AS qty_30,
                   MAX(F.INVC_POST_DATE::DATE) AS last_sold
            FROM FACT_SALES_ITEMS F
            WHERE F.INVC_POST_DATE::DATE BETWEEN ? AND ?
            GROUP BY F.ITEM_SID, F.STORE_SID
        ),
        s60 AS (
            SELECT F.ITEM_SID, F.STORE_SID,
                   ROUND(SUM(CASE WHEN F.ITEM_TYPE = 'Sale' THEN F.QTY ELSE 0 END), 0) AS qty_60
            FROM FACT_SALES_ITEMS F
            WHERE F.INVC_POST_DATE::DATE BETWEEN ? AND ?
            GROUP BY F.ITEM_SID, F.STORE_SID
        ),
        s90 AS (
            SELECT F.ITEM_SID, F.STORE_SID,
                   ROUND(SUM(CASE WHEN F.ITEM_TYPE = 'Sale' THEN F.QTY ELSE 0 END), 0) AS qty_90
            FROM FACT_SALES_ITEMS F
            WHERE F.INVC_POST_DATE::DATE BETWEEN ? AND ?
            GROUP BY F.ITEM_SID, F.STORE_SID
        ){stag_cte}
        SELECT
            COALESCE(S.STORE_NAME,  '(Unknown)') AS store_name,
            COALESCE(I.UPC,         '')           AS upc,
            COALESCE(I.ALU,         '')           AS alu,
            COALESCE(I.DESCRIPTION1,'')           AS description,
            COALESCE(V.VEND_NAME,   '(Unknown)') AS vendor,
            COALESCE(DC.D_NAME,     '(Unknown)') AS department,
            ROUND(COALESCE(FI.ON_HAND_QTY, 0), 0)  AS on_hand,
            COALESCE(s30.qty_30, 0)               AS sales_30,
            COALESCE(s60.qty_60, 0)               AS sales_60,
            COALESCE(s90.qty_90, 0)               AS sales_90,
            CAST(s30.last_sold AS VARCHAR)         AS last_sold
        FROM FACT_INVENTORY FI
        LEFT JOIN DIM_STORE  S  ON S.SID  = FI.STORE_SID
        LEFT JOIN DIM_ITEM   I  ON I.SID  = FI.ITEM_SID
        LEFT JOIN DIM_VENDOR V  ON V.SID  = I.VEND_SID
        LEFT JOIN DIM_DCS    DC ON DC.SID = I.DCS_SID
        LEFT JOIN s30 ON s30.ITEM_SID = FI.ITEM_SID AND s30.STORE_SID = FI.STORE_SID
        LEFT JOIN s60 ON s60.ITEM_SID = FI.ITEM_SID AND s60.STORE_SID = FI.STORE_SID
        LEFT JOIN s90 ON s90.ITEM_SID = FI.ITEM_SID AND s90.STORE_SID = FI.STORE_SID
        {stag_join}
        WHERE FI.ON_HAND_QTY > 0 {sf} {subf} {vf} {df} {stag_pred}
        ORDER BY S.STORE_NAME, sales_90 DESC, FI.ON_HAND_QTY DESC
        LIMIT {limit}
    """, params)


@router.get("/api/inventory/vendors-list")
def inv_vendors_list():
    return _qdf("""
        SELECT DISTINCT V.VEND_NAME
        FROM FACT_INVENTORY FI
        LEFT JOIN DIM_ITEM   I ON I.SID = FI.ITEM_SID
        LEFT JOIN DIM_VENDOR V ON V.SID = I.VEND_SID
        WHERE V.VEND_NAME IS NOT NULL AND FI.ON_HAND_QTY > 0
        ORDER BY V.VEND_NAME
    """)


@router.get("/api/inventory/dcs-list")
def inv_dcs_list():
    return _qdf("""
        SELECT DISTINCT DC.D_NAME AS department
        FROM FACT_INVENTORY FI
        LEFT JOIN DIM_ITEM I  ON I.SID  = FI.ITEM_SID
        LEFT JOIN DIM_DCS  DC ON DC.SID = I.DCS_SID
        WHERE DC.D_NAME IS NOT NULL AND FI.ON_HAND_QTY > 0
        ORDER BY DC.D_NAME
    """)


# ═══════════════════════════════════════════════════════════════════════════════
# STOCK AS OF DATE  (carry-forward from FACT_INVENTORY_HISTORY)
# ═══════════════════════════════════════════════════════════════════════════════
# Semantics (owner's INVN_BACKUP_TRG): each history row stores the ABSOLUTE
# on-hand QTY after a change (baseline snapshot at install + one row per
# change). Stock on date D for an item×store = the LAST row on or before D
# (ACTION_DATE DESC, HISTORY_SID DESC tiebreak). Never SUM(QTY) across rows.

_ASOF_CTE = """
        SNAP AS (
            SELECT ITEM_SID, STORE_SID, QTY, COST
            FROM FACT_INVENTORY_HISTORY
            WHERE ACTION_DATE <= ? {item_f}
            QUALIFY ROW_NUMBER() OVER (
                PARTITION BY ITEM_SID, STORE_SID
                ORDER BY ACTION_DATE DESC, HISTORY_SID DESC) = 1
        )
"""


@router.get("/api/inventory/stock-asof/kpi")
def stock_asof_kpi(
    asof: date = Query(...),
    stores: Optional[str] = Depends(scoped_stores),
    subsidiaries: Optional[str] = Depends(scoped_subsidiaries),
):
    """Headline stock figures on the chosen date + the history coverage window
    (so the UI can warn when `asof` predates the baseline snapshot)."""
    if _invh_off():
        return {
            "sku_count": 0, "total_qty": 0.0, "stock_cost": 0.0,
            "store_count": 0, "neg_stock": 0,
            "history_start": None, "history_end": None,
            "unavailable": True, "reason": _invh_reason(),
        }
    sf, sp = store_filter(stores)
    subf, subp = subsidiary_filter(subsidiaries, alias="S")
    asof_cte = _ASOF_CTE.format(item_f="")
    rows = _q(f"""
        WITH {asof_cte}
        SELECT
            COUNT(DISTINCT CASE WHEN A.QTY <> 0 THEN A.ITEM_SID  END) AS sku_count,
            ROUND(COALESCE(SUM(A.QTY), 0), 0)                          AS total_qty,
            ROUND(COALESCE(SUM(A.QTY * A.COST), 0), 2)                AS stock_cost,
            COUNT(DISTINCT CASE WHEN A.QTY <> 0 THEN A.STORE_SID END) AS store_count,
            COUNT(CASE WHEN A.QTY < 0 THEN 1 END)                      AS neg_stock
        FROM SNAP A
        LEFT JOIN DIM_STORE S ON S.SID = A.STORE_SID
        WHERE 1=1 {sf} {subf}
    """, [asof] + sp + subp)
    r = rows[0]
    rng = _q("""
        SELECT MIN(ACTION_DATE)::DATE::VARCHAR, MAX(ACTION_DATE)::DATE::VARCHAR
        FROM FACT_INVENTORY_HISTORY
    """)
    return {
        "sku_count":     int(r[0] or 0),
        "total_qty":     float(r[1] or 0),
        "stock_cost":    float(r[2] or 0),
        "store_count":   int(r[3] or 0),
        "neg_stock":     int(r[4] or 0),
        "history_start": rng[0][0],
        "history_end":   rng[0][1],
    }


@router.get("/api/inventory/stock-asof")
def stock_asof(
    asof: date = Query(...),
    stores: Optional[str] = Depends(scoped_stores),
    subsidiaries: Optional[str] = Depends(scoped_subsidiaries),
    group_by: str = Query("item_store", pattern="^(item_store|item|store|dept|vendor)$"),
    search: Optional[str] = Query(None, max_length=400),
    field: Optional[str] = Query(None),   # configured item identifier
    vendors: Optional[str] = Query(None),
    dcs: Optional[str] = Query(None),
    limit: Optional[int] = Query(None, ge=1),   # no cap unless the caller asks
):
    """Per-item × per-store stock on the chosen date (carry-forward), grouped
    on demand. Zero-qty positions are hidden; negative ones are shown."""
    if _invh_off():
        return []
    lim = f"LIMIT {int(limit)}" if limit else ""
    sf, sp = store_filter(stores)
    subf, subp = subsidiary_filter(subsidiaries, alias="S")
    vf, vp = csv_in("V.VEND_NAME", vendors)
    df, dp = csv_in("DC.D_NAME", dcs)

    # The item identifier the UI is configured to use (Settings → Product Code
    # Field). Only the three whitelisted literals are ever interpolated; the
    # search text itself is always bound (?).
    id_col = _ITEM_ID_COLUMN.get((field or "").strip().lower(), "ALU")

    # Item search — the DataSlicer sends one '|'-joined token per chip, and each
    # token matches ONLY the configured identifier column (never the old
    # ALU/UPC/description blob, which made the filter unpredictable).
    toks = [t.strip() for t in (search or "").split("|") if t.strip()][:20]
    if toks:
        srch = " AND (" + " OR ".join([f"I.{id_col} ILIKE ?"] * len(toks)) + ")"
        srch_p = [f"%{t}%" for t in toks]
    else:
        srch, srch_p = "", []

    asof_cte = _ASOF_CTE.format(item_f="")
    base = f"""
        FROM SNAP A
        LEFT JOIN DIM_STORE  S  ON S.SID  = A.STORE_SID
        LEFT JOIN DIM_ITEM   I  ON I.SID  = A.ITEM_SID
        LEFT JOIN DIM_DCS    DC ON DC.SID = I.DCS_SID
        LEFT JOIN DIM_VENDOR V  ON V.SID  = I.VEND_SID
        WHERE A.QTY <> 0 {sf} {subf} {vf} {df} {srch}
    """
    params = [asof] + sp + subp + vp + dp + srch_p

    if group_by == "item_store":
        return _qdf(f"""
            WITH {asof_cte}
            SELECT
                COALESCE(S.STORE_NAME, '(Unknown)') AS store_name,
                COALESCE(I.{id_col}, '')             AS item_code,
                COALESCE(I.DESCRIPTION1, '')         AS description,
                COALESCE(DC.D_NAME, '(Unknown)')     AS department,
                COALESCE(V.VEND_NAME, '(Unknown)')   AS vendor,
                ROUND(A.QTY, 0)                       AS qty,
                ROUND(A.COST, 4)                      AS unit_cost,
                ROUND(A.QTY * A.COST, 2)             AS cost_value
            {base}
            ORDER BY cost_value DESC
            {lim}
        """, params)

    if group_by == "item":
        return _qdf(f"""
            WITH {asof_cte}
            SELECT
                COALESCE(I.{id_col}, '')             AS item_code,
                COALESCE(I.DESCRIPTION1, '')         AS description,
                COALESCE(DC.D_NAME, '(Unknown)')     AS department,
                COALESCE(V.VEND_NAME, '(Unknown)')   AS vendor,
                COUNT(DISTINCT A.STORE_SID)           AS store_count,
                ROUND(SUM(A.QTY), 0)                 AS qty,
                ROUND(SUM(A.QTY * A.COST), 2)        AS cost_value
            {base}
            GROUP BY I.{id_col}, I.DESCRIPTION1, DC.D_NAME, V.VEND_NAME
            ORDER BY cost_value DESC
            {lim}
        """, params)

    if group_by == "store":
        return _qdf(f"""
            WITH {asof_cte}
            SELECT
                COALESCE(S.STORE_NAME, '(Unknown)') AS store_name,
                COUNT(DISTINCT A.ITEM_SID)           AS sku_count,
                ROUND(SUM(A.QTY), 0)                AS qty,
                ROUND(SUM(A.QTY * A.COST), 2)       AS cost_value
            {base}
            GROUP BY S.STORE_NAME
            ORDER BY cost_value DESC
            {lim}
        """, params)

    if group_by == "vendor":
        return _qdf(f"""
            WITH {asof_cte}
            SELECT
                COALESCE(V.VEND_NAME, '(Unknown)') AS vendor,
                COUNT(DISTINCT A.ITEM_SID)          AS sku_count,
                ROUND(SUM(A.QTY), 0)               AS qty,
                ROUND(SUM(A.QTY * A.COST), 2)      AS cost_value
            {base}
            GROUP BY V.VEND_NAME
            ORDER BY cost_value DESC
            {lim}
        """, params)

    # default: by department
    return _qdf(f"""
        WITH {asof_cte}
        SELECT
            COALESCE(DC.D_NAME, '(Unknown)') AS department,
            COUNT(DISTINCT A.ITEM_SID)        AS sku_count,
            ROUND(SUM(A.QTY), 0)             AS qty,
            ROUND(SUM(A.QTY * A.COST), 2)    AS cost_value
        {base}
        GROUP BY DC.D_NAME
        ORDER BY cost_value DESC
        {lim}
    """, params)
