"""Settings v2 roundtrip test — run with backend venv python. Temporary file."""
import json
from pathlib import Path

from fastapi.testclient import TestClient

import main

client = TestClient(main.app)

def login():
    r = client.post("/api/auth/login", json={"username": "admin", "password": "Retailtec@123"})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}

H = login()
results = []

def check(name, cond, extra=""):
    results.append((name, bool(cond), extra))
    print(("PASS" if cond else "FAIL"), name, extra if not cond else "")

# 1. GET returns migrated v2 shape
r = client.get("/api/settings", headers=H)
check("GET settings 200", r.status_code == 200, r.text[:200])
s = r.json()
check("GET has v2 domains", isinstance(s.get("data_model", {}).get("domains"), dict), json.dumps(s.get("data_model"))[:200])
check("GET schema_version 2", s["data_model"].get("schema_version") == 2)

# 2. PUT v2 with edited schedule persists
dm = s["data_model"]
dm["timezone"] = "Asia/Amman"
dm["quiet_hours"] = {"from": "01:00", "to": "05:00"}
dm["domains"]["inventory"]["schedule"] = {"mode": "interval", "every_minutes": 15}
dm["domains"]["sales"]["schedule"] = {"mode": "times", "times": ["06:00", "18:00"],
                                      "days": ["Mon", "Tue", "Wed"], "timezone": None,
                                      "every_minutes": None}
dm["domains"]["sales"]["load_days"] = 1095
dm["domains"]["sales"]["retain_detail_months"] = 24
payload = {"connection": s["connection"], "data_model": dm}
r = client.put("/api/settings", json=payload, headers=H)
check("PUT v2 200", r.status_code == 200, r.text[:300])

r = client.get("/api/settings", headers=H)
dm2 = r.json()["data_model"]
check("tz persisted", dm2["timezone"] == "Asia/Amman")
check("quiet_hours persisted", dm2["quiet_hours"] == {"from": "01:00", "to": "05:00"}, str(dm2.get("quiet_hours")))
check("inventory interval persisted", dm2["domains"]["inventory"]["schedule"]["every_minutes"] == 15)
check("sales times persisted", dm2["domains"]["sales"]["schedule"]["times"] == ["06:00", "18:00"])
check("sales days persisted", dm2["domains"]["sales"]["schedule"]["days"] == ["Mon", "Tue", "Wed"])
check("sales load_days persisted", dm2["domains"]["sales"]["load_days"] == 1095)
check("retention persisted", dm2["domains"]["sales"]["retain_detail_months"] == 24)

# 3. Validation rejects bad input
bad = json.loads(json.dumps(payload))
bad["data_model"]["domains"]["sales"]["schedule"]["times"] = ["25:99"]
r = client.put("/api/settings", json=bad, headers=H)
check("bad time rejected 422", r.status_code == 422, str(r.status_code))

bad2 = json.loads(json.dumps(payload))
bad2["data_model"]["timezone"] = "Mars/OlympusMons"
r = client.put("/api/settings", json=bad2, headers=H)
check("bad tz rejected 422", r.status_code == 422, str(r.status_code))

bad3 = json.loads(json.dumps(payload))
bad3["data_model"]["domains"]["bogus"] = bad3["data_model"]["domains"]["sales"]
r = client.put("/api/settings", json=bad3, headers=H)
check("unknown domain rejected 422", r.status_code == 422, str(r.status_code))

# 4. Legacy flat shape still accepted
legacy = {"connection": s["connection"],
          "data_model": {"initial_load_days": 365, "incremental_window_days": 7,
                         "background_refresh_minutes": 30}}
r = client.put("/api/settings", json=legacy, headers=H)
check("PUT legacy 200", r.status_code == 200, r.text[:300])
r = client.get("/api/settings", headers=H)
check("legacy migrated on GET", r.json()["data_model"].get("schema_version") == 2)

# 5. restore v2 config
r = client.put("/api/settings", json=payload, headers=H)
check("restore v2 200", r.status_code == 200)

# 6. non-admin cannot save
r = client.put("/api/settings", json=payload)
check("PUT without token 401", r.status_code == 401, str(r.status_code))

fails = [n for n, ok, _ in results if not ok]
print(f"\n{len(results) - len(fails)}/{len(results)} passed")
raise SystemExit(1 if fails else 0)
