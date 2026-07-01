# RetailTec Analytics — Data Warehouse & Sync Redesign

**Status:** Design proposal (Phase 2) · **Date:** 1 Jul 2026
**Applies to:** `backend/db/model.py`, `backend/db/sync.py`, `backend/routers/settings.py`, `backend/services/scheduler.py`, and the Settings UI.

This document is the target-state design for the DuckDB warehouse and the Oracle→DuckDB sync. It builds on the Phase-1 fix (insert-only for immutable transactions) and adds four flexibility capabilities you approved: flexible load targets, explicit sync modes, per-domain scheduling, and scale/retention controls.

---

## 1. Principles

1. **DuckDB is the right engine.** Columnar, single-file, handles tens of millions of rows on a laptop. We are not changing the engine — we are changing *how data is written and controlled*.
2. **Model each table by mutability, not by convenience.** The load strategy follows from whether a table's rows can ever change. This is the organizing idea for the whole redesign.
3. **Immutable data is insert-only.** Closed Retail Pro Prism documents (`STATUS=4`) never change their financials, so their fact rows are appended once and never rewritten. Replace is an opt-in repair action, never the default.
4. **Bulk, set-based writes.** Fetch Oracle data as columnar batches and load with `INSERT … SELECT` + anti-join, not row-by-row `executemany`. This is faster and structurally cannot trigger the ART-index delete fault.
5. **Sensible defaults, advanced knobs hidden.** More options must not make the common path harder. One-click "sync now" stays; power controls live behind an *Advanced* section.

---

## 2. Table mutability classification (the core model)

| Class | Tables | Can rows change? | Load strategy |
|---|---|---|---|
| **Immutable transaction facts** | `FACT_SALES_INVOICES`, `FACT_SALES_ITEMS`, `FACT_TRANSFERS`, `FACT_ADJUSTMENTS`, `FACT_PURCHASES`, `FACT_PURCHASE_ITEMS` | No — closed docs are frozen | **Insert-only** (append new keys) |
| **Immutable event log** | `FACT_INVENTORY_HISTORY` | No — append-only movement log | **Insert-only** |
| **Recomputed aggregate** | `FACT_SALES_DAILY` | Yes — day totals grow during the day | **Replace the day's rows** |
| **Current-state snapshot** | `FACT_INVENTORY` (on-hand) | Yes — quantities move constantly | **Full replace** (truncate + reload) |
| **Mutable dimensions** | `DIM_ITEM`, `DIM_CUSTOMER`, `DIM_STORE`, `DIM_VENDOR`, `DIM_EMPLOYEE`, `DIM_DCS`, `DIM_SUBSIDIARY` | Yes — names/attributes edited, new rows added | **Upsert / full refresh** (small tables) |
| **Static dimension** | `DIM_DATE` | No — generated calendar | Built once |
| **Control** | `SYNC_RUN`, `SYNC_RUN_STATS`, `SYNC_WATERMARK`, `DIM_USERS` | — | App-managed |

**Why this matters:** the old code applied "replace" (the snapshot strategy) to the immutable transaction facts. That is what caused the `Failed to delete all rows from index` fault *and* made every incremental sync rewrite frozen rows. Classifying correctly fixes both.

---

## 3. Load strategy per class (target)

**Immutable facts — insert-only via anti-join.** For each domain, load only rows whose key is not already present:

```sql
INSERT INTO FACT_SALES_INVOICES
SELECT s.*
FROM   oracle_batch s
WHERE  NOT EXISTS (SELECT 1 FROM FACT_SALES_INVOICES f WHERE f.DOC_SID = s.DOC_SID);
```

This never touches the delete-from-index path, is idempotent (safe to re-run any window), and only writes genuinely new closed documents.

