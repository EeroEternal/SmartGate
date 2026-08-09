import { FormEvent, ReactNode, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import { AlertCircle, CheckCircle2, ChevronDown, ChevronRight, Copy, Eye, EyeOff, LogOut, Pencil, Play, Plus, Settings2, Trash2, UserCircle, X } from 'lucide-react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
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
    {error && <ErrorMessage text={error} />}{!services.length ? <Empty text="No model services yet." href="/app/services/new" /> : <div className="space-y-3">{services.map((service) => { const routing = routingInfo(service.strategy); const count = service.endpoint_count || 0; return <div key={service.id} className="bg-white border border-zinc-200 rounded-xl p-5 flex items-center justify-between gap-4"><div className="min-w-0"><div className="font-medium">{service.name}</div><div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-zinc-500"><span>{count} provider{count === 1 ? '' : 's'} connected</span><span className="text-zinc-300">·</span><span>{routing.label}</span></div></div><div className="flex items-center gap-4"><span className={`text-xs ${service.health_status === 'draft' ? 'text-amber-600' : 'text-emerald-600'}`}>{serviceStatusLabel(service.health_status || 'ready')}</span><Link to={`/app/services/${service.id}`} className="text-sm font-medium text-primary hover:text-primary-hover">{service.health_status === 'draft' ? 'Set up' : 'Manage'}</Link><button onClick={() => remove(service.id)} className="text-zinc-400 hover:text-rose-600" title="Remove"><Trash2 className="w-4 h-4" /></button></div></div>})}</div>}
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

function modelOptions(models: CatalogOffering[]) {
  return Array.from(new Map(models.map((item) => [item.model, { id: item.model, name: item.model_name }])).values())
}

function hasCatalogDetails(model: CatalogOffering | undefined) {
  return Boolean(model && (model.input_price_per_1m > 0 || model.output_price_per_1m > 0 || model.context_length || model.supports_tools || model.supports_vision || model.supports_reasoning))
}

const STRATEGIES = [
  { id: 'cost_aware', name: 'Cost-first routing' },
  { id: 'capability_aware', name: 'Capability-first routing' },
  { id: 'load_aware', name: 'Load-balanced routing' },
  { id: 'round_robin', name: 'Even distribution' },
]

const ROUTING_INFO: Record<string, { label: string; description: string }> = {
  cost_aware: { label: 'Cost-first routing', description: 'Prefers the lower-cost provider when it can handle the request.' },
  capability_aware: { label: 'Capability-first routing', description: 'Prefers the provider with the strongest fit for the request.' },
  load_aware: { label: 'Load-balanced routing', description: 'Sends traffic toward providers with more available capacity.' },
  round_robin: { label: 'Even distribution', description: 'Distributes requests evenly across connected providers.' },
}

function routingInfo(strategy: string) {
  return ROUTING_INFO[strategy] || { label: strategy.replaceAll('_', ' '), description: 'Routes requests across your connected providers.' }
}

function serviceStatusLabel(status: string) {
  return status === 'draft' ? 'Setup needed' : 'Ready'
}

type DraftEndpoint = {
  provider_type: string
  custom_provider_id: string
  protocol: string
  base_url: string
  api_key: string
  upstream_model_id: string
  input_price_per_1m: string
  output_price_per_1m: string
  capability_score: string
  context_length: string
}

const emptyEndpoint = (): DraftEndpoint => ({ provider_type: 'custom', custom_provider_id: '', protocol: 'openai', base_url: '', api_key: '', upstream_model_id: '', input_price_per_1m: '', output_price_per_1m: '', capability_score: '0.5', context_length: '' })

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
  const [name, setName] = useState('')
  const [strategy, setStrategy] = useState('cost_aware')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!name.trim()) { setError('Give this model service a name first.'); return }
    setBusy(true); setError('')
    try {
      const result = await saasFetch<{ id: string }>('/api/saas/model-services', { method: 'POST', body: JSON.stringify({ name: name.trim(), strategy }) })
      if (!result.data?.id) throw new Error('The model service was created without an id.')
      navigate(`/app/services/${result.data.id}`)
    } catch (e) { setError(errorText(e)) } finally { setBusy(false) }
  }

  return <Page>
    <form onSubmit={submit} className="max-w-2xl space-y-5">
      <div className="rounded-xl border border-zinc-200 bg-white p-6">
        <h1 className="text-xl font-semibold tracking-tight">Create a model service</h1>
        <div className="mt-6 space-y-5">
          <Field label="Model service name" value={name} onChange={setName} placeholder="fusion" />
          <Select label="Routing strategy" options={STRATEGIES} selected={STRATEGIES.find((item) => item.id === strategy) || STRATEGIES[0]} onChange={(option) => setStrategy(String(option.id))} />
        </div>
        <div className="mt-6 flex gap-3 rounded-lg bg-surface-200 px-4 py-3 text-sm text-zinc-600"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" /><span>Add provider connections after creating the service. They will all use this model name.</span></div>
      </div>
      {error && <ErrorMessage text={error} />}
      <div className="flex justify-end gap-3"><Link to="/app/services" className="rounded-lg border border-zinc-300 px-4 py-2.5 text-sm text-zinc-600">Cancel</Link><button disabled={busy} className="rounded-lg bg-zinc-950 px-5 py-2.5 text-sm text-white disabled:opacity-50">{busy ? 'Creating…' : 'Create model service'}</button></div>
    </form>
  </Page>
}

type ServiceEndpoint = { id: string; provider_id: string; provider_name: string; provider_type: string; protocol: string; model: string; base_url: string; input_price_per_1m: number; output_price_per_1m: number; capability_score: number; context_length?: number }
type ServiceDetails = { id: string; name: string; model: string; strategy: string; status: string; endpoint_count: number; endpoints: ServiceEndpoint[] }

export function ServiceDetailsPage() {
  const { id } = useParams()
  const [service, setService] = useState<ServiceDetails | null>(null)
  const [catalog, setCatalog] = useState<CatalogOffering[]>([])
  const [error, setError] = useState('')
  const [modalOpen, setModalOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const [modelName, setModelName] = useState('')
  const [savingModel, setSavingModel] = useState(false)
  const [editingModel, setEditingModel] = useState(false)
  const [editingEndpoint, setEditingEndpoint] = useState<ServiceEndpoint | null>(null)
  const [testingEndpoint, setTestingEndpoint] = useState<string | null>(null)
  const [testResults, setTestResults] = useState<Record<string, string>>({})
  const load = () => {
    if (!id) return
    saasFetch<ServiceDetails>(`/api/saas/model-services/${id}`).then((result) => { const next = result.data || null; setService(next); if (next) setModelName(next.model) }).catch((e: unknown) => setError(errorText(e)))
  }
  useEffect(() => {
    load()
    saasFetch<{ offerings?: CatalogOffering[]; providers?: CatalogProvider[] }>('/api/saas/model-catalog').then((result) => {
      setCatalog(result.data?.offerings?.length ? result.data.offerings : result.data?.providers?.flatMap((provider) => provider.models) || [])
    }).catch(() => {})
  }, [id])
  async function removeEndpoint(endpointId: string) {
    if (!id || !window.confirm('Remove this model from the service?')) return
    try { await saasFetch(`/api/saas/model-services/${id}/endpoints/${endpointId}`, { method: 'DELETE' }); load() } catch (e) { setError(errorText(e)) }
  }
  async function copyModelName() {
    if (!service?.model) return
    await navigator.clipboard.writeText(service.model)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1800)
  }
  async function testEndpoint(endpointId: string) {
    if (!id) return
    setTestingEndpoint(endpointId); setTestResults((results) => ({ ...results, [endpointId]: '' }))
    try { await saasFetch(`/api/saas/model-services/${id}/endpoints/${endpointId}`, { method: 'POST' }); setTestResults((results) => ({ ...results, [endpointId]: 'Connection passed' })) } catch (e) { setTestResults((results) => ({ ...results, [endpointId]: errorText(e) })) } finally { setTestingEndpoint(null) }
  }
  async function saveModelName(event: FormEvent) {
    event.preventDefault()
    if (!id || !modelName.trim()) return
    setSavingModel(true); setError('')
    try { await saasFetch(`/api/saas/model-services/${id}`, { method: 'PATCH', body: JSON.stringify({ model: modelName.trim() }) }); setEditingModel(false); load() } catch (e) { setError(errorText(e)) } finally { setSavingModel(false) }
  }
  const providers = Array.from(new Map(catalog.map((item) => [item.provider_id, { id: item.provider_id, name: item.provider_name, modelCount: new Set(catalog.filter((model) => model.provider_id === item.provider_id).map((model) => model.model)).size }])).values())
  const routing = service ? routingInfo(service.strategy) : null
  return <Page>
    {error && <ErrorMessage text={error} />}
    {!service ? <div className="rounded-xl border border-zinc-200 bg-white p-6 text-sm text-zinc-500">Loading model service…</div> : <div className="max-w-4xl space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-4"><div><Link to="/app/services" className="text-sm text-zinc-500 hover:text-zinc-950">← Model services</Link><h1 className="mt-3 text-xl font-semibold tracking-tight">{service.name}</h1></div><button type="button" onClick={() => setModalOpen(true)} className="inline-flex items-center gap-2 rounded-lg bg-zinc-950 px-4 py-2.5 text-sm text-white"><Plus className="h-4 w-4" /> Add provider</button></div>
      <section className="rounded-xl border border-zinc-200 bg-white p-5"><div className="grid gap-5 md:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1fr)] md:items-end"><form onSubmit={saveModelName} className="min-w-0"><label className="block text-xs font-medium uppercase tracking-wide text-zinc-400">Model name</label>{editingModel ? <div className="mt-2 flex gap-2"><input autoFocus value={modelName} onChange={(event) => setModelName(event.target.value)} className="min-w-0 flex-1 rounded-lg border border-zinc-300 px-3 py-2.5 text-sm outline-none focus:border-primary" placeholder="fusion" /><button type="submit" disabled={savingModel || !modelName.trim()} className="rounded-lg bg-zinc-950 px-3 py-2.5 text-sm text-white disabled:opacity-50">{savingModel ? 'Saving…' : 'Save'}</button><button type="button" onClick={() => { setEditingModel(false); setModelName(service.model) }} className="rounded-lg border border-zinc-200 px-3 py-2.5 text-sm text-zinc-600">Cancel</button></div> : <div className="mt-2 flex items-center gap-2"><span className="truncate text-lg font-medium text-zinc-950">{service.model}</span><button type="button" onClick={() => setEditingModel(true)} className="rounded-md p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-950" title="Edit model name"><Pencil className="h-4 w-4" /></button><button type="button" onClick={copyModelName} className="rounded-md p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-950" title="Copy model name"><Copy className="h-4 w-4" /></button>{copied && <span className="text-xs text-emerald-600">Copied</span>}</div>}</form><div className="text-sm text-zinc-600"><span className="font-medium text-zinc-950">Routing</span><div className="mt-1 text-zinc-500">{routing?.label}</div></div><div className="text-sm text-zinc-600"><span className="font-medium text-zinc-950">Compatibility</span><div className="mt-1 text-zinc-500">OpenAI Chat · Responses · Anthropic</div></div></div></section>
      <div className="rounded-xl border border-zinc-200 bg-white p-5"><div className="flex items-center justify-between"><h2 className="font-semibold">Providers</h2><span className={`rounded-full px-3 py-1 text-xs font-medium ${service.status === 'draft' ? 'bg-amber-50 text-amber-700' : 'bg-emerald-50 text-emerald-700'}`}>{service.status === 'draft' ? 'Setup needed' : 'Ready'}</span></div>{service.endpoints.length ? <div className="mt-5 space-y-3">{service.endpoints.map((endpoint) => <div key={endpoint.id} className="rounded-lg border border-zinc-200 p-4"><div className="flex items-start justify-between gap-4"><div className="min-w-0"><div className="font-medium text-zinc-950">{endpoint.provider_name}</div><div className="mt-2 text-sm text-zinc-500">{endpoint.model}</div></div><div className="flex shrink-0 items-start gap-3"><div className="text-right"><div className="text-xs text-zinc-400">Provider ID</div><div className="mt-1 max-w-56 truncate text-xs text-zinc-500" title={endpoint.provider_id}>{endpoint.provider_id}</div></div><div className="flex items-center gap-1"><button type="button" onClick={() => setEditingEndpoint(endpoint)} className="rounded-md p-2 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-950" title="Edit provider"><Pencil className="h-4 w-4" /></button><button type="button" onClick={() => testEndpoint(endpoint.id)} disabled={testingEndpoint === endpoint.id} className="rounded-md p-2 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-950 disabled:opacity-50" title="Test connection"><Play className="h-4 w-4" /></button><button type="button" onClick={() => removeEndpoint(endpoint.id)} className="rounded-md p-2 text-zinc-400 hover:bg-rose-50 hover:text-rose-600" title="Remove provider"><Trash2 className="h-4 w-4" /></button></div></div></div>{testResults[endpoint.id] && <p className={`mt-3 text-xs ${testResults[endpoint.id] === 'Connection passed' ? 'text-emerald-600' : 'text-rose-600'}`}>{testResults[endpoint.id]}</p>}</div>)}</div> : <div className="mt-5 rounded-lg border border-dashed border-zinc-300 px-5 py-8 text-center"><p className="text-sm text-zinc-500">No providers connected yet.</p><button type="button" onClick={() => setModalOpen(true)} className="mt-3 text-sm font-medium text-primary hover:text-primary-hover">Add provider</button></div>}</div>
    </div>}
    {modalOpen && <AddModelModal catalog={catalog} providers={providers} serviceId={id || ''} onClose={() => setModalOpen(false)} onSaved={() => { setModalOpen(false); load() }} />}
    {editingEndpoint && <EditProviderModal endpoint={editingEndpoint} serviceId={id || ''} onClose={() => setEditingEndpoint(null)} onSaved={() => { setEditingEndpoint(null); load() }} />}
  </Page>
}

function EditProviderModal({ endpoint, serviceId, onClose, onSaved }: { endpoint: ServiceEndpoint; serviceId: string; onClose: () => void; onSaved: () => void }) {
  const [providerName, setProviderName] = useState(endpoint.provider_name)
  const [providerType] = useState(endpoint.provider_type)
  const [protocol, setProtocol] = useState(endpoint.protocol || 'openai')
  const [baseUrl, setBaseUrl] = useState(endpoint.base_url)
  const [model, setModel] = useState(endpoint.model)
  const [apiKey, setApiKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError('')
    try {
      await saasFetch(`/api/saas/model-services/${serviceId}/endpoints/${endpoint.id}`, { method: 'PATCH', body: JSON.stringify({ provider_name: providerName.trim(), provider_type: providerType, protocol, base_url: baseUrl.trim(), api_key: apiKey || undefined, upstream_model_id: model.trim(), input_price_per_1m: endpoint.input_price_per_1m, output_price_per_1m: endpoint.output_price_per_1m, capability_score: endpoint.capability_score, context_length: endpoint.context_length }) })
      onSaved()
    } catch (e) { setError(errorText(e)) } finally { setBusy(false) }
  }
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/30 p-4" role="dialog" aria-modal="true"><form onSubmit={submit} className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl"><div className="flex items-start justify-between gap-4"><div><h2 className="text-lg font-semibold">Edit provider</h2></div><button type="button" onClick={onClose} className="rounded-lg p-2 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-950" aria-label="Close"><X className="h-5 w-5" /></button></div><div className="mt-6 space-y-5"><div className="grid gap-5 sm:grid-cols-2"><Field label="Provider name" value={providerName} onChange={setProviderName} placeholder="DeepSeek" /><label className="block text-sm font-medium text-zinc-700">Provider ID<input readOnly value={endpoint.provider_id} className="mt-2 w-full rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2.5 text-zinc-500 outline-none" /></label></div><div className="grid gap-5 sm:grid-cols-2"><Field label="Model" value={model} onChange={setModel} placeholder="deepseek-chat" /><Select label="Protocol" options={[{ id: 'openai', name: 'OpenAI' }, { id: 'anthropic', name: 'Anthropic' }]} selected={{ id: protocol, name: protocol === 'anthropic' ? 'Anthropic' : 'OpenAI' }} onChange={(option) => setProtocol(String(option.id))} /></div><Field label="Provider API base URL" value={baseUrl} onChange={setBaseUrl} placeholder="https://api.example.com/v1" /><Field label="New Provider API key (optional)" value={apiKey} onChange={setApiKey} placeholder="Leave blank to keep the current key" type="password" /></div>{error && <ErrorMessage text={error} />}<div className="mt-6 flex justify-end gap-3"><button type="button" onClick={onClose} className="rounded-lg border border-zinc-300 px-4 py-2.5 text-sm text-zinc-600">Cancel</button><button disabled={busy} className="rounded-lg bg-zinc-950 px-5 py-2.5 text-sm text-white disabled:opacity-50">{busy ? 'Saving…' : 'Save changes'}</button></div></form></div>
}

function AddModelModal({ catalog, providers, serviceId, onClose, onSaved }: { catalog: CatalogOffering[]; providers: { id: string; name: string; modelCount: number }[]; serviceId: string; onClose: () => void; onSaved: () => void }) {
  const [draft, setDraft] = useState<DraftEndpoint>(emptyEndpoint())
  const [visible, setVisible] = useState(false)
  const [advanced, setAdvanced] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const custom = draft.provider_type === 'custom'
  const models = catalog.filter((item) => item.provider_id === draft.provider_type)
  const providerOptions = [{ id: 'custom', name: 'Custom provider' }, ...providers.map((provider) => ({ id: provider.id, name: provider.name }))]
  const selectedProvider = providers.find((provider) => provider.id === draft.provider_type) || { id: 'custom', name: 'Custom provider' }
  const protocolOptions = [{ id: 'openai', name: 'OpenAI' }, { id: 'anthropic', name: 'Anthropic' }]
  const selectedProtocol = protocolOptions.find((option) => option.id === draft.protocol) || protocolOptions[0]
  const selectedModel = models.find((item) => item.model === draft.upstream_model_id)
  const patch = (value: Partial<DraftEndpoint>) => setDraft((current) => ({ ...current, ...value }))
  function chooseProvider(option: { id: string | number; name: string }) {
    const provider = String(option.id); const first = catalog.find((item) => item.provider_id === provider)
    const protocol = /anthropic|claude/i.test(provider) ? 'anthropic' : 'openai'
    setDraft({ ...emptyEndpoint(), provider_type: provider, protocol, upstream_model_id: first?.model || '', base_url: first?.base_url || '', input_price_per_1m: first ? String(first.input_price_per_1m) : '', output_price_per_1m: first ? String(first.output_price_per_1m) : '', capability_score: first ? String(first.supports_reasoning ? 0.8 : 0.5) : '0.5', context_length: first?.context_length ? String(first.context_length) : '' })
    setAdvanced(hasCatalogDetails(first))
  }
  function chooseModel(option: { id: string | number; name: string }) {
    const model = models.find((item) => item.model === String(option.id)); if (!model) return
    patch({ upstream_model_id: model.model, base_url: model.base_url, input_price_per_1m: String(model.input_price_per_1m), output_price_per_1m: String(model.output_price_per_1m), capability_score: String(model.supports_reasoning ? 0.8 : 0.5), context_length: model.context_length ? String(model.context_length) : '' })
    if (model.input_price_per_1m || model.output_price_per_1m || model.context_length || model.supports_reasoning) setAdvanced(true)
  }
  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!endpointComplete(draft)) { setError('Provider, model, URL, and API key are required.'); return }
    setBusy(true); setError('')
    try { await saasFetch(`/api/saas/model-services/${serviceId}/endpoints`, { method: 'POST', body: JSON.stringify({ provider_type: custom ? draft.custom_provider_id : draft.provider_type, provider_name: custom ? draft.custom_provider_id : selectedProvider.name, protocol: draft.protocol, base_url: draft.base_url, api_key: draft.api_key, upstream_model_id: draft.upstream_model_id, input_price_per_1m: draft.input_price_per_1m ? Number(draft.input_price_per_1m) : undefined, output_price_per_1m: draft.output_price_per_1m ? Number(draft.output_price_per_1m) : undefined, capability_score: Number(draft.capability_score), context_length: draft.context_length ? Number(draft.context_length) : undefined }) }); onSaved() } catch (e) { setError(errorText(e)) } finally { setBusy(false) }
  }
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/30 p-4" role="dialog" aria-modal="true"><form onSubmit={submit} className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl"><div className="flex items-start justify-between gap-4"><div><h2 className="text-lg font-semibold">Add provider</h2></div><button type="button" onClick={onClose} className="rounded-lg p-2 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-950" aria-label="Close"><X className="h-5 w-5" /></button></div><div className="mt-6 space-y-5"><div className="grid gap-5 sm:grid-cols-2"><Select label="Provider" options={providerOptions} selected={selectedProvider} onChange={chooseProvider} />{custom ? <Field alignWithSelect label="Provider ID" value={draft.custom_provider_id} onChange={(value) => patch({ custom_provider_id: value })} placeholder="my-provider" /> : <Select label="Model" options={modelOptions(models)} selected={selectedModel ? { id: selectedModel.model, name: selectedModel.model_name } : { id: '', name: 'Select a model' }} onChange={chooseModel} />}</div><div className="grid gap-5 sm:grid-cols-2">{custom ? <Field alignWithSelect label="Model" value={draft.upstream_model_id} onChange={(value) => patch({ upstream_model_id: value })} placeholder="provider-model-name" /> : <div /> }<Select label="Protocol" options={protocolOptions} selected={selectedProtocol} onChange={(option) => patch({ protocol: String(option.id) })} /></div><Field label="Provider API base URL" value={draft.base_url} onChange={(value) => patch({ base_url: value })} placeholder="https://api.example.com/v1" /><label className="block text-sm font-medium">Provider API key<div className="relative mt-2"><input required type={visible ? 'text' : 'password'} value={draft.api_key} onChange={(event) => patch({ api_key: event.target.value })} placeholder="Paste your provider key" className="w-full rounded-lg border border-zinc-300 px-3 py-2.5 pr-10 outline-none focus:border-primary" /><button type="button" onClick={() => setVisible((value) => !value)} className="absolute inset-y-0 right-0 px-3 text-zinc-400" aria-label={visible ? 'Hide API key' : 'Show API key'}>{visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</button></div></label><button type="button" onClick={() => setAdvanced((value) => !value)} className="text-sm text-zinc-700 hover:text-zinc-950">{advanced ? 'Hide advanced settings' : 'Price and capability settings'}</button>{advanced && <div className="grid gap-5 rounded-lg bg-zinc-50 p-4 sm:grid-cols-3 text-zinc-900"><Field required={false} label="Input $/1M" value={draft.input_price_per_1m} onChange={(value) => patch({ input_price_per_1m: value })} placeholder="0.14" /><Field required={false} label="Output $/1M" value={draft.output_price_per_1m} onChange={(value) => patch({ output_price_per_1m: value })} placeholder="0.28" /><Field required={false} label="Capability 0–1" value={draft.capability_score} onChange={(value) => patch({ capability_score: value })} placeholder="0.5" /><Field required={false} label="Context length" value={draft.context_length} onChange={(value) => patch({ context_length: value })} placeholder="128000" /></div>}{selectedModel && <p className="text-xs text-zinc-500">{selectedModel.description} · {selectedModel.context_length ? `${selectedModel.context_length.toLocaleString()} context` : 'Context length not listed'}</p>}</div>{error && <ErrorMessage text={error} />}<div className="mt-6 flex justify-end gap-3"><button type="button" onClick={onClose} className="rounded-lg border border-zinc-300 px-4 py-2.5 text-sm text-zinc-600">Cancel</button><button disabled={busy} className="rounded-lg bg-zinc-950 px-5 py-2.5 text-sm text-white disabled:opacity-50">{busy ? 'Adding…' : 'Add provider'}</button></div></form></div>
}

function LegacyNewServicePage() {
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
      input_price_per_1m: firstModel ? String(firstModel.input_price_per_1m) : '',
      output_price_per_1m: firstModel ? String(firstModel.output_price_per_1m) : '',
      capability_score: firstModel ? String(firstModel.supports_reasoning ? 0.8 : 0.5) : '0.5',
      context_length: firstModel?.context_length ? String(firstModel.context_length) : '',
    })
    if (hasCatalogDetails(firstModel)) setAdvanced((items) => items.includes(index) ? items : [...items, index])
  }

  function selectModel(index: number, option: { id: string | number; name: string }) {
    const model = catalog.find((item) => item.provider_id === endpoints[index].provider_type && item.model === String(option.id))
    if (!model) return
    updateEndpoint(index, { upstream_model_id: model.model, base_url: model.base_url, input_price_per_1m: String(model.input_price_per_1m), output_price_per_1m: String(model.output_price_per_1m), capability_score: String(model.supports_reasoning ? 0.8 : 0.5), context_length: model.context_length ? String(model.context_length) : '' })
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
              {selectedModel && <p className="text-xs text-zinc-500">{selectedModel.description} · {selectedModel.context_length ? `${selectedModel.context_length.toLocaleString()} context` : 'Context length not listed'} · {selectedModel.price_currency}</p>}
            </div>}
          </div>
        })}
      </div>

      <button type="button" onClick={addEndpoint} className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-zinc-300 bg-white px-4 py-4 text-sm text-zinc-600 hover:border-primary hover:text-primary"><Plus className="h-4 w-4" /> Add another upstream</button>
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

