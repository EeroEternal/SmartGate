import { formatMoney } from '../../lib/format'
import { useEffect, useState } from 'react'
import { ChevronRight, HelpCircle, Settings2, X } from 'lucide-react'
import { saasFetch } from '../../lib/saasApi'
import { useI18n } from '../../lib/i18n'
import { useModal } from '../../lib/modal'
import { Coverage, ErrorMessage, Page, Stat, errorText } from './components'
import { SavingsBaselineModal } from './SavingsBaselineModal'
import type { SavingsBaseline, Service, ServiceDetails } from './types'

type UsageBreakdown = {
  provider?: string
  model?: string
  requests: number
  prompt_tokens: number
  completion_tokens: number
  total_tokens: number
  estimated_spend: number
  cache_hit_tokens?: number
  cache_write_tokens?: number
}

type MissingUsageBreakdown = {
  provider: string
  model: string
  requests: number
  local_estimate_requests: number
  unavailable_requests: number
}

type UsageData = {
  requests: number
  prompt_tokens: number
  completion_tokens: number
  total_tokens: number
  estimated_spend: number
  success_rate: number
  trimmed_chars: number
  cache?: { hit_tokens: number; hit_requests: number; reported_requests: number; reported_input_tokens: number; hit_rate: number; write_tokens: number; write_requests: number; reported_write_requests: number; write_rate: number }
  budget?: { status: string; spent_today: number; daily_limit: number | null; remaining_today: number | null }
  coverage?: {
    usage: number
    pricing: number
    provider_reported_requests: number
    priced_requests: number
    missing_usage_requests: number
    missing_usage_breakdown: MissingUsageBreakdown[]
  }
  data_quality?: string[]
  breakdowns?: { providers: UsageBreakdown[]; models: UsageBreakdown[] }
}

type SavingsData = {
  estimated_spend?: number | null
  estimated_savings?: number | null
  trimmed_chars: number
  configured: boolean
  baseline?: SavingsBaseline
  basis: string
}

