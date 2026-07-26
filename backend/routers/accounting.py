"""
Accounting Router — the virtual General Ledger (subsidiary 100)
===============================================================
Endpoints:
  GET /api/accounting/journal          — one row per journal (src doc x doc type)
  GET /api/accounting/journal/lines    — GL line detail (drill-through)
  GET /api/accounting/trial-balance    — opening / movement / closing per account
  GET /api/accounting/profit-loss      — P&L rows per account (class-role based)
  GET /api/accounting/balance-sheet    — cumulative balances as of a date
  GET /api/accounting/class-roles      — ACCOUNT_CLASS -> statement role map
  PUT /api/accounting/class-roles      — admin: override a class's role
  GET /api/accounting/general-ledger   — per-account ledger with running balance
  GET /api/accounting/bp-statement     — one partner's ledger with running balance
  GET /api/accounting/aging            — AR / AP aging (balance-FIFO buckets)
  GET /api/accounting/exceptions       — source documents that do NOT balance
  GET /api/accounting/search/accounts  — account slicer type-ahead
  GET /api/accounting/search/doc-types — document-type slicer type-ahead
  GET /api/accounting/search/bp        — business-partner slicer (name | id | kind)
  GET /api/accounting/summary          — KPI card figures

Domain rules (hard-won — do not "improve"):
  1. FACT_GL.AMOUNT is ALREADY SIGNED (debit positive). A balance is SUM(AMOUNT);
     the sign is never re-derived from anything else.
  2. Balance is meaningful only per SOURCE document (SRC_DOC_SID) across ALL of
     its journals: the poster deliberately splits one source document into
     several journals by SRC_DOC_TYPE which clear through AR.
     FACT_GL_DOC.IS_BALANCED already encodes that — we just use it.
  3. Reports show balanced documents only BY DEFAULT; every report takes
     include_unbalanced=true to see everything, and /exceptions lists exactly
     what the default gate hides. Nothing is ever silently dropped.
  4. The statements (P&L / Balance Sheet) are CLASS-ROLE driven: level 1 of the
     Prism accounting touch-menu tree is fixed in MEANING, free in NAME and
     COUNT. Each first-level class resolves to one of five roles
     (asset|liability|equity|revenue|cost) via stored overrides
     (settings.json -> accounting.class_roles) or the built-in auto-map of
     common EN/AR names (see _AUTO_ROLE). Accounts with a NULL or unmapped
     class are NEVER dropped: they surface in an explicit 'Unclassified'
     section, always last.
  5. TWO date bases, both real and both needed: `date_basis=transaction` (the
     default) windows on FACT_GL.POST_DATE, the period the activity belongs to;
     `date_basis=posting` windows on FACT_GL.GL_POST_DATE, when the books
     received it. They differ by months on production. Whitelisted, never
     interpolated — see _DATE_BASIS / _date_col.
  6. `journal_category` is DERIVED, not stored, and THREE-WAY (2026-07-22):
     SRC_DOC_TYPE LIKE 'P\\_%' means a Payment journal (nets to zero by
     design); anything else WITH a source document (SRC_DOC_SID IS NOT NULL)
     is a Transaction — the integration's Sale / Return / Purchase / Transfer
     Slips journals; anything WITHOUT a source document is an Entry — a
     journal a USER keyed directly into Prism (payroll, rent, accruals).
     See _CATEGORY. Filter values go through _JOURNAL_CATEGORIES, a whitelist.
     Balance grouping follows the same split: a poster document balances
     across ALL its journals, a manual Entry balances within its own GL
     document — FACT_GL_DOC is keyed COALESCE(SRC_DOC_SID, GL_DOC_SID) and
     every join to it uses the same COALESCE (see _balanced / _scope_doc).
  7. BP_ID is a raw SID and resolves to two DIFFERENT dimensions by journal
     type — vendor on purchases/vouchers, customer on everything else. Always
     LEFT JOINed so an unresolvable partner shows its id, never disappears.
     See _BP_JOIN / _BP_NAME / _BP_CODE.

Security: all free text is bound (?); only FastAPI-validated dates and ints are
interpolated (EXPERT_REVIEW.md C2). Store/subsidiary scope comes from the JWT
claims via scoped_stores / scoped_subsidiaries (C1), never from raw Query.
"""
from datetime import date, datetime
from typing import Dict, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from db.model import feature_available, feature_reason, record_audit, FEATURE_ACCOUNTING
from routers.common import (q as _q, qdf as _qdf, csv_in,
                            scoped_stores, store_filter,
                            scoped_subsidiaries, subsidiary_filter)

router = APIRouter(tags=["accounting"])


# ── Optional customisation: the accounting subsidiary (100) ───────────────────
# The virtual GL only exists where the accounting customisation is installed
# (verified: 26.158.231.155 has it, 34.78.79.51 "Green" does not). Without it
# FACT_GL is permanently empty — and an empty Trial Balance is indistinguishable
# from "nothing was posted this month", which is exactly the misleading result
# we must not show. Every endpoint below therefore checks _gl_off() first and
# returns an EMPTY result with a clear signal, never a 500.
#
# Response shapes are preserved so nothing downstream breaks: the object-shaped
# endpoints (/journal, /summary) gain `unavailable: true` + `reason`; the
# row-list endpoints stay plain arrays (report_grid.run_grid and the AG Grid
# pages consume them as lists) and return []. GET /api/features carries the
# authoritative flag the UI reads to render the explanatory panel.

def _gl_off() -> bool:
    return not feature_available(FEATURE_ACCOUNTING)


def _gl_reason() -> str:
    return feature_reason(FEATURE_ACCOUNTING)


# ── Shared fragments ─────────────────────────────────────────────────────────

# DIM_ACCOUNT collapsed to one row per ACCOUNT_CODE. We join the chart of
# accounts on ACCOUNT_CODE (not SID) so a line still resolves after an account
# is re-created in Retail Pro with a new SID — but the same code can then exist
# twice in the dimension, which would fan a GL line out into duplicates.
_ACC = """(SELECT ACCOUNT_CODE,
                  MAX(NAME_EN)       AS NAME_EN,
                  MAX(NAME_AR)       AS NAME_AR,
                  MAX(ACCOUNT_CLASS) AS ACCOUNT_CLASS
           FROM DIM_ACCOUNT
           WHERE ACCOUNT_CODE IS NOT NULL
           GROUP BY ACCOUNT_CODE)"""

# ── Date basis: transaction date vs posting date ─────────────────────────────
# Two genuinely different dates live on every GL line and accountants need both:
#   transaction — FACT_GL.POST_DATE, the source document's own accounting date
#                 (NOTE8) = the period the business activity belongs to;
#   posting     — FACT_GL.GL_POST_DATE, the sbs-100 document's INVC_POST_DATE
#                 = when the books actually received the entry.
# On production they differ by MONTHS (January activity posted in July), so the
# choice materially changes every report — it is a first-class report parameter,
# not a display toggle.
#
# WHITELIST, never interpolation: the caller sends a key, we look up the column
# name. An unknown key falls back to the default rather than raising, so a stale
# saved view or a hand-edited URL degrades to the documented default instead of
# 500-ing. The raw query value NEVER reaches the SQL string.
_DATE_BASIS = {
    "transaction": "POST_DATE",
    "posting":     "GL_POST_DATE",
}
DEFAULT_DATE_BASIS = "transaction"


def _date_col(date_basis: str, alias: str = "G") -> str:
    """Whitelisted date column for the requested basis, qualified by alias."""
    col = _DATE_BASIS.get((date_basis or "").strip().lower(), _DATE_BASIS[DEFAULT_DATE_BASIS])
    return f"{alias}.{col}"


# ── Journal category: Payment / Transaction / Entry ──────────────────────────
# THREE-WAY since 2026-07-22 (owner-requested):
#   Payment     — SRC_DOC_TYPE LIKE 'P_%' (P_Sale-MADA, P_Sale-Cash,
#                 P_Return-Cash, …); nets to zero by design. Unchanged.
#   Transaction — has a SOURCE document (SRC_DOC_SID IS NOT NULL) and is not a
#                 Payment: the integration poster's Sale / Return / Purchase /
#                 Transfer Slips journals. (These were called 'Entry' under the
#                 old binary rule.)
#   Entry       — NO source document (SRC_DOC_SID IS NULL): a journal a USER
#                 keyed directly into Prism (payroll, rent, accruals). The
#                 extract loads these with SRC_DOC_TYPE = NVL(NOTE5, 'Entry')
#                 and never fakes a SRC_DOC_SID, so NULL-ness is authoritative.
#
# DERIVED IN SQL, not stored on FACT_GL. Deliberate: it is a pure function of
# columns we already have, so a stored copy could drift from its source, costs a
# schema change plus a re-sync to populate, and buys nothing — the CASE is free
# next to the scan we already do. Defined ONCE here and reused by every query.
_CATEGORY = ("CASE WHEN G.SRC_DOC_TYPE LIKE 'P\\_%' ESCAPE '\\' THEN 'Payment' "
             "WHEN G.SRC_DOC_SID IS NOT NULL THEN 'Transaction' "
             "ELSE 'Entry' END")

# Same whitelist discipline as the date basis: a key, never raw SQL. 'all' (or
# anything unrecognised) means no filter. 'entry' is deliberately still
# accepted from old saved views / URLs — it now means MANUAL entries only,
# which is the owner's stated intent for the word.
_JOURNAL_CATEGORIES = {"payment": "Payment", "transaction": "Transaction",
                       "entry": "Entry"}


def _category_filter(journal_category: Optional[str]) -> str:
    """Whitelisted Payment/Transaction/Entry filter. '' for all / unknown."""
    cat = _JOURNAL_CATEGORIES.get((journal_category or "").strip().lower())
    if not cat:
        return ""
    # `cat` is a value we chose from our own dict, never the caller's string.
    return f" AND {_CATEGORY} = '{cat}'"


# ── Business partner resolution ──────────────────────────────────────────────
# BP_ID (NOTE3) is an 18-digit SID, meaningless on screen. It points at two
# DIFFERENT dimensions depending on the journal, verified on live Oracle:
#   purchases / vouchers → RPS.VENDOR.SID   → DIM_VENDOR
#   sales, returns and ALL payment journals → RPS.CUSTOMER.SID → DIM_CUSTOMER
#   Transfer Slips carry no BP at all (NULL).
# So the join side is chosen by journal type, and BOTH joins are LEFT with the
# type predicate inside the ON clause: an unresolvable BP still shows its raw
# id instead of the row vanishing.
#
# TRY_CAST, not a VARCHAR compare: BP_ID is text but holds a BIGINT, and
# TRY_CAST yields NULL (no match, no error) on the non-numeric strays.
_BP_IS_VENDOR = ("(COALESCE(G.SRC_DOC_TYPE,'') ILIKE 'Purchase%'"
                 " OR COALESCE(G.SRC_DOC_TYPE,'') ILIKE '%Voucher%')")

