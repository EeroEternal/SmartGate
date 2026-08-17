import { FormEvent, ReactNode, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import { AlertCircle, CheckCircle2, ChevronDown, ChevronLeft, ChevronRight, Copy, Eye, EyeOff, ExternalLink, FileCode2, LogOut, Pencil, Plus, Settings2, Trash2, UserCircle, X, Zap } from 'lucide-react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import { saasFetch, saasLogout, saasUpdateProfile } from '../../lib/saasApi'
import Select from '../../components/Select'
import BrandMark from '../../components/BrandMark'
import { useDialog } from '../../components/Dialog'

type Service = { id: string; name: string; model: string; provider_type: string; provider_types?: string[]; endpoint_count?: number; strategy: string; health_status: string }
type Key = { id: string; name: string; prefix: string; enabled: boolean; daily_spend_limit?: number; created_at: string; last_used_at?: string; model_services?: { id: string; name: string }[] }

export function SaasLayout({ children }: { children: ReactNode }) {
  const location = useLocation()
  const [email, setEmail] = useState('')
  const [accountOpen, setAccountOpen] = useState(false)
  const [profileOpen, setProfileOpen] = useState(false)
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
    ['Codex', '/app/codex'],
    ['Analytics', '/app/analytics'],
    ['Usage', '/app/usage'],
  ]
  const isActive = (href: string) => href === '/app' ? location.pathname === href : location.pathname.startsWith(href)

  return <div className="min-h-screen bg-zinc-50 text-zinc-950">
    <header className="h-16 border-b border-zinc-200 bg-white px-6 md:px-10 flex items-center justify-between">
      <Link to="/app" className="flex items-center gap-3 font-semibold tracking-tight">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-white"><BrandMark className="h-5 w-5" /></span>
        XGate
      </Link>
      <div ref={accountRef} className="relative">
        <button type="button" onClick={() => setAccountOpen((open) => !open)} aria-label="Open account menu" aria-expanded={accountOpen} aria-haspopup="menu" className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-zinc-600 hover:bg-zinc-100 hover:text-zinc-950">
          <UserCircle className="h-6 w-6" />
          <ChevronDown className={`h-4 w-4 transition-transform ${accountOpen ? 'rotate-180' : ''}`} />
        </button>
        {accountOpen && <div role="menu" className="absolute right-0 z-20 mt-2 w-64 rounded-xl border border-zinc-200 bg-white p-2 shadow-lg">
          <div className="border-b border-zinc-100 px-3 py-2"><div className="text-xs text-zinc-400">Signed in as</div><div className="mt-1 truncate text-sm font-medium text-zinc-900">{email || 'Account'}</div></div>
          <button type="button" role="menuitem" onClick={() => { setAccountOpen(false); setProfileOpen(true) }} className="mt-1 flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-zinc-600 hover:bg-zinc-100 hover:text-zinc-950"><Pencil className="h-4 w-4" /> Edit profile</button>
          <button type="button" role="menuitem" onClick={logout} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-zinc-600 hover:bg-zinc-100 hover:text-zinc-950"><LogOut className="h-4 w-4" /> Logout</button>
        </div>}
        {profileOpen && <ProfileDialog email={email} onClose={() => setProfileOpen(false)} onSaved={(updatedEmail) => { setEmail(updatedEmail); setProfileOpen(false) }} />}
      </div>
    </header>
    <div className="mx-auto grid max-w-[1440px] min-w-0 gap-8 px-6 py-8 md:px-10 lg:grid-cols-[200px_minmax(0,1fr)]">
      <aside className="min-w-0 space-y-1">
        {links.map(([label, href]) => <Link key={href} to={href} className={`block rounded-lg px-3 py-2.5 text-sm ${isActive(href) ? 'bg-white text-zinc-950 shadow-sm' : 'text-zinc-600 hover:bg-white hover:text-zinc-950'}`}>{label}</Link>)}
      </aside>
      <main className="min-w-0">{children}</main>
    </div>
  </div>
}

export function CodexPage() {
  const profileConfig = `model = "fusion"
model_provider = "xgate"
preferred_auth_method = "apikey"
model_reasoning_effort = "high"
model_catalog_json = "/Users/you/.codex/models.json"

[model_providers.xgate]
name = "XGate"
base_url = "https://api.xgate.sh/v1"
wire_api = "chat_completions"
experimental_bearer_token = "<project-api-key>"`

  const modelCatalog = `{
  "models": [{
    "slug": "fusion",
    "display_name": "Fusion (XGate)",
    "context_window": 128000,
    "max_context_window": 128000,
    "default_reasoning_level": "high",
    "supported_reasoning_levels": [
      {"effort": "low", "description": "Low reasoning effort"},
      {"effort": "high", "description": "High reasoning effort"}
    ],
    "supports_parallel_tool_calls": true,
    "support_verbosity": true,
    "default_verbosity": "low",
    "input_modalities": ["text"],
    "shell_type": "shell_command",
    "visibility": "list",
    "supported_in_api": true,
    "priority": 1,
    "truncation_policy": {"mode": "tokens", "limit": 10000},
    "tool_mode": "code_mode_only",
    "apply_patch_tool_type": "freeform",
    "experimental_supported_tools": [],
    "base_instructions": "You are a helpful coding assistant."
  }]
}`

  return <Page>
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div>
        <div className="flex items-center gap-2 text-sm font-medium text-primary"><FileCode2 className="h-4 w-4" /> Codex integration</div>
        <h1 className="mt-3 text-2xl font-semibold tracking-tight">Use Codex with XGate</h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-500">Connect Codex GUI to an XGate model service through the OpenAI Responses API. Keep Codex as your coding workspace while XGate provides routing, provider fallback, budgets, and usage tracking.</p>
      </div>
      <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-700">Codex supported</div>
    </div>

    <section className="mt-8 grid gap-4 md:grid-cols-3">
      {[
        ['1', 'Create a model service', 'Connect providers and choose the routing strategy for Codex requests.', '/app/services', 'Open model services'],
        ['2', 'Create an API key', 'Authorize the model service so Codex can call it using its service name.', '/app/keys', 'Open API keys'],
        ['3', 'Configure Codex', 'Add the Profile and model catalog below, then restart Codex with the Profile.', null, null],
      ].map(([number, title, text, href, action]) => <div key={number} className="rounded-xl border border-zinc-200 bg-white p-5"><div className="flex h-7 w-7 items-center justify-center rounded-full bg-primary text-xs font-semibold text-white">{number}</div><h2 className="mt-4 font-semibold">{title}</h2><p className="mt-2 text-sm leading-6 text-zinc-500">{text}</p>{href && action && <Link to={href} className="mt-4 inline-flex items-center gap-1 text-sm font-medium text-primary hover:text-primary-hover">{action} <ExternalLink className="h-3.5 w-3.5" /></Link>}</div>)}
    </section>

    <section className="mt-8 rounded-xl border border-zinc-200 bg-white p-5">
      <div className="flex items-start justify-between gap-4"><div><h2 className="font-semibold">Codex Profile</h2><p className="mt-1 text-sm text-zinc-500">Save this as <code>~/.codex/fusion.config.toml</code>. Replace the path, endpoint, model name, and API key with values from this workspace.</p></div><span className="shrink-0 rounded-full bg-zinc-100 px-3 py-1 text-xs text-zinc-600">Profile</span></div>
      <pre className="mt-5 overflow-x-auto rounded-xl bg-zinc-950 p-5 text-xs leading-6 text-zinc-200"><code>{profileConfig}</code></pre>
      <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-900"><strong>Why Chat Completions?</strong> Codex uses the OpenAI Responses API, while XGate translates the request for the configured upstream. For the Fusion Profile, use <code>wire_api = "chat_completions"</code> when the upstream does not accept the Responses API <code>thinking_budget</code> parameter.</div>
    </section>

    <section className="mt-6 rounded-xl border border-zinc-200 bg-white p-5">
      <div><h2 className="font-semibold">Model catalog</h2><p className="mt-1 text-sm text-zinc-500">Save this as <code>~/.codex/models.json</code>. The <code>slug</code> must match the model service name authorized for the API key.</p></div>
      <pre className="mt-5 max-h-[32rem] overflow-auto rounded-xl bg-zinc-950 p-5 text-xs leading-6 text-zinc-200"><code>{modelCatalog}</code></pre>
    </section>

    <section className="mt-6 grid gap-6 lg:grid-cols-2">
      <div className="rounded-xl border border-zinc-200 bg-white p-5"><h2 className="font-semibold">Start Codex</h2><p className="mt-2 text-sm leading-6 text-zinc-500">Use the standalone Profile so Codex does not try to load the model catalog from the base configuration.</p><pre className="mt-4 overflow-x-auto rounded-lg bg-zinc-950 p-4 text-sm text-zinc-200"><code>/Applications/Codex.app/Contents/MacOS/ChatGPT --profile fusion</code></pre><p className="mt-3 text-xs leading-5 text-zinc-500">Restart Codex after changing the Profile or model catalog.</p></div>
      <div className="rounded-xl border border-zinc-200 bg-white p-5"><h2 className="font-semibold">Troubleshooting</h2><div className="mt-4 space-y-3 text-sm"><div className="flex gap-3"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" /><p><strong>401 Unauthorized:</strong> check the project API key and service grant.</p></div><div className="flex gap-3"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" /><p><strong>Reasoning preset error:</strong> use objects with <code>effort</code> and <code>description</code>, not strings.</p></div><div className="flex gap-3"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" /><p><strong>AbsolutePathBuf error:</strong> keep <code>model_catalog_json</code> in the standalone Profile.</p></div></div></div>
    </section>

    <div className="mt-6 rounded-xl border border-zinc-200 bg-zinc-100 p-4 text-xs leading-5 text-zinc-600">Keep <code>experimental_bearer_token</code> private. Do not commit the Profile file when it contains a real key; restrict local permissions and rotate the key if it is exposed.</div>
  </Page>
}

