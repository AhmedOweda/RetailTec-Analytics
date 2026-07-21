/**
 * useGlWindow — the opening date window for the Accounting pages.
 * ==============================================================
 * A general ledger is loaded PER ACCOUNTING PERIOD, not as a rolling tail. The
 * pages used to open on "last 30 days", so a warehouse holding (say) a January
 * period looked completely empty when opened in July — indistinguishable from a
 * broken sync. Instead we ask the backend for the GL's own span
 * (MIN/MAX POST_DATE in FACT_GL, GET /api/accounting/date-range) and open on
 * that.
 *
 * Fails SAFE: if the range is null (GL empty, or the accounting customisation
 * is absent on this server) nothing is applied and the page keeps its own
 * default window and shows its normal empty state.
 */
import { useEffect, useRef } from 'react'
import type { MutableRefObject } from 'react'
import { useQuery } from '@tanstack/react-query'
import api from '../api/client'

export interface GlRange {
  date_from:   string | null
  date_to:     string | null
  unavailable: boolean
  reason:      string
}

export function useGlRange() {
  return useQuery<GlRange>({
    queryKey:  ['accounting-date-range'],
    queryFn:   () => api.get('/api/accounting/date-range').then(r => r.data),
    staleTime: 300_000,   // changes only on a sync
    retry:     false,
  })
}

/**
 * Apply the GL's own span as the opening window — ONCE, and never over a window
 * the caller has already pinned.
 *
 * `pinned` must be set to true by the page whenever the window comes from
 * somewhere authoritative: drill-through URL params, a preset chip, or a manual
 * date edit. Without that guard a slow range query could overwrite a window the
 * user just chose.
 */
export function useGlDefaultWindow(
  pinned: MutableRefObject<boolean>,
  apply: (from: string, to: string) => void,
) {
  const { data } = useGlRange()
  const applied = useRef(false)

  useEffect(() => {
    if (applied.current || pinned.current) return
    if (!data?.date_from || !data?.date_to) return
    applied.current = true
    apply(data.date_from, data.date_to)
  }, [data])   // eslint-disable-line react-hooks/exhaustive-deps
}
