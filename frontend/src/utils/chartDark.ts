/**
 * Dark-mode normaliser for ECharts options.
 *
 * WHY THIS EXISTS: ECharts draws to a <canvas>, and a canvas cannot resolve CSS
 * custom properties — `var(--rt-text)` is simply an invalid colour there. So the
 * design tokens that theme the rest of the app are useless inside a chart, and
 * every axis label / legend / category name stayed near-black on a dark card.
 *
 * This function takes the option object a page already built for LIGHT mode and
 * returns a recoloured copy for dark mode. Light mode is returned untouched, so
 * the existing look is preserved exactly.
 *
 * It clones only the branches it edits (never a deep/JSON clone) because option
 * objects contain FUNCTION values — tooltip/axis `formatter` callbacks — which a
 * JSON round-trip would destroy.
 */

export const CHART_DARK = {
  axisText:      '#B9A7D8',
  axisLine:      'rgba(155,101,208,0.30)',
  splitLine:     'rgba(155,101,208,0.14)',
  legendText:    '#EDE8F8',
  titleText:     '#EDE8F8',
  titleSubtext:  '#B9A7D8',
  labelText:     '#EDE8F8',
  tooltipBg:     '#1C0E42',
  tooltipBorder: 'rgba(155,101,208,0.35)',
  tooltipText:   '#EDE8F8',
}

/** Light-mode text colours that are unreadable on a dark surface. */
const DARK_ON_DARK = new Set([
  '#0f172a', '#1e293b', '#334155', '#475569', '#1a0d45', '#4e3a72', '#64748b',
])

const isUnreadable = (c: unknown) =>
  typeof c === 'string' && DARK_ON_DARK.has(c.toLowerCase())

/** Recolour a text-bearing sub-object (axisLabel, nameTextStyle, textStyle…). */
function ink<T extends Record<string, any> | undefined>(o: T, color: string): T {
  if (o === undefined) return { color } as T
  if (typeof o !== 'object' || o === null) return o
  return { ...o, color } as T
}

/** Recolour a lineStyle-bearing sub-object (axisLine, splitLine). */
function line<T extends Record<string, any> | undefined>(o: T, color: string): T {
  if (o === undefined || typeof o !== 'object' || o === null) return o
  return { ...o, lineStyle: { ...(o as any).lineStyle, color } } as T
}

function themeAxis(axis: any): any {
  if (!axis) return axis
  const one = (a: any) => {
    if (!a || typeof a !== 'object') return a
    const out: any = { ...a }
    out.axisLabel = ink(a.axisLabel, CHART_DARK.axisText)
    if (a.name) out.nameTextStyle = ink(a.nameTextStyle, CHART_DARK.axisText)
    if (a.axisLine)  out.axisLine  = line(a.axisLine,  CHART_DARK.axisLine)
    if (a.splitLine) out.splitLine = line(a.splitLine, CHART_DARK.splitLine)
    return out
  }
  return Array.isArray(axis) ? axis.map(one) : one(axis)
}

/** Series labels: only repaint ones that were an unreadable dark colour. */
function themeSeries(series: any): any {
  if (!series) return series
  const one = (s: any) => {
    if (!s || typeof s !== 'object') return s
    const out: any = { ...s }
    if (s.label && isUnreadable(s.label.color)) {
      out.label = { ...s.label, color: CHART_DARK.labelText }
    }
    for (const k of ['markLine', 'markPoint'] as const) {
      if (s[k]?.label && isUnreadable(s[k].label.color)) {
        out[k] = { ...s[k], label: { ...s[k].label, color: CHART_DARK.labelText } }
      }
    }
    return out
  }
  return Array.isArray(series) ? series.map(one) : one(series)
}

export function applyDarkChartTheme(option: any, dark: boolean): any {
  if (!dark || !option || typeof option !== 'object') return option
  try {
    const o: any = { ...option }

    o.textStyle = ink(option.textStyle, CHART_DARK.axisText)

    if (option.xAxis) o.xAxis = themeAxis(option.xAxis)
    if (option.yAxis) o.yAxis = themeAxis(option.yAxis)
    if (option.radiusAxis) o.radiusAxis = themeAxis(option.radiusAxis)
    if (option.angleAxis)  o.angleAxis  = themeAxis(option.angleAxis)

    if (option.legend) {
      const l = (x: any) => ({ ...x, textStyle: ink(x?.textStyle, CHART_DARK.legendText) })
      o.legend = Array.isArray(option.legend) ? option.legend.map(l) : l(option.legend)
    }

    if (option.title) {
      const t = (x: any) => ({
        ...x,
        textStyle:    ink(x?.textStyle,    CHART_DARK.titleText),
        subtextStyle: ink(x?.subtextStyle, CHART_DARK.titleSubtext),
      })
      o.title = Array.isArray(option.title) ? option.title.map(t) : t(option.title)
    }

    // ECharts tooltips render as DOM, but they default to a light card.
    if (option.tooltip) {
      const tip = (x: any) => ({
        ...x,
        backgroundColor: CHART_DARK.tooltipBg,
        borderColor:     CHART_DARK.tooltipBorder,
        textStyle:       ink(x?.textStyle, CHART_DARK.tooltipText),
      })
      o.tooltip = Array.isArray(option.tooltip) ? option.tooltip.map(tip) : tip(option.tooltip)
    }

    if (option.series) o.series = themeSeries(option.series)

    return o
  } catch {
    return option   // never let theming break a chart
  }
}
