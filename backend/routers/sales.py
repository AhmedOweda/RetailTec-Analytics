"""
Sales Router — Star Schema
==========================
All queries JOIN fact tables to dimension tables at query time.
Endpoints:
  GET  /api/sales/overview       — Today / Yesterday / MTD / YTD KPIs
  GET  /api/sales/trend          — Daily trend series
  GET  /api/sales/stores         — Per-store breakdown
  GET  /api/sales/employees      — Top employees
  GET  /api/sales/products       — Top items / DCS / vendor / department
  GET  /api/sales/transactions   — Invoice list with payments
  GET  /api/sales/stores-list    — Distinct store names for filter UI
  GET  /api/sync/trigger         — Fire on-open incremental sync
  GET  /api/sync/status          — Current sync state
  POST /api/sync/full-load       — Trigger full reload (admin panel)

Security: all SQL uses bound parameters or type-safe values (EXPERT_REVIEW.md C2);
store access is scoped to the JWT `stores` claim via `scoped_stores` (C1).
"""
from datetime import date, timedelta, datetime
from typing import Optional
from fastapi import APIRouter, Depends, Query
from db.model import get_db
from routers.auth import get_current_user, require_admin
from routers.common import (DB_LOCK, allowed_store_set, q as _q, qdf as _qdf,
                            scoped_stores, store_filter, item_fields_sql)
from services.scheduler import on_open_sync, trigger_full_load, get_sync_state

router = APIRouter(tags=["sales"])

# ── Dimension cache (refreshed daily or on new SID) ───────────────────────────
_dim_cache: dict = {}
_dim_loaded_at: datetime | None = None

def _load_dims() -> None:
    """Cache all dimension tables in memory to avoid repeated DuckDB scans."""
    global _dim_cache, _dim_loaded_at
    _dim_cache = {
        "stores":    _qdf("SELECT SID, STORE_NAME FROM DIM_STORE ORDER BY STORE_NAME"),
        "employees": _qdf("SELECT SID, FULL_NAME   FROM DIM_EMPLOYEE ORDER BY FULL_NAME"),
        "customers": _qdf("SELECT SID, FULL_NAME   FROM DIM_CUSTOMER ORDER BY FULL_NAME"),
    }
    _dim_loaded_at = datetime.utcnow()

_dim_sid_checked_at: datetime | None = None   # throttle the SID staleness check

def _ensure_dims() -> None:
    """Refresh dim cache if older than 24 h or if new store SID detected (checked hourly)."""
    global _dim_loaded_at, _dim_sid_checked_at
    now   = datetime.utcnow()
    age   = (now - _dim_loaded_at).total_seconds() if _dim_loaded_at else 99_999
    stale = age > 86_400  # hard 24-hour refresh

    if not stale:
        # Only run the MAX-SID staleness check once per hour to avoid per-request table scans
        sid_age = (now - _dim_sid_checked_at).total_seconds() if _dim_sid_checked_at else 99_999
        if sid_age > 3_600:
            _dim_sid_checked_at = now
            try:
                cached_sids = {r["SID"] for r in _dim_cache.get("stores", [])}
                live_max = _q("SELECT MAX(STORE_SID) FROM FACT_SALES_DAILY")[0][0]
                if live_max and live_max not in cached_sids:
                    stale = True
            except Exception:
                pass

    if stale:
        _load_dims()

def _cached_store_names() -> list[str]:
    _ensure_dims()
    # Check both uppercase and lowercase variations safely
    return [
        (r.get("STORE_NAME") or r.get("store_name"))
        for r in _dim_cache.get("stores", [])
        if (r.get("STORE_NAME") or r.get("store_name"))
    ]


# ── Stores list ────────────────────────────────────────────────────────────────

@router.get("/api/sales/stores-list")
def stores_list(current: dict = Depends(get_current_user)):
    """Store names from the dimension cache, filtered to the user's store scope."""
    names = _cached_store_names()
    allowed = allowed_store_set(current)
    if allowed is None:
        return names
    return [n for n in names if n in allowed]


# ── Employees / Customers lists ────────────────────────────────────────────────

@router.get("/api/sales/employees-list")
def employees_list():
    """Return employee full names from dimension cache."""
    _ensure_dims()
    return [
        (r.get("FULL_NAME") or r.get("full_name"))
        for r in _dim_cache.get("employees", [])
        if (r.get("FULL_NAME") or r.get("full_name"))
    ]

@router.get("/api/sales/customers-list")
def customers_list():
    """Return customer full names from dimension cache."""
    _ensure_dims()
    return [
        (r.get("FULL_NAME") or r.get("full_name"))
        for r in _dim_cache.get("customers", [])
        if (r.get("FULL_NAME") or r.get("full_name"))
    ]

# ── Overview KPIs ──────────────────────────────────────────────────────────────

