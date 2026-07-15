/**
 * Shared KPI card with selectable style variants (A–F).
 *
 * Variants (default 'A'):
 *   A — tinted header band (label strip in accent tint, colored value)
 *   B — left accent border  (white body, dark value)
 *   C — icon chip           (icon in soft colored square, label + value beside)
 *   D — soft tinted card    (whole card tinted, dark same-family text)
 *   E — minimal flat        (quiet gray tile, color only on value)
 *   F — top accent bar      (color hairline on top, icon right, dark value)
 *
 * Props:
 *   label   — short uppercase label
 *   value   — formatted value string
 *   sub     — optional second line (e.g. "123 transactions")
 *   color   — accent color
 *   trend   — optional % change number (+4.2 or -1.5); renders a coloured badge
 *   icon    — optional Tabler icon class suffix (e.g. 'ti-cash', 'ti-box')
 *   variant — style variant 'A'..'F'
 *   tag     — optional small badge (top-right) used for style comparison
 */
import { Box, Typography } from '@mui/material'
import { tr } from '../i18n'
import { MoneyText } from './RiyalSign'

export type KpiVariant = 'A' | 'B' | 'C' | 'D' | 'E' | 'F'

interface KpiCardProps {
  label:    string
  value:    string
  sub?:     string
  color?:   string
  trend?:   number
  icon?:    string
  variant?: KpiVariant
  tag?:     string
}

const DEFAULT_COLOR = '#7c3aed'
const C_SLATE       = '#64748b'
const C_INK         = '#0f172a'

function Trend({ trend }: { trend?: number }) {
  if (trend == null) return null
  return (
    <Typography sx={{ fontSize: 11, fontWeight: 700,
                      color: trend >= 0 ? '#059669' : '#e11d48' }}>
      {trend >= 0 ? '↑' : '↓'} {Math.abs(trend).toFixed(1)}%
    </Typography>
  )
}

function Tag({ tag }: { tag?: string }) {
  if (!tag) return null
  return (
    <Box sx={{ position: 'absolute', top: 6, right: 8, px: 0.8, py: 0.1,
               borderRadius: 1, bgcolor: '#0f172a', color: '#fff',
               fontSize: 10, fontWeight: 800, zIndex: 1 }}>{tag}</Box>
  )
}

