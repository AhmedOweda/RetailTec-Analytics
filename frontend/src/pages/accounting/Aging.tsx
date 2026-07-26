/**
 * Accounting → Aging (أعمار الديون) — AR / AP aging by business partner.
 *
 * BALANCE-based aging: open-item matching does not exist in this GL (the
 * poster never links a payment line to the invoice it pays), so the backend
 * allocates each partner's outstanding balance as of the cut-off FIFO against
 * their MOST RECENT charges — see /api/accounting/aging. The five bucket
 * columns are FIXED keys (current, d1_30, d31_60, d61_90, d90_plus) so the
 * grid and the scheduled report always have stable fields.
 *
 * AR shows customers who owe us (debit balances, positive); AP shows
 * suppliers we owe (credit balances, shown positive). The toggle is segmented
 * exactly like the shared DateBasisToggle — same tokens, same weight —
 * because it changes which rows the server returns, not the layout.
 *
 * Clicking a partner drills through to their BP Statement (bp_id + window),
 * the same click-to-drill contract Trial Balance → General Ledger uses.
 *
 * Colours come from the --rt-* design tokens only — no page-local hex.
 */
import { useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Box, Typography, TextField, Autocomplete, Stack, Paper, Chip,
  Switch, FormControlLabel, ToggleButton, ToggleButtonGroup, useTheme,
} from '@mui/material'
import { AgGridReact } from 'ag-grid-react'
import type { ColDef } from 'ag-grid-community'
import 'ag-grid-community/styles/ag-grid.css'
import 'ag-grid-community/styles/ag-theme-alpine.css'
import { useQuery } from '@tanstack/react-query'
import axios from 'axios'
import { format, parseISO, startOfYear, isValid } from 'date-fns'
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
import { tr, trf } from '../../i18n'
import { trCols } from '../../i18n'
import { PURPLE_BRAND } from '../../theme'

const today = format(new Date(), 'yyyy-MM-dd')
const fmtMoney = (v: any) => (v == null || v === '' ? '' : moneyExact(v, 2))
const EPS = 0.005

type Side = 'ar' | 'ap'

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

/** Same visual contract as the shared DateBasisToggle (AccountingFilters). */
const GROUP_SX = {
  '& .MuiToggleButton-root': {
    textTransform: 'none', fontSize: 11.5, fontWeight: 600, px: 1.2, py: 0.35,
    color: 'var(--rt-text-2)', borderColor: 'var(--rt-border)',
  },
  '& .MuiToggleButton-root.Mui-selected': {
    bgcolor: 'var(--rt-surface-3)', color: 'var(--rt-text)',
  },
  '& .MuiToggleButton-root.Mui-selected:hover': { bgcolor: 'var(--rt-surface-3)' },
} as const

