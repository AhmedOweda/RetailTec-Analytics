/**
 * Data Model Settings — admin panel
 */
import { useState, useEffect, useMemo, useRef } from 'react'
import { CurrencyMark } from '../../components/RiyalSign'
import SendHistoryDialog from '../../components/SendHistoryDialog'
import HistoryIcon2 from '@mui/icons-material/History'
import {
  Box, Card, CardContent, Typography, TextField, Button,
  Alert, CircularProgress, Select, MenuItem,
  FormControl, InputLabel, LinearProgress,
  ToggleButtonGroup, ToggleButton, Switch,
  Checkbox, FormGroup, FormControlLabel, Tooltip,
  Dialog, DialogTitle, DialogContent,
  Collapse, IconButton, Autocomplete,
  Tabs, Tab, Chip, Menu,
} from '@mui/material'
import ArrowDropDownIcon from '@mui/icons-material/ArrowDropDown'
import CheckCircleIcon  from '@mui/icons-material/CheckCircle'
import ExpandMoreIcon   from '@mui/icons-material/ExpandMore'
import DeleteIcon       from '@mui/icons-material/Delete'
import AddIcon          from '@mui/icons-material/Add'
import ErrorIcon        from '@mui/icons-material/Error'
import SyncIcon         from '@mui/icons-material/Sync'
import StopIcon         from '@mui/icons-material/Stop'
import StorageIcon      from '@mui/icons-material/Storage'
import TuneIcon         from '@mui/icons-material/Tune'
import ScheduleIcon     from '@mui/icons-material/Schedule'
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined'
import FolderIcon       from '@mui/icons-material/Folder'
import InsertDriveFileIcon from '@mui/icons-material/InsertDriveFile'
import ArrowUpwardIcon  from '@mui/icons-material/ArrowUpward'
import InsightsIcon   from '@mui/icons-material/Insights'
import AccountBalanceIcon from '@mui/icons-material/AccountBalance'
import ContactPageIcon    from '@mui/icons-material/ContactPage'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import axios from 'axios'
import DataSlicer from '../../components/DataSlicer'
import { useAppSettings, CURRENCIES, type ProductCodeField } from '../../context/AppSettings'
import { ITEM_FIELDS, itemFieldLabel } from '../../utils/itemFields'
import { setSubsidiary } from '../../state/subsidiary'
import { tr, trf } from '../../i18n'
import TitleLoader from '../../components/TitleLoader'
import { useFeatures, FEATURE_ACCOUNTING } from '../../hooks/useFeatures'
import { useLicensedDomains } from '../../hooks/useLicense'
import { domainLicensed } from '../../utils/pages'

const ACCENT = '#7c3aed'

// ONE sticky save-bar geometry for every settings tab (owner request 28 Jul:
// same position and shape everywhere). Used by the global Save Settings bar
// and by AccountingCard's Save Accounting Settings bar — edit here, not there.
const SAVE_BAR_SX = {
  position: 'sticky', bottom: 0, zIndex: 10, mt: 2, px: 2.5, py: 1.5,
  bgcolor: 'var(--rt-surface)', borderTop: '1px solid var(--rt-border)',
  display: 'flex', alignItems: 'center', gap: 2,
  boxShadow: '0 -4px 12px rgba(15,23,42,0.06)',
} as const

const KIND_LABEL: Record<string, string> = {
  full: 'Full load', range: 'Range load', scheduled: 'Scheduled sync', incremental: 'Incremental refresh',
}
function etaText(s: any): string {
  if (!s?.started_at || !s?.done || !s?.total) return ''
  const pct = s.done / s.total
  if (pct <= 0.02) return tr('estimating…')
  const remain = (Date.now() / 1000 - s.started_at) * (1 - pct) / pct
  if (remain < 1) return ''
  const m = Math.floor(remain / 60), sec = Math.round(remain % 60)
  return m > 0 ? trf('~{{m}}m {{s}}s left', { m, s: sec }) : trf('~{{s}}s left', { s: sec })
}

// ── Domain presentation metadata ─────────────────────────────────────────────
// COUPLING: this screen used to carry its own hardcoded list of domains, so a
// domain added to the backend (services/settings_schema.py DOMAINS) had no UI
// and could never be loaded — exactly how `accounting` shipped invisible. The
// LIST is now derived from what GET /api/settings actually returns
// (data_model.domains, which the server builds from that same DOMAINS), so the
// next domain appears here on its own. Only LABELS live below, and an unknown
// key still renders with a title-cased fallback rather than disappearing.
interface DomainMeta {
  label:   string
  desc:    string
  /** Optional Retail Pro customisation this domain needs. Absent on the server
   *  → the row is shown as unavailable instead of offering an empty load. */
  feature?: string
  /** A RetailTec customisation, not a standard Prism feature. */
  custom?:  boolean
}

const DOMAIN_META: Record<string, DomainMeta> = {
  sales:       { label: 'Sales',       desc: 'Daily totals, invoices & line items' },
  transfers:   { label: 'Transfers',   desc: 'Store-to-store transfer slips' },
  adjustments: { label: 'Adjustments', desc: 'Inventory adjustment documents' },
  inventory:   { label: 'Inventory',   desc: 'On-hand quantity snapshot' },
  purchases:   { label: 'Purchases',   desc: 'Purchase orders & received lines' },
  accounting:  { label: 'Accounting',
                 desc: 'General ledger from subsidiary 100. A RetailTec customization — only servers carrying the accounting customization have it.',
                 feature: FEATURE_ACCOUNTING, custom: true },
}

// Display order only. Keys missing from here sort to the end, so an unknown
// (newer) backend domain is still listed.
const DOMAIN_ORDER = ['sales', 'transfers', 'adjustments', 'inventory',
                      'purchases', 'accounting']

// Sync domain → LICENSE domain that owns it. An unlicensed license-domain's
// sync rows disappear (no point syncing data that can't be viewed). Transfers
// and adjustments live on Inventory pages, so they follow the inventory
// license. Dimensions always sync — every licensed domain depends on them —
// and there is no dimensions row here anyway. Unknown keys stay visible.
const DOMAIN_LICENSE: Record<string, string> = {
  sales: 'sales', transfers: 'inventory', adjustments: 'inventory',
  inventory: 'inventory', purchases: 'purchases', accounting: 'accounting',
}

/** Title-case a bare domain key for a domain this build has no metadata for. */
const domainFallbackLabel = (k: string) =>
  k.replace(/[_-]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase())

const LOAD_OPTIONS = [30, 90, 180, 365, 730, 1095]
const DAYS_LABEL: Record<number, string> = {
  30: 'Last 30 days', 90: 'Last 3 months', 180: 'Last 6 months',
  365: 'Last 1 year', 730: 'Last 2 years', 1095: 'Last 3 years',
}
const daysLabel = (v: number) => DAYS_LABEL[v] ? tr(DAYS_LABEL[v]) : trf('Last {{n}} days', { n: v })
// One shared template so the header and every row stay aligned
const DATA_GRID_COLS = 'minmax(118px,150px) minmax(88px,1fr) minmax(96px,1.1fr) minmax(88px,1fr) auto'
// 30-day floor (matches backend clamp): the incremental overlap is a rolling
// self-healing window for late postings and sbs-100 accounting deletes.
const INCR_OPTIONS = [30, 60, 90]
const REFR_OPTIONS = [5, 10, 15, 20, 30, 45, 60, 90, 120, 180, 240, 360, 480, 720, 1440]
// Friendly label for an interval in minutes (e.g. 90 → "1h 30m", 1440 → "24h").
const everyLabel = (m: number) =>
  m < 60 ? trf('{{n}} min', { n: m })
         : (m % 60 === 0 ? trf('{{n}}h', { n: m / 60 })
                         : trf('{{n}}h {{m}}m', { n: Math.floor(m / 60), m: m % 60 }))

// ── v2 settings shape (per-domain schedules + retention) ──────────────────────
export interface ScheduleCfg {
  mode: 'times' | 'interval' | 'manual'
  times?: string[] | null
  days?: string[] | null
  timezone?: string | null
  every_minutes?: number | null
}
export interface DomainCfg {
  enabled: boolean
  load_days: number
  detail: boolean
  retain_detail_months: number | null
  schedule: ScheduleCfg
}
export interface DataModelV2 {
  schema_version: 2
  background_enabled: boolean
  timezone: string
  quiet_hours: { from: string; to: string } | null
  default_incremental_days: number
  domains: Record<string, DomainCfg>
}

const WEEKDAYS  = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const TIMEZONES = ['UTC', 'Asia/Amman', 'Asia/Riyadh', 'Asia/Dubai', 'Africa/Cairo',
                   'Europe/London', 'Europe/Istanbul', 'America/New_York']
const RETAIN_OPTIONS: { v: number | null; l: string }[] = [
  { v: 6, l: '6 months' }, { v: 12, l: '12 months' }, { v: 24, l: '24 months' },
  { v: 36, l: '36 months' }, { v: null, l: 'Keep everything' },
]

const DEFAULT_SCHEDULE: ScheduleCfg = { mode: 'manual' }
const DEFAULT_DM: DataModelV2 = {
  schema_version: 2,
  background_enabled: true,
  timezone: 'UTC',
  quiet_hours: null,
  default_incremental_days: 30,
  // Placeholder only — replaced by the server's own domain set as soon as
  // GET /api/settings resolves.
  domains: Object.fromEntries(DOMAIN_ORDER.map(k => [k, {
    enabled: true, load_days: 365, detail: true, retain_detail_months: null,
    schedule: { ...DEFAULT_SCHEDULE },
  }])) as Record<string, DomainCfg>,
}

/** Caption-above-control field: replaces MUI's floating notched labels, which
 *  kept overlapping the outline/value on this page (late font swap + zoom). */
function LabeledCtl({ label, children }:
  { label: string; children: React.ReactNode }) {
  return (
    <Box sx={{ display:'flex', flexDirection:'column', gap:0.4 }}>
      <Typography sx={{ fontSize:10.5, fontWeight:700, color:'var(--rt-text-2)',
                        textTransform:'uppercase', letterSpacing:0.6, lineHeight:1 }}>
        {tr(label)}
      </Typography>
      {children}
    </Box>
  )
}

function SectionCard({ title, icon, children, headerRight, defaultClosed }:
  { title: string; icon: React.ReactNode; children: React.ReactNode;
    headerRight?: React.ReactNode; defaultClosed?: boolean }) {
  // Collapsible: state remembered per section
  const storageKey = `settings-card-${title.replace(/\W+/g, '-')}`
  const [open, setOpen] = useState<boolean>(() => {
    const stored = localStorage.getItem(storageKey)
    if (stored) return stored !== 'closed'
    return !defaultClosed
  })
  const toggle = () => {
    setOpen(o => {
      localStorage.setItem(storageKey, o ? 'closed' : 'open')
      return !o
    })
  }
  return (
    <Card elevation={0} sx={{ border:'1px solid var(--rt-border)', borderRadius:3, mb:2.5,
                              boxShadow:'0 1px 2px rgba(16,24,40,0.04)', overflow:'hidden',
                              transition:'box-shadow .15s, border-color .15s',
                              '&:hover':{ boxShadow:'0 4px 16px rgba(16,24,40,0.06)', borderColor:'var(--rt-border)' } }}>
      <CardContent sx={{ p:2.75, '&:last-child':{ pb: open ? 2.75 : 2 } }}>
        <Box onClick={toggle}
          sx={{ display:'flex', alignItems:'center', gap:1.25, mb: open ? 2.5 : 0,
                cursor:'pointer', userSelect:'none',
                '&:hover .sc-chevron': { color: 'var(--rt-text)' } }}>
          <Box sx={{ width:34, height:34, borderRadius:2, flexShrink:0,
                     bgcolor:`${ACCENT}0F`, color:ACCENT,
                     display:'flex', alignItems:'center', justifyContent:'center',
                     '& svg':{ fontSize:19 } }}>{icon}</Box>
          <Typography sx={{ fontWeight:700, fontSize:15, color: 'var(--rt-text)', letterSpacing:'-0.2px' }}>{tr(title)}</Typography>
          <Box sx={{ flex:1, display:'flex', alignItems:'center', gap:1.5,
                     justifyContent:'flex-end', minWidth:0 }}>{headerRight}</Box>
          <ExpandMoreIcon className="sc-chevron"
            sx={{ color:'#94a3b8', transition:'transform 0.2s',
                  transform: open ? 'rotate(180deg)' : 'rotate(0deg)' }} />
        </Box>
        <Collapse in={open} timeout={200}>{children}</Collapse>
      </CardContent>
    </Card>
  )
}

// Settings categories for the left rail (indices match the `tab` state).
const SETTINGS_CATS = [
  { i: 0, label: 'Connection & Data',  desc: 'Database, domains, refresh' },
  { i: 1, label: 'Display',            desc: 'Currency, language, fields' },
  { i: 2, label: 'AI Assistant',       desc: 'Provider & model' },
  { i: 3, label: 'Reports & Email',    desc: 'SMTP & schedules' },
  { i: 5, label: 'Accounting',         desc: 'Class roles, AR/AP, defaults' },
  { i: 4, label: 'Maintenance',        desc: 'Backup, compact, about' },
]

// ── Logo upload normalization ───────────────────────────────────────────────
// The logo is stored as a base64 data-URL inside settings.json and rendered
// small (36 px sidebar, 32 px preview). Raw uploads are often huge squares
// with the mark floating in a sea of transparent padding — the padding is what
// made uploaded logos "appear tiny". On pick we therefore: (1) trim the
// transparent margins (alpha bounding-box scan — a no-op for JPEGs, which
// have no alpha), (2) downscale to fit within 512×512 (never upscale), and
// (3) re-encode as PNG to keep transparency. Any failure — decode error,
// missing canvas, tainted pixels — falls back to storing the file as-is.
const LOGO_BOX = 512        // stored logo fits within this square (px)
const LOGO_ALPHA_MIN = 8    // alpha ≤ this counts as transparent when trimming

function readFileAsDataURL(f: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload  = () => resolve(String(r.result || ''))
    r.onerror = () => reject(r.error)
    r.readAsDataURL(f)
  })
}

async function normalizeLogoFile(f: File): Promise<string> {
  const original = await readFileAsDataURL(f)
  // SVG is resolution-independent — rasterizing it would only lose quality.
  if (f.type === 'image/svg+xml') return original
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image()
      el.onload  = () => resolve(el)
      el.onerror = () => reject(new Error('logo decode failed'))
      el.src = original
    })
    const w = img.naturalWidth, h = img.naturalHeight
    if (!w || !h) return original

    // Draw full-size once so we can scan for the opaque bounding box.
    const src = document.createElement('canvas')
    src.width = w; src.height = h
    const sctx = src.getContext('2d')
    if (!sctx) return original
    sctx.drawImage(img, 0, 0)
    let left = w, top = h, right = -1, bottom = -1
    try {
      const data = sctx.getImageData(0, 0, w, h).data
      for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++)
          if (data[(y * w + x) * 4 + 3] > LOGO_ALPHA_MIN) {
            if (x < left)   left = x
            if (x > right)  right = x
            if (y < top)    top = y
            if (y > bottom) bottom = y
          }
    } catch { right = -1 }   // getImageData can throw — just skip trimming
    if (right < 0) { left = 0; top = 0; right = w - 1; bottom = h - 1 }
    // Small breathing margin so the crop isn't pixel-tight.
    const margin = Math.round(Math.max(right - left, bottom - top) * 0.02)
    left   = Math.max(0, left - margin);      top    = Math.max(0, top - margin)
    right  = Math.min(w - 1, right + margin); bottom = Math.min(h - 1, bottom + margin)
    const cw = right - left + 1, ch = bottom - top + 1

    // Fit within the storage box, keeping aspect ratio; never upscale.
    const scale = Math.min(1, LOGO_BOX / cw, LOGO_BOX / ch)
    const ow = Math.max(1, Math.round(cw * scale))
    const oh = Math.max(1, Math.round(ch * scale))
    const out = document.createElement('canvas')
    out.width = ow; out.height = oh
    const octx = out.getContext('2d')
    if (!octx) return original
    octx.imageSmoothingEnabled = true
    octx.imageSmoothingQuality = 'high'
    octx.drawImage(src, left, top, cw, ch, 0, 0, ow, oh)
    const png = out.toDataURL('image/png')
    // PNG re-encode can lose to a well-compressed original (e.g. small JPEG):
    // if nothing was trimmed or scaled and the PNG is bigger, keep the file.
    const changed = cw !== w || ch !== h || scale < 1
    if (!changed && png.length >= original.length) return original
    // Pathological case guard: photo-style JPEG ballooning as PNG.
    return png.length < original.length * 4 ? png : original
  } catch {
    return original
  }
}

