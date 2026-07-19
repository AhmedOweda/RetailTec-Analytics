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
const DARK_ON_DARK: Record<string, string> = {
  '#0f172a': CHART_DARK.labelText, '#1e293b': CHART_DARK.labelText,
  '#1a0d45': CHART_DARK.labelText, '#334155': CHART_DARK.axisText,
  '#475569': CHART_DARK.axisText,  '#4e3a72': CHART_DARK.axisText,
  '#64748b': CHART_DARK.axisText,
  // semantic dark statuses -> their light-on-dark equivalents
  '#065f46': '#6EE7B7', '#15803d': '#6EE7B7', '#166534': '#6EE7B7',
  '#991b1b': '#FCA5A5', '#7f1d1d': '#FCA5A5', '#b91c1c': '#FCA5A5',
  '#78350f': '#FCD34D', '#92400e': '#FCD34D',
}

const isUnreadable = (c: unknown) =>
  typeof c === 'string' && c.toLowerCase() in DARK_ON_DARK

/** Swap an unreadable colour for its dark-mode counterpart (else keep it). */
const fix = (c: unknown) =>
  (typeof c === 'string' && DARK_ON_DARK[c.toLowerCase()]) || c

/** Near-white label chips (e.g. rgba(255,255,255,0.85)) become dark plates. */
const isWhiteish = (c: unknown) =>
  typeof c === 'string' &&
  (/^#f{3,6}$/i.test(c.replace(/[^#0-9a-f]/gi, '')) ||
   /rgba?\(\s*2[45][0-9]\s*,\s*2[45][0-9]\s*,\s*2[45][0-9]/i.test(c))

/** Recolour a label object: its own colour, its chip, and any rich sub-styles. */
function themeLabel(lb: any): any {
  if (!lb || typeof lb !== 'object') return lb
  const out: any = { ...lb }
  if (isUnreadable(lb.color)) out.color = fix(lb.color)
  if (isWhiteish(lb.backgroundColor)) out.backgroundColor = 'rgba(22,13,58,0.85)'
  if (lb.rich && typeof lb.rich === 'object') {
    const rich: any = {}
    for (const [k, v] of Object.entries<any>(lb.rich)) {
      rich[k] = v && typeof v === 'object'
        ? { ...v,
            ...(isUnreadable(v.color) ? { color: fix(v.color) } : {}),
            ...(isWhiteish(v.backgroundColor) ? { backgroundColor: 'rgba(22,13,58,0.85)' } : {}) }
        : v
    }
    out.rich = rich
  }
  return out
}

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

/**
 * Series: repaint labels (including rich sub-styles, white label chips and the
 * emphasis/hover label) plus markLine/markPoint labels. Bar/line fill colours
 * are left alone — those are deliberate brand/semantic choices.
 */
function themeSeries(series: any): any {
  if (!series) return series
  const one = (s: any) => {
    if (!s || typeof s !== 'object') return s
    const out: any = { ...s }
    if (s.label)      out.label      = themeLabel(s.label)
    if (s.labelLine)  out.labelLine  = s.labelLine
    if (s.emphasis?.label) {
      out.emphasis = { ...s.emphasis, label: themeLabel(s.emphasis.label) }
    }
    for (const k of ['markLine', 'markPoint'] as const) {
      if (s[k]?.label) out[k] = { ...s[k], label: themeLabel(s[k].label) }
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
