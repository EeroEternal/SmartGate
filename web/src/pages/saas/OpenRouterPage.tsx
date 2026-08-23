import { useEffect, useState } from 'react'
import { Sparkles, RefreshCw, Search, ExternalLink, ChevronLeft, ChevronRight, ArrowDownRight, Zap, ShieldCheck, Filter } from 'lucide-react'
import { saasFetch } from '../../lib/saasApi'
import { useI18n } from '../../lib/i18n'
import Select from '../../components/Select'

type MarketModel = {
  id: string
  name: string
  created_at: number | null
  description: string | null
  context_length: number
  prompt_price_per_1m: number
  completion_price_per_1m: number
  request_price: number
  image_price: number
  discount_ratio: number
  is_free: number
  top_provider_context_length: number | null
  top_provider_max_completion_tokens: number | null
  top_provider_is_moderated: number
  synced_at: string
}

type MarketStats = {
  total_models: number
  free_models: number
  discounted_models: number
  last_synced_at: string | null
}

type MarketResponse = {
  stats: MarketStats
  models: MarketModel[]
  total_count: number
  page: number
  page_size: number
  total_pages: number
}

export default function OpenRouterPage() {
  const { t } = useI18n()
  const [models, setModels] = useState<MarketModel[]>([])
  const [stats, setStats] = useState<MarketStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  
  // Multi-dimensional filters & Query
  const [search, setSearch] = useState('')
  const [filterType, setFilterType] = useState('all') // 'all', 'free', 'discount'
  const [contextFilter, setContextFilter] = useState('0') // '0', '32768', '131072', '200000'
  const [sortBy, setSortBy] = useState('smart') // 'smart', 'price_asc', 'price_desc', 'discount_desc', 'context_desc', 'newest'
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(12)
  const [totalCount, setTotalCount] = useState(0)
  const [totalPages, setTotalPages] = useState(1)

  async function loadData(targetPage = page) {
    setLoading(true)
    try {
      let query = `?sort=${sortBy}&page=${targetPage}&page_size=${pageSize}`
      if (filterType === 'free') query += '&free_only=true'
      if (filterType === 'discount') query += '&min_discount=0.01'
      if (Number(contextFilter) > 0) query += `&min_context=${contextFilter}`
      if (search.trim()) query += `&search=${encodeURIComponent(search.trim())}`

      const res = await saasFetch<MarketResponse>(`/api/saas/openrouter/market${query}`)
      if (res.data) {
        setStats(res.data.stats)
        setModels(res.data.models)
        setTotalCount(res.data.total_count)
        setPage(res.data.page)
        setTotalPages(res.data.total_pages)
      }
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    setPage(1)
    loadData(1)
  }, [filterType, contextFilter, sortBy, pageSize])

  async function handleSync() {
    setSyncing(true)
    try {
      await saasFetch('/api/saas/openrouter/sync', { method: 'POST' })
      await loadData(1)
    } catch (e) {
      console.error(e)
    } finally {
      setSyncing(false)
    }
  }

  function handleSearchSubmit(e: React.FormEvent) {
    e.preventDefault()
    setPage(1)
    loadData(1)
  }

  function handlePageChange(newPage: number) {
    if (newPage < 1 || newPage > totalPages || newPage === page) return
    setPage(newPage)
    loadData(newPage)
  }

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold tracking-tight text-zinc-900">
              {t('openrouter.title')}
            </h1>
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-semibold text-emerald-700 border border-emerald-200/60">
              <Sparkles className="h-3.5 w-3.5" />
              {t('openrouter.live_radar')}
            </span>
          </div>
          <p className="mt-1 text-sm text-zinc-500 max-w-2xl">
            {t('openrouter.subtitle')}
          </p>
        </div>
        <button
          type="button"
          onClick={handleSync}
          disabled={syncing}
          className="inline-flex items-center gap-2 rounded-lg border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-50 transition-colors shadow-sm self-start sm:self-auto"
        >
          <RefreshCw className={`h-4 w-4 ${syncing ? 'animate-spin' : ''}`} />
          {syncing ? t('openrouter.syncing') : t('openrouter.sync_catalog')}
        </button>
      </div>

      {/* Metrics Row */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-zinc-500 uppercase tracking-wider">
              {t('openrouter.stat_free_models')}
            </span>
            <span className="rounded-full bg-emerald-100 p-1 text-emerald-600">
              <Zap className="h-3.5 w-3.5" />
            </span>
          </div>
          <div className="mt-2 text-2xl font-bold font-mono text-emerald-600">
            {stats?.free_models ?? '—'}
          </div>
          <p className="mt-0.5 text-xs text-zinc-400">
            {t('openrouter.stat_free_models_hint')}
          </p>
        </div>

        <div className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-zinc-500 uppercase tracking-wider">
              {t('openrouter.stat_discounted')}
            </span>
            <span className="rounded-full bg-blue-100 p-1 text-blue-600">
              <ArrowDownRight className="h-3.5 w-3.5" />
            </span>
          </div>
          <div className="mt-2 text-2xl font-bold font-mono text-zinc-900">
            {stats?.discounted_models ?? '—'}
          </div>
          <p className="mt-0.5 text-xs text-zinc-400">
            {t('openrouter.stat_discounted_hint')}
          </p>
        </div>

        <div className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-zinc-500 uppercase tracking-wider">
              {t('openrouter.stat_total_indexed')}
            </span>
            <span className="rounded-full bg-zinc-100 p-1 text-zinc-600">
              <ShieldCheck className="h-3.5 w-3.5" />
            </span>
          </div>
          <div className="mt-2 text-2xl font-bold font-mono text-zinc-900">
            {stats?.total_models ?? '—'}
          </div>
          <p className="mt-0.5 text-xs text-zinc-400">
            {stats?.last_synced_at ? `${t('openrouter.last_synced')}: ${new Date(stats.last_synced_at).toLocaleTimeString()}` : '—'}
          </p>
        </div>
      </div>

      {/* Multi-dimensional Filters & Search Bar */}
      <div className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-zinc-700">
            <Filter className="h-3.5 w-3.5 text-zinc-500" />
            <span>{t('openrouter.multidim_filter')}</span>
          </div>
          <div className="text-xs text-zinc-400">
            {t('openrouter.page_info', { current: page, total: totalPages, count: totalCount })}
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {/* Keyword Search */}
          <form onSubmit={handleSearchSubmit} className="relative">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-zinc-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('openrouter.search_placeholder')}
              className="w-full rounded-md border border-zinc-200 pl-9 pr-3 py-1.5 text-xs focus:border-zinc-900 focus:outline-none"
            />
          </form>

          {/* Pricing / Discount Dimension */}
          <div>
            <Select
              selected={{
                id: filterType,
                name: filterType === 'free' ? t('openrouter.filter_free_only') : filterType === 'discount' ? t('openrouter.filter_discounted_only') : t('openrouter.filter_all')
              }}
              onChange={(opt) => setFilterType(String(opt.id))}
              options={[
                { id: 'all', name: t('openrouter.filter_all') },
                { id: 'free', name: t('openrouter.filter_free_only') },
                { id: 'discount', name: t('openrouter.filter_discounted_only') },
              ]}
              size="sm"
            />
          </div>

          {/* Context Window Dimension */}
          <div>
            <Select
              selected={{
                id: contextFilter,
                name: contextFilter === '32768' ? t('openrouter.filter_context_32k') : contextFilter === '131072' ? t('openrouter.filter_context_128k') : contextFilter === '200000' ? t('openrouter.filter_context_200k') : t('openrouter.filter_context_all')
              }}
              onChange={(opt) => setContextFilter(String(opt.id))}
              options={[
                { id: '0', name: t('openrouter.filter_context_all') },
                { id: '32768', name: t('openrouter.filter_context_32k') },
                { id: '131072', name: t('openrouter.filter_context_128k') },
                { id: '200000', name: t('openrouter.filter_context_200k') },
              ]}
              size="sm"
            />
          </div>

          {/* Sort Dimension */}
          <div>
            <Select
              selected={{
                id: sortBy,
                name: sortBy === 'price_asc' ? t('openrouter.sort_price_asc') : sortBy === 'price_desc' ? t('openrouter.sort_price_desc') : sortBy === 'discount_desc' ? t('openrouter.sort_discount_desc') : sortBy === 'context_desc' ? t('openrouter.sort_context_desc') : sortBy === 'newest' ? t('openrouter.sort_newest') : t('openrouter.sort_smart')
              }}
              onChange={(opt) => setSortBy(String(opt.id))}
              options={[
                { id: 'smart', name: t('openrouter.sort_smart') },
                { id: 'price_asc', name: t('openrouter.sort_price_asc') },
                { id: 'price_desc', name: t('openrouter.sort_price_desc') },
                { id: 'discount_desc', name: t('openrouter.sort_discount_desc') },
                { id: 'context_desc', name: t('openrouter.sort_context_desc') },
                { id: 'newest', name: t('openrouter.sort_newest') },
              ]}
              size="sm"
            />
          </div>
        </div>
      </div>

      {/* Models Grid (Clean 12 per page) */}
      {loading ? (
        <div className="py-20 text-center text-sm text-zinc-400">
          {t('common.loading')}
        </div>
      ) : models.length === 0 ? (
        <div className="rounded-xl border border-dashed border-zinc-300 bg-white p-12 text-center text-sm text-zinc-500">
          {t('openrouter.no_models_found')}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-3">
          {models.map((model) => {
            const isFree = model.is_free === 1 || model.id.endsWith(':free')
            const discountPct = Math.round(model.discount_ratio * 100)

            return (
              <div
                key={model.id}
                className="flex flex-col justify-between rounded-xl border border-zinc-200 bg-white p-4 shadow-sm hover:border-zinc-300 transition-colors"
              >
                <div>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <h3 className="text-sm font-semibold text-zinc-900 truncate" title={model.name}>
                          {model.name}
                        </h3>
                        {isFree ? (
                          <span className="rounded-md bg-emerald-50 px-1.5 py-0.5 text-[10px] font-bold text-emerald-700 border border-emerald-200">
                            100% FREE
                          </span>
                        ) : discountPct > 0 ? (
                          <span className="rounded-md bg-rose-50 px-1.5 py-0.5 text-[10px] font-bold text-rose-700 border border-rose-200">
                            -{discountPct}% OFF
                          </span>
                        ) : null}
                      </div>
                      <div className="mt-0.5 font-mono text-[11px] text-zinc-400 truncate" title={model.id}>
                        {model.id}
                      </div>
                    </div>
                    <a
                      href={`https://openrouter.ai/models/${model.id}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-zinc-400 hover:text-zinc-600 p-0.5"
                      title={t('common.learn_more')}
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                  </div>

                  {model.description && (
                    <p className="mt-2.5 text-[11px] text-zinc-500 line-clamp-2 leading-relaxed">
                      {model.description}
                    </p>
                  )}
                </div>

                <div className="mt-3.5 pt-3 border-t border-zinc-100 grid grid-cols-3 gap-1.5 text-[11px]">
                  <div>
                    <div className="text-zinc-400">{t('openrouter.prompt_price')}</div>
                    <div className="mt-0.5 font-medium text-zinc-900 font-mono">
                      {isFree ? (
                        <span className="text-emerald-600 font-bold">$0.00</span>
                      ) : (
                        `$${model.prompt_price_per_1m.toFixed(2)}`
                      )}
                    </div>
                  </div>

                  <div>
                    <div className="text-zinc-400">{t('openrouter.completion_price')}</div>
                    <div className="mt-0.5 font-medium text-zinc-900 font-mono">
                      {isFree ? (
                        <span className="text-emerald-600 font-bold">$0.00</span>
                      ) : (
                        `$${model.completion_price_per_1m.toFixed(2)}`
                      )}
                    </div>
                  </div>

                  <div>
                    <div className="text-zinc-400">{t('openrouter.context_length')}</div>
                    <div className="mt-0.5 font-medium text-zinc-900 font-mono">
                      {(model.context_length / 1024).toFixed(0)}k
                    </div>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Pagination Footer */}
      {totalPages > 1 && (
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4 pt-2">
          <div className="flex items-center gap-2">
            <span className="text-xs text-zinc-500">
              {t('openrouter.page_info', { current: page, total: totalPages, count: totalCount })}
            </span>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => handlePageChange(page - 1)}
              disabled={page <= 1}
              className="inline-flex items-center gap-1 rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-40 disabled:cursor-not-allowed shadow-sm transition-colors"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
              {t('pagination.prev')}
            </button>

            <span className="text-xs font-mono text-zinc-600 px-2">
              {page} / {totalPages}
            </span>

            <button
              type="button"
              onClick={() => handlePageChange(page + 1)}
              disabled={page >= totalPages}
              className="inline-flex items-center gap-1 rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-40 disabled:cursor-not-allowed shadow-sm transition-colors"
            >
              {t('pagination.next')}
              <ChevronRight className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
