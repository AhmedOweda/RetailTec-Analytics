"""
RetailTec Analytics — FastAPI Backend
Architecture: full-data cache (all stores, grouped by STORE_NAME)
              + Python filter layer (like a PBI semantic model)

Run:  uvicorn main:app --reload --port 8000
"""
import asyncio, hashlib, json, pickle, time
from collections import defaultdict
from pathlib import Path
from datetime import date, timedelta
from typing import Optional

import oracledb
import pandas as pd
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse

# ── Oracle ─────────────────────────────────────────────────────
try:
    oracledb.init_oracle_client(lib_dir=r"C:\db_mcp\instantclient_23_0")
except Exception:
    pass

DB_PORT = 1521
DB_SID  = "rproods"
DB_USER = "reportuser"
DB_PASS = "report"

CACHE_DIR         = Path(__file__).parent / ".rt_cache"
CACHE_CONFIG_FILE = Path(__file__).parent / "cache_config.json"
CACHE_DIR.mkdir(exist_ok=True)

# Per-query timeout (seconds) — all generous since they run in background
QUERY_TIMEOUT = {
    "kpi_by_store":    90,
    "kpi_py_by_store": 60,
    "store":           60,
    "items_by_store":  90,
    "emp_by_store":    60,
    "monthly_by_store":60,
    "txn":             60,
    "trend_by_store":  90,
}

_warmer_state = {
    "running":     False,
    "last_run":    None,
    "last_status": "idle",
    "presets_done": [],
}

app = FastAPI(title="RetailTec Analytics API", version="3.0")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

STEP_LABELS = {
    "kpi_by_store":     "KPI by Store",
    "kpi_py_by_store":  "Prior Year",
    "store":            "Store Performance",
    "items_by_store":   "Top Items",
    "emp_by_store":     "Employee Performance",
    "monthly_by_store": "Monthly Summary",
    "txn":              "Transactions",
    "trend_by_store":   "Daily Sales Trend",
}

# ── DB helpers ─────────────────────────────────────────────────
def get_conn(host: str):
    dsn = oracledb.makedsn(host, DB_PORT, sid=DB_SID)
    conn = oracledb.connect(user=DB_USER, password=DB_PASS, dsn=dsn)
    conn.callTimeout = 85_000   # 85 s Oracle-side kill (< asyncio timeout)
    return conn

def run_query(host: str, sql: str) -> list:
    conn = get_conn(host)
    try:
        df = pd.read_sql(sql, conn)
    finally:
        conn.close()
    return df.where(pd.notnull(df), None).astype(object).to_dict(orient="records")

# ── Disk cache ─────────────────────────────────────────────────
def _ck(*parts) -> str:
    return hashlib.md5("|".join(str(p) for p in parts).encode()).hexdigest()

def cache_load(key: str, ttl: int) -> Optional[dict]:
    f = CACHE_DIR / f"{key}.pkl"
    if f.exists() and (time.time() - f.stat().st_mtime) < ttl:
        try:
            return pickle.loads(f.read_bytes())
        except Exception:
            pass
    return None

def cache_save(key: str, data: dict):
    (CACHE_DIR / f"{key}.pkl").write_bytes(pickle.dumps(data))

def cache_age_sec(key: str) -> Optional[float]:
    f = CACHE_DIR / f"{key}.pkl"
    return (time.time() - f.stat().st_mtime) if f.exists() else None

# ── Cache config ───────────────────────────────────────────────
def load_cache_config() -> dict:
    if CACHE_CONFIG_FILE.exists():
        try:
            return json.loads(CACHE_CONFIG_FILE.read_text(encoding="utf-8"))
        except Exception:
            pass
    return {"enabled": False}

# ── Full-data SQL builders (no store filter, grouped by STORE_NAME) ─
def _fw(date_from: str, date_to: str, it: str) -> str:
    """Base FROM/WHERE for direct queries — ALL stores."""
    return f"""FROM RPS.DOCUMENT DO
JOIN RPS.DOCUMENT_ITEM DI ON DI.DOC_SID=DO.SID
WHERE DO.DOC_NO>0 AND DO.STATUS=4
  AND DI.KIT_FLAG<>5 AND DI.ITEM_TYPE IN {it}
  AND CAST(DO.INVC_POST_DATE AS DATE) >= DATE '{date_from}'
  AND CAST(DO.INVC_POST_DATE AS DATE) <= DATE '{date_to}'"""

