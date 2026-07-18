/**
 * FirstRunWizard — shown once, on a fresh install (no successful sync yet).
 * Reuses the existing settings / test-connection / full-load endpoints; it
 * adds NO new backend logic. Fully skippable. On completion (or skip) it sets
 * setup_complete=true so it never shows again.
 */
import { useState } from 'react'
import {
  Dialog, Box, Typography, TextField, Button, Stepper, Step, StepLabel,
  Select, MenuItem, FormControl, InputLabel, CircularProgress, Alert,
} from '@mui/material'
import { useQueryClient } from '@tanstack/react-query'
import axios from 'axios'
import { tr } from '../i18n'

const ACCENT = '#7c3aed'
const STEPS = ['Connect Oracle', 'Test', 'History window', 'Load']

// Minimal v2 data_model so PUT /api/settings validates. Domains use safe
// defaults; the backend migrates/fills anything omitted.
const MIN_DM = {
  schema_version: 2, background_enabled: true, timezone: 'UTC',
  quiet_hours: null, default_incremental_days: 7,
  domains: {
    sales:       { enabled: true, load_days: 365, detail: true,  retain_detail_months: 24,   schedule: { mode: 'manual' } },
    inventory:   { enabled: true, load_days: 90,  detail: false, retain_detail_months: null, schedule: { mode: 'manual' } },
    purchases:   { enabled: true, load_days: 365, detail: true,  retain_detail_months: null, schedule: { mode: 'manual' } },
    transfers:   { enabled: true, load_days: 365, detail: true,  retain_detail_months: null, schedule: { mode: 'manual' } },
    adjustments: { enabled: true, load_days: 365, detail: true,  retain_detail_months: null, schedule: { mode: 'manual' } },
  },
}

