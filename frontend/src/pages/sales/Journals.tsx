/**
 * Sales → Journals — Power BI-style master/detail invoice explorer.
 * Click an invoice (master) → its line items load below (detail, drilled by
 * document no.). "Show all lines" switches the detail to every line for the
 * current filters. Full slicer set; both grids exportable/schedulable.
 */
import { useMemo, useRef, useState, useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  Box, Typography, Chip, TextField, Autocomplete, Stack, Paper,
  ToggleButton, ToggleButtonGroup, Switch, FormControlLabel, InputAdornment,
} from '@mui/material'
import SearchIcon from '@mui/icons-material/Search'
import SavedViewsBar from '../../components/SavedViewsBar'
import { AgGridReact } from 'ag-grid-react'
import type { ColDef } from 'ag-grid-community'
import 'ag-grid-community/styles/ag-grid.css'
import 'ag-grid-community/styles/ag-theme-alpine.css'
import { useQuery } from '@tanstack/react-query'
import axios from 'axios'
import { format, subDays, startOfMonth, startOfYear } from 'date-fns'
import { useGridColumnState } from '../../hooks/useGridColumnState'
import { useRetryIfEmpty } from '../../hooks/useRetryIfEmpty'
import GridExportBar from '../../components/GridExportBar'
import KpiCard from '../../components/KpiCard'
import TitleLoader from '../../components/TitleLoader'
import { noRowsOverlay } from '../../utils/gridOverlay'
import { moneyExact, money, num } from '../../utils/formatters'
import { tr, trCols } from '../../i18n'

const ACCENT = '#7c3aed'
const iso = (d: Date) => format(d, 'yyyy-MM-dd')
const today = iso(new Date())
const PRESETS: Record<string, [string, string]> = {
  '7D':  [iso(subDays(new Date(), 6)),  today],
  '30D': [iso(subDays(new Date(), 29)), today],
  'MTD': [iso(startOfMonth(new Date())), today],
  'YTD': [iso(startOfYear(new Date())),  today],
}
const fmtMoney = (v: number) => v == null ? '' : moneyExact(v)
const fmtQty   = (v: number) => v == null ? '' : v.toLocaleString('en-US', { maximumFractionDigits: 2 })

function TypeBadge({ value }: { value: string }) {
  const ret = value === 'Return'
  return (
    <Box sx={{ display: 'inline-flex', px: 1, py: 0.2, borderRadius: 1, fontSize: 11, fontWeight: 700,
      bgcolor: ret ? '#fef2f2' : '#dcfce7', color: ret ? '#dc2626' : '#15803d' }}>{value}</Box>
  )
}

const GRID_SX = {
  width: '100%',
  '& .ag-header': { bgcolor: '#f8f7ff !important', borderBottom: '1px solid #e9e4ff' },
  '& .ag-header-cell-text': { fontWeight: 700, color: '#374151', fontSize: 12 },
  '& .ag-row-even': { bgcolor: '#ffffff' },
  '& .ag-row-odd': { bgcolor: '#faf9ff' },
  '& .ag-row-selected': { bgcolor: '#ede9fe !important' },
  '& .ag-paging-panel': { borderTop: '1px solid #e9e4ff', color: '#475569' },
} as const

