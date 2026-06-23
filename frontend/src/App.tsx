import { useState, useMemo } from 'react'
import {
  Box, Card, CardContent, Typography, Alert, Chip, Tooltip,
  Dialog, DialogContent, IconButton,
} from '@mui/material'
import FullscreenIcon     from '@mui/icons-material/Fullscreen'
import CloseIcon          from '@mui/icons-material/Close'
import RefreshIcon        from '@mui/icons-material/Refresh'
import BoltIcon           from '@mui/icons-material/Bolt'
import SyncIcon           from '@mui/icons-material/Sync'
import { format, startOfMonth } from 'date-fns'
import { useTheme } from '@mui/material/styles'
import Header           from './components/Header'
import Sidebar          from './components/Sidebar'
import KpiGrid          from './components/KpiGrid'
import LoadingProgress  from './components/LoadingProgress'
import TransactionsGrid from './components/TransactionsGrid'
import TrendChart       from './components/charts/TrendChart'
import StoreChart       from './components/charts/StoreChart'
import EmployeeChart    from './components/charts/EmployeeChart'
import TopItemsChart    from './components/charts/TopItemsChart'
import MonthlyChart     from './components/charts/MonthlyChart'
import DonutChart       from './components/charts/DonutChart'
import { useStreamingDashboard } from './hooks/useStreamingDashboard'
import { num } from './utils/formatters'
import type { KpiDerived } from './types'

const today = new Date()
const FS_HEIGHT = Math.round(window.innerHeight * 0.75)

// ── Format seconds to human string ────────────────────────────
function fmtAge(seconds: number): string {
  if (seconds < 60)   return `${seconds}s ago`
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  return m > 0 ? `${h}h ${m}m ago` : `${h}h ago`
}

// ── Cache status badge ─────────────────────────────────────────
interface CacheBadgeProps {
  cached:   boolean
  cacheAge: number   // seconds
  onRefresh: () => void
  loading:  boolean
}

function CacheBadge({ cached, cacheAge, onRefresh, loading }: CacheBadgeProps) {
  const theme = useTheme()
  const dark  = theme.palette.mode === 'dark'

  if (loading) return null

  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, justifyContent: 'flex-end', mb: -0.5 }}>
      {cached ? (
        <Chip
          icon={<BoltIcon sx={{ fontSize: '14px !important' }} />}
          label={`From cache · ${fmtAge(cacheAge)}`}
          size="small"
          sx={{
            height: 24, fontSize: '0.68rem', fontWeight: 600,
            fontFamily: '"Plus Jakarta Sans", sans-serif',
            background: dark ? 'rgba(34,197,94,0.12)' : 'rgba(22,163,74,0.08)',
            color: dark ? '#4ade80' : '#16a34a',
            border: `1px solid ${dark ? 'rgba(74,222,128,0.2)' : 'rgba(22,163,74,0.2)'}`,
            '& .MuiChip-icon': { color: 'inherit' },
          }}
        />
      ) : (
        <Chip
          icon={<SyncIcon sx={{ fontSize: '14px !important' }} />}
          label="Live data"
          size="small"
          sx={{
            height: 24, fontSize: '0.68rem', fontWeight: 600,
            fontFamily: '"Plus Jakarta Sans", sans-serif',
            background: dark ? 'rgba(139,92,246,0.12)' : 'rgba(112,64,184,0.08)',
            color: dark ? '#a78bfa' : '#7040B8',
            border: `1px solid ${dark ? 'rgba(167,139,250,0.2)' : 'rgba(112,64,184,0.2)'}`,
            '& .MuiChip-icon': { color: 'inherit' },
          }}
        />
      )}
      <Tooltip title="Force refresh (bypass cache)" arrow>
        <IconButton
          size="small"
          onClick={onRefresh}
          sx={{
            width: 28, height: 28,
            color: dark ? 'rgba(155,101,208,0.6)' : 'rgba(112,64,184,0.5)',
            '&:hover': {
              color: '#7040B8',
              background: 'rgba(112,64,184,0.08)',
              transform: 'rotate(180deg)',
              transition: 'transform 0.4s',
            },
          }}
        >
          <RefreshIcon sx={{ fontSize: 16 }} />
        </IconButton>
      </Tooltip>
    </Box>
  )
}

// ─── ChartCard with fullscreen dialog ─────────────────────────
interface ChartCardProps {
  title:    string
  children: (height: number) => React.ReactNode
  defaultH?: number
}

