import { FormEvent, ReactNode, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import { AlertCircle, CheckCircle2, ChevronDown, ChevronRight, Copy, Eye, EyeOff, LogOut, Plus, Settings2, Trash2, UserCircle } from 'lucide-react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { saasFetch, saasLogout } from '../../lib/saasApi'
import Select from '../../components/Select'

type Service = { id: string; name: string; model: string; provider_type: string; provider_types?: string[]; endpoint_count?: number; strategy: string; health_status: string }
type Key = { id: string; name: string; prefix: string; enabled: boolean; daily_spend_limit?: number; created_at: string; last_used_at?: string }

export function SaasLayout({ children }: { children: ReactNode }) {
  const location = useLocation()
  const [email, setEmail] = useState('')
  const [accountOpen, setAccountOpen] = useState(false)
  const accountRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    saasFetch<{ email: string }>('/api/saas/auth/me')
      .then((result) => setEmail(result.data?.email || ''))
      .catch(() => {})
  }, [])

  useEffect(() => {
    function closeOnOutsideClick(event: MouseEvent) {
      if (accountRef.current && !accountRef.current.contains(event.target as Node)) setAccountOpen(false)
    }
    document.addEventListener('mousedown', closeOnOutsideClick)
    return () => document.removeEventListener('mousedown', closeOnOutsideClick)
  }, [])

  async function logout() {
    await saasLogout()
    window.location.href = '/'
  }

  const links = [
    ['Overview', '/app'],
    ['Model services', '/app/services'],
    ['API keys', '/app/keys'],
    ['Usage', '/app/usage'],
  ]
  const isActive = (href: string) => href === '/app' ? location.pathname === href : location.pathname.startsWith(href)

  return <div className="min-h-screen bg-zinc-50 text-zinc-950">
    <header className="h-16 border-b border-zinc-200 bg-white px-6 md:px-10 flex items-center justify-between">
      <Link to="/app" className="flex items-center gap-3 font-semibold tracking-tight">
        <span className="w-8 h-8 rounded-lg bg-zinc-950 text-white flex items-center justify-center"><span className="w-3.5 h-3.5 border-2 border-white rounded-sm" /></span>
        XGate
      </Link>
      <div ref={accountRef} className="relative">
        <button type="button" onClick={() => setAccountOpen((open) => !open)} aria-expanded={accountOpen} aria-haspopup="menu" className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-zinc-600 hover:bg-zinc-100 hover:text-zinc-950">
          <UserCircle className="h-5 w-5" />
          <span className="hidden max-w-48 truncate sm:inline">{email || 'Account'}</span>
          <ChevronDown className={`h-4 w-4 transition-transform ${accountOpen ? 'rotate-180' : ''}`} />
        </button>
        {accountOpen && <div role="menu" className="absolute right-0 z-20 mt-2 w-56 rounded-xl border border-zinc-200 bg-white p-2 shadow-lg">
          <div className="border-b border-zinc-100 px-3 py-2"><div className="text-xs text-zinc-400">Signed in as</div><div className="mt-1 truncate text-sm font-medium text-zinc-900">{email || 'Account'}</div></div>
          <button type="button" role="menuitem" onClick={logout} className="mt-1 flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-zinc-600 hover:bg-zinc-100 hover:text-zinc-950"><LogOut className="h-4 w-4" /> Logout</button>
        </div>}
      </div>
    </header>
    <div className="max-w-6xl mx-auto px-6 md:px-10 py-8 grid lg:grid-cols-[220px_1fr] gap-10">
      <aside className="space-y-1">
        <div className="text-xs font-medium uppercase tracking-wider text-zinc-400 px-3 mb-3">Workspace</div>
        {links.map(([label, href]) => <Link key={href} to={href} className={`block rounded-lg px-3 py-2.5 text-sm ${isActive(href) ? 'bg-white text-zinc-950 shadow-sm' : 'text-zinc-600 hover:bg-white hover:text-zinc-950'}`}>{label}</Link>)}
      </aside>
      <main>{children}</main>
    </div>
  </div>
}

