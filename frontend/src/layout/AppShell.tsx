/**
 * AppShell — persistent sidebar + header + page outlet
 * Same dark-purple theme as the original dashboard.
 */
import { useState } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import {
  Box, Tooltip, Typography, Divider, CircularProgress,
  IconButton, Collapse,
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
import { useQuery }      from '@tanstack/react-query'
import axios             from 'axios'
import { useAuth }       from '../contexts/AuthContext'

// ── Brand colours ──────────────────────────────────────────────────────────
const SIDEBAR_BG   = '#160b33'
const SIDEBAR_W    = 220
const ACCENT       = '#7c3aed'
const ACCENT_LIGHT = '#ede9fe'
const HEADER_H     = 56

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
  { to: '/dimensions/vendors',   icon: <LocalShippingIcon />, label: 'Vendors'   },
]

const INVENTORY_NAV = [
  { to: '/inventory/overview',    icon: <WarehouseIcon     />, label: 'Stock Levels' },
  { to: '/inventory/movement',    icon: <SwapHorizIcon     />, label: 'Movement'     },
  { to: '/inventory/transfers',   icon: <CompareArrowsIcon />, label: 'Transfers'    },
  { to: '/inventory/adjustments', icon: <AdjustIcon        />, label: 'Adjustments'  },
  { to: '/inventory/ledger',      icon: <AssessmentIcon        />, label: 'Ledger'    },
  { to: '/inventory/coverage',   icon: <CalendarViewWeekIcon  />, label: 'Coverage'  },
]

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

