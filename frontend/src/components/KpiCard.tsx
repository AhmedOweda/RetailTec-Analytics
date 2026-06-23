import { Card, CardContent, Box, Typography, Tooltip } from '@mui/material'
import TrendingUpIcon  from '@mui/icons-material/TrendingUp'
import TrendingDownIcon from '@mui/icons-material/TrendingDown'
import { useTheme } from '@mui/material/styles'

export type KpiVariant = 'purple' | 'teal' | 'green' | 'orange' | 'red' | 'violet' | 'default'

const VARIANTS: Record<KpiVariant, {
  accent1: string; accent2: string
  bg: string; bgDark: string; shadow: string
}> = {
  purple:  { accent1: '#7040B8', accent2: '#9B65D0', bg: '#F7F3FF', bgDark: 'rgba(112,64,184,0.15)', shadow: 'rgba(112,64,184,0.14)' },
  violet:  { accent1: '#4E2A99', accent2: '#7040B8', bg: '#F3EEFF', bgDark: 'rgba(78,42,153,0.18)',  shadow: 'rgba(78,42,153,0.14)'  },
  teal:    { accent1: '#0E7490', accent2: '#06B6D4', bg: '#F0FAFF', bgDark: 'rgba(14,116,144,0.15)', shadow: 'rgba(14,116,144,0.14)' },
  green:   { accent1: '#1B7A3E', accent2: '#22C55E', bg: '#F0FFF6', bgDark: 'rgba(27,122,62,0.15)',  shadow: 'rgba(27,122,62,0.14)'  },
  orange:  { accent1: '#D4820A', accent2: '#F59E0B', bg: '#FFFBF0', bgDark: 'rgba(212,130,10,0.15)', shadow: 'rgba(212,130,10,0.14)' },
  red:     { accent1: '#C0392B', accent2: '#E05B5B', bg: '#FFF5F5', bgDark: 'rgba(224,91,91,0.15)',  shadow: 'rgba(224,91,91,0.14)'  },
  default: { accent1: '#9B65D0', accent2: '#C8A8E8', bg: '#F7F3FF', bgDark: 'rgba(155,101,208,0.15)', shadow: 'rgba(155,101,208,0.14)'},
}

interface KpiCardProps {
  icon:     React.ReactNode
  label:    string
  value:    string
  sub?:     string
  trend?:   number | null
  variant?: KpiVariant
  tooltip?: string
}

export default function KpiCard({ icon, label, value, sub, trend, variant = 'default', tooltip }: KpiCardProps) {
  const v    = VARIANTS[variant]
  const theme = useTheme()
  const dark  = theme.palette.mode === 'dark'

  const cardBg     = dark ? theme.palette.background.paper : '#fff'
  const borderClr  = dark ? 'rgba(155,101,208,0.18)' : 'rgba(0,0,0,0.06)'
  const valueFg    = dark ? theme.palette.text.primary   : '#12082E'
  const labelFg    = dark ? theme.palette.text.secondary : '#7B6FA0'
  const subFg      = dark ? 'rgba(200,168,232,0.7)'      : '#9A8FBA'
  const subBorder  = dark ? 'rgba(155,101,208,0.15)'     : 'rgba(0,0,0,0.05)'
  const trendUpBg  = dark ? 'rgba(34,197,94,0.15)'       : '#DCFCE7'
  const trendDnBg  = dark ? 'rgba(220,38,38,0.15)'       : '#FEE2E2'
  const trendUpFg  = dark ? '#4ADE80'                     : '#15803D'
  const trendDnFg  = dark ? '#F87171'                     : '#DC2626'

  const card = (
    <Card
      elevation={0}
      sx={{
        height: '100%',
        borderRadius: '14px',
        background: cardBg,
        border: `1px solid ${borderClr}`,
        boxShadow: `0 2px 16px ${v.shadow}`,
        position: 'relative',
        overflow: 'hidden',
        cursor: tooltip ? 'help' : 'default',
        transition: 'transform 0.18s ease, box-shadow 0.18s ease',
        '&:hover': {
          transform: 'translateY(-3px)',
          boxShadow: `0 10px 28px ${v.shadow}`,
        },
        '&::before': {
          content: '""',
          position: 'absolute',
          top: 0, left: 0, right: 0,
          height: '3px',
          background: `linear-gradient(90deg, ${v.accent1}, ${v.accent2})`,
        },
      }}
    >
      <CardContent sx={{ p: '16px 18px 14px !important' }}>

        {/* Icon + trend row */}
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 1.5 }}>
          <Box sx={{
            width: 40, height: 40,
            borderRadius: '10px',
            background: `linear-gradient(135deg, ${v.accent1}, ${v.accent2})`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            boxShadow: `0 4px 12px ${v.shadow}`,
            flexShrink: 0,
            '& svg': { fontSize: 20, color: '#fff' },
          }}>
            {icon}
          </Box>

          {trend != null && (
            <Box sx={{
              display: 'flex', alignItems: 'center', gap: 0.3,
              px: 0.9, py: 0.35,
              borderRadius: '20px',
              background: trend >= 0 ? trendUpBg : trendDnBg,
              fontSize: '0.63rem', fontWeight: 700,
              color: trend >= 0 ? trendUpFg : trendDnFg,
              lineHeight: 1,
            }}>
              {trend >= 0
                ? <TrendingUpIcon sx={{ fontSize: 11 }} />
                : <TrendingDownIcon sx={{ fontSize: 11 }} />}
              {Math.abs(trend).toFixed(1)}%
            </Box>
          )}
        </Box>

        {/* Value */}
        <Typography sx={{
          fontSize: '1.5rem',
          fontWeight: 600,
          color: valueFg,
          fontVariantNumeric: 'tabular-nums',
          letterSpacing: '-0.025em',
          lineHeight: 1.15,
          mb: 0.5,
          fontFamily: '"Inter", sans-serif',
        }}>
          {value}
        </Typography>

        {/* Label */}
        <Typography sx={{
          fontSize: '0.67rem',
          fontWeight: 700,
          color: labelFg,
          textTransform: 'uppercase',
          letterSpacing: '0.07em',
          lineHeight: 1.4,
        }}>
          {label}
        </Typography>

        {/* Sub */}
        {sub && (
          <Box sx={{
            mt: 0.8,
            pt: 0.8,
            borderTop: `1px solid ${subBorder}`,
          }}>
            <Typography sx={{ fontSize: '0.65rem', color: subFg, fontWeight: 500 }}>
              {sub}
            </Typography>
          </Box>
        )}

      </CardContent>
    </Card>
  )

  return tooltip ? <Tooltip title={tooltip} arrow placement="top">{card}</Tooltip> : card
}