**Incremental watermark — use `INVC_POST_DATE`, NOT `MODIFIED_DATETIME` (decided).** Only `STATUS=4` documents enter analytics. Retail Pro Prism freezes a closed document's financials — **only the notes can be edited**. A note edit bumps `MODIFIED_DATETIME`, so watermarking on `MODIFIED_DATETIME > last_sync` would **re-pull years-old documents every time a note changes** — wasteful fetches for data that never changed and notes we don't store. So we watermark on the business date `INVC_POST_DATE` plus a small overlap lookback, and anti-join on the key:

```sql
-- incremental, immutable facts
WHERE H.STATUS = 4
  AND H.INVC_POST_DATE >= :watermark - :overlap_days   -- new posts + short lookback
-- then: INSERT … SELECT … WHERE NOT EXISTS (key)   -- skip everything already loaded
```

A note edit does not change `INVC_POST_DATE`, so old documents are never re-pulled. The overlap lookback (configurable, ~14 days) catches "posted a day or two late"; rare month-old back-dated posts are swept up by an occasional wider reconcile, which is cheap because the anti-join drops all already-loaded rows.

**Confirmed watermark columns (per domain):**

| Domain | Oracle table | Incremental filter column | Notes |
|---|---|---|---|
| Sales (invoices/items/daily) | `RPS.DOCUMENT` | **`INVC_POST_DATE`** | posting date |
| Purchases | `RPS.VOUCHER` | **`CREATED_DATETIME`** | no posting timestamp |
| Transfers | `RPS.SLIP` | **`CREATED_DATETIME`** | no posting timestamp |
| Adjustments | `RPS.ADJUSTMENT` | **`CREATED_DATETIME`** | no posting timestamp |
| Inventory history | `RPS.INVENTORY_HISTORY` | `ACTION_DATE` | already used |

*Caveat:* these are posting/creation **dates**, not system-write timestamps. If a document can be posted with a back-dated `INVC_POST_DATE`, a strict high-watermark may skip it. Safeguard: on each incremental, re-scan a small overlap window (configurable lookback, default a few days) and rely on the insert-only anti-join to drop already-loaded rows — robust and cheap, never rewrites frozen rows.

**Recomputed aggregate (`FACT_SALES_DAILY`).** Replace the affected days only: `DELETE … WHERE POST_DATE BETWEEN df AND dt` then insert. Tiny table (one row per store/day), so cost is negligible.

**Snapshot (`FACT_INVENTORY`).** Keep the current full `DELETE` + reload — correct for current-state data.

**Dimensions.** Full-refresh the small ones each sync (they are thousands of rows, not millions). This also fixes the completeness bug (§6).

---

## 4. Ingestion engine: staged bulk load (replaces row-by-row `executemany`)

**Today:** `cur.fetchall()` pulls a whole chunk into Python memory, then `duck.executemany("INSERT OR REPLACE …", rows)` inserts one row at a time through the ART index. Slow, memory-heavy, and the source of the fault.

**Target:** stream Oracle results as Arrow/DataFrame batches and hand them to DuckDB as a set:

```python
# oracledb → Arrow batches (columnar, streaming)
cur = ora.cursor()
cur.arraysize = 50_000
for df_batch in cur.fetch_df_batches():        # pandas/pyarrow, chunked
    duck.register("stage", df_batch)           # zero-copy view
    duck.execute("""
        INSERT INTO FACT_SALES_ITEMS
        SELECT st.* FROM stage st
        WHERE NOT EXISTS (
            SELECT 1 FROM FACT_SALES_ITEMS f WHERE f.DOC_ITEM_SID = st.DOC_ITEM_SID)
    """)
    duck.unregister("stage")
```

Benefits: 10–50× faster loads, bounded memory (batched), set-based dedup, and no per-row index churn. `oracledb` supports `fetch_df_batches`/Arrow natively; no extra dependency beyond `pandas`/`pyarrow` (pandas is already required).

**Insert in date order** (oldest→newest, which the week-chunk loop already does) so DuckDB's columnar min/max zonemaps stay tight and prune date-range scans automatically.

---

## 5. Indexing, clustering & DuckDB realities

