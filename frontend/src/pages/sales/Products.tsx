/**
 * Products — Full professional redesign
 * KPI strip · Department treemap · DCS sunburst (drill-down) · Vendor ranking · AG Grid
 */
import { useState, useMemo, useRef } from 'react'
import {
  Box, Card, CardContent, Typography, Chip, Skeleton,
  Autocomplete, TextField, Divider, Button,
  Dialog, DialogContent, DialogTitle, IconButton, Tooltip,
} from '@mui/material'
import FullscreenIcon    from '@mui/icons-material/Fullscreen'
import FileDownloadIcon  from '@mui/icons-material/FileDownload'
import CloseIcon         from '@mui/icons-material/Close'
import CalendarMonthIcon from '@mui/icons-material/CalendarMonth'
import EChart, { type EChartHandle } from '../../components/EChart'
import KpiCard                        from '../../components/KpiCard'
import { useGridColumnState } from '../../hooks/useGridColumnState'
import GridExportBar      from '../../components/GridExportBar'
import { AgGridReact }   from 'ag-grid-react'
import type { ColDef }   from 'ag-grid-community'
import 'ag-grid-community/styles/ag-grid.css'
import 'ag-grid-community/styles/ag-theme-alpine.css'
import { useQuery }      from '@tanstack/react-query'
import axios             from 'axios'
import { format, subDays, startOfMonth, startOfYear } from 'date-fns'
import { num, money } from '../../utils/formatters'
import { tr, trCols } from '../../i18n'
import TitleLoader from '../../components/TitleLoader'
import { gmColor as gmColorOf, dohColor } from '../../utils/thresholds'
import { itemFieldsQS, itemFieldCols } from '../../utils/itemFields'
import { useAppSettings } from '../../context/AppSettings'
import { CHART_CATEGORICAL } from '../../theme/chartPalette'
import { noRowsOverlay } from '../../utils/gridOverlay'

/* ── Theme ─────────────────────────────────────────────────────────── */
const ACCENT  = '#7c3aed'
const ACCENT2 = '#6d28d9'
const C_GREEN = '#10b981'
const C_AMBER = '#f59e0b'
const C_ROSE  = '#f43f5e'
const C_SLATE = '#94a3b8'
const C_CYAN  = '#06b6d4'

// Unified with the shared brand palette so department colours match app-wide.
const DEPT_COLORS = CHART_CATEGORICAL

/* ── Period presets ─────────────────────────────────────────────────── */
const PERIODS = [
  { label: '7D',  days:  7 },
  { label: '30D', days: 30 },
  { label: 'MTD', days: -1 },
  { label: 'YTD', days: -2 },
] as const
type Period = typeof PERIODS[number]['label']

/* ── Views ──────────────────────────────────────────────────────────── */
const VIEWS = ['item', 'dcs', 'vendor', 'department'] as const
type View   = typeof VIEWS[number]
const VIEW_LABELS: Record<View, string> = {
  item: 'Top Items', dcs: 'DCS Breakdown', vendor: 'By Item Vendor', department: 'By Department',
}

/* ── AG Grid shared styles ──────────────────────────────────────────── */
const GRID_SX = {
  '& .ag-root-wrapper':     { borderRadius: 1.5 },
  '& .ag-header':           { bgcolor: '#f8f7ff !important', borderBottom: '1px solid #e9e4ff' },
  '& .ag-header-cell-text': { fontWeight: 700, color: '#374151', fontSize: 12 },
  '& .ag-row-even':         { bgcolor: '#ffffff' },
  '& .ag-row-odd':          { bgcolor: '#faf9ff' },
  '& .ag-row:hover':        { bgcolor: '#f3f0ff !important' },
}
const DEF_COL: ColDef = {
  sortable: true, resizable: true, filter: true,
  wrapHeaderText: true, autoHeaderHeight: true,
  cellStyle: { display: 'flex', alignItems: 'center' },
}

