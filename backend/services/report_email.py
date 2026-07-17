"""
Report emails
=============
Configurable scheduled reports, sent through the SMTP settings in settings.json.

settings.json → email.reports = [
    { "id": "r1", "type": "daily_sales" | "inventory_summary" | "purchases_summary",
      "name": "Morning sales", "time": "07:00",
      "stores": "P2026-Qadisiyah, P2028-AlFalah" | "",   # "" = all stores
      "recipients": "a@x.com, b@y.com", "enabled": true,
      "last_sent": "2026-07-03" }
]
The scheduler calls maybe_send_scheduled() once a minute; each enabled report
sends at the first tick at/after its time (server local time), once per day.

Legacy email.report (single daily report) is migrated to the list on load.
"""
import logging
import smtplib
import uuid
from datetime import date, datetime, timedelta
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from email.mime.application import MIMEApplication

from services.config import load_settings, save_settings

log = logging.getLogger(__name__)

REPORT_TYPES = {
    "daily_sales":       "Daily sales summary (yesterday)",
    "inventory_summary": "Inventory snapshot (current stock)",
    "purchases_summary": "Purchases summary (last 7 days)",
}


# ── Data helpers ──────────────────────────────────────────────────────────────

def _q(sql: str, params=None):
    from db.model import DB_LOCK, get_db
    with DB_LOCK:
        cur = get_db().cursor()
    try:
        return cur.execute(sql, params or []).fetchall()
    finally:
        cur.close()


def _fmt(n, dec=0):
    try:
        return f"{float(n or 0):,.{dec}f}"
    except Exception:
        return "0"


def _store_pred(stores: list[str], col: str) -> tuple[str, list]:
    if not stores:
        return "", []
    ph = ",".join("?" * len(stores))
    return f" AND {col} IN ({ph})", stores


def _rows_html(data):
    return "".join(
        f"<tr><td style='padding:4px 12px 4px 0;color:#334155'>{name}</td>"
        f"<td style='padding:4px 0;text-align:right;font-weight:600;color:#0f172a'>{_fmt(v)}</td></tr>"
        for name, v in data) or "<tr><td style='color:#94a3b8'>No data</td></tr>"


def _kpi_cell(label: str, value: str, sub: str, bg: str, fg: str) -> str:
    return (f"<td style='padding:12px;background:{bg};border-radius:8px'>"
            f"<div style='font-size:11px;color:{fg};font-weight:700;text-transform:uppercase'>{label}</div>"
            f"<div style='font-size:22px;font-weight:700'>{value}</div>"
            f"<span style='color:#64748b;font-size:12px'>{sub}</span></td>")


def _wrap(title: str, sub: str, body: str, scope: str) -> str:
    return f"""
    <div style="font-family:Segoe UI,Arial,sans-serif;max-width:560px;margin:auto;color:#0f172a">
      <h2 style="margin:0 0 2px">RetailTec Analytics — {title}</h2>
      <p style="margin:0 0 4px;color:#64748b">{sub}</p>
      <p style="margin:0 0 16px;color:#94a3b8;font-size:12px">Scope: {scope}</p>
      {body}
      <p style="color:#94a3b8;font-size:11px;margin-top:20px">Sent automatically by RetailTec Analytics.</p>
    </div>"""


# ── Report builders ───────────────────────────────────────────────────────────

