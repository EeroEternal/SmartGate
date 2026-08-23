import { useState, useEffect } from 'react'
import { BrowserRouter as Router, Routes, Route, Link, Navigate, useLocation } from 'react-router-dom'
import { LayoutDashboard, Database, ShieldCheck, Activity, Layers, Box } from 'lucide-react'
import LandingPage from './pages/saas/LandingPage'
import AuthPage from './pages/saas/AuthPage'
import SaasDashboard from './pages/saas/SaasDashboard'
import { AnalyticsPage, CodexPage, EvaluationPage, KeysPage, NewServicePage, OpenRouterPage, ProvidersPage, QualityPage, SaasLayout, ServiceDetailsPage, ServicesPage, UsagePage } from './pages/saas/SaasPages'
import HealthBadge from './components/HealthBadge'
import { adminFetch } from './lib/api'
import BrandMark from './components/BrandMark'
import Providers from './pages/Providers'
import Pools from './pages/Pools'
import PoolDetails from './pages/PoolDetails'
import VirtualModels from './pages/VirtualModels'
import AccessControl from './pages/access/AccessControl'
import Statistics from './pages/stats/Statistics'

import { I18nProvider, useI18n } from './lib/i18n'
import { LanguageSwitcher } from './components/LanguageSwitcher'

interface EndpointHealth {
  healthy: number
  degraded: number
  unavailable: number
}

function Dashboard() {
  const { t } = useI18n()
  const [health, setHealth] = useState<EndpointHealth | null>(null)
  const [stats, setStats] = useState<{ request_count: number; avg_latency: number } | null>(null)

  useEffect(() => {
    adminFetch('/api/admin/stats')
      .then((data) => {
        if (data.success) {
          setHealth(data.data.endpoint_health)
          setStats({
            request_count: data.data.request_count,
            avg_latency: data.data.avg_latency,
          })
        }
      })
      .catch(() => {})
  }, [])

  const total =
    (health?.healthy || 0) + (health?.degraded || 0) + (health?.unavailable || 0)

  return (
    <div className="max-w-4xl mx-auto space-y-8">
      <div>
        <h2 className="text-2xl font-bold text-zinc-900">{t('nav.dashboard')}</h2>
        <p className="text-sm text-zinc-500 mt-1">Endpoint health and recent gateway traffic.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white border border-zinc-200 rounded-lg p-5">
          <div className="text-sm text-zinc-500">Healthy Endpoints</div>
          <div className="mt-2 text-3xl font-mono font-bold text-zinc-900">
            {health?.healthy ?? '—'}
          </div>
          <div className="mt-3">
            <HealthBadge status="healthy" />
          </div>
        </div>
        <div className="bg-white border border-zinc-200 rounded-lg p-5">
          <div className="text-sm text-zinc-500">Degraded</div>
          <div className="mt-2 text-3xl font-mono font-bold text-zinc-900">
            {health?.degraded ?? '—'}
          </div>
          <div className="mt-3">
            <HealthBadge status="degraded" />
          </div>
        </div>
        <div className="bg-white border border-zinc-200 rounded-lg p-5">
          <div className="text-sm text-zinc-500">Unavailable</div>
          <div className="mt-2 text-3xl font-mono font-bold text-zinc-900">
            {health?.unavailable ?? '—'}
          </div>
          <div className="mt-3">
            <HealthBadge status="unavailable" />
          </div>
        </div>
      </div>

      <div className="bg-white border border-zinc-200 rounded-lg p-6 space-y-4">
        <h3 className="text-lg font-bold">Quick Snapshot</h3>
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <div className="text-zinc-500">Tracked Endpoints</div>
            <div className="font-mono text-xl mt-1">{total || '—'}</div>
          </div>
          <div>
            <div className="text-zinc-500">{t('overview.total_requests')}</div>
            <div className="font-mono text-xl mt-1">
              {stats?.request_count?.toLocaleString() ?? '—'}
            </div>
          </div>
          <div>
            <div className="text-zinc-500">{t('overview.avg_latency')}</div>
            <div className="font-mono text-xl mt-1">
              {stats ? `${Math.round(stats.avg_latency)}ms` : '—'}
            </div>
          </div>
        </div>
        <p className="text-xs text-zinc-500">
          Open a Model Pool to inspect per-endpoint health, active connections, and latency.
        </p>
      </div>
    </div>
  )
}

