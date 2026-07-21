import axios from 'axios'
import { getSubsidiary } from '../state/subsidiary'

/**
 * Single configured API client (EXPERT_REVIEW.md H3).
 *
 * Uses a RELATIVE base URL: in dev, Vite proxies /api → :8000; in production,
 * the packaged bundled HTTP server (:7382) does the same. This means the app also
 * works when opened from another machine (no hardcoded localhost).
 */
const api = axios.create({ baseURL: '' })

function attachToken(cfg: any) {
  const token = localStorage.getItem('rt_token')
  if (token) cfg.headers.Authorization = `Bearer ${token}`
  return cfg
}

// Global subsidiary filter: when a subsidiary is selected, append
// `subsidiaries=<sid>` to every sales/inventory/purchases data request. The
// backend treats an empty/absent value as "no filter", so selecting All ('')
// simply omits the param. Existing params are preserved; the selector's own
// /subsidiaries-list lookup is skipped so it always returns the full list.
function attachSubsidiary(cfg: any) {
  const sid = getSubsidiary()
  if (!sid) return cfg
  const url: string = cfg.url || ''
  const scoped =
    url.startsWith('/api/sales') ||
    url.startsWith('/api/inventory') ||
    url.startsWith('/api/purchases') ||
    url.startsWith('/api/accounting') ||
    // /api/home/summary is the landing dashboard. It was missing here, so the
    // Home page ignored the header subsidiary entirely while every other screen
    // honoured it — the dashboard visibly contradicted the slicer.
    url.startsWith('/api/home')
  if (!scoped) return cfg
  if (url.includes('/subsidiaries-list')) return cfg
  // A page that carries its OWN subsidiary slicer wins over the header pick —
  // otherwise the interceptor would silently overwrite it and the page would
  // look unfiltered (the Accounting pages have a per-page subsidiary slicer).
  if (cfg.params?.subsidiaries) return cfg
  cfg.params = { ...(cfg.params || {}), subsidiaries: sid }
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
api.interceptors.request.use(attachSubsidiary)
api.interceptors.response.use(res => res, on401)

// ── Global safety net ─────────────────────────────────────────────────────────
// Most pages still import the default `axios` instance directly. Until every
// file is migrated to this client, configure the global instance identically so
// EVERY request carries the Bearer token and handles 401 → logout.
axios.defaults.baseURL = ''
axios.interceptors.request.use(attachToken)
axios.interceptors.request.use(attachSubsidiary)
axios.interceptors.response.use(res => res, on401)

export default api
