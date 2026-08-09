import { ArrowRight, BarChart3, KeyRound, Route, ShieldCheck, Sparkles } from 'lucide-react'
import { Link } from 'react-router-dom'

const features = [
  { icon: Route, title: 'One endpoint, smarter routing', text: 'Connect your model providers once and let SmartGate route each request by cost, capability, and health.' },
  { icon: BarChart3, title: 'Know what you use', text: 'See tokens, estimated spend, response time, and the model services serving your requests.' },
  { icon: Sparkles, title: 'Spend less by default', text: 'Cost-aware routing and context controls help you avoid paying for more capacity than each task needs.' },
]

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-zinc-50 text-zinc-950">
      <header className="max-w-6xl mx-auto px-6 py-6 flex items-center justify-between">
        <Link to="/" className="flex items-center gap-3 font-semibold tracking-tight">
          <span className="w-9 h-9 rounded-xl bg-zinc-950 text-white flex items-center justify-center"><span className="w-4 h-4 border-2 border-white rounded-sm" /></span>
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
            <div className="inline-flex items-center gap-2 rounded-full bg-white border border-zinc-200 px-3 py-1 text-xs text-zinc-600"><Sparkles className="w-3.5 h-3.5" /> Your personal AI gateway</div>
            <h1 className="mt-6 text-5xl md:text-7xl font-semibold tracking-[-0.06em] leading-[.98]">Use the best model.<br /><span className="text-zinc-400">Keep control.</span></h1>
            <p className="mt-7 max-w-xl text-lg leading-8 text-zinc-600">SmartGate gives you one simple API for your AI model services, with routing that understands cost, capability, and your budget.</p>
            <div className="mt-9 flex flex-wrap items-center gap-4">
              <Link to="/register" className="inline-flex items-center gap-2 rounded-lg bg-zinc-950 text-white px-5 py-3 text-sm font-medium hover:bg-zinc-700">Create your workspace <ArrowRight className="w-4 h-4" /></Link>
              <Link to="/login" className="text-sm font-medium text-zinc-600 hover:text-zinc-950">Already have an account?</Link>
            </div>
            <p className="mt-5 text-xs text-zinc-500">Personal-first. No enterprise setup required.</p>
          </div>
          <div className="rounded-3xl sg-dark-surface p-5 shadow-2xl shadow-zinc-300/50 rotate-1">
            <div className="rounded-2xl bg-zinc-900 border border-zinc-800 p-5 text-white">
              <div className="flex items-center justify-between text-xs text-zinc-400"><span>Overview</span><span className="text-emerald-400">● All systems ready</span></div>
              <div className="mt-8 text-4xl font-mono">$2.84</div><div className="mt-1 text-sm text-zinc-500">estimated spend · this month</div>
              <div className="mt-8 grid grid-cols-2 gap-3"><div className="rounded-xl bg-zinc-800 p-4"><div className="text-xs text-zinc-500">Requests</div><div className="mt-2 font-mono text-xl">1,284</div></div><div className="rounded-xl bg-zinc-800 p-4"><div className="text-xs text-zinc-500">Estimated saved</div><div className="mt-2 font-mono text-xl text-emerald-400">$1.17</div></div></div>
              <div className="mt-3 rounded-xl bg-zinc-800 p-4"><div className="flex justify-between text-xs text-zinc-500"><span>Model services</span><span>3 active</span></div><div className="mt-4 h-2 rounded-full bg-zinc-700"><div className="h-full w-3/4 rounded-full bg-white" /></div></div>
            </div>
          </div>
        </section>
        <section className="border-y border-zinc-200 bg-white"><div className="max-w-6xl mx-auto px-6 py-20 grid md:grid-cols-3 gap-10">{features.map(({ icon: Icon, title, text }) => <div key={title}><Icon className="w-5 h-5" /><h2 className="mt-5 font-semibold">{title}</h2><p className="mt-2 text-sm leading-6 text-zinc-500">{text}</p></div>)}</div></section>
        <section className="max-w-6xl mx-auto px-6 py-20 flex flex-col md:flex-row md:items-center justify-between gap-8"><div><h2 className="text-3xl font-semibold tracking-tight">Your models, your keys, your numbers.</h2><p className="mt-2 text-zinc-500">Start with a personal workspace and grow only when you need to.</p></div><Link to="/register" className="inline-flex items-center gap-2 text-sm font-medium">Start free <ArrowRight className="w-4 h-4" /></Link></section>
      </main>
      <footer className="max-w-6xl mx-auto px-6 py-8 text-xs text-zinc-500 flex justify-between"><span>© SmartGate</span><span>Open gateway infrastructure for personal AI workflows</span></footer>
    </div>
  )
}