type UsageBreakdown = {
  provider?: string
  model?: string
  requests: number
  prompt_tokens: number
  completion_tokens: number
  total_tokens: number
  estimated_spend: number
}

type UsageData = {
  requests: number
  prompt_tokens: number
  completion_tokens: number
  total_tokens: number
  estimated_spend: number
  success_rate: number
  trimmed_chars: number
  budget?: { status: string; spent_today: number; daily_limit: number | null; remaining_today: number | null }
  coverage?: { usage: number; pricing: number; provider_reported_requests: number; priced_requests: number }
  data_quality?: string[]
  breakdowns?: { providers: UsageBreakdown[]; models: UsageBreakdown[] }
}

const money = (value: number | undefined) => `$${(value || 0).toFixed(4)}`
const compactNumber = (value: number | undefined) => (value || 0).toLocaleString()

export function UsagePage() {
  const [data, setData] = useState<UsageData | null>(null)
  const [savings, setSavings] = useState<any>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    Promise.all([
      saasFetch<UsageData>('/api/saas/usage?range=30d'),
      saasFetch('/api/saas/savings?range=30d'),
    ])
      .then(([usage, savingsResult]) => { setData(usage.data || null); setSavings(savingsResult.data) })
      .catch((e: unknown) => setError(errorText(e)))
  }, [])

  const coveragePercent = (value: number | undefined) => `${Math.round((value || 0) * 100)}%`
  const providers = data?.breakdowns?.providers || []
  const models = data?.breakdowns?.models || []
  const maxProviderSpend = Math.max(...providers.map((item) => item.estimated_spend), 0.000001)

  return <Page>
    {error && <ErrorMessage text={error} />}
    <div className="mb-5 flex items-end justify-between gap-4"><div><h1 className="text-xl font-semibold tracking-tight">Usage</h1><p className="mt-1 text-sm text-zinc-500">Automatic statistics from your last 30 days of model calls.</p></div><span className="text-xs text-zinc-400">Provider-reported usage when available</span></div>
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <Stat label="Requests" value={compactNumber(data?.requests)} />
      <Stat label="Total tokens" value={compactNumber(data?.total_tokens)} />
      <Stat label="Estimated spend" value={money(data?.estimated_spend)} />
      <Stat label="Success rate" value={`${((data?.success_rate || 0) * 100).toFixed(1)}%`} />
    </div>

    {data?.coverage && <section className="mt-6 rounded-xl border border-zinc-200 bg-white p-5"><div className="flex items-start justify-between gap-4"><div><h2 className="font-semibold">Data quality</h2><p className="mt-1 text-sm text-zinc-500">Coverage shows how much of the automatic estimate is based on reliable source data.</p></div><span className="rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary">{coveragePercent(data.coverage.usage)} usage coverage</span></div><div className="mt-5 grid gap-4 sm:grid-cols-2"><Coverage label="Provider-reported tokens" value={data.coverage.usage} detail={`${compactNumber(data.coverage.provider_reported_requests)} of ${compactNumber(data.requests)} requests`} /><Coverage label="Configured pricing" value={data.coverage.pricing} detail={`${compactNumber(data.coverage.priced_requests)} of ${compactNumber(data.requests)} requests`} /></div>{Boolean(data.data_quality?.length) && <div className="mt-4 space-y-2">{data.data_quality?.map((message) => <div key={message} className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">{message}</div>)}</div>}</section>}

    <div className="mt-6 grid gap-6 xl:grid-cols-2"><section className="rounded-xl border border-zinc-200 bg-white p-5"><h2 className="font-semibold">By provider</h2><p className="mt-1 text-sm text-zinc-500">Where your requests and estimated spend went.</p>{providers.length ? <div className="mt-5 space-y-4">{providers.map((item) => <div key={item.provider}><div className="flex items-center justify-between gap-4 text-sm"><span className="font-medium">{item.provider}</span><span className="font-mono text-zinc-600">{money(item.estimated_spend)}</span></div><div className="mt-2 h-2 rounded-full bg-zinc-100"><div className="h-full rounded-full bg-primary" style={{ width: `${Math.max((item.estimated_spend / maxProviderSpend) * 100, 2)}%` }} /></div><div className="mt-1 text-xs text-zinc-500">{compactNumber(item.requests)} requests · {compactNumber(item.total_tokens)} tokens</div></div>)}</div> : <p className="mt-5 text-sm text-zinc-500">No usage recorded yet.</p>}</section><section className="rounded-xl border border-zinc-200 bg-white p-5"><h2 className="font-semibold">By model</h2><p className="mt-1 text-sm text-zinc-500">Models are identified from the actual selected upstream endpoint.</p>{models.length ? <div className="mt-5 divide-y divide-zinc-100">{models.slice(0, 10).map((item) => <div key={`${item.provider}-${item.model}`} className="flex items-center justify-between gap-4 py-3 first:pt-0"><div className="min-w-0"><div className="truncate text-sm font-medium">{item.model}</div><div className="mt-1 text-xs text-zinc-500">{item.provider} · {compactNumber(item.requests)} requests · {compactNumber(item.total_tokens)} tokens</div></div><span className="shrink-0 font-mono text-sm text-zinc-600">{money(item.estimated_spend)}</span></div>)}</div> : <p className="mt-5 text-sm text-zinc-500">No usage recorded yet.</p>}</section></div>

    {data?.budget && <div className="mt-6 rounded-xl border border-zinc-200 bg-white p-5"><div className="flex justify-between text-sm"><span>Today’s budget</span><span className="font-mono">{data.budget.daily_limit ? `${money(data.budget.spent_today)} / ${money(data.budget.daily_limit)}` : 'No limit set'}</span></div><div className="mt-3 h-2 rounded-full bg-zinc-100"><div className="h-full rounded-full bg-zinc-900" style={{ width: `${Math.min((data.budget.daily_limit ? data.budget.spent_today / data.budget.daily_limit : 0) * 100, 100)}%` }} /></div><div className="mt-2 text-xs text-zinc-500">Status: {data.budget.status}</div></div>}
    <section className="mt-6 rounded-xl border border-zinc-200 bg-white p-5"><h2 className="font-semibold">Context savings</h2><p className="mt-1 text-sm text-zinc-500">Signals produced by context reduction. This is separate from provider billing.</p><div className="mt-5 grid gap-4 sm:grid-cols-2"><Stat label="Context characters trimmed" value={compactNumber(savings?.trimmed_chars || data?.trimmed_chars)} /><Stat label="Estimated dollar savings" value={savings?.estimated_savings == null ? 'Not available' : money(Number(savings.estimated_savings))} /></div><p className="mt-4 text-xs text-zinc-500">{savings?.basis || 'Savings are calculated when a comparison baseline is available.'}</p></section>
  </Page>
}

function Coverage({ label, value, detail }: { label: string; value: number; detail: string }) { return <div><div className="flex justify-between text-sm"><span>{label}</span><span className="font-mono">{Math.round(value * 100)}%</span></div><div className="mt-2 h-2 rounded-full bg-zinc-100"><div className="h-full rounded-full bg-primary" style={{ width: `${Math.max(value * 100, value > 0 ? 2 : 0)}%` }} /></div><div className="mt-1 text-xs text-zinc-500">{detail}</div></div> }

function errorText(error: unknown) { return error instanceof globalThis.Error ? error.message : 'Something went wrong' }
function Page({ action, children }: { title?: string; subtitle?: string; action?: ReactNode; children: ReactNode }) { return <div>{action && <div className="flex justify-end">{action}</div>}<div className={action ? 'mt-6' : ''}>{children}</div></div> }
function Field({ label, value, onChange, placeholder, type = 'text', required = true, alignWithSelect = false }: { label: string; value: string; onChange: (value: string) => void; placeholder?: string; type?: string; required?: boolean; alignWithSelect?: boolean }) { return <label className="block text-sm font-medium text-zinc-700">{label}<input required={required} type={type} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className={`${alignWithSelect ? 'mt-1 rounded-md py-2' : 'mt-2 rounded-lg py-2.5'} w-full border border-zinc-300 px-3 outline-none focus:border-zinc-950`} /></label> }
function Stat({ label, value }: { label: string; value: string }) { return <div className="bg-white border border-zinc-200 rounded-xl p-5"><div className="text-xs text-zinc-500">{label}</div><div className="mt-2 font-mono text-2xl font-semibold">{value}</div></div> }
function ErrorMessage({ text }: { text: string }) { return <div className="mb-4 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{text}</div> }
function Empty({ text, href }: { text: string; href: string }) { return <Link to={href} className="block rounded-xl border border-dashed border-zinc-300 bg-white p-8 text-sm text-zinc-500 hover:border-zinc-500">{text} <span aria-hidden="true">→</span></Link> }