@router.get("/api/sales/overview")
def overview(stores: Optional[str] = Depends(scoped_stores)):
    sf, sp = store_filter(stores)
    today = date.today()
    yest  = today - timedelta(days=1)
    mtd_s = today.replace(day=1)
    ytd_s = today.replace(month=1, day=1)

    def kpi(date_from: date, date_to: date):
        # ── Daily aggregate (counts + tax + net) ─────────────────────────────
        join = "LEFT JOIN DIM_STORE S ON S.SID = F.STORE_SID" if sf else ""
        r = _q(f"""
            SELECT COALESCE(SUM(F.NET_SALES_WOTAX),0),
                   COALESCE(SUM(F.TOTAL_WTAX),0),
                   COALESCE(SUM(F.SALES_COUNT),0),
                   COALESCE(SUM(F.RETURN_COUNT),0),
                   COALESCE(SUM(F.TOTAL_TAX),0)
            FROM FACT_SALES_DAILY F {join}
            WHERE F.POST_DATE BETWEEN ? AND ? {sf}
        """, [date_from, date_to] + sp)[0]
        net_sales   = round(r[0] or 0, 2)
        total_wtax  = round(r[1] or 0, 2)
        sales_count = int(r[2] or 0)
        ret_count   = int(r[3] or 0)
        total_tax   = round(r[4] or 0, 2)

        # ── Invoice detail (real discounts + split gross/return amounts) ──────
        join2 = "LEFT JOIN DIM_STORE S ON S.SID = F.STORE_SID" if sf else ""
        r2 = _q(f"""
            SELECT
                COALESCE(SUM(
                    COALESCE(F.INVOICE_DISC,0)
                  + COALESCE(F.ITEM_DISC,0)
                  + COALESCE(F.LOYALTY_DISC,0)
                ), 0)                                                         AS total_disc,
                COALESCE(SUM(
                    CASE WHEN F.RECEIPT_TYPE = 0 THEN F.NET_SALES_WOTAX ELSE 0 END
                ), 0)                                                         AS gross_sales,
                ABS(COALESCE(SUM(
                    CASE WHEN F.RECEIPT_TYPE = 1 THEN F.NET_SALES_WOTAX ELSE 0 END
                ), 0))                                                        AS return_amt
            FROM FACT_SALES_INVOICES F {join2}
            WHERE F.INVC_POST_DATE::DATE BETWEEN ? AND ? {sf}
        """, [date_from, date_to] + sp)[0]
        total_disc  = round(r2[0] or 0, 2)
        gross_sales = round(r2[1] or 0, 2)
        return_amt  = round(r2[2] or 0, 2)

        avg_ticket  = round(net_sales / sales_count, 2) if sales_count > 0 else 0
        disc_ratio  = round(total_disc / gross_sales * 100, 1) if gross_sales > 0 else 0
        return_rate = round(return_amt / gross_sales * 100, 1) if gross_sales > 0 else 0

        return {
            "net_sales":    net_sales,
            "total_wtax":   total_wtax,
            "sales_count":  sales_count,
            "return_count": ret_count,
            "total_tax":    total_tax,
            "invoice_disc": total_disc,
            "gross_sales":  gross_sales,
            "return_amt":   return_amt,
            "avg_ticket":   avg_ticket,
            "disc_ratio":   disc_ratio,
            "return_rate":  return_rate,
        }

    import calendar as _cal
    today_obj = today

    # yesterday-comparison for Yesterday card
    prev_day = today_obj - timedelta(days=2)

    # LMTD — last month, same number of days elapsed
    lm_month  = today_obj.month - 1 if today_obj.month > 1 else 12
    lm_year   = today_obj.year      if today_obj.month > 1 else today_obj.year - 1
    lm_last   = _cal.monthrange(lm_year, lm_month)[1]
    lmtd_from = date(lm_year, lm_month, 1)
    lmtd_to   = date(lm_year, lm_month, min(today_obj.day, lm_last))

    # LYTD — last year, same day
    lytd_from = date(today_obj.year - 1, 1, 1)
    try:
        lytd_to = date(today_obj.year - 1, today_obj.month, today_obj.day)
    except ValueError:
        lytd_to = date(today_obj.year - 1, today_obj.month,
                       _cal.monthrange(today_obj.year - 1, today_obj.month)[1])

    return {
        "today":     kpi(today, today),
        "yesterday": kpi(yest,  yest),
        "mtd":       kpi(mtd_s, today),
        "ytd":       kpi(ytd_s, today),
        "prev_day":  kpi(prev_day, prev_day),
        "lmtd":      kpi(lmtd_from, lmtd_to),
        "lytd":      kpi(lytd_from, lytd_to),
    }


# ── Daily trend ────────────────────────────────────────────────────────────────