export function ServicesPage() {
  const [services, setServices] = useState<Service[]>([])
  const [error, setError] = useState('')
  const { dialog, showConfirm } = useDialog()
  const load = () => {
    saasFetch<Service[]>('/api/saas/model-services')
      .then((r) => setServices(r.data || []))
      .catch((e: unknown) => setError(errorText(e)))
  }
  useEffect(() => { load() }, [])
  async function remove(id: string) { if (!await showConfirm('Remove this model service?', 'Remove model service?')) return; await saasFetch(`/api/saas/model-services/${id}`, { method: 'DELETE' }); load() }
  return <Page action={<Link to="/app/services/new" className="inline-flex items-center gap-2 rounded-lg bg-zinc-950 px-4 py-2.5 text-sm text-white"><Plus className="w-4 h-4" /> Add service</Link>}>
    {dialog}{error && <ErrorMessage text={error} />}{!services.length ? <Empty text="No model services yet." href="/app/services/new" /> : <div className="space-y-3">{services.map((service) => { const routing = routingInfo(service.strategy); const count = service.endpoint_count || 0; return <div key={service.id} className="bg-white border border-zinc-200 rounded-xl p-5 flex items-center justify-between gap-4"><div className="min-w-0"><div className="font-medium">{service.name}</div><div className="mt-2 space-y-1 text-sm text-zinc-500"><div>{count} provider{count === 1 ? '' : 's'} connected</div><div>{routing.label}</div></div></div><div className="flex items-center gap-4"><span className={`text-xs ${service.health_status === 'draft' ? 'text-amber-600' : 'text-emerald-600'}`}>{serviceStatusLabel(service.health_status || 'ready')}</span><Link to={`/app/services/${service.id}`} className="text-sm font-medium text-primary hover:text-primary-hover">{service.health_status === 'draft' ? 'Set up' : 'Manage'}</Link><button onClick={() => remove(service.id)} className="text-zinc-400 hover:text-rose-600" title="Remove"><Trash2 className="w-4 h-4" /></button></div></div>})}</div>}
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

function inferDefaultCapability(model?: CatalogOffering, modelId?: string): string {
  const name = (model?.model || modelId || '').toLowerCase()
  if (/r1|reasoner|o1|o3|claude-3-5-sonnet|claude-3-7-sonnet|opus|gpt-4\.5/i.test(name)) return '0.96'
  if (/pro|gpt-4o|max|70b|72b|405b|deepseek-chat|deepseek-v3|deepseek-coder/i.test(name)) return '0.92'
  if (model?.supports_reasoning) return '0.85'
  if (/flash|mini|nano|lite|8b|7b|3b|1\.5b|0\.5b/i.test(name)) return '0.65'
  return '0.70'
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

const emptyEndpoint = (): DraftEndpoint => ({ provider_type: 'custom', custom_provider_id: '', protocol: 'openai', base_url: '', api_key: '', upstream_model_id: '', input_price_per_1m: '', output_price_per_1m: '', capability_score: '', context_length: '' })

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
type ServiceDetails = { id: string; name: string; model?: string; strategy: string; status: string; endpoint_count: number; endpoints: ServiceEndpoint[]; judge_enabled?: boolean; judge_endpoint_id?: string }
type CallApi = 'openai-chat' | 'openai-responses' | 'anthropic-messages'

function callExample(api: CallApi, model: string) {
  if (api === 'openai-responses') {
    return {
      label: 'OpenAI Responses',
      path: 'https://api.xgate.sh/v1/responses',
      headers: ['Authorization: Bearer <YOUR_API_KEY>', 'Content-Type: application/json'],
      body: `{"model":"${model}","input":"Hello"}`,
    }
  }
  if (api === 'anthropic-messages') {
    return {
      label: 'Anthropic Messages',
      path: 'https://api.xgate.sh/v1/messages',
      headers: ['Authorization: Bearer <YOUR_API_KEY>', 'anthropic-version: 2023-06-01', 'Content-Type: application/json'],
      body: `{"model":"${model}","max_tokens":128,"messages":[{"role":"user","content":"Hello"}]}`,
    }
  }
  return {
    label: 'OpenAI Chat',
    path: 'https://api.xgate.sh/v1/chat/completions',
    headers: ['Authorization: Bearer <YOUR_API_KEY>', 'Content-Type: application/json'],
    body: `{"model":"${model}","messages":[{"role":"user","content":"Hello"}]}`,
  }
}

export function ServiceDetailsPage() {
  const { id } = useParams()
  const [service, setService] = useState<ServiceDetails | null>(null)
  const [catalog, setCatalog] = useState<CatalogOffering[]>([])
  const [error, setError] = useState('')
  const [modalOpen, setModalOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const [editingEndpoint, setEditingEndpoint] = useState<ServiceEndpoint | null>(null)
  const [testingEndpoint, setTestingEndpoint] = useState<string | null>(null)
  const [testResults, setTestResults] = useState<Record<string, 'passed' | 'failed'>>({})
  const [testToast, setTestToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null)
  const [callApi, setCallApi] = useState<CallApi>('openai-chat')
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
    if (!id || !await showConfirm('Remove this model from the service?', 'Remove provider?')) return
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
      setTestToast({ type: 'success', message: 'Connection passed' })
    } catch (e) {
      setTestResults((results) => ({ ...results, [endpointId]: 'failed' }))
      setTestToast({ type: 'error', message: `Connection failed: ${errorText(e)}` })
    } finally {
      setTestingEndpoint(null)
      window.setTimeout(() => setTestToast(null), 3500)
    }
  }
  const providers = Array.from(new Map(catalog.map((item) => [item.provider_id, { id: item.provider_id, name: item.provider_name, modelCount: new Set(catalog.filter((model) => model.provider_id === item.provider_id).map((model) => model.model)).size }])).values())
  const routing = service ? routingInfo(service.strategy) : null
  return <Page>
    {dialog}
    {error && <ErrorMessage text={error} />}
    {testToast && <div className={`fixed right-6 top-6 z-50 flex items-center gap-2 rounded-lg border px-4 py-3 text-sm shadow-lg ${testToast.type === 'success' ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-rose-200 bg-rose-50 text-rose-700'}`} role="status"><span className={`h-2.5 w-2.5 rounded-full ${testToast.type === 'success' ? 'bg-emerald-500' : 'bg-rose-500'}`} />{testToast.message}</div>}
    {!service ? <div className="rounded-xl border border-zinc-200 bg-white p-6 text-sm text-zinc-500">Loading model service…</div> : <div className="max-w-4xl space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-4"><div><Link to="/app/services" className="text-sm text-zinc-500 hover:text-zinc-950">← Model services</Link><h1 className="mt-3 text-xl font-semibold tracking-tight">{service.name}</h1></div><button type="button" onClick={() => setModalOpen(true)} className="inline-flex items-center gap-2 rounded-lg bg-zinc-950 px-4 py-2.5 text-sm text-white"><Plus className="h-4 w-4" /> Add provider</button></div>
      <section className="rounded-xl border border-zinc-200 bg-white p-5"><div className="grid items-start gap-5 md:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1fr)]"><div className="min-w-0"><label className="block text-xs font-medium uppercase tracking-wide text-zinc-400">Model service</label><div className="mt-2 flex items-center gap-2"><span className="truncate text-lg font-medium text-zinc-950">{service.name}</span><button type="button" onClick={copyServiceName} className="rounded-md p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-950" title="Copy model service name"><Copy className="h-4 w-4" /></button>{copied && <span className="text-xs text-emerald-600">Copied</span>}</div></div><div className="text-sm text-zinc-600"><div className="flex items-center gap-1"><span className="font-medium text-zinc-950">Routing</span><button type="button" onClick={() => setRoutingOpen(true)} className="rounded-md p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-950" title="Edit routing strategy"><Pencil className="h-4 w-4" /></button></div><div className="mt-1 text-zinc-500">{routing?.label}</div>{service.strategy === 'capability_aware' && service.judge_enabled && <div className="mt-1 text-xs text-emerald-600 font-medium">Judge: {service.endpoints.find((ep) => ep.id === service.judge_endpoint_id)?.model || 'Enabled'}</div>}</div><div className="text-sm text-zinc-600"><span className="font-medium text-zinc-950">Supported APIs</span><div className="mt-1 space-y-1 text-zinc-500"><div>OpenAI Chat</div><div>OpenAI Responses</div><div>Anthropic Messages</div></div></div></div></section>
      <CallExamplePanel api={callApi} model={service.name} onChange={setCallApi} />
      <div className="rounded-xl border border-zinc-200 bg-white p-5"><div className="flex items-center justify-between"><h2 className="font-semibold">Providers</h2><span className={`rounded-full px-3 py-1 text-xs font-medium ${service.status === 'draft' ? 'bg-amber-50 text-amber-700' : 'bg-emerald-50 text-emerald-700'}`}>{service.status === 'draft' ? 'Setup needed' : 'Ready'}</span></div>{service.endpoints.length ? <div className="mt-5 space-y-3">{service.endpoints.map((endpoint) => <div key={endpoint.id} className="rounded-lg border border-zinc-200 p-4"><div className="flex items-start justify-between gap-4"><div className="min-w-0"><div className="font-medium text-zinc-950">{endpoint.provider_name}</div><div className="mt-2 text-sm text-zinc-500">{endpoint.model}</div></div><div className="flex shrink-0 items-start gap-3"><div className="text-right"><div className="text-xs text-zinc-400">Provider ID</div><div className="mt-1 max-w-56 truncate text-xs text-zinc-500" title={endpoint.provider_id}>{endpoint.provider_id}</div></div><div className="flex items-center gap-1"><button type="button" onClick={() => setEditingEndpoint(endpoint)} className="rounded-md p-2 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-950" title="Edit provider"><Pencil className="h-4 w-4" /></button><button type="button" onClick={() => testEndpoint(endpoint.id)} disabled={testingEndpoint === endpoint.id} className={`rounded-md p-2 disabled:opacity-50 ${testingEndpoint === endpoint.id ? 'animate-pulse text-zinc-400' : testResults[endpoint.id] === 'passed' ? 'text-emerald-500 hover:bg-emerald-50' : testResults[endpoint.id] === 'failed' ? 'text-rose-500 hover:bg-rose-50' : 'text-zinc-400 hover:bg-zinc-100 hover:text-zinc-950'}`} title="Test connection"><Zap className="h-4 w-4" /></button><button type="button" onClick={() => removeEndpoint(endpoint.id)} className="rounded-md p-2 text-zinc-400 hover:bg-rose-50 hover:text-rose-600" title="Remove provider"><Trash2 className="h-4 w-4" /></button></div></div></div></div>)}</div> : <div className="mt-5 rounded-lg border border-dashed border-zinc-300 px-5 py-8 text-center"><p className="text-sm text-zinc-500">No providers connected yet.</p><button type="button" onClick={() => setModalOpen(true)} className="mt-3 text-sm font-medium text-primary hover:text-primary-hover">Add provider</button></div>}</div>
    </div>}
    {modalOpen && <AddModelModal catalog={catalog} providers={providers} serviceId={id || ''} onClose={() => setModalOpen(false)} onSaved={() => { setModalOpen(false); load() }} />}
    {routingOpen && service && <EditRoutingModal service={service} onClose={() => setRoutingOpen(false)} onSaved={() => { setRoutingOpen(false); load() }} />}
    {editingEndpoint && <EditProviderModal endpoint={editingEndpoint} serviceId={id || ''} onClose={() => setEditingEndpoint(null)} onSaved={() => { setEditingEndpoint(null); load() }} />}
  </Page>
}

function CallExamplePanel({ api, model, onChange }: { api: CallApi; model: string; onChange: (api: CallApi) => void }) {
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
  return <section className="rounded-xl border border-zinc-200 bg-white p-5"><div className="flex flex-wrap items-start justify-between gap-4"><div><h2 className="font-semibold">How to call</h2><p className="mt-1 text-sm text-zinc-500">Use the model service name as the <code className="rounded bg-zinc-100 px-1 py-0.5 text-xs">model</code> value.</p></div><div className="flex rounded-lg border border-zinc-200 bg-zinc-50 p-1" role="tablist" aria-label="API examples">{tabs.map((tab) => <button key={tab.id} type="button" role="tab" aria-selected={api === tab.id} onClick={() => onChange(tab.id)} className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${api === tab.id ? 'bg-white text-zinc-950 shadow-sm' : 'text-zinc-500 hover:text-zinc-950'}`}>{tab.label}</button>)}</div></div><div className="mt-4 overflow-hidden rounded-xl bg-[var(--color-primary-soft)] text-zinc-950"><div className="flex items-center justify-between border-b border-primary/20 px-4 py-3"><span className="text-sm font-medium text-zinc-950">{example.label}</span><div className="flex items-center gap-3"><span className="text-xs text-zinc-950">cURL</span><button type="button" onClick={copyExample} className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-zinc-950 transition-colors hover:bg-white/60" title="Copy example" aria-label="Copy example">{copied ? <CheckCircle2 className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}{copied ? 'Copied' : 'Copy'}</button></div></div><pre role="tabpanel" className="overflow-x-auto p-4 text-xs leading-6 text-zinc-950">{command}</pre></div></section>
}

function EditRoutingModal({ service, onClose, onSaved }: { service: ServiceDetails; onClose: () => void; onSaved: () => void }) {
  const [nextStrategy, setNextStrategy] = useState(service.strategy)
  const [judgeEnabled, setJudgeEnabled] = useState(Boolean(service.judge_enabled))
  const [judgeEndpointId, setJudgeEndpointId] = useState(service.judge_endpoint_id || service.endpoints[0]?.id || '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const selected = STRATEGIES.find((item) => item.id === nextStrategy) || STRATEGIES[0]
  const info = routingInfo(nextStrategy)

  const judgeOptions = service.endpoints.map((ep) => ({
    id: ep.id,
    name: `${ep.provider_name} - ${ep.model}${ep.input_price_per_1m ? ` ($${ep.input_price_per_1m}/1M)` : ''}`,
  }))
  const selectedJudge = judgeOptions.find((opt) => opt.id === judgeEndpointId) || judgeOptions[0] || { id: '', name: 'No endpoints available' }

  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError('')
    try {
      await saasFetch(`/api/saas/model-services/${service.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          strategy: nextStrategy,
          judge_enabled: nextStrategy === 'capability_aware' ? judgeEnabled : false,
          judge_endpoint_id: nextStrategy === 'capability_aware' && judgeEnabled ? (selectedJudge.id || undefined) : undefined,
        }),
      })
      onSaved()
    } catch (e) { setError(errorText(e)) } finally { setBusy(false) }
  }
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/30 p-4" role="dialog" aria-modal="true"><form onSubmit={submit} className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl"><div className="flex items-start justify-between gap-4"><div><h2 className="text-lg font-semibold">Edit routing strategy</h2><p className="mt-1 text-sm text-zinc-500">This applies to new requests for this model service.</p></div><button type="button" onClick={onClose} className="rounded-lg p-2 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-950" aria-label="Close"><X className="h-5 w-5" /></button></div><div className="mt-6 space-y-4"><Select label="Routing strategy" options={STRATEGIES} selected={selected} onChange={(option) => setNextStrategy(String(option.id))} /><p className="text-xs text-zinc-500">{info.description}</p>{nextStrategy === 'capability_aware' && <div className="mt-4 rounded-xl border border-zinc-200 bg-zinc-50 p-4 space-y-3"><label className="flex items-center gap-2.5 text-sm font-medium text-zinc-900 cursor-pointer"><input type="checkbox" checked={judgeEnabled} onChange={(e) => setJudgeEnabled(e.target.checked)} className="h-4 w-4 rounded border-zinc-300 text-zinc-950 focus:ring-zinc-950" /><span>Use auxiliary judge model for complexity</span></label>{judgeEnabled && <div className="space-y-2 pt-1">{judgeOptions.length > 0 ? <Select label="Auxiliary judge model" options={judgeOptions} selected={selectedJudge} onChange={(option) => setJudgeEndpointId(String(option.id))} /> : <p className="text-xs text-amber-600">Please connect at least one provider endpoint first.</p>}<p className="text-xs text-zinc-500">When enabled, requests with ambiguous complexity are pre-checked by this lightweight model before routing to Pro or Flash.</p></div>}</div>}</div>{error && <div className="mt-4"><ErrorMessage text={error} /></div>}<div className="mt-6 flex justify-end gap-3"><button type="button" onClick={onClose} className="rounded-lg border border-zinc-300 px-4 py-2.5 text-sm text-zinc-600">Cancel</button><button disabled={busy} className="rounded-lg bg-zinc-950 px-5 py-2.5 text-sm text-white disabled:opacity-50">{busy ? 'Saving…' : 'Save changes'}</button></div></form></div>
}

