import { lazy, Suspense, useState, useEffect, type ComponentType, type ReactNode } from 'react'
import { BrowserRouter as Router, Routes, Route, Link, Navigate, useLocation, useParams } from 'react-router-dom'
import { LayoutDashboard, Database, ShieldCheck, Activity, Layers, Box } from 'lucide-react'
import LandingPage from './pages/saas/LandingPage'
import AuthPage from './pages/saas/AuthPage'
import SaasDashboard from './pages/saas/SaasDashboard'
import { SaasLayout } from './pages/saas/SaasLayout'
import { ModelServicesProvider } from './pages/saas/useModelServices'
import AdminTokenGate from './components/AdminTokenGate'
import { ErrorBoundary } from './components/ErrorBoundary'
import HealthBadge from './components/HealthBadge'
import { adminFetch } from './lib/api'
import BrandMark from './components/BrandMark'

import { I18nProvider, useI18n } from './lib/i18n'
import { LanguageSwitcher } from './components/LanguageSwitcher'

/**
 * Page-level code splitting. The console and dashboard only ship on first visit, which
 * keeps the initial bundle to the shell plus the landing/auth pages.
 */
const lazyNamed = <T extends Record<string, ComponentType>>(loader: () => Promise<T>, name: keyof T) =>
  lazy(() => loader().then((module) => ({ default: module[name] })))

const AnalyticsPage = lazyNamed(() => import('./pages/saas/AnalyticsPage'), 'AnalyticsPage')
const CodexPage = lazyNamed(() => import('./pages/saas/CodexPage'), 'CodexPage')
const EvaluationPage = lazyNamed(() => import('./pages/saas/EvaluationPage'), 'EvaluationPage')
const KeysPage = lazyNamed(() => import('./pages/saas/KeysPage'), 'KeysPage')
const NewServicePage = lazyNamed(() => import('./pages/saas/NewServicePage'), 'NewServicePage')
const QualityPage = lazyNamed(() => import('./pages/saas/QualityPage'), 'QualityPage')
const ServiceDetailsPage = lazyNamed(() => import('./pages/saas/ServiceDetailsPage'), 'ServiceDetailsPage')
const ServicesPage = lazyNamed(() => import('./pages/saas/ServicesPage'), 'ServicesPage')
const UsagePage = lazyNamed(() => import('./pages/saas/UsagePage'), 'UsagePage')
const OpenRouterPage = lazy(() => import('./pages/saas/OpenRouterPage'))
const ProvidersPage = lazy(() => import('./pages/saas/ProvidersPage'))
const Providers = lazy(() => import('./pages/Providers'))
const Pools = lazy(() => import('./pages/Pools'))
const PoolDetails = lazy(() => import('./pages/PoolDetails'))
const VirtualModels = lazy(() => import('./pages/VirtualModels'))
const AccessControl = lazy(() => import('./pages/access/AccessControl'))
const Statistics = lazy(() => import('./pages/stats/Statistics'))

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
        <p className="text-sm text-zinc-500 mt-1">{t('admin.dashboard_subtitle')}</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white border border-zinc-200 rounded-lg p-5">
          <div className="text-sm text-zinc-500">{t('admin.healthy_endpoints')}</div>
          <div className="mt-2 text-3xl font-mono font-bold text-zinc-900">
            {health?.healthy ?? '—'}
          </div>
          <div className="mt-3">
            <HealthBadge status="healthy" />
          </div>
        </div>
        <div className="bg-white border border-zinc-200 rounded-lg p-5">
          <div className="text-sm text-zinc-500">{t('admin.degraded')}</div>
          <div className="mt-2 text-3xl font-mono font-bold text-zinc-900">
            {health?.degraded ?? '—'}
          </div>
          <div className="mt-3">
            <HealthBadge status="degraded" />
          </div>
        </div>
        <div className="bg-white border border-zinc-200 rounded-lg p-5">
          <div className="text-sm text-zinc-500">{t('admin.unavailable')}</div>
          <div className="mt-2 text-3xl font-mono font-bold text-zinc-900">
            {health?.unavailable ?? '—'}
          </div>
          <div className="mt-3">
            <HealthBadge status="unavailable" />
          </div>
        </div>
      </div>

      <div className="bg-white border border-zinc-200 rounded-lg p-6 space-y-4">
        <h3 className="text-lg font-bold">{t('admin.quick_snapshot')}</h3>
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <div className="text-zinc-500">{t('admin.tracked_endpoints')}</div>
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
        <p className="text-xs text-zinc-500">{t('admin.snapshot_hint')}</p>
      </div>
    </div>
  )
}

