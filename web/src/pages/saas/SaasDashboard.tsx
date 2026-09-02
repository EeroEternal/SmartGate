import { useEffect, useState } from 'react'
import { ArrowUpRight, CheckCircle2, HelpCircle, KeyRound, Route, Sparkles } from 'lucide-react'
import { Link } from 'react-router-dom'
import { saasFetch } from '../../lib/saasApi'
import { SaasLayout } from './SaasPages'
import { useI18n } from '../../lib/i18n'

interface Service { id: string; name: string; endpoint_count?: number; strategy: string; health_status: string }
interface Provider { id: string }
interface ApiKey { id: string }

interface Usage { requests: number; total_tokens: number; estimated_spend: number; success_rate: number; trimmed_chars: number; budget: { status: string; spent_today: number; daily_limit: number | null; remaining_today: number | null } }

const money = (value = 0) => `$${value.toFixed(4)}`
const compactTokens = (value = 0) => {
  if (value >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(2)}B`
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`
  if (value >= 10_000) return `${(value / 1_000).toFixed(1)}k`
  return value.toLocaleString()
}

export default function SaasDashboard() {
  const { t } = useI18n()
  const [services, setServices] = useState<Service[]>([])
  const [providers, setProviders] = useState<Provider[]>([])
  const [keys, setKeys] = useState<ApiKey[]>([])
  const [usage, setUsage] = useState<Usage | null>(null)
  const [error, setError] = useState('')

  const routingLabels: Record<string, string> = {
    cost_aware: t('services.routing_cost') || 'Cost-first routing',
    capability_aware: t('services.routing_capability') || 'Capability-first routing',
    load_aware: t('services.routing_load') || 'Load-balanced routing',
    round_robin: t('services.routing_round_robin') || 'Even distribution',
  }
  const routingLabel = (strategy: string) => routingLabels[strategy] || (t('services.routing_standard') || 'Standard routing')
  const serviceStatus = (status: string) => status === 'draft' ? (t('services.setup_needed') || 'Setup needed') : (t('services.ready') || 'Ready')

  useEffect(() => {
    Promise.all([
      saasFetch<Service[]>('/api/saas/model-services'),
      saasFetch<Usage>('/api/saas/usage?range=30d'),
      saasFetch<Provider[]>('/api/saas/providers'),
      saasFetch<ApiKey[]>('/api/saas/api-keys'),
    ])
      .then(([s, u, p, k]) => {
        setServices(s.data || [])
        setUsage(u.data || null)
        setProviders(p.data || [])
        setKeys(k.data || [])
      })
      .catch((e) => setError(e.message))
  }, [])

  const hasProviders = providers.length > 0
  const draftService = services.find((service) => (service.endpoint_count || 0) === 0 || service.health_status === 'draft')
  const hasReadyService = services.some((service) => (service.endpoint_count || 0) > 0 && service.health_status !== 'draft')
  const hasKeys = keys.length > 0
  const hasTraffic = (usage?.requests || 0) > 0
  const setupSteps = [
    {
      done: hasProviders,
      title: t('overview.step1_title'),
      desc: t('overview.step1_desc'),
      href: '/app/providers',
      action: t('overview.step1_action'),
    },
    {
      done: hasReadyService,
      title: t('overview.step2_title'),
      desc: t('overview.step2_desc'),
      href: !services.length ? '/app/services/new' : draftService ? `/app/services/${draftService.id}` : '/app/services',
      action: t('overview.step2_action'),
    },
    {
      done: hasKeys,
      title: t('overview.step3_title'),
      desc: t('overview.step3_desc'),
      href: '/app/keys',
      action: t('overview.step3_action'),
    },
    {
      done: hasTraffic,
      title: t('overview.step4_title'),
      desc: t('overview.step4_desc'),
      href: '/app/codex',
      action: t('overview.step4_action'),
    },
  ]
  const doneCount = setupSteps.filter((step) => step.done).length
  const setupDone = doneCount === setupSteps.length

  return (
    <SaasLayout>
      <div>
        {error && <div className="mb-6 rounded-lg bg-rose-50 p-3 text-sm text-rose-700">{error}</div>}
        {!setupDone && (
          <section className="mb-6 rounded-xl border border-zinc-200 bg-white p-5">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <h2 className="font-semibold">{t('overview.quick_start')}</h2>
                <span title={t('overview.subtitle')} className="cursor-help text-zinc-400 hover:text-zinc-600">
                  <HelpCircle className="h-4 w-4" />
                </span>
              </div>
              <span className="text-xs text-zinc-400">{t('overview.progress', { done: doneCount, total: setupSteps.length })}</span>
            </div>
            <ol className="mt-4 space-y-2">
              {setupSteps.map((step, index) => (
                <li key={step.title}>
                  <Link
                    to={step.href}
                    className={`flex items-start gap-3 rounded-lg border px-3 py-3 transition-colors ${
                      step.done
                        ? 'border-zinc-100 bg-zinc-50/60 text-zinc-500'
                        : 'border-zinc-200 bg-white hover:border-zinc-300 hover:bg-zinc-50'
                    }`}
                  >
                    <span className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${step.done ? 'text-emerald-600' : 'bg-zinc-950 text-[11px] font-medium text-white'}`}>
                      {step.done ? <CheckCircle2 className="h-5 w-5" /> : index + 1}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className={`text-sm font-medium ${step.done ? 'text-zinc-500' : 'text-zinc-950'}`}>{step.title}</div>
                      <div className="mt-0.5 text-xs leading-5 text-zinc-500">{step.desc}</div>
                    </div>
                    {!step.done && <span className="shrink-0 self-center text-xs font-medium text-primary">{step.action} →</span>}
                  </Link>
                </li>
              ))}
            </ol>
          </section>
        )}
        <div className="grid sm:grid-cols-2 xl:grid-cols-4 gap-4">
          <Card title={t('usage.total_spend') || 'Estimated spend'} value={money(usage?.estimated_spend)} detail={t('overview.last_30_days') || 'last 30 days'} />
          <Card title={t('overview.total_requests') || 'Total requests'} value={(usage?.requests || 0).toLocaleString()} detail={t('overview.success_rate_detail', { rate: ((usage?.success_rate || 0) * 100).toFixed(1) }) || `${((usage?.success_rate || 0) * 100).toFixed(1)}% successful`} />
          <Card title={t('usage.tokens_consumed') || 'Tokens consumed'} value={compactTokens(usage?.total_tokens || 0)} fullValue={(usage?.total_tokens || 0).toLocaleString()} detail={t('overview.input_output') || 'input + output'} />
          <Card title={t('overview.active_services') || 'Active model services'} value={services.length.toString()} detail={t('overview.personal_services') || 'personal model services'} />
        </div>
        <div className="mt-6 grid xl:grid-cols-2 gap-6">
          <section className="bg-white border border-zinc-200 rounded-xl p-5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <h2 className="font-semibold">{t('services.title') || 'Model services'}</h2>
              </div>
              <Link to="/app/services" className="text-xs text-zinc-500 hover:text-zinc-950">
                {t('common.view_all') || 'View all'} <ArrowUpRight className="inline w-3 h-3" />
              </Link>
            </div>
            {services.length ? (
              <div className="mt-5 space-y-3">
                {services.slice(0, 4).map((service) => (
                  <Link key={service.id} to={`/app/services/${service.id}`} className="flex items-center justify-between rounded-lg border border-zinc-100 px-3 py-3 transition-colors hover:border-zinc-300 hover:bg-zinc-50 focus:outline-none focus:ring-2 focus:ring-primary/30">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-lg bg-zinc-100 flex items-center justify-center">
                        <Route className="w-4 h-4" />
                      </div>
                      <div>
                        <div className="text-sm font-medium">{service.name}</div>
                        <div className="mt-1 space-y-1 text-xs text-zinc-500">
                          <div>{(service.endpoint_count || 0) === 1 ? t('services.providers_connected_single') : t('services.providers_connected', { count: service.endpoint_count || 0 })}</div>
                          <div>{routingLabel(service.strategy)}</div>
                        </div>
                      </div>
                    </div>
                    <span className={`text-xs ${service.health_status === 'draft' ? 'text-amber-600' : 'text-emerald-600'}`}>
                      {serviceStatus(service.health_status || 'ready')}
                    </span>
                  </Link>
                ))}
              </div>
            ) : (
              <Empty text={t('services.connect_first') || 'Connect your first model service.'} href="/app/services/new" />
            )}
          </section>
          <section className="sg-dark-surface text-white rounded-xl p-5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Sparkles className="w-4 h-4" />
                <h2 className="font-semibold">{t('usage.title') || 'Usage'}</h2>
              </div>
            </div>
            <div className="mt-7 space-y-4">
              <div className="flex justify-between text-sm">
                <span className="text-zinc-400">{t('usage.budget_limit') || 'Budget limit'}</span>
                <span>{usage?.budget?.daily_limit ? `${money(usage.budget.spent_today)} / ${money(usage.budget.daily_limit)}` : (t('usage.no_limit') || 'No limit set')}</span>
              </div>
              <div className="h-2 bg-zinc-800 rounded-full">
                <div className="h-full bg-white rounded-full" style={{ width: `${Math.min((usage?.budget?.daily_limit ? usage.budget.spent_today / usage.budget.daily_limit : 0) * 100, 100)}%` }} />
              </div>
              <div className="text-xs text-zinc-500">
                {usage?.trimmed_chars ? `${usage.trimmed_chars.toLocaleString()} ${t('usage.trimmed_chars') || 'context characters trimmed.'}` : (t('usage.no_trimming') || 'No context trimming recorded yet.')}
              </div>
            </div>
          </section>
        </div>
        <div className="mt-6 rounded-xl border border-zinc-200 bg-white p-5 flex items-center gap-4">
          <KeyRound className="w-5 h-5" />
          <div className="flex-1">
            <div className="text-sm font-medium">{t('keys.ready_to_connect') || 'Ready to connect an app?'}</div>
            <div className="text-xs text-zinc-500 mt-1">{t('keys.ready_desc') || 'Create an API key and connect using OpenAI Chat, OpenAI Responses, or Anthropic Messages.'}</div>
          </div>
          <Link to={hasKeys ? '/app/codex' : '/app/keys'} className="text-sm font-medium">
            {hasKeys ? (t('overview.step4_action') || 'View setup') : (t('keys.manage_keys') || 'Manage keys')} <ArrowUpRight className="inline w-3 h-3" />
          </Link>
        </div>
      </div>
    </SaasLayout>
  )
}
function Card({ title, value, detail, fullValue }: { title: string; value: string; detail: string; fullValue?: string }) { return <div className="bg-white border border-zinc-200 rounded-xl p-5"><div className="text-xs text-zinc-500">{title}</div><div className="mt-2 text-2xl font-mono font-semibold tabular-nums truncate" title={fullValue || value}>{value}</div><div className="mt-1 text-xs text-zinc-400">{detail}</div></div> }
function Empty({ text, href }: { text: string; href: string }) { return <Link to={href} className="mt-5 block rounded-lg border border-dashed border-zinc-300 p-5 text-sm text-zinc-500 hover:border-zinc-500">{text} <ArrowUpRight className="inline w-4 h-4" /></Link> }


