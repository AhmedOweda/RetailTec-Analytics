/**
 * Accounting → Trial Balance
 * ==========================
 * opening | debit | credit | movement | closing per account, for the selected
 * window / stores / subsidiaries.
 *
 * The pinned TOTAL row carries the debit and credit sums and THEIR DIFFERENCE.
 * On balanced documents that difference reads 0.00 — that is the entire point
 * of the report. When it does not, the figure is rendered in the negative token
 * colour and an out-of-balance strip appears above the grid: a non-zero trial
 * balance is a real defect and is never hidden, rounded away or suppressed.
 *
 * Clicking an account drills through to the General Ledger for that account,
 * carrying the current window and scope (same param names Journals.tsx uses).
 *
 * Colours come exclusively from the --rt-* design tokens and the MUI palette —
 * no local hex constants (that pattern produced invisible text in dark mode).
 */
import { useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Box, Typography, Chip, TextField, Autocomplete, Stack, Paper,
  Switch, FormControlLabel, useTheme,
} from '@mui/material'
import { AgGridReact } from 'ag-grid-react'
import type { ColDef } from 'ag-grid-community'
import 'ag-grid-community/styles/ag-grid.css'
import 'ag-grid-community/styles/ag-theme-alpine.css'
import { useQuery } from '@tanstack/react-query'
import axios from 'axios'
import { format, subDays, startOfMonth, startOfYear } from 'date-fns'
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

const iso = (d: Date) => format(d, 'yyyy-MM-dd')
const today = iso(new Date())
const PRESETS: Record<string, [string, string]> = {
  '7D':  [iso(subDays(new Date(), 6)),  today],
  '30D': [iso(subDays(new Date(), 29)), today],
  'MTD': [iso(startOfMonth(new Date())), today],
  'YTD': [iso(startOfYear(new Date())),  today],
}

/** Money in a grid cell — always 2dp so "0.00" is unambiguous. */
const fmtMoney = (v: any) => (v == null ? '' : moneyExact(v, 2))

/** A difference is only "balanced" when it RENDERS as 0.00; below that it is
 *  float noise from summing DECIMAL(18,4) values, not a posting error. The
 *  displayed number and the colour therefore can never disagree. */
const EPS = 0.005

const GRID_SX = {
  width: '100%',
  '& .ag-header': { bgcolor: 'var(--rt-grid-header-bg) !important', borderBottom: '1px solid var(--rt-border)' },
  '& .ag-header-cell-text': { fontWeight: 700, color: 'var(--rt-grid-header-fg)', fontSize: 12 },
  '& .ag-row-even': { bgcolor: 'var(--rt-surface)' },
  '& .ag-row-odd': { bgcolor: 'var(--rt-surface-2)' },
  '& .ag-row-selected': { bgcolor: 'var(--rt-grid-selected) !important' },
  '& .ag-row-pinned': { bgcolor: 'var(--rt-surface-3) !important', borderTop: '2px solid var(--rt-border)' },
  '& .ag-paging-panel': { borderTop: '1px solid var(--rt-border)', color: 'var(--rt-text-2)' },
} as const

