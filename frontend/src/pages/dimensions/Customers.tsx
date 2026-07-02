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
const C_INDIGO = '#4f46e5'

function num(v: any) {
  const n = +(v ?? 0)
  if (Math.abs(n) >= 1_000_000) return `${moneyPrefix()}${(n / 1_000_000).toFixed(1)}M`
  if (Math.abs(n) >= 1_000)     return `${moneyPrefix()}${(n / 1_000).toFixed(0)}K`
  return `${moneyPrefix()}${n.toLocaleString('en-US', { maximumFractionDigits: 0 })}`
}
function fmtN(v: any) { return (+(v ?? 0)).toLocaleString('en-US', { maximumFractionDigits: 0 }) }

const SEG_META: Record<string, { color: string; desc: string }> = {
  Champion: { color: C_PURPLE, desc: 'Bought recently, often, high LTV'  },
  Loyal:    { color: C_INDIGO, desc: 'Regular buyer, solid lifetime spend'},
  Active:   { color: C_CYAN,   desc: 'Visited in last 90 days'           },
  'At Risk':{ color: C_AMBER,  desc: '90–180 days since last visit'      },
  Dormant:  { color: C_ROSE,   desc: 'No visit in 180+ days'             },
  New:      { color: C_GREEN,  desc: 'First purchase < 90 days ago'      },
}

function daysDiff(dateStr: string | null | undefined): number {
  if (!dateStr) return 999
  return Math.floor((Date.now() - new Date(dateStr).getTime()) / 86400000)
}

function getSegment(row: any, p50ltv: number): string {
  const dormant = daysDiff(row.last_visit)
  const visits  = +(row.invoice_count  ?? 0)
  const ltv     = +(row.lifetime_value ?? 0)
  const tenure  = daysDiff(row.first_visit)
  if (tenure < 90)                                   return 'New'
  if (dormant > 180)                                 return 'Dormant'
  if (dormant > 90)                                  return 'At Risk'
  if (dormant <= 30 && visits >= 5 && ltv > p50ltv) return 'Champion'
  if (dormant <= 60 && visits >= 3)                  return 'Loyal'
  return 'Active'
}

