SELECT do.sbs_no AS "Subsidiary No"
	, do.store_code AS "Store Code"
	, do.store_name AS "Store Name"
	, di.employee1_full_name AS "Associate"
	, do.cashier_full_name AS "Cashier"
	, do.bt_id AS "Customer ID"
	, do.bt_first_name || ' ' || do.bt_last_name AS "Customer Full Name"
	, trunc(do.invc_post_date) AS "Order Date"
	, to_char(do.invc_post_date, 'HH24:MI:SS') AS "Order Time"
	, do.doc_no AS "Document No"
	, do.order_doc_no AS "Order No"
	, CASE 
		WHEN do.order_type = 0
			THEN 'Customer Order'
		WHEN do.order_type = 1
			THEN 'Special Order'
		WHEN do.order_type = 2
			THEN 'Layaway'
		WHEN do.order_type = 3
			THEN 'Store Registry'
		WHEN do.order_type = 4
			THEN 'Company Registry'
		WHEN do.order_type = 5
			THEN 'Web SO'
		WHEN do.order_type = 6
			THEN 'Send Sale'
		END AS "Order Type"
	, do.ref_order_order_doc_no AS "Reference Order No"
	, do.ship_date AS "Ship Date"
	, do.cancel_date AS "Cancel Date"
	, do.order_due_date AS "Due Date"
	, v.vend_code AS "Vendor Code"
	, v.vend_name AS "Vendor Name"
	, dc.dcs_code AS "DCS Code"
	, dc.d_name AS "Department"
	, dc.c_name AS "Class"
	, dc.s_name AS "SubClass"
	, i.alu
	, to_char(i.upc) AS upc
	, i.description1 AS "Description1"
	, i.description2 AS "Description2"
	, i.description3 AS "Description3"
	, i.description4 AS "Description4"
	, i.attribute AS "Attribute"
	, i.item_size AS "Size"
	, i.udf1_string AS udf1
	, i.udf2_string AS udf2
	, i.udf3_string AS udf3
	, i.udf4_string AS udf4
	, i.udf5_string AS udf5
	, di.qty AS "Order Qty"
	, di.order_quantity_filled AS "Order Filled Qty"
	, CASE 
		WHEN di.qty <> 0
			THEN ((nvl(di.order_quantity_filled, 0) / nvl(di.qty, 0)) * 100)
		ELSE 0
		END AS "Fullfilment Rate"
	, (
		di.qty * (
			(
				CASE 
					WHEN do.use_vat = 1
						THEN di.dip_price - di.dip_tax_amt
					WHEN do.use_vat = 0
						THEN di.dip_price
					END
				) - nvl(di.lty_piece_of_tbr_disc_amt, 0)
			)
		) AS "Total Price After Disc WOTax"
	, (di.qty * di.dip_tax_amt) AS "Total Tax Amount"
	, (
		di.qty * (
			(
				CASE 
					WHEN do.use_vat = 1
						THEN di.dip_price
					WHEN do.use_vat = 0
						THEN di.dip_price + di.dip_tax_amt
					END
				) - nvl(di.lty_piece_of_tbr_disc_amt, 0)
			)
		) AS "Total Price After Disc WTax"
FROM rps.document_item di
INNER JOIN rps.document do
	ON di.doc_sid = do.sid
LEFT JOIN rps.invn_sbs_item i
	ON di.invn_sbs_item_sid = i.sid
		AND do.subsidiary_sid = i.sbs_sid
LEFT JOIN rps.dcs dc
	ON dc.sid = i.dcs_sid
		AND dc.sbs_sid = i.sbs_sid
LEFT JOIN rps.invn_sbs_extend ud
	ON ud.invn_sbs_item_sid = i.sid
LEFT JOIN rps.vendor v
	ON v.sid = i.vend_sid
		AND v.sbs_sid = i.sbs_sid
WHERE di.created_datetime IS NOT NULL
	AND do.STATUS = 4
	AND di.item_type = 3
ORDER BY do.created_datetime DESC
