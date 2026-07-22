/**
 * Global command palette (Ctrl/Cmd-K).
 * Jump to any page, or search a customer (name / id / phone) or item (ALU / desc)
 * and drill straight into the filtered Journals screen.
 */
import { useState, useEffect, useMemo, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Dialog, Box, TextField, InputAdornment, Typography, List, ListItemButton, Chip, IconButton,
} from '@mui/material'
import SearchIcon      from '@mui/icons-material/Search'
import CloseIcon       from '@mui/icons-material/Close'
import PersonIcon      from '@mui/icons-material/Person'
import Inventory2Icon  from '@mui/icons-material/Inventory2'
import ArrowForwardIcon from '@mui/icons-material/ArrowForward'
import axios from 'axios'
import { tr } from '../i18n'
import { useAppSettings } from '../context/AppSettings'
import { itemFieldValue } from './DataSlicer'
import { useLicensedDomains } from '../hooks/useLicense'
import { pathLicensed } from '../utils/pages'

const ACCENT = '#7c3aed'

// Every navigable page (kept in sync with AppShell nav).
const PAGES: { to: string; label: string; group: string }[] = [
  { to: '/sales/overview',        label: 'Overview',     group: 'Sales' },
  { to: '/sales/performance',     label: 'Performance',  group: 'Sales' },
  { to: '/sales/products',        label: 'Products',     group: 'Sales' },
  { to: '/sales/transactions',    label: 'Invoices',     group: 'Sales' },
  { to: '/sales/journals',        label: 'Invoice Explorer', group: 'Sales' },
  { to: '/purchases/overview',    label: 'Overview',     group: 'Purchases' },
  { to: '/purchases/transactions',label: 'Vouchers',     group: 'Purchases' },
  { to: '/dimensions/stores',     label: 'Stores',       group: 'Dimensions' },
  { to: '/dimensions/customers',  label: 'Customers',    group: 'Dimensions' },
  { to: '/dimensions/employees',  label: 'Employees',    group: 'Dimensions' },
  { to: '/dimensions/items',      label: 'Items',        group: 'Dimensions' },
  { to: '/dimensions/vendors',    label: 'Suppliers',    group: 'Dimensions' },
  { to: '/inventory/overview',    label: 'Stock Levels', group: 'Inventory' },
  { to: '/inventory/stock-asof',  label: 'Stock by Date',group: 'Inventory' },
  { to: '/inventory/movement',    label: 'Movement',     group: 'Inventory' },
  { to: '/inventory/transfers',   label: 'Transfers',    group: 'Inventory' },
  { to: '/inventory/adjustments', label: 'Adjustments',  group: 'Inventory' },
  { to: '/inventory/ledger',      label: 'Ledger',       group: 'Inventory' },
  { to: '/inventory/history',     label: 'History',      group: 'Inventory' },
  { to: '/inventory/coverage',    label: 'Coverage',     group: 'Inventory' },
  { to: '/assistant',             label: 'Ask AI',       group: 'Tools' },
  { to: '/settings',              label: 'Settings',     group: 'Tools' },
]

type Action = { kind: 'page' | 'customer' | 'item'; label: string; sub: string; run: () => void }

