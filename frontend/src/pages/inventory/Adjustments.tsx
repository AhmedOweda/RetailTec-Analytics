/**
 * Inventory → Adjustments
 * ─────────────────────────
 * Period filter + store filter
 * KPI strip: Adjustments · Items · Net Qty · Positive Impact · Negative Impact
 * Charts: Daily Trend | By Type | By Store
 * AG Grid tabs: By Type | By Store | Details
 */
import { useState, useRef, useMemo } from 'react'
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

// ── Colours ────────────────────────────────────────────────────────────────
const ACCENT   = '#7c3aed'
const POS_C    = '#10b981'
const NEG_C    = '#ef4444'
const NEUTRAL_C = '#6366f1'

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

// ── KPI card ──────────────────────────────────────────────────────────────
function KpiCard({ label, value, sub, color }: {
  label: string; value: string; sub?: string; color?: string
}) {
  return (
    <Paper elevation={0} sx={{
      flex:1, p:2, borderRadius:2, border:'1px solid #e2e8f0', minWidth:130,
    }}>
      <Typography sx={{ fontSize:11, color:'#94a3b8', fontWeight:600,
                        textTransform:'uppercase', letterSpacing:.6, mb:.5 }}>
        {label}
      </Typography>
      <Typography sx={{ fontSize:22, fontWeight:800, color: color || '#0f172a', lineHeight:1.1 }}>
        {value}
      </Typography>
      {sub && <Typography sx={{ fontSize:11, color:'#64748b', mt:.3 }}>{sub}</Typography>}
    </Paper>
  )
}

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
const fmtC = (v: number) => v == null ? '—' : v.toLocaleString('en-US', { style:'currency', currency:'USD', maximumFractionDigits:0 })
const fmtSign = (v: number) => v > 0 ? `+${fmtN(v)}` : fmtN(v)

// ── Cost cell style ────────────────────────────────────────────────────────
const costStyle = (p: any) => ({
  color: p.value > 0 ? POS_C : p.value < 0 ? NEG_C : '#64748b',
  fontWeight: 600,
})

