import { FormEvent, useEffect, useMemo, useState } from 'react'
import { AlertCircle, CheckCircle2, Eye, EyeOff, Search, X, Zap } from 'lucide-react'
import { saasFetch } from '../../lib/saasApi'
import Select from '../../components/Select'
import { useI18n } from '../../lib/i18n'
import { useModal } from '../../lib/modal'
import { ErrorMessage, Field, errorText } from './components'
import { catalogProviderPrefixes, computeBundleSelection, emptyEndpoint, filterCatalogModels, formatPriceInput, inferDefaultCapability, searchScore } from './serviceUtils'
import type { CatalogOffering, DraftEndpoint, SaasProvider } from './types'

export function AddModelModal({ catalog: initialCatalog, providers: _, serviceId, onClose, onSaved }: { catalog: CatalogOffering[]; providers: { id: string; name: string; modelCount: number }[]; serviceId: string; onClose: () => void; onSaved: () => void }) {
  const { t } = useI18n()

  const dialogRef = useModal({ onClose })
  const [savedAccounts, setSavedAccounts] = useState<SaasProvider[]>([])
  const [useExisting, setUseExisting] = useState(true)
  const [selectedAccountId, setSelectedAccountId] = useState<string>('')
  const [draft, setDraft] = useState<DraftEndpoint>(emptyEndpoint())
  const [visible, setVisible] = useState(false)
  const [advanced, setAdvanced] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [testStatus, setTestStatus] = useState<'idle' | 'testing' | 'passed' | 'failed'>('idle')
  const [testMsg, setTestMsg] = useState('')
  const [modelSearch, setModelSearch] = useState('')
  const [prefixFilter, setPrefixFilter] = useState('')
  const [freeOnlyFilter, setFreeOnlyFilter] = useState(false)
  const [maxPriceFilter, setMaxPriceFilter] = useState('')
  const [selectedBundle, setSelectedBundle] = useState<'custom' | 'balanced' | 'free' | 'reasoning'>('balanced')
  const [selectedModelIds, setSelectedModelIds] = useState<string[]>([])
  const [openRouterModels, setOpenRouterModels] = useState<CatalogOffering[]>([])

  useEffect(() => {
    let active = true
    const mapMarket = (items: Array<{ id: string; name: string; prompt_price_per_1m: number; completion_price_per_1m: number; context_length: number; description: string | null }>): CatalogOffering[] =>
      items.map((m) => ({
        provider_id: 'openrouter',
        provider_name: 'OpenRouter',
        endpoint_id: `openrouter-${m.id}`,
        endpoint_key: 'openrouter',
        region: 'global',
        base_url: 'https://openrouter.ai/api/v1',
        price_currency: 'USD',
        model: m.id,
        model_name: m.name,
        description: m.description || '',
        input_price_per_1m: formatPriceInput(m.prompt_price_per_1m) ? Number(formatPriceInput(m.prompt_price_per_1m)) : 0,
        output_price_per_1m: formatPriceInput(m.completion_price_per_1m) ? Number(formatPriceInput(m.completion_price_per_1m)) : 0,
        cache_read_price_per_1m: 0,
        cache_write_price_per_1m: 0,
        supports_tools: true,
        supports_vision: false,
        supports_reasoning: /(?:^|[^a-z0-9])(?:r1|o1|o3)(?:[^a-z0-9]|$)/i.test(m.id) || m.id.includes('reasoning'),
        context_length: m.context_length,
      }))

    const loadMarket = async () => {
      try {
        let res = await saasFetch<{ models?: Array<{ id: string; name: string; prompt_price_per_1m: number; completion_price_per_1m: number; context_length: number; description: string | null }> }>('/api/saas/openrouter/market?page_size=1000')
        if ((!res.data?.models || res.data.models.length <= 3) && active) {
          try {
            await saasFetch('/api/saas/openrouter/sync', { method: 'POST' })
            res = await saasFetch('/api/saas/openrouter/market?page_size=1000')
          } catch (_) {}
        }
        if (active && res.data?.models?.length) {
          setOpenRouterModels(mapMarket(res.data.models))
        }
      } catch (_) {}
    }
    loadMarket()
    return () => { active = false }
  }, [])

  const fullCatalog = useMemo(() => {
    if (openRouterModels.length === 0) return initialCatalog
    const nonOr = initialCatalog.filter((item) => item.provider_id !== 'openrouter')
    return [...nonOr, ...openRouterModels]
  }, [initialCatalog, openRouterModels])

  useEffect(() => {
    saasFetch<SaasProvider[]>('/api/saas/providers').then((res) => {
      const list = res.data || []
      setSavedAccounts(list)
      if (list.length > 0) {
        setSelectedAccountId(list[0].id)
        setUseExisting(true)
        const acc = list[0]
        setDraft((curr) => ({
          ...curr,
          provider_type: acc.provider_type,
          protocol: acc.protocol || 'openai',
          base_url: acc.base_url,
          upstream_model_id: '',
          input_price_per_1m: '',
          output_price_per_1m: '',
          capability_score: '0.70',
          context_length: '',
        }))
      } else {
        setUseExisting(false)
      }
    }).catch(() => {
      setUseExisting(false)
    })
  }, [])

  const selectedAccount = savedAccounts.find((a) => a.id === selectedAccountId)
  const currentProviderType = useExisting
    ? (selectedAccount?.provider_type || (openRouterModels.length ? 'openrouter' : 'custom'))
    : draft.provider_type
  const models = useMemo(() => {
    const scoped = fullCatalog.filter((item) => item.provider_id === currentProviderType)
    // Accounts whose provider type has no catalog entry (e.g. custom OpenAI-compatible
    // endpoints) still get the full offering list so models can be picked individually.
    return scoped.length > 0 ? scoped : fullCatalog
  }, [fullCatalog, currentProviderType])

  // Automatically populate selectedModelIds if a smart bundle is active and selection is empty
  useEffect(() => {
    if (models.length > 0 && selectedBundle !== 'custom' && selectedModelIds.length === 0) {
      const targetIds = computeBundleSelection(selectedBundle, models)
      if (targetIds.length > 0) {
        setSelectedModelIds(targetIds)
      }
    }
  }, [models, selectedBundle, selectedModelIds.length])

  const matchedModels = useMemo(
    () => filterCatalogModels(models, { query: modelSearch, providerPrefix: prefixFilter, freeOnly: freeOnlyFilter, maxInputPrice: maxPriceFilter }),
    [models, modelSearch, prefixFilter, freeOnlyFilter, maxPriceFilter]
  )
  const filteredModels = matchedModels
    .map((m) => ({ model: m, score: searchScore(m, modelSearch) }))
    .sort((a, b) => b.score - a.score)
    .map((item) => item.model)
  const selectedModels = models.filter((m) => selectedModelIds.includes(m.model))
  const hasActiveFilter = modelSearch.trim() !== '' || prefixFilter !== '' || freeOnlyFilter || maxPriceFilter.trim() !== ''
  const visibleModels = hasActiveFilter
    ? [...selectedModels, ...filteredModels.filter((m) => !selectedModelIds.includes(m.model))]
    : filteredModels

  const formatPrice = (val: number) => {
    if (val === 0) return 'FREE'
    if (val < 0.0001) return `<$0.0001`
    const rounded = Number(val.toPrecision(4))
    return `$${rounded}`
  }

  const accountOptions = savedAccounts.map((a) => ({
    id: a.id,
    name: a.name,
  }))

  const providerPrefixes = useMemo(() => catalogProviderPrefixes(models), [models])
  const prefixOptions = [
    { id: '', name: t('services.filter_all_providers') },
    ...providerPrefixes.map((p) => ({ id: p, name: p })),
  ]
  const selectedPrefixOption = prefixOptions.find((o) => o.id === prefixFilter) || prefixOptions[0]

  const presetProviderOptions = [
    { id: 'openrouter', name: 'OpenRouter' },
    { id: 'deepseek', name: 'DeepSeek' },
    { id: 'openai', name: 'OpenAI' },
    { id: 'anthropic', name: 'Anthropic' },
    { id: 'aliyun', name: 'Aliyun Bailian' },
    { id: 'custom', name: t('services.custom_provider') },
  ]
  const selectedPresetProvider = presetProviderOptions.find((p) => p.id === draft.provider_type) || presetProviderOptions[0]

  const protocolOptions = [{ id: 'openai', name: 'OpenAI' }, { id: 'anthropic', name: 'Anthropic' }]
  const selectedProtocol = protocolOptions.find((option) => option.id === draft.protocol) || protocolOptions[0]

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
      setDraft((curr) => ({
        ...curr,
        provider_type: acc.provider_type,
        protocol: acc.protocol || 'openai',
        base_url: acc.base_url,
        upstream_model_id: '',
        input_price_per_1m: '',
        output_price_per_1m: '',
        capability_score: '0.70',
        context_length: '',
      }))
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

  async function runTestKey() {
    const modelToTest = draft.upstream_model_id.trim() || selectedModelIds[0] || ''
    if (!modelToTest) return
    setTestStatus('testing')
    setTestMsg('')
    try {
      const res = await saasFetch<{ passed?: boolean; message?: string }>('/api/saas/test-connection', {
        method: 'POST',
        body: JSON.stringify({
          protocol: useExisting ? (selectedAccount?.protocol || 'openai') : draft.protocol,
          base_url: useExisting ? (selectedAccount?.base_url || draft.base_url) : draft.base_url.trim(),
          api_key: draft.api_key.trim(),
          upstream_model_id: modelToTest,
        }),
      })
      if (res.success && (res.data?.passed !== false)) {
        setTestStatus('passed')
        setTestMsg(res.data?.message || (t('services.test_passed')))
      } else {
        setTestStatus('failed')
        setTestMsg(res.message || (t('services.test_failed')))
      }
    } catch (e: any) {
      setTestStatus('failed')
      setTestMsg(e.message || (t('services.test_failed')))
    }
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

    const targetModels: Array<{
      model: string
      input_price?: number
      output_price?: number
      capability?: number
      context_length?: number
    }> = []

    if (selectedModelIds.length > 0) {
      for (const mId of selectedModelIds) {
        const catItem = models.find((item) => item.model === mId)
        if (catItem) {
          targetModels.push({
            model: catItem.model,
            // 0 is a free model and must be stored as such; only a missing catalog
            // price stays undefined (unpriced).
            input_price: catItem.input_price_per_1m ?? undefined,
            output_price: catItem.output_price_per_1m ?? undefined,
            capability: Number(inferDefaultCapability(catItem)),
            context_length: catItem.context_length ? Number(catItem.context_length) : undefined,
          })
        } else {
          targetModels.push({
            model: mId,
            input_price: draft.input_price_per_1m ? Number(draft.input_price_per_1m) : undefined,
            output_price: draft.output_price_per_1m ? Number(draft.output_price_per_1m) : undefined,
            capability: Number(draft.capability_score || 0.7),
            context_length: draft.context_length ? Number(draft.context_length) : undefined,
          })
        }
      }
    } else if (draft.upstream_model_id.trim()) {
      targetModels.push({
        model: draft.upstream_model_id.trim(),
        input_price: draft.input_price_per_1m ? Number(draft.input_price_per_1m) : undefined,
        output_price: draft.output_price_per_1m ? Number(draft.output_price_per_1m) : undefined,
        capability: Number(draft.capability_score || 0.7),
        context_length: draft.context_length ? Number(draft.context_length) : undefined,
      })
    }

    if (targetModels.length === 0) {
      setError(t('services.error_no_model_selected'))
      return
    }

    setBusy(true)
    setError('')
    try {
      const endpointsPayload = targetModels.map((tm) => ({
        account_id: useExisting ? selectedAccountId : undefined,
        provider_type: useExisting ? undefined : (draft.provider_type === 'custom' ? draft.custom_provider_id : draft.provider_type),
        provider_name: useExisting ? undefined : (draft.provider_type === 'custom' ? draft.custom_provider_id : selectedPresetProvider.name),
        protocol: useExisting ? undefined : draft.protocol,
        base_url: useExisting ? undefined : draft.base_url,
        api_key: useExisting ? undefined : draft.api_key,
        upstream_model_id: tm.model,
        input_price_per_1m: tm.input_price,
        output_price_per_1m: tm.output_price,
        capability_score: tm.capability,
        context_length: tm.context_length,
      }))

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
          <button type="button" onClick={onClose} className="rounded-lg p-2 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-950" aria-label="Close">
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
                {/* Smart preset bundles for rapid tier-setup */}
                {models.length > 0 && (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-zinc-800">
                        {t('services.smart_bundles')}
                      </span>
                      {selectedModelIds.length > 0 && (
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedBundle('custom')
                            setSelectedModelIds([])
                          }}
                          className="text-[11px] text-zinc-400 hover:text-zinc-700 transition-colors"
                        >
                          {t('services.clear_selection')}
                        </button>
                      )}
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedBundle('balanced')
                          setSelectedModelIds(computeBundleSelection('balanced', models))
                        }}
                        className={`rounded-lg border px-3 py-2 text-center text-xs font-medium transition-all ${
                          selectedBundle === 'balanced'
                            ? 'border-zinc-950 bg-zinc-950 text-white shadow-xs'
                            : 'border-zinc-200 bg-white text-zinc-700 hover:border-zinc-300 hover:bg-zinc-50'
                        }`}
                      >
                        {t('services.bundle_balanced')}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedBundle('free')
                          const freeModels = computeBundleSelection('free', models)
                          if (freeModels.length > 0) {
                            setSelectedModelIds(freeModels)
                          }
                        }}
                        className={`rounded-lg border px-3 py-2 text-center text-xs font-medium transition-all ${
                          selectedBundle === 'free'
                            ? 'border-zinc-950 bg-zinc-950 text-white shadow-xs'
                            : 'border-zinc-200 bg-white text-zinc-700 hover:border-zinc-300 hover:bg-zinc-50'
                        }`}
                      >
                        {t('services.bundle_free')}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedBundle('reasoning')
                          const reasoningModels = computeBundleSelection('reasoning', models)
                          if (reasoningModels.length > 0) {
                            setSelectedModelIds(reasoningModels)
                          }
                        }}
                        className={`rounded-lg border px-3 py-2 text-center text-xs font-medium transition-all ${
                          selectedBundle === 'reasoning'
                            ? 'border-zinc-950 bg-zinc-950 text-white shadow-xs'
                            : 'border-zinc-200 bg-white text-zinc-700 hover:border-zinc-300 hover:bg-zinc-50'
                        }`}
                      >
                        {t('services.bundle_reasoning')}
                      </button>
                    </div>
                  </div>
                )}

                {selectedBundle !== 'custom' ? (
                  /* Template mode: simply display framed models cleanly without requiring manual checkboxes */
                  <div className="rounded-xl border border-zinc-200 bg-white p-3 space-y-2">
                    <div className="flex items-center justify-between text-xs font-semibold text-zinc-900 border-b border-zinc-100 pb-2">
                      <span>{t('services.models_to_connect')} ({selectedModelIds.length})</span>
                      <button
                        type="button"
                        onClick={() => setSelectedBundle('custom')}
                        className="text-[11px] font-normal text-primary hover:underline"
                      >
                        {t('services.custom_or_additional_model')}
                      </button>
                    </div>
                    <div className="h-48 overflow-y-auto divide-y divide-zinc-100 pr-1 [scrollbar-gutter:stable]">
                      {selectedModels.map((m) => (
                        <div
                          key={m.model}
                          role="checkbox"
                          aria-checked="true"
                          tabIndex={0}
                          onClick={() => {
                            setSelectedBundle('custom')
                            toggleModelSelection(m)
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault()
                              setSelectedBundle('custom')
                              toggleModelSelection(m)
                            }
                          }}
                          title={t('services.remove_from_selection')}
                          className="flex cursor-pointer items-center justify-between rounded-md py-2 text-xs transition-colors hover:bg-zinc-50"
                        >
                          <div className="min-w-0 pr-2">
                            <div className="font-medium text-zinc-900 truncate">{m.model_name || m.model}</div>
                            <div className="text-[11px] text-zinc-400 font-mono truncate">{m.model}</div>
                          </div>
                          <div className="shrink-0 text-right">
                            <div className="font-mono font-medium text-zinc-700">
                              {m.input_price_per_1m === 0 && m.output_price_per_1m === 0 ? (
                                <span className="text-emerald-600 font-semibold">FREE</span>
                              ) : (
                                <span>{formatPrice(m.input_price_per_1m)}/1M</span>
                              )}
                            </div>
                            {m.context_length && (
                              <div className="text-[10px] text-zinc-400">{m.context_length.toLocaleString()} ctx</div>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  /* Custom manual search and selection mode */
                  <div>
                    {currentProviderType === 'openrouter' && (
                      <div className="mb-2 space-y-2 rounded-lg border border-zinc-200 bg-zinc-50/60 p-2">
                        <div className="grid gap-2 sm:grid-cols-2">
                          <Select
                            size="sm"
                            label={t('services.filter_provider_prefix')}
                            options={prefixOptions}
                            selected={selectedPrefixOption}
                            onChange={(option) => setPrefixFilter(String(option.id))}
                          />
                          <div>
                            <label className="mb-1 block text-xs font-medium text-zinc-700">{t('services.filter_max_input_price')}</label>
                            <input
                              type="text"
                              inputMode="decimal"
                              value={maxPriceFilter}
                              onChange={(e) => setMaxPriceFilter(e.target.value)}
                              placeholder={t('services.price_cap_placeholder')}
                              className="h-9 w-full rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-xs outline-none focus:border-primary"
                            />
                          </div>
                        </div>
                        <div className="flex items-center justify-between gap-2">
                          <label className="flex cursor-pointer items-center gap-1.5 text-xs text-zinc-700">
                            <input
                              type="checkbox"
                              checked={freeOnlyFilter}
                              onChange={(e) => setFreeOnlyFilter(e.target.checked)}
                              className="h-3.5 w-3.5 rounded accent-zinc-900"
                            />
                            {t('services.filter_free_only')}
                          </label>
                          <button
                            type="button"
                            onClick={() => {
                              const matching = matchedModels.map((m) => m.model)
                              setSelectedModelIds(Array.from(new Set([...selectedModelIds, ...matching])))
                            }}
                            disabled={matchedModels.length === 0}
                            className="rounded-md border border-zinc-300 bg-white px-2.5 py-1 text-[11px] font-medium text-zinc-700 transition-colors hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-40"
                          >
                            {t('services.select_all_matching', { count: matchedModels.length })}
                          </button>
                        </div>
                      </div>
                    )}
                    <div className="relative mb-2">
                      <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-zinc-400" />
                      <input
                        type="text"
                        autoComplete="off"
                        autoCorrect="off"
                        spellCheck={false}
                        value={modelSearch}
                        onChange={(e) => setModelSearch(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') e.preventDefault() }}
                        placeholder={t('services.search_models_placeholder')}
                        className="w-full rounded-lg border border-zinc-200 bg-white py-1.5 pl-8 pr-3 text-xs outline-none focus:border-primary"
                      />
                    </div>

                    <div className="h-48 overflow-y-auto rounded-lg border border-zinc-200 bg-white p-2 [scrollbar-gutter:stable]">
                      {visibleModels.length > 0 ? (
                        <div className="space-y-1.5">
                          {visibleModels.map((m) => {
                            const isChecked = selectedModelIds.includes(m.model)
                            return (
                              <label
                                key={m.model}
                                className={`flex cursor-pointer items-start gap-2.5 rounded-md p-2 transition-colors ${
                                  isChecked ? 'bg-zinc-100 border border-zinc-300' : 'hover:bg-zinc-50 border border-transparent'
                                }`}
                              >
                                <input
                                  type="checkbox"
                                  checked={isChecked}
                                  onChange={() => toggleModelSelection(m)}
                                  className="mt-0.5 h-3.5 w-3.5 rounded accent-zinc-900"
                                />
                                <div className="min-w-0 flex-1">
                                  <div className="flex items-center justify-between gap-2">
                                    <span className="font-medium text-xs text-zinc-900 truncate">
                                      {m.model_name || m.model}
                                    </span>
                                    <div className="shrink-0 text-[11px] font-mono text-zinc-500">
                                      {m.input_price_per_1m === 0 && m.output_price_per_1m === 0 ? (
                                        <span className="text-emerald-600 font-semibold">FREE</span>
                                      ) : (
                                        <span>{formatPrice(m.input_price_per_1m)}/1M</span>
                                      )}
                                    </div>
                                  </div>
                                  <div className="mt-0.5 text-[11px] text-zinc-400 truncate">
                                    <code className="text-zinc-600">{m.model}</code>
                                    {m.context_length ? ` ${m.context_length.toLocaleString()} ctx` : ''}
                                  </div>
                                </div>
                              </label>
                            )
                          })}
                        </div>
                      ) : (
                        <div className="flex h-full items-center justify-center text-xs text-zinc-400">
                          {models.length === 0
                            ? (t('common.loading'))
                            : (t('services.no_models_match'))}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <Select
                  label={t('services.provider_label')}
                  options={presetProviderOptions}
                  selected={selectedPresetProvider}
                  onChange={chooseNewProviderPreset}
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
                      placeholder="e.g. deepseek-chat or gpt-4o"
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
                  placeholder="deepseek-chat or gpt-4o"
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
                    onClick={runTestKey}
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
                    onClick={() => setVisible((value) => !value)}
                    className="absolute inset-y-0 right-0 px-3 text-zinc-400"
                    aria-label={visible ? 'Hide API key' : 'Show API key'}
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
          )}

          {/* Compact pricing and capability parameters directly expanded */}
          <div className="rounded-xl border border-zinc-200 bg-zinc-50/80 p-3">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500 mb-2">
              {t('services.advanced_settings')}
            </div>
            <div className="grid gap-3 sm:grid-cols-4 text-zinc-900">
              <Field size="sm" required={false} label={t('services.input_price')} value={draft.input_price_per_1m} onChange={(value) => patch({ input_price_per_1m: value })} placeholder="0.14" />
              <Field size="sm" required={false} label={t('services.output_price')} value={draft.output_price_per_1m} onChange={(value) => patch({ output_price_per_1m: value })} placeholder="0.28" />
              <Field size="sm" required={false} label={t('services.capability_range')} value={draft.capability_score} onChange={(value) => patch({ capability_score: value })} placeholder="0.70" />
              <Field size="sm" required={false} label={t('services.context_length')} value={draft.context_length} onChange={(value) => patch({ context_length: value })} placeholder="128000" />
            </div>
          </div>
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