export default function Journals() {
  const [preset, setPreset]   = useState('30D')
  const [dateFrom, setDateFrom] = useState(PRESETS['30D'][0])
  const [dateTo,   setDateTo]   = useState(PRESETS['30D'][1])
  const [stores,   setStores]   = useState<string[]>([])
  const [type,     setType]     = useState<'all'|'sale'|'return'>('all')
  const [docNo,    setDocNo]    = useState('')
  const [search,   setSearch]   = useState('')

  // ── Type-ahead slicers (server-searched, like the inventory Ledger) ──
  type CustOpt = { customer_id: number; name: string; phone: string | null }
  type DcsOpt  = { label: string; lvl: string }
  type ItemOpt = { item_sid: number; ALU: string; UPC: string; DESCRIPTION1: string }
  const [custSel, setCustSel] = useState<CustOpt | null>(null); const [custQ, setCustQ] = useState('')
  const [vendSel, setVendSel] = useState<string | null>(null); const [vendQ, setVendQ] = useState('')
  const [dcsSel,  setDcsSel ] = useState<DcsOpt | null>(null); const [dcsQ,  setDcsQ ] = useState('')
  const [itemSel, setItemSel] = useState<ItemOpt | null>(null); const [itemQ, setItemQ] = useState('')

  const custOpts = useQuery({
    queryKey: ['jr-cust', custQ],
    queryFn: () => axios.get('/api/sales/journal/search/customers', { params: { q: custQ } }).then(r => r.data as CustOpt[]),
    enabled: custQ.trim().length >= 2, staleTime: 30_000,
  }).data ?? []
  const vendOpts = useQuery({
    queryKey: ['jr-vend', vendQ],
    queryFn: () => axios.get('/api/sales/journal/search/vendors', { params: { q: vendQ } }).then(r => (r.data as any[]).map(x => x.vendor as string)),
    enabled: vendQ.trim().length >= 2, staleTime: 30_000,
  }).data ?? []
  const dcsOpts = useQuery({
    queryKey: ['jr-dcs', dcsQ],
    queryFn: () => axios.get('/api/sales/journal/search/dcs', { params: { q: dcsQ } }).then(r => r.data as DcsOpt[]),
    enabled: dcsQ.trim().length >= 2, staleTime: 30_000,
  }).data ?? []
  const itemOpts = useQuery({
    queryKey: ['jr-item', itemQ],
    queryFn: () => axios.get('/api/inventory/items-search', { params: { q: itemQ } }).then(r => r.data as ItemOpt[]),
    enabled: itemQ.trim().length >= 2, staleTime: 30_000,
  }).data ?? []

  // Drill-through: preset slicers from URL params (command palette / dimension pages).
  const [sp] = useSearchParams()
  useEffect(() => {
    const cid = sp.get('customer_id')
    if (cid) setCustSel({ customer_id: Number(cid), name: sp.get('customer_name') || `#${cid}`, phone: null })
    const it = sp.get('item')
    if (it) setItemSel({ item_sid: -1, ALU: it, UPC: '', DESCRIPTION1: sp.get('item_desc') || '' })
    const vd = sp.get('vendor'); if (vd) setVendSel(vd)
    const dc = sp.get('dcs');    if (dc) setDcsSel({ label: dc, lvl: '' })
  }, [])   // eslint-disable-line react-hooks/exhaustive-deps
  const [selDoc,   setSelDoc]   = useState<string | null>(null)   // selected document no.
  const [showAll,  setShowAll]  = useState(false)

  const invGridRef  = useRef<AgGridReact>(null)
  const itemGridRef = useRef<AgGridReact>(null)
  const invCols  = useGridColumnState('sales-journal-inv')
  const itemColsState = useGridColumnState('sales-journal-items')

  const allStores = useQuery({
    queryKey: ['stores-list'],
    queryFn: () => axios.get('/api/sales/stores-list').then(r => r.data as string[]),
    staleTime: 3_600_000,
  }).data ?? []

  const applyPreset = (p: string) => { setPreset(p); setDateFrom(PRESETS[p][0]); setDateTo(PRESETS[p][1]) }

  const filterParams = useMemo(() => ({
    date_from: dateFrom, date_to: dateTo,
    ...(stores.length ? { stores: stores.join(',') } : {}),
    ...(type !== 'all' ? { type } : {}),
    ...(docNo.trim()    ? { doc_no: docNo.trim() } : {}),
    ...(custSel        ? { customer_id: String(custSel.customer_id) } : {}),
    ...(vendSel        ? { vendor: vendSel } : {}),
    ...(dcsSel         ? { dcs: dcsSel.label } : {}),
    ...(itemSel        ? { item: itemSel.ALU } : {}),
    ...(search.trim()   ? { search: search.trim() } : {}),
  }), [dateFrom, dateTo, stores, type, docNo, custSel, vendSel, dcsSel, itemSel, search])

  // Master: invoice headers (no hardcoded cap — bounded by the date/filters)
  const { data: invData, isFetching: invFetching, refetch: refetchInv } = useQuery({
    queryKey: ['journal-invoices', filterParams],
    queryFn: () => axios.get('/api/sales/journal/invoices', { params: filterParams }).then(r => r.data),
    placeholderData: p => p,
  })
  const invoices: any[] = invData?.rows ?? []
  const invTotal: number = invData?.total ?? invoices.length
  useRetryIfEmpty(invoices.length === 0, invFetching, refetchInv)

  // Detail: item lines — the selected invoice (drill by doc_no) OR all filtered lines
  const itemParams = useMemo(() => ({
    ...filterParams,
    ...(showAll ? {} : (selDoc ? { doc_no: selDoc } : {})),
  }), [filterParams, showAll, selDoc])
  const itemsEnabled = showAll || !!selDoc
  const { data: itemRows = [] } = useQuery<any[]>({
    queryKey: ['journal-items', itemParams, showAll, selDoc],
    queryFn: () => axios.get('/api/sales/journal/items', { params: itemParams }).then(r => r.data),
    enabled: itemsEnabled,
    placeholderData: p => p,
  })

  // heat scale for the price / discount columns
  const maxPrice = useMemo(() =>
    Math.max(1, ...itemRows.map(r => Math.abs(+(r.extended_price_after_disc ?? 0)))), [itemRows])
  const heat = (v: number) => {
    const a = Math.min(0.85, Math.abs(v) / maxPrice)
    return { backgroundColor: `rgba(220,38,38,${(a * 0.6).toFixed(3)})`,
             color: a > 0.6 ? '#fff' : '#0f172a', fontWeight: 600 }
  }

  const kpi = useMemo(() => {
    const net = invoices.reduce((s, r) => s + +(r.net_sales_wtax ?? 0), 0)
    const prod = invoices.reduce((s, r) => s + +(r.product_count ?? 0), 0)
    return { count: invTotal, net, prod, avg: invTotal ? net / invTotal : 0 }
  }, [invoices, invTotal])

  const invColDefs = useMemo<ColDef[]>(() => [
    { field: 'created_datetime', headerName: 'Created DateTime', width: 165, pinned: 'left' },
    { field: 'doc_no', headerName: 'Document No.', width: 120, pinned: 'left',
      cellStyle: { fontFamily: 'monospace', fontWeight: 700, color: ACCENT } },
    { field: 'invoice_type', headerName: 'Type', width: 90, cellRenderer: TypeBadge },
    { field: 'store_code', headerName: 'Store Code', width: 100 },
    { field: 'store_name', headerName: 'Store Name', width: 180 },
    { field: 'net_sales_wtax', headerName: 'Net Sales WTax', width: 130, type: 'numericColumn',
      valueFormatter: p => fmtMoney(p.value), cellStyle: { fontWeight: 700 } },
    { field: 'product_count', headerName: '#Products', width: 100, type: 'numericColumn',
      valueFormatter: p => num(p.value, 0) },
    { field: 'customer_id', headerName: 'CustomerID', width: 110 },
    { field: 'customer_name', headerName: 'Customer Name', flex: 1, minWidth: 150 },
    { field: 'associate_name', headerName: 'Associate', width: 150 },
  ], [])

  const itemColDefs = useMemo<ColDef[]>(() => [
    { field: 'doc_no', headerName: 'Document No.', width: 120, pinned: 'left',
      cellStyle: { fontFamily: 'monospace', fontWeight: 600 } },
    { field: 'item_type', headerName: 'Item Type', width: 95, cellRenderer: TypeBadge },
    { field: 'alu', headerName: 'ALU', width: 130, cellStyle: { fontFamily: 'monospace', color: ACCENT } },
    { field: 'description1', headerName: 'Item Desc', flex: 1, minWidth: 200 },
    { field: 'department', headerName: 'Department', width: 130 },
    { field: 'class', headerName: 'Class', width: 130 },
    { field: 'subclass', headerName: 'SubClass', width: 150 },
    { field: 'vendor_name', headerName: 'Vendor Name', width: 160 },
    { field: 'qty', headerName: 'Qty', width: 80, type: 'numericColumn', valueFormatter: p => fmtQty(p.value) },
    { field: 'extended_cost', headerName: 'Extended Cost', width: 120, type: 'numericColumn',
      valueFormatter: p => fmtMoney(p.value) },
    { field: 'extended_price_after_disc', headerName: 'Extended Price After Disc', width: 150, type: 'numericColumn',
      valueFormatter: p => fmtMoney(p.value), cellStyle: p => heat(+(p.value ?? 0)) },
    { field: 'extended_discount', headerName: 'Extended Discount', width: 130, type: 'numericColumn',
      valueFormatter: p => fmtMoney(p.value),
      cellStyle: p => (+(p.value ?? 0) > 0 ? { backgroundColor: '#fee2e2', color: '#b91c1c', fontWeight: 600 } : undefined) },
    { field: 'associate_name', headerName: 'Associate', width: 150 },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [maxPrice])

  const defaultColDef = useMemo(() => ({ sortable: true, filter: true, resizable: true,
    wrapHeaderText: true, autoHeaderHeight: true }), [])

  const journalFilters = `${dateFrom} → ${dateTo} · ${stores.length ? `${stores.length} ${tr('store(s)')}` : tr('All stores')}${type !== 'all' ? ` · ${type}` : ''}`

  // Saved views: serialise/restore the whole slicer set.
  const currentView = { preset, dateFrom, dateTo, stores, type, docNo, custSel, vendSel, dcsSel, itemSel, search }
  const applyView = (s: any) => {
    if (!s) return
    setPreset(s.preset ?? ''); setDateFrom(s.dateFrom ?? dateFrom); setDateTo(s.dateTo ?? dateTo)
    setStores(s.stores ?? []); setType(s.type ?? 'all'); setDocNo(s.docNo ?? '')
    setCustSel(s.custSel ?? null); setVendSel(s.vendSel ?? null)
    setDcsSel(s.dcsSel ?? null); setItemSel(s.itemSel ?? null); setSearch(s.search ?? '')
  }

  return (
    <Box sx={{ pt: 0, px: 3, pb: 3, minHeight: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* ── Header + slicers (standard sticky pattern) ── */}
      <Box sx={{ position: 'sticky', top: 0, zIndex: 10, bgcolor: '#ffffff', mx: -3, px: 3, pt: 3, pb: 2,
        borderBottom: '1px solid #e9e4ff' }}>
        <Typography variant="h6" sx={{ fontWeight: 800, color: '#0f172a', letterSpacing: '-0.3px', mb: 0.3 }}>
          {tr('Journals')}<TitleLoader />
        </Typography>
        <Typography sx={{ fontSize: 12, color: '#64748b', mb: 1.5 }}>{dateFrom} — {dateTo}</Typography>

        <Box sx={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 1 }}>
          <Stack direction="row" spacing={0.5}>
            {Object.keys(PRESETS).map(p => (
              <Chip key={p} label={tr(p)} size="small" onClick={() => applyPreset(p)}
                variant={preset === p ? 'filled' : 'outlined'}
                sx={{ fontWeight: 600, fontSize: 11, ...(preset === p
                  ? { bgcolor: ACCENT, color: '#fff', '&:hover': { bgcolor: '#6d28d9' } }
                  : { borderColor: '#e2e8f0', color: '#64748b' }) }} />
            ))}
          </Stack>
          <TextField label={tr('From')} type="date" size="small" sx={{ width: 150 }} InputLabelProps={{ shrink: true }}
            value={dateFrom} onChange={e => { setPreset(''); setDateFrom(e.target.value) }} />
          <TextField label={tr('To')} type="date" size="small" sx={{ width: 150 }} InputLabelProps={{ shrink: true }}
            value={dateTo} onChange={e => { setPreset(''); setDateTo(e.target.value) }} />
          <ToggleButtonGroup exclusive size="small" value={type} onChange={(_, v) => v && setType(v)}
            sx={{ '& .Mui-selected': { bgcolor: `${ACCENT}18 !important`, color: `${ACCENT} !important` } }}>
            <ToggleButton value="all" sx={{ textTransform: 'none', px: 1.5 }}>{tr('All')}</ToggleButton>
            <ToggleButton value="sale" sx={{ textTransform: 'none', px: 1.5 }}>{tr('Sales')}</ToggleButton>
            <ToggleButton value="return" sx={{ textTransform: 'none', px: 1.5 }}>{tr('Return')}</ToggleButton>
          </ToggleButtonGroup>
          <Autocomplete multiple size="small" options={allStores} value={stores}
            onChange={(_, v) => setStores(v)} sx={{ minWidth: 200, maxWidth: 320 }}
            renderInput={p => <TextField {...p} label={tr('Store')} />} limitTags={1} />
          <Box sx={{ flex: 1 }} />
          <SavedViewsBar pageKey="journals" current={currentView} onApply={applyView} />
        </Box>

        <Box sx={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 1, mt: 1 }}>
          <TextField size="small" label={tr('Document No.')} value={docNo} onChange={e => setDocNo(e.target.value)} sx={{ width: 130 }} />

          {/* Customer — search by name / id / phone */}
          <Autocomplete size="small" sx={{ minWidth: 240 }}
            options={custOpts} value={custSel} inputValue={custQ}
            onInputChange={(_, v) => setCustQ(v)} onChange={(_, v) => setCustSel(v)}
            filterOptions={x => x}
            getOptionLabel={o => o.name || String(o.customer_id)}
            isOptionEqualToValue={(a, b) => a.customer_id === b.customer_id}
            noOptionsText={custQ.length < 2 ? tr('Type 2+ chars…') : tr('No match')}
            renderOption={(props, o) => (
              <li {...props} key={o.customer_id}>
                <Box>
                  <Typography sx={{ fontSize: 13, fontWeight: 600 }}>{o.name || '—'}</Typography>
                  <Typography sx={{ fontSize: 11, color: '#94a3b8' }}>#{o.customer_id}{o.phone ? ` · ${o.phone}` : ''}</Typography>
                </Box>
              </li>
            )}
            renderInput={p => <TextField {...p} label={tr('Customer (name / id / phone)')} size="small" />} />

          {/* Vendor */}
          <Autocomplete size="small" sx={{ minWidth: 180 }}
            options={vendOpts} value={vendSel} inputValue={vendQ}
            onInputChange={(_, v) => setVendQ(v)} onChange={(_, v) => setVendSel(v)}
            filterOptions={x => x}
            noOptionsText={vendQ.length < 2 ? tr('Type 2+ chars…') : tr('No match')}
            renderInput={p => <TextField {...p} label={tr('Vendor')} size="small" />} />

          {/* Dept / Class / Subclass */}
          <Autocomplete size="small" sx={{ minWidth: 210 }}
            options={dcsOpts} value={dcsSel} inputValue={dcsQ}
            onInputChange={(_, v) => setDcsQ(v)} onChange={(_, v) => setDcsSel(v)}
            filterOptions={x => x}
            getOptionLabel={o => o.label}
            isOptionEqualToValue={(a, b) => a.label === b.label && a.lvl === b.lvl}
            noOptionsText={dcsQ.length < 2 ? tr('Type 2+ chars…') : tr('No match')}
            renderOption={(props, o) => (
              <li {...props} key={`${o.lvl}:${o.label}`}>
                <Box>
                  <Typography sx={{ fontSize: 13 }}>{o.label}</Typography>
                  <Typography sx={{ fontSize: 11, color: '#94a3b8' }}>{tr(o.lvl)}</Typography>
                </Box>
              </li>
            )}
            renderInput={p => <TextField {...p} label={tr('Dept / Class / Subclass')} size="small" />} />

          {/* ALU / Item */}
          <Autocomplete size="small" sx={{ minWidth: 240 }}
            options={itemOpts} value={itemSel} inputValue={itemQ}
            onInputChange={(_, v) => setItemQ(v)} onChange={(_, v) => setItemSel(v)}
            filterOptions={x => x}
            getOptionLabel={o => `${o.ALU} | ${o.DESCRIPTION1}`}
            isOptionEqualToValue={(a, b) => a.item_sid === b.item_sid}
            noOptionsText={itemQ.length < 2 ? tr('Type 2+ chars…') : tr('No match')}
            renderInput={p => <TextField {...p} label={tr('ALU / Item')} size="small" />} />

          <TextField size="small" placeholder={tr('Quick search...')} value={search} onChange={e => setSearch(e.target.value)}
            sx={{ width: 200 }} InputProps={{ startAdornment: <InputAdornment position="start"><SearchIcon sx={{ fontSize: 18, color: '#94a3b8' }} /></InputAdornment> }} />
        </Box>
      </Box>

      {/* ── KPI cards (standard KpiCard component) ── */}
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'repeat(2,1fr)', md: 'repeat(4,1fr)' }, gap: 2, mt: 2 }}>
        <KpiCard label={tr('Invoices')} value={num(kpi.count, 0)} sub={tr('in current filter')} color="#7c3aed" icon="ti-file-invoice" />
        <KpiCard label={tr('Net Sales WTax')} value={money(kpi.net)} sub={tr('with tax')} color="#0284c7" icon="ti-coin" />
        <KpiCard label={tr('Items')} value={num(kpi.prod, 0)} sub={tr('line items')} color="#059669" icon="ti-package" />
        <KpiCard label={tr('Avg basket')} value={money(kpi.avg)} sub={tr('per invoice')} color="#64748b" icon="ti-receipt" />
      </Box>

      {/* ── Invoice master grid ── */}
      <Paper elevation={0} sx={{ borderRadius: 2, border: '1px solid #e2e8f0', overflow: 'hidden', mt: 2 }}>
        <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ px: 1.5, py: 1 }}>
          <Typography sx={{ fontWeight: 700, fontSize: 13, color: '#0f172a' }}>
            {tr('Invoice Details')} <span style={{ color: '#94a3b8', fontWeight: 500 }}>· {num(invTotal, 0)}</span>
          </Typography>
          <GridExportBar gridRef={invGridRef} filename="journal_invoices" title="Journals" view={tr('Invoices')}
            filters={journalFilters} reportEndpoint="/api/sales/journal/invoices" reportPeriod={preset || 'custom'}
            reportParams={filterParams} colDefs={invColDefs} onResetColumns={invCols.resetColumns} />
        </Stack>
        <Box className="ag-theme-alpine" sx={{ height: 300, ...GRID_SX }}>
          <AgGridReact ref={invGridRef} rowData={invoices} columnDefs={trCols(invColDefs as any[])}
            defaultColDef={defaultColDef} overlayNoRowsTemplate={noRowsOverlay()}
            rowSelection="single"
            onRowClicked={e => { setShowAll(false); setSelDoc(String(e.data?.doc_no ?? '')) }}
            onGridReady={invCols.onGridReady} onColumnMoved={invCols.onColumnChanged}
            onColumnResized={invCols.onColumnChanged} onColumnVisible={invCols.onColumnChanged}
            rowHeight={34} headerHeight={38} suppressCellFocus animateRows
            pagination paginationPageSize={100} />
        </Box>
      </Paper>

      {/* ── Item detail grid ── */}
      <Paper elevation={0} sx={{ borderRadius: 2, border: '1px solid #e2e8f0', overflow: 'hidden', mt: 2, mb: 1 }}>
        <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ px: 1.5, py: 1, flexWrap: 'wrap', gap: 1 }}>
          <Typography sx={{ fontWeight: 700, fontSize: 13, color: '#0f172a' }}>
            {tr('Item Details')}
            {selDoc && !showAll ? <span style={{ color: ACCENT }}> · #{selDoc}</span>
              : (showAll ? <span style={{ color: '#94a3b8', fontWeight: 500 }}> · {tr('all filtered lines')}</span> : '')}
          </Typography>
          <Stack direction="row" spacing={1.5} alignItems="center">
            <FormControlLabel control={<Switch size="small" checked={showAll} onChange={e => setShowAll(e.target.checked)}
              sx={{ '& .Mui-checked': { color: ACCENT }, '& .Mui-checked + .MuiSwitch-track': { bgcolor: `${ACCENT} !important` } }} />}
              label={<Typography sx={{ fontSize: 12, fontWeight: 600 }}>{tr('Show all lines')}</Typography>} />
            <GridExportBar gridRef={itemGridRef} filename="journal_items" title="Journals" view={tr('Item lines')}
              filters={journalFilters} reportEndpoint="/api/sales/journal/items" reportPeriod={preset || 'custom'}
              reportParams={filterParams} colDefs={itemColDefs} onResetColumns={itemColsState.resetColumns} />
          </Stack>
        </Stack>
        <Box className="ag-theme-alpine" sx={{ height: 360, ...GRID_SX }}>
          <AgGridReact ref={itemGridRef} rowData={itemRows} columnDefs={trCols(itemColDefs as any[])}
            defaultColDef={defaultColDef}
            overlayNoRowsTemplate={itemsEnabled ? noRowsOverlay() : `<span style="color:#94a3b8;font-size:13px">${tr('Select an invoice above, or turn on “Show all lines”.')}</span>`}
            onGridReady={itemColsState.onGridReady} onColumnMoved={itemColsState.onColumnChanged}
            onColumnResized={itemColsState.onColumnChanged} onColumnVisible={itemColsState.onColumnChanged}
            rowHeight={32} headerHeight={38} suppressCellFocus animateRows
            pagination paginationPageSize={100} />
        </Box>
      </Paper>
    </Box>
  )
}
