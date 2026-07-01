"""
Schedule engine — Power BI-style scheduled refresh, per domain.
================================================================
Pure, side-effect-free logic so it can be unit-tested without Oracle/DuckDB.

A domain schedule is one of:
  { "mode": "manual" }
  { "mode": "interval", "every_minutes": 15 }
  { "mode": "times", "times": ["06:00","18:00"], "days": ["Mon","Tue"], "timezone": "Asia/Amman" }

`due_domains(...)` returns the domains that should sync at `now`, given when each
last ran. The scheduler calls this each tick and fires the due domains (respecting
the single-writer lock elsewhere).
"""
from __future__ import annotations

from datetime import datetime, timedelta
from typing import Optional

try:
    from zoneinfo import ZoneInfo
except Exception:  # pragma: no cover - py<3.9 fallback
    ZoneInfo = None  # type: ignore

_DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]  # Mon=0 … Sun=6


def _tz(name: Optional[str]):
    if name and ZoneInfo is not None:
        try:
            return ZoneInfo(name)
        except Exception:
            return None
    return None


def _local_now(now_utc: datetime, tz_name: Optional[str]) -> datetime:
    """Convert an aware/naive UTC datetime to the schedule's local tz."""
    tz = _tz(tz_name)
    if tz is None:
        return now_utc.replace(tzinfo=None)
    if now_utc.tzinfo is None:
        from datetime import timezone as _timezone
        now_utc = now_utc.replace(tzinfo=_timezone.utc)
    return now_utc.astimezone(tz).replace(tzinfo=None)


def _within_quiet_hours(local_now: datetime, quiet) -> bool:
    """quiet = {'from':'08:00','to':'18:00'} — True if now falls inside the window."""
    if not quiet:
        return False
    try:
        f_h, f_m = map(int, quiet["from"].split(":"))
        t_h, t_m = map(int, quiet["to"].split(":"))
    except Exception:
        return False
    start = local_now.replace(hour=f_h, minute=f_m, second=0, microsecond=0)
    end = local_now.replace(hour=t_h, minute=t_m, second=0, microsecond=0)
    if start <= end:
        return start <= local_now < end
    return local_now >= start or local_now < end  # window crosses midnight


def _is_due(schedule: dict, now_utc: datetime,
            last_run: Optional[datetime], default_tz: Optional[str],
            grace_minutes: int = 5) -> bool:
    mode = (schedule or {}).get("mode", "manual")

    if mode == "manual":
        return False

    if mode == "interval":
        every = int(schedule.get("every_minutes", 30))
        if every <= 0:
            return False
        if last_run is None:
            return True
        return (now_utc - last_run) >= timedelta(minutes=every)

    if mode == "times":
        tz_name = schedule.get("timezone") or default_tz
        local = _local_now(now_utc, tz_name)
        days = schedule.get("days") or _DAYS  # default: every day
        if _DAYS[local.weekday()] not in days:
            return False
        last_local = _local_now(last_run, tz_name) if last_run else None
        for hhmm in schedule.get("times", []):
            try:
                h, m = map(int, hhmm.split(":"))
            except Exception:
                continue
            target = local.replace(hour=h, minute=m, second=0, microsecond=0)
            # due if we're within grace after the target and haven't run since it
            if target <= local < target + timedelta(minutes=grace_minutes):
                if last_local is None or last_local < target:
                    return True
        return False

    return False


def due_domains(data_model: dict,
                now_utc: Optional[datetime] = None,
                last_runs: Optional[dict] = None,
                grace_minutes: int = 5) -> list[str]:
    """Return domains due to sync now.

    data_model: the settings 'data_model' block (domains + global flags)
    last_runs:  {domain: datetime_utc_of_last_run}
    """
    now_utc = now_utc or datetime.utcnow()
    last_runs = last_runs or {}

    if not data_model.get("background_enabled", True):
        return []

    default_tz = data_model.get("timezone")
    local = _local_now(now_utc, default_tz)
    if _within_quiet_hours(local, data_model.get("quiet_hours")):
        return []

    due = []
    for domain, cfg in (data_model.get("domains") or {}).items():
        if not cfg.get("enabled", True):
            continue
        if _is_due(cfg.get("schedule") or {}, now_utc,
                   last_runs.get(domain), default_tz, grace_minutes):
            due.append(domain)
    return due


# ── Self-test ──────────────────────────────────────────────────────────────────
if __name__ == "__main__":
    from datetime import timezone
    U = lambda *a: datetime(*a, tzinfo=timezone.utc)

    # interval: due when never run; due after N minutes; not before
    s = {"mode": "interval", "every_minutes": 15}
    assert _is_due(s, U(2026, 7, 1, 10, 0), None, None) is True
    assert _is_due(s, U(2026, 7, 1, 10, 10), U(2026, 7, 1, 10, 0), None) is False
    assert _is_due(s, U(2026, 7, 1, 10, 16), U(2026, 7, 1, 10, 0), None) is True

    # manual: never due
    assert _is_due({"mode": "manual"}, U(2026, 7, 1, 2, 0), None, None) is False

    # times: 02:00 UTC, only fires within grace and once per target
    s2 = {"mode": "times", "times": ["02:00"], "days": ["Wed"]}
    assert _is_due(s2, U(2026, 7, 1, 2, 0), None, "UTC") is True    # Wed 02:00
    assert _is_due(s2, U(2026, 7, 1, 2, 3), U(2026, 7, 1, 2, 0), "UTC") is False  # already ran
    assert _is_due(s2, U(2026, 7, 1, 2, 30), None, "UTC") is False  # past grace
    assert _is_due(s2, U(2026, 7, 2, 2, 0), None, "UTC") is False   # Thu, not in days

    # timezone: 06:00 Asia/Amman == 03:00 UTC (UTC+3 summer)
    s3 = {"mode": "times", "times": ["06:00"], "timezone": "Asia/Amman"}
    if ZoneInfo is not None:
        assert _is_due(s3, U(2026, 7, 1, 3, 0), None, None) is True

    # quiet hours block everything
    dm = {"background_enabled": True, "timezone": "UTC",
          "quiet_hours": {"from": "01:00", "to": "05:00"},
          "domains": {"sales": {"enabled": True,
                                "schedule": {"mode": "interval", "every_minutes": 5}}}}
    assert due_domains(dm, U(2026, 7, 1, 2, 0), {}) == []          # quiet
    assert due_domains(dm, U(2026, 7, 1, 6, 0), {}) == ["sales"]   # outside quiet

    # background disabled
    dm2 = dict(dm); dm2["background_enabled"] = False
    assert due_domains(dm2, U(2026, 7, 1, 6, 0), {}) == []

    print("schedule.py self-test: ALL PASSED")
