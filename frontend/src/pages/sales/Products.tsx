/**
 * Products page — Top items, DCS breakdown, vendor, margin %
 */
import { useState } from 'react'
import { Box, Card, CardContent, Typography, Chip, Tab, Tabs, LinearProgress } from '@mui/material'
import { useQuery }  from '@tanstack/react-query'
import axios         from 'axios'
import { format, subDays } from 'date-fns'
import { num, pct } from '../../utils/formatters'

const ACCENT = '#7c3aed'
const VIEWS  = ['item','department','dcs','vendor'] as const
type View = typeof VIEWS[number]

export default function Products() {
  const [days, setDays]   = useState(30)
  const [view, setView]   = useState<View>('item')

  const to   = format(new Date(), 'yyyy-MM-dd')
  const from = format(subDays(new Date(), days - 1), 'yyyy-MM-dd')

  const { data = [], isLoading } = useQuery({
    queryKey: ['products', from, to, view],
    queryFn:  () => axios.get(
      `/api/sales/products?date_from=${from}&date_to=${to}&group_by=${view}&limit=25`
    ).then(r => r.data),
  })

  const maxRev = Math.max(...data.map((r: any) => r.revenue ?? 0), 1)

  return (
    <Box sx={{ p:3 }}>
      <Box sx={{ display:'flex', alignItems:'center', justifyContent:'space-between', mb:3 }}>
        <Typography variant="h6" sx={{ fontWeight:700, color:'#0f172a' }}>Products</Typography>
        <Box sx={{ display:'flex', gap:1 }}>
          {[7,30,90].map(d => (
            <Chip key={d} label={`${d}D`} size="small" onClick={() => setDays(d)}
                  sx={{ cursor:'pointer', fontWeight:600, fontSize:12,
                        bgcolor: days === d ? ACCENT : 'transparent',
                        color:   days === d ? '#fff'  : '#64748b',
                        border:  `1px solid ${days === d ? ACCENT : '#e2e8f0'}` }} />
          ))}
        </Box>
      </Box>

      {/* View tabs */}
      <Box sx={{ mb:2, borderBottom:'1px solid #e2e8f0' }}>
        <Tabs value={view} onChange={(_, v) => setView(v)}
              sx={{ '& .MuiTab-root':{ fontSize:12, textTransform:'none', minHeight:40, fontWeight:500 },
                    '& .Mui-selected':{ color:`${ACCENT} !important` },
                    '& .MuiTabs-indicator':{ bgcolor:ACCENT } }}>
          <Tab value="item"       label="Top Items"   />
          <Tab value="department" label="Department"  />
          <Tab value="dcs"        label="DCS"         />
          <Tab value="vendor"     label="Vendor"      />
        </Tabs>
      </Box>

      {isLoading && <LinearProgress sx={{ mb:2, '& .MuiLinearProgress-bar':{ bgcolor:ACCENT } }} />}

      <Card elevation={0} sx={{ border:'1px solid #e2e8f0', borderRadius:2 }}>
        {/* Table header */}
        <Box sx={{ display:'grid', gridTemplateColumns:'2fr 1fr 1fr 1fr 80px',
                   px:2, py:1, bgcolor:'#f8fafc', borderBottom:'1px solid #e2e8f0' }}>
          {['Name / Code','Qty','Revenue','GP','GP%'].map(h => (
            <Typography key={h} sx={{ fontSize:11, fontWeight:700, color:'#64748b',
                                      textTransform:'uppercase', letterSpacing:0.8 }}>
              {h}
            </Typography>
          ))}
        </Box>

        {data.map((row: any, i: number) => {
          const name = row.description1 ?? row.name ?? row.department ?? row.dcs_code ?? row.alu ?? '—'
          const sub  = view === 'item' ? (row.vendor_name ?? '') : (row.class ?? '')
          return (
            <Box key={i} sx={{
              display:'grid', gridTemplateColumns:'2fr 1fr 1fr 1fr 80px',
              px:2, py:1.2, alignItems:'center',
              borderBottom:'1px solid #f1f5f9',
              '&:hover':{ bgcolor:'#fafafe' },
            }}>
              <Box>
                <Typography sx={{ fontSize:13, fontWeight:500, color:'#0f172a' }}>{name}</Typography>
                {sub && <Typography sx={{ fontSize:11, color:'#94a3b8' }}>{sub}</Typography>}
                {/* Revenue bar */}
                <Box sx={{ mt:0.5, height:3, borderRadius:2,
                           bgcolor:`rgba(124,58,237,${(row.revenue/maxRev)*0.35 + 0.05})`,
                           width:`${(row.revenue/maxRev)*100}%`, maxWidth:'100%' }} />
              </Box>
              <Typography sx={{ fontSize:13, color:'#475569' }}>{num(row.qty ?? 0, 2)}</Typography>
              <Typography sx={{ fontSize:13, fontWeight:600, color:'#0f172a' }}>{num(row.revenue ?? 0)}</Typography>
              <Typography sx={{ fontSize:13, color: (row.gp ?? 0) >= 0 ? '#16a34a' : '#ef4444',
                                fontWeight:500 }}>{num(row.gp ?? 0)}</Typography>
              <Box sx={{ display:'flex', alignItems:'center', gap:0.5 }}>
                <Typography sx={{ fontSize:13, fontWeight:700,
                                  color: (row.gp_pct ?? 0) >= 30 ? '#16a34a'
                                       : (row.gp_pct ?? 0) >= 10 ? '#f59e0b' : '#ef4444' }}>
                  {pct(row.gp_pct ?? 0)}
                </Typography>
              </Box>
            </Box>
          )
        })}

        {data.length === 0 && !isLoading && (
          <Box sx={{ py:6, textAlign:'center' }}>
            <Typography sx={{ color:'#94a3b8', fontSize:13 }}>
              No data — run an initial load from Settings first.
            </Typography>
          </Box>
        )}
      </Card>
    </Box>
  )
}
