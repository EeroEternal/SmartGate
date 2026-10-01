import { useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import {
  Zap,
  Key,
  Copy,
  Check,
  Search,
  ExternalLink,
  Shield,
  Layers,
  Terminal,
  Sparkles,
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

interface FreeModelItem {
  id: string
  name: string
  context_length: number
  is_free: boolean
}

interface PoolInfo {
  enabled: boolean
  default_rpm_limit: number
  default_concurrency_limit: number
  default_daily_spend_limit: number
  available_models: FreeModelItem[]
  total_keys_issued: number
}

interface KeyCheckResult {
  valid: boolean
  key_prefix: string
  name: string
  enabled: boolean
  rpm_limit: number | null
  concurrency_limit: number | null
  daily_spend_limit: number | null
  requests_today: number
  tokens_today: number
  last_used_at: string | null
  created_at: string
}

export default function LandingPage() {
  const { t } = useI18n()

  const [poolInfo, setPoolInfo] = useState<PoolInfo | null>(null)

  // Claiming state
  const [keyTag, setKeyTag] = useState('')
  const [claiming, setClaiming] = useState(false)
  const [claimResult, setClaimResult] = useState<ClaimResult | null>(null)
  const [claimError, setClaimError] = useState<string | null>(null)

  // Clipboard copies
  const [copiedKey, setCopiedKey] = useState(false)
  const [copiedUrl, setCopiedUrl] = useState(false)
  const [copiedSnippet, setCopiedSnippet] = useState(false)

  // Integration tab
  const [activeTab, setActiveTab] = useState<'cursor' | 'cline' | 'claude' | 'python' | 'curl'>('cursor')

  // Check key state
  const [checkKeyInput, setCheckKeyInput] = useState('')
  const [checkingKey, setCheckingKey] = useState(false)
  const [checkResult, setCheckResult] = useState<KeyCheckResult | null>(null)
  const [checkError, setCheckError] = useState<string | null>(null)

  const fullBaseUrl = typeof window !== 'undefined'
    ? `${window.location.origin}/v1`
    : 'https://smartgate.run/v1'

  useEffect(() => {
    fetch(apiUrl('/api/free-token/info'))
      .then((res) => res.json())
      .then((data) => {
        if (data.success && data.data) {
          setPoolInfo(data.data)
        }
      })
      .catch((err) => console.error(err))
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
      } else {
        setClaimError(data.message || t('free_token.claim_failed'))
      }
    } catch {
      setClaimError(t('common.something_went_wrong'))
    } finally {
      setClaiming(false)
    }
  }

  async function handleCheckKey(e: FormEvent) {
    e.preventDefault()
    if (!checkKeyInput.trim()) return

    setCheckingKey(true)
    setCheckError(null)
    setCheckResult(null)

    try {
      const res = await fetch(apiUrl('/api/free-token/check'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ api_key: checkKeyInput.trim() }),
      })
      const data = await res.json()

      if (data.success && data.data) {
        setCheckResult(data.data)
      } else {
        setCheckError(data.message || t('free_token.check_failed'))
      }
    } catch {
      setCheckError(t('common.something_went_wrong'))
    } finally {
      setCheckingKey(false)
    }
  }

  function copyToClipboard(text: string, type: 'key' | 'url' | 'snippet') {
    navigator.clipboard.writeText(text)
    if (type === 'key') {
      setCopiedKey(true)
      setTimeout(() => setCopiedKey(false), 2000)
    } else if (type === 'url') {
      setCopiedUrl(true)
      setTimeout(() => setCopiedUrl(false), 2000)
    } else {
      setCopiedSnippet(true)
      setTimeout(() => setCopiedSnippet(false), 2000)
    }
  }

  const snippetContent = {
    cursor: `// Cursor > Settings > Models
// 1. In 'Model Names', enter: free-chat
// 2. Under 'Override OpenAI Base URL', enter:
${fullBaseUrl}
// 3. Under 'OpenAI API Key', paste your SmartGate key:
${claimResult?.api_key || 'sg-free-xxxxxxxxxxxxxxxx'}`,

    cline: `// Cline / Roo Code Settings
API Provider: OpenAI Compatible
Base URL: ${fullBaseUrl}
API Key: ${claimResult?.api_key || 'sg-free-xxxxxxxxxxxxxxxx'}
Model ID: free-chat`,

    claude: `export ANTHROPIC_BASE_URL="${fullBaseUrl}"
export ANTHROPIC_API_KEY="${claimResult?.api_key || 'sg-free-xxxxxxxxxxxxxxxx'}"`,

    python: `from openai import OpenAI

client = OpenAI(
    base_url="${fullBaseUrl}",
    api_key="${claimResult?.api_key || 'sg-free-xxxxxxxxxxxxxxxx'}",
)

response = client.chat.completions.create(
    model="free-chat",
    messages=[{"role": "user", "content": "Hello!"}],
)

print(response.choices[0].message.content)`,

    curl: `curl ${fullBaseUrl}/chat/completions \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer ${claimResult?.api_key || 'sg-free-xxxxxxxxxxxxxxxx'}" \\
  -d '{
    "model": "free-chat",
    "messages": [{"role": "user", "content": "Hello!"}]
  }'`,
  }[activeTab]

  return (
    <div className="min-h-screen bg-zinc-50 text-zinc-950 font-sans flex flex-col justify-between selection:bg-black selection:text-white">
      {/* Navigation Header */}
      <header className="border-b border-zinc-200 bg-white/80 backdrop-blur-md sticky top-0 z-30">
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-3 font-semibold tracking-tight text-zinc-900">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-zinc-950 text-white">
              <BrandMark className="h-5 w-5" />
            </span>
            <div className="flex flex-col">
              <span className="text-base font-bold leading-tight">SmartGate</span>
              <span className="text-[10px] font-mono uppercase tracking-widest text-zinc-500">
                {t('free_token.header_badge')}
              </span>
            </div>
          </Link>

          <div className="flex items-center gap-4">
            <div className="hidden sm:flex items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-800">
              <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
              <span>{t('free_token.live_pool_active')}</span>
            </div>

            <LanguageSwitcher size="sm" />

            <Link
              to="/admin"
              className="inline-flex items-center gap-1.5 rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-100 transition-colors"
            >
              <Shield className="h-3.5 w-3.5 text-zinc-500" />
              <span>{t('nav.admin_console')}</span>
            </Link>
          </div>
        </div>
      </header>

      {/* Main Container */}
      <main className="flex-1 max-w-5xl mx-auto px-6 py-12 sm:py-16 space-y-16 w-full">
        {/* Hero Section */}
        <section className="text-center space-y-4 max-w-3xl mx-auto">
          <div className="inline-flex items-center gap-2 rounded-full border border-zinc-200 bg-white px-3.5 py-1 text-xs font-mono text-zinc-600 shadow-sm">
            <Sparkles className="h-3.5 w-3.5 text-zinc-900" />
            <span>{t('free_token.hero_badge')}</span>
          </div>

          <h1 className="text-4xl sm:text-6xl font-extrabold tracking-tight text-zinc-900 leading-[1.08]">
            {t('free_token.hero_title_line1')}
            <br />
            <span className="text-zinc-500">{t('free_token.hero_title_line2')}</span>
          </h1>

          <p className="text-base sm:text-lg text-zinc-600 leading-relaxed max-w-2xl mx-auto">
            {t('free_token.hero_desc')}
          </p>
        </section>

        {/* Claim API Key Card */}
        <section className="max-w-3xl mx-auto">
          {!claimResult ? (
            <div className="rounded-2xl border border-zinc-200 bg-white p-6 sm:p-8 shadow-xl shadow-zinc-200/50 space-y-6">
              <div className="space-y-1 text-left">
                <h2 className="text-lg font-bold text-zinc-900 flex items-center gap-2">
                  <Key className="h-5 w-5 text-zinc-900" />
                  {t('free_token.claim_card_title')}
                </h2>
                <p className="text-xs sm:text-sm text-zinc-500">
                  {t('free_token.claim_card_subtitle')}
                </p>
              </div>

              {claimError && (
                <div className="rounded-lg bg-rose-50 border border-rose-200 p-3 text-xs text-rose-700">
                  {claimError}
                </div>
              )}

              <form onSubmit={handleClaim} className="space-y-4">
                <div>
                  <label htmlFor="agent-name-input" className="block text-xs font-medium text-zinc-700 text-left">
                    {t('free_token.agent_tag_label')}
                  </label>
                  <input
                    id="agent-name-input"
                    type="text"
                    value={keyTag}
                    onChange={(e) => setKeyTag(e.target.value)}
                    placeholder={t('free_token.agent_tag_placeholder')}
                    className="mt-1.5 w-full rounded-lg border border-zinc-300 bg-white px-3.5 py-2.5 text-sm h-11 focus:border-black focus:ring-1 focus:ring-black focus:outline-none placeholder:text-zinc-400"
                  />
                  <p className="mt-1 text-[11px] text-zinc-400 text-left">
                    {t('free_token.agent_tag_hint')}
                  </p>
                </div>

                <button
                  type="submit"
                  disabled={claiming}
                  className="w-full rounded-lg bg-zinc-950 px-6 py-3.5 text-sm font-semibold text-white hover:bg-zinc-800 disabled:opacity-50 transition-colors shadow flex items-center justify-center gap-2"
                >
                  <Zap className={`h-4 w-4 ${claiming ? 'animate-bounce' : ''}`} />
                  {claiming ? t('free_token.claiming_button') : t('free_token.claim_button')}
                </button>
              </form>

              {/* Instant Benefits Pills */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2 text-left">
                <div className="rounded-lg border border-zinc-100 bg-zinc-50 p-3 text-xs">
                  <div className="font-semibold text-zinc-900">{t('free_token.benefit_zero_login_title')}</div>
                  <div className="text-zinc-500 mt-0.5">{t('free_token.benefit_zero_login_desc')}</div>
                </div>
                <div className="rounded-lg border border-zinc-100 bg-zinc-50 p-3 text-xs">
                  <div className="font-semibold text-zinc-900">{t('free_token.benefit_compatible_title')}</div>
                  <div className="text-zinc-500 mt-0.5">{t('free_token.benefit_compatible_desc')}</div>
                </div>
                <div className="rounded-lg border border-zinc-100 bg-zinc-50 p-3 text-xs">
                  <div className="font-semibold text-zinc-900">{t('free_token.benefit_pool_title')}</div>
                  <div className="text-zinc-500 mt-0.5">{t('free_token.benefit_pool_desc')}</div>
                </div>
              </div>
            </div>
          ) : (
            /* Result Panel when Key is generated */
            <div className="rounded-2xl border border-zinc-900 bg-zinc-950 text-white p-6 sm:p-8 shadow-2xl space-y-6">
              <div className="flex items-start justify-between gap-4">
                <div className="space-y-1 text-left">
                  <div className="flex items-center gap-2">
                    <span className="flex h-6 w-6 items-center justify-center rounded-full bg-emerald-400/20 text-emerald-400">
                      <CheckCircle2 className="h-4 w-4" />
                    </span>
                    <h2 className="text-lg font-bold text-white">
                      {t('free_token.key_ready_title')}
                    </h2>
                  </div>
                  <p className="text-xs text-zinc-400">
                    {t('free_token.key_ready_subtitle')}
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() => {
                    setClaimResult(null)
                    setKeyTag('')
                  }}
                  className="rounded-md border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-xs text-zinc-300 hover:text-white hover:bg-zinc-800 transition-colors"
                >
                  {t('free_token.claim_another')}
                </button>
              </div>

              {/* API Key Box */}
              <div className="rounded-xl border border-zinc-800 bg-zinc-900/90 p-4 space-y-2 text-left">
                <div className="flex items-center justify-between text-xs text-zinc-400">
                  <span>{t('free_token.your_api_key')}</span>
                  <span className="text-[11px] text-amber-400 font-mono">
                    {t('free_token.save_warning')}
                  </span>
                </div>

                <div className="flex items-center justify-between gap-2 rounded-lg bg-black border border-zinc-800 px-3 py-2 font-mono text-sm text-emerald-400">
                  <span className="truncate">{claimResult.api_key}</span>
                  <button
                    type="button"
                    onClick={() => copyToClipboard(claimResult.api_key, 'key')}
                    className="shrink-0 inline-flex items-center gap-1 rounded bg-zinc-800 px-2.5 py-1 text-xs font-sans text-white hover:bg-zinc-700 transition-colors"
                  >
                    {copiedKey ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
                    <span>{copiedKey ? t('common.copied') : t('common.copy')}</span>
                  </button>
                </div>
              </div>

              {/* Endpoint & Quota Details */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-left">
                <div className="rounded-lg bg-zinc-900 border border-zinc-800 p-3">
                  <div className="text-[11px] text-zinc-400">{t('free_token.base_url_label')}</div>
                  <div className="mt-1 font-mono text-xs text-white truncate flex items-center justify-between gap-1">
                    <span>{fullBaseUrl}</span>
                    <button
                      type="button"
                      onClick={() => copyToClipboard(fullBaseUrl, 'url')}
                      className="text-zinc-400 hover:text-white"
                      title={t('common.copy')}
                    >
                      {copiedUrl ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
                    </button>
                  </div>
                </div>

                <div className="rounded-lg bg-zinc-900 border border-zinc-800 p-3">
                  <div className="text-[11px] text-zinc-400">{t('free_token.default_model_label')}</div>
                  <div className="mt-1 font-mono text-xs text-white">
                    {claimResult.default_model}
                  </div>
                </div>

                <div className="rounded-lg bg-zinc-900 border border-zinc-800 p-3">
                  <div className="text-[11px] text-zinc-400">{t('free_token.rpm_limit_label')}</div>
                  <div className="mt-1 font-mono text-xs text-emerald-400">
                    {claimResult.quota.rpm_limit} RPM
                  </div>
                </div>

                <div className="rounded-lg bg-zinc-900 border border-zinc-800 p-3">
                  <div className="text-[11px] text-zinc-400">{t('free_token.concurrency_label')}</div>
                  <div className="mt-1 font-mono text-xs text-white">
                    {claimResult.quota.concurrency_limit} concurrent
                  </div>
                </div>
              </div>

              {/* Agent Quick Setup Tabs */}
              <div className="space-y-3 text-left pt-2">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-400 flex items-center gap-1.5">
                    <Terminal className="h-3.5 w-3.5" />
                    {t('free_token.quick_agent_setup')}
                  </h3>

                  <div className="flex items-center gap-1 bg-zinc-900 p-1 rounded-lg border border-zinc-800">
                    {(['cursor', 'cline', 'claude', 'python', 'curl'] as const).map((tab) => (
                      <button
                        key={tab}
                        type="button"
                        onClick={() => setActiveTab(tab)}
                        className={`rounded px-2.5 py-1 text-xs font-medium capitalize transition-colors ${
                          activeTab === tab
                            ? 'bg-zinc-800 text-white shadow-sm'
                            : 'text-zinc-400 hover:text-white'
                        }`}
                      >
                        {tab === 'cline' ? 'Cline / Roo' : tab === 'claude' ? 'Claude Code' : tab}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="relative rounded-xl bg-black border border-zinc-800 p-4">
                  <button
                    type="button"
                    onClick={() => copyToClipboard(snippetContent, 'snippet')}
                    className="absolute right-3 top-3 inline-flex items-center gap-1 rounded bg-zinc-800 px-2 py-1 text-[11px] text-zinc-300 hover:text-white hover:bg-zinc-700 transition-colors"
                  >
                    {copiedSnippet ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
                    <span>{copiedSnippet ? t('common.copied') : t('common.copy')}</span>
                  </button>

                  <pre className="font-mono text-xs text-zinc-300 whitespace-pre-wrap break-words leading-relaxed overflow-hidden">
                    <code>{snippetContent}</code>
                  </pre>
                </div>
              </div>
            </div>
          )}
        </section>

        {/* Check Existing Key Inspector */}
        <section className="max-w-3xl mx-auto rounded-xl border border-zinc-200 bg-white p-6 shadow-sm space-y-4 text-left">
          <div className="flex items-center gap-2">
            <Search className="h-4 w-4 text-zinc-700" />
            <h2 className="text-sm font-bold text-zinc-900">
              {t('free_token.check_key_title')}
            </h2>
          </div>
          <p className="text-xs text-zinc-500">
            {t('free_token.check_key_desc')}
          </p>

          <form onSubmit={handleCheckKey} className="flex gap-2">
            <input
              type="text"
              value={checkKeyInput}
              onChange={(e) => setCheckKeyInput(e.target.value)}
              placeholder="sg-free-xxxxxxxxxxxxxxxxxxxxxxxx"
              className="flex-1 rounded-md border border-zinc-300 px-3 py-1.5 text-xs font-mono h-9 focus:border-black focus:outline-none"
            />
            <button
              type="submit"
              disabled={checkingKey}
              className="rounded-md bg-zinc-900 px-4 py-1.5 text-xs font-medium text-white hover:bg-zinc-800 disabled:opacity-50 transition-colors h-9"
            >
              {checkingKey ? t('common.loading') : t('free_token.check_btn')}
            </button>
          </form>

          {checkError && (
            <div className="rounded-md bg-rose-50 border border-rose-200 p-2.5 text-xs text-rose-700">
              {checkError}
            </div>
          )}

          {checkResult && (
            <div className="rounded-lg bg-zinc-50 border border-zinc-200 p-4 space-y-3">
              <div className="flex items-center justify-between text-xs">
                <span className="font-mono font-medium text-zinc-900">{checkResult.name}</span>
                <span
                  className={`rounded px-2 py-0.5 text-[11px] font-medium ${
                    checkResult.enabled ? 'bg-emerald-100 text-emerald-800' : 'bg-zinc-200 text-zinc-700'
                  }`}
                >
                  {checkResult.enabled ? t('common.active') : t('common.disabled')}
                </span>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                <div className="rounded bg-white p-2 border border-zinc-200">
                  <div className="text-zinc-400 text-[10px]">{t('free_token.rpm_limit_label')}</div>
                  <div className="font-mono font-semibold text-zinc-900 mt-0.5">
                    {checkResult.rpm_limit ?? '—'} RPM
                  </div>
                </div>

                <div className="rounded bg-white p-2 border border-zinc-200">
                  <div className="text-zinc-400 text-[10px]">{t('free_token.concurrency_label')}</div>
                  <div className="font-mono font-semibold text-zinc-900 mt-0.5">
                    {checkResult.concurrency_limit ?? '—'}
                  </div>
                </div>

                <div className="rounded bg-white p-2 border border-zinc-200">
                  <div className="text-zinc-400 text-[10px]">{t('free_token.col_requests_today')}</div>
                  <div className="font-mono font-semibold text-zinc-900 mt-0.5">
                    {checkResult.requests_today}
                  </div>
                </div>

                <div className="rounded bg-white p-2 border border-zinc-200">
                  <div className="text-zinc-400 text-[10px]">{t('free_token.col_tokens_today')}</div>
                  <div className="font-mono font-semibold text-zinc-900 mt-0.5">
                    {(checkResult.tokens_today / 1000).toFixed(1)}k
                  </div>
                </div>
              </div>
            </div>
          )}
        </section>

        {/* Available Free Models Grid */}
        <section className="space-y-6 max-w-4xl mx-auto text-left">
          <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-2">
            <div>
              <h2 className="text-xl font-bold text-zinc-900 flex items-center gap-2">
                <Layers className="h-5 w-5 text-zinc-900" />
                {t('free_token.models_title')}
              </h2>
              <p className="text-xs text-zinc-500 mt-1">
                {t('free_token.models_subtitle')}
              </p>
            </div>
            <span className="text-xs font-mono text-zinc-400">
              {poolInfo?.available_models.length ?? 0} {t('free_token.models_in_pool')}
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5">
            {/* Auto model card */}
            <div className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm hover:border-zinc-300 transition-colors flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between gap-2">
                  <span className="rounded-md bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-700 border border-emerald-200">
                    AUTO-ROUTER
                  </span>
                  <span className="text-[10px] font-mono text-zinc-400">128k context</span>
                </div>
                <h3 className="mt-2.5 text-sm font-semibold text-zinc-900">
                  free-chat
                </h3>
                <p className="mt-1 text-xs text-zinc-500 leading-relaxed">
                  {t('free_token.auto_model_desc')}
                </p>
              </div>
              <div className="mt-3 pt-2.5 border-t border-zinc-100 flex items-center justify-between text-[11px] font-mono text-zinc-400">
                <span>Model ID:</span>
                <span className="text-zinc-800 font-medium">free-chat</span>
              </div>
            </div>

            {/* Catalog models */}
            {poolInfo?.available_models
              .filter((m) => m.name !== 'free-chat' && m.name !== 'auto')
              .slice(0, 8)
              .map((model) => (
                <div
                  key={model.id}
                  className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm hover:border-zinc-300 transition-colors flex flex-col justify-between"
                >
                  <div>
                    <div className="flex items-center justify-between gap-2">
                      <span className="rounded-md bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-700 border border-emerald-200">
                        100% FREE
                      </span>
                      <span className="text-[10px] font-mono text-zinc-400">
                        {(model.context_length / 1024).toFixed(0)}k ctx
                      </span>
                    </div>
                    <h3 className="mt-2.5 text-sm font-semibold text-zinc-900 truncate" title={model.name}>
                      {model.name}
                    </h3>
                    <p className="mt-1 text-xs font-mono text-zinc-400 truncate" title={model.id}>
                      {model.id}
                    </p>
                  </div>
                  <div className="mt-3 pt-2.5 border-t border-zinc-100 flex items-center justify-between text-[11px] font-mono text-zinc-400">
                    <span>Model ID:</span>
                    <span className="text-zinc-800 font-medium truncate max-w-[150px]" title={model.id}>
                      {model.id}
                    </span>
                  </div>
                </div>
              ))}
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="border-t border-zinc-200 bg-white py-6">
        <div className="max-w-6xl mx-auto px-6 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-zinc-500">
          <div className="flex items-center gap-2">
            <span>© SmartGate</span>
            <span>—</span>
            <span>{t('free_token.footer_tagline')}</span>
          </div>

          <div className="flex items-center gap-4">
            <Link to="/admin" className="hover:text-black transition-colors">
              {t('nav.admin_console')}
            </Link>
            <a
              href="https://openrouter.ai"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-black transition-colors inline-flex items-center gap-1"
            >
              OpenRouter <ExternalLink className="h-3 w-3" />
            </a>
          </div>
        </div>
      </footer>
    </div>
  )
}