export default function DataModelSettings() {
  const qc = useQueryClient()
  const { productCodeField, setProductCodeField, currency, setCurrency,
          showCurrency, setShowCurrency,
          moneyDecimals, setMoneyDecimals,
          abbreviateNumbers, setAbbreviateNumbers,
          thresholds, setThreshold,
          itemFields, setItemFields,
          language, setLanguage } = useAppSettings()

  const { data: settings, isLoading: loadingSettings } = useQuery({
    queryKey: ['settings'],
    queryFn:  () => axios.get('/api/settings').then(r => r.data),
  })

  const { data: syncState } = useQuery({
    queryKey: ['sync-status'],
    queryFn:  () => axios.get('/api/sync/status').then(r => r.data),
    refetchInterval: 2000,
  })

  const { data: coverage } = useQuery({
    queryKey: ['sync-coverage'],
    queryFn:  () => axios.get('/api/sync/coverage').then(r => r.data.coverage as any[]),
    refetchInterval: 5000,
  })

  const { data: history, refetch: refetchHistory, isFetching: histFetching } = useQuery({
    queryKey: ['sync-history'],
    queryFn:  () => axios.get('/api/sync/history?limit=200').then(r => r.data.runs as any[]),
  })

  const [conn, setConn] = useState({ host:'', port:1521, sid:'', username:'', password:'', alias:'' })
  const [dm, setDm]     = useState<DataModelV2>(DEFAULT_DM)
  const [saveMsg, setSaveMsg]         = useState('')
  const [saveErr, setSaveErr]         = useState('')
  const [histOpen, setHistOpen]       = useState(false)
  const [rangeFrom, setRangeFrom]     = useState('')
  const [rangeTo,   setRangeTo]       = useState('')
  const [rangeOpen, setRangeOpen]     = useState(false)
  // Destructive opt-in for the range load: delete the period first, then
  // reload (backend rebuild flag — owner request 28 Jul, "replace everything").
  const [rangeRebuild, setRangeRebuild] = useState(false)
  const [tab, setTab]                 = useState(0)   // Settings tab (UI grouping only)
  const [brandName, setBrandName]     = useState('')  // whitelabel product name
  const [brandLogo, setBrandLogo]     = useState('')  // base64 data-URL or empty
  const [autoMaint, setAutoMaint]     = useState(true) // weekly auto-maintenance
  const [backupKeep, setBackupKeep]   = useState(6)    // monthly backups to keep

  useEffect(() => {
    if (settings) {
      setConn({ ...settings.connection })   // keep masked password so it persists
      // Backend GET always returns the migrated v2 shape; fall back defensively
      if (settings.data_model?.domains) setDm(settings.data_model)
      setBrandName(settings.brand_name ?? '')
      setBrandLogo(settings.brand_logo ?? '')
      setAutoMaint(settings.auto_maintenance !== false)
      setBackupKeep(Number(settings.backup_retention ?? 6) || 6)
    }
  }, [settings])

  // ── v2 update helpers ────────────────────────────────────────────────────
  const setDomain = (key: string, patch: Partial<DomainCfg>) =>
    setDm(prev => ({ ...prev,
      domains: { ...prev.domains, [key]: { ...prev.domains[key], ...patch } } }))

  const setSchedule = (key: string, patch: Partial<ScheduleCfg>) =>
    setDm(prev => ({ ...prev,
      domains: { ...prev.domains,
        [key]: { ...prev.domains[key],
          schedule: { ...prev.domains[key].schedule, ...patch } } } }))

  // Apply one incremental-refresh cadence to EVERY domain at once.
  const setAllSchedules = (mins: number) =>
    setDm(prev => ({ ...prev,
      domains: Object.fromEntries(Object.entries(prev.domains).map(([k, v]) =>
        [k, { ...v, schedule: { mode: 'interval', every_minutes: mins } }])) }))

  const testConn = useMutation({
    mutationFn: () => axios.post('/api/settings/test-connection', conn),
  })

  const saveSettings = useMutation({
    mutationFn: () => axios.put('/api/settings', { connection: conn, data_model: dm,
      brand_name: brandName, brand_logo: brandLogo, auto_maintenance: autoMaint,
      backup_retention: backupKeep }),
    onSuccess: (res) => {
      setSaveErr('')
      if (res.data?.host_changed) {
        // The old server's subsidiary/store selections are meaningless on the
        // new warehouse: clear the saved subsidiary and drop EVERY cached list
        // (subsidiaries-list, stores-list, …) so all slicers refetch fresh.
        setSubsidiary('')
        qc.invalidateQueries()
        setSaveMsg(tr('Host changed — switched to that server\'s database.'))
      } else {
        qc.invalidateQueries({ queryKey:['settings'] })
        qc.invalidateQueries({ queryKey:['sync-status'] })
        setSaveMsg(tr('Settings saved'))
      }
      setTimeout(() => setSaveMsg(''), 5000)
    },
    onError: (err: any) => {
      const detail = err?.response?.data?.detail
      const msg = Array.isArray(detail)
        ? detail.map((d: any) => d.msg ?? JSON.stringify(d)).join(' · ')
        : (detail ?? tr('Save failed'))
      setSaveErr(String(msg))
    },
  })

  const fullLoad = useMutation({
    mutationFn: () => axios.post('/api/sync/full-load'),
    onSuccess:  () => qc.invalidateQueries({ queryKey:['sync-status'] }),
  })

  const loadOne = useMutation({
    mutationFn: (domain: string) =>
      axios.post('/api/sync/full-load', null, { params: { tables: domain } }),
    onSuccess:  () => qc.invalidateQueries({ queryKey:['sync-status'] }),
  })

  // "Replace everything" for ONE domain (owner request 28 Jul): delete the
  // domain's loaded window, then reload it from Oracle. Same endpoint,
  // rebuild flag — destructive, confirmed in the dropdown handler.
  const replaceOne = useMutation({
    mutationFn: (domain: string) =>
      axios.post('/api/sync/full-load', null, { params: { tables: domain, rebuild: true } }),
    onSuccess:  () => qc.invalidateQueries({ queryKey:['sync-status'] }),
  })
  // Which domain row's load-dropdown is open (anchor + domain key).
  const [loadMenu, setLoadMenu] = useState<{ el: HTMLElement; key: string } | null>(null)

  const dimsLoad = useMutation({
    mutationFn: () => axios.post('/api/sync/dimensions-load'),
    onSuccess:  () => qc.invalidateQueries({ queryKey:['sync-status'] }),
  })

  const rangeLoad = useMutation({
    mutationFn: () => axios.post('/api/sync/range', {
      date_from: rangeFrom,
      date_to:   rangeTo,
      domains:   null,
      rebuild:   rangeRebuild,
    }),
    onSuccess:  () => qc.invalidateQueries({ queryKey:['sync-status'] }),
  })

  const stopLoad = useMutation({
    mutationFn: () => axios.post('/api/sync/cancel'),
    onSuccess:  () => qc.invalidateQueries({ queryKey:['sync-status'] }),
  })

  // ── The domain list, derived from the SERVER ─────────────────────────────
  // Not a local constant: whatever domains the backend defines are the domains
  // this screen offers. Labels come from DOMAIN_META, presence does not.
  const { data: features } = useFeatures()
  // Licensed product domains — an unlicensed domain's sync row disappears
  // (dimensions have no row and always sync; other domains depend on them).
  const licDomains = useLicensedDomains()
  const domainList = useMemo(() => {
    const rank = (k: string) => {
      const i = DOMAIN_ORDER.indexOf(k)
      return i < 0 ? DOMAIN_ORDER.length : i
    }
    return Object.keys(dm.domains ?? {})
      .filter(k => {
        const owner = DOMAIN_LICENSE[k]
        return !owner || domainLicensed(licDomains, owner)
      })
      .sort((a, b) => rank(a) - rank(b) || a.localeCompare(b))
      .map(key => {
        const meta = DOMAIN_META[key]
        const info = meta?.feature ? features?.[meta.feature] : undefined
        // Fails OPEN, like every other capability check: unknown or still
        // loading reads as AVAILABLE so a flaky /api/features never hides a
        // domain that actually works.
        const unavailable = !!meta?.feature && info?.available === false
        return {
          key,
          label: meta?.label ?? domainFallbackLabel(key),
          desc:  meta?.desc  ?? '',
          custom: !!meta?.custom,
          unavailable,
          reason: unavailable ? (info?.reason || info?.note || '') : '',
        }
      })
  }, [dm.domains, features, licDomains])

  // Settings categories under this license: the AI Assistant and Reports &
  // Email sections do not exist when their domains are unlicensed. The
  // Accounting section additionally needs the accounting CUSTOMISATION on the
  // server (fails open while /api/features loads, like every capability
  // check on this page).
  const accountingAvailable = features?.[FEATURE_ACCOUNTING]?.available !== false
  const visibleCats = SETTINGS_CATS.filter(c =>
    (c.i !== 2 || domainLicensed(licDomains, 'ai')) &&
    (c.i !== 3 || domainLicensed(licDomains, 'reports')) &&
    (c.i !== 5 || (domainLicensed(licDomains, 'accounting') && accountingAvailable)))
  // If the license narrows while a hidden tab is open, fall back to tab 0.
  useEffect(() => {
    if (!visibleCats.some(c => c.i === tab)) setTab(0)
  }, [licDomains])   // eslint-disable-line react-hooks/exhaustive-deps

  const isRunning = !!syncState?.running

  if (loadingSettings) return <Box sx={{ p:3 }}><LinearProgress /></Box>

  return (
    <Box sx={{ p:3, maxWidth:1120,
               // Fix: notched-outline labels overlapped the border (legend gap
               // stayed collapsed after late font load) — force the notch open
               // for every shrunk label on this page.
               '& .MuiInputLabel-shrink ~ .MuiOutlinedInput-root .MuiOutlinedInput-notchedOutline legend':
                 { maxWidth: '100%' } }}>
      <Typography variant="h6" sx={{ fontWeight:700, fontSize:20, color: 'var(--rt-text)', letterSpacing:'-0.3px', mb:0.5 }}>{tr('Settings')}<TitleLoader /></Typography>
      <Typography sx={{ fontSize:13, color:'#64748b', mb:3 }}>
        {tr('Manage your database connection, data refresh, display, AI assistant, reports and maintenance.')}
      </Typography>

      <Box sx={{ display:'flex', gap:3, alignItems:'flex-start' }}>
        {/* ── Left category rail (desktop) ── */}
        <Box sx={{ width:236, flexShrink:0, position:'sticky', top:12, alignSelf:'flex-start',
                   display:{ xs:'none', md:'block' } }}>
          {visibleCats.map(c => (
            <Box key={c.i} onClick={() => setTab(c.i)} sx={{
              display:'flex', flexDirection:'column', gap:0.1, px:1.5, py:1, mb:0.5, borderRadius:2,
              cursor:'pointer', borderLeft:'3px solid', transition:'all .12s',
              borderColor: tab===c.i ? ACCENT : 'transparent',
              bgcolor: tab===c.i ? `${ACCENT}0F` : 'transparent',
              '&:hover':{ bgcolor: tab===c.i ? `${ACCENT}18` : '#f4f5f9' } }}>
              <Typography sx={{ fontSize:13.5, fontWeight: tab===c.i ? 700 : 600,
                                color: tab===c.i ? ACCENT : 'var(--rt-text-2)' }}>{tr(c.label)}</Typography>
              <Typography sx={{ fontSize:11, color:'#94a3b8' }}>{tr(c.desc)}</Typography>
            </Box>
          ))}
        </Box>

        {/* ── Content column ── */}
        <Box sx={{ flex:1, minWidth:0 }}>
        {/* Mobile category selector */}
        <Box sx={{ display:{ xs:'block', md:'none' }, mb:2 }}>
          <Select fullWidth size="small" value={tab} onChange={e => setTab(Number(e.target.value))}>
            {visibleCats.map(c => <MenuItem key={c.i} value={c.i}>{tr(c.label)}</MenuItem>)}
          </Select>
        </Box>

      {/* ── Tab 0: Connection & Data ── */}
      <Box sx={{ display: tab === 0 ? 'block' : 'none' }}>

      {/* ── Connection ──────────────────────────────────────────── */}
      <SectionCard title="Database Connection" icon={<StorageIcon />}>
        <Box sx={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:2, mb:2 }}>
          <TextField label={tr('Host IP / Hostname')} size="small" fullWidth
            value={conn.host} onChange={e => setConn({ ...conn, host:e.target.value })} />
          <TextField label={tr('Port')} size="small" type="number" fullWidth
            value={conn.port} onChange={e => setConn({ ...conn, port:+e.target.value })} />
          <TextField label={tr('Service Name')} size="small" fullWidth
            placeholder={tr('e.g. rproods')}
            value={conn.sid} onChange={e => setConn({ ...conn, sid:e.target.value })} />
          <TextField label={tr('Username')} size="small" fullWidth
            value={conn.username} onChange={e => setConn({ ...conn, username:e.target.value })} />
          <TextField label={tr('Password')} size="small" type="password" fullWidth
            placeholder={tr('Enter to change password')}
            value={conn.password} onChange={e => setConn({ ...conn, password:e.target.value })} />
          <TextField label={tr('Database Alias')} size="small" fullWidth
            placeholder={tr('e.g. Main Branch DB')}
            value={conn.alias ?? ''} onChange={e => setConn({ ...conn, alias:e.target.value })} />
        </Box>

        <Box sx={{ display:'flex', alignItems:'center', gap:2 }}>
          <Button variant="outlined" size="small" onClick={() => testConn.mutate()}
            disabled={testConn.isPending}
            sx={{ borderColor:ACCENT, color:ACCENT, textTransform:'none', fontWeight:600,
                  '&:hover':{ borderColor:ACCENT, bgcolor:'rgba(124,58,237,0.04)' } }}>
            {testConn.isPending ? <CircularProgress size={14} sx={{ mr:1 }} /> : null}
            {tr('Test Connection')}
          </Button>
          {testConn.isSuccess && (
            <Box sx={{ display:'flex', alignItems:'center', gap:0.5 }}>
              <CheckCircleIcon sx={{ color:'#16a34a', fontSize:18 }} />
              <Typography sx={{ fontSize:13, color:'#16a34a', fontWeight:600 }}>
                {testConn.data?.data?.message}
              </Typography>
            </Box>
          )}
          {testConn.isError && (
            <Box sx={{ display:'flex', alignItems:'center', gap:0.5 }}>
              <ErrorIcon sx={{ color:'#ef4444', fontSize:18 }} />
              <Typography sx={{ fontSize:13, color:'#ef4444' }}>
                {(testConn.error as any)?.response?.data?.detail ?? tr('Connection failed')}
              </Typography>
            </Box>
          )}
        </Box>

        {/* Network-exposure note (owner decision 28 Jul: keep listening on all
            interfaces for VPN/LAN access — warn instead of changing behavior). */}
        <Typography sx={{ mt:2, fontSize:12, color:'#b45309', display:'flex',
                          alignItems:'center', gap:0.75 }}>
          <span aria-hidden>⚠</span>
          {tr('This server listens on all network interfaces (port 7382) so the dashboard is reachable over VPN/LAN. Keep it behind a VPN or firewall — never expose the port to the public internet. Set RETAILTEC_HOST=127.0.0.1 to restrict it to this machine only.')}
        </Typography>
      </SectionCard>

      </Box>{/* end Tab 0 (part 1) */}

      {/* ── Tab 1: Display ── */}
      <Box sx={{ display: tab === 1 ? 'block' : 'none' }}>

      {/* ── Display Settings ────────────────────────────────────── */}
      <SectionCard title="Display Settings" icon={<TuneIcon />}>
        <Typography sx={{ fontSize:13, color: 'var(--rt-text-2)', mb:2 }}>
          {tr('Choose which product code appears alongside the item description in charts and tables throughout the dashboard.')}
        </Typography>
        <Box sx={{ display:'flex', alignItems:'center', gap:2, flexWrap:'wrap', rowGap:1 }}>
          <Typography sx={{ fontSize:13, fontWeight:600, color:'#374151', minWidth:110 }}>
            {tr('Product Code Field')}
          </Typography>
          <ToggleButtonGroup
            value={productCodeField}
            exclusive
            size="small"
            onChange={(_, v) => { if (v) setProductCodeField(v as ProductCodeField) }}
            sx={{ '& .MuiToggleButton-root': { px:2.5, fontWeight:700, fontSize:12, textTransform:'none' },
                  '& .Mui-selected': { bgcolor:`${ACCENT}18 !important`, color:`${ACCENT} !important`, borderColor:`${ACCENT} !important` } }}
          >
            <ToggleButton value="alu">ALU</ToggleButton>
            <ToggleButton value="upc">UPC</ToggleButton>
            <ToggleButton value="description">{tr('Description')}</ToggleButton>
          </ToggleButtonGroup>
          <Typography sx={{ fontSize:12, color:'#94a3b8' }}>
            {productCodeField === 'alu'
              ? tr('Showing ALU (internal item code) · e.g. ALU001 | Blue Shirt')
              : productCodeField === 'upc'
                ? tr('Showing UPC (barcode) · e.g. 123456789 | Blue Shirt')
                : tr('Showing the item description · e.g. Blue Shirt')}
            {' · '}{tr('Also used for scheduled and emailed report attachments.')}
          </Typography>
        </Box>

        <Box sx={{ display:'flex', alignItems:'center', gap:2, mt:2.5, flexWrap:'wrap', rowGap:1 }}>
          <Typography sx={{ fontSize:13, fontWeight:600, color:'#374151', minWidth:110 }}>
            {tr('Currency')}
          </Typography>
          <FormControl size="small" sx={{ minWidth:230 }}>
            <Select value={currency.code}
              onChange={e => setCurrency(String(e.target.value))}>
              {CURRENCIES.map(c => (
                <MenuItem key={c.code} value={c.code}>
                  <Box component="span" sx={{ display:'inline-flex', alignItems:'center', gap:1 }}>
                    <Box component="span" sx={{ fontWeight:700, minWidth:28, textAlign:'center' }}><CurrencyMark code={c.code} symbol={c.symbol} /></Box>
                    {tr(c.name)} ({c.code})
                  </Box>
                </MenuItem>
              ))}
            </Select>
          </FormControl>
          <FormControlLabel sx={{ ml:0.5 }}
            control={
              <Switch size="small" checked={showCurrency}
                onChange={e => setShowCurrency(e.target.checked)} />
            }
            label={<Typography sx={{ fontSize:12.5, color: 'var(--rt-text-2)' }}>{tr('Show sign on money values')}</Typography>}
          />
          <Typography sx={{ fontSize:12, color:'#94a3b8' }}>
            {showCurrency ? `${tr('e.g.')} ${currency.symbol} 17.2M` : tr('e.g. 17.2M (no sign)')}
          </Typography>
        </Box>

        {/* ── Number format ── */}
        <Box sx={{ display:'flex', alignItems:'center', gap:2, mt:2.5, flexWrap:'wrap' }}>
          <Typography sx={{ fontSize:13, fontWeight:600, color:'#374151', minWidth:110 }}>
            {tr('Number Format')}
          </Typography>
          <ToggleButtonGroup
            value={moneyDecimals} exclusive size="small"
            onChange={(_, v) => { if (v !== null) setMoneyDecimals(v) }}
            sx={{ '& .MuiToggleButton-root': { px:2, fontWeight:700, fontSize:12, textTransform:'none' },
                  '& .Mui-selected': { bgcolor:`${ACCENT}18 !important`, color:`${ACCENT} !important`, borderColor:`${ACCENT} !important` } }}>
            <ToggleButton value={0}>{tr('No decimals')}</ToggleButton>
            <ToggleButton value={2}>{tr('2 decimals')}</ToggleButton>
          </ToggleButtonGroup>
          <FormControlLabel sx={{ ml:0.5 }}
            control={
              <Switch size="small" checked={abbreviateNumbers}
                onChange={e => setAbbreviateNumbers(e.target.checked)} />
            }
            label={<Typography sx={{ fontSize:12.5, color: 'var(--rt-text-2)' }}>{tr('Abbreviate large numbers (1.2M / 340K)')}</Typography>}
          />
          <Typography sx={{ fontSize:12, color:'#94a3b8' }}>
            {abbreviateNumbers ? `${tr('e.g.')} 1.23M` : `${tr('e.g.')} 1,234,${moneyDecimals === 2 ? '567.89' : '568'}`}
          </Typography>
        </Box>

        {/* ── Language / direction ── */}
        <Box sx={{ display:'flex', alignItems:'center', gap:2, mt:2.5, flexWrap:'wrap', rowGap:1 }}>
          <Typography sx={{ fontSize:13, fontWeight:600, color:'#374151', minWidth:110 }}>
            {tr('Language')}
          </Typography>
          <ToggleButtonGroup
            value={language} exclusive size="small"
            onChange={(_, v) => { if (v) setLanguage(v) }}
            sx={{ '& .MuiToggleButton-root': { px:2.5, fontWeight:700, fontSize:12, textTransform:'none' },
                  '& .Mui-selected': { bgcolor:`${ACCENT}18 !important`, color:`${ACCENT} !important`, borderColor:`${ACCENT} !important` } }}>
            <ToggleButton value="en">{tr('English')}</ToggleButton>
            <ToggleButton value="ar">العربية</ToggleButton>
          </ToggleButtonGroup>
          <Typography sx={{ fontSize:12, color:'#94a3b8' }}>
            {tr('Arabic flips the whole layout right-to-left')}
          </Typography>
        </Box>

        {/* ── Item grid columns ── */}
        <Box sx={{ mt:2.5 }}>
          <Typography sx={{ fontSize:13, fontWeight:600, color:'#374151', mb:0.3 }}>
            {tr('Item Grid Columns')}
          </Typography>
          <Typography sx={{ fontSize:11.5, color:'#94a3b8', mb:1 }}>
            {tr('Extra item-master fields shown as columns in every table that lists items (descriptions, texts, UDFs, price levels). Applied instantly — data appears after the next sync refreshes the item master.')}
          </Typography>
          <Autocomplete
            multiple disableCloseOnSelect size="small"
            options={ITEM_FIELDS.map(f => f.key)}
            getOptionLabel={k => itemFieldLabel(k)}
            value={itemFields}
            onChange={(_, v) => setItemFields(v)}
            renderInput={p => <TextField {...p} placeholder={itemFields.length ? '' : tr('None — default columns only')}
              size="small" sx={{ maxWidth:560 }} />}
            sx={{ maxWidth:560 }}
          />
        </Box>

        {/* ── Analytics thresholds ── */}
        <Box sx={{ mt:2.5 }}>
          <Typography sx={{ fontSize:13, fontWeight:600, color:'#374151', mb:0.3 }}>
            {tr('Analytics Thresholds')}
          </Typography>
          <Typography sx={{ fontSize:11.5, color:'#94a3b8', mb:1.5 }}>
            {tr('Drive the traffic-light colours across the dashboard (days-on-hand, margin quality, dormant customers). Saved instantly.')}
          </Typography>
          <Box sx={{ display:'flex', gap:2, flexWrap:'wrap' }}>
            {([
              { k:'dohWarn',     l:'DOH amber above',   suffix:'days' },
              { k:'dohBad',      l:'DOH red above',     suffix:'days' },
              { k:'dormantDays', l:'Customer dormant after', suffix:'days' },
              { k:'lowGmPct',    l:'Low margin below',  suffix:'%' },
              { k:'goodGmPct',   l:'Good margin at',    suffix:'%' },
            ] as const).map(f => (
              <LabeledCtl key={f.k} label={`${tr(f.l)} (${tr(f.suffix)})`}>
                <TextField size="small" type="number" sx={{ width:150 }}
                  value={thresholds[f.k]}
                  onChange={e => setThreshold({ [f.k]: Math.max(0, +e.target.value) })} />
              </LabeledCtl>
            ))}
          </Box>
        </Box>

        {/* ── Branding (whitelabel) ── */}
        <Box sx={{ mt:3, pt:2.5, borderTop:'1px solid var(--rt-border)' }}>
          <Typography sx={{ fontSize:13, fontWeight:600, color:'#374151', mb:0.3 }}>
            {tr('Branding')}
          </Typography>
          <Typography sx={{ fontSize:11.5, color:'#94a3b8', mb:1.5 }}>
            {tr('Override the product name and logo shown in the header and sidebar. Leave blank to use the RetailTec defaults. Saved with Save Settings.')}
          </Typography>
          <Box sx={{ display:'flex', gap:2, alignItems:'flex-end', flexWrap:'wrap' }}>
            <LabeledCtl label="Product name">
              <TextField size="small" sx={{ minWidth:260 }}
                placeholder="RetailTec Analytics"
                value={brandName} onChange={e => setBrandName(e.target.value)} />
            </LabeledCtl>
            <Box sx={{ display:'flex', flexDirection:'column', gap:0.4 }}>
              <Typography sx={{ fontSize:10.5, fontWeight:700, color:'var(--rt-text-2)',
                                textTransform:'uppercase', letterSpacing:0.6, lineHeight:1 }}>
                {tr('Logo')}
              </Typography>
              <Box sx={{ display:'flex', alignItems:'center', gap:1.5 }}>
                {brandLogo
                  ? <Box component="img" src={brandLogo} alt="logo"
                      sx={{ height:32, width:'auto', maxWidth:140, objectFit:'contain',
                            bgcolor:'#160b33', px:1, py:0.5, borderRadius:1 }} />
                  : <Typography sx={{ fontSize:12, color:'#94a3b8' }}>{tr('Default logo')}</Typography>}
                <Button component="label" variant="outlined" size="small"
                  sx={{ borderColor:ACCENT, color:ACCENT, textTransform:'none', fontWeight:600 }}>
                  {tr('Upload')}
                  <input hidden type="file" accept="image/*"
                    onChange={e => {
                      const f = e.target.files?.[0]
                      e.target.value = ''   // allow re-picking the same file
                      if (!f) return
                      // Trim transparent padding + fit within 512×512 (PNG);
                      // falls back to the raw file if processing fails.
                      normalizeLogoFile(f).then(setBrandLogo)
                    }} />
                </Button>
                {brandLogo && (
                  <Button size="small" onClick={() => setBrandLogo('')}
                    sx={{ textTransform:'none', color:'#94a3b8' }}>
                    {tr('Remove')}
                  </Button>
                )}
              </Box>
              <Typography sx={{ fontSize:10.5, color:'#94a3b8', maxWidth:380, lineHeight:1.5 }}>
                {tr('Best: a wide PNG with a transparent background, at least 150 px tall. Transparent edges are trimmed and the image is resized automatically.')}
              </Typography>
            </Box>
          </Box>
        </Box>
      </SectionCard>

      </Box>{/* end Tab 2 */}

      {/* ── Tab 0: Connection & Data (part 2) ── */}
      <Box sx={{ display: tab === 0 ? 'block' : 'none' }}>

      {/* ── Automatic sync — collapsed = summary strip, expanded = edit ── */}
      <SectionCard title="Automatic sync" icon={<SyncIcon />} defaultClosed
        headerRight={
          <>
            <Box sx={{ px:1.2, py:0.2, borderRadius:99, fontSize:11.5, fontWeight:700,
                       bgcolor: dm.background_enabled ? 'rgba(22,163,74,0.12)' : 'rgba(148,163,184,0.15)',
                       color: dm.background_enabled ? '#16a34a' : '#64748b' }}>
              {dm.background_enabled ? tr('On') : tr('Off')}
            </Box>
            <Typography sx={{ fontSize:12.5, color:'#64748b', whiteSpace:'nowrap', overflow:'hidden',
                              textOverflow:'ellipsis' }}>
              {tr('Timezone:')} <b style={{ color: 'var(--rt-text)' }}>{dm.timezone}</b>
              {'   ·   '}{tr('Re-check last:')} <b style={{ color: 'var(--rt-text)' }}>{trf('{{n}} days', { n: dm.default_incremental_days })}</b>
              {'   ·   '}{tr('Quiet hours:')} <b style={{ color: 'var(--rt-text)' }}>
                {dm.quiet_hours ? `${dm.quiet_hours.from}–${dm.quiet_hours.to}` : tr('off')}</b>
            </Typography>
          </>
        }>
        <Box sx={{ display:'flex', alignItems:'center', gap:2, flexWrap:'wrap', mb:2.5 }}>
          <FormControlLabel
            control={
              <Switch size="small" checked={dm.background_enabled}
                onChange={e => setDm({ ...dm, background_enabled: e.target.checked })}
                sx={{ '& .Mui-checked': { color: ACCENT },
                      '& .Mui-checked + .MuiSwitch-track': { bgcolor: `${ACCENT} !important` } }} />
            }
            label={<Typography sx={{ fontSize:13, fontWeight:600 }}>{tr('Background sync')}</Typography>}
          />
          <LabeledCtl label="Timezone">
            <FormControl size="small" sx={{ minWidth:190 }}>
              <Select value={dm.timezone}
                onChange={e => setDm({ ...dm, timezone: String(e.target.value) })}>
                {[...new Set([dm.timezone, ...TIMEZONES])].map(tz =>
                  <MenuItem key={tz} value={tz}>{tz}</MenuItem>)}
              </Select>
            </FormControl>
          </LabeledCtl>
          <LabeledCtl label="Incremental overlap">
            <FormControl size="small" sx={{ minWidth:170 }}>
              <Select value={dm.default_incremental_days}
                onChange={e => setDm({ ...dm, default_incremental_days:+e.target.value })}>
                {INCR_OPTIONS.map(d => <MenuItem key={d} value={d}>{trf('Last {{n}} days', { n: d })}</MenuItem>)}
              </Select>
            </FormControl>
          </LabeledCtl>
          <LabeledCtl label="Incremental refresh (all data)">
            <FormControl size="small" sx={{ minWidth:180 }}>
              <Select
                value={(() => {
                  const vals = Object.values(dm.domains).map(v =>
                    v.schedule?.mode === 'interval' ? (v.schedule.every_minutes ?? 0) : -1)
                  return (vals.length && vals.every(v => v === vals[0])) ? vals[0] : ''
                })()}
                displayEmpty
                renderValue={v => v === '' ? tr('Mixed / custom')
                  : v === -1 || v === 0 ? tr('Manual only')
                  : trf('Every {{n}}', { n: everyLabel(Number(v)) })}
                onChange={e => {
                  const v = Number(e.target.value)
                  if (v > 0) setAllSchedules(v)
                }}>
                <MenuItem value="" disabled>{tr('Set frequency for all…')}</MenuItem>
                {REFR_OPTIONS.map(m => <MenuItem key={m} value={m}>{trf('Every {{n}}', { n: everyLabel(m) })}</MenuItem>)}
              </Select>
            </FormControl>
          </LabeledCtl>
        </Box>
        <Box sx={{ display:'flex', alignItems:'center', gap:2, flexWrap:'wrap', mb:2.5 }}>
          <FormControlLabel
            control={
              <Checkbox size="small" checked={!!dm.quiet_hours}
                onChange={e => setDm({ ...dm,
                  quiet_hours: e.target.checked ? { from:'08:00', to:'18:00' } : null })}
                sx={{ color: ACCENT, '&.Mui-checked': { color: ACCENT } }} />
            }
            label={<Typography sx={{ fontSize:13 }}>{tr('Quiet hours (no background sync)')}</Typography>}
          />
          {dm.quiet_hours && (
            <>
              <TextField label={tr('From')} type="time" size="small" sx={{ width:130 }}
                InputLabelProps={{ shrink:true }}
                value={dm.quiet_hours.from}
                onChange={e => setDm({ ...dm, quiet_hours: { ...dm.quiet_hours!, from: e.target.value } })} />
              <TextField label={tr('To')} type="time" size="small" sx={{ width:130 }}
                InputLabelProps={{ shrink:true }}
                value={dm.quiet_hours.to}
                onChange={e => setDm({ ...dm, quiet_hours: { ...dm.quiet_hours!, to: e.target.value } })} />
            </>
          )}
        </Box>

      </SectionCard>

      </Box>{/* end Tab 0 (part 2) */}

      {/* ── Tab 0: Your Data (merged Data Model + Schedules, 2026-07-08) ── */}
      <Box sx={{ display: tab === 0 ? 'block' : 'none' }}>

      {/* ── Your data — one row per domain ─────────────────────────── */}
      <SectionCard title="Your data" icon={<ScheduleIcon />}>
        <Typography sx={{ fontSize:13, color: 'var(--rt-text-2)', mb:2 }}>
          {tr('Everything about each data type in one row — how much history to keep, how it refreshes, and when old line-detail is cleaned up. Daily summaries are kept forever. Remember to Save Settings.')}
        </Typography>

        {/* Column headers */}
        <Box sx={{ display:'grid', alignItems:'center', gap:1, px:1.5, pb:0.5,
                   gridTemplateColumns: DATA_GRID_COLS }}>
          {['Domain', 'Keep history', 'Auto refresh', 'Line detail'].map(h => (
            <Typography key={h} sx={{ fontSize:10.5, fontWeight:700, color:'var(--rt-text-2)',
                                      textTransform:'uppercase', letterSpacing:0.6 }}>
              {tr(h)}
            </Typography>
          ))}
          <span />
        </Box>

        {domainList.map(d => {
          const cfg = dm.domains[d.key]
          if (!cfg) return null
          const sch = cfg.schedule ?? { mode: 'manual' as const }
          return (
            <Box key={d.key}
              sx={{ border:'1px solid var(--rt-border)', borderRadius:1.5, px:1.5, py:1, mb:1,
                    opacity: (cfg.enabled && !d.unavailable) ? 1 : 0.55 }}>
              <Box sx={{ display:'grid', alignItems:'center', gap:1,
                         gridTemplateColumns: DATA_GRID_COLS }}>
                <FormControlLabel sx={{ mr:0 }}
                  control={
                    <Switch size="small" checked={cfg.enabled} disabled={d.unavailable}
                      onChange={e => setDomain(d.key, { enabled: e.target.checked })} />
                  }
                  label={
                    <Tooltip title={tr(d.desc)} placement="top" arrow>
                      <Box sx={{ display:'flex', alignItems:'center', gap:0.6, flexWrap:'wrap' }}>
                        <Typography sx={{ fontSize:13.5, fontWeight:700, color: 'var(--rt-text)' }}>
                          {tr(d.label)}
                        </Typography>
                        {/* A customization is labelled as one — the owner must
                            never read it as a stock Prism capability. */}
                        {d.custom && (
                          <Chip label={tr('Customization')} size="small"
                            sx={{ height:16, fontSize:9, fontWeight:700, letterSpacing:0.3,
                                  bgcolor:'var(--rt-surface-2)', color:'var(--rt-text-2)',
                                  border:'1px solid var(--rt-border)',
                                  '& .MuiChip-label':{ px:0.6 } }} />
                        )}
                      </Box>
                    </Tooltip>
                  }
                />
                <FormControl size="small">
                  <Select value={cfg.load_days}
                    onChange={e => setDomain(d.key, { load_days: +e.target.value })}>
                    {[...new Set([cfg.load_days, ...LOAD_OPTIONS])].sort((a, b) => a - b)
                      .map(v => <MenuItem key={v} value={v}>{daysLabel(v)}</MenuItem>)}
                  </Select>
                </FormControl>
                <FormControl size="small">
                  <Select
                    value={sch.mode === 'manual' ? 'manual'
                      : sch.mode === 'times' ? 'times' : `i${sch.every_minutes ?? 30}`}
                    renderValue={v => v === 'manual' ? tr('Manual only')
                      : v === 'times' ? trf('Daily {{t}}', { t: (sch.times ?? []).join(', ') || '…' })
                      : trf('Every {{n}}', { n: everyLabel(+String(v).slice(1)) })}
                    onChange={e => {
                      const v = String(e.target.value)
                      if (v === 'manual')     setSchedule(d.key, { mode:'manual' })
                      else if (v === 'times') setSchedule(d.key, { mode:'times', times: sch.times ?? ['06:00'] })
                      else                    setSchedule(d.key, { mode:'interval', every_minutes: +v.slice(1) })
                    }}>
                    <MenuItem value="manual">{tr('Manual only')}</MenuItem>
                    {[...new Set([...(sch.mode === 'interval' ? [sch.every_minutes ?? 30] : []), ...REFR_OPTIONS])]
                      .sort((a, b) => a - b)
                      .map(m => <MenuItem key={m} value={`i${m}`}>{trf('Every {{n}}', { n: everyLabel(m) })}</MenuItem>)}
                    <MenuItem value="times">{tr('At set times…')}</MenuItem>
                  </Select>
                </FormControl>
                <FormControl size="small">
                  <Select
                    value={cfg.retain_detail_months === null ? 'null' : cfg.retain_detail_months}
                    onChange={e => setDomain(d.key, {
                      retain_detail_months: e.target.value === 'null' ? null : +e.target.value })}>
                    {RETAIN_OPTIONS.map(o =>
                      <MenuItem key={String(o.v)} value={o.v === null ? 'null' : o.v}>{tr(o.l)}</MenuItem>)}
                  </Select>
                </FormControl>
                {/* Offering a load that can only return nothing is worse than
                    offering none: it reads as a broken sync. */}
                <Tooltip title={d.unavailable ? (d.reason ? tr(d.reason) : tr('Not available on this server')) : ''}
                         placement="top" arrow>
                  <span style={{ display:'inline-flex' }}>
                    <Button variant="outlined" size="small"
                      onClick={() => loadOne.mutate(d.key)}
                      disabled={isRunning || !cfg.enabled || d.unavailable || loadOne.isPending || replaceOne.isPending}
                      sx={{ borderColor:ACCENT, color:ACCENT, textTransform:'none', fontWeight:600,
                            whiteSpace:'nowrap', minWidth:0, px:1.2,
                            borderTopRightRadius:0, borderBottomRightRadius:0, borderRight:0,
                            '&:hover':{ borderColor:ACCENT, bgcolor:'rgba(124,58,237,0.04)' } }}>
                      {tr('Load now')}
                    </Button>
                    <Button variant="outlined" size="small" aria-label={tr('More load options')}
                      onClick={e => setLoadMenu({ el: e.currentTarget, key: d.key })}
                      disabled={isRunning || !cfg.enabled || d.unavailable || loadOne.isPending || replaceOne.isPending}
                      sx={{ borderColor:ACCENT, color:ACCENT, minWidth:0, px:0.25,
                            borderTopLeftRadius:0, borderBottomLeftRadius:0,
                            '&:hover':{ borderColor:ACCENT, bgcolor:'rgba(124,58,237,0.04)' } }}>
                      <ArrowDropDownIcon fontSize="small" />
                    </Button>
                  </span>
                </Tooltip>
              </Box>

              {d.unavailable && (
                <Typography sx={{ fontSize:11.5, color:'var(--rt-text-2)', mt:0.8 }}>
                  {tr('Not available on this server')}
                  {d.reason ? ` — ${tr(d.reason)}` : ''}
                </Typography>
              )}

              {sch.mode === 'times' && (
                <Box sx={{ display:'flex', alignItems:'center', gap:1.5, flexWrap:'wrap', mt:1.5 }}>
                  <TextField size="small" sx={{ minWidth:230 }}
                    placeholder={tr('Times — 06:00, 12:00, 18:00')}
                    helperText={tr('HH:MM, comma-separated')}
                    value={(sch.times ?? []).join(', ')}
                    onChange={e => setSchedule(d.key, {
                      times: e.target.value.split(',').map(t => t.trim()).filter(Boolean) })} />
                  <ToggleButtonGroup size="small" value={sch.days ?? [...WEEKDAYS]}
                    onChange={(_, v: string[]) => setSchedule(d.key, {
                      days: v.length === 0 || v.length === 7 ? null : v })}
                    sx={{ flexWrap:'wrap',
                          '& .MuiToggleButton-root': { px:1, py:0.3, fontSize:11, fontWeight:700, textTransform:'none' },
                          '& .Mui-selected': { bgcolor:`${ACCENT}18 !important`, color:`${ACCENT} !important` } }}>
                    {WEEKDAYS.map(w => <ToggleButton key={w} value={w}>{tr(w)}</ToggleButton>)}
                  </ToggleButtonGroup>
                </Box>
              )}
            </Box>
          )
        })}

        {/* Live progress + global actions */}
        <Box sx={{ borderTop:'1px solid var(--rt-border)', pt:2, mt:2 }}>
          {isRunning && (
            <Box sx={{ mb:2, p:1.5, bgcolor:'rgba(124,58,237,0.06)', borderRadius:1.5 }}>
              <Box sx={{ display:'flex', alignItems:'center', gap:1, mb:0.5 }}>
                <Typography sx={{ fontSize:11, fontWeight:700, color:ACCENT, textTransform:'uppercase', letterSpacing:0.4 }}>
                  {tr(KIND_LABEL[syncState.kind] || 'Sync')}
                </Typography>
                <Box sx={{ flex:1 }} />
                <Typography sx={{ fontSize:11, color:'#94a3b8' }}>{etaText(syncState)}</Typography>
              </Box>
              <Box sx={{ display:'flex', alignItems:'center', gap:1, mb:0.8 }}>
                <CircularProgress size={14} sx={{ color:ACCENT }} />
                <Typography sx={{ fontSize:13, fontWeight:600, color:ACCENT, flex:1 }}>
                  {tr(syncState.step)}…
                </Typography>
                <Typography sx={{ fontSize:11, color:'#94a3b8' }}>
                  {syncState.total ? Math.round((syncState.done / syncState.total) * 100) : 0}%
                </Typography>
              </Box>
              <LinearProgress variant="determinate"
                value={syncState.total ? (syncState.done / syncState.total) * 100 : 0}
                sx={{ height:4, borderRadius:2, '& .MuiLinearProgress-bar':{ bgcolor:ACCENT } }} />
            </Box>
          )}
          {syncState?.error && (
            <Alert severity="error" sx={{ mb:2, fontSize:12 }}>{syncState.error}</Alert>
          )}
          {syncState?.last_sync && !isRunning && (
            <Typography sx={{ fontSize:12, color:'#94a3b8', mb:2 }}>
              {trf('Last sync: {{t}}', { t: new Date(syncState.last_sync).toLocaleString() })}
            </Typography>
          )}

          <Box sx={{ display:'flex', gap:2, flexWrap:'wrap' }}>
            {!isRunning ? (
              <Button variant="outlined" size="small"
                onClick={() => fullLoad.mutate()}
                disabled={fullLoad.isPending}
                sx={{ borderColor:ACCENT, color:ACCENT, textTransform:'none', fontWeight:600,
                      '&:hover':{ borderColor:ACCENT, bgcolor:'rgba(124,58,237,0.04)' } }}>
                {tr('Load All Data now')}
              </Button>
            ) : null}
            {!isRunning ? (
              <Tooltip title={tr('Fresh reload of stores, subsidiaries, employees, departments, vendors, customers and items. No sales or inventory data is loaded.')}>
                <Button variant="outlined" size="small"
                  onClick={() => dimsLoad.mutate()}
                  disabled={dimsLoad.isPending}
                  sx={{ borderColor:'#94a3b8', color: 'var(--rt-text-2)', textTransform:'none', fontWeight:600,
                        '&:hover':{ borderColor:'#64748b', bgcolor:'rgba(100,116,139,0.04)' } }}>
                  {tr('Refresh Dimensions only')}
                </Button>
              </Tooltip>
            ) : (
              <Button variant="outlined" size="small"
                startIcon={<StopIcon />}
                onClick={() => stopLoad.mutate()}
                disabled={stopLoad.isPending}
                sx={{ borderColor:'#ef4444', color:'#ef4444', textTransform:'none', fontWeight:600,
                      '&:hover':{ borderColor:'var(--rt-neg-fg)', bgcolor:'rgba(239,68,68,0.04)' } }}>
                {tr('Stop Load')}
              </Button>
            )}
            {!isRunning && (
              <Button variant="outlined" size="small"
                onClick={() => setRangeOpen(o => !o)}
                sx={{ borderColor:'#94a3b8', color: 'var(--rt-text-2)', textTransform:'none', fontWeight:600,
                      '&:hover':{ borderColor:'#64748b', bgcolor:'rgba(100,116,139,0.04)' } }}>
                {tr('Load a date range…')}
              </Button>
            )}
          </Box>

          <Collapse in={rangeOpen && !isRunning} timeout={200}>
            <Box sx={{ display:'flex', alignItems:'center', gap:2, flexWrap:'wrap', mt:2 }}>
              <Typography sx={{ fontSize:12.5, color:'#64748b', width:'100%' }}>
                {tr('Load an explicit period (e.g. backfill older history) for all enabled data types. This appends to existing data — nothing is deleted.')}
              </Typography>
              <TextField label={tr('From')} type="date" size="small"
                InputLabelProps={{ shrink:true }}
                value={rangeFrom} onChange={e => setRangeFrom(e.target.value)} />
              <TextField label={tr('To')} type="date" size="small"
                InputLabelProps={{ shrink:true }}
                value={rangeTo} onChange={e => setRangeTo(e.target.value)} />
              <FormControlLabel sx={{ ml:0, width:'100%' }}
                control={<Checkbox size="small" checked={rangeRebuild}
                  onChange={e => setRangeRebuild(e.target.checked)}
                  sx={{ color:'#ef4444', '&.Mui-checked':{ color:'#ef4444' } }} />}
                label={<Typography sx={{ fontSize:13, fontWeight:600 }}>
                  {tr('Replace this period (delete existing rows first, then reload)')}
                </Typography>} />
              {rangeRebuild && (
                <Typography sx={{ fontSize:12.5, color:'#ef4444', width:'100%', mt:-1 }}>
                  {tr('Deletes every loaded row in this period for all enabled data types, then reloads them from Oracle. Use for corrections. This cannot be undone.')}
                </Typography>
              )}
              <Button variant="outlined" size="small"
                onClick={() => {
                  if (rangeRebuild && !window.confirm(
                    tr('Deletes every loaded row in this period for all enabled data types, then reloads them from Oracle. Use for corrections. This cannot be undone.')))
                    return
                  rangeLoad.mutate()
                }}
                disabled={isRunning || rangeLoad.isPending || !rangeFrom || !rangeTo}
                sx={{ borderColor: rangeRebuild ? '#ef4444' : ACCENT,
                      color: rangeRebuild ? '#ef4444' : ACCENT,
                      textTransform:'none', fontWeight:600,
                      '&:hover':{ borderColor: rangeRebuild ? '#ef4444' : ACCENT,
                                  bgcolor: rangeRebuild ? 'rgba(239,68,68,0.04)' : 'rgba(124,58,237,0.04)' } }}>
                {rangeRebuild ? tr('Replace Range') : tr('Load Range')}
              </Button>
            </Box>
          </Collapse>
        </Box>
      </SectionCard>

      </Box>{/* end Your Data */}

      {/* ── Tab 0: Connection & Data (part 3) ── */}
      <Box sx={{ display: tab === 0 ? 'block' : 'none' }}>

      {/* Load a Date Range moved into the Your data card actions (2026-07-08) */}

      {/* ── Loaded data coverage ────────────────────────────────── */}
      <SectionCard title="Loaded Data" icon={<StorageIcon />}>
        <Typography sx={{ fontSize:13, color: 'var(--rt-text-2)', mb:2 }}>
          {tr('The date span actually present in the warehouse, per domain.')}
        </Typography>
        <Box sx={{ display:'grid', gridTemplateColumns:'1.2fr 1fr 1fr 0.8fr',
                   rowGap:0.8, columnGap:2, fontSize:12.5 }}>
          <Typography sx={{ fontWeight:700, color: 'var(--rt-text-2)' }}>{tr('Domain')}</Typography>
          <Typography sx={{ fontWeight:700, color: 'var(--rt-text-2)' }}>{tr('From')}</Typography>
          <Typography sx={{ fontWeight:700, color: 'var(--rt-text-2)' }}>{tr('To')}</Typography>
          <Typography sx={{ fontWeight:700, color: 'var(--rt-text-2)', textAlign:'right' }}>{tr('Rows')}</Typography>
          {(coverage ?? []).map((c:any) => (
            <Box key={c.domain} sx={{ display:'contents' }}>
              <Typography sx={{ color: 'var(--rt-text)', fontWeight:600 }}>{tr(c.domain)}</Typography>
              <Typography sx={{ color: 'var(--rt-text-2)' }}>{c.from ?? '-'}</Typography>
              <Typography sx={{ color: 'var(--rt-text-2)' }}>{c.to ?? (c.synced_at ? tr('snapshot') : '-')}</Typography>
              <Typography sx={{ color: 'var(--rt-text-2)', textAlign:'right' }}>
                {(c.rows ?? 0).toLocaleString()}
              </Typography>
            </Box>
          ))}
        </Box>
      </SectionCard>

      </Box>{/* end Tab 0 (part 3) */}

      {/* ── Tab 0: Sync History ── */}
      <Box sx={{ display: tab === 0 ? 'block' : 'none' }}>

      {/* ── Sync history — compact card + filterable dialog ─────── */}
      <SectionCard title="Sync History" icon={<SyncIcon />}>
        <Box sx={{ display:'flex', alignItems:'center', justifyContent:'space-between' }}>
          <Typography sx={{ fontSize:13, color: 'var(--rt-text-2)' }}>
            {history?.length
              ? trf('Last run: {{type}} · {{status}}', { type: tr(history[0].run_type), status: tr(history[0].status) }) +
                (history[0].duration_sec ? ` · ${fmtDur(history[0].duration_sec)}` : '')
              : tr('No sync runs yet.')}
          </Typography>
          <Button variant="outlined" size="small" onClick={() => setHistOpen(true)}
            sx={{ borderColor:ACCENT, color:ACCENT, textTransform:'none', fontWeight:600,
                  '&:hover':{ borderColor:ACCENT, bgcolor:'rgba(124,58,237,0.04)' } }}>
            {tr('View full history')}
          </Button>
        </Box>
      </SectionCard>

      </Box>{/* end Tab 1 (part 2) */}

      {/* ── Tab 2: AI Assistant ── */}
      <Box sx={{ display: tab === 2 ? 'block' : 'none' }}>
      {/* ── AI Assistant (Data Analyst) provider config ──────────── */}
      <AssistantCard />
      </Box>{/* end Tab 2 */}

      {/* ── Tab 4: Maintenance ── */}
      <Box sx={{ display: tab === 4 ? 'block' : 'none' }}>
      {/* ── Maintenance: backup & compact ─────────────────────────── */}
      <MaintenanceCard />
      {/* ── Automatic maintenance toggle (saved with Save Settings) ── */}
      <SectionCard title="Automatic Maintenance" icon={<ScheduleIcon />}>
        <FormControlLabel
          control={
            <Switch size="small" checked={autoMaint}
              onChange={e => setAutoMaint(e.target.checked)}
              sx={{ '& .Mui-checked': { color: ACCENT },
                    '& .Mui-checked + .MuiSwitch-track': { bgcolor: `${ACCENT} !important` } }} />
          }
          label={<Typography sx={{ fontSize:13, fontWeight:600 }}>{tr('Weekly automatic maintenance')}</Typography>}
        />
        <Typography sx={{ fontSize:12, color:'#94a3b8', mt:0.5 }}>
          {tr('Runs a weekly CHECKPOINT to flush pending writes and reclaim space. Safe to leave on. Remember to Save Settings.')}
        </Typography>
        <Box sx={{ mt:1.75, display:'flex', alignItems:'center', gap:1.5, flexWrap:'wrap' }}>
          <TextField type="number" size="small" label={tr('Monthly backups to keep')}
            value={backupKeep} disabled={!autoMaint}
            onChange={e => setBackupKeep(Math.max(1, Math.min(60, Number(e.target.value) || 1)))}
            InputLabelProps={{ shrink:true }} inputProps={{ min:1, max:60 }} sx={{ width:190 }} />
          <Typography sx={{ fontSize:12, color:'#94a3b8' }}>
            {tr('A backup runs monthly; older backups beyond this count are deleted.')}
          </Typography>
        </Box>
      </SectionCard>
      {/* ── About & Diagnostics (read-only) ──────────────────────── */}
      <AboutCard />
      </Box>{/* end Tab 4 (Maintenance) */}

      {/* ── Tab 3: Reports ── */}
      <Box sx={{ display: tab === 3 ? 'block' : 'none' }}>
      {/* ── Email (SMTP) ──────────────────────────────────────────── */}
      <EmailCard />

      {/* ── Scheduled reports (per-store, per-type) ──────────────── */}
      <ReportsCard />

      {/* ── Governance alert emails (auto digest) ─────────────────── */}
      <AlertsCard />
      </Box>{/* end Tab 3 */}

      {/* ── Tab 5: Accounting (license + customisation gated) ── */}
      {visibleCats.some(c => c.i === 5) && (
        <Box sx={{ display: tab === 5 ? 'block' : 'none' }}>
          <AccountingCard />
        </Box>
      )}{/* end Tab 5 */}

      {/* ── Sticky save bar — connection / data-model / schedules scope.
             HIDDEN on the Accounting tab (5): accounting saves through its own
             endpoint and shows its own sticky bar inside AccountingCard, with
             the IDENTICAL geometry (SAVE_BAR_SX — owner request 28 Jul: same
             bar position and shape on every tab). One tab, one save bar —
             showing this one there misled users into clicking a Save that
             does not cover their edits. Lives INSIDE the content column so
             both bars align with the cards above them. */}
      {tab !== 5 && (
      <Box sx={SAVE_BAR_SX}>
        <Button variant="contained"
          onClick={() => saveSettings.mutate()}
          disabled={saveSettings.isPending}
          sx={{ bgcolor:ACCENT, textTransform:'none', fontWeight:700, boxShadow:'none',
                px:3, '&:hover':{ bgcolor:'#6d28d9', boxShadow:'none' } }}>
          {saveSettings.isPending ? tr('Saving…') : tr('Save Settings')}
        </Button>
        <Box sx={{ flex:1 }} />
        {saveMsg && (
          <Typography sx={{ fontSize:12, color: saveMsg.includes('Host') ? '#f59e0b' : '#16a34a',
                            fontWeight:600 }}>
            {saveMsg.includes('Host') ? '⚠ ' : '✓ '}{saveMsg}
          </Typography>
        )}
        {saveErr && (
          <Typography sx={{ fontSize:12, color:'#ef4444', fontWeight:600 }}>{saveErr}</Typography>
        )}
      </Box>
      )}

        </Box>{/* end content column */}
      </Box>{/* end rail + content row */}

      <SyncHistoryDialog open={histOpen} onClose={() => setHistOpen(false)}
        history={history ?? []} refetch={refetchHistory} fetching={histFetching} />

      {/* Per-domain load dropdown (one Menu for all rows). */}
      <Menu open={!!loadMenu} anchorEl={loadMenu?.el} onClose={() => setLoadMenu(null)}>
        <MenuItem onClick={() => { if (loadMenu) loadOne.mutate(loadMenu.key); setLoadMenu(null) }}>
          <Typography sx={{ fontSize:13.5 }}>{tr('Load now (append, nothing deleted)')}</Typography>
        </MenuItem>
        <MenuItem onClick={() => {
          const k = loadMenu?.key
          setLoadMenu(null)
          if (k && window.confirm(tr('Delete ALL loaded data for this data type, then reload it from Oracle over its full history window. This cannot be undone.')))
            replaceOne.mutate(k)
        }}>
          <Typography sx={{ fontSize:13.5, color:'#ef4444', fontWeight:600 }}>
            {tr('Replace everything (delete + reload)')}
          </Typography>
        </MenuItem>
      </Menu>
    </Box>
  )
}

