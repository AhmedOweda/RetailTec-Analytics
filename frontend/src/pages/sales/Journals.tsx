/**
 * Sales → Journals — Power BI-style master/detail invoice explorer.
 * Click an invoice (master) → its line items load below (detail, drilled by
 * document no. PLUS the invoice's DOC_SID as the exact tiebreak, because
 * DOC_NO is not unique). "Show all lines" switches the detail to every line for the
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
import DataSlicer, { splitSlicer, itemFieldValue } from '../../components/DataSlicer'
import { useAppSettings } from '../../context/AppSettings'
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
import { gridLocaleText } from '../../utils/gridLocale'
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
      bgcolor: ret ? 'var(--rt-neg-bg)' : 'var(--rt-pos-bg)', color: ret ? 'var(--rt-neg-fg)' : 'var(--rt-pos-fg)' }}>{value}</Box>
  )
}

const GRID_SX = {
  width: '100%',
  '& .ag-header': { bgcolor: 'var(--rt-grid-header-bg) !important', borderBottom: '1px solid var(--rt-border)' },
  '& .ag-header-cell-text': { fontWeight: 700, color: 'var(--rt-grid-header-fg)', fontSize: 12 },
  '& .ag-row-even': { bgcolor: 'var(--rt-surface)' },
  '& .ag-row-odd': { bgcolor: 'var(--rt-surface-2)' },
  '& .ag-row-selected': { bgcolor: 'var(--rt-grid-selected) !important' },
  '& .ag-paging-panel': { borderTop: '1px solid var(--rt-border)', color: 'var(--rt-text-2)' },
} as const

export default function Journals() {
  const [preset, setPreset]   = useState('30D')
  const [dateFrom, setDateFrom] = useState(PRESETS['30D'][0])
  const [dateTo,   setDateTo]   = useState(PRESETS['30D'][1])
  const [stores,   setStores]   = useState<string[]>([])
  const [type,     setType]     = useState<'all'|'sale'|'return'>('all')
  const [docNo,    setDocNo]    = useState('')
  const [search,   setSearch]   = useState('')

  // ── Multi-value slicers: all three are the shared <DataSlicer>, which owns
  //    the debounced type-ahead against its searchEndpoint, the chips, the
  //    in-input busy indicator and the free-text (freeSolo) behaviour.
  //    State still holds a mix of option objects and typed strings.
  const { productCodeField, itemId } = useAppSettings()   // 'alu' | 'upc' | 'description'
  const [custSel, setCustSel] = useState<any[]>([])
  const [dcsSel,  setDcsSel ] = useState<any[]>([])
  const [itemSel, setItemSel] = useState<any[]>([])

  // token extractors (what the backend filters on for each chosen/typed value).
  // Customer chips stay human-readable: name, else the CUSTOMER NUMBER (cust_id),
  // else the internal SID as a last resort (drill-through stubs carry only the
  // SID; ~60 customers have no cust_id at all). The *filter* value for a picked
  // customer is still its SID — that is the only unique key — sent separately as
  // customer_id for the exact match. cust_id is display + typed search only.
  const custLabel = (o: any) =>
    String(o?.name || '').trim() || String(o?.cust_id ?? '').trim() || String(o?.customer_id ?? '')
  const custToken = (o: any) => typeof o === 'string' ? o : custLabel(o)
  const custId    = (o: any) => typeof o === 'string' ? '' : String(o.customer_id ?? '')
  const dcsToken  = (o: any) => typeof o === 'string' ? o : (o.subclass || o.class || o.department || '')
  // Item token = the identifier configured in Settings (ALU / UPC / description),
  // resolved by the shared helper instead of a hardcoded field.
  const itemToken = (o: any) => typeof o === 'string' ? o : itemFieldValue(o, productCodeField)

  // ── Governance criteria carried by a Home-alert drill-through ──────────────
  const [belowCost, setBelowCost] = useState(false)
  const [minDiscPct, setMinDiscPct] = useState<number | null>(null)

  // Drill-through: preset slicers from URL params (alerts / command palette /
  // dimension pages). EVERY criterion the link carries must be applied here —
  // anything read-but-not-stored (or stored under a name filterParams doesn't
  // send) silently drops the filter and the page looks unfiltered.
  const [sp] = useSearchParams()
  useEffect(() => {
    const cust = sp.get('customer') || sp.get('customer_name')
    if (cust) setCustSel([cust])
    const cid = sp.get('customer_id')
    if (cid) setCustSel(cid.split('|').filter(Boolean).map(id => ({ customer_id: id, name: '' })))
    const it = sp.get('item') || sp.get('item_desc')
    if (it) setItemSel([it])
    const dc = sp.get('dcs');    if (dc) setDcsSel([dc])
    const st = sp.get('stores'); if (st) setStores(st.split(',').filter(Boolean))
    if (sp.get('type') === 'return') setType('return')
    else if (sp.get('type') === 'sale') setType('sale')
    // The alert's window (anchored to the warehouse's latest date, which may
    // lag today) — without it the page falls back to its own 30D preset.
    const df = sp.get('date_from'), dt = sp.get('date_to')
    if (df && dt) { setPreset(''); setDateFrom(df); setDateTo(dt) }
    if (sp.get('below_cost') === 'true' || sp.get('below_cost') === '1') setBelowCost(true)
    const mdp = sp.get('min_discount_pct')
    if (mdp && !Number.isNaN(+mdp)) setMinDiscPct(+mdp)
  }, [])   // eslint-disable-line react-hooks/exhaustive-deps
  // Selected invoice: the document no. (what the user sees / what the detail
  // header shows) PLUS its DOC_SID as the exact tiebreak. DOC_NO is not unique
  // — 1,624 numbers are shared by more than one invoice — so drilling on doc_no
  // alone can pull a second invoice's lines into the detail grid.
  // The SID is an 18-19 digit BIGINT: keep it a STRING, never Number(sid).
  const [selDoc,   setSelDoc]   = useState<string | null>(null)   // selected document no.
  const [selSid,   setSelSid]   = useState<string | null>(null)   // its DOC_SID (string!)
  const [showAll,  setShowAll]  = useState(false)

  // Master row click → carry BOTH keys. doc_sid is an 18-19 digit BIGINT the
  // backend already returns as text; keep it text — Number() would round it.
  const onInvoiceRowClicked = (e: any) => {
    setShowAll(false)
    setSelDoc(String(e.data?.doc_no ?? ''))
    setSelSid(String(e.data?.doc_sid ?? ''))
  }

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

  // A customer PICKED from the type-ahead filters exactly on its id; anything
  // typed as free text still goes through the fuzzy name/id/phone match.
  // splitSlicer() is the shared helper — no page re-derives this.
  const { ids: custIds, typed: custText } = splitSlicer(custSel, custId, custToken)

  const filterParams = useMemo(() => ({
    date_from: dateFrom, date_to: dateTo,
    ...(stores.length ? { stores: stores.join(',') } : {}),
    ...(type !== 'all' ? { type } : {}),
    ...(docNo.trim()    ? { doc_no: docNo.trim() } : {}),
    ...(custIds.length  ? { customer_id: custIds.join('|') } : {}),
    ...(custText.length ? { customer: custText.join('|') } : {}),
    ...(dcsSel.length  ? { dcs: dcsSel.map(dcsToken).filter(Boolean).join('|') } : {}),
    ...(itemSel.length ? { item: itemSel.map(itemToken).filter(Boolean).join('|') } : {}),
    ...(belowCost ? { below_cost: true } : {}),
    ...(minDiscPct != null ? { min_discount_pct: minDiscPct } : {}),
    ...(search.trim()   ? { search: search.trim() } : {}),
  }), [dateFrom, dateTo, stores, type, docNo, custSel, dcsSel, itemSel, belowCost, minDiscPct, search])   // eslint-disable-line react-hooks/exhaustive-deps

  // Master: invoice headers (no hardcoded cap — bounded by the date/filters)
  const { data: invData, isFetching: invFetching, refetch: refetchInv } = useQuery({
    queryKey: ['journal-invoices', filterParams],
    queryFn: () => axios.get('/api/sales/journal/invoices', { params: filterParams }).then(r => r.data),
    placeholderData: p => p,
  })
  const invoices: any[] = invData?.rows ?? []
  const invTotal: number = invData?.total ?? invoices.length
  useRetryIfEmpty(invoices.length === 0, invFetching, refetchInv)

  // Detail: item lines — the selected invoice (drill by doc_no + doc_sid, which
  // together identify exactly one invoice) OR all filtered lines.
  const itemParams = useMemo(() => ({
    ...filterParams,
    ...(showAll ? {} : {
      ...(selDoc ? { doc_no: selDoc } : {}),
      ...(selSid ? { doc_sid: selSid } : {}),   // string — never Number()
    }),
  }), [filterParams, showAll, selDoc, selSid])
  const itemsEnabled = showAll || !!selDoc || !!selSid
  const { data: itemRows = [] } = useQuery<any[]>({
    queryKey: ['journal-items', itemParams, showAll, selDoc, selSid],
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
             color: a > 0.6 ? '#fff' : 'var(--rt-text)', fontWeight: 600 }
  }

  const kpi = useMemo(() => {
    const net = invoices.reduce((s, r) => s + +(r.net_sales_wtax ?? 0), 0)
    const prod = invoices.reduce((s, r) => s + +(r.product_count ?? 0), 0)
    return { count: invTotal, net, prod, avg: invTotal ? net / invTotal : 0 }
  }, [invoices, invTotal])

  const invColDefs = useMemo<ColDef[]>(() => [
    { field: 'created_datetime', headerName: 'Invoice Post Date', width: 165, pinned: 'left' },
    { field: 'doc_no', headerName: 'Document No.', width: 120, pinned: 'left',
      cellStyle: { fontFamily: 'monospace', fontWeight: 700, color: ACCENT } },
    { field: 'invoice_type', headerName: 'Type', width: 90, cellRenderer: TypeBadge },
    { field: 'store_code', headerName: 'Store Code', width: 100 },
    { field: 'store_name', headerName: 'Store Name', width: 180 },
    { field: 'net_sales_wtax', headerName: 'Net Sales WTax', width: 130, type: 'numericColumn',
      valueFormatter: p => fmtMoney(p.value), cellStyle: { fontWeight: 700 } },
    { field: 'product_count', headerName: '#Products', width: 100, type: 'numericColumn',
      valueFormatter: p => num(p.value, 0) },
    // The customer NUMBER, not the internal 18-digit SID. Blank when the source
    // customer has no CUST_ID (~60 of them) — the name column carries those.
    { field: 'cust_id', headerName: 'Customer ID', width: 120,
      valueFormatter: p => (p.value ? String(p.value) : '—') },
    { field: 'customer_name', headerName: 'Customer Name', flex: 1, minWidth: 150 },
    { field: 'associate_name', headerName: 'Associate', width: 150 },
  ], [])

  const itemColDefs = useMemo<ColDef[]>(() => [
    { field: 'doc_no', headerName: 'Document No.', width: 120, pinned: 'left',
      cellStyle: { fontFamily: 'monospace', fontWeight: 600 } },
    { field: 'item_type', headerName: 'Item Type', width: 95, cellRenderer: TypeBadge },
    // The configured identifier column (endpoint returns alu/upc/description1).
    // When Description is configured the Item Desc column below IS the
    // identifier, so no duplicate code column is added. ALU fallback keeps the
    // cell non-blank when the configured field is NULL (UPC often is).
    ...(itemId.field !== 'description' ? [{
      field: ({ alu: 'alu', upc: 'upc', description: 'description1' } as Record<string, string>)[itemId.field],
      headerName: itemId.label, width: 130,
      valueGetter: (p: any) => itemFieldValue(p.data, itemId.field),
      cellStyle: { fontFamily: 'monospace', color: ACCENT },
    } as ColDef] : []),
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
      cellStyle: p => (+(p.value ?? 0) > 0 ? { backgroundColor: 'var(--rt-neg-bg)', color: 'var(--rt-neg-fg)', fontWeight: 600 } : undefined) },
    { field: 'associate_name', headerName: 'Associate', width: 150 },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [maxPrice, itemId.field, itemId.label])

  const defaultColDef = useMemo(() => ({ sortable: true, filter: true, resizable: true,
    wrapHeaderText: true, autoHeaderHeight: true }), [])

  const journalFilters = `${dateFrom} → ${dateTo} · ${stores.length ? `${stores.length} ${tr('store(s)')}` : tr('All stores')}${type !== 'all' ? ` · ${type}` : ''}`

  // Saved views: serialise/restore the whole slicer set.
  const currentView = { preset, dateFrom, dateTo, stores, type, docNo, custSel, dcsSel, itemSel,
                        belowCost, minDiscPct, search }
  const applyView = (s: any) => {
    if (!s) return
    setPreset(s.preset ?? ''); setDateFrom(s.dateFrom ?? dateFrom); setDateTo(s.dateTo ?? dateTo)
    setStores(s.stores ?? []); setType(s.type ?? 'all'); setDocNo(s.docNo ?? '')
    setCustSel(s.custSel ?? [])
    setDcsSel(s.dcsSel ?? []); setItemSel(s.itemSel ?? []); setSearch(s.search ?? '')
    setBelowCost(!!s.belowCost); setMinDiscPct(s.minDiscPct ?? null)
  }

  return (
    <Box sx={{ pt: 0, px: 3, pb: 3, minHeight: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* ── Header + slicers (standard sticky pattern) ── */}
      <Box sx={{ position: 'sticky', top: 0, zIndex: 10, bgcolor: 'var(--rt-surface)', mx: -3, px: 3, pt: 3, pb: 2,
        borderBottom: '1px solid var(--rt-border)' }}>
        <Typography variant="h6" sx={{ fontWeight: 800, color: 'var(--rt-text)', letterSpacing: '-0.3px', mb: 0.3 }}>
          {tr('Invoice Explorer')}<TitleLoader />
        </Typography>
        <Typography sx={{ fontSize: 12, color: '#64748b', mb: 1.5 }}>{dateFrom} — {dateTo}</Typography>

        <Box sx={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 1 }}>
          <Stack direction="row" spacing={0.5}>
            {Object.keys(PRESETS).map(p => (
              <Chip key={p} label={tr(p)} size="small" onClick={() => applyPreset(p)}
                variant={preset === p ? 'filled' : 'outlined'}
                sx={{ fontWeight: 600, fontSize: 11, ...(preset === p
                  ? { bgcolor: ACCENT, color: '#fff', '&:hover': { bgcolor: '#6d28d9' } }
                  : { borderColor: 'var(--rt-border)', color: '#64748b' }) }} />
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
            renderInput={p => <TextField {...p} placeholder={tr('Store')} />} limitTags={1} />
          <Box sx={{ flex: 1 }} />
          <SavedViewsBar pageKey="journals" current={currentView} onApply={applyView} />
        </Box>

        <Box sx={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 1, mt: 1 }}>
          <TextField size="small" placeholder={tr('Document No.')} value={docNo} onChange={e => setDocNo(e.target.value)} sx={{ width: 130 }} />

          {/* Customer — name | phone | id */}
          <DataSlicer sx={{ minWidth: 220, maxWidth: 340 }} value={custSel} onChange={setCustSel}
            searchEndpoint="/api/sales/journal/search/customers"
            getToken={custToken} getId={custId} placeholder="Customer (name / phone / customer no.)"
            renderLabel={(o: any) => (typeof o === 'string' ? { code: o } : { code: custLabel(o), rest: [o.phone, o.cust_id].filter(Boolean).join(' | ') })} />

          {/* Dept | Class | Subclass */}
          <DataSlicer sx={{ minWidth: 220, maxWidth: 360 }} value={dcsSel} onChange={setDcsSel}
            searchEndpoint="/api/sales/journal/search/dcs"
            getToken={dcsToken} placeholder="Dept / Class / Subclass"
            renderLabel={(o: any) => (typeof o === 'string' ? { code: o } : { code: o.department || '—', rest: [o.class, o.subclass].filter(Boolean).join(' | ') })} />

          {/* Item — configured identifier | description */}
          <DataSlicer sx={{ minWidth: 240, maxWidth: 380 }} value={itemSel} onChange={setItemSel}
            searchEndpoint="/api/inventory/items-search"
            getToken={itemToken} itemField={productCodeField} placeholder="Item (code / description)"
            renderLabel={(o: any) => (typeof o === 'string' ? { code: o } : { code: itemFieldValue(o, productCodeField), rest: o.DESCRIPTION1 })} />

          <TextField size="small" placeholder={tr('Quick search...')} value={search} onChange={e => setSearch(e.target.value)}
            sx={{ width: 200 }} InputProps={{ startAdornment: <InputAdornment position="start"><SearchIcon sx={{ fontSize: 18, color: '#94a3b8' }} /></InputAdornment> }} />

          {/* Criteria arriving from a Home alert — visible so they can be cleared */}
          {belowCost && (
            <Chip size="small" label={tr('Sold below cost')} onDelete={() => setBelowCost(false)}
              sx={{ fontWeight: 600, fontSize: 11, bgcolor: `${ACCENT}18`, color: ACCENT }} />
          )}
          {minDiscPct != null && (
            <Chip size="small" label={`${tr('Discount')} ≥ ${minDiscPct}%`} onDelete={() => setMinDiscPct(null)}
              sx={{ fontWeight: 600, fontSize: 11, bgcolor: `${ACCENT}18`, color: ACCENT }} />
          )}
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
      <Paper elevation={0} sx={{ borderRadius: 2, border: '1px solid var(--rt-border)', overflow: 'hidden', mt: 2 }}>
        <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ px: 1.5, py: 1 }}>
          <Typography sx={{ fontWeight: 700, fontSize: 13, color: 'var(--rt-text)' }}>
            {tr('Invoice Details')} <span style={{ color: '#94a3b8', fontWeight: 500 }}>· {num(invTotal, 0)}</span>
          </Typography>
          <GridExportBar gridRef={invGridRef} filename="journal_invoices" title="Invoice Explorer" view={tr('Invoices')}
            filters={journalFilters} reportEndpoint="/api/sales/journal/invoices" reportPeriod={preset || 'custom'}
            reportParams={filterParams} colDefs={invColDefs} onResetColumns={invCols.resetColumns} />
        </Stack>
        <Box className="ag-theme-alpine" sx={{ height: 300, ...GRID_SX }}>
          <AgGridReact localeText={gridLocaleText()} ref={invGridRef} rowData={invoices} columnDefs={trCols(invColDefs as any[])}
            defaultColDef={defaultColDef} overlayNoRowsTemplate={noRowsOverlay()}
            rowSelection="single"
            onRowClicked={onInvoiceRowClicked}
            onGridReady={invCols.onGridReady} onColumnMoved={invCols.onColumnChanged}
            onColumnResized={invCols.onColumnChanged} onColumnVisible={invCols.onColumnChanged}
            rowHeight={34} headerHeight={38} suppressCellFocus animateRows
            pagination paginationPageSize={100} />
        </Box>
      </Paper>

      {/* ── Item detail grid ── */}
      <Paper elevation={0} sx={{ borderRadius: 2, border: '1px solid var(--rt-border)', overflow: 'hidden', mt: 2, mb: 1 }}>
        <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ px: 1.5, py: 1, flexWrap: 'wrap', gap: 1 }}>
          <Typography sx={{ fontWeight: 700, fontSize: 13, color: 'var(--rt-text)' }}>
            {tr('Item Details')}
            {selDoc && !showAll ? <span style={{ color: ACCENT }}> · #{selDoc}</span>
              : (showAll ? <span style={{ color: '#94a3b8', fontWeight: 500 }}> · {tr('all filtered lines')}</span> : '')}
          </Typography>
          <Stack direction="row" spacing={1.5} alignItems="center">
            <FormControlLabel control={<Switch size="small" checked={showAll} onChange={e => setShowAll(e.target.checked)}
              sx={{ '& .Mui-checked': { color: ACCENT }, '& .Mui-checked + .MuiSwitch-track': { bgcolor: `${ACCENT} !important` } }} />}
              label={<Typography sx={{ fontSize: 12, fontWeight: 600 }}>{tr('Show all lines')}</Typography>} />
            <GridExportBar gridRef={itemGridRef} filename="journal_items" title="Invoice Explorer" view={tr('Item lines')}
              filters={journalFilters} reportEndpoint="/api/sales/journal/items" reportPeriod={preset || 'custom'}
              reportParams={filterParams} colDefs={itemColDefs} onResetColumns={itemColsState.resetColumns} />
          </Stack>
        </Stack>
        <Box className="ag-theme-alpine" sx={{ height: 360, ...GRID_SX }}>
          <AgGridReact localeText={gridLocaleText()} ref={itemGridRef} rowData={itemRows} columnDefs={trCols(itemColDefs as any[])}
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
