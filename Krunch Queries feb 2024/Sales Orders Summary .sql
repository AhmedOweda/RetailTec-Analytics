SELECT s.sbs_no AS "Subsidiary No"
	,st.store_code AS "Store Code"
	,st.store_name AS "Store Name"
	,d.order_doc_no AS "Order No"
    ,CASE
    WHEN D.ORDER_TYPE = 0
    THEN 'Customer Order'
    WHEN D.ORDER_TYPE = 1
    THEN 'Special Order'
    WHEN D.ORDER_TYPE = 2
    THEN 'Layaway'
    WHEN D.ORDER_TYPE = 3
    THEN 'Store Registry'
    WHEN D.ORDER_TYPE = 4
    THEN 'Company Registry'
    WHEN D.ORDER_TYPE = 5
    THEN 'Web SO'
    WHEN D.ORDER_TYPE = 6
    THEN 'Send Sale'
  END             AS "Order Type"
	,d.doc_no AS "Document No"
	,d.ref_order_order_doc_no AS "Reference Order No"
	,d.bT_id AS "Customer ID"
	,d.bt_first_name || ' ' || d.bt_last_name AS "Customer Name"
    ,d.bt_primary_phone_no As "Customer Phone"
	,d.invc_post_date AS "Order Date"
	,d.ship_date AS "Ship Date"
	,d.cancel_date AS "Cancel Date"
    ,d.Order_due_date AS "Due Date"
	,d.order_subtotal AS "Order SubTotal"
	,nvl(d.order_shipping_amt, 0) AS "Shipping Fee"
	,nvl(d.order_total_amt, 0) AS "Order Total"
	,d.so_deposit_amt_paid AS "Deposit Balance"
	,CASE 
		WHEN d.ref_order_balance_due IS NULL
			THEN (d.order_total_amt - d.so_deposit_amt_paid)
		ELSE d.ref_order_balance_due
		END AS "Balance Due"
	,d.order_qty AS "Order Qty"
	,nvl(d.order_quantity_filled, 0) AS "Filled Qty"
	,case when d.order_qty <> 0 then ((nvl(d.order_quantity_filled, 0) / nvl(d.order_qty, 0)) * 100) else 0 end AS "Fullfilment Rate"
FROM rps.document d
LEFT JOIN rps.subsidiary s ON d.subsidiary_sid = s.sid
LEFT JOIN rps.store st ON st.sid = d.store_sid
WHERE d.receipt_type = 2
	AND d.STATUS = 4
	AND d.is_held = 0
ORDER BY d.created_datetime