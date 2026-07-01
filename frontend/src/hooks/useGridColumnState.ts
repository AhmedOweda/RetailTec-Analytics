/**
 * useGridColumnState
 * ==================
 * Persists AG Grid column state (order, width, visibility) to localStorage.
 * Each page gets its own key so columns are independent.
 *
 * Usage in any AG Grid page:
 *   const { onGridReady, onColumnChanged, resetColumns } = useGridColumnState('ledger')
 *
 *   <AgGridReact
 *     onGridReady={onGridReady}
 *     onColumnMoved={onColumnChanged}
 *     onColumnResized={onColumnChanged}
 *     onColumnVisible={onColumnChanged}
 *   />
 *   <Button onClick={resetColumns}>Reset Columns</Button>
 */
import { useCallback, useRef } from 'react'

const STORAGE_PREFIX = 'rtc_grid_cols_'

export function useGridColumnState(pageKey: string) {
  const gridApiRef = useRef<any>(null)
  const storageKey = `${STORAGE_PREFIX}${pageKey}`

  /** Call this in onGridReady — restores saved state immediately */
  const onGridReady = useCallback((params: any) => {
    gridApiRef.current = params.api
    const saved = localStorage.getItem(storageKey)
    if (saved) {
      try {
        const state = JSON.parse(saved)
        params.api.applyColumnState({ state, applyOrder: true })
      } catch {
        // ignore corrupt storage
      }
    }
  }, [storageKey])

  /** Wire to onColumnMoved, onColumnResized, onColumnVisible */
  const onColumnChanged = useCallback((event: any) => {
    // For resize events, only save when user finishes dragging
    if (event.type === 'columnResized' && !event.finished) return
    const api = event.api ?? gridApiRef.current
    if (!api) return
    try {
      const state = api.getColumnState()
      localStorage.setItem(storageKey, JSON.stringify(state))
    } catch {
      // storage full or unavailable — fail silently
    }
  }, [storageKey])

  /** Clears saved state and resets grid to default column order */
  const resetColumns = useCallback(() => {
    localStorage.removeItem(storageKey)
    if (gridApiRef.current) {
      gridApiRef.current.resetColumnState()
    }
  }, [storageKey])

  return { onGridReady, onColumnChanged, resetColumns }
}
