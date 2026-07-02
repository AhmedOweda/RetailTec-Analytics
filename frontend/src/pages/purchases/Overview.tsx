/**
 * Purchases Overview
 * ==================
 * KPIs · Daily Trend · By Vendor · By Dept · By Store · By Status
 */
import { useState, useMemo } from 'react'
import {
  Box, Typography, Grid, Paper, Chip, Stack,
  TextField, FormControl, InputLabel, Select, MenuItem,
  OutlinedInput, Checkbox, ListItemText, CircularProgress,
} from '@mui/material'
import { useQuery } from '@tanstack/react-query'
import axios from 'axios'
import ReactECharts from 'echarts-for-react'
import KpiCard      from '../../components/KpiCard'
import { moneyPrefix } from '../../utils/formatters'

// ── Types ─────────────────────────────────────────────────────────────────────

interface KPI {
  vou_count: number; vendor_count: number; store_count: number
  total_cost: number; subtotal: number; total_disc: number
  ord_qty: number; recv_qty: number; line_count: number
  received_count: number; pending_count: number; recv_pct: number
}
interface TrendRow  { vou_date: string; vou_count: number; total_cost: number; recv_qty: number; ord_qty: number }
interface VendRow   { vendor_name: string; vou_count: number; total_cost: number; recv_qty: number; ord_qty: number; line_count: number }
interface DeptRow   { department: string; vou_count: number; sku_count: number; recv_qty: number; total_cost: number; total_retail: number }
interface StoreRow  { store_name: string; vou_count: number; total_cost: number; recv_qty: number; ord_qty: number }
interface StatusRow { status_label: string; status: number; vou_count: number; total_cost: number; recv_qty: number }

// ── Colours ───────────────────────────────────────────────────────────────────

