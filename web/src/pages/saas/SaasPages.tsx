import { FormEvent, ReactNode, useEffect, useRef, useState } from 'react'
import { ArrowLeft, ChevronDown, Copy, LogOut, Plus, Trash2, UserCircle } from 'lucide-react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { saasFetch, saasLogout } from '../../lib/saasApi'

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
        SmartGate
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
  return <Page title="Model services" subtitle="Connect your providers and give each service a simple OpenAI-compatible name." action={<Link to="/app/services/new" className="inline-flex items-center gap-2 rounded-lg bg-zinc-950 px-4 py-2.5 text-sm text-white"><Plus className="w-4 h-4" /> Add service</Link>}>
    {error && <ErrorMessage text={error} />}{!services.length ? <Empty text="No model services yet." href="/app/services/new" /> : <div className="space-y-3">{services.map((service) => <div key={service.id} className="bg-white border border-zinc-200 rounded-xl p-5 flex items-center justify-between gap-4"><div><div className="font-medium">{service.name}</div><div className="mt-1 text-sm text-zinc-500">{service.provider_type} · {service.model} · {service.strategy}</div></div><div className="flex items-center gap-4"><span className="text-xs text-emerald-600">{service.health_status || 'ready'}</span><button onClick={() => remove(service.id)} className="text-zinc-400 hover:text-rose-600" title="Remove"><Trash2 className="w-4 h-4" /></button></div></div>)}</div>}
  </Page>
}

export function NewServicePage() {
  const navigate = useNavigate(); const [busy, setBusy] = useState(false); const [error, setError] = useState('')
  const [form, setForm] = useState({ name: '', provider_type: 'openai-compatible', base_url: '', api_key: '', upstream_model_id: '', strategy: 'cost_aware', input_price_per_1m: '', output_price_per_1m: '', capability_score: '0.5' })
  const update = (key: string, value: string) => setForm((old) => ({ ...old, [key]: value }))
  async function submit(event: FormEvent) { event.preventDefault(); setError(''); setBusy(true); try { await saasFetch('/api/saas/model-services', { method: 'POST', body: JSON.stringify({ ...form, input_price_per_1m: form.input_price_per_1m ? Number(form.input_price_per_1m) : undefined, output_price_per_1m: form.output_price_per_1m ? Number(form.output_price_per_1m) : undefined, capability_score: Number(form.capability_score) }) }); navigate('/app/services') } catch (e) { setError(errorText(e)) } finally { setBusy(false) } }
  return <Page title="Add a model service" subtitle="SmartGate stores the credential for routing, and never shows it again."><Link to="/app/services" className="inline-flex items-center gap-2 text-sm text-zinc-500 hover:text-zinc-950"><ArrowLeft className="w-4 h-4" /> Back to services</Link><form onSubmit={submit} className="mt-6 max-w-2xl bg-white border border-zinc-200 rounded-xl p-6 space-y-5"><Field label="Service name" value={form.name} onChange={(v) => update('name', v)} placeholder="My fast model" /><div className="grid sm:grid-cols-2 gap-5"><Field label="Provider type" value={form.provider_type} onChange={(v) => update('provider_type', v)} placeholder="deepseek" /><Field label="Upstream model" value={form.upstream_model_id} onChange={(v) => update('upstream_model_id', v)} placeholder="deepseek-chat" /></div><Field label="OpenAI-compatible base URL" value={form.base_url} onChange={(v) => update('base_url', v)} placeholder="https://api.example.com/v1" /><Field label="Provider API key" type="password" value={form.api_key} onChange={(v) => update('api_key', v)} placeholder="Paste your provider key" /><div className="grid sm:grid-cols-3 gap-5"><Field label="Input $/1M" value={form.input_price_per_1m} onChange={(v) => update('input_price_per_1m', v)} placeholder="0.14" /><Field label="Output $/1M" value={form.output_price_per_1m} onChange={(v) => update('output_price_per_1m', v)} placeholder="0.28" /><Field label="Capability 0–1" value={form.capability_score} onChange={(v) => update('capability_score', v)} placeholder="0.5" /></div><label className="block text-sm font-medium">Routing strategy<select value={form.strategy} onChange={(e) => update('strategy', e.target.value)} className="mt-2 w-full rounded-lg border border-zinc-300 px-3 py-2.5 bg-white"><option value="cost_aware">Cost aware</option><option value="capability_aware">Capability aware</option><option value="load_aware">Load aware</option><option value="round_robin">Round robin</option></select></label>{error && <ErrorMessage text={error} />}<button disabled={busy} className="rounded-lg bg-zinc-950 px-5 py-3 text-sm text-white disabled:opacity-50">{busy ? 'Creating…' : 'Create model service'}</button></form></Page>
}

