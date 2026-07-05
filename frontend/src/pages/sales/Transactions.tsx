/**
 * Transactions - AG Grid  *  server-side search  *  Excel / PDF export above grid
 *                          *  custom column show/hide picker
 */
import { useState, useRef, useCallback, useMemo } from 'react'
import { tr, trf, trCols } from '../../i18n'
import {
  Box, Typography, Chip, TextField, LinearProgress,
  Button, CircularProgress, Stack,
  InputAdornment, IconButton,
  Popover, FormControlLabel, Checkbox, Divider,
} from '@mui/material'
import SearchIcon        from '@mui/icons-material/Search'
import CloseIcon         from '@mui/icons-material/Close'
import FileDownloadIcon  from '@mui/icons-material/FileDownload'
import PictureAsPdfIcon  from '@mui/icons-material/PictureAsPdf'
import ViewColumnIcon    from '@mui/icons-material/ViewColumn'
import { AgGridReact }   from 'ag-grid-react'
import { ColDef, GridReadyEvent } from 'ag-grid-community'
import 'ag-grid-community/styles/ag-grid.css'
import 'ag-grid-community/styles/ag-theme-alpine.css'
import { useQuery }      from '@tanstack/react-query'
import axios             from 'axios'
import { noRowsOverlay } from '../../utils/gridOverlay'
import { useGridColumnState } from '../../hooks/useGridColumnState'
import TitleLoader from '../../components/TitleLoader'
import { format, subDays, startOfMonth } from 'date-fns'
import { num }           from '../../utils/formatters'
import * as XLSX         from 'xlsx'
import jsPDF             from 'jspdf'
import autoTable         from 'jspdf-autotable'
import { isArabic, hasArabic, registerArabicFont, shapeAr, ARABIC_FONT_NAME } from '../../utils/pdfArabic'
import { arabicTableToPdf } from '../../utils/pdfImage'

/* -- Theme ------------------------------------------------------------ */
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

/* -- Column definitions ----------------------------------------------- */
const numFmt = (p: any) => num(p.value ?? 0)

const COL_DEFS: ColDef[] = [
  {
    headerName: '#', colId: '_seq', width: 60, pinned: 'left',
    sortable: false, resizable: false, suppressMovable: true,
    valueGetter: (p: any) => p.node?.rowPinned ? '' : (p.node?.rowIndex ?? 0) + 1,
    cellStyle: { color:'#94a3b8', fontSize:11, fontWeight:500, display:'flex', alignItems:'center' },
  },
  { field:'doc_no',        headerName:'Doc No',      width:130, pinned:'left',
    cellStyle:(p:any) => p.node?.rowPinned
      ? { fontWeight:800, color:ACCENT, display:'flex', alignItems:'center' }
      : { fontWeight:600, color:'#1e293b', display:'flex', alignItems:'center' } },
  { field:'post_date',     headerName:'Date',         width:170 },
  { field:'store_name',    headerName:'Store',        width:170 },
  { field:'employee_name', headerName:'Associate',    width:155 },
  { field:'customer_name', headerName:'Customer',     width:155 },
  {
    field:'type', headerName:'Type', width:95,
    cellRenderer:(p:any) => {
      if (p.node?.rowPinned || !p.value) return ''
      const c = TYPE_COLOR[p.value] ?? { text:'#64748b', bg:'#f1f5f9' }
      return <span style={{ display:'inline-block', padding:'2px 10px', borderRadius:'99px', background:c.bg, color:c.text, fontWeight:700, fontSize:11 }}>{p.value ?? ''}</span>
    },
  },
  { field:'net_sales',    headerName:'Net Sales',   width:120, type:'numericColumn', valueFormatter:numFmt },
  { field:'total_tax',    headerName:'Tax',          width:100, type:'numericColumn', valueFormatter:numFmt },
  { field:'total_wtax',   headerName:'Total W/Tax', width:125, type:'numericColumn', valueFormatter:numFmt },
  { field:'invoice_disc', headerName:'Discount',    width:110, type:'numericColumn', valueFormatter:numFmt },
  { field:'cash',         headerName:'Cash',         width:100, type:'numericColumn', valueFormatter:numFmt },
  { field:'card',         headerName:'Card',         width:100, type:'numericColumn', valueFormatter:numFmt },
  { field:'deposit',      headerName:'Deposit',      width:100, type:'numericColumn', valueFormatter:numFmt },
  { field:'other',        headerName:'Other',        width:90,  type:'numericColumn', valueFormatter:numFmt },
]

