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
} from '@mui/material'
import CheckCircleIcon  from '@mui/icons-material/CheckCircle'
import ErrorIcon        from '@mui/icons-material/Error'
import SyncIcon         from '@mui/icons-material/Sync'
import StopIcon         from '@mui/icons-material/Stop'
import StorageIcon      from '@mui/icons-material/Storage'
import TuneIcon         from '@mui/icons-material/Tune'
import ScheduleIcon     from '@mui/icons-material/Schedule'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import axios from 'axios'
import { useAppSettings, CURRENCIES, type ProductCodeField } from '../../context/AppSettings'

const ACCENT = '#7c3aed'

const KIND_LABEL: Record<string, string> = {
  full: 'Full load', range: 'Range load', scheduled: 'Scheduled sync', incremental: 'Incremental refresh',
}
function etaText(s: any): string {
  if (!s?.started_at || !s?.done || !s?.total) return ''
  const pct = s.done / s.total
  if (pct <= 0.02) return 'estimating…'
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

function SectionCard({ title, icon, children }:
  { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <Card elevation={0} sx={{ border:'1px solid #e2e8f0', borderRadius:2, mb:3 }}>
      <CardContent sx={{ p:3, '&:last-child':{ pb:3 } }}>
        <Box sx={{ display:'flex', alignItems:'center', gap:1, mb:2.5 }}>
          <Box sx={{ color:ACCENT }}>{icon}</Box>
          <Typography sx={{ fontWeight:700, fontSize:15, color:'#0f172a' }}>{title}</Typography>
        </Box>
        {children}
      </CardContent>
    </Card>
  )
}

export default function DataModelSettings() {
  const qc = useQueryClient()
  const { productCodeField, setProductCodeField, currency, setCurrency } = useAppSettings()

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
    queryFn:  () => axios.get('/api/sync/history?limit=15').then(r => r.data.runs as any[]),
  })

  const [conn, setConn] = useState({ host:'', port:1521, sid:'', username:'', password:'' })
  const [dm, setDm]     = useState<DataModelV2>(DEFAULT_DM)
  const [saveMsg, setSaveMsg]         = useState('')
  const [saveErr, setSaveErr]         = useState('')
  const [selDomains, setSelDomains]   = useState<Set<string>>(new Set())  // empty = all
  const [rangeFrom, setRangeFrom]     = useState('')
  const [rangeTo,   setRangeTo]       = useState('')

  useEffect(() => {
    if (settings) {
      setConn({ ...settings.connection })   // keep masked password so it persists
      // Backend GET always returns the migrated v2 shape; fall back defensively
      if (settings.data_model?.domains) setDm(settings.data_model)
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
    mutationFn: () => axios.put('/api/settings', { connection: conn, data_model: dm }),
    onSuccess: (res) => {
      setSaveErr('')
      qc.invalidateQueries({ queryKey:['settings'] })
      qc.invalidateQueries({ queryKey:['sync-status'] })
      if (res.data?.host_changed) {
        setSaveMsg('Host changed — switched to new database. Run Load All Data to populate it.')
      } else {
        setSaveMsg('Settings saved')
      }
      setTimeout(() => setSaveMsg(''), 5000)
    },
    onError: (err: any) => {
      const detail = err?.response?.data?.detail
      const msg = Array.isArray(detail)
        ? detail.map((d: any) => d.msg ?? JSON.stringify(d)).join(' · ')
        : (detail ?? 'Save failed')
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
    <Box sx={{ p:3, maxWidth:720 }}>
      <Typography variant="h6" sx={{ fontWeight:700, color:'#0f172a', mb:0.5 }}>Settings</Typography>
      <Typography sx={{ fontSize:13, color:'#64748b', mb:3 }}>
        Configure Oracle connection and data model refresh behaviour.
      </Typography>

      {/* ── Connection ──────────────────────────────────────────── */}
      <SectionCard title="Database Connection" icon={<StorageIcon />}>
        <Box sx={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:2, mb:2 }}>
          <TextField label="Host IP / Hostname" size="small" fullWidth
            value={conn.host} onChange={e => setConn({ ...conn, host:e.target.value })} />
          <TextField label="Port" size="small" type="number" fullWidth
            value={conn.port} onChange={e => setConn({ ...conn, port:+e.target.value })} />
          <TextField label="Service Name" size="small" fullWidth
            placeholder="e.g. rproods"
            value={conn.sid} onChange={e => setConn({ ...conn, sid:e.target.value })} />
          <TextField label="Username" size="small" fullWidth
            value={conn.username} onChange={e => setConn({ ...conn, username:e.target.value })} />
          <TextField label="Password" size="small" type="password" fullWidth
            placeholder="Enter to change password"
            value={conn.password} onChange={e => setConn({ ...conn, password:e.target.value })} />
        </Box>

        <Box sx={{ display:'flex', alignItems:'center', gap:2 }}>
          <Button variant="outlined" size="small" onClick={() => testConn.mutate()}
            disabled={testConn.isPending}
            sx={{ borderColor:ACCENT, color:ACCENT, textTransform:'none', fontWeight:600,
                  '&:hover':{ borderColor:ACCENT, bgcolor:'rgba(124,58,237,0.04)' } }}>
            {testConn.isPending ? <CircularProgress size={14} sx={{ mr:1 }} /> : null}
            Test Connection
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
                {(testConn.error as any)?.response?.data?.detail ?? 'Connection failed'}
              </Typography>
            </Box>
          )}
        </Box>
      </SectionCard>

      {/* ── Display Settings ────────────────────────────────────── */}
      <SectionCard title="Display Settings" icon={<TuneIcon />}>
        <Typography sx={{ fontSize:13, color:'#475569', mb:2 }}>
          Choose which product code appears alongside the item description
          in charts and tables throughout the dashboard.
        </Typography>
        <Box sx={{ display:'flex', alignItems:'center', gap:2 }}>
          <Typography sx={{ fontSize:13, fontWeight:600, color:'#374151', minWidth:110 }}>
            Product Code Field
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
              ? 'Showing ALU (internal item code) · e.g. ALU001 | Blue Shirt'
              : 'Showing UPC (barcode) · e.g. 123456789 | Blue Shirt'}
          </Typography>
        </Box>

        <Box sx={{ display:'flex', alignItems:'center', gap:2, mt:2.5 }}>
          <Typography sx={{ fontSize:13, fontWeight:600, color:'#374151', minWidth:110 }}>
            Currency
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
          <Typography sx={{ fontSize:12, color:'#94a3b8' }}>
            Shown next to money values · e.g. {currency.symbol} 17.2M
          </Typography>
        </Box>
      </SectionCard>

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
            label={<Typography sx={{ fontSize:13, fontWeight:600 }}>Background sync</Typography>}
          />
          <FormControl size="small" sx={{ minWidth:190 }}>
            <InputLabel>Timezone</InputLabel>
            <Select value={dm.timezone} label="Timezone"
              onChange={e => setDm({ ...dm, timezone: String(e.target.value) })}>
              {[...new Set([dm.timezone, ...TIMEZONES])].map(tz =>
                <MenuItem key={tz} value={tz}>{tz}</MenuItem>)}
            </Select>
          </FormControl>
          <FormControl size="small" sx={{ minWidth:170 }}>
            <InputLabel>Incremental Overlap</InputLabel>
            <Select value={dm.default_incremental_days} label="Incremental Overlap"
              onChange={e => setDm({ ...dm, default_incremental_days:+e.target.value })}>
              {INCR_OPTIONS.map(d => <MenuItem key={d} value={d}>Last {d} day{d>1?'s':''}</MenuItem>)}
            </Select>
          </FormControl>
        </Box>
        <Box sx={{ display:'flex', alignItems:'center', gap:2, flexWrap:'wrap', mb:2.5 }}>
          <FormControlLabel
            control={
              <Checkbox size="small" checked={!!dm.quiet_hours}
                onChange={e => setDm({ ...dm,
                  quiet_hours: e.target.checked ? { from:'08:00', to:'18:00' } : null })}
                sx={{ color: ACCENT, '&.Mui-checked': { color: ACCENT } }} />
            }
            label={<Typography sx={{ fontSize:13 }}>Quiet hours (no background sync)</Typography>}
          />
          {dm.quiet_hours && (
            <>
              <TextField label="From" type="time" size="small" sx={{ width:130 }}
                InputLabelProps={{ shrink:true }}
                value={dm.quiet_hours.from}
                onChange={e => setDm({ ...dm, quiet_hours: { ...dm.quiet_hours!, from: e.target.value } })} />
              <TextField label="To" type="time" size="small" sx={{ width:130 }}
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
                {KIND_LABEL[syncState.kind] || 'Sync'}
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
            Last sync: {new Date(syncState.last_sync).toLocaleString()}
          </Typography>
        )}

        {/* Domain selector */}
        <Box sx={{ mb:2 }}>
          <Typography sx={{ fontSize:12, fontWeight:600, color:'#475569', mb:1 }}>
            Domains to load
            <Typography component="span" sx={{ fontSize:11, color:'#94a3b8', ml:1, fontWeight:400 }}>
              (leave all unchecked to load everything)
            </Typography>
          </Typography>
          <FormGroup row sx={{ gap:1 }}>
            {DOMAINS.map(d => (
              <Tooltip key={d.key} title={d.desc} placement="top" arrow>
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
                      {d.label}
                    </Typography>
                  }
                />
              </Tooltip>
            ))}
          </FormGroup>
        </Box>

        {/* Action buttons */}
        <Box sx={{ display:'flex', gap:2, flexWrap:'wrap' }}>
          <Button variant="contained" size="small"
            onClick={() => saveSettings.mutate()}
            disabled={saveSettings.isPending}
            sx={{ bgcolor:ACCENT, textTransform:'none', fontWeight:600, boxShadow:'none',
                  '&:hover':{ bgcolor:'#6d28d9', boxShadow:'none' } }}>
            Save Settings
          </Button>

          {!isRunning ? (
            <Button variant="outlined" size="small"
              onClick={() => fullLoad.mutate()}
              disabled={fullLoad.isPending}
              sx={{ borderColor:ACCENT, color:ACCENT, textTransform:'none', fontWeight:600,
                    '&:hover':{ borderColor:ACCENT, bgcolor:'rgba(124,58,237,0.04)' } }}>
              {selDomains.size > 0
                ? `Load ${[...selDomains].join(' + ')} (last ${dm.domains.sales?.load_days ?? 365} days)`
                : `Load All Data (last ${dm.domains.sales?.load_days ?? 365} days)`}
            </Button>
          ) : (
            <Button variant="outlined" size="small"
              startIcon={<StopIcon />}
              onClick={() => stopLoad.mutate()}
              disabled={stopLoad.isPending}
              sx={{ borderColor:'#ef4444', color:'#ef4444', textTransform:'none', fontWeight:600,
                    '&:hover':{ borderColor:'#dc2626', bgcolor:'rgba(239,68,68,0.04)' } }}>
              Stop Load
            </Button>
          )}
        </Box>

        {saveMsg && (
          <Typography sx={{ fontSize:12, color: saveMsg.includes('Host') ? '#f59e0b' : '#16a34a',
                            mt:1, fontWeight:600 }}>
            {saveMsg.includes('Host') ? '⚠ ' : '✓ '}{saveMsg}
          </Typography>
        )}
        {saveErr && (
          <Alert severity="error" sx={{ mt:1, fontSize:12 }}>{saveErr}</Alert>
        )}
      </SectionCard>

      {/* ── Refresh Schedules & Retention (per domain) ───────────── */}
      <SectionCard title="Refresh Schedules & Retention" icon={<ScheduleIcon />}>
        <Typography sx={{ fontSize:13, color:'#475569', mb:2 }}>
          Each domain refreshes on its own schedule: specific times on
          selected days, a fixed interval, or manual only. Retention prunes old
          line-item detail while keeping daily summaries forever.
          Times use the timezone selected above. Remember to <b>Save Settings</b>.
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
                    <Tooltip title={d.desc} placement="top" arrow>
                      <Typography sx={{ fontSize:13.5, fontWeight:700, color:'#0f172a' }}>
                        {d.label}
                      </Typography>
                    </Tooltip>
                  }
                />
                <FormControl size="small" sx={{ minWidth:150 }}>
                  <InputLabel>Load window</InputLabel>
                  <Select value={cfg.load_days} label="Load window"
                    onChange={e => setDomain(d.key, { load_days: +e.target.value })}>
                    {[...new Set([cfg.load_days, ...LOAD_OPTIONS])].sort((a, b) => a - b)
                      .map(v => <MenuItem key={v} value={v}>Last {v} days</MenuItem>)}
                  </Select>
                </FormControl>
                <FormControl size="small" sx={{ minWidth:165 }}>
                  <InputLabel>Detail retention</InputLabel>
                  <Select
                    value={cfg.retain_detail_months === null ? 'null' : cfg.retain_detail_months}
                    label="Detail retention"
                    onChange={e => setDomain(d.key, {
                      retain_detail_months: e.target.value === 'null' ? null : +e.target.value })}>
                    {RETAIN_OPTIONS.map(o =>
                      <MenuItem key={String(o.v)} value={o.v === null ? 'null' : o.v}>{o.l}</MenuItem>)}
                  </Select>
                </FormControl>
              </Box>

              <Box sx={{ display:'flex', alignItems:'center', gap:1.5, flexWrap:'wrap' }}>
                <ToggleButtonGroup exclusive size="small" value={sch.mode}
                  onChange={(_, v) => { if (v) setSchedule(d.key, { mode: v }) }}
                  sx={{ '& .MuiToggleButton-root': { px:1.5, py:0.4, fontWeight:700, fontSize:11.5, textTransform:'none' },
                        '& .Mui-selected': { bgcolor:`${ACCENT}18 !important`, color:`${ACCENT} !important` } }}>
                  <ToggleButton value="manual">Manual</ToggleButton>
                  <ToggleButton value="interval">Interval</ToggleButton>
                  <ToggleButton value="times">Times</ToggleButton>
                </ToggleButtonGroup>

                {sch.mode === 'interval' && (
                  <FormControl size="small" sx={{ minWidth:130 }}>
                    <InputLabel>Every</InputLabel>
                    <Select value={sch.every_minutes ?? 30} label="Every"
                      onChange={e => setSchedule(d.key, { every_minutes: +e.target.value })}>
                      {[...new Set([sch.every_minutes ?? 30, ...REFR_OPTIONS])].sort((a, b) => a - b)
                        .map(m => <MenuItem key={m} value={m}>{m} min</MenuItem>)}
                    </Select>
                  </FormControl>
                )}

                {sch.mode === 'times' && (
                  <>
                    <TextField label="Times (HH:MM, comma-separated)" size="small" sx={{ minWidth:230 }}
                      placeholder="06:00, 12:00, 18:00"
                      value={(sch.times ?? []).join(', ')}
                      onChange={e => setSchedule(d.key, {
                        times: e.target.value.split(',').map(t => t.trim()).filter(Boolean) })} />
                    <ToggleButtonGroup size="small" value={sch.days ?? [...WEEKDAYS]}
                      onChange={(_, v: string[]) => setSchedule(d.key, {
                        days: v.length === 0 || v.length === 7 ? null : v })}
                      sx={{ flexWrap:'wrap',
                            '& .MuiToggleButton-root': { px:1, py:0.3, fontSize:11, fontWeight:700, textTransform:'none' },
                            '& .Mui-selected': { bgcolor:`${ACCENT}18 !important`, color:`${ACCENT} !important` } }}>
                      {WEEKDAYS.map(w => <ToggleButton key={w} value={w}>{w}</ToggleButton>)}
                    </ToggleButtonGroup>
                  </>
                )}

                {sch.mode === 'manual' && (
                  <Typography sx={{ fontSize:12, color:'#94a3b8' }}>
                    No automatic refresh — use Sync buttons or a range load.
                  </Typography>
                )}
              </Box>
            </Box>
          )
        })}
      </SectionCard>

      {/* ── Load a specific date range ──────────────────────────── */}
      <SectionCard title="Load a Date Range" icon={<SyncIcon />}>
        <Typography sx={{ fontSize:13, color:'#475569', mb:2 }}>
          Load an explicit period (e.g. backfill older history). This <b>appends</b> to
          existing data — nothing is deleted. Respects the domain selection above.
        </Typography>
        <Box sx={{ display:'flex', alignItems:'center', gap:2, flexWrap:'wrap' }}>
          <TextField label="From" type="date" size="small"
            InputLabelProps={{ shrink:true }}
            value={rangeFrom} onChange={e => setRangeFrom(e.target.value)} />
          <TextField label="To" type="date" size="small"
            InputLabelProps={{ shrink:true }}
            value={rangeTo} onChange={e => setRangeTo(e.target.value)} />
          <Button variant="outlined" size="small"
            onClick={() => rangeLoad.mutate()}
            disabled={isRunning || rangeLoad.isPending || !rangeFrom || !rangeTo}
            sx={{ borderColor:ACCENT, color:ACCENT, textTransform:'none', fontWeight:600,
                  '&:hover':{ borderColor:ACCENT, bgcolor:'rgba(124,58,237,0.04)' } }}>
            Load Range
          </Button>
        </Box>
      </SectionCard>

      {/* ── Loaded data coverage ────────────────────────────────── */}
      <SectionCard title="Loaded Data" icon={<StorageIcon />}>
        <Typography sx={{ fontSize:13, color:'#475569', mb:2 }}>
          The date span actually present in the warehouse, per domain.
        </Typography>
        <Box sx={{ display:'grid', gridTemplateColumns:'1.2fr 1fr 1fr 0.8fr',
                   rowGap:0.8, columnGap:2, fontSize:12.5 }}>
          <Typography sx={{ fontWeight:700, color:'#334155' }}>Domain</Typography>
          <Typography sx={{ fontWeight:700, color:'#334155' }}>From</Typography>
          <Typography sx={{ fontWeight:700, color:'#334155' }}>To</Typography>
          <Typography sx={{ fontWeight:700, color:'#334155', textAlign:'right' }}>Rows</Typography>
          {(coverage ?? []).map((c:any) => (
            <Box key={c.domain} sx={{ display:'contents' }}>
              <Typography sx={{ color:'#0f172a', fontWeight:600 }}>{c.domain}</Typography>
              <Typography sx={{ color:'#475569' }}>{c.from ?? '-'}</Typography>
              <Typography sx={{ color:'#475569' }}>{c.to ?? (c.synced_at ? 'snapshot' : '-')}</Typography>
              <Typography sx={{ color:'#475569', textAlign:'right' }}>
                {(c.rows ?? 0).toLocaleString()}
              </Typography>
            </Box>
          ))}
        </Box>
      </SectionCard>

      {/* ── Sync history ─────────────────────────────────────────── */}
      <SectionCard title="Sync History" icon={<SyncIcon />}>
        <Box sx={{ display:'flex', justifyContent:'flex-end', mb:1 }}>
          <Button size="small" onClick={() => refetchHistory()} disabled={histFetching}
            sx={{ textTransform:'none', color:ACCENT, fontWeight:600 }}>
            {histFetching ? 'Refreshing…' : 'Refresh'}
          </Button>
        </Box>
        <Box sx={{ display:'grid', gridTemplateColumns:'0.7fr 0.9fr 1.5fr 0.9fr 0.6fr',
                   rowGap:0.6, columnGap:1.5, fontSize:12 }}>
          <Typography sx={{ fontWeight:700, color:'#334155' }}>Type</Typography>
          <Typography sx={{ fontWeight:700, color:'#334155' }}>By</Typography>
          <Typography sx={{ fontWeight:700, color:'#334155' }}>Range</Typography>
          <Typography sx={{ fontWeight:700, color:'#334155' }}>Status</Typography>
          <Typography sx={{ fontWeight:700, color:'#334155', textAlign:'right' }}>Secs</Typography>
          {(history ?? []).map((r:any) => (
            <Box key={r.run_id} sx={{ display:'contents' }}>
              <Typography sx={{ color:'#0f172a', fontWeight:600 }}>{r.run_type}</Typography>
              <Typography sx={{ color:'#475569' }}>{r.triggered_by}</Typography>
              <Typography sx={{ color:'#64748b' }}>{(r.date_from ?? '-')} → {(r.date_to ?? '-')}</Typography>
              <Typography sx={{ color: r.status==='completed' ? '#16a34a'
                                     : r.status==='error' ? '#ef4444'
                                     : r.status==='cancelled' ? '#f59e0b' : '#94a3b8', fontWeight:600 }}>
                {r.status}
              </Typography>
              <Typography sx={{ color:'#475569', textAlign:'right' }}>{r.duration_sec ?? '-'}</Typography>
            </Box>
          ))}
          {(!history || history.length === 0) && (
            <Typography sx={{ gridColumn:'1 / -1', color:'#94a3b8', py:1 }}>No sync runs yet.</Typography>
          )}
        </Box>
      </SectionCard>
    </Box>
  )
}
