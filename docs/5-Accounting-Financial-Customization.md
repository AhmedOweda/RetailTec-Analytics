---
title: "RetailTec Analytics — Accounting: Financial Perspective, Reports & Customization"
subtitle: "Volume 5 of 5 — The Virtual GL end to end"
date: "July 2026 · App version 3.1.0"
toc: true
---

# 1. The Concept: a Virtual General Ledger inside Retail Pro

Retail Pro Prism has no general ledger. This customization builds one **inside** Prism itself, using subsidiary **100** as a synthetic "accounting company":

- **Chart of accounts** = NON-INVENTORY items in `RPS.INVN_SBS_ITEM` under DCS `ACCOUNT` of subsidiary 100. `ALU` = the displayed account code; **`UDF5_STRING` = the stable logical key** (`ACCOUNT_KEY`); English/Arabic names in `DESCRIPTION1/2`; `UDF1_STRING='Account-Flag'`.
- **Journals** = ordinary sbs-100 DOCUMENTs whose DOCUMENT_ITEM lines are GL lines.
- Three moving parts, all vendor-maintained:
  1. **Master script** (`POS - Create Accounts Master script - Oracle`) — creates/updates the 42 integration accounts idempotently (insert-or-update by ALU; performs the AR/AP rename, §7.2).
  2. **Posting query** (`POS - Accounting Query`, ~2,000 lines) — reads operational documents and emits balanced double-entry line sets. Variables at top: `SBS_NO_VAL`, `FROMDATE_VAL`, `TODATE_VAL`. An `ACCT_MAP` CTE maps `UDF5_STRING → ALU` (this indirection is why ALU renames never touch the query). A `CORRECTION` CTE plugs rounding gaps ≤ 0.2 into `0000.02 Tender Rounding`.
  3. **C# poster** — takes the query output and writes it back as sbs-100 documents, stamping metadata into the NOTE fields.

## 1.1 NOTE-field contract (poster ↔ Analytics)

| NOTE | Content |
|---|---|
| NOTE1–4, 6 | Source subsidiary, store code, doc no, business partner id, misc |
| **NOTE5** | Journal DOC_TYPE (e.g. `Sale`, `Return`, `Purchase`, `P_Sale-Cash`, `P_Sale-MADA`…) |
| **NOTE7** | Source `DOC_SID` — the operational document this journal came from |
| **NOTE8** | The source document's date **as text** — two formats occur: `DD-MM-YYYY HH24:MI:SS` (vast majority) and ISO-8601. The extractor detects by dash position and parses both. |

