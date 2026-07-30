/**
 * Accounting → Balance Sheet
 * ==========================
 * Cumulative balances as of ONE date, stacked in role order: Assets first,
 * then Liabilities, then Equity — sections are the customer's OWN classes,
 * subtotal per section. Equity includes the SYNTHETIC 'Current period result'
 * row (the cumulative net P&L to the as-of date, marked synthetic:true by the
 * backend) — the books carry no retained-earnings posting yet, so that row is
 * exactly what makes the sheet balance. It renders italic: computed, not
 * posted.
 *
 * HONESTY RULE: Total Assets and Total Liabilities + Equity are shown side by
 * side with their difference. 0.00 renders in the positive tokens; anything
 * else in the negative tokens — never hidden. Unclassified balances (NULL or
 * unmapped class) are listed last with their raw signed balance and are the
 * usual explanation of a non-zero difference.
 *
 * Colours come exclusively from the --rt-* design tokens — no local hex.
 */
import { useMemo, useRef, useState } from 'react'
import {
  Box, Typography, TextField, Autocomplete, Stack, Paper,
  Switch, FormControlLabel, Chip, useTheme,
} from '@mui/material'
import { AgGridReact } from 'ag-grid-react'
import type { ColDef } from 'ag-grid-community'
import 'ag-grid-community/styles/ag-grid.css'
import 'ag-grid-community/styles/ag-theme-alpine.css'
import { useQuery } from '@tanstack/react-query'
import axios from 'axios'
import { format } from 'date-fns'
import GridExportBar from '../../components/GridExportBar'
import KpiCard from '../../components/KpiCard'
import TitleLoader from '../../components/TitleLoader'
import FeatureUnavailable from '../../components/FeatureUnavailable'
import { DateBasisToggle, DEFAULT_DATE_BASIS, dateBasisLabel, useAccountingDefaults } from '../../components/AccountingFilters'
import type { DateBasis } from '../../components/AccountingFilters'
import { useFeature, FEATURE_ACCOUNTING } from '../../hooks/useFeatures'
import { useGridColumnState } from '../../hooks/useGridColumnState'
import { useGlDefaultWindow } from '../../hooks/useGlWindow'
import { noRowsOverlay } from '../../utils/gridOverlay'
import { gridLocaleText } from '../../utils/gridLocale'
import { moneyExact, money, num } from '../../utils/formatters'
import { tr, trf, trCols } from '../../i18n'
import { PURPLE_BRAND } from '../../theme'
import { UnmappedClassesBanner } from './ProfitLoss'

const today = format(new Date(), 'yyyy-MM-dd')
const fmtMoney = (v: any) => (v == null || v === '' ? '' : moneyExact(v, 2))
const EPS = 0.005

const GRID_SX = {
  width: '100%',
  '& .ag-header': { bgcolor: 'var(--rt-grid-header-bg) !important', borderBottom: '1px solid var(--rt-border)' },
  '& .ag-header-cell-text': { fontWeight: 700, color: 'var(--rt-grid-header-fg)', fontSize: 12 },
  '& .ag-row-even': { bgcolor: 'var(--rt-surface)' },
  '& .ag-row-odd': { bgcolor: 'var(--rt-surface-2)' },
} as const

interface BsRow {
  section: string; section_seq: number; role: string | null; group: string | null
  account_code: string; account_name: string; balance: number; synthetic: boolean
}

