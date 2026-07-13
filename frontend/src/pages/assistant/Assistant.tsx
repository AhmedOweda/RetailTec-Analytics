/**
 * Ask AI — natural-language questions over the warehouse.
 *
 * The user types a question; the backend turns it into a safe, read-only SQL
 * query (sandboxed + scoped to the user's stores), runs it, and returns a
 * plain-language answer plus the generated SQL and the result table for trust.
 */
import { useState, useRef, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import axios from 'axios'
import {
  Box, Typography, TextField, IconButton, Paper, Chip, Collapse, Button,
  CircularProgress, Table, TableHead, TableRow, TableCell, TableBody,
  Dialog, DialogTitle, DialogContent, DialogActions, Switch, MenuItem,
  FormControlLabel, Alert, Tooltip,
} from '@mui/material'
import SendIcon        from '@mui/icons-material/Send'
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome'
import SettingsIcon    from '@mui/icons-material/Settings'
import CodeIcon        from '@mui/icons-material/Code'
import { useAuth } from '../../contexts/AuthContext'
import { moneyPrefix } from '../../utils/formatters'
import { tr } from '../../i18n'

const ACCENT = '#7c3aed'

const STARTERS = [
  'What were my top 10 products by revenue last month?',
  'Which store had the highest sales this year?',
  'Show total stock value by department.',
  'Which items have negative stock right now?',
  'Compare this month’s sales to last month.',
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
  const looksMoney = (c: string) => /cost|value|revenue|price|rev|amount|sales/i.test(c)
  return (
    <Box sx={{ overflowX: 'auto', mt: 1, border: '1px solid #eee', borderRadius: 1 }}>
      <Table size="small" stickyHeader>
        <TableHead>
          <TableRow>{columns.map((c, i) => (
            <TableCell key={i} sx={{ fontWeight: 700, fontSize: 12, bgcolor: '#faf9ff' }}>{c}</TableCell>
          ))}</TableRow>
        </TableHead>
        <TableBody>
          {rows.slice(0, 200).map((r, ri) => (
            <TableRow key={ri} hover>
              {r.map((cell, ci) => (
                <TableCell key={ci} sx={{ fontSize: 12,
                  textAlign: typeof cell === 'number' ? 'right' : 'left' }}>
                  {typeof cell === 'number'
                    ? `${looksMoney(columns[ci]) ? moneyPrefix() : ''}${cell.toLocaleString(undefined, { maximumFractionDigits: 2 })}`
                    : String(cell ?? '')}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {(truncated || rows.length > 200) && (
        <Typography sx={{ fontSize: 11, color: '#94a3b8', p: 1 }}>
          {tr('Showing first rows only — refine your question for a smaller result.')}
        </Typography>
      )}
    </Box>
  )
}

function ConfigDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [cfg, setCfg] = useState<any>({ enabled: false, provider: 'ollama',
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
    } catch (e: any) {
      setErr(e?.response?.data?.detail ?? 'Save failed')
    } finally { setSaving(false) }
  }

  const set = (k: string, v: any) => setCfg((c: any) => ({ ...c, [k]: v }))

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ fontWeight: 700 }}>{tr('AI Assistant Settings')}</DialogTitle>
      <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}>
        <FormControlLabel control={<Switch checked={cfg.enabled}
          onChange={e => set('enabled', e.target.checked)} />}
          label={tr('Enable the AI assistant')} />

        <TextField select size="small" label={tr('Provider')} value={cfg.provider}
          onChange={e => set('provider', e.target.value)}>
          <MenuItem value="ollama">{tr('Local (Ollama) — fully offline')}</MenuItem>
          <MenuItem value="anthropic">Claude (Anthropic) — {tr('cloud')}</MenuItem>
          <MenuItem value="openai">OpenAI-compatible — {tr('cloud')}</MenuItem>
        </TextField>

        {cfg.provider === 'ollama' && (
          <TextField size="small" label={tr('Ollama endpoint')} value={cfg.ollama_url}
            onChange={e => set('ollama_url', e.target.value)}
            helperText={tr('Runs on this machine. Install Ollama and pull a model, e.g. qwen2.5-coder:7b')} />
        )}
        {cfg.provider === 'openai' && (
          <TextField size="small" label={tr('API base URL')} value={cfg.base_url}
            placeholder="https://api.openai.com/v1" onChange={e => set('base_url', e.target.value)} />
        )}
        <TextField size="small" label={tr('Model')} value={cfg.model}
          onChange={e => set('model', e.target.value)}
          placeholder={cfg.provider === 'ollama' ? 'qwen2.5-coder:7b'
            : cfg.provider === 'anthropic' ? 'claude-sonnet-5' : 'gpt-4o-mini'} />
        {cfg.provider !== 'ollama' && (
          <TextField size="small" type="password" label={tr('API key')}
            value={cfg.api_key} placeholder={cfg.has_key ? '•••••••• (stored)' : ''}
            onChange={e => set('api_key', e.target.value)}
            helperText={tr('Stored encrypted on this machine. Leave blank to keep the current key.')} />
        )}
        {cfg.provider !== 'ollama' && (
          <Alert severity="info" sx={{ fontSize: 12 }}>
            {tr('Cloud providers need internet. Your question and the data schema are sent to the provider; row data stays local except a small preview used to phrase the answer.')}
          </Alert>
        )}
        {err && <Alert severity="error">{err}</Alert>}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{tr('Cancel')}</Button>
        <Button variant="contained" onClick={save} disabled={saving}
          sx={{ bgcolor: ACCENT, '&:hover': { bgcolor: '#6d28d9' } }}>
          {saving ? tr('Saving…') : tr('Save')}
        </Button>
      </DialogActions>
    </Dialog>
  )
}

export default function Assistant() {
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'
  const [msgs, setMsgs] = useState<Msg[]>([])
  const [input, setInput] = useState('')
  const [showCfg, setShowCfg] = useState(false)
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
    <Box sx={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 56px)', px: 3, pb: 2 }}>
      {/* Header */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, pt: 2.5, pb: 1.5 }}>
        <AutoAwesomeIcon sx={{ color: ACCENT }} />
        <Typography variant="h5" fontWeight={700}>{tr('Ask AI')}</Typography>
        <Chip size="small" label={tr('Beta')} sx={{ bgcolor: '#ede9fe', color: '#5b21b6', fontWeight: 700 }} />
        <Box sx={{ flex: 1 }} />
        {isAdmin && (
          <Tooltip title={tr('AI Assistant Settings')}>
            <IconButton onClick={() => setShowCfg(true)}><SettingsIcon /></IconButton>
          </Tooltip>
        )}
      </Box>

      {disabled && (
        <Alert severity="info" sx={{ mb: 2 }}
          action={isAdmin ? <Button onClick={() => setShowCfg(true)}>{tr('Set up')}</Button> : undefined}>
          {isAdmin
            ? tr('The AI assistant is off. Configure a provider to turn it on.')
            : tr('The AI assistant is not enabled. Ask your administrator to turn it on.')}
        </Alert>
      )}

      {/* Conversation */}
      <Box sx={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 2, py: 1 }}>
        {msgs.length === 0 && !disabled && (
          <Box sx={{ m: 'auto', textAlign: 'center', maxWidth: 560 }}>
            <Typography sx={{ color: '#64748b', mb: 2 }}>
              {tr('Ask a question about your sales, inventory or purchases in plain language.')}
            </Typography>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, justifyContent: 'center' }}>
              {STARTERS.map(s => (
                <Chip key={s} label={tr(s)} onClick={() => send(s)} clickable
                  sx={{ bgcolor: '#f5f3ff', '&:hover': { bgcolor: '#ede9fe' } }} />
              ))}
            </Box>
          </Box>
        )}

        {msgs.map((m, i) => m.role === 'user' ? (
          <Box key={i} sx={{ alignSelf: 'flex-end', maxWidth: '75%' }}>
            <Paper sx={{ px: 2, py: 1, bgcolor: ACCENT, color: '#fff', borderRadius: 2 }}>
              <Typography sx={{ fontSize: 14 }}>{m.text}</Typography>
            </Paper>
          </Box>
        ) : (
          <Box key={i} sx={{ alignSelf: 'flex-start', maxWidth: '92%', width: m.columns?.length ? '92%' : 'auto' }}>
            <Paper variant="outlined" sx={{ px: 2, py: 1.5, borderRadius: 2 }}>
              {m.loading ? (
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, color: '#64748b' }}>
                  <CircularProgress size={16} /> <Typography sx={{ fontSize: 14 }}>{tr('Thinking…')}</Typography>
                </Box>
              ) : m.error ? (
                <Alert severity="error" sx={{ fontSize: 13 }}>{m.error}</Alert>
              ) : (
                <>
                  {m.text && <Typography sx={{ fontSize: 14, whiteSpace: 'pre-wrap' }}>{m.text}</Typography>}
                  {m.columns?.length ? <ResultTable columns={m.columns} rows={m.rows || []} truncated={m.truncated} /> : null}
                  {m.sql && (
                    <>
                      <Button size="small" startIcon={<CodeIcon />} sx={{ mt: 1, textTransform: 'none', color: '#64748b' }}
                        onClick={() => setOpenSql(openSql === i ? null : i)}>
                        {openSql === i ? tr('Hide SQL') : tr('Show SQL')}
                      </Button>
                      <Collapse in={openSql === i}>
                        <Box component="pre" sx={{ mt: 1, p: 1.5, bgcolor: '#0f172a', color: '#e2e8f0',
                          borderRadius: 1, fontSize: 12, overflowX: 'auto', whiteSpace: 'pre-wrap' }}>{m.sql}</Box>
                      </Collapse>
                    </>
                  )}
                </>
              )}
            </Paper>
          </Box>
        ))}
        <div ref={endRef} />
      </Box>

      {/* Composer */}
      <Box sx={{ display: 'flex', gap: 1, pt: 1 }}>
        <TextField fullWidth size="small" placeholder={tr('Ask a question about your data…')}
          value={input} disabled={disabled}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }} />
        <IconButton onClick={() => send()} disabled={disabled || !input.trim()}
          sx={{ bgcolor: ACCENT, color: '#fff', '&:hover': { bgcolor: '#6d28d9' },
                '&.Mui-disabled': { bgcolor: '#e2e8f0' } }}>
          <SendIcon />
        </IconButton>
      </Box>
      <Typography sx={{ fontSize: 11, color: '#94a3b8', mt: 0.5 }}>
        {tr('Answers are generated from your data. Always verify important numbers — the assistant can make mistakes.')}
      </Typography>

      <ConfigDialog open={showCfg} onClose={() => setShowCfg(false)} />
    </Box>
  )
}
