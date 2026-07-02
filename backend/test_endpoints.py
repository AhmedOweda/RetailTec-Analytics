"""Full API sweep — every endpoint each dashboard page calls, with the params the
UI sends. Flags non-200s and suspiciously-empty responses. Run against a live
backend with data loaded for DF..DT."""
import json
import sys
import urllib.parse
import urllib.request

BASE = "http://127.0.0.1:8000"
DF, DT = "2026-04-01", "2026-06-30"
PY_F, PY_T = "2025-04-01", "2025-06-30"

def post(path, data, headers=None):
    req = urllib.request.Request(BASE + path, data=json.dumps(data).encode(),
                                 headers={"Content-Type": "application/json", **(headers or {})})
    with urllib.request.urlopen(req, timeout=120) as r:
        return r.status, json.loads(r.read())

_, login = post("/api/auth/login", {"username": "admin", "password": "Retailtec@123"})
H = {"Authorization": f"Bearer {login['access_token']}"}

D  = f"date_from={DF}&date_to={DT}"

CASES = [
    # (name, path, expect_data)  expect_data: response should be non-empty
    ("sales/overview",        f"/api/sales/overview", True),
    ("sales/trend",           f"/api/sales/trend?{D}", True),
    ("sales/stores",          f"/api/sales/stores?{D}", True),
    ("sales/employees",       f"/api/sales/employees?{D}&limit=8", True),
    ("sales/products item",   f"/api/sales/products?{D}&group_by=item&limit=10", True),
    ("sales/products dcs",    f"/api/sales/products?{D}&group_by=dcs&limit=10", True),
    ("sales/products vendor", f"/api/sales/products?{D}&group_by=vendor&limit=10", True),
    ("sales/products dept",   f"/api/sales/products?{D}&group_by=department&limit=20", True),
    ("sales/transactions",    f"/api/sales/transactions?{D}&limit=50&offset=0", True),
    ("sales/transactions q",  f"/api/sales/transactions?{D}&search=a&limit=10", False),
    ("sales/stores-list",     "/api/sales/stores-list", True),
    ("sales/employees-list",  "/api/sales/employees-list", True),
    ("sales/customers-list",  "/api/sales/customers-list", True),
    ("perf/stores",           f"/api/sales/perf/stores?{D}", True),
    ("perf/payment",          f"/api/sales/perf/payment?{D}", True),
    ("perf/hourly",           f"/api/sales/perf/hourly?{D}", True),
    ("perf/associates",       f"/api/sales/perf/associates?{D}&limit=25", True),
    ("perf/dow",              f"/api/sales/perf/dow?{D}", True),
    ("perf/basket",           f"/api/sales/perf/basket?{D}", True),
    ("perf/yoy_stores",       f"/api/sales/perf/yoy_stores?{D}&py_from={PY_F}&py_to={PY_T}", True),
    ("perf/customers",        f"/api/sales/perf/customers?{D}&limit=20", True),

    ("stores",                "/api/stores", True),
    ("inv/overview",          "/api/inventory/overview", True),
    ("inv/turnover-kpi",      "/api/inventory/turnover-kpi", True),
    ("inv/by-dept",           "/api/inventory/by-dept", True),
    ("inv/by-dcs",            "/api/inventory/by-dcs?limit=500", True),
    ("inv/by-vendor",         "/api/inventory/by-vendor?limit=15", True),
    ("inv/by-store",          "/api/inventory/by-store", True),
    ("inv/items dept",        "/api/inventory/items?group_by=dept&limit=50", True),
    ("inv/items dcs",         "/api/inventory/items?group_by=dcs&limit=50", True),
    ("inv/items vendor",      "/api/inventory/items?group_by=vendor&limit=50", True),
    ("inv/items store",       "/api/inventory/items?group_by=store&limit=50", True),
    ("inv/items item",        "/api/inventory/items?group_by=item&limit=50", True),
    ("inv/items item_store",  "/api/inventory/items?group_by=item_store&limit=50", True),
    ("inv/movement",          f"/api/inventory/movement?{D}", True),
    ("inv/trend",             f"/api/inventory/trend?{D}", True),
    ("inv/movement-by dept",  f"/api/inventory/movement-by?{D}&group_by=dept&limit=50", True),
    ("inv/movement-by dcs",   f"/api/inventory/movement-by?{D}&group_by=dcs&limit=50", True),
    ("inv/movement-by vendor",f"/api/inventory/movement-by?{D}&group_by=vendor&limit=50", True),
    ("inv/movement-by store", f"/api/inventory/movement-by?{D}&group_by=store&limit=50", True),
    ("inv/movement-by item",  f"/api/inventory/movement-by?{D}&group_by=item&limit=50", True),
    ("transfers/kpi",         f"/api/inventory/transfers/kpi?{D}", True),
    ("transfers/trend",       f"/api/inventory/transfers/trend?{D}", True),
    ("transfers/by-store out",f"/api/inventory/transfers/by-store?{D}&direction=out&limit=12", True),
    ("transfers/by-store in", f"/api/inventory/transfers/by-store?{D}&direction=in&limit=12", True),
    ("transfers/by-dept",     f"/api/inventory/transfers/by-dept?{D}&limit=20", True),
    ("transfers/details",     f"/api/inventory/transfers/details?{D}&limit=100", True),
    ("adjust/kpi",            f"/api/inventory/adjustments/kpi?{D}", True),
    ("adjust/trend",          f"/api/inventory/adjustments/trend?{D}", True),
    ("adjust/by-type",        f"/api/inventory/adjustments/by-type?{D}", True),
    ("adjust/by-store",       f"/api/inventory/adjustments/by-store?{D}&limit=15", True),
    ("adjust/details",        f"/api/inventory/adjustments/details?{D}&limit=100", True),
    ("invh/kpi",              f"/api/inventory/history/kpi?{D}", True),
    ("invh/trend",            f"/api/inventory/history/trend?{D}", True),
    ("invh/by-item",          f"/api/inventory/history/by-item?{D}&limit=50", True),
    ("invh/details",          f"/api/inventory/history/details?{D}&limit=100", True),
    ("items-search",          "/api/inventory/items-search?q=a", True),
    ("inv/stores-list",       "/api/inventory/stores-list", True),
    ("ledger",                f"/api/inventory/ledger?{D}&limit=200", True),
    ("ledger/kpi",            f"/api/inventory/ledger/kpi?{D}", True),
    ("inv/coverage",          "/api/inventory/coverage?limit=500", True),
    ("inv/vendors-list",      "/api/inventory/vendors-list", True),
    ("inv/dcs-list",          "/api/inventory/dcs-list", True),

    ("pur/kpi",               f"/api/purchases/kpi?{D}", True),
    ("pur/kpi received",      f"/api/purchases/kpi?{D}&status=received", True),
    ("pur/kpi pending",       f"/api/purchases/kpi?{D}&status=pending", False),
    ("pur/trend",             f"/api/purchases/trend?{D}", True),
    ("pur/by-vendor",         f"/api/purchases/by-vendor?{D}&limit=15", True),
    ("pur/by-dept",           f"/api/purchases/by-dept?{D}&limit=15", True),
    ("pur/by-store",          f"/api/purchases/by-store?{D}", True),
    ("pur/by-status",         f"/api/purchases/by-status?{D}", True),
    ("pur/details",           f"/api/purchases/details?{D}&limit=200", True),
    ("pur/vendors-list",      "/api/purchases/vendors-list", True),

    ("auth/users",            "/api/auth/users", True),
    ("settings",              "/api/settings", True),
    ("sync/status",           "/api/sync/status", True),
    ("sync/coverage",         "/api/sync/coverage", True),
    ("sync/history",          "/api/sync/history?limit=10", True),
    ("sync/table-stats",      "/api/sync/table-stats", True),
]