def _fw_emp(date_from: str, date_to: str, it: str) -> str:
    return f"""FROM RPS.DOCUMENT DO
JOIN RPS.DOCUMENT_ITEM DI ON DI.DOC_SID=DO.SID
LEFT JOIN RPS.EMPLOYEE EMP ON EMP.SID=DI.EMPLOYEE1_SID
WHERE DO.DOC_NO>0 AND DO.STATUS=4
  AND DI.KIT_FLAG<>5 AND DI.ITEM_TYPE IN {it}
  AND CAST(DO.INVC_POST_DATE AS DATE) >= DATE '{date_from}'
  AND CAST(DO.INVC_POST_DATE AS DATE) <= DATE '{date_to}'"""

def build_full_queries(date_from: str, date_to: str,
                       date_from_py: str, date_to_py: str,
                       it: str = "(1,2)") -> dict:
    """
    All 8 queries with NO store filter — every query groups by STORE_NAME so
    the Python filter layer can aggregate any subset later.
    """
    hint = "/*+ LEADING(DO) INDEX(DO IDX_DOCUMENT7) INDEX(DI IDX_DOCUMENT_ITEM) */"

    p      = ("(CASE WHEN DO.USE_VAT=1 THEN DI.DIP_PRICE ELSE DI.DIP_PRICE+NVL(DI.DIP_TAX_AMT,0) END"
              " - NVL(DI.LTY_PIECE_OF_TBR_DISC_AMT,0))")
    p_wot  = ("(CASE WHEN DO.USE_VAT=1 THEN DI.DIP_PRICE-NVL(DI.DIP_TAX_AMT,0) ELSE DI.DIP_PRICE END"
              " - NVL(DI.LTY_PIECE_OF_TBR_DISC_AMT,0))")
    p_orig = "(CASE WHEN DO.USE_VAT=1 THEN DI.ORIG_PRICE ELSE DI.ORIG_PRICE+NVL(DI.ORIG_TAX_AMT,0) END)"
    # Simplified price for trend (avoids DO.USE_VAT per-row lookup)
    p_trend = "DI.DIP_PRICE - NVL(DI.LTY_PIECE_OF_TBR_DISC_AMT,0)"

    fw     = _fw(date_from, date_to, it)
    fw_e   = _fw_emp(date_from, date_to, it)
    fw_py  = _fw(date_from_py, date_to_py, "(1)")

    return {
        # KPI per store — sum in Python for selection
        "kpi_by_store": f"""SELECT {hint}
    DO.STORE_NAME, DO.STORE_SID,
    COUNT(DISTINCT CASE WHEN DO.RECEIPT_TYPE=0 AND DI.ITEM_TYPE=1 THEN DO.SID END) AS INVOICES,
    COUNT(DISTINCT DO.BT_CUID) AS CUSTOMERS,
    SUM(CASE WHEN DI.ITEM_TYPE=1 THEN DI.QTY*{p} ELSE 0 END)   AS TOTAL_SALES_WTAX,
    SUM(CASE WHEN DI.ITEM_TYPE=2 THEN DI.QTY*{p} ELSE 0 END)   AS TOTAL_RETURNS,
    SUM(DI.QTY*(CASE WHEN DI.ITEM_TYPE=2 THEN -1 ELSE 1 END)*{p}) AS NET_SALES_WTAX,
    SUM(CASE WHEN DI.ITEM_TYPE=1 THEN DI.QTY*{p_wot} ELSE 0 END) AS NET_SALES_WOTAX,
    SUM(DI.QTY*(CASE WHEN DI.ITEM_TYPE=2 THEN -1 ELSE 1 END)*DI.COST) AS TOTAL_COGS,
    SUM(CASE WHEN DI.ITEM_TYPE=1 THEN DI.QTY ELSE 0 END)        AS SOLD_UNITS,
    SUM(CASE WHEN DI.ITEM_TYPE=1 THEN DI.QTY*NVL(DI.DIP_TAX_AMT,0) ELSE 0 END) AS TAX_AMT,
    SUM(CASE WHEN DI.ITEM_TYPE=1 THEN DI.QTY*({p_orig}-{p}) ELSE 0 END) AS DISC_AMT
{fw}
GROUP BY DO.STORE_NAME, DO.STORE_SID
ORDER BY TOTAL_SALES_WTAX DESC""",

        # Prior year sales per store
        "kpi_py_by_store": f"""SELECT {hint}
    DO.STORE_NAME,
    SUM(CASE WHEN DI.ITEM_TYPE=1 THEN DI.QTY*{p} ELSE 0 END) AS TOTAL_SALES_PY
{fw_py}
GROUP BY DO.STORE_NAME
ORDER BY TOTAL_SALES_PY DESC""",

        # Store chart (same as kpi_by_store simplified — already grouped)
        "store": f"""SELECT {hint}
    DO.STORE_NAME,
    SUM(CASE WHEN DI.ITEM_TYPE=1 THEN DI.QTY*{p} ELSE 0 END) AS SALES,
    SUM(CASE WHEN DI.ITEM_TYPE=2 THEN DI.QTY*{p} ELSE 0 END) AS RETURNS,
    SUM(CASE WHEN DI.ITEM_TYPE=1 THEN DI.QTY ELSE 0 END) AS UNITS
{fw}
GROUP BY DO.STORE_NAME
ORDER BY SALES DESC""",

        # Items per store — aggregate by (item, store)
        "items_by_store": f"""SELECT {hint}
    DO.STORE_NAME,
    DI.DESCRIPTION1 AS ITEM_NAME, DI.ALU, DI.DCS_CODE,
    SUM(CASE WHEN DI.ITEM_TYPE=1 THEN DI.QTY ELSE 0 END)        AS UNITS,
    SUM(CASE WHEN DI.ITEM_TYPE=1 THEN DI.QTY*{p} ELSE 0 END)    AS REVENUE,
    SUM(CASE WHEN DI.ITEM_TYPE=1 THEN DI.QTY*DI.COST ELSE 0 END) AS COGS,
    SUM(CASE WHEN DI.ITEM_TYPE=1 THEN DI.QTY*{p_wot} ELSE 0 END)
        - SUM(CASE WHEN DI.ITEM_TYPE=1 THEN DI.QTY*DI.COST ELSE 0 END) AS GROSS_PROFIT
{fw}
GROUP BY DO.STORE_NAME, DI.DESCRIPTION1, DI.ALU, DI.DCS_CODE
ORDER BY REVENUE DESC""",

        # Employees per store
        "emp_by_store": f"""SELECT {hint}
    DO.STORE_NAME,
    NVL(EMP.FULL_NAME,'Unassigned') AS EMPLOYEE,
    COUNT(DISTINCT CASE WHEN DO.RECEIPT_TYPE=0 AND DI.ITEM_TYPE=1 THEN DO.SID END) AS INVOICES,
    SUM(CASE WHEN DI.ITEM_TYPE=1 THEN DI.QTY*{p} ELSE 0 END) AS SALES,
    SUM(CASE WHEN DI.ITEM_TYPE=1 THEN DI.QTY ELSE 0 END) AS UNITS
{fw_e}
GROUP BY DO.STORE_NAME, NVL(EMP.FULL_NAME,'Unassigned')
ORDER BY SALES DESC""",

        # Monthly per store
        "monthly_by_store": f"""SELECT {hint}
    DO.STORE_NAME,
    TO_CHAR(CAST(DO.INVC_POST_DATE AS DATE),'YYYY-MM') AS SALE_MONTH,
    SUM(CASE WHEN DI.ITEM_TYPE=1 THEN DI.QTY*{p} ELSE 0 END)  AS SALES,
    SUM(CASE WHEN DI.ITEM_TYPE=2 THEN DI.QTY*{p} ELSE 0 END)  AS RETURNS,
    SUM(DI.QTY*(CASE WHEN DI.ITEM_TYPE=2 THEN -1 ELSE 1 END)*{p}) AS NET,
    SUM(CASE WHEN DI.ITEM_TYPE=1 THEN DI.QTY*{p_wot} ELSE 0 END)
        - SUM(CASE WHEN DI.ITEM_TYPE=2 THEN -DI.QTY*DI.COST ELSE DI.QTY*DI.COST END) AS GROSS_PROFIT,
    COUNT(DISTINCT CASE WHEN DO.RECEIPT_TYPE=0 AND DI.ITEM_TYPE=1 THEN DO.SID END) AS INVOICES,
    COUNT(DISTINCT CAST(DO.INVC_POST_DATE AS DATE)) AS ACTIVE_DAYS
{fw}
GROUP BY DO.STORE_NAME, TO_CHAR(CAST(DO.INVC_POST_DATE AS DATE),'YYYY-MM')
ORDER BY DO.STORE_NAME, SALE_MONTH""",

        # Transactions — all stores, ordered by date desc (filter in Python)
        "txn": f"""SELECT * FROM (
    SELECT {hint}
        TO_CHAR(CAST(DO.INVC_POST_DATE AS DATE),'YYYY-MM-DD') AS TXN_DATE,
        DO.STORE_NAME, DO.SID AS DOC_SID,
        MAX(NVL(EMP.FULL_NAME,'Unassigned')) AS EMPLOYEE,
        COUNT(*) AS LINE_ITEMS,
        SUM(CASE WHEN DI.ITEM_TYPE=1 THEN DI.QTY*{p} ELSE 0 END)  AS SALES,
        SUM(CASE WHEN DI.ITEM_TYPE=2 THEN DI.QTY*{p} ELSE 0 END)  AS RETURNS,
        SUM(DI.QTY*(CASE WHEN DI.ITEM_TYPE=2 THEN -1 ELSE 1 END)*{p}) AS NET
    {fw_e}
    GROUP BY CAST(DO.INVC_POST_DATE AS DATE), DO.STORE_NAME, DO.SID
    ORDER BY CAST(DO.INVC_POST_DATE AS DATE) DESC, DO.SID DESC
) WHERE ROWNUM<=2000""",

        # Daily trend per store — LAST (heaviest, simplified price)
        "trend_by_store": f"""SELECT {hint}
    DO.STORE_NAME,
    CAST(DO.INVC_POST_DATE AS DATE) AS SALE_DATE,
    SUM(CASE WHEN DI.ITEM_TYPE=1 THEN DI.QTY*({p_trend}) ELSE 0 END) AS SALES,
    SUM(CASE WHEN DI.ITEM_TYPE=2 THEN DI.QTY*({p_trend}) ELSE 0 END) AS RETURNS
{fw}
GROUP BY DO.STORE_NAME, CAST(DO.INVC_POST_DATE AS DATE)
ORDER BY DO.STORE_NAME, SALE_DATE""",
    }


