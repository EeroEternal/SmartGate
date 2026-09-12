import { FormEvent, ReactNode, useEffect, useRef, useState } from 'react'
import { ChevronDown, LogOut, Pencil, UserCircle, X } from 'lucide-react'
import { Link, useLocation } from 'react-router-dom'
import { saasFetch, saasLogout, saasUpdateProfile } from '../../lib/saasApi'
import BrandMark from '../../components/BrandMark'
import { useI18n } from '../../lib/i18n'
import { useModal } from '../../lib/modal'
import { LanguageSwitcher } from '../../components/LanguageSwitcher'
import { ErrorMessage, Field, errorText } from './components'
import { ModelServicesProvider } from './useModelServices'

export function SaasLayout({ children }: { children: ReactNode }) {
  const { t } = useI18n()
  const location = useLocation()
  const [email, setEmail] = useState('')
  const [accountOpen, setAccountOpen] = useState(false)
  const [profileOpen, setProfileOpen] = useState(false)
  const accountRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    saasFetch<{ email: string }>('/api/saas/auth/me')
      .then((result) => setEmail(result.data?.email || ''))
      .catch(() => {})
  }, [])

  useEffect(() => {
    function closeOnOutsideClick(event: MouseEvent) {
      if (accountRef.current && !accountRef.current.contains(event.target as Node)) setAccountOpen(false)
    }
    document.addEventListener('mousedown', closeOnOutsideClick)
    return () => document.removeEventListener('mousedown', closeOnOutsideClick)
  }, [])

  async function logout() {
    await saasLogout()
    window.location.href = '/'
  }

  const navGroups: { label?: string; items: { label: string; href: string }[] }[] = [
    {
      items: [{ label: t('nav.overview'), href: '/app' }],
    },
    {
      label: t('nav.group_setup'),
      items: [
        { label: t('nav.providers'), href: '/app/providers' },
        { label: t('nav.model_services'), href: '/app/services' },
        { label: t('nav.api_keys'), href: '/app/keys' },
      ],
    },
    {
      label: t('nav.group_monitor'),
      items: [
        { label: t('nav.usage'), href: '/app/usage' },
        { label: t('nav.analytics'), href: '/app/analytics' },
        { label: t('nav.quality'), href: '/app/quality' },
      ],
    },
    {
      label: t('nav.group_explore'),
      items: [
        { label: t('nav.openrouter'), href: '/app/openrouter' },
        { label: t('nav.evaluation'), href: '/app/evaluation' },
        { label: t('nav.codex'), href: '/app/codex' },
      ],
    },
  ]
  const isActive = (href: string) => href === '/app' ? location.pathname === href : location.pathname.startsWith(href)

  return <div className="min-h-screen bg-zinc-50 text-zinc-950">
    <header className="h-16 border-b border-zinc-200 bg-white px-6 md:px-10 flex items-center justify-between">
      <Link to="/app" className="flex items-center gap-3 font-semibold tracking-tight">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-white"><BrandMark className="h-5 w-5" /></span>
        SmartGate
      </Link>
      <div className="flex items-center gap-4">
        <LanguageSwitcher size="sm" />
        <div ref={accountRef} className="relative">
          <button type="button" onClick={() => setAccountOpen((open) => !open)} aria-label={t('common.open_account_menu')} aria-expanded={accountOpen} aria-haspopup="menu" className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-zinc-600 hover:bg-zinc-100 hover:text-zinc-950">
            <UserCircle className="h-6 w-6" />
            <ChevronDown className={`h-4 w-4 transition-transform ${accountOpen ? 'rotate-180' : ''}`} />
          </button>
          {accountOpen && <div role="menu" className="absolute right-0 z-20 mt-2 w-64 rounded-xl border border-zinc-200 bg-white p-2 shadow-lg">
            <div className="border-b border-zinc-100 px-3 py-2"><div className="text-xs text-zinc-400">{t('common.signed_in_as')}</div><div className="mt-1 truncate text-sm font-medium text-zinc-900">{email || t('common.default_account')}</div></div>
            <button type="button" role="menuitem" onClick={() => { setAccountOpen(false); setProfileOpen(true) }} className="mt-1 flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-zinc-600 hover:bg-zinc-100 hover:text-zinc-950"><Pencil className="h-4 w-4" /> {t('profile.title')}</button>
            <button type="button" role="menuitem" onClick={logout} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-zinc-600 hover:bg-zinc-100 hover:text-zinc-950"><LogOut className="h-4 w-4" /> {t('nav.sign_out')}</button>
          </div>}
          {profileOpen && <ProfileDialog email={email} onClose={() => setProfileOpen(false)} onSaved={(updatedEmail) => { setEmail(updatedEmail); setProfileOpen(false) }} />}
        </div>
      </div>
    </header>
    <div className="mx-auto grid max-w-[1440px] min-w-0 gap-8 px-6 py-8 md:px-10 lg:grid-cols-[220px_minmax(0,1fr)]">
      <aside className="min-w-0 space-y-5 lg:sticky lg:top-8 lg:self-start">
        {navGroups.map((group, groupIndex) => (
          <div key={group.label || `group-${groupIndex}`} className="space-y-1">
            {group.label && (
              <div className="px-3 pb-1 text-[11px] font-medium uppercase tracking-wider text-zinc-400">
                {group.label}
              </div>
            )}
            {group.items.map(({ label, href }) => (
              <Link
                key={href}
                to={href}
                className={`block rounded-lg px-3 py-2 text-sm ${isActive(href) ? 'bg-white text-zinc-950 shadow-sm' : 'text-zinc-600 hover:bg-white hover:text-zinc-950'}`}
              >
                {label}
              </Link>
            ))}
          </div>
        ))}
      </aside>
      {/* The shared model-service list lives here so every /app page under this layout
          consumes one cached copy instead of fetching it again on navigation. */}
      <main className="min-w-0">
        <ModelServicesProvider>{children}</ModelServicesProvider>
      </main>
    </div>
  </div>
}
function ProfileDialog({ email, onClose, onSaved }: { email: string; onClose: () => void; onSaved: (email: string) => void }) {
  const { t } = useI18n()
  const dialogRef = useModal({ onClose })
  const [updatedEmail, setUpdatedEmail] = useState(email)
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function submit(event: FormEvent) {
    event.preventDefault()
    setError('')
    setBusy(true)
    try {
      const result = await saasUpdateProfile({ current_password: currentPassword, email: updatedEmail, ...(newPassword ? { new_password: newPassword } : {}) })
      onSaved(result.data?.email || updatedEmail)
    } catch (err) {
      setError(errorText(err))
    } finally {
      setBusy(false)
    }
  }

  return <div ref={dialogRef} className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/30 p-4" role="dialog" aria-modal="true" aria-labelledby="profile-title">
    <form onSubmit={submit} className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
      <div className="flex items-start justify-between gap-4"><div><h2 id="profile-title" className="text-lg font-semibold">{t('profile.title')}</h2><p className="mt-1 text-sm text-zinc-500">{t('profile.subtitle')}</p></div><button type="button" onClick={onClose} className="rounded-lg p-2 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-950" aria-label={t('common.close')}><X className="h-5 w-5" /></button></div>
      <div className="mt-6 space-y-5"><Field label={t('profile.email')} value={updatedEmail} onChange={setUpdatedEmail} type="email" /><Field label={t('profile.new_password')} value={newPassword} onChange={setNewPassword} type="password" required={false} placeholder={t('profile.new_password_placeholder')} /><Field label={t('profile.current_password')} value={currentPassword} onChange={setCurrentPassword} type="password" placeholder={t('profile.current_password_placeholder')} /></div>
      {error && <div className="mt-4"><ErrorMessage text={error} /></div>}
      <div className="mt-6 flex justify-end gap-3"><button type="button" onClick={onClose} className="rounded-lg border border-zinc-300 px-4 py-2.5 text-sm text-zinc-600">{t('common.cancel')}</button><button disabled={busy} className="rounded-lg bg-zinc-950 px-5 py-2.5 text-sm text-white disabled:opacity-50">{busy ? (t('common.saving')) : (t('common.save'))}</button></div>
    </form>
  </div>
}

