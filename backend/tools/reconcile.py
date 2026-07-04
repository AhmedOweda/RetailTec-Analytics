"""
Reconciliation suite — Oracle vs DuckDB
=======================================
Compares key aggregates between the Prism source and the local warehouse for a
date range. Run after any sync-code change and before customer deployments:

    python tools/reconcile.py 2026-06-01 2026-06-30

Exit code 0 = all checks within tolerance (0.5%); 1 = at least one mismatch.
"""
import io
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

import duckdb
import oracledb

TOLERANCE_PCT = 0.5


def main(df: str, dt: str) -> int:
    try:
        oracledb.init_oracle_client(lib_dir=r"C:\Oracle\instantclient")
    except Exception:
        pass
    from db.sync import _get_oracle_conn
    from db.model import _db_path, _current_settings_host

    ora = _get_oracle_conn()
    ocur = ora.cursor()
    duck = duckdb.connect(str(_db_path(_current_settings_host())), read_only=True)

    # Oracle predicates mirror _sql_invoices EXACTLY (STATUS=4, receipt types
    # 0/1/2, half-open date range — Oracle DATE keeps a time component, so
    # BETWEEN on the upper bound silently drops the last day's rows).
    doc_where = f"""CAST(INVC_POST_DATE AS DATE) >= TO_DATE('{df}','YYYY-MM-DD')
               AND CAST(INVC_POST_DATE AS DATE) <  TO_DATE('{dt}','YYYY-MM-DD') + 1
               AND STATUS = 4 AND RECEIPT_TYPE IN (0, 1, 2)"""
    checks = [
        ("Net sales (w/o tax)",
         f"""SELECT ROUND(SUM((NVL(SALE_SUBTOTAL_WITH_TAX,0)-NVL(SALE_TOTAL_TAX_AMT,0))
                    -(NVL(RETURN_SUBTOTAL_WITH_TAX,0)-NVL(RETURN_TOTAL_TAX_AMT,0))),2)
             FROM RPS.DOCUMENT WHERE {doc_where}""",
         f"""SELECT ROUND(SUM(NET_SALES_WOTAX),2) FROM FACT_SALES_INVOICES
             WHERE CAST(INVC_POST_DATE AS DATE) BETWEEN '{df}' AND '{dt}'"""),

        ("Invoice count (closed)",
         f"""SELECT COUNT(*) FROM RPS.DOCUMENT WHERE {doc_where}""",
         f"""SELECT COUNT(*) FROM FACT_SALES_INVOICES
             WHERE CAST(INVC_POST_DATE AS DATE) BETWEEN '{df}' AND '{dt}'"""),

        ("Returned units",
         f"""SELECT ROUND(SUM(NVL(RETURN_QTY,0)),0) FROM RPS.DOCUMENT WHERE {doc_where}""",
         f"""SELECT ROUND(SUM(RETURN_QTY),0) FROM FACT_SALES_INVOICES
             WHERE CAST(INVC_POST_DATE AS DATE) BETWEEN '{df}' AND '{dt}'"""),

        ("Purchases total cost",
         f"""SELECT ROUND(SUM(NVL(VOU_TOTAL,0)),2) FROM RPS.VOUCHER
             WHERE NVL(SLIP_FLAG,0)=0 AND NVL(HELD,0)=0
               AND CREATED_DATETIME >= TO_DATE('{df}','YYYY-MM-DD')
               AND CREATED_DATETIME <  TO_DATE('{dt}','YYYY-MM-DD') + 1""",
         f"""SELECT ROUND(SUM(VOU_TOTAL),2) FROM FACT_PURCHASES
             WHERE VOU_DATE BETWEEN '{df}' AND '{dt}'"""),

        ("Adjustment lines",
         f"""SELECT COUNT(*) FROM RPS.ADJUSTMENT A
             INNER JOIN RPS.ADJ_ITEM AI ON AI.ADJ_SID = A.SID
             WHERE A.CREATED_DATETIME >= TO_DATE('{df}','YYYY-MM-DD')
               AND A.CREATED_DATETIME <  TO_DATE('{dt}','YYYY-MM-DD') + 1""",
         f"""SELECT COUNT(*) FROM FACT_ADJUSTMENTS
             WHERE ADJ_DATE BETWEEN '{df}' AND '{dt}'"""),
    ]

    failures = 0
    print(f"Reconciliation {df} → {dt}  (tolerance ±{TOLERANCE_PCT}%)")
    print("-" * 74)
    for name, osql, dsql in checks:
        try:
            oval = float(ocur.execute(osql).fetchone()[0] or 0)
        except Exception as e:
            print(f"{name:30s}  ORACLE ERROR: {e}")
            failures += 1
            continue
        try:
            dval = float(duck.execute(dsql).fetchone()[0] or 0)
        except Exception as e:
            print(f"{name:30s}  DUCKDB ERROR: {e}")
            failures += 1
            continue
        diff = abs(oval - dval)
        pct  = (diff / abs(oval) * 100) if oval else (0 if dval == 0 else 100)
        ok = pct <= TOLERANCE_PCT
        mark = "OK  " if ok else "FAIL"
        if not ok:
            failures += 1
        print(f"{mark} {name:30s} oracle={oval:,.2f}  duckdb={dval:,.2f}  diff={pct:.3f}%")
    print("-" * 74)
    print("ALL CHECKS PASSED" if failures == 0 else f"{failures} CHECK(S) FAILED")
    ora.close(); duck.close()
    return 0 if failures == 0 else 1


if __name__ == "__main__":
    if len(sys.argv) != 3:
        print("usage: python tools/reconcile.py <date_from> <date_to>")
        sys.exit(2)
    sys.exit(main(sys.argv[1], sys.argv[2]))
