/**
 * useLicensedDomains — which product domains this install's license covers.
 * ========================================================================
 * The license may restrict the product to a subset of domains (home, ai,
 * sales, inventory, purchases, accounting, dimensions, reports). The backend
 * enforces this with a 403 middleware; this hook lets the UI remove the
 * corresponding nav entries, routes, cards and settings sections — for every
 * user, admins included.
 *
 * Fails OPEN: null/undefined (no restriction, legacy license, or the status
 * query still loading) reads as "everything licensed" so the nav never
 * flashes empty. Shares the ['settings-status'] query cache with AppShell.
 */
import { useQuery } from '@tanstack/react-query'
import api from '../api/client'
import { LicensedDomains, domainLicensed } from '../utils/pages'

export function useSettingsStatus() {
  return useQuery<any>({
    queryKey: ['settings-status'],
    queryFn:  () => api.get('/api/settings/status').then(r => r.data),
    staleTime: 60_000,
    retry: false,
  })
}

/** The licensed domain list — null/undefined = no restriction. */
export function useLicensedDomains(): LicensedDomains {
  const { data } = useSettingsStatus()
  return data?.licensed_domains ?? null
}

/** Is one license domain covered? (loading / no restriction => yes) */
export function useDomainLicensed(domain: string): boolean {
  return domainLicensed(useLicensedDomains(), domain)
}
