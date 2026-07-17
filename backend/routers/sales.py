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
from routers.common import (DB_LOCK, allowed_store_set, allowed_subsidiary_set,
                            q as _q, qdf as _qdf,
                            scoped_stores, store_filter, item_fields_sql,
                            scoped_subsidiaries, subsidiary_filter)
from services.scheduler import (on_open_sync, trigger_full_load, get_sync_state,
                                trigger_dimensions_load)

router = APIRouter(tags=["sales"])

# ── Dimension cache (refreshed daily or on new SID) ───────────────────────────
_dim_cache: dict = {}
_dim_loaded_at: datetime | None = None

def _load_dims() -> None:
    """Cache all dimension tables in memory to avoid repeated DuckDB scans."""
    global _dim_cache, _dim_loaded_at
    _dim_cache = {
        "stores":       _qdf("SELECT SID, STORE_NAME FROM DIM_STORE ORDER BY STORE_NAME"),
        "employees":    _qdf("SELECT SID, FULL_NAME   FROM DIM_EMPLOYEE ORDER BY FULL_NAME"),
        "customers":    _qdf("SELECT SID, FULL_NAME   FROM DIM_CUSTOMER ORDER BY FULL_NAME"),
        "subsidiaries": _qdf("SELECT SID, SBS_NO, SBS_NAME FROM DIM_SUBSIDIARY ORDER BY SBS_NAME"),
    }
    _dim_loaded_at = datetime.utcnow()

_dim_sid_checked_at: datetime | None = None   # throttle the SID staleness check


def invalidate_dim_cache() -> None:
    """Force the next request to reload dims. Called after syncs, server
    switches and restores — the events that change the warehouse contents."""
    global _dim_loaded_at, _dim_sid_checked_at
    _dim_loaded_at = None
    _dim_sid_checked_at = None


def _ensure_dims() -> None:
    """Refresh dim cache if older than 24 h or if new store SID detected (checked hourly)."""
    global _dim_loaded_at, _dim_sid_checked_at
    now   = datetime.utcnow()
    age   = (now - _dim_loaded_at).total_seconds() if _dim_loaded_at else 99_999
    stale = age > 86_400  # hard 24-hour refresh
    # An EMPTY store/subsidiary cache is never worth keeping — the warehouse may
    # have just been filled/switched/restored ("No options" bug, 9 Jul 2026).
    # Retry cheap.
    if not _dim_cache.get("stores") or not _dim_cache.get("subsidiaries"):
        stale = True

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


@router.get("/api/sales/subsidiaries-list")
def subsidiaries_list(current: dict = Depends(get_current_user)):
    """Subsidiaries (SID + name) from the dimension cache, filtered to the user's
    subsidiary scope. The frontend shows the global selector only when more than
    one subsidiary is returned."""
    _ensure_dims()
    rows = _dim_cache.get("subsidiaries", [])
    allowed = allowed_subsidiary_set(current)
    out = [
        {"sid": str(r.get("SID")),
         "name": (r.get("SBS_NAME") or f"Subsidiary {r.get('SBS_NO')}")}
        for r in rows if r.get("SID") is not None
    ]
    if allowed is not None:
        out = [o for o in out if o["sid"] in allowed]
    return out


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
def overview(stores: Optional[str] = Depends(scoped_stores),
             subsidiaries: Optional[str] = Depends(scoped_subsidiaries)):
    sf, sp = store_filter(stores)
    # Sales facts carry SUBSIDIARY_SID directly → filter on the fact alias F
    subf, subp = subsidiary_filter(subsidiaries, alias="F")
    today = date.today()
    yest  = today - timedelta(days=1)
    mtd_s = today.replace(day=1)
    ytd_s = today.replace(month=1, day=1)

    def kpi(date_from: date, date_to: date):
        # ── Daily aggregate (counts + tax + net) ─────────────────────────────
        join = "LEFT JOIN DIM_STORE S ON S.SID = F.STORE_SID" if sf else ""
        # Returns are ITEM-based (ITEM_TYPE=2) and gross sales use the SAME
        # item base (ITEM_TYPE=1) — a sale receipt can contain returned items,
        # so document RECEIPT_TYPE alone under-counts returns.
        r = _q(f"""
            SELECT COALESCE(SUM(F.NET_SALES_WOTAX),0),
                   COALESCE(SUM(F.TOTAL_WTAX),0),
                   COALESCE(SUM(F.SALES_COUNT),0),
                   COALESCE(SUM(F.RETURN_UNITS),0),
                   COALESCE(SUM(F.TOTAL_TAX),0),
                   COALESCE(SUM(F.GROSS_WOTAX),0),
                   COALESCE(SUM(F.RETURN_WOTAX),0)
            FROM FACT_SALES_DAILY F {join}
            WHERE F.POST_DATE BETWEEN ? AND ? {sf} {subf}
        """, [date_from, date_to] + sp + subp)[0]
        net_sales   = round(r[0] or 0, 2)
        total_wtax  = round(r[1] or 0, 2)
        sales_count = int(r[2] or 0)
        ret_count   = int(round(r[3] or 0))          # returned units (item level)
        total_tax   = round(r[4] or 0, 2)
        gross_sales = round(r[5] or 0, 2)
        return_amt  = round(abs(r[6] or 0), 2)

        # ── Invoice detail (real discounts) ──────────────────────────────────
        join2 = "LEFT JOIN DIM_STORE S ON S.SID = F.STORE_SID" if sf else ""
        r2 = _q(f"""
            SELECT
                COALESCE(SUM(
                    COALESCE(F.INVOICE_DISC,0)
                  + COALESCE(F.ITEM_DISC,0)
                  + COALESCE(F.LOYALTY_DISC,0)
                ), 0)                                                         AS total_disc
            FROM FACT_SALES_INVOICES F {join2}
            WHERE F.INVC_POST_DATE::DATE BETWEEN ? AND ? {sf} {subf}
        """, [date_from, date_to] + sp + subp)[0]
        total_disc  = round(r2[0] or 0, 2)

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
    subsidiaries: Optional[str] = Depends(scoped_subsidiaries),
):
    sf, sp = store_filter(stores)
    subf, subp = subsidiary_filter(subsidiaries, alias="F")
    join = "LEFT JOIN DIM_STORE S ON S.SID = F.STORE_SID" if sf else ""
    return _qdf(f"""
        SELECT F.POST_DATE::VARCHAR            AS day,
               ROUND(SUM(F.NET_SALES_WOTAX),2) AS net_sales,
               ROUND(SUM(F.TOTAL_WTAX),2)       AS total_wtax,
               SUM(F.SALES_COUNT)               AS sales_count,
               ROUND(SUM(COALESCE(F.RETURN_UNITS,0)),0) AS return_count,
               ROUND(SUM(COALESCE(F.GROSS_WOTAX,0)),2)  AS gross_sales,
               ROUND(SUM(COALESCE(F.RETURN_WOTAX,0)),2) AS return_amt
        FROM FACT_SALES_DAILY F {join}
        WHERE F.POST_DATE BETWEEN ? AND ? {sf} {subf}
        GROUP BY F.POST_DATE
        ORDER BY F.POST_DATE
    """, [date_from, date_to] + sp + subp)


