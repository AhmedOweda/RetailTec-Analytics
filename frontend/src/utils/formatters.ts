export const num = (v: unknown): number => (v == null ? 0 : Number(v))

export const fmt = (v: number, decimals = 0): string =>
  v == null ? '—' : v.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })

export const sar = (v: number): string => {
  const abs = Math.abs(v)
  if (abs >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`
  if (abs >= 1_000)     return `${(v / 1_000).toFixed(1)}K`
  return fmt(v, 0)
}

export const pct = (v: number): string => `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`

export const formatDate = (d: string): string => {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}
