const ADMIN_TOKEN = import.meta.env.VITE_ADMIN_TOKEN || 'admin123'
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL?.replace(/\/$/, '') || ''

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
