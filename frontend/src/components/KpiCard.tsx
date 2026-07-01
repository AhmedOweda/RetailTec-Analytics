/**
 * Shared KPI card — Style C (tinted header band)
 *
 * Props:
 *   label   — short uppercase label
 *   value   — formatted value string
 *   sub     — optional second line (e.g. "123 transactions")
 *   color   — accent color applied to header bg tint, header text, and value
 *   trend   — optional % change number (+4.2 or -1.5); renders a coloured badge
 *   icon    — optional Tabler icon class suffix (e.g. 'ti-cash', 'ti-box')
 */
import { Box, Typography } from '@mui/material'

interface KpiCardProps {
  label:  string
  value:  string
  sub?:   string
  color?: string
  trend?: number
  icon?:  string
}

const DEFAULT_COLOR = '#7c3aed'
const C_SLATE       = '#64748b'

export default function KpiCard({
  label,
  value,
  sub,
  color = DEFAULT_COLOR,
  trend,
  icon,
}: KpiCardProps) {
  return (
    <Box sx={{
      flex: 1, minWidth: 140,
      bgcolor: '#fff',
      borderRadius: 2,
      border: '0.5px solid #e2e8f0',
      overflow: 'hidden',
      boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
    }}>
      {/* ── Tinted header band ── */}
      <Box sx={{
        bgcolor: `${color}18`,
        px: 2, py: 1.2,
        display: 'flex', alignItems: 'center', gap: 1,
      }}>
        {icon && (
          <i className={`ti ${icon}`}
             style={{ fontSize: 14, color, lineHeight: 1 }}
             aria-hidden="true" />
        )}
        <Typography sx={{
          fontSize: 10, fontWeight: 700, color,
          textTransform: 'uppercase', letterSpacing: 0.8, lineHeight: 1,
        }}>
          {label}
        </Typography>
      </Box>

      {/* ── Body ── */}
      <Box sx={{ px: 2, pt: 1.4, pb: 1.6 }}>
        <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1, flexWrap: 'wrap' }}>
          <Typography sx={{ fontSize: 26, fontWeight: 700, color, lineHeight: 1.1 }}>
            {value}
          </Typography>
          {trend != null && (
            <Typography sx={{
              fontSize: 11, fontWeight: 700,
              color: trend >= 0 ? '#059669' : '#e11d48',
            }}>
              {trend >= 0 ? '↑' : '↓'} {Math.abs(trend).toFixed(1)}%
            </Typography>
          )}
        </Box>
        {sub && (
          <Typography sx={{ fontSize: 11, color: C_SLATE, mt: 0.4 }}>{sub}</Typography>
        )}
      </Box>
    </Box>
  )
}
