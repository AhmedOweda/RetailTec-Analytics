import axios from 'axios'

/**
 * Single configured API client (EXPERT_REVIEW.md H3).
 *
 * Uses a RELATIVE base URL: in dev, Vite proxies /api → :8000; in production,
 * Electron's bundled HTTP server (:3001) does the same. This means the app also
 * works when opened from another machine (no hardcoded localhost).
 */
const api = axios.create({ baseURL: '' })

function attachToken(cfg: any) {
  const token = localStorage.getItem('rt_token')
  if (token) cfg.headers.Authorization = `Bearer ${token}`
  return cfg
}

function on401(err: any) {
  if (err.response?.status === 401) {
    localStorage.removeItem('rt_token')
    localStorage.removeItem('rt_user')
    if (!window.location.pathname.startsWith('/login')) {
      window.location.href = '/login'
    }
  }
  return Promise.reject(err)
}

api.interceptors.request.use(attachToken)
api.interceptors.response.use(res => res, on401)

// ── Global safety net ─────────────────────────────────────────────────────────
// Most pages still import the default `axios` instance directly. Until every
// file is migrated to this client, configure the global instance identically so
// EVERY request carries the Bearer token and handles 401 → logout.
axios.defaults.baseURL = ''
axios.interceptors.request.use(attachToken)
axios.interceptors.response.use(res => res, on401)

export default api
