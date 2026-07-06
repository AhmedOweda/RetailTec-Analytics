# RetailTec Analytics — Handover / Onboarding

A self-contained brief for a fresh AI assistant (or developer) picking up this
project with **no prior memory**. Read this end-to-end before making changes.

---

## 1. What this is

**RetailTec Analytics** is an offline BI dashboard for **Retail Pro Prism**,
sold as a commercial product to retail/pharmacy chains in the Gulf.

- **Pipeline:** Oracle (Prism `RPS.*`) → Python/FastAPI sync → local **DuckDB**
  star schema → React front end. Customers keep data on-premises; reports are
  fast and work offline. Oracle is touched only during syncs (index-aware queries).
- **Backend:** FastAPI + DuckDB + `oracledb` (thick mode). Under `backend/`.
- **Frontend:** React + TypeScript + Vite + MUI + AG Grid + ECharts. Under `frontend/`.
- **Repo:** https://github.com/AhmedOweda/RetailTec-Analytics — Git Credential
  Manager is signed in on the owner's laptop; `git push origin main` just works.
- **Owner:** Waseem Aboali (waseem@retail-tec.com).
- **Bilingual:** English + Arabic with full RTL. Language flips layout direction.

---

## 2. Environment & tooling (Windows) — READ THIS

- **Windows paths.** Repo at `C:\RetailTec Analytics\RetailTec-Analytics`
  (note the SPACE). Python 3.12 at
  `C:\Users\MODY\AppData\Local\Programs\Python\Python312\python.exe`
  (`python`/`py` are NOT on PATH in some shells).
- **STALE-MOUNT TRAP (critical for AI tools):** any Linux sandbox mount serves
  **stale/truncated** views of recently-written files. Do ALL file reads/writes,
  git, and builds with the **Windows-side tools** (Desktop Commander MCP:
  `read_file`, `edit_block`, `write_file`, `start_process`), never sandbox bash.
  A past session corrupted a file by ignoring this.
- **Shells break on punctuation.** Desktop Commander runs PowerShell; wrap
  commands as `cmd /c "..."`. **Git commit messages must be plain words only**
  (no commas, `<`, `>`, `=`, parentheses, slashes) or the shell mis-parses. The
  `for /f` PID loop also breaks inline — get the PID with `netstat`, then
  `taskkill` in a separate step.
- **Frontend build:** `cd frontend && node_modules\.bin\vite.cmd build`
  (or `npm run build`). The build script is just `vite build` — it does NOT run
  `tsc`, and it tolerates the legacy `src/App.tsx` tsc errors (that file is
  orphaned). Build takes ~20-50s. Duplicate-i18n-key warnings are non-fatal.
- **Frontend dev:** `cd frontend && npm run dev` (Vite on :7383 proxying /api →
  127.0.0.1:8000). Before `npm install`, set
  `$env:ComSpec='C:\WINDOWS\System32\cmd.exe'` or npm crashes.
- **Backend run:** from `backend/`,
  `python -m uvicorn main:app --host 127.0.0.1 --port 8000`. It does NOT
  auto-reload dependency changes; restart it after editing backend code. To
  restart headless: get the PID on :8000 via `netstat`, `taskkill /F /PID <pid>`,
  then relaunch via PowerShell `Start-Process ... -WindowStyle Hidden`. Verify
  with `curl.exe -s -f -m 8 -o NUL http://127.0.0.1:8000/docs && echo OK`.
- **DuckDB is single-writer / single-process.** Only ONE backend at a time.
  You CANNOT open the warehouse from a second process while the backend runs. To
  run a diagnostic/one-off query or reset a password, **stop the backend first**,
  run the script, then restart.
- **`starlette` / `sse-starlette` TRAP (recurring!):** FastAPI 0.111 needs
  `starlette<0.38`. Something on the machine keeps installing **`sse-starlette`**
  (which requires starlette>=0.49), silently upgrading starlette and breaking
  startup with `TypeError: Router.__init__() got an unexpected keyword argument
  'on_startup'`. Fix: `python -m pip install starlette==0.37.2`. `requirements.txt`
  already pins it; a clean `pip install -r requirements.txt` also restores it.
  Permanent fix would be uninstalling `sse-starlette` if nothing uses it.
- **Oracle:** thick mode, client currently at `C:\db_mcp\instantclient_23_0`
  (was `C:\Oracle\instantclient` v19 previously). Account has an old verifier so
  thin mode fails (DPY-3015). Customers need Instant Client installed separately
  (not redistributable in the installer).
