import { useEffect, useMemo, useState, type ReactNode } from 'react'
import HealthBadge from '../../components/HealthBadge'
import Select from '../../components/Select'
import { adminFetch } from '../../lib/api'

interface Metrics {
  requests: number
  successful_requests: number
  failed_requests: number
  prompt_tokens: number
  completion_tokens: number
  total_tokens: number
  estimated_spend: number
  average_latency_ms: number
  success_rate: number
  failure_rate: number
}

interface BreakdownRow {
  name: string
  metrics: Metrics
}

interface Stats {
  total_tokens: number
  avg_latency: number
  request_count: number
  total_estimated_spend?: number
  tool_message_chars?: number
  trimmed_chars?: number
  summary?: Metrics
  latency?: { min_ms: number; max_ms: number; p50_ms: number; p95_ms: number }
  status_counts?: Record<string, number>
  routing?: {
    fallback_requests: number
    attempt_skip_records: number
    downshift_requests: number
    strategies: Record<string, number>
  }
  breakdowns?: {
    providers: BreakdownRow[]
    projects: BreakdownRow[]
    virtual_models: BreakdownRow[]
    pools: BreakdownRow[]
    endpoints: BreakdownRow[]
    api_keys: BreakdownRow[]
  }
  trend?: { period: string; metrics: Metrics }[]
  endpoint_health?: { healthy: number; degraded: number; unavailable: number }
}

const RANGE_OPTIONS = [
  { id: '24h', name: 'Last 24 hours' },
  { id: '7d', name: 'Last 7 days' },
  { id: '30d', name: 'Last 30 days' },
  { id: 'all', name: 'All time' },
]

const number = (value = 0) => value.toLocaleString()
const money = (value = 0) => `$${value.toFixed(4)}`
const percent = (value = 0) => `${(value * 100).toFixed(1)}%`

function MetricCard({ label, value, detail }: { label: string; value: string; detail?: ReactNode }) {
  return (
    <div className="bg-white p-5 border border-zinc-200 rounded-lg shadow-sm">
      <div className="text-sm text-zinc-500 font-medium">{label}</div>
      <div className="text-2xl font-mono mt-2 font-bold">{value}</div>
      {detail && <div className="text-xs text-zinc-500 mt-1">{detail}</div>}
    </div>
  )
}

