import { useI18n } from '../../../lib/i18n'
import { computeBundleSelection } from '../serviceUtils'
import type { CatalogOffering } from '../types'

// Smart preset bundles for rapid tier-setup. Hidden until a catalog is available.
export function SmartBundleSelector({ models, selectedModelIds, selectedBundle, onSelectBundle, onSelectModels }: {
  models: CatalogOffering[]
  selectedModelIds: string[]
  selectedBundle: 'custom' | 'balanced' | 'free' | 'reasoning'
  onSelectBundle: (bundle: 'custom' | 'balanced' | 'free' | 'reasoning') => void
  onSelectModels: (ids: string[]) => void
}) {
  const { t } = useI18n()
  if (models.length === 0) return null
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-zinc-800">
          {t('services.smart_bundles')}
        </span>
        {selectedModelIds.length > 0 && (
          <button
            type="button"
            onClick={() => {
              onSelectBundle('custom')
              onSelectModels([])
            }}
            className="text-[11px] text-zinc-400 hover:text-zinc-700 transition-colors"
          >
            {t('services.clear_selection')}
          </button>
        )}
      </div>
      <div className="grid grid-cols-3 gap-2">
        <button
          type="button"
          onClick={() => {
            onSelectBundle('balanced')
            onSelectModels(computeBundleSelection('balanced', models))
          }}
          className={`rounded-lg border px-3 py-2 text-center text-xs font-medium transition-all ${
            selectedBundle === 'balanced'
              ? 'border-zinc-950 bg-zinc-950 text-white shadow-xs'
              : 'border-zinc-200 bg-white text-zinc-700 hover:border-zinc-300 hover:bg-zinc-50'
          }`}
        >
          {t('services.bundle_balanced')}
        </button>
        <button
          type="button"
          onClick={() => {
            onSelectBundle('free')
            const freeModels = computeBundleSelection('free', models)
            if (freeModels.length > 0) {
              onSelectModels(freeModels)
            }
          }}
          className={`rounded-lg border px-3 py-2 text-center text-xs font-medium transition-all ${
            selectedBundle === 'free'
              ? 'border-zinc-950 bg-zinc-950 text-white shadow-xs'
              : 'border-zinc-200 bg-white text-zinc-700 hover:border-zinc-300 hover:bg-zinc-50'
          }`}
        >
          {t('services.bundle_free')}
        </button>
        <button
          type="button"
          onClick={() => {
            onSelectBundle('reasoning')
            const reasoningModels = computeBundleSelection('reasoning', models)
            if (reasoningModels.length > 0) {
              onSelectModels(reasoningModels)
            }
          }}
          className={`rounded-lg border px-3 py-2 text-center text-xs font-medium transition-all ${
            selectedBundle === 'reasoning'
              ? 'border-zinc-950 bg-zinc-950 text-white shadow-xs'
              : 'border-zinc-200 bg-white text-zinc-700 hover:border-zinc-300 hover:bg-zinc-50'
          }`}
        >
          {t('services.bundle_reasoning')}
        </button>
      </div>
    </div>
  )
}
