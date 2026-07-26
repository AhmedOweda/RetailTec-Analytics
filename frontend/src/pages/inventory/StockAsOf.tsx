/**
 * Stock by Date — stock position of every item × store on any chosen date.
 *
 * Built on FACT_INVENTORY_HISTORY carry-forward semantics: each history row
 * stores the ABSOLUTE on-hand qty after a change, so stock on date D is the
 * LAST row per item×store on or before D. The backend does that; this page
 * just picks the date, filters, and grouping.
 */
import { useState, useRef, useMemo } from 'react'
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
import DataSlicer, { splitSlicer, itemFieldValue } from '../../components/DataSlicer'
import { useAppSettings } from '../../context/AppSettings'
import { useGridColumnState } from '../../hooks/useGridColumnState'
import { noRowsOverlay } from '../../utils/gridOverlay'
import { gridLocaleText } from '../../utils/gridLocale'
import { num, money, moneyExact } from '../../utils/formatters'
import { tr, trCols } from '../../i18n'
import TitleLoader from '../../components/TitleLoader'
import FeatureUnavailable from '../../components/FeatureUnavailable'
import { useFeature, FEATURE_INVENTORY_HISTORY } from '../../hooks/useFeatures'

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

  // ── Item slicer — the shared <DataSlicer>, searching ONLY the identifier the
  //    user configured (Settings → Product Code Field). `searchByItemField`
  //    sends `field=<alu|upc|description>`; the endpoint whitelists it and
  //    matches that one column, never the old ALU/UPC/description blob.
  const { itemId } = useAppSettings()
  const [itemSel, setItemSel] = useState<any[]>([])
  const itemToken = (o: any) => (typeof o === 'string' ? o : itemFieldValue(o, itemId.field))
  const { tokens: itemTokens } = splitSlicer(itemSel, undefined, itemToken)
  const searchParam = itemTokens.join('|')

  const params = useMemo(() => ({
    asof,
    group_by: groupBy,
    ...(store ? { stores: store } : {}),
    ...(searchParam ? { search: searchParam, field: itemId.field } : {}),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [asof, groupBy, store, searchParam, itemId.field])

  const { data: stores = [] } = useQuery({
    queryKey: ['stores'],
    queryFn: () => axios.get('/api/stores').then(r => r.data),
  })
  // Carry-forward stock-as-of has exactly one source: the optional
  // RPS.INVENTORY_HISTORY customisation. Absent => the page cannot be computed
  // at all (unlike Ledger, which still has its movement columns).
  const [histOff, histReason] = useFeature(FEATURE_INVENTORY_HISTORY)

  const { data: kpi } = useQuery({
    queryKey: ['asof-kpi', asof, store],
    queryFn: () => axios.get('/api/inventory/stock-asof/kpi',
      { params: { asof, ...(store ? { stores: store } : {}) } }).then(r => r.data),
    enabled: !histOff,
  })
  const { data: rows = [], isFetching } = useQuery({
    queryKey: ['asof-rows', params],
    queryFn: () => axios.get('/api/inventory/stock-asof', { params }).then(r => r.data),
    enabled: !histOff,
  })

  const beforeHistory = kpi?.history_start && asof < kpi.history_start

  const gridDefault = { sortable: true, filter: true, resizable: true, wrapHeaderText: true, autoHeaderHeight: true }

  // ── Measures shared by every grouping ─────────────────────────────────────
  // `qty` is the ON-HAND QUANTITY AS AT `asof`: the endpoint's SNAP CTE keeps
  // the last FACT_INVENTORY_HISTORY row per item×store on or before the date
  // (carry-forward), and each grouping sums that A.QTY. It is the same measure
  // the "Total Qty" KPI reports, so the grids always tie back to the header.
  // Formatted with the shared `num` formatter — no page-local number code.
  const qtyCol = { field: 'qty', headerName: 'Qty', type: 'numericColumn', flex: 0.8,
                   valueFormatter: (p: any) => (p.value == null ? '' : num(p.value, 0)) }
  const numCols = [
    qtyCol,
    { field: 'cost_value', headerName: 'Cost Value', type: 'numericColumn', flex: 1,
      valueFormatter: (p: any) => p.value == null ? '' : moneyExact(p.value) },
  ]
  // ONE identifier column — the one configured in Settings — headed by its
  // own label, so the grid never shows ALU and UPC side by side again.
  const idCol = { field: 'item_code', headerName: itemId.label, flex: 1 }
  const colDefs: any[] =
    groupBy === 'item_store' ? [
      { field: 'store_name',  headerName: 'Store',       flex: 1.2 },
      idCol,
      { field: 'description', headerName: 'Description', flex: 2 },
      { field: 'department',  headerName: 'Dept',        flex: 1 },
      { field: 'vendor',      headerName: 'Item Vendor', flex: 1 },
      { ...qtyCol, flex: 0.7 },
      { field: 'unit_cost',   headerName: 'Unit Cost',   type: 'numericColumn', flex: 0.8,
        valueFormatter: (p: any) => p.value == null ? '' : moneyExact(p.value) },
      ...numCols.slice(1),
    ] :
    groupBy === 'item' ? [
      idCol,
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
      <Box sx={{ position:'sticky', top:0, zIndex:10, bgcolor: 'var(--rt-surface-2)',
                 mx:-3, px:3, pt:2.5, pb:1.5, mb:2, borderBottom:'1px solid var(--rt-border)' }}>
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
          {/* Item — the SAME slicer as Sales → Journals, restricted to the
              configured identifier. Available on every grouping: the filter
              narrows the underlying positions, not just the item grids. */}
          <DataSlicer sx={{ minWidth: 240, maxWidth: 380 }} value={itemSel} onChange={setItemSel}
            searchEndpoint="/api/inventory/items-search"
            getToken={itemToken} itemField={itemId.field} searchByItemField
            placeholder="Item (code / description)"
            renderLabel={(o: any) => (typeof o === 'string' ? { code: o }
              : { code: itemFieldValue(o, itemId.field), rest: o.DESCRIPTION1 })} />
        </Stack>
      </Box>

      {histOff && (
        <FeatureUnavailable
          title="Stock by Date is not available on this server"
          reason={histReason || 'Inventory History is a Retail Pro customisation that is not installed on this server.'}
        />
      )}

      {!histOff && (<>
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
            <GridExportBar gridRef={gridRef} filename={`stock_asof_${asof}`} title={tr('Stock by Date')}
              view={tr(GROUPS.find(g => g.value === groupBy)?.label ?? groupBy)}
              filters={`${tr('As of')} ${asof} · ${store ? tr('Selected stores') : tr('All stores')}`}
              reportEndpoint="/api/inventory/stock-asof" reportPeriod="custom" reportParams={params} />
          </Box>
          <Box className="ag-theme-alpine" sx={{ height: 560 }}>
            <AgGridReact localeText={gridLocaleText()} ref={gridRef} overlayNoRowsTemplate={noRowsOverlay()} rowData={rows}
              columnDefs={trCols(colDefs)} defaultColDef={gridDefault} animateRows
              onGridReady={cols.onGridReady} onColumnMoved={cols.onColumnChanged}
              onColumnResized={cols.onColumnChanged} onColumnVisible={cols.onColumnChanged}
              onColumnPinned={cols.onColumnChanged} />
          </Box>
        </CardContent>
      </Card>
      </>)}
    </Box>
  )
}