# ── Python filter + aggregate layer ───────────────────────────
def _n(v) -> float:
    return float(v) if v is not None else 0.0

def filter_and_aggregate(full: dict, store_list: Optional[list]) -> dict:
    """
    Given the full-data cache, filter to selected stores and aggregate.
    If store_list is None/empty → return everything (all stores).
    """
    stores = set(store_list) if store_list else None

    def by_store(key: str) -> list:
        rows = full.get(key, [])
        if not stores:
            return rows
        return [r for r in rows if r.get("STORE_NAME") in stores]

    # ── KPI ──────────────────────────────────────────────────────
    kpi_rows = by_store("kpi_by_store")
    kpi_py_rows = by_store("kpi_py_by_store")

    wotax = sum(_n(r.get("NET_SALES_WOTAX")) for r in kpi_rows)
    cogs  = sum(_n(r.get("TOTAL_COGS"))      for r in kpi_rows)
    kpi   = {
        "INVOICES":         sum(_n(r.get("INVOICES"))         for r in kpi_rows),
        "CUSTOMERS":        sum(_n(r.get("CUSTOMERS"))         for r in kpi_rows),
        "STORES":           len(kpi_rows),
        "TOTAL_SALES_WTAX": sum(_n(r.get("TOTAL_SALES_WTAX")) for r in kpi_rows),
        "TOTAL_RETURNS":    sum(_n(r.get("TOTAL_RETURNS"))     for r in kpi_rows),
        "NET_SALES_WTAX":   sum(_n(r.get("NET_SALES_WTAX"))   for r in kpi_rows),
        "NET_SALES_WOTAX":  wotax,
        "TOTAL_COGS":       cogs,
        "GROSS_PROFIT":     wotax - cogs,
        "SOLD_UNITS":       sum(_n(r.get("SOLD_UNITS"))        for r in kpi_rows),
        "TAX_AMT":          sum(_n(r.get("TAX_AMT"))           for r in kpi_rows),
        "DISC_AMT":         sum(_n(r.get("DISC_AMT"))          for r in kpi_rows),
    }
    kpi_py = {
        "TOTAL_SALES_PY": sum(_n(r.get("TOTAL_SALES_PY")) for r in kpi_py_rows)
    }

    # ── Store chart ───────────────────────────────────────────────
    store_rows = sorted(by_store("store"), key=lambda r: -_n(r.get("SALES")))

    # ── Monthly — sum same month across stores ────────────────────
    monthly_map: dict = defaultdict(lambda: {
        "SALES": 0.0, "RETURNS": 0.0, "NET": 0.0,
        "GROSS_PROFIT": 0.0, "INVOICES": 0, "ACTIVE_DAYS": 0,
    })
    for r in by_store("monthly_by_store"):
        m = r["SALE_MONTH"]
        monthly_map[m]["SALE_MONTH"]    = m
        monthly_map[m]["SALES"]        += _n(r.get("SALES"))
        monthly_map[m]["RETURNS"]      += _n(r.get("RETURNS"))
        monthly_map[m]["NET"]          += _n(r.get("NET"))
        monthly_map[m]["GROSS_PROFIT"] += _n(r.get("GROSS_PROFIT"))
        monthly_map[m]["INVOICES"]     += int(_n(r.get("INVOICES")))
        # ACTIVE_DAYS: take max across stores for the same month
        monthly_map[m]["ACTIVE_DAYS"]   = max(
            monthly_map[m]["ACTIVE_DAYS"], int(_n(r.get("ACTIVE_DAYS"))))
    monthly = sorted(monthly_map.values(), key=lambda r: r["SALE_MONTH"])

    # ── Daily trend — sum same date across stores ─────────────────
    trend_map: dict = defaultdict(lambda: {"SALES": 0.0, "RETURNS": 0.0})
    for r in by_store("trend_by_store"):
        d = str(r.get("SALE_DATE", ""))
        trend_map[d]["SALE_DATE"] = r.get("SALE_DATE")
        trend_map[d]["SALES"]    += _n(r.get("SALES"))
        trend_map[d]["RETURNS"]  += _n(r.get("RETURNS"))
    trend = sorted(trend_map.values(), key=lambda r: str(r.get("SALE_DATE", "")))

    # ── Items — sum same item across stores ───────────────────────
    items_map: dict = defaultdict(lambda: {
        "UNITS": 0.0, "REVENUE": 0.0, "COGS": 0.0, "GROSS_PROFIT": 0.0
    })
    for r in by_store("items_by_store"):
        k = (r.get("ALU"), r.get("DCS_CODE"), r.get("ITEM_NAME"))
        items_map[k]["ITEM_NAME"]    = r.get("ITEM_NAME")
        items_map[k]["ALU"]          = r.get("ALU")
        items_map[k]["DCS_CODE"]     = r.get("DCS_CODE")
        items_map[k]["UNITS"]       += _n(r.get("UNITS"))
        items_map[k]["REVENUE"]     += _n(r.get("REVENUE"))
        items_map[k]["COGS"]        += _n(r.get("COGS"))
        items_map[k]["GROSS_PROFIT"]+= _n(r.get("GROSS_PROFIT"))
    items = sorted(items_map.values(), key=lambda r: -r["REVENUE"])[:15]

    # ── Employees — sum same employee across stores ───────────────
    emp_map: dict = defaultdict(lambda: {"INVOICES": 0, "SALES": 0.0, "UNITS": 0.0})
    for r in by_store("emp_by_store"):
        name = r.get("EMPLOYEE", "Unassigned")
        emp_map[name]["EMPLOYEE"] = name
        emp_map[name]["INVOICES"] += int(_n(r.get("INVOICES")))
        emp_map[name]["SALES"]    += _n(r.get("SALES"))
        emp_map[name]["UNITS"]    += _n(r.get("UNITS"))
    emp = sorted(emp_map.values(), key=lambda r: -r["SALES"])[:10]

    # ── Transactions ──────────────────────────────────────────────
    txn = by_store("txn")[:200]

    return {
        "kpi":     [kpi],
        "kpi_py":  [kpi_py],
        "store":   store_rows,
        "monthly": monthly,
        "trend":   trend,
        "items":   items,
        "emp":     emp,
        "txn":     txn,
    }


