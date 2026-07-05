/**
 * Global subsidiary selection — a tiny module-level store.
 *
 * Holds the currently-selected subsidiary SID ('' = All Subsidiaries).
 * The axios request interceptor (api/client.ts) reads this via getSubsidiary()
 * and appends `subsidiaries=<sid>` to every /api/sales|inventory|purchases
 * request, so switching the header selector filters the whole app without
 * touching individual query keys.
 */
const STORAGE_KEY = 'rt_subsidiary'

let current: string = localStorage.getItem(STORAGE_KEY) || ''

export function getSubsidiary(): string {
  return current
}

export function setSubsidiary(sid: string): void {
  current = sid || ''
  if (current) localStorage.setItem(STORAGE_KEY, current)
  else localStorage.removeItem(STORAGE_KEY)
}
