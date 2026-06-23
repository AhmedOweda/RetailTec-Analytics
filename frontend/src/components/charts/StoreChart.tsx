import ReactECharts from 'echarts-for-react'
import type { StoreRow } from '../../types'
import { sar } from '../../utils/formatters'

const AXIS_COLOR  = '#4E3A72'
const SPLIT_COLOR = 'rgba(155,101,208,0.14)'
const TIP = {
  trigger: 'axis', axisPointer: { type: 'shadow' },
  backgroundColor: '#1A0D45', borderColor: '#4E2A99', borderWidth: 1,
  textStyle: { color: '#EDE8F8', fontFamily: 'Inter, sans-serif', fontSize: 12 },
}

export default function StoreChart({ data, height = 240 }: { data: StoreRow[]; height?: number }) {
  const fs     = height > 300
  const limit  = fs ? 20 : 10
  const sorted = [...data].sort((a, b) => b.SALES - a.SALES).slice(0, limit)
  const names  = sorted.map(d => d.STORE_NAME)
  const sales  = sorted.map(d => +(d.SALES ?? 0).toFixed(0))

  const avg    = sales.reduce((s, v) => s + v, 0) / (sales.length || 1)
  const topVal = sales[0] ?? 0
  const topPct = avg > 0 ? ((topVal / avg - 1) * 100).toFixed(0) : '—'

  const labelStyle = {
    color: AXIS_COLOR, fontSize: fs ? 12 : 11,
    fontFamily: 'Inter, sans-serif', fontWeight: 500,
  }

  const option = {
    tooltip: TIP,
    // extra top space so the annotation above the top bar isn't clipped
    grid: { top: 28, left: 8, right: 80, bottom: 8, containLabel: true },
    xAxis: {
      type: 'value',
      name: 'Revenue (SAR)',
      nameLocation: 'middle',
      nameGap: 28,
      nameTextStyle: { color: '#9B65D0', fontSize: 10, fontFamily: 'Inter, sans-serif', fontWeight: 600 },
      axisLabel: { ...labelStyle, formatter: (v: number) => sar(v) },
      splitLine: { lineStyle: { color: SPLIT_COLOR, type: 'dashed' } },
      axisLine: { show: false },
    },
    yAxis: {
      type: 'category', data: names,
      axisLabel: {
        ...labelStyle,
        formatter: (v: string) => v.length > (fs ? 22 : 16) ? v.slice(0, fs ? 21 : 15) + '…' : v,
      },
      axisLine: { show: false },
      axisTick: { show: false },
    },
    series: [{
      name: 'Revenue (SAR)', type: 'bar', data: sales,
      barMaxWidth: fs ? 18 : 12,
      barCategoryGap: '40%',
      itemStyle: {
        borderRadius: [0, 4, 4, 0],
        color: { type: 'linear', x: 0, y: 0, x2: 1, y2: 0,
          colorStops: [{ offset: 0, color: '#4E2A99' }, { offset: 1, color: '#9B65D0' }] },
      },
      label: {
        show: true, position: 'right',
        color: AXIS_COLOR, fontSize: fs ? 11 : 10,
        fontFamily: 'Inter, sans-serif', fontWeight: 500,
        formatter: (p: { value: number }) => sar(p.value),
      },
      markPoint: {
        symbol: 'pin', symbolSize: 0,
        data: [{ type: 'max', name: 'Top' }],
        label: {
          show: true,
          formatter: `↑ +${topPct}% vs avg`,
          color: '#7040B8', fontWeight: 700, fontSize: fs ? 12 : 10,
          fontFamily: 'Inter, sans-serif',
          backgroundColor: 'rgba(112,64,184,0.1)',
          borderColor: 'rgba(112,64,184,0.3)',
          borderWidth: 1,
          borderRadius: 4, padding: [3, 8],
          // position 'top' puts it ABOVE the bar — no overlap with end label
          position: 'top',
          distance: 6,
        },
      },
    }],
  }

  return <ReactECharts option={option} style={{ height }} opts={{ renderer: 'svg' }} />
}