def _build_daily_sales(stores: list[str]) -> tuple[str, str]:
    d, prev = date.today() - timedelta(days=1), date.today() - timedelta(days=8)
    sf, sp = _store_pred(stores, "S.STORE_NAME")
    base = "FROM FACT_SALES_DAILY F LEFT JOIN DIM_STORE S ON S.SID = F.STORE_SID"

    k = _q(f"""SELECT COALESCE(SUM(F.NET_SALES_WOTAX),0), COALESCE(SUM(F.SALES_COUNT),0),
                      COALESCE(SUM(F.RETURN_UNITS),0) {base}
               WHERE F.POST_DATE = ? {sf}""", [d] + sp)[0]
    kp = _q(f"""SELECT COALESCE(SUM(F.NET_SALES_WOTAX),0) {base}
                WHERE F.POST_DATE = ? {sf}""", [prev] + sp)[0]
    net, cnt, rets, prev_net = float(k[0]), int(k[1]), int(k[2]), float(kp[0])
    avg = net / cnt if cnt else 0

    delta_html = ""
    if prev_net:
        delta = (net - prev_net) / prev_net * 100
        color = "#16a34a" if delta >= 0 else "#dc2626"
        arrow = "▲" if delta >= 0 else "▼"
        delta_html = (f"<span style='color:{color};font-size:12px;font-weight:600'>"
                      f"{arrow} {abs(delta):.1f}% vs same day last week</span>")

    top_stores = _q(f"""SELECT COALESCE(S.STORE_NAME,'(Unknown)'), ROUND(SUM(F.NET_SALES_WOTAX),0)
                        {base} WHERE F.POST_DATE = ? {sf}
                        GROUP BY 1 ORDER BY 2 DESC LIMIT 5""", [d] + sp)
    sfi, spi = _store_pred(stores, "S.STORE_NAME")
    top_items = _q(f"""SELECT COALESCE(I.DESCRIPTION1,'(Unknown)'), ROUND(SUM(F.TOTAL_PRICE_WOTAX),0)
                       FROM FACT_SALES_ITEMS F
                       LEFT JOIN DIM_ITEM I ON I.SID = F.ITEM_SID
                       LEFT JOIN DIM_STORE S ON S.SID = F.STORE_SID
                       WHERE F.INVC_POST_DATE::DATE = ? AND F.ITEM_TYPE = 'Sale' {sfi}
                       GROUP BY 1 ORDER BY 2 DESC LIMIT 5""", [d] + spi)

    body = f"""
      <table style="width:100%;border-collapse:separate;border-spacing:6px 0;margin-bottom:8px"><tr>
        {_kpi_cell('Net sales', _fmt(net), delta_html or '&nbsp;', '#f5f3ff', '#7c3aed')}
        {_kpi_cell('Transactions', _fmt(cnt), f'avg basket {_fmt(avg)}', '#f0fdf4', '#16a34a')}
        {_kpi_cell('Returns', _fmt(rets), '&nbsp;', '#fff7ed', '#ea580c')}
      </tr></table>
      <h3 style="margin:18px 0 6px;font-size:14px">Top stores</h3>
      <table style="width:100%;border-collapse:collapse;font-size:13px">{_rows_html(top_stores)}</table>
      <h3 style="margin:18px 0 6px;font-size:14px">Top items</h3>
      <table style="width:100%;border-collapse:collapse;font-size:13px">{_rows_html(top_items)}</table>"""
    subject = f"Daily sales {d.isoformat()} — net {_fmt(net)}"
    return subject, body


def _build_inventory_summary(stores: list[str]) -> tuple[str, str]:
    sf, sp = _store_pred(stores, "S.STORE_NAME")
    base = """FROM FACT_INVENTORY FI
              LEFT JOIN DIM_STORE S ON S.SID = FI.STORE_SID
              LEFT JOIN DIM_ITEM  I ON I.SID = FI.ITEM_SID
              LEFT JOIN DIM_DCS   D ON D.SID = I.DCS_SID"""
    k = _q(f"""SELECT COUNT(DISTINCT FI.ITEM_SID),
                      COALESCE(SUM(FI.ON_HAND_QTY),0),
                      COALESCE(SUM(FI.ON_HAND_QTY * FI.COST),0),
                      COALESCE(SUM(CASE WHEN FI.ON_HAND_QTY < 0 THEN 1 ELSE 0 END),0)
               {base} WHERE 1=1 {sf}""", sp)[0]
    depts = _q(f"""SELECT COALESCE(D.D_NAME,'(Unknown)'),
                          ROUND(SUM(FI.ON_HAND_QTY * FI.COST),0)
                   {base} WHERE 1=1 {sf}
                   GROUP BY 1 ORDER BY 2 DESC LIMIT 6""", sp)
    body = f"""
      <table style="width:100%;border-collapse:separate;border-spacing:6px 0;margin-bottom:8px"><tr>
        {_kpi_cell('Active SKUs', _fmt(k[0]), '&nbsp;', '#f5f3ff', '#7c3aed')}
        {_kpi_cell('Units on hand', _fmt(k[1]), '&nbsp;', '#f0fdf4', '#16a34a')}
        {_kpi_cell('Stock value (cost)', _fmt(k[2]), f'{_fmt(k[3])} negative-stock lines', '#fff7ed', '#ea580c')}
      </tr></table>
      <h3 style="margin:18px 0 6px;font-size:14px">Stock value by department</h3>
      <table style="width:100%;border-collapse:collapse;font-size:13px">{_rows_html(depts)}</table>"""
    subject = f"Inventory snapshot {date.today().isoformat()} — stock value {_fmt(k[2])}"
    return subject, body


