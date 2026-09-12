import { inferDefaultCapability } from '../serviceUtils'
import type { CatalogOffering, DraftEndpoint } from '../types'

export interface TargetModel {
  model: string
  input_price?: number
  output_price?: number
  capability?: number
  context_length?: number
}

// Build the per-model entries for the submit request: catalog hits keep their catalog
// prices/capability/context, hand-typed ids fall back to the form fields.
export function buildTargetModels({ selectedModelIds, models, draft }: {
  selectedModelIds: string[]
  models: CatalogOffering[]
  draft: DraftEndpoint
}): TargetModel[] {
  const targetModels: TargetModel[] = []

  if (selectedModelIds.length > 0) {
    for (const mId of selectedModelIds) {
      const catItem = models.find((item) => item.model === mId)
      if (catItem) {
        targetModels.push({
          model: catItem.model,
          // 0 is a free model and must be stored as such; only a missing catalog
          // price stays undefined (unpriced).
          input_price: catItem.input_price_per_1m ?? undefined,
          output_price: catItem.output_price_per_1m ?? undefined,
          capability: Number(inferDefaultCapability(catItem)),
          context_length: catItem.context_length ? Number(catItem.context_length) : undefined,
        })
      } else {
        targetModels.push({
          model: mId,
          input_price: draft.input_price_per_1m ? Number(draft.input_price_per_1m) : undefined,
          output_price: draft.output_price_per_1m ? Number(draft.output_price_per_1m) : undefined,
          capability: Number(draft.capability_score || 0.7),
          context_length: draft.context_length ? Number(draft.context_length) : undefined,
        })
      }
    }
  } else if (draft.upstream_model_id.trim()) {
    targetModels.push({
      model: draft.upstream_model_id.trim(),
      input_price: draft.input_price_per_1m ? Number(draft.input_price_per_1m) : undefined,
      output_price: draft.output_price_per_1m ? Number(draft.output_price_per_1m) : undefined,
      capability: Number(draft.capability_score || 0.7),
      context_length: draft.context_length ? Number(draft.context_length) : undefined,
    })
  }

  return targetModels
}

// One endpoint POST body per selected model.
export function buildEndpointPayload({ targetModels, useExisting, selectedAccountId, draft, presetProviderName }: {
  targetModels: TargetModel[]
  useExisting: boolean
  selectedAccountId: string
  draft: DraftEndpoint
  presetProviderName: string
}) {
  return targetModels.map((tm) => ({
    account_id: useExisting ? selectedAccountId : undefined,
    provider_type: useExisting ? undefined : (draft.provider_type === 'custom' ? draft.custom_provider_id : draft.provider_type),
    provider_name: useExisting ? undefined : (draft.provider_type === 'custom' ? draft.custom_provider_id : presetProviderName),
    protocol: useExisting ? undefined : draft.protocol,
    base_url: useExisting ? undefined : draft.base_url,
    api_key: useExisting ? undefined : draft.api_key,
    upstream_model_id: tm.model,
    input_price_per_1m: tm.input_price,
    output_price_per_1m: tm.output_price,
    capability_score: tm.capability,
    context_length: tm.context_length,
  }))
}