- **Drop the ~30 secondary `CREATE INDEX` statements.** DuckDB does not use secondary B-tree/ART indexes for analytical scans — it prunes via automatic columnar zonemaps. Those indexes add write cost and memory during sync for little read benefit, and the ART primary-key indexes are what threw the fault.
- **Keep primary keys only where dedup requires them** — or drop PKs entirely and dedup via the anti-join in §3/§4 (the anti-join does not require an index; DuckDB hash-joins efficiently). Recommendation: keep PKs as documentation/constraint, but rely on anti-join for correctness so a missing/rebuilt index never blocks a load.
- **Clustering:** ensure facts land date-ordered; optionally run a periodic compaction (`CREATE TABLE … AS SELECT … ORDER BY <date>`) after large backfills to tighten zonemaps.
- **Checkpoint discipline:** `CHECKPOINT` at the end of a sync to fold the WAL; avoids the stray-`.wal` situation that accompanied the crash.

---

## 6. Dimension completeness fix

Today `DIM_ITEM`/`DIM_CUSTOMER` load only rows *created or modified* in the sync window (`sync.py` `_load_large_dims`). A sale that references an older, unchanged item leaves that item missing → the join yields a NULL description ("unknown item") in product analytics.

**Fix:** full-refresh `DIM_ITEM` (≈3.5k rows — trivial) each sync, or back-fill any `ITEM_SID`/`BT_CUID` referenced by loaded facts but absent from the dimension. Full refresh is simplest and safe at these sizes.

---

## 7. Flexibility features

### 7.1 Flexible load targets
- **Custom date range** (`from`/`to`) for any load, replacing "last N days" as the only option. Enables historical backfill (e.g., load 2023 for year-over-year).
- **Per-domain ranges** — each domain can have its own window (sales back 3 years, inventory history 90 days). Reduces DB size and sync time.
- UI: a date-range picker + optional per-domain override; "last N days" remains the default preset.

### 7.2 Explicit sync modes
Three named modes replace hidden flags (`force_replace`, `skip_existing`):

| Mode | Behaviour | Use |
|---|---|---|
| **Append** (default) | Insert-only; adds new closed docs; refreshes daily aggregate + snapshot | Normal scheduled/manual sync |
| **Repair / Overwrite** | `force_replace=True` scoped to a domain + date range; rewrites existing rows | Fix a bad/partial period |
| **Rebuild domain** | Drop the domain's fact rows (or table) and full-reload the range | After schema change or corruption |

Scoped to **domain + date range** so a repair never rewrites the whole warehouse.

### 7.3 Per-domain scheduling — Power BI-style
Model it on Power BI scheduled refresh (decided): each domain has a schedule defined by
- **Times of day** — one or more specific clock times (e.g., 06:00, 12:00, 18:00).
- **Days of week** — which days the schedule runs (e.g., Mon–Sat).
- **Timezone** — explicit, so times mean what the user expects.
- Plus a simpler **interval** option (`every N min`) for high-frequency domains like inventory, and `manual` (no schedule).

So inventory can refresh every 15 min while purchases post nightly at 02:00 Mon–Fri. Also:
- Per-domain **Sync now** button and **last-synced / watermark** display (already in `SYNC_WATERMARK` + `/api/sync/table-stats`).
- Global **background sync on/off** and optional **quiet hours**.

The scheduler evaluates each domain's schedule against the current time and fires the ones that are due, respecting the single-writer lock (one sync at a time).

### 7.4 Scale controls & retention
- **Detail retention (configurable horizon):** keep `FACT_SALES_DAILY` (and other aggregates) indefinitely, but prune line-item detail (`FACT_SALES_ITEMS`, history) older than a **configurable** horizon. Default **24 months**, adjustable up (or set to *unlimited* to keep everything) per deployment / per domain. Caps the largest tables without losing summary history.
  ```sql
  DELETE FROM FACT_SALES_ITEMS WHERE INVC_POST_DATE < (CURRENT_DATE - INTERVAL 24 MONTH);
  ```
