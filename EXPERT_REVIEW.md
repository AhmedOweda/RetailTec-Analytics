# RetailTec Analytics — Expert Code Review

**Reviewed:** 1 July 2026 · **Version:** 2.0.0 (backend reports 3.0.0) · **Stack:** Electron + React/TypeScript + FastAPI + DuckDB, syncing from Oracle (Retail Pro Prism)

---

## Executive summary

This is a genuinely capable product. The v2 architecture — sync Oracle into a local DuckDB star schema once, then answer every query in <100ms offline — is the right design for the problem, and several details are done well (pbkdf2 password hashing, DECIMAL money columns, incremental watermarks, a hardened Electron shell). The app clearly works and looks polished.

However, **the security model is effectively absent at the layer that matters**, and the development workflow (~20 `patch_*.py` string-replacement scripts) has been quietly authoring fragile, injectable code. None of this is hard to fix, but the security items below should be treated as blockers before any networked or external deployment.

**Overall grade: C+ / functional but not production-hardened.** Strong architecture, weak security posture, messy engineering hygiene.

The three things to fix first:

1. **Every data endpoint is unauthenticated** — the JWT system guards nothing except user management.
2. **SQL injection** is systemic across all data routers via f-string interpolation.
3. **Hardcoded JWT secret + plaintext DB credentials + default admin password** in source/config.

---

## Critical (fix before any deployment)

### C1 — All data endpoints are unauthenticated
There is a complete JWT auth system in `backend/routers/auth.py` (login, `get_current_user`, `require_admin`), but a grep across `sales.py`, `inventory.py`, `purchases.py`, and `settings.py` finds **zero** `Depends(get_current_user)` guards. Every sales figure, customer name, inventory position, and the settings/sync endpoints are served to anyone who can reach port 8000 — no token required. The login screen is a facade; the API behind it is wide open.

This is amplified by:
- `main.py:45` — `CORSMiddleware(allow_origins=["*"])`, so any website can call the API from a user's browser.
- `vite.config.ts` binds `0.0.0.0` and the README mentions VPN/remote access — so this is exposed beyond localhost.

**Fix:** add a global `Depends(get_current_user)` (via router-level dependencies) to all data routers; restrict CORS to known origins; enforce the `stores` claim server-side so store-scoped users can't read other stores.

### C2 — SQL injection across all data routers
Queries are built with f-string interpolation of request parameters, e.g. `sales.py:155`:
```python
WHERE F.POST_DATE BETWEEN '{date_from}' AND '{date_to}' {sf}
```
`date_from`/`date_to` receive **no escaping or validation**; the `search` param (`sales.py:401`) relies only on naive quote-doubling (`.replace("'", "''")`), which is not a safe defense. DuckDB supports parameter binding (`?`) — and `auth.py`/`settings.py` already use it correctly, so the pattern exists in the codebase. Combined with C1, an unauthenticated caller can inject SQL.

**Fix:** convert all interpolated queries to parameterized `?` bindings; validate dates as `date` types at the Pydantic/Query layer; whitelist sort/column names.

### C3 — Hardcoded secrets and default credentials
- `auth.py:28` — `SECRET_KEY = "retailtec-jwt-secret-change-in-prod-2024"` is committed in source. Anyone with the repo can **forge a valid admin JWT**. Move to an env var / OS keystore; rotate on deploy.
- `auth.py:82` — default admin password `Retailtec@123` hardcoded; `auth.py:152` exposes `/api/auth/debug` listing all users. Remove the debug route; force admin password change on first login.
- `backend/settings.json` — Oracle production credentials stored **in plaintext** (host `34.78.79.51`, user `reportuser`, 6-char password). The file is correctly gitignored, but it sits unencrypted in the app-data dir. `cache_config.json:3` also hardcodes a DB host. Encrypt at rest (DPAPI on Windows) or use the OS credential store.

---

## High

