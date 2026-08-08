import { useState, useEffect } from 'react'
import { Plus, X } from 'lucide-react'
import Select from '../components/Select'
import HealthBadge from '../components/HealthBadge'
import { adminFetch } from '../lib/api'

interface VirtualModel {
  id: string
  pool_id: string
  pool_name: string
  name: string
  enabled: boolean
  created_at: string
}

interface Pool {
  id: string
  name: string
  strategy: string
}

export default function VirtualModels() {
  const [models, setModels] = useState<VirtualModel[]>([])
  const [pools, setPools] = useState<Pool[]>([])
  const [loading, setLoading] = useState(true)
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [name, setName] = useState('')
  const [selectedPool, setSelectedPool] = useState<{ id: string; name: string } | null>(null)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    refresh()
  }, [])

  const refresh = async () => {
    try {
      const [mData, pData] = await Promise.all([
        adminFetch('/api/admin/virtual-models'),
        adminFetch('/api/admin/pools'),
      ])
      if (mData.success) setModels(mData.data)
      if (pData.success) {
        setPools(pData.data)
        if (pData.data.length > 0 && !selectedPool) {
          setSelectedPool({ id: pData.data[0].id, name: pData.data[0].name })
        }
      }
    } catch (error) {
      console.error(error)
    } finally {
      setLoading(false)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!selectedPool?.id) return
    setSubmitting(true)
    try {
      const data = await adminFetch('/api/admin/virtual-models', {
        method: 'POST',
        body: JSON.stringify({
          pool_id: selectedPool.id,
          name,
        }),
      })
      if (data.success) {
        setIsModalOpen(false)
        setName('')
        await refresh()
      }
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Failed to create virtual model')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-zinc-900">Virtual Models</h2>
          <p className="text-sm text-zinc-500 mt-1">
            Stable names that clients call. Each maps to one Model Pool.
          </p>
        </div>
        <button
          onClick={() => setIsModalOpen(true)}
          disabled={pools.length === 0}
          className="flex items-center gap-2 px-4 py-2 bg-black text-white text-sm font-medium rounded-md hover:bg-zinc-800 disabled:opacity-50"
        >
          <Plus className="w-4 h-4" />
          Create Virtual Model
        </button>
      </div>

      <div className="bg-white border border-zinc-200 rounded-lg shadow-sm overflow-hidden">
        <table className="w-full text-left text-sm">
          <thead className="bg-zinc-50 text-zinc-600 border-b border-zinc-200">
            <tr>
              <th className="px-6 py-3 font-medium">Public Name</th>
              <th className="px-6 py-3 font-medium">Model Pool</th>
              <th className="px-6 py-3 font-medium">Status</th>
              <th className="px-6 py-3 font-medium">Created</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-200">
            {loading ? (
              <tr>
                <td colSpan={4} className="px-6 py-8 text-center text-zinc-500">Loading...</td>
              </tr>
            ) : models.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-6 py-8 text-center text-zinc-500">
                  {pools.length === 0
                    ? 'Create a Model Pool first, then expose it as a virtual model.'
                    : 'No virtual models yet. Create one for clients to call.'}
                </td>
              </tr>
            ) : (
              models.map((model) => (
                <tr key={model.id} className="hover:bg-zinc-50/50">
                  <td className="px-6 py-4 font-mono font-medium">{model.name}</td>
                  <td className="px-6 py-4">{model.pool_name}</td>
                  <td className="px-6 py-4">
                    <HealthBadge status={model.enabled ? 'healthy' : 'disabled'} />
                  </td>
                  <td className="px-6 py-4">{new Date(model.created_at).toLocaleDateString()}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
          <div className="bg-white rounded-lg w-full max-w-md border border-zinc-200">
            <div className="px-6 py-4 border-b flex justify-between items-center">
              <h3 className="font-bold">Create Virtual Model</h3>
              <button onClick={() => setIsModalOpen(false)}>
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleSubmit} className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-zinc-700 mb-1">Public Model Name</label>
                <input
                  required
                  className="w-full border border-zinc-300 rounded-md px-3 py-2 text-sm font-mono focus:outline-none focus:border-black focus:ring-1 focus:ring-black"
                  placeholder="e.g. fast-chat"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
                <p className="mt-1 text-xs text-zinc-500">
                  Clients send this value in the request `model` field.
                </p>
              </div>
              <Select
                label="Model Pool"
                options={pools.map((p) => ({ id: p.id, name: p.name }))}
                selected={selectedPool || { id: '', name: 'Select pool...' }}
                onChange={(opt) => setSelectedPool({ id: String(opt.id), name: opt.name })}
              />
              <button
                type="submit"
                disabled={submitting || !selectedPool?.id}
                className="w-full bg-black text-white py-2 rounded-md disabled:opacity-50"
              >
                {submitting ? 'Creating...' : 'Create'}
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
