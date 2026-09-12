import { Plus, Trash2 } from 'lucide-react'
import { Link } from 'react-router-dom'
import { saasFetch } from '../../lib/saasApi'
import { useDialog } from '../../components/Dialog'
import { useI18n } from '../../lib/i18n'
import { Empty, ErrorMessage, Page } from './components'
import { routingInfo } from './serviceUtils'
import { useModelServices } from './useModelServices'

export function ServicesPage() {
  const { t } = useI18n()
  const { services, error, refresh } = useModelServices()
  const { dialog, showConfirm } = useDialog()
  async function remove(id: string) {
    if (!await showConfirm(t('services.remove_confirm'), t('services.remove_title'))) return
    await saasFetch(`/api/saas/model-services/${id}`, { method: 'DELETE' })
    // Deleting a service invalidates the shared list, so refresh it instead of
    // re-running a page-local fetch.
    await refresh()
  }
  return (
    <Page action={<Link to="/app/services/new" className="inline-flex items-center gap-2 rounded-lg bg-zinc-950 px-4 py-2.5 text-sm text-white shadow-sm hover:bg-zinc-800 transition-colors"><Plus className="w-4 h-4" /> {t('services.create_button')}</Link>}>
      {dialog}
      {error && <ErrorMessage text={error} />}
      {!services.length ? (
        <Empty text={t('services.no_services')} href="/app/services/new" />
      ) : (
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3">
          {services.map((service) => {
            const routing = routingInfo(service.strategy, t)
            const count = service.endpoint_count || 0
            const isDraft = service.health_status === 'draft' || count === 0
            return (
              <div
                key={service.id}
                className="flex flex-col justify-between rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm hover:border-zinc-300 transition-all"
              >
                <div>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h3 className="font-semibold text-zinc-950 text-base truncate" title={service.name}>
                        {service.name}
                      </h3>
                    </div>
                    <span
                      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium shrink-0 ${
                        isDraft ? 'bg-amber-50 text-amber-700 border border-amber-200' : 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                      }`}
                    >
                      {isDraft ? (t('services.setup_needed')) : (t('services.ready'))}
                    </span>
                  </div>

                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <span className="inline-flex items-center rounded-md bg-purple-50 px-2 py-0.5 text-xs font-medium text-purple-700 border border-purple-200/70">
                      {routing.label}
                    </span>
                    <span className="inline-flex items-center gap-1 rounded-md bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-600">
                      <span className={`h-1.5 w-1.5 rounded-full ${count > 0 ? 'bg-emerald-500' : 'bg-amber-500'}`} />
                      {count === 1
                        ? (t('services.providers_connected_single'))
                        : t('services.providers_connected', { count }) || `${count} providers connected`}
                    </span>
                  </div>
                </div>

                <div className="mt-6 flex items-center justify-between border-t border-zinc-100 pt-4">
                  <Link
                    to={`/app/services/${service.id}`}
                    className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:text-primary-hover transition-colors"
                  >
                    {isDraft ? (t('services.setup')) : (t('services.manage'))} →
                  </Link>
                  <button
                    type="button"
                    onClick={() => remove(service.id)}
                    className="rounded-lg p-1.5 text-zinc-400 hover:bg-rose-50 hover:text-rose-600 transition-colors"
                    title={t('services.remove')}
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </Page>
  )
}
