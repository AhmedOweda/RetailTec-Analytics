/**
 * Overview — KPI cards with period-over-period comparisons + Sales Trend chart
 */
import { useState, useMemo, useRef } from 'react'
import {
  Box, Card, CardContent, Typography, Divider,
  Skeleton, Alert, Chip,
  Dialog, DialogTitle, DialogContent, IconButton, Tooltip,
} from '@mui/material'
import TrendingUpIcon    from '@mui/icons-material/TrendingUp'
import TrendingDownIcon  from '@mui/icons-material/TrendingDown'
import RemoveIcon        from '@mui/icons-material/Remove'
import FullscreenIcon    from '@mui/icons-material/Fullscreen'
import FileDownloadIcon  from '@mui/icons-material/FileDownload'
import CloseIcon         from '@mui/icons-material/Close'
import EChart, { type EChartHandle } from '../../components/EChart'
import { useQuery }     from '@tanstack/react-query'
import axios            from 'axios'
import { format, subDays, startOfMonth, startOfYear, subMonths } from 'date-fns'
import { num }          from '../../utils/formatters'
import { useAppSettings } from '../../context/AppSettings'

/* ── Theme ──────────────────────────────────────────────────────── */
const ACCENT  = '#7c3aed'
const ACCENT2 = '#6d28d9'
const C_INV   = '#06b6d4'   // cyan  — Invoices bars
const C_RET   = '#f43f5e'   // rose  — Return Rate line

/* ── Types ──────────────────────────────────────────────────────── */
interface PeriodKpi {
  net_sales:    number
  total_wtax:   number
  sales_count:  number
  return_count: number
  invoice_disc: number
  total_tax:    number
  gross_sales:  number
  return_amt:   number
  avg_ticket:   number
  disc_ratio:   number
  return_rate:  number
}
interface OverviewData {
  today:     PeriodKpi
  yesterday: PeriodKpi
  mtd:       PeriodKpi
  ytd:       PeriodKpi
  prev_day:  PeriodKpi
  lmtd:      PeriodKpi
  lytd:      PeriodKpi
}

/* ── Helpers ────────────────────────────────────────────────────── */
function pct(curr: number, prev: number): number | null {
  if (!prev) return null
  return ((curr - prev) / Math.abs(prev)) * 100
}


/* ── Comparison badge ───────────────────────────────────────────── */
function ChangeBadge({ curr, prev, label }: { curr: number; prev: number; label: string }) {
  const p = pct(curr, prev)
  if (p === null) return (
    <Box sx={{ display:'flex', alignItems:'center', gap:0.5 }}>
      <RemoveIcon sx={{ fontSize:13, color:'#94a3b8' }}/>
      <Typography sx={{ fontSize:11, color:'#94a3b8' }}>No prior data</Typography>
    </Box>
  )
  const up  = p >= 0
  const clr = up ? '#16a34a' : '#dc2626'
  const bg  = up ? '#f0fdf4' : '#fef2f2'
  const brd = up ? '#bbf7d0' : '#fecaca'
  return (
    <Box sx={{
      display:'inline-flex', alignItems:'center', gap:0.6,
      bgcolor:bg, border:`1px solid ${brd}`,
      borderRadius:2, px:1.1, py:0.35,
    }}>
      {up
        ? <TrendingUpIcon   sx={{ fontSize:13, color:clr }}/>
        : <TrendingDownIcon sx={{ fontSize:13, color:clr }}/>
      }
      <Typography sx={{ fontSize:12, fontWeight:800, color:clr, lineHeight:1 }}>
        {up ? '+' : ''}{p.toFixed(1)}%
      </Typography>
      <Typography sx={{ fontSize:11, color:'#94a3b8', lineHeight:1 }}>
        vs {label}
      </Typography>
    </Box>
  )
}

/* ── Stat sub-row ───────────────────────────────────────────────── */
function Stat({ label, value, red = false }: { label:string; value:string|number; red?:boolean }) {
  return (
    <Box>
      <Typography sx={{ fontSize:10, color:'#94a3b8', fontWeight:700,
                        textTransform:'uppercase', letterSpacing:0.8 }}>
        {label}
      </Typography>
      <Typography sx={{ fontSize:13, fontWeight:700, color: red ? '#ef4444' : '#1e293b' }}>
        {value}
      </Typography>
    </Box>
  )
}

/* ── KPI Card ───────────────────────────────────────────────────── */
interface KpiCardProps {
  label:      string
  dot:        string
  data?:      PeriodKpi
  prevData?:  PeriodKpi
  prevLabel:  string
  loading:    boolean
}