# ── Background warmer ──────────────────────────────────────────
def _full_cache_key(host: str, date_from: str, date_to: str, it: str) -> str:
    return _ck("full", host, date_from, date_to, it)

async def _warm_one(host: str, date_from: str, date_to: str, it: str, cache_ttl: int) -> str:
    """Fetch full dataset for date range and save to cache. Returns cache key."""
    ck = _full_cache_key(host, date_from, date_to, it)

    # Skip if cache is still younger than half its TTL
    age = cache_age_sec(ck)
    if age is not None and age < cache_ttl * 0.5:
        return ck

    d1, d2     = date.fromisoformat(date_from), date.fromisoformat(date_to)
    date_from_py = str(d1 - timedelta(days=365))
    date_to_py   = str(d2 - timedelta(days=365))

    queries = build_full_queries(date_from, date_to, date_from_py, date_to_py, it)
    results: dict = {}
    loop = asyncio.get_running_loop()

    for k, sql in queries.items():
        timeout = QUERY_TIMEOUT.get(k, 60)
        try:
            rows = await asyncio.wait_for(
                loop.run_in_executor(None, run_query, host, sql),
                timeout=float(timeout),
            )
        except asyncio.TimeoutError:
            rows = []
        except Exception:
            rows = []
        results[k] = rows

    cache_save(ck, results)
    return ck


