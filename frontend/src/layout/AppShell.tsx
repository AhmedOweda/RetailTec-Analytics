/**
 * AppShell — persistent sidebar + header + page outlet
 * Same dark-purple theme as the original dashboard.
 */
import { useState, useMemo, useEffect } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import {
  Box, Tooltip, Typography, Divider, CircularProgress,
  IconButton, Collapse, Dialog, TextField, Button,
  Select, MenuItem, Drawer, useMediaQuery, useTheme,
} from '@mui/material'
import DashboardIcon        from '@mui/icons-material/Dashboard'
import TrendingUpIcon       from '@mui/icons-material/TrendingUp'
import InventoryIcon        from '@mui/icons-material/Inventory2'
import ReceiptLongIcon      from '@mui/icons-material/ReceiptLong'
import SettingsIcon         from '@mui/icons-material/Settings'
import WarehouseIcon        from '@mui/icons-material/Warehouse'
import SwapHorizIcon        from '@mui/icons-material/SwapHoriz'
import CompareArrowsIcon    from '@mui/icons-material/CompareArrows'
import AdjustIcon           from '@mui/icons-material/Adjust'
import AssessmentIcon       from '@mui/icons-material/Assessment'
import CalendarViewWeekIcon from '@mui/icons-material/CalendarViewWeek'
import ShoppingCartIcon    from '@mui/icons-material/ShoppingCart'
import ListAltIcon         from '@mui/icons-material/ListAlt'
import StorefrontIcon      from '@mui/icons-material/Storefront'
import PeopleIcon          from '@mui/icons-material/People'
import BadgeIcon           from '@mui/icons-material/Badge'
import CategoryIcon        from '@mui/icons-material/Category'
import LocalShippingIcon   from '@mui/icons-material/LocalShipping'
import ExpandMoreIcon      from '@mui/icons-material/ExpandMore'
import LogoutIcon         from '@mui/icons-material/Logout'
import ManageAccountsIcon from '@mui/icons-material/ManageAccounts'
import HistoryIcon        from '@mui/icons-material/History'
import EventAvailableIcon from '@mui/icons-material/EventAvailable'
import InsightsIcon       from '@mui/icons-material/Insights'
import MenuIcon           from '@mui/icons-material/Menu'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import axios             from 'axios'
import api               from '../api/client'
import { getSubsidiary, setSubsidiary } from '../state/subsidiary'
import { useAuth }       from '../contexts/AuthContext'
import { useTranslation } from 'react-i18next'
import { tr } from '../i18n'
import { parsePages, pageAllowed, firstAllowedPage } from '../utils/pages'
import FirstRunWizard from '../components/FirstRunWizard'

// ── Brand colours ──────────────────────────────────────────────────────────
const SIDEBAR_BG   = '#160b33'
const SIDEBAR_W    = 220
const ACCENT       = '#7c3aed'
const ACCENT_LIGHT = '#ede9fe'
const HEADER_H     = 56

// Shared sidebar styling — used by the permanent desktop Box and the mobile Drawer paper
const SIDEBAR_SX = {
  width: SIDEBAR_W, flexShrink: 0,
  // Subtle top-to-bottom depth instead of a flat fill
  background: `linear-gradient(180deg, #1e1248 0%, ${SIDEBAR_BG} 58%, #100621 100%)`,
  display: 'flex', flexDirection: 'column',
  borderRight: '1px solid rgba(255,255,255,0.06)',
  boxShadow: '1px 0 0 rgba(0,0,0,0.20)',
} as const

// ── Nav items ──────────────────────────────────────────────────────────────
const SALES_NAV = [
  { to: '/sales/overview',      icon: <DashboardIcon  />, label: 'Overview'     },
  { to: '/sales/performance',   icon: <TrendingUpIcon />, label: 'Performance'  },
  { to: '/sales/products',      icon: <InventoryIcon  />, label: 'Products'     },
  { to: '/sales/transactions',  icon: <ReceiptLongIcon/>, label: 'Transactions' },
]

const PURCHASES_NAV = [
  { to: '/purchases/overview',      icon: <ShoppingCartIcon />, label: 'Overview'     },
  { to: '/purchases/transactions',  icon: <ListAltIcon      />, label: 'Transactions' },
]

