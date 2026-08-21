import { useEffect, useState } from 'react'
import { Activity, ArrowUpRight, KeyRound, Plus, Route, Sparkles } from 'lucide-react'
import { Link } from 'react-router-dom'
import { saasFetch } from '../../lib/saasApi'
import { SaasLayout } from './SaasPages'
import { useI18n } from '../../lib/i18n'

interface Service { id: string; name: string; endpoint_count?: number; strategy: string; health_status: string }

const routingLabels: Record<string, string> = { cost_aware: 'Cost-first routing', capability_aware: 'Capability-first routing', load_aware: 'Load-balanced routing', round_robin: 'Even distribution' }
const routingLabel = (strategy: string) => routingLabels[strategy] || 'Standard routing'
const serviceStatus = (status: string) => status === 'draft' ? 'Setup needed' : 'Ready'
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
    ])
      .then(([s, u]) => {
        setServices(s.data || [])
        setUsage(u.data || null)
      })
      .catch((e) => setError(e.message))
  }, [])

  return (
    <SaasLayout>
      <div>
        <div className="flex justify-end">
          <Link to="/app/services/new" className="inline-flex items-center gap-2 rounded-lg bg-zinc-950 px-4 py-2.5 text-sm text-white">
            <Plus className="w-4 h-4" /> {t('services.create_button') || 'Add service'}
          </Link>
        </div>
        {error && <div className="mt-6 rounded-lg bg-rose-50 p-3 text-sm text-rose-700">{error}</div>}
        <div className="mt-8 grid sm:grid-cols-2 xl:grid-cols-4 gap-4">
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
          <Link to="/app/keys" className="text-sm font-medium">
            {t('keys.manage_keys') || 'Manage keys'} <ArrowUpRight className="inline w-3 h-3" />
          </Link>
        </div>
      </div>
    </SaasLayout>
  )
}
function Card({ title, value, detail, fullValue }: { title: string; value: string; detail: string; fullValue?: string }) { return <div className="bg-white border border-zinc-200 rounded-xl p-5"><div className="text-xs text-zinc-500">{title}</div><div className="mt-2 text-2xl font-mono font-semibold tabular-nums truncate" title={fullValue || value}>{value}</div><div className="mt-1 text-xs text-zinc-400">{detail}</div></div> }
function Empty({ text, href }: { text: string; href: string }) { return <Link to={href} className="mt-5 block rounded-lg border border-dashed border-zinc-300 p-5 text-sm text-zinc-500 hover:border-zinc-500">{text} <ArrowUpRight className="inline w-4 h-4" /></Link> }


