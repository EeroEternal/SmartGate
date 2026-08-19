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

export interface ApiResult<T = any> {
  success: boolean
  data?: T
  message?: string
}

export async function saasFetch<T = any>(path: string, init: RequestInit = {}): Promise<ApiResult<T>> {
  const headers = new Headers(init.headers || {})
  if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json')
  const response = await fetch(apiUrl(path), { ...init, headers, credentials: 'include' })
  const data = await response.json().catch(() => ({ success: false, message: 'Invalid server response' }))
  if (!response.ok && data?.success !== true) throw new Error(data?.message || `Request failed (${response.status})`)
  return data
}

export const saasMe = () => saasFetch('/api/saas/auth/me')
export const saasUpdateProfile = (data: { current_password: string; email?: string; new_password?: string }) =>
  saasFetch('/api/saas/auth/me', { method: 'PATCH', body: JSON.stringify(data) })
export const saasLogout = () => saasFetch('/api/saas/auth/logout', { method: 'POST' })