_BP_JOIN = f"""
        LEFT JOIN DIM_CUSTOMER BPC ON NOT {_BP_IS_VENDOR}
                                  AND BPC.SID = TRY_CAST(G.BP_ID AS BIGINT)
        LEFT JOIN DIM_VENDOR   BPV ON     {_BP_IS_VENDOR}
                                  AND BPV.SID = TRY_CAST(G.BP_ID AS BIGINT)
"""

# Display name; falls back to the raw SID so nothing ever renders blank.
_BP_NAME = "COALESCE(BPC.FULL_NAME, BPV.VEND_NAME, G.BP_ID)"
# Human code. CUST_ID is NULLABLE and NOT UNIQUE — display only, never a key,
# so it falls back to the name and then to the raw SID.
_BP_CODE = ("COALESCE(BPC.CUST_ID::VARCHAR, BPV.VEND_CODE, "
            "BPC.FULL_NAME, BPV.VEND_NAME, G.BP_ID)")

# LEFT JOINs everywhere: a GL line is NEVER dropped because its account is
# missing from the chart of accounts, or its store from DIM_STORE.
_FROM = """
        FROM FACT_GL G
        LEFT JOIN DIM_STORE S ON S.SID = G.STORE_SID
"""

# _FROM plus the business-partner dimensions, for the grids that show the name.
_FROM_BP = _FROM + _BP_JOIN


def _doc_key(alias: str = "G") -> str:
    """The balance-unit key of a FACT_GL line: the SOURCE document for poster
    journals, the line's OWN GL document for manual entries (SRC_DOC_SID NULL).
    MUST match how _derive_gl_docs keys FACT_GL_DOC — one definition of the
    grouping, used identically on both sides of every join."""
    return f"COALESCE({alias}.SRC_DOC_SID, {alias}.GL_DOC_SID)"


def _balanced(include_unbalanced: bool, alias: str = "G") -> str:
    """The reporting gate — balanced balance-units only, unless asked.
    FACT_GL_DOC.SRC_DOC_SID holds COALESCE(SRC_DOC_SID, GL_DOC_SID), so the
    join must coalesce the FACT_GL side the same way or manual entries
    (SRC_DOC_SID NULL) would never match and silently vanish."""
    if include_unbalanced:
        return ""
    return (f" AND EXISTS (SELECT 1 FROM FACT_GL_DOC GD"
            f" WHERE GD.SRC_DOC_SID = {_doc_key(alias)} AND GD.IS_BALANCED)")


def _dt(d: date) -> str:
    """A FastAPI-validated date is type-safe to interpolate (see module docstring)."""
    return f"DATE '{d.isoformat()}'"


def _scope(stores: Optional[str], subsidiaries: Optional[str],
           alias: str = "G") -> tuple[str, list]:
    """Store + subsidiary scope for a FACT_GL query.

    STORE scope resolves through DIM_STORE (alias S) — store_filter matches
    S.STORE_NAME, which is the populated, human-visible column.

    SUBSIDIARY scope resolves through the FACT's OWN SUBSIDIARY_SID, never
    through DIM_STORE. This is not a preference, it is the bug fix of
    2026-07-20: DIM_STORE.SUBSIDIARY_SID is *derived* (the Retail Pro store
    load carries no subsidiary column) and is wiped to NULL by every
    dimensions load, so `S.SUBSIDIARY_SID IN (...)` silently matched ZERO
    rows and all four Accounting screens went blank while FACT_GL was
    perfectly populated. FACT_GL carries SUBSIDIARY_SID on every row and it is
    authoritative — it comes straight from the source document. Same choice
    `journal_invoices` in routers/sales.py already makes for
    FACT_SALES_INVOICES (alias INV).

    `alias` is the FACT_GL alias of the calling query (always "G" here);
    FACT_GL_DOC has no subsidiary column of its own — see _scope_doc."""
    sf, sp = store_filter(stores, alias="S")
    subf, subp = subsidiary_filter(subsidiaries, alias=alias)
    return sf + subf, sp + subp


def _scope_doc(stores: Optional[str], subsidiaries: Optional[str],
               alias: str = "D") -> tuple[str, list]:
    """Same scope, for the FACT_GL_DOC (document-level) queries.

    FACT_GL_DOC deliberately has no SUBSIDIARY_SID — it is a per-balance-unit
    roll-up whose SRC_DOC_SID column holds COALESCE(SRC_DOC_SID, GL_DOC_SID).
    The subsidiary of a document is the subsidiary of its GL lines, so we test
    that with EXISTS against FACT_GL rather than routing through DIM_STORE
    (which is NULL, see _scope) — coalescing the FACT_GL side with _doc_key so
    manual entries resolve to the same key the roll-up stored."""
    sf, sp = store_filter(stores, alias="S")
    vals = [s.strip() for s in (subsidiaries or "").split(",") if s.strip()]
    if not vals:
        return sf, sp
    ph = ",".join(["?"] * len(vals))
    subf = (f" AND EXISTS (SELECT 1 FROM FACT_GL GS"
            f" WHERE {_doc_key('GS')} = {alias}.SRC_DOC_SID"
            f"   AND GS.SUBSIDIARY_SID IN ({ph}))")
    return sf + subf, sp + vals


def _slicers(account: Optional[str], doc_type: Optional[str],
             doc_no: Optional[str], bp: Optional[str],
             search: str, journal_category: Optional[str] = None,
             bp_id: Optional[str] = None) -> tuple[str, list]:
    """Line-level slicers shared by the journal master + detail grids.
    Every value is bound — nothing here is interpolated. `journal_category` is
    the one exception and goes through a server-side whitelist, never the wire.

    CALLER CONTRACT: the `bp` and `search` filters reach into the BPC/BPV
    aliases, so any query using this MUST select from _FROM_BP, not _FROM."""
    w, p = "", []
    af, ap = csv_in("G.ACCOUNT_CODE", account);  w += af; p += ap
    tf, tp = csv_in("G.SRC_DOC_TYPE", doc_type); w += tf; p += tp
    if doc_no:
        w += " AND G.SRC_DOC_NO ILIKE ?"; p.append(f"%{doc_no}%")
    # EXACT business-partner match — the '|'-joined list of SIDs a picked
    # dropdown option carries (the Journals customer_id / customer model).
    # Separate from the fuzzy `bp` below on purpose: BP_ID is the only unique
    # key, and two partners can share a name or a CUST_ID (it is nullable AND
    # non-unique), so "the partner the user actually clicked" can only be
    # expressed as its SID. Compared as VARCHAR, exactly as it is stored.
    bp_sids = [t.strip() for t in (bp_id or "").split("|") if t.strip()]
    if bp_sids:
        w += (" AND COALESCE(G.BP_ID,'') IN ("
              + ",".join(["?"] * len(bp_sids)) + ")")
        p += bp_sids
    # Fuzzy business partner. Matches the resolved NAME and CODE as well as the
    # raw SID: the grid shows a name, so typing that name must find the row, and
    # the raw id stays matchable because it is the only unique key.
    # '|'-joined = OR, so several typed partners narrow to their union — the
    # same wire shape as the `customer` filter on Sales → Journals.
    bp_terms = [t.strip() for t in (bp or "").split("|") if t.strip()]
    if bp_terms:
        alts = []
        for term in bp_terms:
            alts.append("(COALESCE(G.BP_ID,'') ILIKE ?"
                        " OR COALESCE(BPC.FULL_NAME,'') ILIKE ?"
                        " OR COALESCE(BPV.VEND_NAME,'') ILIKE ?"
                        " OR COALESCE(BPC.CUST_ID::VARCHAR,'') ILIKE ?"
                        " OR COALESCE(BPV.VEND_CODE,'') ILIKE ?)")
            p += [f"%{term}%"] * 5
        w += " AND (" + " OR ".join(alts) + ")"
    w += _category_filter(journal_category)
    if search and search.strip():
        pat = f"%{search.strip()}%"
        w += (" AND (COALESCE(G.SRC_DOC_NO,'') ILIKE ?"
              " OR COALESCE(G.GL_DOC_NO,'') ILIKE ?"
              " OR COALESCE(G.SRC_DOC_TYPE,'') ILIKE ?"
              " OR COALESCE(G.ACCOUNT_CODE,'') ILIKE ?"
              " OR COALESCE(G.BP_ID,'') ILIKE ?"
              " OR COALESCE(BPC.FULL_NAME,'') ILIKE ?"
              " OR COALESCE(BPV.VEND_NAME,'') ILIKE ?"
              " OR COALESCE(S.STORE_NAME,'') ILIKE ?)")
        p += [pat] * 8
    return w, p


# ── Journal (master grid) ────────────────────────────────────────────────────

@router.get("/api/accounting/journal")
def gl_journal(
    date_from: date = Query(...),
    date_to:   date = Query(...),
    stores:       Optional[str] = Depends(scoped_stores),
    subsidiaries: Optional[str] = Depends(scoped_subsidiaries),
    account:  Optional[str] = Query(None),   # comma-separated account codes
    doc_type: Optional[str] = Query(None),   # comma-separated SRC_DOC_TYPEs
    doc_no:   Optional[str] = Query(None),
    bp:       Optional[str] = Query(None),      # fuzzy: typed free text
    bp_id:    Optional[str] = Query(None),      # exact: '|'-joined BP_ID SIDs
    journal_category: Optional[str] = Query(None),  # 'payment'|'transaction'|'entry'|all
    date_basis: str = Query(DEFAULT_DATE_BASIS),    # 'transaction' | 'posting'
    include_unbalanced: bool = Query(False),
    search:   str = Query(""),
    limit:    Optional[int] = Query(None, ge=1, le=1000000),
    offset:   int = Query(0, ge=0),
):
    """One row per JOURNAL = (balance-unit key, SRC_DOC_TYPE), where the key is
    COALESCE(SRC_DOC_SID, GL_DOC_SID) — the source document for poster
    journals, the GL document itself for manual entries. is_balanced is the
    balance-unit's flag, so several journals of one source document share it,
    while each manual entry carries its own."""
    if _gl_off():
        return {"total": 0, "rows": [], "unavailable": True, "reason": _gl_reason()}
    dcol = _date_col(date_basis)
    where = (f"{dcol} BETWEEN {_dt(date_from)} AND {_dt(date_to)}")
    scf, params = _scope(stores, subsidiaries)
    where += scf
    slf, slp = _slicers(account, doc_type, doc_no, bp, search, journal_category,
                        bp_id=bp_id)
    where += slf; params += slp
    where += _balanced(include_unbalanced)

    base = f"""
        {_FROM_BP}
        LEFT JOIN FACT_GL_DOC GD ON GD.SRC_DOC_SID = {_doc_key()}
        WHERE {where}
        GROUP BY {_doc_key()}, G.SRC_DOC_TYPE
    """
    total = _q(f"SELECT COUNT(*) FROM (SELECT 1 {base})", params)[0][0]
    lim = f"LIMIT {int(limit)} OFFSET {int(offset)}" if limit else (
        f"OFFSET {int(offset)}" if offset else "")
    rows = _qdf(f"""
        SELECT MIN(G.POST_DATE)::VARCHAR        AS post_date,
               MIN(G.GL_POST_DATE)::VARCHAR     AS gl_post_date,
               -- The balance-unit key, NOT the raw column: manual entries have
               -- no SRC_DOC_SID, and this value is what the lines drill sends
               -- back, so it must be non-NULL and match the lines filter.
               {_doc_key()}::VARCHAR            AS src_doc_sid,
               MAX(G.SRC_DOC_NO)                AS src_doc_no,
               G.SRC_DOC_TYPE                   AS src_doc_type,
               MAX({_CATEGORY})                 AS journal_category,
               MAX(G.GL_DOC_NO)                 AS gl_doc_no,
               MAX(S.STORE_NAME)                AS store_name,
               -- bp_id stays the raw SID: it is the unique key and the value
               -- any drill-through / exact filter must carry. bp_name is what
               -- the grid displays.
               MAX(G.BP_ID)                     AS bp_id,
               MAX({_BP_NAME})                  AS bp_name,
               MAX({_BP_CODE})                  AS bp_code,
               COUNT(*)                         AS lines,
               ROUND(SUM(G.DEBIT), 2)           AS debit,
               ROUND(SUM(G.CREDIT), 2)          AS credit,
               ROUND(SUM(G.AMOUNT), 2)          AS net,
               BOOL_AND(COALESCE(GD.IS_BALANCED, FALSE)) AS is_balanced
        {base}
        ORDER BY MIN({dcol}) DESC, MAX(G.SRC_DOC_NO), G.SRC_DOC_TYPE
        {lim}
    """, params)
    return {"total": int(total), "rows": rows}


