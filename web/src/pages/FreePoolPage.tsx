import { useEffect, useState, useMemo, type FormEvent } from 'react'
import {
  Zap,
  Sparkles,
  RefreshCw,
  Search,
  Key,
  Sliders,
  CheckCircle2,
  Trash2,
  ExternalLink,
  Copy,
} from 'lucide-react'
import { adminFetch } from '../lib/api'
import { useI18n } from '../lib/i18n'
import { useDialog } from '../components/Dialog'
import HealthBadge from '../components/HealthBadge'

interface FreePoolConfigView {
  id: string
  enabled: boolean
  default_rpm_limit: number
  default_concurrency_limit: number
  default_daily_spend_limit: number
  max_keys_per_ip_per_hour: number
  pool_id: string
  project_id: string
  org_id: string
  has_openrouter_api_key: boolean
  created_at: string
  updated_at: string
}

interface FreePoolAdminStats {
  total_keys_issued: number
  active_keys: number
  requests_today: number
  tokens_today: number
  active_endpoints: number
}

interface FreeModelSummary {
  id: string
  name: string
  context_length: number
  is_free: boolean
}

interface EndpointItem {
  id: string
  name: string
  upstream_model_id: string
  enabled: boolean
  priority: number
  weight: number
  health_status: string
}

interface AdminFreePoolResponse {
  config: FreePoolConfigView
  stats: FreePoolAdminStats
  models: FreeModelSummary[]
  endpoints: EndpointItem[]
  openrouter_configured: boolean
}

interface AdminFreeKeyRow {
  id: string
  name: string
  key_prefix: string
  enabled: boolean
  rpm_limit: number | null
  concurrency_limit: number | null
  daily_spend_limit: number | null
  requests_today: number
  tokens_today: number
  last_used_at: string | null
  created_at: string
}

