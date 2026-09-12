import { FormEvent, useState } from 'react'
import { AlertCircle, CheckCircle2, X, Zap } from 'lucide-react'
import { saasFetch } from '../../lib/saasApi'
import Select from '../../components/Select'
import { useI18n } from '../../lib/i18n'
import { useModal } from '../../lib/modal'
import { ErrorMessage, Field, errorText } from './components'
import { formatPriceInput } from './serviceUtils'
import type { ServiceEndpoint } from './types'

export function EditProviderModal({ endpoint, serviceId, onClose, onSaved }: { endpoint: ServiceEndpoint; serviceId: string; onClose: () => void; onSaved: () => void }) {
  const { t } = useI18n()
  const dialogRef = useModal({ onClose })
  const [providerName, setProviderName] = useState(endpoint.provider_name)
  const [providerType] = useState(endpoint.provider_type)
  const [protocol, setProtocol] = useState(endpoint.protocol || 'openai')
  const [baseUrl, setBaseUrl] = useState(endpoint.base_url)
  const [model, setModel] = useState(endpoint.model)
  const [apiKey, setApiKey] = useState('')
  const [inputPrice, setInputPrice] = useState(formatPriceInput(endpoint.input_price_per_1m))
  const [outputPrice, setOutputPrice] = useState(formatPriceInput(endpoint.output_price_per_1m))
  const [capabilityScore, setCapabilityScore] = useState(String(endpoint.capability_score ?? '0.70'))
  const [contextLength, setContextLength] = useState(endpoint.context_length ? String(endpoint.context_length) : '')
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
          setTestMsg(res.data?.message || (t('services.test_passed')))
        } else {
          setTestStatus('failed')
          setTestMsg(res.message || (t('services.test_failed')))
        }
      } else {
        const res = await saasFetch<{ passed?: boolean; message?: string }>(`/api/saas/model-services/${serviceId}/endpoints/${endpoint.id}`, {
          method: 'POST',
        })
        if (res.success && (res.data?.passed !== false)) {
          setTestStatus('passed')
          setTestMsg(res.data?.message || (t('services.test_passed')))
        } else {
          setTestStatus('failed')
          setTestMsg(res.message || (t('services.test_failed')))
        }
      }
    } catch (e: any) {
      setTestStatus('failed')
      setTestMsg(e.message || (t('services.test_failed')))
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
  return (
    <div ref={dialogRef} className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/30 p-4" role="dialog" aria-modal="true">
      <form onSubmit={submit} className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold">{t('services.edit_model')}</h2>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-2 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-950" aria-label="Close">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="mt-6 space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t('services.provider_name')} value={providerName} onChange={setProviderName} placeholder="DeepSeek" />
            <label className="block text-xs font-medium text-zinc-700">
              {t('services.provider_id')}
              <input readOnly value={endpoint.provider_id} className="mt-1.5 w-full rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs text-zinc-500 outline-none" />
            </label>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t('services.model_label')} value={model} onChange={(val) => { setModel(val); setTestStatus('idle') }} placeholder="deepseek-chat" />
            <Select label={t('services.protocol_label')} options={[{ id: 'openai', name: 'OpenAI' }, { id: 'anthropic', name: 'Anthropic' }]} selected={{ id: protocol, name: protocol === 'anthropic' ? 'Anthropic' : 'OpenAI' }} onChange={(option) => { setProtocol(String(option.id)); setTestStatus('idle') }} />
          </div>

          <Field label={t('services.base_url')} value={baseUrl} onChange={(val) => { setBaseUrl(val); setTestStatus('idle') }} placeholder="https://api.example.com/v1" />

          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="block text-xs font-medium text-zinc-700">{t('services.api_key_new')}</label>
              <button type="button" onClick={runTest} disabled={testStatus === 'testing' || !baseUrl.trim() || !model.trim()} className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:text-primary-hover disabled:text-zinc-400 disabled:cursor-not-allowed" title={t('services.test_connection_hint')}>
                <Zap className={`h-3.5 w-3.5 ${testStatus === 'testing' ? 'animate-pulse text-amber-500' : ''}`} />
                <span>{testStatus === 'testing' ? (t('services.testing')) : (t('services.test_connection'))}</span>
              </button>
            </div>
            <div className="relative mt-1">
              <Field required={false} label="" value={apiKey} onChange={(val) => { setApiKey(val); setTestStatus('idle') }} placeholder={t('services.api_key_placeholder')} type="password" />
            </div>
            {testStatus === 'passed' && (
              <div className="mt-1.5 flex items-center gap-1.5 text-xs text-emerald-600">
                <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                <span>{testMsg || (t('services.test_passed'))}</span>
              </div>
            )}
            {testStatus === 'failed' && (
              <div className="mt-1.5 flex items-start gap-1.5 text-xs text-rose-600">
                <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                <span className="break-all">{testMsg || (t('services.test_failed'))}</span>
              </div>
            )}
          </div>

          {/* Compact pricing and capability parameters directly expanded */}
          <div className="rounded-xl border border-zinc-200 bg-zinc-50/80 p-3">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500 mb-2">
              {t('services.advanced_settings')}
            </div>
            <div className="grid gap-3 sm:grid-cols-4 text-zinc-900">
              <Field size="sm" required={false} label={t('services.input_price')} value={inputPrice} onChange={setInputPrice} placeholder="0.14" />
              <Field size="sm" required={false} label={t('services.output_price')} value={outputPrice} onChange={setOutputPrice} placeholder="0.28" />
              <Field size="sm" required={false} label={t('services.capability_range')} value={capabilityScore} onChange={setCapabilityScore} placeholder="0.70" />
              <Field size="sm" required={false} label={t('services.context_length')} value={contextLength} onChange={setContextLength} placeholder="128000" />
            </div>
          </div>
        </div>

        {error && <div className="mt-4"><ErrorMessage text={error} /></div>}

        <div className="mt-6 flex justify-end gap-3 border-t border-zinc-100 pt-3">
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
