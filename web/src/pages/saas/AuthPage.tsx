import { FormEvent, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { saasFetch } from '../../lib/saasApi'

export default function AuthPage({ mode }: { mode: 'login' | 'register' }) {
  const navigate = useNavigate()
  const location = useLocation()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const isRegister = mode === 'register'

  async function submit(event: FormEvent) {
    event.preventDefault(); setError(''); setBusy(true)
    try {
      const result = await saasFetch(`/api/saas/auth/${mode}`, { method: 'POST', body: JSON.stringify({ email, password }) })
      if (!result.success) throw new Error(result.message || 'Unable to continue')
      navigate('/app', { replace: true, state: { from: location.pathname } })
    } catch (err) { setError(err instanceof Error ? err.message : 'Unable to continue') } finally { setBusy(false) }
  }

  return <div className="min-h-screen bg-zinc-50 flex items-center justify-center px-6 py-12"><div className="w-full max-w-md"><Link to="/" className="flex justify-center items-center gap-3 font-semibold tracking-tight"><span className="w-9 h-9 rounded-xl bg-zinc-950 text-white flex items-center justify-center"><span className="w-4 h-4 border-2 border-white rounded-sm" /></span>XGate</Link><div className="mt-10 bg-white border border-zinc-200 rounded-2xl p-8 shadow-sm"><h1 className="text-2xl font-semibold tracking-tight">{isRegister ? 'Create your workspace' : 'Welcome back'}</h1><p className="mt-2 text-sm text-zinc-500">{isRegister ? 'Your personal AI gateway starts here.' : 'Sign in to manage your model services.'}</p><form onSubmit={submit} className="mt-8 space-y-5"><label className="block text-sm font-medium">Email<input required type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} className="mt-2 w-full rounded-lg border border-zinc-300 px-3 py-2.5 outline-none focus:border-zinc-950" /></label><label className="block text-sm font-medium">Password<input required minLength={10} type="password" autoComplete={isRegister ? 'new-password' : 'current-password'} value={password} onChange={(e) => setPassword(e.target.value)} className="mt-2 w-full rounded-lg border border-zinc-300 px-3 py-2.5 outline-none focus:border-zinc-950" /><span className="mt-2 block text-xs text-zinc-500">At least 10 characters.</span></label>{error && <div className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div>}<button disabled={busy} className="w-full rounded-lg bg-zinc-950 py-3 text-sm font-medium text-white disabled:opacity-50">{busy ? 'Please wait…' : isRegister ? 'Create account' : 'Sign in'}</button></form><p className="mt-6 text-center text-sm text-zinc-500">{isRegister ? 'Already have an account?' : 'New to SmartGate?'} <Link className="font-medium text-zinc-950" to={isRegister ? '/login' : '/register'}>{isRegister ? 'Sign in' : 'Create one'}</Link></p></div></div></div>
}
