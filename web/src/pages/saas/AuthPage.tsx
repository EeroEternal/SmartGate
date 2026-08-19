import { FormEvent, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { saasFetch } from '../../lib/saasApi'
import BrandMark from '../../components/BrandMark'
import { useI18n } from '../../lib/i18n'
import { LanguageSwitcher } from '../../components/LanguageSwitcher'

export default function AuthPage({ mode }: { mode: 'login' | 'register' }) {
  const { t } = useI18n()
  const navigate = useNavigate()
  const location = useLocation()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [verificationCode, setVerificationCode] = useState('')
  const [codeSent, setCodeSent] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const isRegister = mode === 'register'

  async function sendVerificationCode() {
    setError('')
    setBusy(true)
    try {
      const result = await saasFetch('/api/saas/auth/send-verification-code', {
        method: 'POST',
        body: JSON.stringify({ email }),
      })
      if (!result.success) throw new Error(result.message || 'Unable to send the verification code')
      setCodeSent(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to send the verification code')
    } finally {
      setBusy(false)
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    setError('')
    if (isRegister && !codeSent) {
      await sendVerificationCode()
      return
    }
    setBusy(true)
    try {
      const body = isRegister ? { email, password, verification_code: verificationCode } : { email, password }
      const result = await saasFetch(`/api/saas/auth/${mode}`, { method: 'POST', body: JSON.stringify(body) })
      if (!result.success) throw new Error(result.message || 'Unable to continue')
      navigate('/app', { replace: true, state: { from: location.pathname } })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to continue')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="min-h-screen bg-zinc-50 flex items-center justify-center px-6 py-12">
      <div className="w-full max-w-md">
        <div className="flex items-center justify-between">
          <Link to="/" className="flex items-center gap-3 font-semibold tracking-tight">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary text-white"><BrandMark className="h-6 w-6" /></span>
            SmartGate
          </Link>
          <LanguageSwitcher size="sm" />
        </div>
        <div className="mt-8 bg-white border border-zinc-200 rounded-2xl p-8 shadow-sm">
          <h1 className="text-2xl font-semibold tracking-tight">{isRegister ? t('auth.sign_up') : t('auth.sign_in')}</h1>
          <p className="mt-2 text-sm text-zinc-500">{isRegister ? 'Your personal AI gateway starts here.' : 'Sign in to manage your model services.'}</p>
          <form onSubmit={submit} className="mt-8 space-y-5">
            <label className="block text-sm font-medium">{t('auth.email_label')}
              <input required type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} className="mt-2 w-full rounded-lg border border-zinc-300 px-3 py-2.5 outline-none focus:border-zinc-950" />
            </label>
            <label className="block text-sm font-medium">{t('auth.password_label')}
              <input required minLength={10} type="password" autoComplete={isRegister ? 'new-password' : 'current-password'} value={password} onChange={(e) => setPassword(e.target.value)} className="mt-2 w-full rounded-lg border border-zinc-300 px-3 py-2.5 outline-none focus:border-zinc-950" />
              <span className="mt-2 block text-xs text-zinc-500">At least 10 characters.</span>
            </label>
            {isRegister && (
              <div>
                <label className="block text-sm font-medium">{t('auth.code_label')}
                  <input required={codeSent} inputMode="numeric" pattern="[0-9]{6}" maxLength={6} value={verificationCode} onChange={(e) => setVerificationCode(e.target.value.replace(/\D/g, ''))} disabled={!codeSent} placeholder={codeSent ? 'Enter the 6-digit code' : 'Send a code first'} className="mt-2 w-full rounded-lg border border-zinc-300 px-3 py-2.5 outline-none focus:border-zinc-950 disabled:bg-zinc-100" />
                </label>
                <p className="mt-2 text-xs text-zinc-500">{codeSent ? 'The code expires in 10 minutes.' : 'We will send a one-time code to your email.'}</p>
                {codeSent && <button type="button" onClick={sendVerificationCode} disabled={busy} className="mt-2 text-sm font-medium text-zinc-950 disabled:opacity-50">Resend code</button>}
              </div>
            )}
            {error && <div className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div>}
            <button disabled={busy} className="w-full rounded-lg bg-zinc-950 py-3 text-sm font-medium text-white disabled:opacity-50">{busy ? 'Please wait…' : isRegister && !codeSent ? t('auth.send_code') : isRegister ? t('auth.sign_up_btn') : t('auth.sign_in_btn')}</button>
          </form>
          <p className="mt-6 text-center text-sm text-zinc-500">{isRegister ? t('auth.have_account') : t('auth.no_account')} <Link className="font-medium text-zinc-950" to={isRegister ? '/login' : '/register'}>{isRegister ? t('auth.sign_in_btn') : t('auth.sign_up_btn')}</Link></p>
        </div>
      </div>
    </div>
  )
}

