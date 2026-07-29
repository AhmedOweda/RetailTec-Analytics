---
title: "RetailTec Analytics — Project Structure (Software Perspective)"
subtitle: "Volume 3 of 5 — Technical Handover Documentation"
date: "July 2026 · App version 3.1.0"
toc: true
---

# 1. Technology Stack

| Layer | Technology |
|---|---|
| Backend | Python 3.14 · FastAPI · Uvicorn · DuckDB (warehouse) · `oracledb` (bundled Oracle Instant Client 23 — customers need nothing preinstalled) · `cryptography` (Ed25519 licensing) · `fpdf` (PDF email attachments) · `pystray` (system tray) |
| Frontend | React 18 + TypeScript · Vite · MUI (Material UI) · AG Grid Community (all data grids) · ECharts (charts) · TanStack Query (server state) · react-router · jsPDF/XLSX (client exports) |
| Packaging | PyInstaller (one-folder) · Inno Setup 6 (installer) · the built frontend (`frontend/dist`) is bundled into the exe as static files |
| Auth | JWT (python-jose), bcrypt password hashes in the warehouse `DIM_USERS` |
| i18n | Custom dictionary (`frontend/src/i18n.ts`) — full English/Arabic incl. RTL |

One process serves everything: Uvicorn hosts the API **and** the compiled SPA on port **7382**, binding `0.0.0.0` (all interfaces) by default — see the Network & security section of the README (`RETAILTEC_HOST=127.0.0.1` restricts to local-only).

# 2. Repository Layout

```
RetailTec-Analytics/
├── backend/
│   ├── main.py                 # FastAPI app: routers, SPA static serving, CORS,
│   │                           #   license domain-gate + HARD-LOCK middleware
│   ├── run_server.py           # Entry point: tray icon, uvicorn thread, autostart,
│   │                           #   sync-now (follows settings), restart/quit
│   ├── db/
│   │   ├── model.py            # Warehouse schema (v8) + migrations, get_db(),
│   │   │                       #   WAL self-heal, assert_binds, users, audit
│   │   └── sync.py             # THE sync engine: per-domain extraction SQL,
│   │                           #   watermarks, chunked streaming loads, GL load,
│   │                           #   30-day incremental floor, rebuild/replace
│   ├── routers/
│   │   ├── auth.py             # login/JWT, users CRUD, RBAC, audit
│   │   ├── common.py           # q/qdf helpers, slicer fragments, store scoping
│   │   ├── sales.py            # sales KPIs/grids + sync trigger/full-load APIs
│   │   ├── inventory.py        # inventory, coverage/stagnant, history
│   │   ├── purchases.py        # purchasing analytics
│   │   ├── accounting.py       # the whole GL suite (see Volume 5)
│   │   ├── settings.py         # settings CRUD, status, license install, range load
│   │   ├── admin.py            # backup/restore/compact, diagnostics, connections
│   │   ├── prefs.py            # saved views, grid state
│   │   ├── assistant.py        # "Ask AI" text-to-SQL (sandboxed SELECT-only)
│   │   └── diagnostics.py
│   ├── services/
│   │   ├── config.py           # settings.json load/save (locked), DPAPI password
│   │   ├── settings_schema.py  # data-model migration (per-domain schedules),
│   │   │                       #   30–90-day incremental clamp
│   │   ├── scheduler.py        # background loop: due-domain syncs, on-open sync,
│   │   │                       #   full/range/dimension triggers, quiet hours
│   │   ├── license.py          # Ed25519 verify, per-domain gate, HARD LOCK,
│   │   │                       #   device binding, sub-limit grace
│   │   ├── report_email.py     # SMTP engine, scheduled reports, digests
│   │   └── report_grid.py      # endpoint→function registry replayed by schedules
│   └── tools/                  # license_studio.py (vendor GUI), make_license.py,
│                               #   seed_demo_data.py, one-off probes
├── frontend/src/
│   ├── main.tsx / App.tsx / router.tsx / theme.ts / i18n.ts
│   ├── api/client.ts           # axios instance (JWT header, 401/403 handling)
│   ├── layout/AppShell.tsx     # sidebar/nav (license+RBAC filtered), header,
│   │                           #   subsidiary picker, LOCK SCREEN, banners
│   ├── pages/                  # one folder per module:
│   │   ├── Home.tsx            #   KPI dashboard + alert drill-throughs
│   │   ├── sales/  inventory/  purchases/  dimensions/  accounting/
│   │   ├── settings/           #   DataModelSettings.tsx (the big settings page),
│   │   │                       #   UsersManagement, AuditLog
│   │   └── auth/Login.tsx
│   ├── components/             # DataSlicer (THE shared slicer — never write a
│   │                           #   bespoke one), GridExportBar (columns/Excel/PDF/
│   │                           #   Email+schedule), KpiCard, CommandPalette,
│   │                           #   SendHistoryDialog, FirstRunWizard…
│   ├── hooks/                  # useFeatures, useLicense, useGridColumnState,
│   │                           #   useGlWindow…
│   └── utils/                  # formatters, pages registry (nav/permissions/
│                               #   license domains), pdfArabic, gridLocale
├── packaging/
│   ├── installer.iss           # Inno Setup script (versioned OutputBaseFilename)
│   ├── _exeonly.ps1            # rebuild exe only (test cycle)
│   ├── _fullbuild2.ps1         # exe + installer + Google-Drive copy
│   ├── compile_installer_local_temp.ps1  # ISCC wrapper ("temp" but LOAD-BEARING)
│   ├── backup_state_temp.ps1 / finish_deploy_temp.ps1
│   └── Output/                 # installers + License Studio exe (gitignored)
├── DB_SYNC_REDESIGN.md         # the sync architecture decision record
└── README.md                   # modules, build, security, version history
```

