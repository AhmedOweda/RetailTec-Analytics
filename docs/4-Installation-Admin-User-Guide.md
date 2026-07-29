---
title: "RetailTec Analytics — Installation, Administration & User Guide"
subtitle: "Volume 4 of 5 — Step-by-step Tutorial"
date: "July 2026 · App version 3.1.0"
toc: true
---

# 1. Requirements

- Windows 10/11 or Windows Server (64-bit), ~1 GB free disk (plus warehouse growth), network route to the customer's Oracle/Prism server (typically over VPN).
- **Nothing else.** The installer bundles Python runtime, Oracle Instant Client, and the web app. Customers do **not** install Oracle client software.
- A modern browser (Edge/Chrome/Firefox) on any machine that can reach the server on TCP **7382**.

# 2. Installation — step by step

1. Run `RetailTecAnalytics-Setup-<version>.exe` → Next through the wizard → Install. The app installs per-machine and adds a Start-Menu entry.
2. Launch **RetailTec Analytics**. A tray icon appears (bottom-right); the browser opens `http://127.0.0.1:7382` automatically (or open it yourself).
3. If other machines will use it, allow the port once on the server:
   `netsh advfirewall firewall add rule name="RetailTec 7382" dir=in action=allow protocol=TCP localport=7382`
   Users then browse to `http://<server-ip>:7382`. **Keep this behind VPN/firewall — never expose 7382 to the public internet.**
4. **First login:** username `admin`, password `Retailtec@123`. Change it immediately (profile menu → Change password).

# 3. Licensing — what the customer sees

The app is **hard-locked without a valid license**: instead of dashboards you get a lock screen stating the reason (NO LICENSE / EXPIRED / WRONG DEVICE / WRONG SERVER / …), plus the **Device code** and the license file path.

1. Send RetailTec the **Device code** shown on the lock screen (also in Settings → Maintenance → About when unlocked).
2. Receive `license.json`. Either click **Install license file…** on the lock screen (admin login required) and pick the file — it is validated before it is accepted — or copy it manually to `C:\ProgramData\RetailTec Analytics\license.json` and click **Re-check**.
3. The license survives uninstall/reinstall (it lives in ProgramData). The lock reappears automatically if the license expires (a renewal reminder shows during the last 14 days), the file is tampered with, or it is moved to the wrong machine/server.
4. Licenses can restrict **modules** (Sales, Inventory, Purchasing, Accounting, Dimensions, Reports & Email, AI, Home): unlicensed modules simply do not exist in the UI or the API. They can also cap **subsidiaries** — exceeding the cap starts a visible 30-day countdown, then locks.

# 4. First-time data load — step by step

1. **Settings → Connection & Data.** Enter Oracle host IP, port (1521), service name (e.g. `rproods`), username, password, and a friendly alias. Click **Test Connection** — fix anything red before continuing. Click **Save Settings**.
2. In **Your data**, review each domain row: toggle on/off, "Keep history" window (e.g. Last 3 years), refresh schedule (Manual / Every N minutes / At set times), and line-detail retention. The **Accounting** row appears only when the server carries the customization.
3. Click **Load All Data now**. The first load of a multi-year history is the slow one (it full-scans Oracle); progress shows live. Subsequent refreshes are incremental and take seconds to minutes.
4. Verify in **Loaded Data** (bottom of the tab): each domain shows the From→To span actually in the warehouse and its row count.
5. Set **Automatic sync** (top of tab): timezone, incremental overlap (**30/60/90 days** — every refresh re-checks at least the last 30 days, which self-heals late postings), optional quiet hours.

**Load controls you'll use later:**

