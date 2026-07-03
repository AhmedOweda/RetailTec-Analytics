/**
 * Performance â€” Full analytics page
 * Store rankings Â· Payment mix Â· Hourly heatmap Â· Top Associates
 * Day-of-week Â· Basket distribution Â· Return/Discount rates Â· Top customers
 * Year-over-year per-store comparison
 */
import { useState, useMemo, useRef } from 'react'
import {
  Box, Card, CardContent, Typography, Chip, Skeleton,
  TextField, Button, Divider, Autocomplete,
  Dialog, DialogContent, DialogTitle, IconButton, Tooltip,
} from '@mui/material'
import CalendarMonthIcon  from '@mui/icons-material/CalendarMonth'
import FullscreenIcon     from '@mui/icons-material/Fullscreen'
import FileDownloadIcon   from '@mui/icons-material/FileDownload'
import CloseIcon          from '@mui/icons-material/Close'
import EChart, { type EChartHandle } from '../../components/EChart'
import { AgGridReact }    from 'ag-grid-react'
import type { ColDef }    from 'ag-grid-community'
import 'ag-grid-community/styles/ag-grid.css'
import 'ag-grid-community/styles/ag-theme-alpine.css'
import { useQuery }       from '@tanstack/react-query'
import axios              from 'axios'
import { useGridColumnState } from '../../hooks/useGridColumnState'
import { format, subDays, startOfMonth, startOfYear, subYears } from 'date-fns'
import { num }            from '../../utils/formatters'