export function ServicesPage() {
  const [services, setServices] = useState<Service[]>([])
  const [error, setError] = useState('')
  const load = () => {
    saasFetch<Service[]>('/api/saas/model-services')
      .then((r) => setServices(r.data || []))
      .catch((e: unknown) => setError(errorText(e)))
  }
  useEffect(() => { load() }, [])
  async function remove(id: string) { if (!window.confirm('Remove this model service?')) return; await saasFetch(`/api/saas/model-services/${id}`, { method: 'DELETE' }); load() }
  return <Page action={<Link to="/app/services/new" className="inline-flex items-center gap-2 rounded-lg bg-zinc-950 px-4 py-2.5 text-sm text-white"><Plus className="w-4 h-4" /> Add service</Link>}>
    {error && <ErrorMessage text={error} />}{!services.length ? <Empty text="No model services yet." href="/app/services/new" /> : <div className="space-y-3">{services.map((service) => <div key={service.id} className="bg-white border border-zinc-200 rounded-xl p-5 flex items-center justify-between gap-4"><div><div className="font-medium">{service.name}</div><div className="mt-1 text-sm text-zinc-500">{service.provider_type} · {service.model} · {service.endpoint_count || 1} upstream{(service.endpoint_count || 1) === 1 ? '' : 's'} · {service.strategy}</div></div><div className="flex items-center gap-4"><span className="text-xs text-emerald-600">{service.health_status || 'ready'}</span><button onClick={() => remove(service.id)} className="text-zinc-400 hover:text-rose-600" title="Remove"><Trash2 className="w-4 h-4" /></button></div></div>)}</div>}
  </Page>
}

type CatalogOffering = {
  provider_id: string
  provider_name: string
  endpoint_id: string
  endpoint_key: string
  region: string
  base_url: string
  price_currency: string
  model: string
  model_name: string
  description: string
  input_price_per_1m: number
  output_price_per_1m: number
  supports_tools: boolean
  supports_vision: boolean
  supports_reasoning: boolean
  context_length?: number
}

type CatalogProvider = {
  id: string
  name: string
  model_count: number
  models: CatalogOffering[]
}

const STRATEGIES = [
  { id: 'cost_aware', name: 'Cost aware' },
  { id: 'capability_aware', name: 'Capability aware' },
  { id: 'load_aware', name: 'Load aware' },
  { id: 'round_robin', name: 'Round robin' },
]

type DraftEndpoint = {
  provider_type: string
  custom_provider_id: string
  base_url: string
  api_key: string
  upstream_model_id: string
  input_price_per_1m: string
  output_price_per_1m: string
  capability_score: string
  context_length: string
}

const emptyEndpoint = (): DraftEndpoint => ({ provider_type: 'custom', custom_provider_id: '', base_url: '', api_key: '', upstream_model_id: '', input_price_per_1m: '', output_price_per_1m: '', capability_score: '0.5', context_length: '' })

function endpointComplete(endpoint: DraftEndpoint) {
  return Boolean(
    (endpoint.provider_type !== 'custom' || endpoint.custom_provider_id.trim()) &&
    endpoint.base_url.trim() &&
    endpoint.api_key.trim() &&
    endpoint.upstream_model_id.trim()
  )
}

function endpointLabel(endpoint: DraftEndpoint, catalog: CatalogOffering[]) {
  const provider = catalog.find((item) => item.provider_id === endpoint.provider_type)?.provider_name
  return [provider || (endpoint.custom_provider_id || 'Provider not selected'), endpoint.upstream_model_id || 'Model not selected']
}