export default function TrialBalance() {
  const theme = useTheme()
  const navigate = useNavigate()
  const gridRef = useRef<AgGridReact>(null)
  const colState = useGridColumnState('accounting-trial-balance')

  // ── Slicers ────────────────────────────────────────────────────────────────
  const [preset, setPreset]     = useState('MTD')
  const [dateFrom, setDateFrom] = useState(PRESETS['MTD'][0])
  const [dateTo,   setDateTo]   = useState(PRESETS['MTD'][1])
  const [stores,   setStores]   = useState<string[]>([])
  const [subs,     setSubs]     = useState<{ sid: string; name: string }[]>([])
  // Default ON: a chart of accounts is mostly dormant, and rows that are zero
  // on every measure carry no information.
  const [hideZero, setHideZero] = useState(true)
  // Default OFF: the statements show balanced source documents only. Turning
  // this on pulls the unbalanced ones in so the gap is inspectable.
  const [includeUnbalanced, setIncludeUnbalanced] = useState(false)
  // Which of the two GL dates the period (and the opening cut) is measured on.
  // No journal-category filter here on purpose: a trial balance that omitted
  // the payment journals would not net to zero, which is the one property the
  // report exists to demonstrate.
  const [dateBasis, setDateBasis] = useState<DateBasis>(DEFAULT_DATE_BASIS)
  // Admin-configured report defaults (Settings → Accounting) as initial state
  useAccountingDefaults(setDateBasis, setIncludeUnbalanced)
  // True once the window is authoritative (preset chip or manual edit).
  const winPinned = useRef(false)

  // Open on the GL's OWN loaded span instead of a rolling window — a ledger is
  // loaded per accounting period, so "this month" is routinely empty.
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

  // Scope shared by the grid, the KPI summary and the drill-through link.
  const scopeParams = useMemo(() => ({
    date_from: dateFrom, date_to: dateTo,
    ...(stores.length ? { stores: stores.join(',') } : {}),
    ...(subs.length   ? { subsidiaries: subs.map(s => s.sid).join(',') } : {}),
    date_basis: dateBasis,
    include_unbalanced: includeUnbalanced,
  }), [dateFrom, dateTo, stores, subs, dateBasis, includeUnbalanced])

  const filterParams = useMemo(() => ({ ...scopeParams, hide_zero: hideZero }), [scopeParams, hideZero])

  const { data: rows = [] } = useQuery<any[]>({
    queryKey: ['gl-trial-balance', filterParams],
    queryFn: () => axios.get('/api/accounting/trial-balance', { params: filterParams }).then(r => r.data),
    placeholderData: p => p,
  })

  const { data: summary } = useQuery<any>({
    queryKey: ['gl-summary', scopeParams],
    queryFn: () => axios.get('/api/accounting/summary', { params: scopeParams }).then(r => r.data),
    placeholderData: p => p,
  })

  // ── TOTAL row: the debit / credit sums and their difference ────────────────
  const totals = useMemo(() => {
    const sum = (k: string) => rows.reduce((a, r) => a + +(r[k] ?? 0), 0)
    const debit = sum('debit'), credit = sum('credit')
    return { opening: sum('opening'), debit, credit, movement: debit - credit, closing: sum('closing') }
  }, [rows])

  const outOfBalance = Math.abs(totals.movement) >= EPS

  // Accounts WITH ACTIVITY in this window but no ACCOUNT_CLASS: until the
  // owner places them under the 'accounting' touch menu in Prism, the
  // financial statements cannot be built from this trial balance. Zero-only
  // rows (visible when the hide-zero switch is off) don't count — a dormant
  // unclassified account blocks nothing.
  const unclassified = useMemo(() =>
    rows.filter(r => !r.account_class && (
      Math.abs(+(r.opening ?? 0)) >= EPS || Math.abs(+(r.debit ?? 0)) >= EPS ||
      Math.abs(+(r.credit ?? 0)) >= EPS || Math.abs(+(r.closing ?? 0)) >= EPS
    )).length, [rows])

  const pinnedBottom = useMemo(() => [{
    account_code: '', account_name: tr('TOTAL'),
    opening: totals.opening, debit: totals.debit, credit: totals.credit,
    movement: totals.movement, closing: totals.closing,
  }], [totals])

  // ── Drill-through → General Ledger for the clicked account ────────────────
  // Same param names Journals.tsx reads on arrival (date_from / date_to /
  // stores), plus the account and the balanced-gate state, so the ledger opens
  // on exactly the figures the user clicked.
  const drill = (accountCode: string) => {
    if (!accountCode) return
    const p = new URLSearchParams({ account: accountCode, date_from: dateFrom, date_to: dateTo })
    if (stores.length) p.set('stores', stores.join(','))
    if (subs.length)   p.set('subsidiaries', subs.map(s => s.sid).join(','))
    if (includeUnbalanced) p.set('include_unbalanced', 'true')
    // Carry the basis: the ledger must open on the SAME date basis the figure
    // was computed under, or the drilled rows will not add up to the number
    // that was clicked.
    p.set('date_basis', dateBasis)
    navigate(`/accounting/general-ledger?${p.toString()}`)
  }

  // Money cells: negatives take the negative token; the TOTAL row is bolder.
  const moneyCell = (p: any) => ({
    fontWeight: p.node?.rowPinned ? 800 : 600,
    color: +(p.value ?? 0) < 0 ? 'var(--rt-neg-fg)' : 'var(--rt-text)',
  })

  const colDefs = useMemo<ColDef[]>(() => [
    { field: 'account_code', headerName: 'Account Code', width: 140, pinned: 'left',
      cellStyle: p => ({ fontFamily: 'monospace', fontWeight: 700,
                         color: p.node?.rowPinned ? 'var(--rt-text)' : PURPLE_BRAND[500] }) },
    { field: 'account_name', headerName: 'Account Name', flex: 1, minWidth: 200,
      cellStyle: p => ({ fontWeight: p.node?.rowPinned ? 800 : 500, color: 'var(--rt-text)' }) },
    // Chart-of-accounts class, synced from the 'accounting' touch menu in
    // Prism (DIM_ACCOUNT.ACCOUNT_CLASS). Blank = not yet placed in the tree —
    // never guessed client-side. Values are the owner's taxonomy verbatim
    // (Assets / Liabilities / Equity / Purchases / Sales / Expenses),
    // translated at render only.
    { field: 'account_class', headerName: 'Class', width: 110,
      valueFormatter: p => (p.value ? tr(String(p.value)) : ''),
      cellStyle: p => ({ fontSize: 11, fontWeight: 600,
                         color: p.node?.rowPinned ? 'var(--rt-text)' : 'var(--rt-text-2)' }) },
    { field: 'opening', headerName: 'Opening', width: 140, type: 'numericColumn',
      valueFormatter: p => fmtMoney(p.value), cellStyle: moneyCell },
    { field: 'debit', headerName: 'Debit', width: 140, type: 'numericColumn',
      valueFormatter: p => fmtMoney(p.value), cellStyle: moneyCell },
    { field: 'credit', headerName: 'Credit', width: 140, type: 'numericColumn',
      valueFormatter: p => fmtMoney(p.value), cellStyle: moneyCell },
    // On the TOTAL row this column IS the trial-balance difference
    // (debit − credit). Non-zero = the books do not balance: negative token
    // colours, never dimmed or rounded away.
    { field: 'movement', headerName: 'Movement', width: 150, type: 'numericColumn',
      valueFormatter: p => fmtMoney(p.value),
      cellStyle: p => {
        if (p.node?.rowPinned) {
          return outOfBalance
            ? { fontWeight: 800, color: 'var(--rt-neg-fg)', backgroundColor: 'var(--rt-neg-bg)' }
            : { fontWeight: 800, color: 'var(--rt-pos-fg)', backgroundColor: 'var(--rt-pos-bg)' }
        }
        return moneyCell(p)
      } },
    { field: 'closing', headerName: 'Closing', width: 150, type: 'numericColumn',
      valueFormatter: p => fmtMoney(p.value), cellStyle: moneyCell },
  ], [outOfBalance])

  const defaultColDef = useMemo(() => ({ sortable: true, filter: true, resizable: true,
    wrapHeaderText: true, autoHeaderHeight: true }), [])

  const filtersLabel = `${dateFrom} → ${dateTo} · ${stores.length ? `${stores.length} ${tr('store(s)')}` : tr('All stores')}`
    + `${subs.length ? ` · ${subs.map(s => s.name).join(', ')}` : ''}`
    + ` · ${dateBasisLabel(dateBasis)}`
    + `${includeUnbalanced ? ` · ${tr('Include unbalanced documents')}` : ''}`

  // ── Optional customisation: the accounting subsidiary (100) ────────────────
  // Where it is absent FACT_GL is permanently empty, and an empty trial balance
  // reads exactly like "nothing was posted" — the one thing an accountant must
  // never be shown. Replace the body with a calm explanation instead. The hook
  // is called unconditionally (above every early return) and fails OPEN, so a
  // slow or failed /api/features can never blank a working page.
  const [glOff, glReason] = useFeature(FEATURE_ACCOUNTING)
  if (glOff) return (
    <Box sx={{ pt: 3, px: 3, pb: 3 }}>
      <Typography variant="h6" sx={{ fontWeight: 800, color: 'var(--rt-text)', letterSpacing: '-0.3px', mb: 1 }}>
        {tr('Trial Balance')}
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
          {tr('Trial Balance')}<TitleLoader />
        </Typography>
        <Typography sx={{ fontSize: 12, color: 'var(--rt-text-2)', mb: 1.5 }}>{dateFrom} — {dateTo}</Typography>

        <Box sx={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 1 }}>
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
            renderInput={p => <TextField {...p} placeholder={tr('Store')} />} limitTags={1} />
          <Autocomplete multiple disableCloseOnSelect size="small" options={allSubs} value={subs}
            getOptionLabel={(o: any) => o?.name ?? ''}
            isOptionEqualToValue={(a: any, b: any) => a.sid === b.sid}
            onChange={(_, v) => setSubs(v as { sid: string; name: string }[])}
            sx={{ minWidth: 200, maxWidth: 320 }}
            renderInput={p => <TextField {...p} placeholder={tr('Subsidiary')} />} limitTags={1} />

          {/* Date basis — the period this trial balance measures. Beside the
              other gates because it changes the figures, not the layout. */}
          <DateBasisToggle value={dateBasis} onChange={setDateBasis} />

          <FormControlLabel sx={{ ml: 0.5 }}
            control={<Switch size="small" checked={hideZero} onChange={e => setHideZero(e.target.checked)} />}
            label={<Typography sx={{ fontSize: 12, fontWeight: 600, color: 'var(--rt-text-2)' }}>
              {tr('Hide zero accounts')}</Typography>} />
          <FormControlLabel
            control={<Switch size="small" checked={includeUnbalanced}
              onChange={e => setIncludeUnbalanced(e.target.checked)} />}
            label={<Typography sx={{ fontSize: 12, fontWeight: 600, color: 'var(--rt-text-2)' }}>
              {tr('Include unbalanced documents')}</Typography>} />
        </Box>
      </Box>

      {/* ── Out-of-balance strip: a non-zero difference must never slip past ── */}
      {outOfBalance && (
        <Box sx={{ mt: 2, px: 2, py: 1.2, borderRadius: 2,
          bgcolor: 'var(--rt-neg-bg)', border: '1px solid var(--rt-neg-fg)' }}>
          <Typography sx={{ fontSize: 13, fontWeight: 800, color: 'var(--rt-neg-fg)' }}>
            {trf('Trial balance does not net to zero — difference {{v}}', { v: moneyExact(totals.movement, 2) })}
          </Typography>
          <Typography sx={{ fontSize: 12, color: 'var(--rt-neg-fg)', mt: 0.3 }}>
            {tr('Review GL Exceptions: some source documents do not balance across their journals.')}
          </Typography>
        </Box>
      )}

      {/* ── Unclassified-accounts chip: subtle (warn tokens, not a strip) —
             the books still balance, but the statements cannot be built until
             every active account carries a class from the Prism touch menu. ── */}
      {unclassified > 0 && (
        <Box sx={{ mt: 2 }}>
          <Chip size="small"
            label={trf('{{n}} accounts unclassified — place them in the accounting touch menu in Prism',
              { n: num(unclassified, 0) })}
            sx={{ bgcolor: 'var(--rt-warn-bg)', color: 'var(--rt-warn-fg)',
                  border: '1px solid var(--rt-warn-fg)', fontWeight: 600, fontSize: 11.5,
                  height: 'auto', py: 0.4, '& .MuiChip-label': { whiteSpace: 'normal' } }} />
        </Box>
      )}

      {/* ── KPI cards (/api/accounting/summary) ── */}
      <Box sx={{ display: 'grid', gap: 2, mt: 2,
        gridTemplateColumns: { xs: 'repeat(2,1fr)', md: 'repeat(3,1fr)', lg: 'repeat(5,1fr)' } }}>
        <KpiCard label={tr('Total Debit')}  value={money(summary?.total_debit ?? 0)}
          sub={tr('in current filter')} color={PURPLE_BRAND[500]} icon="ti-arrow-down-right" />
        <KpiCard label={tr('Total Credit')} value={money(summary?.total_credit ?? 0)}
          sub={tr('in current filter')} color={PURPLE_BRAND[400]} icon="ti-arrow-up-right" />
        <KpiCard label={tr('Difference')}   value={moneyExact(summary?.difference ?? 0, 2)}
          sub={Math.abs(+(summary?.difference ?? 0)) >= EPS ? tr('must be zero') : tr('books balance')}
          color={Math.abs(+(summary?.difference ?? 0)) >= EPS ? theme.palette.error.main : theme.palette.success.main}
          icon="ti-scale" />
        <KpiCard label={tr('Documents')} value={num(summary?.documents ?? 0, 0)}
          sub={tr('source documents')} color={PURPLE_BRAND[500]} icon="ti-file-invoice" />
        <KpiCard label={tr('Journals')} value={num(summary?.journals ?? 0, 0)}
          sub={tr('document × type')} color={PURPLE_BRAND[400]} icon="ti-book" />
        <KpiCard label={tr('GL Lines')} value={num(summary?.lines ?? 0, 0)}
          sub={tr('posted lines')} color={PURPLE_BRAND[600]} icon="ti-list-details" />
        <KpiCard label={tr('Accounts Used')} value={num(summary?.accounts_used ?? 0, 0)}
          sub={tr('distinct accounts')} color={PURPLE_BRAND[500]} icon="ti-wallet" />
        <KpiCard label={tr('Unbalanced Documents')} value={num(summary?.unbalanced_docs ?? 0, 0)}
          sub={tr('excluded by the balanced gate')}
          color={(summary?.unbalanced_docs ?? 0) > 0 ? theme.palette.warning.main : theme.palette.success.main}
          icon="ti-alert-triangle" />
        <KpiCard label={tr('Unbalanced Net')} value={moneyExact(summary?.unbalanced_net ?? 0, 2)}
          sub={tr('money not on the statements')}
          color={Math.abs(+(summary?.unbalanced_net ?? 0)) >= EPS ? theme.palette.error.main : theme.palette.success.main}
          icon="ti-report-money" />
      </Box>

      {/* ── Grid ── */}
      <Paper elevation={0} sx={{ borderRadius: 2, border: '1px solid var(--rt-border)', overflow: 'hidden', mt: 2, mb: 1 }}>
        <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ px: 1.5, py: 1, flexWrap: 'wrap', gap: 1 }}>
          <Box>
            <Typography sx={{ fontWeight: 700, fontSize: 13, color: 'var(--rt-text)' }}>
              {tr('Trial Balance')}{' '}
              <Box component="span" sx={{ color: 'var(--rt-text-2)', fontWeight: 500 }}>· {num(rows.length, 0)}</Box>
            </Typography>
            <Typography sx={{ fontSize: 11, color: 'var(--rt-text-2)' }}>
              {tr('Click an account to open its general ledger')}
            </Typography>
          </Box>
          <GridExportBar gridRef={gridRef} filename="trial_balance" title="Trial Balance"
            view={tr('Trial Balance')} filters={filtersLabel}
            reportEndpoint="/api/accounting/trial-balance" reportPeriod={preset || 'custom'}
            reportParams={filterParams} colDefs={colDefs} onResetColumns={colState.resetColumns} />
        </Stack>
        <Box className="ag-theme-alpine" sx={{ height: 520, ...GRID_SX }}>
          <AgGridReact localeText={gridLocaleText()} ref={gridRef} rowData={rows} columnDefs={trCols(colDefs as any[])}
            defaultColDef={defaultColDef} overlayNoRowsTemplate={noRowsOverlay()}
            pinnedBottomRowData={pinnedBottom}
            rowSelection="single"
            onRowClicked={e => { if (!e.node?.rowPinned) drill(String(e.data?.account_code ?? '')) }}
            onGridReady={colState.onGridReady} onColumnMoved={colState.onColumnChanged}
            onColumnResized={colState.onColumnChanged} onColumnVisible={colState.onColumnChanged}
            rowHeight={34} headerHeight={38} suppressCellFocus animateRows
            pagination paginationPageSize={100} />
        </Box>
      </Paper>
    </Box>
  )
}