# ── Per-store breakdown ────────────────────────────────────────────────────────

@router.get("/api/sales/stores")
def stores_breakdown(
    date_from: date = Query(...),
    date_to:   date = Query(...),
    stores:    Optional[str] = Depends(scoped_stores),
    subsidiaries: Optional[str] = Depends(scoped_subsidiaries),
):
    sf, sp = store_filter(stores)
    subf, subp = subsidiary_filter(subsidiaries, alias="F")
    return _qdf(f"""
        SELECT S.STORE_NAME AS store_name,
               ROUND(SUM(F.NET_SALES_WOTAX),2) AS net_sales,
               ROUND(SUM(F.TOTAL_WTAX),2)       AS total_wtax,
               SUM(F.SALES_COUNT)               AS sales_count,
               ROUND(SUM(COALESCE(F.RETURN_UNITS,0)),0) AS return_count,
               ROUND(SUM(F.INVOICE_DISC),2)     AS invoice_disc
        FROM FACT_SALES_DAILY F
        LEFT JOIN DIM_STORE S ON S.SID = F.STORE_SID
        WHERE F.POST_DATE BETWEEN ? AND ? {sf} {subf}
        GROUP BY S.STORE_NAME
        ORDER BY net_sales DESC
    """, [date_from, date_to] + sp + subp)


# ── Top employees ──────────────────────────────────────────────────────────────

@router.get("/api/sales/employees")
def employees(
    date_from: date = Query(...),
    date_to:   date = Query(...),
    stores:    Optional[str] = Depends(scoped_stores),
    subsidiaries: Optional[str] = Depends(scoped_subsidiaries),
    limit:     int = Query(15, ge=1, le=1000),
):
    sf, sp = store_filter(stores)
    subf, subp = subsidiary_filter(subsidiaries, alias="F")
    return _qdf(f"""
        SELECT COALESCE(E.FULL_NAME, '(Unknown)')                    AS employee_name,
               ROUND(SUM(F.NET_SALES_WOTAX),2)                       AS net_sales,
               COUNT(*)                                               AS invoice_count,
               ROUND(SUM(F.NET_SALES_WOTAX)/NULLIF(COUNT(*),0),2)    AS avg_basket
        FROM FACT_SALES_INVOICES F
        LEFT JOIN DIM_STORE    S ON S.SID = F.STORE_SID
        LEFT JOIN DIM_EMPLOYEE E ON E.SID = F.EMPLOYEE1_SID
        WHERE F.INVC_POST_DATE::DATE BETWEEN ? AND ?
          AND F.RECEIPT_TYPE = 0 {sf} {subf}
        GROUP BY COALESCE(E.FULL_NAME, '(Unknown)')
        ORDER BY net_sales DESC
        LIMIT {limit}
    """, [date_from, date_to] + sp + subp)


# ── Top products ───────────────────────────────────────────────────────────────

