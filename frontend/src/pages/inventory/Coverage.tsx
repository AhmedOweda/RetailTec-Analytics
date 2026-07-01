/**
 * Inventory Coverage & Replenishment Planning
 * =============================================
 * Mirrors the Power BI "Coverage Details" report:
 *   • Per-item × per-store: OnHand | Sales 30/60/90d | Daily AVG | Days of Coverage | Last Sold
 *   • Coverage bucket filter panel (Under 7d | 7–30d | 30–60d | Over 60d | Stagnant)
 *   • Period selector for Daily AVG basis (30 / 60 / 90 days)
 *   • AG Grid with CSV + PDF export
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
import axios from 'axios'
import { useAppSettings } from '../../context/AppSettings'
import { useGridColumnState } from '../../hooks/useGridColumnState'

// ── Colours ────────────────────────────────────────────────────────────────────
const C_PURPLE = '#7c3aed'
const C_SLATE  = '#64748b'
const C_GREEN  = '#059669'
const C_AMBER  = '#d97706'
const C_ROSE   = '#e11d48'
const C_CYAN   = '#0891b2'
const C_INDIGO = '#4338ca'

// ── Coverage buckets ───────────────────────────────────────────────────────────
type BucketKey = 'all' | 'under7' | '7to30' | '30to60' | 'over60' | 'stagnant'

const BUCKETS: { key: BucketKey; label: string; color: string; desc: string }[] = [
  { key: 'all',      label: 'All Items',    color: C_PURPLE, desc: 'Show all items with stock'            },
  { key: 'under7',   label: 'Under 7 Days', color: C_ROSE,   desc: 'Critical — reorder immediately'      },
  { key: '7to30',    label: '7 – 30 Days',  color: C_AMBER,  desc: 'Watch — plan replenishment soon'      },
  { key: '30to60',   label: '30 – 60 Days', color: C_CYAN,   desc: 'Adequate — monitor'                  },
  { key: 'over60',   label: 'Over 60 Days', color: C_INDIGO, desc: 'Overstocked — review order frequency' },
  { key: 'stagnant', label: 'Stagnant',     color: C_SLATE,  desc: 'No sales in selected period'         },
]

function fmtN(v: any) {
  return (+(v ?? 0)).toLocaleString('en-US', { maximumFractionDigits: 0 })
}
function fmtD(v: any) {
  const n = +(v ?? 0)
  if (!isFinite(n) || n === 0) return '—'
  return n.toFixed(1)
}

// ── Coverage calc ──────────────────────────────────────────────────────────────
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

// ── Main Component ─────────────────────────────────────────────────────────────
export default function InventoryCoverage() {
  const gridRef = useRef<AgGridReact>(null)
  const { productCodeField } = useAppSettings()
  const codeFieldUpper = productCodeField.toUpperCase()
  const { onGridReady: onColGridReady, onColumnChanged, resetColumns } = useGridColumnState('coverage')

  // Filters
  const [stores,   setStores]   = useState<string[]>([])
  const [vendors,  setVendors]  = useState<string[]>([])
  const [depts,    setDepts]    = useState<string[]>([])
  const [descSearch, setDescSearch] = useState('')
  const [codeSearch,  setCodeSearch]  = useState('')

  // Period for Daily AVG (30 / 60 / 90)
  const [period, setPeriod] = useState<number>(30)

  // Coverage bucket selection
  const [bucket, setBucket] = useState<BucketKey>('all')

  // ── Dropdown lists ──────────────────────────────────────────────────────────
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

  const storeOptions  = storeList.map(r => r.STORE_NAME)
  const vendorOptions = vendorList.map(r => r.vend_name)
  const deptOptions   = deptList.map(r => r.department)

  // ── Data fetch ──────────────────────────────────────────────────────────────
  const params = useMemo(() => ({
    ...(stores.length  ? { stores:  stores.join(',')  } : {}),
    ...(vendors.length ? { vendors: vendors.join(',') } : {}),
    ...(depts.length   ? { dcs:     depts.join(',')   } : {}),
  }), [stores, vendors, depts])

  const { data: raw = [], isFetching } = useQuery<any[]>({
    queryKey: ['inv-coverage', params],
    queryFn:  () => axios.get('/api/inventory/coverage', { params }).then(r => r.data),
  })

  // ── Enrich rows client-side ─────────────────────────────────────────────────
  const enriched = useMemo(() => raw.map(r => ({
    ...r,
    daily_avg:        +getDailySales(r, period).toFixed(3),
    days_coverage:    getCoverage(r, period),
    coverage_bucket:  getBucket(r, period),
  })), [raw, period])

  // ── Apply text search + bucket filter ──────────────────────────────────────
  const rows = useMemo(() => {
    let r = enriched
    if (descSearch.trim()) {
      const q = descSearch.trim().toLowerCase()
      r = r.filter(x => (x.description ?? '').toLowerCase().includes(q))
    }
    if (codeSearch.trim()) {
      const q = codeSearch.trim().toLowerCase()
      r = r.filter(x => (x[productCodeField] ?? '').toLowerCase().includes(q))
    }
    if (bucket !== 'all') {
      r = r.filter(x => x.coverage_bucket === bucket)
    }
    return r
  }, [enriched, descSearch, codeSearch, bucket])

  // ── KPIs ────────────────────────────────────────────────────────────────────
  const kpi = useMemo(() => {
    const totalOnHand  = rows.reduce((s, x) => s + +(x.on_hand ?? 0), 0)
    const totalSales   = rows.reduce((s, x) => s + +(period === 30 ? x.sales_30 : period === 60 ? x.sales_60 : x.sales_90), 0)
    const stagnant     = rows.filter(x => x.coverage_bucket === 'stagnant').length
    const critical     = rows.filter(x => x.coverage_bucket === 'under7').length
    const avgDailyQty  = rows.reduce((s, x) => s + x.daily_avg, 0)
    return { totalOnHand, totalSales, stagnant, critical, avgDailyQty }
  }, [rows, period])

  // ── Bucket counts ───────────────────────────────────────────────────────────
  const bucketCounts = useMemo(() => {
    const m: Record<string, number> = {}
    enriched.forEach(r => { m[r.coverage_bucket] = (m[r.coverage_bucket] ?? 0) + 1 })
    return m
  }, [enriched])

  // ── Column defs ─────────────────────────────────────────────────────────────
  const colDefs = useMemo<any[]>(() => [
    { field: 'store_name',    headerName: 'Store',           width: 160, pinned: 'left',
      cellStyle: { fontWeight: 600 } },
    { field: productCodeField, headerName: codeFieldUpper,   width: 130,
      cellStyle: { fontFamily: 'monospace', color: C_PURPLE, fontWeight: 700 } },
    { field: 'description',   headerName: 'Item Description',flex: 2, minWidth: 180 },
    { field: 'vendor',        headerName: 'Vendor',          width: 150 },
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
    { field: 'daily_avg',     headerName: `Daily AVG (${period}d)`, width: 120, type: 'numericColumn',
      valueFormatter: (p: any) => fmtD(p.value),
      cellStyle: (p: any) => ({ color: +(p.value ?? 0) === 0 ? C_SLATE : C_CYAN, fontWeight: 600 }) },
    { field: 'days_coverage', headerName: 'Days Coverage',   width: 120, type: 'numericColumn',
      valueFormatter: (p: any) => {
        const v = p.value
        if (!isFinite(v) || v === Infinity) return 'Stagnant'
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

      {/* ── Sticky header ───────────────────────────────────────────────── */}
      <Box sx={{
        position: 'sticky', top: 0, zIndex: 10, bgcolor: '#f8fafc',
        mx: -3, px: 3, pt: 2.5, pb: 1.5, mb: 2, borderBottom: '1px solid #e9e4ff',
      }}>
        <Stack direction="row" alignItems="center" justifyContent="space-between" mb={1.5}>
          <Typography variant="h5" fontWeight={700}>
            Coverage & Replenishment Planning
          </Typography>
          {isFetching && (
            <Typography sx={{ fontSize: 11, color: C_PURPLE, fontWeight: 600 }}>
              ⟳ Loading…
            </Typography>
          )}
        </Stack>

        <Stack direction="row" spacing={1.5} flexWrap="wrap" alignItems="center">
          {/* Store */}
          <Autocomplete multiple disableCloseOnSelect size="small"
            options={storeOptions} value={stores}
            onChange={(_, v) => setStores(v)} sx={{ minWidth: 200 }}
            renderInput={p => <TextField {...p} label="Store" size="small" />}
            renderTags={(val, gtp) => val.map((o, i) =>
              <Chip label={o} size="small" {...gtp({ index: i })} />
            )} />

          {/* Vendor */}
          <Autocomplete multiple disableCloseOnSelect size="small"
            options={vendorOptions} value={vendors}
            onChange={(_, v) => setVendors(v)} sx={{ minWidth: 200 }}
            renderInput={p => <TextField {...p} label="Vendor" size="small" />}
            renderTags={(val, gtp) => val.map((o, i) =>
              <Chip label={o} size="small" {...gtp({ index: i })} />
            )} />

          {/* Department */}
          <Autocomplete multiple disableCloseOnSelect size="small"
            options={deptOptions} value={depts}
            onChange={(_, v) => setDepts(v)} sx={{ minWidth: 200 }}
            renderInput={p => <TextField {...p} label="Department" size="small" />}
            renderTags={(val, gtp) => val.map((o, i) =>
              <Chip label={o} size="small" {...gtp({ index: i })} />
            )} />

          {/* Code search */}
          <TextField size="small" label={codeFieldUpper} value={codeSearch}
            onChange={e => setCodeSearch(e.target.value)} sx={{ width: 130 }} />

          {/* Description search */}
          <TextField size="small" label="Item Description" value={descSearch}
            onChange={e => setDescSearch(e.target.value)} sx={{ width: 200 }} />

          {/* Period selector */}
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
            <Typography sx={{ fontSize: 11, color: C_SLATE, fontWeight: 600, whiteSpace: 'nowrap' }}>
              AVG basis:
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

      {/* ── KPI row ─────────────────────────────────────────────────────── */}
      <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', mb: 2 }}>
        <KpiCard label="Onhand Qty"     value={fmtN(kpi.totalOnHand)}  icon="ti-package"      color={C_PURPLE} />
        <KpiCard label={`Sales (${period}d Qty)`} value={fmtN(kpi.totalSales)} icon="ti-shopping-cart" color={C_CYAN}
          sub={`Daily AVG: ${fmtD(kpi.avgDailyQty)} units`} />
        <KpiCard label="Critical (< 7d)"  value={fmtN(kpi.critical)}   icon="ti-alert-triangle"
          color={kpi.critical > 0 ? C_ROSE : C_GREEN}
          sub="reorder immediately" />
        <KpiCard label="Stagnant SKUs"    value={fmtN(kpi.stagnant)}   icon="ti-trending-down"
          color={kpi.stagnant > 0 ? C_AMBER : C_GREEN}
          sub={`no sales in ${period}d window`} />
      </Box>

      {/* ── Coverage bucket bar ──────────────────────────────────────────── */}
      <Box sx={{
        bgcolor: '#fff', borderRadius: 2, border: '1px solid #e2e8f0',
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
              title={b.desc}
              sx={{
                display: 'flex', flexDirection: 'column', alignItems: 'center',
                px: 2, py: 1, borderRadius: 2, cursor: 'pointer', minWidth: 90,
                border: `2px solid ${active ? b.color : '#e2e8f0'}`,
                bgcolor: active ? `${b.color}12` : '#fafafa',
                transition: 'all 0.15s',
                '&:hover': { borderColor: b.color, bgcolor: `${b.color}08` },
              }}>
              <Typography sx={{ fontSize: 18, fontWeight: 800, color: b.color, lineHeight: 1 }}>
                {fmtN(count)}
              </Typography>
              <Typography sx={{ fontSize: 10, fontWeight: 600, color: b.color, mt: 0.3, textAlign: 'center' }}>
                {b.label}
              </Typography>
            </Box>
          )
        })}
      </Box>

      {/* ── Grid ────────────────────────────────────────────────────────── */}
      <Box sx={{ bgcolor: '#fff', borderRadius: 2, border: '1px solid #e2e8f0', p: 2 }}>
        <Stack direction="row" justifyContent="space-between" alignItems="center" mb={1.5}>
          <Box>
            <Typography sx={{ fontWeight: 700, fontSize: 13 }}>
              {bucket === 'all' ? 'All Items' : BUCKETS.find(b => b.key === bucket)?.label} — {fmtN(rows.length)} SKU×Store
            </Typography>
            <Typography sx={{ fontSize: 11, color: C_SLATE }}>
              Daily AVG calculated from last {period} days · Days Coverage = Onhand ÷ Daily AVG
            </Typography>
          </Box>
          <Stack direction="row" alignItems="center" spacing={1}>
            <GridExportBar
              gridRef={gridRef}
              filename={`coverage_${bucket}_${period}d`}
              title={`Inventory Coverage — ${BUCKETS.find(b => b.key === bucket)?.label}`}
              subtitle={`Daily AVG basis: ${period} days | Period: last ${period} days`}
              colDefs={colDefs}
              onResetColumns={resetColumns}
            />
          </Stack>
        </Stack>

        <div className="ag-theme-alpine" style={{ height: 520 }}>
          <AgGridReact
            ref={gridRef}
            rowData={rows}
            columnDefs={colDefs}
            defaultColDef={{ sortable: true, resizable: true, filter: true }}
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
