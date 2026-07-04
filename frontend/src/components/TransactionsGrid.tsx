import { useMemo } from 'react'
import { AgGridReact } from 'ag-grid-react'
import { ModuleRegistry, ClientSideRowModelModule } from 'ag-grid-community'
import type { ColDef } from 'ag-grid-community'
import type { TxnRow } from '../types'
import { fmt } from '../utils/formatters'
import 'ag-grid-community/styles/ag-grid.css'
import 'ag-grid-community/styles/ag-theme-alpine.css'

ModuleRegistry.registerModules([ClientSideRowModelModule])

const sarFormatter = (p: { value: number }) => p.value != null ? `SAR ${fmt(p.value)}` : '—'

const COL_DEFS: ColDef<TxnRow>[] = [
  { field: 'TXN_DATE',   headerName: 'Date',        width: 100, sortable: true, filter: true },
  { field: 'STORE_NAME', headerName: 'Store',       flex: 1,    sortable: true, filter: true, minWidth: 120 },
  { field: 'DOC_SID',    headerName: 'Doc #',       width: 90,  sortable: true },
  { field: 'EMPLOYEE',   headerName: 'Employee',    flex: 1,    sortable: true, filter: true, minWidth: 110 },
  { field: 'LINE_ITEMS', headerName: 'Lines',       width: 70,  sortable: true, type: 'numericColumn' },
  { field: 'SALES',      headerName: 'Sales (SAR)', width: 120, sortable: true, type: 'numericColumn', valueFormatter: sarFormatter },
  { field: 'RETURNS',    headerName: 'Returns',     width: 110, sortable: true, type: 'numericColumn', valueFormatter: sarFormatter },
  { field: 'NET',        headerName: 'Net (SAR)',   width: 120, sortable: true, type: 'numericColumn', valueFormatter: sarFormatter,
    cellStyle: (p) => ({ color: p.value < 0 ? '#E05B5B' : '#1B7A3E', fontWeight: 600 }) },
]

export default function TransactionsGrid({ rows }: { rows: TxnRow[] }) {
  const defaultColDef = useMemo<ColDef>(() => ({
    resizable: true,
    sortable: true,
    suppressMovable: false,
    wrapHeaderText: true,
    autoHeaderHeight: true,
  }), [])

  return (
    <div
      className="ag-theme-alpine"
      style={{
        height: 340,
        '--ag-header-background-color': '#1A0D45',
        '--ag-header-foreground-color': '#C8A8E8',
        '--ag-header-column-separator-color': 'rgba(155,101,208,0.3)',
        '--ag-border-color': '#EDE8F8',
        '--ag-row-border-color': '#F0EBF8',
        '--ag-odd-row-background-color': '#FAFAFE',
        '--ag-selected-row-background-color': '#EDE8F8',
        '--ag-font-family': 'Manrope, sans-serif',
        '--ag-font-size': '12px',
        '--ag-row-hover-color': '#F5F0FF',
        '--ag-header-font-size': '11px',
        '--ag-header-font-weight': '700',
        '--ag-cell-horizontal-padding': '12px',
        '--ag-row-height': '36px',
        '--ag-header-height': '38px',
      } as React.CSSProperties}
    >
      <AgGridReact<TxnRow>
        rowData={rows}
        columnDefs={COL_DEFS}
        defaultColDef={defaultColDef}
        animateRows
        pagination
        paginationPageSize={10}
        paginationPageSizeSelector={[10, 25, 50]}
        suppressCellFocus
        rowSelection="single"
      />
    </div>
  )
}