function Sidebar() {
  const { t } = useI18n()
  const location = useLocation()
  const isActive = (path: string) =>
    path === '/' ? location.pathname === '/' : location.pathname.startsWith(path)

  const navItemClass = (path: string) =>
    `flex items-center gap-3 px-3 py-2 text-sm font-medium rounded-md transition-colors ${
      isActive(path)
        ? 'bg-zinc-100 text-black'
        : 'text-zinc-600 hover:bg-zinc-50 hover:text-black'
    }`

  return (
    <div className="w-64 border-r border-zinc-200 bg-white flex flex-col">
      <div className="p-6 border-b border-zinc-200">
        <h1 className="text-xl font-bold tracking-tight text-black flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded bg-primary text-white">
            <BrandMark className="h-5 w-5" />
          </div>
          SmartGate
        </h1>
      </div>
      <nav className="flex-1 p-4 space-y-1">
        <Link to="/" className={navItemClass('/')}>
          <LayoutDashboard className="w-4 h-4" />
          {t('nav.dashboard')}
        </Link>
        <Link to="/providers" className={navItemClass('/providers')}>
          <Database className="w-4 h-4" />
          {t('nav.providers')}
        </Link>
        <Link to="/pools" className={navItemClass('/pools')}>
          <Layers className="w-4 h-4" />
          {t('nav.pools')}
        </Link>
        <Link to="/virtual-models" className={navItemClass('/virtual-models')}>
          <Box className="w-4 h-4" />
          {t('nav.virtual_models')}
        </Link>
        <Link to="/access" className={navItemClass('/access')}>
          <ShieldCheck className="w-4 h-4" />
          {t('nav.access_keys')}
        </Link>
        <Link to="/stats" className={navItemClass('/stats')}>
          <Activity className="w-4 h-4" />
          {t('nav.statistics')}
        </Link>
      </nav>
      <div className="p-4 border-t border-zinc-100">
        <LanguageSwitcher size="sm" />
      </div>
    </div>
  )
}

function HeaderHealth() {
  const [label, setLabel] = useState('CHECKING')
  const [dot, setDot] = useState('bg-zinc-300')

  useEffect(() => {
    adminFetch('/api/admin/stats')
      .then((data) => {
        if (!data.success) return
        const h = data.data.endpoint_health
        if ((h?.unavailable || 0) > 0) {
          setLabel('DEGRADED')
          setDot('bg-rose-500')
        } else if ((h?.degraded || 0) > 0) {
          setLabel('DEGRADED')
          setDot('bg-amber-500')
        } else {
          setLabel('SYSTEM HEALTHY')
          setDot('bg-emerald-500')
        }
      })
      .catch(() => {
        setLabel('OFFLINE')
        setDot('bg-rose-500')
      })
  }, [])

  return (
    <div className="flex items-center gap-4">
      <span className={`w-2 h-2 rounded-full ${dot}`} />
      <span className="text-xs font-mono text-zinc-500">{label}</span>
    </div>
  )
}

function AdminConsole() {
  const { t } = useI18n()
  return (
    <div className="flex h-screen bg-zinc-50 overflow-hidden font-sans">
      <Sidebar />
      <div className="flex-1 flex flex-col overflow-auto">
        <header className="h-16 border-b border-zinc-200 bg-white flex items-center justify-between px-8">
          <h2 className="text-sm font-medium text-zinc-500">{t('nav.admin_console')}</h2>
          <div className="flex items-center gap-4">
            <LanguageSwitcher size="sm" />
            <HeaderHealth />
          </div>
        </header>
        <main className="p-8">
          <Routes>
            <Route path="/admin" element={<Dashboard />} />
            <Route path="/" element={<Dashboard />} />
            <Route path="/providers" element={<Providers />} />
            <Route path="/pools" element={<Pools />} />
            <Route path="/pools/:id" element={<PoolDetails />} />
            <Route path="/virtual-models" element={<VirtualModels />} />
            <Route path="/access" element={<AccessControl />} />
            <Route path="/stats" element={<Statistics />} />
            <Route path="*" element={<div className="text-zinc-500">Under Construction</div>} />
          </Routes>
        </main>
      </div>
    </div>
  )
}

function App() {
  return (
    <I18nProvider>
      <Router>
        <Routes>
          <Route path="/" element={<LandingPage />} />
          <Route path="/login" element={<AuthPage mode="login" />} />
          <Route path="/register" element={<AuthPage mode="register" />} />
          <Route path="/app" element={<SaasDashboard />} />
          <Route path="/app/services" element={<SaasLayout><ServicesPage /></SaasLayout>} />
          <Route path="/app/services/new" element={<SaasLayout><NewServicePage /></SaasLayout>} />
          <Route path="/app/services/:id" element={<SaasLayout><ServiceDetailsPage /></SaasLayout>} />
          <Route path="/app/providers" element={<SaasLayout><ProvidersPage /></SaasLayout>} />
          <Route path="/app/keys" element={<SaasLayout><KeysPage /></SaasLayout>} />
          <Route path="/app/openrouter" element={<SaasLayout><OpenRouterPage /></SaasLayout>} />
          <Route path="/app/evaluation" element={<SaasLayout><EvaluationPage /></SaasLayout>} />
          <Route path="/app/codex" element={<SaasLayout><CodexPage /></SaasLayout>} />
          <Route path="/app/analytics" element={<SaasLayout><AnalyticsPage /></SaasLayout>} />
          <Route path="/app/quality" element={<SaasLayout><QualityPage /></SaasLayout>} />
          <Route path="/app/usage" element={<SaasLayout><UsagePage /></SaasLayout>} />
          <Route path="/app/savings" element={<Navigate to="/app/usage" replace />} />
          <Route path="/admin/*" element={<AdminConsole />} />
          <Route path="/providers" element={<AdminConsole />} />
          <Route path="/pools/*" element={<AdminConsole />} />
          <Route path="/virtual-models" element={<AdminConsole />} />
          <Route path="/access" element={<AdminConsole />} />
          <Route path="/stats" element={<AdminConsole />} />
          <Route path="*" element={<LandingPage />} />
        </Routes>
      </Router>
    </I18nProvider>
  )
}

export default App
