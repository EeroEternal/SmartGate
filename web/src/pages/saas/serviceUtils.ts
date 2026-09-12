import type { CallApi, CatalogOffering, DraftEndpoint } from './types'

export function modelOptions(models: CatalogOffering[]) {
  return Array.from(new Map(models.map((item) => [item.model, { id: item.model, name: item.model_name }])).values())
}

export function hasCatalogDetails(model: CatalogOffering | undefined) {
  return Boolean(model && (model.input_price_per_1m > 0 || model.output_price_per_1m > 0 || model.context_length || model.supports_tools || model.supports_vision || model.supports_reasoning))
}

// Match a token with non-alphanumeric boundaries so short tokens like "o1" do not
// substring-match inside unrelated ids (e.g. "sao10k" or "qwen2.5-72b" for "72b").
function bounded(token: string): RegExp {
  return new RegExp(`(?:^|[^a-z0-9])${token}(?:[^a-z0-9]|$)`, 'i')
}

// Strip OpenRouter-style pricing variants so "gpt-4o-mini:batch" matches as "gpt-4o-mini".
function baseModelId(model: string): string {
  return model.toLowerCase().replace(/:(batch|extended|nitro)$/i, '')
}

export function inferDefaultCapability(model?: CatalogOffering, modelId?: string): string {
  const name = (model?.model || modelId || '').toLowerCase()
  if (/r1|reasoner|claude-3-5-sonnet|claude-3-7-sonnet|opus|gpt-4\.5/i.test(name) || bounded('o1').test(name) || bounded('o3').test(name)) return '0.96'
  if (/gpt-4o|70b|72b|405b|deepseek-chat|deepseek-v3|deepseek-coder/i.test(name) || bounded('pro').test(name) || bounded('max').test(name)) return '0.92'
  if (model?.supports_reasoning) return '0.85'
  if (/flash|mini|nano|lite|8b|7b|3b|1\.5b|0\.5b/i.test(name)) return '0.65'
  return '0.70'
}

export type SmartBundle = 'balanced' | 'free' | 'reasoning'

export interface ModelFilter {
  query: string
  providerPrefix: string
  freeOnly: boolean
  maxInputPrice: string
}

const EMPTY_FILTER: ModelFilter = { query: '', providerPrefix: '', freeOnly: false, maxInputPrice: '' }

export function catalogProviderPrefixes(models: CatalogOffering[]): string[] {
  return Array.from(new Set(models.map((m) => (m.model || '').split('/')[0]).filter(Boolean))).sort()
}

export function filterCatalogModels(models: CatalogOffering[], filter: ModelFilter): CatalogOffering[] {
  const query = filter.query.trim().toLowerCase()
  const maxPrice = Number(filter.maxInputPrice)
  const hasPriceCap = filter.maxInputPrice.trim() !== '' && Number.isFinite(maxPrice)
  const prefix = filter.providerPrefix
  return models.filter((m) => {
    if (prefix && (m.model || '').split('/')[0] !== prefix) return false
    if (filter.freeOnly && !(m.model.endsWith(':free') || (m.input_price_per_1m === 0 && m.output_price_per_1m === 0))) return false
    if (hasPriceCap && m.input_price_per_1m > maxPrice) return false
    if (!query) return true
    const id = (m.model || '').toLowerCase()
    const name = (m.model_name || '').toLowerCase()
    return id === query || id.endsWith(`/${query}`) || id.startsWith(query) || id.includes(`/${query}`) || name.startsWith(query) || id.includes(query) || name.includes(query)
  })
}

export function searchScore(model: CatalogOffering, rawQuery: string): number {
  const query = rawQuery.trim().toLowerCase()
  if (!query) return 1
  const id = (model.model || '').toLowerCase()
  const name = (model.model_name || '').toLowerCase()
  if (id === query || id.endsWith(`/${query}`)) return 100
  if (id.startsWith(query) || id.includes(`/${query}`) || name.startsWith(query)) return 80
  if (id.includes(query) || name.includes(query)) return 40
  return 0
}

export { EMPTY_FILTER }

export function computeBundleSelection(bundle: SmartBundle, models: CatalogOffering[]): string[] {
  if (bundle === 'free') {
    return models
      .filter((m) => m.model.endsWith(':free') || (m.input_price_per_1m === 0 && m.output_price_per_1m === 0))
      .map((m) => m.model)
  }
  if (bundle === 'reasoning') {
    return models
      .filter((m) => /reasoner|claude-.*sonnet|opus|gpt-4\.5/i.test(baseModelId(m.model)) || bounded('r1').test(baseModelId(m.model)) || bounded('o1').test(baseModelId(m.model)) || bounded('o3').test(baseModelId(m.model)))
      .slice(0, 3)
      .map((m) => m.model)
  }
  const freeOrCheap =
    models.find((m) => m.model.endsWith(':free') || m.input_price_per_1m === 0) ||
    models.find((m) => /flash|mini|7b|8b/i.test(baseModelId(m.model)))
  const midPattern = /deepseek-chat|deepseek-v3|qwen-?2\.5-72b|gpt-4o-mini/i
  const isVariant = (model: string) => /:(batch|extended|nitro)$/i.test(model)
  const mid =
    models.find((m) => midPattern.test(baseModelId(m.model)) && !isVariant(m.model)) ||
    models.find((m) => midPattern.test(baseModelId(m.model))) ||
    models[Math.min(1, models.length - 1)]
  const pro =
    models.find(
      (m) =>
        /deepseek-reasoner|deepseek-r1|claude-3-5-sonnet|claude-3-7-sonnet|sonnet-4|qwen-max|gpt-4o(?!-mini)/i.test(baseModelId(m.model)) ||
        bounded('o1').test(baseModelId(m.model)) ||
        bounded('o3').test(baseModelId(m.model))
    ) || models[0]
  return Array.from(new Set([freeOrCheap?.model, mid?.model, pro?.model].filter((id): id is string => Boolean(id))))
}

