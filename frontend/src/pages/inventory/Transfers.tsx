/**
 * Inventory → Transfers
 * ─────────────────────
 * Period filter + store filter
 * KPI strip: Slips · Items · Sent Qty · Received Qty · Cost Value
 * Charts: Daily Trend | Status Donut | Top Sending Stores | Top Receiving Stores
 * AG Grid tabs: By Store (Out) | By Store (In) | By Dept | Details
 */
import { useState, useRef, useMemo } from 'react'
import { useAppSettings } from '../../context/AppSettings'
import {
  Box, Paper, Typography, Chip, Autocomplete, TextField, Divider,
  IconButton, Tooltip, Dialog, DialogContent, Tab, Tabs,
} from '@mui/material'
import FullscreenIcon  from '@mui/icons-material/Fullscreen'
import DownloadIcon    from '@mui/icons-material/Download'
import CloseIcon       from '@mui/icons-material/Close'
import { useQuery }    from '@tanstack/react-query'
import axios           from 'axios'
import { AgGridReact } from 'ag-grid-react'
import type { ColDef } from 'ag-grid-community'
import 'ag-grid-community/styles/ag-grid.css'
import 'ag-grid-community/styles/ag-theme-alpine.css'
import EChart, { EChartHandle } from '../../components/EChart'
import KpiCard                  from '../../components/KpiCard'
import GridExportBar            from '../../components/GridExportBar'
import { useGridColumnState } from '../../hooks/useGridColumnState'
import { moneyPrefix } from '../../utils/formatters'

// ── Colours ────────────────────────────────────────────────────────────────
const ACCENT   = '#7c3aed'
const PENDING_C  = '#f59e0b'
const RECEIVED_C = '#10b981'
const SENT_C     = '#6366f1'

// ── Date helpers ──────────────────────────────────────────────────────────
const fmt = (d: Date) => d.toISOString().slice(0, 10)
const today = () => fmt(new Date())
const daysAgo = (n: number) => { const d = new Date(); d.setDate(d.getDate() - n + 1); return fmt(d) }
const mtdStart  = () => { const d = new Date(); d.setDate(1); return fmt(d) }
const ytdStart  = () => fmt(new Date(new Date().getFullYear(), 0, 1))

const PERIODS = [
  { label: '7D',  df: () => daysAgo(7),   dt: today },
  { label: '30D', df: () => daysAgo(30),  dt: today },
  { label: 'MTD', df: mtdStart,           dt: today },
  { label: 'YTD', df: ytdStart,           dt: today },
] as const

// ── Chart card with fullscreen ─────────────────────────────────────────────
function ChartCard({ title, children, chartRef, height = 260 }: {
  title: string
  children: React.ReactNode
  chartRef: React.RefObject<EChartHandle>
  height?: number
}) {
  const [fs, setFs] = useState(false)
  const download = () => {
    const url = chartRef.current?.getEchartsInstance()?.getDataURL({ type:'png', pixelRatio:2 })
    if (!url) return
    Object.assign(document.createElement('a'), { href:url, download:`${title}.png` }).click()
  }
  return (
    <>
      <Paper elevation={0} sx={{ borderRadius:2, border:'1px solid #e2e8f0', p:2, flex:1 }}>
        <Box sx={{ display:'flex', justifyContent:'space-between', alignItems:'center', mb:1 }}>
          <Typography sx={{ fontWeight:700, fontSize:13, color:'#334155' }}>{title}</Typography>
          <Box>
            <Tooltip title="Download PNG"><IconButton size="small" onClick={download}><DownloadIcon sx={{ fontSize:16 }} /></IconButton></Tooltip>
            <Tooltip title="Fullscreen"><IconButton size="small" onClick={() => setFs(true)}><FullscreenIcon sx={{ fontSize:16 }} /></IconButton></Tooltip>
          </Box>
        </Box>
        <Box sx={{ height }}>{children}</Box>
      </Paper>
      <Dialog open={fs} onClose={() => setFs(false)} maxWidth="lg" fullWidth>
        <DialogContent sx={{ p:2 }}>
          <Box sx={{ display:'flex', justifyContent:'space-between', mb:1 }}>
            <Typography sx={{ fontWeight:700 }}>{title}</Typography>
            <IconButton size="small" onClick={() => setFs(false)}><CloseIcon /></IconButton>
          </Box>
          <Box sx={{ height:500 }}>{children}</Box>
        </DialogContent>
      </Dialog>
    </>
  )
}

