/**
 * Data Model Settings — admin panel
 */
import { useState, useEffect } from 'react'
import {
  Box, Card, CardContent, Typography, TextField, Button,
  Alert, CircularProgress, Select, MenuItem,
  FormControl, InputLabel, LinearProgress,
  ToggleButtonGroup, ToggleButton,
} from '@mui/material'
import CheckCircleIcon  from '@mui/icons-material/CheckCircle'
import ErrorIcon        from '@mui/icons-material/Error'
import SyncIcon         from '@mui/icons-material/Sync'
import StopIcon         from '@mui/icons-material/Stop'
import StorageIcon      from '@mui/icons-material/Storage'
import TuneIcon         from '@mui/icons-material/Tune'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import axios from 'axios'
import { useAppSettings, type ProductCodeField } from '../../context/AppSettings'

const ACCENT = '#7c3aed'

const LOAD_OPTIONS = [30, 90, 180, 365, 730]
const INCR_OPTIONS = [1, 3, 7, 14, 30]
const REFR_OPTIONS = [5, 10, 15, 30, 60, 120]

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
  const { productCodeField, setProductCodeField } = useAppSettings()

  const { data: settings, isLoading: loadingSettings } = useQuery({
    queryKey: ['settings'],
    queryFn:  () => axios.get('/api/settings').then(r => r.data),
  })

  const { data: syncState } = useQuery({
    queryKey: ['sync-status'],
    queryFn:  () => axios.get('/api/sync/status').then(r => r.data),
    refetchInterval: 2000,
  })

  const [conn, setConn] = useState({ host:'', port:1521, sid:'', username:'', password:'' })
  const [dm, setDm]     = useState({ initial_load_days:365, incremental_window_days:7, background_refresh_minutes:30 })
  const [saveMsg, setSaveMsg] = useState('')

  useEffect(() => {
    if (settings) {
      setConn({ ...settings.connection, password:'' })
      setDm(settings.data_model)
    }
  }, [settings])

  const testConn = useMutation({
    mutationFn: () => axios.post('/api/settings/test-connection', conn),
  })

  const saveSettings = useMutation({
    mutationFn: () => axios.put('/api/settings', { connection: conn, data_model: dm }),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey:['settings'] })
      qc.invalidateQueries({ queryKey:['sync-status'] })
      if (res.data?.host_changed) {
        setSaveMsg('Host changed — switched to new database. Run Load All Data to populate it.')
      } else {
        setSaveMsg('Settings saved')
      }
      setTimeout(() => setSaveMsg(''), 5000)
    },
  })

  const fullLoad = useMutation({
    mutationFn: () => axios.post('/api/sync/full-load'),
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
          <TextField label="SID / Service Name" size="small" fullWidth
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
      </SectionCard>

      {/* ── Data Model ──────────────────────────────────────────── */}
      <SectionCard title="Data Model" icon={<SyncIcon />}>
        <Box sx={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:2, mb:2.5 }}>
          <FormControl size="small" fullWidth>
            <InputLabel>Initial Load Period</InputLabel>
            <Select value={dm.initial_load_days} label="Initial Load Period"
              onChange={e => setDm({ ...dm, initial_load_days:+e.target.value })}>
              {LOAD_OPTIONS.map(d => <MenuItem key={d} value={d}>Last {d} days</MenuItem>)}
            </Select>
          </FormControl>
          <FormControl size="small" fullWidth>
            <InputLabel>Incremental Window</InputLabel>
            <Select value={dm.incremental_window_days} label="Incremental Window"
              onChange={e => setDm({ ...dm, incremental_window_days:+e.target.value })}>
              {INCR_OPTIONS.map(d => <MenuItem key={d} value={d}>Last {d} day{d>1?'s':''}</MenuItem>)}
            </Select>
          </FormControl>
          <FormControl size="small" fullWidth>
            <InputLabel>Background Refresh</InputLabel>
            <Select value={dm.background_refresh_minutes} label="Background Refresh"
              onChange={e => setDm({ ...dm, background_refresh_minutes:+e.target.value })}>
              {REFR_OPTIONS.map(m => <MenuItem key={m} value={m}>Every {m} min</MenuItem>)}
            </Select>
          </FormControl>
        </Box>

        {/* Sync progress */}
        {isRunning && (
          <Box sx={{ mb:2, p:1.5, bgcolor:'rgba(124,58,237,0.06)', borderRadius:1.5 }}>
            <Box sx={{ display:'flex', alignItems:'center', gap:1, mb:0.8 }}>
              <CircularProgress size={14} sx={{ color:ACCENT }} />
              <Typography sx={{ fontSize:13, fontWeight:600, color:ACCENT, flex:1 }}>
                {syncState.step}…
              </Typography>
              <Typography sx={{ fontSize:11, color:'#94a3b8' }}>
                {syncState.done}/{syncState.total} weeks
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
              Load All Data (last {dm.initial_load_days} days)
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
      </SectionCard>
    </Box>
  )
}
