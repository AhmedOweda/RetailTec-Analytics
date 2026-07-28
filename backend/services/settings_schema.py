"""
Settings schema + backward-compatible migration.
=================================================
Upgrades the legacy flat `data_model` block into the new per-domain shape
(schedules, retention, detail toggle) without losing existing values.
Idempotent: running it on an already-migrated dict returns it unchanged.

Pure logic — unit-testable without Oracle/DuckDB/FastAPI.
"""
from __future__ import annotations

from copy import deepcopy

DOMAINS = ["sales", "inventory", "purchases", "transfers", "adjustments",
           "accounting"]

# Per-domain defaults used only when a field is absent.
_DOMAIN_DEFAULTS = {
    "sales":       {"load_days": 365, "detail": True,  "retain_detail_months": 24},
    "inventory":   {"load_days": 90,  "detail": False, "retain_detail_months": None},
    "purchases":   {"load_days": 365, "detail": True,  "retain_detail_months": None},
    "transfers":   {"load_days": 365, "detail": True,  "retain_detail_months": None},
    "adjustments": {"load_days": 365, "detail": True,  "retain_detail_months": None},
    # Virtual GL (Retail Pro subsidiary 100). Never pruned: an accounting
    # period must stay queryable for as long as the books are open, so
    # retain_detail_months is None by design, not by omission.
    "accounting":  {"load_days": 365, "detail": True,  "retain_detail_months": None},
}

SCHEMA_VERSION = 2

# Incremental overlap window bounds. 30-day floor = rolling self-healing
# window: late postings and sbs-100 DBA deletes inside the last 30 days are
# absorbed by every incremental run (sync.py enforces the same floor).
INCR_DAYS_MIN = 30
INCR_DAYS_MAX = 90


def _clamp_incr_days(v) -> int:
    try:
        v = int(v)
    except (TypeError, ValueError):
        v = INCR_DAYS_MIN
    return min(max(v, INCR_DAYS_MIN), INCR_DAYS_MAX)


def _is_migrated(dm: dict) -> bool:
    doms = dm.get("domains")
    return (
        dm.get("schema_version") == SCHEMA_VERSION
        and isinstance(doms, dict)
        # Every KNOWN domain must be present, not just the ones this file was
        # written with. Without this a settings.json saved before a new domain
        # existed looks "already migrated", is returned untouched, and the new
        # domain never appears in Settings - so it can never be loaded.
        # This is exactly how `accounting` went missing (2026-07-20).
        # The migration below preserves prior per-domain values, so re-running
        # it to backfill one new domain is safe and non-destructive.
        and all(name in doms for name in DOMAINS)
        and all(isinstance(d, dict) and "schedule" in d for d in doms.values())
    )


def migrate_data_model(settings: dict) -> dict:
    """Return a settings dict whose `data_model` is in the current shape.
    Non-destructive: preserves `connection`, `last_sync`, and any extra keys.
    """
    s = deepcopy(settings) if settings else {}
    dm = s.get("data_model") or {}

    if _is_migrated(dm):
        # Still clamp the overlap window: a settings.json saved before the
        # 30-day floor existed (e.g. 7) must come back as 30, not error.
        dm["default_incremental_days"] = _clamp_incr_days(
            dm.get("default_incremental_days", INCR_DAYS_MIN))
        s["data_model"] = dm
        return s

    # Legacy fields (may be absent) become the migration defaults.
    legacy_initial   = int(dm.get("initial_load_days", 365))
    legacy_incr      = _clamp_incr_days(dm.get("incremental_window_days", INCR_DAYS_MIN))
    legacy_bg_min    = int(dm.get("background_refresh_minutes", 30))

    # Preserve any domains block the user already had (partial), else start fresh.
    prior_domains = dm.get("domains") if isinstance(dm.get("domains"), dict) else {}

    new_domains = {}
    for name in DOMAINS:
        d = deepcopy(_DOMAIN_DEFAULTS[name])
        prior = prior_domains.get(name, {}) if isinstance(prior_domains.get(name), dict) else {}
        # keep any explicit prior values
        d.update({k: v for k, v in prior.items() if k != "schedule"})
        # sales inherits the legacy full-load window if it was larger
        if name == "sales":
            d["load_days"] = max(d["load_days"], legacy_initial)
        # schedule: reuse prior schedule if present, else an interval from legacy cadence
        if isinstance(prior.get("schedule"), dict):
            d["schedule"] = prior["schedule"]
        else:
            d["schedule"] = {"mode": "interval", "every_minutes": legacy_bg_min}
        d.setdefault("enabled", True)
        new_domains[name] = d

    new_dm = {
        "schema_version": SCHEMA_VERSION,
        "background_enabled": bool(dm.get("background_enabled", True)),
        "timezone": dm.get("timezone") or "UTC",
        "quiet_hours": dm.get("quiet_hours"),
        "default_incremental_days": legacy_incr,   # kept as the overlap-lookback default
        "domains": new_domains,
    }
    s["data_model"] = new_dm
    return s


# ── Self-test ──────────────────────────────────────────────────────────────────
if __name__ == "__main__":
    # 1) legacy flat shape migrates
    legacy = {
        "connection": {"host": "h", "password": "p"},
        "data_model": {"initial_load_days": 1095,
                       "incremental_window_days": 7,
                       "background_refresh_minutes": 30},
        "last_sync": "2026-06-30T12:00:00",
    }
    m = migrate_data_model(legacy)
    dm = m["data_model"]
    assert dm["schema_version"] == 2
    assert set(dm["domains"]) == set(DOMAINS)
    assert dm["domains"]["sales"]["load_days"] == 1095      # inherited legacy window
    assert dm["domains"]["sales"]["retain_detail_months"] == 24
    assert dm["domains"]["inventory"]["schedule"] == {"mode": "interval", "every_minutes": 30}
    assert m["connection"]["password"] == "p"               # preserved
    assert m["last_sync"] == "2026-06-30T12:00:00"          # preserved

    assert dm["default_incremental_days"] == 30             # legacy 7 clamped to floor

    # 2) idempotent — migrating again changes nothing
    assert migrate_data_model(m) == m

    # 2b) already-migrated dict with a pre-floor overlap value gets clamped
    low = deepcopy(m)
    low["data_model"]["default_incremental_days"] = 7
    assert migrate_data_model(low)["data_model"]["default_incremental_days"] == 30
    high = deepcopy(m)
    high["data_model"]["default_incremental_days"] = 365
    assert migrate_data_model(high)["data_model"]["default_incremental_days"] == 90

    # 3) partial prior domains preserved (custom schedule kept)
    partial = {"data_model": {"domains": {"inventory": {
        "load_days": 45, "schedule": {"mode": "interval", "every_minutes": 15}}}}}
    m3 = migrate_data_model(partial)
    assert m3["data_model"]["domains"]["inventory"]["load_days"] == 45
    assert m3["data_model"]["domains"]["inventory"]["schedule"]["every_minutes"] == 15

    # 4) empty / missing settings doesn't crash
    assert migrate_data_model({})["data_model"]["schema_version"] == 2

    print("settings_schema.py self-test: ALL PASSED")