// ── Number formatting ─────────────────────────────────────────────────────
const fmtN = (v: number, dec = 0) =>
  v == null ? '—' : v.toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec })
const fmtC = (v: number) => v == null ? '—' : moneyPrefix() + v.toLocaleString('en-US', { maximumFractionDigits:0 })

// ══════════════════════════════════════════════════════════════════════════════
export default function Transfers() {
  const { productCodeField } = useAppSettings()
  const codeField  = productCodeField.toUpperCase()   // 'ALU' or 'UPC'
  const [period,   setPeriod  ] = useState(1)  // default 30D
  const [dateFrom, setDateFrom] = useState(() => daysAgo(30))
  const [dateTo,   setDateTo  ] = useState(today)
  const [selStores, setSelStores] = useState<string[]>([])
  const [tab, setTab] = useState(0)

  const gridRef     = useRef<AgGridReact>(null)
  const { onGridReady: onColGridReady, onColumnChanged } = useGridColumnState(`inv-transfers-t${tab}`)
  const trendRef    = useRef<EChartHandle>(null)
  const statusRef   = useRef<EChartHandle>(null)
  const outStoreRef = useRef<EChartHandle>(null)
  const inStoreRef  = useRef<EChartHandle>(null)

  // stores list
  const { data: storeList = [] } = useQuery<{ STORE_NAME: string }[]>({
    queryKey: ['stores'],
    queryFn:  () => axios.get('/api/stores').then(r => r.data),
    staleTime: Infinity,
  })
  const storeNames = storeList.map(s => s.STORE_NAME)
  const storesParam = selStores.length ? selStores.join(',') : undefined

  const qParams = { date_from: dateFrom, date_to: dateTo, ...(storesParam ? { stores: storesParam } : {}) }

  const { data: kpi } = useQuery({
    queryKey: ['trans-kpi', dateFrom, dateTo, storesParam],
    queryFn:  () => axios.get('/api/inventory/transfers/kpi', { params: qParams }).then(r => r.data),
    gcTime: 0, refetchOnMount: 'always',
  })

  const { data: trend = [] } = useQuery<any[]>({
    queryKey: ['trans-trend', dateFrom, dateTo, storesParam],
    queryFn:  () => axios.get('/api/inventory/transfers/trend', { params: qParams }).then(r => r.data),
    gcTime: 0, refetchOnMount: 'always',
  })

  const { data: byStoreOut = [] } = useQuery<any[]>({
    queryKey: ['trans-store-out', dateFrom, dateTo, storesParam],
    queryFn:  () => axios.get('/api/inventory/transfers/by-store', { params: { ...qParams, direction:'out', limit:12 } }).then(r => r.data),
    gcTime: 0, refetchOnMount: 'always',
  })

  const { data: byStoreIn = [] } = useQuery<any[]>({
    queryKey: ['trans-store-in', dateFrom, dateTo, storesParam],
    queryFn:  () => axios.get('/api/inventory/transfers/by-store', { params: { ...qParams, direction:'in', limit:12 } }).then(r => r.data),
    gcTime: 0, refetchOnMount: 'always',
  })

  const { data: byDept = [] } = useQuery<any[]>({
    queryKey: ['trans-dept', dateFrom, dateTo, storesParam],
    queryFn:  () => axios.get('/api/inventory/transfers/by-dept', { params: qParams }).then(r => r.data),
    gcTime: 0, refetchOnMount: 'always',
  })

  const { data: details = [] } = useQuery<any[]>({
    queryKey: ['trans-details', dateFrom, dateTo, storesParam],
    queryFn:  () => axios.get('/api/inventory/transfers/details', { params: qParams }).then(r => r.data),
    gcTime: 0, refetchOnMount: 'always',
  })

  // ── Period chip handler ──────────────────────────────────────────────────
  const selectPeriod = (i: number) => {
    setPeriod(i)
    setDateFrom(PERIODS[i].df())
    setDateTo(PERIODS[i].dt())
  }

  // ── Charts ───────────────────────────────────────────────────────────────
  const trendOption = useMemo(() => ({
    tooltip: { trigger:'axis' },
    legend:  { bottom:0, textStyle:{ fontSize:11 } },
    grid:    { top:10, right:12, bottom:36, left:52 },
    xAxis:   { type:'category', data: trend.map(r => r.slip_date?.toString().slice(0,10) || ''), axisLabel:{ fontSize:10 } },
    yAxis:   { type:'value', axisLabel:{ fontSize:10 } },
    series: [
      { name:'Sent Qty',  type:'bar',  data: trend.map(r => r.sent_qty),  itemStyle:{ color:SENT_C }, barMaxWidth:18 },
      { name:'Recv Qty',  type:'line', data: trend.map(r => r.recv_qty),  lineStyle:{ color:RECEIVED_C, width:2 }, symbol:'circle', symbolSize:4, itemStyle:{ color:RECEIVED_C } },
    ],
  }), [trend])

  const statusOption = useMemo(() => {
    const pending  = kpi?.pending_slips  || 0
    const received = kpi?.received_slips || 0
    const other    = Math.max(0, (kpi?.total_slips || 0) - pending - received)
    return {
      tooltip: { trigger:'item', formatter:'{b}: {c} ({d}%)' },
      legend:  { bottom:0, textStyle:{ fontSize:11 } },
      series: [{
        type:'pie', radius:['44%','70%'], center:['50%','45%'],
        label:{ show:false },
        data:[
          { name:'Received',  value:received, itemStyle:{ color:RECEIVED_C } },
          { name:'Pending',   value:pending,  itemStyle:{ color:PENDING_C  } },
          { name:'Other',     value:other,    itemStyle:{ color:'#cbd5e1'  } },
        ],
      }],
    }
  }, [kpi])

  const makeStoreBarOption = (data: any[]) => ({
    tooltip: { trigger:'axis', axisPointer:{ type:'shadow' } },
    grid:    { top:6, right:16, bottom:4, left:4, containLabel:true },
    xAxis:   { type:'value', axisLabel:{ fontSize:10 } },
    yAxis:   { type:'category', data: data.map(r => r.store_name || '(Unknown)').slice(0,10).reverse(), axisLabel:{ fontSize:10, width:110, overflow:'truncate' } },
    series:  [{ type:'bar', data: data.slice(0,10).map(r => r.total_cost).reverse(), itemStyle:{ color:SENT_C, borderRadius:[0,3,3,0] }, barMaxWidth:20,
                label:{ show:true, position:'right', formatter:(p:any) => fmtC(p.value), fontSize:10 } }],
  })

  const outStoreOption = useMemo(() => makeStoreBarOption(byStoreOut), [byStoreOut])
  const inStoreOption  = useMemo(() => makeStoreBarOption(byStoreIn),  [byStoreIn])

  // ── AG Grid columns ──────────────────────────────────────────────────────
  const outStoreCols: ColDef[] = useMemo(() => [
    { field:'store_name', headerName:'Store',       flex:1.5, minWidth:130 },
    { field:'slip_count', headerName:'# Slips',     flex:1,   minWidth:80,  type:'numericColumn' },
    { field:'sent_qty',   headerName:'Sent Qty',    flex:1,   minWidth:90,  type:'numericColumn', valueFormatter:p => fmtN(p.value) },
    { field:'recv_qty',   headerName:'Recv Qty',    flex:1,   minWidth:90,  type:'numericColumn', valueFormatter:p => fmtN(p.value) },
    { field:'total_cost', headerName:'Cost Value',  flex:1,   minWidth:110, type:'numericColumn', valueFormatter:p => fmtC(p.value) },
  ], [])

  const deptCols: ColDef[] = useMemo(() => [
    { field:'department', headerName:'Department',  flex:1.5, minWidth:130 },
    { field:'slip_count', headerName:'# Slips',     flex:1,   minWidth:80,  type:'numericColumn' },
    { field:'sent_qty',   headerName:'Sent Qty',    flex:1,   minWidth:90,  type:'numericColumn', valueFormatter:p => fmtN(p.value) },
    { field:'recv_qty',   headerName:'Recv Qty',    flex:1,   minWidth:90,  type:'numericColumn', valueFormatter:p => fmtN(p.value) },
    { field:'total_cost', headerName:'Cost Value',  flex:1,   minWidth:110, type:'numericColumn', valueFormatter:p => fmtC(p.value) },
  ], [])

  const detailCols: ColDef[] = useMemo(() => [
    { field:'slip_date',   headerName:'Date',        width:100, sortable:true },
    { field:'slip_no',     headerName:'Transfer #',  width:110 },
    { field:'from_store',  headerName:'From Store',  flex:1, minWidth:120 },
    { field:'to_store',    headerName:'To Store',    flex:1, minWidth:120 },
    { field:'vou_no',      headerName:'Voucher #',   width:110 },
    { field:'status',      headerName:'Status',      width:100,
      cellStyle:(p:any) => ({
        color: p.value === 'Received' ? '#10b981' : p.value === 'Pending' ? '#f59e0b' : '#64748b',
        fontWeight:600,
      })
    },
    { field:codeField,     headerName:codeField,     width:100 },
    { field:'DESCRIPTION1',headerName:'Description', flex:1.5, minWidth:140 },
    { field:'department',  headerName:'Dept',        width:100 },
    { field:'vendor',      headerName:'Item Vendor', flex:1, minWidth:110,
      headerTooltip:'Vendor from the item master (catalog) — not necessarily the supplier purchased from' },
    { field:'sent_qty',    headerName:'Sent',        width:80,  type:'numericColumn', valueFormatter:p => fmtN(p.value) },
    { field:'recv_qty',    headerName:'Recv',        width:80,  type:'numericColumn', valueFormatter:p => fmtN(p.value) },
    { field:'unit_cost',   headerName:'Unit Cost',   width:95,  type:'numericColumn', valueFormatter:(p:any) => fmtN(p.value, 2) },
    { field:'total_cost',  headerName:'Total Cost',  width:110, type:'numericColumn', valueFormatter:(p:any) => fmtC(p.value) },
  ], [codeField])

  // ── Tab grid data ─────────────────────────────────────────────────────────
  const tabData   = [byStoreOut, byStoreIn, byDept, details]
  const tabCols   = [outStoreCols, outStoreCols, deptCols, detailCols]

  return (
    <Box sx={{ pt:0, px:3, pb:3, display:'flex', flexDirection:'column', gap:2.5, minHeight:'100%' }}>

      {/* ── Header (standard page pattern — matches Stock Movement) ── */}
      <Box sx={{ position:'sticky', top:0, zIndex:10, bgcolor:'#ffffff',
                 mx:-3, px:3, pt:3, pb:2, borderBottom:'1px solid #e9e4ff' }}>
        <Typography variant="h6" sx={{ fontWeight:800, color:'#0f172a', letterSpacing:'-0.3px', mb:0.3 }}>
          Transfers
        </Typography>
        <Typography sx={{ fontSize:12, color:'#64748b', mb:1.5 }}>
          {dateFrom} — {dateTo}
        </Typography>
        <Box sx={{ display:'flex', gap:1, flexWrap:'wrap', alignItems:'center' }}>
          {PERIODS.map((p, i) => (
            <Chip key={p.label} label={p.label} size="small" onClick={() => selectPeriod(i)}
              sx={{ fontWeight:700, cursor:'pointer',
                    bgcolor: period===i ? ACCENT : 'transparent',
                    color:   period===i ? '#fff' : '#64748b',
                    border: `1px solid ${period===i ? ACCENT : '#e2e8f0'}` }} />
          ))}
          <TextField type="date" size="small" value={dateFrom}
            onChange={e => { setDateFrom(e.target.value); setPeriod(-1) }}
            sx={{ width:130 }} />
          <Typography sx={{ color:'#64748b' }}>→</Typography>
          <TextField type="date" size="small" value={dateTo}
            onChange={e => { setDateTo(e.target.value); setPeriod(-1) }}
            sx={{ width:130 }} />
          <Autocomplete
            multiple disableCloseOnSelect size="small"
            options={storeNames} value={selStores}
            onChange={(_, v) => setSelStores(v)}
            renderInput={p => <TextField {...p} placeholder="All Stores" size="small" sx={{ minWidth:200 }} />}
            sx={{ minWidth:200 }}
          />
        </Box>
      </Box>

      {/* ── KPI strip ── */}
      <Box sx={{ display:'flex', gap:1.5, flexWrap:'wrap' }}>
        <KpiCard label="Total Transfers"  value={fmtN(kpi?.total_slips  || 0)} sub={`${fmtN(kpi?.total_lines || 0)} lines`} icon="ti-transfer" />
        <KpiCard label="Sent Qty"         value={fmtN(kpi?.total_sent_qty || 0)} sub="units shipped out" icon="ti-send" />
        <KpiCard label="Received Qty"     value={fmtN(kpi?.total_recv_qty || 0)} sub="units received in" icon="ti-inbox" />
        <KpiCard label="Cost Value"       value={fmtC(kpi?.total_cost  || 0)} sub="value of goods moved" color={ACCENT} icon="ti-coin" />
        <KpiCard label="Received"         value={fmtN(kpi?.received_slips || 0)}
          sub={`${kpi?.recv_pct ?? 0}% of total`} color={RECEIVED_C} icon="ti-circle-check" />
        <KpiCard label="Pending"          value={fmtN(kpi?.pending_slips  || 0)} sub="awaiting receipt" color={PENDING_C} icon="ti-clock" />
      </Box>

      {/* ── Charts row 1 ── */}
      <Box sx={{ display:'flex', gap:2, flexWrap:'wrap' }}>
        <Box sx={{ flex:2, minWidth:320 }}>
          <ChartCard title="Daily Transfer Trend" chartRef={trendRef} height={240}>
            <EChart ref={trendRef} option={trendOption} style={{ height:'100%' }} />
          </ChartCard>
        </Box>
        <Box sx={{ flex:1, minWidth:220 }}>
          <ChartCard title="Status Breakdown" chartRef={statusRef} height={240}>
            <EChart ref={statusRef} option={statusOption} style={{ height:'100%' }} />
          </ChartCard>
        </Box>
      </Box>

      {/* ── Charts row 2 ── */}
      <Box sx={{ display:'flex', gap:2, flexWrap:'wrap' }}>
        <Box sx={{ flex:1, minWidth:260 }}>
          <ChartCard title="Top Sending Stores (Cost)" chartRef={outStoreRef} height={260}>
            <EChart ref={outStoreRef} option={outStoreOption} style={{ height:'100%' }} />
          </ChartCard>
        </Box>
        <Box sx={{ flex:1, minWidth:260 }}>
          <ChartCard title="Top Receiving Stores (Cost)" chartRef={inStoreRef} height={260}>
            <EChart ref={inStoreRef} option={inStoreOption} style={{ height:'100%' }} />
          </ChartCard>
        </Box>
      </Box>

      {/* ── AG Grid ── */}
      <Paper elevation={0} sx={{ borderRadius:2, border:'1px solid #e2e8f0', overflow:'hidden', flex:1, minHeight:340 }}>
        <Box sx={{ display:'flex', justifyContent:'flex-end', px:1.5, pt:1 }}>
          <GridExportBar gridRef={gridRef} filename="transfers" title="Transfers" />
        </Box>
        <Tabs value={tab} onChange={(_, v) => setTab(v)}
          sx={{ borderBottom:'1px solid #e2e8f0', minHeight:40,
                '& .MuiTab-root':{ fontSize:12, fontWeight:600, minHeight:40, textTransform:'none' } }}>
          <Tab label="By Sending Store" />
          <Tab label="By Receiving Store" />
          <Tab label="By Department" />
          <Tab label="Details" />
        </Tabs>
        <Box className="ag-theme-alpine" sx={{ height:360 }}>
          <AgGridReact
            key={`tab-${tab}`}
            ref={gridRef}
            onGridReady={onColGridReady}
            onColumnMoved={onColumnChanged}
            onColumnResized={onColumnChanged}
            onColumnVisible={onColumnChanged}
            onColumnPinned={onColumnChanged}
            rowData={tabData[tab]}
            columnDefs={tabCols[tab]}
            defaultColDef={{ resizable:true, sortable:true, filter:true }}
            pagination paginationPageSize={100}
          />
        </Box>
      </Paper>

    </Box>
  )
}
