import { useState, useEffect } from 'react'
import { BrowserRouter as Router, Routes, Route, Link, useLocation } from 'react-router-dom'
import { LayoutDashboard, Database, ShieldCheck, Activity, Layers, Box } from 'lucide-react'
import HealthBadge from './components/HealthBadge'
import { adminFetch } from './lib/api'
import Providers from './pages/Providers'
import Pools from './pages/Pools'
import PoolDetails from './pages/PoolDetails'
import VirtualModels from './pages/VirtualModels'
import AccessControl from './pages/access/AccessControl'
import Statistics from './pages/stats/Statistics'

interface EndpointHealth {
  healthy: number
  degraded: number
  unavailable: number
}

function Dashboard() {
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
        <h2 className="text-2xl font-bold text-zinc-900">Dashboard</h2>
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
            <div className="text-zinc-500">Total Requests</div>
            <div className="font-mono text-xl mt-1">
              {stats?.request_count?.toLocaleString() ?? '—'}
            </div>
          </div>
          <div>
            <div className="text-zinc-500">Avg Latency</div>
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
          <div className="w-8 h-8 bg-black rounded flex items-center justify-center">
            <div className="w-4 h-4 border-2 border-white rounded-sm" />
          </div>
          ParaGateway
        </h1>
      </div>
      <nav className="flex-1 p-4 space-y-1">
        <Link to="/" className={navItemClass('/')}>
          <LayoutDashboard className="w-4 h-4" />
          Dashboard
        </Link>
        <Link to="/providers" className={navItemClass('/providers')}>
          <Database className="w-4 h-4" />
          Providers
        </Link>
        <Link to="/pools" className={navItemClass('/pools')}>
          <Layers className="w-4 h-4" />
          Model Pools
        </Link>
        <Link to="/virtual-models" className={navItemClass('/virtual-models')}>
          <Box className="w-4 h-4" />
          Virtual Models
        </Link>
        <Link to="/access" className={navItemClass('/access')}>
          <ShieldCheck className="w-4 h-4" />
          Access Control
        </Link>
        <Link to="/stats" className={navItemClass('/stats')}>
          <Activity className="w-4 h-4" />
          Statistics
        </Link>
      </nav>
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

function App() {
  return (
    <Router>
      <div className="flex h-screen bg-zinc-50 overflow-hidden font-sans">
        <Sidebar />
        <div className="flex-1 flex flex-col overflow-auto">
          <header className="h-16 border-b border-zinc-200 bg-white flex items-center justify-between px-8">
            <h2 className="text-sm font-medium text-zinc-500">Admin Console</h2>
            <HeaderHealth />
          </header>
          <main className="p-8">
            <Routes>
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
    </Router>
  )
}

export default App
