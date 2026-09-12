import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { Plus, X } from 'lucide-react'
import Select from '../components/Select'
import { adminFetch } from '../lib/api'
import { useModal } from '../lib/modal'
import { useDialog } from '../components/Dialog'
import { useI18n } from '../lib/i18n'

interface ModelPool {
  id: string
  name: string
  strategy: string
  enabled: boolean
  created_at: string
}

const getStrategyOptions = (t: (key: string) => string) => [
  { id: 'round_robin', name: t('admin.strategy_round_robin') },
  { id: 'priority', name: t('admin.strategy_priority') },
  { id: 'least_connections', name: t('admin.strategy_least_connections') },
  { id: 'latency_based', name: t('admin.strategy_latency_based') },
  { id: 'load_aware', name: t('admin.strategy_load_aware') },
  { id: 'cost_aware', name: t('admin.strategy_cost_aware') },
  { id: 'capability_aware', name: t('admin.strategy_capability_aware') },
]

export default function Pools() {
  const { t } = useI18n()
  const strategyOptions = getStrategyOptions(t)
  const [pools, setPools] = useState<ModelPool[]>([])
  const [loading, setLoading] = useState(true)
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [name, setName] = useState('')
  const [strategy, setStrategy] = useState(strategyOptions[0])
  const selectedStrategy = strategyOptions.find((o) => o.id === strategy.id) ?? strategyOptions[0]
  const [submitting, setSubmitting] = useState(false)
  const { dialog, showAlert } = useDialog()
  const dialogRef = useModal({ enabled: isModalOpen, onClose: () => setIsModalOpen(false) })

  useEffect(() => {
    fetchPools()
  }, [])

  const fetchPools = async () => {
    try {
      const data = await adminFetch('/api/admin/pools')
      if (data.success) setPools(data.data)
    } catch (error) {
      console.error('Failed to fetch pools:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSubmitting(true)
    try {
      const data = await adminFetch('/api/admin/pools', {
        method: 'POST',
        body: JSON.stringify({ name, strategy: strategy.id }),
      })
      if (data.success) {
        setIsModalOpen(false)
        setName('')
        setStrategy(strategyOptions[0])
        fetchPools()
      } else {
        await showAlert(data.message || t('admin.create_pool_failed'))
      }
    } catch (error) {
      console.error('Submit error:', error)
      await showAlert(error instanceof Error ? error.message : 'Network error')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      {dialog}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-zinc-900">{t('nav.pools')}</h2>
          <p className="text-sm text-zinc-500 mt-1">{t('admin.pools_subtitle')}</p>
        </div>
        <button
          onClick={() => setIsModalOpen(true)}
          className="flex items-center gap-2 px-4 py-2 bg-black text-white text-sm font-medium rounded-md hover:bg-zinc-800 transition-colors focus:outline-none focus:ring-2 focus:ring-black focus:ring-offset-2"
        >
          <Plus className="w-4 h-4" />
          {t('admin.create_pool')}
        </button>
      </div>

      <div className="bg-white border border-zinc-200 rounded-lg shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm whitespace-nowrap">
            <thead className="bg-zinc-50 text-zinc-600 border-b border-zinc-200">
              <tr>
                <th className="px-6 py-3 font-medium">{t('common.name')}</th>
                <th className="px-6 py-3 font-medium">{t('admin.strategy')}</th>
                <th className="px-6 py-3 font-medium">{t('common.status')}</th>
                <th className="px-6 py-3 font-medium text-right">{t('common.actions')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-200">
              {loading ? (
                <tr>
                  <td colSpan={4} className="px-6 py-8 text-center text-zinc-500">
                    {t('admin.pools_loading')}
                  </td>
                </tr>
              ) : pools.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-6 py-8 text-center text-zinc-500">
                    {t('admin.pools_empty')}
                  </td>
                </tr>
              ) : (
                pools.map((pool) => (
                  <tr key={pool.id} className="hover:bg-zinc-50/50 transition-colors">
                    <td className="px-6 py-4 font-medium text-zinc-900">{pool.name}</td>
                    <td className="px-6 py-4">
                      <span className="px-2.5 py-1 rounded-md bg-zinc-100 border border-zinc-200 text-xs font-mono">
                        {pool.strategy}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-2">
                        <span
                          className={`w-2 h-2 rounded-full ${pool.enabled ? 'bg-emerald-500' : 'bg-zinc-300'}`}
                        />
                        <span className="capitalize">{pool.enabled ? t('common.active') : t('common.disabled')}</span>
                      </div>
                    </td>
                    <td className="px-6 py-4 text-right">
                      <Link
                        to={`/pools/${pool.id}`}
                        className="text-zinc-500 hover:text-black font-medium"
                      >
                        {t('admin.manage_endpoints')}
                      </Link>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {isModalOpen && (
        <div ref={dialogRef} role="dialog" aria-modal="true" className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
          <div className="bg-white rounded-lg shadow-lg w-full max-w-md overflow-hidden border border-zinc-200">
            <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-200">
              <h3 className="text-lg font-bold">{t('admin.create_pool_title')}</h3>
              <button onClick={() => setIsModalOpen(false)} className="text-zinc-400 hover:text-black">
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleSubmit} className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-zinc-700 mb-1">{t('admin.pool_name')}</label>
                <input
                  type="text"
                  required
                  className="w-full bg-white border border-zinc-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:border-black focus:ring-1 focus:ring-black"
                  placeholder={t('admin.pool_name_placeholder')}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>
              <Select
                label={t('admin.routing_strategy')}
                options={strategyOptions}
                selected={selectedStrategy}
                onChange={(opt) => setStrategy({ id: String(opt.id), name: opt.name })}
              />
              <p className="text-xs text-zinc-500 -mt-2">
                {t('admin.strategy_hint')}
              </p>
              <div className="pt-4 flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-4 py-2 text-sm font-medium text-zinc-900 bg-transparent border border-zinc-300 rounded-md hover:bg-zinc-50"
                >
                  {t('common.cancel')}
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-4 py-2 text-sm font-medium text-white bg-black rounded-md hover:bg-zinc-800 disabled:opacity-50"
                >
                  {submitting ? t('common.creating') : t('admin.create_pool')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
