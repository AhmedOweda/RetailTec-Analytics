export interface Subsidiary { SID: string; DESCRIPTION: string }
export interface Store { SID: string; STORE_NAME: string; SUBSIDIARY_SID: string; SUBSIDIARY_NAME: string }

export interface KpiRow {
  INVOICES: number; CUSTOMERS: number; STORES: number; PRODUCTS: number
  TOTAL_SALES_WTAX: number; TOTAL_RETURNS: number; NET_SALES_WTAX: number
  NET_SALES_WOTAX: number; TOTAL_COGS: number; GROSS_PROFIT: number
  SOLD_UNITS: number; TAX_AMT: number; DISC_AMT: number
}
export interface KpiPyRow { TOTAL_SALES_PY: number }
export interface TrendRow  { SALE_DATE: string; SALES: number; RETURNS: number; INVOICES: number }
export interface StoreRow  { STORE_NAME: string; SALES: number; RETURNS: number; INVOICES: number; UNITS: number }
export interface ItemRow   { ITEM_NAME: string; ALU: string; DCS_CODE: string; UNITS: number; REVENUE: number; COGS: number; GROSS_PROFIT: number }
export interface EmpRow    { EMPLOYEE: string; INVOICES: number; SALES: number; UNITS: number }
export interface MonthlyRow { SALE_MONTH: string; SALES: number; RETURNS: number; NET: number; GROSS_PROFIT: number; INVOICES: number; ACTIVE_DAYS: number }
export interface TxnRow    { TXN_DATE: string; STORE_NAME: string; DOC_SID: number; EMPLOYEE: string; LINE_ITEMS: number; SALES: number; RETURNS: number; NET: number }

export interface DashboardData {
  kpi: KpiRow[]; kpi_py: KpiPyRow[]; trend: TrendRow[]
  store: StoreRow[]; items: ItemRow[]; emp: EmpRow[]
  monthly: MonthlyRow[]; txn: TxnRow[]; _cached: boolean
}

export interface KpiDerived {
  sales: number; ret: number; net: number; wotax: number
  cogs: number; gp: number; inv: number; units: number
  cust: number; tax: number; disc: number; stores: number
  gmPct: number; retPct: number; avgTkt: number
  avgBsk: number; avgSt: number; yoy: number | null
}

export interface StreamStep {
  key: string; label: string; done: number; total: number; pct: number; error: string | null
}

export interface DashboardParams {
  host: string; dateFrom: string; dateTo: string
  stores: string[]; itemTypes: string; cacheTtl: number
}
