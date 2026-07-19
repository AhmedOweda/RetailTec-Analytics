import ReactECharts from '../ReactEChartsThemed'
import type { ItemRow } from '../../types'
import { sar } from '../../utils/formatters'

const AXIS_COLOR  = '#4E3A72'
const SPLIT_COLOR = 'rgba(155,101,208,0.14)'
const TIP = {
  trigger: 'axis', axisPointer: { type: 'shadow' },
  backgroundColor: '#1A0D45', borderColor: '#4E2A99', borderWidth: 1,
  textStyle: { color: '#EDE8F8', fontFamily: 'Inter, sans-serif', fontSize: 11 },
  formatter: (params: any[]) => {
    const p = params[0]
    return `<b>${p.name}</b><br/>Revenue: SAR ${p.value?.toLocaleString()}`
  },
}

export default function TopItemsChart({ data, height = 220 }: { data: ItemRow[]; height?: number }) {
  const fs    = height > 300
  const limit = fs ? 20 : 12
  const top   = data.slice(0, limit)
  const names = top.map(d => d.ITEM_NAME ?? d.ALU)
  const rev   = top.map(d => +(d.REVENUE ?? 0).toFixed(0))
  const gp    = top.map(d => +(d.GROSS_PROFIT ?? 0).toFixed(0))

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
    grid: { top: 8, left: 16, right: 16, bottom: fs ? 54 : 40, containLabel: true },
    xAxis: {
      type: 'category', data: names,
      name: 'Item',
      nameLocation: 'end',
      nameTextStyle: { color: '#9B65D0', fontSize: 10, fontFamily: 'Inter, sans-serif', fontWeight: 600, padding: [0, 0, 0, 8] },
      axisLabel: {
        ...labelStyle,
        rotate: fs ? 25 : 35,
        formatter: (v: string) => v.length > (fs ? 20 : 14) ? v.slice(0, fs ? 19 : 13) + '…' : v,
      },
      axisLine: { lineStyle: { color: 'rgba(155,101,208,0.25)' } },
      axisTick: { show: false },
      splitLine: { show: false },
    },
    yAxis: {
      type: 'value',
      name: 'Revenue (SAR)',
      nameLocation: 'end',
      nameTextStyle: { color: '#9B65D0', fontSize: 10, fontFamily: 'Inter, sans-serif', fontWeight: 600, padding: [0, 4, 0, 0] },
      axisLabel: { ...labelStyle, formatter: (v: number) => sar(v) },
      splitLine: { lineStyle: { color: SPLIT_COLOR, type: 'dashed' } },
      axisLine: { show: false },
    },
    series: [
      {
        name: 'Revenue', type: 'bar', data: rev,
        barMaxWidth: fs ? 28 : 20, barGap: '8%', barCategoryGap: '35%',
        itemStyle: {
          borderRadius: [4, 4, 0, 0],
          color: { type: 'linear', x: 0, y: 0, x2: 0, y2: 1,
            colorStops: [{ offset: 0, color: '#9B65D0' }, { offset: 1, color: '#4E2A99' }] },
        },
      },
      {
        name: 'Gross Profit', type: 'bar', data: gp,
        barMaxWidth: fs ? 28 : 20, barGap: '8%',
        itemStyle: { borderRadius: [4, 4, 0, 0], color: '#1B7A3E' },
      },
    ],
  }

  return <ReactECharts option={option} style={{ height }} opts={{ renderer: 'svg' }} />
}
