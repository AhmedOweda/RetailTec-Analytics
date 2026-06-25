/**
 * Performance page — date-range KPIs + trend + store + employee charts
 * Migrated from the original App.tsx dashboard.
 */
import { useState } from 'react'
import { Box, Card, CardContent, Typography, Chip, Alert, Skeleton } from '@mui/material'
import { useQuery }     from '@tanstack/react-query'
import axios            from 'axios'
import { format, subDays, startOfMonth } from 'date-fns'
import ReactECharts from 'echarts-for-react'
import { num } from '../../utils/formatters'

const ACCENT = '#7c3aed'

const QUICK = [
  { label:'7D',  days:7  },
  { label:'30D', days:30 },
  { label:'90D', days:90 },
  { label:'MTD', days:-1 },
]

function useDateRange(days: number) {
  const today = new Date()
  const from  = days === -1
    ? format(startOfMonth(today), 'yyyy-MM-dd')
    : format(subDays(today, days - 1), 'yyyy-MM-dd')
  const to = format(today, 'yyyy-MM-dd')
  return { from, to }
}

export default function Performance() {
  const [qk, setQk] = useState(30)
  const { from, to } = useDateRange(qk)

  const params = `date_from=${from}&date_to=${to}`

  const trend = useQuery({
    queryKey: ['trend', from, to],
    queryFn:  () => axios.get(`/api/sales/trend?${params}`).then(r => r.data),
  })
  const stores = useQuery({
    queryKey: ['stores', from, to],
    queryFn:  () => axios.get(`/api/sales/stores?${params}`).then(r => r.data),
  })
  const emps = useQuery({
    queryKey: ['employees', from, to],
    queryFn:  () => axios.get(`/api/sales/employees?${params}`).then(r => r.data),
  })

  const trendData  = trend.data  ?? []
  const storeData  = stores.data ?? []
  const empData    = emps.data   ?? []

  const totalSales = storeData.reduce((s: number, r: any) => s + (r.net_sales ?? 0), 0)

  return (
    <Box sx={{ p:3 }}>
      <Box sx={{ display:'flex', alignItems:'center', justifyContent:'space-between', mb:3 }}>
        <Box>
          <Typography variant="h6" sx={{ fontWeight:700, color:'#0f172a' }}>Performance</Typography>
          <Typography sx={{ fontSize:13, color:'#64748b' }}>{from} → {to}</Typography>
        </Box>
        <Box sx={{ display:'flex', gap:1 }}>
          {QUICK.map(q => (
            <Chip key={q.label} label={q.label} size="small"
                  onClick={() => setQk(q.days)}
                  sx={{ cursor:'pointer', fontWeight:600, fontSize:12,
                        bgcolor: qk === q.days ? ACCENT : 'transparent',
                        color:   qk === q.days ? '#fff'  : '#64748b',
                        border:  `1px solid ${qk === q.days ? ACCENT : '#e2e8f0'}` }} />
          ))}
        </Box>
      </Box>

      {/* KPI summary row */}
      <Box sx={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:2, mb:3 }}>
        {[
          { label:'Total Net Sales', value: num(totalSales) },
          { label:'Total Invoices',  value: storeData.reduce((s: number, r: any) => s + (r.sales_count ?? 0), 0) },
          { label:'Total Returns',   value: storeData.reduce((s: number, r: any) => s + (r.return_count ?? 0), 0) },
          { label:'Total Discount',  value: num(storeData.reduce((s: number, r: any) => s + (r.invoice_disc ?? 0), 0)) },
        ].map(({ label, value }) => (
          <Card key={label} elevation={0} sx={{ border:'1px solid #e2e8f0', borderRadius:2 }}>
            <CardContent sx={{ p:2, '&:last-child':{ pb:2 } }}>
              <Typography sx={{ fontSize:11, color:'#94a3b8', textTransform:'uppercase',
                                letterSpacing:1, fontWeight:700 }}>{label}</Typography>
              <Typography sx={{ fontSize:22, fontWeight:700, color:'#0f172a', mt:0.5 }}>{value}</Typography>
            </CardContent>
          </Card>
        ))}
      </Box>

      {/* Trend chart */}
      <Card elevation={0} sx={{ border:'1px solid #e2e8f0', borderRadius:2, mb:3 }}>
        <CardContent sx={{ p:2.5, '&:last-child':{ pb:2.5 } }}>
          <Typography sx={{ fontWeight:600, color:'#0f172a', mb:2 }}>Daily Sales Trend</Typography>
          {trend.isLoading ? <Skeleton height={220} /> : (
            <ReactECharts style={{ height:220 }} option={{
              tooltip: { trigger:'axis', formatter: (p: any) =>
                `${p[0].name}<br/>Net: <b>${num(p[0].value)}</b>` },
              grid: { left:60, right:20, top:10, bottom:30 },
              xAxis: { type:'category', data: trendData.map((r: any) => r.day),
                       axisLabel:{ fontSize:10, color:'#94a3b8' } },
              yAxis: { type:'value', axisLabel:{ formatter:(v: number) => num(v), fontSize:10, color:'#94a3b8' } },
              series: [{ type:'line', data: trendData.map((r: any) => r.net_sales ?? r.NET_SALES_WOTAX),
                         smooth:true, areaStyle:{ color:'rgba(124,58,237,0.08)' },
                         lineStyle:{ color: ACCENT, width:2 },
                         itemStyle:{ color: ACCENT }, symbol:'none' }],
            }} />
          )}
        </CardContent>
      </Card>

      {/* Store + Employee charts side by side */}
      <Box sx={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:2 }}>

        {/* Store breakdown */}
        <Card elevation={0} sx={{ border:'1px solid #e2e8f0', borderRadius:2 }}>
          <CardContent sx={{ p:2.5, '&:last-child':{ pb:2.5 } }}>
            <Typography sx={{ fontWeight:600, color:'#0f172a', mb:2 }}>Sales by Store</Typography>
            {stores.isLoading ? <Skeleton height={200} /> : (
              <ReactECharts style={{ height:200 }} option={{
                tooltip: { trigger:'axis' },
                grid: { left:120, right:20, top:5, bottom:20 },
                xAxis: { type:'value', axisLabel:{ formatter:(v: number) => num(v), fontSize:9 } },
                yAxis: { type:'category', data: storeData.slice(0,8).map((r: any) => r.store_name),
                         axisLabel:{ fontSize:10, color:'#475569' } },
                series: [{ type:'bar', data: storeData.slice(0,8).map((r: any) => r.net_sales),
                           itemStyle:{ color: ACCENT, borderRadius:[0,4,4,0] },
                           barMaxWidth:18 }],
              }} />
            )}
          </CardContent>
        </Card>

        {/* Top employees */}
        <Card elevation={0} sx={{ border:'1px solid #e2e8f0', borderRadius:2 }}>
          <CardContent sx={{ p:2.5, '&:last-child':{ pb:2.5 } }}>
            <Typography sx={{ fontWeight:600, color:'#0f172a', mb:2 }}>Top Associates</Typography>
            {emps.isLoading ? <Skeleton height={200} /> : (
              <ReactECharts style={{ height:200 }} option={{
                tooltip: { trigger:'axis' },
                grid: { left:120, right:20, top:5, bottom:20 },
                xAxis: { type:'value', axisLabel:{ formatter:(v: number) => num(v), fontSize:9 } },
                yAxis: { type:'category', data: empData.slice(0,8).map((r: any) => r.employee_name),
                         axisLabel:{ fontSize:10, color:'#475569' } },
                series: [{ type:'bar', data: empData.slice(0,8).map((r: any) => r.net_sales),
                           itemStyle:{ color:'#06b6d4', borderRadius:[0,4,4,0] },
                           barMaxWidth:18 }],
              }} />
            )}
          </CardContent>
        </Card>
      </Box>
    </Box>
  )
}
