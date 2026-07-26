/**
 * Accounting → GL Exceptions
 * ==========================
 * Every SOURCE document that does NOT net to zero across all of its journals.
 *
 * This page is the counterpart to the balanced-document gate the statements
 * apply by default: whatever that gate keeps out of the Trial Balance and the
 * General Ledger is listed here in full. Money is never silently dropped, so
 * the page leads with a banner that states the count and the total net in the
 * negative token colour — or an explicit all-clear when there is nothing.
 *
 * There is deliberately no "Include unbalanced documents" toggle here: this
 * grid IS the unbalanced list.
 *
 * Colours come exclusively from the --rt-* design tokens and the MUI palette.
 */
import { useMemo, useRef, useState } from 'react'
import {
  Box, Typography, Chip, TextField, Autocomplete, Stack, Paper, useTheme,
} from '@mui/material'
import { AgGridReact } from 'ag-grid-react'
import type { ColDef } from 'ag-grid-community'
import 'ag-grid-community/styles/ag-grid.css'
import 'ag-grid-community/styles/ag-theme-alpine.css'
import { useQuery } from '@tanstack/react-query'
import axios from 'axios'
import { format, subDays, startOfMonth, startOfYear } from 'date-fns'
import GridExportBar from '../../components/GridExportBar'
import TitleLoader from '../../components/TitleLoader'
import FeatureUnavailable from '../../components/FeatureUnavailable'
import { DateBasisToggle, DEFAULT_DATE_BASIS, dateBasisLabel, useAccountingDefaults } from '../../components/AccountingFilters'
import type { DateBasis } from '../../components/AccountingFilters'
import { useFeature, FEATURE_ACCOUNTING } from '../../hooks/useFeatures'
import { useGridColumnState } from '../../hooks/useGridColumnState'
import { useGlDefaultWindow } from '../../hooks/useGlWindow'
import { moneyExact, num } from '../../utils/formatters'
import { tr, trf, trCols } from '../../i18n'
import { gridLocaleText } from '../../utils/gridLocale'
import { PURPLE_BRAND } from '../../theme'

const iso = (d: Date) => format(d, 'yyyy-MM-dd')
const today = iso(new Date())
const PRESETS: Record<string, [string, string]> = {
  '7D':  [iso(subDays(new Date(), 6)),  today],
  '30D': [iso(subDays(new Date(), 29)), today],
  'MTD': [iso(startOfMonth(new Date())), today],
  'YTD': [iso(startOfYear(new Date())),  today],
}

const fmtMoney = (v: any) => (v == null ? '' : moneyExact(v, 2))

const GRID_SX = {
  width: '100%',
  '& .ag-header': { bgcolor: 'var(--rt-grid-header-bg) !important', borderBottom: '1px solid var(--rt-border)' },
  '& .ag-header-cell-text': { fontWeight: 700, color: 'var(--rt-grid-header-fg)', fontSize: 12 },
  '& .ag-row-even': { bgcolor: 'var(--rt-surface)' },
  '& .ag-row-odd': { bgcolor: 'var(--rt-surface-2)' },
  '& .ag-row-selected': { bgcolor: 'var(--rt-grid-selected) !important' },
  '& .ag-paging-panel': { borderTop: '1px solid var(--rt-border)', color: 'var(--rt-text-2)' },
} as const

