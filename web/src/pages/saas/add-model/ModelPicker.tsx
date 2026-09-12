import { useMemo } from 'react'
import { Search } from 'lucide-react'
import Select from '../../../components/Select'
import { useI18n } from '../../../lib/i18n'
import { catalogProviderPrefixes, filterCatalogModels, searchScore } from '../serviceUtils'
import { formatCatalogPrice } from './price'
import type { CatalogOffering } from '../types'

// Custom manual search and selection mode.
export function ModelPicker({ currentProviderType, models, selectedModelIds, modelSearch, onModelSearchChange, prefixFilter, onPrefixFilterChange, freeOnlyFilter, onFreeOnlyFilterChange, maxPriceFilter, onMaxPriceFilterChange, onToggleModel, onSelectModels }: {
  currentProviderType: string
  models: CatalogOffering[]
  selectedModelIds: string[]
  modelSearch: string
  onModelSearchChange: (value: string) => void
  prefixFilter: string
  onPrefixFilterChange: (value: string) => void
  freeOnlyFilter: boolean
  onFreeOnlyFilterChange: (value: boolean) => void
  maxPriceFilter: string
  onMaxPriceFilterChange: (value: string) => void
  onToggleModel: (model: CatalogOffering) => void
  onSelectModels: (ids: string[]) => void
}) {
  const { t } = useI18n()
  const matchedModels = useMemo(
    () => filterCatalogModels(models, { query: modelSearch, providerPrefix: prefixFilter, freeOnly: freeOnlyFilter, maxInputPrice: maxPriceFilter }),
    [models, modelSearch, prefixFilter, freeOnlyFilter, maxPriceFilter]
  )
  const filteredModels = matchedModels
    .map((m) => ({ model: m, score: searchScore(m, modelSearch) }))
    .sort((a, b) => b.score - a.score)
    .map((item) => item.model)
  const selectedModels = models.filter((m) => selectedModelIds.includes(m.model))
  const hasActiveFilter = modelSearch.trim() !== '' || prefixFilter !== '' || freeOnlyFilter || maxPriceFilter.trim() !== ''
  const visibleModels = hasActiveFilter
    ? [...selectedModels, ...filteredModels.filter((m) => !selectedModelIds.includes(m.model))]
    : filteredModels

  const providerPrefixes = useMemo(() => catalogProviderPrefixes(models), [models])
  const prefixOptions = [
    { id: '', name: t('services.filter_all_providers') },
    ...providerPrefixes.map((p) => ({ id: p, name: p })),
  ]
  const selectedPrefixOption = prefixOptions.find((o) => o.id === prefixFilter) || prefixOptions[0]

  return (
    <div>
      {currentProviderType === 'openrouter' && (
        <div className="mb-2 space-y-2 rounded-lg border border-zinc-200 bg-zinc-50/60 p-2">
          <div className="grid gap-2 sm:grid-cols-2">
            <Select
              size="sm"
              label={t('services.filter_provider_prefix')}
              options={prefixOptions}
              selected={selectedPrefixOption}
              onChange={(option) => onPrefixFilterChange(String(option.id))}
            />
            <div>
              <label className="mb-1 block text-xs font-medium text-zinc-700">{t('services.filter_max_input_price')}</label>
              <input
                type="text"
                inputMode="decimal"
                value={maxPriceFilter}
                onChange={(e) => onMaxPriceFilterChange(e.target.value)}
                placeholder={t('services.price_cap_placeholder')}
                className="h-9 w-full rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-xs outline-none focus:border-primary"
              />
            </div>
          </div>
          <div className="flex items-center justify-between gap-2">
            <label className="flex cursor-pointer items-center gap-1.5 text-xs text-zinc-700">
              <input
                type="checkbox"
                checked={freeOnlyFilter}
                onChange={(e) => onFreeOnlyFilterChange(e.target.checked)}
                className="h-3.5 w-3.5 rounded accent-zinc-900"
              />
              {t('services.filter_free_only')}
            </label>
            <button
              type="button"
              onClick={() => {
                const matching = matchedModels.map((m) => m.model)
                onSelectModels(Array.from(new Set([...selectedModelIds, ...matching])))
              }}
              disabled={matchedModels.length === 0}
              className="rounded-md border border-zinc-300 bg-white px-2.5 py-1 text-[11px] font-medium text-zinc-700 transition-colors hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {t('services.select_all_matching', { count: matchedModels.length })}
            </button>
          </div>
        </div>
      )}
      <div className="relative mb-2">
        <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-zinc-400" />
        <input
          type="text"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          value={modelSearch}
          onChange={(e) => onModelSearchChange(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') e.preventDefault() }}
          placeholder={t('services.search_models_placeholder')}
          className="w-full rounded-lg border border-zinc-200 bg-white py-1.5 pl-8 pr-3 text-xs outline-none focus:border-primary"
        />
      </div>

      <div className="h-48 overflow-y-auto rounded-lg border border-zinc-200 bg-white p-2 [scrollbar-gutter:stable]">
        {visibleModels.length > 0 ? (
          <div className="space-y-1.5">
            {visibleModels.map((m) => {
              const isChecked = selectedModelIds.includes(m.model)
              return (
                <label
                  key={m.model}
                  className={`flex cursor-pointer items-start gap-2.5 rounded-md p-2 transition-colors ${
                    isChecked ? 'bg-zinc-100 border border-zinc-300' : 'hover:bg-zinc-50 border border-transparent'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={isChecked}
                    onChange={() => onToggleModel(m)}
                    className="mt-0.5 h-3.5 w-3.5 rounded accent-zinc-900"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium text-xs text-zinc-900 truncate">
                        {m.model_name || m.model}
                      </span>
                      <div className="shrink-0 text-[11px] font-mono text-zinc-500">
                        {m.input_price_per_1m === 0 && m.output_price_per_1m === 0 ? (
                          <span className="text-emerald-600 font-semibold">{t('services.free_badge')}</span>
                        ) : (
                          <span>{formatCatalogPrice(m.input_price_per_1m, t('services.free_badge'))}/1M</span>
                        )}
                      </div>
                    </div>
                    <div className="mt-0.5 text-[11px] text-zinc-400 truncate">
                      <code className="text-zinc-600">{m.model}</code>
                      {m.context_length ? ` ${t('services.context_badge', { value: m.context_length.toLocaleString() })}` : ''}
                    </div>
                  </div>
                </label>
              )
            })}
          </div>
        ) : (
          <div className="flex h-full items-center justify-center text-xs text-zinc-400">
            {models.length === 0
              ? (t('common.loading'))
              : (t('services.no_models_match'))}
          </div>
        )}
      </div>
    </div>
  )
}
