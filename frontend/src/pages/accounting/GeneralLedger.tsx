/**
 * Accounting → General Ledger — per-account ledger with a running balance.
 *
 * The endpoint returns a BARE LIST (no {total, rows}) already sorted by account
 * then date, so the running balance is only meaningful in the order it arrives.
 *
 * SYNTHETIC ROWS: the first row of every account is an 'Opening Balance' row
 * the backend manufactures (dated date_from, carrying the pre-window
 * SUM(AMOUNT)) so the running balance starts in the right place. It is NOT a
 * real document, so it is rendered muted + italic — never as if it were one.
 *
 * Trial Balance drills through to this page for a single account, so `account`
 * and the date window are read from the URL on mount (same pattern as
 * Sales → Journals).
 *
 * Colours come from the --rt-* design tokens only. No page-local colour
 * constants — a hard-coded ink hex renders invisible in dark mode.
 */
import { useMemo, useRef, useState, useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  Box, Typography, Chip, TextField, Autocomplete, Stack, Paper,
  Switch, FormControlLabel,
} from '@mui/material'
import SavedViewsBar from '../../components/SavedViewsBar'
import DataSlicer, { splitSlicer } from '../../components/DataSlicer'
import {
  DateBasisToggle, JournalCategoryFilter, DEFAULT_DATE_BASIS,
  dateBasisLabel, journalCategoryLabel, restoreJournalCategory,
  useAccountingDefaults,
} from '../../components/AccountingFilters'
import type { DateBasis, JournalCategory } from '../../components/AccountingFilters'
import { AgGridReact } from 'ag-grid-react'
import type { ColDef } from 'ag-grid-community'
import 'ag-grid-community/styles/ag-grid.css'
import 'ag-grid-community/styles/ag-theme-alpine.css'
import { useQuery } from '@tanstack/react-query'
import axios from 'axios'
import { format, subDays, startOfMonth, startOfYear } from 'date-fns'
import { useGridColumnState } from '../../hooks/useGridColumnState'
import { useRetryIfEmpty } from '../../hooks/useRetryIfEmpty'
import GridExportBar from '../../components/GridExportBar'
import TitleLoader from '../../components/TitleLoader'
import FeatureUnavailable from '../../components/FeatureUnavailable'
import { useFeature, FEATURE_ACCOUNTING } from '../../hooks/useFeatures'
import { useGlDefaultWindow } from '../../hooks/useGlWindow'
import { noRowsOverlay } from '../../utils/gridOverlay'
import { gridLocaleText } from '../../utils/gridLocale'
import { moneyExact, num } from '../../utils/formatters'
import { tr, trf, trCols } from '../../i18n'

const iso = (d: Date) => format(d, 'yyyy-MM-dd')
const today = iso(new Date())
const PRESETS: Record<string, [string, string]> = {
  '7D':  [iso(subDays(new Date(), 6)),  today],
  '30D': [iso(subDays(new Date(), 29)), today],
  'MTD': [iso(startOfMonth(new Date())), today],
  'YTD': [iso(startOfYear(new Date())),  today],
}

/** The doc type the backend stamps on its manufactured opening rows. */
const OPENING = 'Opening Balance'
const isOpening = (r: any) => r?.src_doc_type === OPENING

const fmtMoney = (v: any) => (v == null ? '' : moneyExact(v))
const moneySx = (p: any) =>
  (+(p.value ?? 0) < 0 ? { color: 'var(--rt-neg-fg)', fontWeight: 600 } : undefined)

const GRID_SX = {
  width: '100%',
  '& .ag-header': { bgcolor: 'var(--rt-grid-header-bg) !important', borderBottom: '1px solid var(--rt-border)' },
  '& .ag-header-cell-text': { fontWeight: 700, color: 'var(--rt-grid-header-fg)', fontSize: 12 },
  '& .ag-row-even': { bgcolor: 'var(--rt-surface)' },
  '& .ag-row-odd': { bgcolor: 'var(--rt-surface-2)' },
  '& .ag-row-selected': { bgcolor: 'var(--rt-grid-selected) !important' },
  '& .ag-paging-panel': { borderTop: '1px solid var(--rt-border)', color: 'var(--rt-text-2)' },
} as const

