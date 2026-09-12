import { FormEvent, useEffect, useMemo, useState } from 'react'
import { X } from 'lucide-react'
import { saasFetch } from '../../lib/saasApi'
import Select from '../../components/Select'
import { useI18n } from '../../lib/i18n'
import { useModal } from '../../lib/modal'
import { ErrorMessage, errorText } from './components'
import { computeBundleSelection, emptyEndpoint, formatPriceInput, inferDefaultCapability } from './serviceUtils'
import { EndpointPricingFields } from './add-model/EndpointPricingFields'
import { ModelPicker } from './add-model/ModelPicker'
import { ProviderAccountFields } from './add-model/ProviderAccountFields'
import { SelectedModelsList } from './add-model/SelectedModelsList'
import { SmartBundleSelector } from './add-model/SmartBundleSelector'
import { buildEndpointPayload, buildTargetModels } from './add-model/submitPayload'
import { useCatalogMarket } from './add-model/useCatalogMarket'
import { accountDraftPatch, useProviderAccounts } from './add-model/useProviderAccounts'
import { useTestConnection } from './add-model/useTestConnection'
import type { CatalogOffering, DraftEndpoint, SaasProvider } from './types'

export function AddModelModal({ catalog: initialCatalog, providers: _, serviceId, onClose, onSaved }: { catalog: CatalogOffering[]; providers: { id: string; name: string; modelCount: number }[]; serviceId: string; onClose: () => void; onSaved: () => void }) {
  const { t } = useI18n()

  const dialogRef = useModal({ onClose })
  const [draft, setDraft] = useState<DraftEndpoint>(emptyEndpoint())
  const [visible, setVisible] = useState(false)
  const [advanced, setAdvanced] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [modelSearch, setModelSearch] = useState('')
  const [prefixFilter, setPrefixFilter] = useState('')
  const [freeOnlyFilter, setFreeOnlyFilter] = useState(false)
  const [maxPriceFilter, setMaxPriceFilter] = useState('')
  const [selectedBundle, setSelectedBundle] = useState<'custom' | 'balanced' | 'free' | 'reasoning'>('balanced')
  const [selectedModelIds, setSelectedModelIds] = useState<string[]>([])

  const { fullCatalog, marketModels } = useCatalogMarket(initialCatalog)
  const { savedAccounts, useExisting, setUseExisting, selectedAccountId, setSelectedAccountId } = useProviderAccounts({
    onAccountLoaded: (acc) => setDraft((curr) => ({ ...curr, ...accountDraftPatch(acc) })),
  })

  const selectedAccount = savedAccounts.find((a) => a.id === selectedAccountId)
  const currentProviderType = useExisting
    ? (selectedAccount?.provider_type || (marketModels.length ? 'openrouter' : 'custom'))
    : draft.provider_type
  const models = useMemo(() => {
    const scoped = fullCatalog.filter((item) => item.provider_id === currentProviderType)
    // Accounts whose provider type has no catalog entry (e.g. custom OpenAI-compatible
    // endpoints) still get the full offering list so models can be picked individually.
    return scoped.length > 0 ? scoped : fullCatalog
  }, [fullCatalog, currentProviderType])

  const { testStatus, testMsg, setTestStatus, runTestKey } = useTestConnection({ useExisting, selectedAccount, draft, selectedModelIds })

  // Automatically populate selectedModelIds if a smart bundle is active and selection is empty
  useEffect(() => {
    if (models.length > 0 && selectedBundle !== 'custom' && selectedModelIds.length === 0) {
      const targetIds = computeBundleSelection(selectedBundle, models)
      if (targetIds.length > 0) {
        setSelectedModelIds(targetIds)
      }
    }
  }, [models, selectedBundle, selectedModelIds.length])

  const selectedModels = models.filter((m) => selectedModelIds.includes(m.model))

  const accountOptions = savedAccounts.map((a) => ({
    id: a.id,
    name: a.name,
  }))

  const presetProviderOptions = [
    { id: 'openrouter', name: 'OpenRouter' },
    { id: 'deepseek', name: 'DeepSeek' },
    { id: 'openai', name: 'OpenAI' },
    { id: 'anthropic', name: 'Anthropic' },
    { id: 'aliyun', name: 'Aliyun Bailian' },
    { id: 'custom', name: t('services.custom_provider') },
  ]
  const selectedPresetProvider = presetProviderOptions.find((p) => p.id === draft.provider_type) || presetProviderOptions[0]

  const patch = (value: Partial<DraftEndpoint>) => {
    setDraft((current) => ({ ...current, ...value }))
    setTestStatus('idle')
  }

  function handleAccountChange(opt: { id: string | number; name: string }) {
    const accId = String(opt.id)
    setSelectedAccountId(accId)
    const acc = savedAccounts.find((a) => a.id === accId)
    if (acc) {
      setSelectedModelIds([])
      setModelSearch('')
      setDraft((curr) => ({ ...curr, ...accountDraftPatch(acc) }))
    }
  }

  function chooseNewProviderPreset(option: { id: string | number; name: string }) {
    const provider = String(option.id)
    const first = fullCatalog.find((item) => item.provider_id === provider)
    const protocol = /anthropic|claude/i.test(provider) ? 'anthropic' : 'openai'
    setSelectedModelIds([])
    setModelSearch('')
    setDraft({
      ...emptyEndpoint(),
      provider_type: provider,
      protocol,
      upstream_model_id: '',
      base_url: first?.base_url || '',
      input_price_per_1m: '',
      output_price_per_1m: '',
      capability_score: first ? inferDefaultCapability(first) : '0.70',
      context_length: '',
    })
    setAdvanced(false)
    setTestStatus('idle')
  }

  function toggleModelSelection(m: CatalogOffering) {
    const exists = selectedModelIds.includes(m.model)
    const next = exists ? selectedModelIds.filter((id) => id !== m.model) : [...selectedModelIds, m.model]
    const focus = exists
      ? models.find((item) => item.model === next[0])
      : m
    setSelectedModelIds(next)
    patch({
      upstream_model_id: focus?.model || '',
      base_url: useExisting ? (selectedAccount?.base_url || focus?.base_url || '') : (focus?.base_url || ''),
      input_price_per_1m: focus ? formatPriceInput(focus.input_price_per_1m) : '',
      output_price_per_1m: focus ? formatPriceInput(focus.output_price_per_1m) : '',
      capability_score: focus ? inferDefaultCapability(focus) : '0.70',
      context_length: focus?.context_length ? String(focus.context_length) : '',
    })
    setTestStatus('idle')
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!useExisting && (!draft.base_url.trim() || !draft.api_key.trim())) {
      setError(t('services.error_base_url_apikey_required'))
      return
    }
    if (!useExisting && draft.provider_type === 'custom' && !draft.custom_provider_id.trim()) {
      setError(t('services.error_custom_provider_required'))
      return
    }
    if (!useExisting && !draft.upstream_model_id.trim() && selectedModelIds.length === 0) {
      setError(t('services.error_no_model_selected'))
      return
    }

    const targetModels = buildTargetModels({ selectedModelIds, models, draft })

    if (targetModels.length === 0) {
      setError(t('services.error_no_model_selected'))
      return
    }

    setBusy(true)
    setError('')
    try {
      const endpointsPayload = buildEndpointPayload({
        targetModels,
        useExisting,
        selectedAccountId,
        draft,
        presetProviderName: selectedPresetProvider.name,
      })

      await saasFetch(`/api/saas/model-services/${serviceId}/endpoints`, {
        method: 'POST',
        body: JSON.stringify(endpointsPayload),
      })
      onSaved()
    } catch (e) {
      setError(errorText(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div ref={dialogRef} className="fixed inset-0 z-[100] flex items-center justify-center bg-zinc-950/40 p-4" role="dialog" aria-modal="true">
      <form onSubmit={submit} className="max-h-[90vh] w-full max-w-2xl min-w-[320px] sm:min-w-[640px] overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl [scrollbar-gutter:stable]">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold">{t('services.add_model')}</h2>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-2 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-950" aria-label={t('common.close')}>
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Toggle between existing provider account or entering new */}
        {savedAccounts.length > 0 && (
          <div className="mt-4 flex rounded-lg border border-zinc-200 bg-zinc-100 p-1">
            <button
              type="button"
              onClick={() => setUseExisting(true)}
              className={`flex-1 rounded-md py-1.5 text-xs font-medium transition-all ${
                useExisting ? 'bg-white text-zinc-900 shadow-xs' : 'text-zinc-500 hover:text-zinc-900'
              }`}
            >
              {t('providers.use_connected_account')}
            </button>
            <button
              type="button"
              onClick={() => setUseExisting(false)}
              className={`flex-1 rounded-md py-1.5 text-xs font-medium transition-all ${
                !useExisting ? 'bg-white text-zinc-900 shadow-xs' : 'text-zinc-500 hover:text-zinc-900'
              }`}
            >
              {t('providers.connect_new_account')}
            </button>
          </div>
        )}

        <div className="mt-5 space-y-4">
          {useExisting && savedAccounts.length > 0 ? (
            <div className="space-y-4 rounded-xl border border-zinc-200 bg-zinc-50/60 p-4">
              <Select
                label={t('providers.select_account')}
                options={accountOptions}
                selected={accountOptions.find((a) => a.id === selectedAccountId) || accountOptions[0]}
                onChange={handleAccountChange}
              />

              {/* Searchable multi-select model catalog */}
              <div className="space-y-3">
                <SmartBundleSelector
                  models={models}
                  selectedModelIds={selectedModelIds}
                  selectedBundle={selectedBundle}
                  onSelectBundle={setSelectedBundle}
                  onSelectModels={setSelectedModelIds}
                />

                {selectedBundle !== 'custom' ? (
                  <SelectedModelsList
                    selectedModels={selectedModels}
                    selectedCount={selectedModelIds.length}
                    onCustomize={() => setSelectedBundle('custom')}
                    onRemove={(m) => {
                      setSelectedBundle('custom')
                      toggleModelSelection(m)
                    }}
                  />
                ) : (
                  <ModelPicker
                    currentProviderType={currentProviderType}
                    models={models}
                    selectedModelIds={selectedModelIds}
                    modelSearch={modelSearch}
                    onModelSearchChange={setModelSearch}
                    prefixFilter={prefixFilter}
                    onPrefixFilterChange={setPrefixFilter}
                    freeOnlyFilter={freeOnlyFilter}
                    onFreeOnlyFilterChange={setFreeOnlyFilter}
                    maxPriceFilter={maxPriceFilter}
                    onMaxPriceFilterChange={setMaxPriceFilter}
                    onToggleModel={toggleModelSelection}
                    onSelectModels={setSelectedModelIds}
                  />
                )}
              </div>
            </div>
          ) : (
            <ProviderAccountFields
              draft={draft}
              patch={patch}
              presetProviderOptions={presetProviderOptions}
              selectedPresetProvider={selectedPresetProvider}
              onChoosePreset={chooseNewProviderPreset}
              visible={visible}
              onToggleVisible={() => setVisible((value) => !value)}
              testStatus={testStatus}
              testMsg={testMsg}
              onTest={runTestKey}
            />
          )}

          <EndpointPricingFields draft={draft} patch={patch} />
        </div>

        {error && <div className="mt-4"><ErrorMessage text={error} /></div>}

        <div className="mt-6 flex justify-end gap-3 border-t border-zinc-100 pt-3">
          <button type="button" onClick={onClose} className="rounded-lg border border-zinc-300 px-4 py-2 text-xs font-medium text-zinc-600 hover:bg-zinc-50">
            {t('common.cancel')}
          </button>
          <button disabled={busy} className="rounded-lg bg-zinc-950 px-5 py-2 text-xs font-medium text-white hover:bg-zinc-800 disabled:opacity-50">
            {busy ? (t('common.creating')) : (t('services.add_model'))}
          </button>
        </div>
      </form>
    </div>
  )
}
