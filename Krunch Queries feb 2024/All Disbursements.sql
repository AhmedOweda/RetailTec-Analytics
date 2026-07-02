SELECT sb.sbs_no AS "Subsidiary No"
     s.store_code AS "Store Code"
	 ,s.store_name As "Store Name" 
	,to_date(to_char(de.created_datetime, 'dd/mm/yyyy'), 'dd/mm/yyyy') AS "Created Date"
	,to_char(de.created_datetime, 'hh:mi:ss a.m.') AS "Created Time"
	,w.workstation_no AS "Workstation No"
	,de.drawer_number AS "Drawer No"
	,de.sequence_no AS "Disbursement No"
	,(
		CASE de.event_type
			WHEN 3
				THEN 'Cash Drop'
			WHEN 5
				THEN 'Paid In'
			WHEN 6
				THEN 'Paid Out'
			ELSE ''
			END
		) AS "Disb Type"
	,pr.name AS "Disb Reason"
	,e.full_name AS "Cashier"
	,round(de.currency_total, 2) AS "Amount"
FROM rps.drawer_event de
INNER JOIN rps.store s ON s.sid = de.store_sid
INNER JOIN rps.subsidiary sb on sb.sid = s.sbs_sid
LEFT JOIN rps.workstation w ON w.sid = de.workstation_sid
LEFT JOIN rps.pref_reason pr ON pr.sid = de.reason_sid
LEFT JOIN rps.employee e ON upper(e.empl_name) = upper(de.created_by)
WHERE de.event_type IN (3,5,6)
	AND de.finalized = 1
ORDER BY de.created_datetime DESC
