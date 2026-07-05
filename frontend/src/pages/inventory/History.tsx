import { useState, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import axios from 'axios'
import {
  Box, Typography, Grid, Stack, TextField, MenuItem, Card, CardContent,
} from '@mui/material'
import ReactECharts from 'echarts-for-react'
import { AgGridReact } from 'ag-grid-react'
import 'ag-grid-community/styles/ag-grid.css'
import 'ag-grid-community/styles/ag-theme-alpine.css'
import KpiCard from '../../components/KpiCard'
import GridExportBar from '../../components/GridExportBar'
import { useGridColumnState } from '../../hooks/useGridColumnState'
import { noRowsOverlay } from '../../utils/gridOverlay'
import { moneyPrefix } from '../../utils/formatters'
import { tr } from '../../i18n'
import TitleLoader from '../../components/TitleLoader'

const today = new Date().toISOString().slice(0, 10)
const prior = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10)

export default function InventoryHistory() {
  const byItemGridRef   = useRef<AgGridReact>(null)
  const colsA = useGridColumnState('inv-history-items')
  const colsB = useGridColumnState('inv-history-details')
  const detailsGridRef  = useRef<AgGridReact>(null)
  const [dateFrom, setDateFrom] = useState(prior)
  const [dateTo,   setDateTo]   = useState(today)
  const [store,    setStore]    = useState('')

  const params = { date_from: dateFrom, date_to: dateTo, ...(store ? { stores: store } : {}) }

  const { data: stores = [] } = useQuery({
    queryKey: ['stores'],
    queryFn: () => axios.get('/api/stores').then(r => r.data),
  })
  const { data: kpi } = useQuery({
    queryKey: ['invh-kpi', dateFrom, dateTo, store],
    queryFn: () => axios.get('/api/inventory/history/kpi', { params }).then(r => r.data),
  })
  const { data: trend = [] } = useQuery({
    queryKey: ['invh-trend', dateFrom, dateTo, store],
    queryFn: () => axios.get('/api/inventory/history/trend', { params }).then(r => r.data),
  })
  const { data: byItem = [] } = useQuery({
    queryKey: ['invh-byitem', dateFrom, dateTo, store],
    queryFn: () => axios.get('/api/inventory/history/by-item', { params }).then(r => r.data),
  })
  const { data: details = [] } = useQuery({
    queryKey: ['invh-details', dateFrom, dateTo, store],
    queryFn: () => axios.get('/api/inventory/history/details', { params }).then(r => r.data),
  })

  const fmt    = (n?: number) => n == null ? '—' : n.toLocaleString()
  const fmtCur = (n?: number) => n == null ? '—' : `${moneyPrefix()}${(n ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}`

  const trendOpt = {
    tooltip: { trigger: 'axis' },
    legend: { data: ['INS Qty', 'UPD Qty', 'Events'] },
    grid: { left: 50, right: 20, top: 40, bottom: 30 },
    xAxis: { type: 'category', data: trend.map((r: any) => r.action_date), axisLabel: { fontSize: 11 } },
    yAxis: { type: 'value', axisLabel: { fontSize: 11 } },
    series: [
      { name: tr('INS Qty'),  type: 'line', data: trend.map((r: any) => r.inserted_qty), smooth: true, color: '#4caf50', lineStyle: { width: 2 } },
      { name: tr('UPD Qty'),  type: 'line', data: trend.map((r: any) => r.updated_qty),  smooth: true, color: '#2196f3', lineStyle: { width: 2 } },
      { name: tr('Events'),   type: 'bar',  data: trend.map((r: any) => r.event_count),  color: '#ff980055', yAxisIndex: 0 },
    ],
  }

  const gridDefault = { sortable: true, filter: true, resizable: true, wrapHeaderText: true, autoHeaderHeight: true }   // filters via header menu

  const itemCols = [
    { field: 'alu',          headerName: 'ALU',         flex: 1 },
    { field: 'description1', headerName: 'Description', flex: 2 },
    { field: 'department',   headerName: 'Dept',        flex: 1 },
    { field: 'vendor',       headerName: 'Item Vendor', flex: 1,
      headerTooltip: 'Vendor from the item master (catalog) — not necessarily the supplier purchased from' },
    { field: 'event_count',  headerName: 'Events',  type: 'numericColumn', flex: 0.8 },
    { field: 'last_qty',     headerName: 'Last Qty',type: 'numericColumn', flex: 0.8 },
    { field: 'min_qty',      headerName: 'Min Qty', type: 'numericColumn', flex: 0.8 },
    { field: 'qty_range',    headerName: 'Range',   type: 'numericColumn', flex: 0.8 },
    { field: 'avg_cost',     headerName: 'Avg Cost',type: 'numericColumn', flex: 0.8 },
  ]

  const detailCols = [
    { field: 'action_date',  headerName: 'Date',        flex: 1 },
    { field: 'action_type',  headerName: 'Type',        flex: 0.7,
      cellStyle: (p: any) => ({ color: p.value === 'INSERT' ? '#4caf50' : '#2196f3', fontWeight: 600 }) },
    { field: 'store_name',   headerName: 'Store',       flex: 1 },
    { field: 'alu',          headerName: 'ALU',         flex: 1 },
    { field: 'description1', headerName: 'Description', flex: 2 },
    { field: 'department',   headerName: 'Dept',        flex: 1 },
    { field: 'qty',          headerName: 'Qty',     type: 'numericColumn', flex: 0.8 },
    { field: 'unit_cost',    headerName: 'Unit Cost',type: 'numericColumn', flex: 0.9 },
    { field: 'cost_value',   headerName: 'Cost Val',type: 'numericColumn', flex: 1 },
  ]

  return (
    <Box sx={{ pt: 0, px: 3, pb: 3 }}>
      {/* ── Sticky filter bar ── */}
      <Box sx={{ position:'sticky', top:0, zIndex:10, bgcolor:'#f8fafc',
                 mx:-3, px:3, pt:2.5, pb:1.5, mb:2, borderBottom:'1px solid #e9e4ff' }}>
        <Typography variant="h5" fontWeight={700} mb={1.5}>{tr('Inventory History')}<TitleLoader /></Typography>
        <Stack direction="row" spacing={2} flexWrap="wrap">
        <TextField size="small" label="From" type="date" value={dateFrom}
          onChange={e => setDateFrom(e.target.value)} InputLabelProps={{ shrink: true }} />
        <TextField size="small" label="To" type="date" value={dateTo}
          onChange={e => setDateTo(e.target.value)} InputLabelProps={{ shrink: true }} />
        <TextField size="small" select label="Store" value={store}
          onChange={e => setStore(e.target.value)} sx={{ minWidth: 180 }}>
          <MenuItem value="">All Stores</MenuItem>
          {stores.map((s: any) => (
            <MenuItem key={s.STORE_NAME} value={s.STORE_NAME}>{s.STORE_NAME}</MenuItem>
          ))}
        </TextField>
      </Stack>
      </Box>

      <Grid container spacing={2} mb={3}>
        <Grid item xs={6} sm={3}><KpiCard label="Total Events"      value={fmt(kpi?.total_events)} icon="ti-history" /></Grid>
        <Grid item xs={6} sm={3}><KpiCard label="SKUs Affected"     value={fmt(kpi?.sku_count)} icon="ti-barcode" /></Grid>
        <Grid item xs={6} sm={3}><KpiCard label="Inserts / Updates" value={`${fmt(kpi?.insert_count)} / ${fmt(kpi?.update_count)}`} icon="ti-database" /></Grid>
        <Grid item xs={6} sm={3}><KpiCard label="Total Cost Value"  value={fmtCur(kpi?.total_cost_value)} icon="ti-coin" /></Grid>
      </Grid>

      <Card variant="outlined" sx={{ borderRadius: 2, mb: 3 }}>
        <CardContent>
          <Typography variant="subtitle1" fontWeight={600} mb={1}>{tr('Daily Inventory Changes')}</Typography>
          <ReactECharts option={trendOpt} style={{ height: 280 }} />
        </CardContent>
      </Card>

      <Card variant="outlined" sx={{ borderRadius: 2, mb: 3 }}>
        <CardContent>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
            <Typography variant="subtitle1" fontWeight={600}>{tr('Most Active Items')}</Typography>
            <GridExportBar gridRef={byItemGridRef} filename="history_by_item" title="Inventory History — Most Active Items" />
          </Box>
          <Box className="ag-theme-alpine" sx={{ height: 300 }}>
            <AgGridReact ref={byItemGridRef} overlayNoRowsTemplate={noRowsOverlay()} rowData={byItem} columnDefs={itemCols} defaultColDef={gridDefault} animateRows onGridReady={colsA.onGridReady} onColumnMoved={colsA.onColumnChanged} onColumnResized={colsA.onColumnChanged} onColumnVisible={colsA.onColumnChanged} onColumnPinned={colsA.onColumnChanged} />
          </Box>
        </CardContent>
      </Card>

      <Card variant="outlined" sx={{ borderRadius: 2 }}>
        <CardContent>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
            <Typography variant="subtitle1" fontWeight={600}>
              Change Log ({details.length.toLocaleString()} rows)
            </Typography>
            <GridExportBar gridRef={detailsGridRef} filename="history_details" title="Inventory History — Change Log" />
          </Box>
          <Box className="ag-theme-alpine" sx={{ height: 450 }}>
            <AgGridReact ref={detailsGridRef} overlayNoRowsTemplate={noRowsOverlay()} rowData={details} columnDefs={detailCols} defaultColDef={gridDefault} animateRows onGridReady={colsB.onGridReady} onColumnMoved={colsB.onColumnChanged} onColumnResized={colsB.onColumnChanged} onColumnVisible={colsB.onColumnChanged} onColumnPinned={colsB.onColumnChanged} />
          </Box>
        </CardContent>
      </Card>
    </Box>
  )
}