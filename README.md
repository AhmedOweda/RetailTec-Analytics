# RetailTec Analytics Dashboard

A self-contained, offline-capable analytics dashboard for **Retail Pro Prism (RPS)** retail management systems.  
Built on React + TypeScript (frontend) and FastAPI + DuckDB (backend). Syncs data from Oracle once, then answers every query locally — no live Oracle connection needed at runtime.

---

## What's New in v2.0

v2.0 is a complete architectural rebuild over v1.0:

| Area | v1.0 | v2.0 |
|---|---|---|
| Data source at runtime | Live Oracle queries | Local DuckDB (star schema) |
| Query latency | 2–8 s per request | < 100 ms |
| Multi-page routing | ❌ Single page | ✅ Overview / Performance / Products / Transactions |
| Sync engine | None | Oracle → DuckDB incremental + full load |
| Transaction table | 200-row list | AG Grid — unlimited rows, sortable, resizable, paginated |
| Export | ❌ | ✅ Excel + PDF (filtered rows only) |
| KPI comparisons | ❌ | ✅ Period-over-period arrows (Today vs Yesterday, MTD vs LMTD, YTD vs LYTD) |
| Return Rate | Count-based | Value-based (return amount ÷ gross sales) |
| Discount tracking | Header discount only (often 0) | Item + header + loyalty discounts combined |

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 18, TypeScript, Vite, MUI v5, ECharts, AG Grid Community |
| Backend | Python 3.11, FastAPI, uvicorn |
| Local DB | DuckDB (star schema — synced from Oracle) |
| Oracle driver | python-oracledb (thick mode, Instant Client) |
| Export | SheetJS (xlsx), jsPDF + jspdf-autotable |
| Desktop wrapper | Electron (optional) |

---

## Features

### Overview Page
- **4 KPI cards** — Today / Yesterday / Month-to-Date / Year-to-Date
- **Period-over-period comparison badges** — green ↑ / red ↓ arrows with % change vs prior period
- **Per-card stats**: Net Sales, Incl. Tax, Tax Amount, Invoices (with thousands separator), Returns + Rate % badge, Avg Ticket, Discount + Ratio % badge
- **Return Rate** computed as `return amount ÷ gross sales × 100` (value-based, not count-based)
- **Discount Ratio** computed from real totals: `item disc + invoice disc + loyalty disc`
- **Sales Trend chart** — net sales (area) + invoices (bars) + return rate % (dashed line), with **7D / 30D / MTD / YTD** period selector

### Transactions Page
- **AG Grid** — resizable and sortable columns, drag to reorder
- **# index column** — live row number that reorders on every sort/filter change
- **Unlimited rows** — no cap; DuckDB returns full result set
- **Server-side search** — ILIKE across doc_no, store, associate, customer (searches full dataset, not just current page)
- **Advanced filters popup** — field-level filters for Doc No, Store, Associate, Customer, Type (Sale/Return/Order toggles), Net Sales range; active filters shown as chips with individual ✕ remove
- **Export** — Excel (.xlsx) and PDF (A3 landscape) of currently visible (filtered) rows only

### Performance Page
- Per-store breakdown — net sales, invoices, returns, discount
- Top associates — net sales, invoice count, avg basket
- Daily trend chart by period

### Products Page
- Top items by revenue, GP, GP%
- Group by: Item / DCS / Vendor / Department

### Sync Engine
- **Incremental sync** — last 7 days, DELETE + re-insert
- **Full load** — configurable date range, INSERT OR IGNORE (resumable)
- **Smart dimension loading** — DIM_CUSTOMER and DIM_ITEM loaded with Oracle-side date subquery filter (only records referenced in the sync window), avoiding loading millions of unused rows
- **Progress streaming** — SSE stream shows live chunk progress during sync
- Fact data in weekly chunks for memory efficiency and cancellability

---

## Architecture

