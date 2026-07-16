/**
 * Saved views — persist named filter/state sets per page in localStorage.
 * Each page passes a stable `pageKey` and its serialisable filter state.
 */
import { useState, useCallback } from 'react'

export type SavedView = { name: string; state: any }

export function useSavedViews(pageKey: string) {
  const KEY = `rt_views_${pageKey}`
  const [views, setViews] = useState<SavedView[]>(() => {
    try { return JSON.parse(localStorage.getItem(KEY) || '[]') } catch { return [] }
  })
  const persist = (v: SavedView[]) => {
    setViews(v)
    try { localStorage.setItem(KEY, JSON.stringify(v)) } catch { /* quota / disabled */ }
  }
  const save = useCallback((name: string, state: any) => {
    const clean = name.trim()
    if (!clean) return
    persist([...views.filter(x => x.name !== clean), { name: clean, state }])
  }, [views])   // eslint-disable-line react-hooks/exhaustive-deps
  const remove = useCallback((name: string) => {
    persist(views.filter(x => x.name !== name))
  }, [views])   // eslint-disable-line react-hooks/exhaustive-deps
  return { views, save, remove }
}