export function NewServicePage() {
  const navigate = useNavigate()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [catalog, setCatalog] = useState<CatalogOffering[]>([])
  const [catalogError, setCatalogError] = useState('')
  const [catalogLoading, setCatalogLoading] = useState(true)
  const [name, setName] = useState('')
  const [strategy, setStrategy] = useState('cost_aware')
  const [endpoints, setEndpoints] = useState<DraftEndpoint[]>([emptyEndpoint(), emptyEndpoint(), emptyEndpoint()])
  const [expanded, setExpanded] = useState<number[]>([0, 1, 2])
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
  const providerOptions = [...providers.map((provider) => ({ id: provider.id, name: `${provider.name} · ${provider.modelCount} models` })), { id: 'custom', name: 'Custom provider' }]
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
      input_price_per_1m: firstModel ? String(firstModel.input_price_per_1m) : '',
      output_price_per_1m: firstModel ? String(firstModel.output_price_per_1m) : '',
      capability_score: firstModel ? String(firstModel.supports_reasoning ? 0.8 : 0.5) : '0.5',
      context_length: firstModel?.context_length ? String(firstModel.context_length) : '',
    })
  }

  function selectModel(index: number, option: { id: string | number; name: string }) {
    const model = catalog.find((item) => item.provider_id === endpoints[index].provider_type && item.model === String(option.id))
    if (!model) return
    updateEndpoint(index, { upstream_model_id: model.model, base_url: model.base_url, input_price_per_1m: String(model.input_price_per_1m), output_price_per_1m: String(model.output_price_per_1m), capability_score: String(model.supports_reasoning ? 0.8 : 0.5), context_length: model.context_length ? String(model.context_length) : '' })
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
    if (endpoints.length < 3) { setError('Add at least 3 upstream endpoints for a mixed model service.'); return }
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
            <div><h1 className="text-xl font-semibold tracking-tight">Create a mixed model service</h1><p className="mt-1 text-sm text-zinc-500">Connect 3-4 providers behind one model name and let XGate route requests between them.</p></div>
            <span className="hidden shrink-0 rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary sm:inline-flex">{completedCount}/{endpoints.length} ready</span>
          </div>
          <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-zinc-100"><div className="h-full rounded-full bg-primary transition-all" style={{ width: `${Math.min((completedCount / 3) * 100, 100)}%` }} /></div>
        </div>
        <Field label="Model service name" value={name} onChange={setName} placeholder="Balanced AI routing" />
        <Select label="Routing strategy" options={STRATEGIES} selected={STRATEGIES.find((item) => item.id === strategy) || STRATEGIES[0]} onChange={(option) => setStrategy(String(option.id))} />
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
          const [providerLabel, modelLabel] = endpointLabel(endpoint, catalog)
          const isExpanded = expanded.includes(index)
          const isAdvanced = advanced.includes(index)
          const isVisible = visibleKeys.includes(index)
          return <div key={index} ref={(element) => { endpointRefs.current[index] = element }} className="rounded-xl border border-zinc-200 bg-white transition-shadow focus-within:shadow-sm">
            <div className="flex items-center gap-3 p-4 sm:p-5">
              <button type="button" onClick={() => toggleIndex(setExpanded, index)} aria-expanded={isExpanded} className="flex min-w-0 flex-1 items-center gap-3 text-left">
                {isExpanded ? <ChevronDown className="h-5 w-5 shrink-0 text-zinc-400" /> : <ChevronRight className="h-5 w-5 shrink-0 text-zinc-400" />}
                <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${endpointComplete(endpoint) ? 'bg-emerald-100 text-emerald-700' : 'bg-zinc-100 text-zinc-500'}`}>{endpointComplete(endpoint) ? <CheckCircle2 className="h-4 w-4" /> : index + 1}</span>
                <span className="min-w-0"><span className="block text-sm font-semibold">Upstream {index + 1}</span><span className="block truncate text-xs text-zinc-500">{isExpanded ? 'Configure provider connection' : `${providerLabel} · ${modelLabel}`}</span></span>
              </button>
              {endpoints.length > 3 && <button type="button" onClick={() => removeEndpoint(index)} className="shrink-0 rounded-md p-1.5 text-zinc-400 hover:bg-rose-50 hover:text-rose-600" aria-label={`Remove upstream ${index + 1}`}><Trash2 className="h-4 w-4" /></button>}
            </div>
            {isExpanded && <div className="space-y-5 border-t border-zinc-100 p-4 sm:p-5">
              <div className="grid gap-5 sm:grid-cols-2">
                <Select label="Provider" options={providerOptions} selected={selectedProvider} onChange={(option) => selectProvider(index, option)} />
                {customProvider ? <Field label="Provider ID" value={endpoint.custom_provider_id} onChange={(value) => updateEndpoint(index, { custom_provider_id: value })} placeholder="my-provider" /> : <Select label="Model" options={models.map((item) => ({ id: item.model, name: `${item.model_name} (${item.model})` }))} selected={selectedModel ? { id: selectedModel.model, name: `${selectedModel.model_name} (${selectedModel.model})` } : { id: '', name: 'Select a model' }} onChange={(option) => selectModel(index, option)} />}
              </div>
              {customProvider && <Field label="Model" value={endpoint.upstream_model_id} onChange={(value) => updateEndpoint(index, { upstream_model_id: value })} placeholder="provider-model-name" />}
              <Field label="OpenAI-compatible base URL" value={endpoint.base_url} onChange={(value) => updateEndpoint(index, { base_url: value })} placeholder="https://api.example.com/v1" />
              <label className="block text-sm font-medium">Provider API key<div className="relative mt-2"><input required type={isVisible ? 'text' : 'password'} value={endpoint.api_key} onChange={(event) => updateEndpoint(index, { api_key: event.target.value })} placeholder="Paste your provider key" className="w-full rounded-lg border border-zinc-300 px-3 py-2.5 pr-10 outline-none focus:border-primary" /><button type="button" onClick={() => toggleIndex(setVisibleKeys, index)} className="absolute inset-y-0 right-0 px-3 text-zinc-400 hover:text-zinc-700" aria-label={isVisible ? 'Hide API key' : 'Show API key'}>{isVisible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</button></div><span className="mt-1 block text-xs font-normal text-zinc-400">Used only for this upstream connection. It is not shown to the other providers.</span></label>
              <button type="button" onClick={() => toggleIndex(setAdvanced, index)} className="inline-flex items-center gap-2 text-sm text-zinc-600 hover:text-zinc-950"><Settings2 className="h-4 w-4" /> {isAdvanced ? 'Hide advanced settings' : 'Price and capability settings'}</button>
              {isAdvanced && <div className="grid gap-5 rounded-lg bg-zinc-50 p-4 sm:grid-cols-3"><Field required={false} label="Input $/1M" value={endpoint.input_price_per_1m} onChange={(value) => updateEndpoint(index, { input_price_per_1m: value })} placeholder="0.14" /><Field required={false} label="Output $/1M" value={endpoint.output_price_per_1m} onChange={(value) => updateEndpoint(index, { output_price_per_1m: value })} placeholder="0.28" /><Field required={false} label="Capability 0–1" value={endpoint.capability_score} onChange={(value) => updateEndpoint(index, { capability_score: value })} placeholder="0.5" /><Field label="Context length" required={false} value={endpoint.context_length} onChange={(value) => updateEndpoint(index, { context_length: value })} placeholder="128000" /></div>}
              {selectedModel && <p className="text-xs text-zinc-500">{selectedModel.description} · {selectedModel.context_length ? `${selectedModel.context_length.toLocaleString()} context` : 'Context length not listed'} · {selectedModel.price_currency}</p>}
            </div>}
          </div>
        })}
      </div>

      {endpoints.length < 4 && <button type="button" onClick={addEndpoint} className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-zinc-300 bg-white px-4 py-4 text-sm text-zinc-600 hover:border-primary hover:text-primary"><Plus className="h-4 w-4" /> Add optional fourth upstream</button>}
      <div className="flex gap-3 rounded-lg bg-surface-200 px-4 py-3 text-xs text-zinc-500"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /><span>At least 3 upstreams are required. Price and capability values can be left at their defaults unless you use cost-aware or capability-aware routing.</span></div>
      <div className="rounded-lg bg-surface-200 px-4 py-3 text-xs text-zinc-500">The public model works with <code>/v1/chat/completions</code> and <code>/v1/responses</code>. Provider keys stay inside XGate.</div>
      {error && <ErrorMessage text={error} />}
      <div className="sticky bottom-4 flex items-center justify-between gap-4 rounded-xl border border-zinc-200 bg-white/95 p-3 shadow-lg backdrop-blur"><span className="hidden text-sm text-zinc-500 sm:inline">{completedCount} of {endpoints.length} upstreams ready</span><button disabled={busy} className="ml-auto rounded-lg bg-zinc-950 px-5 py-3 text-sm text-white disabled:opacity-50">{busy ? 'Creating…' : 'Create model service'}</button></div>
    </form>
  </Page>
}

export function KeysPage() {
  const [keys, setKeys] = useState<Key[]>([]); const [name, setName] = useState('Personal key'); const [raw, setRaw] = useState(''); const [error, setError] = useState('')
  const load = () => saasFetch<Key[]>('/api/saas/api-keys').then((r) => setKeys(r.data || [])).catch((e: unknown) => setError(errorText(e)))
  useEffect(() => { load() }, [])
  async function create(event: FormEvent) { event.preventDefault(); try { const result = await saasFetch<{ key: string }>('/api/saas/api-keys', { method: 'POST', body: JSON.stringify({ name }) }); setRaw(result.data?.key || ''); setName('Personal key'); load() } catch (e) { setError(errorText(e)) } }
  async function revoke(id: string) { await saasFetch(`/api/saas/api-keys/${id}`, { method: 'DELETE' }); load() }
  return <Page><form onSubmit={create} className="bg-white border border-zinc-200 rounded-xl p-5 flex flex-col sm:flex-row gap-3"><input required value={name} onChange={(e) => setName(e.target.value)} className="flex-1 rounded-lg border border-zinc-300 px-3 py-2.5" placeholder="Key name" /><button className="inline-flex items-center justify-center gap-2 rounded-lg bg-zinc-950 px-4 py-2.5 text-sm text-white"><Plus className="w-4 h-4" /> Create key</button></form>{raw && <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-5"><div className="text-sm font-medium text-amber-900">Copy this key now. It will not be shown again.</div><div className="mt-3 flex gap-2"><code className="flex-1 break-all rounded-lg bg-white border border-amber-200 px-3 py-2 text-sm">{raw}</code><button onClick={() => navigator.clipboard.writeText(raw)} className="p-2 rounded-lg border border-amber-300"><Copy className="w-4 h-4" /></button></div></div>}{error && <ErrorMessage text={error} />}<div className="mt-6 space-y-3">{keys.map((key) => <div key={key.id} className="bg-white border border-zinc-200 rounded-xl p-5 flex justify-between gap-4"><div><div className="font-medium">{key.name}</div><div className="mt-1 font-mono text-sm text-zinc-500">{key.prefix}••••••••</div><div className="mt-2 text-xs text-zinc-400">Created {key.created_at}{key.last_used_at ? ` · Last used ${key.last_used_at}` : ''}</div></div><button onClick={() => revoke(key.id)} className="self-start text-xs text-rose-600">Revoke</button></div>)}</div></Page>
}

export function UsagePage() {
  const [data, setData] = useState<any>(null)
  const [savings, setSavings] = useState<any>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    Promise.all([
      saasFetch('/api/saas/usage?range=30d'),
      saasFetch('/api/saas/savings?range=30d'),
    ])
      .then(([usage, savingsResult]) => { setData(usage.data); setSavings(savingsResult.data) })
      .catch((e: unknown) => setError(errorText(e)))
  }, [])

  return <Page>
    {error && <ErrorMessage text={error} />}
    <div className="grid sm:grid-cols-2 xl:grid-cols-4 gap-4">
      <Stat label="Requests" value={(data?.requests || 0).toLocaleString()} />
      <Stat label="Tokens" value={(data?.total_tokens || 0).toLocaleString()} />
      <Stat label="Estimated spend" value={`$${(data?.estimated_spend || 0).toFixed(4)}`} />
      <Stat label="Success rate" value={`${((data?.success_rate || 0) * 100).toFixed(1)}%`} />
    </div>
    {data?.budget && <div className="mt-6 rounded-xl bg-white border border-zinc-200 p-5"><div className="flex justify-between text-sm"><span>Today’s budget</span><span className="font-mono">{data.budget.daily_limit ? `$${data.budget.spent_today.toFixed(4)} / $${data.budget.daily_limit.toFixed(4)}` : 'No limit set'}</span></div><div className="mt-3 h-2 bg-zinc-100 rounded-full"><div className="h-full bg-zinc-900 rounded-full" style={{ width: `${Math.min((data.budget.daily_limit ? data.budget.spent_today / data.budget.daily_limit : 0) * 100, 100)}%` }} /></div><div className="mt-2 text-xs text-zinc-500">Status: {data.budget.status}</div></div>}
    <section className="mt-6 rounded-xl border border-zinc-200 bg-white p-5">
      <h2 className="font-semibold">Savings</h2>
      <p className="mt-1 text-sm text-zinc-500">Signals produced by cost-aware routing and context reduction. This is not a provider bill.</p>
      <div className="mt-5 grid sm:grid-cols-2 gap-4">
        <Stat label="Context characters trimmed" value={(savings?.trimmed_chars || data?.trimmed_chars || 0).toLocaleString()} />
        <Stat label="Estimated dollar savings" value={savings?.estimated_savings == null ? 'Not available' : `$${Number(savings.estimated_savings).toFixed(4)}`} />
      </div>
      <p className="mt-4 text-xs text-zinc-500">{savings?.basis || 'Savings are calculated when a comparison baseline is available.'}</p>
    </section>
  </Page>
}

function errorText(error: unknown) { return error instanceof globalThis.Error ? error.message : 'Something went wrong' }
function Page({ action, children }: { title?: string; subtitle?: string; action?: ReactNode; children: ReactNode }) { return <div>{action && <div className="flex justify-end">{action}</div>}<div className={action ? 'mt-6' : ''}>{children}</div></div> }
function Field({ label, value, onChange, placeholder, type = 'text', required = true }: { label: string; value: string; onChange: (value: string) => void; placeholder?: string; type?: string; required?: boolean }) { return <label className="block text-sm font-medium">{label}<input required={required} type={type} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className="mt-2 w-full rounded-lg border border-zinc-300 px-3 py-2.5 outline-none focus:border-zinc-950" /></label> }
function Stat({ label, value }: { label: string; value: string }) { return <div className="bg-white border border-zinc-200 rounded-xl p-5"><div className="text-xs text-zinc-500">{label}</div><div className="mt-2 font-mono text-2xl font-semibold">{value}</div></div> }
function ErrorMessage({ text }: { text: string }) { return <div className="mb-4 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{text}</div> }
function Empty({ text, href }: { text: string; href: string }) { return <Link to={href} className="block rounded-xl border border-dashed border-zinc-300 bg-white p-8 text-sm text-zinc-500 hover:border-zinc-500">{text} <span aria-hidden="true">→</span></Link> }
