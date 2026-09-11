import { CheckCircle2, ExternalLink, FileCode2, HelpCircle } from 'lucide-react'
import { Link } from 'react-router-dom'
import { useI18n } from '../../lib/i18n'
import { Page } from './components'

export function CodexPage() {
  const { t } = useI18n()
  const profileConfig = `model = "fusion"
model_provider = "smartgate"
preferred_auth_method = "apikey"
model_reasoning_effort = "high"
model_catalog_json = "/Users/you/.codex/models.json"

[model_providers.smartgate]
name = "SmartGate"
base_url = "https://smartgate.run/v1"
wire_api = "chat_completions"
experimental_bearer_token = "<project-api-key>"`

  const modelCatalog = `{
  "models": [{
    "slug": "fusion",
    "display_name": "Fusion (SmartGate)",
    "context_window": 128000,
    "max_context_window": 128000,
    "default_reasoning_level": "high",
    "supported_reasoning_levels": [
      {"effort": "low", "description": "Low reasoning effort"},
      {"effort": "high", "description": "High reasoning effort"}
    ],
    "supports_parallel_tool_calls": true,
    "support_verbosity": true,
    "default_verbosity": "low",
    "input_modalities": ["text"],
    "shell_type": "shell_command",
    "visibility": "list",
    "supported_in_api": true,
    "priority": 1,
    "truncation_policy": {"mode": "tokens", "limit": 10000},
    "tool_mode": "code_mode_only",
    "apply_patch_tool_type": "freeform",
    "experimental_supported_tools": [],
    "base_instructions": "You are a helpful coding assistant."
  }]
}`

  return (
    <Page>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <h1 className="text-xl font-semibold tracking-tight flex items-center gap-2">
            <FileCode2 className="h-5 w-5 text-primary" />
            {t('codex.title')}
          </h1>
          <span title={t('codex.subtitle')} className="cursor-help text-zinc-400 hover:text-zinc-600 transition-colors">
            <HelpCircle className="h-4 w-4" />
          </span>
        </div>
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-700">
          {t('codex.supported_badge')}
        </div>
      </div>

      <section className="mt-8 grid gap-4 md:grid-cols-3">
        {[
          ['1', t('codex.step1_title'), t('codex.step1_desc'), '/app/services', t('codex.step1_action')],
          ['2', t('codex.step2_title'), t('codex.step2_desc'), '/app/keys', t('codex.step2_action')],
          ['3', t('codex.step3_title'), t('codex.step3_desc'), null, null],
        ].map(([number, title, text, href, action]) => (
          <div key={number} className="rounded-xl border border-zinc-200 bg-white p-5">
            <div className="flex h-7 w-7 items-center justify-center rounded-full bg-primary text-xs font-semibold text-white">{number}</div>
            <h2 className="mt-4 font-semibold">{title}</h2>
            <p className="mt-2 text-sm leading-6 text-zinc-500">{text}</p>
            {href && action && (
              <Link to={href} className="mt-4 inline-flex items-center gap-1 text-sm font-medium text-primary hover:text-primary-hover">
                {action} <ExternalLink className="h-3.5 w-3.5" />
              </Link>
            )}
          </div>
        ))}
      </section>

      <section className="mt-8 rounded-xl border border-zinc-200 bg-white p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="font-semibold">{t('codex.profile_title')}</h2>
            <p className="mt-1 text-sm text-zinc-500">
              {t('codex.profile_desc', { path: '~/.codex/fusion.config.toml' })}
            </p>
          </div>
          <span className="shrink-0 rounded-full bg-zinc-100 px-3 py-1 text-xs text-zinc-600">
            {t('codex.profile_badge')}
          </span>
        </div>
        <pre className="mt-5 overflow-x-auto rounded-xl bg-zinc-950 p-5 text-xs leading-6 text-zinc-200"><code>{profileConfig}</code></pre>
        <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-900">
          <strong>{t('codex.why_chat_title')}</strong> {t('codex.why_chat_desc', { code: 'wire_api = "chat_completions"', param: 'thinking_budget' })}
        </div>
      </section>

      <section className="mt-6 rounded-xl border border-zinc-200 bg-white p-5">
        <div>
          <h2 className="font-semibold">{t('codex.catalog_title')}</h2>
          <p className="mt-1 text-sm text-zinc-500">
            {t('codex.catalog_desc', { path: '~/.codex/models.json', code: 'slug' })}
          </p>
        </div>
        <pre className="mt-5 max-h-[32rem] overflow-auto rounded-xl bg-zinc-950 p-5 text-xs leading-6 text-zinc-200"><code>{modelCatalog}</code></pre>
      </section>

      <section className="mt-6 grid gap-6 lg:grid-cols-2">
        <div className="rounded-xl border border-zinc-200 bg-white p-5">
          <h2 className="font-semibold">{t('codex.start_title')}</h2>
          <p className="mt-2 text-sm leading-6 text-zinc-500">
            {t('codex.start_desc')}
          </p>
          <pre className="mt-4 overflow-x-auto rounded-lg bg-zinc-950 p-4 text-sm text-zinc-200"><code>/Applications/Codex.app/Contents/MacOS/ChatGPT --profile fusion</code></pre>
          <p className="mt-3 text-xs leading-5 text-zinc-500">
            {t('codex.restart_hint')}
          </p>
        </div>
        <div className="rounded-xl border border-zinc-200 bg-white p-5">
          <h2 className="font-semibold">{t('codex.troubleshooting_title')}</h2>
          <div className="mt-4 space-y-3 text-sm">
            <div className="flex gap-3">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
              <p><strong>{t('codex.err_401_title')}</strong> {t('codex.err_401_desc')}</p>
            </div>
            <div className="flex gap-3">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
              <p><strong>{t('codex.err_reasoning_title')}</strong> {t('codex.err_reasoning_desc', { effort: 'effort', description: 'description' })}</p>
            </div>
            <div className="flex gap-3">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
              <p><strong>{t('codex.err_path_title')}</strong> {t('codex.err_path_desc', { config: 'model_catalog_json' })}</p>
            </div>
          </div>
        </div>
      </section>

      <div className="mt-6 rounded-xl border border-zinc-200 bg-zinc-100 p-4 text-xs leading-5 text-zinc-600">
        {t('codex.security_warning', { token: 'experimental_bearer_token' })}
      </div>
    </Page>
  )
}
