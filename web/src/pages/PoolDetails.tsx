import { useState, useEffect } from 'react'
import { useParams, Link } from 'react-router-dom'
import { Plus, X, ArrowLeft, RefreshCw } from 'lucide-react'
import Select from '../components/Select'
import HealthBadge from '../components/HealthBadge'
import { adminFetch } from '../lib/api'

interface EndpointOption {
  id: string
  name: string
  upstream_model_id: string
}

interface Pool {
  id: string
  name: string
  strategy: string
  session_affinity_enabled: number
  session_affinity_ttl_secs: number
}

interface PoolEndpoint {
  endpoint_id: string
  name: string
  upstream_model_id: string
  enabled: boolean
  priority: number
  weight: number
  health_status: string
  cooldown_until?: string | null
  account_name: string
  provider_type: string
  active_requests: number
  ema_latency_ms: number
}

export default function PoolDetails() {
  const { id } = useParams<{ id: string }>()
  const [pool, setPool] = useState<Pool | null>(null)
  const [allEndpoints, setAllEndpoints] = useState<EndpointOption[]>([])
  const [members, setMembers] = useState<PoolEndpoint[]>([])
  const [loadingMembers, setLoadingMembers] = useState(true)
  const [isBindModalOpen, setIsBindModalOpen] = useState(false)
  const [selectedEndpoint, setSelectedEndpoint] = useState<{ id: string; name: string } | null>(null)
  const [priority, setPriority] = useState('1')
  const [weight, setWeight] = useState('1')
  const [binding, setBinding] = useState(false)
  const [affinityEnabled, setAffinityEnabled] = useState(true)
  const [affinityTtl, setAffinityTtl] = useState('3600')
  const [savingAffinity, setSavingAffinity] = useState(false)

  useEffect(() => {
    fetchPool()
    fetchEndpoints()
    fetchMembers()
  }, [id])

  const fetchPool = async () => {
    const data = await adminFetch('/api/admin/pools')
    if (data.success) {
      const found = data.data.find((p: Pool) => p.id === id) || null
      setPool(found)
      if (found) {
        setAffinityEnabled(found.session_affinity_enabled !== 0)
        setAffinityTtl(String(found.session_affinity_ttl_secs ?? 3600))
      }
    }
  }

  const saveAffinity = async () => {
    if (!id) return
    setSavingAffinity(true)
    try {
      const data = await adminFetch(`/api/admin/pools/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          session_affinity_enabled: affinityEnabled,
          session_affinity_ttl_secs: parseInt(affinityTtl, 10) || 3600,
        }),
      })
      if (data.success) await fetchPool()
    } finally {
      setSavingAffinity(false)
    }
  }

  const fetchEndpoints = async () => {
    const data = await adminFetch('/api/admin/endpoints')
    if (data.success) setAllEndpoints(data.data)
  }

  const fetchMembers = async () => {
    if (!id) return
    setLoadingMembers(true)
    try {
      const data = await adminFetch(`/api/admin/pools/${id}/endpoints`)
      if (data.success) setMembers(data.data)
    } finally {
      setLoadingMembers(false)
    }
  }

  const handleBind = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!selectedEndpoint) return
    setBinding(true)
    try {
      const data = await adminFetch('/api/admin/pools/bind', {
        method: 'POST',
        body: JSON.stringify({
          pool_id: id,
          endpoint_id: selectedEndpoint.id,
          priority: parseInt(priority, 10),
          weight: parseInt(weight, 10),
        }),
      })
      if (data.success) {
        setIsBindModalOpen(false)
        setSelectedEndpoint(null)
        await fetchMembers()
      }
    } finally {
      setBinding(false)
    }
  }

  const endpointOptions = allEndpoints.map((ep) => ({
    id: ep.id,
    name: `${ep.name} (${ep.upstream_model_id})`,
  }))

  if (!pool) return <div className="p-8 text-zinc-500">Loading...</div>

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <Link to="/pools" className="inline-flex items-center gap-2 text-sm text-zinc-500 hover:text-black">
        <ArrowLeft className="w-4 h-4" /> Back to Pools
      </Link>

      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-zinc-900">{pool.name}</h2>
          <p className="text-sm text-zinc-500 mt-1">
            Strategy: <span className="font-mono">{pool.strategy}</span>
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={fetchMembers}
            className="flex items-center gap-2 px-3 py-2 text-sm border border-zinc-300 rounded-md hover:bg-zinc-50"
          >
            <RefreshCw className="w-4 h-4" /> Refresh
          </button>
          <button
            onClick={() => setIsBindModalOpen(true)}
            className="flex items-center gap-2 px-4 py-2 bg-black text-white text-sm font-medium rounded-md hover:bg-zinc-800"
          >
            <Plus className="w-4 h-4" /> Bind Endpoint
          </button>
        </div>
      </div>

      <div className="bg-white border border-zinc-200 rounded-lg shadow-sm p-6 space-y-4">
        <div>
          <h3 className="font-bold text-zinc-900">Session affinity (warming)</h3>
          <p className="text-sm text-zinc-500 mt-1">
            Sticky-route requests with the same session ID to one endpoint so provider prompt cache can warm up.
            Requires at least two endpoints and client headers such as X-SmartGate-Session-Id.
          </p>
        </div>
        <label className="flex items-center gap-3 text-sm">
          <input
            type="checkbox"
            checked={affinityEnabled}
            onChange={(e) => setAffinityEnabled(e.target.checked)}
            className="rounded border-zinc-300"
          />
          Enable session affinity
        </label>
        <div className="max-w-xs">
          <label className="block text-sm font-medium text-zinc-700 mb-1">TTL (seconds)</label>
          <input
            type="number"
            min={60}
            className="w-full bg-white border border-zinc-300 rounded-md px-3 py-2 text-sm font-mono focus:outline-none focus:border-black focus:ring-1 focus:ring-black"
            value={affinityTtl}
            onChange={(e) => setAffinityTtl(e.target.value)}
          />
        </div>
        <button
          type="button"
          onClick={saveAffinity}
          disabled={savingAffinity}
          className="px-4 py-2 bg-black text-white text-sm font-medium rounded-md hover:bg-zinc-800 disabled:opacity-50"
        >
          {savingAffinity ? 'Saving…' : 'Save affinity settings'}
        </button>
      </div>

      <div className="bg-white border border-zinc-200 rounded-lg shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-zinc-200 font-bold">Bound Endpoints</div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-zinc-50 text-zinc-600 border-b border-zinc-200">
              <tr>
                <th className="px-6 py-3 font-medium">Endpoint</th>
                <th className="px-6 py-3 font-medium">Provider</th>
                <th className="px-6 py-3 font-medium">Health</th>
                <th className="px-6 py-3 font-medium">Priority</th>
                <th className="px-6 py-3 font-medium">Weight</th>
                <th className="px-6 py-3 font-medium">Active</th>
                <th className="px-6 py-3 font-medium">Latency</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-200">
              {loadingMembers ? (
                <tr>
                  <td colSpan={7} className="px-6 py-8 text-center text-zinc-500">Loading endpoints...</td>
                </tr>
              ) : members.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-6 py-8 text-center text-zinc-500">
                    No endpoints bound yet. Bind one to start routing.
                  </td>
                </tr>
              ) : (
                members.map((m) => (
                  <tr key={m.endpoint_id} className="hover:bg-zinc-50/50">
                    <td className="px-6 py-4">
                      <div className="font-medium text-zinc-900">{m.name}</div>
                      <div className="font-mono text-xs text-zinc-500">{m.upstream_model_id}</div>
                    </td>
                    <td className="px-6 py-4">
                      <div>{m.account_name}</div>
                      <div className="font-mono text-xs text-zinc-500">{m.provider_type}</div>
                    </td>
                    <td className="px-6 py-4">
                      <HealthBadge status={m.enabled ? m.health_status : 'disabled'} />
                      {m.cooldown_until && (
                        <div className="text-xs text-zinc-500 mt-1 font-mono">
                          cool until {new Date(m.cooldown_until).toLocaleTimeString()}
                        </div>
                      )}
                    </td>
                    <td className="px-6 py-4 font-mono">{m.priority}</td>
                    <td className="px-6 py-4 font-mono">{m.weight}</td>
                    <td className="px-6 py-4 font-mono">{m.active_requests}</td>
                    <td className="px-6 py-4 font-mono">
                      {m.ema_latency_ms > 0 ? `${Math.round(m.ema_latency_ms)}ms` : '—'}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {isBindModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
          <div className="bg-white rounded-lg shadow-lg w-full max-w-md border border-zinc-200">
            <div className="px-6 py-4 border-b border-zinc-200 flex justify-between items-center">
              <h3 className="font-bold">Bind Endpoint</h3>
              <button onClick={() => setIsBindModalOpen(false)} className="text-zinc-400 hover:text-black">
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleBind} className="p-6 space-y-4">
              <Select
                label="Endpoint"
                options={endpointOptions}
                selected={selectedEndpoint || { id: '', name: 'Select an endpoint...' }}
                onChange={(opt) => setSelectedEndpoint({ id: String(opt.id), name: opt.name })}
              />
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-zinc-700 mb-1">Priority</label>
                  <input
                    type="number"
                    className="w-full bg-white border border-zinc-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:border-black focus:ring-1 focus:ring-black font-mono"
                    value={priority}
                    onChange={(e) => setPriority(e.target.value)}
                  />
                  <p className="mt-1 text-xs text-zinc-500">Higher = preferred</p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-zinc-700 mb-1">Weight</label>
                  <input
                    type="number"
                    className="w-full bg-white border border-zinc-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:border-black focus:ring-1 focus:ring-black font-mono"
                    value={weight}
                    onChange={(e) => setWeight(e.target.value)}
                  />
                </div>
              </div>
              <button
                type="submit"
                disabled={!selectedEndpoint?.id || binding}
                className="w-full bg-black text-white py-2 rounded-md font-medium hover:bg-zinc-800 disabled:opacity-50"
              >
                {binding ? 'Binding...' : 'Bind'}
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
