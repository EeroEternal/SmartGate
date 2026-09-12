export type Service = { id: string; name: string; model: string; provider_type: string; provider_types?: string[]; endpoint_count?: number; strategy: string; health_status: string }
export type CatalogOffering = {
  provider_id: string
  provider_name: string
  endpoint_id: string
  endpoint_key: string
  region: string
  base_url: string
  price_currency: string
  model: string
  model_name: string
  description: string
  input_price_per_1m: number
  output_price_per_1m: number
  supports_tools: boolean
  supports_vision: boolean
  supports_reasoning: boolean
  context_length?: number
}

export type CatalogProvider = {
  id: string
  name: string
  model_count: number
  models: CatalogOffering[]
}
export type DraftEndpoint = {
  provider_type: string
  custom_provider_id: string
  protocol: string
  base_url: string
  api_key: string
  upstream_model_id: string
  input_price_per_1m: string
  output_price_per_1m: string
  capability_score: string
  context_length: string
}
export type ModelDna = { code_logic: number; reasoning_math: number; agent_tools: number; multilingual_nlp: number; context_retention: number; strengths: string[] }
export type ServiceEndpoint = { id: string; provider_id: string; provider_name: string; provider_type: string; protocol: string; model: string; base_url: string; input_price_per_1m: number | null; output_price_per_1m: number | null; capability_score: number; configured_capability_score?: number; context_length?: number; enabled?: boolean; supports_tools?: boolean; health_status?: string; cooling_down?: boolean; health_observed?: boolean; total_requests?: number; total_errors?: number; preferred_for_hard_requests?: boolean; model_dna?: ModelDna }
export type ServiceDetails = { id: string; name: string; model?: string; strategy: string; status: string; endpoint_count: number; endpoints: ServiceEndpoint[]; judge_enabled?: boolean; judge_endpoint_id?: string; shadow_enabled?: boolean; shadow_virtual_model_id?: string; shadow_sample_rate?: number }
export type CallApi = 'openai-chat' | 'openai-responses' | 'anthropic-messages'
export type SavingsBaseline = {
  virtual_model_id: string
  endpoint_id: string
  model_service_name: string
  model: string
  provider_name: string
  input_price_per_1m: number | null
  output_price_per_1m: number | null
}
export type SaasProvider = {
  id: string
  name: string
  provider_type: string
  protocol: string
  base_url: string
  status: string
  endpoint_count: number
  created_at: string
}