@router.get("/api/sales/trend")
def trend(
    date_from: date = Query(...),
    date_to:   date = Query(...),
    stores:    Optional[str] = Depends(scoped_stores),
):
    sf, sp = store_filter(stores)
    join = "LEFT JOIN DIM_STORE S ON S.SID = F.STORE_SID" if sf else ""
    return _qdf(f"""
        SELECT F.POST_DATE::VARCHAR            AS day,
               ROUND(SUM(F.NET_SALES_WOTAX),2) AS net_sales,
               ROUND(SUM(F.TOTAL_WTAX),2)       AS total_wtax,
               SUM(F.SALES_COUNT)               AS sales_count,
               SUM(F.RETURN_COUNT)              AS return_count
        FROM FACT_SALES_DAILY F {join}
        WHERE F.POST_DATE BETWEEN ? AND ? {sf}
        GROUP BY F.POST_DATE
        ORDER BY F.POST_DATE
    """, [date_from, date_to] + sp)


# ── Per-store breakdown ────────────────────────────────────────────────────────

@router.get("/api/sales/stores")
def stores_breakdown(
    date_from: date = Query(...),
    date_to:   date = Query(...),
    stores:    Optional[str] = Depends(scoped_stores),
):
    sf, sp = store_filter(stores)
    return _qdf(f"""
        SELECT S.STORE_NAME AS store_name,
               ROUND(SUM(F.NET_SALES_WOTAX),2) AS net_sales,
               ROUND(SUM(F.TOTAL_WTAX),2)       AS total_wtax,
               SUM(F.SALES_COUNT)               AS sales_count,
               SUM(F.RETURN_COUNT)              AS return_count,
               ROUND(SUM(F.INVOICE_DISC),2)     AS invoice_disc
        FROM FACT_SALES_DAILY F
        LEFT JOIN DIM_STORE S ON S.SID = F.STORE_SID
        WHERE F.POST_DATE BETWEEN ? AND ? {sf}
        GROUP BY S.STORE_NAME
        ORDER BY net_sales DESC
    """, [date_from, date_to] + sp)


# ── Top employees ──────────────────────────────────────────────────────────────

@router.get("/api/sales/employees")
def employees(
    date_from: date = Query(...),
    date_to:   date = Query(...),
    stores:    Optional[str] = Depends(scoped_stores),
    limit:     int = Query(15, ge=1, le=1000),
):
    sf, sp = store_filter(stores)
    return _qdf(f"""
        SELECT COALESCE(E.FULL_NAME, '(Unknown)')                    AS employee_name,
               ROUND(SUM(F.NET_SALES_WOTAX),2)                       AS net_sales,
               COUNT(*)                                               AS invoice_count,
               ROUND(SUM(F.NET_SALES_WOTAX)/NULLIF(COUNT(*),0),2)    AS avg_basket
        FROM FACT_SALES_INVOICES F
        LEFT JOIN DIM_STORE    S ON S.SID = F.STORE_SID
        LEFT JOIN DIM_EMPLOYEE E ON E.SID = F.EMPLOYEE1_SID
        WHERE F.INVC_POST_DATE::DATE BETWEEN ? AND ?
          AND F.RECEIPT_TYPE = 0 {sf}
        GROUP BY COALESCE(E.FULL_NAME, '(Unknown)')
        ORDER BY net_sales DESC
        LIMIT {limit}
    """, [date_from, date_to] + sp)


# ── Top products ───────────────────────────────────────────────────────────────

