import ReactDOM from 'react-dom/client'
import { RouterProvider } from 'react-router-dom'
import CssBaseline from '@mui/material/CssBaseline'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { router } from './router'
import './ag-grid-theme.css'     // global AG Grid polish (loads after the alpine theme)
import { AppSettingsProvider } from './context/AppSettings'
import { AuthProvider } from './contexts/AuthContext'
import DirectionProvider from './DirectionProvider'
import api from './api/client'   // installs global axios auth interceptors
import './i18n'                  // EN/AR translations + language persistence

// Trigger incremental sync on app open — only when already logged in
// (the endpoint now requires a valid token)
if (localStorage.getItem('rt_token')) {
  api.get('/api/sync/trigger').catch(() => {})
}

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
})

ReactDOM.createRoot(document.getElementById('root')!).render(
  <QueryClientProvider client={queryClient}>
    <AuthProvider>
      <AppSettingsProvider>
        {/* DirectionProvider owns the MUI theme: flips to RTL for Arabic */}
        <DirectionProvider>
          <CssBaseline />
          <RouterProvider router={router} />
        </DirectionProvider>
      </AppSettingsProvider>
    </AuthProvider>
  </QueryClientProvider>
)
