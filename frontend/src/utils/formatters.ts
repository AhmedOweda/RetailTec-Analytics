/**
 * Number formatters
 * =================
 * num(v)         → "1,234.56"  /  "1.23K"  /  "1.23M"   (money, 2dp)
 * num(v, 0)      → "1,235"     /  "1K"     /  "1M"       (integers)
 * num(v, 1)      → "1,234.6"   /  "1.2K"   /  "1.2M"     (1dp)
 * pct(v)         → "12.34%"
 * formatDate(d)  → "23 Jun 2026"
 */

export function num(v: unknown, decimals = 2): string {
  const n = v == null ? 0 : Number(v)
  if (isNaN(n)) return (0).toFixed(decimals)
  const abs  = Math.abs(n)
  const sign = n < 0 ? '-' : ''
  if (abs >= 1_000_000)
    return `${sign}${(abs / 1_000_000).toFixed(decimals)}M`
  if (abs >= 1_000)
    return `${sign}${(abs / 1_000).toFixed(decimals)}K`
  return n.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
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
