import { useI18n } from '../../../lib/i18n'
import { formatCatalogPrice } from './price'
import type { CatalogOffering } from '../types'

// Template mode: simply display framed models cleanly without requiring manual checkboxes.
export function SelectedModelsList({ selectedModels, selectedCount, onCustomize, onRemove }: {
  selectedModels: CatalogOffering[]
  selectedCount: number
  onCustomize: () => void
  onRemove: (model: CatalogOffering) => void
}) {
  const { t } = useI18n()
  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-3 space-y-2">
      <div className="flex items-center justify-between text-xs font-semibold text-zinc-900 border-b border-zinc-100 pb-2">
        <span>{t('services.models_to_connect')} ({selectedCount})</span>
        <button
          type="button"
          onClick={onCustomize}
          className="text-[11px] font-normal text-primary hover:underline"
        >
          {t('services.custom_or_additional_model')}
        </button>
      </div>
      <div className="h-48 overflow-y-auto divide-y divide-zinc-100 pr-1 [scrollbar-gutter:stable]">
        {selectedModels.map((m) => (
          <div
            key={m.model}
            role="checkbox"
            aria-checked="true"
            tabIndex={0}
            onClick={() => onRemove(m)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                onRemove(m)
              }
            }}
            title={t('services.remove_from_selection')}
            className="flex cursor-pointer items-center justify-between rounded-md py-2 text-xs transition-colors hover:bg-zinc-50"
          >
            <div className="min-w-0 pr-2">
              <div className="font-medium text-zinc-900 truncate">{m.model_name || m.model}</div>
              <div className="text-[11px] text-zinc-400 font-mono truncate">{m.model}</div>
            </div>
            <div className="shrink-0 text-right">
              <div className="font-mono font-medium text-zinc-700">
                {m.input_price_per_1m === 0 && m.output_price_per_1m === 0 ? (
                  <span className="text-emerald-600 font-semibold">{t('services.free_badge')}</span>
                ) : (
                  <span>{formatCatalogPrice(m.input_price_per_1m, t('services.free_badge'))}/1M</span>
                )}
              </div>
              {m.context_length && (
                <div className="text-[10px] text-zinc-400">{t('services.context_badge', { value: m.context_length.toLocaleString() })}</div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
