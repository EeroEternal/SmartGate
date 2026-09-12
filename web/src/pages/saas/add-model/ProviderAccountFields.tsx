import { AlertCircle, CheckCircle2, Eye, EyeOff, Zap } from 'lucide-react'
import Select from '../../../components/Select'
import { useI18n } from '../../../lib/i18n'
import { Field } from '../components'
import type { DraftEndpoint } from '../types'

// "Connect new credentials" form: provider preset, model id, protocol, base URL and
// the API key with its test-connection action/state.
export function ProviderAccountFields({ draft, patch, presetProviderOptions, selectedPresetProvider, onChoosePreset, visible, onToggleVisible, testStatus, testMsg, onTest }: {
  draft: DraftEndpoint
  patch: (value: Partial<DraftEndpoint>) => void
  presetProviderOptions: { id: string; name: string }[]
  selectedPresetProvider: { id: string; name: string }
  onChoosePreset: (option: { id: string | number; name: string }) => void
  visible: boolean
  onToggleVisible: () => void
  testStatus: 'idle' | 'testing' | 'passed' | 'failed'
  testMsg: string
  onTest: () => void
}) {
  const { t } = useI18n()
  const protocolOptions = [{ id: 'openai', name: 'OpenAI' }, { id: 'anthropic', name: 'Anthropic' }]
  const selectedProtocol = protocolOptions.find((option) => option.id === draft.protocol) || protocolOptions[0]

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Select
          label={t('services.provider_label')}
          options={presetProviderOptions}
          selected={selectedPresetProvider}
          onChange={onChoosePreset}
        />
        {draft.provider_type === 'custom' ? (
          <Field
            alignWithSelect
            label={t('services.provider_id')}
            value={draft.custom_provider_id}
            onChange={(value) => patch({ custom_provider_id: value })}
            placeholder="my-openai-proxy"
          />
        ) : (
          <div>
            <label className="block text-xs font-medium text-zinc-700 mb-1">{t('services.model_label')}</label>
            <input
              type="text"
              value={draft.upstream_model_id}
              onChange={(e) => patch({ upstream_model_id: e.target.value })}
              placeholder={t('services.custom_model_placeholder')}
              className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-xs outline-none focus:border-primary"
            />
          </div>
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label={t('services.model_label')}
          value={draft.upstream_model_id}
          onChange={(val) => patch({ upstream_model_id: val })}
          placeholder={t('services.custom_model_placeholder')}
        />
        <Select
          label={t('services.protocol_label')}
          options={protocolOptions}
          selected={selectedProtocol}
          onChange={(option) => patch({ protocol: String(option.id) })}
        />
      </div>

      <Field
        label={t('services.base_url')}
        value={draft.base_url}
        onChange={(value) => patch({ base_url: value })}
        placeholder="https://api.example.com/v1"
      />

      <div>
        <div className="flex items-center justify-between mb-1">
          <label className="block text-xs font-medium text-zinc-700">{t('services.api_key')}</label>
          <button
            type="button"
            onClick={onTest}
            disabled={testStatus === 'testing' || !draft.api_key.trim() || !draft.base_url.trim() || !draft.upstream_model_id.trim()}
            className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:text-primary-hover disabled:text-zinc-400 disabled:cursor-not-allowed"
          >
            <Zap className={`h-3.5 w-3.5 ${testStatus === 'testing' ? 'animate-pulse text-amber-500' : ''}`} />
            <span>{testStatus === 'testing' ? (t('services.testing')) : (t('services.test_connection'))}</span>
          </button>
        </div>
        <div className="relative mt-1">
          <input
            required
            type={visible ? 'text' : 'password'}
            value={draft.api_key}
            onChange={(event) => patch({ api_key: event.target.value })}
            placeholder={t('services.api_key_paste_placeholder')}
            className="w-full rounded-lg border border-zinc-300 px-3 py-2 pr-10 text-sm outline-none focus:border-primary"
          />
          <button
            type="button"
            onClick={onToggleVisible}
            className="absolute inset-y-0 right-0 px-3 text-zinc-400"
            aria-label={visible ? t('services.hide_api_key') : t('services.show_api_key')}
          >
            {visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </div>
        {testStatus === 'passed' && (
          <div className="mt-1.5 flex items-center gap-1.5 text-xs text-emerald-600">
            <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
            <span>{testMsg || (t('services.key_verified_healthy'))}</span>
          </div>
        )}
        {testStatus === 'failed' && (
          <div className="mt-1.5 flex items-start gap-1.5 text-xs text-rose-600">
            <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
            <span className="break-all">{testMsg || (t('services.test_failed'))}</span>
          </div>
        )}
      </div>
    </div>
  )
}
