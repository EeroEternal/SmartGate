import { useEffect, useState, type FormEvent } from 'react'
import {
  Key,
  Copy,
  Check,
  Terminal,
  Zap,
  CheckCircle2,
} from 'lucide-react'
import BrandMark from '../../components/BrandMark'
import { LanguageSwitcher } from '../../components/LanguageSwitcher'
import { useI18n } from '../../lib/i18n'
import { apiUrl } from '../../lib/api'

interface ClaimResult {
  api_key: string
  key_prefix: string
  name: string
  base_url: string
  models: string[]
  default_model: string
  quota: {
    rpm_limit: number
    concurrency_limit: number
    daily_spend_limit: number
  }
}

export default function LandingPage() {
  const { t } = useI18n()

  const [keyTag, setKeyTag] = useState('')
  const [claiming, setClaiming] = useState(false)
  const [claimResult, setClaimResult] = useState<ClaimResult | null>(null)
  const [claimError, setClaimError] = useState<string | null>(null)

  // Clipboard copy feedback states
  const [copiedKey, setCopiedKey] = useState(false)
  const [copiedUrl, setCopiedUrl] = useState(false)
  const [copiedModel, setCopiedModel] = useState(false)
  const [copiedSnippet, setCopiedSnippet] = useState(false)

  // How to use integration tab
  const [activeTab, setActiveTab] = useState<'cursor' | 'cline' | 'claude' | 'python' | 'curl'>('cursor')

  const fullBaseUrl = typeof window !== 'undefined'
    ? `${window.location.origin}/v1`
    : 'https://smartgate.run/v1'

  // Restore existing key from local storage if available
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
      // Ignore local storage parse errors
    }
  }, [])

  async function handleClaim(e: FormEvent) {
    e.preventDefault()
    setClaiming(true)
    setClaimError(null)

    try {
      const res = await fetch(apiUrl('/api/free-token/claim'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: keyTag.trim() || undefined }),
      })
      const data = await res.json()

      if (data.success && data.data) {
        setClaimResult(data.data)
        try {
          localStorage.setItem('sg_free_claimed', JSON.stringify(data.data))
        } catch {
          // Ignore storage errors
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
    setKeyTag('')
    try {
      localStorage.removeItem('sg_free_claimed')
    } catch {
      // Ignore
    }
  }

  function copyToClipboard(text: string, type: 'key' | 'url' | 'model' | 'snippet') {
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
      setCopiedSnippet(true)
      setTimeout(() => setCopiedSnippet(false), 2000)
    }
  }

  const currentKey = claimResult?.api_key || 'sk-free-xxxxxxxxxxxxxxxx'
  const currentModel = claimResult?.default_model || 'free-chat'

  const snippetContent = {
    cursor: `// Cursor > Settings > Models
// 1. Model Name: ${currentModel}
// 2. Override OpenAI Base URL: ${fullBaseUrl}
// 3. OpenAI API Key: ${currentKey}`,

    cline: `// Cline / Roo Code Settings
API Provider: OpenAI Compatible
Base URL: ${fullBaseUrl}
API Key: ${currentKey}
Model ID: ${currentModel}`,

    claude: `export ANTHROPIC_BASE_URL="${fullBaseUrl}"
export ANTHROPIC_API_KEY="${currentKey}"`,

    python: `from openai import OpenAI

client = OpenAI(
    base_url="${fullBaseUrl}",
    api_key="${currentKey}",
)

response = client.chat.completions.create(
    model="${currentModel}",
    messages=[{"role": "user", "content": "Hello!"}],
)

print(response.choices[0].message.content)`,

    curl: `curl ${fullBaseUrl}/chat/completions \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer ${currentKey}" \\
  -d '{
    "model": "${currentModel}",
    "messages": [{"role": "user", "content": "Hello!"}]
  }'`,
  }[activeTab]

  return (
    <div className="min-h-screen bg-zinc-50 text-zinc-900 font-sans flex flex-col justify-between selection:bg-black selection:text-white">
      {/* Minimal Top Header */}
      <header className="w-full max-w-5xl mx-auto px-6 h-16 flex items-center justify-between">
        <div className="flex items-center gap-2.5 font-bold tracking-tight text-zinc-900">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-zinc-950 text-white">
            <BrandMark className="h-4 w-4" />
          </span>
          <span className="text-base font-bold">SmartGate</span>
        </div>

        <LanguageSwitcher size="sm" />
      </header>

      {/* Main Centered Body */}
      <main className="flex-1 flex flex-col items-center justify-center px-4 py-10 w-full max-w-3xl mx-auto">
        {/* Brand & Title */}
        <div className="text-center space-y-3 mb-8">
          <h1 className="text-4xl sm:text-5xl font-extrabold tracking-tight text-zinc-950">
            SmartGate
          </h1>
          <p className="text-base sm:text-lg text-zinc-600 font-medium">
            {t('free_token.subtitle')}
          </p>
          <div className="inline-flex items-center gap-2 rounded-full bg-zinc-200/60 px-3 py-1 text-xs text-zinc-600">
            <span>{t('free_token.compatibility_hint')}</span>
          </div>
        </div>

        {/* State 1: Claim Action (Google-like Clean Search/Claim Bar) */}
        {!claimResult ? (
          <div className="w-full max-w-lg space-y-4">
            {claimError && (
              <div className="rounded-xl bg-rose-50 border border-rose-200 p-3 text-xs text-rose-700 text-center">
                {claimError}
              </div>
            )}

            <form
              onSubmit={handleClaim}
              className="flex flex-col sm:flex-row items-center gap-2 rounded-2xl sm:rounded-full border border-zinc-200 bg-white p-2 shadow-lg shadow-zinc-200/40 hover:border-zinc-300 transition-all w-full"
            >
              <div className="flex items-center gap-2 flex-1 w-full px-3 py-1.5 sm:py-0">
                <Key className="h-4 w-4 text-zinc-400 shrink-0" />
                <input
                  type="text"
                  value={keyTag}
                  onChange={(e) => setKeyTag(e.target.value)}
                  placeholder={t('free_token.tag_placeholder')}
                  className="w-full bg-transparent text-sm text-zinc-900 placeholder:text-zinc-400 focus:outline-none"
                />
              </div>

              <button
                type="submit"
                disabled={claiming}
                className="w-full sm:w-auto rounded-xl sm:rounded-full bg-zinc-950 px-6 py-2.5 text-sm font-semibold text-white hover:bg-zinc-800 disabled:opacity-50 transition-colors shadow-sm shrink-0 flex items-center justify-center gap-2"
              >
                <Zap className={`h-4 w-4 ${claiming ? 'animate-bounce' : ''}`} />
                <span>{claiming ? t('free_token.claiming_button') : t('free_token.claim_button')}</span>
              </button>
            </form>
          </div>
        ) : (
          /* State 2: Key Ready & How to Use */
          <div className="w-full space-y-6">
            {/* The 3 Core Credentials */}
            <div className="rounded-2xl border border-zinc-200 bg-white p-6 sm:p-7 shadow-xl shadow-zinc-200/50 space-y-4 text-left">
              {/* API Key */}
              <div>
                <div className="flex items-center justify-between text-xs mb-1.5">
                  <span className="font-semibold text-zinc-700 uppercase tracking-wider">
                    {t('free_token.api_key')}
                  </span>
                  <span className="text-[11px] text-amber-600 font-medium">
                    {t('free_token.save_warning')}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-2 rounded-xl bg-zinc-50 border border-zinc-200 px-3.5 py-2.5 font-mono text-sm text-zinc-950">
                  <span className="truncate select-all font-semibold">{claimResult.api_key}</span>
                  <button
                    type="button"
                    onClick={() => copyToClipboard(claimResult.api_key, 'key')}
                    className="shrink-0 inline-flex items-center gap-1.5 rounded-lg bg-zinc-950 px-3 py-1.5 text-xs font-sans text-white hover:bg-zinc-800 transition-colors"
                  >
                    {copiedKey ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
                    <span>{copiedKey ? t('common.copied') : t('common.copy')}</span>
                  </button>
                </div>
              </div>

              {/* Base URL and Model Name */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                {/* Base URL */}
                <div className="rounded-xl bg-zinc-50 border border-zinc-200 p-3.5 space-y-1">
                  <div className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">
                    {t('free_token.base_url')}
                  </div>
                  <div className="flex items-center justify-between gap-2 font-mono text-xs text-zinc-900">
                    <span className="truncate select-all">{fullBaseUrl}</span>
                    <button
                      type="button"
                      onClick={() => copyToClipboard(fullBaseUrl, 'url')}
                      className="p-1 text-zinc-500 hover:text-zinc-900 transition-colors"
                      title={t('common.copy')}
                    >
                      {copiedUrl ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
                    </button>
                  </div>
                </div>

                {/* Model Name */}
                <div className="rounded-xl bg-zinc-50 border border-zinc-200 p-3.5 space-y-1">
                  <div className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">
                    {t('free_token.model_name')}
                  </div>
                  <div className="flex items-center justify-between gap-2 font-mono text-xs text-zinc-900">
                    <span className="truncate select-all font-semibold text-emerald-700">
                      {claimResult.default_model || 'free-chat'}
                    </span>
                    <button
                      type="button"
                      onClick={() => copyToClipboard(claimResult.default_model || 'free-chat', 'model')}
                      className="p-1 text-zinc-500 hover:text-zinc-900 transition-colors"
                      title={t('common.copy')}
                    >
                      {copiedModel ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {/* How to Use Section */}
            <div className="rounded-2xl border border-zinc-200 bg-white p-6 sm:p-7 shadow-xl shadow-zinc-200/50 space-y-4 text-left">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div className="flex items-center gap-2">
                  <Terminal className="h-4 w-4 text-zinc-900" />
                  <h2 className="text-sm font-bold text-zinc-900">
                    {t('free_token.how_to_use')}
                  </h2>
                </div>

                {/* Agent Tabs */}
                <div className="flex items-center gap-1 bg-zinc-100 p-1 rounded-xl">
                  {(['cursor', 'cline', 'claude', 'python', 'curl'] as const).map((tab) => (
                    <button
                      key={tab}
                      type="button"
                      onClick={() => setActiveTab(tab)}
                      className={`rounded-lg px-2.5 py-1 text-xs font-medium capitalize transition-all ${
                        activeTab === tab
                          ? 'bg-white text-zinc-950 shadow-sm font-semibold'
                          : 'text-zinc-600 hover:text-zinc-950'
                      }`}
                    >
                      {tab === 'cline' ? 'Cline / Roo' : tab === 'claude' ? 'Claude Code' : tab}
                    </button>
                  ))}
                </div>
              </div>

              {/* Code Snippet */}
              <div className="relative rounded-xl bg-zinc-950 p-4">
                <button
                  type="button"
                  onClick={() => copyToClipboard(snippetContent, 'snippet')}
                  className="absolute right-3 top-3 inline-flex items-center gap-1 rounded bg-zinc-800 px-2.5 py-1 text-xs font-sans text-zinc-300 hover:text-white hover:bg-zinc-700 transition-colors"
                >
                  {copiedSnippet ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
                  <span>{copiedSnippet ? t('common.copied') : t('common.copy')}</span>
                </button>

                <pre className="font-mono text-xs text-zinc-200 whitespace-pre-wrap break-words leading-relaxed overflow-hidden">
                  <code>{snippetContent}</code>
                </pre>
              </div>
            </div>

            {/* Claim Another Key link */}
            <div className="text-center pt-1">
              <button
                type="button"
                onClick={handleReset}
                className="text-xs text-zinc-500 hover:text-zinc-900 transition-colors underline underline-offset-4"
              >
                {t('free_token.claim_another')}
              </button>
            </div>
          </div>
        )}
      </main>

      {/* Minimal Footer */}
      <footer className="border-t border-zinc-200 py-6 text-center text-xs text-zinc-400">
        <p>© SmartGate — {t('free_token.footer_tagline')}</p>
      </footer>
    </div>
  )
}
