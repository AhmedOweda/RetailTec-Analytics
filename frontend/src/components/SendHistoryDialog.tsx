/**
 * SendHistoryDialog — shows the report send-history log (GET /api/reports/history)
 * with client-side filters (status, free-text on subject/recipient/page, date).
 * Opened from the grid toolbar "History" button (and reusable elsewhere).
 */
import { useEffect, useMemo, useState } from 'react'
import {
  Dialog, DialogTitle, DialogContent, IconButton, Box, Typography,
  TextField, ToggleButton, ToggleButtonGroup, Chip, CircularProgress, Tooltip,
} from '@mui/material'
import CloseIcon    from '@mui/icons-material/Close'
import RefreshIcon  from '@mui/icons-material/Refresh'
import axios        from 'axios'
import { tr }       from '../i18n'

const ACCENT = '#7c3aed'

interface HistoryEntry {
  at:         string
  subject?:   string
  recipients?:string[]
  filename?:  string
  page?:      string
  by?:        string
  size_kb?:   number
  status?:    string
  error?:     string
}

export default function SendHistoryDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [rows,    setRows]    = useState<HistoryEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [status,  setStatus]  = useState<'all' | 'sent' | 'failed'>('all')
  const [q,       setQ]       = useState('')
  const [day,     setDay]     = useState('')   // yyyy-mm-dd filter

  const load = () => {
    setLoading(true)
    axios.get('/api/reports/history')
      .then(r => setRows(r.data?.history ?? []))
      .catch(() => setRows([]))
      .finally(() => setLoading(false))
  }
  useEffect(() => { if (open) load() }, [open])

  const filtered = useMemo(() => rows.filter(r => {
    if (status !== 'all' && (r.status ?? 'sent') !== status) return false
    if (day && !(r.at ?? '').startsWith(day)) return false
    if (q) {
      const hay = `${r.subject ?? ''} ${(r.recipients ?? []).join(' ')} ${r.page ?? ''} ${r.by ?? ''}`.toLowerCase()
      if (!hay.includes(q.toLowerCase())) return false
    }
    return true
  }), [rows, status, q, day])

  const fmtWhen = (iso?: string) => {
    if (!iso) return '—'
    try { return new Date(iso).toLocaleString('en-GB', { day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit' }) }
    catch { return iso }
  }

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth PaperProps={{ sx: { borderRadius: 3 } }}>
      <DialogTitle sx={{ fontWeight: 800, fontSize: 17, pr: 6 }}>
        {tr('Report send history')}
        <Tooltip title={tr('Refresh')}>
          <IconButton onClick={load} sx={{ position: 'absolute', right: 48, top: 12, color: '#64748b' }}><RefreshIcon /></IconButton>
        </Tooltip>
        <IconButton onClick={onClose} sx={{ position: 'absolute', right: 12, top: 12, color: '#64748b' }}><CloseIcon /></IconButton>
      </DialogTitle>
      <DialogContent dividers>
        {/* Filters */}
        <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap', alignItems: 'center', mb: 1.5 }}>
          <ToggleButtonGroup exclusive size="small" value={status} onChange={(_, v) => v && setStatus(v)}
            sx={{ '& .Mui-selected': { bgcolor: `${ACCENT}18 !important`, color: `${ACCENT} !important` } }}>
            <ToggleButton value="all" sx={{ textTransform: 'none', px: 1.5 }}>{tr('All')}</ToggleButton>
            <ToggleButton value="sent" sx={{ textTransform: 'none', px: 1.5 }}>{tr('Sent')}</ToggleButton>
            <ToggleButton value="failed" sx={{ textTransform: 'none', px: 1.5 }}>{tr('Failed')}</ToggleButton>
          </ToggleButtonGroup>
          <TextField size="small" placeholder={tr('Search subject / recipient / page')} value={q}
            onChange={e => setQ(e.target.value)} sx={{ flex: 1, minWidth: 200 }} />
          <TextField size="small" type="date" value={day} onChange={e => setDay(e.target.value)}
            InputLabelProps={{ shrink: true }} sx={{ width: 150 }} />
        </Box>

        {loading ? (
          <Box sx={{ py: 6, textAlign: 'center' }}><CircularProgress size={26} sx={{ color: ACCENT }} /></Box>
        ) : filtered.length === 0 ? (
          <Typography sx={{ py: 6, textAlign: 'center', color: '#94a3b8', fontSize: 14 }}>
            {rows.length === 0 ? tr('No reports have been emailed yet.') : tr('No entries match the filters.')}
          </Typography>
        ) : (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75 }}>
            {filtered.map((r, i) => {
              const ok = (r.status ?? 'sent') === 'sent'
              return (
                <Box key={i} sx={{ display: 'flex', alignItems: 'flex-start', gap: 1.5, p: 1.25,
                                   borderRadius: 2, border: '1px solid var(--rt-border)', bgcolor: ok ? '#fff' : '#fff7f7' }}>
                  <Chip size="small" label={ok ? tr('Sent') : tr('Failed')}
                    sx={{ height: 22, fontSize: 11, fontWeight: 700,
                          bgcolor: ok ? '#dcfce7' : '#fee2e2', color: ok ? '#15803d' : '#b91c1c' }} />
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Typography sx={{ fontSize: 13, fontWeight: 700, color: 'var(--rt-text)' }} noWrap>
                      {r.subject || r.filename || tr('Report')}
                    </Typography>
                    <Typography sx={{ fontSize: 12, color: 'var(--rt-text-2)' }} noWrap>
                      {tr('To')}: {(r.recipients ?? []).join(', ') || '—'}
                    </Typography>
                    <Typography sx={{ fontSize: 11, color: '#94a3b8' }}>
                      {fmtWhen(r.at)}{r.by ? ` · ${r.by}` : ''}{r.page ? ` · ${r.page}` : ''}{r.size_kb ? ` · ${r.size_kb} KB` : ''}
                      {r.filename ? ` · ${r.filename}` : ''}
                    </Typography>
                    {!ok && r.error && (
                      <Typography sx={{ fontSize: 11, color: '#b91c1c', mt: 0.25 }}>{r.error}</Typography>
                    )}
                  </Box>
                </Box>
              )
            })}
          </Box>
        )}
        <Typography sx={{ fontSize: 11, color: '#94a3b8', mt: 1.5 }}>
          {tr('Showing the most recent sends (newest first).')} {filtered.length}/{rows.length}
        </Typography>
      </DialogContent>
    </Dialog>
  )
}