@router.get("/api/sales/products")
def products(
    date_from: date = Query(...),
    date_to:   date = Query(...),
    stores:    Optional[str] = Depends(scoped_stores),
    group_by:  str = Query("item", pattern="^(item|dcs|vendor|department)$"),
    limit:     Optional[int] = Query(None, ge=1),   # no cap unless the caller asks
    item_fields: Optional[str] = Query(None),       # csv of whitelisted DIM_ITEM cols
):
    lim = f"LIMIT {int(limit)}" if limit else ""
    xf  = item_fields_sql(item_fields, agg=True)
    sf, sp  = store_filter(stores)
    base    = f"""
        FROM FACT_SALES_ITEMS F
        LEFT JOIN DIM_STORE  S ON S.SID = F.STORE_SID
        LEFT JOIN DIM_ITEM   I ON I.SID = F.ITEM_SID
        LEFT JOIN DIM_DCS    D ON D.SID = I.DCS_SID  AND D.SBS_SID = I.SBS_SID
        LEFT JOIN DIM_VENDOR V ON V.SID = I.VEND_SID
        WHERE F.INVC_POST_DATE::DATE BETWEEN ? AND ?
          AND F.ITEM_TYPE = 'Sale' {sf}
    """
    params = [date_from, date_to] + sp
    measures = """
               ROUND(SUM(F.QTY),2)                                                       AS qty,
               ROUND(SUM(F.TOTAL_PRICE_WOTAX),2)                                         AS revenue,
               ROUND(SUM(F.TOTAL_COST),2)                                                 AS cost,
               ROUND(SUM(F.TOTAL_PRICE_WOTAX)-SUM(F.TOTAL_COST),2)                       AS gp,
               ROUND((SUM(F.TOTAL_PRICE_WOTAX)-SUM(F.TOTAL_COST))
                     /NULLIF(SUM(F.TOTAL_PRICE_WOTAX),0)*100,1)                          AS gp_pct
    """

    if group_by == "item":
        # Try with UPC (may not exist in all schemas); fall back without it
        try:
            return _qdf(f"""
                SELECT I.ALU, I.UPC, I.DESCRIPTION1, V.VEND_NAME, D.DCS_CODE,
                       {measures} {xf}
                {base}
                GROUP BY I.ALU, I.UPC, I.DESCRIPTION1, V.VEND_NAME, D.DCS_CODE
                ORDER BY revenue DESC {lim}
            """, params)
        except Exception:
            return _qdf(f"""
                SELECT I.ALU, NULL AS upc, I.DESCRIPTION1, V.VEND_NAME, D.DCS_CODE,
                       {measures}
                {base}
                GROUP BY I.ALU, I.DESCRIPTION1, V.VEND_NAME, D.DCS_CODE
                ORDER BY revenue DESC {lim}
            """, params)

    if group_by == "dcs":
        return _qdf(f"""
            SELECT D.DCS_CODE, D.D_NAME AS department, D.C_NAME AS class,
                   D.S_NAME AS subclass,
                   {measures}
            {base}
            GROUP BY D.DCS_CODE, D.D_NAME, D.C_NAME, D.S_NAME
            ORDER BY revenue DESC {lim}
        """, params)

    if group_by == "vendor":
        return _qdf(f"""
            SELECT V.VEND_NAME AS name,
                   {measures}
            {base}
            GROUP BY V.VEND_NAME
            ORDER BY revenue DESC {lim}
        """, params)

    # department
    return _qdf(f"""
        SELECT D.D_NAME AS name,
               {measures}
        {base}
        GROUP BY D.D_NAME
        ORDER BY revenue DESC {lim}
    """, params)


# ── Transactions ───────────────────────────────────────────────────────────────

@router.get("/api/sales/transactions")
def transactions(
    date_from: date = Query(...),
    date_to:   date = Query(...),
    stores:    Optional[str] = Depends(scoped_stores),
    search:    str  = Query(""),
    limit:     Optional[int] = Query(None, ge=0),   # 0 = all rows (frontend sends limit=0); None = no cap
    offset:    int  = Query(0, ge=0),
):
    lim = f"LIMIT {int(limit)}" if limit else ""
    sf, sp = store_filter(stores)
    # Server-side search across doc_no, store, associate, customer (bound param)
    sf2, search_params = "", []
    if search.strip():
        pat = f"%{search.strip()}%"
        sf2 = (
            " AND (F.DOC_NO::VARCHAR ILIKE ?"
            " OR COALESCE(S.STORE_NAME,'') ILIKE ?"
            " OR COALESCE(E.FULL_NAME,'')  ILIKE ?"
            " OR COALESCE(C.FULL_NAME,'')  ILIKE ?)"
        )
        search_params = [pat, pat, pat, pat]
    params = [date_from, date_to] + sp + search_params
    total = _q(f"""
        SELECT COUNT(*)
        FROM FACT_SALES_INVOICES F
        LEFT JOIN DIM_STORE    S ON S.SID = F.STORE_SID
        LEFT JOIN DIM_EMPLOYEE E ON E.SID = F.EMPLOYEE1_SID
        LEFT JOIN DIM_CUSTOMER C ON C.SID = F.BT_CUID
        WHERE F.INVC_POST_DATE::DATE BETWEEN ? AND ? {sf} {sf2}
    """, params)[0][0]
    rows = _qdf(f"""
        SELECT F.DOC_NO                       AS doc_no,
               F.INVC_POST_DATE::VARCHAR      AS post_date,
               S.STORE_NAME                   AS store_name,
               E.FULL_NAME                    AS employee_name,
               C.FULL_NAME                    AS customer_name,
               CASE WHEN F.RECEIPT_TYPE=0 THEN 'Sale'
                    WHEN F.RECEIPT_TYPE=1 THEN 'Return'
                    ELSE 'Order' END          AS type,
               ROUND(F.NET_SALES_WOTAX,2)     AS net_sales,
               ROUND(F.TOTAL_TAX,2)           AS total_tax,
               ROUND(F.TOTAL_WTAX,2)          AS total_wtax,
               ROUND(F.INVOICE_DISC,2)        AS invoice_disc,
               ROUND(F.CASH_AMT,2)            AS cash,
               ROUND(F.CARD_AMT,2)            AS card,
               ROUND(F.DEPOSIT_AMT,2)         AS deposit,
               ROUND(F.OTHER_AMT,2)           AS other
        FROM FACT_SALES_INVOICES F
        LEFT JOIN DIM_STORE    S ON S.SID = F.STORE_SID
        LEFT JOIN DIM_EMPLOYEE E ON E.SID = F.EMPLOYEE1_SID
        LEFT JOIN DIM_CUSTOMER C ON C.SID = F.BT_CUID
        WHERE F.INVC_POST_DATE::DATE BETWEEN ? AND ? {sf} {sf2}
        ORDER BY F.INVC_POST_DATE DESC
        {"" if limit == 0 else f"{lim} OFFSET {offset}"}
    """, params)
    return {"total": int(total), "rows": rows}




