import { FormEvent, ReactNode, useEffect, useRef, useState } from 'react'
import { ChevronDown, Copy, LogOut, Plus, Trash2, UserCircle } from 'lucide-react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { saasFetch, saasLogout } from '../../lib/saasApi'
import Select from '../../components/Select'

type Service = { id: string; name: string; model: string; provider_type: string; strategy: string; health_status: string }
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
    {error && <ErrorMessage text={error} />}{!services.length ? <Empty text="No model services yet." href="/app/services/new" /> : <div className="space-y-3">{services.map((service) => <div key={service.id} className="bg-white border border-zinc-200 rounded-xl p-5 flex items-center justify-between gap-4"><div><div className="font-medium">{service.name}</div><div className="mt-1 text-sm text-zinc-500">{service.provider_type} · {service.model} · {service.strategy}</div></div><div className="flex items-center gap-4"><span className="text-xs text-emerald-600">{service.health_status || 'ready'}</span><button onClick={() => remove(service.id)} className="text-zinc-400 hover:text-rose-600" title="Remove"><Trash2 className="w-4 h-4" /></button></div></div>)}</div>}
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

const STRATEGIES = [
  { id: 'cost_aware', name: 'Cost aware' },
  { id: 'capability_aware', name: 'Capability aware' },
  { id: 'load_aware', name: 'Load aware' },
  { id: 'round_robin', name: 'Round robin' },
]