export default function FreePoolPage() {
  const { t } = useI18n()
  const { dialog, showAlert, showConfirm } = useDialog()

  const [loading, setLoading] = useState(true)
  const [data, setData] = useState<AdminFreePoolResponse | null>(null)
  const [keys, setKeys] = useState<AdminFreeKeyRow[]>([])
  const [search, setSearch] = useState('')
  const [savingSettings, setSavingSettings] = useState(false)
  const [syncingOpenRouter, setSyncingOpenRouter] = useState(false)
  const [copiedKeyId, setCopiedKeyId] = useState<string | null>(null)

  // Settings form states
  const [poolEnabled, setPoolEnabled] = useState(true)
  const [defaultRpm, setDefaultRpm] = useState(20)
  const [defaultConcurrency, setDefaultConcurrency] = useState(2)
  const [defaultDailySpend, setDefaultDailySpend] = useState(5.0)
  const [maxKeysIp, setMaxKeysIp] = useState(10)
  const [openRouterKey, setOpenRouterKey] = useState('')

  // Edit Key Modal
  const [editingKey, setEditingKey] = useState<AdminFreeKeyRow | null>(null)
  const [editRpm, setEditRpm] = useState(20)
  const [editConcurrency, setEditConcurrency] = useState(2)
  const [editDailySpend, setEditDailySpend] = useState(5.0)
  const [editEnabled, setEditEnabled] = useState(true)

  async function loadData() {
    try {
      const [poolRes, keysRes] = await Promise.all([
        adminFetch('/api/admin/free-pool'),
        adminFetch('/api/admin/free-pool/keys'),
      ])

      if (poolRes.success) {
        setData(poolRes.data)
        setPoolEnabled(poolRes.data.config.enabled)
        setDefaultRpm(poolRes.data.config.default_rpm_limit)
        setDefaultConcurrency(poolRes.data.config.default_concurrency_limit)
        setDefaultDailySpend(poolRes.data.config.default_daily_spend_limit)
        setMaxKeysIp(poolRes.data.config.max_keys_per_ip_per_hour)
      }

      if (keysRes.success) {
        setKeys(keysRes.data)
      }
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadData()
  }, [])

  async function handleSaveSettings(e: FormEvent) {
    e.preventDefault()
    setSavingSettings(true)
    try {
      const payload: Record<string, unknown> = {
        enabled: poolEnabled,
        default_rpm_limit: Number(defaultRpm),
        default_concurrency_limit: Number(defaultConcurrency),
        default_daily_spend_limit: Number(defaultDailySpend),
        max_keys_per_ip_per_hour: Number(maxKeysIp),
      }
      if (openRouterKey.trim()) {
        payload.openrouter_api_key = openRouterKey.trim()
      }

      const res = await adminFetch('/api/admin/free-pool/settings', {
        method: 'POST',
        body: JSON.stringify(payload),
      })

      if (res.success) {
        setOpenRouterKey('')
        await loadData()
        await showAlert(t('free_pool.settings_saved_success'), t('common.save'))
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : t('common.something_went_wrong')
      await showAlert(msg)
    } finally {
      setSavingSettings(false)
    }
  }

  async function handleSyncOpenRouter() {
    setSyncingOpenRouter(true)
    try {
      const res = await adminFetch('/api/admin/free-pool/sync-openrouter', {
        method: 'POST',
      })
      if (res.success) {
        await loadData()
        await showAlert(
          t('free_pool.openrouter_synced_desc', { count: res.data }),
          t('free_pool.openrouter_synced_title')
        )
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : t('common.something_went_wrong')
      await showAlert(msg)
    } finally {
      setSyncingOpenRouter(false)
    }
  }

  async function handleToggleKey(key: AdminFreeKeyRow) {
    try {
      await adminFetch(`/api/admin/free-pool/keys/${key.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ enabled: !key.enabled }),
      })
      await loadData()
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : t('common.something_went_wrong')
      await showAlert(msg)
    }
  }

  async function handleDeleteKey(key: AdminFreeKeyRow) {
    const ok = await showConfirm(
      t('free_pool.confirm_revoke_key', { name: key.name }),
      t('free_pool.revoke_key_title')
    )
    if (!ok) return

    try {
      await adminFetch(`/api/admin/free-pool/keys/${key.id}`, {
        method: 'DELETE',
      })
      await loadData()
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : t('common.something_went_wrong')
      await showAlert(msg)
    }
  }

  function openEditModal(key: AdminFreeKeyRow) {
    setEditingKey(key)
    setEditRpm(key.rpm_limit ?? 20)
    setEditConcurrency(key.concurrency_limit ?? 2)
    setEditDailySpend(key.daily_spend_limit ?? 5.0)
    setEditEnabled(key.enabled)
  }

  async function handleSaveKeyEdit(e: FormEvent) {
    e.preventDefault()
    if (!editingKey) return

    try {
      await adminFetch(`/api/admin/free-pool/keys/${editingKey.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          enabled: editEnabled,
          rpm_limit: Number(editRpm),
          concurrency_limit: Number(editConcurrency),
          daily_spend_limit: Number(editDailySpend),
        }),
      })
      setEditingKey(null)
      await loadData()
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : t('common.something_went_wrong')
      await showAlert(msg)
    }
  }

  function handleCopy(id: string, text: string) {
    navigator.clipboard.writeText(text)
    setCopiedKeyId(id)
    setTimeout(() => setCopiedKeyId(null), 2000)
  }

  const filteredKeys = useMemo(() => {
    if (!search.trim()) return keys
    const q = search.toLowerCase()
    return keys.filter(
      (k) =>
        k.name.toLowerCase().includes(q) ||
        k.key_prefix.toLowerCase().includes(q)
    )
  }, [keys, search])

  if (loading) {
    return (
      <div className="max-w-6xl mx-auto py-12 text-center text-sm text-zinc-500">
        {t('common.loading')}
      </div>
    )
  }

  return (
    <div className="max-w-6xl mx-auto space-y-8 font-sans pb-16">
      {dialog}

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-zinc-900 text-white">
              <Zap className="h-4 w-4" />
            </span>
            <h1 className="text-2xl font-bold tracking-tight text-zinc-900">
              {t('free_pool.title')}
            </h1>
          </div>
          <p className="mt-1 text-sm text-zinc-500">
            {t('free_pool.subtitle')}
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={loadData}
            className="inline-flex items-center gap-2 rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50 transition-colors"
          >
            <RefreshCw className="h-4 w-4" />
            {t('common.refresh')}
          </button>
        </div>
      </div>

      {/* Quick Statistics Banner */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        <div className="rounded-lg border border-zinc-200 bg-white p-4">
          <div className="text-xs text-zinc-500">{t('free_pool.stat_total_keys')}</div>
          <div className="mt-1 text-2xl font-bold font-mono text-zinc-900">
            {data?.stats.total_keys_issued ?? 0}
          </div>
        </div>
        <div className="rounded-lg border border-zinc-200 bg-white p-4">
          <div className="text-xs text-zinc-500">{t('free_pool.stat_active_keys')}</div>
          <div className="mt-1 text-2xl font-bold font-mono text-emerald-600">
            {data?.stats.active_keys ?? 0}
          </div>
        </div>
        <div className="rounded-lg border border-zinc-200 bg-white p-4">
          <div className="text-xs text-zinc-500">{t('free_pool.stat_requests_today')}</div>
          <div className="mt-1 text-2xl font-bold font-mono text-zinc-900">
            {data?.stats.requests_today ?? 0}
          </div>
        </div>
        <div className="rounded-lg border border-zinc-200 bg-white p-4">
          <div className="text-xs text-zinc-500">{t('free_pool.stat_tokens_today')}</div>
          <div className="mt-1 text-2xl font-bold font-mono text-zinc-900">
            {data?.stats.tokens_today ? (data.stats.tokens_today / 1000).toFixed(1) + 'k' : '0'}
          </div>
        </div>
        <div className="rounded-lg border border-zinc-200 bg-white p-4">
          <div className="text-xs text-zinc-500">{t('free_pool.stat_active_models')}</div>
          <div className="mt-1 text-2xl font-bold font-mono text-zinc-900">
            {data?.models.length ?? 0}
          </div>
        </div>
      </div>

      {/* Top 2 Columns: Quota Configuration & Upstream Sources */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Card 1: Default Quota Governance */}
        <div className="rounded-xl border border-zinc-200 bg-white p-6 shadow-sm flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between border-b border-zinc-100 pb-4">
              <div className="flex items-center gap-2">
                <Sliders className="h-5 w-5 text-zinc-800" />
                <h2 className="text-base font-semibold text-zinc-900">
                  {t('free_pool.quota_governance_title')}
                </h2>
              </div>
              <label className="flex items-center gap-2 cursor-pointer">
                <span className="text-xs text-zinc-500">
                  {poolEnabled ? t('free_pool.claiming_enabled') : t('free_pool.claiming_disabled')}
                </span>
                <input
                  type="checkbox"
                  checked={poolEnabled}
                  onChange={(e) => setPoolEnabled(e.target.checked)}
                  className="rounded border-zinc-300 text-zinc-900 focus:ring-black h-4 w-4"
                />
              </label>
            </div>

            <form onSubmit={handleSaveSettings} className="mt-5 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-zinc-700">
                    {t('free_pool.default_rpm_limit')}
                  </label>
                  <input
                    type="number"
                    min="1"
                    max="10000"
                    value={defaultRpm}
                    onChange={(e) => setDefaultRpm(Number(e.target.value))}
                    className="mt-1 w-full rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm h-9 focus:border-black focus:outline-none"
                    required
                  />
                  <p className="mt-1 text-[11px] text-zinc-400">
                    {t('free_pool.default_rpm_hint')}
                  </p>
                </div>

                <div>
                  <label className="block text-xs font-medium text-zinc-700">
                    {t('free_pool.default_concurrency_limit')}
                  </label>
                  <input
                    type="number"
                    min="1"
                    max="100"
                    value={defaultConcurrency}
                    onChange={(e) => setDefaultConcurrency(Number(e.target.value))}
                    className="mt-1 w-full rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm h-9 focus:border-black focus:outline-none"
                    required
                  />
                  <p className="mt-1 text-[11px] text-zinc-400">
                    {t('free_pool.default_concurrency_hint')}
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-zinc-700">
                    {t('free_pool.default_daily_spend_limit')}
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="0.5"
                    value={defaultDailySpend}
                    onChange={(e) => setDefaultDailySpend(Number(e.target.value))}
                    className="mt-1 w-full rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm h-9 focus:border-black focus:outline-none"
                    required
                  />
                  <p className="mt-1 text-[11px] text-zinc-400">
                    {t('free_pool.default_daily_spend_hint')}
                  </p>
                </div>

                <div>
                  <label className="block text-xs font-medium text-zinc-700">
                    {t('free_pool.max_keys_per_ip')}
                  </label>
                  <input
                    type="number"
                    min="1"
                    max="100"
                    value={maxKeysIp}
                    onChange={(e) => setMaxKeysIp(Number(e.target.value))}
                    className="mt-1 w-full rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm h-9 focus:border-black focus:outline-none"
                    required
                  />
                  <p className="mt-1 text-[11px] text-zinc-400">
                    {t('free_pool.max_keys_per_ip_hint')}
                  </p>
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-zinc-700">
                  {t('free_pool.openrouter_api_key')}
                </label>
                <div className="relative mt-1">
                  <input
                    type="password"
                    value={openRouterKey}
                    onChange={(e) => setOpenRouterKey(e.target.value)}
                    placeholder={
                      data?.openrouter_configured
                        ? t('free_pool.openrouter_key_configured')
                        : t('free_pool.openrouter_key_placeholder')
                    }
                    className="w-full rounded-md border border-zinc-300 bg-white pl-3 pr-10 py-1.5 text-sm h-9 focus:border-black focus:outline-none font-mono text-xs"
                  />
                  {data?.openrouter_configured && (
                    <span className="absolute right-3 top-2.5 flex items-center text-xs text-emerald-600 font-medium gap-1">
                      <CheckCircle2 className="h-4 w-4" />
                    </span>
                  )}
                </div>
                <p className="mt-1 text-[11px] text-zinc-400">
                  {t('free_pool.openrouter_key_hint')}
                </p>
              </div>

              <div className="pt-2 flex justify-end">
                <button
                  type="submit"
                  disabled={savingSettings}
                  className="rounded-md bg-zinc-950 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-50 transition-colors"
                >
                  {savingSettings ? t('common.saving') : t('common.save')}
                </button>
              </div>
            </form>
          </div>
        </div>

        {/* Card 2: Free Token Sources (OpenRouter & Custom) */}
        <div className="rounded-xl border border-zinc-200 bg-white p-6 shadow-sm flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between border-b border-zinc-100 pb-4">
              <div className="flex items-center gap-2">
                <Sparkles className="h-5 w-5 text-zinc-800" />
                <h2 className="text-base font-semibold text-zinc-900">
                  {t('free_pool.sources_title')}
                </h2>
              </div>
              <span className="rounded bg-zinc-100 px-2 py-0.5 text-xs text-zinc-600 font-mono">
                pool_free_tokens
              </span>
            </div>

            <div className="mt-5 space-y-4">
              {/* OpenRouter Sync Block */}
              <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-4">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="text-sm font-semibold text-zinc-900">
                        OpenRouter Free Catalog
                      </h3>
                      {data?.openrouter_configured ? (
                        <span className="rounded bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700 border border-emerald-200">
                          {t('free_pool.source_connected')}
                        </span>
                      ) : (
                        <span className="rounded bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700 border border-amber-200">
                          {t('free_pool.source_unauthenticated')}
                        </span>
                      )}
                    </div>
                    <p className="mt-1 text-xs text-zinc-500 leading-relaxed">
                      {t('free_pool.openrouter_sync_desc')}
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={handleSyncOpenRouter}
                    disabled={syncingOpenRouter}
                    className="shrink-0 inline-flex items-center gap-1.5 rounded-md bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-zinc-800 disabled:opacity-50 transition-colors"
                  >
                    <RefreshCw className={`h-3.5 w-3.5 ${syncingOpenRouter ? 'animate-spin' : ''}`} />
                    {syncingOpenRouter ? t('common.loading') : t('free_pool.sync_openrouter_btn')}
                  </button>
                </div>
              </div>

              {/* Bound Physical Endpoints */}
              <div>
                <div className="flex items-center justify-between text-xs text-zinc-500 mb-2">
                  <span>{t('free_pool.bound_endpoints_count', { count: data?.endpoints.length ?? 0 })}</span>
                  <a
                    href="/admin/providers"
                    className="text-zinc-700 hover:text-black hover:underline inline-flex items-center gap-1"
                  >
                    {t('free_pool.add_custom_provider')} <ExternalLink className="h-3 w-3" />
                  </a>
                </div>

                <div className="max-h-48 overflow-y-auto rounded-lg border border-zinc-200 divide-y divide-zinc-100">
                  {data?.endpoints && data.endpoints.length > 0 ? (
                    data.endpoints.map((ep) => (
                      <div key={ep.id} className="p-2.5 flex items-center justify-between text-xs bg-white">
                        <div className="min-w-0 pr-3">
                          <div className="font-medium text-zinc-900 truncate" title={ep.name}>
                            {ep.name}
                          </div>
                          <div className="font-mono text-[10px] text-zinc-400 truncate" title={ep.upstream_model_id}>
                            {ep.upstream_model_id}
                          </div>
                        </div>
                        <div className="shrink-0 flex items-center gap-2">
                          <HealthBadge status={ep.health_status} />
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="p-4 text-center text-xs text-zinc-400">
                      {t('free_pool.no_endpoints_bound')}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Card 3: Issued Free Keys Table */}
      <div className="rounded-xl border border-zinc-200 bg-white p-6 shadow-sm space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <Key className="h-5 w-5 text-zinc-800" />
              <h2 className="text-base font-semibold text-zinc-900">
                {t('free_pool.issued_keys_title')}
              </h2>
            </div>
            <p className="mt-1 text-xs text-zinc-500">
              {t('free_pool.issued_keys_subtitle')}
            </p>
          </div>

          <div className="relative w-full sm:w-64">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-zinc-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('free_pool.search_keys_placeholder')}
              className="w-full rounded-md border border-zinc-200 pl-9 pr-3 py-1.5 text-xs h-9 focus:border-black focus:outline-none"
            />
          </div>
        </div>

        <div className="overflow-x-auto rounded-lg border border-zinc-200">
          <table className="min-w-full divide-y divide-zinc-200 text-left text-xs">
            <thead className="bg-zinc-50 text-zinc-500">
              <tr>
                <th className="px-4 py-3 font-medium">{t('free_pool.col_prefix')}</th>
                <th className="px-4 py-3 font-medium">{t('common.name')}</th>
                <th className="px-4 py-3 font-medium">{t('free_pool.col_limits')}</th>
                <th className="px-4 py-3 font-medium">{t('free_pool.col_usage_today')}</th>
                <th className="px-4 py-3 font-medium">{t('common.created_at')}</th>
                <th className="px-4 py-3 font-medium">{t('common.status')}</th>
                <th className="px-4 py-3 font-medium text-right">{t('common.actions')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 bg-white">
              {filteredKeys.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-zinc-400">
                    {t('free_pool.no_keys_found')}
                  </td>
                </tr>
              ) : (
                filteredKeys.map((k) => (
                  <tr key={k.id} className="hover:bg-zinc-50 transition-colors">
                    <td className="px-4 py-3 font-mono font-medium text-zinc-900 whitespace-nowrap">
                      <div className="flex items-center gap-1.5">
                        <span>{k.key_prefix}</span>
                        <button
                          type="button"
                          onClick={() => handleCopy(k.id, k.key_prefix)}
                          className="text-zinc-400 hover:text-black p-0.5"
                          title={t('common.copy')}
                        >
                          <Copy className="h-3 w-3" />
                        </button>
                        {copiedKeyId === k.id && (
                          <span className="text-[10px] text-emerald-600 font-sans">
                            {t('common.copied')}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-zinc-700 max-w-[200px] truncate" title={k.name}>
                      {k.name}
                    </td>
                    <td className="px-4 py-3 text-zinc-600 font-mono whitespace-nowrap">
                      <div className="space-y-0.5">
                        <div>{k.rpm_limit ?? '—'} RPM</div>
                        <div className="text-[10px] text-zinc-400">
                          {k.concurrency_limit ?? '—'} conc / ${k.daily_spend_limit?.toFixed(2) ?? '—'}/d
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-zinc-600 font-mono whitespace-nowrap">
                      <div>{k.requests_today} reqs</div>
                      <div className="text-[10px] text-zinc-400">
                        {(k.tokens_today / 1000).toFixed(1)}k tokens
                      </div>
                    </td>
                    <td className="px-4 py-3 text-zinc-500 whitespace-nowrap">
                      {new Date(k.created_at).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <span
                        className={`inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-medium ${
                          k.enabled
                            ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                            : 'bg-zinc-100 text-zinc-600 border border-zinc-200'
                        }`}
                      >
                        {k.enabled ? t('common.active') : t('common.disabled')}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => handleToggleKey(k)}
                          className="rounded px-2 py-1 text-xs border border-zinc-200 text-zinc-600 hover:bg-zinc-100 hover:text-black transition-colors"
                        >
                          {k.enabled ? t('common.disable') : t('common.enable')}
                        </button>
                        <button
                          type="button"
                          onClick={() => openEditModal(k)}
                          className="rounded px-2 py-1 text-xs border border-zinc-200 text-zinc-600 hover:bg-zinc-100 hover:text-black transition-colors"
                        >
                          {t('common.edit')}
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteKey(k)}
                          className="p-1 text-zinc-400 hover:text-rose-600 rounded transition-colors"
                          title={t('common.delete')}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Edit Quota Modal */}
      {editingKey && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-xl border border-zinc-200 bg-white p-6 shadow-xl space-y-4">
            <div className="flex items-center justify-between border-b border-zinc-100 pb-3">
              <h3 className="text-base font-semibold text-zinc-900">
                {t('free_pool.edit_key_title')}
              </h3>
              <button
                type="button"
                onClick={() => setEditingKey(null)}
                className="text-zinc-400 hover:text-black text-sm"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSaveKeyEdit} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-zinc-700">
                  {t('common.name')}
                </label>
                <div className="mt-1 font-mono text-xs text-zinc-500 bg-zinc-50 p-2 rounded border border-zinc-200">
                  {editingKey.name}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-zinc-700">
                    RPM Limit
                  </label>
                  <input
                    type="number"
                    min="1"
                    value={editRpm}
                    onChange={(e) => setEditRpm(Number(e.target.value))}
                    className="mt-1 w-full rounded-md border border-zinc-300 p-2 text-sm h-9 focus:border-black focus:outline-none"
                    required
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-zinc-700">
                    Concurrency
                  </label>
                  <input
                    type="number"
                    min="1"
                    value={editConcurrency}
                    onChange={(e) => setEditConcurrency(Number(e.target.value))}
                    className="mt-1 w-full rounded-md border border-zinc-300 p-2 text-sm h-9 focus:border-black focus:outline-none"
                    required
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-zinc-700">
                  Daily Spend Limit ($)
                </label>
                <input
                  type="number"
                  min="0"
                  step="0.5"
                  value={editDailySpend}
                  onChange={(e) => setEditDailySpend(Number(e.target.value))}
                  className="mt-1 w-full rounded-md border border-zinc-300 p-2 text-sm h-9 focus:border-black focus:outline-none"
                  required
                />
              </div>

              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="key-enabled-toggle"
                  checked={editEnabled}
                  onChange={(e) => setEditEnabled(e.target.checked)}
                  className="rounded border-zinc-300 text-black h-4 w-4"
                />
                <label htmlFor="key-enabled-toggle" className="text-xs font-medium text-zinc-700 cursor-pointer">
                  {t('free_pool.key_enabled')}
                </label>
              </div>

              <div className="pt-3 flex justify-end gap-2 border-t border-zinc-100">
                <button
                  type="button"
                  onClick={() => setEditingKey(null)}
                  className="rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
                >
                  {t('common.cancel')}
                </button>
                <button
                  type="submit"
                  className="rounded-md bg-zinc-950 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800"
                >
                  {t('common.save')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
