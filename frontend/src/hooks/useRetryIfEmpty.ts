import { useEffect, useRef } from 'react'

/**
 * Self-heal for the "opened the app and a core page is empty until I restart"
 * race: right after launch the API can briefly return 0 rows (DB attach / first
 * sync). When a page that should always have data loads empty, silently refetch
 * a few times before giving up — no user action needed.
 *
 *   const { data = [], isFetching, refetch } = useQuery(...)
 *   useRetryIfEmpty(data.length === 0, isFetching, refetch)
 */
export function useRetryIfEmpty(
  isEmpty: boolean,
  isFetching: boolean,
  refetch: () => void,
  opts: { max?: number; delayMs?: number } = {},
) {
  const { max = 5, delayMs = 2000 } = opts
  const tries = useRef(0)

  useEffect(() => {
    if (isFetching) return
    if (!isEmpty) { tries.current = 0; return }
    if (tries.current >= max) return
    tries.current += 1
    const t = setTimeout(() => refetch(), delayMs)
    return () => clearTimeout(t)
    // re-evaluate whenever the empty/fetching state settles
  }, [isEmpty, isFetching, refetch, max, delayMs])
}
