SELECT s.sbs_no AS "Subsidiary No"
	, st.store_code AS "Store Code"
	, st.store_name AS "Store Name"
	, a.vou_no AS "Voucher No"
	, a.created_datetime AS "Voucher Date"
	, a.created_by AS "Voucher Creator"
	, a.po_no AS "PO No"
	, a.asn_no AS "ASN No"
	, CASE 
		WHEN a.vou_type = 0
			THEN 'Purchase'
		WHEN a.vou_type = 1
			THEN 'Return'
		END AS "Voucher Type"
	, v.vend_code AS "Vendor Code"
	, v.vend_name AS "Vendor Name"
	, vi.vend_invc_no AS "Vendor Invoice No"
	, vi.vend_invc_date AS "Vendor Invoice Date"
	, vi.created_by AS "Vendor Invoice Creator"
	, b.item_pos AS "Line No"
	, i.alu
	, to_char(i.upc) AS upc
	, i.description1 AS "Description1"
	, i.description2 AS "Description2"
	, i.description3 AS "Description3"
	, i.description4 AS "Description4"
	, i.item_size AS "Size"
	, i.attribute AS "Attribute"
	, b.serial_no AS "Serial No"
	, b.lot_number AS "Lot No"
	, CASE 
		WHEN a.vou_type = 1
			THEN b.qty * (- 1)
		ELSE b.qty
		END AS qty
	, nvl(b.cost, 0) AS "Unit Cost"
	, nvl(b.price, 0) AS "Unit Price"
	, nvl(b.disc_amt, 0) AS "Discount Amount"
	, nvl(b.tax_amt_excl, 0) AS "Tax Amount Excluded"
	, nvl(b.tax_amt_incl, 0) AS "Tax Amount included"
	, nvl(b.shipping_amt, 0) AS "Shipping Amount"
	, nvl(b.spread_fee_amt, 0) AS "Spread Fee Amount"
	, (
		CASE 
			WHEN a.vou_type = 1
				THEN b.qty * (- 1)
			ELSE b.qty
			END
		) * nvl(b.cost, 0) AS "Total Cost"
	, (
		CASE 
			WHEN a.vou_type = 1
				THEN b.qty * (- 1)
			ELSE b.qty
			END
		) * nvl(b.price, 0) AS "Total Price"
FROM rps.voucher a
INNER JOIN rps.vou_item b
	ON b.vou_sid = a.sid
INNER JOIN rps.invn_sbs_item i
	ON i.sid = b.item_sid
INNER JOIN rps.subsidiary s
	ON a.sbs_sid = s.sid
INNER JOIN rps.store st
	ON st.sid = a.store_sid
LEFT JOIN rps.vendor_invoice vi
	ON vi.sid = a.vendor_invoice_sid
LEFT JOIN rps.vendor v
	ON a.vend_sid = v.sid
WHERE a.vou_type IN (
		0
		, 1
		)
	AND a.vou_class = 0
	AND a.slip_flag = 0
	AND a.held = 0
	AND a.STATUS = 4
ORDER BY "Voucher Date"
	, "Line No"