def _build_purchases_summary(stores: list[str]) -> tuple[str, str]:
    d_to, d_from = date.today() - timedelta(days=1), date.today() - timedelta(days=7)
    sf, sp = _store_pred(stores, "S.STORE_NAME")
    base = """FROM FACT_PURCHASES FP
              LEFT JOIN DIM_STORE  S ON S.SID = FP.STORE_SID
              LEFT JOIN DIM_VENDOR V ON V.SID = FP.VEND_SID"""
    k = _q(f"""SELECT COUNT(DISTINCT FP.VOU_SID), COALESCE(SUM(FP.VOU_TOTAL),0),
                      COUNT(DISTINCT FP.VEND_SID)
               {base} WHERE FP.VOU_DATE BETWEEN ? AND ? {sf}""", [d_from, d_to] + sp)[0]
    sup = _q(f"""SELECT COALESCE(V.VEND_NAME,'(Unknown)'), ROUND(SUM(FP.VOU_TOTAL),0)
                 {base} WHERE FP.VOU_DATE BETWEEN ? AND ? {sf}
                 GROUP BY 1 ORDER BY 2 DESC LIMIT 6""", [d_from, d_to] + sp)
    body = f"""
      <table style="width:100%;border-collapse:separate;border-spacing:6px 0;margin-bottom:8px"><tr>
        {_kpi_cell('Vouchers', _fmt(k[0]), f'{d_from.isoformat()} → {d_to.isoformat()}', '#f5f3ff', '#7c3aed')}
        {_kpi_cell('Total cost', _fmt(k[1]), '&nbsp;', '#f0fdf4', '#16a34a')}
        {_kpi_cell('Suppliers', _fmt(k[2]), '&nbsp;', '#fff7ed', '#ea580c')}
      </tr></table>
      <h3 style="margin:18px 0 6px;font-size:14px">Top suppliers</h3>
      <table style="width:100%;border-collapse:collapse;font-size:13px">{_rows_html(sup)}</table>"""
    subject = f"Purchases {d_from.isoformat()} → {d_to.isoformat()} — total {_fmt(k[1])}"
    return subject, body


_BUILDERS = {
    "daily_sales":       ("Daily Sales Report",   _build_daily_sales),
    "inventory_summary": ("Inventory Snapshot",   _build_inventory_summary),
    "purchases_summary": ("Purchases Summary",    _build_purchases_summary),
}


# ── Config access + legacy migration ─────────────────────────────────────────

# The 3 built-in summary reports are always PREINSTALLED (disabled) so they show
# in Settings → Reports; the owner can enable any of them. They are never used by
# grid schedules (those carry kind="grid"). Fixed ids so they never duplicate.
_PREINSTALLED = [
    {"id": "pre_daily_sales",       "type": "daily_sales",       "freq": "daily"},
    {"id": "pre_inventory_summary", "type": "inventory_summary", "freq": "daily"},
    {"id": "pre_purchases_summary", "type": "purchases_summary", "freq": "weekly"},
]


