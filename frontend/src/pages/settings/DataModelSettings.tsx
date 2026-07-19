/**
 * Data Model Settings — admin panel
 */
import { useState, useEffect } from 'react'
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
  Tabs, Tab, Chip,
} from '@mui/material'
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
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import axios from 'axios'
import { useAppSettings, CURRENCIES, type ProductCodeField } from '../../context/AppSettings'
import { ITEM_FIELDS, itemFieldLabel } from '../../utils/itemFields'
import { setSubsidiary } from '../../state/subsidiary'
import { tr, trf } from '../../i18n'
import TitleLoader from '../../components/TitleLoader'

const ACCENT = '#7c3aed'

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
  return m > 0 ? `~${m}m ${sec}s left` : `~${sec}s left`
}

const DOMAINS = [
  { key: 'sales',       label: 'Sales',       desc: 'Daily totals, invoices & line items' },
  { key: 'transfers',   label: 'Transfers',   desc: 'Store-to-store transfer slips' },
  { key: 'adjustments', label: 'Adjustments', desc: 'Inventory adjustment documents' },
  { key: 'inventory',   label: 'Inventory',   desc: 'On-hand quantity snapshot' },
  { key: 'purchases',   label: 'Purchases',   desc: 'Purchase orders & received lines' },
] as const