function BreakdownTable({ title, rows, value }: { title: string; rows: BreakdownRow[]; value: 'spend' | 'requests' }) {
  const max = Math.max(...rows.map((row) => value === 'spend' ? row.metrics.estimated_spend : row.metrics.requests), 1)
  return (
    <div className="bg-white border border-zinc-200 rounded-lg p-5">
      <h3 className="font-bold mb-4">{title}</h3>
      {!rows.length ? <p className="text-sm text-zinc-500">No usage in this period.</p> : (
        <div className="space-y-3">
          {rows.slice(0, 8).map((row) => {
            const amount = value === 'spend' ? row.metrics.estimated_spend : row.metrics.requests
            return (
              <div key={row.name}>
                <div className="flex justify-between gap-3 text-sm">
                  <span className="truncate" title={row.name}>{row.name}</span>
                  <span className="font-mono text-zinc-600">{value === 'spend' ? money(amount) : number(amount)}</span>
                </div>
                <div className="h-1.5 bg-zinc-100 rounded-full mt-1 overflow-hidden">
                  <div className="h-full bg-zinc-800 rounded-full" style={{ width: `${Math.max((amount / max) * 100, 2)}%` }} />
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

export default function Statistics() {
  const [range, setRange] = useState<{ id: string | number; name: string }>(RANGE_OPTIONS[1])
  const [stats, setStats] = useState<Stats | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    adminFetch(`/api/admin/stats?range=${range.id}`)
      .then((data) => {
        if (data.success) setStats(data.data)
      })
      .catch(() => setStats(null))
      .finally(() => setLoading(false))
  }, [range.id])

  const summary = stats?.summary
  const trendMax = useMemo(
    () => Math.max(...(stats?.trend ?? []).map((item) => item.metrics.requests), 1),
    [stats?.trend],
  )

  return (
    <div className="max-w-6xl mx-auto space-y-8">
      <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-zinc-900">System Statistics</h2>
          <p className="text-sm text-zinc-500 mt-1">
            Global traffic, spend, reliability, routing, and endpoint health.
          </p>
        </div>
        <div className="w-52">
          <Select label="Reporting period" options={RANGE_OPTIONS} selected={range} onChange={setRange} />
        </div>
      </div>

      {loading ? <div className="text-sm text-zinc-500">Loading statistics…</div> : !stats ? (
        <div className="bg-white border border-rose-200 rounded-lg p-5 text-sm text-rose-700">Unable to load statistics.</div>
      ) : <>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
          <MetricCard label="Estimated spend" value={money(summary?.estimated_spend)} detail="Based on configured endpoint prices" />
          <MetricCard label="Requests" value={number(summary?.requests)} detail={`${percent(summary?.success_rate)} success rate`} />
          <MetricCard label="Total tokens" value={number(summary?.total_tokens)} detail={<><span className="block">{number(summary?.prompt_tokens)} input</span><span className="block">{number(summary?.completion_tokens)} output</span></>} />
          <MetricCard label="Average latency" value={`${Math.round(summary?.average_latency_ms ?? 0)} ms`} detail={`P95 ${Math.round(stats.latency?.p95_ms ?? 0)} ms`} />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <MetricCard label="P50 latency" value={`${Math.round(stats.latency?.p50_ms ?? 0)} ms`} />
          <MetricCard label="Failed requests" value={number(summary?.failed_requests)} detail={percent(summary?.failure_rate)} />
          <MetricCard label="Fallback requests" value={number(stats.routing?.fallback_requests)} />
          <MetricCard label="Capacity skips" value={number(stats.routing?.attempt_skip_records)} />
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
          <div className="bg-white border border-zinc-200 rounded-lg p-5">
            <h3 className="font-bold mb-1">Traffic trend</h3>
            <p className="text-xs text-zinc-500 mb-5">Requests by reporting period.</p>
            {!stats.trend?.length ? <p className="text-sm text-zinc-500">No usage in this period.</p> : (
              <div className="flex items-end gap-2 h-40">
                {stats.trend.map((item) => (
                  <div key={item.period} className="flex-1 min-w-0 h-full flex flex-col justify-end items-center gap-2">
                    <span className="text-[10px] font-mono text-zinc-500">{number(item.metrics.requests)}</span>
                    <div className="w-full bg-zinc-800 rounded-t-sm" style={{ height: `${Math.max((item.metrics.requests / trendMax) * 100, 3)}%` }} />
                    <span className="text-[10px] text-zinc-500 truncate max-w-full" title={item.period}>{item.period.slice(-5)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div className="bg-white border border-zinc-200 rounded-lg p-5">
            <h3 className="font-bold mb-1">Request outcomes</h3>
            <p className="text-xs text-zinc-500 mb-5">Status classes in the selected period.</p>
            <div className="grid grid-cols-2 gap-4">
              {Object.entries(stats.status_counts ?? {}).map(([status, count]) => (
                <div key={status} className="border border-zinc-200 rounded-md p-4">
                  <div className="text-xs text-zinc-500 capitalize">{status.replace('_', ' ')}</div>
                  <div className="font-mono text-2xl mt-1">{number(count)}</div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-6">
          <BreakdownTable title="Spend by provider" rows={stats.breakdowns?.providers ?? []} value="spend" />
          <BreakdownTable title="Requests by project" rows={stats.breakdowns?.projects ?? []} value="requests" />
          <BreakdownTable title="Requests by virtual model" rows={stats.breakdowns?.virtual_models ?? []} value="requests" />
          <BreakdownTable title="Requests by pool" rows={stats.breakdowns?.pools ?? []} value="requests" />
          <BreakdownTable title="Spend by endpoint" rows={stats.breakdowns?.endpoints ?? []} value="spend" />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="bg-white border border-zinc-200 rounded-lg p-5">
            <h3 className="font-bold mb-4">Routing signals</h3>
            <div className="grid grid-cols-2 gap-4">
              <div><div className="text-xs text-zinc-500">Budget downshifts</div><div className="font-mono text-2xl mt-1">{number(stats.routing?.downshift_requests)}</div></div>
              <div><div className="text-xs text-zinc-500">Strategies used</div><div className="font-mono text-2xl mt-1">{number(Object.keys(stats.routing?.strategies ?? {}).length)}</div></div>
            </div>
            <div className="mt-4 text-xs text-zinc-500 space-y-1">
              {Object.entries(stats.routing?.strategies ?? {}).map(([strategy, count]) => <div key={strategy} className="flex justify-between"><span>{strategy}</span><span className="font-mono">{number(count)}</span></div>)}
            </div>
          </div>
          <div className="bg-white border border-zinc-200 rounded-lg p-5">
            <h3 className="font-bold mb-4">Context signals</h3>
            <div className="grid grid-cols-2 gap-4">
              <div><div className="text-xs text-zinc-500">Tool message chars</div><div className="font-mono text-2xl mt-1">{number(stats.tool_message_chars)}</div></div>
              <div><div className="text-xs text-zinc-500">Trimmed chars</div><div className="font-mono text-2xl mt-1">{number(stats.trimmed_chars)}</div></div>
            </div>
          </div>
        </div>

        <div className="bg-white border border-zinc-200 rounded-lg p-5">
          <h3 className="font-bold mb-4">Endpoint health</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {(['healthy', 'degraded', 'unavailable'] as const).map((status) => (
              <div key={status} className="border border-zinc-200 rounded-md p-4">
                <div className="font-mono text-2xl">{stats.endpoint_health?.[status] ?? '—'}</div>
                <div className="mt-2"><HealthBadge status={status} /></div>
              </div>
            ))}
          </div>
        </div>
      </>}
    </div>
  )
}
