SELECT s.sbs_no AS "Subsidiary No"
	, st.store_code AS "Store Code"
	, st.store_name AS "Store Name"
	, rps.po.created_by AS "Created By"
	, rps.po.created_datetime AS "Created Date"
	, rps.po.po_no AS "Po No"
	, CASE WHEN rps.po.po_type = 0 THEN 'DropShip' WHEN rps.po.po_type = 1 THEN 'MarkedFor' WHEN rps.po.po_type = 2 THEN 'MultiSbsDropShip' WHEN rps.po.po_type = 3 THEN 'MultiSbsMarkedFor' END AS "Po Type"
	, rps.po.vend_acct_no AS "Vendor Account No"
	, v.vend_code AS "Vendor Code"
	, v.vend_name AS "Vendor Name"
	, mst.store_code AS "MarkedFor Store Code"
	, mst.store_name AS "MarkedFor Store Name"
	, sst.store_code AS "ShipTo Store Code"
	, sst.store_name AS "ShipTo Store Name"
	, CASE when rps.po.from_so = 1 then 'Yes' else 'No' end AS "From SO" 
	, rps.po.shipping_date AS "Shipping Date"
	, rps.po.cancel_date AS "Cancel Date"
	, rps.po.lst_activity_date AS "Last Activity Date"
	, e.full_name AS "Approved By"
	, rps.po.disc_perc AS "Discount Percent"
	, rps.po.po_subtotal AS "Po SubTotal"
	, rps.po.po_total AS "Po Total Cost"
	, rps.po.ord_qty AS "Po Qty"
	, rps.po.rcvd_qty AS "Received Qty"
	, rps.po.total_ext_price_w_tax AS "Po Total Price WTax"
	, rps.po.total_ext_price_wo_tax AS "Po Total Price WOTax"
FROM rps.po
LEFT JOIN rps.store st
	ON st.sid = rps.po.store_sid
LEFT JOIN rps.vendor v
	ON v.sid = rps.po.vendor_sid
LEFT JOIN rps.employee e
	ON e.sid = rps.po.approvby_sid
LEFT JOIN rps.store mst
	ON rps.po.markedfor_store_sid = mst.sid
LEFT JOIN rps.store sst
	ON rps.po.shipto_store_sid = sst.sid
LEFT JOIN rps.subsidiary s
	ON rps.po.sbs_sid = s.sid