# RetailTec Analytics

A self-contained, offline-capable business-intelligence suite for **Retail Pro Prism (RPS)**.
Syncs from Oracle into a local **DuckDB star schema**, then answers every query locally — no live
Oracle connection at runtime. Ships as a single Windows installer (PyInstaller + Inno Setup) that
runs in the system tray and serves the app on `http://127.0.0.1:7382`.

**Stack:** FastAPI + DuckDB + python-oracledb (backend) · React 18 + TypeScript + MUI + ECharts + AG Grid (frontend) · fully bilingual **English / Arabic (RTL)** · light + dark mode.

---

## Modules

| Domain | What it does |
|---|---|
| **Home** | KPI dashboard, sales trend, top stores/items/suppliers, governance **alerts** that drill through to the exact filtered rows they counted |
| **Sales** | Overview, Performance (stores/associates/customers), Products, **Invoice Summary**, **Invoice Details** (master–detail invoice → lines) |
| **Inventory** | Stock Levels, **Stock by Date** (as-of carry-forward), Movement, Transfers, Adjustments, Ledger, History, Coverage |
| **Purchasing** | Overview, Vouchers (master–detail) |
| **Dimensions** | Stores, Customers, Employees, Items, Suppliers |
| **Accounting** | Full financial suite over a **virtual general ledger** (Retail Pro subsidiary 100): Journal, Trial Balance, **Profit & Loss**, **Balance Sheet**, **BP Statement (كشف حساب)**, **AR/AP Aging** (with charts), General Ledger, GL Exceptions — see below |
| **Data Analyst (AI)** | Ask-AI text-to-SQL assistant with a strict SQL safety guard; provider-agnostic (Ollama / OpenAI-compatible / Groq) |
| **Reports & Email** | Any grid is schedulable: server-side engine renders CSV / Excel / PDF attachments and emails them on cron-like schedules |

### Accounting (virtual GL)

The customization posts double-entry journals into Retail Pro **subsidiary 100**: the chart of
accounts is stored as non-inventory items, and each journal line is a `DOCUMENT_ITEM` row
(amount in `PRICE`, sign via `ITEM_TYPE` 1 = debit / 2 = credit; source document metadata in the
NOTE fields). The warehouse extracts this into `FACT_GL` / `FACT_GL_DOC` / `DIM_ACCOUNT` and the
reports enforce a **balanced-document gate**: statements include only source documents that net to
zero, and the **GL Exceptions** page lists every excluded document with its imbalance so nothing is
ever hidden. Features: transaction-date vs posting-date basis, Payment/Transaction/Entry journal
categories (`P_*` prefix), business-partner resolution (customer vs supplier), and drill-throughs
(Trial Balance → General Ledger, Aging → BP Statement). The Trial Balance is verified to tie to
Oracle to the cent.

**Statements.** Account **classification** comes from a Prism touch menu named `accounting` in
subsidiary 100 (level 1 = the classes, level 2 = groups; any depth is walked); each class maps to a
statement role (asset / liability / equity / revenue / cost) via auto-recognition (EN + AR) plus
admin overrides in Settings → Accounting. The **P&L** always lists revenue sections before cost
sections (Gross Profit after the trading-cost section), the **Balance Sheet** balances via a
synthetic *Current period result* equity row, and unclassified accounts are always shown, never
dropped. Built-in defaults classify the integration's known chart on fresh installs.

**Partner reports.** The **BP Statement** defaults to the *control-account view* — only the
configured receivable/payable accounts, so the running balance IS what the partner owes and the
closing reconciles with Aging by construction; an *All lines (audit)* toggle shows the full posting
trail. **Aging** is balance-based FIFO against the most recent charges (open-item links don't
exist in this GL), measured on the configured control accounts — the codes are configurable in
Settings → Accounting and accept both the numeric (`1220.01` / `3100.01`) and renamed (`AR` / `AP`)
ALU conventions.

---

## Key capabilities

- **Offline star schema** — one Oracle scan per sync, streamed inserts, incremental watermarks,
  mutability-aware load model, never-empty guards, self-healing validation. Optional source
  customizations (inventory history, the accounting subsidiary) are **capability-detected**:
  servers without them degrade gracefully instead of erroring.
- **Licensing** — Ed25519-signed license files with subsidiary limits, device/host binding, grace
  period, and **per-domain licensing**: a license enumerates the modules bought (sales, inventory,
  accounting, ai, …) and everything else disappears — nav, routes, API (403), settings — even for
  admins. Licenses are generated with the bundled License Studio GUI.
- **Configurable item identifier** — ALU, UPC or Description; honoured by every grid, chart,
  search and emailed report (server-side, with ALU fallback).
- **One shared slicer** (`DataSlicer`) used by every page — identical shape, data and behaviour,
  with exact-id vs fuzzy-text filtering.
