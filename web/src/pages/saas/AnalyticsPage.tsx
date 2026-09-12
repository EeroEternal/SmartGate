import { useEffect, useState } from 'react'
import { ChevronLeft, ChevronRight, HelpCircle, Info } from 'lucide-react'
import { saasFetch } from '../../lib/saasApi'
import Select from '../../components/Select'
import { useI18n } from '../../lib/i18n'
import { formatMoney } from '../../lib/format'
import { ErrorMessage, Page, errorText } from './components'

type QueryAnalyticsItem = {
  id: string
  timestamp: string
  service_name: string
  model: string
  provider_name: string
  prompt_tokens: number
  completion_tokens: number
  total_tokens: number
  latency_ms: number
  status_code: number
  cost: number
  strategy: string
  difficulty: number
  difficulty_tier: 'high' | 'medium' | 'low'
  prompt_preview: string
  signals: string[]
  attempts?: string[]
  fallback_used?: boolean
  candidates?: { model: string; capability?: number; excluded?: boolean; exclusion_reason?: string }[]
}

type RoutingAnalyticsData = {
  range: string
  summary: {
    total_queries: number
    high_tier_count: number
    medium_tier_count: number
    low_tier_count: number
    pro_count: number
    flash_count: number
    total_cost: number
    estimated_savings: number
    avg_latency_ms: number
    total_tokens: number
  }
  queries: QueryAnalyticsItem[]
}
export function AnalyticsPage() {
  const { t } = useI18n()
  const [range, setRange] = useState<'24h' | '7d' | '30d' | 'all'>('24h')
  const [tierFilter, setTierFilter] = useState<'all' | 'high' | 'medium' | 'low'>('all')
  const [data, setData] = useState<RoutingAnalyticsData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [expandedSignals, setExpandedSignals] = useState<Record<string, boolean>>({})
  const [expandedCandidates, setExpandedCandidates] = useState<Record<string, boolean>>({})
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(15)

  const toggleSignals = (id: string) => {
    setExpandedSignals((prev) => ({ ...prev, [id]: !prev[id] }))
  }

  const toggleCandidates = (id: string) => {
    setExpandedCandidates((prev) => ({ ...prev, [id]: !prev[id] }))
  }

  useEffect(() => {
    setLoading(true)
    saasFetch<RoutingAnalyticsData>(`/api/saas/analytics/routing?range=${range}`)
      .then((res) => {
        setData(res.data || null)
        setError('')
      })
      .catch((e) => setError(errorText(e)))
      .finally(() => setLoading(false))
  }, [range])

  useEffect(() => {
    setPage(1)
  }, [range, tierFilter, pageSize])

  const filteredQueries = (data?.queries || []).filter((q) => {
    if (tierFilter === 'all') return true
    return q.difficulty_tier === tierFilter
  })

  const totalFiltered = filteredQueries.length
  const totalPages = Math.max(1, Math.ceil(totalFiltered / pageSize))
  const currentPage = Math.min(page, totalPages)
  const startIndex = (currentPage - 1) * pageSize
  const paginatedQueries = filteredQueries.slice(startIndex, startIndex + pageSize)

  const total = data?.summary.total_queries || 0
  const highPct = total ? Math.round(((data?.summary.high_tier_count || 0) / total) * 100) : 0
  const medPct = total ? Math.round(((data?.summary.medium_tier_count || 0) / total) * 100) : 0
  const lowPct = total ? Math.max(0, 100 - highPct - medPct) : 0

  return (
    <Page>
      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-semibold tracking-tight">{t('analytics.title')}</h1>
            <span title={t('analytics.subtitle')} className="cursor-help text-zinc-400 hover:text-zinc-600 transition-colors">
              <HelpCircle className="h-4 w-4" />
            </span>
          </div>
          <div className="flex rounded-lg border border-zinc-200 bg-white p-1" role="tablist">
            {(['24h', '7d', '30d', 'all'] as const).map((r) => (
              <button
                key={r}
                onClick={() => setRange(r)}
                className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                  range === r ? 'bg-zinc-900 text-white' : 'text-zinc-500 hover:text-zinc-950'
                }`}
              >
                {r === '24h'
                  ? (t('analytics.last_24h'))
                  : r === '7d'
                  ? (t('analytics.last_7d'))
                  : r === '30d'
                  ? (t('analytics.last_30d'))
                  : (t('analytics.all_time'))}
              </button>
            ))}
          </div>
        </div>

        {error && <ErrorMessage text={error} />}

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="flex flex-col justify-between rounded-xl border border-zinc-200 bg-white p-5 shadow-sm">
            <div className="text-xs font-medium uppercase tracking-wide text-zinc-500 whitespace-nowrap truncate">{t('analytics.analyzed_queries')}</div>
            <div className="mt-2 text-2xl font-bold text-zinc-950 whitespace-nowrap">{total.toLocaleString()}</div>
            <div className="mt-2 text-xs text-zinc-400 whitespace-nowrap truncate">{t('analytics.analyzed_queries_sub')}</div>
          </div>

          <div className="flex flex-col justify-between rounded-xl border border-zinc-200 bg-white p-5 shadow-sm">
            <div className="text-xs font-medium uppercase tracking-wide text-zinc-500 whitespace-nowrap truncate">{t('analytics.complexity_breakdown')}</div>
            <div className="mt-2 flex items-baseline gap-2.5 sm:gap-3 flex-nowrap">
              <div className="flex items-baseline whitespace-nowrap">
                <span className="text-2xl font-bold text-purple-700">{(data?.summary.high_tier_count || 0).toLocaleString()}</span>
                <span className="ml-1 text-xs text-zinc-400 whitespace-nowrap">{t('analytics.tier_high_short') || t('analytics.tier_high')}</span>
              </div>
              <div className="h-4 w-px bg-zinc-200 shrink-0" />
              <div className="flex items-baseline whitespace-nowrap">
                <span className="text-2xl font-bold text-amber-600">{(data?.summary.medium_tier_count || 0).toLocaleString()}</span>
                <span className="ml-1 text-xs text-zinc-400 whitespace-nowrap">{t('analytics.tier_medium_short') || t('analytics.tier_medium')}</span>
              </div>
              <div className="h-4 w-px bg-zinc-200 shrink-0" />
              <div className="flex items-baseline whitespace-nowrap">
                <span className="text-2xl font-bold text-emerald-600">{(data?.summary.low_tier_count || 0).toLocaleString()}</span>
                <span className="ml-1 text-xs text-zinc-400 whitespace-nowrap">{t('analytics.tier_low_short') || t('analytics.tier_low')}</span>
              </div>
            </div>
            <div className="mt-2 text-xs text-zinc-400 whitespace-nowrap truncate">{t('analytics.high_reasoning_sub', { pct: highPct }) || `${highPct}% complex reasoning & code`}</div>
          </div>

          <div className="flex flex-col justify-between rounded-xl border border-zinc-200 bg-white p-5 shadow-sm">
            <div className="text-xs font-medium uppercase tracking-wide text-zinc-500 whitespace-nowrap truncate">{t('analytics.model_tier_routing')}</div>
            <div className="mt-2 flex items-baseline gap-3 sm:gap-4 flex-nowrap">
              <div className="flex items-baseline whitespace-nowrap">
                <span className="text-2xl font-bold text-purple-700">{(data?.summary.pro_count || 0).toLocaleString()}</span>
                <span className="ml-1 text-xs text-zinc-400 whitespace-nowrap">{t('analytics.pro_model_short') || t('analytics.pro_model')}</span>
              </div>
              <div className="h-4 w-px bg-zinc-200 shrink-0" />
              <div className="flex items-baseline whitespace-nowrap">
                <span className="text-2xl font-bold text-emerald-600">{(data?.summary.flash_count || 0).toLocaleString()}</span>
                <span className="ml-1 text-xs text-zinc-400 whitespace-nowrap">{t('analytics.flash_model_short') || t('analytics.flash_model')}</span>
              </div>
            </div>
            <div className="mt-2 text-xs text-zinc-400 whitespace-nowrap truncate">{t('analytics.dynamic_dispatch')}</div>
          </div>

          <div className="flex flex-col justify-between rounded-xl border border-zinc-200 bg-white p-5 shadow-sm">
            <div className="text-xs font-medium uppercase tracking-wide text-zinc-500 whitespace-nowrap truncate">{t('analytics.estimated_savings')}</div>
            <div className="mt-2 text-2xl font-bold text-emerald-600 whitespace-nowrap">
              {formatMoney(data?.summary.estimated_savings)}
            </div>
            <div className="mt-2 text-xs text-zinc-400 whitespace-nowrap truncate">
              {t('analytics.total_spend', { amount: formatMoney(data?.summary.total_cost) }) || `Total spend: ${formatMoney(data?.summary.total_cost)}`}
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-zinc-900">{t('analytics.spectrum_title')}</h2>
            <span className="text-xs text-zinc-400">{t('analytics.spectrum_hint')}</span>
          </div>

          <div className="mt-4 flex h-3 w-full overflow-hidden rounded-full bg-zinc-100">
            {highPct > 0 && <div style={{ width: `${highPct}%` }} className="bg-purple-600 transition-all" title={`High: ${highPct}%`} />}
            {medPct > 0 && <div style={{ width: `${medPct}%` }} className="bg-amber-500 transition-all" title={`Medium: ${medPct}%`} />}
            {lowPct > 0 && <div style={{ width: `${lowPct}%` }} className="bg-emerald-500 transition-all" title={`Low: ${lowPct}%`} />}
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-4 text-xs text-zinc-500">
            <div className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full bg-purple-600" />
              <span>{t('analytics.high_complexity')}: <strong>{(data?.summary.high_tier_count || 0).toLocaleString()}</strong> ({highPct}%)</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full bg-amber-500" />
              <span>{t('analytics.med_complexity')}: <strong>{(data?.summary.medium_tier_count || 0).toLocaleString()}</strong> ({medPct}%)</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full bg-emerald-500" />
              <span>{t('analytics.low_complexity')}: <strong>{(data?.summary.low_tier_count || 0).toLocaleString()}</strong> ({lowPct}%)</span>
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-zinc-200 bg-white overflow-hidden shadow-sm">
          <div className="p-5 pb-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-zinc-900">{t('analytics.table_title')}</h2>
              <p className="mt-0.5 text-xs text-zinc-400">{t('analytics.table_subtitle')}</p>
            </div>
            <div className="flex items-center gap-1 rounded-lg border border-zinc-200 bg-zinc-50/70 p-1">
              {(['all', 'high', 'medium', 'low'] as const).map((tier) => (
                <button
                  key={tier}
                  onClick={() => setTierFilter(tier)}
                  className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                    tierFilter === tier ? 'bg-white text-zinc-950 shadow-sm' : 'text-zinc-500 hover:text-zinc-900'
                  }`}
                >
                  {tier === 'all'
                    ? (t('analytics.all_tiers'))
                    : tier === 'high'
                    ? (t('analytics.tier_high'))
                    : tier === 'medium'
                    ? (t('analytics.tier_medium'))
                    : (t('analytics.tier_low'))}
                </button>
              ))}
            </div>
          </div>

          <div className="border-t border-zinc-100 overflow-x-auto min-h-[420px]">
            {!paginatedQueries.length ? (
              <div className="py-16 text-center text-sm text-zinc-500">
                {loading ? (t('common.loading')) : (t('analytics.no_records'))}
              </div>
            ) : (
              <table className="w-full min-w-[920px] text-left text-xs divide-y divide-zinc-100">
                <thead className="bg-zinc-50/50">
                  <tr className="text-zinc-500">
                    <th className="py-2.5 px-4 font-medium w-[140px]">{t('analytics.col_time_service')}</th>
                    <th className="py-2.5 px-3 font-medium min-w-[180px] max-w-[240px]">{t('analytics.col_prompt')}</th>
                    <th className="py-2.5 px-3 font-medium w-[130px]">{t('analytics.col_complexity')}</th>
                    <th className="py-2.5 px-3 font-medium min-w-[220px] max-w-[280px]">{t('analytics.col_signals')}</th>
                    <th className="py-2.5 px-3 font-medium min-w-[150px]">{t('analytics.col_model')}</th>
                    <th className="py-2.5 px-3 text-right font-medium w-[100px]">{t('analytics.col_tokens_latency')}</th>
                    <th className="py-2.5 px-4 text-right font-medium w-[80px]">{t('analytics.col_cost')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100 bg-white">
                  {paginatedQueries.map((q) => {
                    const cleanService = q.service_name.replace(/^[0-9a-fA-F-]{36,37}-/, '')
                    const cleanProvider = q.provider_name.replace(/^saas-[0-9a-fA-F-]{36}/, 'DeepSeek').replace(/^saas-/, '')
                    const list = q.signals.slice(0, 2)
                    const remaining = q.signals.slice(2)
                    return (
                      <tr key={q.id} className="hover:bg-zinc-50/70 transition-colors">
                        <td className="py-3 px-4 align-middle whitespace-nowrap">
                          <div className="font-semibold text-zinc-900 truncate">{cleanService}</div>
                          <div className="text-[10px] text-zinc-400">{q.timestamp}</div>
                        </td>
                        <td className="py-3 px-3 align-middle max-w-[240px]">
                          <div className="font-mono text-zinc-800 text-[11px] truncate" title={q.prompt_preview}>
                            {q.prompt_preview}
                          </div>
                        </td>
                        <td className="py-3 px-3 align-middle whitespace-nowrap">
                          <span
                            className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                              q.difficulty_tier === 'high'
                                ? 'bg-purple-50 text-purple-700 border border-purple-200'
                                : q.difficulty_tier === 'medium'
                                ? 'bg-amber-50 text-amber-700 border border-amber-200'
                                : 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                            }`}
                          >
                            D = {q.difficulty.toFixed(2)} ({q.difficulty_tier})
                          </span>
                        </td>
                        <td className="py-3 px-3 align-middle">
                          <div className="flex flex-wrap items-center gap-1 max-w-[260px]">
                            {list.map((sig, i) => (
                              <span
                                key={i}
                                className={`inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-medium leading-tight whitespace-nowrap ${
                                  sig.includes('Judge')
                                    ? 'bg-purple-50 text-purple-700 border border-purple-200/80 font-semibold'
                                    : sig.includes('reasoning') || sig.includes('Correction')
                                    ? 'bg-amber-50 text-amber-800 border border-amber-200/80'
                                    : 'bg-zinc-100 text-zinc-700 border border-zinc-200/60'
                                }`}
                              >
                                {sig}
                              </span>
                            ))}
                            {remaining.length > 0 && (
                              <div className="group relative inline-flex items-center">
                                <span
                                  className="inline-flex items-center rounded-md bg-zinc-100 hover:bg-zinc-200 px-1.5 py-0.5 text-[10px] font-medium text-zinc-600 border border-zinc-200 cursor-help transition-colors"
                                  title={q.signals.join(', ')}
                                >
                                  +{remaining.length}
                                </span>
                                <div className="pointer-events-none absolute left-0 bottom-full z-50 mb-2 hidden w-56 rounded-xl border border-zinc-200 bg-white p-2.5 shadow-xl group-hover:block text-left whitespace-normal">
                                  <div className="text-[11px] font-semibold text-zinc-900 mb-1.5">
                                    {t('analytics.col_signals')} ({q.signals.length})
                                  </div>
                                  <div className="flex flex-wrap gap-1">
                                    {q.signals.map((s, idx) => (
                                      <span
                                        key={idx}
                                        className={`inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-medium ${
                                          s.includes('Judge')
                                            ? 'bg-purple-50 text-purple-700 border border-purple-200'
                                            : s.includes('reasoning') || s.includes('Correction')
                                            ? 'bg-amber-50 text-amber-800 border border-amber-200'
                                            : 'bg-zinc-100 text-zinc-700 border border-zinc-200'
                                        }`}
                                      >
                                        {s}
                                      </span>
                                    ))}
                                  </div>
                                </div>
                              </div>
                            )}
                          </div>
                        </td>
                        <td className="py-3 px-3 align-middle whitespace-nowrap">
                          <div className="flex items-center gap-1.5">
                            <span className="font-semibold text-zinc-900">{q.model}</span>
                            {(q.candidates?.length ?? 0) > 1 && (
                              <div className="group relative inline-flex items-center">
                                <button
                                  type="button"
                                  className="text-zinc-400 hover:text-zinc-700 transition-colors p-0.5 rounded-full hover:bg-zinc-100 cursor-help"
                                  aria-label={t('analytics.why_model')}
                                  title={t('analytics.why_model')}
                                >
                                  <Info className="h-3.5 w-3.5" />
                                </button>
                                <div className="pointer-events-none absolute right-0 bottom-full z-50 mb-2 hidden w-64 rounded-xl border border-zinc-200 bg-white p-3 shadow-xl group-hover:block text-left whitespace-normal">
                                  <div className="text-[11px] font-semibold text-zinc-900 mb-1.5 flex items-center justify-between">
                                    <span>{t('analytics.why_model')}</span>
                                    <span className="text-[10px] font-normal text-zinc-400">{t('analytics.candidate_ranking')}</span>
                                  </div>
                                  <ol className="space-y-1.5">
                                    {(q.candidates ?? []).map((candidate, index) => (
                                      <li key={`${q.id}-${index}`} className="flex items-center justify-between text-[11px] leading-tight">
                                        <span className={`truncate mr-2 ${index === 0 ? 'font-semibold text-zinc-950' : candidate.excluded ? 'line-through text-zinc-400' : 'text-zinc-600'}`}>
                                          {index + 1}. {candidate.model}
                                        </span>
                                        <span className="shrink-0 text-[10px] font-mono text-zinc-400">
                                          {candidate.excluded ? (
                                            <span className="text-rose-500 font-sans">
                                              excluded{candidate.exclusion_reason ? ` (${candidate.exclusion_reason})` : ''}
                                            </span>
                                          ) : (
                                            `cap ${(candidate.capability ?? 0).toFixed(2)}`
                                          )}
                                        </span>
                                      </li>
                                    ))}
                                  </ol>
                                </div>
                              </div>
                            )}
                          </div>
                          <div className="text-[10px] text-zinc-400 truncate max-w-[140px]" title={q.provider_name}>{cleanProvider}</div>
                          {q.fallback_used && (
                            <div className="mt-0.5 inline-flex items-center rounded-md border border-rose-200/80 bg-rose-50 px-1.5 py-0.5 text-[9px] font-medium text-rose-700" title={`Attempted in order: ${(q.attempts ?? []).join(' → ')}`}>
                              {t('analytics.fallback_badge')}
                            </div>
                          )}
                        </td>
                        <td className="py-3 px-3 align-middle text-right whitespace-nowrap">
                          <div className="font-medium text-zinc-900">{q.total_tokens.toLocaleString()} tok</div>
                          <div className="text-[10px] text-zinc-400">{q.latency_ms}ms</div>
                        </td>
                        <td className="py-3 px-4 align-middle text-right whitespace-nowrap font-semibold text-zinc-900">
                          {formatMoney(q.cost)}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}
          </div>

          {totalFiltered > 0 && (
            <div className="border-t border-zinc-100 bg-zinc-50/70 px-5 py-3 flex flex-wrap items-center justify-between gap-3 text-xs text-zinc-500 select-none min-h-[52px]">
              <div className="flex items-center gap-3">
                <span className="whitespace-nowrap tabular-nums">
                  {t('pagination.showing', { start: startIndex + 1, end: Math.min(startIndex + pageSize, totalFiltered), total: totalFiltered }) || `Showing ${startIndex + 1}–${Math.min(startIndex + pageSize, totalFiltered)} of ${totalFiltered} queries`}
                </span>
                <div className="w-32 min-w-[125px]">
                  <Select
                    size="sm"
                    direction="up"
                    options={[
                      { id: '10', name: t('pagination.per_page', { count: 10 }) },
                      { id: '15', name: t('pagination.per_page', { count: 15 }) },
                      { id: '25', name: t('pagination.per_page', { count: 25 }) },
                      { id: '50', name: t('pagination.per_page', { count: 50 }) },
                    ]}
                    selected={{ id: String(pageSize), name: t('pagination.per_page', { count: pageSize }) || `${pageSize} / page` }}
                    onChange={(opt) => {
                      setPageSize(Number(opt.id))
                      setPage(1)
                    }}
                  />
                </div>
              </div>

              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  disabled={currentPage <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  className="inline-flex h-8 w-8 min-w-[32px] max-w-[32px] shrink-0 items-center justify-center rounded-lg border border-zinc-200 bg-white text-zinc-600 transition hover:bg-zinc-100 disabled:opacity-40 disabled:pointer-events-none"
                  aria-label={t('pagination.prev')}
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>

                <div className="flex items-center gap-1">
                  {(() => {
                    const items: (number | string)[] = []
                    if (totalPages <= 7) {
                      for (let i = 1; i <= totalPages; i++) items.push(i)
                    } else if (currentPage <= 4) {
                      items.push(1, 2, 3, 4, 5, '…', totalPages)
                    } else if (currentPage >= totalPages - 3) {
                      items.push(1, '…', totalPages - 4, totalPages - 3, totalPages - 2, totalPages - 1, totalPages)
                    } else {
                      items.push(1, '…', currentPage - 1, currentPage, currentPage + 1, '…', totalPages)
                    }

                    return items.map((item, idx) =>
                      typeof item === 'number' ? (
                        <button
                          key={`page-${item}`}
                          type="button"
                          onClick={() => setPage(item)}
                          className={`h-8 w-8 min-w-[32px] max-w-[32px] shrink-0 flex items-center justify-center rounded-lg text-xs font-medium tabular-nums transition-colors ${
                            currentPage === item
                              ? 'bg-zinc-900 text-white shadow-sm font-semibold'
                              : 'bg-white text-zinc-600 border border-zinc-200 hover:bg-zinc-100'
                          }`}
                        >
                          {item}
                        </button>
                      ) : (
                        <span key={`ellipsis-${idx}`} className="h-8 w-8 min-w-[32px] max-w-[32px] shrink-0 flex items-center justify-center text-xs text-zinc-400 select-none">
                          {item}
                        </span>
                      )
                    )
                  })()}
                </div>

                <button
                  type="button"
                  disabled={currentPage >= totalPages}
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  className="inline-flex h-8 w-8 min-w-[32px] max-w-[32px] shrink-0 items-center justify-center rounded-lg border border-zinc-200 bg-white text-zinc-600 transition hover:bg-zinc-100 disabled:opacity-40 disabled:pointer-events-none"
                  aria-label={t('pagination.next')}
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </Page>
  )
}

