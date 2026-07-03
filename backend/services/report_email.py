"""
Daily report email
==================
Builds an HTML summary of yesterday's trading from the local warehouse and
sends it through the SMTP settings saved in settings.json (services.config).

Schedule state: settings.json → email.report = {
    "enabled": bool, "time": "07:00", "recipients": "a@x.com, b@y.com"
}
The scheduler (services.scheduler.background_loop) calls maybe_send_daily()
once a minute; it sends at the first tick at/after the configured local time
and remembers the last sent date in email.report.last_sent.
"""
import logging
import smtplib
from datetime import date, datetime, timedelta
from email.mime.text import MIMEText

from services.config import load_settings, save_settings

log = logging.getLogger(__name__)


# ── Data ──────────────────────────────────────────────────────────────────────

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


def build_daily_report(day: date | None = None) -> tuple[str, str]:
    """Returns (subject, html) for the given day (default: yesterday)."""
    d = day or (date.today() - timedelta(days=1))
    prev = d - timedelta(days=7)   # same weekday last week

    k = _q("""
        SELECT COALESCE(SUM(NET_SALES_WOTAX),0), COALESCE(SUM(SALES_COUNT),0),
               COALESCE(SUM(RETURN_COUNT),0)
        FROM FACT_SALES_DAILY WHERE POST_DATE = ?""", [d])[0]
    kp = _q("""
        SELECT COALESCE(SUM(NET_SALES_WOTAX),0)
        FROM FACT_SALES_DAILY WHERE POST_DATE = ?""", [prev])[0]

    net, cnt, rets = float(k[0]), int(k[1]), int(k[2])
    prev_net = float(kp[0])
    avg = net / cnt if cnt else 0
    delta = ((net - prev_net) / prev_net * 100) if prev_net else None

    stores = _q("""
        SELECT COALESCE(S.STORE_NAME,'(Unknown)'), ROUND(SUM(F.NET_SALES_WOTAX),0)
        FROM FACT_SALES_DAILY F LEFT JOIN DIM_STORE S ON S.SID = F.STORE_SID
        WHERE F.POST_DATE = ? GROUP BY 1 ORDER BY 2 DESC LIMIT 5""", [d])

    items = _q("""
        SELECT COALESCE(I.DESCRIPTION1,'(Unknown)'), ROUND(SUM(F.TOTAL_PRICE_WOTAX),0)
        FROM FACT_SALES_ITEMS F LEFT JOIN DIM_ITEM I ON I.SID = F.ITEM_SID
        WHERE F.INVC_POST_DATE::DATE = ? AND F.ITEM_TYPE = 'Sale'
        GROUP BY 1 ORDER BY 2 DESC LIMIT 5""", [d])

    cur = (load_settings().get("email") or {}).get("currency_hint", "SAR")

    def rows(data):
        return "".join(
            f"<tr><td style='padding:4px 12px 4px 0;color:#334155'>{name}</td>"
            f"<td style='padding:4px 0;text-align:right;font-weight:600;color:#0f172a'>{_fmt(v)}</td></tr>"
            for name, v in data) or "<tr><td style='color:#94a3b8'>No data</td></tr>"

    delta_html = ""
    if delta is not None:
        color = "#16a34a" if delta >= 0 else "#dc2626"
        arrow = "▲" if delta >= 0 else "▼"
        delta_html = (f"<span style='color:{color};font-size:13px;font-weight:600'>"
                      f"{arrow} {abs(delta):.1f}% vs same day last week</span>")

    html = f"""
    <div style="font-family:Segoe UI,Arial,sans-serif;max-width:560px;margin:auto;color:#0f172a">
      <h2 style="margin:0 0 2px">RetailTec Analytics — Daily Report</h2>
      <p style="margin:0 0 16px;color:#64748b">{d.strftime('%A, %d %B %Y')}</p>
      <table style="width:100%;border-collapse:collapse;margin-bottom:8px">
        <tr>
          <td style="padding:12px;background:#f5f3ff;border-radius:8px">
            <div style="font-size:11px;color:#7c3aed;font-weight:700;text-transform:uppercase">Net sales ({cur})</div>
            <div style="font-size:24px;font-weight:700">{_fmt(net)}</div>
            {delta_html}
          </td>
          <td style="width:12px"></td>
          <td style="padding:12px;background:#f0fdf4;border-radius:8px">
            <div style="font-size:11px;color:#16a34a;font-weight:700;text-transform:uppercase">Transactions</div>
            <div style="font-size:24px;font-weight:700">{_fmt(cnt)}</div>
            <span style="color:#64748b;font-size:13px">avg basket {_fmt(avg)}</span>
          </td>
          <td style="width:12px"></td>
          <td style="padding:12px;background:#fff7ed;border-radius:8px">
            <div style="font-size:11px;color:#ea580c;font-weight:700;text-transform:uppercase">Returns</div>
            <div style="font-size:24px;font-weight:700">{_fmt(rets)}</div>
          </td>
        </tr>
      </table>
      <h3 style="margin:18px 0 6px;font-size:14px">Top stores</h3>
      <table style="width:100%;border-collapse:collapse;font-size:13px">{rows(stores)}</table>
      <h3 style="margin:18px 0 6px;font-size:14px">Top items</h3>
      <table style="width:100%;border-collapse:collapse;font-size:13px">{rows(items)}</table>
      <p style="color:#94a3b8;font-size:11px;margin-top:20px">
        Sent automatically by RetailTec Analytics.
      </p>
    </div>"""
    subject = f"Daily report {d.isoformat()} — net sales {_fmt(net)}"
    return subject, html


# ── Sending ───────────────────────────────────────────────────────────────────

def send_report(recipients: list[str], day: date | None = None) -> str:
    email = load_settings().get("email") or {}
    if not email.get("host"):
        raise RuntimeError("SMTP settings are not configured")
    subject, html = build_daily_report(day)
    msg = MIMEText(html, "html", "utf-8")
    msg["Subject"] = subject
    msg["From"]    = email.get("from_addr") or email.get("username", "")
    msg["To"]      = ", ".join(recipients)
    with smtplib.SMTP(email["host"], int(email.get("port", 587)), timeout=30) as smtp:
        if email.get("use_tls", True):
            smtp.starttls()
        if email.get("username"):
            smtp.login(email["username"], email.get("password", ""))
        smtp.send_message(msg)
    return subject


def maybe_send_daily() -> None:
    """Called every minute by the scheduler. Sends once per day at/after the
    configured time (server local time)."""
    s = load_settings()
    rpt = (s.get("email") or {}).get("report") or {}
    if not rpt.get("enabled"):
        return
    recipients = [r.strip() for r in (rpt.get("recipients") or "").split(",") if r.strip()]
    if not recipients:
        return
    now = datetime.now()
    if rpt.get("last_sent") == str(date.today()):
        return
    try:
        hh, mm = (rpt.get("time") or "07:00").split(":")
        due = now.hour > int(hh) or (now.hour == int(hh) and now.minute >= int(mm))
    except Exception:
        due = now.hour >= 7
    if not due:
        return
    try:
        subject = send_report(recipients)
        log.info(f"Daily report sent to {recipients}: {subject}")
    except Exception as e:
        log.error(f"Daily report failed: {e}")
        return
    s = load_settings()
    s.setdefault("email", {}).setdefault("report", {}).update(
        rpt, last_sent=str(date.today()))
    s["email"]["report"]["last_sent"] = str(date.today())
    save_settings(s)
