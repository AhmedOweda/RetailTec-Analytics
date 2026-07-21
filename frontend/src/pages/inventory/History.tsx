import { useState, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import axios from 'axios'
import {
  Box, Typography, Stack, TextField, MenuItem, Card, CardContent,
} from '@mui/material'
import ReactECharts from '../../components/ReactEChartsThemed'
import { AgGridReact } from 'ag-grid-react'
import 'ag-grid-community/styles/ag-grid.css'
import 'ag-grid-community/styles/ag-theme-alpine.css'
import KpiCard from '../../components/KpiCard'
import GridExportBar from '../../components/GridExportBar'
import { useGridColumnState } from '../../hooks/useGridColumnState'
import { noRowsOverlay } from '../../utils/gridOverlay'
import { gridLocaleText } from '../../utils/gridLocale'
import { num, moneyExact } from '../../utils/formatters'
import { tr, trCols } from '../../i18n'
import TitleLoader from '../../components/TitleLoader'
import FeatureUnavailable from '../../components/FeatureUnavailable'
import { useFeature, FEATURE_INVENTORY_HISTORY } from '../../hooks/useFeatures'
import { useAppSettings } from '../../context/AppSettings'
import { itemFieldValue } from '../../components/DataSlicer'

// History endpoints alias the identifier columns in lower case
// (alu / upc / description1) — the grid field key per configured identifier.
const ID_FIELD_LC: Record<string, string> = { alu: 'alu', upc: 'upc', description: 'description1' }

const today = new Date().toISOString().slice(0, 10)
const prior = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10)

