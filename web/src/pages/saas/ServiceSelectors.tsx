import { useState } from 'react'
import { Activity, CheckCheck, HelpCircle, Sparkles, TrendingDown, X } from 'lucide-react'
import { useI18n } from '../../lib/i18n'

interface StrategyMatrixCardSelectorProps {
  selectedStrategy: string
  onSelect: (strategy: string) => void
}

export function StrategyMatrixCardSelector({ selectedStrategy, onSelect }: StrategyMatrixCardSelectorProps) {
  const { t } = useI18n()

  const strategyCards = [
    {
      id: 'cost_aware',
      title: t('services.strategy_cost_title'),
      icon: TrendingDown,
    },
    {
      id: 'capability_aware',
      title: t('services.strategy_dna_title'),
      icon: Sparkles,
    },
    {
      id: 'load_aware',
      title: t('services.strategy_load_title'),
      icon: Activity,
    },
    {
      id: 'round_robin',
      title: t('services.strategy_round_robin_title'),
      icon: CheckCheck,
    },
  ]

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {strategyCards.map((card) => {
          const isSelected = selectedStrategy === card.id
          const Icon = card.icon
          return (
            <button
              key={card.id}
              type="button"
              onClick={() => onSelect(card.id)}
              aria-pressed={isSelected}
              className={`flex items-center justify-between gap-2 rounded-xl border px-4 py-3.5 text-left transition-all ${
                isSelected
                  ? 'border-zinc-950 bg-zinc-50/90 ring-1 ring-zinc-950 shadow-sm'
                  : 'border-zinc-200 bg-white hover:border-zinc-300 hover:bg-zinc-50/40'
              }`}
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <div className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${isSelected ? 'bg-zinc-950 text-white' : 'bg-zinc-100 text-zinc-600'}`}>
                  <Icon className="h-4 w-4" />
                </div>
                <span className="min-w-0 text-sm font-semibold leading-snug text-zinc-950">{card.title}</span>
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}

interface WorkloadPresetSelectorProps {
  selectedPreset: string
  onSelectPreset: (presetId: string) => void
}

export function WorkloadPresetSelector({ selectedPreset, onSelectPreset }: WorkloadPresetSelectorProps) {
  const { t } = useI18n()
  const [showWeightsModal, setShowWeightsModal] = useState(false)

  const presets = [
    {
      id: 'coding',
      name: t('services.preset_coding'),
      icon: '💻',
      weights: { code: 90, math: 10, tools: 10, lang: 0, ctx: 0 },
    },
    {
      id: 'reasoning',
      name: t('services.preset_reasoning'),
      icon: '🧠',
      weights: { code: 15, math: 85, tools: 0, lang: 0, ctx: 10 },
    },
    {
      id: 'tools',
      name: t('services.preset_tools'),
      icon: '🛠️',
      weights: { code: 10, math: 30, tools: 60, lang: 0, ctx: 10 },
    },
    {
      id: 'general',
      name: t('services.preset_general'),
      icon: '🌐',
      weights: { code: 0, math: 10, tools: 10, lang: 70, ctx: 30 },
    },
  ]

  const currentPreset = presets.find((p) => p.id === selectedPreset) || presets[0]

  return (
    <div className="rounded-xl border border-purple-200/80 bg-purple-50/40 p-3.5">
      <div className="flex items-center justify-between">
        <label className="text-xs font-semibold uppercase tracking-wider text-purple-900 flex items-center gap-1.5">
          <Sparkles className="h-3.5 w-3.5 text-purple-600" />
          {t('services.workload_presets')}
        </label>
        <button
          type="button"
          onClick={() => setShowWeightsModal(true)}
          className="inline-flex items-center gap-1 text-[11px] font-medium text-purple-700 hover:text-purple-900 transition-colors"
        >
          <HelpCircle className="h-3.5 w-3.5" />
          <span>{t('services.workload_details_btn')}</span>
        </button>
      </div>

      <div className="mt-2.5 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {presets.map((preset) => {
          const isSelected = selectedPreset === preset.id
          return (
            <button
              key={preset.id}
              type="button"
              onClick={() => onSelectPreset(preset.id)}
              className={`flex items-center gap-2 rounded-lg border px-3 py-2.5 text-left transition-all ${
                isSelected
                  ? 'border-purple-600 bg-white ring-1 ring-purple-600 shadow-xs'
                  : 'border-purple-200/60 bg-white/70 hover:border-purple-300 hover:bg-white'
              }`}
            >
              <span className="text-lg leading-none">{preset.icon}</span>
              <span className={`min-w-0 text-xs truncate ${isSelected ? 'font-semibold text-zinc-950' : 'font-medium text-zinc-700'}`}>
                {preset.name}
              </span>
            </button>
          )
        })}
      </div>

      {showWeightsModal && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center bg-zinc-950/40 p-4" role="dialog" aria-modal="true">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl space-y-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="text-base font-semibold text-zinc-950 flex items-center gap-2">
                  <span>{currentPreset.icon}</span>
                  <span>{t('services.workload_details_title')}</span>
                </h3>
                <p className="mt-1 text-xs text-zinc-500">
                  {t('services.workload_details_desc')}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowWeightsModal(false)}
                className="rounded-lg p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-950"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="space-y-3 rounded-xl border border-zinc-100 bg-zinc-50/80 p-4">
              <div className="text-xs font-semibold text-zinc-900 mb-2">
                {currentPreset.name}
              </div>
              <div>
                <div className="flex justify-between text-xs mb-1 text-zinc-600">
                  <span>{t('radar.code')}</span>
                  <span className="font-mono font-bold text-zinc-900">{currentPreset.weights.code}%</span>
                </div>
                <div className="h-1.5 w-full rounded-full bg-zinc-200 overflow-hidden">
                  <div className="h-full bg-purple-600 rounded-full" style={{ width: `${currentPreset.weights.code}%` }} />
                </div>
              </div>
              <div>
                <div className="flex justify-between text-xs mb-1 text-zinc-600">
                  <span>{t('radar.math')}</span>
                  <span className="font-mono font-bold text-zinc-900">{currentPreset.weights.math}%</span>
                </div>
                <div className="h-1.5 w-full rounded-full bg-zinc-200 overflow-hidden">
                  <div className="h-full bg-amber-500 rounded-full" style={{ width: `${currentPreset.weights.math}%` }} />
                </div>
              </div>
              <div>
                <div className="flex justify-between text-xs mb-1 text-zinc-600">
                  <span>{t('radar.tools')}</span>
                  <span className="font-mono font-bold text-zinc-900">{currentPreset.weights.tools}%</span>
                </div>
                <div className="h-1.5 w-full rounded-full bg-zinc-200 overflow-hidden">
                  <div className="h-full bg-sky-500 rounded-full" style={{ width: `${currentPreset.weights.tools}%` }} />
                </div>
              </div>
              <div>
                <div className="flex justify-between text-xs mb-1 text-zinc-600">
                  <span>{t('radar.lang')}</span>
                  <span className="font-mono font-bold text-zinc-900">{currentPreset.weights.lang}%</span>
                </div>
                <div className="h-1.5 w-full rounded-full bg-zinc-200 overflow-hidden">
                  <div className="h-full bg-emerald-500 rounded-full" style={{ width: `${currentPreset.weights.lang}%` }} />
                </div>
              </div>
              <div>
                <div className="flex justify-between text-xs mb-1 text-zinc-600">
                  <span>{t('radar.context')}</span>
                  <span className="font-mono font-bold text-zinc-900">{currentPreset.weights.ctx}%</span>
                </div>
                <div className="h-1.5 w-full rounded-full bg-zinc-200 overflow-hidden">
                  <div className="h-full bg-indigo-500 rounded-full" style={{ width: `${currentPreset.weights.ctx}%` }} />
                </div>
              </div>
            </div>

            <div className="flex justify-end pt-2">
              <button
                type="button"
                onClick={() => setShowWeightsModal(false)}
                className="rounded-lg bg-zinc-950 px-4 py-2 text-xs font-medium text-white hover:bg-zinc-800 transition-colors"
              >
                {t('common.close')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
