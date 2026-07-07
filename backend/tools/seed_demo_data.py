# Seed synthetic demo data for UI debugging (run with backend STOPPED).
# Sales domain only: dims + FACT_SALES_INVOICES/_ITEMS, FACT_SALES_DAILY rebuild.
import duckdb, random, datetime as dt

random.seed(42)
DB = r"C:\RetailTec\RetailTec-Analytics\backend\retailtec_local.db"
con = duckdb.connect(DB)

con.execute("ALTER TABLE DIM_STORE ADD COLUMN IF NOT EXISTS SUBSIDIARY_SID BIGINT")

SUBS = [(1, 1, "Qahwa Trading"), (2, 2, "Sofa Retail")]
con.executemany("INSERT OR REPLACE INTO DIM_SUBSIDIARY VALUES (?,?,?)", SUBS)

STORES = [
    (101, "S01", "Riyadh Gallery Mall", 1),
    (102, "S02", "Jeddah Corniche Branch", 1),
    (103, "S03", "Dammam City Center", 2),
    (104, "S04", "Khobar Seafront Boulevard Outlet", 2),
]
con.executemany(
    "INSERT OR REPLACE INTO DIM_STORE (SID, STORE_CODE, STORE_NAME, SUBSIDIARY_SID) VALUES (?,?,?,?)",
    STORES)

EMPS = [(i + 1, n) for i, n in enumerate([
    "Abdulrahman Al-Qahtani", "Mohammed Bin Abdulaziz Al-Rashid",
    "Fatimah Al-Zahrani", "Noura Bint Khalid Al-Otaibi",
    "Yousef Al-Harbi", "Sara Al-Ghamdi",
    "Khalid Abdullah Al-Mutairi", "Aisha Al-Dossary",
])]
con.executemany("INSERT OR REPLACE INTO DIM_EMPLOYEE VALUES (?,?)", EMPS)

CUSTS = [(i + 1, n, f"+9665{random.randint(10000000, 99999999)}") for i, n in enumerate([
    "Hassan Al-Shammari", "Layla Al-Anazi", "Omar Al-Juhani", "Reem Al-Subaie",
    "Turki Al-Malki", "Dana Al-Amri", "Faisal Al-Balawi", "Munira Al-Hazmi",
    "Ziyad Al-Ruwaili", "Hind Al-Yami", "Nasser Al-Shehri", "Jana Al-Asmari",
])]
con.executemany("INSERT OR REPLACE INTO DIM_CUSTOMER (SID, FULL_NAME, PHONE) VALUES (?,?,?)", CUSTS)

ITEM_NAMES = [
    "Espresso Beans 1kg Dark Roast", "Arabica Ground Coffee 500g",
    "Ceramic Pour Over Dripper", "Stainless Milk Frothing Pitcher",
    "Cold Brew Concentrate Bottle", "Turkish Coffee Pot Copper Large",
    "Velvet Sofa Cushion Cover Set", "Oak Coffee Table Rectangular",
    "Fabric Three Seater Sofa Grey", "Leather Recliner Armchair Brown",
    "Bookshelf Five Tier Walnut", "Floor Lamp Adjustable Matte Black",
    "Cardamom Latte Syrup 750ml", "Date Cookies Assorted Box",
    "Electric Coffee Grinder Burr", "Thermal Travel Mug 450ml",
    "Corner Sofa Modular Beige", "Side Table Round Marble Top",
    "Wall Clock Minimalist Large", "Area Rug Persian Pattern 2x3m",
    "Manual Espresso Maker Portable", "Coffee Bean Storage Canister",
    "Ottoman Storage Bench Velvet", "TV Console Unit Two Meter",
]
items = [(1000 + i, 1, f"ALU{1000 + i}", f"628{random.randint(1000000000, 9999999999)}",
          n, "", None, None, None, None, True, round(random.uniform(15, 900), 2))
         for i, n in enumerate(ITEM_NAMES)]
con.executemany(
    "INSERT OR REPLACE INTO DIM_ITEM (SID, SBS_SID, ALU, UPC, DESCRIPTION1, DESCRIPTION2,"
    " ATTRIBUTE, ITEM_SIZE, DCS_SID, VEND_SID, ACTIVE, PRICE_LVL1)"
    " VALUES (?,?,?,?,?,?,?,?,?,?,?,?)", items)

