# RetailTec Analytics — Expert Review (July 2026)

An end-to-end assessment of the product as it stands today, written from the
perspective of shipping it as a commercial BI product for Retail Pro Prism
customers in the Gulf. Verdict up front: the core is genuinely solid — the data
pipeline is fast and now provably correct, security fundamentals are in place,
and the feature set (permissions, scheduled reports, configurable columns)
already exceeds what small pharmacy/retail chains get from generic BI tools.
The gaps that remain are mostly about productization: packaging, updates,
licensing, and operational polish.

---

## 1. Architecture — strong foundation, right choices

Oracle (Prism) → Python/FastAPI sync → local DuckDB star schema → React front
end. This is the right shape for the market: customers keep their data
on-premises (a real selling point in Saudi), reports stay fast even offline,
and the Oracle server is only touched during syncs with index-aware queries.

What is particularly good: the adaptive Oracle hints (index scans for small
windows, full scans for backfills), the bulk anti-join loading (~50× faster
than the original row-by-row approach), the clone-and-swap pattern that avoids
DuckDB's ART index corruption bug, and per-request cursors so dashboards stay
responsive during syncs. These were all hard-won lessons and are now documented
in code comments — keep that discipline.

Watch items: everything runs in one process on one machine. That is fine for
the target market (single-server per customer), but document it as a stated
limit. The `float64` SID corruption we found this week is the cautionary tale:
one subtle staging bug silently poisoned joins for weeks. The `dtype=object`
fix is in, but add a **post-sync validation step** that asserts join coverage
(e.g. ≥99% of fact vendor/customer/store SIDs resolve in dims) and surfaces a
red banner when it drops — that turns silent corruption into a loud alarm.

## 2. Data correctness — now verified, keep it locked

Column semantics were validated against Krunch's production SQL (returns,
discounts, tender types, item types), and the big traps are solved and
memorialized: the two vendor link spaces (item vendors via INVN_SBS_VENDOR,
purchase vendors via VOUCHER), the controller-store fallback for adjustments,
voucher numbers via SLIP.VOU_SID, and case-corrupted SIDs. YTD figures were
reconciled against Krunch outputs.

Recommendation: freeze these mappings behind a small **reconciliation test
suite** — a script that runs five known aggregates (YTD net sales, returns,
discounts, tender split, purchase totals) against both Oracle and DuckDB and
diffs them. Run it after every sync-code change and before every customer
deployment. It's a day of work and it protects the product's single most
important promise: the numbers match Prism.

## 3. Security — good for on-prem, two things before selling

In place: JWT auth on every endpoint, bcrypt-equivalent password hashing,
DPAPI-encrypted Oracle/SMTP passwords at rest, parameterized SQL everywhere,
server-side store scoping from the JWT claim, per-user page permissions, admin
gating on all destructive endpoints, no CORS wildcard.

Before commercial deployment: (1) force the default admin password change on
first login rather than just warning — a customer install that keeps
`Retailtec@123` is your reputation on the line; (2) serve over HTTPS or bind
strictly to localhost with the desktop shell — if any customer wants LAN
access from other PCs, add TLS then, not later. Also consider an audit log
table (who logged in, who changed settings/users) — cheap to add, and
enterprise buyers ask for it.

## 4. Performance — excellent locally, one thing to monitor

15M+ rows load in ~30 minutes over a WAN; two-year windows in ~15; dashboards
answer sub-second from DuckDB; unbounded grids paginate client-side without
strain. The decision to let the customer cap history (now 2 years) keeps the
file ~1 GB — the backup path (native DuckDB copy) even compacts to half.

Monitor: the warehouse file grows with every rebuild until compaction. Schedule
an automatic weekly CHECKPOINT + monthly backup by default in customer
installs. And AG Grid with 75k rows is fine, but if any customer runs 10×
your current data, switch the biggest grids to server-side pagination — the
endpoints already support limit/offset, so it's a contained change.

## 5. UX — consistent and configurable, two refinements left

The recent sweep did a lot: uniform page headers, one KPI card style (F)
everywhere, equal card heights, Item Vendor vs Supplier terminology with
tooltips, wrapped grid headers, per-user column layouts that follow the user
across machines, configurable item-master columns, thresholds and number
formats as settings, collapsible settings sections with a sticky save bar.

Remaining refinements I recommend: (1) split Settings into tabs (Connection &
Data / Schedules / Display / Reports / Maintenance) — the page is now long
enough that collapsing isn't enough; (2) **Arabic/RTL mode** — your buyers'
staff will ask for it, the data is already bilingual, and MUI supports RTL
well. Do it before the first paying customer demo, not after. (3) A small
first-run wizard (connect Oracle → test → pick history window → load) would
cut your own installation time per customer dramatically.

## 6. Productization — the real gap between "project" and "product"

This is where the effort should go next:

**Packaging.** Today the app runs from source with Python and Node installed
by hand — that doesn't scale past you. Bundle it: Electron (already scaffolded)
or a plain installer (PyInstaller backend service + built frontend + NSIS).
One .exe installer, backend as a Windows service, auto-start. This week's
starlette-upgrade breakage is exactly what bundling prevents — a frozen
environment can't be broken by another tool's pip install.

**Licensing.** You need at least: per-customer license key, expiry/renewal
check, and store-count or user-count tiers. A signed JSON license file
validated at startup is enough for v1.

**Updates.** Decide the update path now (installer re-run is fine for v1), and
version the DuckDB schema — the migration guards you already write per-column
are good; formalize them with a SCHEMA_VERSION row.

**Branding/whitelabel.** Logo, product name, and colors are hardcoded — one
customer will ask for their logo on the reports. Make the logo + name a
setting; reports already carry the RetailTec footer.

**Support readiness.** Add an in-app "About/diagnostics" panel: app version,
schema version, last sync, warehouse size, license status, one-click log
export. Every support call starts with those five facts.

## 7. Commercial positioning (Gulf, Retail Pro Prism)

Strengths to sell on: native Prism understanding (the vendor-space and
column-semantics work IS the moat — generic BI consultants get these wrong),
on-prem data, Arabic data handled correctly, new Saudi Riyal symbol, Gulf
currencies, store-scoped users for franchise/branch structures, scheduled
email reports per branch manager. Price against Power BI consulting projects,
not against software licenses — you replace a 40-hour consulting engagement
plus monthly maintenance.

Risks to manage: single-developer bus factor (the docs in this repo mitigate
it — keep HANDOFF.md current), Prism schema drift on RP9 upgrades (the
reconciliation suite from §2 is your early-warning system), and support
load — every setting you made configurable this week reduces future support
tickets; keep leaning that way.

## 8. Priority list (my recommendation, in order)

1. Post-sync validation + reconciliation test suite (protects the product's core promise)
2. Installer/packaging with frozen dependencies + backend as a service
3. Forced admin password change + audit log
4. Arabic/RTL toggle
5. License key mechanism
6. Settings tabs + first-run wizard
7. About/diagnostics panel + default weekly compact/backup schedule
8. Whitelabel branding setting

Items 1–3 make it safe to sell; 4–5 make it sellable; 6–8 make it scale past
the first handful of customers.

---

*Prepared by the development assistant after the July 2026 sprint: security
hardening, sync redesign (50× load speedup), SID-corruption fix and warehouse
rebuild, permissions, scheduled reports, and the configurability sweep.*