# ── Journal lines (detail grid / drill-through) ──────────────────────────────

@router.get("/api/accounting/journal/lines")
def gl_journal_lines(
    date_from: date = Query(...),
    date_to:   date = Query(...),
    stores:       Optional[str] = Depends(scoped_stores),
    subsidiaries: Optional[str] = Depends(scoped_subsidiaries),
    src_doc_sid: Optional[str] = Query(None),   # '|'-joined list (drill-through)
    account:  Optional[str] = Query(None),
    doc_type: Optional[str] = Query(None),
    doc_no:   Optional[str] = Query(None),
    bp:       Optional[str] = Query(None),      # fuzzy: typed free text
    bp_id:    Optional[str] = Query(None),      # exact: '|'-joined BP_ID SIDs
    journal_category: Optional[str] = Query(None),  # 'payment'|'transaction'|'entry'|all
    date_basis: str = Query(DEFAULT_DATE_BASIS),    # 'transaction' | 'posting'
    include_unbalanced: bool = Query(False),
    search:   str = Query(""),
    # No implicit cap unless the caller asks — matches the other detail grids.
    limit:    Optional[int] = Query(None, ge=1, le=1000000),
):
    if _gl_off():
        return []
    dcol = _date_col(date_basis)
    where = (f"{dcol} BETWEEN {_dt(date_from)} AND {_dt(date_to)}")
    scf, params = _scope(stores, subsidiaries)
    where += scf
    # Drill by document id. Compared as VARCHAR: the SID is a BIGINT that loses
    # precision as a JSON number, so the frontend carries it as a string.
    # Matched on the balance-unit key (_doc_key) because that is what the
    # journal master emits as src_doc_sid — for a manual entry it is the GL
    # document's own SID, and the raw SRC_DOC_SID column would never match.
    sids = [t.strip() for t in (src_doc_sid or "").split("|") if t.strip()]
    if sids:
        where += f" AND {_doc_key()}::VARCHAR IN (" + ",".join(["?"] * len(sids)) + ")"
        params += sids
    slf, slp = _slicers(account, doc_type, doc_no, bp, search, journal_category,
                        bp_id=bp_id)
    where += slf; params += slp
    where += _balanced(include_unbalanced)
    lim = f"LIMIT {int(limit)}" if limit else ""
    return _qdf(f"""
        SELECT G.POST_DATE::VARCHAR             AS post_date,
               G.GL_POST_DATE::VARCHAR          AS gl_post_date,
               {_doc_key()}::VARCHAR            AS src_doc_sid,
               G.SRC_DOC_NO                     AS src_doc_no,
               G.SRC_DOC_TYPE                   AS src_doc_type,
               {_CATEGORY}                      AS journal_category,
               G.ACCOUNT_CODE                   AS account_code,
               COALESCE(A.NAME_EN, G.ACCOUNT_CODE) AS account_name,
               G.BP_ID                          AS bp_id,
               {_BP_NAME}                       AS bp_name,
               {_BP_CODE}                       AS bp_code,
               S.STORE_NAME                     AS store_name,
               ROUND(G.DEBIT, 2)                AS debit,
               ROUND(G.CREDIT, 2)               AS credit,
               ROUND(G.AMOUNT, 2)               AS amount
        {_FROM_BP}
        LEFT JOIN {_ACC} A ON A.ACCOUNT_CODE = G.ACCOUNT_CODE
        WHERE {where}
        ORDER BY {dcol}, G.SRC_DOC_NO, G.SRC_DOC_TYPE, G.GL_LINE_SID
        {lim}
    """, params)


# ── Trial balance ────────────────────────────────────────────────────────────

@router.get("/api/accounting/trial-balance")
def gl_trial_balance(
    date_from: date = Query(...),
    date_to:   date = Query(...),
    stores:       Optional[str] = Depends(scoped_stores),
    subsidiaries: Optional[str] = Depends(scoped_subsidiaries),
    date_basis: str = Query(DEFAULT_DATE_BASIS),    # 'transaction' | 'posting'
    include_unbalanced: bool = Query(False),
    hide_zero: bool = Query(True),
):
    """opening = SUM(AMOUNT) for everything strictly BEFORE date_from;
    debit/credit are the period sums; movement = debit - credit;
    closing = opening + movement.

    On balanced documents the whole report nets to zero — that is the point of
    it, and the reason the balanced-document gate exists.
    """
    if _gl_off():
        return []
    dcol = _date_col(date_basis)
    where = f"{dcol} <= {_dt(date_to)}"
    scf, params = _scope(stores, subsidiaries)
    where += scf
    where += _balanced(include_unbalanced)
    # {dc} is the whitelisted column name, never caller text.
    having = ("" if not hide_zero else """
        HAVING SUM(CASE WHEN {dc} < {df} THEN G.AMOUNT ELSE 0 END) <> 0
            OR SUM(CASE WHEN {dc} >= {df} THEN G.DEBIT  ELSE 0 END) <> 0
            OR SUM(CASE WHEN {dc} >= {df} THEN G.CREDIT ELSE 0 END) <> 0
            OR SUM(G.AMOUNT) <> 0
    """).replace("{df}", _dt(date_from)).replace("{dc}", dcol)
    return _qdf(f"""
        WITH TB AS (
            SELECT G.ACCOUNT_CODE AS ACCOUNT_CODE,
                   SUM(CASE WHEN {dcol} <  {_dt(date_from)} THEN G.AMOUNT ELSE 0 END) AS OPENING,
                   SUM(CASE WHEN {dcol} >= {_dt(date_from)} THEN G.DEBIT  ELSE 0 END) AS DEBIT,
                   SUM(CASE WHEN {dcol} >= {_dt(date_from)} THEN G.CREDIT ELSE 0 END) AS CREDIT
            {_FROM}
            WHERE {where}
            GROUP BY G.ACCOUNT_CODE
            {having}
        )
        SELECT TB.ACCOUNT_CODE                       AS account_code,
               COALESCE(A.NAME_EN, TB.ACCOUNT_CODE)  AS account_name,
               A.NAME_AR                             AS account_name_ar,
               A.ACCOUNT_CLASS                       AS account_class,
               ROUND(TB.OPENING, 2)                  AS opening,
               ROUND(TB.DEBIT, 2)                    AS debit,
               ROUND(TB.CREDIT, 2)                   AS credit,
               ROUND(TB.DEBIT - TB.CREDIT, 2)        AS movement,
               ROUND(TB.OPENING + TB.DEBIT - TB.CREDIT, 2) AS closing
        FROM TB
        LEFT JOIN {_ACC} A ON A.ACCOUNT_CODE = TB.ACCOUNT_CODE
        ORDER BY TB.ACCOUNT_CODE
    """, params)


# ── General ledger (per account, running balance) ────────────────────────────