function KpiCard({ label, dot, data, prevData, prevLabel, loading }: KpiCardProps) {
  const { currency } = useAppSettings()
  const net    = data?.net_sales    ?? 0
  const wtax   = data?.total_wtax   ?? 0
  const tax    = data?.total_tax    ?? 0
  const inv    = data?.sales_count  ?? 0
  const ret    = data?.return_count ?? 0
  const disc   = data?.invoice_disc ?? 0
  const retAmt = data?.return_amt   ?? 0
  const rr     = data?.return_rate  ?? 0   // value-based, from backend
  const dr     = data?.disc_ratio   ?? 0   // discount ÷ gross, from backend
  const avgTkt = data?.avg_ticket   ?? 0

  // Format integers with thousand separator
  const fmtInt = (n: number) => n.toLocaleString('en-US')

  return (
    <Card elevation={0} sx={{
      border:'1px solid #e9e4ff',
      borderRadius:2.5,
      height:'100%',
      transition:'box-shadow .2s, transform .2s',
      '&:hover':{ boxShadow:'0 8px 30px rgba(124,58,237,.12)', transform:'translateY(-2px)' },
    }}>
      <CardContent sx={{ p:2.5, '&:last-child':{ pb:2.5 } }}>

        {/* Header */}
        <Box sx={{ display:'flex', alignItems:'center', justifyContent:'space-between', mb:1.5 }}>
          <Typography sx={{ fontSize:10, fontWeight:800, color:'#94a3b8',
                            textTransform:'uppercase', letterSpacing:1.2 }}>
            {label}
          </Typography>
          <Box sx={{ width:9, height:9, borderRadius:'50%', bgcolor:dot,
                     boxShadow:`0 0 0 3px ${dot}30` }}/>
        </Box>

        {loading ? (
          <>
            <Skeleton height={38} sx={{ mb:0.5, borderRadius:1 }}/>
            <Skeleton height={20} width="70%" sx={{ borderRadius:1 }}/>
            <Skeleton height={26} width="60%" sx={{ mt:1, borderRadius:1 }}/>
          </>
        ) : (
          <>
            {/* Primary metric */}
            <Typography sx={{ fontSize:30, fontWeight:800, color:'#0f172a',
                              lineHeight:1.05, letterSpacing:'-0.5px', fontVariantNumeric:'tabular-nums' }}>
              <Box component="span" sx={{ fontSize:15, fontWeight:700, color:'#7c3aed', mr:0.7 }}>
                {currency.symbol}
              </Box>
              {num(net)}
            </Typography>
            <Typography sx={{ fontSize:11, color:'#94a3b8', mt:0.3, mb:1.2 }}>
              Net Sales (excl. tax)
            </Typography>

            {/* Comparison badge */}
            {prevData && (
              <ChangeBadge curr={net} prev={prevData.net_sales} label={prevLabel}/>
            )}

            <Divider sx={{ my:1.5, borderColor:'#f1f5f9' }}/>

            {/* Secondary metrics — 2-col grid */}
            <Box sx={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:1 }}>

              <Stat label="Incl. Tax"  value={num(wtax)} />
              <Stat label="Tax Amount" value={num(tax)}  />

              {/* Invoices — with thousands sep */}
              <Box>
                <Typography sx={{ fontSize:10, color:'#94a3b8', fontWeight:700,
                                  textTransform:'uppercase', letterSpacing:0.8 }}>
                  Invoices
                </Typography>
                <Box sx={{ display:'flex', alignItems:'center', gap:0.6, mt:0.15 }}>
                  <Typography sx={{ fontSize:13, fontWeight:700, color:'#1e293b' }}>
                    {fmtInt(inv)}
                  </Typography>
                </Box>
              </Box>

              {/* Returns — count · value · rate% */}
              <Box>
                <Typography sx={{ fontSize:10, color:'#94a3b8', fontWeight:700,
                                  textTransform:'uppercase', letterSpacing:0.8 }}>
                  Returns
                </Typography>
                {/* Count */}
                <Typography sx={{ fontSize:13, fontWeight:700, mt:0.15,
                                  color: ret > 0 ? '#ef4444' : '#1e293b' }}>
                  {fmtInt(ret)}
                </Typography>
                {/* Value + Rate badge on same row */}
                <Box sx={{ display:'flex', alignItems:'center', gap:0.6, mt:0.2 }}>
                  <Typography sx={{ fontSize:11, fontWeight:600, color:'#ef4444' }}>
                    {num(retAmt)}
                  </Typography>
                  {rr > 0 && (
                    <Box sx={{
                      px:0.7, py:0.1, borderRadius:1,
                      bgcolor: rr > 5 ? '#fef2f2' : '#f1f5f9',
                      border:`1px solid ${rr > 5 ? '#fecaca' : '#e2e8f0'}`,
                    }}>
                      <Typography sx={{ fontSize:10, fontWeight:800, lineHeight:1.5,
                                        color: rr > 5 ? '#ef4444' : '#64748b' }}>
                        {rr}%
                      </Typography>
                    </Box>
                  )}
                </Box>
              </Box>

              {/* Avg Ticket */}
              <Stat label="Avg Ticket" value={num(avgTkt)} />

              {/* Discount — amount + ratio badge */}
              <Box>
                <Typography sx={{ fontSize:10, color:'#94a3b8', fontWeight:700,
                                  textTransform:'uppercase', letterSpacing:0.8 }}>
                  Discount
                </Typography>
                <Box sx={{ display:'flex', alignItems:'center', gap:0.6, mt:0.15 }}>
                  <Typography sx={{ fontSize:13, fontWeight:700, color:'#1e293b' }}>
                    {num(disc)}
                  </Typography>
                  {disc > 0 && (
                    <Box sx={{
                      px:0.7, py:0.1, borderRadius:1,
                      bgcolor:'#fffbeb',
                      border:'1px solid #fde68a',
                    }}>
                      <Typography sx={{ fontSize:10, fontWeight:800, lineHeight:1.5,
                                        color:'#d97706' }}>
                        {dr}%
                      </Typography>
                    </Box>
                  )}
                </Box>
              </Box>

            </Box>
          </>
        )}
      </CardContent>
    </Card>
  )
}

