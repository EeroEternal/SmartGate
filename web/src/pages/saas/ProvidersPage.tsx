import { useEffect, useState } from 'react'
import { Plus, Server, CheckCircle2, AlertCircle, Trash2, Pencil, Zap, RefreshCw, HelpCircle, X, ShieldCheck } from 'lucide-react'
import { saasFetch } from '../../lib/saasApi'
import { useI18n } from '../../lib/i18n'
import Select from '../../components/Select'
import { useDialog } from '../../components/Dialog'

export type SaasProvider = {
  id: string
  name: string
  provider_type: string
  protocol: string
  base_url: string
  status: string
  endpoint_count: number
  created_at: string
}

const PRESET_PROVIDERS = [
  { id: 'openrouter', name: 'OpenRouter', base_url: 'https://openrouter.ai/api/v1', protocol: 'openai' },
  { id: 'deepseek', name: 'DeepSeek', base_url: 'https://api.deepseek.com/v1', protocol: 'openai' },
  { id: 'openai', name: 'OpenAI', base_url: 'https://api.openai.com/v1', protocol: 'openai' },
  { id: 'anthropic', name: 'Anthropic', base_url: 'https://api.anthropic.com/v1', protocol: 'anthropic' },
  { id: 'azure', name: 'Azure OpenAI', base_url: 'https://{resource}.openai.azure.com', protocol: 'openai' },
  { id: 'custom', name: 'Custom OpenAI-Compatible', base_url: 'https://api.example.com/v1', protocol: 'openai' },
]

