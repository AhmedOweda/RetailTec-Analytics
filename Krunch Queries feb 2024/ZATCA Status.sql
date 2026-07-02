SELECT to_char(do.sid) AS "Document SID"
	,do.doc_no AS "Document No"
	,CASE WHEN do.receipt_type = 0 THEN 'Sales' WHEN do.receipt_type = 1 THEN 'Return' WHEN do.receipt_type = 2 THEN 'Order' END AS "Invoice Type"
	,do.store_code AS "Store Code"
	,do.invc_post_date AS "Invoice Date"
	,MAX(nvl(di.note2, 0)) AS "ZATCA Status"
FROM rps.document do
LEFT JOIN rps.document_item di ON do.sid = di.doc_sid
WHERE do.doc_no > 0
	AND do.STATUS = 4
GROUP BY do.doc_no
	,CASE WHEN do.receipt_type = 0 THEN 'Sales' WHEN do.receipt_type = 1 THEN 'Return' WHEN do.receipt_type = 2 THEN 'Order' END
	,do.store_code
	,do.invc_post_date
	,do.sid
ORDER BY "Invoice Date" DESC