/* ── About / Diagnostics card (read-only) ───────────────────────────────────── */
// Optional Retail Pro customisations, in the order they are shown. The keys
// match FEATURE_* in backend/db/model.py (and hooks/useFeatures.ts).
const FEATURE_ROWS = [
  { key: 'inventory_history', label: 'Inventory History (customisation)' },
  { key: 'accounting',        label: 'Accounting / subsidiary 100 (customisation)' },
]

function AboutCard() {
  const [copied, setCopied] = useState(false)
  const { data, isLoading } = useQuery({
    queryKey: ['diagnostics'],
    queryFn:  () => axios.get('/api/admin/diagnostics').then(r => r.data),
    refetchOnWindowFocus: false,
  })

  const lic = data?.license ?? {}
  const facts: Record<string, number | null> = data?.fact_row_counts ?? {}
  const totalFacts = Object.values(facts).reduce<number>((a, v) => a + (v ?? 0), 0)

  const copy = () => {
    try {
      navigator.clipboard.writeText(JSON.stringify(data ?? {}, null, 2))
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch { /* clipboard unavailable — ignore */ }
  }

  const Row = ({ label, value }: { label: string; value: React.ReactNode }) => (
    <>
      <Typography sx={{ fontSize:12.5, color:'#64748b' }}>{tr(label)}</Typography>
      <Typography sx={{ fontSize:12.5, color: 'var(--rt-text)', fontWeight:600 }}>{value}</Typography>
    </>
  )

  // License chip colour: red if expired, amber if expiring within 30 days
  const licChip = () => {
    if (!lic.present) return <Typography sx={{ fontSize:12.5, color:'#94a3b8' }}>{tr('No license file')}</Typography>
    if (!lic.valid)   return <Typography sx={{ fontSize:12.5, color:'#ef4444', fontWeight:600 }}>{tr('Invalid signature')}</Typography>
    const days = lic.days_remaining
    const colour = lic.expired ? '#ef4444' : (days != null && days <= 30 ? '#f59e0b' : '#16a34a')
    const text = lic.expired
      ? tr('Expired')
      : (days != null ? trf('{{n}} days remaining', { n: days }) : tr('Active'))
    return (
      <Box component="span" sx={{ display:'inline-flex', alignItems:'center', gap:0.8,
                                  px:1, py:0.2, borderRadius:99, bgcolor:`${colour}18` }}>
        <Box sx={{ width:7, height:7, borderRadius:'50%', bgcolor:colour }} />
        <Typography component="span" sx={{ fontSize:12, color:colour, fontWeight:700 }}>{text}</Typography>
      </Box>
    )
  }

  return (
    <SectionCard title="About & Diagnostics" icon={<InfoOutlinedIcon />}>
      {isLoading ? <LinearProgress /> : (
        <Box sx={{ display:'grid', gridTemplateColumns:'auto 1fr', rowGap:0.9, columnGap:3,
                   alignItems:'center', maxWidth:520 }}>
          <Row label="App Version"       value={data?.app_version ?? '—'} />
          <Row label="Schema Version"    value={data?.schema_version ?? '—'} />
          <Row label="Last Sync"         value={data?.last_sync ? new Date(data.last_sync).toLocaleString() : '—'} />
          <Row label="Warehouse Size"    value={data?.warehouse_size_mb != null ? `${data.warehouse_size_mb} MB` : '—'} />
          <Row label="Fact Rows"         value={totalFacts.toLocaleString()} />
          <Row label="License Customer"  value={lic.customer ?? '—'} />
          <Row label="License Expiry"    value={lic.expiry ?? '—'} />
          <Row label="License Status"    value={licChip()} />
          <Row label="License File"      value={
            <Typography component="span" sx={{ fontSize:11.5, fontFamily:'monospace',
                                               color: data?.license_file_present ? '#16a34a' : 'var(--rt-warn-fg)',
                                               wordBreak:'break-all' }}>
              {data?.license_file_path ?? '—'}
              {data?.license_file_path && (data?.license_file_present
                ? tr(' (found)') : tr(' (put license.json here)'))}
            </Typography>} />
          <Row label="Device Code"       value={
            <Typography component="span" sx={{ fontSize:12.5, fontWeight:700,
                                               fontFamily:'monospace', color:ACCENT }}>
              {data?.device_code ?? '—'}
            </Typography>} />

          {/* ── Optional Retail Pro customisations detected on this server ──
                 This is the one place an admin can see, at a glance, WHY a
                 page such as Inventory History or Trial Balance reports the
                 feature as unavailable. Absence is a configuration fact, so it
                 is shown in the neutral warning token, never the error one. ── */}
          {FEATURE_ROWS.map(f => {
            const info = data?.features?.[f.key]
            const ok   = info?.available !== false
            return (
              <Row key={f.key} label={f.label} value={
                <Box component="span" sx={{ display:'inline-flex', alignItems:'center', gap:0.8 }}>
                  <Box sx={{ width:7, height:7, borderRadius:'50%',
                             bgcolor: ok ? 'var(--rt-pos-fg)' : 'var(--rt-warn-fg)' }} />
                  <Typography component="span" sx={{ fontSize:12, fontWeight:700,
                                                     color: ok ? 'var(--rt-pos-fg)' : 'var(--rt-warn-fg)' }}>
                    {ok ? tr('Available') : tr('Not available')}
                  </Typography>
                  {!ok && info?.reason && (
                    <Typography component="span" sx={{ fontSize:11.5, color:'var(--rt-text-2)' }}>
                      — {tr(info.reason)}
                    </Typography>
                  )}
                </Box>} />
            )
          })}
        </Box>
      )}
      <Box sx={{ mt:2, display:'flex', alignItems:'center', gap:1.5 }}>
        <Button variant="outlined" size="small" onClick={copy} disabled={!data}
          sx={{ borderColor:ACCENT, color:ACCENT, textTransform:'none', fontWeight:600 }}>
          {copied ? tr('Copied!') : tr('Copy diagnostics')}
        </Button>
      </Box>
    </SectionCard>
  )
}

/* ── AI Assistant (Data Analyst) provider config ────────────────────────────── */
const ASST_PROVIDERS = [
  { v: 'groq',      label: 'Groq',               badge: 'Free',    hint: 'Fast, free. Get a key at console.groq.com',      model: 'llama-3.3-70b-versatile' },
  { v: 'gemini',    label: 'Google Gemini',      badge: 'Free',    hint: 'Free tier. Get a key at aistudio.google.com',   model: 'gemini-2.5-flash' },
  { v: 'anthropic', label: 'Claude (Anthropic)', badge: '',        hint: 'Highest quality. Paid API key.',                model: 'claude-sonnet-5' },
  { v: 'openai',    label: 'OpenAI-compatible',  badge: '',        hint: 'OpenAI, OpenRouter, Azure, LM Studio…',         model: 'gpt-4o-mini' },
  { v: 'ollama',    label: 'Local (Ollama)',     badge: 'Offline', hint: 'Runs on this machine, no internet. Install Ollama + pull a model.', model: 'qwen2.5-coder:7b' },
]
const ASST_KEY_MASK = '••••••••'

function AssistantCard() {
  const qc = useQueryClient()
  const [cfg, setCfg] = useState<any>({ enabled:false, provider:'groq',
    ollama_url:'http://localhost:11434', base_url:'', model:'', api_key:'', has_key:false })
  const [msg, setMsg] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)

  useQuery({
    queryKey: ['assistant-config'],
    queryFn: () => axios.get('/api/assistant/config').then(r => {
      // Show a masked value when a key is already stored, so the admin knows
      // it's saved and doesn't need to re-enter it.
      setCfg({ ...r.data, api_key: r.data.has_key ? ASST_KEY_MASK : '' })
      return r.data
    }),
  })
  const save = useMutation({
    mutationFn: () => axios.put('/api/assistant/config', {
      enabled: cfg.enabled, provider: cfg.provider,
      ollama_url: cfg.ollama_url, base_url: cfg.base_url, model: cfg.model,
      // untouched mask = keep stored key; anything else = new key
      api_key: (cfg.api_key && cfg.api_key !== ASST_KEY_MASK) ? cfg.api_key : undefined,
    }),
    onSuccess: () => { setErr(null); setMsg(tr('AI Assistant settings saved'));
      qc.invalidateQueries({ queryKey: ['assistant-status'] })
      qc.invalidateQueries({ queryKey: ['assistant-config'] }) },
    onError: (e: any) => { setMsg(null); setErr(e?.response?.data?.detail ?? tr('Save failed')) },
  })
  const set = (k: string, v: any) => setCfg((c: any) => ({ ...c, [k]: v }))
  const meta = ASST_PROVIDERS.find(p => p.v === cfg.provider) || ASST_PROVIDERS[0]

  return (
    <SectionCard title="AI Assistant (Data Analyst)" icon={<InsightsIcon />}>
      <Typography sx={{ fontSize:13, color: 'var(--rt-text-2)', mb:2 }}>
        {tr('Lets users ask questions about the data in plain language. Choose where the AI runs and connect it.')}
      </Typography>
      <FormControlLabel control={
        <Switch size="small" checked={cfg.enabled} onChange={e => set('enabled', e.target.checked)}
          sx={{ '& .Mui-checked': { color: ACCENT }, '& .Mui-checked + .MuiSwitch-track': { bgcolor: `${ACCENT} !important` } }} />}
        label={<Typography sx={{ fontSize:13, fontWeight:600 }}>{tr('Enable the AI assistant')}</Typography>} />

      <Box sx={{ display:'flex', gap:2, flexWrap:'wrap', mt:2, alignItems:'flex-start' }}>
        <FormControl size="small" sx={{ minWidth:240 }}>
          <InputLabel>{tr('Provider')}</InputLabel>
          <Select value={cfg.provider} label={tr('Provider')} onChange={e => set('provider', e.target.value)}>
            {ASST_PROVIDERS.map(p => (
              <MenuItem key={p.v} value={p.v}>
                {tr(p.label)}{p.badge ? '  · ' + tr(p.badge) : ''}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
        <TextField size="small" label={tr('Model')} value={cfg.model} placeholder={meta.model}
          onChange={e => set('model', e.target.value)} sx={{ minWidth:240 }}
          helperText={tr('Leave blank to use the default:') + ' ' + meta.model} />
      </Box>
      <Typography sx={{ fontSize:12, color:'#94a3b8', mt:1 }}>{tr(meta.hint)}</Typography>

      <Box sx={{ display:'flex', gap:2, flexWrap:'wrap', mt:2, alignItems:'flex-start' }}>
        {cfg.provider === 'ollama' && (
          <TextField size="small" label={tr('Ollama endpoint')} value={cfg.ollama_url}
            onChange={e => set('ollama_url', e.target.value)} sx={{ minWidth:320 }} />
        )}
        {cfg.provider === 'openai' && (
          <TextField size="small" label={tr('API base URL')} value={cfg.base_url}
            placeholder="https://api.openai.com/v1" onChange={e => set('base_url', e.target.value)} sx={{ minWidth:320 }} />
        )}
        {cfg.provider !== 'ollama' && (
          <TextField size="small" type="password" label={tr('API key')} value={cfg.api_key}
            onChange={e => set('api_key', e.target.value)} sx={{ minWidth:320 }}
            helperText={cfg.has_key ? tr('A key is stored (shown masked). Clear it and type to replace.')
                                    : tr('Stored encrypted on this machine.')} />
        )}
      </Box>

      {cfg.provider !== 'ollama' && (
        <Alert severity="info" sx={{ mt:2, borderRadius:2, fontSize:12 }}>
          {tr('Cloud providers need internet. Your question and the data schema are sent to the provider; row data stays local except a small preview used to phrase the answer.')}
        </Alert>
      )}
      <Box sx={{ mt:2, display:'flex', alignItems:'center', gap:2 }}>
        <Button variant="contained" size="small" disabled={save.isPending} onClick={() => save.mutate()}
          sx={{ bgcolor:ACCENT, textTransform:'none', fontWeight:700, '&:hover':{ bgcolor:'#6d28d9' } }}>
          {save.isPending ? tr('Saving…') : tr('Save')}
        </Button>
        {msg && <Typography sx={{ fontSize:12, color:'#16a34a', fontWeight:600 }}>✓ {msg}</Typography>}
      </Box>
      {err && <Alert severity="error" sx={{ mt:1.5, fontSize:12 }}>{err}</Alert>}
    </SectionCard>
  )
}

/* ── Server folder / file browser (works local AND remote) ──────────────────── */
function BrowseDialog({ open, mode, onClose, onPick }:
  { open: boolean; mode: 'folder' | 'file'; onClose: () => void; onPick: (p: string) => void }) {
  const [path, setPath] = useState<string | null>(null)
  const { data, isFetching } = useQuery<any>({
    queryKey: ['browse', mode, path],
    queryFn: () => axios.get('/api/admin/browse', { params: { mode, ...(path ? { path } : {}) } }).then(r => r.data),
    enabled: open,
  })
  useEffect(() => { if (open) setPath(null) }, [open])
  const sep = data?.sep ?? '\\'
  const join = (base: string | null, name: string) =>
    !base ? name : base.endsWith(sep) ? base + name : base + sep + name

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth
      PaperProps={{ sx: { borderRadius: 3, height: '70vh' } }}>
      <DialogTitle sx={{ fontWeight: 700, pb: 1 }}>
        {mode === 'folder' ? tr('Choose a folder on the server') : tr('Choose a backup file on the server')}
      </DialogTitle>
      <DialogContent dividers sx={{ p: 0, display: 'flex', flexDirection: 'column' }}>
        <Box sx={{ px: 2, py: 1, display: 'flex', alignItems: 'center', gap: 1, bgcolor: 'var(--rt-surface-2)', borderBottom: '1px solid var(--rt-border)' }}>
          <IconButton size="small" disabled={!path}
            onClick={() => setPath(data?.parent ?? null)}>
            <ArrowUpwardIcon sx={{ fontSize: 18 }} />
          </IconButton>
          <Typography sx={{ fontSize: 12.5, fontFamily: 'monospace', color: 'var(--rt-text-2)', wordBreak: 'break-all' }}>
            {data?.path ?? tr('This PC (drives)')}
          </Typography>
        </Box>
        <Box sx={{ flex: 1, overflowY: 'auto' }}>
          {isFetching && <LinearProgress />}
          {(data?.dirs ?? []).map((d: string) => (
            <Box key={'d' + d} onClick={() => setPath(join(data?.path ?? null, d))}
              sx={{ display: 'flex', alignItems: 'center', gap: 1.5, px: 2, py: 1, cursor: 'pointer',
                    '&:hover': { bgcolor: 'var(--rt-surface-3)' } }}>
              <FolderIcon sx={{ fontSize: 19, color: '#f59e0b' }} />
              <Typography sx={{ fontSize: 13.5 }}>{d}</Typography>
            </Box>
          ))}
          {(data?.files ?? []).map((f: string) => (
            <Box key={'f' + f} onClick={() => onPick(join(data?.path ?? null, f))}
              sx={{ display: 'flex', alignItems: 'center', gap: 1.5, px: 2, py: 1, cursor: 'pointer',
                    '&:hover': { bgcolor: '#eef9f0' } }}>
              <InsertDriveFileIcon sx={{ fontSize: 19, color: '#0f766e' }} />
              <Typography sx={{ fontSize: 13.5 }}>{f}</Typography>
            </Box>
          ))}
          {!isFetching && (data?.dirs ?? []).length === 0 && (data?.files ?? []).length === 0 && (
            <Typography sx={{ fontSize: 12.5, color: '#94a3b8', p: 2 }}>{tr('Nothing to show here.')}</Typography>
          )}
        </Box>
      </DialogContent>
      <Box sx={{ p: 2, display: 'flex', justifyContent: 'space-between', gap: 1 }}>
        <Button onClick={onClose} sx={{ textTransform: 'none', color: '#64748b' }}>{tr('Cancel')}</Button>
        {mode === 'folder' && (
          <Button variant="contained" disabled={!path} onClick={() => path && onPick(path)}
            sx={{ bgcolor: ACCENT, textTransform: 'none', fontWeight: 700, '&:hover': { bgcolor: '#6d28d9' } }}>
            {tr('Use this folder')}
          </Button>
        )}
      </Box>
    </Dialog>
  )
}

/* ── Maintenance card: backup + compact ─────────────────────────────────────── */
function MaintenanceCard() {
  const [browseFolder, setBrowseFolder] = useState(false)
  const [browseFile, setBrowseFile] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [folder, setFolder] = useState('')
  const [restoreFile, setRestoreFile] = useState('')
  const [restorePath, setRestorePath] = useState('')
  const qc = useQueryClient()

  const { data: backupList } = useQuery({
    queryKey: ['backup-list'],
    queryFn: () => axios.get('/api/admin/backups').then(r => r.data.backups as
      { file: string; size_mb: number; created: string }[]),
  })

  const backup = useMutation({
    mutationFn: () => axios.post('/api/admin/backup', { dest_folder: folder.trim() || null }),
    onSuccess: r => { setErr(null); setMsg(trf('Backup saved: {{path}} ({{mb}} MB)', { path: r.data.path, mb: r.data.size_mb }));
                      qc.invalidateQueries({ queryKey: ['backup-list'] }) },
    onError: (e: any) => { setMsg(null); setErr(e?.response?.data?.detail ?? tr('Backup failed')) },
  })

  const restore = useMutation({
    mutationFn: () => axios.post('/api/admin/restore', { file: restorePath.trim() || restoreFile }),
    onSuccess: r => { setErr(null);
                      setMsg(trf('Restored {{file}} — {{n}} invoices in the warehouse', { file: r.data.restored, n: (r.data.invoices ?? 0).toLocaleString() }));
                      qc.invalidateQueries() },
    onError: (e: any) => { setMsg(null); setErr(e?.response?.data?.detail ?? tr('Restore failed')) },
  })
  const compact = useMutation({
    mutationFn: () => axios.post('/api/admin/compact'),
    onSuccess: r => { setErr(null); setMsg(trf('Compacted: {{a}} MB → {{b}} MB', { a: r.data.before_mb, b: r.data.after_mb })) },
    onError: (e: any) => { setMsg(null); setErr(e?.response?.data?.detail ?? tr('Compact failed')) },
  })

  return (
    <SectionCard title="Maintenance" icon={<StorageIcon />}>
      <Typography sx={{ fontSize:13, color: 'var(--rt-text-2)', mb:2 }}>
        {tr('Back up the local warehouse file (safe while the app is running), or compact it to flush pending writes and reclaim space.')}
      </Typography>
      <Box sx={{ display:'flex', gap:2, alignItems:'flex-end', flexWrap:'wrap' }}>
        <LabeledCtl label="Backup folder (empty = backend/backups)">
          <TextField size="small" sx={{ minWidth:320 }} placeholder="D:\\RetailTecBackups"
            value={folder} onChange={e => setFolder(e.target.value)} />
        </LabeledCtl>
        <Button variant="outlined" size="small"
          onClick={() => setBrowseFolder(true)}
          sx={{ borderColor:'#94a3b8', color:'#64748b', textTransform:'none', fontWeight:600 }}>
          {tr('Browse…')}
        </Button>
        <Button variant="outlined" size="small" disabled={backup.isPending}
          onClick={() => backup.mutate()}
          sx={{ borderColor:ACCENT, color:ACCENT, textTransform:'none', fontWeight:600 }}>
          {backup.isPending ? tr('Backing up…') : tr('Backup Now')}
        </Button>
        <Button variant="outlined" size="small" disabled={compact.isPending}
          onClick={() => compact.mutate()}
          sx={{ borderColor:'#64748b', color:'#64748b', textTransform:'none', fontWeight:600 }}>
          {compact.isPending ? tr('Compacting…') : tr('Compact Database')}
        </Button>
      </Box>

      {/* Restore from a previous backup (current database only) */}
      <Box sx={{ display:'flex', gap:2, alignItems:'flex-end', flexWrap:'wrap', mt:2.5 }}>
        <FormControl size="small" sx={{ minWidth:320 }}>
          <InputLabel>{tr('Restore from backup')}</InputLabel>
          <Select value={restoreFile} label={tr('Restore from backup')}
            onChange={e => setRestoreFile(e.target.value)}>
            {(backupList ?? []).map(b => (
              <MenuItem key={b.file} value={b.file}>
                {b.created} — {b.size_mb} MB
              </MenuItem>
            ))}
            {(backupList ?? []).length === 0 &&
              <MenuItem value="" disabled>{tr('No backups yet')}</MenuItem>}
          </Select>
        </FormControl>
        <LabeledCtl label="Or full path to a backup file">
          <TextField size="small" sx={{ minWidth:320 }}
            placeholder="D:\\RetailTecBackups\\retailtec_..._backup_....db"
            value={restorePath} onChange={e => setRestorePath(e.target.value)} />
        </LabeledCtl>
        <Button variant="outlined" size="small"
          onClick={() => setBrowseFile(true)}
          sx={{ borderColor:'#94a3b8', color:'#64748b', textTransform:'none', fontWeight:600 }}>
          {tr('Browse…')}
        </Button>
        <Button variant="outlined" size="small" color="error"
          disabled={(!restoreFile && !restorePath.trim()) || restore.isPending}
          onClick={() => {
            if (window.confirm(tr('Replace the current database with this backup? Data loaded after the backup was taken will be lost. The current file is kept as a pre restore copy.')))
              restore.mutate()
          }}
          sx={{ textTransform:'none', fontWeight:600 }}>
          {restore.isPending ? tr('Restoring…') : tr('Restore')}
        </Button>
      </Box>
      <Typography sx={{ fontSize:11.5, color:'#94a3b8', mt:0.5 }}>
        {tr('Restores the currently connected database from one of its backups. A safety copy of the current file is kept.')}
      </Typography>

      {msg && <Typography sx={{ fontSize:12, color:'#16a34a', mt:1.5, fontWeight:600 }}>✓ {msg}</Typography>}
      {err && <Alert severity="error" sx={{ mt:1.5, fontSize:12 }}>{err}</Alert>}

      <BrowseDialog open={browseFolder} mode="folder" onClose={() => setBrowseFolder(false)}
        onPick={p => { setFolder(p); setBrowseFolder(false) }} />
      <BrowseDialog open={browseFile} mode="file" onClose={() => setBrowseFile(false)}
        onPick={p => { setRestorePath(p); setBrowseFile(false) }} />
    </SectionCard>
  )
}

/* ── Email (SMTP) card ───────────────────────────────────────────────────────── */
function EmailCard() {
  const [cfg, setCfg] = useState({ host:'', port:587, username:'', password:'',
                                   from_addr:'', use_tls:true, has_password:false,
                                   include_preview:false, max_report_rows:0,
                                   max_report_rows_default:0 })
  const [testTo, setTestTo] = useState('')
  const [msg, setMsg] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)

  useQuery({
    queryKey: ['email-settings'],
    queryFn: () => axios.get('/api/admin/email').then(r => {
      setCfg(c => ({ ...c, ...r.data, password: '' }))
      return r.data
    }),
  })

  const save = useMutation({
    mutationFn: () => axios.put('/api/admin/email', {
      host: cfg.host, port: +cfg.port, username: cfg.username,
      password: cfg.password || null,   // empty = keep stored
      from_addr: cfg.from_addr, use_tls: cfg.use_tls,
      include_preview: cfg.include_preview,
      max_report_rows: +cfg.max_report_rows || 0,
    }),
    onSuccess: () => { setErr(null); setMsg(tr('Email settings saved')) },
    onError: (e: any) => { setMsg(null); setErr(e?.response?.data?.detail ?? tr('Save failed')) },
  })
  const test = useMutation({
    mutationFn: () => axios.post('/api/admin/email/test', { to: testTo.trim() }),
    onSuccess: r => { setErr(null); setMsg(r.data.message) },
    onError: (e: any) => { setMsg(null); setErr(e?.response?.data?.detail ?? tr('Test failed')) },
  })

  return (
    <SectionCard title="Email (SMTP)" icon={<SyncIcon />}>
      <Typography sx={{ fontSize:13, color: 'var(--rt-text-2)', mb:2 }}>
        {tr('Used for sending reports and alerts. Works with your company mail server or Gmail (smtp.gmail.com, port 587, app password). The password is stored encrypted.')}
      </Typography>
      <Box sx={{ display:'grid', gridTemplateColumns:'2fr 1fr', gap:2, mb:2 }}>
        <LabeledCtl label="SMTP host">
          <TextField size="small" placeholder="smtp.gmail.com" value={cfg.host}
            onChange={e => setCfg({ ...cfg, host: e.target.value })} />
        </LabeledCtl>
        <LabeledCtl label="Port">
          <TextField size="small" type="number" value={cfg.port}
            onChange={e => setCfg({ ...cfg, port: +e.target.value })} />
        </LabeledCtl>
        <LabeledCtl label="Username">
          <TextField size="small" placeholder="reports@company.com" value={cfg.username}
            onChange={e => setCfg({ ...cfg, username: e.target.value })} />
        </LabeledCtl>
        <LabeledCtl label={cfg.has_password ? 'Password (saved — enter to change)' : 'Password'}>
          <TextField size="small" type="password" value={cfg.password}
            onChange={e => setCfg({ ...cfg, password: e.target.value })} />
        </LabeledCtl>
        <LabeledCtl label="From address">
          <TextField size="small" placeholder="RetailTec <reports@company.com>" value={cfg.from_addr}
            onChange={e => setCfg({ ...cfg, from_addr: e.target.value })} />
        </LabeledCtl>
        <FormControlLabel sx={{ mt:2 }}
          control={<Switch size="small" checked={cfg.use_tls}
            onChange={e => setCfg({ ...cfg, use_tls: e.target.checked })} />}
          label={<Typography sx={{ fontSize:12.5, color: 'var(--rt-text-2)' }}>{tr('Use TLS')}</Typography>} />
      </Box>

      {/* ── What goes in the email body ─────────────────────────────────── */}
      <Typography sx={{ fontSize:11, fontWeight:700, color:'var(--rt-text-2)',
                        textTransform:'uppercase', letterSpacing:0.6, mt:2.5, mb:1 }}>
        {tr('Email content')}
      </Typography>
      <Box sx={{ display:'flex', gap:3, alignItems:'flex-start', flexWrap:'wrap' }}>
        <Box sx={{ maxWidth:420 }}>
          <FormControlLabel
            control={<Switch size="small" checked={!!cfg.include_preview}
              onChange={e => setCfg({ ...cfg, include_preview: e.target.checked })} />}
            label={<Typography sx={{ fontSize:12.5, color: 'var(--rt-text-2)' }}>
              {tr('Include a data sample in the email body')}</Typography>} />
          <Typography sx={{ fontSize:11.5, color:'#94a3b8', mt:0.3 }}>
            {tr('Off (recommended): the email carries only a summary of what was sent — the rows travel in the attachment. Applies to scheduled reports and alert digests.')}
          </Typography>
        </Box>
        <LabeledCtl label="Max rows per emailed report">
          <TextField size="small" type="number" sx={{ width:190 }}
            value={cfg.max_report_rows}
            onChange={e => setCfg({ ...cfg, max_report_rows: Math.max(0, +e.target.value || 0) })}
            helperText={cfg.max_report_rows
              ? tr('Rows beyond this are cut from the file.')
              : `${tr('Using the default')}: ${(cfg.max_report_rows_default || 0).toLocaleString()}`}
            FormHelperTextProps={{ sx:{ fontSize:11, color:'#94a3b8', mx:0 } }} />
        </LabeledCtl>
      </Box>
      <Box sx={{ display:'flex', gap:2, alignItems:'flex-end', flexWrap:'wrap' }}>
        <Button variant="contained" size="small" disabled={save.isPending}
          onClick={() => save.mutate()}
          sx={{ bgcolor:ACCENT, textTransform:'none', fontWeight:600, boxShadow:'none',
                '&:hover':{ bgcolor:'#6d28d9', boxShadow:'none' } }}>
          {tr('Save Email Settings')}
        </Button>
        <LabeledCtl label="Send test to">
          <TextField size="small" placeholder="you@company.com" sx={{ minWidth:220 }}
            value={testTo} onChange={e => setTestTo(e.target.value)} />
        </LabeledCtl>
        <Button variant="outlined" size="small" disabled={test.isPending || !testTo.trim()}
          onClick={() => test.mutate()}
          sx={{ borderColor:ACCENT, color:ACCENT, textTransform:'none', fontWeight:600 }}>
          {test.isPending ? tr('Sending…') : tr('Send Test Email')}
        </Button>
      </Box>
      {msg && <Typography sx={{ fontSize:12, color:'#16a34a', mt:1.5, fontWeight:600 }}>✓ {msg}</Typography>}
      {err && <Alert severity="error" sx={{ mt:1.5, fontSize:12 }}>{err}</Alert>}
    </SectionCard>
  )
}

/* ── Scheduled reports card: configurable list with store scope ─────────────── */
interface ReportDef {
  id?: string; type: string; name: string; time: string
  stores: string; recipients: string; enabled: boolean; last_sent?: string | null
  freq?: string; weekday?: number; day?: number; date?: string | null
  kind?: string; endpoint?: string; params?: any; columns?: any[]
  period?: string; title?: string; view?: string; filters?: string; preinstalled?: boolean; fmt?: string
}

function ReportsCard() {
  const [reports, setReports] = useState<ReportDef[]>([])
  const [types,   setTypes]   = useState<Record<string, string>>({})
  const [msg, setMsg] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [histOpen, setHistOpen] = useState(false)

  useQuery({
    queryKey: ['email-reports'],
    queryFn: () => axios.get('/api/admin/reports').then(r => {
      setTypes(r.data.types); setReports(r.data.reports); return r.data
    }),
  })
  const { data: storeList = [] } = useQuery<string[]>({
    queryKey: ['stores-list'],
    queryFn:  () => axios.get('/api/sales/stores-list').then(r => r.data),
    staleTime: Infinity,
  })

  const save = useMutation({
    mutationFn: () => axios.put('/api/admin/reports', { reports }),
    onSuccess: () => { setErr(null); setMsg(tr('Report schedules saved')) },
    onError: (e: any) => { setMsg(null); setErr(e?.response?.data?.detail ?? tr('Save failed')) },
  })
  const sendNow = useMutation({
    mutationFn: (r: ReportDef) => axios.post('/api/admin/reports/send', { report: r }),
    onSuccess: r => { setErr(null); setMsg(r.data.message) },
    onError: (e: any) => { setMsg(null); setErr(e?.response?.data?.detail ?? tr('Send failed')) },
  })

  const upd = (i: number, patch: Partial<ReportDef>) =>
    setReports(rs => rs.map((r, j) => j === i ? { ...r, ...patch } : r))

  const addReport = () => setReports(rs => [...rs, {
    type: 'daily_sales', name: `Report ${rs.length + 1}`, time: '07:00',
    stores: '', recipients: '', enabled: false,
    freq: 'daily', weekday: 0, day: 1, date: null,
  }])

  return (
    <SectionCard title="Scheduled Reports" icon={<ScheduleIcon />}>
      <Typography sx={{ fontSize:13, color: 'var(--rt-text-2)', mb:2 }}>
        {tr('Each report has its own type, send time, store scope and recipients — e.g. a morning sales report for all stores to the owner, plus a separate one per branch manager scoped to their store. Uses the SMTP settings above. Remember to Save Report Schedules.')}
      </Typography>

      {reports.map((r, i) => (
        <Box key={r.id ?? i}
          sx={{ border:'1px solid var(--rt-border)', borderRadius:1.5, p:1.5, mb:1.5,
                opacity: r.enabled ? 1 : 0.6 }}>
          <Box sx={{ display:'flex', gap:1.5, alignItems:'flex-end', flexWrap:'wrap', mb:1 }}>
            <FormControlLabel sx={{ mr:0 }}
              control={<Switch size="small" checked={r.enabled}
                onChange={e => upd(i, { enabled: e.target.checked })} />}
              label={<Typography sx={{ fontSize:12.5, fontWeight:700 }}>{tr('Enabled')}</Typography>} />
            <LabeledCtl label="Name">
              <TextField size="small" sx={{ width:160 }} value={r.name}
                onChange={e => upd(i, { name: e.target.value })} />
            </LabeledCtl>
            {r.kind === 'grid' ? (
              <LabeledCtl label="Report">
                <Box sx={{ display:'flex', alignItems:'center', gap:0.75, minWidth:230, height:40 }}>
                  <Chip size="small" label={tr('Custom grid')}
                    sx={{ bgcolor:'#ede9fe', color:'#6d28d9', fontWeight:700, fontSize:11 }} />
                  <Typography sx={{ fontSize:12, color: 'var(--rt-text-2)' }} noWrap>
                    {[r.title, r.view].filter(Boolean).join(' — ') || r.name}
                  </Typography>
                </Box>
              </LabeledCtl>
            ) : (
              <LabeledCtl label="Report">
                <FormControl size="small" sx={{ minWidth:230 }}>
                  <Select value={r.type} onChange={e => upd(i, { type: String(e.target.value) })}>
                    {Object.entries(types).map(([k, label]) =>
                      <MenuItem key={k} value={k}>{tr(label)}</MenuItem>)}
                  </Select>
                </FormControl>
              </LabeledCtl>
            )}
            <LabeledCtl label="Frequency">
              <FormControl size="small" sx={{ minWidth:120 }}>
                <Select value={r.freq ?? 'daily'} onChange={e => upd(i, { freq: String(e.target.value) })}>
                  <MenuItem value="daily">{tr('Daily')}</MenuItem>
                  <MenuItem value="weekly">{tr('Weekly')}</MenuItem>
                  <MenuItem value="monthly">{tr('Monthly')}</MenuItem>
                  <MenuItem value="once">{tr('One time')}</MenuItem>
                </Select>
              </FormControl>
            </LabeledCtl>
            {(r.freq ?? 'daily') === 'weekly' && (
              <LabeledCtl label="On">
                <FormControl size="small" sx={{ minWidth:120 }}>
                  <Select value={r.weekday ?? 0} onChange={e => upd(i, { weekday: Number(e.target.value) })}>
                    {['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'].map((d, idx) =>
                      <MenuItem key={idx} value={idx}>{tr(d)}</MenuItem>)}
                  </Select>
                </FormControl>
              </LabeledCtl>
            )}
            {(r.freq ?? 'daily') === 'monthly' && (
              <LabeledCtl label="Day of month">
                <TextField type="number" size="small" sx={{ width:90 }} value={r.day ?? 1}
                  onChange={e => upd(i, { day: Math.max(1, Math.min(31, Number(e.target.value) || 1)) })}
                  inputProps={{ min:1, max:31 }} />
              </LabeledCtl>
            )}
            {(r.freq ?? 'daily') === 'once' && (
              <LabeledCtl label="Date">
                <TextField type="date" size="small" value={r.date ?? ''}
                  onChange={e => upd(i, { date: e.target.value })} InputLabelProps={{ shrink:true }} />
              </LabeledCtl>
            )}
            <LabeledCtl label="Send at">
              <TextField size="small" type="time" sx={{ width:120 }} value={r.time}
                onChange={e => upd(i, { time: e.target.value })} />
            </LabeledCtl>
            {r.kind === 'grid' && (
              <LabeledCtl label="Format">
                <FormControl size="small" sx={{ minWidth:110 }}>
                  <Select value={r.fmt ?? 'excel'} onChange={e => upd(i, { fmt: String(e.target.value) })}>
                    <MenuItem value="pdf">PDF</MenuItem>
                    <MenuItem value="excel">Excel</MenuItem>
                    <MenuItem value="csv">CSV</MenuItem>
                  </Select>
                </FormControl>
              </LabeledCtl>
            )}
            {r.last_sent && (
              <Typography sx={{ fontSize:11, color:'#94a3b8', mb:0.7 }}>{trf('last sent {{t}}', { t: r.last_sent })}</Typography>
            )}
            <Box sx={{ flex:1 }} />
            <Tooltip title={tr('Delete report')}>
              <IconButton size="small" onClick={() => setReports(rs => rs.filter((_, j) => j !== i))}>
                <DeleteIcon sx={{ fontSize:17, color:'#ef4444' }} />
              </IconButton>
            </Tooltip>
          </Box>
          <Box sx={{ display:'flex', gap:1.5, alignItems:'flex-end', flexWrap:'wrap' }}>
            <LabeledCtl label="Stores (empty = all stores)">
              <Autocomplete
                multiple disableCloseOnSelect size="small"
                options={storeList}
                value={r.stores ? r.stores.split(',').map(s => s.trim()).filter(Boolean) : []}
                onChange={(_, v) => upd(i, { stores: v.join(', ') })}
                renderInput={p => <TextField {...p} placeholder={tr('All Stores')} size="small" sx={{ minWidth:260 }} />}
                sx={{ minWidth:260 }}
              />
            </LabeledCtl>
            <LabeledCtl label="Recipients (comma-separated)">
              <TextField size="small" sx={{ minWidth:280 }}
                placeholder="owner@company.com, manager@company.com"
                value={r.recipients}
                onChange={e => upd(i, { recipients: e.target.value })} />
            </LabeledCtl>
            <Button variant="outlined" size="small"
              disabled={sendNow.isPending || !r.recipients.trim()}
              onClick={() => sendNow.mutate(r)}
              sx={{ borderColor:ACCENT, color:ACCENT, textTransform:'none', fontWeight:600 }}>
              {tr('Send Now')}
            </Button>
          </Box>
        </Box>
      ))}

      <Box sx={{ display:'flex', gap:2, alignItems:'center' }}>
        <Button size="small" startIcon={<AddIcon />} onClick={addReport}
          sx={{ textTransform:'none', color:ACCENT, fontWeight:600 }}>
          {tr('Add Report')}
        </Button>
        <Button variant="contained" size="small" disabled={save.isPending}
          onClick={() => save.mutate()}
          sx={{ bgcolor:ACCENT, textTransform:'none', fontWeight:600, boxShadow:'none',
                '&:hover':{ bgcolor:'#6d28d9', boxShadow:'none' } }}>
          {tr('Save Report Schedules')}
        </Button>
        <Box sx={{ flex:1 }} />
        <Button size="small" startIcon={<HistoryIcon2 />} onClick={() => setHistOpen(true)}
          sx={{ textTransform:'none', color:'#64748b', fontWeight:600 }}>
          {tr('Send history')}
        </Button>
      </Box>

      <SendHistoryDialog open={histOpen} onClose={() => setHistOpen(false)} />

      {msg && <Typography sx={{ fontSize:12, color:'#16a34a', mt:1.5, fontWeight:600 }}>✓ {msg}</Typography>}
      {err && <Alert severity="error" sx={{ mt:1.5, fontSize:12 }}>{err}</Alert>}
    </SectionCard>
  )
}

/* ── Governance alert emails: per-condition daily digest rules ─────────────── */
function AlertsCard() {
  const qc = useQueryClient()
  const [rules, setRules] = useState<any[]>([])
  const [defs,  setDefs]  = useState<Record<string, any>>({})
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')

  useQuery({
    queryKey: ['alert-rules'],
    queryFn: () => axios.get('/api/admin/alerts').then(r => {
      setRules(r.data?.rules ?? []); setDefs(r.data?.defs ?? {}); return r.data
    }),
  })

  const save = useMutation({
    mutationFn: () => axios.put('/api/admin/alerts', { rules }),
    onSuccess: () => { setErr(''); setMsg(tr('Alert rules saved')); setTimeout(() => setMsg(''), 4000);
                       qc.invalidateQueries({ queryKey:['alert-rules'] }) },
    onError: (e: any) => setErr(e?.response?.data?.detail ?? tr('Save failed')),
  })
  const upd = (i: number, patch: any) => setRules(rs => rs.map((r, j) => j === i ? { ...r, ...patch } : r))

  return (
    <SectionCard title="Governance Alert Emails" icon={<ScheduleIcon />}>
      <Typography sx={{ fontSize:12.5, color:'#64748b', mb:2 }}>
        {tr('Each enabled rule emails a daily digest — a CSV of the prior day\'s offending invoices — at its chosen time. Uses the SMTP settings above.')}
      </Typography>
      {rules.map((r, i) => {
        const unit = defs[r.condition]?.unit || ''
        return (
          <Box key={r.id || i} sx={{ border:'1px solid var(--rt-border)', borderRadius:2, p:2, mb:1.5 }}>
            <Box sx={{ display:'flex', alignItems:'center', gap:1.5, flexWrap:'wrap' }}>
              <FormControlLabel
                control={<Switch size="small" checked={!!r.enabled} onChange={e => upd(i, { enabled: e.target.checked })}
                  sx={{ '& .Mui-checked': { color: ACCENT }, '& .Mui-checked + .MuiSwitch-track': { bgcolor: `${ACCENT} !important` } }} />}
                label={<Typography sx={{ fontSize:13, fontWeight:700 }}>{tr(r.name)}</Typography>} />
              <Box sx={{ flex:1 }} />
              {r.condition !== 'below_cost' && (
                <TextField size="small" type="number" label={unit === '%' ? tr('Discount %') : tr('Amount ≥')}
                  value={r.threshold} onChange={e => upd(i, { threshold: Number(e.target.value) })}
                  InputLabelProps={{ shrink:true }} sx={{ width:150 }} />
              )}
              <TextField size="small" type="time" label={tr('Send at')} value={r.time || '07:00'}
                onChange={e => upd(i, { time: e.target.value })} InputLabelProps={{ shrink:true }} sx={{ width:120 }} />
            </Box>
            <TextField size="small" fullWidth label={tr('Recipients (comma-separated)')}
              placeholder="owner@company.com, manager@company.com"
              value={r.recipients || ''} onChange={e => upd(i, { recipients: e.target.value })}
              InputLabelProps={{ shrink:true }} sx={{ mt:1.5 }} />
          </Box>
        )
      })}
      <Box sx={{ display:'flex', alignItems:'center', gap:2, mt:1 }}>
        <Button variant="contained" size="small" onClick={() => save.mutate()} disabled={save.isPending}
          sx={{ bgcolor:ACCENT, textTransform:'none', fontWeight:700, boxShadow:'none', '&:hover':{ bgcolor:'#6d28d9', boxShadow:'none' } }}>
          {save.isPending ? tr('Saving…') : tr('Save Alert Rules')}
        </Button>
        {msg && <Typography sx={{ fontSize:12, color:'#16a34a', fontWeight:600 }}>✓ {msg}</Typography>}
        {err && <Alert severity="error" sx={{ fontSize:12 }}>{err}</Alert>}
      </Box>
    </SectionCard>
  )
}

/** 97.2 → "1m 37s" · 52.4 → "52s" · 3675 → "1h 1m" */
function fmtDur(sec: number | null | undefined): string {
  if (sec == null) return '-'
  const s = Math.round(Number(sec))
  if (s < 60)   return trf('{{n}}s', { n: s })
  if (s < 3600) return trf('{{m}}m {{s}}s', { m: Math.floor(s / 60), s: s % 60 })
  return trf('{{h}}h {{m}}m', { h: Math.floor(s / 3600), m: Math.floor((s % 3600) / 60) })
}


/* ── Sync History dialog: type/status/date filters + scrollable list ───────── */
function SyncHistoryDialog({ open, onClose, history, refetch, fetching }: {
  open: boolean; onClose: () => void; history: any[]
  refetch: () => void; fetching: boolean
}) {
  const [fType,   setFType]   = useState('all')
  const [fStatus, setFStatus] = useState('all')
  const [fFrom,   setFFrom]   = useState('')
  const [fTo,     setFTo]     = useState('')

  const rows = history.filter((r: any) => {
    if (fType   !== 'all' && r.run_type !== fType)  return false
    if (fStatus !== 'all' && r.status  !== fStatus) return false
    const started = (r.started_at ?? '').slice(0, 10)
    if (fFrom && started && started < fFrom) return false
    if (fTo   && started && started > fTo)   return false
    return true
  })

  const statusColor = (s: string) =>
    s === 'completed' ? '#16a34a' : s === 'error' ? '#ef4444'
    : s === 'cancelled' || s === 'aborted' ? '#f59e0b'
    : s === 'running' ? ACCENT : '#94a3b8'

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle sx={{ fontWeight:700, fontSize:16, pb:1 }}>{tr('Sync History')}</DialogTitle>
      <DialogContent dividers sx={{ p:2 }}>
        {/* Filters */}
        <Box sx={{ display:'flex', gap:1.5, flexWrap:'wrap', alignItems:'center', mb:2 }}>
          <FormControl size="small" sx={{ minWidth:130 }}>
            <InputLabel>{tr('Type')}</InputLabel>
            <Select value={fType} label={tr('Type')} onChange={e => setFType(String(e.target.value))}>
              {['all','range','full','incremental','scheduled'].map(t =>
                <MenuItem key={t} value={t}>{t === 'all' ? tr('All types') : tr(t)}</MenuItem>)}
            </Select>
          </FormControl>
          <FormControl size="small" sx={{ minWidth:140 }}>
            <InputLabel>{tr('Status')}</InputLabel>
            <Select value={fStatus} label={tr('Status')} onChange={e => setFStatus(String(e.target.value))}>
              {['all','completed','running','error','aborted','cancelled'].map(s =>
                <MenuItem key={s} value={s}>{s === 'all' ? tr('All statuses') : tr(s)}</MenuItem>)}
            </Select>
          </FormControl>
          <TextField label={tr('From')} type="date" size="small" sx={{ width:150 }}
            InputLabelProps={{ shrink:true }} value={fFrom} onChange={e => setFFrom(e.target.value)} />
          <TextField label={tr('To')} type="date" size="small" sx={{ width:150 }}
            InputLabelProps={{ shrink:true }} value={fTo} onChange={e => setFTo(e.target.value)} />
          <Box sx={{ flex:1 }} />
          <Button size="small" onClick={refetch} disabled={fetching}
            sx={{ textTransform:'none', color:ACCENT, fontWeight:600 }}>
            {fetching ? tr('Refreshing…') : tr('Refresh')}
          </Button>
        </Box>

        {/* Scrollable list — pr:2.5 keeps the scrollbar clear of the Duration column */}
        <Box sx={{ maxHeight:420, overflowY:'auto', pr:2.5,
                   scrollbarGutter:'stable' }}>
          <Box sx={{ display:'grid',
                     gridTemplateColumns:'0.8fr 0.8fr 1.6fr 1.2fr 0.9fr 0.6fr',
                     rowGap:0.7, columnGap:1.5, fontSize:12.5 }}>
            <Typography sx={{ fontWeight:700, color: 'var(--rt-text-2)', position:'sticky', top:0, bgcolor: 'var(--rt-surface)' }}>{tr('Type')}</Typography>
            <Typography sx={{ fontWeight:700, color: 'var(--rt-text-2)', position:'sticky', top:0, bgcolor: 'var(--rt-surface)' }}>{tr('By')}</Typography>
            <Typography sx={{ fontWeight:700, color: 'var(--rt-text-2)', position:'sticky', top:0, bgcolor: 'var(--rt-surface)' }}>{tr('Range')}</Typography>
            <Typography sx={{ fontWeight:700, color: 'var(--rt-text-2)', position:'sticky', top:0, bgcolor: 'var(--rt-surface)' }}>{tr('Started')}</Typography>
            <Typography sx={{ fontWeight:700, color: 'var(--rt-text-2)', position:'sticky', top:0, bgcolor: 'var(--rt-surface)' }}>{tr('Status')}</Typography>
            <Typography sx={{ fontWeight:700, color: 'var(--rt-text-2)', textAlign:'right', position:'sticky', top:0, bgcolor: 'var(--rt-surface)' }}>{tr('Duration')}</Typography>
            {rows.map((r: any) => (
              <Box key={r.run_id} sx={{ display:'contents' }}>
                <Typography sx={{ color: 'var(--rt-text)', fontWeight:600 }}>{tr(r.run_type)}</Typography>
                <Typography sx={{ color: 'var(--rt-text-2)' }}>{r.triggered_by}</Typography>
                <Typography sx={{ color:'#64748b', whiteSpace:'nowrap' }}>
                  {(r.date_from ?? '-')} → {(r.date_to ?? '-')}
                </Typography>
                <Typography sx={{ color:'#64748b', whiteSpace:'nowrap' }}>
                  {r.started_at ? new Date(r.started_at).toLocaleString('en-GB',
                    { day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit' }) : '-'}
                </Typography>
                <Typography sx={{ color:statusColor(r.status), fontWeight:600 }}>{tr(r.status)}</Typography>
                <Typography sx={{ color: 'var(--rt-text-2)', textAlign:'right' }}>{fmtDur(r.duration_sec)}</Typography>
              </Box>
            ))}
            {rows.length === 0 && (
              <Typography sx={{ gridColumn:'1 / -1', color:'#94a3b8', py:2, textAlign:'center' }}>
                {tr('No runs match the selected filters.')}
              </Typography>
            )}
          </Box>
        </Box>
      </DialogContent>
    </Dialog>
  )
}

// ── Accounting settings (Settings → Accounting, 2026-07-26) ─────────────────
// Rendered only when the accounting license domain AND the accounting
// customisation are available (gated in visibleCats). Everything here
// persists in settings.json → accounting via the two admin-gated PUTs:
//   PUT /api/accounting/class-roles — role overrides (the statement pages'
//     own endpoint, reused verbatim)
//   PUT /api/accounting/settings    — receivable/payable account lists +
//     report defaults
const ACCOUNT_ROLES: { v: string; l: string }[] = [
  { v: 'asset',     l: 'Asset' },
  { v: 'liability', l: 'Liability' },
  { v: 'equity',    l: 'Equity' },
  { v: 'revenue',   l: 'Revenue' },
  { v: 'cost',      l: 'Cost' },
]

function AccountingCard() {
  const qc = useQueryClient()

  const { data: settings } = useQuery({
    queryKey: ['settings'],
    queryFn:  () => axios.get('/api/settings').then(r => r.data),
    staleTime: 60_000,
  })
  const { data: status } = useQuery({
    queryKey: ['acc-status'],
    queryFn:  () => axios.get('/api/accounting/status').then(r => r.data),
    retry: false,
  })
  const { data: classRoles = [] } = useQuery<any[]>({
    queryKey: ['acc-class-roles'],
    queryFn:  () => axios.get('/api/accounting/class-roles').then(r => r.data),
    retry: false,
  })

  // ── Class-role overrides (saved per change — the same PUT the pages use) ──
  const [savingCls, setSavingCls] = useState<string | null>(null)
  const putRole = async (cls: string, role: string) => {
    setSavingCls(cls)
    try {
      await axios.put('/api/accounting/class-roles',
        { class_roles: { [cls]: role || null } })
      await qc.invalidateQueries({ queryKey: ['acc-class-roles'] })
      await qc.invalidateQueries({ queryKey: ['acc-status'] })
    } finally { setSavingCls(null) }
  }

  // ── Receivable / payable lists + report defaults ──
  const accTok = (o: any) => (typeof o === 'string' ? o : String(o?.account_code ?? ''))
  const [recv, setRecv] = useState<string[]>([])
  const [pay,  setPay]  = useState<string[]>([])
  const [defBasis, setDefBasis] = useState<'transaction' | 'posting'>('transaction')
  const [defUnbal, setDefUnbal] = useState(false)
  const seeded = useRef(false)
  // Last SAVED state — the reference the dirty check compares against and the
  // state Discard restores. Filled on seed, refreshed on every successful save.
  const base = useRef<{ recv: string[]; pay: string[]
                        basis: 'transaction' | 'posting'; unbal: boolean } | null>(null)
  useEffect(() => {
    // Seed once from the EFFECTIVE values (status carries the lists after
    // defaults, so the UI never duplicates the backend's default constants).
    if (seeded.current || !status || !settings) return
    seeded.current = true
    const recv0 = (status.receivable_accounts ?? []).map(String)
    const pay0  = (status.payable_accounts ?? []).map(String)
    setRecv(recv0)
    setPay(pay0)
    const acc = settings?.accounting || {}
    const basis0: 'transaction' | 'posting' =
      acc.default_date_basis === 'posting' ? 'posting' : 'transaction'
    if (basis0 === 'posting') setDefBasis('posting')
    setDefUnbal(!!acc.default_include_unbalanced)
    base.current = { recv: recv0, pay: pay0, basis: basis0,
                     unbal: !!acc.default_include_unbalanced }
  }, [status, settings])
  const dirty = !!base.current && (
    JSON.stringify(recv) !== JSON.stringify(base.current.recv) ||
    JSON.stringify(pay)  !== JSON.stringify(base.current.pay)  ||
    defBasis !== base.current.basis ||
    defUnbal !== base.current.unbal)
  const [saveMsg, setSaveMsg] = useState<string | null>(null)
  const saveAcct = useMutation({
    mutationFn: () => axios.put('/api/accounting/settings', {
      receivable_accounts: recv.filter(Boolean),
      payable_accounts:    pay.filter(Boolean),
      default_date_basis:  defBasis,
      default_include_unbalanced: defUnbal,
    }),
    onSuccess: () => {
      // The just-saved values become the new baseline — the bar disappears
      // and only the transient confirmation stays for a few seconds.
      base.current = { recv: [...recv], pay: [...pay], basis: defBasis, unbal: defUnbal }
      setSaveMsg(tr('Settings saved'))
      window.setTimeout(() => setSaveMsg(null), 4000)
      qc.invalidateQueries({ queryKey: ['settings'] })
      qc.invalidateQueries({ queryKey: ['acc-status'] })
      qc.invalidateQueries({ queryKey: ['acc-aging'] })
    },
    onError: (e: any) =>
      setSaveMsg(e?.response?.data?.detail?.toString?.() ?? tr('Save failed')),
  })
  const discard = () => {
    if (!base.current) return
    setRecv([...base.current.recv])
    setPay([...base.current.pay])
    setDefBasis(base.current.basis)
    setDefUnbal(base.current.unbal)
    setSaveMsg(null)
  }

  const unclassified = status?.unclassified_accounts ?? 0
  const roleSrcColor: Record<string, string> = {
    auto: '#16a34a', override: ACCENT, unmapped: '#f59e0b',
  }

  return (<>
    {/* ── Status block ── */}
    <SectionCard title="Accounting Status" icon={<InfoOutlinedIcon />}>
      <Box sx={{ display:'grid', gridTemplateColumns:{ xs:'1fr 1fr', md:'repeat(4, 1fr)' },
                 rowGap:1.2, columnGap:2, fontSize:12.5 }}>
        <Box>
          <Typography sx={{ fontSize:11, fontWeight:700, color:'var(--rt-text-2)', textTransform:'uppercase', letterSpacing:0.6 }}>{tr('GL Lines')}</Typography>
          <Typography sx={{ fontSize:15, fontWeight:700, color:'var(--rt-text)' }}>{(status?.gl_rows ?? 0).toLocaleString()}</Typography>
        </Box>
        <Box>
          <Typography sx={{ fontSize:11, fontWeight:700, color:'var(--rt-text-2)', textTransform:'uppercase', letterSpacing:0.6 }}>{tr('Documents')}</Typography>
          <Typography sx={{ fontSize:15, fontWeight:700, color:'var(--rt-text)' }}>{(status?.documents ?? 0).toLocaleString()}</Typography>
        </Box>
        <Box>
          <Typography sx={{ fontSize:11, fontWeight:700, color:'var(--rt-text-2)', textTransform:'uppercase', letterSpacing:0.6 }}>{tr('Period')}</Typography>
          <Typography sx={{ fontSize:13, fontWeight:600, color:'var(--rt-text)' }}>
            {status?.date_from ? `${status.date_from} → ${status.date_to ?? '-'}` : '-'}
          </Typography>
        </Box>
        <Box>
          <Typography sx={{ fontSize:11, fontWeight:700, color:'var(--rt-text-2)', textTransform:'uppercase', letterSpacing:0.6 }}>{tr('Last accounting sync')}</Typography>
          <Typography sx={{ fontSize:13, fontWeight:600, color:'var(--rt-text)' }}>
            {status?.last_sync ? new Date(status.last_sync).toLocaleString('en-GB',
              { day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit' }) : '-'}
          </Typography>
        </Box>
      </Box>
      {(status?.classified_accounts ?? 0) > 0 && (
        <Typography sx={{ mt:1.2, fontSize:12, color:'var(--rt-text-2)' }}>
          {trf('Classification: {{t}} from the Prism tree · {{d}} built-in defaults · {{u}} unclassified',
               { t: (status?.tree_classified_accounts ?? 0).toLocaleString(),
                 d: (status?.default_classified_accounts ?? 0).toLocaleString(),
                 u: (status?.unclassified_accounts ?? 0).toLocaleString() })}
        </Typography>
      )}
      {unclassified > 0 && (
        <Box sx={{ mt:1.5, px:1.5, py:1, borderRadius:2,
                   bgcolor:'rgba(245,158,11,0.10)', border:'1px solid rgba(245,158,11,0.35)' }}>
          <Typography sx={{ fontSize:12.5, fontWeight:600, color:'var(--rt-warn-fg)' }}>
            {trf('{{n}} accounts unclassified — place them in the accounting touch menu in Prism', { n: unclassified })}
          </Typography>
        </Box>
      )}
    </SectionCard>

    {/* ── Class → statement-role mapping ── */}
    <SectionCard title="Class Roles" icon={<AccountBalanceIcon />}>
      <Typography sx={{ fontSize:13, color:'var(--rt-text-2)', mb:1 }}>
        {tr('Every account class with its statement role. Roles drive the Profit & Loss and the Balance Sheet. Changes save immediately.')}
      </Typography>
      <Typography sx={{ fontSize:12, color:'var(--rt-text-2)', mb:2 }}>
        {trf('{{a}} of {{b}}', { a: (status?.classified_accounts ?? 0).toLocaleString(),
                                 b: (status?.accounts ?? 0).toLocaleString() })} · {tr('Classified accounts')}
      </Typography>
      <Box sx={{ display:'grid', gridTemplateColumns:'1.6fr 0.6fr 1fr 0.8fr',
                 rowGap:0.8, columnGap:2, fontSize:12.5, alignItems:'center', maxWidth:720 }}>
        <Typography sx={{ fontWeight:700, color:'var(--rt-text-2)' }}>{tr('Class')}</Typography>
        <Typography sx={{ fontWeight:700, color:'var(--rt-text-2)', textAlign:'right' }}>{tr('Accounts Used')}</Typography>
        <Typography sx={{ fontWeight:700, color:'var(--rt-text-2)' }}>{tr('Role')}</Typography>
        <Typography sx={{ fontWeight:700, color:'var(--rt-text-2)' }}>{tr('Source')}</Typography>
        {classRoles.map((r: any) => (
          <Box key={r.class} sx={{ display:'contents' }}>
            <Box sx={{ display:'flex', alignItems:'center', gap:0.6, flexWrap:'wrap' }}>
              <Typography sx={{ color:'var(--rt-text)', fontWeight:600 }}>{r.class}</Typography>
              {/* Some/all of this class's accounts were classified by the
                  BUILT-IN integration defaults, not the Prism tree. */}
              {(r.default_accounts ?? 0) > 0 && (
                <Chip label={tr('default')} size="small"
                  sx={{ height:16, fontSize:9, fontWeight:700, letterSpacing:0.3,
                        bgcolor:'var(--rt-surface-2)', color:'var(--rt-text-2)',
                        border:'1px solid var(--rt-border)',
                        '& .MuiChip-label':{ px:0.6 } }} />
              )}
            </Box>
            <Typography sx={{ color:'var(--rt-text-2)', textAlign:'right' }}>{(r.accounts ?? 0).toLocaleString()}</Typography>
            <Select size="small" value={r.role ?? ''} disabled={savingCls === r.class}
              onChange={e => putRole(r.class, String(e.target.value))}
              displayEmpty sx={{ fontSize:12.5, height:30 }}>
              <MenuItem value="" sx={{ fontSize:12.5 }}>{tr('Unclassified')}</MenuItem>
              {ACCOUNT_ROLES.map(o => (
                <MenuItem key={o.v} value={o.v} sx={{ fontSize:12.5 }}>{tr(o.l)}</MenuItem>
              ))}
            </Select>
            <Typography sx={{ fontSize:11.5, fontWeight:700,
                              color: roleSrcColor[r.source] ?? 'var(--rt-text-2)' }}>
              {savingCls === r.class ? tr('Saving…') : tr(r.source)}
            </Typography>
          </Box>
        ))}
        {classRoles.length === 0 && (
          <Typography sx={{ gridColumn:'1 / -1', color:'#94a3b8', py:1.5 }}>
            {tr('No data to display')}
          </Typography>
        )}
      </Box>
    </SectionCard>

    {/* ── Receivable / payable control accounts ── */}
    <SectionCard title="Receivable & Payable Accounts" icon={<ContactPageIcon />}>
      <Typography sx={{ fontSize:13, color:'var(--rt-text-2)', mb:2 }}>
        {tr('Used by the BP Statement to identify partner balances: only lines on these accounts count as a partner’s receivable or payable balance. Clear a list to fall back to class-role matching.')}
      </Typography>
      <Box sx={{ display:'flex', flexDirection:'column', gap:2, maxWidth:560 }}>
        <LabeledCtl label="Receivable accounts">
          <DataSlicer sx={{ width:'100%' }} value={recv}
            onChange={(v: any[]) => setRecv(v.map(accTok).filter(Boolean))}
            searchEndpoint="/api/accounting/search/accounts"
            getToken={accTok} placeholder="Account (code / name)"
            renderLabel={(o: any) => (typeof o === 'string' ? { code: o }
              : { code: String(o.account_code ?? ''),
                  rest: [o.name_en, o.name_ar].filter(Boolean).join(' | ') })} />
        </LabeledCtl>
        <LabeledCtl label="Payable accounts">
          <DataSlicer sx={{ width:'100%' }} value={pay}
            onChange={(v: any[]) => setPay(v.map(accTok).filter(Boolean))}
            searchEndpoint="/api/accounting/search/accounts"
            getToken={accTok} placeholder="Account (code / name)"
            renderLabel={(o: any) => (typeof o === 'string' ? { code: o }
              : { code: String(o.account_code ?? ''),
                  rest: [o.name_en, o.name_ar].filter(Boolean).join(' | ') })} />
        </LabeledCtl>
      </Box>
    </SectionCard>

    {/* ── Report defaults ── */}
    <SectionCard title="Report Defaults" icon={<TuneIcon />}>
      <Typography sx={{ fontSize:13, color:'var(--rt-text-2)', mb:2 }}>
        {tr('The accounting pages open with these defaults. Links that carry their own parameters still win.')}
      </Typography>
      <Box sx={{ display:'flex', alignItems:'center', gap:2, flexWrap:'wrap', rowGap:1.5 }}>
        <LabeledCtl label="Default date basis">
          <ToggleButtonGroup exclusive size="small" value={defBasis}
            onChange={(_, v) => { if (v) setDefBasis(v) }}
            sx={{ '& .MuiToggleButton-root': { px:2, fontWeight:700, fontSize:12, textTransform:'none' },
                  '& .Mui-selected': { bgcolor:`${ACCENT}18 !important`, color:`${ACCENT} !important` } }}>
            <ToggleButton value="transaction">{tr('Transaction date')}</ToggleButton>
            <ToggleButton value="posting">{tr('Posting date')}</ToggleButton>
          </ToggleButtonGroup>
        </LabeledCtl>
        <FormControlLabel sx={{ ml:1 }}
          control={<Switch size="small" checked={defUnbal}
            onChange={e => setDefUnbal(e.target.checked)}
            sx={{ '& .Mui-checked': { color: ACCENT },
                  '& .Mui-checked + .MuiSwitch-track': { bgcolor: `${ACCENT} !important` } }} />}
          label={<Typography sx={{ fontSize:13, fontWeight:600 }}>{tr('Include unbalanced documents by default')}</Typography>} />
      </Box>
    </SectionCard>

    {/* ── THE one sticky save bar for this tab. ALWAYS visible (owner report
           28 Jul: a bar that only appears once something is edited read as
           "the save bar disappeared"), and IDENTICAL in position and shape to
           the global Save Settings bar (owner request 28 Jul: same bar
           everywhere — full-width, flush bottom, same padding and shadow).
           Discard + the unsaved-changes hint still show only while there are
           edits. Covers BOTH sections above (R&P accounts + report
           defaults) — they save together through one endpoint. */}
    <Box sx={SAVE_BAR_SX}>
      <Button variant="contained" disabled={saveAcct.isPending}
        onClick={() => { setSaveMsg(null); saveAcct.mutate() }}
        sx={{ bgcolor:ACCENT, textTransform:'none', fontWeight:700, boxShadow:'none',
              px:3, '&:hover':{ bgcolor:'#6d28d9', boxShadow:'none' } }}>
        {saveAcct.isPending ? tr('Saving…') : tr('Save Accounting Settings')}
      </Button>
      {(dirty || saveAcct.isPending) && (<>
        <Button size="small" onClick={discard} disabled={saveAcct.isPending}
          sx={{ textTransform:'none', fontWeight:600, color:'var(--rt-text-2)' }}>
          {tr('Discard')}
        </Button>
        <Typography sx={{ fontSize:12, fontWeight:600, color:'var(--rt-text-2)' }}>
          {tr('You have unsaved accounting changes')}
        </Typography>
      </>)}
      <Box sx={{ flex:1 }} />
      {saveMsg && <Typography sx={{ fontSize:12, fontWeight:700,
        color: saveMsg === tr('Settings saved') ? '#16a34a' : 'var(--rt-neg-fg)' }}>
        {saveMsg === tr('Settings saved') ? '✓ ' : ''}{saveMsg}</Typography>}
    </Box>
  </>)
}