const compactNumber = (value: number | undefined) => (value || 0).toLocaleString()
const compactTokens = (value: number | undefined) => {
  const v = value || 0
  if (v >= 1_000_000_000) return `${(v / 1_000_000_000).toFixed(2)}B`
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(2)}M`
  if (v >= 10_000) return `${(v / 1_000).toFixed(1)}k`
  return v.toLocaleString()
}

const cleanDisplayName = (name: string | undefined) => {
  if (!name) return ''
  return name.replace(/^[0-9a-fA-F-]{36,37}-/, '').replace(/^saas-[0-9a-fA-F-]{36}/, 'DeepSeek').replace(/^saas-/, '')
}

function MissingTokensModal({
  missingUsage,
  totalMissing,
  onClose,
}: {
  missingUsage: MissingUsageBreakdown[]
  totalMissing: number
  onClose: () => void
}) {
  const { t } = useI18n()
  const dialogRef = useModal({ onClose })
  return (
    <div ref={dialogRef} className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/30 p-4" role="dialog" aria-modal="true">
      <div className="max-h-[85vh] w-full max-w-xl overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-zinc-950">{t('usage.missing_modal_title')}</h2>
            <p className="mt-1 text-xs text-zinc-500">
              {t('usage.requests_without_tokens_sub', { count: compactNumber(totalMissing) }) || `${compactNumber(totalMissing)} requests use local estimates or lack upstream token reporting.`}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-2 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-950 transition-colors"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="mt-5 divide-y divide-zinc-100 rounded-xl border border-zinc-200 bg-zinc-50/50 p-4">
          {missingUsage.map((item) => (
            <div key={`${item.provider}-${item.model}`} className="flex items-start justify-between gap-4 py-3 first:pt-0 last:pb-0">
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold text-zinc-900">
                  {cleanDisplayName(item.provider)} <span className="font-normal text-zinc-400">/</span> {item.model}
                </div>
                <div className="mt-1 space-y-0.5 text-xs text-zinc-500">
                  <div>{t('usage.missing_tokens_count', { count: compactNumber(item.requests) }) || `${compactNumber(item.requests)} requests without provider tokens`}</div>
                  {item.local_estimate_requests > 0 && (
                    <div className="text-amber-700">{t('usage.local_estimates_count', { count: compactNumber(item.local_estimate_requests) }) || `${compactNumber(item.local_estimate_requests)} use local byte/char estimation`}</div>
                  )}
                  {item.unavailable_requests > 0 && (
                    <div className="text-rose-600">{t('usage.unavailable_count', { count: compactNumber(item.unavailable_requests) }) || `${compactNumber(item.unavailable_requests)} have no token data`}</div>
                  )}
                </div>
              </div>
              <span className="shrink-0 rounded-full bg-amber-100 px-2.5 py-0.5 text-[11px] font-medium text-amber-800 border border-amber-200">
                {t('usage.needs_review')}
              </span>
            </div>
          ))}
        </div>

        <div className="mt-6 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg bg-zinc-950 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 transition-colors"
          >
            {t('common.close')}
          </button>
        </div>
      </div>
    </div>
  )
}

export function UsagePage() {
  const { t } = useI18n()
  const [data, setData] = useState<UsageData | null>(null)
  const [savings, setSavings] = useState<SavingsData | null>(null)
  const [baseline, setBaseline] = useState<SavingsBaseline | null>(null)
  const [baselineOptions, setBaselineOptions] = useState<ServiceDetails[]>([])
  const [baselineOpen, setBaselineOpen] = useState(false)
  const [missingTokensModalOpen, setMissingTokensModalOpen] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    Promise.all([
      saasFetch<UsageData>('/api/saas/usage?range=30d'),
      saasFetch<SavingsData>('/api/saas/savings?range=30d'),
      saasFetch<{ configured?: boolean } & Partial<SavingsBaseline>>('/api/saas/savings-baseline'),
      saasFetch<Service[]>('/api/saas/model-services'),
    ])
      .then(async ([usage, savingsResult, baselineResult, servicesResult]) => {
        setData(usage.data || null)
        setSavings(savingsResult.data || null)
        const detectedBaseline = baselineResult.data?.configured
          ? baselineResult.data as SavingsBaseline
          : savingsResult.data?.baseline || null
        setBaseline(detectedBaseline)
        const details = await Promise.all((servicesResult.data || []).map(async (service) => {
          try { return (await saasFetch<ServiceDetails>(`/api/saas/model-services/${service.id}`)).data || null } catch { return null }
        }))
        setBaselineOptions(details.filter((service): service is ServiceDetails => Boolean(service)))
      })
      .catch((e: unknown) => setError(errorText(e)))
  }, [])

  const coveragePercent = (value: number | undefined) => `${Math.round((value || 0) * 100)}%`
  const providers = data?.breakdowns?.providers || []
  const models = data?.breakdowns?.models || []
  const modelsByProvider = models.reduce<Map<string, UsageBreakdown[]>>((groups, item) => {
    const provider = item.provider || t('usage.unknown_provider')
    const providerModels = groups.get(provider) || []
    providerModels.push(item)
    groups.set(provider, providerModels)
    return groups
  }, new Map())
  const totalSpend = (data?.estimated_spend || 0) > 0 ? (data?.estimated_spend || 0) : Math.max(providers.reduce((acc, p) => acc + p.estimated_spend, 0), 0.0001)
  const maxProviderSpend = Math.max(...providers.map((item) => item.estimated_spend), 0.000001)
  const missingUsage = data?.coverage?.missing_usage_breakdown || []

  return (
    <Page>
      {error && <ErrorMessage text={error} />}
      <div className="mb-5 flex items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <h1 className="text-xl font-semibold tracking-tight">{t('usage.title')}</h1>
          <span title={t('usage.subtitle')} className="cursor-help text-zinc-400 hover:text-zinc-600 transition-colors">
            <HelpCircle className="h-4 w-4" />
          </span>
        </div>
        <span className="text-xs text-zinc-400">{t('usage.provider_reported_note')}</span>
      </div>
      <div className="grid grid-cols-1 items-stretch gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label={t('usage.requests')} value={compactNumber(data?.requests)} />
        <Stat label={t('usage.total_tokens')} value={compactTokens(data?.total_tokens)} fullValue={compactNumber(data?.total_tokens)} />
        <Stat label={t('usage.estimated_spend')} value={formatMoney(data?.estimated_spend)} />
        <Stat label={t('usage.success_rate')} value={`${((data?.success_rate || 0) * 100).toFixed(1)}%`} />
      </div>

      <section className="mt-6 rounded-xl border border-zinc-200 bg-white p-5 shadow-sm">
        <div className="flex items-center gap-2">
          <h2 className="font-semibold text-zinc-900">{t('usage.prompt_cache')}</h2>
          <span title={t('usage.prompt_cache_subtitle')} className="cursor-help text-zinc-400 hover:text-zinc-600 transition-colors">
            <HelpCircle className="h-3.5 w-3.5" />
          </span>
        </div>
        <div className="mt-5 grid grid-cols-2 items-stretch gap-4 md:grid-cols-3 xl:grid-cols-5">
          <Stat label={t('usage.cache_hit_tokens')} value={compactTokens(data?.cache?.hit_tokens)} fullValue={compactNumber(data?.cache?.hit_tokens)} />
          <Stat label={t('usage.requests_with_hits')} value={compactNumber(data?.cache?.hit_requests)} />
          <Stat label={t('usage.hit_rate')} value={coveragePercent(data?.cache?.hit_rate)} />
          <Stat label={t('usage.cache_write_tokens')} value={compactTokens(data?.cache?.write_tokens)} fullValue={compactNumber(data?.cache?.write_tokens)} />
          <Stat label={t('usage.write_rate')} value={coveragePercent(data?.cache?.write_rate)} />
        </div>
        {data?.cache?.reported_requests === 0 && (
          <p className="mt-4 text-xs text-zinc-500">{t('usage.no_cache_data')}</p>
        )}
      </section>

      <section className="mt-6 rounded-xl border border-zinc-200 bg-white p-5 shadow-sm">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <h2 className="font-semibold text-zinc-900">{t('usage.usage_by_provider')}</h2>
            <span title={t('usage.usage_by_provider_sub')} className="cursor-help text-zinc-400 hover:text-zinc-600 transition-colors">
              <HelpCircle className="h-3.5 w-3.5" />
            </span>
          </div>
          <span className="text-xs text-zinc-400">
            {providers.length} {t('usage.providers_count')} • {models.length} {t('usage.models_count')}
          </span>
        </div>
        {providers.length ? (
          <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-2">
            {providers.map((item) => {
              const providerModels = modelsByProvider.get(item.provider || '') || []
              const spendShare = totalSpend > 0 ? (item.estimated_spend / totalSpend) * 100 : 0
              return (
                <div key={item.provider} className="flex flex-col justify-between rounded-xl border border-zinc-200/80 bg-zinc-50/40 p-4 shadow-sm">
                  <div>
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="font-semibold text-zinc-900 truncate">{cleanDisplayName(item.provider)}</span>
                        <span className="inline-flex items-center rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] font-mono text-zinc-600 border border-zinc-200 shrink-0">
                          {spendShare.toFixed(1)}% {t('usage.share')}
                        </span>
                      </div>
                      <span className="font-mono font-bold text-zinc-900 shrink-0">{formatMoney(item.estimated_spend)}</span>
                    </div>

                    <div className="mt-2.5 h-1.5 w-full rounded-full bg-zinc-200/60 overflow-hidden">
                      <div className="h-full rounded-full bg-zinc-900" style={{ width: `${Math.max((item.estimated_spend / maxProviderSpend) * 100, 3)}%` }} />
                    </div>

                    <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-zinc-500 border-b border-zinc-200/60 pb-3">
                      <div><strong className="text-zinc-800 font-medium">{compactNumber(item.requests)}</strong> {t('usage.requests')}</div>
                      <div><strong className="text-zinc-800 font-medium">{compactTokens(item.total_tokens)}</strong> {t('usage.total_tokens')}</div>
                      {item.cache_hit_tokens ? (
                        <div className="text-emerald-700 font-medium">⚡ {compactTokens(item.cache_hit_tokens)} cached</div>
                      ) : null}
                    </div>

                    {providerModels.length ? (
                      <div className="mt-3 space-y-2">
                        {providerModels.slice(0, 8).map((model) => {
                          const modelShare = item.estimated_spend > 0 ? (model.estimated_spend / item.estimated_spend) * 100 : 0
                          return (
                            <div key={`${model.provider}-${model.model}`} className="flex items-center justify-between gap-3 rounded-lg bg-white p-2.5 border border-zinc-200/60 text-xs">
                              <div className="min-w-0">
                                <div className="font-medium text-zinc-900 truncate">{model.model}</div>
                                <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[11px] text-zinc-400">
                                  <span>{compactNumber(model.requests)} reqs</span>
                                  <span>•</span>
                                  <span>{compactTokens(model.total_tokens)} tok</span>
                                  {model.cache_hit_tokens ? (
                                    <>
                                      <span>•</span>
                                      <span className="text-emerald-600 font-medium">{compactTokens(model.cache_hit_tokens)} cached</span>
                                    </>
                                  ) : null}
                                </div>
                              </div>
                              <div className="text-right shrink-0">
                                <div className="font-mono font-semibold text-zinc-800">{formatMoney(model.estimated_spend)}</div>
                                <div className="text-[10px] text-zinc-400">{modelShare.toFixed(0)}%</div>
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    ) : null}
                  </div>
                </div>
              )
            })}
          </div>
        ) : (
          <p className="mt-5 text-sm text-zinc-500">{t('usage.no_usage_yet')}</p>
        )}
      </section>

      <section className="mt-6 rounded-xl border border-zinc-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <h2 className="font-semibold text-zinc-900">{t('usage.context_savings')}</h2>
            <span title={t('usage.context_savings_sub')} className="cursor-help text-zinc-400 hover:text-zinc-600 transition-colors">
              <HelpCircle className="h-3.5 w-3.5" />
            </span>
          </div>
          <button
            type="button"
            onClick={() => setBaselineOpen(true)}
            className="inline-flex items-center gap-2 rounded-lg border border-zinc-300 px-3 py-2 text-sm font-medium text-zinc-700 hover:border-zinc-950 hover:text-zinc-950 transition-colors"
          >
            <Settings2 className="h-4 w-4" />
            {baseline ? (t('usage.change_baseline')) : (t('usage.config_baseline'))}
          </button>
        </div>
        <div className="mt-5 grid grid-cols-1 items-stretch gap-4 sm:grid-cols-2">
          <Stat label={t('usage.trimmed_chars')} value={compactNumber(savings?.trimmed_chars || data?.trimmed_chars)} />
          <Stat label={t('usage.dollar_savings')} value={savings?.estimated_savings == null ? (t('usage.not_available')) : formatMoney(Number(savings.estimated_savings))} />
        </div>
        {baseline && (
          <p className="mt-4 text-xs text-zinc-600">
            {t('usage.compared_with', {
              service: cleanDisplayName(baseline.model_service_name),
              model: baseline.model,
              provider: cleanDisplayName(baseline.provider_name),
            }) || `Compared with ${cleanDisplayName(baseline.model_service_name)} / ${baseline.model} (${cleanDisplayName(baseline.provider_name)}).`}
          </p>
        )}
        <p className="mt-2 text-xs text-zinc-400">{baseline ? (t('usage.savings_basis_desc') || savings?.basis) : (t('usage.config_baseline'))}</p>
      </section>

      {baselineOpen && (
        <SavingsBaselineModal
          services={baselineOptions}
          baseline={baseline}
          onClose={() => setBaselineOpen(false)}
          onSaved={(next) => {
            setBaseline(next)
            setBaselineOpen(false)
            saasFetch<SavingsData>('/api/saas/savings?range=30d').then((result) => setSavings(result.data || null)).catch((e: unknown) => setError(errorText(e)))
          }}
        />
      )}

      {missingTokensModalOpen && (
        <MissingTokensModal
          missingUsage={missingUsage}
          totalMissing={data?.coverage?.missing_usage_requests || 0}
          onClose={() => setMissingTokensModalOpen(false)}
        />
      )}

      {data?.budget && (
        <div className="mt-6 rounded-xl border border-zinc-200 bg-white p-5 shadow-sm">
          <div className="flex justify-between text-sm">
            <span>{t('usage.todays_budget')}</span>
            <span className="font-mono">{data.budget.daily_limit ? `${formatMoney(data.budget.spent_today)} / ${formatMoney(data.budget.daily_limit)}` : (t('usage.no_limit'))}</span>
          </div>
          <div className="mt-3 h-2 rounded-full bg-zinc-100">
            <div className="h-full rounded-full bg-zinc-900" style={{ width: `${Math.min((data.budget.daily_limit ? data.budget.spent_today / data.budget.daily_limit : 0) * 100, 100)}%` }} />
          </div>
          <div className="mt-2 text-xs text-zinc-500">{t('usage.status_label', { status: data.budget.status }) || `Status: ${data.budget.status}`}</div>
        </div>
      )}

      {data?.coverage && (
        <section className="mt-6 rounded-xl border border-zinc-200 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <h2 className="font-semibold text-zinc-900">{t('usage.data_coverage')}</h2>
              <span title={t('usage.data_coverage_sub')} className="cursor-help text-zinc-400 hover:text-zinc-600 transition-colors">
                <HelpCircle className="h-3.5 w-3.5" />
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span className="shrink-0 whitespace-nowrap rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
                {t('usage.provider_reported_badge', { pct: coveragePercent(data.coverage.usage) }) || `${coveragePercent(data.coverage.usage)} provider-reported`}
              </span>
              {missingUsage.length > 0 && (
                <button
                  type="button"
                  onClick={() => setMissingTokensModalOpen(true)}
                  className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-800 border border-amber-200 hover:bg-amber-100 transition-colors"
                >
                  <span>{compactNumber(data.coverage.missing_usage_requests)} {t('usage.unreported')}</span>
                  <ChevronRight className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          </div>
          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            <Coverage
              label={t('usage.provider_reported_tokens')}
              value={data.coverage.usage}
              detail={t('usage.provider_reported_detail', { reported: compactNumber(data.coverage.provider_reported_requests), total: compactNumber(data.requests) }) || `${compactNumber(data.coverage.provider_reported_requests)} of ${compactNumber(data.requests)} requests include token data`}
            />
            <Coverage
              label={t('usage.configured_pricing')}
              value={data.coverage.pricing}
              detail={t('usage.configured_pricing_detail', { priced: compactNumber(data.coverage.priced_requests), total: compactNumber(data.requests) }) || `${compactNumber(data.coverage.priced_requests)} of ${compactNumber(data.requests)} requests have a pricing rule`}
            />
          </div>
        </section>
      )}
    </Page>
  )
}