# 3. Backend Architecture

## 3.1 Request path
`Uvicorn → license hard-lock middleware → license domain-gate middleware → JWT dependency → router function → DuckDB cursor (per request, MVCC) → JSON`.

- **Hard-lock middleware:** while `license_lock_state()` returns a verdict (no/invalid/expired/wrong-bound license, sub-limit grace spent), every `/api` path 403s except auth, settings-status, license-install and health — the app is blocked server-side, not just visually.
- **Domain gate:** a license may restrict product domains (home, ai, sales, inventory, purchases, accounting, dimensions, reports); requests to unlicensed domains 403 for everyone, admins included. Path→domain mapping lives in `services/license.py` (`_PREFIX_DOMAIN`, shared lookups deliberately ungated).
- **Auth:** every data router requires a valid JWT; only `/api/auth/login`, `/health`, `/api/cache/status` are open. Store-scoped users are constrained server-side from the JWT claims.

## 3.2 The sync engine (`db/sync.py`)
- Per-domain extraction SQL builders (`_sql_invoices`, `_sql_sales_items`, `_sql_daily`, `_sql_purchases`, `_sql_purchase_items`, `_sql_transfers`, `_sql_adjustments`, `_sql_inventory_history`, `_sql_inventory_qty_window`, `_sql_gl`, `_sql_account_classes`) — each documents its filters, hints and the index it targets.
- `_run_sync(mode, date_from, date_to, …)` orchestrates: dimension refresh (12-h throttle on incrementals) → optional range-trim (rebuild) → streamed fact loads (Oracle cursor → chunked `_stream_insert` with positional column mapping) → large dims → watermarks → validation → run log.
- Public API: `incremental(days≥30)`, `full_load(days)`, `range_load(from,to,rebuild)`, `dimensions_load()`, `retention_prune()`; all called via `services/scheduler.py` which serializes runs behind one lock and exposes progress to the UI.
- Licensing hooks: refuses to run while hard-locked; subsidiary-limit grace enforcement; `WAREHOUSE_META.source_host` binding.

## 3.3 Report engine
`report_email.py` (SMTP, HTML digests, attachment rendering, recipient validation, retry policy: config failures retry daily, transient failures per-minute) + `report_grid.py` (registry mapping endpoint paths to router functions so a schedule replays the *exact* grid the user saw, with their saved params). Schedules are configured per-grid from the Email dialog and managed in Settings → Reports & Email. The engine runs inside the tray process — the app must stay running for schedules to fire.