@router.get("/api/sales/products")
def products(
    date_from: date = Query(...),
    date_to:   date = Query(...),
    stores:    Optional[str] = Depends(scoped_stores),
    subsidiaries: Optional[str] = Depends(scoped_subsidiaries),
    group_by:  str = Query("item", pattern="^(item|dcs|vendor|department)$"),
    limit:     Optional[int] = Query(None, ge=1),   # no cap unless the caller asks
    item_fields: Optional[str] = Query(None),       # csv of whitelisted DIM_ITEM cols
):
    lim = f"LIMIT {int(limit)}" if limit else ""
    xf  = item_fields_sql(item_fields, agg=True)
    sf, sp  = store_filter(stores)
    # FACT_SALES_ITEMS has no SUBSIDIARY_SID → filter via the store's subsidiary (alias S)
    subf, subp = subsidiary_filter(subsidiaries, alias="S")
    base    = f"""
        FROM FACT_SALES_ITEMS F
        LEFT JOIN DIM_STORE  S ON S.SID = F.STORE_SID
        LEFT JOIN DIM_ITEM   I ON I.SID = F.ITEM_SID
        LEFT JOIN DIM_DCS    D ON D.SID = I.DCS_SID  AND D.SBS_SID = I.SBS_SID
        LEFT JOIN DIM_VENDOR V ON V.SID = I.VEND_SID
        WHERE F.INVC_POST_DATE::DATE BETWEEN ? AND ?
          AND F.ITEM_TYPE = 'Sale' {sf} {subf}
    """
    params = [date_from, date_to] + sp + subp
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
    subsidiaries: Optional[str] = Depends(scoped_subsidiaries),
    search:    str  = Query(""),
    limit:     Optional[int] = Query(None, ge=0),   # 0 = all rows (frontend sends limit=0); None = no cap
    offset:    int  = Query(0, ge=0),
):
    lim = f"LIMIT {int(limit)}" if limit else ""
    sf, sp = store_filter(stores)
    subf, subp = subsidiary_filter(subsidiaries, alias="F")
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
    # subsidiary params go with {subf} (placed before {sf2}) to keep ? order correct
    params = [date_from, date_to] + sp + subp + search_params
    total = _q(f"""
        SELECT COUNT(*)
        FROM FACT_SALES_INVOICES F
        LEFT JOIN DIM_STORE    S ON S.SID = F.STORE_SID
        LEFT JOIN DIM_EMPLOYEE E ON E.SID = F.EMPLOYEE1_SID
        LEFT JOIN DIM_CUSTOMER C ON C.SID = F.BT_CUID
        WHERE F.INVC_POST_DATE::DATE BETWEEN ? AND ? {sf} {subf} {sf2}
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
        WHERE F.INVC_POST_DATE::DATE BETWEEN ? AND ? {sf} {subf} {sf2}
        ORDER BY F.INVC_POST_DATE DESC
        {"" if limit == 0 else f"{lim} OFFSET {offset}"}
    """, params)
    return {"total": int(total), "rows": rows}




# ── Journals (master-detail: invoice headers + item lines) ──────────────────

def _multi_ilike(cols, raw, sep="|"):
    """Build a filter for a MULTI-VALUE slicer. `raw` is a sep-joined list of
    tokens (free text or a picked value). Tokens are OR'd (match any); within a
    token, the columns are OR'd (e.g. name OR phone OR id). Returns a fragment
    that STARTS with ' AND (...)' plus its params, or ('', [])."""
    toks = [t.strip() for t in (raw or "").split(sep) if t.strip()]
    if not toks:
        return "", []
    groups, params = [], []
    for t in toks:
        groups.append("(" + " OR ".join(f"{c} ILIKE ?" for c in cols) + ")")
        params += [f"%{t}%"] * len(cols)
    return " AND (" + " OR ".join(groups) + ")", params


def _journal_item_exists(vendor, dcs, item):
    """EXISTS fragment: keep only invoices that contain ≥1 matching line.
    vendor/dcs/item are each a '|'-joined multi-value token list."""
    vf, vp = _multi_ilike(["V2.VEND_NAME"], vendor)
    df, dp = _multi_ilike(["D2.D_NAME", "D2.C_NAME", "D2.S_NAME"], dcs)
    itf, itp = _multi_ilike(["I2.ALU", "I2.DESCRIPTION1"], item)
    inner = f"{vf}{df}{itf}"
    if not inner:
        return "", []
    frag = f"""
        AND EXISTS (SELECT 1 FROM FACT_SALES_ITEMS FI2
            LEFT JOIN DIM_ITEM   I2 ON I2.SID = FI2.ITEM_SID
            LEFT JOIN DIM_DCS    D2 ON D2.SID = I2.DCS_SID AND D2.SBS_SID = I2.SBS_SID
            LEFT JOIN DIM_VENDOR V2 ON V2.SID = I2.VEND_SID
            WHERE FI2.DOC_SID = INV.DOC_SID{inner})
    """
    return frag, vp + dp + itp


