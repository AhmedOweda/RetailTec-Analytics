# RetailTec Analytics — Chief-Architect Review (13 Jul 2026)

Fresh-eyes review of the full codebase: backend core (db/, services/, entry points), API layer (routers/), frontend (React/TS), and packaging/delivery/licensing. Four deep passes, all files read.

## Overall verdict — RESTRUCTURE INCREMENTALLY. Do NOT rebuild.

The hard, product-defining work is excellent and irreplaceable: the Prism column semantics, the streaming insert-only load model, the star-schema query layer, the RTL/Arabic pipeline, the offline licensing design, and the operational war stories encoded as comments. A rebuild would burn that moat to fix plumbing. The defects are localized and mechanical; roughly one week of quick wins removes most of the critical exposure, and 2–4 focused weeks of structural work makes the codebase durable.

---

## Priority 0 — fixed during this review (commit `stock by date…`+)

| # | Finding | Status |
|---|---|---|
| 0.1 | `get_db()` re-read settings.json on EVERY call; truncated read mid-write silently switched to the empty `local` warehouse → **the "no items/products until restart + dims refresh" bug** | **FIXED** — host cached in memory, changes only via `switch_db()`; `get_db`/`switch_db` fully guarded by DB_LOCK (now RLock); retry-on-unreadable settings |
| 0.2 | `settings.json` written non-atomically by 3 uncoordinated writers (settings router, sync completion, report scheduler) → lost updates, truncated reads | **FIXED** — `_SETTINGS_LOCK` + tempfile + `os.replace` in services/config.py; new `update_settings_fields()`; sync.py routed through it |
| 0.3 | Small dims loaded DELETE-then-INSERT with autocommit → failed dims load left DIM_STORE/DCS/VENDOR/… EMPTY until the next successful refresh | **FIXED** — `_replace_small_dim()` wraps each in a transaction |
| 0.4 | Sync thread created cursors on the shared connection without DB_LOCK | **FIXED** — all three call sites locked |
| 0.5 | Dim cache retry only fired for empty stores, not empty subsidiaries | **FIXED** |

## Priority 1 — do next (quick wins, ≤1 day each)

