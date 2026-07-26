# Seeded-DuckDB verification for the /aging account-list fix (2026-07-26).
# Pattern follows tools/_test_statements.py.
#
# Scenario (mirrors the REAL data): payment journals ('P_*') stamp the
# customer BP on BOTH lines — the tender debit AND the AR credit. Once the
# tender accounts are classified as Assets, the OLD class-role filter keeps
# both payment lines, they net to ZERO, and the balance is overstated by
# exactly what the customer already paid. The NEW filter measures only the
# configured receivable accounts (default 1220.01) and returns the truth.
#
# Run: python tools\_test_aging.py   (from backend/)
import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from datetime import date
import duckdb

con = duckdb.connect(":memory:")
con.execute("""CREATE TABLE DIM_ACCOUNT (SID BIGINT, ACCOUNT_CODE VARCHAR,
    ACCOUNT_KEY VARCHAR, NAME_EN VARCHAR, NAME_AR VARCHAR,
    ACCOUNT_CLASS VARCHAR, ACCOUNT_GROUP VARCHAR, CLASS_SEQ INTEGER)""")
con.execute("""CREATE TABLE DIM_STORE (SID BIGINT, STORE_NAME VARCHAR)""")
con.execute("""CREATE TABLE DIM_CUSTOMER (SID BIGINT, FULL_NAME VARCHAR,
    CUST_ID BIGINT)""")
con.execute("""CREATE TABLE DIM_VENDOR (SID BIGINT, VEND_NAME VARCHAR,
    VEND_CODE VARCHAR)""")
con.execute("""CREATE TABLE FACT_GL (GL_LINE_SID BIGINT, ACCOUNT_CODE VARCHAR,
    POST_DATE DATE, GL_POST_DATE DATE, AMOUNT DECIMAL(18,4),
    DEBIT DECIMAL(18,4), CREDIT DECIMAL(18,4),
    SRC_DOC_SID BIGINT, GL_DOC_SID BIGINT, SRC_DOC_TYPE VARCHAR,
    SRC_DOC_NO VARCHAR, GL_DOC_NO VARCHAR, BP_ID VARCHAR,
    STORE_SID BIGINT, SUBSIDIARY_SID BIGINT)""")
con.execute("""CREATE TABLE FACT_GL_DOC (SRC_DOC_SID BIGINT, IS_BALANCED BOOLEAN,
    POST_DATE DATE, GL_POST_DATE DATE, STORE_SID BIGINT,
    NET DECIMAL(18,4), JOURNALS INT, LINES INT, SRC_DOC_NO VARCHAR)""")

# Chart of accounts: AR control + a TENDER account, BOTH classed 'Assets' —
# the classification that breaks the old role filter — plus revenue.
ACCTS = [
    (1, '1220.01', 'Trade Receivables', 'Assets', 1),
    (2, '1010',    'Cash on Hand',      'Assets', 1),   # tender — also an Asset
    (3, '4000',    'Store Revenue',     'Sales',  4),
]
for sid, code, name, cls, seq in ACCTS:
    con.execute("INSERT INTO DIM_ACCOUNT VALUES (?,?,?,?,?,?,?,?)",
                [sid, code, code, name, None, cls, None, seq])
con.execute("INSERT INTO DIM_STORE VALUES (1, 'Main Store')")
con.execute("INSERT INTO DIM_CUSTOMER VALUES (501, 'Acme Retail', 9001)")
con.execute("INSERT INTO DIM_CUSTOMER VALUES (502, 'Fully Paid Co', 9002)")

D_INV = date(2026, 1, 5)     # invoices
D_PAY = date(2026, 1, 20)    # payments
AS_OF = date(2026, 1, 31)

