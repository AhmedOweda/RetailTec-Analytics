"""Is the DuckDB-vs-Oracle window discrepancy pre-existing (net sales) or new?
RUN WITH THE BACKEND STOPPED."""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))

DF, DT = "2026-06-01", "2026-06-30"

from db.model import get_db
con = get_db()
r = con.execute(f"""
    SELECT ROUND(SUM(NET_SALES_WOTAX),2), COUNT(*)
    FROM FACT_SALES_INVOICES
    WHERE INVC_POST_DATE::DATE BETWEEN '{DF}' AND '{DT}'
""").fetchone()
print("duckdb net=%s docs=%s" % r)
con.close()

import oracledb
from services.config import load_settings
c = load_settings()["connection"]
oracledb.init_oracle_client(lib_dir=r"C:\db_mcp\instantclient_23_0")
oc = oracledb.connect(user=c["username"], password=c["password"],
                      dsn=f"{c['host']}:{c['port']}/{c['sid']}")
cur = oc.cursor()
cur.execute(f"""
    SELECT ROUND(SUM((NVL(H.SALE_SUBTOTAL_WITH_TAX,0)-NVL(H.SALE_TOTAL_TAX_AMT,0))
                   - (NVL(H.RETURN_SUBTOTAL_WITH_TAX,0)-NVL(H.RETURN_TOTAL_TAX_AMT,0))),2),
           COUNT(*)
    FROM RPS.DOCUMENT H
    WHERE H.STATUS = 4 AND H.RECEIPT_TYPE IN (0,1,2)
      AND CAST(H.INVC_POST_DATE AS DATE) BETWEEN TO_DATE('{DF}','YYYY-MM-DD') AND TO_DATE('{DT}','YYYY-MM-DD')
""")
print("oracle net=%s docs=%s" % cur.fetchone())
oc.close()
print("DONE")
