"""Parallel-burst test: simulates a dashboard page load firing many requests at
once, mixed with logins — catches shared-connection races. Temporary file."""
import json
import threading
import urllib.request

BASE = "http://127.0.0.1:8000"

def post(path, data, headers=None):
    req = urllib.request.Request(BASE + path, data=json.dumps(data).encode(),
                                 headers={"Content-Type": "application/json", **(headers or {})})
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.status, json.loads(r.read())

def get(path, headers):
    req = urllib.request.Request(BASE + path, headers=headers)
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.status

_, login = post("/api/auth/login", {"username": "admin", "password": "Retailtec@123"})
H = {"Authorization": f"Bearer {login['access_token']}"}

URLS = [
    "/api/sales/overview",
    "/api/sales/trend?date_from=2026-06-01&date_to=2026-07-02",
    "/api/sales/products?date_from=2026-06-26&date_to=2026-07-02&group_by=item&limit=10",
    "/api/sales/employees?date_from=2026-07-01&date_to=2026-07-02&limit=8",
    "/api/sales/stores-list",
    "/api/sync/status",
    "/api/sync/coverage",
    "/api/inventory/overview",
    "/api/sales/transactions?date_from=2026-06-01&date_to=2026-07-02",
]

errors = []
lock = threading.Lock()

def worker(i):
    for u in URLS:
        try:
            s = get(u, H)
            if s != 200:
                with lock: errors.append((i, u, s))
        except Exception as e:
            with lock: errors.append((i, u, str(e)))
    # mix in a login (auth query on the same connection)
    try:
        s, _ = post("/api/auth/login", {"username": "admin", "password": "Retailtec@123"})
        if s != 200:
            with lock: errors.append((i, "login", s))
    except Exception as e:
        with lock: errors.append((i, "login", str(e)))

threads = [threading.Thread(target=worker, args=(i,)) for i in range(12)]
for t in threads: t.start()
for t in threads: t.join()

total = 12 * (len(URLS) + 1)
print(f"{total - len(errors)}/{total} requests OK")
for e in errors[:15]:
    print("ERR", e)
raise SystemExit(1 if errors else 0)
