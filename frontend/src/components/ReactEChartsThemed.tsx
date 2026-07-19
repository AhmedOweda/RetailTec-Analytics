/**
 * Drop-in replacement for `echarts-for-react` that applies dark-mode colours.
 *
 * Identical API to ReactECharts — same props, same ref (getEchartsInstance) —
 * so switching a page over is a one-line import change. It exists because a
 * chart canvas cannot resolve the app's CSS design tokens, so dark mode has to
 * be baked into the option object. See utils/chartDark.ts.
 */
import { forwardRef, useMemo } from 'react'
import ReactECharts from 'echarts-for-react'
import { useAppSettings } from '../context/AppSettings'
import { applyDarkChartTheme } from '../utils/chartDark'

const ReactEChartsThemed = forwardRef<any, any>(function ReactEChartsThemed(props, ref) {
  const { themeMode } = useAppSettings()
  const option = useMemo(
    () => applyDarkChartTheme(props.option, themeMode === 'dark'),
    [props.option, themeMode])

  // `notMerge` forces a full redraw so stale light-mode colours can't linger
  // on the canvas when the user flips the theme.
  return <ReactECharts {...props} option={option} notMerge ref={ref} />
})

export default ReactEChartsThemed
