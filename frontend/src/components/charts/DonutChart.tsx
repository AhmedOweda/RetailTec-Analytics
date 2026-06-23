import ReactECharts from 'echarts-for-react'
import type { KpiDerived } from '../../types'
import { sar } from '../../utils/formatters'

const COLORS = ['#7040B8', '#0E7490', '#D4820A', '#4E2A99', '#1B7A3E']

export default function DonutChart({ kpi, height = 240 }: { kpi: KpiDerived | null; height?: number }) {
  if (!kpi) return null
  const fs = height > 300

  const segments = [
    { name: 'Net Revenue',  value: Math.max(kpi.wotax - kpi.cogs, 0) },
    { name: 'VAT',          value: Math.max(kpi.tax, 0) },
    { name: 'Discount',     value: Math.max(kpi.disc, 0) },
    { name: 'COGS',         value: Math.max(kpi.cogs, 0) },
    { name: 'Gross Profit', value: Math.max(kpi.gp, 0) },
  ].filter(s => s.value > 0)

  const centerY = fs ? '40%' : '44%'

  const option = {
    tooltip: {
      trigger: 'item',
      backgroundColor: '#1A0D45', borderColor: '#4E2A99', borderWidth: 1,
      textStyle: { color: '#EDE8F8', fontFamily: 'Inter, sans-serif', fontSize: fs ? 14 : 12 },
      formatter: (p: any) => `${p.name}<br/><b>SAR ${(p.value as number).toLocaleString()}</b><br/>${p.percent}%`,
    },
    legend: {
      bottom: 0,
      textStyle: { color: '#6B5A8E', fontFamily: 'Inter, sans-serif', fontSize: fs ? 13 : 10 },
      icon: 'circle', itemWidth: 8, itemHeight: 8,
    },
    graphic: [{
      type: 'group', left: 'center', top: fs ? '31%' : '32%',
      children: [
        { type: 'text', style: { text: 'Net Sales', textAlign: 'center', fill: '#9A8FBA', fontSize: fs ? 12 : 9, fontFamily: 'Inter, sans-serif', fontWeight: 700, y: -12 } },
        { type: 'text', style: { text: `SAR ${sar(kpi.net)}`, textAlign: 'center', fill: '#1A0D45', fontSize: fs ? 18 : 13, fontFamily: 'Inter, sans-serif', fontWeight: 700, y: 6 } },
      ],
    }],
    series: [{
      type: 'pie',
      radius: ['48%', '72%'],
      center: ['50%', centerY],
      padAngle: 2,
      itemStyle: { borderRadius: 4 },
      label: {
        show: fs,
        fontSize: 11,
        fontFamily: 'Inter, sans-serif',
        color: '#6B5A8E',
        formatter: '{b}: {d}%',
      },
      emphasis: { scale: true, scaleSize: 5 },
      data: segments.map((s, i) => ({ ...s, itemStyle: { color: COLORS[i % COLORS.length] } })),
    }],
  }

  return <ReactECharts option={option} style={{ height }} opts={{ renderer: 'svg' }} />
}
