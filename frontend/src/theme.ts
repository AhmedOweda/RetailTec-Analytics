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

export function createAppTheme(mode: 'light' | 'dark',
                               direction: 'ltr' | 'rtl' = 'ltr') {
  const dark = mode === 'dark'

  return createTheme({
    direction,
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
      fontFamily: '"RiyalSymbol", "Inter", "Manrope", sans-serif',
      fontFeatureSettings: '"tnum"',
      fontWeightLight:   400,
      fontWeightRegular: 400,
      fontWeightMedium:  600,
      fontWeightBold:    700,
      h6:        { fontWeight: 700, letterSpacing: '-0.01em' },
      subtitle1: { fontWeight: 600 },
      subtitle2: { fontWeight: 700, fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.06em' },
      body2:     { fontSize: '0.78rem' },
      caption:   { fontFamily: '"RiyalSymbol", "DM Mono", monospace', fontSize: '0.68rem' },
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
      // App-wide field style (owner request 30 Jul 2026): the shrunk label
      // that sits ON the outline kept colliding with the border frame on
      // scaled displays. Labels now render STATICALLY ABOVE the field — the
      // same look as the Settings caption controls (e.g. INCREMENTAL
      // OVERLAP) — and the border notch is closed so the outline is a clean
      // unbroken box. One place, every screen: slicers, dialogs, Settings,
      // login. Placeholders still show inside the box.
      MuiInputLabel: {
        defaultProps: { shrink: true },
        styleOverrides: {
          root: {
            position: 'relative',
            transform: 'none',
            fontSize: '0.68rem',
            fontWeight: 700,
            letterSpacing: '0.07em',
            textTransform: 'uppercase',
            lineHeight: 1.4,
            marginBottom: 3,
            maxWidth: '100%',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            // ONE caption colour everywhere (owner report 30 Jul: labels had
            // "multiple colors in multiple pages"). --rt-text-2 is the app's
            // dark-mode-aware secondary-text token; the hand-made captions
            // (LabeledCtl etc.) use the same token.
            color: 'var(--rt-text-2)',
            '&.Mui-focused': { color: PURPLE_BRAND[dark ? 400 : 600] },
          },
        },
      },
      MuiTextField: { defaultProps: { InputLabelProps: { shrink: true } } },
      MuiOutlinedInput: {
        styleOverrides: {
          notchedOutline: {
            // The label no longer floats into the border — collapse the
            // notch so the top edge renders as one solid line.
            '& legend': { width: 0 },
          },
        },
      },

      // Single default for every Paper: drop MUI's elevation-overlay tint so
      // paper backgrounds stay consistent. Intentionally no border/shadow here
      // so existing inline elevation/border/sx on cards still win (no regression).
      MuiPaper: {
        styleOverrides: {
          root: { backgroundImage: 'none' },
        },
      },

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
            fontFamily: '"RiyalSymbol", "Inter", sans-serif',
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
          root: { fontFamily: '"RiyalSymbol", "Inter", sans-serif', fontWeight: 600 },
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
            fontFamily: '"RiyalSymbol", "Inter", sans-serif',
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
          root: { fontFamily: '"RiyalSymbol", "Inter", sans-serif', fontSize: '0.82rem' },
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
