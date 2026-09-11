import { useEffect, useState } from 'react'
import { ChevronLeft, ChevronRight, Database, Info, Settings2, ShieldCheck, Sparkles } from 'lucide-react'
import { saasFetch } from '../../lib/saasApi'
import Select from '../../components/Select'
import { useI18n } from '../../lib/i18n'
import { ErrorMessage, Page, errorText } from './components'
import { SavingsBaselineModal } from './SavingsBaselineModal'
import type { SavingsBaseline, Service, ServiceDetails } from './types'

type QualityRecord = {
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
  prompt_preview: string
  verdict: 'verified' | 'schema_valid' | 'escalated' | 'completed' | 'error'
  verdict_desc: string
  feedback_source: string
}

type QualityAnalyticsData = {
  range: string
  summary: {
    total_queries: number
    comparison_status: 'available' | 'unavailable'
    quality_preserved_rate: number | null
    user_correction_rate: number | null
    schema_compliance_rate: number | null
    shadow_agreement_score: number | null
    pro_count: number
    flash_count: number
    baseline: {
      name: string
      cost_per_req: number | null
      avg_latency_ms: number | null
      p90_latency_ms: number | null
      task_success_rate: number | null
      correction_rate: number | null
      schema_compliance_rate: number | null
    } | null
    smartgate_routing: {
      name: string
      cost_per_req: number | null
      avg_latency_ms: number | null
      p90_latency_ms: number | null
      task_success_rate: number | null
      correction_rate: number | null
      schema_compliance_rate: number | null
      cost_saved_pct: number | null
      speedup_pct: number | null
    }
  }
  records: QualityRecord[]
  session_cache_health?: {
    sessions_observed: number
    sessions_collapsed: number
    avg_cache_hit_ratio: number | null
    sessions: { session_id: string; turns: number; cache_hit_ratio: number; collapsed: boolean }[]
  }
}

function QualityHelpTip({ tip, unavailable }: { tip: string; unavailable?: string }) {
  const title = unavailable ? `${tip} ${unavailable}` : tip
  return (
    <span title={title} className="cursor-help text-zinc-400 hover:text-zinc-600 transition-colors">
      <Info className="h-3.5 w-3.5" />
    </span>
  )
}

