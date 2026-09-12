import { useEffect, useState } from 'react'
import { HelpCircle, Search, Sparkles } from 'lucide-react'
import { saasFetch } from '../../lib/saasApi'
import { useI18n } from '../../lib/i18n'
import { formatMoney } from '../../lib/format'
import { ErrorMessage, Page, errorText } from './components'
import { ModelProbeModal } from './ModelProbeModal'
import { useModelServices } from './useModelServices'
import type { CallApi, ModelDna, Service, ServiceDetails, ServiceEndpoint } from './types'

const RADAR_PALETTES = [
  { stroke: '#8b5cf6', fill: 'rgba(139, 92, 246, 0.22)', dot: '#7c3aed', text: 'text-purple-700', bg: 'bg-purple-600', pill: 'bg-purple-50 text-purple-700 border-purple-200' },
  { stroke: '#10b981', fill: 'rgba(16, 185, 129, 0.22)', dot: '#059669', text: 'text-emerald-700', bg: 'bg-emerald-600', pill: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  { stroke: '#f59e0b', fill: 'rgba(245, 158, 11, 0.22)', dot: '#d97706', text: 'text-amber-700', bg: 'bg-amber-600', pill: 'bg-amber-50 text-amber-700 border-amber-200' },
  { stroke: '#0ea5e9', fill: 'rgba(14, 165, 233, 0.22)', dot: '#0284c7', text: 'text-sky-700', bg: 'bg-sky-600', pill: 'bg-sky-50 text-sky-700 border-sky-200' },
  { stroke: '#ec4899', fill: 'rgba(236, 72, 153, 0.22)', dot: '#db2777', text: 'text-pink-700', bg: 'bg-pink-600', pill: 'bg-pink-50 text-pink-700 border-pink-200' },
  { stroke: '#6366f1', fill: 'rgba(99, 102, 241, 0.22)', dot: '#4f46e5', text: 'text-indigo-700', bg: 'bg-indigo-600', pill: 'bg-indigo-50 text-indigo-700 border-indigo-200' },
]

function formatShortModel(rawModel: string): string {
  if (!rawModel) return ''
  const parts = rawModel.split('/')
  return parts[parts.length - 1] || rawModel
}

export function EvaluationPage() {
  const { t } = useI18n()
  // The service list is shared with the rest of the shell; only the details are page-local.
  const { services, loading: servicesLoading, error: servicesError, refresh } = useModelServices()
  const [endpoints, setEndpoints] = useState<(ServiceEndpoint & { serviceId: string; serviceName: string })[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const displayError = error || servicesError
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [hoveredPoint, setHoveredPoint] = useState<{ model: string; dim: string; score: number; x: number; y: number } | null>(null)
  const [probingEndpoint, setProbingEndpoint] = useState<{ endpoint: ServiceEndpoint; serviceId: string } | null>(null)

  const loadData = async (serviceList: Service[]) => {
    try {
      setLoading(true)
      // All service details are requested concurrently; a failing detail is skipped and
      // the remaining endpoints still render (same tolerance as the old sequential loop).
      const details = await Promise.all(serviceList.map(async (service) => {
        try {
          return { service, detail: (await saasFetch<ServiceDetails>(`/api/saas/model-services/${service.id}`)).data }
        } catch {
          return { service, detail: undefined }
        }
      }))

      const list: (ServiceEndpoint & { serviceId: string; serviceName: string })[] = []
      const seen = new Set<string>()
      for (const { service, detail } of details) {
        if (!detail?.endpoints) continue
        for (const ep of detail.endpoints) {
          const key = `${ep.provider_name}::${ep.model}`
          if (!seen.has(key)) {
            seen.add(key)
            list.push({ ...ep, serviceId: service.id, serviceName: service.name })
          }
        }
      }

      setEndpoints(list)
      setSelectedIds(list.slice(0, 6).map((e) => e.id))
    } catch (e: any) {
      setError(errorText(e))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    // Wait for the shared list to settle so `loading` keeps its previous meaning.
    if (servicesLoading) return
    void loadData(services)
  }, [services, servicesLoading])

  const [searchQuery, setSearchQuery] = useState('')
  const [tierFilter, setTierFilter] = useState<'all' | 'pro' | 'flash'>('all')

  const toggleEndpoint = (id: string) => {
    setSelectedIds((prev) => {
      if (prev.includes(id)) {
        return prev.length > 1 ? prev.filter((item) => item !== id) : prev
      }
      if (prev.length >= 4) {
        return [...prev.slice(1), id]
      }
      return [...prev, id]
    })
  }

  const selectTop4 = () => setSelectedIds(endpoints.slice(0, 4).map((e) => e.id))
  const clearAll = () => {
    if (endpoints.length > 0) setSelectedIds([endpoints[0].id])
  }

  const filteredEndpoints = endpoints.filter((ep) => {
    const matchesSearch =
      ep.model.toLowerCase().includes(searchQuery.toLowerCase()) ||
      ep.provider_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      ep.serviceName.toLowerCase().includes(searchQuery.toLowerCase())
    const matchesTier =
      tierFilter === 'all'
        ? true
        : tierFilter === 'pro'
        ? ep.preferred_for_hard_requests
        : !ep.preferred_for_hard_requests
    return matchesSearch && matchesTier
  })

  const RADAR_DIMENSIONS = [
    { id: 'code_logic', name: t('radar.code_logic'), short: t('radar.code_short'), icon: '💻', anchor: 'middle' as const, dx: 0, dy: -12 },
    { id: 'reasoning_math', name: t('radar.reasoning_math'), short: t('radar.math_short'), icon: '🧠', anchor: 'start' as const, dx: 10, dy: 4 },
    { id: 'agent_tools', name: t('radar.agent_tools'), short: t('radar.tools_short'), icon: '🛠️', anchor: 'start' as const, dx: 8, dy: 16 },
    { id: 'multilingual_nlp', name: t('radar.multilingual_nlp'), short: t('radar.lang_short'), icon: '🌐', anchor: 'end' as const, dx: -8, dy: 16 },
    { id: 'context_retention', name: t('radar.context_retention'), short: t('radar.context_short'), icon: '📜', anchor: 'end' as const, dx: -10, dy: 4 },
  ]

  const cx = 170
  const cy = 150
  const maxR = 95
  const angles = [0, 1, 2, 3, 4].map((i) => (2 * Math.PI * i) / 5 - Math.PI / 2)

  const getCoord = (score: number, idx: number) => {
    const r = (Math.max(10, Math.min(100, score)) / 100) * maxR
    const angle = angles[idx]
    return {
      x: cx + r * Math.cos(angle),
      y: cy + r * Math.sin(angle),
    }
  }

  const gridLevels = [20, 40, 60, 80, 100]

  const topCoding = [...endpoints].sort((a, b) => (b.model_dna?.code_logic || Math.round((b.capability_score || 0.5) * 100)) - (a.model_dna?.code_logic || Math.round((a.capability_score || 0.5) * 100)))[0]
  const topReasoning = [...endpoints].sort((a, b) => (b.model_dna?.reasoning_math || Math.round((b.capability_score || 0.5) * 98)) - (a.model_dna?.reasoning_math || Math.round((a.capability_score || 0.5) * 98)))[0]
  // An endpoint without a configured price is unknown, not cheap, so it sorts last.
  const topFlash = [...endpoints].sort((a, b) => (a.input_price_per_1m ?? Number.POSITIVE_INFINITY) - (b.input_price_per_1m ?? Number.POSITIVE_INFINITY))[0]

  return (
    <Page>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <h1 className="text-xl font-semibold tracking-tight flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-purple-600" />
            {t('evaluation.title')}
          </h1>
          <span title={t('evaluation.subtitle')} className="cursor-help text-zinc-400 hover:text-zinc-600 transition-colors">
            <HelpCircle className="h-4 w-4" />
          </span>
        </div>
      </div>

      {displayError && <ErrorMessage text={displayError} />}

      <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="flex flex-col justify-between rounded-xl border border-zinc-200 bg-white p-5 shadow-sm">
          <div className="text-xs font-medium uppercase tracking-wide text-zinc-500 whitespace-nowrap">{t('evaluation.models_evaluated')}</div>
          <div className="mt-2 text-3xl font-bold text-zinc-950">{endpoints.length}</div>
          <div className="mt-2 text-xs text-zinc-400">{t('radar.badge')}</div>
        </div>

        <div className="flex flex-col justify-between rounded-xl border border-zinc-200 bg-white p-5 shadow-sm">
          <div className="text-xs font-medium uppercase tracking-wide text-zinc-500 whitespace-nowrap">{t('evaluation.top_coding')}</div>
          <div className="mt-2 text-xl font-bold text-purple-700 truncate" title={topCoding?.model}>{topCoding ? formatShortModel(topCoding.model) : '—'}</div>
          <div className="mt-2 text-xs text-zinc-400">{topCoding?.provider_name ? t('evaluation.provider_points', { provider: topCoding.provider_name, score: topCoding.model_dna?.code_logic || 96 }) : '—'}</div>
        </div>

        <div className="flex flex-col justify-between rounded-xl border border-zinc-200 bg-white p-5 shadow-sm">
          <div className="text-xs font-medium uppercase tracking-wide text-zinc-500 whitespace-nowrap">{t('evaluation.top_reasoning')}</div>
          <div className="mt-2 text-xl font-bold text-amber-600 truncate" title={topReasoning?.model}>{topReasoning ? formatShortModel(topReasoning.model) : '—'}</div>
          <div className="mt-2 text-xs text-zinc-400">{topReasoning?.provider_name ? t('evaluation.provider_points', { provider: topReasoning.provider_name, score: topReasoning.model_dna?.reasoning_math || 98 }) : '—'}</div>
        </div>

        <div className="flex flex-col justify-between rounded-xl border border-zinc-200 bg-white p-5 shadow-sm">
          <div className="text-xs font-medium uppercase tracking-wide text-zinc-500 whitespace-nowrap">{t('evaluation.top_flash')}</div>
          <div className="mt-2 text-xl font-bold text-emerald-600 truncate" title={topFlash?.model}>{topFlash ? formatShortModel(topFlash.model) : '—'}</div>
          <div className="mt-2 text-xs text-zinc-400">{topFlash ? t('evaluation.price_per_1m', { price: formatMoney(topFlash.input_price_per_1m) }) : '—'}</div>
        </div>
      </div>

      <section className="mt-8 rounded-xl border border-zinc-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-100 pb-4">
          <div className="flex items-center gap-2">
            <h2 className="font-semibold text-zinc-950">{t('evaluation.radar_title') || t('radar.title')}</h2>
            <span className="rounded-md bg-purple-50 px-2 py-0.5 text-xs font-semibold text-purple-700 border border-purple-200">
              {t('radar.badge')}
            </span>
            <span className="text-xs text-zinc-500 font-medium">
              {t('evaluation.max_compare_hint', { count: selectedIds.length })}
            </span>
            <span title={t('evaluation.radar_desc') || t('radar.subtitle')} className="cursor-help text-zinc-400 hover:text-zinc-600 transition-colors">
              <HelpCircle className="h-3.5 w-3.5" />
            </span>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={selectTop4}
              className="text-xs font-medium text-primary hover:text-primary-hover transition-colors"
            >
              {t('evaluation.select_all')}
            </button>
            <span className="text-zinc-300">|</span>
            <button
              type="button"
              onClick={clearAll}
              className="text-xs font-medium text-zinc-500 hover:text-zinc-800 transition-colors"
            >
              {t('evaluation.clear_all')}
            </button>
          </div>
        </div>

        <div className="mt-6 grid grid-cols-1 lg:grid-cols-[380px_1fr] gap-6 items-start">
          {/* Left Column: Fixed / Sticky Radar Comparison Visualizer */}
          <div className="sticky top-4 flex flex-col items-center justify-center p-4 rounded-2xl bg-zinc-50/70 border border-zinc-200/80">
            <div className="w-full flex items-center justify-between mb-2">
              <span className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
                {t('evaluation.radar_title')}
              </span>
              <span className="text-[11px] text-zinc-400 font-mono">
                {selectedIds.length}/4
              </span>
            </div>

            <div className="relative w-full flex items-center justify-center">
              <svg viewBox="0 0 340 300" className="w-full max-w-[340px] h-[280px] select-none">
                {gridLevels.map((lvl) => {
                  const pts = angles
                    .map((a) => {
                      const r = (lvl / 100) * maxR
                      return `${cx + r * Math.cos(a)},${cy + r * Math.sin(a)}`
                    })
                    .join(' ')
                  return (
                    <polygon
                      key={lvl}
                      points={pts}
                      fill="none"
                      stroke="#e4e4e7"
                      strokeWidth={lvl === 100 ? '1.5' : '1'}
                      strokeDasharray={lvl === 100 ? 'none' : '2,2'}
                    />
                  )
                })}

                {angles.map((a, i) => (
                  <line
                    key={i}
                    x1={cx}
                    y1={cy}
                    x2={cx + maxR * Math.cos(a)}
                    y2={cy + maxR * Math.sin(a)}
                    stroke="#e4e4e7"
                    strokeWidth="1"
                  />
                ))}

                {RADAR_DIMENSIONS.map((dim, i) => {
                  const a = angles[i]
                  const labelR = maxR + 24
                  const lx = cx + labelR * Math.cos(a) + dim.dx
                  const ly = cy + labelR * Math.sin(a) + dim.dy
                  return (
                    <text
                      key={dim.id}
                      x={lx}
                      y={ly}
                      textAnchor={dim.anchor}
                      className="text-[11px] font-medium fill-zinc-600"
                    >
                      {dim.icon} {dim.short}
                    </text>
                  )
                })}

                {endpoints.map((ep, idx) => {
                  if (!selectedIds.includes(ep.id)) return null
                  const palette = RADAR_PALETTES[idx % RADAR_PALETTES.length]
                  const dna = ep.model_dna || {
                    code_logic: Math.round((ep.capability_score || 0.5) * 100),
                    reasoning_math: Math.round((ep.capability_score || 0.5) * 98),
                    agent_tools: ep.supports_tools ? 92 : 60,
                    multilingual_nlp: 90,
                    context_retention: 88,
                    strengths: [],
                  }
                  const scores = [
                    dna.code_logic,
                    dna.reasoning_math,
                    dna.agent_tools,
                    dna.multilingual_nlp,
                    dna.context_retention,
                  ]
                  const pts = scores.map((s, i) => getCoord(s, i))
                  const ptsStr = pts.map((p) => `${p.x},${p.y}`).join(' ')

                  return (
                    <g key={ep.id} className="transition-all duration-300">
                      <polygon
                        points={ptsStr}
                        fill={palette.fill}
                        stroke={palette.stroke}
                        strokeWidth="2"
                        className="hover:opacity-90 transition-opacity"
                      />
                      {pts.map((p, pIdx) => (
                        <circle
                          key={pIdx}
                          cx={p.x}
                          cy={p.y}
                          r="4"
                          fill={palette.dot}
                          stroke="#fff"
                          strokeWidth="1.5"
                          className="cursor-pointer hover:r-6 transition-all"
                          onMouseEnter={() =>
                            setHoveredPoint({
                              model: ep.model,
                              dim: RADAR_DIMENSIONS[pIdx].name,
                              score: scores[pIdx],
                              x: p.x,
                              y: p.y,
                            })
                          }
                          onMouseLeave={() => setHoveredPoint(null)}
                        />
                      ))}
                    </g>
                  )
                })}
              </svg>

              {hoveredPoint && (
                <div
                  className="pointer-events-none absolute z-50 rounded-lg border border-zinc-200 bg-white/95 px-2.5 py-1 text-xs shadow-md backdrop-blur-xs"
                  style={{
                    left: `${(hoveredPoint.x / 340) * 100}%`,
                    top: `${(hoveredPoint.y / 300) * 100 - 18}%`,
                    transform: 'translate(-50%, -100%)',
                  }}
                >
                  <div className="font-semibold text-zinc-950">{hoveredPoint.model}</div>
                  <div className="text-zinc-500 text-[11px]">
                    {hoveredPoint.dim}: <span className="font-mono font-bold text-zinc-900">{hoveredPoint.score}/100</span>
                  </div>
                </div>
              )}
            </div>

            {/* Currently Active Radar Pills */}
            <div className="w-full mt-3 pt-3 border-t border-zinc-200/80 flex flex-wrap gap-1.5 justify-center">
              {endpoints.filter((e) => selectedIds.includes(e.id)).map((ep) => {
                const epIndex = endpoints.findIndex((e) => e.id === ep.id)
                const palette = RADAR_PALETTES[epIndex % RADAR_PALETTES.length]
                const shortName = formatShortModel(ep.model)
                return (
                  <span
                    key={ep.id}
                    className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-semibold border ${palette.pill}`}
                    title={`${ep.model} (${ep.provider_name})`}
                  >
                    <span className="h-1.5 w-1.5 rounded-full shrink-0" style={{ backgroundColor: palette.dot }} />
                    <span className="truncate max-w-[110px]">{shortName}</span>
                    <button
                      type="button"
                      onClick={() => toggleEndpoint(ep.id)}
                      className="ml-0.5 opacity-60 hover:opacity-100 hover:text-rose-600 transition-opacity"
                    >
                      ×
                    </button>
                  </span>
                )
              })}
            </div>
          </div>

          {/* Right Column: Search, Filter, and Scrollable Compact Model Cards */}
          <div className="flex flex-col gap-3 min-w-0">
            {/* Search & Filter Header */}
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="relative flex-1 min-w-[200px]">
                <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-zinc-400" />
                <input
                  type="text"
                  placeholder={t('evaluation.search_models')}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full h-9 rounded-md border border-zinc-200 bg-zinc-50/50 pl-8 pr-3 text-xs text-zinc-900 placeholder:text-zinc-400 focus:bg-white focus:border-zinc-900 focus:outline-none transition-colors"
                />
              </div>
              <div className="flex items-center rounded-lg border border-zinc-200 p-0.5 bg-zinc-50 text-xs">
                {(['all', 'pro', 'flash'] as const).map((tier) => (
                  <button
                    key={tier}
                    type="button"
                    onClick={() => setTierFilter(tier)}
                    className={`rounded-md px-2.5 py-1 text-xs font-medium transition-all ${
                      tierFilter === tier
                        ? 'bg-white text-zinc-950 font-semibold shadow-xs'
                        : 'text-zinc-500 hover:text-zinc-950'
                    }`}
                  >
                    {tier === 'all'
                      ? (t('evaluation.filter_all'))
                      : tier === 'pro'
                      ? (t('evaluation.filter_pro'))
                      : (t('evaluation.filter_flash'))}
                  </button>
                ))}
              </div>
            </div>

            {/* Scrollable Container */}
            <div className="max-h-[520px] overflow-y-auto pr-1 space-y-2.5">
              {filteredEndpoints.length === 0 ? (
                <div className="rounded-xl border border-dashed border-zinc-200 p-8 text-center text-xs text-zinc-400">
                  {t('evaluation.no_matching_models')}
                </div>
              ) : (
                filteredEndpoints.map((ep) => {
                  const isSelected = selectedIds.includes(ep.id)
                  const originalIdx = endpoints.findIndex((e) => e.id === ep.id)
                  const palette = RADAR_PALETTES[originalIdx % RADAR_PALETTES.length]
                  const shortName = formatShortModel(ep.model)
                  const dna = ep.model_dna || {
                    code_logic: Math.round((ep.capability_score || 0.5) * 100),
                    reasoning_math: Math.round((ep.capability_score || 0.5) * 98),
                    agent_tools: ep.supports_tools ? 92 : 60,
                    multilingual_nlp: 90,
                    context_retention: 88,
                    strengths: ['Adaptive Reasoning', 'Low-Latency Synthesis'],
                  }
                  return (
                    <div
                      key={ep.id}
                      onClick={() => toggleEndpoint(ep.id)}
                      className={`cursor-pointer rounded-xl border p-3 transition-all ${
                        isSelected
                          ? 'border-zinc-400 bg-white shadow-xs ring-1 ring-zinc-900/5'
                          : 'border-zinc-200 bg-zinc-50/40 hover:bg-white hover:border-zinc-300'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => {}}
                            className="h-3.5 w-3.5 rounded border-zinc-300 text-zinc-950 focus:ring-zinc-950 shrink-0"
                          />
                          <span
                            className="h-2 w-2 rounded-full shrink-0"
                            style={{ backgroundColor: isSelected ? palette.dot : '#a1a1aa' }}
                          />
                          <span className="font-semibold text-zinc-950 truncate text-xs" title={ep.model}>
                            {shortName}
                          </span>
                          <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] text-zinc-500 font-medium truncate max-w-[120px]">
                            {ep.provider_name}
                          </span>
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] font-mono font-medium text-zinc-700">
                            {t('radar.cap_score', { score: (ep.capability_score ?? 0.5).toFixed(2) })}
                          </span>
                          {ep.preferred_for_hard_requests ? (
                            <span className="rounded-md bg-purple-50 border border-purple-200 px-1.5 py-0.5 text-[9px] font-semibold text-purple-700">
                              {t('radar.pro_tier')}
                            </span>
                          ) : (
                            <span className="rounded-md bg-emerald-50 border border-emerald-200 px-1.5 py-0.5 text-[9px] font-semibold text-emerald-700">
                              {t('radar.flash_tier')}
                            </span>
                          )}
                        </div>
                      </div>

                      {/* 5-Dimensional Horizontal Bar Distribution */}
                      <div className="mt-2.5 grid grid-cols-5 gap-2 text-center text-[10px]">
                        <div>
                          <div className="flex items-center justify-between text-[9px] text-zinc-400 mb-0.5">
                            <span>{t('radar.code_short')}</span>
                            <span className="font-mono font-bold text-zinc-700">{dna.code_logic}</span>
                          </div>
                          <div className="h-1.5 w-full rounded-full bg-zinc-100 overflow-hidden">
                            <div className="h-full bg-purple-500 rounded-full" style={{ width: `${dna.code_logic}%` }} />
                          </div>
                        </div>
                        <div>
                          <div className="flex items-center justify-between text-[9px] text-zinc-400 mb-0.5">
                            <span>{t('radar.math_short')}</span>
                            <span className="font-mono font-bold text-zinc-700">{dna.reasoning_math}</span>
                          </div>
                          <div className="h-1.5 w-full rounded-full bg-zinc-100 overflow-hidden">
                            <div className="h-full bg-amber-500 rounded-full" style={{ width: `${dna.reasoning_math}%` }} />
                          </div>
                        </div>
                        <div>
                          <div className="flex items-center justify-between text-[9px] text-zinc-400 mb-0.5">
                            <span>{t('radar.tools_short')}</span>
                            <span className="font-mono font-bold text-zinc-700">{dna.agent_tools}</span>
                          </div>
                          <div className="h-1.5 w-full rounded-full bg-zinc-100 overflow-hidden">
                            <div className="h-full bg-sky-500 rounded-full" style={{ width: `${dna.agent_tools}%` }} />
                          </div>
                        </div>
                        <div>
                          <div className="flex items-center justify-between text-[9px] text-zinc-400 mb-0.5">
                            <span>{t('radar.lang_short')}</span>
                            <span className="font-mono font-bold text-zinc-700">{dna.multilingual_nlp}</span>
                          </div>
                          <div className="h-1.5 w-full rounded-full bg-zinc-100 overflow-hidden">
                            <div className="h-full bg-emerald-500 rounded-full" style={{ width: `${dna.multilingual_nlp}%` }} />
                          </div>
                        </div>
                        <div>
                          <div className="flex items-center justify-between text-[9px] text-zinc-400 mb-0.5">
                            <span>{t('radar.context_short')}</span>
                            <span className="font-mono font-bold text-zinc-700">{dna.context_retention}</span>
                          </div>
                          <div className="h-1.5 w-full rounded-full bg-zinc-100 overflow-hidden">
                            <div className="h-full bg-indigo-500 rounded-full" style={{ width: `${dna.context_retention}%` }} />
                          </div>
                        </div>
                      </div>

                      <div className="mt-2.5 flex items-center justify-between border-t border-zinc-100 pt-2 text-xs">
                        <span className="text-[11px] text-zinc-400 truncate max-w-[180px]">{ep.serviceName}</span>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation()
                            setProbingEndpoint({ endpoint: ep, serviceId: ep.serviceId })
                          }}
                          className="inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium text-purple-700 hover:bg-purple-50 transition-colors"
                        >
                          <Sparkles className="h-3 w-3" /> {t('evaluation.run_probe')}
                        </button>
                      </div>
                    </div>
                  )
                })
              )}
            </div>
          </div>
        </div>
      </section>

      <section className="mt-8 rounded-xl border border-zinc-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-100 pb-4">
          <div className="flex items-center gap-2">
            <h2 className="font-semibold text-zinc-950">{t('evaluation.matrix_title')}</h2>
            <span title={t('evaluation.matrix_subtitle')} className="cursor-help text-zinc-400 hover:text-zinc-600 transition-colors">
              <HelpCircle className="h-3.5 w-3.5" />
            </span>
          </div>
        </div>

        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-left text-xs whitespace-nowrap">
            <thead className="border-b border-zinc-200 bg-zinc-50/75 text-[11px] font-semibold text-zinc-500">
              <tr>
                <th className="py-2.5 px-3">{t('evaluation.col_model')}</th>
                <th className="py-2.5 px-3">{t('evaluation.col_tier')}</th>
                <th className="py-2.5 px-3">{t('evaluation.col_overall')}</th>
                <th className="py-2.5 px-3">{t('evaluation.col_code')}</th>
                <th className="py-2.5 px-3">{t('evaluation.col_math')}</th>
                <th className="py-2.5 px-3">{t('evaluation.col_tools')}</th>
                <th className="py-2.5 px-3">{t('evaluation.col_lang')}</th>
                <th className="py-2.5 px-3">{t('evaluation.col_context')}</th>
                <th className="py-2.5 px-3">{t('evaluation.col_price')}</th>
                <th className="py-2.5 px-3 text-right">{t('common.actions')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {endpoints.length === 0 ? (
                <tr>
                  <td colSpan={10} className="py-8 text-center text-xs text-zinc-400">
                    {t('evaluation.no_models')}
                  </td>
                </tr>
              ) : (
                endpoints.map((ep) => {
                  const dna = ep.model_dna || {
                    code_logic: Math.round((ep.capability_score || 0.5) * 100),
                    reasoning_math: Math.round((ep.capability_score || 0.5) * 98),
                    agent_tools: ep.supports_tools ? 92 : 60,
                    multilingual_nlp: 90,
                    context_retention: 88,
                    strengths: [],
                  }
                  return (
                    <tr key={ep.id} className="hover:bg-zinc-50/50 transition-colors">
                      <td className="py-2.5 px-3">
                        <div className="font-semibold text-zinc-950 whitespace-nowrap" title={ep.model}>{formatShortModel(ep.model)}</div>
                        <div className="text-[11px] text-zinc-400 whitespace-nowrap">{ep.provider_name}</div>
                      </td>
                      <td className="py-2.5 px-3">
                        {ep.preferred_for_hard_requests ? (
                          <span className="inline-flex items-center rounded-md bg-purple-50 border border-purple-200 px-2 py-0.5 text-xs font-semibold text-purple-700 whitespace-nowrap">
                            {t('radar.pro_tier')}
                          </span>
                        ) : (
                          <span className="inline-flex items-center rounded-md bg-emerald-50 border border-emerald-200 px-2 py-0.5 text-xs font-semibold text-emerald-700 whitespace-nowrap">
                            {t('radar.flash_tier')}
                          </span>
                        )}
                      </td>
                      <td className="py-2.5 px-3">
                        <span className="font-mono font-bold text-zinc-900">{(ep.capability_score ?? 0.5).toFixed(2)}</span>
                      </td>
                      <td className="py-2.5 px-3">
                        <span className="font-mono font-semibold text-purple-700">{dna.code_logic}</span>
                      </td>
                      <td className="py-2.5 px-3">
                        <span className="font-mono font-semibold text-amber-600">{dna.reasoning_math}</span>
                      </td>
                      <td className="py-2.5 px-3">
                        <span className="font-mono text-zinc-700">{dna.agent_tools}</span>
                      </td>
                      <td className="py-2.5 px-3">
                        <span className="font-mono text-zinc-700">{dna.multilingual_nlp}</span>
                      </td>
                      <td className="py-2.5 px-3">
                        <span className="font-mono text-zinc-500">{ep.context_length ? `${(ep.context_length / 1000).toFixed(0)}k` : '128k'}</span>
                      </td>
                      <td className="py-2.5 px-3">
                        <span className="text-xs font-mono text-zinc-600">
                          {formatMoney(ep.input_price_per_1m)} / {formatMoney(ep.output_price_per_1m)}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 text-right">
                        <button
                          type="button"
                          onClick={() => setProbingEndpoint({ endpoint: ep, serviceId: ep.serviceId })}
                          className="inline-flex items-center justify-center rounded-lg p-1.5 text-purple-700 hover:bg-purple-50 transition-colors"
                          title={t('evaluation.run_probe')}
                        >
                          <Sparkles className="h-4 w-4" />
                        </button>
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </section>

      {probingEndpoint && (
        <ModelProbeModal
          endpoint={probingEndpoint.endpoint}
          serviceId={probingEndpoint.serviceId}
          onClose={() => setProbingEndpoint(null)}
          onSaved={() => {
            setProbingEndpoint(null)
            // Probe results change endpoint data; refreshing the shared list re-runs the
            // detail load, matching the previous full reload.
            void refresh()
          }}
        />
      )}
    </Page>
  )
}
