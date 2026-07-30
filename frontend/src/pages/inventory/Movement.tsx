/**
 * Inventory — Stock Movement
 * Velocity & sell-through from FACT_SALES_ITEMS (date-filtered)
 * KPIs · Daily Trend · Dept Velocity · ABC Pareto · AG Grid
 */
import { useMemo, useRef, useState, useCallback } from 'react'
import { tr, trf, trCols } from '../../i18n'
import TitleLoader from '../../components/TitleLoader'
import { gmColor as gmColorOf, dohColor } from '../../utils/thresholds'
import { money } from '../../utils/formatters'
import { useAppSettings } from '../../context/AppSettings'
import {
  Box, Typography, Chip, Dialog, DialogTitle, DialogContent,
  IconButton, Tooltip, Autocomplete, TextField,
} from '@mui/material'
import FullscreenIcon     from '@mui/icons-material/Fullscreen'
import FullscreenExitIcon from '@mui/icons-material/FullscreenExit'
import DownloadIcon       from '@mui/icons-material/Download'
import { useQuery }       from '@tanstack/react-query'
import { format, subDays } from 'date-fns'
import axios              from 'axios'
import { AgGridReact }    from 'ag-grid-react'
import type { ColDef }    from 'ag-grid-community'
import 'ag-grid-community/styles/ag-grid.css'
import 'ag-grid-community/styles/ag-theme-alpine.css'
import EChart, { type EChartHandle } from '../../components/EChart'
import KpiCard                        from '../../components/KpiCard'
import { itemFieldValue }             from '../../components/DataSlicer'
import { noRowsOverlay }               from '../../utils/gridOverlay'
import { gridLocaleText } from '../../utils/gridLocale'
import GridExportBar                  from '../../components/GridExportBar'
import { useGridColumnState }         from '../../hooks/useGridColumnState'

// ── Colours ──────────────────────────────────────────────────────────────────
const C_PURPLE = '#7c3aed'
const C_SLATE  = '#64748b'
const C_GREEN  = '#059669'
const C_AMBER  = '#d97706'
const C_ROSE   = '#e11d48'
const C_CYAN   = '#0891b2'
const DEPT_COLORS = [
  '#7c3aed','#0891b2','#059669','#d97706','#e11d48',
  '#8b5cf6','#06b6d4','#10b981','#f59e0b','#f43f5e',
]

const PERIODS: { label: string; days: number }[] = [
  { label: '7D',  days: 7  },
  { label: '30D', days: 30 },
  { label: 'MTD', days: new Date().getDate() },
  { label: 'YTD', days: Math.floor((Date.now() - new Date(new Date().getFullYear(), 0, 1).getTime()) / 86_400_000) + 1 },
]

function num(v: any) {
  const n = +(v ?? 0)
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (Math.abs(n) >= 1_000)     return `${(n / 1_000).toFixed(0)}K`
  return n.toLocaleString('en-US', { maximumFractionDigits: 0 })
}

