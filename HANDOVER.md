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

- **Windows paths (updated 7 Jul 2026, Ahmed's machine).** Repo at
  `C:\RetailTec\RetailTec-Analytics` (fresh clone — the old
  `C:\RetailTec Analytics\...` path with the space is GONE). Python 3.14.2 is
  `python` on PATH (`C:\Python314`); the old MODY 3.12 path does not exist here.
- **npm skips dev deps on this machine:** global npm config has `omit=dev`, so
  plain `npm install` in `frontend/` silently skips vite and the app won't
  start. Always `npm install --include=dev`.
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
- **Test Oracle servers:** `34.78.79.51` (single subsidiary, production-like
  volume, ~19M fact rows, the server Krunch was validated against) and
  `217.154.181.17` (3 subsidiaries: Qahwa, Qahwa Riyadh, Sofa — small test data).
  Same `reportuser` credentials on both; read them from the app settings
  (`services/config.load_settings()` decrypts DPAPI). Service name `rproods`,
  port 1521.
- **Chrome DOES work on `127.0.0.1:<port>`** (verified July 2026) — the old
  "Chrome can't load localhost" trap applies to the literal `localhost` name.
- **Desktop Commander shell quirks (for AI sessions):** the inline PowerShell
  wrapper mangles `$_`, nested quotes and sometimes `;` — for anything beyond a
  trivial command, WRITE A .ps1 FILE and run it with
  `powershell -ExecutionPolicy Bypass -File <path>`. Python REPL sessions can
  get stuck in `...` continuation on multi-line pastes — prefer one-off script
  files under `backend/tools/`.
- **DuckDB Python gotchas (both bit us in production):**
  1. `duck.register(df)` with `dtype=object` infers column types from a
     1000-row sample; a column of small ints gets INT32 and a later 10-digit
     UPC crashes with `Python Conversion Failure: Value out of range for type
     INT`. Fixed with `SET pandas_analyze_sample=10000000` — set in
     `model.py get_db/switch_db` AND on the sync writer cursor in
     `sync.py trigger sync` because **`conn.cursor()` is a separate session
     that does NOT inherit settings**.
  2. A stale `.wal` next to a restored `.db` can fail startup with
     `Failure while replaying WAL ... Conflict on tuple deletion` — delete the
     `.wal` and restart (the .db is consistent; the next sync re-fills).
- **Packaged exe layout:** `settings.json`, per-server warehouses
  (`retailtec_<host>.db`), `.jwt_secret` and `backups/` live in
  `packaging\out\RetailTecAnalytics\_internal\` (NOT next to the exe).
  `retailtec.log` is next to the exe. PyInstaller `--clean --noconfirm` WIPES
  the out dir — **always back up those state files before rebuilding**:
  `packaging\backup_state_temp.ps1` saves them to
  `C:\RetailTec Analytics\_appstate_backup`, `packaging\finish_deploy_temp.ps1`
  restores them and launches. If `packaging\out\RetailTecAnalytics` is locked
  ("cannot access the file... used by another process" — Explorer or an
  indexer holding the dir handle), build to `out2` with
  `packaging\build_out2_temp.ps1` and let `finish_deploy_temp.ps1` robocopy
  /MIR it over (file deletes inside a locked dir still work; only the
  top-level rmdir fails).

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

**July 6-7 2026 session (commits e474d77..42a690d):**
- **Ports rebranded:** packaged app :3001 → **:7382** (env `RETAILTEC_PORT`
  still overrides), Vite dev :3000 → **:7383**. CORS allowlist updated.
- **`build.ps1` fixed** — a blank line after `--noconsole` broke PowerShell
  line continuation; the PyInstaller step never ran as written.
- **Multi-subsidiary verified end-to-end** on 217.154.181.17: selector shows
  the 3 subsidiaries, per-subsidiary filtering numbers reconcile (all = sum of
  parts), on-open sync loads all domains.
- **INVENTORY_HISTORY is optional:** not every Prism install has
  `RPS.INVENTORY_HISTORY`; the sync now logs a warning and skips that step on
  ORA-00942 instead of failing (Ledger/History pages stay empty on such
  servers). The multi-sub server initially lacked it; the owner created it.
- **Item-level returns (42a690d, owner-requested calculation change):**
  returns = `ITEM_TYPE=2` lines, gross sales = `ITEM_TYPE=1` lines from
  `FACT_SALES_ITEMS` — document `RECEIPT_TYPE` is NOT enough because a sale
  receipt (type 0) can contain returned items (verified on 34.78.79.51: 1,017
  such docs, 1,146 returned units invisible to the old doc-level calc;
  item-level units reconcile EXACTLY with `SUM(DOCUMENT.RETURN_QTY)`).
  Implementation: 3 derived columns on `FACT_SALES_INVOICES`
  (`GROSS_WOTAX`, `RETURN_WOTAX`, `RETURN_UNITS`) populated by
  `sync._apply_item_returns` per window after each items load (+ one-time
  backfill migration in `model.py`), aggregated into `FACT_SALES_DAILY`.
  The RETURNS KPI count now shows returned UNITS (owner's choice); rates use
  the same item base on both sides. `_stream_insert` now inserts by explicit
  column list (first N table columns) so locally-derived columns don't break
  the count assert. Verification tools: `backend/tools/check_item_returns.py`,
  `verify_item_returns.py`, `verify_net_window.py` (run with backend STOPPED).
- **Known data caveat:** the insert-only warehouse retains documents later
  voided in Oracle — DuckDB vs live Oracle differs ~3.9% on a June-2026 window
  on the single-sub server (1,152 extra docs), for net sales AND returns alike.
  Pre-existing behavior, not from the returns change. Reconciliation policy TBD.

**July 7 2026 — second session (commits 3bae1a4..latest):**
- **Fresh clone + environment repairs:** start.bat rewritten (`%~dp0` relative,
  port 7383, `127.0.0.1` instead of `localhost`); git identity set repo-local.
- **Chart label overlap hardening:** all 9 "Avg" markLine labels
  (sales Overview/Performance/Products, inventory Overview) got a white chip
  (backgroundColor/padding/borderRadius) and both dept scatter charts got
  `labelLayout:{hideOverlap:true}`. (Owner later deprioritized the original
  overlap complaint; fix shipped anyway.)
- **Login page:** animated background (drifting gradient orbs + self-drawing
  gradient sales line, pure CSS/SVG, 5.5s cycle). NOTE: a prefers-reduced-motion
  guard was removed on purpose — Windows "Animation effects: Off" froze it.
- **Settings subtitle** reworded (old one only mentioned Oracle/data model).
- **Email:** SMTP host must be `smtp.gmail.com` (was mistyped `smtp.google.com`);
  Google Workspace needs an App Password. `backend/tools/test_smtp_login.py`
  verifies login without sending.
- **Packaging — all dependencies now bundled:** `cryptography` (fixes customer
  DPY-3016 in thin mode) and **Oracle Instant Client Basic 23.26** are inside
  the exe (`_internal\instantclient`; `main.py` tries `_MEIPASS\instantclient`
  first; source dir configurable via `RETAILTEC_IC_DIR` in build.ps1).
  **Customers no longer need Instant Client preinstalled.**
- **Inno Setup installed** (per-user: `%LOCALAPPDATA%\Programs\Inno Setup 6\ISCC.exe`
  — NOT Program Files x86). `installer.iss` now EXCLUDES runtime state
  (settings.json, .jwt_secret, retailtec_*.db, backups) so customer installers
  never ship credentials/data. Installer: `packaging\Output\RetailTecAnalytics-Setup.exe`
  (~178 MB). `.iss` has no line continuation — keep entries on one line.
- **Packaging scripts** (`backup_state_temp/finish_deploy_temp/build_out2_temp.ps1`)
  made path-independent (`$PSScriptRoot`). The out\ "handle lock" cause is usually
  just the packaged app RUNNING — `taskkill /F /IM RetailTecAnalytics.exe` first.
  CAUTION: finish_deploy robocopy /MIR deletes state newer than the last backup —
  re-run backup_state_temp.ps1 immediately before deploying.
- **Dimensions-only fresh load:** new `POST /api/sync/dimensions-load`
  (`sync.dimensions_load` → `_run_dimensions_load`) reloads ALL dims fresh
  (small dims delete+reload, items full-refresh rebuild, customers upserted over
  the warehouse's full fact range) without touching facts. UI: "Refresh
  Dimensions only" button next to "Load All Data now" in Settings.
- **Dev tools added:** `backend/tools/seed_demo_data.py` (synthetic sales data
  for UI work — writes to the dev warehouse, run with backend stopped).

---

## 6. OPEN ISSUES / things to verify (updated 7 Jul 2026)

1. **Word overlap in the UI (owner complaint, location NOT yet identified).**
   The owner reported "overlapping in words" somewhere in the app but the exact
   page was never pinned down. Ask him to point at the page/section (candidates:
   grid headers in narrow columns — see item 5 — or chart labels like the
   Top Associates marker line). Fix pending.
2. **`DIM_STORE.SUBSIDIARY_SID` population** is derived from sales facts via a
   startup migration; 3 of 25 stores were NULL on the single-sub warehouse
   (stores with no sales stay NULL). The clean fix is to pull the subsidiary
   column authoritatively from `RPS.STORE` in `_load_dimensions` (current query
   selects only SID, STORE_CODE, STORE_NAME). Verify the column name on
   `RPS.STORE` first via the test servers.
3. **Inventory Ledger** (`/api/inventory/ledger` + `/ledger/kpi`) does NOT apply
   the subsidiary filter (intricate multi-CTE SQL, skipped for safety). A
   subsidiary-scoped user with an empty stores claim would see all-subsidiary
   ledger data. Wire carefully with DB testing (multi-sub test server now has
   inventory history data: 1,312 rows).
4. **Warehouse vs Oracle drift** (voided/back-dated docs retained by the
   insert-only design) — ~3.9% on a sample window; decide a reconciliation
   policy (e.g. periodic re-scan with force_replace, or STATUS re-check job).
5. **Single-word grid headers** in very narrow columns may still wrap oddly;
   mitigated (word-break normal + smaller header font + tighter padding) but a
   per-column minWidth would be more robust.
6. **RESOLVED 8 Jul 2026 (`sse-starlette`):** uninstalled, and
   `backend/constraints.txt` (starlette==0.37.2, fastapi==0.111.0) is enforced
   machine-wide via the `PIP_CONSTRAINT` user environment variable — every
   `pip install` by any tool now refuses upgrades that would break these pins.
   On a NEW machine: `setx PIP_CONSTRAINT <repo>\backend\constraints.txt`.
7. **RESOLVED 7 Jul 2026:** Inno Setup installed (per-user path — see §5);
   one-click installer builds automatically via `build.ps1`.
8. **RESOLVED:** DIM_STORE emptied by sync bug (fixed + verified, 25 rows);
   subsidiary selector (verified with 3 subs); INVENTORY_HISTORY hard failure
   (now optional); DuckDB INT32 inference crash (pandas_analyze_sample);
   FACT_SALES_INVOICES column-count assert (named-column insert).

---

## 7. Roadmap remaining (from EXPERT_REVIEW_2026-07.md)

Items 1-4 (post-sync validation + reconciliation suite, forced password change +
audit log, Arabic/RTL) and the productization items (license mechanism, Settings
tabs + first-run wizard, About/diagnostics, whitelabel branding, packaging,
monthly backup) are DONE. Nice-to-haves left: authoritative store→subsidiary
from RPS.STORE, ledger subsidiary filter, and general QA against live data.

**INVENTORY_HISTORY semantics (critical — documented 9 Jul 2026):**
`RPS.INVENTORY_HISTORY` is NOT a Prism table — it's RetailTec's OWN change-capture,
installed per customer by `backend/tools/oracle/inventory_backup_trigger.sql`:
a one-time baseline snapshot of `INVN_SBS_ITEM_QTY` (all rows share the
install-date ACTION_DATE) plus trigger rows on every qty change carrying the
ABSOLUTE new QTY (`:NEW.QTY`, fired only when OLD<>NEW; inserts only when
QTY>0). Therefore stock-as-of-date D = LAST row per item×store ON OR BEFORE D
(order by ACTION_DATE DESC, HISTORY_SID DESC) — never SUM(QTY). Consequences
implemented: the first inventory load pulls the FULL table (windowed loads
would miss baselines); FACT_INVENTORY_HISTORY is EXEMPT from retention
pruning; Ledger opening AND ending both use the as-of pattern (ending falls
back to the live snapshot only when date_to is today). As-of dates before the
trigger install date are unknowable. The History page KPIs (summed QTYs) are
still semantically wrong — pending redesign.

Other docs in the repo: `HANDOFF.md` (technical TODO log), `DB_SYNC_REDESIGN.md`
(sync design), `EXPERT_REVIEW*.md` (assessments), `Krunch Queries feb 2024/`
(reference Prism SQL used to validate column semantics — the product's moat).
