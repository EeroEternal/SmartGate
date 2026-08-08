import { useState, useEffect } from 'react'
import HealthBadge from '../../components/HealthBadge'
import { adminFetch } from '../../lib/api'

interface SpendRow {
  key_id: string | null
  estimated_spend: number
  requests: number
}

interface Stats {
  total_tokens: number
  avg_latency: number
  request_count: number
  total_estimated_spend?: number
  tool_message_chars?: number
  trimmed_chars?: number
  spend_by_key?: SpendRow[]
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
        <p className="text-sm text-zinc-500 mt-1">
          Traffic, estimated spend, and endpoint health. Set endpoint prices to enable spend tracking.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <div className="bg-white p-6 border border-zinc-200 rounded-lg shadow-sm">
          <div className="text-sm text-zinc-500 font-medium">Est. Spend (USD)</div>
          <div className="text-3xl font-mono mt-2 font-bold">
            {stats?.total_estimated_spend != null
              ? `$${stats.total_estimated_spend.toFixed(4)}`
              : '-'}
          </div>
        </div>
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

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-white border border-zinc-200 rounded-lg p-6">
          <h3 className="font-bold mb-2">Context bloat signals</h3>
          <p className="text-xs text-zinc-500 mb-4">
            Tool message volume and chars removed by gateway trim (when enabled).
          </p>
          <div className="grid grid-cols-2 gap-4">
            <div className="border border-zinc-200 rounded-md p-4">
              <div className="text-xs text-zinc-500">Tool message chars</div>
              <div className="font-mono text-2xl mt-1">
                {(stats?.tool_message_chars ?? 0).toLocaleString()}
              </div>
            </div>
            <div className="border border-zinc-200 rounded-md p-4">
              <div className="text-xs text-zinc-500">Trimmed chars</div>
              <div className="font-mono text-2xl mt-1">
                {(stats?.trimmed_chars ?? 0).toLocaleString()}
              </div>
            </div>
          </div>
        </div>

        <div className="bg-white border border-zinc-200 rounded-lg p-6">
          <h3 className="font-bold mb-4">Spend by API key (top 10)</h3>
          {!stats?.spend_by_key?.length ? (
            <p className="text-sm text-zinc-500">No usage with priced endpoints yet.</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-zinc-500 border-b border-zinc-200">
                <tr>
                  <th className="text-left py-2 font-medium">Key</th>
                  <th className="text-right py-2 font-medium">Spend</th>
                  <th className="text-right py-2 font-medium">Reqs</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {stats.spend_by_key.map((row) => (
                  <tr key={row.key_id ?? 'unknown'}>
                    <td className="py-2 font-mono text-xs truncate max-w-[12rem]">
                      {row.key_id ?? '—'}
                    </td>
                    <td className="py-2 text-right font-mono">
                      ${row.estimated_spend.toFixed(4)}
                    </td>
                    <td className="py-2 text-right font-mono">{row.requests}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
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
