/**
 * Inventory → Adjustments
 * ─────────────────────────
 * Period filter + store filter
 * KPI strip: Adjustments · Items · Net Qty · Positive Impact · Negative Impact
 * Charts: Daily Trend | By Type | By Store
 * AG Grid tabs: By Type | By Store | Details
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
import { tr, trCols } from '../../i18n'

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
          <Typography sx={{ fontWeight:700, fontSize:13, color:'#334155' }}>{tr(title)}</Typography>
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
const fmtSign = (v: number) => v > 0 ? `+${fmtN(v)}` : fmtN(v)

// ── Cost cell style ────────────────────────────────────────────────────────
const costStyle = (p: any) => ({
  color: p.value > 0 ? POS_C : p.value < 0 ? NEG_C : '#64748b',
  fontWeight: 600,
})

// ══════════════════════════════════════════════════════════════════════════════
export default function Adjustments() {
  const { productCodeField } = useAppSettings()
  const codeField  = productCodeField.toUpperCase()   // 'ALU' or 'UPC'
  const [period,   setPeriod  ] = useState(1)  // default 30D
  const [dateFrom, setDateFrom] = useState(() => daysAgo(30))
  const [dateTo,   setDateTo  ] = useState(today)
  const [selStores, setSelStores] = useState<string[]>([])
  const [tab, setTab] = useState(0)

  const gridRef  = useRef<AgGridReact>(null)
  const { onGridReady: onColGridReady, onColumnChanged } = useGridColumnState(`inv-adjustments-t${tab}`)
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
    queryFn:  () => axios.get('/api/inventory/adjustments/details', { params: qParams }).then(r => r.data),
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
    tooltip: {
      trigger:'axis', axisPointer:{ type:'cross' },
      formatter:(p:any[]) => {
        const r = trend[p[0]?.dataIndex] ?? {}
        return `<b>${p[0]?.axisValue}</b><br/>
          + Cost: <b style="color:${POS_C}">${fmtC(r.pos_cost || 0)}</b><br/>
          − Cost: <b style="color:${NEG_C}">${fmtC(r.neg_cost || 0)}</b><br/>
          Net: <b>${fmtC(r.net_cost || 0)}</b>`
      },
    },
    legend:  { bottom:0, textStyle:{ fontSize:11 } },
    grid:    { top:10, right:12, bottom:36, left:68 },
    xAxis:   { type:'category', data: trend.map(r => r.ADJ_DATE?.toString().slice(0,10) || ''), axisLabel:{ fontSize:10 } },
    yAxis:   { type:'value', axisLabel:{ fontSize:10, formatter:(v:number) => v>=1000?`${(v/1000).toFixed(0)}K`:`${v}` } },
    series: [
      {
        name:'+ Cost', type:'bar',
        data: trend.map(r => r.pos_cost),
        stack:'cost',
        itemStyle:{ color:POS_C, borderRadius:[2,2,0,0] }, barMaxWidth:16,
      },
      {
        name:'− Cost', type:'bar',
        data: trend.map(r => r.neg_cost),
        stack:'cost',
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
        data: sorted.map(r => r.net_cost).reverse(),
        itemStyle:{ color:(p:any) => p.value >= 0 ? POS_C : NEG_C, borderRadius:[0,3,3,0] },
        barMaxWidth:20,
        label:{ show:true, position:'right', formatter:(p:any) => fmtC(p.value), fontSize:10,
                color:(p:any) => p.value >= 0 ? POS_C : NEG_C },
      }],
    }
  }, [byType])

  const storeOption = useMemo(() => {
    const sorted = [...byStore].sort((a,b) => Math.abs(b.net_cost) - Math.abs(a.net_cost)).slice(0, 10)
    return {
      tooltip: { trigger:'axis', axisPointer:{ type:'shadow' } },
      grid:    { top:6, right:90, bottom:4, left:4, containLabel:true },
      xAxis:   { type:'value', axisLabel:{ fontSize:10, formatter:(v:number) => v>=1000?`${(v/1000).toFixed(0)}K`:`${v}` } },
      yAxis:   { type:'category', data: sorted.map(r => r.store_name || '(Unknown)').reverse(), axisLabel:{ fontSize:10, width:110, overflow:'truncate' } },
      series:[{
        type:'bar',
        data: sorted.map(r => r.net_cost).reverse(),
        itemStyle:{ color:(p:any) => p.value >= 0 ? POS_C : NEG_C, borderRadius:[0,3,3,0] },
        barMaxWidth:20,
        label:{ show:true, position:'right', formatter:(p:any) => fmtC(p.value), fontSize:10,
                color:(p:any) => p.value >= 0 ? POS_C : NEG_C },
      }],
    }
  }, [byStore])

  // ── AG Grid columns ──────────────────────────────────────────────────────
  const typeCols: ColDef[] = useMemo(() => [
    { field:'doc_type',   headerName:'Type',         flex:1.5, minWidth:130 },
    { field:'adj_count',  headerName:'Adjustments',  flex:1,   minWidth:100, type:'numericColumn' },
    { field:'line_count', headerName:'Lines',        flex:1,   minWidth:80,  type:'numericColumn' },
    { field:'net_cost',   headerName:'Net Cost Δ',   flex:1,   minWidth:120, type:'numericColumn',
      valueFormatter:p => fmtC(p.value), cellStyle:costStyle },
    { field:'net_qty',    headerName:'Net Qty',      flex:1,   minWidth:90,  type:'numericColumn',
      valueFormatter:p => fmtSign(p.value),
      cellStyle:(p:any) => ({ color: p.value > 0 ? POS_C : p.value < 0 ? NEG_C : '#64748b', fontWeight:600 }) },
    { field:'pos_qty',    headerName:'+ Qty',        flex:1,   minWidth:80,  type:'numericColumn', valueFormatter:p => fmtN(p.value), cellStyle:() => ({ color:POS_C }) },
    { field:'neg_qty',    headerName:'− Qty',        flex:1,   minWidth:80,  type:'numericColumn', valueFormatter:p => fmtN(p.value), cellStyle:() => ({ color:NEG_C }) },
  ], [])

  const storeCols: ColDef[] = useMemo(() => [
    { field:'store_name', headerName:'Store',        flex:1.5, minWidth:130 },
    { field:'adj_count',  headerName:'Adjustments',  flex:1,   minWidth:100, type:'numericColumn' },
    { field:'line_count', headerName:'Lines',        flex:1,   minWidth:80,  type:'numericColumn' },
    { field:'net_cost',   headerName:'Net Cost Δ',   flex:1,   minWidth:120, type:'numericColumn',
      valueFormatter:p => fmtC(p.value), cellStyle:costStyle },
    { field:'net_qty',    headerName:'Net Qty',      flex:1,   minWidth:90,  type:'numericColumn',
      valueFormatter:p => fmtSign(p.value),
      cellStyle:(p:any) => ({ color: p.value > 0 ? POS_C : p.value < 0 ? NEG_C : '#64748b', fontWeight:600 }) },
    { field:'pos_qty',    headerName:'+ Qty',        flex:1,   minWidth:80,  type:'numericColumn', valueFormatter:p => fmtN(p.value), cellStyle:() => ({ color:POS_C }) },
    { field:'neg_qty',    headerName:'− Qty',        flex:1,   minWidth:80,  type:'numericColumn', valueFormatter:p => fmtN(p.value), cellStyle:() => ({ color:NEG_C }) },
  ], [])

  const detailCols: ColDef[] = useMemo(() => [
    { field:'ADJ_DATE',    headerName:'Date',        width:100, sortable:true },
    { field:'ADJ_NO',      headerName:'Adj #',       width:100 },
    { field:'store_name',  headerName:'Store',       flex:1,   minWidth:120 },
    { field:'employee',    headerName:'Employee',    flex:1,   minWidth:110 },
    { field:'doc_type',    headerName:'Type',        flex:1,   minWidth:110 },
    { field:codeField,     headerName:codeField,     width:100 },
    { field:'DESCRIPTION1',headerName:'Description', flex:1.5, minWidth:140 },
    { field:'department',  headerName:'Dept',        width:100 },
    { field:'vendor',      headerName:'Item Vendor', flex:1,   minWidth:110,
      headerTooltip:'Vendor from the item master (catalog) — not necessarily the supplier purchased from' },
    { field:'orig_qty',    headerName:'Orig Qty',    width:85,  type:'numericColumn', valueFormatter:p => fmtN(p.value) },
    { field:'adj_qty',     headerName:'Adj Qty',     width:85,  type:'numericColumn', valueFormatter:p => fmtN(p.value) },
    { field:'qty_diff',    headerName:'Qty Δ',       width:85,  type:'numericColumn',
      valueFormatter:p => fmtSign(p.value),
      cellStyle:(p:any) => ({ color: p.value > 0 ? POS_C : p.value < 0 ? NEG_C : '#64748b', fontWeight:600 }) },
    { field:'unit_cost',   headerName:'Unit Cost',   width:90,  type:'numericColumn', valueFormatter:p => fmtN(p.value,2) },
    { field:'cost_diff',   headerName:'Cost Δ',      width:100, type:'numericColumn',
      valueFormatter:p => fmtC(p.value), cellStyle:costStyle },
  ], [codeField])

  const tabData = [byType, byStore, details]
  const tabCols = [typeCols, storeCols, detailCols]

  return (
    <Box sx={{ pt:0, px:3, pb:3, display:'flex', flexDirection:'column', gap:2.5, minHeight:'100%' }}>

      {/* ── Header (standard page pattern — matches Stock Movement) ── */}
      <Box sx={{ position:'sticky', top:0, zIndex:10, bgcolor:'#ffffff',
                 mx:-3, px:3, pt:3, pb:2, borderBottom:'1px solid #e9e4ff' }}>
        <Typography variant="h6" sx={{ fontWeight:800, color:'#0f172a', letterSpacing:'-0.3px', mb:0.3 }}>
          {tr('Adjustments')}
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
        <KpiCard label="Net Cost Impact" value={fmtC(kpi?.net_cost    || 0)}
          sub={`+${fmtC(kpi?.pos_cost || 0)} / ${fmtC(kpi?.neg_cost || 0)}`}
          color={(kpi?.net_cost || 0) >= 0 ? POS_C : NEG_C} icon="ti-scale" />
        <KpiCard label="+ Positive Cost" value={fmtC(kpi?.pos_cost    || 0)} color={POS_C} icon="ti-trending-up" />
        <KpiCard label="− Negative Cost" value={fmtC(Math.abs(kpi?.neg_cost || 0))} color={NEG_C} icon="ti-trending-down" />
        <KpiCard label="Adjustments"     value={fmtN(kpi?.total_adjs  || 0)} sub={`${fmtN(kpi?.total_lines || 0)} lines`} icon="ti-edit" />
        <KpiCard label="Net Qty Change"  value={fmtSign(kpi?.net_qty  || 0)}
          sub={`+${fmtN(kpi?.pos_qty || 0)} / ${fmtN(kpi?.neg_qty || 0)}`}
          color={(kpi?.net_qty || 0) >= 0 ? POS_C : NEG_C} icon="ti-arrows-diff" />
      </Box>

      {/* ── Charts row ── */}
      <Box sx={{ display:'flex', gap:2, flexWrap:'wrap' }}>
        <Box sx={{ flex:2, minWidth:300 }}>
          <ChartCard title="Daily Adjustment Trend (Cost $)" chartRef={trendRef} height={240}>
            <EChart ref={trendRef} option={trendOption} style={{ height:'100%' }} />
          </ChartCard>
        </Box>
        <Box sx={{ flex:1, minWidth:240 }}>
          <ChartCard title="By Adjustment Type (Net Cost $)" chartRef={typeRef} height={240}>
            <EChart ref={typeRef} option={typeOption} style={{ height:'100%' }} />
          </ChartCard>
        </Box>
        <Box sx={{ flex:1, minWidth:240 }}>
          <ChartCard title="By Store (Net Cost $)" chartRef={storeRef} height={240}>
            <EChart ref={storeRef} option={storeOption} style={{ height:'100%' }} />
          </ChartCard>
        </Box>
      </Box>

      {/* ── AG Grid ── */}
      <Paper elevation={0} sx={{ borderRadius:2, border:'1px solid #e2e8f0', overflow:'hidden', flex:1, minHeight:340 }}>
        <Box sx={{ display:'flex', justifyContent:'flex-end', px:1.5, pt:1 }}>
          <GridExportBar gridRef={gridRef} filename="adjustments" title="Adjustments" />
        </Box>
        <Tabs value={tab} onChange={(_, v) => setTab(v)}
          sx={{ borderBottom:'1px solid #e2e8f0', minHeight:40,
                '& .MuiTab-root':{ fontSize:12, fontWeight:600, minHeight:40, textTransform:'none' } }}>
          <Tab label="By Type" />
          <Tab label="By Store" />
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
            columnDefs={trCols(tabCols[tab] as any[])}
            defaultColDef={{ resizable:true, sortable:true, filter:true }}
            pagination paginationPageSize={100}
          />
        </Box>
      </Paper>

    </Box>
  )
}