# ── Invoices + line items, last 120 days ─────────────────────────────
inv_rows, item_rows = [], []
doc_sid, doc_item_sid = 500000, 900000
today = dt.date.today()
for d in range(120):
    day = today - dt.timedelta(days=d)
    for store_sid, _, _, sub_sid in STORES:
        for _ in range(random.randint(4, 14)):
            doc_sid += 1
            emp = random.choice(EMPS)[0]
            cust = random.choice(CUSTS)[0]
            n_lines = random.randint(1, 4)
            gross = ret = ret_units = sold_qty = 0.0
            for _l in range(n_lines):
                doc_item_sid += 1
                it = random.choice(items)
                qty = random.randint(1, 5)
                price = float(it[11])
                is_return = random.random() < 0.07
                itype = "2" if is_return else "1"
                total = round(qty * price, 2)
                if is_return:
                    ret += total; ret_units += qty
                else:
                    gross += total; sold_qty += qty
                item_rows.append((doc_item_sid, doc_sid, day, store_sid, it[0],
                                  itype, qty, round(price * 0.6, 2), price, price * 1.15,
                                  price, price * 0.15, price * 1.15, 0, 0, 0,
                                  round(qty * price * 0.6, 2), total, total,
                                  round(total * 0.15, 2), round(total * 1.15, 2)))
            net = round(gross - ret, 2)
            ts = dt.datetime.combine(day, dt.time(random.randint(9, 22), random.randint(0, 59)))
            inv_rows.append((doc_sid, f"INV-{doc_sid}", ts, 0, sub_sid, store_sid,
                             emp, emp, cust, sold_qty, ret_units, round(net * 0.6, 2),
                             net, round(net * 0.15, 2), 0, 0, 0, 0, 0, 0,
                             round(net * 1.15, 2), round(net * 0.7, 2), round(net * 0.45, 2),
                             0, 0, round(gross, 2), round(ret, 2), ret_units))

con.executemany("""
    INSERT OR REPLACE INTO FACT_SALES_INVOICES (
        DOC_SID, DOC_NO, INVC_POST_DATE, RECEIPT_TYPE, SUBSIDIARY_SID, STORE_SID,
        EMPLOYEE1_SID, CASHIER_SID, BT_CUID, SOLD_QTY, RETURN_QTY, TOTAL_COGS,
        NET_SALES_WOTAX, TOTAL_TAX, INVOICE_DISC, ITEM_DISC, LOYALTY_DISC,
        TOTAL_DEPOSIT, TOTAL_FEES, SHIPPING_AMT, TOTAL_WTAX, CASH_AMT, CARD_AMT,
        DEPOSIT_AMT, OTHER_AMT, GROSS_WOTAX, RETURN_WOTAX, RETURN_UNITS
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""", inv_rows)

con.executemany("""
    INSERT OR REPLACE INTO FACT_SALES_ITEMS (
        DOC_ITEM_SID, DOC_SID, INVC_POST_DATE, STORE_SID, ITEM_SID, ITEM_TYPE,
        QTY, UNIT_COST, UNIT_ORIG_PRICE_WOTAX, UNIT_ORIG_PRICE_WTAX,
        UNIT_PRICE_WOTAX, UNIT_TAX_AMT, UNIT_PRICE_WTAX, UNIT_ITEM_DISC,
        UNIT_RECEIPT_DISC, UNIT_LOYALTY_DISC, TOTAL_COST, TOTAL_ORIG_PRICE_WOTAX,
        TOTAL_PRICE_WOTAX, TOTAL_TAX_AMT, TOTAL_PRICE_WTAX
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""", item_rows)

con.execute("DELETE FROM FACT_SALES_DAILY")
con.execute("""
    INSERT INTO FACT_SALES_DAILY
    SELECT CAST(INVC_POST_DATE AS DATE), STORE_SID, COALESCE(SUBSIDIARY_SID,0),
           SUM(CASE WHEN RECEIPT_TYPE=0 THEN 1 ELSE 0 END),
           SUM(CASE WHEN RECEIPT_TYPE=1 THEN 1 ELSE 0 END),
           SUM(CASE WHEN RECEIPT_TYPE=2 THEN 1 ELSE 0 END),
           SUM(NET_SALES_WOTAX), SUM(INVOICE_DISC), SUM(TOTAL_TAX),
           SUM(TOTAL_DEPOSIT), SUM(TOTAL_FEES), SUM(SHIPPING_AMT), SUM(TOTAL_WTAX),
           SUM(COALESCE(GROSS_WOTAX,0)), SUM(COALESCE(RETURN_WOTAX,0)),
           SUM(COALESCE(RETURN_UNITS,0))
    FROM FACT_SALES_INVOICES
    GROUP BY 1, 2, 3""")

print("invoices:", con.execute("SELECT COUNT(*) FROM FACT_SALES_INVOICES").fetchone()[0])
print("items   :", con.execute("SELECT COUNT(*) FROM FACT_SALES_ITEMS").fetchone()[0])
print("daily   :", con.execute("SELECT COUNT(*) FROM FACT_SALES_DAILY").fetchone()[0])
con.close()
print("done")
