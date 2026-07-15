/**
 * Inventory — Stock Levels Overview
 * Current on-hand snapshot from FACT_INVENTORY
 * KPIs · Dept Treemap · DCS Sunburst · Vendor Bar · Store Bar · AG Grid
 */
import { useMemo, useRef, useState, useCallback } from 'react'
import {
  Box, Typography, Chip, Dialog, DialogTitle, DialogContent,
  IconButton, Tooltip, Autocomplete, TextField,
} from '@mui/material'
import FullscreenIcon    from '@mui/icons-material/Fullscreen'
import FullscreenExitIcon from '@mui/icons-material/FullscreenExit'
import DownloadIcon      from '@mui/icons-material/Download'
import WarningAmberIcon  from '@mui/icons-material/WarningAmber'
import { useQuery }      from '@tanstack/react-query'
import axios             from 'axios'
import { AgGridReact }   from 'ag-grid-react'
import type { ColDef }   from 'ag-grid-community'
import 'ag-grid-community/styles/ag-grid.css'
import 'ag-grid-community/styles/ag-theme-alpine.css'
import EChart, { type EChartHandle } from '../../components/EChart'
import KpiCard                        from '../../components/KpiCard'
import { noRowsOverlay }               from '../../utils/gridOverlay'
import GridExportBar                  from '../../components/GridExportBar'
import { useGridColumnState }         from '../../hooks/useGridColumnState'
import { moneyPrefix, money, moneyExact } from '../../utils/formatters'
import { tr, trf, trCols } from '../../i18n'
import TitleLoader from '../../components/TitleLoader'
import { gmColor as gmColorOf, dohColor } from '../../utils/thresholds'
import { itemFieldsQS, itemFieldCols } from '../../utils/itemFields'
import { useAppSettings } from '../../context/AppSettings'

// ── Colours ────────────────────────────────────────────────────────────────────
const C_PURPLE = '#7c3aed'
const C_SLATE  = '#64748b'
const C_GREEN  = '#059669'
const C_AMBER  = '#d97706'
const C_ROSE   = '#e11d48'
const DEPT_COLORS = [
  '#7c3aed','#0891b2','#059669','#d97706','#e11d48',
  '#8b5cf6','#06b6d4','#10b981','#f59e0b','#f43f5e',
]

function num(v: any) {
  const n = +(v ?? 0)
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (Math.abs(n) >= 1_000)     return `${(n / 1_000).toFixed(0)}K`
  return n.toLocaleString('en-US', { maximumFractionDigits: 0 })
}

