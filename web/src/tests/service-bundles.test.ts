import { describe, expect, it } from 'vitest'

import type { CatalogOffering } from '../pages/saas/types'
import {
  EMPTY_FILTER,
  computeBundleSelection,
  filterCatalogModels,
} from '../pages/saas/serviceUtils'

function makeModel(overrides: Partial<CatalogOffering> & { model: string }): CatalogOffering {
  return {
    provider_id: 'test-provider',
    provider_name: 'Test Provider',
    endpoint_id: `endpoint-${overrides.model}`,
    endpoint_key: `key-${overrides.model}`,
    region: 'us-east',
    base_url: 'https://upstream.test/v1',
    price_currency: 'USD',
    model_name: overrides.model,
    description: '',
    input_price_per_1m: 1,
    output_price_per_1m: 2,
    supports_tools: false,
    supports_vision: false,
    supports_reasoning: false,
    ...overrides,
  }
}

// Synthetic catalog covering the three shapes the bundles care about: free models,
// ordinary paid models, and reasoning models.
const catalog: CatalogOffering[] = [
  makeModel({
    model: 'openai/gpt-4o-mini',
    model_name: 'GPT-4o mini',
    input_price_per_1m: 0.15,
    output_price_per_1m: 0.6,
    supports_tools: true,
    supports_vision: true,
  }),
  makeModel({
    model: 'meta-llama/llama-3-8b:free',
    model_name: 'Llama 3 8B (free)',
    input_price_per_1m: 0,
    output_price_per_1m: 0,
  }),
  makeModel({
    model: 'deepseek/deepseek-chat',
    model_name: 'DeepSeek Chat',
    input_price_per_1m: 0.27,
    output_price_per_1m: 1.1,
  }),
  makeModel({
    model: 'anthropic/claude-3-5-sonnet',
    model_name: 'Claude 3.5 Sonnet',
    input_price_per_1m: 3,
    output_price_per_1m: 15,
    supports_reasoning: true,
  }),
  makeModel({
    model: 'openai/o1-preview',
    model_name: 'o1 preview',
    input_price_per_1m: 15,
    output_price_per_1m: 60,
    supports_reasoning: true,
  }),
  makeModel({
    model: 'local/zero-model',
    model_name: 'Local zero-cost model',
    input_price_per_1m: 0,
    output_price_per_1m: 0,
  }),
]

const ids = (models: CatalogOffering[]) => models.map((m) => m.model)

describe('computeBundleSelection', () => {
  it('selects only free or zero-priced models for the free bundle', () => {
    expect(computeBundleSelection('free', catalog)).toEqual([
      'meta-llama/llama-3-8b:free',
      'local/zero-model',
    ])
  })

  it('selects reasoning-capable models for the reasoning bundle', () => {
    expect(computeBundleSelection('reasoning', catalog)).toEqual([
      'anthropic/claude-3-5-sonnet',
      'openai/o1-preview',
    ])
  })

  it('caps the reasoning bundle at three models', () => {
    const reasoningCatalog = [
      makeModel({ model: 'deepseek/deepseek-reasoner' }),
      makeModel({ model: 'anthropic/claude-3-5-sonnet' }),
      makeModel({ model: 'openai/o1-preview' }),
      makeModel({ model: 'openai/o3-mini' }),
    ]
    expect(computeBundleSelection('reasoning', reasoningCatalog)).toEqual([
      'deepseek/deepseek-reasoner',
      'anthropic/claude-3-5-sonnet',
      'openai/o1-preview',
    ])
  })

  it('builds a balanced bundle from one free-or-cheap, one mid and one pro model', () => {
    expect(computeBundleSelection('balanced', catalog)).toEqual([
      'meta-llama/llama-3-8b:free',
      'openai/gpt-4o-mini',
      'anthropic/claude-3-5-sonnet',
    ])
  })

  it('prefers the non-variant model for the balanced mid slot', () => {
    const variantCatalog = [
      makeModel({ model: 'deepseek/deepseek-chat:batch', input_price_per_1m: 0.1 }),
      makeModel({ model: 'deepseek/deepseek-chat', input_price_per_1m: 0.27 }),
      makeModel({ model: 'anthropic/claude-3-5-sonnet', input_price_per_1m: 3 }),
    ]
    expect(computeBundleSelection('balanced', variantCatalog)).toEqual([
      'deepseek/deepseek-chat',
      'anthropic/claude-3-5-sonnet',
    ])
  })

  it('deduplicates when one model fills several balanced slots', () => {
    const single = [
      makeModel({
        model: 'openai/gpt-4o-mini',
        input_price_per_1m: 0.15,
        output_price_per_1m: 0.6,
      }),
    ]
    expect(computeBundleSelection('balanced', single)).toEqual(['openai/gpt-4o-mini'])
  })

  it('returns an empty selection for an empty catalog', () => {
    expect(computeBundleSelection('free', [])).toEqual([])
    expect(computeBundleSelection('reasoning', [])).toEqual([])
    expect(computeBundleSelection('balanced', [])).toEqual([])
  })
})

