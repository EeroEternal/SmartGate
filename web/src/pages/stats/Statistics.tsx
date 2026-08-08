import { useState, useEffect } from 'react'
import HealthBadge from '../../components/HealthBadge'
import { adminFetch } from '../../lib/api'

interface Stats {
  total_tokens: number
  avg_latency: number
  request_count: number
  endpoint_health?: {
    healthy: number
    degraded: number
    unavailable: number
  }
}

export default function Statistics() {
  const [stats, setStats] = useState<Stats | null>(null)

  useEffect(() => {
    adminFetch('/api/admin/stats')
      .then((data) => {
        if (data.success) setStats(data.data)
      })
      .catch(() => {})
  }, [])

  return (
    <div className="max-w-6xl mx-auto space-y-8">
      <div>
        <h2 className="text-2xl font-bold text-zinc-900">System Statistics</h2>
        <p className="text-sm text-zinc-500 mt-1">Gateway traffic and endpoint health overview.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-white p-6 border border-zinc-200 rounded-lg shadow-sm">
          <div className="text-sm text-zinc-500 font-medium">Total Tokens</div>
          <div className="text-3xl font-mono mt-2 font-bold">
            {stats?.total_tokens.toLocaleString() ?? '-'}
          </div>
        </div>
        <div className="bg-white p-6 border border-zinc-200 rounded-lg shadow-sm">
          <div className="text-sm text-zinc-500 font-medium">Avg Latency (ms)</div>
          <div className="text-3xl font-mono mt-2 font-bold">
            {stats?.avg_latency.toFixed(0) ?? '-'}
          </div>
        </div>
        <div className="bg-white p-6 border border-zinc-200 rounded-lg shadow-sm">
          <div className="text-sm text-zinc-500 font-medium">Total Requests</div>
          <div className="text-3xl font-mono mt-2 font-bold">
            {stats?.request_count.toLocaleString() ?? '-'}
          </div>
        </div>
      </div>

      <div className="bg-white border border-zinc-200 rounded-lg p-6">
        <h3 className="font-bold mb-4">Endpoint Health</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="border border-zinc-200 rounded-md p-4">
            <div className="font-mono text-2xl">{stats?.endpoint_health?.healthy ?? '—'}</div>
            <div className="mt-2">
              <HealthBadge status="healthy" />
            </div>
          </div>
          <div className="border border-zinc-200 rounded-md p-4">
            <div className="font-mono text-2xl">{stats?.endpoint_health?.degraded ?? '—'}</div>
            <div className="mt-2">
              <HealthBadge status="degraded" />
            </div>
          </div>
          <div className="border border-zinc-200 rounded-md p-4">
            <div className="font-mono text-2xl">{stats?.endpoint_health?.unavailable ?? '—'}</div>
            <div className="mt-2">
              <HealthBadge status="unavailable" />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