/* â”€â”€ Theme â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
const ACCENT  = '#7c3aed'
const ACCENT2 = '#6d28d9'
const C_CYAN  = '#06b6d4'
const C_ROSE  = '#f43f5e'
const C_AMBER = '#f59e0b'
const C_GREEN = '#10b981'
const C_SLATE = '#94a3b8'

/* â”€â”€ Period presets â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
const PERIODS = [
  { label: '7D',  days:  7 },
  { label: '30D', days: 30 },
  { label: 'MTD', days: -1 },
  { label: 'YTD', days: -2 },
] as const
type Period = typeof PERIODS[number]['label']

/* â”€â”€ Labels â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
const DOW_LABELS  = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const HOUR_LABELS = Array.from({ length: 24 }, (_, i) => `${String(i).padStart(2,'0')}:00`)

/* â”€â”€ AG Grid shared styles â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
const GRID_SX = {
  '& .ag-root-wrapper':     { borderRadius: 1.5 },
  '& .ag-header':           { bgcolor: '#f8f7ff !important', borderBottom: '1px solid #e9e4ff' },
  '& .ag-header-cell-text': { fontWeight: 700, color: '#374151', fontSize: 12 },
  '& .ag-row-even':         { bgcolor: '#ffffff' },
  '& .ag-row-odd':          { bgcolor: '#faf9ff' },
  '& .ag-row:hover':        { bgcolor: '#f3f0ff !important' },
  '& .ag-paging-panel':     { borderTop: '1px solid #e9e4ff', color: '#475569' },
}
const DEF_COL: ColDef = { sortable: true, resizable: true, filter: true, cellStyle: { display:'flex', alignItems:'center' } }

/* â”€â”€ ChartPanel â€” ECharts wrapper with fullscreen + PNG export â”€â”€â”€â”€â”€ */
function ChartPanel({
  title, subtitle, option, height = 260, loading,
}: {
  title: string; subtitle?: string; option: any; height?: number; loading?: boolean
}) {
  const chartRef = useRef<EChartHandle>(null)
  const [open, setOpen]   = useState(false)

  const exportPng = () => {
    const inst = chartRef.current?.getEchartsInstance()
    if (!inst) return
    const url = inst.getDataURL({ type: 'png', backgroundColor: '#fff', pixelRatio: 2 })
    const a = document.createElement('a')
    a.href = url; a.download = `${title.replace(/\W+/g,'_')}.png`; a.click()
  }

  const toolbar = (
    <Box sx={{ display:'flex', gap:0.25, opacity:0.45, transition:'opacity .15s', '&:hover':{ opacity:1 } }}>
      <Tooltip title="Export PNG" placement="top">
        <IconButton size="small" onClick={exportPng} sx={{ p:0.5 }}>
          <FileDownloadIcon sx={{ fontSize:15, color:'#64748b' }} />
        </IconButton>
      </Tooltip>
      <Tooltip title="Fullscreen" placement="top">
        <IconButton size="small" onClick={() => setOpen(true)} sx={{ p:0.5 }}>
          <FullscreenIcon sx={{ fontSize:15, color:'#64748b' }} />
        </IconButton>
      </Tooltip>
    </Box>
  )

  return (
    <Card elevation={0} sx={{ border:'1px solid #e9e4ff', borderRadius:2.5 }}>
      <CardContent sx={{ p:2.5, '&:last-child':{ pb:2.5 } }}>
        <Box sx={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', mb:1.5 }}>
          <Box>
            <Typography sx={{ fontWeight:800, color:'#0f172a', fontSize:14 }}>{title}</Typography>
            {subtitle && <Typography sx={{ fontSize:12, color:C_SLATE, mt:0.2 }}>{subtitle}</Typography>}
          </Box>
          {toolbar}
        </Box>
        {loading
          ? <Skeleton variant="rectangular" height={height} sx={{ borderRadius:1.5 }} />
          : <EChart ref={chartRef} option={option} style={{ height }} />}
      </CardContent>

      <Dialog open={open} onClose={() => setOpen(false)} maxWidth="xl" fullWidth
        PaperProps={{ sx:{ borderRadius:3, m:2 } }}>
        <DialogTitle sx={{ fontWeight:800, color:'#0f172a', fontSize:16, pr:6, pb:0.5 }}>
          {title}
          {subtitle && <Typography sx={{ fontSize:12, color:C_SLATE, mt:0.3 }}>{subtitle}</Typography>}
        </DialogTitle>
        <IconButton onClick={() => setOpen(false)}
          sx={{ position:'absolute', right:12, top:12, color:'#64748b' }}>
          <CloseIcon />
        </IconButton>
        <DialogContent sx={{ pt:1 }}>
          <EChart option={option} style={{ height:'72vh' }} />
        </DialogContent>
      </Dialog>
    </Card>
  )
}

/* â”€â”€ TableSection â€” wrapper for AG Grid sections â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
function TableSection({
  title, subtitle, children, loading, height = 340,
}: {
  title: string; subtitle?: string; children: React.ReactNode; loading?: boolean; height?: number
}) {
  return (
    <Card elevation={0} sx={{ border:'1px solid #e9e4ff', borderRadius:2.5 }}>
      <CardContent sx={{ p:2.5, '&:last-child':{ pb:2.5 } }}>
        <Box sx={{ mb:1.5 }}>
          <Typography sx={{ fontWeight:800, color:'#0f172a', fontSize:14 }}>{title}</Typography>
          {subtitle && <Typography sx={{ fontSize:12, color:C_SLATE, mt:0.2 }}>{subtitle}</Typography>}
        </Box>
        {loading ? <Skeleton variant="rectangular" height={height} sx={{ borderRadius:1.5 }} /> : children}
      </CardContent>
    </Card>
  )
}

/* â”€â”€ Main component â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
export default function Performance() {
  const colsAssoc = useGridColumnState('perf-associates')
  const colsCust  = useGridColumnState('perf-customers')
  const todayStr = format(new Date(), 'yyyy-MM-dd')

  /* â”€â”€ Date range state â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
  const [period,      setPeriod     ] = useState<Period | null>('30D')
  const [customFrom,  setCustomFrom ] = useState(format(subDays(new Date(), 29), 'yyyy-MM-dd'))
  const [customTo,    setCustomTo   ] = useState(todayStr)
  const [appliedFrom, setAppliedFrom] = useState(format(subDays(new Date(), 29), 'yyyy-MM-dd'))
  const [appliedTo,   setAppliedTo  ] = useState(todayStr)
  const [selectedStores, setSelectedStores] = useState<string[]>([])

  const presetFrom = (p: Period) =>
    p === 'MTD' ? format(startOfMonth(new Date()), 'yyyy-MM-dd')
    : p === 'YTD' ? format(startOfYear(new Date()), 'yyyy-MM-dd')
    : format(subDays(new Date(), (PERIODS.find(x => x.label === p)?.days ?? 30) - 1), 'yyyy-MM-dd')

  const selectPeriod = (p: Period) => {
    const f = presetFrom(p)
    setPeriod(p); setCustomFrom(f); setCustomTo(todayStr)
    setAppliedFrom(f); setAppliedTo(todayStr)
  }
  const applyCustom = () => { setPeriod(null); setAppliedFrom(customFrom); setAppliedTo(customTo) }

  const from = appliedFrom
  const to   = appliedTo

  /* â”€â”€ Previous-year same window (for YoY) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
  const pyFrom = format(subYears(new Date(from), 1), 'yyyy-MM-dd')
  const pyTo   = format(subYears(new Date(to),   1), 'yyyy-MM-dd')

  /* â”€â”€ Queries â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
  const storesKey = selectedStores.join(',')
  const storeQS   = storesKey ? `&stores=${encodeURIComponent(storesKey)}` : ''
  const params    = `date_from=${from}&date_to=${to}${storeQS}`
  const qOpts     = { refetchOnMount: 'always' as const, gcTime: 0, retry: false }

  const { data: storesList = [] }                    = useQuery({ queryKey: ['stores-list'], queryFn: () => axios.get('/api/sales/stores-list').then(r => r.data as string[]), staleTime: 3_600_000 })
  const { data: storeData,  isLoading: storeLoad  } = useQuery({ queryKey: ['perf-stores',  from, to, storesKey], queryFn: () => axios.get(`/api/sales/perf/stores?${params}`).then(r => r.data),     ...qOpts })
  const { data: payData,    isLoading: payLoad    } = useQuery({ queryKey: ['perf-pay',     from, to, storesKey], queryFn: () => axios.get(`/api/sales/perf/payment?${params}`).then(r => r.data),    ...qOpts })
  const { data: hourlyData, isLoading: hourlyLoad } = useQuery({ queryKey: ['perf-hourly',  from, to, storesKey], queryFn: () => axios.get(`/api/sales/perf/hourly?${params}`).then(r => r.data),     ...qOpts })
  const { data: assocData,  isLoading: assocLoad  } = useQuery({ queryKey: ['perf-assoc',   from, to, storesKey], queryFn: () => axios.get(`/api/sales/perf/associates?${params}`).then(r => r.data), ...qOpts })
  const { data: dowData,    isLoading: dowLoad    } = useQuery({ queryKey: ['perf-dow',     from, to, storesKey], queryFn: () => axios.get(`/api/sales/perf/dow?${params}`).then(r => r.data),         ...qOpts })
  const { data: basketData, isLoading: basketLoad } = useQuery({ queryKey: ['perf-basket',  from, to, storesKey], queryFn: () => axios.get(`/api/sales/perf/basket?${params}`).then(r => r.data),     ...qOpts })
  const { data: custData,   isLoading: custLoad   } = useQuery({ queryKey: ['perf-cust',    from, to, storesKey], queryFn: () => axios.get(`/api/sales/perf/customers?${params}`).then(r => r.data),   ...qOpts })
  const { data: yoyData,    isLoading: yoyLoad    } = useQuery({ queryKey: ['perf-yoy',     from, to, storesKey], queryFn: () => axios.get(`/api/sales/perf/yoy_stores?${params}&py_from=${pyFrom}&py_to=${pyTo}`).then(r => r.data), ...qOpts })

  /* â”€â”€ Chart: Store Rankings â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
  const storeRankOpt = useMemo(() => {
    const rows  = ((storeData ?? []) as any[]).slice(0, 10).reverse()
    const names = rows.map(r => r.store_name ?? '(Unknown)')
    const sales = rows.map(r => +(r.net_sales ?? 0))
    const avg   = sales.length ? sales.reduce((a,b) => a+b, 0) / sales.length : 0
    return {
      grid: { top:8, right:80, bottom:8, left:12, containLabel:true },
      tooltip: {
        trigger:'axis', axisPointer:{ type:'shadow' },
        formatter: (p: any[]) => {
          const r = ((storeData ?? []) as any[]).find((x:any) => x.store_name === p[0].name) ?? {}
          const v = +p[0].value
          const pct = avg > 0 ? ((v - avg) / avg * 100).toFixed(1) : '0'
          const sign = +pct >= 0 ? '+' : ''
          return `<div style="min-width:190px">
            <b style="color:#0f172a">${p[0].name}</b><br/>
            <span style="color:#64748b">Net Sales:</span> <b>${v.toLocaleString('en-US',{maximumFractionDigits:0})}</b><br/>
            <span style="color:#64748b">Invoices:</span> ${(+r.invoice_count||0).toLocaleString()}<br/>
            <span style="color:#64748b">Avg Basket:</span> ${r.invoice_count ? (v/(+r.invoice_count)).toLocaleString('en-US',{maximumFractionDigits:0}) : 'â€”'}<br/>
            <span style="color:#64748b">Return Rate:</span> <span style="color:${C_ROSE}">${r.return_rate??0}%</span><br/>
            <span style="color:#64748b">Disc Rate:</span> <span style="color:${C_AMBER}">${r.disc_rate??0}%</span><br/>
            <span style="color:#64748b">vs Avg:</span> <span style="color:${+pct>=0?C_GREEN:C_ROSE}">${sign}${pct}%</span>
          </div>`
        },
      },
      xAxis: { type:'value', axisLabel:{ color:C_SLATE, fontSize:10, formatter:(v:number) => v>=1000?`${(v/1000).toFixed(0)}K`:`${v}` }, splitLine:{ lineStyle:{ color:'#f1f5f9' } } },
      yAxis: { type:'category', data:names, axisLabel:{ color:'#374151', fontSize:11 } },
      series: [{
        type:'bar', data:sales, barMaxWidth:22,
        itemStyle:{ borderRadius:[0,4,4,0], color:{ type:'linear', x:0,y:0,x2:1,y2:0, colorStops:[{ offset:0, color:'rgba(124,58,237,0.45)' },{ offset:1, color:ACCENT }] } },
        label:{ show:true, position:'right', color:'#64748b', fontSize:10, formatter:(p:any) => (+p.value).toLocaleString('en-US',{maximumFractionDigits:0}) },
        markLine:{ silent:true, lineStyle:{ color:C_AMBER, type:'dashed', width:1.5 },
          data:[{ type:'average', name:'Avg', label:{ position:'insideEndTop', formatter:'Avg\n{c}', color:C_AMBER, fontSize:9 } }] },
      }],
    }
  }, [storeData])

  /* â”€â”€ Chart: Payment Mix donut â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
  const payOpt = useMemo(() => {
    const d = ((payData ?? []) as any[])[0] ?? {}
    const raw = [
      { name:'Cash',    value: Math.abs(+(d.cash    ?? 0)) },
      { name:'Card',    value: Math.abs(+(d.card    ?? 0)) },
      { name:'Deposit', value: Math.abs(+(d.deposit ?? 0)) },
      { name:'Other',   value: Math.abs(+(d.other   ?? 0)) },
    ]
    const total = raw.reduce((s,x) => s+x.value, 0)
    const items = total > 0 ? raw.filter(x => x.value > 0) : [{ name:'No data', value:1 }]
    return {
      color: total > 0 ? [ACCENT, C_CYAN, C_AMBER, C_GREEN] : ['#e2e8f0'],
      tooltip: { trigger:'item', formatter: (p: any) => {
        if (!total) return 'No payment data'
        return `<b>${p.name}</b><br/>${p.value.toLocaleString('en-US',{maximumFractionDigits:0})} (${p.percent.toFixed(1)}%)`
      }},
      legend:{ bottom:4, textStyle:{ color:'#64748b', fontSize:11 }, itemGap:12 },
      series:[{
        type:'pie', radius:['48%','72%'], center:['50%','42%'],
        avoidLabelOverlap:false,
        label:{ show:false },
        emphasis:{ label:{ show:total>0, fontSize:13, fontWeight:700 } },
        data:items,
      }],
    }
  }, [payData])

  /* â”€â”€ Chart: Hourly Heatmap â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
  const heatOpt = useMemo(() => {
    const rows: any[] = (hourlyData ?? []) as any[]
    const data = rows.map(r => [
      HOUR_LABELS[Math.round(+r.hour)] ?? '00:00',
      DOW_LABELS[Math.round(+r.dow)]   ?? 'Sun',
      +(r.net_sales ?? 0),
    ])
    const maxV = data.length > 0 ? Math.max(...data.map(d => d[2] as number)) : 1
    const totSales = data.reduce((s,d) => s+(d[2] as number), 0)
    return {
      grid:{ top:20, right:110, bottom:36, left:48 },
      tooltip:{ formatter:(p:any) => {
        const [h, d, v] = p.data as [string,string,number]
        const pct = totSales > 0 ? (v/totSales*100).toFixed(1) : '0'
        return `<b>${d} Â· ${h}</b><br/>Net Sales: <b>${(+v).toLocaleString('en-US',{maximumFractionDigits:0})}</b><br/>Share of period: ${pct}%`
      }},
      xAxis:{ type:'category', data:HOUR_LABELS, splitArea:{ show:true }, axisLabel:{ color:C_SLATE, fontSize:9, interval:1 } },
      yAxis:{ type:'category', data:DOW_LABELS,  splitArea:{ show:true }, axisLabel:{ color:'#64748b', fontSize:11 } },
      visualMap:{ min:0, max:maxV, calculable:true, orient:'vertical', right:8, top:20, bottom:36, inRange:{ color:['#f5f3ff','#c4b5fd',ACCENT,'#3b0764'] }, textStyle:{ color:'#64748b', fontSize:10 } },
      series:[{ name:'Net Sales', type:'heatmap', data, label:{ show:false }, emphasis:{ itemStyle:{ shadowBlur:8, shadowColor:'rgba(124,58,237,.5)' } } }],
    }
  }, [hourlyData])

  /* â”€â”€ Chart: Day of Week â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
  const dowOpt = useMemo(() => {
    const map: Record<number,number> = {}
    ;((dowData ?? []) as any[]).forEach(r => { map[Math.round(+r.dow)] = +(r.total_net_sales ?? 0) })
    const vals  = DOW_LABELS.map((_,i) => map[i] ?? 0)
    const total = vals.reduce((a,b) => a+b, 0)
    const avg   = total / 7
    return {
      grid:{ top:24, right:12, bottom:32, left:12, containLabel:true },
      tooltip:{ trigger:'axis', axisPointer:{ type:'shadow' }, formatter:(p:any[]) => {
        const v   = +p[0].value
        const pct = total > 0 ? (v/total*100).toFixed(1) : '0'
        const sign = v >= avg ? '+' : ''
        const diff = avg > 0 ? ((v-avg)/avg*100).toFixed(1) : '0'
        return `<b>${p[0].name}</b><br/>Sales: <b>${v.toLocaleString('en-US',{maximumFractionDigits:0})}</b><br/>% of week: ${pct}%<br/>vs avg: <span style="color:${v>=avg?C_GREEN:C_ROSE}">${sign}${diff}%</span>`
      }},
      xAxis:{ type:'category', data:DOW_LABELS, axisLabel:{ color:'#64748b', fontSize:11 } },
      yAxis:{ type:'value', axisLabel:{ color:C_SLATE, fontSize:10, formatter:(v:number) => v>=1000?`${(v/1000).toFixed(0)}K`:`${v}` }, splitLine:{ lineStyle:{ color:'#f1f5f9' } } },
      series:[{
        type:'bar', data:vals, barMaxWidth:44,
        itemStyle:{ borderRadius:[4,4,0,0], color:{ type:'linear', x:0,y:0,x2:0,y2:1, colorStops:[{ offset:0, color:'rgba(124,58,237,0.9)' },{ offset:1, color:'rgba(124,58,237,0.15)' }] } },
        markLine:{ silent:true, lineStyle:{ color:C_AMBER, type:'dashed', width:1.5 },
          data:[{ type:'average', name:'Avg', label:{ position:'insideEndTop', formatter:'Avg: {c}', color:C_AMBER, fontSize:9 } }] },
      }],
    }
  }, [dowData])

  /* â”€â”€ Chart: Basket Distribution â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
  const basketOpt = useMemo(() => {
    const ORDER = ['0-50','50-100','100-200','200-500','500+']
    const map: Record<string,number> = {}
    ;((basketData ?? []) as any[]).forEach(r => { map[r.bucket] = +(r.tx_count ?? 0) })
    const vals  = ORDER.map(b => map[b] ?? 0)
    const total = vals.reduce((a,b) => a+b, 0)
    return {
      grid:{ top:24, right:12, bottom:32, left:12, containLabel:true },
      tooltip:{ trigger:'axis', axisPointer:{ type:'shadow' }, formatter:(p:any[]) => {
        const v   = +p[0].value
        const pct = total > 0 ? (v/total*100).toFixed(1) : '0'
        return `<b>${p[0].name} basket</b><br/>Transactions: <b>${v.toLocaleString()}</b><br/>Share: ${pct}%`
      }},
      xAxis:{ type:'category', data:ORDER, axisLabel:{ color:'#64748b', fontSize:11 } },
      yAxis:{ type:'value', axisLabel:{ color:C_SLATE, fontSize:10 }, splitLine:{ lineStyle:{ color:'#f1f5f9' } } },
      series:[{
        type:'bar', data:vals, barMaxWidth:44,
        itemStyle:{ borderRadius:[4,4,0,0], color:{ type:'linear', x:0,y:0,x2:0,y2:1, colorStops:[{ offset:0, color:'rgba(6,182,212,0.9)' },{ offset:1, color:'rgba(6,182,212,0.12)' }] } },
        markLine:{ silent:true, lineStyle:{ color:C_AMBER, type:'dashed', width:1.5 },
          data:[{ type:'average', name:'Avg', label:{ position:'insideEndTop', formatter:'Avg: {c}', color:C_AMBER, fontSize:9 } }] },
      }],
    }
  }, [basketData])

  /* â”€â”€ Chart: Return Rate by Store â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
  const retRateOpt = useMemo(() => {
    const rows  = ((storeData ?? []) as any[]).slice(0, 10).reverse()
    const names = rows.map(r => r.store_name ?? '(Unknown)')
    const rates = rows.map(r => +(r.return_rate ?? 0))
    const avg   = rates.length ? rates.reduce((a,b) => a+b,0)/rates.length : 0
    return {
      grid:{ top:8, right:60, bottom:8, left:12, containLabel:true },
      tooltip:{ trigger:'axis', formatter:(p:any[]) => {
        const diff = (+p[0].value - avg).toFixed(2)
        const sign = +diff >= 0 ? '+' : ''
        return `<b>${p[0].name}</b><br/>Return Rate: <b style="color:${C_ROSE}">${p[0].value}%</b><br/>vs avg: <span style="color:${+diff>=0?C_ROSE:C_GREEN}">${sign}${diff}pp</span>`
      }},
      xAxis:{ type:'value', axisLabel:{ color:C_SLATE, fontSize:10, formatter:(v:number) => `${v}%` }, splitLine:{ lineStyle:{ color:'#f1f5f9' } } },
      yAxis:{ type:'category', data:names, axisLabel:{ color:'#374151', fontSize:11 } },
      series:[{
        type:'bar', data:rates, barMaxWidth:20,
        itemStyle:{ borderRadius:[0,4,4,0], color:C_ROSE },
        label:{ show:true, position:'right', color:C_ROSE, fontSize:10, formatter:(p:any) => `${p.value}%` },
        markLine:{ silent:true, lineStyle:{ color:'#64748b', type:'dashed', width:1.5 },
          data:[{ type:'average', name:'Avg', label:{ position:'insideEndTop', formatter:'Avg {c}%', color:'#64748b', fontSize:9 } }] },
      }],
    }
  }, [storeData])

  /* â”€â”€ Chart: Discount Rate by Store â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
  const discRateOpt = useMemo(() => {
    const rows  = ((storeData ?? []) as any[]).slice(0, 10).reverse()
    const names = rows.map(r => r.store_name ?? '(Unknown)')
    const rates = rows.map(r => +(r.disc_rate ?? 0))
    const avg   = rates.length ? rates.reduce((a,b) => a+b,0)/rates.length : 0
    return {
      grid:{ top:8, right:60, bottom:8, left:12, containLabel:true },
      tooltip:{ trigger:'axis', formatter:(p:any[]) => {
        const diff = (+p[0].value - avg).toFixed(2)
        const sign = +diff >= 0 ? '+' : ''
        return `<b>${p[0].name}</b><br/>Disc Rate: <b style="color:${C_AMBER}">${p[0].value}%</b><br/>vs avg: <span style="color:${+diff>=0?C_ROSE:C_GREEN}">${sign}${diff}pp</span>`
      }},
      xAxis:{ type:'value', axisLabel:{ color:C_SLATE, fontSize:10, formatter:(v:number) => `${v}%` }, splitLine:{ lineStyle:{ color:'#f1f5f9' } } },
      yAxis:{ type:'category', data:names, axisLabel:{ color:'#374151', fontSize:11 } },
      series:[{
        type:'bar', data:rates, barMaxWidth:20,
        itemStyle:{ borderRadius:[0,4,4,0], color:C_AMBER },
        label:{ show:true, position:'right', color:C_AMBER, fontSize:10, formatter:(p:any) => `${p.value}%` },
        markLine:{ silent:true, lineStyle:{ color:'#64748b', type:'dashed', width:1.5 },
          data:[{ type:'average', name:'Avg', label:{ position:'insideEndTop', formatter:'Avg {c}%', color:'#64748b', fontSize:9 } }] },
      }],
    }
  }, [storeData])

  /* â”€â”€ Chart: Year-over-Year per Store (grouped bar) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
  const yoyOpt = useMemo(() => {
    const rows = ((yoyData ?? []) as any[]).slice(0, 15)
    const names   = rows.map(r => r.store_name ?? '(Unknown)')
    const current = rows.map(r => +(r.current_sales ?? 0))
    const prev    = rows.map(r => +(r.prev_year_sales ?? 0))
    return {
      grid:{ top:36, right:16, bottom:60, left:12, containLabel:true },
      legend:{ top:4, textStyle:{ color:'#475569', fontSize:11 }, itemWidth:12, itemHeight:8, itemGap:16 },
      tooltip:{
        trigger:'axis', axisPointer:{ type:'shadow' },
        formatter:(p:any[]) => {
          const cur  = p.find((x:any) => x.seriesName === 'Current Period')?.value ?? 0
          const prv  = p.find((x:any) => x.seriesName === 'Same Period LY')?.value ?? 0
          const chg  = prv > 0 ? ((cur-prv)/prv*100).toFixed(1) : 'N/A'
          const sign = +chg >= 0 ? '+' : ''
          return `<div style="min-width:210px">
            <b>${p[0]?.axisValue}</b><br/>
            <span style="color:${ACCENT}">â–®</span> Current: <b>${(+cur).toLocaleString('en-US',{maximumFractionDigits:0})}</b><br/>
            <span style="color:${C_SLATE}">â–®</span> Last Year: <b>${(+prv).toLocaleString('en-US',{maximumFractionDigits:0})}</b><br/>
            YoY Change: <b style="color:${+chg>=0?C_GREEN:C_ROSE}">${chg==='N/A'?'N/A':`${sign}${chg}%`}</b>
          </div>`
        },
      },
      xAxis:{ type:'category', data:names, axisLabel:{ color:'#374151', fontSize:10, rotate: names.length > 8 ? 30 : 0 }, axisTick:{ show:false } },
      yAxis:{ type:'value', axisLabel:{ color:C_SLATE, fontSize:10, formatter:(v:number) => v>=1000?`${(v/1000).toFixed(0)}K`:`${v}` }, splitLine:{ lineStyle:{ color:'#f1f5f9' } } },
      series:[
        {
          name:'Current Period', type:'bar', data:current, barGap:'0%', barMaxWidth:28,
          itemStyle:{ borderRadius:[4,4,0,0], color:{ type:'linear', x:0,y:0,x2:0,y2:1, colorStops:[{ offset:0, color:'rgba(124,58,237,0.95)' },{ offset:1, color:'rgba(124,58,237,0.3)' }] } },
        },
        {
          name:'Same Period LY', type:'bar', data:prev, barMaxWidth:28,
          itemStyle:{ borderRadius:[4,4,0,0], color:{ type:'linear', x:0,y:0,x2:0,y2:1, colorStops:[{ offset:0, color:'rgba(148,163,184,0.8)' },{ offset:1, color:'rgba(148,163,184,0.2)' }] } },
        },
      ],
    }
  }, [yoyData])

  /* â”€â”€ AG Grid: Associates columns â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
  const assocCols = useMemo<ColDef[]>(() => {
    const rows     = (assocData ?? []) as any[]
    const maxSales = rows.length ? Math.max(...rows.map(r => +(r.net_sales ?? 0))) : 1
    return [
      { headerName:'#', width:52, sortable:false, resizable:false, pinned:'left',
        valueGetter:(p:any) => (p.node?.rowIndex ?? 0) + 1,
        cellStyle:{ color:C_SLATE, fontSize:11, fontWeight:500, display:'flex', alignItems:'center' } },
      { field:'employee_name', headerName:'Associate', width:175, pinned:'left',
        cellStyle:{ fontWeight:600, color:'#1e293b', display:'flex', alignItems:'center' } },
      { field:'store_name',    headerName:'Store',      width:155 },
      { field:'invoice_count', headerName:'Invoices',   width:100, type:'numericColumn', valueFormatter:(p:any) => (+p.value||0).toLocaleString() },
      { field:'net_sales',     headerName:'Net Sales',  width:130, type:'numericColumn',
        valueFormatter:(p:any) => num(p.value ?? 0),
        cellStyle:(p:any) => {
          const ratio = maxSales > 0 ? Math.min((+(p.value??0)) / maxSales, 1) : 0
          const alpha = (0.08 + ratio * 0.30).toFixed(2)
          return { backgroundColor:`rgba(16,185,129,${alpha})`, display:'flex', alignItems:'center', fontWeight: ratio > 0.7 ? 600 : 400 }
        } },
      { field:'avg_basket',    headerName:'Avg Basket', width:120, type:'numericColumn', valueFormatter:(p:any) => num(p.value ?? 0) },
      { field:'disc_rate',     headerName:'Disc %',     width:90,  type:'numericColumn',
        valueFormatter:(p:any) => `${p.value ?? 0}%`,
        cellStyle:(p:any) => ({
          color:           (p.value??0)>10 ? '#92400e'  : '#1e293b',
          fontWeight:      (p.value??0)>10 ? 700 : 400,
          backgroundColor: (p.value??0)>10 ? '#fef3c7' : 'transparent',
          display:'flex', alignItems:'center',
        }) },
      { field:'return_rate',   headerName:'Return %',   width:100, type:'numericColumn',
        valueFormatter:(p:any) => `${p.value ?? 0}%`,
        cellStyle:(p:any) => ({
          color:           (p.value??0)>5 ? '#991b1b'  : '#1e293b',
          fontWeight:      (p.value??0)>5 ? 700 : 400,
          backgroundColor: (p.value??0)>5 ? '#fee2e2' : 'transparent',
          display:'flex', alignItems:'center',
        }) },
    ]
  }, [assocData])

  /* â”€â”€ AG Grid: Customer columns â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
  const custCols = useMemo<ColDef[]>(() => {
    const rows      = (custData ?? []) as any[]
    const maxSales  = rows.length ? Math.max(...rows.map(r => +(r.net_sales  ?? 0))) : 1
    const maxBasket = rows.length ? Math.max(...rows.map(r => +(r.avg_basket ?? 0))) : 1
    return [
      { headerName:'#', width:52, sortable:false, resizable:false, pinned:'left',
        valueGetter:(p:any) => (p.node?.rowIndex ?? 0) + 1,
        cellStyle:{ color:C_SLATE, fontSize:11, fontWeight:500, display:'flex', alignItems:'center' } },
      { field:'customer_name', headerName:'Customer',   width:210, pinned:'left',
        cellStyle:{ fontWeight:600, color:'#1e293b', display:'flex', alignItems:'center' } },
      { field:'invoice_count', headerName:'Visits',     width:90,  type:'numericColumn', valueFormatter:(p:any) => (+p.value||0).toLocaleString() },
      { field:'net_sales',     headerName:'Net Spend',  width:130, type:'numericColumn',
        valueFormatter:(p:any) => num(p.value ?? 0),
        cellStyle:(p:any) => {
          const ratio = maxSales > 0 ? Math.min((+(p.value??0)) / maxSales, 1) : 0
          const alpha = (0.08 + ratio * 0.30).toFixed(2)
          return { backgroundColor:`rgba(16,185,129,${alpha})`, display:'flex', alignItems:'center', fontWeight: ratio > 0.7 ? 600 : 400 }
        } },
      { field:'avg_basket',    headerName:'Avg Basket', width:120, type:'numericColumn',
        valueFormatter:(p:any) => num(p.value ?? 0),
        cellStyle:(p:any) => {
          const ratio = maxBasket > 0 ? Math.min((+(p.value??0)) / maxBasket, 1) : 0
          const alpha = (0.05 + ratio * 0.20).toFixed(2)
          return { backgroundColor:`rgba(124,58,237,${alpha})`, display:'flex', alignItems:'center' }
        } },
      { field:'last_visit',    headerName:'Last Visit', width:130 },
    ]
  }, [custData])

  /* â”€â”€ Render â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
  return (
    <Box sx={{ display:'flex', flexDirection:'column', gap:2.5 }}>

      {/* â”€â”€ Sticky header: title + date selector â”€â”€ */}
      <Box sx={{ position:'sticky', top:0, zIndex:10, bgcolor:'#ffffff',
          borderBottom:'1px solid #e9e4ff', px:3, pt:3, pb:2, mx:0 }}>
        <Typography variant="h6" sx={{ fontWeight:800, color:'#0f172a', letterSpacing:'-0.3px', mb:0.3 }}>
          Performance
        </Typography>
        <Typography sx={{ fontSize:12, color:C_SLATE, mb:1.5 }}>{from} â†’ {to}</Typography>

        {/* Date selector bar */}
        <Box sx={{ display:'flex', alignItems:'center', gap:1.5, flexWrap:'wrap' }}>
          <Box sx={{ display:'flex', gap:0.75, p:0.5, bgcolor:'#f1f5f9', borderRadius:2 }}>
            {PERIODS.map(p => (
              <Chip key={p.label} label={p.label} size="small" onClick={() => selectPeriod(p.label)}
                sx={{ fontWeight:700, fontSize:12, height:28, px:0.5, transition:'all .18s ease',
                  bgcolor: period===p.label ? ACCENT  : 'transparent',
                  color:   period===p.label ? '#fff'  : '#64748b',
                  boxShadow: period===p.label ? '0 2px 8px rgba(124,58,237,.35)' : 'none',
                  '&:hover':{ bgcolor: period===p.label ? ACCENT2 : '#e2e8f0' } }}
              />
            ))}
          </Box>
          <Divider orientation="vertical" flexItem sx={{ borderColor:'#e9e4ff', mx:0.5 }} />
          <Box sx={{ display:'flex', alignItems:'center', gap:1 }}>
            <CalendarMonthIcon sx={{ fontSize:16, color:C_SLATE }} />
            <TextField type="date" size="small" label="From" value={customFrom}
              onChange={e => { setCustomFrom(e.target.value); setPeriod(null) }}
              InputLabelProps={{ shrink:true }}
              sx={{ width:148, '& .MuiOutlinedInput-root':{ borderRadius:2, fontSize:13 } }} />
            <Typography sx={{ color:C_SLATE, fontSize:13, px:0.25 }}>â†’</Typography>
            <TextField type="date" size="small" label="To" value={customTo}
              onChange={e => { setCustomTo(e.target.value); setPeriod(null) }}
              InputLabelProps={{ shrink:true }}
              sx={{ width:148, '& .MuiOutlinedInput-root':{ borderRadius:2, fontSize:13 } }} />
            <Button size="small" variant="contained" onClick={applyCustom}
              disabled={!customFrom || !customTo || customFrom > customTo}
              sx={{ textTransform:'none', fontWeight:700, borderRadius:2, px:2.5, height:36,
                bgcolor:ACCENT, boxShadow:'0 2px 8px rgba(124,58,237,.35)', '&:hover':{ bgcolor:ACCENT2 } }}>
              Apply
            </Button>
          </Box>
          <Divider orientation="vertical" flexItem sx={{ borderColor:'#e9e4ff', mx:0.5 }} />
          <Autocomplete
            multiple
            size="small"
            options={storesList}
            value={selectedStores}
            onChange={(_, v) => setSelectedStores(v)}
            disableCloseOnSelect
            limitTags={2}
            renderInput={p => (
              <TextField {...p} label="Stores" placeholder={selectedStores.length === 0 ? 'All stores' : ''}
                sx={{ minWidth:230, '& .MuiOutlinedInput-root':{ borderRadius:2, fontSize:13 } }} />
            )}
            renderTags={(value, getTagProps) =>
              value.length <= 2
                ? value.map((opt, i) => <Chip {...getTagProps({ index: i })} key={opt} label={opt} size="small" sx={{ fontSize:11, height:20, maxWidth:110 }} />)
                : [<Chip key="n" label={`${value.length} stores`} size="small" sx={{ fontSize:11, height:20 }} />]
            }
            sx={{ minWidth:230 }}
          />
        </Box>
      </Box>

      {/* â”€â”€ Chart content â”€â”€ */}
      <Box sx={{ px:3, pb:3, display:'flex', flexDirection:'column', gap:2.5 }}>

        {/* Row 1: Store Rankings + Payment Mix */}
        <Box sx={{ display:'grid', gridTemplateColumns:'1fr 320px', gap:2 }}>
          <ChartPanel title="Store Rankings" subtitle="Net sales by branch Â· top 10" option={storeRankOpt} height={280} loading={storeLoad} />
          <ChartPanel title="Payment Mix" subtitle="Cash Â· Card Â· Deposit Â· Other" option={payOpt} height={280} loading={payLoad} />
        </Box>

        {/* Row 2: Hourly Heatmap */}
        <ChartPanel title="Hourly Sales Heatmap" subtitle="Net sales intensity Â· hour of day Ã— day of week" option={heatOpt} height={220} loading={hourlyLoad} />

        {/* Row 3: Top Associates + Top Customers (side by side) */}
        <Box sx={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:2 }}>
          <TableSection title="Top Associates" subtitle="Ranked by net sales Â· disc % amber >10% Â· return % red >5%" loading={assocLoad} height={320}>
            <Box className="ag-theme-alpine" sx={{ height:320, ...GRID_SX }}>
              <AgGridReact rowData={(assocData??[]) as any[]} columnDefs={assocCols}
                onGridReady={colsAssoc.onGridReady} onColumnMoved={colsAssoc.onColumnChanged}
                onColumnResized={colsAssoc.onColumnChanged} onColumnVisible={colsAssoc.onColumnChanged}
                onColumnPinned={colsAssoc.onColumnChanged}
                defaultColDef={DEF_COL} rowHeight={34} headerHeight={38}
                suppressCellFocus animateRows />
            </Box>
          </TableSection>
          <TableSection title="Top Customers" subtitle="Ranked by net spend for the selected period" loading={custLoad} height={320}>
            <Box className="ag-theme-alpine" sx={{ height:320, ...GRID_SX }}>
              <AgGridReact rowData={(custData??[]) as any[]} columnDefs={custCols}
                onGridReady={colsCust.onGridReady} onColumnMoved={colsCust.onColumnChanged}
                onColumnResized={colsCust.onColumnChanged} onColumnVisible={colsCust.onColumnChanged}
                onColumnPinned={colsCust.onColumnChanged}
                defaultColDef={DEF_COL} rowHeight={34} headerHeight={38}
                suppressCellFocus animateRows />
            </Box>
          </TableSection>
        </Box>

        {/* Row 4: Day of Week + Basket Distribution */}
        <Box sx={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:2 }}>
          <ChartPanel title="Day of Week Pattern" subtitle="Total net sales per weekday" option={dowOpt} height={240} loading={dowLoad} />
          <ChartPanel title="Basket Size Distribution" subtitle="Transaction count by value bucket" option={basketOpt} height={240} loading={basketLoad} />
        </Box>

        {/* Row 5: Return Rate + Discount Rate */}
        <Box sx={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:2 }}>
          <ChartPanel title="Return Rate by Store" subtitle="Return value Ã· gross sales Â· dashed = avg" option={retRateOpt} height={260} loading={storeLoad} />
          <ChartPanel title="Discount Rate by Store" subtitle="Total discounts Ã· gross sales Â· dashed = avg" option={discRateOpt} height={260} loading={storeLoad} />
        </Box>

        {/* Row 6: YoY per Store */}
        <ChartPanel title="Year-over-Year by Store" subtitle={`Current period vs same window last year  Â·  ${from.slice(5)} â†’ ${to.slice(5)}`} option={yoyOpt} height={300} loading={yoyLoad} />



      </Box>
    </Box>
  )
}