## 3.4 Conventions (keep these)
- **Parameterized SQL only** for free-text values; interpolation is allowed solely for FastAPI-validated dates/ints and server-side whitelists (documented in `routers/common.py`).
- `assert_binds` guards every query — clear failure on placeholder/param mismatch.
- Endpoints are plain `def` functions (report_grid introspects signatures — don't wrap them in decorators that change signatures).
- Fail-open philosophy for platform checks (license read errors never brick a licensed customer); fail-closed for data honesty (balanced gate, never-empty guards).
- Comments in the code explain *why* (many carry dated postmortems) — preserve them when refactoring.

# 4. Frontend Architecture

- **AppShell** owns navigation (sections auto-collapse; entries filtered by license domains → user page permissions → mobile), the global header (search/palette Ctrl-K, dark-mode toggle, connection chip, subsidiary picker, date), banners (license warnings) and the **license lock screen**.
- **Pages** follow one scaffold: sticky header with title + DataSlicer row → KPI cards → chart(s) → AG Grid with GridExportBar. Saved views persist slicer+columns per user.
- **DataSlicer** is the single shared slicer component (date presets 7D/30D/MTD/YTD + custom, stores, subsidiaries, per-page extras). Never build a bespoke slicer.
- **GridExportBar** provides column picker, Excel, PDF (Arabic-shaped), and Email (send-now + recurring schedule) — Email appears only when the `reports` domain is licensed.
- **i18n:** `tr('English text')` keys with Arabic values in `i18n.ts`; `trCols` translates AG Grid columns; the app is fully RTL-aware. Add a key for every new user-visible string.
- **Theme:** brand purple `#7c3aed`; all colors go through `--rt-*` CSS tokens so dark mode works — never hardcode hex in pages (a documented past bug).
- **Drill-throughs** pass full context in URL params; the target page reads them on mount (`AccountingFilters`, Journals, GL patterns).

# 5. Build, Versioning & Release

## 5.1 Version identity
`backend/db/model.py: APP_VERSION` (shown in About) must match `main.py` FastAPI version and the installer's `/DAppVersion`. Warehouse `SCHEMA_VERSION` migrates independently (additive migrations in `_ensure_schema`).

## 5.2 Build pipeline (owner machine)
1. `cd frontend && npm install --include=dev` (this machine's npm is configured `omit=dev`!) then `npm run build`.
2. `packaging\_exeonly.ps1` — kills the app, backs up state, PyInstaller into `out2`, robocopy-mirror to `out\`, restores state, relaunches, health-checks. Use for test cycles.
3. `packaging\_fullbuild2.ps1` — everything above **plus** ISCC installer + copy to `G:\My Drive\RetailTec Builds\`.
4. Installer naming: `RetailTecAnalytics-Setup-{version}-{yyyymmdd-hhnn}.exe` — always pass `ISCC /DAppVersion=<current APP_VERSION>`.
5. GitHub: source pushed to `main`; **binaries go to Releases** (`gh release create v<ver>-<date> <installer> <LicenseStudio> --notes-file … --latest`). The 181 MB upload takes ~10 minutes; the release publishes itself when assets finish.
6. License Studio: rebuild whenever `backend/tools/license_studio.py` changes — `pip install customtkinter` + PyInstaller `--onefile --noconsole --collect-all customtkinter` (close the running Studio first; the exe is locked).

## 5.3 Environment traps (dev machine)
- PowerShell `-Command` strings get `$_`/`$var` stripped by some hosts — put non-trivial PowerShell in `.ps1` files and run with `-File`.
- `git` writes progress to stderr → under `$ErrorActionPreference='Stop'` scripted git dies; use `'Continue'` + check `$LASTEXITCODE`.
- Windows Defender locks the warehouse `.db` after the app runs — never build into a folder that contains it (hence `out2`).
- Before builds, clear stale `*.db.wal*` from `out\…\_internal` and the state backup (the app now also self-heals at startup, and the installer build sweeps `*.bak/*.corrupt` — they would ship customer data).
- `.iss` files do not support backslash line continuation.

# 6. Security Model

- JWT auth everywhere; default admin seed `Retailtec@123` forces attention on first login; bcrypt hashes; audit log of admin actions.
- Oracle credentials DPAPI-encrypted at rest in `settings.json`.
- License: Ed25519-signed `license.json` (payload+signature), public key embedded in `services/license.py`; **private key never in the repo or installer** — vendor-held (`packaging/Output/*.pem`, gitignored). Per-domain product gating + hard lock (Volume 4 §6 covers operations, Volume 5 the vendor side).
- Server listens on 0.0.0.0:7382 by design (VPN/LAN deployments) — keep behind VPN/firewall; never expose to the public internet; `RETAILTEC_HOST=127.0.0.1` for local-only.
- The SPA and API share one origin — no CORS surface in production.

# 7. Where to Start as the New Maintainer

1. Run from source: backend `uvicorn main:app --port 7382` + frontend `npm run dev` (README §Development).
2. Read `DB_SYNC_REDESIGN.md`, then `db/sync.py` top-to-bottom — the sync engine is the heart.
3. Skim `routers/common.py` (query conventions) and one page pair (`routers/sales.py` + `pages/sales/Transactions.tsx`) to learn the scaffold.
4. Volume 5 before touching anything in `accounting.py`.
5. Respect the dated comments — they are the postmortem record of every production incident.