function EditProviderModal({ endpoint, serviceId, onClose, onSaved }: { endpoint: ServiceEndpoint; serviceId: string; onClose: () => void; onSaved: () => void }) {
  const [providerName, setProviderName] = useState(endpoint.provider_name)
  const [providerType] = useState(endpoint.provider_type)
  const [protocol, setProtocol] = useState(endpoint.protocol || 'openai')
  const [baseUrl, setBaseUrl] = useState(endpoint.base_url)
  const [model, setModel] = useState(endpoint.model)
  const [apiKey, setApiKey] = useState('')
  const [inputPrice, setInputPrice] = useState(endpoint.input_price_per_1m ? String(endpoint.input_price_per_1m) : '')
  const [outputPrice, setOutputPrice] = useState(endpoint.output_price_per_1m ? String(endpoint.output_price_per_1m) : '')
  const [capabilityScore, setCapabilityScore] = useState(String(endpoint.capability_score ?? '0.70'))
  const [contextLength, setContextLength] = useState(endpoint.context_length ? String(endpoint.context_length) : '')
  const [advanced, setAdvanced] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
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
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/30 p-4" role="dialog" aria-modal="true"><form onSubmit={submit} className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl"><div className="flex items-start justify-between gap-4"><div><h2 className="text-lg font-semibold">Edit provider</h2></div><button type="button" onClick={onClose} className="rounded-lg p-2 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-950" aria-label="Close"><X className="h-5 w-5" /></button></div><div className="mt-6 space-y-5"><div className="grid gap-5 sm:grid-cols-2"><Field label="Provider name" value={providerName} onChange={setProviderName} placeholder="DeepSeek" /><label className="block text-sm font-medium text-zinc-700">Provider ID<input readOnly value={endpoint.provider_id} className="mt-2 w-full rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2.5 text-zinc-500 outline-none" /></label></div><div className="grid gap-5 sm:grid-cols-2"><Field label="Model" value={model} onChange={setModel} placeholder="deepseek-chat" /><Select label="Protocol" options={[{ id: 'openai', name: 'OpenAI' }, { id: 'anthropic', name: 'Anthropic' }]} selected={{ id: protocol, name: protocol === 'anthropic' ? 'Anthropic' : 'OpenAI' }} onChange={(option) => setProtocol(String(option.id))} /></div><Field label="Provider API base URL" value={baseUrl} onChange={setBaseUrl} placeholder="https://api.example.com/v1" /><Field required={false} label="New Provider API key (optional)" value={apiKey} onChange={setApiKey} placeholder="Leave blank to keep the current key" type="password" /><button type="button" onClick={() => setAdvanced((value) => !value)} className="text-sm text-zinc-700 hover:text-zinc-950">{advanced ? 'Hide advanced settings' : 'Price and capability settings'}</button>{advanced && <div className="grid gap-5 rounded-lg bg-zinc-50 p-4 sm:grid-cols-3 text-zinc-900"><Field required={false} label="Input $/1M" value={inputPrice} onChange={setInputPrice} placeholder="0.14" /><Field required={false} label="Output $/1M" value={outputPrice} onChange={setOutputPrice} placeholder="0.28" /><Field required={false} label="Capability 0–1" value={capabilityScore} onChange={setCapabilityScore} placeholder="0.70" /><Field required={false} label="Context length" value={contextLength} onChange={setContextLength} placeholder="128000" /></div>}</div>{error && <ErrorMessage text={error} />}<div className="mt-6 flex justify-end gap-3"><button type="button" onClick={onClose} className="rounded-lg border border-zinc-300 px-4 py-2.5 text-sm text-zinc-600">Cancel</button><button disabled={busy} className="rounded-lg bg-zinc-950 px-5 py-2.5 text-sm text-white disabled:opacity-50">{busy ? 'Saving…' : 'Save changes'}</button></div></form></div>
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
    setDraft({ ...emptyEndpoint(), provider_type: provider, protocol, upstream_model_id: first?.model || '', base_url: first?.base_url || '', input_price_per_1m: first ? String(first.input_price_per_1m) : '', output_price_per_1m: first ? String(first.output_price_per_1m) : '', capability_score: first ? inferDefaultCapability(first) : '0.70', context_length: first?.context_length ? String(first.context_length) : '' })
    setAdvanced(hasCatalogDetails(first))
  }
  function chooseModel(option: { id: string | number; name: string }) {
    const model = models.find((item) => item.model === String(option.id)); if (!model) return
    patch({ upstream_model_id: model.model, base_url: model.base_url, input_price_per_1m: String(model.input_price_per_1m), output_price_per_1m: String(model.output_price_per_1m), capability_score: inferDefaultCapability(model), context_length: model.context_length ? String(model.context_length) : '' })
    if (model.input_price_per_1m || model.output_price_per_1m || model.context_length || model.supports_reasoning) setAdvanced(true)
  }
  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!endpointComplete(draft)) { setError('Provider, model, URL, and API key are required.'); return }
    setBusy(true); setError('')
    try { await saasFetch(`/api/saas/model-services/${serviceId}/endpoints`, { method: 'POST', body: JSON.stringify({ provider_type: custom ? draft.custom_provider_id : draft.provider_type, provider_name: custom ? draft.custom_provider_id : selectedProvider.name, protocol: draft.protocol, base_url: draft.base_url, api_key: draft.api_key, upstream_model_id: draft.upstream_model_id, input_price_per_1m: draft.input_price_per_1m ? Number(draft.input_price_per_1m) : undefined, output_price_per_1m: draft.output_price_per_1m ? Number(draft.output_price_per_1m) : undefined, capability_score: Number(draft.capability_score), context_length: draft.context_length ? Number(draft.context_length) : undefined }) }); onSaved() } catch (e) { setError(errorText(e)) } finally { setBusy(false) }
  }
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/30 p-4" role="dialog" aria-modal="true"><form onSubmit={submit} className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl"><div className="flex items-start justify-between gap-4"><div><h2 className="text-lg font-semibold">Add provider</h2></div><button type="button" onClick={onClose} className="rounded-lg p-2 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-950" aria-label="Close"><X className="h-5 w-5" /></button></div><div className="mt-6 space-y-5"><div className="grid gap-5 sm:grid-cols-2"><Select label="Provider" options={providerOptions} selected={selectedProvider} onChange={chooseProvider} />{custom ? <Field alignWithSelect label="Provider ID" value={draft.custom_provider_id} onChange={(value) => patch({ custom_provider_id: value })} placeholder="my-provider" /> : <Select label="Model" options={modelOptions(models)} selected={selectedModel ? { id: selectedModel.model, name: selectedModel.model_name } : { id: '', name: 'Select a model' }} onChange={chooseModel} />}</div><div className="grid gap-5 sm:grid-cols-2">{custom ? <Field alignWithSelect label="Model" value={draft.upstream_model_id} onChange={(value) => patch({ upstream_model_id: value })} placeholder="provider-model-name" /> : <div /> }<Select label="Protocol" options={protocolOptions} selected={selectedProtocol} onChange={(option) => patch({ protocol: String(option.id) })} /></div><Field label="Provider API base URL" value={draft.base_url} onChange={(value) => patch({ base_url: value })} placeholder="https://api.example.com/v1" /><label className="block text-sm font-medium">Provider API key<div className="relative mt-2"><input required type={visible ? 'text' : 'password'} value={draft.api_key} onChange={(event) => patch({ api_key: event.target.value })} placeholder="Paste your provider key" className="w-full rounded-lg border border-zinc-300 px-3 py-2.5 pr-10 outline-none focus:border-primary" /><button type="button" onClick={() => setVisible((value) => !value)} className="absolute inset-y-0 right-0 px-3 text-zinc-400" aria-label={visible ? 'Hide API key' : 'Show API key'}>{visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</button></div></label><button type="button" onClick={() => setAdvanced((value) => !value)} className="text-sm text-zinc-700 hover:text-zinc-950">{advanced ? 'Hide advanced settings' : 'Price and capability settings'}</button>{advanced && <div className="grid gap-5 rounded-lg bg-zinc-50 p-4 sm:grid-cols-3 text-zinc-900"><Field required={false} label="Input $/1M" value={draft.input_price_per_1m} onChange={(value) => patch({ input_price_per_1m: value })} placeholder="0.14" /><Field required={false} label="Output $/1M" value={draft.output_price_per_1m} onChange={(value) => patch({ output_price_per_1m: value })} placeholder="0.28" /><Field required={false} label="Capability 0–1" value={draft.capability_score} onChange={(value) => patch({ capability_score: value })} placeholder="0.5" /><Field required={false} label="Context length" value={draft.context_length} onChange={(value) => patch({ context_length: value })} placeholder="128000" /></div>}{selectedModel && <div className="space-y-1 text-xs text-zinc-500"><div>{selectedModel.description}</div><div>Context: {selectedModel.context_length ? `${selectedModel.context_length.toLocaleString()} context` : 'Length not listed'}</div></div>}</div>{error && <ErrorMessage text={error} />}<div className="mt-6 flex justify-end gap-3"><button type="button" onClick={onClose} className="rounded-lg border border-zinc-300 px-4 py-2.5 text-sm text-zinc-600">Cancel</button><button disabled={busy} className="rounded-lg bg-zinc-950 px-5 py-2.5 text-sm text-white disabled:opacity-50">{busy ? 'Adding…' : 'Add provider'}</button></div></form></div>
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
      capability_score: firstModel ? inferDefaultCapability(firstModel) : '0.70',
      context_length: firstModel?.context_length ? String(firstModel.context_length) : '',
    })
    if (hasCatalogDetails(firstModel)) setAdvanced((items) => items.includes(index) ? items : [...items, index])
  }

  function selectModel(index: number, option: { id: string | number; name: string }) {
    const model = catalog.find((item) => item.provider_id === endpoints[index].provider_type && item.model === String(option.id))
    if (!model) return
    updateEndpoint(index, { upstream_model_id: model.model, base_url: model.base_url, input_price_per_1m: String(model.input_price_per_1m), output_price_per_1m: String(model.output_price_per_1m), capability_score: inferDefaultCapability(model), context_length: model.context_length ? String(model.context_length) : '' })
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
      <div className="rounded-lg bg-surface-200 px-4 py-3 text-xs text-zinc-500">The public model works with <code>/v1/chat/completions</code> and <code>/v1/responses</code>. Provider keys stay inside XGate.</div>
      {error && <ErrorMessage text={error} />}
      <div className="sticky bottom-4 flex items-center justify-between gap-4 rounded-xl border border-zinc-200 bg-white/95 p-3 shadow-lg backdrop-blur"><span className="hidden text-sm text-zinc-500 sm:inline">{completedCount} of {endpoints.length} upstreams ready</span><button disabled={busy} className="ml-auto rounded-lg bg-zinc-950 px-5 py-3 text-sm text-white disabled:opacity-50">{busy ? 'Creating…' : 'Create model service'}</button></div>
    </form>
  </Page>
}