const DIMENSIONS_NAV = [
  { to: '/dimensions/stores',    icon: <StorefrontIcon    />, label: 'Stores'    },
  { to: '/dimensions/customers', icon: <PeopleIcon        />, label: 'Customers' },
  { to: '/dimensions/employees', icon: <BadgeIcon         />, label: 'Employees' },
  { to: '/dimensions/items',     icon: <CategoryIcon      />, label: 'Items'     },
  { to: '/dimensions/vendors',   icon: <LocalShippingIcon />, label: 'Suppliers' },
]

const INVENTORY_NAV = [
  { to: '/inventory/overview',    icon: <WarehouseIcon     />, label: 'Stock Levels' },
  { to: '/inventory/stock-asof',  icon: <EventAvailableIcon />, label: 'Stock by Date' },
  { to: '/inventory/movement',    icon: <SwapHorizIcon     />, label: 'Movement'     },
  { to: '/inventory/transfers',   icon: <CompareArrowsIcon />, label: 'Transfers'    },
  { to: '/inventory/adjustments', icon: <AdjustIcon        />, label: 'Adjustments'  },
  { to: '/inventory/ledger',      icon: <AssessmentIcon        />, label: 'Ledger'    },
  { to: '/inventory/history',     icon: <HistoryIcon           />, label: 'History'   },
  { to: '/inventory/coverage',   icon: <CalendarViewWeekIcon  />, label: 'Coverage'  },
]

