/**
 * AppShell — persistent sidebar + header + page outlet
 * Same dark-purple theme as the original dashboard.
 */
import { useState, useRef } from 'react'
import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import {
  Box, Tooltip, Typography, Divider, CircularProgress,
  Dialog, DialogTitle, DialogContent, DialogActions,
  TextField, Button, InputAdornment, IconButton, Fade,
} from '@mui/material'
import DashboardIcon        from '@mui/icons-material/Dashboard'
import TrendingUpIcon       from '@mui/icons-material/TrendingUp'
import InventoryIcon        from '@mui/icons-material/Inventory2'
import ReceiptLongIcon      from '@mui/icons-material/ReceiptLong'
import SettingsIcon         from '@mui/icons-material/Settings'
import WarehouseIcon        from '@mui/icons-material/Warehouse'
import SwapHorizIcon        from '@mui/icons-material/SwapHoriz'
import SyncIcon          from '@mui/icons-material/Sync'
import LockOutlinedIcon  from '@mui/icons-material/LockOutlined'
import VisibilityIcon    from '@mui/icons-material/Visibility'
import VisibilityOffIcon from '@mui/icons-material/VisibilityOff'
import { useQuery }      from '@tanstack/react-query'
import axios             from 'axios'

// ── Brand colours ──────────────────────────────────────────────────────────
const SIDEBAR_BG   = '#160b33'
const SIDEBAR_W    = 220
const ACCENT       = '#7c3aed'
const ACCENT2      = '#6d28d9'
const ACCENT_LIGHT = '#ede9fe'
const HEADER_H     = 56

// ── Nav items ──────────────────────────────────────────────────────────────
const SALES_NAV = [
  { to: '/sales/overview',      icon: <DashboardIcon  />, label: 'Overview'     },
  { to: '/sales/performance',   icon: <TrendingUpIcon />, label: 'Performance'  },
  { to: '/sales/products',      icon: <InventoryIcon  />, label: 'Products'     },
  { to: '/sales/transactions',  icon: <ReceiptLongIcon/>, label: 'Transactions' },
]

