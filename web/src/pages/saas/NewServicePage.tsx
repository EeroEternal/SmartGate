import { FormEvent, useState } from 'react'
import { CheckCircle2 } from 'lucide-react'
import { Link, useNavigate } from 'react-router-dom'
import { saasFetch } from '../../lib/saasApi'
import { useI18n } from '../../lib/i18n'
import { ErrorMessage, Field, Page, errorText } from './components'
import { StrategyMatrixCardSelector, WorkloadPresetSelector } from './ServiceSelectors'

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
          <h1 className="text-xl font-semibold tracking-tight">{t('services.create_title')}</h1>
        </div>

        <Field label={t('services.name_label')} value={name} onChange={setName} placeholder="fusion" />

        <StrategyMatrixCardSelector selectedStrategy={strategy} onSelect={setStrategy} />

        {strategy === 'capability_aware' && (
          <WorkloadPresetSelector selectedPreset={preset} onSelectPreset={setPreset} />
        )}

        <div className="flex gap-3 rounded-lg bg-surface-200 px-4 py-3 text-sm text-zinc-600">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
          <span>{t('services.create_tip')}</span>
        </div>
      </div>
      {error && <ErrorMessage text={error} />}
      <div className="flex justify-end gap-3">
        <Link to="/app/services" className="rounded-lg border border-zinc-300 px-4 py-2.5 text-sm text-zinc-600 hover:bg-zinc-50 transition-colors">
          {t('common.cancel')}
        </Link>
        <button disabled={busy} className="rounded-lg bg-zinc-950 px-5 py-2.5 text-sm text-white hover:bg-zinc-800 transition-colors disabled:opacity-50">
          {busy ? (t('common.creating')) : (t('services.create_button'))}
        </button>
      </div>
    </form>
  </Page>
}