export function NewServicePage() {
  const navigate = useNavigate()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [catalog, setCatalog] = useState<CatalogOffering[]>([])
  const [customProviderId, setCustomProviderId] = useState('')
  const [form, setForm] = useState({ name: '', provider_type: 'custom', base_url: '', api_key: '', upstream_model_id: '', strategy: 'cost_aware', input_price_per_1m: '', output_price_per_1m: '', capability_score: '0.5' })
  const update = (key: string, value: string) => setForm((old) => ({ ...old, [key]: value }))

  useEffect(() => {
    saasFetch<{ offerings: CatalogOffering[] }>('/api/saas/model-catalog')
      .then((result) => setCatalog(result.data?.offerings || []))
      .catch(() => {})
  }, [])

  const providers = Array.from(new Map(catalog.map((item) => [item.provider_id, { id: item.provider_id, name: item.provider_name }])).values())
  const selectedProvider = providers.find((provider) => provider.id === form.provider_type) || { id: form.provider_type, name: 'Custom provider' }
  const models = catalog.filter((item) => item.provider_id === form.provider_type)
  const selectedModel = models.find((item) => item.model === form.upstream_model_id)
  const customProvider = form.provider_type === 'custom'
  const providerOptions = [...providers, { id: 'custom', name: 'Custom provider' }]

  function selectProvider(option: { id: string | number; name: string }) {
    const provider = String(option.id)
    const firstModel = catalog.find((item) => item.provider_id === provider)
    setForm((old) => ({
      ...old,
      provider_type: provider,
      upstream_model_id: firstModel?.model || '',
      base_url: firstModel?.base_url || '',
      input_price_per_1m: firstModel ? String(firstModel.input_price_per_1m) : '',
      output_price_per_1m: firstModel ? String(firstModel.output_price_per_1m) : '',
      capability_score: firstModel ? String(firstModel.supports_reasoning ? 0.8 : 0.5) : old.capability_score,
    }))
  }

  function selectModel(option: { id: string | number; name: string }) {
    const model = models.find((item) => item.model === String(option.id))
    if (!model) return
    setForm((old) => ({ ...old, upstream_model_id: model.model, base_url: model.base_url, input_price_per_1m: String(model.input_price_per_1m), output_price_per_1m: String(model.output_price_per_1m), capability_score: String(model.supports_reasoning ? 0.8 : 0.5) }))
  }

  async function submit(event: FormEvent) {
    event.preventDefault(); setError(''); setBusy(true)
    try {
      await saasFetch('/api/saas/model-services', { method: 'POST', body: JSON.stringify({ ...form, provider_type: customProvider ? customProviderId : form.provider_type, input_price_per_1m: form.input_price_per_1m ? Number(form.input_price_per_1m) : undefined, output_price_per_1m: form.output_price_per_1m ? Number(form.output_price_per_1m) : undefined, capability_score: Number(form.capability_score) }) })
      navigate('/app/services')
    } catch (e) { setError(errorText(e)) } finally { setBusy(false) }
  }

  return <Page>
    <form onSubmit={submit} className="max-w-2xl bg-white border border-zinc-200 rounded-xl p-6 space-y-5">
      <Field label="Service name" value={form.name} onChange={(v) => update('name', v)} placeholder="My fast model" />
      <div className="grid sm:grid-cols-2 gap-5">
        <Select label="Provider" options={providerOptions} selected={selectedProvider} onChange={selectProvider} />
        {customProvider ? <Field label="Provider ID" value={customProviderId} onChange={setCustomProviderId} placeholder="my-provider" /> : <Select label="Model" options={models.map((item) => ({ id: item.model, name: `${item.model_name} (${item.model})` }))} selected={selectedModel ? { id: selectedModel.model, name: `${selectedModel.model_name} (${selectedModel.model})` } : { id: '', name: 'Select a model' }} onChange={selectModel} />}
      </div>
      {customProvider && <Field label="Model" value={form.upstream_model_id} onChange={(v) => update('upstream_model_id', v)} placeholder="provider-model-name" />}
      <Field label="OpenAI-compatible base URL" value={form.base_url} onChange={(v) => update('base_url', v)} placeholder="https://api.example.com/v1" />
      <Field label="Provider API key" type="password" value={form.api_key} onChange={(v) => update('api_key', v)} placeholder="Paste your provider key" />
      <div className="rounded-lg bg-surface-200 px-4 py-3 text-xs text-zinc-500">Responses API is available at <code>/v1/responses</code>; Chat Completions remains available at <code>/v1/chat/completions</code>.</div>
      <div className="grid sm:grid-cols-3 gap-5"><Field label="Input $/1M" value={form.input_price_per_1m} onChange={(v) => update('input_price_per_1m', v)} placeholder="0.14" /><Field label="Output $/1M" value={form.output_price_per_1m} onChange={(v) => update('output_price_per_1m', v)} placeholder="0.28" /><Field label="Capability 0–1" value={form.capability_score} onChange={(v) => update('capability_score', v)} placeholder="0.5" /></div>
      <Select label="Routing strategy" options={STRATEGIES} selected={STRATEGIES.find((item) => item.id === form.strategy) || STRATEGIES[0]} onChange={(option) => update('strategy', String(option.id))} />
      {selectedModel && <p className="text-xs text-zinc-500">{selectedModel.description} · {selectedModel.context_length ? `${selectedModel.context_length.toLocaleString()} context` : 'Context length not listed'} · {selectedModel.price_currency}</p>}
      {error && <ErrorMessage text={error} />}
      <button disabled={busy} className="rounded-lg bg-zinc-950 px-5 py-3 text-sm text-white disabled:opacity-50">{busy ? 'Creating…' : 'Create model service'}</button>
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
function Field({ label, value, onChange, placeholder, type = 'text' }: { label: string; value: string; onChange: (value: string) => void; placeholder?: string; type?: string }) { return <label className="block text-sm font-medium">{label}<input required={label !== 'Capability 0–1' && !label.includes('$/1M')} type={type} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className="mt-2 w-full rounded-lg border border-zinc-300 px-3 py-2.5 outline-none focus:border-zinc-950" /></label> }
function Stat({ label, value }: { label: string; value: string }) { return <div className="bg-white border border-zinc-200 rounded-xl p-5"><div className="text-xs text-zinc-500">{label}</div><div className="mt-2 font-mono text-2xl font-semibold">{value}</div></div> }
function ErrorMessage({ text }: { text: string }) { return <div className="mb-4 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{text}</div> }
function Empty({ text, href }: { text: string; href: string }) { return <Link to={href} className="block rounded-xl border border-dashed border-zinc-300 bg-white p-8 text-sm text-zinc-500 hover:border-zinc-500">{text} <span aria-hidden="true">→</span></Link> }