- **Detail toggle:** deployments that only need store/day analytics can turn *off* line-item ingestion entirely — dramatic size/speed win.
- **Optional rollups (later):** monthly / DCS / vendor aggregate tables for fast multi-year queries. Not required initially given DuckDB's scan speed.
- Run retention as a step at the end of a sync (or a separate scheduled maintenance task) followed by `CHECKPOINT`.

---

## 8. Proposed settings schema

The current flat `data_model` block expands to per-domain config (defaults keep today's behaviour):

```jsonc
{
  "connection": { "...": "unchanged" },
  "data_model": {
    "background_enabled": true,
    "timezone": "Asia/Amman",               // default tz for all schedules
    "quiet_hours": null,                     // optional {"from":"08:00","to":"18:00"}
    "domains": {
      "sales": {
        "enabled": true,
        "load_days": 1095,                   // rolling window for scheduled syncs
        "detail": true,                      // load line-item detail?
        "retain_detail_months": 24,          // null = keep everything
        "schedule": {                        // Power BI-style
          "mode": "times",                   // "times" | "interval" | "manual"
          "times": ["06:00", "12:00", "18:00"],
          "days":  ["Mon","Tue","Wed","Thu","Fri","Sat"],
          "timezone": null                   // null = inherit data_model.timezone
        }
      },
      "inventory": {
        "enabled": true, "load_days": 90,
        "schedule": { "mode": "interval", "every_minutes": 15 }
      },
      "purchases": {
        "enabled": true, "load_days": 365,
        "schedule": { "mode": "times", "times": ["02:00"], "days": ["Mon","Tue","Wed","Thu","Fri"] }
      },
      "transfers":   { "enabled": true, "load_days": 365, "schedule": { "mode": "times", "times": ["02:00"] } },
      "adjustments": { "enabled": true, "load_days": 365, "schedule": { "mode": "manual" } }
    }
  }
}
```

`load_days` is the rolling window for scheduled runs; the UI can also trigger a one-off load with an explicit `{from,to}` range (§7.1) and a mode (§7.2). A backward-compatible loader upgrades the current flat `data_model` (initial/incremental/background_minutes) into this shape on first read, so existing installs keep working.

---

## 9. Migration & rollout

1. **Phase 1 (done):** insert-only for immutable facts + `force_replace` flag; backup taken. Error path removed.
2. **Ingestion swap:** replace `executemany` upserts with Arrow-batch `INSERT … SELECT` anti-join. No schema change; can ship independently and is the biggest performance win.
3. **Index cleanup:** drop secondary indexes; verify query timings (should be unchanged or better).
4. **Settings + scheduler:** expand `settings.json` shape (backward-compatible loader), add per-domain scheduling to `scheduler.py`, add modes + ranges to `settings.py` endpoints and the Settings UI.
5. **Retention:** add the prune step + detail toggle.
6. Each step is independently shippable and reversible; the Phase-1 backup remains the safety net.

---

## 10. Code touch-points

| File | Change |
|---|---|
| `db/sync.py` | Arrow-batch staged loader; anti-join inserts; per-domain range params; retention step; checkpoint |
| `db/model.py` | Drop secondary indexes; keep/relax PKs; dimension full-refresh helper |
| `routers/settings.py` | New settings shape; endpoints for modes (append/repair/rebuild) + custom ranges + per-domain sync |
| `services/scheduler.py` | Per-domain cadence, quiet hours, global on/off |
| `pages/settings/DataModelSettings.tsx` | UI: date ranges, mode selector, per-domain schedule + Sync now + watermark, retention/detail toggles behind *Advanced* |

---

### Decisions (resolved)
- **Retention horizon:** default **24 months**, configurable upward / unlimited. ✔
- **Late-posted docs:** only `STATUS=4` enters analytics; capture by **modified/posted timestamp** watermark so late-posted documents aren't missed (§3). ✔
- **Scheduling:** **Power BI-style** — specific times of day + days of week + timezone per domain, plus interval/manual modes (§7.3). ✔