# ── Performance: Store detail (invoices-level — real discounts + return rate) ──

@router.get("/api/sales/perf/stores")
def perf_stores(
    date_from: date = Query(...),
    date_to:   date = Query(...),
    stores:    Optional[str] = Depends(scoped_stores),
):
    sf, sp = store_filter(stores)
    return _qdf(f"""
        WITH first_sale AS (
            SELECT COALESCE(S.STORE_NAME, '(Unknown)') AS store_name,
                   MIN(F.INVC_POST_DATE::DATE)::VARCHAR AS first_sale_date
            FROM FACT_SALES_INVOICES F
            LEFT JOIN DIM_STORE S ON S.SID = F.STORE_SID
            WHERE F.RECEIPT_TYPE = 0
            GROUP BY COALESCE(S.STORE_NAME, '(Unknown)')
        ),
        store_ltv AS (
            SELECT COALESCE(S.STORE_NAME, '(Unknown)') AS store_name,
                   ROUND(SUM(CASE WHEN F.RECEIPT_TYPE=0 THEN F.NET_SALES_WOTAX ELSE 0 END),2) AS lifetime_revenue
            FROM FACT_SALES_INVOICES F
            LEFT JOIN DIM_STORE S ON S.SID = F.STORE_SID
            GROUP BY COALESCE(S.STORE_NAME, '(Unknown)')
        )
        SELECT
            COALESCE(S.STORE_NAME, '(Unknown)')                                    AS store_name,
            ROUND(SUM(CASE WHEN F.RECEIPT_TYPE=0 THEN F.NET_SALES_WOTAX ELSE 0 END),2) AS net_sales,
            COUNT(CASE WHEN F.RECEIPT_TYPE=0 THEN 1 END)                           AS invoice_count,
            ABS(ROUND(SUM(CASE WHEN F.RECEIPT_TYPE=1 THEN F.NET_SALES_WOTAX ELSE 0 END),2)) AS return_amt,
            ROUND(
                ABS(SUM(CASE WHEN F.RECEIPT_TYPE=1 THEN F.NET_SALES_WOTAX ELSE 0 END))
                / NULLIF(SUM(CASE WHEN F.RECEIPT_TYPE=0 THEN F.NET_SALES_WOTAX ELSE 0 END),0)
                * 100, 1)                                                           AS return_rate,
            ROUND(SUM(COALESCE(F.INVOICE_DISC,0)+COALESCE(F.ITEM_DISC,0)+COALESCE(F.LOYALTY_DISC,0)),2) AS disc_amt,
            ROUND(
                SUM(COALESCE(F.INVOICE_DISC,0)+COALESCE(F.ITEM_DISC,0)+COALESCE(F.LOYALTY_DISC,0))
                / NULLIF(SUM(CASE WHEN F.RECEIPT_TYPE=0 THEN F.NET_SALES_WOTAX ELSE 0 END),0)
                * 100, 1)                                                           AS disc_rate,
            FS.first_sale_date,
            LTV.lifetime_revenue,
            CASE
                WHEN DATEDIFF('day', FS.first_sale_date::DATE, CURRENT_DATE) < 90  THEN 'New'
                WHEN DATEDIFF('day', FS.first_sale_date::DATE, CURRENT_DATE) < 365 THEN 'Growing'
                ELSE 'Mature'
            END AS lifecycle
        FROM FACT_SALES_INVOICES F
        LEFT JOIN DIM_STORE S   ON S.SID = F.STORE_SID
        LEFT JOIN first_sale FS ON FS.store_name = COALESCE(S.STORE_NAME, '(Unknown)')
        LEFT JOIN store_ltv LTV ON LTV.store_name = COALESCE(S.STORE_NAME, '(Unknown)')
        WHERE F.INVC_POST_DATE::DATE BETWEEN ? AND ? {sf}
        GROUP BY COALESCE(S.STORE_NAME, '(Unknown)'), FS.first_sale_date, LTV.lifetime_revenue
        ORDER BY net_sales DESC
    """, [date_from, date_to] + sp)