def get_reports(settings: dict | None = None) -> list[dict]:
    s = settings or load_settings()
    email = s.get("email") or {}
    reports = email.get("reports")
    if reports is None:
        reports = []
        legacy = email.get("report")
        if legacy and (legacy.get("recipients") or legacy.get("enabled")):
            reports.append({
                "id": "r-legacy", "type": "daily_sales", "name": "Daily sales",
                "time": legacy.get("time", "07:00"), "stores": "",
                "recipients": legacy.get("recipients", ""),
                "enabled": legacy.get("enabled", False),
                "last_sent": legacy.get("last_sent"),
            })
    # Ensure the preinstalled summaries are present (disabled) so they always
    # appear in Settings; user can enable. Never re-added once its id exists.
    have = {r.get("id") for r in reports}
    for p in _PREINSTALLED:
        if p["id"] not in have:
            reports.append({
                "id": p["id"], "type": p["type"], "name": REPORT_TYPES[p["type"]],
                "time": "07:00", "stores": "", "recipients": "", "enabled": False,
                "freq": p["freq"], "weekday": 0, "day": 1, "date": None,
                "preinstalled": True,
            })
    return reports


def save_reports(reports: list[dict]) -> None:
    s = load_settings()
    email = s.setdefault("email", {})
    for r in reports:
        if not r.get("id"):
            r["id"] = uuid.uuid4().hex[:8]
    email["reports"] = reports
    email.pop("report", None)   # legacy shape replaced
    save_settings(s)


# ── Governance alert rules (auto-email the offending journal) ──────────────────
# Daily digest: once/day (server local time) each enabled rule queries the prior
# day's offending invoice lines and, if any, emails them as a CSV to recipients.

ALERT_DEFS = {
    "below_cost":   {"name": "Sold below cost",        "threshold": 0,   "unit": ""},
    "big_discount": {"name": "Big discount on a line", "threshold": 30,  "unit": "%"},
    "large_return": {"name": "Large return",           "threshold": 500, "unit": ""},
}


def _default_alert_rules() -> list[dict]:
    return [{"id": k, "condition": k, "name": v["name"], "threshold": v["threshold"],
             "recipients": "", "enabled": False, "time": "07:00", "last_sent": None}
            for k, v in ALERT_DEFS.items()]


def get_alert_rules(settings: dict | None = None) -> list[dict]:
    s = settings or load_settings()
    rules = (s.get("email") or {}).get("alert_rules")
    if rules is None:
        return _default_alert_rules()
    have = {r.get("condition") for r in rules}
    for k, v in ALERT_DEFS.items():
        if k not in have:
            rules.append({"id": k, "condition": k, "name": v["name"], "threshold": v["threshold"],
                          "recipients": "", "enabled": False, "time": "07:00", "last_sent": None})
    return rules


def save_alert_rules(rules: list[dict]) -> None:
    s = load_settings()
    email = s.setdefault("email", {})
    for r in rules:
        if not r.get("id"):
            r["id"] = uuid.uuid4().hex[:8]
    email["alert_rules"] = rules
    save_settings(s)


