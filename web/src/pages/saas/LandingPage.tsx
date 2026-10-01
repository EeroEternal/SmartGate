import { useEffect, useState } from 'react'
import { Copy, Check, Zap, RefreshCw } from 'lucide-react'
import BrandMark from '../../components/BrandMark'
import { LanguageSwitcher } from '../../components/LanguageSwitcher'
import { useI18n } from '../../lib/i18n'
import { apiUrl } from '../../lib/api'

interface ClaimResult {
  api_key: string
  default_model: string
}

export default function LandingPage() {
  const { t } = useI18n()

  const [claiming, setClaiming] = useState(false)
  const [claimResult, setClaimResult] = useState<ClaimResult | null>(null)
  const [claimError, setClaimError] = useState<string | null>(null)

  // Copy feedback states
  const [copiedKey, setCopiedKey] = useState(false)
  const [copiedUrl, setCopiedUrl] = useState(false)
  const [copiedModel, setCopiedModel] = useState(false)
  const [copiedAll, setCopiedAll] = useState(false)

  const fullBaseUrl = typeof window !== 'undefined'
    ? `${window.location.origin}/v1`
    : 'https://smartgate.run/v1'

  // Restore saved key from local storage if available
  useEffect(() => {
    try {
      const saved = localStorage.getItem('sg_free_claimed')
      if (saved) {
        const parsed = JSON.parse(saved)
        if (parsed?.api_key) {
          setClaimResult(parsed)
        }
      }
    } catch {
      // Ignore parse error
    }
  }, [])

  async function handleClaim() {
    setClaiming(true)
    setClaimError(null)

    try {
      const res = await fetch(apiUrl('/api/free-token/claim'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      const data = await res.json()

      if (data.success && data.data) {
        setClaimResult(data.data)
        try {
          localStorage.setItem('sg_free_claimed', JSON.stringify(data.data))
        } catch {
          // Ignore storage error
        }
      } else {
        setClaimError(data.message || t('free_token.claim_failed'))
      }
    } catch {
      setClaimError(t('common.something_went_wrong'))
    } finally {
      setClaiming(false)
    }
  }

  function handleReset() {
    setClaimResult(null)
    try {
      localStorage.removeItem('sg_free_claimed')
    } catch {
      // Ignore
    }
  }

  function copyText(text: string, type: 'key' | 'url' | 'model' | 'all') {
    navigator.clipboard.writeText(text)
    if (type === 'key') {
      setCopiedKey(true)
      setTimeout(() => setCopiedKey(false), 2000)
    } else if (type === 'url') {
      setCopiedUrl(true)
      setTimeout(() => setCopiedUrl(false), 2000)
    } else if (type === 'model') {
      setCopiedModel(true)
      setTimeout(() => setCopiedModel(false), 2000)
    } else {
      setCopiedAll(true)
      setTimeout(() => setCopiedAll(false), 2000)
    }
  }

  const apiKey = claimResult?.api_key || ''
  const modelName = claimResult?.default_model || 'free-chat'

  const allConfigText = `Base URL: ${fullBaseUrl}
API Key: ${apiKey}
Model: ${modelName}`

  const curlSnippet = `curl ${fullBaseUrl}/chat/completions \\
  -H "Authorization: Bearer ${apiKey}" \\
  -d '{"model":"${modelName}","messages":[{"role":"user","content":"Hi"}]}'`

  return (
    <div className="min-h-screen bg-white text-zinc-900 font-sans flex flex-col justify-between selection:bg-zinc-900 selection:text-white">
      {/* Top Bar with Language Switcher */}
      <header className="w-full max-w-4xl mx-auto px-6 h-16 flex items-center justify-between">
        <div className="flex items-center gap-2 font-bold text-zinc-900">
          <BrandMark className="h-5 w-5" />
          <span className="text-sm font-semibold tracking-tight">SmartGate</span>
        </div>
        <LanguageSwitcher size="sm" />
      </header>

      {/* Center Body */}
      <main className="flex-1 flex flex-col items-center justify-center px-4 py-8 w-full max-w-xl mx-auto text-center">
        {/* Logo & Brand */}
        <div className="space-y-2 mb-8">
          <h1 className="text-4xl sm:text-5xl font-extrabold tracking-tight text-zinc-950">
            SmartGate
          </h1>
          <p className="text-sm text-zinc-500">
            {t('free_token.compatibility_hint')}
          </p>
        </div>

        {/* State 1: Single Button to Get API Key */}
        {!claimResult ? (
          <div className="space-y-4 w-full flex flex-col items-center">
            {claimError && (
              <div className="rounded-lg bg-rose-50 border border-rose-200 p-2.5 text-xs text-rose-700 w-full max-w-sm">
                {claimError}
              </div>
            )}

            <button
              type="button"
              onClick={handleClaim}
              disabled={claiming}
              className="rounded-full bg-zinc-950 px-8 py-3.5 text-base font-semibold text-white hover:bg-zinc-800 disabled:opacity-50 transition-all shadow-md hover:shadow-lg flex items-center gap-2.5 active:scale-[0.98]"
            >
              <Zap className={`h-5 w-5 ${claiming ? 'animate-bounce' : ''}`} />
              <span>{claiming ? t('free_token.claiming_button') : t('free_token.claim_button')}</span>
            </button>
          </div>
        ) : (
          /* State 2: Clean 3-Item Credential Box */
          <div className="w-full space-y-5 text-left">
            <div className="rounded-2xl border border-zinc-200 bg-zinc-50/60 p-5 sm:p-6 space-y-3.5 shadow-sm">
              {/* API Key */}
              <div>
                <div className="text-[11px] font-bold text-zinc-500 uppercase tracking-wider mb-1">
                  {t('free_token.api_key')}
                </div>
                <div className="flex items-center justify-between gap-2 rounded-xl bg-white border border-zinc-200 px-3.5 py-2 font-mono text-xs sm:text-sm text-zinc-950">
                  <span className="truncate select-all font-semibold">{apiKey}</span>
                  <button
                    type="button"
                    onClick={() => copyText(apiKey, 'key')}
                    className="shrink-0 inline-flex items-center gap-1 rounded-md bg-zinc-950 px-2.5 py-1 text-xs font-sans text-white hover:bg-zinc-800 transition-colors"
                  >
                    {copiedKey ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
                    <span>{copiedKey ? t('common.copied') : t('common.copy')}</span>
                  </button>
                </div>
              </div>

              {/* Base URL */}
              <div>
                <div className="text-[11px] font-bold text-zinc-500 uppercase tracking-wider mb-1">
                  {t('free_token.base_url')}
                </div>
                <div className="flex items-center justify-between gap-2 rounded-xl bg-white border border-zinc-200 px-3.5 py-2 font-mono text-xs sm:text-sm text-zinc-950">
                  <span className="truncate select-all">{fullBaseUrl}</span>
                  <button
                    type="button"
                    onClick={() => copyText(fullBaseUrl, 'url')}
                    className="shrink-0 p-1 text-zinc-500 hover:text-zinc-950 transition-colors"
                    title={t('common.copy')}
                  >
                    {copiedUrl ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
                  </button>
                </div>
              </div>

              {/* Model Name */}
              <div>
                <div className="text-[11px] font-bold text-zinc-500 uppercase tracking-wider mb-1">
                  {t('free_token.model_name')}
                </div>
                <div className="flex items-center justify-between gap-2 rounded-xl bg-white border border-zinc-200 px-3.5 py-2 font-mono text-xs sm:text-sm text-zinc-950">
                  <span className="truncate select-all font-semibold text-emerald-700">{modelName}</span>
                  <button
                    type="button"
                    onClick={() => copyText(modelName, 'model')}
                    className="shrink-0 p-1 text-zinc-500 hover:text-zinc-950 transition-colors"
                    title={t('common.copy')}
                  >
                    {copiedModel ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
                  </button>
                </div>
              </div>

              {/* Action buttons: Copy All & New Key */}
              <div className="pt-2 flex items-center justify-between gap-2">
                <button
                  type="button"
                  onClick={() => copyText(allConfigText, 'all')}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-zinc-950 px-3.5 py-2 text-xs font-semibold text-white hover:bg-zinc-800 transition-colors shadow-sm"
                >
                  {copiedAll ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
                  <span>{copiedAll ? t('common.copied') : t('free_token.copy_all')}</span>
                </button>

                <button
                  type="button"
                  onClick={handleReset}
                  className="inline-flex items-center gap-1 text-xs text-zinc-500 hover:text-zinc-900 transition-colors"
                >
                  <RefreshCw className="h-3 w-3" />
                  <span>{t('free_token.claim_another')}</span>
                </button>
              </div>
            </div>

            {/* Compact How to Use */}
            <div className="rounded-xl border border-zinc-200 bg-zinc-50/40 p-4 space-y-2">
              <div className="text-xs font-bold text-zinc-800">
                {t('free_token.how_to_use')} (Cursor / Cline / SDK)
              </div>
              <pre className="font-mono text-xs text-zinc-700 bg-white p-2.5 rounded-lg border border-zinc-200 overflow-x-auto whitespace-pre-wrap break-all leading-relaxed">
                <code>{curlSnippet}</code>
              </pre>
            </div>
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="w-full text-center py-6 text-xs text-zinc-400">
        © SmartGate
      </footer>
    </div>
  )
}