@router.get("/api/sales/journal/invoices")
def journal_invoices(
    date_from: date = Query(...),
    date_to:   date = Query(...),
    stores:       Optional[str] = Depends(scoped_stores),
    subsidiaries: Optional[str] = Depends(scoped_subsidiaries),
    type:     Optional[str] = Query(None),   # 'sale' | 'return' | None
    doc_no:   Optional[str] = Query(None),
    customer: Optional[str] = Query(None),
    customer_id: Optional[str] = Query(None),   # exact customer (from the slicer)
    vendor:   Optional[str] = Query(None),
    dcs:      Optional[str] = Query(None),
    item:     Optional[str] = Query(None),
    search:   str = Query(""),
    limit:    Optional[int] = Query(None, ge=0),
    offset:   int = Query(0, ge=0),
):
    sf, sp = store_filter(stores, alias="S")
    subf, subp = subsidiary_filter(subsidiaries, alias="INV")
    where = f"INV.INVC_POST_DATE::DATE BETWEEN ? AND ? {sf} {subf}"
    params = [date_from, date_to] + sp + subp
    if type in ("sale", "return"):
        where += " AND INV.RECEIPT_TYPE = ?"; params.append(0 if type == "sale" else 1)
    if doc_no:
        where += " AND INV.DOC_NO::VARCHAR ILIKE ?"; params.append(f"%{doc_no}%")
    if customer_id:
        where += " AND INV.BT_CUID::VARCHAR = ?"; params.append(str(customer_id))
    cf, cp = _multi_ilike(["C.FULL_NAME", "INV.BT_CUID::VARCHAR", "C.PHONE"], customer)
    where += cf; params += cp
    if search.strip():
        pat = f"%{search.strip()}%"
        where += (" AND (INV.DOC_NO::VARCHAR ILIKE ? OR COALESCE(S.STORE_NAME,'') ILIKE ?"
                  " OR COALESCE(C.FULL_NAME,'') ILIKE ? OR COALESCE(E.FULL_NAME,'') ILIKE ?)")
        params += [pat, pat, pat, pat]
    exf, exp = _journal_item_exists(vendor, dcs, item)
    where += exf; params += exp

    base_from = """
        FROM FACT_SALES_INVOICES INV
        LEFT JOIN DIM_STORE    S ON S.SID = INV.STORE_SID
        LEFT JOIN DIM_CUSTOMER C ON C.SID = INV.BT_CUID
        LEFT JOIN DIM_EMPLOYEE E ON E.SID = INV.EMPLOYEE1_SID
    """
    total = _q(f"SELECT COUNT(*) {base_from} WHERE {where}", params)[0][0]
    lim = f"LIMIT {int(limit)} OFFSET {int(offset)}" if limit else ""
    rows = _qdf(f"""
        SELECT INV.INVC_POST_DATE::VARCHAR   AS created_datetime,
               INV.DOC_SID                   AS doc_sid,
               INV.DOC_NO                    AS doc_no,
               CASE INV.RECEIPT_TYPE WHEN 0 THEN 'Sales' WHEN 1 THEN 'Return' ELSE 'Order' END AS invoice_type,
               S.STORE_CODE                  AS store_code,
               S.STORE_NAME                  AS store_name,
               ROUND(INV.TOTAL_WTAX, 2)      AS net_sales_wtax,
               ROUND(INV.NET_SALES_WOTAX, 2) AS net_sales,
               COALESCE(IC.n, 0)             AS product_count,
               INV.BT_CUID                   AS customer_id,
               C.FULL_NAME                   AS customer_name,
               E.FULL_NAME                   AS associate_name
        {base_from}
        LEFT JOIN (SELECT DOC_SID, COUNT(*) AS n FROM FACT_SALES_ITEMS
                   WHERE INVC_POST_DATE BETWEEN ? AND ? GROUP BY DOC_SID) IC ON IC.DOC_SID = INV.DOC_SID
        WHERE {where}
        ORDER BY INV.INVC_POST_DATE DESC
        {lim}
    """, [date_from, date_to] + params)
    return {"total": int(total), "rows": rows}


@router.get("/api/sales/journal/items")
def journal_items(
    date_from: date = Query(...),
    date_to:   date = Query(...),
    stores:       Optional[str] = Depends(scoped_stores),
    subsidiaries: Optional[str] = Depends(scoped_subsidiaries),
    type:     Optional[str] = Query(None),
    doc_no:   Optional[str] = Query(None),   # drill to one invoice (by document no.)
    doc_sid:  Optional[int] = Query(None),   # legacy drill by internal id
    vendor:   Optional[str] = Query(None),
    dcs:      Optional[str] = Query(None),
    item:     Optional[str] = Query(None),
    limit:    Optional[int] = Query(None, ge=0),
):
    sf, sp = store_filter(stores, alias="S")
    subf, subp = subsidiary_filter(subsidiaries, alias="S")
    where = f"FI.INVC_POST_DATE BETWEEN ? AND ? {sf} {subf}"
    params = [date_from, date_to] + sp + subp
    # Drill preferentially by DOC_NO (a stable string — the invoice SID can lose
    # precision as a JSON number, which broke click-to-drill).
    if doc_no:
        where += " AND INV.DOC_NO::VARCHAR = ?"; params.append(str(doc_no))
    elif doc_sid is not None:
        where += " AND FI.DOC_SID = ?"; params.append(doc_sid)
    if type in ("sale", "return"):
        where += " AND FI.ITEM_TYPE = ?"; params.append("Sale" if type == "sale" else "Return")
    vf, vp = _multi_ilike(["V.VEND_NAME"], vendor);            where += vf; params += vp
    df2, dp2 = _multi_ilike(["D.D_NAME", "D.C_NAME", "D.S_NAME"], dcs); where += df2; params += dp2
    itf, itp = _multi_ilike(["I.ALU", "I.DESCRIPTION1"], item); where += itf; params += itp
    # No cap when drilling a single invoice; a generous safety cap otherwise.
    if doc_no or doc_sid is not None:
        lim = ""
    else:
        lim = f"LIMIT {int(limit)}" if limit else "LIMIT 50000"
    return _qdf(f"""
        SELECT INV.DOC_NO                     AS doc_no,
               FI.ITEM_TYPE                   AS item_type,
               I.ALU                          AS alu,
               I.DESCRIPTION1                 AS description1,
               D.D_NAME                       AS department,
               D.C_NAME                       AS class,
               D.S_NAME                       AS subclass,
               V.VEND_NAME                    AS vendor_name,
               ROUND(FI.QTY, 2)               AS qty,
               ROUND(FI.TOTAL_COST, 2)        AS extended_cost,
               ROUND(FI.TOTAL_PRICE_WOTAX, 2) AS extended_price_after_disc,
               ROUND(FI.TOTAL_ORIG_PRICE_WOTAX - FI.TOTAL_PRICE_WOTAX, 2) AS extended_discount,
               E.FULL_NAME                    AS associate_name,
               INV.EMPLOYEE1_SID              AS associate_id
        FROM FACT_SALES_ITEMS FI
        LEFT JOIN FACT_SALES_INVOICES INV ON INV.DOC_SID = FI.DOC_SID
        LEFT JOIN DIM_STORE    S ON S.SID = FI.STORE_SID
        LEFT JOIN DIM_ITEM     I ON I.SID = FI.ITEM_SID
        LEFT JOIN DIM_DCS      D ON D.SID = I.DCS_SID AND D.SBS_SID = I.SBS_SID
        LEFT JOIN DIM_VENDOR   V ON V.SID = I.VEND_SID
        LEFT JOIN DIM_EMPLOYEE E ON E.SID = INV.EMPLOYEE1_SID
        WHERE {where}
        ORDER BY INV.DOC_NO, I.DESCRIPTION1
        {lim}
    """, params)


