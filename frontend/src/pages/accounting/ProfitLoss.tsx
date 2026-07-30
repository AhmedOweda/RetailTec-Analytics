/**
 * Accounting → Profit & Loss
 * ==========================
 * Customer-agnostic statement built from the class ROLES (asset | liability |
 * equity | revenue | cost). Sections are the customer's OWN first-level
 * classes from the Prism accounting touch menu, in the customer's own tree
 * order (section_seq from the backend); the endpoint returns pure account
 * rows and THIS page computes the subtotals:
 *
 *   · a subtotal after every section;
 *   · a Gross Profit line after the FIRST cost section — only when there are
 *     ≥2 cost sections (reproduces Sales − Purchases = Gross, − Expenses =
 *     Net without hardcoding any class name);
 *   · a bold NET PROFIT pinned row = all revenue − all costs.
 *
 * Accounts with a NULL or unmapped class arrive in the 'Unclassified'
 * section, always LAST and never dropped — with a warn banner pointing at the
 * Prism touch menu, and (admin-only) an inline role picker for classes that
 * exist but have no role yet, so the one-time setup happens right where the
 * problem is seen.
 *
 * Colours come exclusively from the --rt-* design tokens — no local hex.
 */
import { useMemo, useRef, useState } from 'react'
import {
  Box, Typography, Chip, TextField, Autocomplete, Stack, Paper,
  Switch, FormControlLabel, Select, MenuItem, useTheme,
} from '@mui/material'
import { AgGridReact } from 'ag-grid-react'
import type { ColDef } from 'ag-grid-community'
import 'ag-grid-community/styles/ag-grid.css'
import 'ag-grid-community/styles/ag-theme-alpine.css'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import axios from 'axios'
import { format, subDays, startOfMonth, startOfYear } from 'date-fns'
import GridExportBar from '../../components/GridExportBar'
import KpiCard from '../../components/KpiCard'
import TitleLoader from '../../components/TitleLoader'
import FeatureUnavailable from '../../components/FeatureUnavailable'
import { DateBasisToggle, DEFAULT_DATE_BASIS, dateBasisLabel, useAccountingDefaults } from '../../components/AccountingFilters'
import type { DateBasis } from '../../components/AccountingFilters'
import { useAuth } from '../../contexts/AuthContext'
import { useFeature, FEATURE_ACCOUNTING } from '../../hooks/useFeatures'
import { useGridColumnState } from '../../hooks/useGridColumnState'
import { useGlDefaultWindow } from '../../hooks/useGlWindow'
import { noRowsOverlay } from '../../utils/gridOverlay'
import { gridLocaleText } from '../../utils/gridLocale'
import { moneyExact, money, num } from '../../utils/formatters'
import { tr, trf, trCols } from '../../i18n'
import { PURPLE_BRAND } from '../../theme'

const iso = (d: Date) => format(d, 'yyyy-MM-dd')
const today = iso(new Date())
const PRESETS: Record<string, [string, string]> = {
  '30D': [iso(subDays(new Date(), 29)), today],
  '90D': [iso(subDays(new Date(), 89)), today],
  'MTD': [iso(startOfMonth(new Date())), today],
  'YTD': [iso(startOfYear(new Date())),  today],
}

const fmtMoney = (v: any) => (v == null || v === '' ? '' : moneyExact(v, 2))
const EPS = 0.005
const ROLES = ['asset', 'liability', 'equity', 'revenue', 'cost'] as const
const ROLE_LABEL: Record<string, string> = {
  asset: 'Asset', liability: 'Liability', equity: 'Equity',
  revenue: 'Revenue', cost: 'Cost',
}

