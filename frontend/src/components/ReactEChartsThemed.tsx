/**
 * Compatibility shim for the pages that were written against `echarts-for-react`.
 *
 * It now forwards to this project's own <EChart> wrapper instead of the library.
 * Two reasons:
 *
 *  1. echarts-for-react@3 is already distrusted here — EChart.tsx exists because
 *     that library waits for a 'finished' event that an empty ECharts 5 instance
 *     never fires, so setOption is never called and the chart stays blank.
 *
 *  2. It has no ResizeObserver on the container. When the container or the
 *     browser zoom changes, the canvas bitmap is left at the old scale and gets
 *     stretched by CSS — which renders every label as blurred/doubled text while
 *     the surrounding DOM text stays crisp. EChart.tsx observes the container and
 *     calls instance.resize(), so it repaints at the correct device pixel ratio.
 *
 * EChart also applies the brand palette and the dark-mode option recolouring
 * (utils/chartDark.ts), so this shim only needs to pass props straight through.
 * Supported props are identical to what these pages use: option, style, opts,
 * and a ref exposing getEchartsInstance().
 */
import { forwardRef } from 'react'
import EChart, { EChartHandle } from './EChart'

const ReactEChartsThemed = forwardRef<EChartHandle, any>(
  function ReactEChartsThemed({ option, style, opts, notMerge = true, ...rest }, ref) {
    return <EChart ref={ref} option={option} style={style} opts={opts}
                   notMerge={notMerge} {...rest} />
  })

export default ReactEChartsThemed