@router.get("/api/accounting/general-ledger")
def gl_general_ledger(
    date_from: date = Query(...),
    date_to:   date = Query(...),
    stores:       Optional[str] = Depends(scoped_stores),
    subsidiaries: Optional[str] = Depends(scoped_subsidiaries),
    account:  Optional[str] = Query(None),   # comma-separated account codes
    journal_category: Optional[str] = Query(None),  # 'payment'|'transaction'|'entry'|all
    date_basis: str = Query(DEFAULT_DATE_BASIS),    # 'transaction' | 'posting'
    include_unbalanced: bool = Query(False),
    limit:    Optional[int] = Query(None, ge=1, le=1000000),
):
    """Per-account ledger. Each account gets a synthetic 'Opening Balance' row
    dated date_from carrying the pre-window SUM(AMOUNT), so the running balance
    (a window function over the account partition) starts at the right place."""
    if _gl_off():
        return []
    dcol = _date_col(date_basis)
    where = f"{dcol} <= {_dt(date_to)}"
    scf, params = _scope(stores, subsidiaries)
    where += scf
    af, ap = csv_in("G.ACCOUNT_CODE", account)
    where += af; params += ap
    where += _category_filter(journal_category)
    where += _balanced(include_unbalanced)
    lim = f"LIMIT {int(limit)}" if limit else ""
    return _qdf(f"""
        WITH SCOPED AS (
            -- POST_DATE here is the ACTIVE BASIS date: the running balance and
            -- the opening cut must both use the basis the caller chose, or the
            -- opening balance and the period rows disagree about the window.
            SELECT G.ACCOUNT_CODE, {dcol} AS POST_DATE, G.SRC_DOC_NO, G.SRC_DOC_TYPE,
                   {_CATEGORY} AS JOURNAL_CATEGORY,
                   G.BP_ID, {_BP_NAME} AS BP_NAME, {_BP_CODE} AS BP_CODE,
                   S.STORE_NAME, G.DEBIT, G.CREDIT, G.AMOUNT,
                   G.GL_LINE_SID
            {_FROM_BP}
            WHERE {where}
        ),
        OPEN_BAL AS (
            SELECT ACCOUNT_CODE, SUM(AMOUNT) AS AMT FROM SCOPED
            WHERE POST_DATE < {_dt(date_from)}
            GROUP BY ACCOUNT_CODE
        ),
        PERIOD AS (
            SELECT * FROM SCOPED WHERE POST_DATE >= {_dt(date_from)}
        ),
        ACCTS AS (
            SELECT ACCOUNT_CODE FROM OPEN_BAL
            UNION
            SELECT ACCOUNT_CODE FROM PERIOD
        ),
        LEDGER AS (
            SELECT ACC.ACCOUNT_CODE, 0 AS SEQ, {_dt(date_from)} AS POST_DATE,
                   NULL::VARCHAR AS SRC_DOC_NO, 'Opening Balance' AS SRC_DOC_TYPE,
                   NULL::VARCHAR AS JOURNAL_CATEGORY,
                   NULL::VARCHAR AS BP_ID, NULL::VARCHAR AS BP_NAME,
                   NULL::VARCHAR AS BP_CODE, NULL::VARCHAR AS STORE_NAME,
                   0::DECIMAL(18,4) AS DEBIT, 0::DECIMAL(18,4) AS CREDIT,
                   COALESCE(O.AMT, 0)::DECIMAL(18,4) AS AMOUNT,
                   0::BIGINT AS GL_LINE_SID
            FROM ACCTS ACC
            LEFT JOIN OPEN_BAL O ON O.ACCOUNT_CODE IS NOT DISTINCT FROM ACC.ACCOUNT_CODE
            UNION ALL
            SELECT ACCOUNT_CODE, 1, POST_DATE, SRC_DOC_NO, SRC_DOC_TYPE,
                   JOURNAL_CATEGORY, BP_ID, BP_NAME, BP_CODE,
                   STORE_NAME, DEBIT, CREDIT, AMOUNT, GL_LINE_SID
            FROM PERIOD
        )
        SELECT L.ACCOUNT_CODE                        AS account_code,
               COALESCE(A.NAME_EN, L.ACCOUNT_CODE)   AS account_name,
               L.POST_DATE::VARCHAR                  AS post_date,
               L.SRC_DOC_NO                          AS src_doc_no,
               L.SRC_DOC_TYPE                        AS src_doc_type,
               L.JOURNAL_CATEGORY                    AS journal_category,
               L.BP_ID                               AS bp_id,
               L.BP_NAME                             AS bp_name,
               L.BP_CODE                             AS bp_code,
               L.STORE_NAME                          AS store_name,
               ROUND(L.DEBIT, 2)                     AS debit,
               ROUND(L.CREDIT, 2)                    AS credit,
               ROUND(L.AMOUNT, 2)                    AS amount,
               ROUND(SUM(L.AMOUNT) OVER (
                   PARTITION BY L.ACCOUNT_CODE
                   ORDER BY L.SEQ, L.POST_DATE, L.SRC_DOC_NO, L.GL_LINE_SID
                   ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW), 2)
                                                     AS running_balance
        FROM LEDGER L
        LEFT JOIN {_ACC} A ON A.ACCOUNT_CODE = L.ACCOUNT_CODE
        ORDER BY L.ACCOUNT_CODE, L.SEQ, L.POST_DATE, L.SRC_DOC_NO, L.GL_LINE_SID
        {lim}
    """, params)


# ── Exceptions (what the balanced gate hides) ────────────────────────────────

@router.get("/api/accounting/exceptions")
def gl_exceptions(
    date_from: date = Query(...),
    date_to:   date = Query(...),
    stores:       Optional[str] = Depends(scoped_stores),
    subsidiaries: Optional[str] = Depends(scoped_subsidiaries),
    date_basis: str = Query(DEFAULT_DATE_BASIS),    # 'transaction' | 'posting'
    limit:    Optional[int] = Query(None, ge=1, le=1000000),
):
    """Every balance unit that does not net to zero: a SOURCE document across
    all its journals, or a MANUAL entry within its own GL document (the
    src_doc_sid / src_doc_no shown for those are the GL document's own).
    Money is never silently dropped: whatever the default gate excludes from
    the statements shows up here."""
    if _gl_off():
        return []
    # FACT_GL_DOC carries BOTH dates, so the exceptions report windows on the
    # same basis as the statements it explains.
    dcol = _date_col(date_basis, alias="D")
    where = f"{dcol} BETWEEN {_dt(date_from)} AND {_dt(date_to)}"
    scf, params = _scope_doc(stores, subsidiaries)
    where += scf
    where += " AND NOT COALESCE(D.IS_BALANCED, FALSE)"
    lim = f"LIMIT {int(limit)}" if limit else ""
    return _qdf(f"""
        SELECT D.POST_DATE::VARCHAR    AS post_date,
               D.GL_POST_DATE::VARCHAR AS gl_post_date,
               D.SRC_DOC_SID::VARCHAR  AS src_doc_sid,
               D.SRC_DOC_NO            AS src_doc_no,
               S.STORE_NAME            AS store_name,
               D.JOURNALS              AS journals,
               D.LINES                 AS lines,
               ROUND(D.NET, 2)         AS net
        FROM FACT_GL_DOC D
        LEFT JOIN DIM_STORE S ON S.SID = D.STORE_SID
        WHERE {where}
        ORDER BY {dcol} DESC, D.SRC_DOC_NO
        {lim}
    """, params)


# ── Slicer type-ahead search endpoints ───────────────────────────────────────
# Same conventions as /api/sales/journal/search/* : plain `def`, a single bound
# `q`, a small LIMIT, and a flat list of rows for DataSlicer to render.

@router.get("/api/accounting/search/accounts")
def gl_search_accounts(q: str = Query(..., min_length=1, max_length=100)):
    """Chart-of-accounts type-ahead: match code or either name. Collapsed to one
    row per ACCOUNT_CODE (the same de-duplication the reports use)."""
    if _gl_off():
        return []
    pat = f"%{q.strip()}%"
    return _qdf(f"""
        SELECT A.ACCOUNT_CODE AS account_code,
               A.NAME_EN      AS name_en,
               A.NAME_AR      AS name_ar
        FROM {_ACC} A
        WHERE A.ACCOUNT_CODE ILIKE ?
           OR COALESCE(A.NAME_EN, '') ILIKE ?
           OR COALESCE(A.NAME_AR, '') ILIKE ?
        ORDER BY A.ACCOUNT_CODE
        LIMIT 40
    """, [pat, pat, pat])


@router.get("/api/accounting/search/doc-types")
def gl_search_doc_types(q: str = Query("", max_length=100),
                        journal_category: Optional[str] = Query(None)):
    """Source-document types actually present in FACT_GL, with a line count so
    the dropdown shows how common each one is, and the derived Payment /
    Transaction / Entry category of each (MAX() per type: a type is uniform in
    practice — 'P_*' are Payments, NOTE5-less manual lines are all 'Entry').

    `q` is OPTIONAL and defaults to '' = RETURN EVERYTHING. That is what turns
    this from a type-ahead into a real dropdown: the slicer opens with the full
    list of values actually present (there are ~12), so the user picks from what
    exists instead of guessing at a free-text box. Typing still narrows it.

    The list is small and bounded by the data, so LIMIT 200 is a safety net, not
    a paging mechanism."""
    if _gl_off():
        return []
    pat = f"%{(q or '').strip()}%"
    where = "G.SRC_DOC_TYPE IS NOT NULL AND G.SRC_DOC_TYPE ILIKE ?"
    where += _category_filter(journal_category)
    return _qdf(f"""
        SELECT G.SRC_DOC_TYPE AS doc_type,
               MAX({_CATEGORY}) AS journal_category,
               COUNT(*) AS lines
        FROM FACT_GL G
        WHERE {where}
        GROUP BY G.SRC_DOC_TYPE
        ORDER BY G.SRC_DOC_TYPE
        LIMIT 200
    """, [pat])


@router.get("/api/accounting/search/bp")
def gl_search_bp(q: str = Query("", max_length=100),
                 journal_category: Optional[str] = Query(None)):
    """Business partners ACTUALLY PRESENT in FACT_GL, resolved to a name, a
    human code and their Customer / Supplier kind.

    Sourced from FACT_GL, never from DIM_CUSTOMER / DIM_VENDOR wholesale: the
    customer dimension alone runs to tens of thousands of rows, almost none of
    which have any GL activity, so a dropdown built from it would offer the user
    thousands of choices that return an empty grid. The GL's own distinct BP_IDs
    are the only honest option list.

    KIND is derived, exactly as everywhere else in this file, from the journal
    type via _BP_IS_VENDOR: purchases / vouchers point at RPS.VENDOR, and sales,
    returns and every payment journal point at RPS.CUSTOMER. Transfer Slips have
    no BP at all — their NULL BP_ID is excluded here so the dropdown never shows
    a blank row. Both dimension joins stay LEFT: an id that resolves to nothing
    still appears, under its raw SID, instead of vanishing from the list.

    `bp_id` is the SID and the ONLY unique key — it is what the caller sends
    back as the exact `bp_id` filter. `bp_code` (CUST_ID / VEND_CODE) is
    DISPLAY ONLY: CUST_ID is nullable and not unique, so it can never be a key.

    `q` is OPTIONAL and defaults to '' = RETURN EVERYTHING (up to the LIMIT), so
    the slicer works as a real dropdown that opens populated, not only as a
    search box. Typing narrows it against name, code and id alike."""
    if _gl_off():
        return []
    pat = f"%{(q or '').strip()}%"
    where = "G.BP_ID IS NOT NULL AND TRIM(G.BP_ID) <> ''"
    where += _category_filter(journal_category)
    return _qdf(f"""
        WITH BP AS (
            SELECT G.BP_ID AS BP_ID,
                   CASE WHEN {_BP_IS_VENDOR} THEN 'Supplier' ELSE 'Customer' END AS BP_KIND,
                   COUNT(*) AS LINES
            FROM FACT_GL G
            WHERE {where}
            GROUP BY 1, 2
        ),
        RESOLVED AS (
            SELECT BP.BP_ID                                  AS bp_id,
                   BP.BP_KIND                                AS bp_kind,
                   COALESCE(C.FULL_NAME, V.VEND_NAME, BP.BP_ID) AS bp_name,
                   COALESCE(C.CUST_ID::VARCHAR, V.VEND_CODE, '') AS bp_code,
                   BP.LINES                                  AS lines
            FROM BP
            -- TRY_CAST, not a VARCHAR compare: BP_ID is text holding a BIGINT,
            -- and TRY_CAST yields NULL (no match, no error) on the strays.
            LEFT JOIN DIM_CUSTOMER C ON BP.BP_KIND = 'Customer'
                                    AND C.SID = TRY_CAST(BP.BP_ID AS BIGINT)
            LEFT JOIN DIM_VENDOR   V ON BP.BP_KIND = 'Supplier'
                                    AND V.SID = TRY_CAST(BP.BP_ID AS BIGINT)
        )
        SELECT R.bp_id, R.bp_name, R.bp_code, R.bp_kind, R.lines
        FROM RESOLVED R
        WHERE R.bp_name ILIKE ? OR R.bp_code ILIKE ? OR R.bp_id ILIKE ?
        ORDER BY R.lines DESC, R.bp_name
        LIMIT 200
    """, [pat, pat, pat])


