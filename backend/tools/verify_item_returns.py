"""Verify item-level returns migration: DuckDB vs Oracle for one month.
RUN WITH THE BACKEND STOPPED (DuckDB single-writer).
"""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))

DF, DT = "2026-06-01", "2026-06-30"

from db.model import get_db          # runs ensure_schema -> migration/backfill
con = get_db()

print("== DuckDB (after migration) ==")
r = con.execute(f"""
    SELECT ROUND(SUM(COALESCE(GROSS_WOTAX,0)),2),
           ROUND(SUM(COALESCE(RETURN_WOTAX,0)),2),
           ROUND(SUM(COALESCE(RETURN_UNITS,0)),2)
    FROM FACT_SALES_INVOICES
    WHERE INVC_POST_DATE::DATE BETWEEN '{DF}' AND '{DT}'
""").fetchone()
print("  invoices  gross=%s return_amt=%s return_units=%s" % r)
r = con.execute(f"""
    SELECT ROUND(SUM(GROSS_WOTAX),2), ROUND(SUM(RETURN_WOTAX),2), ROUND(SUM(RETURN_UNITS),2)
    FROM FACT_SALES_DAILY WHERE POST_DATE BETWEEN '{DF}' AND '{DT}'
""").fetchone()
print("  daily     gross=%s return_amt=%s return_units=%s" % r)
con.close()

print("== Oracle (item level, same window) ==")
import oracledb
from services.config import load_settings
c = load_settings()["connection"]
oracledb.init_oracle_client(lib_dir=r"C:\db_mcp\instantclient_23_0")
oc = oracledb.connect(user=c["username"], password=c["password"],
                      dsn=f"{c['host']}:{c['port']}/{c['sid']}")
cur = oc.cursor()
cur.execute(f"""
    SELECT ROUND(SUM(CASE WHEN DI.ITEM_TYPE=1 THEN DI.QTY*(NVL(DI.PRICE,0)-NVL(DI.TAX_AMT,0)-NVL(DI.TAX2_AMT,0)) ELSE 0 END),2),
           ROUND(SUM(CASE WHEN DI.ITEM_TYPE=2 THEN DI.QTY*(NVL(DI.PRICE,0)-NVL(DI.TAX_AMT,0)-NVL(DI.TAX2_AMT,0)) ELSE 0 END),2),
           ROUND(SUM(CASE WHEN DI.ITEM_TYPE=2 THEN DI.QTY ELSE 0 END),2)
    FROM RPS.DOCUMENT_ITEM DI
    JOIN RPS.DOCUMENT H ON H.SID = DI.DOC_SID
    WHERE H.STATUS = 4 AND H.RECEIPT_TYPE IN (0,1,2) AND DI.ITEM_TYPE IN (1,2)
      AND CAST(H.INVC_POST_DATE AS DATE) BETWEEN TO_DATE('{DF}','YYYY-MM-DD') AND TO_DATE('{DT}','YYYY-MM-DD')
""")
r = cur.fetchone()
print("  oracle    gross=%s return_amt=%s return_units=%s" % r)
oc.close()
print("DONE")