describe('filterCatalogModels', () => {
  it('returns every model for the empty filter', () => {
    expect(filterCatalogModels(catalog, EMPTY_FILTER)).toEqual(catalog)
  })

  it('matches the query case-insensitively and trims whitespace', () => {
    expect(ids(filterCatalogModels(catalog, { ...EMPTY_FILTER, query: 'SONNET' }))).toEqual([
      'anthropic/claude-3-5-sonnet',
    ])
    expect(ids(filterCatalogModels(catalog, { ...EMPTY_FILTER, query: '  gpt-4o-mini  ' }))).toEqual([
      'openai/gpt-4o-mini',
    ])
    expect(ids(filterCatalogModels(catalog, { ...EMPTY_FILTER, query: 'llama' }))).toEqual([
      'meta-llama/llama-3-8b:free',
    ])
  })

  it('returns nothing for a query that matches no model', () => {
    expect(filterCatalogModels(catalog, { ...EMPTY_FILTER, query: 'no-such-model' })).toEqual([])
  })

  it('filters by provider prefix', () => {
    expect(ids(filterCatalogModels(catalog, { ...EMPTY_FILTER, providerPrefix: 'openai' }))).toEqual([
      'openai/gpt-4o-mini',
      'openai/o1-preview',
    ])
    expect(ids(filterCatalogModels(catalog, { ...EMPTY_FILTER, providerPrefix: 'meta-llama' }))).toEqual([
      'meta-llama/llama-3-8b:free',
    ])
  })

  it('keeps only free or zero-priced models when freeOnly is set', () => {
    expect(ids(filterCatalogModels(catalog, { ...EMPTY_FILTER, freeOnly: true }))).toEqual([
      'meta-llama/llama-3-8b:free',
      'local/zero-model',
    ])
  })

  it('treats the ":free" suffix as free even when prices are non-zero', () => {
    const mixed = [
      makeModel({ model: 'vendor/special:free', input_price_per_1m: 0.5, output_price_per_1m: 1 }),
      makeModel({ model: 'vendor/paid', input_price_per_1m: 0.5, output_price_per_1m: 1 }),
    ]
    expect(ids(filterCatalogModels(mixed, { ...EMPTY_FILTER, freeOnly: true }))).toEqual([
      'vendor/special:free',
    ])
    expect(ids(filterCatalogModels(mixed, { ...EMPTY_FILTER, freeOnly: true, maxInputPrice: '0' }))).toEqual(
      [],
    )
  })

  it('applies the max input price as an inclusive cap', () => {
    expect(ids(filterCatalogModels(catalog, { ...EMPTY_FILTER, maxInputPrice: '0.3' }))).toEqual([
      'openai/gpt-4o-mini',
      'meta-llama/llama-3-8b:free',
      'deepseek/deepseek-chat',
      'local/zero-model',
    ])
    expect(ids(filterCatalogModels(catalog, { ...EMPTY_FILTER, maxInputPrice: '0' }))).toEqual([
      'meta-llama/llama-3-8b:free',
      'local/zero-model',
    ])
  })

  it('ignores an empty or non-numeric price cap', () => {
    expect(filterCatalogModels(catalog, { ...EMPTY_FILTER, maxInputPrice: '' })).toHaveLength(
      catalog.length,
    )
    expect(filterCatalogModels(catalog, { ...EMPTY_FILTER, maxInputPrice: 'abc' })).toHaveLength(
      catalog.length,
    )
  })

  it('combines query, provider and price filters', () => {
    expect(
      ids(filterCatalogModels(catalog, { ...EMPTY_FILTER, query: 'deepseek', maxInputPrice: '0.3' })),
    ).toEqual(['deepseek/deepseek-chat'])
    expect(
      ids(filterCatalogModels(catalog, { ...EMPTY_FILTER, query: 'deepseek', maxInputPrice: '0.2' })),
    ).toEqual([])
  })

  it('does not mutate the catalog it filters', () => {
    const before = ids(catalog)
    filterCatalogModels(catalog, { ...EMPTY_FILTER, query: 'sonnet', freeOnly: true })
    expect(ids(catalog)).toEqual(before)
  })
})
