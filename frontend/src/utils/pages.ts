/**
 * Page catalog — single source of truth for per-user page permissions.
 * Keys are the route paths; DIM_USERS.pages stores a CSV of these keys
 * (NULL/empty = user sees every page; admins always see everything).
 */

export interface PageDef { key: string; label: string }
export interface PageDomain { domain: string; pages: PageDef[] }

export const PAGE_DOMAINS: PageDomain[] = [
  {
    // General — the cross-domain pages. Listed FIRST so '/home' is the first
    // key in ALL_PAGE_KEYS: an unrestricted user's landing page stays Home.
    // Users with a restricted list that predates these keys LOSE Home and the
    // Data Analyst — deliberate (owner request): "accounting only" must hide
    // them. NULL/empty lists still see everything, as always.
    domain: 'General',
    pages: [
      { key: '/home',      label: 'Home' },
      { key: '/assistant', label: 'Data Analyst' },
    ],
  },
  {
    domain: 'Sales',
    pages: [
      { key: '/sales/overview',     label: 'Overview' },
      { key: '/sales/performance',  label: 'Performance' },
      { key: '/sales/products',     label: 'Products' },
      { key: '/sales/transactions', label: 'Invoices' },
      { key: '/sales/journals',     label: 'Invoice Explorer' },
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
    domain: 'Accounting',
    pages: [
      { key: '/accounting/journal',        label: 'Journal' },
      { key: '/accounting/trial-balance',  label: 'Trial Balance' },
      { key: '/accounting/profit-loss',    label: 'Profit & Loss' },
      { key: '/accounting/balance-sheet',  label: 'Balance Sheet' },
      { key: '/accounting/bp-statement',   label: 'BP Statement' },
      { key: '/accounting/aging',          label: 'Aging' },
      { key: '/accounting/general-ledger', label: 'General Ledger' },
      { key: '/accounting/exceptions',     label: 'GL Exceptions' },
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

// ── Licensed product domains ────────────────────────────────────────────────
// The license may restrict the install to a subset of domains. The backend is
// the source of truth (middleware 403s unlicensed endpoints); this layer just
// removes the corresponding UI. null/undefined = no restriction (legacy
// license, no license, or /api/settings/status still loading — fail OPEN so
// the nav never flashes empty).
export type LicensedDomains = string[] | null | undefined

/** Route-prefix → license domain. Longest/most specific first. */
const PATH_LICENSE_DOMAIN: [string, string][] = [
  ['/home',       'home'],
  ['/assistant',  'ai'],
  ['/sales',      'sales'],
  ['/inventory',  'inventory'],
  ['/purchases',  'purchases'],
  ['/accounting', 'accounting'],
  ['/dimensions', 'dimensions'],
]

/** Is a license domain covered? (no restriction / unknown domain = yes) */
export function domainLicensed(domains: LicensedDomains, domain: string): boolean {
  return !domains || domains.includes(domain)
}

/** Is this route covered by the license? Unmapped routes (settings, login…)
 *  are always allowed — the license never hides Settings. */
export function pathLicensed(domains: LicensedDomains, path: string): boolean {
  if (!domains) return true
  const hit = PATH_LICENSE_DOMAIN.find(([p]) => path === p || path.startsWith(p + '/'))
  return hit ? domains.includes(hit[1]) : true
}

/** Landing page for this user under this license: the first page that is
 *  BOTH user-allowed and license-covered. '/home' and '/assistant' are the
 *  first two keys in ALL_PAGE_KEYS (General domain), so Home stays the
 *  landing page whenever the user may open it — but a user whose pages list
 *  omits it now falls through to their first allowed+licensed page. */
export function firstLicensedPage(allowed: Set<string> | null,
                                  domains: LicensedDomains): string {
  for (const key of ALL_PAGE_KEYS)
    if (pathLicensed(domains, key) && pageAllowed(allowed, key)) return key
  return '/settings'   // last resort — always exists, admin-gated by its route
}
