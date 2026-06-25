/**
 * AppShell — persistent sidebar + header + page outlet
 * Same dark-purple theme as the original dashboard.
 */
import { useState } from 'react'
import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { Box, Tooltip, Typography, Divider, CircularProgress } from '@mui/material'
import DashboardIcon     from '@mui/icons-material/Dashboard'
import TrendingUpIcon    from '@mui/icons-material/TrendingUp'
import InventoryIcon     from '@mui/icons-material/Inventory2'
import ReceiptLongIcon   from '@mui/icons-material/ReceiptLong'
import SettingsIcon      from '@mui/icons-material/Settings'
import SyncIcon          from '@mui/icons-material/Sync'
import { useQuery }      from '@tanstack/react-query'
import axios             from 'axios'

// ── Brand colours ──────────────────────────────────────────────────────────
const SIDEBAR_BG   = '#160b33'
const SIDEBAR_W    = 220
const ACCENT       = '#7c3aed'
const ACCENT_LIGHT = '#ede9fe'
const HEADER_H     = 56

// ── Nav items ──────────────────────────────────────────────────────────────
const NAV = [
  { to: '/sales/overview',      icon: <DashboardIcon  />, label: 'Overview'     },
  { to: '/sales/performance',   icon: <TrendingUpIcon />, label: 'Performance'  },
  { to: '/sales/products',      icon: <InventoryIcon  />, label: 'Products'     },
  { to: '/sales/transactions',  icon: <ReceiptLongIcon/>, label: 'Transactions' },
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

        {/* Domain label */}
        <Box sx={{ px:2.5, pt:2.5, pb:0.5 }}>
          <Typography sx={{ fontSize:10, fontWeight:700, color:'rgba(255,255,255,0.35)',
                            letterSpacing:1.2, textTransform:'uppercase' }}>
            Sales
          </Typography>
        </Box>

        {/* Nav links */}
        <Box sx={{ flex:1, px:1.5, pt:0.5 }}>
          {NAV.map(({ to, icon, label }) => (
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

        {/* Settings link */}
        <Box sx={{ px:1.5, py:1.5 }}>
          <NavLink to="/settings" style={{ textDecoration:'none' }}>
            {({ isActive }) => (
              <Box sx={{
                display:'flex', alignItems:'center', gap:1.5,
                px:1.5, py:1, borderRadius:1.5, cursor:'pointer',
                bgcolor: isActive ? 'rgba(124,58,237,0.18)' : 'transparent',
                color:   isActive ? ACCENT_LIGHT : 'rgba(255,255,255,0.45)',
                '&:hover': { bgcolor:'rgba(255,255,255,0.06)', color:'#fff' },
                transition:'all 0.15s',
              }}>
                <SettingsIcon sx={{ fontSize:'18px !important' }} />
                <Typography sx={{ fontSize:13 }}>Settings</Typography>
              </Box>
            )}
          </NavLink>
        </Box>
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
