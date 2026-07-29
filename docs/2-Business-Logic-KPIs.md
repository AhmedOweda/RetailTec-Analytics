---
title: "RetailTec Analytics — Business Logic & KPI Calculations"
subtitle: "Volume 2 of 5 — Technical Handover Documentation"
date: "July 2026 · App version 3.1.0"
toc: true
---

# 1. Universal Rules (apply to every number in the product)

1. **Only posted documents count.** Sales facts load `STATUS = 4` documents with `RECEIPT_TYPE IN (0,1,2)` (0 = sale receipt, 1 = return receipt, 2 = order). Vouchers additionally exclude `HELD = 1` and `SLIP_FLAG = 1` (transfer-generated vouchers live in Transfers, not Purchasing).
2. **Subsidiary 100 never appears in operational numbers.** It is the accounting customization's synthetic subsidiary; every non-accounting extract and screen filters it out, and it never consumes a licensed subsidiary slot.
3. **Money comes in two families:** `*_WOTAX` (without tax) and `*_WTAX` (with tax). KPI cards say which they use; the P&L works without tax by definition.
4. **Signs:** header `NET_SALES_WOTAX` and `TOTAL_TAX` are *signed* (negative on return documents). Item-level rows carry an `ITEM_TYPE` of `'Sale'` or `'Return'` and positive quantities; measures apply the sign by type.
5. **A sale receipt can contain returned items.** (Verified in production: ~1,017 type-0 receipts carrying return lines.) Therefore *gross sales*, *returns value* and *return units* are always measured from **FACT_SALES_ITEMS**, never inferred from receipt counts.
6. **Store scoping is enforced server-side.** A store-scoped user's JWT carries the allowed stores; every endpoint re-applies that set — the UI merely mirrors it.
7. **Zero-noise thresholds:** a difference below 0.005 renders as 0.00 and is treated as float noise, not a posting error (`EPS` in the accounting pages).

# 2. Sales KPIs

| KPI | Definition |
|---|---|
| **Net Sales (w/o tax)** | Σ `NET_SALES_WOTAX` = (`SALE_SUBTOTAL_WITH_TAX` − `SALE_TOTAL_TAX_AMT`) − (`RETURN_SUBTOTAL_WITH_TAX` − `RETURN_TOTAL_TAX_AMT`) per document, summed. Signed, so returns reduce it naturally. |
| **Gross Sales (w/o tax)** | Σ item `TOTAL_PRICE_WOTAX` where `ITEM_TYPE='Sale'`. |
| **Returns (w/o tax)** | Σ item `TOTAL_PRICE_WOTAX` where `ITEM_TYPE='Return'` (positive figure). Net = Gross − Returns. |
| **Return Units** | Σ item `QTY` where `ITEM_TYPE='Return'`. |
| **Return Rate** | Returns value ÷ Gross sales (or units-based where labeled). |
| **Total (w/ tax)** | (`SALE_SUBTOTAL_WITH_TAX` − `RETURN_SUBTOTAL_WITH_TAX`) + `TOTAL_DEPOSIT_TAKEN` + `TOTAL_FEE_AMT` + `SHIPPING_AMT`. |
| **Tax** | Signed `SALE_TOTAL_TAX_AMT` − `RETURN_TOTAL_TAX_AMT`. |
| **Invoice Discount** | Header `DISC_AMT`. |
| **Item Discount** | Σ `DOCUMENT_ITEM.DISC_AMT` with sign flipped on return lines (`ITEM_TYPE=2 → ×−1`), excluding kit components (`KIT_FLAG <> 5`). |
| **Loyalty Discount** | Header `LTY_SALE_TOTAL_BASED_DISC`. |
| **Transactions** | Count of RECEIPT_TYPE=0 documents (returns and orders counted separately). |
| **ATV (avg ticket)** | Net Sales ÷ Sales Count. |
| **UPT (units per ticket)** | Sold units ÷ Sales Count. |
| **COGS** | Σ item `TOTAL_COST` (qty × unit cost) with sale/return sign. |
| **Margin / Margin %** | (Net Sales − COGS); Margin ÷ Net Sales. |
| **Deposits taken** | Header `TOTAL_DEPOSIT_TAKEN` (order deposits — money in, not yet revenue). |
| **Fees / Shipping** | Header `TOTAL_FEE_AMT` / `SHIPPING_AMT`. |

**Payment split** (per document, from `RPS.TENDER` by `TENDER_TYPE`): Cash = type 0 · Card = types 2 and 11 · Deposit-used = type 7 · Other = everything else. These feed the `CASH_AMT/CARD_AMT/DEPOSIT_AMT/OTHER_AMT` columns and the payment KPIs.

**Date attribution:** all sales figures sit on `INVC_POST_DATE` (the business posting date). Comparisons ("vs previous period") shift the window by its own length; "vs last year" aligns by date.

# 3. Inventory KPIs

