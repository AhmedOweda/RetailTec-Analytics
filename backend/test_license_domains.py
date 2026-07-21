"""
test_license_domains.py — licensed-domain gating tests (no Oracle needed).
==========================================================================
Run:  python test_license_domains.py   (from backend/)

1) Unit: licensed_domains()/domain_allowed()/domains_for_path() against
   signed payloads — legacy (no domains field), accounting-only,
   sales+inventory, missing file, tampered signature.
2) HTTP: drives the FastAPI app with a TestClient under each license and
   asserts the middleware's 403/200 behaviour.

Uses a THROWAWAY Ed25519 keypair (patched into services.license) and a temp
license file — never touches the real embedded key or ProgramData license.
"""
import json
import sys
import tempfile
from pathlib import Path

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

import services.license as lic

FAILS = []


def check(name, got, want):
    ok = got == want
    print(f"  {'PASS' if ok else 'FAIL'}  {name}  (got={got!r} want={want!r})")
    if not ok:
        FAILS.append(name)


# ── Throwaway keypair, patched into the license module ──────────────────────
_priv = Ed25519PrivateKey.generate()
_pub_hex = _priv.public_key().public_bytes(
    serialization.Encoding.Raw, serialization.PublicFormat.Raw).hex()
lic._PUBLIC_KEY_HEX = _pub_hex

_tmp = Path(tempfile.mkdtemp()) / "license.json"
lic._resolve_license_file = lambda: _tmp


def install_license(payload, tamper=False):
    """Write a signed test license (or remove it) and bust the domain cache."""
    if payload is None:
        if _tmp.exists():
            _tmp.unlink()
    else:
        sig = _priv.sign(lic._canonical(payload)).hex()
        doc = {"payload": dict(payload), "signature": sig}
        if tamper:
            doc["payload"]["customer"] = "Tampered Co"
        _tmp.write_text(json.dumps(doc))
    lic._dom_cache.update(at=0.0, value=None)


BASE = {"customer": "Test Co", "expiry": "2030-12-31", "issued": "2026-07-21"}
LEGACY     = dict(BASE)                                       # no domains field
ACCT_ONLY  = dict(BASE, domains=["accounting"])
SALES_INV  = dict(BASE, domains=["sales", "inventory"])


print("── Unit: licensed_domains / domain_allowed ──")
install_license(None)
check("no license => all domains", lic.licensed_domains(), None)

install_license(LEGACY)
check("legacy license (no domains field) => all", lic.licensed_domains(), None)
check("legacy: sales allowed", lic.domain_allowed("sales"), True)
check("legacy: path /api/accounting/summary allowed",
      lic.path_allowed("/api/accounting/summary"), True)

install_license(ACCT_ONLY)
check("accounting-only list", lic.licensed_domains(), ["accounting"])
check("accounting-only: accounting allowed", lic.domain_allowed("accounting"), True)
check("accounting-only: sales blocked", lic.domain_allowed("sales"), False)
check("accounting-only: reports blocked", lic.domain_allowed("reports"), False)

install_license(SALES_INV)
check("sales+inventory list", lic.licensed_domains(), ["sales", "inventory"])
check("s+i: inventory allowed", lic.domain_allowed("inventory"), True)
check("s+i: accounting blocked", lic.domain_allowed("accounting"), False)

install_license(ACCT_ONLY, tamper=True)
check("tampered signature => fail open (watermark handles it)",
      lic.licensed_domains(), None)


print("── Unit: endpoint → domain map ──")
M = lic.domains_for_path
check("/api/home/summary -> home",            M("/api/home/summary"), ("home",))
check("/api/assistant/status -> ai",          M("/api/assistant/status"), ("ai",))
check("/api/sales/transactions -> sales",     M("/api/sales/transactions"), ("sales",))
check("/api/inventory/overview -> inventory", M("/api/inventory/overview"), ("inventory",))
check("/api/purchases/kpi -> purchases",      M("/api/purchases/kpi"), ("purchases",))
check("/api/accounting/summary -> accounting", M("/api/accounting/summary"), ("accounting",))
check("/api/reports/email-grid -> reports",   M("/api/reports/email-grid"), ("reports",))
check("/api/admin/reports/send -> reports",   M("/api/admin/reports/send"), ("reports",))
check("/api/admin/alerts -> reports",         M("/api/admin/alerts"), ("reports",))
check("/api/admin/email/test -> reports",     M("/api/admin/email/test"), ("reports",))
check("/api/sales/perf/stores -> sales|dims", M("/api/sales/perf/stores"), ("sales", "dimensions"))
check("/api/sales/products -> sales|dims",    M("/api/sales/products"), ("sales", "dimensions"))
check("/api/purchases/by-vendor -> pur|dims", M("/api/purchases/by-vendor"), ("purchases", "dimensions"))
check("/api/inventory/by-vendor -> inv|dims", M("/api/inventory/by-vendor"), ("inventory", "dimensions"))
check("/api/sales/subsidiaries-list ungated", M("/api/sales/subsidiaries-list"), None)
check("/api/sales/stores-list ungated",       M("/api/sales/stores-list"), None)
check("/api/inventory/items-search ungated",  M("/api/inventory/items-search"), None)
check("/api/sales/journal/search/customers ungated",
      M("/api/sales/journal/search/customers"), None)
