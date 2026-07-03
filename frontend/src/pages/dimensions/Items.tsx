import { useState, useMemo } from 'react'
import { Box, Typography, Stack, TextField, Chip, Autocomplete, Tooltip } from '@mui/material'
import { useQuery } from '@tanstack/react-query'
import ReactECharts from 'echarts-for-react'
import { AgGridReact } from 'ag-grid-react'
import 'ag-grid-community/styles/ag-grid.css'
import 'ag-grid-community/styles/ag-theme-alpine.css'
import KpiCard from '../../components/KpiCard'
import GridExportBar from '../../components/GridExportBar'
import axios from 'axios'
import { useRef } from 'react'
import { useGridColumnState } from '../../hooks/useGridColumnState'
import { moneyPrefix } from '../../utils/formatters'
import { gmColor as gmColorOf, dohColor } from '../../utils/thresholds'

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

// ABC classification: revenue contribution
function abcClass(rev: number, cumRev: number, totalRev: number): string {
  const cumPct = cumRev / totalRev * 100
  if (cumPct <= 70) return 'A'
  if (cumPct <= 90) return 'B'
  return 'C'
}

// GP tier
function gpTier(gp_pct: number): string {
  if (gp_pct >= 40) return 'Premium'
  if (gp_pct >= 20) return 'Standard'
  if (gp_pct >= 0)  return 'Low Margin'
  return 'Loss'
}
const GP_META: Record<string, { color: string; desc: string }> = {
  Premium:    { color: C_PURPLE, desc: 'GP ≥ 40% — protect price integrity'     },
  Standard:   { color: C_GREEN,  desc: 'GP 20–40% — healthy contribution'       },
  'Low Margin':{ color: C_AMBER, desc: 'GP 0–20% — review pricing or cost'      },
  Loss:       { color: C_ROSE,   desc: 'Negative GP — immediate attention needed'},
}

