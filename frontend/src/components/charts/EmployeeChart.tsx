import ReactECharts from 'echarts-for-react'
import type { EmpRow } from '../../types'
import { sar } from '../../utils/formatters'

const AXIS_COLOR  = '#4E3A72'
const SPLIT_COLOR = 'rgba(155,101,208,0.14)'
const TIP = {
  trigger: 'axis', axisPointer: { type: 'shadow' },
  backgroundColor: '#1A0D45', borderColor: '#4E2A99', borderWidth: 1,
  textStyle: { color: '#EDE8F8', fontFamily: 'Inter, sans-serif', fontSize: 12 },
}

export default function EmployeeChart({ data, height = 220 }: { data: EmpRow[]; height?: number }) {
  const fs    = height > 300
  const limit = fs ? 15 : 8
  const top   = data.slice(0, limit)
  const names = top.map(d => d.EMPLOYEE)
  const sales = top.map(d => +(d.SALES ?? 0).toFixed(0))
  const inv   = top.map(d => d.INVOICES ?? 0)

  const maxSales = Math.max(...sales)
  const topName  = names[sales.indexOf(maxSales)]?.split(' ')[0] ?? ''
  const avg      = sales.reduce((s, v) => s + v, 0) / (sales.length || 1)
  const topPct   = avg > 0 ? ((maxSales / avg - 1) * 100).toFixed(0) : '—'

  const labelStyle = {
    color: AXIS_COLOR, fontSize: fs ? 12 : 11,
    fontFamily: 'Inter, sans-serif', fontWeight: 500,
  }

  const option = {
    tooltip: TIP,
    legend: {
      bottom: 0,
      textStyle: { color: AXIS_COLOR, fontFamily: 'Inter, sans-serif', fontSize: fs ? 13 : 12, fontWeight: 500 },
      icon: 'circle', itemWidth: 10, itemHeight: 10, itemGap: 20,
    },
    // large top margin so annotation floats above bars without clipping
    grid: { top: 48, left: 16, right: 16, bottom: fs ? 44 : 36, containLabel: true },
    xAxis: {
      type: 'category', data: names,
      axisLabel: {
        ...labelStyle,
        rotate: 25,
        formatter: (v: string) => v.split(' ')[0],
      },
      axisLine: { lineStyle: { color: 'rgba(155,101,208,0.25)' } },
      axisTick: { show: false },
      splitLine: { show: false },
    },
    yAxis: [
      {
        type: 'value',
        name: 'Sales (SAR)',
        nameLocation: 'middle',
        nameGap: 52,
        nameTextStyle: { color: '#9B65D0', fontSize: 10, fontFamily: 'Inter, sans-serif', fontWeight: 600 },
        axisLabel: { ...labelStyle, formatter: (v: number) => sar(v) },
        splitLine: { lineStyle: { color: SPLIT_COLOR, type: 'dashed' } },
        axisLine: { show: false },
      },
      {
        type: 'value',
        name: 'Invoices',
        nameLocation: 'middle',
        nameGap: 40,
        nameTextStyle: { color: '#0E7490', fontSize: 10, fontFamily: 'Inter, sans-serif', fontWeight: 600 },
        axisLabel: { ...labelStyle, color: '#0E7490' },
        splitLine: { show: false },
        axisLine: { show: false },
      },
    ],
    series: [
      {
        name: 'Sales (SAR)', type: 'bar', yAxisIndex: 0, data: sales,
        barMaxWidth: fs ? 24 : 16, barCategoryGap: '40%',
        itemStyle: {
          borderRadius: [4, 4, 0, 0],
          color: { type: 'linear', x: 0, y: 0, x2: 0, y2: 1,
            colorStops: [{ offset: 0, color: '#9B65D0' }, { offset: 1, color: '#4E2A99' }] },
        },
        markPoint: {
          symbol: 'pin', symbolSize: 0,
          data: [{ type: 'max', name: 'Top' }],
          label: {
            show: true,
            formatter: `↑ ${topName} +${topPct}% avg`,
            color: '#7040B8', fontWeight: 700, fontSize: fs ? 12 : 10,
            fontFamily: 'Inter, sans-serif',
            backgroundColor: 'rgba(112,64,184,0.1)',
            borderColor: 'rgba(112,64,184,0.3)',
            borderWidth: 1,
            borderRadius: 4, padding: [3, 8],
            // push well above the bar top — sits in the extra grid top margin
            position: 'top',
            distance: 20,
          },
        },
      },
      {
        name: 'Invoices', type: 'line', yAxisIndex: 1, data: inv, smooth: true,
        symbol: 'circle', symbolSize: fs ? 7 : 5,
        lineStyle: { color: '#0E7490', width: fs ? 2.5 : 2 },
        itemStyle: { color: '#0E7490' },
      },
    ],
  }

  return <ReactECharts option={option} style={{ height }} opts={{ renderer: 'svg' }} />
}
