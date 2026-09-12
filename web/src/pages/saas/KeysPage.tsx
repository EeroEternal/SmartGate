import { FormEvent, useEffect, useState } from 'react'
import { Activity, CheckCheck, Copy, Download, Pencil, Plus, Sparkles, Trash2, X } from 'lucide-react'
import { saasFetch } from '../../lib/saasApi'
import Select from '../../components/Select'
import { useDialog } from '../../components/Dialog'
import { useI18n } from '../../lib/i18n'
import { formatMoney } from '../../lib/format'
import { useModal } from '../../lib/modal'
import { Empty, ErrorMessage, Field, Page, errorText, formatMaskedKey } from './components'
import { cleanServiceName } from './serviceUtils'
import type { Service } from './types'

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
export function KeysPage() {
  const { t } = useI18n()
  const [keys, setKeys] = useState<Key[]>([])
  const [services, setServices] = useState<Service[]>([])
  const { dialog, showConfirm } = useDialog()
  const [raw, setRaw] = useState('')
  const [createdServiceNames, setCreatedServiceNames] = useState<string[]>([])
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
    setCreatedServiceNames(services.filter((service) => modelServiceIds.includes(service.id)).map((service) => cleanServiceName(service.name)))
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
    if (!await showConfirm(t('keys.revoke_confirm_msg'), t('keys.revoke_confirm_title'))) return
    try { await saasFetch(`/api/saas/api-keys/${id}/revoke`, { method: 'POST' }); load() } catch (e) { setError(errorText(e)) }
  }
  async function remove(id: string) {
    if (!await showConfirm(t('keys.delete_confirm_msg'), t('keys.delete_confirm_title'))) return
    try { await saasFetch(`/api/saas/api-keys/${id}`, { method: 'DELETE' }); load() } catch (e) { setError(errorText(e)) }
  }

  return (
    <Page
      action={
        <button
          type="button"
          onClick={() => { setError(''); setModalOpen(true) }}
          className="inline-flex items-center gap-2 rounded-lg bg-zinc-950 px-4 py-2.5 text-sm text-white shadow-sm hover:bg-zinc-800 transition-colors"
        >
          <Plus className="h-4 w-4" /> {t('keys.create_button')}
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
        services.length ? (
          <div className="rounded-xl border border-dashed border-zinc-300 bg-white p-8 text-center text-sm text-zinc-500">
            {t('keys.no_keys')}
          </div>
        ) : (
          <Empty text={t('keys.need_service')} href="/app/services/new" />
        )
      ) : (
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3">
          {keys.map((key) => {
            const masked = formatMaskedKey(key.prefix)
            const serviceCount = key.model_services?.length || 0
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
                      {key.enabled ? (t('keys.active')) : (t('keys.revoked'))}
                    </span>
                  </div>

                  {/* Key metadata badges matching service/provider card styles */}
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <span className="inline-flex items-center gap-1.5 rounded-md bg-zinc-100 px-2 py-0.5 text-xs font-mono text-zinc-700 border border-zinc-200/60" title={t('keys.key_prefix')}>
                      <span className="text-[10px] font-sans text-zinc-400 uppercase font-semibold">Key:</span>
                      {masked}
                    </span>
                    <span className="inline-flex items-center gap-1 rounded-md bg-purple-50 px-2 py-0.5 text-xs font-medium text-purple-700 border border-purple-200/70">
                      <Sparkles className="h-3 w-3" />
                      {serviceCount > 0 ? `${serviceCount} ${serviceCount === 1 ? 'Service' : 'Services'}` : 'All Services'}
                    </span>
                  </div>

                  {/* Authorized Model Services List */}
                  <div className="mt-3.5 pt-3 border-t border-zinc-100">
                    <div className="text-[11px] font-medium text-zinc-400 uppercase tracking-wider mb-1.5">
                      {t('keys.authorized_services')}
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {key.model_services?.length ? (
                        key.model_services.map((service) => {
                          const cleanName = cleanServiceName(service.name)
                          return (
                            <span
                              key={service.id}
                              className="inline-flex items-center rounded-md bg-zinc-50 border border-zinc-200 px-2 py-0.5 text-xs font-medium text-zinc-800"
                              title={cleanName}
                            >
                              {cleanName}
                            </span>
                          )
                        })
                      ) : (
                        <span className="text-xs text-zinc-400 italic">
                          {t('keys.all_services_legacy')}
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
                    {t('keys.workload_profile')}
                  </button>
                  {key.enabled && (
                    <button
                      type="button"
                      onClick={() => setEditingKey(key)}
                      className="inline-flex items-center gap-1 font-medium text-zinc-600 hover:text-zinc-950 transition-colors"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                      {t('keys.edit')}
                    </button>
                  )}
                  {key.enabled && (
                    <button
                      type="button"
                      onClick={() => revoke(key.id)}
                      className="font-medium text-amber-600 hover:text-amber-700 transition-colors"
                    >
                      {t('keys.revoke')}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => remove(key.id)}
                    className="inline-flex items-center gap-1 font-medium text-rose-500 hover:text-rose-700 transition-colors"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    {t('keys.delete')}
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
  const dialogRef = useModal({ onClose })
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

  return <div ref={dialogRef} className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/30 p-4" role="dialog" aria-modal="true">
    <div className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl">
      <div className="flex items-start justify-between gap-4">
        <div><h2 className="text-lg font-semibold text-zinc-950">{t('keys.profile_title')}</h2><p className="mt-1 text-sm font-medium text-zinc-600">{keyData.name}</p><p className="mt-1 text-sm text-zinc-500">{t('keys.profile_subtitle')}</p></div>
        <button type="button" onClick={onClose} className="rounded-lg p-2 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-950" aria-label={t('common.close')}><X className="h-5 w-5" /></button>
      </div>
      <div className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-zinc-100 bg-zinc-50 p-3">
        <div className="text-xs text-zinc-500">{t('keys.profile_window')}</div>
        <Select size="sm" options={[{ id: '24h', name: t('analytics.last_24h') }, { id: '7d', name: t('analytics.last_7d') }, { id: '30d', name: t('analytics.last_30d') }, { id: 'all', name: t('analytics.all_time') }]} selected={{ id: range, name: range === '24h' ? (t('analytics.last_24h')) : range === '7d' ? (t('analytics.last_7d')) : range === '30d' ? (t('analytics.last_30d')) : (t('analytics.all_time')) }} onChange={(option) => setRange(String(option.id) as typeof range)} className="w-40" />
      </div>
      {loading && <div className="py-12 text-center text-sm text-zinc-500">{t('keys.profile_loading')}</div>}
      {error && <div className="mt-5"><ErrorMessage text={error} /></div>}
      {!loading && !error && profile && <div className="mt-5 space-y-5">
        <div className="grid gap-3 sm:grid-cols-4">
          <ProfileMetric label={t('keys.profile_samples')} value={profile.sample_count.toLocaleString()} />
          <ProfileMetric label={t('keys.profile_confidence')} value={profile.confidence.replace('_', ' ')} />
          <ProfileMetric label={t('keys.profile_success_rate')} value={rate(profile.requests.success_rate)} />
          <ProfileMetric label={t('keys.profile_last_observed')} value={profile.last_observed_at || 'N/A'} />
        </div>
        <div className="grid gap-5 md:grid-cols-2">
          <section className="rounded-xl border border-zinc-200 p-4"><h3 className="text-sm font-semibold text-zinc-900">{t('keys.profile_requests')}</h3><div className="mt-3 grid grid-cols-3 gap-2"><ProfileMetric label={t('keys.profile_total')} value={profile.requests.total.toLocaleString()} /><ProfileMetric label={t('keys.profile_successful')} value={profile.requests.successful.toLocaleString()} /><ProfileMetric label={t('keys.profile_failed')} value={profile.requests.failed.toLocaleString()} /></div></section>
          <section className="rounded-xl border border-zinc-200 p-4"><h3 className="text-sm font-semibold text-zinc-900">{t('keys.profile_latency')}</h3><div className="mt-3 grid grid-cols-2 gap-2"><ProfileMetric label="P50" value={latency(profile.latency_ms.p50)} /><ProfileMetric label="P95" value={latency(profile.latency_ms.p95)} /><ProfileMetric label="TTFT P95" value={latency(profile.latency_ms.ttft_p95)} /><ProfileMetric label={t('keys.profile_average')} value={latency(profile.latency_ms.average)} /></div></section>
        </div>
        <div className="grid gap-5 md:grid-cols-2">
          <section className="rounded-xl border border-zinc-200 p-4"><h3 className="text-sm font-semibold text-zinc-900">{t('keys.profile_tokens_cost')}</h3><div className="mt-3 grid grid-cols-2 gap-2"><ProfileMetric label={t('keys.profile_total_tokens')} value={profile.tokens.total.toLocaleString()} /><ProfileMetric label={t('keys.profile_avg_tokens')} value={profileNumber(profile.tokens.average_per_request)} /><ProfileMetric label={t('keys.profile_total_cost')} value={formatMoney(profile.cost.total)} /><ProfileMetric label={t('keys.profile_avg_cost')} value={profile.cost.average_per_request == null ? 'N/A' : formatMoney(profile.cost.average_per_request)} /></div></section>
          <section className="rounded-xl border border-zinc-200 p-4"><h3 className="text-sm font-semibold text-zinc-900">{t('keys.profile_behavior')}</h3><div className="mt-3 grid grid-cols-2 gap-2"><ProfileMetric label={t('keys.profile_tools')} value={rate(profile.workload.tool_request_rate)} /><ProfileMetric label={t('keys.profile_fallbacks')} value={rate(profile.workload.fallback_rate)} /><ProfileMetric label={t('keys.profile_sessions')} value={rate(profile.workload.session_rate)} /><ProfileMetric label={t('keys.profile_affinity')} value={rate(profile.workload.affinity_hit_rate)} /></div></section>
        </div>
        <div className="grid gap-5 md:grid-cols-4"><ProfileBreakdown title={t('keys.profile_difficulty')} values={profile.workload.difficulty_tiers} /><ProfileBreakdown title={t('keys.profile_difficulty_sources')} values={profile.workload.difficulty_sources} /><ProfileBreakdown title={t('keys.profile_providers')} values={profile.providers} /><ProfileBreakdown title={t('keys.profile_usage_sources')} values={profile.cost.usage_sources} /></div>
        <div className="rounded-lg border border-amber-100 bg-amber-50 px-3 py-2.5 text-xs text-amber-800">{t('keys.profile_quality_unavailable')}</div>
      </div>}
    </div>
  </div>
}

function EditKeyModal({ keyData, services, existingNames, onClose, onUpdate }: { keyData: Key; services: Service[]; existingNames: string[]; onClose: () => void; onUpdate: (id: string, name: string, modelServiceIds: string[]) => Promise<void> }) {
  const dialogRef = useModal({ onClose })
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
  return <div ref={dialogRef} className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/30 p-4" role="dialog" aria-modal="true">
    <form onSubmit={submit} className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold">Edit API key</h2>
          <p className="mt-1 text-sm text-zinc-500">Update the services this key can call.</p>
        </div>
        <button type="button" onClick={onClose} className="rounded-lg p-2 text-zinc-400 hover:bg-zinc-100" aria-label="Close"><X className="h-5 w-5" /></button>
      </div>
      <div className="mt-6 space-y-5">
        <Field label="Key name" value={name} onChange={setName} placeholder="Production app" />
        <fieldset>
          <legend className="text-sm font-medium text-zinc-700">Model services</legend>
          <p className="mt-1 text-xs text-zinc-500">Requests must use one of the selected service names as the <code>model</code> value.</p>
          <div className="mt-3 max-h-52 space-y-2 overflow-y-auto rounded-lg border border-zinc-200 p-3">
            {services.length ? (
              services.map((service) => (
                <label key={service.id} className="flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 hover:bg-zinc-50">
                  <input
                    type="checkbox"
                    checked={selected.includes(service.id)}
                    onChange={() => toggle(service.id)}
                    className="h-4 w-4 accent-zinc-950"
                  />
                  <span className="text-sm text-zinc-700">{cleanServiceName(service.name)}</span>
                </label>
              ))
            ) : (
              <p className="px-3 py-2 text-sm text-zinc-500">Create a model service before editing this key.</p>
            )}
          </div>
        </fieldset>
      </div>
      {error && <div className="mt-4"><ErrorMessage text={error} /></div>}
      <div className="mt-6 flex justify-end gap-3">
        <button type="button" onClick={onClose} className="rounded-lg border border-zinc-300 px-4 py-2.5 text-sm text-zinc-600">Cancel</button>
        <button disabled={busy || !services.length} className="rounded-lg bg-zinc-950 px-5 py-2.5 text-sm text-white disabled:opacity-50">{busy ? 'Saving…' : 'Save changes'}</button>
      </div>
    </form>
  </div>
}

function CreateKeyModal({ services, existingNames, onClose, onCreate }: { services: Service[]; existingNames: string[]; onClose: () => void; onCreate: (name: string, modelServiceIds: string[]) => Promise<void> }) {
  const dialogRef = useModal({ onClose })
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
  return <div ref={dialogRef} className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/30 p-4" role="dialog" aria-modal="true">
    <form onSubmit={submit} className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold">Create API key</h2>
          <p className="mt-1 text-sm text-zinc-500">This key can call the selected model services.</p>
        </div>
        <button type="button" onClick={onClose} className="rounded-lg p-2 text-zinc-400 hover:bg-zinc-100" aria-label="Close"><X className="h-5 w-5" /></button>
      </div>
      <div className="mt-6 space-y-5">
        <Field label="Key name" value={name} onChange={setName} placeholder="Production app" />
        <fieldset>
          <legend className="text-sm font-medium text-zinc-700">Model services</legend>
          <p className="mt-1 text-xs text-zinc-500">In each request, use the selected service name as the <code>model</code> value.</p>
          <div className="mt-3 max-h-52 space-y-2 overflow-y-auto rounded-lg border border-zinc-200 p-3">
            {services.length ? (
              services.map((service) => (
                <label key={service.id} className="flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 hover:bg-zinc-50">
                  <input
                    type="checkbox"
                    checked={selected.includes(service.id)}
                    onChange={() => toggle(service.id)}
                    className="h-4 w-4 accent-zinc-950"
                  />
                  <span className="text-sm text-zinc-700">{cleanServiceName(service.name)}</span>
                </label>
              ))
            ) : (
              <p className="px-3 py-2 text-sm text-zinc-500">Create a model service before creating an API key.</p>
            )}
          </div>
        </fieldset>
      </div>
      {error && <div className="mt-4"><ErrorMessage text={error} /></div>}
      <div className="mt-6 flex justify-end gap-3">
        <button type="button" onClick={onClose} className="rounded-lg border border-zinc-300 px-4 py-2.5 text-sm text-zinc-600">Cancel</button>
        <button disabled={busy || !services.length} className="rounded-lg bg-zinc-950 px-5 py-2.5 text-sm text-white disabled:opacity-50">{busy ? 'Creating…' : 'Create key'}</button>
      </div>
    </form>
  </div>
}

/// Success dialog shown right after an API key is created: reveal-once key with
/// copy/download actions and a ready-to-run request example.
function KeyCreatedModal({ rawKey, serviceNames, onClose }: { rawKey: string; serviceNames: string[]; onClose: () => void }) {
  const dialogRef = useModal({ onClose })
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
    <div ref={dialogRef} className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/30 p-4" role="dialog" aria-modal="true">
      <div className="max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-zinc-950">{t('keys.created_title')}</h2>
            <p className="mt-1 text-sm text-amber-700">{t('keys.created_notice')}</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-2 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-950" aria-label={t('common.close')}><X className="h-5 w-5" /></button>
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
            <Download className="h-4 w-4" /> {t('keys.download_key')}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg bg-zinc-950 px-5 py-2.5 text-sm text-white hover:bg-zinc-800"
          >
            {t('keys.done')}
          </button>
        </div>

        <div className="mt-6 border-t border-zinc-100 pt-5">
          <h3 className="text-sm font-semibold text-zinc-900">{t('keys.usage_title')}</h3>
          <p className="mt-1 text-xs text-zinc-500">
            {t('keys.usage_desc')}
          </p>
          <pre className="mt-3 whitespace-pre-wrap break-all rounded-lg bg-zinc-950 p-4 text-[11px] leading-relaxed text-zinc-100"><code>{curlExample}</code></pre>
        </div>
      </div>
    </div>
  )
}