def is_empty(payload):
    if payload is None:
        return True
    if isinstance(payload, list):
        return len(payload) == 0
    if isinstance(payload, dict):
        for key in ("rows", "runs", "coverage"):
            if key in payload:
                return len(payload[key]) == 0
        nums = [v for v in payload.values() if isinstance(v, (int, float))]
        if nums and all(v == 0 for v in nums):
            return True
    return False

fails, empties = [], []
for name, path, expect_data in CASES:
    try:
        req = urllib.request.Request(BASE + path, headers=H)
        with urllib.request.urlopen(req, timeout=120) as r:
            payload = json.loads(r.read())
        n = len(payload) if isinstance(payload, list) else \
            len(payload.get("rows", [])) if isinstance(payload, dict) and "rows" in payload else "-"
        if expect_data and is_empty(payload):
            empties.append(name)
            print(f"EMPTY {name:<26} ({path[:70]})")
        else:
            print(f"OK    {name:<26} rows={n}")
    except urllib.error.HTTPError as e:
        body = e.read()[:200].decode(errors="replace")
        fails.append((name, e.code, body))
        print(f"FAIL  {name:<26} HTTP {e.code}  {body}")
    except Exception as e:
        fails.append((name, "EXC", str(e)[:150]))
        print(f"FAIL  {name:<26} {str(e)[:150]}")

print(f"\n{len(CASES) - len(fails) - len(empties)}/{len(CASES)} OK, "
      f"{len(empties)} empty, {len(fails)} failed")
sys.exit(1 if fails else 0)
