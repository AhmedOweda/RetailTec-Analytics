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
"""
from datetime import date, timedelta
from typing import Optional
from fastapi import APIRouter, Query
from db.model import get_db
from services.scheduler import on_open_sync, trigger_full_load, get_sync_state

router = APIRouter(tags=["sales"])


# ── Helpers ────────────────────────────────────────────────────────────────────

def _store_filter(stores: Optional[str], alias: str = "S") -> str:
    """AND S.STORE_NAME IN ('a','b') — empty string when no filter."""
    if not stores:
        return ""
    names = [f"'{s.strip().replace(chr(39), chr(39)*2)}'"
             for s in stores.split(",") if s.strip()]
    return f" AND {alias}.STORE_NAME IN ({','.join(names)})" if names else ""


def _q(sql: str):
    return get_db().execute(sql).fetchall()


def _qdf(sql: str) -> list[dict]:
    con  = get_db()
    rel  = con.execute(sql)
    cols = [d[0] for d in rel.description]
    return [dict(zip(cols, row)) for row in rel.fetchall()]


# ── Stores list ────────────────────────────────────────────────────────────────

@router.get("/api/sales/stores-list")
def stores_list():
    """Return store names that actually have fact data."""
    rows = _q("""
        SELECT DISTINCT S.STORE_NAME
        FROM FACT_SALES_DAILY F
        JOIN DIM_STORE S ON S.SID = F.STORE_SID
        ORDER BY S.STORE_NAME
    """)
    return [r[0] for r in rows if r[0]]


# ── Overview KPIs ──────────────────────────────────────────────────────────────

@router.get("/api/sales/overview")
def overview(stores: Optional[str] = Query(None)):
    sf    = _store_filter(stores)
    today = date.today().isoformat()
    yest  = (date.today() - timedelta(days=1)).isoformat()
    mtd_s = date.today().replace(day=1).isoformat()
    ytd_s = date.today().replace(month=1, day=1).isoformat()

    def kpi(date_from, date_to):
        # ── Daily aggregate (counts + tax + net) ─────────────────────────────
        join = "LEFT JOIN DIM_STORE S ON S.SID = F.STORE_SID" if sf else ""
        r = _q(f"""
            SELECT COALESCE(SUM(F.NET_SALES_WOTAX),0),
                   COALESCE(SUM(F.TOTAL_WTAX),0),
                   COALESCE(SUM(F.SALES_COUNT),0),
                   COALESCE(SUM(F.RETURN_COUNT),0),
                   COALESCE(SUM(F.TOTAL_TAX),0)
            FROM FACT_SALES_DAILY F {join}
            WHERE F.POST_DATE BETWEEN '{date_from}' AND '{date_to}' {sf}
        """)[0]
        net_sales   = round(r[0] or 0, 2)
        total_wtax  = round(r[1] or 0, 2)
        sales_count = int(r[2] or 0)
        ret_count   = int(r[3] or 0)
        total_tax   = round(r[4] or 0, 2)

        # ── Invoice detail (real discounts + split gross/return amounts) ──────
        sf_inv  = _store_filter(stores)
        join2   = "LEFT JOIN DIM_STORE S ON S.SID = F.STORE_SID" if sf_inv else ""
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
            WHERE F.INVC_POST_DATE::DATE BETWEEN '{date_from}' AND '{date_to}' {sf_inv}
        """)[0]
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
    today_obj   = date.today()

    # yesterday-comparison for Yesterday card
    prev_day = (today_obj - timedelta(days=2)).isoformat()

    # LMTD — last month, same number of days elapsed
    lm_month  = today_obj.month - 1 if today_obj.month > 1 else 12
    lm_year   = today_obj.year      if today_obj.month > 1 else today_obj.year - 1
    lm_last   = _cal.monthrange(lm_year, lm_month)[1]
    lmtd_from = date(lm_year, lm_month, 1).isoformat()
    lmtd_to   = date(lm_year, lm_month, min(today_obj.day, lm_last)).isoformat()

    # LYTD — last year, same day
    lytd_from = date(today_obj.year - 1, 1, 1).isoformat()
    try:
        lytd_to = date(today_obj.year - 1, today_obj.month, today_obj.day).isoformat()
    except ValueError:
        lytd_to = date(today_obj.year - 1, today_obj.month,
                       _cal.monthrange(today_obj.year - 1, today_obj.month)[1]).isoformat()

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
    date_from: str = Query(...),
    date_to:   str = Query(...),
    stores:    Optional[str] = Query(None),
):
    sf   = _store_filter(stores)
    join = "LEFT JOIN DIM_STORE S ON S.SID = F.STORE_SID" if sf else ""
    return _qdf(f"""
        SELECT F.POST_DATE::VARCHAR            AS day,
               ROUND(SUM(F.NET_SALES_WOTAX),2) AS net_sales,
               ROUND(SUM(F.TOTAL_WTAX),2)       AS total_wtax,
               SUM(F.SALES_COUNT)               AS sales_count,
               SUM(F.RETURN_COUNT)              AS return_count
        FROM FACT_SALES_DAILY F {join}
        WHERE F.POST_DATE BETWEEN '{date_from}' AND '{date_to}' {sf}
        GROUP BY F.POST_DATE
        ORDER BY F.POST_DATE
    """)


