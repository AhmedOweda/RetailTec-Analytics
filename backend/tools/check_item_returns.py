"""One-off diagnostic: verify item-level return semantics on the Oracle server.
Run from backend/ with the backend STOPPED or running (Oracle only, no DuckDB).
"""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))

import oracledb
from services.config import load_settings

c = load_settings()["connection"]
DSN = sys.argv[1] if len(sys.argv) > 1 else f"{c['host']}:{c['port']}/{c['sid']}"
print("DSN:", DSN)
oracledb.init_oracle_client(lib_dir=r"C:\db_mcp\instantclient_23_0")
oc = oracledb.connect(user=c["username"], password=c["password"], dsn=DSN)
cur = oc.cursor()

print("== breakdown by RECEIPT_TYPE x ITEM_TYPE (count, units, wotax amount) ==")
cur.execute("""
    SELECT H.RECEIPT_TYPE, DI.ITEM_TYPE, COUNT(*), SUM(DI.QTY),
           ROUND(SUM(DI.QTY*(NVL(DI.PRICE,0)-NVL(DI.TAX_AMT,0)-NVL(DI.TAX2_AMT,0))),2)
    FROM RPS.DOCUMENT_ITEM DI
    JOIN RPS.DOCUMENT H ON H.SID = DI.DOC_SID
    WHERE H.STATUS = 4 AND H.RECEIPT_TYPE IN (0,1,2) AND DI.ITEM_TYPE IN (1,2)
    GROUP BY H.RECEIPT_TYPE, DI.ITEM_TYPE
    ORDER BY 1, 2
""")
for r in cur.fetchall():
    print("  receipt_type=%s item_type=%s lines=%s units=%s amount=%s" % r)

print("== sale receipts (type 0) containing return items ==")
cur.execute("""
    SELECT COUNT(DISTINCT H.SID)
    FROM RPS.DOCUMENT_ITEM DI
    JOIN RPS.DOCUMENT H ON H.SID = DI.DOC_SID
    WHERE H.STATUS = 4 AND H.RECEIPT_TYPE = 0 AND DI.ITEM_TYPE = 2
""")
print("  docs:", cur.fetchone()[0])

print("== header vs item totals (whole history) ==")
cur.execute("""
    SELECT ROUND(SUM(NVL(H.RETURN_SUBTOTAL_WITH_TAX,0)-NVL(H.RETURN_TOTAL_TAX_AMT,0)),2),
           ROUND(SUM(NVL(H.RETURN_QTY,0)),2)
    FROM RPS.DOCUMENT H
    WHERE H.STATUS = 4 AND H.RECEIPT_TYPE IN (0,1,2)
""")
print("  header returns (wotax, qty):", cur.fetchone())

oc.close()
print("DONE")
