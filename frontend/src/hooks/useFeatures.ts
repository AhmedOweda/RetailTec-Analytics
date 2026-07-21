/**
 * useFeatures — which OPTIONAL Retail Pro customisations this server has.
 * ======================================================================
 * Not every Prism installation carries every customisation RetailTec reads
 * from. The sync probes them and records the answer; GET /api/features exposes
 * it. Pages use this to tell "no data in this period" apart from "this feature
 * is not installed here" and render an explanatory panel instead of an error.
 *
 * Fails OPEN: while the query is loading, or if it errors, every feature reads
 * as AVAILABLE — a flaky request must never make a working page look missing.
 */
import { useQuery } from '@tanstack/react-query'
import api from '../api/client'

export const FEATURE_INVENTORY_HISTORY = 'inventory_history'
export const FEATURE_ACCOUNTING        = 'accounting'

export interface FeatureInfo {
  available:  boolean
  checked_at: string | null
  note:       string
  reason:     string
}

export type FeatureMap = Record<string, FeatureInfo>

export function useFeatures() {
  return useQuery<FeatureMap>({
    queryKey: ['features'],
    queryFn:  () => api.get('/api/features').then(r => r.data),
    staleTime: 300_000,     // changes only on a sync
    retry: false,
  })
}

/** `[unavailable, reason]` for one feature. Unknown / loading => available. */
export function useFeature(name: string): [boolean, string] {
  const { data } = useFeatures()
  const info = data?.[name]
  if (!info || info.available !== false) return [false, '']
  return [true, info.reason || info.note || '']
}
