// ─────────────────────────────────────────────────────────────────────────────
// Shared chart palette — derived from the RetailTec purple brand.
//
// This module is ADDITIVE. Charts in this app each build their ECharts option
// inline (there is no single <ReactECharts> wrapper to inject a default into),
// so importing these arrays is opt-in. Use CHART_CATEGORICAL for multi-series /
// categorical charts and CHART_SEQUENTIAL for heatmaps / density ramps.
//
// Keep in step with PURPLE_BRAND in ../theme.ts.
// ─────────────────────────────────────────────────────────────────────────────

/** 8-colour categorical ramp: brand purple first, then harmonious accents. */
export const CHART_CATEGORICAL: string[] = [
  '#7040B8', // brand purple (PURPLE_BRAND[500])
  '#0E7490', // teal / secondary
  '#D4820A', // amber
  '#1B7A3E', // green
  '#E05B5B', // rose
  '#9B65D0', // light violet (PURPLE_BRAND[400])
  '#64748B', // slate
  '#0891B2', // deep cyan
]

/** Light → dark purple ramp for heatmaps and sequential density. */
export const CHART_SEQUENTIAL: string[] = [
  '#F5F0FF', // PURPLE_BRAND[50]
  '#DDD0F8', // PURPLE_BRAND[200]
  '#C8A8E8', // PURPLE_BRAND[300]
  '#9B65D0', // PURPLE_BRAND[400]
  '#7040B8', // PURPLE_BRAND[500]
  '#5B2D9E', // PURPLE_BRAND[600]
  '#4E2A99', // PURPLE_BRAND[700]
  '#2D1B6B', // PURPLE_BRAND[800]
]