export function KeysPage() {
  const [keys, setKeys] = useState<Key[]>([])
  const [services, setServices] = useState<Service[]>([])
  const { dialog, showConfirm } = useDialog()
  const [raw, setRaw] = useState('')
  const [error, setError] = useState('')
  const [modalOpen, setModalOpen] = useState(false)
  const [editingKey, setEditingKey] = useState<Key | null>(null)
  const load = () => {
    Promise.all([
      saasFetch<Key[]>('/api/saas/api-keys'),
      saasFetch<Service[]>('/api/saas/model-services'),
    ]).then(([keyResult, serviceResult]) => {
      setKeys(keyResult.data || [])
      setServices(serviceResult.data || [])
    }).catch((e: unknown) => setError(errorText(e)))
  }
  useEffect(() => { load() }, [])
  async function create(name: string, modelServiceIds: string[]) {
    const result = await saasFetch<{ key: string }>('/api/saas/api-keys', {
      method: 'POST',
      body: JSON.stringify({ name, model_service_ids: modelServiceIds }),
    })
    setRaw(result.data?.key || '')
    setModalOpen(false)
    load()
  }
  async function update(id: string, name: string, modelServiceIds: string[]) {
    await saasFetch(`/api/saas/api-keys/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ name, model_service_ids: modelServiceIds }),
    })
    setEditingKey(null)
    load()
  }
  async function revoke(id: string) {
    if (!await showConfirm('Existing requests will not be interrupted.', 'Revoke this API key?')) return
    try { await saasFetch(`/api/saas/api-keys/${id}/revoke`, { method: 'POST' }); load() } catch (e) { setError(errorText(e)) }
  }
  async function remove(id: string) {
    if (!await showConfirm('This cannot be undone.', 'Delete this API key permanently?')) return
    try { await saasFetch(`/api/saas/api-keys/${id}`, { method: 'DELETE' }); load() } catch (e) { setError(errorText(e)) }
  }
  return <Page action={<button type="button" onClick={() => { setError(''); setModalOpen(true) }} className="inline-flex items-center gap-2 rounded-lg bg-zinc-950 px-4 py-2.5 text-sm text-white"><Plus className="h-4 w-4" /> Create key</button>}>
    {dialog}{raw && <div className="rounded-xl border border-amber-200 bg-amber-50 p-5"><div className="text-sm font-medium text-amber-900">Copy this key now. It will not be shown again.</div><div className="mt-3 flex gap-2"><code className="flex-1 break-all rounded-lg border border-amber-200 bg-white px-3 py-2 text-sm">{raw}</code><button type="button" onClick={() => navigator.clipboard.writeText(raw)} className="rounded-lg border border-amber-300 p-2"><Copy className="h-4 w-4" /></button></div></div>}
    {error && <ErrorMessage text={error} />}
    {!keys.length ? <Empty text="No API keys yet." href="/app/services" /> : <div className="mt-6 space-y-3">{keys.map((key) => <div key={key.id} className="flex justify-between gap-4 rounded-xl border border-zinc-200 bg-white p-5"><div className="min-w-0"><div className="font-medium">{key.name}</div><div className="mt-1 font-mono text-sm text-zinc-500">{key.prefix}••••••••</div><div className="mt-2 space-y-1 text-xs text-zinc-400"><div>Created {key.created_at}</div>{key.last_used_at && <div>Last used {key.last_used_at}</div>}</div><div className="mt-3 flex flex-wrap items-center gap-2 text-xs"><span className={`rounded-full px-2 py-1 font-medium ${key.enabled ? 'bg-emerald-50 text-emerald-700' : 'bg-zinc-100 text-zinc-500'}`}>{key.enabled ? 'Active' : 'Revoked'}</span>{key.model_services?.length ? key.model_services.map((service) => <span key={service.id} className="rounded-full bg-zinc-100 px-2 py-1 text-zinc-600">{service.name}</span>) : <span className="text-zinc-400">All project services (legacy key)</span>}</div></div><div className="flex shrink-0 items-start gap-3">{key.enabled && <button type="button" onClick={() => setEditingKey(key)} className="self-start text-xs text-zinc-600 hover:text-zinc-950" aria-label={`Edit ${key.name}`}><Pencil className="h-4 w-4" /></button>}{key.enabled && <button type="button" onClick={() => revoke(key.id)} className="self-start text-xs text-rose-600 hover:text-rose-700">Revoke</button>}<button type="button" onClick={() => remove(key.id)} className="self-start text-xs text-zinc-500 hover:text-rose-600">Delete</button></div></div>)}</div>}
    {modalOpen && <CreateKeyModal services={services} existingNames={keys.map((key) => key.name)} onClose={() => setModalOpen(false)} onCreate={create} />}
    {editingKey && <EditKeyModal keyData={editingKey} services={services} existingNames={keys.map((key) => key.name)} onClose={() => setEditingKey(null)} onUpdate={update} />}
  </Page>
}

function EditKeyModal({ keyData, services, existingNames, onClose, onUpdate }: { keyData: Key; services: Service[]; existingNames: string[]; onClose: () => void; onUpdate: (id: string, name: string, modelServiceIds: string[]) => Promise<void> }) {
  const [name, setName] = useState(keyData.name)
  const [selected, setSelected] = useState<string[]>(keyData.model_services?.map((service) => service.id) || [])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  function toggle(id: string) { setSelected((current) => current.includes(id) ? current.filter((value) => value !== id) : [...current, id]) }
  async function submit(event: FormEvent) {
    event.preventDefault()
    const normalizedName = name.trim()
    if (!normalizedName) { setError('Key name is required'); return }
    if (existingNames.some((value) => value.toLowerCase() === normalizedName.toLowerCase() && value !== keyData.name)) { setError('An API key with this name already exists'); return }
    if (!selected.length) { setError('Select at least one model service'); return }
    setBusy(true); setError('')
    try { await onUpdate(keyData.id, normalizedName, selected) } catch (e) { setError(errorText(e)) } finally { setBusy(false) }
  }
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/30 p-4" role="dialog" aria-modal="true"><form onSubmit={submit} className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl"><div className="flex items-start justify-between gap-4"><div><h2 className="text-lg font-semibold">Edit API key</h2><p className="mt-1 text-sm text-zinc-500">Update the services this key can call.</p></div><button type="button" onClick={onClose} className="rounded-lg p-2 text-zinc-400 hover:bg-zinc-100" aria-label="Close"><X className="h-5 w-5" /></button></div><div className="mt-6 space-y-5"><Field label="Key name" value={name} onChange={setName} placeholder="Production app" /><fieldset><legend className="text-sm font-medium text-zinc-700">Model services</legend><p className="mt-1 text-xs text-zinc-500">Requests must use one of the selected service names as the <code>model</code> value.</p><div className="mt-3 max-h-52 space-y-2 overflow-y-auto rounded-lg border border-zinc-200 p-3">{services.length ? services.map((service) => <label key={service.id} className="flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 hover:bg-zinc-50"><input type="checkbox" checked={selected.includes(service.id)} onChange={() => toggle(service.id)} className="h-4 w-4 accent-zinc-950" /><span className="text-sm text-zinc-700">{service.name}</span></label>) : <p className="px-3 py-2 text-sm text-zinc-500">Create a model service before editing this key.</p>}</div></fieldset></div>{error && <div className="mt-4"><ErrorMessage text={error} /></div>}<div className="mt-6 flex justify-end gap-3"><button type="button" onClick={onClose} className="rounded-lg border border-zinc-300 px-4 py-2.5 text-sm text-zinc-600">Cancel</button><button disabled={busy || !services.length} className="rounded-lg bg-zinc-950 px-5 py-2.5 text-sm text-white disabled:opacity-50">{busy ? 'Saving…' : 'Save changes'}</button></div></form></div>
}

function CreateKeyModal({ services, existingNames, onClose, onCreate }: { services: Service[]; existingNames: string[]; onClose: () => void; onCreate: (name: string, modelServiceIds: string[]) => Promise<void> }) {
  const [name, setName] = useState('')
  const [selected, setSelected] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  function toggle(id: string) { setSelected((current) => current.includes(id) ? current.filter((value) => value !== id) : [...current, id]) }
  async function submit(event: FormEvent) {
    event.preventDefault()
    const normalizedName = name.trim()
    if (!normalizedName) { setError('Key name is required'); return }
    if (existingNames.some((value) => value.toLowerCase() === normalizedName.toLowerCase())) { setError('An API key with this name already exists'); return }
    if (!selected.length) { setError('Select at least one model service'); return }
    setBusy(true); setError('')
    try { await onCreate(normalizedName, selected) } catch (e) { setError(errorText(e)) } finally { setBusy(false) }
  }
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/30 p-4" role="dialog" aria-modal="true"><form onSubmit={submit} className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl"><div className="flex items-start justify-between gap-4"><div><h2 className="text-lg font-semibold">Create API key</h2><p className="mt-1 text-sm text-zinc-500">This key can call the selected model services.</p></div><button type="button" onClick={onClose} className="rounded-lg p-2 text-zinc-400 hover:bg-zinc-100" aria-label="Close"><X className="h-5 w-5" /></button></div><div className="mt-6 space-y-5"><Field label="Key name" value={name} onChange={setName} placeholder="Production app" /><fieldset><legend className="text-sm font-medium text-zinc-700">Model services</legend><p className="mt-1 text-xs text-zinc-500">In each request, use the selected service name as the <code>model</code> value.</p><div className="mt-3 max-h-52 space-y-2 overflow-y-auto rounded-lg border border-zinc-200 p-3">{services.length ? services.map((service) => <label key={service.id} className="flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 hover:bg-zinc-50"><input type="checkbox" checked={selected.includes(service.id)} onChange={() => toggle(service.id)} className="h-4 w-4 accent-zinc-950" /><span className="text-sm text-zinc-700">{service.name}</span></label>) : <p className="px-3 py-2 text-sm text-zinc-500">Create a model service before creating an API key.</p>}</div></fieldset></div>{error && <div className="mt-4"><ErrorMessage text={error} /></div>}<div className="mt-6 flex justify-end gap-3"><button type="button" onClick={onClose} className="rounded-lg border border-zinc-300 px-4 py-2.5 text-sm text-zinc-600">Cancel</button><button disabled={busy || !services.length} className="rounded-lg bg-zinc-950 px-5 py-2.5 text-sm text-white disabled:opacity-50">{busy ? 'Creating…' : 'Create key'}</button></div></form></div>
}

type UsageBreakdown = {
  provider?: string
  model?: string
  requests: number
  prompt_tokens: number
  completion_tokens: number
  total_tokens: number
  estimated_spend: number
  cache_hit_tokens?: number
  cache_write_tokens?: number
}

type MissingUsageBreakdown = {
  provider: string
  model: string
  requests: number
  local_estimate_requests: number
  unavailable_requests: number
}

type UsageData = {
  requests: number
  prompt_tokens: number
  completion_tokens: number
  total_tokens: number
  estimated_spend: number
  success_rate: number
  trimmed_chars: number
  cache?: { hit_tokens: number; hit_requests: number; reported_requests: number; reported_input_tokens: number; hit_rate: number; write_tokens: number; write_requests: number; reported_write_requests: number; write_rate: number }
  budget?: { status: string; spent_today: number; daily_limit: number | null; remaining_today: number | null }
  coverage?: {
    usage: number
    pricing: number
    provider_reported_requests: number
    priced_requests: number
    missing_usage_requests: number
    missing_usage_breakdown: MissingUsageBreakdown[]
  }
  data_quality?: string[]
  breakdowns?: { providers: UsageBreakdown[]; models: UsageBreakdown[] }
}

type SavingsBaseline = {
  virtual_model_id: string
  endpoint_id: string
  model_service_name: string
  model: string
  provider_name: string
  input_price_per_1m: number
  output_price_per_1m: number
}

type SavingsData = {
  estimated_spend?: number | null
  estimated_savings?: number | null
  trimmed_chars: number
  configured: boolean
  baseline?: SavingsBaseline
  basis: string
}

const money = (value: number | undefined) => `$${(value || 0).toFixed(4)}`
const compactNumber = (value: number | undefined) => (value || 0).toLocaleString()
const compactTokens = (value: number | undefined) => {
  const v = value || 0
  if (v >= 1_000_000_000) return `${(v / 1_000_000_000).toFixed(2)}B`
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(2)}M`
  if (v >= 10_000) return `${(v / 1_000).toFixed(1)}k`
  return v.toLocaleString()
}

export function UsagePage() {
  const [data, setData] = useState<UsageData | null>(null)
  const [savings, setSavings] = useState<SavingsData | null>(null)
  const [baseline, setBaseline] = useState<SavingsBaseline | null>(null)
  const [baselineOptions, setBaselineOptions] = useState<ServiceDetails[]>([])
  const [baselineOpen, setBaselineOpen] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    Promise.all([
      saasFetch<UsageData>('/api/saas/usage?range=30d'),
      saasFetch<SavingsData>('/api/saas/savings?range=30d'),
      saasFetch<{ configured?: boolean } & Partial<SavingsBaseline>>('/api/saas/savings-baseline'),
      saasFetch<Service[]>('/api/saas/model-services'),
    ])
      .then(async ([usage, savingsResult, baselineResult, servicesResult]) => {
        setData(usage.data || null)
        setSavings(savingsResult.data || null)
        const detectedBaseline = baselineResult.data?.configured
          ? baselineResult.data as SavingsBaseline
          : savingsResult.data?.baseline || null
        setBaseline(detectedBaseline)
        const details = await Promise.all((servicesResult.data || []).map(async (service) => {
          try { return (await saasFetch<ServiceDetails>(`/api/saas/model-services/${service.id}`)).data || null } catch { return null }
        }))
        setBaselineOptions(details.filter((service): service is ServiceDetails => Boolean(service)))
      })
      .catch((e: unknown) => setError(errorText(e)))
  }, [])

  const coveragePercent = (value: number | undefined) => `${Math.round((value || 0) * 100)}%`
  const providers = data?.breakdowns?.providers || []
  const models = data?.breakdowns?.models || []
  const modelsByProvider = models.reduce<Map<string, UsageBreakdown[]>>((groups, item) => {
    const provider = item.provider || 'Unknown provider'
    const providerModels = groups.get(provider) || []
    providerModels.push(item)
    groups.set(provider, providerModels)
    return groups
  }, new Map())
  const maxProviderSpend = Math.max(...providers.map((item) => item.estimated_spend), 0.000001)
  const missingUsage = data?.coverage?.missing_usage_breakdown || []

  return <Page>
    {error && <ErrorMessage text={error} />}
    <div className="mb-5 flex items-end justify-between gap-4"><div><h1 className="text-xl font-semibold tracking-tight">Usage</h1><p className="mt-1 text-sm text-zinc-500">Automatic statistics from your last 30 days of model calls.</p></div><span className="text-xs text-zinc-400">Provider-reported usage when available</span></div>
    <div className="grid grid-cols-1 items-stretch gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <Stat label="Requests" value={compactNumber(data?.requests)} />
      <Stat label="Total tokens" value={compactTokens(data?.total_tokens)} fullValue={compactNumber(data?.total_tokens)} />
      <Stat label="Estimated spend" value={money(data?.estimated_spend)} />
      <Stat label="Success rate" value={`${((data?.success_rate || 0) * 100).toFixed(1)}%`} />
    </div>

    <section className="mt-6 rounded-xl border border-zinc-200 bg-white p-5"><div><h2 className="font-semibold">Prompt cache</h2><p className="mt-1 text-sm text-zinc-500">Provider-reported input tokens served from cache. This is separate from context trimming.</p></div><div className="mt-5 grid grid-cols-2 items-stretch gap-4 md:grid-cols-3 xl:grid-cols-5"><Stat label="Cache hit tokens" value={compactTokens(data?.cache?.hit_tokens)} fullValue={compactNumber(data?.cache?.hit_tokens)} /><Stat label="Requests with hits" value={compactNumber(data?.cache?.hit_requests)} /><Stat label="Input token hit rate" value={coveragePercent(data?.cache?.hit_rate)} /><Stat label="Cache write tokens" value={compactTokens(data?.cache?.write_tokens)} fullValue={compactNumber(data?.cache?.write_tokens)} /><Stat label="Input token write rate" value={coveragePercent(data?.cache?.write_rate)} /></div>{data?.cache?.reported_requests === 0 && <p className="mt-4 text-xs text-zinc-500">No provider-reported cache metrics are available for this period.</p>}</section>

    <section className="mt-6 rounded-xl border border-zinc-200 bg-white p-5"><h2 className="font-semibold">Usage by provider and model</h2><p className="mt-1 text-sm text-zinc-500">Each provider includes the models used through it.</p>{providers.length ? <div className="mt-5 divide-y divide-zinc-100">{providers.map((item) => { const providerModels = modelsByProvider.get(item.provider || '') || []; return <div key={item.provider} className="py-5 first:pt-0 last:pb-0"><div className="flex items-center justify-between gap-4 text-sm"><span className="font-medium">{item.provider}</span><span className="font-mono text-zinc-600">{money(item.estimated_spend)}</span></div><div className="mt-2 h-2 rounded-full bg-zinc-100"><div className="h-full rounded-full bg-primary" style={{ width: `${Math.max((item.estimated_spend / maxProviderSpend) * 100, 2)}%` }} /></div><div className="mt-1 space-y-1 text-xs text-zinc-500"><div>{compactNumber(item.requests)} requests</div><div>{compactNumber(item.total_tokens)} tokens</div>{item.cache_hit_tokens ? <div>{compactNumber(item.cache_hit_tokens)} cache hit tokens</div> : null}{item.cache_write_tokens ? <div>{compactNumber(item.cache_write_tokens)} cache write tokens</div> : null}</div>{providerModels.length ? <div className="mt-5 border-l-2 border-zinc-100 pl-4"><div className="mb-3 text-xs font-medium uppercase tracking-wide text-zinc-400">Models</div><div className="space-y-3">{providerModels.slice(0, 10).map((model) => <div key={`${model.provider}-${model.model}`} className="flex items-center justify-between gap-4"><div className="min-w-0"><div className="truncate text-sm">{model.model}</div><div className="mt-1 text-xs text-zinc-500">{compactNumber(model.requests)} requests <span className="mx-1">/</span> {compactNumber(model.total_tokens)} tokens{model.cache_hit_tokens ? <><span className="mx-1">/</span> {compactNumber(model.cache_hit_tokens)} cached</> : null}{model.cache_write_tokens ? <><span className="mx-1">/</span> {compactNumber(model.cache_write_tokens)} written</> : null}</div></div><span className="shrink-0 font-mono text-sm text-zinc-600">{money(model.estimated_spend)}</span></div>)}</div></div> : null}</div> })}</div> : <p className="mt-5 text-sm text-zinc-500">No usage recorded yet.</p>}</section>

    <section className="mt-6 rounded-xl border border-zinc-200 bg-white p-5"><div className="flex flex-wrap items-start justify-between gap-4"><div><h2 className="font-semibold">Context savings</h2><p className="mt-1 text-sm text-zinc-500">Signals produced by context reduction. This is separate from provider billing.</p></div><button type="button" onClick={() => setBaselineOpen(true)} className="inline-flex items-center gap-2 rounded-lg border border-zinc-300 px-3 py-2 text-sm font-medium text-zinc-700 hover:border-zinc-950 hover:text-zinc-950"><Settings2 className="h-4 w-4" />{baseline ? 'Change baseline' : 'Configure baseline'}</button></div><div className="mt-5 grid grid-cols-1 items-stretch gap-4 sm:grid-cols-2"><Stat label="Context characters trimmed" value={compactNumber(savings?.trimmed_chars || data?.trimmed_chars)} /><Stat label="Estimated dollar savings" value={savings?.estimated_savings == null ? 'Not available' : money(Number(savings.estimated_savings))} /></div>{baseline && <p className="mt-4 text-xs text-zinc-500">Compared with {baseline.model_service_name} / {baseline.model} ({baseline.provider_name}).</p>}<p className="mt-2 text-xs text-zinc-500">{savings?.basis || 'Configure a model service baseline to estimate dollar savings.'}</p></section>

    {baselineOpen && <SavingsBaselineModal services={baselineOptions} baseline={baseline} onClose={() => setBaselineOpen(false)} onSaved={(next) => { setBaseline(next); setBaselineOpen(false); saasFetch<SavingsData>('/api/saas/savings?range=30d').then((result) => setSavings(result.data || null)).catch((e: unknown) => setError(errorText(e))) }} />}

    {data?.budget && <div className="mt-6 rounded-xl border border-zinc-200 bg-white p-5"><div className="flex justify-between text-sm"><span>Today’s budget</span><span className="font-mono">{data.budget.daily_limit ? `${money(data.budget.spent_today)} / ${money(data.budget.daily_limit)}` : 'No limit set'}</span></div><div className="mt-3 h-2 rounded-full bg-zinc-100"><div className="h-full rounded-full bg-zinc-900" style={{ width: `${Math.min((data.budget.daily_limit ? data.budget.spent_today / data.budget.daily_limit : 0) * 100, 100)}%` }} /></div><div className="mt-2 text-xs text-zinc-500">Status: {data.budget.status}</div></div>}
    {data?.coverage && <section className="mt-6 rounded-xl border border-zinc-200 bg-white p-5"><div className="flex items-start justify-between gap-4"><div><h2 className="font-semibold">Usage data coverage</h2><p className="mt-1 text-sm text-zinc-500">Shows which requests use provider-reported tokens and which rely on estimates.</p></div><span className="shrink-0 whitespace-nowrap rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary">{coveragePercent(data.coverage.usage)} provider-reported</span></div><div className="mt-5 grid gap-4 sm:grid-cols-2"><Coverage label="Provider-reported tokens" value={data.coverage.usage} detail={`${compactNumber(data.coverage.provider_reported_requests)} of ${compactNumber(data.requests)} requests include token data`} /><Coverage label="Configured pricing" value={data.coverage.pricing} detail={`${compactNumber(data.coverage.priced_requests)} of ${compactNumber(data.requests)} requests have a pricing rule`} /></div>{missingUsage.length > 0 && <div className="mt-6 rounded-lg border border-amber-200 bg-amber-50 p-4"><div className="font-medium text-amber-900">Requests without provider-reported tokens</div><p className="mt-1 text-sm text-amber-800">{compactNumber(data.coverage.missing_usage_requests)} requests below use a local estimate or have no token data.</p><div className="mt-4 divide-y divide-amber-200/70">{missingUsage.slice(0, 10).map((item) => <div key={`${item.provider}-${item.model}`} className="flex flex-wrap items-start justify-between gap-3 py-3 first:pt-0 last:pb-0"><div className="min-w-0"><div className="truncate text-sm font-medium text-amber-950">{item.provider} / {item.model}</div><div className="mt-1 space-y-0.5 text-xs text-amber-800"><div>{compactNumber(item.requests)} requests without provider-reported tokens</div>{item.local_estimate_requests > 0 && <div>{compactNumber(item.local_estimate_requests)} use local estimates</div>}{item.unavailable_requests > 0 && <div>{compactNumber(item.unavailable_requests)} have no token data</div>}</div></div><span className="shrink-0 rounded-full bg-white/70 px-2 py-1 text-xs font-medium text-amber-900">Needs review</span></div>)}</div>{missingUsage.length > 10 && <div className="mt-3 text-xs text-amber-800">Showing the first 10 provider and model groups.</div>}</div>}</section>}
  </Page>
}

