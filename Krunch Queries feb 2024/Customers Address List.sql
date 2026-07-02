SELECT
    t.title          AS "Customer Title",
    c.cust_id        "Customer ID",
    c.first_name
    || ' '
    || c.last_name   "Customer Name",
    cad.address_1    AS "Customer Address1",
    cad.address_2    AS "Customer Address2",
    cad.address_3    AS "Customer Address3",
    cad.postal_code  AS "Postal Code",
    c.info1          AS "Info1",
    c.info2          AS "Info2",
    ce.email_address AS "Customer Email",
    cp.phone_no      AS "Customer Phone",
    s.sbs_no         AS "Customer Subsidiary",
    st.store_code    AS "Customer Store Code",
    st.store_name    AS "Customer Store Name"
FROM
    rps.customer         c
    LEFT JOIN rps.customer_address cad ON c.sid = cad.cust_sid
                                          AND cad.active = 1
    LEFT JOIN rps.customer_email   ce ON c.sid = ce.cust_sid
    LEFT JOIN rps.customer_phone   cp ON c.sid = cp.cust_sid
    LEFT JOIN rps.subsidiary       s ON c.sbs_sid = s.sid
    LEFT JOIN rps.store            st ON c.store_sid = st.sid
                              AND s.sid = st.sbs_sid
    LEFT JOIN rps.title            t ON c.title_sid = t.sid
                             AND c.sbs_sid = t.sbs_sid
WHERE
    c.cust_type != 1
ORDER BY
    "Customer ID"