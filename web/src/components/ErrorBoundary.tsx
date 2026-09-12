import { Component, type ErrorInfo, type ReactNode } from 'react'
import { useI18n } from '../lib/i18n'

/**
 * Keeps one broken page from blanking the whole console.
 *
 * The class component owns the failure state (React requires a class for error
 * boundaries); the exported wrapper supplies localized copy from the i18n context.
 */

type BoundaryProps = {
  title: string
  message: string
  actionLabel: string
  children: ReactNode
}

type BoundaryState = { failed: boolean }

class Boundary extends Component<BoundaryProps, BoundaryState> {
  state: BoundaryState = { failed: false }

  static getDerivedStateFromError(): BoundaryState {
    return { failed: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Unhandled UI error', error, info.componentStack)
  }

  render() {
    if (!this.state.failed) return this.props.children
    return (
      <div className="rounded-xl border border-rose-200 bg-rose-50 p-6">
        <h2 className="text-sm font-semibold text-rose-900">{this.props.title}</h2>
        <p className="mt-2 text-sm text-rose-800">{this.props.message}</p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="mt-4 rounded-lg border border-rose-300 bg-white px-4 py-2 text-sm font-medium text-rose-800 hover:bg-rose-100"
        >
          {this.props.actionLabel}
        </button>
      </div>
    )
  }
}

export function ErrorBoundary({ children }: { children: ReactNode }) {
  const { t } = useI18n()
  return (
    <Boundary
      title={t('errors.boundary_title')}
      message={t('errors.boundary_message')}
      actionLabel={t('errors.boundary_action')}
    >
      {children}
    </Boundary>
  )
}
