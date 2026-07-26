# Seeded-DuckDB verification for /profit-loss, /balance-sheet, /class-roles.
# Run: python tools\_test_statements.py  (from backend/)
import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from datetime import date
import duckdb

con = duckdb.connect(":memory:")
con.execute("""CREATE TABLE DIM_ACCOUNT (SID BIGINT, ACCOUNT_CODE VARCHAR,
    ACCOUNT_KEY VARCHAR, NAME_EN VARCHAR, NAME_AR VARCHAR,
    ACCOUNT_CLASS VARCHAR, ACCOUNT_GROUP VARCHAR, CLASS_SEQ INTEGER)""")
con.execute("""CREATE TABLE DIM_STORE (SID BIGINT, STORE_NAME VARCHAR)""")
con.execute("""CREATE TABLE FACT_GL (GL_LINE_SID BIGINT, ACCOUNT_CODE VARCHAR,
    POST_DATE DATE, GL_POST_DATE DATE, AMOUNT DECIMAL(18,4),
    DEBIT DECIMAL(18,4), CREDIT DECIMAL(18,4),
    SRC_DOC_SID BIGINT, GL_DOC_SID BIGINT, SRC_DOC_TYPE VARCHAR,
    SRC_DOC_NO VARCHAR, GL_DOC_NO VARCHAR, BP_ID VARCHAR,
    STORE_SID BIGINT, SUBSIDIARY_SID BIGINT)""")
con.execute("""CREATE TABLE FACT_GL_DOC (SRC_DOC_SID BIGINT, IS_BALANCED BOOLEAN,
    POST_DATE DATE, GL_POST_DATE DATE, STORE_SID BIGINT,
    NET DECIMAL(18,4), JOURNALS INT, LINES INT, SRC_DOC_NO VARCHAR)""")

ACCTS = [
    (1, '1000', 'Cash',      'Assets',      'Current Assets', 1),
    (2, '2000', 'Payables',  'Liabilities', None,             2),
    (3, '3000', 'Capital',   'Equity',      None,             3),
    (4, '4000', 'Store Rev', 'Sales',       'Store Sales',    4),
    (5, '5000', 'Goods',     'Purchases',   None,             5),
    (6, '6000', 'Rent',      'Expenses',    None,             6),
    (7, '7000', 'Mystery',   None,          None,             None),   # unclassified
    (8, '8000', 'Weird',     'Weird Stuff', None,             7),      # unmapped class
]
for sid, code, name, cls, grp, seq in ACCTS:
    con.execute("INSERT INTO DIM_ACCOUNT VALUES (?,?,?,?,?,?,?,?)",
                [sid, code, code, name, None, cls, grp, seq])

D = date(2026, 1, 15)
LINES = [  # (doc, code, amount)
    (101, '1000',  1150), (101, '4000', -1000), (101, '2000', -150),
    (102, '5000',   400), (102, '1000',  -400),
    (103, '6000',   100), (103, '1000',  -100),
    (104, '1000',   500), (104, '3000',  -500),
    (105, '7000',    50), (105, '1000',   -50),
    (106, '8000',    20), (106, '1000',   -20),
    (107, '1000',   999),                          # UNBALANCED
]
for i, (doc, code, amt) in enumerate(LINES):
    con.execute("INSERT INTO FACT_GL VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                [i + 1, code, D, D, amt, max(amt, 0), max(-amt, 0),
                 doc, doc * 10, 'Entry', f'D{doc}', f'G{doc}', None, 1, 100])
for doc in (101, 102, 103, 104, 105, 106):
    con.execute("INSERT INTO FACT_GL_DOC VALUES (?,?,?,?,?,?,?,?,?)",
                [doc, True, D, D, 1, 0, 1, 2, f'D{doc}'])
con.execute("INSERT INTO FACT_GL_DOC VALUES (?,?,?,?,?,?,?,?,?)",
            [107, False, D, D, 1, 999, 1, 1, 'D107'])

# ── wire the app to this in-memory warehouse ────────────────────────────────
import routers.common as common
common.get_db = lambda: con
import routers.accounting as acc
acc._gl_off = lambda: False
_overrides = {}
acc._stored_class_roles = lambda: dict(_overrides)

ok = True
def check(label, got, want):
    global ok
    good = got == want
    ok &= good
    print(('PASS' if good else 'FAIL'), label, '' if good else f'got={got!r} want={want!r}')

F, T = date(2026, 1, 1), date(2026, 1, 31)

# 1. class-roles: auto-map coverage + the unmapped custom class
roles = {r['class']: (r['role'], r['source']) for r in acc.gl_class_roles()}
check('Assets auto->asset',        roles['Assets'],      ('asset', 'auto'))
check('Liabilities auto',          roles['Liabilities'], ('liability', 'auto'))
check('Equity auto',               roles['Equity'],      ('equity', 'auto'))
check('Sales auto->revenue',       roles['Sales'],       ('revenue', 'auto'))
check('Purchases auto->cost',      roles['Purchases'],   ('cost', 'auto'))
check('Expenses auto->cost',       roles['Expenses'],    ('cost', 'auto'))
check('Weird Stuff unmapped',      roles['Weird Stuff'], (None, 'unmapped'))
check('Arabic revenue name auto',  acc.resolve_class_role('الايرادات'), ('revenue', 'auto'))
check('Arabic alef-variant auto',  acc.resolve_class_role('الأصول'),   ('asset', 'auto'))