function ChartCard({ title, children, defaultH = 220 }: ChartCardProps) {
  const [open, setOpen] = useState(false)
  const theme = useTheme()
  const dark  = theme.palette.mode === 'dark'

  return (
    <>
      <Card sx={{ height: '100%' }}>
        <CardContent sx={{ p: '14px 16px 10px !important', height: '100%' }}>
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
            <Typography sx={{
              color: 'text.secondary', fontSize: '0.68rem',
              textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 700,
              fontFamily: '"Plus Jakarta Sans", sans-serif',
            }}>
              {title}
            </Typography>
            <Tooltip title="Fullscreen" arrow>
              <IconButton
                size="small"
                onClick={() => setOpen(true)}
                sx={{
                  color: dark ? 'rgba(155,101,208,0.6)' : 'rgba(112,64,184,0.4)',
                  '&:hover': { color: '#7040B8', background: 'rgba(112,64,184,0.08)' },
                  width: 24, height: 24,
                }}
              >
                <FullscreenIcon sx={{ fontSize: 16 }} />
              </IconButton>
            </Tooltip>
          </Box>
          {children(defaultH)}
        </CardContent>
      </Card>

      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        fullWidth
        maxWidth={false}
        sx={{
          '& .MuiDialog-paper': {
            width: '92vw', maxWidth: 'none', height: '90vh',
            borderRadius: '16px',
            background: theme.palette.background.paper,
            boxShadow: '0 32px 80px rgba(0,0,0,0.35)',
            overflow: 'hidden',
          },
          '& .MuiBackdrop-root': {
            backdropFilter: 'blur(6px)',
            background: 'rgba(10,4,30,0.6)',
          },
        }}
      >
        <Box sx={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          px: 3, py: 1.5,
          borderBottom: `1px solid ${theme.palette.divider}`,
          background: dark ? 'rgba(155,101,208,0.06)' : 'rgba(112,64,184,0.03)',
        }}>
          <Typography sx={{
            fontFamily: '"Plus Jakarta Sans", sans-serif',
            fontWeight: 700, fontSize: '1rem',
            color: 'text.primary', letterSpacing: '-0.01em',
          }}>
            {title}
          </Typography>
          <IconButton onClick={() => setOpen(false)} size="small"
            sx={{ color: 'text.secondary', '&:hover': { color: '#7040B8', background: 'rgba(112,64,184,0.08)' } }}>
            <CloseIcon sx={{ fontSize: 18 }} />
          </IconButton>
        </Box>
        <DialogContent sx={{ p: '20px 24px', overflow: 'hidden' }}>
          {children(FS_HEIGHT)}
        </DialogContent>
      </Dialog>
    </>
  )
}

