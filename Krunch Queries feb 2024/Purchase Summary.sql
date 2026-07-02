SELECT s.sbs_no AS "Subsidiary No"
	,st.STORE_CODE AS "Store Code"
	,st.STORE_NAME AS "Store Name"
	,a.VOU_NO AS "Voucher No"
	,a.CREATED_DATETIME AS "Voucher Date"
	,a.CREATED_BY AS "Voucher Creator"
	,a.PO_NO AS "PO No"
	,a.ASN_NO AS "ASN No"
	,CASE 
		WHEN a.VOU_TYPE = 0
			THEN 'Purchase'
		WHEN a.VOU_TYPE = 1
			THEN 'Return'
		END AS "Voucher Type"
	,v.VEND_CODE AS "Vendor Code"
	,v.VEND_NAME AS "Vendor Name"
	,vi.VEND_INVC_NO AS "Vendor Invoice No"
	,vi.VEND_INVC_DATE AS "Vendor Invoice Date"
	,vi.CREATED_BY AS "Vendor Invoice Creator"
	,CASE 
		WHEN a.vou_type = 1
			THEN (a.VOU_subTOTAL * - 1)
		ELSE a.VOU_subTOTAL
		END AS "Voucher SubTotal"
	,CASE 
		WHEN a.vou_type = 1
			THEN (a.DISC_AMT * - 1)
		ELSE a.DISC_AMT
		END AS "Discount Amount"
	,CASE 
		WHEN a.vou_type = 1
			THEN (a.TAX_AMT_exCL * - 1)
		ELSE a.TAX_AMT_exCL
		END AS "Tax Amount Excluded"
	,CASE 
		WHEN a.vou_type = 1
			THEN (a.TAX_AMT_inCL * - 1)
		ELSE a.TAX_AMT_inCL
		END AS "Tax Amount included"
	,nvl(f.fee, 0) AS "Total Fees"
	,CASE 
		WHEN a.vou_type = 1
			THEN (a.VOU_TOTAL * - 1)
		ELSE a.VOU_TOTAL
		END AS "Voucher Total"
FROM RPS.VOUCHER a
INNER JOIN rps.subsidiary s ON a.sbs_sid = s.sid
INNER JOIN RPS.STORE st ON st.SID = a.STORE_SID
LEFT JOIN RPS.VENDOR_INVOICE vi ON vi.SID = a.VENDOR_INVOICE_SID
LEFT JOIN RPS.VENDOR v ON a.VEND_SID = v.SID
LEFT JOIN (
	SELECT vou_sid
		,SUM(CASE 
				WHEN v.vou_type = 1
					THEN (vf.amt * - 1)
				ELSE vf.amt
				END) AS fee
	FROM RPS.VOU_fee vf
	RIGHT JOIN rps.voucher v ON vf.vou_sid = v.sid
	GROUP BY vou_sid
	) F ON f.vou_sid = a.sid
WHERE a.VOU_TYPE IN (
		0
		,1
		)
	AND a.VOU_CLASS = 0
	AND a.SLIP_FLAG = 0
	AND a.HELD = 0
	AND a.STATUS = 4
