/**
 * Number formatters
 * =================
 * num(v)         → "1,234.56"  /  "1.23K"  /  "1.23M"   (money, 2dp)
 * num(v, 0)      → "1,235"     /  "1K"     /  "1M"       (integers)
 * num(v, 1)      → "1,234.6"   /  "1.2K"   /  "1.2M"     (1dp)
 * pct(v)         → "12.34%"
 * formatDate(d)  → "23 Jun 2026"
 */

/* Number-format preferences (Display Settings) — synced by AppSettingsProvider */
let _abbrev        = true   // 1.23M / 1.2K style for large numbers
let _moneyDecimals = 0      // decimals for money() amounts

export function setNumberFormatGlobal(opts: { abbreviate?: boolean; moneyDecimals?: number }) {
  if (opts.abbreviate    !== undefined) _abbrev        = opts.abbreviate
  if (opts.moneyDecimals !== undefined) _moneyDecimals = opts.moneyDecimals
}

export function num(v: unknown, decimals = 2): string {
  const n = v == null ? 0 : Number(v)
  if (isNaN(n)) return (0).toFixed(decimals)
  const abs  = Math.abs(n)
  const sign = n < 0 ? '-' : ''
  if (_abbrev) {
    if (abs >= 1_000_000)
      return `${sign}${(abs / 1_000_000).toFixed(decimals)}M`
    if (abs >= 1_000)
      return `${sign}${(abs / 1_000).toFixed(decimals)}K`
  }
  return n.toLocaleString('en-US', {
    minimumFractionDigits: _abbrev ? decimals : Math.min(decimals, _moneyDecimals),
    maximumFractionDigits: decimals,
  })
}

export function pct(v: unknown): string {
  const n = v == null ? 0 : Number(v)
  return `${n.toFixed(2)}%`
}

export function formatDate(d: string): string {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric',
  })
}

/* ── Currency prefix ──────────────────────────────────────────────────────────
 * Global, kept in sync by AppSettingsProvider from the Display Settings
 * (selected currency + show/hide switch). Pages call moneyPrefix() instead of
 * hardcoding '$' — the app sells into the Gulf; default is the Saudi Riyal
 * sign ⃁ (U+20C1). */
let _moneyPrefix = '⃁ '

export function setMoneyPrefixGlobal(p: string) { _moneyPrefix = p }
export function moneyPrefix(): string { return _moneyPrefix }

/** moneyPrefix() + thousands-formatted number (decimals default from Display Settings) */
export function money(v: unknown, decimals?: number): string {
  const d = decimals ?? _moneyDecimals
  const n = v == null ? 0 : Number(v)
  if (isNaN(n)) return _moneyPrefix + (0).toFixed(d)
  return _moneyPrefix + n.toLocaleString('en-US', {
    minimumFractionDigits: d, maximumFractionDigits: d,
  })
}
