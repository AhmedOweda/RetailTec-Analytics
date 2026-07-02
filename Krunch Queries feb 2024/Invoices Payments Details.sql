SELECT d.sbs_no AS "Subsdiary No"
	, st.store_code AS "Store Code"
	, st.store_name AS "Store Name"
	, d.invc_post_date AS "Post Date"
	, t.tender_pos AS "Line No"
	, d.doc_no AS "Document No"
	, d.order_doc_no AS "Order No"
	, CASE 
		WHEN d.receipt_type = 0
			THEN 'Sale'
		WHEN d.receipt_type = 1
			THEN 'Return'
		WHEN d.receipt_type = 2
			THEN 'Order'
		END AS "Invoice Type"
	, CASE 
		WHEN t.tender_type = 0
			THEN 'Cash'
		WHEN t.tender_type = 1
			THEN 'Check'
		WHEN t.tender_type = 2
			THEN 'CreditCard'
		WHEN t.tender_type = 3
			THEN 'COD'
		WHEN t.tender_type = 4
			THEN 'Charge'
		WHEN t.tender_type = 5
			THEN 'StoreCredit'
		WHEN t.tender_type = 6
			THEN 'Split'
		WHEN t.tender_type = 7
			THEN 'Deposit'
		WHEN t.tender_type = 8
			THEN 'Payments'
		WHEN t.tender_type = 9
			THEN 'GiftCertificate'
		WHEN t.tender_type = 10
			THEN 'GiftCard'
		WHEN t.tender_type = 11
			THEN 'DebitCard'
		WHEN t.tender_type = 12
			THEN 'ForeignCurrency'
		WHEN t.tender_type = 13
			THEN 'TravelerCheck'
		WHEN t.tender_type = 14
			THEN 'ForeignCheck'
		WHEN t.tender_type = 15
			THEN 'CentralGiftCard'
		WHEN t.tender_type = 16
			THEN 'CentralGiftCertificate'
		WHEN t.tender_type = 17
			THEN 'CentralCustomerCredit'
		WHEN t.tender_type = 18
			THEN 'CentralCustomerLoyalty'
		END AS "Tender Type"
	, rps.tender_credit_card.card_type_name AS "Card Type"
	, t.amount AS "Amount"
FROM rps.document d
INNER JOIN rps.tender t
	ON d.sid = t.doc_sid
LEFT JOIN rps.tender_credit_card
	ON rps.tender_credit_card.tender_sid = t.sid
INNER JOIN rps.store st
	ON st.sid = d.store_sid
WHERE d.STATUS = 4
ORDER BY "Post Date"
	, "Line No"
