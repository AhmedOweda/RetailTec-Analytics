/**
 * Home dashboard — landing page.
 * One-shot summary from /api/home/summary: KPIs with 30d-vs-prior deltas,
 * a 30-day sales trend, alerts, top stores/items, and quick links.
 */
import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { Box, Typography, Stack, Paper, Chip, Skeleton, Tooltip } from '@mui/material'
import { useQuery } from '@tanstack/react-query'
import ReactECharts from 'echarts-for-react'
import axios from 'axios'
import TrendingUpIcon   from '@mui/icons-material/TrendingUp'
import TrendingDownIcon from '@mui/icons-material/TrendingDown'
import WarningAmberIcon from '@mui/icons-material/WarningAmber'
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined'
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline'
import DashboardIcon    from '@mui/icons-material/Dashboard'
import MenuBookIcon     from '@mui/icons-material/MenuBook'
import WarehouseIcon    from '@mui/icons-material/Warehouse'
import PeopleIcon       from '@mui/icons-material/People'
import AssessmentIcon   from '@mui/icons-material/Assessment'
import SmartToyIcon     from '@mui/icons-material/SmartToy'
import OpenInNewIcon    from '@mui/icons-material/OpenInNew'
import { money, num } from '../utils/formatters'
import { MoneyText } from '../components/RiyalSign'
import { tr } from '../i18n'
import TitleLoader from '../components/TitleLoader'

const ACCENT = '#7c3aed'

function Delta({ v, invert = false }: { v: number | null; invert?: boolean }) {
  if (v == null) return <Typography component="span" sx={{ fontSize: 12, color: '#94a3b8' }}>—</Typography>
  const good = invert ? v <= 0 : v >= 0
  const color = v === 0 ? '#94a3b8' : good ? '#059669' : '#e11d48'
  const Icon = v >= 0 ? TrendingUpIcon : TrendingDownIcon
  return (
    <Typography component="span" sx={{ fontSize: 12, fontWeight: 700, color, display: 'inline-flex', alignItems: 'center', gap: 0.3 }}>
      <Icon sx={{ fontSize: 14 }} />{v > 0 ? '+' : ''}{v}%
    </Typography>
  )
}

