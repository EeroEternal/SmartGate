import { FormEvent, useEffect, useMemo, useState } from 'react'
import { AlertCircle, CheckCircle2, ChevronDown, ChevronRight, Copy, Eye, EyeOff, HelpCircle, Pencil, Plus, Search, ShieldCheck, Sparkles, Trash2, X, Zap } from 'lucide-react'
import { Link, useParams } from 'react-router-dom'
import { saasFetch } from '../../lib/saasApi'
import Select from '../../components/Select'
import { useDialog } from '../../components/Dialog'
import { useI18n } from '../../lib/i18n'
import { ErrorMessage, Field, Page, errorText } from './components'
import { callExample, catalogProviderPrefixes, computeBundleSelection, emptyEndpoint, filterCatalogModels, formatPriceInput, inferDefaultCapability, routingInfo, searchScore } from './serviceUtils'
import { StrategyMatrixCardSelector, WorkloadPresetSelector } from './ServiceSelectors'
import type { SaasProvider } from './ProvidersPage'
import type { CallApi, CatalogOffering, CatalogProvider, DraftEndpoint, ModelDna, Service, ServiceDetails, ServiceEndpoint } from './types'

export function ServiceDetailsPage() {
  const { t } = useI18n()
  const { id } = useParams()
  const [service, setService] = useState<ServiceDetails | null>(null)
  const [catalog, setCatalog] = useState<CatalogOffering[]>([])
  const [error, setError] = useState('')
  const [modalOpen, setModalOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const [editingEndpoint, setEditingEndpoint] = useState<ServiceEndpoint | null>(null)
  const [probingEndpoint, setProbingEndpoint] = useState<ServiceEndpoint | null>(null)
  const [testingEndpoint, setTestingEndpoint] = useState<string | null>(null)
  const [testResults, setTestResults] = useState<Record<string, 'passed' | 'failed'>>({})
  const [testToast, setTestToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null)
  const [callApi, setCallApi] = useState<CallApi>('openai-chat')
  const [callOpen, setCallOpen] = useState(false)
  const [routingOpen, setRoutingOpen] = useState(false)
  const { dialog, showConfirm } = useDialog()
  const load = () => {
    if (!id) return
    saasFetch<ServiceDetails>(`/api/saas/model-services/${id}`).then((result) => { setService(result.data || null) }).catch((e: unknown) => setError(errorText(e)))
  }
  useEffect(() => {
    load()
    saasFetch<{ offerings?: CatalogOffering[]; providers?: CatalogProvider[] }>('/api/saas/model-catalog').then((result) => {
      setCatalog(result.data?.offerings?.length ? result.data.offerings : result.data?.providers?.flatMap((provider) => provider.models) || [])
    }).catch(() => {})
  }, [id])
  async function removeEndpoint(endpointId: string) {
    if (!id || !await showConfirm(t('services.remove_provider_confirm'), t('services.remove_model'))) return
    try { await saasFetch(`/api/saas/model-services/${id}/endpoints/${endpointId}`, { method: 'DELETE' }); load() } catch (e) { setError(errorText(e)) }
  }
  async function copyServiceName() {
    if (!service?.name) return
    await navigator.clipboard.writeText(service.name)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1800)
  }
  async function testEndpoint(endpointId: string) {
    if (!id) return
    setTestingEndpoint(endpointId)
    setTestToast(null)
    try {
      await saasFetch(`/api/saas/model-services/${id}/endpoints/${endpointId}`, { method: 'POST' })
      setTestResults((results) => ({ ...results, [endpointId]: 'passed' }))
      setTestToast({ type: 'success', message: 'Connection verified successfully' })
      window.setTimeout(() => setTestToast(null), 5000)
    } catch (e) {
      setTestResults((results) => ({ ...results, [endpointId]: 'failed' }))
      setTestToast({ type: 'error', message: `Connection failed: ${errorText(e)}` })
      window.setTimeout(() => setTestToast(null), 12000)
    } finally {
      setTestingEndpoint(null)
    }
  }
  const providers = Array.from(new Map(catalog.map((item) => [item.provider_id, { id: item.provider_id, name: item.provider_name, modelCount: new Set(catalog.filter((model) => model.provider_id === item.provider_id).map((model) => model.model)).size }])).values())
  const routing = service ? routingInfo(service.strategy, t) : null
  return <Page>
    {dialog}
    {error && <ErrorMessage text={error} />}
    {testToast && (
      <div
        className={`fixed right-6 top-6 z-50 flex max-w-md items-start justify-between gap-3 rounded-xl border p-4 shadow-xl backdrop-blur transition-all ${
          testToast.type === 'success'
            ? 'border-emerald-200 bg-emerald-50/95 text-emerald-900'
            : 'border-rose-200 bg-rose-50/95 text-rose-900'
        }`}
        role="status"
      >
        <div className="flex items-start gap-2.5 min-w-0">
          <span
            className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${
              testToast.type === 'success' ? 'bg-emerald-500' : 'bg-rose-500'
            }`}
          />
          <div className="text-xs leading-5 break-words font-medium">{testToast.message}</div>
        </div>
        <div className="flex items-center gap-1 shrink-0 -mr-1">
          <button
            type="button"
            onClick={() => navigator.clipboard.writeText(testToast.message)}
            className="rounded-md p-1 text-zinc-500 hover:bg-black/5 hover:text-zinc-900 transition-colors"
            title={t('common.copy_message')}
          >
            <Copy className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => setTestToast(null)}
            className="rounded-md p-1 text-zinc-500 hover:bg-black/5 hover:text-zinc-900 transition-colors"
            title={t('common.close')}
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    )}
    {!service ? <div className="rounded-xl border border-zinc-200 bg-white p-6 text-sm text-zinc-500">{t('common.loading')}</div> : <div className="max-w-4xl space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <Link to="/app/services" className="text-sm text-zinc-500 hover:text-zinc-950">← {t('nav.model_services')}</Link>
          <div className="mt-3 flex min-w-0 flex-wrap items-center gap-2">
            <h1 className="truncate text-xl font-semibold tracking-tight">{service.name}</h1>
            <button type="button" onClick={() => setRoutingOpen(true)} className="rounded-md p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-950" title={t('services.edit_name')}>
              <Pencil className="h-4 w-4" />
            </button>
            <button type="button" onClick={copyServiceName} className="rounded-md p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-950" title={t('common.copy')}>
              <Copy className="h-4 w-4" />
            </button>
            {copied && <span className="text-xs font-medium text-emerald-600">{t('common.copied')}</span>}
            <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${service.status === 'draft' ? 'border border-amber-200 bg-amber-50 text-amber-700' : 'border border-emerald-200 bg-emerald-50 text-emerald-700'}`}>
              {service.status === 'draft' ? (t('services.setup_needed')) : (t('services.ready'))}
            </span>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
            <button
              type="button"
              onClick={() => setRoutingOpen(true)}
              className="inline-flex items-center gap-1 rounded-md border border-zinc-200 bg-white px-2 py-1 text-zinc-600 hover:border-zinc-300 hover:text-zinc-950"
              title={t('services.edit_routing_title')}
            >
              <span>{routing?.label}</span>
              <Pencil className="h-3 w-3 text-zinc-400" />
            </button>
            {service.strategy === 'capability_aware' && service.judge_enabled && (
              <span className="text-emerald-600">
                {t('services.judge_status', { model: service.endpoints.find((ep) => ep.id === service.judge_endpoint_id)?.model || t('services.judge_model_fallback') })}
              </span>
            )}
            <button
              type="button"
              onClick={() => setCallOpen((open) => !open)}
              className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 ${callOpen ? 'border-zinc-300 bg-zinc-50 text-zinc-950' : 'border-zinc-200 bg-white text-zinc-600 hover:border-zinc-300 hover:text-zinc-950'}`}
              aria-expanded={callOpen}
            >
              <span>{t('services.how_to_call')}</span>
              <span title={t('services.how_to_call_hint')}>
                <HelpCircle className="h-3 w-3 text-zinc-400" />
              </span>
              {callOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
            </button>
          </div>
        </div>
        <button type="button" onClick={() => setModalOpen(true)} className="inline-flex items-center gap-2 rounded-lg bg-zinc-950 px-4 py-2.5 text-sm text-white shadow-sm hover:bg-zinc-800 transition-colors">
          <Plus className="h-4 w-4" /> {t('services.add_model')}
        </button>
      </div>

      {callOpen && <CallExamplePanel api={callApi} model={service.name} onChange={setCallApi} />}

      <div className="rounded-xl border border-zinc-200 bg-white p-5">
        <div className="flex items-center justify-between gap-3">
          <h2 className="font-semibold">{t('services.connected_models')}</h2>
          <span className="text-xs text-zinc-400">
            {service.endpoints.length === 1
              ? (t('services.providers_connected_single'))
              : t('services.providers_connected', { count: service.endpoints.length }) || `${service.endpoints.length} models connected`}
          </span>
        </div>
        {service.endpoints.length ? (
          <div className="mt-4 space-y-3">
            {service.endpoints.map((endpoint) => (
              <div key={endpoint.id} className="rounded-lg border border-zinc-200 p-4 hover:border-zinc-300 transition-colors">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="truncate font-medium text-zinc-950">{endpoint.model}</div>
                    <div className="mt-1 text-sm text-zinc-500">{endpoint.provider_name}</div>
                    <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                      <span className="text-zinc-400">
                        {t('services.capability')} {(endpoint.capability_score ?? 0.5).toFixed(2)}
                      </span>
                      {endpoint.configured_capability_score != null && Math.abs(endpoint.configured_capability_score - (endpoint.capability_score ?? 0)) > 0.005 && (
                        <span className="rounded-md border border-zinc-200 bg-zinc-100 px-1.5 py-0.5 font-medium text-zinc-500">
                          auto
                        </span>
                      )}
                      {endpoint.preferred_for_hard_requests && (
                        <span className="rounded-md border border-purple-200 bg-purple-50 px-1.5 py-0.5 font-medium text-purple-700">
                          {t('services.routes_hard')}
                        </span>
                      )}
                      {endpoint.enabled === false && (
                        <span className="rounded-md border border-zinc-200 bg-zinc-100 px-1.5 py-0.5 font-medium text-zinc-600">
                          {t('common.disabled')}
                        </span>
                      )}
                      {endpoint.health_status && endpoint.health_status !== 'healthy' && (
                        <span className="rounded-md border border-rose-200 bg-rose-50 px-1.5 py-0.5 font-medium text-rose-700">
                          {endpoint.cooling_down ? (t('services.cooling_down')) : endpoint.health_status}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <button type="button" onClick={() => setProbingEndpoint(endpoint)} className="rounded-md p-2 text-zinc-400 hover:bg-purple-50 hover:text-purple-600 transition-colors" title={t('services.probe_button')}>
                      <Sparkles className="h-4 w-4" />
                    </button>
                    <button type="button" onClick={() => setEditingEndpoint(endpoint)} className="rounded-md p-2 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-950 transition-colors" title={t('services.edit_model')}>
                      <Pencil className="h-4 w-4" />
                    </button>
                    <button type="button" onClick={() => testEndpoint(endpoint.id)} disabled={testingEndpoint === endpoint.id} className={`rounded-md p-2 transition-colors disabled:opacity-50 ${testingEndpoint === endpoint.id ? 'animate-pulse text-zinc-400' : testResults[endpoint.id] === 'passed' ? 'text-emerald-500 hover:bg-emerald-50' : testResults[endpoint.id] === 'failed' ? 'text-rose-500 hover:bg-rose-50' : 'text-zinc-400 hover:bg-zinc-100 hover:text-zinc-950'}`} title={t('services.test_connection')}>
                      <Zap className="h-4 w-4" />
                    </button>
                    <button type="button" onClick={() => removeEndpoint(endpoint.id)} className="rounded-md p-2 text-zinc-400 hover:bg-rose-50 hover:text-rose-600 transition-colors" title={t('services.remove_model')}>
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="mt-4 rounded-lg border border-dashed border-zinc-300 px-5 py-8 text-center">
            <p className="text-sm text-zinc-500">{t('services.no_models_connected')}</p>
            <button type="button" onClick={() => setModalOpen(true)} className="mt-3 text-sm font-medium text-primary hover:text-primary-hover">
              {t('services.add_model')}
            </button>
          </div>
        )}
      </div>
    </div>}
    {modalOpen && <AddModelModal catalog={catalog} providers={providers} serviceId={id || ''} onClose={() => setModalOpen(false)} onSaved={() => { setModalOpen(false); load() }} />}
    {routingOpen && service && <EditRoutingModal service={service} onClose={() => setRoutingOpen(false)} onSaved={() => { setRoutingOpen(false); load() }} />}
    {editingEndpoint && <EditProviderModal endpoint={editingEndpoint} serviceId={id || ''} onClose={() => setEditingEndpoint(null)} onSaved={() => { setEditingEndpoint(null); load() }} />}
    {probingEndpoint && <ModelProbeModal endpoint={probingEndpoint} serviceId={id || ''} onClose={() => setProbingEndpoint(null)} onSaved={() => { setProbingEndpoint(null); load() }} />}
  </Page>
}
function CallExamplePanel({ api, model, onChange }: { api: CallApi; model: string; onChange: (api: CallApi) => void }) {
  const { t } = useI18n()
  const example = callExample(api, model)
  const command = [`curl ${example.path} \\`, ...example.headers.map((header) => `  -H "${header}" \\`), `  -d '${example.body}'`].join('\n')
  const [copied, setCopied] = useState(false)
  const tabs: { id: CallApi; label: string }[] = [
    { id: 'openai-chat', label: 'OpenAI Chat' },
    { id: 'openai-responses', label: 'OpenAI Responses' },
    { id: 'anthropic-messages', label: 'Anthropic Messages' },
  ]
  async function copyExample() {
    await navigator.clipboard.writeText(command)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1800)
  }
  return (
    <section className="rounded-xl border border-zinc-200 bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex rounded-lg border border-zinc-200 bg-zinc-50 p-1" role="tablist" aria-label="API examples">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={api === tab.id}
              onClick={() => onChange(tab.id)}
              className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                api === tab.id ? 'bg-white text-zinc-950 shadow-sm' : 'text-zinc-500 hover:text-zinc-950'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={copyExample}
          className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-zinc-600 hover:bg-zinc-100 hover:text-zinc-950"
          title={t('common.copy')}
        >
          {copied ? <CheckCircle2 className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
          {copied ? (t('common.copied')) : (t('common.copy'))}
        </button>
      </div>
      <pre role="tabpanel" className="mt-3 whitespace-pre-wrap break-words rounded-lg bg-[var(--color-primary-soft)] p-3 text-xs leading-6 text-zinc-950">{command}</pre>
    </section>
  )
}

function EditRoutingModal({ service, onClose, onSaved }: { service: ServiceDetails; onClose: () => void; onSaved: () => void }) {
  const { t } = useI18n()
  const [serviceName, setServiceName] = useState(service.name)
  const [nextStrategy, setNextStrategy] = useState(service.strategy)
  const [preset, setPreset] = useState('coding')
  const [judgeEnabled, setJudgeEnabled] = useState(Boolean(service.judge_enabled))
  const [judgeEndpointId, setJudgeEndpointId] = useState(service.judge_endpoint_id || service.endpoints[0]?.id || '')
  const [shadowEnabled, setShadowEnabled] = useState(Boolean(service.shadow_enabled))
  const [shadowSampleRate, setShadowSampleRate] = useState(service.shadow_sample_rate != null ? Math.round(service.shadow_sample_rate * 100) : 5)
  const [shadowVirtualModelId, setShadowVirtualModelId] = useState(service.shadow_virtual_model_id || '')
  const [serviceOptions, setServiceOptions] = useState<{ id: string; name: string }[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    saasFetch<Service[]>('/api/saas/model-services')
      .then((res) => {
        if (cancelled) return
        setServiceOptions((res.data || []).filter((svc) => svc.id !== service.id).map((svc) => ({ id: svc.name, name: svc.name })))
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [service.id])

  const judgeOptions = service.endpoints.map((ep) => ({
    id: ep.id,
    name: `${ep.provider_name} - ${ep.model}${ep.input_price_per_1m != null ? ` ($${ep.input_price_per_1m.toFixed(2)}/1M)` : ''}`,
  }))
  const selectedJudge = judgeOptions.find((opt) => opt.id === judgeEndpointId) || judgeOptions[0] || { id: '', name: 'No endpoints available' }
  const selectedShadowTarget = serviceOptions.find((opt) => opt.id === shadowVirtualModelId) || serviceOptions[0]

  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError('')
    try {
      await saasFetch(`/api/saas/model-services/${service.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          name: serviceName.trim() ? serviceName.trim() : undefined,
          strategy: nextStrategy,
          judge_enabled: nextStrategy === 'capability_aware' ? judgeEnabled : false,
          judge_endpoint_id: nextStrategy === 'capability_aware' && judgeEnabled ? (selectedJudge.id || undefined) : undefined,
          shadow_enabled: shadowEnabled,
          shadow_virtual_model_id: shadowEnabled ? (selectedShadowTarget?.id || undefined) : undefined,
          shadow_sample_rate: shadowEnabled ? (shadowSampleRate / 100) : 0,
        }),
      })
      onSaved()
    } catch (e) { setError(errorText(e)) } finally { setBusy(false) }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/40 p-4 backdrop-blur-xs overflow-y-auto" role="dialog" aria-modal="true">
      <form onSubmit={submit} className="w-full max-w-2xl rounded-2xl bg-white p-5 shadow-2xl space-y-4 my-8 max-h-[90vh] overflow-y-auto">
        <div className="flex items-start justify-between gap-4 border-b border-zinc-100 pb-3">
          <div>
            <h2 className="text-lg font-semibold text-zinc-950">{t('services.edit_routing_title')}</h2>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-950" aria-label="Close">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div>
          <label className="block text-xs font-medium text-zinc-700 mb-1">{t('services.service_name')}</label>
          <input
            required
            type="text"
            value={serviceName}
            onChange={(e) => setServiceName(e.target.value)}
            placeholder="fast-chat"
            className="w-full h-9 rounded-md border border-zinc-300 px-3 py-1.5 text-xs focus:border-zinc-900 focus:outline-none"
          />
        </div>

        <StrategyMatrixCardSelector selectedStrategy={nextStrategy} onSelect={setNextStrategy} />

        {nextStrategy === 'capability_aware' && (
          <div className="space-y-4">
            <WorkloadPresetSelector selectedPreset={preset} onSelectPreset={setPreset} />

            <div className="rounded-xl border border-zinc-200 bg-zinc-50/70 p-3 space-y-2">
              <label className="flex items-center gap-2.5 text-xs font-semibold uppercase tracking-wider text-zinc-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={judgeEnabled}
                  onChange={(e) => setJudgeEnabled(e.target.checked)}
                  className="h-4 w-4 rounded border-zinc-300 text-zinc-950 focus:ring-zinc-950"
                />
                <span>{t('services.judge_label')}</span>
              </label>
              {judgeEnabled && (
                <div className="space-y-2 pt-1">
                  {judgeOptions.length > 0 ? (
                    <Select label={t('services.judge_select')} options={judgeOptions} selected={selectedJudge} onChange={(option) => setJudgeEndpointId(String(option.id))} />
                  ) : (
                    <p className="text-xs text-amber-600">{t('services.judge_no_endpoints')}</p>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        <div className="rounded-xl border border-zinc-200 bg-zinc-50/60 p-3 space-y-2">
          <div className="flex items-center justify-between">
            <label className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-zinc-700 cursor-pointer">
              <input
                type="checkbox"
                checked={shadowEnabled}
                onChange={(e) => setShadowEnabled(e.target.checked)}
                className="h-4 w-4 rounded border-zinc-300 text-zinc-950 focus:ring-zinc-950"
              />
              <span className="flex items-center gap-1.5">
                <ShieldCheck className="h-3.5 w-3.5 text-zinc-700" />
                {t('services.shadow_flighting_title')}
              </span>
            </label>
            {shadowEnabled && (
              <span className="text-xs font-medium text-purple-700 bg-purple-50 border border-purple-200 px-2 py-0.5 rounded-md">
                {shadowSampleRate}% Sample
              </span>
            )}
          </div>
          {shadowEnabled && (
            <div className="space-y-2 pt-1">
              {serviceOptions.length > 0 ? (
                <Select
                  label={t('services.shadow_target_model')}
                  options={serviceOptions}
                  selected={selectedShadowTarget}
                  onChange={(option) => setShadowVirtualModelId(String(option.id))}
                />
              ) : (
                <p className="text-xs text-amber-600">{t('services.shadow_no_targets')}</p>
              )}
              <p className="text-xs text-zinc-500">{t('services.shadow_target_desc')}</p>
              <div className="flex items-center gap-4">
                <span className="text-xs text-zinc-600 font-medium whitespace-nowrap">{t('services.shadow_sample_rate')}:</span>
                <input
                  type="range"
                  min="1"
                  max="100"
                  step="1"
                  value={shadowSampleRate}
                  onChange={(e) => setShadowSampleRate(Number(e.target.value))}
                  className="w-full accent-zinc-950"
                />
                <span className="text-xs font-mono font-bold text-zinc-900 w-10 text-right">{shadowSampleRate}%</span>
              </div>
            </div>
          )}
        </div>

        {error && <div className="mt-4"><ErrorMessage text={error} /></div>}
        <div className="mt-4 flex justify-end gap-3 border-t border-zinc-100 pt-3">
          <button type="button" onClick={onClose} className="rounded-lg border border-zinc-300 px-4 py-2.5 text-sm text-zinc-600 hover:bg-zinc-50 transition-colors">
            {t('common.cancel')}
          </button>
          <button disabled={busy} className="rounded-lg bg-zinc-950 px-5 py-2.5 text-sm text-white hover:bg-zinc-800 transition-colors disabled:opacity-50">
            {busy ? (t('common.saving')) : (t('common.save'))}
          </button>
        </div>
      </form>
    </div>
  )
}

function EditProviderModal({ endpoint, serviceId, onClose, onSaved }: { endpoint: ServiceEndpoint; serviceId: string; onClose: () => void; onSaved: () => void }) {
  const { t } = useI18n()
  const [providerName, setProviderName] = useState(endpoint.provider_name)
  const [providerType] = useState(endpoint.provider_type)
  const [protocol, setProtocol] = useState(endpoint.protocol || 'openai')
  const [baseUrl, setBaseUrl] = useState(endpoint.base_url)
  const [model, setModel] = useState(endpoint.model)
  const [apiKey, setApiKey] = useState('')
  const [inputPrice, setInputPrice] = useState(formatPriceInput(endpoint.input_price_per_1m))
  const [outputPrice, setOutputPrice] = useState(formatPriceInput(endpoint.output_price_per_1m))
  const [capabilityScore, setCapabilityScore] = useState(String(endpoint.capability_score ?? '0.70'))
  const [contextLength, setContextLength] = useState(endpoint.context_length ? String(endpoint.context_length) : '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [testStatus, setTestStatus] = useState<'idle' | 'testing' | 'passed' | 'failed'>('idle')
  const [testMsg, setTestMsg] = useState('')

  async function runTest() {
    setTestStatus('testing')
    setTestMsg('')
    try {
      if (apiKey.trim()) {
        const res = await saasFetch<{ passed?: boolean; message?: string }>('/api/saas/test-connection', {
          method: 'POST',
          body: JSON.stringify({
            protocol,
            base_url: baseUrl.trim(),
            api_key: apiKey.trim(),
            upstream_model_id: model.trim(),
          }),
        })
        if (res.success && (res.data?.passed !== false)) {
          setTestStatus('passed')
          setTestMsg(res.data?.message || (t('services.test_passed')))
        } else {
          setTestStatus('failed')
          setTestMsg(res.message || (t('services.test_failed')))
        }
      } else {
        const res = await saasFetch<{ passed?: boolean; message?: string }>(`/api/saas/model-services/${serviceId}/endpoints/${endpoint.id}`, {
          method: 'POST',
        })
        if (res.success && (res.data?.passed !== false)) {
          setTestStatus('passed')
          setTestMsg(res.data?.message || (t('services.test_passed')))
        } else {
          setTestStatus('failed')
          setTestMsg(res.message || (t('services.test_failed')))
        }
      }
    } catch (e: any) {
      setTestStatus('failed')
      setTestMsg(e.message || (t('services.test_failed')))
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError('')
    try {
      await saasFetch(`/api/saas/model-services/${serviceId}/endpoints/${endpoint.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          provider_name: providerName.trim(),
          provider_type: providerType,
          protocol,
          base_url: baseUrl.trim(),
          api_key: apiKey || undefined,
          upstream_model_id: model.trim(),
          input_price_per_1m: inputPrice ? Number(inputPrice) : undefined,
          output_price_per_1m: outputPrice ? Number(outputPrice) : undefined,
          capability_score: capabilityScore ? Number(capabilityScore) : undefined,
          context_length: contextLength ? Number(contextLength) : undefined,
        }),
      })
      onSaved()
    } catch (e) { setError(errorText(e)) } finally { setBusy(false) }
  }
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/30 p-4" role="dialog" aria-modal="true">
      <form onSubmit={submit} className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold">{t('services.edit_model')}</h2>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-2 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-950" aria-label="Close">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="mt-6 space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t('services.provider_name')} value={providerName} onChange={setProviderName} placeholder="DeepSeek" />
            <label className="block text-xs font-medium text-zinc-700">
              {t('services.provider_id')}
              <input readOnly value={endpoint.provider_id} className="mt-1.5 w-full rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs text-zinc-500 outline-none" />
            </label>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t('services.model_label')} value={model} onChange={(val) => { setModel(val); setTestStatus('idle') }} placeholder="deepseek-chat" />
            <Select label={t('services.protocol_label')} options={[{ id: 'openai', name: 'OpenAI' }, { id: 'anthropic', name: 'Anthropic' }]} selected={{ id: protocol, name: protocol === 'anthropic' ? 'Anthropic' : 'OpenAI' }} onChange={(option) => { setProtocol(String(option.id)); setTestStatus('idle') }} />
          </div>

          <Field label={t('services.base_url')} value={baseUrl} onChange={(val) => { setBaseUrl(val); setTestStatus('idle') }} placeholder="https://api.example.com/v1" />

          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="block text-xs font-medium text-zinc-700">{t('services.api_key_new')}</label>
              <button type="button" onClick={runTest} disabled={testStatus === 'testing' || !baseUrl.trim() || !model.trim()} className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:text-primary-hover disabled:text-zinc-400 disabled:cursor-not-allowed" title={t('services.test_connection_hint')}>
                <Zap className={`h-3.5 w-3.5 ${testStatus === 'testing' ? 'animate-pulse text-amber-500' : ''}`} />
                <span>{testStatus === 'testing' ? (t('services.testing')) : (t('services.test_connection'))}</span>
              </button>
            </div>
            <div className="relative mt-1">
              <Field required={false} label="" value={apiKey} onChange={(val) => { setApiKey(val); setTestStatus('idle') }} placeholder={t('services.api_key_placeholder')} type="password" />
            </div>
            {testStatus === 'passed' && (
              <div className="mt-1.5 flex items-center gap-1.5 text-xs text-emerald-600">
                <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                <span>{testMsg || (t('services.test_passed'))}</span>
              </div>
            )}
            {testStatus === 'failed' && (
              <div className="mt-1.5 flex items-start gap-1.5 text-xs text-rose-600">
                <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                <span className="break-all">{testMsg || (t('services.test_failed'))}</span>
              </div>
            )}
          </div>

          {/* Compact pricing and capability parameters directly expanded */}
          <div className="rounded-xl border border-zinc-200 bg-zinc-50/80 p-3">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500 mb-2">
              {t('services.advanced_settings')}
            </div>
            <div className="grid gap-3 sm:grid-cols-4 text-zinc-900">
              <Field size="sm" required={false} label={t('services.input_price')} value={inputPrice} onChange={setInputPrice} placeholder="0.14" />
              <Field size="sm" required={false} label={t('services.output_price')} value={outputPrice} onChange={setOutputPrice} placeholder="0.28" />
              <Field size="sm" required={false} label={t('services.capability_range')} value={capabilityScore} onChange={setCapabilityScore} placeholder="0.70" />
              <Field size="sm" required={false} label={t('services.context_length')} value={contextLength} onChange={setContextLength} placeholder="128000" />
            </div>
          </div>
        </div>

        {error && <div className="mt-4"><ErrorMessage text={error} /></div>}

        <div className="mt-6 flex justify-end gap-3 border-t border-zinc-100 pt-3">
          <button type="button" onClick={onClose} className="rounded-lg border border-zinc-300 px-4 py-2.5 text-sm text-zinc-600 hover:bg-zinc-50 transition-colors">
            {t('common.cancel')}
          </button>
          <button disabled={busy} className="rounded-lg bg-zinc-950 px-5 py-2.5 text-sm text-white hover:bg-zinc-800 transition-colors disabled:opacity-50">
            {busy ? (t('common.saving')) : (t('common.save'))}
          </button>
        </div>
      </form>
    </div>
  )
}

export function ModelProbeModal({
  endpoint,
  serviceId,
  onClose,
  onSaved,
}: {
  endpoint: ServiceEndpoint
  serviceId: string
  onClose: () => void
  onSaved: () => void
}) {
  const { t } = useI18n()
  const [probing, setProbing] = useState(false)
  const [probeResult, setProbeResult] = useState<{
    endpoint_id: string
    model: string
    probed_capability_score: number
    supports_tools: boolean
    dna: ModelDna
    probe_details: Array<{
      dimension: string
      name: string
      passed: boolean
      latency_ms: number
      score: number
      summary: string
    }>
  } | null>(null)
  const [error, setError] = useState('')

  async function runProbe() {
    setProbing(true)
    setError('')
    try {
      const res = await saasFetch<{
        endpoint_id: string
        model: string
        probed_capability_score: number
        supports_tools: boolean
        dna: ModelDna
        probe_details: Array<{
          dimension: string
          name: string
          passed: boolean
          latency_ms: number
          score: number
          summary: string
        }>
      }>(`/api/saas/model-services/${serviceId}/endpoints/${endpoint.id}/probe`, {
        method: 'POST',
      })
      if (res.success && res.data) {
        setProbeResult(res.data)
      } else {
        setError(res.message || t('services.probe_failed'))
      }
    } catch (e: any) {
      setError(e.message || t('services.probe_request_failed'))
    } finally {
      setProbing(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/30 p-4" role="dialog" aria-modal="true">
      <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-2.5">
            <div className="rounded-lg bg-purple-50 p-2 text-purple-600 border border-purple-100">
              <Sparkles className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-zinc-950">{t('services.probe_modal_title')}</h2>
              <p className="mt-0.5 text-xs text-zinc-500">
                {endpoint.provider_name} • {endpoint.model}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-2 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-950"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <p className="mt-4 text-xs text-zinc-600 leading-relaxed bg-zinc-50 rounded-lg p-3 border border-zinc-200/70">
          {t('services.probe_modal_subtitle')}
        </p>

        {error && <div className="mt-4"><ErrorMessage text={error} /></div>}

        {!probeResult ? (
          <div className="mt-6 text-center py-8 border border-dashed border-zinc-200 rounded-xl bg-zinc-50/50">
            <div className="inline-flex rounded-full bg-purple-100 p-3 text-purple-600 mb-3">
              <Sparkles className={`h-6 w-6 ${probing ? 'animate-spin' : ''}`} />
            </div>
            <h3 className="text-sm font-medium text-zinc-900">
              {probing ? (t('services.probe_running')) : (t('services.probe_ready_title'))}
            </h3>
            <p className="mt-1 text-xs text-zinc-500 max-w-sm mx-auto">
              {probing
                ? (t('services.probe_running_desc'))
                : (t('services.probe_ready_desc'))}
            </p>
            <button
              type="button"
              onClick={runProbe}
              disabled={probing}
              className="mt-5 inline-flex items-center gap-2 rounded-lg bg-purple-600 px-5 py-2.5 text-sm font-medium text-white shadow-sm hover:bg-purple-700 disabled:opacity-50 transition-colors"
            >
              <Sparkles className="h-4 w-4" />
              {probing ? (t('services.probe_running')) : (t('services.probe_run'))}
            </button>
          </div>
        ) : (
          <div className="mt-5 space-y-4">
            <div className="flex items-center justify-between rounded-xl bg-emerald-50 border border-emerald-200 p-4">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-5 w-5 text-emerald-600 shrink-0" />
                <div>
                  <div className="text-sm font-semibold text-emerald-950">
                    {t('services.probe_completed')}
                  </div>
                  <div className="text-xs text-emerald-700 mt-0.5">
                    Probed Score: <span className="font-mono font-bold">{probeResult.probed_capability_score.toFixed(2)}</span> • Tool Schema:{' '}
                    {probeResult.supports_tools ? 'Supported ✅' : 'Standard Text Only'}
                  </div>
                </div>
              </div>
              <div className="text-right">
                <span className="text-2xl font-bold font-mono text-emerald-700">
                  {Math.round(probeResult.probed_capability_score * 100)}
                </span>
                <span className="text-xs text-emerald-600">/100</span>
              </div>
            </div>

            <div className="rounded-xl border border-zinc-200 p-4">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-zinc-400 mb-3">
                5D Benchmark Breakdown
              </h4>
              <div className="space-y-2.5">
                {probeResult.probe_details.map((detail, idx) => (
                  <div key={idx} className="flex items-center justify-between rounded-lg bg-zinc-50 p-2.5 border border-zinc-100 text-xs">
                    <div className="min-w-0 pr-2">
                      <div className="flex items-center gap-2">
                        <span className={`inline-block h-2 w-2 rounded-full ${detail.passed ? 'bg-emerald-500' : 'bg-rose-500'}`} />
                        <span className="font-medium text-zinc-900">{detail.name}</span>
                        <span className="text-zinc-400 font-mono text-[10px]">{detail.latency_ms}ms</span>
                      </div>
                      <div className="mt-0.5 text-zinc-500 text-[11px] truncate">{detail.summary}</div>
                    </div>
                    <div className="text-right shrink-0">
                      <span className="font-mono font-bold text-zinc-800">{detail.score}</span>
                      <span className="text-zinc-400 text-[10px]">/100</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="flex flex-wrap gap-1.5 pt-1">
              {probeResult.dna.strengths.map((str, sIdx) => (
                <span
                  key={sIdx}
                  className="inline-flex items-center rounded-md bg-purple-50 px-2.5 py-1 text-xs font-medium text-purple-700 border border-purple-200"
                >
                  ✨ {str}
                </span>
              ))}
            </div>

            <div className="flex justify-end gap-3 pt-3 border-t border-zinc-100">
              <button
                type="button"
                onClick={() => {
                  onSaved()
                }}
                className="rounded-lg bg-zinc-950 px-5 py-2.5 text-sm font-medium text-white hover:bg-zinc-800 transition-colors"
              >
                {t('services.probe_apply')}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function AddModelModal({ catalog: initialCatalog, providers: _, serviceId, onClose, onSaved }: { catalog: CatalogOffering[]; providers: { id: string; name: string; modelCount: number }[]; serviceId: string; onClose: () => void; onSaved: () => void }) {
  const { t } = useI18n()
  const [savedAccounts, setSavedAccounts] = useState<SaasProvider[]>([])
  const [useExisting, setUseExisting] = useState(true)
  const [selectedAccountId, setSelectedAccountId] = useState<string>('')
  const [draft, setDraft] = useState<DraftEndpoint>(emptyEndpoint())
  const [visible, setVisible] = useState(false)
  const [advanced, setAdvanced] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [testStatus, setTestStatus] = useState<'idle' | 'testing' | 'passed' | 'failed'>('idle')
  const [testMsg, setTestMsg] = useState('')
  const [modelSearch, setModelSearch] = useState('')
  const [prefixFilter, setPrefixFilter] = useState('')
  const [freeOnlyFilter, setFreeOnlyFilter] = useState(false)
  const [maxPriceFilter, setMaxPriceFilter] = useState('')
  const [selectedBundle, setSelectedBundle] = useState<'custom' | 'balanced' | 'free' | 'reasoning'>('balanced')
  const [selectedModelIds, setSelectedModelIds] = useState<string[]>([])
  const [openRouterModels, setOpenRouterModels] = useState<CatalogOffering[]>([])

  useEffect(() => {
    let active = true
    const mapMarket = (items: Array<{ id: string; name: string; prompt_price_per_1m: number; completion_price_per_1m: number; context_length: number; description: string | null }>): CatalogOffering[] =>
      items.map((m) => ({
        provider_id: 'openrouter',
        provider_name: 'OpenRouter',
        endpoint_id: `openrouter-${m.id}`,
        endpoint_key: 'openrouter',
        region: 'global',
        base_url: 'https://openrouter.ai/api/v1',
        price_currency: 'USD',
        model: m.id,
        model_name: m.name,
        description: m.description || '',
        input_price_per_1m: formatPriceInput(m.prompt_price_per_1m) ? Number(formatPriceInput(m.prompt_price_per_1m)) : 0,
        output_price_per_1m: formatPriceInput(m.completion_price_per_1m) ? Number(formatPriceInput(m.completion_price_per_1m)) : 0,
        cache_read_price_per_1m: 0,
        cache_write_price_per_1m: 0,
        supports_tools: true,
        supports_vision: false,
        supports_reasoning: /(?:^|[^a-z0-9])(?:r1|o1|o3)(?:[^a-z0-9]|$)/i.test(m.id) || m.id.includes('reasoning'),
        context_length: m.context_length,
      }))

    const loadMarket = async () => {
      try {
        let res = await saasFetch<{ models?: Array<{ id: string; name: string; prompt_price_per_1m: number; completion_price_per_1m: number; context_length: number; description: string | null }> }>('/api/saas/openrouter/market?page_size=1000')
        if ((!res.data?.models || res.data.models.length <= 3) && active) {
          try {
            await saasFetch('/api/saas/openrouter/sync', { method: 'POST' })
            res = await saasFetch('/api/saas/openrouter/market?page_size=1000')
          } catch (_) {}
        }
        if (active && res.data?.models?.length) {
          setOpenRouterModels(mapMarket(res.data.models))
        }
      } catch (_) {}
    }
    loadMarket()
    return () => { active = false }
  }, [])

  const fullCatalog = useMemo(() => {
    if (openRouterModels.length === 0) return initialCatalog
    const nonOr = initialCatalog.filter((item) => item.provider_id !== 'openrouter')
    return [...nonOr, ...openRouterModels]
  }, [initialCatalog, openRouterModels])

  useEffect(() => {
    saasFetch<SaasProvider[]>('/api/saas/providers').then((res) => {
      const list = res.data || []
      setSavedAccounts(list)
      if (list.length > 0) {
        setSelectedAccountId(list[0].id)
        setUseExisting(true)
        const acc = list[0]
        setDraft((curr) => ({
          ...curr,
          provider_type: acc.provider_type,
          protocol: acc.protocol || 'openai',
          base_url: acc.base_url,
          upstream_model_id: '',
          input_price_per_1m: '',
          output_price_per_1m: '',
          capability_score: '0.70',
          context_length: '',
        }))
      } else {
        setUseExisting(false)
      }
    }).catch(() => {
      setUseExisting(false)
    })
  }, [])

  const selectedAccount = savedAccounts.find((a) => a.id === selectedAccountId)
  const currentProviderType = useExisting
    ? (selectedAccount?.provider_type || (openRouterModels.length ? 'openrouter' : 'custom'))
    : draft.provider_type
  const models = useMemo(() => {
    return fullCatalog.filter((item) => item.provider_id === currentProviderType)
  }, [fullCatalog, currentProviderType])

  // Automatically populate selectedModelIds if a smart bundle is active and selection is empty
  useEffect(() => {
    if (models.length > 0 && selectedBundle !== 'custom' && selectedModelIds.length === 0) {
      const targetIds = computeBundleSelection(selectedBundle, models)
      if (targetIds.length > 0) {
        setSelectedModelIds(targetIds)
      }
    }
  }, [models, selectedBundle, selectedModelIds.length])

  const matchedModels = useMemo(
    () => filterCatalogModels(models, { query: modelSearch, providerPrefix: prefixFilter, freeOnly: freeOnlyFilter, maxInputPrice: maxPriceFilter }),
    [models, modelSearch, prefixFilter, freeOnlyFilter, maxPriceFilter]
  )
  const filteredModels = matchedModels
    .map((m) => ({ model: m, score: searchScore(m, modelSearch) }))
    .sort((a, b) => b.score - a.score)
    .map((item) => item.model)
  const selectedModels = models.filter((m) => selectedModelIds.includes(m.model))
  const hasActiveFilter = modelSearch.trim() !== '' || prefixFilter !== '' || freeOnlyFilter || maxPriceFilter.trim() !== ''
  const visibleModels = hasActiveFilter
    ? [...selectedModels, ...filteredModels.filter((m) => !selectedModelIds.includes(m.model))]
    : filteredModels

  const formatPrice = (val: number) => {
    if (val === 0) return 'FREE'
    if (val < 0.0001) return `<$0.0001`
    const rounded = Number(val.toPrecision(4))
    return `$${rounded}`
  }

  const accountOptions = savedAccounts.map((a) => ({
    id: a.id,
    name: `${a.name} (${a.provider_type} • ${a.protocol})`,
  }))

  const providerPrefixes = useMemo(() => catalogProviderPrefixes(models), [models])
  const prefixOptions = [
    { id: '', name: t('services.filter_all_providers') },
    ...providerPrefixes.map((p) => ({ id: p, name: p })),
  ]
  const selectedPrefixOption = prefixOptions.find((o) => o.id === prefixFilter) || prefixOptions[0]

  const presetProviderOptions = [
    { id: 'openrouter', name: 'OpenRouter' },
    { id: 'deepseek', name: 'DeepSeek' },
    { id: 'openai', name: 'OpenAI' },
    { id: 'anthropic', name: 'Anthropic' },
    { id: 'aliyun', name: 'Aliyun Bailian' },
    { id: 'custom', name: t('services.custom_provider') },
  ]
  const selectedPresetProvider = presetProviderOptions.find((p) => p.id === draft.provider_type) || presetProviderOptions[0]

  const protocolOptions = [{ id: 'openai', name: 'OpenAI' }, { id: 'anthropic', name: 'Anthropic' }]
  const selectedProtocol = protocolOptions.find((option) => option.id === draft.protocol) || protocolOptions[0]

  const patch = (value: Partial<DraftEndpoint>) => {
    setDraft((current) => ({ ...current, ...value }))
    setTestStatus('idle')
  }

  function handleAccountChange(opt: { id: string | number; name: string }) {
    const accId = String(opt.id)
    setSelectedAccountId(accId)
    const acc = savedAccounts.find((a) => a.id === accId)
    if (acc) {
      setSelectedModelIds([])
      setModelSearch('')
      setDraft((curr) => ({
        ...curr,
        provider_type: acc.provider_type,
        protocol: acc.protocol || 'openai',
        base_url: acc.base_url,
        upstream_model_id: '',
        input_price_per_1m: '',
        output_price_per_1m: '',
        capability_score: '0.70',
        context_length: '',
      }))
    }
  }

  function chooseNewProviderPreset(option: { id: string | number; name: string }) {
    const provider = String(option.id)
    const first = fullCatalog.find((item) => item.provider_id === provider)
    const protocol = /anthropic|claude/i.test(provider) ? 'anthropic' : 'openai'
    setSelectedModelIds([])
    setModelSearch('')
    setDraft({
      ...emptyEndpoint(),
      provider_type: provider,
      protocol,
      upstream_model_id: '',
      base_url: first?.base_url || '',
      input_price_per_1m: '',
      output_price_per_1m: '',
      capability_score: first ? inferDefaultCapability(first) : '0.70',
      context_length: '',
    })
    setAdvanced(false)
    setTestStatus('idle')
  }

  function toggleModelSelection(m: CatalogOffering) {
    const exists = selectedModelIds.includes(m.model)
    const next = exists ? selectedModelIds.filter((id) => id !== m.model) : [...selectedModelIds, m.model]
    const focus = exists
      ? models.find((item) => item.model === next[0])
      : m
    setSelectedModelIds(next)
    patch({
      upstream_model_id: focus?.model || '',
      base_url: useExisting ? (selectedAccount?.base_url || focus?.base_url || '') : (focus?.base_url || ''),
      input_price_per_1m: focus ? formatPriceInput(focus.input_price_per_1m) : '',
      output_price_per_1m: focus ? formatPriceInput(focus.output_price_per_1m) : '',
      capability_score: focus ? inferDefaultCapability(focus) : '0.70',
      context_length: focus?.context_length ? String(focus.context_length) : '',
    })
    setTestStatus('idle')
  }

  async function runTestKey() {
    const modelToTest = draft.upstream_model_id.trim() || selectedModelIds[0] || ''
    if (!modelToTest) return
    setTestStatus('testing')
    setTestMsg('')
    try {
      const res = await saasFetch<{ passed?: boolean; message?: string }>('/api/saas/test-connection', {
        method: 'POST',
        body: JSON.stringify({
          protocol: useExisting ? (selectedAccount?.protocol || 'openai') : draft.protocol,
          base_url: useExisting ? (selectedAccount?.base_url || draft.base_url) : draft.base_url.trim(),
          api_key: draft.api_key.trim(),
          upstream_model_id: modelToTest,
        }),
      })
      if (res.success && (res.data?.passed !== false)) {
        setTestStatus('passed')
        setTestMsg(res.data?.message || (t('services.test_passed')))
      } else {
        setTestStatus('failed')
        setTestMsg(res.message || (t('services.test_failed')))
      }
    } catch (e: any) {
      setTestStatus('failed')
      setTestMsg(e.message || (t('services.test_failed')))
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!useExisting && (!draft.base_url.trim() || !draft.api_key.trim())) {
      setError(t('services.error_base_url_apikey_required'))
      return
    }
    if (!useExisting && draft.provider_type === 'custom' && !draft.custom_provider_id.trim()) {
      setError(t('services.error_custom_provider_required'))
      return
    }
    if (!useExisting && !draft.upstream_model_id.trim() && selectedModelIds.length === 0) {
      setError(t('services.error_no_model_selected'))
      return
    }

    const targetModels: Array<{
      model: string
      input_price?: number
      output_price?: number
      capability?: number
      context_length?: number
    }> = []

    if (selectedModelIds.length > 0) {
      for (const mId of selectedModelIds) {
        const catItem = models.find((item) => item.model === mId)
        if (catItem) {
          targetModels.push({
            model: catItem.model,
            input_price: catItem.input_price_per_1m ? Number(catItem.input_price_per_1m) : undefined,
            output_price: catItem.output_price_per_1m ? Number(catItem.output_price_per_1m) : undefined,
            capability: Number(inferDefaultCapability(catItem)),
            context_length: catItem.context_length ? Number(catItem.context_length) : undefined,
          })
        } else {
          targetModels.push({
            model: mId,
            input_price: draft.input_price_per_1m ? Number(draft.input_price_per_1m) : undefined,
            output_price: draft.output_price_per_1m ? Number(draft.output_price_per_1m) : undefined,
            capability: Number(draft.capability_score || 0.7),
            context_length: draft.context_length ? Number(draft.context_length) : undefined,
          })
        }
      }
    } else if (draft.upstream_model_id.trim()) {
      targetModels.push({
        model: draft.upstream_model_id.trim(),
        input_price: draft.input_price_per_1m ? Number(draft.input_price_per_1m) : undefined,
        output_price: draft.output_price_per_1m ? Number(draft.output_price_per_1m) : undefined,
        capability: Number(draft.capability_score || 0.7),
        context_length: draft.context_length ? Number(draft.context_length) : undefined,
      })
    }

    if (targetModels.length === 0) {
      setError(t('services.error_no_model_selected'))
      return
    }

    setBusy(true)
    setError('')
    try {
      const endpointsPayload = targetModels.map((tm) => ({
        account_id: useExisting ? selectedAccountId : undefined,
        provider_type: useExisting ? undefined : (draft.provider_type === 'custom' ? draft.custom_provider_id : draft.provider_type),
        provider_name: useExisting ? undefined : (draft.provider_type === 'custom' ? draft.custom_provider_id : selectedPresetProvider.name),
        protocol: useExisting ? undefined : draft.protocol,
        base_url: useExisting ? undefined : draft.base_url,
        api_key: useExisting ? undefined : draft.api_key,
        upstream_model_id: tm.model,
        input_price_per_1m: tm.input_price,
        output_price_per_1m: tm.output_price,
        capability_score: tm.capability,
        context_length: tm.context_length,
      }))

      await saasFetch(`/api/saas/model-services/${serviceId}/endpoints`, {
        method: 'POST',
        body: JSON.stringify(endpointsPayload),
      })
      onSaved()
    } catch (e) {
      setError(errorText(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-zinc-950/40 p-4" role="dialog" aria-modal="true">
      <form onSubmit={submit} className="max-h-[90vh] w-full max-w-2xl min-w-[320px] sm:min-w-[640px] overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold">{t('services.add_model')}</h2>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-2 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-950" aria-label="Close">
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Toggle between existing provider account or entering new */}
        {savedAccounts.length > 0 && (
          <div className="mt-4 flex rounded-lg border border-zinc-200 bg-zinc-100 p-1">
            <button
              type="button"
              onClick={() => setUseExisting(true)}
              className={`flex-1 rounded-md py-1.5 text-xs font-medium transition-all ${
                useExisting ? 'bg-white text-zinc-900 shadow-xs' : 'text-zinc-500 hover:text-zinc-900'
              }`}
            >
              {t('providers.use_connected_account')}
            </button>
            <button
              type="button"
              onClick={() => setUseExisting(false)}
              className={`flex-1 rounded-md py-1.5 text-xs font-medium transition-all ${
                !useExisting ? 'bg-white text-zinc-900 shadow-xs' : 'text-zinc-500 hover:text-zinc-900'
              }`}
            >
              {t('providers.connect_new_account')}
            </button>
          </div>
        )}

        <div className="mt-5 space-y-4">
          {useExisting && savedAccounts.length > 0 ? (
            <div className="space-y-4 rounded-xl border border-zinc-200 bg-zinc-50/60 p-4">
              <Select
                label={t('providers.select_account')}
                options={accountOptions}
                selected={accountOptions.find((a) => a.id === selectedAccountId) || accountOptions[0]}
                onChange={handleAccountChange}
              />

              {/* Searchable multi-select model catalog */}
              <div className="space-y-3">
                {/* Smart preset bundles for rapid tier-setup */}
                {models.length > 0 && (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-zinc-800">
                        {t('services.smart_bundles')}
                      </span>
                      {selectedModelIds.length > 0 && (
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedBundle('custom')
                            setSelectedModelIds([])
                          }}
                          className="text-[11px] text-zinc-400 hover:text-zinc-700 transition-colors"
                        >
                          {t('services.clear_selection')}
                        </button>
                      )}
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedBundle('balanced')
                          setSelectedModelIds(computeBundleSelection('balanced', models))
                        }}
                        className={`rounded-lg border px-3 py-2 text-center text-xs font-medium transition-all ${
                          selectedBundle === 'balanced'
                            ? 'border-zinc-950 bg-zinc-950 text-white shadow-xs'
                            : 'border-zinc-200 bg-white text-zinc-700 hover:border-zinc-300 hover:bg-zinc-50'
                        }`}
                      >
                        {t('services.bundle_balanced')}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedBundle('free')
                          const freeModels = computeBundleSelection('free', models)
                          if (freeModels.length > 0) {
                            setSelectedModelIds(freeModels)
                          }
                        }}
                        className={`rounded-lg border px-3 py-2 text-center text-xs font-medium transition-all ${
                          selectedBundle === 'free'
                            ? 'border-zinc-950 bg-zinc-950 text-white shadow-xs'
                            : 'border-zinc-200 bg-white text-zinc-700 hover:border-zinc-300 hover:bg-zinc-50'
                        }`}
                      >
                        {t('services.bundle_free')}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedBundle('reasoning')
                          const reasoningModels = computeBundleSelection('reasoning', models)
                          if (reasoningModels.length > 0) {
                            setSelectedModelIds(reasoningModels)
                          }
                        }}
                        className={`rounded-lg border px-3 py-2 text-center text-xs font-medium transition-all ${
                          selectedBundle === 'reasoning'
                            ? 'border-zinc-950 bg-zinc-950 text-white shadow-xs'
                            : 'border-zinc-200 bg-white text-zinc-700 hover:border-zinc-300 hover:bg-zinc-50'
                        }`}
                      >
                        {t('services.bundle_reasoning')}
                      </button>
                    </div>
                  </div>
                )}

                {selectedBundle !== 'custom' ? (
                  /* Template mode: simply display framed models cleanly without requiring manual checkboxes */
                  <div className="rounded-xl border border-zinc-200 bg-white p-3 space-y-2">
                    <div className="flex items-center justify-between text-xs font-semibold text-zinc-900 border-b border-zinc-100 pb-2">
                      <span>{t('services.models_to_connect')} ({selectedModelIds.length})</span>
                      <button
                        type="button"
                        onClick={() => setSelectedBundle('custom')}
                        className="text-[11px] font-normal text-primary hover:underline"
                      >
                        {t('services.custom_or_additional_model')}
                      </button>
                    </div>
                    <div className="h-44 overflow-y-auto divide-y divide-zinc-100 pr-1">
                      {selectedModels.map((m) => (
                        <div
                          key={m.model}
                          role="checkbox"
                          aria-checked="true"
                          tabIndex={0}
                          onClick={() => {
                            setSelectedBundle('custom')
                            toggleModelSelection(m)
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault()
                              setSelectedBundle('custom')
                              toggleModelSelection(m)
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
                                <span className="text-emerald-600 font-semibold">FREE</span>
                              ) : (
                                <span>{formatPrice(m.input_price_per_1m)}/1M</span>
                              )}
                            </div>
                            {m.context_length && (
                              <div className="text-[10px] text-zinc-400">{m.context_length.toLocaleString()} ctx</div>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  /* Custom manual search and selection mode */
                  <div>
                    {currentProviderType === 'openrouter' && (
                      <div className="mb-2 space-y-2 rounded-lg border border-zinc-200 bg-zinc-50/60 p-2">
                        <div className="grid gap-2 sm:grid-cols-2">
                          <Select
                            size="sm"
                            label={t('services.filter_provider_prefix')}
                            options={prefixOptions}
                            selected={selectedPrefixOption}
                            onChange={(option) => setPrefixFilter(String(option.id))}
                          />
                          <div>
                            <label className="mb-1 block text-xs font-medium text-zinc-700">{t('services.filter_max_input_price')}</label>
                            <input
                              type="text"
                              inputMode="decimal"
                              value={maxPriceFilter}
                              onChange={(e) => setMaxPriceFilter(e.target.value)}
                              placeholder={t('services.price_cap_placeholder')}
                              className="h-9 w-full rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-xs outline-none focus:border-primary"
                            />
                          </div>
                        </div>
                        <div className="flex items-center justify-between gap-2">
                          <label className="flex cursor-pointer items-center gap-1.5 text-xs text-zinc-700">
                            <input
                              type="checkbox"
                              checked={freeOnlyFilter}
                              onChange={(e) => setFreeOnlyFilter(e.target.checked)}
                              className="h-3.5 w-3.5 rounded accent-zinc-900"
                            />
                            {t('services.filter_free_only')}
                          </label>
                          <button
                            type="button"
                            onClick={() => {
                              const matching = matchedModels.map((m) => m.model)
                              setSelectedModelIds(Array.from(new Set([...selectedModelIds, ...matching])))
                            }}
                            disabled={matchedModels.length === 0}
                            className="rounded-md border border-zinc-300 bg-white px-2.5 py-1 text-[11px] font-medium text-zinc-700 transition-colors hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-40"
                          >
                            {t('services.select_all_matching', { count: matchedModels.length })}
                          </button>
                        </div>
                      </div>
                    )}
                    <div className="relative mb-2">
                      <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-zinc-400" />
                      <input
                        type="text"
                        autoComplete="off"
                        autoCorrect="off"
                        spellCheck={false}
                        value={modelSearch}
                        onChange={(e) => setModelSearch(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') e.preventDefault() }}
                        placeholder={t('services.search_models_placeholder')}
                        className="w-full rounded-lg border border-zinc-200 bg-white py-1.5 pl-8 pr-3 text-xs outline-none focus:border-primary"
                      />
                    </div>

                    <div className="h-48 overflow-y-auto rounded-lg border border-zinc-200 bg-white p-2">
                      {visibleModels.length > 0 ? (
                        <div className="space-y-1.5">
                          {visibleModels.map((m) => {
                            const isChecked = selectedModelIds.includes(m.model)
                            return (
                              <label
                                key={m.model}
                                className={`flex cursor-pointer items-start gap-2.5 rounded-md p-2 transition-colors ${
                                  isChecked ? 'bg-zinc-100 border border-zinc-300' : 'hover:bg-zinc-50 border border-transparent'
                                }`}
                              >
                                <input
                                  type="checkbox"
                                  checked={isChecked}
                                  onChange={() => toggleModelSelection(m)}
                                  className="mt-0.5 h-3.5 w-3.5 rounded accent-zinc-900"
                                />
                                <div className="min-w-0 flex-1">
                                  <div className="flex items-center justify-between gap-2">
                                    <span className="font-medium text-xs text-zinc-900 truncate">
                                      {m.model_name || m.model}
                                    </span>
                                    <div className="shrink-0 text-[11px] font-mono text-zinc-500">
                                      {m.input_price_per_1m === 0 && m.output_price_per_1m === 0 ? (
                                        <span className="text-emerald-600 font-semibold">FREE</span>
                                      ) : (
                                        <span>{formatPrice(m.input_price_per_1m)}/1M</span>
                                      )}
                                    </div>
                                  </div>
                                  <div className="mt-0.5 text-[11px] text-zinc-400 truncate">
                                    <code className="text-zinc-600">{m.model}</code>
                                    {m.context_length ? ` ${m.context_length.toLocaleString()} ctx` : ''}
                                  </div>
                                </div>
                              </label>
                            )
                          })}
                        </div>
                      ) : (
                        <div className="flex h-full items-center justify-center text-xs text-zinc-400">
                          {models.length === 0
                            ? (t('common.loading'))
                            : (t('services.no_models_match'))}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <Select
                  label={t('services.provider_label')}
                  options={presetProviderOptions}
                  selected={selectedPresetProvider}
                  onChange={chooseNewProviderPreset}
                />
                {draft.provider_type === 'custom' ? (
                  <Field
                    alignWithSelect
                    label={t('services.provider_id')}
                    value={draft.custom_provider_id}
                    onChange={(value) => patch({ custom_provider_id: value })}
                    placeholder="my-openai-proxy"
                  />
                ) : (
                  <div>
                    <label className="block text-xs font-medium text-zinc-700 mb-1">{t('services.model_label')}</label>
                    <input
                      type="text"
                      value={draft.upstream_model_id}
                      onChange={(e) => patch({ upstream_model_id: e.target.value })}
                      placeholder="e.g. deepseek-chat or gpt-4o"
                      className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-xs outline-none focus:border-primary"
                    />
                  </div>
                )}
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <Field
                  label={t('services.model_label')}
                  value={draft.upstream_model_id}
                  onChange={(val) => patch({ upstream_model_id: val })}
                  placeholder="deepseek-chat or gpt-4o"
                />
                <Select
                  label={t('services.protocol_label')}
                  options={protocolOptions}
                  selected={selectedProtocol}
                  onChange={(option) => patch({ protocol: String(option.id) })}
                />
              </div>

              <Field
                label={t('services.base_url')}
                value={draft.base_url}
                onChange={(value) => patch({ base_url: value })}
                placeholder="https://api.example.com/v1"
              />

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-xs font-medium text-zinc-700">{t('services.api_key')}</label>
                  <button
                    type="button"
                    onClick={runTestKey}
                    disabled={testStatus === 'testing' || !draft.api_key.trim() || !draft.base_url.trim() || !draft.upstream_model_id.trim()}
                    className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:text-primary-hover disabled:text-zinc-400 disabled:cursor-not-allowed"
                  >
                    <Zap className={`h-3.5 w-3.5 ${testStatus === 'testing' ? 'animate-pulse text-amber-500' : ''}`} />
                    <span>{testStatus === 'testing' ? (t('services.testing')) : (t('services.test_connection'))}</span>
                  </button>
                </div>
                <div className="relative mt-1">
                  <input
                    required
                    type={visible ? 'text' : 'password'}
                    value={draft.api_key}
                    onChange={(event) => patch({ api_key: event.target.value })}
                    placeholder={t('services.api_key_paste_placeholder')}
                    className="w-full rounded-lg border border-zinc-300 px-3 py-2 pr-10 text-sm outline-none focus:border-primary"
                  />
                  <button
                    type="button"
                    onClick={() => setVisible((value) => !value)}
                    className="absolute inset-y-0 right-0 px-3 text-zinc-400"
                    aria-label={visible ? 'Hide API key' : 'Show API key'}
                  >
                    {visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
                {testStatus === 'passed' && (
                  <div className="mt-1.5 flex items-center gap-1.5 text-xs text-emerald-600">
                    <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                    <span>{testMsg || (t('services.key_verified_healthy'))}</span>
                  </div>
                )}
                {testStatus === 'failed' && (
                  <div className="mt-1.5 flex items-start gap-1.5 text-xs text-rose-600">
                    <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                    <span className="break-all">{testMsg || (t('services.test_failed'))}</span>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Compact pricing and capability parameters directly expanded */}
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
        </div>

        {error && <div className="mt-4"><ErrorMessage text={error} /></div>}

        <div className="mt-6 flex justify-end gap-3 border-t border-zinc-100 pt-3">
          <button type="button" onClick={onClose} className="rounded-lg border border-zinc-300 px-4 py-2 text-xs font-medium text-zinc-600 hover:bg-zinc-50">
            {t('common.cancel')}
          </button>
          <button disabled={busy} className="rounded-lg bg-zinc-950 px-5 py-2 text-xs font-medium text-white hover:bg-zinc-800 disabled:opacity-50">
            {busy ? (t('common.creating')) : (t('services.add_model'))}
          </button>
        </div>
      </form>
    </div>
  )
}