export default function FirstRunWizard({ onDone }: { onDone: () => void }) {
  const qc = useQueryClient()
  const [step, setStep]   = useState(0)
  const [conn, setConn]   = useState({ host:'', port:1521, sid:'', username:'', password:'' })
  const [days, setDays]   = useState(365)
  const [busy, setBusy]   = useState(false)
  const [msg,  setMsg]    = useState<string | null>(null)
  const [err,  setErr]    = useState<string | null>(null)

  const markComplete = async () => {
    try { await axios.put('/api/settings', { connection: conn, data_model: MIN_DM, setup_complete: true }) }
    catch { /* ignore — flag is best-effort */ }
    qc.invalidateQueries({ queryKey: ['settings'] })
    onDone()
  }

  const skip = async () => {
    // Persist just the flag if possible; never block on failure.
    try { await axios.put('/api/settings', { connection: conn, data_model: MIN_DM, setup_complete: true }) } catch { /* ignore */ }
    qc.invalidateQueries({ queryKey: ['settings'] })
    onDone()
  }

  const testConn = async () => {
    setBusy(true); setErr(null); setMsg(null)
    try {
      const r = await axios.post('/api/settings/test-connection', conn)
      setMsg(r.data?.message ?? tr('Connected'))
      setStep(2)
    } catch (e: any) {
      setErr(e?.response?.data?.detail ?? tr('Connection failed'))
    } finally { setBusy(false) }
  }

  const doLoad = async () => {
    setBusy(true); setErr(null); setMsg(null)
    try {
      const dm = { ...MIN_DM, domains: Object.fromEntries(
        Object.entries(MIN_DM.domains).map(([k, v]) => [k, { ...v, load_days: days }])) }
      await axios.put('/api/settings', { connection: conn, data_model: dm, setup_complete: true })
      await axios.post('/api/sync/full-load')
      setMsg(tr('Initial load started — you can follow progress in Settings.'))
      qc.invalidateQueries({ queryKey: ['sync-status'] })
      setTimeout(markComplete, 1200)
    } catch (e: any) {
      setErr(e?.response?.data?.detail ?? tr('Load failed'))
      setBusy(false)
    }
  }

  return (
    <Dialog open maxWidth="sm" fullWidth PaperProps={{ sx: { borderRadius: 3, p: 1 } }}>
      <Box sx={{ p: 3 }}>
        <Typography sx={{ fontWeight: 800, fontSize: 18, mb: 0.5 }}>
          {tr('Welcome to RetailTec Analytics')}
        </Typography>
        <Typography sx={{ fontSize: 13, color: '#64748b', mb: 2.5 }}>
          {tr('Connect your Retail Pro Oracle database and load the first history window. You can change everything later in Settings.')}
        </Typography>

        <Stepper activeStep={step} sx={{ mb: 3,
          '& .MuiStepIcon-root.Mui-active': { color: ACCENT },
          '& .MuiStepIcon-root.Mui-completed': { color: ACCENT } }}>
          {STEPS.map(s => <Step key={s}><StepLabel>{tr(s)}</StepLabel></Step>)}
        </Stepper>

        {err && <Alert severity="error" sx={{ mb: 2, fontSize: 12 }}>{err}</Alert>}
        {msg && <Alert severity="success" sx={{ mb: 2, fontSize: 12 }}>{msg}</Alert>}

        {step === 0 && (
          <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2 }}>
            <TextField label={tr('Host IP / Hostname')} size="small" fullWidth
              value={conn.host} onChange={e => setConn({ ...conn, host: e.target.value })} />
            <TextField label={tr('Port')} size="small" type="number" fullWidth
              value={conn.port} onChange={e => setConn({ ...conn, port: +e.target.value })} />
            <TextField label={tr('Service Name')} size="small" fullWidth
              value={conn.sid} onChange={e => setConn({ ...conn, sid: e.target.value })} />
            <TextField label={tr('Username')} size="small" fullWidth
              value={conn.username} onChange={e => setConn({ ...conn, username: e.target.value })} />
            <TextField label={tr('Password')} size="small" type="password" fullWidth
              value={conn.password} onChange={e => setConn({ ...conn, password: e.target.value })} />
          </Box>
        )}

        {step === 2 && (
          <FormControl size="small" fullWidth>
            <InputLabel>{tr('History window')}</InputLabel>
            <Select value={days} label={tr('History window')} onChange={e => setDays(+e.target.value)}>
              {[90, 180, 365, 730, 1095].map(d =>
                <MenuItem key={d} value={d}>{d} {tr('days')}</MenuItem>)}
            </Select>
          </FormControl>
        )}

        {step === 3 && (
          <Typography sx={{ fontSize: 13, color: 'var(--rt-text-2)' }}>
            {tr('Ready to load. This runs in the background and may take a while for large databases.')}
          </Typography>
        )}

        <Box sx={{ display: 'flex', gap: 1.5, mt: 3, alignItems: 'center' }}>
          <Button onClick={skip} sx={{ textTransform: 'none', color: '#94a3b8' }}>
            {tr('Skip for now')}
          </Button>
          <Box sx={{ flex: 1 }} />
          {step === 0 && (
            <Button variant="contained" disabled={!conn.host || !conn.sid || !conn.username}
              onClick={() => setStep(1)}
              sx={{ bgcolor: ACCENT, textTransform: 'none', fontWeight: 700, '&:hover': { bgcolor: '#6d28d9' } }}>
              {tr('Next')}
            </Button>
          )}
          {step === 1 && (
            <Button variant="contained" disabled={busy} onClick={testConn}
              sx={{ bgcolor: ACCENT, textTransform: 'none', fontWeight: 700, '&:hover': { bgcolor: '#6d28d9' } }}>
              {busy ? <CircularProgress size={16} sx={{ color: '#fff' }} /> : tr('Test Connection')}
            </Button>
          )}
          {step === 2 && (
            <Button variant="contained" onClick={() => setStep(3)}
              sx={{ bgcolor: ACCENT, textTransform: 'none', fontWeight: 700, '&:hover': { bgcolor: '#6d28d9' } }}>
              {tr('Next')}
            </Button>
          )}
          {step === 3 && (
            <Button variant="contained" disabled={busy} onClick={doLoad}
              sx={{ bgcolor: ACCENT, textTransform: 'none', fontWeight: 700, '&:hover': { bgcolor: '#6d28d9' } }}>
              {busy ? <CircularProgress size={16} sx={{ color: '#fff' }} /> : tr('Load Now')}
            </Button>
          )}
        </Box>
      </Box>
    </Dialog>
  )
}
