import { Dispatch, FormEvent, SetStateAction, useEffect, useRef, useState } from 'react'
import { CheckCircle2, ChevronDown, ChevronRight, Eye, EyeOff, Plus, Settings2, Trash2 } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { saasFetch } from '../../lib/saasApi'
import Select from '../../components/Select'
import { useI18n } from '../../lib/i18n'
import { ErrorMessage, Field, Page, errorText } from './components'
import { emptyEndpoint, endpointComplete, endpointLabel, formatPriceInput, getStrategyOptions, hasCatalogDetails, inferDefaultCapability, modelOptions } from './serviceUtils'
import type { CatalogOffering, CatalogProvider, DraftEndpoint } from './types'

function LegacyNewServicePage() {
  const { t } = useI18n()
  const navigate = useNavigate()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [catalog, setCatalog] = useState<CatalogOffering[]>([])
  const [catalogError, setCatalogError] = useState('')
  const [catalogLoading, setCatalogLoading] = useState(true)
  const [name, setName] = useState('')
  const [strategy, setStrategy] = useState('cost_aware')
  const [endpoints, setEndpoints] = useState<DraftEndpoint[]>([emptyEndpoint()])
  const [expanded, setExpanded] = useState<number[]>([0])
  const [advanced, setAdvanced] = useState<number[]>([])
  const [visibleKeys, setVisibleKeys] = useState<number[]>([])
  const endpointRefs = useRef<Array<HTMLDivElement | null>>([])

  useEffect(() => {
    setCatalogLoading(true)
    saasFetch<{ offerings?: CatalogOffering[]; providers?: CatalogProvider[] }>('/api/saas/model-catalog')
      .then((result) => {
        const groupedModels = result.data?.providers?.flatMap((provider) => provider.models) || []
        const offerings = result.data?.offerings?.length ? result.data.offerings : groupedModels
        setCatalog(offerings)
        if (!offerings.length) setCatalogError('The model catalog is empty. You can still use a custom provider.')
      })
      .catch(() => setCatalogError('The provider catalog could not be loaded. You can still use a custom provider.'))
      .finally(() => setCatalogLoading(false))
  }, [])

  const providers = Array.from(new Map(catalog.map((item) => [item.provider_id, { id: item.provider_id, name: item.provider_name, modelCount: new Set(catalog.filter((model) => model.provider_id === item.provider_id).map((model) => model.model)).size }])).values())
  const providerOptions = [{ id: 'custom', name: 'Custom provider' }, ...providers.map((provider) => ({ id: provider.id, name: provider.name }))]
  const completedCount = endpoints.filter(endpointComplete).length
  const updateEndpoint = (index: number, patch: Partial<DraftEndpoint>) => setEndpoints((items) => items.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item))
  const toggleIndex = (setter: Dispatch<SetStateAction<number[]>>, index: number) => setter((items) => items.includes(index) ? items.filter((item) => item !== index) : [...items, index])

  function selectProvider(index: number, option: { id: string | number; name: string }) {
    const provider = String(option.id)
    const firstModel = catalog.find((item) => item.provider_id === provider)
    updateEndpoint(index, {
      provider_type: provider,
      custom_provider_id: '',
      api_key: '',
      upstream_model_id: firstModel?.model || '',
      base_url: firstModel?.base_url || '',
      input_price_per_1m: firstModel ? formatPriceInput(firstModel.input_price_per_1m) : '',
      output_price_per_1m: firstModel ? formatPriceInput(firstModel.output_price_per_1m) : '',
      capability_score: firstModel ? inferDefaultCapability(firstModel) : '0.70',
      context_length: firstModel?.context_length ? String(firstModel.context_length) : '',
    })
    if (hasCatalogDetails(firstModel)) setAdvanced((items) => items.includes(index) ? items : [...items, index])
  }

  function selectModel(index: number, option: { id: string | number; name: string }) {
    const model = catalog.find((item) => item.provider_id === endpoints[index].provider_type && item.model === String(option.id))
    if (!model) return
    updateEndpoint(index, { upstream_model_id: model.model, base_url: model.base_url, input_price_per_1m: formatPriceInput(model.input_price_per_1m), output_price_per_1m: formatPriceInput(model.output_price_per_1m), capability_score: inferDefaultCapability(model), context_length: model.context_length ? String(model.context_length) : '' })
    if (hasCatalogDetails(model)) setAdvanced((items) => items.includes(index) ? items : [...items, index])
  }

  function addEndpoint() {
    setEndpoints((items) => [...items, emptyEndpoint()])
    setExpanded((items) => [...items, endpoints.length])
  }

  function removeEndpoint(index: number) {
    setEndpoints((items) => items.filter((_, itemIndex) => itemIndex !== index))
    setExpanded((items) => items.filter((item) => item !== index).map((item) => item > index ? item - 1 : item))
    setAdvanced((items) => items.filter((item) => item !== index).map((item) => item > index ? item - 1 : item))
    setVisibleKeys((items) => items.filter((item) => item !== index).map((item) => item > index ? item - 1 : item))
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!name.trim()) { setError('Give this model service a name first.'); return }
    const firstIncomplete = endpoints.findIndex((endpoint) => !endpointComplete(endpoint))
    if (firstIncomplete !== -1) {
      setExpanded((items) => items.includes(firstIncomplete) ? items : [...items, firstIncomplete])
      setError(`Finish Upstream ${firstIncomplete + 1}: provider, model, URL, and API key are required.`)
      window.setTimeout(() => endpointRefs.current[firstIncomplete]?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 0)
      return
    }
    setError(''); setBusy(true)
    try {
      await saasFetch('/api/saas/model-services', { method: 'POST', body: JSON.stringify({
        name,
        strategy,
        endpoints: endpoints.map((endpoint) => ({ ...endpoint, provider_type: endpoint.provider_type === 'custom' ? endpoint.custom_provider_id : endpoint.provider_type, input_price_per_1m: endpoint.input_price_per_1m ? Number(endpoint.input_price_per_1m) : undefined, output_price_per_1m: endpoint.output_price_per_1m ? Number(endpoint.output_price_per_1m) : undefined, capability_score: Number(endpoint.capability_score), context_length: endpoint.context_length ? Number(endpoint.context_length) : undefined })),
      }) })
      navigate('/app/services')
    } catch (e) { setError(errorText(e)) } finally { setBusy(false) }
  }

  return <Page>
    <form onSubmit={submit} className="max-w-3xl space-y-5">
      <div className="rounded-xl border border-zinc-200 bg-white p-6 space-y-5">
        <div>
          <div className="flex items-center justify-between gap-4">
            <div><h1 className="text-xl font-semibold tracking-tight">Create a model service</h1><p className="mt-1 text-sm text-zinc-500">Connect as many provider models as you need behind one public model name.</p></div>
            <span className="hidden shrink-0 rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary sm:inline-flex">{completedCount}/{endpoints.length} ready</span>
          </div>
          <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-zinc-100"><div className="h-full rounded-full bg-primary transition-all" style={{ width: `${completedCount ? 100 : 0}%` }} /></div>
        </div>
        <Field label="Model service name" value={name} onChange={setName} placeholder="Balanced AI routing" />
        <Select label="Routing strategy" options={getStrategyOptions(t)} selected={getStrategyOptions(t).find((item) => item.id === strategy) || getStrategyOptions(t)[0]} onChange={(option) => setStrategy(String(option.id))} />
        <div className="flex gap-3 rounded-lg bg-surface-200 px-4 py-3 text-sm text-zinc-600"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" /><span>All upstreams share one public model. You can use different providers and model names; requests will still be sent through the same Virtual Model.</span></div>
        {catalogLoading && <p className="text-xs text-zinc-500">Loading the provider and model catalog…</p>}
        {catalogError && <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">{catalogError}</p>}
      </div>

      <div className="space-y-3">
        {endpoints.map((endpoint, index) => {
          const customProvider = endpoint.provider_type === 'custom'
          const models = catalog.filter((item) => item.provider_id === endpoint.provider_type)
          const selectedModel = models.find((item) => item.model === endpoint.upstream_model_id)
          const selectedProvider = providers.find((provider) => provider.id === endpoint.provider_type) || { id: 'custom', name: 'Custom provider' }
          const [providerLabel, modelLabel] = endpointLabel(endpoint, catalog, t)
          const isExpanded = expanded.includes(index)
          const isAdvanced = advanced.includes(index)
          const isVisible = visibleKeys.includes(index)
          return <div key={index} ref={(element) => { endpointRefs.current[index] = element }} className="rounded-xl border border-zinc-200 bg-white transition-shadow focus-within:shadow-sm">
            <div className="flex items-center gap-3 p-4 sm:p-5">
              <button type="button" onClick={() => toggleIndex(setExpanded, index)} aria-expanded={isExpanded} className="flex min-w-0 flex-1 items-center gap-3 text-left">
                {isExpanded ? <ChevronDown className="h-5 w-5 shrink-0 text-zinc-400" /> : <ChevronRight className="h-5 w-5 shrink-0 text-zinc-400" />}
                <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${endpointComplete(endpoint) ? 'bg-emerald-100 text-emerald-700' : 'bg-zinc-100 text-zinc-500'}`}>{endpointComplete(endpoint) ? <CheckCircle2 className="h-4 w-4" /> : index + 1}</span>
                <span className="min-w-0"><span className="block text-sm font-semibold">Upstream {index + 1}</span><span className="block truncate text-xs text-zinc-500">{isExpanded ? 'Configure provider connection' : `Provider: ${providerLabel}; Model: ${modelLabel}`}</span></span>
              </button>
              <button type="button" onClick={() => removeEndpoint(index)} className="shrink-0 rounded-md p-1.5 text-zinc-400 hover:bg-rose-50 hover:text-rose-600" aria-label={`Remove upstream ${index + 1}`}><Trash2 className="h-4 w-4" /></button>
            </div>
            {isExpanded && <div className="space-y-5 border-t border-zinc-100 p-4 sm:p-5">
              <div className="grid gap-5 sm:grid-cols-2">
                <Select label="Provider" options={providerOptions} selected={selectedProvider} onChange={(option) => selectProvider(index, option)} />
                {customProvider ? <Field alignWithSelect label="Provider ID" value={endpoint.custom_provider_id} onChange={(value) => updateEndpoint(index, { custom_provider_id: value })} placeholder="my-provider" /> : <Select label="Model" options={modelOptions(models)} selected={selectedModel ? { id: selectedModel.model, name: selectedModel.model_name } : { id: '', name: 'Select a model' }} onChange={(option) => selectModel(index, option)} />}
              </div>
              {customProvider && <Field alignWithSelect label="Model" value={endpoint.upstream_model_id} onChange={(value) => updateEndpoint(index, { upstream_model_id: value })} placeholder="provider-model-name" />}
              <Field label="Provider API base URL" value={endpoint.base_url} onChange={(value) => updateEndpoint(index, { base_url: value })} placeholder="https://api.example.com/v1" />
              <label className="block text-sm font-medium">Provider API key<div className="relative mt-2"><input required type={isVisible ? 'text' : 'password'} value={endpoint.api_key} onChange={(event) => updateEndpoint(index, { api_key: event.target.value })} placeholder="Paste your provider key" className="w-full rounded-lg border border-zinc-300 px-3 py-2.5 pr-10 outline-none focus:border-primary" /><button type="button" onClick={() => toggleIndex(setVisibleKeys, index)} className="absolute inset-y-0 right-0 px-3 text-zinc-400 hover:text-zinc-700" aria-label={isVisible ? 'Hide API key' : 'Show API key'}>{isVisible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</button></div><span className="mt-1 block text-xs font-normal text-zinc-400">Used only for this upstream connection. It is not shown to the other providers.</span></label>
              <button type="button" onClick={() => toggleIndex(setAdvanced, index)} className="inline-flex items-center gap-2 text-sm text-zinc-600 hover:text-zinc-950"><Settings2 className="h-4 w-4" /> {isAdvanced ? 'Hide advanced settings' : 'Price and capability settings'}</button>
              {isAdvanced && <div className="grid gap-5 rounded-lg bg-zinc-50 p-4 sm:grid-cols-3 text-zinc-900"><Field required={false} label="Input $/1M" value={endpoint.input_price_per_1m} onChange={(value) => updateEndpoint(index, { input_price_per_1m: value })} placeholder="0.14" /><Field required={false} label="Output $/1M" value={endpoint.output_price_per_1m} onChange={(value) => updateEndpoint(index, { output_price_per_1m: value })} placeholder="0.28" /><Field required={false} label="Capability 0–1" value={endpoint.capability_score} onChange={(value) => updateEndpoint(index, { capability_score: value })} placeholder="0.5" /><Field label="Context length" required={false} value={endpoint.context_length} onChange={(value) => updateEndpoint(index, { context_length: value })} placeholder="128000" /></div>}
              {selectedModel && <div className="space-y-1 text-xs text-zinc-500"><div>{selectedModel.description}</div><div>Context: {selectedModel.context_length ? `${selectedModel.context_length.toLocaleString()} context` : 'Length not listed'}</div><div>Currency: {selectedModel.price_currency}</div></div>}
            </div>}
          </div>
        })}
      </div>

      <button type="button" onClick={addEndpoint} className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-zinc-300 bg-white px-4 py-4 text-sm text-zinc-600 hover:border-primary hover:text-primary"><Plus className="h-4 w-4" /> Add another upstream</button>
      <div className="rounded-lg bg-surface-200 px-4 py-3 text-xs text-zinc-500">The public model works with <code>/v1/chat/completions</code> and <code>/v1/responses</code>. Provider keys stay inside SmartGate.</div>
      {error && <ErrorMessage text={error} />}
      <div className="sticky bottom-4 flex items-center justify-between gap-4 rounded-xl border border-zinc-200 bg-white/95 p-3 shadow-lg backdrop-blur"><span className="hidden text-sm text-zinc-500 sm:inline">{completedCount} of {endpoints.length} upstreams ready</span><button disabled={busy} className="ml-auto rounded-lg bg-zinc-950 px-5 py-3 text-sm text-white disabled:opacity-50">{busy ? 'Creating…' : 'Create model service'}</button></div>
    </form>
  </Page>
}

