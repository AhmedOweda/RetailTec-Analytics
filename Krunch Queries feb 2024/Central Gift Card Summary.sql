SELECT DISTINCT sl.doc_no AS "Creation Document No"
	, sl.store_name AS "Created At"
	, sl.invc_post_date AS "Creation Date"
	, sl.gift_activation_code AS "Card Code"
	, sl.orig_price AS "Price Before Discount"
	, sl.disc_amt AS "Discount Amount"
	, sl.price AS "Price After Discount"
	, sl.qty AS "Qty"
	, sl.tender_name AS "Purchase Payment"
	, rdm.doc_no AS "Redeem Document No"
	, rdm.store_name AS "Redeem store"
	, rdm.invc_post_date AS "Redeem date"
	, rdm.original_balance AS "Original Balance"
	, rdm.amount AS "Redeemed Amount"
	, rdm.balance AS "End Balance"
FROM (
	SELECT cc.sbs_no
		, cc.store_no
		, d.doc_no
		, d.store_name
		, d.invc_post_date
		, d.sid
		, tc.central_card_number
		, cc.gift_card_state
		, cc.original_balance
		, cc.balance
		, tc.central_credit_balance
		, t.amount
		, t.taken
		, t.given
		, t.tender_name
	FROM rps.document d
	LEFT JOIN rps.tender t
		ON d.sid = t.doc_sid
	INNER JOIN rps.tender_central_gift_card tc
		ON t.sid = tc.tender_sid
	LEFT JOIN rps.central_gift_card cc
		ON cc.gift_card_no = tc.central_card_number
	WHERE d.STATUS = 4
		AND d.doc_no IS NOT NULL
	) rdm
RIGHT JOIN (
	SELECT d.sbs_no
		, d.store_no
		, d.invc_post_date
		, d.store_name
		, d.doc_no
		, b.gift_activation_code
		, b.orig_price
		, b.disc_amt
		, b.price
		, b.qty
		, t.tender_name
	FROM rps.document d
	INNER JOIN rps.document_item b
		ON d.sid = b.doc_sid
			AND b.kit_flag = 10
	LEFT JOIN rps.tender t
		ON d.sid = t.doc_sid
	WHERE d.STATUS = 4
		AND d.doc_no IS NOT NULL
	) sl
	ON sl.sbs_no = rdm.sbs_no
		AND sl.store_no = rdm.store_no
		AND rdm.central_card_number = sl.gift_activation_code
