import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { saasFetch } from '../../lib/saasApi'
import { errorText } from './components'
import type { Service } from './types'

/**
 * Shared model-service list cache for the SaaS shell.
 *
 * Contract:
 * - `ModelServicesProvider` owns the `GET /api/saas/model-services` request for the whole
 *   tree it wraps. The list is fetched once per page load and afterwards only when a
 *   caller explicitly invokes `refresh()`, so client-side navigation between `/app/*`
 *   pages no longer re-requests the same list.
 * - `useModelServices()` returns the nearest provider value. When it is called outside a
 *   provider it degrades to a page-local fetch with exactly the same shape, so a page
 *   never breaks just because the shell forgot to mount the provider.
 * - `refresh()` resolves with the freshly fetched list so callers can chain work after a
 *   mutation. When the request fails it resolves with an empty array and reports the
 *   failure through `error` instead of throwing, so fire-and-forget callers cannot
 *   produce an unhandled rejection.
 * - Providers may be nested: an inner provider reuses its ancestor's value instead of
 *   issuing a second request (mounting one is therefore always safe).
 */
export interface ModelServicesValue {
  services: Service[]
  loading: boolean
  error: string
  refresh: () => Promise<Service[]>
}

const ModelServicesContext = createContext<ModelServicesValue | null>(null)

/**
 * Last successfully fetched list, kept at module scope. React Router swaps the `/app`
 * route element (provider + dashboard) for a `SaasPage` element (layout + provider) when
 * the user leaves the overview, which remounts the provider; reusing this snapshot means
 * such a remount shows the cached data instead of re-requesting it. A failed request
 * leaves the snapshot untouched, so the next mount retries.
 */
let cachedServices: Service[] | null = null

/**
 * Owns the list state and the request itself. The initial fetch is deliberately not
 * triggered here: the provider and the fallback hook decide when it should happen so
 * both paths share identical loading/error semantics.
 */
function useModelServicesSource(): ModelServicesValue {
  const [services, setServices] = useState<Service[]>(() => cachedServices ?? [])
  const [loading, setLoading] = useState(cachedServices === null)
  const [error, setError] = useState('')

  const refresh = useCallback(async (): Promise<Service[]> => {
    try {
      const result = await saasFetch<Service[]>('/api/saas/model-services')
      const next = result.data || []
      cachedServices = next
      setServices(next)
      setError('')
      return next
    } catch (cause: unknown) {
      setError(errorText(cause))
      return []
    } finally {
      setLoading(false)
    }
  }, [])

  return useMemo(() => ({ services, loading, error, refresh }), [services, loading, error, refresh])
}

/**
 * Performs the initial fetch exactly once per mounted consumer, and never when a previous
 * mount already cached the list. The ref guard keeps React StrictMode's double-invoked
 * mount effect from firing a second request, while a genuine remount with an empty cache
 * still gets a fresh ref and therefore a fresh fetch.
 */
function useInitialModelServicesFetch(enabled: boolean, refresh: () => Promise<Service[]>) {
  const requested = useRef(false)
  useEffect(() => {
    if (!enabled || requested.current || cachedServices) return
    requested.current = true
    void refresh()
  }, [enabled, refresh])
}

export function ModelServicesProvider({ children }: { children: ReactNode }) {
  const inherited = useContext(ModelServicesContext)
  const source = useModelServicesSource()
  useInitialModelServicesFetch(!inherited, source.refresh)
  // Nested providers simply forward the ancestor value, so the list is still requested
  // only once even when the `/app` route and `SaasLayout` both mount a provider.
  if (inherited) return <>{children}</>
  return <ModelServicesContext.Provider value={source}>{children}</ModelServicesContext.Provider>
}

export function useModelServices(): ModelServicesValue {
  const shared = useContext(ModelServicesContext)
  // Every hook below runs unconditionally; when a provider is mounted the shared value
  // wins and the page-local source stays dormant (its initial fetch is disabled).
  const source = useModelServicesSource()
  useInitialModelServicesFetch(!shared, source.refresh)
  return shared ?? source
}
