# RetailTec Analytics Dashboard

A real-time analytics dashboard for **Retail Pro Prism (RPS)** built on a React + TypeScript frontend and a FastAPI + Oracle backend. Designed for retail operations teams to monitor KPIs, store performance, employee sales, and daily trends — with a Power BI-style background cache warmer for instant load times.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 18, TypeScript, Vite, MUI v5, ECharts |
| Backend | Python 3.11, FastAPI, uvicorn |
| Database | Oracle (Retail Pro Prism RPS schema) |
| DB Driver | python-oracledb (thick mode, Instant Client) |
| Caching | Disk-based pickle cache + background warmer |
| Streaming | Server-Sent Events (SSE) |

---

## Features

- **KPI Grid** — Net Sales, Gross Profit, GP%, Returns, Invoices, Avg Ticket, YoY comparison
- **6 Charts** — Daily Trend, Revenue by Store, Top Employees, Top 15 Items, Monthly Summary, Revenue Breakdown (donut)
- **Recent Transactions** — last 200 transactions with store, employee, and net amount
- **Full-screen mode** — any chart can be expanded to full screen with richer detail
- **Dark / Light mode** — toggle in header, persists across session
- **Background cache warmer** — pre-loads all store data on a schedule (like Power BI scheduled refresh)
- **Python filter layer** — dashboard filters by store in-memory from full cache; no extra DB queries
- **Streaming progress bar** — SSE streams each query result as it completes (8 steps)
- **Force refresh** — clears cache and re-fetches live data on demand

---

## Architecture

```
Browser (React + Vite)
    │
    │  SSE stream  /api/dashboard/stream
    ▼
FastAPI Backend
    │
    ├─ Check full-data cache (.rt_cache/*.pkl)
    │     └─ HIT  → filter_and_aggregate() in Python → instant response
    │     └─ MISS → run 8 Oracle queries → cache result → stream progress
    │
    ├─ Background Warmer (asyncio task, runs on startup + every 30 min)
    │     └─ Fetches ALL stores, grouped by STORE_NAME, for each preset date range
    │
    └─ Oracle DB (Retail Pro Prism RPS)
          Tables: DOCUMENT, DOCUMENT_ITEM, EMPLOYEE, STORE, SUBSIDIARY
```

---

## Project Structure

```
react-dashboard/
├── backend/
│   ├── main.py               # FastAPI app, queries, cache warmer, filter layer
│   ├── cache_config.json     # Warmer configuration (presets, interval, TTL)
│   ├── requirements.txt      # Python dependencies
│   └── .rt_cache/            # Auto-created — disk cache (excluded from Git)
├── frontend/
│   ├── src/
│   │   ├── App.tsx                        # Main layout, ChartCard, CacheBadge
│   │   ├── components/
│   │   │   ├── Header.tsx                 # Logo, title, dark mode toggle
│   │   │   ├── Sidebar.tsx                # Filters: host, dates, stores, item types
│   │   │   ├── KpiGrid.tsx / KpiCard.tsx  # KPI tiles
│   │   │   ├── LoadingProgress.tsx        # SSE progress bar
│   │   │   ├── TransactionsGrid.tsx       # Recent transactions table
│   │   │   └── charts/
│   │   │       ├── TrendChart.tsx
│   │   │       ├── StoreChart.tsx
│   │   │       ├── EmployeeChart.tsx
│   │   │       ├── TopItemsChart.tsx
│   │   │       ├── MonthlyChart.tsx
│   │   │       └── DonutChart.tsx
│   │   ├── hooks/
│   │   │   └── useStreamingDashboard.ts   # SSE consumer hook
│   │   ├── types/index.ts
│   │   ├── utils/formatters.ts
│   │   └── theme.ts                       # MUI dark/light theme factory
│   ├── public/
│   │   ├── logo-purple.png
│   │   └── logo-white.png
│   └── index.html
└── start.bat                 # Starts both backend and frontend
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

Or run both at once with `start.bat`.

---

## Cache Warmer Configuration

Edit `backend/cache_config.json` to control what gets pre-warmed:

```json
{
  "enabled": true,
  "host": "<ORACLE-SERVER>",
  "refresh_interval_minutes": 30,
  "cache_ttl_seconds": 1800,
  "presets": [
    {
      "label": "Last 30 Days — All Stores",
      "date_range_days": 30
    },
    {
      "label": "Last 7 Days — All Stores",
      "date_range_days": 7
    }
  ]
}
```

- **No `stores` field needed** — the warmer fetches all stores automatically
- Add more presets for different date ranges as needed
- Check warmer status: `GET http://localhost:8000/api/cache/status`
- Trigger manual warm: `POST http://localhost:8000/api/cache/warm`
- Clear cache: `DELETE http://localhost:8000/api/cache`

---

## API Endpoints

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/health` | Health check + warmer status |
| GET | `/api/stores` | List all stores (optionally filter by subsidiary) |
| GET | `/api/subsidiaries` | List all subsidiaries |
| GET | `/api/dashboard/stream` | SSE stream — main dashboard data |
| GET | `/api/cache/status` | Cache entries + warmer state |
| POST | `/api/cache/warm` | Trigger immediate cache warm |
| DELETE | `/api/cache` | Clear all cached data |

---

## Version History

| Version | Description |
|---|---|
| v1.0 | Initial release — full dashboard, cache warmer, dark mode, fullscreen charts, SSE streaming |

---

## Database

Connects to **Retail Pro Prism RPS** Oracle schema. Key tables used:

- `RPS.DOCUMENT` — transaction headers
- `RPS.DOCUMENT_ITEM` — line items with pricing
- `RPS.EMPLOYEE` — employee names
- `RPS.STORE` — store metadata
- `RPS.SUBSIDIARY` — subsidiary groupings

Connection defaults: host `<ORACLE-SERVER>`, port `1521`, SID `rproods`, user `<db-user>`.