export default function KpiCard({
  label, value, sub, color = DEFAULT_COLOR, trend, icon,
  variant = 'F',   // dashboard-wide default: top accent bar (chosen by Waseem)
  tag,
}: KpiCardProps) {
  // Arabic: labels + known sub-lines translate; dynamic subs pass through
  label = tr(label)
  sub   = sub ? tr(sub) : sub

  // NOTE: no explicit height here — an explicit cross-size (height:'100%')
  // disables flex-stretch, which made cards in the same row render at
  // different heights. With height unset, the flex container stretches every
  // card to the tallest one in its row automatically.
  const base = {
    flex: 1, minWidth: 140,
    display: 'flex', flexDirection: 'column',
    position: 'relative',
  } as const

  const labelSx = { fontSize: 10, fontWeight: 700, textTransform: 'uppercase',
                    letterSpacing: 0.8, lineHeight: 1 } as const
  const valueSx = { fontSize: 26, fontWeight: 700, lineHeight: 1.1 } as const
  const valueRow = { display: 'flex', alignItems: 'baseline', gap: 1, flexWrap: 'wrap' } as const

  // ── B: left accent border ──────────────────────────────────────────────────
  if (variant === 'B') return (
    <Box sx={{ ...base, bgcolor: '#fff', border: '0.5px solid #e2e8f0',
               borderLeft: `4px solid ${color}`, borderRadius: '0 8px 8px 0',
               px: 2, py: 1.5, justifyContent: 'center' }}>
      <Tag tag={tag} />
      <Typography sx={{ ...labelSx, color: C_SLATE }}>{label}</Typography>
      <Box sx={{ ...valueRow, mt: 0.6 }}>
        <Typography sx={{ ...valueSx, color: C_INK }}><MoneyText text={value} /></Typography>
        <Trend trend={trend} />
      </Box>
      {sub && <Typography sx={{ fontSize: 11, color: C_SLATE, mt: 0.4 }}><MoneyText text={sub} /></Typography>}
    </Box>
  )

  // ── C: icon chip ───────────────────────────────────────────────────────────
  if (variant === 'C') return (
    <Box sx={{ ...base, flexDirection: 'row', alignItems: 'center', gap: 1.5,
               bgcolor: '#fff', border: '0.5px solid #e2e8f0', borderRadius: 2,
               px: 2, py: 1.5 }}>
      <Tag tag={tag} />
      <Box sx={{ width: 40, height: 40, borderRadius: 2.5, bgcolor: `${color}18`,
                 display: 'flex', alignItems: 'center', justifyContent: 'center',
                 flexShrink: 0 }}>
        {icon && <i className={`ti ${icon}`} style={{ fontSize: 20, color }} aria-hidden="true" />}
      </Box>
      <Box>
        <Typography sx={{ ...labelSx, color: C_SLATE }}>{label}</Typography>
        <Box sx={{ ...valueRow, mt: 0.4 }}>
          <Typography sx={{ ...valueSx, fontSize: 24, color: C_INK }}><MoneyText text={value} /></Typography>
          <Trend trend={trend} />
        </Box>
        {sub && <Typography sx={{ fontSize: 11, color: C_SLATE, mt: 0.2 }}><MoneyText text={sub} /></Typography>}
      </Box>
    </Box>
  )

  // ── D: soft tinted card ────────────────────────────────────────────────────
  if (variant === 'D') return (
    <Box sx={{ ...base, bgcolor: `${color}14`, borderRadius: 2.5, px: 2, py: 1.5,
               justifyContent: 'center' }}>
      <Tag tag={tag} />
      <Typography sx={{ ...labelSx, color }}>
        {icon && <i className={`ti ${icon}`} style={{ fontSize: 13, marginRight: 5, verticalAlign: -2 }} aria-hidden="true" />}
        {label}
      </Typography>
      <Box sx={{ ...valueRow, mt: 0.6 }}>
        <Typography sx={{ ...valueSx, color: C_INK }}><MoneyText text={value} /></Typography>
        <Trend trend={trend} />
      </Box>
      {sub && <Typography sx={{ fontSize: 11, color, mt: 0.4, opacity: 0.85 }}><MoneyText text={sub} /></Typography>}
    </Box>
  )

  // ── E: minimal flat ────────────────────────────────────────────────────────
  if (variant === 'E') return (
    <Box sx={{ ...base, bgcolor: '#f8fafc', borderRadius: 2, px: 2, py: 1.5,
               justifyContent: 'center' }}>
      <Tag tag={tag} />
      <Typography sx={{ ...labelSx, color: '#94a3b8' }}>{label}</Typography>
      <Box sx={{ ...valueRow, mt: 0.6 }}>
        <Typography sx={{ ...valueSx, color }}><MoneyText text={value} /></Typography>
        <Trend trend={trend} />
      </Box>
      {sub && <Typography sx={{ fontSize: 11, color: C_SLATE, mt: 0.4 }}><MoneyText text={sub} /></Typography>}
    </Box>
  )

  // ── F: top accent bar ──────────────────────────────────────────────────────
  if (variant === 'F') return (
    <Box sx={{ ...base, bgcolor: '#fff', border: '0.5px solid #e2e8f0',
               borderTop: `3px solid ${color}`, borderRadius: '0 0 8px 8px',
               px: 2, py: 1.5, justifyContent: 'center' }}>
      <Tag tag={tag} />
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Typography sx={{ ...labelSx, color: C_SLATE }}>{label}</Typography>
        {icon && <i className={`ti ${icon}`} style={{ fontSize: 16, color: `${color}99` }} aria-hidden="true" />}
      </Box>
      <Box sx={{ ...valueRow, mt: 0.6 }}>
        <Typography sx={{ ...valueSx, color: C_INK }}><MoneyText text={value} /></Typography>
        <Trend trend={trend} />
      </Box>
      {sub && <Typography sx={{ fontSize: 11, color: C_SLATE, mt: 0.4 }}><MoneyText text={sub} /></Typography>}
    </Box>
  )

  // ── A (default): tinted header band ────────────────────────────────────────
  return (
    <Box sx={{ ...base, bgcolor: '#fff', borderRadius: 2,
               border: '0.5px solid #e2e8f0', overflow: 'hidden',
               boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
      <Tag tag={tag} />
      <Box sx={{ bgcolor: `${color}18`, px: 2, py: 1.2,
                 display: 'flex', alignItems: 'center', gap: 1 }}>
        {icon && (
          <i className={`ti ${icon}`}
             style={{ fontSize: 14, color, lineHeight: 1 }}
             aria-hidden="true" />
        )}
        <Typography sx={{ ...labelSx, color }}>{label}</Typography>
      </Box>
      <Box sx={{ px: 2, pt: 1.4, pb: 1.6, flexGrow: 1 }}>
        <Box sx={valueRow}>
          <Typography sx={{ ...valueSx, color }}><MoneyText text={value} /></Typography>
          <Trend trend={trend} />
        </Box>
        {sub && (
          <Typography sx={{ fontSize: 11, color: C_SLATE, mt: 0.4 }}><MoneyText text={sub} /></Typography>
        )}
      </Box>
    </Box>
  )
}
