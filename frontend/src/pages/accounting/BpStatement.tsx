/**
 * Accounting → BP Statement (كشف حساب) — one business partner's ledger.
 *
 * TWO VIEWS (2026-07-27, the financial-correctness fix):
 *   · Statement (default) — only the configured AR/AP CONTROL-account lines
 *     (the same lists Aging uses). Charges are debits, payments credits, and
 *     the running balance IS what the partner owes; the closing reconciles
 *     with their Aging balance by construction.
 *   · All lines (audit) — every GL line carrying the BP id, whatever the
 *     account. Every balanced document nets to ZERO across its own lines, so
 *     this view always collapses to 0.00 per complete document — it traces
 *     postings; it is NOT a balance and must never read as one.
 * The first row is the synthetic 'Opening Balance' the backend manufactures
 * (dated date_from, carrying the pre-window SUM(AMOUNT) under the SAME view
 * filter), rendered muted + italic exactly like the General Ledger's opening
 * rows — computed, not a document.
 *
 * The partner picker is the shared <DataSlicer> over /api/accounting/search/bp
 * — SINGLE select, no free text: the statement is meaningless without exactly
 * one partner, and only a PICKED option carries the bp_id SID (the one unique
 * key — CUST_ID is nullable and non-unique). SIDs stay STRINGS (BIGINT
 * precision). Until a partner is picked the page shows a prompt, not an
 * empty grid pretending to be a report.
 *
 * Aging drills here with bp_id + bp_name + window in the URL (read on mount,
 * same pattern as Trial Balance → General Ledger).
 *
 * Colours come from the --rt-* design tokens only — no page-local hex.
 */
import { useMemo, useRef, useState, useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  Box, Typography, Chip, TextField, Autocomplete, Stack, Paper,
  Switch, FormControlLabel, ToggleButton, ToggleButtonGroup, useTheme,
} from '@mui/material'
import SavedViewsBar from '../../components/SavedViewsBar'
import DataSlicer from '../../components/DataSlicer'
import { DateBasisToggle, DEFAULT_DATE_BASIS, dateBasisLabel, useAccountingDefaults } from '../../components/AccountingFilters'
import type { DateBasis } from '../../components/AccountingFilters'
import { AgGridReact } from 'ag-grid-react'
import type { ColDef } from 'ag-grid-community'
import 'ag-grid-community/styles/ag-grid.css'
import 'ag-grid-community/styles/ag-theme-alpine.css'
import { useQuery } from '@tanstack/react-query'
import axios from 'axios'
import { format, subDays, startOfMonth, startOfYear } from 'date-fns'
import { useGridColumnState } from '../../hooks/useGridColumnState'
import GridExportBar from '../../components/GridExportBar'
import KpiCard from '../../components/KpiCard'
import TitleLoader from '../../components/TitleLoader'
import FeatureUnavailable from '../../components/FeatureUnavailable'
import { useFeature, FEATURE_ACCOUNTING } from '../../hooks/useFeatures'
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

/** The doc type the backend stamps on its manufactured opening row. */
const OPENING = 'Opening Balance'
const isOpening = (r: any) => r?.src_doc_type === OPENING

const fmtMoney = (v: any) => (v == null ? '' : moneyExact(v))
const moneySx = (p: any) =>
  (+(p.value ?? 0) < 0 ? { color: 'var(--rt-neg-fg)', fontWeight: 600 } : undefined)

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

const GRID_SX = {
  width: '100%',
  '& .ag-header': { bgcolor: 'var(--rt-grid-header-bg) !important', borderBottom: '1px solid var(--rt-border)' },
  '& .ag-header-cell-text': { fontWeight: 700, color: 'var(--rt-grid-header-fg)', fontSize: 12 },
  '& .ag-row-even': { bgcolor: 'var(--rt-surface)' },
  '& .ag-row-odd': { bgcolor: 'var(--rt-surface-2)' },
  '& .ag-row-selected': { bgcolor: 'var(--rt-grid-selected) !important' },
  '& .ag-paging-panel': { borderTop: '1px solid var(--rt-border)', color: 'var(--rt-text-2)' },
} as const

