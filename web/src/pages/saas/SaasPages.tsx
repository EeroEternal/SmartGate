import { FormEvent, ReactNode, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import { Activity, AlertCircle, CheckCheck, CheckCircle2, ChevronDown, ChevronLeft, ChevronRight, Copy, Download, Eye, EyeOff, ExternalLink, FileCode2, HelpCircle, Info, LogOut, Pencil, Plus, Settings2, ShieldCheck, Sliders, Sparkles, Trash2, TrendingDown, UserCircle, X, Zap } from 'lucide-react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import { saasFetch, saasLogout, saasUpdateProfile } from '../../lib/saasApi'
import Select from '../../components/Select'
import BrandMark from '../../components/BrandMark'
import { useDialog } from '../../components/Dialog'
import { useI18n } from '../../lib/i18n'
import { LanguageSwitcher } from '../../components/LanguageSwitcher'

type Service = { id: string; name: string; model: string; provider_type: string; provider_types?: string[]; endpoint_count?: number; strategy: string; health_status: string }
type Key = { id: string; name: string; prefix: string; enabled: boolean; daily_spend_limit?: number; created_at: string; last_used_at?: string; model_services?: { id: string; name: string }[] }
type ApiKeyProfile = {
  range: string
  window_start: string | null
  last_observed_at: string | null
  sample_count: number
  confidence: string
  requests: { total: number; successful: number; failed: number; success_rate: number | null }
  latency_ms: { average: number | null; p50: number | null; p95: number | null; ttft_average: number | null; ttft_p95: number | null }
  tokens: { prompt: number; completion: number; total: number; average_per_request: number | null }
  cost: { total: number; average_per_request: number | null; usage_sources: Record<string, number>; usage_confidences: Record<string, number>; pricing_sources: Record<string, number> }
  workload: { difficulty_tiers: Record<string, number>; difficulty_sources: Record<string, number>; tool_request_rate: number | null; fallback_rate: number | null; session_rate: number | null; affinity_applied_rate: number | null; affinity_hit_rate: number | null }
  providers: Record<string, number>
  quality_evidence: { status: string; judge_evaluated_requests: number; judge_agreement_rate: number | null; explicit_feedback_count: number; confidence: string }
}

export function SaasLayout({ children }: { children: ReactNode }) {
  const { t } = useI18n()
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
    [t('nav.overview'), '/app'],
    [t('nav.model_services'), '/app/services'],
    [t('nav.api_keys'), '/app/keys'],
    [t('nav.evaluation'), '/app/evaluation'],
    [t('nav.codex'), '/app/codex'],
    [t('nav.analytics'), '/app/analytics'],
    [t('nav.quality'), '/app/quality'],
    [t('nav.usage'), '/app/usage'],
  ]
  const isActive = (href: string) => href === '/app' ? location.pathname === href : location.pathname.startsWith(href)

  return <div className="min-h-screen bg-zinc-50 text-zinc-950">
    <header className="h-16 border-b border-zinc-200 bg-white px-6 md:px-10 flex items-center justify-between">
      <Link to="/app" className="flex items-center gap-3 font-semibold tracking-tight">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-white"><BrandMark className="h-5 w-5" /></span>
        SmartGate
      </Link>
      <div className="flex items-center gap-4">
        <LanguageSwitcher size="sm" />
        <div ref={accountRef} className="relative">
          <button type="button" onClick={() => setAccountOpen((open) => !open)} aria-label="Open account menu" aria-expanded={accountOpen} aria-haspopup="menu" className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-zinc-600 hover:bg-zinc-100 hover:text-zinc-950">
            <UserCircle className="h-6 w-6" />
            <ChevronDown className={`h-4 w-4 transition-transform ${accountOpen ? 'rotate-180' : ''}`} />
          </button>
          {accountOpen && <div role="menu" className="absolute right-0 z-20 mt-2 w-64 rounded-xl border border-zinc-200 bg-white p-2 shadow-lg">
            <div className="border-b border-zinc-100 px-3 py-2"><div className="text-xs text-zinc-400">Signed in as</div><div className="mt-1 truncate text-sm font-medium text-zinc-900">{email || 'Account'}</div></div>
            <button type="button" role="menuitem" onClick={() => { setAccountOpen(false); setProfileOpen(true) }} className="mt-1 flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-zinc-600 hover:bg-zinc-100 hover:text-zinc-950"><Pencil className="h-4 w-4" /> Edit profile</button>
            <button type="button" role="menuitem" onClick={logout} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-zinc-600 hover:bg-zinc-100 hover:text-zinc-950"><LogOut className="h-4 w-4" /> {t('nav.sign_out')}</button>
          </div>}
          {profileOpen && <ProfileDialog email={email} onClose={() => setProfileOpen(false)} onSaved={(updatedEmail) => { setEmail(updatedEmail); setProfileOpen(false) }} />}
        </div>
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
  const { t } = useI18n()
  const profileConfig = `model = "fusion"
model_provider = "smartgate"
preferred_auth_method = "apikey"
model_reasoning_effort = "high"
model_catalog_json = "/Users/you/.codex/models.json"

[model_providers.smartgate]
name = "SmartGate"
base_url = "https://smartgate.run/v1"
wire_api = "chat_completions"
experimental_bearer_token = "<project-api-key>"`

  const modelCatalog = `{
  "models": [{
    "slug": "fusion",
    "display_name": "Fusion (SmartGate)",
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

  return (
    <Page>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <h1 className="text-xl font-semibold tracking-tight flex items-center gap-2">
            <FileCode2 className="h-5 w-5 text-primary" />
            {t('codex.title') || 'Use Codex with SmartGate'}
          </h1>
          <span title={t('codex.subtitle') || 'Connect Codex GUI to a SmartGate model service through the OpenAI Responses API. Keep Codex as your coding workspace while SmartGate provides routing, provider fallback, budgets, and usage tracking.'} className="cursor-help text-zinc-400 hover:text-zinc-600 transition-colors">
            <HelpCircle className="h-4 w-4" />
          </span>
        </div>
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-700">
          {t('codex.supported_badge') || 'Codex supported'}
        </div>
      </div>

      <section className="mt-8 grid gap-4 md:grid-cols-3">
        {[
          ['1', t('codex.step1_title') || 'Create a model service', t('codex.step1_desc') || 'Connect providers and choose the routing strategy for Codex requests.', '/app/services', t('codex.step1_action') || 'Open model services'],
          ['2', t('codex.step2_title') || 'Create an API key', t('codex.step2_desc') || 'Authorize the model service so Codex can call it using its service name.', '/app/keys', t('codex.step2_action') || 'Open API keys'],
          ['3', t('codex.step3_title') || 'Configure Codex', t('codex.step3_desc') || 'Add the Profile and model catalog below, then restart Codex with the Profile.', null, null],
        ].map(([number, title, text, href, action]) => (
          <div key={number} className="rounded-xl border border-zinc-200 bg-white p-5">
            <div className="flex h-7 w-7 items-center justify-center rounded-full bg-primary text-xs font-semibold text-white">{number}</div>
            <h2 className="mt-4 font-semibold">{title}</h2>
            <p className="mt-2 text-sm leading-6 text-zinc-500">{text}</p>
            {href && action && (
              <Link to={href} className="mt-4 inline-flex items-center gap-1 text-sm font-medium text-primary hover:text-primary-hover">
                {action} <ExternalLink className="h-3.5 w-3.5" />
              </Link>
            )}
          </div>
        ))}
      </section>

      <section className="mt-8 rounded-xl border border-zinc-200 bg-white p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="font-semibold">{t('codex.profile_title') || 'Codex Profile'}</h2>
            <p className="mt-1 text-sm text-zinc-500">
              {t('codex.profile_desc', { path: '~/.codex/fusion.config.toml' }) || 'Save this as ~/.codex/fusion.config.toml. Replace the path, endpoint, model name, and API key with values from this workspace.'}
            </p>
          </div>
          <span className="shrink-0 rounded-full bg-zinc-100 px-3 py-1 text-xs text-zinc-600">
            {t('codex.profile_badge') || 'Profile'}
          </span>
        </div>
        <pre className="mt-5 overflow-x-auto rounded-xl bg-zinc-950 p-5 text-xs leading-6 text-zinc-200"><code>{profileConfig}</code></pre>
        <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-900">
          <strong>{t('codex.why_chat_title') || 'Why Chat Completions?'}</strong> {t('codex.why_chat_desc', { code: 'wire_api = "chat_completions"', param: 'thinking_budget' }) || 'Codex uses the OpenAI Responses API, while SmartGate translates the request for the configured upstream. For the Fusion Profile, use wire_api = "chat_completions" when the upstream does not accept the Responses API thinking_budget parameter.'}
        </div>
      </section>

      <section className="mt-6 rounded-xl border border-zinc-200 bg-white p-5">
        <div>
          <h2 className="font-semibold">{t('codex.catalog_title') || 'Model catalog'}</h2>
          <p className="mt-1 text-sm text-zinc-500">
            {t('codex.catalog_desc', { path: '~/.codex/models.json', code: 'slug' }) || 'Save this as ~/.codex/models.json. The slug must match the model service name authorized for the API key.'}
          </p>
        </div>
        <pre className="mt-5 max-h-[32rem] overflow-auto rounded-xl bg-zinc-950 p-5 text-xs leading-6 text-zinc-200"><code>{modelCatalog}</code></pre>
      </section>

      <section className="mt-6 grid gap-6 lg:grid-cols-2">
        <div className="rounded-xl border border-zinc-200 bg-white p-5">
          <h2 className="font-semibold">{t('codex.start_title') || 'Start Codex'}</h2>
          <p className="mt-2 text-sm leading-6 text-zinc-500">
            {t('codex.start_desc') || 'Use the standalone Profile so Codex does not try to load the model catalog from the base configuration.'}
          </p>
          <pre className="mt-4 overflow-x-auto rounded-lg bg-zinc-950 p-4 text-sm text-zinc-200"><code>/Applications/Codex.app/Contents/MacOS/ChatGPT --profile fusion</code></pre>
          <p className="mt-3 text-xs leading-5 text-zinc-500">
            {t('codex.restart_hint') || 'Restart Codex after changing the Profile or model catalog.'}
          </p>
        </div>
        <div className="rounded-xl border border-zinc-200 bg-white p-5">
          <h2 className="font-semibold">{t('codex.troubleshooting_title') || 'Troubleshooting'}</h2>
          <div className="mt-4 space-y-3 text-sm">
            <div className="flex gap-3">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
              <p><strong>{t('codex.err_401_title') || '401 Unauthorized:'}</strong> {t('codex.err_401_desc') || 'check the project API key and service grant.'}</p>
            </div>
            <div className="flex gap-3">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
              <p><strong>{t('codex.err_reasoning_title') || 'Reasoning preset error:'}</strong> {t('codex.err_reasoning_desc', { effort: 'effort', description: 'description' }) || 'use objects with effort and description, not strings.'}</p>
            </div>
            <div className="flex gap-3">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
              <p><strong>{t('codex.err_path_title') || 'AbsolutePathBuf error:'}</strong> {t('codex.err_path_desc', { config: 'model_catalog_json' }) || 'keep model_catalog_json in the standalone Profile.'}</p>
            </div>
          </div>
        </div>
      </section>

      <div className="mt-6 rounded-xl border border-zinc-200 bg-zinc-100 p-4 text-xs leading-5 text-zinc-600">
        {t('codex.security_warning', { token: 'experimental_bearer_token' }) || 'Keep experimental_bearer_token private. Do not commit the Profile file when it contains a real key; restrict local permissions and rotate the key if it is exposed.'}
      </div>
    </Page>
  )
}

export function ServicesPage() {
  const { t } = useI18n()
  const [services, setServices] = useState<Service[]>([])
  const [error, setError] = useState('')
  const { dialog, showConfirm } = useDialog()
  const load = () => {
    saasFetch<Service[]>('/api/saas/model-services')
      .then((r) => setServices(r.data || []))
      .catch((e: unknown) => setError(errorText(e)))
  }
  useEffect(() => { load() }, [])
  async function remove(id: string) {
    if (!await showConfirm(t('services.remove_confirm') || 'Remove this model service?', t('services.remove_title') || 'Remove model service?')) return
    await saasFetch(`/api/saas/model-services/${id}`, { method: 'DELETE' })
    load()
  }
  return (
    <Page action={<Link to="/app/services/new" className="inline-flex items-center gap-2 rounded-lg bg-zinc-950 px-4 py-2.5 text-sm text-white shadow-sm hover:bg-zinc-800 transition-colors"><Plus className="w-4 h-4" /> {t('services.create_button') || 'Add service'}</Link>}>
      {dialog}
      {error && <ErrorMessage text={error} />}
      {!services.length ? (
        <Empty text={t('services.no_services') || 'No model services yet.'} href="/app/services/new" />
      ) : (
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3">
          {services.map((service) => {
            const routing = routingInfo(service.strategy)
            const count = service.endpoint_count || 0
            const isDraft = service.health_status === 'draft' || count === 0
            return (
              <div
                key={service.id}
                className="flex flex-col justify-between rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm hover:border-zinc-300 transition-all"
              >
                <div>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h3 className="font-semibold text-zinc-950 text-base truncate" title={service.name}>
                        {service.name}
                      </h3>
                    </div>
                    <span
                      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium shrink-0 ${
                        isDraft ? 'bg-amber-50 text-amber-700 border border-amber-200' : 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                      }`}
                    >
                      {isDraft ? (t('services.setup_needed') || 'Setup needed') : (t('services.ready') || 'Ready')}
                    </span>
                  </div>

                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <span className="inline-flex items-center rounded-md bg-purple-50 px-2 py-0.5 text-xs font-medium text-purple-700 border border-purple-200/70">
                      {routing.label}
                    </span>
                    <span className="inline-flex items-center gap-1 rounded-md bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-600">
                      <span className={`h-1.5 w-1.5 rounded-full ${count > 0 ? 'bg-emerald-500' : 'bg-amber-500'}`} />
                      {count === 1
                        ? (t('services.providers_connected_single') || '1 provider connected')
                        : t('services.providers_connected', { count }) || `${count} providers connected`}
                    </span>
                  </div>
                </div>

                <div className="mt-6 flex items-center justify-between border-t border-zinc-100 pt-4">
                  <Link
                    to={`/app/services/${service.id}`}
                    className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:text-primary-hover transition-colors"
                  >
                    {isDraft ? (t('services.setup') || 'Set up') : (t('services.manage') || 'Manage')} →
                  </Link>
                  <button
                    type="button"
                    onClick={() => remove(service.id)}
                    className="rounded-lg p-1.5 text-zinc-400 hover:bg-rose-50 hover:text-rose-600 transition-colors"
                    title={t('services.remove') || 'Remove'}
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </Page>
  )
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

interface StrategyMatrixCardSelectorProps {
  selectedStrategy: string
  onSelect: (strategy: string) => void
}

