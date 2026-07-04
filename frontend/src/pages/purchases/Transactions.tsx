/**
 * Purchases Transactions
 * ======================
 * Line-level AG Grid of all PO lines with sticky filter bar.
 */
import { useState, useMemo, useRef } from 'react'
import {
  Box, Typography, Chip, Stack, TextField,
  Autocomplete, CircularProgress,
} from '@mui/material'
import { useQuery } from '@tanstack/react-query'
import axios from 'axios'
import { AgGridReact } from 'ag-grid-react'
import 'ag-grid-community/styles/ag-grid.css'
import 'ag-grid-community/styles/ag-theme-alpine.css'
import { useGridColumnState } from '../../hooks/useGridColumnState'
import GridExportBar from '../../components/GridExportBar'
import KpiCard from '../../components/KpiCard'
import { moneyPrefix } from '../../utils/formatters'
import { tr, trCols } from '../../i18n'

// ── Types ─────────────────────────────────────────────────────────────────────

interface DetailRow {
  vou_date:     string
  vou_no:       number
  status_label: string
  store_name:   string
  vendor_name:  string
  department:   string
  alu:          string
  description1: string
  ord_qty:      number
  recv_qty:     number
  unit_cost:    number
  unit_price:   number
  disc_amt:     number
  total_cost:   number
  total_retail: number
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const toISO  = (d: Date) => d.toISOString().slice(0, 10)
const today  = toISO(new Date())
const daysAgo = (n: number) => toISO(new Date(Date.now() - n * 86400000))
const startOf = (unit: 'month' | 'year') => {
  const d = new Date()
  if (unit === 'month') d.setDate(1)
  else { d.setMonth(0); d.setDate(1) }
  return toISO(d)
}

const PRESETS: Record<string, [string, string]> = {
  '30D': [daysAgo(29), today],
  'MTD': [startOf('month'), today],
  'YTD': [startOf('year'),  today],
  '90D': [daysAgo(89), today],
}

const fmtC = (v: number) => v == null ? '' : moneyPrefix() + v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
// KPI cards: whole numbers only (no decimals)
const fmtC0 = (v: number) => v == null ? '' : moneyPrefix() + Math.round(v).toLocaleString('en-US')
const fmtN = (v: number) => v == null ? '' : v.toLocaleString('en-US', { maximumFractionDigits: 0 })
const fmtQ = (v: number) => v == null ? '' : v.toLocaleString('en-US', { maximumFractionDigits: 1 })

function useStores() {
  const { data } = useQuery({
    queryKey: ['stores-list'],
    queryFn:  () => axios.get('/api/inventory/stores-list').then(r => r.data as any[]),
    staleTime: Infinity,
  })
  // filter(Boolean): a NULL STORE_NAME row exists — undefined options crash Autocomplete
  return data?.map(r => r.STORE_NAME ?? r.store_name).filter(Boolean) ?? []
}

function useVendors() {
  const { data } = useQuery({
    queryKey: ['vendors-list'],
    queryFn:  () => axios.get('/api/purchases/vendors-list').then(r => r.data as any[]),
    staleTime: Infinity,
  })
  // API returns uppercase VEND_NAME (DuckDB column); accept both casings
  return data?.map(r => r.VEND_NAME ?? r.vend_name).filter(Boolean) ?? []
}

// ── Status badge cell ─────────────────────────────────────────────────────────

function StatusCell({ value }: { value: string }) {
  const ok = value === 'Received'
  return (
    <Box sx={{
      display: 'inline-flex', alignItems: 'center',
      px: 1, py: 0.2, borderRadius: 1, fontSize: 11, fontWeight: 700,
      bgcolor: ok ? '#dcfce7' : '#fef3c7',
      color:   ok ? '#15803d' : '#92400e',
    }}>
      {value}
    </Box>
  )
}

// ── Main ──────────────────────────────────────────────────────────────────────

export default function PurchasesTransactions() {
  const gridRef = useRef<AgGridReact>(null)
  const { onGridReady: onColGridReady, onColumnChanged, resetColumns } = useGridColumnState('pur-transactions')

  const [preset,   setPreset]   = useState('MTD')
  const [dateFrom, setDateFrom] = useState(PRESETS['MTD'][0])
  const [dateTo,   setDateTo]   = useState(PRESETS['MTD'][1])
  const [stores,   setStores]   = useState<string[]>([])
  const [vendors,  setVendors]  = useState<string[]>([])
  const [status,   setStatus]   = useState('')

  const allStores  = useStores()
  const allVendors = useVendors()

  const applyPreset = (p: string) => {
    setPreset(p)
    setDateFrom(PRESETS[p][0])
    setDateTo(PRESETS[p][1])
  }

  const params = useMemo(() => ({
    date_from: dateFrom,
    date_to:   dateTo,
    ...(stores.length  ? { stores:  stores.join(',')  } : {}),
    ...(vendors.length ? { vendors: vendors.join(',') } : {}),
    ...(status         ? { status                      } : {}),
  }), [dateFrom, dateTo, stores, vendors, status])

  const { data: rows = [], isLoading } = useQuery<DetailRow[]>({
    queryKey: ['pur-details', params],
    queryFn:  () => axios.get('/api/purchases/details', { params }).then(r => r.data),
  })

  // ── Columns ───────────────────────────────────────────────────────────────

  const colDefs = useMemo(() => [
    { field: 'vou_date',     headerName: 'Date',        width: 110, pinned: 'left',
      cellStyle: { color: '#64748b', fontSize: 12 } },
    { field: 'vou_no',       headerName: 'Voucher #',   width: 100, pinned: 'left',
      cellStyle: { fontFamily: 'monospace', fontWeight: 600 } },
    { field: 'status_label', headerName: 'Status',      width: 110,
      cellRenderer: StatusCell },
    { field: 'store_name',   headerName: 'Store',       width: 130 },
    { field: 'vendor_name',  headerName: 'Supplier',    width: 160,
      headerTooltip: 'Supplier on the purchase voucher (who the goods were bought from)' },
    { field: 'department',   headerName: 'Department',  width: 130 },
    { field: 'alu',          headerName: 'ALU',         width: 110,
      cellStyle: { fontFamily: 'monospace', color: '#7c3aed', fontWeight: 600 } },
    { field: 'description1', headerName: 'Description', flex: 1, minWidth: 180,
      cellStyle: { fontWeight: 500 } },
    { field: 'ord_qty',      headerName: 'Ord Qty',     width: 95, type: 'numericColumn',
      valueFormatter: (p: any) => fmtQ(p.value),
      cellStyle: { color: '#0284c7', fontWeight: 600 } },
    { field: 'recv_qty',     headerName: 'Recv Qty',    width: 95, type: 'numericColumn',
      valueFormatter: (p: any) => fmtQ(p.value),
      cellStyle: (p: any) => ({
        color: (p.value ?? 0) < (p.data?.ord_qty ?? 0) ? '#d97706' : '#059669',
        fontWeight: 600,
      }) },
    { field: 'unit_cost',    headerName: 'Unit Cost',   width: 100, type: 'numericColumn',
      valueFormatter: (p: any) => fmtC(p.value) },
    { field: 'unit_price',   headerName: 'Unit Price',  width: 105, type: 'numericColumn',
      valueFormatter: (p: any) => fmtC(p.value) },
    { field: 'disc_amt',     headerName: 'Discount',    width: 100, type: 'numericColumn',
      valueFormatter: (p: any) => fmtC(p.value),
      cellStyle: { color: '#e11d48' } },
    { field: 'total_cost',   headerName: 'Total Cost',  width: 115, type: 'numericColumn',
      valueFormatter: (p: any) => fmtC(p.value),
      cellStyle: { fontWeight: 700, color: '#0f172a' } },
    { field: 'total_retail', headerName: 'Total Retail',width: 120, type: 'numericColumn',
      valueFormatter: (p: any) => fmtC(p.value),
      cellStyle: { color: '#7c3aed' } },
  ], [])

  const defaultColDef = useMemo(() => ({
    sortable: true, filter: true, resizable: true,   // filters via header menu (no floating filter row)
  }), [])

  // ── Totals ────────────────────────────────────────────────────────────────

  const totals = useMemo(() => ({
    total_cost:   rows.reduce((s, r) => s + (r.total_cost   ?? 0), 0),
    total_retail: rows.reduce((s, r) => s + (r.total_retail ?? 0), 0),
    ord_qty:      rows.reduce((s, r) => s + (r.ord_qty      ?? 0), 0),
    recv_qty:     rows.reduce((s, r) => s + (r.recv_qty     ?? 0), 0),
  }), [rows])

  return (
    <Box sx={{ pt: 0, px: 3, pb: 3, minHeight: '100%', display: 'flex', flexDirection: 'column' }}>

      {/* ── Header (standard page pattern — matches Stock Movement) ──── */}
      <Box sx={{
        position: 'sticky', top: 0, zIndex: 10,
        bgcolor: '#ffffff', mx: -3, px: 3, pt: 3, pb: 2,
        borderBottom: '1px solid #e9e4ff',
      }}>
        <Typography variant="h6" sx={{ fontWeight: 800, color: '#0f172a', letterSpacing: '-0.3px', mb: 0.3 }}>
          {tr('Purchase Transactions')}
        </Typography>
        <Typography sx={{ fontSize: 12, color: '#64748b', mb: 1.5 }}>
          {dateFrom} — {dateTo}
        </Typography>
        <Box sx={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 1 }}>

          <Stack direction="row" spacing={0.5}>
            {Object.keys(PRESETS).map(p => (
              <Chip key={p} label={p} size="small" onClick={() => applyPreset(p)}
                variant={preset === p ? 'filled' : 'outlined'}
                sx={{ fontWeight: 600, fontSize: 11,
                  ...(preset === p ? { bgcolor: '#7c3aed', color: '#fff' } : {}) }}
              />
            ))}
          </Stack>

          <TextField size="small" label="From" type="date" value={dateFrom}
            onChange={e => { setDateFrom(e.target.value); setPreset('') }}
            InputLabelProps={{ shrink: true }} sx={{ width: 148 }} />
          <TextField size="small" label="To" type="date" value={dateTo}
            onChange={e => { setDateTo(e.target.value); setPreset('') }}
            InputLabelProps={{ shrink: true }} sx={{ width: 148 }} />

          {/* Filters — Autocomplete style, consistent with all other pages */}
          <Autocomplete
            multiple disableCloseOnSelect size="small"
            options={allStores} value={stores}
            onChange={(_, v) => setStores(v)}
            renderInput={p => <TextField {...p} placeholder="All Stores" size="small" sx={{ minWidth: 190 }} />}
            sx={{ minWidth: 190 }}
          />
          <Autocomplete
            multiple disableCloseOnSelect size="small"
            options={allVendors} value={vendors}
            onChange={(_, v) => setVendors(v)}
            renderInput={p => <TextField {...p} placeholder="All Suppliers" size="small" sx={{ minWidth: 190 }} />}
            sx={{ minWidth: 190 }}
          />
          <Autocomplete
            size="small"
            options={['received', 'pending']}
            value={status || null}
            onChange={(_, v) => setStatus(v ?? '')}
            getOptionLabel={o => o === 'received' ? 'Received' : o === 'pending' ? 'Pending' : ''}
            renderInput={p => <TextField {...p} placeholder="All Status" size="small" sx={{ minWidth: 140 }} />}
            sx={{ minWidth: 140 }}
          />

          {isLoading && <CircularProgress size={18} sx={{ color: '#7c3aed' }} />}

          {!isLoading && (
            <Chip size="small" label={`${fmtN(rows.length)} lines`}
              sx={{ ml: 'auto', bgcolor: '#ede9fe', color: '#7c3aed', fontWeight: 700, fontSize: 11 }} />
          )}
        </Box>
      </Box>

      {/* ── KPI strip (shared KpiCard — consistent with other pages) ──── */}
      {!isLoading && rows.length > 0 && (
        <Box sx={{ display: 'flex', gap: 2, mt: 2, mb: 1.5, flexWrap: 'wrap' }}>
          <KpiCard label="Total Cost"   value={fmtC0(totals.total_cost)}   sub="sum of line costs"    color="#7c3aed" icon="ti-coin" />
          <KpiCard label="Total Retail" value={fmtC0(totals.total_retail)} sub="at selling price"     color="#0284c7" icon="ti-tag" />
          <KpiCard label="Ordered Qty"  value={fmtN(totals.ord_qty)}       sub="units on order"       color="#64748b" icon="ti-package" />
          <KpiCard label="Received Qty" value={fmtN(totals.recv_qty)}      sub="units received"       color="#059669" icon="ti-inbox" />
          <KpiCard label="Line Items"   value={fmtN(rows.length)}          sub="rows in current filter" color="#e11d48" icon="ti-list" />
        </Box>
      )}

      {/* ── AG Grid ───────────────────────────────────────────────────── */}
      <Box sx={{ borderRadius: 2, overflow: 'hidden', border: '1px solid #e2e8f0', boxShadow: '0 1px 4px rgba(15,23,42,.08)' }}>
        <Box sx={{ display:'flex', justifyContent:'flex-end', px:1.5, pt:1, bgcolor: '#f8f7ff', borderBottom: '1px solid #e9e4ff' }}>
          <GridExportBar gridRef={gridRef} filename="purchases_transactions" title="Purchase Transactions"
            colDefs={colDefs as any} onResetColumns={resetColumns} />
        </Box>
        <Box className="ag-theme-alpine" sx={{
          width: '100%', height: 580,
          '& .ag-root-wrapper': { borderRadius: 0 },
          '& .ag-header': { bgcolor: '#f8f7ff !important', borderBottom: '1px solid #e9e4ff' },
          '& .ag-header-cell-text': { fontWeight: 700, color: '#374151', fontSize: 12 },
          '& .ag-row-even': { bgcolor: '#ffffff' },
          '& .ag-row-odd': { bgcolor: '#faf9ff' },
          '& .ag-row:hover': { bgcolor: '#f3f0ff !important' },
          '& .ag-paging-panel': { borderTop: '1px solid #e9e4ff', color: '#475569' },
        }}>
          <AgGridReact
            ref={gridRef}
            rowData={rows}
            columnDefs={trCols(colDefs as any[])}
            defaultColDef={defaultColDef}
            animateRows
            pagination
            paginationPageSize={100}
            rowHeight={34}
            headerHeight={38}
            onGridReady={onColGridReady}
            onColumnMoved={onColumnChanged}
            onColumnResized={onColumnChanged}
            onColumnVisible={onColumnChanged}
          />
        </Box>
      </Box>

    </Box>
  )
}