# ── Journal slicer type-ahead search endpoints ────────────────────────────────

@router.get("/api/sales/journal/search/customers")
def journal_search_customers(q: str = Query(..., min_length=1, max_length=100)):
    """Search customers by name, id (SID) or phone for the Journals slicer."""
    pat = f"%{q.strip()}%"
    return _qdf("""
        SELECT C.SID::VARCHAR AS customer_id, C.FULL_NAME AS name, C.PHONE AS phone
        FROM DIM_CUSTOMER C
        WHERE C.FULL_NAME ILIKE ? OR C.SID::VARCHAR ILIKE ? OR C.PHONE ILIKE ?
        ORDER BY C.FULL_NAME
        LIMIT 40
    """, [pat, pat, pat])


@router.get("/api/sales/journal/search/vendors")
def journal_search_vendors(q: str = Query(..., min_length=1, max_length=100)):
    """Distinct item-master vendor names matching the query."""
    pat = f"%{q.strip()}%"
    return _qdf("""
        SELECT DISTINCT VEND_NAME AS vendor
        FROM DIM_VENDOR
        WHERE VEND_NAME ILIKE ? AND VEND_NAME IS NOT NULL AND TRIM(VEND_NAME) <> ''
        ORDER BY VEND_NAME
        LIMIT 40
    """, [pat])


@router.get("/api/sales/journal/search/dcs")
def journal_search_dcs(q: str = Query(..., min_length=1, max_length=100)):
    """Distinct department / class / subclass labels matching the query."""
    pat = f"%{q.strip()}%"
    return _qdf("""
        SELECT label, lvl FROM (
            SELECT DISTINCT D_NAME AS label, 'Department' AS lvl FROM DIM_DCS WHERE D_NAME ILIKE ?
            UNION
            SELECT DISTINCT C_NAME AS label, 'Class' AS lvl FROM DIM_DCS WHERE C_NAME ILIKE ?
            UNION
            SELECT DISTINCT S_NAME AS label, 'Subclass' AS lvl FROM DIM_DCS WHERE S_NAME ILIKE ?
        ) t
        WHERE label IS NOT NULL AND TRIM(label) <> ''
        ORDER BY label
        LIMIT 40
    """, [pat, pat, pat])


# ── Home dashboard summary (KPIs + comparison + trend + alerts) ───────────────

