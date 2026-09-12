import { useEffect, useMemo, useState } from 'react'
import { saasFetch } from '../../../lib/saasApi'
import { formatPriceInput } from '../serviceUtils'
import type { CatalogOffering } from '../types'

// Load the OpenRouter market and merge it on top of the catalog the page already
// fetched, so the picker can offer live market models without the parent refetching.
export function useCatalogMarket(initialCatalog: CatalogOffering[]) {
  const [marketModels, setMarketModels] = useState<CatalogOffering[]>([])

  useEffect(() => {
    let active = true
    const mapMarket = (items: Array<{ id: string; name: string; prompt_price_per_1m: number; completion_price_per_1m: number; context_length: number; description: string | null }>): CatalogOffering[] =>
      items.map((m) => ({
        provider_id: 'openrouter',
        provider_name: 'OpenRouter',
        endpoint_id: `openrouter-${m.id}`,
        endpoint_key: 'openrouter',
        region: 'global',
        base_url: 'https://openrouter.ai/api/v1',
        price_currency: 'USD',
        model: m.id,
        model_name: m.name,
        description: m.description || '',
        input_price_per_1m: formatPriceInput(m.prompt_price_per_1m) ? Number(formatPriceInput(m.prompt_price_per_1m)) : 0,
        output_price_per_1m: formatPriceInput(m.completion_price_per_1m) ? Number(formatPriceInput(m.completion_price_per_1m)) : 0,
        cache_read_price_per_1m: 0,
        cache_write_price_per_1m: 0,
        supports_tools: true,
        supports_vision: false,
        supports_reasoning: /(?:^|[^a-z0-9])(?:r1|o1|o3)(?:[^a-z0-9]|$)/i.test(m.id) || m.id.includes('reasoning'),
        context_length: m.context_length,
      }))

    const loadMarket = async () => {
      try {
        let res = await saasFetch<{ models?: Array<{ id: string; name: string; prompt_price_per_1m: number; completion_price_per_1m: number; context_length: number; description: string | null }> }>('/api/saas/openrouter/market?page_size=1000')
        if ((!res.data?.models || res.data.models.length <= 3) && active) {
          try {
            await saasFetch('/api/saas/openrouter/sync', { method: 'POST' })
            res = await saasFetch('/api/saas/openrouter/market?page_size=1000')
          } catch (_) {}
        }
        if (active && res.data?.models?.length) {
          setMarketModels(mapMarket(res.data.models))
        }
      } catch (_) {}
    }
    loadMarket()
    return () => { active = false }
  }, [])

  const fullCatalog = useMemo(() => {
    if (marketModels.length === 0) return initialCatalog
    const nonOr = initialCatalog.filter((item) => item.provider_id !== 'openrouter')
    return [...nonOr, ...marketModels]
  }, [initialCatalog, marketModels])

  return { fullCatalog, marketModels }
}
