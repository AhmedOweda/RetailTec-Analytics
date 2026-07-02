
SELECT DO.SBS_NO As "Subsidiary No"
	,DO.STORE_CODE As "Store Code"
	,DO.STORE_NAME As "Store Name"
	,DI.EMPLOYEE1_FULL_NAME AS "Associate"
	,DO.CASHIER_FULL_NAME AS "Cashier"
	,DO.BT_ID AS "Customer ID"
	,DO.BT_FIRST_NAME || ' ' || DO.BT_LAST_NAME AS "Customer Full Name"
	,TRUNC(DO.INVC_POST_DATE) AS "Invoice Date"
	,TO_CHAR(DO.INVC_POST_DATE, 'HH24:MI:SS') AS "Invoice Time"
	,DO.DOC_NO AS "Document No"
	,(
		CASE 
			WHEN DI.ITEM_TYPE = 1
				THEN 'Sale'
			WHEN DI.ITEM_TYPE = 2
				THEN 'Return'
			WHEN DI.ITEM_TYPE = 3
				THEN 'Order'
			END
		) AS "Item Type"
	,V.VEND_CODE AS "Vendor Code"
	,V.VEND_NAME AS "Vendor Name"
	,DC.DCS_CODE As "DCS Code"
	,DC.D_NAME AS "Department"
	,DC.C_NAME AS "Class"
	,DC.S_NAME AS "SubClass"
	,I.ALU
	,TO_CHAR(I.UPC) AS UPC
	,I.DESCRIPTION1 AS "Description1"
	,I.DESCRIPTION2 AS "Description2"
	,I.DESCRIPTION3 AS "Description3"
	,I.DESCRIPTION4 AS "Description4"
	,I.ATTRIBUTE AS "Attribute"
	,I.ITEM_SIZE AS "Size"
	,I.UDF1_STRING AS "UDF1"
	,I.UDF2_STRING AS "UDF2"
	,I.UDF3_STRING AS "UDF3"
	,I.UDF4_STRING AS "UDF4"
	,I.UDF5_STRING AS "UDF5"
	,(
		CASE 
			WHEN DI.ITEM_TYPE = 2
				THEN DI.QTY * (- 1)
			WHEN DI.ITEM_TYPE IN (
					1
					,3
					)
				THEN DI.QTY
			END
		) AS "Qty"
	,(
		CASE 
			WHEN DO.USE_VAT = 1
				THEN DI.ORIG_PRICE - NVL(DI.ORIG_TAX_AMT, 0)
			WHEN DO.USE_VAT = 0
				THEN DI.ORIG_PRICE
			END
		) AS "Unit Orig Price WOTax"
	,(
		CASE 
			WHEN DO.USE_VAT = 1
				THEN DI.ORIG_PRICE
			WHEN DO.USE_VAT = 0
				THEN DI.ORIG_PRICE + NVL(DI.ORIG_TAX_AMT, 0)
			END
		) AS "Unit Orig Price WTax"
	,DI.COST AS "Unit Cost"
	,(
		(
			CASE 
				WHEN DO.USE_VAT = 1
					THEN DI.DIP_PRICE - NVL(DI.DIP_TAX_AMT, 0)
				WHEN DO.USE_VAT = 0
					THEN DI.DIP_PRICE
				END
			) - NVL(DI.LTY_PIECE_OF_TBR_DISC_AMT, 0)
		) AS "Unit Price After Disc WOTax"
	,DI.DIP_TAX_AMT AS "Unit Tax Amount"
	,(
		(
			CASE 
				WHEN DO.USE_VAT = 1
					THEN DI.DIP_PRICE
				WHEN DO.USE_VAT = 0
					THEN DI.DIP_PRICE + DI.DIP_TAX_AMT
				END
			) - NVL(DI.LTY_PIECE_OF_TBR_DISC_AMT, 0)
		) AS "Unit Price After Disc WTax"
	,ROUND((
			(
				CASE 
					WHEN DO.USE_VAT = 1
						THEN DI.ORIG_PRICE - NVL(DI.ORIG_TAX_AMT, 0)
					WHEN DO.USE_VAT = 0
						THEN DI.ORIG_PRICE
					END
				) - (
				CASE 
					WHEN DO.USE_VAT = 1
						THEN DI.PRICE - NVL(DI.TAX_AMT, 0)
					WHEN DO.USE_VAT = 0
						THEN DI.PRICE
					END
				)
			), 2) AS "Unit Item Discount"
	,(
		(
			CASE 
				WHEN DO.USE_VAT = 1
					THEN DI.PRICE - NVL(DI.TAX_AMT, 0)
				WHEN DO.USE_VAT = 0
					THEN DI.PRICE
				END
			) - (
			CASE 
				WHEN DO.USE_VAT = 1
					THEN DI.DIP_PRICE - NVL(DI.DIP_TAX_AMT, 0)
				WHEN DO.USE_VAT = 0
					THEN DI.DIP_PRICE
				END
			)
		) AS "Unit Receipt Discount"
	,NVL(DI.LTY_PIECE_OF_TBR_DISC_AMT, 0) AS "Unit Loyalty Discount"
	,(
		(
			CASE 
				WHEN DI.ITEM_TYPE = 2
					THEN DI.QTY * (- 1)
				WHEN DI.ITEM_TYPE IN (
						1
						,3
						)
					THEN DI.QTY
				END
			) * DI.COST
		) AS "Total Cost"
	,(
		CASE 
			WHEN DI.ITEM_TYPE = 2
				THEN DI.QTY * (- 1)
			WHEN DI.ITEM_TYPE IN (
					1
					,3
					)
				THEN DI.QTY
			END
		) * (
		CASE 
			WHEN DO.USE_VAT = 1
				THEN DI.ORIG_PRICE - NVL(DI.ORIG_TAX_AMT, 0)
			WHEN DO.USE_VAT = 0
				THEN DI.ORIG_PRICE
			END
		) AS "Total Orig Price WOTax"
	,(
		(
			CASE 
				WHEN DI.ITEM_TYPE = 2
					THEN DI.QTY * (- 1)
				WHEN DI.ITEM_TYPE IN (
						1
						,3
						)
					THEN DI.QTY
				END
			) * (
			CASE 
				WHEN DO.USE_VAT = 1
					THEN DI.ORIG_PRICE
				WHEN DO.USE_VAT = 0
					THEN DI.ORIG_PRICE + NVL(DI.ORIG_TAX_AMT, 0)
				END
			)
		) AS "Total Orig Price WTax"
	,(
		(
			CASE 
				WHEN DI.ITEM_TYPE = 2
					THEN DI.QTY * (- 1)
				WHEN DI.ITEM_TYPE IN (
						1
						,3
						)
					THEN DI.QTY
				END
			) * (
			(
				CASE 
					WHEN DO.USE_VAT = 1
						THEN DI.DIP_PRICE - DI.DIP_TAX_AMT
					WHEN DO.USE_VAT = 0
						THEN DI.DIP_PRICE
					END
				) - NVL(DI.LTY_PIECE_OF_TBR_DISC_AMT, 0)
			)
		) AS "Total Price After Disc WOTax"
	,(
		(
			CASE 
				WHEN DI.ITEM_TYPE = 2
					THEN DI.QTY * (- 1)
				WHEN DI.ITEM_TYPE IN (
						1
						,3
						)
					THEN DI.QTY
				END
			) * DI.DIP_TAX_AMT
		) AS "Total Tax Amount"
	,(
		(
			CASE 
				WHEN DI.ITEM_TYPE = 2
					THEN DI.QTY * (- 1)
				WHEN DI.ITEM_TYPE IN (
						1
						,3
						)
					THEN DI.QTY
				END
			) * (
			(
				CASE 
					WHEN DO.USE_VAT = 1
						THEN DI.DIP_PRICE
					WHEN DO.USE_VAT = 0
						THEN DI.DIP_PRICE + DI.DIP_TAX_AMT
					END
				) - NVL(DI.LTY_PIECE_OF_TBR_DISC_AMT, 0)
			)
		) AS "Total Price After Disc WTax"
FROM RPS.DOCUMENT_ITEM DI
LEFT JOIN RPS.DOCUMENT DO ON DI.DOC_SID = DO.SID
LEFT JOIN RPS.INVN_SBS_ITEM I ON DI.INVN_SBS_ITEM_SID = I.SID
	AND DO.SUBSIDIARY_SID = I.SBS_SID
LEFT JOIN RPS.DCS DC ON DC.SID = I.DCS_SID
	AND DC.SBS_SID = I.SBS_SID
LEFT JOIN RPS.INVN_SBS_EXTEND UD ON UD.INVN_SBS_ITEM_SID = I.SID
LEFT JOIN RPS.VENDOR V ON V.SID = I.VEND_SID
	AND V.SBS_SID = I.SBS_SID
WHERE DI.CREATED_DATETIME IS NOT NULL
	AND DO.DOC_NO > 0
	AND DI.KIT_FLAG <> 5
	AND DO.STATUS = 4
	AND DI.ITEM_TYPE IN (
		1
		,2
		)
ORDER BY DO.CREATED_DATETIME DESC