const LOAD_OPTIONS = [30, 90, 180, 365, 730, 1095]
const DAYS_LABEL: Record<number, string> = {
  30: 'Last 30 days', 90: 'Last 3 months', 180: 'Last 6 months',
  365: 'Last 1 year', 730: 'Last 2 years', 1095: 'Last 3 years',
}
const daysLabel = (v: number) => DAYS_LABEL[v] ? tr(DAYS_LABEL[v]) : trf('Last {{n}} days', { n: v })
// One shared template so the header and every row stay aligned
const DATA_GRID_COLS = 'minmax(118px,150px) minmax(88px,1fr) minmax(96px,1.1fr) minmax(88px,1fr) auto'
const INCR_OPTIONS = [1, 3, 7, 14, 30]
const REFR_OPTIONS = [5, 10, 15, 20, 30, 45, 60, 90, 120, 180, 240, 360, 480, 720, 1440]
// Friendly label for an interval in minutes (e.g. 90 → "1h 30m", 1440 → "24h").
const everyLabel = (m: number) =>
  m < 60 ? `${m} min` : (m % 60 === 0 ? `${m / 60}h` : `${Math.floor(m / 60)}h ${m % 60}m`)

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
  default_incremental_days: 7,
  domains: Object.fromEntries(DOMAINS.map(d => [d.key, {
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
      <Typography sx={{ fontSize:10.5, fontWeight:700, color:'#94a3b8',
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
  { i: 4, label: 'Maintenance',        desc: 'Backup, compact, about' },
]

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

  const dimsLoad = useMutation({
    mutationFn: () => axios.post('/api/sync/dimensions-load'),
    onSuccess:  () => qc.invalidateQueries({ queryKey:['sync-status'] }),
  })

  const rangeLoad = useMutation({
    mutationFn: () => axios.post('/api/sync/range', {
      date_from: rangeFrom,
      date_to:   rangeTo,
      domains:   null,
    }),
    onSuccess:  () => qc.invalidateQueries({ queryKey:['sync-status'] }),
  })

  const stopLoad = useMutation({
    mutationFn: () => axios.post('/api/sync/cancel'),
    onSuccess:  () => qc.invalidateQueries({ queryKey:['sync-status'] }),
  })

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
          {SETTINGS_CATS.map(c => (
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
            {SETTINGS_CATS.map(c => <MenuItem key={c.i} value={c.i}>{tr(c.label)}</MenuItem>)}
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
          </ToggleButtonGroup>
          <Typography sx={{ fontSize:12, color:'#94a3b8' }}>
            {productCodeField === 'alu'
              ? tr('Showing ALU (internal item code) · e.g. ALU001 | Blue Shirt')
              : tr('Showing UPC (barcode) · e.g. 123456789 | Blue Shirt')}
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
                    {c.name} ({c.code})
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
            {showCurrency ? `e.g. ${currency.symbol} 17.2M` : tr('e.g. 17.2M (no sign)')}
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
            {abbreviateNumbers ? 'e.g. 1.23M' : `e.g. 1,234,${moneyDecimals === 2 ? '567.89' : '568'}`}
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
              <Typography sx={{ fontSize:10.5, fontWeight:700, color:'#94a3b8',
                                textTransform:'uppercase', letterSpacing:0.6, lineHeight:1 }}>
                {tr('Logo')}
              </Typography>
              <Box sx={{ display:'flex', alignItems:'center', gap:1.5 }}>
                {brandLogo
                  ? <Box component="img" src={brandLogo} alt="logo"
                      sx={{ height:32, maxWidth:120, objectFit:'contain',
                            bgcolor:'#160b33', px:1, borderRadius:1 }} />
                  : <Typography sx={{ fontSize:12, color:'#94a3b8' }}>{tr('Default logo')}</Typography>}
                <Button component="label" variant="outlined" size="small"
                  sx={{ borderColor:ACCENT, color:ACCENT, textTransform:'none', fontWeight:600 }}>
                  {tr('Upload')}
                  <input hidden type="file" accept="image/*"
                    onChange={e => {
                      const f = e.target.files?.[0]
                      if (!f) return
                      const reader = new FileReader()
                      reader.onload = () => setBrandLogo(String(reader.result || ''))
                      reader.readAsDataURL(f)
                    }} />
                </Button>
                {brandLogo && (
                  <Button size="small" onClick={() => setBrandLogo('')}
                    sx={{ textTransform:'none', color:'#94a3b8' }}>
                    {tr('Remove')}
                  </Button>
                )}
              </Box>
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
            <Typography key={h} sx={{ fontSize:10.5, fontWeight:700, color:'#94a3b8',
                                      textTransform:'uppercase', letterSpacing:0.6 }}>
              {tr(h)}
            </Typography>
          ))}
          <span />
        </Box>

        {DOMAINS.map(d => {
          const cfg = dm.domains[d.key]
          if (!cfg) return null
          const sch = cfg.schedule ?? { mode: 'manual' as const }
          return (
            <Box key={d.key}
              sx={{ border:'1px solid var(--rt-border)', borderRadius:1.5, px:1.5, py:1, mb:1,
                    opacity: cfg.enabled ? 1 : 0.55 }}>
              <Box sx={{ display:'grid', alignItems:'center', gap:1,
                         gridTemplateColumns: DATA_GRID_COLS }}>
                <FormControlLabel sx={{ mr:0 }}
                  control={
                    <Switch size="small" checked={cfg.enabled}
                      onChange={e => setDomain(d.key, { enabled: e.target.checked })} />
                  }
                  label={
                    <Tooltip title={tr(d.desc)} placement="top" arrow>
                      <Typography sx={{ fontSize:13.5, fontWeight:700, color: 'var(--rt-text)' }}>
                        {tr(d.label)}
                      </Typography>
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
                <Button variant="outlined" size="small"
                  onClick={() => loadOne.mutate(d.key)}
                  disabled={isRunning || !cfg.enabled || loadOne.isPending}
                  sx={{ borderColor:ACCENT, color:ACCENT, textTransform:'none', fontWeight:600,
                        whiteSpace:'nowrap', minWidth:0, px:1.2,
                        '&:hover':{ borderColor:ACCENT, bgcolor:'rgba(124,58,237,0.04)' } }}>
                  {tr('Load now')}
                </Button>
              </Box>

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
                  {syncState.step}…
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
              <Button variant="outlined" size="small"
                onClick={() => rangeLoad.mutate()}
                disabled={isRunning || rangeLoad.isPending || !rangeFrom || !rangeTo}
                sx={{ borderColor:ACCENT, color:ACCENT, textTransform:'none', fontWeight:600,
                      '&:hover':{ borderColor:ACCENT, bgcolor:'rgba(124,58,237,0.04)' } }}>
                {tr('Load Range')}
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
              <Typography sx={{ color: 'var(--rt-text)', fontWeight:600 }}>{c.domain}</Typography>
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
              ? trf('Last run: {{type}} · {{status}}', { type: history[0].run_type, status: history[0].status }) +
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

        </Box>{/* end content column */}
      </Box>{/* end rail + content row */}

      <SyncHistoryDialog open={histOpen} onClose={() => setHistOpen(false)}
        history={history ?? []} refetch={refetchHistory} fetching={histFetching} />

      {/* ── Sticky save bar — always visible, no more hunting mid-page ── */}
      <Box sx={{ position:'sticky', bottom:0, zIndex:10, mt:2, mx:-3, px:3, py:1.5,
                 bgcolor: 'var(--rt-surface)', borderTop:'1px solid var(--rt-border)',
                 display:'flex', alignItems:'center', gap:2,
                 boxShadow:'0 -4px 12px rgba(15,23,42,0.06)' }}>
        <Button variant="contained"
          onClick={() => saveSettings.mutate()}
          disabled={saveSettings.isPending}
          sx={{ bgcolor:ACCENT, textTransform:'none', fontWeight:700, boxShadow:'none',
                px:3, '&:hover':{ bgcolor:'#6d28d9', boxShadow:'none' } }}>
          {saveSettings.isPending ? tr('Saving…') : tr('Save Settings')}
        </Button>
        <Typography sx={{ fontSize:12, color:'#94a3b8' }}>
          {tr('Applies connection, data model and schedule changes')}
        </Typography>
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
    </Box>
  )
}

/* ── About / Diagnostics card (read-only) ───────────────────────────────────── */
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
                      <MenuItem key={k} value={k}>{label}</MenuItem>)}
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
  if (s < 60)   return `${s}s`
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`
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
                <Typography sx={{ color: 'var(--rt-text)', fontWeight:600 }}>{r.run_type}</Typography>
                <Typography sx={{ color: 'var(--rt-text-2)' }}>{r.triggered_by}</Typography>
                <Typography sx={{ color:'#64748b', whiteSpace:'nowrap' }}>
                  {(r.date_from ?? '-')} → {(r.date_to ?? '-')}
                </Typography>
                <Typography sx={{ color:'#64748b', whiteSpace:'nowrap' }}>
                  {r.started_at ? new Date(r.started_at).toLocaleString('en-GB',
                    { day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit' }) : '-'}
                </Typography>
                <Typography sx={{ color:statusColor(r.status), fontWeight:600 }}>{r.status}</Typography>
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
