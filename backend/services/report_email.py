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


# ── Sending ───────────────────────────────────────────────────────────────────

def send_one(report: dict) -> str:
    email = load_settings().get("email") or {}
    if not email.get("host"):
        raise RuntimeError("SMTP settings are not configured")
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
    """Called every minute by the scheduler; sends each enabled report once per
    day at/after its configured time (server local time)."""
    reports = get_reports()
    if not reports:
        return
    now, today = datetime.now(), str(date.today())
    changed = False
    for r in reports:
        if not r.get("enabled") or r.get("last_sent") == today:
            continue
        try:
            hh, mm = (r.get("time") or "07:00").split(":")
            due = now.hour > int(hh) or (now.hour == int(hh) and now.minute >= int(mm))
        except Exception:
            due = now.hour >= 7
        if not due:
            continue
        try:
            subject = send_one(r)
            log.info(f"Report '{r.get('name')}' sent: {subject}")
            r["last_sent"] = today
            changed = True
        except Exception as e:
            log.error(f"Report '{r.get('name')}' failed: {e}")
    if changed:
        save_reports(reports)