# ── Loaded date range ────────────────────────────────────────────────────────

@router.get("/api/accounting/date-range")
def gl_date_range(date_basis: str = Query(DEFAULT_DATE_BASIS)):
    """The GL's OWN loaded span: MIN/MAX of the ACTIVE BASIS column in FACT_GL.

    Basis-aware on purpose: the two bases span different ranges (transaction
    dates run months earlier than the posting run that migrated them), so a
    window derived from one basis can be entirely empty under the other.

    The accounting pages open on this window instead of a rolling last-30-days.
    A general ledger is loaded per accounting period, so "the last 30 days" is
    routinely empty on a perfectly healthy warehouse (e.g. a January period
    viewed in July) — and an empty grid reads as "the sync is broken", which is
    exactly the misleading result we must not show.

    Nulls mean "no window to offer": either the customisation is absent or
    FACT_GL is empty. The caller then keeps its own default and shows the
    normal empty state.
    """
    if _gl_off():
        return {"date_from": None, "date_to": None,
                "unavailable": True, "reason": _gl_reason()}
    dcol = _date_col(date_basis)
    try:
        rows = _qdf(f"""
            SELECT MIN({dcol})::VARCHAR AS date_from,
                   MAX({dcol})::VARCHAR AS date_to
            FROM FACT_GL G
        """)
    except Exception:
        rows = []
    r = rows[0] if rows else {}
    return {"date_from": r.get("date_from"), "date_to": r.get("date_to"),
            "unavailable": False, "reason": ""}


# ── KPI summary ──────────────────────────────────────────────────────────────

@router.get("/api/accounting/summary")
def gl_summary(
    date_from: date = Query(...),
    date_to:   date = Query(...),
    stores:       Optional[str] = Depends(scoped_stores),
    subsidiaries: Optional[str] = Depends(scoped_subsidiaries),
    journal_category: Optional[str] = Query(None),  # 'payment'|'transaction'|'entry'|all
    date_basis: str = Query(DEFAULT_DATE_BASIS),    # 'transaction' | 'posting'
    include_unbalanced: bool = Query(False),
):
    """KPI cards. The headline totals honour the balanced gate; the unbalanced
    figures are always reported so the gap is visible, never hidden."""
    if _gl_off():
        return {
            "total_debit": 0.0, "total_credit": 0.0, "difference": 0.0,
            "unbalanced_net": 0.0, "documents": 0, "journals": 0, "lines": 0,
            "accounts_used": 0, "unbalanced_docs": 0,
            "unavailable": True, "reason": _gl_reason(),
        }
    dcol = _date_col(date_basis)
    where = f"{dcol} BETWEEN {_dt(date_from)} AND {_dt(date_to)}"
    scf, params = _scope(stores, subsidiaries)
    where += scf
    where += _category_filter(journal_category)
    where += _balanced(include_unbalanced)
    r = _qdf(f"""
        SELECT ROUND(SUM(G.DEBIT), 2)  AS total_debit,
               ROUND(SUM(G.CREDIT), 2) AS total_credit,
               ROUND(SUM(G.AMOUNT), 2) AS difference,
               -- Balance-unit key, so manual entries (SRC_DOC_SID NULL) are
               -- counted one per GL document instead of collapsing into a
               -- single NULL bucket / vanishing from the distinct count.
               COUNT(DISTINCT {_doc_key()}) AS documents,
               COUNT(DISTINCT ({_doc_key()}::VARCHAR || '|'
                               || COALESCE(G.SRC_DOC_TYPE, ''))) AS journals,
               COUNT(*) AS lines,
               COUNT(DISTINCT G.ACCOUNT_CODE) AS accounts_used
        {_FROM}
        WHERE {where}
    """, params)
    out = dict(r[0]) if r else {}

    ex_where = (f"{_date_col(date_basis, alias='D')} "
                f"BETWEEN {_dt(date_from)} AND {_dt(date_to)}")
    ex_scf, ex_params = _scope_doc(stores, subsidiaries)
    ex_where += ex_scf + " AND NOT COALESCE(D.IS_BALANCED, FALSE)"
    ex = _qdf(f"""
        SELECT COUNT(*) AS unbalanced_docs, ROUND(SUM(D.NET), 2) AS unbalanced_net
        FROM FACT_GL_DOC D
        LEFT JOIN DIM_STORE S ON S.SID = D.STORE_SID
        WHERE {ex_where}
    """, ex_params)
    out.update(dict(ex[0]) if ex else {})

    for k in ("total_debit", "total_credit", "difference", "unbalanced_net"):
        out[k] = float(out.get(k) or 0)
    for k in ("documents", "journals", "lines", "accounts_used", "unbalanced_docs"):
        out[k] = int(out.get(k) or 0)
    return out


# ═════════════════════════════════════════════════════════════════════════════
# Financial statements — Profit & Loss / Balance Sheet (class-role driven)
# ═════════════════════════════════════════════════════════════════════════════
# DESIGN CONTRACT (agreed with the owner, 2026-07): level 1 of the accounting
# touch-menu tree is fixed in MEANING, free in NAME and COUNT. Every first-
# level branch maps to exactly one of five ROLES; below level 1 the tree is
# fully free. A customer may have 5, 6 or 8 branches, in any language.
#
# ROLE RESOLUTION, in order:
#   1. Stored override  — settings.json -> accounting.class_roles["<class>"].
#      Only overrides are stored; auto-hits are NOT persisted, so improved
#      auto-mapping benefits existing installs with zero migration.
#   2. Auto-map         — common EN/AR class names, case-insensitive, alef
#      variants normalised. Recognised names work with ZERO setup.
#   3. Unmapped         — the class exists but has no role. Its accounts go to
#      the 'Unclassified' section (always last, never dropped) and the UI
#      offers an inline role picker.

_ROLES = ("asset", "liability", "equity", "revenue", "cost")

# The 'Unclassified' bucket's stable section key. The FRONTEND translates it;
# the API always emits the English constant so report params / saved views /
# scheduled grids are language-independent.
_UNCLASSIFIED = "Unclassified"
_UNCLASSIFIED_SEQ = 999999      # sorts after every real section, always


def _norm_class(name: str) -> str:
    """Casefolded, whitespace-collapsed, alef-normalised key for matching a
    class name against the auto-map and the stored overrides. Never shown."""
    s = " ".join((name or "").split()).casefold()
    for ch in "أإآ":
        s = s.replace(ch, "ا")
    return s


# Common first-level branch names → role. Keys are _norm_class()-ed.
_AUTO_ROLE: Dict[str, str] = {}
for _role, _names in (
    ("asset",     ["assets", "asset", "الأصول", "الاصول"]),
    ("liability", ["liabilities", "liability", "الالتزامات", "الخصوم"]),
    ("equity",    ["equity", "حقوق الملكية", "راس المال", "رأس المال"]),
    ("revenue",   ["sales", "revenue", "income",
                   "المبيعات", "الإيرادات", "الايرادات"]),
    ("cost",      ["purchases", "expenses", "cost of sales", "cogs",
                   "المشتريات", "المصروفات", "التكاليف"]),
):
    for _n in _names:
        _AUTO_ROLE[_norm_class(_n)] = _role


def _stored_class_roles() -> Dict[str, str]:
    """Admin overrides from settings.json, whitelisted on read as well as on
    write — a hand-edited settings file must not inject an unknown role."""
    try:
        from services.config import load_settings
        raw = (load_settings().get("accounting") or {}).get("class_roles") or {}
    except Exception:
        raw = {}
    return {str(k): v for k, v in raw.items()
            if isinstance(v, str) and v in _ROLES}


def resolve_class_role(account_class) -> tuple:
    """(role | None, source) for a class name.
    source: 'override' | 'auto' | 'unmapped'. NULL/blank class → unmapped."""
    if account_class is None or not str(account_class).strip():
        return None, "unmapped"
    key = _norm_class(str(account_class))
    for cls, role in _stored_class_roles().items():
        if _norm_class(cls) == key:
            return role, "override"
    role = _AUTO_ROLE.get(key)
    if role:
        return role, "auto"
    return None, "unmapped"


# DIM_ACCOUNT collapsed per ACCOUNT_CODE — same de-duplication rationale as
# _ACC, extended with the statement columns (group + section order).
_ACC_STMT = """(SELECT ACCOUNT_CODE,
                       MAX(NAME_EN)       AS NAME_EN,
                       MAX(NAME_AR)       AS NAME_AR,
                       MAX(ACCOUNT_CLASS) AS ACCOUNT_CLASS,
                       MAX(ACCOUNT_GROUP) AS ACCOUNT_GROUP,
                       MIN(CLASS_SEQ)     AS CLASS_SEQ
                FROM DIM_ACCOUNT
                WHERE ACCOUNT_CODE IS NOT NULL
                GROUP BY ACCOUNT_CODE)"""


def _class_seq_map() -> dict:
    """class name -> tree order (small int from the level-1 branch order,
    compressed at sync time into DIM_ACCOUNT.CLASS_SEQ). Classes the sync has
    not ordered yet (pre-v7 warehouse) get None → callers sort them after the
    ordered ones, alphabetically."""
    try:
        rows = _qdf("""
            SELECT ACCOUNT_CLASS AS cls, MIN(CLASS_SEQ) AS seq
            FROM DIM_ACCOUNT
            WHERE ACCOUNT_CLASS IS NOT NULL
            GROUP BY ACCOUNT_CLASS
        """)
    except Exception:
        rows = []
    return {r["cls"]: r["seq"] for r in rows}


def _section_seq(cls, seq_map: dict) -> int:
    """Concrete sort key for a class: its tree order when known, else a large
    band that still sorts deterministically (alphabetical within the band)."""
    seq = seq_map.get(cls)
    if seq is not None:
        return int(seq)
    # Unordered but mapped classes sort after ordered ones, before Unclassified.
    ordered = sorted(k for k, v in seq_map.items() if v is None)
    try:
        return 1000 + ordered.index(cls)
    except ValueError:
        return 1000


# ── Class → role mapping (GET public with reports; PUT admin) ────────────────

@router.get("/api/accounting/class-roles")
def gl_class_roles():
    """Every DISTINCT ACCOUNT_CLASS present in DIM_ACCOUNT with its resolved
    role, where the role came from, and how many accounts carry the class —
    the UI shows what is resolved and offers a picker for what is not."""
    if _gl_off():
        return []
    rows = _qdf("""
        SELECT ACCOUNT_CLASS AS cls, MIN(CLASS_SEQ) AS seq, COUNT(*) AS accounts
        FROM DIM_ACCOUNT
        WHERE ACCOUNT_CLASS IS NOT NULL
        GROUP BY ACCOUNT_CLASS
        ORDER BY (MIN(CLASS_SEQ) IS NULL), MIN(CLASS_SEQ), ACCOUNT_CLASS
    """)
    out = []
    for r in rows:
        role, source = resolve_class_role(r["cls"])
        out.append({"class": r["cls"], "role": role, "source": source,
                    "section_seq": r["seq"], "accounts": int(r["accounts"] or 0)})
    return out


