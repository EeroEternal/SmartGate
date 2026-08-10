import { ArrowRight, BarChart3, KeyRound, Route, ShieldCheck, Sparkles } from 'lucide-react'
import { Link } from 'react-router-dom'
import BrandMark from '../../components/BrandMark'

const features = [
  { icon: Route, title: 'One endpoint, smarter routing', text: 'Connect your model providers once and let XGate route each request by cost, capability, and health.' },
  { icon: BarChart3, title: 'Know what you use', text: 'See tokens, estimated spend, response time, and the model services serving your requests.' },
  { icon: Sparkles, title: 'Spend less by default', text: 'Cost-aware routing and context controls help you avoid paying for more capacity than each task needs.' },
]

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-zinc-50 text-zinc-950">
      <header className="max-w-6xl mx-auto px-6 py-6 flex items-center justify-between">
        <Link to="/" className="flex items-center gap-3 font-semibold tracking-tight">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary text-white"><BrandMark className="h-6 w-6" /></span>
          XGate
        </Link>
        <div className="flex items-center gap-3 text-sm">
          <Link to="/login" className="px-4 py-2 text-zinc-600 hover:text-zinc-950">Sign in</Link>
          <Link to="/register" className="px-4 py-2 rounded-lg bg-zinc-950 text-white hover:bg-zinc-700">Get started</Link>
        </div>
      </header>
      <main>
        <section className="max-w-6xl mx-auto px-6 pt-20 pb-24 grid lg:grid-cols-[1.15fr_.85fr] gap-16 items-center">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full bg-white border border-zinc-200 px-3 py-1 text-xs text-zinc-600"><Sparkles className="w-3.5 h-3.5" /> Cost-aware AI routing</div>
            <h1 className="mt-6 text-5xl md:text-7xl font-semibold tracking-[-0.06em] leading-[.98]">Use the right model.<br /><span className="text-zinc-400">Spend less by default.</span></h1>
            <p className="mt-7 max-w-xl text-lg leading-8 text-zinc-600">XGate gives you one simple API for your AI model services, routing each request by cost, capability, and health so you do not overpay.</p>
            <p className="mt-4 text-sm font-medium text-zinc-600">Works with Codex through the OpenAI Responses API.</p>
            <div className="mt-9 flex flex-wrap items-center gap-4">
              <Link to="/register" className="inline-flex items-center gap-2 rounded-lg bg-zinc-950 text-white px-5 py-3 text-sm font-medium hover:bg-zinc-700">Create your workspace <ArrowRight className="w-4 h-4" /></Link>
              <Link to="/login" className="text-sm font-medium text-zinc-600 hover:text-zinc-950">Already have an account?</Link>
            </div>
          </div>
          <div className="rounded-3xl sg-dark-surface p-5 shadow-2xl shadow-zinc-300/50 rotate-1">
            <div className="rounded-2xl bg-zinc-900 border border-zinc-800 p-5 text-white">
              <div className="flex items-center justify-between text-xs sg-dark-muted"><span>Routing impact</span><span className="text-emerald-400">● Saving now</span></div>
              <div className="mt-8 flex items-end justify-between gap-4"><div><div className="text-xs sg-dark-muted">Estimated saved</div><div className="mt-2 text-4xl font-mono text-emerald-400">$1.17</div><div className="mt-1 text-sm sg-dark-muted">this month</div></div><div className="rounded-lg bg-emerald-400/10 px-3 py-2 text-right"><div className="text-xs sg-dark-muted">vs. default routing</div><div className="mt-1 text-sm font-semibold text-emerald-400">−29%</div></div></div>
              <div className="mt-8 rounded-xl bg-zinc-800 p-4"><div className="flex items-center justify-between text-xs"><span className="sg-dark-muted">Without cost routing</span><span className="font-mono text-zinc-300">$4.01</span></div><div className="mt-3 h-2 rounded-full bg-zinc-700"><div className="h-full w-full rounded-full bg-zinc-500" /></div><div className="mt-4 flex items-center justify-between text-xs"><span className="text-white">With XGate routing</span><span className="font-mono text-emerald-400">$2.84</span></div><div className="mt-3 h-2 rounded-full bg-zinc-700"><div className="h-full w-[71%] rounded-full bg-emerald-400" /></div></div>
              <div className="mt-3 flex items-center justify-between rounded-xl bg-zinc-800 p-4 text-xs"><span className="sg-dark-muted">Requests optimized</span><span className="font-mono text-white">1,284</span></div>
            </div>
          </div>
        </section>
        <section className="border-y border-zinc-200 bg-white"><div className="max-w-6xl mx-auto px-6 py-20 grid md:grid-cols-3 gap-10">{features.map(({ icon: Icon, title, text }) => <div key={title}><Icon className="w-5 h-5" /><h2 className="mt-5 font-semibold">{title}</h2><p className="mt-2 text-sm leading-6 text-zinc-500">{text}</p></div>)}</div></section>
        <section className="bg-zinc-950 text-white"><div className="max-w-6xl mx-auto px-6 py-20 grid lg:grid-cols-[.9fr_1.1fr] gap-12 items-center"><div><div className="flex items-center gap-2 text-sm text-zinc-300"><ShieldCheck className="w-4 h-4" /> Built for Codex</div><h2 className="mt-5 text-3xl font-semibold tracking-tight">Bring Codex into your model stack.</h2><p className="mt-4 max-w-xl text-sm leading-7 text-white/90">Use XGate with Codex through the OpenAI Responses API. Keep the Codex experience you know while XGate handles model choice, provider fallback, budgets, and usage visibility behind the scenes.</p><div className="mt-7 flex flex-wrap gap-3 text-sm"><span className="rounded-full border border-white/20 px-3 py-1.5 text-white/90">Codex GUI support</span><span className="rounded-full border border-white/20 px-3 py-1.5 text-white/90">Smart model routing</span><span className="rounded-full border border-white/20 px-3 py-1.5 text-white/90">Usage and budget controls</span></div></div><div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-6 shadow-xl"><div className="flex items-center justify-between border-b border-zinc-800 pb-5"><div><div className="text-xs uppercase tracking-[0.18em] text-zinc-400">Your coding workflow</div><div className="mt-2 text-xl font-semibold text-white">Codex <span className="text-zinc-500">×</span> XGate</div></div><div className="rounded-xl bg-emerald-400/10 px-3 py-2 text-xs font-medium text-emerald-400">Connected</div></div><div className="mt-6 space-y-3"><div className="flex items-center justify-between rounded-xl bg-zinc-800 px-4 py-3"><span className="text-sm text-white">Codex requests</span><span className="text-xs text-zinc-400">One gateway</span></div><div className="flex items-center justify-between rounded-xl bg-zinc-800 px-4 py-3"><span className="text-sm text-white">Model providers</span><span className="text-xs text-zinc-400">Smart fallback</span></div><div className="flex items-center justify-between rounded-xl bg-zinc-800 px-4 py-3"><span className="text-sm text-white">Spend visibility</span><span className="text-xs text-zinc-400">Always on</span></div></div></div></div></section>
        <section className="max-w-6xl mx-auto px-6 py-20 flex flex-col md:flex-row md:items-center justify-between gap-8"><div><h2 className="text-3xl font-semibold tracking-tight">Your models, your keys, your numbers.</h2><p className="mt-2 text-zinc-500">Start with a personal workspace and grow only when you need to.</p></div><Link to="/register" className="inline-flex items-center gap-2 text-sm font-medium">Start free <ArrowRight className="w-4 h-4" /></Link></section>
      </main>
      <footer className="max-w-6xl mx-auto px-6 py-8 text-xs text-zinc-500 flex justify-between"><span>© XGate</span><span>Spend less. Stay in control of every token.</span></footer>
    </div>
  )
}