export default function BpStatement() {
  const theme = useTheme()
  const [preset,   setPreset]   = useState('30D')
  const [dateFrom, setDateFrom] = useState(PRESETS['30D'][0])
  const [dateTo,   setDateTo]   = useState(PRESETS['30D'][1])
  const [stores,   setStores]   = useState<string[]>([])
  const [subs,     setSubs]     = useState<{ sid: string; name: string }[]>([])
  // ONE partner, PICKED from the dropdown — value holds at most one option
  // object ({bp_id, bp_name, bp_code, bp_kind} from /search/bp, or a stub
  // carrying only bp_id when a drill-through arrives before the lookup).
  const [bpSel,    setBpSel]    = useState<any[]>([])
  const [includeUnbalanced, setIncludeUnbalanced] = useState(false)
  const [dateBasis, setDateBasis] = useState<DateBasis>(DEFAULT_DATE_BASIS)
  // 'control' (default) = the real كشف حساب: control-account lines only, the
  // running balance is what the partner owes. 'all' = audit view: every GL
  // line with their BP id — balanced documents net to zero, NOT a balance.
  const [view, setView] = useState<'control' | 'all'>('control')
  // Admin-configured report defaults (Settings → Accounting) as initial
  // state; the drill-through URL params below still win.
  useAccountingDefaults(setDateBasis, setIncludeUnbalanced)
  const winPinned = useRef(false)

  // The SID the requests carry — a STRING, never coerced to number.
  const bpId = String(bpSel[0]?.bp_id ?? '')
  const bpLabel = (o: any) =>
    String(o?.bp_name || '').trim() || String(o?.bp_code || '').trim() || String(o?.bp_id ?? '')

  // ── Drill-through: Aging (or a saved link) arrives with bp_id + window.
  const [sp] = useSearchParams()
  useEffect(() => {
    const id = sp.get('bp_id')
    if (id) setBpSel([{ bp_id: id, bp_name: sp.get('bp_name') || '', bp_code: '', bp_kind: '' }])
    const st = sp.get('stores'); if (st) setStores(st.split(',').filter(Boolean))
    const iu = sp.get('include_unbalanced')
    if (iu === 'true' || iu === '1') setIncludeUnbalanced(true)
    const db = sp.get('date_basis')
    if (db === 'transaction' || db === 'posting') setDateBasis(db)
    const df = sp.get('date_from'), dt = sp.get('date_to')
    if (df && dt) { winPinned.current = true; setPreset(''); setDateFrom(df); setDateTo(dt) }
  }, [])   // eslint-disable-line react-hooks/exhaustive-deps

  // Open on the GL's OWN loaded span — a ledger is loaded per accounting
  // period, so a rolling 30 days is routinely empty on a healthy warehouse.
  useGlDefaultWindow(winPinned, (f, t) => { setPreset(''); setDateFrom(f); setDateTo(t) })

  const gridRef  = useRef<AgGridReact>(null)
  const colState = useGridColumnState('accounting-bp-statement')

  const allStores = useQuery({
    queryKey: ['stores-list'],
    queryFn: () => axios.get('/api/sales/stores-list').then(r => r.data as string[]),
    staleTime: 3_600_000,
  }).data ?? []

  const allSubs = useQuery({
    queryKey: ['subsidiaries-list'],
    queryFn: () => axios.get('/api/sales/subsidiaries-list')
      .then(r => r.data as { sid: string; name: string }[]),
    staleTime: 3_600_000,
  }).data ?? []

  const applyPreset = (p: string) => { winPinned.current = true; setPreset(p); setDateFrom(PRESETS[p][0]); setDateTo(PRESETS[p][1]) }

  const filterParams = useMemo(() => ({
    bp_id: bpId,
    date_from: dateFrom, date_to: dateTo,
    ...(stores.length ? { stores: stores.join(',') } : {}),
    ...(subs.length   ? { subsidiaries: subs.map(s => s.sid).join(',') } : {}),
    date_basis: dateBasis,
    view,
    ...(includeUnbalanced ? { include_unbalanced: true } : {}),
  }), [bpId, dateFrom, dateTo, stores, subs, dateBasis, view, includeUnbalanced])

  // The EFFECTIVE control-account lists (Settings → Accounting) — shown in
  // the method chip so the reader knows exactly what the balance measures.
  const { data: accStatus } = useQuery<any>({
    queryKey: ['acc-status'],
    queryFn: () => axios.get('/api/accounting/status').then(r => r.data),
    staleTime: 60_000,
    retry: false,
  })
  const controlAccounts: string[] = [...new Set([
    ...((accStatus?.receivable_accounts ?? []) as string[]),
    ...((accStatus?.payable_accounts ?? []) as string[]),
  ])]

  // Bare list — rows directly, NOT {total, rows}. Fetched only once a partner
  // is picked: a statement without a partner is not a report.
  const { data: rows = [] } = useQuery<any[]>({
    queryKey: ['acc-bp-statement', filterParams],
    queryFn: () => axios.get('/api/accounting/bp-statement', { params: filterParams }).then(r => r.data),
    enabled: !!bpId,
    placeholderData: p => p,
  })

  // ── KPI figures, all derived from the rows the grid shows (no second
  //    request, so the cards can never disagree with the grid).
  const kpi = useMemo(() => {
    const opening = rows.find(isOpening)
    const debits  = rows.reduce((a, r) => a + +(r.debit  ?? 0), 0)
    const credits = rows.reduce((a, r) => a + +(r.credit ?? 0), 0)
    const closing = rows.length ? +(rows[rows.length - 1].running_balance ?? 0) : 0
    return { opening: +(opening?.amount ?? 0), debits, credits, closing }
  }, [rows])

  const colDefs = useMemo<ColDef[]>(() => [
    // ONE date column, like the General Ledger: the running balance
    // accumulates in the active basis order, so a second date column would
    // invite reading the balance against a sequence it was not computed in.
    { field: 'post_date', width: 130, pinned: 'left',
      headerName: dateBasis === 'posting' ? 'Posting Date' : 'Transaction Date' },
    { field: 'src_doc_no', headerName: 'Source Doc No.', width: 140,
      cellStyle: { fontFamily: 'monospace', color: 'var(--rt-text-2)' } },
    { field: 'src_doc_type', headerName: 'Doc Type', width: 150 },
    { field: 'journal_category', headerName: 'Journal Category', width: 130 },
    { field: 'account_code', headerName: 'Account Code', width: 130,
      cellStyle: { fontFamily: 'monospace', fontWeight: 700, color: 'var(--rt-text)' } },
    { field: 'account_name', headerName: 'Account Name', flex: 1, minWidth: 180 },
    { field: 'debit', headerName: 'Debit', width: 130, type: 'numericColumn',
      valueFormatter: p => fmtMoney(p.value), cellStyle: moneySx },
    { field: 'credit', headerName: 'Credit', width: 130, type: 'numericColumn',
      valueFormatter: p => fmtMoney(p.value), cellStyle: moneySx },
    { field: 'amount', headerName: 'Amount', width: 130, type: 'numericColumn',
      valueFormatter: p => fmtMoney(p.value), cellStyle: moneySx },
    { field: 'running_balance', headerName: 'Running Balance', width: 150, type: 'numericColumn',
      valueFormatter: p => fmtMoney(p.value),
      cellStyle: p => ({ fontWeight: 700, ...(moneySx(p) ?? {}) }) },
  ], [dateBasis])

  const defaultColDef = useMemo(() => ({ sortable: true, filter: true, resizable: true,
    wrapHeaderText: true, autoHeaderHeight: true }), [])

  // The synthetic opening row is a computed carry-in, not a document.
  const getRowStyle = (p: any) => (isOpening(p.data)
    ? { fontStyle: 'italic', color: 'var(--rt-text-2)', backgroundColor: 'var(--rt-surface-3)' }
    : undefined)

  const bpName = bpSel[0] ? bpLabel(bpSel[0]) : ''
  const filtersSummary = `${bpName ? `${tr('Business Partner')}: ${bpName} · ` : ''}${dateFrom} → ${dateTo}`
    + ` · ${dateBasisLabel(dateBasis)}`
    + ` · ${stores.length ? `${stores.length} ${tr('store(s)')}` : tr('All stores')}`
    + `${subs.length ? ` · ${subs.map(s => s.name).join(', ')}` : ''}`
    + ` · ${view === 'control' ? tr('Statement') : tr('All lines (audit)')}`
    + ` · ${includeUnbalanced ? tr('Including unbalanced documents') : tr('Balanced documents only')}`

  const currentView = { preset, dateFrom, dateTo, stores, subs, bpSel,
                        includeUnbalanced, dateBasis, view }
  const applyView = (s: any) => {
    if (!s) return
    setPreset(s.preset ?? ''); setDateFrom(s.dateFrom ?? dateFrom); setDateTo(s.dateTo ?? dateTo)
    setStores(s.stores ?? []); setSubs(s.subs ?? [])
    setBpSel(Array.isArray(s.bpSel) ? s.bpSel.filter((o: any) => o && typeof o !== 'string') : [])
    setIncludeUnbalanced(!!s.includeUnbalanced)
    setDateBasis(s.dateBasis === 'posting' ? 'posting' : DEFAULT_DATE_BASIS)
    setView(s.view === 'all' ? 'all' : 'control')
    winPinned.current = true
  }

  const [glOff, glReason] = useFeature(FEATURE_ACCOUNTING)
  if (glOff) return (
    <Box sx={{ pt: 3, px: 3, pb: 3 }}>
      <Typography variant="h6" sx={{ fontWeight: 800, color: 'var(--rt-text)', letterSpacing: '-0.3px', mb: 1 }}>
        {tr('BP Statement')}
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
          {tr('BP Statement')}<TitleLoader />
        </Typography>
        <Typography sx={{ fontSize: 12, color: 'var(--rt-text-2)', mb: 1.5 }}>
          {bpName ? `${bpName} · ` : ''}{dateFrom} — {dateTo}
        </Typography>

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
          <SavedViewsBar pageKey="accounting-bp-statement" current={currentView} onApply={applyView} />
        </Box>

        <Box sx={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 1, mt: 1 }}>
          {/* Partner — SINGLE select, PICKED options only (no free text): the
              statement needs exactly one bp_id, and only a dropdown option
              carries one. minChars=0 so it opens as a populated dropdown of
              the partners actually present in FACT_GL. */}
          <DataSlicer sx={{ minWidth: 280, maxWidth: 420 }} value={bpSel} onChange={setBpSel}
            searchEndpoint="/api/accounting/search/bp"
            multiple={false} freeSolo={false} minChars={0}
            getToken={(o: any) => (typeof o === 'string' ? o : bpLabel(o))}
            getId={(o: any) => String(o?.bp_id ?? '')}
            placeholder="Business Partner (name / id)"
            renderLabel={(o: any) => (typeof o === 'string' ? { code: o }
              : { code: bpLabel(o),
                  rest: [o.bp_code, o.bp_kind ? tr(String(o.bp_kind)) : '']
                    .filter(Boolean).join(' | ') })} />

          {/* Statement vs audit — changes WHICH LINES the server returns and
              therefore what the running balance means (see file header). */}
          <ToggleButtonGroup exclusive size="small" value={view} sx={GROUP_SX}
            onChange={(_, v) => { if (v) setView(v) }}>
            <ToggleButton value="control"
              title={tr('Only the receivable / payable control accounts — the balance is what the partner owes')}>
              {tr('Statement')}
            </ToggleButton>
            <ToggleButton value="all"
              title={tr('Every GL line carrying this partner — for tracing postings, not a balance')}>
              {tr('All lines (audit)')}
            </ToggleButton>
          </ToggleButtonGroup>

          <DateBasisToggle value={dateBasis} onChange={setDateBasis} />

          <FormControlLabel
            control={<Switch size="small" checked={includeUnbalanced}
              onChange={e => setIncludeUnbalanced(e.target.checked)} />}
            label={<Typography sx={{ fontSize: 12, fontWeight: 600, color: 'var(--rt-text)' }}>
              {tr('Include unbalanced documents')}</Typography>} />
          {!includeUnbalanced && (
            <Chip size="small" label={tr('Balanced documents only')}
              sx={{ fontWeight: 600, fontSize: 11, bgcolor: 'var(--rt-warn-bg)', color: 'var(--rt-warn-fg)' }} />
          )}
        </Box>
      </Box>

      {!bpId ? (
        /* ── Empty state: prompt for a partner — an empty grid would read as
              "this partner has no activity", which is not what this is. ── */
        <Paper elevation={0} sx={{ mt: 3, p: 4, borderRadius: 2, border: '1px dashed var(--rt-border)',
          textAlign: 'center' }}>
          <Typography sx={{ fontSize: 14, fontWeight: 700, color: 'var(--rt-text)' }}>
            {tr('Pick a business partner to see their statement')}
          </Typography>
          <Typography sx={{ fontSize: 12, color: 'var(--rt-text-2)', mt: 0.5 }}>
            {tr('Business Partner (name / id)')}
          </Typography>
        </Paper>
      ) : (
        <>
          {/* ── Method note: what the balance MEASURES in the active view ── */}
          <Box sx={{ mt: 2 }}>
            <Chip size="small"
              label={view === 'control'
                ? trf('Statement on the control accounts ({{codes}}) — the running balance is what the partner owes',
                      { codes: controlAccounts.join(', ') || '…' })
                : tr('All journal lines (audit) — every balanced document nets to zero, so the closing is not the partner balance')}
              sx={{ bgcolor: view === 'control' ? 'var(--rt-surface-3)' : 'var(--rt-warn-bg)',
                    color:   view === 'control' ? 'var(--rt-text-2)'   : 'var(--rt-warn-fg)',
                    fontWeight: 600, fontSize: 11.5, height: 'auto', py: 0.4,
                    '& .MuiChip-label': { whiteSpace: 'normal' } }} />
          </Box>

          {/* ── KPI cards — derived from the grid rows themselves ── */}
          <Box sx={{ display: 'grid', gap: 2, mt: 2,
            gridTemplateColumns: { xs: 'repeat(2,1fr)', md: 'repeat(4,1fr)' } }}>
            <KpiCard label={tr('Opening')} value={moneyExact(kpi.opening, 2)}
              sub={`${tr('As of')} ${dateFrom}`} color={PURPLE_BRAND[500]} icon="ti-player-skip-back" />
            <KpiCard label={tr('Total Debit')} value={money(kpi.debits)}
              sub={tr('in current filter')} color={PURPLE_BRAND[400]} icon="ti-arrow-down-right" />
            <KpiCard label={tr('Total Credit')} value={money(kpi.credits)}
              sub={tr('in current filter')} color={PURPLE_BRAND[400]} icon="ti-arrow-up-right" />
            <KpiCard label={tr('Closing')} value={moneyExact(kpi.closing, 2)}
              sub={`${tr('As of')} ${dateTo}`}
              color={kpi.closing < 0 ? theme.palette.error.main : theme.palette.success.main}
              icon="ti-player-skip-forward" />
          </Box>

          {/* ── Statement grid ── */}
          <Paper elevation={0} sx={{ borderRadius: 2, border: '1px solid var(--rt-border)', overflow: 'hidden', mt: 2, mb: 1 }}>
            <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ px: 1.5, py: 1, flexWrap: 'wrap', gap: 1 }}>
              <Typography sx={{ fontWeight: 700, fontSize: 13, color: 'var(--rt-text)' }}>
                {tr('Statement Lines')} <span style={{ color: 'var(--rt-text-2)', fontWeight: 500 }}>· {num(rows.length, 0)}</span>
              </Typography>
              <GridExportBar gridRef={gridRef} filename="bp_statement" title="BP Statement"
                view={tr('Statement Lines')} filters={filtersSummary}
                reportEndpoint="/api/accounting/bp-statement" reportPeriod={preset || 'custom'}
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
        </>
      )}
    </Box>
  )
}