# Admin gate for the override PUT — same dependency Settings uses. Imported
# here (module level, like routers/settings.py) so Depends() sees the real
# callable; routers.auth has no import back into this module.
from routers.auth import require_admin as _require_admin  # noqa: E402


class ClassRolesPut(BaseModel):
    # {"<class text>": "asset|liability|equity|revenue|cost"} — upserted into
    # settings.json -> accounting.class_roles. An empty string / null value
    # REMOVES the override (the class falls back to auto / unmapped).
    class_roles: Dict[str, Optional[str]]


@router.put("/api/accounting/class-roles")
def gl_put_class_roles(payload: ClassRolesPut, _admin: dict = Depends(_require_admin)):
    from services.config import load_settings, save_settings
    bad = {k: v for k, v in payload.class_roles.items() if v and v not in _ROLES}
    if bad:
        raise HTTPException(status_code=422,
                            detail=f"Unknown role(s) {sorted(set(bad.values()))} — "
                                   f"expected one of {list(_ROLES)}")
    current = load_settings()
    acct = current.setdefault("accounting", {})
    stored = acct.setdefault("class_roles", {})
    changed = []
    for cls, role in payload.class_roles.items():
        cls = str(cls).strip()
        if not cls:
            continue
        if role:
            stored[cls] = role
            changed.append(f"{cls}={role}")
        else:
            # remove any stored key that normalises to the same class
            for k in [k for k in stored if _norm_class(k) == _norm_class(cls)]:
                stored.pop(k, None)
            changed.append(f"{cls}=<cleared>")
    save_settings(current)
    record_audit(_admin["username"], "class_roles_saved", ", ".join(changed)[:500])
    return {"ok": True, "class_roles": stored}


# ── Accounting settings (Settings → Accounting) ──────────────────────────────
# Persisted in settings.json -> accounting, next to class_roles:
#   receivable_accounts / payable_accounts — the account codes whose lines ARE
#     a partner's receivable / payable balance. Used by /aging (see gl_aging):
#     on the real data payment journals stamp the customer BP on BOTH lines,
#     so filtering by class-ROLE nets payments to zero and overstates balances;
#     filtering by the configured ACCOUNT list is the correct measure.
#   default_date_basis / default_include_unbalanced — the INITIAL state the
#     accounting pages open with (drill-through URL params still win).
#
# Defaults: when the key has NEVER been stored the documented default account
# lists apply; an EXPLICITLY saved empty list means "no account filter" and
# /aging falls back to the legacy role-based behaviour.

DEFAULT_RECEIVABLE_ACCOUNTS = ["1220.01"]
DEFAULT_PAYABLE_ACCOUNTS    = ["3100.01"]


def _partner_account_codes(ar: bool) -> list:
    """The effective receivable (ar=True) / payable account-code list.
    Missing key → the documented default; stored empty list → [] (role
    fallback); anything malformed degrades to the default."""
    default = DEFAULT_RECEIVABLE_ACCOUNTS if ar else DEFAULT_PAYABLE_ACCOUNTS
    try:
        from services.config import load_settings
        acct = load_settings().get("accounting") or {}
    except Exception:
        return list(default)
    raw = acct.get("receivable_accounts" if ar else "payable_accounts")
    if raw is None:
        return list(default)
    if not isinstance(raw, list):
        return list(default)
    return [str(x).strip() for x in raw if str(x).strip()]


class AccountingSettingsPut(BaseModel):
    # All optional — omitted fields stay unchanged. Lists are stored as sent
    # (deduplicated, blanks dropped); an empty list is a valid explicit value.
    receivable_accounts: Optional[list] = None
    payable_accounts:    Optional[list] = None
    default_date_basis:  Optional[str] = None    # 'transaction' | 'posting'
    default_include_unbalanced: Optional[bool] = None


def _clean_codes(raw: list) -> list:
    out, seen = [], set()
    for x in raw[:200]:                      # sanity cap, not a paging scheme
        s = str(x).strip()[:40]
        if s and s not in seen:
            seen.add(s)
            out.append(s)
    return out


@router.put("/api/accounting/settings")
def gl_put_settings(payload: AccountingSettingsPut,
                    _admin: dict = Depends(_require_admin)):
    from services.config import load_settings, save_settings
    if payload.default_date_basis is not None \
            and payload.default_date_basis not in _DATE_BASIS:
        raise HTTPException(status_code=422,
                            detail=f"default_date_basis must be one of {list(_DATE_BASIS)}")
    current = load_settings()
    acct = current.setdefault("accounting", {})
    changed = []
    if payload.receivable_accounts is not None:
        acct["receivable_accounts"] = _clean_codes(payload.receivable_accounts)
        changed.append(f"receivable={acct['receivable_accounts']}")
    if payload.payable_accounts is not None:
        acct["payable_accounts"] = _clean_codes(payload.payable_accounts)
        changed.append(f"payable={acct['payable_accounts']}")
    if payload.default_date_basis is not None:
        acct["default_date_basis"] = payload.default_date_basis
        changed.append(f"date_basis={payload.default_date_basis}")
    if payload.default_include_unbalanced is not None:
        acct["default_include_unbalanced"] = bool(payload.default_include_unbalanced)
        changed.append(f"include_unbalanced={acct['default_include_unbalanced']}")
    save_settings(current)
    record_audit(_admin["username"], "accounting_settings_saved",
                 ", ".join(changed)[:500])
    return {"ok": True, "accounting": {
        "receivable_accounts": _partner_account_codes(True),
        "payable_accounts":    _partner_account_codes(False),
        "default_date_basis":  acct.get("default_date_basis", DEFAULT_DATE_BASIS),
        "default_include_unbalanced": bool(acct.get("default_include_unbalanced", False)),
    }}


@router.get("/api/accounting/status")
def gl_status():
    """Small status block for Settings → Accounting: GL size, loaded span,
    account classification counts, last accounting sync, and the EFFECTIVE
    receivable / payable account lists (after defaults) so the UI never has
    to duplicate the backend's default constants."""
    out = {
        "unavailable": _gl_off(),
        "reason": _gl_reason() if _gl_off() else "",
        "gl_rows": 0, "documents": 0, "date_from": None, "date_to": None,
        "accounts": 0, "classified_accounts": 0, "unclassified_accounts": 0,
        "unmapped_classes": 0, "last_sync": None,
        "receivable_accounts": _partner_account_codes(True),
        "payable_accounts":    _partner_account_codes(False),
    }
    if _gl_off():
        return out
    try:
        r = _qdf("""
            SELECT COUNT(*) AS n,
                   COUNT(DISTINCT COALESCE(SRC_DOC_SID, GL_DOC_SID)) AS docs,
                   MIN(POST_DATE)::VARCHAR AS dfrom,
                   MAX(POST_DATE)::VARCHAR AS dto
            FROM FACT_GL G
        """)[0]
        out["gl_rows"]   = int(r["n"] or 0)
        out["documents"] = int(r["docs"] or 0)
        out["date_from"], out["date_to"] = r["dfrom"], r["dto"]
    except Exception:
        pass
    # Classification: one row per ACCOUNT_CODE (the reports' own granularity).
    # An account is classified when its class resolves to a role.
    try:
        rows = _qdf(f"""
            SELECT ACCOUNT_CLASS AS cls, COUNT(*) AS accounts
            FROM {_ACC} A
            GROUP BY ACCOUNT_CLASS
        """)
        total = classified = unmapped_classes = 0
        for r in rows:
            n = int(r["accounts"] or 0)
            total += n
            role, _src = resolve_class_role(r["cls"])
            if role:
                classified += n
            elif r["cls"] is not None:
                unmapped_classes += 1
        out["accounts"] = total
        out["classified_accounts"] = classified
        out["unclassified_accounts"] = total - classified
        out["unmapped_classes"] = unmapped_classes
    except Exception:
        pass
    try:
        rows = _qdf("""
            SELECT MAX(finished_at)::VARCHAR AS t
            FROM SYNC_RUN
            WHERE status = 'completed'
              AND (domains IS NULL OR domains = '' OR domains LIKE '%accounting%')
        """)
        out["last_sync"] = rows[0]["t"] if rows else None
    except Exception:
        pass
    return out


# ── Profit & Loss ────────────────────────────────────────────────────────────

@router.get("/api/accounting/profit-loss")
def gl_profit_loss(
    date_from: date = Query(...),
    date_to:   date = Query(...),
    stores:       Optional[str] = Depends(scoped_stores),
    subsidiaries: Optional[str] = Depends(scoped_subsidiaries),
    date_basis: str = Query(DEFAULT_DATE_BASIS),    # 'transaction' | 'posting'
    include_unbalanced: bool = Query(False),
):
    """One row per account WITH ACTIVITY in the window whose class role is
    revenue or cost — plus, never dropped, every active account whose class is
    NULL or unmapped, in the 'Unclassified' section (always last).

    SIGN CONVENTION: revenue is positive when CREDIT (-SUM(AMOUNT)), costs are
    positive when DEBIT (+SUM(AMOUNT)), so every displayed figure is naturally
    positive and net profit = revenue − costs. Unclassified rows keep the raw
    signed movement (debit positive) — no role, no sign guess.

    PURE ROWS: no synthetic subtotal lines. The page computes section
    subtotals, gross profit and net profit; `section_seq` (the level-1 branch
    order persisted at sync time into DIM_ACCOUNT.CLASS_SEQ) tells it the
    customer's own section order. Balance-sheet-role accounts (asset/
    liability/equity) are excluded — they belong to /balance-sheet."""
    if _gl_off():
        return []
    dcol = _date_col(date_basis)
    where = f"{dcol} BETWEEN {_dt(date_from)} AND {_dt(date_to)}"
    scf, params = _scope(stores, subsidiaries)
    where += scf
    where += _balanced(include_unbalanced)
    rows = _qdf(f"""
        SELECT G.ACCOUNT_CODE                       AS account_code,
               COALESCE(A.NAME_EN, G.ACCOUNT_CODE)  AS account_name,
               A.NAME_AR                            AS account_name_ar,
               A.ACCOUNT_CLASS                      AS account_class,
               A.ACCOUNT_GROUP                      AS account_group,
               SUM(G.AMOUNT)                        AS amt
        {_FROM}
        LEFT JOIN {_ACC_STMT} A ON A.ACCOUNT_CODE = G.ACCOUNT_CODE
        WHERE {where}
        GROUP BY 1, 2, 3, 4, 5
        ORDER BY G.ACCOUNT_CODE
    """, params)
    seq_map = _class_seq_map()
    out = []
    for r in rows:
        role, _src = resolve_class_role(r["account_class"])
        amt = float(r["amt"] or 0)
        if role == "revenue":
            section, seq, amount = r["account_class"], _section_seq(r["account_class"], seq_map), -amt
        elif role == "cost":
            section, seq, amount = r["account_class"], _section_seq(r["account_class"], seq_map), amt
        elif role in ("asset", "liability", "equity"):
            continue                            # balance-sheet account — not P&L
        else:
            # NULL or unmapped class: NEVER dropped. Raw signed movement.
            section, seq, amount, role = _UNCLASSIFIED, _UNCLASSIFIED_SEQ, amt, None
        out.append({
            "section":       section,
            "section_seq":   seq,
            "role":          role,
            "group":         r["account_group"],
            "account_code":  r["account_code"],
            "account_name":  r["account_name"],
            "account_name_ar": r["account_name_ar"],
            "amount":        round(amount, 2),
        })
    out.sort(key=lambda x: (x["section_seq"], x["section"] or "",
                            x["group"] or "", x["account_code"] or ""))
    return out


