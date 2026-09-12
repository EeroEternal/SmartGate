import { ArrowRight, BarChart3, KeyRound, Route, ShieldCheck, Sparkles } from 'lucide-react'
import { Link } from 'react-router-dom'
import BrandMark from '../../components/BrandMark'
import { useI18n } from '../../lib/i18n'

const features = [
  { icon: Route, titleKey: 'landing.feature1_title', textKey: 'landing.feature1_text' },
  { icon: BarChart3, titleKey: 'landing.feature2_title', textKey: 'landing.feature2_text' },
  { icon: Sparkles, titleKey: 'landing.feature3_title', textKey: 'landing.feature3_text' },
]

export default function LandingPage() {
  const { t } = useI18n()
  return (
    <div className="min-h-screen bg-zinc-50 text-zinc-950">
      <header className="max-w-6xl mx-auto px-6 py-6 flex items-center justify-between">
        <Link to="/" className="flex items-center gap-3 font-semibold tracking-tight">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary text-white"><BrandMark className="h-6 w-6" /></span>
          SmartGate
        </Link>
        <div className="flex items-center gap-3 text-sm">
          <Link to="/login" className="px-4 py-2 text-zinc-600 hover:text-zinc-950">{t('auth.sign_in_btn')}</Link>
          <Link to="/register" className="px-4 py-2 rounded-lg bg-zinc-950 text-white hover:bg-zinc-700">{t('landing.get_started')}</Link>
        </div>
      </header>
      <main>
        <section className="max-w-6xl mx-auto px-6 pt-20 pb-24 grid lg:grid-cols-[1.15fr_.85fr] gap-16 items-center">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full bg-white border border-zinc-200 px-3 py-1 text-xs text-zinc-600"><Sparkles className="w-3.5 h-3.5" /> {t('landing.badge')}</div>
            <h1 className="mt-6 text-5xl md:text-7xl font-semibold tracking-[-0.06em] leading-[.98]">{t('landing.title_line1')}<br /><span className="text-zinc-400">{t('landing.title_line2')}</span></h1>
            <p className="mt-7 max-w-xl text-lg leading-8 text-zinc-600">{t('landing.hero_desc')}</p>
            <p className="mt-4 text-sm font-medium text-zinc-600">{t('landing.hero_codex_note')}</p>
            <div className="mt-9 flex flex-wrap items-center gap-4">
              <Link to="/register" className="inline-flex items-center gap-2 rounded-lg bg-zinc-950 text-white px-5 py-3 text-sm font-medium hover:bg-zinc-700">{t('landing.create_workspace')} <ArrowRight className="w-4 h-4" /></Link>
              <Link to="/login" className="text-sm font-medium text-zinc-600 hover:text-zinc-950">{t('landing.have_account')}</Link>
            </div>
          </div>
          <div className="rounded-3xl sg-dark-surface p-5 shadow-2xl shadow-zinc-300/50 rotate-1">
            <div className="rounded-2xl bg-zinc-900 border border-zinc-800 p-5 text-white">
              <div className="flex items-center justify-between text-xs sg-dark-muted"><span>{t('landing.mock_routing_impact')}</span><span className="text-emerald-400">{t('landing.mock_saving_now')}</span></div>
              <div className="mt-8 flex items-end justify-between gap-4"><div><div className="text-xs sg-dark-muted">{t('landing.mock_estimated_saved')}</div><div className="mt-2 text-4xl font-mono text-emerald-400">$1.17</div><div className="mt-1 text-sm sg-dark-muted">{t('landing.mock_this_month')}</div></div><div className="rounded-lg bg-emerald-400/10 px-3 py-2 text-right"><div className="text-xs sg-dark-muted">{t('landing.mock_vs_default')}</div><div className="mt-1 text-sm font-semibold text-emerald-400">−29%</div></div></div>
              <div className="mt-8 rounded-xl bg-zinc-800 p-4"><div className="flex items-center justify-between text-xs"><span className="sg-dark-muted">{t('landing.mock_without_routing')}</span><span className="font-mono text-zinc-300">$4.01</span></div><div className="mt-3 h-2 rounded-full bg-zinc-700"><div className="h-full w-full rounded-full bg-zinc-500" /></div><div className="mt-4 flex items-center justify-between text-xs"><span className="text-white">{t('landing.mock_with_routing')}</span><span className="font-mono text-emerald-400">$2.84</span></div><div className="mt-3 h-2 rounded-full bg-zinc-700"><div className="h-full w-[71%] rounded-full bg-emerald-400" /></div></div>
              <div className="mt-3 flex items-center justify-between rounded-xl bg-zinc-800 p-4 text-xs"><span className="sg-dark-muted">{t('landing.mock_requests_optimized')}</span><span className="font-mono text-white">1,284</span></div>
            </div>
          </div>
        </section>
        <section className="border-y border-zinc-200 bg-white"><div className="max-w-6xl mx-auto px-6 py-20 grid md:grid-cols-3 gap-10">{features.map(({ icon: Icon, titleKey, textKey }) => <div key={titleKey}><Icon className="w-5 h-5" /><h2 className="mt-5 font-semibold">{t(titleKey)}</h2><p className="mt-2 text-sm leading-6 text-zinc-500">{t(textKey)}</p></div>)}</div></section>
        <section className="bg-zinc-950 text-white"><div className="max-w-6xl mx-auto px-6 py-20 grid lg:grid-cols-[.9fr_1.1fr] gap-12 items-center"><div><div className="flex items-center gap-2 text-sm text-zinc-300"><ShieldCheck className="w-4 h-4" /> {t('landing.built_for_codex')}</div><h2 className="mt-5 text-3xl font-semibold tracking-tight">{t('landing.codex_title')}</h2><p className="mt-4 max-w-xl text-sm leading-7 text-white/90">{t('landing.codex_desc')}</p><div className="mt-7 flex flex-wrap gap-3 text-sm"><span className="rounded-full border border-white/20 px-3 py-1.5 text-white/90">{t('landing.codex_chip_gui')}</span><span className="rounded-full border border-white/20 px-3 py-1.5 text-white/90">{t('landing.codex_chip_routing')}</span><span className="rounded-full border border-white/20 px-3 py-1.5 text-white/90">{t('landing.codex_chip_budget')}</span></div></div><div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-6 shadow-xl"><div className="flex items-center justify-between border-b border-zinc-800 pb-5"><div><div className="text-xs uppercase tracking-[0.18em] text-zinc-400">{t('landing.mock_workflow')}</div><div className="mt-2 text-xl font-semibold text-white">Codex <span className="text-zinc-500">×</span> SmartGate</div></div><div className="rounded-xl bg-emerald-400/10 px-3 py-2 text-xs font-medium text-emerald-400">{t('landing.mock_connected')}</div></div><div className="mt-6 space-y-3"><div className="flex items-center justify-between rounded-xl bg-zinc-800 px-4 py-3"><span className="text-sm text-white">{t('landing.mock_codex_requests')}</span><span className="text-xs text-zinc-400">{t('landing.mock_one_gateway')}</span></div><div className="flex items-center justify-between rounded-xl bg-zinc-800 px-4 py-3"><span className="text-sm text-white">{t('landing.mock_model_providers')}</span><span className="text-xs text-zinc-400">{t('landing.mock_smart_fallback')}</span></div><div className="flex items-center justify-between rounded-xl bg-zinc-800 px-4 py-3"><span className="text-sm text-white">{t('landing.mock_spend_visibility')}</span><span className="text-xs text-zinc-400">{t('landing.mock_always_on')}</span></div></div></div></div></section>
        <section className="max-w-6xl mx-auto px-6 py-20 flex flex-col md:flex-row md:items-center justify-between gap-8"><div><h2 className="text-3xl font-semibold tracking-tight">{t('landing.cta_title')}</h2><p className="mt-2 text-zinc-500">{t('landing.cta_desc')}</p></div><Link to="/register" className="inline-flex items-center gap-2 text-sm font-medium">{t('landing.start_free')} <ArrowRight className="w-4 h-4" /></Link></section>
      </main>
      <footer className="max-w-6xl mx-auto px-6 py-8 text-xs text-zinc-500 flex justify-between"><span>{t('landing.footer_copyright')}</span><span>{t('landing.footer_tagline')}</span></footer>
    </div>
  )
}
