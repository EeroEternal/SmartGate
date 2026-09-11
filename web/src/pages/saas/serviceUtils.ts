import type { CallApi, CatalogOffering, DraftEndpoint } from './types'

export function modelOptions(models: CatalogOffering[]) {
  return Array.from(new Map(models.map((item) => [item.model, { id: item.model, name: item.model_name }])).values())
}

export function hasCatalogDetails(model: CatalogOffering | undefined) {
  return Boolean(model && (model.input_price_per_1m > 0 || model.output_price_per_1m > 0 || model.context_length || model.supports_tools || model.supports_vision || model.supports_reasoning))
}

export function inferDefaultCapability(model?: CatalogOffering, modelId?: string): string {
  const name = (model?.model || modelId || '').toLowerCase()
  if (/r1|reasoner|o1|o3|claude-3-5-sonnet|claude-3-7-sonnet|opus|gpt-4\.5/i.test(name)) return '0.96'
  if (/pro|gpt-4o|max|70b|72b|405b|deepseek-chat|deepseek-v3|deepseek-coder/i.test(name)) return '0.92'
  if (model?.supports_reasoning) return '0.85'
  if (/flash|mini|nano|lite|8b|7b|3b|1\.5b|0\.5b/i.test(name)) return '0.65'
  return '0.70'
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
  return map[strategy] || { label: strategy.replaceAll('_', ' '), description: 'Routes requests across your connected providers.' }
}

export function serviceStatusLabel(status: string) {
  return status === 'draft' ? 'Setup needed' : 'Ready'
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
export function callExample(api: CallApi, model: string) {
  if (api === 'openai-responses') {
    return {
      label: 'OpenAI Responses',
      path: 'https://smartgate.run/v1/responses',
      headers: ['Authorization: Bearer <YOUR_API_KEY>', 'Content-Type: application/json'],
      body: `{"model":"${model}","input":"Hello"}`,
    }
  }
  if (api === 'anthropic-messages') {
    return {
      label: 'Anthropic Messages',
      path: 'https://smartgate.run/v1/messages',
      headers: ['Authorization: Bearer <YOUR_API_KEY>', 'anthropic-version: 2023-06-01', 'Content-Type: application/json'],
      body: `{"model":"${model}","max_tokens":128,"messages":[{"role":"user","content":"Hello"}]}`,
    }
  }
  return {
    label: 'OpenAI Chat',
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

