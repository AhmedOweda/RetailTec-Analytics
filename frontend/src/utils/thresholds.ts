/**
 * Analytics thresholds — configurable in Display Settings, synced by
 * AppSettingsProvider into module globals so charts/grids can read them
 * without prop-drilling (same pattern as moneyPrefix).
 */

export interface Thresholds {
  dohWarn:     number   // days-on-hand: amber above this
  dohBad:      number   // days-on-hand: red above this
  dormantDays: number   // CRM: customer counts as dormant after this many days
  lowGmPct:    number   // GM% below this = red / "Low Margin"
  goodGmPct:   number   // GM% at/above this = green
}

export const DEFAULT_THRESHOLDS: Thresholds = {
  dohWarn: 90, dohBad: 180, dormantDays: 60, lowGmPct: 10, goodGmPct: 30,
}

let _t: Thresholds = { ...DEFAULT_THRESHOLDS }

export function setThresholdsGlobal(t: Thresholds) { _t = { ...t } }
export function thresholds(): Thresholds { return _t }

/** Traffic-light color for a GM percentage. */
export function gmColor(pct: number): string {
  return pct >= _t.goodGmPct ? '#10b981' : pct >= _t.lowGmPct ? '#f59e0b' : '#e11d48'
}

/** Traffic-light color for days-on-hand (lower is better). */
export function dohColor(days: number): string {
  return days > _t.dohBad ? '#e11d48' : days > _t.dohWarn ? '#f59e0b' : '#10b981'
}