export default function ProvidersPage() {
  const { t } = useI18n()
  const { dialog, showConfirm } = useDialog()
  const [providers, setProviders] = useState<SaasProvider[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [createModalOpen, setCreateModalOpen] = useState(false)
  const [editingProvider, setEditingProvider] = useState<SaasProvider | null>(null)

  async function loadData() {
    setLoading(true)
    setError('')
    try {
      const res = await saasFetch<SaasProvider[]>('/api/saas/providers')
      if (res.data) {
        setProviders(res.data)
      }
    } catch (e: any) {
      setError(e.message || 'Failed to load providers')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadData()
  }, [])

  async function handleDelete(provider: SaasProvider) {
    if (provider.endpoint_count > 0) {
      alert(t('providers.cannot_delete_has_endpoints', { count: provider.endpoint_count }) || `Cannot delete provider: ${provider.endpoint_count} model endpoints are currently linked to it.`)
      return
    }
    const confirmed = await showConfirm(
      t('providers.delete_confirm_desc', { name: provider.name }) || `Are you sure you want to delete ${provider.name}?`,
      t('providers.delete_title') || 'Delete Provider Account'
    )
    if (!confirmed) return

    try {
      await saasFetch(`/api/saas/providers/${provider.id}`, { method: 'DELETE' })
      loadData()
    } catch (e: any) {
      setError(e.message || 'Failed to delete provider')
    }
  }

  return (
    <div className="space-y-6">
      {dialog}
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-zinc-900">
            {t('nav.providers')}
          </h1>
          <p className="mt-1 text-sm text-zinc-500 max-w-2xl">
            {t('providers.subtitle')}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setCreateModalOpen(true)}
          className="inline-flex items-center gap-2 rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 shadow-sm transition-colors self-start sm:self-auto"
        >
          <Plus className="h-4 w-4" />
          {t('providers.connect_provider')}
        </button>
      </div>

      {error && (
        <div className="rounded-lg bg-rose-50 px-4 py-3 text-sm text-rose-700 border border-rose-200">
          {error}
        </div>
      )}

      {/* Provider List Grid */}
      {loading ? (
        <div className="py-20 text-center text-sm text-zinc-400">
          {t('common.loading')}
        </div>
      ) : providers.length === 0 ? (
        <div className="rounded-xl border border-dashed border-zinc-300 bg-white p-12 text-center text-sm text-zinc-500">
          <Server className="mx-auto h-8 w-8 text-zinc-300 mb-3" />
          <p className="font-medium text-zinc-700">{t('providers.no_providers')}</p>
          <p className="mt-1 text-xs text-zinc-400">{t('providers.no_providers_hint')}</p>
          <button
            type="button"
            onClick={() => setCreateModalOpen(true)}
            className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-zinc-900 px-3.5 py-2 text-xs font-medium text-white hover:bg-zinc-800"
          >
            <Plus className="h-3.5 w-3.5" />
            {t('providers.connect_first')}
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {providers.map((p) => {
            return (
              <div
                key={p.id}
                className="flex flex-col justify-between rounded-xl border border-zinc-200 bg-white p-5 shadow-sm hover:border-zinc-300 transition-colors"
              >
                <div>
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="text-base font-semibold text-zinc-900">{p.name}</h3>
                        <span className="rounded-md bg-zinc-100 px-2 py-0.5 text-[11px] font-medium text-zinc-700 uppercase">
                          {p.protocol}
                        </span>
                      </div>
                      <div className="mt-1 font-mono text-xs text-zinc-400 break-all">
                        {p.base_url}
                      </div>
                    </div>
                    <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700 border border-emerald-200">
                      {p.status}
                    </span>
                  </div>

                  <div className="mt-4 grid grid-cols-2 gap-2 text-xs">
                    <div className="rounded-lg bg-zinc-50 p-2.5 border border-zinc-100">
                      <div className="text-zinc-400 text-[11px]">{t('providers.bound_endpoints')}</div>
                      <div className="mt-0.5 text-lg font-bold text-zinc-900 font-mono">
                        {p.endpoint_count}
                      </div>
                    </div>
                    <div className="rounded-lg bg-zinc-50 p-2.5 border border-zinc-100">
                      <div className="text-zinc-400 text-[11px]">{t('providers.provider_type')}</div>
                      <div className="mt-0.5 text-xs font-semibold text-zinc-800 capitalize truncate">
                        {p.provider_type}
                      </div>
                    </div>
                  </div>
                </div>

                <div className="mt-5 pt-3.5 border-t border-zinc-100 flex items-center justify-between text-xs">
                  <span className="text-[11px] text-zinc-400">
                    {new Date(p.created_at).toLocaleDateString()}
                  </span>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => setEditingProvider(p)}
                      className="rounded p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-900 transition-colors"
                      title={t('common.edit')}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDelete(p)}
                      className="rounded p-1.5 text-zinc-400 hover:bg-rose-50 hover:text-rose-600 transition-colors"
                      title={t('common.delete')}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {createModalOpen && (
        <CreateProviderModal
          onClose={() => setCreateModalOpen(false)}
          onCreated={() => {
            setCreateModalOpen(false)
            loadData()
          }}
        />
      )}

      {editingProvider && (
        <EditProviderModal
          provider={editingProvider}
          onClose={() => setEditingProvider(null)}
          onUpdated={() => {
            setEditingProvider(null)
            loadData()
          }}
        />
      )}
    </div>
  )
}

function CreateProviderModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const { t } = useI18n()
  const [selectedPreset, setSelectedPreset] = useState(PRESET_PROVIDERS[0].id)
  const [name, setName] = useState(PRESET_PROVIDERS[0].name)
  const [baseUrl, setBaseUrl] = useState(PRESET_PROVIDERS[0].base_url)
  const [protocol, setProtocol] = useState(PRESET_PROVIDERS[0].protocol)
  const [apiKey, setApiKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [testStatus, setTestStatus] = useState<'idle' | 'testing' | 'passed' | 'failed'>('idle')
  const [testMsg, setTestMsg] = useState('')

  function handlePresetChange(presetId: string) {
    setSelectedPreset(presetId)
    const preset = PRESET_PROVIDERS.find((p) => p.id === presetId)
    if (preset) {
      setName(preset.name)
      setBaseUrl(preset.base_url)
      setProtocol(preset.protocol)
    }
  }

  async function handleTest() {
    if (!baseUrl.trim() || !apiKey.trim()) {
      setError('Base URL and API Key are required to test')
      return
    }
    setTestStatus('testing')
    setTestMsg('')
    try {
      const res = await saasFetch<{ passed?: boolean; message?: string }>('/api/saas/test-connection', {
        method: 'POST',
        body: JSON.stringify({
          protocol,
          base_url: baseUrl.trim(),
          api_key: apiKey.trim(),
          upstream_model_id: selectedPreset === 'anthropic'
            ? 'claude-3-5-sonnet-20241022'
            : selectedPreset === 'openrouter'
            ? 'deepseek/deepseek-chat'
            : 'gpt-4o-mini',
        }),
      })
      if (res.success && res.data?.passed !== false) {
        setTestStatus('passed')
        setTestMsg(res.data?.message || 'Provider connection verified!')
      } else {
        setTestStatus('failed')
        setTestMsg(res.message || 'Connection test failed')
      }
    } catch (e: any) {
      setTestStatus('failed')
      setTestMsg(e.message || 'Connection test failed')
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim() || !baseUrl.trim() || !apiKey.trim()) {
      setError('Name, Base URL and API Key are required')
      return
    }
    setBusy(true)
    setError('')
    try {
      await saasFetch('/api/saas/providers', {
        method: 'POST',
        body: JSON.stringify({
          name: name.trim(),
          provider_type: selectedPreset,
          protocol,
          base_url: baseUrl.trim(),
          api_key: apiKey.trim(),
        }),
      })
      onCreated()
    } catch (e: any) {
      setError(e.message || 'Failed to save provider')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-zinc-950/40 p-4" role="dialog" aria-modal="true">
      <form onSubmit={handleSubmit} className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl space-y-4">
        <div className="flex items-start justify-between gap-4 border-b border-zinc-100 pb-3">
          <div>
            <h2 className="text-lg font-semibold text-zinc-900">{t('providers.connect_provider')}</h2>
            <p className="text-xs text-zinc-500 mt-0.5">{t('providers.connect_provider_desc')}</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-900">
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Preset Select */}
        <div>
          <label className="block text-xs font-semibold uppercase tracking-wider text-zinc-600 mb-1.5">
            {t('providers.select_preset')}
          </label>
          <Select
            selected={{ id: selectedPreset, name: PRESET_PROVIDERS.find((p) => p.id === selectedPreset)?.name || selectedPreset }}
            onChange={(opt) => handlePresetChange(String(opt.id))}
            options={PRESET_PROVIDERS.map((p) => ({ id: p.id, name: p.name }))}
            size="sm"
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-zinc-700 mb-1">{t('common.name')}</label>
            <input
              required
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="OpenRouter Main"
              className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm focus:border-zinc-900 focus:outline-none"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-zinc-700 mb-1">{t('services.protocol_label') || 'Protocol'}</label>
            <Select
              selected={{ id: protocol, name: protocol === 'anthropic' ? 'Anthropic' : 'OpenAI' }}
              onChange={(opt) => setProtocol(String(opt.id))}
              options={[
                { id: 'openai', name: 'OpenAI' },
                { id: 'anthropic', name: 'Anthropic' },
              ]}
              size="sm"
            />
          </div>
        </div>

        <div>
          <label className="block text-xs font-medium text-zinc-700 mb-1">{t('services.base_url') || 'Base URL'}</label>
          <input
            required
            type="text"
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder="https://openrouter.ai/api/v1"
            className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm font-mono focus:border-zinc-900 focus:outline-none"
          />
        </div>

        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="block text-xs font-medium text-zinc-700">{t('services.api_key') || 'API Key'}</label>
            <button
              type="button"
              onClick={handleTest}
              disabled={testStatus === 'testing' || !baseUrl.trim() || !apiKey.trim()}
              className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:text-primary-hover disabled:text-zinc-400"
            >
              <Zap className={`h-3.5 w-3.5 ${testStatus === 'testing' ? 'animate-pulse text-amber-500' : ''}`} />
              {testStatus === 'testing' ? (t('services.testing') || 'Testing…') : (t('services.test_connection') || 'Test Key')}
            </button>
          </div>
          <input
            required
            type="password"
            value={apiKey}
            onChange={(e) => {
              setApiKey(e.target.value)
              setTestStatus('idle')
            }}
            placeholder="sk-or-v1-..."
            className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm focus:border-zinc-900 focus:outline-none"
          />
          {testStatus === 'passed' && (
            <div className="mt-1.5 flex items-center gap-1.5 text-xs text-emerald-600">
              <CheckCircle2 className="h-3.5 w-3.5" />
              <span>{testMsg}</span>
            </div>
          )}
          {testStatus === 'failed' && (
            <div className="mt-1.5 flex items-start gap-1.5 text-xs text-rose-600">
              <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
              <span>{testMsg}</span>
            </div>
          )}
        </div>

        {error && (
          <div className="rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700 border border-rose-200">
            {error}
          </div>
        )}

        <div className="flex justify-end gap-3 pt-3 border-t border-zinc-100">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-zinc-300 px-4 py-2 text-xs font-medium text-zinc-700 hover:bg-zinc-50"
          >
            {t('common.cancel')}
          </button>
          <button
            disabled={busy}
            type="submit"
            className="rounded-lg bg-zinc-900 px-4 py-2 text-xs font-medium text-white hover:bg-zinc-800 disabled:opacity-50"
          >
            {busy ? t('common.saving') : t('common.save')}
          </button>
        </div>
      </form>
    </div>
  )
}

function EditProviderModal({ provider, onClose, onUpdated }: { provider: SaasProvider; onClose: () => void; onUpdated: () => void }) {
  const { t } = useI18n()
  const [name, setName] = useState(provider.name)
  const [baseUrl, setBaseUrl] = useState(provider.base_url)
  const [protocol, setProtocol] = useState(provider.protocol)
  const [apiKey, setApiKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      await saasFetch(`/api/saas/providers/${provider.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          name: name.trim(),
          protocol,
          base_url: baseUrl.trim(),
          api_key: apiKey.trim() ? apiKey.trim() : undefined,
        }),
      })
      onUpdated()
    } catch (e: any) {
      setError(e.message || 'Failed to update provider')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-zinc-950/40 p-4" role="dialog" aria-modal="true">
      <form onSubmit={handleSubmit} className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl space-y-4">
        <div className="flex items-start justify-between gap-4 border-b border-zinc-100 pb-3">
          <div>
            <h2 className="text-lg font-semibold text-zinc-900">{t('providers.edit_provider')}</h2>
            <p className="text-xs text-zinc-500 mt-0.5">{provider.name}</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-900">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-zinc-700 mb-1">{t('common.name')}</label>
            <input
              required
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm focus:border-zinc-900 focus:outline-none"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-zinc-700 mb-1">{t('services.protocol_label') || 'Protocol'}</label>
            <Select
              selected={{ id: protocol, name: protocol === 'anthropic' ? 'Anthropic' : 'OpenAI' }}
              onChange={(opt) => setProtocol(String(opt.id))}
              options={[
                { id: 'openai', name: 'OpenAI' },
                { id: 'anthropic', name: 'Anthropic' },
              ]}
              size="sm"
            />
          </div>
        </div>

        <div>
          <label className="block text-xs font-medium text-zinc-700 mb-1">{t('services.base_url') || 'Base URL'}</label>
          <input
            required
            type="text"
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm font-mono focus:border-zinc-900 focus:outline-none"
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-zinc-700 mb-1">
            New API Key (Leave empty to keep existing key)
          </label>
          <input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="••••••••••••••••"
            className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm focus:border-zinc-900 focus:outline-none"
          />
        </div>

        {error && (
          <div className="rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700 border border-rose-200">
            {error}
          </div>
        )}

        <div className="flex justify-end gap-3 pt-3 border-t border-zinc-100">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-zinc-300 px-4 py-2 text-xs font-medium text-zinc-700 hover:bg-zinc-50"
          >
            {t('common.cancel')}
          </button>
          <button
            disabled={busy}
            type="submit"
            className="rounded-lg bg-zinc-900 px-4 py-2 text-xs font-medium text-white hover:bg-zinc-800 disabled:opacity-50"
          >
            {busy ? t('common.saving') : t('common.save')}
          </button>
        </div>
      </form>
    </div>
  )
}