### H1 — The `patch_*.py` workflow is the root cause of much of the above
~20 one-off scripts at repo root (`patch_perf_backend.py`, `patch_transactions.py`, `patch_settings_lock.py`, …) mutate source files via literal `str.replace()` against hardcoded absolute paths. They are non-idempotent (they `exit(1)` if the target block isn't matched verbatim), non-reversible, and are what authored the f-string-SQL endpoints (C2) and a fake client-side password gate. They are untracked in git (good), but they represent an editing method that has no source of truth and actively produces unsafe code. **Delete them and edit files directly under version control.**

### H2 — Client-side "password gate" is security theater
`patch_settings_lock.py` injected a Settings lock that checks `if (password === 'sysadmin')` in React — shipped in the bundle, trivially bypassed, and it guards the screen that edits the Oracle connection. Real enforcement must be server-side (see C1).

### H3 — Frontend bypasses its own auth-aware API client
`api/client.ts` defines a proper Axios instance that injects the Bearer token and handles 401→logout, but only 2 of ~26 files import it. **24 files use raw `axios`** with relative `/api` URLs — no token attached, no 401 handling. So even when C1 is fixed, most of the app won't send credentials. Also: the client hardcodes `baseURL: 'http://localhost:8000'`, which breaks remote access (a remote browser would hit its own machine). Route everything through one configured client.

### H4 — Live 500 errors in production (from `backend_err.log`)
- `sales.py:122` `customers_list` — `KeyError: 'FULL_NAME'` (6×); endpoint 500s every call.
- `inventory.py:562` `transfers_kpi` — `ValueError: could not convert string to float: 'MEDICATION'`; columns are being read positionally in the wrong order.
- `inventory.py:106` `inventory_overview` — `IndexError: list index out of range` on `rows[0]` with no empty guard.

### H5 — Logging crashes on every sync line
31× `UnicodeEncodeError: 'charmap' codec can't encode '→'` — the sync code logs a `→` character to a cp1252 Windows stream (`sync.py:561`, `:612`), so every sync/incremental log line raises and dumps a stack trace, burying real messages. Configure the handler for UTF-8 or drop non-ASCII from log strings.

### H6 — No client-side role enforcement or error boundaries
`ProtectedRoute.tsx:9` checks only `if (!user)` — no role guard. `/settings/users` is reachable by any authenticated user by typing the URL; it's merely hidden from the sidebar. There are also **no React error boundaries and no router `errorElement`**, so any render throw (several unguarded `JSON.parse`/chart accessors) white-screens the whole app.

---

## Medium

- **M1 — TypeScript `strict` undermined by ~273 `any` usages**, and React Query calls are almost never given generics, so the strong types in `types/index.ts` are unused past the dashboard.
- **M2 — Duplicated everything.** Two `vite.config` files (`.ts` wins, `.js` silently ignored but divergent), two context dirs (`context/` vs `contexts/`), two chart wrappers (`EChart.tsx` vs `echarts-for-react`), and an orphaned 336-line legacy `App.tsx` (still contains a hardcoded IP) that ships in the bundle. Number/percent formatters and an `ACCENT` color are re-declared in 7–10 files instead of shared.
- **M3 — React Query key collisions.** `['sync-status']` polled at 3000ms in `AppShell` and 2000ms in `DataModelSettings`; `['stores-list']` fetched with different `staleTime` in several places. No query-key factory.
- **M4 — God components.** `sales/Overview.tsx` (793 lines), `Products.tsx` (709), `Performance.tsx` (609), `UsersManagement.tsx` (512) each mix fetching, chart option-building, column defs, dialogs, and export logic.
- **M5 — Build reproducibility.** Root `package-lock.json` is gitignored while `frontend/package-lock.json` is tracked (inconsistent); caret ranges + bare `npm install`/`pip install` (no pins/hashes) mean drift. Backend built two ways (`build-backend.bat` inline flags vs an ignored `backend.spec`).
- **M6 — Unsigned installer.** `package.json` sets `sign: null`; users get SmartScreen/AV warnings. Acceptable internally, must be addressed for external release.
- **M7 — `xlsx@0.18.5`** is the npm line with known prototype-pollution/ReDoS advisories; the maintained build is now CDN-distributed. Audit/pin.

---

## Low

- No test suite anywhere (backend or frontend) — for financial reporting, at least sync/aggregation math deserves unit tests.
- `cleanup_stale_runs()` in `settings.py:58` always returns `0` (comment admits rowcount is hard) — dead return value.
- Copyright says "© 2025"; today is 2026.
- Two overlapping dev launchers (`start.bat`, `start-dev.bat`) with hardcoded `C:\RetailTec` paths.
- Dead dark-mode code (`mode` state with no setter) branches throughout charts.
- ~130MB stale installer + local `.db` files sit in the working tree (gitignored, but bloat).
- SSE hook has no heartbeat/timeout — a stalled stream leaves `loading` true forever.

---

## What's done well (keep it)

- **Architecture.** Oracle→DuckDB star-schema-once, query-locally is an excellent fit; sub-100ms local queries, offline capability, incremental watermarks (`SYNC_WATERMARK`), and a proper ETL run log (`SYNC_RUN`).
- **Password hashing** (`db/model.py:37`) — pbkdf2-hmac-sha256, 260k iterations, per-user 16-byte salt. This is correct and modern.
- **Data modeling** — DECIMAL(18,4) for money (not float), explicit PKs added to fact tables to avoid destructive deletes, a real DIM_DATE.
- **Electron hardening** (`electron/main.js:136`) — `contextIsolation: true`, `nodeIntegration: false`, `webSecurity: true`, minimal preload surface, external links denied and shelled out. This is better than most Electron apps.
- **Parameterized queries already used correctly** in `auth.py` and `settings.py` sync-history — the safe pattern is in-house; it just needs to be applied everywhere.

---

## Suggested remediation order

1. **Security sprint (blocker):** add auth dependency to all data routers (C1) → parameterize all SQL (C2) → move JWT secret to env, remove debug route, force admin password change, encrypt `settings.json` (C3) → lock down CORS.
2. **Stabilize:** fix the three 500s (H4) and the logging encoding crash (H5); route the frontend through the single API client (H3).
3. **Kill the patch workflow (H1):** delete `patch_*.py`, commit current source as the source of truth, add a minimal test harness for sync/aggregation math.
4. **De-duplicate:** remove `App.tsx`, `vite.config.js`, merge context dirs, pick one chart wrapper, add error boundaries + role guards (H6, M2).
5. **Polish:** typing, query-key factory, component splits, lockfile/signing hygiene.