// ─── App ───────────────────────────────────────────────────────
export default function App() {
  const [host,      setHost]      = useState('<ORACLE-SERVER>')
  const [dateFrom,  setDateFrom]  = useState(format(startOfMonth(today), 'yyyy-MM-dd'))
  const [dateTo,    setDateTo]    = useState(format(today, 'yyyy-MM-dd'))
  const [stores,    setStores]    = useState<string[]>([])
  const [itemTypes, setItemTypes] = useState('1,2')
  const [cacheTtl,  setCacheTtl]  = useState(3600)

  const { data, steps, loading, error, refetch } = useStreamingDashboard({
    host, dateFrom, dateTo, stores, itemTypes, cacheTtl,
  })

  // Force refresh: clear cache for this query then re-fetch
  const handleForceRefresh = async () => {
    try {
      await fetch(`http://${host}:8000/api/cache`, { method: 'DELETE' })
    } catch (_) { /* ignore */ }
    refetch()
  }

  const kpi = useMemo((): KpiDerived | null => {
    if (!data?.kpi?.[0]) return null
    const k  = data.kpi[0]
    const py = data.kpi_py?.[0]?.TOTAL_SALES_PY
    const sales = num(k.TOTAL_SALES_WTAX), ret = num(k.TOTAL_RETURNS)
    const net   = num(k.NET_SALES_WTAX),   wotax = num(k.NET_SALES_WOTAX)
    const cogs  = num(k.TOTAL_COGS),       gp  = num(k.GROSS_PROFIT)
    const inv   = num(k.INVOICES),         units = num(k.SOLD_UNITS)
    const cust  = num(k.CUSTOMERS),        storeCount = num(k.STORES)
    const tax   = num(k.TAX_AMT),          disc = num(k.DISC_AMT)
    return {
      sales, ret, net, wotax, cogs, gp, inv, units, cust, tax, disc,
      stores: storeCount,
      gmPct:  wotax      ? gp  / wotax  * 100 : 0,
      retPct: sales      ? ret / sales  * 100 : 0,
      avgTkt: inv        ? net / inv          : 0,
      avgBsk: inv        ? units / inv        : 0,
      avgSt:  storeCount ? net / storeCount   : 0,
      yoy:    py         ? (sales - py) / py * 100 : null,
    }
  }, [data])

  const cacheAge = (data as any)?._cache_age ?? 0

  return (
    <Box sx={{ display: 'flex', height: '100vh', overflow: 'hidden' }}>
      <Sidebar
        host={host}           onHostChange={setHost}
        dateFrom={dateFrom}   onDateFromChange={setDateFrom}
        dateTo={dateTo}       onDateToChange={setDateTo}
        stores={stores}       onStoresChange={setStores}
        itemTypes={itemTypes} onItemTypesChange={setItemTypes}
        cacheTtl={cacheTtl}  onCacheTtlChange={setCacheTtl}
        onRefresh={refetch}   isLoading={loading}
      />

      <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <Header host={host} cached={data?._cached} />

        <Box sx={{ flex: 1, overflowY: 'auto', p: 2.5, display: 'flex', flexDirection: 'column', gap: 2 }}>

          {loading && <LoadingProgress steps={steps} total={8} />}

          {error && !loading && (
            <Alert severity="error" sx={{ borderRadius: 2 }}>{error}</Alert>
          )}

          {/* Cache status badge — shown only when data is loaded */}
          {data && !loading && (
            <CacheBadge
              cached={!!data._cached}
              cacheAge={cacheAge}
              onRefresh={handleForceRefresh}
              loading={loading}
            />
          )}

          {!loading && !data && !error && stores.length === 0 && (
            <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: 360, gap: 1.5 }}>
              <Typography variant="h2" sx={{ fontSize: '3rem' }}>🏪</Typography>
              <Typography variant="h6" sx={{ color: 'text.primary' }}>Select stores to load the dashboard</Typography>
              <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                Choose a subsidiary and stores from the sidebar, then click Refresh
              </Typography>
            </Box>
          )}

          {kpi && <KpiGrid kpi={kpi} />}

          {/* Row 1 */}
          {data && (
            <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 2 }}>
              <ChartCard title="📈 Daily Sales Trend" defaultH={200}>
                {(h) => <TrendChart data={data.trend ?? []} height={h} />}
              </ChartCard>
              <ChartCard title="🏪 Revenue by Store" defaultH={240}>
                {(h) => <StoreChart data={data.store ?? []} height={h} />}
              </ChartCard>
              <ChartCard title="👤 Top Employees" defaultH={220}>
                {(h) => <EmployeeChart data={data.emp ?? []} height={h} />}
              </ChartCard>
            </Box>
          )}

          {/* Row 2 */}
          {data && (
            <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 2 }}>
              <ChartCard title="🏆 Top 15 Items" defaultH={220}>
                {(h) => <TopItemsChart data={data.items ?? []} height={h} />}
              </ChartCard>
              <ChartCard title="📅 Monthly Summary" defaultH={220}>
                {(h) => <MonthlyChart data={data.monthly ?? []} height={h} />}
              </ChartCard>
              <ChartCard title="🥧 Revenue Breakdown" defaultH={240}>
                {(h) => <DonutChart kpi={kpi} height={h} />}
              </ChartCard>
            </Box>
          )}

          {data?.txn && (
            <Card>
              <CardContent sx={{ p: '14px 16px !important' }}>
                <Typography sx={{
                  mb: 1.5, color: 'text.secondary', fontSize: '0.68rem',
                  textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 700,
                  fontFamily: '"Plus Jakarta Sans", sans-serif',
                }}>
                  🧾 Recent Transactions
                </Typography>
                <TransactionsGrid rows={data.txn} />
              </CardContent>
            </Card>
          )}

          <Typography variant="caption" sx={{ textAlign: 'center', pb: 2, color: 'text.disabled' }}>
            RetailTec Analytics · Retail Pro Prism RPS · {format(today, 'yyyy')}
          </Typography>
        </Box>
      </Box>
    </Box>
  )
}