# ── Performance: Payment mix ────────────────────────────────────────────────────

@router.get("/api/sales/perf/payment")
def perf_payment(
    date_from: date = Query(...),
    date_to:   date = Query(...),
    stores:    Optional[str] = Depends(scoped_stores),
):
    sf, sp = store_filter(stores)
    return _qdf(f"""
        SELECT
            ROUND(SUM(COALESCE(F.CASH_AMT,0)),2)    AS cash,
            ROUND(SUM(COALESCE(F.CARD_AMT,0)),2)    AS card,
            ROUND(SUM(COALESCE(F.DEPOSIT_AMT,0)),2) AS deposit,
            ROUND(SUM(COALESCE(F.OTHER_AMT,0)),2)   AS other
        FROM FACT_SALES_INVOICES F
        LEFT JOIN DIM_STORE S ON S.SID = F.STORE_SID
        WHERE F.INVC_POST_DATE::DATE BETWEEN ? AND ?
          AND F.RECEIPT_TYPE = 0 {sf}
    """, [date_from, date_to] + sp)


# ── Performance: Hourly heatmap (hour x day-of-week) ───────────────────────────

@router.get("/api/sales/perf/hourly")
def perf_hourly(
    date_from: date = Query(...),
    date_to:   date = Query(...),
    stores:    Optional[str] = Depends(scoped_stores),
):
    sf, sp = store_filter(stores)
    return _qdf(f"""
        SELECT
            EXTRACT(HOUR FROM F.INVC_POST_DATE::TIMESTAMP)       AS hour,
            EXTRACT(DOW  FROM F.INVC_POST_DATE::TIMESTAMP)       AS dow,
            ROUND(SUM(COALESCE(F.NET_SALES_WOTAX,0)),2)          AS net_sales,
            COUNT(*)                                              AS tx_count
        FROM FACT_SALES_INVOICES F
        LEFT JOIN DIM_STORE S ON S.SID = F.STORE_SID
        WHERE F.INVC_POST_DATE::DATE BETWEEN ? AND ?
          AND F.RECEIPT_TYPE = 0 {sf}
        GROUP BY hour, dow
        ORDER BY dow, hour
    """, [date_from, date_to] + sp)


# ── Performance: Associates (enhanced with disc% + return rate%) ────────────────

@router.get("/api/sales/perf/associates")
def perf_associates(
    date_from: date = Query(...),
    date_to:   date = Query(...),
    stores:    Optional[str] = Depends(scoped_stores),
    limit:     int = Query(25, ge=1, le=1000),
):
    sf, sp = store_filter(stores)
    return _qdf(f"""
        SELECT
            COALESCE(E.FULL_NAME, '(Unknown)')                                        AS employee_name,
            COALESCE(S.STORE_NAME, '(Unknown)')                                       AS store_name,
            COUNT(CASE WHEN F.RECEIPT_TYPE=0 THEN 1 END)                              AS invoice_count,
            ROUND(SUM(CASE WHEN F.RECEIPT_TYPE=0 THEN F.NET_SALES_WOTAX ELSE 0 END),2) AS net_sales,
            ROUND(
                SUM(CASE WHEN F.RECEIPT_TYPE=0 THEN F.NET_SALES_WOTAX ELSE 0 END)
                / NULLIF(COUNT(CASE WHEN F.RECEIPT_TYPE=0 THEN 1 END),0), 2)          AS avg_basket,
            ROUND(SUM(COALESCE(F.INVOICE_DISC,0)+COALESCE(F.ITEM_DISC,0)+COALESCE(F.LOYALTY_DISC,0)),2) AS disc_amt,
            ROUND(
                SUM(COALESCE(F.INVOICE_DISC,0)+COALESCE(F.ITEM_DISC,0)+COALESCE(F.LOYALTY_DISC,0))
                / NULLIF(SUM(CASE WHEN F.RECEIPT_TYPE=0 THEN F.NET_SALES_WOTAX ELSE 0 END),0)
                * 100, 1)                                                              AS disc_rate,
            COUNT(CASE WHEN F.RECEIPT_TYPE=1 THEN 1 END)                              AS return_count,
            ABS(ROUND(SUM(CASE WHEN F.RECEIPT_TYPE=1 THEN F.NET_SALES_WOTAX ELSE 0 END),2)) AS return_amt,
            ROUND(
                ABS(SUM(CASE WHEN F.RECEIPT_TYPE=1 THEN F.NET_SALES_WOTAX ELSE 0 END))
                / NULLIF(SUM(CASE WHEN F.RECEIPT_TYPE=0 THEN F.NET_SALES_WOTAX ELSE 0 END),0)
                * 100, 1)                                                              AS return_rate
        FROM FACT_SALES_INVOICES F
        LEFT JOIN DIM_STORE    S ON S.SID = F.STORE_SID
        LEFT JOIN DIM_EMPLOYEE E ON E.SID = F.EMPLOYEE1_SID
        WHERE F.INVC_POST_DATE::DATE BETWEEN ? AND ? {sf}
        GROUP BY COALESCE(E.FULL_NAME,'(Unknown)'), COALESCE(S.STORE_NAME,'(Unknown)')
        ORDER BY net_sales DESC
        LIMIT {limit}
    """, [date_from, date_to] + sp)