// ══════════════════════════════════════════════════════════════════════════════
export default function Adjustments() {
  const [period,   setPeriod  ] = useState(1)  // default 30D
  const [dateFrom, setDateFrom] = useState(() => daysAgo(30))
  const [dateTo,   setDateTo  ] = useState(today)
  const [selStores, setSelStores] = useState<string[]>([])
  const [tab, setTab] = useState(0)

  const trendRef = useRef<EChartHandle>(null)
  const typeRef  = useRef<EChartHandle>(null)
  const storeRef = useRef<EChartHandle>(null)

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
    queryKey: ['adj-kpi', dateFrom, dateTo, storesParam],
    queryFn:  () => axios.get('/api/inventory/adjustments/kpi', { params: qParams }).then(r => r.data),
    gcTime: 0, refetchOnMount: 'always',
  })

  const { data: trend = [] } = useQuery<any[]>({
    queryKey: ['adj-trend', dateFrom, dateTo, storesParam],
    queryFn:  () => axios.get('/api/inventory/adjustments/trend', { params: qParams }).then(r => r.data),
    gcTime: 0, refetchOnMount: 'always',
  })

  const { data: byType = [] } = useQuery<any[]>({
    queryKey: ['adj-type', dateFrom, dateTo, storesParam],
    queryFn:  () => axios.get('/api/inventory/adjustments/by-type', { params: qParams }).then(r => r.data),
    gcTime: 0, refetchOnMount: 'always',
  })

  const { data: byStore = [] } = useQuery<any[]>({
    queryKey: ['adj-store', dateFrom, dateTo, storesParam],
    queryFn:  () => axios.get('/api/inventory/adjustments/by-store', { params: { ...qParams, limit:12 } }).then(r => r.data),
    gcTime: 0, refetchOnMount: 'always',
  })

  const { data: details = [] } = useQuery<any[]>({
    queryKey: ['adj-details', dateFrom, dateTo, storesParam],
    queryFn:  () => axios.get('/api/inventory/adjustments/details', { params: { ...qParams, limit:1000 } }).then(r => r.data),
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
    tooltip: { trigger:'axis', axisPointer:{ type:'cross' } },
    legend:  { bottom:0, textStyle:{ fontSize:11 } },
    grid:    { top:10, right:12, bottom:36, left:52 },
    xAxis:   { type:'category', data: trend.map(r => r.ADJ_DATE?.toString().slice(0,10) || ''), axisLabel:{ fontSize:10 } },
    yAxis:   { type:'value', axisLabel:{ fontSize:10 } },
    series: [
      {
        name:'Positive Adj', type:'bar',
        data: trend.map(r => r.pos_qty),
        stack:'qty',
        itemStyle:{ color:POS_C, borderRadius:[2,2,0,0] }, barMaxWidth:16,
      },
      {
        name:'Negative Adj', type:'bar',
        data: trend.map(r => r.neg_qty),
        stack:'qty',
        itemStyle:{ color:NEG_C, borderRadius:[0,0,2,2] }, barMaxWidth:16,
      },
    ],
  }), [trend])

  const typeOption = useMemo(() => {
    const sorted = [...byType].sort((a, b) => Math.abs(b.net_cost) - Math.abs(a.net_cost)).slice(0, 10)
    return {
      tooltip: { trigger:'axis', axisPointer:{ type:'shadow' } },
      grid:    { top:6, right:80, bottom:4, left:4, containLabel:true },
      xAxis:   { type:'value', axisLabel:{ fontSize:10 } },
      yAxis:   { type:'category', data: sorted.map(r => r.doc_type || '(Unknown)').reverse(), axisLabel:{ fontSize:10, width:110, overflow:'truncate' } },
      series:[{
        type:'bar',
        data: sorted.map(r => r.net_qty).reverse(),
        itemStyle:{ color:(p:any) => p.value >= 0 ? POS_C : NEG_C, borderRadius:[0,3,3,0] },
        barMaxWidth:20,
        label:{ show:true, position:'right', formatter:(p:any) => fmtSign(p.value), fontSize:10,
                color:(p:any) => p.value >= 0 ? POS_C : NEG_C },
      }],
    }
  }, [byType])

  const storeOption = useMemo(() => {
    const sorted = [...byStore].slice(0, 10)
    return {
      tooltip: { trigger:'axis', axisPointer:{ type:'shadow' } },
      grid:    { top:6, right:80, bottom:4, left:4, containLabel:true },
      xAxis:   { type:'value', axisLabel:{ fontSize:10 } },
      yAxis:   { type:'category', data: sorted.map(r => r.store_name || '(Unknown)').reverse(), axisLabel:{ fontSize:10, width:110, overflow:'truncate' } },
      series:[{
        type:'bar',
        data: sorted.map(r => r.net_qty).reverse(),
        itemStyle:{ color:(p:any) => p.value >= 0 ? POS_C : NEG_C, borderRadius:[0,3,3,0] },
        barMaxWidth:20,
        label:{ show:true, position:'right', formatter:(p:any) => fmtSign(p.value), fontSize:10,
                color:(p:any) => p.value >= 0 ? POS_C : NEG_C },
      }],
    }
  }, [byStore])

  // ── AG Grid columns ──────────────────────────────────────────────────────
  const typeCols: ColDef[] = useMemo(() => [
    { field:'doc_type',   headerName:'Type',         flex:1.5, minWidth:130 },
    { field:'adj_count',  headerName:'Adjustments',  flex:1,   minWidth:100, type:'numericColumn' },
    { field:'line_count', headerName:'Lines',        flex:1,   minWidth:80,  type:'numericColumn' },
    { field:'net_qty',    headerName:'Net Qty',      flex:1,   minWidth:90,  type:'numericColumn',
      valueFormatter:p => fmtSign(p.value),
      cellStyle:(p:any) => ({ color: p.value > 0 ? POS_C : p.value < 0 ? NEG_C : '#64748b', fontWeight:600 }) },
    { field:'pos_qty',    headerName:'+ Qty',        flex:1,   minWidth:80,  type:'numericColumn', valueFormatter:p => fmtN(p.value), cellStyle:() => ({ color:POS_C }) },
    { field:'neg_qty',    headerName:'− Qty',        flex:1,   minWidth:80,  type:'numericColumn', valueFormatter:p => fmtN(p.value), cellStyle:() => ({ color:NEG_C }) },
    { field:'net_cost',   headerName:'Net Cost Δ',   flex:1,   minWidth:110, type:'numericColumn',
      valueFormatter:p => fmtC(p.value), cellStyle:costStyle },
  ], [])

  const storeCols: ColDef[] = useMemo(() => [
    { field:'store_name', headerName:'Store',        flex:1.5, minWidth:130 },
    { field:'adj_count',  headerName:'Adjustments',  flex:1,   minWidth:100, type:'numericColumn' },
    { field:'line_count', headerName:'Lines',        flex:1,   minWidth:80,  type:'numericColumn' },
    { field:'net_qty',    headerName:'Net Qty',      flex:1,   minWidth:90,  type:'numericColumn',
      valueFormatter:p => fmtSign(p.value),
      cellStyle:(p:any) => ({ color: p.value > 0 ? POS_C : p.value < 0 ? NEG_C : '#64748b', fontWeight:600 }) },
    { field:'pos_qty',    headerName:'+ Qty',        flex:1,   minWidth:80,  type:'numericColumn', valueFormatter:p => fmtN(p.value), cellStyle:() => ({ color:POS_C }) },
    { field:'neg_qty',    headerName:'− Qty',        flex:1,   minWidth:80,  type:'numericColumn', valueFormatter:p => fmtN(p.value), cellStyle:() => ({ color:NEG_C }) },
    { field:'net_cost',   headerName:'Net Cost Δ',   flex:1,   minWidth:110, type:'numericColumn',
      valueFormatter:p => fmtC(p.value), cellStyle:costStyle },
  ], [])

  const detailCols: ColDef[] = useMemo(() => [
    { field:'ADJ_DATE',    headerName:'Date',        width:100, sortable:true },
    { field:'ADJ_NO',      headerName:'Adj #',       width:100 },
    { field:'store_name',  headerName:'Store',       flex:1,   minWidth:120 },
    { field:'employee',    headerName:'Employee',    flex:1,   minWidth:110 },
    { field:'doc_type',    headerName:'Type',        flex:1,   minWidth:110 },
    { field:'ALU',         headerName:'ALU',         width:100 },
    { field:'DESCRIPTION1',headerName:'Description', flex:1.5, minWidth:140 },
    { field:'department',  headerName:'Dept',        width:100 },
    { field:'vendor',      headerName:'Vendor',      flex:1,   minWidth:110 },
    { field:'orig_qty',    headerName:'Orig Qty',    width:85,  type:'numericColumn', valueFormatter:p => fmtN(p.value) },
    { field:'adj_qty',     headerName:'Adj Qty',     width:85,  type:'numericColumn', valueFormatter:p => fmtN(p.value) },
    { field:'qty_diff',    headerName:'Qty Δ',       width:85,  type:'numericColumn',
      valueFormatter:p => fmtSign(p.value),
      cellStyle:(p:any) => ({ color: p.value > 0 ? POS_C : p.value < 0 ? NEG_C : '#64748b', fontWeight:600 }) },
    { field:'unit_cost',   headerName:'Unit Cost',   width:90,  type:'numericColumn', valueFormatter:p => fmtN(p.value,2) },
    { field:'cost_diff',   headerName:'Cost Δ',      width:100, type:'numericColumn',
      valueFormatter:p => fmtC(p.value), cellStyle:costStyle },
  ], [])

  const tabData = [byType, byStore, details]
  const tabCols = [typeCols, storeCols, detailCols]

  return (
    <Box sx={{ p:3, display:'flex', flexDirection:'column', gap:2.5, minHeight:'100%' }}>

      {/* ── Filter bar ── */}
      <Box sx={{ display:'flex', alignItems:'center', gap:1.5, flexWrap:'wrap' }}>
        <Typography sx={{ fontWeight:800, fontSize:18, color:'#0f172a', mr:1 }}>
          Adjustments
        </Typography>
        {PERIODS.map((p, i) => (
          <Chip key={p.label} label={p.label} size="small" onClick={() => selectPeriod(i)}
            sx={{ fontWeight:period===i?700:500,
                  bgcolor: period===i ? ACCENT : 'transparent',
                  color:   period===i ? '#fff' : '#475569',
                  border: `1px solid ${period===i ? ACCENT : '#cbd5e1'}` }} />
        ))}
        <TextField type="date" size="small" value={dateFrom}
          onChange={e => { setDateFrom(e.target.value); setPeriod(-1) }}
          sx={{ width:140, '& input':{ fontSize:12 } }} />
        <Typography sx={{ color:'#94a3b8', fontSize:12 }}>→</Typography>
        <TextField type="date" size="small" value={dateTo}
          onChange={e => { setDateTo(e.target.value); setPeriod(-1) }}
          sx={{ width:140, '& input':{ fontSize:12 } }} />
        <Autocomplete
          multiple disableCloseOnSelect size="small"
          options={storeNames} value={selStores}
          onChange={(_, v) => setSelStores(v)}
          renderInput={p => <TextField {...p} label="Stores" sx={{ minWidth:200 }} />}
          sx={{ minWidth:200 }}
        />
      </Box>

      {/* ── KPI strip ── */}
      <Box sx={{ display:'flex', gap:1.5, flexWrap:'wrap' }}>
        <KpiCard label="Adjustments"     value={fmtN(kpi?.total_adjs  || 0)} sub={`${fmtN(kpi?.total_lines || 0)} lines`} />
        <KpiCard label="Net Qty Change"  value={fmtSign(kpi?.net_qty  || 0)}
          color={(kpi?.net_qty || 0) >= 0 ? POS_C : NEG_C} />
        <KpiCard label="+ Positive Qty"  value={fmtN(kpi?.pos_qty     || 0)} color={POS_C} />
        <KpiCard label="− Negative Qty"  value={fmtN(Math.abs(kpi?.neg_qty || 0))} color={NEG_C} />
        <KpiCard label="Net Cost Impact" value={fmtC(kpi?.net_cost    || 0)}
          sub={`+${fmtC(kpi?.pos_cost || 0)} / ${fmtC(kpi?.neg_cost || 0)}`}
          color={(kpi?.net_cost || 0) >= 0 ? POS_C : NEG_C} />
      </Box>

      {/* ── Charts row ── */}
      <Box sx={{ display:'flex', gap:2, flexWrap:'wrap' }}>
        <Box sx={{ flex:2, minWidth:300 }}>
          <ChartCard title="Daily Adjustment Trend (Qty)" chartRef={trendRef} height={240}>
            <EChart ref={trendRef} option={trendOption} style={{ height:'100%' }} />
          </ChartCard>
        </Box>
        <Box sx={{ flex:1, minWidth:240 }}>
          <ChartCard title="By Adjustment Type (Net Qty)" chartRef={typeRef} height={240}>
            <EChart ref={typeRef} option={typeOption} style={{ height:'100%' }} />
          </ChartCard>
        </Box>
        <Box sx={{ flex:1, minWidth:240 }}>
          <ChartCard title="By Store (Net Qty)" chartRef={storeRef} height={240}>
            <EChart ref={storeRef} option={storeOption} style={{ height:'100%' }} />
          </ChartCard>
        </Box>
      </Box>

      {/* ── AG Grid ── */}
      <Paper elevation={0} sx={{ borderRadius:2, border:'1px solid #e2e8f0', overflow:'hidden', flex:1, minHeight:340 }}>
        <Tabs value={tab} onChange={(_, v) => setTab(v)}
          sx={{ borderBottom:'1px solid #e2e8f0', minHeight:40,
                '& .MuiTab-root':{ fontSize:12, fontWeight:600, minHeight:40, textTransform:'none' } }}>
          <Tab label="By Type" />
          <Tab label="By Store" />
          <Tab label="Details" />
        </Tabs>
        <Box className="ag-theme-alpine" sx={{ height:360 }}>
          <AgGridReact
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