- **Saved views, drill-through, command palette (Ctrl-K), per-user page permissions, audit log,
  responsive mobile layout.**

---

## Repository layout

```
backend/
  main.py                 # FastAPI app, static SPA serving, license middleware
  db/model.py             # DuckDB DDL (_ensure_schema), SCHEMA_VERSION, migrations
  db/sync.py              # Oracle → DuckDB sync engine (extracts, guards, watermarks)
  routers/                # sales, inventory, purchases, accounting, settings, admin, …
  services/               # report engine, email, scheduler, license, AI assistant, settings
  tools/                  # License Studio (GUI) + make_license CLI
frontend/
  src/pages/              # one folder per domain (sales, inventory, accounting, …)
  src/components/         # DataSlicer, GridExportBar, KpiCard, EChart, …
  src/design-tokens.css   # all colours as --rt-* tokens (light + dark)
  src/i18n.ts             # EN→AR dictionary (tr()/trf())
packaging/
  _exeonly.ps1            # PyInstaller onedir build (use THIS one)
  installer.iss           # Inno Setup script → versioned installer
```

## Development

```bash
# backend
cd backend && pip install -r requirements.txt
uvicorn main:app --reload --port 7382

# frontend
cd frontend && npm install && npm run dev
```

Oracle Instant Client (thick mode) must be available; the packaged app bundles it.

## Building a release

```powershell
cd packaging
powershell -ExecutionPolicy Bypass -File _exeonly.ps1      # → packaging\out\RetailTecAnalytics\ (test build)
# test the exe, then compile the versioned installer:
powershell -ExecutionPolicy Bypass -File compile_installer_local_temp.ps1   # → packaging\Output\RetailTecAnalytics-Setup-<ver>-<stamp>.exe
# or _fullbuild2.ps1 for the whole chain (build + installer + copy to the release drive)
```

Notes: the `*_temp.ps1` helpers are load-bearing (the build scripts call them) — don't delete
them. Before compiling an installer, make sure no `*.db.wal.*` recovery leftovers sit in
`out\RetailTecAnalytics\_internal` — the `.iss` excludes live state but not renamed backups.

The scheduler runs in-process, so the tray app must stay running for scheduled emails to fire.

## First-time data load

1. Settings → connection → save
2. Settings → **Your data** → *Load All Data now* (per-domain schedules and windows are configurable;
   the Accounting domain appears only when the server carries the customization)
3. Dark mode, language (EN/AR), item identifier and email preferences live in Settings → Display / Reports & Email

---

## Network & security

The packaged app listens on **all interfaces** (`0.0.0.0:7382`) so the dashboard is reachable
over VPN/LAN at `http://<server-ip>:7382` — a deliberate deployment choice for customer servers.
Operate it accordingly:

- Keep the server behind a **VPN or firewall**. Never expose port 7382 to the public internet —
  the login page would be reachable by anyone who can reach the network.
- Allow the port explicitly where needed:
  `netsh advfirewall firewall add rule name="RetailTec 7382" dir=in action=allow protocol=TCP localport=7382`
- To restrict the app to the machine it runs on, set the environment variable
  `RETAILTEC_HOST=127.0.0.1` before starting it (service/tray restart required).

## Warehouse

29 tables: 9 dimensions, 11 fact tables (sales, inventory, purchases, GL), 9 ETL/control tables.
Facts carry their own `SUBSIDIARY_SID`; relationships are implicit (documented in the ERD:
`RetailTec-Warehouse-ERD.html`). Subsidiary 100 (the virtual GL) is quarantined from every
non-accounting extract and screen.

## Version history

| Version | Highlights |
|---|---|
| 2026-07-27 | **Full accounting suite**: P&L + Balance Sheet (Prism touch-menu classification, class→role mapping), BP Statement with control-account view, AR/AP Aging (FIFO, charts), accounting settings (class roles, control accounts, report defaults, one dirty-aware save bar); cross-server hardening (NVARCHAR2 / ORA-12704, mixed NOTE8 date formats / ORA-01861); AR/AP ALU-rename support; posting-query companion fixes (deposit receipts, undefined-tender catch-all, custom tenders 19–28); Invoice Summary / Invoice Details renames; scheduled-email hardening (py3.14) |
| v3.x backend / v2.0 app | Accounting virtual GL + 4 reports, domain licensing, DataSlicer unification, item-identifier setting end-to-end, complete Arabic coverage, report engine (schedules + CSV/Excel/PDF email), AI assistant, dark mode, mobile layout, saved views, alerts with exact drill-through |
| v2.0 | DuckDB star schema rebuild, multi-page SPA, AG Grid, exports, KPI comparisons |
| v1.0 | Initial release — live Oracle queries, single-page dashboard |