const GRID_SX = {
  width: '100%',
  '& .ag-header': { bgcolor: 'var(--rt-grid-header-bg) !important', borderBottom: '1px solid var(--rt-border)' },
  '& .ag-header-cell-text': { fontWeight: 700, color: 'var(--rt-grid-header-fg)', fontSize: 12 },
  '& .ag-row-even': { bgcolor: 'var(--rt-surface)' },
  '& .ag-row-odd': { bgcolor: 'var(--rt-surface-2)' },
  '& .ag-row-pinned': { bgcolor: 'var(--rt-surface-3) !important', borderTop: '2px solid var(--rt-border)' },
} as const

interface PlRow {
  section: string; section_seq: number; role: string | null; group: string | null
  account_code: string; account_name: string; amount: number
}

/** The inline one-time setup: a role Select per unmapped class (admin only). */
export function UnmappedClassesBanner({ invalidate }: { invalidate: string[] }) {
  const { isAdmin } = useAuth()
  const qc = useQueryClient()
  const [busy, setBusy] = useState<string | null>(null)
  const { data: roles = [] } = useQuery<any[]>({
    queryKey: ['gl-class-roles'],
    queryFn: () => axios.get('/api/accounting/class-roles').then(r => r.data),
    staleTime: 60_000,
  })
  const unmapped = roles.filter(r => r.source === 'unmapped')
  if (!unmapped.length) return null

  const assign = async (cls: string, role: string) => {
    setBusy(cls)
    try {
      await axios.put('/api/accounting/class-roles', { class_roles: { [cls]: role } })
      qc.invalidateQueries({ queryKey: ['gl-class-roles'] })
      invalidate.forEach(k => qc.invalidateQueries({ queryKey: [k] }))
    } finally { setBusy(null) }
  }

  return (
    <Box sx={{ mt: 2, px: 2, py: 1.2, borderRadius: 2,
      bgcolor: 'var(--rt-warn-bg)', border: '1px solid var(--rt-warn-fg)' }}>
      <Typography sx={{ fontSize: 12.5, fontWeight: 800, color: 'var(--rt-warn-fg)' }}>
        {trf('{{n}} account class(es) have no statement role yet — assign roles so their accounts join the statements',
          { n: num(unmapped.length, 0) })}
      </Typography>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1.2, mt: 1 }}>
        {unmapped.map(u => (
          <Box key={u.class} sx={{ display: 'flex', alignItems: 'center', gap: 0.8 }}>
            <Typography sx={{ fontSize: 12, fontWeight: 700, color: 'var(--rt-text)' }}>
              {u.class}
              <Box component="span" sx={{ color: 'var(--rt-text-2)', fontWeight: 500 }}>
                {' '}· {num(u.accounts, 0)}
              </Box>
            </Typography>
            {isAdmin ? (
              <Select size="small" value="" displayEmpty disabled={busy === u.class}
                onChange={e => { if (e.target.value) assign(u.class, String(e.target.value)) }}
                sx={{ fontSize: 12, minWidth: 130, bgcolor: 'var(--rt-surface)' }}>
                <MenuItem value="" disabled>{tr('Role')}…</MenuItem>
                {ROLES.map(r => <MenuItem key={r} value={r} sx={{ fontSize: 12 }}>{tr(ROLE_LABEL[r])}</MenuItem>)}
              </Select>
            ) : (
              <Typography sx={{ fontSize: 11.5, color: 'var(--rt-text-2)' }}>
                {tr('ask an administrator to assign a role')}
              </Typography>
            )}
          </Box>
        ))}
      </Box>
    </Box>
  )
}

