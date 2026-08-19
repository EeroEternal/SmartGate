const ADMIN_TOKEN = import.meta.env.VITE_ADMIN_TOKEN || 'admin123'
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

export async function adminFetch(path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers || {})
  if (!headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${ADMIN_TOKEN}`)
  }
  if (init.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json')
  }

  const res = await fetch(apiUrl(path), { ...init, headers })
  const data = await res.json().catch(() => ({ success: false, message: 'Invalid JSON response' }))
  if (!res.ok && data?.success !== true) {
    throw new Error(data?.message || `Request failed (${res.status})`)
  }
  return data
}
