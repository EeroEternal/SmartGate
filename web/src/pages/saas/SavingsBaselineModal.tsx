import { FormEvent, useEffect, useState } from 'react'
import { X } from 'lucide-react'
import { saasFetch } from '../../lib/saasApi'
import Select from '../../components/Select'
import { useI18n } from '../../lib/i18n'
import { formatMoney } from '../../lib/format'
import { useModal } from '../../lib/modal'
import { ErrorMessage, Field, errorText } from './components'
import type { SavingsBaseline, ServiceDetails } from './types'

export function SavingsBaselineModal({ services, baseline, onClose, onSaved }: { services: ServiceDetails[]; baseline: SavingsBaseline | null; onClose: () => void; onSaved: (baseline: SavingsBaseline) => void }) {
  const { t } = useI18n()
  const dialogRef = useModal({ onClose })
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

  return <div ref={dialogRef} className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/30 p-4" role="dialog" aria-modal="true"><form onSubmit={submit} className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl"><div className="flex items-start justify-between gap-4"><div><h2 className="text-lg font-semibold">{t('usage.baseline_modal_title')}</h2><p className="mt-1 text-sm text-zinc-500">{t('usage.baseline_modal_desc')}</p></div><button type="button" onClick={onClose} className="rounded-lg p-2 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-950" aria-label="Close"><X className="h-5 w-5" /></button></div>{services.length ? <div className="mt-6 space-y-5"><Select label={t('services.service_label')} options={services.map((item) => ({ id: item.id, name: item.name }))} selected={service ? { id: service.id, name: service.name } : { id: '', name: t('usage.select_service') }} onChange={(option) => setServiceId(String(option.id))} /><Select label={t('usage.model_endpoint_label')} options={(service?.endpoints || []).map((item) => ({ id: item.id, name: `${item.model} — ${item.provider_name}` }))} selected={endpoint ? { id: endpoint.id, name: `${endpoint.model} — ${endpoint.provider_name}` } : { id: '', name: t('services.select_model') }} onChange={(option) => setEndpointId(String(option.id))} />{endpoint && <div className="space-y-0.5 rounded-lg bg-zinc-50 px-3 py-2 text-xs text-zinc-500"><div>{t('services.input_price')}: {formatMoney(endpoint.input_price_per_1m)}/1M</div><div>{t('services.output_price')}: {formatMoney(endpoint.output_price_per_1m)}/1M</div></div>}<p className="text-xs text-zinc-500">{t('usage.baseline_price_note')}</p></div> : <div className="mt-6 rounded-lg bg-amber-50 px-3 py-3 text-sm text-amber-800">{t('usage.create_service_first')}</div>}{error && <div className="mt-4"><ErrorMessage text={error} /></div>}<div className="mt-6 flex justify-end gap-3"><button type="button" onClick={onClose} className="rounded-lg border border-zinc-300 px-4 py-2.5 text-sm text-zinc-600">{t('common.cancel')}</button><button disabled={busy || !services.length} className="rounded-lg bg-zinc-950 px-5 py-2.5 text-sm text-white disabled:opacity-50">{busy ? (t('common.saving')) : (t('usage.save_baseline'))}</button></div></form></div>
}