export default function CommandPalette() {
  const nav = useNavigate()
  // The configured item identifier (Settings → Product Code Field) — item
  // results are labelled and drilled with THIS field, not a hardcoded ALU.
  const { itemId } = useAppSettings()
  // Licensed domains: unlicensed pages must not exist here either. Entity
  // results drill into Journals, so they only appear when sales is licensed.
  const lic = useLicensedDomains()
  const salesLicensed = pathLicensed(lic, '/sales/journals')
  const [open, setOpen] = useState(false)
  const [q, setQ]       = useState('')
  const [cust, setCust] = useState<any[]>([])
  const [items, setItems] = useState<any[]>([])
  const [active, setActive] = useState(0)
  const listRef = useRef<HTMLUListElement>(null)

  // Ctrl/Cmd-K toggles; a custom event (from the header search box) opens it.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setOpen(o => !o) }
    }
    const onOpen = () => setOpen(true)
    window.addEventListener('keydown', onKey)
    window.addEventListener('open-command-palette', onOpen as EventListener)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('open-command-palette', onOpen as EventListener)
    }
  }, [])

  useEffect(() => { if (!open) { setQ(''); setCust([]); setItems([]); setActive(0) } }, [open])

  // Debounced entity search (customers + items) reusing existing endpoints.
  // Skipped entirely when sales is unlicensed — the results drill into the
  // (non-existent) Journals screen.
  useEffect(() => {
    const term = q.trim()
    if (term.length < 2 || !salesLicensed) { setCust([]); setItems([]); return }
    const t = setTimeout(() => {
      Promise.all([
        axios.get('/api/sales/journal/search/customers', { params: { q: term } }).then(r => r.data).catch(() => []),
        axios.get('/api/inventory/items-search', { params: { q: term } }).then(r => r.data).catch(() => []),
      ]).then(([c, i]) => { setCust((c || []).slice(0, 6)); setItems((i || []).slice(0, 6)); setActive(0) })
    }, 220)
    return () => clearTimeout(t)
  }, [q, salesLicensed])

  const go = (to: string) => { setOpen(false); nav(to) }

  const pageMatches = useMemo(() => {
    const term = q.trim().toLowerCase()
    // Unlicensed domains do not exist — their pages never appear here.
    const pages = PAGES.filter(p => pathLicensed(lic, p.to))
    if (!term) return pages
    return pages.filter(p =>
      tr(p.label).toLowerCase().includes(term) ||
      p.label.toLowerCase().includes(term) ||
      p.group.toLowerCase().includes(term))
  }, [q, lic])

  const actions: Action[] = useMemo(() => [
    ...pageMatches.map(p => ({
      kind: 'page' as const, label: tr(p.label), sub: tr(p.group),
      run: () => go(p.to),
    })),
    ...cust.map(c => ({
      // Show the customer NUMBER (cust_id), not the internal SID; fall back to
      // the name (or the SID, for customers with neither) so nothing renders blank.
      kind: 'customer' as const, label: c.name || (c.cust_id ? `#${c.cust_id}` : `#${c.customer_id}`),
      sub: `${c.cust_id ? `#${c.cust_id}` : ''}${c.phone ? `${c.cust_id ? ' · ' : ''}${c.phone}` : ''}` || tr('Customer'),
      run: () => go(`/sales/journals?customer=${encodeURIComponent(c.name || '')}`),
    })),
    ...items.map(it => {
      // The configured identifier (ALU fallback when NULL). The Journals
      // `item` filter matches ALU, UPC and description alike, so the drill
      // works whichever identifier is configured.
      const code = itemFieldValue(it, itemId.field)
      const desc = it.DESCRIPTION1 || ''
      return {
        kind: 'item' as const,
        label: itemId.field === 'description' ? (desc || code) : `${code} — ${desc}`,
        sub: tr('Item'),
        run: () => go(`/sales/journals?item=${encodeURIComponent(code)}&item_desc=${encodeURIComponent(desc)}`),
      }
    }),
  ], [pageMatches, cust, items, itemId.field])  // eslint-disable-line react-hooks/exhaustive-deps

  const onInputKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive(a => Math.min(a + 1, actions.length - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(a => Math.max(a - 1, 0)) }
    else if (e.key === 'Enter') { e.preventDefault(); actions[active]?.run() }
  }

  useEffect(() => {
    const el = listRef.current?.querySelector(`[data-idx="${active}"]`) as HTMLElement | null
    el?.scrollIntoView({ block: 'nearest' })
  }, [active])

  const iconFor = (k: Action['kind']) =>
    k === 'customer' ? <PersonIcon sx={{ fontSize: 18, color: '#0284c7' }} />
    : k === 'item'   ? <Inventory2Icon sx={{ fontSize: 18, color: '#059669' }} />
    :                  <ArrowForwardIcon sx={{ fontSize: 18, color: ACCENT }} />

  return (
    <Dialog open={open} onClose={() => setOpen(false)} maxWidth="sm" fullWidth
      PaperProps={{ sx: { borderRadius: 3, mt: '-20vh' } }}>
      <Box sx={{ p: 1.5, borderBottom: '1px solid var(--rt-border)', display: 'flex', alignItems: 'center', gap: 1 }}>
        <TextField autoFocus fullWidth size="small" value={q} placeholder={tr('Search pages, customers, items…')}
          onChange={e => setQ(e.target.value)} onKeyDown={onInputKey}
          InputProps={{ startAdornment: <InputAdornment position="start"><SearchIcon sx={{ color: '#94a3b8' }} /></InputAdornment> }} />
        <IconButton size="small" onClick={() => setOpen(false)} aria-label={tr('Close')}><CloseIcon sx={{ fontSize: 20, color: '#64748b' }} /></IconButton>
      </Box>
      <List ref={listRef} sx={{ maxHeight: 380, overflowY: 'auto', py: 0.5 }}>
        {actions.length === 0 && (
          <Typography sx={{ px: 2, py: 2, fontSize: 13, color: '#94a3b8' }}>{tr('No matches')}</Typography>
        )}
        {actions.map((a, i) => (
          <ListItemButton key={i} data-idx={i} selected={i === active}
            onMouseEnter={() => setActive(i)} onClick={a.run}
            sx={{ py: 0.75, px: 2, gap: 1.25, '&.Mui-selected': { bgcolor: `${ACCENT}12` } }}>
            {iconFor(a.kind)}
            <Box sx={{ minWidth: 0, flex: 1 }}>
              <Typography sx={{ fontSize: 13, fontWeight: 600, color: 'var(--rt-text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{a.label}</Typography>
              <Typography sx={{ fontSize: 11, color: '#94a3b8' }}>{a.sub}</Typography>
            </Box>
            {a.kind !== 'page' && <Chip size="small" label={tr('Open in Journals')} sx={{ height: 20, fontSize: 10, bgcolor: 'var(--rt-surface-3)', color: '#64748b' }} />}
          </ListItemButton>
        ))}
      </List>
      <Box sx={{ px: 2, py: 1, borderTop: '1px solid var(--rt-border)', display: 'flex', gap: 2 }}>
        <Typography sx={{ fontSize: 11, color: '#94a3b8' }}>↑↓ {tr('to navigate')}</Typography>
        <Typography sx={{ fontSize: 11, color: '#94a3b8' }}>↵ {tr('to open')}</Typography>
        <Typography sx={{ fontSize: 11, color: '#94a3b8' }}>Ctrl-K {tr('to toggle')}</Typography>
      </Box>
    </Dialog>
  )
}
