SELECT s.sbs_no AS "Subsidiary No"
	, st.store_code AS "Store Code"
	, st.store_name AS "Store Name"
	, p.created_by AS "Created By"
	, p.created_datetime AS "Created Date"
	, p.po_no AS "Po No"
	, CASE WHEN p.po_type = 0 THEN 'DropShip' WHEN p.po_type = 1 THEN 'MarkedFor' WHEN p.po_type = 2 THEN 'MultiSbsDropShip' WHEN p.po_type = 3 THEN 'MultiSbsMarkedFor' END AS "Po Type"
	, p.vend_acct_no AS "Vendor Account No"
	, v.vend_code AS "Vendor Code"
	, v.vend_name AS "Vendor Name"
	, mst.store_code AS "MarkedFor Store Code"
	, mst.store_name AS "MarkedFor Store Name"
	, sst.store_code AS "ShipTo Store Code"
	, sst.store_name AS "ShipTo Store Name"
	, CASE WHEN p.from_so = 1 THEN 'Yes' ELSE 'No' END AS "From SO"
	, p.shipping_date AS "Shipping Date"
	, p.cancel_date AS "Cancel Date"
	, p.lst_activity_date AS "Last Activity Date"
	, e.full_name AS "Approved By"
	, pi.item_pos AS "Item Line"
	, d.dcs_code AS "DCS Code"
	, i.alu
	, to_char(i.upc) AS upc
	, i.description1 AS "Description1"
	, i.description2 AS "Description2"
	, i.description3 AS "Description3"
	, i.description4 AS "Description4"
	, i.item_size AS "Size"
	, i.attribute AS "Attribute"
	, pi.ord_qty AS "Po Qty"
	, pi.rcvd_qty AS "Received Qty"
	, pi.cost AS "Unit Cost"
	, pi.price AS "Unit Price WOTax"
	, pi.tax_amount AS "Unit Tax"
	, pi.cost * pi.ord_qty AS "Total Cost"
	, pi.price * pi.ord_qty AS "Total Price WOTax"
	, pi.tax_amount * pi.ord_qty AS "Total Tax"
FROM rps.po p
LEFT JOIN rps.store st
	ON st.sid = p.store_sid
LEFT JOIN rps.vendor v
	ON v.sid = p.vendor_sid
LEFT JOIN rps.employee e
	ON e.sid = p.approvby_sid
LEFT JOIN rps.store mst
	ON p.markedfor_store_sid = mst.sid
LEFT JOIN rps.store sst
	ON p.shipto_store_sid = sst.sid
LEFT JOIN rps.subsidiary s
	ON p.sbs_sid = s.sid
INNER JOIN rps.po_item pi
	ON p.sid = pi.po_sid
INNER JOIN rps.invn_sbs_item i
	ON pi.item_sid = i.sid
LEFT JOIN rps.dcs d
	ON d.sid = i.dcs_sid
ORDER BY p.created_datetime
	, pi.item_pos