- **Load now ▾** (per domain): *Load now* (append; nothing deleted) or **Replace everything** (red — deletes that domain's loaded window and reloads it from Oracle; confirmation + audit-logged). Use Replace after an accounting repost.
- **Load a date range…**: backfill a specific period; tick **Replace this period** to delete-and-reload just that window.
- **Refresh Dimensions only**: re-pulls stores/employees/items/etc. without touching facts.

# 5. Settings tour (admin)

| Tab | What's there |
|---|---|
| **Connection & Data** | Oracle connection, per-domain load/schedule/retention, automatic sync, loaded-data spans, sync history. The page warns that the server listens on all interfaces. |
| **Display** | Currency symbol, language (English/العربية with full RTL), item identifier (ALU/UPC/description), field preferences, dark mode default. |
| **AI Assistant** | Enable "Ask AI", choose provider (local Ollama or a cloud provider + API key) and model. Questions + schema go to the provider; row data stays local except a small preview. |
| **Reports & Email** | SMTP host/port/credentials/TLS, sender; scheduled report list (create/edit/pause), governance alert digests, send history. |
| **Accounting** | Class→role mapping for the statements, Receivable/Payable control accounts, report defaults (date basis, include-unbalanced). Has its own always-visible save bar. |
| **Maintenance** | Backup Now / backup folder / Restore (keeps a safety copy), Compact database, weekly auto-maintenance + monthly backup retention, About & Diagnostics (version, schema, warehouse size, license state, device code, license file path, feature availability). |

**Users (Settings → Users):** create users, set role (Admin / User), per-page permissions, and store scoping (a scoped user sees only their stores' data — enforced server-side). **Audit Log** records logins, settings saves, loads, license installs, replaces.

# 6. Daily use — user guide

1. **Home** — KPI overview with alert cards (e.g. stagnant stock); every alert number is clickable and drills to the exact filtered page behind it.
2. **Navigation** — modules in the left sidebar (sections expand/collapse). **Ctrl-K** opens the command palette: type any page name and jump.
3. **Slicers** — every page has the same bar: date presets (7D/30D/MTD/YTD) or custom From/To, store multi-select, subsidiary multi-select, plus page-specific filters. The header also carries a global subsidiary picker.
4. **Grids** — sort by clicking headers, filter with the funnel icons, drag to reorder columns, use the **Columns** button to show/hide (your layout is remembered per user). Click rows to drill through (invoice → its line detail, account → its ledger, alert → its list).
5. **Exports** — every grid: **Excel**, **PDF** (Arabic-safe), and **Email** (send now to any recipients, or **Schedule recurring** — daily/weekly at a chosen time, with the exact filters you had on screen). Scheduling requires the Reports & Email module license and configured SMTP.
6. **Saved views** — save your slicer + column layout under a name and recall it from the view menu.
7. **Language & theme** — toggle English/العربية and light/dark from the header. Everything, including PDFs and grids, follows.
8. **Accounting pages** — see Volume 5 §6 for the accountant's reading guide (date basis toggle, balanced gate, drill-through chain Journal → Trial Balance → General Ledger → source document).

# 7. Tray icon (on the server)

Right-click the tray icon: **Open dashboard** · **Sync now (last N days)** — N follows the configured overlap live · **Restart** (safely cancels a running sync first) · **Open log file** (`retailtec.log`) · **Open data folder** · **Start with Windows** toggle · **Quit**. Schedules only fire while the app runs — leave it running on the server (enable autostart).

# 8. Updating the app

Run the new installer over the old installation. State (settings, users, warehouse, license) survives: runtime files live outside the wiped program files (license in ProgramData; settings/warehouse preserved by the installer's exclusions). After updating, hard-refresh the browser (Ctrl-F5).

# 9. Troubleshooting

| Symptom | Cause / fix |
|---|---|
| Lock screen "NO LICENSE / EXPIRED / WRONG …" | See §3. Install/renew the license; Re-check. Wrong-device/server means the license was issued for another machine/Oracle host — contact RetailTec. |
| "UNLICENSED COPY" | The warehouse file was filled from a different Oracle server (copied database). Point the connection back, or do a fresh load against the licensed server. |
| Sync fails instantly | VPN/network to Oracle down, or credentials changed — use Test Connection. The sync history row carries the exact Oracle error. |
| `ORA-12704` in a custom query | NVARCHAR2 charset mixing — wrap literals with `N'...'`/`TO_NCHAR` (Volume 1 §2.2). |
| App won't start after a crash/power cut | It now self-heals a corrupt WAL automatically (quarantined into `wal_quarantine\`); check `retailtec.log`. Worst case: Settings → Maintenance → Restore from the latest backup. |
| Dashboards empty for a period | That period isn't loaded — check Settings → Loaded Data and run a range load. |
| Scheduled emails not arriving | SMTP settings (send a test), recipient typos (invalid recipients are skipped and logged), and the app must be running on the server. |
| Port unreachable from other PCs | Firewall rule (§2.3) and VPN routing. |
| Slow first load | Expected — multi-year full scan of Oracle over WAN. Later loads are incremental. |

**Log file:** `retailtec.log` next to the exe — the first thing to read on any problem. **Diagnostics:** Settings → Maintenance → About & Diagnostics (copy button) — send this with any support request.