// ── Chart Card ────────────────────────────────────────────────────────────────
function ChartCard({ title, subtitle, option, height = 340, children }: {
  title: string; subtitle?: string; option?: any; height?: number; children?: React.ReactNode
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
      <Box sx={{ bgcolor: '#fff', borderRadius: 2.5, border: '1px solid #e9e4ff',
                 boxShadow: '0 1px 6px rgba(124,58,237,0.06)', p: 2, display: 'flex',
                 flexDirection: 'column', gap: 1 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <Box>
            <Typography sx={{ fontSize: 13, fontWeight: 700, color: '#0f172a' }}>{tr(title)}</Typography>
            {subtitle && <Typography sx={{ fontSize: 11, color: C_SLATE }}>{tr(subtitle)}</Typography>}
          </Box>
          <Box sx={{ display: 'flex', gap: 0.5 }}>
            <Tooltip title="Download PNG">
              <IconButton size="small" onClick={download}><DownloadIcon sx={{ fontSize: 16 }} /></IconButton>
            </Tooltip>
            <Tooltip title="Fullscreen">
              <IconButton size="small" onClick={() => setFs(true)}><FullscreenIcon sx={{ fontSize: 16 }} /></IconButton>
            </Tooltip>
          </Box>
        </Box>
        {option ? <EChart ref={ref} option={option} style={{ height }} /> : children}
      </Box>

      <Dialog open={fs} onClose={() => setFs(false)} maxWidth="xl" fullWidth
        PaperProps={{ sx: { borderRadius: 3, height: '90vh' } }}>
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', pb: 1 }}>
          <Typography sx={{ fontWeight: 700 }}>{title}</Typography>
          <Box sx={{ display: 'flex', gap: 0.5 }}>
            <Tooltip title="Download PNG">
              <IconButton size="small" onClick={download}><DownloadIcon /></IconButton>
            </Tooltip>
            <Tooltip title="Close">
              <IconButton size="small" onClick={() => setFs(false)}><FullscreenExitIcon /></IconButton>
            </Tooltip>
          </Box>
        </DialogTitle>
        <DialogContent sx={{ p: 2 }}>
          {option && <EChart ref={ref} option={option} style={{ height: '100%' }} />}
        </DialogContent>
      </Dialog>
    </>
  )
}

// ── GP% style helper ──────────────────────────────────────────────────────────
function gmStyle(p: any) {
  const v = +(p.value ?? 0)
  return {
    color: gmColorOf(v),
    fontWeight: 700,
    backgroundColor: v >= 30 ? 'rgba(5,150,105,0.10)' : v >= 10 ? 'rgba(217,119,6,0.10)' : 'rgba(225,29,72,0.10)',
    display: 'flex', alignItems: 'center',
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────
export default function InventoryOverview() {
  const { itemFields } = useAppSettings()
  const [stores, setStores] = useState<string[]>([])
  const [view,   setView  ] = useState<'dept'|'dcs'|'vendor'|'store'|'item'|'item_store'>('dept')

  const gridRef = useRef<AgGridReact>(null)
  const { onGridReady: onColGridReady, onColumnChanged, resetColumns } = useGridColumnState('inv-overview')

  // Store options from sales stores-list endpoint
  const { data: storeList = [] } = useQuery<string[]>({
    queryKey: ['inv-stores-list'],
    // Normalise to plain strings — the endpoint may return either bare strings
    // or { STORE_NAME } row objects; rendering a raw object as a chip/option
    // crashes React ("Objects are not valid as a React child").
    queryFn:  () => axios.get('/api/sales/stores-list').then(r =>
      (r.data as any[]).map(s => typeof s === 'string' ? s : (s?.STORE_NAME ?? s?.store_name ?? String(s)))),
    gcTime: 3_600_000, refetchOnMount: false,
  })

  const storeQS = stores.length ? `&stores=${encodeURIComponent(stores.join(','))}` : ''

  // KPIs
  const { data: kpiRaw } = useQuery({
    queryKey: ['inv-overview', storeQS],
    queryFn:  () => axios.get(`/api/inventory/overview?${storeQS.slice(1)}`).then(r => r.data),
    gcTime: 1_800_000, refetchOnMount: 'always',
  })
  const kpi = {
    skus:        kpiRaw?.sku_count    ?? 0,
    totalQty:    kpiRaw?.total_qty    ?? 0,
    stockCost:   kpiRaw?.stock_cost   ?? 0,
    stockRetail: kpiRaw?.stock_retail ?? 0,
    gmPct:       kpiRaw?.gm_pct       ?? 0,
    depts:       kpiRaw?.dept_count   ?? 0,
    stores:      kpiRaw?.store_count  ?? 0,
    negStock:    kpiRaw?.neg_stock    ?? 0,
  }

  // Chart data
  const { data: deptData  = [] } = useQuery({
    queryKey: ['inv-by-dept',   storeQS],
    queryFn:  () => axios.get(`/api/inventory/by-dept?${storeQS.slice(1)}`).then(r => r.data),
    gcTime: 1_800_000,
  })
  const { data: dcsData   = [] } = useQuery({
    queryKey: ['inv-by-dcs',    storeQS],
    queryFn:  () => axios.get(`/api/inventory/by-dcs?limit=500${storeQS}`).then(r => r.data),
    gcTime: 1_800_000,
  })
  const { data: vendorData = [] } = useQuery({
    queryKey: ['inv-by-vendor', storeQS],
    queryFn:  () => axios.get(`/api/inventory/by-vendor?limit=12${storeQS}`).then(r => r.data),
    gcTime: 1_800_000,
  })
  const { data: storeData = [] } = useQuery({
    queryKey: ['inv-by-store', storeQS],
    queryFn:  () => axios.get(`/api/inventory/by-store?${storeQS.slice(1)}`).then(r => r.data),
    gcTime: 1_800_000,
  })
  const xfQS = view.startsWith('item') ? itemFieldsQS(itemFields) : ''
  const { data: tableData = [] } = useQuery({
    queryKey: ['inv-items', view, storeQS, xfQS],
    queryFn:  () => axios.get(`/api/inventory/items?group_by=${view}${storeQS}${xfQS}`).then(r => r.data),  // no limit — full dataset, grid paginates
    gcTime: 1_800_000, refetchOnMount: 'always',
  })

  // Turnover KPIs
  const { data: turnoverRaw } = useQuery({
    queryKey: ['inv-turnover', storeQS],
    queryFn:  () => axios.get(`/api/inventory/turnover-kpi?${storeQS.slice(1)}`).then(r => r.data),
    gcTime: 1_800_000, refetchOnMount: 'always',
  })
  const turnover = {
    rate:    turnoverRaw?.turnover_rate ?? 0,
    doh:     turnoverRaw?.days_on_hand  ?? 0,
    months:  turnoverRaw?.months_supply ?? 0,
    cogs12m: turnoverRaw?.cogs_12m      ?? 0,
  }

  const noData = kpi.skus === 0 && kpi.stockCost === 0

  // ── Department Cost vs Margin bubble option ────────────────────────────────
  //  x = cost value, y = GM%, bubble size = units on-hand, colour = margin tier.
  //  Replaces the old "Stock by Department" treemap (redundant with the DCS
  //  treemap below); this reveals which departments tie up cost at high vs low
  //  margin. A dashed line marks the cost-weighted average GM%.
  const deptBubbleOpt = useMemo(() => {
    const all = (deptData as any[])
    if (!all.length) return {}

    const tierColor = (gm: number) => gm >= 30 ? C_GREEN : gm >= 10 ? C_AMBER : C_ROSE

    const qtys   = all.map(r => +(r.total_qty ?? 0))
    const maxQty = Math.max(1, ...qtys)

    // Cost-weighted average GM% across departments for the reference line.
    const totCost   = all.reduce((s, r) => s + +(r.cost_value ?? 0), 0)
    const totRetail = all.reduce((s, r) => s + +(r.retail_value ?? 0), 0)
    const avgGm     = totRetail > 0 ? ((totRetail - totCost) / totRetail * 100) : 0

    const data = all.map(r => {
      const gm = +(r.gm_pct ?? 0)
      return {
        value: [+(r.cost_value ?? 0), gm],
        name:  r.department ?? '(Unknown)',
        _cost: +(r.cost_value ?? 0), _retail: +(r.retail_value ?? 0),
        _gm: gm, _qty: +(r.total_qty ?? 0), _skus: +(r.sku_count ?? 0),
        symbolSize: 14 + Math.sqrt((+(r.total_qty ?? 0)) / maxQty) * 46,
        itemStyle: { color: tierColor(gm), opacity: 0.82, borderColor: '#fff', borderWidth: 1.5 },
      }
    })

    return {
      grid: { top: 16, right: 24, bottom: 44, left: 8, containLabel: true },
      tooltip: {
        trigger: 'item',
        formatter: (p: any) => {
          const d  = p.data ?? {}
          const gc = gmColorOf(+(d._gm ?? 0))
          return `<div style="min-width:180px">
            <b>${d.name}</b><br/>
            Cost Value: <b>${num(+(d._cost ?? 0))}</b><br/>
            Retail Value: ${num(+(d._retail ?? 0))}<br/>
            GM%: <b style="color:${gc}">${(+(d._gm ?? 0)).toFixed(1)}%</b><br/>
            Units: ${num(+(d._qty ?? 0))}<br/>
            SKUs: ${(+(d._skus ?? 0)).toLocaleString('en-US')}
          </div>`
        },
      },
      xAxis: {
        type: 'value', name: 'Cost Value', nameLocation: 'middle', nameGap: 28,
        nameTextStyle: { color: C_SLATE, fontSize: 11 },
        axisLabel: { color: C_SLATE, fontSize: 10, formatter: (v: number) => num(v) },
        splitLine: { lineStyle: { color: '#f1f5f9' } },
      },
      yAxis: {
        type: 'value', name: 'GM %', nameLocation: 'middle', nameGap: 36,
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
          data: [{ yAxis: avgGm, label: { formatter: `Avg GM ${avgGm.toFixed(1)}%`, color: C_AMBER, fontSize: 10, position: 'insideEndTop',
            backgroundColor: 'rgba(255,255,255,0.85)', padding: [1,3], borderRadius: 2 } }],
        },
      }],
    }
  }, [deptData])

  // ── DCS Treemap option (drill-down: Dept → Class → Subclass) ───────────────
  const sunburstOpt = useMemo(() => {
    const rows = (dcsData as any[])
    if (!rows.length) return {}
    const deptMap: Record<string, { value: number; color: string; classMap: Record<string, { value: number; subMap: Record<string, number> }> }> = {}
    rows.forEach(r => {
      const dept = r.department ?? '(Unknown)'
      const cls  = r.class      ?? '(Unknown)'
      const sub  = r.subclass   ?? '(Unknown)'
      const val  = +(r.cost_value ?? 0)
      if (!deptMap[dept]) deptMap[dept] = { value: 0, color: DEPT_COLORS[Object.keys(deptMap).length % 10], classMap: {} }
      deptMap[dept].value += val
      if (!deptMap[dept].classMap[cls]) deptMap[dept].classMap[cls] = { value: 0, subMap: {} }
      deptMap[dept].classMap[cls].value += val
      deptMap[dept].classMap[cls].subMap[sub] = (deptMap[dept].classMap[cls].subMap[sub] || 0) + val
    })

    // Grand total across all leaves — for share-of-total in the tooltip.
    const grandTotal = rows.reduce((s, r) => s + +(r.cost_value ?? 0), 0)

    const data = Object.entries(deptMap).map(([dname, d]) => ({
      name: dname, value: d.value, itemStyle: { color: d.color },
      children: Object.entries(d.classMap).map(([cname, c]) => ({
        name: cname, value: c.value,
        children: Object.entries(c.subMap).sort((a, b) => b[1] - a[1]).map(([sname, sv]) => ({ name: sname, value: sv })),
      })),
    }))
    return {
      tooltip: {
        formatter: (p: any) => {
          const trail = (p.treePathInfo as any[] ?? []).slice(1)
          const path  = trail.map((n: any) => n.name).join(' › ')
          const level = ['Department', 'Class', 'Subclass'][trail.length - 1] ?? ''
          const shr   = grandTotal > 0 ? (+p.value / grandTotal * 100).toFixed(1) : '0'
          return `<div style="min-width:200px">
            ${level ? `<div style="font-size:10px;color:#94a3b8;text-transform:uppercase;letter-spacing:.5px">${level}</div>` : ''}
            <b>${path || p.name}</b><br/>
            Cost Value: <b>${num(+p.value)}</b><br/>
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

  // ── Vendor bar option ──────────────────────────────────────────────────────
  const vendorOpt = useMemo(() => {
    const rows  = (vendorData as any[]).slice(0, 10).reverse()
    const names = rows.map(r => r.vendor ?? '(Unknown)')
    const vals  = rows.map(r => +(r.cost_value ?? 0))
    return {
      grid: { top: 8, right: 130, bottom: 8, left: 8, containLabel: true },
      tooltip: {
        trigger: 'axis', axisPointer: { type: 'shadow' },
        formatter: (p: any[]) => {
          const r = rows[p[0]?.dataIndex] ?? {}
          return `<b>${p[0].name}</b><br/>Cost Value: <b>${num(r.cost_value)}</b><br/>SKUs: ${r.sku_count}<br/>GM%: <b>${r.gm_pct ?? 0}%</b>`
        },
      },
      xAxis: { type: 'value', axisLabel: { color: C_SLATE, fontSize: 10, formatter: (v: number) => num(v) }, splitLine: { lineStyle: { color: '#f1f5f9' } } },
      yAxis: { type: 'category', data: names, axisLabel: { color: '#374151', fontSize: 11 } },
      series: [{
        type: 'bar', data: vals, barMaxWidth: 18,
        itemStyle: { borderRadius: [0, 4, 4, 0], color: { type: 'linear', x: 0, y: 0, x2: 1, y2: 0, colorStops: [{ offset: 0, color: 'rgba(124,58,237,0.25)' }, { offset: 1, color: C_PURPLE }] } },
        label: {
          show: true, position: 'right', fontSize: 10,
          formatter: (p: any) => {
            const r = rows[p.dataIndex] ?? {}
            return `{val|${num(p.value)}}  {gm|GM:${r.gm_pct ?? 0}%}`
          },
          rich: { val: { color: '#475569', fontSize: 10 }, gm: { color: '#065f46', fontSize: 10, fontWeight: 700 } },
        },
      }],
    }
  }, [vendorData])

  // ── Store bar option ──────────────────────────────────────────────────────
  const storeOpt = useMemo(() => {
    const rows  = (storeData as any[]).reverse()
    const names = rows.map(r => r.store_name ?? '(Unknown)')
    const vals  = rows.map(r => +(r.cost_value ?? 0))
    return {
      grid: { top: 8, right: 110, bottom: 8, left: 8, containLabel: true },
      tooltip: {
        trigger: 'axis', axisPointer: { type: 'shadow' },
        formatter: (p: any[]) => {
          const r = rows[p[0]?.dataIndex] ?? {}
          return `<b>${p[0].name}</b><br/>Cost Value: <b>${num(r.cost_value)}</b><br/>SKUs: ${r.sku_count}<br/>Units: ${num(r.total_qty)}`
        },
      },
      xAxis: { type: 'value', axisLabel: { color: C_SLATE, fontSize: 10, formatter: (v: number) => num(v) }, splitLine: { lineStyle: { color: '#f1f5f9' } } },
      yAxis: { type: 'category', data: names, axisLabel: { color: '#374151', fontSize: 11 } },
      series: [{
        type: 'bar', data: vals, barMaxWidth: 18,
        itemStyle: { borderRadius: [0, 4, 4, 0], color: { type: 'linear', x: 0, y: 0, x2: 1, y2: 0, colorStops: [{ offset: 0, color: 'rgba(8,145,178,0.25)' }, { offset: 1, color: '#0891b2' }] } },
        label: { show: true, position: 'right', formatter: (p: any) => `{val|${num(p.value)}}`, rich: { val: { color: '#475569', fontSize: 10 } } },
      }],
    }
  }, [storeData])

  // ── AG Grid columns ────────────────────────────────────────────────────────
  const tableCols = useMemo<ColDef[]>(() => {
    const rows   = (tableData as any[])
    const maxCost = rows.length ? Math.max(...rows.map(r => +(r.cost_value ?? 0))) : 1

    const costStyle = (p: any) => {
      const ratio = maxCost > 0 ? Math.min((+(p.value ?? 0)) / maxCost, 1) : 0
      const alpha = (0.06 + ratio * 0.30).toFixed(2)
      return { backgroundColor: `rgba(124,58,237,${alpha})`, display: 'flex', alignItems: 'center', fontWeight: ratio > 0.7 ? 600 : 400 }
    }

    const rankCol: ColDef = {
      headerName: '#', width: 52, sortable: false, resizable: false, pinned: 'left',
      valueGetter: (p: any) => (p.node?.rowIndex ?? 0) + 1,
      cellStyle: { color: C_SLATE, fontSize: 11, display: 'flex', alignItems: 'center' },
    }
    const qtyCol:     ColDef = { field: 'total_qty',    headerName: 'Units',        width: 100, type: 'numericColumn', valueFormatter: (p: any) => num(p.value) }
    const costCol:    ColDef = { field: 'cost_value',   headerName: 'Cost Value',   width: 130, type: 'numericColumn', valueFormatter: (p: any) => num(p.value), cellStyle: costStyle }
    const retailCol:  ColDef = { field: 'retail_value', headerName: 'Retail Value', width: 130, type: 'numericColumn', valueFormatter: (p: any) => num(p.value) }
    const gmCol:      ColDef = { field: 'gm_pct',       headerName: 'GM %',         width:  90, type: 'numericColumn', valueFormatter: (p: any) => `${p.value ?? 0}%`, cellStyle: gmStyle }
    const skuCol:     ColDef = { field: 'sku_count',    headerName: 'SKUs',         width:  80, type: 'numericColumn' }

    if (view === 'dept') return [
      rankCol,
      { field: 'department', headerName: 'Department', width: 220, pinned: 'left', cellStyle: { fontWeight: 700, color: '#0f172a', display: 'flex', alignItems: 'center' } },
      skuCol, qtyCol, costCol, retailCol, gmCol,
    ]

    if (view === 'dcs') return [
      rankCol,
      { field: 'DCS_CODE',   headerName: 'DCS Code',   width: 100, pinned: 'left', cellStyle: { fontFamily: 'monospace', color: C_PURPLE, display: 'flex', alignItems: 'center' } },
      { field: 'department', headerName: 'Department', width: 160, cellStyle: { fontWeight: 600, display: 'flex', alignItems: 'center' } },
      { field: 'class',      headerName: 'Class',      width: 150 },
      { field: 'subclass',   headerName: 'Subclass',   width: 150 },
      skuCol, qtyCol, costCol, retailCol, gmCol,
    ]

    if (view === 'vendor') return [
      rankCol,
      { field: 'vendor', headerName: 'Item Vendor', width: 250, pinned: 'left',
        headerTooltip: 'Vendor from the item master (catalog) — not necessarily the supplier purchased from',
        cellStyle: { fontWeight: 600, color: '#0f172a', display: 'flex', alignItems: 'center' } },
      skuCol, qtyCol, costCol, retailCol, gmCol,
    ]

    if (view === 'item') return [
      rankCol,
      { field: 'ALU',          headerName: 'ALU',         width: 110, pinned: 'left', cellStyle: { fontFamily: 'monospace', color: C_PURPLE, display: 'flex', alignItems: 'center' } },
      { field: 'DESCRIPTION1', headerName: 'Description', flex: 1, minWidth: 200 },
      { field: 'department',   headerName: 'Dept',        width: 140 },
      { field: 'vendor',       headerName: 'Item Vendor', width: 180,
        headerTooltip: 'Vendor from the item master (catalog) — not necessarily the supplier purchased from' },
      { field: 'store_count',  headerName: 'Stores', width: 75, type: 'numericColumn' as const },
      qtyCol, costCol, retailCol, gmCol,
      { field: 'avg_cost',  headerName: 'Avg Cost',  width: 100, type: 'numericColumn' as const, valueFormatter: (p: any) => moneyExact(p.value ?? 0) },
      { field: 'avg_price', headerName: 'Avg Price', width: 100, type: 'numericColumn' as const, valueFormatter: (p: any) => moneyExact(p.value ?? 0) },
      ...itemFieldCols(itemFields),
    ]

    if (view === 'item_store') return [
      rankCol,
      { field: 'store_name',   headerName: 'Store',       width: 180, pinned: 'left', cellStyle: { fontWeight: 600, color: '#0f172a', display: 'flex', alignItems: 'center' } },
      { field: 'ALU',          headerName: 'ALU',         width: 110, cellStyle: { fontFamily: 'monospace', color: C_PURPLE, display: 'flex', alignItems: 'center' } },
      { field: 'DESCRIPTION1', headerName: 'Description', flex: 1, minWidth: 180 },
      { field: 'department',   headerName: 'Dept',        width: 130 },
      { field: 'qty',          headerName: 'Units',  width: 90,  type: 'numericColumn' as const, valueFormatter: (p: any) => num(p.value) },
      { field: 'unit_cost',    headerName: 'Unit Cost',  width: 100, type: 'numericColumn' as const, valueFormatter: (p: any) => moneyExact(p.value ?? 0) },
      { field: 'unit_price',   headerName: 'Unit Price', width: 100, type: 'numericColumn' as const, valueFormatter: (p: any) => moneyExact(p.value ?? 0) },
      costCol, retailCol, gmCol,
      ...itemFieldCols(itemFields),
    ]

    return [  // store
      rankCol,
      { field: 'store_name', headerName: 'Store', width: 240, pinned: 'left', cellStyle: { fontWeight: 600, color: '#0f172a', display: 'flex', alignItems: 'center' } },
      skuCol, qtyCol, costCol, retailCol,
    ]
  }, [tableData, view, itemFields])

  const gmColor = gmColorOf(kpi.gmPct)

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2.5 }}>

      {/* ── Header ── */}
      <Box sx={{ position: 'sticky', top: 0, zIndex: 10, bgcolor: '#ffffff',
                 borderBottom: '1px solid #e9e4ff', px: 3, pt: 3, pb: 2 }}>
        <Typography variant="h6" sx={{ fontWeight: 700, fontSize: 20, color: '#0f172a', letterSpacing: '-0.3px', mb: 0.3 }}>
          {tr('Stock Levels')}
          <TitleLoader />
        </Typography>
        <Typography sx={{ fontSize: 12, color: C_SLATE, mb: 1.5 }}>
          {tr('Current on-hand snapshot · refreshed on each data sync')}
        </Typography>

        {/* Store filter */}
        <Autocomplete
          multiple disableCloseOnSelect size="small"
          options={storeList} value={stores}
          onChange={(_, v) => setStores(v)}
          renderInput={params => <TextField {...params} placeholder={tr('All Stores')} size="small" sx={{ maxWidth: 380 }} />}
          renderTags={(value, getTagProps) =>
            value.map((opt, i) => <Chip label={opt} size="small" {...getTagProps({ index: i })} key={opt} />)
          }
        />
      </Box>

      {/* ── No data banner ── */}
      {noData && (
        <Box sx={{ mx: 3, p: 2.5, bgcolor: '#fffbeb', border: '1px solid #fde68a',
                   borderRadius: 2, display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <WarningAmberIcon sx={{ color: C_AMBER }} />
          <Box>
            <Typography sx={{ fontWeight: 700, color: '#92400e' }}>Inventory snapshot not yet available</Typography>
            <Typography sx={{ fontSize: 12, color: '#78350f' }}>
              Trigger a data sync to populate stock levels. The Movement page uses sales history and is available now.
            </Typography>
          </Box>
        </Box>
      )}

      <Box sx={{ px: 3, display: 'flex', flexDirection: 'column', gap: 2.5, pb: 3 }}>

        {/* ── KPI Strip — style F (top accent bar) ── */}
        <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
          <KpiCard variant="F" label="Total SKUs"       value={kpi.skus.toLocaleString()}    sub={trf('{{n}} departments', { n: kpi.depts })} icon="ti-barcode" />
          <KpiCard variant="F" label="Units On-Hand"    value={num(kpi.totalQty)}             sub={trf('across {{n}} stores', { n: kpi.stores })} icon="ti-package" />
          <KpiCard variant="F" label="Cost Value"       value={money(kpi.stockCost)}            sub="at cost price" icon="ti-coin" />
          <KpiCard variant="F" label="Retail Value"     value={money(kpi.stockRetail)}          sub="at selling price" icon="ti-tag" />
          <KpiCard variant="F" label="Potential GM"     value={`${kpi.gmPct}%`}              sub="retail − cost margin" color={gmColor} icon="ti-chart-pie-2" />
        </Box>

        {/* ── Turnover KPI Strip ── */}
        <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
          <KpiCard variant="F" label="Inventory Turnover" value={`${turnover.rate}×`}
            sub="COGS ÷ stock cost (12m)" color="#0891b2" icon="ti-refresh" />
          <KpiCard variant="F" label="Days on Hand"       value={`${turnover.doh}`}
            sub="365 ÷ turnover rate" icon="ti-calendar-stats"
            color={dohColor(turnover.doh)} />
          <KpiCard variant="F" label="Months Supply"      value={`${turnover.months}m`}
            sub="stock cost ÷ monthly COGS" color="#0891b2" icon="ti-clock" />
          <KpiCard variant="F" label="COGS (12m)"         value={money(turnover.cogs12m)}
            sub="cost of goods sold (last yr)" color="#7c3aed" icon="ti-receipt" />
        </Box>

        {/* ── Row 1: Treemap + Sunburst ── */}
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1.2fr' }, gap: 2 }}>
          <ChartCard title="Department Cost vs Margin"
            subtitle="x = cost value · y = GM% · bubble size = units on-hand · colour = margin tier"
            option={deptBubbleOpt} height={340} />
          <ChartCard title="DCS Hierarchy — Treemap"
            subtitle="Dept › Class › Subclass · click a box to drill down · breadcrumb to go back"
            option={sunburstOpt} height={340} />
        </Box>

        {/* ── Row 2: Vendor Bar + Store Bar ── */}
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1.2fr 1fr' }, gap: 2 }}>
          <ChartCard title="Top Item Vendors by Stock Value" subtitle="Item-master (catalog) vendor · cost value · GM% annotated" option={vendorOpt} height={300} />
          <ChartCard title="Stock by Store" subtitle="Cost value distribution" option={storeOpt} height={300} />
        </Box>

        {/* ── Row 3: Detail Grid ── */}
        <Box sx={{ bgcolor: '#fff', borderRadius: 2.5, border: '1px solid #e9e4ff',
                   boxShadow: '0 1px 6px rgba(124,58,237,0.06)', p: 2 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1.5, gap: 1, flexWrap: 'wrap' }}>
            <Typography sx={{ fontWeight: 700, color: '#0f172a', fontSize: 13 }}>{tr('Stock Detail')}</Typography>
            <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
              {([
                { v: 'dept',       label: 'By Dept'     },
                { v: 'dcs',        label: 'DCS'         },
                { v: 'vendor',     label: 'By Item Vendor' },
                { v: 'store',      label: 'By Store'    },
                { v: 'item',       label: 'By Item'     },
                { v: 'item_store', label: 'Item × Store'},
              ] as const).map(({ v, label }) => (
                <Chip key={v} label={tr(label)}
                  size="small" onClick={() => setView(v)}
                  sx={{ fontWeight: 600, cursor: 'pointer',
                        bgcolor: view === v ? C_PURPLE : 'transparent',
                        color: view === v ? '#fff' : C_SLATE,
                        border: `1px solid ${view === v ? C_PURPLE : '#e2e8f0'}` }} />
              ))}
              <GridExportBar gridRef={gridRef} filename="inventory_overview" title="Inventory Stock Detail"
                colDefs={tableCols} onResetColumns={resetColumns} />
            </Box>
          </Box>

          <div className="ag-theme-alpine" style={{ height: 440 }}>
            <AgGridReact
              ref={gridRef}
              overlayNoRowsTemplate={noRowsOverlay()}
              rowData={tableData as any[]}
              columnDefs={trCols(tableCols as any[])}
              pagination paginationPageSize={20}
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
