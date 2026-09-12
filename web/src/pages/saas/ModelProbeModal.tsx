import { useState } from 'react'
import { CheckCircle2, Sparkles, X } from 'lucide-react'
import { saasFetch } from '../../lib/saasApi'
import { useI18n } from '../../lib/i18n'
import { useModal } from '../../lib/modal'
import { ErrorMessage } from './components'
import type { ModelDna, ServiceEndpoint } from './types'

export function ModelProbeModal({
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
  const dialogRef = useModal({ onClose })
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
        setError(res.message || t('services.probe_failed'))
      }
    } catch (e: any) {
      setError(e.message || t('services.probe_request_failed'))
    } finally {
      setProbing(false)
    }
  }

  return (
    <div ref={dialogRef} className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/30 p-4" role="dialog" aria-modal="true">
      <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-2.5">
            <div className="rounded-lg bg-purple-50 p-2 text-purple-600 border border-purple-100">
              <Sparkles className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-zinc-950">{t('services.probe_modal_title')}</h2>
              <p className="mt-0.5 text-xs text-zinc-500">
                {endpoint.provider_name} • {endpoint.model}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-2 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-950"
            aria-label={t('common.close')}
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <p className="mt-4 text-xs text-zinc-600 leading-relaxed bg-zinc-50 rounded-lg p-3 border border-zinc-200/70">
          {t('services.probe_modal_subtitle')}
        </p>

        {error && <div className="mt-4"><ErrorMessage text={error} /></div>}

        {!probeResult ? (
          <div className="mt-6 text-center py-8 border border-dashed border-zinc-200 rounded-xl bg-zinc-50/50">
            <div className="inline-flex rounded-full bg-purple-100 p-3 text-purple-600 mb-3">
              <Sparkles className={`h-6 w-6 ${probing ? 'animate-spin' : ''}`} />
            </div>
            <h3 className="text-sm font-medium text-zinc-900">
              {probing ? (t('services.probe_running')) : (t('services.probe_ready_title'))}
            </h3>
            <p className="mt-1 text-xs text-zinc-500 max-w-sm mx-auto">
              {probing
                ? (t('services.probe_running_desc'))
                : (t('services.probe_ready_desc'))}
            </p>
            <button
              type="button"
              onClick={runProbe}
              disabled={probing}
              className="mt-5 inline-flex items-center gap-2 rounded-lg bg-purple-600 px-5 py-2.5 text-sm font-medium text-white shadow-sm hover:bg-purple-700 disabled:opacity-50 transition-colors"
            >
              <Sparkles className="h-4 w-4" />
              {probing ? (t('services.probe_running')) : (t('services.probe_run'))}
            </button>
          </div>
        ) : (
          <div className="mt-5 space-y-4">
            <div className="flex items-center justify-between rounded-xl bg-emerald-50 border border-emerald-200 p-4">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-5 w-5 text-emerald-600 shrink-0" />
                <div>
                  <div className="text-sm font-semibold text-emerald-950">
                    {t('services.probe_completed')}
                  </div>
                  <div className="text-xs text-emerald-700 mt-0.5">
                    {t('services.probe_score_label')} <span className="font-mono font-bold">{probeResult.probed_capability_score.toFixed(2)}</span> • {t('services.probe_tool_schema_label')}{' '}
                    {probeResult.supports_tools ? t('services.probe_tool_supported') : t('services.probe_tool_standard')}
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
                {t('services.probe_breakdown_title')}
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
                {t('services.probe_apply')}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