export default function InventoryHistory() {
  // The configured item identifier (Settings → Product Code Field)
  const { itemId } = useAppSettings()
  const byItemGridRef   = useRef<AgGridReact>(null)
  const colsA = useGridColumnState('inv-history-items')
  const colsB = useGridColumnState('inv-history-details')
  const detailsGridRef  = useRef<AgGridReact>(null)
  const [dateFrom, setDateFrom] = useState(prior)
  const [dateTo,   setDateTo]   = useState(today)
  const [store,    setStore]    = useState('')

  const params = { date_from: dateFrom, date_to: dateTo, ...(store ? { stores: store } : {}) }

  // RPS.INVENTORY_HISTORY is an optional Retail Pro customisation. Where it is
  // not installed this whole page has no source data, so we skip the queries
  // (the backend would answer 200/empty anyway) and explain instead.
  const [histOff, histReason] = useFeature(FEATURE_INVENTORY_HISTORY)
  const on = !histOff

  const { data: stores = [] } = useQuery({
    queryKey: ['stores'],
    queryFn: () => axios.get('/api/stores').then(r => r.data),
  })
  const { data: kpi } = useQuery({
    queryKey: ['invh-kpi', dateFrom, dateTo, store],
    queryFn: () => axios.get('/api/inventory/history/kpi', { params }).then(r => r.data),
    enabled: on,
  })
  const { data: trend = [] } = useQuery({
    queryKey: ['invh-trend', dateFrom, dateTo, store],
    queryFn: () => axios.get('/api/inventory/history/trend', { params }).then(r => r.data),
    enabled: on,
  })
  const { data: byItem = [] } = useQuery({
    queryKey: ['invh-byitem', dateFrom, dateTo, store],
    queryFn: () => axios.get('/api/inventory/history/by-item', { params }).then(r => r.data),
    enabled: on,
  })
  const { data: details = [] } = useQuery({
    queryKey: ['invh-details', dateFrom, dateTo, store],
    queryFn: () => axios.get('/api/inventory/history/details', { params }).then(r => r.data),
    enabled: on,
  })

  // Honest trend: history QTY values are absolute snapshots, so the chart
  // shows EVENT COUNTS (total / inserts / updates) and SKUs touched per day.
  const trendOpt = {
    tooltip: { trigger: 'axis' },
    legend: { data: [tr('Events'), tr('Inserts'), tr('Updates'), tr('SKUs Touched')] },
    grid: { left: 50, right: 20, top: 40, bottom: 30 },
    xAxis: { type: 'category', data: trend.map((r: any) => r.action_date), axisLabel: { fontSize: 11 } },
    yAxis: { type: 'value', axisLabel: { fontSize: 11 } },
    series: [
      { name: tr('Events'),       type: 'bar',  data: trend.map((r: any) => r.event_count),  color: '#ff980055' },
      { name: tr('Inserts'),      type: 'line', data: trend.map((r: any) => r.insert_count), smooth: true, color: '#4caf50', lineStyle: { width: 2 } },
      { name: tr('Updates'),      type: 'line', data: trend.map((r: any) => r.update_count), smooth: true, color: '#2196f3', lineStyle: { width: 2 } },
      { name: tr('SKUs Touched'), type: 'line', data: trend.map((r: any) => r.skus_touched), smooth: true, color: '#9c27b0', lineStyle: { width: 2, type: 'dashed' } },
    ],
  }

  const gridDefault = { sortable: true, filter: true, resizable: true, wrapHeaderText: true, autoHeaderHeight: true }   // filters via header menu

  // The configured identifier column; when Description is configured the
  // Description column IS the identifier (no duplicate). ALU fallback keeps
  // the cell non-blank when the configured field is NULL (UPC often is).
  const idCols = itemId.field !== 'description' ? [{
    field: ID_FIELD_LC[itemId.field], headerName: itemId.label, flex: 1,
    valueGetter: (p: any) => itemFieldValue(p.data, itemId.field),
  }] : []

  const itemCols = [
    ...idCols,
    { field: 'description1', headerName: 'Description', flex: 2 },
    { field: 'department',   headerName: 'Dept',        flex: 1 },
    { field: 'vendor',       headerName: 'Item Vendor', flex: 1,
      headerTooltip: 'Vendor from the item master (catalog) — not necessarily the supplier purchased from' },
    { field: 'event_count',     headerName: 'Events',       type: 'numericColumn', flex: 0.8 },
    { field: 'store_count',     headerName: 'Stores',       type: 'numericColumn', flex: 0.7 },
    { field: 'first_event',     headerName: 'First Event',  flex: 1 },
    { field: 'last_event',      headerName: 'Last Event',   flex: 1 },
    { field: 'stock_at_end',    headerName: 'Stock at End', type: 'numericColumn', flex: 0.9,
      headerTooltip: 'True stock at the end of the period — last history row per store on or before the To date, summed over stores' },
    { field: 'stock_value_end', headerName: 'Value at End', type: 'numericColumn', flex: 1,
      valueFormatter: (p: any) => p.value == null ? '' : moneyExact(p.value) },
  ]

  const detailCols = [
    { field: 'action_date',  headerName: 'Date',        flex: 1 },
    { field: 'action_type',  headerName: 'Type',        flex: 0.7,
      cellStyle: (p: any) => ({ color: p.value === 'INSERT' ? '#4caf50' : '#2196f3', fontWeight: 600 }) },
    { field: 'store_name',   headerName: 'Store',       flex: 1 },
    ...idCols,
    { field: 'description1', headerName: 'Description', flex: 2 },
    { field: 'department',   headerName: 'Dept',        flex: 1 },
    { field: 'qty',          headerName: 'Qty',     type: 'numericColumn', flex: 0.8 },
    { field: 'unit_cost',    headerName: 'Unit Cost',type: 'numericColumn', flex: 0.9 },
    { field: 'cost_value',   headerName: 'Cost Val',type: 'numericColumn', flex: 1 },
  ]

  return (
    <Box sx={{ pt: 0, px: 3, pb: 3 }}>
      {/* ── Sticky filter bar ── */}
      <Box sx={{ position:'sticky', top:0, zIndex:10, bgcolor: 'var(--rt-surface-2)',
                 mx:-3, px:3, pt:2.5, pb:1.5, mb:2, borderBottom:'1px solid var(--rt-border)' }}>
        <Typography variant="h6" fontWeight={700} sx={{ fontSize: 20 }} mb={1.5}>{tr('Inventory History')}<TitleLoader /></Typography>
        <Stack direction="row" spacing={2} flexWrap="wrap">
        <TextField size="small" label={tr('From')} type="date" value={dateFrom}
          onChange={e => setDateFrom(e.target.value)} InputLabelProps={{ shrink: true }} />
        <TextField size="small" label={tr('To')} type="date" value={dateTo}
          onChange={e => setDateTo(e.target.value)} InputLabelProps={{ shrink: true }} />
        <TextField size="small" select label={tr('Store')} value={store}
          onChange={e => setStore(e.target.value)} sx={{ minWidth: 180 }}>
          <MenuItem value="">{tr('All Stores')}</MenuItem>
          {stores.map((s: any) => (
            <MenuItem key={s.STORE_NAME} value={s.STORE_NAME}>{s.STORE_NAME}</MenuItem>
          ))}
        </TextField>
      </Stack>
      </Box>

      {histOff && (
        <FeatureUnavailable
          title="Inventory History is not available on this server"
          reason={histReason || 'Inventory History is a Retail Pro customisation that is not installed on this server.'}
        />
      )}

      {!histOff && (<>
      <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', mb: 3 }}>
        <KpiCard label="Total Events"      value={num(kpi?.total_events, 0)} icon="ti-history" />
        <KpiCard label="SKUs Affected"     value={num(kpi?.sku_count, 0)} icon="ti-barcode" />
        <KpiCard label="Inserts / Updates" value={`${num(kpi?.insert_count, 0)} / ${num(kpi?.update_count, 0)}`} icon="ti-database" />
        <KpiCard label="Item-Store Pairs"  value={num(kpi?.pairs_touched, 0)} icon="ti-grid-dots" />
      </Box>

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
            <AgGridReact localeText={gridLocaleText()} ref={byItemGridRef} overlayNoRowsTemplate={noRowsOverlay()} rowData={byItem} columnDefs={trCols(itemCols as any[])} defaultColDef={gridDefault} animateRows onGridReady={colsA.onGridReady} onColumnMoved={colsA.onColumnChanged} onColumnResized={colsA.onColumnChanged} onColumnVisible={colsA.onColumnChanged} onColumnPinned={colsA.onColumnChanged} />
          </Box>
        </CardContent>
      </Card>

      <Card variant="outlined" sx={{ borderRadius: 2 }}>
        <CardContent>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
            <Typography variant="subtitle1" fontWeight={600}>
              {tr('Change Log')} ({details.length.toLocaleString()} {tr('rows')})
            </Typography>
            <GridExportBar gridRef={detailsGridRef} filename="history_details" title="Inventory History"
              view={tr('Change Log')} filters={`${dateFrom} → ${dateTo} · ${store ? tr('Selected stores') : tr('All stores')}`}
              reportEndpoint="/api/inventory/history/details" reportPeriod="custom" reportParams={params} />
          </Box>
          <Box className="ag-theme-alpine" sx={{ height: 450 }}>
            <AgGridReact localeText={gridLocaleText()} ref={detailsGridRef} overlayNoRowsTemplate={noRowsOverlay()} rowData={details} columnDefs={trCols(detailCols as any[])} defaultColDef={gridDefault} animateRows onGridReady={colsB.onGridReady} onColumnMoved={colsB.onColumnChanged} onColumnResized={colsB.onColumnChanged} onColumnVisible={colsB.onColumnChanged} onColumnPinned={colsB.onColumnChanged} />
          </Box>
        </CardContent>
      </Card>
      </>)}
    </Box>
  )
}