# 2. P&L: sections, signs, ordering, unclassified last & never dropped
pl = acc.gl_profit_loss(date_from=F, date_to=T, stores=None, subsidiaries=None,
                        date_basis='transaction', include_unbalanced=False)
sec = {}
for r in pl:
    sec.setdefault(r['section'], 0)
    sec[r['section']] = round(sec[r['section']] + r['amount'], 2)
check('P&L Sales=1000',        sec.get('Sales'), 1000.0)
check('P&L Purchases=400',     sec.get('Purchases'), 400.0)
check('P&L Expenses=100',      sec.get('Expenses'), 100.0)
check('P&L Unclassified=70 (Mystery 50 + unmapped Weird 20, raw movement)',
      sec.get('Unclassified'), 70.0)
check('P&L has no BS accounts', 'Assets' in sec or 'Liabilities' in sec, False)
rev = sum(r['amount'] for r in pl if r['role'] == 'revenue')
cost = sum(r['amount'] for r in pl if r['role'] == 'cost')
check('P&L net = revenue - costs = 500', round(rev - cost, 2), 500.0)
check('Unclassified LAST', pl[-1]['section'], 'Unclassified')
check('Section order Sales<Purchases<Expenses',
      [s for s in [r['section'] for r in pl] if s != 'Unclassified'],
      ['Sales', 'Purchases', 'Expenses'])
check('group carried (Store Sales)',
      [r['group'] for r in pl if r['section'] == 'Sales'], ['Store Sales'])

# 3. Balance sheet: signs, synthetic row, exact balance arithmetic
bs = acc.gl_balance_sheet(as_of=T, stores=None, subsidiaries=None,
                          date_basis='transaction', include_unbalanced=False)
bysec = {}
for r in bs:
    bysec.setdefault(r['section'], 0)
    bysec[r['section']] = round(bysec[r['section']] + r['balance'], 2)
check('BS Assets (Cash 1080)',   bysec.get('Assets'), 1080.0)
check('BS Liabilities 150',      bysec.get('Liabilities'), 150.0)
check('BS Equity 1000 (Capital 500 + result 500)', bysec.get('Equity'), 1000.0)
check('BS Unclassified 70',      bysec.get('Unclassified'), 70.0)
syn = [r for r in bs if r['synthetic']]
check('one synthetic row',       len(syn), 1)
check('synthetic = 500 in Equity', (syn[0]['balance'], syn[0]['section'],
                                    syn[0]['account_name']),
      (500.0, 'Equity', 'Current period result'))
assets = sum(r['balance'] for r in bs if r['role'] == 'asset')
le = sum(r['balance'] for r in bs if r['role'] in ('liability', 'equity'))
uncls = sum(r['balance'] for r in bs if r['role'] is None)
check('BS balances incl synthetic: assets = L+E - unclassified',
      round(assets, 2), round(le - uncls, 2))
check('role order asset->liability->equity->None',
      sorted(range(len(bs)), key=lambda i: i) ==
      sorted(range(len(bs)), key=lambda i: {'asset': 0, 'liability': 1,
                                            'equity': 2, None: 3}[bs[i]['role']]), True)

# 4. Balanced gate: the unbalanced doc 107 (Cash +999) is excluded by default
bs_all = acc.gl_balance_sheet(as_of=T, stores=None, subsidiaries=None,
                              date_basis='transaction', include_unbalanced=True)
assets_all = sum(r['balance'] for r in bs_all if r['role'] == 'asset')
check('include_unbalanced pulls doc 107 in', round(assets_all - assets, 2), 999.0)

# 5. Role override via the resolver changes the section
_overrides['Weird Stuff'] = 'cost'
pl2 = acc.gl_profit_loss(date_from=F, date_to=T, stores=None, subsidiaries=None,
                         date_basis='transaction', include_unbalanced=False)
sec2 = {r['section']: 1 for r in pl2}
weird = [r for r in pl2 if r['section'] == 'Weird Stuff']
check('override: Weird Stuff now a P&L section', len(weird), 1)
check('override: cost sign (debit positive) 20', weird[0]['amount'], 20.0)
check('override: unclassified shrinks to Mystery 50',
      round(sum(r['amount'] for r in pl2 if r['section'] == 'Unclassified'), 2), 50.0)
rev2 = sum(r['amount'] for r in pl2 if r['role'] == 'revenue')
cost2 = sum(r['amount'] for r in pl2 if r['role'] == 'cost')
check('override: net now 480', round(rev2 - cost2, 2), 480.0)

# 6. Classify the last stray -> the sheet balances EXACTLY (difference 0.00)
con.execute("UPDATE DIM_ACCOUNT SET ACCOUNT_CLASS='Assets' WHERE SID=7")
bs3 = acc.gl_balance_sheet(as_of=T, stores=None, subsidiaries=None,
                           date_basis='transaction', include_unbalanced=False)
a3 = sum(r['balance'] for r in bs3 if r['role'] == 'asset')
le3 = sum(r['balance'] for r in bs3 if r['role'] in ('liability', 'equity'))
check('all classified + mapped -> difference exactly 0.00', round(a3 - le3, 2), 0.0)
check('no Unclassified section left', any(r['role'] is None for r in bs3), False)

print('\nALL PASS' if ok else '\nSOME CHECKS FAILED')
sys.exit(0 if ok else 1)
