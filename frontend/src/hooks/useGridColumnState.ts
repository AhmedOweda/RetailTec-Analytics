/**
 * useGridColumnState
 * ==================
 * Persists AG Grid column state (order, width, visibility, pinning) PER USER:
 *   1. localStorage  — instant restore on this machine (applied in onGridReady)
 *   2. server        — /api/prefs/grid_cols_<pageKey>, so the layout follows
 *                      the user to any machine (fetched async, applied when it
 *                      arrives, and kept as the source of truth)
 *
 * Usage in any AG Grid page:
 *   const { onGridReady, onColumnChanged, resetColumns } = useGridColumnState('ledger')
 *
 *   <AgGridReact
 *     onGridReady={onGridReady}
 *     onColumnMoved={onColumnChanged}
 *     onColumnResized={onColumnChanged}
 *     onColumnVisible={onColumnChanged}
 *     onColumnPinned={onColumnChanged}
 *   />
 *   <Button onClick={resetColumns}>Reset Columns</Button>
 */
import { useCallback, useRef } from 'react'
import axios from 'axios'
import { useAuth } from '../contexts/AuthContext'

const STORAGE_PREFIX = 'rtc_grid_cols_'
const SAVE_DEBOUNCE_MS = 800

export function useGridColumnState(pageKey: string) {
  const { user } = useAuth()
  const gridApiRef = useRef<any>(null)
  const saveTimer  = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Per-user local cache key + server pref key
  const storageKey = `${STORAGE_PREFIX}${user?.username ?? 'anon'}_${pageKey}`
  const prefKey    = `grid_cols_${pageKey}`

  /** Call this in onGridReady — restores local cache instantly, then syncs
   *  the server copy (covers first login on a new machine). */
  const onGridReady = useCallback((params: any) => {
    gridApiRef.current = params.api
    const cached = localStorage.getItem(storageKey)
    if (cached) {
      try {
        params.api.applyColumnState({ state: JSON.parse(cached), applyOrder: true })
      } catch { /* corrupt cache — ignore */ }
    }
    axios.get(`/api/prefs/${encodeURIComponent(prefKey)}`)
      .then(r => {
        const v = r.data?.value
        if (v && v !== cached) {
          try {
            params.api.applyColumnState({ state: JSON.parse(v), applyOrder: true })
            localStorage.setItem(storageKey, v)
          } catch { /* corrupt server value — ignore */ }
        }
      })
      .catch(() => { /* offline / older backend — local cache still works */ })
  }, [storageKey, prefKey])

  /** Wire to onColumnMoved / Resized / Visible / Pinned */
  const onColumnChanged = useCallback((event: any) => {
    // For resize events, only save when the user finishes dragging
    if (event.type === 'columnResized' && !event.finished) return
    const api = event.api ?? gridApiRef.current
    if (!api) return
    try {
      const json = JSON.stringify(api.getColumnState())
      localStorage.setItem(storageKey, json)
      if (saveTimer.current) clearTimeout(saveTimer.current)
      saveTimer.current = setTimeout(() => {
        axios.put(`/api/prefs/${encodeURIComponent(prefKey)}`, { value: json })
          .catch(() => { /* server save is best-effort */ })
      }, SAVE_DEBOUNCE_MS)
    } catch { /* storage full or unavailable — fail silently */ }
  }, [storageKey, prefKey])

  /** Clears saved state (local + server) and resets to default columns */
  const resetColumns = useCallback(() => {
    localStorage.removeItem(storageKey)
    axios.delete(`/api/prefs/${encodeURIComponent(prefKey)}`).catch(() => {})
    if (gridApiRef.current) {
      gridApiRef.current.resetColumnState()
    }
  }, [storageKey, prefKey])

  return { onGridReady, onColumnChanged, resetColumns }
}