function Sidebar() {
  const { t } = useI18n()
  const location = useLocation()
  // The admin console lives under /admin so that its links do not collide with the
  // marketing routes; the dashboard is only active on its exact path.
  const isActive = (path: string) =>
    path === '/admin' ? location.pathname === '/admin' : location.pathname.startsWith(path)

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
        <Link to="/admin" className={navItemClass('/admin')}>
          <LayoutDashboard className="w-4 h-4" />
          {t('nav.dashboard')}
        </Link>
        <Link to="/admin/providers" className={navItemClass('/admin/providers')}>
          <Database className="w-4 h-4" />
          {t('nav.providers')}
        </Link>
        <Link to="/admin/pools" className={navItemClass('/admin/pools')}>
          <Layers className="w-4 h-4" />
          {t('nav.pools')}
        </Link>
        <Link to="/admin/virtual-models" className={navItemClass('/admin/virtual-models')}>
          <Box className="w-4 h-4" />
          {t('nav.virtual_models')}
        </Link>
        <Link to="/admin/access" className={navItemClass('/admin/access')}>
          <ShieldCheck className="w-4 h-4" />
          {t('nav.access_keys')}
        </Link>
        <Link to="/admin/stats" className={navItemClass('/admin/stats')}>
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
  const { t } = useI18n()
  const [label, setLabel] = useState(t('admin.health_checking'))
  const [dot, setDot] = useState('bg-zinc-300')

  useEffect(() => {
    adminFetch('/api/admin/stats')
      .then((data) => {
        if (!data.success) return
        const h = data.data.endpoint_health
        if ((h?.unavailable || 0) > 0) {
          setLabel(t('admin.health_degraded'))
          setDot('bg-rose-500')
        } else if ((h?.degraded || 0) > 0) {
          setLabel(t('admin.health_degraded'))
          setDot('bg-amber-500')
        } else {
          setLabel(t('admin.health_healthy'))
          setDot('bg-emerald-500')
        }
      })
      .catch(() => {
        setLabel(t('admin.health_offline'))
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

function PageLoading() {
  const { t } = useI18n()
  return <div className="p-8 text-sm text-zinc-500">{t('common.loading')}</div>
}

/** Marketing/app page shell: keeps the sidebar and header while a route chunk loads. */
function SaasPage({ children }: { children: ReactNode }) {
  return (
    <SaasLayout>
      <ErrorBoundary>
        <Suspense fallback={<PageLoading />}>{children}</Suspense>
      </ErrorBoundary>
    </SaasLayout>
  )
}

/**
 * Keeps the pre-/admin links (`/pools/<id>` and friends) working by forwarding them to
 * the canonical admin console URL, splat included.
 */
function LegacyAdminRedirect({ to }: { to: string }) {
  const params = useParams()
  const rest = params['*']
  return <Navigate to={rest ? `${to}/${rest}` : to} replace />
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
          {/* Paths below are relative to the /admin mount point. */}
          <ErrorBoundary>
            <Suspense fallback={<PageLoading />}>
              <Routes>
                <Route path="/" element={<Dashboard />} />
                <Route path="/providers" element={<Providers />} />
                <Route path="/pools" element={<Pools />} />
                <Route path="/pools/:id" element={<PoolDetails />} />
                <Route path="/virtual-models" element={<VirtualModels />} />
                <Route path="/access" element={<AccessControl />} />
                <Route path="/stats" element={<Statistics />} />
                <Route path="*" element={<div className="text-zinc-500">{t('admin.under_construction')}</div>} />
              </Routes>
            </Suspense>
          </ErrorBoundary>
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
          {/* /app renders SaasDashboard directly (without the SaasPage/SaasLayout wrapper
              used by the other routes), so it needs its own provider mount. */}
          <Route path="/app" element={<ModelServicesProvider><SaasDashboard /></ModelServicesProvider>} />
          <Route path="/app/services" element={<SaasPage><ServicesPage /></SaasPage>} />
          <Route path="/app/services/new" element={<SaasPage><NewServicePage /></SaasPage>} />
          <Route path="/app/services/:id" element={<SaasPage><ServiceDetailsPage /></SaasPage>} />
          <Route path="/app/providers" element={<SaasPage><ProvidersPage /></SaasPage>} />
          <Route path="/app/keys" element={<SaasPage><KeysPage /></SaasPage>} />
          <Route path="/app/openrouter" element={<SaasPage><OpenRouterPage /></SaasPage>} />
          <Route path="/app/evaluation" element={<SaasPage><EvaluationPage /></SaasPage>} />
          <Route path="/app/codex" element={<SaasPage><CodexPage /></SaasPage>} />
          <Route path="/app/analytics" element={<SaasPage><AnalyticsPage /></SaasPage>} />
          <Route path="/app/quality" element={<SaasPage><QualityPage /></SaasPage>} />
          <Route path="/app/usage" element={<SaasPage><UsagePage /></SaasPage>} />
          <Route path="/app/savings" element={<Navigate to="/app/usage" replace />} />
          <Route
            path="/admin/*"
            element={
              <AdminTokenGate>
                <AdminConsole />
              </AdminTokenGate>
            }
          />
          {/* Legacy admin URLs: these used to mount the console directly, which left the
              nested console routes unable to match, so they rendered the dashboard. */}
          <Route path="/providers" element={<LegacyAdminRedirect to="/admin/providers" />} />
          <Route path="/pools/*" element={<LegacyAdminRedirect to="/admin/pools" />} />
          <Route path="/virtual-models" element={<LegacyAdminRedirect to="/admin/virtual-models" />} />
          <Route path="/access" element={<LegacyAdminRedirect to="/admin/access" />} />
          <Route path="/stats" element={<LegacyAdminRedirect to="/admin/stats" />} />
          <Route path="*" element={<LandingPage />} />
        </Routes>
      </Router>
    </I18nProvider>
  )
}

export default App