export default function DimItems() {
  const gridRef = useRef<AgGridReact>(null)
  const { onGridReady: onColGridReady, onColumnChanged, resetColumns } = useGridColumnState('dim-items')
  const [dateFrom, setDateFrom] = useState(prior)
  const [dateTo,   setDateTo  ] = useState(today)
  const [stores,   setStores  ] = useState<string[]>([])

  const { data: storeList = [] } = useQuery<string[]>({
    queryKey: ['stores-list'],
    queryFn:  () => axios.get('/api/sales/stores-list').then(r => r.data),
  })

  const params = {
    date_from: dateFrom, date_to: dateTo, group_by: 'item',
    limit: 500,   // top 500 SKUs by revenue (backend default is 20)
    ...(stores.length ? { stores: stores.join(',') } : {}),
  }

  const { data: raw = [] } = useQuery({
    queryKey: ['dim-items', dateFrom, dateTo, stores.join(',')],
    queryFn:  () => axios.get('/api/sales/products', { params }).then(r => r.data),
  })

  // Enrich with ABC class + GP tier
  const rows = useMemo(() => {
    const r = (raw as any[]).slice().sort((a, b) => +(b.revenue ?? 0) - +(a.revenue ?? 0))
    const totalRev = r.reduce((s, x) => s + +(x.revenue ?? 0), 0)
    let cumRev = 0
    return r.map(x => {
      cumRev += +(x.revenue ?? 0)
      return {
        ...x,
        abc:      abcClass(+(x.revenue ?? 0), cumRev, totalRev || 1),
        gp_tier:  gpTier(+(x.gp_pct ?? 0)),
        rev_share: totalRev > 0 ? +((+(x.revenue ?? 0) / totalRev * 100).toFixed(2)) : 0,
      }
    })
  }, [raw])

  const kpi = useMemo(() => {
    const totalRev  = rows.reduce((s, x) => s + +(x.revenue ?? 0), 0)
    const totalGP   = rows.reduce((s, x) => s + +(x.gp      ?? 0), 0)
    const avgGPpct  = totalRev > 0 ? (totalGP / totalRev * 100) : 0
    const lossItems = rows.filter(x => +(x.gp_pct ?? 0) < 0).length
    return { count: rows.length, totalRev, totalGP, avgGPpct, lossItems }
  }, [rows])

  const gpCounts = useMemo(() => {
    const m: Record<string, number> = {}
    rows.forEach(r => { m[r.gp_tier] = (m[r.gp_tier] ?? 0) + 1 })
    return m
  }, [rows])

  const chartOpt = useMemo(() => {
    const top = rows.slice(0, 15).reverse()
    return {
      grid: { top: 8, right: 100, bottom: 8, left: 8, containLabel: true },
      tooltip: {
        trigger: 'axis', axisPointer: { type: 'shadow' },
        formatter: (p: any[]) => {
          const label = p[0]?.name ?? ''
          const d = rows.find((x: any) => `${x.ALU} ${(x.DESCRIPTION1 ?? '').slice(0,20)}` === label) ?? {}
          return `<b>${label}</b><br/>
            ABC: <b>${d.abc}</b> · GP Tier: <b style="color:${GP_META[d.gp_tier]?.color}">${d.gp_tier}</b><br/>
            Revenue: <b>${num(d.revenue)}</b> (${pct(d.rev_share)} of total)<br/>
            GP: ${num(d.gp)} @ ${pct(d.gp_pct)}<br/>
            Qty Sold: ${fmtN(d.qty)}`
        },
      },
      xAxis: { type: 'value', axisLabel: { formatter: (v: number) => num(v), fontSize: 10 } },
      yAxis: { type: 'category',
               data: top.map((x: any) => `${x.ALU} ${(x.DESCRIPTION1 ?? '').slice(0, 20)}`),
               axisLabel: { fontSize: 9, width: 190, overflow: 'truncate' } },
      series: [{
        type: 'bar', barMaxWidth: 20,
        data: top.map((x: any) => ({
          value: +(x.revenue ?? 0),
          itemStyle: { color: GP_META[x.gp_tier]?.color ?? C_SLATE },
        })),
        itemStyle: { borderRadius: [0,4,4,0] },
        label: { show: true, position: 'right', formatter: (p: any) => num(p.value), fontSize: 10, color: C_SLATE },
      }],
    }
  }, [rows])

  const colDefs = useMemo<any[]>(() => [
    { field: 'ALU',          headerName: 'ALU',         width: 105, pinned: 'left' as const,
      cellStyle: { fontFamily: 'monospace', color: C_PURPLE } },
    { field: 'abc',          headerName: 'ABC',         width: 65,
      cellStyle: (p: any) => ({
        fontWeight: 800, fontSize: 13, textAlign: 'center',
        color: p.value === 'A' ? C_PURPLE : p.value === 'B' ? C_CYAN : C_SLATE,
      })},
    { field: 'gp_tier',      headerName: 'GP Tier',     width: 110,
      cellRenderer: (p: any) => {
        const c = GP_META[p.value]?.color ?? C_SLATE
        return <span style={{background:`${c}18`,color:c,border:`1px solid ${c}55`,borderRadius:'12px',padding:'2px 9px',fontSize:'11px',fontWeight:700}}>{p.value ?? '—'}</span>
      }},
    { field: 'DESCRIPTION1', headerName: 'Description', flex: 2, minWidth: 160 },
    { field: 'VEND_NAME',    headerName: 'Item Vendor', width: 150,
      headerTooltip: 'Vendor from the item master (catalog) — not necessarily the supplier purchased from' },
    { field: 'revenue',      headerName: 'Revenue',     width: 115, type: 'numericColumn', valueFormatter: (p: any) => num(p.value),
      cellStyle: { fontWeight: 600 } },
    { field: 'rev_share',    headerName: 'Share %',     width: 85,  type: 'numericColumn', valueFormatter: (p: any) => pct(p.value) },
    { field: 'gp_pct',       headerName: 'GP %',        width: 82,  type: 'numericColumn', valueFormatter: (p: any) => pct(p.value),
      cellStyle: (p: any) => ({ color: +(p.value??0) >= 40 ? C_PURPLE : +(p.value??0) >= 20 ? C_GREEN : +(p.value??0) >= 0 ? C_AMBER : C_ROSE, fontWeight: 700 }) },
    { field: 'gp',           headerName: 'GP $',        width: 110, type: 'numericColumn', valueFormatter: (p: any) => num(p.value) },
    { field: 'qty',          headerName: 'Qty Sold',    width: 90,  type: 'numericColumn', valueFormatter: (p: any) => fmtN(p.value) },
  ], [])

  return (
    <Box sx={{ pt: 0, px: 3, pb: 3 }}>
      <Box sx={{ position:'sticky', top:0, zIndex:10, bgcolor:'#f8fafc',
                 mx:-3, px:3, pt:2.5, pb:1.5, mb:2, borderBottom:'1px solid #e9e4ff' }}>
        <Typography variant="h5" fontWeight={700} mb={1.5}>Item / SKU Intelligence</Typography>
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
        <KpiCard label="Active SKUs"   value={fmtN(kpi.count)}     icon="ti-barcode"     color={C_PURPLE} />
        <KpiCard label="Avg GP %"      value={pct(kpi.avgGPpct)}   icon="ti-chart-pie-2"
          color={gmColorOf(kpi.avgGPpct)} />
        <KpiCard label="Total GP"      value={num(kpi.totalGP)}    icon="ti-trending-up" color={C_GREEN}  />
        <KpiCard label="Loss-Making SKUs" value={fmtN(kpi.lossItems)} icon="ti-alert-triangle"
          color={kpi.lossItems > 0 ? C_ROSE : C_GREEN}
          sub={`${kpi.count > 0 ? ((kpi.lossItems / kpi.count)*100).toFixed(0) : 0}% of portfolio`} />
      </Box>

      {/* GP tier legend */}
      <Stack direction="row" spacing={1} mb={2.5} flexWrap="wrap">
        {Object.entries(GP_META).map(([tier, { color, desc }]) => (
          <Tooltip key={tier} title={desc} arrow>
            <Box sx={{ display:'flex', alignItems:'center', gap:0.6, px:1.5, py:0.5,
                       bgcolor:`${color}12`, border:`1px solid ${color}40`, borderRadius:2, cursor:'default' }}>
              <Box sx={{ width:7, height:7, borderRadius:'50%', bgcolor: color }} />
              <Typography sx={{ fontSize:11, fontWeight:700, color }}>{tier}</Typography>
              <Typography sx={{ fontSize:11, color, opacity:0.8 }}>·</Typography>
              <Typography sx={{ fontSize:11, fontWeight:600, color }}>{gpCounts[tier] ?? 0}</Typography>
            </Box>
          </Tooltip>
        ))}
        <Box sx={{ ml:'auto', display:'flex', alignItems:'center', gap:2, fontSize:11, color: C_SLATE }}>
          {['A','B','C'].map(c => (
            <Box key={c} sx={{ display:'flex', alignItems:'center', gap:0.5 }}>
              <Typography sx={{ fontSize:12, fontWeight:800, color: c === 'A' ? C_PURPLE : c === 'B' ? C_CYAN : C_SLATE }}>{c}</Typography>
              <Typography sx={{ fontSize:11, color: C_SLATE }}>{c === 'A' ? '70%' : c === 'B' ? '20%' : '10%'} revenue</Typography>
            </Box>
          ))}
        </Box>
      </Stack>

      <Box sx={{ bgcolor:'#fff', borderRadius:2, border:'1px solid #e2e8f0', p:2, mb:2.5 }}>
        <Typography sx={{ fontWeight:700, fontSize:13, mb:0.5 }}>Top 15 SKUs by Revenue</Typography>
        <Typography sx={{ fontSize:11, color: C_SLATE, mb:1.5 }}>Bar colour = GP tier</Typography>
        <ReactECharts option={chartOpt} style={{ height: 380 }} />
      </Box>

      <Box sx={{ bgcolor:'#fff', borderRadius:2, border:'1px solid #e2e8f0', p:2 }}>
        <Stack direction="row" justifyContent="space-between" alignItems="center" mb={1.5}>
          <Typography sx={{ fontWeight:700, fontSize:13 }}>Item Detail — {rows.length} SKUs</Typography>
          <GridExportBar gridRef={gridRef} filename="items_sku_analysis" title="Item / SKU Intelligence"
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
