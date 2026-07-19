import ReactECharts from '../ReactEChartsThemed'
import type { MonthlyRow } from '../../types'
import { sar } from '../../utils/formatters'

const AXIS_COLOR  = '#4E3A72'
const SPLIT_COLOR = 'rgba(155,101,208,0.14)'
const TIP = {
  trigger: 'axis', axisPointer: { type: 'cross' },
  backgroundColor: '#1A0D45', borderColor: '#4E2A99', borderWidth: 1,
  textStyle: { color: '#EDE8F8', fontFamily: 'Inter, sans-serif', fontSize: 12 },
}

export default function MonthlyChart({ data, height = 220 }: { data: MonthlyRow[]; height?: number }) {
  const months = data.map(d => d.SALE_MONTH)
  const sales  = data.map(d => +(d.SALES ?? 0).toFixed(0))
  const gp     = data.map(d => +(d.GROSS_PROFIT ?? 0).toFixed(0))
  const inv    = data.map(d => d.INVOICES ?? 0)
  const fs     = height > 300

  const maxSales = Math.max(...sales)
  const peakMon  = months[sales.indexOf(maxSales)] ?? ''

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
    grid: { top: 28, left: 16, right: 16, bottom: fs ? 44 : 36, containLabel: true },
    xAxis: {
      type: 'category', data: months,
      name: 'Month',
      nameLocation: 'end',
      nameTextStyle: { color: '#9B65D0', fontSize: 10, fontFamily: 'Inter, sans-serif', fontWeight: 600, padding: [0, 0, 0, 8] },
      axisLabel: { ...labelStyle },
      axisLine: { lineStyle: { color: 'rgba(155,101,208,0.25)' } },
      axisTick: { show: false },
      splitLine: { show: false },
    },
    yAxis: [
      {
        type: 'value',
        name: 'Revenue (SAR)',
        nameLocation: 'end',
        nameTextStyle: { color: '#9B65D0', fontSize: 10, fontFamily: 'Inter, sans-serif', fontWeight: 600, padding: [0, 4, 0, 0] },
        axisLabel: { ...labelStyle, formatter: (v: number) => sar(v) },
        splitLine: { lineStyle: { color: SPLIT_COLOR, type: 'dashed' } },
        axisLine: { show: false },
      },
      {
        type: 'value',
        name: 'Invoices',
        nameLocation: 'end',
        nameTextStyle: { color: '#D4820A', fontSize: 10, fontFamily: 'Inter, sans-serif', fontWeight: 600, padding: [0, 4, 0, 0] },
        axisLabel: { ...labelStyle, color: '#D4820A' },
        splitLine: { show: false },
        axisLine: { show: false },
      },
    ],
    series: [
      {
        name: 'Sales', type: 'bar', yAxisIndex: 0, data: sales,
        barMaxWidth: fs ? 28 : 18, barGap: '8%', barCategoryGap: '35%',
        itemStyle: {
          borderRadius: [3, 3, 0, 0],
          color: { type: 'linear', x: 0, y: 0, x2: 0, y2: 1,
            colorStops: [{ offset: 0, color: '#9B65D0' }, { offset: 1, color: '#4E2A99' }] },
        },
        markPoint: {
          symbol: 'pin', symbolSize: 0,
          data: [{ type: 'max', name: 'Peak' }],
          label: {
            show: true, formatter: `Peak: ${peakMon}`,
            color: '#7040B8', fontWeight: 700, fontSize: fs ? 12 : 10,
            fontFamily: 'Inter, sans-serif',
            backgroundColor: 'rgba(112,64,184,0.08)',
            borderRadius: 4, padding: [3, 6], position: 'top',
          },
        },
      },
      {
        name: 'Gross Profit', type: 'bar', yAxisIndex: 0, data: gp,
        barMaxWidth: fs ? 28 : 18, barGap: '8%',
        itemStyle: { borderRadius: [3, 3, 0, 0], color: '#1B7A3E' },
      },
      {
        name: 'Invoices', type: 'line', yAxisIndex: 1, data: inv, smooth: true,
        symbol: 'circle', symbolSize: fs ? 7 : 5,
        lineStyle: { color: '#D4820A', width: fs ? 2.5 : 2 },
        itemStyle: { color: '#D4820A' },
      },
    ],
  }

  return <ReactECharts option={option} style={{ height }} opts={{ renderer: 'svg' }} />
}