def _alert_offenders(condition: str, threshold: float, df: str, dt: str) -> list[dict]:
    """Offending journal rows for a condition in the [df, dt] posting-date range."""
    from routers.common import qdf   # list[dict] query helper
    if condition == "below_cost":
        return qdf("""
            SELECT INV.DOC_NO AS doc_no, INV.INVC_POST_DATE::VARCHAR AS post_date,
                   S.STORE_NAME AS store, I.ALU AS alu, I.DESCRIPTION1 AS description,
                   E.FULL_NAME AS associate, ROUND(FI.QTY,2) AS qty,
                   ROUND(FI.TOTAL_COST,2) AS cost, ROUND(FI.TOTAL_PRICE_WOTAX,2) AS price,
                   ROUND(FI.TOTAL_PRICE_WOTAX - FI.TOTAL_COST,2) AS margin
            FROM FACT_SALES_ITEMS FI
            LEFT JOIN FACT_SALES_INVOICES INV ON INV.DOC_SID = FI.DOC_SID
            LEFT JOIN DIM_STORE S ON S.SID = FI.STORE_SID
            LEFT JOIN DIM_ITEM  I ON I.SID = FI.ITEM_SID
            LEFT JOIN DIM_EMPLOYEE E ON E.SID = INV.EMPLOYEE1_SID
            WHERE FI.INVC_POST_DATE::DATE BETWEEN ? AND ? AND FI.ITEM_TYPE='Sale'
              AND FI.TOTAL_COST > 0 AND FI.TOTAL_PRICE_WOTAX < FI.TOTAL_COST
            ORDER BY margin ASC LIMIT 5000
        """, [df, dt])
    if condition == "big_discount":
        return qdf("""
            SELECT INV.DOC_NO AS doc_no, INV.INVC_POST_DATE::VARCHAR AS post_date,
                   S.STORE_NAME AS store, I.ALU AS alu, I.DESCRIPTION1 AS description,
                   E.FULL_NAME AS associate, ROUND(FI.QTY,2) AS qty,
                   ROUND(FI.TOTAL_ORIG_PRICE_WOTAX,2) AS orig_price,
                   ROUND(FI.TOTAL_PRICE_WOTAX,2) AS price,
                   ROUND((FI.TOTAL_ORIG_PRICE_WOTAX - FI.TOTAL_PRICE_WOTAX),2) AS discount,
                   ROUND((FI.TOTAL_ORIG_PRICE_WOTAX - FI.TOTAL_PRICE_WOTAX)
                         / NULLIF(FI.TOTAL_ORIG_PRICE_WOTAX,0) * 100, 1) AS discount_pct
            FROM FACT_SALES_ITEMS FI
            LEFT JOIN FACT_SALES_INVOICES INV ON INV.DOC_SID = FI.DOC_SID
            LEFT JOIN DIM_STORE S ON S.SID = FI.STORE_SID
            LEFT JOIN DIM_ITEM  I ON I.SID = FI.ITEM_SID
            LEFT JOIN DIM_EMPLOYEE E ON E.SID = INV.EMPLOYEE1_SID
            WHERE FI.INVC_POST_DATE::DATE BETWEEN ? AND ? AND FI.ITEM_TYPE='Sale'
              AND FI.TOTAL_ORIG_PRICE_WOTAX > 0
              AND (FI.TOTAL_ORIG_PRICE_WOTAX - FI.TOTAL_PRICE_WOTAX) / FI.TOTAL_ORIG_PRICE_WOTAX >= ?
            ORDER BY discount_pct DESC LIMIT 5000
        """, [df, dt, (threshold or 30) / 100.0])
    if condition == "large_return":
        return qdf("""
            SELECT INV.DOC_NO AS doc_no, INV.INVC_POST_DATE::VARCHAR AS post_date,
                   S.STORE_NAME AS store, C.FULL_NAME AS customer, E.FULL_NAME AS associate,
                   ROUND(INV.NET_SALES_WOTAX,2) AS net_amount
            FROM FACT_SALES_INVOICES INV
            LEFT JOIN DIM_STORE S ON S.SID = INV.STORE_SID
            LEFT JOIN DIM_CUSTOMER C ON C.SID = INV.BT_CUID
            LEFT JOIN DIM_EMPLOYEE E ON E.SID = INV.EMPLOYEE1_SID
            WHERE INV.INVC_POST_DATE::DATE BETWEEN ? AND ? AND INV.RECEIPT_TYPE = 1
              AND ABS(INV.NET_SALES_WOTAX) >= ?
            ORDER BY net_amount ASC LIMIT 5000
        """, [df, dt, threshold or 500])
    return []