# ── Per-store breakdown ────────────────────────────────────────────────────────

@router.get("/api/sales/stores")
def stores_breakdown(
    date_from: str = Query(...),
    date_to:   str = Query(...),
    stores:    Optional[str] = Query(None),
):
    sf = _store_filter(stores)
    return _qdf(f"""
        SELECT S.STORE_NAME AS store_name,
               ROUND(SUM(F.NET_SALES_WOTAX),2) AS net_sales,
               ROUND(SUM(F.TOTAL_WTAX),2)       AS total_wtax,
               SUM(F.SALES_COUNT)               AS sales_count,
               SUM(F.RETURN_COUNT)              AS return_count,
               ROUND(SUM(F.INVOICE_DISC),2)     AS invoice_disc
        FROM FACT_SALES_DAILY F
        LEFT JOIN DIM_STORE S ON S.SID = F.STORE_SID
        WHERE F.POST_DATE BETWEEN '{date_from}' AND '{date_to}' {sf}
        GROUP BY S.STORE_NAME
        ORDER BY net_sales DESC
    """)


# ── Top employees ──────────────────────────────────────────────────────────────

@router.get("/api/sales/employees")
def employees(
    date_from: str = Query(...),
    date_to:   str = Query(...),
    stores:    Optional[str] = Query(None),
    limit:     int = Query(15),
):
    sf = _store_filter(stores)
    return _qdf(f"""
        SELECT COALESCE(E.FULL_NAME, '(Unknown)')                    AS employee_name,
               ROUND(SUM(F.NET_SALES_WOTAX),2)                       AS net_sales,
               COUNT(*)                                               AS invoice_count,
               ROUND(SUM(F.NET_SALES_WOTAX)/NULLIF(COUNT(*),0),2)    AS avg_basket
        FROM FACT_SALES_INVOICES F
        LEFT JOIN DIM_STORE    S ON S.SID = F.STORE_SID
        LEFT JOIN DIM_EMPLOYEE E ON E.SID = F.EMPLOYEE1_SID
        WHERE F.INVC_POST_DATE::DATE BETWEEN '{date_from}' AND '{date_to}'
          AND F.RECEIPT_TYPE = 0 {sf}
        GROUP BY COALESCE(E.FULL_NAME, '(Unknown)')
        ORDER BY net_sales DESC
        LIMIT {limit}
    """)


# ── Top products ───────────────────────────────────────────────────────────────