# ── Balance Sheet ────────────────────────────────────────────────────────────

@router.get("/api/accounting/balance-sheet")
def gl_balance_sheet(
    as_of: date = Query(...),
    stores:       Optional[str] = Depends(scoped_stores),
    subsidiaries: Optional[str] = Depends(scoped_subsidiaries),
    date_basis: str = Query(DEFAULT_DATE_BASIS),    # 'transaction' | 'posting'
    include_unbalanced: bool = Query(False),
):
    """One row per account with a NON-ZERO cumulative balance up to and
    including `as_of`, for classes whose role is asset / liability / equity —
    plus 'Unclassified' rows (never dropped), PLUS one synthetic row:

        Current period result = the cumulative net P&L (revenue − cost roles)
        to `as_of`, shown under the customer's equity class (or 'Equity').

    That synthetic row is what makes the sheet balance: there is no
    retained-earnings posting in the source books yet, so without it total
    assets could never equal liabilities + equity. It is marked
    `synthetic: true` and the page renders it as computed, not posted.

    SIGN CONVENTION: assets positive when DEBIT (+SUM(AMOUNT)); liabilities
    and equity positive when CREDIT (-SUM(AMOUNT)). Unclassified rows keep the
    raw signed balance (debit positive) so the page can show the imbalance
    honestly — never hidden."""
    if _gl_off():
        return []
    dcol = _date_col(date_basis)
    where = f"{dcol} <= {_dt(as_of)}"
    scf, params = _scope(stores, subsidiaries)
    where += scf
    where += _balanced(include_unbalanced)
    rows = _qdf(f"""
        SELECT G.ACCOUNT_CODE                       AS account_code,
               COALESCE(A.NAME_EN, G.ACCOUNT_CODE)  AS account_name,
               A.NAME_AR                            AS account_name_ar,
               A.ACCOUNT_CLASS                      AS account_class,
               A.ACCOUNT_GROUP                      AS account_group,
               SUM(G.AMOUNT)                        AS amt
        {_FROM}
        LEFT JOIN {_ACC_STMT} A ON A.ACCOUNT_CODE = G.ACCOUNT_CODE
        WHERE {where}
        GROUP BY 1, 2, 3, 4, 5
        HAVING ROUND(SUM(G.AMOUNT), 2) <> 0
        ORDER BY G.ACCOUNT_CODE
    """, params)
    seq_map = _class_seq_map()
    _ROLE_RANK = {"asset": 0, "liability": 1, "equity": 2, None: 3}
    out, net_pl = [], 0.0
    for r in rows:
        role, _src = resolve_class_role(r["account_class"])
        amt = float(r["amt"] or 0)
        if role == "asset":
            section, seq, balance = r["account_class"], _section_seq(r["account_class"], seq_map), amt
        elif role in ("liability", "equity"):
            section, seq, balance = r["account_class"], _section_seq(r["account_class"], seq_map), -amt
        elif role in ("revenue", "cost"):
            net_pl += amt                       # rolls into Current period result
            continue
        else:
            section, seq, balance, role = _UNCLASSIFIED, _UNCLASSIFIED_SEQ, amt, None
        out.append({
            "section":       section,
            "section_seq":   seq,
            "role":          role,
            "group":         r["account_group"],
            "account_code":  r["account_code"],
            "account_name":  r["account_name"],
            "account_name_ar": r["account_name_ar"],
            "balance":       round(balance, 2),
            "synthetic":     False,
        })
    # Current period result: net P&L positive when CREDIT (a profit grows
    # equity), i.e. -(sum of revenue+cost movements, debit positive).
    result = round(-net_pl, 2)
    if abs(result) >= 0.005:
        eq_classes = [(cls, _section_seq(cls, seq_map)) for cls in seq_map
                      if resolve_class_role(cls)[0] == "equity"]
        eq_classes.sort(key=lambda x: x[1])
        eq_name, eq_seq = (eq_classes[0] if eq_classes else ("Equity", 998))
        out.append({
            "section":       eq_name,
            "section_seq":   eq_seq,
            "role":          "equity",
            "group":         None,
            "account_code":  "—",
            "account_name":  "Current period result",
            "account_name_ar": None,
            "balance":       result,
            "synthetic":     True,
        })
    out.sort(key=lambda x: (_ROLE_RANK.get(x["role"], 3), x["section_seq"],
                            x["section"] or "", x["group"] or "",
                            x["synthetic"], x["account_code"] or ""))
    return out


# ═════════════════════════════════════════════════════════════════════════════
# Business partner reports — BP Statement (كشف حساب) / AR-AP Aging (أعمار الديون)
# ═════════════════════════════════════════════════════════════════════════════

# ── BP Statement (one partner's ledger with a running balance) ───────────────

@router.get("/api/accounting/bp-statement")
def gl_bp_statement(
    bp_id: str = Query(..., min_length=1, max_length=40),
    date_from: date = Query(...),
    date_to:   date = Query(...),
    stores:       Optional[str] = Depends(scoped_stores),
    subsidiaries: Optional[str] = Depends(scoped_subsidiaries),
    date_basis: str = Query(DEFAULT_DATE_BASIS),    # 'transaction' | 'posting'
    include_unbalanced: bool = Query(False),
    limit:    Optional[int] = Query(None, ge=1, le=1000000),
):
    """ONE business partner's WHOLE GL relationship inside the window: every
    line that carries their BP_ID, whatever the account — AR/AP, sales, tax,
    tender. The statement deliberately does NOT guess which accounts are "the
    receivable": the partner's full activity is the honest كشف حساب, and the
    receivable-only view is what /aging is for.

    Synthetic FIRST row: 'Opening Balance', dated date_from, carrying the
    partner's SUM(AMOUNT) strictly before date_from (all time, same scope and
    gate) so the running balance starts at the right place — the exact
    pattern /general-ledger uses per account. Always emitted, even when 0.00:
    an explicit zero opening is information, not noise.

    `bp_id` is the raw SID, compared as VARCHAR exactly as stored — the only
    unique partner key (CUST_ID is nullable AND non-unique). It travels as a
    string because the SID is a BIGINT that loses precision as a JSON number.
    Guarded for None as well as empty: a scheduled replay (run_grid) calls
    this function directly, bypassing FastAPI's required-param validation."""
    if _gl_off() or not (bp_id or "").strip():
        return []
    dcol = _date_col(date_basis)
    # Window ceiling only — everything earlier feeds the opening balance.
    where = f"{dcol} <= {_dt(date_to)}"
    where += " AND COALESCE(G.BP_ID,'') = ?"
    params: list = [bp_id.strip()]
    scf, sp_ = _scope(stores, subsidiaries)
    where += scf; params += sp_
    where += _balanced(include_unbalanced)
    lim = f"LIMIT {int(limit)}" if limit else ""
    return _qdf(f"""
        WITH SCOPED AS (
            -- POST_DATE is the ACTIVE BASIS date: the opening cut and the
            -- running balance must use the basis the caller chose, or the
            -- opening row and the period rows disagree about the window.
            SELECT {dcol} AS POST_DATE, G.SRC_DOC_NO, G.SRC_DOC_TYPE,
                   {_CATEGORY} AS JOURNAL_CATEGORY,
                   G.ACCOUNT_CODE, G.DEBIT, G.CREDIT, G.AMOUNT, G.GL_LINE_SID
            {_FROM}
            WHERE {where}
        ),
        OPEN_BAL AS (
            SELECT COALESCE(SUM(AMOUNT), 0) AS AMT FROM SCOPED
            WHERE POST_DATE < {_dt(date_from)}
        ),
        LEDGER AS (
            SELECT 0 AS SEQ, {_dt(date_from)} AS POST_DATE,
                   NULL::VARCHAR AS SRC_DOC_NO, 'Opening Balance' AS SRC_DOC_TYPE,
                   NULL::VARCHAR AS JOURNAL_CATEGORY, NULL::VARCHAR AS ACCOUNT_CODE,
                   0::DECIMAL(18,4) AS DEBIT, 0::DECIMAL(18,4) AS CREDIT,
                   O.AMT::DECIMAL(18,4) AS AMOUNT, 0::BIGINT AS GL_LINE_SID
            FROM OPEN_BAL O
            UNION ALL
            SELECT 1, POST_DATE, SRC_DOC_NO, SRC_DOC_TYPE, JOURNAL_CATEGORY,
                   ACCOUNT_CODE, DEBIT, CREDIT, AMOUNT, GL_LINE_SID
            FROM SCOPED
            WHERE POST_DATE >= {_dt(date_from)}
        )
        SELECT L.POST_DATE::VARCHAR                  AS post_date,
               L.SRC_DOC_NO                          AS src_doc_no,
               L.SRC_DOC_TYPE                        AS src_doc_type,
               L.JOURNAL_CATEGORY                    AS journal_category,
               L.ACCOUNT_CODE                        AS account_code,
               COALESCE(A.NAME_EN, L.ACCOUNT_CODE)   AS account_name,
               ROUND(L.DEBIT, 2)                     AS debit,
               ROUND(L.CREDIT, 2)                    AS credit,
               ROUND(L.AMOUNT, 2)                    AS amount,
               ROUND(SUM(L.AMOUNT) OVER (
                   ORDER BY L.SEQ, L.POST_DATE, L.SRC_DOC_NO, L.GL_LINE_SID
                   ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW), 2)
                                                     AS running_balance
        FROM LEDGER L
        LEFT JOIN {_ACC} A ON A.ACCOUNT_CODE = L.ACCOUNT_CODE
        ORDER BY L.SEQ, L.POST_DATE, L.SRC_DOC_NO, L.GL_LINE_SID
        {lim}
    """, params)


