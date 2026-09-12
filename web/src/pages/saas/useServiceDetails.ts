import { useEffect, useState } from 'react'
import { saasFetch } from '../../lib/saasApi'
import { errorText } from './components'
import type { CatalogOffering, CatalogProvider, ServiceDetails } from './types'

export function useServiceDetails(id: string | undefined) {
  const [service, setService] = useState<ServiceDetails | null>(null)
  const [catalog, setCatalog] = useState<CatalogOffering[]>([])
  const [error, setError] = useState('')
  const load = () => {
    if (!id) return
    saasFetch<ServiceDetails>(`/api/saas/model-services/${id}`).then((result) => { setService(result.data || null) }).catch((e: unknown) => setError(errorText(e)))
  }
  useEffect(() => {
    load()
    saasFetch<{ offerings?: CatalogOffering[]; providers?: CatalogProvider[] }>('/api/saas/model-catalog').then((result) => {
      setCatalog(result.data?.offerings?.length ? result.data.offerings : result.data?.providers?.flatMap((provider) => provider.models) || [])
    }).catch(() => {})
  }, [id])
  return { service, catalog, error, setError, load }
}