function Kpi({ label, value, delta, sub, invert }: { label: string; value: React.ReactNode; delta?: number | null; sub?: string; invert?: boolean }) {
  return (
    <Paper elevation={0} sx={{ p: 2, borderRadius: 2, border: '1px solid var(--rt-border)', bgcolor: 'var(--rt-surface)' }}>
      <Typography sx={{ fontSize: 11, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.5px' }}>{label}</Typography>
      <Typography sx={{ fontSize: 24, fontWeight: 800, color: 'var(--rt-text)', mt: 0.5, lineHeight: 1.1 }}>{value}</Typography>
      <Box sx={{ mt: 0.5, display: 'flex', gap: 1, alignItems: 'center' }}>
        {delta !== undefined && <Delta v={delta} invert={invert} />}
        {sub && <Typography sx={{ fontSize: 11, color: '#94a3b8' }}>{sub}</Typography>}
      </Box>
    </Paper>
  )
}

const QUICK_LINKS = [
  { to: '/sales/overview',       label: 'Sales Overview', icon: <DashboardIcon /> },
  { to: '/sales/journals',       label: 'Journals',       icon: <MenuBookIcon /> },
  { to: '/inventory/coverage',   label: 'Coverage',       icon: <WarehouseIcon /> },
  { to: '/dimensions/customers', label: 'Customers',      icon: <PeopleIcon /> },
  { to: '/inventory/ledger',     label: 'Ledger',         icon: <AssessmentIcon /> },
  { to: '/assistant',            label: 'Ask AI',         icon: <SmartToyIcon /> },
]

export default function Home() {
  const navigate = useNavigate()
  const { data, isLoading } = useQuery({
    queryKey: ['home-summary'],
    queryFn: () => axios.get('/api/home/summary').then(r => r.data),
    staleTime: 60_000,
  })

  const k = data?.kpis
  const trendOpt = useMemo(() => {
    const t = data?.trend ?? []
    return {
      grid: { left: 8, right: 12, top: 18, bottom: 20, containLabel: true },
      xAxis: { type: 'category', data: t.map((x: any) => x.date), axisLabel: { fontSize: 10, color: '#94a3b8' }, boundaryGap: false },
      yAxis: { type: 'value', axisLabel: { fontSize: 10, color: '#94a3b8', formatter: (v: number) => num(v) }, splitLine: { lineStyle: { color: '#f1f5f9' } } },
      tooltip: { trigger: 'axis', valueFormatter: (v: number) => num(v) },
      series: [{
        type: 'line', smooth: true, showSymbol: false,
        data: t.map((x: any) => x.net),
        lineStyle: { color: ACCENT, width: 2.5 },
        areaStyle: { color: 'rgba(124,58,237,0.10)' },
      }],
    }
  }, [data])

  const alertIcon = (lvl: string) =>
    lvl === 'warning' ? <WarningAmberIcon sx={{ fontSize: 20, color: '#d97706' }} />
    : lvl === 'ok'    ? <CheckCircleOutlineIcon sx={{ fontSize: 20, color: '#059669' }} />
    :                   <InfoOutlinedIcon sx={{ fontSize: 20, color: '#0284c7' }} />

  return (
    <Box sx={{ pt: 0, px: 3, pb: 3 }}>
      <Box sx={{ position: 'sticky', top: 0, zIndex: 10, bgcolor: 'var(--rt-surface-2)', mx: -3, px: 3, pt: 2.5, pb: 1.5, mb: 2, borderBottom: '1px solid var(--rt-border)' }}>
        <Typography variant="h6" sx={{ fontWeight: 700, fontSize: 20, color: 'var(--rt-text)', letterSpacing: '-0.3px' }}>
          {tr('Home')}<TitleLoader />
        </Typography>
        <Typography sx={{ fontSize: 12, color: '#64748b' }}>
          {tr('Last 30 days vs the previous 30 days')}{data?.as_of ? ` · ${tr('as of')} ${data.as_of}` : ''}
        </Typography>
      </Box>

      {/* KPIs */}
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'repeat(2,1fr)', md: 'repeat(4,1fr)' }, gap: 2 }}>
        {isLoading || !k ? (
          Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} variant="rounded" height={104} />)
        ) : (
          <>
            <Kpi label={tr('Net Sales (30d)')}   value={<MoneyText text={money(k.net_30)} />} delta={k.net_delta} sub={tr('vs prev 30d')} />
            <Kpi label={tr('Invoices (30d)')}    value={num(k.inv_30, 0)} delta={k.inv_delta} sub={tr('vs prev 30d')} />
            <Kpi label={tr('Avg Basket (30d)')}  value={<MoneyText text={money(k.avg_30)} />} delta={k.avg_delta} sub={tr('vs prev 30d')} />
            <Kpi label={tr("Today's Sales")}     value={<MoneyText text={money(k.net_today)} />} sub={tr('latest warehouse day')} />
          </>
        )}
      </Box>

      {/* Purchasing + Inventory KPIs */}
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'repeat(2,1fr)', md: 'repeat(4,1fr)' }, gap: 2, mt: 2 }}>
        {isLoading || !data ? (
          Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} variant="rounded" height={104} />)
        ) : (
          <>
            <Kpi label={tr('Purchases (30d)')} value={<MoneyText text={money(data.purchasing?.value_30 ?? 0)} />} delta={data.purchasing?.value_delta} sub={tr('vs prev 30d')} />
            <Kpi label={tr('Stock Value')}     value={<MoneyText text={money(data.inventory?.stock_cost ?? 0)} />} sub={tr('on-hand × cost')} />
            <Kpi label={tr('Active SKUs')}     value={num(data.inventory?.sku_count ?? 0, 0)} sub={tr('with stock on hand')} />
            <Kpi label={tr('Negative Stock')}  value={num(data.inventory?.neg_stock ?? 0, 0)} sub={tr('item × store rows')} invert delta={undefined} />
          </>
        )}
      </Box>

      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '2fr 1fr' }, gap: 2, mt: 2 }}>
        {/* Trend */}
        <Paper elevation={0} sx={{ p: 2, borderRadius: 2, border: '1px solid var(--rt-border)', bgcolor: 'var(--rt-surface)' }}>
          <Typography sx={{ fontWeight: 700, fontSize: 13, mb: 1 }}>{tr('Sales trend — last 30 days')}</Typography>
          {isLoading ? <Skeleton variant="rounded" height={240} /> : <ReactECharts option={trendOpt} style={{ height: 240 }} />}
        </Paper>

        {/* Alerts */}
        <Paper elevation={0} sx={{ p: 2, borderRadius: 2, border: '1px solid var(--rt-border)', bgcolor: 'var(--rt-surface)' }}>
          <Typography sx={{ fontWeight: 700, fontSize: 13, mb: 1 }}>{tr('Alerts')}</Typography>
          <Stack spacing={1}>
            {(data?.alerts ?? []).map((a: any, i: number) => (
              <Tooltip key={i} title={a.link ? tr('Click to open the related screen') : ''} arrow placement="left">
              <Box onClick={() => a.link && navigate(a.link)}
                sx={{ display: 'flex', gap: 1, alignItems: 'flex-start', p: 1, borderRadius: 1.5,
                      cursor: a.link ? 'pointer' : 'default', bgcolor: 'var(--rt-surface-2)',
                      '&:hover': a.link ? { bgcolor: 'var(--rt-surface-3)' } : {} }}>
                {alertIcon(a.level)}
                <Box>
                  <Typography sx={{ fontSize: 12.5, fontWeight: 700, color: 'var(--rt-text)' }}>{tr(a.title)}</Typography>
                  <Typography sx={{ fontSize: 11.5, color: '#64748b' }}>{tr(a.detail)}</Typography>
                </Box>
              </Box></Tooltip>
            ))}
          </Stack>
        </Paper>
      </Box>

      {/* Top stores + items + suppliers */}
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'repeat(3,1fr)' }, gap: 2, mt: 2 }}>
        <Paper elevation={0} sx={{ p: 2, borderRadius: 2, border: '1px solid var(--rt-border)', bgcolor: 'var(--rt-surface)' }}>
          <Typography sx={{ fontWeight: 700, fontSize: 13, mb: 1 }}>{tr('Top stores (30d)')}</Typography>
          <Stack spacing={0.5}>
            {(data?.top_stores ?? []).map((s: any, i: number) => (
              <Box key={i} sx={{ display: 'flex', justifyContent: 'space-between', py: 0.5, borderBottom: '1px solid var(--rt-border)' }}>
                <Typography sx={{ fontSize: 12.5, color: 'var(--rt-text-2)' }}>{s.name}</Typography>
                <Typography sx={{ fontSize: 12.5, fontWeight: 700, color: 'var(--rt-text)' }}><MoneyText text={money(s.net)} /></Typography>
              </Box>
            ))}
          </Stack>
        </Paper>
        <Paper elevation={0} sx={{ p: 2, borderRadius: 2, border: '1px solid var(--rt-border)', bgcolor: 'var(--rt-surface)' }}>
          <Typography sx={{ fontWeight: 700, fontSize: 13, mb: 1 }}>{tr('Top items (30d)')}</Typography>
          <Stack spacing={0.5}>
            {(data?.top_items ?? []).map((it: any, i: number) => (
              <Tooltip key={i} title={tr('Click to open this item in Journals')} arrow placement="left"><Box onClick={() => navigate(`/sales/journals?item=${encodeURIComponent(it.alu)}&item_desc=${encodeURIComponent(it.name ?? '')}`)}
                sx={{ display: 'flex', justifyContent: 'space-between', py: 0.5, borderBottom: '1px solid var(--rt-border)', cursor: 'pointer', '&:hover': { bgcolor: 'var(--rt-surface-2)' } }}>
                <Typography sx={{ fontSize: 12.5, color: 'var(--rt-text-2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 260, display: 'flex', alignItems: 'center', gap: 0.5 }}>
                  <OpenInNewIcon sx={{ fontSize: 13, color: '#c4b5fd' }} />{it.name || it.alu}
                </Typography>
                <Typography sx={{ fontSize: 12.5, fontWeight: 700, color: 'var(--rt-text)' }}><MoneyText text={money(it.net)} /></Typography>
              </Box></Tooltip>
            ))}
          </Stack>
        </Paper>
        <Paper elevation={0} sx={{ p: 2, borderRadius: 2, border: '1px solid var(--rt-border)', bgcolor: 'var(--rt-surface)' }}>
          <Typography sx={{ fontWeight: 700, fontSize: 13, mb: 1 }}>{tr('Top suppliers (30d)')}</Typography>
          <Stack spacing={0.5}>
            {((data?.purchasing?.top_vendors ?? []) as any[]).map((v: any, i: number) => (
              <Box key={i} sx={{ display: 'flex', justifyContent: 'space-between', py: 0.5, borderBottom: '1px solid var(--rt-border)' }}>
                <Typography sx={{ fontSize: 12.5, color: 'var(--rt-text-2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 200 }}>{v.name}</Typography>
                <Typography sx={{ fontSize: 12.5, fontWeight: 700, color: 'var(--rt-text)' }}><MoneyText text={money(v.net)} /></Typography>
              </Box>
            ))}
            {(!data?.purchasing?.top_vendors || data.purchasing.top_vendors.length === 0) && (
              <Typography sx={{ fontSize: 12, color: '#94a3b8', py: 1 }}>{tr('No purchases in the last 30 days')}</Typography>
            )}
          </Stack>
        </Paper>
      </Box>

      {/* Quick links */}
      <Typography sx={{ fontWeight: 700, fontSize: 13, mt: 3, mb: 1, color: 'var(--rt-text-2)' }}>{tr('Quick links')}</Typography>
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'repeat(2,1fr)', sm: 'repeat(3,1fr)', md: 'repeat(6,1fr)' }, gap: 1.5 }}>
        {QUICK_LINKS.map(q => (
          <Paper key={q.to} elevation={0} onClick={() => navigate(q.to)}
            sx={{ p: 1.75, borderRadius: 2, border: '1px solid var(--rt-border)', bgcolor: 'var(--rt-surface)', cursor: 'pointer',
                  display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0.75, textAlign: 'center',
                  color: ACCENT, transition: 'all .15s', '&:hover': { borderColor: ACCENT, boxShadow: '0 4px 12px rgba(124,58,237,0.12)' } }}>
            {q.icon}
            <Typography sx={{ fontSize: 11.5, fontWeight: 600, color: 'var(--rt-text-2)' }}>{tr(q.label)}</Typography>
          </Paper>
        ))}
      </Box>
    </Box>
  )
}
