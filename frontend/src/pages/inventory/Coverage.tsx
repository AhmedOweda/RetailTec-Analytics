/**
 * Inventory Coverage & Replenishment Planning
 * =============================================
 * Mirrors the Power BI "Coverage Details" report:
 *   â€¢ Per-item Ã— per-store: OnHand | Sales 30/60/90d | Daily AVG | Days of Coverage | Last Sold
 *   â€¢ Coverage bucket filter panel (Under 7d | 7â€“30d | 30â€“60d | Over 60d | Stagnant)
 *   â€¢ Period selector for Daily AVG basis (30 / 60 / 90 days)
 *   â€¢ AG Grid with CSV + PDF export
 */
import { useState, useMemo, useRef } from 'react'
import {
  Box, Typography, Stack, TextField, Chip,
  Autocomplete, ToggleButtonGroup, ToggleButton,
} from '@mui/material'
import { useQuery } from '@tanstack/react-query'
import { AgGridReact } from 'ag-grid-react'
import 'ag-grid-community/styles/ag-grid.css'
import 'ag-grid-community/styles/ag-theme-alpine.css'
import KpiCard       from '../../components/KpiCard'
import GridExportBar from '../../components/GridExportBar'
import { noRowsOverlay } from '../../utils/gridOverlay'
import axios from 'axios'
import { useAppSettings } from '../../context/AppSettings'
import { useGridColumnState } from '../../hooks/useGridColumnState'
import { tr, trf, trCols } from '../../i18n'
import TitleLoader from '../../components/TitleLoader'

// â”€â”€ Colours â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const C_PURPLE = '#7c3aed'
const C_SLATE  = '#64748b'
const C_GREEN  = '#059669'
const C_AMBER  = '#d97706'
const C_ROSE   = '#e11d48'
const C_CYAN   = '#0891b2'
const C_INDIGO = '#4338ca'

// â”€â”€ Coverage buckets â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
type BucketKey = 'all' | 'under7' | '7to30' | '30to60' | 'over60' | 'stagnant'

const BUCKETS: { key: BucketKey; label: string; color: string; desc: string }[] = [
  { key: 'all',      label: 'All Items',    color: C_PURPLE, desc: 'Show all items with stock'            },
  { key: 'under7',   label: 'Under 7 Days', color: C_ROSE,   desc: 'Critical â€” reorder immediately'      },
  { key: '7to30',    label: '7 â€“ 30 Days',  color: C_AMBER,  desc: 'Watch â€” plan replenishment soon'      },
  { key: '30to60',   label: '30 â€“ 60 Days', color: C_CYAN,   desc: 'Adequate â€” monitor'                  },
  { key: 'over60',   label: 'Over 60 Days', color: C_INDIGO, desc: 'Overstocked â€” review order frequency' },
  { key: 'stagnant', label: 'Stagnant',     color: C_SLATE,  desc: 'No sales in selected period'         },
]

function fmtN(v: any) {
  return (+(v ?? 0)).toLocaleString('en-US', { maximumFractionDigits: 0 })
}
function fmtD(v: any) {
  const n = +(v ?? 0)
  if (!isFinite(n) || n === 0) return 'â€”'
  return n.toFixed(1)
}

// â”€â”€ Coverage calc â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function getDailySales(row: any, period: number): number {
  const qty = period === 30 ? row.sales_30 : period === 60 ? row.sales_60 : row.sales_90
  return +(qty ?? 0) / period
}

function getCoverage(row: any, period: number): number {
  const daily = getDailySales(row, period)
  if (daily <= 0) return Infinity
  return +(row.on_hand ?? 0) / daily
}

function getBucket(row: any, period: number): BucketKey {
  const salesQty = period === 30 ? row.sales_30 : period === 60 ? row.sales_60 : row.sales_90
  if (+(salesQty ?? 0) === 0) return 'stagnant'
  const days = getCoverage(row, period)
  if (days < 7)   return 'under7'
  if (days < 30)  return '7to30'
  if (days < 60)  return '30to60'
  return 'over60'
}

