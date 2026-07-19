/**
 * Ask AI — natural-language questions over the warehouse.
 *
 * Free-form question → safe read-only SQL (sandboxed + store-scoped) → a plain
 * answer plus the generated SQL and result table for trust. Designed to feel
 * premium: gradient accents, soft cards, smooth entrance animations.
 */
import { useState, useRef, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import axios from 'axios'
import {
  Box, Typography, TextField, IconButton, Paper, Chip, Collapse, Button,
  CircularProgress, Table, TableHead, TableRow, TableCell, TableBody,
  Dialog, DialogTitle, DialogContent, DialogActions, Switch, MenuItem,
  FormControlLabel, Alert, Tooltip, Avatar, Fade, InputAdornment,
} from '@mui/material'
import SendIcon           from '@mui/icons-material/ArrowUpward'
import InsightsIcon     from '@mui/icons-material/Insights'
import SettingsIcon       from '@mui/icons-material/Tune'
import CodeIcon           from '@mui/icons-material/DataObject'
import TrendingUpIcon     from '@mui/icons-material/TrendingUp'
import StorefrontIcon     from '@mui/icons-material/Storefront'
import Inventory2Icon     from '@mui/icons-material/Inventory2'
import WarningAmberIcon   from '@mui/icons-material/WarningAmber'
import CompareArrowsIcon  from '@mui/icons-material/CompareArrows'
import { useAuth } from '../../contexts/AuthContext'
import { moneyPrefix } from '../../utils/formatters'
import { tr } from '../../i18n'

const ACCENT   = '#7c3aed'
const ACCENT_D = '#6d28d9'
const GRAD     = `linear-gradient(135deg, ${ACCENT} 0%, #9333ea 55%, #a855f7 100%)`
// Theme token, NOT a fixed hex — a hard-coded near-black is invisible once the
// surrounding surfaces turn dark in dark mode.
const INK      = 'var(--rt-text)'
const MUTED    = '#64748b'

const STARTERS = [
  { icon: <TrendingUpIcon />,    q: 'What were my top 10 products by revenue last month?' },
  { icon: <StorefrontIcon />,    q: 'Which store had the highest sales this year?' },
  { icon: <Inventory2Icon />,    q: 'Show total stock value by department.' },
  { icon: <WarningAmberIcon />,  q: 'Which items have negative stock right now?' },
  { icon: <CompareArrowsIcon />, q: 'Compare this month’s sales to last month.' },
]

type Msg = {
  role: 'user' | 'assistant'
  text?: string
  sql?: string
  columns?: string[]
  rows?: any[][]
  truncated?: boolean
  error?: string
  loading?: boolean
}

function ResultTable({ columns, rows, truncated }: { columns: string[]; rows: any[][]; truncated?: boolean }) {
  if (!columns?.length) return null
  const money = (c: string) => /cost|value|revenue|price|rev|amount|sales|gp|margin/i.test(c)
  return (
    <Box sx={{ overflowX: 'auto', mt: 1.5, border: '1px solid var(--rt-border)', borderRadius: 2.5 }}>
      <Table size="small" stickyHeader sx={{ '& td, & th': { borderColor: 'var(--rt-border)' } }}>
        <TableHead>
          <TableRow>{columns.map((c, i) => (
            <TableCell key={i} sx={{ fontWeight: 700, fontSize: 12, color: 'var(--rt-text-2)',
              bgcolor: 'var(--rt-surface-2)', letterSpacing: .2, whiteSpace: 'nowrap' }}>{c}</TableCell>
          ))}</TableRow>
        </TableHead>
        <TableBody>
          {rows.slice(0, 200).map((r, ri) => (
            <TableRow key={ri} hover sx={{ '&:hover': { bgcolor: 'var(--rt-surface-2)' } }}>
              {r.map((cell, ci) => (
                <TableCell key={ci} sx={{ fontSize: 12.5, color: INK,
                  textAlign: typeof cell === 'number' ? 'right' : 'left',
                  fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
                  {typeof cell === 'number'
                    ? `${money(columns[ci]) ? moneyPrefix() : ''}${cell.toLocaleString(undefined, { maximumFractionDigits: 2 })}`
                    : String(cell ?? '')}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {(truncated || rows.length > 200) && (
        <Typography sx={{ fontSize: 11, color: '#94a3b8', p: 1.2 }}>
          {tr('Showing first rows only — refine your question for a smaller result.')}
        </Typography>
      )}
    </Box>
  )
}

const PROVIDERS = [
  { v: 'groq',      label: 'Groq',              badge: 'Free',  hint: 'Fast, free. Get a key at console.groq.com', model: 'llama-3.3-70b-versatile' },
  { v: 'gemini',    label: 'Google Gemini',     badge: 'Free',  hint: 'Free tier. Get a key at aistudio.google.com', model: 'gemini-2.5-flash' },
  { v: 'anthropic', label: 'Claude (Anthropic)', badge: '',     hint: 'Highest quality. Paid API key.', model: 'claude-sonnet-5' },
  { v: 'openai',    label: 'OpenAI-compatible',  badge: '',     hint: 'OpenAI, OpenRouter, Azure, LM Studio…', model: 'gpt-4o-mini' },
  { v: 'ollama',    label: 'Local (Ollama)',     badge: 'Offline', hint: 'Runs on this machine, no internet. Install Ollama + pull a model.', model: 'qwen2.5-coder:7b' },
]

function ConfigDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [cfg, setCfg] = useState<any>({ enabled: false, provider: 'groq',
    ollama_url: 'http://localhost:11434', base_url: '', model: '', api_key: '', has_key: false })
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    if (open) axios.get('/api/assistant/config').then(r => setCfg({ ...r.data, api_key: '' })).catch(() => {})
  }, [open])

  const save = async () => {
    setSaving(true); setErr(null)
    try {
      await axios.put('/api/assistant/config', {
        enabled: cfg.enabled, provider: cfg.provider,
        ollama_url: cfg.ollama_url, base_url: cfg.base_url,
        model: cfg.model, api_key: cfg.api_key || undefined,
      })
      onClose()
    } catch (e: any) { setErr(e?.response?.data?.detail ?? 'Save failed') }
    finally { setSaving(false) }
  }
  const set = (k: string, v: any) => setCfg((c: any) => ({ ...c, [k]: v }))
  const meta = PROVIDERS.find(p => p.v === cfg.provider) || PROVIDERS[0]

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth
      PaperProps={{ sx: { borderRadius: 3.5, overflow: 'hidden' } }}>
      <Box sx={{ background: GRAD, color: '#fff', px: 3, py: 2.5, display: 'flex', alignItems: 'center', gap: 1.5 }}>
        <InsightsIcon />
        <Box>
          <Typography sx={{ fontWeight: 800, fontSize: 18 }}>{tr('AI Assistant')}</Typography>
          <Typography sx={{ fontSize: 12.5, opacity: .85 }}>{tr('Choose where the AI runs and connect it.')}</Typography>
        </Box>
      </Box>
      <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2.25, pt: 3 }}>
        <FormControlLabel control={<Switch checked={cfg.enabled}
          onChange={e => set('enabled', e.target.checked)} />}
          label={<Typography sx={{ fontWeight: 600 }}>{tr('Enable the AI assistant')}</Typography>} />

        <TextField select size="small" label={tr('Provider')} value={cfg.provider}
          onChange={e => set('provider', e.target.value)}>
          {PROVIDERS.map(p => (
            <MenuItem key={p.v} value={p.v}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                {tr(p.label)}
                {p.badge && <Chip size="small" label={tr(p.badge)} sx={{ height: 18, fontSize: 10, fontWeight: 700,
                  bgcolor: p.badge === 'Free' ? 'var(--rt-pos-bg)' : '#eef2ff',
                  color:   p.badge === 'Free' ? 'var(--rt-pos-fg)' : '#4338ca' }} />}
              </Box>
            </MenuItem>
          ))}
        </TextField>
        <Typography sx={{ fontSize: 12, color: MUTED, mt: -1 }}>{tr(meta.hint)}</Typography>

        {cfg.provider === 'ollama' && (
          <TextField size="small" label={tr('Ollama endpoint')} value={cfg.ollama_url}
            onChange={e => set('ollama_url', e.target.value)} />
        )}
        {cfg.provider === 'openai' && (
          <TextField size="small" label={tr('API base URL')} value={cfg.base_url}
            placeholder="https://api.openai.com/v1" onChange={e => set('base_url', e.target.value)} />
        )}
        <TextField size="small" label={tr('Model')} value={cfg.model}
          onChange={e => set('model', e.target.value)} placeholder={meta.model}
          helperText={tr('Leave blank to use the default:') + ' ' + meta.model} />
        {cfg.provider !== 'ollama' && (
          <TextField size="small" type="password" label={tr('API key')}
            value={cfg.api_key} placeholder={cfg.has_key ? '•••••••• ' + tr('(stored)') : ''}
            onChange={e => set('api_key', e.target.value)}
            helperText={tr('Stored encrypted on this machine. Leave blank to keep the current key.')} />
        )}
        {cfg.provider !== 'ollama' && (
          <Alert severity="info" icon={false} sx={{ fontSize: 12, borderRadius: 2, bgcolor: 'var(--rt-surface-3)', color: '#5b21b6' }}>
            {tr('Cloud providers need internet. Your question and the data schema are sent to the provider; row data stays local except a small preview used to phrase the answer.')}
          </Alert>
        )}
        {err && <Alert severity="error" sx={{ borderRadius: 2 }}>{err}</Alert>}
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2.5 }}>
        <Button onClick={onClose} sx={{ color: MUTED, textTransform: 'none' }}>{tr('Cancel')}</Button>
        <Button variant="contained" onClick={save} disabled={saving} disableElevation
          sx={{ background: GRAD, borderRadius: 2, px: 3, textTransform: 'none', fontWeight: 700,
                '&:hover': { background: GRAD, filter: 'brightness(1.05)' } }}>
          {saving ? tr('Saving…') : tr('Save')}
        </Button>
      </DialogActions>
    </Dialog>
  )
}

function Sparkle() {
  return (
    <Avatar sx={{ width: 34, height: 34, background: GRAD, boxShadow: '0 4px 12px rgba(124,58,237,.35)' }}>
      <InsightsIcon sx={{ fontSize: 18 }} />
    </Avatar>
  )
}

export default function Assistant() {
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'
  const navigate = useNavigate()
  const [msgs, setMsgs] = useState<Msg[]>([])
  const [input, setInput] = useState('')
  const [openSql, setOpenSql] = useState<number | null>(null)
  const endRef = useRef<HTMLDivElement>(null)

  const { data: status } = useQuery<any>({
    queryKey: ['assistant-status'],
    queryFn: () => axios.get('/api/assistant/status').then(r => r.data),
    retry: false,
  })
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [msgs])

  const send = async (q?: string) => {
    const question = (q ?? input).trim()
    if (!question) return
    setInput('')
    const idx = msgs.length + 1
    setMsgs(m => [...m, { role: 'user', text: question }, { role: 'assistant', loading: true }])
    try {
      const r = await axios.post('/api/assistant/ask', { question })
      setMsgs(m => m.map((msg, i) => i === idx ? { role: 'assistant', ...r.data, loading: false } : msg))
    } catch (e: any) {
      setMsgs(m => m.map((msg, i) => i === idx
        ? { role: 'assistant', loading: false, error: e?.response?.data?.detail ?? 'Request failed' }
        : msg))
    }
  }
  const disabled = status && !status.enabled

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 56px)',
               maxWidth: 940, mx: 'auto', width: '100%', px: 3, pb: 2 }}>
      {/* Header */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, pt: 2.5, pb: 1.5 }}>
        <Sparkle />
        <Box sx={{ flex: 1 }}>
          <Typography variant="h5" fontWeight={800} sx={{ color: INK, lineHeight: 1.1 }}>
            {tr('Data Analyst')}
          </Typography>
          <Typography sx={{ fontSize: 12.5, color: MUTED }}>
            {tr('Your data analyst — ask anything about sales, stock and purchases.')}
          </Typography>
        </Box>
        {isAdmin && (
          <Tooltip title={tr('Open Settings')}>
            <IconButton onClick={() => navigate('/settings')}
              sx={{ bgcolor: 'var(--rt-surface-3)', '&:hover': { bgcolor: '#ede9fe' } }}>
              <SettingsIcon sx={{ color: ACCENT }} />
            </IconButton>
          </Tooltip>
        )}
      </Box>

      {disabled && (
        <Alert severity="info" sx={{ mb: 2, borderRadius: 2.5 }}
          action={isAdmin ? <Button onClick={() => navigate('/settings')} sx={{ textTransform: 'none' }}>{tr('Open Settings')}</Button> : undefined}>
          {isAdmin
            ? tr('The AI assistant is off. Enable it in Settings → Maintenance → AI Assistant.')
            : tr('The AI assistant is not enabled. Ask your administrator to turn it on.')}
        </Alert>
      )}

      {/* Conversation */}
      <Box sx={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 2.5, py: 1,
                 '&::-webkit-scrollbar': { width: 6 },
                 '&::-webkit-scrollbar-thumb': { bgcolor: '#e2e0ef', borderRadius: 3 } }}>
        {msgs.length === 0 && !disabled && (
          <Fade in timeout={500}>
            <Box sx={{ m: 'auto', textAlign: 'center', maxWidth: 640, px: 1 }}>
              <Box sx={{ width: 64, height: 64, borderRadius: '50%', background: GRAD, mx: 'auto', mb: 2.5,
                         display: 'flex', alignItems: 'center', justifyContent: 'center',
                         boxShadow: '0 10px 30px rgba(124,58,237,.35)' }}>
                <InsightsIcon sx={{ color: '#fff', fontSize: 30 }} />
              </Box>
              <Typography sx={{ fontSize: 22, fontWeight: 800, color: INK, mb: .5 }}>
                {tr('What would you like to know?')}
              </Typography>
              <Typography sx={{ color: MUTED, mb: 3 }}>
                {tr('Ask in plain language — the assistant writes the query, runs it on your data, and explains the answer.')}
              </Typography>
              <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 1.5, textAlign: 'left' }}>
                {STARTERS.map((s, i) => (
                  <Paper key={i} onClick={() => send(s.q)} elevation={0}
                    sx={{ p: 1.75, borderRadius: 3, border: '1px solid var(--rt-border)', cursor: 'pointer',
                          display: 'flex', alignItems: 'center', gap: 1.5, transition: 'all .18s ease',
                          '&:hover': { borderColor: ACCENT, boxShadow: '0 8px 22px rgba(124,58,237,.12)', transform: 'translateY(-2px)' },
                          ...(i === STARTERS.length - 1 ? { gridColumn: { sm: '1 / -1' } } : {}) }}>
                    <Box sx={{ width: 34, height: 34, borderRadius: 2, bgcolor: 'var(--rt-surface-3)', color: ACCENT,
                               display: 'flex', alignItems: 'center', justifyContent: 'center',
                               '& svg': { fontSize: 19 } }}>{s.icon}</Box>
                    <Typography sx={{ fontSize: 13.5, color: 'var(--rt-text-2)', fontWeight: 500 }}>{tr(s.q)}</Typography>
                  </Paper>
                ))}
              </Box>
            </Box>
          </Fade>
        )}

        {msgs.map((m, i) => m.role === 'user' ? (
          <Fade in key={i} timeout={300}>
            <Box sx={{ alignSelf: 'flex-end', maxWidth: '78%' }}>
              <Paper elevation={0} sx={{ px: 2.25, py: 1.25, background: GRAD, color: '#fff',
                borderRadius: '18px 18px 4px 18px', boxShadow: '0 6px 18px rgba(124,58,237,.28)' }}>
                <Typography sx={{ fontSize: 14.5 }}>{m.text}</Typography>
              </Paper>
            </Box>
          </Fade>
        ) : (
          <Fade in key={i} timeout={350}>
            <Box sx={{ alignSelf: 'flex-start', maxWidth: '94%', display: 'flex', gap: 1.25,
                       width: m.columns?.length ? '94%' : 'auto' }}>
              <Box sx={{ pt: .5 }}><Sparkle /></Box>
              <Paper elevation={0} sx={{ px: 2.25, py: 1.75, borderRadius: '4px 18px 18px 18px',
                border: '1px solid var(--rt-border)', flex: 1, minWidth: 0,
                boxShadow: '0 4px 16px rgba(15,23,42,.04)' }}>
                {m.loading ? (
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, color: MUTED, py: .5 }}>
                    <CircularProgress size={16} sx={{ color: ACCENT }} />
                    <Typography sx={{ fontSize: 14 }}>{tr('Analysing your data…')}</Typography>
                  </Box>
                ) : m.error ? (
                  <Alert severity="error" sx={{ borderRadius: 2, fontSize: 13 }}>{m.error}</Alert>
                ) : (
                  <>
                    {m.text && <Typography sx={{ fontSize: 14.5, color: INK, whiteSpace: 'pre-wrap', lineHeight: 1.55 }}>{m.text}</Typography>}
                    {m.columns?.length ? <ResultTable columns={m.columns} rows={m.rows || []} truncated={m.truncated} /> : null}
                    {m.sql && (
                      <>
                        <Button size="small" startIcon={<CodeIcon sx={{ fontSize: 16 }} />}
                          sx={{ mt: 1.25, textTransform: 'none', color: MUTED, borderRadius: 2,
                                bgcolor: 'var(--rt-surface-2)', '&:hover': { bgcolor: 'var(--rt-surface-3)' }, px: 1.25 }}
                          onClick={() => setOpenSql(openSql === i ? null : i)}>
                          {openSql === i ? tr('Hide query') : tr('View query')}
                        </Button>
                        <Collapse in={openSql === i}>
                          <Box component="pre" sx={{ mt: 1.25, p: 1.75, bgcolor: '#0f172a', color: '#c7d2fe',
                            borderRadius: 2, fontSize: 12, lineHeight: 1.5, overflowX: 'auto', whiteSpace: 'pre-wrap',
                            fontFamily: 'ui-monospace, Menlo, Consolas, monospace' }}>{m.sql}</Box>
                        </Collapse>
                      </>
                    )}
                  </>
                )}
              </Paper>
            </Box>
          </Fade>
        ))}
        <div ref={endRef} />
      </Box>

      {/* Composer */}
      <Box sx={{ pt: 1 }}>
        <TextField fullWidth placeholder={tr('Ask a question about your data…')}
          value={input} disabled={disabled} multiline maxRows={4}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }}
          InputProps={{
            sx: { borderRadius: 3.5, bgcolor: 'var(--rt-surface)', pr: .75, fontSize: 14.5,
                  boxShadow: '0 4px 20px rgba(15,23,42,.06)',
                  '& fieldset': { borderColor: 'var(--rt-border)' },
                  '&:hover fieldset': { borderColor: 'var(--rt-border)' },
                  '&.Mui-focused fieldset': { borderColor: ACCENT, borderWidth: 2 } },
            endAdornment: (
              <InputAdornment position="end">
                <IconButton onClick={() => send()} disabled={disabled || !input.trim()}
                  sx={{ background: GRAD, color: '#fff', width: 38, height: 38,
                        '&:hover': { background: GRAD, filter: 'brightness(1.08)' },
                        '&.Mui-disabled': { background: 'var(--rt-surface-3)', color: '#fff' } }}>
                  <SendIcon sx={{ fontSize: 20 }} />
                </IconButton>
              </InputAdornment>
            ),
          }} />
        <Typography sx={{ fontSize: 11, color: '#a0aec0', mt: 1, textAlign: 'center' }}>
          {tr('Answers come from your live data. Always verify important numbers — AI can make mistakes.')}
        </Typography>
      </Box>

    </Box>
  )
}