// Toggleable columns - exclude # row-number column
const TOGGLE_COLS = COL_DEFS.filter(c => c.headerName !== '#')

const DEFAULT_COL: ColDef = {
  sortable: true, resizable: true, filter: true, suppressMovable: false,
  wrapHeaderText: true, autoHeaderHeight: true,
  cellStyle: { display:'flex', alignItems:'center' },
}

/* -- Component -------------------------------------------------------- */
export default function Transactions() {
  const [days,      setDays     ] = useState(7)
  const [search,    setSearch   ] = useState('')
  const [exporting, setExporting] = useState<'excel'|'pdf'|null>(null)
  // Custom date range (overrides the quick presets when set)
  const [custom,     setCustom    ] = useState<{ from:string; to:string } | null>(null)
  const [draftFrom,  setDraftFrom ] = useState('')
  const [draftTo,    setDraftTo   ] = useState('')

  // Column visibility state - all visible by default
  const [hiddenCols, setHiddenCols] = useState<Set<string>>(new Set())
  const [colAnchor,  setColAnchor ] = useState<HTMLElement | null>(null)

  const gridRef   = useRef<AgGridReact>(null)
  const gridApi   = useRef<any>(null)
  const colState  = useGridColumnState('sales-transactions')

  const today  = format(new Date(), 'yyyy-MM-dd')
  const presetFrom = days === -1
    ? format(startOfMonth(new Date()), 'yyyy-MM-dd')
    : format(subDays(new Date(), days - 1), 'yyyy-MM-dd')
  const from = custom?.from ?? presetFrom
  const to   = custom?.to   ?? today

  /* -- Data fetch ----------------------------------------------- */
  const { data, isLoading, isFetching } = useQuery({
    queryKey: ['transactions', from, to, search],
    queryFn:  () => axios
      .get(`/api/sales/transactions?date_from=${from}&date_to=${to}&search=${encodeURIComponent(search)}&limit=0&offset=0`)
      .then(r => r.data),
    placeholderData: (prev: any) => prev,
  })

  const rows: any[]   = useMemo(() => data?.rows ?? [], [data])
  const total: number = data?.total ?? 0

  /* -- Totals row (summable measures only) ----------------------- */
  const totalsRow = useMemo(() => {
    if (!rows.length) return []
    const sum = (f: string) => rows.reduce((a, r) => a + (+r[f] || 0), 0)
    return [{
      doc_no: 'TOTAL',
      net_sales:    sum('net_sales'),
      total_tax:    sum('total_tax'),
      total_wtax:   sum('total_wtax'),
      invoice_disc: sum('invoice_disc'),
      cash:         sum('cash'),
      card:         sum('card'),
      deposit:      sum('deposit'),
      other:        sum('other'),
    }]
  }, [rows])

  const onGridReady = useCallback((e: GridReadyEvent) => {
    colState.onGridReady(e)
    gridApi.current = e.api
    // No sizeColumnsToFit: it squeezes all 14 columns below their text width so
    // headers like "Deposit"/"Other" break mid-word. Keep the defined widths
    // (horizontal scroll when needed) — consistent with the other data grids.
  }, [])

  /* -- Column toggle -------------------------------------------- */
  const toggleCol = (field: string, visible: boolean) => {
    gridApi.current?.setColumnVisible(field, visible)
    setHiddenCols(prev => {
      const next = new Set(prev)
      visible ? next.delete(field) : next.add(field)
      return next
    })
  }

  const showAll = () => {
    TOGGLE_COLS.forEach(c => {
      const id = c.field ?? c.colId ?? ''
      gridApi.current?.setColumnVisible(id, true)
    })
    setHiddenCols(new Set())
  }

  /* -- Export helpers ------------------------------------------- */
  const getVisibleRows = (): any[] => {
    const api = gridRef.current?.api
    if (!api) return rows
    const out: any[] = []
    api.forEachNodeAfterFilterAndSort((n: any) => { if (n.data) out.push(n.data) })
    return out
  }

  const EXPORT_COLS = TOGGLE_COLS.map(c => ({
    key:   (c.field ?? '') as string,
    label: (c.headerName ?? '') as string,
  }))

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
      XLSX.writeFile(wb, `transactions_${from}_${to}.xlsx`)
    } finally { setExporting(null) }
  }

  const exportPDF = async () => {
    setExporting('pdf')
    try {
      const vis = getVisibleRows()
      const ar  = isArabic()
      const doc = new jsPDF({ orientation:'landscape', unit:'pt', format:'a3' })

      /* Use the browser (html2canvas) image path whenever the UI is Arabic OR
         the export CONTENT contains any Arabic (customer / vendor names are
         Arabic regardless of UI language). jsPDF cannot shape Arabic, so the
         autoTable path garbles those names. Pure-Latin/numeric exports keep the
         selectable-text autoTable path below. */
      const headLabels = EXPORT_COLS.map(c => tr(c.label))
      const bodyRows   = vis.map((r:any) => EXPORT_COLS.map(c => r[c.key] ?? ''))
      const needImage  = ar || hasArabic([...headLabels, ...bodyRows.flat()])

      if (needImage) {
        const periodLine = `Period: ${from}  ->  ${today}     Records: ${vis.length.toLocaleString()}`
        await arabicTableToPdf(doc, {
          title:    tr('Transactions Report'),
          subtitle: periodLine,
          head:     headLabels,
          body:     bodyRows,
          filename: `transactions_${from}_${to}.pdf`,
          rtl:      ar,   // RTL table only in Arabic UI; LTR keeps English column order
        })
        return
      }

      if (ar) registerArabicFont(doc)
      doc.setFontSize(14); doc.setTextColor(15,23,42)
      if (ar) doc.setFont(ARABIC_FONT_NAME, 'normal')
      doc.text(ar ? shapeAr(tr('Transactions Report')) : 'Transactions Report', 30, 38)
      doc.setFontSize(9); doc.setTextColor(100,116,139)
      const periodLine = `Period: ${from}  ->  ${today}     Records: ${vis.length.toLocaleString()}`
      doc.text(ar ? shapeAr(periodLine) : periodLine, 30, 54)
      // In Arabic, translate the (English) headerName labels the same way the
      // grid does, then let didParseCell reshape them.
      const head = ar ? EXPORT_COLS.map(c => tr(c.label)) : EXPORT_COLS.map(c => c.label)
      autoTable(doc, {
        head: [head],
        body: vis.map((r:any) => EXPORT_COLS.map(c => r[c.key] ?? '')),
        startY: 66,
        styles:            { fontSize:6.5, cellPadding:3, overflow:'ellipsis',
          ...(ar ? { font: ARABIC_FONT_NAME, halign: 'right' as const } : {}) },
        headStyles:        { fillColor:[124,58,237], textColor:255, fontStyle:'bold', fontSize:7,
          ...(ar ? { font: ARABIC_FONT_NAME, halign: 'right' as const } : {}) },
        alternateRowStyles:{ fillColor:[250,249,255] },
        ...(ar ? {
          didParseCell: (data: any) => {
            if (Array.isArray(data.cell.text)) {
              data.cell.text = data.cell.text.map((line: string) => shapeAr(line))
            }
          },
        } : {}),
      })
      doc.save(`transactions_${from}_${to}.pdf`)
    } finally { setExporting(null) }
  }

  const busy = isLoading || isFetching

  /* -- Render --------------------------------------------------- */
  return (
    <Box sx={{ display:'flex', flexDirection:'column', height:'100%', bgcolor:SURFACE, pt:0, px:2.5, pb:2.5, gap:1.5 }}>

      {/* == Toolbar == */}
      <Box sx={{ position:'sticky', top:0, zIndex:10, bgcolor:SURFACE,
                 mx:-2.5, px:2.5, pt:2.5, pb:1.5, borderBottom:'1px solid #e9e4ff',
                 display:'flex', alignItems:'center', gap:1.5, flexWrap:'wrap' }}>
        <Typography variant="h6" sx={{ fontWeight:800, color:'#0f172a', letterSpacing:'-0.3px', mr:'auto' }}>
          {tr('Transactions')}
          <TitleLoader />
        </Typography>

        {/* Period selector */}
        <Box sx={{ display:'flex', gap:0.75, p:0.5, bgcolor:'#f1f5f9', borderRadius:2 }}>
          {QUICK.map(q => (
            <Chip key={q.label} label={tr(q.label)} size="small"
              onClick={() => { setCustom(null); setDays(q.days) }}
              sx={{
                fontWeight:700, fontSize:12, height:28, px:0.5,
                transition:'all .18s ease',
                bgcolor: !custom && days===q.days ? ACCENT : 'transparent',
                color:   !custom && days===q.days ? '#fff' : '#64748b',
                boxShadow: !custom && days===q.days ? '0 2px 8px rgba(124,58,237,.35)' : 'none',
                '&:hover':{ bgcolor: !custom && days===q.days ? ACCENT2 : '#e2e8f0' },
              }}
            />
          ))}
        </Box>

        {/* Custom date range */}
        <Box sx={{ display:'flex', alignItems:'center', gap:1 }}>
          <TextField label={tr('From')} type="date" size="small" sx={{ width:150, bgcolor:'#fff', borderRadius:2 }}
            InputLabelProps={{ shrink:true }}
            value={draftFrom} onChange={e => setDraftFrom(e.target.value)} />
          <TextField label={tr('To')} type="date" size="small" sx={{ width:150, bgcolor:'#fff', borderRadius:2 }}
            InputLabelProps={{ shrink:true }}
            value={draftTo} onChange={e => setDraftTo(e.target.value)} />
          <Button size="small" variant={custom ? 'contained' : 'outlined'}
            disabled={!draftFrom || !draftTo || draftFrom > draftTo}
            onClick={() => setCustom({ from:draftFrom, to:draftTo })}
            sx={{ textTransform:'none', fontWeight:700, borderRadius:2, height:34,
                  ...(custom
                    ? { bgcolor:ACCENT, '&:hover':{ bgcolor:ACCENT2 } }
                    : { borderColor:ACCENT, color:ACCENT }) }}>
            {tr('Apply')}
          </Button>
        </Box>

        {/* Quick search */}
        <TextField size="small" placeholder={tr('Quick search...')} value={search}
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
      </Box>

      {/* == Status bar == */}
      <Box sx={{ display:'flex', alignItems:'center', gap:1.5, minHeight:20 }}>
        <Typography variant="caption" sx={{ color:'#64748b', fontWeight:500 }}>
          {busy ? tr('Loading...') : trf('{{n}} transactions  ·  {{from}}  →  {{to}}', { n: total.toLocaleString(), from, to: today })}
        </Typography>
        {busy && (
          <LinearProgress sx={{ flex:1, height:3, borderRadius:2, bgcolor:'#ede9fe',
            '& .MuiLinearProgress-bar':{ bgcolor:ACCENT, borderRadius:2 } }}/>
        )}
      </Box>

      {/* == Action bar - above the grid (right-aligned like the other tables) == */}
      <Stack direction="row" spacing={1} alignItems="center" justifyContent="flex-end">

        {/* Columns toggle */}
        <Button size="small" variant="outlined"
          onClick={e => setColAnchor(e.currentTarget)}
          startIcon={<ViewColumnIcon sx={{ fontSize:'17px !important' }}/>}
          sx={{ textTransform:'none', borderRadius:2.5, fontWeight:600, height:34,
               borderColor: hiddenCols.size > 0 ? ACCENT : '#e2e8f0',
               color:       hiddenCols.size > 0 ? ACCENT : '#475569',
               bgcolor:     hiddenCols.size > 0 ? '#ede9fe' : 'transparent',
               '&:hover':{ borderColor:ACCENT, color:ACCENT, bgcolor:'#ede9fe' } }}
        >
          {tr('Columns')}{hiddenCols.size > 0 ? ` (${hiddenCols.size} ${tr('hidden')})` : ''}
        </Button>

        {/* Export */}
        <Button size="small" variant="outlined" disabled={!!exporting || rows.length === 0}
          onClick={exportExcel}
          startIcon={exporting==='excel'
            ? <CircularProgress size={13} sx={{ color:ACCENT }}/>
            : <FileDownloadIcon sx={{ fontSize:'17px !important' }}/>}
          sx={{ textTransform:'none', borderRadius:2.5, fontWeight:600, height:34,
               borderColor:'#e2e8f0', color:'#16a34a',
               '&:hover':{ borderColor:'#16a34a', bgcolor:'#f0fdf4' } }}
        >{tr('Excel')}</Button>

        <Button size="small" variant="outlined" disabled={!!exporting || rows.length === 0}
          onClick={exportPDF}
          startIcon={exporting==='pdf'
            ? <CircularProgress size={13} sx={{ color:ACCENT }}/>
            : <PictureAsPdfIcon sx={{ fontSize:'17px !important' }}/>}
          sx={{ textTransform:'none', borderRadius:2.5, fontWeight:600, height:34,
               borderColor:'#e2e8f0', color:'#dc2626',
               '&:hover':{ borderColor:'#dc2626', bgcolor:'#fff5f5' } }}
        >{tr('PDF')}</Button>
      </Stack>

      {/* == Column picker popover == */}
      <Popover
        open={Boolean(colAnchor)}
        anchorEl={colAnchor}
        onClose={() => setColAnchor(null)}
        anchorOrigin={{ vertical:'bottom', horizontal:'left' }}
        transformOrigin={{ vertical:'top', horizontal:'left' }}
        PaperProps={{ sx:{ borderRadius:2, border:'1px solid #e9e4ff', boxShadow:'0 8px 24px rgba(15,23,42,.12)', minWidth:200 } }}
      >
        <Box sx={{ px:2, pt:1.5, pb:0.5, display:'flex', alignItems:'center', justifyContent:'space-between' }}>
          <Typography sx={{ fontWeight:700, fontSize:12, color:'#374151' }}>{tr('Show / Hide Columns')}</Typography>
          <Button size="small" onClick={showAll}
            sx={{ fontSize:10, textTransform:'none', color:ACCENT, fontWeight:600, minWidth:0, px:1, py:0 }}>
            {tr('Show all')}
          </Button>
        </Box>
        <Divider sx={{ borderColor:'#f1f5f9', my:0.5 }} />
        <Box sx={{ px:1.5, pb:1.5, maxHeight:320, overflowY:'auto' }}>
          {TOGGLE_COLS.map(col => {
            const id      = (col.field ?? col.colId ?? '') as string
            const visible = !hiddenCols.has(id)
            return (
              <FormControlLabel key={id} control={
                <Checkbox size="small" checked={visible}
                  onChange={e => toggleCol(id, e.target.checked)}
                  sx={{ color:'#cbd5e1', '&.Mui-checked':{ color:ACCENT }, py:0.5 }}
                />
              }
              label={<Typography sx={{ fontSize:12, color:'#374151' }}>{tr(col.headerName as string)}</Typography>}
              sx={{ display:'flex', m:0, py:0.25 }}
              />
            )
          })}
        </Box>
      </Popover>

      {/* == AG Grid == */}
      <Box className="ag-theme-alpine" sx={{
        flex:1, width:'100%', minHeight:0,
        '& .ag-header':{ bgcolor:'#f8f7ff !important', borderBottom:'1px solid #e9e4ff' },
        '& .ag-header-cell-text':{ fontWeight:700, color:'#374151', fontSize:12 },
        '& .ag-row-even':{ bgcolor:'#ffffff' },
        '& .ag-row-odd': { bgcolor:'#faf9ff' },
        '& .ag-row:hover':{ bgcolor:'#f3f0ff !important' },
        '& .ag-paging-panel':{ borderTop:'1px solid #e9e4ff', color:'#475569' },
      }}>
        <AgGridReact
          ref={gridRef}
          overlayNoRowsTemplate={noRowsOverlay()}
          onColumnMoved={colState.onColumnChanged}
          onColumnResized={colState.onColumnChanged}
          onColumnVisible={colState.onColumnChanged}
          onColumnPinned={colState.onColumnChanged}
          rowData={rows}
          pinnedBottomRowData={totalsRow}
          columnDefs={trCols(COL_DEFS as any[])}
          defaultColDef={DEFAULT_COL}
          onGridReady={onGridReady}
          pagination={true}
          paginationPageSize={100}
          paginationPageSizeSelector={[50,100,200,500]}
          animateRows={true}
          rowHeight={38}
          headerHeight={42}
          suppressCellFocus={true}
        />
      </Box>
    </Box>
  )
}
