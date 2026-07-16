/**
 * Inventory Movement Ledger
 * Opening Balance → Sales → Transfers In → Transfers Out → Adjustments → Ending Balance
 * Per item × per store for a selected date range
 */
import { useState, useMemo, useRef, useCallback } from 'react'
import { useAppSettings }    from '../../context/AppSettings'
import {
  Box, Typography, Chip, Autocomplete, TextField, Paper,
} from '@mui/material'
import { useGridColumnState } from '../../hooks/useGridColumnState'
import { useQuery }    from '@tanstack/react-query'
import axios           from 'axios'
import { AgGridReact } from 'ag-grid-react'
import type { ColDef } from 'ag-grid-community'
import 'ag-grid-community/styles/ag-grid.css'
import 'ag-grid-community/styles/ag-theme-alpine.css'
import KpiCard from '../../components/KpiCard'
import GridExportBar from '../../components/GridExportBar'
import { noRowsOverlay } from '../../utils/gridOverlay'
import { moneyPrefix, money, num, moneyExact } from '../../utils/formatters'
import { tr, trf, trCols } from '../../i18n'
import TitleLoader from '../../components/TitleLoader'

// ── Colours ─────────────────────────────────────────────────────────────────
const ACCENT    = '#7c3aed'
const C_SLATE   = '#64748b'
const C_OPEN    = '#0891b2'    // opening / ending balance  → teal
const C_SALES   = '#e11d48'    // sales columns             → rose
const C_RECV    = '#059669'    // transfers in              → green
const C_SENT    = '#d97706'    // transfers out             → amber
const C_ADJ_POS = '#059669'
const C_ADJ_NEG = '#e11d48'
const C_END     = '#7c3aed'    // ending balance            → purple

// ── Date helpers ─────────────────────────────────────────────────────────────
const fmt     = (d: Date) => d.toISOString().slice(0, 10)
const today   = () => fmt(new Date())
const mtdStart = () => { const d = new Date(); d.setDate(1); return fmt(d) }
const ytdStart = () => fmt(new Date(new Date().getFullYear(), 0, 1))
const daysAgo  = (n: number) => { const d = new Date(); d.setDate(d.getDate() - n + 1); return fmt(d) }

const PERIODS = [
  { label: '30D', df: () => daysAgo(30), dt: today  },
  { label: 'MTD', df: mtdStart,          dt: today  },
  { label: 'YTD', df: ytdStart,          dt: today  },
  { label: '90D', df: () => daysAgo(90), dt: today  },
] as const

// ── Number formatters ─────────────────────────────────────────────────────────
const fmtN = (v: number, dec = 0) =>
  v == null ? '—' : v.toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec })
const fmtC = (v: number) =>
  v == null ? '—' : moneyExact(v)
const fmtSign = (v: number) => v > 0 ? `+${fmtN(v)}` : fmtN(v)

// ── Column header with colour dot ─────────────────────────────────────────────
function ColHdr({ label, color }: { label: string; color: string }) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
      <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: color, flexShrink: 0 }} />
      <span>{label}</span>
    </Box>
  ) as any
}

