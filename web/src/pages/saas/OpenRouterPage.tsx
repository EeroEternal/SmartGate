import { useEffect, useState } from 'react'
import { Sparkles, RefreshCw, Search, ExternalLink, HelpCircle, ArrowDownRight, Zap, ShieldCheck } from 'lucide-react'
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

export default function OpenRouterPage() {
  const { t } = useI18n()
  const [models, setModels] = useState<MarketModel[]>([])
  const [stats, setStats] = useState<MarketStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [search, setSearch] = useState('')
  const [filterType, setFilterType] = useState('all') // 'all', 'free', 'discount'
  const [sortBy, setSortBy] = useState('smart') // 'smart', 'price_asc', 'discount_desc', 'context_desc'

  async function loadData() {
    setLoading(true)
    try {
      let query = `?sort=${sortBy}`
      if (filterType === 'free') query += '&free_only=true'
      if (filterType === 'discount') query += '&min_discount=0.01'
      if (search.trim()) query += `&search=${encodeURIComponent(search.trim())}`

      const res = await saasFetch<{ stats: MarketStats; models: MarketModel[] }>(`/api/saas/openrouter/market${query}`)
      if (res.data) {
        setStats(res.data.stats)
        setModels(res.data.models)
      }
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadData()
  }, [filterType, sortBy])

  async function handleSync() {
    setSyncing(true)
    try {
      await saasFetch('/api/saas/openrouter/sync', { method: 'POST' })
      await loadData()
    } catch (e) {
      console.error(e)
    } finally {
      setSyncing(false)
    }
  }

  function handleSearchSubmit(e: React.FormEvent) {
    e.preventDefault()
    loadData()
  }

  return (
    <div className="space-y-8">
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
          className="inline-flex items-center gap-2 rounded-lg border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-50 transition-colors shadow-sm"
        >
          <RefreshCw className={`h-4 w-4 ${syncing ? 'animate-spin' : ''}`} />
          {syncing ? t('openrouter.syncing') : t('openrouter.sync_catalog')}
        </button>
      </div>

      {/* Metrics Row */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-zinc-500 uppercase tracking-wider">
              {t('openrouter.stat_free_models')}
            </span>
            <span className="rounded-full bg-emerald-100 p-1.5 text-emerald-600">
              <Zap className="h-4 w-4" />
            </span>
          </div>
          <div className="mt-3 text-3xl font-bold font-mono text-emerald-600">
            {stats?.free_models ?? '—'}
          </div>
          <p className="mt-1 text-xs text-zinc-400">
            {t('openrouter.stat_free_models_hint')}
          </p>
        </div>

        <div className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-zinc-500 uppercase tracking-wider">
              {t('openrouter.stat_discounted')}
            </span>
            <span className="rounded-full bg-blue-100 p-1.5 text-blue-600">
              <ArrowDownRight className="h-4 w-4" />
            </span>
          </div>
          <div className="mt-3 text-3xl font-bold font-mono text-zinc-900">
            {stats?.discounted_models ?? '—'}
          </div>
          <p className="mt-1 text-xs text-zinc-400">
            {t('openrouter.stat_discounted_hint')}
          </p>
        </div>

        <div className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-zinc-500 uppercase tracking-wider">
              {t('openrouter.stat_total_indexed')}
            </span>
            <span className="rounded-full bg-zinc-100 p-1.5 text-zinc-600">
              <ShieldCheck className="h-4 w-4" />
            </span>
          </div>
          <div className="mt-3 text-3xl font-bold font-mono text-zinc-900">
            {stats?.total_models ?? '—'}
          </div>
          <p className="mt-1 text-xs text-zinc-400">
            {stats?.last_synced_at ? `${t('openrouter.last_synced')}: ${new Date(stats.last_synced_at).toLocaleTimeString()}` : '—'}
          </p>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-4 rounded-xl border border-zinc-200 bg-white p-4 shadow-sm">
        <form onSubmit={handleSearchSubmit} className="relative flex-1 w-full">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-zinc-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('openrouter.search_placeholder')}
            className="w-full rounded-lg border border-zinc-200 pl-9 pr-4 py-2 text-sm focus:border-zinc-900 focus:outline-none"
          />
        </form>

        <div className="flex items-center gap-3 w-full sm:w-auto">
          <div className="w-40">
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

          <div className="w-48">
            <Select
              selected={{
                id: sortBy,
                name: sortBy === 'price_asc' ? t('openrouter.sort_price_asc') : sortBy === 'discount_desc' ? t('openrouter.sort_discount_desc') : sortBy === 'context_desc' ? t('openrouter.sort_context_desc') : t('openrouter.sort_smart')
              }}
              onChange={(opt) => setSortBy(String(opt.id))}
              options={[
                { id: 'smart', name: t('openrouter.sort_smart') },
                { id: 'price_asc', name: t('openrouter.sort_price_asc') },
                { id: 'discount_desc', name: t('openrouter.sort_discount_desc') },
                { id: 'context_desc', name: t('openrouter.sort_context_desc') },
              ]}
              size="sm"
            />
          </div>
        </div>
      </div>

      {/* Models Grid / List */}
      {loading ? (
        <div className="py-20 text-center text-sm text-zinc-400">
          {t('common.loading')}
        </div>
      ) : models.length === 0 ? (
        <div className="rounded-xl border border-dashed border-zinc-300 bg-white p-12 text-center text-sm text-zinc-500">
          {t('openrouter.no_models_found')}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {models.map((model) => {
            const isFree = model.is_free === 1 || model.id.endsWith(':free')
            const discountPct = Math.round(model.discount_ratio * 100)

            return (
              <div
                key={model.id}
                className="flex flex-col justify-between rounded-xl border border-zinc-200 bg-white p-5 shadow-sm hover:border-zinc-300 transition-colors"
              >
                <div>
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="text-base font-semibold text-zinc-900">
                          {model.name}
                        </h3>
                        {isFree ? (
                          <span className="rounded-md bg-emerald-50 px-2 py-0.5 text-xs font-bold text-emerald-700 border border-emerald-200">
                            100% FREE
                          </span>
                        ) : discountPct > 0 ? (
                          <span className="rounded-md bg-rose-50 px-2 py-0.5 text-xs font-bold text-rose-700 border border-rose-200">
                            -{discountPct}% OFF
                          </span>
                        ) : null}
                      </div>
                      <div className="mt-1 font-mono text-xs text-zinc-400 break-all">
                        {model.id}
                      </div>
                    </div>
                    <a
                      href={`https://openrouter.ai/models/${model.id}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-zinc-400 hover:text-zinc-600 p-1"
                      title={t('common.learn_more')}
                    >
                      <ExternalLink className="h-4 w-4" />
                    </a>
                  </div>

                  {model.description && (
                    <p className="mt-3 text-xs text-zinc-600 line-clamp-2 leading-relaxed">
                      {model.description}
                    </p>
                  )}
                </div>

                <div className="mt-5 pt-4 border-t border-zinc-100 grid grid-cols-3 gap-2 text-xs">
                  <div>
                    <div className="text-zinc-400">{t('openrouter.prompt_price')}</div>
                    <div className="mt-1 font-semibold text-zinc-900">
                      {isFree ? (
                        <span className="text-emerald-600 font-bold">$0.00</span>
                      ) : (
                        `$${model.prompt_price_per_1m.toFixed(2)}/1M`
                      )}
                    </div>
                  </div>

                  <div>
                    <div className="text-zinc-400">{t('openrouter.completion_price')}</div>
                    <div className="mt-1 font-semibold text-zinc-900">
                      {isFree ? (
                        <span className="text-emerald-600 font-bold">$0.00</span>
                      ) : (
                        `$${model.completion_price_per_1m.toFixed(2)}/1M`
                      )}
                    </div>
                  </div>

                  <div>
                    <div className="text-zinc-400">{t('openrouter.context_length')}</div>
                    <div className="mt-1 font-semibold text-zinc-900 font-mono">
                      {(model.context_length / 1024).toFixed(0)}k
                    </div>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