// ── Chart Card ───────────────────────────────────────────────────────────────
function ChartCard({ title, subtitle, option, height = 300 }: {
  title: string; subtitle?: string; option?: any; height?: number
}) {
  const ref = useRef<EChartHandle>(null)
  const [fs, setFs] = useState(false)

  const download = useCallback(() => {
    const inst = ref.current?.getEchartsInstance()
    if (!inst) return
    const url  = inst.getDataURL({ type: 'png', pixelRatio: 2 })
    const a    = document.createElement('a')
    a.href     = url
    a.download = `${title.replace(/\s+/g, '_')}.png`
    a.click()
  }, [title])

  return (
    <>
      <Box sx={{ bgcolor: 'var(--rt-surface)', borderRadius: 2.5, border: '1px solid var(--rt-border)',
                 boxShadow: '0 1px 6px rgba(124,58,237,0.06)', p: 2, display: 'flex',
                 flexDirection: 'column', gap: 1 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <Box>
            <Typography sx={{ fontSize: 13, fontWeight: 700, color: 'var(--rt-text)' }}>{tr(title)}</Typography>
            {subtitle && <Typography sx={{ fontSize: 11, color: C_SLATE }}>{tr(subtitle)}</Typography>}
          </Box>
          <Box sx={{ display: 'flex', gap: 0.5 }}>
            <Tooltip title={tr('Download PNG')}><IconButton size="small" onClick={download}><DownloadIcon sx={{ fontSize: 16 }} /></IconButton></Tooltip>
            <Tooltip title={tr('Fullscreen')}><IconButton size="small" onClick={() => setFs(true)}><FullscreenIcon sx={{ fontSize: 16 }} /></IconButton></Tooltip>
          </Box>
        </Box>
        {option && <EChart ref={ref} option={option} style={{ height }} />}
      </Box>

      <Dialog open={fs} onClose={() => setFs(false)} maxWidth="xl" fullWidth
        PaperProps={{ sx: { borderRadius: 3, height: '90vh' } }}>
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', pb: 1 }}>
          <Typography sx={{ fontWeight: 700 }}>{title}</Typography>
          <Box sx={{ display: 'flex', gap: 0.5 }}>
            <Tooltip title={tr('Download PNG')}><IconButton size="small" onClick={download}><DownloadIcon /></IconButton></Tooltip>
            <Tooltip title={tr('Close')}><IconButton size="small" onClick={() => setFs(false)}><FullscreenExitIcon /></IconButton></Tooltip>
          </Box>
        </DialogTitle>
        <DialogContent sx={{ p: 2 }}>
          {option && <EChart ref={ref} option={option} style={{ height: '100%' }} />}
        </DialogContent>
      </Dialog>
    </>
  )
}

// ── GP% cell style ────────────────────────────────────────────────────────────
function gpStyle(p: any) {
  const v = +(p.value ?? 0)
  return {
    color: gmColorOf(v),
    fontWeight: 700,
    backgroundColor: v >= 30 ? 'rgba(5,150,105,0.10)' : v >= 10 ? 'rgba(217,119,6,0.10)' : 'rgba(225,29,72,0.10)',
    display: 'flex', alignItems: 'center',
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────
export default function InventoryMovement() {
  // The configured item identifier (Settings → Product Code Field). Ask
  // `itemId` (field/column/label) — never `.toUpperCase()` of the raw setting,
  // which produced a bogus "DESCRIPTION" column under the third setting.
  const { itemId } = useAppSettings()
  const today    = new Date()
  const [period, setPeriod] = useState(30)
  const [from,   setFrom  ] = useState(format(subDays(today, 29), 'yyyy-MM-dd'))
  const [to,     setTo    ] = useState(format(today, 'yyyy-MM-dd'))
  const [stores, setStores] = useState<string[]>([])
  const [view,   setView  ] = useState<'dept'|'dcs'|'vendor'|'store'|'item'>('dept')

  const gridRef = useRef<AgGridReact>(null)
  const { onGridReady: onColGridReady, onColumnChanged, resetColumns } = useGridColumnState('inv-movement')

  const { data: storeList = [] } = useQuery<string[]>({
    queryKey: ['inv-stores-list'],
    queryFn:  () => axios.get('/api/sales/stores-list').then(r => r.data),
    gcTime: 3_600_000, refetchOnMount: false,
  })

  const applyPeriod = (days: number) => {
    setPeriod(days)
    setFrom(format(subDays(today, days - 1), 'yyyy-MM-dd'))
    setTo(format(today, 'yyyy-MM-dd'))
  }

  const storeQS  = stores.length ? `&stores=${encodeURIComponent(stores.join(','))}` : ''
  const dateQS   = `date_from=${from}&date_to=${to}`
  const qKey     = [from, to, storeQS]

  const { data: kpiRaw } = useQuery({
    queryKey: ['mv-kpi', ...qKey],
    queryFn:  () => axios.get(`/api/inventory/movement?${dateQS}${storeQS}`).then(r => r.data),
    gcTime: 1_800_000, refetchOnMount: 'always',
  })
  const kpi = {
    skus:      kpiRaw?.sku_count      ?? 0,
    soldQty:   kpiRaw?.sold_qty       ?? 0,
    returnQty: kpiRaw?.return_qty     ?? 0,
    netQty:    kpiRaw?.net_qty        ?? 0,
    revenue:   kpiRaw?.revenue        ?? 0,
    cogs:      kpiRaw?.cogs           ?? 0,
    gmPct:     kpiRaw?.gm_pct         ?? 0,
    velocity:  kpiRaw?.daily_velocity ?? 0,
  }

  const { data: trendData = [] } = useQuery({
    queryKey: ['mv-trend', ...qKey],
    queryFn:  () => axios.get(`/api/inventory/trend?${dateQS}${storeQS}`).then(r => r.data),
    gcTime: 1_800_000,
  })

  const { data: deptData = [] } = useQuery({
    queryKey: ['mv-dept', ...qKey],
    queryFn:  () => axios.get(`/api/inventory/movement-by?group_by=dept&${dateQS}${storeQS}`).then(r => r.data),
    gcTime: 1_800_000,
  })

  const { data: tableData = [] } = useQuery({
    queryKey: ['mv-table', view, ...qKey],
    queryFn:  () => axios.get(`/api/inventory/movement-by?group_by=${view}&${dateQS}${storeQS}`).then(r => r.data),  // no limit — grid paginates
    gcTime: 1_800_000, refetchOnMount: 'always',
  })

  // ── Trend line option ─────────────────────────────────────────────────────
  const trendOpt = useMemo(() => {
    const rows  = trendData as any[]
    const dates = rows.map(r => r.post_date?.slice(0, 10) ?? '')
    const sold  = rows.map(r => +(r.sold_qty   ?? 0))
    const ret   = rows.map(r => +(r.return_qty ?? 0))
    return {
      tooltip: { trigger: 'axis', axisPointer: { type: 'cross' } },
      legend: { top: 0, right: 0, textStyle: { fontSize: 11 } },
      grid: { top: 28, right: 12, bottom: 36, left: 8, containLabel: true },
      xAxis: { type: 'category', data: dates, axisLabel: { color: C_SLATE, fontSize: 9, rotate: dates.length > 20 ? 30 : 0 } },
      yAxis: { type: 'value', axisLabel: { color: C_SLATE, fontSize: 10 }, splitLine: { lineStyle: { color: '#f1f5f9' } } },
      series: [
        {
          name: tr('Units Sold'), type: 'line', data: sold, smooth: true,
          lineStyle: { color: C_PURPLE, width: 2 },
          areaStyle: { color: { type: 'linear', x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: 'rgba(124,58,237,0.18)' }, { offset: 1, color: 'rgba(124,58,237,0.02)' }] } },
          itemStyle: { color: C_PURPLE }, symbol: 'none',
        },
        {
          name: tr('Returns'), type: 'bar', data: ret, barMaxWidth: 6,
          itemStyle: { color: 'rgba(225,29,72,0.55)', borderRadius: [2, 2, 0, 0] },
        },
      ],
    }
  }, [trendData])

  // ── Dept velocity bar ──────────────────────────────────────────────────────
  const deptVelOpt = useMemo(() => {
    const rows  = (deptData as any[]).slice(0, 10).reverse()
    const names = rows.map(r => r.department ?? '(Unknown)')
    const revs  = rows.map(r => +(r.revenue   ?? 0))
    return {
      grid: { top: 8, right: 120, bottom: 8, left: 8, containLabel: true },
      tooltip: {
        trigger: 'axis', axisPointer: { type: 'shadow' },
        formatter: (p: any[]) => {
          const r = rows[p[0]?.dataIndex] ?? {}
          return `<b>${p[0].name}</b><br/>${tr('Revenue')}: <b>${num(r.revenue)}</b><br/>${tr('Units Sold')}: ${num(r.sold_qty)}<br/>${tr('GM%')}: <b>${r.gm_pct ?? 0}%</b>`
        },
      },
      xAxis: { type: 'value', axisLabel: { color: C_SLATE, fontSize: 10, formatter: (v: number) => num(v) }, splitLine: { lineStyle: { color: '#f1f5f9' } } },
      yAxis: { type: 'category', data: names, axisLabel: { color: '#374151', fontSize: 11 } },
      series: [{
        type: 'bar', data: revs, barMaxWidth: 18,
        itemStyle: {
          borderRadius: [0, 4, 4, 0],
          color: (p: any) => DEPT_COLORS[p.dataIndex % 10],
        },
        label: {
          show: true, position: 'right', fontSize: 10,
          formatter: (p: any) => {
            const r = rows[p.dataIndex] ?? {}
            return `{val|${num(p.value)}}  {gp|GM:${r.gm_pct ?? 0}%}`
          },
          rich: { val: { color: '#475569', fontSize: 10 }, gp: { color: '#065f46', fontSize: 10, fontWeight: 700 } },
        },
      }],
    }
  }, [deptData])

  // ── ABC Pareto chart ──────────────────────────────────────────────────────
  const paretoOpt = useMemo(() => {
    const rows = (deptData as any[])
    if (!rows.length) return {}
    const sorted = [...rows].sort((a, b) => b.revenue - a.revenue)
    const total  = sorted.reduce((s, r) => s + +(r.revenue ?? 0), 0)
    let cum = 0
    const names    = sorted.map(r => r.department ?? '(Unknown)')
    const revs     = sorted.map(r => +(r.revenue ?? 0))
    const cumPct   = sorted.map(r => { cum += +(r.revenue ?? 0); return total > 0 ? +((cum / total) * 100).toFixed(1) : 0 })
    return {
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
      // legend centred + no axis names: they collided with the legend and the
      // % labels in the top-right corner
      legend: { top: 0, left: 'center', textStyle: { fontSize: 11 } },
      grid: { top: 34, right: 48, bottom: 36, left: 8, containLabel: true },
      xAxis: { type: 'category', data: names, axisLabel: { color: C_SLATE, fontSize: 10, rotate: 20, interval: 0 } },
      yAxis: [
        { type: 'value', axisLabel: { color: C_SLATE, fontSize: 10, formatter: (v: number) => num(v) } },
        { type: 'value', max: 100, axisLabel: { color: C_CYAN, fontSize: 10, formatter: (v: number) => `${v}%` } },
      ],
      series: [
        { name: tr('Revenue'), type: 'bar', data: revs, barMaxWidth: 30,
          itemStyle: { color: { type: 'linear', x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: C_PURPLE }, { offset: 1, color: 'rgba(124,58,237,0.3)' }] }, borderRadius: [4, 4, 0, 0] } },
        { name: tr('Cumulative %'), type: 'line', yAxisIndex: 1, data: cumPct, smooth: false,
          lineStyle: { color: C_CYAN, width: 2, type: 'dashed' },
          itemStyle: { color: C_CYAN }, symbol: 'circle', symbolSize: 6,
          markLine: { silent: true, lineStyle: { color: C_AMBER, type: 'dashed' }, data: [{ yAxis: 80, name: '80%' }],
                      label: { formatter: '80%', color: C_AMBER, position: 'insideStartTop' } } },
      ],
    }
  }, [deptData])

  // ── AG Grid columns ───────────────────────────────────────────────────────
  const tableCols = useMemo<ColDef[]>(() => {
    const rows    = (tableData as any[])
    const maxRev  = rows.length ? Math.max(...rows.map(r => +(r.revenue ?? 0))) : 1

    const revStyle = (p: any) => {
      const ratio = maxRev > 0 ? Math.min((+(p.value ?? 0)) / maxRev, 1) : 0
      const alpha = (0.06 + ratio * 0.30).toFixed(2)
      return { backgroundColor: `rgba(124,58,237,${alpha})`, display: 'flex', alignItems: 'center', fontWeight: ratio > 0.7 ? 600 : 400 }
    }

    const rankCol: ColDef = {
      headerName: '#', width: 52, sortable: false, resizable: false, pinned: 'left',
      valueGetter: (p: any) => (p.node?.rowIndex ?? 0) + 1,
      cellStyle: { color: C_SLATE, fontSize: 11, display: 'flex', alignItems: 'center' },
    }
    const soldCol:   ColDef = { field: 'sold_qty',   headerName: 'Sold',    width: 90,  type: 'numericColumn', valueFormatter: (p: any) => num(p.value) }
    const retCol:    ColDef = { field: 'return_qty', headerName: 'Returns', width: 90,  type: 'numericColumn', valueFormatter: (p: any) => num(p.value) }
    const revCol:    ColDef = { field: 'revenue',    headerName: 'Revenue', width: 120, type: 'numericColumn', valueFormatter: (p: any) => num(p.value), cellStyle: revStyle }
    const gpCol:     ColDef = { field: 'gm_pct',     headerName: 'GM %',   width:  85, type: 'numericColumn', valueFormatter: (p: any) => `${p.value ?? 0}%`, cellStyle: gpStyle }
    const skuCol:    ColDef = { field: 'sku_count',  headerName: 'SKUs',   width:  75, type: 'numericColumn' }

    if (view === 'item') return [
      rankCol,
      // The configured identifier column (endpoint returns ALU/UPC/DESCRIPTION1).
      // When Description is configured the Description column below IS the
      // identifier, so no duplicate code column is added. ALU fallback keeps
      // the cell non-blank when the configured field is NULL (UPC often is).
      ...(itemId.field !== 'description' ? [{
        field: itemId.column, headerName: itemId.label, width: 110, pinned: 'left',
        valueGetter: (p: any) => itemFieldValue(p.data, itemId.field),
        cellStyle: { fontFamily: 'monospace', color: C_PURPLE, display: 'flex', alignItems: 'center' },
      } as ColDef] : []),
      { field: 'DESCRIPTION1', headerName: 'Description', width: 240, pinned: 'left', cellStyle: { fontWeight: 600, display: 'flex', alignItems: 'center' } },
      { field: 'VEND_NAME',    headerName: 'Item Vendor', width: 150,
        headerTooltip: 'Vendor from the item master (catalog) — not necessarily the supplier purchased from' },
      { field: 'DCS_CODE',     headerName: 'DCS Code',    width: 100 },
      soldCol, retCol, revCol, gpCol,
    ]

    if (view === 'dcs') return [
      rankCol,
      { field: 'DCS_CODE',   headerName: 'DCS Code',   width: 100, pinned: 'left', cellStyle: { fontFamily: 'monospace', color: C_PURPLE, display: 'flex', alignItems: 'center' } },
      { field: 'department', headerName: 'Department', width: 150, cellStyle: { fontWeight: 600, display: 'flex', alignItems: 'center' } },
      { field: 'class',      headerName: 'Class',      width: 140 },
      { field: 'subclass',   headerName: 'Subclass',   width: 140 },
      skuCol, soldCol, retCol, revCol, gpCol,
    ]

    if (view === 'vendor') return [
      rankCol,
      { field: 'vendor', headerName: 'Item Vendor', width: 250, pinned: 'left',
        headerTooltip: 'Vendor from the item master (catalog) — not necessarily the supplier purchased from',
        cellStyle: { fontWeight: 600, display: 'flex', alignItems: 'center' } },
      skuCol, soldCol, retCol, revCol, gpCol,
    ]

    if (view === 'store') return [
      rankCol,
      { field: 'store_name', headerName: 'Store', width: 220, pinned: 'left', cellStyle: { fontWeight: 600, display: 'flex', alignItems: 'center' } },
      skuCol, soldCol, retCol, revCol,
    ]

    // dept
    return [
      rankCol,
      { field: 'department', headerName: 'Department', width: 220, pinned: 'left', cellStyle: { fontWeight: 700, color: 'var(--rt-text)', display: 'flex', alignItems: 'center' } },
      skuCol, soldCol, retCol, revCol, gpCol,
    ]
  }, [tableData, view, itemId.field, itemId.column, itemId.label])

  const gmColor = gmColorOf(kpi.gmPct)

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2.5 }}>

      {/* ── Header ── */}
      <Box sx={{ position: 'sticky', top: 0, zIndex: 10, bgcolor: 'var(--rt-surface)',
                 borderBottom: '1px solid var(--rt-border)', px: 3, pt: 3, pb: 2 }}>
        <Typography variant="h6" sx={{ fontWeight: 700, fontSize: 20, color: 'var(--rt-text)', letterSpacing: '-0.3px', mb: 0.3 }}>
          {tr('Stock Movement')}
          <TitleLoader />
        </Typography>
        <Typography sx={{ fontSize: 12, color: C_SLATE, mb: 1.5 }}>
          {from} — {to}
        </Typography>

        {/* Period chips */}
        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          {PERIODS.map(p => (
            <Chip key={p.label} label={tr(p.label)} size="small" onClick={() => applyPeriod(p.days)}
              sx={{ fontWeight: 700, cursor: 'pointer',
                    bgcolor: period === p.days ? C_PURPLE : 'transparent',
                    color: period === p.days ? '#fff' : 'var(--rt-text-2)',
                    border: `1px solid ${period === p.days ? C_PURPLE : 'var(--rt-border)'}` }} />
          ))}
          <Box className="rt-mobile-hide" sx={{ display:'flex', alignItems:'flex-end', gap:1 }}>
          <TextField size="small" label={tr('From')} type="date" value={from}
            onChange={e => { setFrom(e.target.value); setPeriod(0) }}
            sx={{ width: 130 }} inputProps={{ max: to }} />
          <Typography sx={{ color: C_SLATE, pb: 1 }}>→</Typography>
          <TextField size="small" label={tr('To')} type="date" value={to}
            onChange={e => { setTo(e.target.value); setPeriod(0) }}
            sx={{ width: 130 }} inputProps={{ min: from, max: format(today, 'yyyy-MM-dd') }} />
          </Box>

          {/* Store filter */}
          <Autocomplete
            multiple disableCloseOnSelect size="small"
            options={storeList} value={stores}
            onChange={(_, v) => setStores(v)}
            renderInput={params => <TextField {...params} label={tr('Stores')} placeholder={tr('All Stores')} size="small" sx={{ minWidth: 200 }} />}
            renderTags={(value, getTagProps) =>
              value.map((opt, i) => <Chip label={opt} size="small" {...getTagProps({ index: i })} key={opt} />)
            }
          />
        </Box>
      </Box>

      <Box sx={{ px: 3, display: 'flex', flexDirection: 'column', gap: 2.5, pb: 3 }}>

        {/* ── KPI Strip ── */}
        <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
          <KpiCard label="Active SKUs"    value={kpi.skus.toLocaleString()}      sub="distinct items moved" icon="ti-barcode" />
          <KpiCard label="Units Sold"     value={num(kpi.soldQty)}               sub={trf('{{n}} returned', { n: num(kpi.returnQty) })} icon="ti-shopping-cart" />
          <KpiCard label="Daily Velocity" value={`${kpi.velocity.toLocaleString()} u/d`} sub="units per day" color={C_CYAN} icon="ti-rocket" />
          <KpiCard label="Revenue"        value={money(kpi.revenue)}               sub="excl. tax" icon="ti-cash" />
          <KpiCard label="Gross Margin"   value={`${kpi.gmPct}%`}               sub={money(kpi.revenue - kpi.cogs)} color={gmColor} icon="ti-trending-up" />
        </Box>

        {/* ── Row 1: Trend + Pareto ── */}
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1.4fr 1fr' }, gap: 2 }}>
          <ChartCard title="Daily Movement Trend" subtitle="Units sold & returns over time" option={trendOpt} height={280} />
          <ChartCard title="Revenue by Department (ABC)" subtitle="Pareto · dashed line = 80% threshold" option={paretoOpt} height={280} />
        </Box>

        {/* ── Row 2: Dept Velocity ── */}
        <ChartCard title="Department Velocity" subtitle="Revenue · GM% annotated · sorted by revenue" option={deptVelOpt} height={260} />

        {/* ── Row 3: Detail Grid ── */}
        <Box sx={{ bgcolor: 'var(--rt-surface)', borderRadius: 2.5, border: '1px solid var(--rt-border)',
                   boxShadow: '0 1px 6px rgba(124,58,237,0.06)', p: 2 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1.5, gap: 1, flexWrap: 'wrap' }}>
            <Typography sx={{ fontWeight: 700, color: 'var(--rt-text)', fontSize: 13 }}>{tr('Movement Detail')}</Typography>
            <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
              {(['dept','dcs','vendor','store','item'] as const).map(v => (
                <Chip key={v} label={tr(v === 'dept' ? 'By Dept' : v === 'dcs' ? 'DCS' : v === 'vendor' ? 'By Item Vendor' : v === 'store' ? 'By Store' : 'By Item')}
                  size="small" onClick={() => setView(v)}
                  sx={{ fontWeight: 600, cursor: 'pointer',
                        bgcolor: view === v ? C_PURPLE : 'transparent',
                        color: view === v ? '#fff' : 'var(--rt-text-2)',
                        border: `1px solid ${view === v ? C_PURPLE : 'var(--rt-border)'}` }} />
              ))}
              <GridExportBar gridRef={gridRef} filename="inventory_movement" title="Stock Movement"
                view={view} filters={`${from} → ${to} · ${stores.length ? `${stores.length} ${tr('store(s)')}` : tr('All stores')}`}
                reportEndpoint="/api/inventory/movement-by"
                reportPeriod={({ 7:'7D', 30:'30D', 90:'90D' } as any)[period] ?? 'custom'}
                reportParams={{ group_by: view, date_from: from, date_to: to, ...(stores.length ? { stores: stores.join(',') } : {}) }}
                colDefs={tableCols} onResetColumns={resetColumns} />
            </Box>
          </Box>

          <div className="ag-theme-alpine" style={{ height: 460 }}>
            <AgGridReact localeText={gridLocaleText()}
              ref={gridRef}
              overlayNoRowsTemplate={noRowsOverlay()}
              rowData={tableData as any[]}
              columnDefs={trCols(tableCols as any[])}
              pagination paginationPageSize={25}
              defaultColDef={{ sortable: true, resizable: true, filter: true, wrapHeaderText: true, autoHeaderHeight: true, cellStyle: { display: 'flex', alignItems: 'center' } }}
              rowHeight={36}
              headerHeight={38}
              suppressCellFocus
              onGridReady={onColGridReady}
              onColumnMoved={onColumnChanged}
              onColumnResized={onColumnChanged}
              onColumnVisible={onColumnChanged}
            />
          </div>
        </Box>
      </Box>
    </Box>
  )
}
