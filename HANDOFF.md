# RetailTec Analytics — Session Handoff / Continue Here

**Purpose:** Give this file to a new Claude / Cowork session (e.g. on another laptop) so it can continue the work with full context. Read this first, then the two design docs referenced below.

**Last updated:** 1 Jul 2026

---

## 1. What this project is

RetailTec Analytics — an offline BI dashboard for **Retail Pro Prism (RPS)** retail data. It syncs data **from an Oracle production DB into a local DuckDB star-schema warehouse**, then serves analytics with no live Oracle dependency at runtime.

**Stack:** Electron + React/TypeScript/Vite/MUI (frontend) · Python 3.11+ / FastAPI (backend) · DuckDB (local warehouse) · `python-oracledb` (Oracle source).

**Layout (repo root = `react-dashboard/`):**
- `backend/` — FastAPI app. Key files: `db/sync.py` (Oracle→DuckDB sync — the heart), `db/model.py` (DuckDB schema), `routers/` (sales, inventory, purchases, settings, auth), `services/scheduler.py` (+ `schedule.py`, `settings_schema.py`).
- `frontend/src/` — React app. Key file: `pages/settings/DataModelSettings.tsx` (admin panel).
- `backend/settings.json` — Oracle connection + data-model config (gitignored; holds the DB password).
- `backend/retailtec_*.db` — the DuckDB warehouse (gitignored; **re-syncable, don't copy between machines**).

**Design docs in this folder (READ THESE):**
- `DB_SYNC_REDESIGN.md` — the target-state warehouse + sync design (mutability model, ingestion, scheduling, retention). This is the roadmap.
- `EXPERT_REVIEW.md` — full code review incl. security findings.

---

## 2. Moving to another laptop

**Preferred: use git.** Repo remote is `github.com/AhmedOweda/RetailTec-Analytics`. Commit the current working changes, push, then clone on the new machine. (Note: many of the fixes below were made directly in the working tree and may be **uncommitted** — commit them first, or copy the folder.)

**If copying the folder instead**, copy `react-dashboard/` but EXCLUDE (regenerable/heavy):
- `frontend/node_modules/`, `node_modules/` (run `npm install`)
- `frontend/dist/`, `dist-electron/`, `backend/dist/`, `backend/build_temp/`, `backend/.rt_cache/`, `__pycache__/`
- `backend/*.db`, `backend/*.db.wal` — **the warehouse; rebuild via a fresh sync (recommended)**
- the stray `backend/retailtec_34_78_79_51.backup_*` files and root `patch_*.py` scripts, `*.log`

**Setup on the new laptop:**
1. `cd react-dashboard/frontend && npm install`  ·  `cd .. && npm install` (root, for Electron)
2. `cd backend && pip install -r requirements.txt` (includes `tzdata` for timezone scheduling)
3. Ensure Oracle reachability + Instant Client if using thick mode (thin mode works without it).
4. Start dev: run `start-dev.bat` (uvicorn on :8000 + Vite on :3000). Or `react-dashboard/start.bat`.
5. In the app → **Settings**, enter the Oracle connection (host/port/service/user/password), Test Connection, then run a **short** load (last 7–14 days) to confirm, then a full load.

A fresh DB is created automatically on first run — start there rather than copying the old `.db`.

---

## 3. Current status

**Working:** The Oracle→DuckDB sync runs end-to-end. A short range load successfully loaded invoices, sale items, transfers, purchases, inventory history, customers, and rebuilt the daily aggregate — with per-dimension progress labels, a load-kind badge, live ETA, coverage view, and sync history in the UI.

**The big win this session:** rewrote the ingestion so a full/2-year load goes from ~24 h to ~tens of minutes (details below).

**Pending (see §6).**

---

## 4. What changed this session (changelog + rationale)

All in `backend/db/sync.py` unless noted.

1. **Ingestion rewrite — one streaming scan per table, not weekly chunks.** Oracle's date columns are **not indexed**, so every date-filtered query full-scans the table. The old code chunked by week → ~312 full scans for a multi-year load (the 24 h). Now each fact table is scanned **once** over the whole range and streamed in 50k batches (`_stream_insert`), bounded memory.
2. **Insert-only for immutable facts.** Closed Retail Pro Prism documents (`STATUS=4`) never change (only notes), so transaction facts are `INSERT OR IGNORE` (append), never rewritten. This removed the original "Failed to delete all rows from index" fatal.
3. **Daily aggregate derived locally** (`_derive_daily`) from the invoices already in DuckDB via `CREATE OR REPLACE TABLE` (no PK, no `DELETE`) — kills a 3rd Oracle scan AND avoids the index-delete fault.
4. **Non-destructive by default.** "Load All Data" / range load now **append** (don't delete existing data). Destructive range-clear is opt-in `rebuild=True` only (`_trim_range`).
5. **Inventory snapshot rebuild** (`_sync_inventory_snapshot`) uses `DROP TABLE` + recreate (no PK) instead of `DELETE` — the last corrupt-index spot.
6. **Responsive cancel** — `_check_cancel()` runs every batch, so Stop responds in seconds.
7. **New capabilities:** `range_load` + `POST /api/sync/range` (custom From→To, append); `GET /api/sync/coverage` (loaded date span per domain); `apply_retention` + `POST /api/maintenance/retention` (prune line-item detail > N months, default 24); per-domain **Power BI-style scheduling** wired into `scheduler.background_loop` via `services/schedule.py` + `services/settings_schema.py` (legacy settings migrated on the fly). `incremental()` now takes `tables=`.
8. **Sync state exposes** `kind` (full/range/scheduled/incremental) + `started_at` (for ETA); per-dimension progress labels in `_load_dimensions`/`_load_large_dims`.
9. **Frontend (`DataModelSettings.tsx`):** password now persists (kept masked, not blanked); From→To range loader; "Loaded Data" coverage panel; load-kind badge + live ETA; "Sync History" panel with Refresh; progress shows % (was mislabeled "weeks").

---

## 5. Key decisions (don't re-litigate)

- **Watermark = `INVC_POST_DATE`, NOT `MODIFIED_DATETIME`.** Closed docs are immutable except notes; a note edit bumps `MODIFIED_DATETIME` and would needlessly re-pull years-old rows. Filter/watermark on the posting date + a small overlap lookback + insert-only anti-join. (Other domains: `RPS.VOUCHER`/`RPS.SLIP`/`RPS.ADJUSTMENT` use `CREATED_DATETIME`; inventory history uses `ACTION_DATE`.)
- **DuckDB doesn't need secondary/PK ART indexes for analytics** (it prunes via columnar zonemaps). The recurring "Failed to delete all rows from index" fatals came from `DELETE`/`REPLACE` on those indexes. Rebuild-style ops (`CREATE OR REPLACE`, `DROP`+recreate, insert-only) avoid them. `FACT_SALES_DAILY` and `FACT_INVENTORY` are now intentionally **PK-less**.
- **Load once, then incremental.** Immutable facts are appended; only newly-posted docs are pulled.

---

## 6. Remaining TODO (prioritized)

**Update 2 Jul 2026 — items 1–4 below are DONE** (commits b6ac37d…52f2dce on the new laptop):

1. ~~Oracle date index~~ **RESOLVED WITHOUT DBA**: RPS already has function-based indexes (`IDX_DOCUMENT7 = CAST(INVC_POST_DATE AS DATE)`, `SYS_EXTRACT_UTC(CREATED_DATETIME)` on VOUCHER/SLIP/ADJUSTMENT, `SYS_EXTRACT_UTC(ACTION_DATE)` on INVENTORY_HISTORY). Sync predicates now match those expressions; adaptive hints use the index for windows ≤ 21 days and one FULL scan for backfills.
2. ~~Settings UI~~ **DONE**: per-domain schedules + retention editor in `DataModelSettings.tsx`; `GET/PUT /api/settings` speak the v2 shape with strict validation (`test_settings_roundtrip.py`, 18/18).
3. ~~Security sprint~~ **DONE**: all data routers require JWT (+ server-side store scoping via `routers/common.py:scoped_stores`); all SQL parameterized/typed; JWT secret from env or generated `.jwt_secret`; Oracle password DPAPI-encrypted at rest (`services/config.py`); CORS locked to localhost:3000/3001; debug route removed; change-password endpoint + `must_change_password` flag.
4. ~~Bulk insert~~ **DONE**: staged DataFrame + `INSERT..SELECT` anti-join (the old per-row `executemany` ran at ~55 rows/s through the ART index). Full 2020→2026 backfill (~15.5M fact rows, 2.06 GB warehouse) completes in ~30 min; API sweep `test_endpoints.py` 79/79.

**Still open:**
- Push local commits to GitHub (needs auth on this laptop).
- Frontend cleanup (EXPERT_REVIEW M2): orphaned `src/App.tsx` (~25 pre-existing tsc errors), duplicate context dirs, chart wrapper unification.
- Drop the unused ~30 `CREATE INDEX` statements in `model.py`; periodic compaction + CHECKPOINT step after large backfills.
- Change the default admin password; consider forcing the change server-side.

**New gotchas learned (2 Jul):** never row-DELETE through an ART PK (dim loads now rebuild via clone/insert/DROP/RENAME — the 'Failed to delete all rows from index' FATAL struck again and is now structurally impossible); never use `duckdb.executemany` for bulk; `DOCUMENT_ITEM.ITEM_TYPE` is numeric in RP9 (sync maps 1→'Sale', 2→'Return'); Vite proxy targets must use `127.0.0.1`, not `localhost` (Node resolves ::1, uvicorn is IPv4-only); `vite.config.js` shadowed `vite.config.ts` (deleted).

---

## 7. Known gotchas

- **Oracle scale (verified, read-only):** DOCUMENT ~2.42M (≈all STATUS=4), DOCUMENT_ITEM ~5.0M, VOU_ITEM ~4.57M, SLIP_ITEM ~4.29M, INVENTORY_HISTORY ~3.07M — ~19M fact rows over full history. A full historical load is real work; test with a short window first.
- **Corrupt DuckDB indexes** can be inherited if you copy an old `.db` from a crashed state — another reason to start fresh on the new machine.
- **File-write quirk on the original laptop:** the `C:\RetailTec` folder duplicated the tail of *incremental* file edits in a way not visible to some tools, corrupting `.py` files mid-session (had to repair via full-overwrite / Desktop Commander). May be machine-specific (antivirus/sync touching the folder). On the new laptop, prefer full-file writes and verify line counts after edits if anything looks off.
- After a `FATAL ... database has been invalidated` error, the backend **process must be fully restarted** (not just `--reload`) — the DuckDB instance is dead until then.

---

## 8. How to greet the new session

Paste something like: *"Continue work on the RetailTec Analytics project. Read HANDOFF.md, DB_SYNC_REDESIGN.md, and EXPERT_REVIEW.md in the project folder first, then help me with [your next task]."*