export default function Aging() {
  const theme = useTheme()
  const navigate = useNavigate()
  const gridRef = useRef<AgGridReact>(null)
  const colState = useGridColumnState('accounting-aging')

  const [asOf,   setAsOf]   = useState(today)
  const [side,   setSide]   = useState<Side>('ar')
  const [stores, setStores] = useState<string[]>([])
  const [subs,   setSubs]   = useState<{ sid: string; name: string }[]>([])
  const [includeUnbalanced, setIncludeUnbalanced] = useState(false)
  const [dateBasis, setDateBasis] = useState<DateBasis>(DEFAULT_DATE_BASIS)
  // Admin-configured report defaults (Settings → Accounting) as initial state
  useAccountingDefaults(setDateBasis, setIncludeUnbalanced)
  // Open on the GL's own loaded end date — "today" is routinely past the
  // loaded period, which would read as "nobody owes anything".
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
    side,
    ...(stores.length ? { stores: stores.join(',') } : {}),
    ...(subs.length   ? { subsidiaries: subs.map(s => s.sid).join(',') } : {}),
    date_basis: dateBasis,
    ...(includeUnbalanced ? { include_unbalanced: true } : {}),
  }), [asOf, side, stores, subs, dateBasis, includeUnbalanced])

  // Bare list — one row per partner with an outstanding balance.
  const { data: rows = [] } = useQuery<any[]>({
    queryKey: ['acc-aging', filterParams],
    queryFn: () => axios.get('/api/accounting/aging', { params: filterParams }).then(r => r.data),
    placeholderData: p => p,
  })

  // Which measurement the server is using (Settings → Accounting): the
  // EFFECTIVE receivable / payable account lists, or the legacy role filter
  // when a list was explicitly cleared. Drives the method-note chip below.
  const { data: accStatus } = useQuery<any>({
    queryKey: ['acc-status'],
    queryFn: () => axios.get('/api/accounting/status').then(r => r.data),
    staleTime: 60_000,
    retry: false,
  })
  const partnerAccounts: string[] =
    (side === 'ar' ? accStatus?.receivable_accounts : accStatus?.payable_accounts) ?? []

  // ── Totals: the KPI cards and the pinned row share one computation ──
  const totals = useMemo(() => {
    const sum = (k: string) => rows.reduce((a, r) => a + +(r[k] ?? 0), 0)
    const balance = sum('balance'), current = sum('current')
    return { balance, current, overdue: balance - current,
             d1_30: sum('d1_30'), d31_60: sum('d31_60'),
             d61_90: sum('d61_90'), d90_plus: sum('d90_plus') }
  }, [rows])

  const pinnedBottom = useMemo(() => [{
    bp_name: tr('TOTAL'), bp_code: '', bp_kind: '',
    balance: totals.balance, current: totals.current, d1_30: totals.d1_30,
    d31_60: totals.d31_60, d61_90: totals.d61_90, d90_plus: totals.d90_plus,
  }], [totals])

  // ── Drill-through → BP Statement for the clicked partner. Window: start of
  //    the as-of year → as_of (the statement's own Opening Balance row carries
  //    everything earlier, so no history is lost by the window choice).
  const drill = (r: any) => {
    const id = String(r?.bp_id ?? '')
    if (!id) return
    const d = parseISO(asOf)
    const from = isValid(d) ? format(startOfYear(d), 'yyyy-MM-dd') : asOf
    const p = new URLSearchParams({ bp_id: id, bp_name: String(r?.bp_name ?? ''),
      date_from: from, date_to: asOf })
    if (stores.length) p.set('stores', stores.join(','))
    if (includeUnbalanced) p.set('include_unbalanced', 'true')
    // Carry the basis: the statement must open on the SAME basis the aged
    // balance was computed under, or its closing will not match this row.
    p.set('date_basis', dateBasis)
    navigate(`/accounting/bp-statement?${p.toString()}`)
  }

  const moneyCell = (p: any) => ({
    fontWeight: p.node?.rowPinned ? 800 : 600,
    color: +(p.value ?? 0) < 0 ? 'var(--rt-neg-fg)' : 'var(--rt-text)',
  })

  const colDefs = useMemo<ColDef[]>(() => [
    { field: 'bp_name', headerName: 'Business Partner', flex: 1, minWidth: 200, pinned: 'left',
      cellStyle: p => ({ fontWeight: p.node?.rowPinned ? 800 : 600,
        color: p.node?.rowPinned ? 'var(--rt-text)' : PURPLE_BRAND[500] }) },
    { field: 'bp_code', headerName: 'Partner Code', width: 130,
      cellStyle: { fontFamily: 'monospace', color: 'var(--rt-text-2)' } },
    { field: 'bp_kind', headerName: 'Kind', width: 110,
      valueFormatter: p => (p.value ? tr(String(p.value)) : ''),
      cellStyle: { fontSize: 11, fontWeight: 600, color: 'var(--rt-text-2)' } },
    { field: 'bp_id', headerName: 'Business Partner ID', width: 170, hide: true,
      cellStyle: { fontFamily: 'monospace', color: 'var(--rt-text-2)' } },
    { field: 'balance', headerName: 'Balance', width: 140, type: 'numericColumn',
      valueFormatter: p => fmtMoney(p.value),
      cellStyle: p => ({ ...moneyCell(p), fontWeight: p.node?.rowPinned ? 800 : 700 }) },
    { field: 'current', headerName: 'Current', width: 120, type: 'numericColumn',
      valueFormatter: p => fmtMoney(p.value), cellStyle: moneyCell },
    // Bucket headers stay LATIN numerals in both languages — they are day
    // ranges, not sentences (the i18n note says numeric ranges stay latin).
    { field: 'd1_30', headerName: '1-30', width: 120, type: 'numericColumn',
      valueFormatter: p => fmtMoney(p.value), cellStyle: moneyCell },
    { field: 'd31_60', headerName: '31-60', width: 120, type: 'numericColumn',
      valueFormatter: p => fmtMoney(p.value), cellStyle: moneyCell },
    { field: 'd61_90', headerName: '61-90', width: 120, type: 'numericColumn',
      valueFormatter: p => fmtMoney(p.value), cellStyle: moneyCell },
    { field: 'd90_plus', headerName: '90+', width: 130, type: 'numericColumn',
      valueFormatter: p => fmtMoney(p.value),
      cellStyle: p => (+(p.value ?? 0) >= EPS
        ? { fontWeight: p.node?.rowPinned ? 800 : 700, color: 'var(--rt-neg-fg)' }
        : moneyCell(p)) },
  ], [])

  const defaultColDef = useMemo(() => ({ sortable: true, filter: true, resizable: true,
    wrapHeaderText: true, autoHeaderHeight: true }), [])

  const sideLabel = side === 'ar' ? tr('Receivables') : tr('Payables')
  const filtersLabel = `${sideLabel} · ${tr('As of')} ${asOf}`
    + ` · ${stores.length ? `${stores.length} ${tr('store(s)')}` : tr('All stores')}`
    + `${subs.length ? ` · ${subs.map(s => s.name).join(', ')}` : ''}`
    + ` · ${dateBasisLabel(dateBasis)}`
    + `${includeUnbalanced ? ` · ${tr('Include unbalanced documents')}` : ''}`

  const [glOff, glReason] = useFeature(FEATURE_ACCOUNTING)
  if (glOff) return (
    <Box sx={{ pt: 3, px: 3, pb: 3 }}>
      <Typography variant="h6" sx={{ fontWeight: 800, color: 'var(--rt-text)', letterSpacing: '-0.3px', mb: 1 }}>
        {tr('Aging')}
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
          {tr('Aging')}<TitleLoader />
        </Typography>
        <Typography sx={{ fontSize: 12, color: 'var(--rt-text-2)', mb: 1.5 }}>
          {sideLabel} · {tr('As of')} {asOf}
        </Typography>

        <Box sx={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 1 }}>
          {/* AR / AP — segmented exactly like DateBasisToggle: it changes
              which rows the server returns, so it is always visible. */}
          <ToggleButtonGroup exclusive size="small" value={side} sx={GROUP_SX}
            onChange={(_, v) => { if (v) setSide(v as Side) }}>
            <ToggleButton value="ar" title={tr('Customers')}>{tr('Receivables')}</ToggleButton>
            <ToggleButton value="ap" title={tr('Suppliers')}>{tr('Payables')}</ToggleButton>
          </ToggleButtonGroup>

          <TextField label={tr('As of')} type="date" size="small" sx={{ width: 160 }} InputLabelProps={{ shrink: true }}
            value={asOf} onChange={e => { winPinned.current = true; setAsOf(e.target.value) }} />
          <Autocomplete multiple disableCloseOnSelect size="small" options={allStores} value={stores}
            onChange={(_, v) => setStores(v as string[])} sx={{ minWidth: 200, maxWidth: 320 }}
            renderInput={p => <TextField {...p} placeholder={tr('Store')} />} limitTags={1} />
          <Autocomplete multiple disableCloseOnSelect size="small" options={allSubs} value={subs}
            getOptionLabel={(o: any) => o?.name ?? ''}
            isOptionEqualToValue={(a: any, b: any) => a.sid === b.sid}
            onChange={(_, v) => setSubs(v as { sid: string; name: string }[])}
            sx={{ minWidth: 200, maxWidth: 320 }}
            renderInput={p => <TextField {...p} placeholder={tr('Subsidiary')} />} limitTags={1} />
          <DateBasisToggle value={dateBasis} onChange={setDateBasis} />
          <FormControlLabel
            control={<Switch size="small" checked={includeUnbalanced}
              onChange={e => setIncludeUnbalanced(e.target.checked)} />}
            label={<Typography sx={{ fontSize: 12, fontWeight: 600, color: 'var(--rt-text-2)' }}>
              {tr('Include unbalanced documents')}</Typography>} />
        </Box>
      </Box>

      {/* ── Method note: which lines are aged (configured control accounts,
             or the legacy role filter when the list was cleared) + the
             balance-FIFO allocation, because open-item data does not exist ── */}
      <Box sx={{ mt: 2 }}>
        <Chip size="small"
          label={partnerAccounts.length
            ? trf(side === 'ar'
                ? 'Aged on the configured receivable accounts ({{codes}}) — the outstanding balance is allocated FIFO against the most recent charges'
                : 'Aged on the configured payable accounts ({{codes}}) — the outstanding balance is allocated FIFO against the most recent charges',
                { codes: partnerAccounts.join(', ') })
            : tr('Balance-based aging — the outstanding balance is allocated FIFO against the most recent charges')}
          sx={{ bgcolor: 'var(--rt-surface-3)', color: 'var(--rt-text-2)', fontWeight: 600,
                fontSize: 11.5, height: 'auto', py: 0.4, '& .MuiChip-label': { whiteSpace: 'normal' } }} />
      </Box>

      {/* ── KPI cards ── */}
      <Box sx={{ display: 'grid', gap: 2, mt: 2,
        gridTemplateColumns: { xs: 'repeat(2,1fr)', md: 'repeat(4,1fr)' } }}>
        <KpiCard label={tr('Total Outstanding')} value={money(totals.balance)}
          sub={`${tr('As of')} ${asOf}`} color={PURPLE_BRAND[500]} icon="ti-report-money" />
        <KpiCard label={tr('Current')} value={money(totals.current)}
          sub={tr('in current filter')} color={theme.palette.success.main} icon="ti-clock" />
        <KpiCard label={tr('Overdue')} value={money(totals.overdue)}
          sub={tr('in current filter')}
          color={totals.overdue >= EPS ? theme.palette.error.main : theme.palette.success.main}
          icon="ti-alert-triangle" />
        <KpiCard label={tr('Partners')} value={num(rows.length, 0)}
          sub={tr('with outstanding balance')} color={PURPLE_BRAND[400]} icon="ti-users" />
      </Box>

      {/* ── Aging grid ── */}
      <Paper elevation={0} sx={{ borderRadius: 2, border: '1px solid var(--rt-border)', overflow: 'hidden', mt: 2, mb: 1 }}>
        <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ px: 1.5, py: 1, flexWrap: 'wrap', gap: 1 }}>
          <Box>
            <Typography sx={{ fontWeight: 700, fontSize: 13, color: 'var(--rt-text)' }}>
              {tr('Aging')}{' '}
              <Box component="span" sx={{ color: 'var(--rt-text-2)', fontWeight: 500 }}>· {num(rows.length, 0)}</Box>
            </Typography>
            <Typography sx={{ fontSize: 11, color: 'var(--rt-text-2)' }}>
              {tr('Click a partner to open their statement')}
            </Typography>
          </Box>
          <GridExportBar gridRef={gridRef} filename="aging" title="Aging"
            view={sideLabel} filters={filtersLabel}
            reportEndpoint="/api/accounting/aging" reportPeriod="custom"
            reportParams={filterParams} colDefs={colDefs} onResetColumns={colState.resetColumns} />
        </Stack>
        <Box className="ag-theme-alpine" sx={{ height: 540, ...GRID_SX }}>
          <AgGridReact localeText={gridLocaleText()} ref={gridRef} rowData={rows} columnDefs={trCols(colDefs as any[])}
            defaultColDef={defaultColDef} overlayNoRowsTemplate={noRowsOverlay()}
            pinnedBottomRowData={pinnedBottom}
            rowSelection="single"
            onRowClicked={e => { if (!e.node?.rowPinned) drill(e.data) }}
            onGridReady={colState.onGridReady} onColumnMoved={colState.onColumnChanged}
            onColumnResized={colState.onColumnChanged} onColumnVisible={colState.onColumnChanged}
            rowHeight={34} headerHeight={38} suppressCellFocus animateRows
            pagination paginationPageSize={100} />
        </Box>
      </Paper>
    </Box>
  )
}
