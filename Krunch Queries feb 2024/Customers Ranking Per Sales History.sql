SELECT
    *
FROM
    (
        SELECT
            d.sbs_no           AS "Subsidiary No",
            d.store_no         AS "Store No",
            d.store_code       AS "Store Code",
            DENSE_RANK()
            OVER(PARTITION BY d.sbs_no,
                              d.store_no
                 ORDER BY
                     d.sbs_no,
                     d.store_no,
                     SUM(d.transaction_subtotal_with_tax) DESC
            )                  "Ranks",
            d.bt_id            AS "Customer ID",
            d.bt_first_name
            || ' '
            || d.bt_last_name  AS "Customer Name",
            d.bt_address_line1 AS "Customer Address",
            d.bt_address_line2 AS "Customer Address 2",
            d.bt_email         AS "Customer Email",
            SUM(d.sold_qty)    AS "Sold Qty",
            SUM(d.return_qty)  AS "Return Qty",
            round(SUM(d.transaction_subtotal_with_tax), 2)    AS "Sold Value"
        FROM
            rps.document d
        WHERE
            d.bt_id IS NOT NULL
            AND 1 = 1
            AND d.receipt_type IN ( 0, 1 )
            AND d.status = 4
            AND =-=trunc(d.invc_post_date)=-=
        GROUP BY
            d.sbs_no,
            d.store_no,
            d.store_code,
            d.bt_id,
            d.bt_address_line1,
            d.bt_address_line2,
            d.bt_email,
            d.bt_first_name,
            d.bt_last_name
    ) a
WHERE
    1 = 1
    AND =-= Ranks =-=