def _send_alert_digest(rule: dict, rows: list[dict], day: str) -> None:
    import csv, io
    from services import report_grid
    cols = list(rows[0].keys())
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(cols)
    for r in rows:
        w.writerow([r.get(c, "") for c in cols])
    content = buf.getvalue().encode("utf-8-sig")
    recipients = [x.strip() for x in (rule.get("recipients") or "").split(",") if x.strip()]
    subject = f"Alert: {rule.get('name')} — {day} ({len(rows)})"
    fname = f"alert_{rule.get('condition')}_{day}.csv"
    details = {"Alert": rule.get("name"), "Day": day, "Matches": f"{len(rows):,}"}
    preview = report_grid.build_preview_html(
        {"columns": [{"id": c, "label": c} for c in cols]}, rows)
    send_attachment(recipients, subject, f"Automatic governance alert for {day}.",
                    fname, content, "text/csv", details, extra_html=preview)


def maybe_send_alerts() -> None:
    """Called every minute; each enabled rule sends a once-daily digest of the
    PRIOR day's offending rows at/after its configured time. last_sent guards one
    send per day (set even when 0 matches, so it doesn't re-scan all day)."""
    rules = get_alert_rules()
    now, today = datetime.now(), str(date.today())
    yday = str(date.today() - timedelta(days=1))
    changed = False
    for r in rules:
        if not r.get("enabled") or r.get("last_sent") == today:
            continue
        try:
            hh, mm = (r.get("time") or "07:00").split(":")
            if not (now.hour > int(hh) or (now.hour == int(hh) and now.minute >= int(mm))):
                continue
        except Exception:
            if now.hour < 7:
                continue
        recipients = [x.strip() for x in (r.get("recipients") or "").split(",") if x.strip()]
        if not recipients:
            continue
        try:
            rows = _alert_offenders(r.get("condition"), float(r.get("threshold") or 0), yday, yday)
            if rows:
                _send_alert_digest(r, rows, yday)
                log.info(f"Alert '{r.get('name')}' digest sent: {len(rows)} rows")
            r["last_sent"] = today
            changed = True
        except Exception as e:
            log.error(f"Alert '{r.get('name')}' failed: {e}")
    if changed:
        save_alert_rules(rules)


# ── Sending ───────────────────────────────────────────────────────────────────

def _send_grid_report(report: dict) -> str:
    """Regenerate a dashboard grid server-side and email it as a CSV attachment
    with an inline preview + report-details block."""
    from services import report_grid
    recipients = [x.strip() for x in (report.get("recipients") or "").split(",") if x.strip()]
    if not recipients:
        raise RuntimeError("No recipients configured")
    endpoint = report.get("endpoint")
    if not endpoint:
        raise RuntimeError("Grid report has no endpoint")

    params = dict(report.get("params") or {})
    df, dt = report_grid.resolve_window(report)
    # Roll the date window for any date-scoped grid.
    if ("date_from" in params) or report.get("period") or report.get("date_from"):
        params["date_from"], params["date_to"] = df, dt

    rows = report_grid.run_grid(endpoint, params)
    fmt = (report.get("fmt") or report.get("format") or "csv").lower()
    content, mime, ext = report_grid.build_attachment(report, rows, fmt)
    # No inline HTML preview for PDF — the attachment already is the visual.
    preview = "" if fmt == "pdf" else report_grid.build_preview_html(report, rows)

    name  = report.get("name") or report.get("title") or "Report"
    today = date.today().isoformat()
    subject = f"{name} — {today}"
    base = "".join(c if (c.isalnum() or c in "-_") else "_" for c in name)[:60] or "report"
    filename = f"{base}_{today}.{ext}"

    period_lbl = (report.get("period") or "").lower()
    details = {"Report": report.get("title") or name}
    if report.get("view"):
        details["View"] = report["view"]
    details["Period"] = f"{df} → {dt}" + (f" ({period_lbl})" if period_lbl and period_lbl != "custom" else "")
    if report.get("filters"):
        details["Filters"] = report["filters"]
    details["Rows"] = f"{len(rows):,}"

    return send_attachment(recipients, subject, None, filename, content,
                           mime, details, extra_html=preview)


