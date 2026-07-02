SELECT D.SBS_NO AS "Subsidiary No"
	, ST.STORE_CODE AS "Store Code"
	, ST.STORE_NAME AS "Store Name"
	, d.workstation_no AS "Workstation No"
	, d.workstation_name AS "Workstation"
	, D.INVC_POST_DATE AS "Post Date"
	, D.DOC_NO AS "Document No"
	, D.ORDER_DOC_NO AS "Order Document No"
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
	, nvl(i.cost, 0) AS "Total COGS"
	, (NVL(D.SALE_SUBTOTAL_WITH_TAX, 0) - NVL(D.SALE_TOTAL_TAX_AMT, 0)) - (NVL(D.RETURN_SUBTOTAL_WITH_TAX, 0) - NVL(D.RETURN_TOTAL_TAX_AMT, 0)) AS "Net Sales WOTax"
	, NVL(D.SALE_TOTAL_TAX_AMT, 0) - NVL(D.RETURN_TOTAL_TAX_AMT, 0) AS "Total Tax"
	, NVL(D.DISC_AMT, 0) AS "Invoice LVL Discount"
	, NVL(i.DISC_AMT, 0) AS "Item LVL Discount"
	, nvl(d.LTY_SALE_TOTAL_BASED_DISC, 0) AS "Loyalty Discount"
	, NVL(D.TOTAL_DEPOSIT_TAKEN, 0) AS "Total Deposit"
	, NVL(D.TOTAL_FEE_AMT, 0) AS "Total Fees"
	, NVL(D.shipping_amt, 0) AS "Total Shipping"
	, ((NVL(D.SALE_SUBTOTAL_WITH_TAX, 0) - NVL(D.RETURN_SUBTOTAL_WITH_TAX, 0)) + (NVL(D.TOTAL_DEPOSIT_TAKEN, 0)) + (NVL(D.TOTAL_FEE_AMT, 0)) + NVL(D.shipping_amt, 0)) AS "Total Transaction WTax"
	, nvl(t1.cash, 0) AS "Cash Payments"
	, nvl(t2.credit, 0) AS "Card Payments"
	, nvl(t4.deposit, 0) AS "Deposit"
	, nvl(t3.other, 0) AS "Other Payments"
FROM RPS.DOCUMENT D
INNER JOIN RPS.STORE ST
	ON ST.SID = D.STORE_SID
LEFT JOIN (
	SELECT doc_sid
		, sum((
				CASE 
					WHEN item_type = 2
						THEN qty * - 1
					ELSE qty
					END
				) * cost) AS cost
		, sum(CASE 
				WHEN item_type = 2
					THEN disc_amt * - 1
				ELSE disc_amt
				END) AS disc_amt
	FROM RPS.document_item
	WHERE item_type IN (1, 2)
		AND kit_flag <> 5
	GROUP BY doc_sid
	) i
	ON i.doc_sid = d.sid
LEFT JOIN (
	SELECT doc_sid
		, sum(amount) AS Cash
	FROM rps.tender
	WHERE tender_type = 0
	GROUP BY doc_sid
	) t1
	ON t1.doc_sid = d.sid
LEFT JOIN (
	SELECT doc_sid
		, sum(amount) AS credit
	FROM rps.tender
	WHERE tender_type IN (2, 11)
	GROUP BY doc_sid
	) t2
	ON t2.doc_sid = d.sid
LEFT JOIN (
	SELECT doc_sid
		, sum(amount) AS other
	FROM rps.tender
	WHERE tender_type NOT IN (0, 2, 11, 7)
	GROUP BY doc_sid
	) t3
	ON t3.doc_sid = d.sid
LEFT JOIN (
	SELECT doc_sid
		, sum(amount) AS Deposit
	FROM rps.tender
	WHERE tender_type = 7
	GROUP BY doc_sid
	) t4
	ON t4.doc_sid = d.sid
WHERE D.STATUS = 4
ORDER BY D.STORE_CODE
	, INVC_POST_DATE