| KPI | Definition |
|---|---|
| **On-hand Qty / Value** | Snapshot `ON_HAND_QTY`; value = `ON_HAND_QTY × COST`. Retail value = `ON_HAND_QTY × PRICE1`. |
| **Coverage (days)** | On-hand ÷ average daily units sold over the selected window (per item/store). Infinite ⇒ shown as no-sales. |
| **Stagnant stock** | Items **with stock on hand** and **no sale** in the chosen period (30/60/90-day drill cards on Home use the same query as the Inventory coverage page — one source of truth). |
| **Inventory aging buckets** | 30/60/90-day since-last-movement buckets on the coverage page. |
| **Movement history** | FACT_INVENTORY_HISTORY quantity deltas by `ACTION_TYPE`/date (only on servers with the customization). |
| **Sell-through** | Units sold ÷ (units sold + on hand) for the window, where labeled. |

# 4. Purchasing KPIs

| KPI | Definition |
|---|---|
| **Received Value (cost)** | Σ `RECV_QTY × UNIT_COST` from voucher lines. |
| **Received Retail** | Σ `RECV_QTY × UNIT_PRICE`. |
| **Ordered vs Received** | `ORD_QTY` vs `RECV_QTY` (fill-rate = received ÷ ordered). |
| **Voucher Total / Subtotal / Discount** | Header `VOU_TOTAL` / `VOU_SUBTOTAL` / `DISC_AMT`. Header totals may include tax/fees, so line-sums and header totals legitimately differ — compare like with like. |
| **By-vendor views** | The same measures grouped by `VEND_SID`. |

Purchases are **merchandise receipts of sellable products** — under the perpetual-inventory model they capitalize into Inventory, not expenses (see Volume 5 §2).

# 5. Transfers & Adjustments

- **Transfers:** value = `QTY × COST` per slip line; symmetric by construction (the same row carries `OUT_STORE_SID` and `IN_STORE_SID`). `VOU_STATUS` mirrors the receiving voucher.
- **Adjustments:** `QTY_DIFF = ADJ_QTY − ORIG_QTY`; `COST_DIFF = QTY_DIFF × UNIT_COST`. Positive = stock created, negative = stock written off.

# 6. Accounting Measures (summary — full treatment in Volume 5)

- **Reading a GL line:** amount = `DOCUMENT_ITEM.PRICE`, **always positive**; the *sign lives in `ITEM_TYPE`* (1 = debit, 2 = credit). The warehouse stores `DEBIT`, `CREDIT` and signed `AMOUNT` (debit-positive) so measures just SUM.
- **Balanced gate:** a *balance unit* (source document across all its journals — or a manual entry within itself) must net to 0.00. Unbalanced units are excluded from every statement and listed in **GL Exceptions**; the Trial Balance total row proves the gate (Period Debit = Period Credit).
- **Date basis:** every accounting page offers **Transaction date** (`POST_DATE` — the business activity's period) vs **Posting date** (`GL_POST_DATE` — when the books received it). Drill-throughs always carry the basis so the target page reproduces the clicked figure.
- **Trial Balance (6-column):** per account — Opening Dr/Cr (signed opening balance split by sign), Period Dr/Cr (posted sums), Closing Dr/Cr (opening + period, split by sign). Opening = Σ AMOUNT strictly before the window start.
- **P&L:** classes mapped to roles (Revenue/Cost); revenue sections first, then costs, ordered by the customer's own tree order (`CLASS_SEQ`). Profit = Σ revenue − Σ cost over signed amounts.
- **Balance Sheet:** Asset/Liability/Equity roles, cumulative balances to the as-of date.
- **BP Statement:** one partner's ledger with a running balance. Default **control-account view** measures the partner's balance only on the configured receivable/payable accounts (`1220.01`/`AR`, `3100.01`/`AP`) — because payment journals stamp the partner on *both* lines, role-based filtering would net payments to zero and overstate balances. An "all lines" audit view exists.

# 7. Where each number is computed

All KPI logic lives **server-side** in `backend/routers/` (sales.py, inventory.py, purchases.py, accounting.py…) as parameterized DuckDB SQL — the frontend only formats. The same endpoint that renders a grid also serves its scheduled-report replay (`services/report_grid.py` registry), so an emailed report can never disagree with the screen. When you change a formula, you change it once.

**Slicer semantics:** every page passes `date_from/date_to` (inclusive), optional `stores` (names), `subsidiaries` (SIDs), and per-page extras (item identifier, DCS, vendor, date-basis…). The shared DataSlicer component guarantees consistent behavior; drill-throughs carry the full slicer state in the URL.

# 8. Data-quality gates you must not remove

- The balanced-document gate (accounting) — statements only ever show money that provably balances.
- The never-empty guards — FACT_INVENTORY and small dimensions refuse to overwrite good data with an empty source read.
- The sbs-100 quarantine in every operational extract.
- Insert-only anti-joins on immutable facts (no updates ⇒ no accidental drift).
- The `?`-placeholder count assertion on every warehouse query.
