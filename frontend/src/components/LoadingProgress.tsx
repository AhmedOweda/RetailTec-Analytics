import { Box, Typography, LinearProgress, Chip, Paper } from '@mui/material'
import CheckCircleIcon from '@mui/icons-material/CheckCircle'
import ErrorIcon from '@mui/icons-material/Error'
import StorageIcon from '@mui/icons-material/Storage'
import type { StreamStep } from '../types'
import { PURPLE_BRAND } from '../theme'

const ALL_STEPS = [
  { key: 'kpi',     label: 'KPI Summary' },
  { key: 'kpi_py',  label: 'Prior Year Comparison' },
  { key: 'trend',   label: 'Daily Sales Trend' },
  { key: 'store',   label: 'Store Performance' },
  { key: 'items',   label: 'Top Items Ranking' },
  { key: 'emp',     label: 'Employee Performance' },
  { key: 'monthly', label: 'Monthly Summary' },
  { key: 'txn',     label: 'Recent Transactions' },
]

function SpinnerDot() {
  return (
    <Box
      component="span"
      sx={{
        display: 'inline-block',
        width: 14, height: 14,
        borderRadius: '50%',
        border: '2px solid rgba(155,101,208,0.3)',
        borderTopColor: '#7040B8',
        animation: 'rt-spin 0.8s linear infinite',
        flexShrink: 0,
        '@keyframes rt-spin': { to: { transform: 'rotate(360deg)' } },
      }}
    />
  )
}

interface Props { steps: StreamStep[]; total?: number }

export default function LoadingProgress({ steps, total = 8 }: Props) {
  const done    = steps.length
  const pct     = total > 0 ? Math.round((done / total) * 100) : 0
  const doneSet = new Set(steps.map(s => s.key))
  const active  = ALL_STEPS.find(s => !doneSet.has(s.key))?.key ?? null

  return (
    <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: 420, p: 3 }}>
      <Paper
        elevation={0}
        sx={{
          width: '100%', maxWidth: 500,
          border: `1px solid ${PURPLE_BRAND[100]}`,
          borderRadius: 4,
          p: '36px 40px',
          boxShadow: '0 8px 40px rgba(112,64,184,0.10)',
        }}
      >
        {/* Header */}
        <Box sx={{ textAlign: 'center', mb: 3.5 }}>
          <Box sx={{
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            width: 52, height: 52, borderRadius: '50%', mb: 1.5,
            background: 'linear-gradient(135deg, #8B5CF6, #6D28D9)',
            boxShadow: '0 4px 16px rgba(109,40,217,0.30)',
          }}>
            <StorageIcon sx={{ color: '#fff', fontSize: 24 }} />
          </Box>
          <Typography sx={{ fontWeight: 700, fontSize: '1rem', color: PURPLE_BRAND[900] }}>
            Loading from Oracle
          </Typography>
          <Typography variant="body2" sx={{ color: 'text.secondary', mt: 0.5 }}>
            Running {total} queries sequentially…
          </Typography>
        </Box>

        {/* Progress bar */}
        <Box sx={{ mb: 0.5 }}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.8 }}>
            <Typography variant="subtitle2" sx={{ color: 'text.secondary', textTransform: 'none', letterSpacing: 0, fontWeight: 600, fontSize: '0.72rem' }}>
              Progress
            </Typography>
            <Typography variant="subtitle2" sx={{ color: 'primary.main', textTransform: 'none', letterSpacing: 0, fontVariantNumeric: 'tabular-nums' }}>
              {pct}%
            </Typography>
          </Box>
          <LinearProgress variant="determinate" value={pct} sx={{ mb: 0.5 }} />
          <Typography variant="caption" sx={{ color: 'text.disabled', float: 'right' }}>
            {done} of {total} complete
          </Typography>
        </Box>

        {/* Steps */}
        <Box sx={{ mt: 2.5, display: 'flex', flexDirection: 'column', gap: 0.7 }}>
          {ALL_STEPS.map(({ key, label }) => {
            const step     = steps.find(s => s.key === key)
            const isDone   = !!step
            const isActive = key === active
            const hasErr   = !!step?.error

            return (
              <Box
                key={key}
                sx={{
                  display: 'flex', alignItems: 'center', gap: 1.2,
                  px: 1.3, py: 0.85,
                  borderRadius: 2,
                  border: `1px solid ${isActive ? PURPLE_BRAND[200] : isDone ? PURPLE_BRAND[100] : 'transparent'}`,
                  background: isActive ? PURPLE_BRAND[50] : isDone ? '#FAFAFE' : 'transparent',
                  transition: 'all 0.3s ease',
                }}
              >
                {/* Icon */}
                <Box sx={{ flexShrink: 0, width: 16, height: 16, display: 'flex', alignItems: 'center' }}>
                  {hasErr   ? <ErrorIcon sx={{ fontSize: 16, color: 'error.main' }} /> :
                   isDone   ? <CheckCircleIcon sx={{ fontSize: 16, color: 'primary.main' }} /> :
                   isActive ? <SpinnerDot /> :
                   <Box sx={{ width: 12, height: 12, borderRadius: '50%', background: PURPLE_BRAND[100], m: '1px' }} />
                  }
                </Box>

                {/* Label */}
                <Typography sx={{
                  flex: 1, fontSize: '0.78rem',
                  fontWeight: isActive ? 700 : isDone ? 600 : 400,
                  color: hasErr ? 'error.main' : isActive ? PURPLE_BRAND[700] : isDone ? PURPLE_BRAND[900] : 'text.disabled',
                  transition: 'color 0.3s',
                }}>
                  {label}
                </Typography>

                {/* Badge */}
                {isDone && !hasErr && (
                  <Chip label="done" size="small" sx={{
                    height: 18, fontSize: '0.58rem', fontWeight: 700,
                    background: PURPLE_BRAND[100], color: PURPLE_BRAND[600],
                    '& .MuiChip-label': { px: 0.8 },
                  }} />
                )}
                {hasErr && (
                  <Chip label="error" size="small" sx={{
                    height: 18, fontSize: '0.58rem', fontWeight: 700,
                    background: 'var(--rt-neg-bg)', color: 'var(--rt-neg-fg)',
                    '& .MuiChip-label': { px: 0.8 },
                  }} />
                )}
                {isActive && !isDone && (
                  <Chip label="running" size="small" sx={{
                    height: 18, fontSize: '0.58rem', fontWeight: 700,
                    background: `linear-gradient(90deg,${PURPLE_BRAND[100]},${PURPLE_BRAND[200]})`,
                    color: PURPLE_BRAND[700],
                    '& .MuiChip-label': { px: 0.8 },
                  }} />
                )}
              </Box>
            )
          })}
        </Box>
      </Paper>
    </Box>
  )
}
