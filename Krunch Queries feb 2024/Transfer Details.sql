SELECT o.SLIP_NO AS "Slip No"
	, o.CREATED_DATETIME AS "Created Datetime"
	, vo.vou_no AS "Voucher No"
	, vo.asn_no AS "ASN No"
	, vo.to_no AS "TO No"
	, CASE 
		WHEN Vo.vou_class = 0
			THEN 'Voucher'
		WHEN Vo.vou_class = 1
			THEN 'Pending Voucher'
		WHEN Vo.vou_class = 2
			THEN 'ASN'
		END AS "Voucher Class"
	, CASE 
		WHEN Vo.STATUS = 4
			THEN Vo.MODIFIED_DATETIME
		ELSE NULL
		END AS "Received Datetime"
	, CASE 
		WHEN vo.VERIFIED = 0
			THEN 'Unverified'
		WHEN vo.VERIFIED = 1
			THEN 'Verified'
		END AS "Verification"
	, o.CREATED_BY AS "Created By"
	, CASE 
		WHEN Vo.STATUS = 4
			THEN Vo.MODIFIED_BY
		ELSE NULL
		END AS "Received By"
	, so.STORE_code AS "From Store Code"
	, so.STORE_NAME AS "From Store Name"
	, si.STORE_code AS "To Store Code"
	, si.STORE_NAME AS "To Store Name"
	, vi.ITEM_POS AS "Line No"
	, n.ALU
	, TO_CHAR(N.UPC) AS UPC
	, N.DESCRIPTION1 AS "Description1"
	, N.DESCRIPTION2 AS "Description2"
	, N.DESCRIPTION3 AS "Description3"
	, N.DESCRIPTION4 AS "Description4"
	, N.ITEM_SIZE AS "Size"
	, N.ATTRIBUTE AS "Attribute"
	, d.DCS_CODE AS "DCS Code"
	, V.VEND_CODE AS "Vendor Code"
	, V.VEND_NAME AS "Vendor Name"
	, NVL((
			CASE 
				WHEN vo.vou_type = 0
					THEN VI.ORIG_QTY
				ELSE VI.ORIG_QTY * - 1
				END
			), 0) AS "Sent Qty"
	, CASE 
		WHEN Vo.STATUS = 4
			THEN (
					CASE 
						WHEN vo.vou_type = 0
							THEN VI.QTY
						ELSE VI.QTY * - 1
						END
					)
		ELSE NULL
		END AS "Received Qty"
	, CASE 
		WHEN Vo.STATUS = 1
			THEN 'Changed'
		WHEN Vo.STATUS = 2
			THEN 'Cancelled'
		WHEN Vo.STATUS = 3
			THEN 'Pending'
		WHEN Vo.STATUS = 4
			THEN 'Received'
		END AS "Transfer Status"
	, NVL((
			CASE 
				WHEN vo.vou_type = 0
					THEN VI.ORIG_QTY
				ELSE VI.ORIG_QTY * - 1
				END
			), 0) * NVL(VI.COST, 0) AS "Total Cost"
	, CASE 
		WHEN vo.USE_VAT = 1
			THEN NVL((
						CASE 
							WHEN vo.vou_type = 0
								THEN VI.ORIG_QTY
							ELSE VI.ORIG_QTY * - 1
							END
						), 0) * NVL(VI.PRICE, 0)
		WHEN vo.use_vat = 0
			THEN NVL((
						CASE 
							WHEN vo.vou_type = 0
								THEN VI.ORIG_QTY
							ELSE VI.ORIG_QTY * - 1
							END
						), 0) * NVL(VI.PRICE, 0) * (NVL(VI.TAX_PERC, 0) + 100) / 100
		END AS "Total Price WTax"
	, nvl(VI.TAX_PERC, 0) AS "Tax Percentage"
	, o.CARRIER_NAME AS "Carrier Name"
	, o.TRACKING_NO AS "Tracking No"
	, o.SHIPMENT_NO AS "Shipment No"
	, (
		SELECT COMMENTS
		FROM rps.SLIP_COMMENT
		WHERE SLIP_SID = o.SID
			AND COMMENT_NO = 1
		) AS "Slip Comment1"
FROM RPS.SLIP o
LEFT JOIN RPS.STORE so
	ON so.SID = o.OUT_STORE_SID
LEFT JOIN RPS.STORE si
	ON si.SID = o.IN_STORE_SID
LEFT JOIN RPS.VOUCHER Vo
	ON o.VOU_SID = Vo.SID
INNER JOIN RPS.VOU_ITEM VI
	ON o.VOU_SID = VI.VOU_SID
INNER JOIN RPS.INVN_SBS_ITEM n
	ON VI.ITEM_SID = n.SID
LEFT JOIN RPS.DCS d
	ON d.SID = n.DCS_SID
LEFT JOIN RPS.VENDOR v
	ON v.SID = n.VEND_SID
WHERE o.HELD = 0
	AND o.SLIP_NO <> 0
	AND nvl(vo.reversed_flag, 0) = 0
	AND nvl(vo.slip_flag, 0) = 1
ORDER BY vo.sid
	, vi.item_pos