**Security**
- **SPA catch-all path traversal** (`main.py` ~140): unauthenticated route serves `_WEBAPP / full_path` without containment check — can plausibly serve `../settings.json`, `../.jwt_secret` (forge admin JWTs), even the warehouse. 3-line fix: `resolve()` + `is_relative_to`.
- **`GET /api/settings` leaks decrypted SMTP password** to any logged-in viewer (only connection.password is masked). Mask/strip the email block; consider admin-only.
- **Login has no lockout** and the well-known seed password no longer forces a change. Add a simple sliding-window lockout (5 fails → 30 s).
- **Range-load dates are interpolated into Oracle SQL as raw strings** (`RangeLoadReq.date_from: str`). Type them `date`; whitelist `domains`.
- **Vendor private signing key sits in `packaging\Output\`** next to the customer installer. Move it off-machine (already flagged); regenerate the keypair.

**Correctness / operability**
- **Version chaos**: installer says 2.0.0, API says 3.0.0, exe has no VERSIONINFO, every installer overwrites `RetailTecAnalytics-Setup.exe`. One `VERSION` source → installer + API + exe + filename (+ git SHA in diagnostics).
- **Log rotation**: `retailtec.log` grows forever; use RotatingFileHandler (5×10 MB), UTF-8.
- **Retention uses the plain row-DELETE path** that the codebase itself documents as the ART-index FATAL trigger — route `apply_retention` through `_trim_table`. Also `retain_detail_months` per-domain setting is never applied by anything — wire it or remove it.
- **Tray Quit doesn't cancel a running sync** (Restart does) — process lingers holding the warehouse.
- Delete dead code: `launcher.py` (stale second entry point on :8000), `_week_chunks`, `_sql_daily`, `cleanup_stale_runs`, stale `/api/auth/debug` docstring, `check_invn_vendor.py` at backend root, the orphaned v1 dashboard in the frontend (`App.tsx` + Header/Sidebar/KpiGrid/TransactionsGrid/charts/* + useStreamingDashboard + useAnalytics + types/index.ts — nothing imports them).
- `SYNC_RUN_STATS` is written by nothing (UI per-table stats permanently empty) — populate from `_stream_insert` totals or drop. Unify run-status vocabulary ('error' vs 'failed' vs 'aborted').
- Rename `services/schedule.py` vs `scheduler.py` (genuine foot-gun).
- Make `/api/sync/trigger` a POST; collapse the three store-list endpoints into one.

**Frontend quick wins**
- **Route-level `lazy()`** + Suspense, dynamic-import xlsx/jspdf, tree-shake ECharts via `echarts/core`, `manualChunks` — the single 4.65 MB JS chunk becomes <1 MB initial. Biggest perceived-performance win available.
- Codemod raw `axios` imports (26 files) → the configured `api` client; delete the global-axios monkey-patch safety net.
- Add `enableRtl` to AG-Grid when Arabic (grids are currently LTR inside the RTL app); add the two missing `nav./inventory/*` Arabic keys.

## Priority 2 — structural (plan deliberately, 2–4 weeks total, incremental)

**Backend**
1. **Watermark-driven incremental sync** (highest correctness value remaining): every incremental pulls a fixed 7-day window regardless of how long the PC was off — a two-week holiday silently loses a week of data forever (insert-only never self-heals), and `_update_watermarks` then overwrites coverage bookkeeping with the small window. Compute window = `max(lookback, today − loaded_to + overlap)`; never shrink `loaded_from`; banner when catching up.
2. **App state out of the warehouse**: `DIM_USERS`, `USER_PREFS`, `AUDIT_LOG`, grace markers live in `retailtec_<host>.db` — switching hosts switches user accounts; restore rolls back passwords and audit history. Split into a small `app.db` opened independently.
3. **Split `sync.py` (1,315 lines) into four modules**: `oracle_sql.py` (pure SQL builders — instantly unit-testable), `oracle_source.py`, `warehouse_load.py`, `sync_runner.py`. Inject connections for testability.
4. **One sync entry point** (`scheduler.request_sync`) — today API, tray, loop, and on-open each wire the run slightly differently (tray bypasses the asyncio lock); plus an event registry so `db/` stops lazy-importing `routers/`.
5. **Per-domain failure bookkeeping**: a multi-domain sync that fails halfway advances nothing even for the domains that loaded.
6. **Memory**: `_sync_inventory_snapshot` and `_bulk_upsert_dim` fetchall() the whole snapshot/item master; batch through fetchmany like facts. Benchmark dropping most of the ~30 ART indexes on fact tables (size + insert speed + the recurring ART FATAL).

**API layer**
7. **The keystone router refactor — `FilterSet` accumulator**: ~60+ endpoints hand-assemble `sf/sp + subf/subp + …` fragments and param lists in placeholder order; the code is covered in nervous "params must follow CTE order" comments; one reorder silently mis-binds params (wrong numbers, no crash). A ~40-line accumulator in common.py binds fragment+params together and becomes the place subsidiary scoping is enforced uniformly.
8. **Close the two real authz gaps**: Inventory Ledger + ledger/kpi ignore subsidiary scoping entirely (HANDOVER §6 item — a subsidiary-restricted user with unrestricted stores sees all subsidiaries' ledger); sales lifetime/LTV CTEs aggregate across subsidiaries for scoped users.
9. **A real pytest suite** for the security core: `scoped_stores`/`scoped_subsidiaries` intersection, JWT paths, license `evaluate`, ledger math on a tiny seeded DuckDB. Current test files are live-server smoke scripts (assert HTTP 200 only) — rename `smoke_*` and add actual tests.
10. Consolidate the 3 copies of `q/qdf`; migrate KPI endpoints from positional `r[0]…r[10]` to dict access.

**Frontend**
11. **The trio: `<PageHeader>` + `<DataGrid>` + `usePeriodRange()`** — the sticky filter bar is copy-pasted byte-identical in 12 pages, the AG-Grid 7-handler block in 20 grids, date presets ~10 times with two different date implementations (one UTC-buggy: "Today" is wrong before 3 a.m. Gulf time). ~1,500–2,000 duplicated lines collapse; build error/empty states INTO these components — today a failed query renders zeros and "No data to display", indistinguishable from genuinely zero sales (worst failure mode for a BI tool; `isError` is used on exactly one page).
12. **Subsidiary into query keys** (a subsidiary switch can flash the previous subsidiary's numbers via `placeholderData`), then remove the blunt `gcTime:0 / refetchOnMount:'always'` and restore real caching.
13. **One page catalog** as the single source for routes + nav + permissions + lazy imports (currently 4 parallel lists that have already drifted).
14. Typed API responses (`api/types.ts`) + freeze backend column casing (kills the `r.alu ?? r.ALU` guessing); `useTr()` reactive i18n hook (chart options memoized without a language dep show stale language after switching).

**Packaging / state (the keystone of this layer)**
15. **Move runtime state out of the install tree**: warehouses/backups/log → `%PROGRAMDATA%\RetailTec\Analytics`, DPAPI-scoped secrets → `%LOCALAPPDATA%`, `{app}` becomes read-only code. This single change eliminates the robocopy /MIR data-loss trap, the installer Excludes list, the DLL-planting surface of users-modify under Program Files, and the multi-user DPAPI bug — with a one-time idempotent migration on first run.
16. **Build in a venv from requirements+constraints** — the current build freezes the dev machine's global site-packages (the shipped `_internal` contains IPython, matplotlib, pyarrow, tornado, a MySQL connector… on Python 3.14, not the pinned 3.12). Fixes reproducibility and ~100 MB of installer weight at once.
17. Fold `rebuild_all.ps1` (currently outside the repo) + the five `*_temp.ps1` scripts into one versioned `packaging/release.ps1`. Code-sign exe + installer when a cert is available (SmartScreen).
18. **Licensing posture decision** (product call, not an emergency): today nothing blocks a pirate who copies a working install folder — licensing is watermark-only by design except sync-grace and user creation. If it needs teeth: gate the sync path on a valid license and consider per-device warehouse encryption; at minimum keep the private key off the build machine. Don't ship `license_studio.py`/`make_license.py` inside customer builds (verify PyInstaller graph).

## Suggested sequence

Week 1: Priority 1 list (security items first).
Week 2: backend #1 (watermarks) + #2 (app.db) — the two remaining data-integrity items.
Week 3: API #7+#8 (FilterSet + scoping gaps) and frontend #11+#12 (shared components + query keys).
Week 4: packaging #15+#16 (state relocation + venv builds) around the next planned release, since it changes the installer.
Ongoing: #9 tests as each area is touched; the rest opportunistically.

*Full per-file findings with line references are preserved in the four review passes (backend core, API, frontend, packaging) — ask Claude to re-print any section in detail.*