**The four reading rules** (memorize):
1. Line amount = `DOCUMENT_ITEM.PRICE`, **always positive** (QTY=1).
2. The **sign is `ITEM_TYPE`**: 1 = DEBIT, 2 = CREDIT.
3. The **accounting date is NOTE8** (the business activity's date) — *not* the sbs-100 document's own posting date, which is merely when the poster ran (they differ by months). Both are kept in the warehouse (`POST_DATE` vs `GL_POST_DATE`) and every report offers the "date basis" toggle.
4. A **balance unit** = the source document across ALL its journals (the poster deliberately splits one document into several journals by DOC_TYPE, clearing through AR); manual entries balance within themselves. Never judge balance per journal.

**Dedupe guard:** the query re-run safety is `CONCAT(DOC_SID, DOC_TYPE) NOT IN (SELECT CONCAT(NOTE7, NOTE5) … WHERE SBS_NO=100)` — new journal *types* post onto already-posted documents freely; changing an existing type requires deleting the old journals first.

# 2. The Financial Model

- **Perpetual inventory.** Receiving sellable goods debits **1200.00 Inventory** against AP/payment — a purchase is an asset, not an expense. The expense is recognized at sale time as **COGS (6010.01 vs 1200.00)**. Voucher-related costs post to 6020.01 (voucher transaction discount), 6050.01 (freight in), 6060.01 (voucher fee).
- **Sales side:** revenue 5100.01, merchandise discount 5110.01, shipping 5200.01, receipt fees 5300.02–06, receipt transaction discount 5400.01, sales tax 3500.01 (voucher tax 3500.02), order deposits 3250.01, store credit 3240.01, gift card 1010.21, loyalty 1010.26.
- **Clearing through AR:** every sale journal debits AR (1220.01/AR) and every payment journal credits it against the tender account — so a fully paid document nets AR to zero. **In this business all sales are paid immediately** (Prism cannot close a sale without payment), so AR ≈ 0 is the healthy state; a growing AR balance historically meant *unmapped tenders* (see §5).
- **Expenses & consumables (rent, salaries, supplies…) never flow from POS.** The owner's decision (July 2026): the accountant keys them as **direct manual journal entries in sbs 100** to their expense accounts. The app fully supports this: manual entries are category **Entry** (`SRC_DOC_SID IS NULL`), their own posting date is the accounting date, they must balance within themselves (else GL Exceptions), and their accounts classify through the Prism tree like any other (§7.1).

# 3. The Tender Map (final, July 2026)

Payment journals map each `RPS.TENDER` line to a cash/clearing account. Card matching uses the **effective-brand CASE**: `CASE WHEN UPPER(TC.CARD_TYPE_NAME) IN (<all card words>) THEN <card word> ELSE UPPER(T.TENDER_NAME) END` — the recognized card-type word wins, the tender name is the fallback; **whitelist words only, never UDF labels** (those are user-configurable).

| Tender | Account | Journal |
|---|---|---|
| 0 Cash | 1010.01 | P_Sale-Cash |
| Brand card MADA | 1010.13 | P_Sale-MADA |
| Brand card Master Card (`MASTER CARD`,`MC`) | 1010.14 | P_Sale-Master Card |
| Brand card VISA (`VISA`,`VISA CARD`) | 1010.15 | P_Sale-Visa |
| Brand card AMEX | 1010.16 | P_Sale-American Express |
| Card, brand NULL | 1010.30 Credit Card | P_Sale-Credit Card |
| 3 COD | 1010.05 | P_Sale-COD |
| 4 Charge (آجل) | 1010.40 | P_Sale-Charge |
| 7 Deposit used | Dr 3250.01 (deposit released) | P_Sale-Deposit |
| 15 Central Gift Card | 1010.21 | … |
| 17 Central Customer Credit | 3240.01 | … |
| **19–28 Custom Tender 1–10** | **1010.51–1010.60** (`'1010.' || TO_CHAR(50 + TENDER_TYPE − 18)`) | `P_Sale-Custom N` |
| **Catch-all** (anything else, incl. unrecognized card names) | **1010.30 Credit Card** | P_Sale/P_Return/P_Deposit-Credit Card |

Deposit-TAKEN money is handled via the `DEPOSIT_DOCS` model in every block (AR leg → 3250.01). The catch-all exists because **silently unmapped tenders were the biggest defect ever found** (§5). This customer's live card names include `MADA`, `Visa Card`, `Master Card`, `GEIDEA`, `Tabby` — GEIDEA/Tabby currently land in the catch-all unless mapped to their own accounts (accountant already keeps 1010.03/1010.07; adding dedicated CASE blocks is a §7.3 customization).

# 4. From Prism to the Warehouse

The Analytics extractor (`_sql_gl`) reads sbs-100 lines and:
- parses NOTE8 with dual-format detection; `acct_date = COALESCE(parsed NOTE8, TRUNC(document's own INVC_POST_DATE))` — the fallback is exactly what makes **manual entries** work;
- joins `ACCOUNT_KEY` (UDF5) and carries the ALU as `ACCOUNT_CODE`;
- stores DEBIT/CREDIT and signed AMOUNT;
- **window-replaces** FACT_GL on every load (a DBA wipe-and-repost inside the ≥30-day incremental window heals automatically; a full/range load heals any period);
- derives FACT_GL_DOC per balance unit with `IS_BALANCED` — the reporting gate;
- pulls the classification tree from the Prism **accounting touch menu**: level-1 branches = classes (Assets, Liabilities, Equity, Purchases, Sales, Expenses — the customer's own taxonomy), level-2 = statement groups, plus built-in defaults for the 42 integration accounts (`CLASS_SOURCE` records the provenance). Unclassified *active* accounts are surfaced in the UI ("n accounts unclassified — place them in the accounting touch menu in Prism").

# 5. The Two Historic Defects (context for the successor)

1. **Deposit receipts (950):** zero-merchandise deposit documents plus an accrual-block bug produced unbalanced journals. Fixed with the payment-only `DEPOSIT_DOCS` model.
2. **Unmapped tenders = fake AR 50,815.** 27 documents whose card tenders (`UDF3` → actually Tabby; `بطاقة إئتمانية` → GEIDEA) matched no payment block, so no payment journal was written and AR never cleared — invisible to the balanced gate because the *sale* journals balanced fine. Sum tied exactly to the AR balance. The cure is the catch-all + custom-tender blocks above. A dry run on subsidiary 1 validated the final query: 3,663 journals all netting 0.00, zero guard collisions, every NULL account traced to keys the master script creates — hence the run order in §8.

# 6. The Report Suite (accountant's guide)

| Report | What it shows |
|---|---|
| **Journal** | Every journal (document × type) with lines; filter by category (Payment / Transaction / Entry), account, store, date basis. |
| **Trial Balance** | Classic 6-column ميزان المراجعة: Opening Dr/Cr · Period Dr/Cr · Closing Dr/Cr per account; TOTAL row proves Period Dr = Period Cr (green when balanced, red strip + GL Exceptions pointer when not). Click an account → its General Ledger. |
| **Profit & Loss** | Revenue sections first, then costs, in the customer's tree order; class→role mapping configurable in Settings → Accounting. |
| **Balance Sheet** | Assets / Liabilities / Equity cumulative to the as-of date. Statements are presented as signed balances (Dr/Cr columns belong to the TB/ledgers — deliberate). |
| **BP Statement (كشف حساب)** | One partner's ledger with a running balance. Default **control-account view** (only lines on the configured AR/AP accounts count — payment journals stamp the partner on both lines, so role-based measuring would net to zero); an "all lines" audit view exists. |
| **General Ledger** | Per-account line detail with running balance; the drill target of everything. |
| **GL Exceptions** | The safety net: every unbalanced balance unit, with its net. Money is never silently dropped — it is *here* if it is not on the statements. |

All reports: date-basis toggle (Transaction vs Posting date), include-unbalanced toggle (audit mode), store/subsidiary slicers, Excel/PDF/Email like every grid. **Accounting Status** (Settings → Accounting) shows GL lines, documents, period span, last sync, classification coverage.

# 7. Customization Method (how to change things safely)

## 7.1 Adding an account (including expense accounts for manual entries)
1. In Prism (sbs 100): create a NON-INVENTORY item under DCS `ACCOUNT` — `ALU` = code, `UDF5_STRING` = the same code, names in Desc1/Desc2 — *or* add it to the master script's cursor list and re-run (idempotent).
2. Place it in the **accounting touch menu** under the right class branch — that's what classifies it for the P&L/BS. Until then it shows in the "unclassified" count.
3. Nothing else: the next sync picks it up (DIM_ACCOUNT), and manual journals can post to it immediately.

## 7.2 The AR/AP rename convention (already in force)
The partner-facing accounts display as `AR`/`AP` while keeping numeric logical keys: **ALU = 'AR'/'AP', UDF5_STRING stays '1220.01'/'3100.01'**. The master script performs the rename idempotently (matches `ALU IN (target, numeric)`, sets ALU=target, UDF5=numeric). The posting query is untouched (it matches UDF5). The app accepts both codes in its control-account defaults.

## 7.3 Adding a tender mapping (e.g. GEIDEA → 1010.03, Tabby → 1010.07)
1. Ensure the account exists (§7.1).
2. In the posting query, clone a brand-card block and put the brand word(s) in its `IN (...)` list **and** in the merged all-card-words list used by the generic/catch-all tests (the blocks must stay an exact partition — every tender matches exactly one block).
3. Because the guard key is `DOC_SID+DOC_TYPE` and this creates a **new** journal type for old documents, re-running the query posts the new payment journals onto history without deleting anything — but the old catch-all journals for those tenders must be deleted first (they carry the same money under `P_*-Credit Card`). That's a wipe-and-repost case (§8) or a targeted DBA delete.
4. Update the master script if a new account was added; re-run Analytics with Accounting → Replace everything.

## 7.4 Changing statement structure
Reorder/rename class branches in the Prism touch menu (order = `CLASS_SEQ` = statement order), adjust class→role mapping in Settings → Accounting. No code changes.

## 7.5 What NOT to do
- Never post to sbs 100 with unbalanced line sets on purpose — they vanish from statements into GL Exceptions.
- Never change `UDF5_STRING` of an integration account — it is the key the query maps by.
- Never re-run the posting query with a *changed* journal type without deleting the old journals of that type first (guard passes, money doubles).
- Never use UDF/user-configurable labels in tender matching — whitelist literal words only.

# 8. The Wipe-and-Repost Runbook

Used when journal logic changes retroactively (tender remap, defect fixes):

1. **DBA deletes the poster's sbs-100 documents.** ⚠ **CRITICAL once manual expense entries exist:** the delete must target **poster-created documents only** — e.g. items with `NOTE7 IS NOT NULL` (poster journals always carry the source SID) or the poster's `CREATED_BY`/`ORIGIN_APPLICATION` — otherwise the accountant's manual journals are destroyed and cannot be regenerated. *Never* "delete all sbs-100 documents" after manual entries begin.
2. Run the **master script** (creates/updates accounts — must run before the query so every mapped key exists).
3. Run the **posting query** for the full period; feed the output to the **C# poster**.
4. In Analytics: **Settings → Your data → Accounting → Load now ▾ → Replace everything** (deletes the domain's window and reloads). Verify: Trial Balance nets to 0.00, GL Exceptions empty (or explained), AR ≈ 0, tender accounts carry the expected balances.
5. Spot-check one document end-to-end: Journal → its journals → source document number → amounts.

# 9. Known Accounting Gaps (inherited to-do)

- **Opening balances / Retained Earnings** — not yet modeled; the books start at the first posted period. Manual opening-balance entries (§7.1 + a dedicated equity account) are the intended path.
- **Fiscal year & period locking** — no close process yet; reports are windowed freely.
- **Receipt-inventory timing difference** (periodic-vs-perpetual visibility flagged by the accountant) — reconcile via manual entries until a dedicated treatment exists.
- **GEIDEA/Tabby dedicated accounts** — mapping designed (§7.3) but not applied; owner/accountant to decide.
- **VAT/ZATCA summary report** — candidate future report.
- Prism data hygiene: duplicate customers, junk test items in the COA (e.g. `dada`).