# (line, code, amount, doc, type, bp) — BP stamped on BOTH payment lines,
# exactly as verified on the production warehouse.
LINES = [
    # Customer 501: invoice 1000, paid 600 → TRUE outstanding = 400
    (1, '1220.01',  1000, 201, 'Sale',        '501'),
    (2, '4000',    -1000, 201, 'Sale',        None),
    (3, '1010',      600, 202, 'P_Sale-Cash', '501'),   # tender debit, BP stamped
    (4, '1220.01',  -600, 202, 'P_Sale-Cash', '501'),   # AR credit
    # Customer 502: invoice 500, FULLY paid → TRUE outstanding = 0
    (5, '1220.01',   500, 301, 'Sale',        '502'),
    (6, '4000',     -500, 301, 'Sale',        None),
    (7, '1010',      500, 302, 'P_Sale-MADA', '502'),
    (8, '1220.01',  -500, 302, 'P_Sale-MADA', '502'),
]
for line, code, amt, doc, typ, bp in LINES:
    d = D_PAY if typ.startswith('P_') else D_INV
    con.execute("INSERT INTO FACT_GL VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                [line, code, d, d, amt, max(amt, 0), max(-amt, 0),
                 doc, doc * 10, typ, f'D{doc}', f'G{doc}', bp, 1, 100])
for doc in (201, 202, 301, 302):
    dd = D_PAY if doc in (202, 302) else D_INV
    con.execute("INSERT INTO FACT_GL_DOC VALUES (?,?,?,?,?,?,?,?,?)",
                [doc, True, dd, dd, 1, 0, 1, 2, f'D{doc}'])

# ── wire the app to this in-memory warehouse ────────────────────────────────
import routers.common as common
common.get_db = lambda: con
import routers.accounting as acc
acc._gl_off = lambda: False
acc._stored_class_roles = lambda: {}
_real_partner_accounts = acc._partner_account_codes   # kept for section 3

ok = True
def check(label, got, want):
    global ok
    good = got == want
    ok &= good
    print(('PASS' if good else 'FAIL'), label, '' if good else f'got={got!r} want={want!r}')

def run_ar():
    rows = acc.gl_aging(as_of=AS_OF, side='ar', stores=None, subsidiaries=None,
                        date_basis='transaction', include_unbalanced=False,
                        buckets='30,60,90')
    return {r['bp_id']: r for r in rows}

# 1. OLD behaviour (role fallback — an explicitly EMPTY account list):
#    tender is an Asset, payments net to zero inside the filter, balances
#    overstate. This is the fallback we keep, demonstrated honestly.
acc._partner_account_codes = lambda ar: []
old = run_ar()
check('OLD role filter overstates Acme (1000, not 400)',
      round(old['501']['balance'], 2), 1000.0)
check('OLD role filter shows Fully Paid Co still owing 500',
      round(old.get('502', {}).get('balance', 0), 2), 500.0)

# 2. NEW behaviour (configured receivable accounts — the default 1220.01):
#    only AR-control lines are measured → the true outstanding balances.
acc._partner_account_codes = lambda ar: ['1220.01']
new = run_ar()
check('NEW account filter: Acme true outstanding 400',
      round(new['501']['balance'], 2), 400.0)
check('NEW account filter: Fully Paid Co omitted (zero balance)',
      '502' in new, False)
b = new['501']
check('NEW buckets reconcile to the balance',
      round(b['current'] + b['d1_30'] + b['d31_60'] + b['d61_90'] + b['d90_plus'], 2),
      round(b['balance'], 2))
check('NEW: 26-day-old residual charge sits in 1-30',
      round(b['d1_30'], 2), 400.0)

# 3. The real helper's precedence: missing settings key → the documented
#    defaults; explicit empty list → [] (role fallback); stored list → as-is.
import services.config as cfg
_real_load = cfg.load_settings
try:
    cfg.load_settings = lambda: {}
    check('helper: missing key -> default AR list',
          _real_partner_accounts(True), ['1220.01'])
    check('helper: missing key -> default AP list',
          _real_partner_accounts(False), ['3100.01'])
    cfg.load_settings = lambda: {"accounting": {"receivable_accounts": []}}
    check('helper: explicit empty list -> [] (role fallback)',
          _real_partner_accounts(True), [])
    cfg.load_settings = lambda: {"accounting": {"receivable_accounts": [' 1100.05 ', '', '1220.01']}}
    check('helper: stored list cleaned',
          _real_partner_accounts(True), ['1100.05', '1220.01'])
finally:
    cfg.load_settings = _real_load

print('\nALL PASS' if ok else '\nSOME CHECKS FAILED')
sys.exit(0 if ok else 1)
