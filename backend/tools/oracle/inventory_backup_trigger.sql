-----------------------------------------------------------------------------------------------------
-- RetailTec inventory change-capture (installed per customer Oracle server).
-- Baseline snapshot + AFTER INSERT/UPDATE trigger on RPS.INVN_SBS_ITEM_QTY.
-- QTY in every row is the ABSOLUTE on-hand after the action (carry-forward
-- semantics): stock as of date D = last row per item x store on or before D.
-----------------------------------------------------------------------------------------------------
-- create error log table
-----------------------------------------------------------------------------------------------------
  CREATE TABLE "RPS"."ERROR_LOG"
   (	"OBJECT_NAME" VARCHAR2(100 BYTE),
	"ERROR_MESSAGE" VARCHAR2(4000 BYTE),
	"ERROR_TIMESTAMP" TIMESTAMP (6) DEFAULT systimestamp
   ) ;
 /
-----------------------------------------------------------------------------------------------------
-- Create the history table
-----------------------------------------------------------------------------------------------------
CREATE TABLE RPS.INVENTORY_HISTORY (
    HISTORY_SID NUMBER(19) NOT NULL,
    ACTION_TYPE VARCHAR2(10) NOT NULL, -- 'INSERT' or 'UPDATE'
    ACTION_DATE TIMESTAMP(0) WITH TIME ZONE NOT NULL,
    INVN_SBS_ITEM_QTY_SID NUMBER(19) NOT NULL,
    CREATED_BY NVARCHAR2(30) NOT NULL,
    CREATED_DATETIME TIMESTAMP(0) WITH TIME ZONE NOT NULL,
    MODIFIED_BY NVARCHAR2(30),
    MODIFIED_DATETIME TIMESTAMP(0) WITH TIME ZONE,
    SBS_SID NUMBER(19) NOT NULL,
    STORE_SID NUMBER(19) NOT NULL,
    QTY NUMBER(10,3),
    INVN_SBS_ITEM_SID NUMBER(19) NOT NULL,
    COST NUMBER(16,4)  -- Added to store cost from INVN_SBS_ITEM
);
/
-----------------------------------------------------------------------------------------------------
-- Create sequence for history table
-----------------------------------------------------------------------------------------------------
CREATE SEQUENCE RPS.INVN_HIS_SEQ
    START WITH 10000000000000000
    INCREMENT BY 1
    NOCACHE
    NOCYCLE;
/
-----------------------------------------------------------------------------------------------------
-- Intiallize the INVENTORY_HISTORY table
-----------------------------------------------------------------------------------------------------
BEGIN
    INSERT INTO RPS.INVENTORY_HISTORY (
        HISTORY_SID,
        ACTION_TYPE,
        ACTION_DATE,
        INVN_SBS_ITEM_QTY_SID,
        CREATED_BY,
        CREATED_DATETIME,
        MODIFIED_BY,
        MODIFIED_DATETIME,
        SBS_SID,
        STORE_SID,
        QTY,
        INVN_SBS_ITEM_SID,
        COST
    )
    SELECT
        RPS.INVN_HIS_SEQ.NEXTVAL,
        'INSERT',                   -- Action type for the initial load
        SYSTIMESTAMP,
        IQ.SID,
        IQ.CREATED_BY,
        IQ.CREATED_DATETIME,
        IQ.MODIFIED_BY,
        IQ.MODIFIED_DATETIME,
        IQ.SBS_SID,
        IQ.STORE_SID,
        IQ.QTY,
        IQ.INVN_SBS_ITEM_SID,
        NVL(IT.COST, 0)
    FROM
        RPS.INVN_SBS_ITEM_QTY IQ
    LEFT JOIN
        RPS.INVN_SBS_ITEM IT
    ON
        IQ.INVN_SBS_ITEM_SID = IT.SID; -- Join to get the COST
