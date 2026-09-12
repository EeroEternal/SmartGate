import { useState } from 'react'
import { CheckCircle2, Copy } from 'lucide-react'
import { useI18n } from '../../lib/i18n'
import { callExample } from './serviceUtils'
import type { CallApi } from './types'

export function CallExamplePanel({ api, model, onChange }: { api: CallApi; model: string; onChange: (api: CallApi) => void }) {
  const { t } = useI18n()
  const example = callExample(api, model, t)
  const command = [`curl ${example.path} \\`, ...example.headers.map((header) => `  -H "${header}" \\`), `  -d '${example.body}'`].join('\n')
  const [copied, setCopied] = useState(false)
  const tabs: { id: CallApi; label: string }[] = [
    { id: 'openai-chat', label: t('services.api_openai_chat') },
    { id: 'openai-responses', label: t('services.api_openai_responses') },
    { id: 'anthropic-messages', label: t('services.api_anthropic_messages') },
  ]
  async function copyExample() {
    await navigator.clipboard.writeText(command)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1800)
  }
  return (
    <section className="rounded-xl border border-zinc-200 bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex rounded-lg border border-zinc-200 bg-zinc-50 p-1" role="tablist" aria-label={t('services.api_examples')}>
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={api === tab.id}
              onClick={() => onChange(tab.id)}
              className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                api === tab.id ? 'bg-white text-zinc-950 shadow-sm' : 'text-zinc-500 hover:text-zinc-950'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={copyExample}
          className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-zinc-600 hover:bg-zinc-100 hover:text-zinc-950"
          title={t('common.copy')}
        >
          {copied ? <CheckCircle2 className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
          {copied ? (t('common.copied')) : (t('common.copy'))}
        </button>
      </div>
      <pre role="tabpanel" className="mt-3 whitespace-pre-wrap break-words rounded-lg bg-[var(--color-primary-soft)] p-3 text-xs leading-6 text-zinc-950">{command}</pre>
    </section>
  )
}