- **Browser quirk:** Chrome on this machine cannot load `localhost`; the owner
  uses **Firefox**. Test via `curl.exe`, not a headless Chrome tool.
- **Admin login:** default seed password is `Retailtec@123` (also triggers the
  forced-change dialog). The owner changed it after a reset; if locked out, reset
  by stopping the backend and running a script that does
  `from db.model import get_db, hash_password;
  con.execute("UPDATE DIM_USERS SET password_hash=? WHERE lower(username)='admin'",[hash_password(pw)])`.

---

## 3. Architecture map

**Backend (`backend/`)**
- `main.py` — mounts routers, all data routers behind `Depends(get_current_user)`.
- `db/model.py` — DuckDB schema/`ensure_schema` (runs at startup, idempotent
  migrations), `get_db`, `DB_LOCK` (ONE process-wide lock — every module touching
  the shared connection must use it), `hash_password`/`verify_password`,
  `record_audit`, `APP_VERSION`/`SCHEMA_VERSION`.
- `db/sync.py` — Oracle→DuckDB ingestion (insert-only immutable facts, streaming
  scan, adaptive Oracle index hints). `_load_dimensions` (Step 1 of every sync)
  refreshes DIM_* tables from `RPS.*`.
- `routers/` — `auth`, `sales`, `inventory`, `purchases`, `admin`, `settings`,
  `prefs`, `diagnostics`, `common` (shared query helpers + `scoped_stores` /
  `scoped_subsidiaries` scope enforcement + `store_filter`/`subsidiary_filter`).
- `services/` — `config` (DPAPI-encrypted secrets, single load/save_settings),
  `scheduler` (background sync loop + weekly CHECKPOINT + monthly backup),
  `backup` (COPY-FROM-DATABASE backup + keep-last-N pruning), `license`
  (non-blocking Ed25519 license status), `report_email`, `schedule`.
- `run_server.py` — packaged entry point (serves bundled SPA + API on :7382,
  windowless, system-tray icon).

**Star schema (DuckDB):** `FACT_SALES_DAILY`, `FACT_SALES_INVOICES`,
`FACT_SALES_ITEMS`, `FACT_INVENTORY`, `FACT_TRANSFERS`, `FACT_ADJUSTMENTS`,
`FACT_PURCHASES(_ITEMS)`, `FACT_INVENTORY_HISTORY`; dims `DIM_STORE`,
`DIM_SUBSIDIARY`, `DIM_EMPLOYEE`, `DIM_CUSTOMER`, `DIM_ITEM`, `DIM_VENDOR`,
`DIM_DATE`; app tables `DIM_USERS`, `AUDIT_LOG`, `USER_PREFS`, `SYNC_VALIDATION`.
Sales facts carry `SUBSIDIARY_SID` directly; other facts resolve subsidiary via
the `DIM_STORE.SUBSIDIARY_SID` join.

**Frontend (`frontend/src/`)**
- `layout/AppShell.tsx` — sidebar nav + top header (brand, date chip, subsidiary
  selector, sync/validation badges), forced-password dialog, first-run wizard.
- `router.tsx` — routes; admin-only routes use `<ProtectedRoute adminOnly>`.
- `pages/` — sales (Overview/Performance/Products/Transactions), inventory
  (Overview=Stock Levels/Movement/Transfers/Adjustments/Ledger/Coverage/History),
  purchases (Overview/Transactions), dimensions (Stores/Customers/Employees/
  Items/Vendors), settings (DataModelSettings with tabs, UsersManagement, AuditLog).
- `api/client.ts` — axios instance + global interceptors (Bearer token, 401→login,
  subsidiary param). `hooks/useGridColumnState.ts` — per-user AG-Grid layout
  persistence (localStorage + `/api/prefs`). `i18n.ts` — flat English→Arabic dict
  with `tr()`/`trf()`/`trCols()`; keep Western digits in Arabic.
- `state/subsidiary.ts` — module store for the selected subsidiary.
- Data viz: ECharts via a shared `components/EChart.tsx`; palette in
  `theme/chartPalette.ts`.

---

## 4. Security / scoping model

JWT auth on every endpoint; bcrypt-style password hashing; DPAPI-encrypted
Oracle/SMTP passwords at rest; parameterized SQL everywhere; CORS locked to
localhost. **Per-user scoping:** `DIM_USERS.stores` and `DIM_USERS.subsidiaries`
(CSV claims) enforced server-side via `scoped_stores`/`scoped_subsidiaries`
(admins/empty claim = unrestricted). Per-user page permissions
(`DIM_USERS.pages`). Non-blocking license status (never gates startup).