```
Browser (React + Vite)
    │
    │  REST + SSE
    ▼
FastAPI Backend
    │
    ├─ DuckDB  (local star schema)
    │     ├─ FACT_SALES_DAILY      — daily aggregates by store
    │     ├─ FACT_SALES_INVOICES   — one row per transaction
    │     ├─ FACT_SALES_ITEMS      — one row per line item
    │     ├─ DIM_STORE / DIM_EMPLOYEE / DIM_CUSTOMER
    │     ├─ DIM_ITEM / DIM_DCS / DIM_VENDOR / DIM_SUBSIDIARY
    │     └─ All queries JOIN at query time (true star schema)
    │
    └─ Oracle DB (Retail Pro Prism RPS)
          Connected only during sync — not at query time
          Tables: DOCUMENT, DOCUMENT_ITEM, EMPLOYEE, STORE,
                  SUBSIDIARY, INVN_SBS_ITEM, DCS, VENDOR, CUSTOMER
```

---

## Project Structure

```
react-dashboard/
├── backend/
│   ├── main.py                   # FastAPI app + startup sync trigger
│   ├── launcher.py               # PyInstaller entry point (Electron build)
│   ├── settings.json             # Oracle connection + sync config
│   ├── requirements.txt
│   ├── db/
│   │   ├── model.py              # DuckDB schema + _ensure_schema()
│   │   └── sync.py               # Oracle → DuckDB sync engine
│   ├── routers/
│   │   ├── sales.py              # All sales API endpoints
│   │   └── settings.py           # Connection settings API
│   └── services/
│       └── scheduler.py          # Incremental sync scheduler
├── frontend/
│   ├── src/
│   │   ├── layout/               # AppShell, Sidebar, Header
│   │   ├── pages/
│   │   │   └── sales/
│   │   │       ├── Overview.tsx       # KPI cards + trend chart
│   │   │       ├── Performance.tsx    # Store + employee breakdowns
│   │   │       ├── Products.tsx       # Item / DCS / vendor / dept
│   │   │       └── Transactions.tsx   # AG Grid table + export
│   │   ├── router.tsx
│   │   └── utils/formatters.ts
│   ├── package.json
│   └── index.html
├── electron/
│   ├── main.js                   # Electron window + backend spawn
│   └── preload.js
├── build/
│   ├── build-backend.bat         # PyInstaller build
│   └── build-app.bat             # Electron packaging
└── package.json                  # Root Electron builder config
```

---

## Setup

### Prerequisites

- Python 3.11+
- Node.js 18+
- Oracle Instant Client 23.x in `C:\db_mcp\instantclient_23_0`

### Backend

```bash
cd backend
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

### Frontend

```bash
cd frontend
npm install
npm run dev
```

App runs at `http://localhost:3000`.  
Backend runs at `http://localhost:8000`.

---

## First-Time Data Load

1. Open **Settings** in the sidebar
2. Enter your Oracle connection details and save
3. Click **Load All Data** to run the initial full sync (progress shown live)
4. Navigate to **Overview** — data is ready

After the initial load, the backend triggers a 7-day incremental sync automatically on each startup.

---

## API Endpoints

### Sales

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/sales/overview` | Today / Yesterday / MTD / YTD KPIs + comparisons |
| GET | `/api/sales/trend` | Daily trend series (net sales, invoices, returns) |
| GET | `/api/sales/stores` | Per-store breakdown |
| GET | `/api/sales/employees` | Top employees by net sales |
| GET | `/api/sales/products` | Top items / DCS / vendor / department |
| GET | `/api/sales/transactions` | Invoice list — paginated, server-side search |
| GET | `/api/sales/stores-list` | Distinct store names for filter UI |

### Sync

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/sync/trigger` | Trigger incremental sync (last 7 days) |
| GET | `/api/sync/status` | Current sync state + progress |
| POST | `/api/sync/full-load` | Trigger full reload (all data) |

---

## Star Schema

```
                    DIM_STORE
                    DIM_EMPLOYEE
                    DIM_CUSTOMER
FACT_SALES_DAILY ──────────────── DIM_SUBSIDIARY
FACT_SALES_INVOICES
FACT_SALES_ITEMS ───────────────── DIM_ITEM
                                       │
                                   DIM_DCS
                                   DIM_VENDOR
```

All dimensions are joined at query time in DuckDB — no pre-joined denormalized tables.

---

## Version History

| Version | Description |
|---|---|
| v2.0 | Complete rebuild — DuckDB star schema, multi-page SPA, AG Grid transactions, advanced search, Excel/PDF export, KPI comparisons, value-based return rate, real discount tracking, Electron wrapper |
| v1.0 | Initial release — live Oracle queries, single-page dashboard, cache warmer, dark mode, SSE streaming |