/* ── ChartCard — EChart wrapper with fullscreen + PNG export ─────────── */
function ChartCard({
  title, subtitle, option, height = 300, loading,
}: {
  title: string; subtitle?: string; option: any; height?: number; loading?: boolean
}) {
  const ref = useRef<EChartHandle>(null)
  const [open, setOpen] = useState(false)

  const exportPng = () => {
    const inst = ref.current?.getEchartsInstance()
    if (!inst) return
    const url = inst.getDataURL({ type: 'png', backgroundColor: '#fff', pixelRatio: 2 })
    const a = document.createElement('a')
    a.href = url; a.download = `${title.replace(/\W+/g, '_')}.png`; a.click()
  }

  return (
    <Card elevation={0} sx={{ border: '1px solid #e9e4ff', borderRadius: 2.5, display: 'flex', flexDirection: 'column' }}>
      <CardContent sx={{ p: 2.5, flex: 1, '&:last-child': { pb: 2.5 } }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 1.5 }}>
          <Box>
            <Typography sx={{ fontWeight: 800, color: '#0f172a', fontSize: 14 }}>{tr(title)}</Typography>
            {subtitle && (
              <Typography sx={{ fontSize: 11, color: C_SLATE, mt: 0.3 }}>{tr(subtitle)}</Typography>
            )}
          </Box>
          <Box sx={{ display: 'flex', gap: 0.25, opacity: 0.45, transition: 'opacity .15s', '&:hover': { opacity: 1 } }}>
            <Tooltip title="Export PNG" placement="top">
              <IconButton size="small" onClick={exportPng} sx={{ p: 0.5 }}>
                <FileDownloadIcon sx={{ fontSize: 15, color: '#64748b' }} />
              </IconButton>
            </Tooltip>
            <Tooltip title="Fullscreen" placement="top">
              <IconButton size="small" onClick={() => setOpen(true)} sx={{ p: 0.5 }}>
                <FullscreenIcon sx={{ fontSize: 15, color: '#64748b' }} />
              </IconButton>
            </Tooltip>
          </Box>
        </Box>

        {loading
          ? <Skeleton variant="rectangular" height={height} sx={{ borderRadius: 1.5 }} />
          : <EChart ref={ref} option={option} style={{ height }} />
        }
      </CardContent>

      <Dialog open={open} onClose={() => setOpen(false)} maxWidth="xl" fullWidth
        PaperProps={{ sx: { borderRadius: 3, m: 2 } }}>
        <DialogTitle sx={{ fontWeight: 800, color: '#0f172a', fontSize: 16, pr: 6, pb: 0.5 }}>
          {title}
          {subtitle && (
            <Typography sx={{ fontSize: 12, color: C_SLATE, mt: 0.3 }}>{subtitle}</Typography>
          )}
        </DialogTitle>
        <IconButton onClick={() => setOpen(false)}
          sx={{ position: 'absolute', right: 12, top: 12, color: '#64748b' }}>
          <CloseIcon />
        </IconButton>
        <DialogContent sx={{ pt: 1 }}>
          <EChart option={option} style={{ height: '72vh' }} />
        </DialogContent>
      </Dialog>
    </Card>
  )
}



/* ── GP% cell style helpers ─────────────────────────────────────────── */
const gpPctStyle = (p: any) => {
  const v = +(p.value ?? 0)
  return {
    color:           v >= 30 ? '#065f46' : v >= 10 ? '#78350f' : '#7f1d1d',
    fontWeight:      700,
    backgroundColor: v >= 30 ? '#d1fae5' : v >= 10 ? '#fef3c7' : '#fee2e2',
    display: 'flex', alignItems: 'center',
  }
}
const gpAbsStyle = (p: any) => ({
  color:      (+(p.value ?? 0)) >= 0 ? '#065f46' : '#991b1b',
  fontWeight: 500,
  display:    'flex', alignItems: 'center',
})