export default function BalanceSheet() {
  const theme = useTheme()
  const gridRef = useRef<AgGridReact>(null)
  const colState = useGridColumnState('accounting-balance-sheet')

  const [asOf, setAsOf]   = useState(today)
  const [stores, setStores] = useState<string[]>([])
  const [subs,   setSubs]   = useState<{ sid: string; name: string }[]>([])
  const [includeUnbalanced, setIncludeUnbalanced] = useState(false)
  const [dateBasis, setDateBasis] = useState<DateBasis>(DEFAULT_DATE_BASIS)
  // Admin-configured report defaults (Settings → Accounting) as initial state
  useAccountingDefaults(setDateBasis, setIncludeUnbalanced)
  // Open on the GL's own loaded end date — "today" is routinely past the
  // loaded period, which reads as an empty sheet on a healthy warehouse.
  const winPinned = useRef(false)
  useGlDefaultWindow(winPinned, (_f, t) => setAsOf(t))

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

  const filterParams = useMemo(() => ({
    as_of: asOf,
    ...(stores.length ? { stores: stores.join(',') } : {}),
    ...(subs.length   ? { subsidiaries: subs.map(s => s.sid).join(',') } : {}),
    date_basis: dateBasis,
    include_unbalanced: includeUnbalanced,
  }), [asOf, stores, subs, dateBasis, includeUnbalanced])

  const { data: rows = [] } = useQuery<BsRow[]>({
    queryKey: ['gl-balance-sheet', filterParams],
    queryFn: () => axios.get('/api/accounting/balance-sheet', { params: filterParams }).then(r => r.data),
    placeholderData: p => p,
  })

  // ── Sections (server order: assets → liabilities → equity → unclassified) ──
  const stmt = useMemo(() => {
    const sections: { name: string; role: string | null; rows: BsRow[]; total: number }[] = []
    const byKey = new Map<string, number>()
    for (const r of rows) {
      const key = `${r.role ?? 'null'}|${r.section}`
      let i = byKey.get(key)
      if (i == null) { i = sections.length; byKey.set(key, i); sections.push({ name: r.section, role: r.role, rows: [], total: 0 }) }
      sections[i].rows.push(r)
      sections[i].total += +(r.balance ?? 0)
    }
    const sum = (role: string) => sections.filter(s => s.role === role).reduce((a, s) => a + s.total, 0)
    const assets = sum('asset')
    const liabEquity = sum('liability') + sum('equity')
    const unclassified = sections.find(s => s.role == null)
    const difference = assets - liabEquity
    const display: any[] = []
    for (const s of sections) {
      for (const r of s.rows) display.push({ ...r, kind: 'row' })
      display.push({ kind: 'subtotal', section: s.name, role: s.role,
        account_name: trf('Total {{s}}', { s: s.role == null ? tr('Unclassified') : tr(s.name) }),
        balance: Math.round(s.total * 100) / 100 })
    }
    return { sections, assets, liabEquity, difference,
             unclassifiedCount: unclassified?.rows.filter(r => !r.synthetic).length ?? 0,
             unclassifiedNet: unclassified?.total ?? 0, display }
  }, [rows])

  const balanced = Math.abs(stmt.difference) < EPS

  const pinnedBottom = useMemo(() => [
    { kind: 'total', account_name: tr('Total Assets'),
      balance: Math.round(stmt.assets * 100) / 100 },
    { kind: 'total', account_name: tr('Total Liabilities & Equity'),
      balance: Math.round(stmt.liabEquity * 100) / 100 },
    { kind: 'diff', account_name: tr('Difference'),
      balance: Math.round(stmt.difference * 100) / 100 },
  ], [stmt.assets, stmt.liabEquity, stmt.difference])

  const rowStyle = (p: any): any => {
    const k = p.data?.kind
    if (k === 'subtotal') return { fontWeight: 700, color: 'var(--rt-text)', backgroundColor: 'var(--rt-surface-3)' }
    if (p.data?.synthetic) return { fontStyle: 'italic', fontWeight: 600, color: 'var(--rt-text-2)' }
    return { fontWeight: p.node?.rowPinned ? 800 : 500, color: 'var(--rt-text)' }
  }

  const colDefs = useMemo<ColDef[]>(() => [
    { field: 'section', headerName: 'Section', width: 140,
      valueFormatter: p => (p.data?.kind !== 'row' ? '' : (p.value ? tr(String(p.value)) : '')),
      cellStyle: p => ({ fontSize: 11.5, fontWeight: 600,
        color: p.data?.kind === 'row' ? 'var(--rt-text-2)' : 'var(--rt-text)' }) },
    { field: 'group', headerName: 'Group', width: 140,
      valueFormatter: p => (p.data?.kind !== 'row' ? '' : (p.value ?? '')),
      cellStyle: { fontSize: 11.5, color: 'var(--rt-text-2)' } },
    { field: 'account_code', headerName: 'Account Code', width: 130,
      cellStyle: p => ({ fontFamily: 'monospace', fontWeight: 700,
        color: p.data?.kind === 'row' && !p.data?.synthetic ? PURPLE_BRAND[500] : 'var(--rt-text)' }) },
    { field: 'account_name', headerName: 'Account Name', flex: 1, minWidth: 220,
      valueFormatter: p => (p.data?.synthetic ? tr('Current period result') : p.value),
      cellStyle: rowStyle },
    { field: 'balance', headerName: 'Balance', width: 160, type: 'numericColumn',
      valueFormatter: p => fmtMoney(p.value),
      cellStyle: (p: any): any => {
        if (p.data?.kind === 'diff') {
          const ok = Math.abs(+(p.value ?? 0)) < EPS
          return { fontWeight: 800, color: ok ? 'var(--rt-pos-fg)' : 'var(--rt-neg-fg)',
                   backgroundColor: ok ? 'var(--rt-pos-bg)' : 'var(--rt-neg-bg)' }
        }
        if (p.data?.kind === 'total' || p.node?.rowPinned)
          return { fontWeight: 800, color: 'var(--rt-text)', backgroundColor: 'var(--rt-surface-3)' }
        const base = rowStyle(p)
        return { ...base, color: +(p.value ?? 0) < 0 ? 'var(--rt-neg-fg)' : (base as any).color }
      } },
  ], [])

  // Statement order is the report — sorting/filtering off (see ProfitLoss).
  const defaultColDef = useMemo(() => ({ sortable: false, filter: false, resizable: true,
    wrapHeaderText: true, autoHeaderHeight: true }), [])

  const filtersLabel = `${tr('As of')} ${asOf} · ${stores.length ? `${stores.length} ${tr('store(s)')}` : tr('All stores')}`
    + `${subs.length ? ` · ${subs.map(s => s.name).join(', ')}` : ''}`
    + ` · ${dateBasisLabel(dateBasis)}`
    + `${includeUnbalanced ? ` · ${tr('Include unbalanced documents')}` : ''}`

  const [glOff, glReason] = useFeature(FEATURE_ACCOUNTING)
  if (glOff) return (
    <Box sx={{ pt: 3, px: 3, pb: 3 }}>
      <Typography variant="h6" sx={{ fontWeight: 800, color: 'var(--rt-text)', letterSpacing: '-0.3px', mb: 1 }}>
        {tr('Balance Sheet')}
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
          {tr('Balance Sheet')}<TitleLoader />
        </Typography>
        <Typography sx={{ fontSize: 12, color: 'var(--rt-text-2)', mb: 1.5 }}>{tr('As of')} {asOf}</Typography>
        <Box sx={{ display: 'flex', alignItems: 'flex-end', '& > *:not(.MuiFormControl-root):not(.MuiAutocomplete-root)': { mb: '6px' }, flexWrap: 'wrap', gap: 1 }}>
          <TextField label={tr('As of')} type="date" size="small" sx={{ width: 160 }} InputLabelProps={{ shrink: true }}
            value={asOf} onChange={e => { winPinned.current = true; setAsOf(e.target.value) }} />
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

      {/* ── Out-of-balance strip: shown honestly, never hidden ── */}
      {!balanced && rows.length > 0 && (
        <Box sx={{ mt: 2, px: 2, py: 1.2, borderRadius: 2,
          bgcolor: 'var(--rt-neg-bg)', border: '1px solid var(--rt-neg-fg)' }}>
          <Typography sx={{ fontSize: 13, fontWeight: 800, color: 'var(--rt-neg-fg)' }}>
            {trf('Balance sheet difference {{v}} — assets do not equal liabilities + equity',
              { v: moneyExact(stmt.difference, 2) })}
          </Typography>
          <Typography sx={{ fontSize: 12, color: 'var(--rt-neg-fg)', mt: 0.3 }}>
            {tr('Unclassified accounts and unmapped classes explain this gap — nothing is hidden.')}
          </Typography>
        </Box>
      )}

      {/* ── Unmapped classes: inline one-time setup (shared with P&L) ── */}
      <UnmappedClassesBanner invalidate={['gl-balance-sheet', 'gl-profit-loss']} />

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

      {/* ── The honest totals: assets vs liabilities+equity, side by side ── */}
      <Box sx={{ display: 'grid', gap: 2, mt: 2,
        gridTemplateColumns: { xs: 'repeat(2,1fr)', md: 'repeat(4,1fr)' } }}>
        <KpiCard label={tr('Total Assets')} value={money(stmt.assets)}
          sub={`${tr('As of')} ${asOf}`} color={PURPLE_BRAND[500]} icon="ti-building-bank" />
        <KpiCard label={tr('Total Liabilities & Equity')} value={money(stmt.liabEquity)}
          sub={tr('incl. current period result')} color={PURPLE_BRAND[400]} icon="ti-scale" />
        <KpiCard label={tr('Difference')} value={moneyExact(stmt.difference, 2)}
          sub={balanced ? tr('books balance') : tr('must be zero')}
          color={balanced ? theme.palette.success.main : theme.palette.error.main}
          icon="ti-equal" />
        {Math.abs(stmt.unclassifiedNet) >= EPS && (
          <KpiCard label={tr('Unclassified')} value={moneyExact(stmt.unclassifiedNet, 2)}
            sub={tr('outside assets and liabilities + equity')}
            color={theme.palette.warning.main} icon="ti-help-circle" />
        )}
      </Box>

      {/* ── Statement grid ── */}
      <Paper elevation={0} sx={{ borderRadius: 2, border: '1px solid var(--rt-border)', overflow: 'hidden', mt: 2, mb: 1 }}>
        <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ px: 1.5, py: 1, flexWrap: 'wrap', gap: 1 }}>
          <Box>
            <Typography sx={{ fontWeight: 700, fontSize: 13, color: 'var(--rt-text)' }}>
              {tr('Balance Sheet')}{' '}
              <Box component="span" sx={{ color: 'var(--rt-text-2)', fontWeight: 500 }}>· {num(rows.length, 0)}</Box>
            </Typography>
            <Typography sx={{ fontSize: 11, color: 'var(--rt-text-2)' }}>
              {tr('Sections follow your accounting touch-menu order')}
            </Typography>
          </Box>
          <GridExportBar gridRef={gridRef} filename="balance_sheet" title="Balance Sheet"
            view={tr('Balance Sheet')} filters={filtersLabel}
            reportEndpoint="/api/accounting/balance-sheet" reportPeriod="custom"
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