---

## 5. What was built recently (July 2026)

- **Arabic/RTL** across all pages incl. Settings/Users; grid headers wrap;
  Voucher=أذن استلام, Slip=أذن صرف.
- **Arabic PDF export** via html2canvas (browser shaping) — triggers whenever the
  export contains Arabic (headers or data), in both UI languages; paginated as
  compressed JPEG slices (a naive full-image-per-page version produced 400 MB
  files). English/Latin exports still use jsPDF autoTable.
- **Multi-subsidiary support** (design: GLOBAL header selector, PER-USER scoping,
  ALWAYS available when >1 subsidiary, no license gating): `DIM_STORE.SUBSIDIARY_SID`
  (derived from sales facts), `subsidiary_filter`/`scoped_subsidiaries`,
  `/api/sales/subsidiaries-list`, `subsidiaries` claim through auth + user CRUD,
  filter threaded through sales/inventory/purchases/transfers endpoints, a header
  `SubsidiarySelect` (shown only when >1) that appends `subsidiaries=` via an axios
  interceptor and invalidates queries on change, and a Subsidiaries multi-select in Users.
- **Audit-log viewer** page (`/settings/audit`, admin) with date range.
- **Monthly auto-backup** + keep-last-N retention (`services/backup.py`,
  scheduler hook, `backup_retention` setting + Maintenance UI field).
- **Windowless packaging**: `packaging/build.ps1` uses `--noconsole`;
  `run_server.py` logs to `retailtec.log` + shows a pystray tray icon (Open
  dashboard / Quit); new `packaging/installer.iss` (Inno Setup) auto-compiled by
  build.ps1 when ISCC is present.
- Charts, empty states, header polish; export toolbars standardized on all grids.

---

## 6. OPEN ISSUES / things to verify

1. **`DIM_STORE` can end up empty → store dropdowns break.** Root cause fixed in
   `db/sync.py` (the store insert now names columns explicitly, since
   `DIM_STORE` gained `SUBSIDIARY_SID` — a positional 3-into-4 insert failed and
   left the table empty after the sync's `DELETE`). **To recover: refresh the app
   (on-open sync reloads dims) or run Settings → Load All Data.** Verify
   `SELECT COUNT(*) FROM DIM_STORE` > 0 after.
2. **Subsidiary selector only shows when >1 subsidiary exists.** The current
   warehouse has 1 subsidiary loaded, so the selector is (correctly) hidden. If
   the business has more, confirm `RPS.SUBSIDIARY` and the sync loaded them.
3. **`DIM_STORE.SUBSIDIARY_SID` population** is derived from sales facts via a
   startup migration. If any stores are NULL, inventory/purchases subsidiary
   filtering under-returns for that subsidiary. A cleaner fix is to pull the
   subsidiary column authoritatively from `RPS.STORE` in `_load_dimensions`
   (current query selects only SID, STORE_CODE, STORE_NAME).
4. **Inventory Ledger** (`/api/inventory/ledger` + `/ledger/kpi`) does NOT apply
   the subsidiary filter (intricate multi-CTE SQL, skipped for safety). A
   subsidiary-scoped user with an empty stores claim would see all-subsidiary
   ledger data. Wire carefully with DB testing.
5. **Single-word grid headers** in very narrow columns may still wrap oddly;
   mitigated (word-break normal + smaller header font + tighter padding) but a
   per-column minWidth would be more robust.
6. **`sse-starlette`** keeps re-breaking startup (see §2). Consider removing it.

---

## 7. Roadmap remaining (from EXPERT_REVIEW_2026-07.md)

Items 1-4 (post-sync validation + reconciliation suite, forced password change +
audit log, Arabic/RTL) and the productization items (license mechanism, Settings
tabs + first-run wizard, About/diagnostics, whitelabel branding, packaging,
monthly backup) are DONE. Nice-to-haves left: authoritative store→subsidiary
from RPS.STORE, ledger subsidiary filter, and general QA against live data.

Other docs in the repo: `HANDOFF.md` (technical TODO log), `DB_SYNC_REDESIGN.md`
(sync design), `EXPERT_REVIEW*.md` (assessments), `Krunch Queries feb 2024/`
(reference Prism SQL used to validate column semantics — the product's moat).