async def background_warmer():
    global _warmer_state
    await asyncio.sleep(10)  # let uvicorn fully start

    while True:
        cfg = load_cache_config()
        if not cfg.get("enabled", False):
            await asyncio.sleep(60)
            continue

        host      = cfg.get("host", "34.78.79.51")
        it        = "(1,2)"
        cache_ttl = int(cfg.get("cache_ttl_seconds", 1800))
        interval  = int(cfg.get("refresh_interval_minutes", 30))
        presets   = cfg.get("presets", [])

        _warmer_state["running"]      = True
        _warmer_state["last_status"]  = "warming"
        _warmer_state["presets_done"] = []
        today = date.today()

        for preset in presets:
            label      = preset.get("label", "preset")
            range_days = int(preset.get("date_range_days", 30))
            date_from  = preset.get("date_from") or str(today - timedelta(days=range_days))
            date_to    = preset.get("date_to")   or str(today)
            try:
                await _warm_one(host, date_from, date_to, it, cache_ttl)
                _warmer_state["presets_done"].append({"label": label, "ok": True})
            except Exception as e:
                _warmer_state["presets_done"].append({"label": label, "ok": False, "err": str(e)})

        _warmer_state["running"]     = False
        _warmer_state["last_run"]    = time.time()
        _warmer_state["last_status"] = "done"
        await asyncio.sleep(interval * 60)