END;
/
-----------------------------------------------------------------------------------------------------
-- Create the trigger
-----------------------------------------------------------------------------------------------------
CREATE OR REPLACE TRIGGER RPS.INVN_BACKUP_TRG
AFTER INSERT OR UPDATE ON RPS.INVN_SBS_ITEM_QTY
FOR EACH ROW

DECLARE
    v_cost NUMBER(16,4);
    v_action_type VARCHAR2(10);
    v_error_msg VARCHAR2(4000);
BEGIN
    -- Get the cost from INVN_SBS_ITEM
    SELECT NVL(IT.COST, 0) INTO v_cost
    FROM RPS.INVN_SBS_ITEM IT
    WHERE IT.SID = :NEW.INVN_SBS_ITEM_SID;

    -- Determine action type
    IF INSERTING THEN
        v_action_type := 'INSERT';

        -- Only log if QTY > 0
        IF :NEW.QTY > 0 THEN
            INSERT INTO RPS.INVENTORY_HISTORY (
                HISTORY_SID, ACTION_TYPE, ACTION_DATE, INVN_SBS_ITEM_QTY_SID,
                CREATED_BY, CREATED_DATETIME, MODIFIED_BY, MODIFIED_DATETIME,
                SBS_SID, STORE_SID, QTY, INVN_SBS_ITEM_SID, COST
            )
            VALUES (
                RPS.INVN_HIS_SEQ.NEXTVAL, v_action_type, SYSTIMESTAMP, :NEW.SID,
                :NEW.CREATED_BY, :NEW.CREATED_DATETIME, :NEW.MODIFIED_BY, :NEW.MODIFIED_DATETIME,
                :NEW.SBS_SID, :NEW.STORE_SID, :NEW.QTY, :NEW.INVN_SBS_ITEM_SID, v_cost
            );
        END IF;

    ELSIF UPDATING THEN
        v_action_type := 'UPDATE';

        IF :OLD.QTY <> :NEW.QTY  THEN
            INSERT INTO RPS.INVENTORY_HISTORY (
                HISTORY_SID, ACTION_TYPE, ACTION_DATE, INVN_SBS_ITEM_QTY_SID,
                CREATED_BY, CREATED_DATETIME, MODIFIED_BY, MODIFIED_DATETIME,
                SBS_SID, STORE_SID, QTY, INVN_SBS_ITEM_SID, COST
            )
            VALUES (
                RPS.INVN_HIS_SEQ.NEXTVAL, v_action_type, SYSTIMESTAMP, :NEW.SID,
                :NEW.CREATED_BY, :NEW.CREATED_DATETIME, :NEW.MODIFIED_BY, :NEW.MODIFIED_DATETIME,
                :NEW.SBS_SID, :NEW.STORE_SID, :NEW.QTY, :NEW.INVN_SBS_ITEM_SID, v_cost
            );
        END IF;
    END IF;

EXCEPTION
    WHEN OTHERS THEN
        v_error_msg := SQLERRM;
        BEGIN
            INSERT INTO RPS.ERROR_LOG (OBJECT_NAME, ERROR_MESSAGE)
            VALUES ('INVN_BACKUP_TRG', v_error_msg);
        EXCEPTION
            WHEN OTHERS THEN
                NULL;
        END;
END;
/
-----------------------------------------------------------------------------------------------------
-- Create indexes for better performance
-----------------------------------------------------------------------------------------------------
CREATE INDEX RPS.IDX_INV_HIST_DATE ON RPS.INVENTORY_HISTORY(ACTION_DATE);
CREATE INDEX RPS.IDX_INV_HIST_ITEM ON RPS.INVENTORY_HISTORY(INVN_SBS_ITEM_SID, STORE_SID);
-----------------------------------------------------------------------------------------------------
-- Grant select access for REPORTUSER
-----------------------------------------------------------------------------------------------------
GRANT SELECT ON RPS.INVENTORY_HISTORY TO REPORTUSER;
