import React, { useState, useMemo, createContext, useContext } from 'react'
import ReactDOM from 'react-dom/client'
import { ThemeProvider } from '@mui/material/styles'
import CssBaseline from '@mui/material/CssBaseline'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import App from './App'
import { createAppTheme } from './theme'

// ── Color mode context ─────────────────────────────────────────
interface ColorModeCtx { mode: 'light' | 'dark'; toggle: () => void }
export const ColorModeContext = createContext<ColorModeCtx>({ mode: 'light', toggle: () => {} })
export const useColorMode = () => useContext(ColorModeContext)

// ── Query client ───────────────────────────────────────────────
const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
})

// ── Root ───────────────────────────────────────────────────────
function Root() {
  const [mode, setMode] = useState<'light' | 'dark'>('light')
  const toggle = () => setMode(m => m === 'light' ? 'dark' : 'light')
  const theme  = useMemo(() => createAppTheme(mode), [mode])

  return (
    <ColorModeContext.Provider value={{ mode, toggle }}>
      <ThemeProvider theme={theme}>
        <CssBaseline />
        <App />
      </ThemeProvider>
    </ColorModeContext.Provider>
  )
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <Root />
    </QueryClientProvider>
  </React.StrictMode>
)