@router.get("/api/home/summary")
def home_summary(stores: Optional[str] = Depends(scoped_stores)):
    """One-shot dashboard payload: 30d-vs-prior-30d KPIs, a 30-day trend, top
    stores/items, and computed alerts. Windows anchor to the warehouse's latest
    invoice date (an offline warehouse may lag today)."""
    sf, sp = store_filter(stores, alias="INV")

    kpi = _q(f"""
        WITH b AS (SELECT MAX(INVC_POST_DATE::DATE) AS as_of FROM FACT_SALES_INVOICES),
        inv AS (
            SELECT INV.INVC_POST_DATE::DATE AS d, INV.NET_SALES_WOTAX AS net,
                   INV.RECEIPT_TYPE AS rt, INV.DOC_SID AS doc
            FROM FACT_SALES_INVOICES INV, b
            WHERE INV.INVC_POST_DATE::DATE >= b.as_of - 59 {sf}
        )
        SELECT
          (SELECT as_of FROM b)                                                          AS as_of,
          COALESCE(SUM(CASE WHEN d >= (SELECT as_of FROM b)-29 AND rt=0 THEN net END),0)  AS net_30,
          COALESCE(SUM(CASE WHEN d BETWEEN (SELECT as_of FROM b)-59 AND (SELECT as_of FROM b)-30 AND rt=0 THEN net END),0) AS net_prev,
          COALESCE(SUM(CASE WHEN d = (SELECT as_of FROM b) AND rt=0 THEN net END),0)       AS net_today,
          COUNT(DISTINCT CASE WHEN d >= (SELECT as_of FROM b)-29 AND rt=0 THEN doc END)    AS inv_30,
          COUNT(DISTINCT CASE WHEN d BETWEEN (SELECT as_of FROM b)-59 AND (SELECT as_of FROM b)-30 AND rt=0 THEN doc END) AS inv_prev,
          COALESCE(SUM(CASE WHEN d >= (SELECT as_of FROM b)-29 AND rt=1 THEN net END),0)   AS ret_30
        FROM inv
    """, sp)[0]

    as_of, net_30, net_prev, net_today, inv_30, inv_prev, ret_30 = kpi
    avg_30   = (net_30 / inv_30) if inv_30 else 0
    avg_prev = (net_prev / inv_prev) if inv_prev else 0

    trend = _qdf(f"""
        SELECT INV.INVC_POST_DATE::DATE::VARCHAR AS date,
               ROUND(SUM(CASE WHEN INV.RECEIPT_TYPE=0 THEN INV.NET_SALES_WOTAX ELSE 0 END),2) AS net
        FROM FACT_SALES_INVOICES INV
        WHERE INV.INVC_POST_DATE::DATE >= (SELECT MAX(INVC_POST_DATE::DATE) FROM FACT_SALES_INVOICES) - 29 {sf}
        GROUP BY 1 ORDER BY 1
    """, sp)

    top_stores = _qdf(f"""
        SELECT COALESCE(S.STORE_NAME,'(Unknown)') AS name,
               ROUND(SUM(CASE WHEN INV.RECEIPT_TYPE=0 THEN INV.NET_SALES_WOTAX ELSE 0 END),2) AS net
        FROM FACT_SALES_INVOICES INV LEFT JOIN DIM_STORE S ON S.SID = INV.STORE_SID
        WHERE INV.INVC_POST_DATE::DATE >= (SELECT MAX(INVC_POST_DATE::DATE) FROM FACT_SALES_INVOICES) - 29 {sf}
        GROUP BY 1 ORDER BY net DESC LIMIT 5
    """, sp)

    top_items = _qdf("""
        SELECT I.ALU AS alu, I.DESCRIPTION1 AS name,
               ROUND(SUM(FI.TOTAL_PRICE_WOTAX),2) AS net
        FROM FACT_SALES_ITEMS FI LEFT JOIN DIM_ITEM I ON I.SID = FI.ITEM_SID
        WHERE FI.INVC_POST_DATE::DATE >= (SELECT MAX(INVC_POST_DATE::DATE) FROM FACT_SALES_INVOICES) - 29
          AND FI.ITEM_TYPE = 'Sale'
        GROUP BY 1,2 ORDER BY net DESC LIMIT 5
    """)

    stagnant = _q("""
        SELECT COUNT(*) FROM (
          SELECT ITEM_SID,
            SUM(CASE WHEN INVC_POST_DATE::DATE >= (SELECT MAX(INVC_POST_DATE::DATE) FROM FACT_SALES_INVOICES)-29 THEN QTY ELSE 0 END) AS q30,
            SUM(CASE WHEN INVC_POST_DATE::DATE BETWEEN (SELECT MAX(INVC_POST_DATE::DATE) FROM FACT_SALES_INVOICES)-89
                     AND (SELECT MAX(INVC_POST_DATE::DATE) FROM FACT_SALES_INVOICES)-30 THEN QTY ELSE 0 END) AS qprev
          FROM FACT_SALES_ITEMS
          WHERE INVC_POST_DATE::DATE >= (SELECT MAX(INVC_POST_DATE::DATE) FROM FACT_SALES_INVOICES)-89
          GROUP BY ITEM_SID
        ) t WHERE q30 = 0 AND qprev > 0
    """)[0][0]

    def pct(cur, prev):
        return round((cur - prev) / prev * 100, 1) if prev else None

    dnet   = pct(net_30, net_prev)
    dinv   = pct(inv_30, inv_prev)
    davg   = pct(avg_30, avg_prev)
    ret_rate = (ret_30 / net_30 * 100) if net_30 else 0
    top_share = 0
    if top_stores:
        tot = sum(float(s.get("net") or 0) for s in top_stores)
        top_share = (float(top_stores[0].get("net") or 0) / tot * 100) if tot else 0

    # Warehouse freshness (an offline copy may lag).
    stale_days = None
    try:
        stale_days = (date.today() - as_of).days if as_of else None
    except Exception:
        stale_days = None

    alerts = []
    if stale_days is not None and stale_days >= 2:
        alerts.append({"level": "warning", "title": "Warehouse data is behind",
                       "detail": f"Latest data is {stale_days} days old (as of {as_of}). Run a sync.", "link": "/settings"})
    if dnet is not None and dnet <= -10:
        alerts.append({"level": "warning", "title": "Sales down vs prior 30 days",
                       "detail": f"{dnet:.1f}% vs the previous 30-day period", "link": "/sales/overview"})
    if dnet is not None and dnet >= 10:
        alerts.append({"level": "ok", "title": "Sales growing",
                       "detail": f"Up {dnet:.1f}% vs the previous 30-day period", "link": "/sales/overview"})
    if dinv is not None and dinv <= -10:
        alerts.append({"level": "warning", "title": "Fewer invoices",
                       "detail": f"Invoice count down {abs(dinv):.1f}% vs prior 30 days", "link": "/sales/journals"})
    if davg is not None and davg <= -10:
        alerts.append({"level": "info", "title": "Average basket shrinking",
                       "detail": f"Avg basket down {abs(davg):.1f}% vs prior 30 days", "link": "/sales/performance"})
    if ret_rate >= 5:
        alerts.append({"level": "warning", "title": "Returns elevated",
                       "detail": f"Returns are {ret_rate:.1f}% of net sales (last 30 days)", "link": "/sales/journals?type=return"})
    if stagnant > 0:
        alerts.append({"level": "info", "title": f"{int(stagnant):,} stagnant SKUs",
                       "detail": "Sold in the prior 60 days but nothing in the last 30", "link": "/inventory/coverage"})
    if top_share >= 45:
        alerts.append({"level": "info", "title": "Sales concentrated in one store",
                       "detail": f"Top store is {top_share:.0f}% of the last-30-day sales", "link": "/dimensions/stores"})
    if not alerts:
        alerts.append({"level": "ok", "title": "All clear", "detail": "No threshold alerts for the last 30 days.", "link": ""})

    return {
        "as_of": str(as_of) if as_of else None,
        "kpis": {
            "net_30": net_30, "net_prev": net_prev, "net_delta": pct(net_30, net_prev),
            "net_today": net_today,
            "inv_30": int(inv_30), "inv_prev": int(inv_prev), "inv_delta": pct(inv_30, inv_prev),
            "avg_30": round(avg_30, 2), "avg_prev": round(avg_prev, 2), "avg_delta": pct(avg_30, avg_prev),
        },
        "trend": trend, "top_stores": top_stores, "top_items": top_items,
        "stagnant_skus": int(stagnant), "alerts": alerts,
    }


