/**
 * Admin API client.
 *
 * The admin console authenticates with the deployment's `ADMIN_TOKEN`, which the
 * operator enters at runtime and which lives only in `sessionStorage` for the current
 * tab. It is deliberately NOT read from a `VITE_*` variable: Vite inlines those into
 * the public JavaScript bundle, which would publish the token to every visitor.
 */

const ADMIN_TOKEN_STORAGE_KEY = 'smartgate.admin_token'

/** Raised when the admin API rejects the stored token, so the gate can ask again. */
export class AdminUnauthorizedError extends Error {
  constructor(message = 'Admin authentication required') {
    super(message)
    this.name = 'AdminUnauthorizedError'
  }
}

function getApiBaseUrl(): string {
  if (typeof window !== 'undefined') {
    if (window.location.hostname === 'smartgate.run' || window.location.hostname.endsWith('.pages.dev')) {
      return 'https://api.smartgate.run'
    }
  }
  const envUrl = import.meta.env.VITE_API_BASE_URL?.replace(/\/$/, '') || ''
  if (envUrl.includes('xgate')) return ''
  return envUrl
}

const API_BASE_URL = getApiBaseUrl()

function apiUrl(path: string) {
  return API_BASE_URL ? `${API_BASE_URL}${path}` : path
}

export function getAdminToken(): string {
  if (typeof window === 'undefined') return ''
  return window.sessionStorage.getItem(ADMIN_TOKEN_STORAGE_KEY) || ''
}

export function setAdminToken(token: string) {
  if (typeof window === 'undefined') return
  const trimmed = token.trim()
  if (trimmed) {
    window.sessionStorage.setItem(ADMIN_TOKEN_STORAGE_KEY, trimmed)
  } else {
    window.sessionStorage.removeItem(ADMIN_TOKEN_STORAGE_KEY)
  }
}

export function clearAdminToken() {
  if (typeof window === 'undefined') return
  window.sessionStorage.removeItem(ADMIN_TOKEN_STORAGE_KEY)
}

export async function adminFetch(path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers || {})
  const token = getAdminToken()
  if (token && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${token}`)
  }
  if (init.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json')
  }

  const res = await fetch(apiUrl(path), { ...init, headers })
  if (res.status === 401 || res.status === 403) {
    clearAdminToken()
    throw new AdminUnauthorizedError()
  }
  const data = await res.json().catch(() => ({ success: false, message: 'Invalid JSON response' }))
  if (!res.ok && data?.success !== true) {
    throw new Error(data?.message || `Request failed (${res.status})`)
  }
  return data
}