def send_one(report: dict) -> str:
    email = load_settings().get("email") or {}
    if not email.get("host"):
        raise RuntimeError("SMTP settings are not configured")
    if (report.get("kind") or "").lower() == "grid":
        return _send_grid_report(report)
    rtype = report.get("type", "daily_sales")
    if rtype not in _BUILDERS:
        raise RuntimeError(f"Unknown report type: {rtype}")
    stores = [x.strip() for x in (report.get("stores") or "").split(",") if x.strip()]
    recipients = [x.strip() for x in (report.get("recipients") or "").split(",") if x.strip()]
    if not recipients:
        raise RuntimeError("No recipients configured")

    title, builder = _BUILDERS[rtype]
    subject, body = builder(stores)
    scope = ", ".join(stores) if stores else "All stores"
    html = _wrap(title, datetime.now().strftime("%A, %d %B %Y"), body, scope)

    msg = MIMEText(html, "html", "utf-8")
    msg["Subject"] = f"{report.get('name') or title} — {subject}"
    msg["From"]    = email.get("from_addr") or email.get("username", "")
    msg["To"]      = ", ".join(recipients)
    with smtplib.SMTP(email["host"], int(email.get("port", 587)), timeout=30) as smtp:
        if email.get("use_tls", True):
            smtp.starttls()
        if email.get("username"):
            smtp.login(email["username"], email.get("password", ""))
        smtp.send_message(msg)
    return msg["Subject"]


def maybe_send_scheduled() -> None:
    """Called every minute by the scheduler; sends each enabled report at/after
    its configured time, honouring its frequency:
      daily   — every day
      weekly  — only on r['weekday'] (0=Mon … 6=Sun)
      monthly — only on day-of-month r['day'] (1..31)
      once    — only on the exact date r['date'] (YYYY-MM-DD), then auto-disables
    last_sent guards one send per day. Server local time throughout."""
    reports = get_reports()
    if not reports:
        return
    now, today = datetime.now(), str(date.today())
    changed = False
    for r in reports:
        if not r.get("enabled") or r.get("last_sent") == today:
            continue
        # ── time-of-day gate ──
        try:
            hh, mm = (r.get("time") or "07:00").split(":")
            time_ok = now.hour > int(hh) or (now.hour == int(hh) and now.minute >= int(mm))
        except Exception:
            time_ok = now.hour >= 7
        if not time_ok:
            continue
        # ── frequency gate (default daily) ──
        freq = (r.get("freq") or "daily").lower()
        try:
            if freq == "weekly" and now.weekday() != int(r.get("weekday", 0)):
                continue
            if freq == "monthly" and now.day != int(r.get("day", 1)):
                continue
        except Exception:
            pass
        if freq == "once" and today != (r.get("date") or ""):
            continue
        # ── send ──
        try:
            subject = send_one(r)
            log.info(f"Report '{r.get('name')}' sent ({freq}): {subject}")
            r["last_sent"] = today
            if freq == "once":
                r["enabled"] = False   # one-time reports fire exactly once
            changed = True
        except Exception as e:
            log.error(f"Report '{r.get('name')}' failed: {e}")
    if changed:
        save_reports(reports)


# ── On-demand: email an arbitrary file (a grid exported as PDF/Excel) ─────────

def _smtp_email() -> dict:
    email = load_settings().get("email") or {}
    if not email.get("host"):
        raise RuntimeError("SMTP settings are not configured. Ask an admin to set them in Settings → Reports.")
    return email