# ── Performance: Store detail (invoices-level — real discounts + return rate) ──

@router.get("/api/sales/perf/stores")
def perf_stores(
    date_from: date = Query(...),
    date_to:   date = Query(...),
    stores:    Optional[str] = Depends(scoped_stores),
    subsidiaries: Optional[str] = Depends(scoped_subsidiaries),
):
    sf, sp = store_filter(stores)
    # Filter the main period aggregate on the fact's SUBSIDIARY_SID. The lifetime
    # CTEs (first_sale/store_ltv) are intentionally left global, matching how the
    # store filter is not applied to them either.
    subf, subp = subsidiary_filter(subsidiaries, alias="F")
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
            ABS(ROUND(SUM(COALESCE(F.RETURN_WOTAX,0)),2))                          AS return_amt,
            ROUND(
                ABS(SUM(COALESCE(F.RETURN_WOTAX,0)))
                / NULLIF(SUM(COALESCE(F.GROSS_WOTAX,0)),0)
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
        WHERE F.INVC_POST_DATE::DATE BETWEEN ? AND ? {sf} {subf}
        GROUP BY COALESCE(S.STORE_NAME, '(Unknown)'), FS.first_sale_date, LTV.lifetime_revenue
        ORDER BY net_sales DESC
    """, [date_from, date_to] + sp + subp)


# ── Performance: Payment mix ────────────────────────────────────────────────────

@router.get("/api/sales/perf/payment")
def perf_payment(
    date_from: date = Query(...),
    date_to:   date = Query(...),
    stores:    Optional[str] = Depends(scoped_stores),
    subsidiaries: Optional[str] = Depends(scoped_subsidiaries),
):
    sf, sp = store_filter(stores)
    subf, subp = subsidiary_filter(subsidiaries, alias="F")
    return _qdf(f"""
        SELECT
            ROUND(SUM(COALESCE(F.CASH_AMT,0)),2)    AS cash,
            ROUND(SUM(COALESCE(F.CARD_AMT,0)),2)    AS card,
            ROUND(SUM(COALESCE(F.DEPOSIT_AMT,0)),2) AS deposit,
            ROUND(SUM(COALESCE(F.OTHER_AMT,0)),2)   AS other
        FROM FACT_SALES_INVOICES F
        LEFT JOIN DIM_STORE S ON S.SID = F.STORE_SID
        WHERE F.INVC_POST_DATE::DATE BETWEEN ? AND ?
          AND F.RECEIPT_TYPE = 0 {sf} {subf}
    """, [date_from, date_to] + sp + subp)


# ── Performance: Hourly heatmap (hour x day-of-week) ───────────────────────────

@router.get("/api/sales/perf/hourly")
def perf_hourly(
    date_from: date = Query(...),
    date_to:   date = Query(...),
    stores:    Optional[str] = Depends(scoped_stores),
    subsidiaries: Optional[str] = Depends(scoped_subsidiaries),
):
    sf, sp = store_filter(stores)
    subf, subp = subsidiary_filter(subsidiaries, alias="F")
    return _qdf(f"""
        SELECT
            EXTRACT(HOUR FROM F.INVC_POST_DATE::TIMESTAMP)       AS hour,
            EXTRACT(DOW  FROM F.INVC_POST_DATE::TIMESTAMP)       AS dow,
            ROUND(SUM(COALESCE(F.NET_SALES_WOTAX,0)),2)          AS net_sales,
            COUNT(*)                                              AS tx_count
        FROM FACT_SALES_INVOICES F
        LEFT JOIN DIM_STORE S ON S.SID = F.STORE_SID
        WHERE F.INVC_POST_DATE::DATE BETWEEN ? AND ?
          AND F.RECEIPT_TYPE = 0 {sf} {subf}
        GROUP BY hour, dow
        ORDER BY dow, hour
    """, [date_from, date_to] + sp + subp)


# ── Performance: Associates (enhanced with disc% + return rate%) ────────────────

@router.get("/api/sales/perf/associates")
def perf_associates(
    date_from: date = Query(...),
    date_to:   date = Query(...),
    stores:    Optional[str] = Depends(scoped_stores),
    subsidiaries: Optional[str] = Depends(scoped_subsidiaries),
    limit:     int = Query(25, ge=1, le=1000),
):
    sf, sp = store_filter(stores)
    subf, subp = subsidiary_filter(subsidiaries, alias="F")
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
            ROUND(SUM(COALESCE(F.RETURN_UNITS,0)),0)                                  AS return_count,
            ABS(ROUND(SUM(COALESCE(F.RETURN_WOTAX,0)),2))                             AS return_amt,
            ROUND(
                ABS(SUM(COALESCE(F.RETURN_WOTAX,0)))
                / NULLIF(SUM(COALESCE(F.GROSS_WOTAX,0)),0)
                * 100, 1)                                                              AS return_rate
        FROM FACT_SALES_INVOICES F
        LEFT JOIN DIM_STORE    S ON S.SID = F.STORE_SID
        LEFT JOIN DIM_EMPLOYEE E ON E.SID = F.EMPLOYEE1_SID
        WHERE F.INVC_POST_DATE::DATE BETWEEN ? AND ? {sf} {subf}
        GROUP BY COALESCE(E.FULL_NAME,'(Unknown)'), COALESCE(S.STORE_NAME,'(Unknown)')
        ORDER BY net_sales DESC
        LIMIT {limit}
    """, [date_from, date_to] + sp + subp)