@app.on_event("startup")
async def startup_event():
    asyncio.create_task(background_warmer())


# ── Helpers ────────────────────────────────────────────────────
def _fmt_age(seconds: int) -> str:
    if seconds < 60:   return f"{seconds}s"
    if seconds < 3600: return f"{seconds // 60}m"
    return f"{seconds // 3600}h {(seconds % 3600) // 60}m"

def _it_str(item_types: str) -> str:
    if item_types in ("1,2,3", "all"): return "(1,2,3)"
    if item_types in ("1", "sales"):   return "(1)"
    if item_types in ("2", "returns"): return "(2)"
    return "(1,2)"


# ── REST endpoints ─────────────────────────────────────────────
@app.get("/api/health")
def health():
    return {"status": "ok", "warmer": _warmer_state["last_status"]}


@app.get("/api/cache/status")
def get_cache_status():
    files = sorted(CACHE_DIR.glob("*.pkl"), key=lambda f: f.stat().st_mtime, reverse=True)
    entries = []
    for f in files:
        age = int(time.time() - f.stat().st_mtime)
        entries.append({
            "key":        f.stem,
            "age_seconds": age,
            "age_human":  _fmt_age(age),
            "size_kb":    round(f.stat().st_size / 1024, 1),
        })
    last = _warmer_state.get("last_run")
    return {
        "warmer_running":     _warmer_state["running"],
        "warmer_last_status": _warmer_state["last_status"],
        "warmer_last_run":    (_fmt_age(int(time.time() - last)) + " ago") if last else "never",
        "warmer_presets":     _warmer_state["presets_done"],
        "cache_entries":      len(entries),
        "entries":            entries,
    }


