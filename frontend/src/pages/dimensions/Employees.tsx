import { useState, useMemo } from 'react'
import { tr, trf, trCols } from '../../i18n'
import TitleLoader from '../../components/TitleLoader'
import { Box, Typography, Stack, TextField, Chip, Autocomplete, Tooltip } from '@mui/material'
import { useQuery } from '@tanstack/react-query'
import ReactECharts from '../../components/ReactEChartsThemed'
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

// Performance tier relative to team average
function perfTier(revPerInv: number, avgRevPerInv: number): string {
  if (revPerInv >= avgRevPerInv * 1.3) return 'Top'
  if (revPerInv >= avgRevPerInv * 0.9) return 'Good'
  if (revPerInv >= avgRevPerInv * 0.6) return 'Average'
  return 'Below'
}
const PERF_META: Record<string, { color: string }> = {
  Top:     { color: C_PURPLE },
  Good:    { color: C_GREEN  },
  Average: { color: C_CYAN   },
  Below:   { color: C_ROSE   },
}

export default function DimEmployees() {
  const gridRef = useRef<AgGridReact>(null)
  const { onGridReady: onColGridReady, onColumnChanged, resetColumns } = useGridColumnState('dim-employees')
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
    queryKey: ['dim-employees', dateFrom, dateTo, stores.join(',')],
    queryFn:  () => axios.get('/api/sales/perf/associates', { params }).then(r => r.data),
  })

  const rows = useMemo(() => {
    const r = raw as any[]
    const totalRev   = r.reduce((s, x) => s + +(x.net_sales ?? 0), 0)
    const totalInv   = r.reduce((s, x) => s + +(x.invoice_count ?? 0), 0)
    const avgRevPerInv = totalInv > 0 ? totalRev / totalInv : 0
    return r.map(x => {
      const rev_per_inv = +(x.invoice_count ?? 0) > 0
        ? +(x.net_sales ?? 0) / +(x.invoice_count ?? 0) : 0
      return {
        ...x,
        rev_per_inv: +rev_per_inv.toFixed(2),
        perf_tier:   perfTier(rev_per_inv, avgRevPerInv),
      }
    })
  }, [raw])

  const kpi = useMemo(() => {
    const totalInv    = rows.reduce((s, x) => s + +(x.invoice_count ?? 0), 0)
    const totalRev    = rows.reduce((s, x) => s + +(x.net_sales ?? 0), 0)
    const avgRevPerInv = totalInv > 0 ? totalRev / totalInv : 0
    const avgDisc     = rows.length > 0 ? rows.reduce((s, x) => s + +(x.disc_rate ?? 0), 0) / rows.length : 0
    const topName     = rows.length > 0 ? rows.reduce((a, b) => +(a.net_sales ?? 0) > +(b.net_sales ?? 0) ? a : b).employee_name : '—'
    return { count: rows.length, avgRevPerInv, avgDisc, topName }
  }, [rows])

  const chartOpt = useMemo(() => {
    const r = rows.slice().sort((a, b) => +(b.net_sales ?? 0) - +(a.net_sales ?? 0)).slice(0, 12).reverse()
    return {
      grid: { top: 8, right: 110, bottom: 8, left: 8, containLabel: true },
      tooltip: {
        trigger: 'axis', axisPointer: { type: 'shadow' },
        formatter: (p: any[]) => {
          const d = r.find((x: any) => x.employee_name === p[0].name) ?? {}
          return `<b>${p[0].name}</b><br/>
            Tier: <b style="color:${PERF_META[d.perf_tier]?.color}">${d.perf_tier}</b><br/>
            Revenue: <b>${num(d.net_sales)}</b><br/>
            Rev/Invoice: ${num(d.rev_per_inv)}<br/>
            Disc%: ${pct(d.disc_rate)} · Return%: ${pct(d.return_rate)}<br/>
            Store: ${d.store_name}`
        },
      },
      xAxis: { type: 'value', axisLabel: { formatter: (v: number) => num(v), fontSize: 10 } },
      yAxis: { type: 'category', data: r.map((x: any) => x.employee_name ?? '?'),
               axisLabel: { fontSize: 10, width: 140, overflow: 'truncate' } },
      series: [{
        type: 'bar', barMaxWidth: 20,
        data: r.map((x: any) => ({
          value: +(x.net_sales ?? 0),
          itemStyle: { color: PERF_META[x.perf_tier]?.color ?? C_SLATE },
        })),
        itemStyle: { borderRadius: [0,4,4,0] },
        label: { show: true, position: 'right', formatter: (p: any) => num(p.value), fontSize: 10, color: C_SLATE },
      }],
    }
  }, [rows])

  const tierCounts = useMemo(() => {
    const m: Record<string, number> = {}
    rows.forEach(r => { m[r.perf_tier] = (m[r.perf_tier] ?? 0) + 1 })
    return m
  }, [rows])

  const colDefs = useMemo<any[]>(() => [
    { field: 'employee_name', headerName: 'Associate',     flex: 1.5, pinned: 'left' as const, cellStyle: { fontWeight: 600 } },
    { field: 'perf_tier',     headerName: 'Performance',   width: 115,
      cellRenderer: (p: any) => {
        const c = PERF_META[p.value]?.color ?? C_SLATE
        return <span style={{background:`${c}18`,color:c,border:`1px solid ${c}55`,borderRadius:'12px',padding:'2px 10px',fontSize:'11px',fontWeight:700}}>{p.value ? tr(p.value) : '—'}</span>
      }},
    { field: 'store_name',    headerName: 'Store',         width: 160 },
    { field: 'net_sales',     headerName: 'Revenue',       width: 120, type: 'numericColumn', valueFormatter: (p: any) => num(p.value),
      cellStyle: { fontWeight: 600, color: C_PURPLE } },
    { field: 'rev_per_inv',   headerName: 'Rev / Invoice', width: 120, type: 'numericColumn', valueFormatter: (p: any) => num(p.value) },
    { field: 'invoice_count', headerName: 'Invoices',      width: 90,  type: 'numericColumn' },
    { field: 'disc_rate',     headerName: 'Disc %',        width: 85,  type: 'numericColumn', valueFormatter: (p: any) => pct(p.value),
      cellStyle: (p: any) => ({ color: +(p.value??0) > 15 ? C_ROSE : +(p.value??0) > 8 ? C_AMBER : C_GREEN, fontWeight: 700 }) },
    { field: 'return_rate',   headerName: 'Return %',      width: 95,  type: 'numericColumn', valueFormatter: (p: any) => pct(p.value),
      cellStyle: (p: any) => ({ color: +(p.value??0) > 10 ? C_ROSE : +(p.value??0) > 5 ? C_AMBER : C_SLATE }) },
  ], [])

  return (
    <Box sx={{ pt: 0, px: 3, pb: 3 }}>
      <Box sx={{ position:'sticky', top:0, zIndex:10, bgcolor: 'var(--rt-surface-2)',
                 mx:-3, px:3, pt:2.5, pb:1.5, mb:2, borderBottom:'1px solid var(--rt-border)' }}>
        <Typography variant="h6" sx={{ fontWeight:700, fontSize:20, color: 'var(--rt-text)', letterSpacing:'-0.3px', mb:1.5 }}>{tr('Employee Performance Intelligence')}<TitleLoader /></Typography>
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
        <KpiCard label="Head Count"       value={fmtN(kpi.count)}         icon="ti-id-badge-2"  color={C_PURPLE} />
        <KpiCard label="Avg Rev / Invoice" value={money(kpi.avgRevPerInv)}  icon="ti-receipt"     color={C_CYAN}
          sub="team productivity index" />
        <KpiCard label="Avg Disc %"        value={pct(kpi.avgDisc)}       icon="ti-discount"
          color={kpi.avgDisc > 15 ? C_ROSE : kpi.avgDisc > 8 ? C_AMBER : C_GREEN} />
        <KpiCard label="Top Performer"     value={kpi.topName}            icon="ti-trophy"      color={C_GREEN} />
      </Box>

      {/* Performance legend */}
      <Stack direction="row" spacing={1} mb={2.5}>
        {Object.entries(PERF_META).map(([tier, { color }]) => (
          <Tooltip key={tier} title={tr('vs team avg rev/invoice')} arrow>
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

      <Box sx={{ bgcolor: 'var(--rt-surface)', borderRadius:2, border:'1px solid var(--rt-border)', p:2, mb:2.5 }}>
        <Typography sx={{ fontWeight:700, fontSize:13, mb:0.5 }}>{tr('Revenue Ranking — Top 12')}</Typography>
        <Typography sx={{ fontSize:11, color: C_SLATE, mb:1.5 }}>{tr('Bar colour = performance tier vs team average')}</Typography>
        <ReactECharts option={chartOpt} style={{ height: 320 }} />
      </Box>

      <Box sx={{ bgcolor: 'var(--rt-surface)', borderRadius:2, border:'1px solid var(--rt-border)', p:2 }}>
        <Stack direction="row" justifyContent="space-between" alignItems="center" mb={1.5}>
          <Typography sx={{ fontWeight:700, fontSize:13 }}>{trf('Associate Detail — {{n}}',{n:rows.length})}</Typography>
          <GridExportBar gridRef={gridRef} filename="employees_performance" title="Employee Performance Intelligence"
            reportEndpoint="/api/sales/perf/associates" reportPeriod="custom" reportParams={params}
            colDefs={colDefs} onResetColumns={resetColumns} />
        </Stack>
        <div className="ag-theme-alpine" style={{ height: 420 }}>
          <AgGridReact ref={gridRef} rowData={rows} columnDefs={trCols(colDefs as any[])}
            overlayNoRowsTemplate={noRowsOverlay()}
            defaultColDef={{ sortable:true, resizable:true, filter:true, wrapHeaderText:true, autoHeaderHeight:true }}
            rowHeight={36} headerHeight={38} suppressCellFocus
            onGridReady={onColGridReady} onColumnMoved={onColumnChanged}
            onColumnResized={onColumnChanged} onColumnVisible={onColumnChanged} />
        </div>
      </Box>
    </Box>
  )
}
