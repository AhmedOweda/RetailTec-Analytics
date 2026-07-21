/**
 * Accounting → Journal — master/detail GL explorer (virtual GL, subsidiary 100).
 *
 * Master grain = one JOURNAL = (src_doc_sid, src_doc_type); click a journal and
 * its GL lines load below, drilled by SRC_DOC_SID.
 *
 * SRC_DOC_SID IS A STRING, ALWAYS. The backend emits the BIGINT as VARCHAR
 * because it loses precision as a JSON number; it is carried, compared and sent
 * back as a string (`|`-joined) and is never passed through Number().
 *
 * The reports are GATED to balanced source documents by default — the
 * "Include unbalanced documents" switch is deliberately in the filter bar, in
 * the open, so the gate is never invisible.
 *
 * Colours come from the --rt-* design tokens only (dark mode); accents come
 * from the MUI theme palette. No page-local colour constants.
 */
import { useMemo, useRef, useState, useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  Box, Typography, Chip, TextField, Autocomplete, Stack, Paper,
  Switch, FormControlLabel, InputAdornment, Button,
} from '@mui/material'
import SearchIcon from '@mui/icons-material/Search'
import SavedViewsBar from '../../components/SavedViewsBar'
import DataSlicer, { splitSlicer } from '../../components/DataSlicer'
import {
  DateBasisToggle, JournalCategoryFilter, DEFAULT_DATE_BASIS,
  dateBasisLabel, journalCategoryLabel,
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
import KpiCard from '../../components/KpiCard'
import TitleLoader from '../../components/TitleLoader'
import FeatureUnavailable from '../../components/FeatureUnavailable'
import { useFeature, FEATURE_ACCOUNTING } from '../../hooks/useFeatures'
import { useGlDefaultWindow } from '../../hooks/useGlWindow'
import { noRowsOverlay } from '../../utils/gridOverlay'
import { gridLocaleText } from '../../utils/gridLocale'
import { moneyExact, money, num } from '../../utils/formatters'
import { tr, trf, trCols } from '../../i18n'

const iso = (d: Date) => format(d, 'yyyy-MM-dd')
const today = iso(new Date())
const PRESETS: Record<string, [string, string]> = {
  '7D':  [iso(subDays(new Date(), 6)),  today],
  '30D': [iso(subDays(new Date(), 29)), today],
  'MTD': [iso(startOfMonth(new Date())), today],
  'YTD': [iso(startOfYear(new Date())),  today],
}
const PAGE_SIZE = 200

const fmtMoney = (v: any) => (v == null ? '' : moneyExact(v))
/** Negative money uses the shared negative token — never a literal colour. */
const moneySx = (p: any) =>
  (+(p.value ?? 0) < 0 ? { color: 'var(--rt-neg-fg)', fontWeight: 600 } : undefined)

/** Balanced / unbalanced badge — semantic status tokens, dark-mode safe. */
function BalanceBadge({ value }: { value: any }) {
  const ok = value === true || value === 'true' || value === 1
  return (
    <Box sx={{ display: 'inline-flex', px: 1, py: 0.2, borderRadius: 1, fontSize: 11, fontWeight: 700,
      bgcolor: ok ? 'var(--rt-pos-bg)' : 'var(--rt-neg-bg)',
      color:   ok ? 'var(--rt-pos-fg)' : 'var(--rt-neg-fg)' }}>
      {ok ? tr('Balanced') : tr('Unbalanced')}
    </Box>
  )
}

/** Payment / Entry badge. Derived server-side from the SRC_DOC_TYPE prefix:
 *  'P_*' journals are PAYMENTS (they net to zero by design), the rest are the
 *  transaction ENTRIES. Neutral tokens — this is a classification, not a
 *  pass/fail, so it must not borrow the pos/neg status colours. */
function CategoryBadge({ value }: { value: any }) {
  if (!value) return null
  const payment = String(value) === 'Payment'
  return (
    <Box sx={{ display: 'inline-flex', px: 1, py: 0.2, borderRadius: 1, fontSize: 11, fontWeight: 700,
      bgcolor: payment ? 'var(--rt-surface-3)' : 'var(--rt-warn-bg)',
      color:   payment ? 'var(--rt-text-2)'    : 'var(--rt-warn-fg)' }}>
      {payment ? tr('Payment') : tr('Entry')}
    </Box>
  )
}

const GRID_SX = {
  width: '100%',
  '& .ag-header': { bgcolor: 'var(--rt-grid-header-bg) !important', borderBottom: '1px solid var(--rt-border)' },
  '& .ag-header-cell-text': { fontWeight: 700, color: 'var(--rt-grid-header-fg)', fontSize: 12 },
  '& .ag-row-even': { bgcolor: 'var(--rt-surface)' },
  '& .ag-row-odd': { bgcolor: 'var(--rt-surface-2)' },
  '& .ag-row-selected': { bgcolor: 'var(--rt-grid-selected) !important' },
  '& .ag-paging-panel': { borderTop: '1px solid var(--rt-border)', color: 'var(--rt-text-2)' },
} as const

export default function Journal() {
  const [preset,   setPreset]   = useState('30D')
  const [dateFrom, setDateFrom] = useState(PRESETS['30D'][0])
  const [dateTo,   setDateTo]   = useState(PRESETS['30D'][1])
  const [stores,   setStores]   = useState<string[]>([])
  const [subs,     setSubs]     = useState<{ sid: string; name: string }[]>([])
  // Account and Doc Type are the shared <DataSlicer> — real type-aheads
  // against the chart of accounts and the doc types present in FACT_GL,
  // instead of a free-text box and a list derived from the rows on screen.
  // Both still send exactly what the backend expects: a COMMA-separated list.
  const [accSel,   setAccSel]   = useState<any[]>([])
  const [dtSel,    setDtSel]    = useState<any[]>([])
  const [docNo,    setDocNo]    = useState('')
  // Business partner is the shared <DataSlicer> too — a real dropdown of the
  // partners actually present in FACT_GL, each shown as name | id with its
  // Customer / Supplier kind, instead of a free-text box the user had to guess
  // the spelling of.
  const [bpSel,    setBpSel]    = useState<any[]>([])
  const [search,   setSearch]   = useState('')
  // Which of the two GL dates the window filters on. Transaction by default —
  // the period the activity belongs to, which is what "January's journals"
  // means to an accountant.
  const [dateBasis, setDateBasis] = useState<DateBasis>(DEFAULT_DATE_BASIS)
  // '' = all journals; 'payment' / 'entry' narrow to one category.
  const [journalCat, setJournalCat] = useState<JournalCategory>('')
  // The balanced-document gate. OFF by default: the reports show balanced
  // source documents only until the user deliberately opens the gate.
  const [includeUnbalanced, setIncludeUnbalanced] = useState(false)
  // Selected journal — the SID stays a STRING (BIGINT precision).
  const [selSid,  setSelSid]  = useState<string | null>(null)
  const [selDocNo, setSelDocNo] = useState<string>('')
  const [page,    setPage]    = useState(0)
  // True once the window is authoritative (drill-through, preset chip, manual
  // edit) — see useGlDefaultWindow.
  const winPinned = useRef(false)

  // ── Drill-through: preset the slicers from URL params (command palette,
  //    Trial Balance, Exceptions). EVERY criterion the link carries must be
  //    stored under the name filterParams sends, or the filter silently drops
  //    and the page looks unfiltered. Same pattern as Sales → Journals.
  const [sp] = useSearchParams()
  useEffect(() => {
    const acc = sp.get('account');   if (acc) setAccSel(acc.split(',').filter(Boolean))
    const st  = sp.get('stores');    if (st)  setStores(st.split(',').filter(Boolean))
    const dt  = sp.get('doc_type');  if (dt)  setDtSel(dt.split(',').filter(Boolean))
    const dn  = sp.get('doc_no');    if (dn)  setDocNo(dn)
    // Fuzzy text arrives as a plain chip; an exact id arrives as a stub option
    // carrying only bp_id, which the slicer renders under its own id until the
    // user opens the dropdown. Same shape as Sales → Journals' customer_id.
    const bpq = sp.get('bp');        if (bpq) setBpSel([bpq])
    const bpi = sp.get('bp_id')
    if (bpi) setBpSel(bpi.split('|').filter(Boolean).map(id => ({ bp_id: id, bp_name: '' })))
    const db  = sp.get('date_basis')
    if (db === 'transaction' || db === 'posting') setDateBasis(db)
    const jc  = sp.get('journal_category')
    if (jc === 'payment' || jc === 'entry') setJournalCat(jc)
    const sid = sp.get('src_doc_sid')          // string in, string out
    if (sid) setSelSid(sid)
    const iu = sp.get('include_unbalanced')
    if (iu === 'true' || iu === '1') setIncludeUnbalanced(true)
    // The caller's window (anchored to the warehouse's latest date, which may
    // lag today) — without it the page falls back to its own 30D preset.
    const df = sp.get('date_from'), dtt = sp.get('date_to')
    if (df && dtt) { winPinned.current = true; setPreset(''); setDateFrom(df); setDateTo(dtt) }
  }, [])   // eslint-disable-line react-hooks/exhaustive-deps

  // Open on the GL's OWN loaded span instead of a rolling 30 days — a ledger is
  // loaded per accounting period, so "last 30 days" is routinely empty.
  useGlDefaultWindow(winPinned, (f, t) => { setPreset(''); setDateFrom(f); setDateTo(t) })

  const masterRef = useRef<AgGridReact>(null)
  const lineRef   = useRef<AgGridReact>(null)
  const masterCols = useGridColumnState('accounting-journal')
  const lineCols   = useGridColumnState('accounting-journal-lines')

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

  // Slicer values → the params the router already expects. `account` is a
  // COMMA-separated list of ACCOUNT_CODEs and `doc_type` a comma-separated
  // list of SRC_DOC_TYPEs (both go through csv_in server-side) — the shared
  // slicer changed the INPUT, never the wire format.
  const accToken = (o: any) => (typeof o === 'string' ? o : String(o?.account_code ?? ''))
  const dtToken  = (o: any) => (typeof o === 'string' ? o : String(o?.doc_type ?? ''))
  const accountCsv = splitSlicer(accSel, undefined, accToken).tokens.join(',')
  const docTypeCsv = splitSlicer(dtSel,  undefined, dtToken ).tokens.join(',')

  // Business partner: the chip stays human-readable (name, else the partner
  // code, else the raw SID for a drill-through stub), but the FILTER value for
  // a picked partner is its SID — CUST_ID is nullable and not unique, so it can
  // never identify one partner. A partner PICKED from the dropdown therefore
  // filters exactly on bp_id; anything TYPED still goes through the fuzzy
  // name/code/id match as `bp`. splitSlicer() is the shared helper.
  const bpLabel = (o: any) =>
    String(o?.bp_name || '').trim() || String(o?.bp_code || '').trim() || String(o?.bp_id ?? '')
  const bpToken = (o: any) => (typeof o === 'string' ? o : bpLabel(o))
  const bpIdOf  = (o: any) => (typeof o === 'string' ? '' : String(o?.bp_id ?? ''))
  const { ids: bpIds, typed: bpText } = splitSlicer(bpSel, bpIdOf, bpToken)
  // Flattened to strings so the useMemo below has stable dependencies —
  // splitSlicer returns fresh arrays on every render.
  const bpIdParam   = bpIds.join('|')
  const bpTextParam = bpText.join('|')

  // Every request param EXCEPT paging — also what the scheduled report replays.
  const filterParams = useMemo(() => ({
    date_from: dateFrom, date_to: dateTo,
    ...(stores.length ? { stores: stores.join(',') } : {}),
    ...(subs.length   ? { subsidiaries: subs.map(s => s.sid).join(',') } : {}),
    ...(accountCsv    ? { account: accountCsv } : {}),
    ...(docTypeCsv    ? { doc_type: docTypeCsv } : {}),
    ...(docNo.trim()  ? { doc_no: docNo.trim() } : {}),
    // Exact ids for picked partners, fuzzy text for anything typed. The two
    // params narrow each other server-side (AND), exactly as customer_id /
    // customer do on Sales → Journals — and freeSolo is off here, so the
    // slicer itself can only ever produce one kind or the other.
    ...(bpIdParam     ? { bp_id: bpIdParam } : {}),
    ...(bpTextParam   ? { bp: bpTextParam } : {}),
    // Always sent, never conditional: a scheduled report that omitted the basis
    // would silently fall back to the default and stop matching the saved view.
    date_basis: dateBasis,
    ...(journalCat    ? { journal_category: journalCat } : {}),
    ...(includeUnbalanced ? { include_unbalanced: true } : {}),
    ...(search.trim() ? { search: search.trim() } : {}),
  }), [dateFrom, dateTo, stores, subs, accountCsv, docTypeCsv, docNo,
       bpIdParam, bpTextParam,
       dateBasis, journalCat, includeUnbalanced, search])

  // A filter change invalidates the current page window and the selection.
  // Skipped on the very first run so it cannot wipe a drill-through selection
  // that the mount effect above has just applied.
  const firstFilterRun = useRef(true)
  useEffect(() => {
    if (firstFilterRun.current) { firstFilterRun.current = false; return }
    setPage(0); setSelSid(null); setSelDocNo('')
  }, [filterParams])

  // ── Master: one row per journal, PAGED server-side ({total, rows}) ────────
  const masterParams = useMemo(() => ({
    ...filterParams, limit: PAGE_SIZE, offset: page * PAGE_SIZE,
  }), [filterParams, page])

  const { data: jData, isFetching: jFetching, refetch: refetchJ } = useQuery({
    queryKey: ['acc-journal', masterParams],
    queryFn: () => axios.get('/api/accounting/journal', { params: masterParams }).then(r => r.data),
    placeholderData: p => p,
  })
  const journals: any[] = jData?.rows ?? []
  const total: number   = jData?.total ?? journals.length
  useRetryIfEmpty(journals.length === 0 && page === 0, jFetching, refetchJ)

  // ── Detail: the selected journal's GL lines, drilled by SRC_DOC_SID.
  //    The SID is sent as a STRING inside the '|'-joined list the endpoint
  //    expects — never Number(sid), which would round the BIGINT.
  const lineParams = useMemo(() => ({
    ...filterParams, ...(selSid ? { src_doc_sid: selSid } : {}),
  }), [filterParams, selSid])
  const { data: lineRows = [] } = useQuery<any[]>({
    queryKey: ['acc-journal-lines', lineParams],
    queryFn: () => axios.get('/api/accounting/journal/lines', { params: lineParams }).then(r => r.data),
    enabled: !!selSid,
    placeholderData: p => p,
  })

  // ── KPI cards ────────────────────────────────────────────────────────────
  const { data: kpi } = useQuery<any>({
    queryKey: ['acc-summary', filterParams],
    queryFn: () => axios.get('/api/accounting/summary', { params: filterParams }).then(r => r.data),
    placeholderData: p => p,
  })
  const k = kpi ?? {}

  // ── Column definitions ───────────────────────────────────────────────────
  // BOTH dates are always columns — the basis decides which one leads and is
  // pinned, but neither is hidden: an accountant comparing "when it happened"
  // against "when it hit the books" needs to see the pair side by side.
  const dateCols = useMemo<ColDef[]>(() => {
    const txn: ColDef = { field: 'post_date',    headerName: 'Transaction Date', width: 140 }
    const pst: ColDef = { field: 'gl_post_date', headerName: 'Posting Date',     width: 130 }
    return dateBasis === 'posting'
      ? [{ ...pst, width: 140, pinned: 'left' }, { ...txn, width: 130, pinned: undefined }]
      : [{ ...txn, pinned: 'left' }, pst]
  }, [dateBasis])

  const masterColDefs = useMemo<ColDef[]>(() => [
    ...dateCols,
    { field: 'src_doc_no', headerName: 'Source Doc No.', width: 140, pinned: 'left',
      cellStyle: { fontFamily: 'monospace', fontWeight: 700, color: 'var(--rt-text)' } },
    { field: 'src_doc_type', headerName: 'Doc Type', width: 140 },
    { field: 'journal_category', headerName: 'Journal Category', width: 130,
      cellRenderer: CategoryBadge },
    { field: 'gl_doc_no', headerName: 'GL Doc No.', width: 130,
      cellStyle: { fontFamily: 'monospace', color: 'var(--rt-text-2)' } },
    { field: 'store_name', headerName: 'Store', flex: 1, minWidth: 150 },
    // The NAME is what is shown; bp_id (the raw SID, the only unique key) stays
    // available as its own hidden-by-default column for filtering / drill-through.
    { field: 'bp_name', headerName: 'Business Partner', width: 180 },
    { field: 'bp_code', headerName: 'Partner Code', width: 130,
      cellStyle: { fontFamily: 'monospace', color: 'var(--rt-text-2)' } },
    { field: 'bp_id', headerName: 'Business Partner ID', width: 170, hide: true,
      cellStyle: { fontFamily: 'monospace', color: 'var(--rt-text-2)' } },
    { field: 'lines', headerName: 'Lines', width: 90, type: 'numericColumn',
      valueFormatter: p => num(p.value, 0) },
    { field: 'debit', headerName: 'Debit', width: 130, type: 'numericColumn',
      valueFormatter: p => fmtMoney(p.value), cellStyle: moneySx },
    { field: 'credit', headerName: 'Credit', width: 130, type: 'numericColumn',
      valueFormatter: p => fmtMoney(p.value), cellStyle: moneySx },
    { field: 'net', headerName: 'Net', width: 130, type: 'numericColumn',
      valueFormatter: p => fmtMoney(p.value),
      cellStyle: p => ({ fontWeight: 700, ...(moneySx(p) ?? {}) }) },
    { field: 'is_balanced', headerName: 'Balanced', width: 120, cellRenderer: BalanceBadge },
  ], [dateCols])

  const lineColDefs = useMemo<ColDef[]>(() => [
    { field: 'account_code', headerName: 'Account Code', width: 140, pinned: 'left',
      cellStyle: { fontFamily: 'monospace', fontWeight: 700, color: 'var(--rt-text)' } },
    { field: 'account_name', headerName: 'Account Name', flex: 1, minWidth: 200 },
    { field: 'journal_category', headerName: 'Journal Category', width: 130,
      cellRenderer: CategoryBadge },
    { field: 'bp_name', headerName: 'Business Partner', width: 180 },
    { field: 'bp_code', headerName: 'Partner Code', width: 130,
      cellStyle: { fontFamily: 'monospace', color: 'var(--rt-text-2)' } },
    { field: 'bp_id', headerName: 'Business Partner ID', width: 170, hide: true,
      cellStyle: { fontFamily: 'monospace', color: 'var(--rt-text-2)' } },
    { field: 'store_name', headerName: 'Store', width: 170 },
    { field: 'debit', headerName: 'Debit', width: 130, type: 'numericColumn',
      valueFormatter: p => fmtMoney(p.value), cellStyle: moneySx },
    { field: 'credit', headerName: 'Credit', width: 130, type: 'numericColumn',
      valueFormatter: p => fmtMoney(p.value), cellStyle: moneySx },
    { field: 'amount', headerName: 'Amount', width: 130, type: 'numericColumn',
      valueFormatter: p => fmtMoney(p.value),
      cellStyle: p => ({ fontWeight: 700, ...(moneySx(p) ?? {}) }) },
  ], [])

  const defaultColDef = useMemo(() => ({ sortable: true, filter: true, resizable: true,
    wrapHeaderText: true, autoHeaderHeight: true }), [])

  // The basis and category belong in the exported/emailed header: the same
  // window on the other basis is a different report, and a reader of the PDF
  // has no other way to tell which one they are holding.
  const filtersSummary = `${dateFrom} → ${dateTo} · ${dateBasisLabel(dateBasis)} · ${
    journalCategoryLabel(journalCat)} · ${stores.length
    ? trf('{{n}} store(s)', { n: stores.length }) : tr('All stores')}${
    subs.length ? ` · ${trf('{{n}} subsidiary(ies)', { n: subs.length })}` : ''} · ${
    includeUnbalanced ? tr('Including unbalanced documents') : tr('Balanced documents only')}`

  // Saved views: serialise/restore the whole slicer set, gate included.
  const currentView = { preset, dateFrom, dateTo, stores, subs, accSel, dtSel,
                        docNo, bpSel, search, includeUnbalanced, dateBasis, journalCat }
  const applyView = (s: any) => {
    if (!s) return
    setPreset(s.preset ?? ''); setDateFrom(s.dateFrom ?? dateFrom); setDateTo(s.dateTo ?? dateTo)
    setStores(s.stores ?? []); setSubs(s.subs ?? [])
    // Views saved before the slicers became type-aheads carry the old
    // `account` string / `docTypes` array — restore them as free-text chips.
    setAccSel(s.accSel ?? (s.account ? String(s.account).split(',').filter(Boolean) : []))
    setDtSel(s.dtSel ?? s.docTypes ?? [])
    setDocNo(s.docNo ?? '')
    // Views saved while the partner filter was still a free-text box carry a
    // plain `bp` string — restore it as a free-text chip, which filters exactly
    // as it did then.
    setBpSel(s.bpSel ?? (s.bp ? [String(s.bp)] : []))
    setSearch(s.search ?? ''); setIncludeUnbalanced(!!s.includeUnbalanced)
    // Views saved before the date basis existed carry neither key — they fall
    // back to the documented defaults, which is exactly how they behaved then.
    setDateBasis(s.dateBasis === 'posting' ? 'posting' : DEFAULT_DATE_BASIS)
    setJournalCat(s.journalCat === 'payment' || s.journalCat === 'entry' ? s.journalCat : '')
  }

  const from = total ? page * PAGE_SIZE + 1 : 0
  const to   = Math.min(total, page * PAGE_SIZE + journals.length)

  // Optional customisation: the accounting subsidiary (100). Absent → FACT_GL is
  // permanently empty, which would read as "nothing was posted". Explain instead.
  const [glOff, glReason] = useFeature(FEATURE_ACCOUNTING)
  if (glOff) return (
    <Box sx={{ pt: 3, px: 3, pb: 3 }}>
      <Typography variant="h6" sx={{ fontWeight: 800, color: 'var(--rt-text)', letterSpacing: '-0.3px', mb: 1 }}>
        {tr('Journal')}
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
          {tr('Journal')}<TitleLoader />
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
          <SavedViewsBar pageKey="accounting-journal" current={currentView} onApply={applyView} />
        </Box>

        <Box sx={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 1, mt: 1 }}>
          {/* Account — chart-of-accounts type-ahead (code | name) */}
          <DataSlicer sx={{ minWidth: 220, maxWidth: 340 }} value={accSel} onChange={setAccSel}
            searchEndpoint="/api/accounting/search/accounts"
            getToken={accToken} placeholder="Account (code / name)"
            renderLabel={(o: any) => (typeof o === 'string' ? { code: o }
              : { code: String(o.account_code ?? ''), rest: [o.name_en, o.name_ar].filter(Boolean).join(' | ') })} />

          {/* Document type — a REAL DROPDOWN of the values actually present,
              not a free-text box. minChars={0} makes DataSlicer call the
              endpoint with an empty q, which returns the full list (~12 types),
              so the list opens populated and the user picks from what exists.
              freeSolo stays off: an invented type matches nothing, and silently
              returning zero rows for a typo is the misleading result. */}
          <DataSlicer sx={{ minWidth: 190, maxWidth: 300 }} value={dtSel} onChange={setDtSel}
            searchEndpoint="/api/accounting/search/doc-types"
            minChars={0} freeSolo={false}
            getToken={dtToken} placeholder="Document type" limitTags={1}
            renderLabel={(o: any) => (typeof o === 'string' ? { code: o }
              : { code: String(o.doc_type ?? ''),
                  rest: [o.journal_category, o.lines == null ? null : `${o.lines}`]
                    .filter(Boolean).join(' · ') })} />
          <TextField size="small" sx={{ width: 150 }} value={docNo} onChange={e => setDocNo(e.target.value)}
            placeholder={tr('Source Doc No.')} />
          {/* Business partner — a REAL DROPDOWN of the partners present in
              FACT_GL, not a free-text box. minChars={0} opens it populated
              (same precedent as Document type above) and freeSolo stays off:
              an invented name matches nothing, and silently returning zero
              rows for a typo is the misleading result. Each row shows the
              NAME prominently, then the raw id and a bracketed Customer /
              Supplier kind in DataSlicer's muted `rest` style (--rt-text-2):
              the two dimensions BP_ID resolves to are genuinely different
              entities and the reader must be able to tell which is which. */}
          <DataSlicer sx={{ minWidth: 230, maxWidth: 360 }} value={bpSel} onChange={setBpSel}
            searchEndpoint="/api/accounting/search/bp"
            minChars={0} freeSolo={false} limitTags={1}
            getToken={bpToken} getId={bpIdOf}
            placeholder="Business Partner (name / id)"
            renderLabel={(o: any) => (typeof o === 'string' ? { code: o } : {
              code: bpLabel(o),
              // `rest` is the muted suffix DataSlicer renders after the name:
              // the raw SID (the only unique key) plus the resolved kind, and
              // the human partner code when the dimension has one.
              rest: [String(o?.bp_id ?? ''),
                     o?.bp_kind ? `[${tr(String(o.bp_kind))}]` : null,
                     o?.bp_code ? String(o.bp_code) : null]
                .filter(Boolean).join(' · '),
            })} />
          <TextField size="small" placeholder={tr('Quick search...')} value={search} onChange={e => setSearch(e.target.value)}
            sx={{ width: 200 }} InputProps={{ startAdornment: <InputAdornment position="start">
              <SearchIcon sx={{ fontSize: 18, color: 'var(--rt-text-2)' }} /></InputAdornment> }} />

          {/* Date basis + journal category — report-wide choices, kept beside
              the balanced gate because all three change WHICH ROWS come back,
              not merely how they look. */}
          <DateBasisToggle value={dateBasis} onChange={setDateBasis} />
          <JournalCategoryFilter value={journalCat} onChange={setJournalCat} />

          {/* The balanced-document gate — deliberately in the open, never in a
              menu: the reports hide unbalanced documents by default and the
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
        </Box>
      </Box>

      {/* ── KPI cards ── */}
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'repeat(2,1fr)', md: 'repeat(4,1fr)' }, gap: 2, mt: 2 }}>
        <KpiCard label={tr('Total Debit')}  value={money(k.total_debit)}  sub={tr('in current filter')} icon="ti-arrow-down-right" />
        <KpiCard label={tr('Total Credit')} value={money(k.total_credit)} sub={tr('in current filter')} icon="ti-arrow-up-right" />
        <KpiCard label={tr('Difference')}   value={money(k.difference)}   sub={tr('debit − credit')} icon="ti-scale" />
        <KpiCard label={tr('Documents')}    value={num(k.documents, 0)}   sub={tr('source documents')} icon="ti-files" />
        <KpiCard label={tr('Journals')}     value={num(k.journals, 0)}    sub={tr('doc × doc type')} icon="ti-book" />
        <KpiCard label={tr('Lines')}        value={num(k.lines, 0)}       sub={tr('GL lines')} icon="ti-list" />
        <KpiCard label={tr('Accounts Used')} value={num(k.accounts_used, 0)} sub={tr('distinct accounts')} icon="ti-hash" />
        <KpiCard label={tr('Unbalanced Docs')} value={num(k.unbalanced_docs, 0)}
          sub={`${tr('net')} ${money(k.unbalanced_net)}`} icon="ti-alert-triangle" />
      </Box>

      {/* ── Journal master grid (server-paged) ── */}
      <Paper elevation={0} sx={{ borderRadius: 2, border: '1px solid var(--rt-border)', overflow: 'hidden', mt: 2 }}>
        <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ px: 1.5, py: 1 }}>
          <Typography sx={{ fontWeight: 700, fontSize: 13, color: 'var(--rt-text)' }}>
            {tr('Journals')} <span style={{ color: 'var(--rt-text-2)', fontWeight: 500 }}>· {num(total, 0)}</span>
          </Typography>
          {/* No reportEndpoint: the paged master endpoint is deliberately NOT
              schedulable (a recurring report of page N is meaningless). Export
              and email of the visible page still work. */}
          <GridExportBar gridRef={masterRef} filename="accounting_journal" title="Journal"
            view={tr('Journals')} filters={filtersSummary}
            colDefs={masterColDefs} onResetColumns={masterCols.resetColumns} />
        </Stack>
        <Box className="ag-theme-alpine" sx={{ height: 320, ...GRID_SX }}>
          <AgGridReact localeText={gridLocaleText()} ref={masterRef} rowData={journals} columnDefs={trCols(masterColDefs as any[])}
            defaultColDef={defaultColDef} overlayNoRowsTemplate={noRowsOverlay()}
            rowSelection="single"
            onRowClicked={e => {
              // Keep the BIGINT as text — Number() would silently round it.
              setSelSid(e.data?.src_doc_sid == null ? null : String(e.data.src_doc_sid))
              setSelDocNo(String(e.data?.src_doc_no ?? ''))
            }}
            onGridReady={masterCols.onGridReady} onColumnMoved={masterCols.onColumnChanged}
            onColumnResized={masterCols.onColumnChanged} onColumnVisible={masterCols.onColumnChanged}
            rowHeight={34} headerHeight={38} suppressCellFocus animateRows />
        </Box>
        <Stack direction="row" justifyContent="flex-end" alignItems="center" spacing={1.5}
          sx={{ px: 1.5, py: 0.8, borderTop: '1px solid var(--rt-border)' }}>
          <Typography sx={{ fontSize: 12, color: 'var(--rt-text-2)' }}>
            {trf('{{a}}–{{b}} of {{n}}', { a: from, b: to, n: num(total, 0) })}
          </Typography>
          <Button size="small" variant="outlined" disabled={page === 0 || jFetching}
            onClick={() => setPage(p => Math.max(0, p - 1))}
            sx={{ textTransform: 'none', borderColor: 'var(--rt-border)', color: 'var(--rt-text-2)' }}>
            {tr('Previous')}
          </Button>
          <Button size="small" variant="outlined" disabled={to >= total || jFetching}
            onClick={() => setPage(p => p + 1)}
            sx={{ textTransform: 'none', borderColor: 'var(--rt-border)', color: 'var(--rt-text-2)' }}>
            {tr('Next')}
          </Button>
        </Stack>
      </Paper>

      {/* ── GL line detail grid ── */}
      <Paper elevation={0} sx={{ borderRadius: 2, border: '1px solid var(--rt-border)', overflow: 'hidden', mt: 2, mb: 1 }}>
        <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ px: 1.5, py: 1, flexWrap: 'wrap', gap: 1 }}>
          <Typography sx={{ fontWeight: 700, fontSize: 13, color: 'var(--rt-text)' }}>
            {tr('GL Lines')}
            {selSid && <span style={{ color: 'var(--rt-text-2)', fontWeight: 500 }}> · #{selDocNo || selSid}</span>}
          </Typography>
          {/* Schedulable: the scheduled report replays the SLICERS, not the
              one-document drill (a recurring report pinned to a single
              src_doc_sid would return the same rows forever). */}
          <GridExportBar gridRef={lineRef} filename="accounting_journal_lines" title="Journal"
            view={tr('GL Lines')} filters={filtersSummary}
            reportEndpoint="/api/accounting/journal/lines" reportPeriod={preset || 'custom'}
            reportParams={filterParams} colDefs={lineColDefs} onResetColumns={lineCols.resetColumns} />
        </Stack>
        <Box className="ag-theme-alpine" sx={{ height: 380, ...GRID_SX }}>
          <AgGridReact localeText={gridLocaleText()} ref={lineRef} rowData={lineRows} columnDefs={trCols(lineColDefs as any[])}
            defaultColDef={defaultColDef}
            overlayNoRowsTemplate={selSid ? noRowsOverlay()
              : `<span style="color:var(--rt-text-2);font-size:13px">${tr('Select a journal above to see its GL lines.')}</span>`}
            onGridReady={lineCols.onGridReady} onColumnMoved={lineCols.onColumnChanged}
            onColumnResized={lineCols.onColumnChanged} onColumnVisible={lineCols.onColumnChanged}
            rowHeight={32} headerHeight={38} suppressCellFocus animateRows
            pagination paginationPageSize={100} />
        </Box>
      </Paper>
    </Box>
  )
}
