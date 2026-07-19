import { AppBar, Toolbar, Typography, Box, Chip, IconButton, Tooltip } from '@mui/material'
import DarkModeIcon  from '@mui/icons-material/DarkMode'
import LightModeIcon from '@mui/icons-material/LightMode'
import { useTheme } from '@mui/material/styles'
import { PURPLE_BRAND } from '../theme'
import { useColorMode } from '../main'

interface HeaderProps {
  host:    string
  cached?: boolean
}

export default function Header({ host, cached }: HeaderProps) {
  const now  = new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
  const theme = useTheme()
  const { mode, toggle } = useColorMode()
  const dark = mode === 'dark'

  const titleGradient = dark
    ? 'linear-gradient(135deg, #C8A8E8 0%, #EDE8F8 55%, #9B65D0 100%)'
    : 'linear-gradient(135deg, #4E2A99 0%, #9B65D0 60%, #7040B8 100%)'

  return (
    <AppBar
      position="static"
      elevation={0}
      sx={{
        background: theme.palette.background.paper,
        borderBottom: `1px solid ${theme.palette.divider}`,
        color: 'text.primary',
      }}
    >
      <Toolbar sx={{ minHeight: 56, gap: 1.5 }}>

        {/* Title */}
        <Box>
          <Typography sx={{
            fontSize: '1.18rem',
            fontWeight: 700,
            letterSpacing: '-0.01em',
            lineHeight: 1.2,
            background: titleGradient,
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
            backgroundClip: 'text',
            fontFamily: '"Plus Jakarta Sans", sans-serif',
          }}>
            RetailTec Sales Analytics Dashboard
          </Typography>
          <Typography sx={{
            color: 'text.secondary',
            fontSize: '0.67rem',
            letterSpacing: '0.08em',
            fontWeight: 400,
            fontFamily: '"Plus Jakarta Sans", sans-serif',
            textTransform: 'uppercase',
            opacity: 0.7,
          }}>
            Retail Pro Prism · RPS Schema
          </Typography>
        </Box>

        <Box sx={{ flex: 1 }} />

        {/* Cached chip */}
        {cached !== undefined && (
          <Chip
            label={cached ? '🟢 Cached' : '🔵 Live'}
            size="small"
            sx={{
              fontFamily: '"Plus Jakarta Sans", sans-serif',
              fontWeight: 600,
              fontSize: '0.65rem',
              background: cached ? 'var(--rt-pos-bg)' : PURPLE_BRAND[50],
              color: cached ? 'var(--rt-pos-fg)' : PURPLE_BRAND[600],
              border: `1px solid ${cached ? '#A7F3D0' : PURPLE_BRAND[200]}`,
            }}
          />
        )}

        {/* Host IP */}
        <Box sx={{
          fontFamily: '"DM Mono", monospace',
          fontSize: '0.72rem',
          color: 'text.secondary',
          background: dark ? 'rgba(155,101,208,0.12)' : PURPLE_BRAND[50],
          border: `1px solid ${dark ? 'rgba(155,101,208,0.25)' : PURPLE_BRAND[100]}`,
          borderRadius: 2,
          px: 1.5,
          py: 0.5,
        }}>
          {host}
        </Box>

        {/* Logo */}
        <img
          src={dark ? '/logo-white.png' : '/logo-purple.png'}
          alt="RetailTec"
          style={{ height: 34, width: 'auto' }}
        />

        {/* Dark mode toggle */}
        <Tooltip title={dark ? 'Switch to Light mode' : 'Switch to Dark mode'} arrow>
          <IconButton
            onClick={toggle}
            size="small"
            sx={{
              color: dark ? '#C8A8E8' : PURPLE_BRAND[500],
              background: dark ? 'rgba(155,101,208,0.12)' : PURPLE_BRAND[50],
              border: `1px solid ${dark ? 'rgba(155,101,208,0.25)' : PURPLE_BRAND[100]}`,
              '&:hover': {
                background: dark ? 'rgba(155,101,208,0.22)' : PURPLE_BRAND[100],
              },
              width: 34, height: 34,
            }}
          >
            {dark ? <LightModeIcon sx={{ fontSize: 17 }} /> : <DarkModeIcon sx={{ fontSize: 17 }} />}
          </IconButton>
        </Tooltip>

        {/* Date */}
        <Typography sx={{
          color: 'text.disabled',
          fontFamily: '"DM Mono", monospace',
          fontSize: '0.72rem',
          whiteSpace: 'nowrap',
        }}>
          {now}
        </Typography>

      </Toolbar>
    </AppBar>
  )
}
