SELECT s.sbs_no AS "Subsidiary No"
	, st.store_code AS "Store Code"
	, st.store_name AS "Store Name"
	, a.adj_no AS "Document No"
	, a.created_by AS "Created By"
	, e.full_name AS "Associate"
	, a.created_datetime AS "Change Date"
	, a.creating_doc_type AS "Creation Type No"
	, CASE 
		WHEN a.creating_doc_type = 0
			THEN 'None'
		WHEN a.creating_doc_type = 1
			THEN 'PI'
		WHEN a.creating_doc_type = 2
			THEN 'CostOverwrite'
		WHEN a.creating_doc_type = 3
			THEN 'Markdown'
		WHEN a.creating_doc_type = 4
			THEN 'Cleanup'
		WHEN a.creating_doc_type = 5
			THEN 'PlannedPricing'
		WHEN a.creating_doc_type = 6
			THEN 'PlannedMarkdown'
		WHEN a.creating_doc_type = 7
			THEN 'Inventory'
		WHEN a.creating_doc_type = 8
			THEN 'Manual'
		WHEN a.creating_doc_type = 9
			THEN 'Reversing'
		WHEN a.creating_doc_type = 10
			THEN 'CostLeave'
		WHEN a.creating_doc_type = 11
			THEN 'Audit'
		WHEN a.creating_doc_type = 12
			THEN 'Corporate'
		WHEN a.creating_doc_type = 13
			THEN 'Kit'
		WHEN a.creating_doc_type = 14
			THEN 'UnverifiedSlip'
		END AS "Creation Type"
	, r.name AS "Reason"
	, ai.Item_pos AS "Item Line"
	, d.dcs_code AS "DCS Code"
	, i.alu
	, to_char(i.upc) AS upc
	, i.description1 AS "Description1"
	, i.description2 AS "Description2"
	, i.description3 AS "Description3"
	, i.description4 AS "Description4"
	, i.item_size AS "Size"
	, i.attribute AS "Attribute"
	, v.vend_code AS "Vendor Code"
	, v.vend_name AS "Vendor Name"
	, nvl(ai.cost, 0) AS "Unit Cost"
	, nvl(ai.orig_value, 0) AS "Original Price"
	, nvl(ai.adj_value, 0) AS "Adjusted Price"
	, nvl(ai.adj_value, 0) - nvl(ai.orig_value, 0) AS "Price Difference"
	, nvl(ai.orig_Tax, 0) AS "Original Tax"
	, nvl(ai.adj_Tax, 0) AS "Adjusted Tax"
	, pl.price_lvl_name AS "Price Level"
	, adc1.comments AS "Comment1"
	, adc2.comments AS "Comment2"
FROM rps.adjustment a
INNER JOIN rps.adj_item ai
	ON a.sid = ai.adj_sid
INNER JOIN rps.subsidiary s
	ON a.sbs_sid = s.sid
LEFT JOIN rps.store st
	ON s.sid = st.sbs_sid
		AND a.store_sid = st.sid
LEFT JOIN rps.employee e
	ON e.sid = a.createdby_sid
LEFT JOIN rps.pref_reason r
	ON r.sid = a.adj_reason_sid
LEFT JOIN rps.invn_sbs_item i
	ON i.sid = ai.item_sid
LEFT JOIN rps.dcs d
	ON d.sid = i.dcs_sid
LEFT JOIN rps.vendor v
	ON v.sid = i.vend_sid
LEFT JOIN rps.price_level pl
	ON pl.sid = a.price_lvl_sid
LEFT JOIN (
	SELECT adj_sid
		, comments
	FROM rps.adj_comment
	WHERE comment_no = 1
	) adc1
	ON a.sid = adc1.adj_sid
LEFT JOIN (
	SELECT adj_sid
		, comments
	FROM rps.adj_comment
	WHERE comment_no = 2
	) adc2
	ON a.sid = adc2.adj_sid	
WHERE a.adj_type = 1
	AND a.held = 0
	AND a.STATUS = 4
	order by a.created_datetime,ai.item_pos