export default function GeneralLedger() {
  const [preset,   setPreset]   = useState('30D')
  const [dateFrom, setDateFrom] = useState(PRESETS['30D'][0])
  const [dateTo,   setDateTo]   = useState(PRESETS['30D'][1])
  const [stores,   setStores]   = useState<string[]>([])
  const [subs,     setSubs]     = useState<{ sid: string; name: string }[]>([])
  // Account is the shared <DataSlicer> — a chart-of-accounts type-ahead. It
  // still sends the COMMA-separated ACCOUNT_CODE list the router expects.
  const [accSel,   setAccSel]   = useState<any[]>([])
  const accToken = (o: any) => (typeof o === 'string' ? o : String(o?.account_code ?? ''))
  const accountCsv = splitSlicer(accSel, undefined, accToken).tokens.join(',')
  // Balanced-document gate, OFF by default (see the router's domain rules).
  const [includeUnbalanced, setIncludeUnbalanced] = useState(false)
  // Which of the two GL dates the window (and the opening-balance cut) uses.
  const [dateBasis, setDateBasis] = useState<DateBasis>(DEFAULT_DATE_BASIS)
  const [journalCat, setJournalCat] = useState<JournalCategory>('')
  // Admin-configured report defaults (Settings → Accounting) as initial
  // state; the drill-through URL params below still win.
  useAccountingDefaults(setDateBasis, setIncludeUnbalanced)
  // True once the window is authoritative (drill-through, preset chip, manual
  // edit) — see useGlDefaultWindow.
  const winPinned = useRef(false)

  // ── Drill-through: Trial Balance links here for ONE account, carrying its
  //    own window. Read on mount, exactly like Sales → Journals: anything read
  //    but not stored under the name filterParams sends is silently dropped.
  const [sp] = useSearchParams()
  useEffect(() => {
    const acc = sp.get('account'); if (acc) setAccSel(acc.split(',').filter(Boolean))
    const st  = sp.get('stores');  if (st)  setStores(st.split(',').filter(Boolean))
    const iu  = sp.get('include_unbalanced')
    if (iu === 'true' || iu === '1') setIncludeUnbalanced(true)
    const db  = sp.get('date_basis')
    if (db === 'transaction' || db === 'posting') setDateBasis(db)
    // URL values use the NEW taxonomy ('entry' = manual journals): every link
    // generator ships with this build, so no legacy mapping applies here.
    const jc  = sp.get('journal_category')
    if (jc === 'payment' || jc === 'transaction' || jc === 'entry') setJournalCat(jc)
    const df = sp.get('date_from'), dt = sp.get('date_to')
    if (df && dt) { winPinned.current = true; setPreset(''); setDateFrom(df); setDateTo(dt) }
  }, [])   // eslint-disable-line react-hooks/exhaustive-deps

  // Open on the GL's OWN loaded span instead of a rolling 30 days — a ledger is
  // loaded per accounting period, so "last 30 days" is routinely empty.
  useGlDefaultWindow(winPinned, (f, t) => { setPreset(''); setDateFrom(f); setDateTo(t) })

  const gridRef  = useRef<AgGridReact>(null)
  const colState = useGridColumnState('accounting-general-ledger')

  const allStores = useQuery({
    queryKey: ['stores-list'],
    queryFn: () => axios.get('/api/sales/stores-list').then(r => r.data as string[]),
    staleTime: 3_600_000,
  }).data ?? []

  const allSubs = useQuery({
    queryKey: ['subsidiaries-list'],
    queryFn: () => axios.get('/api/sales/subsidiaries-list')
      .then(r => r.data as { sid: string; name: string }[]),
    staleTime: Infinity, retry: false,
  }).data ?? []

  const applyPreset = (p: string) => { winPinned.current = true; setPreset(p); setDateFrom(PRESETS[p][0]); setDateTo(PRESETS[p][1]) }

  const filterParams = useMemo(() => ({
    date_from: dateFrom, date_to: dateTo,
    ...(stores.length ? { stores: stores.join(',') } : {}),
    ...(subs.length   ? { subsidiaries: subs.map(s => s.sid).join(',') } : {}),
    ...(accountCsv    ? { account: accountCsv } : {}),
    date_basis: dateBasis,
    ...(journalCat    ? { journal_category: journalCat } : {}),
    ...(includeUnbalanced ? { include_unbalanced: true } : {}),
  }), [dateFrom, dateTo, stores, subs, accountCsv, dateBasis, journalCat, includeUnbalanced])

  // Bare list — the endpoint returns rows directly, NOT {total, rows}.
  const { data: rows = [], isFetching, refetch } = useQuery<any[]>({
    queryKey: ['acc-general-ledger', filterParams],
    queryFn: () => axios.get('/api/accounting/general-ledger', { params: filterParams }).then(r => r.data),
    placeholderData: p => p,
  })
  useRetryIfEmpty(rows.length === 0, isFetching, refetch)

  const colDefs = useMemo<ColDef[]>(() => [
    { field: 'account_code', headerName: 'Account Code', width: 140, pinned: 'left',
      cellStyle: { fontFamily: 'monospace', fontWeight: 700, color: 'var(--rt-text)' } },
    { field: 'account_name', headerName: 'Account Name', width: 220, pinned: 'left' },
    // ONE date column here, unlike the Journal grid: the ledger is ordered by
    // the active basis and its running balance accumulates in that order, so a
    // second date column would invite reading the balance against a sequence
    // it was not computed in. The header states which basis is in force.
    { field: 'post_date', width: 130,
      headerName: dateBasis === 'posting' ? 'Posting Date' : 'Transaction Date' },
    { field: 'src_doc_no', headerName: 'Source Doc No.', width: 140,
      cellStyle: { fontFamily: 'monospace', color: 'var(--rt-text-2)' } },
    { field: 'src_doc_type', headerName: 'Doc Type', width: 150 },
    { field: 'journal_category', headerName: 'Journal Category', width: 130 },
    { field: 'bp_name', headerName: 'Business Partner', width: 180 },
    { field: 'bp_code', headerName: 'Partner Code', width: 130,
      cellStyle: { fontFamily: 'monospace', color: 'var(--rt-text-2)' } },
    { field: 'bp_id', headerName: 'Business Partner ID', width: 170, hide: true,
      cellStyle: { fontFamily: 'monospace', color: 'var(--rt-text-2)' } },
    { field: 'store_name', headerName: 'Store', flex: 1, minWidth: 150 },
    { field: 'debit', headerName: 'Debit', width: 130, type: 'numericColumn',
      valueFormatter: p => fmtMoney(p.value), cellStyle: moneySx },
    { field: 'credit', headerName: 'Credit', width: 130, type: 'numericColumn',
      valueFormatter: p => fmtMoney(p.value), cellStyle: moneySx },
    { field: 'running_balance', headerName: 'Running Balance', width: 150, type: 'numericColumn',
      valueFormatter: p => fmtMoney(p.value),
      cellStyle: p => ({ fontWeight: 700, ...(moneySx(p) ?? {}) }) },
  ], [dateBasis])

  const defaultColDef = useMemo(() => ({ sortable: true, filter: true, resizable: true,
    wrapHeaderText: true, autoHeaderHeight: true }), [])

  // Synthetic opening rows are muted + italic: they are a computed carry-in,
  // not a document anyone can look up in Retail Pro.
  const getRowStyle = (p: any) => (isOpening(p.data)
    ? { fontStyle: 'italic', color: 'var(--rt-text-2)', backgroundColor: 'var(--rt-surface-3)' }
    : undefined)

  const openingCount = useMemo(() => rows.filter(isOpening).length, [rows])

  const filtersSummary = `${dateFrom} → ${dateTo} · ${dateBasisLabel(dateBasis)} · ${
    journalCategoryLabel(journalCat)} · ${stores.length
    ? trf('{{n}} store(s)', { n: stores.length }) : tr('All stores')}${
    subs.length ? ` · ${trf('{{n}} subsidiary(ies)', { n: subs.length })}` : ''}${
    accountCsv ? ` · ${tr('Account')} ${accountCsv}` : ''} · ${
    includeUnbalanced ? tr('Including unbalanced documents') : tr('Balanced documents only')}`

  // journalCatV marks the THREE-WAY category taxonomy (2026-07-22): a view
  // without it predates the split, where 'entry' meant every non-payment
  // journal — restoreJournalCategory maps that old value to 'transaction'.
  const currentView = { preset, dateFrom, dateTo, stores, subs, accSel,
                        includeUnbalanced, dateBasis, journalCat, journalCatV: 2 }
  const applyView = (s: any) => {
    if (!s) return
    setPreset(s.preset ?? ''); setDateFrom(s.dateFrom ?? dateFrom); setDateTo(s.dateTo ?? dateTo)
    setStores(s.stores ?? []); setSubs(s.subs ?? [])
    // Views saved before the slicer became a type-ahead carry `account` as a
    // comma-separated string — restore those as free-text chips.
    setAccSel(s.accSel ?? (s.account ? String(s.account).split(',').filter(Boolean) : []))
    setIncludeUnbalanced(!!s.includeUnbalanced)
    // Absent on views saved before these existed → documented defaults.
    setDateBasis(s.dateBasis === 'posting' ? 'posting' : DEFAULT_DATE_BASIS)
    setJournalCat(restoreJournalCategory(s.journalCat, s.journalCatV))
  }

  // Optional customisation: the accounting subsidiary (100). Absent → FACT_GL is
  // permanently empty, which would read as "nothing was posted". Explain instead.
  const [glOff, glReason] = useFeature(FEATURE_ACCOUNTING)
  if (glOff) return (
    <Box sx={{ pt: 3, px: 3, pb: 3 }}>
      <Typography variant="h6" sx={{ fontWeight: 800, color: 'var(--rt-text)', letterSpacing: '-0.3px', mb: 1 }}>
        {tr('General Ledger')}
      </Typography>
      <FeatureUnavailable
        title="Accounting is not available on this server"
        reason={glReason || 'The accounting subsidiary (100) is not present on this server.'} />
    </Box>
  )

  return (
    <Box sx={{ pt: 0, px: 3, pb: 3, minHeight: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* ── Header + slicers (standard sticky pattern) ── */}
      <Box sx={{ position: 'sticky', top: 0, zIndex: 10, bgcolor: 'var(--rt-surface)', mx: -3, px: 3, pt: 3, pb: 2,
        borderBottom: '1px solid var(--rt-border)' }}>
        <Typography variant="h6" sx={{ fontWeight: 800, color: 'var(--rt-text)', letterSpacing: '-0.3px', mb: 0.3 }}>
          {tr('General Ledger')}<TitleLoader />
        </Typography>
        <Typography sx={{ fontSize: 12, color: 'var(--rt-text-2)', mb: 1.5 }}>{dateFrom} — {dateTo}</Typography>

        <Box sx={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 1 }}>
          <Stack direction="row" spacing={0.5}>
            {Object.keys(PRESETS).map(p => (
              <Chip key={p} label={tr(p)} size="small" onClick={() => applyPreset(p)}
                variant={preset === p ? 'filled' : 'outlined'}
                color={preset === p ? 'primary' : 'default'}
                sx={{ fontWeight: 600, fontSize: 11,
                  ...(preset === p ? {} : { borderColor: 'var(--rt-border)', color: 'var(--rt-text-2)' }) }} />
            ))}
          </Stack>
          <TextField label={tr('From')} type="date" size="small" sx={{ width: 150 }} InputLabelProps={{ shrink: true }}
            value={dateFrom} onChange={e => { winPinned.current = true; setPreset(''); setDateFrom(e.target.value) }} />
          <TextField label={tr('To')} type="date" size="small" sx={{ width: 150 }} InputLabelProps={{ shrink: true }}
            value={dateTo} onChange={e => { winPinned.current = true; setPreset(''); setDateTo(e.target.value) }} />
          <Autocomplete multiple size="small" options={allStores} value={stores}
            onChange={(_, v) => setStores(v)} sx={{ minWidth: 200, maxWidth: 320 }}
            renderInput={p => <TextField {...p} placeholder={tr('Store')} />} limitTags={1} />
          <Autocomplete multiple size="small" options={allSubs} value={subs}
            onChange={(_, v) => setSubs(v as any[])} sx={{ minWidth: 200, maxWidth: 320 }}
            getOptionLabel={(o: any) => o?.name ?? String(o?.sid ?? '')}
            isOptionEqualToValue={(a: any, b: any) => a?.sid === b?.sid}
            renderInput={p => <TextField {...p} placeholder={tr('Subsidiary')} />} limitTags={1} />
          <Box sx={{ flex: 1 }} />
          <SavedViewsBar pageKey="accounting-general-ledger" current={currentView} onApply={applyView} />
        </Box>

        <Box sx={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 1, mt: 1 }}>
          {/* Account — chart-of-accounts type-ahead (code | name) */}
          <DataSlicer sx={{ minWidth: 240, maxWidth: 360 }} value={accSel} onChange={setAccSel}
            searchEndpoint="/api/accounting/search/accounts"
            getToken={accToken} placeholder="Account (code / name)"
            renderLabel={(o: any) => (typeof o === 'string' ? { code: o }
              : { code: String(o.account_code ?? ''), rest: [o.name_en, o.name_ar].filter(Boolean).join(' | ') })} />

          {/* Date basis + journal category — see AccountingFilters. On this
              page the basis also moves the OPENING-BALANCE cut, so it changes
              the running balance, not just the visible rows. */}
          <DateBasisToggle value={dateBasis} onChange={setDateBasis} />
          <JournalCategoryFilter value={journalCat} onChange={setJournalCat} />

          {/* The balanced-document gate — deliberately in the open, never in a
              menu: the ledger hides unbalanced documents by default and the
              user must be able to SEE that, and open the gate in one click. */}
          <FormControlLabel
            control={<Switch size="small" checked={includeUnbalanced}
              onChange={e => setIncludeUnbalanced(e.target.checked)} />}
            label={<Typography sx={{ fontSize: 12, fontWeight: 600, color: 'var(--rt-text)' }}>
              {tr('Include unbalanced documents')}</Typography>} />
          {!includeUnbalanced && (
            <Chip size="small" label={tr('Balanced documents only')}
              sx={{ fontWeight: 600, fontSize: 11, bgcolor: 'var(--rt-warn-bg)', color: 'var(--rt-warn-fg)' }} />
          )}
          {openingCount > 0 && (
            <Chip size="small" label={trf('{{n}} synthetic opening row(s)', { n: openingCount })}
              sx={{ fontWeight: 600, fontSize: 11, fontStyle: 'italic',
                bgcolor: 'var(--rt-surface-3)', color: 'var(--rt-text-2)' }} />
          )}
        </Box>
      </Box>

      {/* ── Ledger grid ── */}
      <Paper elevation={0} sx={{ borderRadius: 2, border: '1px solid var(--rt-border)', overflow: 'hidden', mt: 2, mb: 1 }}>
        <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ px: 1.5, py: 1, flexWrap: 'wrap', gap: 1 }}>
          <Typography sx={{ fontWeight: 700, fontSize: 13, color: 'var(--rt-text)' }}>
            {tr('Ledger Entries')} <span style={{ color: 'var(--rt-text-2)', fontWeight: 500 }}>· {num(rows.length, 0)}</span>
          </Typography>
          <GridExportBar gridRef={gridRef} filename="general_ledger" title="General Ledger"
            view={tr('Ledger Entries')} filters={filtersSummary}
            reportEndpoint="/api/accounting/general-ledger" reportPeriod={preset || 'custom'}
            reportParams={filterParams} colDefs={colDefs} onResetColumns={colState.resetColumns} />
        </Stack>
        <Box className="ag-theme-alpine" sx={{ height: 560, ...GRID_SX }}>
          <AgGridReact localeText={gridLocaleText()} ref={gridRef} rowData={rows} columnDefs={trCols(colDefs as any[])}
            defaultColDef={defaultColDef} overlayNoRowsTemplate={noRowsOverlay()}
            getRowStyle={getRowStyle}
            onGridReady={colState.onGridReady} onColumnMoved={colState.onColumnChanged}
            onColumnResized={colState.onColumnChanged} onColumnVisible={colState.onColumnChanged}
            rowHeight={32} headerHeight={38} suppressCellFocus animateRows
            pagination paginationPageSize={100} />
        </Box>
      </Paper>
    </Box>
  )
}