export default function Exceptions() {
  const theme = useTheme()
  const gridRef = useRef<AgGridReact>(null)
  const colState = useGridColumnState('accounting-exceptions')

  const [preset, setPreset]     = useState('MTD')
  const [dateFrom, setDateFrom] = useState(PRESETS['MTD'][0])
  const [dateTo,   setDateTo]   = useState(PRESETS['MTD'][1])
  const [stores,   setStores]   = useState<string[]>([])
  const [subs,     setSubs]     = useState<{ sid: string; name: string }[]>([])
  // FACT_GL_DOC carries both dates, so this report windows on the same basis
  // as the statements whose exclusions it explains.
  const [dateBasis, setDateBasis] = useState<DateBasis>(DEFAULT_DATE_BASIS)
  // Admin-configured default basis (Settings → Accounting) as initial state.
  // No include_unbalanced here — this report exists to LIST the unbalanced.
  useAccountingDefaults(setDateBasis)
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

  const filterParams = useMemo(() => ({
    date_from: dateFrom, date_to: dateTo,
    ...(stores.length ? { stores: stores.join(',') } : {}),
    ...(subs.length   ? { subsidiaries: subs.map(s => s.sid).join(',') } : {}),
    date_basis: dateBasis,
  }), [dateFrom, dateTo, stores, subs, dateBasis])

  const { data: rows = [], isFetching } = useQuery<any[]>({
    queryKey: ['gl-exceptions', filterParams],
    queryFn: () => axios.get('/api/accounting/exceptions', { params: filterParams }).then(r => r.data),
    placeholderData: p => p,
  })

  const totalNet = useMemo(() => rows.reduce((a, r) => a + +(r.net ?? 0), 0), [rows])

  const colDefs = useMemo<ColDef[]>(() => [
    // Both dates, with the ACTIVE basis leading — an unbalanced document is
    // chased by both "when did this happen" and "when did it land", and the
    // gap between the two is often the clue.
    ...(dateBasis === 'posting'
      ? [{ field: 'gl_post_date', headerName: 'Posting Date',     width: 130, pinned: 'left' as const },
         { field: 'post_date',    headerName: 'Transaction Date', width: 140 }]
      : [{ field: 'post_date',    headerName: 'Transaction Date', width: 140, pinned: 'left' as const },
         { field: 'gl_post_date', headerName: 'Posting Date',     width: 130 }]),
    { field: 'src_doc_no', headerName: 'Source Document No.', width: 180, pinned: 'left',
      cellStyle: { fontFamily: 'monospace', fontWeight: 700, color: PURPLE_BRAND[500] } },
    { field: 'store_name', headerName: 'Store Name', flex: 1, minWidth: 180,
      cellStyle: { color: 'var(--rt-text)' } },
    { field: 'journals', headerName: 'Journals', width: 110, type: 'numericColumn',
      valueFormatter: p => num(p.value, 0), cellStyle: { color: 'var(--rt-text)' } },
    { field: 'lines', headerName: 'GL Lines', width: 110, type: 'numericColumn',
      valueFormatter: p => num(p.value, 0), cellStyle: { color: 'var(--rt-text)' } },
    // The out-of-balance amount itself — always in the negative token colour,
    // because any non-zero value here is money missing from the statements.
    { field: 'net', headerName: 'Net (out of balance)', width: 170, type: 'numericColumn',
      valueFormatter: p => fmtMoney(p.value),
      cellStyle: { fontWeight: 800, color: 'var(--rt-neg-fg)', backgroundColor: 'var(--rt-neg-bg)' } },
  ], [dateBasis])

  const defaultColDef = useMemo(() => ({ sortable: true, filter: true, resizable: true,
    wrapHeaderText: true, autoHeaderHeight: true }), [])

  const filtersLabel = `${dateFrom} → ${dateTo} · ${stores.length ? `${stores.length} ${tr('store(s)')}` : tr('All stores')}`
    + `${subs.length ? ` · ${subs.map(s => s.name).join(', ')}` : ''}`
    + ` · ${dateBasisLabel(dateBasis)}`

  // Optional customisation: the accounting subsidiary (100). Absent → FACT_GL is
  // permanently empty, so "no exceptions" would be a false all-clear. Explain.
  const [glOff, glReason] = useFeature(FEATURE_ACCOUNTING)
  if (glOff) return (
    <Box sx={{ pt: 3, px: 3, pb: 3 }}>
      <Typography variant="h6" sx={{ fontWeight: 800, color: 'var(--rt-text)', letterSpacing: '-0.3px', mb: 1 }}>
        {tr('GL Exceptions')}
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
          {tr('GL Exceptions')}<TitleLoader />
        </Typography>
        <Typography sx={{ fontSize: 12, color: 'var(--rt-text-2)', mb: 1.5 }}>
          {tr('Source documents that do not balance across their journals')} · {dateFrom} — {dateTo}
        </Typography>

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

          {/* Date basis — window these exceptions on the same basis as the
              statements that excluded them, or the two lists disagree. */}
          <DateBasisToggle value={dateBasis} onChange={setDateBasis} />
        </Box>
      </Box>

      {/* ── Banner: the whole reason this page exists ── */}
      <Box sx={{ mt: 2, px: 2, py: 1.4, borderRadius: 2,
        bgcolor: rows.length ? 'var(--rt-neg-bg)' : 'var(--rt-pos-bg)',
        border: `1px solid ${rows.length ? 'var(--rt-neg-fg)' : 'var(--rt-pos-fg)'}` }}>
        {rows.length > 0 ? (<>
          <Typography sx={{ fontSize: 15, fontWeight: 800, color: 'var(--rt-neg-fg)' }}>
            {trf('{{n}} documents do not balance — total {{v}}',
                 { n: num(rows.length, 0), v: moneyExact(totalNet, 2) })}
          </Typography>
          <Typography sx={{ fontSize: 12, color: 'var(--rt-neg-fg)', mt: 0.4 }}>
            {tr('These documents are excluded from the Trial Balance and the General Ledger by default. Nothing is hidden — every one of them is listed below.')}
          </Typography>
        </>) : (<>
          <Typography sx={{ fontSize: 15, fontWeight: 800, color: 'var(--rt-pos-fg)' }}>
            {tr('All documents balance')}
          </Typography>
          <Typography sx={{ fontSize: 12, color: 'var(--rt-pos-fg)', mt: 0.4 }}>
            {isFetching ? tr('Checking…')
              : tr('No source document is out of balance in this window — nothing is being kept off the statements.')}
          </Typography>
        </>)}
      </Box>

      {/* ── Grid ── */}
      <Paper elevation={0} sx={{ borderRadius: 2, border: '1px solid var(--rt-border)', overflow: 'hidden', mt: 2, mb: 1 }}>
        <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ px: 1.5, py: 1, flexWrap: 'wrap', gap: 1 }}>
          <Typography sx={{ fontWeight: 700, fontSize: 13, color: 'var(--rt-text)' }}>
            {tr('Unbalanced Documents')}{' '}
            <Box component="span" sx={{ color: 'var(--rt-text-2)', fontWeight: 500 }}>· {num(rows.length, 0)}</Box>
          </Typography>
          <GridExportBar gridRef={gridRef} filename="gl_exceptions" title="GL Exceptions"
            view={tr('Unbalanced Documents')} filters={filtersLabel}
            reportEndpoint="/api/accounting/exceptions" reportPeriod={preset || 'custom'}
            reportParams={filterParams} colDefs={colDefs} onResetColumns={colState.resetColumns} />
        </Stack>
        <Box className="ag-theme-alpine" sx={{ height: 520, ...GRID_SX }}>
          <AgGridReact localeText={gridLocaleText()} ref={gridRef} rowData={rows} columnDefs={trCols(colDefs as any[])}
            defaultColDef={defaultColDef}
            overlayNoRowsTemplate={`<span style="color:var(--rt-pos-fg);font-size:13px;font-weight:600">${tr('All documents balance')}</span>`}
            onGridReady={colState.onGridReady} onColumnMoved={colState.onColumnChanged}
            onColumnResized={colState.onColumnChanged} onColumnVisible={colState.onColumnChanged}
            rowHeight={34} headerHeight={38} suppressCellFocus animateRows
            pagination paginationPageSize={100} />
        </Box>
      </Paper>
    </Box>
  )
}