/* ── Main component ─────────────────────────────────────────────────── */
export default function Products() {
  const { productCodeField, itemFields } = useAppSettings()
  const todayStr = format(new Date(), 'yyyy-MM-dd')

  /* Date range state */
  const [period,         setPeriod        ] = useState<Period | null>('30D')
  const [customFrom,     setCustomFrom    ] = useState(format(subDays(new Date(), 29), 'yyyy-MM-dd'))
  const [customTo,       setCustomTo      ] = useState(todayStr)
  const [appliedFrom,    setAppliedFrom   ] = useState(format(subDays(new Date(), 29), 'yyyy-MM-dd'))
  const [appliedTo,      setAppliedTo     ] = useState(todayStr)
  const [selectedStores, setSelectedStores] = useState<string[]>([])
  const [view,           setView          ] = useState<View>('item')
  const { onGridReady: onColGridReady, onColumnChanged, resetColumns } = useGridColumnState(`sales-products-${view}`)
  const gridRef = useRef<AgGridReact>(null)

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

  const from      = appliedFrom
  const to        = appliedTo
  const storesKey = selectedStores.join(',')
  const storeQS   = storesKey ? `&stores=${encodeURIComponent(storesKey)}` : ''
  const qOpts     = { refetchOnMount: 'always' as const, gcTime: 0, retry: false }

  /* ── Queries ────────────────────────────────────────────────────── */
  const { data: storesList = [] } = useQuery({
    queryKey: ['stores-list'],
    queryFn:  () => axios.get('/api/sales/stores-list').then(r => r.data as string[]),
    staleTime: 3_600_000,
  })

  /* Department data — for treemap + KPIs */
  const { data: deptData,   isLoading: deptLoad   } = useQuery({
    queryKey: ['prod-dept',   from, to, storesKey],
    queryFn:  () => axios.get(`/api/sales/products?date_from=${from}&date_to=${to}&group_by=department&limit=20${storeQS}`).then(r => r.data),
    ...qOpts,
  })

  /* DCS data — for sunburst hierarchy (all rows, high limit) */
  const { data: dcsData,    isLoading: dcsLoad    } = useQuery({
    queryKey: ['prod-dcs',    from, to, storesKey],
    queryFn:  () => axios.get(`/api/sales/products?date_from=${from}&date_to=${to}&group_by=dcs&limit=500${storeQS}`).then(r => r.data),
    ...qOpts,
  })

  /* Vendor data — for bar chart */
  const { data: vendorData, isLoading: vendorLoad } = useQuery({
    queryKey: ['prod-vendor', from, to, storesKey],
    queryFn:  () => axios.get(`/api/sales/products?date_from=${from}&date_to=${to}&group_by=vendor&limit=15${storeQS}`).then(r => r.data),
    ...qOpts,
  })

  /* Table data — changes per view tab */
  const { data: tableData,  isLoading: tableLoad  } = useQuery({
    queryKey: ['prod-table',  from, to, view, storesKey, itemFields.join(',')],
    queryFn:  () => axios.get(`/api/sales/products?date_from=${from}&date_to=${to}&group_by=${view}${storeQS}${view === 'item' ? itemFieldsQS(itemFields) : ''}`).then(r => r.data),  // no limit — grid paginates
    ...qOpts,
  })

  /* ── KPIs from department totals ──────────────────────────────── */
  const kpi = useMemo(() => {
    const rows      = (deptData ?? []) as any[]
    const totalRev  = rows.reduce((s, r) => s + +(r.revenue ?? 0), 0)
    const totalGP   = rows.reduce((s, r) => s + +(r.gp  ?? 0), 0)
    const totalQty  = rows.reduce((s, r) => s + +(r.qty ?? 0), 0)
    const gpPct     = totalRev > 0 ? (totalGP / totalRev * 100) : 0
    const deptCount = rows.length
    return { totalRev, totalGP, gpPct, totalQty, deptCount }
  }, [deptData])

  /* ── Chart: Department Margin vs Volume (scatter / bubble matrix) ──
     Replaces the earlier "Top Departments by Revenue" bar — that repeated the
     revenue ranking the DCS treemap beside it already shows. This adds a NEW
     analytical dimension: each department is plotted by Revenue (x) vs GP% (y)
     with bubble size = units sold, coloured by GP tier. It reveals the
     high-revenue-but-low-margin vs high-margin-niche departments the treemap
     cannot convey. A dashed line marks the average GP%. ── */
  const deptOpt = useMemo(() => {
    const all = (deptData ?? []) as any[]
    if (!all.length) return {}

    const tierColor = (gp: number) => gp >= 30 ? C_GREEN : gp >= 10 ? C_AMBER : C_ROSE

    const qtys   = all.map(r => +(r.qty ?? 0))
    const maxQty = Math.max(1, ...qtys)

    // Weighted average GP% across departments (revenue-weighted) for the ref line
    const totRev = all.reduce((s, r) => s + +(r.revenue ?? 0), 0)
    const totGp  = all.reduce((s, r) => s + +(r.gp ?? 0), 0)
    const avgGp  = totRev > 0 ? (totGp / totRev * 100) : 0

    const data = all.map(r => {
      const gp = +(r.gp_pct ?? 0)
      return {
        value: [+(r.revenue ?? 0), gp],
        name:  r.name ?? '(Unknown)',
        // stash raw fields for tooltip
        _rev: +(r.revenue ?? 0), _gp: +(r.gp ?? 0), _gpPct: gp, _qty: +(r.qty ?? 0),
        symbolSize: 14 + Math.sqrt((+(r.qty ?? 0)) / maxQty) * 46,
        itemStyle: { color: tierColor(gp), opacity: 0.82, borderColor: '#fff', borderWidth: 1.5 },
      }
    })

    const fmtK = (v: number) => v >= 1_000_000 ? `${(v / 1_000_000).toFixed(1)}M` : v >= 1000 ? `${(v / 1000).toFixed(0)}K` : `${v}`

    return {
      grid: { top: 16, right: 24, bottom: 44, left: 8, containLabel: true },
      tooltip: {
        trigger: 'item',
        formatter: (p: any) => {
          const d  = p.data ?? {}
          const gc = gmColorOf(+(d._gpPct ?? 0))
          return `<div style="min-width:170px">
            <b>${d.name}</b><br/>
            Revenue: <b>${(+(d._rev ?? 0)).toLocaleString('en-US', { maximumFractionDigits: 0 })}</b><br/>
            GP%: <b style="color:${gc}">${(+(d._gpPct ?? 0)).toFixed(1)}%</b><br/>
            GP: ${(+(d._gp ?? 0)).toLocaleString('en-US', { maximumFractionDigits: 0 })}<br/>
            Qty: ${(+(d._qty ?? 0)).toLocaleString('en-US', { maximumFractionDigits: 0 })}
          </div>`
        },
      },
      xAxis: {
        type: 'value', name: 'Revenue', nameLocation: 'middle', nameGap: 28,
        nameTextStyle: { color: C_SLATE, fontSize: 11 },
        axisLabel: { color: C_SLATE, fontSize: 10, formatter: (v: number) => fmtK(v) },
        splitLine: { lineStyle: { color: '#f1f5f9' } },
      },
      yAxis: {
        type: 'value', name: 'GP %', nameLocation: 'middle', nameGap: 36,
        nameTextStyle: { color: C_SLATE, fontSize: 11 },
        axisLabel: { color: C_SLATE, fontSize: 10, formatter: (v: number) => `${v}%` },
        splitLine: { lineStyle: { color: '#f1f5f9' } },
      },
      series: [{
        type: 'scatter',
        data,
        label: {
          show: true, position: 'top', fontSize: 10, color: '#475569', fontWeight: 600,
          formatter: (p: any) => p.data?.name ?? '',
        },
        emphasis: { focus: 'self', label: { fontWeight: 800, color: '#1e293b' } },
        labelLayout: { hideOverlap: true },
        markLine: {
          silent: true, symbol: 'none',
          lineStyle: { color: C_AMBER, type: 'dashed', width: 1.5 },
          data: [{ yAxis: avgGp, label: { formatter: `Avg GP ${avgGp.toFixed(1)}%`, color: C_AMBER, fontSize: 10, position: 'insideEndTop',
            backgroundColor: 'rgba(255,255,255,0.85)', padding: [1,3], borderRadius: 2 } }],
        },
      }],
    }
  }, [deptData])

  /* ── Chart: DCS Sunburst (Dept → Class → Subclass) ───────────── */
  const sunburstOpt = useMemo(() => {
    const rows = (dcsData ?? []) as any[]
    if (!rows.length) return {}

    /* Build nested hierarchy */
    const deptMap: Record<string, {
      value: number
      color: string
      classMap: Record<string, {
        value: number
        subMap: Record<string, number>
      }>
    }> = {}

    rows.forEach(r => {
      const dept = r.department ?? '(Unknown)'
      const cls  = r.class     ?? '(Unknown)'
      const sub  = r.subclass  ?? '(Unknown)'
      const rev  = +(r.revenue ?? 0)

      if (!deptMap[dept]) {
        const idx = Object.keys(deptMap).length
        deptMap[dept] = {
          value: 0,
          color: DEPT_COLORS[idx % DEPT_COLORS.length],
          classMap: {},
        }
      }
      deptMap[dept].value += rev

      if (!deptMap[dept].classMap[cls]) {
        deptMap[dept].classMap[cls] = { value: 0, subMap: {} }
      }
      deptMap[dept].classMap[cls].value += rev

      if (!deptMap[dept].classMap[cls].subMap[sub]) {
        deptMap[dept].classMap[cls].subMap[sub] = 0
      }
      deptMap[dept].classMap[cls].subMap[sub] += rev
    })

    /* Grand total across all leaves — for share-of-total in the tooltip */
    const grandTotal = rows.reduce((s, r) => s + +(r.revenue ?? 0), 0)

    /* Flatten to ECharts sunburst format */
    const data = Object.entries(deptMap).map(([dname, d]) => ({
      name:      dname,
      value:     d.value,
      itemStyle: { color: d.color },
      children:  Object.entries(d.classMap).map(([cname, c]) => ({
        name:  cname,
        value: c.value,
        children: Object.entries(c.subMap)
          .sort((a, b) => b[1] - a[1])
          .map(([sname, sv]) => ({
            name:  sname,
            value: sv,
          })),
      })),
    }))

    return {
      tooltip: {
        formatter: (p: any) => {
          const trail = (p.treePathInfo as any[] ?? []).slice(1)
          const path  = trail.map((n: any) => n.name).join(' › ')
          // Depth-aware label: Dept / Class / Subclass
          const level = ['Department', 'Class', 'Subclass'][trail.length - 1] ?? ''
          const shr   = grandTotal > 0 ? (+p.value / grandTotal * 100).toFixed(1) : '0'
          return `<div style="min-width:200px">
            ${level ? `<div style="font-size:10px;color:#94a3b8;text-transform:uppercase;letter-spacing:.5px">${level}</div>` : ''}
            <b>${path || p.name}</b><br/>
            Revenue: <b>${(+p.value).toLocaleString('en-US', { maximumFractionDigits: 0 })}</b><br/>
            Share of total: ${shr}%<br/>
            <span style="font-size:10px;color:#94a3b8">Click a box to drill down · breadcrumb to go back</span>
          </div>`
        },
      },
      series: [{
        type:          'treemap',
        data,
        roam:          false,
        nodeClick:     'zoomToNode',
        leafDepth:     2,            // show Dept → Class at once; click to drill into Subclass
        drillDownIcon: '▸',
        width:  '100%', height: '100%',
        top: 4, left: 4, right: 4, bottom: 26,
        visibleMin: 300,            // suppress unreadable slivers; still reachable via drill
        label: {
          show:            true,
          formatter:       '{b}',
          color:           '#fff',
          fontSize:        12,
          fontWeight:      600,
          overflow:        'truncate',
          textBorderColor: 'rgba(0,0,0,0.35)',
          textBorderWidth: 2,
        },
        upperLabel: {                // parent-name band when a level contains children
          show:            true,
          height:          22,
          color:           '#fff',
          fontSize:        12,
          fontWeight:      700,
          textBorderColor: 'rgba(0,0,0,0.30)',
          textBorderWidth: 2,
        },
        itemStyle: { borderColor: '#fff', borderWidth: 2, gapWidth: 2 },
        emphasis:  { upperLabel: { color: '#fff' } },
        breadcrumb: {
          show: true, height: 22, bottom: 0,
          itemStyle: { color: '#ede9fe', borderColor: '#ddd6fe',
                       textStyle: { color: '#5b21b6', fontSize: 11 } },
          emphasis:  { itemStyle: { color: '#ddd6fe' } },
        },
        levels: [
          { itemStyle: { borderColor: '#fff', borderWidth: 3, gapWidth: 3 } },
          { colorSaturation: [0.32, 0.55],
            itemStyle: { borderColor: '#fff', borderColorSaturation: 0.6, borderWidth: 2, gapWidth: 2 } },
          { colorSaturation: [0.25, 0.48],
            itemStyle: { borderColorSaturation: 0.5, borderWidth: 1, gapWidth: 1 } },
        ],
      }],
    }
  }, [dcsData])

  /* ── Chart: Vendor bar ────────────────────────────────────────── */
  const vendorOpt = useMemo(() => {
    const rows  = ((vendorData ?? []) as any[]).slice(0, 10).reverse()
    const names = rows.map(r => r.name ?? '(Unknown)')
    const revs  = rows.map(r => +(r.revenue ?? 0))
    return {
      grid: { top: 8, right: 130, bottom: 8, left: 8, containLabel: true },
      tooltip: {
        trigger: 'axis', axisPointer: { type: 'shadow' },
        formatter: (p: any[]) => {
          const r  = rows[p[0]?.dataIndex] ?? {}
          const gc = gmColorOf(+(r.gp_pct ?? 0))
          return `<b>${p[0].name}</b><br/>Revenue: <b>${(+(r.revenue ?? 0)).toLocaleString('en-US', { maximumFractionDigits: 0 })}</b><br/>GP: ${(+(r.gp ?? 0)).toLocaleString('en-US', { maximumFractionDigits: 0 })}<br/>GP%: <b style="color:${gc}">${r.gp_pct ?? 0}%</b>`
        },
      },
      xAxis: {
        type: 'value',
        axisLabel: { color: C_SLATE, fontSize: 10, formatter: (v: number) => v >= 1000 ? `${(v / 1000).toFixed(0)}K` : `${v}` },
        splitLine: { lineStyle: { color: '#f1f5f9' } },
      },
      yAxis: {
        type: 'category', data: names,
        axisLabel: { color: '#374151', fontSize: 11 },
      },
      series: [{
        type: 'bar', data: revs, barMaxWidth: 18,
        itemStyle: {
          borderRadius: [0, 4, 4, 0],
          color: { type: 'linear', x: 0, y: 0, x2: 1, y2: 0, colorStops: [{ offset: 0, color: 'rgba(6,182,212,0.3)' }, { offset: 1, color: C_CYAN }] },
        },
        label: {
          show: true, position: 'right', fontSize: 10, color: '#475569',
          formatter: (p: any) => {
            const r  = rows[p.dataIndex] ?? {}
            const v  = +p.value
            const kb = v >= 1_000_000 ? `${(v / 1_000_000).toFixed(1)}M` : `${(v / 1000).toFixed(0)}K`
            const gc = +(r.gp_pct ?? 0) >= 30 ? '#065f46' : +(r.gp_pct ?? 0) >= 10 ? '#78350f' : '#7f1d1d'
            return `{val|${kb}}  {gp|GP:${r.gp_pct ?? 0}%}`
          },
          rich: {
            val: { color: '#475569', fontSize: 10 },
            gp:  { color: '#065f46', fontSize: 10, fontWeight: 700 },
          },
        },
        markLine: {
          silent: true,
          lineStyle: { color: C_AMBER, type: 'dashed', width: 1.5 },
          data: [{ type: 'average', name: 'Avg', label: { formatter: 'Avg', color: C_AMBER, fontSize: 9, position: 'insideEndTop',
            backgroundColor: 'rgba(255,255,255,0.85)', padding: [1,3], borderRadius: 2 } }],
        },
      }],
    }
  }, [vendorData])

  /* ── AG Grid columns per view tab ─────────────────────────────── */
  const tableCols = useMemo<ColDef[]>(() => {
    const rows   = (tableData ?? []) as any[]
    const maxRev = rows.length ? Math.max(...rows.map(r => +(r.revenue ?? 0))) : 1

    const revStyle = (p: any) => {
      const ratio = maxRev > 0 ? Math.min((+(p.value ?? 0)) / maxRev, 1) : 0
      const alpha = (0.06 + ratio * 0.32).toFixed(2)
      return {
        backgroundColor: `rgba(16,185,129,${alpha})`,
        display: 'flex', alignItems: 'center',
        fontWeight: ratio > 0.7 ? 600 : 400,
      }
    }

    const rankCol: ColDef = {
      headerName: '#', width: 52, sortable: false, resizable: false, pinned: 'left',
      valueGetter: (p: any) => (p.node?.rowIndex ?? 0) + 1,
      cellStyle: { color: C_SLATE, fontSize: 11, fontWeight: 500, display: 'flex', alignItems: 'center' },
    }
    const qtyCol:   ColDef = { field: 'qty',     headerName: 'Qty',     width: 100, type: 'numericColumn', valueFormatter: (p: any) => (+p.value || 0).toLocaleString() }
    const revCol:   ColDef = { field: 'revenue', headerName: 'Revenue', width: 130, type: 'numericColumn', valueFormatter: (p: any) => num(p.value ?? 0), cellStyle: revStyle }
    const gpCol:    ColDef = { field: 'gp',      headerName: 'GP',      width: 120, type: 'numericColumn', valueFormatter: (p: any) => num(p.value ?? 0), cellStyle: gpAbsStyle }
    const gpPctCol: ColDef = { field: 'gp_pct',  headerName: 'GP %',   width:  90, type: 'numericColumn', valueFormatter: (p: any) => `${p.value ?? 0}%`, cellStyle: gpPctStyle }

    if (view === 'item') return [
      rankCol,
      {
        field: productCodeField.toUpperCase(), headerName: productCodeField.toUpperCase(), width: 110, pinned: 'left',
        cellStyle: { fontFamily: 'monospace', fontSize: 12, color: '#6d28d9', display: 'flex', alignItems: 'center' },
      },
      {
        field: 'DESCRIPTION1', headerName: 'Description', width: 240, pinned: 'left',
        cellStyle: { fontWeight: 600, color: '#1e293b', display: 'flex', alignItems: 'center' },
      },
      { field: 'VEND_NAME', headerName: 'Item Vendor', width: 160,
        headerTooltip: 'Vendor from the item master (catalog) — not necessarily the supplier purchased from' },
      { field: 'DCS_CODE',  headerName: 'DCS Code', width: 100, cellStyle: { fontSize: 11, color: C_SLATE, display: 'flex', alignItems: 'center' } },
      qtyCol, revCol, gpCol, gpPctCol,
      ...itemFieldCols(itemFields),
    ]

    if (view === 'dcs') return [
      rankCol,
      {
        field: 'DCS_CODE',   headerName: 'DCS Code',   width: 110, pinned: 'left',
        cellStyle: { fontFamily: 'monospace', fontSize: 12, color: '#6d28d9', display: 'flex', alignItems: 'center' },
      },
      {
        field: 'department', headerName: 'Department', width: 170,
        cellStyle: { fontWeight: 700, color: '#1e293b', display: 'flex', alignItems: 'center' },
      },
      { field: 'class',    headerName: 'Class',    width: 160 },
      { field: 'subclass', headerName: 'Subclass', width: 160 },
      qtyCol, revCol, gpCol, gpPctCol,
    ]

    if (view === 'vendor') return [
      rankCol,
      {
        field: 'name', headerName: 'Item Vendor', width: 240, pinned: 'left',
        headerTooltip: 'Vendor from the item master (catalog) — not necessarily the supplier purchased from',
        cellStyle: { fontWeight: 600, color: '#1e293b', display: 'flex', alignItems: 'center' },
      },
      qtyCol, revCol, gpCol, gpPctCol,
    ]

    return [
      rankCol,
      {
        field: 'name', headerName: 'Department', width: 230, pinned: 'left',
        cellStyle: { fontWeight: 700, color: '#1e293b', display: 'flex', alignItems: 'center' },
      },
      qtyCol, revCol, gpCol, gpPctCol,
    ]
  }, [tableData, view, productCodeField, itemFields])

  const gpColor = kpi.gpPct >= 30 ? '#065f46' : kpi.gpPct >= 10 ? '#78350f' : '#991b1b'
  const gpLabel = kpi.gpPct >= 30 ? 'Excellent margin' : kpi.gpPct >= 10 ? 'Healthy margin' : 'Low margin'

  /* ─────────────────────────────────────────────────────────────── */
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2.5 }}>

      {/* ── Sticky header ──────────────────────────────────────── */}
      <Box sx={{
        position: 'sticky', top: 0, zIndex: 10, bgcolor: '#ffffff',
        borderBottom: '1px solid #e9e4ff', px: 3, pt: 3, pb: 2,
      }}>
        <Typography variant="h6" sx={{ fontWeight: 800, color: '#0f172a', letterSpacing: '-0.3px', mb: 0.3 }}>
          {tr('Products')}
          <TitleLoader />
        </Typography>
        <Typography sx={{ fontSize: 12, color: C_SLATE, mb: 1.5 }}>{from} → {to}</Typography>

        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap' }}>
          {/* Period chips */}
          <Box sx={{ display: 'flex', gap: 0.75, p: 0.5, bgcolor: '#f1f5f9', borderRadius: 2 }}>
            {PERIODS.map(p => (
              <Chip key={p.label} label={tr(p.label)} size="small" onClick={() => selectPeriod(p.label)}
                sx={{
                  fontWeight: 700, fontSize: 12, height: 28, px: 0.5, transition: 'all .18s ease',
                  bgcolor:    period === p.label ? ACCENT  : 'transparent',
                  color:      period === p.label ? '#fff'  : '#64748b',
                  boxShadow:  period === p.label ? '0 2px 8px rgba(124,58,237,.35)' : 'none',
                  '&:hover':  { bgcolor: period === p.label ? ACCENT2 : '#e2e8f0' },
                }}
              />
            ))}
          </Box>

          <Divider orientation="vertical" flexItem sx={{ borderColor: '#e9e4ff', mx: 0.5 }} />

          {/* Custom date range */}
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <CalendarMonthIcon sx={{ fontSize: 16, color: C_SLATE }} />
            <TextField type="date" size="small" label="From" value={customFrom}
              onChange={e => { setCustomFrom(e.target.value); setPeriod(null) }}
              InputLabelProps={{ shrink: true }}
              sx={{ width: 148, '& .MuiOutlinedInput-root': { borderRadius: 2, fontSize: 13 } }} />
            <Typography sx={{ color: C_SLATE, fontSize: 13, px: 0.25 }}>→</Typography>
            <TextField type="date" size="small" label="To" value={customTo}
              onChange={e => { setCustomTo(e.target.value); setPeriod(null) }}
              InputLabelProps={{ shrink: true }}
              sx={{ width: 148, '& .MuiOutlinedInput-root': { borderRadius: 2, fontSize: 13 } }} />
            <Button size="small" variant="contained" onClick={applyCustom}
              disabled={!customFrom || !customTo || customFrom > customTo}
              sx={{
                textTransform: 'none', fontWeight: 700, borderRadius: 2, px: 2.5, height: 36,
                bgcolor: ACCENT, boxShadow: '0 2px 8px rgba(124,58,237,.35)', '&:hover': { bgcolor: ACCENT2 },
              }}>
              Apply
            </Button>
          </Box>

          <Divider orientation="vertical" flexItem sx={{ borderColor: '#e9e4ff', mx: 0.5 }} />

          {/* Store filter */}
          <Autocomplete
            multiple options={storesList} value={selectedStores}
            onChange={(_, v) => setSelectedStores(v)}
            size="small" disableCloseOnSelect
            renderInput={p => (
              <TextField {...p} label="Stores"
                placeholder={selectedStores.length ? '' : 'All stores'}
                sx={{ '& .MuiOutlinedInput-root': { borderRadius: 2, fontSize: 13 } }} />
            )}
            sx={{ minWidth: 220 }}
          />
        </Box>
      </Box>

      {/* ── KPI strip ──────────────────────────────────────────── */}
      <Box sx={{ display: 'flex', gap: 2, px: 3, flexWrap: 'wrap' }}>
        <KpiCard label="Total Revenue"  value={money(kpi.totalRev)} icon="ti-cash" />
        <KpiCard label="Total GP"       value={money(kpi.totalGP)}
          color={kpi.totalGP >= 0 ? '#065f46' : '#991b1b'} icon="ti-trending-up" />
        <KpiCard label="Blended GP %"   value={`${kpi.gpPct.toFixed(1)}%`}
          color={gpColor} sub={gpLabel} icon="ti-chart-pie-2" />
        <KpiCard label="Qty Sold"       value={num(kpi.totalQty, 0)} icon="ti-shopping-cart" />
        <KpiCard label="Departments"    value={String(kpi.deptCount)}
          sub="active in period" color={ACCENT} icon="ti-category" />
      </Box>

      {/* ── Row 1: Treemap (left) + Sunburst (centre, wider) ───── */}
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1.2fr' }, gap: 2, px: 3 }}>
        <ChartCard
          title="Department Margin vs Volume"
          subtitle="Revenue × GP% · bubble size = units sold"
          option={deptOpt}
          height={440}
          loading={deptLoad}
        />
        <ChartCard
          title="DCS Hierarchy — Treemap"
          subtitle="Department › Class › Subclass · click a box to drill down · breadcrumb to go back"
          option={sunburstOpt}
          height={440}
          loading={dcsLoad}
        />
      </Box>

      {/* ── Row 2: Vendor bar ─────────────────────────────────── */}
      <Box sx={{ px: 3 }}>
        <ChartCard
          title="Top Item Vendors"
          subtitle="Item-master (catalog) vendor · revenue ranking · GP% annotated"
          option={vendorOpt}
          height={240}
          loading={vendorLoad}
        />
      </Box>

      {/* ── Detail grid ───────────────────────────────────────── */}
      <Box sx={{ px: 3, pb: 3 }}>
        <Card elevation={0} sx={{ border: '1px solid #e9e4ff', borderRadius: 2.5 }}>
          <CardContent sx={{ p: 2.5, '&:last-child': { pb: 2.5 } }}>

            {/* Tab row */}
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2, gap: 2, flexWrap: 'wrap' }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap' }}>
              <Box sx={{ display: 'flex', gap: 0.75, p: 0.5, bgcolor: '#f1f5f9', borderRadius: 2 }}>
                {VIEWS.map(v => (
                  <Chip key={v} label={tr(VIEW_LABELS[v])} size="small" onClick={() => setView(v)}
                    sx={{
                      fontWeight: 700, fontSize: 12, height: 28, px: 0.5, transition: 'all .18s ease',
                      bgcolor:    view === v ? ACCENT  : 'transparent',
                      color:      view === v ? '#fff'  : '#64748b',
                      boxShadow:  view === v ? '0 2px 8px rgba(124,58,237,.35)' : 'none',
                      '&:hover':  { bgcolor: view === v ? ACCENT2 : '#e2e8f0' },
                    }}
                  />
                ))}
              </Box>
              {view === 'dcs' && (
                <Typography sx={{ fontSize: 11, color: C_SLATE, fontStyle: 'italic' }}>
                  {tr('DCS = Department · Class · Subclass')}
                </Typography>
              )}
              {view === 'item' && (
                <Typography sx={{ fontSize: 11, color: C_SLATE }}>
                  {tr('Showing')} <b style={{ color: ACCENT }}>{productCodeField.toUpperCase()}</b> {tr('code · change in Settings')}
                </Typography>
              )}
              </Box>
              <GridExportBar gridRef={gridRef} filename="products_detail" title="Product Performance"
                colDefs={tableCols as any} onResetColumns={resetColumns} />
            </Box>

            {/* AG Grid */}
            {tableLoad
              ? <Skeleton variant="rectangular" height={440} sx={{ borderRadius: 1.5 }} />
              : (
                <Box className="ag-theme-alpine" sx={{ height: 460, ...GRID_SX }}>
                  <AgGridReact
                    ref={gridRef}
                    key={`view-${view}`}
                    overlayNoRowsTemplate={noRowsOverlay()}
                    onGridReady={onColGridReady}
                    onColumnMoved={onColumnChanged}
                    onColumnResized={onColumnChanged}
                    onColumnVisible={onColumnChanged}
                    onColumnPinned={onColumnChanged}
                    rowData={(tableData ?? []) as any[]}
                    columnDefs={trCols(tableCols as any[])}
                    defaultColDef={DEF_COL}
                    rowHeight={36}
                    headerHeight={40}
                    animateRows
                    pagination
                    paginationPageSize={25}
                  />
                </Box>
              )
            }
          </CardContent>
        </Card>
      </Box>

    </Box>
  )
}