check("/api/stores ungated",                  M("/api/stores"), None)
check("/api/settings ungated",                M("/api/settings"), None)
check("/api/settings/status ungated",         M("/api/settings/status"), None)
check("/api/auth/login ungated",              M("/api/auth/login"), None)
check("/api/sync/status ungated",             M("/api/sync/status"), None)
check("/api/admin/backup ungated",            M("/api/admin/backup"), None)
check("/api/admin/diagnostics ungated",       M("/api/admin/diagnostics"), None)
check("/api/admin/license ungated",           M("/api/admin/license"), None)


print("── HTTP: TestClient through the middleware ──")
from fastapi.testclient import TestClient   # noqa: E402
import main                                  # noqa: E402
from db.model import init_db                 # noqa: E402
from routers import auth as auth_mod         # noqa: E402

init_db()
auth_mod._ensure_admin()
token = auth_mod._create_token({"sub": "admin"})
H = {"Authorization": f"Bearer {token}"}
D = {"date_from": "2026-01-01", "date_to": "2026-01-31"}
client = TestClient(main.app, raise_server_exceptions=False)


def st(path, params=None):
    return client.get(path, headers=H, params=params).status_code


print("· accounting-only license")
install_license(ACCT_ONLY)
check("GET /api/accounting/summary -> 200", st("/api/accounting/summary", D), 200)
check("GET /api/sales/transactions -> 403", st("/api/sales/transactions", D), 403)
check("GET /api/settings -> 200",           st("/api/settings"), 200)
check("GET /api/settings/status -> 200",    st("/api/settings/status"), 200)
check("GET /api/home/summary -> 403",       st("/api/home/summary"), 403)
check("GET /api/assistant/status -> 403",   st("/api/assistant/status"), 403)
check("GET /api/reports/history -> 403",    st("/api/reports/history"), 403)
check("GET /api/sales/subsidiaries-list -> 200 (shared header)",
      st("/api/sales/subsidiaries-list"), 200)
r = client.get("/api/sales/transactions", headers=H, params=D)
check("403 body names the domain", "sales" in (r.json().get("detail") or ""), True)
r = client.get("/api/settings/status", headers=H)
check("status exposes licensed_domains", r.json().get("licensed_domains"), ["accounting"])

print("· sales+inventory license")
install_license(SALES_INV)
check("GET /api/sales/transactions -> 200", st("/api/sales/transactions", D), 200)
check("GET /api/accounting/summary -> 403", st("/api/accounting/summary", D), 403)
check("GET /api/purchases/kpi -> 403",      st("/api/purchases/kpi", D), 403)
check("GET /api/sales/perf/stores -> 200 (any-of)", st("/api/sales/perf/stores", D), 200)
check("GET /api/inventory/by-vendor -> 200 (any-of)", st("/api/inventory/by-vendor", D), 200)
check("GET /api/purchases/by-vendor -> 403 (neither licensed)",
      st("/api/purchases/by-vendor", D), 403)

print("· legacy license (no domains field)")
install_license(LEGACY)
check("GET /api/accounting/summary -> 200", st("/api/accounting/summary", D), 200)
check("GET /api/sales/transactions -> 200", st("/api/sales/transactions", D), 200)
check("GET /api/settings -> 200",           st("/api/settings"), 200)
check("GET /api/home/summary -> 200",       st("/api/home/summary"), 200)
check("GET /api/purchases/kpi -> 200",      st("/api/purchases/kpi", D), 200)
r = client.get("/api/settings/status", headers=H)
check("status licensed_domains is null", r.json().get("licensed_domains"), None)

print()
if FAILS:
    print(f"{len(FAILS)} FAILURE(S):")
    for f in FAILS:
        print("  -", f)
    sys.exit(1)
print("ALL TESTS PASSED")
