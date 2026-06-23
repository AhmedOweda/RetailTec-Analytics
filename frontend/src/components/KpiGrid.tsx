import { Grid } from '@mui/material'
import KpiCard from './KpiCard'
import type { KpiDerived } from '../types'
import { sar, fmt, pct as fmtPct } from '../utils/formatters'

// MUI icons
import AttachMoneyIcon from '@mui/icons-material/AttachMoney'
import UndoIcon from '@mui/icons-material/Undo'
import AccountBalanceIcon from '@mui/icons-material/AccountBalance'
import ReceiptIcon from '@mui/icons-material/Receipt'
import PeopleIcon from '@mui/icons-material/People'
import InventoryIcon from '@mui/icons-material/Inventory'
import ShowChartIcon from '@mui/icons-material/ShowChart'
import PercentIcon from '@mui/icons-material/Percent'
import LocalOfferIcon from '@mui/icons-material/LocalOffer'
import StoreIcon from '@mui/icons-material/Store'
import ShoppingCartIcon from '@mui/icons-material/ShoppingCart'
import MonetizationOnIcon from '@mui/icons-material/MonetizationOn'

interface Props { kpi: KpiDerived }

export default function KpiGrid({ kpi }: Props) {
  const cards = [
    {
      icon: <AttachMoneyIcon />, label: 'Total Sales (w/VAT)',
      value: `SAR ${sar(kpi.sales)}`, sub: fmt(kpi.sales, 0) + ' SAR',
      trend: kpi.yoy, variant: 'purple' as const,
      tooltip: kpi.yoy != null ? `YoY: ${fmtPct(kpi.yoy)} vs prior year` : undefined,
    },
    {
      icon: <UndoIcon />, label: 'Total Returns',
      value: `SAR ${sar(kpi.ret)}`, sub: `${kpi.retPct.toFixed(1)}% of sales`,
      variant: 'red' as const,
    },
    {
      icon: <AccountBalanceIcon />, label: 'Net Revenue (w/o VAT)',
      value: `SAR ${sar(kpi.wotax)}`, sub: 'Excl. VAT',
      variant: 'violet' as const,
    },
    {
      icon: <ReceiptIcon />, label: 'Invoices',
      value: fmt(kpi.inv), sub: `Avg ticket SAR ${sar(kpi.avgTkt)}`,
      variant: 'teal' as const,
    },
    {
      icon: <PeopleIcon />, label: 'Unique Customers',
      value: fmt(kpi.cust), variant: 'purple' as const,
    },
    {
      icon: <InventoryIcon />, label: 'Units Sold',
      value: fmt(kpi.units), sub: `${fmt(kpi.avgBsk, 1)} units/invoice`,
      variant: 'teal' as const,
    },
    {
      icon: <ShowChartIcon />, label: 'Gross Profit',
      value: `SAR ${sar(kpi.gp)}`, sub: `GM ${kpi.gmPct.toFixed(1)}%`,
      variant: 'green' as const,
    },
    {
      icon: <PercentIcon />, label: 'Gross Margin %',
      value: `${kpi.gmPct.toFixed(1)}%`, sub: `COGS SAR ${sar(kpi.cogs)}`,
      variant: 'green' as const,
    },
    {
      icon: <LocalOfferIcon />, label: 'VAT Collected',
      value: `SAR ${sar(kpi.tax)}`, variant: 'orange' as const,
    },
    {
      icon: <MonetizationOnIcon />, label: 'Discounts Given',
      value: `SAR ${sar(kpi.disc)}`, variant: 'orange' as const,
    },
    {
      icon: <StoreIcon />, label: 'Active Stores',
      value: fmt(kpi.stores), sub: `SAR ${sar(kpi.avgSt)} / store`,
      variant: 'violet' as const,
    },
    {
      icon: <ShoppingCartIcon />, label: 'Net Sales (w/VAT)',
      value: `SAR ${sar(kpi.net)}`, sub: 'Sales minus returns',
      variant: 'purple' as const,
    },
  ]

  return (
    <Grid container spacing={1.5}>
      {cards.map((c, i) => (
        <Grid item xs={6} sm={4} md={3} lg={2} key={i}>
          <KpiCard {...c} />
        </Grid>
      ))}
    </Grid>
  )
}
