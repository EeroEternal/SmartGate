import { FormEvent, useEffect, useState } from 'react'
import { ShieldCheck, X } from 'lucide-react'
import { saasFetch } from '../../lib/saasApi'
import Select from '../../components/Select'
import { useI18n } from '../../lib/i18n'
import { useModal } from '../../lib/modal'
import { ErrorMessage, errorText } from './components'
import { StrategyMatrixCardSelector, WorkloadPresetSelector } from './ServiceSelectors'
import type { Service, ServiceDetails } from './types'

export function EditRoutingModal({ service, onClose, onSaved }: { service: ServiceDetails; onClose: () => void; onSaved: () => void }) {
  const { t } = useI18n()
  const dialogRef = useModal({ onClose })
  const [serviceName, setServiceName] = useState(service.name)
  const [nextStrategy, setNextStrategy] = useState(service.strategy)
  const [preset, setPreset] = useState('coding')
  const [judgeEnabled, setJudgeEnabled] = useState(Boolean(service.judge_enabled))
  const [judgeEndpointId, setJudgeEndpointId] = useState(service.judge_endpoint_id || service.endpoints[0]?.id || '')
  const [shadowEnabled, setShadowEnabled] = useState(Boolean(service.shadow_enabled))
  const [shadowSampleRate, setShadowSampleRate] = useState(service.shadow_sample_rate != null ? Math.round(service.shadow_sample_rate * 100) : 5)
  const [shadowVirtualModelId, setShadowVirtualModelId] = useState(service.shadow_virtual_model_id || '')
  const [serviceOptions, setServiceOptions] = useState<{ id: string; name: string }[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    saasFetch<Service[]>('/api/saas/model-services')
      .then((res) => {
        if (cancelled) return
        setServiceOptions((res.data || []).filter((svc) => svc.id !== service.id).map((svc) => ({ id: svc.name, name: svc.name })))
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [service.id])

  const judgeOptions = service.endpoints.map((ep) => ({
    id: ep.id,
    name: `${ep.provider_name} - ${ep.model}${ep.input_price_per_1m != null ? ` ($${ep.input_price_per_1m.toFixed(2)}/1M)` : ''}`,
  }))
  const selectedJudge = judgeOptions.find((opt) => opt.id === judgeEndpointId) || judgeOptions[0] || { id: '', name: 'No endpoints available' }
  const selectedShadowTarget = serviceOptions.find((opt) => opt.id === shadowVirtualModelId) || serviceOptions[0]

  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError('')
    try {
      await saasFetch(`/api/saas/model-services/${service.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          name: serviceName.trim() ? serviceName.trim() : undefined,
          strategy: nextStrategy,
          judge_enabled: nextStrategy === 'capability_aware' ? judgeEnabled : false,
          judge_endpoint_id: nextStrategy === 'capability_aware' && judgeEnabled ? (selectedJudge.id || undefined) : undefined,
          shadow_enabled: shadowEnabled,
          shadow_virtual_model_id: shadowEnabled ? (selectedShadowTarget?.id || undefined) : undefined,
          shadow_sample_rate: shadowEnabled ? (shadowSampleRate / 100) : 0,
        }),
      })
      onSaved()
    } catch (e) { setError(errorText(e)) } finally { setBusy(false) }
  }

  return (
    <div ref={dialogRef} className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/40 p-4 backdrop-blur-xs overflow-y-auto" role="dialog" aria-modal="true">
      <form onSubmit={submit} className="w-full max-w-2xl rounded-2xl bg-white p-5 shadow-2xl space-y-4 my-8 max-h-[90vh] overflow-y-auto">
        <div className="flex items-start justify-between gap-4 border-b border-zinc-100 pb-3">
          <div>
            <h2 className="text-lg font-semibold text-zinc-950">{t('services.edit_routing_title')}</h2>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-950" aria-label="Close">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div>
          <label className="block text-xs font-medium text-zinc-700 mb-1">{t('services.service_name')}</label>
          <input
            required
            type="text"
            value={serviceName}
            onChange={(e) => setServiceName(e.target.value)}
            placeholder="fast-chat"
            className="w-full h-9 rounded-md border border-zinc-300 px-3 py-1.5 text-xs focus:border-zinc-900 focus:outline-none"
          />
        </div>

        <StrategyMatrixCardSelector selectedStrategy={nextStrategy} onSelect={setNextStrategy} />

        {nextStrategy === 'capability_aware' && (
          <div className="space-y-4">
            <WorkloadPresetSelector selectedPreset={preset} onSelectPreset={setPreset} />

            <div className="rounded-xl border border-zinc-200 bg-zinc-50/70 p-3 space-y-2">
              <label className="flex items-center gap-2.5 text-xs font-semibold uppercase tracking-wider text-zinc-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={judgeEnabled}
                  onChange={(e) => setJudgeEnabled(e.target.checked)}
                  className="h-4 w-4 rounded border-zinc-300 text-zinc-950 focus:ring-zinc-950"
                />
                <span>{t('services.judge_label')}</span>
              </label>
              {judgeEnabled && (
                <div className="space-y-2 pt-1">
                  {judgeOptions.length > 0 ? (
                    <Select label={t('services.judge_select')} options={judgeOptions} selected={selectedJudge} onChange={(option) => setJudgeEndpointId(String(option.id))} />
                  ) : (
                    <p className="text-xs text-amber-600">{t('services.judge_no_endpoints')}</p>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        <div className="rounded-xl border border-zinc-200 bg-zinc-50/60 p-3 space-y-2">
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
                {t('services.shadow_flighting_title')}
              </span>
            </label>
            {shadowEnabled && (
              <span className="text-xs font-medium text-purple-700 bg-purple-50 border border-purple-200 px-2 py-0.5 rounded-md">
                {shadowSampleRate}% Sample
              </span>
            )}
          </div>
          {shadowEnabled && (
            <div className="space-y-2 pt-1">
              {serviceOptions.length > 0 ? (
                <Select
                  label={t('services.shadow_target_model')}
                  options={serviceOptions}
                  selected={selectedShadowTarget}
                  onChange={(option) => setShadowVirtualModelId(String(option.id))}
                />
              ) : (
                <p className="text-xs text-amber-600">{t('services.shadow_no_targets')}</p>
              )}
              <p className="text-xs text-zinc-500">{t('services.shadow_target_desc')}</p>
              <div className="flex items-center gap-4">
                <span className="text-xs text-zinc-600 font-medium whitespace-nowrap">{t('services.shadow_sample_rate')}:</span>
                <input
                  type="range"
                  min="1"
                  max="100"
                  step="1"
                  value={shadowSampleRate}
                  onChange={(e) => setShadowSampleRate(Number(e.target.value))}
                  className="w-full accent-zinc-950"
                />
                <span className="text-xs font-mono font-bold text-zinc-900 w-10 text-right">{shadowSampleRate}%</span>
              </div>
            </div>
          )}
        </div>

        {error && <div className="mt-4"><ErrorMessage text={error} /></div>}
        <div className="mt-4 flex justify-end gap-3 border-t border-zinc-100 pt-3">
          <button type="button" onClick={onClose} className="rounded-lg border border-zinc-300 px-4 py-2.5 text-sm text-zinc-600 hover:bg-zinc-50 transition-colors">
            {t('common.cancel')}
          </button>
          <button disabled={busy} className="rounded-lg bg-zinc-950 px-5 py-2.5 text-sm text-white hover:bg-zinc-800 transition-colors disabled:opacity-50">
            {busy ? (t('common.saving')) : (t('common.save'))}
          </button>
        </div>
      </form>
    </div>
  )
}
