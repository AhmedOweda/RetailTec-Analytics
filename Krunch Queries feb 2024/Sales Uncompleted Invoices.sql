SELECT D.SBS_NO AS "Subsidiary No"
	, ST.STORE_CODE AS "Store Code"
	, ST.STORE_NAME AS "Store Name"
	, d.workstation_no AS "Workstation No"
	, d.workstation_name AS "Workstation"
	, d.created_datetime AS "Created Date"
    , d.modified_datetime AS "Last Status Date"
	, CASE 
		WHEN D.IS_HELD = 1
			THEN 'Held'
		WHEN D.STATUS = 2
			THEN 'Discard'
		WHEN D.STATUS = 3
			THEN 'Pending'
		END AS "Status"
	, d.eft_invc_no AS "EFT Invoice No"
	, CASE 
		WHEN D.RECEIPT_TYPE = 0
			THEN 'Sale'
		WHEN D.RECEIPT_TYPE = 1
			THEN 'Return'
		ELSE 'Order'
		END AS "Invoice Type"
	, D.EMPLOYEE1_FULL_NAME AS "Associate"
	, D.CASHIER_FULL_NAME AS "Cashier"
	, D.BT_ID AS "Customer ID"
	, D.BT_FIRST_NAME || ' ' || D.BT_LAST_NAME AS "Customer Full Name"
	, nvl(d.sold_qty, 0) AS "Sold Qty"
	, nvl(d.return_qty, 0) AS "Return Qty"
	, nvl(d.order_qty, 0) AS "Order Qty"
	, (NVL(D.SALE_SUBTOTAL_WITH_TAX, 0) - NVL(D.SALE_TOTAL_TAX_AMT, 0)) - (NVL(D.RETURN_SUBTOTAL_WITH_TAX, 0) - NVL(D.RETURN_TOTAL_TAX_AMT, 0)) AS "Net Sales WOTax"
	, NVL(D.SALE_TOTAL_TAX_AMT, 0) - NVL(D.RETURN_TOTAL_TAX_AMT, 0) AS "Total Tax"
	, NVL(D.TOTAL_DEPOSIT_TAKEN, 0) AS "Total Deposit"
	, NVL(D.TOTAL_FEE_AMT, 0) AS "Total Fees"
	, NVL(D.shipping_amt, 0) AS "Total Shipping"
	, ((NVL(D.SALE_SUBTOTAL_WITH_TAX, 0) - NVL(D.RETURN_SUBTOTAL_WITH_TAX, 0)) + (NVL(D.TOTAL_DEPOSIT_TAKEN, 0)) + (NVL(D.TOTAL_FEE_AMT, 0)) + NVL(D.shipping_amt, 0)) AS "Total Transaction WTax"
FROM RPS.DOCUMENT D
INNER JOIN RPS.STORE ST
	ON ST.SID = D.STORE_SID
WHERE D.STATUS <> 4
ORDER BY D.STORE_CODE
	, D.Created_dateTime
