import { useState, useMemo } from 'react'
import { tr, trCols } from '../../i18n'
import { Box, Typography, Stack, TextField, Chip, Autocomplete, Tooltip } from '@mui/material'
import { useQuery } from '@tanstack/react-query'
import ReactECharts from 'echarts-for-react'
import { AgGridReact } from 'ag-grid-react'
import 'ag-grid-community/styles/ag-grid.css'
import 'ag-grid-community/styles/ag-theme-alpine.css'
import KpiCard from '../../components/KpiCard'
import GridExportBar from '../../components/GridExportBar'
import { useGridColumnState } from '../../hooks/useGridColumnState'
import axios from 'axios'
import { useRef } from 'react'
import { moneyPrefix } from '../../utils/formatters'

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

const LIFECYCLE_META: Record<string, { color: string; desc: string }> = {
  New:     { color: C_GREEN,  desc: 'First sale < 90 days ago'          },
  Growing: { color: C_AMBER,  desc: 'Active 90–365 days'                },
  Mature:  { color: C_PURPLE, desc: 'Established store > 1 year active' },
}

function daysSince(dateStr: string | null | undefined): number {
  if (!dateStr) return 0
  return Math.floor((Date.now() - new Date(dateStr).getTime()) / 86400000)
}

export default function DimStores() {
  const gridRef = useRef<AgGridReact>(null)
  const { onGridReady: onColGridReady, onColumnChanged, resetColumns } = useGridColumnState('dim-stores')
  const [dateFrom, setDateFrom] = useState(prior)
  const [dateTo,   setDateTo  ] = useState(today)
  const [stores,   setStores  ] = useState<string[]>([])

  const { data: storeList = [] } = useQuery<string[]>({
    queryKey: ['stores-list'],
    queryFn:  () => axios.get('/api/sales/stores-list').then(r => r.data),
  })

  const params = {
    date_from: dateFrom, date_to: dateTo,
    ...(stores.length ? { stores: stores.join(',') } : {}),
  }

  const { data: raw = [] } = useQuery({
    queryKey: ['dim-stores', dateFrom, dateTo, stores.join(',')],
    queryFn:  () => axios.get('/api/sales/perf/stores', { params }).then(r => r.data),
  })

  const rows = useMemo(() => {
    const r = raw as any[]
    const totalRev = r.reduce((s, x) => s + +(x.net_sales ?? 0), 0)
    return r.map(x => ({
      ...x,
      days_active:     daysSince(x.first_sale_date),
      contribution_pct: totalRev > 0 ? +((+(x.net_sales ?? 0) / totalRev * 100).toFixed(1)) : 0,
    }))
  }, [raw])

  const kpi = useMemo(() => {
    const totalRev      = rows.reduce((s, x) => s + +(x.net_sales       ?? 0), 0)
    const lifetimeTotal = rows.reduce((s, x) => s + +(x.lifetime_revenue ?? 0), 0)
    const totalRet      = rows.reduce((s, x) => s + +(x.return_amt       ?? 0), 0)
    const avgReturn     = totalRev > 0 ? (totalRet / totalRev * 100) : 0
    return { count: rows.length, totalRev, lifetimeTotal, avgReturn }
  }, [rows])

  const lifecycleCounts = useMemo(() => {
    const m: Record<string, number> = {}
    rows.forEach(r => { m[r.lifecycle ?? ''] = (m[r.lifecycle ?? ''] ?? 0) + 1 })
    return m
  }, [rows])

  const chartOpt = useMemo(() => {
    const r = rows.slice().sort((a, b) => +(b.net_sales ?? 0) - +(a.net_sales ?? 0)).slice(0, 12).reverse()
    return {
      grid: { top: 8, right: 120, bottom: 8, left: 8, containLabel: true },
      tooltip: {
        trigger: 'axis', axisPointer: { type: 'shadow' },
        formatter: (p: any[]) => {
          const d = rows.find((x: any) => x.store_name === p[0].name) ?? {}
          return `<b>${p[0].name}</b><br/>
            Stage: <b style="color:${LIFECYCLE_META[d.lifecycle]?.color}">${d.lifecycle}</b> · Active Since: ${d.first_sale_date ?? '—'}<br/>
            Period Revenue: <b>${num(d.net_sales)}</b> (${pct(d.contribution_pct)} of chain)<br/>
            Lifetime Revenue: ${num(d.lifetime_revenue)}<br/>
            Return%: ${pct(d.return_rate)} · Disc%: ${pct(d.disc_rate)}`
        },
      },
      xAxis: { type: 'value', axisLabel: { formatter: (v: number) => num(v), fontSize: 10, color: C_SLATE } },
      yAxis: { type: 'category', data: r.map((x: any) => x.store_name ?? '?'), axisLabel: { fontSize: 11 } },
      series: [{
        type: 'bar', barMaxWidth: 22,
        data: r.map((x: any) => ({
          value: +(x.net_sales ?? 0),
          itemStyle: { color: LIFECYCLE_META[x.lifecycle]?.color ?? C_SLATE },
        })),
        itemStyle: { borderRadius: [0,4,4,0] },
        label: { show: true, position: 'right', formatter: (p: any) => num(p.value), fontSize: 10, color: C_SLATE },
      }],
    }
  }, [rows])

  const colDefs = useMemo<any[]>(() => [
    { field: 'store_name',       headerName: 'Store',          flex: 1.5, pinned: 'left' as const, cellStyle: { fontWeight: 700 } },
    { field: 'lifecycle',        headerName: 'Stage',          width: 95,
      cellRenderer: (p: any) => {
        const c = LIFECYCLE_META[p.value]?.color ?? C_SLATE
        return <span style={{background:`${c}18`,color:c,border:`1px solid ${c}55`,borderRadius:'12px',padding:'2px 10px',fontSize:'11px',fontWeight:700}}>{p.value ?? '—'}</span>
      }},
    { field: 'first_sale_date',  headerName: 'Active From',    width: 115 },
    { field: 'days_active',      headerName: 'Days Active',    width: 105, type: 'numericColumn', valueFormatter: (p: any) => fmtN(p.value) },
    { field: 'contribution_pct', headerName: 'Chain Share %',  width: 110, type: 'numericColumn', valueFormatter: (p: any) => pct(p.value),
      cellStyle: (p: any) => ({ color: +(p.value??0) >= 20 ? C_PURPLE : +(p.value??0) >= 10 ? C_CYAN : C_SLATE, fontWeight: 700 }) },
    { field: 'net_sales',        headerName: 'Period Revenue', width: 130, type: 'numericColumn', valueFormatter: (p: any) => num(p.value) },
    { field: 'lifetime_revenue', headerName: 'Lifetime Rev',   width: 130, type: 'numericColumn', valueFormatter: (p: any) => num(p.value),
      cellStyle: { fontWeight: 700, color: C_PURPLE } },
    { field: 'return_rate',      headerName: 'Return %',       width: 100, type: 'numericColumn', valueFormatter: (p: any) => pct(p.value),
      cellStyle: (p: any) => ({ color: +(p.value??0) > 10 ? C_ROSE : +(p.value??0) > 5 ? C_AMBER : C_GREEN, fontWeight: 700 }) },
    { field: 'disc_rate',        headerName: 'Disc %',         width: 90,  type: 'numericColumn', valueFormatter: (p: any) => pct(p.value) },
  ], [])

  return (
    <Box sx={{ pt: 0, px: 3, pb: 3 }}>
      <Box sx={{ position:'sticky', top:0, zIndex:10, bgcolor:'#f8fafc',
                 mx:-3, px:3, pt:2.5, pb:1.5, mb:2, borderBottom:'1px solid #e9e4ff' }}>
        <Typography variant="h5" fontWeight={700} mb={1.5}>{tr('Store Intelligence')}</Typography>
        <Stack direction="row" spacing={2} flexWrap="wrap" alignItems="center">
          <TextField size="small" label="From" type="date" value={dateFrom}
            onChange={e => setDateFrom(e.target.value)} InputLabelProps={{ shrink: true }} />
          <TextField size="small" label="To" type="date" value={dateTo}
            onChange={e => setDateTo(e.target.value)} InputLabelProps={{ shrink: true }} />
          <Autocomplete multiple disableCloseOnSelect size="small" options={storeList} value={stores}
            onChange={(_, v) => setStores(v)} sx={{ minWidth: 240 }}
            renderInput={p => <TextField {...p} placeholder="All Stores" size="small" />}
            renderTags={(val, gtp) => val.map((o, i) => <Chip label={o} size="small" {...gtp({ index: i })} key={o} />)} />
        </Stack>
      </Box>

      <Box sx={{ display:'flex', gap:2, flexWrap:'wrap', mb:2 }}>
        <KpiCard label="Active Stores"    value={fmtN(kpi.count)}         icon="ti-building-store" color={C_PURPLE} />
        <KpiCard label="Period Revenue"   value={num(kpi.totalRev)}        icon="ti-cash"           color={C_CYAN}   />
        <KpiCard label="Lifetime Revenue" value={num(kpi.lifetimeTotal)}   icon="ti-chart-line"     color={C_GREEN}
          sub="all-time chain total" />
        <KpiCard label="Avg Return Rate"  value={pct(kpi.avgReturn)}       icon="ti-arrow-back"
          color={kpi.avgReturn > 10 ? C_ROSE : kpi.avgReturn > 5 ? C_AMBER : C_GREEN} />
      </Box>

      {/* Lifecycle legend */}
      <Stack direction="row" spacing={1} mb={2.5}>
        {Object.entries(LIFECYCLE_META).map(([stage, { color, desc }]) => (
          <Tooltip key={stage} title={desc} arrow>
            <Box sx={{ display:'flex', alignItems:'center', gap:0.6, px:1.5, py:0.5,
                       bgcolor:`${color}12`, border:`1px solid ${color}40`, borderRadius:2, cursor:'default' }}>
              <Box sx={{ width:7, height:7, borderRadius:'50%', bgcolor: color }} />
              <Typography sx={{ fontSize:11, fontWeight:700, color }}>{stage}</Typography>
              <Typography sx={{ fontSize:11, color, opacity:0.8 }}>·</Typography>
              <Typography sx={{ fontSize:11, fontWeight:600, color }}>{lifecycleCounts[stage] ?? 0}</Typography>
            </Box>
          </Tooltip>
        ))}
      </Stack>

      <Box sx={{ bgcolor:'#fff', borderRadius:2, border:'1px solid #e2e8f0', p:2, mb:2.5 }}>
        <Typography sx={{ fontWeight:700, fontSize:13, mb:0.5 }}>Revenue Ranking by Store</Typography>
        <Typography sx={{ fontSize:11, color: C_SLATE, mb:1.5 }}>Bar colour = lifecycle stage</Typography>
        <ReactECharts option={chartOpt} style={{ height: 300 }} />
      </Box>

      <Box sx={{ bgcolor:'#fff', borderRadius:2, border:'1px solid #e2e8f0', p:2 }}>
        <Stack direction="row" justifyContent="space-between" alignItems="center" mb={1.5}>
          <Typography sx={{ fontWeight:700, fontSize:13 }}>Store Detail — {rows.length} stores</Typography>
          <GridExportBar gridRef={gridRef} filename="stores" title="Store Intelligence"
            colDefs={colDefs} onResetColumns={resetColumns} />
        </Stack>
        <div className="ag-theme-alpine" style={{ height: 380 }}>
          <AgGridReact ref={gridRef} rowData={rows} columnDefs={trCols(colDefs as any[])}
            defaultColDef={{ sortable:true, resizable:true, filter:true }}
            rowHeight={36} headerHeight={38} suppressCellFocus
            onGridReady={onColGridReady} onColumnMoved={onColumnChanged}
            onColumnResized={onColumnChanged} onColumnVisible={onColumnChanged} />
        </div>
      </Box>
    </Box>
  )
}