@router.get("/api/sales/products")
def products(
    date_from: str = Query(...),
    date_to:   str = Query(...),
    stores:    Optional[str] = Query(None),
    group_by:  str = Query("item", pattern="^(item|dcs|vendor|department)$"),
    limit:     int = Query(20),
):
    sf      = _store_filter(stores)
    base    = f"""
        FROM FACT_SALES_ITEMS F
        LEFT JOIN DIM_STORE  S ON S.SID = F.STORE_SID
        LEFT JOIN DIM_ITEM   I ON I.SID = F.ITEM_SID
        LEFT JOIN DIM_DCS    D ON D.SID = I.DCS_SID  AND D.SBS_SID = I.SBS_SID
        LEFT JOIN DIM_VENDOR V ON V.SID = I.VEND_SID AND V.SBS_SID = I.SBS_SID
        WHERE F.INVC_POST_DATE::DATE BETWEEN '{date_from}' AND '{date_to}'
          AND F.ITEM_TYPE = 'Sale' {sf}
    """
    measures = """
               ROUND(SUM(F.QTY),2)                                                       AS qty,
               ROUND(SUM(F.TOTAL_PRICE_WOTAX),2)                                         AS revenue,
               ROUND(SUM(F.TOTAL_COST),2)                                                 AS cost,
               ROUND(SUM(F.TOTAL_PRICE_WOTAX)-SUM(F.TOTAL_COST),2)                       AS gp,
               ROUND((SUM(F.TOTAL_PRICE_WOTAX)-SUM(F.TOTAL_COST))
                     /NULLIF(SUM(F.TOTAL_PRICE_WOTAX),0)*100,1)                          AS gp_pct
    """

    if group_by == "item":
        return _qdf(f"""
            SELECT I.ALU, I.DESCRIPTION1, V.VEND_NAME, D.DCS_CODE,
                   {measures}
            {base}
            GROUP BY I.ALU, I.DESCRIPTION1, V.VEND_NAME, D.DCS_CODE
            ORDER BY revenue DESC LIMIT {limit}
        """)

    if group_by == "dcs":
        return _qdf(f"""
            SELECT D.DCS_CODE, D.D_NAME AS department, D.C_NAME AS class,
                   D.S_NAME AS subclass,
                   {measures}
            {base}
            GROUP BY D.DCS_CODE, D.D_NAME, D.C_NAME, D.S_NAME
            ORDER BY revenue DESC LIMIT {limit}
        """)

    if group_by == "vendor":
        return _qdf(f"""
            SELECT V.VEND_NAME AS name,
                   {measures}
            {base}
            GROUP BY V.VEND_NAME
            ORDER BY revenue DESC LIMIT {limit}
        """)

    # department
    return _qdf(f"""
        SELECT D.D_NAME AS name,
               {measures}
        {base}
        GROUP BY D.D_NAME
        ORDER BY revenue DESC LIMIT {limit}
    """)


# ── Transactions ───────────────────────────────────────────────────────────────

@router.get("/api/sales/transactions")
def transactions(
    date_from: str  = Query(...),
    date_to:   str  = Query(...),
    stores:    Optional[str] = Query(None),
    search:    str  = Query(""),
    limit:     int  = Query(100),
    offset:    int  = Query(0),
):
    sf  = _store_filter(stores)
    # Server-side search across doc_no, store, associate, customer
    sf2 = ""
    if search.strip():
        q   = search.strip().replace("'", "''")   # escape single quotes
        sf2 = (
            f" AND (F.DOC_NO::VARCHAR ILIKE '%{q}%'"
            f" OR COALESCE(S.STORE_NAME,'') ILIKE '%{q}%'"
            f" OR COALESCE(E.FULL_NAME,'')  ILIKE '%{q}%'"
            f" OR COALESCE(C.FULL_NAME,'')  ILIKE '%{q}%')"
        )
    total = _q(f"""
        SELECT COUNT(*)
        FROM FACT_SALES_INVOICES F
        LEFT JOIN DIM_STORE    S ON S.SID = F.STORE_SID
        LEFT JOIN DIM_EMPLOYEE E ON E.SID = F.EMPLOYEE1_SID
        LEFT JOIN DIM_CUSTOMER C ON C.SID = F.BT_CUID
        WHERE F.INVC_POST_DATE::DATE BETWEEN '{date_from}' AND '{date_to}' {sf} {sf2}
    """)[0][0]
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
        WHERE F.INVC_POST_DATE::DATE BETWEEN '{date_from}' AND '{date_to}' {sf} {sf2}
        ORDER BY F.INVC_POST_DATE DESC
        {"" if limit == 0 else f"LIMIT {limit} OFFSET {offset}"}
    """)
    return {"total": int(total), "rows": rows}


# ── Sync endpoints ─────────────────────────────────────────────────────────────

@router.get("/api/sync/trigger")
async def sync_trigger():
    await on_open_sync()
    return {"ok": True, "message": "Incremental sync triggered"}

@router.get("/api/sync/status")
def sync_status():
    return get_sync_state()

@router.post("/api/sync/full-load")
async def sync_full_load():
    return await trigger_full_load()