# ── Performance: Day-of-week pattern ───────────────────────────────────────────

@router.get("/api/sales/perf/dow")
def perf_dow(
    date_from: date = Query(...),
    date_to:   date = Query(...),
    stores:    Optional[str] = Depends(scoped_stores),
    subsidiaries: Optional[str] = Depends(scoped_subsidiaries),
):
    sf, sp = store_filter(stores)
    subf, subp = subsidiary_filter(subsidiaries, alias="F")
    join = "LEFT JOIN DIM_STORE S ON S.SID = F.STORE_SID" if sf else ""
    return _qdf(f"""
        SELECT
            EXTRACT(DOW FROM F.POST_DATE::TIMESTAMP)         AS dow,
            ROUND(SUM(F.NET_SALES_WOTAX),2)                  AS total_net_sales,
            SUM(F.SALES_COUNT)                               AS total_invoices
        FROM FACT_SALES_DAILY F {join}
        WHERE F.POST_DATE BETWEEN ? AND ? {sf} {subf}
        GROUP BY dow
        ORDER BY dow
    """, [date_from, date_to] + sp + subp)


# ── Performance: Basket size distribution ──────────────────────────────────────

@router.get("/api/sales/perf/basket")
def perf_basket(
    date_from: date = Query(...),
    date_to:   date = Query(...),
    stores:    Optional[str] = Depends(scoped_stores),
    subsidiaries: Optional[str] = Depends(scoped_subsidiaries),
):
    sf, sp = store_filter(stores)
    subf, subp = subsidiary_filter(subsidiaries, alias="F")
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
          AND F.RECEIPT_TYPE = 0 {sf} {subf}
        GROUP BY bucket, sort_order
        ORDER BY sort_order
    """, [date_from, date_to] + sp + subp)


# ── Performance: Year-over-Year per store ──────────────────────────────────────

@router.get("/api/sales/perf/yoy_stores")
def perf_yoy_stores(
    date_from: date = Query(...),
    date_to:   date = Query(...),
    py_from:   date = Query(...),
    py_to:     date = Query(...),
    stores:    Optional[str] = Depends(scoped_stores),
    subsidiaries: Optional[str] = Depends(scoped_subsidiaries),
):
    """Compare current period vs same window last year, per store."""
    sf, sp = store_filter(stores)
    subf, subp = subsidiary_filter(subsidiaries, alias="F")
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
        ) {sf} {subf}
        GROUP BY COALESCE(S.STORE_NAME, '(Unknown)')
        ORDER BY current_sales DESC
        LIMIT 15
    """, [df, dt, pf, pt, df, dt, pf, pt, df, dt, pf, pt] + sp + subp)


# ── Performance: Top customers ─────────────────────────────────────────────────

@router.get("/api/sales/perf/customers")
def perf_customers(
    date_from: date = Query(...),
    date_to:   date = Query(...),
    stores:    Optional[str] = Depends(scoped_stores),
    subsidiaries: Optional[str] = Depends(scoped_subsidiaries),
    limit:     Optional[int] = Query(None, ge=1),   # no cap unless the caller asks
):
    lim = f"LIMIT {int(limit)}" if limit else ""
    sf, sp = store_filter(stores)
    # Main aggregate filtered on the fact's SUBSIDIARY_SID; lifetime CTEs left
    # global (they carry no store filter either).
    subf, subp = subsidiary_filter(subsidiaries, alias="F")
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
            MAX(F.BT_CUID)::VARCHAR                                                AS customer_id,
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
          AND C.FULL_NAME IS NOT NULL AND TRIM(C.FULL_NAME) <> '' {sf} {subf}
        GROUP BY C.FULL_NAME
        ORDER BY net_sales DESC
        {lim}
    """, [date_from, date_to] + sp + subp)


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

@router.post("/api/sync/dimensions-load")
async def sync_dimensions_load(_admin: dict = Depends(require_admin)):
    """Fresh reload of dimension tables only (stores, subsidiaries, employees,
    DCS, vendors, customers, items). Fact data is untouched."""
    return await trigger_dimensions_load()


# ── Warm dim cache at import time (non-fatal if DB not ready yet) ──────────────
try:
    _load_dims()
except Exception:
    pass  # Will retry lazily on first request