// ══════════════════════════════════════════════════════════════════════════════
export default function InventoryLedger() {
  const { productCodeField } = useAppSettings()
  const codeField = productCodeField.toUpperCase()
  const gridRef = useRef<AgGridReact>(null)
  const { onGridReady: onColGridReady, onColumnChanged, resetColumns } = useGridColumnState('ledger')

  const [period,   setPeriod  ] = useState(0)         // 30D default
  const [dateFrom, setDateFrom] = useState(() => daysAgo(30))
  const [dateTo,   setDateTo  ] = useState(today)
  const [selStores, setSelStores] = useState<string[]>([])

  // Item search
  type ItemOpt = { item_sid: number; ALU: string; UPC: string; DESCRIPTION1: string }
  const [selItem, setSelItem] = useState<ItemOpt | null>(null)
  const [itemQ,   setItemQ  ] = useState('')

  // Store list
  const { data: storeList = [] } = useQuery<{ STORE_NAME: string }[]>({
    queryKey: ['stores'],
    queryFn:  () => axios.get('/api/stores').then(r => r.data),
    staleTime: Infinity,
  })

  // Item autocomplete options
  const { data: itemOptions = [] } = useQuery<ItemOpt[]>({
    queryKey: ['items-search', itemQ],
    queryFn:  () => axios.get('/api/inventory/items-search', { params: { q: itemQ } }).then(r => r.data),
    enabled:  itemQ.trim().length >= 2,
    staleTime: 30_000,
  })

  const storeNames  = storeList.map(s => s.STORE_NAME)
  const storesParam = selStores.length ? selStores.join(',') : undefined
  const qParams = {
    date_from: dateFrom,
    date_to:   dateTo,
    ...(storesParam       ? { stores:   storesParam      } : {}),
    ...(selItem?.item_sid ? { item_sid: selItem.item_sid } : {}),
  }

  // KPI query
  const { data: kpi } = useQuery({
    queryKey: ['ledger-kpi', dateFrom, dateTo, storesParam, selItem?.item_sid],
    queryFn:  () => axios.get('/api/inventory/ledger/kpi', { params: qParams }).then(r => r.data),
    gcTime: 0, refetchOnMount: 'always',
  })

  // Ledger rows
  const { data: rows = [], isFetching } = useQuery<any[]>({
    queryKey: ['ledger-rows', dateFrom, dateTo, storesParam, selItem?.item_sid],
    queryFn:  () => axios.get('/api/inventory/ledger', { params: qParams }).then(r => r.data),
    gcTime: 0, refetchOnMount: 'always',
  })

  // Period chip handler
  const selectPeriod = (i: number) => {
    setPeriod(i)
    setDateFrom(PERIODS[i].df())
    setDateTo(PERIODS[i].dt())
  }

  // ── AG Grid columns ────────────────────────────────────────────────────────
  const columns = useMemo<ColDef[]>(() => [
    // ── Identity
    { field: productCodeField, headerName: codeField,   pinned: 'left', width: 100,
      cellStyle: { fontFamily: 'monospace', color: ACCENT, fontWeight: 700, display: 'flex', alignItems: 'center' } },
    { field: 'description', headerName: 'Description', pinned: 'left', flex: 1.5, minWidth: 160,
      cellStyle: { fontWeight: 600, display: 'flex', alignItems: 'center' } },
    { field: 'department',  headerName: 'Dept',        width: 110,
      cellStyle: { color: C_SLATE, fontSize: 12, display: 'flex', alignItems: 'center' } },
    { field: 'store_name',  headerName: 'Store',       flex: 1, minWidth: 120,
      cellStyle: { fontWeight: 600, display: 'flex', alignItems: 'center' } },

    // ── Opening balance  (teal)
    { field: 'open_qty',   headerName: 'Open Qty',   width: 100, type: 'numericColumn',
      headerComponent: () => <ColHdr label={tr('Open Qty')}   color={C_OPEN} />,
      valueFormatter: p => fmtN(p.value),
      cellStyle: { color: C_OPEN, display: 'flex', alignItems: 'center' } },
    { field: 'open_cost',  headerName: 'Open Cost',  width: 120, type: 'numericColumn',
      headerComponent: () => <ColHdr label={tr('Open Cost')}  color={C_OPEN} />,
      valueFormatter: p => fmtC(p.value),
      cellStyle: { color: C_OPEN, fontWeight: 600, display: 'flex', alignItems: 'center' } },

    // ── Sales  (rose)
    { field: 'sold_qty',   headerName: 'Sold Qty',   width: 95, type: 'numericColumn',
      headerComponent: () => <ColHdr label={tr('Sold Qty')}   color={C_SALES} icon="ti-receipt" />,
      valueFormatter: p => fmtN(p.value),
      cellStyle: { color: C_SALES, display: 'flex', alignItems: 'center' } },
    { field: 'return_qty', headerName: 'Return Qty', width: 100, type: 'numericColumn',
      headerComponent: () => <ColHdr label={tr('Return Qty')} color={C_SALES} icon="ti-receipt" />,
      valueFormatter: p => fmtN(p.value),
      cellStyle: { color: C_SALES, display: 'flex', alignItems: 'center' } },
    { field: 'sold_cost',  headerName: 'COGS',       width: 110, type: 'numericColumn',
      headerComponent: () => <ColHdr label={tr('COGS')}       color={C_SALES} icon="ti-receipt" />,
      valueFormatter: p => fmtC(p.value),
      cellStyle: { color: C_SALES, fontWeight: 600, display: 'flex', alignItems: 'center' } },
    { field: 'sold_revenue', headerName: 'Revenue',  width: 110, type: 'numericColumn',
      valueFormatter: p => fmtC(p.value),
      cellStyle: { display: 'flex', alignItems: 'center' } },

    // ── Transfers In  (green)
    { field: 'recv_qty',   headerName: 'Recv Qty',   width: 100, type: 'numericColumn',
      headerComponent: () => <ColHdr label={tr('Recv Qty')}   color={C_RECV}  icon="ti-arrows-down-up" />,
      valueFormatter: p => fmtN(p.value),
      cellStyle: { color: C_RECV, display: 'flex', alignItems: 'center' } },
    { field: 'recv_cost',  headerName: 'Recv Cost',  width: 110, type: 'numericColumn',
      headerComponent: () => <ColHdr label={tr('Recv Cost')}  color={C_RECV}  icon="ti-arrows-down-up" />,
      valueFormatter: p => fmtC(p.value),
      cellStyle: { color: C_RECV, fontWeight: 600, display: 'flex', alignItems: 'center' } },

    // ── Transfers Out  (amber)
    { field: 'sent_qty',   headerName: 'Sent Qty',   width: 100, type: 'numericColumn',
      headerComponent: () => <ColHdr label={tr('Sent Qty')}   color={C_SENT} />,
      valueFormatter: p => fmtN(p.value),
      cellStyle: { color: C_SENT, display: 'flex', alignItems: 'center' } },
    { field: 'sent_cost',  headerName: 'Sent Cost',  width: 110, type: 'numericColumn',
      headerComponent: () => <ColHdr label={tr('Sent Cost')}  color={C_SENT} />,
      valueFormatter: p => fmtC(p.value),
      cellStyle: { color: C_SENT, fontWeight: 600, display: 'flex', alignItems: 'center' } },

    // ── Adjustments  (sign-coloured)
    { field: 'adj_qty',    headerName: 'Adj Qty',    width: 90, type: 'numericColumn',
      valueFormatter: p => fmtSign(p.value),
      cellStyle: (p: any) => ({
        color: p.value > 0 ? C_ADJ_POS : p.value < 0 ? C_ADJ_NEG : C_SLATE,
        fontWeight: 600, display: 'flex', alignItems: 'center',
      }) },
    { field: 'adj_cost',   headerName: 'Adj Cost',   width: 110, type: 'numericColumn',
      valueFormatter: p => fmtC(p.value),
      cellStyle: (p: any) => ({
        color: p.value > 0 ? C_ADJ_POS : p.value < 0 ? C_ADJ_NEG : C_SLATE,
        fontWeight: 700, display: 'flex', alignItems: 'center',
      }) },

    // ── Ending balance  (purple)
    { field: 'end_qty',    headerName: 'End Qty',    width: 100, type: 'numericColumn',
      headerComponent: () => <ColHdr label={tr('End Qty')}    color={C_END} />,
      valueFormatter: p => fmtN(p.value),
      cellStyle: { color: C_END, fontWeight: 700, display: 'flex', alignItems: 'center' } },
    { field: 'end_cost',   headerName: 'End Cost',   width: 120, type: 'numericColumn',
      headerComponent: () => <ColHdr label={tr('End Cost')}   color={C_END} />,
      valueFormatter: p => fmtC(p.value),
      cellStyle: { color: C_END, fontWeight: 800, display: 'flex', alignItems: 'center' } },
  ], [codeField])

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <Box sx={{ pt: 0, px: 3, pb: 3, display: 'flex', flexDirection: 'column', gap: 2.5, minHeight: '100%' }}>

      {/* ── Header (standard page pattern — matches Stock Movement) ── */}
      <Box sx={{
        position: 'sticky', top: 0, zIndex: 10, bgcolor: '#ffffff',
        mx: -3, px: 3, pt: 3, pb: 2, borderBottom: '1px solid #e9e4ff',
      }}>
        <Typography variant="h6" sx={{ fontWeight: 700, fontSize: 20, color: '#0f172a', letterSpacing: '-0.3px', mb: 0.3 }}>
          {tr('Inventory Ledger')}
          <TitleLoader />
        </Typography>
        <Typography sx={{ fontSize: 12, color: '#64748b', mb: 1.5 }}>
          {dateFrom} — {dateTo}
        </Typography>
        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'center' }}>
          <TextField type="date" size="small" value={dateFrom}
            onChange={e => { setDateFrom(e.target.value); setPeriod(-1) }}
            sx={{ width: 130 }} />
          <Typography sx={{ color: '#64748b' }}>→</Typography>
          <TextField type="date" size="small" value={dateTo}
            onChange={e => { setDateTo(e.target.value); setPeriod(-1) }}
            sx={{ width: 130 }} />

          <Autocomplete
            multiple disableCloseOnSelect size="small"
            options={storeNames} value={selStores}
            onChange={(_, v) => setSelStores(v)}
            renderInput={p => <TextField {...p} placeholder={tr('All Stores')} size="small" sx={{ minWidth: 200 }} />}
            sx={{ minWidth: 200 }}
          />

          {/* ── Item search ── */}
          <Autocomplete
            size="small"
            options={itemOptions}
            getOptionLabel={opt =>
              `${productCodeField === 'upc' ? opt.UPC : opt.ALU} | ${opt.DESCRIPTION1}`
            }
            isOptionEqualToValue={(a, b) => a.item_sid === b.item_sid}
            value={selItem}
            inputValue={itemQ}
            onInputChange={(_, v) => setItemQ(v)}
            onChange={(_, v) => setSelItem(v)}
            filterOptions={x => x}
            noOptionsText={itemQ.length < 2 ? tr('Type 2+ chars…') : tr('No match')}
            renderInput={p => (
              <TextField {...p} placeholder={trf('Search {{code}} / Desc', { code: codeField })}
                sx={{ minWidth: 280 }} size="small" />
            )}
            sx={{ minWidth: 280 }}
          />

          {isFetching && (
            <Typography sx={{ fontSize: 11, color: C_SLATE, ml: 1 }}>{tr('Loading…')}</Typography>
          )}
        </Box>
      </Box>

      {/* ── KPI strip ── */}
      <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap' }}>
        <KpiCard label={tr('Active SKUs')}    value={num(kpi?.sku_count  || 0, 0)} sub={tr('items with movement')} color={ACCENT}  icon="ti-barcode" />
        <KpiCard label={tr('Sold Cost (COGS)')} value={money(kpi?.sold_cost  || 0)}
          sub={trf('units sold {{n}}', { n: fmtN(kpi?.sold_qty || 0) })}    color={C_SALES} icon="ti-receipt" />
        <KpiCard label={tr('Transfers In')}   value={num(kpi?.recv_qty   || 0, 0)}
          sub={fmtC(kpi?.recv_cost || 0)}                   color={C_RECV}  icon="ti-arrows-down-up" />
        <KpiCard label={tr('Adj Cost Impact')} value={money(kpi?.adj_cost  || 0)}
          sub={trf('qty {{n}}', { n: fmtSign(kpi?.adj_qty || 0) })}
          color={(kpi?.adj_cost || 0) >= 0 ? C_ADJ_POS : C_ADJ_NEG} icon="ti-adjustments" />
        <KpiCard label={tr('Rows in View')}   value={num(rows.length, 0)}
          sub={tr('Item × Store combinations')}                 color={C_SLATE} icon="ti-list" />
      </Box>

      {/* ── Colour legend ── */}
      <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: 'center' }}>
        {[
          { label: tr('Opening Balance'), color: C_OPEN  },
          { label: tr('Sales / COGS'),    color: C_SALES },
          { label: tr('Transfers In'),    color: C_RECV  },
          { label: tr('Transfers Out'),   color: C_SENT  },
          { label: tr('Adjustments'),     color: C_ADJ_NEG },
          { label: tr('Ending Balance'),  color: C_END   },
        ].map(({ label, color }) => (
          <Box key={label} sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
            <Box sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: color }} />
            <Typography sx={{ fontSize: 11, color: C_SLATE }}>{label}</Typography>
          </Box>
        ))}
      </Box>

      {/* ── AG Grid ── */}
      <Paper elevation={0} sx={{
        borderRadius: 2, border: '1px solid #e2e8f0',
        overflow: 'hidden', flex: 1, minHeight: 440,
      }}>
        <Box sx={{ display: 'flex', justifyContent: 'flex-end', px: 1.5, pt: 1.5, pb: 1.5 }}>
          <GridExportBar gridRef={gridRef} filename="inventory_ledger" title="Inventory Ledger"
            filters={`${dateFrom} → ${dateTo} · ${storesParam ? tr('Selected stores') : tr('All stores')}${selItem?.item_sid ? ` · ${selItem.alu ?? selItem.item_sid}` : ''}`}
            reportEndpoint="/api/inventory/ledger"
            reportPeriod={PERIODS[period]?.label ?? 'custom'}
            reportParams={qParams}
            colDefs={columns as any} onResetColumns={resetColumns} />
        </Box>
        <Box className="ag-theme-alpine" sx={{ height: 560, mt: 0.5 }}>
          <AgGridReact
            ref={gridRef}
            overlayNoRowsTemplate={noRowsOverlay()}
            rowData={rows}
            columnDefs={trCols(columns as any[])}
            defaultColDef={{ resizable: true, sortable: true, filter: true, wrapHeaderText: true, autoHeaderHeight: true }}
            rowHeight={36}
            headerHeight={40}
            suppressCellFocus
            pagination
            paginationPageSize={100}
            onGridReady={onColGridReady}
            onColumnMoved={onColumnChanged}
            onColumnResized={onColumnChanged}
            onColumnVisible={onColumnChanged}
          />
        </Box>
      </Paper>

    </Box>
  )
}
