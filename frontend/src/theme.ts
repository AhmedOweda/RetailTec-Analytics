import { createTheme, alpha } from '@mui/material/styles'

export const PURPLE_BRAND = {
  50:  '#F5F0FF',
  100: '#EDE8F8',
  200: '#DDD0F8',
  300: '#C8A8E8',
  400: '#9B65D0',
  500: '#7040B8',
  600: '#5B2D9E',
  700: '#4E2A99',
  800: '#2D1B6B',
  900: '#1A0D45',
}

export function createAppTheme(mode: 'light' | 'dark') {
  const dark = mode === 'dark'

  return createTheme({
    palette: {
      mode,
      primary: {
        main:         PURPLE_BRAND[500],
        light:        PURPLE_BRAND[400],
        dark:         PURPLE_BRAND[700],
        contrastText: '#fff',
      },
      secondary: { main: '#0E7490' },
      background: {
        default: dark ? '#0E0824' : '#F5F3FB',
        paper:   dark ? '#160D3A' : '#FFFFFF',
      },
      text: {
        primary:   dark ? '#EDE8F8' : '#1A0D45',
        secondary: dark ? '#9B65D0' : '#6B5A8E',
        disabled:  dark ? '#4E3A7A' : '#B0A0CC',
      },
      divider: dark ? 'rgba(155,101,208,0.2)' : PURPLE_BRAND[100],
      success: { main: '#22C55E' },
      error:   { main: '#E05B5B' },
      warning: { main: '#D4820A' },
      info:    { main: '#0E7490' },
    },

    typography: {
      fontFamily: '"Inter", "Manrope", sans-serif',
      fontWeightLight:   400,
      fontWeightRegular: 400,
      fontWeightMedium:  600,
      fontWeightBold:    700,
      h6:        { fontWeight: 700, letterSpacing: '-0.01em' },
      subtitle1: { fontWeight: 600 },
      subtitle2: { fontWeight: 700, fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.06em' },
      body2:     { fontSize: '0.78rem' },
      caption:   { fontFamily: '"DM Mono", monospace', fontSize: '0.68rem' },
    },

    shape: { borderRadius: 12 },

    shadows: [
      'none',
      '0 1px 4px rgba(26,13,69,0.06)',
      '0 2px 8px rgba(26,13,69,0.08)',
      '0 4px 16px rgba(112,64,184,0.10)',
      '0 8px 32px rgba(112,64,184,0.12)',
      '0 12px 48px rgba(112,64,184,0.15)',
      ...Array(19).fill('none'),
    ] as any,

    components: {
      MuiCssBaseline: {
        styleOverrides: {
          body: {
            background: dark ? '#0E0824' : '#F5F3FB',
            fontVariantNumeric: 'tabular-nums',
          },
          '::-webkit-scrollbar': { width: 6, height: 6 },
          '::-webkit-scrollbar-track': { background: 'transparent' },
          '::-webkit-scrollbar-thumb': {
            background: dark
              ? alpha(PURPLE_BRAND[500], 0.5)
              : alpha(PURPLE_BRAND[400], 0.4),
            borderRadius: 3,
          },
        },
      },

      MuiCard: {
        styleOverrides: {
          root: {
            border: `1px solid ${dark ? 'rgba(155,101,208,0.15)' : PURPLE_BRAND[100]}`,
            background: dark ? '#1C0E42' : '#FFFFFF',
            boxShadow: dark
              ? '0 2px 16px rgba(0,0,0,0.35)'
              : '0 2px 12px rgba(112,64,184,0.07)',
            '&:hover': {
              boxShadow: dark
                ? '0 6px 28px rgba(112,64,184,0.25)'
                : '0 6px 24px rgba(112,64,184,0.13)',
            },
            transition: 'box-shadow 0.2s ease',
          },
        },
      },

      MuiButton: {
        styleOverrides: {
          root: {
            fontFamily: '"Inter", sans-serif',
            fontWeight: 700,
            textTransform: 'none',
            borderRadius: 10,
          },
          containedPrimary: {
            background: `linear-gradient(135deg, ${PURPLE_BRAND[500]}, ${PURPLE_BRAND[400]})`,
            boxShadow: `0 4px 14px ${alpha(PURPLE_BRAND[500], 0.35)}`,
            '&:hover': { boxShadow: `0 6px 20px ${alpha(PURPLE_BRAND[500], 0.45)}` },
          },
        },
      },

      MuiChip: {
        styleOverrides: {
          root: { fontFamily: '"Inter", sans-serif', fontWeight: 600 },
        },
      },

      MuiLinearProgress: {
        styleOverrides: {
          root: { borderRadius: 99, height: 8, background: dark ? 'rgba(155,101,208,0.2)' : PURPLE_BRAND[100] },
          bar:  { borderRadius: 99, background: `linear-gradient(90deg, ${PURPLE_BRAND[500]}, ${PURPLE_BRAND[700]})` },
        },
      },

      MuiTooltip: {
        styleOverrides: {
          tooltip: {
            background: '#1A0D45',
            color: '#EDE8F8',
            fontFamily: '"Inter", sans-serif',
            fontSize: '0.72rem',
            fontWeight: 600,
            borderRadius: 8,
            padding: '6px 12px',
          },
          arrow: { color: '#1A0D45' },
        },
      },

      MuiInputBase: {
        styleOverrides: {
          root: { fontFamily: '"Inter", sans-serif', fontSize: '0.82rem' },
        },
      },

      MuiIconButton: {
        styleOverrides: {
          root: { borderRadius: 10 },
        },
      },
    },
  })
}

export const CHART_COLORS = [
  PURPLE_BRAND[500],
  '#0E7490',
  '#D4820A',
  PURPLE_BRAND[700],
  '#1B7A3E',
  PURPLE_BRAND[400],
  '#E05B5B',
]
