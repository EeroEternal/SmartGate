import { useI18n } from '../../../lib/i18n'
import { Field } from '../components'
import type { DraftEndpoint } from '../types'

// Compact pricing and capability parameters directly expanded.
export function EndpointPricingFields({ draft, patch }: {
  draft: DraftEndpoint
  patch: (value: Partial<DraftEndpoint>) => void
}) {
  const { t } = useI18n()
  return (
    <div className="rounded-xl border border-zinc-200 bg-zinc-50/80 p-3">
      <div className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500 mb-2">
        {t('services.advanced_settings')}
      </div>
      <div className="grid gap-3 sm:grid-cols-4 text-zinc-900">
        <Field size="sm" required={false} label={t('services.input_price')} value={draft.input_price_per_1m} onChange={(value) => patch({ input_price_per_1m: value })} placeholder="0.14" />
        <Field size="sm" required={false} label={t('services.output_price')} value={draft.output_price_per_1m} onChange={(value) => patch({ output_price_per_1m: value })} placeholder="0.28" />
        <Field size="sm" required={false} label={t('services.capability_range')} value={draft.capability_score} onChange={(value) => patch({ capability_score: value })} placeholder="0.70" />
        <Field size="sm" required={false} label={t('services.context_length')} value={draft.context_length} onChange={(value) => patch({ context_length: value })} placeholder="128000" />
      </div>
    </div>
  )
}
