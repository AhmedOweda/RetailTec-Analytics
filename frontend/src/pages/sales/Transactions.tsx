/**
 * Transactions — AG Grid  •  server-side search  •  advanced filter popup
 *                          •  Excel / PDF export  •  resizable + sortable cols
 */
import { useState, useRef, useCallback, useMemo } from 'react'
import {
  Box, Typography, Chip, TextField, LinearProgress,
  Button, CircularProgress, Dialog, DialogTitle,
  DialogContent, DialogActions, Divider, Stack,
  InputAdornment, Tooltip, IconButton, Fade, Badge,
  Autocomplete,
} from '@mui/material'
import SearchIcon       from '@mui/icons-material/Search'
import TuneIcon         from '@mui/icons-material/Tune'
import CloseIcon        from '@mui/icons-material/Close'
import FileDownloadIcon from '@mui/icons-material/FileDownload'
import PictureAsPdfIcon from '@mui/icons-material/PictureAsPdf'
import { AgGridReact }  from 'ag-grid-react'
import { ColDef, GridReadyEvent, IRowNode } from 'ag-grid-community'
import 'ag-grid-community/styles/ag-grid.css'
import 'ag-grid-community/styles/ag-theme-alpine.css'
import { useQuery }     from '@tanstack/react-query'
import axios            from 'axios'
import { format, subDays, startOfMonth } from 'date-fns'
import { num }          from '../../utils/formatters'
import * as XLSX        from 'xlsx'
import jsPDF            from 'jspdf'
import autoTable        from 'jspdf-autotable'

/* ── Theme ──────────────────────────────────────────────────────────── */
const ACCENT  = '#7c3aed'
const ACCENT2 = '#6d28d9'
const SURFACE = '#faf9ff'

const QUICK = [
  { label:'7D',  days:7  },
  { label:'30D', days:30 },
  { label:'90D', days:90 },
  { label:'MTD', days:-1 },
]

const TYPE_COLOR: Record<string, { text:string; bg:string }> = {
  Sale:   { text:'#16a34a', bg:'#dcfce7' },
  Return: { text:'#dc2626', bg:'#fee2e2' },
  Order:  { text:'#d97706', bg:'#fef3c7' },
}

/* ── Advanced-filter shape ──────────────────────────────────────────── */
interface AdvFilters {
  docNo:    string
  store:    string    // single store (dropdown)
  assoc:    string[]  // multi-select associates
  customer: string[]  // multi-select customers
  types:    string[]
  minSales: string
  maxSales: string
}
const EMPTY_ADV: AdvFilters = {
  docNo:'', store:'', assoc:[], customer:[],
  types:['Sale','Return','Order'], minSales:'', maxSales:'',
}
const ADV_ACTIVE = (f: AdvFilters) =>
  f.docNo || f.store || f.assoc.length > 0 || f.customer.length > 0 ||
  f.types.length !== 3 || f.minSales || f.maxSales

/* ── Column definitions ─────────────────────────────────────────────── */
const numFmt = (p: any) => num(p.value ?? 0)

const COL_DEFS: ColDef[] = [
  {
    headerName: '#', width: 60, pinned: 'left',
    sortable: false, resizable: false, suppressMovable: true,
    valueGetter: (p: any) => (p.node?.rowIndex ?? 0) + 1,
    cellStyle: { color:'#94a3b8', fontSize:11, fontWeight:500, display:'flex', alignItems:'center' },
  },
  { field:'doc_no',        headerName:'Doc No',       width:130, pinned:'left',
    cellStyle:{ fontWeight:600, color:'#1e293b', display:'flex', alignItems:'center' } },
  { field:'post_date',     headerName:'Date',          width:170 },
  { field:'store_name',    headerName:'Store',         width:170 },
  { field:'employee_name', headerName:'Associate',     width:155 },
  { field:'customer_name', headerName:'Customer',      width:155 },
  {
    field:'type', headerName:'Type', width:95,
    cellRenderer:(p:any) => {
      const c = TYPE_COLOR[p.value] ?? { text:'#64748b', bg:'#f1f5f9' }
      return <span style={{ display:'inline-block', padding:'2px 10px', borderRadius:'99px', background:c.bg, color:c.text, fontWeight:700, fontSize:11 }}>{p.value ?? ''}</span>
    },
  },
  { field:'net_sales',    headerName:'Net Sales',    width:120, type:'numericColumn', valueFormatter:numFmt },
  { field:'total_tax',    headerName:'Tax',           width:100, type:'numericColumn', valueFormatter:numFmt },
  { field:'total_wtax',   headerName:'Total W/Tax',  width:125, type:'numericColumn', valueFormatter:numFmt },
  { field:'invoice_disc', headerName:'Discount',     width:110, type:'numericColumn', valueFormatter:numFmt },
  { field:'cash',         headerName:'Cash',          width:100, type:'numericColumn', valueFormatter:numFmt },
  { field:'card',         headerName:'Card',          width:100, type:'numericColumn', valueFormatter:numFmt },
  { field:'deposit',      headerName:'Deposit',       width:100, type:'numericColumn', valueFormatter:numFmt },
  { field:'other',        headerName:'Other',         width:90,  type:'numericColumn', valueFormatter:numFmt },
]

