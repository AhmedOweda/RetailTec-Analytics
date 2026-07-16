import { useState, useMemo } from 'react'
import { Box, Typography, Stack, TextField, Chip, Autocomplete, Tooltip } from '@mui/material'
import { useQuery } from '@tanstack/react-query'
import ReactECharts from 'echarts-for-react'
import { AgGridReact } from 'ag-grid-react'
import 'ag-grid-community/styles/ag-grid.css'
import 'ag-grid-community/styles/ag-theme-alpine.css'
import KpiCard from '../../components/KpiCard'
import GridExportBar from '../../components/GridExportBar'
import { useGridColumnState } from '../../hooks/useGridColumnState'
import { noRowsOverlay } from '../../utils/gridOverlay'
import axios from 'axios'
import { useRef } from 'react'
import { moneyPrefix, money } from '../../utils/formatters'
import { tr, trf, trCols } from '../../i18n'
import TitleLoader from '../../components/TitleLoader'

const today = new Date().toISOString().slice(0, 10)
const prior = new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10)

const C_PURPLE = '#7c3aed'
const C_SLATE  = '#64748b'
const C_GREEN  = '#059669'
const C_AMBER  = '#d97706'
const C_ROSE   = '#e11d48'
const C_CYAN   = '#0891b2'

function num(v: any) {
  const n = +(v ?? 0)
  if (Math.abs(n) >= 1_000_000) return `${moneyPrefix()}${(n / 1_000_000).toFixed(1)}M`
  if (Math.abs(n) >= 1_000)     return `${moneyPrefix()}${(n / 1_000).toFixed(0)}K`
  return `${moneyPrefix()}${n.toLocaleString('en-US', { maximumFractionDigits: 0 })}`
}
function fmtN(v: any) { return (+(v ?? 0)).toLocaleString('en-US', { maximumFractionDigits: 0 }) }
function pct(v: any)  { return `${(+(v ?? 0)).toFixed(1)}%` }

// SRM tier based on dependency + fill rate
function srmTier(dep: number, fill: number): string {
  if (dep >= 20 && fill >= 90) return 'Strategic'
  if (dep >= 10 || fill >= 85) return 'Preferred'
  if (fill < 70)               return 'At Risk'
  return 'Standard'
}
const TIER_META: Record<string, { color: string; desc: string }> = {
  Strategic: { color: C_PURPLE, desc: 'High dependency + high fill rate — protect this relationship'  },
  Preferred: { color: C_CYAN,   desc: 'Solid supplier, above-average contribution or reliability'     },
  Standard:  { color: C_SLATE,  desc: 'Meets baseline expectations'                                   },
  'At Risk': { color: C_ROSE,   desc: 'Low fill rate — investigate delivery issues'                   },
}

