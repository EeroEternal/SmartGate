import { useState, useEffect } from 'react'
import { Plus, X } from 'lucide-react'
import Select from '../components/Select'
import HealthBadge from '../components/HealthBadge'
import { adminFetch } from '../lib/api'

interface Provider {
  id: string
  name: string
  provider_type: string
  base_url: string
  status: string
  created_at: string
}

interface Endpoint {
  id: string
  account_id: string
  account_name: string
  name: string
  upstream_model_id: string
  enabled: boolean
  health_status: string
  cooldown_until?: string | null
  priority: number
  weight: number
  input_price_per_1m?: number
  output_price_per_1m?: number
  capability_score?: number
  supports_tools?: boolean | null
  context_length?: number | null
}

const PROVIDER_TYPES = [
  { id: 'openai', name: 'OpenAI (or Compatible)' },
  { id: 'azure', name: 'Azure OpenAI' },
  { id: 'anthropic', name: 'Anthropic' },
  { id: 'deepseek', name: 'DeepSeek' },
]

export default function Providers() {
  const [providers, setProviders] = useState<Provider[]>([])
  const [endpoints, setEndpoints] = useState<Endpoint[]>([])
  const [loading, setLoading] = useState(true)
  const [isProviderModalOpen, setIsProviderModalOpen] = useState(false)
  const [isEndpointModalOpen, setIsEndpointModalOpen] = useState(false)
  const [formData, setFormData] = useState({ name: '', base_url: '', api_key: '' })
  const [providerType, setProviderType] = useState(PROVIDER_TYPES[0])
  const [selectedAccount, setSelectedAccount] = useState<{ id: string; name: string } | null>(null)
  const [endpointForm, setEndpointForm] = useState({
    name: '',
    upstream_model_id: '',
    priority: '1',
    weight: '1',
    input_price_per_1m: '',
    output_price_per_1m: '',
    capability_score: '0.5',
    supports_tools: 'unknown',
    context_length: '',
  })
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    refresh()
  }, [])

  const refresh = async () => {
    try {
      const [pData, eData] = await Promise.all([
        adminFetch('/api/admin/providers'),
        adminFetch('/api/admin/endpoints'),
      ])
      if (pData.success) {
        setProviders(pData.data)
        if (pData.data.length > 0 && !selectedAccount) {
          setSelectedAccount({ id: pData.data[0].id, name: pData.data[0].name })
        }
      }
      if (eData.success) setEndpoints(eData.data)
    } catch (error) {
      console.error('Failed to fetch providers:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleCreateProvider = async (e: React.FormEvent) => {
    e.preventDefault()
    setSubmitting(true)
    try {
      const data = await adminFetch('/api/admin/providers', {
        method: 'POST',
        body: JSON.stringify({
          ...formData,
          provider_type: providerType.id,
        }),
      })
      if (data.success) {
        setIsProviderModalOpen(false)
        setFormData({ name: '', base_url: '', api_key: '' })
        setProviderType(PROVIDER_TYPES[0])
        await refresh()
      }
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Network error')
    } finally {
      setSubmitting(false)
    }
  }

  const handleCreateEndpoint = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!selectedAccount?.id) return
    setSubmitting(true)
    try {
      const data = await adminFetch('/api/admin/endpoints', {
        method: 'POST',
        body: JSON.stringify({
          account_id: selectedAccount.id,
          name: endpointForm.name,
          upstream_model_id: endpointForm.upstream_model_id,
          priority: parseInt(endpointForm.priority, 10) || 1,
          weight: parseInt(endpointForm.weight, 10) || 1,
          input_price_per_1m:
            endpointForm.input_price_per_1m === '' ? 0 : parseFloat(endpointForm.input_price_per_1m),
          output_price_per_1m:
            endpointForm.output_price_per_1m === '' ? 0 : parseFloat(endpointForm.output_price_per_1m),
          capability_score: parseFloat(endpointForm.capability_score) || 0.5,
          supports_tools:
            endpointForm.supports_tools === 'unknown'
              ? null
              : endpointForm.supports_tools === 'true',
          context_length:
            endpointForm.context_length === ''
              ? null
              : parseInt(endpointForm.context_length, 10),
        }),
      })
      if (data.success) {
        setIsEndpointModalOpen(false)
        setEndpointForm({
          name: '',
          upstream_model_id: '',
          priority: '1',
          weight: '1',
          input_price_per_1m: '',
          output_price_per_1m: '',
          capability_score: '0.5',
          supports_tools: 'unknown',
          context_length: '',
        })
        await refresh()
      }
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Network error')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="max-w-6xl mx-auto space-y-8">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-zinc-900">Providers</h2>
          <p className="text-sm text-zinc-500 mt-1">
            Manage provider accounts and the concrete endpoints behind them.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setIsEndpointModalOpen(true)}
            disabled={providers.length === 0}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium border border-zinc-300 rounded-md hover:bg-zinc-50 disabled:opacity-50"
          >
            <Plus className="w-4 h-4" />
            Add Endpoint
          </button>
          <button
            onClick={() => setIsProviderModalOpen(true)}
            className="flex items-center gap-2 px-4 py-2 bg-black text-white text-sm font-medium rounded-md hover:bg-zinc-800"
          >
            <Plus className="w-4 h-4" />
            Add Provider
          </button>
        </div>
      </div>

      <div className="bg-white border border-zinc-200 rounded-lg shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-zinc-200 font-bold">Provider Accounts</div>
        <table className="w-full text-left text-sm">
          <thead className="bg-zinc-50 text-zinc-600 border-b border-zinc-200">
            <tr>
              <th className="px-6 py-3 font-medium">Name</th>
              <th className="px-6 py-3 font-medium">Type</th>
              <th className="px-6 py-3 font-medium">Base URL</th>
              <th className="px-6 py-3 font-medium">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-200">
            {loading ? (
              <tr>
                <td colSpan={4} className="px-6 py-8 text-center text-zinc-500">Loading...</td>
              </tr>
            ) : providers.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-6 py-8 text-center text-zinc-500">
                  No providers yet. Add one before creating endpoints.
                </td>
              </tr>
            ) : (
              providers.map((provider) => (
                <tr key={provider.id} className="hover:bg-zinc-50/50">
                  <td className="px-6 py-4 font-medium">{provider.name}</td>
                  <td className="px-6 py-4">
                    <span className="px-2.5 py-1 rounded-md bg-zinc-100 border border-zinc-200 text-xs font-mono">
                      {provider.provider_type}
                    </span>
                  </td>
                  <td className="px-6 py-4 font-mono text-zinc-500 truncate max-w-xs">{provider.base_url}</td>
                  <td className="px-6 py-4">
                    <HealthBadge status={provider.status === 'active' ? 'healthy' : 'disabled'} />
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="bg-white border border-zinc-200 rounded-lg shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-zinc-200 font-bold">Endpoints</div>
        <table className="w-full text-left text-sm">
          <thead className="bg-zinc-50 text-zinc-600 border-b border-zinc-200">
            <tr>
              <th className="px-6 py-3 font-medium">Name</th>
              <th className="px-6 py-3 font-medium">Provider</th>
              <th className="px-6 py-3 font-medium">Upstream Model</th>
              <th className="px-6 py-3 font-medium">Health</th>
              <th className="px-6 py-3 font-medium">$/1M in·out</th>
              <th className="px-6 py-3 font-medium">Capability</th>
              <th className="px-6 py-3 font-medium">Priority</th>
              <th className="px-6 py-3 font-medium">Weight</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-200">
            {endpoints.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-6 py-8 text-center text-zinc-500">
                  No endpoints yet. Create one, then bind it into a Model Pool.
                </td>
              </tr>
            ) : (
              endpoints.map((ep) => (
                <tr key={ep.id} className="hover:bg-zinc-50/50">
                  <td className="px-6 py-4 font-medium">{ep.name}</td>
                  <td className="px-6 py-4">{ep.account_name}</td>
                  <td className="px-6 py-4 font-mono text-xs">{ep.upstream_model_id}</td>
                  <td className="px-6 py-4">
                    <HealthBadge status={ep.enabled ? ep.health_status : 'disabled'} />
                  </td>
                  <td className="px-6 py-4 font-mono text-xs">
                    {(ep.input_price_per_1m ?? 0).toFixed(2)} / {(ep.output_price_per_1m ?? 0).toFixed(2)}
                  </td>
                  <td className="px-6 py-4 font-mono text-xs">
                    {(ep.capability_score ?? 0.5).toFixed(2)}
                  </td>
                  <td className="px-6 py-4 font-mono">{ep.priority}</td>
                  <td className="px-6 py-4 font-mono">{ep.weight}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {isProviderModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
          <div className="bg-white rounded-lg shadow-lg w-full max-w-md border border-zinc-200">
            <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-200">
              <h3 className="text-lg font-bold">Add Provider</h3>
              <button onClick={() => setIsProviderModalOpen(false)}>
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleCreateProvider} className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-zinc-700 mb-1">Name</label>
                <input
                  required
                  className="w-full border border-zinc-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:border-black focus:ring-1 focus:ring-black"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                />
              </div>
              <Select
                label="Provider Type"
                options={PROVIDER_TYPES}
                selected={providerType}
                onChange={(opt) => setProviderType({ id: String(opt.id), name: opt.name })}
              />
              <div>
                <label className="block text-sm font-medium text-zinc-700 mb-1">Base URL</label>
                <input
                  type="url"
                  required
                  className="w-full border border-zinc-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:border-black focus:ring-1 focus:ring-black"
                  value={formData.base_url}
                  onChange={(e) => setFormData({ ...formData, base_url: e.target.value })}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-zinc-700 mb-1">API Key</label>
                <input
                  type="password"
                  required
                  className="w-full border border-zinc-300 rounded-md px-3 py-2 text-sm font-mono focus:outline-none focus:border-black focus:ring-1 focus:ring-black"
                  value={formData.api_key}
                  onChange={(e) => setFormData({ ...formData, api_key: e.target.value })}
                />
              </div>
              <button
                type="submit"
                disabled={submitting}
                className="w-full bg-black text-white py-2 rounded-md disabled:opacity-50"
              >
                {submitting ? 'Saving...' : 'Save Provider'}
              </button>
            </form>
          </div>
        </div>
      )}

      {isEndpointModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
          <div className="bg-white rounded-lg shadow-lg w-full max-w-md border border-zinc-200">
            <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-200">
              <h3 className="text-lg font-bold">Add Endpoint</h3>
              <button onClick={() => setIsEndpointModalOpen(false)}>
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleCreateEndpoint} className="p-6 space-y-4">
              <Select
                label="Provider Account"
                options={providers.map((p) => ({ id: p.id, name: p.name }))}
                selected={selectedAccount || { id: '', name: 'Select provider...' }}
                onChange={(opt) => setSelectedAccount({ id: String(opt.id), name: opt.name })}
              />
              <div>
                <label className="block text-sm font-medium text-zinc-700 mb-1">Endpoint Name</label>
                <input
                  required
                  className="w-full border border-zinc-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:border-black focus:ring-1 focus:ring-black"
                  placeholder="e.g. gpt-4o-eastus"
                  value={endpointForm.name}
                  onChange={(e) => setEndpointForm({ ...endpointForm, name: e.target.value })}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-zinc-700 mb-1">Upstream Model ID</label>
                <input
                  required
                  className="w-full border border-zinc-300 rounded-md px-3 py-2 text-sm font-mono focus:outline-none focus:border-black focus:ring-1 focus:ring-black"
                  placeholder="e.g. gpt-4o"
                  value={endpointForm.upstream_model_id}
                  onChange={(e) =>
                    setEndpointForm({ ...endpointForm, upstream_model_id: e.target.value })
                  }
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-zinc-700 mb-1">Priority</label>
                  <input
                    type="number"
                    className="w-full border border-zinc-300 rounded-md px-3 py-2 text-sm font-mono"
                    value={endpointForm.priority}
                    onChange={(e) => setEndpointForm({ ...endpointForm, priority: e.target.value })}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-zinc-700 mb-1">Weight</label>
                  <input
                    type="number"
                    className="w-full border border-zinc-300 rounded-md px-3 py-2 text-sm font-mono"
                    value={endpointForm.weight}
                    onChange={(e) => setEndpointForm({ ...endpointForm, weight: e.target.value })}
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-zinc-700 mb-1">Input $/1M</label>
                  <input
                    type="number"
                    step="0.01"
                    className="w-full border border-zinc-300 rounded-md px-3 py-2 text-sm font-mono"
                    placeholder="e.g. 0.15"
                    value={endpointForm.input_price_per_1m}
                    onChange={(e) =>
                      setEndpointForm({ ...endpointForm, input_price_per_1m: e.target.value })
                    }
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-zinc-700 mb-1">Output $/1M</label>
                  <input
                    type="number"
                    step="0.01"
                    className="w-full border border-zinc-300 rounded-md px-3 py-2 text-sm font-mono"
                    placeholder="e.g. 0.60"
                    value={endpointForm.output_price_per_1m}
                    onChange={(e) =>
                      setEndpointForm({ ...endpointForm, output_price_per_1m: e.target.value })
                    }
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-zinc-700 mb-1">Capability (0–1)</label>
                  <input
                    type="number"
                    step="0.05"
                    min={0}
                    max={1}
                    className="w-full border border-zinc-300 rounded-md px-3 py-2 text-sm font-mono"
                    value={endpointForm.capability_score}
                    onChange={(e) =>
                      setEndpointForm({ ...endpointForm, capability_score: e.target.value })
                    }
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-zinc-700 mb-1">Supports tools</label>
                  <Select
                    label=""
                    options={[
                      { id: 'unknown', name: 'Undeclared' },
                      { id: 'true', name: 'Yes' },
                      { id: 'false', name: 'No' },
                    ]}
                    selected={
                      endpointForm.supports_tools === 'true'
                        ? { id: 'true', name: 'Yes' }
                        : endpointForm.supports_tools === 'false'
                          ? { id: 'false', name: 'No' }
                          : { id: 'unknown', name: 'Undeclared' }
                    }
                    onChange={(opt) =>
                      setEndpointForm({ ...endpointForm, supports_tools: String(opt.id) })
                    }
                  />
                </div>
              </div>
              <p className="text-xs text-zinc-500">
                Prices power CostAware routing. Capability scores power smart routing.
              </p>
              <button
                type="submit"
                disabled={submitting || !selectedAccount?.id}
                className="w-full bg-black text-white py-2 rounded-md disabled:opacity-50"
              >
                {submitting ? 'Saving...' : 'Save Endpoint'}
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