export default function ProfitLoss() {
  const theme = useTheme()
  const gridRef = useRef<AgGridReact>(null)
  const colState = useGridColumnState('accounting-profit-loss')

  const [preset, setPreset]     = useState('MTD')
  const [dateFrom, setDateFrom] = useState(PRESETS['MTD'][0])
  const [dateTo,   setDateTo]   = useState(PRESETS['MTD'][1])
  const [stores,   setStores]   = useState<string[]>([])
  const [subs,     setSubs]     = useState<{ sid: string; name: string }[]>([])
  const [includeUnbalanced, setIncludeUnbalanced] = useState(false)
  const [dateBasis, setDateBasis] = useState<DateBasis>(DEFAULT_DATE_BASIS)
  // Admin-configured report defaults (Settings → Accounting) as initial state
  useAccountingDefaults(setDateBasis, setIncludeUnbalanced)
  const winPinned = useRef(false)
  useGlDefaultWindow(winPinned, (f, t) => { setPreset(''); setDateFrom(f); setDateTo(t) })

  const allStores = useQuery({
    queryKey: ['stores-list'],
    queryFn: () => axios.get('/api/sales/stores-list').then(r => r.data as string[]),
    staleTime: 3_600_000,
  }).data ?? []
  const allSubs = useQuery({
    queryKey: ['subsidiaries-list'],
    queryFn: () => axios.get('/api/sales/subsidiaries-list').then(r => r.data as { sid: string; name: string }[]),
    staleTime: 3_600_000,
  }).data ?? []

  const applyPreset = (p: string) => { winPinned.current = true; setPreset(p); setDateFrom(PRESETS[p][0]); setDateTo(PRESETS[p][1]) }

  const filterParams = useMemo(() => ({
    date_from: dateFrom, date_to: dateTo,
    ...(stores.length ? { stores: stores.join(',') } : {}),
    ...(subs.length   ? { subsidiaries: subs.map(s => s.sid).join(',') } : {}),
    date_basis: dateBasis,
    include_unbalanced: includeUnbalanced,
  }), [dateFrom, dateTo, stores, subs, dateBasis, includeUnbalanced])

  const { data: rows = [] } = useQuery<PlRow[]>({
    queryKey: ['gl-profit-loss', filterParams],
    queryFn: () => axios.get('/api/accounting/profit-loss', { params: filterParams }).then(r => r.data),
    placeholderData: p => p,
  })

  // ── Sections in server order; subtotals / gross / net computed HERE ──────
  const stmt = useMemo(() => {
    const sections: { name: string; role: string | null; rows: PlRow[]; total: number }[] = []
    const byName = new Map<string, number>()
    for (const r of rows) {
      let i = byName.get(r.section)
      if (i == null) { i = sections.length; byName.set(r.section, i); sections.push({ name: r.section, role: r.role, rows: [], total: 0 }) }
      sections[i].rows.push(r)
      sections[i].total += +(r.amount ?? 0)
    }
    const revenueTotal = sections.filter(s => s.role === 'revenue').reduce((a, s) => a + s.total, 0)
    const costSections = sections.filter(s => s.role === 'cost')
    const costTotal = costSections.reduce((a, s) => a + s.total, 0)
    const unclassified = sections.find(s => s.role == null)
    const netProfit = revenueTotal - costTotal
    // Gross profit: only meaningful when the customer's structure separates a
    // trading cost section from later cost sections (≥2 cost sections).
    const grossAfter = costSections.length >= 2 ? costSections[0].name : null
    const grossProfit = grossAfter != null ? revenueTotal - costSections[0].total : null

    const display: any[] = []
    for (const s of sections) {
      for (const r of s.rows) display.push({ ...r, kind: 'row' })
      display.push({ kind: 'subtotal', section: s.name, role: s.role,
        account_name: trf('Total {{s}}', { s: s.role == null ? tr('Unclassified') : tr(s.name) }),
        amount: Math.round(s.total * 100) / 100 })
      if (s.name === grossAfter && grossProfit != null)
        display.push({ kind: 'gross', section: '', account_name: tr('Gross Profit'),
          amount: Math.round(grossProfit * 100) / 100 })
    }
    return { sections, revenueTotal, costTotal, netProfit, grossProfit,
             unclassifiedCount: unclassified?.rows.length ?? 0,
             unclassifiedNet: unclassified?.total ?? 0, display }
  }, [rows])

  const pinnedBottom = useMemo(() => [{
    kind: 'net', section: '', group: '', account_code: '',
    account_name: tr('Net Profit'),
    amount: Math.round(stmt.netProfit * 100) / 100,
  }], [stmt.netProfit])

  const rowStyle = (p: any): any => {
    const k = p.data?.kind
    if (k === 'subtotal') return { fontWeight: 700, color: 'var(--rt-text)', backgroundColor: 'var(--rt-surface-3)' }
    if (k === 'gross')    return { fontWeight: 800, color: 'var(--rt-pos-fg)', backgroundColor: 'var(--rt-pos-bg)' }
    return { fontWeight: p.node?.rowPinned ? 800 : 500, color: 'var(--rt-text)' }
  }

  const colDefs = useMemo<ColDef[]>(() => [
    // The customer's OWN class name, translated only when a translation exists
    // (e.g. the owner's English 'Sales'); 'Unclassified' is the API constant.
    { field: 'section', headerName: 'Section', width: 140,
      valueFormatter: p => (p.data?.kind !== 'row' ? '' : (p.value ? tr(String(p.value)) : '')),
      cellStyle: p => ({ fontSize: 11.5, fontWeight: 600,
        color: p.data?.kind === 'row' ? 'var(--rt-text-2)' : 'var(--rt-text)' }) },
    // Level-2 branch of the touch-menu tree (may be empty — fully free below level 1).
    { field: 'group', headerName: 'Group', width: 140,
      valueFormatter: p => (p.data?.kind !== 'row' ? '' : (p.value ?? '')),
      cellStyle: { fontSize: 11.5, color: 'var(--rt-text-2)' } },
    { field: 'account_code', headerName: 'Account Code', width: 130,
      cellStyle: p => ({ fontFamily: 'monospace', fontWeight: 700,
        color: p.data?.kind === 'row' ? PURPLE_BRAND[500] : 'var(--rt-text)' }) },
    { field: 'account_name', headerName: 'Account Name', flex: 1, minWidth: 220, cellStyle: rowStyle },
    { field: 'amount', headerName: 'Amount', width: 160, type: 'numericColumn',
      valueFormatter: p => fmtMoney(p.value),
      cellStyle: (p: any): any => {
        if (p.data?.kind === 'net' || p.node?.rowPinned) {
          const neg = +(p.value ?? 0) < -EPS
          return { fontWeight: 800, color: neg ? 'var(--rt-neg-fg)' : 'var(--rt-pos-fg)',
                   backgroundColor: neg ? 'var(--rt-neg-bg)' : 'var(--rt-pos-bg)' }
        }
        const base = rowStyle(p)
        return { ...base, color: +(p.value ?? 0) < 0 ? 'var(--rt-neg-fg)' : (base as any).color }
      } },
  ], [])

  // Statement order is the report — sorting or filtering it apart would
  // scramble the sections, so both are off.
  const defaultColDef = useMemo(() => ({ sortable: false, filter: false, resizable: true,
    wrapHeaderText: true, autoHeaderHeight: true }), [])

  const filtersLabel = `${dateFrom} → ${dateTo} · ${stores.length ? `${stores.length} ${tr('store(s)')}` : tr('All stores')}`
    + `${subs.length ? ` · ${subs.map(s => s.name).join(', ')}` : ''}`
    + ` · ${dateBasisLabel(dateBasis)}`
    + `${includeUnbalanced ? ` · ${tr('Include unbalanced documents')}` : ''}`

  const [glOff, glReason] = useFeature(FEATURE_ACCOUNTING)
  if (glOff) return (
    <Box sx={{ pt: 3, px: 3, pb: 3 }}>
      <Typography variant="h6" sx={{ fontWeight: 800, color: 'var(--rt-text)', letterSpacing: '-0.3px', mb: 1 }}>
        {tr('Profit & Loss')}
      </Typography>
      <FeatureUnavailable
        title="Accounting is not available on this server"
        reason={glReason || 'The accounting subsidiary (100) is not present on this server.'} />
    </Box>
  )

  return (
    <Box sx={{ pt: 0, px: 3, pb: 3, minHeight: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* ── Header + slicers ── */}
      <Box sx={{ position: 'sticky', top: 0, zIndex: 10, bgcolor: 'var(--rt-surface)', mx: -3, px: 3, pt: 3, pb: 2,
        borderBottom: '1px solid var(--rt-border)' }}>
        <Typography variant="h6" sx={{ fontWeight: 800, color: 'var(--rt-text)', letterSpacing: '-0.3px', mb: 0.3 }}>
          {tr('Profit & Loss')}<TitleLoader />
        </Typography>
        <Typography sx={{ fontSize: 12, color: 'var(--rt-text-2)', mb: 1.5 }}>{dateFrom} — {dateTo}</Typography>
        <Box sx={{ display: 'flex', alignItems: 'flex-end', flexWrap: 'wrap', gap: 1 }}>
          <Stack direction="row" spacing={0.5}>
            {Object.keys(PRESETS).map(p => (
              <Chip key={p} label={tr(p)} size="small" onClick={() => applyPreset(p)}
                variant={preset === p ? 'filled' : 'outlined'}
                sx={{ fontWeight: 600, fontSize: 11, ...(preset === p
                  ? { bgcolor: PURPLE_BRAND[500], color: theme.palette.primary.contrastText,
                      '&:hover': { bgcolor: PURPLE_BRAND[600] } }
                  : { borderColor: 'var(--rt-border)', color: 'var(--rt-text-2)' }) }} />
            ))}
          </Stack>
          <TextField label={tr('From')} type="date" size="small" sx={{ width: 150 }} InputLabelProps={{ shrink: true }}
            value={dateFrom} onChange={e => { winPinned.current = true; setPreset(''); setDateFrom(e.target.value) }} />
          <TextField label={tr('To')} type="date" size="small" sx={{ width: 150 }} InputLabelProps={{ shrink: true }}
            value={dateTo} onChange={e => { winPinned.current = true; setPreset(''); setDateTo(e.target.value) }} />
          <Autocomplete multiple disableCloseOnSelect size="small" options={allStores} value={stores}
            onChange={(_, v) => setStores(v as string[])} sx={{ minWidth: 200, maxWidth: 320 }}
            renderInput={p => <TextField {...p} label={tr('Store')} />} limitTags={1} />
          <Autocomplete multiple disableCloseOnSelect size="small" options={allSubs} value={subs}
            getOptionLabel={(o: any) => o?.name ?? ''}
            isOptionEqualToValue={(a: any, b: any) => a.sid === b.sid}
            onChange={(_, v) => setSubs(v as { sid: string; name: string }[])}
            sx={{ minWidth: 200, maxWidth: 320 }}
            renderInput={p => <TextField {...p} label={tr('Subsidiary')} />} limitTags={1} />
          <DateBasisToggle value={dateBasis} onChange={setDateBasis} />
          <FormControlLabel
            control={<Switch size="small" checked={includeUnbalanced}
              onChange={e => setIncludeUnbalanced(e.target.checked)} />}
            label={<Typography sx={{ fontSize: 12, fontWeight: 600, color: 'var(--rt-text-2)' }}>
              {tr('Include unbalanced documents')}</Typography>} />
        </Box>
      </Box>

      {/* ── Unmapped classes: inline one-time setup ── */}
      <UnmappedClassesBanner invalidate={['gl-profit-loss', 'gl-balance-sheet']} />

      {/* ── Unclassified accounts: warn, never hide ── */}
      {stmt.unclassifiedCount > 0 && (
        <Box sx={{ mt: 2 }}>
          <Chip size="small"
            label={trf('{{n}} accounts unclassified — place them in the accounting touch menu in Prism',
              { n: num(stmt.unclassifiedCount, 0) })}
            sx={{ bgcolor: 'var(--rt-warn-bg)', color: 'var(--rt-warn-fg)',
                  border: '1px solid var(--rt-warn-fg)', fontWeight: 600, fontSize: 11.5,
                  height: 'auto', py: 0.4, '& .MuiChip-label': { whiteSpace: 'normal' } }} />
        </Box>
      )}

      {/* ── KPI cards ── */}
      <Box sx={{ display: 'grid', gap: 2, mt: 2,
        gridTemplateColumns: { xs: 'repeat(2,1fr)', md: 'repeat(4,1fr)' } }}>
        <KpiCard label={tr('Total Revenue')} value={money(stmt.revenueTotal)}
          sub={tr('in current filter')} color={PURPLE_BRAND[500]} icon="ti-trending-up" />
        <KpiCard label={tr('Total Costs')} value={money(stmt.costTotal)}
          sub={tr('in current filter')} color={PURPLE_BRAND[400]} icon="ti-trending-down" />
        {stmt.grossProfit != null && (
          <KpiCard label={tr('Gross Profit')} value={money(stmt.grossProfit)}
            sub={tr('revenue − first cost section')}
            color={stmt.grossProfit >= 0 ? theme.palette.success.main : theme.palette.error.main}
            icon="ti-stairs-up" />
        )}
        <KpiCard label={tr('Net Profit')} value={moneyExact(stmt.netProfit, 2)}
          sub={tr('revenue − costs')}
          color={stmt.netProfit >= 0 ? theme.palette.success.main : theme.palette.error.main}
          icon="ti-cash" />
        {Math.abs(stmt.unclassifiedNet) >= EPS && (
          <KpiCard label={tr('Unclassified')} value={moneyExact(stmt.unclassifiedNet, 2)}
            sub={tr('not included in net profit')}
            color={theme.palette.warning.main} icon="ti-help-circle" />
        )}
      </Box>

      {/* ── Statement grid ── */}
      <Paper elevation={0} sx={{ borderRadius: 2, border: '1px solid var(--rt-border)', overflow: 'hidden', mt: 2, mb: 1 }}>
        <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ px: 1.5, py: 1, flexWrap: 'wrap', gap: 1 }}>
          <Box>
            <Typography sx={{ fontWeight: 700, fontSize: 13, color: 'var(--rt-text)' }}>
              {tr('Profit & Loss')}{' '}
              <Box component="span" sx={{ color: 'var(--rt-text-2)', fontWeight: 500 }}>· {num(rows.length, 0)}</Box>
            </Typography>
            <Typography sx={{ fontSize: 11, color: 'var(--rt-text-2)' }}>
              {tr('Sections follow your accounting touch-menu order')}
            </Typography>
          </Box>
          <GridExportBar gridRef={gridRef} filename="profit_loss" title="Profit & Loss"
            view={tr('Profit & Loss')} filters={filtersLabel}
            reportEndpoint="/api/accounting/profit-loss" reportPeriod={preset || 'custom'}
            reportParams={filterParams} colDefs={colDefs} onResetColumns={colState.resetColumns} />
        </Stack>
        <Box className="ag-theme-alpine" sx={{ height: 560, ...GRID_SX }}>
          <AgGridReact localeText={gridLocaleText()} ref={gridRef} rowData={stmt.display}
            columnDefs={trCols(colDefs as any[])}
            defaultColDef={defaultColDef} overlayNoRowsTemplate={noRowsOverlay()}
            pinnedBottomRowData={pinnedBottom}
            onGridReady={colState.onGridReady} onColumnMoved={colState.onColumnChanged}
            onColumnResized={colState.onColumnChanged} onColumnVisible={colState.onColumnChanged}
            rowHeight={34} headerHeight={38} suppressCellFocus animateRows />
        </Box>
      </Paper>
    </Box>
  )
}