// ── Forced password change: blocks the app while on the default password ───
function ForcePasswordDialog() {
  const { mustChangePassword, clearMustChange, logout } = useAuth()
  const [cur,  setCur]  = useState('')
  const [pw1,  setPw1]  = useState('')
  const [pw2,  setPw2]  = useState('')
  const [err,  setErr]  = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  if (!mustChangePassword) return null

  const submit = async () => {
    setErr(null)
    if (pw1.length < 8)  { setErr(tr('New password must be at least 8 characters')); return }
    if (pw1 !== pw2)     { setErr(tr('Passwords do not match')); return }
    setBusy(true)
    try {
      await axios.post('/api/auth/change-password', { current_password: cur, new_password: pw1 })
      clearMustChange()
    } catch (e: any) {
      setErr(e?.response?.data?.detail ?? tr('Failed to change password'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open disableEscapeKeyDown maxWidth="xs" fullWidth
      PaperProps={{ sx: { borderRadius: 3, p: 1 } }}>
      <Box sx={{ p: 3 }}>
        <Typography sx={{ fontWeight: 800, fontSize: 17, mb: 0.5 }}>{tr('Set a new password')}</Typography>
        <Typography sx={{ fontSize: 13, color: '#64748b', mb: 2 }}>
          {tr('This account is still using the default password. For security you must change it before using RetailTec Analytics.')}
        </Typography>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {/* Caption labels above plain fields — MUI notched labels overlap in RTL */}
          <Box>
            <Typography sx={{ fontSize: 12, fontWeight: 600, color: '#475569', mb: 0.5 }}>{tr('Current password')}</Typography>
            <TextField type="password" size="small" fullWidth
              value={cur} onChange={e => setCur(e.target.value)} autoFocus />
          </Box>
          <Box>
            <Typography sx={{ fontSize: 12, fontWeight: 600, color: '#475569', mb: 0.5 }}>{tr('New password (min 8 chars)')}</Typography>
            <TextField type="password" size="small" fullWidth
              value={pw1} onChange={e => setPw1(e.target.value)} />
          </Box>
          <Box>
            <Typography sx={{ fontSize: 12, fontWeight: 600, color: '#475569', mb: 0.5 }}>{tr('Repeat new password')}</Typography>
            <TextField type="password" size="small" fullWidth
              value={pw2} onChange={e => setPw2(e.target.value)} />
          </Box>
          {err && <Typography sx={{ fontSize: 12, color: '#dc2626', fontWeight: 600 }}>{err}</Typography>}
          <Box sx={{ display: 'flex', gap: 1.5, mt: 0.5 }}>
            <Button variant="contained" fullWidth disabled={busy} onClick={submit}
              sx={{ bgcolor: ACCENT, textTransform: 'none', fontWeight: 700,
                    '&:hover': { bgcolor: '#6d28d9' } }}>
              {busy ? tr('Saving…') : tr('Change Password')}
            </Button>
            <Button onClick={logout} sx={{ textTransform: 'none', color: '#64748b', whiteSpace: 'nowrap' }}>
              {tr('Log out')}
            </Button>
          </Box>
        </Box>
      </Box>
    </Dialog>
  )
}

// ── Data-quality badge: red when a post-sync join-coverage check fails ─────
function ValidationBadge() {
  const { data = [] } = useQuery<any[]>({
    queryKey: ['sync-validation'],
    queryFn:  () => axios.get('/api/sync/validation').then(r => r.data),
    refetchInterval: 60_000,
  })
  const bad = data.filter(r => (r.status ?? r.STATUS) === 'fail')
  if (!bad.length) return null
  const worst = bad[0]
  return (
    <Tooltip title={bad.map(b => `${b.check_name ?? b.CHECK_NAME}: ${b.pct ?? b.PCT}% matched`).join(' · ')}>
      <Box sx={{ display:'flex', alignItems:'center', gap:0.5, px:1, py:0.3,
                 bgcolor:'rgba(239,68,68,0.12)', borderRadius:1, cursor:'default' }}>
        <Typography variant="caption" sx={{ color:'#dc2626', fontWeight:700, fontSize:10 }}>
          ⚠ Data check failed ({worst.pct ?? worst.PCT}%)
        </Typography>
      </Box>
    </Tooltip>
  )
}

// ── Sync status badge ──────────────────────────────────────────────────────
function SyncBadge() {
  const { data } = useQuery({
    queryKey: ['sync-status'],
    queryFn:  () => axios.get('/api/sync/status').then(r => r.data),
    refetchInterval: 3000,
  })

  if (!data?.running) return null
  return (
    <Box sx={{ display:'flex', alignItems:'center', gap:0.5, px:1,
               bgcolor:'rgba(124,58,237,0.15)', borderRadius:1, py:0.3 }}>
      <CircularProgress size={10} thickness={5} sx={{ color: ACCENT }} />
      <Typography variant="caption" sx={{ color: ACCENT, fontWeight:600, fontSize:10 }}>
        {data.step || 'Syncing'}…
      </Typography>
    </Box>
  )
}

// ── Global subsidiary selector ─────────────────────────────────────────────
// Always shown when the warehouse has subsidiaries. Multi-subsidiary users can
// switch (or pick All); single-subsidiary installs get their subsidiary
// auto-selected so its name is always visible. Changing it stores the SID in
// the module store and invalidates ALL queries, so every active page refetches
// — the axios interceptor appends the `subsidiaries` param to each request.
function SubsidiarySelect() {
  const qc = useQueryClient()
  const [sid, setSid] = useState<string>(getSubsidiary())

  const { data: subs = [] } = useQuery<{ sid: string; name: string }[]>({
    queryKey: ['subsidiaries-list'],
    queryFn:  () => api.get('/api/sales/subsidiaries-list').then(r => r.data),
    staleTime: Infinity,
    retry: false,
  })

  // Single subsidiary: auto-select it so its name always shows in the header.
  useEffect(() => {
    if (subs.length === 1 && sid !== subs[0].sid) {
      setSid(subs[0].sid)
      setSubsidiary(subs[0].sid)
    }
  }, [subs])   // eslint-disable-line react-hooks/exhaustive-deps

  // Hidden only when the warehouse has no subsidiaries at all (empty install).
  if (subs.length === 0) return null

  const onChange = (next: string) => {
    setSid(next)
    setSubsidiary(next)
    qc.invalidateQueries()   // refetch every active query with the new filter
  }

  return (
    <Select
      value={sid}
      onChange={e => onChange(e.target.value)}
      size="small"
      displayEmpty
      MenuProps={{ disableScrollLock: true }}
      sx={{
        minWidth: { xs: 92, md: 140 }, height: 30, fontSize: 12, fontWeight: 600,
        color: '#475569', bgcolor: 'rgba(124,58,237,0.06)', borderRadius: 99,
        '& .MuiOutlinedInput-notchedOutline': { borderColor: 'rgba(124,58,237,0.12)' },
        '&:hover .MuiOutlinedInput-notchedOutline': { borderColor: 'rgba(124,58,237,0.30)' },
        '& .MuiSelect-select': { py: 0.5, pl: 1.5 },
      }}
    >
      {subs.length > 1 && (
        <MenuItem value="" sx={{ fontSize: 12 }}>{tr('All Subsidiaries')}</MenuItem>
      )}
      {subs.map(s => (
        <MenuItem key={s.sid} value={s.sid} sx={{ fontSize: 12 }}>{s.name}</MenuItem>
      ))}
    </Select>
  )
}

// ── Reusable NavLink renderer ──────────────────────────────────────────────
function NavItem({ to, icon, label }: { to: string; icon: React.ReactNode; label: string }) {
  const { t } = useTranslation()
  label = t(`nav.${to}`, label)   // falls back to the English label
  return (
    <NavLink key={to} to={to} style={{ textDecoration:'none' }}>
      {({ isActive }) => (
        <Box sx={{
          display:'flex', alignItems:'center', gap:1.5,
          px:1.5, py:1, borderRadius:1.5, mb:0.5, cursor:'pointer',
          background: isActive
            ? 'linear-gradient(90deg, rgba(124,58,237,0.34), rgba(124,58,237,0.08))'
            : 'transparent',
          color:   isActive ? ACCENT_LIGHT : 'rgba(255,255,255,0.6)',
          boxShadow: isActive ? 'inset 0 0 0 1px rgba(167,139,250,0.22)' : 'none',
          '&:hover': { background:'rgba(255,255,255,0.06)', color:'#fff' },
          transition:'all 0.18s ease',
        }}>
          <Box sx={{ fontSize:18, display:'flex', '& svg':{ fontSize:'18px !important' },
                     color: isActive ? ACCENT : 'inherit' }}>
            {icon}
          </Box>
          <Typography sx={{ fontSize:13, fontWeight: isActive ? 600 : 400 }}>
            {label}
          </Typography>
          {isActive && (
            <Box sx={{ ml:'auto', width:3, height:16, borderRadius:2, bgcolor:ACCENT }} />
          )}
        </Box>
      )}
    </NavLink>
  )
}

// ── AppShell ───────────────────────────────────────────────────────────────
export default function AppShell() {
  const { user, isAdmin, logout } = useAuth()
  const { t } = useTranslation()
  const location = useLocation()
  const navigate = useNavigate()

  // ── Per-user page permissions (admins + users with no pages claim see all) ─
  const allowed = useMemo(
    () => (isAdmin ? null : parsePages(user?.pages)),
    [isAdmin, user?.pages])
  // ── Responsive (declared early so it can gate the nav below) ──
  const theme = useTheme()
  const isMobile = useMediaQuery(theme.breakpoints.down('md'))
  // On mobile, hide pure-table pages (their grids are hidden on phones): Sales/
  // Purchases Transactions + every Dimensions page. Settings/Users/Audit are
  // hidden separately in the footer block below.
  const MOBILE_HIDE = new Set<string>([
    '/sales/transactions', '/purchases/transactions',
    '/dimensions/stores', '/dimensions/customers', '/dimensions/employees',
    '/dimensions/items', '/dimensions/vendors',
  ])
  const _navOk = (to: string) => pageAllowed(allowed, to) && !(isMobile && MOBILE_HIDE.has(to))
  const salesNav      = SALES_NAV.filter(n => _navOk(n.to))
  const inventoryNav  = INVENTORY_NAV.filter(n => _navOk(n.to))
  const purchasesNav  = PURCHASES_NAV.filter(n => _navOk(n.to))
  const dimensionsNav = DIMENSIONS_NAV.filter(n => _navOk(n.to))

  // Route guard: opening a disallowed page redirects to the first allowed one
  useEffect(() => {
    const p = location.pathname
    const guarded = p.startsWith('/sales/') || p.startsWith('/inventory/')
                 || p.startsWith('/purchases/') || p.startsWith('/dimensions/')
    if (guarded && !pageAllowed(allowed, p)) {
      navigate(firstAllowedPage(allowed), { replace: true })
    }
  }, [location.pathname, allowed, navigate])

  // ── Sidebar section collapse state (all expanded by default) ─────
  const [salesOpen,      setSalesOpen     ] = useState(true)
  const [inventoryOpen,  setInventoryOpen ] = useState(true)
  const [purchasesOpen,  setPurchasesOpen ] = useState(true)
  const [dimensionsOpen, setDimensionsOpen] = useState(true)

  // ── Whitelabel branding (falls back to the hardcoded defaults) ──
  const { data: brandSettings } = useQuery({
    queryKey: ['settings'],
    queryFn:  () => axios.get('/api/settings').then(r => r.data),
    staleTime: 60_000,
    retry: false,
  })
  const brandName: string = brandSettings?.brand_name || 'RetailTec Analytics'
  const brandLogo: string = brandSettings?.brand_logo || ''

  // AI assistant enabled? (gates the sidebar link)
  const { data: asstStatus } = useQuery<any>({
    queryKey: ['assistant-status'],
    queryFn:  () => axios.get('/api/assistant/status').then(r => r.data),
    staleTime: 60_000,
    retry: false,
  })
  const asstEnabled = !!asstStatus?.enabled

  // Warehouse status: alias + license-binding watermark flag
  const { data: whStatus } = useQuery<any>({
    queryKey: ['settings-status'],
    queryFn:  () => api.get('/api/settings/status').then(r => r.data),
    staleTime: 60_000,
    retry: false,
  })

  // First-run wizard: admins only, when the install has never completed setup.
  // Gated on an explicit `false` so a still-loading query never flashes it.
  const [wizardDismissed, setWizardDismissed] = useState(false)
  // Only for a genuinely fresh install: setup not completed AND nothing ever
  // loaded (no prior sync). Existing installs that already have data — even if
  // the older settings file predates the setup_complete flag — never see it.
  const showWizard = isAdmin && !wizardDismissed
    && brandSettings?.setup_complete === false
    && !brandSettings?.last_sync
    && (brandSettings?.model_status ?? 'empty') === 'empty'

  // Sidebar: permanent on desktop, temporary Drawer on mobile (isMobile above)
  const [drawerOpen, setDrawerOpen] = useState(false)

  // Sidebar inner content — defined once, rendered in the desktop Box or the mobile Drawer
  const sidebarContent = (
    <>
        {/* Logo */}
        <Box sx={{ px:2.5, py:2, display:'flex', alignItems:'center', gap:1.5,
                   borderBottom:'1px solid rgba(255,255,255,0.08)' }}>
          <Box component="img" src={brandLogo || '/logo-white.png'} alt={brandName}
               sx={{ height:36, maxWidth:180, objectFit:'contain' }} />
        </Box>

        {/* ── Scrollable nav area ─────────────────────────────────────── */}
        <Box sx={{ flex:1, overflowY:'auto', overflowX:'hidden',
                   '&::-webkit-scrollbar':{ width:4 },
                   '&::-webkit-scrollbar-thumb':{ bgcolor:'rgba(255,255,255,0.12)', borderRadius:2 } }}>

          {/* AI Assistant — prominent top link. Admins ALWAYS see it (so they
              can reach the setup even while it's off); other users only once
              it's enabled. */}
          {(asstEnabled || isAdmin) && (
            <Box sx={{ px:1.5, pt:1.5 }}>
              <NavItem to="/assistant" icon={<InsightsIcon />} label="Data Analyst" />
              <Divider sx={{ borderColor:'rgba(255,255,255,0.08)', mx:0.5, mt:1 }} />
            </Box>
          )}

          {/* Sales section */}
          {salesNav.length > 0 && (<>
          <Box onClick={() => setSalesOpen(o => !o)} sx={{
            px:2.5, pt:2.5, pb:0.5, display:'flex', alignItems:'center',
            justifyContent:'space-between', cursor:'pointer',
            '&:hover':{ bgcolor:'rgba(255,255,255,0.04)' },
          }}>
            <Typography sx={{ fontSize:10, fontWeight:700, color:'rgba(255,255,255,0.35)',
                              letterSpacing:1.2, textTransform:'uppercase' }}>{t('nav.sales')}</Typography>
            <ExpandMoreIcon sx={{ fontSize:14, color:'rgba(255,255,255,0.3)',
              transform: salesOpen ? 'rotate(0deg)' : 'rotate(-90deg)',
              transition:'transform 0.2s' }} />
          </Box>
          <Collapse in={salesOpen}>
            <Box sx={{ px:1.5, pt:0.5 }}>
              {salesNav.map(n => <NavItem key={n.to} {...n} />)}
            </Box>
          </Collapse>

          <Divider sx={{ borderColor:'rgba(255,255,255,0.08)', mx:2, my:1 }} />

          </>)}
          {/* Inventory section */}
          {inventoryNav.length > 0 && (<>
          <Box onClick={() => setInventoryOpen(o => !o)} sx={{
            px:2.5, pb:0.5, display:'flex', alignItems:'center',
            justifyContent:'space-between', cursor:'pointer',
            '&:hover':{ bgcolor:'rgba(255,255,255,0.04)' },
          }}>
            <Typography sx={{ fontSize:10, fontWeight:700, color:'rgba(255,255,255,0.35)',
                              letterSpacing:1.2, textTransform:'uppercase' }}>{t('nav.inventory')}</Typography>
            <ExpandMoreIcon sx={{ fontSize:14, color:'rgba(255,255,255,0.3)',
              transform: inventoryOpen ? 'rotate(0deg)' : 'rotate(-90deg)',
              transition:'transform 0.2s' }} />
          </Box>
          <Collapse in={inventoryOpen}>
            <Box sx={{ px:1.5, pt:0.5 }}>
              {inventoryNav.map(n => <NavItem key={n.to} {...n} />)}
            </Box>
          </Collapse>

          <Divider sx={{ borderColor:'rgba(255,255,255,0.08)', mx:2, my:1 }} />

          </>)}
          {/* Purchasing section */}
          {purchasesNav.length > 0 && (<>
          <Box onClick={() => setPurchasesOpen(o => !o)} sx={{
            px:2.5, pb:0.5, display:'flex', alignItems:'center',
            justifyContent:'space-between', cursor:'pointer',
            '&:hover':{ bgcolor:'rgba(255,255,255,0.04)' },
          }}>
            <Typography sx={{ fontSize:10, fontWeight:700, color:'rgba(255,255,255,0.35)',
                              letterSpacing:1.2, textTransform:'uppercase' }}>{t('nav.purchasing')}</Typography>
            <ExpandMoreIcon sx={{ fontSize:14, color:'rgba(255,255,255,0.3)',
              transform: purchasesOpen ? 'rotate(0deg)' : 'rotate(-90deg)',
              transition:'transform 0.2s' }} />
          </Box>
          <Collapse in={purchasesOpen}>
            <Box sx={{ px:1.5, pt:0.5 }}>
              {purchasesNav.map(n => <NavItem key={n.to} {...n} />)}
            </Box>
          </Collapse>

          <Divider sx={{ borderColor:'rgba(255,255,255,0.08)', mx:2, my:1 }} />

          </>)}
          {/* Dimensions section */}
          {dimensionsNav.length > 0 && (<>
          <Box onClick={() => setDimensionsOpen(o => !o)} sx={{
            px:2.5, pb:0.5, display:'flex', alignItems:'center',
            justifyContent:'space-between', cursor:'pointer',
            '&:hover':{ bgcolor:'rgba(255,255,255,0.04)' },
          }}>
            <Typography sx={{ fontSize:10, fontWeight:700, color:'rgba(255,255,255,0.35)',
                              letterSpacing:1.2, textTransform:'uppercase' }}>{t('nav.dimensions')}</Typography>
            <ExpandMoreIcon sx={{ fontSize:14, color:'rgba(255,255,255,0.3)',
              transform: dimensionsOpen ? 'rotate(0deg)' : 'rotate(-90deg)',
              transition:'transform 0.2s' }} />
          </Box>
          <Collapse in={dimensionsOpen}>
            <Box sx={{ px:1.5, pt:0.5 }}>
              {dimensionsNav.map(n => <NavItem key={n.to} {...n} />)}
            </Box>
          </Collapse>
          </>)}

          <Box sx={{ pb:1 }} />
        </Box>

        <Divider sx={{ borderColor:'rgba(255,255,255,0.08)' }} />

        {/* Settings + Users (admin only) + User info + Logout */}
        <Box sx={{ px:1.5, py:1.5 }}>
          {isAdmin && !isMobile && (
            <>
              <NavItem to="/settings"       icon={<SettingsIcon />}       label="Settings"  />
              <NavItem to="/settings/users" icon={<ManageAccountsIcon />} label="Users"     />
              <NavItem to="/settings/audit" icon={<HistoryIcon />}        label="Audit Log" />
            </>
          )}

          {/* Logged-in user chip */}
          <Box sx={{
            display:'flex', alignItems:'center', gap:1, px:1.5, py:1,
            borderRadius:1.5, mt:0.5,
            bgcolor:'rgba(255,255,255,0.05)',
            border:'1px solid rgba(255,255,255,0.07)',
          }}>
            <Box sx={{
              width:28, height:28, borderRadius:'50%',
              background:'linear-gradient(135deg, #8b5cf6, #6d28d9)',
              boxShadow:'0 2px 6px rgba(124,58,237,0.45)',
              display:'flex', alignItems:'center', justifyContent:'center',
              flexShrink:0,
            }}>
              <Typography sx={{ color:'#fff', fontWeight:700, fontSize:12 }}>
                {(user?.full_name || user?.username || '?')[0].toUpperCase()}
              </Typography>
            </Box>
            <Box sx={{ flex:1, minWidth:0 }}>
              <Typography sx={{ fontSize:12, fontWeight:600, color:'rgba(255,255,255,0.85)',
                                whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>
                {user?.full_name || user?.username}
              </Typography>
              <Typography sx={{ fontSize:10, color:'rgba(255,255,255,0.35)', textTransform:'capitalize' }}>
                {user?.role}
              </Typography>
            </Box>
            <Tooltip title="Sign out">
              <IconButton size="small" onClick={logout}
                sx={{ color:'rgba(255,255,255,0.35)', '&:hover':{ color:'#fff' } }}>
                <LogoutIcon sx={{ fontSize:16 }} />
              </IconButton>
            </Tooltip>
          </Box>
        </Box>
    </>
  )

  return (
    <Box sx={{ display:'flex', height:'100vh', overflow:'hidden' }}>

      {/* Forced-password-change disabled by owner request (2026-07-08).
          <ForcePasswordDialog /> stays available if it's ever wanted back. */}

      {/* License watermark: shown when the warehouse was filled by a different
          Oracle server (copied database) OR the license itself is violated
          (invalid signature, expired, wrong device, wrong server). */}
      {(whStatus?.db_host_mismatch || whStatus?.license_violation) && (
        <Box sx={{ position:'fixed', inset:0, zIndex:1999, pointerEvents:'none',
                   overflow:'hidden', display:'grid',
                   gridTemplateColumns:'repeat(3, 1fr)', alignContent:'space-around' }}>
          {Array.from({ length: 9 }).map((_, i) => (
            <Typography key={i} sx={{ transform:'rotate(-24deg)', textAlign:'center',
              fontSize:26, fontWeight:800, color:'rgba(220,38,38,0.10)',
              userSelect:'none', whiteSpace:'nowrap' }}>
              {whStatus?.license_violation
                ? `${tr(whStatus?.license_reason || 'UNLICENSED COPY')} · RetailTec`
                : `${tr('UNLICENSED COPY')} · ${whStatus?.bound_host}`}
            </Typography>
          ))}
        </Box>
      )}

      {/* Soft license warnings (no license / subsidiary limit exceeded) */}
      {(whStatus?.license_warnings?.length ?? 0) > 0 && !whStatus?.license_violation && (
        <Box sx={{ position:'fixed', bottom:10, left:'50%', transform:'translateX(-50%)',
                   zIndex:1998, bgcolor:'rgba(245,158,11,0.14)',
                   border:'1px solid rgba(245,158,11,0.45)', borderRadius:99,
                   px:2, py:0.4, pointerEvents:'none' }}>
          <Typography sx={{ fontSize:12, fontWeight:600, color:'#92400e', whiteSpace:'nowrap' }}>
            {whStatus.license_warnings.map((w: string) => tr(w)).join(' · ')}
          </Typography>
        </Box>
      )}

      {/* One-time first-run setup wizard (skippable, admins only) */}
      {showWizard && <FirstRunWizard onDone={() => setWizardDismissed(true)} />}

      {/* ── Sidebar: permanent on desktop, temporary Drawer on mobile ── */}
      {!isMobile && <Box sx={SIDEBAR_SX}>{sidebarContent}</Box>}
      {isMobile && (
        <Drawer
          variant="temporary"
          open={drawerOpen}
          onClose={() => setDrawerOpen(false)}
          ModalProps={{ keepMounted: true }}
          PaperProps={{
            sx: SIDEBAR_SX,
            // Close the drawer when a nav link (anchor) inside it is tapped
            onClick: (e: React.MouseEvent) => {
              if ((e.target as HTMLElement).closest('a')) setDrawerOpen(false)
            },
          }}
        >
          {sidebarContent}
        </Drawer>
      )}

      {/* ── Main area ────────────────────────────────────────────────── */}
      <Box sx={{ flex:1, display:'flex', flexDirection:'column', overflow:'hidden' }}>

        {/* Header — analytics identity bar */}
        <Box sx={{
          height: HEADER_H, flexShrink:0, position:'relative',
          display:'flex', alignItems:'center', justifyContent:'space-between',
          px:{ xs:1.5, md:3 },
          background:'linear-gradient(90deg, #ffffff 0%, #faf9ff 55%, #f6f4ff 100%)',
          borderBottom:'1px solid rgba(124,58,237,0.10)',
          boxShadow:'0 2px 10px rgba(15,23,42,0.05)',
          // signature gradient hairline along the bottom edge
          '&::after': {
            content:'""', position:'absolute', left:0, right:0, bottom:-1, height:2,
            background:'linear-gradient(90deg, #7c3aed 0%, #a78bfa 40%, #22d3ee 100%)',
            opacity:0.85,
          },
        }}>
          {/* Brand logo lives in the sidebar — the header carries the product
              wordmark only (duplicate logo overlapped the title). */}
          <Box sx={{ display:'flex', alignItems:'center', gap:1.5, minWidth:0, overflow:'hidden' }}>
            {/* Mobile-only hamburger — opens the nav Drawer; hidden on desktop */}
            <IconButton onClick={() => setDrawerOpen(true)} size="small"
              sx={{ display:{ xs:'inline-flex', md:'none' }, color:'#475569', ml:-0.5, mr:0.5 }}>
              <MenuIcon />
            </IconButton>
            <Box sx={{ minWidth:0 }}>
              <Typography component="div" noWrap
                sx={{ fontSize:15, fontWeight:800, letterSpacing:0.2, lineHeight:'18px' }}>
                {(() => {
                  // Two-tone wordmark: first word dark, remainder gradient.
                  // Custom brand names render the same way; single-word names
                  // fall back to an all-gradient wordmark.
                  const parts = brandName.trim().split(/\s+/)
                  const first = parts.length > 1 ? parts[0] : ''
                  const rest  = parts.length > 1 ? parts.slice(1).join(' ') : brandName
                  return (<>
                    {first && <Box component="span" sx={{ color:'#0f172a' }}>{first}&nbsp;</Box>}
                    <Box component="span" sx={{
                      background:'linear-gradient(90deg, #7c3aed, #22d3ee)',
                      WebkitBackgroundClip:'text', backgroundClip:'text', color:'transparent',
                    }}>
                      {rest}
                    </Box>
                  </>)
                })()}
              </Typography>
              <Typography noWrap sx={{ fontSize:10, color:'#94a3b8', fontWeight:600,
                                       letterSpacing:1, textTransform:'uppercase', lineHeight:'13px',
                                       display:{ xs:'none', sm:'block' } }}>
                Retail Pro Prism · Retail Intelligence
              </Typography>
            </Box>
          </Box>
          <Box sx={{ display:'flex', alignItems:'center', gap:{ xs:0.75, md:1.5 }, flexShrink:0 }}>
            {(brandSettings?.connection?.alias || brandSettings?.connection?.host) && (
              <Tooltip title={`${brandSettings?.connection?.host ?? ''}${brandSettings?.connection?.sid ? ' · ' + brandSettings.connection.sid : ''}`}>
                <Box sx={{
                  display:{ xs:'none', sm:'flex' }, alignItems:'center', gap:0.8,
                  px:1.5, py:0.5, borderRadius:99,
                  bgcolor:'rgba(6,182,212,0.06)', border:'1px solid rgba(6,182,212,0.18)',
                }}>
                  <Box sx={{ width:6, height:6, borderRadius:'50%', bgcolor:'#06b6d4' }} />
                  <Typography sx={{ fontSize:12, color:'#475569', fontWeight:600, maxWidth:180,
                                    whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>
                    {brandSettings?.connection?.alias?.trim() || brandSettings?.connection?.host}
                  </Typography>
                </Box>
              </Tooltip>
            )}
            <SubsidiarySelect />
            <ValidationBadge />
            <SyncBadge />
            <Box sx={{
              display:{ xs:'none', md:'flex' }, alignItems:'center', gap:0.8, flexShrink:0,
              px:1.5, py:0.5, borderRadius:99,
              bgcolor:'rgba(124,58,237,0.06)', border:'1px solid rgba(124,58,237,0.12)',
            }}>
              <Box sx={{ width:6, height:6, borderRadius:'50%', bgcolor:'#7c3aed' }} />
              <Typography noWrap sx={{ fontSize:12, color:'#475569', fontWeight:600 }}>
                {new Date().toLocaleDateString('en-GB', { weekday:'short', day:'2-digit', month:'short', year:'numeric' })}
              </Typography>
            </Box>
          </Box>
        </Box>

        {/* Page content */}
        <Box sx={{ flex:1, overflow:'auto', bgcolor:'#f8fafc' }}>
          <Outlet />
        </Box>
      </Box>
    </Box>
  )
}