export function getStrategyOptions(t: (key: string, params?: Record<string, string | number>) => string) {
  return [
    { id: 'cost_aware', name: t('services.routing_cost') },
    { id: 'capability_aware', name: t('services.routing_capability') },
    { id: 'load_aware', name: t('services.routing_load') },
    { id: 'round_robin', name: t('services.routing_round_robin') },
  ]
}

export function routingInfo(strategy: string, t: (key: string, params?: Record<string, string | number>) => string) {
  const map: Record<string, { label: string; description: string }> = {
    cost_aware: {
      label: t('services.routing_cost'),
      description: t('services.strategy_cost_desc'),
    },
    capability_aware: {
      label: t('services.routing_capability'),
      description: t('services.strategy_dna_desc'),
    },
    load_aware: {
      label: t('services.routing_load'),
      description: t('services.strategy_load_desc'),
    },
    round_robin: {
      label: t('services.routing_round_robin'),
      description: t('services.strategy_round_robin_desc'),
    },
  }
  return map[strategy] || { label: strategy.replaceAll('_', ' '), description: t('services.routing_default_desc') }
}

export function serviceStatusLabel(status: string, t: (key: string, params?: Record<string, string | number>) => string) {
  return status === 'draft' ? t('services.setup_needed') : t('services.ready')
}
export const emptyEndpoint = (): DraftEndpoint => ({ provider_type: 'custom', custom_provider_id: '', protocol: 'openai', base_url: '', api_key: '', upstream_model_id: '', input_price_per_1m: '', output_price_per_1m: '', capability_score: '', context_length: '' })

export function endpointComplete(endpoint: DraftEndpoint) {
  return Boolean(
    (endpoint.provider_type !== 'custom' || endpoint.custom_provider_id.trim()) &&
    endpoint.base_url.trim() &&
    endpoint.api_key.trim() &&
    endpoint.upstream_model_id.trim()
  )
}

export function endpointLabel(endpoint: DraftEndpoint, catalog: CatalogOffering[], t: (key: string) => string) {
  const provider = catalog.find((item) => item.provider_id === endpoint.provider_type)?.provider_name
  return [provider || (endpoint.custom_provider_id || t('services.provider_not_selected')), endpoint.upstream_model_id || t('services.model_not_selected')]
}
export function callExample(api: CallApi, model: string, t: (key: string, params?: Record<string, string | number>) => string) {
  if (api === 'openai-responses') {
    return {
      label: t('services.api_openai_responses'),
      path: 'https://smartgate.run/v1/responses',
      headers: ['Authorization: Bearer <YOUR_API_KEY>', 'Content-Type: application/json'],
      body: `{"model":"${model}","input":"Hello"}`,
    }
  }
  if (api === 'anthropic-messages') {
    return {
      label: t('services.api_anthropic_messages'),
      path: 'https://smartgate.run/v1/messages',
      headers: ['Authorization: Bearer <YOUR_API_KEY>', 'anthropic-version: 2023-06-01', 'Content-Type: application/json'],
      body: `{"model":"${model}","max_tokens":128,"messages":[{"role":"user","content":"Hello"}]}`,
    }
  }
  return {
    label: t('services.api_openai_chat'),
    path: 'https://smartgate.run/v1/chat/completions',
    headers: ['Authorization: Bearer <YOUR_API_KEY>', 'Content-Type: application/json'],
    body: `{"model":"${model}","messages":[{"role":"user","content":"Hello"}]}`,
  }
}
export function formatPriceInput(val?: number | string | null): string {
  if (val === undefined || val === null || val === '') return ''
  const num = typeof val === 'number' ? val : Number(val)
  if (isNaN(num)) return String(val)
  if (num === 0) return '0'
  // Format to at most 4 decimal places without trailing zeros (e.g. 3.59999999996 -> 3.6, 0.0014 -> 0.0014)
  return parseFloat(num.toFixed(4)).toString()
}

export function cleanServiceName(name: string): string {
  if (!name) return ''
  // Strip UUID prefix like '335385fe-d8ac-4f45-b6df-669754a7adb1-fusion' -> 'fusion'
  const uuidPrefixRegex = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}-/
  return name.replace(uuidPrefixRegex, '')
}