// â”€â”€ Main Component â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
export default function InventoryCoverage() {
  const gridRef = useRef<AgGridReact>(null)
  const { productCodeField } = useAppSettings()
  const codeFieldUpper = productCodeField.toUpperCase()
  const { onGridReady: onColGridReady, onColumnChanged, resetColumns } = useGridColumnState('coverage')

  // Filters
  const [stores,   setStores]   = useState<string[]>([])
  const [vendors,  setVendors]  = useState<string[]>([])
  const [depts,    setDepts]    = useState<string[]>([])
  const [itemSearch, setItemSearch] = useState('')   // one field: ALU / UPC / description

  // Period for Daily AVG (30 / 60 / 90)
  const [period, setPeriod] = useState<number>(30)

  // Coverage bucket selection
  const [bucket, setBucket] = useState<BucketKey>('all')

  // â”€â”€ Dropdown lists â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const { data: storeList = [] } = useQuery<{ STORE_NAME: string }[]>({
    queryKey: ['inv-stores-list'],
    queryFn:  () => axios.get('/api/inventory/stores-list').then(r => r.data),
    staleTime: Infinity,
  })
  const { data: vendorList = [] } = useQuery<{ vend_name: string }[]>({
    queryKey: ['inv-vendors-list'],
    queryFn:  () => axios.get('/api/inventory/vendors-list').then(r => r.data),
    staleTime: Infinity,
  })
  const { data: deptList = [] } = useQuery<{ department: string }[]>({
    queryKey: ['inv-dcs-list'],
    queryFn:  () => axios.get('/api/inventory/dcs-list').then(r => r.data),
    staleTime: Infinity,
  })

  // Defensive key lookup â€” the APIs return UPPERCASE column names for
  // unaliased selects (undefined options crashed the Autocomplete slicers)
  const storeOptions  = storeList.map((r: any) => r.STORE_NAME ?? r.store_name).filter(Boolean)
  const vendorOptions = vendorList.map((r: any) => r.VEND_NAME ?? r.vend_name).filter(Boolean)
  const deptOptions   = deptList.map((r: any) => r.department ?? r.D_NAME).filter(Boolean)

  // â”€â”€ Data fetch â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // Only stores filter server-side; vendor/department filter CLIENT-side â€”
  // exact match on the row values (server csv matching broke on names that
  // contain commas, returning no data)
  const params = useMemo(() => ({
    ...(stores.length  ? { stores:  stores.join(',')  } : {}),
  }), [stores])

  const { data: raw = [], isFetching } = useQuery<any[]>({
    queryKey: ['inv-coverage', params],
    queryFn:  () => axios.get('/api/inventory/coverage', { params }).then(r => r.data),
  })

  // â”€â”€ Enrich rows client-side â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const enriched = useMemo(() => raw.map(r => ({
    ...r,
    daily_avg:        +getDailySales(r, period).toFixed(3),
    days_coverage:    getCoverage(r, period),
    coverage_bucket:  getBucket(r, period),
  })), [raw, period])

  // â”€â”€ Apply text search + bucket filter â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const rows = useMemo(() => {
    let r = enriched
    if (vendors.length) r = r.filter(x => vendors.includes(x.vendor))
    if (depts.length)   r = r.filter(x => depts.includes(x.department))
    if (itemSearch.trim()) {
      const q = itemSearch.trim().toLowerCase()
      r = r.filter(x =>
        (x.description ?? '').toLowerCase().includes(q) ||
        (x.alu ?? '').toLowerCase().includes(q) ||
        String(x.upc ?? '').toLowerCase().includes(q))
    }
    if (bucket !== 'all') {
      r = r.filter(x => x.coverage_bucket === bucket)
    }
    return r
  }, [enriched, vendors, depts, itemSearch, bucket])

  // â”€â”€ KPIs â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const kpi = useMemo(() => {
    const totalOnHand  = rows.reduce((s, x) => s + +(x.on_hand ?? 0), 0)
    const totalSales   = rows.reduce((s, x) => s + +(period === 30 ? x.sales_30 : period === 60 ? x.sales_60 : x.sales_90), 0)
    const stagnant     = rows.filter(x => x.coverage_bucket === 'stagnant').length
    const critical     = rows.filter(x => x.coverage_bucket === 'under7').length
    const avgDailyQty  = rows.reduce((s, x) => s + x.daily_avg, 0)
    return { totalOnHand, totalSales, stagnant, critical, avgDailyQty }
  }, [rows, period])

  // â”€â”€ Bucket counts â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const bucketCounts = useMemo(() => {
    const m: Record<string, number> = {}
    enriched.forEach(r => { m[r.coverage_bucket] = (m[r.coverage_bucket] ?? 0) + 1 })
    return m
  }, [enriched])

  // â”€â”€ Column defs â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const colDefs = useMemo<any[]>(() => [
    { field: 'store_name',    headerName: 'Store',           width: 160, pinned: 'left',
      cellStyle: { fontWeight: 600 } },
    { field: productCodeField, headerName: codeFieldUpper,   width: 130,
      cellStyle: { fontFamily: 'monospace', color: C_PURPLE, fontWeight: 700 } },
    { field: 'description',   headerName: 'Item Description',flex: 2, minWidth: 180 },
    { field: 'vendor',        headerName: 'Item Vendor',     width: 150,
      headerTooltip: 'Vendor from the item master (catalog) â€” not necessarily the supplier purchased from' },
    { field: 'department',    headerName: 'Department',      width: 140 },
    { field: 'on_hand',       headerName: 'Onhand Qty',      width: 110, type: 'numericColumn',
      valueFormatter: (p: any) => fmtN(p.value),
      cellStyle: (p: any) => ({ fontWeight: 700, color: +(p.value ?? 0) < 0 ? C_ROSE : C_PURPLE }) },
    { field: 'sales_30',      headerName: 'Sales 30d',       width: 100, type: 'numericColumn',
      valueFormatter: (p: any) => fmtN(p.value) },
    { field: 'sales_60',      headerName: 'Sales 60d',       width: 100, type: 'numericColumn',
      valueFormatter: (p: any) => fmtN(p.value) },
    { field: 'sales_90',      headerName: 'Sales 90d',       width: 100, type: 'numericColumn',
      valueFormatter: (p: any) => fmtN(p.value) },
    { field: 'daily_avg',     headerName: `${tr('Daily AVG')} (${period}d)`, width: 120, type: 'numericColumn',
      valueFormatter: (p: any) => fmtD(p.value),
      cellStyle: (p: any) => ({ color: +(p.value ?? 0) === 0 ? C_SLATE : C_CYAN, fontWeight: 600 }) },
    { field: 'days_coverage', headerName: 'Days Coverage',   width: 120, type: 'numericColumn',
      valueFormatter: (p: any) => {
        const v = p.value
        if (!isFinite(v) || v === Infinity) return tr('Stagnant')
        return v.toFixed(0) + 'd'
      },
      cellStyle: (p: any) => {
        const v = p.value
        if (!isFinite(v) || v === Infinity) return { color: C_SLATE, fontStyle: 'italic' }
        const color = v < 7 ? C_ROSE : v < 30 ? C_AMBER : v < 60 ? C_CYAN : C_INDIGO
        return { color, fontWeight: 700 }
      }},
    { field: 'last_sold',     headerName: 'Last Sold',       width: 105,
      cellStyle: (p: any) => ({ color: !p.value ? C_ROSE : C_SLATE }) },
  ], [period, productCodeField, codeFieldUpper])

  return (
    <Box sx={{ pt: 0, px: 3, pb: 3 }}>

      {/* â”€â”€ Sticky header â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
      <Box sx={{
        position: 'sticky', top: 0, zIndex: 10, bgcolor: 'var(--rt-surface-2)',
        mx: -3, px: 3, pt: 2.5, pb: 1.5, mb: 2, borderBottom: '1px solid var(--rt-border)',
      }}>
        <Stack direction="row" alignItems="center" justifyContent="space-between" mb={1.5}>
          <Typography variant="h6" sx={{ fontWeight:700, fontSize:20, color: 'var(--rt-text)', letterSpacing:'-0.3px' }}>
            {tr('Coverage & Replenishment Planning')}
            <TitleLoader />
          </Typography>
        </Stack>

        <Stack direction="row" spacing={1.5} flexWrap="wrap" alignItems="center">
          {[
            { label:tr('Store'),      options: storeOptions,  value: stores,  set: setStores  },
            { label:tr('Item Vendor'), options: vendorOptions, value: vendors, set: setVendors },
            { label:tr('Department'), options: deptOptions,   value: depts,   set: setDepts   },
          ].map(f => (
            <Autocomplete key={f.label} multiple disableCloseOnSelect size="small"
              options={f.options} value={f.value}
              onChange={(_, v) => f.set(v as string[])}
              sx={{ minWidth: 200,
                    '& .MuiOutlinedInput-root': { borderRadius: 2.5, bgcolor: 'var(--rt-surface)' } }}
              renderInput={p => <TextField {...p} placeholder={f.label} size="small" />}
              renderTags={(val, gtp) => val.map((o, i) =>
                <Chip label={o} size="small" {...gtp({ index: i })} />
              )} />
          ))}

          {/* Item search â€” ALU / UPC / description in one field */}
          <TextField size="small" label={trf('Search item ({{code}} / description)', { code: codeFieldUpper })}
            value={itemSearch} onChange={e => setItemSearch(e.target.value)}
            sx={{ width: 260,
                  '& .MuiOutlinedInput-root': { borderRadius: 2.5, bgcolor: 'var(--rt-surface)' } }} />

          {/* Period selector */}
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
            <Typography sx={{ fontSize: 11, color: C_SLATE, fontWeight: 600, whiteSpace: 'nowrap' }}>
              {tr('AVG basis:')}
            </Typography>
            <ToggleButtonGroup value={period} exclusive
              onChange={(_, v) => { if (v !== null) setPeriod(v) }}
              size="small">
              {[30, 60, 90].map(d => (
                <ToggleButton key={d} value={d}
                  sx={{ px: 1.5, py: 0.4, fontSize: 11, fontWeight: 700,
                    '&.Mui-selected': { bgcolor: C_PURPLE, color: '#fff',
                      '&:hover': { bgcolor: '#6d28d9' } } }}>
                  {d}d
                </ToggleButton>
              ))}
            </ToggleButtonGroup>
          </Box>
        </Stack>
      </Box>

      {/* â”€â”€ KPI row â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
      <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', mb: 2 }}>
        <KpiCard label={tr('Onhand Qty')}     value={fmtN(kpi.totalOnHand)}  icon="ti-package"      color={C_PURPLE} />
        <KpiCard label={trf('Sales ({{n}}d Qty)', { n: period })} value={fmtN(kpi.totalSales)} icon="ti-shopping-cart" color={C_CYAN}
          sub={trf('Daily AVG: {{v}} units', { v: fmtD(kpi.avgDailyQty) })} />
        <KpiCard label={tr('Critical (< 7d)')}  value={fmtN(kpi.critical)}   icon="ti-alert-triangle"
          color={kpi.critical > 0 ? C_ROSE : C_GREEN}
          sub={tr('reorder immediately')} />
        <KpiCard label={tr('Stagnant SKUs')}    value={fmtN(kpi.stagnant)}   icon="ti-trending-down"
          color={kpi.stagnant > 0 ? C_AMBER : C_GREEN}
          sub={trf('no sales in {{n}}d window', { n: period })} />
      </Box>

      {/* â”€â”€ Coverage bucket bar â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
      <Box sx={{
        bgcolor: 'var(--rt-surface)', borderRadius: 2, border: '1px solid var(--rt-border)',
        p: 1.5, mb: 2, display: 'flex', gap: 1, flexWrap: 'wrap',
      }}>
        {BUCKETS.map(b => {
          const count = b.key === 'all'
            ? enriched.length
            : (bucketCounts[b.key] ?? 0)
          const active = bucket === b.key
          return (
            <Box key={b.key}
              onClick={() => setBucket(b.key)}
              title={tr(b.desc)}
              sx={{
                display: 'flex', flexDirection: 'column', alignItems: 'center',
                px: 2, py: 1, borderRadius: 2, cursor: 'pointer', minWidth: 90,
                border: `2px solid ${active ? b.color : 'var(--rt-border)'}`,
                bgcolor: active ? `${b.color}12` : '#fafafa',
                transition: 'all 0.15s',
                '&:hover': { borderColor: b.color, bgcolor: `${b.color}08` },
              }}>
              <Typography sx={{ fontSize: 18, fontWeight: 800, color: b.color, lineHeight: 1 }}>
                {fmtN(count)}
              </Typography>
              <Typography sx={{ fontSize: 10, fontWeight: 600, color: b.color, mt: 0.3, textAlign: 'center' }}>
                {tr(b.label)}
              </Typography>
            </Box>
          )
        })}
      </Box>

      {/* â”€â”€ Grid â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
      <Box sx={{ bgcolor: 'var(--rt-surface)', borderRadius: 2, border: '1px solid var(--rt-border)', p: 2 }}>
        <Stack direction="row" justifyContent="space-between" alignItems="center" mb={1.5}>
          <Box>
            <Typography sx={{ fontWeight: 700, fontSize: 13 }}>
              {trf('{{label}} â€” {{n}} SKUÃ—Store', { label: bucket === 'all' ? tr('All Items') : tr(BUCKETS.find(b => b.key === bucket)?.label ?? ''), n: fmtN(rows.length) })}
            </Typography>
            <Typography sx={{ fontSize: 11, color: C_SLATE }}>
              {trf('Daily AVG calculated from last {{n}} days Â· Days Coverage = Onhand Ã· Daily AVG', { n: period })}
            </Typography>
          </Box>
          <Stack direction="row" alignItems="center" spacing={1}>
            <GridExportBar
              gridRef={gridRef}
              filename={`coverage_${bucket}_${period}d`}
              title="Inventory Coverage"
              subtitle={`Daily AVG basis: ${period} days | Period: last ${period} days`}
              filters={`${stores.length ? `${stores.length} ${tr('store(s)')}` : tr('All stores')}`}
              reportEndpoint="/api/inventory/coverage" reportPeriod="custom" reportParams={params}
              colDefs={colDefs}
              onResetColumns={resetColumns}
            />
          </Stack>
        </Stack>

        <div className="ag-theme-alpine" style={{ height: 520 }}>
          <AgGridReact
            ref={gridRef}
            overlayNoRowsTemplate={noRowsOverlay()}
            rowData={rows}
            columnDefs={trCols(colDefs as any[])}
            defaultColDef={{ sortable: true, resizable: true, filter: true, wrapHeaderText: true, autoHeaderHeight: true }}
            pagination
            paginationPageSize={50}
            rowHeight={34}
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
  )
}