function StrategyMatrixCardSelector({ selectedStrategy, onSelect }: StrategyMatrixCardSelectorProps) {
  const { t } = useI18n()

  const strategyCards = [
    {
      id: 'cost_aware',
      title: t('services.strategy_cost_title') || 'Cost-Efficient Pareto',
      desc: t('services.strategy_cost_desc') || 'Automatically downshifts low-complexity queries to high-throughput Flash models, reserving flagship Pro models for complex tasks.',
      badge: 'Auto Downshift',
      badgeClass: 'bg-emerald-50 text-emerald-700 border-emerald-200',
      icon: TrendingDown,
    },
    {
      id: 'capability_aware',
      title: t('services.strategy_dna_title') || '5D Capability-Weighted',
      desc: t('services.strategy_dna_desc') || 'Dynamically scores endpoints based on calibrated 5D capability benchmarks tailored to your workload intent.',
      badge: '5D Model DNA',
      badgeClass: 'bg-purple-50 text-purple-700 border-purple-200',
      icon: Sparkles,
    },
    {
      id: 'load_aware',
      title: t('services.strategy_load_title') || 'Load-Balanced & Low-Latency',
      desc: t('services.strategy_load_desc') || 'Sends traffic toward providers with lowest active load and fastest response latency.',
      badge: 'Low Latency',
      badgeClass: 'bg-sky-50 text-sky-700 border-sky-200',
      icon: Activity,
    },
    {
      id: 'round_robin',
      title: t('services.strategy_round_robin_title') || 'Even Distribution',
      desc: t('services.strategy_round_robin_desc') || 'Distributes requests sequentially across all healthy connected providers with automatic fallback.',
      badge: 'Equal Weight',
      badgeClass: 'bg-zinc-100 text-zinc-700 border-zinc-200',
      icon: CheckCheck,
    },
  ]

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <label className="block text-xs font-semibold uppercase tracking-wider text-zinc-500">
          {t('services.strategy_hub_title') || 'Routing Strategy Matrix'}
        </label>
        <span className="text-xs text-zinc-400">
          {t('services.strategy_hub_desc') || 'Choose how SmartGate optimizes cost, latency, and quality.'}
        </span>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {strategyCards.map((card) => {
          const isSelected = selectedStrategy === card.id
          const Icon = card.icon
          return (
            <button
              key={card.id}
              type="button"
              onClick={() => onSelect(card.id)}
              className={`relative flex flex-col justify-between rounded-xl border p-4 text-left transition-all ${
                isSelected
                  ? 'border-zinc-950 bg-zinc-50/90 ring-1 ring-zinc-950 shadow-sm'
                  : 'border-zinc-200 bg-white hover:border-zinc-300 hover:bg-zinc-50/40'
              }`}
            >
              <div>
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <div className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${isSelected ? 'bg-zinc-950 text-white' : 'bg-zinc-100 text-zinc-600'}`}>
                      <Icon className="h-4 w-4" />
                    </div>
                    <span className="font-semibold text-sm text-zinc-950 leading-snug">{card.title}</span>
                  </div>
                  <span className={`rounded-full border px-2 py-0.5 text-[10px] font-medium shrink-0 ${card.badgeClass}`}>
                    {card.badge}
                  </span>
                </div>
                <p className="mt-2.5 text-xs leading-relaxed text-zinc-500">{card.desc}</p>
              </div>
              <div className="mt-3 flex items-center justify-between pt-2 border-t border-zinc-100">
                <div className="flex items-center gap-1.5">
                  <span className={`h-2 w-2 rounded-full ${isSelected ? 'bg-zinc-950' : 'bg-zinc-300'}`} />
                  <span className={`text-xs ${isSelected ? 'font-medium text-zinc-900' : 'text-zinc-400'}`}>
                    {isSelected ? (t('services.active_strategy') || 'Selected') : (t('services.configure_strategy') || 'Select')}
                  </span>
                </div>
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}

interface WorkloadPresetSelectorProps {
  selectedPreset: string
  onSelectPreset: (presetId: string) => void
}

function WorkloadPresetSelector({ selectedPreset, onSelectPreset }: WorkloadPresetSelectorProps) {
  const { t } = useI18n()

  const presets = [
    {
      id: 'coding',
      name: t('services.preset_coding') || 'Coding Agent (90% Code + 10% Tools)',
      icon: '💻',
      desc: 'SWE benchmarks, syntax synthesis, patch tools',
    },
    {
      id: 'reasoning',
      name: t('services.preset_reasoning') || 'Reasoning & Math (85% Reasoning + 15% Code)',
      icon: '🧠',
      desc: 'Multi-step logic, math proofs, deep chain-of-thought',
    },
    {
      id: 'tools',
      name: t('services.preset_tools') || 'Autonomous Agent (60% Tools + 40% Reasoning)',
      icon: '🛠️',
      desc: 'Schema adherence, tool execution, multi-agent workflow',
    },
    {
      id: 'general',
      name: t('services.preset_general') || 'General Assistant (70% NLP + 30% Context)',
      icon: '🌐',
      desc: 'Balanced conversational NLP and context retention',
    },
  ]

  return (
    <div className="rounded-xl border border-purple-200/80 bg-purple-50/40 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <label className="text-xs font-semibold uppercase tracking-wider text-purple-900 flex items-center gap-1.5">
          <Sparkles className="h-3.5 w-3.5 text-purple-600" />
          {t('services.workload_presets') || 'Workload Intent Presets'}
        </label>
        <span className="text-[11px] text-purple-700/80">Auto-calibrates 5D weights</span>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {presets.map((preset) => {
          const isSelected = selectedPreset === preset.id
          return (
            <button
              key={preset.id}
              type="button"
              onClick={() => onSelectPreset(preset.id)}
              className={`flex items-start gap-2.5 rounded-lg border p-2.5 text-left transition-all ${
                isSelected
                  ? 'border-purple-600 bg-white ring-1 ring-purple-600 shadow-xs'
                  : 'border-purple-200/60 bg-white/70 hover:border-purple-300 hover:bg-white'
              }`}
            >
              <span className="text-base leading-none mt-0.5">{preset.icon}</span>
              <div className="min-w-0">
                <div className="text-xs font-semibold text-zinc-900 truncate">{preset.name}</div>
                <div className="text-[11px] text-zinc-500 leading-tight mt-0.5">{preset.desc}</div>
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}

export function NewServicePage() {
  const { t } = useI18n()
  const navigate = useNavigate()
  const [name, setName] = useState('')
  const [strategy, setStrategy] = useState('cost_aware')
  const [preset, setPreset] = useState('coding')
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
    <form onSubmit={submit} className="max-w-3xl space-y-5">
      <div className="rounded-xl border border-zinc-200 bg-white p-6 space-y-6">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">{t('services.create_title') || 'Create a model service'}</h1>
          <p className="mt-1 text-sm text-zinc-500">Configure your model service entry point and visual routing strategy.</p>
        </div>

        <Field label={t('services.name_label') || 'Model service name'} value={name} onChange={setName} placeholder="fusion" />

        <StrategyMatrixCardSelector selectedStrategy={strategy} onSelect={setStrategy} />

        {strategy === 'capability_aware' && (
          <WorkloadPresetSelector selectedPreset={preset} onSelectPreset={setPreset} />
        )}

        <div className="flex gap-3 rounded-lg bg-surface-200 px-4 py-3 text-sm text-zinc-600">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
          <span>{t('services.create_tip') || 'Add provider connections after creating the service. They will all use this model name.'}</span>
        </div>
      </div>
      {error && <ErrorMessage text={error} />}
      <div className="flex justify-end gap-3">
        <Link to="/app/services" className="rounded-lg border border-zinc-300 px-4 py-2.5 text-sm text-zinc-600 hover:bg-zinc-50 transition-colors">
          {t('common.cancel') || 'Cancel'}
        </Link>
        <button disabled={busy} className="rounded-lg bg-zinc-950 px-5 py-2.5 text-sm text-white hover:bg-zinc-800 transition-colors disabled:opacity-50">
          {busy ? (t('common.creating') || 'Creating…') : (t('services.create_button') || 'Create model service')}
        </button>
      </div>
    </form>
  </Page>
}

type ModelDna = { code_logic: number; reasoning_math: number; agent_tools: number; multilingual_nlp: number; context_retention: number; strengths: string[] }
type ServiceEndpoint = { id: string; provider_id: string; provider_name: string; provider_type: string; protocol: string; model: string; base_url: string; input_price_per_1m: number; output_price_per_1m: number; capability_score: number; configured_capability_score?: number; context_length?: number; enabled?: boolean; supports_tools?: boolean; health_status?: string; cooling_down?: boolean; health_observed?: boolean; total_requests?: number; total_errors?: number; preferred_for_hard_requests?: boolean; model_dna?: ModelDna }
type ServiceDetails = { id: string; name: string; model?: string; strategy: string; status: string; endpoint_count: number; endpoints: ServiceEndpoint[]; judge_enabled?: boolean; judge_endpoint_id?: string }
type CallApi = 'openai-chat' | 'openai-responses' | 'anthropic-messages'

function callExample(api: CallApi, model: string) {
  if (api === 'openai-responses') {
    return {
      label: 'OpenAI Responses',
      path: 'https://smartgate.run/v1/responses',
      headers: ['Authorization: Bearer <YOUR_API_KEY>', 'Content-Type: application/json'],
      body: `{"model":"${model}","input":"Hello"}`,
    }
  }
  if (api === 'anthropic-messages') {
    return {
      label: 'Anthropic Messages',
      path: 'https://smartgate.run/v1/messages',
      headers: ['Authorization: Bearer <YOUR_API_KEY>', 'anthropic-version: 2023-06-01', 'Content-Type: application/json'],
      body: `{"model":"${model}","max_tokens":128,"messages":[{"role":"user","content":"Hello"}]}`,
    }
  }
  return {
    label: 'OpenAI Chat',
    path: 'https://smartgate.run/v1/chat/completions',
    headers: ['Authorization: Bearer <YOUR_API_KEY>', 'Content-Type: application/json'],
    body: `{"model":"${model}","messages":[{"role":"user","content":"Hello"}]}`,
  }
}

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
  const routing = service ? routingInfo(service.strategy) : null
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
            title="Copy message"
          >
            <Copy className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => setTestToast(null)}
            className="rounded-md p-1 text-zinc-500 hover:bg-black/5 hover:text-zinc-900 transition-colors"
            title="Close"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    )}
    {!service ? <div className="rounded-xl border border-zinc-200 bg-white p-6 text-sm text-zinc-500">{t('common.loading') || 'Loading model service…'}</div> : <div className="max-w-4xl space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link to="/app/services" className="text-sm text-zinc-500 hover:text-zinc-950">← {t('nav.model_services') || 'Model services'}</Link>
          <h1 className="mt-3 text-xl font-semibold tracking-tight">{service.name}</h1>
        </div>
        <button type="button" onClick={() => setModalOpen(true)} className="inline-flex items-center gap-2 rounded-lg bg-zinc-950 px-4 py-2.5 text-sm text-white shadow-sm hover:bg-zinc-800 transition-colors">
          <Plus className="h-4 w-4" /> {t('services.add_provider') || 'Add provider'}
        </button>
      </div>
      <section className="rounded-xl border border-zinc-200 bg-white p-5">
        <div className="grid items-start gap-5 md:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1fr)]">
          <div className="min-w-0">
            <label className="block text-xs font-medium uppercase tracking-wide text-zinc-400">{t('services.service_label') || 'Model service'}</label>
            <div className="mt-2 flex items-center gap-2">
              <span className="truncate text-lg font-medium text-zinc-950">{service.name}</span>
              <button type="button" onClick={copyServiceName} className="rounded-md p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-950" title={t('common.copy') || 'Copy model service name'}>
                <Copy className="h-4 w-4" />
              </button>
              {copied && <span className="text-xs text-emerald-600 font-medium">{t('common.copied') || 'Copied'}</span>}
            </div>
          </div>
          <div className="text-sm text-zinc-600">
            <div className="flex items-center gap-1">
              <span className="font-medium text-zinc-950">{t('services.routing_strategy') || 'Routing'}</span>
              <button type="button" onClick={() => setRoutingOpen(true)} className="rounded-md p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-950" title={t('services.edit_routing_title') || 'Edit routing strategy'}>
                <Pencil className="h-4 w-4" />
              </button>
            </div>
            <div className="mt-1 text-zinc-500">{routing?.label}</div>
            {service.strategy === 'capability_aware' && service.judge_enabled && (
              <div className="mt-1 text-xs text-emerald-600 font-medium">
                {t('services.judge_status', { model: service.endpoints.find((ep) => ep.id === service.judge_endpoint_id)?.model || 'Enabled' })}
              </div>
            )}
          </div>
          <div className="text-sm text-zinc-600">
            <span className="font-medium text-zinc-950">{t('services.supported_apis') || 'Supported APIs'}</span>
            <div className="mt-1 space-y-1 text-zinc-500">
              <div>OpenAI Chat</div>
              <div>OpenAI Responses</div>
              <div>Anthropic Messages</div>
            </div>
          </div>
        </div>
      </section>

      <CallExamplePanel api={callApi} model={service.name} onChange={setCallApi} />

      <div className="rounded-xl border border-zinc-200 bg-white p-5">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">{t('services.providers_title') || 'Providers'}</h2>
          <span className={`rounded-full px-3 py-1 text-xs font-medium ${service.status === 'draft' ? 'bg-amber-50 text-amber-700 border border-amber-200' : 'bg-emerald-50 text-emerald-700 border border-emerald-200'}`}>
            {service.status === 'draft' ? (t('services.setup_needed') || 'Setup needed') : (t('services.ready') || 'Ready')}
          </span>
        </div>
        {service.endpoints.length ? (
          <div className="mt-5 space-y-3">
            {service.endpoints.map((endpoint) => (
              <div key={endpoint.id} className="rounded-lg border border-zinc-200 p-4 hover:border-zinc-300 transition-colors">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="font-medium text-zinc-950">{endpoint.provider_name}</div>
                    <div className="mt-2 text-sm text-zinc-500">{endpoint.model}</div>
                    <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                      <span className="text-zinc-400">
                        {t('services.capability') || 'Capability'} {(endpoint.capability_score ?? 0.5).toFixed(2)}
                      </span>
                      {endpoint.configured_capability_score != null && Math.abs(endpoint.configured_capability_score - (endpoint.capability_score ?? 0)) > 0.005 && (
                        <span className="rounded-md border border-zinc-200 bg-zinc-100 px-1.5 py-0.5 font-medium text-zinc-500">
                          auto
                        </span>
                      )}
                      {endpoint.preferred_for_hard_requests && (
                        <span className="rounded-md border border-purple-200 bg-purple-50 px-1.5 py-0.5 font-medium text-purple-700">
                          {t('services.routes_hard') || 'Routes hard requests'}
                        </span>
                      )}
                      {endpoint.enabled === false && (
                        <span className="rounded-md border border-zinc-200 bg-zinc-100 px-1.5 py-0.5 font-medium text-zinc-600">
                          {t('common.disabled') || 'Disabled'}
                        </span>
                      )}
                      {endpoint.health_status && endpoint.health_status !== 'healthy' && (
                        <span className="rounded-md border border-rose-200 bg-rose-50 px-1.5 py-0.5 font-medium text-rose-700">
                          {endpoint.cooling_down ? (t('services.cooling_down') || 'Cooling down') : endpoint.health_status}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <button type="button" onClick={() => setProbingEndpoint(endpoint)} className="rounded-md p-2 text-zinc-400 hover:bg-purple-50 hover:text-purple-600 transition-colors" title={t('services.probe_button') || 'Probe DNA & Capabilities'}>
                      <Sparkles className="h-4 w-4" />
                    </button>
                    <button type="button" onClick={() => setEditingEndpoint(endpoint)} className="rounded-md p-2 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-950 transition-colors" title={t('services.edit_provider') || 'Edit provider'}>
                      <Pencil className="h-4 w-4" />
                    </button>
                    <button type="button" onClick={() => testEndpoint(endpoint.id)} disabled={testingEndpoint === endpoint.id} className={`rounded-md p-2 transition-colors disabled:opacity-50 ${testingEndpoint === endpoint.id ? 'animate-pulse text-zinc-400' : testResults[endpoint.id] === 'passed' ? 'text-emerald-500 hover:bg-emerald-50' : testResults[endpoint.id] === 'failed' ? 'text-rose-500 hover:bg-rose-50' : 'text-zinc-400 hover:bg-zinc-100 hover:text-zinc-950'}`} title={t('services.test_connection') || 'Test connection'}>
                      <Zap className="h-4 w-4" />
                    </button>
                    <button type="button" onClick={() => removeEndpoint(endpoint.id)} className="rounded-md p-2 text-zinc-400 hover:bg-rose-50 hover:text-rose-600 transition-colors" title={t('services.remove_provider') || 'Remove provider'}>
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="mt-5 rounded-lg border border-dashed border-zinc-300 px-5 py-8 text-center">
            <p className="text-sm text-zinc-500">{t('services.no_providers') || 'No providers connected yet.'}</p>
            <button type="button" onClick={() => setModalOpen(true)} className="mt-3 text-sm font-medium text-primary hover:text-primary-hover">
              {t('services.add_provider') || 'Add provider'}
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

const RADAR_PALETTES = [
  { stroke: '#8b5cf6', fill: 'rgba(139, 92, 246, 0.22)', dot: '#7c3aed', text: 'text-purple-700', bg: 'bg-purple-600', pill: 'bg-purple-50 text-purple-700 border-purple-200' },
  { stroke: '#10b981', fill: 'rgba(16, 185, 129, 0.22)', dot: '#059669', text: 'text-emerald-700', bg: 'bg-emerald-600', pill: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  { stroke: '#f59e0b', fill: 'rgba(245, 158, 11, 0.22)', dot: '#d97706', text: 'text-amber-700', bg: 'bg-amber-600', pill: 'bg-amber-50 text-amber-700 border-amber-200' },
  { stroke: '#0ea5e9', fill: 'rgba(14, 165, 233, 0.22)', dot: '#0284c7', text: 'text-sky-700', bg: 'bg-sky-600', pill: 'bg-sky-50 text-sky-700 border-sky-200' },
  { stroke: '#ec4899', fill: 'rgba(236, 72, 153, 0.22)', dot: '#db2777', text: 'text-pink-700', bg: 'bg-pink-600', pill: 'bg-pink-50 text-pink-700 border-pink-200' },
  { stroke: '#6366f1', fill: 'rgba(99, 102, 241, 0.22)', dot: '#4f46e5', text: 'text-indigo-700', bg: 'bg-indigo-600', pill: 'bg-indigo-50 text-indigo-700 border-indigo-200' },
]

export function EvaluationPage() {
  const { t } = useI18n()
  const [endpoints, setEndpoints] = useState<(ServiceEndpoint & { serviceId: string; serviceName: string })[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [hoveredPoint, setHoveredPoint] = useState<{ model: string; dim: string; score: number; x: number; y: number } | null>(null)
  const [probingEndpoint, setProbingEndpoint] = useState<{ endpoint: ServiceEndpoint; serviceId: string } | null>(null)

  const loadData = async () => {
    try {
      setLoading(true)
      const res = await saasFetch<Service[]>('/api/saas/model-services')
      const services = res.data || []
      const list: (ServiceEndpoint & { serviceId: string; serviceName: string })[] = []
      const seen = new Set<string>()

      for (const s of services) {
        try {
          const detailRes = await saasFetch<ServiceDetails>(`/api/saas/model-services/${s.id}`)
          if (detailRes.data?.endpoints) {
            for (const ep of detailRes.data.endpoints) {
              const key = `${ep.provider_name}::${ep.model}`
              if (!seen.has(key)) {
                seen.add(key)
                list.push({ ...ep, serviceId: s.id, serviceName: s.name })
              }
            }
          }
        } catch {}
      }

      setEndpoints(list)
      setSelectedIds(list.slice(0, 6).map((e) => e.id))
    } catch (e: any) {
      setError(errorText(e))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadData()
  }, [])

  const toggleEndpoint = (id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? (prev.length > 1 ? prev.filter((item) => item !== id) : prev) : [...prev, id]
    )
  }

  const selectAll = () => setSelectedIds(endpoints.map((e) => e.id))
  const clearAll = () => {
    if (endpoints.length > 0) setSelectedIds([endpoints[0].id])
  }

  const RADAR_DIMENSIONS = [
    { id: 'code_logic', name: t('radar.code_logic'), short: t('radar.code_short'), icon: '💻', anchor: 'middle' as const, dx: 0, dy: -12 },
    { id: 'reasoning_math', name: t('radar.reasoning_math'), short: t('radar.math_short'), icon: '🧠', anchor: 'start' as const, dx: 10, dy: 4 },
    { id: 'agent_tools', name: t('radar.agent_tools'), short: t('radar.tools_short'), icon: '🛠️', anchor: 'start' as const, dx: 8, dy: 16 },
    { id: 'multilingual_nlp', name: t('radar.multilingual_nlp'), short: t('radar.lang_short'), icon: '🌐', anchor: 'end' as const, dx: -8, dy: 16 },
    { id: 'context_retention', name: t('radar.context_retention'), short: t('radar.context_short'), icon: '📜', anchor: 'end' as const, dx: -10, dy: 4 },
  ]

  const cx = 170
  const cy = 150
  const maxR = 95
  const angles = [0, 1, 2, 3, 4].map((i) => (2 * Math.PI * i) / 5 - Math.PI / 2)

  const getCoord = (score: number, idx: number) => {
    const r = (Math.max(10, Math.min(100, score)) / 100) * maxR
    const angle = angles[idx]
    return {
      x: cx + r * Math.cos(angle),
      y: cy + r * Math.sin(angle),
    }
  }

  const gridLevels = [20, 40, 60, 80, 100]

  const topCoding = [...endpoints].sort((a, b) => (b.model_dna?.code_logic || Math.round((b.capability_score || 0.5) * 100)) - (a.model_dna?.code_logic || Math.round((a.capability_score || 0.5) * 100)))[0]
  const topReasoning = [...endpoints].sort((a, b) => (b.model_dna?.reasoning_math || Math.round((b.capability_score || 0.5) * 98)) - (a.model_dna?.reasoning_math || Math.round((a.capability_score || 0.5) * 98)))[0]
  const topFlash = [...endpoints].sort((a, b) => (a.input_price_per_1m || 0.1) - (b.input_price_per_1m || 0.1))[0]

  return (
    <Page>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <h1 className="text-xl font-semibold tracking-tight flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-purple-600" />
            {t('evaluation.title') || 'Model Evaluation'}
          </h1>
          <span title={t('evaluation.subtitle') || '5D multi-dimensional capability evaluation across Coding, Reasoning, Agent Tool Calling, Multilingual NLP, and Long Context.'} className="cursor-help text-zinc-400 hover:text-zinc-600 transition-colors">
            <HelpCircle className="h-4 w-4" />
          </span>
        </div>
      </div>

      {error && <ErrorMessage text={error} />}

      <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="flex flex-col justify-between rounded-xl border border-zinc-200 bg-white p-5 shadow-sm">
          <div className="text-xs font-medium uppercase tracking-wide text-zinc-500 whitespace-nowrap">{t('evaluation.models_evaluated') || 'Models Evaluated'}</div>
          <div className="mt-2 text-3xl font-bold text-zinc-950">{endpoints.length}</div>
          <div className="mt-2 text-xs text-zinc-400">{t('radar.badge') || '5D Capability Radar'}</div>
        </div>

        <div className="flex flex-col justify-between rounded-xl border border-zinc-200 bg-white p-5 shadow-sm">
          <div className="text-xs font-medium uppercase tracking-wide text-zinc-500 whitespace-nowrap">{t('evaluation.top_coding') || 'Top Coding Model'}</div>
          <div className="mt-2 text-xl font-bold text-purple-700 truncate">{topCoding?.model || '—'}</div>
          <div className="mt-2 text-xs text-zinc-400">{topCoding?.provider_name ? `${topCoding.provider_name} • ${topCoding.model_dna?.code_logic || 96} pts` : '—'}</div>
        </div>

        <div className="flex flex-col justify-between rounded-xl border border-zinc-200 bg-white p-5 shadow-sm">
          <div className="text-xs font-medium uppercase tracking-wide text-zinc-500 whitespace-nowrap">{t('evaluation.top_reasoning') || 'Top Reasoning Model'}</div>
          <div className="mt-2 text-xl font-bold text-amber-600 truncate">{topReasoning?.model || '—'}</div>
          <div className="mt-2 text-xs text-zinc-400">{topReasoning?.provider_name ? `${topReasoning.provider_name} • ${topReasoning.model_dna?.reasoning_math || 98} pts` : '—'}</div>
        </div>

        <div className="flex flex-col justify-between rounded-xl border border-zinc-200 bg-white p-5 shadow-sm">
          <div className="text-xs font-medium uppercase tracking-wide text-zinc-500 whitespace-nowrap">{t('evaluation.top_flash') || 'Top Speed & Cost Model'}</div>
          <div className="mt-2 text-xl font-bold text-emerald-600 truncate">{topFlash?.model || '—'}</div>
          <div className="mt-2 text-xs text-zinc-400">{topFlash ? `$${topFlash.input_price_per_1m || 0.14}/1M tokens` : '—'}</div>
        </div>
      </div>

      <section className="mt-8 rounded-xl border border-zinc-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-100 pb-4">
          <div className="flex items-center gap-2">
            <h2 className="font-semibold text-zinc-950">{t('evaluation.radar_title') || t('radar.title')}</h2>
            <span className="rounded-md bg-purple-50 px-2 py-0.5 text-xs font-semibold text-purple-700 border border-purple-200">
              {t('radar.badge')}
            </span>
            <span title={t('evaluation.radar_desc') || t('radar.subtitle')} className="cursor-help text-zinc-400 hover:text-zinc-600 transition-colors">
              <HelpCircle className="h-3.5 w-3.5" />
            </span>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={selectAll}
              className="text-xs font-medium text-primary hover:text-primary-hover transition-colors"
            >
              {t('evaluation.select_all') || 'Select All'}
            </button>
            <span className="text-zinc-300">|</span>
            <button
              type="button"
              onClick={clearAll}
              className="text-xs font-medium text-zinc-500 hover:text-zinc-800 transition-colors"
            >
              {t('evaluation.clear_all') || 'Clear'}
            </button>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          {endpoints.map((ep, idx) => {
            const isSelected = selectedIds.includes(ep.id)
            const palette = RADAR_PALETTES[idx % RADAR_PALETTES.length]
            return (
              <button
                key={ep.id}
                type="button"
                onClick={() => toggleEndpoint(ep.id)}
                className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium border transition-all ${
                  isSelected
                    ? `${palette.pill} shadow-xs font-semibold`
                    : 'border-zinc-200 bg-zinc-50 text-zinc-400 hover:text-zinc-700'
                }`}
              >
                <span
                  className="h-2 w-2 rounded-full shrink-0"
                  style={{ backgroundColor: isSelected ? palette.dot : '#a1a1aa' }}
                />
                <span>{ep.model}</span>
                <span className="text-[10px] opacity-70">({ep.provider_name})</span>
              </button>
            )
          })}
        </div>

        <div className="mt-6 grid grid-cols-1 lg:grid-cols-[400px_1fr] gap-8 items-center">
          <div className="relative flex flex-col items-center justify-center p-3 rounded-2xl bg-zinc-50/70 border border-zinc-100">
            <svg viewBox="0 0 340 300" className="w-full max-w-[360px] h-[300px] select-none">
              {gridLevels.map((lvl) => {
                const pts = angles
                  .map((a) => {
                    const r = (lvl / 100) * maxR
                    return `${cx + r * Math.cos(a)},${cy + r * Math.sin(a)}`
                  })
                  .join(' ')
                return (
                  <polygon
                    key={lvl}
                    points={pts}
                    fill="none"
                    stroke="#e4e4e7"
                    strokeWidth={lvl === 100 ? '1.5' : '1'}
                    strokeDasharray={lvl === 100 ? 'none' : '2,2'}
                  />
                )
              })}

              {angles.map((a, i) => (
                <line
                  key={i}
                  x1={cx}
                  y1={cy}
                  x2={cx + maxR * Math.cos(a)}
                  y2={cy + maxR * Math.sin(a)}
                  stroke="#e4e4e7"
                  strokeWidth="1"
                />
              ))}

              {RADAR_DIMENSIONS.map((dim, i) => {
                const a = angles[i]
                const labelR = maxR + 24
                const lx = cx + labelR * Math.cos(a) + dim.dx
                const ly = cy + labelR * Math.sin(a) + dim.dy
                return (
                  <text
                    key={dim.id}
                    x={lx}
                    y={ly}
                    textAnchor={dim.anchor}
                    className="text-[11px] font-medium fill-zinc-600"
                  >
                    {dim.icon} {dim.short}
                  </text>
                )
              })}

              {endpoints.map((ep, idx) => {
                if (!selectedIds.includes(ep.id)) return null
                const palette = RADAR_PALETTES[idx % RADAR_PALETTES.length]
                const dna = ep.model_dna || {
                  code_logic: Math.round((ep.capability_score || 0.5) * 100),
                  reasoning_math: Math.round((ep.capability_score || 0.5) * 98),
                  agent_tools: ep.supports_tools ? 92 : 60,
                  multilingual_nlp: 90,
                  context_retention: 88,
                  strengths: [],
                }
                const scores = [
                  dna.code_logic,
                  dna.reasoning_math,
                  dna.agent_tools,
                  dna.multilingual_nlp,
                  dna.context_retention,
                ]
                const pts = scores.map((s, i) => getCoord(s, i))
                const ptsStr = pts.map((p) => `${p.x},${p.y}`).join(' ')

                return (
                  <g key={ep.id} className="transition-all duration-300">
                    <polygon
                      points={ptsStr}
                      fill={palette.fill}
                      stroke={palette.stroke}
                      strokeWidth="2"
                      className="hover:opacity-90 transition-opacity"
                    />
                    {pts.map((p, pIdx) => (
                      <circle
                        key={pIdx}
                        cx={p.x}
                        cy={p.y}
                        r="4"
                        fill={palette.dot}
                        stroke="#fff"
                        strokeWidth="1.5"
                        className="cursor-pointer hover:r-6 transition-all"
                        onMouseEnter={() =>
                          setHoveredPoint({
                            model: ep.model,
                            dim: RADAR_DIMENSIONS[pIdx].name,
                            score: scores[pIdx],
                            x: p.x,
                            y: p.y,
                          })
                        }
                        onMouseLeave={() => setHoveredPoint(null)}
                      />
                    ))}
                  </g>
                )
              })}
            </svg>

            {hoveredPoint && (
              <div
                className="pointer-events-none absolute z-50 rounded-lg border border-zinc-200 bg-white/95 px-2.5 py-1 text-xs shadow-md backdrop-blur-xs"
                style={{
                  left: `${(hoveredPoint.x / 340) * 100}%`,
                  top: `${(hoveredPoint.y / 300) * 100 - 18}%`,
                  transform: 'translate(-50%, -100%)',
                }}
              >
                <div className="font-semibold text-zinc-950">{hoveredPoint.model}</div>
                <div className="text-zinc-500 text-[11px]">
                  {hoveredPoint.dim}: <span className="font-mono font-bold text-zinc-900">{hoveredPoint.score}/100</span>
                </div>
              </div>
            )}

            <div className="mt-2 flex items-center gap-4 text-[10px] text-zinc-400">
              <span>{t('radar.inner_ring')}</span>
              <span>{t('radar.mid_ring')}</span>
              <span>{t('radar.outer_perimeter')}</span>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {endpoints.map((ep, idx) => {
              const isSelected = selectedIds.includes(ep.id)
              const palette = RADAR_PALETTES[idx % RADAR_PALETTES.length]
              const dna = ep.model_dna || {
                code_logic: Math.round((ep.capability_score || 0.5) * 100),
                reasoning_math: Math.round((ep.capability_score || 0.5) * 98),
                agent_tools: ep.supports_tools ? 92 : 60,
                multilingual_nlp: 90,
                context_retention: 88,
                strengths: ['Adaptive Reasoning', 'Low-Latency Synthesis'],
              }
              return (
                <div
                  key={ep.id}
                  onClick={() => toggleEndpoint(ep.id)}
                  className={`cursor-pointer rounded-xl border p-3 transition-all ${
                    isSelected
                      ? 'border-zinc-300 bg-white shadow-xs'
                      : 'border-zinc-200 bg-zinc-50/50 opacity-60 hover:opacity-100'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ backgroundColor: palette.dot }} />
                      <span className="font-semibold text-zinc-900 truncate text-sm">{ep.model}</span>
                      <span className="text-xs text-zinc-400 truncate">({ep.provider_name})</span>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] font-mono font-medium text-zinc-700">
                        {t('radar.cap_score', { score: (ep.capability_score ?? 0.5).toFixed(2) })}
                      </span>
                      {ep.preferred_for_hard_requests && (
                        <span className="rounded-md bg-purple-50 border border-purple-200 px-1.5 py-0.5 text-[10px] font-semibold text-purple-700">
                          {t('radar.pro_tier')}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="mt-3 grid grid-cols-5 gap-1 text-center text-[10px]">
                    <div className="rounded bg-zinc-50 p-1 border border-zinc-100">
                      <div className="text-zinc-400 text-[9px]">{t('radar.code_short')}</div>
                      <div className="font-bold text-zinc-900 font-mono">{dna.code_logic}</div>
                    </div>
                    <div className="rounded bg-zinc-50 p-1 border border-zinc-100">
                      <div className="text-zinc-400 text-[9px]">{t('radar.math_short')}</div>
                      <div className="font-bold text-zinc-900 font-mono">{dna.reasoning_math}</div>
                    </div>
                    <div className="rounded bg-zinc-50 p-1 border border-zinc-100">
                      <div className="text-zinc-400 text-[9px]">{t('radar.tools_short')}</div>
                      <div className="font-bold text-zinc-900 font-mono">{dna.agent_tools}</div>
                    </div>
                    <div className="rounded bg-zinc-50 p-1 border border-zinc-100">
                      <div className="text-zinc-400 text-[9px]">{t('radar.lang_short')}</div>
                      <div className="font-bold text-zinc-900 font-mono">{dna.multilingual_nlp}</div>
                    </div>
                    <div className="rounded bg-zinc-50 p-1 border border-zinc-100">
                      <div className="text-zinc-400 text-[9px]">{t('radar.context_short')}</div>
                      <div className="font-bold text-zinc-900 font-mono">{dna.context_retention}</div>
                    </div>
                  </div>

                  <div className="mt-3 flex items-center justify-between border-t border-zinc-100 pt-2.5">
                    <span className="text-xs text-zinc-400">{ep.serviceName}</span>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        setProbingEndpoint({ endpoint: ep, serviceId: ep.serviceId })
                      }}
                      className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-purple-700 hover:bg-purple-50 transition-colors"
                    >
                      <Sparkles className="h-3.5 w-3.5" /> {t('evaluation.run_probe') || 'Run Probe'}
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </section>

      <section className="mt-8 rounded-xl border border-zinc-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-100 pb-4">
          <div className="flex items-center gap-2">
            <h2 className="font-semibold text-zinc-950">{t('evaluation.matrix_title') || 'Multi-Dimensional Model Matrix'}</h2>
            <span title={t('evaluation.matrix_subtitle') || 'Full benchmark breakdown and cost-efficiency comparison.'} className="cursor-help text-zinc-400 hover:text-zinc-600 transition-colors">
              <HelpCircle className="h-3.5 w-3.5" />
            </span>
          </div>
        </div>

        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-left text-xs whitespace-nowrap">
            <thead className="border-b border-zinc-200 bg-zinc-50/75 text-[11px] font-semibold text-zinc-500">
              <tr>
                <th className="py-2.5 px-3">{t('evaluation.col_model') || 'Model / Provider'}</th>
                <th className="py-2.5 px-3">{t('evaluation.col_tier') || 'Tier'}</th>
                <th className="py-2.5 px-3">{t('evaluation.col_overall') || 'Overall'}</th>
                <th className="py-2.5 px-3">{t('evaluation.col_code') || 'Code'}</th>
                <th className="py-2.5 px-3">{t('evaluation.col_math') || 'Reasoning'}</th>
                <th className="py-2.5 px-3">{t('evaluation.col_tools') || 'Tools'}</th>
                <th className="py-2.5 px-3">{t('evaluation.col_lang') || 'Language'}</th>
                <th className="py-2.5 px-3">{t('evaluation.col_context') || 'Context'}</th>
                <th className="py-2.5 px-3">{t('evaluation.col_price') || 'Price (In/Out)'}</th>
                <th className="py-2.5 px-3 text-right">{t('common.actions') || 'Actions'}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {endpoints.length === 0 ? (
                <tr>
                  <td colSpan={10} className="py-8 text-center text-xs text-zinc-400">
                    {t('evaluation.no_models') || 'No models evaluated yet.'}
                  </td>
                </tr>
              ) : (
                endpoints.map((ep) => {
                  const dna = ep.model_dna || {
                    code_logic: Math.round((ep.capability_score || 0.5) * 100),
                    reasoning_math: Math.round((ep.capability_score || 0.5) * 98),
                    agent_tools: ep.supports_tools ? 92 : 60,
                    multilingual_nlp: 90,
                    context_retention: 88,
                    strengths: [],
                  }
                  return (
                    <tr key={ep.id} className="hover:bg-zinc-50/50 transition-colors">
                      <td className="py-2.5 px-3">
                        <div className="font-semibold text-zinc-950 whitespace-nowrap">{ep.model}</div>
                        <div className="text-[11px] text-zinc-400 whitespace-nowrap">{ep.provider_name}</div>
                      </td>
                      <td className="py-2.5 px-3">
                        {ep.preferred_for_hard_requests ? (
                          <span className="inline-flex items-center rounded-md bg-purple-50 border border-purple-200 px-2 py-0.5 text-xs font-semibold text-purple-700 whitespace-nowrap">
                            {t('radar.pro_tier')}
                          </span>
                        ) : (
                          <span className="inline-flex items-center rounded-md bg-emerald-50 border border-emerald-200 px-2 py-0.5 text-xs font-semibold text-emerald-700 whitespace-nowrap">
                            {t('radar.flash_tier')}
                          </span>
                        )}
                      </td>
                      <td className="py-2.5 px-3">
                        <span className="font-mono font-bold text-zinc-900">{(ep.capability_score ?? 0.5).toFixed(2)}</span>
                      </td>
                      <td className="py-2.5 px-3">
                        <span className="font-mono font-semibold text-purple-700">{dna.code_logic}</span>
                      </td>
                      <td className="py-2.5 px-3">
                        <span className="font-mono font-semibold text-amber-600">{dna.reasoning_math}</span>
                      </td>
                      <td className="py-2.5 px-3">
                        <span className="font-mono text-zinc-700">{dna.agent_tools}</span>
                      </td>
                      <td className="py-2.5 px-3">
                        <span className="font-mono text-zinc-700">{dna.multilingual_nlp}</span>
                      </td>
                      <td className="py-2.5 px-3">
                        <span className="font-mono text-zinc-500">{ep.context_length ? `${(ep.context_length / 1000).toFixed(0)}k` : '128k'}</span>
                      </td>
                      <td className="py-2.5 px-3">
                        <span className="text-xs font-mono text-zinc-600">
                          ${ep.input_price_per_1m || 0.14} / ${ep.output_price_per_1m || 0.28}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 text-right">
                        <button
                          type="button"
                          onClick={() => setProbingEndpoint({ endpoint: ep, serviceId: ep.serviceId })}
                          className="inline-flex items-center gap-1 rounded-lg border border-purple-200 bg-purple-50 px-2.5 py-1 text-xs font-medium text-purple-700 hover:bg-purple-100 transition-colors whitespace-nowrap"
                        >
                          <Sparkles className="h-3.5 w-3.5" /> {t('evaluation.run_probe') || 'Run Probe'}
                        </button>
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </section>

      {probingEndpoint && (
        <ModelProbeModal
          endpoint={probingEndpoint.endpoint}
          serviceId={probingEndpoint.serviceId}
          onClose={() => setProbingEndpoint(null)}
          onSaved={() => {
            setProbingEndpoint(null)
            loadData()
          }}
        />
      )}
    </Page>
  )
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
    <section className="rounded-xl border border-zinc-200 bg-white p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="font-semibold">{t('services.how_to_call') || 'How to call'}</h2>
          <p className="mt-1 text-sm text-zinc-500">
            {t('services.how_to_call_desc') || 'Use the model service name as the model value in standard API calls.'}
          </p>
        </div>
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
      </div>
      <div className="mt-4 overflow-hidden rounded-xl bg-[var(--color-primary-soft)] text-zinc-950">
        <div className="flex items-center justify-between border-b border-primary/20 px-4 py-3">
          <span className="text-sm font-medium text-zinc-950">{example.label}</span>
          <div className="flex items-center gap-3">
            <span className="text-xs text-zinc-950">cURL</span>
            <button
              type="button"
              onClick={copyExample}
              className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-zinc-950 transition-colors hover:bg-white/60"
              title={t('common.copy') || 'Copy example'}
              aria-label="Copy example"
            >
              {copied ? <CheckCircle2 className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
              {copied ? (t('common.copied') || 'Copied') : (t('common.copy') || 'Copy')}
            </button>
          </div>
        </div>
        <pre role="tabpanel" className="overflow-x-auto p-4 text-xs leading-6 text-zinc-950">{command}</pre>
      </div>
    </section>
  )
}

function EditRoutingModal({ service, onClose, onSaved }: { service: ServiceDetails; onClose: () => void; onSaved: () => void }) {
  const { t } = useI18n()
  const [nextStrategy, setNextStrategy] = useState(service.strategy)
  const [preset, setPreset] = useState('coding')
  const [judgeEnabled, setJudgeEnabled] = useState(Boolean(service.judge_enabled))
  const [judgeEndpointId, setJudgeEndpointId] = useState(service.judge_endpoint_id || service.endpoints[0]?.id || '')
  const [shadowEnabled, setShadowEnabled] = useState(false)
  const [shadowSampleRate, setShadowSampleRate] = useState(5)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

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

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/40 p-4 backdrop-blur-xs overflow-y-auto" role="dialog" aria-modal="true">
      <form onSubmit={submit} className="w-full max-w-2xl rounded-2xl bg-white p-6 shadow-2xl space-y-5 my-8 max-h-[90vh] overflow-y-auto">
        <div className="flex items-start justify-between gap-4 border-b border-zinc-100 pb-4">
          <div>
            <h2 className="text-lg font-semibold text-zinc-950">{t('services.edit_routing_title') || 'Edit routing strategy'}</h2>
            <p className="mt-1 text-xs text-zinc-500">{t('services.edit_routing_desc') || 'Select optimal strategy and tuning presets for incoming queries.'}</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-950" aria-label="Close">
            <X className="h-5 w-5" />
          </button>
        </div>

        <StrategyMatrixCardSelector selectedStrategy={nextStrategy} onSelect={setNextStrategy} />

        {nextStrategy === 'capability_aware' && (
          <div className="space-y-4">
            <WorkloadPresetSelector selectedPreset={preset} onSelectPreset={setPreset} />

            <div className="rounded-xl border border-zinc-200 bg-zinc-50/70 p-4 space-y-3">
              <label className="flex items-center gap-2.5 text-xs font-semibold uppercase tracking-wider text-zinc-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={judgeEnabled}
                  onChange={(e) => setJudgeEnabled(e.target.checked)}
                  className="h-4 w-4 rounded border-zinc-300 text-zinc-950 focus:ring-zinc-950"
                />
                <span>{t('services.judge_label') || 'Use auxiliary judge model for complexity'}</span>
              </label>
              {judgeEnabled && (
                <div className="space-y-2 pt-1">
                  {judgeOptions.length > 0 ? (
                    <Select label={t('services.judge_select') || 'Auxiliary judge model'} options={judgeOptions} selected={selectedJudge} onChange={(option) => setJudgeEndpointId(String(option.id))} />
                  ) : (
                    <p className="text-xs text-amber-600">{t('services.judge_no_endpoints') || 'Please connect at least one provider endpoint first.'}</p>
                  )}
                  <p className="text-xs text-zinc-500">{t('services.judge_desc') || 'When enabled, requests with ambiguous complexity are pre-checked by this lightweight model before routing to Pro or Flash.'}</p>
                </div>
              )}
            </div>
          </div>
        )}

        <div className="rounded-xl border border-zinc-200 bg-zinc-50/60 p-4 space-y-3">
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
                {t('services.shadow_flighting_title') || 'Shadow Quality Flighting'}
              </span>
            </label>
            {shadowEnabled && (
              <span className="text-xs font-medium text-purple-700 bg-purple-50 border border-purple-200 px-2 py-0.5 rounded-md">
                {shadowSampleRate}% Sample
              </span>
            )}
          </div>
          <p className="text-xs text-zinc-500">
            {t('services.shadow_flighting_desc') || 'Asynchronously mirrors a configurable percentage of live queries to shadow models in the background. Zero user latency overhead.'}
          </p>
          {shadowEnabled && (
            <div className="pt-2 flex items-center gap-4">
              <span className="text-xs text-zinc-600 font-medium whitespace-nowrap">{t('services.shadow_sample_rate') || 'Sample Rate'}:</span>
              <input
                type="range"
                min="1"
                max="25"
                step="1"
                value={shadowSampleRate}
                onChange={(e) => setShadowSampleRate(Number(e.target.value))}
                className="w-full accent-zinc-950"
              />
              <span className="text-xs font-mono font-bold text-zinc-900 w-10 text-right">{shadowSampleRate}%</span>
            </div>
          )}
        </div>

        {error && <div className="mt-4"><ErrorMessage text={error} /></div>}
        <div className="mt-6 flex justify-end gap-3 border-t border-zinc-100 pt-4">
          <button type="button" onClick={onClose} className="rounded-lg border border-zinc-300 px-4 py-2.5 text-sm text-zinc-600 hover:bg-zinc-50 transition-colors">
            {t('common.cancel') || 'Cancel'}
          </button>
          <button disabled={busy} className="rounded-lg bg-zinc-950 px-5 py-2.5 text-sm text-white hover:bg-zinc-800 transition-colors disabled:opacity-50">
            {busy ? (t('common.saving') || 'Saving…') : (t('common.save') || 'Save changes')}
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
  const [inputPrice, setInputPrice] = useState(endpoint.input_price_per_1m ? String(endpoint.input_price_per_1m) : '')
  const [outputPrice, setOutputPrice] = useState(endpoint.output_price_per_1m ? String(endpoint.output_price_per_1m) : '')
  const [capabilityScore, setCapabilityScore] = useState(String(endpoint.capability_score ?? '0.70'))
  const [contextLength, setContextLength] = useState(endpoint.context_length ? String(endpoint.context_length) : '')
  const [advanced, setAdvanced] = useState(false)
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
          setTestMsg(res.data?.message || (t('services.test_passed') || 'Connection verified successfully'))
        } else {
          setTestStatus('failed')
          setTestMsg(res.message || (t('services.test_failed') || 'Connection test failed'))
        }
      } else {
        const res = await saasFetch<{ passed?: boolean; message?: string }>(`/api/saas/model-services/${serviceId}/endpoints/${endpoint.id}`, {
          method: 'POST',
        })
        if (res.success && (res.data?.passed !== false)) {
          setTestStatus('passed')
          setTestMsg(res.data?.message || (t('services.test_passed') || 'Connection verified successfully'))
        } else {
          setTestStatus('failed')
          setTestMsg(res.message || (t('services.test_failed') || 'Connection test failed'))
        }
      }
    } catch (e: any) {
      setTestStatus('failed')
      setTestMsg(e.message || (t('services.test_failed') || 'Connection test failed'))
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
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/30 p-4" role="dialog" aria-modal="true"><form onSubmit={submit} className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl"><div className="flex items-start justify-between gap-4"><div><h2 className="text-lg font-semibold">{t('services.edit_provider') || 'Edit provider'}</h2></div><button type="button" onClick={onClose} className="rounded-lg p-2 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-950" aria-label="Close"><X className="h-5 w-5" /></button></div><div className="mt-6 space-y-5"><div className="grid gap-5 sm:grid-cols-2"><Field label={t('services.provider_name') || 'Provider name'} value={providerName} onChange={setProviderName} placeholder="DeepSeek" /><label className="block text-sm font-medium text-zinc-700">{t('services.provider_id') || 'Provider ID'}<input readOnly value={endpoint.provider_id} className="mt-2 w-full rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2.5 text-zinc-500 outline-none" /></label></div><div className="grid gap-5 sm:grid-cols-2"><Field label={t('services.model_label') || 'Model'} value={model} onChange={(val) => { setModel(val); setTestStatus('idle') }} placeholder="deepseek-chat" /><Select label={t('services.protocol_label') || 'Protocol'} options={[{ id: 'openai', name: 'OpenAI' }, { id: 'anthropic', name: 'Anthropic' }]} selected={{ id: protocol, name: protocol === 'anthropic' ? 'Anthropic' : 'OpenAI' }} onChange={(option) => { setProtocol(String(option.id)); setTestStatus('idle') }} /></div><Field label={t('services.base_url') || 'Provider API base URL'} value={baseUrl} onChange={(val) => { setBaseUrl(val); setTestStatus('idle') }} placeholder="https://api.example.com/v1" /><div><div className="flex items-center justify-between"><label className="block text-sm font-medium">{t('services.api_key_new') || 'New Provider API key (optional)'}</label><button type="button" onClick={runTest} disabled={testStatus === 'testing' || !baseUrl.trim() || !model.trim()} className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:text-primary-hover disabled:text-zinc-400 disabled:cursor-not-allowed" title="Verify if API key and upstream endpoint are reachable"><Zap className={`h-3.5 w-3.5 ${testStatus === 'testing' ? 'animate-pulse text-amber-500' : ''}`} /><span>{testStatus === 'testing' ? (t('services.testing') || 'Testing…') : (t('services.test_connection') || 'Test connection')}</span></button></div><div className="relative mt-2"><Field required={false} label="" value={apiKey} onChange={(val) => { setApiKey(val); setTestStatus('idle') }} placeholder={t('services.api_key_placeholder') || 'Leave blank to keep the current key'} type="password" /></div>{testStatus === 'passed' && <div className="mt-1.5 flex items-center gap-1.5 text-xs text-emerald-600"><CheckCircle2 className="h-3.5 w-3.5 shrink-0" /><span>{testMsg || (t('services.test_passed') || 'Connection verified successfully')}</span></div>}{testStatus === 'failed' && <div className="mt-1.5 flex items-start gap-1.5 text-xs text-rose-600"><AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" /><span className="break-all">{testMsg || (t('services.test_failed') || 'Connection failed')}</span></div>}</div><button type="button" onClick={() => setAdvanced((value) => !value)} className="text-sm text-zinc-700 hover:text-zinc-950">{advanced ? (t('services.hide_advanced') || 'Hide advanced settings') : (t('services.advanced_settings') || 'Price and capability settings')}</button>{advanced && <div className="grid gap-5 rounded-lg bg-zinc-50 p-4 sm:grid-cols-3 text-zinc-900"><Field required={false} label={t('services.input_price') || 'Input $/1M'} value={inputPrice} onChange={setInputPrice} placeholder="0.14" /><Field required={false} label={t('services.output_price') || 'Output $/1M'} value={outputPrice} onChange={setOutputPrice} placeholder="0.28" /><Field required={false} label={t('services.capability_range') || 'Capability 0–1'} value={capabilityScore} onChange={setCapabilityScore} placeholder="0.70" /><Field required={false} label={t('services.context_length') || 'Context length'} value={contextLength} onChange={setContextLength} placeholder="128000" /></div>}</div>{error && <ErrorMessage text={error} />}<div className="mt-6 flex justify-end gap-3"><button type="button" onClick={onClose} className="rounded-lg border border-zinc-300 px-4 py-2.5 text-sm text-zinc-600">{t('common.cancel') || 'Cancel'}</button><button disabled={busy} className="rounded-lg bg-zinc-950 px-5 py-2.5 text-sm text-white disabled:opacity-50">{busy ? (t('common.saving') || 'Saving…') : (t('common.save') || 'Save changes')}</button></div></form></div>
}

function ModelProbeModal({
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
        setError(res.message || 'Capability probe failed')
      }
    } catch (e: any) {
      setError(e.message || 'Probe request failed')
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
              <h2 className="text-lg font-semibold text-zinc-950">{t('services.probe_modal_title') || '5D Model DNA & Capability Probe'}</h2>
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
          {t('services.probe_modal_subtitle') ||
            'Sends live targeted benchmark tests to evaluate code synthesis, multi-step math logic, tool calling JSON adherence, and constraint obedience to compute an empirical capability rating.'}
        </p>

        {error && <div className="mt-4"><ErrorMessage text={error} /></div>}

        {!probeResult ? (
          <div className="mt-6 text-center py-8 border border-dashed border-zinc-200 rounded-xl bg-zinc-50/50">
            <div className="inline-flex rounded-full bg-purple-100 p-3 text-purple-600 mb-3">
              <Sparkles className={`h-6 w-6 ${probing ? 'animate-spin' : ''}`} />
            </div>
            <h3 className="text-sm font-medium text-zinc-900">
              {probing ? (t('services.probe_running') || 'Probing 5D Capabilities…') : (t('services.probe_ready_title') || 'Ready to Probe Capabilities')}
            </h3>
            <p className="mt-1 text-xs text-zinc-500 max-w-sm mx-auto">
              {probing
                ? (t('services.probe_running_desc') || 'Dispatching 5 live benchmark probes to upstream endpoint. This typically takes 5–15 seconds…')
                : (t('services.probe_ready_desc') || 'Click below to benchmark and automatically calibrate this model for capability-aware intelligent routing.')}
            </p>
            <button
              type="button"
              onClick={runProbe}
              disabled={probing}
              className="mt-5 inline-flex items-center gap-2 rounded-lg bg-purple-600 px-5 py-2.5 text-sm font-medium text-white shadow-sm hover:bg-purple-700 disabled:opacity-50 transition-colors"
            >
              <Sparkles className="h-4 w-4" />
              {probing ? (t('services.probe_running') || 'Probing…') : (t('services.probe_run') || 'Run 5D Benchmark Probe')}
            </button>
          </div>
        ) : (
          <div className="mt-5 space-y-4">
            <div className="flex items-center justify-between rounded-xl bg-emerald-50 border border-emerald-200 p-4">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-5 w-5 text-emerald-600 shrink-0" />
                <div>
                  <div className="text-sm font-semibold text-emerald-950">
                    {t('services.probe_completed') || 'Capability Probing Completed & Calibrated'}
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
                {t('services.probe_apply') || 'Done & Calibrated'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function AddModelModal({ catalog, providers, serviceId, onClose, onSaved }: { catalog: CatalogOffering[]; providers: { id: string; name: string; modelCount: number }[]; serviceId: string; onClose: () => void; onSaved: () => void }) {
  const { t } = useI18n()
  const [draft, setDraft] = useState<DraftEndpoint>(emptyEndpoint())
  const [visible, setVisible] = useState(false)
  const [advanced, setAdvanced] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [testStatus, setTestStatus] = useState<'idle' | 'testing' | 'passed' | 'failed'>('idle')
  const [testMsg, setTestMsg] = useState('')
  const custom = draft.provider_type === 'custom'
  const models = catalog.filter((item) => item.provider_id === draft.provider_type)
  const providerOptions = [{ id: 'custom', name: t('services.custom_provider') || 'Custom provider' }, ...providers.map((provider) => ({ id: provider.id, name: provider.name }))]
  const selectedProvider = providers.find((provider) => provider.id === draft.provider_type) || { id: 'custom', name: t('services.custom_provider') || 'Custom provider' }
  const protocolOptions = [{ id: 'openai', name: 'OpenAI' }, { id: 'anthropic', name: 'Anthropic' }]
  const selectedProtocol = protocolOptions.find((option) => option.id === draft.protocol) || protocolOptions[0]
  const selectedModel = models.find((item) => item.model === draft.upstream_model_id)
  const patch = (value: Partial<DraftEndpoint>) => {
    setDraft((current) => ({ ...current, ...value }))
    setTestStatus('idle')
  }

  async function runTestKey() {
    if (!draft.api_key.trim() || !draft.base_url.trim() || !draft.upstream_model_id.trim()) return
    setTestStatus('testing')
    setTestMsg('')
    try {
      const res = await saasFetch<{ passed?: boolean; message?: string }>('/api/saas/test-connection', {
        method: 'POST',
        body: JSON.stringify({
          protocol: draft.protocol,
          base_url: draft.base_url.trim(),
          api_key: draft.api_key.trim(),
          upstream_model_id: draft.upstream_model_id.trim(),
        }),
      })
      if (res.success && (res.data?.passed !== false)) {
        setTestStatus('passed')
        setTestMsg(res.data?.message || (t('services.test_passed') || 'Connection verified successfully'))
      } else {
        setTestStatus('failed')
        setTestMsg(res.message || (t('services.test_failed') || 'Connection test failed'))
      }
    } catch (e: any) {
      setTestStatus('failed')
      setTestMsg(e.message || (t('services.test_failed') || 'Connection test failed'))
    }
  }

  function chooseProvider(option: { id: string | number; name: string }) {
    const provider = String(option.id); const first = catalog.find((item) => item.provider_id === provider)
    const protocol = /anthropic|claude/i.test(provider) ? 'anthropic' : 'openai'
    setDraft({ ...emptyEndpoint(), provider_type: provider, protocol, upstream_model_id: first?.model || '', base_url: first?.base_url || '', input_price_per_1m: first ? String(first.input_price_per_1m) : '', output_price_per_1m: first ? String(first.output_price_per_1m) : '', capability_score: first ? inferDefaultCapability(first) : '0.70', context_length: first?.context_length ? String(first.context_length) : '' })
    setAdvanced(hasCatalogDetails(first))
    setTestStatus('idle')
  }
  function chooseModel(option: { id: string | number; name: string }) {
    const model = models.find((item) => item.model === String(option.id)); if (!model) return
    patch({ upstream_model_id: model.model, base_url: model.base_url, input_price_per_1m: String(model.input_price_per_1m), output_price_per_1m: String(model.output_price_per_1m), capability_score: inferDefaultCapability(model), context_length: model.context_length ? String(model.context_length) : '' })
    if (model.input_price_per_1m || model.output_price_per_1m || model.context_length || model.supports_reasoning) setAdvanced(true)
    setTestStatus('idle')
  }
  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!endpointComplete(draft)) { setError('Provider, model, URL, and API key are required.'); return }
    setBusy(true); setError('')
    try { await saasFetch(`/api/saas/model-services/${serviceId}/endpoints`, { method: 'POST', body: JSON.stringify({ provider_type: custom ? draft.custom_provider_id : draft.provider_type, provider_name: custom ? draft.custom_provider_id : selectedProvider.name, protocol: draft.protocol, base_url: draft.base_url, api_key: draft.api_key, upstream_model_id: draft.upstream_model_id, input_price_per_1m: draft.input_price_per_1m ? Number(draft.input_price_per_1m) : undefined, output_price_per_1m: draft.output_price_per_1m ? Number(draft.output_price_per_1m) : undefined, capability_score: Number(draft.capability_score), context_length: draft.context_length ? Number(draft.context_length) : undefined }) }); onSaved() } catch (e) { setError(errorText(e)) } finally { setBusy(false) }
  }
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/30 p-4" role="dialog" aria-modal="true"><form onSubmit={submit} className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl"><div className="flex items-start justify-between gap-4"><div><h2 className="text-lg font-semibold">{t('services.add_provider') || 'Add provider'}</h2></div><button type="button" onClick={onClose} className="rounded-lg p-2 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-950" aria-label="Close"><X className="h-5 w-5" /></button></div><div className="mt-6 space-y-5"><div className="grid gap-5 sm:grid-cols-2"><Select label={t('services.provider_label') || 'Provider'} options={providerOptions} selected={selectedProvider} onChange={chooseProvider} />{custom ? <Field alignWithSelect label={t('services.provider_id') || 'Provider ID'} value={draft.custom_provider_id} onChange={(value) => patch({ custom_provider_id: value })} placeholder="my-provider" /> : <Select label={t('services.model_label') || 'Model'} options={modelOptions(models)} selected={selectedModel ? { id: selectedModel.model, name: selectedModel.model_name } : { id: '', name: t('services.select_model') || 'Select a model' }} onChange={chooseModel} />}</div><div className="grid gap-5 sm:grid-cols-2">{custom ? <Field alignWithSelect label={t('services.model_label') || 'Model'} value={draft.upstream_model_id} onChange={(value) => patch({ upstream_model_id: value })} placeholder="provider-model-name" /> : <div /> }<Select label={t('services.protocol_label') || 'Protocol'} options={protocolOptions} selected={selectedProtocol} onChange={(option) => patch({ protocol: String(option.id) })} /></div><Field label={t('services.base_url') || 'Provider API base URL'} value={draft.base_url} onChange={(value) => patch({ base_url: value })} placeholder="https://api.example.com/v1" /><div><div className="flex items-center justify-between"><label className="block text-sm font-medium">{t('services.api_key') || 'Provider API key'}</label><button type="button" onClick={runTestKey} disabled={testStatus === 'testing' || !draft.api_key.trim() || !draft.base_url.trim() || !draft.upstream_model_id.trim()} className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:text-primary-hover disabled:text-zinc-400 disabled:cursor-not-allowed" title="Verify if API key and upstream endpoint are reachable"><Zap className={`h-3.5 w-3.5 ${testStatus === 'testing' ? 'animate-pulse text-amber-500' : ''}`} /><span>{testStatus === 'testing' ? (t('services.testing') || 'Testing…') : (t('services.test_connection') || 'Test connection')}</span></button></div><div className="relative mt-2"><input required type={visible ? 'text' : 'password'} value={draft.api_key} onChange={(event) => patch({ api_key: event.target.value })} placeholder={t('services.api_key_paste_placeholder') || 'Paste your provider key'} className="w-full rounded-lg border border-zinc-300 px-3 py-2.5 pr-10 outline-none focus:border-primary" /><button type="button" onClick={() => setVisible((value) => !value)} className="absolute inset-y-0 right-0 px-3 text-zinc-400" aria-label={visible ? 'Hide API key' : 'Show API key'}>{visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</button></div>{testStatus === 'passed' && <div className="mt-1.5 flex items-center gap-1.5 text-xs text-emerald-600"><CheckCircle2 className="h-3.5 w-3.5 shrink-0" /><span>{testMsg || (t('services.key_verified_healthy') || 'Key verified & connection healthy')}</span></div>}{testStatus === 'failed' && <div className="mt-1.5 flex items-start gap-1.5 text-xs text-rose-600"><AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" /><span className="break-all">{testMsg || (t('services.test_failed') || 'Connection failed')}</span></div>}</div><button type="button" onClick={() => setAdvanced((value) => !value)} className="text-sm text-zinc-700 hover:text-zinc-950">{advanced ? (t('services.hide_advanced') || 'Hide advanced settings') : (t('services.advanced_settings') || 'Price and capability settings')}</button>{advanced && <div className="grid gap-5 rounded-lg bg-zinc-50 p-4 sm:grid-cols-3 text-zinc-900"><Field required={false} label={t('services.input_price') || 'Input $/1M'} value={draft.input_price_per_1m} onChange={(value) => patch({ input_price_per_1m: value })} placeholder="0.14" /><Field required={false} label={t('services.output_price') || 'Output $/1M'} value={draft.output_price_per_1m} onChange={(value) => patch({ output_price_per_1m: value })} placeholder="0.28" /><Field required={false} label={t('services.capability_range') || 'Capability 0–1'} value={draft.capability_score} onChange={(value) => patch({ capability_score: value })} placeholder="0.5" /><Field required={false} label={t('services.context_length') || 'Context length'} value={draft.context_length} onChange={(value) => patch({ context_length: value })} placeholder="128000" /></div>}{selectedModel && <div className="space-y-1 text-xs text-zinc-500"><div>{selectedModel.description}</div><div>Context: {selectedModel.context_length ? `${selectedModel.context_length.toLocaleString()} context` : 'Length not listed'}</div></div>}</div>{error && <ErrorMessage text={error} />}<div className="mt-6 flex justify-end gap-3"><button type="button" onClick={onClose} className="rounded-lg border border-zinc-300 px-4 py-2.5 text-sm text-zinc-600">{t('common.cancel') || 'Cancel'}</button><button disabled={busy} className="rounded-lg bg-zinc-950 px-5 py-2.5 text-sm text-white disabled:opacity-50">{busy ? (t('common.creating') || 'Adding…') : (t('services.add_provider') || 'Add provider')}</button></div></form></div>
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
      <div className="rounded-lg bg-surface-200 px-4 py-3 text-xs text-zinc-500">The public model works with <code>/v1/chat/completions</code> and <code>/v1/responses</code>. Provider keys stay inside SmartGate.</div>
      {error && <ErrorMessage text={error} />}
      <div className="sticky bottom-4 flex items-center justify-between gap-4 rounded-xl border border-zinc-200 bg-white/95 p-3 shadow-lg backdrop-blur"><span className="hidden text-sm text-zinc-500 sm:inline">{completedCount} of {endpoints.length} upstreams ready</span><button disabled={busy} className="ml-auto rounded-lg bg-zinc-950 px-5 py-3 text-sm text-white disabled:opacity-50">{busy ? 'Creating…' : 'Create model service'}</button></div>
    </form>
  </Page>
}

export function KeysPage() {
  const { t } = useI18n()
  const [keys, setKeys] = useState<Key[]>([])
  const [services, setServices] = useState<Service[]>([])
  const { dialog, showConfirm } = useDialog()
  const [raw, setRaw] = useState('')
  const [createdServiceNames, setCreatedServiceNames] = useState<string[]>([])
  const [copiedKeyId, setCopiedKeyId] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [modalOpen, setModalOpen] = useState(false)
  const [editingKey, setEditingKey] = useState<Key | null>(null)
  const [profileKey, setProfileKey] = useState<Key | null>(null)
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
    setCreatedServiceNames(services.filter((service) => modelServiceIds.includes(service.id)).map((service) => service.name))
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
    if (!await showConfirm(t('keys.revoke_confirm_msg') || 'Existing requests will not be interrupted.', t('keys.revoke_confirm_title') || 'Revoke this API key?')) return
    try { await saasFetch(`/api/saas/api-keys/${id}/revoke`, { method: 'POST' }); load() } catch (e) { setError(errorText(e)) }
  }
  async function remove(id: string) {
    if (!await showConfirm(t('keys.delete_confirm_msg') || 'This cannot be undone.', t('keys.delete_confirm_title') || 'Delete this API key permanently?')) return
    try { await saasFetch(`/api/saas/api-keys/${id}`, { method: 'DELETE' }); load() } catch (e) { setError(errorText(e)) }
  }
  function copyKeyText(text: string, id: string) {
    navigator.clipboard.writeText(text)
    setCopiedKeyId(id)
    setTimeout(() => setCopiedKeyId(null), 2000)
  }

  return (
    <Page
      action={
        <button
          type="button"
          onClick={() => { setError(''); setModalOpen(true) }}
          className="inline-flex items-center gap-2 rounded-lg bg-zinc-950 px-4 py-2.5 text-sm text-white shadow-sm hover:bg-zinc-800 transition-colors"
        >
          <Plus className="h-4 w-4" /> {t('keys.create_button') || 'Create key'}
        </button>
      }
    >
      {dialog}
      {raw && (
        <KeyCreatedModal
          rawKey={raw}
          serviceNames={createdServiceNames}
          onClose={() => { setRaw(''); setCreatedServiceNames([]) }}
        />
      )}
      {error && <ErrorMessage text={error} />}
      {!keys.length ? (
        <Empty text={t('keys.no_keys') || 'No API keys yet.'} href="/app/services" />
      ) : (
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3">
          {keys.map((key) => {
            const masked = formatMaskedKey(key.prefix)
            const isCopied = copiedKeyId === key.id
            return (
              <div
                key={key.id}
                className="flex flex-col justify-between rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm hover:border-zinc-300 transition-all"
              >
                <div>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h3 className="font-semibold text-zinc-950 text-base truncate" title={key.name}>
                        {key.name}
                      </h3>
                    </div>
                    <span
                      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium shrink-0 ${
                        key.enabled
                          ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                          : 'bg-zinc-100 text-zinc-500 border border-zinc-200'
                      }`}
                    >
                      {key.enabled ? (t('keys.active') || 'Active') : (t('keys.revoked') || 'Revoked')}
                    </span>
                  </div>

                  <div className="mt-3 flex items-center justify-between gap-2 rounded-lg bg-zinc-50 px-3 py-2 border border-zinc-100">
                    <code className="font-mono text-xs text-zinc-700 truncate">{masked}</code>
                    <button
                      type="button"
                      onClick={() => copyKeyText(key.prefix, key.id)}
                      className="rounded p-1 text-zinc-400 hover:bg-zinc-200 hover:text-zinc-900 transition-colors"
                      title={t('common.copy') || 'Copy'}
                    >
                      {isCopied ? <CheckCheck className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
                    </button>
                  </div>

                  <div className="mt-3">
                    <div className="text-[11px] font-medium text-zinc-400 uppercase tracking-wider mb-1.5">
                      {t('keys.authorized_services') || 'Authorized Services'}
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {key.model_services?.length ? (
                        key.model_services.map((service) => (
                          <span
                            key={service.id}
                            className="inline-flex items-center rounded-md bg-zinc-100 px-2 py-0.5 text-[11px] font-medium text-zinc-700"
                          >
                            {service.name}
                          </span>
                        ))
                      ) : (
                        <span className="text-xs text-zinc-400 italic">
                          {t('keys.all_services_legacy') || 'All project services (legacy key)'}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="mt-3 space-y-0.5 text-[11px] text-zinc-400">
                    <div>{t('keys.created', { date: key.created_at }) || `Created ${key.created_at}`}</div>
                    {key.last_used_at && (
                      <div>{t('keys.last_used', { date: key.last_used_at }) || `Last used ${key.last_used_at}`}</div>
                    )}
                  </div>
                </div>

                <div className="mt-6 flex flex-wrap items-center justify-end gap-3 border-t border-zinc-100 pt-4 text-xs">
                  <button
                    type="button"
                    onClick={() => setProfileKey(key)}
                    className="inline-flex items-center gap-1 font-medium text-zinc-600 hover:text-zinc-950 transition-colors"
                  >
                    <Activity className="h-3.5 w-3.5" />
                    {t('keys.workload_profile') || 'Workload profile'}
                  </button>
                  {key.enabled && (
                    <button
                      type="button"
                      onClick={() => setEditingKey(key)}
                      className="inline-flex items-center gap-1 font-medium text-zinc-600 hover:text-zinc-950 transition-colors"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                      {t('keys.edit') || 'Edit'}
                    </button>
                  )}
                  {key.enabled && (
                    <button
                      type="button"
                      onClick={() => revoke(key.id)}
                      className="font-medium text-amber-600 hover:text-amber-700 transition-colors"
                    >
                      {t('keys.revoke') || 'Revoke'}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => remove(key.id)}
                    className="inline-flex items-center gap-1 font-medium text-rose-500 hover:text-rose-700 transition-colors"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    {t('keys.delete') || 'Delete'}
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}
      {modalOpen && (
        <CreateKeyModal
          services={services}
          existingNames={keys.map((key) => key.name)}
          onClose={() => setModalOpen(false)}
          onCreate={create}
        />
      )}
      {editingKey && (
        <EditKeyModal
          keyData={editingKey}
          services={services}
          existingNames={keys.map((key) => key.name)}
          onClose={() => setEditingKey(null)}
          onUpdate={update}
        />
      )}
      {profileKey && <ApiKeyProfileModal keyData={profileKey} onClose={() => setProfileKey(null)} />}
    </Page>
  )
}

function profilePercent(value: number | null | undefined) {
  return value == null ? 'N/A' : `${(value * 100).toFixed(1)}%`
}

function profileNumber(value: number | null | undefined, suffix = '') {
  return value == null ? 'N/A' : `${value.toLocaleString()}${suffix}`
}

function ProfileMetric({ label, value }: { label: string; value: string }) {
  return <div className="rounded-lg border border-zinc-100 bg-zinc-50 px-3 py-2"><div className="text-[10px] uppercase tracking-wide text-zinc-400">{label}</div><div className="mt-1 text-sm font-semibold text-zinc-900">{value}</div></div>
}

function ProfileBreakdown({ title, values }: { title: string; values: Record<string, number> }) {
  const entries = Object.entries(values)
  return <div><h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-400">{title}</h3>{entries.length ? <div className="mt-2 space-y-1.5">{entries.map(([name, count]) => <div key={name} className="flex items-center justify-between gap-3 text-xs"><span className="truncate text-zinc-600">{name}</span><span className="font-mono text-zinc-900">{count.toLocaleString()}</span></div>)}</div> : <div className="mt-2 text-xs text-zinc-400">N/A</div>}</div>
}

function ApiKeyProfileModal({ keyData, onClose }: { keyData: Key; onClose: () => void }) {
  const { t } = useI18n()
  const [range, setRange] = useState<'24h' | '7d' | '30d' | 'all'>('7d')
  const [profile, setProfile] = useState<ApiKeyProfile | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    setLoading(true)
    setError('')
    saasFetch<ApiKeyProfile>(`/api/saas/api-keys/${keyData.id}/profile?range=${range}`)
      .then((result) => setProfile(result.data || null))
      .catch((cause: unknown) => setError(errorText(cause)))
      .finally(() => setLoading(false))
  }, [keyData.id, range])

  const rate = (value: number | null | undefined) => profilePercent(value)
  const latency = (value: number | null | undefined) => profileNumber(value, ' ms')

  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/30 p-4" role="dialog" aria-modal="true">
    <div className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl">
      <div className="flex items-start justify-between gap-4">
        <div><h2 className="text-lg font-semibold text-zinc-950">{t('keys.profile_title') || 'API key workload profile'}</h2><p className="mt-1 text-sm font-medium text-zinc-600">{keyData.name}</p><p className="mt-1 text-sm text-zinc-500">{t('keys.profile_subtitle') || 'Observed request statistics. This does not change routing.'}</p></div>
        <button type="button" onClick={onClose} className="rounded-lg p-2 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-950" aria-label={t('common.close') || 'Close'}><X className="h-5 w-5" /></button>
      </div>
      <div className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-zinc-100 bg-zinc-50 p-3">
        <div className="text-xs text-zinc-500">{t('keys.profile_window') || 'Time window'}</div>
        <Select size="sm" options={[{ id: '24h', name: t('analytics.last_24h') || 'Last 24h' }, { id: '7d', name: t('analytics.last_7d') || 'Last 7 days' }, { id: '30d', name: t('analytics.last_30d') || 'Last 30 days' }, { id: 'all', name: t('analytics.all_time') || 'All time' }]} selected={{ id: range, name: range === '24h' ? (t('analytics.last_24h') || 'Last 24h') : range === '7d' ? (t('analytics.last_7d') || 'Last 7 days') : range === '30d' ? (t('analytics.last_30d') || 'Last 30 days') : (t('analytics.all_time') || 'All time') }} onChange={(option) => setRange(String(option.id) as typeof range)} className="w-40" />
      </div>
      {loading && <div className="py-12 text-center text-sm text-zinc-500">{t('keys.profile_loading') || 'Loading workload profile…'}</div>}
      {error && <div className="mt-5"><ErrorMessage text={error} /></div>}
      {!loading && !error && profile && <div className="mt-5 space-y-5">
        <div className="grid gap-3 sm:grid-cols-4">
          <ProfileMetric label={t('keys.profile_samples') || 'Samples'} value={profile.sample_count.toLocaleString()} />
          <ProfileMetric label={t('keys.profile_confidence') || 'Confidence'} value={profile.confidence.replace('_', ' ')} />
          <ProfileMetric label={t('keys.profile_success_rate') || 'Success rate'} value={rate(profile.requests.success_rate)} />
          <ProfileMetric label={t('keys.profile_last_observed') || 'Last observed'} value={profile.last_observed_at || 'N/A'} />
        </div>
        <div className="grid gap-5 md:grid-cols-2">
          <section className="rounded-xl border border-zinc-200 p-4"><h3 className="text-sm font-semibold text-zinc-900">{t('keys.profile_requests') || 'Requests'}</h3><div className="mt-3 grid grid-cols-3 gap-2"><ProfileMetric label={t('keys.profile_total') || 'Total'} value={profile.requests.total.toLocaleString()} /><ProfileMetric label={t('keys.profile_successful') || 'Successful'} value={profile.requests.successful.toLocaleString()} /><ProfileMetric label={t('keys.profile_failed') || 'Failed'} value={profile.requests.failed.toLocaleString()} /></div></section>
          <section className="rounded-xl border border-zinc-200 p-4"><h3 className="text-sm font-semibold text-zinc-900">{t('keys.profile_latency') || 'Latency'}</h3><div className="mt-3 grid grid-cols-2 gap-2"><ProfileMetric label="P50" value={latency(profile.latency_ms.p50)} /><ProfileMetric label="P95" value={latency(profile.latency_ms.p95)} /><ProfileMetric label="TTFT P95" value={latency(profile.latency_ms.ttft_p95)} /><ProfileMetric label={t('keys.profile_average') || 'Average'} value={latency(profile.latency_ms.average)} /></div></section>
        </div>
        <div className="grid gap-5 md:grid-cols-2">
          <section className="rounded-xl border border-zinc-200 p-4"><h3 className="text-sm font-semibold text-zinc-900">{t('keys.profile_tokens_cost') || 'Tokens and cost'}</h3><div className="mt-3 grid grid-cols-2 gap-2"><ProfileMetric label={t('keys.profile_total_tokens') || 'Total tokens'} value={profile.tokens.total.toLocaleString()} /><ProfileMetric label={t('keys.profile_avg_tokens') || 'Average tokens'} value={profileNumber(profile.tokens.average_per_request)} /><ProfileMetric label={t('keys.profile_total_cost') || 'Total cost'} value={`$${profile.cost.total.toFixed(4)}`} /><ProfileMetric label={t('keys.profile_avg_cost') || 'Average cost'} value={profile.cost.average_per_request == null ? 'N/A' : `$${profile.cost.average_per_request.toFixed(4)}`} /></div></section>
          <section className="rounded-xl border border-zinc-200 p-4"><h3 className="text-sm font-semibold text-zinc-900">{t('keys.profile_behavior') || 'Workload behavior'}</h3><div className="mt-3 grid grid-cols-2 gap-2"><ProfileMetric label={t('keys.profile_tools') || 'Tool requests'} value={rate(profile.workload.tool_request_rate)} /><ProfileMetric label={t('keys.profile_fallbacks') || 'Fallbacks'} value={rate(profile.workload.fallback_rate)} /><ProfileMetric label={t('keys.profile_sessions') || 'Sessions'} value={rate(profile.workload.session_rate)} /><ProfileMetric label={t('keys.profile_affinity') || 'Affinity hits'} value={rate(profile.workload.affinity_hit_rate)} /></div></section>
        </div>
        <div className="grid gap-5 md:grid-cols-4"><ProfileBreakdown title={t('keys.profile_difficulty') || 'Difficulty tiers'} values={profile.workload.difficulty_tiers} /><ProfileBreakdown title={t('keys.profile_difficulty_sources') || 'Difficulty sources'} values={profile.workload.difficulty_sources} /><ProfileBreakdown title={t('keys.profile_providers') || 'Providers'} values={profile.providers} /><ProfileBreakdown title={t('keys.profile_usage_sources') || 'Usage sources'} values={profile.cost.usage_sources} /></div>
        <div className="rounded-lg border border-amber-100 bg-amber-50 px-3 py-2.5 text-xs text-amber-800">{t('keys.profile_quality_unavailable') || 'Independent quality evidence is not available yet. These workload statistics do not represent a quality score.'}</div>
      </div>}
    </div>
  </div>
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

/// Success dialog shown right after an API key is created: reveal-once key with
/// copy/download actions and a ready-to-run request example.
function KeyCreatedModal({ rawKey, serviceNames, onClose }: { rawKey: string; serviceNames: string[]; onClose: () => void }) {
  const { t } = useI18n()
  const [copied, setCopied] = useState(false)
  const exampleModel = serviceNames[0] || 'your-model-service'
  const baseUrl = (typeof window !== 'undefined' && (window.location.hostname === 'smartgate.run' || window.location.hostname.endsWith('.pages.dev')))
    ? 'https://api.smartgate.run'
    : window.location.origin
  const curlExample = [
    `curl ${baseUrl}/v1/chat/completions \\`,
    `  -H "Authorization: Bearer ${rawKey}" \\`,
    `  -H "Content-Type: application/json" \\`,
    `  -d '{"model": "${exampleModel}", "messages": [{"role": "user", "content": "Hello"}]}'`,
  ].join('\n')

  function copyKey() {
    navigator.clipboard.writeText(rawKey)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  function downloadKey() {
    const content = [
      'SmartGate API Key',
      '=================',
      '',
      `Key: ${rawKey}`,
      `Base URL: ${baseUrl}`,
      `Authorized model services: ${serviceNames.join(', ') || 'n/a'}`,
      '',
      'Example request:',
      '',
      curlExample,
      '',
    ].join('\n')
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = 'smartgate-api-key.txt'
    link.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/30 p-4" role="dialog" aria-modal="true">
      <div className="max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-zinc-950">{t('keys.created_title') || 'API key created'}</h2>
            <p className="mt-1 text-sm text-amber-700">{t('keys.created_notice') || 'Copy or download this key now. It will not be shown again.'}</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-2 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-950" aria-label={t('common.close') || 'Close'}><X className="h-5 w-5" /></button>
        </div>

        <div className="mt-5 flex gap-2">
          <code className="flex-1 break-all rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2.5 font-mono text-sm text-zinc-900">{rawKey}</code>
          <button
            type="button"
            onClick={copyKey}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-zinc-300 px-3 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
          >
            {copied ? <CheckCheck className="h-4 w-4 text-emerald-600" /> : <Copy className="h-4 w-4" />}
          </button>
        </div>

        <div className="mt-4 flex flex-wrap justify-end gap-3">
          <button
            type="button"
            onClick={downloadKey}
            className="inline-flex items-center gap-2 rounded-lg border border-zinc-300 px-4 py-2.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
          >
            <Download className="h-4 w-4" /> {t('keys.download_key') || 'Download key'}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg bg-zinc-950 px-5 py-2.5 text-sm text-white hover:bg-zinc-800"
          >
            {t('keys.done') || 'Done'}
          </button>
        </div>

        <div className="mt-6 border-t border-zinc-100 pt-5">
          <h3 className="text-sm font-semibold text-zinc-900">{t('keys.usage_title') || 'How to use it'}</h3>
          <p className="mt-1 text-xs text-zinc-500">
            {t('keys.usage_desc') || 'Use this key with any OpenAI-compatible client. Set the base URL to this gateway and pass the model service name as the model.'}
          </p>
          <pre className="mt-3 whitespace-pre-wrap break-all rounded-lg bg-zinc-950 p-4 text-[11px] leading-relaxed text-zinc-100"><code>{curlExample}</code></pre>
        </div>
      </div>
    </div>
  )
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

const cleanDisplayName = (name: string | undefined) => {
  if (!name) return ''
  return name.replace(/^[0-9a-fA-F-]{36,37}-/, '').replace(/^saas-[0-9a-fA-F-]{36}/, 'DeepSeek').replace(/^saas-/, '')
}

function MissingTokensModal({
  missingUsage,
  totalMissing,
  onClose,
}: {
  missingUsage: MissingUsageBreakdown[]
  totalMissing: number
  onClose: () => void
}) {
  const { t } = useI18n()
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/30 p-4" role="dialog" aria-modal="true">
      <div className="max-h-[85vh] w-full max-w-xl overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-zinc-950">{t('usage.missing_modal_title') || 'Requests without Provider-Reported Tokens'}</h2>
            <p className="mt-1 text-xs text-zinc-500">
              {t('usage.requests_without_tokens_sub', { count: compactNumber(totalMissing) }) || `${compactNumber(totalMissing)} requests use local estimates or lack upstream token reporting.`}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-2 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-950 transition-colors"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="mt-5 divide-y divide-zinc-100 rounded-xl border border-zinc-200 bg-zinc-50/50 p-4">
          {missingUsage.map((item) => (
            <div key={`${item.provider}-${item.model}`} className="flex items-start justify-between gap-4 py-3 first:pt-0 last:pb-0">
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold text-zinc-900">
                  {cleanDisplayName(item.provider)} <span className="font-normal text-zinc-400">/</span> {item.model}
                </div>
                <div className="mt-1 space-y-0.5 text-xs text-zinc-500">
                  <div>{t('usage.missing_tokens_count', { count: compactNumber(item.requests) }) || `${compactNumber(item.requests)} requests without provider tokens`}</div>
                  {item.local_estimate_requests > 0 && (
                    <div className="text-amber-700">{t('usage.local_estimates_count', { count: compactNumber(item.local_estimate_requests) }) || `${compactNumber(item.local_estimate_requests)} use local byte/char estimation`}</div>
                  )}
                  {item.unavailable_requests > 0 && (
                    <div className="text-rose-600">{t('usage.unavailable_count', { count: compactNumber(item.unavailable_requests) }) || `${compactNumber(item.unavailable_requests)} have no token data`}</div>
                  )}
                </div>
              </div>
              <span className="shrink-0 rounded-full bg-amber-100 px-2.5 py-0.5 text-[11px] font-medium text-amber-800 border border-amber-200">
                {t('usage.needs_review') || 'Needs Review'}
              </span>
            </div>
          ))}
        </div>

        <div className="mt-6 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg bg-zinc-950 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 transition-colors"
          >
            {t('common.close') || 'Close'}
          </button>
        </div>
      </div>
    </div>
  )
}

export function UsagePage() {
  const { t } = useI18n()
  const [data, setData] = useState<UsageData | null>(null)
  const [savings, setSavings] = useState<SavingsData | null>(null)
  const [baseline, setBaseline] = useState<SavingsBaseline | null>(null)
  const [baselineOptions, setBaselineOptions] = useState<ServiceDetails[]>([])
  const [baselineOpen, setBaselineOpen] = useState(false)
  const [missingTokensModalOpen, setMissingTokensModalOpen] = useState(false)
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
  const totalSpend = (data?.estimated_spend || 0) > 0 ? (data?.estimated_spend || 0) : Math.max(providers.reduce((acc, p) => acc + p.estimated_spend, 0), 0.0001)
  const maxProviderSpend = Math.max(...providers.map((item) => item.estimated_spend), 0.000001)
  const missingUsage = data?.coverage?.missing_usage_breakdown || []

  return (
    <Page>
      {error && <ErrorMessage text={error} />}
      <div className="mb-5 flex items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <h1 className="text-xl font-semibold tracking-tight">{t('usage.title') || 'Usage'}</h1>
          <span title={t('usage.subtitle') || 'Automatic statistics from your last 30 days of model calls.'} className="cursor-help text-zinc-400 hover:text-zinc-600 transition-colors">
            <HelpCircle className="h-4 w-4" />
          </span>
        </div>
        <span className="text-xs text-zinc-400">{t('usage.provider_reported_note') || 'Provider-reported usage when available'}</span>
      </div>
      <div className="grid grid-cols-1 items-stretch gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label={t('usage.requests') || 'Requests'} value={compactNumber(data?.requests)} />
        <Stat label={t('usage.total_tokens') || 'Total tokens'} value={compactTokens(data?.total_tokens)} fullValue={compactNumber(data?.total_tokens)} />
        <Stat label={t('usage.estimated_spend') || 'Estimated spend'} value={money(data?.estimated_spend)} />
        <Stat label={t('usage.success_rate') || 'Success rate'} value={`${((data?.success_rate || 0) * 100).toFixed(1)}%`} />
      </div>

      <section className="mt-6 rounded-xl border border-zinc-200 bg-white p-5 shadow-sm">
        <div className="flex items-center gap-2">
          <h2 className="font-semibold text-zinc-900">{t('usage.prompt_cache') || 'Prompt cache'}</h2>
          <span title={t('usage.prompt_cache_subtitle') || 'Provider-reported input tokens served from cache. This is separate from context trimming.'} className="cursor-help text-zinc-400 hover:text-zinc-600 transition-colors">
            <HelpCircle className="h-3.5 w-3.5" />
          </span>
        </div>
        <div className="mt-5 grid grid-cols-2 items-stretch gap-4 md:grid-cols-3 xl:grid-cols-5">
          <Stat label={t('usage.cache_hit_tokens') || 'Cache hit tokens'} value={compactTokens(data?.cache?.hit_tokens)} fullValue={compactNumber(data?.cache?.hit_tokens)} />
          <Stat label={t('usage.requests_with_hits') || 'Requests with hits'} value={compactNumber(data?.cache?.hit_requests)} />
          <Stat label={t('usage.hit_rate') || 'Input token hit rate'} value={coveragePercent(data?.cache?.hit_rate)} />
          <Stat label={t('usage.cache_write_tokens') || 'Cache write tokens'} value={compactTokens(data?.cache?.write_tokens)} fullValue={compactNumber(data?.cache?.write_tokens)} />
          <Stat label={t('usage.write_rate') || 'Input token write rate'} value={coveragePercent(data?.cache?.write_rate)} />
        </div>
        {data?.cache?.reported_requests === 0 && (
          <p className="mt-4 text-xs text-zinc-500">{t('usage.no_cache_data') || 'No provider-reported cache metrics are available for this period.'}</p>
        )}
      </section>

      <section className="mt-6 rounded-xl border border-zinc-200 bg-white p-5 shadow-sm">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <h2 className="font-semibold text-zinc-900">{t('usage.usage_by_provider') || 'Usage by provider and model'}</h2>
            <span title={t('usage.usage_by_provider_sub') || 'Each provider includes the models used through it.'} className="cursor-help text-zinc-400 hover:text-zinc-600 transition-colors">
              <HelpCircle className="h-3.5 w-3.5" />
            </span>
          </div>
          <span className="text-xs text-zinc-400">
            {providers.length} {t('usage.providers_count') || 'Providers'} • {models.length} {t('usage.models_count') || 'Models'}
          </span>
        </div>
        {providers.length ? (
          <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-2">
            {providers.map((item) => {
              const providerModels = modelsByProvider.get(item.provider || '') || []
              const spendShare = totalSpend > 0 ? (item.estimated_spend / totalSpend) * 100 : 0
              return (
                <div key={item.provider} className="flex flex-col justify-between rounded-xl border border-zinc-200/80 bg-zinc-50/40 p-4 shadow-sm">
                  <div>
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="font-semibold text-zinc-900 truncate">{cleanDisplayName(item.provider)}</span>
                        <span className="inline-flex items-center rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] font-mono text-zinc-600 border border-zinc-200 shrink-0">
                          {spendShare.toFixed(1)}% {t('usage.share') || 'share'}
                        </span>
                      </div>
                      <span className="font-mono font-bold text-zinc-900 shrink-0">{money(item.estimated_spend)}</span>
                    </div>

                    <div className="mt-2.5 h-1.5 w-full rounded-full bg-zinc-200/60 overflow-hidden">
                      <div className="h-full rounded-full bg-zinc-900" style={{ width: `${Math.max((item.estimated_spend / maxProviderSpend) * 100, 3)}%` }} />
                    </div>

                    <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-zinc-500 border-b border-zinc-200/60 pb-3">
                      <div><strong className="text-zinc-800 font-medium">{compactNumber(item.requests)}</strong> {t('usage.requests') || 'requests'}</div>
                      <div><strong className="text-zinc-800 font-medium">{compactTokens(item.total_tokens)}</strong> {t('usage.total_tokens') || 'tokens'}</div>
                      {item.cache_hit_tokens ? (
                        <div className="text-emerald-700 font-medium">⚡ {compactTokens(item.cache_hit_tokens)} cached</div>
                      ) : null}
                    </div>

                    {providerModels.length ? (
                      <div className="mt-3 space-y-2">
                        {providerModels.slice(0, 8).map((model) => {
                          const modelShare = item.estimated_spend > 0 ? (model.estimated_spend / item.estimated_spend) * 100 : 0
                          return (
                            <div key={`${model.provider}-${model.model}`} className="flex items-center justify-between gap-3 rounded-lg bg-white p-2.5 border border-zinc-200/60 text-xs">
                              <div className="min-w-0">
                                <div className="font-medium text-zinc-900 truncate">{model.model}</div>
                                <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[11px] text-zinc-400">
                                  <span>{compactNumber(model.requests)} reqs</span>
                                  <span>•</span>
                                  <span>{compactTokens(model.total_tokens)} tok</span>
                                  {model.cache_hit_tokens ? (
                                    <>
                                      <span>•</span>
                                      <span className="text-emerald-600 font-medium">{compactTokens(model.cache_hit_tokens)} cached</span>
                                    </>
                                  ) : null}
                                </div>
                              </div>
                              <div className="text-right shrink-0">
                                <div className="font-mono font-semibold text-zinc-800">{money(model.estimated_spend)}</div>
                                <div className="text-[10px] text-zinc-400">{modelShare.toFixed(0)}%</div>
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    ) : null}
                  </div>
                </div>
              )
            })}
          </div>
        ) : (
          <p className="mt-5 text-sm text-zinc-500">{t('usage.no_usage_yet') || 'No usage recorded yet.'}</p>
        )}
      </section>

      <section className="mt-6 rounded-xl border border-zinc-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <h2 className="font-semibold text-zinc-900">{t('usage.context_savings') || 'Context savings'}</h2>
            <span title={t('usage.context_savings_sub') || 'Signals produced by context reduction. This is separate from provider billing.'} className="cursor-help text-zinc-400 hover:text-zinc-600 transition-colors">
              <HelpCircle className="h-3.5 w-3.5" />
            </span>
          </div>
          <button
            type="button"
            onClick={() => setBaselineOpen(true)}
            className="inline-flex items-center gap-2 rounded-lg border border-zinc-300 px-3 py-2 text-sm font-medium text-zinc-700 hover:border-zinc-950 hover:text-zinc-950 transition-colors"
          >
            <Settings2 className="h-4 w-4" />
            {baseline ? (t('usage.change_baseline') || 'Change baseline') : (t('usage.config_baseline') || 'Configure baseline')}
          </button>
        </div>
        <div className="mt-5 grid grid-cols-1 items-stretch gap-4 sm:grid-cols-2">
          <Stat label={t('usage.trimmed_chars') || 'Context characters trimmed'} value={compactNumber(savings?.trimmed_chars || data?.trimmed_chars)} />
          <Stat label={t('usage.dollar_savings') || 'Estimated dollar savings'} value={savings?.estimated_savings == null ? (t('usage.not_available') || 'Not available') : money(Number(savings.estimated_savings))} />
        </div>
        {baseline && (
          <p className="mt-4 text-xs text-zinc-600">
            {t('usage.compared_with', {
              service: cleanDisplayName(baseline.model_service_name),
              model: baseline.model,
              provider: cleanDisplayName(baseline.provider_name),
            }) || `Compared with ${cleanDisplayName(baseline.model_service_name)} / ${baseline.model} (${cleanDisplayName(baseline.provider_name)}).`}
          </p>
        )}
        <p className="mt-2 text-xs text-zinc-400">{baseline ? (t('usage.savings_basis_desc') || savings?.basis) : (t('usage.config_baseline') || 'Configure a model service baseline to estimate dollar savings.')}</p>
      </section>

      {baselineOpen && (
        <SavingsBaselineModal
          services={baselineOptions}
          baseline={baseline}
          onClose={() => setBaselineOpen(false)}
          onSaved={(next) => {
            setBaseline(next)
            setBaselineOpen(false)
            saasFetch<SavingsData>('/api/saas/savings?range=30d').then((result) => setSavings(result.data || null)).catch((e: unknown) => setError(errorText(e)))
          }}
        />
      )}

      {missingTokensModalOpen && (
        <MissingTokensModal
          missingUsage={missingUsage}
          totalMissing={data?.coverage?.missing_usage_requests || 0}
          onClose={() => setMissingTokensModalOpen(false)}
        />
      )}

      {data?.budget && (
        <div className="mt-6 rounded-xl border border-zinc-200 bg-white p-5 shadow-sm">
          <div className="flex justify-between text-sm">
            <span>{t('usage.todays_budget') || 'Today’s budget'}</span>
            <span className="font-mono">{data.budget.daily_limit ? `${money(data.budget.spent_today)} / ${money(data.budget.daily_limit)}` : (t('usage.no_limit') || 'No limit set')}</span>
          </div>
          <div className="mt-3 h-2 rounded-full bg-zinc-100">
            <div className="h-full rounded-full bg-zinc-900" style={{ width: `${Math.min((data.budget.daily_limit ? data.budget.spent_today / data.budget.daily_limit : 0) * 100, 100)}%` }} />
          </div>
          <div className="mt-2 text-xs text-zinc-500">{t('usage.status_label', { status: data.budget.status }) || `Status: ${data.budget.status}`}</div>
        </div>
      )}

      {data?.coverage && (
        <section className="mt-6 rounded-xl border border-zinc-200 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <h2 className="font-semibold text-zinc-900">{t('usage.data_coverage') || 'Usage data coverage'}</h2>
              <span title={t('usage.data_coverage_sub') || 'Shows which requests use provider-reported tokens and which rely on estimates.'} className="cursor-help text-zinc-400 hover:text-zinc-600 transition-colors">
                <HelpCircle className="h-3.5 w-3.5" />
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span className="shrink-0 whitespace-nowrap rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
                {t('usage.provider_reported_badge', { pct: coveragePercent(data.coverage.usage) }) || `${coveragePercent(data.coverage.usage)} provider-reported`}
              </span>
              {missingUsage.length > 0 && (
                <button
                  type="button"
                  onClick={() => setMissingTokensModalOpen(true)}
                  className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-800 border border-amber-200 hover:bg-amber-100 transition-colors"
                >
                  <span>{compactNumber(data.coverage.missing_usage_requests)} {t('usage.unreported') || 'Unreported'}</span>
                  <ChevronRight className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          </div>
          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            <Coverage
              label={t('usage.provider_reported_tokens') || 'Provider-reported tokens'}
              value={data.coverage.usage}
              detail={t('usage.provider_reported_detail', { reported: compactNumber(data.coverage.provider_reported_requests), total: compactNumber(data.requests) }) || `${compactNumber(data.coverage.provider_reported_requests)} of ${compactNumber(data.requests)} requests include token data`}
            />
            <Coverage
              label={t('usage.configured_pricing') || 'Configured pricing'}
              value={data.coverage.pricing}
              detail={t('usage.configured_pricing_detail', { priced: compactNumber(data.coverage.priced_requests), total: compactNumber(data.requests) }) || `${compactNumber(data.coverage.priced_requests)} of ${compactNumber(data.requests)} requests have a pricing rule`}
            />
          </div>
        </section>
      )}
    </Page>
  )
}

function SavingsBaselineModal({ services, baseline, onClose, onSaved }: { services: ServiceDetails[]; baseline: SavingsBaseline | null; onClose: () => void; onSaved: (baseline: SavingsBaseline) => void }) {
  const { t } = useI18n()
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

  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/30 p-4" role="dialog" aria-modal="true"><form onSubmit={submit} className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl"><div className="flex items-start justify-between gap-4"><div><h2 className="text-lg font-semibold">{t('usage.baseline_modal_title') || 'Savings comparison baseline'}</h2><p className="mt-1 text-sm text-zinc-500">{t('usage.baseline_modal_desc') || 'Choose one model from a Model Service as the comparison price.'}</p></div><button type="button" onClick={onClose} className="rounded-lg p-2 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-950" aria-label="Close"><X className="h-5 w-5" /></button></div>{services.length ? <div className="mt-6 space-y-5"><Select label={t('services.service_label') || 'Model service'} options={services.map((item) => ({ id: item.id, name: item.name }))} selected={service ? { id: service.id, name: service.name } : { id: '', name: t('usage.select_service') || 'Select a model service' }} onChange={(option) => setServiceId(String(option.id))} /><Select label={t('usage.model_endpoint_label') || 'Model / provider endpoint'} options={(service?.endpoints || []).map((item) => ({ id: item.id, name: `${item.model} — ${item.provider_name}` }))} selected={endpoint ? { id: endpoint.id, name: `${endpoint.model} — ${endpoint.provider_name}` } : { id: '', name: t('services.select_model') || 'Select a model' }} onChange={(option) => setEndpointId(String(option.id))} />{endpoint && <div className="rounded-lg bg-zinc-50 px-3 py-2 text-xs text-zinc-500">Input ${endpoint.input_price_per_1m}/1M · Output ${endpoint.output_price_per_1m}/1M</div>}<p className="text-xs text-zinc-500">{t('usage.baseline_price_note') || 'The estimate uses this endpoint’s configured prices. A single model is supported in the first version.'}</p></div> : <div className="mt-6 rounded-lg bg-amber-50 px-3 py-3 text-sm text-amber-800">{t('usage.create_service_first') || 'Create a Model Service with at least one endpoint before configuring a baseline.'}</div>}{error && <div className="mt-4"><ErrorMessage text={error} /></div>}<div className="mt-6 flex justify-end gap-3"><button type="button" onClick={onClose} className="rounded-lg border border-zinc-300 px-4 py-2.5 text-sm text-zinc-600">{t('common.cancel') || 'Cancel'}</button><button disabled={busy || !services.length} className="rounded-lg bg-zinc-950 px-5 py-2.5 text-sm text-white disabled:opacity-50">{busy ? (t('common.saving') || 'Saving…') : (t('usage.save_baseline') || 'Save baseline')}</button></div></form></div>
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
  attempts?: string[]
  fallback_used?: boolean
  candidates?: { model: string; capability?: number; excluded?: boolean; exclusion_reason?: string }[]
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
  const { t } = useI18n()
  const [range, setRange] = useState<'24h' | '7d' | '30d' | 'all'>('24h')
  const [tierFilter, setTierFilter] = useState<'all' | 'high' | 'medium' | 'low'>('all')
  const [data, setData] = useState<RoutingAnalyticsData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [expandedSignals, setExpandedSignals] = useState<Record<string, boolean>>({})
  const [expandedCandidates, setExpandedCandidates] = useState<Record<string, boolean>>({})
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(15)

  const toggleSignals = (id: string) => {
    setExpandedSignals((prev) => ({ ...prev, [id]: !prev[id] }))
  }

  const toggleCandidates = (id: string) => {
    setExpandedCandidates((prev) => ({ ...prev, [id]: !prev[id] }))
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
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-semibold tracking-tight">{t('analytics.title') || 'Routing Analytics'}</h1>
            <span title={t('analytics.subtitle') || 'Inspect how incoming queries match complexity signals and route across Pro and Flash models.'} className="cursor-help text-zinc-400 hover:text-zinc-600 transition-colors">
              <HelpCircle className="h-4 w-4" />
            </span>
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
                {r === '24h'
                  ? (t('analytics.last_24h') || 'Last 24h')
                  : r === '7d'
                  ? (t('analytics.last_7d') || 'Last 7 days')
                  : r === '30d'
                  ? (t('analytics.last_30d') || 'Last 30 days')
                  : (t('analytics.all_time') || 'All time')}
              </button>
            ))}
          </div>
        </div>

        {error && <ErrorMessage text={error} />}

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="flex flex-col justify-between rounded-xl border border-zinc-200 bg-white p-5 shadow-sm">
            <div className="text-xs font-medium uppercase tracking-wide text-zinc-500 whitespace-nowrap truncate">{t('analytics.analyzed_queries') || 'Analyzed queries'}</div>
            <div className="mt-2 text-2xl font-bold text-zinc-950 whitespace-nowrap">{total.toLocaleString()}</div>
            <div className="mt-2 text-xs text-zinc-400 whitespace-nowrap truncate">{t('analytics.analyzed_queries_sub') || 'Intelligent complexity scored'}</div>
          </div>

          <div className="flex flex-col justify-between rounded-xl border border-zinc-200 bg-white p-5 shadow-sm">
            <div className="text-xs font-medium uppercase tracking-wide text-zinc-500 whitespace-nowrap truncate">{t('analytics.complexity_breakdown') || 'Complexity breakdown'}</div>
            <div className="mt-2 flex items-baseline gap-2.5 sm:gap-3 flex-nowrap">
              <div className="flex items-baseline whitespace-nowrap">
                <span className="text-2xl font-bold text-purple-700">{(data?.summary.high_tier_count || 0).toLocaleString()}</span>
                <span className="ml-1 text-xs text-zinc-400 whitespace-nowrap">{t('analytics.tier_high_short') || t('analytics.tier_high') || 'High'}</span>
              </div>
              <div className="h-4 w-px bg-zinc-200 shrink-0" />
              <div className="flex items-baseline whitespace-nowrap">
                <span className="text-2xl font-bold text-amber-600">{(data?.summary.medium_tier_count || 0).toLocaleString()}</span>
                <span className="ml-1 text-xs text-zinc-400 whitespace-nowrap">{t('analytics.tier_medium_short') || t('analytics.tier_medium') || 'Med'}</span>
              </div>
              <div className="h-4 w-px bg-zinc-200 shrink-0" />
              <div className="flex items-baseline whitespace-nowrap">
                <span className="text-2xl font-bold text-emerald-600">{(data?.summary.low_tier_count || 0).toLocaleString()}</span>
                <span className="ml-1 text-xs text-zinc-400 whitespace-nowrap">{t('analytics.tier_low_short') || t('analytics.tier_low') || 'Low'}</span>
              </div>
            </div>
            <div className="mt-2 text-xs text-zinc-400 whitespace-nowrap truncate">{t('analytics.high_reasoning_sub', { pct: highPct }) || `${highPct}% complex reasoning & code`}</div>
          </div>

          <div className="flex flex-col justify-between rounded-xl border border-zinc-200 bg-white p-5 shadow-sm">
            <div className="text-xs font-medium uppercase tracking-wide text-zinc-500 whitespace-nowrap truncate">{t('analytics.model_tier_routing') || 'Model tier routing'}</div>
            <div className="mt-2 flex items-baseline gap-3 sm:gap-4 flex-nowrap">
              <div className="flex items-baseline whitespace-nowrap">
                <span className="text-2xl font-bold text-purple-700">{(data?.summary.pro_count || 0).toLocaleString()}</span>
                <span className="ml-1 text-xs text-zinc-400 whitespace-nowrap">{t('analytics.pro_model_short') || t('analytics.pro_model') || 'Pro'}</span>
              </div>
              <div className="h-4 w-px bg-zinc-200 shrink-0" />
              <div className="flex items-baseline whitespace-nowrap">
                <span className="text-2xl font-bold text-emerald-600">{(data?.summary.flash_count || 0).toLocaleString()}</span>
                <span className="ml-1 text-xs text-zinc-400 whitespace-nowrap">{t('analytics.flash_model_short') || t('analytics.flash_model') || 'Flash'}</span>
              </div>
            </div>
            <div className="mt-2 text-xs text-zinc-400 whitespace-nowrap truncate">{t('analytics.dynamic_dispatch') || 'Dynamic capability dispatch'}</div>
          </div>

          <div className="flex flex-col justify-between rounded-xl border border-zinc-200 bg-white p-5 shadow-sm">
            <div className="text-xs font-medium uppercase tracking-wide text-zinc-500 whitespace-nowrap truncate">{t('analytics.estimated_savings') || 'Estimated savings'}</div>
            <div className="mt-2 text-2xl font-bold text-emerald-600 whitespace-nowrap">
              ${(data?.summary.estimated_savings || 0).toFixed(4)}
            </div>
            <div className="mt-2 text-xs text-zinc-400 whitespace-nowrap truncate">
              {t('analytics.total_spend', { amount: (data?.summary.total_cost || 0).toFixed(4) }) || `Total spend: $${(data?.summary.total_cost || 0).toFixed(4)}`}
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-zinc-900">{t('analytics.spectrum_title') || 'Complexity Spectrum & Signal Distribution'}</h2>
            <span className="text-xs text-zinc-400">{t('analytics.spectrum_hint') || 'Higher score routes to Pro models'}</span>
          </div>

          <div className="mt-4 flex h-3 w-full overflow-hidden rounded-full bg-zinc-100">
            {highPct > 0 && <div style={{ width: `${highPct}%` }} className="bg-purple-600 transition-all" title={`High: ${highPct}%`} />}
            {medPct > 0 && <div style={{ width: `${medPct}%` }} className="bg-amber-500 transition-all" title={`Medium: ${medPct}%`} />}
            {lowPct > 0 && <div style={{ width: `${lowPct}%` }} className="bg-emerald-500 transition-all" title={`Low: ${lowPct}%`} />}
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-4 text-xs text-zinc-500">
            <div className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full bg-purple-600" />
              <span>{t('analytics.high_complexity') || 'High Complexity (≥ 0.55)'}: <strong>{(data?.summary.high_tier_count || 0).toLocaleString()}</strong> ({highPct}%)</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full bg-amber-500" />
              <span>{t('analytics.med_complexity') || 'Medium Complexity (0.35–0.55)'}: <strong>{(data?.summary.medium_tier_count || 0).toLocaleString()}</strong> ({medPct}%)</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full bg-emerald-500" />
              <span>{t('analytics.low_complexity') || 'Low Complexity (< 0.35)'}: <strong>{(data?.summary.low_tier_count || 0).toLocaleString()}</strong> ({lowPct}%)</span>
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-zinc-200 bg-white overflow-hidden shadow-sm">
          <div className="p-5 pb-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-zinc-900">{t('analytics.table_title') || 'Query Logs & Signal Hits'}</h2>
              <p className="mt-0.5 text-xs text-zinc-400">{t('analytics.table_subtitle') || 'Live inspection of prompt intents and routed models.'}</p>
            </div>
            <div className="flex items-center gap-1 rounded-lg border border-zinc-200 bg-zinc-50/70 p-1">
              {(['all', 'high', 'medium', 'low'] as const).map((tier) => (
                <button
                  key={tier}
                  onClick={() => setTierFilter(tier)}
                  className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                    tierFilter === tier ? 'bg-white text-zinc-950 shadow-sm' : 'text-zinc-500 hover:text-zinc-900'
                  }`}
                >
                  {tier === 'all'
                    ? (t('analytics.all_tiers') || 'All tiers')
                    : tier === 'high'
                    ? (t('analytics.tier_high') || 'High')
                    : tier === 'medium'
                    ? (t('analytics.tier_medium') || 'Med')
                    : (t('analytics.tier_low') || 'Low')}
                </button>
              ))}
            </div>
          </div>

          <div className="border-t border-zinc-100 overflow-x-auto min-h-[420px]">
            {!paginatedQueries.length ? (
              <div className="py-16 text-center text-sm text-zinc-500">
                {loading ? (t('common.loading') || 'Loading…') : (t('analytics.no_records') || 'No query records found for this period.')}
              </div>
            ) : (
              <table className="w-full min-w-[920px] text-left text-xs divide-y divide-zinc-100">
                <thead className="bg-zinc-50/50">
                  <tr className="text-zinc-500">
                    <th className="py-2.5 px-4 font-medium w-[140px]">{t('analytics.col_time_service') || 'Time / Service'}</th>
                    <th className="py-2.5 px-3 font-medium min-w-[180px] max-w-[240px]">{t('analytics.col_prompt') || 'Prompt / User Intent'}</th>
                    <th className="py-2.5 px-3 font-medium w-[130px]">{t('analytics.col_complexity') || 'Complexity'}</th>
                    <th className="py-2.5 px-3 font-medium min-w-[220px] max-w-[280px]">{t('analytics.col_signals') || 'Matched Signals'}</th>
                    <th className="py-2.5 px-3 font-medium min-w-[150px]">{t('analytics.col_model') || 'Routed Model'}</th>
                    <th className="py-2.5 px-3 text-right font-medium w-[100px]">{t('analytics.col_tokens_latency') || 'Tokens / Latency'}</th>
                    <th className="py-2.5 px-4 text-right font-medium w-[80px]">{t('analytics.col_cost') || 'Cost'}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100 bg-white">
                  {paginatedQueries.map((q) => {
                    const cleanService = q.service_name.replace(/^[0-9a-fA-F-]{36,37}-/, '')
                    const cleanProvider = q.provider_name.replace(/^saas-[0-9a-fA-F-]{36}/, 'DeepSeek').replace(/^saas-/, '')
                    const list = q.signals.slice(0, 2)
                    const remaining = q.signals.slice(2)
                    return (
                      <tr key={q.id} className="hover:bg-zinc-50/70 transition-colors">
                        <td className="py-3 px-4 align-middle whitespace-nowrap">
                          <div className="font-semibold text-zinc-900 truncate">{cleanService}</div>
                          <div className="text-[10px] text-zinc-400">{q.timestamp}</div>
                        </td>
                        <td className="py-3 px-3 align-middle max-w-[240px]">
                          <div className="font-mono text-zinc-800 text-[11px] truncate" title={q.prompt_preview}>
                            {q.prompt_preview}
                          </div>
                        </td>
                        <td className="py-3 px-3 align-middle whitespace-nowrap">
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
                        <td className="py-3 px-3 align-middle">
                          <div className="flex flex-wrap items-center gap-1 max-w-[260px]">
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
                            {remaining.length > 0 && (
                              <div className="group relative inline-flex items-center">
                                <span
                                  className="inline-flex items-center rounded-md bg-zinc-100 hover:bg-zinc-200 px-1.5 py-0.5 text-[10px] font-medium text-zinc-600 border border-zinc-200 cursor-help transition-colors"
                                  title={q.signals.join(', ')}
                                >
                                  +{remaining.length}
                                </span>
                                <div className="pointer-events-none absolute left-0 bottom-full z-50 mb-2 hidden w-56 rounded-xl border border-zinc-200 bg-white p-2.5 shadow-xl group-hover:block text-left whitespace-normal">
                                  <div className="text-[11px] font-semibold text-zinc-900 mb-1.5">
                                    {t('analytics.col_signals') || 'Matched Signals'} ({q.signals.length})
                                  </div>
                                  <div className="flex flex-wrap gap-1">
                                    {q.signals.map((s, idx) => (
                                      <span
                                        key={idx}
                                        className={`inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-medium ${
                                          s.includes('Judge')
                                            ? 'bg-purple-50 text-purple-700 border border-purple-200'
                                            : s.includes('reasoning') || s.includes('Correction')
                                            ? 'bg-amber-50 text-amber-800 border border-amber-200'
                                            : 'bg-zinc-100 text-zinc-700 border border-zinc-200'
                                        }`}
                                      >
                                        {s}
                                      </span>
                                    ))}
                                  </div>
                                </div>
                              </div>
                            )}
                          </div>
                        </td>
                        <td className="py-3 px-3 align-middle whitespace-nowrap">
                          <div className="flex items-center gap-1.5">
                            <span className="font-semibold text-zinc-900">{q.model}</span>
                            {(q.candidates?.length ?? 0) > 1 && (
                              <div className="group relative inline-flex items-center">
                                <button
                                  type="button"
                                  className="text-zinc-400 hover:text-zinc-700 transition-colors p-0.5 rounded-full hover:bg-zinc-100 cursor-help"
                                  aria-label={t('analytics.why_model') || 'Why this model?'}
                                  title={t('analytics.why_model') || 'Why this model?'}
                                >
                                  <Info className="h-3.5 w-3.5" />
                                </button>
                                <div className="pointer-events-none absolute right-0 bottom-full z-50 mb-2 hidden w-64 rounded-xl border border-zinc-200 bg-white p-3 shadow-xl group-hover:block text-left whitespace-normal">
                                  <div className="text-[11px] font-semibold text-zinc-900 mb-1.5 flex items-center justify-between">
                                    <span>{t('analytics.why_model') || 'Why this model?'}</span>
                                    <span className="text-[10px] font-normal text-zinc-400">{t('analytics.candidate_ranking') || 'Candidate ranking'}</span>
                                  </div>
                                  <ol className="space-y-1.5">
                                    {(q.candidates ?? []).map((candidate, index) => (
                                      <li key={`${q.id}-${index}`} className="flex items-center justify-between text-[11px] leading-tight">
                                        <span className={`truncate mr-2 ${index === 0 ? 'font-semibold text-zinc-950' : candidate.excluded ? 'line-through text-zinc-400' : 'text-zinc-600'}`}>
                                          {index + 1}. {candidate.model}
                                        </span>
                                        <span className="shrink-0 text-[10px] font-mono text-zinc-400">
                                          {candidate.excluded ? (
                                            <span className="text-rose-500 font-sans">
                                              excluded{candidate.exclusion_reason ? ` (${candidate.exclusion_reason})` : ''}
                                            </span>
                                          ) : (
                                            `cap ${(candidate.capability ?? 0).toFixed(2)}`
                                          )}
                                        </span>
                                      </li>
                                    ))}
                                  </ol>
                                </div>
                              </div>
                            )}
                          </div>
                          <div className="text-[10px] text-zinc-400 truncate max-w-[140px]" title={q.provider_name}>{cleanProvider}</div>
                          {q.fallback_used && (
                            <div className="mt-0.5 inline-flex items-center rounded-md border border-rose-200/80 bg-rose-50 px-1.5 py-0.5 text-[9px] font-medium text-rose-700" title={`Attempted in order: ${(q.attempts ?? []).join(' → ')}`}>
                              {t('analytics.fallback_badge') || 'Fallback'}
                            </div>
                          )}
                        </td>
                        <td className="py-3 px-3 align-middle text-right whitespace-nowrap">
                          <div className="font-medium text-zinc-900">{q.total_tokens.toLocaleString()} tok</div>
                          <div className="text-[10px] text-zinc-400">{q.latency_ms}ms</div>
                        </td>
                        <td className="py-3 px-4 align-middle text-right whitespace-nowrap font-semibold text-zinc-900">
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
            <div className="border-t border-zinc-100 bg-zinc-50/70 px-5 py-3 flex flex-wrap items-center justify-between gap-3 text-xs text-zinc-500 select-none min-h-[52px]">
              <div className="flex items-center gap-3">
                <span className="whitespace-nowrap tabular-nums">
                  {t('pagination.showing', { start: startIndex + 1, end: Math.min(startIndex + pageSize, totalFiltered), total: totalFiltered }) || `Showing ${startIndex + 1}–${Math.min(startIndex + pageSize, totalFiltered)} of ${totalFiltered} queries`}
                </span>
                <div className="w-32 min-w-[125px]">
                  <Select
                    size="sm"
                    direction="up"
                    options={[
                      { id: '10', name: t('pagination.per_page', { count: 10 }) || '10 / page' },
                      { id: '15', name: t('pagination.per_page', { count: 15 }) || '15 / page' },
                      { id: '25', name: t('pagination.per_page', { count: 25 }) || '25 / page' },
                      { id: '50', name: t('pagination.per_page', { count: 50 }) || '50 / page' },
                    ]}
                    selected={{ id: String(pageSize), name: t('pagination.per_page', { count: pageSize }) || `${pageSize} / page` }}
                    onChange={(opt) => {
                      setPageSize(Number(opt.id))
                      setPage(1)
                    }}
                  />
                </div>
              </div>

              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  disabled={currentPage <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  className="inline-flex h-8 w-8 min-w-[32px] max-w-[32px] shrink-0 items-center justify-center rounded-lg border border-zinc-200 bg-white text-zinc-600 transition hover:bg-zinc-100 disabled:opacity-40 disabled:pointer-events-none"
                  aria-label={t('pagination.prev') || 'Previous page'}
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>

                <div className="flex items-center gap-1">
                  {(() => {
                    const items: (number | string)[] = []
                    if (totalPages <= 7) {
                      for (let i = 1; i <= totalPages; i++) items.push(i)
                    } else if (currentPage <= 4) {
                      items.push(1, 2, 3, 4, 5, '…', totalPages)
                    } else if (currentPage >= totalPages - 3) {
                      items.push(1, '…', totalPages - 4, totalPages - 3, totalPages - 2, totalPages - 1, totalPages)
                    } else {
                      items.push(1, '…', currentPage - 1, currentPage, currentPage + 1, '…', totalPages)
                    }

                    return items.map((item, idx) =>
                      typeof item === 'number' ? (
                        <button
                          key={`page-${item}`}
                          type="button"
                          onClick={() => setPage(item)}
                          className={`h-8 w-8 min-w-[32px] max-w-[32px] shrink-0 flex items-center justify-center rounded-lg text-xs font-medium tabular-nums transition-colors ${
                            currentPage === item
                              ? 'bg-zinc-900 text-white shadow-sm font-semibold'
                              : 'bg-white text-zinc-600 border border-zinc-200 hover:bg-zinc-100'
                          }`}
                        >
                          {item}
                        </button>
                      ) : (
                        <span key={`ellipsis-${idx}`} className="h-8 w-8 min-w-[32px] max-w-[32px] shrink-0 flex items-center justify-center text-xs text-zinc-400 select-none">
                          {item}
                        </span>
                      )
                    )
                  })()}
                </div>

                <button
                  type="button"
                  disabled={currentPage >= totalPages}
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  className="inline-flex h-8 w-8 min-w-[32px] max-w-[32px] shrink-0 items-center justify-center rounded-lg border border-zinc-200 bg-white text-zinc-600 transition hover:bg-zinc-100 disabled:opacity-40 disabled:pointer-events-none"
                  aria-label={t('pagination.next') || 'Next page'}
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

type QualityRecord = {
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
  prompt_preview: string
  verdict: 'verified' | 'schema_valid' | 'escalated' | 'completed' | 'error'
  verdict_desc: string
  feedback_source: string
}

type QualityAnalyticsData = {
  range: string
  summary: {
    total_queries: number
    comparison_status: 'available' | 'unavailable'
    quality_preserved_rate: number | null
    user_correction_rate: number | null
    schema_compliance_rate: number | null
    shadow_agreement_score: number | null
    pro_count: number
    flash_count: number
    baseline: {
      name: string
      cost_per_req: number | null
      avg_latency_ms: number | null
      p90_latency_ms: number | null
      task_success_rate: number | null
      correction_rate: number | null
      schema_compliance_rate: number | null
    } | null
    smartgate_routing: {
      name: string
      cost_per_req: number | null
      avg_latency_ms: number | null
      p90_latency_ms: number | null
      task_success_rate: number | null
      correction_rate: number | null
      schema_compliance_rate: number | null
      cost_saved_pct: number | null
      speedup_pct: number | null
    }
  }
  records: QualityRecord[]
}

function QualityHelpTip({ tip, unavailable }: { tip: string; unavailable?: string }) {
  const title = unavailable ? `${tip} ${unavailable}` : tip
  return (
    <span title={title} className="cursor-help text-zinc-400 hover:text-zinc-600 transition-colors">
      <Info className="h-3.5 w-3.5" />
    </span>
  )
}

export function QualityPage() {
  const { t } = useI18n()
  const [range, setRange] = useState<'24h' | '7d' | '30d' | 'all'>('24h')
  const [verdictFilter, setVerdictFilter] = useState<'all' | 'verified' | 'schema_valid' | 'escalated' | 'completed' | 'error'>('all')
  const [data, setData] = useState<QualityAnalyticsData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(15)
  const [baselineModalOpen, setBaselineModalOpen] = useState(false)
  const [baselineOptions, setBaselineOptions] = useState<ServiceDetails[]>([])
  const [baselineData, setBaselineData] = useState<SavingsBaseline | null>(null)

  const fetchQualityData = () => {
    setLoading(true)
    saasFetch<QualityAnalyticsData>(`/api/saas/analytics/quality?range=${range}`)
      .then((res) => {
        setData(res.data || null)
        setError('')
      })
      .catch((e) => setError(errorText(e)))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    fetchQualityData()
  }, [range])

  useEffect(() => {
    saasFetch<Service[]>('/api/saas/model-services')
      .then(async (res) => {
        const details = await Promise.all((res.data || []).map(async (service) => {
          try { return (await saasFetch<ServiceDetails>(`/api/saas/model-services/${service.id}`)).data || null } catch { return null }
        }))
        setBaselineOptions(details.filter((service): service is ServiceDetails => Boolean(service)))
      })
      .catch(() => {})

    saasFetch<{ configured?: boolean } & Partial<SavingsBaseline>>('/api/saas/savings-baseline')
      .then((res) => {
        if (res.data?.configured) {
          setBaselineData(res.data as SavingsBaseline)
        }
      })
      .catch(() => {})
  }, [])

  useEffect(() => {
    setPage(1)
  }, [range, verdictFilter, pageSize])

  const filteredRecords = (data?.records || []).filter((r) => {
    if (verdictFilter === 'all') return true
    return r.verdict === verdictFilter
  })

  const totalFiltered = filteredRecords.length
  const totalPages = Math.max(1, Math.ceil(totalFiltered / pageSize))
  const currentPage = Math.min(page, totalPages)
  const startIndex = (currentPage - 1) * pageSize
  const paginatedRecords = filteredRecords.slice(startIndex, startIndex + pageSize)

  const summary = data?.summary
  const baseline = summary?.baseline
  const routing = summary?.smartgate_routing

  return (
    <Page>
      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-emerald-600" />
            <h1 className="text-xl font-semibold tracking-tight">{t('quality.title') || 'Quality Assurance'}</h1>
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
                {r === '24h'
                  ? (t('quality.last_24h') || 'Last 24h')
                  : r === '7d'
                  ? (t('quality.last_7d') || 'Last 7 days')
                  : r === '30d'
                  ? (t('quality.last_30d') || 'Last 30 days')
                  : (t('quality.all_time') || 'All time')}
              </button>
            ))}
          </div>
        </div>

        {error && <ErrorMessage text={error} />}

        {/* Top 4 Quality Scorecards */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="flex flex-col justify-between rounded-xl border border-zinc-200 bg-white p-5 shadow-sm">
            <div className="flex items-center justify-between gap-2">
              <div className="text-xs font-medium uppercase tracking-wide text-zinc-500 truncate">{t('quality.preserved_rate') || 'Quality Preserved Rate'}</div>
              <div className="flex items-center gap-1">
                <span className="inline-flex items-center rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 border border-emerald-200 shrink-0 whitespace-nowrap">
                  {summary?.quality_preserved_rate != null ? (t('quality.verified_tag') || 'Observed') : (t('quality.unavailable_tag') || 'Unavailable')}
                </span>
                <QualityHelpTip
                  tip={t('quality.preserved_rate_tip') || 'Share of routed responses whose quality matches the configured flagship baseline, measured by comparative evaluation.'}
                  unavailable={summary?.quality_preserved_rate == null ? (t('quality.preserved_rate_unavailable_tip') || 'Requires an independent All-Pro baseline to be configured for comparative fidelity measurement.') : undefined}
                />
              </div>
            </div>
            <div className="mt-2 text-2xl font-bold text-zinc-950">
              {summary?.quality_preserved_rate != null ? `${summary.quality_preserved_rate}%` : 'N/A'}
            </div>
            <div className="mt-2 text-xs text-zinc-400">{t('quality.vs_baseline') || 'vs 100% full-Pro baseline'}</div>
          </div>

          <div className="flex flex-col justify-between rounded-xl border border-zinc-200 bg-white p-5 shadow-sm">
            <div className="flex items-center justify-between gap-2">
              <div className="text-xs font-medium uppercase tracking-wide text-zinc-500 truncate">{t('quality.shadow_agreement') || 'Shadow Pro Agreement'}</div>
              <div className="flex items-center gap-1">
                <span className="inline-flex items-center rounded-full bg-purple-50 px-2 py-0.5 text-[10px] font-semibold text-purple-700 border border-purple-200 shrink-0 whitespace-nowrap">
                  {summary?.shadow_agreement_score != null ? (t('quality.judge_score_tag') || 'Observed') : (t('quality.unavailable_tag') || 'Unavailable')}
                </span>
                <QualityHelpTip
                  tip={t('quality.shadow_agreement_tip') || 'How often the shadow flagship rerun agrees with the routed model for the same prompt, sampled by the auxiliary judge.'}
                  unavailable={summary?.shadow_agreement_score == null ? (t('quality.shadow_agreement_unavailable_tip') || 'No active shadow inference runs were sampled in this time period.') : undefined}
                />
              </div>
            </div>
            <div className="mt-2 text-2xl font-bold text-purple-700">
              {summary?.shadow_agreement_score != null ? `${summary.shadow_agreement_score}%` : 'N/A'}
            </div>
            <div className="mt-2 text-xs text-zinc-400">{t('quality.similarity_sub') || 'Flash vs Pro output similarity'}</div>
          </div>

          <div className="flex flex-col justify-between rounded-xl border border-zinc-200 bg-white p-5 shadow-sm">
            <div className="flex items-center justify-between gap-2">
              <div className="text-xs font-medium uppercase tracking-wide text-zinc-500 truncate">{t('quality.correction_rate') || 'User Correction Rate'}</div>
              <div className="flex items-center gap-1">
                <span className="inline-flex items-center rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-semibold text-blue-700 border border-blue-200 shrink-0 whitespace-nowrap">
                  {summary?.user_correction_rate != null ? (t('quality.healthy_tag') || 'Observed') : (t('quality.unavailable_tag') || 'Unavailable')}
                </span>
                <QualityHelpTip
                  tip={t('quality.correction_rate_tip') || 'Share of requests followed by a retry or rephrased follow-up turn, a proxy for user dissatisfaction with the first answer.'}
                  unavailable={summary?.user_correction_rate == null ? (t('quality.correction_rate_unavailable_tip') || 'No completed requests were recorded in this period.') : undefined}
                />
              </div>
            </div>
            <div className="mt-2 text-2xl font-bold text-zinc-950">
              {summary?.user_correction_rate != null ? `${summary.user_correction_rate}%` : 'N/A'}
            </div>
            <div className="mt-2 text-xs text-zinc-400">{t('quality.correction_sub') || 'Multi-turn retry & rephrase rate'}</div>
          </div>

          <div className="flex flex-col justify-between rounded-xl border border-zinc-200 bg-white p-5 shadow-sm">
            <div className="flex items-center justify-between gap-2">
              <div className="text-xs font-medium uppercase tracking-wide text-zinc-500 truncate">{t('quality.schema_compliance') || 'Schema Compliance'}</div>
              <div className="flex items-center gap-1">
                <span className="inline-flex items-center rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 border border-emerald-200 shrink-0 whitespace-nowrap">
                  {summary?.schema_compliance_rate != null ? (t('quality.valid_tag') || 'Observed') : (t('quality.unavailable_tag') || 'Unavailable')}
                </span>
                <QualityHelpTip
                  tip={t('quality.schema_compliance_tip') || 'Share of tool-call and structured-output requests that returned valid, schema-compliant JSON.'}
                  unavailable={summary?.schema_compliance_rate == null ? (t('quality.schema_compliance_unavailable_tip') || 'No requests containing tool calls or structured JSON schemas were recorded in this period.') : undefined}
                />
              </div>
            </div>
            <div className="mt-2 text-2xl font-bold text-emerald-600">
              {summary?.schema_compliance_rate != null ? `${summary.schema_compliance_rate}%` : 'N/A'}
            </div>
            <div className="mt-2 text-xs text-zinc-400">{t('quality.schema_sub') || 'Structured JSON & tool outputs'}</div>
          </div>
        </div>

        {/* A/B Benchmark ROI & Quality Evidence Matrix */}
        <div className="rounded-xl border border-zinc-200 bg-white p-6 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-zinc-900">{t('quality.ab_benchmark_title') || 'Routing Comparison'}</h2>
              <p className="mt-0.5 text-xs text-zinc-400">
                {t('quality.ab_benchmark_subtitle') || 'Direct evidence comparing 100% All-Pro Flagship allocation against SmartGate Intelligent Routing.'}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setBaselineModalOpen(true)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-300 px-2.5 py-1.5 text-xs font-medium text-zinc-700 hover:border-zinc-950 hover:text-zinc-950 transition-colors"
              >
                <Settings2 className="h-3.5 w-3.5" />
                <span>{baseline ? (t('usage.change_baseline') || 'Change baseline') : (t('usage.config_baseline') || 'Configure baseline')}</span>
              </button>
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700 border border-emerald-200 shrink-0 whitespace-nowrap">
                <Sparkles className="h-3.5 w-3.5" />
                {routing?.cost_saved_pct != null ? (t('quality.cost_saved', { pct: routing.cost_saved_pct }) || `${routing.cost_saved_pct}% Cost Saved`) : 'N/A'}
              </span>
            </div>
          </div>

          <div className="mt-5 grid gap-4 md:grid-cols-2">
            {/* Control Group: Baseline */}
            <div className="flex flex-col justify-between rounded-xl border border-zinc-200 bg-zinc-50/60 p-4">
              <div>
                <div className="flex items-center justify-between border-b border-zinc-200/80 pb-2">
                  <span className="text-xs font-semibold text-zinc-700">{t('quality.control_title') || 'Control: All-Pro Baseline'}</span>
                  <span className="text-[10px] font-medium text-zinc-400">{baseline ? (t('quality.flagship_tag') || 'Configured baseline') : (t('quality.not_configured_tag') || 'Not configured')}</span>
                </div>
                {baseline ? (
                  <div className="mt-3 grid grid-cols-2 gap-3 text-xs">
                    <div>
                      <div className="text-zinc-400 text-[11px]">{t('quality.avg_cost_req') || 'Avg Cost / Request'}</div>
                      <div className="mt-0.5 text-base font-semibold text-zinc-900 font-mono">
                        {baseline.cost_per_req != null ? `$${baseline.cost_per_req.toFixed(4)}` : 'N/A'}
                      </div>
                    </div>
                    <div>
                      <div className="text-zinc-400 text-[11px]">{t('quality.p90_latency') || 'P90 Latency'}</div>
                      <div className="mt-0.5 text-base font-semibold text-zinc-900 font-mono">
                        {baseline.p90_latency_ms != null ? `${(baseline.p90_latency_ms / 1000).toFixed(1)}s` : 'N/A'}
                      </div>
                    </div>
                    <div>
                      <div className="text-zinc-400 text-[11px]">{t('quality.schema_compliance') || 'Schema Compliance'}</div>
                      <div className="mt-0.5 text-sm font-semibold text-zinc-800">
                        {baseline.schema_compliance_rate != null ? `${baseline.schema_compliance_rate}%` : 'N/A'}
                      </div>
                    </div>
                    <div>
                      <div className="text-zinc-400 text-[11px]">{t('quality.task_success') || 'Task Success Rate'}</div>
                      <div className="mt-0.5 text-sm font-semibold text-zinc-800">
                        {baseline.task_success_rate != null ? `${baseline.task_success_rate}%` : 'N/A'}
                      </div>
                    </div>
                    <div>
                      <div className="text-zinc-400 text-[11px]">{t('quality.followup_correction') || 'Follow-up Correction'}</div>
                      <div className="mt-0.5 text-sm font-semibold text-zinc-800">
                        {baseline.correction_rate != null ? `${baseline.correction_rate}%` : 'N/A'}
                      </div>
                    </div>
                    <p className="col-span-2 text-[11px] leading-relaxed text-zinc-400">
                      {t('quality.baseline_est_note') || 'Metrics are computed from actual requests sent to the configured baseline model service. Send traffic to the baseline service to populate this card.'}
                    </p>
                  </div>
                ) : (
                  <div className="mt-4 text-center py-4 px-3 rounded-lg border border-dashed border-zinc-200 bg-white/70">
                    <p className="text-xs text-zinc-600 font-medium">
                      {t('quality.no_baseline_guide') || 'No comparison baseline is configured yet.'}
                    </p>
                    <p className="mt-1 text-[11px] text-zinc-400">
                      {t('quality.no_baseline_guide_desc') || 'Select a flagship model (e.g. Pro) to enable real-time cost savings and latency speedup calculation.'}
                    </p>
                    <button
                      type="button"
                      onClick={() => setBaselineModalOpen(true)}
                      className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white shadow-sm hover:bg-zinc-800 transition-colors"
                    >
                      <Settings2 className="h-3 w-3" />
                      <span>{t('quality.configure_baseline_now') || 'Configure Baseline Now'}</span>
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* Treatment Group: SmartGate */}
            <div className="rounded-xl border border-emerald-200 bg-emerald-50/30 p-4">
              <div className="flex items-center justify-between border-b border-emerald-200/80 pb-2">
                <span className="text-xs font-semibold text-emerald-900">{t('quality.treatment_title') || 'Treatment: SmartGate Intelligent Routing'}</span>
                <span className="text-[10px] font-semibold text-emerald-700">{t('quality.pareto_tag') || 'Observed routing'}</span>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-3 text-xs">
                <div>
                  <div className="text-emerald-800/70 text-[11px]">{t('quality.avg_cost_req') || 'Avg Cost / Request'}</div>
                  <div className="mt-0.5 flex items-baseline gap-1.5">
                    <span className="text-base font-bold text-emerald-700 font-mono">
                      {routing?.cost_per_req != null ? `$${routing.cost_per_req.toFixed(4)}` : 'N/A'}
                    </span>
                    <span className="text-[10px] font-semibold text-emerald-600">
                      {routing?.cost_saved_pct != null ? `(-${routing.cost_saved_pct}%)` : ''}
                    </span>
                  </div>
                </div>
                <div>
                  <div className="text-emerald-800/70 text-[11px]">{t('quality.p90_latency') || 'P90 Latency'}</div>
                  <div className="mt-0.5 flex items-baseline gap-1.5">
                    <span className="text-base font-bold text-emerald-700 font-mono">
                      {routing?.p90_latency_ms != null ? `${(routing.p90_latency_ms / 1000).toFixed(1)}s` : 'N/A'}
                    </span>
                    <span className="text-[10px] font-semibold text-emerald-600">
                      {routing?.speedup_pct != null ? `(${routing.speedup_pct}% ${t('quality.faster', { pct: '' }) || 'faster'})` : ''}
                    </span>
                  </div>
                </div>
                <div>
                  <div className="text-emerald-800/70 text-[11px]">{t('quality.task_success') || 'Task Success Rate'}</div>
                  <div className="mt-0.5 flex items-baseline gap-1.5">
                    <span className="text-sm font-semibold text-zinc-900">
                      {routing?.task_success_rate != null ? `${routing.task_success_rate}%` : 'N/A'}
                    </span>
                    {routing?.task_success_rate != null && baseline?.task_success_rate != null ? <span className="text-[10px] text-zinc-500 font-mono">({(routing.task_success_rate - baseline.task_success_rate).toFixed(1)}% delta)</span> : null}
                  </div>
                </div>
                <div>
                  <div className="text-emerald-800/70 text-[11px]">{t('quality.followup_correction') || 'Follow-up Correction'}</div>
                  <div className="mt-0.5 flex items-baseline gap-1.5">
                    <span className="text-sm font-semibold text-zinc-900">
                      {routing?.correction_rate != null ? `${routing.correction_rate}%` : 'N/A'}
                    </span>
                    {routing?.correction_rate != null && baseline?.correction_rate != null ? <span className="text-[10px] text-zinc-500 font-mono">({(routing.correction_rate - baseline.correction_rate).toFixed(1)}% delta)</span> : null}
                  </div>
                </div>
                <div>
                  <div className="text-emerald-800/70 text-[11px]">{t('quality.schema_compliance') || 'Schema Compliance'}</div>
                  <div className="mt-0.5 flex items-baseline gap-1.5">
                    <span className="text-sm font-semibold text-zinc-900">
                      {routing?.schema_compliance_rate != null ? `${routing.schema_compliance_rate}%` : 'N/A'}
                    </span>
                    {routing?.schema_compliance_rate != null && baseline?.schema_compliance_rate != null ? <span className="text-[10px] text-zinc-500 font-mono">({(routing.schema_compliance_rate - baseline.schema_compliance_rate).toFixed(1)}% delta)</span> : null}
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="mt-4 rounded-lg bg-zinc-50 border border-zinc-100 px-4 py-2.5 text-xs text-zinc-600 flex items-center justify-between">
            <span className="flex items-center gap-1.5">
              <CheckCheck className="h-4 w-4 text-emerald-600 shrink-0" />
              <span>{t('quality.conclusion') || 'Observed comparison for the selected time range. Results are telemetry-based and are not a guarantee of future cost, latency, or quality.'}</span>
            </span>
          </div>
        </div>

        {baselineModalOpen && (
          <SavingsBaselineModal
            services={baselineOptions}
            baseline={baselineData}
            onClose={() => setBaselineModalOpen(false)}
            onSaved={(next) => {
              setBaselineData(next)
              setBaselineModalOpen(false)
              fetchQualityData()
            }}
          />
        )}

        {/* Quality Stream & Evaluation Logs Table */}
        <div className="rounded-xl border border-zinc-200 bg-white overflow-hidden shadow-sm">
          <div className="p-5 pb-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-zinc-900">{t('quality.verdict_logs_title') || 'Quality Feedback & Verification Logs'}</h2>
              <p className="mt-0.5 text-xs text-zinc-400">{t('quality.verdict_logs_subtitle') || 'Live stream of verification sources, shadow judge scores, and auto-escalations.'}</p>
            </div>
            <div className="flex items-center gap-1 rounded-lg border border-zinc-200 bg-zinc-50/70 p-1">
              {(['all', 'verified', 'schema_valid', 'escalated', 'completed', 'error'] as const).map((v) => (
                <button
                  key={v}
                  onClick={() => setVerdictFilter(v)}
                  className={`rounded-md px-2.5 py-1 text-xs font-medium capitalize transition-colors ${
                    verdictFilter === v ? 'bg-white text-zinc-950 shadow-sm' : 'text-zinc-500 hover:text-zinc-900'
                  }`}
                >
                  {v === 'all'
                    ? (t('quality.all_verdicts') || 'All Verdicts')
                    : v === 'verified'
                    ? (t('quality.verdict_verified') || 'Verified')
                    : v === 'schema_valid'
                    ? (t('quality.verdict_schema') || 'Schema Valid')
                    : v === 'escalated'
                    ? (t('quality.verdict_escalated') || 'Escalated')
                    : v === 'error'
                    ? (t('quality.verdict_error') || 'Error')
                    : (t('quality.verdict_completed') || 'Completed')}
                </button>
              ))}
            </div>
          </div>

          <div className="border-t border-zinc-100 overflow-x-auto min-h-[420px]">
            {!paginatedRecords.length ? (
              <div className="py-16 text-center text-sm text-zinc-500">
                {loading ? (t('common.loading') || 'Loading…') : (t('quality.no_records') || 'No quality records found for this period.')}
              </div>
            ) : (
              <table className="w-full min-w-[920px] text-left text-xs divide-y divide-zinc-100">
                <thead className="bg-zinc-50/50">
                  <tr className="text-zinc-500">
                    <th className="py-2.5 px-4 font-medium w-[140px]">{t('quality.col_time_service') || 'Time / Service'}</th>
                    <th className="py-2.5 px-3 font-medium min-w-[180px] max-w-[240px]">{t('quality.col_prompt') || 'Prompt / User Intent'}</th>
                    <th className="py-2.5 px-3 font-medium min-w-[150px]">{t('quality.col_model') || 'Routed Model'}</th>
                    <th className="py-2.5 px-3 font-medium min-w-[160px]">{t('quality.col_verdict') || 'Quality Verdict'}</th>
                    <th className="py-2.5 px-3 font-medium w-[140px]">{t('quality.col_source') || 'Feedback Source'}</th>
                    <th className="py-2.5 px-3 text-right font-medium w-[100px]">{t('quality.col_tokens_latency') || 'Tokens / Latency'}</th>
                    <th className="py-2.5 px-4 text-right font-medium w-[80px]">{t('quality.col_cost') || 'Cost'}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100 bg-white">
                  {paginatedRecords.map((r) => {
                    const cleanService = r.service_name.replace(/^[0-9a-fA-F-]{36,37}-/, '')
                    const cleanProvider = r.provider_name.replace(/^saas-[0-9a-fA-F-]{36}/, 'DeepSeek').replace(/^saas-/, '')
                    return (
                      <tr key={r.id} className="hover:bg-zinc-50/70 transition-colors">
                        <td className="py-3 px-4 align-middle whitespace-nowrap">
                          <div className="font-semibold text-zinc-900 truncate">{cleanService}</div>
                          <div className="text-[10px] text-zinc-400">{r.timestamp}</div>
                        </td>
                        <td className="py-3 px-3 align-middle max-w-[240px]">
                          <div className="font-mono text-zinc-800 text-[11px] truncate" title={r.prompt_preview}>
                            {r.prompt_preview || '—'}
                          </div>
                        </td>
                        <td className="py-3 px-3 align-middle whitespace-nowrap">
                          <div className="font-semibold text-zinc-900">{r.model}</div>
                          <div className="text-[10px] text-zinc-400 truncate max-w-[140px]">{cleanProvider}</div>
                        </td>
                        <td className="py-3 px-3 align-middle whitespace-nowrap">
                          <span
                            className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                              r.verdict === 'escalated'
                                ? 'bg-amber-50 text-amber-800 border border-amber-200'
                                : r.verdict === 'schema_valid'
                                ? 'bg-blue-50 text-blue-700 border border-blue-200'
                                : r.verdict === 'error'
                                ? 'bg-red-50 text-red-700 border border-red-200'
                                : 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                            }`}
                            title={r.verdict_desc}
                          >
                            {r.verdict === 'escalated'
                              ? `🔄 ${t('quality.verdict_escalated') || 'Escalated'}`
                              : r.verdict === 'schema_valid'
                              ? `🛠️ ${t('quality.verdict_schema') || 'Schema Valid'}`
                              : r.verdict === 'error'
                              ? `⚠️ ${t('quality.verdict_error') || 'Error'}`
                              : `✓ ${t('quality.verdict_completed') || 'Completed'}`}
                          </span>
                        </td>
                        <td className="py-3 px-3 align-middle whitespace-nowrap">
                          <span className="inline-flex items-center rounded-md bg-zinc-100 px-1.5 py-0.5 text-[10px] font-medium text-zinc-700 border border-zinc-200/60">
                            {r.feedback_source}
                          </span>
                        </td>
                        <td className="py-3 px-3 align-middle text-right whitespace-nowrap">
                          <div className="font-medium text-zinc-900">{r.total_tokens.toLocaleString()} tok</div>
                          <div className="text-[10px] text-zinc-400">{r.latency_ms}ms</div>
                        </td>
                        <td className="py-3 px-4 align-middle text-right whitespace-nowrap font-semibold text-zinc-900 font-mono">
                          ${r.cost.toFixed(4)}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}
          </div>

          {totalFiltered > 0 && (
            <div className="border-t border-zinc-100 bg-zinc-50/70 px-5 py-3 flex flex-wrap items-center justify-between gap-3 text-xs text-zinc-500 select-none min-h-[52px]">
              <div className="flex items-center gap-3">
                <span className="whitespace-nowrap tabular-nums">
                  {t('pagination.showing', { start: startIndex + 1, end: Math.min(startIndex + pageSize, totalFiltered), total: totalFiltered }) || `Showing ${startIndex + 1}–${Math.min(startIndex + pageSize, totalFiltered)} of ${totalFiltered} records`}
                </span>
                <div className="w-32 min-w-[125px]">
                  <Select
                    size="sm"
                    direction="up"
                    options={[
                      { id: '10', name: t('pagination.per_page', { count: 10 }) || '10 / page' },
                      { id: '15', name: t('pagination.per_page', { count: 15 }) || '15 / page' },
                      { id: '25', name: t('pagination.per_page', { count: 25 }) || '25 / page' },
                      { id: '50', name: t('pagination.per_page', { count: 50 }) || '50 / page' },
                    ]}
                    selected={{ id: String(pageSize), name: t('pagination.per_page', { count: pageSize }) || `${pageSize} / page` }}
                    onChange={(opt) => {
                      setPageSize(Number(opt.id))
                      setPage(1)
                    }}
                  />
                </div>
              </div>

              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  disabled={currentPage <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  className="inline-flex h-8 w-8 min-w-[32px] max-w-[32px] shrink-0 items-center justify-center rounded-lg border border-zinc-200 bg-white text-zinc-600 transition hover:bg-zinc-100 disabled:opacity-40 disabled:pointer-events-none"
                  aria-label={t('pagination.prev') || 'Previous page'}
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>

                <div className="flex items-center gap-1">
                  {(() => {
                    const items: (number | string)[] = []
                    if (totalPages <= 7) {
                      for (let i = 1; i <= totalPages; i++) items.push(i)
                    } else if (currentPage <= 4) {
                      items.push(1, 2, 3, 4, 5, '…', totalPages)
                    } else if (currentPage >= totalPages - 3) {
                      items.push(1, '…', totalPages - 4, totalPages - 3, totalPages - 2, totalPages - 1, totalPages)
                    } else {
                      items.push(1, '…', currentPage - 1, currentPage, currentPage + 1, '…', totalPages)
                    }

                    return items.map((item, idx) =>
                      typeof item === 'number' ? (
                        <button
                          key={`page-${item}`}
                          type="button"
                          onClick={() => setPage(item)}
                          className={`h-8 w-8 min-w-[32px] max-w-[32px] shrink-0 flex items-center justify-center rounded-lg text-xs font-medium tabular-nums transition-colors ${
                            currentPage === item
                              ? 'bg-zinc-900 text-white shadow-sm font-semibold'
                              : 'bg-white text-zinc-600 border border-zinc-200 hover:bg-zinc-100'
                          }`}
                        >
                          {item}
                        </button>
                      ) : (
                        <span key={`ellipsis-${idx}`} className="h-8 w-8 min-w-[32px] max-w-[32px] shrink-0 flex items-center justify-center text-xs text-zinc-400 select-none">
                          {item}
                        </span>
                      )
                    )
                  })()}
                </div>

                <button
                  type="button"
                  disabled={currentPage >= totalPages}
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  className="inline-flex h-8 w-8 min-w-[32px] max-w-[32px] shrink-0 items-center justify-center rounded-lg border border-zinc-200 bg-white text-zinc-600 transition hover:bg-zinc-100 disabled:opacity-40 disabled:pointer-events-none"
                  aria-label={t('pagination.next') || 'Next page'}
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
  const { t } = useI18n()
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
      <div className="flex items-start justify-between gap-4"><div><h2 id="profile-title" className="text-lg font-semibold">{t('profile.title') || 'Edit profile'}</h2><p className="mt-1 text-sm text-zinc-500">{t('profile.subtitle') || 'Update your account information.'}</p></div><button type="button" onClick={onClose} className="rounded-lg p-2 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-950" aria-label="Close"><X className="h-5 w-5" /></button></div>
      <div className="mt-6 space-y-5"><Field label={t('profile.email') || 'Email'} value={updatedEmail} onChange={setUpdatedEmail} type="email" /><Field label={t('profile.new_password') || 'New password (optional)'} value={newPassword} onChange={setNewPassword} type="password" required={false} placeholder={t('profile.new_password_placeholder') || 'Leave blank to keep your password'} /><Field label={t('profile.current_password') || 'Current password'} value={currentPassword} onChange={setCurrentPassword} type="password" placeholder={t('profile.current_password_placeholder') || 'Required to save changes'} /></div>
      {error && <div className="mt-4"><ErrorMessage text={error} /></div>}
      <div className="mt-6 flex justify-end gap-3"><button type="button" onClick={onClose} className="rounded-lg border border-zinc-300 px-4 py-2.5 text-sm text-zinc-600">{t('common.cancel') || 'Cancel'}</button><button disabled={busy} className="rounded-lg bg-zinc-950 px-5 py-2.5 text-sm text-white disabled:opacity-50">{busy ? (t('common.saving') || 'Saving…') : (t('common.save') || 'Save changes')}</button></div>
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

export function formatMaskedKey(prefix: string) {
  if (!prefix) return '••••••••'
  if (prefix.includes('...') || prefix.includes('••••')) {
    const parts = prefix.split(/\.\.\.|\•+/).filter(Boolean)
    if (parts.length >= 2) {
      return `${parts[0]}••••••••${parts[1]}`
    }
  }
  return `${prefix}••••••••`
}
