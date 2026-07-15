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
// "Safe" prefix for RAW STRING contexts that can't render an SVG (AG-Grid cell
// text, chart canvas labels, PDF/Excel exports): the U+20C1 Saudi Riyal sign has
// no font on many machines and shows as a tofu box, so there we fall back to the
// ASCII text "SAR". React money displays keep the real sign and draw it as an
// inline SVG (see components/RiyalSign MoneyText), so KPI cards still show ﷼.
const RIYAL_CH = String.fromCharCode(0x20C1)
let _moneyPrefixSafe = 'SAR '

export function setMoneyPrefixGlobal(p: string) {
  _moneyPrefix = p
  // swap the un-renderable Riyal sign for "SAR"; other currencies are plain text
  _moneyPrefixSafe = p.indexOf(RIYAL_CH) === -1 ? p : p.replace(RIYAL_CH, 'SAR')
}
/** Safe (tofu-free) prefix for grid/chart/export strings — "SAR" for Saudi Riyal. */
export function moneyPrefix(): string { return _moneyPrefixSafe }

/**
 * moneyPrefix() + amount for HEADLINE / KPI numbers.
 * When the "Abbreviate large numbers" Display Setting is ON, this abbreviates
 * to K/M (mirroring num()) with the currency prefix — e.g. "⃁6.4M", "⃁292K".
 * When OFF, it shows the full thousands-formatted number.
 * For DETAIL TABLES/grids that must stay full-precision, use moneyExact().
 */
export function money(v: unknown, decimals?: number): string {
  const d = decimals ?? _moneyDecimals
  const n = v == null ? 0 : Number(v)
  if (isNaN(n)) return _moneyPrefix + (0).toFixed(d)
  const abs  = Math.abs(n)
  const sign = n < 0 ? '-' : ''
  if (_abbrev) {
    if (abs >= 1_000_000)
      return `${_moneyPrefix}${sign}${(abs / 1_000_000).toFixed(d)}M`
    if (abs >= 1_000)
      return `${_moneyPrefix}${sign}${(abs / 1_000).toFixed(d)}K`
  }
  return _moneyPrefix + n.toLocaleString('en-US', {
    minimumFractionDigits: d, maximumFractionDigits: d,
  })
}

/**
 * moneyPrefix() + FULL thousands-formatted number — NEVER abbreviated.
 * Use for detail tables / grids that must keep full precision regardless of
 * the "Abbreviate large numbers" Display Setting.
 */
export function moneyExact(v: unknown, decimals?: number): string {
  const d = decimals ?? _moneyDecimals
  const n = v == null ? 0 : Number(v)
  if (isNaN(n)) return _moneyPrefixSafe + (0).toFixed(d)
  return _moneyPrefixSafe + n.toLocaleString('en-US', {
    minimumFractionDigits: d, maximumFractionDigits: d,
  })
}