function SavingsBaselineModal({ services, baseline, onClose, onSaved }: { services: ServiceDetails[]; baseline: SavingsBaseline | null; onClose: () => void; onSaved: (baseline: SavingsBaseline) => void }) {
  const initialService = services.find((service) => service.id === baseline?.virtual_model_id) || services[0]
  const [serviceId, setServiceId] = useState(initialService?.id || '')
  const service = services.find((item) => item.id === serviceId) || initialService
  const endpoint = service?.endpoints.find((item) => item.id === baseline?.endpoint_id) || service?.endpoints[0]
  const [endpointId, setEndpointId] = useState(endpoint?.id || '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    const next = service?.endpoints.find((item) => item.id === (serviceId === baseline?.virtual_model_id ? baseline?.endpoint_id : '')) || service?.endpoints[0]
    setEndpointId(next?.id || '')
  }, [serviceId, service, baseline])

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!service || !endpointId) { setError('Select a model service and model first.'); return }
    setBusy(true); setError('')
    try {
      await saasFetch('/api/saas/savings-baseline', { method: 'PATCH', body: JSON.stringify({ virtual_model_id: service.id, endpoint_id: endpointId }) })
      const saved = service.endpoints.find((item) => item.id === endpointId)
      if (saved) onSaved({ virtual_model_id: service.id, endpoint_id: saved.id, model_service_name: service.name, model: saved.model, provider_name: saved.provider_name, input_price_per_1m: saved.input_price_per_1m, output_price_per_1m: saved.output_price_per_1m })
    } catch (e) { setError(errorText(e)) } finally { setBusy(false) }
  }

  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/30 p-4" role="dialog" aria-modal="true"><form onSubmit={submit} className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl"><div className="flex items-start justify-between gap-4"><div><h2 className="text-lg font-semibold">Savings comparison baseline</h2><p className="mt-1 text-sm text-zinc-500">Choose one model from a Model Service as the comparison price.</p></div><button type="button" onClick={onClose} className="rounded-lg p-2 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-950" aria-label="Close"><X className="h-5 w-5" /></button></div>{services.length ? <div className="mt-6 space-y-5"><Select label="Model service" options={services.map((item) => ({ id: item.id, name: item.name }))} selected={service ? { id: service.id, name: service.name } : { id: '', name: 'Select a model service' }} onChange={(option) => setServiceId(String(option.id))} /><Select label="Model / provider endpoint" options={(service?.endpoints || []).map((item) => ({ id: item.id, name: `${item.model} — ${item.provider_name}` }))} selected={endpoint ? { id: endpoint.id, name: `${endpoint.model} — ${endpoint.provider_name}` } : { id: '', name: 'Select a model' }} onChange={(option) => setEndpointId(String(option.id))} />{endpoint && <div className="rounded-lg bg-zinc-50 px-3 py-2 text-xs text-zinc-500">Input ${endpoint.input_price_per_1m}/1M · Output ${endpoint.output_price_per_1m}/1M</div>}<p className="text-xs text-zinc-500">The estimate uses this endpoint’s configured prices. A single model is supported in the first version.</p></div> : <div className="mt-6 rounded-lg bg-amber-50 px-3 py-3 text-sm text-amber-800">Create a Model Service with at least one endpoint before configuring a baseline.</div>}{error && <div className="mt-4"><ErrorMessage text={error} /></div>}<div className="mt-6 flex justify-end gap-3"><button type="button" onClick={onClose} className="rounded-lg border border-zinc-300 px-4 py-2.5 text-sm text-zinc-600">Cancel</button><button disabled={busy || !services.length} className="rounded-lg bg-zinc-950 px-5 py-2.5 text-sm text-white disabled:opacity-50">{busy ? 'Saving…' : 'Save baseline'}</button></div></form></div>
}