@app.post("/api/cache/warm")
async def trigger_warm():
    cfg = load_cache_config()
    if not cfg.get("enabled"):
        raise HTTPException(400, "Warmer disabled in cache_config.json")
    host      = cfg.get("host", "34.78.79.51")
    it        = "(1,2)"
    cache_ttl = int(cfg.get("cache_ttl_seconds", 1800))
    today     = date.today()
    warmed    = []
    for preset in cfg.get("presets", []):
        label      = preset.get("label", "?")
        range_days = int(preset.get("date_range_days", 30))
        date_from  = preset.get("date_from") or str(today - timedelta(days=range_days))
        date_to    = preset.get("date_to")   or str(today)
        ck = await _warm_one(host, date_from, date_to, it, cache_ttl)
        warmed.append({"label": label, "key": ck})
    return {"warmed": warmed}


@app.delete("/api/cache")
def clear_cache():
    n = 0
    for f in CACHE_DIR.glob("*.pkl"):
        f.unlink(); n += 1
    _warmer_state["last_status"] = "idle"
    return {"deleted": n}


@app.get("/api/cache/config")
def get_cache_cfg():
    return load_cache_config()


@app.get("/api/subsidiaries")
def get_subsidiaries(host: str = "34.78.79.51"):
    try:
        return run_query(host,
            "SELECT TO_CHAR(SID) AS SID, SBS_NAME AS DESCRIPTION "
            "FROM RPS.SUBSIDIARY WHERE ACTIVE=1 ORDER BY SBS_NAME")
    except Exception as e:
        raise HTTPException(500, str(e))


@app.get("/api/stores")
def get_stores(host: str = "34.78.79.51", subsidiary_sid: Optional[str] = None):
    try:
        where = f"WHERE S.SBS_SID='{subsidiary_sid}'" if subsidiary_sid else ""
        return run_query(host, f"""
            SELECT S.SID, S.STORE_NAME, S.SBS_SID AS SUBSIDIARY_SID,
                   SUB.SBS_NAME AS SUBSIDIARY_NAME
            FROM RPS.STORE S
            LEFT JOIN RPS.SUBSIDIARY SUB ON SUB.SID=S.SBS_SID
            {where}
            ORDER BY SUB.SBS_NAME, S.STORE_NAME""")
    except Exception as e:
        raise HTTPException(500, str(e))


