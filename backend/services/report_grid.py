"""
Grid report engine
===================
Regenerates a dashboard grid server-side (no browser) so it can be emailed on a
schedule. A "grid" scheduled report stores, at creation time:

    { "kind": "grid",
      "endpoint": "/api/purchases/details",     # the same API the grid uses
      "params":   { "stores": "...", "vendors": "..." },   # slicer values
      "period":   "MTD",                         # 30D|90D|7D|MTD|YTD|custom
      "date_from": "2026-07-01", "date_to": "2026-07-15",  # used when period=custom
      "columns":  [ { "id": "vou_date", "label": "Date" }, ... ],
      "title": "...", "view": "...", "filters": "...", "name": "..." }

At send time `run_grid()` calls the endpoint's Python function directly (the
scheduler already runs in-process with DuckDB access, so no HTTP / auth round
trip is needed — supplying the kwargs explicitly bypasses FastAPI's Depends()).
The rows are turned into a CSV attachment plus an HTML preview table.

To make a new grid schedulable: add its endpoint path → function to REGISTRY.
"""
import csv
import io
import logging
import inspect
from datetime import date, datetime, timedelta

log = logging.getLogger(__name__)

_MAX_ROWS = 20000          # hard cap so a scheduled email never balloons
_PREVIEW_ROWS = 30         # rows shown inline in the email body


# ── Endpoint registry (path → callable) ──────────────────────────────────────

def _registry() -> dict:
    """Lazy import to avoid circular imports at module load."""
    from routers import purchases, sales, inventory
    reg = {
        # Sales / purchasing
        "/api/purchases/details":       purchases.purchases_details,
        "/api/sales/transactions":      sales.transactions,
        "/api/sales/products":          sales.products,
        # Inventory
        "/api/inventory/items":         getattr(inventory, "inv_items", None),
        "/api/inventory/movement-by":   getattr(inventory, "inv_movement_by", None),
        "/api/inventory/transfers/details":   getattr(inventory, "transfers_details", None),
        "/api/inventory/adjustments/details": getattr(inventory, "adjustments_details", None),
        "/api/inventory/ledger":        getattr(inventory, "inventory_ledger", None),
        "/api/inventory/coverage":      getattr(inventory, "inv_coverage", None),
        "/api/inventory/history/details": getattr(inventory, "invh_details", None),
        "/api/inventory/stock-asof":    getattr(inventory, "stock_asof", None),
    }
    return {k: v for k, v in reg.items() if v is not None}


def endpoint_supported(endpoint: str) -> bool:
    try:
        return endpoint in _registry()
    except Exception:
        return False


# ── Period → date window ──────────────────────────────────────────────────────

def resolve_window(report: dict) -> tuple[str, str]:
    """Return (date_from, date_to) ISO strings. A preset rolls relative to today
    so a recurring report always covers the intended trailing window; 'custom'
    (or unknown) uses the stored absolute dates."""
    today = date.today()
    period = (report.get("period") or "").upper()

    def iso(d): return d.isoformat()

    if period == "30D":
        return iso(today - timedelta(days=29)), iso(today)
    if period == "90D":
        return iso(today - timedelta(days=89)), iso(today)
    if period == "7D":
        return iso(today - timedelta(days=6)), iso(today)
    if period == "MTD":
        return iso(today.replace(day=1)), iso(today)
    if period == "YTD":
        return iso(today.replace(month=1, day=1)), iso(today)
    # custom / unknown → stored absolute dates (fall back to last 30 days)
    df = report.get("date_from") or iso(today - timedelta(days=29))
    dt = report.get("date_to") or iso(today)
    return df, dt


# ── Run the grid's data function ──────────────────────────────────────────────

def _coerce(name: str, value):
    """date_from / date_to arrive as ISO strings; endpoint signatures type them
    as datetime.date, so convert."""
    if name in ("date_from", "date_to") and isinstance(value, str):
        try:
            return date.fromisoformat(value[:10])
        except Exception:
            return value
    return value


def run_grid(endpoint: str, params: dict) -> list[dict]:
    reg = _registry()
    fn = reg.get(endpoint)
    if fn is None:
        raise RuntimeError(f"Endpoint not schedulable: {endpoint}")
    sig = inspect.signature(fn)
    allowed = set(sig.parameters.keys())
    kwargs = {k: _coerce(k, v) for k, v in (params or {}).items() if k in allowed}
    rows = fn(**kwargs)
    # Endpoint functions return list[dict] (qdf) or occasionally a dict; normalise
    if isinstance(rows, dict):
        rows = rows.get("rows") or rows.get("data") or []
    rows = list(rows or [])
    if len(rows) > _MAX_ROWS:
        rows = rows[:_MAX_ROWS]
    return rows


# ── Output builders ───────────────────────────────────────────────────────────

def _columns(report: dict, rows: list[dict]) -> list[tuple[str, str]]:
    """Return [(field, label)]. Uses stored columns; falls back to row keys."""
    cols = report.get("columns") or []
    out = []
    for c in cols:
        fid = c.get("id") or c.get("field")
        if fid:
            out.append((fid, c.get("label") or fid))
    if not out and rows:
        out = [(k, k) for k in rows[0].keys()]
    return out


def build_csv(report: dict, rows: list[dict]) -> bytes:
    cols = _columns(report, rows)
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow([label for _, label in cols])
    for r in rows:
        w.writerow([r.get(fid, "") for fid, _ in cols])
    return buf.getvalue().encode("utf-8-sig")   # BOM → Excel opens UTF-8 cleanly


def build_preview_html(report: dict, rows: list[dict]) -> str:
    cols = _columns(report, rows)
    if not cols:
        return "<p style='color:#94a3b8'>No rows for the selected period.</p>"
    head = "".join(
        f"<th style='text-align:left;padding:6px 10px;background:#f1f5f9;"
        f"border-bottom:2px solid #e2e8f0;font-size:12px;color:#475569'>{label}</th>"
        for _, label in cols)
    body = ""
    for r in rows[:_PREVIEW_ROWS]:
        tds = "".join(
            f"<td style='padding:5px 10px;border-bottom:1px solid #eef2f7;"
            f"font-size:12px;color:#0f172a'>{'' if r.get(fid) is None else r.get(fid)}</td>"
            for fid, _ in cols)
        body += f"<tr>{tds}</tr>"
    more = ""
    if len(rows) > _PREVIEW_ROWS:
        more = (f"<p style='margin:8px 0 0;color:#64748b;font-size:12px'>"
                f"Showing first {_PREVIEW_ROWS} of {len(rows):,} rows — full data in the attached CSV.</p>")
    return (f"<div style='overflow-x:auto'><table style='width:100%;border-collapse:collapse'>"
            f"<thead><tr>{head}</tr></thead><tbody>{body}</tbody></table></div>{more}")
