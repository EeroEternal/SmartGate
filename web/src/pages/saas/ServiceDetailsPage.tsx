import { useState } from 'react'
import { ChevronDown, ChevronRight, Copy, HelpCircle, Pencil, Plus, Sparkles, Trash2, X, Zap } from 'lucide-react'
import { Link, useParams } from 'react-router-dom'
import { saasFetch } from '../../lib/saasApi'
import { useDialog } from '../../components/Dialog'
import { useI18n } from '../../lib/i18n'
import { ErrorMessage, Page, errorText } from './components'
import { routingInfo } from './serviceUtils'
import { AddModelModal } from './AddModelModal'
import { CallExamplePanel } from './CallExamplePanel'
import { EditProviderModal } from './EditProviderModal'
import { EditRoutingModal } from './EditRoutingModal'
import { ModelProbeModal } from './ModelProbeModal'
import { useServiceDetails } from './useServiceDetails'
import { useModelServices } from './useModelServices'
import type { CallApi, ServiceEndpoint } from './types'

export function ServiceDetailsPage() {
  const { t } = useI18n()
  const { id } = useParams()
  const { service, catalog, error, setError, load } = useServiceDetails(id)
  // Endpoint changes also move the shared list's endpoint counts, so keep both in sync.
  const { refresh: refreshServices } = useModelServices()
  const reloadService = () => { load(); void refreshServices() }
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
  async function removeEndpoint(endpointId: string) {
    if (!id || !await showConfirm(t('services.remove_provider_confirm'), t('services.remove_model'))) return
    try { await saasFetch(`/api/saas/model-services/${id}/endpoints/${endpointId}`, { method: 'DELETE' }); reloadService() } catch (e) { setError(errorText(e)) }
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
      setTestToast({ type: 'success', message: t('services.test_passed') })
      window.setTimeout(() => setTestToast(null), 5000)
    } catch (e) {
      setTestResults((results) => ({ ...results, [endpointId]: 'failed' }))
      setTestToast({ type: 'error', message: t('services.connection_failed', { message: errorText(e) }) })
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
              : t('services.providers_connected', { count: service.endpoints.length })}
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
                          {t('services.auto_badge')}
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
    {modalOpen && <AddModelModal catalog={catalog} providers={providers} serviceId={id || ''} onClose={() => setModalOpen(false)} onSaved={() => { setModalOpen(false); reloadService() }} />}
    {routingOpen && service && <EditRoutingModal service={service} onClose={() => setRoutingOpen(false)} onSaved={() => { setRoutingOpen(false); reloadService() }} />}
    {editingEndpoint && <EditProviderModal endpoint={editingEndpoint} serviceId={id || ''} onClose={() => setEditingEndpoint(null)} onSaved={() => { setEditingEndpoint(null); reloadService() }} />}
    {probingEndpoint && <ModelProbeModal endpoint={probingEndpoint} serviceId={id || ''} onClose={() => setProbingEndpoint(null)} onSaved={() => { setProbingEndpoint(null); reloadService() }} />}
  </Page>
}