type QueryAnalyticsItem = {
  id: string
  timestamp: string
  service_name: string
  model: string
  provider_name: string
  prompt_tokens: number
  completion_tokens: number
  total_tokens: number
  latency_ms: number
  status_code: number
  cost: number
  strategy: string
  difficulty: number
  difficulty_tier: 'high' | 'medium' | 'low'
  prompt_preview: string
  signals: string[]
}

type RoutingAnalyticsData = {
  range: string
  summary: {
    total_queries: number
    high_tier_count: number
    medium_tier_count: number
    low_tier_count: number
    pro_count: number
    flash_count: number
    total_cost: number
    estimated_savings: number
    avg_latency_ms: number
    total_tokens: number
  }
  queries: QueryAnalyticsItem[]
}
export function AnalyticsPage() {
  const [range, setRange] = useState<'24h' | '7d' | '30d' | 'all'>('24h')
  const [tierFilter, setTierFilter] = useState<'all' | 'high' | 'medium' | 'low'>('all')
  const [data, setData] = useState<RoutingAnalyticsData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [expandedSignals, setExpandedSignals] = useState<Record<string, boolean>>({})
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(15)

  const toggleSignals = (id: string) => {
    setExpandedSignals((prev) => ({ ...prev, [id]: !prev[id] }))
  }

  useEffect(() => {
    setLoading(true)
    saasFetch<RoutingAnalyticsData>(`/api/saas/analytics/routing?range=${range}`)
      .then((res) => {
        setData(res.data || null)
        setError('')
      })
      .catch((e) => setError(errorText(e)))
      .finally(() => setLoading(false))
  }, [range])

  useEffect(() => {
    setPage(1)
  }, [range, tierFilter, pageSize])

  const filteredQueries = (data?.queries || []).filter((q) => {
    if (tierFilter === 'all') return true
    return q.difficulty_tier === tierFilter
  })

  const totalFiltered = filteredQueries.length
  const totalPages = Math.max(1, Math.ceil(totalFiltered / pageSize))
  const currentPage = Math.min(page, totalPages)
  const startIndex = (currentPage - 1) * pageSize
  const paginatedQueries = filteredQueries.slice(startIndex, startIndex + pageSize)

  const total = data?.summary.total_queries || 0
  const highPct = total ? Math.round(((data?.summary.high_tier_count || 0) / total) * 100) : 0
  const medPct = total ? Math.round(((data?.summary.medium_tier_count || 0) / total) * 100) : 0
  const lowPct = total ? Math.max(0, 100 - highPct - medPct) : 0

  return (
    <Page>
      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Routing Analytics & Complexity Insights</h1>
            <p className="mt-1 text-sm text-zinc-500">
              Inspect how incoming queries match complexity signals and route across Pro and Flash models.
            </p>
          </div>
          <div className="flex rounded-lg border border-zinc-200 bg-white p-1" role="tablist">
            {(['24h', '7d', '30d', 'all'] as const).map((r) => (
              <button
                key={r}
                onClick={() => setRange(r)}
                className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                  range === r ? 'bg-zinc-900 text-white' : 'text-zinc-500 hover:text-zinc-950'
                }`}
              >
                {r === '24h' ? 'Last 24h' : r === '7d' ? 'Last 7 days' : r === '30d' ? 'Last 30 days' : 'All time'}
              </button>
            ))}
          </div>
        </div>

        {error && <ErrorMessage text={error} />}

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="flex flex-col justify-between rounded-xl border border-zinc-200 bg-white p-5">
            <div className="text-xs font-medium uppercase tracking-wide text-zinc-500">Analyzed queries</div>
            <div className="mt-2 text-2xl font-bold text-zinc-950">{total.toLocaleString()}</div>
            <div className="mt-2 text-xs text-zinc-400">Intelligent complexity scored</div>
          </div>

          <div className="flex flex-col justify-between rounded-xl border border-zinc-200 bg-white p-5">
            <div className="text-xs font-medium uppercase tracking-wide text-zinc-500">Complexity breakdown</div>
            <div className="mt-2 flex items-baseline gap-4">
              <div>
                <span className="text-2xl font-bold text-purple-700">{(data?.summary.high_tier_count || 0).toLocaleString()}</span>
                <span className="ml-1 text-xs text-zinc-400">High</span>
              </div>
              <div className="h-4 w-px bg-zinc-200" />
              <div>
                <span className="text-2xl font-bold text-amber-600">{(data?.summary.medium_tier_count || 0).toLocaleString()}</span>
                <span className="ml-1 text-xs text-zinc-400">Med</span>
              </div>
              <div className="h-4 w-px bg-zinc-200" />
              <div>
                <span className="text-2xl font-bold text-emerald-600">{(data?.summary.low_tier_count || 0).toLocaleString()}</span>
                <span className="ml-1 text-xs text-zinc-400">Low</span>
              </div>
            </div>
            <div className="mt-2 text-xs text-zinc-400">{highPct}% complex reasoning & code</div>
          </div>

          <div className="flex flex-col justify-between rounded-xl border border-zinc-200 bg-white p-5">
            <div className="text-xs font-medium uppercase tracking-wide text-zinc-500">Model tier routing</div>
            <div className="mt-2 flex items-baseline gap-4">
              <div>
                <span className="text-2xl font-bold text-purple-700">{(data?.summary.pro_count || 0).toLocaleString()}</span>
                <span className="ml-1 text-xs text-zinc-400">Pro model</span>
              </div>
              <div className="h-4 w-px bg-zinc-200" />
              <div>
                <span className="text-2xl font-bold text-emerald-600">{(data?.summary.flash_count || 0).toLocaleString()}</span>
                <span className="ml-1 text-xs text-zinc-400">Flash model</span>
              </div>
            </div>
            <div className="mt-2 text-xs text-zinc-400">Dynamic capability dispatch</div>
          </div>

          <div className="flex flex-col justify-between rounded-xl border border-zinc-200 bg-white p-5">
            <div className="text-xs font-medium uppercase tracking-wide text-zinc-500">Estimated savings</div>
            <div className="mt-2 text-2xl font-bold text-emerald-600">
              ${(data?.summary.estimated_savings || 0).toFixed(4)}
            </div>
            <div className="mt-2 text-xs text-zinc-400">
              Total spend: ${(data?.summary.total_cost || 0).toFixed(4)}
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-zinc-200 bg-white p-5">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-zinc-900">Complexity Spectrum & Signal Distribution</h2>
            <span className="text-xs text-zinc-400">Higher score routes to Pro models</span>
          </div>

          <div className="mt-4 flex h-3 w-full overflow-hidden rounded-full bg-zinc-100">
            {highPct > 0 && <div style={{ width: `${highPct}%` }} className="bg-purple-600 transition-all" title={`High: ${highPct}%`} />}
            {medPct > 0 && <div style={{ width: `${medPct}%` }} className="bg-amber-500 transition-all" title={`Medium: ${medPct}%`} />}
            {lowPct > 0 && <div style={{ width: `${lowPct}%` }} className="bg-emerald-500 transition-all" title={`Low: ${lowPct}%`} />}
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-4 text-xs text-zinc-500">
            <div className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full bg-purple-600" />
              <span>High Complexity (≥ 0.60): <strong>{(data?.summary.high_tier_count || 0).toLocaleString()}</strong> ({highPct}%)</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full bg-amber-500" />
              <span>Medium Complexity (0.35–0.60): <strong>{(data?.summary.medium_tier_count || 0).toLocaleString()}</strong> ({medPct}%)</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full bg-emerald-500" />
              <span>Low Complexity (&lt; 0.35): <strong>{(data?.summary.low_tier_count || 0).toLocaleString()}</strong> ({lowPct}%)</span>
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-zinc-200 bg-white p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-zinc-900">Query Logs & Signal Hits</h2>
              <p className="mt-0.5 text-xs text-zinc-400">Live inspection of prompt intents and routed models.</p>
            </div>
            <div className="flex items-center gap-1 rounded-lg border border-zinc-200 bg-zinc-50/70 p-1">
              {(['all', 'high', 'medium', 'low'] as const).map((tier) => (
                <button
                  key={tier}
                  onClick={() => setTierFilter(tier)}
                  className={`rounded-md px-2.5 py-1 text-xs font-medium capitalize transition-colors ${
                    tierFilter === tier ? 'bg-white text-zinc-950 shadow-sm' : 'text-zinc-500 hover:text-zinc-900'
                  }`}
                >
                  {tier === 'all' ? 'All tiers' : tier}
                </button>
              ))}
            </div>
          </div>

          <div className="mt-4 -mx-5 -mb-5 overflow-x-auto border-t border-zinc-100">
            {!paginatedQueries.length ? (
              <div className="py-12 text-center text-sm text-zinc-500">
                {loading ? 'Loading queries…' : 'No query records found for this period.'}
              </div>
            ) : (
              <table className="w-full text-left text-xs divide-y divide-zinc-100">
                <thead className="bg-zinc-50/50">
                  <tr className="text-zinc-500">
                    <th className="py-3 px-5 font-medium w-36">Time / Service</th>
                    <th className="py-3 px-4 font-medium min-w-[200px] max-w-sm">Prompt / User Intent</th>
                    <th className="py-3 px-4 font-medium w-32">Complexity</th>
                    <th className="py-3 px-4 font-medium min-w-[200px] max-w-md">Matched Signals</th>
                    <th className="py-3 px-4 font-medium w-36">Routed Model</th>
                    <th className="py-3 px-4 text-right font-medium w-28">Tokens / Latency</th>
                    <th className="py-3 px-5 text-right font-medium w-24">Cost</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100 bg-white">
                  {paginatedQueries.map((q) => {
                    const cleanService = q.service_name.replace(/^[0-9a-fA-F-]{36,37}-/, '')
                    const cleanProvider = q.provider_name.replace(/^saas-[0-9a-fA-F-]{36}/, 'DeepSeek').replace(/^saas-/, '')
                    return (
                      <tr key={q.id} className="hover:bg-zinc-50/70 transition-colors">
                        <td className="py-3 px-5 align-top whitespace-nowrap">
                          <div className="font-semibold text-zinc-900">{cleanService}</div>
                          <div className="mt-0.5 text-[11px] text-zinc-400">{q.timestamp}</div>
                        </td>
                        <td className="py-3 px-4 align-top">
                          <div className="font-mono text-zinc-800 text-[11px] line-clamp-2 leading-relaxed break-words" title={q.prompt_preview}>
                            {q.prompt_preview}
                          </div>
                        </td>
                        <td className="py-3 px-4 align-top whitespace-nowrap">
                          <span
                            className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                              q.difficulty_tier === 'high'
                                ? 'bg-purple-50 text-purple-700 border border-purple-200'
                                : q.difficulty_tier === 'medium'
                                ? 'bg-amber-50 text-amber-700 border border-amber-200'
                                : 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                            }`}
                          >
                            D = {q.difficulty.toFixed(2)} ({q.difficulty_tier})
                          </span>
                        </td>
                        <td className="py-3 px-4 align-top min-w-[240px] max-w-sm">
                          {(() => {
                            const isExpanded = Boolean(expandedSignals[q.id])
                            const list = isExpanded ? q.signals : q.signals.slice(0, 3)
                            return (
                              <div className="flex flex-wrap items-center gap-1" title={!isExpanded ? q.signals.join(', ') : undefined}>
                                {list.map((sig, i) => (
                                  <span
                                    key={i}
                                    className={`inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-medium leading-tight whitespace-nowrap ${
                                      sig.includes('Judge')
                                        ? 'bg-purple-50 text-purple-700 border border-purple-200/80 font-semibold'
                                        : sig.includes('reasoning') || sig.includes('Correction')
                                        ? 'bg-amber-50 text-amber-800 border border-amber-200/80'
                                        : 'bg-zinc-100 text-zinc-700 border border-zinc-200/60'
                                    }`}
                                  >
                                    {sig}
                                  </span>
                                ))}
                                {!isExpanded && q.signals.length > 3 && (
                                  <button
                                    type="button"
                                    onClick={() => toggleSignals(q.id)}
                                    title="Click to expand all signals"
                                    className="inline-flex items-center rounded-md bg-zinc-100 hover:bg-zinc-200/90 border border-zinc-200/80 px-1.5 py-0.5 text-[10px] text-zinc-600 font-medium cursor-pointer transition-colors"
                                  >
                                    +{q.signals.length - 3}
                                  </button>
                                )}
                                {isExpanded && q.signals.length > 3 && (
                                  <button
                                    type="button"
                                    onClick={() => toggleSignals(q.id)}
                                    title="Click to collapse"
                                    className="inline-flex items-center rounded-md bg-zinc-100 hover:bg-zinc-200/90 border border-zinc-200/80 px-1.5 py-0.5 text-[10px] text-zinc-500 font-medium cursor-pointer transition-colors"
                                  >
                                    Collapse
                                  </button>
                                )}
                              </div>
                            )
                          })()}
                        </td>
                        <td className="py-3 px-4 align-top whitespace-nowrap">
                          <div className="font-semibold text-zinc-900">{q.model}</div>
                          <div className="text-[11px] text-zinc-400 truncate max-w-[140px]" title={q.provider_name}>{cleanProvider}</div>
                        </td>
                        <td className="py-3 px-4 align-top text-right whitespace-nowrap">
                          <div className="font-medium text-zinc-900">{q.total_tokens.toLocaleString()} tok</div>
                          <div className="text-[11px] text-zinc-400">{q.latency_ms}ms</div>
                        </td>
                        <td className="py-3 px-5 align-top text-right whitespace-nowrap font-semibold text-zinc-900">
                          ${q.cost.toFixed(4)}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}
          </div>

          {totalFiltered > 0 && (
            <div className="mt-4 -mx-5 -mb-5 flex flex-wrap items-center justify-between gap-3 border-t border-zinc-100 bg-zinc-50/50 px-5 py-3 text-xs text-zinc-500">
              <div className="flex items-center gap-3">
                <span>
                  Showing <strong className="font-semibold text-zinc-900">{startIndex + 1}</strong>–<strong className="font-semibold text-zinc-900">{Math.min(startIndex + pageSize, totalFiltered)}</strong> of <strong className="font-semibold text-zinc-900">{totalFiltered}</strong> queries
                </span>
                <div className="w-28">
                  <Select
                    options={[
                      { id: '10', name: '10 / page' },
                      { id: '15', name: '15 / page' },
                      { id: '25', name: '25 / page' },
                      { id: '50', name: '50 / page' },
                    ]}
                    selected={{ id: String(pageSize), name: `${pageSize} / page` }}
                    onChange={(opt) => setPageSize(Number(opt.id))}
                  />
                </div>
              </div>

              <div className="flex items-center gap-1">
                <button
                  type="button"
                  disabled={currentPage <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  className="inline-flex items-center justify-center rounded-lg border border-zinc-200 bg-white p-1.5 text-zinc-600 transition hover:bg-zinc-100 disabled:opacity-40 disabled:pointer-events-none"
                  aria-label="Previous page"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>

                <div className="flex items-center gap-1 px-1">
                  {Array.from({ length: totalPages }, (_, i) => i + 1)
                    .filter((p) => p === 1 || p === totalPages || Math.abs(p - currentPage) <= 1)
                    .reduce<(number | string)[]>((acc, p, idx, arr) => {
                      if (idx > 0 && p - (arr[idx - 1] as number) > 1) {
                        acc.push('…')
                      }
                      acc.push(p)
                      return acc
                    }, [])
                    .map((item, idx) =>
                      typeof item === 'number' ? (
                        <button
                          key={idx}
                          type="button"
                          onClick={() => setPage(item)}
                          className={`min-w-[28px] h-7 rounded-md px-2 text-xs font-medium transition-colors ${
                            currentPage === item
                              ? 'bg-zinc-900 text-white'
                              : 'bg-white text-zinc-600 border border-zinc-200 hover:bg-zinc-100'
                          }`}
                        >
                          {item}
                        </button>
                      ) : (
                        <span key={idx} className="px-1 text-zinc-400">
                          {item}
                        </span>
                      )
                    )}
                </div>

                <button
                  type="button"
                  disabled={currentPage >= totalPages}
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  className="inline-flex items-center justify-center rounded-lg border border-zinc-200 bg-white p-1.5 text-zinc-600 transition hover:bg-zinc-100 disabled:opacity-40 disabled:pointer-events-none"
                  aria-label="Next page"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </Page>
  )
}

function Coverage({ label, value, detail }: { label: string; value: number; detail: string }) { return <div><div className="flex justify-between text-sm"><span>{label}</span><span className="font-mono">{Math.round(value * 100)}%</span></div><div className="mt-2 h-2 rounded-full bg-zinc-100"><div className="h-full rounded-full bg-primary" style={{ width: `${Math.max(value * 100, value > 0 ? 2 : 0)}%` }} /></div><div className="mt-1 text-xs text-zinc-500">{detail}</div></div> }

function ProfileDialog({ email, onClose, onSaved }: { email: string; onClose: () => void; onSaved: (email: string) => void }) {
  const [updatedEmail, setUpdatedEmail] = useState(email)
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function submit(event: FormEvent) {
    event.preventDefault()
    setError('')
    setBusy(true)
    try {
      const result = await saasUpdateProfile({ current_password: currentPassword, email: updatedEmail, ...(newPassword ? { new_password: newPassword } : {}) })
      onSaved(result.data?.email || updatedEmail)
    } catch (err) {
      setError(errorText(err))
    } finally {
      setBusy(false)
    }
  }

  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/30 p-4" role="dialog" aria-modal="true" aria-labelledby="profile-title">
    <form onSubmit={submit} className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
      <div className="flex items-start justify-between gap-4"><div><h2 id="profile-title" className="text-lg font-semibold">Edit profile</h2><p className="mt-1 text-sm text-zinc-500">Update your account information.</p></div><button type="button" onClick={onClose} className="rounded-lg p-2 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-950" aria-label="Close"><X className="h-5 w-5" /></button></div>
      <div className="mt-6 space-y-5"><Field label="Email" value={updatedEmail} onChange={setUpdatedEmail} type="email" /><Field label="New password (optional)" value={newPassword} onChange={setNewPassword} type="password" required={false} placeholder="Leave blank to keep your password" /><Field label="Current password" value={currentPassword} onChange={setCurrentPassword} type="password" placeholder="Required to save changes" /></div>
      {error && <div className="mt-4"><ErrorMessage text={error} /></div>}
      <div className="mt-6 flex justify-end gap-3"><button type="button" onClick={onClose} className="rounded-lg border border-zinc-300 px-4 py-2.5 text-sm text-zinc-600">Cancel</button><button disabled={busy} className="rounded-lg bg-zinc-950 px-5 py-2.5 text-sm text-white disabled:opacity-50">{busy ? 'Saving…' : 'Save changes'}</button></div>
    </form>
  </div>
}

function errorText(error: unknown) { return error instanceof globalThis.Error ? error.message : 'Something went wrong' }
function Page({ action, children }: { title?: string; subtitle?: string; action?: ReactNode; children: ReactNode }) { return <div>{action && <div className="flex justify-end">{action}</div>}<div className={action ? 'mt-6' : ''}>{children}</div></div> }
function Field({ label, value, onChange, placeholder, type = 'text', required = true, alignWithSelect = false }: { label: string; value: string; onChange: (value: string) => void; placeholder?: string; type?: string; required?: boolean; alignWithSelect?: boolean }) { return <label className="block text-sm font-medium text-zinc-700">{label}<input required={required} type={type} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className={`${alignWithSelect ? 'mt-1 rounded-md py-2' : 'mt-2 rounded-lg py-2.5'} w-full border border-zinc-300 px-3 outline-none focus:border-zinc-950`} /></label> }
function Metric({ label, value, fullValue }: { label: string; value: string; fullValue?: string }) {
  return (
    <div className="min-w-0">
      <div className="h-8 text-xs leading-4 text-zinc-500">{label}</div>
      <div className="mt-1 truncate text-lg sm:text-xl font-semibold leading-7 tabular-nums tracking-tight" title={fullValue || value}>{value}</div>
    </div>
  )
}
function Stat({ label, value, fullValue }: { label: string; value: string; fullValue?: string }) {
  return (
    <div className="flex h-full min-w-0 flex-col overflow-hidden rounded-xl border border-zinc-200 bg-white p-4">
      <Metric label={label} value={value} fullValue={fullValue} />
    </div>
  )
}
function ErrorMessage({ text }: { text: string }) { return <div className="mb-4 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{text}</div> }
function Empty({ text, href }: { text: string; href: string }) { return <Link to={href} className="block rounded-xl border border-dashed border-zinc-300 bg-white p-8 text-sm text-zinc-500 hover:border-zinc-500">{text} <span aria-hidden="true">→</span></Link> }