export function KeysPage() {
  const [keys, setKeys] = useState<Key[]>([]); const [name, setName] = useState('Personal key'); const [raw, setRaw] = useState(''); const [error, setError] = useState('')
  const load = () => saasFetch<Key[]>('/api/saas/api-keys').then((r) => setKeys(r.data || [])).catch((e: unknown) => setError(errorText(e)))
  useEffect(() => { load() }, [])
  async function create(event: FormEvent) { event.preventDefault(); try { const result = await saasFetch<{ key: string }>('/api/saas/api-keys', { method: 'POST', body: JSON.stringify({ name }) }); setRaw(result.data?.key || ''); setName('Personal key'); load() } catch (e) { setError(errorText(e)) } }
  async function revoke(id: string) { await saasFetch(`/api/saas/api-keys/${id}`, { method: 'DELETE' }); load() }
  return <Page title="API keys" subtitle="Use a key in your app. The full key is shown only once when created."><form onSubmit={create} className="bg-white border border-zinc-200 rounded-xl p-5 flex flex-col sm:flex-row gap-3"><input required value={name} onChange={(e) => setName(e.target.value)} className="flex-1 rounded-lg border border-zinc-300 px-3 py-2.5" placeholder="Key name" /><button className="inline-flex items-center justify-center gap-2 rounded-lg bg-zinc-950 px-4 py-2.5 text-sm text-white"><Plus className="w-4 h-4" /> Create key</button></form>{raw && <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-5"><div className="text-sm font-medium text-amber-900">Copy this key now. It will not be shown again.</div><div className="mt-3 flex gap-2"><code className="flex-1 break-all rounded-lg bg-white border border-amber-200 px-3 py-2 text-sm">{raw}</code><button onClick={() => navigator.clipboard.writeText(raw)} className="p-2 rounded-lg border border-amber-300"><Copy className="w-4 h-4" /></button></div></div>}{error && <ErrorMessage text={error} />}<div className="mt-6 space-y-3">{keys.map((key) => <div key={key.id} className="bg-white border border-zinc-200 rounded-xl p-5 flex justify-between gap-4"><div><div className="font-medium">{key.name}</div><div className="mt-1 font-mono text-sm text-zinc-500">{key.prefix}••••••••</div><div className="mt-2 text-xs text-zinc-400">Created {key.created_at}{key.last_used_at ? ` · Last used ${key.last_used_at}` : ''}</div></div><button onClick={() => revoke(key.id)} className="self-start text-xs text-rose-600">Revoke</button></div>)}</div></Page>
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

  return <Page title="Usage" subtitle="Your gateway activity and the savings created by routing and context controls.">
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
function Page({ title, subtitle, action, children }: { title: string; subtitle: string; action?: ReactNode; children: ReactNode }) { return <div><div className="flex items-end justify-between gap-4"><div><h1 className="text-3xl font-semibold tracking-tight">{title}</h1><p className="mt-2 text-sm text-zinc-500">{subtitle}</p></div>{action}</div><div className="mt-8">{children}</div></div> }
function Field({ label, value, onChange, placeholder, type = 'text' }: { label: string; value: string; onChange: (value: string) => void; placeholder?: string; type?: string }) { return <label className="block text-sm font-medium">{label}<input required={label !== 'Capability 0–1' && !label.includes('$/1M')} type={type} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className="mt-2 w-full rounded-lg border border-zinc-300 px-3 py-2.5 outline-none focus:border-zinc-950" /></label> }
function Stat({ label, value }: { label: string; value: string }) { return <div className="bg-white border border-zinc-200 rounded-xl p-5"><div className="text-xs text-zinc-500">{label}</div><div className="mt-2 font-mono text-2xl font-semibold">{value}</div></div> }
function ErrorMessage({ text }: { text: string }) { return <div className="mb-4 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{text}</div> }
function Empty({ text, href }: { text: string; href: string }) { return <Link to={href} className="block rounded-xl border border-dashed border-zinc-300 bg-white p-8 text-sm text-zinc-500 hover:border-zinc-500">{text} <ArrowLeft className="inline w-4 h-4 rotate-180" /></Link> }