# ── Performance: Day-of-week pattern ───────────────────────────────────────────

@router.get("/api/sales/perf/dow")
def perf_dow(
    date_from: date = Query(...),
    date_to:   date = Query(...),
    stores:    Optional[str] = Depends(scoped_stores),
):
    sf, sp = store_filter(stores)
    join = "LEFT JOIN DIM_STORE S ON S.SID = F.STORE_SID" if sf else ""
    return _qdf(f"""
        SELECT
            EXTRACT(DOW FROM F.POST_DATE::TIMESTAMP)         AS dow,
            ROUND(SUM(F.NET_SALES_WOTAX),2)                  AS total_net_sales,
            SUM(F.SALES_COUNT)                               AS total_invoices
        FROM FACT_SALES_DAILY F {join}
        WHERE F.POST_DATE BETWEEN ? AND ? {sf}
        GROUP BY dow
        ORDER BY dow
    """, [date_from, date_to] + sp)


# ── Performance: Basket size distribution ──────────────────────────────────────

@router.get("/api/sales/perf/basket")
def perf_basket(
    date_from: date = Query(...),
    date_to:   date = Query(...),
    stores:    Optional[str] = Depends(scoped_stores),
):
    sf, sp = store_filter(stores)
    return _qdf(f"""
        SELECT
            CASE
                WHEN F.NET_SALES_WOTAX < 50   THEN '0-50'
                WHEN F.NET_SALES_WOTAX < 100  THEN '50-100'
                WHEN F.NET_SALES_WOTAX < 200  THEN '100-200'
                WHEN F.NET_SALES_WOTAX < 500  THEN '200-500'
                ELSE '500+'
            END AS bucket,
            CASE
                WHEN F.NET_SALES_WOTAX < 50   THEN 1
                WHEN F.NET_SALES_WOTAX < 100  THEN 2
                WHEN F.NET_SALES_WOTAX < 200  THEN 3
                WHEN F.NET_SALES_WOTAX < 500  THEN 4
                ELSE 5
            END AS sort_order,
            COUNT(*)                              AS tx_count,
            ROUND(SUM(F.NET_SALES_WOTAX),2)      AS total_sales
        FROM FACT_SALES_INVOICES F
        LEFT JOIN DIM_STORE S ON S.SID = F.STORE_SID
        WHERE F.INVC_POST_DATE::DATE BETWEEN ? AND ?
          AND F.RECEIPT_TYPE = 0 {sf}
        GROUP BY bucket, sort_order
        ORDER BY sort_order
    """, [date_from, date_to] + sp)


# ── Performance: Year-over-Year per store ──────────────────────────────────────

@router.get("/api/sales/perf/yoy_stores")
def perf_yoy_stores(
    date_from: date = Query(...),
    date_to:   date = Query(...),
    py_from:   date = Query(...),
    py_to:     date = Query(...),
    stores:    Optional[str] = Depends(scoped_stores),
):
    """Compare current period vs same window last year, per store."""
    sf, sp = store_filter(stores)
    df, dt, pf, pt = date_from, date_to, py_from, py_to
    return _qdf(f"""
        SELECT
            COALESCE(S.STORE_NAME, '(Unknown)')                               AS store_name,
            ROUND(SUM(CASE
                WHEN F.INVC_POST_DATE::DATE BETWEEN ? AND ?
                     AND F.RECEIPT_TYPE = 0
                THEN F.NET_SALES_WOTAX ELSE 0 END), 2)                        AS current_sales,
            ROUND(SUM(CASE
                WHEN F.INVC_POST_DATE::DATE BETWEEN ? AND ?
                     AND F.RECEIPT_TYPE = 0
                THEN F.NET_SALES_WOTAX ELSE 0 END), 2)                        AS prev_year_sales,
            COUNT(CASE
                WHEN F.INVC_POST_DATE::DATE BETWEEN ? AND ?
                     AND F.RECEIPT_TYPE = 0
                THEN 1 END)                                                    AS current_invoices,
            COUNT(CASE
                WHEN F.INVC_POST_DATE::DATE BETWEEN ? AND ?
                     AND F.RECEIPT_TYPE = 0
                THEN 1 END)                                                    AS prev_invoices
        FROM FACT_SALES_INVOICES F
        LEFT JOIN DIM_STORE S ON S.SID = F.STORE_SID
        WHERE (
            F.INVC_POST_DATE::DATE BETWEEN ? AND ?
         OR F.INVC_POST_DATE::DATE BETWEEN ? AND ?
        ) {sf}
        GROUP BY COALESCE(S.STORE_NAME, '(Unknown)')
        ORDER BY current_sales DESC
        LIMIT 15
    """, [df, dt, pf, pt, df, dt, pf, pt, df, dt, pf, pt] + sp)


