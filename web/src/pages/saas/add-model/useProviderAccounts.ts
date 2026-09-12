import { useEffect, useRef, useState } from 'react'
import { saasFetch } from '../../../lib/saasApi'
import type { DraftEndpoint, SaasProvider } from '../types'

// Provider account defaults that both the initial load and a manual account switch
// write into the draft endpoint.
export function accountDraftPatch(acc: SaasProvider): Partial<DraftEndpoint> {
  return {
    provider_type: acc.provider_type,
    protocol: acc.protocol || 'openai',
    base_url: acc.base_url,
    upstream_model_id: '',
    input_price_per_1m: '',
    output_price_per_1m: '',
    capability_score: '0.70',
    context_length: '',
  }
}

// Loads the saved provider accounts and tracks which one is selected. When accounts
// exist the first one becomes the default and its defaults are handed back to the
// caller through `onAccountLoaded`.
export function useProviderAccounts({ onAccountLoaded }: { onAccountLoaded: (acc: SaasProvider) => void }) {
  const [savedAccounts, setSavedAccounts] = useState<SaasProvider[]>([])
  const [useExisting, setUseExisting] = useState(true)
  const [selectedAccountId, setSelectedAccountId] = useState<string>('')
  const onAccountLoadedRef = useRef(onAccountLoaded)
  onAccountLoadedRef.current = onAccountLoaded

  useEffect(() => {
    saasFetch<SaasProvider[]>('/api/saas/providers').then((res) => {
      const list = res.data || []
      setSavedAccounts(list)
      if (list.length > 0) {
        setSelectedAccountId(list[0].id)
        setUseExisting(true)
        onAccountLoadedRef.current(list[0])
      } else {
        setUseExisting(false)
      }
    }).catch(() => {
      setUseExisting(false)
    })
  }, [])

  return { savedAccounts, useExisting, setUseExisting, selectedAccountId, setSelectedAccountId }
}
