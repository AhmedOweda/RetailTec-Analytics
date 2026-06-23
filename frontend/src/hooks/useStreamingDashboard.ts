import { useState, useEffect, useRef, useCallback } from 'react'
import type { DashboardData, DashboardParams, StreamStep } from '../types'

interface UseStreamResult {
  data:    DashboardData | null
  steps:   StreamStep[]
  loading: boolean
  error:   string | null
  refetch: () => void
}

/** Cleanly close an EventSource without triggering its onerror/onmessage handlers */
function closeES(es: EventSource | null) {
  if (!es) return
  es.onmessage = null
  es.onerror   = null
  es.close()
}

export function useStreamingDashboard(params: DashboardParams): UseStreamResult {
  const { host, dateFrom, dateTo, stores, itemTypes, cacheTtl } = params

  const [data,    setData]    = useState<DashboardData | null>(null)
  const [steps,   setSteps]   = useState<StreamStep[]>([])
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState<string | null>(null)
  const esRef = useRef<EventSource | null>(null)

  const ready = !!host && !!dateFrom && !!dateTo && stores.length > 0

  const fetch = useCallback(() => {
    if (!ready) return

    // Cancel any in-flight stream — null handlers first so onerror doesn't fire
    closeES(esRef.current)
    esRef.current = null

    setLoading(true)
    setData(null)
    setSteps([])
    setError(null)

    const qs = new URLSearchParams({
      host,
      date_from:  dateFrom,
      date_to:    dateTo,
      stores:     stores.join(','),
      item_types: itemTypes,
      cache_ttl:  String(cacheTtl),
    })

    const es = new EventSource(`/api/dashboard/stream?${qs}`)
    esRef.current = es

    es.onmessage = (e: MessageEvent) => {
      // Ignore stale events from a superseded connection
      if (esRef.current !== es) return

      const msg = JSON.parse(e.data)

      if (msg.error && !msg.complete) {
        setError(msg.error as string)
        setLoading(false)
        closeES(es)
        return
      }
      if (msg.complete) {
        setData(msg.result as DashboardData)
        setLoading(false)
        closeES(es)
        return
      }
      setSteps(prev => [...prev, msg as StreamStep])
    }

    es.onerror = () => {
      if (esRef.current !== es) return   // ignore errors from cancelled streams
      setError('Connection lost. Is the backend running on port 8000?')
      setLoading(false)
      closeES(es)
    }
  }, [host, dateFrom, dateTo, stores, itemTypes, cacheTtl, ready])

  // Re-run whenever params change; cleanup cancels the previous stream
  useEffect(() => {
    if (ready) fetch()
    return () => closeES(esRef.current)
  }, [fetch, ready])

  return { data, steps, loading, error, refetch: fetch }
}
