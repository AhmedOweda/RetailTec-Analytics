"""Trace the item->vendor SID space in Oracle. Temporary file."""
import io
import sys

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

import oracledb
from pathlib import Path

for p in [r"C:\Oracle\instantclient"]:
    if Path(p).exists():
        try:
            oracledb.init_oracle_client(lib_dir=p)
        except Exception:
            pass

from db.sync import _get_oracle_conn

con = _get_oracle_conn()
cur = con.cursor()

cur.execute("""SELECT column_name FROM all_tab_columns
               WHERE owner='RPS' AND table_name='INVN_SBS_VENDOR' ORDER BY column_id""")
print("INVN_SBS_VENDOR cols:", [r[0] for r in cur.fetchall()])

test_sid = 617940047000130176
cur.execute("SELECT COUNT(*) FROM RPS.INVN_SBS_VENDOR WHERE SID = :s", s=test_sid)
print("item VEND_SID found in INVN_SBS_VENDOR:", cur.fetchone()[0])

cur.execute("""SELECT ISV.SID, ISV.VEND_SID, V.VEND_NAME
               FROM RPS.INVN_SBS_VENDOR ISV
               LEFT JOIN RPS.VENDOR V ON V.SID = ISV.VEND_SID
               WHERE ISV.SID = :s""", s=test_sid)
print("mapping sample:", cur.fetchall())

cur.execute("SELECT COUNT(*) FROM RPS.INVN_SBS_VENDOR")
print("INVN_SBS_VENDOR rows:", cur.fetchone()[0])
con.close()
