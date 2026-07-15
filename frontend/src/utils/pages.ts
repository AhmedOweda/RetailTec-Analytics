/**
 * Page catalog — single source of truth for per-user page permissions.
 * Keys are the route paths; DIM_USERS.pages stores a CSV of these keys
 * (NULL/empty = user sees every page; admins always see everything).
 */

export interface PageDef { key: string; label: string }
export interface PageDomain { domain: string; pages: PageDef[] }

export const PAGE_DOMAINS: PageDomain[] = [
  {
    domain: 'Sales',
    pages: [
      { key: '/sales/overview',     label: 'Overview' },
      { key: '/sales/performance',  label: 'Performance' },
      { key: '/sales/products',     label: 'Products' },
      { key: '/sales/transactions', label: 'Invoices' },
    ],
  },
  {
    domain: 'Inventory',
    pages: [
      { key: '/inventory/overview',    label: 'Stock Levels' }, // (assistant lives above, not permission-gated)
      { key: '/inventory/stock-asof',  label: 'Stock by Date' },
      { key: '/inventory/movement',    label: 'Movement' },
      { key: '/inventory/transfers',   label: 'Transfers' },
      { key: '/inventory/adjustments', label: 'Adjustments' },
      { key: '/inventory/ledger',      label: 'Ledger' },
      { key: '/inventory/history',     label: 'History' },
      { key: '/inventory/coverage',    label: 'Coverage' },
    ],
  },
  {
    domain: 'Purchasing',
    pages: [
      { key: '/purchases/overview',     label: 'Overview' },
      { key: '/purchases/transactions', label: 'Vouchers' },
    ],
  },
  {
    domain: 'Dimensions',
    pages: [
      { key: '/dimensions/stores',    label: 'Stores' },
      { key: '/dimensions/customers', label: 'Customers' },
      { key: '/dimensions/employees', label: 'Employees' },
      { key: '/dimensions/items',     label: 'Items' },
      { key: '/dimensions/vendors',   label: 'Suppliers' },
    ],
  },
]

export const ALL_PAGE_KEYS: string[] =
  PAGE_DOMAINS.flatMap(d => d.pages.map(p => p.key))

/** Parse the CSV pages claim → Set of allowed keys, or null = all pages. */
export function parsePages(pages: string | null | undefined): Set<string> | null {
  if (!pages || !pages.trim()) return null
  return new Set(pages.split(',').map(p => p.trim()).filter(Boolean))
}

/** Is `path` allowed for a user with this pages claim? (null = everything) */
export function pageAllowed(allowed: Set<string> | null, path: string): boolean {
  if (!allowed) return true
  // match on the page prefix so nested routes inherit their page's permission
  return [...allowed].some(k => path === k || path.startsWith(k + '/'))
}

/** First page this user may open (fallback for redirects). */
export function firstAllowedPage(allowed: Set<string> | null): string {
  if (!allowed) return '/sales/overview'
  for (const key of ALL_PAGE_KEYS) if (allowed.has(key)) return key
  return '/sales/overview'
}