# ── AR / AP Aging (balance-based, FIFO against the most recent charges) ──────
# OPEN-ITEM MATCHING DOES NOT EXIST IN THIS GL: the poster clears documents
# through AR/AP without ever linking a payment line to the invoice line it
# pays, and manual entries carry no allocation either. True open-item aging is
# therefore impossible here — this is BALANCE-based aging, the standard
# fallback: the partner's outstanding balance as of `as_of` is allocated FIFO
# against their MOST RECENT charges (newest first), so the residue that lands
# in the old buckets is the part no recent charge can explain. Any balance
# older than every recorded charge (e.g. an opening imbalance) lands in the
# oldest bucket — shown, never dropped.

_AGING_MAX_BUCKETS = 6


def _parse_bucket_edges(buckets: str) -> list:
    """Comma-separated ascending day edges, e.g. '30,60,90'. Validated hard
    (422), not silently defaulted: aging against edges the caller did not ask
    for is a wrong report, which is worse than no report. Empty → default."""
    vals = []
    for tok in (buckets or "").split(","):
        tok = tok.strip()
        if not tok:
            continue
        if not tok.isdigit():
            raise HTTPException(status_code=422,
                                detail=f"buckets: '{tok}' is not a positive integer")
        vals.append(int(tok))
    if not vals:
        return [30, 60, 90]
    if len(vals) > _AGING_MAX_BUCKETS:
        raise HTTPException(status_code=422,
                            detail=f"buckets: at most {_AGING_MAX_BUCKETS} edges")
    if vals[0] <= 0 or any(b <= a for a, b in zip(vals, vals[1:])):
        raise HTTPException(status_code=422,
                            detail="buckets must be strictly increasing positive day counts")
    return vals


def _day(v) -> date:
    """DuckDB hands back datetime.date for a ::DATE column; be tolerant of
    datetime / ISO strings anyway (direct calls, test seeds)."""
    if isinstance(v, datetime):
        return v.date()
    if isinstance(v, date):
        return v
    return date.fromisoformat(str(v)[:10])


@router.get("/api/accounting/aging")
def gl_aging(
    as_of: date = Query(...),
    side: str = Query("ar", pattern="^(ar|ap)$"),
    stores:       Optional[str] = Depends(scoped_stores),
    subsidiaries: Optional[str] = Depends(scoped_subsidiaries),
    date_basis: str = Query(DEFAULT_DATE_BASIS),    # 'transaction' | 'posting'
    include_unbalanced: bool = Query(False),
    buckets: str = Query("30,60,90"),
):
    """One row per partner with an outstanding balance as of `as_of`.

    SIDE (whitelisted, re-checked for direct run_grid calls):
      ar — CUSTOMER-resolving lines (NOT _BP_IS_VENDOR); the partner owes US,
           so a DEBIT balance (+SUM(AMOUNT)) is outstanding, shown positive.
      ap — VENDOR-resolving lines (_BP_IS_VENDOR); WE owe the partner, so a
           CREDIT balance (−SUM(AMOUNT)) is outstanding, shown positive.
    Partners whose balance nets to zero or the other sign are omitted — an
    aging report is a list of what is outstanding, not a partner census (the
    BP Statement shows any partner's full relationship, either sign).

    ACCOUNT FILTER (2026-07-26 — the correctness fix): partner lines are
    filtered to the CONFIGURED receivable / payable account codes
    (settings.json -> accounting.receivable_accounts / payable_accounts;
    defaults 1220.01 / 3100.01, editable in Settings → Accounting). Why not
    the class-ROLE filter this endpoint used before: on the real data the
    payment journals ('P_*') stamp the customer BP on BOTH lines — the tender
    debit AND the AR credit — so as soon as the tender accounts are classified
    as Assets, each payment nets to ZERO inside a role filter and every
    customer balance is overstated by exactly what they already paid. Only
    the AR/AP control accounts measure the true outstanding balance.

    FALLBACK (kept, documented): when the configured list is EMPTY (an admin
    explicitly cleared it), the legacy role-based behaviour applies — lines
    whose class resolves to a role OTHER than the receivable role (asset for
    ar, liability for ap) are excluded, NULL/unmapped classes are kept. The
    same filter feeds both the balance and the charge list, so they can never
    disagree.

    BUCKET COLUMNS (grid-friendly compromise): the response always carries the
    same five keys — current, d1_30, d31_60, d61_90, d90_plus — because AG
    Grid / the report engine need stable field names. 'current' is age 0 (a
    charge dated `as_of` itself); the three middle buckets are shaped by the
    FIRST THREE edges of `buckets`; anything older than the last used edge
    falls into d90_plus. Custom edges therefore recompute the same five
    columns; the headers stay generic. Rounded buckets are reconciled to the
    rounded balance (cent drift pinned on the oldest non-empty bucket) so
    balance == current + d1_30 + d31_60 + d61_90 + d90_plus, always."""
    if _gl_off():
        return []
    if side not in ("ar", "ap"):        # direct (non-HTTP) callers bypass the pattern
        side = "ar"
    edges = _parse_bucket_edges(buckets)
    ar = side == "ar"
    wanted_role = "asset" if ar else "liability"

    dcol = _date_col(date_basis)
    where = f"{dcol} <= {_dt(as_of)}"
    where += " AND G.BP_ID IS NOT NULL AND TRIM(G.BP_ID) <> ''"
    where += f" AND {'NOT ' if ar else ''}{_BP_IS_VENDOR}"
    scf, params = _scope(stores, subsidiaries)
    where += scf
    where += _balanced(include_unbalanced)

    # PRIMARY: the configured AR / AP control-account list (see docstring).
    # FALLBACK (empty list only): the legacy role filter — classes resolved to
    # a DIFFERENT role are excluded; NULL / unmapped classes stay in.
    partner_accounts = _partner_account_codes(ar)
    if partner_accounts:
        ph = ",".join(["?"] * len(partner_accounts))
        where += f" AND G.ACCOUNT_CODE IN ({ph})"
        params += partner_accounts
    else:
        try:
            cls_rows = _qdf("SELECT DISTINCT ACCOUNT_CLASS AS cls FROM DIM_ACCOUNT"
                            " WHERE ACCOUNT_CLASS IS NOT NULL")
        except Exception:
            cls_rows = []
        excluded = [r["cls"] for r in cls_rows
                    if resolve_class_role(r["cls"])[0] not in (None, wanted_role)]
        if excluded:
            ph = ",".join(["?"] * len(excluded))
            where += f" AND (A.ACCOUNT_CLASS IS NULL OR A.ACCOUNT_CLASS NOT IN ({ph}))"
            params += excluded

    # Side-specific fragments. `sign` flips AP balances positive-when-credit;
    # `charge` is the side's debt-increasing movement (AR: debits, AP: credits,
    # both expressed positive). All fixed strings — never caller text.
    if ar:
        dim, name_col, code_col = "DIM_CUSTOMER", "FULL_NAME", "CUST_ID::VARCHAR"
        sign = ""
        charge = "SUM(CASE WHEN G.AMOUNT > 0 THEN G.AMOUNT ELSE 0 END)"
    else:
        dim, name_col, code_col = "DIM_VENDOR", "VEND_NAME", "VEND_CODE"
        sign = "-"
        charge = "SUM(CASE WHEN G.AMOUNT < 0 THEN -G.AMOUNT ELSE 0 END)"

    joins = f"""
        FROM FACT_GL G
        LEFT JOIN DIM_STORE S ON S.SID = G.STORE_SID
        LEFT JOIN {_ACC} A ON A.ACCOUNT_CODE = G.ACCOUNT_CODE
    """

    # 1) Outstanding balance per partner (resolved to a name, LEFT join — an
    #    unresolvable SID still ages under its raw id, never disappears).
    bal_rows = _qdf(f"""
        SELECT G.BP_ID                                    AS bp_id,
               MAX(COALESCE(BP.{name_col}, G.BP_ID))      AS bp_name,
               MAX(COALESCE(BP.{code_col}, ''))           AS bp_code,
               {sign}SUM(G.AMOUNT)                        AS balance
        {joins}
        LEFT JOIN {dim} BP ON BP.SID = TRY_CAST(G.BP_ID AS BIGINT)
        WHERE {where}
        GROUP BY G.BP_ID
        HAVING {sign}SUM(G.AMOUNT) > 0.005
        ORDER BY {sign}SUM(G.AMOUNT) DESC
    """, params)
    if not bal_rows:
        return []

    # 2) The same partners' charges per day (newest first) for the FIFO walk.
    #    Aggregated per (partner, day): same-day charges share a bucket, so
    #    the per-day roll-up allocates identically and moves far fewer rows.
    chg_rows = _qdf(f"""
        SELECT G.BP_ID       AS bp_id,
               {dcol}::DATE  AS post_date,
               {charge}      AS charged
        {joins}
        WHERE {where}
        GROUP BY G.BP_ID, {dcol}::DATE
        HAVING {charge} > 0
        ORDER BY G.BP_ID, {dcol}::DATE DESC
    """, params)
    charges: dict = {}
    for r in chg_rows:
        charges.setdefault(r["bp_id"], []).append((_day(r["post_date"]),
                                                   float(r["charged"] or 0)))

    # 3) Allocate each balance FIFO against the newest charges. Fixed keys —
    #    only the FIRST THREE edges shape the middle buckets (see docstring).
    e1 = edges[0]
    e2 = edges[1] if len(edges) > 1 else None
    e3 = edges[2] if len(edges) > 2 else None

    def bucket_key(age_days: int) -> str:
        if age_days <= 0:
            return "current"
        if age_days <= e1:
            return "d1_30"
        if e2 is not None and age_days <= e2:
            return "d31_60"
        if e3 is not None and age_days <= e3:
            return "d61_90"
        return "d90_plus"

    kind = "Customer" if ar else "Supplier"
    out = []
    for r in bal_rows:
        bal = float(r["balance"] or 0)
        b = {"current": 0.0, "d1_30": 0.0, "d31_60": 0.0,
             "d61_90": 0.0, "d90_plus": 0.0}
        remaining = bal
        for chg_date, amt in charges.get(r["bp_id"], []):     # newest first
            if remaining <= 0:
                break
            take = min(remaining, amt)
            b[bucket_key((as_of - chg_date).days)] += take
            remaining -= take
        if remaining > 0.0:
            # Balance no recorded charge explains (opening imbalance, or a
            # later-reversed payment): oldest bucket, shown — never dropped.
            b["d90_plus"] += remaining
        row = {"bp_id": r["bp_id"], "bp_name": r["bp_name"],
               "bp_code": r["bp_code"], "bp_kind": kind,
               "balance": round(bal, 2)}
        rb = {k: round(v, 2) for k, v in b.items()}
        # Reconcile rounding drift so balance == sum of buckets EXACTLY:
        # the cent lands on the oldest non-empty bucket (else 'current').
        resid = round(row["balance"] - sum(rb.values()), 2)
        if abs(resid) >= 0.005:
            for k in ("d90_plus", "d61_90", "d31_60", "d1_30", "current"):
                if rb[k] or k == "current":
                    rb[k] = round(rb[k] + resid, 2)
                    break
        row.update(rb)
        out.append(row)
    return out
