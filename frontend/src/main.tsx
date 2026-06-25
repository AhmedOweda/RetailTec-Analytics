import React, { useState, useMemo } from 'react'
import ReactDOM from 'react-dom/client'
import { RouterProvider } from 'react-router-dom'
import { ThemeProvider } from '@mui/material/styles'
import CssBaseline from '@mui/material/CssBaseline'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { router } from './router'
import { createAppTheme } from './theme'
import { AppSettingsProvider } from './context/AppSettings'
import axios from 'axios'

// Trigger incremental sync on every app open
axios.get('/api/sync/trigger').catch(() => {})

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
})

function Root() {
  const [mode] = useState<'light' | 'dark'>('light')
  const theme  = useMemo(() => createAppTheme(mode), [mode])

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <RouterProvider router={router} />
    </ThemeProvider>
  )
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <QueryClientProvider client={queryClient}>
    <AppSettingsProvider>
      <Root />
    </AppSettingsProvider>
  </QueryClientProvider>
)
