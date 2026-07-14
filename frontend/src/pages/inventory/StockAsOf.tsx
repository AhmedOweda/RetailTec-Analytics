/**
 * Stock by Date — stock position of every item × store on any chosen date.
 *
 * Built on FACT_INVENTORY_HISTORY carry-forward semantics: each history row
 * stores the ABSOLUTE on-hand qty after a change, so stock on date D is the
 * LAST row per item×store on or before D. The backend does that; this page
 * just picks the date, filters, and grouping.
 */
import { useState, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import axios from 'axios'
import {
  Box, Typography, Stack, TextField, MenuItem, Card, CardContent, Alert,
} from '@mui/material'
import { AgGridReact } from 'ag-grid-react'
import 'ag-grid-community/styles/ag-grid.css'
import 'ag-grid-community/styles/ag-theme-alpine.css'
import KpiCard from '../../components/KpiCard'
import GridExportBar from '../../components/GridExportBar'
import { useGridColumnState } from '../../hooks/useGridColumnState'
import { noRowsOverlay } from '../../utils/gridOverlay'
import { num, money } from '../../utils/formatters'
import { tr } from '../../i18n'
import TitleLoader from '../../components/TitleLoader'

const today = new Date().toISOString().slice(0, 10)

const GROUPS = [
  { value: 'item_store', label: 'Item × Store' },
  { value: 'item',       label: 'Item'         },
  { value: 'store',      label: 'Store'        },
  { value: 'dept',       label: 'Department'   },
  { value: 'vendor',     label: 'Supplier'     },
]

export default function InventoryStockAsOf() {
  const gridRef = useRef<AgGridReact>(null)
  const cols = useGridColumnState('inv-stock-asof')
  const [asof,    setAsof]    = useState(today)
  const [store,   setStore]   = useState('')
  const [groupBy, setGroupBy] = useState('item_store')
  const [search,  setSearch]  = useState('')

  const params = {
    asof,
    group_by: groupBy,
    ...(store ? { stores: store } : {}),
    ...(search.trim() ? { search: search.trim() } : {}),
  }

  const { data: stores = [] } = useQuery({
    queryKey: ['stores'],
    queryFn: () => axios.get('/api/stores').then(r => r.data),
  })
  const { data: kpi } = useQuery({
    queryKey: ['asof-kpi', asof, store],
    queryFn: () => axios.get('/api/inventory/stock-asof/kpi',
      { params: { asof, ...(store ? { stores: store } : {}) } }).then(r => r.data),
  })
  const { data: rows = [], isFetching } = useQuery({
    queryKey: ['asof-rows', asof, store, groupBy, search],
    queryFn: () => axios.get('/api/inventory/stock-asof', { params }).then(r => r.data),
  })

  const beforeHistory = kpi?.history_start && asof < kpi.history_start

  const gridDefault = { sortable: true, filter: true, resizable: true, wrapHeaderText: true, autoHeaderHeight: true }

  const numCols = [
    { field: 'qty',        headerName: 'Qty',        type: 'numericColumn', flex: 0.8 },
    { field: 'cost_value', headerName: 'Cost Value', type: 'numericColumn', flex: 1,
      valueFormatter: (p: any) => p.value == null ? '' : money(p.value) },
  ]
  const colDefs: any[] =
    groupBy === 'item_store' ? [
      { field: 'store_name',  headerName: 'Store',       flex: 1.2 },
      { field: 'alu',         headerName: 'ALU',         flex: 1 },
      { field: 'upc',         headerName: 'UPC',         flex: 1 },
      { field: 'description', headerName: 'Description', flex: 2 },
      { field: 'department',  headerName: 'Dept',        flex: 1 },
      { field: 'vendor',      headerName: 'Item Vendor', flex: 1 },
      { field: 'qty',         headerName: 'Qty',         type: 'numericColumn', flex: 0.7 },
      { field: 'unit_cost',   headerName: 'Unit Cost',   type: 'numericColumn', flex: 0.8,
        valueFormatter: (p: any) => p.value == null ? '' : money(p.value) },
      ...numCols.slice(1),
    ] :
    groupBy === 'item' ? [
      { field: 'alu',         headerName: 'ALU',         flex: 1 },
      { field: 'upc',         headerName: 'UPC',         flex: 1 },
      { field: 'description', headerName: 'Description', flex: 2 },
      { field: 'department',  headerName: 'Dept',        flex: 1 },
      { field: 'vendor',      headerName: 'Item Vendor', flex: 1 },
      { field: 'store_count', headerName: 'Stores',      type: 'numericColumn', flex: 0.7 },
      ...numCols,
    ] :
    groupBy === 'store' ? [
      { field: 'store_name', headerName: 'Store', flex: 1.5 },
      { field: 'sku_count',  headerName: 'SKUs',  type: 'numericColumn', flex: 0.8 },
      ...numCols,
    ] :
    groupBy === 'vendor' ? [
      { field: 'vendor',    headerName: 'Supplier', flex: 1.5 },
      { field: 'sku_count', headerName: 'SKUs',     type: 'numericColumn', flex: 0.8 },
      ...numCols,
    ] : [
      { field: 'department', headerName: 'Department', flex: 1.5 },
      { field: 'sku_count',  headerName: 'SKUs',       type: 'numericColumn', flex: 0.8 },
      ...numCols,
    ]

  return (
    <Box sx={{ pt: 0, px: 3, pb: 3 }}>
      {/* ── Sticky filter bar ── */}
      <Box sx={{ position:'sticky', top:0, zIndex:10, bgcolor:'#f8fafc',
                 mx:-3, px:3, pt:2.5, pb:1.5, mb:2, borderBottom:'1px solid #e9e4ff' }}>
        <Typography variant="h6" fontWeight={700} sx={{ fontSize: 20 }} mb={1.5}>{tr('Stock by Date')}<TitleLoader /></Typography>
        <Stack direction="row" spacing={2} flexWrap="wrap" useFlexGap>
          <TextField size="small" label={tr('As of')} type="date" value={asof}
            onChange={e => setAsof(e.target.value)} InputLabelProps={{ shrink: true }} />
          <TextField size="small" select label={tr('Store')} value={store}
            onChange={e => setStore(e.target.value)} sx={{ minWidth: 180 }}>
            <MenuItem value="">{tr('All Stores')}</MenuItem>
            {stores.map((s: any) => (
              <MenuItem key={s.STORE_NAME} value={s.STORE_NAME}>{s.STORE_NAME}</MenuItem>
            ))}
          </TextField>
          <TextField size="small" select label={tr('Group by')} value={groupBy}
            onChange={e => setGroupBy(e.target.value)} sx={{ minWidth: 160 }}>
            {GROUPS.map(g => (
              <MenuItem key={g.value} value={g.value}>{tr(g.label)}</MenuItem>
            ))}
          </TextField>
          {(groupBy === 'item_store' || groupBy === 'item') && (
            <TextField size="small" label={tr('Search item')} value={search}
              placeholder="ALU / UPC / Description"
              onChange={e => setSearch(e.target.value)} sx={{ minWidth: 220 }} />
          )}
        </Stack>
      </Box>

      {beforeHistory && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          {tr('Inventory history starts on')} {kpi.history_start} — {tr('stock before this date is not available')}.
        </Alert>
      )}

      <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', mb: 3 }}>
        <KpiCard label="SKUs in Stock"      value={num(kpi?.sku_count, 0)}   icon="ti-barcode" />
        <KpiCard label="Total Qty"          value={num(kpi?.total_qty, 0)}   icon="ti-stack-2" />
        <KpiCard label="Stock Value (Cost)" value={money(kpi?.stock_cost)}   icon="ti-coin" />
        <KpiCard label="Negative Lines"     value={num(kpi?.neg_stock, 0)}   icon="ti-alert-triangle" />
      </Box>

      <Card variant="outlined" sx={{ borderRadius: 2 }}>
        <CardContent>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
            <Typography variant="subtitle1" fontWeight={600}>
              {tr('Stock on')} {asof} ({rows.length.toLocaleString()} {tr('rows')}){isFetching ? ' …' : ''}
            </Typography>
            <GridExportBar gridRef={gridRef} filename={`stock_asof_${asof}`} title={`Stock as of ${asof}`} />
          </Box>
          <Box className="ag-theme-alpine" sx={{ height: 560 }}>
            <AgGridReact ref={gridRef} overlayNoRowsTemplate={noRowsOverlay()} rowData={rows}
              columnDefs={colDefs} defaultColDef={gridDefault} animateRows
              onGridReady={cols.onGridReady} onColumnMoved={cols.onColumnChanged}
              onColumnResized={cols.onColumnChanged} onColumnVisible={cols.onColumnChanged}
              onColumnPinned={cols.onColumnChanged} />
          </Box>
        </CardContent>
      </Card>
    </Box>
  )
}
