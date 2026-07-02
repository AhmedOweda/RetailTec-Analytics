SELECT o.SLIP_NO AS "Slip No"
	,o.CREATED_DATETIME AS "Created Datetime"
	,vo.vou_no AS "Voucher No"
	,vo.asn_no AS "ASN No"
        ,vo.to_no AS "TO No"
	,CASE 
		WHEN Vo.vou_class = 0
			THEN 'Voucher'
		WHEN Vo.vou_class = 1
			THEN 'Pending Voucher'
		WHEN Vo.vou_class = 2
			THEN 'ASN'
		END AS "Voucher Class"
	,CASE 
		WHEN Vo.STATUS = 4
			THEN Vo.MODIFIED_DATETIME
		ELSE NULL
		END AS "Received Datetime"
	,CASE 
		WHEN vo.VERIFIED = 0
			THEN 'Unverified'
		WHEN vo.VERIFIED = 1
			THEN 'Verified'
		END AS "Verification"
	,o.CREATED_BY AS "Created By"
	,CASE 
		WHEN Vo.STATUS = 4
			THEN Vo.MODIFIED_BY
		ELSE NULL
		END AS "Received By"
	,so.STORE_code AS "From Store Code"
	,so.STORE_NAME AS "From Store Name"
	,si.STORE_code AS "To Store Code"
	,si.STORE_NAME AS "To Store Name"
	,CASE 
		WHEN Vo.STATUS = 1
			THEN 'Changed'
		WHEN Vo.STATUS = 2
			THEN 'Cancelled'
		WHEN Vo.STATUS = 3
			THEN 'Pending'
		WHEN Vo.STATUS = 4
			THEN 'Received'
		END AS "Transfer Status"
,vo.vou_subtotal AS "Voucher SubTotal"
,vo.vou_total AS "Voucher Total"
	,o.CARRIER_NAME AS "Carrier Name"
	,o.TRACKING_NO AS "Tracking No"
	,o.SHIPMENT_NO AS "Shipment No"
	,(
		SELECT COMMENTS
		FROM rps.SLIP_COMMENT
		WHERE SLIP_SID = o.SID
			AND COMMENT_NO = 1
		) AS "Slip Comment1"
FROM RPS.SLIP o
LEFT JOIN RPS.STORE so ON so.SID = o.OUT_STORE_SID
LEFT JOIN RPS.STORE si ON si.SID = o.IN_STORE_SID
LEFT JOIN RPS.VOUCHER Vo ON o.VOU_SID = Vo.SID
WHERE o.HELD = 0
	AND o.SLIP_NO <> 0
	AND nvl(o.reversed_flag, 0) = 0
	AND nvl(vo.slip_flag, 0) = 1
order by vo.sid