const DEFAULT_COL: ColDef = {
  sortable: true, resizable: true, filter: false, suppressMovable: false,
  cellStyle: { display:'flex', alignItems:'center' },
}

/* ── Component ──────────────────────────────────────────────────────── */
export default function Transactions() {
  const [days,      setDays     ] = useState(7)
  const [search,    setSearch   ] = useState('')
  const [advOpen,   setAdvOpen  ] = useState(false)
  const [adv,       setAdv      ] = useState<AdvFilters>(EMPTY_ADV)
  const [advDraft,  setAdvDraft ] = useState<AdvFilters>(EMPTY_ADV)
  const [exporting, setExporting] = useState<'excel'|'pdf'|null>(null)
  const gridRef = useRef<AgGridReact>(null)

  const today = format(new Date(), 'yyyy-MM-dd')
  const from  = days === -1
    ? format(startOfMonth(new Date()), 'yyyy-MM-dd')
    : format(subDays(new Date(), days - 1), 'yyyy-MM-dd')

  /* ── Dimension lists for filter dropdowns ───────────────────── */
  const { data: storesList   = [] } = useQuery<string[]>({
    queryKey: ['stores-list'],
    queryFn:  () => axios.get('/api/sales/stores-list').then(r => r.data),
    staleTime: 3_600_000,
  })
  const { data: employeesList = [] } = useQuery<string[]>({
    queryKey: ['employees-list'],
    queryFn:  () => axios.get('/api/sales/employees-list').then(r => r.data),
    staleTime: 3_600_000,
  })
  const { data: customersList = [] } = useQuery<string[]>({
    queryKey: ['customers-list'],
    queryFn:  () => axios.get('/api/sales/customers-list').then(r => r.data),
    staleTime: 3_600_000,
  })

  /* ── Data fetch ─────────────────────────────────────────────── */
  const { data, isLoading, isFetching } = useQuery({
    queryKey: ['transactions', from, today, search],
    queryFn:  () => axios
      .get(`/api/sales/transactions?date_from=${from}&date_to=${today}&search=${encodeURIComponent(search)}&limit=0&offset=0`)
      .then(r => r.data),
    placeholderData: (prev: any) => prev,
  })

  const rows: any[] = useMemo(() => data?.rows ?? [], [data])
  const total: number = data?.total ?? 0

  /* ── Advanced filter callbacks ──────────────────────────────── */
  const isExternalFilterPresent = useCallback(() => !!ADV_ACTIVE(adv), [adv])

  const doesExternalFilterPass = useCallback((node: IRowNode) => {
    const r = node.data
    if (!r) return true
    const ci = (s: string) => s.toLowerCase()
    if (adv.docNo    && !String(r.doc_no        ?? '').toLowerCase().includes(ci(adv.docNo)))    return false
    if (adv.store    && !String(r.store_name     ?? '').toLowerCase().includes(ci(adv.store)))    return false
    if (adv.assoc.length > 0    && !adv.assoc.some(a    => String(r.employee_name  ?? '').toLowerCase() === a.toLowerCase()))    return false
    if (adv.customer.length > 0 && !adv.customer.some(c => String(r.customer_name  ?? '').toLowerCase() === c.toLowerCase())) return false
    if (adv.types.length < 3 && !adv.types.includes(r.type))                                       return false
    if (adv.minSales && (r.net_sales ?? 0) < parseFloat(adv.minSales)) return false
    if (adv.maxSales && (r.net_sales ?? 0) > parseFloat(adv.maxSales)) return false
    return true
  }, [adv])

  const onGridReady = useCallback((e: GridReadyEvent) => { e.api.sizeColumnsToFit() }, [])

  /* ── Adv filter actions ─────────────────────────────────────── */
  const applyAdv = () => {
    setAdv(advDraft); setAdvOpen(false)
    setTimeout(() => gridRef.current?.api?.onFilterChanged(), 50)
  }
  const clearAdv = () => {
    setAdv(EMPTY_ADV); setAdvDraft(EMPTY_ADV); setAdvOpen(false)
    setTimeout(() => gridRef.current?.api?.onFilterChanged(), 50)
  }
  const openAdv = () => { setAdvDraft(adv); setAdvOpen(true) }

  const activeChips: { label:string; key:string }[] = []
  if (adv.docNo)              activeChips.push({ label:`Doc: ${adv.docNo}`, key:'docNo' })
  if (adv.store)              activeChips.push({ label:`Store: ${adv.store}`, key:'store' })
  if (adv.assoc.length > 0)  activeChips.push({ label:`Associate: ${adv.assoc.length === 1 ? adv.assoc[0] : `${adv.assoc.length} selected`}`, key:'assoc' })
  if (adv.customer.length > 0) activeChips.push({ label:`Customer: ${adv.customer.length === 1 ? adv.customer[0] : `${adv.customer.length} selected`}`, key:'customer' })
  if (adv.types.length<3)    activeChips.push({ label:`Type: ${adv.types.join('/')}`, key:'types' })
  if (adv.minSales)          activeChips.push({ label:`Min: ${adv.minSales}`, key:'minSales' })
  if (adv.maxSales)          activeChips.push({ label:`Max: ${adv.maxSales}`, key:'maxSales' })

  const removeChip = (key: string) => {
    const emptyVal = key === 'types' ? ['Sale','Return','Order'] : key === 'assoc' || key === 'customer' ? [] : ''
    const next = { ...adv, [key]: emptyVal }
    setAdv(next); setAdvDraft(next)
    setTimeout(() => gridRef.current?.api?.onFilterChanged(), 50)
  }

  /* ── Export helpers ─────────────────────────────────────────── */
  const getVisibleRows = (): any[] => {
    const api = gridRef.current?.api
    if (!api) return rows
    const out: any[] = []
    api.forEachNodeAfterFilterAndSort((n: IRowNode) => { if (n.data) out.push(n.data) })
    return out
  }

  const EXPORT_COLS = COL_DEFS
    .filter(c => c.headerName !== '#')
    .map(c => ({ key: c.field as string, label: c.headerName as string }))

  const exportExcel = async () => {
    setExporting('excel')
    try {
      const vis = getVisibleRows()
      const ws  = XLSX.utils.json_to_sheet(
        vis.map((r:any) => Object.fromEntries(EXPORT_COLS.map(c => [c.label, r[c.key] ?? ''])))
      )
      ws['!cols'] = EXPORT_COLS.map(() => ({ wch: 14 }))
      const wb = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(wb, ws, 'Transactions')
      XLSX.writeFile(wb, `transactions_${from}_${today}.xlsx`)
    } finally { setExporting(null) }
  }

  const exportPDF = async () => {
    setExporting('pdf')
    try {
      const vis = getVisibleRows()
      const doc = new jsPDF({ orientation:'landscape', unit:'pt', format:'a3' })
      doc.setFontSize(14); doc.setTextColor(15,23,42)
      doc.text('Transactions Report', 30, 38)
      doc.setFontSize(9); doc.setTextColor(100,116,139)
      doc.text(`Period: ${from}  →  ${today}     Records: ${vis.length.toLocaleString()}`, 30, 54)
      autoTable(doc, {
        head: [EXPORT_COLS.map(c => c.label)],
        body: vis.map((r:any) => EXPORT_COLS.map(c => r[c.key] ?? '')),
        startY: 66,
        styles:            { fontSize:6.5, cellPadding:3, overflow:'ellipsis' },
        headStyles:        { fillColor:[124,58,237], textColor:255, fontStyle:'bold', fontSize:7 },
        alternateRowStyles:{ fillColor:[250,249,255] },
      })
      doc.save(`transactions_${from}_${today}.pdf`)
    } finally { setExporting(null) }
  }

  const busy      = isLoading || isFetching
  const advActive = !!ADV_ACTIVE(adv)

  /* ── Render ─────────────────────────────────────────────────── */
  return (
    <Box sx={{ display:'flex', flexDirection:'column', height:'100%', bgcolor:SURFACE, p:2.5, gap:1.5 }}>

      {/* ══ Toolbar ══ */}
      <Box sx={{ display:'flex', alignItems:'center', gap:1.5, flexWrap:'wrap' }}>
        <Typography variant="h6" sx={{ fontWeight:800, color:'#0f172a', letterSpacing:'-0.3px', mr:'auto' }}>
          Transactions
        </Typography>

        {/* Period selector */}
        <Box sx={{ display:'flex', gap:0.75, p:0.5, bgcolor:'#f1f5f9', borderRadius:2 }}>
          {QUICK.map(q => (
            <Chip key={q.label} label={q.label} size="small" onClick={() => setDays(q.days)}
              sx={{
                fontWeight:700, fontSize:12, height:28, px:0.5,
                transition:'all .18s ease',
                bgcolor: days===q.days ? ACCENT : 'transparent',
                color:   days===q.days ? '#fff' : '#64748b',
                boxShadow: days===q.days ? '0 2px 8px rgba(124,58,237,.35)' : 'none',
                '&:hover':{ bgcolor: days===q.days ? ACCENT2 : '#e2e8f0' },
              }}
            />
          ))}
        </Box>

        {/* Quick search */}
        <TextField size="small" placeholder="Quick search…" value={search}
          onChange={e => setSearch(e.target.value)}
          InputProps={{
            startAdornment:(
              <InputAdornment position="start">
                <SearchIcon sx={{ fontSize:18, color:'#94a3b8' }}/>
              </InputAdornment>
            ),
            endAdornment: search ? (
              <InputAdornment position="end">
                <IconButton size="small" onClick={() => setSearch('')}>
                  <CloseIcon sx={{ fontSize:15 }}/>
                </IconButton>
              </InputAdornment>
            ) : null,
          }}
          sx={{
            width:240,
            '& .MuiOutlinedInput-root':{
              borderRadius:2.5, bgcolor:'#fff',
              '&:hover':     { boxShadow:'0 0 0 2px #ede9fe' },
              '&.Mui-focused':{ boxShadow:`0 0 0 2px ${ACCENT}40` },
            },
          }}
        />

        {/* Advanced filter */}
        <Tooltip title="Advanced filters" arrow>
          <Badge color="secondary" variant="dot" invisible={!advActive}
            sx={{ '& .MuiBadge-dot':{ bgcolor:ACCENT, width:8, height:8 } }}>
            <Button size="small" variant={advActive ? 'contained' : 'outlined'} onClick={openAdv}
              startIcon={<TuneIcon sx={{ fontSize:'16px !important' }}/>}
              sx={{
                textTransform:'none', borderRadius:2.5, fontWeight:600, height:36,
                ...(advActive
                  ? { bgcolor:ACCENT, '&:hover':{ bgcolor:ACCENT2 }, boxShadow:'0 2px 8px rgba(124,58,237,.35)' }
                  : { borderColor:'#e2e8f0', color:'#475569', '&:hover':{ borderColor:ACCENT, color:ACCENT } }
                ),
              }}
            >Filters</Button>
          </Badge>
        </Tooltip>

        {/* Export */}
        <Tooltip title="Export to Excel" arrow><span>
          <Button size="small" variant="outlined" disabled={!!exporting||rows.length===0}
            onClick={exportExcel}
            startIcon={exporting==='excel' ? <CircularProgress size={13} sx={{ color:ACCENT }}/> : <FileDownloadIcon sx={{ fontSize:'17px !important' }}/>}
            sx={{ textTransform:'none', borderRadius:2.5, fontWeight:600, height:36, borderColor:'#e2e8f0', color:'#16a34a', '&:hover':{ borderColor:'#16a34a', bgcolor:'#f0fdf4' } }}
          >Excel</Button>
        </span></Tooltip>

        <Tooltip title="Export to PDF" arrow><span>
          <Button size="small" variant="outlined" disabled={!!exporting||rows.length===0}
            onClick={exportPDF}
            startIcon={exporting==='pdf' ? <CircularProgress size={13} sx={{ color:ACCENT }}/> : <PictureAsPdfIcon sx={{ fontSize:'17px !important' }}/>}
            sx={{ textTransform:'none', borderRadius:2.5, fontWeight:600, height:36, borderColor:'#e2e8f0', color:'#dc2626', '&:hover':{ borderColor:'#dc2626', bgcolor:'#fff5f5' } }}
          >PDF</Button>
        </span></Tooltip>
      </Box>

      {/* ══ Active filter chips ══ */}
      {activeChips.length > 0 && (
        <Fade in>
          <Box sx={{ display:'flex', gap:0.75, flexWrap:'wrap', alignItems:'center' }}>
            <Typography variant="caption" sx={{ color:'#94a3b8', fontWeight:700, mr:0.5, letterSpacing:.5, textTransform:'uppercase', fontSize:10 }}>
              Active filters
            </Typography>
            {activeChips.map(chip => (
              <Chip key={chip.key} label={chip.label} size="small"
                onDelete={() => removeChip(chip.key)}
                deleteIcon={<CloseIcon style={{ fontSize:12 }}/>}
                sx={{ bgcolor:'#ede9fe', color:ACCENT, fontWeight:600, fontSize:11, height:24, borderRadius:1.5,
                  '& .MuiChip-deleteIcon':{ color:ACCENT, '&:hover':{ color:ACCENT2 } } }}
              />
            ))}
            <Chip label="Clear all" size="small" onClick={clearAdv}
              sx={{ bgcolor:'transparent', color:'#94a3b8', fontWeight:600, fontSize:11, height:24, borderRadius:1.5,
                border:'1px dashed #cbd5e1', '&:hover':{ bgcolor:'#fef2f2', color:'#dc2626', borderColor:'#dc2626' } }}
            />
          </Box>
        </Fade>
      )}

      {/* ══ Status bar ══ */}
      <Box sx={{ display:'flex', alignItems:'center', gap:1.5, minHeight:20 }}>
        <Typography variant="caption" sx={{ color:'#64748b', fontWeight:500 }}>
          {busy ? 'Loading…' : `${total.toLocaleString()} transaction${total!==1?'s':''}  ·  ${from}  →  ${today}`}
        </Typography>
        {busy && (
          <LinearProgress sx={{ flex:1, height:3, borderRadius:2, bgcolor:'#ede9fe',
            '& .MuiLinearProgress-bar':{ bgcolor:ACCENT, borderRadius:2 } }}/>
        )}
      </Box>

      {/* ══ AG Grid ══ */}
      <Box className="ag-theme-alpine" sx={{
        flex:1, width:'100%', minHeight:0,
        borderRadius:2, overflow:'hidden',
        boxShadow:'0 1px 4px rgba(15,23,42,.08)',
        border:'1px solid #e2e8f0',
        '& .ag-root-wrapper':{ borderRadius:2 },
        '& .ag-header':{ bgcolor:'#f8f7ff !important', borderBottom:'1px solid #e9e4ff' },
        '& .ag-header-cell-text':{ fontWeight:700, color:'#374151', fontSize:12 },
        '& .ag-row-even':{ bgcolor:'#ffffff' },
        '& .ag-row-odd': { bgcolor:'#faf9ff' },
        '& .ag-row:hover':{ bgcolor:'#f3f0ff !important' },
        '& .ag-paging-panel':{ borderTop:'1px solid #e9e4ff', color:'#475569' },
      }}>
        <AgGridReact
          ref={gridRef}
          rowData={rows}
          columnDefs={COL_DEFS}
          defaultColDef={DEFAULT_COL}
          onGridReady={onGridReady}
          isExternalFilterPresent={isExternalFilterPresent}
          doesExternalFilterPass={doesExternalFilterPass}
          pagination={true}
          paginationPageSize={100}
          paginationPageSizeSelector={[50,100,200,500]}
          animateRows={true}
          rowHeight={38}
          headerHeight={42}
          suppressCellFocus={true}
          style={{ height:'100%', width:'100%' }}
        />
      </Box>

      {/* ══ Advanced Search Dialog ══ */}
      <Dialog open={advOpen} onClose={() => setAdvOpen(false)} TransitionComponent={Fade}
        PaperProps={{ sx:{ borderRadius:3, width:520, boxShadow:'0 24px 64px rgba(15,23,42,.18)', border:'1px solid #e9e4ff' } }}>

        <DialogTitle sx={{ pb:1.5 }}>
          <Box sx={{ display:'flex', alignItems:'center', justifyContent:'space-between' }}>
            <Box sx={{ display:'flex', alignItems:'center', gap:1.25 }}>
              <Box sx={{ width:36, height:36, borderRadius:1.5, bgcolor:'#ede9fe', display:'flex', alignItems:'center', justifyContent:'center' }}>
                <TuneIcon sx={{ color:ACCENT, fontSize:18 }}/>
              </Box>
              <Box>
                <Typography sx={{ fontWeight:800, color:'#0f172a', fontSize:15, lineHeight:1.2 }}>
                  Advanced Filters
                </Typography>
                <Typography variant="caption" sx={{ color:'#94a3b8' }}>
                  Applied on top of quick search results
                </Typography>
              </Box>
            </Box>
            <IconButton size="small" onClick={() => setAdvOpen(false)} sx={{ color:'#94a3b8' }}>
              <CloseIcon fontSize="small"/>
            </IconButton>
          </Box>
        </DialogTitle>

        <Divider sx={{ borderColor:'#f1f5f9' }}/>

        <DialogContent sx={{ pt:2.5, pb:2 }}>
          <Stack spacing={2.5}>

            <Box sx={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:2 }}>
              <AdvField label="Doc No" value={advDraft.docNo} onChange={v => setAdvDraft(d => ({ ...d, docNo:v }))}/>
              <Autocomplete
                options={storesList}
                value={advDraft.store || null}
                onChange={(_, v) => setAdvDraft(d => ({ ...d, store: v ?? '' }))}
                freeSolo size="small"
                renderInput={p => (
                  <TextField {...p} label="Store"
                    sx={{ '& .MuiOutlinedInput-root':{ borderRadius:2, fontSize:13 } }}/>
                )}
              />
            </Box>

            {/* Associate — multi-select, full width */}
            <Autocomplete
              multiple
              options={employeesList}
              value={advDraft.assoc}
              onChange={(_, v) => setAdvDraft(d => ({ ...d, assoc: v }))}
              disableCloseOnSelect
              size="small"
              renderInput={p => (
                <TextField {...p} label="Associate"
                  placeholder={advDraft.assoc.length === 0 ? 'Search and select one or more…' : ''}
                  sx={{ '& .MuiOutlinedInput-root':{ borderRadius:2, fontSize:13 } }}/>
              )}
              renderTags={(value, getTagProps) =>
                value.map((opt, i) => (
                  <Chip {...getTagProps({ index: i })} key={opt} label={opt} size="small"
                    sx={{ fontSize:11, height:22, bgcolor:'#ede9fe', color:ACCENT,
                          '& .MuiChip-deleteIcon':{ color:ACCENT } }}/>
                ))
              }
            />

            {/* Customer — multi-select, full width */}
            <Autocomplete
              multiple
              options={customersList}
              value={advDraft.customer}
              onChange={(_, v) => setAdvDraft(d => ({ ...d, customer: v }))}
              disableCloseOnSelect
              size="small"
              renderInput={p => (
                <TextField {...p} label="Customer"
                  placeholder={advDraft.customer.length === 0 ? 'Search and select one or more…' : ''}
                  sx={{ '& .MuiOutlinedInput-root':{ borderRadius:2, fontSize:13 } }}/>
              )}
              renderTags={(value, getTagProps) =>
                value.map((opt, i) => (
                  <Chip {...getTagProps({ index: i })} key={opt} label={opt} size="small"
                    sx={{ fontSize:11, height:22, bgcolor:'#ede9fe', color:ACCENT,
                          '& .MuiChip-deleteIcon':{ color:ACCENT } }}/>
                ))
              }
            />

            <Box>
              <Typography variant="caption" sx={{ fontWeight:700, color:'#64748b', letterSpacing:.4, textTransform:'uppercase', mb:.75, display:'block' }}>
                Net Sales Range
              </Typography>
              <Box sx={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:2 }}>
                <AdvField label="Min amount" value={advDraft.minSales} onChange={v => setAdvDraft(d => ({ ...d, minSales:v }))} type="number"/>
                <AdvField label="Max amount" value={advDraft.maxSales} onChange={v => setAdvDraft(d => ({ ...d, maxSales:v }))} type="number"/>
              </Box>
            </Box>

            <Box>
              <Typography variant="caption" sx={{ fontWeight:700, color:'#64748b', letterSpacing:.4, textTransform:'uppercase', mb:1, display:'block' }}>
                Transaction Type
              </Typography>
              <Box sx={{ display:'flex', gap:1.5 }}>
                {(['Sale','Return','Order'] as const).map(t => {
                  const c  = TYPE_COLOR[t]
                  const on = advDraft.types.includes(t)
                  return (
                    <Box key={t} onClick={() => setAdvDraft(d => ({
                        ...d,
                        types: on ? d.types.filter(x => x!==t) : [...d.types, t],
                      }))}
                      sx={{
                        flex:1, py:1.25, borderRadius:2, cursor:'pointer', textAlign:'center',
                        border:`2px solid ${on ? c.text : '#e2e8f0'}`,
                        bgcolor: on ? c.bg : '#fff',
                        transition:'all .15s ease',
                        userSelect:'none',
                        '&:hover':{ borderColor:c.text, bgcolor:c.bg },
                      }}
                    >
                      <Typography sx={{ fontWeight:700, fontSize:13, color: on ? c.text : '#94a3b8' }}>
                        {t}
                      </Typography>
                    </Box>
                  )
                })}
              </Box>
            </Box>

          </Stack>
        </DialogContent>

        <Divider sx={{ borderColor:'#f1f5f9' }}/>

        <DialogActions sx={{ px:3, py:2, gap:1 }}>
          <Button onClick={clearAdv}
            sx={{ textTransform:'none', fontWeight:600, color:'#94a3b8', borderRadius:2,
              '&:hover':{ color:'#dc2626', bgcolor:'#fef2f2' } }}>
            Clear all
          </Button>
          <Box sx={{ flex:1 }}/>
          <Button onClick={() => setAdvOpen(false)} variant="outlined"
            sx={{ textTransform:'none', fontWeight:600, borderRadius:2, borderColor:'#e2e8f0', color:'#475569',
              '&:hover':{ borderColor:'#94a3b8' } }}>
            Cancel
          </Button>
          <Button onClick={applyAdv} variant="contained"
            sx={{ textTransform:'none', fontWeight:700, borderRadius:2, px:3,
              bgcolor:ACCENT, boxShadow:'0 2px 8px rgba(124,58,237,.35)',
              '&:hover':{ bgcolor:ACCENT2 } }}>
            Apply Filters
          </Button>
        </DialogActions>
      </Dialog>

    </Box>
  )
}

/* ── Reusable input field ───────────────────────────────────────────── */
function AdvField({ label, value, onChange, type='text' }:
  { label:string; value:string; onChange:(v:string)=>void; type?:string }) {
  return (
    <Box>
      <Typography variant="caption" sx={{ fontWeight:700, color:'#64748b', letterSpacing:.4,
        textTransform:'uppercase', mb:.75, display:'block', fontSize:10 }}>
        {label}
      </Typography>
      <TextField fullWidth size="small" type={type} value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={`Filter by ${label.toLowerCase()}…`}
        InputProps={{ endAdornment: value ? (
          <InputAdornment position="end">
            <IconButton size="small" onClick={() => onChange('')} edge="end">
              <CloseIcon sx={{ fontSize:14 }}/>
            </IconButton>
          </InputAdornment>
        ) : null }}
        sx={{ '& .MuiOutlinedInput-root':{ borderRadius:2, bgcolor:'#fff',
          '&:hover':     { boxShadow:'0 0 0 2px #ede9fe' },
          '&.Mui-focused':{ boxShadow:'0 0 0 2px #7c3aed40' } } }}
      />
    </Box>
  )
}
