import { useQuery } from '@tanstack/react-query'
import axios from 'axios'
import type { Subsidiary, Store } from '../types'

export function useSubsidiaries(host: string) {
  return useQuery<Subsidiary[]>({
    queryKey: ['subsidiaries', host],
    queryFn: () => axios.get('/api/subsidiaries', { params: { host } }).then(r => r.data),
    staleTime: 5 * 60 * 1000,
  })
}

export function useStores(host: string, subsidiarySid?: string | null) {
  return useQuery<Store[]>({
    queryKey: ['stores', host, subsidiarySid],
    queryFn: () =>
      axios.get('/api/stores', { params: { host, ...(subsidiarySid ? { subsidiary_sid: subsidiarySid } : {}) } })
        .then(r => r.data),
    staleTime: 5 * 60 * 1000,
  })
}