const INVENTORY_NAV = [
  { to: '/inventory/overview',  icon: <WarehouseIcon  />, label: 'Stock Levels' },
  { to: '/inventory/movement',  icon: <SwapHorizIcon  />, label: 'Movement'     },
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

// ── AppShell ───────────────────────────────────────────────────────────────
export default function AppShell() {
  const navigate = useNavigate()

  // ── Settings password gate ────────────────────────────────────────
  const [lockOpen,  setLockOpen ] = useState(false)
  const [password,  setPassword ] = useState('')
  const [showPwd,   setShowPwd  ] = useState(false)
  const [pwdError,  setPwdError ] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const openLock = () => {
    setPassword(''); setPwdError(false); setShowPwd(false); setLockOpen(true)
    setTimeout(() => inputRef.current?.focus(), 120)
  }
  const submitLock = () => {
    if (password === 'sysadmin') {
      setLockOpen(false); navigate('/settings')
    } else {
      setPwdError(true); setPassword('')
      setTimeout(() => inputRef.current?.focus(), 80)
    }
  }

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

        {/* Domain label — Sales */}
        <Box sx={{ px:2.5, pt:2.5, pb:0.5 }}>
          <Typography sx={{ fontSize:10, fontWeight:700, color:'rgba(255,255,255,0.35)',
                            letterSpacing:1.2, textTransform:'uppercase' }}>
            Sales
          </Typography>
        </Box>

        {/* Sales Nav links */}
        <Box sx={{ px:1.5, pt:0.5 }}>
          {SALES_NAV.map(({ to, icon, label }) => (
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
          ))}
        </Box>

        <Divider sx={{ borderColor:'rgba(255,255,255,0.08)', mx:2, my:1 }} />

        {/* Domain label — Inventory */}
        <Box sx={{ px:2.5, pb:0.5 }}>
          <Typography sx={{ fontSize:10, fontWeight:700, color:'rgba(255,255,255,0.35)',
                            letterSpacing:1.2, textTransform:'uppercase' }}>
            Inventory
          </Typography>
        </Box>

        {/* Inventory Nav links */}
        <Box sx={{ flex:1, px:1.5, pt:0.5 }}>
          {INVENTORY_NAV.map(({ to, icon, label }) => (
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
          ))}
        </Box>

        <Divider sx={{ borderColor:'rgba(255,255,255,0.08)' }} />

        {/* Settings — password protected */}
        <Box sx={{ px:1.5, py:1.5 }}>
          <Box onClick={openLock} sx={{
            display:'flex', alignItems:'center', gap:1.5,
            px:1.5, py:1, borderRadius:1.5, cursor:'pointer',
            color:'rgba(255,255,255,0.45)',
            '&:hover': { bgcolor:'rgba(255,255,255,0.06)', color:'#fff' },
            transition:'all 0.15s',
          }}>
            <SettingsIcon sx={{ fontSize:'18px !important' }} />
            <Typography sx={{ fontSize:13 }}>Settings</Typography>
          </Box>
        </Box>

        {/* ── Password dialog ── */}
        <Dialog
          open={lockOpen}
          onClose={() => setLockOpen(false)}
          TransitionComponent={Fade}
          PaperProps={{ sx:{
            borderRadius:3, width:360,
            boxShadow:'0 24px 64px rgba(15,23,42,.22)',
            border:'1px solid #e9e4ff',
          }}}
        >
          <DialogTitle sx={{ pb:1 }}>
            <Box sx={{ display:'flex', alignItems:'center', gap:1.5 }}>
              <Box sx={{
                width:38, height:38, borderRadius:2,
                bgcolor:'#ede9fe', display:'flex', alignItems:'center', justifyContent:'center',
              }}>
                <LockOutlinedIcon sx={{ color:ACCENT, fontSize:20 }}/>
              </Box>
              <Box>
                <Typography sx={{ fontWeight:800, color:'#0f172a', fontSize:15, lineHeight:1.2 }}>
                  Settings Access
                </Typography>
                <Typography variant="caption" sx={{ color:'#94a3b8' }}>
                  Enter admin password to continue
                </Typography>
              </Box>
            </Box>
          </DialogTitle>

          <DialogContent sx={{ pt:2 }}>
            <TextField
              fullWidth
              size="small"
              inputRef={inputRef}
              label="Password"
              type={showPwd ? 'text' : 'password'}
              value={password}
              error={pwdError}
              helperText={pwdError ? 'Incorrect password — try again' : ''}
              onChange={e => { setPassword(e.target.value); setPwdError(false) }}
              onKeyDown={e => { if (e.key === 'Enter') submitLock() }}
              InputProps={{
                endAdornment:(
                  <InputAdornment position="end">
                    <IconButton size="small" onClick={() => setShowPwd(s => !s)} edge="end">
                      {showPwd
                        ? <VisibilityOffIcon sx={{ fontSize:18 }}/>
                        : <VisibilityIcon   sx={{ fontSize:18 }}/>
                      }
                    </IconButton>
                  </InputAdornment>
                ),
              }}
              sx={{ '& .MuiOutlinedInput-root':{ borderRadius:2 } }}
            />
          </DialogContent>

          <DialogActions sx={{ px:3, pb:2.5, gap:1 }}>
            <Button onClick={() => setLockOpen(false)}
              sx={{ textTransform:'none', fontWeight:600, color:'#94a3b8', borderRadius:2,
                '&:hover':{ color:'#64748b', bgcolor:'#f8fafc' } }}>
              Cancel
            </Button>
            <Button onClick={submitLock} variant="contained"
              sx={{ textTransform:'none', fontWeight:700, borderRadius:2, px:3,
                bgcolor:ACCENT, boxShadow:'0 2px 8px rgba(124,58,237,.35)',
                '&:hover':{ bgcolor:ACCENT2 } }}>
              Unlock
            </Button>
          </DialogActions>
        </Dialog>
      </Box>

      {/* ── Main area ────────────────────────────────────────────────── */}
      <Box sx={{ flex:1, display:'flex', flexDirection:'column', overflow:'hidden' }}>

        {/* Header */}
        <Box sx={{
          height: HEADER_H, flexShrink:0,
          display:'flex', alignItems:'center', justifyContent:'space-between',
          px:3, borderBottom:'1px solid rgba(0,0,0,0.08)',
          bgcolor:'#fff',
        }}>
          <Box sx={{ display:'flex', alignItems:'center', gap:1 }}>
            <Box component="img" src="/logo-purple.png" alt="RetailTec"
                 sx={{ height:28, objectFit:'contain' }} />
            <Typography sx={{ fontSize:13, color:'#64748b', fontWeight:500, ml:1 }}>
              Retail Pro Prism · RPS Schema
            </Typography>
          </Box>
          <Box sx={{ display:'flex', alignItems:'center', gap:2 }}>
            <SyncBadge />
            <Typography sx={{ fontSize:12, color:'#94a3b8' }}>
              {new Date().toLocaleDateString('en-GB', { day:'2-digit', month:'short', year:'numeric' })}
            </Typography>
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