const C = {
  purple: '#7c3aed',
  blue:   '#2563eb',
  green:  '#059669',
  amber:  '#d97706',
  rose:   '#e11d48',
  sky:    '#0284c7',
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const toISO  = (d: Date) => d.toISOString().slice(0, 10)
const today  = toISO(new Date())
const daysAgo = (n: number) => toISO(new Date(Date.now() - n * 86400000))
const startOf = (unit: 'month' | 'year') => {
  const d = new Date()
  if (unit === 'month') d.setDate(1)
  else { d.setMonth(0); d.setDate(1) }
  return toISO(d)
}

const PRESETS: Record<string, [string, string]> = {
  '30D': [daysAgo(29), today],
  'MTD': [startOf('month'), today],
  'YTD': [startOf('year'),  today],
  '90D': [daysAgo(89), today],
}

const fmt  = (n: number) => (n ?? 0).toLocaleString('en-US', { maximumFractionDigits: 0 })
const fmtC = (n: number) => moneyPrefix() + (n ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
// KPI cards: whole numbers only (no decimals)
const fmtC0 = (n: number) => moneyPrefix() + Math.round(n ?? 0).toLocaleString('en-US')

// ── Dropdown data ─────────────────────────────────────────────────────────────

function useStores() {
  const { data } = useQuery({
    queryKey: ['stores-list'],
    queryFn:  () => axios.get('/api/inventory/stores-list').then(r => r.data as { STORE_NAME: string }[]),
    staleTime: Infinity,
  })
  return data?.map(r => r.STORE_NAME) ?? []
}

function useVendors() {
  const { data } = useQuery({
    queryKey: ['vendors-list'],
    queryFn:  () => axios.get('/api/purchases/vendors-list').then(r => r.data as { vend_name: string }[]),
    staleTime: Infinity,
  })
  return data?.map(r => r.vend_name) ?? []
}

// ── Main ──────────────────────────────────────────────────────────────────────

export default function PurchasesOverview() {
  const [preset,   setPreset]   = useState('MTD')
  const [dateFrom, setDateFrom] = useState(PRESETS['MTD'][0])
  const [dateTo,   setDateTo]   = useState(PRESETS['MTD'][1])
  const [stores,   setStores]   = useState<string[]>([])
  const [vendors,  setVendors]  = useState<string[]>([])
  const [status,   setStatus]   = useState('')

  const allStores  = useStores()
  const allVendors = useVendors()

  const applyPreset = (p: string) => {
    setPreset(p)
    setDateFrom(PRESETS[p][0])
    setDateTo(PRESETS[p][1])
  }

  const params = useMemo(() => ({
    date_from: dateFrom,
    date_to:   dateTo,
    ...(stores.length  ? { stores:  stores.join(',')  } : {}),
    ...(vendors.length ? { vendors: vendors.join(',') } : {}),
    ...(status         ? { status                      } : {}),
  }), [dateFrom, dateTo, stores, vendors, status])

  const useQ = <T,>(key: string, url: string) => useQuery<T>({
    queryKey: [key, params],
    queryFn:  () => axios.get(url, { params }).then(r => r.data),
  })

  const kpiQ    = useQ<KPI>        ('pur-kpi',    '/api/purchases/kpi')
  const trendQ  = useQ<TrendRow[]> ('pur-trend',  '/api/purchases/trend')
  const vendQ   = useQ<VendRow[]>  ('pur-vendor', '/api/purchases/by-vendor')
  const deptQ   = useQ<DeptRow[]>  ('pur-dept',   '/api/purchases/by-dept')
  const storeQ  = useQ<StoreRow[]> ('pur-store',  '/api/purchases/by-store')
  const statusQ = useQ<StatusRow[]>('pur-status', '/api/purchases/by-status')

  const kpi = kpiQ.data

  // ── Chart options ──────────────────────────────────────────────────────────

  const trendOpt = useMemo(() => {
    const rows = trendQ.data ?? []
    return {
      tooltip: { trigger: 'axis', axisPointer: { type: 'cross' } },
      legend:  { data: ['Total Cost ($)', 'PO Count'], top: 4, textStyle: { fontSize: 11 } },
      grid:    { left: 70, right: 60, top: 40, bottom: 30 },
      xAxis:   { type: 'category', data: rows.map(r => r.vou_date), axisLabel: { fontSize: 10 } },
      yAxis: [
        { type: 'value', name: 'Cost',  axisLabel: { fontSize: 10, formatter: (v: number) => `${moneyPrefix()}${(v/1000).toFixed(0)}k` } },
        { type: 'value', name: 'POs',   axisLabel: { fontSize: 10 }, splitLine: { show: false } },
      ],
      series: [
        { name: 'Total Cost ($)', type: 'bar', data: rows.map(r => r.total_cost),
          itemStyle: { color: C.blue, borderRadius: [2,2,0,0] } },
        { name: 'PO Count', type: 'line', yAxisIndex: 1, data: rows.map(r => r.vou_count),
          lineStyle: { color: C.purple, width: 2 }, symbol: 'none', smooth: true },
      ],
    }
  }, [trendQ.data])

  const vendorOpt = useMemo(() => {
    const rows = [...(vendQ.data ?? [])].reverse()
    return {
      tooltip: { trigger: 'axis', formatter: (p: any[]) => `${p[0].name}<br/>${fmtC(p[0].value)}` },
      grid:    { left: 150, right: 80, top: 10, bottom: 10 },
      xAxis:   { type: 'value', axisLabel: { fontSize: 10, formatter: (v: number) => `${moneyPrefix()}${(v/1000).toFixed(0)}k` } },
      yAxis:   { type: 'category', data: rows.map(r => r.vendor_name), axisLabel: { fontSize: 10 } },
      series: [{ type: 'bar', data: rows.map(r => r.total_cost),
        itemStyle: { color: C.purple, borderRadius: [0,3,3,0] },
        label: { show: true, position: 'right', fontSize: 10,
          formatter: (p: any) => `${moneyPrefix()}${(p.value/1000).toFixed(0)}k` },
      }],
    }
  }, [vendQ.data])

  const deptOpt = useMemo(() => {
    const rows = [...(deptQ.data ?? [])].reverse()
    return {
      tooltip: { trigger: 'axis' },
      grid:    { left: 130, right: 80, top: 10, bottom: 10 },
      xAxis:   { type: 'value', axisLabel: { fontSize: 10, formatter: (v: number) => `${moneyPrefix()}${(v/1000).toFixed(0)}k` } },
      yAxis:   { type: 'category', data: rows.map(r => r.department), axisLabel: { fontSize: 10 } },
      series: [{ type: 'bar', data: rows.map(r => r.total_cost),
        itemStyle: { color: C.sky, borderRadius: [0,3,3,0] },
        label: { show: true, position: 'right', fontSize: 10,
          formatter: (p: any) => `${moneyPrefix()}${(p.value/1000).toFixed(0)}k` },
      }],
    }
  }, [deptQ.data])

  const storeOpt = useMemo(() => ({
    tooltip: { trigger: 'item', formatter: (p: any) => `${p.name}<br/>${fmtC(p.value)} (${p.percent}%)` },
    series: [{ type: 'pie', radius: ['42%', '68%'],
      data: (storeQ.data ?? []).map(r => ({ name: r.store_name, value: r.total_cost })),
      label: { fontSize: 11 }, emphasis: { itemStyle: { shadowBlur: 10 } },
    }],
  }), [storeQ.data])

  const statusOpt = useMemo(() => ({
    tooltip: { trigger: 'item', formatter: '{b}: {c} ({d}%)' },
    series: [{ type: 'pie', radius: ['45%', '68%'],
      data: (statusQ.data ?? []).map((r, i) => ({
        name: r.status_label, value: r.vou_count,
        itemStyle: { color: [C.amber, C.green][i] ?? C.blue },
      })),
      label: { fontSize: 11 }, emphasis: { itemStyle: { shadowBlur: 10 } },
    }],
  }), [statusQ.data])

  return (
    <Box sx={{ pt: 0, px: 3, pb: 3, minHeight: '100%' }}>

      {/* ── Header (standard page pattern — matches Stock Movement) ──── */}
      <Box sx={{
        position: 'sticky', top: 0, zIndex: 10,
        bgcolor: '#ffffff', mx: -3, px: 3, pt: 3, pb: 2,
        borderBottom: '1px solid #e9e4ff',
      }}>
        <Typography variant="h6" sx={{ fontWeight: 800, color: '#0f172a', letterSpacing: '-0.3px', mb: 0.3 }}>
          Purchases Overview
        </Typography>
        <Typography sx={{ fontSize: 12, color: '#64748b', mb: 1.5 }}>
          {dateFrom} — {dateTo}
        </Typography>
        <Box sx={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 1 }}>

          <Stack direction="row" spacing={0.5}>
            {Object.keys(PRESETS).map(p => (
              <Chip key={p} label={p} size="small" onClick={() => applyPreset(p)}
                variant={preset === p ? 'filled' : 'outlined'}
                sx={{ fontWeight: 600, fontSize: 11,
                  ...(preset === p ? { bgcolor: '#7c3aed', color: '#fff' } : {}) }}
              />
            ))}
          </Stack>

          <TextField size="small" label="From" type="date" value={dateFrom}
            onChange={e => { setDateFrom(e.target.value); setPreset('') }}
            InputLabelProps={{ shrink: true }} sx={{ width: 148 }} />
          <TextField size="small" label="To" type="date" value={dateTo}
            onChange={e => { setDateTo(e.target.value); setPreset('') }}
            InputLabelProps={{ shrink: true }} sx={{ width: 148 }} />

          {/* Store */}
          <FormControl size="small" sx={{ minWidth: 160 }}>
            <InputLabel>Store</InputLabel>
            <Select multiple value={stores}
              onChange={e => setStores(e.target.value as string[])}
              input={<OutlinedInput label="Store" />}
              renderValue={s => s.length === 1 ? s[0] : `${s.length} stores`}
              MenuProps={{ PaperProps: { style: { maxHeight: 300 } } }}>
              {allStores.map(s => (
                <MenuItem key={s} value={s} dense>
                  <Checkbox checked={stores.includes(s)} size="small" />
                  <ListItemText primary={s} primaryTypographyProps={{ fontSize: 13 }} />
                </MenuItem>
              ))}
            </Select>
          </FormControl>

          {/* Vendor */}
          <FormControl size="small" sx={{ minWidth: 160 }}>
            <InputLabel>Vendor</InputLabel>
            <Select multiple value={vendors}
              onChange={e => setVendors(e.target.value as string[])}
              input={<OutlinedInput label="Vendor" />}
              renderValue={v => v.length === 1 ? v[0] : `${v.length} vendors`}
              MenuProps={{ PaperProps: { style: { maxHeight: 300 } } }}>
              {allVendors.map(v => (
                <MenuItem key={v} value={v} dense>
                  <Checkbox checked={vendors.includes(v)} size="small" />
                  <ListItemText primary={v} primaryTypographyProps={{ fontSize: 13 }} />
                </MenuItem>
              ))}
            </Select>
          </FormControl>

          {/* Status */}
          <FormControl size="small" sx={{ minWidth: 130 }}>
            <InputLabel>Status</InputLabel>
            <Select value={status} onChange={e => setStatus(e.target.value)} label="Status">
              <MenuItem value="">All</MenuItem>
              <MenuItem value="received">Received</MenuItem>
              <MenuItem value="pending">Pending</MenuItem>
            </Select>
          </FormControl>

          {kpiQ.isLoading && <CircularProgress size={18} sx={{ color: '#7c3aed' }} />}
        </Box>
      </Box>

      {/* ── KPI strip (flex row — equal heights, like Stock Movement) ─── */}
      <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', mt: 2 }}>
        {([
          { label: 'Total Vouchers',    value: fmt(kpi?.vou_count      ?? 0),                                  color: C.blue,   icon: 'ti-file-invoice' },
          { label: 'Total Cost',   value: fmtC0(kpi?.total_cost   ?? 0),                                  color: C.purple, icon: 'ti-coin'          },
          { label: 'Received Vouchers', value: fmt(kpi?.received_count ?? 0), sub: `${kpi?.recv_pct ?? 0}% of total`, color: C.green,  icon: 'ti-circle-check'  },
          { label: 'Pending Vouchers',  value: fmt(kpi?.pending_count  ?? 0),                                  color: C.amber,  icon: 'ti-clock'         },
          { label: 'Vendors',      value: fmt(kpi?.vendor_count   ?? 0),                                  color: C.sky,    icon: 'ti-building-store'},
          { label: 'Line Items',   value: fmt(kpi?.line_count     ?? 0),                                  color: C.rose,   icon: 'ti-list'          },
          { label: 'Ordered Qty',  value: fmt(kpi?.ord_qty        ?? 0),                                  color: '#64748b', icon: 'ti-package' },
          { label: 'Received Qty', value: fmt(kpi?.recv_qty       ?? 0), sub: `Disc: ${fmtC0(kpi?.total_disc ?? 0)}`, color: '#64748b', icon: 'ti-inbox' },
        ] as const).map(k => (
          <KpiCard key={k.label} {...k} />
        ))}
      </Box>

      {/* ── Daily Trend ───────────────────────────────────────────────── */}
      <Paper elevation={0} sx={{ mt: 3, p: 2, borderRadius: 2, border: '1px solid #e2e8f0' }}>
        <Typography sx={{ fontWeight: 700, fontSize: 14, mb: 1.5 }}>Daily Purchase Trend</Typography>
        {trendQ.isLoading
          ? <Box sx={{ display:'flex', justifyContent:'center', py:5 }}><CircularProgress size={28} /></Box>
          : <ReactECharts option={trendOpt} style={{ height: 240 }} />
        }
      </Paper>

      {/* ── By Vendor + By Dept ───────────────────────────────────────── */}
      <Grid container spacing={2} sx={{ mt: 0 }}>
        <Grid item xs={12} md={6}>
          <Paper elevation={0} sx={{ p: 2, borderRadius: 2, border: '1px solid #e2e8f0' }}>
            <Typography sx={{ fontWeight: 700, fontSize: 14, mb: 1.5 }}>Top Vendors by Cost</Typography>
            {vendQ.isLoading
              ? <Box sx={{ display:'flex', justifyContent:'center', py:5 }}><CircularProgress size={28} /></Box>
              : <ReactECharts option={vendorOpt} style={{ height: 300 }} />
            }
          </Paper>
        </Grid>
        <Grid item xs={12} md={6}>
          <Paper elevation={0} sx={{ p: 2, borderRadius: 2, border: '1px solid #e2e8f0' }}>
            <Typography sx={{ fontWeight: 700, fontSize: 14, mb: 1.5 }}>Top Departments by Cost</Typography>
            {deptQ.isLoading
              ? <Box sx={{ display:'flex', justifyContent:'center', py:5 }}><CircularProgress size={28} /></Box>
              : <ReactECharts option={deptOpt} style={{ height: 300 }} />
            }
          </Paper>
        </Grid>
      </Grid>

      {/* ── By Store + By Status ──────────────────────────────────────── */}
      <Grid container spacing={2} sx={{ mt: 0, mb: 2 }}>
        <Grid item xs={12} md={6}>
          <Paper elevation={0} sx={{ p: 2, borderRadius: 2, border: '1px solid #e2e8f0' }}>
            <Typography sx={{ fontWeight: 700, fontSize: 14, mb: 1 }}>Cost by Store</Typography>
            {storeQ.isLoading
              ? <Box sx={{ display:'flex', justifyContent:'center', py:5 }}><CircularProgress size={28} /></Box>
              : <ReactECharts option={storeOpt} style={{ height: 260 }} />
            }
          </Paper>
        </Grid>
        <Grid item xs={12} md={6}>
          <Paper elevation={0} sx={{ p: 2, borderRadius: 2, border: '1px solid #e2e8f0' }}>
            <Typography sx={{ fontWeight: 700, fontSize: 14, mb: 1 }}>PO Status Split</Typography>
            {statusQ.isLoading
              ? <Box sx={{ display:'flex', justifyContent:'center', py:5 }}><CircularProgress size={28} /></Box>
              : (
                <>
                  <ReactECharts option={statusOpt} style={{ height: 180 }} />
                  <Box sx={{ display: 'flex', gap: 4, justifyContent: 'center', mt: 1 }}>
                    {(statusQ.data ?? []).map(r => (
                      <Box key={r.status_label} sx={{ textAlign: 'center' }}>
                        <Typography sx={{ fontSize: 11, color: '#64748b', fontWeight: 600 }}>{r.status_label}</Typography>
                        <Typography sx={{ fontSize: 20, fontWeight: 800, color: r.status === 4 ? C.green : C.amber }}>
                          {fmt(r.vou_count)}
                        </Typography>
                        <Typography sx={{ fontSize: 11, color: '#94a3b8' }}>{fmtC(r.total_cost)}</Typography>
                      </Box>
                    ))}
                  </Box>
                </>
              )
            }
          </Paper>
        </Grid>
      </Grid>

    </Box>
  )
}