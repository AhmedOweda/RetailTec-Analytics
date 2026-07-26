# Read-only verification of the statements against the owner's REAL warehouse.
import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import duckdb

DB = sys.argv[1] if len(sys.argv) > 1 else \
    r"C:\RetailTec\RetailTec-Analytics\packaging\out\RetailTecAnalytics\_internal\retailtec_26_158_231_155.db"
RO = "--rw" not in sys.argv
try:
    con = duckdb.connect(DB, read_only=RO)
except Exception as e:
    print("CANNOT OPEN (likely locked by the running app):", e)
    sys.exit(2)

import routers.common as common
common.get_db = lambda: con
import routers.accounting as acc
acc._gl_off = lambda: False
acc._stored_class_roles = lambda: {}     # no overrides — pure auto-map

cols = [r[1] for r in con.execute("PRAGMA table_info('DIM_ACCOUNT')").fetchall()]
print("DIM_ACCOUNT columns:", cols)
if "ACCOUNT_GROUP" not in cols:
    if RO:
        print("pre-v7 warehouse opened read-only — cannot apply the v7 ALTERs; rerun with --rw on a COPY")
        sys.exit(2)
    # Pre-v7 warehouse COPY: apply exactly the v7 migration _ensure_schema
    # runs at app startup (additive columns, NULL until the next sync).
    con.execute("ALTER TABLE DIM_ACCOUNT ADD COLUMN IF NOT EXISTS ACCOUNT_GROUP VARCHAR")
    con.execute("ALTER TABLE DIM_ACCOUNT ADD COLUMN IF NOT EXISTS CLASS_SEQ INTEGER")
    print("(pre-v7 warehouse copy: v7 ALTERs applied, columns NULL as after migration)")

lo, hi = con.execute("SELECT MIN(POST_DATE), MAX(POST_DATE) FROM FACT_GL").fetchone()
print("GL span:", lo, "->", hi)
from datetime import date
F, T = lo, hi

roles = acc.gl_class_roles()
print("\nclass-roles:")
for r in roles:
    print(f"  {r['class']!r:30} role={r['role']!r:12} source={r['source']:9} accounts={r['accounts']}")

tb = acc.gl_trial_balance(date_from=F, date_to=T, stores=None, subsidiaries=None,
                          date_basis='transaction', include_unbalanced=False,
                          hide_zero=True)
tb_mv = sum(float(r['movement'] or 0) for r in tb)
print(f"\nTB rows={len(tb)}  total movement={tb_mv:,.2f} (should be ~0 on balanced docs)")

# Expected P&L per section straight from the TB, using the same resolver
exp = {}
for r in tb:
    role, _ = acc.resolve_class_role(r.get('account_class'))
    mv = float(r['movement'] or 0)
    if role == 'revenue':
        exp[r['account_class']] = exp.get(r['account_class'], 0) - mv
    elif role == 'cost':
        exp[r['account_class']] = exp.get(r['account_class'], 0) + mv
    elif role in ('asset', 'liability', 'equity'):
        pass
    else:
        exp['Unclassified'] = exp.get('Unclassified', 0) + mv

pl = acc.gl_profit_loss(date_from=F, date_to=T, stores=None, subsidiaries=None,
                        date_basis='transaction', include_unbalanced=False)
got = {}
for r in pl:
    got[r['section']] = got.get(r['section'], 0) + r['amount']
print(f"\nP&L rows={len(pl)}  sections:")
ok = True
for s in sorted(set(exp) | set(got)):
    e, g = round(exp.get(s, 0), 2), round(got.get(s, 0), 2)
    match = abs(e - g) < 0.01
    ok &= match
    print(f"  {'PASS' if match else 'FAIL'} {s!r:30} P&L={g:,.2f}  TB-derived={e:,.2f}")
rev = sum(r['amount'] for r in pl if r['role'] == 'revenue')
cst = sum(r['amount'] for r in pl if r['role'] == 'cost')
unc = sum(r['amount'] for r in pl if r['role'] is None)
print(f"  revenue={rev:,.2f} costs={cst:,.2f} net={rev-cst:,.2f} unclassified(raw)={unc:,.2f}")
print(f"  Unclassified last: {pl[-1]['section'] == 'Unclassified' if pl else 'n/a'}")
print("  P&L account rows (real figures):")
for r in pl:
    print(f"    {r['section']:14} {r['account_code']:10} {r['account_name'][:32]:34} {r['amount']:>15,.2f}")

bs = acc.gl_balance_sheet(as_of=T, stores=None, subsidiaries=None,
                          date_basis='transaction', include_unbalanced=False)
assets = sum(r['balance'] for r in bs if r['role'] == 'asset')
le = sum(r['balance'] for r in bs if r['role'] in ('liability', 'equity'))
un = sum(r['balance'] for r in bs if r['role'] is None)
syn = [r for r in bs if r['synthetic']]
print(f"\nBS rows={len(bs)}  assets={assets:,.2f}  L+E={le:,.2f}  "
      f"difference={assets-le:,.2f}  unclassified={un:,.2f}")
print(f"  synthetic current-period-result: {[round(s['balance'],2) for s in syn]} in {[s['section'] for s in syn]}")
ident = abs(round(assets, 2) - round(le - un, 2)) < 0.01
ok &= ident
print(f"  {'PASS' if ident else 'FAIL'} identity assets == (L+E) - unclassified "
      f"(imbalance is EXACTLY the unclassified bucket)")
n_un = len([r for r in bs if r['role'] is None])
print(f"  unclassified BS accounts: {n_un}")
print("  BS account rows (real figures):")
for r in bs:
    print(f"    {r['section']:14} {r['account_code']:10} {r['account_name'][:32]:34} {r['balance']:>15,.2f}")
cls_n = con.execute("SELECT COUNT(*) FROM DIM_ACCOUNT WHERE ACCOUNT_CLASS IS NOT NULL").fetchone()[0]
tot = con.execute("SELECT COUNT(*), ROUND(SUM(DEBIT),2) FROM FACT_GL").fetchone()
print(f"\n  DIM_ACCOUNT classified: {cls_n}   FACT_GL lines={tot[0]:,} total debits={tot[1]:,.2f}")

print("\nALL CONSISTENT" if ok else "\nINCONSISTENCY FOUND")
con.close()
sys.exit(0 if ok else 1)