// ── Reusable NavLink renderer ──────────────────────────────────────────────
function NavItem({ to, icon, label }: { to: string; icon: React.ReactNode; label: string }) {
  return (
    <NavLink key={to} to={to} style={{ textDecoration:'none' }}>
      {({ isActive }) => (
        <Box sx={{
          display:'flex', alignItems:'center', gap:1.5,
          px:1.5, py:1, borderRadius:1.5, mb:0.5, cursor:'pointer',
          bgcolor: isActive ? 'rgba(124,58,237,0.18)' : 'transparent',
          color:   isActive ? ACCENT_LIGHT : 'rgba(255,255,255,0.6)',
          '&:hover': { bgcolor:'rgba(255,255,255,0.06)', color:'#fff' },
          transition:'all 0.15s',
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

  // ── Sidebar section collapse state (all expanded by default) ─────
  const [salesOpen,      setSalesOpen     ] = useState(true)
  const [inventoryOpen,  setInventoryOpen ] = useState(true)
  const [purchasesOpen,  setPurchasesOpen ] = useState(true)
  const [dimensionsOpen, setDimensionsOpen] = useState(true)

  return (
    <Box sx={{ display:'flex', height:'100vh', overflow:'hidden' }}>

      {/* ── Sidebar ──────────────────────────────────────────────────── */}
      <Box sx={{
        width: SIDEBAR_W, flexShrink: 0,
        bgcolor: SIDEBAR_BG, display:'flex', flexDirection:'column',
        borderRight: '1px solid rgba(255,255,255,0.06)',
      }}>
        {/* Logo */}
        <Box sx={{ px:2.5, py:2, display:'flex', alignItems:'center', gap:1.5,
                   borderBottom:'1px solid rgba(255,255,255,0.08)' }}>
          <Box component="img" src="/logo-white.png" alt="RetailTec"
               sx={{ height:36, objectFit:'contain' }} />
        </Box>

        {/* ── Scrollable nav area ─────────────────────────────────────── */}
        <Box sx={{ flex:1, overflowY:'auto', overflowX:'hidden',
                   '&::-webkit-scrollbar':{ width:4 },
                   '&::-webkit-scrollbar-thumb':{ bgcolor:'rgba(255,255,255,0.12)', borderRadius:2 } }}>

          {/* Sales section */}
          <Box onClick={() => setSalesOpen(o => !o)} sx={{
            px:2.5, pt:2.5, pb:0.5, display:'flex', alignItems:'center',
            justifyContent:'space-between', cursor:'pointer',
            '&:hover':{ bgcolor:'rgba(255,255,255,0.04)' },
          }}>
            <Typography sx={{ fontSize:10, fontWeight:700, color:'rgba(255,255,255,0.35)',
                              letterSpacing:1.2, textTransform:'uppercase' }}>Sales</Typography>
            <ExpandMoreIcon sx={{ fontSize:14, color:'rgba(255,255,255,0.3)',
              transform: salesOpen ? 'rotate(0deg)' : 'rotate(-90deg)',
              transition:'transform 0.2s' }} />
          </Box>
          <Collapse in={salesOpen}>
            <Box sx={{ px:1.5, pt:0.5 }}>
              {SALES_NAV.map(n => <NavItem key={n.to} {...n} />)}
            </Box>
          </Collapse>

          <Divider sx={{ borderColor:'rgba(255,255,255,0.08)', mx:2, my:1 }} />

          {/* Inventory section */}
          <Box onClick={() => setInventoryOpen(o => !o)} sx={{
            px:2.5, pb:0.5, display:'flex', alignItems:'center',
            justifyContent:'space-between', cursor:'pointer',
            '&:hover':{ bgcolor:'rgba(255,255,255,0.04)' },
          }}>
            <Typography sx={{ fontSize:10, fontWeight:700, color:'rgba(255,255,255,0.35)',
                              letterSpacing:1.2, textTransform:'uppercase' }}>Inventory</Typography>
            <ExpandMoreIcon sx={{ fontSize:14, color:'rgba(255,255,255,0.3)',
              transform: inventoryOpen ? 'rotate(0deg)' : 'rotate(-90deg)',
              transition:'transform 0.2s' }} />
          </Box>
          <Collapse in={inventoryOpen}>
            <Box sx={{ px:1.5, pt:0.5 }}>
              {INVENTORY_NAV.map(n => <NavItem key={n.to} {...n} />)}
            </Box>
          </Collapse>

          <Divider sx={{ borderColor:'rgba(255,255,255,0.08)', mx:2, my:1 }} />

          {/* Purchasing section */}
          <Box onClick={() => setPurchasesOpen(o => !o)} sx={{
            px:2.5, pb:0.5, display:'flex', alignItems:'center',
            justifyContent:'space-between', cursor:'pointer',
            '&:hover':{ bgcolor:'rgba(255,255,255,0.04)' },
          }}>
            <Typography sx={{ fontSize:10, fontWeight:700, color:'rgba(255,255,255,0.35)',
                              letterSpacing:1.2, textTransform:'uppercase' }}>Purchasing</Typography>
            <ExpandMoreIcon sx={{ fontSize:14, color:'rgba(255,255,255,0.3)',
              transform: purchasesOpen ? 'rotate(0deg)' : 'rotate(-90deg)',
              transition:'transform 0.2s' }} />
          </Box>
          <Collapse in={purchasesOpen}>
            <Box sx={{ px:1.5, pt:0.5 }}>
              {PURCHASES_NAV.map(n => <NavItem key={n.to} {...n} />)}
            </Box>
          </Collapse>

          <Divider sx={{ borderColor:'rgba(255,255,255,0.08)', mx:2, my:1 }} />

          {/* Dimensions section */}
          <Box onClick={() => setDimensionsOpen(o => !o)} sx={{
            px:2.5, pb:0.5, display:'flex', alignItems:'center',
            justifyContent:'space-between', cursor:'pointer',
            '&:hover':{ bgcolor:'rgba(255,255,255,0.04)' },
          }}>
            <Typography sx={{ fontSize:10, fontWeight:700, color:'rgba(255,255,255,0.35)',
                              letterSpacing:1.2, textTransform:'uppercase' }}>Dimensions</Typography>
            <ExpandMoreIcon sx={{ fontSize:14, color:'rgba(255,255,255,0.3)',
              transform: dimensionsOpen ? 'rotate(0deg)' : 'rotate(-90deg)',
              transition:'transform 0.2s' }} />
          </Box>
          <Collapse in={dimensionsOpen}>
            <Box sx={{ px:1.5, pt:0.5 }}>
              {DIMENSIONS_NAV.map(n => <NavItem key={n.to} {...n} />)}
            </Box>
          </Collapse>

          <Box sx={{ pb:1 }} />
        </Box>

        <Divider sx={{ borderColor:'rgba(255,255,255,0.08)' }} />

        {/* Settings + Users (admin only) + User info + Logout */}
        <Box sx={{ px:1.5, py:1.5 }}>
          {isAdmin && (
            <>
              <NavItem to="/settings"       icon={<SettingsIcon />}       label="Settings"  />
              <NavItem to="/settings/users" icon={<ManageAccountsIcon />} label="Users"     />
            </>
          )}

          {/* Logged-in user chip */}
          <Box sx={{
            display:'flex', alignItems:'center', gap:1, px:1.5, py:1,
            borderRadius:1.5, mt:0.5,
            bgcolor:'rgba(255,255,255,0.05)',
          }}>
            <Box sx={{
              width:28, height:28, borderRadius:'50%',
              bgcolor: ACCENT, display:'flex', alignItems:'center', justifyContent:'center',
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

      </Box>

      {/* ── Main area ────────────────────────────────────────────────── */}
      <Box sx={{ flex:1, display:'flex', flexDirection:'column', overflow:'hidden' }}>

        {/* Header — analytics identity bar */}
        <Box sx={{
          height: HEADER_H, flexShrink:0, position:'relative',
          display:'flex', alignItems:'center', justifyContent:'space-between',
          px:3,
          background:'linear-gradient(90deg, #ffffff 0%, #faf9ff 55%, #f6f4ff 100%)',
          borderBottom:'1px solid rgba(124,58,237,0.10)',
          // signature gradient hairline along the bottom edge
          '&::after': {
            content:'""', position:'absolute', left:0, right:0, bottom:-1, height:2,
            background:'linear-gradient(90deg, #7c3aed 0%, #a78bfa 40%, #22d3ee 100%)',
            opacity:0.85,
          },
        }}>
          <Box sx={{ display:'flex', alignItems:'center', gap:1.5 }}>
            <Box component="img" src="/logo-purple.png" alt="RetailTec"
                 sx={{ height:30, objectFit:'contain' }} />
            <Box sx={{ width:1, height:26, bgcolor:'rgba(100,116,139,0.18)' }} />
            <Box sx={{ lineHeight:1 }}>
              <Typography component="div" sx={{ fontSize:15, fontWeight:800, letterSpacing:0.2, lineHeight:1.15 }}>
                <Box component="span" sx={{ color:'#0f172a' }}>RetailTec&nbsp;</Box>
                <Box component="span" sx={{
                  background:'linear-gradient(90deg, #7c3aed, #22d3ee)',
                  WebkitBackgroundClip:'text', backgroundClip:'text', color:'transparent',
                }}>
                  Analytics
                </Box>
              </Typography>
              <Typography sx={{ fontSize:10.5, color:'#94a3b8', fontWeight:500,
                                letterSpacing:1.1, textTransform:'uppercase', lineHeight:1.4 }}>
                Retail Pro Prism · Live Retail Intelligence
              </Typography>
            </Box>
          </Box>
          <Box sx={{ display:'flex', alignItems:'center', gap:1.5 }}>
            <SyncBadge />
            <Box sx={{
              display:'flex', alignItems:'center', gap:0.8,
              px:1.5, py:0.5, borderRadius:99,
              bgcolor:'rgba(124,58,237,0.06)', border:'1px solid rgba(124,58,237,0.12)',
            }}>
              <Box sx={{ width:6, height:6, borderRadius:'50%', bgcolor:'#7c3aed' }} />
              <Typography sx={{ fontSize:12, color:'#475569', fontWeight:600 }}>
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