# ── SSE streaming endpoint ─────────────────────────────────────
@app.get("/api/dashboard/stream")
async def dashboard_stream(
    host:       str = "34.78.79.51",
    date_from:  str = "",
    date_to:    str = "",
    stores:     str = "",
    item_types: str = "1,2",
    cache_ttl:  int = 300,
):
    store_list = [s.strip() for s in stores.split(",") if s.strip()] if stores else []
    it = _it_str(item_types)

    # Full-data cache key — no store filter
    full_ck = _full_cache_key(host, date_from, date_to, it)

    async def generate():

        # ── 1. Check full-data cache (fastest path) ────────────────
        full_cached = cache_load(full_ck, cache_ttl)
        if full_cached:
            age = int(cache_age_sec(full_ck) or 0)
            result = filter_and_aggregate(full_cached, store_list or None)
            result["_cached"]    = True
            result["_cache_age"] = age
            yield f"data: {json.dumps({'complete': True, 'cached': True, 'cache_age': age, 'result': result})}\n\n"
            return

        if not store_list:
            yield f"data: {json.dumps({'error': 'No stores selected and no cache available yet. Please wait for the cache warmer to complete.'})}\n\n"
            return

        # ── 2. Live query with store filter (fallback) ─────────────
        # Build store-filtered versions of the full queries
        names = ",".join(f"'{s}'" for s in store_list)
        store_where = f"AND DO.STORE_NAME IN ({names})"

        d1 = date.fromisoformat(date_from)
        d2 = date.fromisoformat(date_to)
        date_from_py = str(d1 - timedelta(days=365))
        date_to_py   = str(d2 - timedelta(days=365))

        def _fw_filtered(df, dt, i):
            return f"""FROM RPS.DOCUMENT DO
JOIN RPS.DOCUMENT_ITEM DI ON DI.DOC_SID=DO.SID
WHERE DO.DOC_NO>0 AND DO.STATUS=4
  AND DI.KIT_FLAG<>5 AND DI.ITEM_TYPE IN {i}
  AND CAST(DO.INVC_POST_DATE AS DATE) >= DATE '{df}'
  AND CAST(DO.INVC_POST_DATE AS DATE) <= DATE '{dt}'
  {store_where}"""

        def _fw_e_filtered(df, dt, i):
            return f"""FROM RPS.DOCUMENT DO
JOIN RPS.DOCUMENT_ITEM DI ON DI.DOC_SID=DO.SID
LEFT JOIN RPS.EMPLOYEE EMP ON EMP.SID=DI.EMPLOYEE1_SID
WHERE DO.DOC_NO>0 AND DO.STATUS=4
  AND DI.KIT_FLAG<>5 AND DI.ITEM_TYPE IN {i}
  AND CAST(DO.INVC_POST_DATE AS DATE) >= DATE '{df}'
  AND CAST(DO.INVC_POST_DATE AS DATE) <= DATE '{dt}'
  {store_where}"""

        # Reuse build_full_queries but inject store filter inline
        fq = build_full_queries(date_from, date_to, date_from_py, date_to_py, it)
        # Inject store filter by replacing the base FROM clause
        store_filtered_queries = {}
        for k, sql in fq.items():
            store_filtered_queries[k] = sql.replace(
                f"AND CAST(DO.INVC_POST_DATE AS DATE) >= DATE '{date_from}'\n  AND CAST(DO.INVC_POST_DATE AS DATE) <= DATE '{date_to}'",
                f"AND CAST(DO.INVC_POST_DATE AS DATE) >= DATE '{date_from}'\n  AND CAST(DO.INVC_POST_DATE AS DATE) <= DATE '{date_to}'\n  {store_where}"
            )

        total   = len(store_filtered_queries)
        results = {}
        loop    = asyncio.get_running_loop()

        for done, (k, sql) in enumerate(store_filtered_queries.items(), start=1):
            err  = None
            rows = []
            timeout = QUERY_TIMEOUT.get(k, 60)
            try:
                rows = await asyncio.wait_for(
                    loop.run_in_executor(None, run_query, host, sql),
                    timeout=float(timeout),
                )
            except asyncio.TimeoutError:
                err = f"Timeout after {timeout}s"
            except Exception as e:
                err = str(e)

            results[k] = rows
            pct = round(done / total * 100)
            yield f"data: {json.dumps({'key': k, 'label': STEP_LABELS.get(k, k), 'done': done, 'total': total, 'pct': pct, 'error': err})}\n\n"

        # Filter/aggregate the live results (store is already filtered, but run through layer for consistency)
        final = filter_and_aggregate(results, None)   # None = already filtered
        final["_cached"]    = False
        final["_cache_age"] = 0
        yield f"data: {json.dumps({'complete': True, 'cached': False, 'cache_age': 0, 'result': final})}\n\n"

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
