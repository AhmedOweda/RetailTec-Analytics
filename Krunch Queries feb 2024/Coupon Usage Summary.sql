SELECT csc.COUPON_CODE AS "Coupon Code"
	,cs.SET_NAME AS "Set Name"
	,CASE 
		WHEN n.store_code IS NULL
			THEN t.store_code
		ELSE n.store_code
		END AS "Store Code"
	,CASE 
		WHEN n.store_name IS NULL
			THEN t.store_name
		ELSE n.store_name
		END AS "Store Name"
	,count(n.sid) OVER (PARTITION BY csc.COUPON_CODE) AS "#Usage"
	,n.doc_no AS "Used In Invoice"
	,n.invc_post_date AS "Used In Date"
	,t.doc_no AS "Created In Invoice"
	,t.invc_post_date AS "Created In Date"
FROM rps.coupon_set cs
INNER JOIN rps.coupon_set_coupon csc ON cs.sid = csc.coupon_set_sid
LEFT JOIN (
	SELECT DISTINCT d.sid
		,d.CUST_FIELD
		,d.doc_no
		,d.store_name
		,d.store_code
		,d.invc_post_date
		,dc.IN_OR_OUT
		,dc.COUPON_CODE
		,dc.promo_coupon_setid
		,dc.promo_sid
	FROM RPS.DOCUMENT d
	INNER JOIN RPS.DOCUMENT_COUPON dc ON d.sid = dc.doc_sid
		AND dc.IN_OR_OUT = 0
	INNER JOIN RPS.customer_address cs ON cs.cust_sid = d.bt_cuid
	WHERE d.STATUS = 4
		AND d.doc_no IS NOT NULL
	) t ON t.promo_coupon_setid = cs.set_id
	AND csc.COUPON_CODE = t.COUPON_CODE
LEFT JOIN (
	SELECT DISTINCT d.sid
		,d.doc_no
		,d.CUST_FIELD
		,d.Invc_post_date
		,d.store_name
		,d.store_code
		,dc.IN_OR_OUT
		,dc.COUPON_CODE
		,dc.promo_coupon_setid
		,dc.promo_sid
	FROM RPS.DOCUMENT d
	INNER JOIN RPS.DOCUMENT_COUPON dc ON d.sid = dc.doc_sid
		AND dc.IN_OR_OUT = 1
	WHERE d.STATUS = 4
		AND d.doc_no IS NOT NULL
	) n ON n.promo_coupon_setid = cs.set_id
	AND csc.COUPON_CODE = n.COUPON_CODE
GROUP BY csc.COUPON_CODE
	,cs.SET_NAME
	,n.CUST_FIELD
	,n.store_name
	,n.store_code
	,t.store_name
	,t.store_code
	,t.CUST_FIELD
	,n.doc_no
	,n.Invc_post_date
	,t.doc_no
	,t.Invc_post_date
	,n.sid
ORDER BY n.Invc_post_date
	,t.Invc_post_date
