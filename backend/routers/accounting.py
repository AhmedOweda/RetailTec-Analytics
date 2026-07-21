"""
Accounting Router — the virtual General Ledger (subsidiary 100)
===============================================================
Endpoints:
  GET /api/accounting/journal          — one row per journal (src doc x doc type)
  GET /api/accounting/journal/lines    — GL line detail (drill-through)
  GET /api/accounting/trial-balance    — opening / movement / closing per account
  GET /api/accounting/general-ledger   — per-account ledger with running balance
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
  4. No P&L / Balance Sheet here: those need DIM_ACCOUNT.ACCOUNT_CLASS, which is
     nullable and currently all NULL (the accountant has not classified yet).
  5. TWO date bases, both real and both needed: `date_basis=transaction` (the
     default) windows on FACT_GL.POST_DATE, the period the activity belongs to;
     `date_basis=posting` windows on FACT_GL.GL_POST_DATE, when the books
     received it. They differ by months on production. Whitelisted, never
     interpolated — see _DATE_BASIS / _date_col.
  6. `journal_category` is DERIVED, not stored: SRC_DOC_TYPE LIKE 'P\\_%' means
     a Payment journal (nets to zero by design), anything else is an Entry.
     See _CATEGORY. Filter values go through _JOURNAL_CATEGORIES, a whitelist.
  7. BP_ID is a raw SID and resolves to two DIFFERENT dimensions by journal
     type — vendor on purchases/vouchers, customer on everything else. Always
     LEFT JOINed so an unresolvable partner shows its id, never disappears.
     See _BP_JOIN / _BP_NAME / _BP_CODE.

Security: all free text is bound (?); only FastAPI-validated dates and ints are
interpolated (EXPERT_REVIEW.md C2). Store/subsidiary scope comes from the JWT
claims via scoped_stores / scoped_subsidiaries (C1), never from raw Query.
"""
from datetime import date
from typing import Optional

from fastapi import APIRouter, Depends, Query

from db.model import feature_available, feature_reason, FEATURE_ACCOUNTING
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


# ── Journal category: Payment vs Entry ───────────────────────────────────────
# Verified against live Oracle: every SRC_DOC_TYPE beginning 'P_' is a PAYMENT
# journal (P_Sale-MADA, P_Sale-Cash, P_Return-Cash, …) and nets to zero; the
# rest (Sale, Return, Purchase, Transfer Slips) are the transaction entries.
#
# DERIVED IN SQL, not stored on FACT_GL. Deliberate: it is a pure function of a
# column we already have, so a stored copy could drift from its source, costs a
# schema change plus a re-sync to populate, and buys nothing — the CASE is free
# next to the scan we already do. Defined ONCE here and reused by every query.
_CATEGORY = ("CASE WHEN G.SRC_DOC_TYPE LIKE 'P\\_%' ESCAPE '\\' "
             "THEN 'Payment' ELSE 'Entry' END")

# Same whitelist discipline as the date basis: a key, never raw SQL. 'all' (or
# anything unrecognised) means no filter.
_JOURNAL_CATEGORIES = {"payment": "Payment", "entry": "Entry"}


def _category_filter(journal_category: Optional[str]) -> str:
    """Whitelisted Payment/Entry filter. Returns '' for all / unknown values."""
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


def _balanced(include_unbalanced: bool, alias: str = "G") -> str:
    """The reporting gate — balanced SOURCE documents only, unless asked."""
    if include_unbalanced:
        return ""
    return (f" AND EXISTS (SELECT 1 FROM FACT_GL_DOC GD"
            f" WHERE GD.SRC_DOC_SID = {alias}.SRC_DOC_SID AND GD.IS_BALANCED)")


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

    FACT_GL_DOC deliberately has no SUBSIDIARY_SID — it is a per-source-document
    roll-up keyed on SRC_DOC_SID. The subsidiary of a document is the subsidiary
    of its GL lines, so we test that with EXISTS against FACT_GL rather than
    routing through DIM_STORE (which is NULL, see _scope)."""
    sf, sp = store_filter(stores, alias="S")
    vals = [s.strip() for s in (subsidiaries or "").split(",") if s.strip()]
    if not vals:
        return sf, sp
    ph = ",".join(["?"] * len(vals))
    subf = (f" AND EXISTS (SELECT 1 FROM FACT_GL GS"
            f" WHERE GS.SRC_DOC_SID = {alias}.SRC_DOC_SID"
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
    journal_category: Optional[str] = Query(None),  # 'payment' | 'entry' | all
    date_basis: str = Query(DEFAULT_DATE_BASIS),    # 'transaction' | 'posting'
    include_unbalanced: bool = Query(False),
    search:   str = Query(""),
    limit:    Optional[int] = Query(None, ge=1, le=1000000),
    offset:   int = Query(0, ge=0),
):
    """One row per JOURNAL = (SRC_DOC_SID, SRC_DOC_TYPE). is_balanced is the
    SOURCE document's flag, so several journals of one document share it."""
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
        LEFT JOIN FACT_GL_DOC GD ON GD.SRC_DOC_SID = G.SRC_DOC_SID
        WHERE {where}
        GROUP BY G.SRC_DOC_SID, G.SRC_DOC_TYPE
    """
    total = _q(f"SELECT COUNT(*) FROM (SELECT 1 {base})", params)[0][0]
    lim = f"LIMIT {int(limit)} OFFSET {int(offset)}" if limit else (
        f"OFFSET {int(offset)}" if offset else "")
    rows = _qdf(f"""
        SELECT MIN(G.POST_DATE)::VARCHAR        AS post_date,
               MIN(G.GL_POST_DATE)::VARCHAR     AS gl_post_date,
               G.SRC_DOC_SID::VARCHAR           AS src_doc_sid,
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
    journal_category: Optional[str] = Query(None),  # 'payment' | 'entry' | all
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
    sids = [t.strip() for t in (src_doc_sid or "").split("|") if t.strip()]
    if sids:
        where += " AND G.SRC_DOC_SID::VARCHAR IN (" + ",".join(["?"] * len(sids)) + ")"
        params += sids
    slf, slp = _slicers(account, doc_type, doc_no, bp, search, journal_category,
                        bp_id=bp_id)
    where += slf; params += slp
    where += _balanced(include_unbalanced)
    lim = f"LIMIT {int(limit)}" if limit else ""
    return _qdf(f"""
        SELECT G.POST_DATE::VARCHAR             AS post_date,
               G.GL_POST_DATE::VARCHAR          AS gl_post_date,
               G.SRC_DOC_SID::VARCHAR           AS src_doc_sid,
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
    journal_category: Optional[str] = Query(None),  # 'payment' | 'entry' | all
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
    """Every SOURCE document that does not net to zero across all its journals.
    Money is never silently dropped: whatever the default gate excludes from the
    statements shows up here."""
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
    the dropdown shows how common each one is, and the derived Payment/Entry
    category of each.

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
    journal_category: Optional[str] = Query(None),  # 'payment' | 'entry' | all
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
               COUNT(DISTINCT G.SRC_DOC_SID) AS documents,
               COUNT(DISTINCT (G.SRC_DOC_SID::VARCHAR || '|'
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