# ── Performance: Top customers ─────────────────────────────────────────────────

@router.get("/api/sales/perf/customers")
def perf_customers(
    date_from: date = Query(...),
    date_to:   date = Query(...),
    stores:    Optional[str] = Depends(scoped_stores),
    limit:     Optional[int] = Query(None, ge=1),   # no cap unless the caller asks
):
    lim = f"LIMIT {int(limit)}" if limit else ""
    sf, sp = store_filter(stores)
    return _qdf(f"""
        WITH cust_ltv AS (
            SELECT F.BT_CUID,
                   MIN(F.INVC_POST_DATE::DATE)::VARCHAR                           AS first_visit,
                   ROUND(SUM(CASE WHEN F.RECEIPT_TYPE=0 THEN F.NET_SALES_WOTAX ELSE 0 END),2) AS lifetime_value
            FROM FACT_SALES_INVOICES F
            WHERE F.BT_CUID IS NOT NULL
            GROUP BY F.BT_CUID
        ),
        primary_store AS (
            SELECT BT_CUID, STORE_NAME AS primary_store
            FROM (
                SELECT F.BT_CUID, COALESCE(S.STORE_NAME, '(Unknown)') AS STORE_NAME,
                       ROW_NUMBER() OVER (PARTITION BY F.BT_CUID ORDER BY COUNT(*) DESC) AS rn
                FROM FACT_SALES_INVOICES F
                LEFT JOIN DIM_STORE S ON S.SID = F.STORE_SID
                WHERE F.BT_CUID IS NOT NULL AND F.RECEIPT_TYPE = 0
                GROUP BY F.BT_CUID, COALESCE(S.STORE_NAME, '(Unknown)')
            ) sub WHERE rn = 1
        )
        SELECT
            C.FULL_NAME                                                            AS customer_name,
            MAX(C.PHONE)                                                           AS phone,
            COUNT(*)                                                               AS invoice_count,
            ROUND(SUM(F.NET_SALES_WOTAX),2)                                       AS net_sales,
            ROUND(SUM(F.NET_SALES_WOTAX)/NULLIF(COUNT(*),0),2)                   AS avg_basket,
            MAX(F.INVC_POST_DATE::DATE)::VARCHAR                                  AS last_visit,
            MIN(LTV.first_visit)                                                   AS first_visit,
            MAX(LTV.lifetime_value)                                                AS lifetime_value,
            MAX(PS.primary_store)                                                  AS primary_store
        FROM FACT_SALES_INVOICES F
        LEFT JOIN DIM_STORE    S   ON S.SID   = F.STORE_SID
        -- INNER join: documents with no selected customer (walk-in BT_CUIDs that
        -- don't resolve in DIM_CUSTOMER) are excluded from CRM analytics —
        -- they pooled into a giant '(Unknown)' mega-customer otherwise.
        JOIN DIM_CUSTOMER      C   ON C.SID   = F.BT_CUID
        LEFT JOIN cust_ltv     LTV ON LTV.BT_CUID = F.BT_CUID
        LEFT JOIN primary_store PS ON PS.BT_CUID  = F.BT_CUID
        WHERE F.INVC_POST_DATE::DATE BETWEEN ? AND ?
          AND F.RECEIPT_TYPE = 0
          AND C.FULL_NAME IS NOT NULL AND TRIM(C.FULL_NAME) <> '' {sf}
        GROUP BY C.FULL_NAME
        ORDER BY net_sales DESC
        {lim}
    """, [date_from, date_to] + sp)


# ── Sync endpoints ─────────────────────────────────────────────────────────────

@router.get("/api/sync/trigger")
async def sync_trigger():
    await on_open_sync()
    return {"ok": True, "message": "Incremental sync triggered"}

@router.get("/api/sync/status")
def sync_status():
    return get_sync_state()

@router.post("/api/sync/full-load")
async def sync_full_load(
    tables: Optional[str] = Query(None,
        description="Comma-separated domains: sales,transfers,adjustments,inventory. Omit for all."),
    _admin: dict = Depends(require_admin),
):
    tbl_set = {t.strip() for t in tables.split(",") if t.strip()} if tables else None
    return await trigger_full_load(tables=tbl_set)


# ── Warm dim cache at import time (non-fatal if DB not ready yet) ──────────────
try:
    _load_dims()
except Exception:
    pass  # Will retry lazily on first request