export function QualityPage() {
  const { t } = useI18n()
  const [range, setRange] = useState<'24h' | '7d' | '30d' | 'all'>('24h')
  const [verdictFilter, setVerdictFilter] = useState<'all' | 'verified' | 'schema_valid' | 'escalated' | 'completed' | 'error'>('all')
  const [data, setData] = useState<QualityAnalyticsData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(15)
  const [baselineModalOpen, setBaselineModalOpen] = useState(false)
  const [baselineOptions, setBaselineOptions] = useState<ServiceDetails[]>([])
  const [baselineData, setBaselineData] = useState<SavingsBaseline | null>(null)

  const fetchQualityData = () => {
    setLoading(true)
    saasFetch<QualityAnalyticsData>(`/api/saas/analytics/quality?range=${range}`)
      .then((res) => {
        setData(res.data || null)
        setError('')
      })
      .catch((e) => setError(errorText(e)))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    fetchQualityData()
  }, [range])

  useEffect(() => {
    saasFetch<Service[]>('/api/saas/model-services')
      .then(async (res) => {
        const details = await Promise.all((res.data || []).map(async (service) => {
          try { return (await saasFetch<ServiceDetails>(`/api/saas/model-services/${service.id}`)).data || null } catch { return null }
        }))
        setBaselineOptions(details.filter((service): service is ServiceDetails => Boolean(service)))
      })
      .catch(() => {})

    saasFetch<{ configured?: boolean } & Partial<SavingsBaseline>>('/api/saas/savings-baseline')
      .then((res) => {
        if (res.data?.configured) {
          setBaselineData(res.data as SavingsBaseline)
        }
      })
      .catch(() => {})
  }, [])

  useEffect(() => {
    setPage(1)
  }, [range, verdictFilter, pageSize])

  const filteredRecords = (data?.records || []).filter((r) => {
    if (verdictFilter === 'all') return true
    return r.verdict === verdictFilter
  })

  const totalFiltered = filteredRecords.length
  const totalPages = Math.max(1, Math.ceil(totalFiltered / pageSize))
  const currentPage = Math.min(page, totalPages)
  const startIndex = (currentPage - 1) * pageSize
  const paginatedRecords = filteredRecords.slice(startIndex, startIndex + pageSize)

  const summary = data?.summary
  const sessionHealth = data?.session_cache_health
  const baseline = summary?.baseline
  const routing = summary?.smartgate_routing

  return (
    <Page>
      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-emerald-600" />
            <h1 className="text-xl font-semibold tracking-tight">{t('quality.title')}</h1>
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
                  ? (t('quality.last_24h'))
                  : r === '7d'
                  ? (t('quality.last_7d'))
                  : r === '30d'
                  ? (t('quality.last_30d'))
                  : (t('quality.all_time'))}
              </button>
            ))}
          </div>
        </div>

        {error && <ErrorMessage text={error} />}

        {/* Top 4 Quality Scorecards */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="flex flex-col justify-between rounded-xl border border-zinc-200 bg-white p-5 shadow-sm">
            <div className="flex items-center justify-between gap-2">
              <div className="text-xs font-medium uppercase tracking-wide text-zinc-500 truncate">{t('quality.preserved_rate')}</div>
              <div className="flex items-center gap-1">
                <span className="inline-flex items-center rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 border border-emerald-200 shrink-0 whitespace-nowrap">
                  {summary?.quality_preserved_rate != null ? (t('quality.verified_tag')) : (t('quality.unavailable_tag'))}
                </span>
                <QualityHelpTip
                  tip={t('quality.preserved_rate_tip')}
                  unavailable={summary?.quality_preserved_rate == null ? (t('quality.preserved_rate_unavailable_tip')) : undefined}
                />
              </div>
            </div>
            <div className="mt-2 text-2xl font-bold text-zinc-950">
              {summary?.quality_preserved_rate != null ? `${summary.quality_preserved_rate}%` : 'N/A'}
            </div>
            <div className="mt-2 text-xs text-zinc-400">{t('quality.vs_baseline')}</div>
          </div>

          <div className="flex flex-col justify-between rounded-xl border border-zinc-200 bg-white p-5 shadow-sm">
            <div className="flex items-center justify-between gap-2">
              <div className="text-xs font-medium uppercase tracking-wide text-zinc-500 truncate">{t('quality.shadow_agreement')}</div>
              <div className="flex items-center gap-1">
                <span className="inline-flex items-center rounded-full bg-purple-50 px-2 py-0.5 text-[10px] font-semibold text-purple-700 border border-purple-200 shrink-0 whitespace-nowrap">
                  {summary?.shadow_agreement_score != null ? (t('quality.judge_score_tag')) : (t('quality.unavailable_tag'))}
                </span>
                <QualityHelpTip
                  tip={t('quality.shadow_agreement_tip')}
                  unavailable={summary?.shadow_agreement_score == null ? (t('quality.shadow_agreement_unavailable_tip')) : undefined}
                />
              </div>
            </div>
            <div className="mt-2 text-2xl font-bold text-purple-700">
              {summary?.shadow_agreement_score != null ? `${summary.shadow_agreement_score}%` : 'N/A'}
            </div>
            <div className="mt-2 text-xs text-zinc-400">{t('quality.similarity_sub')}</div>
          </div>

          <div className="flex flex-col justify-between rounded-xl border border-zinc-200 bg-white p-5 shadow-sm">
            <div className="flex items-center justify-between gap-2">
              <div className="text-xs font-medium uppercase tracking-wide text-zinc-500 truncate">{t('quality.correction_rate')}</div>
              <div className="flex items-center gap-1">
                <span className="inline-flex items-center rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-semibold text-blue-700 border border-blue-200 shrink-0 whitespace-nowrap">
                  {summary?.user_correction_rate != null ? (t('quality.healthy_tag')) : (t('quality.unavailable_tag'))}
                </span>
                <QualityHelpTip
                  tip={t('quality.correction_rate_tip')}
                  unavailable={summary?.user_correction_rate == null ? (t('quality.correction_rate_unavailable_tip')) : undefined}
                />
              </div>
            </div>
            <div className="mt-2 text-2xl font-bold text-zinc-950">
              {summary?.user_correction_rate != null ? `${summary.user_correction_rate}%` : 'N/A'}
            </div>
            <div className="mt-2 text-xs text-zinc-400">{t('quality.correction_sub')}</div>
          </div>

          <div className="flex flex-col justify-between rounded-xl border border-zinc-200 bg-white p-5 shadow-sm">
            <div className="flex items-center justify-between gap-2">
              <div className="text-xs font-medium uppercase tracking-wide text-zinc-500 truncate">{t('quality.schema_compliance')}</div>
              <div className="flex items-center gap-1">
                <span className="inline-flex items-center rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 border border-emerald-200 shrink-0 whitespace-nowrap">
                  {summary?.schema_compliance_rate != null ? (t('quality.valid_tag')) : (t('quality.unavailable_tag'))}
                </span>
                <QualityHelpTip
                  tip={t('quality.schema_compliance_tip')}
                  unavailable={summary?.schema_compliance_rate == null ? (t('quality.schema_compliance_unavailable_tip')) : undefined}
                />
              </div>
            </div>
            <div className="mt-2 text-2xl font-bold text-emerald-600">
              {summary?.schema_compliance_rate != null ? `${summary.schema_compliance_rate}%` : 'N/A'}
            </div>
            <div className="mt-2 text-xs text-zinc-400">{t('quality.schema_sub')}</div>
          </div>
        </div>

        {/* Session cache health: prefix-cache retention across multi-turn sessions */}
        {sessionHealth && sessionHealth.sessions_observed > 0 && (
          <div className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-sm font-semibold text-zinc-900">
                <Database className="h-4 w-4 text-sky-600" />
                {t('quality.session_cache_title')}
              </div>
              <span
                className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold border shrink-0 ${
                  sessionHealth.sessions_collapsed > 0
                    ? 'bg-amber-50 text-amber-700 border-amber-200'
                    : 'bg-emerald-50 text-emerald-700 border-emerald-200'
                }`}
                title={t('quality.session_cache_tip')}
              >
                {sessionHealth.sessions_collapsed > 0
                  ? (t('quality.session_cache_collapsed', { count: sessionHealth.sessions_collapsed }) || `${sessionHealth.sessions_collapsed} collapsed`)
                  : (t('quality.session_cache_healthy'))}
              </span>
            </div>
            <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-xs text-zinc-500">
              <span>{t('quality.session_cache_observed', { count: sessionHealth.sessions_observed }) || `${sessionHealth.sessions_observed} sessions`}</span>
              {sessionHealth.avg_cache_hit_ratio != null && (
                <span>{t('quality.session_cache_avg', { pct: sessionHealth.avg_cache_hit_ratio }) || `Avg hit ${sessionHealth.avg_cache_hit_ratio}%`}</span>
              )}
            </div>
          </div>
        )}

        {/* A/B Benchmark ROI & Quality Evidence Matrix */}
        <div className="rounded-xl border border-zinc-200 bg-white p-6 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-zinc-900">{t('quality.ab_benchmark_title')}</h2>
              <p className="mt-0.5 text-xs text-zinc-400">
                {t('quality.ab_benchmark_subtitle')}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setBaselineModalOpen(true)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-300 px-2.5 py-1.5 text-xs font-medium text-zinc-700 hover:border-zinc-950 hover:text-zinc-950 transition-colors"
              >
                <Settings2 className="h-3.5 w-3.5" />
                <span>{baseline ? (t('usage.change_baseline')) : (t('usage.config_baseline'))}</span>
              </button>
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700 border border-emerald-200 shrink-0 whitespace-nowrap">
                <Sparkles className="h-3.5 w-3.5" />
                {routing?.cost_saved_pct != null ? (t('quality.cost_saved', { pct: routing.cost_saved_pct }) || `${routing.cost_saved_pct}% Cost Saved`) : 'N/A'}
              </span>
            </div>
          </div>

          <div className="mt-4 grid gap-3 md:grid-cols-2">
            {/* Control Group: Baseline */}
            <div className="rounded-xl border border-zinc-200 bg-zinc-50/60 p-3.5 flex flex-col justify-between">
              <div>
                <div className="flex items-start justify-between border-b border-zinc-200/80 pb-2">
                  <div>
                    <span className="text-xs font-semibold text-zinc-700">{t('quality.control_title')}</span>
                    {baseline && (
                      <div className="mt-0.5 text-[11px] text-zinc-500 truncate max-w-[180px]" title={baseline.name}>
                        {baseline.name}
                      </div>
                    )}
                  </div>
                  <span className="text-[10px] font-medium text-zinc-400">{baseline ? (t('quality.flagship_tag')) : (t('quality.not_configured_tag'))}</span>
                </div>
                {baseline ? (
                  <div className="mt-2.5 grid grid-cols-2 gap-2.5 text-xs">
                    <div>
                      <div className="text-zinc-400 text-[11px]">{t('quality.avg_cost_req')}</div>
                      <div className="mt-0.5 text-sm font-semibold text-zinc-900 font-mono">
                        {baseline.cost_per_req != null ? `$${baseline.cost_per_req.toFixed(4)}` : 'N/A'}
                      </div>
                    </div>
                    <div>
                      <div className="text-zinc-400 text-[11px]">{t('quality.p90_latency')}</div>
                      <div className="mt-0.5 text-sm font-semibold text-zinc-900 font-mono">
                        {baseline.p90_latency_ms != null ? `${(baseline.p90_latency_ms / 1000).toFixed(1)}s` : 'N/A'}
                      </div>
                    </div>
                    <div>
                      <div className="text-zinc-400 text-[11px]">{t('quality.schema_compliance')}</div>
                      <div className="mt-0.5 text-xs font-semibold text-zinc-800">
                        {baseline.schema_compliance_rate != null ? `${baseline.schema_compliance_rate}%` : 'N/A'}
                      </div>
                    </div>
                    <div>
                      <div className="text-zinc-400 text-[11px]">{t('quality.task_success')}</div>
                      <div className="mt-0.5 text-xs font-semibold text-zinc-800">
                        {baseline.task_success_rate != null ? `${baseline.task_success_rate}%` : 'N/A'}
                      </div>
                    </div>
                    <div>
                      <div className="text-zinc-400 text-[11px]">{t('quality.followup_correction')}</div>
                      <div className="mt-0.5 text-xs font-semibold text-zinc-800">
                        {baseline.correction_rate != null ? `${baseline.correction_rate}%` : 'N/A'}
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="mt-3 text-center py-3 px-2 rounded-lg border border-dashed border-zinc-200 bg-white/70">
                    <p className="text-xs text-zinc-600 font-medium">
                      {t('quality.no_baseline_guide')}
                    </p>
                    <p className="mt-0.5 text-[11px] text-zinc-400">
                      {t('quality.no_baseline_guide_desc')}
                    </p>
                    <button
                      type="button"
                      onClick={() => setBaselineModalOpen(true)}
                      className="mt-2.5 inline-flex items-center gap-1.5 rounded-lg bg-zinc-900 px-2.5 py-1.5 text-xs font-medium text-white shadow-sm hover:bg-zinc-800 transition-colors"
                    >
                      <Settings2 className="h-3 w-3" />
                      <span>{t('quality.configure_baseline_now')}</span>
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* Treatment Group: SmartGate */}
            <div className="rounded-xl border border-emerald-200 bg-emerald-50/30 p-3.5 flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between border-b border-emerald-200/80 pb-2">
                  <span className="text-xs font-semibold text-emerald-900">{t('quality.treatment_title')}</span>
                  <span className="text-[10px] font-semibold text-emerald-700">{t('quality.pareto_tag')}</span>
                </div>
                <div className="mt-2.5 grid grid-cols-2 gap-2.5 text-xs">
                  <div>
                    <div className="text-emerald-800/70 text-[11px]">{t('quality.avg_cost_req')}</div>
                    <div className="mt-0.5 flex items-baseline gap-1.5">
                      <span className="text-sm font-bold text-emerald-700 font-mono">
                        {routing?.cost_per_req != null ? `$${routing.cost_per_req.toFixed(4)}` : 'N/A'}
                      </span>
                      <span className="text-[10px] font-semibold text-emerald-600">
                        {routing?.cost_saved_pct != null ? `(-${routing.cost_saved_pct}%)` : ''}
                      </span>
                    </div>
                  </div>
                  <div>
                    <div className="text-emerald-800/70 text-[11px]">{t('quality.p90_latency')}</div>
                    <div className="mt-0.5 flex items-baseline gap-1.5">
                      <span className="text-sm font-bold text-emerald-700 font-mono">
                        {routing?.p90_latency_ms != null ? `${(routing.p90_latency_ms / 1000).toFixed(1)}s` : 'N/A'}
                      </span>
                      <span className="text-[10px] font-semibold text-emerald-600">
                        {routing?.speedup_pct != null ? `(${routing.speedup_pct}% ${t('quality.faster', { pct: '' })})` : ''}
                      </span>
                    </div>
                  </div>
                  <div>
                    <div className="text-emerald-800/70 text-[11px]">{t('quality.task_success')}</div>
                    <div className="mt-0.5 flex items-baseline gap-1.5">
                      <span className="text-xs font-semibold text-zinc-900">
                        {routing?.task_success_rate != null ? `${routing.task_success_rate}%` : 'N/A'}
                      </span>
                      {routing?.task_success_rate != null && baseline?.task_success_rate != null ? <span className="text-[10px] text-zinc-500 font-mono">({(routing.task_success_rate - baseline.task_success_rate).toFixed(1)}% delta)</span> : null}
                    </div>
                  </div>
                  <div>
                    <div className="text-emerald-800/70 text-[11px]">{t('quality.followup_correction')}</div>
                    <div className="mt-0.5 flex items-baseline gap-1.5">
                      <span className="text-xs font-semibold text-zinc-900">
                        {routing?.correction_rate != null ? `${routing.correction_rate}%` : 'N/A'}
                      </span>
                      {routing?.correction_rate != null && baseline?.correction_rate != null ? <span className="text-[10px] text-zinc-500 font-mono">({(routing.correction_rate - baseline.correction_rate).toFixed(1)}% delta)</span> : null}
                    </div>
                  </div>
                  <div>
                    <div className="text-emerald-800/70 text-[11px]">{t('quality.schema_compliance')}</div>
                    <div className="mt-0.5 flex items-baseline gap-1.5">
                      <span className="text-xs font-semibold text-zinc-900">
                        {routing?.schema_compliance_rate != null ? `${routing.schema_compliance_rate}%` : 'N/A'}
                      </span>
                      {routing?.schema_compliance_rate != null && baseline?.schema_compliance_rate != null ? <span className="text-[10px] text-zinc-500 font-mono">({(routing.schema_compliance_rate - baseline.schema_compliance_rate).toFixed(1)}% delta)</span> : null}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>


        </div>

        {baselineModalOpen && (
          <SavingsBaselineModal
            services={baselineOptions}
            baseline={baselineData}
            onClose={() => setBaselineModalOpen(false)}
            onSaved={(next) => {
              setBaselineData(next)
              setBaselineModalOpen(false)
              fetchQualityData()
            }}
          />
        )}

        {/* Quality Stream & Evaluation Logs Table */}
        <div className="rounded-xl border border-zinc-200 bg-white overflow-hidden shadow-sm">
          <div className="p-5 pb-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-zinc-900">{t('quality.verdict_logs_title')}</h2>
              <p className="mt-0.5 text-xs text-zinc-400">{t('quality.verdict_logs_subtitle')}</p>
            </div>
            <div className="flex items-center gap-1 rounded-lg border border-zinc-200 bg-zinc-50/70 p-1">
              {(['all', 'verified', 'schema_valid', 'escalated', 'completed', 'error'] as const).map((v) => (
                <button
                  key={v}
                  onClick={() => setVerdictFilter(v)}
                  className={`rounded-md px-2.5 py-1 text-xs font-medium capitalize transition-colors ${
                    verdictFilter === v ? 'bg-white text-zinc-950 shadow-sm' : 'text-zinc-500 hover:text-zinc-900'
                  }`}
                >
                  {v === 'all'
                    ? (t('quality.all_verdicts'))
                    : v === 'verified'
                    ? (t('quality.verdict_verified'))
                    : v === 'schema_valid'
                    ? (t('quality.verdict_schema'))
                    : v === 'escalated'
                    ? (t('quality.verdict_escalated'))
                    : v === 'error'
                    ? (t('quality.verdict_error'))
                    : (t('quality.verdict_completed'))}
                </button>
              ))}
            </div>
          </div>

          <div className="border-t border-zinc-100 overflow-x-auto min-h-[420px]">
            {!paginatedRecords.length ? (
              <div className="py-16 text-center text-sm text-zinc-500">
                {loading ? (t('common.loading')) : (t('quality.no_records'))}
              </div>
            ) : (
              <table className="w-full min-w-[920px] text-left text-xs divide-y divide-zinc-100">
                <thead className="bg-zinc-50/50">
                  <tr className="text-zinc-500">
                    <th className="py-2.5 px-4 font-medium w-[140px]">{t('quality.col_time_service')}</th>
                    <th className="py-2.5 px-3 font-medium min-w-[180px] max-w-[240px]">{t('quality.col_prompt')}</th>
                    <th className="py-2.5 px-3 font-medium min-w-[150px]">{t('quality.col_model')}</th>
                    <th className="py-2.5 px-3 font-medium min-w-[160px]">{t('quality.col_verdict')}</th>
                    <th className="py-2.5 px-3 font-medium w-[140px]">{t('quality.col_source')}</th>
                    <th className="py-2.5 px-3 text-right font-medium w-[100px]">{t('quality.col_tokens_latency')}</th>
                    <th className="py-2.5 px-4 text-right font-medium w-[80px]">{t('quality.col_cost')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100 bg-white">
                  {paginatedRecords.map((r) => {
                    const cleanService = r.service_name.replace(/^[0-9a-fA-F-]{36,37}-/, '')
                    const cleanProvider = r.provider_name.replace(/^saas-[0-9a-fA-F-]{36}/, 'DeepSeek').replace(/^saas-/, '')
                    return (
                      <tr key={r.id} className="hover:bg-zinc-50/70 transition-colors">
                        <td className="py-3 px-4 align-middle whitespace-nowrap">
                          <div className="font-semibold text-zinc-900 truncate">{cleanService}</div>
                          <div className="text-[10px] text-zinc-400">{r.timestamp}</div>
                        </td>
                        <td className="py-3 px-3 align-middle max-w-[240px]">
                          <div className="font-mono text-zinc-800 text-[11px] truncate" title={r.prompt_preview}>
                            {r.prompt_preview || '—'}
                          </div>
                        </td>
                        <td className="py-3 px-3 align-middle whitespace-nowrap">
                          <div className="font-semibold text-zinc-900">{r.model}</div>
                          <div className="text-[10px] text-zinc-400 truncate max-w-[140px]">{cleanProvider}</div>
                        </td>
                        <td className="py-3 px-3 align-middle whitespace-nowrap">
                          <span
                            className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                              r.verdict === 'escalated'
                                ? 'bg-amber-50 text-amber-800 border border-amber-200'
                                : r.verdict === 'schema_valid'
                                ? 'bg-blue-50 text-blue-700 border border-blue-200'
                                : r.verdict === 'error'
                                ? 'bg-red-50 text-red-700 border border-red-200'
                                : 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                            }`}
                            title={r.verdict_desc}
                          >
                            {r.verdict === 'escalated'
                              ? `🔄 ${t('quality.verdict_escalated')}`
                              : r.verdict === 'schema_valid'
                              ? `🛠️ ${t('quality.verdict_schema')}`
                              : r.verdict === 'error'
                              ? `⚠️ ${t('quality.verdict_error')}`
                              : `✓ ${t('quality.verdict_completed')}`}
                          </span>
                        </td>
                        <td className="py-3 px-3 align-middle whitespace-nowrap">
                          <span className="inline-flex items-center rounded-md bg-zinc-100 px-1.5 py-0.5 text-[10px] font-medium text-zinc-700 border border-zinc-200/60">
                            {r.feedback_source}
                          </span>
                        </td>
                        <td className="py-3 px-3 align-middle text-right whitespace-nowrap">
                          <div className="font-medium text-zinc-900">{r.total_tokens.toLocaleString()} tok</div>
                          <div className="text-[10px] text-zinc-400">{r.latency_ms}ms</div>
                        </td>
                        <td className="py-3 px-4 align-middle text-right whitespace-nowrap font-semibold text-zinc-900 font-mono">
                          ${r.cost.toFixed(4)}
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
                  {t('pagination.showing', { start: startIndex + 1, end: Math.min(startIndex + pageSize, totalFiltered), total: totalFiltered }) || `Showing ${startIndex + 1}–${Math.min(startIndex + pageSize, totalFiltered)} of ${totalFiltered} records`}
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