/* ── Mini-chart card (with fullscreen + PNG export) ──────────────── */
function MiniChart({ title, subtitle, option, loading }: {
  title: string; subtitle?: string; option: any; loading?: boolean
}) {
  const chartRef = useRef<EChartHandle>(null)
  const [open, setOpen] = useState(false)

  const exportPng = () => {
    const inst = chartRef.current?.getEchartsInstance()
    if (!inst) return
    const url = inst.getDataURL({ type:'png', backgroundColor:'#fff', pixelRatio:2 })
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
    <>
      <Card elevation={0} sx={{ border:'1px solid #e9e4ff', borderRadius:2.5, height:'100%' }}>
        <CardContent sx={{ p:2, '&:last-child':{ pb:2 } }}>
          <Box sx={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', mb:0.5 }}>
            <Box>
              <Typography sx={{ fontWeight:800, color:'#0f172a', fontSize:13, lineHeight:1.2 }}>{title}</Typography>
              {subtitle && <Typography sx={{ fontSize:11, color:'#94a3b8', mt:0.2 }}>{subtitle}</Typography>}
            </Box>
            {toolbar}
          </Box>
          {loading
            ? <Skeleton variant="rectangular" height={200} sx={{ borderRadius:1.5, mt:1 }} />
            : <EChart ref={chartRef} option={option} style={{ height:200 }} />
          }
        </CardContent>
      </Card>

      <Dialog open={open} onClose={() => setOpen(false)} maxWidth="xl" fullWidth
        PaperProps={{ sx:{ borderRadius:3, m:2 } }}>
        <DialogTitle sx={{ fontWeight:800, color:'#0f172a', fontSize:16, pr:6, pb:0.5 }}>
          {title}
          {subtitle && <Typography sx={{ fontSize:12, color:'#94a3b8', mt:0.3 }}>{subtitle}</Typography>}
        </DialogTitle>
        <IconButton onClick={() => setOpen(false)}
          sx={{ position:'absolute', right:12, top:12, color:'#64748b' }}>
          <CloseIcon />
        </IconButton>
        <DialogContent sx={{ pt:1 }}>
          <EChart option={option} style={{ height:'72vh' }} />
        </DialogContent>
      </Dialog>
    </>
  )
}

/* ── Trend period config ─────────────────────────────────────────── */
const TREND_PERIODS = [
  { label:'7D',  days:7  },
  { label:'30D', days:30 },
  { label:'MTD', days:-1 },
  { label:'YTD', days:-2 },
] as const

type TrendPeriod = typeof TREND_PERIODS[number]['label']

/* ── Main component ─────────────────────────────────────────────── */
export default function Overview() {
  const [trendPeriod, setTrendPeriod] = useState<TrendPeriod>('30D')
  const [trendOpen,   setTrendOpen  ] = useState(false)
  const trendChartRef = useRef<EChartHandle>(null)
  const { productCodeField } = useAppSettings()

  const exportTrendPng = () => {
    const inst = trendChartRef.current?.getEchartsInstance()
    if (!inst) return
    const url = inst.getDataURL({ type:'png', backgroundColor:'#fff', pixelRatio:2 })
    const a = document.createElement('a')
    a.href = url; a.download = 'Sales_Trend.png'; a.click()
  }

  /* ── KPI query ─────────────────────────────────────────────── */
  const { data: kpi, isLoading: kpiLoading, error } = useQuery<OverviewData>({
    queryKey: ['overview'],
    queryFn:  () => axios.get('/api/sales/overview').then(r => r.data),
    refetchInterval: 60_000,
  })

  /* ── Trend date range ──────────────────────────────────────── */
  const { tFrom, tTo } = useMemo(() => {
    const tTo   = format(new Date(), 'yyyy-MM-dd')
    const tFrom = trendPeriod === '7D'  ? format(subDays(new Date(), 6),   'yyyy-MM-dd')
                : trendPeriod === '30D' ? format(subDays(new Date(), 29),  'yyyy-MM-dd')
                : trendPeriod === 'MTD' ? format(startOfMonth(new Date()), 'yyyy-MM-dd')
                :                         format(startOfYear(new Date()),  'yyyy-MM-dd')
    return { tFrom, tTo }
  }, [trendPeriod])

  /* ── Trend query ───────────────────────────────────────────── */
  const { data: trendData, isLoading: trendLoading } = useQuery({
    queryKey: ['trend-overview', tFrom, tTo],
    queryFn:  () => axios.get(`/api/sales/trend?date_from=${tFrom}&date_to=${tTo}`).then(r => r.data),
    refetchOnMount: 'always' as const,
    gcTime: 0,
    retry: false,
  })

  /* ── ECharts option ────────────────────────────────────────── */
  const chartOption = useMemo(() => {
    const rows: any[]   = trendData ?? []
    const labels        = rows.map(r => String(r.day ?? '').slice(5))
    const netSales      = rows.map(r => +(r.net_sales   ?? 0).toFixed(2))
    const invCount      = rows.map(r =>   r.sales_count ?? 0)
    const returnRates   = rows.map(r => r.sales_count > 0 ? +((r.return_count ?? 0) / r.sales_count * 100).toFixed(1) : 0)

    return {
      animation: true,
      // Legend centered at top — clear of both y-axis label areas
      legend: {
        left: 'center',
        top: 8,
        textStyle:  { color:'#475569', fontSize:11, fontWeight:600 },
        itemWidth:  14,
        itemHeight: 8,
        itemGap:    20,
        icon: 'roundRect',
      },
      // Grid — enough room left+right for two y-axes, top for centred legend
      grid: { top:44, right:72, bottom:36, left:74 },
      tooltip: {
        trigger: 'axis',
        backgroundColor: '#fff',
        borderColor: '#e9e4ff',
        borderWidth: 1,
        textStyle: { color:'#0f172a', fontSize:12 },
        axisPointer: { type:'cross', lineStyle:{ color:'#ede9fe', width:1 } },
        formatter: (params: any[]) => {
          const day   = params[0]?.axisValue ?? ''
          const lines = params.map((p: any) => {
            const isRet = p.seriesName === 'Return Rate %'
            const isInv = p.seriesName === 'Invoices'
            let valStr: string
            if (isRet)       valStr = `${p.value}%`
            else if (isInv)  valStr = String(p.value)
            else              valStr = (+p.value).toLocaleString('en-US', { maximumFractionDigits:0 })
            return `<div style="display:flex;align-items:center;gap:6px;margin-top:3px;">
              <span style="width:10px;height:4px;border-radius:2px;background:${p.color};display:inline-block;"></span>
              <span style="color:#64748b;font-size:11px">${p.seriesName}</span>
              <span style="font-weight:700;margin-left:auto;padding-left:16px">${valStr}</span>
            </div>`
          }).join('')
          return `<div style="min-width:195px;padding:4px 2px">
            <div style="font-weight:700;color:#0f172a;margin-bottom:5px;font-size:12px">${day}</div>
            ${lines}
          </div>`
        },
      },
      xAxis: {
        type: 'category', data: labels, boundaryGap: false,
        axisLine:  { lineStyle: { color:'#e9e4ff' } },
        axisTick:  { show: false },
        axisLabel: { color:'#94a3b8', fontSize:11, margin:8 },
      },
      yAxis: [
        {
          // LEFT — Net Sales
          type: 'value',
          axisLabel: {
            color:'#94a3b8', fontSize:10,
            formatter: (v: number) => v >= 1000 ? `${(v/1000).toFixed(0)}K` : `${v}`,
          },
          splitLine: { lineStyle:{ color:'#f1f5f9', type:'dashed' } },
          axisLine:  { show: false },
          axisTick:  { show: false },
        },
        {
          // RIGHT — Invoices (integer count)
          type: 'value',
          position: 'right',
          axisLabel: { color: C_INV, fontSize:10 },
          splitLine: { show: false },
          axisLine:  { show: false },
          axisTick:  { show: false },
        },
        {
          // RIGHT — Return Rate % (offset so it doesn't clash with Invoices axis)
          type: 'value',
          position: 'right',
          offset: 48,
          min: 0,
          axisLabel: {
            color: C_RET, fontSize:10,
            formatter: (v: number) => `${v}%`,
          },
          splitLine: { show: false },
          axisLine:  { show: false },
          axisTick:  { show: false },
        },
      ],
      series: [
        {
          name: 'Net Sales',
          type: 'line',
          yAxisIndex: 0,
          data: netSales,
          smooth: 0.4,
          showSymbol: false,
          symbolSize: 6,
          emphasis: { showSymbol: true, scale: 1.5 },
          lineStyle: { color: ACCENT, width: 2.5 },
          areaStyle: {
            color: {
              type:'linear', x:0, y:0, x2:0, y2:1,
              colorStops:[
                { offset:0, color:'rgba(124,58,237,0.20)' },
                { offset:1, color:'rgba(124,58,237,0.01)' },
              ],
            },
          },
          itemStyle: { color: ACCENT },
        },
        {
          name: 'Invoices',
          type: 'bar',
          yAxisIndex: 1,
          data: invCount,
          barMaxWidth: 16,
          itemStyle: {
            color: {
              type:'linear', x:0, y:0, x2:0, y2:1,
              colorStops:[
                { offset:0, color:'rgba(6,182,212,0.50)' },
                { offset:1, color:'rgba(6,182,212,0.05)' },
              ],
            },
            borderRadius:[3,3,0,0],
          },
        },
        {
          name: 'Return Rate %',
          type: 'line',
          yAxisIndex: 2,
          data: returnRates,
          smooth: 0.4,
          showSymbol: false,
          symbolSize: 5,
          emphasis: { showSymbol: true, scale: 1.5 },
          lineStyle: { color: C_RET, width: 2, type: 'dashed' },
          itemStyle: { color: C_RET },
        },
      ],
    }
  }, [trendData])

  /* ── Mini-chart date ranges ────────────────────────────────── */
  const { mini7dFrom, miniMtdFrom, miniMtdTo, miniLmtdFrom, miniLmtdTo } = useMemo(() => {
    const today    = new Date()
    const mtdFrom  = format(startOfMonth(today), 'yyyy-MM-dd')
    const todayStr = format(today, 'yyyy-MM-dd')
    const lmStart  = subMonths(startOfMonth(today), 1)
    const lmSame   = subMonths(today, 1)
    return {
      mini7dFrom:   format(subDays(today, 6), 'yyyy-MM-dd'),
      miniMtdFrom:  mtdFrom,
      miniMtdTo:    todayStr,
      miniLmtdFrom: format(lmStart, 'yyyy-MM-dd'),
      miniLmtdTo:   format(lmSame,  'yyyy-MM-dd'),
    }
  }, [])

  /* ── Top Products (7D) ─────────────────────────────────────── */
  const { data: productsData, isLoading: productsLoading } = useQuery({
    queryKey: ['overview-products-7d', mini7dFrom],
    queryFn:  () => axios.get(
      `/api/sales/products?date_from=${mini7dFrom}&date_to=${miniMtdTo}&group_by=item&limit=10`
    ).then(r => r.data),
    refetchOnMount: 'always' as const, gcTime: 0, retry: false,
  })

  /* ── MTD trend + LMTD trend (for cumulative line) ─────────── */
  const { data: mtdTrend } = useQuery({
    queryKey: ['overview-mtd-trend', miniMtdFrom, miniMtdTo],
    queryFn:  () => axios.get(`/api/sales/trend?date_from=${miniMtdFrom}&date_to=${miniMtdTo}`).then(r => r.data),
    refetchOnMount: 'always' as const, gcTime: 0, retry: false,
  })
  const { data: lmtdTrend } = useQuery({
    queryKey: ['overview-lmtd-trend', miniLmtdFrom, miniLmtdTo],
    queryFn:  () => axios.get(`/api/sales/trend?date_from=${miniLmtdFrom}&date_to=${miniLmtdTo}`).then(r => r.data),
    refetchOnMount: 'always' as const, gcTime: 0, retry: false,
  })

  /* ── Top Associates (MTD) ───────────────────────────────────── */
  const { data: assocMtd } = useQuery({
    queryKey: ['overview-assoc-mtd', miniMtdFrom, miniMtdTo],
    queryFn:  () => axios.get(
      `/api/sales/employees?date_from=${miniMtdFrom}&date_to=${miniMtdTo}&limit=8`
    ).then(r => r.data),
    refetchOnMount: 'always' as const, gcTime: 0, retry: false,
  })

  /* ── Chart: Top Products horizontal bar ────────────────────── */
  const productsOpt = useMemo(() => {
    const rows = ((productsData ?? []) as any[]).slice(0, 10).reverse()
    const names  = rows.map(r => {
      // DuckDB returns lowercase column names; check both cases for safety
      const code = r[productCodeField]
                ?? r[productCodeField.toUpperCase()]
                ?? r['alu'] ?? r['ALU'] ?? ''
      const desc = (r.description1 ?? r.DESCRIPTION1 ?? '').slice(0, 22)
      return code ? `${String(code)} | ${desc}` : (desc || '(no name)')
    })
    const revenues = rows.map(r => +(r.revenue ?? 0))
    return {
      grid: { top:8, right:72, bottom:8, left:12, containLabel:true },
      tooltip: {
        trigger:'axis',
        formatter:(p:any[]) => {
          const row = rows[p[0].dataIndex] ?? {}
          const rev = (+p[0].value).toLocaleString('en-US', { maximumFractionDigits:0 })
          return `<b>${p[0].name}</b><br/>Revenue: <b>${rev}</b><br/>GP: ${row.gp_pct ?? 0}%&nbsp;&nbsp;Qty: ${(+(row.qty ?? 0)).toLocaleString()}`
        },
      },
      xAxis:{ type:'value', axisLabel:{ color:'#94a3b8', fontSize:10, formatter:(v:number)=>v>=1000?`${(v/1000).toFixed(0)}K`:`${v}` }, splitLine:{ lineStyle:{ color:'#f1f5f9' } } },
      yAxis:{ type:'category', data:names, axisLabel:{ color:'#374151', fontSize:9 } },
      series:[{
        type:'bar', data:revenues, barMaxWidth:16,
        itemStyle:{ borderRadius:[0,4,4,0], color:{ type:'linear', x:0,y:0,x2:1,y2:0, colorStops:[{offset:0,color:'rgba(16,185,129,0.35)'},{offset:1,color:'#10b981'}] } },
        label:{ show:true, position:'right', color:'#64748b', fontSize:9, formatter:(p:any)=>`${(+p.value).toLocaleString('en-US',{maximumFractionDigits:0})}` },
      }],
    }
  }, [productsData, productCodeField])

  /* ── Chart: MTD Cumulative vs Last Month ───────────────────── */
  const cumOpt = useMemo(() => {
    const curr: any[] = mtdTrend  ?? []
    const prev: any[] = lmtdTrend ?? []
    let rc = 0, rp = 0
    const currCum = curr.map(r => { rc += +(r.net_sales ?? 0); return +rc.toFixed(0) })
    const prevCum = prev.map(r => { rp += +(r.net_sales ?? 0); return +rp.toFixed(0) })
    const maxLen  = Math.max(currCum.length, prevCum.length)
    const days    = Array.from({ length: maxLen }, (_, i) => i + 1)
    return {
      grid:{ top:36, right:16, bottom:28, left:14, containLabel:true },
      legend:{ top:4, textStyle:{ color:'#475569', fontSize:10 }, itemWidth:12, itemHeight:8 },
      tooltip:{
        trigger:'axis',
        formatter:(p:any[]) =>
          `<b>Day ${p[0]?.axisValue}</b><br/>` +
          p.map((s:any) => `${s.marker}${s.seriesName}: <b>${(+s.value).toLocaleString('en-US',{maximumFractionDigits:0})}</b>`).join('<br/>'),
      },
      xAxis:{ type:'category', data:days, axisLabel:{ color:'#94a3b8', fontSize:10 } },
      yAxis:{ type:'value', axisLabel:{ color:'#94a3b8', fontSize:10, formatter:(v:number)=>v>=1000?`${(v/1000).toFixed(0)}K`:`${v}` }, splitLine:{ lineStyle:{ color:'#f1f5f9' } } },
      series:[
        {
          name:'This Month', type:'line', data:currCum, smooth:0.3, showSymbol:false,
          lineStyle:{ color:ACCENT, width:2.5 },
          areaStyle:{ color:{ type:'linear', x:0,y:0,x2:0,y2:1, colorStops:[{offset:0,color:'rgba(124,58,237,0.20)'},{offset:1,color:'rgba(124,58,237,0.0)'}] } },
          itemStyle:{ color:ACCENT },
        },
        {
          name:'Last Month', type:'line', data:prevCum, smooth:0.3, showSymbol:false,
          lineStyle:{ color:'#94a3b8', width:1.5, type:'dashed' as const },
          itemStyle:{ color:'#94a3b8' },
        },
      ],
    }
  }, [mtdTrend, lmtdTrend])

  /* ── Chart: Top Associates (MTD) horizontal bar ─────────────── */
  const assocOpt = useMemo(() => {
    const rows = ((assocMtd ?? []) as any[]).slice(0, 8).reverse()
    const names = rows.map(r => (r.employee_name ?? '?').slice(0, 22))
    const sales = rows.map(r => +(r.net_sales ?? 0))
    return {
      grid:{ top:8, right:72, bottom:8, left:12, containLabel:true },
      tooltip:{
        trigger:'axis',
        formatter:(p:any[]) => {
          const row = rows[p[0].dataIndex] ?? {}
          return `<b>${p[0].name}</b><br/>Net Sales: <b>${(+p[0].value).toLocaleString('en-US',{maximumFractionDigits:0})}</b><br/>Invoices: ${row.invoice_count ?? 0}`
        },
      },
      xAxis:{ type:'value', axisLabel:{ color:'#94a3b8', fontSize:10, formatter:(v:number)=>v>=1000?`${(v/1000).toFixed(0)}K`:`${v}` }, splitLine:{ lineStyle:{ color:'#f1f5f9' } } },
      yAxis:{ type:'category', data:names, axisLabel:{ color:'#374151', fontSize:10 } },
      series:[{
        type:'bar', data:sales, barMaxWidth:16,
        itemStyle:{ borderRadius:[0,4,4,0], color:{ type:'linear', x:0,y:0,x2:1,y2:0, colorStops:[{offset:0,color:'rgba(124,58,237,0.30)'},{offset:1,color:ACCENT}] } },
        label:{ show:true, position:'right', color:'#64748b', fontSize:9, formatter:(p:any)=>`${(+p.value).toLocaleString('en-US',{maximumFractionDigits:0})}` },
        markLine:{ silent:true, lineStyle:{ color:'#f59e0b', type:'dashed' as const, width:1 }, data:[{ type:'average', name:'Avg' }] },
      }],
    }
  }, [assocMtd])

  const todayStr = new Date().toLocaleDateString('en-GB', {
    weekday:'long', day:'numeric', month:'long', year:'numeric',
  })

  return (
    <Box sx={{ p:3, display:'flex', flexDirection:'column', gap:3 }}>

      {/* ── Page header ── */}
      <Box>
        <Typography variant="h6" sx={{ fontWeight:800, color:'#0f172a', letterSpacing:'-0.3px' }}>
          Sales Overview
        </Typography>
        <Typography sx={{ fontSize:13, color:'#94a3b8', mt:0.3 }}>
          {todayStr}
        </Typography>
      </Box>

      {error && (
        <Alert severity="warning" sx={{ borderRadius:2 }}>
          No data in local model yet. Go to Settings and run an initial load first.
        </Alert>
      )}

      {/* ── KPI cards ── */}
      <Box sx={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:2 }}>
        <KpiCard label="Today"          dot={ACCENT}    data={kpi?.today}     prevData={kpi?.yesterday} prevLabel="Yesterday"  loading={kpiLoading}/>
        <KpiCard label="Yesterday"      dot={C_INV}     data={kpi?.yesterday} prevData={kpi?.prev_day}  prevLabel="2 days ago" loading={kpiLoading}/>
        <KpiCard label="Month to Date"  dot="#f59e0b"   data={kpi?.mtd}       prevData={kpi?.lmtd}      prevLabel="Last Month" loading={kpiLoading}/>
        <KpiCard label="Year to Date"   dot="#10b981"   data={kpi?.ytd}       prevData={kpi?.lytd}      prevLabel="Last Year"  loading={kpiLoading}/>
      </Box>

      {/* ── Mini charts: Top Products · MTD Cumulative · Top Associates ── */}
      <Box sx={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:2 }}>
        <MiniChart
          title="Top Products (7D)"
          subtitle={`Revenue by item · ${productCodeField.toUpperCase()} | Description`}
          option={productsOpt}
          loading={productsLoading}
        />
        <MiniChart
          title="MTD vs Last Month"
          subtitle="Cumulative net sales · day by day"
          option={cumOpt}
        />
        <MiniChart
          title="Top Associates (MTD)"
          subtitle="Net sales · month to date"
          option={assocOpt}
        />
      </Box>

      {/* ── Sales Trend ── */}
      <Card elevation={0} sx={{ border:'1px solid #e9e4ff', borderRadius:2.5 }}>
        <CardContent sx={{ p:2.5, '&:last-child':{ pb:2.5 } }}>

          <Box sx={{ display:'flex', alignItems:'center', justifyContent:'space-between', mb:2 }}>
            <Box>
              <Typography sx={{ fontWeight:800, color:'#0f172a', fontSize:15 }}>
                Sales Trend
              </Typography>
              <Typography sx={{ fontSize:12, color:'#94a3b8', mt:0.2 }}>
                Net sales · invoices · return rate by day
              </Typography>
            </Box>

            {/* Right side: period selector + toolbar */}
            <Box sx={{ display:'flex', alignItems:'center', gap:1 }}>
              <Box sx={{ display:'flex', gap:0.75, p:0.5, bgcolor:'#f8f7ff', borderRadius:2 }}>
                {TREND_PERIODS.map(tp => (
                  <Chip key={tp.label} label={tp.label} size="small"
                    onClick={() => setTrendPeriod(tp.label)}
                    sx={{
                      fontWeight:700, fontSize:12, height:28, px:0.5,
                      transition:'all .18s ease',
                      bgcolor: trendPeriod===tp.label ? ACCENT      : 'transparent',
                      color:   trendPeriod===tp.label ? '#fff'      : '#64748b',
                      boxShadow: trendPeriod===tp.label ? '0 2px 8px rgba(124,58,237,.35)' : 'none',
                      '&:hover':{ bgcolor: trendPeriod===tp.label ? ACCENT2 : '#ede9fe' },
                    }}
                  />
                ))}
              </Box>
              {/* Fullscreen / Export toolbar */}
              <Box sx={{ display:'flex', gap:0.25, opacity:0.45, transition:'opacity .15s', '&:hover':{ opacity:1 } }}>
                <Tooltip title="Export PNG" placement="top">
                  <IconButton size="small" onClick={exportTrendPng} sx={{ p:0.5 }}>
                    <FileDownloadIcon sx={{ fontSize:15, color:'#64748b' }} />
                  </IconButton>
                </Tooltip>
                <Tooltip title="Fullscreen" placement="top">
                  <IconButton size="small" onClick={() => setTrendOpen(true)} sx={{ p:0.5 }}>
                    <FullscreenIcon sx={{ fontSize:15, color:'#64748b' }} />
                  </IconButton>
                </Tooltip>
              </Box>
            </Box>
          </Box>

          {trendLoading ? (
            <Skeleton variant="rectangular" height={300} sx={{ borderRadius:2 }}/>
          ) : (
            <EChart ref={trendChartRef} option={chartOption} style={{ height:320 }} />
          )}

        </CardContent>
      </Card>

      {/* Sales Trend fullscreen dialog */}
      <Dialog open={trendOpen} onClose={() => setTrendOpen(false)} maxWidth="xl" fullWidth
        PaperProps={{ sx:{ borderRadius:3, m:2 } }}>
        <DialogTitle sx={{ fontWeight:800, color:'#0f172a', fontSize:16, pr:6, pb:0.5 }}>
          Sales Trend
          <Typography sx={{ fontSize:12, color:'#94a3b8', mt:0.3 }}>
            Net sales · invoices · return rate by day
          </Typography>
        </DialogTitle>
        <IconButton onClick={() => setTrendOpen(false)}
          sx={{ position:'absolute', right:12, top:12, color:'#64748b' }}>
          <CloseIcon />
        </IconButton>
        <DialogContent sx={{ pt:1 }}>
          <EChart option={chartOption} style={{ height:'72vh' }} />
        </DialogContent>
      </Dialog>

    </Box>
  )
}
