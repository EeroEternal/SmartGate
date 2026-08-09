import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { X } from 'lucide-react'

type DialogState = {
  title: string
  message: ReactNode
  confirmLabel: string
  cancelLabel?: string
  destructive?: boolean
}

export function Dialog({ state, onConfirm, onCancel }: { state: DialogState; onConfirm: () => void; onCancel: () => void }) {
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-zinc-950/40 p-4" role="presentation" onMouseDown={onCancel}>
      <div className="w-full max-w-md rounded-2xl border border-zinc-200 bg-white p-6 shadow-2xl" role="dialog" aria-modal="true" aria-labelledby="dialog-title" onMouseDown={(event) => event.stopPropagation()}>
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 id="dialog-title" className="text-lg font-semibold text-zinc-950">{state.title}</h2>
            <div className="mt-2 text-sm leading-6 text-zinc-600">{state.message}</div>
          </div>
          <button type="button" onClick={onCancel} className="rounded-lg p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-950" aria-label="Close">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="mt-6 flex justify-end gap-3">
          {state.cancelLabel && <button type="button" onClick={onCancel} className="rounded-lg border border-zinc-300 px-4 py-2.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50">{state.cancelLabel}</button>}
          <button type="button" onClick={onConfirm} className={`rounded-lg px-4 py-2.5 text-sm font-medium text-white ${state.destructive ? 'bg-rose-600 hover:bg-rose-700' : 'bg-zinc-950 hover:bg-zinc-800'}`}>
            {state.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}

export function useDialog() {
  const [state, setState] = useState<DialogState | null>(null)
  const resolver = useRef<((confirmed: boolean) => void) | null>(null)

  const close = useCallback((confirmed: boolean) => {
    resolver.current?.(confirmed)
    resolver.current = null
    setState(null)
  }, [])

  useEffect(() => () => {
    resolver.current?.(false)
    resolver.current = null
  }, [])

  const showAlert = useCallback((message: ReactNode, title = 'Something went wrong') => new Promise<void>((resolve) => {
    resolver.current = () => resolve()
    setState({ title, message, confirmLabel: 'OK' })
  }), [])

  const showConfirm = useCallback((message: ReactNode, title = 'Are you sure?') => new Promise<boolean>((resolve) => {
    resolver.current = resolve
    setState({ title, message, confirmLabel: 'Confirm', cancelLabel: 'Cancel', destructive: true })
  }), [])

  return {
    dialog: state ? <Dialog state={state} onConfirm={() => close(true)} onCancel={() => close(false)} /> : null,
    showAlert,
    showConfirm,
  }
}
