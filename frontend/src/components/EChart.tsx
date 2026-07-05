/**
 * Minimal ECharts wrapper — replaces echarts-for-react.
 *
 * echarts-for-react@3 waits for the 'finished' event before calling setOption.
 * In ECharts 5 an empty instance never fires 'finished', so setOption is never
 * called and the chart stays blank. This wrapper calls init → setOption directly.
 */
import { useEffect, useRef, forwardRef, useImperativeHandle } from 'react'
import * as echarts from 'echarts'
import { CHART_CATEGORICAL } from '../theme/chartPalette'

// Inject the shared brand palette as a DEFAULT only. An option's own top-level
// `color` always wins (spread last), so deliberate single-accent / semantic
// charts are untouched; auto-coloured multi-series charts pick up the palette.
function withPalette(option: echarts.EChartsCoreOption): echarts.EChartsCoreOption {
  return { color: CHART_CATEGORICAL, ...(option as object) } as echarts.EChartsCoreOption
}

export interface EChartHandle {
  getEchartsInstance: () => echarts.ECharts | null
}

interface Props {
  option: echarts.EChartsCoreOption
  style?: React.CSSProperties
  opts?: echarts.EChartsInitOpts
  notMerge?: boolean
}

const EChart = forwardRef<EChartHandle, Props>(function EChart(
  { option, style, opts, notMerge = true },
  ref,
) {
  const divRef  = useRef<HTMLDivElement>(null)
  const instRef = useRef<echarts.ECharts | null>(null)

  // Expose getEchartsInstance() so ChartPanel can call getDataURL() for PNG export
  useImperativeHandle(ref, () => ({
    getEchartsInstance: () => instRef.current,
  }))

  // Init once on mount; dispose on unmount
  useEffect(() => {
    if (!divRef.current) return
    const instance = echarts.init(divRef.current, undefined, opts)
    instRef.current = instance
    instance.setOption(withPalette(option), notMerge)

    // Resize when container dimensions change
    const ro = new ResizeObserver(() => instance.resize())
    ro.observe(divRef.current)

    return () => {
      ro.disconnect()
      instance.dispose()
      instRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])  // only on mount; option updates handled below

  // Re-apply option whenever it changes (data arrives or date range changes)
  useEffect(() => {
    instRef.current?.setOption(withPalette(option), notMerge)
  }, [option, notMerge])

  return <div ref={divRef} style={{ width: '100%', ...style }} />
})

export default EChart