export default function DimVendors() {
  const gridRef = useRef<AgGridReact>(null)
  const { onGridReady: onColGridReady, onColumnChanged, resetColumns } = useGridColumnState('dim-vendors')
  const [dateFrom, setDateFrom] = useState(prior)
  const [dateTo,   setDateTo  ] = useState(today)
  const [stores,   setStores  ] = useState<string[]>([])

  const { data: storeList = [] } = useQuery<string[]>({
    queryKey: ['stores-list'],
    queryFn:  () => axios.get('/api/sales/stores-list').then(r => r.data),
  })

  const purParams = {
    date_from: dateFrom, date_to: dateTo,
    ...(stores.length ? { stores: stores.join(',') } : {}),
  }
  const invStoreQS = stores.length ? `&stores=${encodeURIComponent(stores.join(','))}` : ''

  const { data: purRows = [] } = useQuery({
    queryKey: ['dim-vendors-pur', dateFrom, dateTo, stores.join(',')],
    queryFn:  () => axios.get('/api/purchases/by-vendor', { params: purParams }).then(r => r.data),
  })
  const { data: invRows = [] } = useQuery({
    queryKey: ['dim-vendors-inv', invStoreQS],
    queryFn:  () => axios.get(`/api/inventory/by-vendor?limit=200${invStoreQS}`).then(r => r.data),
  })

  const merged = useMemo(() => {
    const invMap: Record<string, any> = {}
    ;(invRows as any[]).forEach(r => { invMap[r.vendor ?? ''] = r })

    const totalCost = (purRows as any[]).reduce((s, x) => s + +(x.total_cost ?? 0), 0)

    return (purRows as any[]).map(r => {
      const inv        = invMap[r.vendor_name ?? ''] ?? {}
      const fill_rate  = +(r.ord_qty ?? 0) > 0
        ? Math.round(+(r.recv_qty ?? 0) / +(r.ord_qty ?? 0) * 100) : 0
      const dep_pct    = totalCost > 0
        ? +((+(r.total_cost ?? 0) / totalCost * 100).toFixed(1)) : 0
      const tier       = srmTier(dep_pct, fill_rate)
      return {
        ...r,
        stock_cost:   inv.cost_value  ?? 0,
        sku_count:    inv.sku_count   ?? 0,
        fill_rate,
        dep_pct,
        tier,
      }
    })
  }, [purRows, invRows])

  const kpi = useMemo(() => {
    const totalCost   = merged.reduce((s, x) => s + +(x.total_cost ?? 0), 0)
    const totalStock  = merged.reduce((s, x) => s + +(x.stock_cost ?? 0), 0)
    const avgFill     = merged.length > 0
      ? merged.reduce((s, x) => s + x.fill_rate, 0) / merged.length : 0
    const top1dep     = merged.length > 0
      ? Math.max(...merged.map(x => x.dep_pct)) : 0
    return { count: merged.length, totalCost, totalStock, avgFill, top1dep }
  }, [merged])

  const tierCounts = useMemo(() => {
    const m: Record<string, number> = {}
    merged.forEach(r => { m[r.tier] = (m[r.tier] ?? 0) + 1 })
    return m
  }, [merged])

  const chartOpt = useMemo(() => {
    const r = merged.slice().sort((a, b) => +(b.total_cost ?? 0) - +(a.total_cost ?? 0)).slice(0, 12).reverse()
    return {
      grid: { top: 8, right: 130, bottom: 8, left: 8, containLabel: true },
      tooltip: {
        trigger: 'axis', axisPointer: { type: 'shadow' },
        formatter: (p: any[]) => {
          const d = r.find((x: any) => x.vendor_name === p[0]?.name) ?? {}
          return `<b>${p[0]?.name}</b><br/>
            Tier: <b style="color:${TIER_META[d.tier]?.color}">${d.tier}</b><br/>
            Purchased: <b>${num(d.total_cost)}</b><br/>
            Dependency: ${pct(d.dep_pct)} of chain<br/>
            Fill Rate: ${pct(d.fill_rate)}<br/>
            Stock Value: ${num(d.stock_cost)} · SKUs: ${fmtN(d.sku_count)}`
        },
      },
      xAxis: { type: 'value', axisLabel: { formatter: (v: number) => num(v), fontSize: 10 } },
      yAxis: { type: 'category', data: r.map((x: any) => x.vendor_name ?? '?'),
               axisLabel: { fontSize: 10, width: 140, overflow: 'truncate' } },
      series: [{
        type: 'bar', barMaxWidth: 22,
        data: r.map((x: any) => ({
          value: +(x.total_cost ?? 0),
          itemStyle: { color: TIER_META[x.tier]?.color ?? C_SLATE },
        })),
        itemStyle: { borderRadius: [0,4,4,0] },
        label: { show: true, position: 'right', formatter: (p: any) => num(p.value), fontSize: 10, color: C_SLATE },
      }],
    }
  }, [merged])

  const colDefs = useMemo<any[]>(() => [
    { field: 'vendor_name', headerName: 'Supplier',     flex: 1.5, pinned: 'left' as const,
      headerTooltip: 'Supplier on purchase vouchers (who the goods were bought from)',
      cellStyle: { fontWeight: 600 } },
    { field: 'tier',        headerName: 'SRM Tier',     width: 110,
      cellRenderer: (p: any) => {
        const c = TIER_META[p.value]?.color ?? C_SLATE
        return <span style={{background:`${c}18`,color:c,border:`1px solid ${c}55`,borderRadius:'12px',padding:'2px 10px',fontSize:'11px',fontWeight:700}}>{p.value ? tr(p.value) : '—'}</span>
      }},
    { field: 'dep_pct',     headerName: 'Dependency %', width: 115, type: 'numericColumn', valueFormatter: (p: any) => pct(p.value),
      cellStyle: (p: any) => ({ color: +(p.value??0) >= 20 ? C_ROSE : +(p.value??0) >= 10 ? C_AMBER : C_SLATE, fontWeight: 600 }) },
    { field: 'fill_rate',   headerName: 'Fill Rate %',  width: 110, type: 'numericColumn', valueFormatter: (p: any) => pct(p.value),
      cellStyle: (p: any) => ({ color: +(p.value??0) >= 90 ? C_GREEN : +(p.value??0) >= 70 ? C_AMBER : C_ROSE, fontWeight: 700 }) },
    { field: 'total_cost',  headerName: 'Purchased',    width: 130, type: 'numericColumn', valueFormatter: (p: any) => num(p.value) },
    { field: 'vou_count',   headerName: 'Vouchers',     width: 95,  type: 'numericColumn' },
    { field: 'stock_cost',  headerName: 'Stock Value',  width: 125, type: 'numericColumn', valueFormatter: (p: any) => num(p.value),
      cellStyle: { color: C_CYAN, fontWeight: 600 } },
    { field: 'sku_count',   headerName: 'SKUs in Stock',width: 110, type: 'numericColumn' },
  ], [])

  return (
    <Box sx={{ pt: 0, px: 3, pb: 3 }}>
      <Box sx={{ position:'sticky', top:0, zIndex:10, bgcolor:'#f8fafc',
                 mx:-3, px:3, pt:2.5, pb:1.5, mb:2, borderBottom:'1px solid #e9e4ff' }}>
        <Typography variant="h5" fontWeight={700} mb={0.3}>{tr('SRM — Supplier Intelligence')}<TitleLoader /></Typography>
        <Typography sx={{ fontSize:12, color:'#64748b', mb:1.5 }}>
          {tr('Ranked by purchase vouchers (supplier bought from) — item catalogs elsewhere use the item-master vendor')}
        </Typography>
        <Stack direction="row" spacing={2} flexWrap="wrap" alignItems="center">
          <TextField size="small" label={tr('From')} type="date" value={dateFrom}
            onChange={e => setDateFrom(e.target.value)} InputLabelProps={{ shrink: true }} />
          <TextField size="small" label={tr('To')} type="date" value={dateTo}
            onChange={e => setDateTo(e.target.value)} InputLabelProps={{ shrink: true }} />
          <Autocomplete multiple disableCloseOnSelect size="small" options={storeList} value={stores}
            onChange={(_, v) => setStores(v)} sx={{ minWidth: 240 }}
            renderInput={p => <TextField {...p} placeholder={tr('All Stores')} size="small" />}
            renderTags={(val, gtp) => val.map((o, i) => <Chip label={o} size="small" {...gtp({ index: i })} key={o} />)} />
        </Stack>
      </Box>

      <Box sx={{ display:'flex', gap:2, flexWrap:'wrap', mb:2 }}>
        <KpiCard label="Supplier Count"    value={fmtN(kpi.count)}      icon="ti-truck"         color={C_PURPLE} />
        <KpiCard label="Total Purchased"   value={money(kpi.totalCost)}   icon="ti-coin"           color={C_CYAN}   />
        <KpiCard label="Avg Fill Rate"     value={pct(kpi.avgFill)}     icon="ti-circle-check"
          color={kpi.avgFill >= 90 ? C_GREEN : kpi.avgFill >= 70 ? C_AMBER : C_ROSE} />
        <KpiCard label="Top Supplier Share" value={pct(kpi.top1dep)}    icon="ti-alert-triangle"
          color={kpi.top1dep >= 30 ? C_ROSE : kpi.top1dep >= 15 ? C_AMBER : C_GREEN}
          sub="concentration risk" />
      </Box>

      {/* SRM tier legend */}
      <Stack direction="row" spacing={1} mb={2.5} flexWrap="wrap">
        {Object.entries(TIER_META).map(([tier, { color, desc }]) => (
          <Tooltip key={tier} title={tr(desc)} arrow>
            <Box sx={{ display:'flex', alignItems:'center', gap:0.6, px:1.5, py:0.5,
                       bgcolor:`${color}12`, border:`1px solid ${color}40`, borderRadius:2, cursor:'default' }}>
              <Box sx={{ width:7, height:7, borderRadius:'50%', bgcolor: color }} />
              <Typography sx={{ fontSize:11, fontWeight:700, color }}>{tr(tier)}</Typography>
              <Typography sx={{ fontSize:11, color, opacity:0.8 }}>·</Typography>
              <Typography sx={{ fontSize:11, fontWeight:600, color }}>{tierCounts[tier] ?? 0}</Typography>
            </Box>
          </Tooltip>
        ))}
      </Stack>

      <Box sx={{ bgcolor:'#fff', borderRadius:2, border:'1px solid #e2e8f0', p:2, mb:2.5 }}>
        <Typography sx={{ fontWeight:700, fontSize:13, mb:0.5 }}>{tr('Top 12 by Purchase Value')}</Typography>
        <Typography sx={{ fontSize:11, color: C_SLATE, mb:1.5 }}>{tr('Bar colour = SRM tier')}</Typography>
        <ReactECharts option={chartOpt} style={{ height: 320 }} />
      </Box>

      <Box sx={{ bgcolor:'#fff', borderRadius:2, border:'1px solid #e2e8f0', p:2 }}>
        <Stack direction="row" justifyContent="space-between" alignItems="center" mb={1.5}>
          <Typography sx={{ fontWeight:700, fontSize:13 }}>{trf('Supplier Detail — {{n}} suppliers',{n:merged.length})}</Typography>
          <GridExportBar gridRef={gridRef} filename="suppliers_srm" title="SRM — Supplier Intelligence"
            reportEndpoint="/api/purchases/by-vendor" reportPeriod="custom" reportParams={purParams}
            colDefs={colDefs} onResetColumns={resetColumns} />
        </Stack>
        <div className="ag-theme-alpine" style={{ height: 420 }}>
          <AgGridReact ref={gridRef} overlayNoRowsTemplate={noRowsOverlay()} rowData={merged} columnDefs={trCols(colDefs as any[])}
            defaultColDef={{ sortable:true, resizable:true, filter:true, wrapHeaderText:true, autoHeaderHeight:true }}
            rowHeight={36} headerHeight={38} suppressCellFocus
            onGridReady={onColGridReady} onColumnMoved={onColumnChanged}
            onColumnResized={onColumnChanged} onColumnVisible={onColumnChanged} />
        </div>
      </Box>
    </Box>
  )
}
