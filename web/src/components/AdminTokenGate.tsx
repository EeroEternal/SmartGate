import { FormEvent, type ReactNode, useEffect, useState } from 'react'
import { adminFetch, AdminUnauthorizedError, clearAdminToken, getAdminToken, setAdminToken } from '../lib/api'
import { useI18n } from '../lib/i18n'

/**
 * Gate for the operations console.
 *
 * `ADMIN_TOKEN` is a deployment secret, so the operator enters it at runtime and it is
 * kept in `sessionStorage` for the tab. It is never compiled into the bundle (see
 * `lib/api.ts`), and a rejected token is dropped so the operator can try again.
 */
export default function AdminTokenGate({ children }: { children: ReactNode }) {
  const { t } = useI18n()
  const [authorized, setAuthorized] = useState(false)
  const [checking, setChecking] = useState(true)
  const [token, setToken] = useState('')
  const [error, setError] = useState('')

  // Validate a token left over from an earlier visit before rendering the console.
  useEffect(() => {
    let active = true
    if (!getAdminToken()) {
      setChecking(false)
      return
    }
    adminFetch('/api/admin/stats')
      .then(() => {
        if (active) setAuthorized(true)
      })
      .catch(() => {
        if (active) clearAdminToken()
      })
      .finally(() => {
        if (active) setChecking(false)
      })
    return () => {
      active = false
    }
  }, [])

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!token.trim()) return
    setError('')
    setChecking(true)
    setAdminToken(token)
    try {
      await adminFetch('/api/admin/stats')
      setAuthorized(true)
    } catch (err) {
      clearAdminToken()
      setError(
        err instanceof AdminUnauthorizedError
          ? t('admin.token_invalid')
          : err instanceof Error
            ? err.message
            : t('admin.token_invalid'),
      )
    } finally {
      setChecking(false)
    }
  }

  if (authorized) return <>{children}</>

  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-50 p-6">
      <form onSubmit={submit} className="w-full max-w-md rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
        <h1 className="text-lg font-semibold text-zinc-900">{t('nav.admin_console')}</h1>
        <p className="mt-2 text-sm text-zinc-500">{t('admin.token_hint')}</p>
        <label className="mt-5 block text-sm font-medium text-zinc-700">
          {t('admin.token_label')}
          <input
            type="password"
            autoComplete="off"
            spellCheck={false}
            value={token}
            onChange={(event) => setToken(event.target.value)}
            placeholder={t('admin.token_placeholder')}
            className="mt-1 h-9 w-full rounded-md border border-zinc-300 bg-white px-3 text-sm outline-none focus:border-zinc-900"
          />
        </label>
        {error && <p className="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}
        <button
          type="submit"
          disabled={checking || !token.trim()}
          className="mt-5 w-full rounded-lg bg-zinc-950 px-4 py-2.5 text-sm font-medium text-white disabled:opacity-50"
        >
          {checking ? t('common.loading') : t('admin.token_submit')}
        </button>
      </form>
    </div>
  )
}
