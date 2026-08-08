import { useState, useEffect } from 'react'
import { Plus, X } from 'lucide-react'
import Select from '../components/Select'
import { adminFetch } from '../lib/api'

interface Provider {
  id: string
  name: string
  provider_type: string
  base_url: string
  status: string
  created_at: string
}

const PROVIDER_TYPES = [
  { id: 'openai', name: 'OpenAI (or Compatible)' },
  { id: 'azure', name: 'Azure OpenAI' },
  { id: 'anthropic', name: 'Anthropic' },
  { id: 'deepseek', name: 'DeepSeek' },
]

export default function Providers() {
  const [providers, setProviders] = useState<Provider[]>([])
  const [loading, setLoading] = useState(true)
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [formData, setFormData] = useState({
    name: '',
    base_url: '',
    api_key: '',
  })
  const [providerType, setProviderType] = useState(PROVIDER_TYPES[0])
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    fetchProviders()
  }, [])

  const fetchProviders = async () => {
    try {
      const data = await adminFetch('/api/admin/providers')
      if (data.success) setProviders(data.data)
    } catch (error) {
      console.error('Failed to fetch providers:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
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
        setIsModalOpen(false)
        setFormData({ name: '', base_url: '', api_key: '' })
        setProviderType(PROVIDER_TYPES[0])
        fetchProviders()
      } else {
        alert(data.message || 'Failed to create provider')
      }
    } catch (error) {
      console.error('Submit error:', error)
      alert(error instanceof Error ? error.message : 'Network error')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-zinc-900">Providers</h2>
          <p className="text-sm text-zinc-500 mt-1">Manage upstream AI service providers.</p>
        </div>
        <button
          onClick={() => setIsModalOpen(true)}
          className="flex items-center gap-2 px-4 py-2 bg-black text-white text-sm font-medium rounded-md hover:bg-zinc-800 transition-colors focus:outline-none focus:ring-2 focus:ring-black focus:ring-offset-2"
        >
          <Plus className="w-4 h-4" />
          Add Provider
        </button>
      </div>

      <div className="bg-white border border-zinc-200 rounded-lg shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm whitespace-nowrap">
            <thead className="bg-zinc-50 text-zinc-600 border-b border-zinc-200">
              <tr>
                <th className="px-6 py-3 font-medium">Name</th>
                <th className="px-6 py-3 font-medium">Type</th>
                <th className="px-6 py-3 font-medium">Base URL</th>
                <th className="px-6 py-3 font-medium">Status</th>
                <th className="px-6 py-3 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-200">
              {loading ? (
                <tr>
                  <td colSpan={5} className="px-6 py-8 text-center text-zinc-500">
                    Loading providers...
                  </td>
                </tr>
              ) : providers.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-6 py-8 text-center text-zinc-500">
                    No providers configured. Click "Add Provider" to start.
                  </td>
                </tr>
              ) : (
                providers.map((provider) => (
                  <tr key={provider.id} className="hover:bg-zinc-50/50 transition-colors">
                    <td className="px-6 py-4 font-medium text-zinc-900">{provider.name}</td>
                    <td className="px-6 py-4">
                      <span className="px-2.5 py-1 rounded-md bg-zinc-100 border border-zinc-200 text-xs font-mono">
                        {provider.provider_type}
                      </span>
                    </td>
                    <td
                      className="px-6 py-4 font-mono text-zinc-500 truncate max-w-xs"
                      title={provider.base_url}
                    >
                      {provider.base_url}
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-2">
                        <span
                          className={`w-2 h-2 rounded-full ${provider.status === 'active' ? 'bg-emerald-500' : 'bg-zinc-300'}`}
                        />
                        <span className="capitalize">{provider.status}</span>
                      </div>
                    </td>
                    <td className="px-6 py-4 text-right">
                      <button className="text-zinc-500 hover:text-black font-medium">Edit</button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
          <div className="bg-white rounded-lg shadow-lg w-full max-w-md overflow-hidden border border-zinc-200">
            <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-200">
              <h3 className="text-lg font-bold">Add Provider</h3>
              <button onClick={() => setIsModalOpen(false)} className="text-zinc-400 hover:text-black">
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleSubmit} className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-zinc-700 mb-1">Name</label>
                <input
                  type="text"
                  required
                  className="w-full bg-white border border-zinc-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:border-black focus:ring-1 focus:ring-black"
                  placeholder="e.g. My Azure OpenAI"
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
                  className="w-full bg-white border border-zinc-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:border-black focus:ring-1 focus:ring-black"
                  placeholder="https://api.openai.com/v1"
                  value={formData.base_url}
                  onChange={(e) => setFormData({ ...formData, base_url: e.target.value })}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-zinc-700 mb-1">API Key</label>
                <input
                  type="password"
                  required
                  className="w-full bg-white border border-zinc-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:border-black focus:ring-1 focus:ring-black font-mono"
                  placeholder="sk-..."
                  value={formData.api_key}
                  onChange={(e) => setFormData({ ...formData, api_key: e.target.value })}
                />
              </div>
              <div className="pt-4 flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-4 py-2 text-sm font-medium text-zinc-900 bg-transparent border border-zinc-300 rounded-md hover:bg-zinc-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-4 py-2 text-sm font-medium text-white bg-black rounded-md hover:bg-zinc-800 disabled:opacity-50"
                >
                  {submitting ? 'Saving...' : 'Save Provider'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