export default function DimCustomers() {
  const gridRef = useRef<AgGridReact>(null)
  const { onGridReady: onColGridReady, onColumnChanged, resetColumns } = useGridColumnState('dim-customers')
  const [dateFrom, setDateFrom] = useState(prior)
  const [dateTo,   setDateTo  ] = useState(today)
  const [stores,   setStores  ] = useState<string[]>([])

  const { data: storeList = [] } = useQuery<string[]>({
    queryKey: ['stores-list'],
    queryFn:  () => axios.get('/api/sales/stores-list').then(r => r.data),
  })

  const params = {
    date_from: dateFrom, date_to: dateTo,   // no limit — all customers, grid paginates
    ...(stores.length ? { stores: stores.join(',') } : {}),
  }

  const { data: raw = [] } = useQuery({
    queryKey: ['dim-customers', dateFrom, dateTo, stores.join(',')],
    queryFn:  () => axios.get('/api/sales/perf/customers', { params }).then(r => r.data),
  })

  // Enrich with segment + days_dormant
  const rows = useMemo(() => {
    const r = raw as any[]
    const ltvs = r.map(x => +(x.lifetime_value ?? 0)).sort((a, b) => a - b)
    const p50ltv = ltvs[Math.floor(ltvs.length * 0.5)] ?? 0
    return r.map(x => ({
      ...x,
      days_dormant: daysDiff(x.last_visit),
      tenure_days:  daysDiff(x.first_visit),
      segment:      getSegment(x, p50ltv),
    }))
  }, [raw])

  const kpi = useMemo(() => {
    const totalLtv   = rows.reduce((s, x) => s + +(x.lifetime_value ?? 0), 0)
    const avgLtv     = rows.length > 0 ? totalLtv / rows.length : 0
    const atRisk     = rows.filter(x => x.segment === 'At Risk' || x.segment === 'Dormant').length
    return { count: rows.length, totalLtv, avgLtv, atRisk }
  }, [rows])

  const segCounts = useMemo(() => {
    const m: Record<string, number> = {}
    rows.forEach(r => { m[r.segment] = (m[r.segment] ?? 0) + 1 })
    return m
  }, [rows])

  const chartOpt = useMemo(() => {
    const top = rows.slice().sort((a, b) => +(b.lifetime_value ?? 0) - +(a.lifetime_value ?? 0)).slice(0, 15).reverse()
    return {
      grid: { top: 8, right: 140, bottom: 8, left: 8, containLabel: true },
      tooltip: {
        trigger: 'axis', axisPointer: { type: 'shadow' },
        formatter: (p: any[]) => {
          const d = top.find((x: any) => x.customer_name === p[0].name) ?? {}
          return `<b>${p[0].name}</b><br/>
            Segment: <b style="color:${SEG_META[d.segment]?.color}">${d.segment}</b><br/>
            Lifetime Value: <b>${num(d.lifetime_value)}</b><br/>
            Period Revenue: ${num(d.net_sales)}<br/>
            Visits: ${fmtN(d.invoice_count)} · Dormant: ${d.days_dormant}d<br/>
            Home Store: ${d.primary_store ?? '—'}`
        },
      },
      xAxis: { type: 'value', axisLabel: { formatter: (v: number) => num(v), fontSize: 10 } },
      yAxis: { type: 'category', data: top.map((x: any) => x.customer_name ?? '?'),
               axisLabel: { fontSize: 10, width: 160, overflow: 'truncate' } },
      series: [{
        type: 'bar', barMaxWidth: 22,
        data: top.map((x: any) => ({
          value: +(x.lifetime_value ?? 0),
          itemStyle: { color: SEG_META[x.segment]?.color ?? C_SLATE },
        })),
        itemStyle: { borderRadius: [0,4,4,0] },
        label: { show: true, position: 'right', formatter: (p: any) => num(p.value), fontSize: 10, color: C_SLATE },
      }],
    }
  }, [rows])

  const colDefs = useMemo<any[]>(() => [
    { field: 'customer_name', headerName: 'Customer',     flex: 2, pinned: 'left' as const, cellStyle: { fontWeight: 600 } },
    { field: 'phone',          headerName: 'Phone',       width: 140,
      cellStyle: { fontFamily: 'monospace', direction: 'ltr' as const } },
    { field: 'segment',       headerName: 'CRM Segment',  width: 120,
      cellRenderer: (p: any) => {
        const c = SEG_META[p.value]?.color ?? C_SLATE
        return <span style={{background:`${c}18`,color:c,border:`1px solid ${c}55`,borderRadius:'12px',padding:'2px 10px',fontSize:'11px',fontWeight:700}}>{p.value ?? '—'}</span>
      }},
    { field: 'primary_store',  headerName: 'Home Store',  width: 150 },
    { field: 'first_visit',    headerName: 'Active From',  width: 110 },
    { field: 'days_dormant',   headerName: 'Days Dormant', width: 110, type: 'numericColumn',
      cellStyle: (p: any) => ({ color: +(p.value??0) > 180 ? C_ROSE : +(p.value??0) > 90 ? C_AMBER : C_GREEN, fontWeight: 700 }) },
    { field: 'lifetime_value', headerName: 'Lifetime Value', width: 130, type: 'numericColumn', valueFormatter: (p: any) => num(p.value),
      cellStyle: { fontWeight: 700, color: C_PURPLE } },
    { field: 'avg_basket',     headerName: 'Avg Basket',  width: 110, type: 'numericColumn', valueFormatter: (p: any) => num(p.value) },
    { field: 'invoice_count',  headerName: 'Visits',      width: 80,  type: 'numericColumn' },
    { field: 'tenure_days',    headerName: 'Tenure (d)',  width: 100, type: 'numericColumn' },
  ], [])

  return (
    <Box sx={{ pt: 0, px: 3, pb: 3 }}>
      <Box sx={{ position:'sticky', top:0, zIndex:10, bgcolor:'#f8fafc',
                 mx:-3, px:3, pt:2.5, pb:1.5, mb:2, borderBottom:'1px solid #e9e4ff' }}>
        <Typography variant="h5" fontWeight={700} mb={1.5}>CRM — Customer Intelligence</Typography>
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
        <KpiCard label="Total Customers"  value={fmtN(kpi.count)}      icon="ti-users"       color={C_PURPLE} />
        <KpiCard label="Total LTV"        value={num(kpi.totalLtv)}     icon="ti-chart-line"  color={C_INDIGO}
          sub="all-time lifetime value" />
        <KpiCard label="Avg LTV / Customer" value={num(kpi.avgLtv)}    icon="ti-coin"        color={C_GREEN}  />
        <KpiCard label="At Risk + Dormant"  value={fmtN(kpi.atRisk)}   icon="ti-alert-triangle"
          color={kpi.atRisk > 0 ? C_AMBER : C_GREEN}
          sub={`${kpi.count > 0 ? ((kpi.atRisk / kpi.count)*100).toFixed(0) : 0}% of base`} />
      </Box>

      {/* Segment pill bar */}
      <Stack direction="row" spacing={1} mb={2.5} flexWrap="wrap">
        {Object.entries(SEG_META).map(([seg, { color, desc }]) => (
          <Tooltip key={seg} title={desc} arrow>
            <Box sx={{ display:'flex', alignItems:'center', gap:0.6, px:1.5, py:0.5,
                       bgcolor:`${color}12`, border:`1px solid ${color}40`, borderRadius:2, cursor:'default' }}>
              <Box sx={{ width:7, height:7, borderRadius:'50%', bgcolor: color }} />
              <Typography sx={{ fontSize:11, fontWeight:700, color }}>{seg}</Typography>
              <Typography sx={{ fontSize:11, color, opacity:0.8 }}>·</Typography>
              <Typography sx={{ fontSize:11, fontWeight:600, color }}>{segCounts[seg] ?? 0}</Typography>
            </Box>
          </Tooltip>
        ))}
      </Stack>

      <Box sx={{ bgcolor:'#fff', borderRadius:2, border:'1px solid #e2e8f0', p:2, mb:2.5 }}>
        <Typography sx={{ fontWeight:700, fontSize:13, mb:0.5 }}>Top 15 by Lifetime Value</Typography>
        <Typography sx={{ fontSize:11, color: C_SLATE, mb:1.5 }}>Bar colour = CRM segment</Typography>
        <ReactECharts option={chartOpt} style={{ height: 360 }} />
      </Box>

      <Box sx={{ bgcolor:'#fff', borderRadius:2, border:'1px solid #e2e8f0', p:2 }}>
        <Stack direction="row" justifyContent="space-between" alignItems="center" mb={1.5}>
          <Typography sx={{ fontWeight:700, fontSize:13 }}>Customer Detail — {rows.length} customers</Typography>
          <GridExportBar gridRef={gridRef} filename="customers_crm" title="CRM — Customer Intelligence"
            colDefs={colDefs} onResetColumns={resetColumns} />
        </Stack>
        <div className="ag-theme-alpine" style={{ height: 460 }}>
          <AgGridReact ref={gridRef} rowData={rows} columnDefs={colDefs}
            defaultColDef={{ sortable:true, resizable:true, filter:true }}
            pagination paginationPageSize={25}
            rowHeight={36} headerHeight={38} suppressCellFocus
            onGridReady={onColGridReady} onColumnMoved={onColumnChanged}
            onColumnResized={onColumnChanged} onColumnVisible={onColumnChanged} />
        </div>
      </Box>
    </Box>
  )
}