def _attachment_body(subject: str, note: str | None, filename: str,
                     details: dict | None = None, extra_html: str | None = None) -> str:
    """A tidy branded HTML email body — looks good even with no note. `details`
    is an ordered {label: value} map (report/view/period/stores/rows/columns…)
    so the recipient knows exactly which grid + filters produced the attachment."""
    when = datetime.now().strftime("%A, %d %B %Y · %H:%M")
    note_html = (f"<p style='margin:0 0 16px;color:#334155;font-size:14px;line-height:1.6'>{note}</p>"
                 if note else "")
    details_html = ""
    if details:
        rows = "".join(
            f"<tr><td style='padding:5px 14px 5px 0;color:#64748b;font-size:13px;white-space:nowrap;vertical-align:top'>{k}</td>"
            f"<td style='padding:5px 0;color:#0f172a;font-size:13px;font-weight:600'>{v}</td></tr>"
            for k, v in details.items() if v not in (None, ""))
        if rows:
            details_html = (
                "<div style='font-size:12px;font-weight:700;color:#5b21b6;text-transform:uppercase;"
                "letter-spacing:.5px;margin:0 0 6px'>Report details</div>"
                "<table style='width:100%;border-collapse:separate;border-spacing:0;margin:0 0 18px;"
                f"background:#f8f7ff;border-radius:8px;padding:6px 14px'>{rows}</table>")
    return f"""
    <div style="font-family:Segoe UI,Arial,sans-serif;max-width:600px;margin:auto;color:#0f172a">
      <div style="background:linear-gradient(135deg,#1e1248,#160b33);border-radius:12px;padding:22px 26px;margin-bottom:18px">
        <div style="font-size:22px;font-weight:800;color:#ffffff;letter-spacing:.2px">RetailTec Analytics</div>
        <div style="font-size:13px;color:#c4b5fd;margin-top:3px">{subject}</div>
      </div>
      {note_html}
      {details_html}
      {extra_html or ""}
      <p style="margin:0 0 14px;color:#334155;font-size:14px;line-height:1.6">
        The full report is attached as <b style="color:#0f172a">{filename}</b>.
      </p>
      <p style="margin:0;color:#94a3b8;font-size:12px">Generated {when}</p>
      <p style="color:#cbd5e1;font-size:11px;margin-top:22px;border-top:1px solid #eef2f7;padding-top:12px">
        Sent by RetailTec Analytics · Retail Pro Prism — Retail Intelligence
      </p>
    </div>"""


def send_attachment(recipients: list[str], subject: str, note: str | None,
                    filename: str, content: bytes, mime: str = "application/pdf",
                    details: dict | None = None, extra_html: str | None = None) -> str:
    """Email `content` (bytes) as an attachment to `recipients` via the app SMTP,
    with a branded HTML body (nice even when there is no note)."""
    email = _smtp_email()
    recipients = [r for r in recipients if r]
    if not recipients:
        raise RuntimeError("No recipients")
    msg = MIMEMultipart()
    msg["Subject"] = subject
    msg["From"] = email.get("from_addr") or email.get("username", "")
    msg["To"] = ", ".join(recipients)
    msg.attach(MIMEText(_attachment_body(subject, note, filename, details, extra_html), "html", "utf-8"))
    subtype = mime.split("/", 1)[1] if "/" in mime else "octet-stream"
    part = MIMEApplication(content, _subtype=subtype)
    part.add_header("Content-Disposition", "attachment", filename=filename)
    msg.attach(part)
    with smtplib.SMTP(email["host"], int(email.get("port", 587)), timeout=45) as smtp:
        if email.get("use_tls", True):
            smtp.starttls()
        if email.get("username"):
            smtp.login(email["username"], email.get("password", ""))
        smtp.send_message(msg)
    return subject


# ── Send history (kept in settings.json → email.history, newest first, capped) ─

_HISTORY_CAP = 300


def get_history() -> list[dict]:
    return ((load_settings().get("email") or {}).get("history")) or []


def append_history(entry: dict) -> None:
    s = load_settings()
    email = s.setdefault("email", {})
    hist = email.get("history") or []
    entry.setdefault("at", datetime.now().isoformat(timespec="seconds"))
    hist.insert(0, entry)
    email["history"] = hist[:_HISTORY_CAP]
    save_settings(s)


# ── Saved recipient lists (settings.json → email.recipient_lists) ─────────────

def get_recipient_lists() -> list[dict]:
    return ((load_settings().get("email") or {}).get("recipient_lists")) or []


def save_recipient_lists(lists: list[dict]) -> None:
    s = load_settings()
    email = s.setdefault("email", {})
    email["recipient_lists"] = lists
    save_settings(s)
