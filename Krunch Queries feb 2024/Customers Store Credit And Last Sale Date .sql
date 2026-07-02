SELECT
    s.sbs_no         AS "Subsidiary No",
    st.store_no      AS "Store No",
    st.store_code    AS "Store Code",
    st.store_name    AS "Store Name",
    c.cust_id        AS "Customer ID",
    c.first_name
    || ' '
    || c.last_name   "Customer Name",
    round(SUM(nvl(c.central_credit,0)),
          2)         "Central Credit",
    round(SUM(nvl(c.store_credit,0)),
          2)         "Store Credit",
    c.last_sale_date AS "Last Sale Date"

FROM
    rps.customer   c
    LEFT JOIN rps.subsidiary s ON c.sbs_sid = s.sid
    LEFT JOIN rps.store      st ON c.store_sid = st.sid
                              AND s.sid = st.sbs_sid
WHERE
    c.cust_type <> 1
GROUP BY
    s.sbs_no,
    st.store_no,
    st.store_code,
    st.store_name,
    c.cust_id,
    c.first_name
    || ' '
    || c.last_name,
    c.last_sale_date