import ReactECharts from 'echarts-for-react'
import type { TrendRow } from '../../types'
import { sar } from '../../utils/formatters'

const AXIS_COLOR  = '#4E3A72'   // dark enough to read clearly
const SPLIT_COLOR = 'rgba(155,101,208,0.14)'
const TIP = {
  trigger: 'axis',
  backgroundColor: '#1A0D45', borderColor: '#4E2A99', borderWidth: 1,
  textStyle: { color: '#EDE8F8', fontFamily: 'Inter, sans-serif', fontSize: 12 },
  axisPointer: { type: 'cross', crossStyle: { color: '#9B65D0' } },
}

export default function TrendChart({ data, height = 200 }: { data: TrendRow[]; height?: number }) {
  const dates   = data.map(d => d.SALE_DATE?.toString().slice(0, 10) ?? '')
  const sales   = data.map(d => +(d.SALES   ?? 0).toFixed(0))
  const returns = data.map(d => +(d.RETURNS ?? 0).toFixed(0))
  const fs      = height > 300

  const maxSales = Math.max(...sales)
  const peakIdx  = sales.indexOf(maxSales)
  const peakDate = dates[peakIdx]?.slice(5) ?? ''

  const labelStyle = {
    color: AXIS_COLOR,
    fontSize: fs ? 12 : 11,
    fontFamily: 'Inter, sans-serif',
    fontWeight: 500,
  }

  const option = {
    tooltip: TIP,
    legend: {
      bottom: 0,
      textStyle: { color: AXIS_COLOR, fontFamily: 'Inter, sans-serif', fontSize: fs ? 13 : 12, fontWeight: 500 },
      icon: 'circle', itemWidth: 10, itemHeight: 10, itemGap: 20,
    },
    grid: { top: 20, left: 16, right: 16, bottom: fs ? 44 : 36, containLabel: true },
    xAxis: {
      type: 'category', data: dates,
      name: 'Date',
      nameLocation: 'end',
      nameTextStyle: { color: '#9B65D0', fontSize: 10, fontFamily: 'Inter, sans-serif', fontWeight: 600, padding: [0, 0, 0, 8] },
      axisLine: { lineStyle: { color: 'rgba(155,101,208,0.3)' } },
      axisTick: { show: false },
      axisLabel: {
        ...labelStyle,
        rotate: dates.length > 20 ? 35 : 0,
        formatter: (v: string) => v.slice(5),
      },
      splitLine: { show: false },
    },
    yAxis: {
      type: 'value',
      name: 'SAR',
      nameLocation: 'end',
      nameTextStyle: { color: '#9B65D0', fontSize: 10, fontFamily: 'Inter, sans-serif', fontWeight: 600, padding: [0, 4, 0, 0] },
      axisLabel: { ...labelStyle, formatter: (v: number) => sar(v) },
      splitLine: { lineStyle: { color: SPLIT_COLOR, type: 'dashed' } },
      axisLine: { show: false },
    },
    series: [
      {
        name: 'Sales', type: 'line', data: sales, smooth: 0.3,
        symbol: 'none',
        lineStyle: { color: '#7040B8', width: fs ? 3 : 2.5 },
        areaStyle: {
          color: { type: 'linear', x: 0, y: 0, x2: 0, y2: 1,
            colorStops: [{ offset: 0, color: 'rgba(112,64,184,0.25)' }, { offset: 1, color: 'rgba(112,64,184,0)' }] },
        },
        markPoint: {
          symbol: 'circle', symbolSize: fs ? 10 : 8,
          itemStyle: { color: '#7040B8', borderColor: '#fff', borderWidth: 2 },
          data: [{ type: 'max', name: 'Peak' }],
          label: {
            show: true, formatter: `Peak ${peakDate}`,
            color: '#7040B8', fontWeight: 700, fontSize: fs ? 12 : 10,
            fontFamily: 'Inter, sans-serif',
            backgroundColor: 'rgba(112,64,184,0.08)',
            borderRadius: 4, padding: [3, 6], position: 'top', distance: 12,
          },
        },
      },
      {
        name: 'Returns', type: 'line', data: returns, smooth: 0.3,
        symbol: 'none',
        lineStyle: { color: '#E05B5B', width: fs ? 2 : 1.5, type: 'dashed' },
      },
    ],
  }

  return <ReactECharts option={option} style={{ height }} opts={{ renderer: 'svg' }} />
}
