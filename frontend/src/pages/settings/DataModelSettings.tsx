/**
 * Data Model Settings — admin panel
 */
import { useState, useEffect } from 'react'
import {
  Box, Card, CardContent, Typography, TextField, Button,
  Alert, CircularProgress, Select, MenuItem,
  FormControl, InputLabel, LinearProgress,
  ToggleButtonGroup, ToggleButton, Switch,
  Checkbox, FormGroup, FormControlLabel, Tooltip,
  Dialog, DialogTitle, DialogContent,
  Collapse, IconButton, Autocomplete,
  Tabs, Tab,
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
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import axios from 'axios'
import { useAppSettings, CURRENCIES, type ProductCodeField } from '../../context/AppSettings'
import { ITEM_FIELDS, itemFieldLabel } from '../../utils/itemFields'
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
const INCR_OPTIONS = [1, 3, 7, 14, 30]
const REFR_OPTIONS = [5, 10, 15, 30, 60, 120]

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

function SectionCard({ title, icon, children }:
  { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  // Collapsible: state remembered per section
  const storageKey = `settings-card-${title.replace(/\W+/g, '-')}`
  const [open, setOpen] = useState<boolean>(
    () => localStorage.getItem(storageKey) !== 'closed')
  const toggle = () => {
    setOpen(o => {
      localStorage.setItem(storageKey, o ? 'closed' : 'open')
      return !o
    })
  }
  return (
    <Card elevation={0} sx={{ border:'1px solid #e2e8f0', borderRadius:2, mb:3 }}>
      <CardContent sx={{ p:3, '&:last-child':{ pb: open ? 3 : 2 } }}>
        <Box onClick={toggle}
          sx={{ display:'flex', alignItems:'center', gap:1, mb: open ? 2.5 : 0,
                cursor:'pointer', userSelect:'none',
                '&:hover .sc-chevron': { color:'#0f172a' } }}>
          <Box sx={{ color:ACCENT }}>{icon}</Box>
          <Typography sx={{ fontWeight:700, fontSize:15, color:'#0f172a', flex:1 }}>{tr(title)}</Typography>
          <ExpandMoreIcon className="sc-chevron"
            sx={{ color:'#94a3b8', transition:'transform 0.2s',
                  transform: open ? 'rotate(180deg)' : 'rotate(0deg)' }} />
        </Box>
        <Collapse in={open} timeout={200}>{children}</Collapse>
      </CardContent>
    </Card>
  )
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

  const [conn, setConn] = useState({ host:'', port:1521, sid:'', username:'', password:'' })
  const [dm, setDm]     = useState<DataModelV2>(DEFAULT_DM)
  const [saveMsg, setSaveMsg]         = useState('')
  const [saveErr, setSaveErr]         = useState('')
  const [histOpen, setHistOpen]       = useState(false)
  const [selDomains, setSelDomains]   = useState<Set<string>>(new Set())  // empty = all
  const [rangeFrom, setRangeFrom]     = useState('')
  const [rangeTo,   setRangeTo]       = useState('')
  const [tab, setTab]                 = useState(0)   // Settings tab (UI grouping only)
  const [brandName, setBrandName]     = useState('')  // whitelabel product name
  const [brandLogo, setBrandLogo]     = useState('')  // base64 data-URL or empty
  const [autoMaint, setAutoMaint]     = useState(true) // weekly auto-maintenance

  useEffect(() => {
    if (settings) {
      setConn({ ...settings.connection })   // keep masked password so it persists
      // Backend GET always returns the migrated v2 shape; fall back defensively
      if (settings.data_model?.domains) setDm(settings.data_model)
      setBrandName(settings.brand_name ?? '')
      setBrandLogo(settings.brand_logo ?? '')
      setAutoMaint(settings.auto_maintenance !== false)
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

  const testConn = useMutation({
    mutationFn: () => axios.post('/api/settings/test-connection', conn),
  })

  const saveSettings = useMutation({
    mutationFn: () => axios.put('/api/settings', { connection: conn, data_model: dm,
      brand_name: brandName, brand_logo: brandLogo, auto_maintenance: autoMaint }),
    onSuccess: (res) => {
      setSaveErr('')
      qc.invalidateQueries({ queryKey:['settings'] })
      qc.invalidateQueries({ queryKey:['sync-status'] })
      if (res.data?.host_changed) {
        setSaveMsg(tr('Host changed — switched to new database. Run Load All Data to populate it.'))
      } else {
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
    mutationFn: () => {
      const tables = selDomains.size > 0 ? [...selDomains].join(',') : undefined
      return axios.post('/api/sync/full-load', null, { params: tables ? { tables } : {} })
    },
    onSuccess:  () => qc.invalidateQueries({ queryKey:['sync-status'] }),
  })

  const rangeLoad = useMutation({
    mutationFn: () => axios.post('/api/sync/range', {
      date_from: rangeFrom,
      date_to:   rangeTo,
      domains:   selDomains.size > 0 ? [...selDomains] : null,
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
    <Box sx={{ p:3, maxWidth:720,
               // Fix: notched-outline labels overlapped the border (legend gap
               // stayed collapsed after late font load) — force the notch open
               // for every shrunk label on this page.
               '& .MuiInputLabel-shrink ~ .MuiOutlinedInput-root .MuiOutlinedInput-notchedOutline legend':
                 { maxWidth: '100%' } }}>
      <Typography variant="h6" sx={{ fontWeight:700, color:'#0f172a', mb:0.5 }}>{tr('Settings')}<TitleLoader /></Typography>
      <Typography sx={{ fontSize:13, color:'#64748b', mb:3 }}>
        {tr('Configure Oracle connection and data model refresh behaviour.')}
      </Typography>

      {/* ── Tab bar (pure UI grouping — no settings logic changes) ── */}
      <Tabs value={tab} onChange={(_, v) => setTab(v)} variant="scrollable"
        scrollButtons="auto" allowScrollButtonsMobile
        sx={{ mb:3, minHeight:40,
              '& .MuiTab-root': { textTransform:'none', fontWeight:600, fontSize:13, minHeight:40, py:0.5 },
              '& .Mui-selected': { color:`${ACCENT} !important` },
              '& .MuiTabs-indicator': { bgcolor:ACCENT } }}>
        <Tab label={tr('Connection & Data')} />
        <Tab label={tr('Schedules')} />
        <Tab label={tr('Display')} />
        <Tab label={tr('Reports')} />
        <Tab label={tr('Maintenance')} />
      </Tabs>

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

      {/* ── Tab 2: Display ── */}
      <Box sx={{ display: tab === 2 ? 'block' : 'none' }}>

      {/* ── Display Settings ────────────────────────────────────── */}
      <SectionCard title="Display Settings" icon={<TuneIcon />}>
        <Typography sx={{ fontSize:13, color:'#475569', mb:2 }}>
          {tr('Choose which product code appears alongside the item description in charts and tables throughout the dashboard.')}
        </Typography>
        <Box sx={{ display:'flex', alignItems:'center', gap:2 }}>
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

        <Box sx={{ display:'flex', alignItems:'center', gap:2, mt:2.5 }}>
          <Typography sx={{ fontSize:13, fontWeight:600, color:'#374151', minWidth:110 }}>
            {tr('Currency')}
          </Typography>
          <FormControl size="small" sx={{ minWidth:230 }}>
            <Select value={currency.code}
              onChange={e => setCurrency(String(e.target.value))}>
              {CURRENCIES.map(c => (
                <MenuItem key={c.code} value={c.code}>
                  <Box component="span" sx={{ display:'inline-flex', alignItems:'center', gap:1 }}>
                    <Box component="span" sx={{ fontWeight:700, minWidth:28, textAlign:'center' }}>{c.symbol}</Box>
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
            label={<Typography sx={{ fontSize:12.5, color:'#475569' }}>{tr('Show sign on money values')}</Typography>}
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
            label={<Typography sx={{ fontSize:12.5, color:'#475569' }}>{tr('Abbreviate large numbers (1.2M / 340K)')}</Typography>}
          />
          <Typography sx={{ fontSize:12, color:'#94a3b8' }}>
            {abbreviateNumbers ? 'e.g. 1.23M' : `e.g. 1,234,${moneyDecimals === 2 ? '567.89' : '568'}`}
          </Typography>
        </Box>

        {/* ── Language / direction ── */}
        <Box sx={{ display:'flex', alignItems:'center', gap:2, mt:2.5 }}>
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
        <Box sx={{ mt:3, pt:2.5, borderTop:'1px solid #e2e8f0' }}>
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

      {/* ── Data Model ──────────────────────────────────────────── */}
      <SectionCard title="Data Model" icon={<SyncIcon />}>
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

        {/* Sync progress */}
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

        {/* Domain selector */}
        <Box sx={{ mb:2 }}>
          <Typography sx={{ fontSize:12, fontWeight:700, color:'#475569' }}>
            {tr('Manual load — one-time pull from Oracle')}
          </Typography>
          <Typography sx={{ fontSize:11.5, color:'#94a3b8', mb:1 }}>
            {tr('Runs once, right now. How far back each domain goes is its Load window in Refresh Schedules & Retention below. Tick domains to load only those — all unchecked = everything.')}
          </Typography>
          <FormGroup row sx={{ gap:1 }}>
            {DOMAINS.map(d => (
              <Tooltip key={d.key} title={tr(d.desc)} placement="top" arrow>
                <FormControlLabel
                  control={
                    <Checkbox
                      size="small"
                      checked={selDomains.has(d.key)}
                      onChange={e => {
                        const next = new Set(selDomains)
                        e.target.checked ? next.add(d.key) : next.delete(d.key)
                        setSelDomains(next)
                      }}
                      sx={{ color: ACCENT, '&.Mui-checked': { color: ACCENT }, p:'4px' }}
                    />
                  }
                  label={
                    <Typography sx={{ fontSize:13, fontWeight: selDomains.has(d.key) ? 700 : 400,
                                      color: selDomains.has(d.key) ? ACCENT : '#374151' }}>
                      {tr(d.label)}
                    </Typography>
                  }
                />
              </Tooltip>
            ))}
          </FormGroup>
        </Box>

        {/* Load action (contextual to the domain selection above) — the global
            Save Settings button lives in the sticky bar at the bottom */}
        <Box sx={{ display:'flex', gap:2, flexWrap:'wrap' }}>
          {!isRunning ? (
            <Button variant="outlined" size="small"
              onClick={() => fullLoad.mutate()}
              disabled={fullLoad.isPending}
              sx={{ borderColor:ACCENT, color:ACCENT, textTransform:'none', fontWeight:600,
                    '&:hover':{ borderColor:ACCENT, bgcolor:'rgba(124,58,237,0.04)' } }}>
              {selDomains.size > 0
                ? trf('Load {{d}} now', { d: [...selDomains].join(' + ') })
                : tr('Load All Data now')}
            </Button>
          ) : (
            <Button variant="outlined" size="small"
              startIcon={<StopIcon />}
              onClick={() => stopLoad.mutate()}
              disabled={stopLoad.isPending}
              sx={{ borderColor:'#ef4444', color:'#ef4444', textTransform:'none', fontWeight:600,
                    '&:hover':{ borderColor:'#dc2626', bgcolor:'rgba(239,68,68,0.04)' } }}>
              {tr('Stop Load')}
            </Button>
          )}
        </Box>
      </SectionCard>

      </Box>{/* end Tab 0 (part 2) */}

      {/* ── Tab 1: Schedules ── */}
      <Box sx={{ display: tab === 1 ? 'block' : 'none' }}>

      {/* ── Refresh Schedules & Retention (per domain) ───────────── */}
      <SectionCard title="Refresh Schedules & Retention" icon={<ScheduleIcon />}>
        <Typography sx={{ fontSize:13, color:'#475569', mb:2 }}>
          {tr('Controls the automatic refresh of each domain: at specific times on selected days, on a fixed interval, or manual only. The Load window here sets how far back that domain keeps data — it is also the period the manual Load now button above pulls. Retention prunes old line-item detail while keeping daily summaries forever. Times use the timezone selected above. Remember to Save Settings.')}
        </Typography>

        {DOMAINS.map(d => {
          const cfg = dm.domains[d.key]
          if (!cfg) return null
          const sch = cfg.schedule ?? { mode: 'manual' as const }
          return (
            <Box key={d.key}
              sx={{ border:'1px solid #e2e8f0', borderRadius:1.5, p:1.5, mb:1.5,
                    opacity: cfg.enabled ? 1 : 0.55 }}>
              <Box sx={{ display:'flex', alignItems:'center', gap:1.5, flexWrap:'wrap', mb:1 }}>
                <FormControlLabel sx={{ mr:0, minWidth:150 }}
                  control={
                    <Switch size="small" checked={cfg.enabled}
                      onChange={e => setDomain(d.key, { enabled: e.target.checked })} />
                  }
                  label={
                    <Tooltip title={tr(d.desc)} placement="top" arrow>
                      <Typography sx={{ fontSize:13.5, fontWeight:700, color:'#0f172a' }}>
                        {tr(d.label)}
                      </Typography>
                    </Tooltip>
                  }
                />
                <LabeledCtl label="Load window">
                  <FormControl size="small" sx={{ minWidth:150 }}>
                    <Select value={cfg.load_days}
                      onChange={e => setDomain(d.key, { load_days: +e.target.value })}>
                      {[...new Set([cfg.load_days, ...LOAD_OPTIONS])].sort((a, b) => a - b)
                        .map(v => <MenuItem key={v} value={v}>{trf('Last {{n}} days', { n: v })}</MenuItem>)}
                    </Select>
                  </FormControl>
                </LabeledCtl>
                <LabeledCtl label="Detail retention">
                  <FormControl size="small" sx={{ minWidth:165 }}>
                    <Select
                      value={cfg.retain_detail_months === null ? 'null' : cfg.retain_detail_months}
                      onChange={e => setDomain(d.key, {
                        retain_detail_months: e.target.value === 'null' ? null : +e.target.value })}>
                      {RETAIN_OPTIONS.map(o =>
                        <MenuItem key={String(o.v)} value={o.v === null ? 'null' : o.v}>{tr(o.l)}</MenuItem>)}
                    </Select>
                  </FormControl>
                </LabeledCtl>
              </Box>

              <Box sx={{ display:'flex', alignItems:'center', gap:1.5, flexWrap:'wrap' }}>
                <ToggleButtonGroup exclusive size="small" value={sch.mode}
                  onChange={(_, v) => { if (v) setSchedule(d.key, { mode: v }) }}
                  sx={{ '& .MuiToggleButton-root': { px:1.5, py:0.4, fontWeight:700, fontSize:11.5, textTransform:'none' },
                        '& .Mui-selected': { bgcolor:`${ACCENT}18 !important`, color:`${ACCENT} !important` } }}>
                  <ToggleButton value="manual">{tr('Manual')}</ToggleButton>
                  <ToggleButton value="interval">{tr('Interval')}</ToggleButton>
                  <ToggleButton value="times">{tr('Times')}</ToggleButton>
                </ToggleButtonGroup>

                {sch.mode === 'interval' && (
                  <FormControl size="small" sx={{ minWidth:130 }}>
                    <InputLabel>{tr('Every')}</InputLabel>
                    <Select value={sch.every_minutes ?? 30} label={tr('Every')}
                      onChange={e => setSchedule(d.key, { every_minutes: +e.target.value })}>
                      {[...new Set([sch.every_minutes ?? 30, ...REFR_OPTIONS])].sort((a, b) => a - b)
                        .map(m => <MenuItem key={m} value={m}>{trf('{{n}} min', { n: m })}</MenuItem>)}
                    </Select>
                  </FormControl>
                )}

                {sch.mode === 'times' && (
                  <>
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
                  </>
                )}

                {sch.mode === 'manual' && (
                  <Typography sx={{ fontSize:12, color:'#94a3b8' }}>
                    {tr('No automatic refresh — use Sync buttons or a range load.')}
                  </Typography>
                )}
              </Box>
            </Box>
          )
        })}
      </SectionCard>

      </Box>{/* end Tab 1 (part 1) */}

      {/* ── Tab 0: Connection & Data (part 3) ── */}
      <Box sx={{ display: tab === 0 ? 'block' : 'none' }}>

      {/* ── Load a specific date range ──────────────────────────── */}
      <SectionCard title="Load a Date Range" icon={<SyncIcon />}>
        <Typography sx={{ fontSize:13, color:'#475569', mb:2 }}>
          {tr('Load an explicit period (e.g. backfill older history). This appends to existing data — nothing is deleted. Respects the domain selection above.')}
        </Typography>
        <Box sx={{ display:'flex', alignItems:'center', gap:2, flexWrap:'wrap' }}>
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
      </SectionCard>

      {/* ── Loaded data coverage ────────────────────────────────── */}
      <SectionCard title="Loaded Data" icon={<StorageIcon />}>
        <Typography sx={{ fontSize:13, color:'#475569', mb:2 }}>
          {tr('The date span actually present in the warehouse, per domain.')}
        </Typography>
        <Box sx={{ display:'grid', gridTemplateColumns:'1.2fr 1fr 1fr 0.8fr',
                   rowGap:0.8, columnGap:2, fontSize:12.5 }}>
          <Typography sx={{ fontWeight:700, color:'#334155' }}>{tr('Domain')}</Typography>
          <Typography sx={{ fontWeight:700, color:'#334155' }}>{tr('From')}</Typography>
          <Typography sx={{ fontWeight:700, color:'#334155' }}>{tr('To')}</Typography>
          <Typography sx={{ fontWeight:700, color:'#334155', textAlign:'right' }}>{tr('Rows')}</Typography>
          {(coverage ?? []).map((c:any) => (
            <Box key={c.domain} sx={{ display:'contents' }}>
              <Typography sx={{ color:'#0f172a', fontWeight:600 }}>{c.domain}</Typography>
              <Typography sx={{ color:'#475569' }}>{c.from ?? '-'}</Typography>
              <Typography sx={{ color:'#475569' }}>{c.to ?? (c.synced_at ? tr('snapshot') : '-')}</Typography>
              <Typography sx={{ color:'#475569', textAlign:'right' }}>
                {(c.rows ?? 0).toLocaleString()}
              </Typography>
            </Box>
          ))}
        </Box>
      </SectionCard>

      </Box>{/* end Tab 0 (part 3) */}

      {/* ── Tab 1: Schedules (part 2 — Sync History) ── */}
      <Box sx={{ display: tab === 1 ? 'block' : 'none' }}>

      {/* ── Sync history — compact card + filterable dialog ─────── */}
      <SectionCard title="Sync History" icon={<SyncIcon />}>
        <Box sx={{ display:'flex', alignItems:'center', justifyContent:'space-between' }}>
          <Typography sx={{ fontSize:13, color:'#475569' }}>
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
      </SectionCard>
      {/* ── About & Diagnostics (read-only) ──────────────────────── */}
      <AboutCard />
      </Box>{/* end Tab 4 */}

      {/* ── Tab 3: Reports ── */}
      <Box sx={{ display: tab === 3 ? 'block' : 'none' }}>
      {/* ── Email (SMTP) ──────────────────────────────────────────── */}
      <EmailCard />

      {/* ── Scheduled reports (per-store, per-type) ──────────────── */}
      <ReportsCard />
      </Box>{/* end Tab 3 */}

      <SyncHistoryDialog open={histOpen} onClose={() => setHistOpen(false)}
        history={history ?? []} refetch={refetchHistory} fetching={histFetching} />

      {/* ── Sticky save bar — always visible, no more hunting mid-page ── */}
      <Box sx={{ position:'sticky', bottom:0, zIndex:10, mt:2, mx:-3, px:3, py:1.5,
                 bgcolor:'#ffffff', borderTop:'1px solid #e9e4ff',
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
      <Typography sx={{ fontSize:12.5, color:'#0f172a', fontWeight:600 }}>{value}</Typography>
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

/* ── Maintenance card: backup + compact ─────────────────────────────────────── */
function MaintenanceCard() {
  const [msg, setMsg] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [folder, setFolder] = useState('')

  const backup = useMutation({
    mutationFn: () => axios.post('/api/admin/backup', { dest_folder: folder.trim() || null }),
    onSuccess: r => { setErr(null); setMsg(trf('Backup saved: {{path}} ({{mb}} MB)', { path: r.data.path, mb: r.data.size_mb })) },
    onError: (e: any) => { setMsg(null); setErr(e?.response?.data?.detail ?? tr('Backup failed')) },
  })
  const compact = useMutation({
    mutationFn: () => axios.post('/api/admin/compact'),
    onSuccess: r => { setErr(null); setMsg(trf('Compacted: {{a}} MB → {{b}} MB', { a: r.data.before_mb, b: r.data.after_mb })) },
    onError: (e: any) => { setMsg(null); setErr(e?.response?.data?.detail ?? tr('Compact failed')) },
  })

  return (
    <SectionCard title="Maintenance" icon={<StorageIcon />}>
      <Typography sx={{ fontSize:13, color:'#475569', mb:2 }}>
        {tr('Back up the local warehouse file (safe while the app is running), or compact it to flush pending writes and reclaim space.')}
      </Typography>
      <Box sx={{ display:'flex', gap:2, alignItems:'flex-end', flexWrap:'wrap' }}>
        <LabeledCtl label="Backup folder (empty = backend/backups)">
          <TextField size="small" sx={{ minWidth:320 }} placeholder="D:\\RetailTecBackups"
            value={folder} onChange={e => setFolder(e.target.value)} />
        </LabeledCtl>
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
      {msg && <Typography sx={{ fontSize:12, color:'#16a34a', mt:1.5, fontWeight:600 }}>✓ {msg}</Typography>}
      {err && <Alert severity="error" sx={{ mt:1.5, fontSize:12 }}>{err}</Alert>}
    </SectionCard>
  )
}

/* ── Email (SMTP) card ───────────────────────────────────────────────────────── */
function EmailCard() {
  const [cfg, setCfg] = useState({ host:'', port:587, username:'', password:'',
                                   from_addr:'', use_tls:true, has_password:false })
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
      <Typography sx={{ fontSize:13, color:'#475569', mb:2 }}>
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
          label={<Typography sx={{ fontSize:12.5, color:'#475569' }}>{tr('Use TLS')}</Typography>} />
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
}

function ReportsCard() {
  const [reports, setReports] = useState<ReportDef[]>([])
  const [types,   setTypes]   = useState<Record<string, string>>({})
  const [msg, setMsg] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)

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
  }])

  return (
    <SectionCard title="Scheduled Reports" icon={<ScheduleIcon />}>
      <Typography sx={{ fontSize:13, color:'#475569', mb:2 }}>
        {tr('Each report has its own type, send time, store scope and recipients — e.g. a morning sales report for all stores to the owner, plus a separate one per branch manager scoped to their store. Uses the SMTP settings above. Remember to Save Report Schedules.')}
      </Typography>

      {reports.map((r, i) => (
        <Box key={r.id ?? i}
          sx={{ border:'1px solid #e2e8f0', borderRadius:1.5, p:1.5, mb:1.5,
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
            <LabeledCtl label="Report type">
              <FormControl size="small" sx={{ minWidth:230 }}>
                <Select value={r.type} onChange={e => upd(i, { type: String(e.target.value) })}>
                  {Object.entries(types).map(([k, label]) =>
                    <MenuItem key={k} value={k}>{label}</MenuItem>)}
                </Select>
              </FormControl>
            </LabeledCtl>
            <LabeledCtl label="Send at">
              <TextField size="small" type="time" sx={{ width:120 }} value={r.time}
                onChange={e => upd(i, { time: e.target.value })} />
            </LabeledCtl>
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

      <Box sx={{ display:'flex', gap:2 }}>
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
      </Box>

      {msg && <Typography sx={{ fontSize:12, color:'#16a34a', mt:1.5, fontWeight:600 }}>✓ {msg}</Typography>}
      {err && <Alert severity="error" sx={{ mt:1.5, fontSize:12 }}>{err}</Alert>}
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
            <Typography sx={{ fontWeight:700, color:'#334155', position:'sticky', top:0, bgcolor:'#fff' }}>{tr('Type')}</Typography>
            <Typography sx={{ fontWeight:700, color:'#334155', position:'sticky', top:0, bgcolor:'#fff' }}>{tr('By')}</Typography>
            <Typography sx={{ fontWeight:700, color:'#334155', position:'sticky', top:0, bgcolor:'#fff' }}>{tr('Range')}</Typography>
            <Typography sx={{ fontWeight:700, color:'#334155', position:'sticky', top:0, bgcolor:'#fff' }}>{tr('Started')}</Typography>
            <Typography sx={{ fontWeight:700, color:'#334155', position:'sticky', top:0, bgcolor:'#fff' }}>{tr('Status')}</Typography>
            <Typography sx={{ fontWeight:700, color:'#334155', textAlign:'right', position:'sticky', top:0, bgcolor:'#fff' }}>{tr('Duration')}</Typography>
            {rows.map((r: any) => (
              <Box key={r.run_id} sx={{ display:'contents' }}>
                <Typography sx={{ color:'#0f172a', fontWeight:600 }}>{r.run_type}</Typography>
                <Typography sx={{ color:'#475569' }}>{r.triggered_by}</Typography>
                <Typography sx={{ color:'#64748b', whiteSpace:'nowrap' }}>
                  {(r.date_from ?? '-')} → {(r.date_to ?? '-')}
                </Typography>
                <Typography sx={{ color:'#64748b', whiteSpace:'nowrap' }}>
                  {r.started_at ? new Date(r.started_at).toLocaleString('en-GB',
                    { day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit' }) : '-'}
                </Typography>
                <Typography sx={{ color:statusColor(r.status), fontWeight:600 }}>{r.status}</Typography>
                <Typography sx={{ color:'#475569', textAlign:'right' }}>{fmtDur(r.duration_sec)}</Typography>
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
